# personal-website

This is Naman Chetwani's personal Astro site. It is a small Cloudflare-hosted site for biography, projects, and a `/kairos` redirect path.

## What the site contains

```text
src/pages/index.astro             Home page
src/pages/things-ive-done.astro   Projects and accomplishments
src/pages/kairos.ts               Redirect endpoint for /kairos
src/pages/kairos/[...path].ts     Redirect endpoint for /kairos/*
src/lib/kairosRedirect.ts         Scraper-aware Kairos redirect helper
public/                           Images and robots policy
```

## Recent work reflected in commits

The recent history shows two main threads:

- Personal-site polish: navigation behavior, custom cursor, floating contact links, project-page formatting, and copy updates.
- Kairos routing: `/kairos` and `/kairos/*` redirect to the deployed Kairos app for normal users while returning `404` plus noindex/noarchive headers for scraper-like user agents. `public/robots.txt` also disallows `/kairos`.

## Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deployment

The Astro Cloudflare adapter builds a Worker and static assets. `wrangler.jsonc`
contains the account, private R2 bucket, Images binding, and tokenizer rate limit.
Runtime secrets (`BLOG_PUBLISH_TOKEN`, `OPENROUTER_API_KEY`) live in Worker secrets;
`.dev.vars` holds local equivalents and `BLOG_NAMESPACE="development"` (gitignored).
`PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` in `.env.production` is a public build-time Web
Analytics site token, not a credential.

```bash
npx wrangler login
npm run deploy
```

Use Workers Paid for publishing and tokenizer demos: rendering long articles can
exceed the free CPU allowance. R2 holds private revisions and images; do not enable
public bucket access. Domains are switched only after preview verification.
Vercel is no longer required at runtime. Existing Vercel data is retained as a backup.

```bash
npm run build
```

The default dev server binds to host `0.0.0.0` on port `3000` through the Astro config and package scripts.

## BPE animation

`/embeds/bpe.html` is a standalone HTML frontend. It uses `/api/bpe` on
localhost and `https://naman.world/api/bpe` when embedded elsewhere. The API
runs in the Cloudflare Worker and uses the pinned GPT-2 vocabulary
in `src/data/`; the browser only renders the returned merge trace.

Send `POST /api/bpe` with `Content-Type: application/json` and
`{"text":"my name is naman"}`. The result contains GPT-2 token IDs, text pieces,
and animation frames. Input is limited to 160 UTF-8 bytes, with a 2 KiB body
limit and a three-second body-read deadline. Requests are not stored or logged
by this handler, and responses use `Cache-Control: no-store`.

This is intentionally a public, credential-free API. Wildcard CORS permits
standalone and sandboxed iframe frontends; it is not an authentication barrier.
The Cloudflare `TOKENIZER_LIMIT` binding caps `/api/bpe` and `/api/unigram`
at 30 requests per 60 seconds per IP at each Cloudflare location. Middleware
checks the binding before running a tokenizer. These are approximate per-location
limits, not an in-memory application counter.

Run API validation with `node --test tests/bpe.test.mjs`, then `npm run build`.
For a native Obsidian embed, paste raw HTML rather than a fenced code block:

```html
<iframe src="https://naman.world/embeds/bpe.html" title="GPT-2 BPE tokenization" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" style="width:100%; height:1080px; border:0; border-radius:8px;"></iframe>
```

`node scripts/bpe-embed.mjs | pbcopy` copies the hosted iframe. It needs an
internet connection and no Obsidian plugin. Its fixed fallback height can
be adjusted in the embed when using a narrower note or longer input.

Both animations default to light mode. Dark styles are retained behind
`data-theme="dark"` on the document root; automatic theme detection and website
toggle integration are deferred until publication.

## Unigram animation

`/embeds/unigram.html` shows deterministic T5 Unigram encoding, with candidate
token spans, log-score calculations, comparisons against the saved score at the
same endpoint, and backward path selection with synchronized pseudocode. It also
shows unknown-character fallback, combines adjacent unknown IDs (including
`<unk>` spellings produced by normalization), and preserves explicit special tokens.
`POST /api/unigram` accepts the same `{ "text": "..." }` body as the BPE API. Both APIs share request size, timeout, Unicode validation,
and credential-free CORS handling. Unigram additionally caps normalized input
at 320 characters to bound trace size. T5's task-level end token is not appended.
The vocabulary and normalization map are pinned in `src/data/T5-SOURCE.md`.

`node scripts/unigram-embed.mjs | pbcopy` copies the standalone hosted iframe.
It uses the same deferred theme setup as BPE and requires no plugin.
Run both suites with `node --test tests/bpe.test.mjs tests/unigram.test.mjs`.

Both endpoints share the Cloudflare rate limit described above.

## Obsidian blog publishing

`/blog` lists published notes and the existing essays; `/blogs` redirects there. `/blog/[slug]` renders the latest stored HTML on demand. Visible pages check for updates every second; readers choose when to apply a new article version. Live saves wait for two idle seconds in Obsidian. Existing essay URLs are preserved.

The desktop plugin and its usage instructions live in [`obsidian-plugin/README.md`](obsidian-plugin/README.md). Notes are explicitly reviewed before first publication; subsequent approved saves can sync immediately. Both the plugin and server enforce the publication boundary in `src/lib/blog/`.

The publishing API requires `BLOG_PUBLISH_TOKEN` (at least 32 characters), a private
`BLOG_BUCKET` R2 binding, and the `IMAGES` binding. `BLOG_NAMESPACE` separates local
and production data. Never put secrets in browser code or tracked files.

`POST /api/publish` renders and publishes a note; `GET` lists authenticated
publication state; `DELETE` unpublishes it. R2 conditional writes serialize index
changes, including concurrent first publications. Identical retries create no new
revision. Confirmed URL changes retain the post identity and reserve previous URLs as redirects; all addresses stop serving the post when it is unpublished. Raster uploads are decoded and re-encoded to WebP through Cloudflare
Images to strip metadata; SVGs are sanitized separately on the server.

Public requests check R2's strongly consistent publication index before consulting
Cloudflare's response cache. Post keys use their own revision, image keys use their
content hash, and the blog list uses the current index revision; all include the
site build. Unrelated edits preserve cached posts and images. Images require a
reference from a current published post. HTML and API responses are never cached
by the browser. Images use private browser caching with mandatory revalidation;
even a `304` requires a fresh visibility check. Unpublished revisions remain
private for recovery. Each public request performs one index read, reused on a
cache miss. Unchanged live polls return directly from that index. `Server-Timing`
separates the index read from the remaining response work.

Validation:

```sh
npm run plugin:check
npm run plugin:build
npm run test:blog
npm run build
BLOG_TEST_ORIGIN=http://127.0.0.1:8787 node --env-file=.dev.vars scripts/blog/integration.mjs
```

Run `npm run preview` after building to test in the actual Workers runtime. The integration command uses `BLOG_TEST_ORIGIN` to select that server. It creates and unpublishes a synthetic post and verifies authentication, images, privacy failures, stale updates, and immediate reads.

## Page loading

The main layout serves ET Book as local WOFF2 files and preloads the roman face. Font declarations are bundled into the page stylesheet, avoiding another stylesheet request. Browser icons are generated at 32 and 180 pixels (`node scripts/optimize-icons.mjs` after changing the source logo), and project images use responsive WebP variants generated at build time. Primary navigation prefetches after page load; blog post links prefetch on hover. Slow connections and data-saving preferences are respected. Tokenizer models and legacy Markdown rendering initialize only when needed. Shared scripts are separate hashed assets; analytics initializes once. The cursor batches pointer events and stops animation frames when stationary, hidden, or on a touch device. The catalogue measures headings only when layout changes, and hidden tabs suspend live-update timers.

Tokenizer embeds include their default example, generated from the real models during `npm run build`, so the initial view makes no API request. Each embed keeps up to four recent results in memory for repeated inputs. `node scripts/build-embed-examples.mjs` refreshes those examples and their CSP hashes after editing an embed.

`node scripts/blog/measure.mjs POST_SLUG` reports first and repeated HTTP response timings. These are network response measurements, not browser paint measurements. Run `BLOG_EXPECT_CDN=1 BLOG_TEST_ORIGIN=https://naman.world node --env-file=.env.local scripts/blog/integration.mjs` to verify actual cache hits, then immediate update and unpublish behavior against production using a temporary synthetic post.

`node scripts/measure-cpu.mjs` compares BPE response generation against the pre-optimization handler and verifies identical JSON before timing. It also compares one versus two HTML parses on the public Snaptokens article. See [`docs/performance.md`](docs/performance.md) for measured results and their limits.

## Analytics

`src/scripts/analytics.mjs` sends one small, first-party request after a visible
production page loads. A random browser ID in local storage identifies repeat
visits; the server stores only its keyed hash and the latest visit time for the
site and each post in Cloudflare D1. No IP addresses, referrers, query strings,
reading history, or note content are stored. Inactive records expire after 90
days on the next recorded visit. Browser IDs expire after 90 days of inactivity.

`GET /api/publish/analytics` requires the existing publishing key and returns
estimated unique browsers for the last 30 days, including zeroes for published
posts without visitors. Post IDs survive URL changes, and the site total counts
a browser once even when it reads several posts. Statistics do not represent
verified people and cannot recover readership before installation. Blocked
storage, disabled tracking, different devices, and cleared storage affect counts.

Naman Publish displays these counts beside each published title on opening the
panel or clicking Refresh. Opening a post from the plugin adds
`#analytics-exclude`, which excludes that browser before any tracking request.
Visitors can change this preference at `/analytics`. Automation, previews,
iframes, unpublished posts, callbacks, Do Not Track, and Global Privacy Control
are excluded. Counting never blocks page rendering or publishing/live sync.

D1 schema: `migrations/analytics/0001_visitors.sql`. The Worker needs the
`ANALYTICS_DB` binding, `ANALYTICS_LIMIT` rate limiter, and a private random
`ANALYTICS_SECRET` (retain it across deployments). Apply the schema before first
deploy. Never put the secret in the plugin, public environment variables, or Git.
Historical Cloudflare Web Analytics and Vercel analytics remain in their original
dashboards; the first-party counter replaces the Cloudflare browser beacon.

## Site notes

- The site intentionally has a sparse, dark, personal visual style rather than a generic portfolio template.
- Several `.agents/skills` files are tracked in this repo as local skill snapshots; they are not part of the website runtime.
- Image assets under `public/projects` support the project pages.
