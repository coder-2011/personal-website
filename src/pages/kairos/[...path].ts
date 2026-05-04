import type { APIRoute } from "astro";

import { handleKairosRequest } from "../../lib/kairosRedirect";

export const prerender = false;

export const GET: APIRoute = ({ request }) => handleKairosRequest(request);
export const HEAD: APIRoute = ({ request }) => handleKairosRequest(request);
