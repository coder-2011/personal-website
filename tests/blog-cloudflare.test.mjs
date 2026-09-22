import test from 'node:test';
import assert from 'node:assert/strict';
import { blogStore } from '../src/lib/blog/store.mjs';
import { cachedBlogResponse } from '../src/lib/blog/cache.mjs';

// Simulates R2's atomic conditional puts while interleaving async publishers.
function bucket() {
  const objects = new Map(); let version = 0;
  return {
    async get(key) {
      const value = objects.get(key);
      return value && { etag: value.etag, text: async () => value.text };
    },
    async put(key, content, { onlyIf }) {
      const prior = objects.get(key);
      if (onlyIf.etagMatches ? prior?.etag !== onlyIf.etagMatches : !!prior) return null;
      const value = { text: content, etag: String(++version) };
      objects.set(key, value); return value;
    },
  };
}
const post = id => ({id, slug: id, title: id, date:'2026-09-21', description:'', markdown:'Hello',html:'<p>Hello</p>', assets:[],baseVersion:null});
test('R2 conditional writes retain concurrent first publications and reject stale edits', async () => {
  const runtime = {env:{BLOG_BUCKET:bucket(), BLOG_NAMESPACE:'test'}};
  const a = blogStore(runtime), b = blogStore(runtime);
  await Promise.all([a.publish(post('first')), b.publish(post('second'))]);
  assert.deepEqual((await a.list()).map(p=>p.slug).sort(), ['first','second']);
  const entry = await a.post('first');
  await a.publish({...post('first'), baseVersion:entry.revision, markdown:'Updated'});
  await assert.rejects(b.publish({...post('first'), baseVersion:entry.revision, markdown:'Stale'}), /changed elsewhere/);
});

test('edge cache separates revisions, withdrawals, builds, and unchanged responses', async () => {
  const values = new Map(), pending = [];
  const cache = {match:async key=>values.get(key.url)?.clone(), put:async(key,res)=>{values.set(key.url,res);}};
  let calls = 0;
  const next = async () => {calls++;return new Response('article');};
  const options = {cache,waitUntil:p=>pending.push(p),namespace:'test',build:'build1',version:'v1',entries:[{slug:'note',revision:'r1',published:true}]};
  async function get(path, changes={}) {
    const res=await cachedBlogResponse({...options,...changes,request:new Request(`https://naman.world${path}`)},next);
    await Promise.all(pending);return res;
  }
  await get('/blog/note');
  const hit = await get('/blog/note?tracking=ignored');
  assert.equal(hit.headers.get('X-Blog-Cache'),'HIT');
  assert.equal(hit.headers.get('Cache-Control'),'private, no-store');
  assert.equal(calls,1);
  await get('/blog/note',{version:'v2'});
  assert.equal(calls,1,'an unrelated publication retains this revision in cache');
  await get('/blog/note',{entries:[{slug:'note',revision:'r2',published:true}]});
  await get('/blog/note',{version:'v3',entries:[{slug:'note',revision:'r3',published:false}]});
  await get('/blog/note',{build:'build2'});
  assert.equal(calls,4);
  const unchanged = await get('/api/blog/posts/note?revision=r1');
  assert.deepEqual(await unchanged.json(),{revision:'r1'});
  assert.equal(calls,4,'a fresh index answers unchanged polls without rendering');
  await get('/api/blog/posts/note?revision=old');
  await get('/api/blog/posts/note?revision=another-old');
  assert.equal(calls,5,'old query values share one changed-content entry');
});

test('one fresh index serves a cache miss and asset existence uses metadata only', async () => {
  const storage = bucket(), reads = [];
  const original = storage.get;
  storage.get = async path => {reads.push(path);return original(path);};
  storage.head = async path => original(path);
  const store = blogStore({env:{BLOG_BUCKET:storage,BLOG_NAMESPACE:'test'}});
  await store.publish(post('note'));
  reads.length = 0;
  const entries = await store.list();
  assert.equal((await store.post('note',undefined,entries)).title,'note');
  assert.equal(reads.filter(path=>path.endsWith('/index.json')).length,1);
  reads.length = 0;
  assert.equal(await store.assetExists('missing'),false);
  assert.equal(reads.length,0,'existence checks do not download image bytes');
  await store.unpublish(entries[0].id,entries[0].revision);
  assert.equal(await store.post('note'),null,'a later request never reuses that snapshot');
});

test('a cached image is hidden immediately when its last published reference is removed', async () => {
  const id='a'.repeat(64), values=new Map();
  const options={request:new Request(`https://naman.world/api/blog/assets/${id}`),entries:[{published:true,assets:[id]}],build:'b',namespace:'test',version:'v1',cache:{match:async key=>values.get(key.url)?.clone(),put:async(key,res)=>values.set(key.url,res)},waitUntil:()=>{}};
  const first = await cachedBlogResponse(options,async()=>new Response('image'));
  assert.equal(first.headers.get('Cache-Control'),'private, no-cache');
  const conditional = new Request(options.request,{headers:{'If-None-Match':first.headers.get('ETag')}});
  const reused = await cachedBlogResponse({...options,request:conditional},async()=>{throw new Error('Must not read image again');});
  assert.equal(reused.status,304);
  const removed=await cachedBlogResponse({...options,request:conditional,entries:[{published:false,assets:[id]}]},async()=>new Response('removed',{status:404}));
  assert.equal(removed.status,404);
});

test('errors and cookie-bearing responses are excluded from the edge cache', async () => {
  let writes=0;
  for(const response of [new Response('offline',{status:503}),new Response('removed',{status:404}),new Response('personal',{headers:{'Set-Cookie':'private=yes'}})]) {
    await cachedBlogResponse({request:new Request('https://naman.world/blog'),entries:[],build:'a',namespace:'test',version:'v1',cache:{match:async()=>null,put:async()=>{writes++;}},waitUntil(){}}, async()=>response);
  }
  assert.equal(writes,0);
});
