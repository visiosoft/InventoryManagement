/**
 * Phone numbers are stored in whatever shape they arrived in — "+971 52 130 2290",
 * "0521302290", "+971521302290" all appear in the data. A plain substring match
 * therefore fails: typing "0521302290" finds nothing when the record reads
 * "+971 52 130 2290".
 *
 * Builds a regex from the digits alone, allowing any separator between them, so
 * every stored format matches. Country code and trunk prefix are trimmed off
 * both sides so a local number finds an international one and vice versa.
 *
 * Returns null when the query isn't phone-like, so callers can skip it.
 */
export function phoneRegex(query) {
  const raw = String(query || '');
  // Letters mean it's a contract number or a name, not a phone — "PB-2026-0206"
  // would otherwise be reduced to digits and matched against numbers.
  if (/[a-z]/i.test(raw)) return null;

  const digits = raw.replace(/\D/g, '');
  if (digits.length < 5) return null;

  // Strip the UAE country code / trunk prefix so the local part is what matches
  const core = digits
    .replace(/^00971/, '')
    .replace(/^971/, '')
    .replace(/^0/, '');
  if (core.length < 5) return null;

  return new RegExp(core.split('').join('\\D*'));
}

/** Mongo $or clauses matching a phone-like query across a customer's number fields. */
export function phoneClauses(query) {
  const re = phoneRegex(query);
  if (!re) return [];
  return [{ phone: re }, { phones: re }, { emergencyNumber: re }];
}
