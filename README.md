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
Vercel Firewall rule `BPE API rate limit` caps `/api/bpe` requests at 30 per
60 seconds per IP before function execution. The rule is managed in Vercel,
separately from deployments. Do not replace it with an in-memory counter.

Run API validation with `node --test tests/bpe.test.mjs`, then `npm run build`.
For a native Obsidian embed, paste raw HTML rather than a fenced code block:

```html
<iframe src="https://naman.world/embeds/bpe.html" title="GPT-2 BPE tokenization" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" style="width:100%; height:980px; border:0; border-radius:8px;"></iframe>
```

`node scripts/bpe-embed.mjs | pbcopy` copies the hosted iframe. It needs an
internet connection. Install the two files in
`integrations/obsidian/bpe-embed-resize/` into your vault's
`.obsidian/plugins/bpe-embed-resize/`, then enable **BPE Embed Resize** in
Obsidian. The helper automatically grows and shrinks this iframe as the
animation or note width changes. Other Markdown hosts retain the fallback
height unless they implement the same `bpe:height` message handler.

## Notes

- The site intentionally has a sparse, dark, personal visual style rather than a generic portfolio template.
- Several `.agents/skills` files are tracked in this repo as local skill snapshots; they are not part of the website runtime.
- Image assets under `public/projects` support the project pages.
