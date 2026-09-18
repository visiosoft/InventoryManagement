// Sample data generation, ported from the design reference's buildUnits()/leads logic.
// All figures are illustrative.
const BayshireData = (function () {
  function buildUnits() {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const W = 42, D = 23;
    const rows = [
      { z: 1, d: 2.3, w: [1.2, 1.6, 2.0, 2.4], h: 2.4, f: 1 },
      { z: 5, d: 3.7, w: [2.5, 3.8], h: 2.8, f: 1 },
      { z: 10.5, d: 3.7, w: [2.5, 3.8], h: 2.8, f: 2 },
      { z: 16, d: 5, w: [3.7, 5.6], h: 3.2, f: 2 }
    ];
    const out = [];
    const counters = { 1: 0, 2: 0 };
    rows.forEach(r => {
      let x = 1;
      while (true) {
        const w = r.w[Math.floor(rnd() * r.w.length)];
        if (x + w > W - 1) break;
        const s = rnd();
        const status = s < 0.62 ? 'Occupied' : s < 0.82 ? 'Available' : s < 0.92 ? 'Reserved' : 'Maintenance';
        const sqft = Math.round(w * r.d * 10.764 / 5) * 5;
        counters[r.f]++;
        out.push({
          x, z: r.z, w, d: r.d, h: r.h, floor: r.f,
          code: 'F' + r.f + '-' + String(counters[r.f]).padStart(3, '0'),
          status, sqft, dims: w + ' m x ' + r.d + ' m', price: sqft * 19, W, D
        });
        x += w + 0.2;
      }
    });
    const fifty = out.find(u => u.floor === 2 && u.sqft === 50) || out.find(u => u.sqft === 50) || out[5];
    fifty.code = 'F2-034';
    fifty.status = 'Available';
    return out;
  }

  function fmt(n) {
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function statusColor(s) {
    if (s === 'Available') return 'var(--accent)';
    if (s === 'Overdue' || s === 'Maintenance') return 'var(--oxide)';
    if (s === 'Reserved') return 'var(--steel)';
    return 'var(--ink)';
  }

  function suggestFor(u) {
    const occTable = { 30: 94, 40: 90, 50: 88, 60: 84, 100: 86, 150: 82, 200: 79, 300: 71 };
    const occ = occTable[u.sqft] ?? 85;
    const pct = occ >= 88 ? 0.04 : occ < 75 ? -0.03 : 0;
    const sug = Math.round(u.price * (1 + pct) / 5) * 5;
    const why = pct > 0
      ? u.sqft + ' sq ft is ' + occ + '% occupied. 12-month high.'
      : pct < 0
        ? u.sqft + ' sq ft is ' + occ + '% occupied. 4 units vacant over 30 days.'
        : 'Hold. ' + u.sqft + ' sq ft occupancy is on target at ' + occ + '%.';
    return { sug, why, pct, occ };
  }

  const leads = [
    { id: 1, col: 'New', n: 'Hana Al Rashid', sq: 50, code: 'F1-006', src: 'WhatsApp', t: '12m' },
    { id: 2, col: 'New', n: 'Cedar & Co Interiors', sq: 150, code: 'F1-031', src: 'Web form', t: '1h' },
    { id: 3, col: 'Contacted', n: 'Yusuf Karim', sq: 100, code: 'F1-027', src: 'Walk-in', t: '3h' },
    { id: 4, col: 'Qualified', n: 'Meridian Events LLC', sq: 300, code: 'F2-055', src: 'Referral', t: '1d' },
    { id: 5, col: 'Qualified', n: 'Priya Nair', sq: 40, code: 'F1-011', src: 'WhatsApp', t: '1d' },
    { id: 6, col: 'Quoted', n: 'Layla Haddad', sq: 50, code: 'F2-034', src: 'Google Contacts', t: '2d' },
    { id: 7, col: 'Won', n: 'Dune Retail FZE', sq: 200, code: 'F2-051', src: 'Web form', t: '4d' }
  ];

  function defaultInbound(lead) {
    return 'Hi, I need a unit of about ' + lead.sq + ' sq ft for boxes and a few pieces of furniture. What does it cost and is anything available this week?';
  }

  function templateReply(lead, unit, avail) {
    return 'Hi ' + lead.n.split(' ')[0] + ', thanks for reaching out. We have ' + avail + ' units of ' + lead.sq +
      ' sq ft available now, including ' + lead.code + ' (' + unit.dims + '). The rate is AED ' + fmt(lead.sq * 19) +
      ' per 4 weeks on a rolling contract, which works out to AED ' + fmt(lead.sq * 19 / 4) + ' a week. ' +
      'Would you like to book a viewing this week? I can hold the unit for you until then.';
  }

  const revenue = [62, 58, 66, 71, 69, 74, 78, 76, 83, 88, 91, 100].map((h, i) => ({
    h, l: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'][i], accent: i === 11
  }));

  const occBySize = [['30', 94], ['40', 90], ['50', 88], ['60', 84], ['100', 86], ['150', 82], ['200', 79], ['300', 71]]
    .map(a => ({ s: a[0] + ' sq ft', p: a[1] }));
  const occBySizeShort = [['50', 88], ['100', 86], ['200', 79], ['300', 71]].map(a => ({ s: a[0] + ' sq ft', p: a[1] }));

  const activity = [
    { t: 'Alert', x: 'Occupancy for 300 sq ft fell to 71%, 8 points below the 12-month average' },
    { t: '09:42', x: 'Payment received. INV-2041. AED 3,800' },
    { t: '09:15', x: 'Contract CT-0197 activated. F2-034' },
    { t: '08:50', x: 'Lead assigned. Hana Al Rashid to Omar' },
    { t: 'Yesterday', x: 'Quote Q-0336 sent. PDF generated' },
    { t: 'Yesterday', x: 'Unit F1-012 set to maintenance' }
  ];

  const expiries = [
    { c: 'CT-0142', n: 'Meridian Events LLC', d: '24 Sep', days: 7 },
    { c: 'CT-0151', n: 'Layla Haddad', d: '29 Sep', days: 12 },
    { c: 'CT-0163', n: 'Dune Retail FZE', d: '03 Oct', days: 16 },
    { c: 'CT-0170', n: 'Faisal Mansoor', d: '11 Oct', days: 24 }
  ];

  const payments = [
    { i: 'INV-2036', a: 'AED 1,900.00', s: 'Overdue' },
    { i: 'INV-2038', a: 'AED 4,750.00', s: 'Paid' },
    { i: 'INV-2040', a: 'AED 950.00', s: 'Due' },
    { i: 'INV-2041', a: 'AED 3,800.00', s: 'Paid' },
    { i: 'INV-2043', a: 'AED 2,850.00', s: 'Overdue' }
  ].map(p => ({ ...p, color: p.s === 'Overdue' ? 'var(--oxide)' : p.s === 'Paid' ? 'var(--accent)' : 'var(--ink2)' }));

  const csvRows = [
    { v: 'Gulf Power Supplies', c: 'Utilities', a: 'AED 1,240.00', m: 'Matched. VEN-014', color: 'var(--accent)' },
    { v: 'Al Noor Cleaning Co', c: 'Facility', a: 'AED 860.00', m: 'Matched. VEN-007', color: 'var(--accent)' },
    { v: 'Desert Lock & Key', c: 'Maintenance', a: 'AED 315.00', m: 'New vendor. VEN-031', color: 'var(--oxide)' }
  ];

  const docs = [
    { n: 'Google Drive', s: 'synced archive', c: '1,284 files' },
    { n: 'Local storage', s: 'facility server', c: '312 files' },
    { n: 'Signed contracts', s: 'PDF', c: '209' },
    { n: 'Invoices', s: 'PDF', c: '2,041' },
    { n: 'Supporting documents', s: 'IDs, receipts, photos', c: '766' }
  ];

  const payStatus = [
    { n: 'Paid', v: '186', color: 'var(--accent)' },
    { n: 'Due', v: '14', color: 'var(--ink)' },
    { n: 'Overdue', v: '7', color: 'var(--oxide)' }
  ];

  const modules = [
    ['Dashboard', 'Operational overview and key metrics.'],
    ['Units', 'Inventory, availability, pricing and dimensions.'],
    ['Customers', 'Customer records and activity history.'],
    ['Leads', 'Inquiry capture, assignment and pipeline management.'],
    ['Quotes', 'Pricing, discounts and PDF quotations.'],
    ['Invoices', 'Customer billing and invoice tracking.'],
    ['Vendors', 'Supplier and service-provider records.'],
    ['Purchases', 'Track purchasing activity.'],
    ['Expenses', 'Operating costs, categorization and attachments.'],
    ['Contracts', 'Digital contract creation and lifecycle management.'],
    ['Moving System', 'Schedule move-ins and move-outs and track unit turnover.'],
    ['Payments', 'Schedules, payment history and overdue balances.'],
    ['Documents', 'Central operational document storage.'],
    ['Reports', 'Revenue, occupancy and availability analysis.'],
    ['Settings', 'Pricing, alerts, permissions and business rules.'],
    ['Integrations', 'Connect Bayshire OS with external services.']
  ].map((a, i) => ({ n: a[0], d: a[1], color: ['var(--g1)', 'var(--g2)', 'var(--g3)'][i % 3] }));

  const team = [
    { n: 'Mase R', r: 'Co-founder & CEO', bio: 'Ran a three-site self-storage group in Dubai for six years before starting Bayshire.', color: 'var(--g1)' },
    { n: 'Zulfiqar Ali', r: 'Co-founder & CTO', bio: 'Built the pricing and payments engine that the platform still runs on today.', color: 'var(--g2)' },
    { n: 'Noor Haddad', r: 'Head of Product', bio: 'Shapes the roadmap directly from operator calls, not a backlog.', color: 'var(--g3)' },
    { n: 'Omar Suleiman', r: 'Customer Success Lead', bio: 'Personally onboards every new facility for its first 90 days.', color: 'var(--g1)' }
  ];

  const integrations = [
    { mark: 'WA', n: 'WhatsApp Business', d: 'Meta webhook integration for customer communication and lead activity.' },
    { mark: 'GC', n: 'Google Contacts', d: 'Synchronize contacts and automatically create or update leads based on phone numbers.' },
    { mark: 'GD', n: 'Google Drive', d: 'Store and archive contracts and operational documents.' },
    { mark: 'ES', n: 'E-Signature', d: 'Send contracts for e-signature and automatically file the countersigned copy against the record.' }
  ];

  const alerts = [
    { t: 'Today', x: '300 sq ft occupancy at 71%, 8 points below the 12-month average. 4 units vacant over 30 days.' },
    { t: 'Sep 12', x: 'Overdue balance rose to AED 4,750 across 7 payments. 2 contracts have missed two consecutive dates.' },
    { t: 'Sep 03', x: 'August revenue AED 268,900, in line with the trailing average after two months of growth.' }
  ];

  return {
    buildUnits, fmt, statusColor, suggestFor, leads, defaultInbound, templateReply,
    revenue, occBySize, occBySizeShort, activity, expiries, payments, csvRows, docs,
    payStatus, modules, integrations, alerts, team
  };
})();
