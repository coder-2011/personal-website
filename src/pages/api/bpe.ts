import type { APIRoute } from 'astro';
import { handleBpeRequest } from '../../lib/bpe/api.mjs';

export const prerender = false;

export const ALL: APIRoute = ({ request }) => handleBpeRequest(request);
