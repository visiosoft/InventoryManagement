import { useMemo, Fragment, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Mail, Paperclip, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Contract } from '../lib/types'
import EmailCustomersModal from './customers/EmailCustomersModal'
import { Button, EmptyState, Modal, Spinner, statusLabel } from '../components/ui'
import { ExportButtons, type ExportColumn } from '../components/ExportButtons'
import { formatDate, formatMoney } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', serif", letterSpacing: '-0.02em' } as const
const PAGE_BG = '#FBF8F2'
const INK = '#14081F'
const MUTED_COLOR = '#756E80'
const SECOND = '#4A4357'
const PURPLE = '#5B2BC9'
const AVATAR_BG = '#EDE5FF'
const AVATAR_FG = '#4A1FA0'
const DANGER = '#C22A2A'
const DASH = '#A29CAD'
const LINE = 'rgba(20,8,31,0.10)'
const FIELD_LINE = 'rgba(20,8,31,0.16)'
const CHIP_BG = '#F3F0EA'
const CARD_SHADOW = '0 8px 24px rgba(20,8,31,.08), 0 2px 6px rgba(20,8,31,.04)'

const STATUSES = ['draft', 'pending_signature', 'active', 'ended', 'cancelled']
type PagedContracts = { data: Contract[]; total: number; page: number; pages: number; limit: number }

// The left edge of each card is the status. The design named three; the app has
// five, so ended and cancelled get their own tone rather than falling back to
// draft grey and reading as something they are not.
const STATUS_ACCENT: Record<string, string> = {
  active: '#22c55e',
  pending_signature: '#F59E0B',
  draft: '#756E80',
  ended: '#94A3B8',
  cancelled: '#EF4444',
}

const CSS = `
.ctr-card { transition: box-shadow .14s ease; cursor: pointer; }
.ctr-card:hover { box-shadow: 0 6px 18px rgba(20,8,31,.10); }
.ctr-card:focus-visible { outline: 2px solid ${PURPLE}; outline-offset: 2px; }
.ctr-link:hover { text-decoration: underline; }
.ctr-del:hover { background: #FDEEEE; color: ${DANGER}; }
.ctr-ghost:hover { filter: brightness(0.97); }
.ctr-page-btn:not(:disabled):hover { filter: brightness(0.96); }
`

// Every control on the toolbar is the same pill: 44px tall, fully rounded.
const pillBase: React.CSSProperties = {
  height: 44,
  borderRadius: 999,
  border: `1px solid ${FIELD_LINE}`,
  background: '#fff',
  color: INK,
  fontSize: 14,
  fontWeight: 600,
  padding: '0 16px',
  outline: 'none',
}

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

/** First letters of the first two words, for the avatar. */
function initials(name?: string) {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
}

export default function Contracts() {
  const qc = useQueryClient()
  const navigate = useNavigate()
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

  const rows = data?.data ?? []



  /* What each tenant owes, fetched separately.
   *
   * Zoho's contact list is a paged remote call that takes about fifteen
   * seconds when its cache is cold, and this page used to wait on it before
   * drawing a row. The list appears now and the owed column fills in behind
   * it. */
  const contractIds = rows.map((c) => c._id).join(',')
  const { data: owed } = useQuery<{ configured: boolean; byContract: Record<string, number> }>({
    queryKey: ['contracts-outstanding', contractIds],
    queryFn: () => api.get('/contracts/outstanding', { params: { ids: contractIds } }).then((r) => r.data),
    enabled: contractIds.length > 0,
    staleTime: 5 * 60_000,
  })

  const contracts = useMemo(
    () => rows.map((c) => (owed?.byContract?.[c._id] ? { ...c, outstanding: owed.byContract[c._id] } : c)),
    [rows, owed],
  )
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

  /* Downloading the tenant list.
   *
   * Every filter on screen goes with it, and every row that matches them —
   * not the twenty-five being displayed. A spreadsheet of one page of a
   * hundred and forty-eight is the wrong answer to "export the tenants", and
   * the person opening it in Excel has no way to tell it was cut.
   *
   * The columns are what the page shows plus the things a spreadsheet is
   * actually used for: the phone number and email nobody can copy off a table
   * row, and the balance, which is the reason most of these get exported. */
  const exportColumns: ExportColumn[] = [
    { label: 'Tenant' },
    { label: 'Phone' },
    { label: 'Email' },
    { label: 'Contract' },
    { label: 'Units' },
    { label: 'Floor' },
    { label: 'Start' },
    { label: 'End' },
    { label: 'Days left', numeric: true },
    { label: 'Rate', numeric: true },
    { label: 'Contract value', numeric: true },
    { label: 'Balance due', numeric: true },
    { label: 'Status' },
    { label: 'Renewal' },
  ]

  const toExportRow = (c: Contract): (string | number | null)[] => {
    const units = c.units?.length ? c.units : c.unit ? [c.unit] : []
    const daysLeft = (!c.endDate || !['active', 'pending_signature'].includes(c.status))
      ? null
      : Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
    return [
      c.customer?.fullName ?? '',
      // The primary number, then whatever else is on file — a spreadsheet is
      // where somebody goes to phone a list of people.
      [c.customer?.phone, ...(c.customer?.phones ?? [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' / '),
      c.customer?.email ?? '',
      c.contractNo ?? '',
      units.map((u) => u?.unitNumber).filter(Boolean).join(', '),
      units.map((u) => u?.floor).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '),
      c.startDate ? formatDate(c.startDate) : '',
      c.endDate ? formatDate(c.endDate) : '',
      daysLeft,
      // Numbers go as numbers: a total somebody cannot sum in Excel is a
      // picture of a number.
      Number(c.rate) || 0,
      Number(contractValue(c)) || 0,
      Number(c.outstanding) || 0,
      statusLabel(c.status),
      c.renewalIntent ? c.renewalIntent.replace(/_/g, ' ') : '',
    ]
  }

  /* Fetched when the button is pressed, not held in memory: the page keeps
     twenty-five rows and this asks for everything the filters match. */
  async function fetchAllForExport() {
    const all = await api
      .get('/contracts', { params: { ...params, page: 1, limit: 5000 } })
      .then((r) => r.data as PagedContracts)
    return (all.data ?? []).map(toExportRow)
  }

  const exportSubtitle = [
    `${data?.total ?? 0} tenants`,
    search ? `matching "${search}"` : '',
    status ? statusLabel(status) : '',
    floor ? `floor ${floor}` : '',
    showArchived ? 'including archived' : '',
  ].filter(Boolean).join(' · ')

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

  return (
    <div style={{ background: PAGE_BG, fontFamily: "'Manrope', system-ui, sans-serif", color: INK }}>
      <style>{CSS}</style>

      <div style={{ maxWidth: 1360, margin: '0 auto' }}>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={{ marginBottom: 18 }}>
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
                  height: 44,
                  padding: '0 20px',
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
            <ExportButtons
              title="Tenants"
              subtitle={exportSubtitle}
              columns={exportColumns}
              rows={rows.map(toExportRow)}
              getRows={fetchAllForExport}
              total={data?.total ?? rows.length}
            />
            {isAdmin && (
              <button
                onClick={() => setEmailing(true)}
                className="ctr-page-btn"
                style={{
                  height: 44,
                  padding: '0 20px',
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
                  boxShadow: CARD_SHADOW,
                }}
              >
                <Mail size={16} /> Email tenants
              </button>
            )}
          </div>
        </div>

        {/* ── Toolbar ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center" style={{ gap: 12, marginBottom: 16 }}>
          <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: MUTED_COLOR }} />
            <input
              placeholder="Customer, unit, contract #…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...pillBase, width: '100%', fontWeight: 400, padding: '0 16px 0 40px' }}
            />
          </div>

          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...pillBase, cursor: 'pointer', minWidth: 150 }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>

          <select value={floor} onChange={(e) => setFloor(e.target.value)} style={{ ...pillBase, cursor: 'pointer', minWidth: 130 }}>
            <option value="">All floors</option>
            <option value="F1">Floor F1</option>
            <option value="F2">Floor F2</option>
            <option value="F3">Floor F3</option>
            <option value="Shed">Shed</option>
          </select>

          {/* The old table sorted from its column headers. There are no headers
              on a card list, so every one of those sorts lives here instead —
              including Owes and Renewal, which are server-side. */}
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...pillBase, cursor: 'pointer', minWidth: 190 }}>
            <option value="newest">Sort: Newest first</option>
            <option value="oldest">Sort: Oldest first</option>
            <option value="start_asc">Sort: Start date ↑</option>
            <option value="start_desc">Sort: Start date ↓</option>
            <option value="end_asc">Sort: Ending soonest</option>
            <option value="end_desc">Sort: Ending latest</option>
            <option value="rate_desc">Sort: Amount high → low</option>
            <option value="rate_asc">Sort: Amount low → high</option>
            <option value="owes_desc">Sort: Owes most first</option>
            <option value="owes_asc">Sort: Owes least first</option>
            <option value="renewal_asc">Sort: Renewal intent</option>
            <option value="renewal_desc">Sort: Renewal intent ↓</option>
          </select>

          <button
            onClick={() => setMoreOpen((v) => !v)}
            className="ctr-ghost"
            aria-expanded={moreOpen}
            style={{
              ...pillBase,
              border: '1px solid transparent',
              background: PURPLE,
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              padding: '0 18px',
              boxShadow: CARD_SHADOW,
            }}
          >
            <SlidersHorizontal size={15} /> More filters
            {moreOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>

        {moreOpen && (
          <div
            className="flex flex-wrap items-end"
            style={{ gap: 12, marginBottom: 16, padding: 18, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14 }}
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

        {deleteError && (
          <p style={{ fontSize: 12, color: DANGER, marginBottom: 10 }}>{deleteError}</p>
        )}

        {/* ── Card list ────────────────────────────────────────────── */}
        {isLoading ? (
          <div style={{ padding: 40 }}><Spinner /></div>
        ) : contracts.length === 0 ? (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14 }}>
            <EmptyState message={hasFilters ? 'No contracts match the filters.' : 'No contracts yet. Create your first contract.'} />
          </div>
        ) : (
          <>
            {/* Select-all lives here now that there is no header row to hold it.
                Hidden for anyone who cannot act on a selection: deleting
                contracts is admin-only on the server, and offering the tick
                boxes to a rep only leads them to a refusal. */}
            {isAdmin && <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: MUTED_COLOR, marginBottom: 10, cursor: 'pointer', width: 'fit-content' }}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisibleContracts}
                aria-label="Select all contracts on this page"
              />
              Select all on this page
              {selectedContractIds.length > 0 && (
                <span style={{ fontWeight: 700, color: SECOND }}>· {selectedContractIds.length} selected</span>
              )}
            </label>}

            <div data-tour="contracts-list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groups.map((g) => (
                <Fragment key={g.label || 'all'}>
                  {g.label && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: AVATAR_FG, padding: '6px 4px 0' }}>
                      {g.label} <span style={{ opacity: .6, fontWeight: 600 }}>· {g.items.length}</span>
                    </div>
                  )}
                  {g.items.map((c) => {
                    const allUnits = c.units?.length ? c.units : c.unit ? [c.unit] : []
                    const accent = STATUS_ACCENT[c.status] ?? STATUS_ACCENT.draft
                    const value = contractValue(c)
                    const owes = Number(c.outstanding) > 0 ? Number(c.outstanding) : 0
                    // A contract can still carry a unit id the list did not
                    // resolve; printing "undefined" is worse than printing
                    // nothing, so anything without a number is dropped.
                    const unitNumbers = [...new Set(allUnits.map((u) => u?.unitNumber).filter(Boolean))]
                    const unitLabel = unitNumbers.length === 0
                      ? '—'
                      : unitNumbers.length === 1
                        ? unitNumbers[0]
                        : `${unitNumbers[0]} +${unitNumbers.length - 1}`

                    // Days left, the number staff actually chase. Red inside ten
                    // days, per the design; a dash where it does not apply.
                    const daysLeft = (!c.endDate || !['active', 'pending_signature'].includes(c.status))
                      ? null
                      : Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)

                    return (
                      <div
                        key={c._id}
                        className="ctr-card flex flex-wrap items-center"
                        role="link"
                        tabIndex={0}
                        aria-label={`Open contract ${c.contractNo}`}
                        onClick={() => navigate(`/contracts/${c._id}`)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            navigate(`/contracts/${c._id}`)
                          }
                        }}
                        style={{
                          gap: 18,
                          background: '#fff',
                          border: `1px solid ${LINE}`,
                          borderLeft: `4px solid ${accent}`,
                          borderRadius: 14,
                          padding: '16px 20px',
                        }}
                      >
                        {isAdmin && (
                          <input
                            type="checkbox"
                            checked={selectedContractIds.includes(c._id)}
                            onChange={() => toggleContractSelection(c._id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select contract ${c.contractNo}`}
                            style={{ flex: '0 0 auto', cursor: 'pointer' }}
                          />
                        )}

                        <div
                          title={c.customer?.fullName}
                          style={{ width: 42, height: 42, borderRadius: 999, background: AVATAR_BG, color: AVATAR_FG, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14, flex: '0 0 auto' }}
                        >
                          {initials(c.customer?.fullName)}
                        </div>

                        <div style={{ flex: '1 1 220px', minWidth: 180 }}>
                          <div
                            title={c.customer?.fullName}
                            style={{ fontWeight: 700, fontSize: 15, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {c.customer ? c.customer.fullName : '—'}
                          </div>
                          <div className="flex items-center flex-wrap" style={{ fontSize: 12.5, color: MUTED_COLOR, marginTop: 2, gap: 8 }}>
                            <Link
                              to={`/contracts/${c._id}`}
                              className="ctr-link"
                              style={{ color: PURPLE, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textDecoration: 'none' }}
                            >
                              {c.contractNo}
                            </Link>
                            <span>·</span>
                            <span title={unitNumbers.join(', ')}>{unitLabel}</span>
                            {typeof c.documentCount === 'number' && (
                              <span
                                title={c.documentCount > 0
                                  ? `${c.documentCount} document${c.documentCount !== 1 ? 's' : ''} attached`
                                  : 'No documents attached'}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 2,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: c.documentCount > 0 ? '#EAF7EF' : '#FDECEC',
                                  color: c.documentCount > 0 ? '#1B7A4B' : '#B3261E',
                                }}
                              >
                                <Paperclip size={9} />{c.documentCount}
                              </span>
                            )}
                            {c.archived && (
                              <span style={{ background: CHIP_BG, color: MUTED_COLOR, borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 600 }}>
                                Archived
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ flex: '0 0 140px', textAlign: 'right' }}>
                          <div
                            style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: INK }}
                            title={`${c.billingPeriod === 'weekly' ? 'Weekly' : 'Monthly'} billing · rate ${formatMoney(c.rate)}${
                              c.paymentStatus ? ` · ${PAYMENT_LABELS[c.paymentStatus]}` : ''
                            }${c.overdueCount ? ` · ${c.overdueCount} overdue` : ''}`}
                          >
                            {value ? formatMoney(value) : '—'}
                          </div>
                          {/* Outstanding in Zoho Books. "No balance due" also
                              covers a tenant we could not match on email or
                              phone, which is why the Tenants list counts them. */}
                          <div
                            title={owes ? 'Unpaid balance in Zoho Books' : undefined}
                            style={{ fontSize: 12, fontWeight: 600, marginTop: 2, color: owes ? DANGER : DASH }}
                          >
                            {owes ? `Owes ${formatMoney(owes)}` : 'No balance due'}
                          </div>
                        </div>

                        <div style={{ flex: '0 0 170px', textAlign: 'right', fontSize: 12.5, color: SECOND, fontVariantNumeric: 'tabular-nums' }}>
                          {formatDate(c.startDate)} → {formatDate(c.endDate)}
                        </div>

                        <div style={{ flex: '0 0 76px', textAlign: 'right', fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                          {daysLeft === null ? (
                            <span style={{ color: DASH }}>—</span>
                          ) : daysLeft < 0 ? (
                            <span style={{ color: DANGER }}>{Math.abs(daysLeft)}d over</span>
                          ) : daysLeft === 0 ? (
                            <span style={{ color: DANGER }}>today</span>
                          ) : (
                            <span style={{ color: daysLeft <= 10 ? DANGER : SECOND }}>{daysLeft}d</span>
                          )}
                        </div>

                        {/* The accent stripe carries the status, but colour on
                            its own is not readable to everyone and does not
                            survive a printed report — so the word stays, quietly,
                            above the renewal intent. */}
                        <div style={{ flex: '0 0 130px', textAlign: 'right' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: accent }}>{statusLabel(c.status)}</div>
                          <div style={{ fontSize: 12.5, color: MUTED_COLOR, marginTop: 2 }}>
                            {c.status === 'active'
                              ? (c.renewalIntent === 'renewing' ? 'Renewing' : c.renewalIntent === 'not_renewing' ? 'Not renewing' : 'Undecided')
                              : '—'}
                          </div>
                        </div>

                        <div className="flex items-center" style={{ gap: 4, flex: '0 0 auto' }}>
                          {c.archived && (
                            <button
                              onClick={(e) => { e.stopPropagation(); archiveContract.mutate({ id: c._id, archived: false }) }}
                              disabled={archiveContract.isPending}
                              className="ctr-ghost"
                              title="Unarchive contract"
                              style={{ background: 'transparent', border: 'none', borderRadius: 8, padding: '4px 6px', fontSize: 11, color: MUTED_COLOR, cursor: 'pointer' }}
                            >
                              Unarchive
                            </button>
                          )}
                          {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); setDeleteError('') }}
                            className="ctr-del"
                            title="Delete contract"
                            style={{
                              width: 32,
                              height: 32,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: 8,
                              border: '1px solid transparent',
                              background: 'transparent',
                              color: MUTED_COLOR,
                              cursor: 'pointer',
                              transition: 'background .12s ease, color .12s ease',
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </>
        )}

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between" style={{ padding: '20px 4px', gap: 12 }}>
          <span style={{ fontSize: 13, color: MUTED_COLOR }}>
            Showing {contracts.length} of {data?.total ?? 0}
          </span>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              onClick={() => canPrev && setPage(page - 1)}
              disabled={!canPrev}
              className="ctr-page-btn"
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 999,
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
                height: 40,
                padding: '0 18px',
                borderRadius: 999,
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
