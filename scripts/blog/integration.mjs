import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const origin = process.env.BLOG_TEST_ORIGIN || 'http://127.0.0.1:4321';
const token = process.env.BLOG_PUBLISH_TOKEN;
if (!token) throw new Error('Set BLOG_PUBLISH_TOKEN.');
const id = randomUUID();
const slug = `publishing-check-${id.slice(0,8)}`;
const meta = {id,slug,title:'Publishing verification',date:new Date().toISOString().slice(0,10),description:'A temporary synthetic integration check. '.repeat(12).trim(),baseVersion:null};
const headers = {Authorization:`Bearer ${token}`, 'Content-Type':'application/json'};
const send = (body, method='POST') => fetch(`${origin}/api/publish`,{method,headers,body:JSON.stringify(body)});
let version;
try {
  assert.equal((await fetch(`${origin}/api/publish`)).status,401);
  const image = await sharp({create:{width:16,height:16,channels:3,background:`#${id.slice(0,6)}`}}).jpeg().withMetadata({exif:{IFD0:{Artist:'PRIVATE-METADATA'}}}).toBuffer();
  const uploaded = await fetch(`${origin}/api/publish/assets`, {method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/jpeg'},body:image});
  assert.equal(uploaded.status,200,await uploaded.clone().text());
  const asset = await uploaded.json();
  assert.equal((await fetch(origin+asset.url)).status,404);
  const svgHeaders = {Authorization:`Bearer ${token}`,'Content-Type':'image/svg+xml'};
  const badSvg = await fetch(`${origin}/api/publish/assets`, {method:'POST',headers:svgHeaders,body:'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'});
  assert.equal(badSvg.status,422);
  const vectorUpload = await fetch(`${origin}/api/publish/assets`, {method:'POST',headers:svgHeaders,body:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><!-- private editor comment --><metadata>private source metadata</metadata><rect fill="#${id.slice(0,6)}" width="120" height="60"/><text x="10" y="30">Vector diagram</text></svg>`});
  assert.equal(vectorUpload.status,200,await vectorUpload.clone().text());
  const vector=await vectorUpload.json();
  assert.equal((await fetch(origin+vector.url)).status,404);
  const payload = {...meta,markdown:`# Verified\n\nPublished from a synthetic test.\n\n<span style="color:gray;font-size:.8em">Styled text</span>\n\n<table style="border-collapse:collapse"><caption>Styled table</caption><tr><td style="padding:.35rem .7rem;border:1px solid gray">Cell</td></tr></table>\n\n![Image](${asset.url})\n\n![Vector](${vector.url})`};
  await (await fetch(`${origin}/blog`)).text();
  const start=performance.now();
  const created=await send(payload);
  assert.equal(created.status,200,await created.clone().text());
  version=(await created.json()).post.revision;
  const listed=await (await fetch(`${origin}/blog`)).text();
  assert.ok(listed.includes(`/blog/${slug}`), 'New post missing from cached index');
  for (let i=0;i<3;i++) {
    const page=await fetch(`${origin}/blog/${slug}`);
    assert.equal(page.status,200);
    const html=await page.text();
    assert.match(html, /Published from a synthetic test/);
    assert.ok(html.includes('style="color:gray;font-size:.8em"'));
    assert.ok(html.includes('<caption>Styled table</caption>'));
    assert.ok(html.includes('style="padding:.35rem .7rem;border:1px solid gray"'));
    if (process.env.BLOG_EXPECT_CDN === '1' && i === 2) assert.equal(page.headers.get('x-vercel-cache'),'HIT');
  }
  await (await fetch(origin+asset.url)).arrayBuffer();
  const served=await fetch(origin+asset.url);
  assert.equal(served.status,200);
  const metadata=await sharp(Buffer.from(await served.arrayBuffer())).metadata();
  assert.equal(metadata.exif,undefined); assert.equal(metadata.xmp,undefined);
  const vectorRead=await fetch(origin+vector.url);
  assert.equal(vectorRead.headers.get('content-type'),'image/svg+xml');
  assert.match(vectorRead.headers.get('content-security-policy'),/sandbox/);
  const vectorText=await vectorRead.text();
  assert.match(vectorText, /Vector diagram/);
  assert.doesNotMatch(vectorText,/private|metadata|<!--/);
  const update=await send({...payload,baseVersion:version,markdown:'# Updated\n\nVisible immediately.'});
  assert.equal(update.status,200,await update.clone().text());
  const next=(await update.json()).post.revision;
  const previous=version;
  version=next;
  assert.match(await (await fetch(`${origin}/blog/${slug}`)).text(), /Visible immediately/);
  const read=await fetch(`${origin}/api/blog/posts/${slug}`);
  assert.match((await read.json()).html,/Visible immediately/);
  console.log(`Create, image, update and immediate reads passed in ${Math.round(performance.now()-start)} ms.`);
  assert.equal((await send({...payload,baseVersion:previous,markdown:'Stale'})).status,409);
  assert.equal((await send({...payload,baseVersion:version,markdown:'Local /Users/test/private.md'})).status,422);
  assert.equal((await send({...payload,baseVersion:version,markdown:'<span style="background:url(https://example.com/tracker)">Unsafe CSS</span>'})).status,422);
  assert.match((await (await fetch(`${origin}/api/blog/posts/${slug}`)).json()).html,/Visible immediately/);
  assert.equal((await fetch(origin+asset.url)).status,404);
  assert.equal((await fetch(origin+vector.url)).status,404);
  const unchanged=await fetch(`${origin}/api/blog/posts/${slug}?revision=${version}`);
  assert.equal(unchanged.status,200);
  assert.deepEqual(await unchanged.json(),{revision:version});
  console.log('Authentication, metadata stripping, stale-write rejection, privacy rejection, unchanged prior content, and removed-image access passed.');
} finally {
  const state=await (await fetch(`${origin}/api/publish`,{headers})).json();
  const current=state.posts.find(p=>p.id===id);
  if (current?.published) {
    const deleted=await send({id,baseVersion:current.revision},'DELETE');
    assert.equal(deleted.status,200,await deleted.clone().text());
    const removed=await fetch(`${origin}/blog/${slug}`);
    assert.equal(removed.status,404,`Unpublish read: ${JSON.stringify(Object.fromEntries(removed.headers))}`);
    assert.ok(!(await (await fetch(`${origin}/blog`)).text()).includes(`/blog/${slug}`), 'Unpublished post remains in cached index');
    console.log('Temporary post unpublished; its URL returns 404 and it is absent from the index.');
  }
}
