import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const source = readFileSync('src/scripts/analytics.mjs', 'utf8');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function load(url, {embedded=false, automated=false, hidden=false, disabled=false, storage=new Map(), post=id, blocked=false, dnt=false}={}) {
  const requests = [], events = new Map();
  const window = {location:new URL(url), addEventListener:(name, fn)=>events.set(name, fn)};
  window.self = window; window.top = embedded ? {} : window;
  if (disabled) storage.set('naman.analytics.disabled', '1');
  const document = {readyState:'loading', visibilityState:hidden?'hidden':'visible',
    querySelector:()=> post === undefined ? null : {dataset:{postId:post}},
    addEventListener:(name, fn)=>events.set(name,fn), removeEventListener:name=>events.delete(name)};
  const context = vm.createContext({window, document, URL, crypto:webcrypto,
    navigator:{webdriver:automated, doNotTrack:dnt?'1':'0'},
    history:{replaceState(){}}, localStorage:{getItem:key=>{if(blocked)throw Error();return storage.get(key) || null;},setItem:(k,v)=>storage.set(k,v)},
    fetch:async (url, init)=>requests.push({url,...init}),
  });
  const run = () => vm.runInContext(`{${source}}`,context);
  run();
  return {requests, events, document, storage, run};
}
test('counts once after load, reuses browser identity, and sends only the stable post ID', () => {
  const f=load('https://naman.world/blog/test?secret=private#private');
  assert.equal(f.requests.length,0); f.run(); f.events.get('load')();
  assert.equal(f.requests.length,1);
  const request=f.requests[0], body=JSON.parse(request.body);
  assert.deepEqual(Object.keys(body),['visitorId','postId']);assert.equal(body.postId,id);
  assert.equal(request.referrerPolicy,'no-referrer');assert.equal(request.credentials,'omit');
  const second=load('https://naman.world/blog/new-slug',{storage:f.storage});second.events.get('load')();
  assert.equal(JSON.parse(second.requests[0].body).visitorId,body.visitorId);
});
test('excludes author visits, privacy preferences, automation, previews and frames', () => {
  for (const path of ['http://localhost:3000/','https://preview.workers.dev/','https://naman.world/api/foo','https://naman.world/zoom?code=x','https://naman.world/embeds/bpe.html','https://naman.world/analytics']) {
    const f=load(path);f.events.get('load')?.();assert.equal(f.requests.length,0,path);
  }
  for(const options of [{disabled:true},{embedded:true},{automated:true},{blocked:true},{dnt:true},{post:null}]) {
    const f=load('https://naman.world/blog/test',options);f.events.get('load')?.();assert.equal(f.requests.length,0);
  }
  const owner=load('https://naman.world/blog/test#analytics-exclude');owner.events.get('load')?.();
  assert.equal(owner.requests.length,0);assert.equal(owner.storage.get('naman.analytics.disabled'),'1');
});
test('waits until a background page is visible and rotates expired browser IDs', () => {
  const storage=new Map([['naman.analytics.visitor',JSON.stringify({id,lastSeen:0})]]);
  const f=load('https://naman.world/',{hidden:true,storage});f.events.get('load')();assert.equal(f.requests.length,0);
  f.document.visibilityState='visible';f.events.get('visibilitychange')();
  assert.equal(f.requests.length,1);assert.notEqual(JSON.parse(f.requests[0].body).visitorId,id);
  assert.equal(f.events.has('visibilitychange'),false);
});
