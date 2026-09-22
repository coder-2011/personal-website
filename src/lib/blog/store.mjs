import { createHash, randomUUID } from 'node:crypto';
import { PublishError } from './privacy.mjs';
import { upgradeBlogAliases } from './slugs.mjs';

export const digest = value => createHash('sha256').update(value).digest('hex');

export function createBlogStore(blobs, prefix = 'blog') {
  const indexPath = `${prefix}/index.json`;
  async function index() {
    const stored = await blobs.read(indexPath);
    const entries = stored ? JSON.parse(stored.text) : [];
    for (const entry of entries) upgradeBlogAliases(entry);
    return { entries, etag: stored?.etag };
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
    const { baseVersion, previousSlug, ...submitted } = input;
    const revision = randomUUID();
    const updated = new Date().toISOString();
    const revisionPath = `${prefix}/revisions/${input.id}/${revision}.json`;
    let written = false;
    return mutate(async entries => {
      const prior = entries.find(p => p.id === input.id);
      // An already-open plugin can still submit an old URL. A normal save follows
      // the current URL; only a reviewed, explicit rename can change it again.
      const slug = previousSlug === undefined && prior?.aliases.includes(input.slug) ? prior.slug : input.slug;
      const content = { ...submitted, slug };
      const hash = digest(JSON.stringify(content));
      if (prior?.published && prior.hash === hash) return { changed: false, entry: prior };
      if ((prior?.revision || null) !== baseVersion) throw new PublishError('This post changed elsewhere. Refresh its saved revision in the publishing panel before replacing it.', 409);
      if (previousSlug !== undefined && previousSlug !== prior?.slug) throw new PublishError('The current URL changed. Reopen Edit details and review the new URL again.', 409);
      if (prior && prior.slug !== slug && previousSlug === undefined) throw new PublishError('Use Change URL and confirm the new address before publishing.');
      if (entries.some(p => p.aliases.includes(slug) || (p.slug === slug && p.id !== input.id))) throw new PublishError('This URL belongs to another post or is reserved by an old link. Choose a different slug.');
      const aliases = prior ? [...prior.aliases] : [];
      if (prior && prior.slug !== slug) aliases.push(prior.slug);
      // Validate first: idempotent retries and rejected edits need no new blob.
      // A competing index write can retry this callback; reuse the immutable revision.
      if (!written) {
        await blobs.write(revisionPath, JSON.stringify({ ...content, revision, updated }));
        written = true;
      }
      const entry = { id: input.id, slug, aliases, title: input.title, description: input.description, date: input.date, assets: input.assets, revision, updated, hash, published: true };
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
  async function post(slug, knownRevision, entries) {
    const entry = (entries ?? await list()).find(p => p.slug === slug && p.published);
    if (!entry) return null;
    if (knownRevision === entry.revision) return { revision: entry.revision };
    const value = await blobs.read(`${prefix}/revisions/${entry.id}/${entry.revision}.json`);
    if (!value) throw new Error('Published revision is missing.');
    return { ...JSON.parse(value.text), slug: entry.slug };
  }
  async function putAsset(bytes, contentType = 'image/webp') {
    const id = digest(bytes);
    await blobs.write(`${prefix}/assets/${id}`, bytes, undefined, contentType, true);
    return id;
  }
  async function assetExists(id) {
    const path = `${prefix}/assets/${id}`;
    return blobs.exists ? await blobs.exists(path) : !!await blobs.read(path, true);
  }
  async function asset(id, entries) {
    if (!(entries ?? await list()).some(p => p.published && p.assets.includes(id))) return null;
    return blobs.read(`${prefix}/assets/${id}`, true);
  }
  return { list, publish, unpublish, post, putAsset, assetExists, asset };
}

// R2 remains private. All reads go through the publication index, including assets.
export function blogStore(runtime = {}) {
  const { BLOG_BUCKET: bucket, BLOG_NAMESPACE: namespace = 'production' } = runtime.env || {};
  if (!bucket) throw new PublishError('Publishing storage is not configured.', 503);
  if (!/^[a-z0-9-]+$/.test(namespace)) throw new Error('Invalid blog namespace.');
  return createBlogStore({
    async exists(path) { return !!await bucket.head(path); },
    async read(path, binary = false) {
      const result = await bucket.get(path);
      if (!result) return null;
      return binary ? { bytes: new Uint8Array(await result.arrayBuffer()), contentType: result.httpMetadata?.contentType, etag: result.etag }
        : { text: await result.text(), etag: result.etag };
    },
    async write(path, content, etag, contentType = 'application/json', immutable = false) {
      // A missing ETag means create-only, including the very first index write.
      // R2's conditional put keeps concurrent publications from overwriting one another.
      const result = await bucket.put(path, content, {
        onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType },
      });
      if (!result && !immutable) throw new StorageConflict();
    },
    conflict: error => error instanceof StorageConflict,
  }, `blog/${namespace}`);
}
class StorageConflict extends Error {}
