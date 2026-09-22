import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { visit } from 'unist-util-visit';
import { exportNote } from './export.mjs';
import { assertPublicText } from './privacy.mjs';
import { presentPost } from './presentation.mjs';
import { codeTheme } from './code-theme.mjs';

function callouts() {
  return tree => visit(tree, 'blockquote', node => {
    const text = node.children[0]?.children?.[0];
    const match = text?.type === 'text' && text.value.match(/^\[!([\w-]+)\][+-]?\s*/);
    if (!match) return;
    text.value = text.value.slice(match[0].length) || match[1];
    node.data = { hProperties: { className: ['blog-callout'] } };
  });
}

const schema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...defaultSchema.tagNames, 'iframe', 'caption'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes['*'] || []), 'style'],
    code: [...(defaultSchema.attributes.code || []), ['className', /^language-/, 'math-inline', 'math-display']],
    span: ['className', 'style'],
    pre: ['className', 'style', 'tabIndex'],
    blockquote: ['className'],
    iframe: ['src', 'title', 'sandbox', 'referrerPolicy', 'loading'],
  },
};
let processor;

export async function renderPost(markdown) {
  // The server repeats the export checks; a client cannot bypass the publication boundary.
  const result = await exportNote(markdown);
  processor ??= createMarkdownProcessor({
    remarkPlugins: [remarkMath, callouts],
    rehypePlugins: [rehypeRaw, [rehypeSanitize, schema], [rehypeKatex, { trust: false, strict: 'ignore' }]],
    shikiConfig: { theme: codeTheme },
  });
  const rendered = await (await processor).render(result.markdown);
  const html = presentPost(rendered.code, result.markdown);
  assertPublicText(html, 'Rendered post');
  return { markdown: result.markdown, html };
}
