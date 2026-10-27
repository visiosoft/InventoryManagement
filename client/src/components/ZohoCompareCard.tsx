import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, RefreshCw } from 'lucide-react'
import { api, apiError } from '../lib/api'

/**
 * The CRM's customers beside Zoho Books' contacts. Zoho invoices reach a
 * customer here only through the same email or phone, so every row that is
 * not "Matched" is someone whose invoices the CRM cannot see — with what to
 * change to fix it.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"

type Status = 'matched' | 'conflict' | 'name_only' | 'crm_only' | 'no_details' | 'zoho_only'
type Row = {
  status: Status; crmName: string; crmEmail: string; crmPhone: string
  zohoName?: string; zohoEmail?: string; zohoPhone?: string; outstanding?: number; matchedBy?: string; note: string
}
type Data = { configured: boolean; error?: string; crmCount: number; zohoCount: number; labels: Record<Status, string>; counts: Record<Status, number>; rows: Row[] }

const TONE: Record<Status, { bg: string; fg: string }> = {
  matched: { bg: '#DCFCE7', fg: '#15803D' },
  conflict: { bg: '#FEE2E2', fg: '#B91C1C' },
  name_only: { bg: '#FFF3D6', fg: '#8A5A00' },
  crm_only: { bg: '#FFF3D6', fg: '#8A5A00' },
  no_details: { bg: '#F3F4F6', fg: '#4B5563' },
  zoho_only: { bg: '#E8F0FC', fg: '#1E4E99' },
}
const ORDER: Status[] = ['conflict', 'name_only', 'crm_only', 'no_details', 'zoho_only', 'matched']

export default function ZohoCompareCard() {
  const [filter, setFilter] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const { data, isFetching, refetch } = useQuery<Data>({
    queryKey: ['zoho-compare'],
    queryFn: () => api.get('/accounts-dashboard/zoho-compare').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  if (!data?.configured && data) return null

  async function download() {
    try {
      const res = await api.get('/accounts-dashboard/zoho-compare', { params: { format: 'excel' }, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `crm-zoho-check-${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setErr(apiError(e))
    }
  }

  const problems = data ? ORDER.filter((s) => s !== 'matched').reduce((n, s) => n + (s === 'zoho_only' ? 0 : data.counts[s]), 0) : 0
  const rows = (data?.rows ?? []).filter((r) => (filter ? r.status === filter : r.status !== 'matched'))
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px' }} aria-label="CRM and Zoho check">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: INK }}>CRM and Zoho Books — contact check</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>
            {data ? `${data.crmCount} customers with contracts · ${data.zohoCount} Zoho contacts · ${problems} can’t be matched, so their Zoho invoices don’t show here` : 'Comparing…'}
          </div>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-1.5 cursor-pointer"
          style={{ fontSize: 12.5, fontWeight: 700, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 9, padding: '7px 12px' }}>
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
        <button type="button" onClick={download} className="inline-flex items-center gap-1.5 cursor-pointer"
          style={{ fontSize: 12.5, fontWeight: 700, border: 0, background: '#107C41', color: '#fff', borderRadius: 9, padding: '7px 12px' }}>
          <FileSpreadsheet size={13} /> Excel
        </button>
      </div>
      {(err || data?.error) && <div style={{ fontSize: 12.5, color: '#B91C1C', marginTop: 8 }}>{err || data?.error}</div>}

      {data?.counts && (
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 12 }}>
          {ORDER.map((s) => (
            <button key={s} type="button" onClick={() => setFilter(filter === s ? null : s)} className="cursor-pointer"
              style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '4px 11px', border: `1px solid ${filter === s ? PURPLE : 'transparent'}`, background: TONE[s].bg, color: TONE[s].fg }}>
              {data.counts[s]} · {data.labels[s]}
            </button>
          ))}
        </div>
      )}

      {data?.rows && (
        <div className="overflow-x-auto" style={{ marginTop: 12, maxHeight: 420, overflowY: 'auto' }}>
          <table className="w-full" style={{ fontSize: 12.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: MUTED, textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>CRM</th><th style={{ padding: '6px 8px' }}>Zoho Books</th><th style={{ padding: '6px 8px' }}>What to do</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${LINE}`, verticalAlign: 'top' }}>
                  <td style={{ padding: '7px 8px' }}>
                    {r.crmName ? <><div style={{ fontWeight: 600, color: INK }}>{r.crmName}</div><div style={{ color: MUTED }}>{[r.crmEmail, r.crmPhone].filter(Boolean).join(' · ') || '—'}</div></> : <span style={{ color: MUTED }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    {r.zohoName ? <><div style={{ fontWeight: 600, color: INK }}>{r.zohoName}{r.outstanding ? <span style={{ color: '#B91C1C' }}> · owes {r.outstanding.toLocaleString()}</span> : null}</div><div style={{ color: MUTED }}>{[r.zohoEmail, r.zohoPhone].filter(Boolean).join(' · ') || '—'}</div></> : <span style={{ color: MUTED }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: TONE[r.status].bg, color: TONE[r.status].fg, whiteSpace: 'nowrap' }}>{data.labels[r.status]}</span>
                    {r.note && <div style={{ color: MUTED, marginTop: 3 }}>{r.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div style={{ fontSize: 13, color: MUTED, padding: '10px 8px' }}>Nothing here.</div>}
        </div>
      )}
    </div>
  )
}
