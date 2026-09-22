import { noCache } from './http.mjs';

export async function cachedBlogResponse({ request, entries, version, build, namespace, cache, waitUntil }, next) {
  const url = new URL(request.url);
  const slug = url.pathname.match(/^\/api\/blog\/posts\/([^/]+)\/?$/)?.[1];
  const unchanged = slug && entries.some(post => post.published && post.slug === slug && post.revision === url.searchParams.get('revision'));
  // Never include arbitrary reader query strings in the cache key. There are just
  // two API representations for each revision: changed content and unchanged.
  url.search = new URLSearchParams({ build, namespace, version, unchanged: String(!!unchanged) }).toString();
  url.pathname = `/__blog_cache${url.pathname}`;
  const key = new Request(url);
  const cached = await cache.match(key);
  if (cached) return forReader(cached, 'HIT');
  const response = await next();
  if (response.status !== 200 || response.headers.has('Set-Cookie')) return response;
  const copy = new Response(response.clone().body, response);
  copy.headers.set('Cache-Control', 'public, max-age=86400');
  copy.headers.delete('CDN-Cache-Control');
  waitUntil(cache.put(key, copy).catch(() => {}));
  return forReader(response, 'MISS');
}

function forReader(response, state) {
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(noCache)) result.headers.set(key, value);
  result.headers.set('X-Blog-Cache', state);
  return result;
}
