import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Pencil, Plus, RefreshCw, Trash2, Search, Package, AlertCircle, Activity } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from '../components/ui'
import { formatDate } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

type MovingItem = {
    _id: string; sku: string; name: string; category: string; sizeLabel?: string
    unit: string; retailPrice: number; onHand: number; reorderLevel: number; active: boolean; notes?: string
}

type MovingTxn = {
    _id: string
    item: { _id: string; sku: string; name: string; sizeLabel?: string; unit: string }
    txnType: 'in' | 'out' | 'adjustment' | 'transfer' | 'return'
    qty: number; previousOnHand: number; resultingOnHand: number
    reason?: string; takenBy?: string
    contract?: { _id: string; contractNo: string }
    customer?: { _id: string; fullName: string }
    txnDate: string; notes?: string
}

type Summary = { totalItems: number; lowStock: number; outOfStock: number; txToday: number }

function tone(item: MovingItem) {
    if (item.onHand <= 0) return 'red'
    if (item.onHand <= item.reorderLevel) return 'amber'
    return 'green'
}

function StatCard({ label, value, sub, icon, iconBg, iconColor }: {
    label: string; value: string | number; sub?: string; icon: React.ReactNode; iconBg: string; iconColor: string
}) {
    return (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }}>
            <div className="flex justify-between items-start">
                <div style={{ fontSize: 13, color: MUTED, fontWeight: 500 }}>{label}</div>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBg, display: 'grid', placeItems: 'center', color: iconColor }}>
                    {icon}
                </div>
            </div>
            <div style={{ ...HEADING, fontSize: 32, fontWeight: 700, color: INK, marginTop: 8 }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{sub}</div>}
        </div>
    )
}

export default function MovingInventory() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [showLow, setShowLow] = useState(false)
    const [addOpen, setAddOpen] = useState(false)
    const [editItem, setEditItem] = useState<MovingItem | null>(null)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [txnOpen, setTxnOpen] = useState(false)
    const [editTxn, setEditTxn] = useState<MovingTxn | null>(null)
    const [deleteTxnId, setDeleteTxnId] = useState<string | null>(null)
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

    const deleteItem = useMutation({
        mutationFn: (id: string) => api.delete(`/moving-inventory/items/${id}`),
        onSuccess: () => { invalidate(); setDeleteId(null); setError('') },
        onError: (e) => setError(apiError(e)),
    })

    const addTxn = useMutation({
        mutationFn: (body: object) => api.post('/moving-inventory/transactions', body),
        onSuccess: () => { invalidate(); setTxnOpen(false); setError('') },
        onError: (e) => setError(apiError(e)),
    })

    const updateTxn = useMutation({
        mutationFn: ({ id, body }: { id: string; body: object }) => api.put(`/moving-inventory/transactions/${id}`, body),
        onSuccess: () => { invalidate(); setEditTxn(null); setError('') },
        onError: (e) => setError(apiError(e)),
    })

    const deleteTxn = useMutation({
        mutationFn: (id: string) => api.delete(`/moving-inventory/transactions/${id}`),
        onSuccess: () => { invalidate(); setDeleteTxnId(null); setError('') },
        onError: (e) => setError(apiError(e)),
    })

    return (
        <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
            {/* Top bar */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
                <div>
                    <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Moving Ops Inventory</div>
                    <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>Boxes, packing stock, and movement history</div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => invalidate()}
                        style={{ height: 40, borderRadius: 10, background: '#F3F0EA', color: MUTED, fontSize: 14, fontWeight: 600, padding: '0 16px' }}
                        className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <RefreshCw size={14} />Refresh
                    </button>
                    <button onClick={() => { setError(''); setTxnOpen(true) }}
                        style={{ height: 40, borderRadius: 10, background: '#F3F0EA', color: MUTED, fontSize: 14, fontWeight: 600, padding: '0 16px' }}
                        className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        Record movement
                    </button>
                    <button onClick={() => { setError(''); setAddOpen(true) }}
                        style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 14, fontWeight: 600, padding: '0 20px' }}
                        className="flex items-center gap-2 hover:opacity-90 transition-opacity">
                        <Plus size={16} />Add item
                    </button>
                </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
                <StatCard label="Active Items" value={summary?.totalItems ?? 0} sub="in stock" icon={<Package size={18} />} iconBg="#F3F0EA" iconColor={MUTED} />
                <StatCard label="Low Stock" value={summary?.lowStock ?? 0} sub="needs reorder" icon={<AlertTriangle size={18} />} iconBg="#FFF7ED" iconColor="#EA580C" />
                <StatCard label="Out of Stock" value={summary?.outOfStock ?? 0} sub="empty" icon={<AlertCircle size={18} />} iconBg="#FEF2F2" iconColor="#EF4444" />
                <StatCard label="Movements Today" value={summary?.txToday ?? 0} sub="transactions" icon={<Activity size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
            </div>

            {/* Search + filter */}
            <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
                <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3 flex-1">
                    <Search size={16} color={MUTED} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search SKU, name, size…"
                        style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: INK }}
                    />
                </div>
                <button onClick={() => setShowLow(v => !v)}
                    style={{
                        height: 40, borderRadius: 10,
                        background: showLow ? PURPLE : '#F3F0EA',
                        color: showLow ? 'white' : MUTED,
                        fontSize: 13, fontWeight: 600, padding: '0 14px', border: 'none',
                    }}
                    className="flex items-center gap-2 hover:opacity-90 transition-opacity whitespace-nowrap">
                    <AlertTriangle size={13} />Low stock only
                </button>
            </div>

            {/* Stock on hand table */}
            {isLoading ? (
                <div className="flex justify-center py-16"><Spinner /></div>
            ) : (
                <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
                    <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>Stock on hand</div>
                        <div style={{ fontSize: 12, color: MUTED }}>{items?.length ?? 0} items</div>
                    </div>
                    {(items || []).length === 0 ? (
                        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                            <div style={{ fontSize: 13, color: MUTED }}>No inventory items found.</div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                                        {['SKU', 'Item', 'Category', 'Size', 'Price', 'On hand', 'Reorder', 'Status', ''].map((h, i) => (
                                            <th key={h || i} style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(items || []).map(it => (
                                        <tr key={it._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                                            <td style={{ padding: '12px 16px', fontSize: 12, fontFamily: 'monospace', color: MUTED }}>{it.sku}</td>
                                            <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500, color: INK }}>{it.name}</td>
                                            <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{it.category}</td>
                                            <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{it.sizeLabel || '—'}</td>
                                            <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: INK }}>{it.retailPrice ? `AED ${it.retailPrice.toFixed(2)}` : '—'}</td>
                                            <td style={{ padding: '12px 16px', fontSize: 13, color: INK }}>{it.onHand} {it.unit}</td>
                                            <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{it.reorderLevel} {it.unit}</td>
                                            <td style={{ padding: '12px 16px' }}>
                                                <Badge tone={tone(it)}>{it.onHand <= 0 ? 'Out' : it.onHand <= it.reorderLevel ? 'Low' : 'OK'}</Badge>
                                            </td>
                                            <td style={{ padding: '12px 16px' }}>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => { setError(''); setEditItem(it) }} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}><Pencil size={14} /></button>
                                                    <button onClick={() => setDeleteId(it._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}><Trash2 size={14} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Recent movements table */}
            <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>Recent movements</div>
                    <div style={{ fontSize: 12, color: MUTED }}>Latest stock transactions</div>
                </div>
                {(txns || []).length === 0 ? (
                    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
                        <div style={{ fontSize: 13, color: MUTED }}>No stock movements yet.</div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                                    {['Date', 'Item', 'Type', 'Qty', 'By', 'Reason', 'Stock', ''].map((h, i) => (
                                        <th key={h || i} style={{ padding: '10px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {(txns || []).map(t => (
                                    <tr key={t._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{formatDate(t.txnDate)}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: INK }}>{t.item?.name} {t.item?.sizeLabel ? `(${t.item.sizeLabel})` : ''}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 11, textTransform: 'uppercase', fontWeight: 600, color: MUTED }}>{t.txnType}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: INK }}>{t.qty}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{t.takenBy || '—'}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.reason || t.notes || '—'}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{t.previousOnHand} → {t.resultingOnHand}</td>
                                        <td style={{ padding: '12px 16px' }}>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => { setError(''); setEditTxn(t) }} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}><Pencil size={14} /></button>
                                                <button onClick={() => setDeleteTxnId(t._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}><Trash2 size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

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

            <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Inventory Item">
                <div className="space-y-4">
                    <p className="text-sm">Are you sure? If this item has stock transactions it will be deactivated instead of permanently deleted.</p>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
                        <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteItem.mutate(deleteId)} disabled={deleteItem.isPending}>
                            {deleteItem.isPending ? 'Deleting…' : 'Delete Item'}
                        </Button>
                    </div>
                </div>
            </Modal>

            {editTxn && (
                <Modal open={!!editTxn} onClose={() => setEditTxn(null)} title="Edit Movement">
                    <EditTxnForm txn={editTxn} busy={updateTxn.isPending} error={error} onSubmit={(body) => updateTxn.mutate({ id: editTxn._id, body })} />
                </Modal>
            )}

            <Modal open={!!deleteTxnId} onClose={() => setDeleteTxnId(null)} title="Delete Movement">
                <div className="space-y-4">
                    <p className="text-sm">Are you sure you want to delete this stock movement? The item's on-hand quantity will be reversed accordingly.</p>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setDeleteTxnId(null)}>Cancel</Button>
                        <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteTxnId && deleteTxn.mutate(deleteTxnId)} disabled={deleteTxn.isPending}>
                            {deleteTxn.isPending ? 'Deleting…' : 'Delete Movement'}
                        </Button>
                    </div>
                </div>
            </Modal>
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
            sku: f.get('sku'), name: f.get('name'), category: f.get('category'),
            sizeLabel: f.get('sizeLabel'), unit: f.get('unit'),
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
                    <optgroup label="Boxes">{PRESETS.map((p, i) => p.category === 'box' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Wrapping">{PRESETS.map((p, i) => p.category === 'wrap' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Tape">{PRESETS.map((p, i) => p.category === 'tape' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Paper & Tissue">{PRESETS.map((p, i) => p.category === 'paper' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Protection">{PRESETS.map((p, i) => p.category === 'protection' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Covers">{PRESETS.map((p, i) => p.category === 'cover' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Labels">{PRESETS.map((p, i) => p.category === 'label' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Straps & Ties">{PRESETS.map((p, i) => p.category === 'strap' && <option key={i} value={i}>{p.name} — {p.sizeLabel}</option>)}</optgroup>
                    <optgroup label="Tools">{PRESETS.map((p, i) => p.category === 'tool' && <option key={i} value={i}>{p.name}{p.sizeLabel ? ` — ${p.sizeLabel}` : ''}</option>)}</optgroup>
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
                        <option value="pcs">pcs</option><option value="packs">packs</option><option value="rolls">rolls</option><option value="sets">sets</option><option value="other">other</option>
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
            item: f.get('item'), txnType: f.get('txnType'), qty: Number(f.get('qty') || 0),
            takenBy: f.get('takenBy'), reason: f.get('reason'), notes: f.get('notes'),
            txnDate: f.get('txnDate'), contract: f.get('contract') || undefined, customer: f.get('customer') || undefined,
        })
    }
    return (
        <form onSubmit={submit} className="space-y-3">
            <Field label="Item *">
                <Select name="item" required>
                    <option value="">Select item</option>
                    {items.map(i => <option key={i._id} value={i._id}>{i.sku} - {i.name}{i.sizeLabel ? ` (${i.sizeLabel})` : ''} [{i.onHand} {i.unit}] — AED {(i.retailPrice || 0).toFixed(2)}</option>)}
                </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Movement type">
                    <Select name="txnType" defaultValue="out">
                        <option value="out">Out (issue/use)</option><option value="in">In (purchase/restock)</option><option value="return">Return</option><option value="adjustment">Adjustment (+/-)</option><option value="transfer">Transfer out</option>
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

function EditTxnForm({ txn, busy, error, onSubmit }: { txn: MovingTxn; busy: boolean; error: string; onSubmit: (body: object) => void }) {
    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onSubmit({
            txnType: f.get('txnType'), qty: Number(f.get('qty') || 0),
            takenBy: f.get('takenBy'), reason: f.get('reason'), notes: f.get('notes'),
            txnDate: f.get('txnDate') || undefined,
        })
    }
    return (
        <form onSubmit={submit} className="space-y-3">
            <Field label="Item"><Input disabled value={`${txn.item?.sku} - ${txn.item?.name}${txn.item?.sizeLabel ? ` (${txn.item.sizeLabel})` : ''}`} /></Field>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Movement type">
                    <Select name="txnType" defaultValue={txn.txnType}>
                        <option value="out">Out (issue/use)</option><option value="in">In (purchase/restock)</option><option value="return">Return</option><option value="adjustment">Adjustment (+/-)</option><option value="transfer">Transfer out</option>
                    </Select>
                </Field>
                <Field label="Quantity *"><Input name="qty" type="number" step="1" required defaultValue={txn.qty} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Taken by"><Input name="takenBy" defaultValue={txn.takenBy} /></Field>
                <Field label="Date"><Input name="txnDate" type="datetime-local" defaultValue={txn.txnDate ? new Date(txn.txnDate).toISOString().slice(0, 16) : ''} /></Field>
            </div>
            <Field label="Reason"><Input name="reason" defaultValue={txn.reason} /></Field>
            <Field label="Notes"><Textarea name="notes" defaultValue={txn.notes} /></Field>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</Button>
        </form>
    )
}

function EditItemForm({ item, busy, error, onSubmit }: { item: MovingItem; busy: boolean; error: string; onSubmit: (body: object) => void }) {
    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onSubmit({
            sku: f.get('sku'), name: f.get('name'), category: f.get('category'),
            sizeLabel: f.get('sizeLabel'), unit: f.get('unit'),
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
                        <option value="pcs">pcs</option><option value="packs">packs</option><option value="rolls">rolls</option><option value="sets">sets</option><option value="other">other</option>
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
