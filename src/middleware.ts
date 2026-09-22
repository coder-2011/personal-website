import { defineMiddleware } from 'astro:middleware';
import { blogStore, digest } from './lib/blog/store.mjs';
import { cachedBlogResponse } from './lib/blog/cache.mjs';
import { redirectBlogAlias } from './lib/blog/slugs.mjs';

export const onRequest = defineMiddleware(async ({ request, url, locals }, next) => {
  const redirect = redirectBlogAlias(request);
  if (redirect) return redirect;
  if (['/api/bpe', '/api/unigram'].includes(url.pathname) && locals.runtime?.env.TOKENIZER_LIMIT) {
    const { success } = await locals.runtime.env.TOKENIZER_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
    if (!success) return Response.json({ error: 'Too many requests. Try again in a minute.' }, {
      status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  }
  if (request.method !== 'GET' || !locals.runtime?.env.BLOG_BUCKET ||
      !/^(?:\/blog(?:\/[^/]+)?|\/api\/blog\/(?:posts|assets)\/[^/]+)\/?$/.test(url.pathname)) return next();
  try {
    // Always consult R2's strongly consistent index before serving a cached page.
    // Old revisions and images become inaccessible as soon as unpublish succeeds.
    const start = performance.now();
    const entries = await blogStore(locals.runtime).list();
    const checked = performance.now();
    // Reuse this request's visibility check on a miss; never retain it across requests.
    locals.blogEntries = entries;
    const version = digest(JSON.stringify(entries.map(({ id, revision, published }) => [id, revision, published])));
    const response = await cachedBlogResponse({
      request, entries, version,
      build: import.meta.env.SITE_BUILD_ID,
      namespace: locals.runtime.env.BLOG_NAMESPACE,
      cache: locals.runtime.caches.default,
      waitUntil: promise => locals.runtime.ctx.waitUntil(promise),
    }, next);
    response.headers.set('Server-Timing', `index;dur=${(checked - start).toFixed(1)}, response;dur=${(performance.now() - checked).toFixed(1)}`);
    return response;
  } catch {
    // Do not serve a cached publication if its current visibility cannot be checked.
    return new Response('Temporarily unavailable. Please try again shortly.', {
      status: 503, headers: { 'Cache-Control': 'private, no-store' },
    });
  }
});
