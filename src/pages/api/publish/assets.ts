import type { APIRoute } from 'astro';
import { publishingRequest } from '../../../lib/blog/api.mjs';
export const prerender = false;
export const ALL: APIRoute = ({ request }) => publishingRequest(request, 'assets');
