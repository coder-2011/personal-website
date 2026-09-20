import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/scripts/analytics.mjs'],
  bundle: true, write: false, format: 'iife', platform: 'browser',
});

function load(url, { embedded = false } = {}) {
  const scripts = [];
  const window = { location: new URL(url) };
  window.self = window;
  window.top = embedded ? {} : window;
  const context = vm.createContext({
    window, URL, console,
    document: {
      createElement: () => ({ dataset: {} }),
      head: {
        querySelector: () => scripts[0],
        appendChild: script => scripts.push(script),
      },
    },
  });
  vm.runInContext(outputFiles[0].text, context);
  return { scripts, window, context };
}

test('loads the real analytics package once and keeps distinct blog paths without URL secrets', () => {
  const { scripts, window, context } = load('https://naman.world/blog/first?token=secret#private');
  vm.runInContext(outputFiles[0].text, context);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, '/_vercel/insights/script.js');
  assert.equal(scripts[0].defer, true);
  const beforeSend = window.vaq.find(([name]) => name === 'beforeSend')[1];
  for (const slug of ['first', 'second']) {
    const event = { type: 'pageview', url: `https://naman.world/blog/${slug}?token=secret#private` };
    assert.equal(beforeSend(event).url, `https://naman.world/blog/${slug}`);
    assert.equal(beforeSend(event).type, 'pageview');
    assert.match(event.url, /token=secret/);
  }
  assert.equal(beforeSend({ url: 'https://naman.world/zoom?code=secret' }), null);
  assert.equal(beforeSend({ url: 'https://naman.world/api/publish' }), null);
});

test('excludes development, previews, callbacks, and frames before loading the tracker', () => {
  for (const url of [
    'http://localhost:3000/',
    'https://personal-website-preview.vercel.app/blog/test',
    'https://naman.world/zoom?code=secret',
    'https://naman.world/api/publish',
  ]) assert.equal(load(url).scripts.length, 0, url);
  assert.equal(load('https://naman.world/', { embedded: true }).scripts.length, 0);
  assert.equal(load('https://www.naman.world/').scripts.length, 1);
});
