import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {enableFootnoteSelection} from '../src/scripts/blog-sidenotes.mjs';

function fixture(t, {highlights = true} = {}) {
  const dom = new JSDOM(`<article id="body">
    <p id="first">First passage<sup><a data-footnote-ref href="#note-one">1</a></sup> and repeated<sup><a data-footnote-ref href="#note-one">1</a></sup>.</p>
    <aside class="blog-sidenote" id="note-one"><a class="blog-sidenote-number">1</a><p>A <strong>bold</strong> note.</p><p>Another paragraph.<a data-footnote-backref>↩</a></p></aside>
    <p id="second">Second passage<sup><a data-footnote-ref href="#note%2Dtwo">2</a></sup>.</p>
    <aside class="blog-sidenote" id="note-two"><a class="blog-sidenote-number">2</a><p>Second note.<a data-footnote-backref>↩</a></p></aside>
    <input id="input" value="Private input">
  </article>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document, body = doc.getElementById('body');
  const registry = new Map();
  if (highlights) dom.window.CSS = {highlights:registry};
  // Highlight accepts separate Range arguments; keep those real DOM ranges for assertions.
  if (highlights) dom.window.Highlight = class extends Set {constructor(...ranges) {super(ranges);}};
  const notes = [...body.querySelectorAll('.blog-sidenote')];
  const cleanup = enableFootnoteSelection(body, notes);
  const selection = doc.getSelection();
  const change = range => {
    selection.removeAllRanges(); if (range) selection.addRange(range);
    doc.dispatchEvent(new dom.window.Event('selectionchange'));
  };
  const select = element => { const range = doc.createRange(); range.selectNodeContents(element); change(range); return range; };
  const copy = (target = body) => {
    const data = new Map(); const event = new dom.window.Event('copy', {bubbles:true, cancelable:true});
    Object.defineProperty(event, 'clipboardData', {value:{setData:(type, text) => data.set(type, text)}});
    target.dispatchEvent(event); return {data, prevented:event.defaultPrevented};
  };
  return {doc, body, notes, registry, selection, change, select, copy, cleanup, window:dom.window};
}

test('selecting a passage includes referenced note text while preserving the native passage selection', t => {
  const f = fixture(t); const p = f.doc.getElementById('first');
  const range = f.select(p);
  assert.equal(f.selection.getRangeAt(0), range, 'selection is never moved or extended across intervening paragraphs');
  assert.equal(f.selection.toString(), 'First passage1 and repeated1.');
  const highlighted = [...f.registry.get('footnote-selection')];
  assert.equal(highlighted.length, 1, 'repeated references include the note once');
  assert.equal(highlighted[0].toString(), 'A bold note.Another paragraph.');
  const {data, prevented} = f.copy();
  assert.equal(prevented, true);
  assert.equal(data.get('text/plain'), 'First passage1 and repeated1.\n\n[1] A bold note.\n\nAnother paragraph.');
  assert.match(data.get('text/html'), /<strong>bold<\/strong>/);
  assert.doesNotMatch(data.get('text/html'), /data-footnote-backref|blog-sidenote-number|↩/);
  f.cleanup();
});

test('selecting only a marker includes its note and deselecting clears the additional selection', t => {
  const f = fixture(t); const reference = f.body.querySelector('[data-footnote-ref]');
  f.select(reference);
  assert.equal(f.registry.get('footnote-selection').size, 1);
  assert.match(f.copy().data.get('text/plain'), /^1\n\n\[1\] A bold note/);
  f.change(null); assert.equal(f.registry.size, 0);
  assert.equal(f.copy().prevented, false);
  f.cleanup();
});

test('selection boundaries touching a marker without selecting its text do not include the note', t => {
  const f = fixture(t), p = f.doc.getElementById('first'), reference = p.querySelector('[data-footnote-ref]');
  const range = f.doc.createRange(); range.setStart(p.firstChild, 0); range.setEnd(reference.firstChild, 0);
  f.change(range); assert.equal(f.registry.size, 0); assert.equal(f.copy().prevented, false);
  range.setEnd(reference.firstChild, 1); f.change(range); assert.equal(f.registry.size, 1);
  f.cleanup();
});

test('copying multiple references includes complete notes once even when notes are already inside the range', t => {
  const f = fixture(t); f.select(f.body);
  assert.equal(f.registry.get('footnote-selection').size, 2);
  const text = f.copy().data.get('text/plain');
  for (const phrase of ['A bold note.', 'Another paragraph.', 'Second note.']) assert.equal(text.split(phrase).length - 1, 1);
  assert.ok(text.includes('[1] A bold note.') && text.includes('[2] Second note.'));
  f.cleanup();
});

test('hover, keyboard focus, and copying form fields do not select or copy footnotes', t => {
  const f = fixture(t), reference = f.body.querySelector('[data-footnote-ref]');
  reference.dispatchEvent(new f.window.MouseEvent('pointerover', {bubbles:true}));
  reference.dispatchEvent(new f.window.FocusEvent('focusin', {bubbles:true}));
  assert.equal(f.registry.size, 0);
  f.select(reference);
  assert.equal(f.copy(f.doc.getElementById('input')).prevented, false);
  f.cleanup();
});

test('cleanup removes selection and copy handlers before live replacement', t => {
  const f = fixture(t); f.select(f.doc.getElementById('first')); f.cleanup();
  assert.equal(f.registry.size, 0);
  f.select(f.doc.getElementById('second')); assert.equal(f.registry.size, 0);
  assert.equal(f.copy().prevented, false);
  const cleanup = enableFootnoteSelection(f.body, f.notes);
  assert.equal(f.registry.get('footnote-selection').size, 1);
  assert.match(f.copy().data.get('text/plain'), /\[2\] Second note/);
  cleanup();
});

test('older browsers retain selection indication and copy support without the Highlight API', t => {
  const f = fixture(t, {highlights:false}); f.select(f.doc.getElementById('second'));
  assert.ok(f.notes[1].classList.contains('is-selected'));
  assert.match(f.copy().data.get('text/plain'), /\[2\] Second note/);
  f.change(null); assert.ok(!f.notes[1].classList.contains('is-selected'));
  f.cleanup();
});
