import { timingSafeEqual } from 'node:crypto';
import { blogStore } from './store.mjs';
import { PublishError, validateMetadata } from './privacy.mjs';

import { json, refreshBlogCache } from './http.mjs';
export { json, noCache } from './http.mjs';

async function refreshPublishedPages(post) {
  try { await refreshBlogCache(post); }
  catch { throw new PublishError('The post was saved, but refreshing the website failed. Retry to finish updating the public pages.', 503); }
}

function authenticate(request) {
  const secret = process.env.BLOG_PUBLISH_TOKEN;
  if (!secret || secret.length < 32) throw new PublishError('Publishing is not configured.', 503);
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new PublishError('Check the publishing key in plugin settings.', 401);
}

async function readBody(request, max) {
  if (Number(request.headers.get('content-length')) > max) throw new PublishError('Upload is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PublishError('Missing request body.', 400);
  const chunks = [];
  let size = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel(); }, 10_000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (expired) throw new PublishError('Upload timed out.', 408);
      if (done) break;
      size += value.length;
      if (size > max) { void reader.cancel(); throw new PublishError('Upload is too large.', 413); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function publishingRequest(request, mode = 'posts') {
  try {
    authenticate(request);
    const store = blogStore();
    if (mode === 'assets' && request.method === 'POST') {
      if (!/^image\/(png|jpeg|webp)$/.test(request.headers.get('content-type') || '')) throw new PublishError('Only PNG, JPEG, and WebP images are supported.');
      const bytes = await readBody(request, 3_500_000);
      let safe;
      try {
        const { default: sharp } = await import('sharp');
        const image = sharp(bytes, { limitInputPixels: 25_000_000, animated: false });
        const metadata = await image.metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('format');
        safe = await image.rotate().webp({ quality: 90 }).toBuffer();
      } catch { throw new PublishError('This image could not be safely decoded. Use a PNG, JPEG, or WebP under 25 megapixels.'); }
      const id = await store.putAsset(safe);
      return json({ id, url: `/api/blog/assets/${id}` });
    }
    if (mode !== 'posts') return json({error:'Use POST.'}, 405);
    if (request.method === 'GET') return json({ posts: await store.list() });
    if (!['POST', 'DELETE'].includes(request.method)) return json({error:'Use GET, POST, or DELETE.'}, 405);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new PublishError('Use JSON.', 415);
    let input;
    try { input = JSON.parse((await readBody(request, 350_000)).toString('utf8')); }
    catch (error) { if (error instanceof PublishError) throw error; throw new PublishError('Invalid JSON.', 400); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublishError('Invalid post.', 400);
    if (request.method === 'DELETE') {
      if (!/^[a-f0-9-]{36}$/.test(input.id || '') || !/^[a-f0-9-]{36}$/.test(input.baseVersion || '')) throw new PublishError('Invalid post revision.');
      const post = await store.unpublish(input.id, input.baseVersion);
      await refreshPublishedPages(post);
      return json({ post });
    }
    const meta = validateMetadata(input);
    if (typeof input.markdown !== 'string' || !input.markdown.trim() || Buffer.byteLength(input.markdown) > 250_000) throw new PublishError('Use between 1 and 250,000 bytes of Markdown.');
    const { renderPost } = await import('./render.mjs');
    const rendered = await renderPost(input.markdown);
    const assets = [...new Set([...rendered.html.matchAll(/\/api\/blog\/assets\/([a-f0-9]{64})/g)].map(m => m[1]))];
    if (assets.length > 30) throw new PublishError('Use at most 30 images per post.');
    for (const id of assets) if (!await store.assetExists(id)) throw new PublishError('An image upload is missing. Publish the note again.');
    const post = await store.publish({ ...meta, ...rendered, assets });
    await refreshPublishedPages(post);
    return json({ post, url: `/blog/${post.slug}` });
  } catch (error) {
    if (error instanceof PublishError) return json({ error: error.message }, error.status);
    // Do not log request bodies, provider errors, or credentials.
    return json({ error: 'Publishing storage is temporarily unavailable. Your previous post is unchanged; retry shortly.' }, 503);
  }
}
