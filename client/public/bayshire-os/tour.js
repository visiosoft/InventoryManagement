// Product tour: HTML recreations of the real 2Capacity screens, filled with sample data.
// No real customer names, numbers or financials are used here.
(function () {
  const root = document.getElementById('tour');
  if (!root) return;
  const $ = sel => root.querySelector(sel);

  const badge = (t, c) => `<span class="ta-badge ta-badge--${c}">${t}</span>`;
  const avatar = (n, c) => `<span class="ta-avatar ta-avatar--${c || 'p'}">${n.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>`;
  const agentDot = (n, c) => `<span class="ta-agent ta-agent--${c}">${n[0]}</span>`;

  const SCREENS = {
    dashboard: {
      title: 'Dashboard',
      caption: 'The overview: ask the AI anything about your facility, see expiring contracts waiting for approval, and live occupancy at a glance.',
      html: () => `
        <div class="ta-tabs"><span class="is-on">Overview</span><span>Sales</span><span>Leads</span><span>Finance</span><span>Customer Feedback</span></div>
        <div class="ta-ask"><span class="ta-spark">&#10022;</span>Ask about occupancy, expiring contracts, WhatsApp activity&hellip;<span class="ta-ask__go">&rarr;</span></div>
        <div class="ta-chips"><span>Which contracts expire in the next 15 days?</span><span>Who's still waiting for a WhatsApp reply?</span><span>How many 10 sq ft units are free?</span></div>
        <div class="ta-banner"><b>Contracts expiring soon</b><span>6 &middot; 15 days before expiry &middot; 3 &middot; 7 days &middot; 2 &middot; 1 day &mdash; reminders waiting on your approval</span><a>Review &amp; approve &rarr;</a></div>
        <div class="ta-kpis">
          <div class="ta-occ"><div class="ta-label">Occupancy</div><div class="ta-big">72%</div><div class="ta-bar"><i style="width:72%"></i></div>
            <div class="ta-occ__row"><span><b>168</b>Booked</span><span><b>12</b>Reserved</span><span><b>70</b>Vacant</span></div></div>
          <div class="ta-kpi"><div class="ta-label">Booked</div><div class="ta-big">168</div><div class="ta-sub">176 active contracts</div></div>
          <div class="ta-kpi"><div class="ta-label">Reserved</div><div class="ta-big">12</div><div class="ta-sub">held, not moved in yet</div></div>
          <div class="ta-kpi"><div class="ta-label">Vacant</div><div class="ta-big">70</div><div class="ta-sub">across 8 sizes</div></div>
        </div>
        <div class="ta-live"><span class="ta-livedot"></span>Live
          <div class="ta-live__row"><div><div class="ta-label">Waiting for a reply</div><div class="ta-mid">9</div></div><div><div class="ta-label">New leads today</div><div class="ta-mid">31</div></div><div><div class="ta-label">Replies sent today</div><div class="ta-mid">57</div></div></div>
        </div>`
    },
    needs: {
      title: 'Needs you',
      caption: 'Every AI draft lands here. Approve it as the agent, edit it, or dismiss it. Nothing reaches a customer until a person says so.',
      html: () => `
        <div class="ta-head"><div><h4>Needs you</h4><p>5 agents on duty &mdash; they draft and propose, nothing goes out until you approve it here.</p></div>
          <div class="ta-stats"><span><b>24</b>drafts to review</span><span><b>3</b>emails to review</span><span class="ta-red"><b>6</b>handed to you</span><span class="ta-amber"><b>9</b>follow-ups proposed</span></div></div>
        <div class="ta-chips ta-chips--dark"><span class="is-on">All agents &middot; 42</span><span>Aisha &middot; 24</span><span>Omar &middot; 9</span><span>Layla &middot; 4</span><span>Nadia &middot; 3</span><span>Sam &middot; 2</span></div>
        <div class="ta-card ta-card--accent"><div class="ta-row">${agentDot('Nadia', 'g')}<b>Nadia</b><span class="ta-muted">07:00 &middot; 14 sorted, 5 drafts, 2 for a person</span></div>
          <p class="ta-p">Good morning. 3 new storage inquiries came in by email overnight, I drafted replies for each. One supplier invoice and one complaint need a person.</p></div>
        ${[['Hannah Weber', 'Active', '"Hi, do you have something around 50 sq ft from next week? Mostly boxes."', 'Hi Hannah! Yes, we have a 50 sq ft unit free from Monday at AED 975 per 4 weeks. Shall I send you a quote?', 'lead file: 50 sqft &middot; boxes'],
           ['Karim Nassar', 'New', '"Ok"', 'Great! When would you like to come and see the unit?', '']]
          .map(([n, st, q, d, f]) => `<div class="ta-card"><div class="ta-row">${avatar(n, 'g')}<b>${n}</b>${badge(st, 'p')}<span class="ta-muted">wrote 11m ago &middot; <b class="ta-purple">Aisha</b> drafted</span><span class="ta-conf">confident</span></div>
            <div class="ta-quote">${q}</div><div class="ta-draft">${d}</div>${f ? `<div class="ta-muted ta-small">${f}</div>` : ''}
            <div class="ta-row ta-row--btns"><span class="ta-btn ta-btn--blue">Send as Aisha</span><span class="ta-btn">Edit</span><span class="ta-btn">&times; Dismiss</span><span class="ta-link">Open conversation &rarr;</span></div></div>`).join('')}`
    },
    team: {
      title: 'AI Sales Desk',
      caption: 'Your AI team. One lead is owned by one agent at a time, work moves between them at bucket boundaries, and every handoff is logged.',
      html: () => `
        <div class="ta-chips ta-chips--dark"><span>Needs you</span><span>Pipeline</span><span class="is-on">Team</span><span>Guide</span><span class="ta-cta">Open AI Sales Desk &#8599;</span></div>
        <h4 class="ta-h">The team</h4><p class="ta-muted">One lead is owned by one agent at a time. Work moves between them at bucket boundaries, and every handoff is logged.</p>
        <div class="ta-agents">${[
          ['Aisha', 'First response', 'p', ['New', 'Active'], 'en, ar', 412, 38, '80%'],
          ['Omar', 'Follow-ups', 'o', ['Going quiet', 'Not responding'], 'en', 388, 14, '&mdash;'],
          ['Layla', 'Closing', 'b', ['Quoted', 'Booking'], 'en', 27, 4, '&mdash;'],
          ['Nadia', 'Executive assistant', 'g', ['daily at 07:00'], '', 0, 5, '&mdash;'],
          ['Sam', 'Tenants', 'k', ['existing customers'], '', 19, 2, '&mdash;']
        ].map(([n, r, c, owns, lang, leads, today, ok]) => `<div class="ta-agentcard ta-agentcard--${c}">
            <div class="ta-row">${agentDot(n, c)}<b>${n}</b><span class="ta-toggle"></span></div>
            <div class="ta-small"><b>${r}</b> &middot; owns ${owns.map(o => badge(o, 'p')).join(' ')}</div>
            <div class="ta-muted ta-small">${lang ? lang + ' &middot; ' : ''}hands to nobody yet</div>
            <div class="ta-agentstats"><span><b>${leads}</b>leads</span><span><b>${today}</b>drafted today</span><span><b>${ok}</b>approved as is</span></div>
            <div class="ta-row">${badge('drafting for review', 'y')}<span class="ta-link">Open &rarr;</span></div></div>`).join('')}</div>`
    },
    inbox: {
      title: 'WhatsApp Inbox',
      caption: 'One shared WhatsApp inbox for the whole team, with the lead score, move-in date and next follow-up beside every chat.',
      html: () => `
        <div class="ta-inbox">
          <div class="ta-chats"><div class="ta-row"><b>Chats</b><span class="ta-purple ta-small">12 unread</span></div>
            <div class="ta-search">Search name or number</div>
            <div class="ta-seg"><span>My leads</span><span class="is-on">All</span><span>Unassigned</span></div>
            ${[['Laura Bianchi', 'Thank you so much', 'Customer', 'g', 1], ['Tom Reyes', 'Sure! What are you looking to store?', 'Lead', 'p', 1], ['Mina Park', 'That works for 150 sq ft?', 'Lead', 'p', 2], ['Daniel Osei', 'We are following up to see if you…', 'Lead', 'p', 0], ['Aylin Demir', '[image]', 'Customer', 'g', 0]]
              .map(([n, m, t, c, u], i) => `<div class="ta-chat${i === 2 ? ' is-on' : ''}">${avatar(n, c)}<div><b>${n}</b><div class="ta-muted ta-small">${m}</div>${badge(t, c)}</div>${u ? `<span class="ta-unread">${u}</span>` : ''}</div>`).join('')}
          </div>
          <div class="ta-convo"><div class="ta-row">${avatar('Mina Park', 'p')}<b>Mina Park</b>${badge('Lead', 'p')}${badge('Auto-assigned', 'p')}</div>
            <div class="ta-summ">&#10022; Summarise this conversation</div>
            <div class="ta-bubbles">
              <div class="ta-bub ta-bub--in">Hi, how much for a unit around 150 sq ft? I need it from the 1st.</div>
              <div class="ta-bub ta-bub--out"><div class="ta-unitpic"><b>150 SQ FT</b><span>F1-19</span></div>150 sq ft is free from the 1st: F1-19 at AED 2,700 per 4 weeks. Want me to hold it with a quote?</div>
              <div class="ta-bub ta-bub--in">That works for 150 sq ft?</div>
            </div>
            <div class="ta-row ta-row--btns"><span class="ta-btn">Remind me</span><span class="ta-btn ta-purple">&#10022; Suggest a reply</span></div>
            <div class="ta-compose">Type a message&hellip;<span class="ta-send">&#10148;</span></div>
          </div>
          <div class="ta-score"><b>Lead score</b><div>${badge('High &middot; 82', 'g')}</div><div class="ta-muted ta-small">gave specifics &middot; 4 messages back and forth</div>
            <div class="ta-small"><b>Next:</b> Send a quote for F1-19</div>
            <div class="ta-field"><span>Move-in date</span><i>01 / 11 / 2026</i></div>
            <div class="ta-field"><span>Unit size</span><i>150 sqft</i></div>
            <div class="ta-field"><span>Financially qualified?</span><div class="ta-seg"><span class="is-on">Yes</span><span>No</span></div></div>
            <div class="ta-field"><span>Is this reading right?</span><div class="ta-seg"><span class="is-on">Qualifying</span><span>Not interested</span></div></div>
          </div>
        </div>`
    },
    followups: {
      title: 'Follow-Ups',
      caption: 'Who needs a reply right now, who was missed, and how each rep is doing, so no lead waits longer than it should.',
      html: () => `
        <div class="ta-head"><div><h4>Follow-Ups</h4><p><b>64</b> to do today &middot; 31 done</p></div><div class="ta-chips"><span class="is-on">List</span><span>Board</span><span>How it works</span></div></div>
        <table class="ta-table"><thead><tr><th>Team</th><th>Reply now</th><th>Missed</th><th>Today</th><th>Later</th><th>Sent today</th></tr></thead><tbody>
          ${[['Rep 1', 4, 1, 22, 310, 26], ['Rep 2', 1, 0, 21, 284, 24], ['Rep 3', 0, 2, 18, 190, 11], ['Unassigned', 0, 0, 3, 0, 0]]
            .map(([n, a, b, c, d, e]) => `<tr><td>${n}</td><td class="${a ? 'ta-red' : ''}">${a}</td><td class="${b ? 'ta-red' : ''}">${b}</td><td>${c}</td><td>${d}</td><td>${e}</td></tr>`).join('')}
        </tbody></table>
        <div class="ta-tabs ta-tabs--line"><span class="is-on">Reply now <i>5</i></span><span>Missed <i>3</i></span><span>Today <i>61</i></span><span>Later <i>784</i></span><span>Sent</span></div>
        ${[['Lucas Martin', 'Hot', 'r', '33m'], ['Noura Saleh', 'Hot', 'r', '1h'], ['Brightline Events', 'Hot', 'r', '2h'], ['Ivan Petrov', 'Warm', 'y', '4h']]
          .map(([n, h, c, t]) => `<div class="ta-lead"><div><b>${n}</b> ${badge(h, c)}<div class="ta-muted ta-small">They wrote ${t} ago &mdash; waiting for your reply</div></div><span class="ta-btn ta-btn--green">Reply</span></div>`).join('')}`
    },
    units: {
      title: 'Search Units',
      caption: 'Live availability for any date window, counting contracts, tenancies and sent quotes, with first-period discounts shown on each unit.',
      html: () => `
        <div class="ta-label ta-purple">Operations</div><h4 class="ta-h">Unit availability</h4>
        <div class="ta-filters"><span>Free from<i>21/10/2026</i></span><span>Until<i>18/11/2026</i></span><span>Floor<i>All floors</i></span><span>Size<i>Any size</i></span><span class="ta-btn ta-btn--purple">Find available units</span></div>
        <div class="ta-muted ta-small"><b>86</b> of 250 units free for the whole window</div>
        <div class="ta-units">${[['F1-5', 150, 1, 2700], ['F1-14', 200, 1, 3100], ['F1-31', 75, 1, 1400, '5%'], ['F2-16', 35, 2, 770, '5%'], ['F2-48', 10, 2, 330, '20%'], ['F2-60', 50, 2, 975, '15%'], ['F2-69', 100, 2, 1650], ['F3-4', 50, 3, 975, '15%']]
          .map(([c, s, f, p, d]) => `<div class="ta-unit"><span class="ta-gdot"></span><b>${c}</b><div class="ta-muted ta-small">${s} sqft &middot; Floor F${f}</div><div class="ta-green ta-small">Free entire window</div><div class="ta-row">${d ? badge(d + ' 1st 4wk', 'y') : ''}<span class="ta-price">AED ${p.toLocaleString('en-US')}</span></div></div>`).join('')}</div>`
    },
    financials: {
      title: 'Actual vs Leased',
      caption: 'What each unit is priced at against what it actually let for, so you see empty space and discounting in money, not just percentages.',
      html: () => `
        <div class="ta-label ta-purple">Financials</div><h4 class="ta-h">Actual vs leased</h4><p class="ta-muted">What each unit is priced at, against what it actually let for.</p>
        <div class="ta-fin">
          <div class="ta-kpi"><div class="ta-label">Annual run rate</div><div class="ta-big">3,612,400</div><div class="ta-sub">asking &times; 13 four-week cycles</div></div>
          <div class="ta-kpi"><div class="ta-label">Monthly asking</div><div class="ta-big">277,880</div><div class="ta-sub">across all 250 units</div></div>
          <div class="ta-kpi ta-kpi--purple"><div class="ta-label">Monthly leased</div><div class="ta-big">191,240</div><div class="ta-sub">180 of 250 units under lease</div></div>
          <div class="ta-kpi"><div class="ta-label">Occupancy</div><div class="ta-big">72%</div><div class="ta-sub">180 leased &middot; 70 vacant</div></div>
          <div class="ta-kpi"><div class="ta-label">Sitting empty</div><div class="ta-big">AED 71,320</div><div class="ta-sub">asking price not earning</div></div>
          <div class="ta-kpi"><div class="ta-label">Below asking</div><div class="ta-big">AED 15,320</div><div class="ta-sub">7.4% on what is let</div></div>
        </div>
        <div class="ta-chart">${[[55, 30], [55, 38], [80, 46], [82, 54], [84, 62]].map(([a, l], i) => `<div class="ta-pair"><i style="height:${a}%"></i><i class="ta-light" style="height:${l}%"></i><span>${['Jun', 'Jul', 'Aug', 'Sep', 'Oct'][i]}</span></div>`).join('')}</div>`
    },
    automation: {
      title: 'Settings',
      caption: 'Automation rules for reminders like contract expiry, with every WhatsApp send waiting for approval and a log of what went out.',
      html: () => `
        <h4 class="ta-h">Automation Rules</h4><p class="ta-muted">Configure when automatic reminders are sent to clients, and how often.</p>
        <div class="ta-chips ta-chips--green"><span>Automatic sending: ON</span><span>Automated WhatsApp: ON</span><span>WhatsApp: needs your approval</span></div>
        <div class="ta-card"><div class="ta-row"><b>Contract Expiry</b><span class="ta-muted ta-small">Triggered before a contract end date</span><span class="ta-toggle ta-toggle--blue"></span></div>
          ${[15, 7, 3, 1].map((d, i) => `<div class="ta-step"><span class="ta-stepn">${i + 1}</span><i>${d}</i> days <i>before</i> expiry date<span class="ta-link">Contract Expiring Reminder</span></div>`).join('')}
          <div class="ta-link">+ Add step</div></div>
        <b class="ta-small">Recent activity</b>
        <table class="ta-table"><thead><tr><th>Client</th><th>Unit</th><th>Channel</th><th>Sent</th><th>Status</th></tr></thead><tbody>
          ${[['Client A', 'F2-28'], ['Client B', 'F2-13'], ['Client C', 'F2-81']].map(([n, u]) => `<tr><td>${n}</td><td>${u}</td><td>WhatsApp</td><td>Oct 14, 2026</td><td>${badge('sent', 'g')}</td></tr>`).join('')}
        </tbody></table>`
    }
  };

  const order = Object.keys(SCREENS);
  const tabs = $('#tourTabs');
  tabs.innerHTML = order.map(k => `<button type="button" role="tab" class="tour__tab" data-k="${k}" aria-selected="false">${SCREENS[k].title === 'Settings' ? 'Automation' : SCREENS[k].title}</button>`).join('');

  let current = null, timer = null;
  function show(k) {
    current = k;
    const s = SCREENS[k];
    $('#tourTitle').textContent = s.title;
    $('#tourUrl').textContent = 'app.2capacity.com/' + k;
    $('#tourPage').innerHTML = s.html();
    $('#tourCaption').textContent = s.caption;
    tabs.querySelectorAll('.tour__tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.k === k)));
    root.querySelectorAll('.ta-nav i').forEach((n, i) => n.classList.toggle('is-on', i === order.indexOf(k) % 8));
  }
  function stopAuto() { clearInterval(timer); timer = null; }
  tabs.addEventListener('click', e => {
    const b = e.target.closest('.tour__tab');
    if (!b) return;
    stopAuto();
    show(b.dataset.k);
  });
  show('dashboard');

  // Auto-advance while the tour is on screen, until the visitor picks a tab
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    let started = false;
    new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !started) {
        started = true;
        timer = setInterval(() => show(order[(order.indexOf(current) + 1) % order.length]), 6000);
      }
    }, { threshold: 0.4 }).observe(root);
  }
})();
