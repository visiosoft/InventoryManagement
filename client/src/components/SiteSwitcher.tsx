import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { api } from '../lib/api'
import { useSite, type Site } from '../lib/site'

/**
 * Which facility you are working in.
 *
 * Everything that is split by facility — units, contracts, payments, reports,
 * the floor plan — follows this. Everything else is company-wide and ignores
 * it; see the allowlist in lib/api.ts.
 *
 * Hidden entirely when there is only one facility, so a single-site company
 * never sees a control with one option in it.
 */
export function SiteSwitcher() {
  const { siteId, setSiteId } = useSite()
  const qc = useQueryClient()

  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then((r) => r.data ?? []),
    staleTime: 5 * 60_000,
  })

  const visible = sites.filter((s) => !s.hidden)
  const current = visible.find((s) => s._id === siteId)
    ?? visible.find((s) => s.isDefault)
    ?? visible[0]

  /* Resolving which facility we are in belongs to SiteGate, which does it
     before anything is allowed to fetch. By the time this control renders the
     answer is already stored, so it only has to show it and change it. */

  /* Every cached list belongs to the facility it was fetched for. Without
     this the page keeps showing the previous facility's units and contracts
     until each query happens to refetch — which reads as the switch not
     working, or worse, as data from the wrong building. */
  useEffect(() => {
    const onChange = () => qc.invalidateQueries()
    window.addEventListener('pb-site-changed', onChange)
    return () => window.removeEventListener('pb-site-changed', onChange)
  }, [qc])

  if (visible.length < 2) return null

  return (
    <label className="relative flex items-center" title="Which facility you are working in">
      <Building2
        size={14}
        className="pointer-events-none absolute left-2.5"
        style={{ color: '#5B2BC9' }}
        aria-hidden
      />
      <span className="sr-only">Facility</span>
      <select
        value={current?._id ?? ''}
        onChange={(e) => setSiteId(e.target.value || null)}
        className="h-8 cursor-pointer rounded-lg pl-7 pr-2 text-sm font-medium"
        style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
      >
        {visible.map((s) => (
          <option key={s._id} value={s._id}>{s.name}</option>
        ))}
      </select>
    </label>
  )
}
