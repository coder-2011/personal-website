import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';
import { build } from 'esbuild';

// Exercise the actual plugin and modal callbacks; only Obsidian's host APIs are replaced.
class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.text = options.text; this.children = []; }
  createEl(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div', options); }
  createSpan(options) { return this.createEl('span', options); }
  create(text) { this.text = text; return this; }
  setText(text) { this.text = text; }
  empty() { this.children = []; }
  addClass() {}
  removeClass() {}
  setAttribute() {}
  *walk() { yield this; for (const child of this.children) yield* child.walk(); }
}
class Control {
  constructor(parent, tag) { this.inputEl = parent.createEl(tag); this.inputEl.control = this; }
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
  close() { this.onClose(); }
}
const output = await build({entryPoints:['obsidian-plugin/main.ts'], bundle:true, write:false, format:'cjs', platform:'node', external:['obsidian','css-tree']});
const module = {exports:{}};
vm.runInNewContext(output.outputFiles[0].text, {
  __filename: new URL('../obsidian-plugin/main.ts', import.meta.url).pathname, module, exports:module.exports, crypto:webcrypto, TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, URL, Blob,
  require(name) {
    if (name !== 'obsidian') return createRequire(import.meta.url)(name);
    return {Plugin, Modal, Setting, TFile, Notice:class {}, PluginSettingTab:class {},
      getFrontMatterInfo:() => ({exists:false}), parseYaml:() => ({})};
  },
});
const Publisher = module.exports.default;
const PublishModal = module.exports.PublishModal;
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
  await button(f.modal, 'Retry 1 remaining').click();
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
