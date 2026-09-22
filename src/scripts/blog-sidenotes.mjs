// Position the server-rendered notes beside their paragraphs; narrow screens keep
// their natural document order.
export function enableSidenotes(body) {
  const notes = [...body.querySelectorAll(':scope > .blog-sidenote')];
  if (!notes.length) return () => {};
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
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
    body.removeEventListener('load', schedule, true);
    document.fonts.removeEventListener('loadingdone', schedule);
    body.style.minHeight = '';
    delete body.dataset.sidenotesReady;
  };
}
