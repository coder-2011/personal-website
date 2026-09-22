// Keep saved Obsidian records and old links working after this URL rename.
export const canonicalBlogSlug = slug => slug === 'snaptokens-blog' ? 'snaptokens' : slug;

export function redirectBlogAlias(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  const match = url.pathname.match(/^(\/blog\/|\/api\/blog\/posts\/)([^/]+)\/?$/);
  if (!match || canonicalBlogSlug(match[2]) === match[2]) return null;
  url.pathname = match[1] + canonicalBlogSlug(match[2]);
  return Response.redirect(url, 301);
}
