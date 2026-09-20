# personal-website

This is Naman Chetwani's personal Astro site. It is a small Vercel-deployed site for biography, projects, and a `/kairos` redirect path.

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

The Astro adapter is configured for Vercel in `astro.config.mjs`.

```bash
npm run build
```

The default dev server binds to host `0.0.0.0` on port `3000` through the Astro config and package scripts.

## BPE animation

`/embeds/bpe.html` is a standalone HTML frontend. It uses `/api/bpe` on
localhost and `https://naman.world/api/bpe` when embedded elsewhere. The API
runs in the existing Vercel Node function and uses the pinned GPT-2 vocabulary
in `src/data/`; the browser only renders the returned merge trace.

Send `POST /api/bpe` with `Content-Type: application/json` and
`{"text":"my name is naman"}`. The result contains GPT-2 token IDs, text pieces,
and animation frames. Input is limited to 160 UTF-8 bytes, with a 2 KiB body
limit and a three-second body-read deadline. Requests are not stored or logged
by this handler, and responses use `Cache-Control: no-store`.

This is intentionally a public, credential-free API. Wildcard CORS permits
standalone and sandboxed iframe frontends; it is not an authentication barrier.
Vercel Firewall rule `Tokenizer API rate limit` caps requests across `/api/bpe`
and `/api/unigram` at 30 per 60 seconds per IP before function execution. The rule is managed in Vercel,
separately from deployments. Do not replace it with an in-memory counter.

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

Both endpoints share the Vercel firewall limit described above.

## Obsidian blog publishing

`/blog` lists published notes and the existing essays; `/blogs` redirects there. `/blog/[slug]` renders the latest stored HTML on demand. Visible pages check for updates every three seconds. Existing essay URLs are preserved.

The desktop plugin and its usage instructions live in [`obsidian-plugin/README.md`](obsidian-plugin/README.md). Notes are explicitly reviewed before first publication; subsequent approved saves can sync immediately. Both the plugin and server enforce the publication boundary in `src/lib/blog/`.

The publishing API requires `BLOG_PUBLISH_TOKEN` (at least 32 characters) and `BLOB_READ_WRITE_TOKEN` for a private Vercel Blob store. `BLOG_NAMESPACE` separates environments; without an override only Vercel's production environment uses `production`, and other runtimes use `development`. Use `publishing-lab` locally. Never put these keys in browser code or tracked files.

`POST /api/publish` renders and publishes a note; `GET` lists authenticated publication state; `DELETE` unpublishes it. Writes use stable note IDs, immutable revisions, and conditional index writes to reject stale replacements. Image uploads use `POST /api/publish/assets`, and public image reads require a reference from a current published post. Storage reads bypass the Blob CDN cache. Public HTML and images are cached on Vercel’s edge for up to one hour; successful publish and unpublish requests await a hard purge of the shared blog cache tag, then warm and verify the list and post page before reporting success. Live polling and authenticated requests remain uncached. Failed cache refreshes return an error so the plugin retries the saved operation. Unpublished revisions remain private for recovery.

Validation:

```sh
npm run plugin:check
npm run plugin:build
npm run test:blog
npm run build
node --env-file=.env.local scripts/blog/integration.mjs
```

The integration command requires a running local site at `127.0.0.1:4321`, or an explicit `BLOG_TEST_ORIGIN`. It creates and unpublishes a synthetic post and verifies authentication, images, privacy failures, stale updates, and immediate reads.

## Page loading

The main layout serves and preloads Inter as a local WOFF2 file, avoiding external font stylesheets. Browser icons are generated at 32 and 180 pixels, and project images use responsive WebP variants generated at build time. Primary navigation and blog links prefetch on hover. Tokenizer models, Markdown rendering, and image processing initialize only when their API needs them. An unchanged live poll reads only the current post index.

`node scripts/blog/measure.mjs POST_SLUG` reports first and repeated HTTP response timings. These are network response measurements, not browser paint measurements. Run `BLOG_EXPECT_CDN=1 BLOG_TEST_ORIGIN=https://naman.world node --env-file=.env.local scripts/blog/integration.mjs` to verify actual cache hits, then immediate update and unpublish behavior against production using a temporary synthetic post.

## Site notes

- The site intentionally has a sparse, dark, personal visual style rather than a generic portfolio template.
- Several `.agents/skills` files are tracked in this repo as local skill snapshots; they are not part of the website runtime.
- Image assets under `public/projects` support the project pages.
