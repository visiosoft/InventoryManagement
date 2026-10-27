/**
 * The CRM's customers beside Zoho Books' contacts: who matches, who does not
 * and why. Invoices come into the CRM only through a match — same email, or
 * same phone (last 9 digits) — never by name, so every row here that is not
 * "matched" is a customer whose Zoho invoices the CRM cannot see.
 *
 * Pure: give it both lists. The route fetches them.
 */

const normEmail = (v) => String(v || '').trim().toLowerCase();
const phoneKey = (v) => {
   const digits = String(v || '').replace(/\D/g, '');
   return digits.length >= 9 ? digits.slice(-9) : '';
};
const normName = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

export const COMPARE_STATUS = {
   matched: 'Matched',
   conflict: 'Email and phone point to different Zoho contacts',
   name_only: 'Same name in Zoho, but email and phone differ',
   crm_only: 'Not in Zoho',
   no_details: 'No email or phone in the CRM',
   zoho_only: 'In Zoho, not in the CRM',
};

export function compareWithZoho(customers = [], contacts = []) {
   const byEmail = new Map();
   const byPhone = new Map();
   const byName = new Map();
   const add = (map, k, c) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(c); };
   for (const c of contacts) {
      add(byEmail, normEmail(c.email), c);
      for (const k of new Set([phoneKey(c.phone), phoneKey(c.mobile)])) add(byPhone, k, c);
      add(byName, normName(c.name), c);
   }

   const claimed = new Set();
   const rows = [];
   for (const cust of customers) {
      const email = normEmail(cust.email);
      const phones = [...new Set([cust.phone, ...(cust.phones || [])].map(phoneKey).filter(Boolean))];
      const crm = { crmId: String(cust._id), crmName: cust.fullName || '', crmEmail: cust.email || '', crmPhone: cust.phone || (cust.phones || [])[0] || '' };
      const eHit = email ? byEmail.get(email)?.[0] : null;
      let pHit = null;
      for (const k of phones) { pHit = byPhone.get(k)?.[0]; if (pHit) break; }
      const zoho = (c, by) => ({ zohoId: c.id, zohoName: c.name || '', zohoEmail: c.email || '', zohoPhone: [c.phone, c.mobile].filter(Boolean).join(' / '), outstanding: Number(c.outstanding || 0), matchedBy: by });

      if (eHit && pHit && String(eHit.id) !== String(pHit.id)) {
         claimed.add(String(eHit.id)); claimed.add(String(pHit.id));
         rows.push({ status: 'conflict', ...crm, ...zoho(eHit, 'email'), note: `Phone matches “${pHit.name}” instead` });
      } else if (eHit || pHit) {
         const hit = eHit || pHit;
         claimed.add(String(hit.id));
         const dupes = eHit ? byEmail.get(email).length : 1;
         rows.push({ status: 'matched', ...crm, ...zoho(hit, eHit && pHit ? 'email and phone' : eHit ? 'email' : 'phone'), note: dupes > 1 ? `${dupes} Zoho contacts share this email — the first is used` : '' });
      } else {
         const named = byName.get(normName(cust.fullName))?.[0];
         if (named) {
            claimed.add(String(named.id));
            rows.push({ status: 'name_only', ...crm, ...zoho(named, 'name'), note: 'Update the email or phone on one side so they match' });
         } else if (!email && !phones.length) {
            rows.push({ status: 'no_details', ...crm, note: 'Add an email or phone to this customer' });
         } else {
            rows.push({ status: 'crm_only', ...crm, note: 'No Zoho contact has this email or phone' });
         }
      }
   }
   for (const c of contacts) {
      if (claimed.has(String(c.id))) continue;
      rows.push({ status: 'zoho_only', crmId: '', crmName: '', crmEmail: '', crmPhone: '', zohoId: c.id, zohoName: c.name || '', zohoEmail: c.email || '', zohoPhone: [c.phone, c.mobile].filter(Boolean).join(' / '), outstanding: Number(c.outstanding || 0), matchedBy: '', note: Number(c.outstanding || 0) > 0 ? 'Owes money in Zoho — the CRM cannot see it' : '' });
   }

   const counts = Object.fromEntries(Object.keys(COMPARE_STATUS).map((k) => [k, rows.filter((r) => r.status === k).length]));
   return { counts, rows };
}
