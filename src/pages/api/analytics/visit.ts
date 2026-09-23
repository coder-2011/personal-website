import type { APIRoute } from 'astro';
import { recordVisit } from '../../../lib/blog/analytics.mjs';
export const prerender = false;
export const ALL: APIRoute = ({request, locals}) => recordVisit(request, locals.runtime);
