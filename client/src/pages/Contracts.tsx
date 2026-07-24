import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { Contract } from '../lib/types'
import {
  Badge, Button, Card, EmptyState, Modal, Pagination,
  Spinner, Table, Td, Th,
  contractStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_COLOR = '#756E80'
const PURPLE = '#5B2BC9'
const CREAM = '#FDFCFA'
const CHIP_BG = '#F3F0EA'

const STATUSES = ['draft', 'pending_signature', 'active', 'ended', 'cancelled']
type PagedContracts = { data: Contract[]; total: number; page: number; pages: number; limit: number }

export default function Contracts() {
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [billing, setBilling] = useState('')
  const [floor, setFloor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage]   = useState(1)
  const [limit, setLimit] = useState(25)
  const [showArchived, setShowArchived] = useState(false)

  // Reset to page 1 when any filter changes
  useEffect(() => { setPage(1) }, [search, status, billing, floor, from, to, limit, showArchived])

  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [selectedContractIds, setSelectedContractIds] = useState<string[]>([])

  const params = { search: search || undefined, status: status || undefined, billing: billing || undefined, floor: floor || undefined, from: from || undefined, to: to || undefined, page, limit, archived: showArchived ? 'true' : undefined }

  const { data, isLoading } = useQuery<PagedContracts>({
    queryKey: ['contracts', params],
    queryFn: () => api.get('/contracts', { params }).then((r) => r.data),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })

  const contracts = data?.data ?? []
  const hasFilters = search || status || billing || floor || from || to
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

  const pillSelect: React.CSSProperties = {
    background: CHIP_BG,
    border: 'none',
    borderRadius: 10,
    height: 36,
    padding: '0 12px',
    fontSize: 13,
    color: INK,
    outline: 'none',
    cursor: 'pointer',
    minWidth: 130,
  }

  const pillDate: React.CSSProperties = {
    background: CHIP_BG,
    border: 'none',
    borderRadius: 10,
    height: 36,
    padding: '0 12px',
    fontSize: 13,
    color: INK,
    outline: 'none',
    width: 140,
  }

  return (
    <div style={{ background: CREAM, borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
        <div>
          <h1 style={{ ...HEADING, color: INK, fontSize: 28, fontWeight: 800, lineHeight: 1.15, margin: 0 }}>
            Contracts
          </h1>
          <p style={{ color: MUTED_COLOR, fontSize: 14, marginTop: 4 }}>
            {data ? `${data.total} contract${data.total !== 1 ? 's' : ''}${hasFilters ? ' (filtered)' : ''}` : ' '}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedContractIds.length > 0 && (
            <button
              onClick={confirmBulkDelete}
              disabled={deleteManyContracts.isPending}
              style={{
                background: '#DC2626',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '10px 22px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: deleteManyContracts.isPending ? 0.6 : 1,
                ...HEADING,
              }}
            >
              {deleteManyContracts.isPending ? 'Deleting…' : `Delete selected (${selectedContractIds.length})`}
            </button>
          )}
          <Link to="/contracts/new">
            <button
              style={{
                background: PURPLE,
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '10px 22px',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                ...HEADING,
              }}
            >
              <Plus size={15} /> New Contract
            </button>
          </Link>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <div className="relative flex-1" style={{ minWidth: 200, maxWidth: 280 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: MUTED_COLOR }} />
          <input
            placeholder="Customer, unit, contract #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: CHIP_BG,
              border: 'none',
              borderRadius: 10,
              height: 36,
              paddingLeft: 36,
              paddingRight: 12,
              fontSize: 13,
              color: INK,
              outline: 'none',
            }}
          />
        </div>

        <select value={status} onChange={(e) => setStatus(e.target.value)} style={pillSelect}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>

        <select value={floor} onChange={(e) => setFloor(e.target.value)} style={{ ...pillSelect, minWidth: 110 }}>
          <option value="">All floors</option>
          <option value="F1">Floor F1</option>
          <option value="F2">Floor F2</option>
          <option value="F3">Floor F3</option>
          <option value="Shed">Shed</option>
        </select>

        <div className="flex items-end gap-1">
          <div>
            <p style={{ fontSize: 10, color: MUTED_COLOR, marginBottom: 2 }}>Start from</p>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={pillDate} />
          </div>
          <div>
            <p style={{ fontSize: 10, color: MUTED_COLOR, marginBottom: 2 }}>to</p>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={pillDate} />
          </div>
        </div>

        <label className="flex items-center gap-1.5" style={{ fontSize: 12, color: MUTED_COLOR, paddingBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>

        {hasFilters && (
          <button
            onClick={clearFilters}
            style={{
              background: CHIP_BG,
              border: 'none',
              borderRadius: 10,
              height: 36,
              padding: '0 14px',
              fontSize: 13,
              color: INK,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          {deleteError && <p className="px-4 pt-4 text-xs text-destructive">{deleteError}</p>}
          <Table>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisibleContracts}
                    aria-label="Select all contracts"
                  />
                </Th>
                <Th>Contract</Th>
                <Th>Customer</Th>
                <Th>Unit(s)</Th>
                <Th>Billing</Th>
                <Th>Rate</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                const allUnits = c.units?.length ? c.units : [c.unit]
                return (
                  <tr key={c._id} className="hover:bg-muted/50">
                    <Td>
                      <input
                        type="checkbox"
                        checked={selectedContractIds.includes(c._id)}
                        onChange={() => toggleContractSelection(c._id)}
                        aria-label={`Select contract ${c.contractNo}`}
                      />
                    </Td>
                    <Td>
                      <Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">
                        {c.contractNo}
                      </Link>
                    </Td>
                    <Td>{c.customer?.fullName}</Td>
                    <Td>
                      {allUnits.length === 1 ? (
                        <span>
                          {c.unit?.unitNumber}{' '}
                          <span className="text-muted-foreground text-xs">({c.unit?.sizeSqf ?? '—'} sqf)</span>
                        </span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {allUnits.map((u) => (
                            <span key={u._id} className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium">
                              {u.unitNumber}
                            </span>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td className="capitalize">{c.billingPeriod}</Td>
                    <Td>{formatMoney(c.rate)}</Td>
                    <Td>{formatDate(c.startDate)}</Td>
                    <Td>{formatDate(c.endDate)}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge>
                        {c.archived && <Badge tone="gray">Archived</Badge>}
                      </div>
                    </Td>
                    <Td>
                      {c.archived && (
                        <button
                          onClick={() => archiveContract.mutate({ id: c._id, archived: false })}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                          title="Unarchive contract"
                          disabled={archiveContract.isPending}
                        >
                          Unarchive
                        </button>
                      )}
                      <button
                        onClick={() => { setDeleteTarget(c); setDeleteError('') }}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                        title="Delete contract"
                      >
                        <Trash2 size={14} />
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
          {contracts.length === 0 && (
            <EmptyState message={hasFilters ? 'No contracts match the filters.' : 'No contracts yet. Create your first contract.'} />
          )}
          {data && data.pages > 1 && (
            <Pagination page={data.page} pages={data.pages} total={data.total} limit={limit}
              onPage={setPage} onLimit={(l) => setLimit(l)} />
          )}
        </Card>
      )}

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
    </div>
  )
}
