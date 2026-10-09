import { Contract, Customer } from '../models/index.js';
import { normalizePhone } from './customerOtp.js';

// What a customer can see in the app (customerStorage.js lists the same).
export const VISIBLE_CONTRACT_STATUSES = ['active', 'pending_signature', 'ended'];

const fail = (status, message) => Object.assign(new Error(message), { status });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reads "a mobile number or an email" as typed by a customer. Throws 400 when
 * it is neither. `key` is a stable spelling to scope OTP codes by.
 */
export function parseContact(input) {
  const raw = String(input || '').trim();
  if (raw.includes('@')) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) throw fail(400, 'Enter a valid email address');
    return { kind: 'email', value: raw, key: `email:${raw.toLowerCase()}` };
  }
  const digits = normalizePhone(raw);
  if (digits.length < 9) throw fail(400, 'Enter a valid mobile number or email');
  return { kind: 'phone', value: raw, digits, key: `phone:${digits}` };
}

/**
 * Every customer record on this phone or email. Old duplicates and app
 * prospects can share one, so the records renting something come first —
 * those are the ones whose units, contracts and invoices the person expects.
 */
export async function findCustomersByContact(contact) {
  const found = contact.kind === 'email'
    ? await Customer.find({ email: new RegExp(`^${escapeRegex(contact.value)}$`, 'i') }).limit(20)
    : await findByPhone(contact.value);
  if (found.length < 2) return { customers: found, renting: await rentingIds(found) };
  const renting = await rentingIds(found);
  // Renting first; then a record staff made over one the app made on login
  // (its "name" is just the number); then the oldest.
  const rank = (c) => [
    renting.has(String(c._id)) ? 0 : 1,
    c.stage === 'prospect' && /^[+\d\s()-]*$/.test(c.fullName || '') ? 1 : 0,
    new Date(c.createdAt || 0).getTime(),
  ];
  found.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  return { customers: found, renting };
}

// Same number, however it was typed: "+971 50 123 4567", "050-123-4567",
// "00971501234567", "50 123 4567". Staff enter numbers by hand, so stored
// spellings carry spaces and dashes an exact match never finds.
const sameNumber = (stored, digits) => {
  const d = normalizePhone(stored);
  return d === digits || (d.length === 9 && `971${d}` === digits);
};

async function findByPhone(input) {
  const digits = normalizePhone(input);
  // The last 9 digits, any separators between them, narrow it down in the
  // database; sameNumber then insists on the whole number, country included.
  const tail = digits.slice(-9).split('').join('\\D*');
  const re = new RegExp(`${tail}\\D*$`);
  const candidates = await Customer.find({ $or: [{ phone: re }, { phones: re }] }).limit(50);
  return candidates
    .filter((c) => [c.phone, ...(c.phones || [])].some((p) => p && sameNumber(p, digits)))
    .slice(0, 20);
}

async function rentingIds(customers) {
  if (!customers.length) return new Set();
  const ids = await Contract.distinct('customer', { customer: { $in: customers.map((c) => c._id) }, status: { $in: VISIBLE_CONTRACT_STATUSES } });
  return new Set(ids.map(String));
}

export const maskPhone = (phone) => `••• ${normalizePhone(phone).slice(-3)}`;
export function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(name.length - 2, 6)))}@${domain}`;
}
