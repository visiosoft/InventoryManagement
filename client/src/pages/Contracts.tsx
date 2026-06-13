import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '../lib/api'
import type { Contract } from '../lib/types'
import { Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, Table, Td, Th, contractStatusTone, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

export default function Contracts() {
  const [status, setStatus] = useState('')
  const { data: contracts, isLoading } = useQuery<Contract[]>({
    queryKey: ['contracts', status],
    queryFn: () => api.get('/contracts', { params: status ? { status } : {} }).then((r) => r.data),
  })

  return (
    <div>
      <PageHeader
        title="Contracts"
        subtitle={`${contracts?.length ?? 0} contracts`}
        action={<Link to="/contracts/new"><Button><Plus size={15} /> New contract</Button></Link>}
      />

      <div className="mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-52">
          <option value="">All statuses</option>
          {['draft', 'pending_signature', 'active', 'ended', 'cancelled'].map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <Table>
            <thead><tr><Th>Contract</Th><Th>Customer</Th><Th>Unit</Th><Th>Billing</Th><Th>Rate</Th><Th>Start</Th><Th>End</Th><Th>Status</Th></tr></thead>
            <tbody>
              {(contracts || []).map((c) => (
                <tr key={c._id} className="hover:bg-muted/50">
                  <Td><Link to={`/contracts/${c._id}`} className="font-medium text-primary hover:underline">{c.contractNo}</Link></Td>
                  <Td>{c.customer?.fullName}</Td>
                  <Td>{c.unit?.unitNumber} <span className="text-muted-foreground text-xs">({c.unit?.sizeSqf ?? '—'} sqf)</span></Td>
                  <Td className="capitalize">{c.billingPeriod}</Td>
                  <Td>{formatMoney(c.rate)}</Td>
                  <Td>{formatDate(c.startDate)}</Td>
                  <Td>{formatDate(c.endDate)}</Td>
                  <Td><Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(contracts || []).length === 0 && <EmptyState message="No contracts found. Create your first contract." />}
        </Card>
      )}
    </div>
  )
}
