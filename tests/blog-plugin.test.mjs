import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';
import { build } from 'esbuild';

// Exercise the actual plugin and modal callbacks; only Obsidian's host APIs are replaced.
class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.text = options.text; this.children = []; this.classes = new Set(); this.attributes = {}; }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  create(text) { this.text = text; return this; }
  setText(text) { this.text = text; }
  empty() { this.children = []; }
  addClass(...names) { names.forEach(name => this.classes.add(name)); }
  removeClass(name) { this.classes.delete(name); }
  addEventListener() {}
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() {}
  *walk() { yield this; for (const child of this.children) yield* child.walk(); }
}
class Control {
  constructor(parent, tag) { this.inputEl = parent.createEl(tag); this.inputEl.control = this; this.buttonEl = this.inputEl; }
  setValue(value) { this.value = value; return this; }
  setButtonText(value) { this.inputEl.text = value; return this; }
  setDisabled(value) { this.disabled = value; return this; }
  setCta() { return this; }
  setTooltip() { return this; }
  onChange(fn) { this.change = fn; return this; }
  onClick(fn) { this.click = fn; return this; }
}
class Setting {
  constructor(parent) { this.settingEl = parent.createDiv(); this.controlEl = this.settingEl.createDiv(); }
  setName(value) { this.settingEl.name = value; return this; }
  setDesc() { return this; }
  setClass() { return this; }
  addText(fn) { fn(new Control(this.controlEl, 'input')); return this; }
  addTextArea(fn) { fn(new Control(this.controlEl, 'textarea')); return this; }
  addToggle(fn) { fn(new Control(this.controlEl, 'toggle')); return this; }
  addButton(fn) { fn(new Control(this.controlEl, 'button')); return this; }
}
class TFile {
  constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\.md$/, ''); this.extension = 'md'; }
}
class Plugin {
  constructor(app) { this.app = app; }
  async saveData(data) { this.persisted = JSON.parse(JSON.stringify(data)); }
}
class Modal {
  constructor(app) { this.app = app; this.contentEl = new Element(); this.modalEl = new Element(); }
  open() { this.app.openModal = this; this.onOpen(); }
  close() { this.onClose(); }
}
const output = await build({entryPoints:['obsidian-plugin/main.ts'], bundle:true, write:false, format:'cjs', platform:'node', external:['obsidian','css-tree']});
const module = {exports:{}};
const clock = { now: 100000, next: 0, timers: new Map() };
const hostWindow = {
  setInterval: () => 0,
  setTimeout: (callback, delay) => { const id = ++clock.next; clock.timers.set(id, {callback, at: clock.now + delay}); return id; },
  clearTimeout: id => clock.timers.delete(id),
};
async function advance(ms, ...plugins) {
  clock.now += ms;
  for (const [id, timer] of [...clock.timers]) if (timer.at <= clock.now) {
    clock.timers.delete(id); timer.callback();
  }
  await Promise.all(plugins.map(plugin => plugin.pump()));
}
vm.runInNewContext(output.outputFiles[0].text, {
  __filename: new URL('../obsidian-plugin/main.ts', import.meta.url).pathname, module, exports:module.exports, crypto:webcrypto, TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, URL, Blob, Error, window:hostWindow, Date:class extends Date { static now() { return clock.now; } },
  require(name) {
    if (name !== 'obsidian') return createRequire(import.meta.url)(name);
    return {Plugin, Modal, Setting, TFile, Notice:class {}, PluginSettingTab:class {},
      getFrontMatterInfo:() => ({exists:false}), parseYaml:() => ({})};
  },
});
const Publisher = module.exports.default;
const PublishModal = module.exports.PublishModal;
const PublishPanel = module.exports.PublishPanel;
function fixture(names = ['First.md', 'Second.md', 'Third.md']) {
  const files = names.map(name => new TFile(name));
  const sources = new Map(files.map(file => [file.path, `# ${file.basename}\n\nPublic writing.\n`]));
  const frontmatter = new Map();
  const app = {
    vault:{read:async file => sources.get(file.path), getAbstractFileByPath:path => files.find(f => f.path === path)},
    metadataCache:{getFileCache:file => ({frontmatter:frontmatter.get(file.path) || {}}), getFirstLinkpathDest:target => files.find(file => file.basename === target)},
    fileManager:{processFrontMatter:() => {throw new Error('Must not write to Markdown');}},
  };
  const plugin = new Publisher(app);
  plugin.data = {site:'https://naman.world', secretId:'test', posts:{}};
  plugin.status = new Element();
  plugin.refresh = async () => {};
  const requests = [];
  plugin.api = async (path, method, body) => {
    assert.equal(path, '');
    requests.push({method, body});
    return {post:{...body, revision:randomUUID(), published:method !== 'DELETE'}};
  };
  const modal = new PublishModal(app, plugin, files);
  return {app, plugin, modal, files, sources, frontmatter, requests};
}
function button(modal, text) {
  return [...modal.contentEl.walk()].find(el => el.tag === 'button' && el.text === text)?.control;
}
function field(modal, file, name) {
  const section = modal.contentEl.children.find(el => el.tag === 'section' && el.children[0].text === file.path);
  return [...section.children.find(el => el.name === name).walk()].find(el => el.control)?.control;
}

test('concurrent reviews of the same attachment do not inflate its cache size', async () => {
  const f = fixture(['Post.md']);
  const image = new TFile('diagram.svg');
  image.extension = 'svg'; image.stat = {size:100};
  f.files.push(image);
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
  f.app.vault.readBinary = async () => new TextEncoder().encode(source).buffer;
  f.sources.set('Post.md', '![[diagram.svg]]');
  const prepared = await Promise.all(Array.from({length:8}, () => f.plugin.prepare(f.files[0])));
  assert.equal(f.plugin.preparedImages.size, 1);
  assert.equal(f.plugin.preparedImageBytes, prepared[0].images[0].bytes.byteLength,
    'overlapping reviews retain one image, not eight images worth of cache budget');
});

test('text edits reuse prepared images and uploads, but changed bytes and sites do not', async () => {
  const f = fixture(['Post.md']);
  const image = new TFile('diagram.svg');
  image.extension = 'svg'; image.stat = {size:100};
  f.files.push(image);
  let source = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
  f.app.vault.readBinary = async () => new TextEncoder().encode(source).buffer;
  f.sources.set('Post.md','# First\n\n![[diagram.svg]]');
  const postApi = f.plugin.api;
  let uploads = 0;
  f.plugin.api = async (path, method, body) => {
    if (path !== '/assets') return postApi(path, method, body);
    uploads++;
    const id = Buffer.from(await webcrypto.subtle.digest('SHA-256',body)).toString('hex');
    return {url:`/api/blog/assets/${id}`};
  };
  const first = await f.plugin.prepare(f.files[0]);
  await f.plugin.publish(f.files[0],first,true);
  f.sources.set('Post.md','# Edited text\n\n![[diagram.svg]]');
  const second = await f.plugin.prepare(f.files[0]);
  assert.equal(second.images[0].bytes,first.images[0].bytes,'unchanged input avoids image conversion');
  await f.plugin.publish(f.files[0],second,true);
  assert.equal(uploads,1,'text-only edits upload no images');
  source = source.replaceAll('10','20');
  const changed = await f.plugin.prepare(f.files[0]);
  assert.notEqual(changed.images[0].placeholder,first.images[0].placeholder,'content changes are detected even with unchanged file stats');
  await f.plugin.publish(f.files[0],changed,true);
  assert.equal(uploads,2);
  f.plugin.data.site='https://another.example';
  f.sources.set('Post.md','# Another destination\n\n![[diagram.svg]]');
  await f.plugin.publish(f.files[0],await f.plugin.prepare(f.files[0]),true);
  assert.equal(uploads,3,'uploads are specific to the destination');
  source = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  await assert.rejects(f.plugin.prepare(f.files[0]),/unsupported or active/);
  assert.equal(uploads,3,'unsafe replacements never upload');
});

test('one batch publishes all selected notes with dialog metadata and leaves Markdown untouched', async () => {
  const f = fixture();
  const original = [...f.sources];
  f.modal.onOpen();
  field(f.modal, f.files[0], 'Title').change('Public headline');
  field(f.modal, f.files[0], 'Description').change('Entered in the dialog');
  field(f.modal, f.files[0], 'Date').change('2026-09-21');
  await button(f.modal, 'Review all notes').click();
  assert.equal(f.requests.length, 0, 'review must never upload');
  await button(f.modal, 'Publish all 3 notes').click();
  assert.equal(f.requests.length, 3);
  assert.equal(Object.keys(f.plugin.persisted.posts).length, 3);
  assert.equal(f.requests[0].body.title, 'Public headline');
  assert.deepEqual([...f.sources], original);
  const restarted = new Publisher(f.app);
  restarted.data = f.plugin.persisted;
  const metadata = restarted.metadata(f.files[0], {});
  assert.equal(metadata.title, 'Public headline');
  assert.equal(metadata.description, 'Entered in the dialog');
  assert.equal(metadata.date, '2026-09-21');
  assert.equal(metadata.id, f.requests[0].body.id);
  assert.equal(restarted.live(f.files[0]), true);
});

test('all notes pass preflight before publishing; duplicate URLs and unsafe notes block the whole batch', async () => {
  for (const duplicate of [true, false]) {
    const f = fixture(duplicate ? ['A/Same.md', 'B/Same.md'] : ['Safe.md', 'Unsafe.md']);
    if (!duplicate) f.sources.set('Unsafe.md', '/Users/alice/private.txt');
    f.modal.onOpen();
    await button(f.modal, 'Review all notes').click();
    assert.equal(f.requests.length, 0);
    assert.equal(button(f.modal, 'Publish all 2 notes'), undefined);
    assert.match([...f.modal.contentEl.walk()].map(el => el.text || '').join('\n'), duplicate ? /same URL/ : /local file path/);
  }
});

test('partial failures retain progress and retry only failed notes', async () => {
  const f = fixture();
  const realApi = f.plugin.api;
  const attempts = [];
  let fail = true;
  f.plugin.api = async (path, method, body) => {
    attempts.push(body.slug);
    if (body.slug === 'second' && fail) throw new Error('Temporary connection failure');
    return realApi(path, method, body);
  };
  f.modal.onOpen();
  await button(f.modal, 'Review all notes').click();
  await button(f.modal, 'Publish all 3 notes').click();
  assert.equal(Object.keys(f.plugin.persisted.posts).length, 2);
  fail = false;
  await button(f.modal, 'Review all notes').click();
  await button(f.modal, 'Publish now').click();
  assert.deepEqual(attempts, ['first', 'second', 'third', 'second']);
  assert.equal(Object.keys(f.plugin.persisted.posts).length, 3);
});

test('editing dialog metadata invalidates review; live updates keep saved metadata and note links', async () => {
  const f = fixture(['First.md', 'Second.md']);
  f.modal.onOpen();
  await button(f.modal, 'Review all notes').click();
  field(f.modal, f.files[0], 'Title').change('Changed title');
  assert.equal(button(f.modal, 'Publish all 2 notes'), undefined);
  await button(f.modal, 'Review all notes').click();
  await button(f.modal, 'Publish all 2 notes').click();
  const oldId = f.requests[0].body.id;
  f.files[0].path = 'Moved/First.md';
  f.plugin.data.posts[oldId].path = f.files[0].path; // Same update as the vault rename listener.
  f.sources.set(f.files[0].path, 'New content. [[Second]]');
  f.plugin.pending.add(f.files[0].path);
  await f.plugin.pump();
  assert.equal(f.requests.at(-1).body.id, oldId);
  assert.equal(f.requests.at(-1).body.title, 'Changed title');
  assert.match(f.requests.at(-1).body.markdown, /\/blog\/second/);
  await f.plugin.setLive(f.files[0], false);
  f.plugin.schedule(f.files[0]);
  assert.equal(f.plugin.pending.size, 0);
  await f.plugin.unpublish(oldId);
  assert.equal(f.plugin.data.posts[oldId].published, false);
  assert.equal(f.plugin.data.posts[oldId].live, false);
});

test('existing frontmatter remains a default until metadata is saved in the plugin', async () => {
  const f = fixture(['Legacy.md']);
  const id = randomUUID();
  f.frontmatter.set('Legacy.md', {blog_id:id, blog_title:'Old title', blog_date:'2026-01-01', blog_live:false});
  f.plugin.data.posts[id] = {path:'Legacy.md',slug:'legacy',revision:randomUUID(),hash:'old',assets:[],approved:true,status:'Published'};
  f.modal.onOpen();
  assert.equal(field(f.modal, f.files[0], 'Title').value, 'Old title');
  assert.equal(field(f.modal, f.files[0], 'Live sync').value, false);
  field(f.modal, f.files[0], 'Title').change('New title');
  await button(f.modal, 'Review publication').click();
  await button(f.modal, 'Publish now').click();
  assert.equal(f.plugin.metadata(f.files[0], f.frontmatter.get('Legacy.md')).title, 'New title');
  assert.equal(f.frontmatter.get('Legacy.md').blog_title, 'Old title');
  assert.equal(f.plugin.live(f.files[0]), false);
});

test('pausing live sync during an upload stays paused after it completes', async () => {
  const f = fixture(['First.md']);
  f.modal.onOpen();
  await button(f.modal, 'Review publication').click();
  await button(f.modal, 'Publish now').click();
  f.sources.set('First.md', 'Updated text');
  const prepared = await f.plugin.prepare(f.files[0]);
  const realApi = f.plugin.api;
  let release;
  f.plugin.api = async (...args) => {
    await new Promise(resolve => {release = resolve;});
    return realApi(...args);
  };
  const upload = f.plugin.publish(f.files[0], prepared, true, true);
  await f.plugin.setLive(f.files[0], false);
  release();
  await upload;
  assert.equal(f.plugin.live(f.files[0]), false);
});

test('unpublish uses the revision shown in the refreshed panel and stops later syncs', async () => {
  const f = fixture(['Disposable.md']);
  f.modal.onOpen();
  await button(f.modal, 'Review publication').click();
  await button(f.modal, 'Publish now').click();
  const id = f.requests[0].body.id;
  const remoteRevision = randomUUID();
  f.plugin.remote.find(post => post.id === id).revision = remoteRevision;
  const api = f.plugin.api;
  f.plugin.api = (path, method, body) => {
    if (method === 'DELETE') assert.equal(body.baseVersion, remoteRevision, 'use the refreshed post the user chose to unpublish');
    return api(path, method, body);
  };
  await f.plugin.unpublish(id);
  assert.equal(f.plugin.remote.find(post => post.id === id).published, false);
  assert.equal(f.plugin.persisted.posts[id].approved, false);
  assert.equal(f.plugin.persisted.posts[id].published, false);
  assert.equal(f.plugin.persisted.posts[id].live, false);
  const count = f.requests.length;
  f.sources.set('Disposable.md', 'An edit after unpublishing');
  f.plugin.schedule(f.files[0]);
  await f.plugin.pump();
  assert.equal(f.requests.length, count, 'editing an unpublished note must not republish it');
});

async function publishedFixture(live = true) {
  const f = fixture(['Manual.md']);
  f.modal.onOpen();
  field(f.modal, f.files[0], 'Live sync').change(live);
  await button(f.modal, 'Review publication').click();
  await button(f.modal, 'Publish now').click();
  f.panel = new PublishPanel(f.app, f.plugin);
  f.panel.drawPublished(f.panel.contentEl);
  return f;
}

test('Update appears immediately after turning live sync off and spins until completion', async () => {
  const f = await publishedFixture();
  assert.equal(button(f.panel, 'Update'), undefined);
  const toggle = () => [...f.panel.contentEl.walk()].find(el => el.tag === 'toggle').control;
  await toggle().change(false);
  assert.ok(button(f.panel, 'Update'));
  f.sources.set('Manual.md', 'Latest manually published text');
  const api = f.plugin.api;
  let release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  f.plugin.api = async (...args) => { arrived(); await new Promise(resolve => { release = resolve; }); return api(...args); };
  const updating = button(f.panel, 'Update').click();
  const spinner = button(f.panel, 'Updating…');
  assert.equal(spinner.disabled, true);
  assert.ok(spinner.buttonEl.classes.has('is-updating'));
  assert.equal(spinner.buttonEl.attributes['aria-busy'], 'true');
  assert.equal(toggle().disabled, true);
  await started;
  assert.equal(f.requests.length, 1, 'no completion before the server accepts the update');
  assert.equal(f.plugin.updatePost(f.files[0]), f.plugin.manualUpdates.get('Manual.md'), 'duplicate updates share the in-flight request');
  release(); await updating;
  assert.match(f.requests.at(-1).body.markdown, /Latest manually published text/);
  assert.equal(f.plugin.live(f.files[0]), false);
  assert.equal(button(f.panel, 'Updating…'), undefined);
  assert.equal(button(f.panel, 'Update').disabled, false);
  await toggle().change(true);
  assert.equal(button(f.panel, 'Update'), undefined);
  await f.plugin.pump();
});

test('manual update waits for an in-flight live upload, then uses its revision and the latest note', async () => {
  const f = await publishedFixture();
  const api = f.plugin.api;
  let release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  let hold = true;
  f.plugin.api = async (...args) => {
    if (hold) { hold = false; arrived(); await new Promise(resolve => { release = resolve; }); }
    return api(...args);
  };
  f.sources.set('Manual.md', 'Live upload text');
  f.plugin.schedule(f.files[0]); await started;
  await f.plugin.setLive(f.files[0], false);
  f.sources.set('Manual.md', 'Newer manual text');
  const updating = f.plugin.updatePost(f.files[0]);
  release(); await updating;
  assert.equal(f.requests.length, 3);
  assert.match(f.requests.at(-1).body.markdown, /Newer manual text/);
  assert.notEqual(f.requests.at(-1).body.baseVersion, f.requests[1].body.baseVersion);
  assert.equal(f.plugin.live(f.files[0]), false);
});

test('manual update failures stop the spinner, retain the prior publication, and can be retried', async () => {
  const f = await publishedFixture(false);
  const id = f.requests[0].body.id, revision = f.plugin.data.posts[id].revision;
  const api = f.plugin.api;
  f.sources.set('Manual.md', 'A changed note');
  f.plugin.api = async () => { throw new Error('Temporary connection failure'); };
  await button(f.panel, 'Update').click();
  assert.equal(f.plugin.data.posts[id].revision, revision);
  assert.equal(f.plugin.data.posts[id].published, true);
  assert.equal(button(f.panel, 'Updating…'), undefined);
  assert.equal(button(f.panel, 'Update').disabled, false);
  assert.match(f.plugin.data.posts[id].status, /Temporary connection failure/);
  f.plugin.api = api;
  f.sources.set('Manual.md', '/Users/alice/private.md');
  await button(f.panel, 'Update').click();
  assert.equal(f.requests.length, 1, 'manual updates must pass the same privacy checks');
  f.sources.set('Manual.md', 'Safe retry');
  await button(f.panel, 'Update').click();
  assert.equal(f.requests.length, 2);
  assert.equal(f.plugin.live(f.files[0]), false);
});

function editDetails(f) {
  button(f.panel, 'Edit details').click();
  return f.app.openModal;
}

function urlConfirmation(modal) {
  const setting = [...modal.contentEl.walk()].find(el => el.name === 'Confirm new URL');
  return setting && [...setting.walk()].find(el => el.control)?.control;
}

test('changing a published URL requires unlocking, review, and an exact typed confirmation', async () => {
  const f = await publishedFixture(false);
  const original = [...f.sources];
  const modal = editDetails(f);
  const url = field(modal,f.files[0],'URL');
  assert.equal(url.disabled,true);
  button(modal,'Change URL').click();
  assert.equal(url.disabled,false);
  url.change('better-url');
  await button(modal,'Review changes').click();
  const confirm = button(modal,'Change URL and update');
  assert.equal(confirm.disabled,true);
  await confirm.click();
  assert.equal(f.requests.length,1,'review or an unconfirmed click never renames');
  const text = [...modal.contentEl.walk()].map(el=>el.text||'').join(' ');
  assert.match(text,/Current: https:\/\/naman.world\/blog\/manual/);
  assert.match(text,/New: https:\/\/naman.world\/blog\/better-url/);
  urlConfirmation(modal).change('wrong-url');
  assert.equal(confirm.disabled,true);
  urlConfirmation(modal).change('better-url');
  assert.equal(confirm.disabled,false);
  await confirm.click();
  assert.equal(f.requests.at(-1).body.previousSlug,'manual');
  assert.equal(f.requests.at(-1).body.slug,'better-url');
  assert.equal(f.plugin.savedPost(f.files[0])[1].slug,'better-url');
  assert.equal(f.plugin.live(f.files[0]),false);
  assert.deepEqual([...f.sources],original);
  const next = await f.plugin.prepare(f.files[0]);
  assert.equal(next.meta.previousSlug,undefined,'rename approval is never reused by live saves');
  assert.equal(next.hash,f.plugin.savedPost(f.files[0])[1].hash,'confirmation does not force an extra live publication');
});

test('URL confirmation resets after edits and cancelling leaves the public URL unchanged', async () => {
  const f = await publishedFixture();
  const modal = editDetails(f);
  button(modal,'Change URL').click();
  field(modal,f.files[0],'URL').change('first-choice');
  await button(modal,'Review changes').click();
  urlConfirmation(modal).change('first-choice');
  field(modal,f.files[0],'URL').change('second-choice');
  assert.equal(button(modal,'Change URL and update'),undefined);
  await button(modal,'Review changes').click();
  assert.equal(button(modal,'Change URL and update').disabled,true);
  button(modal,'Cancel').click();
  assert.equal(f.requests.length,1);
  assert.equal(f.plugin.savedPost(f.files[0])[1].slug,'manual');
});

test('an unpublished note can choose a different URL when deliberately republished', async () => {
  const f = await publishedFixture(false);
  await f.plugin.unpublish(f.requests[0].body.id);
  const modal = new PublishModal(f.app,f.plugin,[f.files[0]]); modal.onOpen();
  button(modal,'Change URL').click();
  field(modal,f.files[0],'URL').change('republished-note');
  await button(modal,'Review publication').click();
  assert.equal(button(modal,'Publish now').disabled,true);
  urlConfirmation(modal).change('republished-note');
  await button(modal,'Publish now').click();
  assert.equal(f.requests.at(-1).body.previousSlug,'manual');
  assert.equal(f.plugin.savedPost(f.files[0])[1].slug,'republished-note');
  assert.equal(f.plugin.published(f.files[0]),true);
  assert.equal(f.plugin.live(f.files[0]),false);
});

test('a batch waits for every changed URL to be confirmed before publishing any note', async () => {
  const f = fixture(['First.md','Second.md']);
  f.modal.onOpen();
  await button(f.modal,'Review all notes').click();
  await button(f.modal,'Publish all 2 notes').click();
  const modal = new PublishModal(f.app,f.plugin,f.files);modal.onOpen();
  const unlocks = [...modal.contentEl.walk()].filter(el=>el.tag==='button' && el.text==='Change URL').map(el=>el.control);
  unlocks.forEach(control=>control.click());
  field(modal,f.files[0],'URL').change('first-renamed');
  field(modal,f.files[1],'URL').change('second-renamed');
  await button(modal,'Review all notes').click();
  const confirmations = [...modal.contentEl.walk()].filter(el=>el.name==='Confirm new URL').map(el=>[...el.walk()].find(el=>el.control).control);
  confirmations[0].change('first-renamed');
  assert.equal(button(modal,'Publish all 2 notes').disabled,true);
  await button(modal,'Publish all 2 notes').click();
  assert.equal(f.requests.length,2);
  confirmations[1].change('second-renamed');
  assert.equal(button(modal,'Publish all 2 notes').disabled,false);
  await button(modal,'Publish all 2 notes').click();
  assert.equal(f.requests.length,4);
  assert.deepEqual(f.requests.slice(2).map(({body})=>body.previousSlug),['first','second']);
});

test('Edit details updates every public field, keeps URL and paused sync, and persists on reopen', async () => {
  const f = await publishedFixture(false);
  const original = [...f.sources];
  const modal = editDetails(f);
  assert.equal(field(modal, f.files[0], 'Title').value, 'Manual');
  assert.equal(field(modal, f.files[0], 'URL').disabled, true);
  field(modal, f.files[0], 'Title').change('Updated public title');
  field(modal, f.files[0], 'Date').change('2026-08-12');
  field(modal, f.files[0], 'Description').change('Updated public summary');
  await button(modal, 'Review changes').click();
  assert.equal(f.requests.length, 1, 'review does not publish edits');
  const api = f.plugin.api;
  let release, arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  f.plugin.api = async (...args) => { arrived(); await new Promise(resolve => {release = resolve;}); return api(...args); };
  const saving = button(modal, 'Update post').click(); await started;
  const spinner = button(modal, 'Updating…');
  assert.equal(spinner.disabled, true);
  assert.ok(spinner.buttonEl.classes.has('is-updating'));
  assert.equal(modal.closed, false, 'stay open until the server accepts the update');
  release(); await saving;
  assert.equal(modal.closed, true);
  const body = f.requests.at(-1).body;
  assert.equal(body.title, 'Updated public title');
  assert.equal(body.date, '2026-08-12');
  assert.equal(body.description, 'Updated public summary');
  assert.equal(body.slug, 'manual');
  assert.equal(body.id, f.requests[0].body.id);
  assert.equal(f.plugin.live(f.files[0]), false);
  assert.deepEqual([...f.sources], original);
  f.plugin.data = f.plugin.persisted;
  f.panel.drawPublished(f.panel.contentEl);
  const reopened = editDetails(f);
  assert.equal(field(reopened, f.files[0], 'Title').value, body.title);
  assert.equal(field(reopened, f.files[0], 'Date').value, body.date);
  assert.equal(field(reopened, f.files[0], 'Description').value, body.description);
  field(reopened, f.files[0], 'Description').change('');
  await button(reopened, 'Review changes').click();
  f.plugin.api = api;
  await button(reopened, 'Update post').click();
  assert.equal(f.plugin.metadata(f.files[0], {}).description, '', 'description can be cleared');
});

test('Edit details handles live updates before and after review without replacing a newer revision', async () => {
  const f = await publishedFixture();
  const modal = editDetails(f);
  field(modal, f.files[0], 'Title').change('Edited title');
  f.sources.set('Manual.md', 'Edit while the details form is open');
  f.plugin.schedule(f.files[0]); await f.plugin.pump();
  await button(modal, 'Review changes').click();
  f.sources.set('Manual.md', 'Another edit after reviewing');
  f.plugin.schedule(f.files[0]); await f.plugin.pump();
  const count = f.requests.length;
  await button(modal, 'Update post').click();
  assert.equal(f.requests.length, count, 'stale review must not upload');
  assert.equal(modal.closed, false);
  assert.match([...modal.contentEl.walk()].map(el => el.text || '').join(' '), /changed while you were reviewing/);
  await button(modal, 'Review changes').click();
  await button(modal, 'Update post').click();
  await f.plugin.pump();
  assert.equal(f.requests.at(-1).body.title, 'Edited title', 'draft survives conflict and later sync');
  assert.match(f.requests.at(-1).body.markdown, /Another edit after reviewing/);
  assert.equal(f.plugin.live(f.files[0]), true);
});

test('Edit details cancel, invalid metadata, and network failure keep the published details intact', async () => {
  const f = await publishedFixture(false);
  let modal = editDetails(f);
  field(modal, f.files[0], 'Title').change('Never saved');
  await button(modal, 'Cancel').click();
  assert.equal(f.plugin.metadata(f.files[0], {}).title, 'Manual');
  f.panel.drawPublished(f.panel.contentEl);
  modal = editDetails(f);
  for (const [name, value] of [['Title', '/Users/alice/private.txt'], ['Date', '2026-02-30'], ['Description', 'x'.repeat(501)]]) {
    const input = field(modal, f.files[0], name);
    input.change(value);
    await button(modal, 'Review changes').click();
    assert.equal(button(modal, 'Update post'), undefined);
    input.change(input.value);
  }
  assert.equal(f.requests.length, 1);
  field(modal, f.files[0], 'Title').change('Retry title');
  await button(modal, 'Review changes').click();
  const api = f.plugin.api;
  f.plugin.api = async () => {throw new Error('Temporary connection failure');};
  await button(modal, 'Update post').click();
  assert.equal(modal.closed, false);
  assert.equal(f.plugin.metadata(f.files[0], {}).title, 'Manual');
  assert.equal(button(modal, 'Updating…'), undefined);
  assert.equal(button(modal, 'Review changes').disabled, false);
  f.plugin.api = api;
  await button(modal, 'Review changes').click();
  await button(modal, 'Update post').click();
  assert.equal(f.plugin.metadata(f.files[0], {}).title, 'Retry title');
});

test('live edits during a details upload wait and retain the newly saved metadata', async () => {
  const f = await publishedFixture();
  const modal = editDetails(f);
  field(modal, f.files[0], 'Title').change('New public title');
  await button(modal, 'Review changes').click();
  const api = f.plugin.api;
  let release, arrived, hold = true, calls = 0;
  const started = new Promise(resolve => { arrived = resolve; });
  f.plugin.api = async (...args) => {
    calls++;
    if (hold) { hold = false; arrived(); await new Promise(resolve => {release = resolve;}); }
    return api(...args);
  };
  const saving = button(modal, 'Update post').click(); await started;
  f.sources.set('Manual.md', 'Text edited while details are uploading');
  f.plugin.schedule(f.files[0]); await f.plugin.pump();
  assert.equal(calls, 1, 'live sync cannot race the details upload');
  release(); await saving; await f.plugin.pump();
  assert.equal(calls, 2);
  assert.equal(f.requests.at(-1).body.title, 'New public title');
  assert.match(f.requests.at(-1).body.markdown, /Text edited while details are uploading/);
  assert.equal(f.plugin.live(f.files[0]), true);
});


test('folders and mixed selections fail before reading notes or uploading anything', async () => {
  const f = fixture(['Safe.md']);
  let reads = 0;
  f.app.vault.read = async () => {reads++; throw new Error('Must not read a folder');};
  const folder = {path:'Private.md', name:'Private.md', extension:'md', children:[f.files[0]]};
  const attachment = new TFile('picture.png'); attachment.extension = 'png';
  for (const invalid of [folder, attachment]) {
    for (const files of [[invalid], [f.files[0], invalid]]) {
      const modal = new PublishModal(f.app, f.plugin, files);
      modal.onOpen();
      assert.equal(button(modal, 'Review publication'), undefined);
      assert.equal(button(modal, 'Review all notes'), undefined);
      assert.match([...modal.contentEl.walk()].map(el => el.text || '').join(' '), /Folders cannot be published/);
    }
    await assert.rejects(f.plugin.prepare(invalid), /Folders cannot be published/);
    await assert.rejects(f.plugin.publish(invalid, {}, false), /Folders cannot be published/);
    f.plugin.schedule(invalid);
  }
  assert.equal(reads, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.plugin.pending.size, 0);
});

test('context menus offer publishing only for selections entirely made of Markdown files', async () => {
  const f = fixture(['First.md', 'Second.md']);
  const events = new Map(), commands = [];
  f.app.workspace = {on:(name, callback) => {events.set(name, callback);}, onLayoutReady:() => {}, getActiveFile:() => folder};
  f.app.metadataCache.on = () => {};
  f.app.vault.on = () => {};
  f.plugin.loadData = async () => f.plugin.data;
  f.plugin.addStatusBarItem = () => new Element();
  f.plugin.addCommand = command => commands.push(command);
  for (const method of ['registerEvent', 'addRibbonIcon', 'addSettingTab', 'registerDomEvent', 'registerInterval']) f.plugin[method] = () => {};
  const folder = {path:'Folder.md', name:'Folder.md', children:f.files};
  await f.plugin.onload();
  const items = [];
  const menu = {addItem:configure => {
    const item = {setTitle() {return this;}, setIcon() {return this;}, onClick(callback) {items.push(callback); return this;}};
    configure(item);
  }};
  events.get('file-menu')(menu, folder);
  events.get('files-menu')(menu, [folder]);
  events.get('files-menu')(menu, [f.files[0], folder]);
  events.get('files-menu')(menu, []);
  assert.equal(items.length, 0);
  assert.equal(commands.find(c => c.id === 'publish-note').checkCallback(true), false);
  events.get('file-menu')(menu, f.files[0]);
  events.get('files-menu')(menu, f.files);
  assert.equal(items.length, 2, 'individual notes and explicit note-only batches still work');
  items[1]();
  assert.ok(button(f.app.openModal, 'Review all notes'));
});

test('typing and saves restart the idle wait; catch-up cannot bypass it or extend it', async () => {
  const f = await publishedFixture();
  const events = new Map();
  for (const [name, host] of [['workspace', f.app.workspace = {}], ['metadata', f.app.metadataCache], ['vault', f.app.vault]]) {
    host.on = (event, callback) => events.set(`${name}:${event}`, callback);
  }
  f.app.workspace.onLayoutReady = () => {};
  f.app.secretStorage = {getSecret:() => 'test'};
  f.plugin.loadData = async () => f.plugin.data;
  f.plugin.addStatusBarItem = () => new Element();
  for (const method of ['addCommand', 'registerEvent', 'addRibbonIcon', 'addSettingTab', 'registerDomEvent', 'registerInterval']) f.plugin[method] = () => {};
  await f.plugin.onload();
  const file = f.files[0];
  events.get('workspace:editor-change')({}, {file});
  await f.plugin.pump();
  await advance(1500, f.plugin);
  f.sources.set(file.path, 'Still typing');
  events.get('vault:modify')(file);
  events.get('metadata:changed')(file);
  await f.plugin.catchUp(); await f.plugin.pump();
  await advance(1999, f.plugin);
  assert.equal(f.requests.length, 1, 'nothing sent while typing or before two idle seconds');
  await f.plugin.catchUp(); await f.plugin.pump();
  await advance(1, f.plugin);
  assert.equal(f.requests.length, 2, 'send immediately at the idle deadline, without a polling delay');
  assert.match(f.requests.at(-1).body.markdown, /Still typing/);
  await advance(5000, f.plugin);
  assert.equal(f.requests.length, 2, 'coalesce all editor, save and cache events into one update');
  f.plugin.onunload();
});

test('typing during preparation discards the old snapshot even if preparation outlasts the idle delay', async () => {
  const f = await publishedFixture(), file = f.files[0];
  const prepare = f.plugin.prepare.bind(f.plugin);
  let release, arrived;
  const started = new Promise(resolve => {arrived = resolve;});
  f.plugin.prepare = async (...args) => {
    const prepared = await prepare(...args);
    arrived(); await new Promise(resolve => {release = resolve;});
    return prepared;
  };
  f.sources.set(file.path, 'Old snapshot');
  f.plugin.schedule(file);
  await started;
  f.sources.set(file.path, 'Newest snapshot'); f.plugin.noteChanged(file);
  clock.now += 2000;
  f.plugin.prepare = prepare;
  release(); await f.plugin.pump();
  assert.equal(f.requests.length, 2, 'publish only the replacement, never the stale prepared snapshot');
  assert.match(f.requests.at(-1).body.markdown, /Newest snapshot/);
  f.plugin.onunload();
});

test('typing during an image upload prevents the article POST until idle again', async () => {
  const f = await publishedFixture(), file = f.files[0];
  const api = f.plugin.api;
  let release, arrived;
  const started = new Promise(resolve => {arrived = resolve;});
  f.plugin.api = async (path, ...args) => {
    if (path !== '/assets') return api(path, ...args);
    arrived(); await new Promise(resolve => {release = resolve;});
    return {url:`/api/blog/assets/${'a'.repeat(64)}`};
  };
  f.sources.set(file.path, 'Before typing resumes');
  const prepared = await f.plugin.prepare(file);
  prepared.images.push({bytes:new ArrayBuffer(0),type:'image/svg+xml',placeholder:'placeholder',path:'test.svg'});
  const uploading = f.plugin.publish(file, prepared, true, true);
  await started;
  f.sources.set(file.path, 'After typing resumes'); f.plugin.noteChanged(file);
  release(); await uploading; await f.plugin.pump();
  assert.equal(f.requests.length, 1);
  await advance(2000, f.plugin);
  assert.equal(f.requests.length, 2);
  assert.match(f.requests.at(-1).body.markdown, /After typing resumes/);
  f.plugin.onunload();
});

test('an actively edited note does not delay another idle note', async () => {
  const f = fixture();
  f.modal.onOpen();
  await button(f.modal, 'Review all notes').click();
  await button(f.modal, 'Publish all 3 notes').click();
  for (const file of f.files) f.sources.set(file.path, `Updated ${file.basename}`);
  f.plugin.noteChanged(f.files[0]);
  f.plugin.schedule(f.files[1]);
  await f.plugin.pump();
  assert.equal(f.requests.length, 4);
  assert.equal(f.requests.at(-1).body.slug, 'second');
  await advance(2000, f.plugin);
  assert.equal(f.requests.length, 5);
  assert.equal(f.requests.at(-1).body.slug, 'first');
  f.plugin.onunload();
});

test('pausing cancels queued automatic updates but manual Update still sends immediately', async () => {
  const f = await publishedFixture(), file = f.files[0];
  f.sources.set(file.path, 'Explicit manual update');
  f.plugin.noteChanged(file); await f.plugin.pump();
  await f.plugin.setLive(file, false);
  await f.plugin.updatePost(file);
  assert.equal(f.requests.length, 2);
  await advance(2000, f.plugin);
  assert.equal(f.requests.length, 2);
  f.sources.set(file.path, 'Reenabled while typing');
  f.plugin.noteChanged(file);
  await f.plugin.setLive(file, true); await f.plugin.pump();
  assert.equal(f.requests.length, 2);
  await advance(2000, f.plugin);
  assert.equal(f.requests.length, 3);
  f.sources.set(file.path, 'Must not send after unload');
  f.plugin.noteChanged(file); await f.plugin.pump();
  f.plugin.onunload();
  await advance(2000, f.plugin);
  assert.equal(f.requests.length, 3);
  assert.equal(clock.timers.size, 0);
});

test('edits during an already-sent request wait for idle and use the accepted revision', async () => {
  const f = await publishedFixture(), file = f.files[0];
  const api = f.plugin.api;
  let release, arrived;
  const started = new Promise(resolve => {arrived = resolve;});
  f.plugin.api = async (...args) => {arrived(); await new Promise(resolve => {release = resolve;}); return api(...args);};
  f.sources.set(file.path, 'Already sent'); f.plugin.schedule(file);
  await started;
  f.sources.set(file.path, 'Still editing'); f.plugin.noteChanged(file);
  f.plugin.api = api;
  release(); await f.plugin.pump();
  assert.equal(f.requests.length, 2);
  const acceptedRevision = f.plugin.savedPost(file)[1].revision;
  await advance(1999, f.plugin);
  assert.equal(f.requests.length, 2);
  await advance(1, f.plugin);
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests.at(-1).body.baseVersion, acceptedRevision);
  assert.match(f.requests.at(-1).body.markdown, /Still editing/);
  f.plugin.onunload();
});

test('background catch-up checks unchanged notes without any storage requests', async () => {
  const f = await publishedFixture();
  f.app.secretStorage = {getSecret:() => 'test'};
  f.plugin.refresh = () => {throw new Error('Periodic catch-up must not read remote storage');};
  for (let i=0; i<10; i++) { await f.plugin.catchUp(); await f.plugin.pump(); }
  assert.equal(f.requests.length, 1);
  f.sources.set(f.files[0].path, 'Retry this changed note');
  await f.plugin.catchUp(); await f.plugin.pump();
  assert.equal(f.requests.length, 2, 'unsent local changes still retry');
  f.plugin.onunload();
});
