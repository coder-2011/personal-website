// Measures HTTP response time, not browser paint time. Pass a published post slug.
const [slug, origin = 'https://naman.world'] = process.argv.slice(2);
if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Usage: node scripts/blog/measure.mjs POST_SLUG [ORIGIN]');
const results = {};
async function measure(path) {
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const response = await fetch(origin + path);
    const ttfb = Math.round(performance.now() - start);
    const bytes = (await response.arrayBuffer()).byteLength;
    samples.push({ status: response.status, ttfb, total: Math.round(performance.now() - start), bytes, cache: response.headers.get('x-blog-cache') || response.headers.get('cf-cache-status'), timing: response.headers.get('server-timing') });
  }
  results[path] = { first: samples[0], repeatMedian: samples.slice(1).map(s => s.ttfb).sort((a,b) => a-b)[2], samples };
}
for (const path of ['/', '/blog', `/blog/${slug}`]) await measure(path);
const post = await (await fetch(`${origin}/api/blog/posts/${slug}`)).json();
if (post.revision) await measure(`/api/blog/posts/${slug}?revision=${encodeURIComponent(post.revision)}`);
for (const path of new Set(post.html?.match(/\/api\/blog\/assets\/[a-f0-9]{64}/g) || [])) await measure(path);
console.log(JSON.stringify(results, null, 2));
