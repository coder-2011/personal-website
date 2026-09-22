# Performance measurements — September 21, 2026

Baseline: `e8e8b8a`. Runtime changes: `0b25b92` through `a6738ac`.
Production: Cloudflare Worker version `84f2424d-e150-41f3-be45-8fcdd6a0b4b5`.
Raw samples: [performance-2026-09-21.json](performance-2026-09-21.json).

## Measured changes

| Work | Before | After | Scope |
| --- | ---: | ---: | --- |
| BPE trace response | 2.58 ms | 1.10 ms | Local Node handler including complete response consumption; 2.37× paired geometric-mean speedup |
| Snaptokens catalogue + reading summary | 16.26 ms | 10.26 ms | Local preparation of the same 219,689-byte public HTML, with identical output |
| ET Book font files, all three faces | 133,160 bytes | 109,816 bytes | 17.5% less font data; all glyph outlines, mappings, and spacing preserved |
| Catalogue heading geometry reads | 10,000 per 100 scroll events | 0 per scroll event | 100-heading fixture; initial layout still measures 100 headings, as does a later layout change |
| Text-only edit with unchanged image | Upload on each publication | One upload per session and destination while retained in cache | Plugin tests verify changed image bytes and destination changes still upload |

The BPE comparison uses four inputs: a short sentence, repeated prose, Unicode,
and 160 repeated characters. Both handlers use the same engine and model.
Every full JSON response is compared before timing. Twelve paired rounds
alternate order, with 24 complete requests per round. The checked-in benchmark
also discards four warm-up rounds. Its repeat measured 2.48 → 0.99 ms and a
2.61× paired speedup. These are handler timings, not production network latency.

Article preparation compares the previous separate catalogue/reading parses
with one shared parse. Sixteen recorded rounds follow four discarded warm-up
rounds, with alternating order and exact result equality. The repeat measured
21.14 → 12.27 ms. Mac scheduling and garbage collection affect absolute timings;
both comparisons show less CPU work, not a whole-page speedup of that size.

## Production HTTP timings

Each entry is the median of five repeated requests after an initial request,
measured from this Mac to `naman.world`. This is time to response headers, not
paint or interactivity. The runs were sequential and are not a controlled
network experiment.

| Route | Before | After, run 1 | After, run 2 |
| --- | ---: | ---: | ---: |
| `/` | 37 ms | 33 ms | 45 ms |
| `/blog` | 105 ms | 105 ms | 103 ms |
| `/blog/snaptokens-blog` | 111 ms | 101 ms | 143 ms |
| Unchanged article poll | Not recorded | 84 ms | 109 ms |

These samples do **not** establish an improvement in end-to-end page latency.
`Server-Timing` now separates the strongly consistent R2 index read from the
remaining response work. For example, the final Snaptokens sample in run 1 took
48 ms for the index and 2 ms for the cached response. The index check remains
mandatory so unpublishing immediately prevents new reads of cached content.
Browser automation timed out, so no new LCP, INP, CLS, or visual result is claimed.

## Changes beyond the CPU benchmarks

- A cache miss reuses its request's index instead of fetching it again. Unchanged
  polls return immediately from the fresh index without reading the response cache.
- Posts cache by their own revision and images by content hash. Editing an
  unrelated post no longer evicts them. Every cache access still checks visibility.
- Images use private browser caching with mandatory revalidation. A visible image
  can return an empty `304`; a withdrawn image returns `404` even with its old ETag.
- Publication checks image existence with concurrent R2 metadata requests rather
  than downloading every image sequentially.
- Font declarations are bundled into page CSS and tokenizer embeds, removing a
  stylesheet loading dependency. WOFF2 files have immutable caching and sandbox CORS.
- Tokenizer models initialize only for valid trace requests; legacy math and code
  renderers load only when an old article needs repair.
- Obsidian 1.2.11 keeps bounded, content-hashed image preparation/upload caches.
  Actual bytes are checked on each export. Privacy validation and the two-second
  idle wait remain in place.
- The catalogue caches heading positions until layout changes. Hidden tabs stop
  live-update timers and resume immediately when visible; readers still choose
  when to apply an article update.

## Verification and reproduction

All 100 automated tests passed, as did plugin type checking, plugin build, and
the production Astro build. The plugin was installed and reloaded in Obsidian.
Production integration checks passed for publishing, immediate updates, stale
writes, metadata stripping, unsafe SVG/CSS rejection, local-path rejection,
cache hits, conditional images, withdrawal, and unpublishing. Temporary test
posts were unpublished. Both deployed tokenizer responses matched the local
handlers; model validation and OPTIONS responses passed. Deployed fonts and
embeds matched build bytes. The Snaptokens page contained no `katex-error` markup.

```sh
node --test tests/*.test.mjs
npm run plugin:check
npm run plugin:build
npm run build
node scripts/measure-cpu.mjs
node scripts/blog/measure.mjs snaptokens-blog
BLOG_EXPECT_CDN=1 BLOG_TEST_ORIGIN=https://naman.world \
  node --env-file=.env.local scripts/blog/integration.mjs
```

The CPU script accepts a baseline commit and a public post JSON URL. Its default
baseline comparison isolates the old BPE handler against the current engine and
model, which were unchanged in this pass. The post fixture comes from the live
site and may change after this measurement. The integration command temporarily
publishes synthetic content and requires the existing publishing credential.
