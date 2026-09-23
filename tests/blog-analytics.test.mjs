import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { recordVisit, visitorCounts } from '../src/lib/blog/analytics.mjs';
const post='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visitor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now=Date.now(), day=86400000;
function fixture() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/analytics/0001_visitors.sql','utf8'));
  const entries=[{id:post,slug:'first',published:true}];
  const db={prepare(sql){let params=[];return {bind(...args){params=args;return this;}, async run(){return sqlite.prepare(sql).run(...params);}, async all(){return {success:true,results:sqlite.prepare(sql).all(...params)};},async first(){return sqlite.prepare(sql).get(...params);}};},async batch(statements){for(const s of statements)await s.run();}};
  const runtime={env:{ANALYTICS_DB:db,ANALYTICS_SECRET:'test-secret',BLOG_PUBLISH_TOKEN:'p'.repeat(40),ANALYTICS_LIMIT:{limit:async()=>({success:true})},BLOG_BUCKET:{get:async()=>({text:async()=>JSON.stringify(entries)})}}};
  return {sqlite,entries,runtime};
}
const visit=(body={visitorId:visitor,postId:post},headers={})=>new Request('https://naman.world/api/analytics/visit',{method:'POST',headers:{origin:'https://naman.world','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const stats=(auth=true)=>new Request('https://naman.world/api/publish/analytics',{headers:auth?{Authorization:`Bearer ${'p'.repeat(40)}`}:{}});
test('real SQL deduplicates browsers across reloads and renamed posts; site total is deduplicated too',async()=>{
  const f=fixture();
  for(let i=0;i<3;i++)assert.equal((await recordVisit(visit(),f.runtime,now)).status,204);
  f.entries[0].slug='renamed';await recordVisit(visit(),f.runtime,now);
  await recordVisit(visit({visitorId:visitor,postId:null}),f.runtime,now);
  let data=await (await visitorCounts(stats(),f.runtime,now)).json();
  assert.equal(data.posts[post],1);assert.equal(data.siteVisitors,1);assert.equal(data.days,30);
  const rows=f.sqlite.prepare('SELECT * FROM visitors').all();assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.visitor!==visitor && /^[a-f0-9]{64}$/.test(row.visitor)));
  await recordVisit(visit({visitorId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',postId:post}),f.runtime,now);
  data=await (await visitorCounts(stats(),f.runtime,now)).json();assert.equal(data.posts[post],2);
  f.entries[0].published=false;assert.equal((await recordVisit(visit(),f.runtime,now)).status,404);
  assert.deepEqual((await (await visitorCounts(stats(),f.runtime,now)).json()).posts,{});
});
test('counts exclude stale visitors and expire old records; late requests cannot move last_seen backwards',async()=>{
  const f=fixture();await recordVisit(visit(),f.runtime,now-91*day);
  await recordVisit(visit({visitorId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',postId:null}),f.runtime,now);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM visitors').get().n,1);
  await recordVisit(visit(),f.runtime,now);await recordVisit(visit(),f.runtime,now-day);
  assert.equal(f.sqlite.prepare('SELECT last_seen FROM visitors WHERE target = ?').get(post).last_seen,now);
  const data=await (await visitorCounts(stats(),f.runtime,now+31*day)).json();assert.equal(data.posts[post],0);assert.equal(data.siteVisitors,0);
});
test('rejects unauthenticated count reads, cross-origin writes, oversized/invalid visits and rate limits',async()=>{
  const f=fixture();assert.equal((await visitorCounts(stats(false),f.runtime)).status,401);
  assert.equal((await recordVisit(visit(undefined,{origin:'https://evil.example'}),f.runtime)).status,403);
  assert.equal((await recordVisit(visit({visitorId:'bad',postId:post}),f.runtime)).status,400);
  assert.equal((await recordVisit(visit({visitorId:'x'.repeat(300)}),f.runtime)).status,413);
  assert.equal((await recordVisit(visit(undefined,{dnt:'1'}),f.runtime)).status,204);
  f.runtime.env.ANALYTICS_LIMIT.limit=async()=>({success:false});assert.equal((await recordVisit(visit(),f.runtime)).status,429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM visitors').get().n,0);
});
test('storage failures stay unavailable rather than falsely reporting zero',async()=>{
  const f=fixture();f.runtime.env.ANALYTICS_DB.prepare=()=>{throw Error('provider secret');};
  const response=await visitorCounts(stats(),f.runtime);assert.equal(response.status,503);
  assert.equal((await response.text()).includes('provider secret'),false);
});
