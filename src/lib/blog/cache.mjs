import { noCache, blogPageHeaders } from './http.mjs';

export async function cachedBlogResponse({ request, entries, version, build, namespace, cache, waitUntil }, next) {
  const url = new URL(request.url);
  const slug = url.pathname.match(/^\/(?:blog|api\/blog\/posts)\/([^/]+)\/?$/)?.[1];
  const post = slug && entries.find(post => post.published && post.slug === slug);
  const asset = url.pathname.match(/^\/api\/blog\/assets\/([a-f0-9]{64})\/?$/)?.[1];
  if (slug && !post || asset && !entries.some(post => post.published && post.assets.includes(asset))) return next();
  // The fresh index already answers unchanged polls; skip both the cache and route.
  if (post && url.pathname.startsWith('/api/') && post.revision === url.searchParams.get('revision')) {
    return Response.json({ revision: post.revision }, { headers: blogPageHeaders });
  }
  // A browser may reuse image bytes only after this request's visibility check.
  if (asset && request.headers.get('If-None-Match')?.split(',').some(value => value.trim().replace(/^W\//, '') === `"${asset}"`)) {
    return new Response(null, { status: 304, headers: { ...noCache, 'Cache-Control': 'private, no-cache', ETag: `"${asset}"` } });
  }
  // Unrelated publications must not evict a post or its immutable images.
  // Arbitrary reader query strings never become cache keys.
  url.search = new URLSearchParams({ build, namespace, version: post ? post.revision : asset || version }).toString();
  url.pathname = `/__blog_cache${url.pathname}`;
  const key = new Request(url);
  const cached = await cache.match(key);
  if (cached) return forReader(cached, 'HIT', asset);
  const response = await next();
  if (response.status !== 200 || response.headers.has('Set-Cookie')) return response;
  const copy = new Response(response.clone().body, response);
  copy.headers.set('Cache-Control', 'public, max-age=86400');
  copy.headers.delete('CDN-Cache-Control');
  waitUntil(cache.put(key, copy).catch(() => {}));
  return forReader(response, 'MISS', asset);
}

function forReader(response, state, asset) {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(noCache)) result.headers.set(key, value);
  result.headers.set('X-Blog-Cache', state);
  if (asset) {
    result.headers.set('Cache-Control', 'private, no-cache');
    result.headers.set('ETag', `"${asset}"`);
  }
  return result;
}
