import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../components/ui'
import { formatDate } from '../lib/utils'

type MovingItem = {
  _id: string
  sku: string
  name: string
  category: string
  sizeLabel?: string
  unit: string
  onHand: number
  reorderLevel: number
  active: boolean
  notes?: string
}

type MovingTxn = {
  _id: string
  item: { _id: string; sku: string; name: string; sizeLabel?: string; unit: string }
  txnType: 'in' | 'out' | 'adjustment' | 'transfer' | 'return'
  qty: number
  previousOnHand: number
  resultingOnHand: number
  reason?: string
  takenBy?: string
  contract?: { _id: string; contractNo: string }
  customer?: { _id: string; fullName: string }
  txnDate: string
  notes?: string
}

type Summary = { totalItems: number; lowStock: number; outOfStock: number; txToday: number }

function tone(item: MovingItem) {
  if (item.onHand <= 0) return 'red'
  if (item.onHand <= item.reorderLevel) return 'amber'
  return 'green'
}

export default function MovingInventory() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showLow, setShowLow] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [txnOpen, setTxnOpen] = useState(false)
  const [error, setError] = useState('')

  const { data: summary } = useQuery<Summary>({
    queryKey: ['moving-inventory-summary'],
    queryFn: () => api.get('/moving-inventory/summary').then((r) => r.data),
  })

  const { data: items, isLoading } = useQuery<MovingItem[]>({
    queryKey: ['moving-inventory-items', search, showLow],
    queryFn: () => api.get('/moving-inventory/items', { params: { search: search || undefined, lowStock: showLow ? 'true' : undefined, active: 'true' } }).then((r) => r.data),
  })

  const { data: txns } = useQuery<MovingTxn[]>({
    queryKey: ['moving-inventory-txns'],
    queryFn: () => api.get('/moving-inventory/transactions', { params: { limit: 100 } }).then((r) => r.data),
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['moving-inventory-summary'] })
    qc.invalidateQueries({ queryKey: ['moving-inventory-items'] })
    qc.invalidateQueries({ queryKey: ['moving-inventory-txns'] })
  }

  const addItem = useMutation({
    mutationFn: (body: object) => api.post('/moving-inventory/items', body),
    onSuccess: () => { invalidate(); setAddOpen(false); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const addTxn = useMutation({
    mutationFn: (body: object) => api.post('/moving-inventory/transactions', body),
    onSuccess: () => { invalidate(); setTxnOpen(false); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  return (
    <div>
      <PageHeader
        title="Moving Ops Inventory"
        subtitle="Boxes, packing stock, and movement history"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => invalidate()}><RefreshCw size={14} /> Refresh</Button>
            <Button variant="outline" onClick={() => { setError(''); setTxnOpen(true) }}>Record movement</Button>
            <Button onClick={() => { setError(''); setAddOpen(true) }}><Plus size={14} /> Add item</Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Active items</div><div className="text-2xl font-bold">{summary?.totalItems ?? 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Low stock</div><div className="text-2xl font-bold text-amber-600">{summary?.lowStock ?? 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Out of stock</div><div className="text-2xl font-bold text-destructive">{summary?.outOfStock ?? 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Movements today</div><div className="text-2xl font-bold">{summary?.txToday ?? 0}</div></Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="w-72" placeholder="Search SKU, name, size..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant={showLow ? 'default' : 'outline'} size="sm" onClick={() => setShowLow((v) => !v)}>
          <AlertTriangle size={13} /> Low stock only
        </Button>
      </div>

      {isLoading ? <Spinner /> : (
        <Card>
          <CardHeader title="Stock on hand" subtitle={`${items?.length ?? 0} items`} />
          <Table>
            <thead><tr><Th>SKU</Th><Th>Item</Th><Th>Category</Th><Th>Size</Th><Th>On hand</Th><Th>Reorder</Th><Th>Status</Th></tr></thead>
            <tbody>
              {(items || []).map((it) => (
                <tr key={it._id} className="hover:bg-muted/40">
                  <Td className="font-mono text-xs">{it.sku}</Td>
                  <Td className="font-medium">{it.name}</Td>
                  <Td>{it.category}</Td>
                  <Td>{it.sizeLabel || '—'}</Td>
                  <Td>{it.onHand} {it.unit}</Td>
                  <Td>{it.reorderLevel} {it.unit}</Td>
                  <Td><Badge tone={tone(it)}>{it.onHand <= 0 ? 'Out' : it.onHand <= it.reorderLevel ? 'Low' : 'OK'}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(items || []).length === 0 && <EmptyState message="No inventory items found." />}
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title="Recent movements" subtitle="Latest stock transactions" />
        <Table>
          <thead><tr><Th>Date</Th><Th>Item</Th><Th>Type</Th><Th>Qty</Th><Th>By</Th><Th>Reason</Th><Th>Stock</Th></tr></thead>
          <tbody>
            {(txns || []).map((t) => (
              <tr key={t._id} className="hover:bg-muted/40">
                <Td>{formatDate(t.txnDate)}</Td>
                <Td>{t.item?.name} {t.item?.sizeLabel ? `(${t.item.sizeLabel})` : ''}</Td>
                <Td className="uppercase text-xs">{t.txnType}</Td>
                <Td>{t.qty}</Td>
                <Td>{t.takenBy || '—'}</Td>
                <Td className="text-muted-foreground max-w-60 truncate">{t.reason || t.notes || '—'}</Td>
                <Td>{t.previousOnHand} → {t.resultingOnHand}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {(txns || []).length === 0 && <EmptyState message="No stock movements yet." />}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add moving inventory item">
        <ItemForm busy={addItem.isPending} error={error} onSubmit={(body) => addItem.mutate(body)} />
      </Modal>

      <Modal open={txnOpen} onClose={() => setTxnOpen(false)} title="Record stock movement">
        <TxnForm items={items || []} busy={addTxn.isPending} error={error} onSubmit={(body) => addTxn.mutate(body)} />
      </Modal>
    </div>
  )
}

function ItemForm({ busy, error, onSubmit }: { busy: boolean; error: string; onSubmit: (body: object) => void }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      sku: f.get('sku'),
      name: f.get('name'),
      category: f.get('category'),
      sizeLabel: f.get('sizeLabel'),
      unit: f.get('unit'),
      onHand: Number(f.get('onHand') || 0),
      reorderLevel: Number(f.get('reorderLevel') || 0),
      notes: f.get('notes'),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU *"><Input name="sku" required placeholder="BOX-SM-001" /></Field>
        <Field label="Name *"><Input name="name" required placeholder="Cardboard Box" /></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Category"><Input name="category" defaultValue="box" /></Field>
        <Field label="Size"><Input name="sizeLabel" placeholder="Small / 40x40x40" /></Field>
        <Field label="Unit">
          <Select name="unit" defaultValue="pcs">
            <option value="pcs">pcs</option>
            <option value="packs">packs</option>
            <option value="rolls">rolls</option>
            <option value="sets">sets</option>
            <option value="other">other</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opening stock"><Input name="onHand" type="number" min={0} step="1" defaultValue={0} /></Field>
        <Field label="Reorder level"><Input name="reorderLevel" type="number" min={0} step="1" defaultValue={0} /></Field>
      </div>
      <Field label="Notes"><Textarea name="notes" /></Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving...' : 'Create item'}</Button>
    </form>
  )
}

function TxnForm({ items, busy, error, onSubmit }: { items: MovingItem[]; busy: boolean; error: string; onSubmit: (body: object) => void }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      item: f.get('item'),
      txnType: f.get('txnType'),
      qty: Number(f.get('qty') || 0),
      takenBy: f.get('takenBy'),
      reason: f.get('reason'),
      notes: f.get('notes'),
      txnDate: f.get('txnDate'),
      contract: f.get('contract') || undefined,
      customer: f.get('customer') || undefined,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Item *">
        <Select name="item" required>
          <option value="">Select item</option>
          {items.map((i) => (
            <option key={i._id} value={i._id}>{i.sku} - {i.name}{i.sizeLabel ? ` (${i.sizeLabel})` : ''} [{i.onHand} {i.unit}]</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Movement type">
          <Select name="txnType" defaultValue="out">
            <option value="out">Out (issue/use)</option>
            <option value="in">In (purchase/restock)</option>
            <option value="return">Return</option>
            <option value="adjustment">Adjustment (+/-)</option>
            <option value="transfer">Transfer out</option>
          </Select>
        </Field>
        <Field label="Quantity *"><Input name="qty" type="number" step="1" required placeholder="Use negative only for adjustment" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Taken by"><Input name="takenBy" placeholder="Staff name" /></Field>
        <Field label="Date"><Input name="txnDate" type="datetime-local" /></Field>
      </div>
      <Field label="Reason"><Input name="reason" placeholder="Job dispatch / damaged / cycle count" /></Field>
      <Field label="Notes"><Textarea name="notes" /></Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving...' : 'Record movement'}</Button>
    </form>
  )
}
