import { parseFragment } from 'parse5';

const block = /^(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|h[1-6]|hr|li|ol|p|pre|section|table|td|th|tr|ul)$/;
function readingText(node) {
  if (node.nodeName === '#text') return node.value;
  const attrs = Object.fromEntries((node.attrs || []).map(({name, value}) => [name, value]));
  const classes = (attrs.class || '').split(/\s+/);
  // Count article text once, excluding controls, footnote markers and the
  // duplicate accessible/visual trees generated for mathematical notation.
  if (['script', 'style', 'button', 'iframe', 'svg'].includes(node.tagName) ||
      'hidden' in attrs || attrs['aria-hidden'] === 'true' ||
      'data-footnote-ref' in attrs || 'data-footnote-backref' in attrs ||
      classes.some(name => ['blog-code-header', 'blog-sidenote-number', 'katex'].includes(name))) return '';
  const text = (node.childNodes || []).map(readingText).join('');
  return block.test(node.tagName) ? ` ${text} ` : text;
}

export function readingSummary(html) {
  const text = readingText(parseFragment(html));
  const words = (text.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) || []).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${words.toLocaleString('en-US')} ${words === 1 ? 'word' : 'words'} · ${minutes} min read`;
}
