// Phone and tablet menu. Loaded on its own because the landing pages have no app.js.
(function () {
  const nav = document.getElementById('nav');
  const links = nav.querySelector('.nav__links');
  const actions = nav.querySelector('.nav__actions');
  const arabic = document.documentElement.lang === 'ar';
  const openLabel = arabic ? 'فتح القائمة' : 'Open menu';
  const closeLabel = arabic ? 'إغلاق القائمة' : 'Close menu';

  links.id = 'navMenu';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav__toggle';
  btn.setAttribute('aria-controls', 'navMenu');
  btn.innerHTML = '<span class="nav__toggle-bars" aria-hidden="true"></span>';
  actions.appendChild(btn);

  // Narrow phones have no room for the header button, so it moves into the menu
  const cta = actions.querySelector('.btn--solid');
  const menuCta = document.createElement('a');
  menuCta.className = 'nav__menu-cta';
  menuCta.href = cta.getAttribute('href');
  menuCta.textContent = cta.textContent;
  links.appendChild(menuCta);

  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? closeLabel : openLabel);
  }
  setOpen(false);

  btn.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  links.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('click', e => { if (!nav.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); btn.focus(); }
  });
  // Rotating a phone or widening a window past the breakpoint brings the inline links back
  matchMedia('(min-width:901px)').addEventListener('change', e => { if (e.matches) setOpen(false); });
})();
