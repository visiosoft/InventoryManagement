/**
 * What VAT is charged on, mirrored from the server.
 *
 * The authority is `server/src/services/quoteVat.js`, which decides the figure
 * that is stored on the quote and printed on the quotation. This exists only so
 * the totals move as somebody edits, before anything is saved — a quote builder
 * that cannot show a total until you save is not usable.
 *
 * The two must agree. They did not once already: the PDF stopped taxing a
 * refundable add-on and this page carried on, so the screen said 25.00 and the
 * customer's copy said 12.50. If you change one, change both, and keep the
 * wording of the rule identical so the difference is easy to see.
 *
 * The rule: 5% on what is sold. Nothing on money held and given back — the
 * security deposit, the refundable advance, or a refundable amount entered as
 * an add-on or a line item, which is how it actually gets typed.
 */

const REFUNDABLE = /\brefundable\b|\bdeposit\b|\bsecurity\s+deposit\b|\badvance\b/i
const NOT_REFUNDABLE = /\bdeposit\s*box\b|\bsafe\s*deposit\b/i

/** Is this line a sum held and returned, rather than something sold? */
export function isRefundableRow(name: string | undefined | null): boolean {
  const text = String(name ?? '')
  if (!text.trim()) return false
  if (NOT_REFUNDABLE.test(text)) return false
  return REFUNDABLE.test(text)
}

/** The amount VAT is charged on. */
export function vatBase({
  unitsTotal = 0,
  addOns = [],
  items = [],
  adjustment = 0,
}: {
  unitsTotal?: number
  addOns?: { name?: string; amount?: number }[]
  items?: { itemDetails?: string; amount?: number }[]
  adjustment?: number
}): number {
  const taxable = <T,>(rows: T[], nameOf: (r: T) => string | undefined, amountOf: (r: T) => number | undefined) =>
    rows.filter((r) => !isRefundableRow(nameOf(r))).reduce((s, r) => s + Number(amountOf(r) || 0), 0)

  const base = Number(unitsTotal || 0)
    + taxable(addOns, (a) => a.name, (a) => a.amount)
    + taxable(items, (i) => i.itemDetails, (i) => i.amount)
    + Number(adjustment || 0)

  // A discount larger than the sale does not earn a VAT credit.
  return Math.max(0, Number(base.toFixed(2)))
}

/** 5% of it, rounded to fils. */
export function vatOn(base: number, rate = 5): number {
  return Number((Math.max(0, Number(base) || 0) * (Number(rate) || 0) / 100).toFixed(2))
}
