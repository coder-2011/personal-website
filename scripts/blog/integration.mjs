import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const origin = process.env.BLOG_TEST_ORIGIN || 'http://127.0.0.1:4321';
const token = process.env.BLOG_PUBLISH_TOKEN;
if (!token) throw new Error('Set BLOG_PUBLISH_TOKEN.');
const id = randomUUID();
const slug = `publishing-check-${id.slice(0,8)}`;
const meta = {id,slug,title:'Publishing verification',date:'2026-09-20',description:'A temporary synthetic integration check.',baseVersion:null};
const headers = {Authorization:`Bearer ${token}`, 'Content-Type':'application/json'};
const send = (body, method='POST') => fetch(`${origin}/api/publish`,{method,headers,body:JSON.stringify(body)});
let version;
try {
  assert.equal((await fetch(`${origin}/api/publish`)).status,401);
  const image = await sharp({create:{width:16,height:16,channels:3,background:'#888'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'PRIVATE-METADATA'}}}).toBuffer();
  const uploaded = await fetch(`${origin}/api/publish/assets`, {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/jpeg'},body:image});
  assert.equal(uploaded.status,200,await uploaded.clone().text());
  const asset = await uploaded.json();
  assert.equal((await fetch(origin+asset.url)).status,404);
  const payload = {...meta,markdown:`# Verified\n\nPublished from a synthetic test.\n\n![Image](${asset.url})`};
  const start=performance.now();
  const created=await send(payload);
  assert.equal(created.status,200,await created.clone().text());
  version=(await created.json()).post.revision;
  assert.equal((await fetch(`${origin}/blog/${slug}`)).status,200);
  const served=await fetch(origin+asset.url);
  assert.equal(served.status,200);
  const metadata=await sharp(Buffer.from(await served.arrayBuffer())).metadata();
  assert.equal(metadata.exif,undefined); assert.equal(metadata.xmp,undefined);
  const update=await send({...payload,baseVersion:version,markdown:'# Updated\n\nVisible immediately.'});
  assert.equal(update.status,200,await update.clone().text());
  const next=(await update.json()).post.revision;
  const read=await fetch(`${origin}/api/blog/posts/${slug}`);
  assert.match((await read.json()).html,/Visible immediately/);
  console.log(`Create, image, update and immediate reads passed in ${Math.round(performance.now()-start)} ms.`);
  assert.equal((await send({...payload,baseVersion:version,markdown:'Stale'})).status,409);
  version=next;
  assert.equal((await send({...payload,baseVersion:version,markdown:'Local /Users/test/private.md'})).status,422);
  assert.match((await (await fetch(`${origin}/api/blog/posts/${slug}`)).json()).html,/Visible immediately/);
  assert.equal((await fetch(origin+asset.url)).status,404);
  assert.equal((await fetch(`${origin}/api/blog/posts/${slug}`,{headers:{'If-None-Match':version}})).status,304);
  console.log('Authentication, metadata stripping, stale-write rejection, privacy rejection, unchanged prior content, and removed-image access passed.');
} finally {
  if (version) {
    const deleted=await send({id,baseVersion:version},'DELETE');
    assert.equal(deleted.status,200,await deleted.clone().text());
    assert.equal((await fetch(`${origin}/blog/${slug}`)).status,404);
    console.log('Temporary post unpublished; its URL returns 404.');
  }
}
