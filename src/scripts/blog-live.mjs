// Keep an open revision stable until the reader chooses to update. Poll against
// the latest downloaded revision so a pending update is not fetched repeatedly.
export function enableLiveUpdates(article, notice, applyPost, unpublish) {
  const button = notice.querySelector('button');
  let checkedRevision = article.dataset.revision;
  let pending = null, timer, controller;
  let paused = false, removed = false, generation = 0;
  async function poll() {
    const run = generation;
    let delay = 3000;
    try {
      if (!document.hidden) {
        const request = new AbortController();
        controller = request;
        const timeout = setTimeout(() => request.abort(), 8000);
        try {
          const response = await fetch(`/api/blog/posts/${article.dataset.slug}?revision=${encodeURIComponent(checkedRevision || '')}`, { cache:'no-store', signal:request.signal });
          if (run !== generation) return;
          if (response.status === 404) {
            removed = true; pending = null; notice.hidden = true;
            unpublish();
          } else if (response.ok && response.status !== 204) {
            const post = await response.json();
            if (run !== generation) return;
            if (post.revision !== checkedRevision) {
              checkedRevision = post.revision;
              pending = post;
              notice.hidden = false;
            }
          } else if (response.status !== 204) delay = 15000;
        } finally { clearTimeout(timeout); }
      }
    } catch { delay = 15000; }
    finally {
      if (run === generation && !paused && !removed) timer = setTimeout(poll, delay);
    }
  }
  function apply() {
    if (!pending || removed) return;
    button.disabled = true;
    try {
      applyPost(pending);
      article.dataset.revision = pending.revision;
      pending = null;
      notice.hidden = true;
      article.focus({preventScroll:true});
    } finally { button.disabled = false; }
  }
  function pause() {
    paused = true; generation++;
    clearTimeout(timer); controller?.abort();
  }
  function resume(event) {
    if (!event.persisted || removed) return;
    paused = false;
    void poll();
  }
  button.addEventListener('click', apply);
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  timer = setTimeout(poll, 3000);
  return () => {
    pause(); notice.hidden = true;
    button.removeEventListener('click', apply);
    window.removeEventListener('pagehide', pause);
    window.removeEventListener('pageshow', resume);
  };
}

// Preserve the paragraph's viewport offset, rather than just scrollY: an edit
// above the reader can change the distance from the top of the document.
export function rememberReadingPosition(body) {
  const blocks = () => [...body.children].filter(node => !node.classList.contains('blog-sidenote'));
  const previous = blocks();
  const index = previous.findIndex(node => node.getBoundingClientRect().bottom > 80);
  const anchor = previous[index];
  const scroll = window.scrollY;
  if (scroll === 0 || !anchor || anchor.getBoundingClientRect().top > window.innerHeight) return () => window.scrollTo({top:scroll, behavior:'instant'});
  const top = anchor.getBoundingClientRect().top, text = anchor.textContent, id = anchor.id, tag = anchor.tagName;
  return () => {
    const current = blocks();
    const matches = current.filter(node => id ? node.id === id : node.tagName === tag && node.textContent === text);
    const target = matches.reduce((best, node) => !best || Math.abs(current.indexOf(node) - index) < Math.abs(current.indexOf(best) - index) ? node : best, null)
      || current[Math.min(index, current.length - 1)];
    window.scrollTo({top:target ? window.scrollY + target.getBoundingClientRect().top - top : scroll, behavior:'instant'});
  };
}
