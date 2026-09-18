import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, apiError } from '../../lib/api'
import { Button, Field, Input, Select, Textarea } from '../../components/ui'
import { locationTypes, numeric, readable, types } from '../../lib/warehouse'
import type { Booking, Container, CustomerRef, Location } from '../../lib/warehouse'

const field = '!h-12 !text-base'

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
        const { data: created } = await api.post('/customers', { fullName, phone: data.get('phone'), email: data.get('email') })
        setCustomer({ _id: created._id, fullName: created.fullName, clientId: created.clientId || '' })
        setBooking(''); setAddingCustomer(false); setSearch('')
      } catch (err) { setNewCustomerError(apiError(err)) } finally { setNewCustomerBusy(false) }
    }}>
      <h3 className="font-semibold">New customer</h3>
      <Field label="Full name *"><Input name="fullName" aria-label="Full name" required className={field} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone"><Input name="phone" aria-label="Phone" className={field} /></Field>
        <Field label="Email"><Input name="email" aria-label="Email" type="email" className={field} /></Field>
      </div>
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
