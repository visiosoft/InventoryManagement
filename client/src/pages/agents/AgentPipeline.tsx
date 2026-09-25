import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { agentsApi, agoText, dueText, needText, BUCKET_TONE, agentColor, type Bucket } from '../../lib/agentsApi'
import { PageHeader, Spinner } from '../../components/ui'
import { AgentNav, C, DISPLAY, Eyebrow, Note, Panel, Pill, SectionHead } from './ui'

const SELLING: Bucket[] = ['new', 'engaged', 'quoted', 'booking', 'won']
const NURTURE: Bucket[] = ['quiet', 'dormant', 'with_person', 'lost']
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`)

export default function AgentPipeline() {
  const [bucket, setBucket] = useState<Bucket>('quiet')
  const { data, isLoading } = useQuery({ queryKey: ['agents', 'pipeline', bucket], queryFn: () => agentsApi.pipeline(bucket) })
  const max = Math.max(1, ...SELLING.map((b) => data?.counts[b] || 0))
  const conv = data?.conversion

  const Stage = ({ b, width, color, right }: { b: Bucket; width: number; color: string; right?: string | null }) => {
    const on = bucket === b
    const label = data?.buckets.find((x) => x.key === b)?.label || b
    return (
      <button onClick={() => setBucket(b)} style={{ textAlign: 'left', cursor: 'pointer', border: 'none', background: on ? BUCKET_TONE[b].bg : 'transparent', borderRadius: 10, padding: '12px 12px 10px', position: 'relative', fontFamily: 'inherit' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 800, lineHeight: 1, color: C.ink }}>{data?.counts[b] ?? '—'}</div>
        <div style={{ fontSize: 12, color: C.second, fontWeight: 600 }}>{label}</div>
        <div style={{ height: 8, borderRadius: 999, background: '#E4D8FA', marginTop: 8 }}><div style={{ width: `${Math.max(4, width)}%`, height: '100%', borderRadius: 999, background: color }} /></div>
        {right !== undefined && <span style={{ position: 'absolute', right: -14, top: 10, background: C.card, border: `1px solid ${C.line}`, borderRadius: 999, fontSize: 10.5, padding: '1px 6px', color: C.muted, zIndex: 1 }}>→ {pct(right)}</span>}
      </button>
    )
  }

  return (
    <div>
      <AgentNav />
      <PageHeader title="Pipeline" subtitle={`Every lead the agents look after, by where it stands · moves in the last ${data?.days ?? 30} days`} />
      {isLoading || !data ? <Spinner /> : (
        <>
          <Panel>
            <Eyebrow>Selling</Eyebrow>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
              <Stage b="new" width={(data.counts.new / max) * 100} color={C.purple} right={conv?.new_engaged} />
              <Stage b="engaged" width={(data.counts.engaged / max) * 100} color={C.purple} right={conv?.engaged_quoted} />
              <Stage b="quoted" width={(data.counts.quoted / max) * 100} color={C.blue} right={conv?.quoted_booking} />
              <Stage b="booking" width={(data.counts.booking / max) * 100} color="#C2410C" right={conv?.booking_won} />
              <Stage b="won" width={(data.counts.won / max) * 100} color={C.ok} />
            </div>
            <div style={{ height: 14 }} />
            <Eyebrow>Nurturing &amp; closed</Eyebrow>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <Stage b="quiet" width={(data.counts.quiet / max) * 100} color={C.amber} />
              <Stage b="dormant" width={(data.counts.dormant / max) * 100} color={C.muted} />
              <Stage b="with_person" width={(data.counts.with_person / max) * 100} color={C.danger} />
              <Stage b="lost" width={(data.counts.lost / max) * 100} color={C.muted} />
            </div>
            <Note>
              Quiet → Engaged: <b style={{ color: C.ink }}>{pct(conv?.quiet_engaged)}</b> came back after a touch · Dormant → Engaged: <b style={{ color: C.ink }}>{pct(conv?.dormant_engaged)}</b> · <b style={{ color: C.ink }}>{data.dueThisWeek}</b> touch{data.dueThisWeek === 1 ? '' : 'es'} due this week.
              {conv?.quiet_engaged === null && ' Conversion shows once leads have moved between buckets.'}
            </Note>
          </Panel>

          <SectionHead title={`${data.buckets.find((b) => b.key === bucket)?.label} · ${data.counts[bucket]}`} hint="soonest touch first" />
          <div style={{ display: 'grid', gap: 8 }}>
            {data.rows.length === 0 && <Note>Nothing here yet.</Note>}
            {data.rows.map((r) => (
              <Link key={r.leadFileId} to={`/agents/leads/${r.leadId}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.1fr 2fr 1fr', gap: 14, alignItems: 'center', padding: '12px 16px', border: `1px solid ${C.line}`, borderLeft: `4px solid ${BUCKET_TONE[r.bucket].fg}`, borderRadius: 12, background: C.card }}>
                  <div><div style={{ fontWeight: 700 }}>{r.name}</div><div style={{ fontSize: 12, color: C.muted }}>{r.phone}{r.temperature ? ` · ${r.temperature}` : ''}{r.agent ? <> · <b style={{ color: agentColor(r.agent) }}>{r.agent.name}</b></> : null}</div></div>
                  <div><Pill bucket={r.bucket} label={r.bucketLabel} />{r.stage && <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{r.stage}{r.frozen ? ' · stopped' : ''}</div>}</div>
                  <div><div style={{ fontSize: 13 }}>{r.lastAction?.summary || 'No action yet'}</div><div style={{ fontSize: 12, color: C.muted }}>{r.lastAction ? agoText(r.lastAction.at) : ''}{needText(r.need) ? ` · ${needText(r.need)}` : ''}{r.offers.length ? ` · offered ${r.offers[r.offers.length - 1].unitNumber} at AED ${r.offers[r.offers.length - 1].monthlyPrice}` : ''}</div></div>
                  <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 12.5, color: r.nextTouchAt && new Date(r.nextTouchAt).getTime() <= Date.now() ? C.danger : C.muted }}>{r.nextTouchAt ? dueText(r.nextTouchAt) : '—'}</div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
