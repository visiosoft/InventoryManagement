import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, TrendingDown } from 'lucide-react'
import { leadApi } from '../lib/api'
import { Skeleton } from './ui'

const INK = '#14081F'
const SUB = '#756E80'
const LINE = '#E5E7EB'
const BRAND = '#6D28D9'

/**
 * The pipeline, as a funnel — how many leads sit at each stage right now,
 * and how long they've been there.
 *
 * `Lead.status` isn't a strictly ordered pipeline in practice, so "reached
 * this stage or later" is a snapshot read of where things stand today, not
 * a claim about every lead's actual history — see leadFunnel.js for the
 * exact rule. Collapsed by default: this answers "where is the pipeline
 * stuck", a different question from the day-cards above, which answer
 * "who do I contact today" — worth having, not worth taking the room a
 * queue people check dozens of times a day would otherwise lose to it.
 */
export default function PipelineFunnel() {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['lead-funnel'],
    queryFn: () => leadApi.funnel(),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  return (
    <div className="rounded-xl border bg-white mt-4" style={{ borderColor: LINE }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 cursor-pointer"
      >
        <TrendingDown size={16} style={{ color: BRAND }} />
        <span className="text-[14px] font-bold" style={{ color: INK }}>Pipeline</span>
        <span className="text-[12px]" style={{ color: SUB }}>Where leads sit today, and how long they've been there</span>
        <ChevronDown
          size={16}
          className="ml-auto"
          style={{ color: SUB, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: LINE }}>
          {isLoading || !data ? (
            <div className="flex gap-2 mt-4">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[86px] flex-1 rounded-lg" />)}
            </div>
          ) : data.total === 0 ? (
            <p className="text-[13px] mt-3" style={{ color: SUB }}>No leads yet since {new Date(data.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.</p>
          ) : (
            <>
              <div className="flex gap-2 mt-4 overflow-x-auto">
                {data.stages.map((s) => (
                  <div key={s.key} className="flex-1 min-w-[110px] rounded-lg p-3" style={{ background: '#FAF8F5' }}>
                    <div className="text-[11px] font-semibold uppercase" style={{ color: SUB, letterSpacing: '.04em' }}>{s.label}</div>
                    <div className="mt-1" style={{ fontSize: 22, fontWeight: 800, color: INK, letterSpacing: '-.01em' }}>{s.count}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: SUB }}>
                      {s.medianDays === null ? 'no leads here' : `~${s.medianDays}d in stage`}
                    </div>
                    {/* Currently at this stage or any later one — a snapshot,
                        not a claim about who passed through in order. */}
                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: LINE }}>
                      <div className="h-full rounded-full" style={{ width: `${s.atOrPastPct}%`, background: BRAND }} />
                    </div>
                    <div className="text-[10.5px] mt-1" style={{ color: SUB }}>{s.atOrPastPct}% at or past</div>
                  </div>
                ))}
              </div>
              <p className="text-[11.5px] mt-3" style={{ color: SUB }}>
                {data.total} leads since {new Date(data.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                {data.lost ? ` · ${data.lost} lost` : ''}
                {data.alreadyCustomer ? ` · ${data.alreadyCustomer} turned out to be existing customers` : ''}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
