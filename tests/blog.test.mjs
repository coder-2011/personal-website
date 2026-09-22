import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stripPrivateContent, assertPublicText, publicUrl, validateMetadata } from '../src/lib/blog/privacy.mjs';
import { exportNote } from '../src/lib/blog/export.mjs';
import { renderPost } from '../src/lib/blog/render.mjs';
import { createBlogStore } from '../src/lib/blog/store.mjs';
import { publishingRequest } from '../src/lib/blog/api.mjs';

test('private properties and comments never reach exported Markdown, including unfinished comments', async () => {
  const result = await exportNote('---\nprivate: /Users/alice/secret\n---\n# Public\n\n%% api_key=private-secret-here %%\nVisible. <!-- private -->\n%% unfinished /home/alice');
  assert.equal(result.markdown, '# Public\n\nVisible.\n');
  assert.throws(() => stripPrivateContent('---\nunfinished'), /properties block/);
});

test('paths and credentials are blocked in prose, code, properties and encoded forms without echoing values', () => {
  for (const text of ['/Users/alice/file.md','C:\\Users\\alice\\file.md','\\\\server\\share','~/Documents/secret','file:///other/file','obsidian://open?vault=Private','/home/alice/.ssh','%252FUsers%252Falice%252Fsecret',String.raw`\u002fUsers\u002falice\u002fsecret`,'&#47;Users&#47;alice&#47;secret','http://localhost:3000','http://192.168.1.2','https://example.com/?token=secret','sk-proj-'+'a'.repeat(35),'-----BEGIN PRIVATE KEY-----']) {
    assert.throws(() => assertPublicText(text), error => !error.message.includes(text) && /remove the/.test(error.message), text);
  }
  assert.throws(() => publicUrl('http://2130706433/path'), /private network/);
  assert.throws(() => validateMetadata({id:randomUUID(),slug:'test',title:'/Users/alice',date:'2026-09-20'}));
  assert.doesNotThrow(() => assertPublicText('Read src/lib.rs and https://github.com/coder-2011.'));
});

test('wikilinks only resolve published targets, images get opaque paths, and code stays literal', async () => {
  const result = await exportNote('[[Public#A Heading|Read]] and [[Private/folder/Hidden|an idea]].\n\n![[diagram.png]]\n\n`[[not a link]]`', {
    resolveNote: async name => name === 'Public' ? '/blog/public' : null,
    asset: async name => { assert.equal(name,'diagram.png'); return '/api/blog/assets/'+'a'.repeat(64); },
  });
  assert.match(result.markdown, /\[Read\]\(\/blog\/public#a-heading\)/);
  assert.match(result.markdown, /an idea/);
  assert.doesNotMatch(result.markdown, /Private\/folder|diagram\.png/);
  assert.match(result.markdown, /`\[\[not a link\]\]`/);
  assert.equal(result.warnings.length,1);
});

test('reference links cannot bypass privacy checks and unsupported embeds are explicit errors', async () => {
  for (const markdown of ['[read][x]\n\n[x]: file:///Users/alice/x', '![[Private note]]', '```dataview\nLIST\n```', '[[unfinished', '<img src="file:///Users/alice/x">', '[x](javascript:alert%281%29)', '<iframe src="https://evil.example"></iframe>', '<script>alert(1)</script>']) {
    await assert.rejects(exportNote(markdown), undefined, markdown);
  }
  const result = await exportNote('[Read][public]\n\n[public]: https://example.com');
  assert.match(result.markdown, /https:\/\/example.com/);
});

test('rendering preserves math, tables, callouts, footnotes, highlighting and the public tokenizer iframe', async () => {
  const {html} = await renderPost('# Heading\n\n$x^2$\n\n> [!note] Remember\n> A detail.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\nFootnote[^1].\n\n[^1]: Details\n\n<iframe src="https://naman.world/embeds/unigram.html"></iframe>');
  for (const part of ['id="heading"','class="katex"','blog-callout','<table>','astro-code','blog-sidenote','sandbox="allow-scripts allow-forms"']) assert.ok(html.includes(part),part);
  await assert.rejects(renderPost('<a onclick="alert(1)">bad</a>'));
  const harmless = await renderPost('<div id="location"><strong>Safe</strong></div>');
  assert.doesNotMatch(harmless.html,/onclick|<script/);
});

function fixture() {
  const values = new Map();
  let counter = 0;
  const blobs = {
    async read(path) { const value = values.get(path); return value ? {...value} : null; },
    async write(path,text,etag) {
      const prior = values.get(path);
      if (prior && prior.etag !== etag) throw new Error('conflict');
      if (!prior && etag) throw new Error('conflict');
      values.set(path,{text,etag:String(++counter)});
    },
    conflict: error => error.message === 'conflict',
  };
  return {store:createBlogStore(blobs),values};
}
const postInput = (extra={}) => ({id:randomUUID(),slug:'test',title:'Test',date:'2026-09-20',description:'',markdown:'Public',html:'<p>Public</p>',assets:[],baseVersion:null,...extra});

test('publishing is immediately readable, retries are idempotent, and stale writes cannot overwrite', async () => {
  const {store} = fixture();
  const input = postInput();
  const first = await store.publish(input);
  assert.equal((await store.post('test')).html,'<p>Public</p>');
  assert.equal((await store.publish(input)).revision,first.revision);
  await assert.rejects(store.publish({...input,html:'bad'}),/changed elsewhere/);
  const next = await store.publish({...input,baseVersion:first.revision,html:'<p>Updated</p>'});
  assert.equal((await store.post('test')).html,'<p>Updated</p>');
  await assert.rejects(store.publish(postInput()),/belongs to another/);
  await assert.rejects(store.unpublish(input.id,first.revision),/changed elsewhere/);
  const removed = await store.unpublish(input.id,next.revision);
  assert.equal(await store.post('test'),null);
  assert.equal(await store.asset('a'.repeat(64)),null);
  await store.publish({...input,baseVersion:removed.revision});
  assert.ok(await store.post('test'));
});

test('concurrent posts preserve both index entries and same-post races report conflicts', async () => {
  const {store} = fixture();
  const a=postInput({slug:'a'}),b=postInput({slug:'b'});
  const [first] = await Promise.all([store.publish(a),store.publish(b)]);
  assert.equal((await store.list()).length,2);
  const outcomes = await Promise.allSettled([store.publish({...a,baseVersion:first.revision,html:'one'}),store.publish({...a,baseVersion:first.revision,html:'two'})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
});

test('publishing fails closed without a key and rejects unauthenticated requests before storage', async () => {
  const saved = process.env.BLOG_PUBLISH_TOKEN;
  try {
    delete process.env.BLOG_PUBLISH_TOKEN;
    assert.equal((await publishingRequest(new Request('https://naman.world/api/publish'))).status,503);
    process.env.BLOG_PUBLISH_TOKEN='x'.repeat(48);
    assert.equal((await publishingRequest(new Request('https://naman.world/api/publish'))).status,401);
  } finally { if (saved) process.env.BLOG_PUBLISH_TOKEN=saved; else delete process.env.BLOG_PUBLISH_TOKEN; }
});

test('unchanged polling checks the current index without reading the post body', async () => {
  const {store, values} = fixture();
  const input = postInput();
  const post = await store.publish(input);
  // A missing body proves the unchanged check did not fetch it; fresh reads still fail closed.
  for (const key of values.keys()) if (key.includes('/revisions/')) values.delete(key);
  assert.deepEqual(await store.post(input.slug, post.revision), {revision:post.revision});
  await assert.rejects(store.post(input.slug), /missing/);
  await store.unpublish(input.id,post.revision);
  assert.equal(await store.post(input.slug,post.revision),null);
});
