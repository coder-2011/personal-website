// Heading levels may skip (h1 -> h3) or start at h2. Preserve the actual
// hierarchy without inventing empty sections for the missing levels.
export function buildOutline(headings, usedIds = new Set()) {
  const outline = [], flat = [], stack = [];
  headings.forEach((heading, index) => {
    const title = heading.title.replace(/\s+/g, ' ').trim().replace(/^\d+(?:\.\d+)*[.)]\s+/, '');
    if (!title) return;
    let id = heading.id;
    if (!id) {
      const base = `section-${index + 1}`;
      id = base;
      for (let suffix = 2; usedIds.has(id); suffix++) id = `${base}-${suffix}`;
      usedIds.add(id);
    }
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
    const parent = stack.at(-1);
    const siblings = parent ? parent.children : outline;
    const entry = { id, title, level: heading.level, children: [], index };
    siblings.push(entry);
    flat.push(entry);
    stack.push(entry);
  });
  return { outline, flat };
}
