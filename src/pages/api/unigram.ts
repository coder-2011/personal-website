import type { APIRoute } from 'astro';
import { handleUnigramRequest } from '../../lib/unigram/api.mjs';

export const prerender = false;
export const ALL: APIRoute = ({ request }) => handleUnigramRequest(request);
