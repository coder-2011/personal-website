// remark-math treats same-line $$...$$ as inline math. Obsidian treats it
// as display math; preserve that distinction before Markdown is serialized.
export function normalizeMath(tree, source, { legacy = false } = {}) {
  function walk(parent) {
    const output = [];
    for (const node of parent.children || []) {
      if (node.type === 'inlineMath') {
        const raw = source.slice(node.position.start.offset, node.position.end.offset);
        const single = raw.startsWith('$') && !raw.startsWith('$$');
        const literalTemplate = /^[AB]\b/.test(node.value) && /<\/?s>|\[(?:CLS|SEP)\]/.test(node.value);
        // Unescaped tokenizer placeholders are text, not a formula spanning
        // from one $A to the next. Keep the original characters as text.
        if (literalTemplate || (single && /^\$\s|\s\$$/.test(raw))) {
          output.push({type:'text', value:raw});
          continue;
        }
      }
      if (node.children) walk(node);
      if (node.type !== 'paragraph') { output.push(node); continue; }
      let inline = [], split = false;
      const flush = (trim = false) => {
        if (trim && inline[0]?.type === 'text') inline[0] = {...inline[0], value:inline[0].value.trimStart()};
        const last = inline.length - 1;
        if (trim && inline[last]?.type === 'text') inline[last] = {...inline[last], value:inline[last].value.trimEnd()};
        if (inline.some(child => child.type !== 'text' || child.value.trim())) output.push({...node, children:inline});
        inline = [];
      };
      for (const child of node.children) {
        let display = false;
        if (child.type === 'inlineMath') {
          const {start, end} = child.position;
          const raw = source.slice(start.offset, end.offset);
          const before = source.slice(source.lastIndexOf('\n', start.offset - 1) + 1, start.offset);
          const lineEnd = source.indexOf('\n', end.offset);
          const after = source.slice(end.offset, lineEnd < 0 ? source.length : lineEnd);
          // Old exports lost their double dollars. Recover equations occupying
          // an entire source line when rendering those stored revisions.
          display = raw.startsWith('$$') || (legacy && !before.trim() && !after.trim());
        }
        if (display) {
          flush(true); split = true; output.push({type:'math', value:child.value});
        } else inline.push(child);
      }
      flush(split);
    }
    parent.children = output;
  }
  walk(tree);
}
