import { parseFragment, serialize, serializeOuter } from 'parse5';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { placeSidenotes } from './sidenotes.mjs';

const parser = unified().use(remarkParse);
const labels = { js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', rust: 'Rust', rs: 'Rust', py: 'Python', python: 'Python', json: 'JSON', html: 'HTML', css: 'CSS', cpp: 'C++', 'c++': 'C++', c: 'C', sh: 'Shell', bash: 'Bash', shell: 'Shell', zsh: 'Zsh', sql: 'SQL', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', text: 'Plain text', txt: 'Plain text', plaintext: 'Plain text', plain: 'Plain text' };
const textContent = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textContent).join('');
const codeKey = value => value.replace(/\n+$/, '');

// Decorate stored HTML on read, so existing posts get controls without republishing
// or running the syntax highlighter again. Match text rather than block positions:
// math and raw HTML can change the number of blocks between Markdown and HTML.
export function presentPost(html, markdown) {
  // Restore labels on already-published blocks without re-highlighting the post.
  html = html.replaceAll('<div class="blog-code-header"><button', '<div class="blog-code-header"><span>Plain text</span><button');
  const needsCode = html.includes('<pre') && !html.includes('<div class="blog-code-block">');
  const needsTables = html.includes('<table') && !html.includes('<div class="blog-table-scroll"');
  const needsSidenotes = html.includes('data-footnotes=');
  if (!needsCode && !needsTables && !needsSidenotes) return html;
  const languages = new Map();
  if (needsCode) visit(parser.parse(markdown), 'code', node => {
    const key = codeKey(node.value);
    const values = languages.get(key) || [];
    const language = node.lang?.toLowerCase() || 'text';
    values.push(labels[language] ?? (/^[a-z0-9_+#.-]{1,40}$/i.test(language) ? language : ''));
    languages.set(key, values);
  });
  const tree = parseFragment(html);
  function decorate(parent) {
    parent.childNodes = (parent.childNodes || []).map(node => {
      const classes = node.attrs?.find(attr => attr.name === 'class')?.value.split(/\s+/) || [];
      if (classes.includes('blog-code-block') || classes.includes('blog-table-scroll')) return node;
      if (node.tagName === 'table') {
        decorate(node);
        const wrapper = parseFragment('<div class="blog-table-scroll" role="region" aria-label="Table" tabindex="0"></div>').childNodes[0];
        const caption = node.childNodes.find(child => child.tagName === 'caption');
        if (caption) wrapper.attrs.find(attr => attr.name === 'aria-label').value = textContent(caption);
        wrapper.childNodes = [node];
        node.parentNode = wrapper;
        return wrapper;
      }
      const code = node.tagName === 'pre' && node.childNodes.find(child => child.tagName === 'code');
      if (!code) { if (node.childNodes) decorate(node); return node; }
      const language = languages.get(codeKey(textContent(code)))?.shift() || 'Plain text';
      return parseFragment(`<div class="blog-code-block"><div class="blog-code-header">${language ? `<span>${language}</span>` : ''}<button class="blog-code-copy" type="button" aria-label="Copy code" aria-live="polite" hidden>Copy</button></div>${serializeOuter(node)}</div>`).childNodes[0];
    });
  }
  decorate(tree);
  if (needsSidenotes) placeSidenotes(tree);
  return serialize(tree);
}
