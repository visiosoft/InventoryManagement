import { useRef } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'

/**
 * A chart an answer drew from its own figures (make_chart on the server,
 * checked against the data before it gets here). Bar, line or pie, in the
 * dashboard's colours, with a button to save it as a picture.
 */

export type ChartSpec = { type: 'bar' | 'line' | 'pie'; title: string; labels: string[]; series: { name: string; values: number[] }[] }

const COLORS = ['#5B2BC9', '#F5B83D', '#10B981', '#E8618C', '#3B82F6', '#8B5CF6', '#F97316', '#14B8A6']
const MUTED = '#756E80'

export default function ChartView({ chart }: { chart: ChartSpec }) {
  const box = useRef<HTMLDivElement>(null)
  const data = chart.labels.map((label, i) => Object.fromEntries([['label', label], ...chart.series.map((s) => [s.name, s.values[i] ?? 0])]))
  const fmt = (v: number) => Number(v).toLocaleString('en-GB')

  /* The drawn SVG onto a canvas, saved as a PNG — what someone pastes into a message or a slide. */
  async function save() {
    const svg = box.current?.querySelector('svg.recharts-surface')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    const { width, height } = svg.getBoundingClientRect()
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = (height + 40) * scale
      const ctx = canvas.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height + 40)
      ctx.fillStyle = '#14081F'
      ctx.font = 'bold 14px Arial'
      ctx.fillText(chart.title, 8, 22)
      ctx.drawImage(img, 0, 36, width, height)
      URL.revokeObjectURL(url)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `${chart.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'chart'}.png`
      a.click()
    }
    img.src = url
  }

  return (
    <div ref={box} aria-label={`Chart: ${chart.title}`} style={{ marginTop: 10, background: '#fff', border: '1px solid rgba(20,8,31,.08)', borderRadius: 12, padding: '10px 12px', maxWidth: 720 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#14081F' }} className="mr-auto">{chart.title}</span>
        <button type="button" onClick={save} className="inline-flex items-center gap-1" style={{ fontSize: 12, fontWeight: 600, color: MUTED, background: 'none', border: 0, cursor: 'pointer' }}>
          <Download size={12} /> Download chart
        </button>
      </div>
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          {chart.type === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey={chart.series[0].name} nameKey="label" outerRadius={90} label={(e: { name?: string; value?: number }) => `${e.name}: ${fmt(e.value ?? 0)}`} isAnimationActive={false}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => fmt(Number(v))} />
            </PieChart>
          ) : chart.type === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEE" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={fmt} width={48} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {chart.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEE" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} />
              <YAxis tick={{ fontSize: 11, fill: MUTED }} tickFormatter={fmt} width={48} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {chart.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
