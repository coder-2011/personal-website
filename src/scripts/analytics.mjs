import { inject } from '@vercel/analytics';

function publicPage(event) {
  const url = new URL(event.url);
  if (url.pathname === '/zoom' || url.pathname.startsWith('/api/')) return null;
  url.search = '';
  url.hash = '';
  return { ...event, url: url.href };
}

// Preview deployments and embedded pages must not inflate the site's readership.
if (window.self === window.top &&
    ['naman.world', 'www.naman.world'].includes(window.location.hostname) &&
    publicPage({ url: window.location.href })) {
  inject({ mode: 'production', beforeSend: publicPage });
}
