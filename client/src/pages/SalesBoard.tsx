import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, leadApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Lead, MovingLead, MovingLeadStatus } from '../lib/types'
import { Badge, Card, EmptyState, PageHeader, Spinner, Table, Td, Th, leadStatusTone, statusLabel } from '../components/ui'
import { formatDate } from '../lib/utils'

type Row = {
  key: string
  type: 'Storage' | 'Moving'
  name: string
  phone: string
  status: string
  statusTone: string
  addedAt?: string
  href: string
  canConvert: boolean
  convert: () => void
  converting: boolean
}

const MOVING_STATUS_TONE: Record<MovingLeadStatus, string> = {
  new: 'blue', contacted: 'amber', quoted: 'purple', client_approved: 'green', won: 'green', lost: 'red',
}

export default function SalesBoard() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')

  const { data: storagePage, isLoading: storageLoading } = useQuery({
    queryKey: ['my-leads-storage'],
    queryFn: () => leadApi.list({ owner: user?.id, limit: 500 }),
    enabled: !!user?.id,
  })

  const { data: movingLeads = [], isLoading: movingLoading } = useQuery<MovingLead[]>({
    queryKey: ['my-leads-moving'],
    queryFn: () => api.get('/moving-leads', { params: { owner: user?.id } }).then((r) => r.data),
    enabled: !!user?.id,
  })

  const convertStorage = useMutation({
    mutationFn: (id: string) => leadApi.convertToCustomer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-leads-storage'] }),
  })
  const convertMoving = useMutation({
    mutationFn: (id: string) => api.post(`/moving-leads/${id}/convert`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-leads-moving'] }),
  })

  const rows: Row[] = useMemo(() => {
    const storageRows: Row[] = (storagePage?.data || []).map((l: Lead) => ({
      key: `s-${l._id}`,
      type: 'Storage',
      name: l.fullName,
      phone: l.phone,
      status: statusLabel(l.status),
      statusTone: leadStatusTone[l.status] || 'gray',
      addedAt: l.leadDateTime,
      href: `/leads`,
      canConvert: l.status !== 'won' && l.status !== 'lost',
      convert: () => convertStorage.mutate(l._id),
      converting: convertStorage.isPending,
    }))
    const movingRows: Row[] = movingLeads.map((l) => ({
      key: `m-${l._id}`,
      type: 'Moving',
      name: l.prospectName || l.customer?.fullName || '—',
      phone: l.prospectPhone || l.customer?.phone || '—',
      status: statusLabel(l.status),
      statusTone: MOVING_STATUS_TONE[l.status] || 'gray',
      addedAt: l.createdAt,
      href: `/moving/leads/${l._id}`,
      canConvert: l.status !== 'won' && l.status !== 'lost',
      convert: () => convertMoving.mutate(l._id),
      converting: convertMoving.isPending,
    }))
    return [...storageRows, ...movingRows].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
  }, [storagePage, movingLeads, convertStorage, convertMoving])

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows])
  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows

  const isLoading = storageLoading || movingLoading

  return (
    <div className="space-y-4">
      <PageHeader title="My Leads" subtitle="Storage and moving leads assigned to you" />

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setStatusFilter('')}
          className={`h-8 px-3 rounded-full text-xs font-semibold cursor-pointer transition-colors ${statusFilter === '' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
        >
          All ({rows.length})
        </button>
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`h-8 px-3 rounded-full text-xs font-semibold cursor-pointer transition-colors ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
          >
            {s} ({rows.filter((r) => r.status === s).length})
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <div className="p-8"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <EmptyState message="No leads assigned to you yet." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
                <Th>Added</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.key} className="hover:bg-muted/50">
                  <Td><span className="text-xs font-semibold text-muted-foreground">{r.type}</span></Td>
                  <Td>
                    <Link to={r.href} className="font-medium text-primary hover:underline">{r.name}</Link>
                  </Td>
                  <Td className="text-sm text-muted-foreground">{r.phone}</Td>
                  <Td><Badge tone={r.statusTone}>{r.status}</Badge></Td>
                  <Td className="text-xs text-muted-foreground">{r.addedAt ? formatDate(r.addedAt) : '—'}</Td>
                  <Td className="text-right">
                    {r.canConvert && (
                      <button
                        type="button"
                        disabled={r.converting}
                        onClick={r.convert}
                        className="text-xs font-semibold text-primary hover:underline cursor-pointer disabled:opacity-50"
                      >
                        {r.converting ? 'Converting…' : r.type === 'Storage' ? 'Convert to Customer' : 'Convert to Job'}
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
