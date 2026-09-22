import { parseFragment } from 'parse5';

const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const setAttr = (node, name, value) => {
  const existing = node.attrs.find(item => item.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
};
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');

// Move the original definitions, preserving IDs, rich content, and every backlink.
// Keeping notes after their first containing block also gives narrow screens and
// readers without JavaScript a useful reading order instead of an endnote list.
export function placeSidenotes(tree) {
  const section = tree.childNodes.find(node => attr(node, 'data-footnotes') !== undefined);
  const list = section?.childNodes.find(node => node.tagName === 'ol');
  if (!list) return;
  const definitions = new Map(list.childNodes.filter(node => node.tagName === 'li').map(node => [attr(node, 'id'), node]));
  const notesByBlock = new Map();
  const moved = new Set();
  function walk(node, block) {
    if (node === section) return;
    if (attr(node, 'data-footnote-ref') !== undefined) {
      const href = attr(node, 'href');
      if (!href?.startsWith('#')) return;
      let id = href.slice(1);
      try { id = decodeURIComponent(id); } catch {}
      const definition = definitions.get(id) || definitions.get(href.slice(1));
      if (!definition) return;
      const number = text(node);
      setAttr(node, 'aria-label', `Footnote ${number}`);
      node.attrs = node.attrs.filter(item => item.name !== 'aria-describedby');
      if (!moved.has(definition)) {
        const aside = parseFragment('<aside class="blog-sidenote" role="note" tabindex="-1"><a class="blog-sidenote-number"></a></aside>').childNodes[0];
        setAttr(aside, 'id', attr(definition, 'id'));
        setAttr(aside, 'aria-label', `Footnote ${number}`);
        setAttr(aside, 'data-reference', attr(node, 'id') || '');
        const marker = aside.childNodes[0];
        setAttr(marker, 'href', `#${attr(node, 'id') || ''}`);
        setAttr(marker, 'aria-label', `Back to reference ${number}`);
        marker.childNodes = [{ nodeName: '#text', value: number, parentNode: marker }];
        aside.childNodes.push(...definition.childNodes);
        for (const child of aside.childNodes) child.parentNode = aside;
        aside.parentNode = tree;
        const siblings = notesByBlock.get(block) || [];
        siblings.push(aside);
        notesByBlock.set(block, siblings);
        moved.add(definition);
      }
    }
    for (const child of node.childNodes || []) walk(child, block);
  }
  for (const block of tree.childNodes) walk(block, block);
  list.childNodes = list.childNodes.filter(node => !moved.has(node));
  tree.childNodes = tree.childNodes.flatMap(block => {
    if (block === section && !list.childNodes.some(node => node.tagName === 'li')) return [];
    return [block, ...(notesByBlock.get(block) || [])];
  });
}
