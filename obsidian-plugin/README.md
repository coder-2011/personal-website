# Naman Publish

Select a note, review exactly what will leave the vault, and publish it to `naman.world/blog`. Live sync uploads saved changes after two seconds without typing or further changes while Obsidian is open. Each edit restarts that wait; reconnects and background checks respect it too. The website renders content on upload and reads the latest stored revision without a deployment. Open post pages check the current publication index every second while visible; hidden pages stop polling. Publishing and unpublishing take effect immediately. Existing readers keep their current version until they choose **Update article** from a small notice; new visitors immediately see the latest version. Applying an update keeps the current paragraph at the same scroll position when possible.

## Using it

Only individual Markdown notes can be published. Folders are never expanded or published, and a selection containing a folder has no publish action. Select multiple notes explicitly to publish a batch.

1. Right-click a note → **Publish to naman.world**, or run **Naman Publish: Publish current note** from the command palette.
2. Set the public title, stable URL, date, description, and whether saved edits should sync automatically.
3. Choose **Review publication**. Review the exported Markdown, link warnings, and images, then **Publish now**. With multiple notes, enter each note's details, choose **Review all notes**, then **Publish all N notes**. Every note must pass the privacy checks before the batch can start. If an upload fails, review again to retry only the remaining notes; successfully published notes are kept.
4. Click the send icon or **Naman Publish: Manage published notes** to select multiple notes, edit their public details, open posts, copy links, pause live sync, or unpublish.

**Edit details** opens the saved title, date, and description in full-width fields. Choose **Review changes**, then **Update post**. The review includes the latest saved note as well as its public details. The URL stays fixed and Live Sync keeps the setting shown in the dialog. The update button spins until the server accepts the changes. Cancel leaves the saved details untouched; validation and network failures keep your entries available for retry. If Live Sync changes the post after review, review again before updating.

The plugin stores its publishing key in Obsidian Secret Storage. The API authenticates every write; the browser receives no credentials. Only notes first approved through the plugin are automatically synced, even if another note already has `publish: true`.

Installing or copying the plugin grants no access to this website. Listing publication state, creating or updating posts, uploading images, and unpublishing all require the website's private publishing key. The server checks it before reading an upload or accessing storage. Anyone holding that key has full publishing access, so do not share the configured key or a configured vault. The plugin source and distributable contain no configured publishing key.

Publishing information is entered in the dialog and stored in this vault's plugin data, including the note's identity, public title, URL, date, description, and live-sync setting. Publishing, pausing, and unpublishing do not modify the Markdown file. A note needs no frontmatter. Existing `blog_*` properties remain usable as initial defaults for older publications; after a reviewed publication, the plugin's saved details take precedence. Keep the plugin data when moving a vault to another computer. Renaming or moving a note within the vault keeps its URL, which is locked after first publication. Use the panel to pause or unpublish. Local deletion pauses syncing and leaves an explicit unpublish action rather than turning an accidental deletion into immediate public removal.

Turn live sync off before making edits you do not want immediately public. While it is off, an **Update** button appears beside the published note. It publishes the latest saved text with the same privacy checks, shows a spinner until the update finishes, and leaves live sync off. An in-flight live upload finishes before the manual update starts; failures keep the prior public version and allow retrying. Failed checks leave the prior website version intact. Background catch-up compares notes locally without fetching the remote list. Network failures retry on reconnect and every 30 seconds; ordinary saves upload as soon as the two-second idle period ends. If typing resumes during preparation or image upload, the pending article is discarded and prepared again after you stop. A request already sent to the server can finish while you resume typing; subsequent edits wait for idle again. Conflicting revisions require reviewing the local note before replacing the remote copy.

Unchanged attachments are reused during the current Obsidian session: the plugin hashes their actual bytes, reuses already sanitized image data, and skips uploads already completed for the same website. Text-only edits therefore avoid repeating image conversion and uploads. Changed bytes still go through all privacy checks. These caches are bounded in memory and are not written into plugin settings.

## Publication boundary

- All frontmatter except the explicitly selected public fields is excluded from the payload.
- Obsidian `%%comments%%` and HTML comments are removed, including unfinished comments during editing.
- Common local paths, `file:` / `obsidian:` URLs, private network addresses, encoded variants, and recognizable credentials block publication, including inside code blocks and public metadata. Errors identify the line and category without repeating sensitive text.
- Links to published notes become stable website links. Links to unpublished notes become plain text; following a link never publishes its destination.
- PNG, JPEG and WebP attachments are resolved inside the vault and re-encoded locally before upload, stripping filenames and EXIF/GPS metadata. The server validates and re-encodes them again. Uploaded images are private until referenced by a published post, and cease being served when no current published post references them.
- SVG attachments stay vector. Both the plugin and server remove comments and editor metadata, scan decoded text and attributes for private paths, and reject scripts, external resources, embedded HTML, and animation. Static shapes, text, gradients, internal references, filters, and presentation styles are supported.
- The server repeats the text checks and sanitizes rendered HTML. JavaScript and arbitrary iframe embeds are rejected; the two public naman.world tokenizer embeds are explicitly supported.

These checks cannot determine whether ordinary prose or pixels in an image are confidential. The first-publication review is still essential. Private revisions are retained in the storage account; unpublishing removes the live route and image access, not copies readers may already have saved.

Supported: Markdown, GFM tables/task lists, code highlighting, footnotes, inline `$…$` math and display `$$…$$` math (including same-line display equations), callouts, published-note heading links, raster images, SVG attachments, and tokenizer iframes. HTML text, tables, captions, and flex layouts can use inline colors, typography, spacing, borders, and sizing. Scripts, event handlers, style blocks, positioning, CSS variables, and CSS resource loads remain blocked; use Markdown for links and images. Embedded notes, block references, PDFs, canvases, Dataview and Mermaid blocks produce a clear error instead of silently publishing incorrect content. Convert these to ordinary Markdown or supported images first.

## Development and installation

```sh
npm run plugin:check
npm run plugin:build
node scripts/blog/install-plugin.mjs '/path/to/test-vault' http://127.0.0.1:4321
```

Enable **Naman Publish** in that vault's Community plugins. Set the website origin and publishing key in its settings, then test the connection. The installer can receive `BLOG_PUBLISH_TOKEN` in its environment; it writes a mode-0600 bootstrap file which the plugin migrates into Secret Storage and removes from plugin data when loaded.

Use a separate test vault and `BLOG_NAMESPACE=publishing-lab`. Never point synthetic test notes at production except for a deliberately temporary integration check. `node --env-file=.env.local scripts/blog/integration.mjs` verifies the real API and private store, then unpublishes its synthetic note.

The plugin requires Obsidian 1.11.4 or newer and currently targets desktop.
