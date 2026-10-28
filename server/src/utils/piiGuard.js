import { isRestrictedKey, maskLast4 } from './pii.js';

/**
 * Identity numbers in the app (WP-07): every API response from these routes
 * carries Emirates ID and passport numbers as their last four digits only;
 * the full number comes from POST /api/pii/reveal, with a reason, and is
 * logged. Masked values sent back by an edit form never overwrite the real
 * ones: a top-level masked field is dropped from the update, and a masked
 * idNumber on a person keeps the number already stored for that person.
 */

export const isMasked = (v) => typeof v === 'string' && v.startsWith('****');

/** Restricted fields masked by name, at any depth. Text is left alone. Pure. */
export function maskIdKeys(value, depth = 0) {
   if (value == null || depth > 10 || typeof value !== 'object') return value;
   if (value instanceof Date) return value;
   if (Array.isArray(value)) return value.map((v) => maskIdKeys(v, depth + 1));
   if (typeof value.toJSON === 'function' && value.constructor !== Object) {
      if (value.$__ || value._doc) return maskIdKeys(value.toObject ? value.toObject() : value._doc, depth + 1);
      return value;
   }
   const out = {};
   for (const [k, v] of Object.entries(value)) out[k] = isRestrictedKey(k) && typeof v === 'string' && v && !isMasked(v) ? maskLast4(v) : maskIdKeys(v, depth + 1);
   return out;
}

/** The body of an update with masked values replaced by the stored ones. Pure. */
export function restoreMasked(body, existing, personArrays = []) {
   if (!body || typeof body !== 'object') return body;
   const out = { ...body };
   for (const [k, v] of Object.entries(out)) if (isRestrictedKey(k) && isMasked(v)) delete out[k];
   for (const arr of personArrays) {
      if (!Array.isArray(out[arr])) continue;
      const before = Array.isArray(existing?.[arr]) ? existing[arr] : [];
      out[arr] = out[arr].map((p, i) => {
         if (!p || !isMasked(p.idNumber)) return p;
         const same = before.find((b) => b?.name && b.name === p.name && (!p.phone || b.phone === p.phone)) || before[i];
         return { ...p, idNumber: same?.idNumber || '' };
      });
   }
   return out;
}

/** Express middleware for a router whose records hold identity numbers. */
export function piiGuard(Model, personArrays = [], { unmasked = () => false } = {}) {
   return async (req, res, next) => {
      const json = res.json.bind(res);
      if (!unmasked(req)) res.json = (body) => json(maskIdKeys(body));
      const m = /^\/([0-9a-f]{24})\/?$/.exec(req.path);
      if (m && ['PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object') {
         try {
            const existing = await Model.findById(m[1]).select(['emiratesId', 'passportNumber', ...personArrays].join(' ')).lean();
            req.body = restoreMasked(req.body, existing, personArrays);
         } catch { /* the route reports its own errors */ }
      }
      next();
   };
}
