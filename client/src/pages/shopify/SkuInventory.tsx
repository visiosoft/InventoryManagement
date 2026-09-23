import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { EmptyState, Input, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import type { Merchant, Sku } from '../../lib/shopify'

export default function SkuInventory() {
  const [merchant, setMerchant] = useState('')
  const [search, setSearch] = useState('')

  const { data: merchants } = useQuery<Merchant[]>({
    queryKey: ['shopify-merchants-picker'],
    queryFn: () => api.get('/shopify/merchants').then(r => r.data),
  })

  const { data: skus, isLoading } = useQuery<Sku[]>({
    queryKey: ['shopify-skus', merchant, search],
    queryFn: () => api.get('/shopify/skus', { params: { merchant, search: search || undefined } }).then(r => r.data),
    enabled: !!merchant,
  })

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader title="Inventory" subtitle="Stock on hand per SKU, by merchant." />
      <div className="flex flex-wrap gap-3">
        <Select value={merchant} onChange={e => setMerchant(e.target.value)} className="max-w-xs">
          <option value="">Select a merchant…</option>
          {(merchants ?? []).map(m => <option key={m._id} value={m._id}>{m.name}</option>)}
        </Select>
        {merchant && (
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SKU or product name…" className="max-w-xs" />
        )}
      </div>
      {!merchant ? (
        <EmptyState message="Select a merchant to see its inventory." />
      ) : isLoading ? (
        <Spinner />
      ) : !skus?.length ? (
        <EmptyState message="No SKUs found — try syncing this merchant's catalog from the Merchants page." />
      ) : (
        <Table>
          <thead><tr><Th>SKU</Th><Th>Product</Th><Th>On hand</Th><Th>Reserved</Th><Th>Available</Th></tr></thead>
          <tbody>
            {skus.map(s => (
              <tr key={s._id}>
                <Td className="font-mono text-sm">{s.sku}</Td>
                <Td>{s.productTitle}{s.variantTitle && s.variantTitle !== 'Default Title' ? ` — ${s.variantTitle}` : ''}</Td>
                <Td>{s.onHand}</Td>
                <Td>{s.reserved}</Td>
                <Td className={s.available <= 0 ? 'text-destructive font-medium' : ''}>{s.available}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
