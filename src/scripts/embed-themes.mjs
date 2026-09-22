export function enableEmbedThemes() {
  const frames = () => [...document.querySelectorAll('iframe[src]')].filter(frame => {
    const url = new URL(frame.src, location.href);
    return (url.origin === location.origin || url.origin === 'https://naman.world') && /^\/embeds\/(bpe|unigram)\.html$/.test(url.pathname);
  });
  const send = frame => {
    // Sandboxed frames have opaque origins; send only the public theme value.
    frame.contentWindow?.postMessage({ type: 'naman:theme', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }, '*');
  };
  const sync = () => frames().forEach(send);
  // The handshake covers lazy frames, live post replacements, and either load order.
  window.addEventListener('message', event => {
    if (!['naman:theme-ready', 'naman:embed-size'].includes(event.data?.type)) return;
    const frame = frames().find(frame => frame.contentWindow === event.source);
    if (!frame) return;
    if (event.data.type === 'naman:theme-ready') send(frame);
    else {
      const height = event.data.height;
      if (!Number.isFinite(height) || height <= 0 || height > 100000) return;
      frame.style.height = `${Math.ceil(height)}px`;
      frame.setAttribute('scrolling', 'no');
    }
  });
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLIFrameElement && frames().includes(event.target)) send(event.target);
  }, true);
  window.addEventListener('pageshow', sync);
  sync();
  return sync;
}
