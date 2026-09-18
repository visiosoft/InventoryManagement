(function () {
  const D = BayshireData;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const units = D.buildUnits();

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
    try { localStorage.setItem('bayshire-theme', dark ? 'dark' : 'light'); } catch (e) {}
    $('#themeToggle').setAttribute('aria-pressed', String(dark));
    if (window.__bayshireScene) window.__bayshireScene.applyTheme();
    if (window.__bayshireUnitsScene) window.__bayshireUnitsScene.applyTheme();
    if (window.__bayshireAmbientScene) window.__bayshireAmbientScene.applyTheme();
  }
  $('#themeToggle').addEventListener('click', () => setTheme(!isDark()));
  $('#themeToggle').setAttribute('aria-pressed', String(isDark()));

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
  contactForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#contactName').value.trim();
    const email = $('#contactEmail').value.trim();
    const message = $('#contactMessage').value.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!name || !emailValid || !message) {
      contactFormError.hidden = false;
      return;
    }
    contactFormError.hidden = true;
    const subject = $('#contactSubject').value.trim() || ('Message from ' + name);
    const body = 'Name: ' + name + '\nEmail: ' + email + '\n\n' + message;
    const mailto = 'mailto:' + DEMO_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    contactFormView.hidden = true;
    contactSuccessView.hidden = false;
    window.location.href = mailto;
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

  const DEMO_EMAIL = 'xulfi.dev@gmail.com';

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

  /* ---------------- Dashboard: bars + occupancy ---------------- */
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
  renderBars($('#revenueBars'), D.revenue, $('#revenueLabels'));
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
  renderOccList($('#occBySize'), D.occBySize);
  renderOccList($('#occBySizeShort'), D.occBySizeShort);

  function renderRows() {
    $('#activityRows').innerHTML = D.activity.map(a =>
      `<div class="row-item"><span>${a.t}</span><span>${a.x}</span></div>`).join('');
    $('#expiryRows').innerHTML = D.expiries.map(e =>
      `<div class="row-item row-item--3"><span class="mono">${e.c}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.n}</span><span class="mono muted">${e.d} · ${e.days}d</span></div>`).join('');
    $('#paymentRows').innerHTML = D.payments.map(p =>
      `<div class="row-item row-item--pay"><span class="mono">${p.i}</span><span class="mono">${p.a}</span><span class="status-badge" style="color:${p.color}">${p.s}</span></div>`).join('');
  }
  renderRows();

  const unitCount = units.length;
  const availCount = units.filter(u => u.floor === 2 && u.sqft >= 100 && u.status === 'Available').length;
  $('#availCount').textContent = availCount + ' results';

  /* ---------------- KPI count-up ---------------- */
  let counted = false;
  function countUp() {
    if (counted) return;
    counted = true;
    const els = { occ: $('[data-kpi="occ"]'), avail: $('[data-kpi="avail"]'), rev: $('[data-kpi="rev"]'), exp: $('[data-kpi="exp"]'), over: $('[data-kpi="over"]') };
    const target = { occ: 87, avail: 31, rev: 284600, exp: 12, over: 7 };
    const set = o => {
      els.occ.textContent = Math.round(o.occ) + '%';
      els.avail.textContent = Math.round(o.avail);
      els.rev.textContent = 'AED ' + Math.round(o.rev).toLocaleString('en-US');
      els.exp.textContent = Math.round(o.exp);
      els.over.textContent = Math.round(o.over);
    };
    animateBars();
    if (reduced || !window.gsap) { set(target); return; }
    const o = { occ: 0, avail: 0, rev: 0, exp: 0, over: 0 };
    gsap.to(o, { ...target, duration: 1.4, ease: 'power2.out', onUpdate: () => set(o) });
  }
  function animateBars() {
    $$('#revenueBars .bar, #reportBars .bar').forEach(b => { b.style.height = b.dataset.h + '%'; });
    $$('.occ-bar__fill').forEach(f => { f.style.width = f.dataset.p + '%'; });
  }
  const dashBlock = $('#dashBlock');
  const io = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { countUp(); io.disconnect(); }
  }, { threshold: 0.15 });
  io.observe(dashBlock);

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
        <span>4-week rate</span><span>AED ${u.price} / 4 weeks</span>
        <span>Weekly equivalent</span><span>AED ${u.weekly}</span>
        <span>Status</span><span style="font-weight:600;color:${u.statusColor}">${u.status}</span>
      </div>
      <div class="suggest-box">
        <span class="suggest-box__title">Suggested 4-week rate · AED ${u.suggest.sug.toLocaleString('en-US')}</span>
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
        <td>AED ${u.price}</td><td>AED ${u.weekly}</td>
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
      if (!unitsScene) {
        unitsScene = BayshireUnitsScene({
          canvasEl: canvas3dEl, units,
          getSelectedCode: () => state.selectedUnit.code,
          onSelect: selectUnitByCode
        });
        window.__bayshireUnitsScene = unitsScene;
      }
      if (unitsScene3dVisible) unitsScene.start();
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
    const rate = lead.sq * 19;
    const disc = lead.sq >= 200 ? Math.round(rate * 0.05) : 0;
    const net = rate - disc;
    const vat = Math.round(net * 0.05 * 100) / 100;
    $('#quoteId').textContent = 'Q-0' + (330 + lead.id) + ' · Draft';
    const rows = [
      { k: 'Customer', v: lead.n, mono: false, bold: true },
      { k: 'Unit', v: lead.code + ' · ' + lead.sq + ' sq ft', mono: true },
      { k: 'Line item', v: 'Storage unit, 4-week term', mono: false },
      { k: 'Quantity', v: '1', mono: true },
      { k: 'Rate', v: 'AED ' + D.fmt(rate), mono: true },
      { k: 'Discount', v: disc ? '- AED ' + D.fmt(disc) + ' (5%)' : 'AED 0.00', mono: true },
      { k: 'VAT 5%', v: 'AED ' + D.fmt(vat), mono: true },
      { k: 'Total', v: 'AED ' + D.fmt(net + vat), mono: true, bold: true }
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
      [{ k: 'Name', v: lead.n }, { k: 'Phone', v: '+971 5x xxx xxxx', mono: true }, { k: 'Email', v: 'customer@example.com', mono: true }, { k: 'Source', v: lead.src + ' · lead L-0' + (330 + lead.id) }],
      [{ k: 'Unit', v: lead.code, mono: true }, { k: 'Size', v: lead.sq + ' sq ft', mono: true }, { k: 'Floor', v: lead.code.slice(1, 2), mono: true }, { k: 'Status', v: 'Reserved on activation' }],
      [{ k: 'Start', v: '01 Jul 2026', mono: true }, { k: 'Term', v: '4 weeks, rolling' }, { k: 'Rate', v: 'AED ' + D.fmt(net) + ' / 4 weeks', mono: true }, { k: 'Expiry alert', v: '30 days before end' }],
      [{ k: 'Customer', v: lead.n }, { k: 'Unit', v: lead.code + ' · ' + lead.sq + ' sq ft', mono: true }, { k: 'Total / term', v: 'AED ' + D.fmt(net + vat) + ' incl. VAT', mono: true }, { k: 'From quote', v: 'Q-0' + (330 + lead.id) + ' · no fields re-entered' }]
    ][state.contractStep];
    $('#wizardRows').innerHTML = wiz.map(r => `<div class="kv-row"><span>${r.k}</span><span${r.mono ? " style=\"font-family:'IBM Plex Mono',monospace;\"" : ''}>${r.v}</span></div>`).join('');
    $('#activateBtn').textContent = state.contractActivated ? 'Contract active' : 'Activate contract';
  }

  function computeTotals(lead) {
    const rate = lead.sq * 19;
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
    const amt = 'AED ' + D.fmt(net + vat);
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
    const u = { sqft: sq, price: sq * 19 };
    const g = D.suggestFor(u);
    const color = g.pct > 0 ? 'var(--g1)' : g.pct < 0 ? 'var(--g2)' : 'var(--ink2)';
    return `<tr><td class="mono" style="white-space:nowrap">${sq} sq ft</td><td class="mono">AED ${u.price.toLocaleString('en-US')}</td><td class="mono" style="font-weight:500;color:${color}">AED ${g.sug.toLocaleString('en-US')}</td><td class="muted small">${g.why}</td></tr>`;
  }).join('');
  $('#alertRows').innerHTML = D.alerts.map(a => `
    <div class="kv-row" style="grid-template-columns:72px 1fr"><span class="mono" style="color:var(--g2)">${a.t}</span><span style="line-height:1.5">${a.x}</span></div>
  `).join('');

  /* ---------------- Modules / Integrations ---------------- */
  $('#moduleGrid').innerHTML = D.modules.map(m => `
    <div class="module-card" style="border-top-color:${m.color}"><div class="module-card__n">${m.n}</div><div class="module-card__d">${m.d}</div></div>
  `).join('');
  $('#integrationList').innerHTML = D.integrations.map(i => `
    <div class="integration-row">
      <div class="integration-mark">${i.mark}</div>
      <div><div class="integration-name">${i.n}</div><div class="integration-desc">${i.d}</div></div>
    </div>`).join('');

  /* ---------------- About / Team ---------------- */
  function initials(name) { return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
  $('#teamGrid').innerHTML = D.team.map(p => `
    <div class="team-card">
      <div class="team-avatar" style="border-top-color:${p.color}">${initials(p.n)}</div>
      <div class="team-name">${p.n}</div>
      <div class="team-role">${p.r}</div>
      <div class="team-bio">${p.bio}</div>
    </div>`).join('');

  /* ---------------- 3D hero scene ---------------- */
  window.__bayshireScene = BayshireScene({
    canvasEl: $('#heroCanvas'),
    heroEl: $('#top'),
    textEl: $('#heroText'),
    metricsEl: $('#heroMetrics'),
    units
  });

  /* ---------------- Ambient 3D backdrop for closing CTA ---------------- */
  const closingCanvas = $('#closingCanvas');
  const ambientScene = BayshireAmbientScene({ canvasEl: closingCanvas });
  window.__bayshireAmbientScene = ambientScene;
  new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) ambientScene.start();
    else ambientScene.stop();
  }, { threshold: 0.1 }).observe(closingCanvas);
})();
