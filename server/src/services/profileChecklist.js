/**
 * "Complete your profile": what we know about a customer from the app, and what is still worth asking for.
 * Pure on purpose (no database), so the rules are easy to read and to test.
 *
 * Nothing here is mandatory except the name: the checklist nudges, it never blocks.
 */

const filled = (v) => String(v ?? '').trim().length > 0;

/**
 * @param customer  the Customer document (or plain object)
 * @param ctx       { idComplete: boolean, accessCount: number, hasContract: boolean }
 */
export function profileChecklist(customer, ctx = {}) {
  const c = customer || {};
  const items = [
    { key: 'phone', title: 'Verify your mobile number', hint: 'Done when you log in with a code.', done: !!c.phoneVerifiedAt, route: 'phone' },
    { key: 'whatsapp', title: 'Choose your WhatsApp number', hint: 'Where we send invoices and updates.', done: !!c.whatsappOptIn?.at, route: 'whatsapp' },
    { key: 'email', title: 'Add and verify your email', hint: 'For receipts, and to bring in your invoices.', done: filled(c.email) && !!c.emailVerifiedAt, route: 'email' },
    { key: 'identity', title: 'Upload your Emirates ID or passport', hint: 'Needed for your storage contract.', done: !!ctx.idComplete, route: 'identity' },
  ];
  if (ctx.hasContract) {
    items.push({ key: 'access', title: 'Add people who can access your unit', hint: 'Family, staff or a driver.', done: (ctx.accessCount || 0) > 0, route: 'access' });
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
