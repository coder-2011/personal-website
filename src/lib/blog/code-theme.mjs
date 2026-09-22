// Obsidian syntax roles and Ukiyo palettes, selected by the site's theme.
const dark = {
  normal: '#ccc2b7', background: '#2b2723', comment: '#868074',
  punctuation: '#b2a699', keyword: '#fa99cd', operator: '#fb464c',
  property: '#53dfdd', string: '#44cf6e', value: '#a882ff',
  function: '#e0de71', important: '#e9973f',
};
const light = {
  normal: '#383832', background: '#eee7e0', comment: '#746e66',
  punctuation: '#64645c', keyword: '#bf206d', operator: '#cf1e33',
  property: '#009e9b', string: '#01903b', value: '#5f38d6',
  function: '#977400', important: '#c16d18',
};
function theme(name, type, colors) {
  const token = (scope, role) => ({ scope, settings: { foreground: colors[role] } });
  return {
    name, type,
    colors: { 'editor.background': colors.background, 'editor.foreground': colors.normal },
    tokenColors: [
      token(['keyword', 'storage'], 'keyword'),
      token(['keyword.operator'], 'operator'),
      token(['variable', 'entity.name.type', 'support.class', 'meta.object-literal.key', 'support.type.property-name.json'], 'property'),
      token(['entity.name.function', 'support.function', 'support.type'], 'function'),
      token(['entity.name.type.struct.rust', 'entity.name.type.enum.rust', 'entity.name.type.numeric.rust', 'entity.name.type.primitive.rust'], 'normal'),
      token(['constant.numeric', 'constant.language'], 'value'),
      token(['entity.name.tag', 'constant.other'], 'operator'),
      token(['punctuation'], 'punctuation'),
      token(['string', 'punctuation.definition.string'], 'string'),
      token(['string.regexp'], 'important'),
      token(['comment', 'punctuation.definition.comment'], 'comment'),
      token(['markup.inserted'], 'string'),
      token(['markup.deleted'], 'operator'),
      token(['markup.changed'], 'important'),
    ],
  };
}
export const codeThemes = {
  light: theme('obsidian-ukiyo-light', 'light', light),
  dark: theme('obsidian-ukiyo', 'dark', dark),
};
