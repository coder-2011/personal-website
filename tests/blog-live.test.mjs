import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/scripts/blog-live.mjs', import.meta.url), 'utf8');
function fixture() {
  const timers = new Map(), calls = [], applied = [], events = new EventTarget();
  const button = new EventTarget(), article = {dataset:{slug:'test',revision:'v1'},focus:() => {article.focused = true;}};
  const notice = {hidden:true,querySelector:() => button};
  const document = {hidden:false};
  const window = {addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),scrollY:1000,innerHeight:800,scrollTo:options => {window.scrollY = options.top;}};
  let id = 0, response = {status:204,ok:true}, withdrawn = 0;
  const context = vm.createContext({AbortController,document,window,
    setTimeout:(callback,delay) => {timers.set(++id,{callback,delay});return id;},
    clearTimeout:id => timers.delete(id),
    fetch:async (url,options) => {calls.push({url,options});return typeof response === 'function' ? response(options) : response;},
  });
  vm.runInContext(source.replaceAll('export function', 'function'),context);
  const cleanup = context.enableLiveUpdates(article,notice,post => applied.push(post),() => withdrawn++);
  return {timers,calls,applied,events,button,article,notice,document,window,context,cleanup,
    get withdrawn() {return withdrawn;},
    response(value) {response = value;},
    post(revision) {response = {status:200,ok:true,json:async () => ({revision,html:`<p>${revision}</p>`})};},
    tick() {const [id,timer] = [...timers].find(([,timer])=>timer.delay !== 8000);timers.delete(id);return timer.callback();},
  };
}

test('live edits leave the article untouched until the reader applies the newest pending version', async () => {
  const f = fixture();
  assert.equal([...f.timers.values()][0].delay,1000);
  f.post('v2'); await f.tick();
  assert.equal([...f.timers.values()][0].delay,1000);
  assert.equal(f.notice.hidden,false);
  assert.equal(f.applied.length,0);
  assert.equal(f.article.dataset.revision,'v1');
  assert.equal(f.article.focused,undefined,'no focus stealing when an update arrives');
  assert.equal(f.window.scrollY,1000);
  f.response({status:200,ok:true,json:async()=>({revision:'v2'})}); await f.tick();
  assert.equal(f.applied.length,0,'a cached revision-only response must leave the article untouched');
  assert.equal(f.calls.at(-1).options.cache,undefined,'allow the CDN cache instead of forcing origin revalidation');
  assert.match(f.calls.at(-1).url,/revision=v2$/,'poll the pending version instead of downloading it again');
  f.post('v3'); await f.tick();
  assert.equal(f.applied.length,0);
  f.button.dispatchEvent(new Event('click'));
  assert.equal(f.applied.length,1);
  assert.equal(f.applied[0].revision,'v3');
  assert.equal(f.article.dataset.revision,'v3');
  assert.equal(f.notice.hidden,true);
  assert.equal(f.article.focused,true);
  f.button.dispatchEvent(new Event('click'));
  assert.equal(f.applied.length,1);
  f.cleanup();
});

test('network errors and hidden tabs are quiet, while unpublishing cancels pending content', async () => {
  const f = fixture();
  f.document.hidden = true; await f.tick();
  assert.equal(f.calls.length,0);
  f.document.hidden = false; f.post('v2'); await f.tick();
  f.response(() => {throw new Error('Offline');}); await f.tick();
  assert.equal(f.notice.hidden,false,'keep the downloaded version available');
  assert.equal([...f.timers.values()][0].delay,15000);
  assert.equal(f.applied.length,0);
  f.response({status:404,ok:false}); await f.tick();
  assert.equal(f.withdrawn,1);
  assert.equal(f.notice.hidden,true);
  assert.equal(f.timers.size,0);
  f.button.dispatchEvent(new Event('click'));
  assert.equal(f.applied.length,0,'a withdrawn post cannot be restored by a pending update');
  f.cleanup();
});

test('responses arriving after navigation cannot modify the page or start duplicate polling', async () => {
  const f = fixture();
  let release;
  f.response(() => new Promise(resolve => {release = resolve;}));
  const request = f.tick();
  f.events.dispatchEvent(new Event('pagehide'));
  assert.equal(f.calls[0].options.signal.aborted,true);
  release({status:200,ok:true,json:async () => ({revision:'stale'})}); await request;
  assert.equal(f.notice.hidden,true);
  assert.equal(f.timers.size,0);
  f.post('v2');
  const event = new Event('pageshow'); event.persisted = true;
  f.events.dispatchEvent(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.notice.hidden,false);
  assert.equal(f.timers.size,1);
  f.cleanup(); assert.equal(f.timers.size,0);
});

test('explicit updates preserve the reading paragraph after content is inserted above it', () => {
  const f = fixture();
  const block = (id,text,top) => ({id,textContent:text,tagName:'P',classList:{contains:() => false},getBoundingClientRect:() => ({top,bottom:top+120})});
  const body = {children:[block('','Earlier paragraph',-150),block('','Reading here',-30),block('next','Next paragraph',150)]};
  const restore = f.context.rememberReadingPosition(body);
  body.children = [block('','New material',-100),block('','Earlier paragraph',50),block('','Reading here',170),block('next','Next paragraph',350)];
  restore(); assert.equal(f.window.scrollY,1200);
  f.window.scrollY = 0;
  const restoreTop = f.context.rememberReadingPosition(body);
  f.window.scrollY = 80;
  restoreTop(); assert.equal(f.window.scrollY,0);
  f.cleanup();
});
