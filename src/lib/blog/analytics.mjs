import { createHmac } from 'node:crypto';
import { authenticate, readBody } from './api.mjs';
import { blogStore } from './store.mjs';
import { PublishError } from './privacy.mjs';
import { json, noCache } from './http.mjs';

const DAY = 86_400_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const origins = new Set(['https://naman.world', 'https://www.naman.world']);

export async function recordVisit(request, runtime, now = Date.now()) {
  try {
    if (request.method !== 'POST') return json({error:'Use POST.'}, 405);
    if (!origins.has(new URL(request.url).origin) || request.headers.get('origin') !== new URL(request.url).origin ||
        !['same-origin', null].includes(request.headers.get('sec-fetch-site'))) return json({error:'Invalid origin.'}, 403);
    if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return new Response(null, {status:204, headers:noCache});
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({error:'Use JSON.'}, 415);
    const env = runtime.env;
    if (!env.ANALYTICS_DB || !env.ANALYTICS_SECRET || !env.ANALYTICS_LIMIT) return json({error:'Analytics unavailable.'}, 503);
    const {success} = await env.ANALYTICS_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') || 'unknown'});
    if (!success) return json({error:'Too many visits.'}, 429);
    let input;
    try { input = JSON.parse((await readBody(request, 256)).toString('utf8')); }
    catch (error) { if (error instanceof PublishError) throw error; return json({error:'Invalid visit.'}, 400); }
    if (!input || !uuid.test(input.visitorId) || (input.postId !== null && !uuid.test(input.postId))) return json({error:'Invalid visit.'}, 400);
    if (input.postId && !(await blogStore(runtime).list()).some(p => p.id === input.postId && p.published)) return json({error:'Post not found.'}, 404);
    // Store only a keyed hash of a random browser ID. No IP, UA, referrer,
    // note content, URL, or individual pageview history enters the database.
    const visitor = createHmac('sha256', env.ANALYTICS_SECRET).update(input.visitorId).digest('hex');
    const targets = input.postId ? ['site', input.postId] : ['site'];
    await env.ANALYTICS_DB.batch([
      ...targets.map(target => env.ANALYTICS_DB.prepare(
        'INSERT INTO visitors (target, visitor, last_seen) VALUES (?, ?, ?) ON CONFLICT (target, visitor) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen)'
      ).bind(target, visitor, now)),
      env.ANALYTICS_DB.prepare('DELETE FROM visitors WHERE last_seen < ?').bind(now - 90 * DAY),
    ]);
    return new Response(null, {status:204, headers:noCache});
  } catch (error) {
    return json({error:error instanceof PublishError ? error.message : 'Analytics unavailable.'}, error instanceof PublishError ? error.status : 503);
  }
}

export async function visitorCounts(request, runtime, now = Date.now()) {
  try {
    authenticate(request, runtime.env);
    if (request.method !== 'GET') return json({error:'Use GET.'}, 405);
    const db = runtime.env.ANALYTICS_DB;
    if (!db) return json({error:'Visitor counts are not configured yet.'}, 503);
    const since = now - 30 * DAY;
    const [entries, counts, meta] = await Promise.all([
      blogStore(runtime).list(),
      db.prepare('SELECT target, COUNT(*) AS visitors FROM visitors WHERE last_seen >= ? GROUP BY target').bind(since).all(),
      db.prepare("SELECT value FROM analytics_meta WHERE key = 'started_at'").first(),
    ]);
    if (!counts.success || !meta) throw new Error('Missing analytics data');
    const byTarget = new Map(counts.results.map(row => [row.target, row.visitors]));
    return json({days:30, since:Math.max(since, meta.value), startedAt:meta.value, asOf:now,
      siteVisitors:byTarget.get('site') || 0,
      posts:Object.fromEntries(entries.filter(p => p.published).map(p => [p.id, byTarget.get(p.id) || 0])),
    });
  } catch (error) {
    return json({error:error instanceof PublishError ? error.message : 'Visitor counts are temporarily unavailable. Try Refresh.'}, error instanceof PublishError ? error.status : 503);
  }
}
