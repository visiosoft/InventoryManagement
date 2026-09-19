import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, apiError } from '../../lib/api'
import { Button, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { locationTypes, numeric, readable, types } from '../../lib/warehouse'
import type { Booking, Container, CustomerRef, Location, WarehouseJob } from '../../lib/warehouse'

type ContainerList = { data: Container[] }

const field = '!h-12 !text-base'

/** A finger/mouse-drawn signature, captured as a PNG data URL. Purely a
 *  local canvas — nothing is uploaded until the surrounding form submits. */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const drawn = useRef(false)

  function point(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  function start(e: ReactPointerEvent<HTMLCanvasElement>) {
    canvasRef.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = point(e)
    ctx.beginPath(); ctx.moveTo(x, y)
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'
    const { x, y } = point(e)
    ctx.lineTo(x, y); ctx.stroke()
    drawn.current = true
  }
  function end() {
    if (drawing.current && drawn.current) onChange(canvasRef.current!.toDataURL('image/png'))
    drawing.current = false
  }
  function clear() {
    const canvas = canvasRef.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    drawn.current = false
    onChange(null)
  }

  return <div>
    <canvas ref={canvasRef} width={400} height={140} className="w-full touch-none rounded-lg border bg-white"
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
    <button type="button" onClick={clear} className="mt-1 cursor-pointer text-xs text-zinc-500 underline">Clear signature</button>
  </div>
}

export function DispatchConfirmModal({ open, item, onClose, onConfirm, busy }: {
  open: boolean
  item: Container | undefined
  onClose: () => void
  onConfirm: (notes: string, signatureDataUrl: string | null) => void
  busy: boolean
}) {
  const [pickupType, setPickupType] = useState<'customer' | 'other'>('customer')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  useEffect(() => { if (open) { setPickupType('customer'); setName(''); setPhone(''); setSignature(null) } }, [open])
  if (!item) return null
  const customer = typeof item.customer === 'object' ? item.customer : null

  function submit(e: FormEvent) {
    e.preventDefault()
    if (pickupType === 'other' && !name.trim()) return
    const notes = pickupType === 'customer'
      ? `Picked up by the account holder, ${customer?.fullName || 'the customer'}${customer?.phone ? ` (${customer.phone})` : ''}.`
      : `Picked up by ${name.trim()}${phone.trim() ? ` (${phone.trim()})` : ''} — not the account holder.`
    onConfirm(notes, signature)
  }

  return <Modal open={open} onClose={onClose} title="Confirm handover">
    <form className="space-y-4" onSubmit={submit}>
      <div className="rounded-lg border p-3 text-sm">
        <p className="font-semibold">{item.displayCode}</p>
        <p className="text-zinc-500">{item.description || readable(item.type)}</p>
        {customer && <p className="mt-2 text-zinc-500">Account holder: {customer.fullName}{customer.phone ? ` · ${customer.phone}` : ''}</p>}
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={pickupType === 'customer'} onChange={() => setPickupType('customer')} />{customer?.fullName || 'The account holder'} is collecting it</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={pickupType === 'other'} onChange={() => setPickupType('other')} />Someone else is collecting it</label>
      </div>
      {pickupType === 'other' && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Their name *"><Input value={name} onChange={e => setName(e.target.value)} required className={field} /></Field>
        <Field label="Their phone"><Input value={phone} onChange={e => setPhone(e.target.value)} className={field} /></Field>
      </div>}
      <div>
        <label className="mb-1 block text-xs font-semibold text-zinc-600">Signature (optional)</label>
        <SignaturePad onChange={setSignature} />
      </div>
      <div className="flex gap-2">
        <Button disabled={busy || (pickupType === 'other' && !name.trim())} className="!h-12">{busy ? 'Confirming…' : 'Confirm handover'}</Button>
        <Button type="button" variant="outline" className="!h-12" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  </Modal>
}

export function ReceiveForm({ site, locations, onCreated, lockQuantity, submitLabel }: { site: string; locations: Location[]; onCreated: (items: Container[]) => void; lockQuantity?: boolean; submitLabel?: string }) {
  const [search, setSearch] = useState('')
  const [customer, setCustomer] = useState<CustomerRef | null>(null)
  const [booking, setBooking] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [newCustomerBusy, setNewCustomerBusy] = useState(false)
  const [newCustomerError, setNewCustomerError] = useState('')
  const receipt = useRef<{ key: string; id: string } | null>(null)
  const customers = useQuery<CustomerRef[]>({ queryKey: ['warehouse-customers', search], queryFn: () => api.get('/warehouse/customers', { params: { search } }).then(r => r.data), enabled: search.trim().length >= 2 && !customer })
  const bookings = useQuery<Booking[]>({ queryKey: ['warehouse-bookings', customer?._id], queryFn: () => api.get(`/warehouse/customers/${customer!._id}/bookings`).then(r => r.data), enabled: !!customer })
  const selectedBooking = bookings.data?.find(b => b._id === booking)
  const units = [...new Map([...(selectedBooking?.unit ? [selectedBooking.unit] : []), ...(selectedBooking?.units || [])].map(u => [u._id, u])).values()]
  const warehouses = [...new Set(locations.filter(l => l.kind === 'RECEIVING').map(l => l.warehouse))]

  return <form className="space-y-5" onSubmit={async e => {
    e.preventDefault()
    if (!customer || busy) return
    const data = new FormData(e.currentTarget)
    const payload = { site, customer: customer._id, booking: booking || undefined, unit: data.get('unit') || undefined, warehouse: data.get('warehouse'), type: data.get('type'), quantity: lockQuantity ? 1 : Number(data.get('quantity')), description: data.get('description'), contents: data.get('contents'), condition: data.get('condition'), weight: numeric(data.get('weight')), length: numeric(data.get('length')), width: numeric(data.get('width')), height: numeric(data.get('height')) }
    const key = JSON.stringify(payload)
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try { const { data: result } = await api.post('/warehouse/containers', { ...payload, requestId: receipt.current.id }); receipt.current = null; onCreated(result.containers) } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }}>
    <div><h2 className="text-2xl font-semibold">Receive inventory</h2><p className="mt-1 text-zinc-500">Link existing customer records, create labels, then scan each arrival.</p></div>
    <Field label="Existing customer"><Input className={field} aria-label="Find existing customer" placeholder="Search name, phone or customer reference" value={customer ? `${customer.fullName} · ${customer.clientId}` : search} onChange={e => { setCustomer(null); setBooking(''); setSearch(e.target.value) }} disabled={addingCustomer} /></Field>
    {customers.isError && <p role="alert" className="text-red-700">{apiError(customers.error)}</p>}
    {!customer && !addingCustomer && search.length >= 2 && <div className="divide-y rounded-xl border">{customers.isFetching ? <p className="p-3">Searching…</p> : customers.data?.length ? customers.data.map(c => <button type="button" key={c._id} className="block min-h-12 w-full px-4 py-3 text-left hover:bg-zinc-50" onClick={() => { setCustomer(c); setBooking('') }}>{c.fullName} <span className="text-zinc-500">{c.clientId}</span></button>) : <p className="p-3 text-zinc-500">No matching customers.</p>}</div>}
    {!customer && !addingCustomer && <Button type="button" variant="outline" onClick={() => setAddingCustomer(true)}>+ New customer, not in the system yet</Button>}
    {addingCustomer && <form className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4" onSubmit={async e => {
      e.preventDefault()
      const data = new FormData(e.currentTarget)
      const fullName = String(data.get('fullName') || '').trim()
      if (!fullName) { setNewCustomerError('Name is required.'); return }
      setNewCustomerBusy(true); setNewCustomerError('')
      try {
        const { data: created } = await api.post('/customers', { fullName, phone: data.get('phone'), email: data.get('email'), address: data.get('address') })
        setCustomer({ _id: created._id, fullName: created.fullName, clientId: created.clientId || '', phone: created.phone || '', address: created.address || '' })
        setBooking(''); setAddingCustomer(false); setSearch('')
      } catch (err) { setNewCustomerError(apiError(err)) } finally { setNewCustomerBusy(false) }
    }}>
      <h3 className="font-semibold">New customer</h3>
      <Field label="Full name *"><Input name="fullName" aria-label="Full name" required className={field} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone"><Input name="phone" aria-label="Phone" className={field} /></Field>
        <Field label="Email"><Input name="email" aria-label="Email" type="email" className={field} /></Field>
      </div>
      <Field label="Address"><Input name="address" aria-label="Address" placeholder="For pickup/delivery — optional" className={field} /></Field>
      {newCustomerError && <p role="alert" className="text-red-700">{newCustomerError}</p>}
      <div className="flex gap-2">
        <Button disabled={newCustomerBusy} className="!h-12">{newCustomerBusy ? 'Creating…' : 'Create customer'}</Button>
        <Button type="button" variant="outline" className="!h-12" onClick={() => { setAddingCustomer(false); setNewCustomerError('') }}>Cancel</Button>
      </div>
    </form>}
    {bookings.isError && <p role="alert" className="text-red-700">Could not load bookings: {apiError(bookings.error)}</p>}
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Booking / contract (optional)"><Select aria-label="Booking" className={field} value={booking} onChange={e => setBooking(e.target.value)}><option value="">No booking</option>{bookings.data?.map(b => <option key={b._id} value={b._id}>{b.contractNo} · {b.status}</option>)}</Select></Field>
      <Field label="Storage unit (optional)"><Select key={booking} name="unit" aria-label="Storage unit" className={field}><option value="">No unit</option>{units.map(u => <option key={u._id} value={u._id}>{u.unitNumber}</option>)}</Select></Field>
      <Field label="Warehouse"><Select name="warehouse" aria-label="Warehouse" required className={field}><option value="">Choose warehouse</option>{warehouses.map(w => <option key={w}>{w}</option>)}</Select></Field>
      <Field label="Container type"><Select name="type" aria-label="Container type" className={field}>{types.map(t => <option value={t} key={t}>{readable(t)}</option>)}</Select></Field>
      {!lockQuantity && <Field label="Quantity (1–50)"><Input name="quantity" aria-label="Quantity" type="number" min={1} max={50} defaultValue={1} required className={field} /></Field>}
      <Field label="Condition"><Select name="condition" aria-label="Condition" className={field}><option value="GOOD">Good</option><option value="WORN">Worn</option><option value="DAMAGED">Damaged on arrival</option></Select></Field></div>
    {!warehouses.length && <p className="text-amber-800">A supervisor must create a receiving area under Locations before receiving inventory.</p>}
    <Field label="Description"><Input name="description" aria-label="Description" maxLength={1000} placeholder="Winter clothes" className={field} /></Field>
    <Field label="Contents"><Textarea name="contents" aria-label="Contents" maxLength={4000} placeholder="General description of the contents" /></Field>
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[['weight', 'Weight (kg)'], ['length', 'Length (cm)'], ['width', 'Width (cm)'], ['height', 'Height (cm)']].map(([name, label]) => <Field key={name} label={label}><Input name={name} aria-label={label} type="number" min={0} step="any" className={field} /></Field>)}</div>
    <p className="text-sm text-zinc-500">Dimensions and descriptions apply to each item in this batch.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    <Button className="!h-14 w-full sm:w-auto" disabled={busy || !customer || !warehouses.length}>{busy ? 'Creating…' : (submitLabel || 'Create items & prepare labels')}</Button>
  </form>
}

export function EditLocationForm({ location, onSaved, onCancel }: { location: Location; onSaved: () => void; onCancel: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const receipt = useRef<{ key: string; id: string } | null>(null)
  return <form className="mt-3 grid gap-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4 sm:grid-cols-2" onSubmit={async e => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const payload = { name: data.get('name'), maxContainers: numeric(data.get('maxContainers')), maxWeight: numeric(data.get('maxWeight')), maxVolume: numeric(data.get('maxVolume')) }
    const key = JSON.stringify(payload)
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try { await api.patch(`/warehouse/locations/${location._id}`, { ...payload, requestId: receipt.current.id }); receipt.current = null; onSaved() } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }}>
    <Field label="Location name"><Input name="name" aria-label="Location name" required maxLength={120} defaultValue={location.name} className={field} /></Field>
    <div />
    {[['maxContainers', 'Maximum containers', location.maxContainers], ['maxWeight', 'Maximum weight (kg)', location.maxWeight], ['maxVolume', 'Maximum volume (m³)', location.maxVolume]].map(([name, label, value]) => <Field key={name as string} label={label as string}><Input name={name as string} aria-label={label as string} type="number" min={0} step="any" defaultValue={value ?? ''} placeholder="No limit" className={field} /></Field>)}
    {error && <p role="alert" className="sm:col-span-2 text-red-700">{error}</p>}
    <div className="flex gap-2 sm:col-span-2">
      <Button disabled={busy} className="!h-12">{busy ? 'Saving…' : 'Save changes'}</Button>
      <Button type="button" variant="outline" className="!h-12" onClick={onCancel}>Cancel</Button>
    </div>
  </form>
}

export function EditContainerForm({ item, onSaved, onCancel }: { item: Container; onSaved: () => void; onCancel: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = item.currentStatus === 'IN_STORAGE'
  const receipt = useRef<{ key: string; id: string } | null>(null)
  return <form className="mt-3 grid gap-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4 sm:grid-cols-2" onSubmit={async e => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const payload: Record<string, unknown> = { description: data.get('description'), contents: data.get('contents'), condition: data.get('condition') }
    if (!locked) Object.assign(payload, { weight: numeric(data.get('weight')), length: numeric(data.get('length')), width: numeric(data.get('width')), height: numeric(data.get('height')) })
    const key = JSON.stringify(payload)
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try { await api.patch(`/warehouse/containers/${item._id}`, { ...payload, requestId: receipt.current.id }); receipt.current = null; onSaved() } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }}>
    <Field label="Description" className="sm:col-span-2"><Input name="description" aria-label="Description" maxLength={1000} defaultValue={item.description} className={field} /></Field>
    <Field label="Contents" className="sm:col-span-2"><Textarea name="contents" aria-label="Contents" maxLength={4000} defaultValue={item.contents} /></Field>
    <Field label="Condition"><Select name="condition" aria-label="Condition" defaultValue={item.condition} className={field}><option value="GOOD">Good</option><option value="WORN">Worn</option><option value="DAMAGED">Damaged</option></Select></Field>
    <div />
    {locked
      ? <p className="text-sm text-zinc-500 sm:col-span-2">Weight and dimensions can’t be changed while this item is in storage — relocate it first if they need fixing.</p>
      : [['weight', 'Weight (kg)', item.weight], ['length', 'Length (cm)', item.length], ['width', 'Width (cm)', item.width], ['height', 'Height (cm)', item.height]].map(([name, label, value]) => <Field key={name as string} label={label as string}><Input name={name as string} aria-label={label as string} type="number" min={0} step="any" defaultValue={value ?? ''} className={field} /></Field>)}
    {error && <p role="alert" className="sm:col-span-2 text-red-700">{error}</p>}
    <div className="flex gap-2 sm:col-span-2">
      <Button disabled={busy} className="!h-12">{busy ? 'Saving…' : 'Save changes'}</Button>
      <Button type="button" variant="outline" className="!h-12" onClick={onCancel}>Cancel</Button>
    </div>
  </form>
}

export function JobForm({ site, locations, onCreated }: { site: string; locations: Location[]; onCreated: () => void }) {
  const [type, setType] = useState<'PICKUP' | 'DELIVERY'>('PICKUP')
  const [search, setSearch] = useState('')
  const [customer, setCustomer] = useState<CustomerRef | null>(null)
  const [address, setAddress] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const receipt = useRef<{ key: string; id: string } | null>(null)
  const warehouses = [...new Set(locations.map(l => l.warehouse))]
  const customers = useQuery<CustomerRef[]>({ queryKey: ['warehouse-customers', search], queryFn: () => api.get('/warehouse/customers', { params: { search } }).then(r => r.data), enabled: search.trim().length >= 2 && !customer })
  const stored = useQuery<ContainerList>({ queryKey: ['warehouse-stored-for-job', site, customer?._id], queryFn: () => api.get('/warehouse/containers', { params: { site, customer: customer!._id, status: 'IN_STORAGE', limit: 100 } }).then(r => r.data), enabled: type === 'DELIVERY' && !!customer })

  function choose(c: CustomerRef) {
    setCustomer(c); setSearch(''); setSelected([])
    if (!address) setAddress(c.address || '')
  }

  return <form className="space-y-4 rounded-xl border p-5" onSubmit={async e => {
    e.preventDefault(); if (busy || !customer) return
    const data = new FormData(e.currentTarget)
    const payload = { site, warehouse: data.get('warehouse'), type, customer: customer._id, address, notes: data.get('notes'), partnerName: data.get('partnerName'), partnerPhone: data.get('partnerPhone'), containers: type === 'DELIVERY' ? selected : undefined }
    const key = JSON.stringify(payload)
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      await api.post('/warehouse/jobs', { ...payload, requestId: receipt.current.id })
      receipt.current = null
      const form = e.currentTarget; form.reset()
      setCustomer(null); setAddress(''); setSelected([])
      onCreated()
    } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }}>
    <h3 className="text-xl font-semibold">Log a pickup or delivery</h3>
    <div className="flex gap-4">
      <label className="flex items-center gap-2 text-sm"><input type="radio" checked={type === 'PICKUP'} onChange={() => { setType('PICKUP'); setSelected([]) }} />Pick up from customer</label>
      <label className="flex items-center gap-2 text-sm"><input type="radio" checked={type === 'DELIVERY'} onChange={() => { setType('DELIVERY'); setSelected([]) }} />Deliver to customer</label>
    </div>
    <Field label="Customer"><Input className={field} aria-label="Find customer" placeholder="Search name, phone or customer reference" value={customer ? `${customer.fullName} · ${customer.clientId}` : search} onChange={e => { setCustomer(null); setSearch(e.target.value) }} /></Field>
    {!customer && search.length >= 2 && <div className="divide-y rounded-xl border">{customers.isFetching ? <p className="p-3">Searching…</p> : customers.data?.length ? customers.data.map(c => <button type="button" key={c._id} className="block min-h-12 w-full px-4 py-3 text-left hover:bg-zinc-50" onClick={() => choose(c)}>{c.fullName} <span className="text-zinc-500">{c.clientId}</span></button>) : <p className="p-3 text-zinc-500">No matching customers.</p>}</div>}
    <Field label="Warehouse"><Select name="warehouse" aria-label="Warehouse" required className={field}><option value="">Choose warehouse</option>{warehouses.map(w => <option key={w}>{w}</option>)}</Select></Field>
    <Field label={type === 'PICKUP' ? 'Pickup address' : 'Delivery address'}><Textarea aria-label="Address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Where the partner should go" /></Field>
    {type === 'DELIVERY' && customer && <div>
      <p className="mb-2 text-sm font-semibold">Items to deliver</p>
      {stored.isFetching ? <p className="text-sm text-zinc-500">Loading stored items…</p> : stored.data?.data.length ? <div className="divide-y rounded-xl border">{stored.data.data.map(c => <label key={c._id} className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm"><input type="checkbox" checked={selected.includes(c._id)} onChange={e => setSelected(s => e.target.checked ? [...s, c._id] : s.filter(id => id !== c._id))} />{c.displayCode} · {c.description || readable(c.type)}</label>)}</div> : <p className="text-sm text-zinc-500">This customer has no stored items.</p>}
    </div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Partner name (if known)"><Input name="partnerName" aria-label="Partner name" className={field} /></Field>
      <Field label="Partner phone"><Input name="partnerPhone" aria-label="Partner phone" className={field} /></Field>
    </div>
    <Field label="Notes"><Textarea name="notes" aria-label="Notes" placeholder="What to expect / special instructions" /></Field>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <Button disabled={busy || !customer || !address.trim() || (type === 'DELIVERY' && !selected.length)} className="!h-12">{busy ? 'Logging…' : 'Log job'}</Button>
  </form>
}

export function AssignJobForm({ job, onSaved, onCancel }: { job: WarehouseJob; onSaved: () => void; onCancel: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const receipt = useRef<{ key: string; id: string } | null>(null)
  return <form className="mt-3 grid gap-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4 sm:grid-cols-2" onSubmit={async e => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const payload = { partnerName: data.get('partnerName'), partnerPhone: data.get('partnerPhone') }
    const key = JSON.stringify(payload)
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try { await api.patch(`/warehouse/jobs/${job._id}`, { ...payload, requestId: receipt.current.id }); receipt.current = null; onSaved() } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }}>
    <Field label="Partner name"><Input name="partnerName" aria-label="Partner name" required defaultValue={job.partnerName} className={field} /></Field>
    <Field label="Partner phone"><Input name="partnerPhone" aria-label="Partner phone" defaultValue={job.partnerPhone} className={field} /></Field>
    {error && <p role="alert" className="sm:col-span-2 text-red-700">{error}</p>}
    <div className="flex gap-2 sm:col-span-2">
      <Button disabled={busy} className="!h-12">{busy ? 'Saving…' : 'Assign partner'}</Button>
      <Button type="button" variant="outline" className="!h-12" onClick={onCancel}>Cancel</Button>
    </div>
  </form>
}

export function LinkContainersForm({ job, onSaved, onCancel }: { job: WarehouseJob; onSaved: () => void; onCancel: () => void }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const customerId = typeof job.customer === 'object' ? job.customer._id : job.customer
  const results = useQuery<ContainerList>({ queryKey: ['warehouse-job-link-search', job.site, customerId, search], queryFn: () => api.get('/warehouse/containers', { params: { site: job.site, customer: customerId, search: search || undefined, limit: 30 } }).then(r => r.data), enabled: search.trim().length >= 1 })
  return <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
    <Field label="Find items to link"><Input className={field} aria-label="Search items" placeholder="Item code or description" value={search} onChange={e => setSearch(e.target.value)} /></Field>
    {search.length >= 1 && <div className="mt-2 divide-y rounded-xl border bg-white">{results.isFetching ? <p className="p-3 text-sm">Searching…</p> : results.data?.data.length ? results.data.data.filter(c => !job.containers.includes(c._id)).map(c => <label key={c._id} className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm"><input type="checkbox" checked={selected.includes(c._id)} onChange={e => setSelected(s => e.target.checked ? [...s, c._id] : s.filter(id => id !== c._id))} />{c.displayCode} · {c.description || readable(c.type)} · <span className="text-zinc-500">{readable(c.currentStatus)}</span></label>) : <p className="p-3 text-sm text-zinc-500">No matching items for this customer.</p>}</div>}
    {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    <div className="mt-3 flex gap-2">
      <Button disabled={busy || !selected.length} className="!h-12" onClick={async () => {
        setBusy(true); setError('')
        try { await api.patch(`/warehouse/jobs/${job._id}`, { addContainers: selected, requestId: crypto.randomUUID() }); onSaved() } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
      }}>{busy ? 'Linking…' : `Link ${selected.length || ''} item${selected.length === 1 ? '' : 's'}`}</Button>
      <Button type="button" variant="outline" className="!h-12" onClick={onCancel}>Cancel</Button>
    </div>
  </div>
}

export function LocationForm({ site, locations, onCreated }: { site: string; locations: Location[]; onCreated: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const receipt = useRef<{ key: string; id: string } | null>(null)
  return <form className="space-y-4 rounded-xl border p-5" onSubmit={async e => {
    e.preventDefault(); if (busy) return
    const form = e.currentTarget, data = new FormData(form)
    const payload = { site, name: data.get('name'), warehouse: data.get('warehouse'), kind: data.get('kind'), parent: data.get('parent') || undefined, maxContainers: numeric(data.get('maxContainers')), maxWeight: numeric(data.get('maxWeight')), maxVolume: numeric(data.get('maxVolume')) }
    const key = JSON.stringify(payload)
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }
    setBusy(true); setError('')
    try { await api.post('/warehouse/locations', { ...payload, requestId: receipt.current.id }); receipt.current = null; form.reset(); onCreated() } catch (err) { setError(apiError(err)) } finally { setBusy(false) }
  }}>
    <h3 className="text-xl font-semibold">Create a location</h3>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Location name"><Input name="name" aria-label="Location name" required maxLength={120} placeholder="Rack B12 · Shelf 04" className={field} /></Field>
      <Field label="Warehouse code"><Input name="warehouse" aria-label="Warehouse code" required pattern="[A-Za-z0-9-]{1,32}" placeholder="WH1" className={field} /></Field>
      <Field label="Location type"><Select name="kind" aria-label="Location type" defaultValue="SHELF" className={field}>{locationTypes.map(k => <option key={k} value={k}>{readable(k)}</option>)}</Select></Field>
      <Field label="Parent (optional)"><Select name="parent" aria-label="Parent location" className={field}><option value="">No parent</option>{locations.map(l => <option key={l._id} value={l._id}>{l.warehouse} · {l.name}</option>)}</Select></Field>
      {[['maxContainers', 'Maximum containers', '1'], ['maxWeight', 'Maximum weight (kg)', 'any'], ['maxVolume', 'Maximum volume (m³)', 'any']].map(([name, label, step]) => <Field key={name} label={label}><Input name={name} aria-label={label} type="number" min={name === 'maxContainers' ? 1 : 0} step={step} placeholder="No limit" className={field} /></Field>)}</div>
    <p className="text-sm text-zinc-500">Capacity limits apply to storage racks, shelves and bins. Labels use unique location IDs.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <Button disabled={busy} className="!h-12">{busy ? 'Creating…' : 'Create location'}</Button>
  </form>
}
