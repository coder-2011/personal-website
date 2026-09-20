import type { APIRoute } from 'astro';

export const prerender = false;
export const ALL: APIRoute = async ({ request }) => {
  const { handleBpeRequest } = await import('../../lib/bpe/api.mjs');
  return handleBpeRequest(request);
};
