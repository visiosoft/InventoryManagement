/**
 * "Complete your profile": what we know about a customer, and what is still worth asking for.
 * Pure on purpose (no database), so the rules are easy to read and to test.
 *
 * What the office already holds counts. A tenant who signed with us in person has had their mobile, email and ID
 * checked by staff, so the app shows those steps as done instead of asking again; only what is genuinely missing
 * is left to do.
 *
 * Nothing here is mandatory except the name: the checklist nudges, it never blocks.
 */

const filled = (v) => String(v ?? '').trim().length > 0;

/**
 * @param customer  the Customer document (or plain object)
 * @param ctx       { idComplete, idOnFile, accessCount, hasContract, isTenant }
 *   idComplete  a full ID uploaded in the app (both sides of an Emirates ID, or the passport page)
 *   idOnFile    staff filed an ID document for them or their contracts
 *   isTenant    they have, or had, a contract with us — so the office has met them and checked their details
 */
export function profileChecklist(customer, ctx = {}) {
  const c = customer || {};
  const tenant = !!ctx.isTenant;
  // An email typed into the app proves nothing until its code is entered; one staff entered is on the contract.
  const emailDone = filled(c.email) && (!!c.emailVerifiedAt || !c.emailFromApp);
  const idDone = !!ctx.idComplete || !!ctx.idOnFile || filled(c.emiratesId) || filled(c.passportNumber);
  const accessCount = (ctx.accessCount || 0) + (Array.isArray(c.accessPersons) ? c.accessPersons.length : 0);
  const items = [
    { key: 'phone', title: 'Verify your mobile number', hint: 'Done when you log in with a code.', done: !!c.phoneVerifiedAt || (tenant && filled(c.phone)), route: 'phone' },
    { key: 'whatsapp', title: 'Choose your WhatsApp number', hint: 'Where we send invoices and updates.', done: !!c.whatsappOptIn?.at || tenant, route: 'whatsapp' },
    { key: 'email', title: 'Add and verify your email', hint: 'For receipts, and to bring in your invoices.', done: emailDone, route: 'email' },
    { key: 'identity', title: 'Upload your Emirates ID or passport', hint: 'Needed for your storage contract.', done: idDone, route: 'identity' },
  ];
  if (ctx.hasContract) {
    items.push({ key: 'access', title: 'Add people who can access your unit', hint: 'Family, staff or a driver.', done: accessCount > 0, route: 'access' });
  }
  items.push(
    { key: 'emergency', title: 'Add an emergency contact', hint: 'Someone we can call if we cannot reach you.', done: filled(c.emergencyNumber), route: 'details' },
    { key: 'details', title: 'Add your nationality and address', hint: 'Appears on your contract.', done: filled(c.nationality) && filled(c.address), route: 'details' },
  );
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, percent: Math.round((done / items.length) * 100) };
}

/**
 * The number WhatsApp messages should go to. Customers can say "use another number"; that number only counts once it
 * has been proven with a code, and the opt-in is recorded alongside it (Meta needs a recorded opt-in).
 */
export function whatsappNumberFor(customer) {
  const c = customer || {};
  if (c.whatsappSameAsPhone === false && filled(c.whatsappPhone)) return c.whatsappPhone;
  return c.phone || (Array.isArray(c.phones) ? c.phones[0] : '') || '';
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const validEmail = (e) => EMAIL.test(String(e || '').trim());
