import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import model from '../src/data/t5-unigram.json' with {type:'json'};
import { createUnigram } from '../src/lib/unigram/engine.mjs';
import { handleUnigramRequest } from '../src/lib/unigram/api.mjs';

const {trace} = createUnigram(model);
const fixtures = [
  ['snaptokens is the best!', [10075,235,2217,7,19,8,200,55]],
  ['my name is naman', [82,564,19,3,29,9,348]],
  ['unbelievable', [25525]],
  ['café 🙂', [11949,3,2]],
  ['e\u0301', [3,154]],
  ['hello<extra_id_0>world', [21820,32099,296]],
  ['<pad></s><unk>', [0,1,2]],
  ['🙂🙂x🙂', [3,2,226,2]],
  ['  a\tb\n c  ', [3,9,3,115,3,75]],
  [' ', []],
];

test('T5 traces match Hugging Face fixtures, including normalization and unknown fusion', () => {
  for (const [text, ids] of fixtures) {
    const result = trace(text);
    assert.deepEqual(result.tokens.map(token => token.id), ids, text);
    for (const piece of result.pieces.filter(piece => !piece.special)) {
      assert.equal(piece.path.map(token => token.text).join(''), piece.text);
      assert.equal(piece.path.reduce((sum, token) => sum + token.score, 0), piece.score);
    }
  }
});

test('Unigram chooses the best complete path rather than the best first token', () => {
  const small = {...model, added_tokens:[], model:{unk_id:0,
    vocab:[['<unk>',0],['▁a',-1],['bc',-7],['▁ab',-3],['c',-1]]}};
  const piece = createUnigram(small).trace('abc').pieces[0];
  assert.deepEqual(piece.tokens.map(token => token.text), ['▁ab','c']);
  assert.equal(piece.score,-4);
  const last = piece.visits.at(-1).matches.find(token => token.text === 'c');
  assert.equal(last.previousScore,-8);
  assert.equal(last.improved,true);
});

test('API returns real IDs and bounds normalization expansion before tracing', async () => {
  const request = text => new Request('https://naman.world/api/unigram', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}),
  });
  const response = await handleUnigramRequest(request(fixtures[0][0]));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');
  assert.deepEqual((await response.json()).tokens.map(token => token.id),fixtures[0][1]);
  const expanded = await handleUnigramRequest(request('\ufdfa'.repeat(40)));
  assert.equal(expanded.status,422);
});

test('frontend CSP and reversible playback cover scoring, backtracking, and every piece', () => {
  const html = readFileSync(new URL('../public/embeds/unigram.html', import.meta.url),'utf8');
  const script = html.split('<script>')[1].split('</script>')[0];
  assert.ok(html.includes(`script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  const source = script.match(/function makeSteps\(pieces\) \{[\s\S]*?\n\}/)[0];
  const makeSteps = new Function(`return (${source})`)();
  for (const [text] of fixtures) {
    const {pieces} = trace(text), steps = makeSteps(pieces);
    assert.equal(steps.at(-1).completed,pieces.length);
    assert.deepEqual(steps.filter(step => step.phase === 'append').map(step => step.piece),pieces.map((_,i) => i));
    assert.equal(steps.filter(step => step.phase === 'keep').length,pieces.reduce((n,p) => n+p.visits.length,0));
    for (let i=1;i<steps.length;i++) {
      if (steps[i].completed !== steps[i-1].completed) assert.equal(steps[i].phase,'append');
      if (steps[i].phase === 'keep') assert.equal(steps[i-1].phase,'score');
      if (steps[i].phase === 'backtrack') assert.ok(steps[i].count <= pieces[steps[i].piece].path.length);
    }
  }
});
