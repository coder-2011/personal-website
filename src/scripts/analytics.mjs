const token = import.meta.env.PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN;
const url = new URL(window.location.href);

// Cloudflare reports paths without query strings. Never load the beacon on the
// OAuth callback, previews, APIs, or iframe copies of an article.
if (/^[a-f0-9]{32}$/.test(token || '') && window.self === window.top &&
    ['naman.world', 'www.naman.world'].includes(url.hostname) &&
    url.pathname !== '/zoom' && !url.pathname.startsWith('/api/') &&
    !document.head.querySelector('script[data-site-analytics]')) {
  const script = document.createElement('script');
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.defer = true;
  script.dataset.siteAnalytics = 'cloudflare';
  script.dataset.cfBeacon = JSON.stringify({ token, spa: false });
  script.referrerPolicy = 'no-referrer';
  document.head.appendChild(script);
}
