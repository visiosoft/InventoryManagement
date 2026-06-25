import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { Contract } from '../lib/types'
import {
  Badge, Button, Card, EmptyState, Input, Modal, PageHeader,
  Select, Spinner, Table, Td, Th,
  contractStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const STATUSES = ['draft', 'pending_signature', 'active', 'ended', 'cancelled']

export default function Contracts() {
  const qc = useQueryClient()

  // Filters
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [billing, setBilling] = useState('')
  const [floor, setFloor] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [selectedContractIds, setSelectedContractIds] = useState<string[]>([])

  const { data: contracts, isLoading } = useQuery<Contract[]>({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then((r) => r.data),
  })

  // All filtering done client-side so every filter combination is instant
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromD = from ? new Date(from) : null
    const toD = to ? new Date(to + 'T23:59:59') : null
    return (contracts || []).filter((c) => {
      if (status && c.status !== status) return false
      if (billing && c.billingPeriod !== billing) return false
      if (floor && c.unit?.floor !== floor) return false
      if (fromD && new Date(c.startDate) < fromD) return false
      if (toD && new Date(c.startDate) > toD) return false
      if (q) {
        const haystack = [
          c.contractNo,
          c.customer?.fullName,
          c.unit?.unitNumber,
          String(c.unit?.sizeSqf ?? ''),
          ...(c.units || []).map((u) => u.unitNumber),
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [contracts, search, status, billing, floor, from, to])

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

  const visibleContractIds = filtered.map((contract) => contract._id)
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

  return (
    <div>
      <PageHeader
        title="Contracts"
        subtitle={`${filtered.length}${hasFilters ? ` of ${contracts?.length ?? 0}` : ''} contracts`}
        action={
          <div className="flex gap-2">
            {selectedContractIds.length > 0 && (
              <Button variant="destructive" onClick={confirmBulkDelete} disabled={deleteManyContracts.isPending}>
                {deleteManyContracts.isPending ? 'Deleting…' : `Delete selected (${selectedContractIds.length})`}
              </Button>
            )}
            <Link to="/contracts/new"><Button><Plus size={15} /> New contract</Button></Link>
          </div>
        }
      />

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-56 pl-7"
            placeholder="Customer, unit, contract #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>

        <Select value={floor} onChange={(e) => setFloor(e.target.value)} className="w-32">
          <option value="">All floors</option>
          <option value="F1">Floor F1</option>
          <option value="F2">Floor F2</option>
        </Select>

        <div className="flex items-end gap-1">
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Start from</p>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">to</p>
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-36" />
          </div>
        </div>

        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="flex items-center gap-1">
            <X size={12} /> Clear
          </Button>
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
              {filtered.map((c) => {
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
                      <Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge>
                    </Td>
                    <Td>
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
          {filtered.length === 0 && (
            <EmptyState message={hasFilters ? 'No contracts match the filters.' : 'No contracts yet. Create your first contract.'} />
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
              {' '}This will also remove all associated payment records and documents.
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
