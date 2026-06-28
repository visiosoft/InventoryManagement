import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Pencil, Plus, RefreshCw } from 'lucide-react'
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
    retailPrice: number
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
    const [editItem, setEditItem] = useState<MovingItem | null>(null)
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

    const updateItem = useMutation({
        mutationFn: ({ id, body }: { id: string; body: object }) => api.put(`/moving-inventory/items/${id}`, body),
        onSuccess: () => { invalidate(); setEditItem(null); setError('') },
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
                        <thead><tr><Th>SKU</Th><Th>Item</Th><Th>Category</Th><Th>Size</Th><Th>Price</Th><Th>On hand</Th><Th>Reorder</Th><Th>Status</Th><Th></Th></tr></thead>
                        <tbody>
                            {(items || []).map((it) => (
                                <tr key={it._id} className="hover:bg-muted/40">
                                    <Td className="font-mono text-xs">{it.sku}</Td>
                                    <Td className="font-medium">{it.name}</Td>
                                    <Td>{it.category}</Td>
                                    <Td>{it.sizeLabel || '—'}</Td>
                                    <Td className="font-medium">{it.retailPrice ? `AED ${it.retailPrice.toFixed(2)}` : '—'}</Td>
                                    <Td>{it.onHand} {it.unit}</Td>
                                    <Td>{it.reorderLevel} {it.unit}</Td>
                                    <Td><Badge tone={tone(it)}>{it.onHand <= 0 ? 'Out' : it.onHand <= it.reorderLevel ? 'Low' : 'OK'}</Badge></Td>
                                    <Td><button onClick={() => { setError(''); setEditItem(it) }} className="p-1 rounded hover:bg-muted"><Pencil size={14} /></button></Td>
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

            {editItem && (
                <Modal open={!!editItem} onClose={() => setEditItem(null)} title={`Edit — ${editItem.name}`}>
                    <EditItemForm item={editItem} busy={updateItem.isPending} error={error} onSubmit={(body) => updateItem.mutate({ id: editItem._id, body })} />
                </Modal>
            )}
        </div>
    )
}

const PRESETS = [
    { sku: 'BOX-SM', name: 'Small Box', category: 'box', sizeLabel: 'Small / 45×45×45 cm', unit: 'pcs' },
    { sku: 'BOX-MD', name: 'Medium Box', category: 'box', sizeLabel: 'Medium / 60×45×45 cm', unit: 'pcs' },
    { sku: 'BOX-LG', name: 'Large Box', category: 'box', sizeLabel: 'Large / 60×60×60 cm', unit: 'pcs' },
    { sku: 'BOX-XL', name: 'Extra Large Box', category: 'box', sizeLabel: 'XL / 75×60×60 cm', unit: 'pcs' },
    { sku: 'BOX-WR', name: 'Wardrobe Box', category: 'box', sizeLabel: 'Wardrobe / 60×50×120 cm', unit: 'pcs' },
    { sku: 'BOX-DISH', name: 'Dish Pack Box', category: 'box', sizeLabel: 'Dish / 45×45×50 cm', unit: 'pcs' },
    { sku: 'BOX-PIC', name: 'Picture / Mirror Box', category: 'box', sizeLabel: 'Flat / 100×75×15 cm', unit: 'pcs' },
    { sku: 'BUB-RL', name: 'Bubble Wrap Roll', category: 'wrap', sizeLabel: '100 m × 50 cm', unit: 'rolls' },
    { sku: 'BUB-SM', name: 'Bubble Wrap Sheet', category: 'wrap', sizeLabel: '50×50 cm', unit: 'pcs' },
    { sku: 'SHRINK-RL', name: 'Shrink Wrap Roll', category: 'wrap', sizeLabel: '500 m', unit: 'rolls' },
    { sku: 'STRCH-RL', name: 'Stretch Wrap Roll', category: 'wrap', sizeLabel: '300 m', unit: 'rolls' },
    { sku: 'TAPE-BR', name: 'Brown Packing Tape', category: 'tape', sizeLabel: '48 mm × 66 m', unit: 'rolls' },
    { sku: 'TAPE-CL', name: 'Clear Packing Tape', category: 'tape', sizeLabel: '48 mm × 66 m', unit: 'rolls' },
    { sku: 'TAPE-FR', name: 'Fragile Tape', category: 'tape', sizeLabel: '48 mm × 66 m', unit: 'rolls' },
    { sku: 'TAPE-MSK', name: 'Masking Tape', category: 'tape', sizeLabel: '24 mm × 50 m', unit: 'rolls' },
    { sku: 'PAD-FRN', name: 'Furniture Pad / Blanket', category: 'protection', sizeLabel: '180×150 cm', unit: 'pcs' },
    { sku: 'FOAM-SH', name: 'Foam Sheet', category: 'protection', sizeLabel: '100×100 cm', unit: 'pcs' },
    { sku: 'PAPER-PK', name: 'Packing Paper', category: 'paper', sizeLabel: '10 kg pack', unit: 'packs' },
    { sku: 'PAPER-NW', name: 'Newsprint Paper', category: 'paper', sizeLabel: '5 kg pack', unit: 'packs' },
    { sku: 'TISSUE-RL', name: 'Tissue Paper Roll', category: 'paper', sizeLabel: '50 m', unit: 'rolls' },
    { sku: 'LABEL-FRG', name: 'Fragile Labels', category: 'label', sizeLabel: 'Roll of 500', unit: 'rolls' },
    { sku: 'LABEL-HU', name: 'This Side Up Labels', category: 'label', sizeLabel: 'Roll of 500', unit: 'rolls' },
    { sku: 'LABEL-RM', name: 'Room Labels (Color)', category: 'label', sizeLabel: 'Pack of 100', unit: 'packs' },
    { sku: 'STRAP-RT', name: 'Ratchet Strap', category: 'strap', sizeLabel: '5 m × 25 mm', unit: 'pcs' },
    { sku: 'ROPE-NY', name: 'Nylon Rope', category: 'strap', sizeLabel: '50 m', unit: 'rolls' },
    { sku: 'ZIP-TIE', name: 'Cable Ties / Zip Ties', category: 'strap', sizeLabel: 'Pack of 100', unit: 'packs' },
    { sku: 'TOOL-CTR', name: 'Box Cutter / Knife', category: 'tool', sizeLabel: '', unit: 'pcs' },
    { sku: 'TOOL-MRK', name: 'Marker Pen', category: 'tool', sizeLabel: 'Black', unit: 'pcs' },
    { sku: 'TOOL-DISP', name: 'Tape Dispenser', category: 'tool', sizeLabel: '', unit: 'pcs' },
    { sku: 'CORNER-PR', name: 'Corner Protectors', category: 'protection', sizeLabel: 'Set of 4', unit: 'sets' },
    { sku: 'MATTBAG', name: 'Mattress Bag', category: 'cover', sizeLabel: 'King Size', unit: 'pcs' },
    { sku: 'SOFACOV', name: 'Sofa Cover', category: 'cover', sizeLabel: '3-Seater', unit: 'pcs' },
    { sku: 'DUST-SH', name: 'Dust Sheet / Drop Cloth', category: 'cover', sizeLabel: '4×5 m', unit: 'pcs' },
]

function ItemForm({ busy, error, onSubmit }: { busy: boolean; error: string; onSubmit: (body: object) => void }) {
    const formRef = useRef<HTMLFormElement>(null)

    function applyPreset(idx: string) {
        const form = formRef.current
        if (!form || idx === '') return
        const p = PRESETS[Number(idx)]
        if (!p) return
        ;(form.elements.namedItem('sku') as HTMLInputElement).value = p.sku
        ;(form.elements.namedItem('name') as HTMLInputElement).value = p.name
        ;(form.elements.namedItem('category') as HTMLInputElement).value = p.category
        ;(form.elements.namedItem('sizeLabel') as HTMLInputElement).value = p.sizeLabel
        ;(form.elements.namedItem('unit') as HTMLSelectElement).value = p.unit
    }

    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onSubmit({
            sku: f.get('sku'),
            name: f.get('name'),
            category: f.get('category'),
            sizeLabel: f.get('sizeLabel'),
            unit: f.get('unit'),
            retailPrice: Number(f.get('retailPrice') || 0),
            onHand: Number(f.get('onHand') || 0),
            reorderLevel: Number(f.get('reorderLevel') || 0),
            notes: f.get('notes'),
        })
    }

    return (
        <form ref={formRef} onSubmit={submit} className="space-y-3">
            <Field label="Quick fill from preset">
                <Select onChange={(e) => applyPreset(e.target.value)} defaultValue="">
                    <option value="">— Select a preset or fill manually —</option>
                    <optgroup label="Boxes">
                        {PRESETS.map((p, i) => p.category === 'box' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Wrapping">
                        {PRESETS.map((p, i) => p.category === 'wrap' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Tape">
                        {PRESETS.map((p, i) => p.category === 'tape' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Paper & Tissue">
                        {PRESETS.map((p, i) => p.category === 'paper' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Protection">
                        {PRESETS.map((p, i) => p.category === 'protection' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Covers">
                        {PRESETS.map((p, i) => p.category === 'cover' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Labels">
                        {PRESETS.map((p, i) => p.category === 'label' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Straps & Ties">
                        {PRESETS.map((p, i) => p.category === 'strap' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}
                    </optgroup>
                    <optgroup label="Tools">
                        {PRESETS.map((p, i) => p.category === 'tool' && <option key={i} value={i}>{p.name}{p.sizeLabel ? ` — ${p.sizeLabel}` : ''}</option>)}
                    </optgroup>
                </Select>
            </Field>
            <hr className="border-border" />
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
            <Field label="Retail Price (AED) — charged to customer per unit">
                <Input name="retailPrice" type="number" min={0} step="0.01" defaultValue={0} placeholder="0.00" />
            </Field>
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
                        <option key={i._id} value={i._id}>{i.sku} - {i.name}{i.sizeLabel ? ` (${i.sizeLabel})` : ''} [{i.onHand} {i.unit}] — AED {(i.retailPrice || 0).toFixed(2)}</option>
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

function EditItemForm({ item, busy, error, onSubmit }: { item: MovingItem; busy: boolean; error: string; onSubmit: (body: object) => void }) {
    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onSubmit({
            sku: f.get('sku'),
            name: f.get('name'),
            category: f.get('category'),
            sizeLabel: f.get('sizeLabel'),
            unit: f.get('unit'),
            retailPrice: Number(f.get('retailPrice') || 0),
            reorderLevel: Number(f.get('reorderLevel') || 0),
            notes: f.get('notes'),
        })
    }

    return (
        <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <Field label="SKU *"><Input name="sku" required defaultValue={item.sku} /></Field>
                <Field label="Name *"><Input name="name" required defaultValue={item.name} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
                <Field label="Category"><Input name="category" defaultValue={item.category} /></Field>
                <Field label="Size"><Input name="sizeLabel" defaultValue={item.sizeLabel} /></Field>
                <Field label="Unit">
                    <Select name="unit" defaultValue={item.unit}>
                        <option value="pcs">pcs</option>
                        <option value="packs">packs</option>
                        <option value="rolls">rolls</option>
                        <option value="sets">sets</option>
                        <option value="other">other</option>
                    </Select>
                </Field>
            </div>
            <Field label="Retail Price (AED) — charged to customer per unit">
                <Input name="retailPrice" type="number" min={0} step="0.01" defaultValue={item.retailPrice || 0} />
            </Field>
            <Field label="Reorder level">
                <Input name="reorderLevel" type="number" min={0} step="1" defaultValue={item.reorderLevel} />
            </Field>
            <Field label="Notes"><Textarea name="notes" defaultValue={item.notes} /></Field>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</Button>
        </form>
    )
}
