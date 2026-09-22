import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { renderPost } from '../src/lib/blog/render.mjs';
import { presentPostForReading } from '../src/lib/blog/code-upgrade.mjs';
import { presentPost } from '../src/lib/blog/presentation.mjs';

const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
function find(html, tag) {
  const matches = [];
  function walk(node) { if (node.tagName === tag) matches.push(node); (node.childNodes || []).forEach(walk); }
  walk(parseFragment(html));
  return matches;
}

test('new posts default to light code and include the Ukiyo dark palette for the site toggle', async () => {
  const { html } = await renderPost('```rust\nlet count = 42; // a comment\n```');
  assert.match(html, /obsidian-ukiyo-light obsidian-ukiyo/);
  assert.match(html, /background-color:#eee7e0;--shiki-dark-bg:#2b2723;color:#383832;--shiki-dark:#ccc2b7/i);
  for (const color of ['#bf206d', '#009e9b', '#5f38d6', '#746e66']) assert.ok(html.toLowerCase().includes(`color:${color}`));
  for (const color of ['#fa99cd', '#53dfdd', '#a882ff', '#868074']) assert.ok(html.toLowerCase().includes(color));
  assert.doesNotMatch(html, /github-dark/);
  assert.equal(await presentPostForReading(html, ''), html);
});

test('plain-text fences have copy controls without a language label', async () => {
  const { html } = await renderPost('```\nPlain text stays in the code\n```\n\n```plaintext\nx\n```\n\n```text\ny\n```');
  assert.equal(find(html, 'button').length, 3);
  assert.deepEqual(find(html, 'code').map(text), ['Plain text stays in the code', 'x', 'y']);
  assert.doesNotMatch(html, /blog-code-header"><span>/);
});

test('legacy upgrades are cached and preserve exact copied text, labels and existing presentation', async () => {
  const html = '<p>Unchanged prose.</p><div class="blog-code-block"><div class="blog-code-header"><span>Rust</span><button class="blog-code-copy">Copy</button></div><pre class="astro-code github-dark"><code>let count = 42;\n</code></pre></div><div class="blog-code-block"><div class="blog-code-header"><span>Plain text</span><button class="blog-code-copy">Copy</button></div><pre class="astro-code github-dark"><code>Plain text &lt;tag&gt;\n\n</code></pre></div><aside class="blog-sidenote" id="note">A note.</aside>';
  const first = presentPostForReading(html, '');
  assert.equal(presentPostForReading(html, ''), first, 'concurrent and repeated reads reuse the same work');
  const result = await first;
  assert.deepEqual(find(result, 'code').map(text), find(html, 'code').map(text));
  assert.equal(find(result, 'button').length, 2);
  assert.equal(find(result, 'aside').length, 1);
  assert.match(result, /<span>Rust<\/span>/);
  assert.doesNotMatch(result, /<span>Plain text<\/span>|github-dark/);
  assert.equal(presentPost(result, ''), result);
});

test('already-published dark-only Ukiyo blocks gain both themes without altering code or prose', async () => {
  const old = '<p>Keep this prose.</p><div class="blog-code-block"><div class="blog-code-header"><span>Python</span><button class="blog-code-copy">Copy</button></div><pre class="astro-code obsidian-ukiyo" style="background-color:#2b2723;color:#ccc2b7"><code><span style="color:#fa99cd">print</span>("hello")\n</code></pre></div>';
  const result = await presentPostForReading(old, '');
  assert.match(result, /background-color:#eee7e0;--shiki-dark-bg:#2b2723/);
  assert.match(result, /<p>Keep this prose.<\/p>/);
  assert.deepEqual(find(result, 'code').map(text), find(old, 'code').map(text));
  assert.equal(find(result, 'button').length, 1);
  assert.equal(await presentPostForReading(result, ''), result, 'current blocks bypass the legacy highlighter');
});
