import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {blogPageHeaders, json} from '../src/lib/blog/http.mjs';

const source = await readFile(new URL('../src/pages/api/blog/posts/[slug].ts', import.meta.url),'utf8');
const {code} = await transform(source,{loader:'ts',format:'cjs'});
function fixture(post) {
  const module = {exports:{}}, calls=[];
  vm.runInNewContext(code,{module,exports:module.exports,URL,Response,
    require(path) {
      if(path.endsWith('store.mjs')) return {blogStore:()=>({post:async (...args)=>{calls.push(args); if(post instanceof Error)throw post; return post;}})};
      if(path.endsWith('reading.mjs'))return {readingSummary:()=> '2 words · 1 min read'};
      if(path.endsWith('http.mjs'))return {json,blogPageHeaders};
      if(path.endsWith('code-upgrade.mjs'))return {presentPostForReading:async html=>html};
      throw new Error(path);
    },
  });
  return {calls,get:revision=>module.exports.GET({params:{slug:'example'},locals:{runtime:{}},request:new Request(`https://naman.world/api/blog/posts/example?revision=${revision}`)})};
}
test('unchanged and new revisions require a fresh visibility check',async()=>{
  const f=fixture({revision:'v2',html:'<p>Updated text</p>',title:'Example'});
  const unchanged=await f.get('v2');
  assert.equal(unchanged.status,200);
  assert.deepEqual(await unchanged.json(),{revision:'v2'});
  const changed=await f.get('v1');
  assert.equal((await changed.json()).html,'<p>Updated text</p>');
  for(const response of [unchanged,changed]) {
    assert.equal(response.headers.get('Cache-Control'),'private, no-store','readers must recheck the CDN, not reuse a browser snapshot');
  }
});
test('storage failures and unpublished posts are never cached as successful revisions',async()=>{
  for(const [post,status] of [[null,404],[new Error('Storage offline'),503]]) {
    const response=await fixture(post).get('v1');
    assert.equal(response.status,status);
    assert.equal(response.headers.get('Vercel-CDN-Cache-Control'),null);
    assert.equal(response.headers.get('CDN-Cache-Control'),'no-store');
  }
});
