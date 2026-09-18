import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { orgApi } from '../lib/api'

/**
 * A slim bar naming the trial cap and how close it is — shown only for a
 * multi-tenant organisation still on the free plan. Renders nothing on the
 * single-tenant deployment (`GET /org/status` answers `{ multiTenant: false }`
 * there) and nothing once upgraded, so it disappears on its own rather than
 * needing to be dismissed.
 */
export default function TrialBanner() {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(false)
  const { data } = useQuery({
    queryKey: ['org-status'],
    queryFn: () => orgApi.status(),
    staleTime: 60_000,
  })

  if (!data?.multiTenant || data.plan !== 'trial' || dismissed) return null

  return (
    <div
      className="shrink-0 flex flex-wrap items-center gap-2 px-4 py-2 text-xs"
      style={{ background: '#FFF799', color: '#111218' }}
    >
      <span className="font-semibold">Free trial</span>
      <span>
        {data.usage.units}/{data.limits.units} units · {data.usage.contracts}/{data.limits.contracts} contracts
      </span>
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="ml-auto font-semibold underline underline-offset-2 cursor-pointer"
      >
        Upgrade
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="cursor-pointer opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
