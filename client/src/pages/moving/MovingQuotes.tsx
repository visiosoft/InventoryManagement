import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Search, FileText, ArrowRight, Plus, Trash2 } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { MovingQuote, MovingQuoteStatus } from '../../lib/types'
import { Badge, Button, Modal, Spinner } from '../../components/ui'
import { formatDate } from '../../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const STATUSES: { value: MovingQuoteStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
]

const statusTone: Record<MovingQuoteStatus, string> = {
  draft: 'gray', sent: 'blue', accepted: 'green', rejected: 'red', expired: 'yellow',
}

const statusDot: Record<string, string> = {
  draft: '#94A3B8', sent: '#3B82F6', accepted: '#10B981', rejected: '#EF4444', expired: '#F59E0B',
}

function fmtAed(n: number) {
  return `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function MovingQuotes() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filterStatus, setFilterStatus] = useState<MovingQuoteStatus | ''>('')
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [custSearch, setCustSearch] = useState('')

  const { data: allQuotes = [], isLoading } = useQuery<MovingQuote[]>({
    queryKey: ['moving-quotes'],
    queryFn: () => api.get('/moving-quotes').then(r => r.data),
  })

  const { data: customers = [] } = useQuery<Array<{ _id: string; fullName: string; phone?: string }>>({
    queryKey: ['customers-list'],
    queryFn: () => api.get('/customers').then(r => r.data),
    enabled: showNew,
  })

  const counts = STATUSES.slice(1).reduce((acc, s) => {
    acc[s.value as string] = allQuotes.filter(q => q.status === s.value).length
    return acc
  }, {} as Record<string, number>)

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/moving-quotes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-quotes'] }); setDeleteId(null) },
    onError: (e) => setErr(apiError(e)),
  })

  const createMut = useMutation({
    mutationFn: (customerId: string) => api.post('/moving-quotes', {
      customer: customerId,
      items: [{ description: '', qty: 1, rate: 0, amount: 0 }],
      subTotal: 0, total: 0,
    }).then(r => r.data),
    onSuccess: (quote) => { qc.invalidateQueries({ queryKey: ['moving-quotes'] }); navigate(`/moving/quotes/${quote._id}`) },
    onError: (e) => setErr(apiError(e)),
  })

  const filtered = allQuotes.filter(q => {
    const matchStatus = !filterStatus || q.status === filterStatus
    const matchSearch = !search ||
      q.quoteNo.toLowerCase().includes(search.toLowerCase()) ||
      q.customer?.fullName?.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const filteredCustomers = customers.filter(c =>
    !custSearch || c.fullName?.toLowerCase().includes(custSearch.toLowerCase()) || c.phone?.includes(custSearch)
  )

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Moving Quotes</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{allQuotes.length} quotes total</div>
        </div>
        <Button onClick={() => setShowNew(true)} className="gap-1.5">
          <Plus size={15} /> New Quote
        </Button>
      </div>

      {/* Search + status pills */}
      <div className="flex flex-col gap-2.5 mb-5">
        <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3">
          <Search size={16} color={MUTED} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by quote number or customer…"
            style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: INK }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map(s => {
            const count = s.value === '' ? allQuotes.length : (counts[s.value as string] ?? 0)
            const active = filterStatus === s.value
            return (
              <button
                key={s.value}
                onClick={() => setFilterStatus(s.value)}
                style={{
                  height: 36, borderRadius: 10,
                  background: active ? PURPLE : '#F3F0EA',
                  color: active ? 'white' : MUTED,
                  fontSize: 13, fontWeight: 600, padding: '0 12px', border: 'none',
                }}
                className="flex items-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {s.value && <span style={{ width: 6, height: 6, borderRadius: 3, background: active ? 'white' : statusDot[s.value as string] }} />}
                {s.label}
                <span style={{ fontSize: 11, opacity: 0.7 }}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <FileText size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>No quotes found</div>
          <div style={{ fontSize: 13, color: MUTED }}>
            {search ? 'Try a different search term' : 'No quotes match the selected filter'}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filtered.map(q => (
              <Link key={q._id} to={`/moving/quotes/${q._id}`}
                style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16 }}
                className="block hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{q.quoteNo}</span>
                      <Badge tone={statusTone[q.status]} className="text-xs py-0 h-4">{q.status}</Badge>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>{q.customer?.fullName}</div>
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ fontSize: 12, color: MUTED }}>{formatDate(q.quoteDate)}</span>
                      <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>AED {q.total.toLocaleString()}</div>
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: MUTED, flexShrink: 0, marginTop: 2 }} />
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    {['Quote No', 'Customer', 'Job', 'Date', 'Expiry', 'Total', 'Status', ''].map((h, i) => (
                      <th key={h || i} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: h === 'Total' ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(q => (
                    <tr key={q._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                      <td style={{ padding: '14px 16px' }}>
                        <Link to={`/moving/quotes/${q._id}`} style={{ fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }} className="hover:opacity-80 transition-opacity">
                          {q.quoteNo}
                        </Link>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: INK }}>{q.customer?.fullName}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13 }}>
                        {q.job
                          ? <Link to={`/moving/jobs/${(q.job as any)._id}`} style={{ color: PURPLE, fontFamily: 'monospace' }} className="hover:opacity-80">{(q.job as any).jobNo}</Link>
                          : <span style={{ color: MUTED }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, whiteSpace: 'nowrap' }}>{formatDate(q.quoteDate)}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, whiteSpace: 'nowrap' }}>{q.expiryDate ? formatDate(q.expiryDate) : '—'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(q.total)}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <Badge tone={statusTone[q.status]} className="text-xs">{q.status}</Badge>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/moving/quotes/${q._id}`} className="p-1 transition-colors hover:opacity-70" style={{ color: MUTED }}>
                            <ArrowRight size={14} />
                          </Link>
                          {isAdmin && (
                            <button onClick={() => setDeleteId(q._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 12, color: MUTED, textAlign: 'right', marginTop: 12 }}>{filtered.length} quote{filtered.length !== 1 ? 's' : ''}</div>
        </>
      )}

      {/* Delete modal */}
      <Modal open={!!deleteId} title="Delete Quote" onClose={() => setDeleteId(null)}>
        <div className="space-y-4">
          <p className="text-sm">Are you sure you want to delete this quote? This action cannot be undone.</p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Quote'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* New Quote modal — select customer */}
      <Modal open={showNew} title="New Moving Quote" onClose={() => { setShowNew(false); setCustSearch('') }}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Select a customer to create a new quote for:</p>
          <div style={{ height: 36, borderRadius: 8, background: '#F3F0EA' }} className="flex items-center gap-2 px-3">
            <Search size={14} color={MUTED} />
            <input
              value={custSearch}
              onChange={e => setCustSearch(e.target.value)}
              placeholder="Search customers…"
              style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 13, color: INK }}
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {filteredCustomers.slice(0, 20).map(c => (
              <button
                key={c._id}
                onClick={() => createMut.mutate(c._id)}
                disabled={createMut.isPending}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-medium">{c.fullName}</div>
                  {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                </div>
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            ))}
            {filteredCustomers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No customers found</p>
            )}
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
      </Modal>
    </div>
  )
}
