import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkStringify from 'remark-stringify';
import { slug as headingSlug } from 'github-slugger';
import { PublishError, stripPrivateContent, assertPublicText, publicUrl } from './privacy.mjs';
import { validateHtmlStyles } from './html.mjs';
import { separateTableParagraphs } from './tables.mjs';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkStringify, { fences: true, bullet: '-' });

// resolveNote returns only an explicitly published note's public URL; asset never receives an absolute path.
export async function exportNote(source, { resolveNote, asset } = {}) {
  const clean = stripPrivateContent(source);
  assertPublicText(clean);
  const tree = parser.parse(separateTableParagraphs(clean));
  const definitions = new Map();
  const warnings = new Set();
  for (const node of tree.children) if (node.type === 'definition') definitions.set(node.identifier, node);

  async function link(target, label, embed) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(target)) {
      if (!publicUrl(target, { image: embed })) throw new PublishError('A link points outside the supported public URLs.');
      return embed ? { type: 'image', url: target, alt: label || 'Image' } : { type: 'link', url: target, children: [{ type: 'text', value: label || target }] };
    }
    const [path, fragment] = target.split('#');
    if (embed && /\.(?:png|jpe?g|webp|svg)$/i.test(path)) {
      if (!asset) throw new PublishError('An image has not been uploaded.');
      const url = await asset(path);
      return { type: 'image', url, alt: label && !/^\d+(?:x\d+)?$/.test(label) ? label : 'Image' };
    }
    if (embed) throw new PublishError('Embedded notes, PDFs, canvases, and other files need to be converted to text or a PNG/JPEG/WebP/SVG image before publishing.');
    if (!path && fragment) return { type: 'link', url: `#${headingSlug(fragment)}`, children: [{type:'text', value:label || fragment}] };
    const published = await resolveNote?.(path);
    if (!published) {
      warnings.add('Links to unpublished notes were converted to plain text.');
      return { type: 'text', value: label || path.split('/').pop().replace(/\.md$/, '') };
    }
    if (fragment?.startsWith('^')) throw new PublishError('Block links are not supported; link to a heading instead.');
    return { type: 'link', url: published + (fragment ? `#${headingSlug(fragment)}` : ''), children: [{type:'text', value:label || path.split('/').pop().replace(/\.md$/, '')}] };
  }

  async function walk(parent) {
    const output = [];
    for (const node of parent.children || []) {
      if (node.type === 'definition') continue;
      if (node.type === 'code' && /^(?:dataview|dataviewjs|mermaid|query)$/i.test(node.lang || '')) throw new PublishError('Convert plugin-generated blocks to plain Markdown before publishing.');
      if (node.type === 'html') {
        // Retain only known public tokenizer frames; other HTML is handled by the server sanitizer.
        if (/<iframe\b/i.test(node.value)) {
          const src = node.value.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
          if (!/^https:\/\/naman\.world\/embeds\/(bpe|unigram)\.html$/.test(src || '')) throw new PublishError('Only the public naman.world tokenizer iframes are supported.');
          node.value = `<iframe src="${src}" title="Tokenizer animation" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" loading="lazy"></iframe>`;
        } else if (/<\/?(?:script|style|object|embed|form|input|base|meta|link)\b|\bon\w+\s*=|\b(?:src|href|srcset)\s*=/i.test(node.value)) {
          throw new PublishError('Scripts, event handlers, and active HTML cannot be published. Use Markdown for links and images.');
        } else {
          validateHtmlStyles(node.value);
        }
      }
      if (node.type === 'text' && /!?\[\[/.test(node.value)) {
        let end = 0;
        for (const match of node.value.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
          if (match.index > end) output.push({type:'text', value:node.value.slice(end, match.index)});
          const [target, ...alias] = match[2].split('|');
          output.push(await link(target, alias.join('|'), !!match[1]));
          end = match.index + match[0].length;
        }
        const tail = node.value.slice(end);
        if (/!?\[\[/.test(tail)) throw new PublishError('Finish the wikilink before publishing.');
        if (tail) output.push({type:'text', value:tail});
        continue;
      }
      if (['linkReference', 'imageReference'].includes(node.type)) {
        const definition = definitions.get(node.identifier);
        if (!definition) throw new PublishError('A Markdown reference has no matching link definition.');
        node.type = node.type === 'imageReference' ? 'image' : 'link';
        node.url = definition.url;
        node.title = definition.title;
      }
      if (node.type === 'link' || node.type === 'image') {
        const isImage = node.type === 'image';
        if (node.url.startsWith('#') || publicUrl(node.url, { image: isImage })) {
          if (!publicUrl(node.url, { image: isImage })) throw new PublishError('Invalid public link.');
        } else {
          const converted = await link(decodeURIComponent(node.url), node.alt || '', isImage);
          if (node.children && converted.type === 'link') converted.children = node.children;
          if (node.children && converted.type === 'text') converted.value = node.children.map(n => n.value || '').join('');
          Object.assign(node, converted);
        }
      }
      if (node.children) await walk(node);
      output.push(node);
    }
    parent.children = output;
  }
  await walk(tree);
  const markdown = parser.stringify(tree);
  assertPublicText(markdown);
  return { markdown, warnings: [...warnings] };
}
