import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, parseYaml, getFrontMatterInfo } from 'obsidian';
import { sanitizeSvg } from '../src/lib/blog/svg.mjs';
import { exportNote } from '../src/lib/blog/export.mjs';
import { validateMetadata, assertPublicText } from '../src/lib/blog/privacy.mjs';

type Post = { id: string; slug: string; title: string; date: string; description: string; revision: string; published: boolean; updated: string };
type Saved = { path: string; revision: string | null; slug: string; hash: string; assets: string[]; status: string; approved: boolean; metadata?: { title: string; date: string; description: string }; live?: boolean; published?: boolean };
type Data = { site: string; secretId: string; posts: Record<string, Saved> };
type Metadata = { id: string; slug: string; title: string; date: string; description: string; baseVersion: string | null };
type Image = { path: string; bytes: ArrayBuffer; type: string; placeholder: string };
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
  savedPost(file: TFile) { return Object.entries(this.data.posts).find(([, post]) => post.path === file.path); }
  live(file: TFile) { return this.savedPost(file)?.[1].live ?? (this.frontmatter(file).blog_live !== false); }
  published(file: TFile) { return this.savedPost(file)?.[1].published ?? (this.frontmatter(file).publish !== false); }
  async setLive(file: TFile, enabled: boolean) {
    const saved = this.savedPost(file)?.[1];
    if (!saved) return;
    saved.live = enabled;
    await this.saveData(this.data);
    if (enabled) this.schedule(file);
  }
  metadata(file: TFile, fm: Record<string, unknown>): Metadata {
    const id = this.savedPost(file)?.[0] || (typeof fm.blog_id === 'string' ? fm.blog_id : crypto.randomUUID());
    const saved = this.data.posts[id];
    if (saved && saved.path !== file.path) throw new Error('This note copies another published note’s blog_id. Remove blog_id from this copy before publishing it separately.');
    return { id, slug: saved?.slug || String(fm.blog_slug || slugify(file.basename)), title: saved?.metadata?.title ?? String(fm.blog_title || file.basename), date: saved?.metadata?.date ?? String(fm.blog_date || day()), description: saved?.metadata?.description ?? String(fm.blog_description || ''), baseVersion: saved?.revision || null };
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
        const id = this.savedPost(note)?.[0] || this.frontmatter(note).blog_id;
        const entry = this.remote.find(p => p.id === id && p.published);
        return entry ? `/blog/${entry.slug}` : null;
      },
      asset: async (path: string) => {
        assertPublicText(path, 'Image reference');
        if (path.split('/').some(s => s.startsWith('.')) || path.includes('\\')) throw new Error('Images must be visible files inside the vault.');
        const image = this.app.metadataCache.getFirstLinkpathDest(path, file.path);
        if (!image || !['png','jpg','jpeg','webp','svg'].includes(image.extension.toLowerCase())) throw new Error('An embedded image is missing or unsupported.');
        if (image.stat.size > 3_500_000) throw new Error('Keep each image below 3.5 MB.');
        if (imageByPath.has(image.path)) return imageByPath.get(image.path)!;
        const input = await this.app.vault.readBinary(image);
        let bytes: ArrayBuffer;
        const type = image.extension.toLowerCase() === 'svg' ? 'image/svg+xml' : 'image/webp';
        if (type === 'image/svg+xml') {
          bytes = new TextEncoder().encode(sanitizeSvg(new TextDecoder('utf-8', {fatal:true}).decode(input))).buffer;
        } else {
          const bitmap = await createImageBitmap(new Blob([input]));
          if (bitmap.width * bitmap.height > 25_000_000) { bitmap.close(); throw new Error('Keep images below 25 megapixels.'); }
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0); bitmap.close();
          // Re-encoding before upload strips EXIF, GPS, and original filenames locally.
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not prepare image.')), 'image/webp', .92));
          bytes = await blob.arrayBuffer();
        }
        if (bytes.byteLength > 3_500_000) throw new Error('The prepared image exceeds 3.5 MB.');
        const placeholder = `/api/blog/assets/${await hash(bytes)}`;
        images.push({ path: image.path, bytes, type, placeholder });
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
      if (!automated) await this.setLive(file, live);
      this.setStatus('Up to date'); return;
    }
    this.setStatus('Publishing…');
    let markdown = prepared.markdown;
    // All text checks and all image preparation have succeeded before the first upload.
    for (const image of prepared.images) {
      const uploaded = await this.api('/assets', 'POST', image.bytes, image.type);
      markdown = markdown.split(image.placeholder).join(uploaded.url);
    }
    if (this.stopped) return;
    if (automated && (!this.live(file) || !this.published(file))) return;
    const result = await this.api('', 'POST', { ...prepared.meta, markdown });
    this.remote = this.remote.filter(p => p.id !== result.post.id).concat(result.post);
    this.data.posts[prepared.meta.id] = { path: file.path, revision: result.post.revision, slug: result.post.slug, hash: prepared.hash, assets: prepared.images.map(i => i.path), status: `Published ${new Date().toLocaleTimeString()}`, approved: true, metadata: { title: prepared.meta.title, date: prepared.meta.date, description: prepared.meta.description }, live: automated ? this.live(file) : live, published: true };
    await this.saveData(this.data);
    this.setStatus('Published');
  }
  schedule(file: TFile) {
    const saved = this.savedPost(file)?.[1];
    if (!saved?.approved || (this.published(file) && !this.live(file))) return;
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
        const entry = this.savedPost(file);
        if (!entry?.[1].approved) continue;
        try {
          if (!this.published(file)) await this.unpublish(entry[0]);
          else if (this.live(file)) {
            const prepared = await this.prepare(file);
            await this.publish(file, prepared, true, true);
          }
        } catch (error) { this.failure(file, error); }
      }
    } finally { this.running = false; }
  }
  failure(file: TFile, error: unknown) {
    const message = error instanceof Error ? error.message : 'Publication failed.';
    const saved = this.savedPost(file)?.[1];
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
      local.published = false; local.live = false;
      await this.saveData(this.data);
    }
    this.setStatus('Unpublished');
  }
}

export class PublishModal extends Modal {
  urls: string[] = [];
  closed = false;
  constructor(app: App, private plugin: NamanPublish, private files: TFile[]) { super(app); this.modalEl.addClass('naman-publish-dialog'); }
  onClose() { this.closed = true; this.clearImages(); this.contentEl.empty(); }
  clearImages() { this.urls.forEach(URL.revokeObjectURL); this.urls = []; }
  onOpen() {
    this.closed = false;
    const el = this.contentEl; el.empty(); el.addClass('naman-publish-modal');
    el.createEl('h2', {text: this.files.length > 1 ? `Publish ${this.files.length} notes` : 'Publish to naman.world'});
    el.createEl('p', {text:'Enter the public information here. It is saved in the plugin, not written into your notes.', cls:'naman-publish-muted'});
    const drafts: { file: TFile; meta: Metadata; live: boolean; section: HTMLElement; status: HTMLElement; done: boolean }[] = [];
    for (const file of this.files) {
      const section = el.createEl('section', {cls:'naman-publish-draft'});
      section.createEl('h3', {text:file.path});
      const status = section.createEl('p', {attr:{role:'status'}, cls:'naman-publish-muted'});
      try { drafts.push({file, meta:this.plugin.metadata(file, this.plugin.frontmatter(file)), live:this.plugin.live(file), section, status, done:false}); }
      catch (error) { status.setText(error instanceof Error ? error.message : 'Could not prepare this note.'); status.addClass('naman-publish-error'); }
    }
    // A malformed selection must not silently publish only a subset.
    if (drafts.length !== this.files.length) return;
    const preview = el.createDiv();
    let reviewed: { draft: typeof drafts[number]; prepared: Prepared; live: boolean }[] = [];
    const invalidate = () => { reviewed = []; preview.empty(); this.clearImages(); };
    for (const draft of drafts) {
      const {meta, section} = draft;
      new Setting(section).setName('Title').addText(input => input.setValue(meta.title).onChange(value => {meta.title = value; invalidate();}));
      new Setting(section).setName('URL').setDesc(`${this.plugin.data.site}/blog/`).addText(input => {
        input.setValue(meta.slug).setDisabled(!!this.plugin.data.posts[meta.id]?.revision).onChange(value => {meta.slug = value; invalidate();});
      });
      new Setting(section).setName('Date').addText(input => {input.inputEl.type = 'date'; input.setValue(meta.date).onChange(value => {meta.date = value; invalidate();});});
      new Setting(section).setName('Description').addTextArea(input => input.setValue(meta.description).onChange(value => {meta.description = value; invalidate();}));
      new Setting(section).setName('Live sync').setDesc('Saved edits go live while Obsidian is open.').addToggle(toggle => toggle.setValue(draft.live).onChange(value => {draft.live = value; invalidate();}));
    }
    const actions = new Setting(el).setClass('naman-publish-footer');
    const setBusy = (busy: boolean) => {
      for (const draft of drafts) {
        draft.section.inert = busy || draft.done;
        draft.section.setAttribute('aria-busy', String(busy && !draft.done));
      }
      actions.settingEl.inert = busy;
    };
    actions.addButton(button => button.setButtonText(this.files.length > 1 ? 'Review all notes' : 'Review publication').setCta().onClick(async () => {
      invalidate(); setBusy(true);
      try {
        await this.plugin.refresh();
        const pending = drafts.filter(draft => !draft.done);
        const slugs = new Set<string>();
        const ids = new Set<string>();
        for (const draft of drafts) {
          if (slugs.has(draft.meta.slug)) throw new Error('Two selected notes have the same URL. Give each note a different URL.');
          if (ids.has(draft.meta.id)) throw new Error('Two selected notes share a post identifier. Remove the copied blog_id before publishing.');
          if (this.plugin.remote.some(post => post.slug === draft.meta.slug && post.id !== draft.meta.id)) throw new Error(`The URL “${draft.meta.slug}” already belongs to another post.`);
          slugs.add(draft.meta.slug); ids.add(draft.meta.id);
        }
        const preparedNotes: typeof reviewed = [];
        // Validate every note and image before enabling any publication in this batch.
        for (const draft of pending) {
          if (this.closed) return;
          draft.status.setText('Preparing review…');
          try {
            const prepared = await this.plugin.prepare(draft.file, {...draft.meta});
            preparedNotes.push({draft, prepared, live:draft.live});
            draft.status.setText('Ready for review');
          } catch (error) { draft.status.setText('Needs attention'); throw error; }
        }
        if (this.closed) return;
        reviewed = preparedNotes;
        preview.createEl('h3', {text:'Exactly what will be published'});
        preview.createEl('p', {text:'Private properties and comments are removed. Review each note and its images before publishing.'});
        for (const {draft, prepared} of reviewed) {
          preview.createEl('h4', {text:prepared.meta.title});
          preview.createEl('p', {text:`/blog/${prepared.meta.slug}`, cls:'naman-publish-muted'});
          for (const warning of prepared.warnings) preview.createEl('p', {text:warning, cls:'naman-publish-warning'});
          preview.createEl('pre', {text:prepared.markdown, cls:'naman-publish-preview'});
          for (const image of prepared.images) {
            const url = URL.createObjectURL(new Blob([image.bytes], {type:image.type})); this.urls.push(url);
            preview.createEl('img', {attr:{src:url, alt:`Image for ${draft.meta.title}`}, cls:'naman-publish-image'});
          }
        }
        const result = preview.createEl('p', {attr:{role:'status'}});
        new Setting(preview).addButton(publish => publish.setButtonText(reviewed.length > 1 ? `Publish all ${reviewed.length} notes` : 'Publish now').setCta().onClick(async () => {
          publish.setDisabled(true); setBusy(true);
          for (const {draft, prepared, live} of reviewed) {
            if (this.closed) break;
            if (draft.done) continue;
            draft.status.setText('Publishing…');
            try {
              await this.plugin.publish(draft.file, prepared, live);
              draft.done = true; draft.status.setText('Published');
            } catch (error) {
              draft.status.setText(error instanceof Error ? error.message : 'Publication failed.');
              this.plugin.failure(draft.file, error);
            }
          }
          const remaining = drafts.filter(draft => !draft.done).length;
          const summary = `Published ${drafts.length - remaining} of ${drafts.length} notes.`;
          result.setText(remaining ? `${summary} Retry the remaining notes below.` : summary);
          new Notice(summary);
          if (!remaining) this.close();
          else { publish.setButtonText(`Retry ${remaining} remaining`).setDisabled(false); setBusy(false); }
        }));
      } catch (error) {
        if (!this.closed) preview.createEl('p', {text:error instanceof Error ? error.message : 'Could not prepare these notes.', cls:'naman-publish-error'});
      } finally { setBusy(false); }
    }));
    actions.addButton(button => button.setButtonText('Cancel').onClick(() => this.close()));
  }
}

class PublishPanel extends Modal {
  selected = new Set<TFile>();
  generation = 0;
  constructor(app: App, private plugin: NamanPublish) { super(app); this.modalEl.addClass('naman-publish-dialog'); }
  onClose() { this.generation++; this.contentEl.empty(); }
  onOpen() {
    const generation = ++this.generation;
    const el = this.contentEl; el.empty(); el.addClass('naman-publish-modal');
    el.createEl('h2', { text: 'Publish to naman.world' });
    const heading = new Setting(el).setName('Published notes').setHeading();
    const message = el.createEl('p', {cls:'naman-publish-muted', attr:{role:'status'}});
    const published = el.createDiv({cls:'naman-publish-posts'});
    heading.addButton(button => {
      const refresh = async () => {
        button.setDisabled(true); message.setText('Loading published notes…');
        message.removeClass('naman-publish-error');
        try {
          await this.plugin.refresh();
          if (generation !== this.generation) return;
          message.setText(this.plugin.remote.some(p => p.published) ? '' : 'No published notes yet. Select a note below to get started.');
          this.drawPublished(published);
        } catch (error) {
          if (generation !== this.generation) return;
          message.setText(`${error instanceof Error ? error.message : 'Could not connect.'} Published notes below may be out of date.`);
          message.addClass('naman-publish-error');
        } finally { button.setDisabled(false); }
      };
      button.setButtonText('Refresh').onClick(refresh);
      void refresh();
    });
    this.drawPublished(published);
    el.createEl('h3', {text:'Select notes'});
    const search = el.createEl('input', {cls:'naman-publish-search', type:'search', attr:{placeholder:'Find a note by name or folder', 'aria-label':'Find a note'}});
    const notes = el.createDiv({cls:'naman-publish-notes'});
    const footer = new Setting(el).setClass('naman-publish-footer');
    const files = this.app.vault.getMarkdownFiles().sort((a,b) => a.path.localeCompare(b.path));
    for (const file of this.selected) if (!files.includes(file)) this.selected.delete(file);
    footer.addButton(review => {
      const updateSelection = () => {
        footer.setName(`${this.selected.size} ${this.selected.size === 1 ? 'note' : 'notes'} selected`);
        review.setDisabled(!this.selected.size);
      };
      const draw = () => {
        notes.empty();
        const matches = files.filter(f => f.path.toLowerCase().includes(search.value.trim().toLowerCase()));
        for (const file of matches.slice(0,60)) {
          const label = notes.createEl('label', {cls:'naman-publish-note'});
          const checkbox = label.createEl('input', {type:'checkbox'});
          checkbox.checked = this.selected.has(file);
          const text = label.createDiv();
          text.createDiv({text:file.basename});
          text.createDiv({text:file.path, cls:'naman-publish-muted'});
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) this.selected.add(file); else this.selected.delete(file);
            updateSelection();
          });
        }
        if (!matches.length) notes.createEl('p', {text:'No matching notes.', cls:'naman-publish-muted'});
        if (matches.length > 60) notes.createEl('p', {text:`Showing 60 of ${matches.length} notes. Search to narrow the list.`, cls:'naman-publish-muted'});
      };
      search.addEventListener('input', draw);
      review.setButtonText('Review selected notes').setCta().onClick(() => {
        if (!this.selected.size) return;
        this.close(); new PublishModal(this.app, this.plugin, [...this.selected]).open();
      });
      footer.addButton(clear => clear.setButtonText('Clear selection').onClick(() => {
        this.selected.clear(); draw(); updateSelection();
      }));
      draw(); updateSelection();
    });
  }
  drawPublished(el: HTMLElement) {
    el.empty();
    for (const post of this.plugin.remote.filter(p => p.published)) {
      const saved = this.plugin.data.posts[post.id];
      const file = saved && this.app.vault.getAbstractFileByPath(saved.path);
      const row = new Setting(el).setClass('naman-publish-post').setName(post.title).setDesc(`/blog/${post.slug}${saved?.status ? ` · ${saved.status}` : ''}`);
      row.addButton(b => b.setButtonText('Open').onClick(() => window.open(`${this.plugin.data.site}/blog/${post.slug}`)));
      row.addButton(b => b.setButtonText('Copy link').onClick(async () => {
        try { await navigator.clipboard.writeText(`${this.plugin.data.site}/blog/${post.slug}`); new Notice('Link copied'); }
        catch { new Notice('Could not copy the link.'); }
      }));
      if (file instanceof TFile) {
        row.addButton(b => b.setButtonText('Edit details').onClick(() => {
          this.close(); new PublishModal(this.app, this.plugin, [file]).open();
        }));
        row.controlEl.createSpan({text:'Live sync', cls:'naman-publish-muted'});
        row.addToggle(t => t.setTooltip('Live sync').setValue(this.plugin.live(file)).onChange(enabled => this.plugin.setLive(file, enabled)));
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
