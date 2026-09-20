export const noCache = { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const json = (data, status = 200) => Response.json(data, { status, headers: noCache });

export const blogCacheTag = 'naman-blog-v1';
export const blogPageHeaders = {
  ...noCache,
  'Vercel-CDN-Cache-Control': 'public, max-age=3600',
  'Vercel-Cache-Tag': blogCacheTag,
};

export async function refreshBlogCache() {
  if (process.env.VERCEL !== '1') return;
  const { dangerouslyDeleteByTag } = await import('@vercel/functions');
  // Hard expiry prevents the next visitor receiving an old or unpublished post.
  await dangerouslyDeleteByTag(blogCacheTag, { revalidationDeadlineSeconds: 0 });
}
