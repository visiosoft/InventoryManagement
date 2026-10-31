// Google tag (GA4 + Google Ads) with Consent Mode v2 and a small consent banner.
// Fill in the IDs below; while GA4_ID is empty nothing loads and no banner shows.
// Loaded on every page (index + legal), before app.js, so window.TwoCapTrack exists for it.
(function () {
  const CONFIG = {
    GA4_ID: '',               // e.g. 'G-XXXXXXXXXX'   (GA4 > Admin > Data streams)
    ADS_ID: '',               // e.g. 'AW-123456789'   (Google Ads > Goals > Conversions > Tag setup)
    ADS_DEMO_LABEL: ''        // e.g. 'AbCdEfGhIjK'    (the label of the "Book a demo" conversion action)
  };
  const CONSENT_KEY = 'twocap-consent';

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  const enabled = Boolean(CONFIG.GA4_ID || CONFIG.ADS_ID);

  // Ad clicks and campaign tags from the landing URL, kept for the session so a
  // demo request made a few pages/scrolls later still says where it came from.
  const source = (function () {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('twocap-source') || 'null'); } catch (e) {}
    const q = new URLSearchParams(location.search);
    const fresh = {
      utmSource: q.get('utm_source') || '', utmMedium: q.get('utm_medium') || '',
      utmCampaign: q.get('utm_campaign') || '', utmTerm: q.get('utm_term') || '',
      gclid: q.get('gclid') || ''
    };
    if (!saved || fresh.utmSource || fresh.gclid) {
      saved = Object.assign(fresh, { referrer: document.referrer || '' });
      try { sessionStorage.setItem('twocap-source', JSON.stringify(saved)); } catch (e) {}
    }
    return saved;
  })();

  function event(name, params) {
    if (enabled) gtag('event', name, params || {});
  }

  window.TwoCapTrack = {
    source: () => Object.assign({ page: location.pathname }, source),
    event,
    // A completed demo request: the GA4 key event plus the Ads conversion
    demoRequested(params) {
      event('generate_lead', Object.assign({ form: 'book_demo' }, params || {}));
      if (CONFIG.ADS_ID && CONFIG.ADS_DEMO_LABEL) {
        event('conversion', { send_to: CONFIG.ADS_ID + '/' + CONFIG.ADS_DEMO_LABEL });
      }
    }
  };

  if (!enabled) return;

  let choice = null;
  try { choice = localStorage.getItem(CONSENT_KEY); } catch (e) {}
  const granted = choice === 'granted';

  // Consent Mode v2: everything denied until the visitor accepts. Google still
  // receives cookieless pings, which is what lets GA4 and Ads model the rest.
  gtag('consent', 'default', {
    ad_storage: granted ? 'granted' : 'denied',
    ad_user_data: granted ? 'granted' : 'denied',
    ad_personalization: granted ? 'granted' : 'denied',
    analytics_storage: granted ? 'granted' : 'denied',
    wait_for_update: 500
  });
  gtag('js', new Date());
  if (CONFIG.GA4_ID) gtag('config', CONFIG.GA4_ID);
  if (CONFIG.ADS_ID) gtag('config', CONFIG.ADS_ID);

  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + (CONFIG.GA4_ID || CONFIG.ADS_ID);
  document.head.appendChild(s);

  function setConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
    const v = value === 'granted' ? 'granted' : 'denied';
    gtag('consent', 'update', { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v });
  }

  // Phone, WhatsApp and email clicks are leads too, so count them
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.indexOf('wa.me/') !== -1) event('contact', { method: 'whatsapp' });
    else if (href.indexOf('tel:') === 0) event('contact', { method: 'phone' });
    else if (href.indexOf('mailto:') === 0) event('contact', { method: 'email' });
  });

  if (choice) return;

  function showBanner() {
    const root = location.pathname.indexOf('/legal/') !== -1 ? '../' : '';
    const bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
      '<p>We use cookies to measure visits and the results of our ads. ' +
      '<a href="' + root + 'legal/privacy-policy.html#cookies">Learn more</a></p>' +
      '<div class="consent__actions">' +
      '<button type="button" class="btn btn--outline" data-consent="denied">Decline</button>' +
      '<button type="button" class="btn btn--solid" data-consent="granted">Accept</button>' +
      '</div>';
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-consent]');
      if (!b) return;
      setConsent(b.dataset.consent);
      bar.remove();
    });
    document.body.appendChild(bar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
})();
