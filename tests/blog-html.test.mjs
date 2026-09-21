import test from 'node:test';
import assert from 'node:assert/strict';
import { exportNote } from '../src/lib/blog/export.mjs';
import { renderPost } from '../src/lib/blog/render.mjs';

const styled = `<span style="color: gray; font-size: 0.8em;">Small **gray** text</span>

<div style="display:flex;gap:2rem;flex-wrap:wrap;align-items:flex-start">
<table style="border-collapse:collapse">
<caption style="text-align:center;font-weight:600;padding-bottom:.45rem">Comparison</caption>
<tr><th style="padding:.35rem .7rem;border:1px solid rgba(128,128,128,.35);font-weight:600;text-align:left;background:rgba(128,128,128,.12)">Method</th></tr>
<tr><td style="padding:.35rem .7rem;border:1px solid rgba(128,128,128,.35);white-space:nowrap">First</td></tr>
</table>
</div>

<span style=opacity:0.6>Muted text</span>`;

test('preserves styled HTML tables, captions, flex layout and inline Markdown formatting', async () => {
  const exported = await exportNote(styled);
  assert.match(exported.markdown, /style="color: gray; font-size: 0.8em;"/);
  const { html } = await renderPost(exported.markdown);
  for (const fragment of ['color: gray; font-size: 0.8em;', '<strong>gray</strong>', 'display:flex;gap:2rem;', '<caption style=', '<th style=', '<td style=', 'white-space:nowrap', 'style="opacity:0.6"']) assert.ok(html.includes(fragment), fragment);
});

test('rejects active HTML and resource-loading, escaped, malformed or dynamic CSS on both paths', async () => {
  const examples = [
    '<span style="background:url(https://example.com/image)">x</span>',
    '<div style="background:URL(https://example.com/image)">x</div>',
    '<div style="background:u&#114;l(https://example.com/image)">x</div>',
    '<span style="color:expression(alert(1))">x</span>',
    '<span style="color:var(--private)">x</span>',
    '<span style="@import \'https://example.com/style\';">x</span>',
    '<span style="color:red; broken">x</span>',
    '<div style="position:fixed;top:0">x</div>',
    '<template><span style="background:url(https://example.com/image)">x</span></template>',
    String.raw`<span style="background:u\72l(https://example.com/image)">x</span>`,
    '<span onclick="alert(1)" style="color:gray">x</span>',
    '<script>alert(1)</script>',
    '<style>body{display:none}</style>',
    '<span style="background:url(file:///Users/alice/private)">x</span>',
    '<a href="javascript:alert(1)">x</a>',
  ];
  for (const input of examples) {
    await assert.rejects(exportNote(input), undefined, input);
    await assert.rejects(renderPost(input), undefined, input);
  }
});

test('HTML styles are checked even on an isolated opening table-cell tag', async () => {
  await assert.rejects(exportNote('<td style="background:url(https://example.com/image)">'));
  const {html} = await renderPost('<span style="color&#58;gray">Safe</span>');
  assert.match(html, /style="color:gray"/);
});
