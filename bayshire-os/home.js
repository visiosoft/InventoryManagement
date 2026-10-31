// Homepage only: demo form, proof strip, AI team and the hero chat.
(function () {
  const D = TwoCapData;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const units = D.buildUnits();

  const DEMO_EMAIL = 'hello@2capacity.com';
  const DEMO_REQUEST_URL = 'https://2capacity.com/api/demo-requests';

  /* ---------------- Contact form ---------------- */
  const contactForm = $('#contactForm');
  const contactFormView = $('#contactFormView');
  const contactSuccessView = $('#contactSuccessView');
  const contactFormError = $('#contactFormError');
  const contactSubmit = $('#contactSubmit');
  const CONTACT_ERROR_TEXT = contactFormError.textContent;
  const showContactError = msg => { contactFormError.textContent = msg; contactFormError.hidden = false; };
  contactForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (contactSubmit.disabled) return;
    const name = $('#contactName').value.trim();
    const email = $('#contactEmail').value.trim();
    const company = $('#contactCompany').value.trim();
    const phone = $('#contactPhone').value.trim();
    const facilities = $('#contactFacilities').value;
    const country = $('#contactCountry').value.trim();
    const message = $('#contactMessage').value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    // Honeypot: people never see the "Leave blank" field, bots fill it
    if ($('#contactWebsite').value) return;
    if (!name || !emailValid || !company || !facilities || !country) {
      showContactError(CONTACT_ERROR_TEXT);
      return;
    }
    contactFormError.hidden = true;
    const track = window.TwoCapTrack;
    const submitLabel = contactSubmit.textContent;
    contactSubmit.disabled = true;
    contactSubmit.textContent = 'Sending…';
    try {
      const res = await fetch(DEMO_REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, company, facilities, country, message, source: track ? track.source() : {} })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Request failed');
      }
      if (track) track.demoRequested({ facilities, country });
      contactFormView.hidden = true;
      contactSuccessView.hidden = false;
      contactSuccessView.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    } catch (err) {
      // The lead matters more than the form: fall back to plain email
      showContactError((err.message && err.message !== 'Request failed' && err.message !== 'Failed to fetch' ? err.message + ' ' : 'We could not send your request. ') +
        'You can also email us at ' + DEMO_EMAIL + '.');
    } finally {
      contactSubmit.disabled = false;
      contactSubmit.textContent = submitLabel;
    }
  });
  $('#contactResetBtn').addEventListener('click', () => {
    contactForm.reset();
    contactFormView.hidden = false;
    contactSuccessView.hidden = true;
  });

  /* ---------------- Clients ---------------- */
  $('#clientList').innerHTML = D.clients.map(c => {
    const icon = c.icon ? `<img class="clients__icon" src="${c.icon}" alt="" aria-hidden="true">` : '';
    const mark = c.logo ? `<img src="${c.logo}" alt="${c.n}" width="${c.w}" height="${c.h}" loading="lazy">` : `${icon}<span class="clients__name">${c.n}</span>`;
    const ext = /^https?:/.test(c.href || '') ? ' target="_blank" rel="noopener"' : '';
    return `<li>${c.href ? `<a href="${c.href}"${ext}>${mark}</a>` : mark}</li>`;
  }).join('');

  /* ---------------- Integration logos ---------------- */
  $('#proofIntegrations').innerHTML = D.integrations.map(i => {
    const name = i.n.replace(' (MCP)', '');
    return `<li><a href="platform/#integrations" title="${name}"><img src="${i.logo}" alt="${name}" width="22" height="22" loading="lazy"></a></li>`;
  }).join('');

  /* ---------------- Testimonial (hidden until a real quote is added in data.js) ---------------- */
  if (D.testimonials.length) {
    const t = D.testimonials[0];
    $('#testimonialQuote').textContent = '\u201C' + t.quote + '\u201D';
    $('#testimonialWho').innerHTML = `<b>${t.name}</b>, ${t.role} &middot; ${t.company}`;
    if (t.photo) $('#testimonialPhoto').innerHTML = `<img src="${t.photo}" alt="${t.name}" loading="lazy">`;
    $('#testimonial').hidden = false;
  }

  /* ---------------- AI team ---------------- */
  const agentAvatar = (a, cls) => `<span class="agent-avatar ${cls || ''}" aria-hidden="true">${a.n[0]}</span>`;
  $('#agentGrid').innerHTML = D.agents.map(a => `
    <article class="agent-card">
      <div class="agent-card__top">${agentAvatar(a)}<div><div class="agent-card__name">${a.n}</div><div class="agent-card__role">${a.r}</div></div></div>
      <p class="agent-card__d">${a.d}</p>
      <div class="agent-card__h"><b>Hands to you:</b> ${a.h}</div>
    </article>`).join('');

  /* ---------------- Hero chat: Aisha drafts, the owner approves ---------------- */
  const heroUnit = units.find(u => u.code === 'F2-034') || units[0];
  const TYPING = '<div class="typing" data-typing>Aisha is drafting <span class="typing__dots"><i></i><i></i><i></i></span></div>';
  const heroSteps = [
    { at: 500, html: '<div class="bubble bubble--in">Hi, price for 50 sq ft? Need it from Saturday.</div>' },
    { at: 1400, html: TYPING },
    { at: 3300, dropTyping: true, html: `<div class="bubble bubble--ai"><span class="bubble__tag">AI draft</span>Hi! A ${heroUnit.sqft} sq ft unit is free from Saturday: ${heroUnit.code}, ${heroUnit.dims}. It's $${D.fmt(heroUnit.price)} per 4 weeks, about $${D.fmt(heroUnit.price / 4)} a week. Shall I send you a written quote?</div>` },
    { at: 4300, html: '<div class="approve-card" data-approve><div class="approve-card__t">Draft ready. Approve and send?</div><div class="approve-card__d">Price checked against your unit list</div><div class="approve-card__btns"><span>Approve &amp; send</span><span>Edit</span></div></div>' },
    { at: 6400, approve: true, html: '<div class="sent-tick">Sent by you &middot; &#10003;&#10003;</div>' }
  ];
  const heroChat = $('#heroChatBody');
  function playHeroChat() {
    heroChat.innerHTML = '';
    if (reduced) {
      heroSteps.filter(s => s.html !== TYPING).forEach(s => heroChat.insertAdjacentHTML('beforeend', s.html));
      heroChat.querySelector('[data-approve]').classList.add('is-sent');
      return;
    }
    heroSteps.forEach(s => setTimeout(() => {
      if (s.dropTyping) heroChat.querySelector('[data-typing]')?.remove();
      if (s.approve) heroChat.querySelector('[data-approve]')?.classList.add('is-sent');
      heroChat.insertAdjacentHTML('beforeend', s.html);
    }, s.at));
    setTimeout(playHeroChat, 13000);
  }
  playHeroChat();
})();
