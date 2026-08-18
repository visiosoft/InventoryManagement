import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatDate(d: string | Date | undefined | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(d: string | Date | undefined | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Sort key for a unit number. Unit numbers are stored inconsistently — both
 * "F1-36" and "F1 - 36" occur — so comparing the raw text puts every spaced
 * name first, because a space sorts before a hyphen. Parse instead.
 */
export function unitSortKey(unitNumber?: string, floor?: string) {
  const raw = (unitNumber || '').replace(/\s+/g, '')
  const m = raw.match(/^(.*?)(\d+)$/)
  return {
    floor: (floor || '').replace(/\s+/g, '').toUpperCase(),
    prefix: (m?.[1] ?? raw).toUpperCase().replace(/[-_]+$/, ''),
    num: m ? Number(m[2]) : Number.MAX_SAFE_INTEGER,
  }
}

export function compareUnitNumbers(
  a: { unitNumber?: string; floor?: string },
  b: { unitNumber?: string; floor?: string },
) {
  const ka = unitSortKey(a.unitNumber, a.floor)
  const kb = unitSortKey(b.unitNumber, b.floor)
  return ka.floor.localeCompare(kb.floor) || ka.prefix.localeCompare(kb.prefix) || ka.num - kb.num
}
