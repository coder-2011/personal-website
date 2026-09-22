// Local handler/HTML preparation timings, not browser or network timings.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { handleBpeRequest } from '../src/lib/bpe/api.mjs';
import { prepareReading, readingSummary } from '../src/lib/blog/reading.mjs';
import { prepareCatalogue } from '../src/lib/blog/catalogue.mjs';

const baseline = process.argv[2] || 'e8e8b8a';
const postURL = process.argv[3] || 'https://naman.world/api/blog/posts/snaptokens-blog';
const root = new URL('../', import.meta.url);
// Compare the old handler against the unchanged engine and model, isolating
// display-label decoding. Keep both runs in the same process and alternate order.
const source = execFileSync('git', ['show', `${baseline}:src/lib/bpe/api.mjs`], { cwd: root, encoding: 'utf8' })
  .replaceAll("'./engine.mjs'", JSON.stringify(new URL('src/lib/bpe/engine.mjs', root).href))
  .replaceAll("'../tokenizer-api.mjs'", JSON.stringify(new URL('src/lib/tokenizer-api.mjs', root).href))
  .replaceAll("'../../data/gpt2.json'", JSON.stringify(new URL('src/data/gpt2.json', root).href));
const beforeBPE = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).handleBpeRequest;
const corpus = ['my name is naman', 'snaptokens is the best! '.repeat(6), 'café 🙂 漢字\n\t text', 'a'.repeat(160)];
const request = text => new Request('https://naman.world/api/bpe', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
});
for (const text of corpus) {
  assert.deepEqual(await (await beforeBPE(request(text))).json(), await (await handleBpeRequest(request(text))).json());
}
async function bpeRun(handler) {
  for (let i = 0; i < 24; i++) {
    const response = await handler(request(corpus[i % corpus.length]));
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
}
const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
async function compare(before, after, rounds, calls = 1) {
  const samples = [];
  for (let i = 0; i < rounds + 4; i++) {
    const sample = {};
    for (const [name, run] of i % 2 ? [['after', after], ['before', before]] : [['before', before], ['after', after]]) {
      const start = performance.now();
      await run();
      sample[name] = (performance.now() - start) / calls;
    }
    if (i >= 4) samples.push(sample);
  }
  return {
    beforeMedianMs: median(samples.map(s => s.before)),
    afterMedianMs: median(samples.map(s => s.after)),
    geomeanSpeedup: Math.exp(samples.reduce((sum, s) => sum + Math.log(s.before / s.after), 0) / samples.length),
    samples,
  };
}
const bpe = await compare(() => bpeRun(beforeBPE), () => bpeRun(handleBpeRequest), 12, 24);
const response = await fetch(postURL);
assert.equal(response.status, 200);
const { html } = await response.json();
assert.equal(typeof html, 'string');
const beforeReading = () => ({ ...prepareCatalogue(html), readingSummary: readingSummary(html) });
const afterReading = () => prepareReading(html);
assert.deepEqual(beforeReading(), afterReading());
const reading = await compare(beforeReading, afterReading, 16);
console.log(JSON.stringify({ baseline, node: process.version, corpus, htmlBytes: Buffer.byteLength(html), bpe, reading }, null, 2));
