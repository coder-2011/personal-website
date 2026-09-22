import { buildOutline } from '../lib/blog/outline.mjs';

export function enableCatalogue(page, body) {
  const host = page.querySelector('.blog-catalogue');
  const nav = host.querySelector('nav');
  const dialog = page.querySelector('.catalogue-dialog');
  const tools = page.querySelector('.blog-reading-tools');
  const toggle = tools.querySelector('button');
  const wide = matchMedia('(min-width: 1400px)');
  const headings = [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(heading => !heading.closest('.blog-sidenote,[data-footnotes],pre,code'));
  const { outline, flat } = buildOutline(headings.map(heading => {
    const copy = heading.cloneNode(true);
    copy.querySelectorAll('[data-footnote-ref],[aria-hidden="true"]').forEach(node => node.remove());
    return { id: heading.id, title: copy.textContent, level: Number(heading.tagName[1]) };
  }), new Set([...body.querySelectorAll('[id]')].map(node => node.id)));
  flat.forEach(entry => { headings[entry.index].id = entry.id; });
  const targets = flat.map(entry => headings[entry.index]);
  const links = [];
  function list(entries) {
    const ul = document.createElement('ul');
    for (const entry of entries) {
      const li = document.createElement('li'), link = document.createElement('a');
      link.href = `#${encodeURIComponent(entry.id)}`;
      link.dataset.heading = entry.id;
      link.textContent = entry.title;
      li.append(link);
      links.push(link);
      if (entry.children.length) li.append(list(entry.children));
      ul.append(li);
    }
    return ul;
  }
  nav.querySelector('ul').replaceWith(list(outline));
  host.hidden = !flat.length;
  tools.hidden = !flat.length;
  page.classList.toggle('has-catalogue', !!flat.length);
  page.classList.add('catalogue-ready');
  let active = null, frame = 0, positions = [], layoutChanged = true;
  function highlight(index) {
    const link = links[index];
    if (!link || active === link) return;
    active = link;
    links.forEach(item => { item.removeAttribute('aria-current'); item.classList.remove('catalogue-active'); });
    link.setAttribute('aria-current', 'location');
    for (let item = link; item; item = item.parentElement.parentElement.closest('li')?.querySelector(':scope > a')) item.classList.add('catalogue-active');
    // Scroll only the catalogue, never the article, when a deep section becomes active.
    revealActive();
  }
  function revealActive() {
    if (!active) return;
    const bounds = nav.getBoundingClientRect(), item = active.getBoundingClientRect();
    if (item.top < bounds.top) nav.scrollTop -= bounds.top - item.top + 12;
    else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom + 12;
  }
  function track() {
    frame = 0;
    const offset = window.scrollY;
    if (layoutChanged) {
      positions = targets.map(heading => heading.getBoundingClientRect().top + offset);
      layoutChanged = false;
    }
    // Match the reference: first visible heading, or the closest one above us
    // while reading a section whose next heading is still below the viewport.
    let index = positions.findIndex(top => top >= offset + 72 && top < offset + innerHeight);
    if (index < 0) {
      index = positions.findLastIndex(top => top < offset + 72);
      if (index < 0) index = 0;
    }
    highlight(index);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(track); }
  function relayout() { layoutChanged = true; schedule(); }
  function close() { dialog.close(); }
  function restore() {
    host.append(nav);
    toggle.setAttribute('aria-expanded', 'false');
  }
  function open() {
    dialog.append(nav);
    dialog.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    (active || links[0])?.focus({ preventScroll: true });
    revealActive();
  }
  function navigate(event) {
    const link = event.target.closest('a[data-heading]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.dataset.heading);
    if (!target) return;
    event.preventDefault();
    if (dialog.open) close();
    if (location.hash !== link.hash) history.pushState(null, '', link.hash);
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  function resized() { if (wide.matches && dialog.open) close(); relayout(); }
  function backdrop(event) { if (event.target === dialog) close(); }
  const closeButton = dialog.querySelector('button');
  toggle.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', restore);
  dialog.addEventListener('click', backdrop);
  nav.addEventListener('click', navigate);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', resized);
  window.addEventListener('hashchange', schedule);
  body.addEventListener('load', relayout, true);
  document.fonts.addEventListener('loadingdone', relayout);
  const observer = new ResizeObserver(relayout);
  observer.observe(body);
  track();
  return () => {
    if (dialog.open) close();
    restore();
    cancelAnimationFrame(frame);
    observer.disconnect();
    toggle.removeEventListener('click', open);
    closeButton.removeEventListener('click', close);
    dialog.removeEventListener('close', restore);
    dialog.removeEventListener('click', backdrop);
    nav.removeEventListener('click', navigate);
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', resized);
    window.removeEventListener('hashchange', schedule);
    body.removeEventListener('load', relayout, true);
    document.fonts.removeEventListener('loadingdone', relayout);
  };
}
