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

const EXAMPLES = [
  'How many units are free and what sizes are they?',
  'Which contracts expire before the end of October?',
  'How are the sales reps performing?',
  'Where are our leads coming from?',
  'What did we collect in the last six months?',
  'How long do tenants usually stay?',
]

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
      <Card>
        <CardHeader
          title="Ask for a report"
          subtitle="Plain English. The figures come from the system, not from the assistant."
        />
        <CardBody className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && question.trim()) ask.mutate() }}
              placeholder="Which contracts expire before the end of October?"
              className="flex-1 h-11 px-3 rounded-lg border bg-background text-sm"
            />
            <Button onClick={() => ask.mutate()} disabled={!question.trim() || ask.isPending}>
              <Sparkles size={14} /> {ask.isPending ? 'Working…' : 'Build report'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => { setQuestion(x); setErr('') }}
                className="text-xs px-2.5 py-1 rounded-full border text-muted-foreground hover:bg-muted cursor-pointer"
              >
                {x}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
            <input type="checkbox" checked={allFacilities} onChange={(e) => setAllFacilities(e.target.checked)} className="h-4 w-4 rounded" />
            <span>All facilities <span className="text-muted-foreground">(otherwise the one you are switched to)</span></span>
          </label>

          {err && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
              {err}
            </div>
          )}
        </CardBody>
      </Card>

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
