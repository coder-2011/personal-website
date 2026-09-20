import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { sanitizeSvg } from '../src/lib/blog/svg.mjs';
import { exportNote } from '../src/lib/blog/export.mjs';

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">${body}</svg>`;

test('SVG stays vector and preserves text, gradients, styles and internal references', async () => {
  const clean = sanitizeSvg(svg('<defs><linearGradient id="paint"><stop stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><path id="line" d="M0 0L20 20"/></defs><style>.box{fill:url(#paint);stroke:black}</style><rect class="box" width="120" height="60"/><use href="#line"/><text x="10" y="30" style="font-size:12px">A &amp; B</text>'));
  assert.match(clean, /linearGradient/);
  assert.match(clean, /A &amp; B/);
  assert.equal(sanitizeSvg(clean), clean);
  const rendered = await sharp(Buffer.from(clean)).png().toBuffer({resolveWithObject:true});
  assert.equal(rendered.info.width,120); assert.equal(rendered.info.height,60);
});

test('SVG removes comments and editor metadata before anything is uploaded', () => {
  const clean = sanitizeSvg(svg('<!-- /Users/alice/private.svg --><metadata><private>/Users/alice/private.svg</private></metadata><rect width="10" height="10"/>'));
  assert.doesNotMatch(clean, /Users|metadata|private|<!--/);
});

test('SVG rejects executable content, external references, CSS escapes and XML entities', () => {
  for (const body of [
    '<script>alert(1)</script>', '<rect onload="alert(1)"/>', '<foreignObject><div>HTML</div></foreignObject>',
    '<animate attributeName="href" to="https://example.com"/>', '<use href="https://example.com/x.svg#x"/>',
    '<image href="data:image/svg+xml,anything"/>', '<rect fill="url(https://example.com/image)"/>',
    '<style>@import "https://example.com/style.css";</style>', '<style>.x{fill:u\\72l(https://example.com/image)}</style>',
    '<rect style="fill:url(\\68 ttps://example.com/image)"/>', '<style>.x{fill:var(--remote)}</style>',
    '<g xml:base="https://example.com"><use href="#x"/></g>', '<?xml-stylesheet href="https://example.com/style"?>',
  ]) assert.throws(() => sanitizeSvg(svg(body)), undefined, body);
  for (const source of ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'+svg('<text>&x;</text>'), svg('<g>'), '<html/>', svg('<rect width="2" width="3"/>')]) assert.throws(() => sanitizeSvg(source));
});

test('SVG privacy checks include decoded labels and attributes without echoing the secret', () => {
  for (const body of ['<text>/Users/alice/private.svg</text>', '<text>&#47;Users/alice/private.svg</text>', '<path id="file:///Users/alice"/>']) {
    assert.throws(() => sanitizeSvg(svg(body)), error => /local file path/.test(error.message) && !error.message.includes('alice'));
  }
});

test('SVG attachments work in Obsidian and Markdown embeds with opaque public URLs', async () => {
  const seen = [];
  const result = await exportNote('![[diagram.svg]]\n\n![A diagram](diagram.svg)', {asset:async path => { seen.push(path); return '/api/blog/assets/'+'b'.repeat(64); }});
  assert.deepEqual(seen,['diagram.svg','diagram.svg']);
  assert.doesNotMatch(result.markdown,/diagram\.svg/);
});
