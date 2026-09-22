export const noCache = { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const json = (data, status = 200) => Response.json(data, { status, headers: noCache });

// Cloudflare's internal response cache is keyed by the current publication revision.
// Browsers always check again, so unpublishing cannot leave a browser-cached copy.
export const blogPageHeaders = noCache;
