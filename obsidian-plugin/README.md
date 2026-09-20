# Naman Publish

Select a note, review exactly what will leave the vault, and publish it to `naman.world/blog`. Live sync uploads saved changes while Obsidian is open. The website renders content on upload and reads the latest stored revision without a deployment. Open post pages check for updates every three seconds while visible.

## Using it

1. Right-click a note → **Publish to naman.world**, or run **Naman Publish: Publish current note** from the command palette.
2. Set the public title, stable URL, date, description, and whether saved edits should sync automatically.
3. Choose **Review publication**. Review the exported Markdown, link warnings, and images, then **Publish now**.
4. Click the send icon or **Naman Publish: Manage published notes** to select multiple notes, open posts, copy links, pause live sync, or unpublish.

The plugin stores its publishing key in Obsidian Secret Storage. The API authenticates every write; the browser receives no credentials. Only notes first approved through the plugin are automatically synced, even if another note already has `publish: true`.

Published notes receive `publish`, `blog_id`, `blog_slug`, `blog_title`, `blog_date`, `blog_description`, and `blog_live` properties. Renaming or moving the note keeps its URL. The URL is locked after first publication. Setting `publish: false` unpublishes an approved note. Local deletion pauses syncing and leaves an explicit unpublish action in the panel rather than turning an accidental local deletion into immediate public removal.

Turn live sync off before making edits you do not want immediately public. Failed checks leave the prior website version intact. Network failures retry on reconnect and every 30 seconds; ordinary saves start immediately. Conflicting revisions require reviewing the local note before replacing the remote copy.

## Publication boundary

- All frontmatter except the explicitly selected public fields is excluded from the payload.
- Obsidian `%%comments%%` and HTML comments are removed, including unfinished comments during editing.
- Common local paths, `file:` / `obsidian:` URLs, private network addresses, encoded variants, and recognizable credentials block publication, including inside code blocks and public metadata. Errors identify the line and category without repeating sensitive text.
- Links to published notes become stable website links. Links to unpublished notes become plain text; following a link never publishes its destination.
- PNG, JPEG and WebP attachments are resolved inside the vault and re-encoded locally before upload, stripping filenames and EXIF/GPS metadata. The server validates and re-encodes them again. Uploaded images are private until referenced by a published post, and cease being served when no current published post references them.
- SVG attachments stay vector. Both the plugin and server remove comments and editor metadata, scan decoded text and attributes for private paths, and reject scripts, external resources, embedded HTML, and animation. Static shapes, text, gradients, internal references, filters, and presentation styles are supported.
- The server repeats the text checks and sanitizes rendered HTML. JavaScript and arbitrary iframe embeds are rejected; the two public naman.world tokenizer embeds are explicitly supported.

These checks cannot determine whether ordinary prose or pixels in an image are confidential. The first-publication review is still essential. Private revisions are retained in the storage account; unpublishing removes the live route and image access, not copies readers may already have saved.

Supported: Markdown, GFM tables/task lists, code highlighting, footnotes, math, callouts, published-note heading links, raster images, SVG attachments, and tokenizer iframes. Embedded notes, block references, PDFs, canvases, Dataview and Mermaid blocks produce a clear error instead of silently publishing incorrect content. Convert these to ordinary Markdown or supported images first.

## Development and installation

```sh
npm run plugin:check
npm run plugin:build
node scripts/blog/install-plugin.mjs '/path/to/test-vault' http://127.0.0.1:4321
```

Enable **Naman Publish** in that vault's Community plugins. Set the website origin and publishing key in its settings, then test the connection. The installer can receive `BLOG_PUBLISH_TOKEN` in its environment; it writes a mode-0600 bootstrap file which the plugin migrates into Secret Storage and removes from plugin data when loaded.

Use a separate test vault and `BLOG_NAMESPACE=publishing-lab`. Never point synthetic test notes at production except for a deliberately temporary integration check. `node --env-file=.env.local scripts/blog/integration.mjs` verifies the real API and private store, then unpublishes its synthetic note.

The plugin requires Obsidian 1.11.4 or newer and currently targets desktop.
