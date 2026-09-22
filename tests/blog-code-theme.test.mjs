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

test('new posts use the Ukiyo palette for keywords, variables, values and comments', async () => {
  const { html } = await renderPost('```rust\nlet count = 42; // a comment\n```');
  assert.match(html, /astro-code obsidian-ukiyo/);
  assert.match(html, /background-color:#2b2723;color:#ccc2b7/i);
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
