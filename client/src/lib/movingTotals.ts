/**
 * What a moving quote or invoice adds up to — the browser's copy.
 *
 * Word for word the rule in server/src/services/movingTotals.js. The server is
 * what stores the figure; this exists so the page can show the sum while
 * somebody is still typing, before anything is saved.
 *
 * A test in that service's suite reads both files and fails if the arithmetic
 * here stops matching, because a page and a PDF quietly disagreeing about a
 * total is the bug this pair is meant to prevent, not cause.
 */

export const MOVING_VAT_RATE = 5

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

export type MovingTotals = {
  subTotal: number
  discount: number
  discountAmount: number
  net: number
  vatRate: number
  vatAmount: number
  total: number
}

/** See the note in server/src/services/movingTotals.js — three states. */
export function chargesVat({ vatEnabled, status }: { vatEnabled?: boolean; status?: string } = {}) {
  if (vatEnabled === true) return true
  if (vatEnabled === false) return false
  return status === 'draft'
}

export function movingTotals({ items = [], discount = 0, vatEnabled, vatRate, status }: {
  items?: { amount?: number | null }[]
  discount?: number
  vatEnabled?: boolean
  vatRate?: number
  status?: string
} = {}): MovingTotals {
  const subTotal = round2((items || []).reduce((s, i) => s + (Number(i?.amount) || 0), 0))

  const pct = Math.min(100, Math.max(0, Number(discount) || 0))
  const discountAmount = round2((subTotal * pct) / 100)
  const net = round2(subTotal - discountAmount)

  const rate = chargesVat({ vatEnabled, status }) ? Number(vatRate ?? MOVING_VAT_RATE) || 0 : 0
  const vatAmount = round2((Math.max(0, net) * rate) / 100)

  return {
    subTotal,
    discount: pct,
    discountAmount,
    net,
    vatRate: rate,
    vatAmount,
    total: round2(net + vatAmount),
  }
}
