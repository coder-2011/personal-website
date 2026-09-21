import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { presentPost } from '../src/lib/blog/presentation.mjs';
import { renderPost } from '../src/lib/blog/render.mjs';

function elements(html, tag) {
  const result = [];
  function walk(node) {
    if (node.tagName === tag) result.push(node);
    for (const child of node.childNodes || []) walk(child);
  }
  walk(parseFragment(html));
  return result;
}
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');

test('adds language labels to legacy HTML while preserving exact code text and prose', () => {
  const html = '<p>Normal prose</p><pre><code><span>let x = &lt;value&gt;;</span>\n</code></pre><pre><code>same\n</code></pre><pre><code>same\n</code></pre>';
  const markdown = '```rust\nlet x = <value>;\n```\n\n```json\nsame\n```\n\n```\nsame\n```';
  const result = presentPost(html, markdown);
  assert.deepEqual(elements(result, 'code').map(text), elements(html, 'code').map(text));
  assert.deepEqual(elements(result, 'button').map(text), ['Copy', 'Copy', 'Copy']);
  assert.match(result, /<span>Rust<\/span>/);
  assert.match(result, /<span>JSON<\/span>/);
  assert.match(result, /<span>Plain text<\/span>/);
  assert.equal(text(elements(result, 'p')[0]), 'Normal prose');
  assert.equal(presentPost(result, markdown), result);
});

test('published HTML has controls after sanitizing, with math and lists unaffected', async () => {
  const markdown = '$x^2$\n\n- Counts are weighted by word frequency.\n- The **outer loop** depends on the prior merge.\n\n```python\nprint("<hello>")\n```\n\n```1,000,000 pieces\n1M\n```';
  const {html} = await renderPost(markdown);
  assert.match(html, /class="katex"/);
  assert.match(html, /<li>Counts are weighted by word frequency\.<\/li>/);
  assert.match(html, /<span>Python<\/span>/);
  assert.match(html, /<span>Plain text<\/span>/);
  assert.equal(elements(html, 'button').length, 2);
  assert.ok(elements(html, 'button').every(node => node.attrs.some(attr => attr.name === 'hidden')));
  assert.deepEqual(elements(html, 'code').map(text), ['print("<hello>")', '1M']);
});

test('fence labels cannot inject HTML into the code toolbar', () => {
  const html = '<pre><code>x</code></pre>';
  const result = presentPost(html, '```<img>\nx\n```');
  assert.equal(elements(result, 'img').length, 0);
  assert.match(result, /<span>Plain text<\/span>/);
});
