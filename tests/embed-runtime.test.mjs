import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext} from 'node:vm';
import {handleBpeRequest} from '../src/lib/bpe/api.mjs';
import {handleUnigramRequest} from '../src/lib/unigram/api.mjs';

// Run the shipped scripts with DOM primitives, including moving existing nodes.
// This checks script behavior and text output, not browser layout or painting.
function fixture(name, {cancelAnimations = false, reducedMotion = true} = {}) {
  class Element {
    constructor() {
      this.children = []; this.dataset = {}; this.style = {}; this.attributes = {};
      this.className = ''; this.classList = {toggle() {}}; this.value = ''; this.disabled = false;
    }
    set textContent(value) { this._text = String(value); this.children.forEach(el => el.parent = null); this.children = []; }
    get textContent() { return (this._text ?? '') + this.children.map(el => el.textContent).join(''); }
    append(...nodes) {
      for (const node of nodes) {
        const el = typeof node === 'string' ? Object.assign(new Element(), {textContent: node}) : node;
        el.remove(); el.parent = this; this.children.push(el);
      }
    }
    replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(el => el !== this); this.parent = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener() {}
    getBoundingClientRect() { return {left:0, top:0, width:100, height:30}; }
    getAnimations() { return []; }
    animate() {
      return {get finished() { return cancelAnimations ? Promise.reject(new DOMException('Cancelled', 'AbortError')) : Promise.resolve(); }};
    }
    querySelectorAll(selector) { assert.equal(selector, '.chosen'); return this.children.filter(el => el.className.split(' ').includes('chosen')); }
  }
  const html = readFileSync(new URL(`../public/embeds/${name}.html`, import.meta.url), 'utf8');
  const example = JSON.parse(html.match(/const defaultExample = (.*);\n/)[1]);
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  $('input').value = example.text; $('speed').value = '1100';
  const controls = ['play', 'next', 'back', 'reset'].map($);
  const timers = new Map(); let timerId = 0;
  const context = createContext({
    document: {getElementById:$, createElement:() => new Element(), addEventListener() {},
      querySelectorAll:selector => selector === '.transport button' ? controls : []},
    location:{hostname:'localhost', href:'http://localhost/'}, matchMedia:() => ({matches:reducedMotion}),
    TextEncoder, AbortController, URL, performance, DOMException,
    setTimeout:fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout:id => timers.delete(id),
    fetch:() => { throw new Error('Default examples must not fetch'); },
  });
  const run = source => runInContext(source, context);
  run(html.slice(html.indexOf('const defaultExample = '), html.lastIndexOf('encodeInput();')));
  return {run, $, controls, context, timers, example};
}
const handlers = {bpe:handleBpeRequest, unigram:handleUnigramRequest};
const response = result => ({ok:true, status:200, json:async () => result});

for (const name of Object.keys(handlers)) {
  test(`${name} renders every forward and backward step for Unicode, whitespace, special tokens, and HTML-looking text`, async () => {
    const f = fixture(name);
    await f.run('encodeInput()');
    for (const text of ['x', 'my name is naman', 'aaaa café 🙂', 'e\u0301', '\t\n ', '<|endoftext|>x', '<pad></s><unk>', '<extra_id_0>', '<script>alert(1)</script>', 'a'.repeat(160)]) {
      const res = await handlers[name](new Request(`https://naman.world/api/${name}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text})}));
      assert.equal(res.status, 200);
      const trace = await res.json();
      f.context.fetch = async () => response(trace); f.$('input').value = text;
      await f.run('encodeInput()');
      assert.equal(f.$('input-error').textContent, '', text);
      const count = f.run('steps.length');
      for (let i = 1; i < count; i++) await f.run('advance()');
      const ids = (name === 'bpe' ? trace.frames.at(-1).tokens : trace.tokens).map(token => token.id);
      assert.equal(f.$('output').textContent, '[ ' + ids.join(', ') + ' ]', text);
      assert.equal(f.$('step').textContent, 'Encoding complete');
      assert.equal(f.$('next').disabled, true);
      for (let i = 1; i < count; i++) f.run('stepBack()');
      assert.equal(f.run('position'), 0); assert.equal(f.$('back').disabled, true);
    }
  });

  test(`${name} invalid input cancels pending work and preserves the displayed example`, async () => {
    const f = fixture(name); await f.run('encodeInput()');
    let resolve, signal;
    f.context.fetch = (_, options) => { signal = options.signal; return new Promise(done => resolve = done); };
    f.$('input').value = 'pending'; const pending = f.run('encodeInput()');
    f.$('input').value = ''; await f.run('encodeInput()');
    assert.equal(signal.aborted, true);
    assert.equal(f.run('activeRequest'), null);
    assert.equal(f.$('play').disabled, false);
    resolve(response(f.example.result)); await pending;
    assert.match(f.$('input-error').textContent, /1 and 160/);
    assert.equal(f.run("traceCache.has('pending')"), false);
    assert.equal(f.run('position'), 0);
  });

  test(`${name} malformed response preserves the last working walkthrough and is not cached`, async () => {
    const f = fixture(name); await f.run('encodeInput()');
    const before = f.run(name === 'bpe' ? 'frames' : 'data');
    f.context.fetch = async () => response({...f.example.result, ...(name === 'bpe' ? {frames:[{}]} : {pieces:[{}]})});
    f.$('input').value = 'bad response';
    await f.run('encodeInput()');
    assert.equal(f.run(name === 'bpe' ? 'frames' : 'data'), before);
    assert.equal(f.run("traceCache.has('bad response')"), false);
    assert.ok(f.$('input-error').textContent);
    await f.run('advance()'); assert.equal(f.run('position'), 1);
    f.context.fetch = async () => response(f.example.result);
    await f.run('encodeInput()'); assert.equal(f.$('input-error').textContent, '');
  });

  test(`${name} a late response cannot overwrite or cache over a newer result`, async () => {
    const f = fixture(name); await f.run('encodeInput()');
    const waiting = [];
    f.context.fetch = () => new Promise(resolve => waiting.push(resolve));
    f.$('input').value = 'older'; const older = f.run('encodeInput()');
    f.$('input').value = 'newer'; const newer = f.run('encodeInput()');
    waiting[1](response(f.example.result)); await newer;
    const current = f.run(name === 'bpe' ? 'frames' : 'data');
    waiting[0](response(structuredClone(f.example.result))); await older;
    assert.equal(f.run(name === 'bpe' ? 'frames' : 'data'), current);
    assert.equal(f.run("traceCache.has('older')"), false);
    assert.equal(f.run("traceCache.has('newer')"), true);
    assert.equal(f.$('input-error').textContent, '');
  });

  test(`${name} timeout and rate limiting recover without losing playback`, async () => {
    const f = fixture(name); await f.run('encodeInput()');
    f.context.fetch = (_, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError'))));
    f.$('input').value = 'timeout'; const pending = f.run('encodeInput()');
    [...f.timers.values()].forEach(fn => fn()); await pending;
    assert.match(f.$('input-error').textContent, /timed out/);
    assert.equal(f.$('play').disabled, false);
    f.context.fetch = async () => ({status:429}); await f.run('encodeInput()');
    assert.match(f.$('input-error').textContent, /Too many requests/);
    assert.equal(f.run('activeRequest'), null);
    f.context.fetch = async () => response(f.example.result); await f.run('encodeInput()');
    assert.equal(f.$('input-error').textContent, '');
    await f.run('advance()'); assert.equal(f.run('position'), 1);
  });
}

test('cancelled BPE merge animation does not reject or leave playback locked', async () => {
  const f = fixture('bpe', {cancelAnimations:true, reducedMotion:false}); await f.run('encodeInput()');
  f.run("position = steps.findIndex(step => step.phase === 'choose'); render()");
  assert.ok(f.run('position') > 0);
  await f.run('advance()'); assert.equal(f.run('busy'), false);
  assert.equal(f.run('steps[position].phase'), 'merge');
  await f.run('advance()'); assert.equal(f.run('steps[position].phase'), 'check');
});

test('restarting BPE during a merge prevents that transition from advancing the reset example', async () => {
  const f = fixture('bpe', {reducedMotion:false}); await f.run('encodeInput()');
  f.run("position = steps.findIndex(step => step.phase === 'choose'); render()");
  const transition = f.run('advance()'); f.run('restart()'); await transition;
  assert.equal(f.run('position'), 0); assert.equal(f.run('busy'), false);
  await f.run('advance()'); assert.equal(f.run('position'), 1);
});
