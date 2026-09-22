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

test('footnotes become adjacent notes with stable IDs, repeat references and rich content', async () => {
  const markdown = 'First[^alpha] and second[^beta].\n\nAgain[^alpha].\n\n| Cell |\n| --- |\n| Table reference[^table] |\n\n[^alpha]: A **bold** note with $x^2$.\n\n    A second paragraph with [a link](https://example.com).\n\n[^beta]: Another note.\n\n[^table]: A table note.';
  const {html} = await renderPost(markdown);
  const tree = parseFragment(html);
  const blocks = tree.childNodes.filter(node => node.tagName);
  assert.deepEqual(blocks.map(node => node.tagName), ['p', 'aside', 'aside', 'p', 'div', 'aside']);
  const notes = elements(html, 'aside');
  assert.equal(notes.length, 3);
  assert.equal(elements(html, 'strong').map(text).join(), 'bold');
  assert.match(html, /class="katex"/);
  assert.match(html, /A second paragraph/);
  assert.ok(!html.includes('data-footnotes='));
  assert.ok(!html.includes('aria-describedby="footnote-label"'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'no cloned IDs');
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(target), `target ${target} exists`);
  assert.equal(elements(html, 'a').filter(node => node.attrs.some(attr => attr.name === 'data-footnote-backref')).length, 4);
  assert.equal(presentPost(html, markdown), html, 'already-published presentation is unchanged');
});

test('legacy footnote-only HTML gets notes without code or table decoration', () => {
  const html = '<p>Text<sup><a href="#fn-a" id="ref-a" data-footnote-ref aria-describedby="footnote-label">1</a></sup>.</p><section data-footnotes="" class="footnotes"><h2 id="footnote-label">Footnotes</h2><ol><li id="fn-a"><p>The note <a href="#ref-a" data-footnote-backref>↩</a></p></li></ol></section>';
  const result = presentPost(html, '');
  assert.match(result, /<aside class="blog-sidenote"/);
  assert.match(result, /aria-label="Footnote 1"/);
  assert.ok(!result.includes('<section'));
  assert.equal(presentPost(result, ''), result);
});
