import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('sandboxed demos accept only valid themes from their parent', () => {
  const messages = [], handlers = {};
  const parent = { postMessage: (...args) => messages.push(args) };
  const root = { dataset: {} };
  const window = { parent, addEventListener: (type, handler) => { handlers[type] = handler; } };
  runInNewContext(read('../src/scripts/embed-theme-receiver.js'), {
    window, document: { documentElement: root }, matchMedia: () => ({ matches: false }),
    localStorage: { getItem() { throw new Error('opaque origin'); } },
  });
  assert.equal(messages[0][0].type, 'naman:theme-ready');
  handlers.message({ source: {}, data: { type: 'naman:theme', theme: 'dark' } });
  assert.equal(root.dataset.theme, 'light');
  for (const theme of ['dark', 'light', 'dark']) {
    handlers.message({ source: parent, data: { type: 'naman:theme', theme } });
    assert.equal(root.dataset.theme, theme);
  }
  handlers.message({ source: parent, data: { type: 'naman:theme', theme: 'invalid' } });
  assert.equal(root.dataset.theme, 'dark');
});

test('parent synchronizes existing, lazy and replacement frames while ignoring other windows', () => {
  const events = {}, loads = {}, messages = [];
  class Frame {
    constructor(src) { this.src = src; this.contentWindow = { postMessage: data => messages.push([this, data.theme]) }; }
  }
  const first = new Frame('https://naman.world/embeds/bpe.html');
  const foreign = new Frame('https://example.com/embeds/bpe.html');
  const frames = [first, foreign];
  const root = { dataset: { theme: 'dark' } };
  const context = {
    URL, HTMLIFrameElement: Frame, location: new URL('https://naman.world/blog/example'),
    window: { addEventListener: (type, fn) => { events[type] = fn; } },
    document: { documentElement: root, querySelectorAll: () => frames, addEventListener: (type, fn) => { loads[type] = fn; } },
  };
  const sync = runInNewContext(read('../src/scripts/embed-themes.mjs').replace('export ', '') + '\nenableEmbedThemes();', context);
  assert.deepEqual(messages, [[first, 'dark']]);
  messages.length = 0;
  events.message({ source: foreign.contentWindow, data: { type: 'naman:theme-ready' } });
  assert.equal(messages.length, 0);
  events.message({ source: first.contentWindow, data: { type: 'naman:theme-ready' } });
  assert.deepEqual(messages, [[first, 'dark']]);
  const replacement = new Frame('https://naman.world/embeds/unigram.html');
  frames[0] = replacement;
  messages.length = 0;
  loads.load({ target: replacement });
  root.dataset.theme = 'light';
  sync();
  assert.deepEqual(messages, [[replacement, 'dark'], [replacement, 'light']]);
  assert.equal(replacement.src, 'https://naman.world/embeds/unigram.html', 'sync does not reload the demo');
});

test('both built demos share the palette and receiver under valid script hashes', () => {
  for (const name of ['bpe', 'unigram']) {
    const html = read(`../public/embeds/${name}.html`);
    assert.ok(html.includes(read('../src/styles/embed-theme.css')));
    assert.ok(html.includes(read('../src/scripts/embed-theme-receiver.js')));
    const script = html.split('<script>')[1].split('</script>')[0];
    assert.ok(html.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`));
    assert.doesNotMatch(html, /allow-same-origin/);
  }
});
