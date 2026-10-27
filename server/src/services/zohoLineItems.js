/**
 * CRM invoice lines as Zoho Books line items, so each lands on the right
 * revenue account. Storage rent is named as the Zoho item for its size —
 * "50 SQFT STORAGE" and so on, all under "Sales - Storage Rental Revenue",
 * as accounts set them up. A size with no item of its own still goes to that
 * account. Every other line is sent as before, by name, until its mapping is
 * agreed.
 *
 * Pure: give it the lines, each unit's size, and Zoho's item list.
 */

const STORAGE_LINE = /^(storage rent|advance rent|storage unit)\b/i;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The unit number in "… · Unit F1-12" or "… · F1-12", if any. */
export function unitNumberOf(text) {
   const m = /·\s*(?:unit\s+)?([A-Z0-9][\w-]*)\s*$/i.exec(String(text || '')) || /\bunit\s+([A-Z0-9][\w-]*)/i.exec(String(text || ''));
   return m ? m[1] : null;
}

/** Zoho's storage item for each size, and the storage revenue account. */
export function storageCatalogue(zohoItems = []) {
   const bySize = new Map();
   let accountId = null;
   for (const it of zohoItems) {
      const m = /^(\d+)\s*sqft\s*storage$/.exec(norm(it.name));
      if (!m || it.status === 'inactive') continue;
      if (!bySize.has(Number(m[1]))) bySize.set(Number(m[1]), it);
      if (!accountId && /storage rental revenue/i.test(it.account_name || '')) accountId = it.account_id;
   }
   return { bySize, accountId };
}

export function toZohoLines(items = [], { unitSizes = new Map(), catalogue = { bySize: new Map(), accountId: null } } = {}) {
   return items.map((item) => {
      const line = {
         name: item.itemDetails || 'Service',
         description: item.description || item.itemDetails || '',
         quantity: item.quantity || 1,
         rate: item.rate || item.amount || 0,
         discount: item.discountPct ? `${item.discountPct}%` : undefined,
      };
      if (!STORAGE_LINE.test(item.itemDetails || '')) return line;
      const sizeInText = /(\d+)\s*sq\s*\.?\s*ft/i.exec(`${item.itemDetails} ${item.description || ''}`);
      const size = sizeInText ? Number(sizeInText[1]) : unitSizes.get(unitNumberOf(item.itemDetails));
      const zohoItem = size ? catalogue.bySize.get(Number(size)) : null;
      // The CRM's own words (dates, unit) ride along as the description.
      const description = [item.itemDetails, item.description].filter(Boolean).join(' — ');
      /* Named as Zoho's item and booked to its account, but not linked to the
         item itself: an item can carry its own VAT in Zoho, and VAT is already
         a line of its own on CRM invoices — linking would charge it twice. */
      if (zohoItem) return { ...line, name: zohoItem.name.replace(/\s+/g, ' ').trim(), account_id: zohoItem.account_id || catalogue.accountId, description };
      if (catalogue.accountId) return { ...line, account_id: catalogue.accountId, description };
      return line;
   }).map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)));
}
