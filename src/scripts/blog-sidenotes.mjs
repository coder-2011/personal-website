// Position notes and highlight them from their references. The server renders one copy
// beside its paragraph; narrow screens keep that natural document order.
export function enableSidenotes(body) {
  const notes = [...body.querySelectorAll(':scope > .blog-sidenote')];
  if (!notes.length) return () => {};
  const notesById = new Map(notes.map(note => [note.id, note]));
  let hovered = null, focused = null;
  const noteFor = target => {
    const reference = target?.closest?.('[data-footnote-ref]');
    if (!reference || !body.contains(reference)) return null;
    const href = reference.getAttribute('href');
    if (!href?.startsWith('#')) return null;
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    return notesById.get(id) || notesById.get(href.slice(1)) || null;
  };
  const highlight = () => notes.forEach(note => note.classList.toggle('is-highlighted', note === hovered || note === focused));
  const hover = target => {
    const next = noteFor(target);
    if (next !== hovered) { hovered = next; highlight(); }
  };
  const focus = target => {
    const next = noteFor(target);
    if (next !== focused) { focused = next; highlight(); }
  };
  const handlers = {
    pointerover: event => hover(event.target),
    pointerout: event => hover(event.relatedTarget),
    focusin: event => focus(event.target),
    focusout: event => focus(event.relatedTarget),
  };
  for (const [event, handler] of Object.entries(handlers)) body.addEventListener(event, handler);
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
    for (const [event, handler] of Object.entries(handlers)) body.removeEventListener(event, handler);
    notes.forEach(note => note.classList.remove('is-highlighted'));
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    body.removeEventListener('load', schedule, true);
    document.fonts.removeEventListener('loadingdone', schedule);
    body.style.minHeight = '';
    delete body.dataset.sidenotesReady;
  };
}
