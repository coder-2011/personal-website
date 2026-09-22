import { parseFragment, serialize } from 'parse5';
import { buildOutline } from './outline.mjs';

const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
function title(node) {
  if (attr(node, 'data-footnote-ref') !== undefined || attr(node, 'aria-hidden') === 'true') return '';
  return node.nodeName === '#text' ? node.value : (node.childNodes || []).map(title).join('');
}

export function prepareCatalogue(html) {
  const tree = parseFragment(html), headings = [], usedIds = new Set();
  function walk(node, excluded = false) {
    if (attr(node, 'id')) usedIds.add(attr(node, 'id'));
    excluded ||= ['pre', 'code'].includes(node.tagName) || attr(node, 'data-footnotes') !== undefined || (attr(node, 'class') || '').split(/\s+/).includes('blog-sidenote');
    if (!excluded && /^h[1-6]$/.test(node.tagName)) headings.push(node);
    for (const child of node.childNodes || []) walk(child, excluded);
  }
  walk(tree);
  const { outline, flat } = buildOutline(headings.map(node => ({ id: attr(node, 'id'), title: title(node), level: Number(node.tagName[1]) })), usedIds);
  let changed = false;
  for (const entry of flat) if (!attr(headings[entry.index], 'id')) {
    headings[entry.index].attrs.push({ name: 'id', value: entry.id });
    changed = true;
  }
  return { html: changed ? serialize(tree) : html, outline };
}
