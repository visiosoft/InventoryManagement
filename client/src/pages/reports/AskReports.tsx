import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { Download, FileText, Sparkles } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useSite } from '../../lib/site'
import { Button, Card, CardBody, CardHeader, Spinner, Table, Th, Td } from '../../components/ui'
import { CHART_STYLE, PIE_COLORS, StatCard, downloadCsv } from './shared'

/* What comes back from the server. The figures are computed there, from tested
   blocks — the assistant only chose which ones to run and wrote the wording. */
type Section = {
  type: 'stat' | 'table' | 'chart'
  block: string
  caption?: string
  params?: Record<string, unknown>
  data: {
    stats?: { label: string; value: number | string; unit?: string }[]
    columns?: string[]
    rows?: (string | number | null)[][]
    series?: Record<string, string | number>[]
    keys?: string[]
    totals?: Record<string, string | number>
    note?: string
    truncated?: boolean
    rowsTotal?: number
  }
}
type Report = {
  title: string
  intro?: string
  closing?: string
  sections: Section[]
  blocksUsed: { block: string; params: Record<string, unknown> }[]
  scope: string
  generatedAt: string
}

/* Grouped the way somebody thinks about the business, not the way the blocks
   are named. Each one is a question the catalogue can genuinely answer — an
   example that comes back empty teaches people the tool does not work. */
const EXAMPLE_GROUPS = [
  {
    label: 'Space',
    items: [
      'How many units are free and what sizes are they?',
      'Which sizes do we have most of, and how many are let?',
    ],
  },
  {
    label: 'Contracts',
    items: [
      'Which contracts are ending this month?',
      'How long do tenants usually stay?',
    ],
  },
  {
    label: 'Sales',
    items: [
      'How are the sales reps performing?',
      'Where are our leads coming from?',
    ],
  },
  {
    label: 'Money',
    items: [
      'What did we collect over the last six months?',
      'What is still owed to us, and how overdue is it?',
    ],
  },
]

/* Hover states the design calls for. Inline styles cannot express :hover, and
   these are specific enough to this page not to belong in the shared kit. */
const CSS = `
.ask-example:hover { border-color: #A78BFA; background: #F7F3FF; color: #4A1FA0; }
.ask-build:hover { background: #4A1FA0; }
.ask-field:focus-within { box-shadow: 0 0 0 4px rgba(91,43,201,.10); }
`

export default function AskReports() {
  const { siteId } = useSite()
  const [question, setQuestion] = useState('')
  const [allFacilities, setAllFacilities] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [err, setErr] = useState('')

  /* The catalogue, so the box is not a guessing game. It is the same list the
     assistant is given, so what it says is answerable really is. */
  const { data: blocks = [] } = useQuery<{ name: string; summary: string }[]>({
    queryKey: ['ai-report-blocks'],
    queryFn: () => api.get('/ai-reports/blocks').then((r) => r.data ?? []),
    staleTime: 30 * 60_000,
  })

  const scopeId = allFacilities ? 'all' : (siteId ?? 'all')

  const ask = useMutation({
    mutationFn: () => api.post('/ai-reports/ask', { question: question.trim(), siteId: scopeId }).then((r) => r.data),
    onSuccess: (d) => { setReport(d.report); setErr('') },
    onError: (e) => {
      setReport(null)
      // A refusal is not a failure — it is the assistant saying the data does
      // not go that far, which is the honest answer and worth showing plainly.
      const reason = (e as { response?: { data?: { reason?: string } } })?.response?.data?.reason
      setErr(reason || apiError(e))
    },
  })

  /* The download re-sends the plan being shown, not the question, so the file
     is this report rather than a fresh answer that might differ. */
  const downloadPdf = useMutation({
    mutationFn: async () => {
      const spec = {
        title: report!.title, intro: report!.intro, closing: report!.closing,
        sections: report!.sections.map((s) => ({ type: s.type, block: s.block, params: s.params ?? {}, caption: s.caption })),
      }
      const res = await api.post('/ai-reports/pdf', { spec, siteId: scopeId }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${report!.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    },
    onError: (e) => setErr(apiError(e)),
  })

  function csvFor(s: Section) {
    if (s.data.rows) downloadCsv(`${s.block}.csv`, [s.data.columns ?? [], ...s.data.rows])
    else if (s.data.series) {
      const keys = s.data.keys ?? []
      downloadCsv(`${s.block}.csv`, [['Period', ...keys], ...s.data.series.map((p) => [String(p.label), ...keys.map((k) => p[k])])])
    } else if (s.data.stats) {
      downloadCsv(`${s.block}.csv`, [['Measure', 'Value'], ...s.data.stats.map((x) => [x.label, `${x.value}${x.unit ?? ''}`])])
    }
  }

  return (
    <div className="space-y-4">
      <style>{CSS}</style>

      <section style={{ background: '#fff', border: '1px solid rgba(20,8,31,.10)', borderRadius: 24, padding: '30px 30px 26px', boxShadow: '0 8px 24px rgba(20,8,31,.05)' }}>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 34, letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0 }}>
              Ask for a report
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: 15, color: '#4A4357' }}>
              Plain English. Every figure is pulled from your records, not written by the assistant.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 600, color: '#4A4357', background: '#F6F0E4', border: '1px solid rgba(20,8,31,.08)', borderRadius: 999, padding: '8px 14px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allFacilities}
              onChange={(e) => setAllFacilities(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: '#5B2BC9', margin: 0 }}
            />
            <span>Include all facilities</span>
          </label>
        </div>

        <div style={{ marginTop: 22, display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <div
            className="ask-field"
            style={{ flex: '1 1 420px', display: 'flex', alignItems: 'center', gap: 12, background: '#FBF8F2', border: '1.5px solid #5B2BC9', borderRadius: 16, padding: '0 18px', height: 60 }}
          >
            <Sparkles size={20} style={{ color: '#5B2BC9', flex: '0 0 auto' }} />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && question.trim() && !ask.isPending) ask.mutate() }}
              placeholder="How many customer contracts are ending this month?"
              style={{ flex: '1 1 auto', border: 0, outline: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 17, fontWeight: 500, color: '#14081F', minWidth: 0 }}
            />
          </div>
          <button
            type="button"
            className="ask-build"
            onClick={() => ask.mutate()}
            disabled={!question.trim() || ask.isPending}
            style={{
              flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              height: 60, padding: '0 28px', border: 0, borderRadius: 16, background: '#5B2BC9', color: '#fff',
              fontFamily: 'inherit', fontSize: 16, fontWeight: 600,
              cursor: !question.trim() || ask.isPending ? 'not-allowed' : 'pointer',
              opacity: !question.trim() || ask.isPending ? 0.5 : 1,
              boxShadow: '0 8px 20px rgba(91,43,201,.28)',
            }}
          >
            <span>{ask.isPending ? 'Building…' : 'Build report'}</span>
            {!ask.isPending && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M5 12h13" /><path d="m13 6 6 6-6 6" />
              </svg>
            )}
          </button>
        </div>

        {/* Worked examples, grouped. Somebody who has never used this does not
            know what it can reach; a blank box teaches them nothing. */}
        <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '18px 26px' }}>
          {EXAMPLE_GROUPS.map((g) => (
            <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.11em', color: '#756E80' }}>
                {g.label}
              </div>
              {g.items.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="ask-example"
                  onClick={() => { setQuestion(q); setErr('') }}
                  style={{ textAlign: 'left', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 500, color: '#4A4357', background: '#fff', border: '1px solid rgba(20,8,31,.12)', borderRadius: 12, padding: '9px 12px', cursor: 'pointer', lineHeight: 1.35 }}
                >
                  {q}
                </button>
              ))}
            </div>
          ))}
        </div>

        {err && (
          <div style={{ marginTop: 20, borderRadius: 14, border: '1px solid #F5D9A0', background: '#FFF7E6', padding: '12px 16px', fontSize: 14, color: '#6B4500' }}>
            {err}
          </div>
        )}
      </section>

      {ask.isPending && <div className="flex justify-center py-10"><Spinner /></div>}

      {report && !ask.isPending && (
        <Card>
          <CardHeader
            title={report.title}
            subtitle={report.intro}
            action={
              <Button size="sm" variant="outline" onClick={() => downloadPdf.mutate()} disabled={downloadPdf.isPending}>
                <FileText size={13} /> {downloadPdf.isPending ? 'Building…' : 'PDF'}
              </Button>
            }
          />
          <CardBody className="space-y-6">
            {report.sections.map((s, i) => (
              <div key={`${s.block}-${i}`} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{s.caption || s.block.replace(/_/g, ' ')}</div>
                  <Button size="sm" variant="ghost" onClick={() => csvFor(s)}><Download size={12} /> CSV</Button>
                </div>

                {s.data.stats && (
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    {s.data.stats.map((x) => (
                      <StatCard key={x.label} label={x.label} value={`${x.value}${x.unit ?? ''}`} />
                    ))}
                  </div>
                )}

                {s.data.series && (
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={s.data.series}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={CHART_STYLE.axisStyle} />
                        <YAxis tick={CHART_STYLE.axisStyle} />
                        <Tooltip contentStyle={CHART_STYLE.contentStyle} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {(s.data.keys ?? []).map((k, ki) => (
                          <Bar key={k} dataKey={k} fill={PIE_COLORS[ki % PIE_COLORS.length]} radius={[4, 4, 0, 0]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {s.data.rows && (
                  <div className="overflow-x-auto">
                    <Table>
                      <thead>
                        <tr>{(s.data.columns ?? []).map((c) => <Th key={c}>{c}</Th>)}</tr>
                      </thead>
                      <tbody>
                        {s.data.rows.map((row, ri) => (
                          <tr key={ri}>{row.map((c, ci) => <Td key={ci}>{c ?? ''}</Td>)}</tr>
                        ))}
                      </tbody>
                    </Table>
                    {s.data.truncated && (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Showing {s.data.rows.length} of {s.data.rowsTotal}. The CSV has all of them.
                      </p>
                    )}
                  </div>
                )}

                {s.data.note && <p className="text-xs text-muted-foreground italic">{s.data.note}</p>}
              </div>
            ))}

            {report.closing && <p className="text-sm">{report.closing}</p>}

            {/* Where the numbers came from. A figure nobody can trace is a
                figure nobody should act on. */}
            <div className="border-t pt-3 text-xs text-muted-foreground">
              Built {new Date(report.generatedAt).toLocaleString('en-GB')} ·{' '}
              {report.scope === 'all' ? 'all facilities' : 'current facility'} · figures from{' '}
              {report.blocksUsed.map((b) => b.block).join(', ')}
            </div>
          </CardBody>
        </Card>
      )}

      {!report && !ask.isPending && blocks.length > 0 && (
        <Card>
          <CardHeader title="What it can answer" subtitle="Ask in your own words — these are the figures it can reach." />
          <CardBody>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
              {blocks.map((b) => <li key={b.name}>{b.summary}</li>)}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
