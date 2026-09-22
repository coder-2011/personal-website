import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { createHash, randomUUID } from 'node:crypto';
import { PublishError } from './privacy.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');

export function createBlogStore(blobs, prefix = 'blog') {
  const indexPath = `${prefix}/index.json`;
  async function index() {
    const stored = await blobs.read(indexPath);
    return { entries: stored ? JSON.parse(stored.text) : [], etag: stored?.etag };
  }
  async function list() { return (await index()).entries; }
  async function mutate(change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { entries, etag } = await index();
      const result = await change(entries);
      if (!result.changed) return result.entry;
      try {
        await blobs.write(indexPath, JSON.stringify(entries), etag);
        return result.entry;
      } catch (error) {
        if (!blobs.conflict(error)) throw error;
      }
    }
    throw new PublishError('Another publication is in progress. Retry in a moment.', 409);
  }
  async function publish(input) {
    const { baseVersion, ...content } = input;
    const hash = digest(JSON.stringify(content));
    const revision = randomUUID();
    const updated = new Date().toISOString();
    const revisionPath = `${prefix}/revisions/${input.id}/${revision}.json`;
    let written = false;
    return mutate(async entries => {
      const prior = entries.find(p => p.id === input.id);
      if (prior?.published && prior.hash === hash) return { changed: false, entry: prior };
      if ((prior?.revision || null) !== baseVersion) throw new PublishError('This post changed elsewhere. Refresh its saved revision in the publishing panel before replacing it.', 409);
      if (prior && prior.slug !== input.slug) throw new PublishError('The published URL is permanent. Keep the original slug.');
      if (entries.some(p => p.slug === input.slug && p.id !== input.id)) throw new PublishError('This URL belongs to another post. Choose a different slug.', 409);
      // Validate first: idempotent retries and rejected edits need no new blob.
      // A competing index write can retry this callback; reuse the immutable revision.
      if (!written) {
        await blobs.write(revisionPath, JSON.stringify({ ...content, revision, updated }));
        written = true;
      }
      const entry = { id: input.id, slug: input.slug, title: input.title, description: input.description, date: input.date, assets: input.assets, revision, updated, hash, published: true };
      if (prior) entries.splice(entries.indexOf(prior), 1, entry); else entries.push(entry);
      return { changed: true, entry };
    });
  }
  async function unpublish(id, baseVersion) {
    return mutate(entries => {
      const entry = entries.find(p => p.id === id);
      if (!entry) throw new PublishError('Post not found.', 404);
      if (!entry.published) return { changed: false, entry };
      if (entry.revision !== baseVersion) throw new PublishError('This post changed elsewhere. Refresh its saved revision first.', 409);
      entry.published = false;
      entry.revision = randomUUID();
      entry.updated = new Date().toISOString();
      return { changed: true, entry };
    });
  }
  async function post(slug, knownRevision) {
    const entry = (await list()).find(p => p.slug === slug && p.published);
    if (!entry) return null;
    if (knownRevision === entry.revision) return { revision: entry.revision };
    const value = await blobs.read(`${prefix}/revisions/${entry.id}/${entry.revision}.json`);
    if (!value) throw new Error('Published revision is missing.');
    return JSON.parse(value.text);
  }
  async function putAsset(bytes, contentType = 'image/webp') {
    const id = digest(bytes);
    await blobs.write(`${prefix}/assets/${id}`, bytes, undefined, contentType, true);
    return id;
  }
  async function assetExists(id) { return !!await blobs.read(`${prefix}/assets/${id}`, true); }
  async function asset(id) {
    if (!(await list()).some(p => p.published && p.assets.includes(id))) return null;
    return blobs.read(`${prefix}/assets/${id}`, true);
  }
  return { list, publish, unpublish, post, putAsset, assetExists, asset };
}

export function blogStore() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new PublishError('Publishing storage is not configured.', 503);
  const namespace = process.env.BLOG_NAMESPACE || (process.env.VERCEL_ENV === 'production' ? 'production' : 'development');
  if (!/^[a-z0-9-]+$/.test(namespace)) throw new Error('Invalid blog namespace.');
  return createBlogStore({
    async read(path, binary = false) {
      // Compression changes the HTTP ETag to a weak validator, which Blob rejects on conditional writes.
      const result = await get(path, { access: 'private', useCache: false, token, headers: { 'Accept-Encoding': 'identity' } });
      if (!result || result.statusCode !== 200) return null;
      const response = new Response(result.stream);
      return binary ? { bytes: new Uint8Array(await response.arrayBuffer()), contentType: result.blob.contentType, etag: result.blob.etag }
        : { text: await response.text(), etag: result.blob.etag };
    },
    async write(path, content, etag, contentType = 'application/json', immutable = false) {
      try {
        return await put(path, content, { access: 'private', token, contentType, addRandomSuffix: false, ...(etag ? { ifMatch: etag } : {}), cacheControlMaxAge: 60 });
      } catch (error) {
        if (immutable && /already exists/i.test(error.message)) return;
        throw error;
      }
    },
    conflict: error => error instanceof BlobPreconditionFailedError || /already exists/i.test(error.message),
  }, `blog/${namespace}`);
}
