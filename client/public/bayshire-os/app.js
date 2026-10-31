// Shared by the homepage and /platform/. Page-specific code is in home.js and platform.js.
(function () {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Theme ---------------- */
  function isDark() { return document.documentElement.dataset.theme === 'dark'; }
  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('twocap-theme', dark ? 'dark' : 'light'); } catch (e) {}
    syncThemeToggle();
    if (window.__twocapUnitsScene) window.__twocapUnitsScene.applyTheme();
  }
  // aria-pressed says whether dark mode is on; the label stays "Dark theme" so the pair reads correctly
  function syncThemeToggle() {
    const btn = $('#themeToggle');
    btn.setAttribute('aria-pressed', String(isDark()));
    btn.title = isDark() ? 'Switch to light theme' : 'Switch to dark theme';
  }
  $('#themeToggle').addEventListener('click', () => setTheme(!isDark()));
  syncThemeToggle();

  /* ---------------- Nav scroll ---------------- */
  const nav = $('#nav');
  function onScroll() {
    if (window.scrollY > 24) nav.classList.add('is-scrolled');
    else nav.classList.remove('is-scrolled');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------- Quick chat widget ---------------- */
  const quickChatBtn = $('#quickChatBtn');
  const quickChatPanel = $('#quickChatPanel');
  function closeQuickChat() {
    quickChatPanel.classList.remove('is-open');
    quickChatBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!quickChatPanel.classList.contains('is-open')) quickChatPanel.hidden = true; }, reduced ? 0 : 200);
  }
  function openQuickChat() {
    quickChatPanel.hidden = false;
    requestAnimationFrame(() => {
      quickChatPanel.classList.add('is-open');
      quickChatBtn.setAttribute('aria-expanded', 'true');
    });
  }
  quickChatBtn.addEventListener('click', () => {
    if (quickChatPanel.classList.contains('is-open')) closeQuickChat(); else openQuickChat();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#quickChatBtn') && !e.target.closest('#quickChatPanel')) closeQuickChat();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeQuickChat(); });
  $$('.quick-chat__option').forEach(a => a.addEventListener('click', closeQuickChat));

  /* ---------------- Reveal on scroll ---------------- */
  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);

    // Hardens against stale ScrollTrigger measurements after layout shifts
    // (font swap, resize, orientation change) so the hero never gets stuck hidden.
    let refreshTimer;
    const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 150); };
    window.addEventListener('resize', scheduleRefresh);
    window.addEventListener('orientationchange', scheduleRefresh);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRefresh);
    window.addEventListener('load', scheduleRefresh);

    if (!reduced) {
      gsap.utils.toArray('[data-reveal]').forEach(el => {
        gsap.fromTo(el, { opacity: 0, y: 26 }, {
          opacity: 1, y: 0, duration: 0.9, ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true }
        });
      });
    } else {
      $$('[data-reveal]').forEach(el => { el.style.opacity = 1; el.style.transform = 'none'; });
    }
  } else {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-revealed'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    $$('[data-reveal]').forEach(el => io.observe(el));
  }
})();
