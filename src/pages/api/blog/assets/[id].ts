import type { APIRoute } from 'astro';
import { blogStore } from '../../../../lib/blog/store.mjs';
import { noCache, blogPageHeaders } from '../../../../lib/blog/http.mjs';
export const prerender = false;
export const GET: APIRoute = async ({ params, locals }) => {
  if (!/^[a-f0-9]{64}$/.test(params.id || '')) return new Response('Not found', { status: 404, headers: noCache });
  try {
    const asset = await blogStore(locals.runtime).asset(params.id);
    if (!asset) return new Response('Not found', { status: 404, headers: noCache });
    return new Response(asset.bytes, { headers: { ...blogPageHeaders, 'Content-Type': asset.contentType === 'image/svg+xml' ? 'image/svg+xml' : 'image/webp', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Content-Disposition': 'inline' } });
  } catch { return new Response('Temporarily unavailable', { status: 503, headers: noCache }); }
};
