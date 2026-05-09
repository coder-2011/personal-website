# AGENTS.md for `personal_website`

## 1) Source-of-truth model

- `personal_website` is the detailed, editable source for your public content.
- `github.com/coder-2011/coder-2011` (`README.md`) is the compact profile copy.
- Treat GitHub as a **minimal summary** of the stronger narrative already maintained on the website.

## 2) What lives where

- Keep deep context, long-form writing, detailed project breakdowns, and experiments in `personal_website`.
- Keep GitHub to a clean snapshot:
  - concise identity
  - core interests
  - flagship projects (short list)
  - essential contact links

## 3) Update flow

- Default editing flow: update `personal_website` first, then mirror a condensed version to GitHub when the change is representational or portfolio-significant.
- For any external project-facing claim, keep the website as the canonical text and let GitHub be the shortened version.
- Prefer small, frequent, clean edits with low churn.

## 4) Cross-repo information ingestion

- When adding project/content updates, pull the following from other repositories’ docs first when available:
  - that repository’s `AGENTS.md`
  - that repository’s public-facing `README.md`
- This keeps statements consistent across profiles and avoids contradictory claims.
- If a repo AGENTS conflicts with this file, follow the more specific repo instruction for that repo’s content and then sync the chosen summary to this site and GitHub.

## 5) Conflict and maintenance rules

- Never force GitHub to carry verbose or experimental details that break its clean look.
- If a detail is too complex for GitHub, keep it on `personal_website` and add a short reference on GitHub only.
- Keep this file updated when your public positioning, profile strategy, or cross-repo sync preferences change.

## 6) Version control

- Make frequent, atomic commits in this repo so content updates are recoverable and reviewable.
- Keep commit messages descriptive and scoped to the smallest meaningful change.
