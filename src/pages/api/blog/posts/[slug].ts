import type { APIRoute } from 'astro';
import { blogStore } from '../../../../lib/blog/store.mjs';
import { readingSummary } from '../../../../lib/blog/reading.mjs';
import { json, blogPageHeaders } from '../../../../lib/blog/http.mjs';
import { presentPostForReading } from '../../../../lib/blog/code-upgrade.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ params, request }) => {
  try {
    const revision = new URL(request.url).searchParams.get('revision');
    const post = await blogStore().post(params.slug, revision);
    if (!post) return json({ error: 'Post not found.' }, 404);
    // A tiny 200 response is CDN-cacheable. Publishing/unpublishing purges the
    // same tag as the pages, so polling does not spend one Blob read per second.
    if (revision === post.revision) return Response.json({ revision: post.revision }, { headers: blogPageHeaders });
    const html = await presentPostForReading(post.html, post.markdown);
    return Response.json({ title: post.title, description: post.description, date: post.date, html, readingSummary: readingSummary(html), revision: post.revision, updated: post.updated }, { headers: blogPageHeaders });
  } catch { return json({ error: 'Temporarily unavailable.' }, 503); }
};
