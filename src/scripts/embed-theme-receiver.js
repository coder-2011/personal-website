// Inlined into both standalone demos at build time, under their script CSP hash.
(() => {
  const root = document.documentElement;
  const valid = theme => theme === 'light' || theme === 'dark';
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try {
    const saved = localStorage.getItem('theme');
    if (valid(saved)) theme = saved;
  } catch {} // Sandboxed embeds intentionally cannot access site storage.
  root.dataset.theme = theme;
  if (window.parent === window) return;
  let lastHeight = 0;
  const reportSize = () => {
    // Measure content, not the iframe viewport, so a shorter result can shrink.
    const height = Math.ceil(document.body.getBoundingClientRect().height) + 1;
    if (height === lastHeight) return;
    lastHeight = height;
    window.parent.postMessage({ type: 'naman:embed-size', height }, '*');
  };
  new ResizeObserver(reportSize).observe(document.body);
  window.addEventListener('message', event => {
    if (event.source === window.parent && event.data?.type === 'naman:theme' && valid(event.data.theme)) {
      root.dataset.theme = event.data.theme;
      lastHeight = 0;
      reportSize();
    }
  });
  window.parent.postMessage({ type: 'naman:theme-ready' }, '*');
})();
