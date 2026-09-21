import type { APIRoute } from 'astro';
import { blogStore } from '../../../../lib/blog/store.mjs';
import { json, noCache } from '../../../../lib/blog/http.mjs';
import { presentPost } from '../../../../lib/blog/presentation.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ params, request }) => {
  try {
    const revision = new URL(request.url).searchParams.get('revision');
    const post = await blogStore().post(params.slug, revision);
    if (!post) return json({ error: 'Post not found.' }, 404);
    if (revision === post.revision) return new Response(null, { status: 204, headers: noCache });
    return json({ title: post.title, description: post.description, date: post.date, html: presentPost(post.html, post.markdown), revision: post.revision, updated: post.updated });
  } catch { return json({ error: 'Temporarily unavailable.' }, 503); }
};
