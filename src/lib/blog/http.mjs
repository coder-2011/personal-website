export const noCache = { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const json = (data, status = 200) => Response.json(data, { status, headers: noCache });

export const blogCacheTag = 'naman-blog-v1';
export const blogPageHeaders = {
  ...noCache,
  'Vercel-CDN-Cache-Control': 'public, max-age=3600',
  'Vercel-Cache-Tag': blogCacheTag,
};

export async function refreshBlogCache(post) {
  if (process.env.VERCEL !== '1') return;
  const { dangerouslyDeleteByTag } = await import('@vercel/functions');
  // Hard expiry prevents serving stale content while a page revalidates.
  await dangerouslyDeleteByTag(blogCacheTag, { revalidationDeadlineSeconds: 0 });
  if (process.env.VERCEL_ENV !== 'production') return;
  // Use the public origin: Astro intentionally replaces untrusted request hosts with localhost.
  const origin = 'https://naman.world';
  // Purge propagation can outlast the purge call. Warm and verify both public pages
  // before acknowledging publication, so the first click does not pay their storage reads.
  const deadline = Date.now() + 5000;
  await Promise.all(['/blog', `/blog/${post.slug}`].map(async path => {
    while (Date.now() < deadline) {
      const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      const html = await response.text();
      const cached = response.headers.get('x-vercel-cache') === 'HIT';
      if (post.published && cached && response.ok && html.includes(`data-revision="${post.revision}"`)) return;
      if (!post.published && (path === '/blog'
        ? cached && response.ok && !html.includes(`data-post-id="${post.id}"`)
        : response.status === 404)) return;
    }
    throw new Error('Public page cache has not refreshed.');
  }));
}
