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
    if (event.data?.type !== 'naman:theme-ready') return;
    const frame = frames().find(frame => frame.contentWindow === event.source);
    if (frame) send(frame);
  });
  document.addEventListener('load', event => {
    if (event.target instanceof HTMLIFrameElement && frames().includes(event.target)) send(event.target);
  }, true);
  window.addEventListener('pageshow', sync);
  sync();
  return sync;
}
