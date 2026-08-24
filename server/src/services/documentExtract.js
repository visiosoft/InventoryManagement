/**
 * Turn a model's reading of an ID document into fields we are willing to store.
 *
 * The model is allowed to be wrong. This module is where that stops mattering:
 * every value is checked against the shape it must have, and anything that
 * fails comes back as *absent and explained* rather than as a guess. A wrong
 * Emirates ID number written into a customer record is worse than an empty one,
 * because nobody goes back to check a field that looks filled in.
 *
 * Pure on purpose — no database, no network, no API key — so the rules that
 * decide what reaches a customer record can be tested directly. Same reasoning
 * as `decideAction` in aiBot.js and `pickChannels` in automationEngine.js.
 */

/** Fields we will accept from a document, mapped to the Customer field. */
export const ID_FIELDS = ['fullName', 'emiratesId', 'eidExpiry', 'passportNumber', 'passportExpiry', 'nationality'];

const EID_SHAPE = /^784-\d{4}-\d{7}-\d$/;
const PASSPORT_SHAPE = /^[A-Z0-9]{5,15}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An expiry we would believe. Anything outside this is a misread — most often
 * a two-digit year or a date of birth picked up from the wrong line.
 */
const EARLIEST_YEAR = 1990;
const LATEST_YEARS_AHEAD = 30;

function cleanString(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Emirates ID: 15 digits, always starting 784. Accepts the number however it
 * was printed — spaced, hyphenated or run together — and returns the canonical
 * form, since a record holding the same number three different ways cannot be
 * searched.
 */
function normaliseEmiratesId(raw) {
  const digits = cleanString(raw).replace(/\D/g, '');
  if (digits.length !== 15 || !digits.startsWith('784')) return null;
  const formatted = `784-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
  return EID_SHAPE.test(formatted) ? formatted : null;
}

function normalisePassport(raw) {
  const v = cleanString(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return PASSPORT_SHAPE.test(v) ? v : null;
}

/**
 * A date we would believe, as YYYY-MM-DD.
 *
 * Rejects dates that do not exist — 2026-02-31 parses in JavaScript by rolling
 * into March, so the round trip below is what catches it — and dates outside a
 * plausible range for a document expiry.
 */
function normaliseDate(raw, now = new Date()) {
  const v = cleanString(raw);
  if (!ISO_DATE.test(v)) return null;

  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Rolled-over dates come back as a different day than the one asked for.
  if (d.toISOString().slice(0, 10) !== v) return null;

  const year = d.getUTCFullYear();
  if (year < EARLIEST_YEAR) return null;
  if (year > now.getUTCFullYear() + LATEST_YEARS_AHEAD) return null;
  return v;
}

function normaliseName(raw) {
  const v = cleanString(raw);
  // Long enough to be a name, short enough not to be a line of the document.
  if (v.length < 2 || v.length > 120) return null;
  // Must contain a letter; an OCR run of punctuation is not a name.
  return /\p{L}/u.test(v) ? v : null;
}

function normaliseNationality(raw) {
  const v = cleanString(raw);
  if (v.length < 2 || v.length > 60) return null;
  return /\p{L}/u.test(v) ? v : null;
}

const RULES = {
  fullName: { normalise: normaliseName, reason: 'not a readable name' },
  emiratesId: { normalise: normaliseEmiratesId, reason: 'not a 15-digit Emirates ID starting 784' },
  eidExpiry: { normalise: normaliseDate, reason: 'not a plausible date' },
  passportNumber: { normalise: normalisePassport, reason: 'not a plausible passport number' },
  passportExpiry: { normalise: normaliseDate, reason: 'not a plausible date' },
  nationality: { normalise: normaliseNationality, reason: 'not a readable nationality' },
};

/**
 * @param {object|null} raw  Parsed model output, or null when it produced
 *                           nothing usable. Null is a failure to read, never an
 *                           empty document.
 * @returns {{ ok: boolean, fields: object, rejected: Array<{field:string,value:string,reason:string}> }}
 */
export function parseIdFields(raw, { now = new Date() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, fields: {}, rejected: [] };
  }

  const fields = {};
  const rejected = [];

  for (const field of ID_FIELDS) {
    const value = raw[field];
    // Absent is normal: a passport has no Emirates ID on it.
    if (value === undefined || value === null || cleanString(value) === '') continue;

    const rule = RULES[field];
    const cleaned = rule.normalise(value, now);
    if (cleaned === null) {
      rejected.push({ field, value: cleanString(value).slice(0, 60), reason: rule.reason });
      continue;
    }
    fields[field] = cleaned;
  }

  return { ok: Object.keys(fields).length > 0, fields, rejected };
}

/**
 * What changes if every proposed field were accepted, next to what is stored
 * now. The client shows both so nobody overwrites a checked value with a
 * guess without seeing what they are replacing.
 */
export function diffAgainstCustomer(fields, customer = {}) {
  const asStored = (field, v) => {
    if (v == null || v === '') return '';
    return field.endsWith('Expiry') ? new Date(v).toISOString().slice(0, 10) : String(v);
  };

  return Object.entries(fields).map(([field, proposed]) => {
    const current = asStored(field, customer[field]);
    return { field, proposed, current, changed: current !== proposed, isNew: current === '' };
  });
}
