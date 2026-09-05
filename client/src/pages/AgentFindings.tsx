import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { agentsApi, money, CATEGORY_LABEL, type Finding } from '../lib/agents'
import { Spinner } from '../components/ui'
import { apiError } from '../lib/api'

const INK = '#14081F'
const MUTED = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_INK = '#4A1FA0'
const PURPLE_LINE = '#DDD0FF'
const TINT = '#F7F3FF'
const BADGE = '#EDE5FF'
const OFF_TINT = '#F1EEF6'
const LINE = 'rgba(20,8,31,.10)'
const LINE_2 = 'rgba(20,8,31,.16)'
const WARN_BG = '#FFF7E6'
const WARN_LINE = '#E9D9B4'
const WARN_INK = '#6B4500'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const HEAD = "'Bricolage Grotesque', serif"

type Sort = 'value' | 'silent' | 'score'

/**
 * The morning worklist.
 *
 * This is the product — the run view is transient, this is what somebody opens
 * every day. Every card says who, why they are here, what it is worth, and the
 * one thing to do next. **No control on this page sends anything**; the only
 * way to act is Open chat, which lands in the inbox where the opt-in and
 * 24-hour rules already live.
 */
export default function AgentFindings() {
  /* No key in the URL means every agent at once, which is how the work is
     actually done: somebody opens one page in the morning and deals with what
     is waiting, whichever agent noticed it. Which agent found something is a
     detail on the card, not a place to navigate to first. */
  const { key } = useParams()
  const qc = useQueryClient()
  const [tab, setTab] = useState('all')
  const [sort, setSort] = useState<Sort>('score')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [why, setWhy] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-findings', key ?? 'all'],
    queryFn: () => agentsApi.findings(key),
  })

  const act = useMutation({
    mutationFn: ({ id, action, days }: { id: string; action: 'dismiss' | 'done' | 'snooze'; days?: number }) =>
      agentsApi.act(id, action, days ? { days } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-findings'] }),
  })

  const all = data?.findings ?? []

  const shown = useMemo(() => {
    const rows = tab === 'all' ? all : all.filter((f) => f.data?.category === tab)
    const by = {
      score: (a: Finding, b: Finding) => b.score - a.score,
      value: (a: Finding, b: Finding) => (b.data?.valueAed || 0) - (a.data?.valueAed || 0),
      silent: (a: Finding, b: Finding) =>
        (b.data?.daysSince ?? b.data?.waitedDays ?? 0) - (a.data?.daysSince ?? a.data?.waitedDays ?? 0),
    }[sort]
    return [...rows].sort(by)
  }, [all, tab, sort])

  const selected = Object.keys(picked).filter((k) => picked[k])
  const selectedValue = all
    .filter((f) => picked[f._id])
    .reduce((n, f) => n + (f.data?.valueAed || 0), 0)

  const totalValue = all.reduce((n, f) => n + (f.data?.valueAed || 0), 0)
  const closedCount = all.filter((f) => f.data?.windowOpen === false).length

  if (isLoading) return <Spinner />
  if (error) return <p style={{ color: '#8A1C1C' }}>{apiError(error)}</p>

  const agentName = key
    ? (data?.agents.find((a) => a.key === key)?.name || key)
    : 'Findings'

  const tabs = [
    { id: 'all', label: 'All', count: all.length },
    ...Object.entries(data?.counts.byCategory ?? {})
      .filter(([id]) => id !== 'all')
      .map(([id, count]) => ({ id, label: CATEGORY_LABEL[id] || id, count })),
  ]

  return (
    <div style={{ maxWidth: 1240 }}>
      <div style={{ fontSize: 11.5, color: FAINT, fontWeight: 500 }}>
        {key
          ? <><Link to="/agents" style={{ color: FAINT }}>Agents</Link> · {agentName}</>
          : 'Everything your agents have found, ranked'}
      </div>
      <h1 style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 23, letterSpacing: '-.02em', margin: '2px 0 16px' }}>
        {key ? agentName : 'Findings'} · {all.length} waiting
      </h1>

      <div className="flex items-center gap-3.5 flex-wrap mb-4">
        <div className="flex gap-6 flex-wrap">
          {[
            [String(all.length), 'findings waiting'],
            [money(totalValue), 'estimated monthly value'],
            [String(closedCount), 'reply window closed'],
          ].map(([value, label]) => (
            <div key={label}>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 22, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' }}>
                {value}
              </div>
              <div style={{ color: FAINT, fontSize: 12 }}>{label}</div>
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            style={{ border: `1px solid ${LINE_2}`, borderRadius: 9, padding: '8px 11px', fontSize: 12.5, background: '#fff', color: INK }}
          >
            <option value="score">Sort: ranking</option>
            <option value="value">Sort: estimated value</option>
            <option value="silent">Sort: longest silent</option>
          </select>
          {key && (
            <a
              href={agentsApi.exportUrl(key)}
              style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: INK }}
            >
              Export CSV
            </a>
          )}
          <Link
            to="/agents"
            style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: INK }}
          >
            Agents
          </Link>
        </div>
      </div>

      {/* The estimate is a soft number and should read like one. */}
      <p style={{ color: FAINT, fontSize: 12, marginBottom: 12 }}>
        Estimated value assumes each person rents what they asked about, at the average price for
        that size. It is a way to sort the list, not a forecast.
      </p>

      <div className="flex gap-1.5 flex-wrap pb-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="cursor-pointer"
            style={{
              borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
              border: `1px solid ${tab === t.id ? PURPLE : LINE_2}`,
              background: tab === t.id ? PURPLE : '#fff',
              color: tab === t.id ? '#fff' : MUTED,
            }}
          >
            {t.label} <span style={{ opacity: .65, fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap" style={{ padding: '12px 4px', color: FAINT, fontSize: 12.5 }}>
        <button
          type="button"
          onClick={() => setPicked(selected.length ? {} : Object.fromEntries(shown.map((f) => [f._id, true])))}
          className="cursor-pointer"
          style={{ border: 0, background: 'none', padding: 0, color: PURPLE_INK, fontWeight: 600, fontSize: 12.5 }}
        >
          {selected.length ? 'Deselect all' : 'Select all shown'}
        </button>
        <span>·</span>
        <span>Showing {shown.length} of {all.length}</span>
        <span className="ml-auto">Everything here needs a person to act.</span>
      </div>

      {shown.length === 0 && (
        <div className="px-1 py-10" style={{ color: FAINT, fontSize: 13.5 }}>
          <p style={{ margin: 0 }}>
            Nothing waiting. Either nothing has run yet, or everything found has been dealt with.
          </p>
          <Link to="/agents" style={{ display: 'inline-block', marginTop: 12, background: PURPLE, color: '#fff', borderRadius: 10, padding: '10px 16px', fontWeight: 600, fontSize: 13 }}>
            Go to agents
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {shown.map((f, i) => {
          const on = Boolean(picked[f._id])
          const silent = f.data?.daysSince ?? f.data?.waitedDays
          const closed = f.data?.windowOpen === false
          const rec = f.recommendation
          return (
            <div
              key={f._id}
              style={{
                background: '#fff', border: `1px solid ${on ? PURPLE : LINE}`, borderRadius: 12,
                padding: '16px 18px', display: 'grid', gridTemplateColumns: '22px 30px minmax(0,1fr)',
                gap: 14, alignItems: 'start',
                boxShadow: on ? '0 2px 10px rgba(91,43,201,.10)' : '0 1px 2px rgba(20,8,31,.04)',
                opacity: f.state === 'open' ? 1 : .6,
              }}
            >
              <button
                type="button"
                onClick={() => setPicked((p) => ({ ...p, [f._id]: !p[f._id] }))}
                aria-label={`Select ${f.title}`}
                className="cursor-pointer"
                style={{
                  marginTop: 2, width: 18, height: 18, borderRadius: 5,
                  border: `1.5px solid ${on ? PURPLE : 'rgba(20,8,31,.24)'}`,
                  background: on ? PURPLE : '#fff', display: 'grid', placeItems: 'center',
                  color: '#fff', fontSize: 11, fontWeight: 700, padding: 0,
                }}
              >
                {on ? '✓' : ''}
              </button>

              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: FAINT, fontVariantNumeric: 'tabular-nums', marginTop: 1 }}>
                {String(i + 1).padStart(2, '0')}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16.5, letterSpacing: '-.01em' }}>
                    {f.title}
                  </span>
                  {!key && f.agent && (
                    <Link
                      to={`/agents/${f.agent.key}/findings`}
                      style={{ fontSize: 11.5, fontWeight: 600, color: MUTED, background: OFF_TINT, borderRadius: 999, padding: '2px 9px' }}
                      title="Only this agent's findings"
                    >
                      {f.agent.name}
                    </Link>
                  )}
                  {f.data?.categoryLabel && (
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: PURPLE_INK, background: BADGE, borderRadius: 999, padding: '2px 9px' }}>
                      {f.data.categoryLabel}
                    </span>
                  )}
                  {closed && (
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: WARN_INK, background: WARN_BG, border: `1px solid ${WARN_LINE}`, borderRadius: 999, padding: '2px 9px' }}>
                      24h window closed · template only
                    </span>
                  )}
                  {f.state !== 'open' && (
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: MUTED, background: OFF_TINT, borderRadius: 999, padding: '2px 9px' }}>
                      {f.state}
                    </span>
                  )}

                  <span className="ml-auto flex items-baseline gap-3.5">
                    <span style={{ textAlign: 'right' }}>
                      <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums', display: 'block' }}>
                        {money(f.data?.valueAed)}
                      </span>
                      <span style={{ color: FAINT, fontSize: 11, display: 'block' }}>{f.data?.valueBasis}</span>
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 600, fontSize: 14, fontVariantNumeric: 'tabular-nums', display: 'block' }}>
                        {silent == null ? '—' : `${silent}d`}
                      </span>
                      <span style={{ color: FAINT, fontSize: 11, display: 'block' }}>silent</span>
                    </span>
                  </span>
                </div>

                <div style={{ color: FAINT, fontSize: 12, marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>
                  {[
                    f.data?.inbound != null && `${f.data.inbound} from them, ${f.data.outbound ?? 0} from us`,
                    f.data?.quoteNo && `quote ${f.data.quoteNo}`,
                    f.data?.ownerName && `owned by ${f.data.ownerName}`,
                    f.data?.whatsappOptIn === false && 'no WhatsApp opt-in recorded',
                    `+${f.phoneNormalized}`,
                  ].filter(Boolean).join(' · ')}
                </div>

                {(f.detail || rec?.angle) && (
                  <p style={{ color: MUTED, fontSize: 13.5, margin: '9px 0 0', maxWidth: '96ch', textWrap: 'pretty' }}>
                    {f.detail} {rec?.angle}
                  </p>
                )}

                {rec?.template && (
                  <div className="flex items-center gap-2.5 flex-wrap" style={{ marginTop: 12 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: FAINT }}>
                      Recommended template
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, fontFamily: MONO, background: TINT, border: `1px solid ${PURPLE_LINE}`, color: PURPLE_INK, borderRadius: 8, padding: '4px 10px' }}>
                      {rec.template}
                    </span>
                    {rec.confidence && (
                      <span style={{ color: FAINT, fontSize: 12 }}>{rec.confidence} confidence</span>
                    )}
                  </div>
                )}

                {why[f._id] && (
                  <ul className="mt-2.5" style={{ color: MUTED, fontSize: 12.5, paddingLeft: 16, listStyle: 'disc' }}>
                    {f.factors.map((factor, n) => <li key={n}>{factor}</li>)}
                  </ul>
                )}

                <div className="flex gap-2 flex-wrap" style={{ marginTop: 13 }}>
                  <Link
                    to={`/whatsapp?phone=${f.phoneNormalized}`}
                    style={{ background: PURPLE, color: '#fff', borderRadius: 9, padding: '8px 14px', fontWeight: 600, fontSize: 12.5 }}
                  >
                    Open chat
                  </Link>
                  {rec?.text && (
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard?.writeText(rec.text!); setCopied(f._id) }}
                      className="cursor-pointer"
                      style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: INK }}
                      title={rec.text}
                    >
                      {copied === f._id ? 'Copied' : 'Copy suggested text'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => act.mutate({ id: f._id, action: 'snooze', days: 30 })}
                    className="cursor-pointer"
                    style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: INK }}
                  >
                    Snooze 30 days
                  </button>
                  <button
                    type="button"
                    onClick={() => act.mutate({ id: f._id, action: 'dismiss' })}
                    className="cursor-pointer"
                    style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: MUTED }}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => act.mutate({ id: f._id, action: 'done' })}
                    className="cursor-pointer"
                    style={{ border: `1px solid ${LINE_2}`, background: '#fff', borderRadius: 9, padding: '8px 13px', fontWeight: 600, fontSize: 12.5, color: INK }}
                  >
                    Mark done
                  </button>
                  <button
                    type="button"
                    onClick={() => setWhy((w) => ({ ...w, [f._id]: !w[f._id] }))}
                    className="ml-auto cursor-pointer"
                    style={{ border: 0, background: 'none', color: FAINT, fontSize: 12.5, fontWeight: 600, padding: '8px 4px' }}
                  >
                    {why[f._id] ? 'Hide reasoning' : 'Why this ranking?'}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ color: FAINT, fontSize: 12.5, padding: '18px 4px 0' }}>
        A dismissed person stays out of future runs of this agent — unless they write to us again,
        which puts them straight back on the list.
      </div>

      {selected.length > 0 && (
        <div
          className="flex items-center gap-3.5 flex-wrap"
          style={{
            position: 'sticky', bottom: 0, background: '#fff', borderTop: `1px solid ${LINE}`,
            padding: '14px 30px', margin: '0 -30px', boxShadow: '0 -6px 20px rgba(20,8,31,.06)',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>
            {selected.length} finding{selected.length === 1 ? '' : 's'} selected
          </span>
          <span style={{ color: FAINT, fontSize: 12.5 }}>
            {money(selectedValue)} estimated monthly value · a person still writes and sends every message
          </span>
          <div className="ml-auto flex gap-2.5 items-center">
            <button
              type="button"
              onClick={() => setPicked({})}
              className="cursor-pointer"
              style={{ border: 0, background: 'none', color: FAINT, fontWeight: 600, fontSize: 12.5, padding: '8px 4px' }}
            >
              Clear
            </button>
            {key && (
              <a
                href={agentsApi.exportUrl(key)}
                style={{ background: PURPLE, color: '#fff', borderRadius: 9, padding: '9px 16px', fontWeight: 600, fontSize: 12.5 }}
              >
                Export CSV
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
