import type { APIRoute } from 'astro';
import { visitorCounts } from '../../../lib/blog/analytics.mjs';
export const prerender = false;
export const ALL: APIRoute = ({request, locals}) => visitorCounts(request, locals.runtime);
