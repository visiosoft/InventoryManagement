/**
 * Duplicate pending payment rows and aging (WP-02).
 *
 * A duplicate is two or more unpaid rows for the same contract, amount and
 * due date (Dubai day). Finding them changes nothing: finance reviews each
 * group, and only on approval are the extra rows marked duplicate_voided —
 * kept, never deleted, with the row kept and the approver recorded.
 */

const DUBAI_MS = 4 * 3_600_000;
export const dubaiDay = (d) => new Date(new Date(d).getTime() + DUBAI_MS).toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;

/** Stable key for a group: contract | amount | Dubai due day. Pure. */
export const groupKey = (row) => `${String(row.contract?._id || row.contract)}|${r2(Number(row.amount) || 0)}|${dubaiDay(row.dueDate)}`;

/**
 * Unpaid rows grouped into duplicates. The oldest row (by createdAt, then id)
 * is the one kept. Pure.
 */
export function duplicateGroups(rows) {
   const m = new Map();
   for (const r of rows) {
      if (!['pending', 'overdue'].includes(r.status)) continue;
      const k = groupKey(r);
      (m.get(k) || m.set(k, []).get(k)).push(r);
   }
   const out = [];
   for (const [key, list] of m) {
      if (list.length < 2) continue;
      list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a._id).localeCompare(String(b._id)));
      const [keep, ...extra] = list;
      out.push({ key, contract: String(keep.contract?._id || keep.contract), amount: r2(Number(keep.amount) || 0), dueDay: dubaiDay(keep.dueDate), rows: list.length, keepId: String(keep._id), extraIds: extra.map((x) => String(x._id)), extraTotal: r2(extra.reduce((s, x) => s + (Number(x.amount) || 0), 0)) });
   }
   return out.sort((a, b) => b.extraTotal - a.extraTotal);
}

export const AGING_BUCKETS = ['upcoming', 'current', '1-30', '31-60', '61-90', '91-120', 'over 120'];

/** Aging bucket from the due date, by Dubai calendar day. Pure. */
export function agingBucket(dueDate, now = new Date()) {
   const days = Math.round((Date.parse(dubaiDay(now)) - Date.parse(dubaiDay(dueDate))) / 86_400_000);
   if (days < 0) return 'upcoming';
   if (days === 0) return 'current';
   if (days <= 30) return '1-30';
   if (days <= 60) return '31-60';
   if (days <= 90) return '61-90';
   if (days <= 120) return '91-120';
   return 'over 120';
}

/** Unpaid totals by bucket, with duplicate rows counted separately. Pure. */
export function agingSummary(rows, now = new Date()) {
   const dupIds = new Set(duplicateGroups(rows).flatMap((g) => g.extraIds));
   const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b, { rows: 0, total: 0 }]));
   let duplicate = { rows: 0, total: 0 };
   for (const r of rows) {
      if (!['pending', 'overdue'].includes(r.status)) continue;
      const a = Number(r.amount) || 0;
      if (dupIds.has(String(r._id))) { duplicate = { rows: duplicate.rows + 1, total: r2(duplicate.total + a) }; continue; }
      const b = buckets[agingBucket(r.dueDate, now)];
      b.rows += 1; b.total = r2(b.total + a);
   }
   const overdue = AGING_BUCKETS.filter((b) => !['upcoming', 'current'].includes(b)).reduce((s, b) => s + buckets[b].total, 0);
   return { buckets, duplicate, overdueExcludingDuplicates: r2(overdue), overdueMaximum: r2(overdue + duplicate.total) };
}
