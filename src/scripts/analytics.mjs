// First-party visitor estimates. Count only visible production pages, never
// previews, frames, live-update polling, or automated browser checks.
const url = new URL(window.location.href);
if (url.hash === '#analytics-exclude') {
  try { localStorage.setItem('naman.analytics.disabled', '1'); } catch {}
  history.replaceState(history.state, '', url.pathname + url.search);
}
if (!window.__namanAnalyticsInitialized && window.self === window.top &&
    ['naman.world', 'www.naman.world'].includes(url.hostname) &&
    !/^\/(?:zoom|analytics)\/?$/.test(url.pathname) &&
    !/^\/(?:api|embeds)\//.test(url.pathname) &&
    !navigator.webdriver && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl) {
  window.__namanAnalyticsInitialized = true;
  const record = () => {
    if (document.visibilityState !== 'visible' || document.prerendering) return;
    document.removeEventListener('visibilitychange', record);
    try {
      if (url.hash === '#analytics-exclude' || localStorage.getItem('naman.analytics.disabled') === '1') return;
      const now = Date.now();
      let saved;
      try { saved = JSON.parse(localStorage.getItem('naman.analytics.visitor')); } catch {}
      if (!saved || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(saved.id) ||
          !Number.isFinite(saved.lastSeen) || now - saved.lastSeen > 90 * 86400000) saved = {id:crypto.randomUUID()};
      localStorage.setItem('naman.analytics.visitor', JSON.stringify({id:saved.id, lastSeen:now}));
      const article = document.querySelector('.blog-post');
      const postId = article?.dataset.postId || null;
      if (article && !postId) return; // Missing/unpublished posts aren't visits.
      void fetch('/api/analytics/visit', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({visitorId:saved.id, postId}),
        credentials:'omit', referrerPolicy:'no-referrer', keepalive:true,
      }).catch(() => {});
    } catch { /* Disabled storage or network must never interrupt reading. */ }
  };
  const ready = () => {
    if (document.visibilityState === 'visible' && !document.prerendering) record();
    else document.addEventListener('visibilitychange', record);
  };
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, {once:true});
}
