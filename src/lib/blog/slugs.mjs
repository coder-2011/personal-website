// Upgrade the original one-off rename once. Subsequent URL changes are recorded
// on the post, so they work without another site deployment.
export function upgradeBlogAliases(entry) {
  if (entry.aliases) return;
  entry.aliases = [];
  if (['snaptokens-blog', 'snaptokens'].includes(entry.slug)) {
    entry.slug = 'snaptokens';
    entry.aliases.push('snaptokens-blog');
  }
}

export function redirectBlogAlias(request, entries) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  const match = url.pathname.match(/^(\/blog\/|\/api\/blog\/posts\/)([^/]+)\/?$/);
  if (!match) return null;
  const post = entries.find(entry => entry.published && entry.aliases?.includes(match[2]));
  if (!post) return null;
  url.pathname = match[1] + post.slug;
  // Recheck on the next visit: another rename or unpublish can change the target.
  return new Response(null, {status:301, headers:{Location:url.href, 'Cache-Control':'private, no-store', 'CDN-Cache-Control':'no-store'}});
}
