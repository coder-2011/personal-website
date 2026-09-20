import { SaxesParser } from 'saxes';
import { parse, walk, generate } from 'css-tree';
import { PublishError, assertPublicText } from './privacy.mjs';

const svgNamespace = 'http://www.w3.org/2000/svg';
const tags = new Set('svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title desc style linearGradient radialGradient stop clipPath mask pattern marker filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence'.split(' '));
const properties = new Set('fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color color-interpolation color-interpolation-filters clip-path clip-rule mask filter marker-start marker-mid marker-end font-family font-size font-style font-weight font-variant text-anchor text-decoration letter-spacing word-spacing dominant-baseline alignment-baseline baseline-shift paint-order vector-effect display visibility overflow shape-rendering text-rendering image-rendering stop-color stop-opacity flood-color flood-opacity lighting-color transform transform-origin transform-box'.split(' '));
const attributes = new Set(('id class style role viewBox preserveAspectRatio version x y x1 y1 x2 y2 dx dy width height cx cy r rx ry d points pathLength transform gradientTransform gradientUnits spreadMethod offset fx fy fr href clipPathUnits maskUnits maskContentUnits patternUnits patternContentUnits patternTransform markerUnits markerWidth markerHeight refX refY orient textLength lengthAdjust startOffset method spacing rotate filterUnits primitiveUnits in in2 result stdDeviation mode type values operator k1 k2 k3 k4 order kernelMatrix divisor bias targetX targetY edgeMode kernelUnitLength preserveAlpha scale xChannelSelector yChannelSelector surfaceScale diffuseConstant specularConstant specularExponent limitingConeAngle azimuth elevation z pointsAtX pointsAtY pointsAtZ baseFrequency numOctaves seed stitchTiles radius amplitude exponent intercept slope tableValues').split(' '));
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fail = () => { throw new PublishError('This SVG contains unsupported or active content. Use a static SVG with no scripts, external resources, or embedded HTML.'); };
const fragment = value => /^#[A-Za-z_][\w.:-]*$/.test(value);

function safeCss(value, context) {
  const tree = parse(value, { context, onParseError: fail });
  walk(tree, (node, item, list) => {
    if (node.type === 'Comment') { list.remove(item); return; }
    if (['Atrule', 'Raw'].includes(node.type)) fail();
    if (node.type === 'Declaration' && !properties.has(node.property)) fail();
    if (node.type === 'Url' && !fragment(node.value)) fail();
    // Escaped identifiers and dynamic CSS functions cannot hide resource loads.
    if (node.type === 'Function' && !/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|calc|min|max|clamp|matrix|matrix3d|translate|translateX|translateY|scale|scaleX|scaleY|rotate|skew|skewX|skewY)$/.test(node.name)) fail();
  });
  const result = generate(tree);
  assertPublicText(result, 'SVG styles');
  return result;
}

// Rebuild strict XML rather than modifying the original string. Both upload boundaries
// use this function, so only the reviewed vector data leaves the vault.
export function sanitizeSvg(source) {
  if (new TextEncoder().encode(source).length > 3_500_000) throw new PublishError('Keep each SVG below 3.5 MB.');
  const parser = new SaxesParser({ xmlns: true });
  const output = [];
  const stack = [];
  let count = 0;
  let style = '';
  parser.on('error', fail);
  parser.on('doctype', fail);
  parser.on('processinginstruction', fail);
  parser.on('opentag', tag => {
    if (++count > 50_000 || stack.length >= 64) fail();
    const skipped = stack.at(-1) === null || tag.local === 'metadata' || /inkscape|sodipodi/.test(tag.uri);
    if (skipped) { stack.push(null); return; }
    if ((tag.uri && tag.uri !== svgNamespace) || !tags.has(tag.local) || (stack.length === 0 && tag.local !== 'svg') || stack.at(-1) === 'style') fail();
    const attrs = [];
    if (stack.length === 0) attrs.push(`xmlns="${svgNamespace}"`);
    const names = new Set();
    for (const attr of Object.values(tag.attributes)) {
      if (attr.uri === 'http://www.w3.org/2000/xmlns/' || /inkscape|sodipodi/.test(attr.uri)) continue;
      if (attr.uri === 'http://www.w3.org/XML/1998/namespace' && ['space', 'lang'].includes(attr.local)) {
        assertPublicText(attr.value, 'SVG attribute'); attrs.push(`${attr.name}="${escape(attr.value)}"`); continue;
      }
      if (attr.uri && !(attr.uri === 'http://www.w3.org/1999/xlink' && attr.local === 'href')) fail();
      const name = attr.local;
      if (names.has(name)) fail();
      names.add(name);
      if (!attributes.has(name) && !properties.has(name) && !/^aria-[a-z-]+$/.test(name)) fail();
      let value = attr.value;
      assertPublicText(value, 'SVG attribute');
      if (name === 'href' && !fragment(value)) fail();
      if (name === 'style') value = safeCss(value, 'declarationList');
      else if (properties.has(name)) value = safeCss(value, 'value');
      attrs.push(`${name}="${escape(value)}"`);
    }
    output.push(`<${tag.local}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
    stack.push(tag.local);
  });
  const text = value => {
    if (!stack.length || stack.at(-1) === null) return;
    if (stack.at(-1) === 'style') { style += value; return; }
    assertPublicText(value, 'SVG text');
    output.push(escape(value));
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const name = stack.pop();
    if (name === null) return;
    if (name === 'style') { output.push(escape(safeCss(style, 'stylesheet'))); style = ''; }
    output.push(`</${name}>`);
  });
  try { parser.write(source).close(); }
  catch (error) { if (error instanceof PublishError) throw error; fail(); }
  if (!output.length) fail();
  return output.join('');
}
