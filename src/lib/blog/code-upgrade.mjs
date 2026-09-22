import { createShikiHighlighter } from '@astrojs/markdown-remark';
import { parseFragment, serialize } from 'parse5';
import { codeThemes } from './code-theme.mjs';
import { renderPost } from './render.mjs';
import { presentPost } from './presentation.mjs';

const cache = new Map();
let highlighter;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');
const classes = node => node.attrs?.find(attr => attr.name === 'class')?.value.split(/\s+/) || [];

async function upgrade(html) {
  const tree = parseFragment(html), blocks = [];
  function collect(node) {
    if (node.tagName === 'pre' && classes(node).includes('astro-code') && !classes(node).includes('obsidian-ukiyo-light')) blocks.push(node);
    else for (const child of node.childNodes || []) collect(child);
  }
  collect(tree);
  if (!blocks.length) return html;
  highlighter ??= createShikiHighlighter({ themes: codeThemes });
  const engine = await highlighter;
  // Sequential language loads share the highlighter; the surrounding cache also
  // coalesces concurrent requests for the same stored article.
  for (const pre of blocks) {
    const code = pre.childNodes.find(node => node.tagName === 'code');
    if (!code) continue;
    const header = pre.parentNode.childNodes.find(node => classes(node).includes('blog-code-header'));
    const label = text(header?.childNodes.find(node => node.tagName === 'span') || {}).toLowerCase();
    const language = ({ 'c++': 'cpp', shell: 'shellscript', 'plain text': 'text' })[label] || label || 'text';
    const original = text(code);
    const rendered = await engine.codeToHtml(original, language, {});
    const replacement = parseFragment(rendered).childNodes.find(node => node.tagName === 'pre');
    const replacementCode = replacement.childNodes.find(node => node.tagName === 'code');
    // Astro trims one final newline during highlighting. Copy must still return
    // exactly the original block, including any trailing newline.
    const highlighted = text(replacementCode);
    if (highlighted !== original) {
      const suffix = original.slice(highlighted.length);
      if (!original.startsWith(highlighted) || !/^[\r\n]+$/.test(suffix)) throw new Error('Code highlighting changed its text');
      replacementCode.childNodes.push({ nodeName: '#text', value: suffix, parentNode: replacementCode });
    }
    replacement.parentNode = pre.parentNode;
    const index = pre.parentNode.childNodes.indexOf(pre);
    pre.parentNode.childNodes[index] = replacement;
  }
  return serialize(tree);
}

export function presentPostForReading(html, markdown) {
  // Current publications already contain the palette and corrected math.
  // Legacy repairs are cached so reads do not repeatedly render the article.
  const legacyMath = html.includes('class="katex"') && !html.includes('data-math-version="2"');
  if (!legacyMath && !html.includes('github-dark') && !/class="astro-code obsidian-ukiyo(?:"| )/.test(html)) return Promise.resolve(presentPost(html, markdown));
  if (cache.has(html)) return cache.get(html);
  const result = (legacyMath ? renderPost(markdown, {legacyMath:true}).then(post => post.html) : upgrade(presentPost(html, markdown)))
    .catch(error => { cache.delete(html); throw error; });
  cache.set(html, result);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  return result;
}
