import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handleBpeRequest } from '../src/lib/bpe/api.mjs';

const request = (body, headers = {}, method = 'POST') => new Request('https://naman.world/api/bpe', {
  method, headers: { 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body }),
});

test('standalone frontend CSP permits exactly its current inline script', () => {
  const html = readFileSync(new URL('../public/embeds/bpe.html', import.meta.url), 'utf8');
  const script = html.split('<script>')[1].split('</script>')[0];
  const hash = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${hash}'`));
});

test('real GPT-2 trace preserves bytes and pre-tokenizer boundaries', async () => {
  const response = await handleBpeRequest(request(JSON.stringify({ text: 'my name is naman' })));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.frames.at(-1).tokens.map(t => t.id), [1820, 1438, 318, 299, 10546]);
  assert.deepEqual(data.frames[0].pieces, ['my', ' name', ' is', ' naman']);
  for (const frame of data.frames) {
    assert.equal(frame.byteLength, 16);
    for (const index of frame.candidate?.indices ?? [])
      assert.equal(frame.tokens[index].piece, frame.tokens[index + 1].piece);
  }
});

test('rejects invalid, oversized, and compressed input before tokenization', async () => {
  for (const [body, headers, expected] of [
    ['{', {}, 400], ['null', {}, 400], ['[]', {}, 400],
    ['{"text":42}', {}, 400], ['{"text":""}', {}, 400],
    ['{"text":"a","model":"other"}', {}, 400], ['{"text":"\\ud800"}', {}, 400],
    [JSON.stringify({ text: '🙂'.repeat(41) }), {}, 400],
    [' '.repeat(2049), {}, 413], ['{}', { 'Content-Length': '2049' }, 413],
    ['{}', { 'Content-Type': 'text/plain' }, 415], ['{}', { 'Content-Encoding': 'gzip' }, 415],
  ]) assert.equal((await handleBpeRequest(request(body, headers))).status, expected);
});

test('matches Hugging Face fixtures for UTF-8, Unicode whitespace, special tokens, and repeated pairs', async () => {
  for (const [text, ids] of [
    ['café 🙂', [66, 1878, 2634, 32485]],
    ['a\u0085b', [64, 126, 227, 65]],
    ['hello<|endoftext|>world', [31373, 50256, 6894]],
    ['aaaaaaa', [24794, 46071]],
  ]) {
    const response = await handleBpeRequest(request(JSON.stringify({ text })));
    const data = await response.json();
    assert.deepEqual(data.frames.at(-1).tokens.map(token => token.id), ids);
  }
});

test('enforces the body cap on streamed requests without Content-Length', async () => {
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(1024)); controller.enqueue(new Uint8Array(1025)); controller.close();
  }});
  const response = await handleBpeRequest(new Request('https://naman.world/api/bpe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
  }));
  assert.equal(response.status, 413);
});

test('cancels a stalled body instead of leaving the function waiting', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const response = await handleBpeRequest(new Request('https://naman.world/api/bpe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
  }));
  assert.equal(response.status, 408);
  assert.equal(cancelled, true);
});

test('public iframe CORS is credential-free and errors are not cached', async () => {
  const response = await handleBpeRequest(request(undefined, { Origin: 'null' }, 'OPTIONS'));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  const denied = await handleBpeRequest(request(undefined, {}, 'GET'));
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  assert.equal(denied.headers.get('X-Content-Type-Options'), 'nosniff');
});
