// Measures HTTP response time, not browser paint time. Pass a published post slug.
const [slug, origin = 'https://naman.world'] = process.argv.slice(2);
if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw new Error('Usage: node scripts/blog/measure.mjs POST_SLUG [ORIGIN]');
const results = {};
for (const path of ['/', '/blog', `/blog/${slug}`]) {
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const start = performance.now();
    const response = await fetch(origin + path);
    const ttfb = Math.round(performance.now() - start);
    await response.arrayBuffer();
    samples.push({ status: response.status, ttfb, total: Math.round(performance.now() - start), cache: response.headers.get('x-vercel-cache') });
  }
  results[path] = { first: samples[0], repeatMedian: samples.slice(1).map(s => s.ttfb).sort((a,b) => a-b)[2], samples };
}
console.log(JSON.stringify(results, null, 2));
