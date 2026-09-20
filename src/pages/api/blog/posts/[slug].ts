import type { APIRoute } from 'astro';
import { blogStore } from '../../../../lib/blog/store.mjs';
import { json, noCache } from '../../../../lib/blog/api.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ params, request }) => {
  try {
    const post = await blogStore().post(params.slug);
    if (!post) return json({ error: 'Post not found.' }, 404);
    if (request.headers.get('if-none-match') === post.revision) return new Response(null, { status: 304, headers: noCache });
    return json({ title: post.title, description: post.description, date: post.date, html: post.html, revision: post.revision, updated: post.updated });
  } catch { return json({ error: 'Temporarily unavailable.' }, 503); }
};
