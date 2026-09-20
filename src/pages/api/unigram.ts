import type { APIRoute } from 'astro';

export const prerender = false;
export const ALL: APIRoute = async ({ request }) => {
  const { handleUnigramRequest } = await import('../../lib/unigram/api.mjs');
  return handleUnigramRequest(request);
};
