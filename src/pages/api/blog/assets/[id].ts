import type { APIRoute } from 'astro';
import { blogStore } from '../../../../lib/blog/store.mjs';
import { noCache, blogPageHeaders } from '../../../../lib/blog/http.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ params }) => {
  if (!/^[a-f0-9]{64}$/.test(params.id || '')) return new Response('Not found', { status: 404, headers: noCache });
  try {
    const asset = await blogStore().asset(params.id);
    if (!asset) return new Response('Not found', { status: 404, headers: noCache });
    return new Response(asset.bytes, { headers: { ...blogPageHeaders, 'Content-Type': 'image/webp', 'Content-Disposition': 'inline' } });
  } catch { return new Response('Temporarily unavailable', { status: 503, headers: noCache }); }
};
