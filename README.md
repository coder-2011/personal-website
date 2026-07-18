# personal-website

This is Naman Chetwani's personal Astro site. It is a small Vercel-deployed site for biography, projects, reading notes, and a `/kairos` redirect path.

## What the site contains

```text
src/pages/index.astro             Home page
src/pages/about.astro             Personal notes, beliefs, contact
src/pages/things-ive-done.astro   Projects and accomplishments
src/pages/reading.astro           Reading list and recurring inputs
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

## Notes

- The site intentionally has a sparse, dark, personal visual style rather than a generic portfolio template.
- Several `.agents/skills` files are tracked in this repo as local skill snapshots; they are not part of the website runtime.
- Image assets under `public/projects` and `public/reading` support the project and reading pages.
