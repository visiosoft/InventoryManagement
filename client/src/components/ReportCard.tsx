import { AlertCircle, Info } from 'lucide-react'

/**
 * A bot's answer laid out as a report: headline, key figures, a breakdown
 * with share bars, the one thing to take away, numbered actions. Every
 * figure was checked against the bot's own data on the server; shares and
 * bar lengths are worked out here from those figures, never typed by the AI.
 */

export type Report = {
  eyebrow?: string; headline: string; badge?: string
  kpis: { label: string; value: number; format?: 'number' | 'money_aed' | 'money_usd' | 'percent'; sub?: string }[]
  breakdown?: { title?: string; columns: string[]; rows: { label: string; tag?: string; values: number[] }[]; shareOf?: number | null } | null
  callout?: string
  actions: { title: string; detail?: string; value?: number | null; of?: number | null; label?: string }[]
  footnote?: string
}

const INK = '#14081F'
const MUTED = '#6B6478'
const PURPLE = '#4A2A9E'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"
const SHADES = ['#4A2A9E', '#B7A6F0', '#7C5BD6', '#D9CFF8', '#5B2BC9', '#EDE7FD']

const compact = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString())
function big(k: Report['kpis'][number]) {
  if (k.format === 'money_usd') return `US$${k.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (k.format === 'money_aed') return `AED ${k.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (k.format === 'percent') return `${k.value}%`
  return compact(k.value)
}
const pct = (v: number, of: number) => (of > 0 ? Math.max(0, Math.min(100, (v / of) * 100)) : 0)
const pctLabel = (p: number) => `${Number(p.toFixed(1))}%`

export default function ReportCard({ report, when }: { report: Report; when?: string }) {
  const b = report.breakdown
  const shareCol = b && b.shareOf != null ? b.shareOf : null
  const shareTotal = b && shareCol != null ? b.rows.reduce((s, r) => s + (r.values[shareCol] || 0), 0) : 0
  const section: React.CSSProperties = { padding: '18px 22px', borderTop: `1px solid ${LINE}` }
  const caps: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: MUTED }

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', color: INK, maxWidth: 760 }} aria-label="Report">
      <div className="flex items-start gap-3" style={{ padding: '20px 22px 16px' }}>
        <div className="min-w-0 flex-1">
          {report.eyebrow && <div style={caps}>{report.eyebrow}</div>}
          <div style={{ fontFamily: HEAD, fontSize: 22, fontWeight: 800, lineHeight: 1.2, marginTop: 4 }}>{report.headline}</div>
          {when && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>{when}</div>}
        </div>
        {report.badge && (
          <span className="inline-flex items-center gap-1" style={{ background: '#FFF3D6', color: '#8A5A00', borderRadius: 999, padding: '4px 11px', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
            <AlertCircle size={13} /> {report.badge}
          </span>
        )}
      </div>

      {report.kpis.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4" style={{ borderTop: `1px solid ${LINE}` }}>
          {report.kpis.map((k, i) => (
            <div key={i} style={{ padding: '14px 22px', borderLeft: i % 4 ? `1px solid ${LINE}` : undefined }}>
              <div style={caps}>{k.label}</div>
              <div style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 800, marginTop: 4 }}>{big(k)}</div>
              {(k.sub || (k.format === 'number' || !k.format) && Math.abs(k.value) >= 1e4) && (
                <div style={{ fontSize: 12, color: MUTED }}>{k.sub || k.value.toLocaleString()}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {b && (
        <div style={section}>
          <div style={caps}>{b.title}{shareCol != null ? ` · share of ${b.columns[shareCol].toLowerCase()}` : ''}</div>
          {shareCol != null && shareTotal > 0 && (
            <div className="flex" style={{ height: 10, borderRadius: 999, overflow: 'hidden', marginTop: 10, gap: 2 }}>
              {b.rows.map((r, i) => <div key={i} title={r.label} style={{ width: `${pct(r.values[shareCol], shareTotal)}%`, background: SHADES[i % SHADES.length] }} />)}
            </div>
          )}
          <div className="overflow-x-auto" style={{ marginTop: 8 }}>
            <table className="w-full" style={{ fontSize: 13.5, borderCollapse: 'collapse', minWidth: 420 }}>
              <thead>
                <tr style={{ color: MUTED, fontSize: 12.5 }}>
                  <th style={{ textAlign: 'left', fontWeight: 500, padding: '6px 8px' }}>{''}</th>
                  {b.columns.map((c) => <th key={c} style={{ textAlign: 'right', fontWeight: 500, padding: '6px 8px' }}>{c}</th>)}
                  {shareCol != null && <th style={{ textAlign: 'right', fontWeight: 500, padding: '6px 8px' }}>Share</th>}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i} style={{ background: i === 0 && r.tag ? '#F6F4FB' : undefined }}>
                    <td style={{ padding: '9px 8px', fontWeight: 600 }}>
                      <span className="inline-flex items-center gap-2">
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: SHADES[i % SHADES.length] }} />
                        {r.label}
                        {r.tag && <span style={{ fontSize: 11.5, fontWeight: 700, background: '#FFEDE5', color: '#C2410C', borderRadius: 999, padding: '1px 8px' }}>{r.tag}</span>}
                      </span>
                    </td>
                    {r.values.map((v, j) => <td key={j} style={{ padding: '9px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</td>)}
                    {shareCol != null && <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700 }}>{pctLabel(pct(r.values[shareCol], shareTotal))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(report.callout || report.actions.length > 0) && (
        <div style={section}>
          {report.actions.length > 0 && <div style={caps}>What to do</div>}
          {report.callout && (
            <div style={{ background: '#EFEBFB', borderRadius: 12, padding: '12px 14px', fontSize: 14.5, fontWeight: 600, marginTop: report.actions.length ? 10 : 0 }}>{report.callout}</div>
          )}
          {report.actions.map((a, i) => {
            const hasBar = a.value != null && a.of != null && a.of > 0
            const p = hasBar ? pct(a.value!, a.of!) : 0
            return (
              <div key={i} className="flex items-start gap-3" style={{ padding: '12px 0', borderTop: i ? `1px solid ${LINE}` : undefined, marginTop: i ? 0 : 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 999, background: PURPLE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, flex: '0 0 auto' }}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{a.title}</div>
                  {a.detail && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{a.detail}</div>}
                </div>
                {hasBar && (
                  <div style={{ width: 150, flex: '0 0 auto', textAlign: 'right' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>{pctLabel(p)} {a.label || ''}</div>
                    <div style={{ height: 6, borderRadius: 999, background: '#ECE8F5', marginTop: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${p}%`, height: '100%', background: PURPLE }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {report.footnote && (
        <div className="flex gap-2" style={{ ...section, fontSize: 12, color: MUTED }}>
          <Info size={14} style={{ flex: '0 0 auto', marginTop: 1 }} /> {report.footnote}
        </div>
      )}
    </div>
  )
}
