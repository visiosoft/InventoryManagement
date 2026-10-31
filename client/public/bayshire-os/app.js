(function () {
  const D = TwoCapData;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const units = D.buildUnits();

  /* ---------------- three.js, fetched only when a 3D scene is shown ---------------- */
  const THREE_SRC = 'https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js';
  const lite3d = reduced || matchMedia('(max-width: 768px)').matches ||
    Boolean(navigator.connection && navigator.connection.saveData);
  let threeLoading = null;
  // With no real GPU, WebGL renders on the CPU and locks up the page
  let softGL = null;
  function softwareGL() {
    if (softGL === null) {
      const gl = document.createElement('canvas').getContext('webgl');
      const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '';
      softGL = !gl || /swiftshader|llvmpipe|software/i.test(name);
    }
    return softGL;
  }
  function loadThree() {
    if (window.THREE) return Promise.resolve();
    if (!threeLoading) {
      threeLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = THREE_SRC;
        s.onload = resolve;
        s.onerror = () => { threeLoading = null; reject(new Error('three.js failed to load')); };
        document.head.appendChild(s);
      });
    }
    return threeLoading;
  }

  const state = {
    view: 'floor',
    selectedUnit: units.find(u => u.code === 'F2-034') || units[0],
    leadId: 6,
    contractStep: 3,
    contractActivated: false,
    docusignSent: false,
    inbound: '',
    draft: '',
    aiBusy: false
  };

  /* ---------------- Theme ---------------- */
  function isDark() { return document.documentElement.dataset.theme === 'dark'; }
  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('twocap-theme', dark ? 'dark' : 'light'); } catch (e) {}
    syncThemeToggle();
    if (window.__twocapScene) window.__twocapScene.applyTheme();
    if (window.__twocapUnitsScene) window.__twocapUnitsScene.applyTheme();
    if (window.__twocapAmbientScene) window.__twocapAmbientScene.applyTheme();
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

  /* ---------------- Product dropdown ---------------- */
  const productMenuBtn = $('#productMenuBtn');
  const productDropdown = $('#productDropdown');
  function closeProductMenu() {
    productDropdown.classList.remove('is-open');
    productMenuBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!productDropdown.classList.contains('is-open')) productDropdown.hidden = true; }, reduced ? 0 : 200);
  }
  function openProductMenu() {
    productDropdown.hidden = false;
    requestAnimationFrame(() => {
      productDropdown.classList.add('is-open');
      productMenuBtn.setAttribute('aria-expanded', 'true');
    });
  }
  productMenuBtn.addEventListener('click', () => {
    if (productDropdown.classList.contains('is-open')) closeProductMenu(); else openProductMenu();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#productMenuBtn') && !e.target.closest('#productDropdown')) closeProductMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProductMenu(); });
  $$('#productDropdown a').forEach(a => a.addEventListener('click', closeProductMenu));

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

  /* ---------------- Hero video ---------------- */
  const demoVideo = $('#demoVideo');
  const videoOverlay = $('#videoOverlay');
  $('#playBtn').addEventListener('click', () => {
    demoVideo.controls = true;
    demoVideo.play();
    videoOverlay.classList.add('is-hidden');
  });
  demoVideo.addEventListener('pause', () => {
    if (demoVideo.currentTime === 0) videoOverlay.classList.remove('is-hidden');
  });
  demoVideo.addEventListener('ended', () => {
    demoVideo.controls = false;
    videoOverlay.classList.remove('is-hidden');
  });

  /* ---------------- Announcement ---------------- */
  $('#announceDismiss').addEventListener('click', () => {
    $('#announce').classList.add('is-hidden');
  });

  const DEMO_EMAIL = 'hello@2capacity.com';
  const DEMO_REQUEST_URL = 'https://2capacity.com/api/demo-requests';

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

  /* ---------------- Reporting charts: bars + occupancy ---------------- */
  function renderBars(container, data, labelsContainer) {
    container.innerHTML = '';
    data.forEach(m => {
      const bar = document.createElement('div');
      bar.className = 'bar' + (m.accent ? ' bar--accent' : '');
      bar.dataset.h = m.h;
      bar.title = m.l;
      container.appendChild(bar);
    });
    if (labelsContainer) {
      labelsContainer.innerHTML = '';
      data.forEach(m => {
        const s = document.createElement('span');
        s.textContent = m.l;
        labelsContainer.appendChild(s);
      });
    }
  }
  renderBars($('#reportBars'), D.revenue, null);

  function renderOccList(container, data) {
    container.innerHTML = '';
    data.forEach(o => {
      const row = document.createElement('div');
      row.className = 'occ-row';
      row.innerHTML = `<span>${o.s}</span><div class="occ-bar"><div class="occ-bar__fill" data-p="${o.p}"></div></div><span>${o.p}%</span>`;
      container.appendChild(row);
    });
  }
  renderOccList($('#occBySizeShort'), D.occBySizeShort);

  const unitCount = units.length;
  const availCount = units.filter(u => u.floor === 2 && u.sqft >= 100 && u.status === 'Available').length;
  $('#availCount').textContent = availCount + ' results';

  function animateBars() {
    $$('#reportBars .bar').forEach(b => { b.style.height = b.dataset.h + '%'; });
    $$('.occ-bar__fill').forEach(f => { f.style.width = f.dataset.p + '%'; });
  }
  const barsIo = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { animateBars(); barsIo.disconnect(); }
  }, { threshold: 0.15 });
  barsIo.observe($('#reporting'));

  /* ---------------- Units: floor + 3D + table ---------------- */
  const floorTabBtn = $('#floorTabBtn'), threeDTabBtn = $('#threeDTabBtn'), tableTabBtn = $('#tableTabBtn');
  const floorView = $('#floorView'), tableView = $('#tableView');
  const floorPlanEl = $('#floorPlan'), canvas3dEl = $('#unitsCanvas3d'), plan3dHint = $('#plan3dHint');
  let unitsScene = null, unitsScene3dVisible = false;

  function decorate(u) {
    return {
      ...u,
      weekly: D.fmt(u.price / 4),
      statusColor: D.statusColor(u.status),
      suggest: D.suggestFor(u)
    };
  }

  function renderFloorPlan() {
    const plan = $('#floorPlan');
    plan.innerHTML = '';
    const W = 42, D2 = 23;
    units.forEach(u => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'unit-btn' + (u.code === state.selectedUnit.code ? ' is-selected' : '');
      btn.setAttribute('aria-label', u.code + ', ' + u.sqft + ' sq ft, ' + u.status);
      btn.style.left = (u.x / W * 100) + '%';
      btn.style.top = (u.z / D2 * 100) + '%';
      btn.style.width = ((u.w - 0.15) / W * 100) + '%';
      btn.style.height = ((u.d - 0.15) / D2 * 100) + '%';
      btn.style.background = 'var(--st-' + u.status.toLowerCase() + ')';
      const select = () => selectUnit(u);
      btn.addEventListener('mouseenter', select);
      btn.addEventListener('focus', select);
      btn.addEventListener('click', select);
      plan.appendChild(btn);
    });
    $('#unitCountLabel').textContent = unitCount + ' units · 2 floors';
  }

  function selectUnit(u) {
    if (state.selectedUnit.code === u.code) return;
    state.selectedUnit = u;
    renderFloorPlan();
    renderUnitDetail();
    if (unitsScene) unitsScene.setSelected();
  }
  function selectUnitByCode(code) {
    const u = units.find(x => x.code === code);
    if (u) selectUnit(u);
  }

  function renderUnitDetail() {
    const u = decorate(state.selectedUnit);
    $('#unitDetail').innerHTML = `
      <div class="unit-detail__code">${u.code}</div>
      <div class="unit-detail__kv">
        <span>Size</span><span>${u.sqft} sq ft</span>
        <span>Dimensions</span><span>${u.dims}</span>
        <span>4-week rate</span><span>$${u.price} / 4 weeks</span>
        <span>Weekly equivalent</span><span>$${u.weekly}</span>
        <span>Status</span><span style="font-weight:600;color:${u.statusColor}">${u.status}</span>
      </div>
      <div class="suggest-box">
        <span class="suggest-box__title">Suggested 4-week rate · $${u.suggest.sug.toLocaleString('en-US')}</span>
        <span class="muted">${u.suggest.why}</span>
      </div>
      <p class="fine">Weekly rates calculate automatically from configurable pricing rules, for example <span class="mono ink">4-week rate &divide; 4</span>. Units can be created, read, updated and deleted directly in inventory.</p>
    `;
  }

  function renderUnitsTable() {
    const rows = units.filter(u => u.floor === 2).slice(0, 12).map(decorate);
    $('#unitsTableBody').innerHTML = rows.map(u => `
      <tr>
        <td>${u.code}</td><td>${u.floor}</td><td>${u.sqft} sq ft</td><td>${u.dims}</td>
        <td style="font-family:'Manrope',sans-serif;font-weight:600;color:${u.statusColor}">${u.status}</td>
        <td>$${u.price}</td><td>$${u.weekly}</td>
      </tr>`).join('');
    $('#tableFootCount').textContent = 'Showing 12 of ' + unitCount;
  }

  function setView(v) {
    state.view = v;
    const isFloor = v === 'floor', is3d = v === '3d', isTable = v === 'table';
    floorTabBtn.classList.toggle('segmented__btn--active', isFloor);
    threeDTabBtn.classList.toggle('segmented__btn--active', is3d);
    tableTabBtn.classList.toggle('segmented__btn--active', isTable);
    floorTabBtn.setAttribute('aria-selected', String(isFloor));
    threeDTabBtn.setAttribute('aria-selected', String(is3d));
    tableTabBtn.setAttribute('aria-selected', String(isTable));
    floorView.hidden = isTable;
    tableView.hidden = !isTable;
    floorPlanEl.hidden = is3d;
    canvas3dEl.hidden = !is3d;
    plan3dHint.classList.toggle('is-visible', is3d);

    if (is3d) {
      // The visitor asked for 3D, so this one loads three.js even on phones
      loadThree().then(() => {
        if (!unitsScene) {
          unitsScene = TwoCapUnitsScene({
            canvasEl: canvas3dEl, units,
            getSelectedCode: () => state.selectedUnit.code,
            onSelect: selectUnitByCode
          });
          window.__twocapUnitsScene = unitsScene;
        }
        if (unitsScene3dVisible && state.view === '3d') unitsScene.start();
      }).catch(() => {});
    } else if (unitsScene) {
      unitsScene.stop();
    }
  }
  floorTabBtn.addEventListener('click', () => setView('floor'));
  threeDTabBtn.addEventListener('click', () => setView('3d'));
  tableTabBtn.addEventListener('click', () => setView('table'));

  // Pause the 3D unit picker's render loop whenever it scrolls off-screen.
  new IntersectionObserver(entries => {
    unitsScene3dVisible = entries.some(e => e.isIntersecting);
    if (!unitsScene) return;
    if (unitsScene3dVisible && state.view === '3d') unitsScene.start();
    else unitsScene.stop();
  }, { threshold: 0.1 }).observe(canvas3dEl);

  renderFloorPlan();
  renderUnitDetail();
  renderUnitsTable();

  /* ---------------- Pipeline ---------------- */
  const FLOW = ['Lead', 'Quote', 'Contract', 'Payment'];
  function renderFlow() {
    $('#flowTrack').innerHTML = FLOW.map((n, i) => `
      <div class="flow-step">
        <span class="flow-step__label">${n}</span>
        ${i < 3 ? '<span class="flow-step__line"></span><span class="flow-step__arrow">&rarr;</span>' : ''}
      </div>`).join('');
  }
  renderFlow();

  const KANBAN_COLS = ['New', 'Contacted', 'Qualified', 'Quoted', 'Won'];
  function renderKanban() {
    $('#kanban').innerHTML = KANBAN_COLS.map(col => {
      const cards = D.leads.filter(l => l.col === col);
      return `
        <div>
          <div class="kanban-col-head"><span>${col}</span><span class="mono muted" style="font-weight:400">${cards.length}</span></div>
          <div class="kanban-cards">
            ${cards.map(l => `
              <button type="button" class="lead-card${l.id === state.leadId ? ' is-selected' : ''}" data-lead="${l.id}" aria-pressed="${l.id === state.leadId}">
                <span class="lead-card__name">${l.n}</span>
                <span class="lead-card__unit">${l.sq} sq ft · ${l.code}</span>
                <span class="lead-card__meta"><span>${l.src}</span><span class="mono">${l.t}</span></span>
              </button>`).join('')}
          </div>
        </div>`;
    }).join('');
    $$('.lead-card').forEach(btn => {
      btn.addEventListener('click', () => selectLead(Number(btn.dataset.lead)));
    });
  }

  function selectLead(id) {
    state.leadId = id;
    state.contractActivated = false;
    state.docusignSent = false;
    state.inbound = '';
    state.draft = '';
    renderKanban();
    renderQuote();
    renderWizard();
    renderLifecycle();
    renderSchedule();
    renderAssist();
    renderDocusignStatus();
  }

  function currentLead() { return D.leads.find(l => l.id === state.leadId); }

  function renderQuote() {
    const lead = currentLead();
    const rate = lead.sq * 3;
    const disc = lead.sq >= 200 ? Math.round(rate * 0.05) : 0;
    const net = rate - disc;
    const vat = Math.round(net * 0.05 * 100) / 100;
    $('#quoteId').textContent = 'Q-0' + (330 + lead.id) + ' · Draft';
    const rows = [
      { k: 'Customer', v: lead.n, mono: false, bold: true },
      { k: 'Unit', v: lead.code + ' · ' + lead.sq + ' sq ft', mono: true },
      { k: 'Line item', v: 'Storage unit, 4-week term', mono: false },
      { k: 'Quantity', v: '1', mono: true },
      { k: 'Rate', v: '$' + D.fmt(rate), mono: true },
      { k: 'Discount', v: disc ? '- $' + D.fmt(disc) + ' (5%)' : '$0.00', mono: true },
      { k: 'Tax 5%', v: '$' + D.fmt(vat), mono: true },
      { k: 'Total', v: '$' + D.fmt(net + vat), mono: true, bold: true }
    ];
    $('#quoteRows').innerHTML = rows.map(r => `
      <div class="kv-row"><span>${r.k}</span><span style="${r.mono ? "font-family:'IBM Plex Mono',monospace;" : ''}${r.bold ? 'font-weight:600;' : ''}">${r.v}</span></div>
    `).join('');
    return { net, vat, rate, disc };
  }

  const STEP_NAMES = ['Customer', 'Unit', 'Terms', 'Review'];
  function renderWizardTabs() {
    $('#wizardTabs').innerHTML = STEP_NAMES.map((n, i) => `
      <button type="button" class="wizard-tab${i === state.contractStep ? ' is-active' : i < state.contractStep ? ' is-done' : ''}" data-step="${i}" role="tab" aria-selected="${i === state.contractStep}">
        <span class="wizard-tab__i">0${i + 1}</span>${n}
      </button>`).join('');
    $$('.wizard-tab').forEach(btn => btn.addEventListener('click', () => { state.contractStep = Number(btn.dataset.step); renderWizard(); }));
  }

  function renderWizard() {
    renderWizardTabs();
    const lead = currentLead();
    const { net, vat } = computeTotals(lead);
    const wiz = [
      [{ k: 'Name', v: lead.n }, { k: 'Phone', v: '+1 555 xxx xxxx', mono: true }, { k: 'Email', v: 'customer@example.com', mono: true }, { k: 'Source', v: lead.src + ' · lead L-0' + (330 + lead.id) }],
      [{ k: 'Unit', v: lead.code, mono: true }, { k: 'Size', v: lead.sq + ' sq ft', mono: true }, { k: 'Floor', v: lead.code.slice(1, 2), mono: true }, { k: 'Status', v: 'Reserved on activation' }],
      [{ k: 'Start', v: '01 Jul 2026', mono: true }, { k: 'Term', v: '4 weeks, rolling' }, { k: 'Rate', v: '$' + D.fmt(net) + ' / 4 weeks', mono: true }, { k: 'Expiry alert', v: '30 days before end' }],
      [{ k: 'Customer', v: lead.n }, { k: 'Unit', v: lead.code + ' · ' + lead.sq + ' sq ft', mono: true }, { k: 'Total / term', v: '$' + D.fmt(net + vat) + ' incl. tax', mono: true }, { k: 'From quote', v: 'Q-0' + (330 + lead.id) + ' · no fields re-entered' }]
    ][state.contractStep];
    $('#wizardRows').innerHTML = wiz.map(r => `<div class="kv-row"><span>${r.k}</span><span${r.mono ? " style=\"font-family:'IBM Plex Mono',monospace;\"" : ''}>${r.v}</span></div>`).join('');
    $('#activateBtn').textContent = state.contractActivated ? 'Contract active' : 'Activate contract';
  }

  function computeTotals(lead) {
    const rate = lead.sq * 3;
    const disc = lead.sq >= 200 ? Math.round(rate * 0.05) : 0;
    const net = rate - disc;
    const vat = Math.round(net * 0.05 * 100) / 100;
    return { net, vat, rate, disc };
  }

  function renderLifecycle() {
    const stateName = state.contractActivated ? 'Active' : 'Pending';
    $('#lifecycle').innerHTML = ['Draft', 'Pending', 'Active', 'Ended', 'Cancelled'].map(n => `
      <div class="lifecycle-item${n === stateName ? ' is-active' : ''}"><span class="lifecycle-item__dot"></span>${n}</div>
    `).join('');
  }

  function renderSchedule() {
    const lead = currentLead();
    const { net, vat } = computeTotals(lead);
    const amt = '$' + D.fmt(net + vat);
    const schedule = [
      { d: '01 Jul 2026', s: 'Paid' }, { d: '29 Jul 2026', s: 'Paid' }, { d: '26 Aug 2026', s: 'Overdue' },
      { d: '23 Sep 2026', s: 'Due' }, { d: '21 Oct 2026', s: 'Scheduled' }
    ].map(p => ({ ...p, color: p.s === 'Overdue' ? 'var(--oxide)' : p.s === 'Paid' ? 'var(--accent)' : 'var(--ink2)' }));
    $('#scheduleUnit').textContent = 'Every 4 weeks · ' + lead.code;
    $('#scheduleRows').innerHTML = schedule.map(p => `
      <div class="kv-row" style="grid-template-columns:1fr auto auto;align-items:center;opacity:${state.contractActivated ? 1 : .35};transition:opacity .4s">
        <span class="mono">${p.d}</span><span class="mono">${amt}</span><span class="status-badge" style="color:${p.color}">${p.s}</span>
      </div>`).join('');
  }

  function renderDocusignStatus() {
    const el = $('#docusignStatus');
    const btn = $('#docusignBtn');
    if (state.docusignSent) {
      el.textContent = 'Sent to ' + currentLead().n + ' for e-signature. Activation creates the payment schedule automatically.';
      btn.textContent = 'Sent for signature';
      btn.disabled = true;
    } else {
      el.textContent = 'Activation creates the payment schedule automatically.';
      btn.textContent = 'Send via E-Signature';
      btn.disabled = false;
    }
  }

  $('#toContractBtn').addEventListener('click', () => { state.contractStep = 3; renderWizard(); document.getElementById('wizardTabs').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); });
  $('#activateBtn').addEventListener('click', () => {
    state.contractActivated = true; state.contractStep = 3;
    renderWizard(); renderLifecycle(); renderSchedule();
  });
  $('#docusignBtn').addEventListener('click', () => {
    state.docusignSent = true;
    renderDocusignStatus();
  });

  renderKanban();
  renderQuote();
  renderWizard();
  renderDocusignStatus();
  renderLifecycle();
  renderSchedule();

  /* ---------------- Finance ---------------- */
  function renderChain(id, nodes) {
    $(id).innerHTML = nodes.map((n, i) => `
      <div class="chain-node">
        <div class="chain-box" style="border-color:${n.color};border-left-color:${n.color}">
          <div class="chain-box__n">${n.n}</div><div class="chain-box__id">${n.id}</div>
        </div>
        ${i < nodes.length - 1 ? '<span class="chain-arrow"></span>' : ''}
      </div>`).join('');
  }
  renderChain('#chainA', [
    { n: 'Contract', id: 'CT-0197', color: 'var(--g1)' },
    { n: 'Invoice', id: 'INV-2041', color: 'var(--g1)' },
    { n: 'Payment', id: 'PAY-5120', color: 'var(--g1)' }
  ]);
  renderChain('#chainB', [
    { n: 'Vendor', id: 'VEN-014', color: 'var(--g2)' },
    { n: 'Purchase', id: 'PO-0088', color: 'var(--g2)' },
    { n: 'Expense', id: 'EXP-0412', color: 'var(--g2)' },
    { n: 'Attachment', id: '3 files · 2.1 MB', color: 'var(--g2)' }
  ]);
  $('#csvRows').innerHTML = D.csvRows.map(r => `
    <tr><td style="font-family:'Manrope',sans-serif;font-weight:600">${r.v}</td><td class="muted" style="font-family:'Manrope',sans-serif">${r.c}</td><td>${r.a}</td><td style="font-size:12px;color:${r.color}">${r.m}</td></tr>
  `).join('');

  /* ---------------- Reporting ---------------- */
  $('#docsRows').innerHTML = D.docs.map(d => `
    <div class="kv-row"><span><span style="font-weight:600;color:var(--ink)">${d.n}</span><span class="muted"> · ${d.s}</span></span><span class="mono muted">${d.c}</span></div>
  `).join('');
  $('#payStatus').innerHTML = D.payStatus.map(p => `
    <div><div class="pay-status__v" style="color:${p.color}">${p.v}</div><div class="pay-status__l">${p.n}</div></div>
  `).join('');

  /* ---------------- Assist ---------------- */
  function renderAssist() {
    const lead = currentLead();
    const unit = units.find(u => u.code === lead.code) || units[0];
    $('#leadName').textContent = lead.n;
    const inbound = $('#inboundMessage');
    inbound.value = state.inbound || D.defaultInbound(lead);
    $('#draftPanel').textContent = state.draft || 'Select a lead, edit the inbound message if needed, then draft a reply.';
    $('#draftMeta').textContent = '';
    $('#draftBtn').textContent = 'Draft reply';
    $('#draftBtn').disabled = false;
  }
  $('#inboundMessage').addEventListener('input', e => { state.inbound = e.target.value; });
  $('#draftBtn').addEventListener('click', () => {
    const lead = currentLead();
    const unit = units.find(u => u.code === lead.code) || units[0];
    const avail = units.filter(u => u.sqft === lead.sq && u.status === 'Available').length;
    state.aiBusy = true;
    $('#draftBtn').textContent = 'Drafting...';
    $('#draftBtn').disabled = true;
    $('#draftMeta').textContent = 'drafting...';
    setTimeout(() => {
      state.draft = D.templateReply(lead, unit, avail);
      state.aiBusy = false;
      $('#draftPanel').textContent = state.draft;
      $('#draftMeta').textContent = 'template draft · review before sending';
      $('#draftBtn').textContent = 'Draft reply';
      $('#draftBtn').disabled = false;
    }, 600);
  });
  renderAssist();

  $('#pricingRows').innerHTML = [50, 100, 200, 300].map(sq => {
    const u = { sqft: sq, price: sq * 3 };
    const g = D.suggestFor(u);
    const color = g.pct > 0 ? 'var(--g1)' : g.pct < 0 ? 'var(--g2)' : 'var(--ink2)';
    return `<tr><td class="mono" style="white-space:nowrap">${sq} sq ft</td><td class="mono">$${u.price.toLocaleString('en-US')}</td><td class="mono" style="font-weight:500;color:${color}">$${g.sug.toLocaleString('en-US')}</td><td class="muted small">${g.why}</td></tr>`;
  }).join('');
  $('#alertRows').innerHTML = D.alerts.map(a => `
    <div class="kv-row" style="grid-template-columns:72px 1fr"><span class="mono" style="color:var(--g2)">${a.t}</span><span style="line-height:1.5">${a.x}</span></div>
  `).join('');

  /* ---------------- Clients ---------------- */
  $('#clientList').innerHTML = D.clients.map(c => {
    const icon = c.icon ? `<img class="clients__icon" src="${c.icon}" alt="" aria-hidden="true">` : '';
    const mark = c.logo ? `<img src="${c.logo}" alt="${c.n}" width="${c.w}" height="${c.h}" loading="lazy">` : `${icon}<span class="clients__name">${c.n}</span>`;
    const inner = `${mark}<span class="clients__city">${c.city}</span>`;
    const ext = /^https?:/.test(c.href || '') ? ' target="_blank" rel="noopener"' : '';
    return `<li>${c.href ? `<a href="${c.href}"${ext}>${inner}</a>` : inner}</li>`;
  }).join('');

  /* ---------------- Testimonial (hidden until a real quote is added in data.js) ---------------- */
  if (D.testimonials.length) {
    const t = D.testimonials[0];
    $('#testimonialQuote').textContent = '\u201C' + t.quote + '\u201D';
    $('#testimonialWho').innerHTML = `<b>${t.name}</b>, ${t.role} &middot; ${t.company}`;
    if (t.photo) $('#testimonialPhoto').innerHTML = `<img src="${t.photo}" alt="${t.name}" loading="lazy">`;
    $('#testimonial').hidden = false;
  }

  /* ---------------- Six areas ---------------- */
  $('#areaGrid').innerHTML = D.areas.map(a => `
    <article class="area-card">
      <span class="area-card__badge">Available now</span>
      <div class="area-card__n">${a.n}</div>
      <p class="area-card__d">${a.d}</p>
      <p class="area-card__x"><b>For example:</b> ${a.x}</p>
    </article>`).join('');

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

  /* ---------------- Live AI demo: scripted, answers from the sample units ---------------- */
  const demoSizes = [...new Set(units.map(u => u.sqft))].sort((a, b) => a - b);
  const HANDOVER = 'Handed to a person';
  function demoAnswer(q) {
    const t = q.toLowerCase();
    if (/discount|cheaper|offer|deal|best price/.test(t)) return { tag: HANDOVER, text: "I'll pass that to the team. Discounts are always agreed by a person, so someone will reply here shortly." };
    if (/contract|pay|card|invoice|refund|complain|manager|human|person/.test(t)) return { tag: HANDOVER, text: "That one's for the team. I've passed it on with a short summary and a person will reply here." };
    const m = t.match(/(\d{2,4})\s*(sq|ft|sf|square)?/);
    if (m || /price|cost|rate|how much|availab|free|size|unit/.test(t)) {
      const want = m ? Number(m[1]) : 50;
      const size = demoSizes.reduce((b, s) => Math.abs(s - want) < Math.abs(b - want) ? s : b, demoSizes[0]);
      const free = units.filter(u => u.sqft === size && u.status === 'Available');
      if (!free.length) return { tag: 'Checked live availability', text: `${size} sq ft is fully booked right now. Want me to check the next size up?` };
      const u = free[0];
      return { tag: 'Price from unit list', text: `${size === want ? '' : `The closest size is ${size} sq ft. `}We have ${free.length} unit${free.length > 1 ? 's' : ''} of ${size} sq ft free, like ${u.code} (${u.dims}). It's $${D.fmt(u.price)} per 4 weeks, about $${D.fmt(u.price / 4)} a week. Shall I send you a written quote?` };
    }
    if (/hour|open|access|time/.test(t)) return { tag: 'From facility facts', text: 'The sample facility is open for access from 7am to 10pm, every day.' };
    if (/where|location|address|map/.test(t)) return { tag: 'From facility facts', text: 'The sample facility is on Sample Street, near the city centre. I can send you a map pin.' };
    if (/minimum|how long|shortest|month|week/.test(t)) return { tag: 'From facility facts', text: 'Contracts run in 4-week periods on a rolling basis, so you can stay as long as you need.' };
    if (/^\s*(hi|hello|hey|salam|marhaba|good)/.test(t)) return { tag: 'AI draft', text: 'Hi! What are you looking to store, and roughly how much space do you need?' };
    return { tag: HANDOVER, text: "I'm not sure about that one, so I'll check with the team rather than guess. Someone will reply here shortly." };
  }
  const demoBody = $('#demoChatBody');
  function demoBubble(cls, text, tag) {
    const el = document.createElement('div');
    el.className = 'bubble ' + cls;
    if (tag) {
      const t = document.createElement('span');
      t.className = 'bubble__tag' + (tag === HANDOVER ? ' bubble__tag--handover' : '');
      t.textContent = tag;
      el.append(t);
    }
    el.append(text);
    demoBody.append(el);
    demoBody.scrollTop = demoBody.scrollHeight;
  }
  let demoBusy = false;
  function demoAsk(q) {
    if (!q || demoBusy) return;
    demoBusy = true;
    demoBubble('bubble--in', q);
    demoBody.insertAdjacentHTML('beforeend', TYPING);
    demoBody.scrollTop = demoBody.scrollHeight;
    setTimeout(() => {
      demoBody.querySelector('[data-typing]')?.remove();
      const a = demoAnswer(q);
      demoBubble('bubble--ai', a.text, a.tag);
      demoBusy = false;
    }, reduced ? 0 : 1000);
  }
  demoBubble('bubble--ai', "Hi, I'm Aisha. Ask me about sizes, prices or availability at our sample facility.", 'AI');
  $('#demoChips').innerHTML = ['Price for 50 sq ft?', 'Anything around 100 sq ft free?', 'Can I get a discount?', 'What are your access hours?']
    .map(c => `<button type="button" class="demo-chip">${c}</button>`).join('');
  $$('.demo-chip').forEach(b => b.addEventListener('click', () => demoAsk(b.textContent)));
  $('#demoChatForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#demoChatInput');
    demoAsk(input.value.trim());
    input.value = '';
  });

  /* ---------------- ROI estimate ---------------- */
  const roiIds = ['roiInq', 'roiMin', 'roiAfter', 'roiClose'];
  function renderRoi() {
    const [inq, min, after, close] = roiIds.map(id => Number($('#' + id).value));
    roiIds.forEach(id => { $('#' + id + 'Out').textContent = $('#' + id).value + ($('#' + id).dataset.unit || ''); });
    // Assumptions stated under the results: drafts halve writing time, a quarter of after-hours inquiries are lost today
    $('#roiHours').textContent = Math.round(inq * min * 0.5 / 60);
    $('#roiAfterCount').textContent = Math.round(inq * after / 100);
    $('#roiUnits').textContent = (inq * (after / 100) * 0.25 * (close / 100)).toFixed(1);
  }
  roiIds.forEach(id => $('#' + id).addEventListener('input', renderRoi));
  renderRoi();

  /* ---------------- Modules / Integrations ---------------- */
  $('#moduleGrid').innerHTML = D.modules.map(m => `
    <div class="module-card" style="border-top-color:${m.color}"><div class="module-card__n">${m.n}</div><div class="module-card__d">${m.d}</div></div>
  `).join('');
  $('#heroIntegrations').innerHTML = D.integrations.map(i => `
    <li><a href="#integrations"><img src="${i.logo}" alt="" width="20" height="20"><span>${i.n.replace(' (MCP)', '')}</span></a></li>`).join('');

  $('#integrationList').innerHTML = D.integrations.map(i => `
    <div class="integration-row">
      <div class="integration-mark" aria-hidden="true">${i.logo ? `<img src="${i.logo}" alt="">` : i.mark}</div>
      <div><div class="integration-name">${i.n}</div><div class="integration-desc">${i.d}</div></div>
    </div>`).join('');

  /* ---------------- About / Team ---------------- */
  // Placeholder silhouette until a member's photo is set in data.js
  const AVATAR_PLACEHOLDER = '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="24" r="12" fill="currentColor"/><path d="M8 62c0-14 11-22 24-22s24 8 24 22" fill="currentColor"/></svg>';
  $('#teamGrid').innerHTML = D.team.map(p => `
    <div class="team-card">
      <div class="team-avatar" style="border-top-color:${p.color}">${p.photo ? `<img src="${p.photo}" alt="${p.n}" loading="lazy">` : AVATAR_PLACEHOLDER}</div>
      <div class="team-name">${p.n}</div>
      <div class="team-role">${p.r}</div>
      <div class="team-bio">${p.bio}</div>
    </div>`).join('');

  /* ---------------- 3D hero scene ---------------- */
  // Decorative 3D is skipped on phones, for reduced motion and on Save-Data:
  // three.js plus its render loop was most of the mobile load time and CPU.
  $('#top').classList.add('hero--static');
  if (!lite3d) {
    // Waits for the visitor's first move, so it never competes with page load
    const firstMove = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll'];
    const startHero = () => {
      firstMove.forEach(ev => window.removeEventListener(ev, startHero));
      if (softwareGL()) return;
      loadThree().then(() => {
        $('#top').classList.remove('hero--static');
        window.__twocapScene = TwoCapScene({
          canvasEl: $('#heroCanvas'),
          heroEl: $('#top'),
          textEl: $('#heroText'),
          metricsEl: $('#heroMetrics'),
          units
        });
      }).catch(() => {});
    };
    firstMove.forEach(ev => window.addEventListener(ev, startHero, { passive: true }));
  }

  /* ---------------- Ambient 3D backdrop for closing CTA ---------------- */
  const closingCanvas = $('#closingCanvas');
  let ambientScene = null, closingVisible = false;
  if (!lite3d) {
    new IntersectionObserver(entries => {
      closingVisible = entries.some(e => e.isIntersecting);
      if (!closingVisible) { if (ambientScene) ambientScene.stop(); return; }
      if (softwareGL()) return;
      loadThree().then(() => {
        if (!ambientScene) {
          ambientScene = TwoCapAmbientScene({ canvasEl: closingCanvas });
          window.__twocapAmbientScene = ambientScene;
        }
        if (closingVisible) ambientScene.start();
      }).catch(() => {});
    }, { threshold: 0.1 }).observe(closingCanvas);
  }
})();
