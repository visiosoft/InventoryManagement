import { useEffect, useState } from 'react'

export interface Site {
  _id: string
  name: string
  code: string
  address: string
  hidden: boolean
  isDefault: boolean
  /* What this facility prints on a customer's paperwork. All optional — empty
     means "use the company details documents already carry". */
  legalName?: string
  tagline?: string
  addr1?: string
  addr2?: string
  country?: string
  phone?: string
  email?: string
  trn?: string
  logo?: { mimeType?: string; updatedAt?: string | null }
  stats?: { total: number; occupied: number; reserved: number; available: number; maintenance: number }
}

const KEY = 'pb_site_id'
const EVT = 'pb-site-changed'

/** Currently selected site id (null = default site). Shared across the app via a window event. */
export function useSite() {
  const [siteId, setState] = useState<string | null>(() => localStorage.getItem(KEY))
  useEffect(() => {
    const h = () => setState(localStorage.getItem(KEY))
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])
  const setSiteId = (id: string | null) => {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
    window.dispatchEvent(new Event(EVT))
  }
  return { siteId, setSiteId }
}

/**
 * True when a unit belongs to the selected site (units with no site belong to
 * the default site). A hidden facility's units are never shown, even to a
 * browser that still has it selected from before it was hidden.
 */
export function unitInSite(unitSite: string | { _id: string } | null | undefined, siteId: string | null, sites: Site[]): boolean {
  const defaultId = sites.find(s => s.isDefault)?._id ?? sites[0]?._id ?? null
  const hidden = new Set(sites.filter(s => s.hidden).map(s => s._id))
  const selected = siteId && !hidden.has(siteId) ? siteId : defaultId
  if (!selected) return true
  const us = (typeof unitSite === 'object' && unitSite ? unitSite._id : unitSite) ?? defaultId
  return !hidden.has(us ?? '') && us === selected
}
