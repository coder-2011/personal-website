import test from 'node:test';
import assert from 'node:assert/strict';
import { readingSummary, prepareReading } from '../src/lib/blog/reading.mjs';
import { prepareCatalogue } from '../src/lib/blog/catalogue.mjs';

test('shared article parsing preserves the catalogue and reading count', () => {
  const html='<h2>A title</h2><p>Some <em>text</em>.</p><pre><code>const x = 1;</code></pre><span class="katex">duplicate math</span>';
  const prepared=prepareReading(html);
  assert.deepEqual(prepared,{...prepareCatalogue(html),readingSummary:readingSummary(html)});
});

test('reading summary counts formatted article text without merging blocks or splitting styled words', () => {
  assert.equal(readingSummary('<h2>Hello <em>world</em></h2><p>A token<span>izer</span> &amp; café.</p><table><tr><td>one</td><td>two</td></tr></table>'), '7 words · 1 min read');
  assert.equal(readingSummary('<pre><code><span>load</span><span>_file</span>()</code></pre>'), '1 word · 1 min read');
});

test('reading summary excludes UI, hidden content, markers and duplicated math but includes footnote prose', () => {
  const html = '<p>Read this<a data-footnote-ref>1</a>.</p><div class="blog-code-header">Python<button>Copy</button></div><aside class="blog-sidenote"><a class="blog-sidenote-number">1</a><p>A note<a data-footnote-backref>Back</a>.</p></aside><span class="katex"><span>formula</span><span aria-hidden="true">formula</span></span><p hidden>Hidden text</p><iframe>Fallback</iframe><!-- comment -->';
  assert.equal(readingSummary(html), '4 words · 1 min read');
});

test('reading time rounds up at 200 words per minute and formats word counts', () => {
  assert.equal(readingSummary(''), '0 words · 1 min read');
  assert.equal(readingSummary('word '.repeat(200)), '200 words · 1 min read');
  assert.equal(readingSummary('word '.repeat(201)), '201 words · 2 min read');
  assert.equal(readingSummary('word '.repeat(1201)), '1,201 words · 7 min read');
});
