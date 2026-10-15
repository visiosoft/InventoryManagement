/** What counts as "ID on file", and which uploaded file is current. Pure (no database). */

export const ID_TYPES = ['emirates_id', 'passport'];
export const ID_SIDES = { emirates_id: ['front', 'back'], passport: ['page'] };
export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

export const slotOf = (doc) => `${doc.type}:${doc.side || (doc.type === 'passport' ? 'page' : 'front')}`;

/** The newest document in each slot (re-uploading replaces what the app shows). */
export function latestPerSlot(docs) {
  const best = new Map();
  for (const d of docs || []) {
    if (!ID_TYPES.includes(d.type)) continue;
    const k = slotOf(d);
    const cur = best.get(k);
    if (!cur || new Date(d.createdAt) > new Date(cur.createdAt)) best.set(k, d);
  }
  return [...best.values()];
}

/** Both sides of an Emirates ID, or the passport page. */
export function idComplete(docs) {
  const have = new Set(latestPerSlot(docs).map(slotOf));
  return ID_SIDES.emirates_id.every((s) => have.has(`emirates_id:${s}`)) || ID_SIDES.passport.every((s) => have.has(`passport:${s}`));
}

export const docName = (type, side) =>
  type === 'passport' ? 'Passport' : `Emirates ID (${side === 'back' ? 'back' : 'front'})`;

export function extensionFor(mimeType) {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' }[mimeType] || 'bin';
}
