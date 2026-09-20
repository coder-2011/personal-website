import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, parseYaml, getFrontMatterInfo } from 'obsidian';
import { exportNote } from '../src/lib/blog/export.mjs';
import { validateMetadata, assertPublicText } from '../src/lib/blog/privacy.mjs';

type Post = { id: string; slug: string; title: string; date: string; description: string; revision: string; published: boolean; updated: string };
type Saved = { path: string; revision: string | null; slug: string; hash: string; assets: string[]; status: string; approved: boolean };
type Data = { site: string; secretId: string; posts: Record<string, Saved> };
type Metadata = { id: string; slug: string; title: string; date: string; description: string; baseVersion: string | null };
type Image = { path: string; bytes: ArrayBuffer; placeholder: string };
type Prepared = { meta: Metadata; markdown: string; warnings: string[]; images: Image[]; hash: string };

const day = () => new Date().toISOString().slice(0, 10);
const slugify = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
const hash = async (value: string | ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))).map(b => b.toString(16).padStart(2, '0')).join('');

export default class NamanPublish extends Plugin {
  data!: Data;
  status!: HTMLElement;
  pending = new Set<string>();
  running = false;
  stopped = false;
  remote: Post[] = [];
  async onload() {
    const saved = await this.loadData();
    this.data = { site: 'https://naman.world', secretId: `naman-publish-${crypto.randomUUID()}`, posts: {}, ...saved };
    // The installer uses a one-time local bootstrap; the key never remains in plugin data.json.
    if (saved?.bootstrapToken) {
      this.app.secretStorage.setSecret(this.data.secretId, saved.bootstrapToken);
      delete (this.data as Data & {bootstrapToken?: string}).bootstrapToken;
    }
    await this.saveData(this.data);
    this.status = this.addStatusBarItem();
    this.setStatus('Ready');
    this.status.addEventListener('click', () => new PublishPanel(this.app, this).open());
    this.addRibbonIcon('send', 'Publish to naman.world', () => new PublishPanel(this.app, this).open());
    this.addCommand({ id: 'publish-note', name: 'Publish current note', checkCallback: checking => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') return false;
      if (!checking) new PublishModal(this.app, this, [file]).open();
      return true;
    } });
    this.addCommand({ id: 'manage-posts', name: 'Manage published notes', callback: () => new PublishPanel(this.app, this).open() });
    this.addCommand({ id: 'sync-now', name: 'Sync published notes now', callback: () => void this.catchUp() });
    this.addSettingTab(new PublishSettings(this.app, this));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension === 'md') menu.addItem(item => item.setTitle('Publish to naman.world').setIcon('send').onClick(() => new PublishModal(this.app, this, [file]).open()));
    }));
    this.registerEvent(this.app.workspace.on('files-menu', (menu, files) => {
      const notes = files.filter((f): f is TFile => f instanceof TFile && f.extension === 'md');
      if (notes.length) menu.addItem(item => item.setTitle('Publish selected notes').setIcon('send').onClick(() => new PublishModal(this.app, this, notes).open()));
    }));
    this.registerEvent(this.app.metadataCache.on('changed', file => this.schedule(file)));
    this.registerEvent(this.app.vault.on('modify', file => {
      if (!(file instanceof TFile) || file.extension === 'md') return;
      for (const post of Object.values(this.data.posts)) if (post.assets.includes(file.path)) {
        const note = this.app.vault.getAbstractFileByPath(post.path);
        if (note instanceof TFile) this.schedule(note);
      }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, old) => {
      for (const post of Object.values(this.data.posts)) if (post.path === old) post.path = file.path;
      void this.saveData(this.data);
      if (file instanceof TFile) this.schedule(file);
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      for (const post of Object.values(this.data.posts)) if (post.path === file.path) {
        post.status = 'Note deleted locally; unpublish from the publishing panel.';
        post.approved = false;
        new Notice(post.status, 8000);
      }
      void this.saveData(this.data);
    }));
    this.registerDomEvent(window, 'online', () => void this.catchUp());
    this.registerInterval(window.setInterval(() => void this.catchUp(), 30_000));
    this.app.workspace.onLayoutReady(() => void this.catchUp());
  }
  onunload() { this.stopped = true; this.pending.clear(); }
  setStatus(value: string) { this.status.setText(`Publish: ${value}`); }
  async api(path = '', method = 'GET', body?: object | ArrayBuffer, type = 'application/json') {
    const site = new URL(this.data.site);
    if (site.origin !== this.data.site || (site.protocol !== 'https:' && !(site.protocol === 'http:' && ['localhost','127.0.0.1'].includes(site.hostname)))) throw new Error('Use an HTTPS site origin, or localhost for testing.');
    const key = this.app.secretStorage.getSecret(this.data.secretId);
    if (!key) throw new Error('Add the publishing key in Settings → Naman Publish.');
    let response;
    try {
      response = await requestUrl({ url: `${site.origin}/api/publish${path}`, method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': type }, body: body instanceof ArrayBuffer ? body : body ? JSON.stringify(body) : undefined, throw: false });
    } catch { throw new Error('Could not reach the website. Changes will retry when connected.'); }
    if (response.status >= 400) {
      let message = 'The website could not accept this publication.';
      try { message = response.json.error || message; } catch {}
      const error = new Error(message) as Error & { status: number };
      error.status = response.status;
      throw error;
    }
    return response.json;
  }
  frontmatter(file: TFile) { return this.app.metadataCache.getFileCache(file)?.frontmatter || {}; }
  metadata(file: TFile, fm: Record<string, unknown>): Metadata {
    const id = typeof fm.blog_id === 'string' ? fm.blog_id : crypto.randomUUID();
    const saved = this.data.posts[id];
    if (saved && saved.path !== file.path) throw new Error('This note copies another published note’s blog_id. Remove blog_id from this copy before publishing it separately.');
    return { id, slug: saved?.slug || String(fm.blog_slug || slugify(file.basename)), title: String(fm.blog_title || file.basename), date: String(fm.blog_date || day()), description: String(fm.blog_description || ''), baseVersion: saved?.revision || null };
  }
  async prepare(file: TFile, meta?: Metadata): Promise<Prepared> {
    const source = await this.app.vault.read(file);
    const info = getFrontMatterInfo(source);
    const fm = info.exists ? parseYaml(info.frontmatter) || {} : {};
    const metadata = validateMetadata(meta || this.metadata(file, fm));
    const images: Image[] = [];
    const imageByPath = new Map<string, string>();
    const exported = await exportNote(source, {
      resolveNote: async (target: string) => {
        const note = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
        if (!note) return null;
        const id = this.frontmatter(note).blog_id;
        const entry = this.remote.find(p => p.id === id && p.published);
        return entry ? `/blog/${entry.slug}` : null;
      },
      asset: async (path: string) => {
        assertPublicText(path, 'Image reference');
        if (path.split('/').some(s => s.startsWith('.')) || path.includes('\\')) throw new Error('Images must be visible files inside the vault.');
        const image = this.app.metadataCache.getFirstLinkpathDest(path, file.path);
        if (!image || !['png','jpg','jpeg','webp'].includes(image.extension.toLowerCase())) throw new Error('An embedded image is missing or unsupported.');
        if (image.stat.size > 3_500_000) throw new Error('Keep each image below 3.5 MB.');
        if (imageByPath.has(image.path)) return imageByPath.get(image.path)!;
        const input = await this.app.vault.readBinary(image);
        const bitmap = await createImageBitmap(new Blob([input]));
        if (bitmap.width * bitmap.height > 25_000_000) { bitmap.close(); throw new Error('Keep images below 25 megapixels.'); }
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close();
        // Re-encoding before upload strips EXIF, GPS, and original filenames locally.
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare image.')), 'image/webp', .92));
        const bytes = await blob.arrayBuffer();
        if (bytes.byteLength > 3_500_000) throw new Error('The prepared image exceeds 3.5 MB.');
        const placeholder = `/api/blog/assets/${await hash(bytes)}`;
        images.push({ path: image.path, bytes, placeholder });
        imageByPath.set(image.path, placeholder);
        return placeholder;
      },
    });
    const contentHash = await hash(JSON.stringify({ ...metadata, baseVersion: null, markdown: exported.markdown }));
    return { meta: metadata, markdown: exported.markdown, warnings: exported.warnings, images, hash: contentHash };
  }
  async publish(file: TFile, prepared: Prepared, live: boolean, automated = false) {
    if (this.stopped) return;
    const prior = this.data.posts[prepared.meta.id];
    if (prior?.approved && prior.hash === prepared.hash) {
      if (!automated && this.frontmatter(file).blog_live !== live) await this.app.fileManager.processFrontMatter(file, fm => {fm.blog_live = live;});
      this.setStatus('Up to date'); return;
    }
    this.setStatus('Publishing…');
    let markdown = prepared.markdown;
    // All text checks and all image preparation have succeeded before the first upload.
    for (const image of prepared.images) {
      const uploaded = await this.api('/assets', 'POST', image.bytes, 'image/webp');
      markdown = markdown.split(image.placeholder).join(uploaded.url);
    }
    if (this.stopped) return;
    if (automated && (this.frontmatter(file).blog_live !== true || this.frontmatter(file).publish === false)) return;
    const result = await this.api('', 'POST', { ...prepared.meta, markdown });
    this.remote = this.remote.filter(p => p.id !== result.post.id).concat(result.post);
    this.data.posts[prepared.meta.id] = { path: file.path, revision: result.post.revision, slug: result.post.slug, hash: prepared.hash, assets: prepared.images.map(i => i.path), status: `Published ${new Date().toLocaleTimeString()}`, approved: true };
    await this.saveData(this.data);
    if (!automated) await this.app.fileManager.processFrontMatter(file, fm => {
      fm.publish = true; fm.blog_id = prepared.meta.id; fm.blog_slug = result.post.slug;
      fm.blog_title = prepared.meta.title; fm.blog_date = prepared.meta.date;
      fm.blog_description = prepared.meta.description; fm.blog_live = live;
    });
    this.setStatus('Published');
  }
  schedule(file: TFile) {
    const fm = this.frontmatter(file);
    const saved = this.data.posts[fm.blog_id];
    if (!saved?.approved || saved.path !== file.path || (fm.publish !== false && fm.blog_live !== true)) return;
    this.pending.add(file.path);
    void this.pump();
  }
  async pump() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.pending.size && !this.stopped) {
        const path = this.pending.values().next().value!;
        this.pending.delete(path);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        const fm = this.frontmatter(file);
        const saved = this.data.posts[fm.blog_id];
        if (!saved?.approved) continue;
        try {
          if (fm.publish === false) await this.unpublish(fm.blog_id);
          else if (fm.blog_live === true) {
            const prepared = await this.prepare(file);
            await this.publish(file, prepared, true, true);
          }
        } catch (error) { this.failure(file, error); }
      }
    } finally { this.running = false; }
  }
  failure(file: TFile, error: unknown) {
    const message = error instanceof Error ? error.message : 'Publication failed.';
    const saved = this.data.posts[this.frontmatter(file).blog_id];
    const repeated = saved?.status === message;
    if (saved) {
      saved.status = message;
      if ((error as {status?:number})?.status === 409) saved.approved = false;
      void this.saveData(this.data);
    }
    this.setStatus('Needs attention');
    if (!repeated) new Notice(`${file.basename}: ${message}`, 9000);
  }
  async refresh() { this.remote = (await this.api()).posts; }
  async catchUp() {
    if (this.stopped || !this.app.secretStorage.getSecret(this.data.secretId)) return;
    try {
      await this.refresh();
      for (const saved of Object.values(this.data.posts)) {
        const file = this.app.vault.getAbstractFileByPath(saved.path);
        if (file instanceof TFile) this.schedule(file);
      }
    } catch { this.setStatus('Offline — changes pending'); }
  }
  async unpublish(id: string) {
    const local = this.data.posts[id];
    const remote = this.remote.find(p => p.id === id);
    const result = await this.api('', 'DELETE', { id, baseVersion: local?.revision || remote?.revision });
    this.remote = this.remote.filter(p => p.id !== id).concat(result.post);
    if (local) {
      local.approved = false; local.revision = result.post.revision; local.hash = ''; local.status = 'Unpublished';
      await this.saveData(this.data);
      const file = this.app.vault.getAbstractFileByPath(local.path);
      if (file instanceof TFile) await this.app.fileManager.processFrontMatter(file, fm => { fm.publish = false; fm.blog_live = false; });
    }
    this.setStatus('Unpublished');
  }
}

class PublishModal extends Modal {
  index = 0;
  urls: string[] = [];
  constructor(app: App, private plugin: NamanPublish, private files: TFile[]) { super(app); }
  onOpen() { void this.show(); }
  onClose() { this.urls.forEach(URL.revokeObjectURL); this.contentEl.empty(); }
  async show() {
    this.urls.forEach(URL.revokeObjectURL); this.urls = [];
    const file = this.files[this.index];
    const el = this.contentEl; el.empty(); el.addClass('naman-publish-modal');
    el.createEl('h2', { text: this.files.length > 1 ? `Publish note ${this.index + 1} of ${this.files.length}` : 'Publish to naman.world' });
    el.createEl('p', { text: file.basename, cls: 'naman-publish-muted' });
    let meta: Metadata;
    try { meta = this.plugin.metadata(file, this.plugin.frontmatter(file)); }
    catch (error) { el.createEl('p', {text: error instanceof Error ? error.message : 'Could not prepare this note.'}); return; }
    let live = this.plugin.frontmatter(file).blog_live !== false;
    let invalidate = () => {};
    new Setting(el).setName('Title').addText(input => input.setValue(meta.title).onChange(value => {meta.title = value; invalidate();}));
    new Setting(el).setName('URL').setDesc(`${this.plugin.data.site}/blog/`).addText(input => { input.setValue(meta.slug).setDisabled(!!this.plugin.data.posts[meta.id]?.revision).onChange(value => {meta.slug = value; invalidate();}); });
    new Setting(el).setName('Date').addText(input => { input.inputEl.type = 'date'; input.setValue(meta.date).onChange(value => {meta.date = value; invalidate();}); });
    new Setting(el).setName('Description').addTextArea(input => input.setValue(meta.description).onChange(value => {meta.description = value; invalidate();}));
    new Setting(el).setName('Live sync').setDesc('Saved edits go live while Obsidian is open.').addToggle(toggle => toggle.setValue(live).onChange(value => {live = value; invalidate();}));
    const preview = el.createDiv();
    invalidate = () => preview.empty();
    const actions = new Setting(el);
    actions.addButton(button => button.setButtonText('Review publication').setCta().onClick(async () => {
      button.setDisabled(true); preview.empty();
      try {
        await this.plugin.refresh();
        const prepared = await this.plugin.prepare(file, meta);
        preview.createEl('h3', { text: 'Exactly what will be published' });
        preview.createEl('p', { text: 'Private properties and comments are removed. Only the text below and these images will be uploaded.' });
        for (const warning of prepared.warnings) preview.createEl('p', { text: warning, cls: 'naman-publish-warning' });
        preview.createEl('pre', { text: prepared.markdown, cls: 'naman-publish-preview' });
        for (const image of prepared.images) {
          const url = URL.createObjectURL(new Blob([image.bytes], {type:'image/webp'})); this.urls.push(url);
          preview.createEl('img', { attr: {src:url, alt:'Image to publish'}, cls:'naman-publish-image' });
        }
        new Setting(preview).addButton(publish => publish.setButtonText('Publish now').setCta().onClick(async () => {
          publish.setDisabled(true);
          try {
            // Publish the reviewed snapshot; later edits are sent only after live sync is enabled.
            await this.plugin.publish(file, prepared, live);
            new Notice(`Published: ${this.plugin.data.site}/blog/${meta.slug}`);
            this.index++;
            if (this.index < this.files.length) await this.show(); else this.close();
          } catch (error) { this.plugin.failure(file, error); publish.setDisabled(false); }
        }));
      } catch (error) { preview.createEl('p', { text: error instanceof Error ? error.message : 'Could not prepare this note.', cls:'naman-publish-error' }); }
      finally { button.setDisabled(false); }
    }));
    actions.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()));
  }
}

class PublishPanel extends Modal {
  selected = new Set<TFile>();
  constructor(app: App, private plugin: NamanPublish) { super(app); }
  async onOpen() {
    const el = this.contentEl; el.empty(); el.addClass('naman-publish-modal');
    el.createEl('h2', { text: 'Publish to naman.world' });
    const message = el.createEl('p', {text:'Loading published notes…'});
    try { await this.plugin.refresh(); message.remove(); }
    catch (error) { message.setText(error instanceof Error ? error.message : 'Could not connect.'); }
    el.createEl('h3', { text: 'Published notes' });
    for (const post of this.plugin.remote.filter(p => p.published)) {
      const saved = this.plugin.data.posts[post.id];
      const file = saved && this.app.vault.getAbstractFileByPath(saved.path);
      const row = new Setting(el).setName(post.title).setDesc(saved?.status || `/blog/${post.slug}`);
      row.addButton(b => b.setButtonText('Open').onClick(() => window.open(`${this.plugin.data.site}/blog/${post.slug}`)));
      row.addButton(b => b.setButtonText('Copy link').onClick(() => { void navigator.clipboard.writeText(`${this.plugin.data.site}/blog/${post.slug}`); new Notice('Link copied'); }));
      if (file instanceof TFile) {
        row.addToggle(t => t.setTooltip('Live sync').setValue(this.plugin.frontmatter(file).blog_live === true).onChange(async enabled => {
          await this.app.fileManager.processFrontMatter(file, fm => {fm.blog_live = enabled;});
          if (enabled) this.plugin.schedule(file);
        }));
        if (saved.revision !== post.revision) row.addButton(b => b.setButtonText('Review conflict').onClick(() => {
          const confirm = new Modal(this.app);
          confirm.contentEl.createEl('h2', {text:'Use the latest saved revision?'});
          confirm.contentEl.createEl('p', {text:'The website changed elsewhere. This lets your next reviewed publication replace that version with this local note.'});
          new Setting(confirm.contentEl).addButton(button => button.setButtonText('Review local note').onClick(async () => {
            saved.approved = false; saved.revision = post.revision; saved.hash = ''; await this.plugin.saveData(this.plugin.data); confirm.close(); new PublishModal(this.app,this.plugin,[file]).open();
          })); confirm.open();
        }));
      }
      row.addButton(b => b.setButtonText('Unpublish').onClick(() => {
        const confirm = new Modal(this.app);
        confirm.contentEl.createEl('h2', {text:`Unpublish ${post.title}?`});
        confirm.contentEl.createEl('p', {text:'This removes the live post and access to its unshared images. Your note stays in Obsidian.'});
        new Setting(confirm.contentEl).addButton(button => button.setButtonText('Unpublish').setWarning().onClick(async () => {
          try { await this.plugin.unpublish(post.id); confirm.close(); await this.onOpen(); }
          catch (error) { new Notice(error instanceof Error ? error.message : 'Could not unpublish.'); }
        })); confirm.open();
      }));
    }
    el.createEl('h3', {text:'Select notes'});
    const search = el.createEl('input', {type:'search', attr:{placeholder:'Find a note', 'aria-label':'Find a note'}});
    const notes = el.createDiv({cls:'naman-publish-notes'});
    const draw = () => {
      notes.empty();
      const files = this.app.vault.getMarkdownFiles().filter(f => f.path.toLowerCase().includes(search.value.toLowerCase())).sort((a,b) => a.basename.localeCompare(b.basename));
      for (const file of files.slice(0,60)) new Setting(notes).setName(file.basename).addToggle(t => t.setValue(this.selected.has(file)).onChange(value => {if (value) this.selected.add(file); else this.selected.delete(file);}));
      if (files.length > 60) notes.createEl('p', {text:'Search to narrow the list.'});
    };
    search.addEventListener('input', draw); draw();
    new Setting(el).addButton(b => b.setButtonText('Review selected notes').setCta().onClick(() => {
      if (!this.selected.size) {new Notice('Select at least one note.'); return;}
      this.close(); new PublishModal(this.app, this.plugin, [...this.selected]).open();
    }));
  }
}

class PublishSettings extends PluginSettingTab {
  constructor(app: App, private publisher: NamanPublish) { super(app, publisher); }
  display() {
    const el = this.containerEl; el.empty();
    el.createEl('h2', {text:'Naman Publish'});
    new Setting(el).setName('Website').setDesc('HTTPS origin; localhost is allowed for development.').addText(t => t.setValue(this.publisher.data.site).onChange(async value => {
      if (Object.keys(this.publisher.data.posts).length) { new Notice('This vault already has publications. Use a separate vault for another website.'); return; }
      this.publisher.data.site = value.replace(/\/$/, ''); await this.publisher.saveData(this.publisher.data);
    }));
    new Setting(el).setName('Publishing key').setDesc('Stored in Obsidian Secret Storage, separately from notes and plugin settings.').addText(t => {
      t.inputEl.type = 'password'; t.setPlaceholder(this.app.secretStorage.getSecret(this.publisher.data.secretId) ? 'Key configured' : 'Paste publishing key');
      t.onChange(value => this.app.secretStorage.setSecret(this.publisher.data.secretId, value.trim()));
    });
    new Setting(el).setName('Connection').addButton(b => b.setButtonText('Test connection').onClick(async () => {
      try {await this.publisher.refresh(); new Notice('Connected to the publishing API.');}
      catch (error) {new Notice(error instanceof Error ? error.message : 'Connection failed.');}
    }));
    el.createEl('p', {text:'Only notes you explicitly publish are synced. Local paths, private network links, and recognizable credentials block publishing. Properties and private comments are removed. Images are re-encoded before upload to remove metadata. Review the actual text and images before first publication.'});
  }
}
