import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

const parser = unified().use(remarkParse).use(remarkGfm);

// GFM accepts a line without pipes as a one-cell row in a multi-column table.
// Obsidian notes commonly put prose immediately after the last explicit row.
// Insert the missing boundary only inside parsed tables, never in code or HTML.
export function separateTableParagraphs(source) {
  const lines = source.split('\n');
  const boundaries = new Map();
  visit(parser.parse(source), 'table', table => {
    if (table.children[0].children.length < 2) return;
    for (const row of table.children.slice(1)) {
      const raw = source.slice(row.position.start.offset, row.position.end.offset);
      if (row.children.length === 1 && !/(?<!\\)\|/.test(raw)) {
        boundaries.set(row.position.start.line - 1, lines[row.position.start.line - 1].slice(0, row.position.start.column - 1));
        break;
      }
    }
  });
  if (!boundaries.size) return source;
  return lines.map((line, index) => boundaries.has(index) ? `${boundaries.get(index)}\n${line}` : line).join('\n');
}
