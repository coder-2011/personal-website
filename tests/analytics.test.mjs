import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: ['src/scripts/analytics.mjs'],
  bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'import.meta.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN': JSON.stringify('a'.repeat(32)) },
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
  vm.runInContext(`{${outputFiles[0].text}}`, context);
  return { scripts, window, context };
}

test('loads Cloudflare analytics once with manual SPA tracking disabled', () => {
  const { scripts, context } = load('https://naman.world/blog/first?token=secret#private');
  vm.runInContext(`{${outputFiles[0].text}}`, context);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://static.cloudflareinsights.com/beacon.min.js');
  assert.equal(scripts[0].defer, true);
  assert.equal(scripts[0].referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(scripts[0].dataset.cfBeacon),{token:'a'.repeat(32),spa:false});
});

test('excludes development, previews, callbacks, and frames before loading the tracker', () => {
  for (const url of [
    'http://localhost:3000/',
    'https://naman-world.naman-world.workers.dev/blog/test',
    'https://naman.world/zoom?code=secret',
    'https://naman.world/api/publish',
  ]) assert.equal(load(url).scripts.length, 0, url);
  assert.equal(load('https://naman.world/', { embedded: true }).scripts.length, 0);
  assert.equal(load('https://www.naman.world/').scripts.length, 1);
});
