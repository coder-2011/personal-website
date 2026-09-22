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
  await get('/blog/note',{version:'v3',entries:[{slug:'note',revision:'r3',published:false}]});
  await get('/blog/note',{build:'build2'});
  assert.equal(calls,4);
  await get('/api/blog/posts/note?revision=r1');
  await get('/api/blog/posts/note?revision=old');
  await get('/api/blog/posts/note?revision=another-old');
  assert.equal(calls,6,'old query values share one changed-content entry');
});

test('errors and cookie-bearing responses are excluded from the edge cache', async () => {
  let writes=0;
  for(const response of [new Response('offline',{status:503}),new Response('removed',{status:404}),new Response('personal',{headers:{'Set-Cookie':'private=yes'}})]) {
    await cachedBlogResponse({request:new Request('https://naman.world/blog'),entries:[],build:'a',namespace:'test',version:'v1',cache:{match:async()=>null,put:async()=>{writes++;}},waitUntil(){}}, async()=>response);
  }
  assert.equal(writes,0);
});
