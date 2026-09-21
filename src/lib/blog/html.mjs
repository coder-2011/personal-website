import { parseFragment } from 'parse5';
import { parse, walk } from 'css-tree';
import { PublishError, assertPublicText } from './privacy.mjs';

const properties = new Set(('color background background-color opacity font-family font-size font-style font-weight font-variant line-height letter-spacing word-spacing text-align text-decoration text-transform white-space overflow-wrap word-break vertical-align padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left border border-top border-right border-bottom border-left border-color border-width border-style border-radius border-collapse border-spacing width min-width max-width height min-height max-height display gap row-gap column-gap flex flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-content align-self justify-content table-layout caption-side').split(' '));

function validateStyle(value) {
  const fail = () => { throw new PublishError('This HTML style is unsupported. Use text, table, or flex formatting without external resources, CSS variables, or positioning.'); };
  try {
    if (value.includes('\\')) fail();
    const tree = parse(value, {context:'declarationList', onParseError:fail});
    walk(tree, node => {
      if (['Url', 'Atrule', 'Raw'].includes(node.type)) fail();
      if (node.type === 'Declaration' && !properties.has(node.property.toLowerCase())) fail();
      if (node.type === 'Function' && !/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|calc|min|max|clamp)$/i.test(node.name)) fail();
      if (typeof node.name === 'string' && node.name.includes('\\')) fail();
    });
  } catch (error) { if (error instanceof PublishError) throw error; fail(); }
}

export function validateHtmlStyles(html) {
  // Parse attributes as a browser does, including unquoted values and HTML entities.
  // Keep the original fragment: remark can split opening and closing inline tags.
  const visit = node => {
    for (const attribute of node.attrs || []) {
      assertPublicText(attribute.value, 'HTML attribute');
      if (attribute.name === 'style') validateStyle(attribute.value);
    }
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parseFragment(html));
}
