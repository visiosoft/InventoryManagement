import { Fragment, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ChevronsUpDown, Mail, Paperclip, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Contract } from '../lib/types'
import EmailCustomersModal from './customers/EmailCustomersModal'
import { Button, EmptyState, Modal, Spinner, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', serif", letterSpacing: '-0.02em' } as const
const PAGE_BG = '#FBF8F2'
const INK = '#14081F'
const MUTED_COLOR = '#756E80'
const SECOND = '#4A4357'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,0.10)'
const FIELD_LINE = 'rgba(20,8,31,0.14)'
const CHIP_BG = '#F3F0EA'

// checkbox | Contract | Customer | Unit(s) | Amount | Owes | Start | End |
// Days left | Status | Renewal | delete
//
// Twelve cells per row, so twelve tracks. Miscounting wraps the delete button
// onto a line of its own, which is how the mockup's nine went wrong.
const GRID = '40px 1.2fr 1.5fr 0.85fr 0.95fr 0.9fr 0.95fr 0.95fr 0.85fr 0.85fr 0.85fr minmax(60px, auto)'

const STATUSES = ['draft', 'pending_signature', 'active', 'ended', 'cancelled']
type PagedContracts = { data: Contract[]; total: number; page: number; pages: number; limit: number }

// Pill palette per status — active is the mockup's green, the rest get their
// own tone so a glance separates a signed contract from a dead one.
const STATUS_PILL: Record<string, { bg: string; fg: string; dot: string }> = {
  active: { bg: '#EAF7EE', fg: '#1D8A46', dot: '#22c55e' },
  draft: { bg: '#F3F0EA', fg: '#6B6478', dot: '#A79EB3' },
  pending_signature: { bg: '#FFF3DF', fg: '#946200', dot: '#F59E0B' },
  ended: { bg: '#EDF0F6', fg: '#4A5568', dot: '#94A3B8' },
  cancelled: { bg: '#FDEEEE', fg: '#C0392B', dot: '#EF4444' },
}

const CSS = `
.ctr-row:hover { background: #F7F3FF; }
.ctr-link:hover { text-decoration: underline; }
.ctr-del:hover { background: #FDEEEE; color: #C0392B; }
.ctr-ghost:hover { background: #F7F3FF; }
.ctr-page-btn:not(:disabled):hover { filter: brightness(0.96); }
`

const fieldBase: React.CSSProperties = {
  height: 44,
  borderRadius: 12,
  border: `1px solid ${FIELD_LINE}`,
  background: '#fff',
  color: INK,
  fontSize: 13,
  padding: '0 12px',
  outline: 'none',
}

type SortCol = 'contract' | 'customer' | 'units' | 'amount' | 'start' | 'end' | 'daysleft' | 'status' | 'renewal'

// Which server sort each column maps to. The list is paginated, so a
// client-side sort would only reorder the page you happen to be on — these go
// through the API instead. Columns the API cannot sort (customer, units,
// status, renewal) are absent and sort the loaded page only, which the tooltip
// says out loud rather than pretending otherwise.
const SERVER_SORT: Partial<Record<SortCol, [string, string]>> = {
  contract: ['newest', 'oldest'],
  amount: ['rate_desc', 'rate_asc'],
  start: ['start_asc', 'start_desc'],
  end: ['end_asc', 'end_desc'],
  // Fewest days left first == soonest end date first.
  daysleft: ['end_asc', 'end_desc'],
}

function SortHead({ label, col, sort, onSort }: {
  label: string; col: SortCol; sort: string; onSort: (s: string) => void
}) {
  const pair = SERVER_SORT[col]
  const active = pair ? pair.indexOf(sort) : -1
  const serverBacked = Boolean(pair)
  return (
    <div style={headCell}>
      <button
        type="button"
        onClick={() => { if (pair) onSort(active === 0 ? pair[1] : pair[0]) }}
        disabled={!serverBacked}
        title={serverBacked
          ? `Sort by ${label.toLowerCase()}`
          : `${label} cannot be sorted — the list is paginated and the server has no sort for this column`}
        className={serverBacked ? 'inline-flex items-center gap-1 cursor-pointer hover:opacity-70 transition-opacity' : 'inline-flex items-center gap-1 cursor-not-allowed opacity-60'}
        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
      >
        {label}
        {active === 0 ? <ArrowUp size={11} /> : active === 1 ? <ArrowDown size={11} /> : serverBacked ? <ChevronsUpDown size={11} style={{ opacity: 0.35 }} /> : null}
      </button>
    </div>
  )
}

const headCell: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: MUTED_COLOR,
}

export default function Contracts() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [emailing, setEmailing] = useState(false)
  // ?search= lets other screens link straight to a filtered list
  const [urlParams] = useSearchParams()

  const [search, setSearch] = useState(urlParams.get('search') || '')
  const [status, setStatus] = useState('')
  const [billing, setBilling] = useState('')
  const [floor, setFloor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [showArchived, setShowArchived] = useState(false)
  const [sort, setSort] = useState('newest')
  const [groupBy, setGroupBy] = useState<'none' | 'status' | 'payment' | 'floor' | 'billing'>('none')
  const [moreOpen, setMoreOpen] = useState(false)

  // Reset to page 1 when any filter changes
  useEffect(() => { setPage(1) }, [search, status, billing, floor, from, to, limit, showArchived, sort])

  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [selectedContractIds, setSelectedContractIds] = useState<string[]>([])

  const params = { search: search || undefined, status: status || undefined, billing: billing || undefined, floor: floor || undefined, from: from || undefined, to: to || undefined, page, limit, archived: showArchived ? 'true' : undefined, sort }

  const { data, isLoading } = useQuery<PagedContracts>({
    queryKey: ['contracts', params],
    queryFn: () => api.get('/contracts', { params }).then((r) => r.data),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })

  const contracts = data?.data ?? []
  const hasFilters = search || status || billing || floor || from || to

  // Full contract value: scheduled payments total from the server, or rate × term fallback
  const contractValue = (c: Contract) => {
    if (c.contractAmount) return c.contractAmount
    if (c.totalAmount) return c.totalAmount
    if (c.startDate && c.endDate && c.rate) {
      const days = Math.max(0, (new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000)
      const periods = c.billingPeriod === 'weekly' ? Math.ceil(days / 7) : Math.ceil(days / 28)
      return Math.round(periods * c.rate * 100) / 100
    }
    return 0
  }

  // Group the current page's rows for display
  const PAYMENT_LABELS: Record<string, string> = { paid: 'Fully paid', partial: 'Partially paid', unpaid: 'Unpaid', no_invoice: 'No invoice' }
  const groups = (() => {
    if (groupBy === 'none') return [{ label: '', items: contracts }]
    const keyOf = (c: Contract) =>
      groupBy === 'status' ? statusLabel(c.status)
        : groupBy === 'payment' ? PAYMENT_LABELS[c.paymentStatus ?? 'no_invoice']
          : groupBy === 'floor' ? (c.unit?.floor ? `Floor ${c.unit.floor}` : 'No floor')
            : c.billingPeriod === 'weekly' ? 'Weekly billing' : 'Monthly billing'
    const map = new Map<string, Contract[]>()
    for (const c of contracts) {
      const k = keyOf(c)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(c)
    }
    return [...map.entries()].map(([label, items]) => ({ label, items }))
  })()
  const clearFilters = () => {
    setSearch(''); setStatus(''); setBilling(''); setFloor(''); setFrom(''); setTo('')
  }

  const deleteContract = useMutation({
    mutationFn: (id: string) => api.delete(`/contracts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] })
      setSelectedContractIds((prev) => prev.filter((id) => id !== deleteTarget?._id))
      setDeleteTarget(null)
      setDeleteError('')
    },
    onError: (e) => setDeleteError(apiError(e)),
  })

  const deleteManyContracts = useMutation({
    mutationFn: (ids: string[]) => api.post('/contracts/bulk-delete', { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] })
      setSelectedContractIds([])
      setDeleteError('')
    },
    onError: (e) => setDeleteError(apiError(e)),
  })

  const archiveContract = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.patch(`/contracts/${id}/archive`, { archived }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] })
      setDeleteTarget(null)
      setDeleteError('')
    },
    onError: (e) => setDeleteError(apiError(e)),
  })

  const visibleContractIds = contracts.map((c) => c._id)
  const allVisibleSelected = visibleContractIds.length > 0 && visibleContractIds.every((id) => selectedContractIds.includes(id))

  function toggleContractSelection(contractId: string) {
    setSelectedContractIds((prev) => (
      prev.includes(contractId)
        ? prev.filter((id) => id !== contractId)
        : [...prev, contractId]
    ))
  }

  function toggleAllVisibleContracts() {
    setSelectedContractIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleContractIds.includes(id))
      }

      return Array.from(new Set([...prev, ...visibleContractIds]))
    })
  }

  function confirmBulkDelete() {
    if (!selectedContractIds.length) return
    setDeleteError('')
    if (window.confirm(`Delete ${selectedContractIds.length} selected contract${selectedContractIds.length > 1 ? 's' : ''}?`)) {
      deleteManyContracts.mutate(selectedContractIds)
    }
  }

  const totalPages = data?.pages ?? 1
  const canPrev = page > 1
  const canNext = page < totalPages

  // No outer padding here: the app layout already wraps every page in
  // p-3 sm:p-4, and adding 40px on top left a very wide gutter.
  return (
    <div style={{ background: PAGE_BG, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK }}>
      <style>{CSS}</style>

      <div
        style={{
          maxWidth: 1400,
          margin: '0 auto',
          background: '#fff',
          border: `1px solid ${LINE}`,
          borderRadius: 28,
          boxShadow: '0 8px 24px rgba(20,8,31,.08), 0 2px 6px rgba(20,8,31,.04)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────── */}
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{ padding: '36px 40px 28px', borderBottom: `1px solid ${LINE}` }}
        >
          <div>
            <h1 style={{ ...HEADING, color: INK, fontSize: 32, fontWeight: 700, lineHeight: 1.15, margin: 0 }}>
              Tenants
            </h1>
            <p style={{ color: MUTED_COLOR, fontSize: 14, marginTop: 6 }}>
              {data ? `${data.total} tenant${data.total !== 1 ? 's' : ''}${hasFilters ? ' (filtered)' : ''}` : ' '}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedContractIds.length > 0 && (
              <button
                onClick={confirmBulkDelete}
                disabled={deleteManyContracts.isPending}
                className="ctr-page-btn"
                style={{
                  height: 48,
                  padding: '0 22px',
                  background: '#DC2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  opacity: deleteManyContracts.isPending ? 0.6 : 1,
                }}
              >
                {deleteManyContracts.isPending ? 'Deleting…' : `Delete selected (${selectedContractIds.length})`}
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setEmailing(true)}
                className="ctr-page-btn"
                style={{
                  height: 48,
                  padding: '0 22px',
                  background: PURPLE,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Mail size={16} /> Email tenants
              </button>
            )}
          </div>
        </div>

        {/* ── Filter bar ───────────────────────────────────────────── */}
        <div style={{ padding: '22px 40px', background: PAGE_BG, borderBottom: `1px solid ${LINE}` }}>
          <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
            <div style={{ position: 'relative', flex: '1 1 260px' }}>
              <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: MUTED_COLOR }} />
              <input
                placeholder="Customer, unit, contract #…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...fieldBase, width: '100%', paddingLeft: 40, paddingRight: 12 }}
              />
            </div>

            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...fieldBase, cursor: 'pointer', minWidth: 150 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>

            <select value={floor} onChange={(e) => setFloor(e.target.value)} style={{ ...fieldBase, cursor: 'pointer', minWidth: 130 }}>
              <option value="">All floors</option>
              <option value="F1">Floor F1</option>
              <option value="F2">Floor F2</option>
              <option value="F3">Floor F3</option>
              <option value="Shed">Shed</option>
            </select>

            <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...fieldBase, cursor: 'pointer', minWidth: 170 }}>
              <option value="newest">Sort: Newest first</option>
              <option value="oldest">Sort: Oldest first</option>
              <option value="start_asc">Sort: Start date ↑</option>
              <option value="start_desc">Sort: Start date ↓</option>
              <option value="end_asc">Sort: End date ↑</option>
              <option value="end_desc">Sort: End date ↓</option>
              <option value="rate_desc">Sort: Rate high → low</option>
              <option value="rate_asc">Sort: Rate low → high</option>
            </select>

            <button
              onClick={() => setMoreOpen((v) => !v)}
              className="ctr-ghost"
              aria-expanded={moreOpen}
              style={{
                ...fieldBase,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '0 16px',
              }}
            >
              <SlidersHorizontal size={15} /> More filters
              {moreOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
          </div>

          {moreOpen && (
            <div
              className="flex flex-wrap items-end"
              style={{ gap: 12, marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${FIELD_LINE}` }}
            >
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} style={{ ...fieldBase, cursor: 'pointer', minWidth: 170 }}>
                <option value="none">Group: None</option>
                <option value="status">Group: Status</option>
                <option value="payment">Group: Payment</option>
                <option value="floor">Group: Floor</option>
                <option value="billing">Group: Billing</option>
              </select>

              <select value={billing} onChange={(e) => setBilling(e.target.value)} style={{ ...fieldBase, cursor: 'pointer', minWidth: 160 }}>
                <option value="">All billing periods</option>
                <option value="weekly">Weekly billing</option>
                <option value="monthly">Monthly billing</option>
              </select>

              <div>
                <p style={{ fontSize: 11, color: MUTED_COLOR, marginBottom: 4 }}>Start from</p>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...fieldBase, width: 160 }} />
              </div>
              <div>
                <p style={{ fontSize: 11, color: MUTED_COLOR, marginBottom: 4 }}>to</p>
                <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={{ ...fieldBase, width: 160 }} />
              </div>

              <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...fieldBase, cursor: 'pointer', minWidth: 140 }}>
                {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} per page</option>)}
              </select>

              <label className="flex items-center gap-2" style={{ fontSize: 13, color: SECOND, height: 44, cursor: 'pointer' }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Archived &amp; ended
              </label>

              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="ctr-ghost"
                  style={{ ...fieldBase, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '0 16px' }}
                >
                  <X size={14} /> Clear
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Table ────────────────────────────────────────────────── */}
        <div style={{ borderBottom: `1px solid ${LINE}` }}>
          {deleteError && (
            <p style={{ padding: '14px 40px 0', fontSize: 12, color: '#C0392B' }}>{deleteError}</p>
          )}

          {isLoading ? (
            <div style={{ padding: 40 }}><Spinner /></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 1200 }}>
                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 40px', height: 48, borderBottom: `1px solid ${LINE}` }}>
                  <div style={{ ...headCell }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisibleContracts}
                      aria-label="Select all contracts"
                    />
                  </div>
                  <SortHead label="Contract" col="contract" sort={sort} onSort={setSort} />
                  <SortHead label="Customer" col="customer" sort={sort} onSort={setSort} />
                  <SortHead label="Unit(s)" col="units" sort={sort} onSort={setSort} />
                  <SortHead label="Amount" col="amount" sort={sort} onSort={setSort} />
                  <div style={headCell}>Owes</div>
                  <SortHead label="Start" col="start" sort={sort} onSort={setSort} />
                  <SortHead label="End" col="end" sort={sort} onSort={setSort} />
                  <SortHead label="Days left" col="daysleft" sort={sort} onSort={setSort} />
                  <SortHead label="Status" col="status" sort={sort} onSort={setSort} />
                  <SortHead label="Renewal" col="renewal" sort={sort} onSort={setSort} />
                  <div style={headCell} />
                </div>

                {groups.map((g) => (
                  <Fragment key={g.label || 'all'}>
                    {g.label && (
                      <div style={{ background: '#F7F3FF', padding: '8px 40px', fontSize: 12, fontWeight: 700, color: '#4A1FA0', borderBottom: '1px solid rgba(20,8,31,0.07)' }}>
                        {g.label} <span style={{ opacity: .6, fontWeight: 600 }}>· {g.items.length}</span>
                      </div>
                    )}
                    {g.items.map((c) => {
                      const allUnits = c.units?.length ? c.units : c.unit ? [c.unit] : []
                      const pill = STATUS_PILL[c.status] ?? STATUS_PILL.draft
                      const value = contractValue(c)
                      return (
                        <div
                          key={c._id}
                          className="ctr-row"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: GRID,
                            padding: '0 40px',
                            minHeight: 76,
                            alignItems: 'center',
                            borderBottom: '1px solid rgba(20,8,31,0.07)',
                            transition: 'background .12s ease',
                          }}
                        >
                          <div>
                            <input
                              type="checkbox"
                              checked={selectedContractIds.includes(c._id)}
                              onChange={() => toggleContractSelection(c._id)}
                              aria-label={`Select contract ${c.contractNo}`}
                            />
                          </div>

                          <div>
                            <Link
                              to={`/contracts/${c._id}`}
                              className="ctr-link"
                              style={{ color: PURPLE, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}
                            >
                              {c.contractNo}
                            </Link>
                            {typeof c.documentCount === 'number' && (
                              <span
                                title={c.documentCount > 0
                                  ? `${c.documentCount} document${c.documentCount !== 1 ? 's' : ''} attached`
                                  : 'No documents attached'}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 2,
                                  marginLeft: 8,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: c.documentCount > 0 ? '#EAF7EF' : '#FDECEC',
                                  color: c.documentCount > 0 ? '#1B7A4B' : '#B3261E',
                                  verticalAlign: 'middle',
                                }}
                              >
                                <Paperclip size={9} />{c.documentCount}
                              </span>
                            )}
                          </div>

                          <div style={{ fontWeight: 600, fontSize: 14, color: INK }}>
                            {c.customer ? c.customer.fullName : '—'}
                          </div>

                          <div style={{ color: SECOND, fontSize: 13 }}>
                            {allUnits.length === 0 ? '—' : allUnits.length === 1 ? (
                              <span>
                                {c.unit?.unitNumber ?? allUnits[0]?.unitNumber}
                                {c.unit?.sizeSqf != null && (
                                  <span style={{ color: MUTED_COLOR, fontSize: 11 }}> ({c.unit.sizeSqf} sqf)</span>
                                )}
                              </span>
                            ) : (
                              <span className="flex flex-wrap" style={{ gap: 4 }}>
                                {allUnits.map((u) => (
                                  <span key={u._id} style={{ background: CHIP_BG, borderRadius: 6, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}>
                                    {u.unitNumber}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>

                          <div
                            style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums', color: INK }}
                            title={`${c.billingPeriod === 'weekly' ? 'Weekly' : 'Monthly'} billing · rate ${formatMoney(c.rate)}${
                              c.paymentStatus ? ` · ${PAYMENT_LABELS[c.paymentStatus]}` : ''
                            }${c.overdueCount ? ` · ${c.overdueCount} overdue` : ''}`}
                          >
                            {value ? formatMoney(value) : '—'}
                          </div>

                          {/* Outstanding in Zoho Books for this tenant. Blank
                              means nothing owed, or that we could not match
                              them on email or phone — the Tenants list says how
                              many balances went unclaimed. */}
                          <div style={{ fontSize: 13 }}>
                            {Number(c.outstanding) > 0 ? (
                              <span
                                className="inline-flex rounded-full px-2 py-0.5 whitespace-nowrap"
                                style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                                title="Unpaid balance in Zoho Books"
                              >
                                {formatMoney(Number(c.outstanding))}
                              </span>
                            ) : <span style={{ color: SECOND }}>—</span>}
                          </div>

                          <div style={{ color: SECOND, fontSize: 13 }}>{formatDate(c.startDate)}</div>
                          <div style={{ color: SECOND, fontSize: 13 }}>{formatDate(c.endDate)}</div>

                          {/* Days left — the number staff actually chase.
                              Derived from the end date, so sorting by it is
                              the same server sort as End. */}
                          <div style={{ fontSize: 13 }}>
                            {(() => {
                              if (!c.endDate || !['active', 'pending_signature'].includes(c.status)) {
                                return <span style={{ color: MUTED_COLOR }}>—</span>
                              }
                              const days = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                              if (days < 0) return <span style={{ color: '#C0392B', fontWeight: 700 }}>{Math.abs(days)}d over</span>
                              if (days === 0) return <span style={{ color: '#C0392B', fontWeight: 700 }}>today</span>
                              return (
                                <span style={{ color: days <= 7 ? '#C0392B' : days <= 30 ? '#946200' : SECOND, fontWeight: days <= 30 ? 700 : 400 }}>
                                  {days}d
                                </span>
                              )
                            })()}
                          </div>

                          <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                background: pill.bg,
                                color: pill.fg,
                                borderRadius: 999,
                                padding: '4px 10px',
                                fontSize: 12,
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: 999, background: pill.dot }} />
                              {statusLabel(c.status)}
                            </span>
                            {c.archived && (
                              <span style={{ background: CHIP_BG, color: MUTED_COLOR, borderRadius: 999, padding: '4px 8px', fontSize: 11, fontWeight: 600 }}>
                                Archived
                              </span>
                            )}
                          </div>

                          <div>
                            {c.status === 'active' ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  background: CHIP_BG,
                                  color: MUTED_COLOR,
                                  borderRadius: 999,
                                  padding: '4px 10px',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {c.renewalIntent === 'renewing' ? 'Renewing' : c.renewalIntent === 'not_renewing' ? 'Not renewing' : 'Undecided'}
                              </span>
                            ) : (
                              <span style={{ color: MUTED_COLOR, fontSize: 12 }}>—</span>
                            )}
                          </div>

                          <div className="flex items-center justify-end" style={{ gap: 4 }}>
                            {c.archived && (
                              <button
                                onClick={() => archiveContract.mutate({ id: c._id, archived: false })}
                                disabled={archiveContract.isPending}
                                className="ctr-ghost"
                                title="Unarchive contract"
                                style={{ background: 'transparent', border: 'none', borderRadius: 8, padding: '4px 6px', fontSize: 11, color: MUTED_COLOR, cursor: 'pointer' }}
                              >
                                Unarchive
                              </button>
                            )}
                            <button
                              onClick={() => { setDeleteTarget(c); setDeleteError('') }}
                              className="ctr-del"
                              title="Delete contract"
                              style={{
                                width: 36,
                                height: 36,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 10,
                                border: 'none',
                                background: 'transparent',
                                color: MUTED_COLOR,
                                cursor: 'pointer',
                                transition: 'background .12s ease, color .12s ease',
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          )}

          {!isLoading && contracts.length === 0 && (
            <EmptyState message={hasFilters ? 'No contracts match the filters.' : 'No contracts yet. Create your first contract.'} />
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between" style={{ padding: '20px 40px', gap: 12 }}>
          <span style={{ fontSize: 13, color: MUTED_COLOR }}>
            Showing {contracts.length} of {data?.total ?? 0}
          </span>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              onClick={() => canPrev && setPage(page - 1)}
              disabled={!canPrev}
              className="ctr-page-btn"
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 10,
                border: `1px solid ${FIELD_LINE}`,
                background: '#fff',
                color: INK,
                fontSize: 13,
                fontWeight: 600,
                cursor: canPrev ? 'pointer' : 'not-allowed',
                opacity: canPrev ? 1 : 0.45,
              }}
            >
              Previous
            </button>
            <button
              onClick={() => canNext && setPage(page + 1)}
              disabled={!canNext}
              className="ctr-page-btn"
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 10,
                border: 'none',
                background: PURPLE,
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: canNext ? 'pointer' : 'not-allowed',
                opacity: canNext ? 1 : 0.45,
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* ── Delete confirmation modal ─────────────────────────────── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteError('') }}
        title="Delete contract"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm">
              Permanently delete <strong>{deleteTarget.contractNo}</strong>?
              {' '}This will also remove all associated invoices, payment records, and documents.
            </p>
            {deleteTarget.status === 'active' && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                This contract is <strong>active</strong>. End or cancel it before deleting.
              </div>
            )}
            <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs space-y-1">
              <div><span className="text-muted-foreground">Customer:</span> {deleteTarget.customer?.fullName}</div>
              <div>
                <span className="text-muted-foreground">Unit(s):</span>{' '}
                {(deleteTarget.units?.length ? deleteTarget.units : deleteTarget.unit ? [deleteTarget.unit] : []).map((u) => u?.unitNumber ?? '—').join(', ') || '—'}
              </div>
              <div><span className="text-muted-foreground">Status:</span> {statusLabel(deleteTarget.status)}</div>
            </div>
            {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteError('') }}>
                Cancel
              </Button>
              {deleteError.includes('recorded payment') && (
                <Button
                  variant="outline"
                  disabled={archiveContract.isPending}
                  onClick={() => archiveContract.mutate({ id: deleteTarget._id, archived: true })}
                >
                  {archiveContract.isPending ? 'Archiving…' : 'Archive instead'}
                </Button>
              )}
              <Button
                variant="destructive"
                disabled={deleteContract.isPending || deleteTarget.status === 'active'}
                onClick={() => deleteContract.mutate(deleteTarget._id)}
              >
                {deleteContract.isPending ? 'Deleting…' : 'Delete contract'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Opens on Active tenants — this page is about live contracts. */}
      {emailing && <EmailCustomersModal onClose={() => setEmailing(false)} defaultSegment="active" />}
    </div>
  )
}
