// Browsers such as Chrome keep one native selection range. Paint referenced notes
// as part of that selection and include their text in the same clipboard operation.
export function enableFootnoteSelection(body, notes) {
  const doc = body.ownerDocument;
  const notesById = new Map(notes.map(note => [note.id, note]));
  const references = [...body.querySelectorAll('[data-footnote-ref]')].flatMap(reference => {
    const href = reference.getAttribute('href');
    if (!href?.startsWith('#')) return [];
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    const note = notesById.get(id) || notesById.get(href.slice(1));
    return note ? [{reference, note}] : [];
  });
  const noteRanges = new Map(notes.map(note => {
    const walker = doc.createTreeWalker(note, 4 /* SHOW_TEXT */);
    let first = null, last = null, node;
    while ((node = walker.nextNode())) {
      if (!node.data.trim() || node.parentElement?.closest('.blog-sidenote-number, [data-footnote-backref], [aria-hidden="true"]')) continue;
      first ??= node; last = node;
    }
    const range = doc.createRange();
    if (first) { range.setStart(first, 0); range.setEnd(last, last.data.length); }
    return [note, range];
  }));
  const registry = doc.defaultView?.CSS?.highlights;
  const Highlight = doc.defaultView?.Highlight;
  const key = 'footnote-selection';
  let selected = [];
  function selectionNotes() {
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed) return [];
    const ranges = Array.from({length:selection.rangeCount}, (_, i) => selection.getRangeAt(i));
    return [...new Set(references.filter(({reference}) => ranges.some(range => {
      if (!range.intersectsNode(reference)) return false;
      // Only count selected marker text, not a range ending just before the marker.
      const marker = doc.createRange(); marker.selectNodeContents(reference);
      const overlap = range.cloneRange();
      if (overlap.compareBoundaryPoints(0 /* START_TO_START */, marker) < 0) overlap.setStart(marker.startContainer, marker.startOffset);
      if (overlap.compareBoundaryPoints(2 /* END_TO_END */, marker) > 0) overlap.setEnd(marker.endContainer, marker.endOffset);
      return !overlap.collapsed && !!overlap.toString().trim();
    })).map(({note}) => note))];
  }
  function update() {
    const next = selectionNotes();
    if (next.length === selected.length && next.every((note, i) => note === selected[i])) return;
    selected = next;
    if (registry && Highlight) {
      if (selected.length) registry.set(key, new Highlight(...selected.map(note => noteRanges.get(note))));
      else registry.delete(key);
    } else {
      notes.forEach(note => note.classList.toggle('is-selected', selected.includes(note)));
    }
  }
  const clean = root => root.querySelectorAll('.blog-sidenote-number, [data-footnote-backref], .blog-code-header').forEach(node => node.remove());
  const plainText = node => {
    if (node.nodeType === 3) return node.data;
    if (node.nodeName === 'BR') return '\n';
    const content = [...node.childNodes].map(plainText).join('');
    if (/^(P|DIV|PRE|BLOCKQUOTE|ASIDE|H[1-6])$/.test(node.nodeName)) return content + '\n\n';
    if (/^(LI|TR)$/.test(node.nodeName)) return content + '\n';
    if (/^(TD|TH)$/.test(node.nodeName)) return content + '\t';
    return content;
  };
  function copy(event) {
    if (event.defaultPrevented || !event.clipboardData || event.target?.closest?.('input, textarea, [contenteditable]')) return;
    update();
    if (!selected.length) return;
    const selection = doc.getSelection();
    const container = doc.createElement('div');
    for (let i = 0; i < selection.rangeCount; i++) container.append(selection.getRangeAt(i).cloneContents());
    // A long selection can already contain a note. Append each referenced note once.
    const ids = new Set(selected.map(note => note.id));
    container.querySelectorAll('.blog-sidenote').forEach(note => { if (ids.has(note.id)) note.remove(); });
    clean(container);
    const plain = [plainText(container).trim()];
    for (const note of selected) {
      const clone = note.cloneNode(true);
      const number = clone.querySelector('.blog-sidenote-number')?.textContent.trim() || '';
      clean(clone);
      plain.push(`[${number}] ${plainText(clone).trim()}`);
      const paragraph = doc.createElement('p'); paragraph.textContent = `[${number}]`;
      container.append(paragraph, ...clone.childNodes);
    }
    event.clipboardData.setData('text/plain', plain.join('\n\n'));
    event.clipboardData.setData('text/html', container.innerHTML);
    event.preventDefault();
  }
  doc.addEventListener('selectionchange', update);
  doc.addEventListener('copy', copy);
  update();
  return () => {
    doc.removeEventListener('selectionchange', update);
    doc.removeEventListener('copy', copy);
    registry?.delete(key);
    notes.forEach(note => note.classList.remove('is-selected'));
  };
}

// Position the server-rendered notes beside their paragraphs; narrow screens keep
// their natural document order.
export function enableSidenotes(body) {
  const notes = [...body.querySelectorAll(':scope > .blog-sidenote')];
  if (!notes.length) return () => {};
  const clearSelection = enableFootnoteSelection(body, notes);
  body.dataset.sidenotesReady = '';
  const wide = window.matchMedia('(min-width: 1100px)');
  let frame = 0;
  let disposed = false;
  function layout() {
    frame = 0;
    if (!wide.matches) {
      body.style.minHeight = '';
      for (const note of notes) note.style.top = '';
      return;
    }
    const origin = body.getBoundingClientRect().top;
    // Read all geometry before writing styles, and push crowded notes down so
    // two references in one paragraph cannot produce overlapping annotations.
    let bottom = 0;
    const positions = notes.map(note => {
      const reference = document.getElementById(note.dataset.reference);
      const top = Math.max(0, (reference?.getBoundingClientRect().top ?? origin) - origin, bottom);
      bottom = top + note.getBoundingClientRect().height + 16;
      return top;
    });
    const contentBottom = Math.max(0, ...[...body.children]
      .filter(node => !node.classList.contains('blog-sidenote'))
      .map(node => node.getBoundingClientRect().bottom - origin));
    notes.forEach((note, index) => { note.style.top = `${positions[index]}px`; });
    body.style.minHeight = `${Math.ceil(Math.max(contentBottom, bottom))}px`;
  }
  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(layout);
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(body);
  notes.forEach(note => observer.observe(note));
  window.addEventListener('resize', schedule);
  body.addEventListener('load', schedule, true);
  document.fonts.addEventListener('loadingdone', schedule);
  layout();
  return () => {
    disposed = true;
    clearSelection();
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    body.removeEventListener('load', schedule, true);
    document.fonts.removeEventListener('loadingdone', schedule);
    body.style.minHeight = '';
    delete body.dataset.sidenotesReady;
  };
}
