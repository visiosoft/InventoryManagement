import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../../lib/api'
import { Button, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import type { Merchant, Sku } from '../../lib/shopify'

/** Receiving a delivery ('add', negative to write off) or recording a
 *  physical count ('set'). Stock sync, if on, follows within a minute. */
function AdjustStockModal({ merchant, sku, mode, onClose, onDone }: {
  merchant: string; sku: Sku; mode: 'add' | 'set'; onClose: () => void; onDone: () => void
}) {
  const [quantity, setQuantity] = useState(mode === 'set' ? String(sku.onHand) : '')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api.post('/shopify/stock', { requestId: crypto.randomUUID(), merchant, sku: sku._id, mode, quantity: Number(quantity), note })
      onDone()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open title={mode === 'add' ? `Receive stock — ${sku.sku}` : `Stock count — ${sku.sku}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          On hand {sku.onHand}, reserved {sku.reserved} for open orders.
        </p>
        <Field label={mode === 'add' ? 'Units received (negative to write off)' : 'Units counted on the shelf'}>
          <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} autoFocus />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={e => setNote(e.target.value)} placeholder={mode === 'add' ? 'Delivery reference…' : 'Cycle count…'} />
        </Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || quantity === '' || !Number.isInteger(Number(quantity))}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function SkuInventory() {
  const [merchant, setMerchant] = useState('')
  const [search, setSearch] = useState('')
  const [adjusting, setAdjusting] = useState<{ sku: Sku; mode: 'add' | 'set' } | null>(null)
  const qc = useQueryClient()

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
          <thead><tr><Th>SKU</Th><Th>Product</Th><Th>On hand</Th><Th>Reserved</Th><Th>Available</Th><Th /></tr></thead>
          <tbody>
            {skus.map(s => (
              <tr key={s._id}>
                <Td className="font-mono text-sm">{s.sku}</Td>
                <Td>{s.productTitle}{s.variantTitle && s.variantTitle !== 'Default Title' ? ` — ${s.variantTitle}` : ''}</Td>
                <Td>{s.onHand}</Td>
                <Td>{s.reserved}</Td>
                <Td className={s.available <= 0 ? 'text-destructive font-medium' : ''}>{s.available}</Td>
                <Td>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="outline" onClick={() => setAdjusting({ sku: s, mode: 'add' })}>Receive</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAdjusting({ sku: s, mode: 'set' })}>Count</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adjusting && (
        <AdjustStockModal
          merchant={merchant} sku={adjusting.sku} mode={adjusting.mode}
          onClose={() => setAdjusting(null)}
          onDone={() => { setAdjusting(null); qc.invalidateQueries({ queryKey: ['shopify-skus'] }) }}
        />
      )}
    </div>
  )
}
