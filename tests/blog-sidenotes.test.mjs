import test from 'node:test';
import assert from 'node:assert/strict';
import {enableSidenotes} from '../src/scripts/blog-sidenotes.mjs';

function fixture(t) {
  const notes = ['note-one', 'note-two'].map(id => {
    const classes = new Set();
    return {id, classes, style:{}, classList:{
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
    }};
  });
  const body = new EventTarget();
  body.dataset = {}; body.style = {};
  body.querySelectorAll = () => notes;
  body.contains = node => node.body === body;
  const window = new EventTarget();
  window.matchMedia = () => ({matches:false});
  const saved = new Map();
  for (const [key, value] of Object.entries({window, document:{fonts:new EventTarget()},
    ResizeObserver:class {observe() {} disconnect() {}}, cancelAnimationFrame() {}})) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable:true, value});
  }
  t.after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const reference = href => ({body, closest() { return this; }, getAttribute() { return href; }});
  const fire = (type, target, relatedTarget = null) => {
    const event = new Event(type);
    Object.defineProperties(event, {target:{value:target}, relatedTarget:{value:relatedTarget}});
    body.dispatchEvent(event);
  };
  return {body, notes, reference, fire};
}

test('hover and keyboard focus highlight the linked note, including repeated references', t => {
  const {body, notes, reference, fire} = fixture(t);
  const cleanup = enableSidenotes(body);
  const first = reference('#note-one'), repeated = reference('#note-one'), second = reference('#note-two');
  const highlighted = () => notes.filter(note => note.classes.has('is-highlighted')).map(note => note.id);
  fire('pointerover', first); assert.deepEqual(highlighted(), ['note-one']);
  fire('pointerout', first, repeated); assert.deepEqual(highlighted(), ['note-one']);
  fire('focusin', second); assert.deepEqual(highlighted(), ['note-one', 'note-two']);
  fire('pointerout', repeated); assert.deepEqual(highlighted(), ['note-two']);
  fire('focusout', second); assert.deepEqual(highlighted(), []);
  fire('pointerover', reference('#note%2Done')); assert.deepEqual(highlighted(), ['note-one']);
  fire('pointerout', first, reference('#missing')); assert.deepEqual(highlighted(), []);
  fire('pointerover', first);
  cleanup(); assert.deepEqual(highlighted(), []);
  fire('pointerover', second); assert.deepEqual(highlighted(), [], 'old listeners are removed before live replacement');
  const cleanupAgain = enableSidenotes(body);
  fire('pointerover', second); assert.deepEqual(highlighted(), ['note-two']);
  cleanupAgain();
});
