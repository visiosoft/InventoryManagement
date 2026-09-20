import { formatMoney } from '../lib/utils'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, TrendingDown } from 'lucide-react'
import { leadApi, type LeadQuery } from '../lib/api'
import { Skeleton, statusLabel } from './ui'

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
export default function PipelineFunnel({ filters = {} }: { filters?: LeadQuery }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['lead-funnel', filters],
    queryFn: () => leadApi.funnel(filters),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  return (
    <div className="rounded-xl border bg-white mt-4" style={{ borderColor: LINE }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 cursor-pointer"
      >
        <TrendingDown size={16} style={{ color: BRAND }} />
        <span className="text-[14px] font-bold" style={{ color: INK }}>Lead funnel</span>
        <span className="text-[12px]" style={{ color: SUB }}>Where leads sit today, and how long they've been there</span>
        <ChevronDown
          size={16}
          className="ml-auto"
          style={{ color: SUB, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t" style={{ borderColor: LINE }}>
          {isError ? <p role="alert" className="mt-3 text-sm text-red-700">Could not load the funnel. <button className="underline" onClick={() => refetch()}>Retry</button></p> : isLoading || !data ? (
            <div className="flex gap-2 mt-4">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-[86px] flex-1 rounded-lg" />)}
            </div>
          ) : data.total === 0 ? (
            <p className="text-[13px] mt-3" style={{ color: SUB }}>No leads match these filters.</p>
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
                Current snapshot of {data.total} matching leads. Uses the page filters and lead date range; percentages above are not historical conversion rates.
                {data.lost ? ` · ${data.lost} lost` : ''}
                {data.alreadyCustomer ? ` · ${data.alreadyCustomer} turned out to be existing customers` : ''}
              </p>
              <section className="mt-5 border-t pt-4" aria-label="Recorded conversions">
                <h3 className="text-sm font-semibold">Recorded conversions</h3>
                <p className="mt-1 text-xs text-gray-500">{data.history.tracked} leads with recorded stage entries ? {data.history.untracked} without structured history. Skipped stages are not inferred. Win rate uses recorded won/lost outcomes for leads observed entering each stage.</p>
                <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Stage</th><th className="p-2">Entered</th><th className="p-2">Closed</th><th className="p-2">Won</th><th className="p-2">Win rate</th></tr></thead><tbody>{data.history.stages.map(stage => <tr key={stage.key} className="border-t"><td className="p-2">{statusLabel(stage.key)}</td><td className="p-2 tabular-nums">{stage.reached}</td><td className="p-2 tabular-nums">{stage.closed}</td><td className="p-2 tabular-nums">{stage.wins}</td><td className="p-2 tabular-nums">{stage.winRate === null ? 'Not enough history' : `${stage.winRate}%`}</td></tr>)}</tbody></table></div>
                {data.history.medianDaysToWin !== null && <p className="mt-2 text-xs text-gray-500">Median time from creation to first recorded win: {data.history.medianDaysToWin} days. Earlier unrecorded wins are unknown.</p>}
              </section>
              <section className="mt-5 border-t pt-4" aria-label="Quote value forecast">
                <h3 className="text-sm font-semibold">Quote value forecast</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <div><p className="text-xs text-gray-500">Open quoted value</p><p className="text-xl font-semibold tabular-nums">AED {formatMoney(data.forecast.quotedValue)}</p></div>
                  <div><p className="text-xs text-gray-500">Weighted portion</p><p className="text-xl font-semibold tabular-nums">AED {formatMoney(data.forecast.weightedValue)}</p></div>
                  <div><p className="text-xs text-gray-500">Value without sufficient history</p><p className="text-xl font-semibold tabular-nums">AED {formatMoney(data.forecast.unweightedValue)}</p></div>
                </div>
                <p className="mt-2 text-xs text-gray-500">Latest non-rejected quote totals, including draft or expired quotes; these are quoted amounts, not recurring revenue. Weighting uses observed stage win rates with at least {data.forecast.minimumSample} closed outcomes within the selected filters. {data.forecast.withoutQuote} open leads have no quote; {data.forecast.missingCloseDate} have no expected close date.</p>
              </section>
              {data.losses.length > 0 && <section className="mt-5 border-t pt-4" aria-label="Loss breakdown">
                <h3 className="text-sm font-semibold">Losses by reason, source and owner</h3>
                <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Reason</th><th className="p-2">Source</th><th className="p-2">Owner</th><th className="p-2">Leads</th></tr></thead><tbody>{data.losses.map(row => <tr key={JSON.stringify([row.reason, row.source, row.ownerId])} className="border-t"><td className="p-2">{statusLabel(row.reason)}</td><td className="p-2">{statusLabel(row.source)}</td><td className="p-2">{row.owner}</td><td className="p-2 tabular-nums">{row.count}</td></tr>)}</tbody></table></div>
              </section>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
