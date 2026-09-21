import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment } from 'parse5';
import { separateTableParagraphs } from '../src/lib/blog/tables.mjs';
import { exportNote } from '../src/lib/blog/export.mjs';
import { renderPost } from '../src/lib/blog/render.mjs';
import { presentPost } from '../src/lib/blog/presentation.mjs';

const table = '| Piece | Count |\n| --- | ---: |\n| `ana` | 2 |';
test('ends a multi-column table before unseparated prose, preserving math and wording', async () => {
  const source = `${table}\nLonger substrings rank higher.\nThe score is $c \\times n$.`;
  const fixed = separateTableParagraphs(source);
  assert.equal(fixed, `${table}\n\nLonger substrings rank higher.\nThe score is $c \\times n$.`);
  assert.equal(separateTableParagraphs(fixed), fixed);
  const exported = await exportNote(source);
  const {html} = await renderPost(exported.markdown);
  assert.match(html, /<td align="right">2<\/td>/);
  assert.match(html, /<\/table><\/div>\s*<p>Longer substrings rank higher\./);
  assert.match(html, /class="katex"/);
});

test('preserves explicit sparse rows, one-column tables, fenced code and HTML', () => {
  for (const source of [
    `${table}\n| An intentionally empty count | |`,
    '| Value |\n| --- |\nno pipes needed',
    `\`\`\`md\n${table}\nExample text\n\`\`\``,
    '<table><tr><td>Value</td><td>2</td></tr></table>\nText',
  ]) assert.equal(separateTableParagraphs(source), source);
});

test('keeps a table and following prose inside their blockquote', async () => {
  const source = `${table}\nFollowing prose.`.split('\n').map(line => `> ${line}`).join('\n');
  const {html} = await renderPost(source);
  assert.match(html, /<blockquote>[\s\S]*<table>[\s\S]*<\/table><\/div>\s*<p>Following prose\.<\/p>\s*<\/blockquote>/);
});

test('wraps table-only and already-decorated posts without changing captions, spans or alignment', () => {
  const html = '<div style="display:flex;gap:2rem;flex-wrap:wrap"><table><caption>BASE &amp; CHECK</caption><tr><th colspan="2">Header</th></tr><tr><td rowspan="2" align="right">12</td><td><code>a | b</code></td></tr><tr><td>3</td></tr></table><table><tr><td>Other table</td></tr></table></div>';
  const result = presentPost(html, '');
  assert.equal((result.match(/class="blog-table-scroll"/g) || []).length, 2);
  assert.match(result, /aria-label="BASE &amp; CHECK"/);
  assert.match(result, /<caption>BASE &amp; CHECK<\/caption>/);
  assert.match(result, /colspan="2"/);
  assert.match(result, /rowspan="2" align="right"/);
  assert.equal(presentPost(result, ''), result);
  const withCode = '<div class="blog-code-block"><pre><code>x</code></pre></div>' + html;
  const decorated = presentPost(withCode, '');
  assert.equal((decorated.match(/class="blog-code-block"/g) || []).length, 1);
  assert.equal((decorated.match(/class="blog-table-scroll"/g) || []).length, 2);
  assert.ok(parseFragment(decorated));
});
