import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutline } from '../src/lib/blog/outline.mjs';
import { prepareCatalogue } from '../src/lib/blog/catalogue.mjs';

test('catalogue preserves irregular heading levels without adding numbering or empty parents', () => {
  const { outline, flat } = buildOutline([
    { id: 'intro', level: 2, title: 'Introduction' },
    { id: 'a', level: 1, title: 'Algorithms' },
    { id: 'b', level: 3, title: 'BPE' },
    { id: 'c', level: 5, title: 'Merging' },
    { id: 'd', level: 2, title: 'Unigram' },
    { id: 'e', level: 1, title: 'Internals' },
  ]);
  assert.deepEqual(outline.map(entry => entry.id), ['intro', 'a', 'e']);
  assert.ok(flat.every(entry => !('number' in entry)));
  assert.deepEqual(flat.map(entry => entry.title), ['Introduction', 'Algorithms', 'BPE', 'Merging', 'Unigram', 'Internals']);
  assert.equal(outline[1].children[0].children[0].id, 'c');
});

test('catalogue preserves deep links, excludes notes and code, and gives raw headings collision-free IDs', () => {
  const html = '<div id="section-2"></div><h2 id="stable-link">A <code>code</code> heading<sup><a data-footnote-ref>1</a></sup></h2><h3>Raw &amp; safe</h3><aside class="blog-sidenote"><h2 id="note">A note heading</h2></aside><pre><code>&lt;h2&gt;code&lt;/h2&gt;</code></pre><h2 id="existing">Existing</h2>';
  const result = prepareCatalogue(html);
  assert.equal(result.outline[0].title, 'A code heading');
  assert.equal(result.outline[0].id, 'stable-link');
  assert.equal(result.outline[0].children[0].id, 'section-2-2');
  assert.equal(result.outline[0].children[0].title, 'Raw & safe');
  assert.equal(result.outline.length, 2);
  assert.match(result.html, /<h3 id="section-2-2">/);
  assert.deepEqual(prepareCatalogue(result.html), result);
});

test('articles without section headings need no catalogue and stay byte-identical', () => {
  const html = '<p>Just an essay.</p>';
  assert.deepEqual(prepareCatalogue(html), { html, outline: [] });
});


test('catalogue labels omit section-number prefixes while preserving meaningful numbers', () => {
  const { flat } = buildOutline([
    { id: 'one', level: 2, title: '1. Find substrings' },
    { id: 'two', level: 2, title: '2.1. DirectCache' },
    { id: 'three', level: 2, title: '2D layouts' },
    { id: 'four', level: 2, title: 'Version 3.14' },
  ]);
  assert.deepEqual(flat.map(entry => entry.title), ['Find substrings', 'DirectCache', '2D layouts', 'Version 3.14']);
});
