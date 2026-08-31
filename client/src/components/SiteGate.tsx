import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useSite, type Site } from '../lib/site'

/**
 * Settle which facility we are in before any page can ask for data.
 *
 * The facility rides on the request as `?site=`, read from localStorage when
 * the request is built. On a fresh login nothing is stored yet, so the first
 * page mounted its queries, fired them without a facility, and cached a
 * company-wide answer. Choosing the facility a moment later did fix the
 * stored value, but the damage was done: invalidating a request that is
 * already in flight does not reliably produce a second one, so the wrong
 * numbers sat there until something else forced a refetch — which is exactly
 * what switching facility and coming back was doing.
 *
 * Rather than race it, nothing renders until the answer is known. That is one
 * short wait on a cold load, against every scoped page being wrong until
 * somebody notices.
 *
 * If the facilities cannot be fetched at all, children render anyway: the app
 * without scoping is far better than no app.
 */
export function SiteGate({ children }: { children: React.ReactNode }) {
  const { siteId, setSiteId } = useSite()

  const { data: sites, isLoading, isError } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then((r) => r.data ?? []),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const visible = (sites ?? []).filter((s) => !s.hidden)
  const resolved = visible.find((s) => s._id === siteId)
    ?? visible.find((s) => s.isDefault)
    ?? visible[0]
  const resolvedId = resolved?._id

  useEffect(() => {
    if (resolvedId && siteId !== resolvedId) setSiteId(resolvedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSiteId is a
    // fresh function each render; depending on it would loop.
  }, [siteId, resolvedId])

  // Still working out where we are, and able to find out.
  const settled = isError || (!isLoading && (!resolvedId || siteId === resolvedId))
  if (!settled) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
        <span className="sr-only">Loading your facility</span>
        <div
          className="h-6 w-6 animate-spin rounded-full"
          style={{ border: '2px solid #EDE5FF', borderTopColor: '#5B2BC9' }}
        />
      </div>
    )
  }

  return <>{children}</>
}
