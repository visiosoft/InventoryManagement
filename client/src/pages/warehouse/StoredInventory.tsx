import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCircle2, MapPin, Package, Printer, ScanLine, Search, X } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useSite } from '../../lib/site'
import { Button, Input, Select } from '../../components/ui'
import WarehouseScanner from '../../components/WarehouseScanner'
import { LocationForm, ReceiveForm, EditLocationForm, EditContainerForm } from './WarehouseForms'
import { readable } from '../../lib/warehouse'
import type { Container, Location, PendingScan, ScanCommand, ScanResult } from '../../lib/warehouse'

type Tab = 'Guided' | 'Today' | 'Scan' | 'Receive' | 'Inventory' | 'Locations' | 'Labels'
type Event = { _id: string; eventType: string; timestamp: string; employee?: { name: string }; previousStatus?: string; newStatus?: string; previousLocation?: string; currentLocation?: string; notes?: string }
const statusClass = (status: string) => status === 'IN_STORAGE' ? 'bg-emerald-50 text-emerald-800' : status === 'DISPATCHED' ? 'bg-zinc-100 text-zinc-600' : 'bg-amber-50 text-amber-800'

function PrivatePhoto({ id }: { id: string }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true, objectUrl = ''
    void api.get(`/warehouse/photos/${id}`, { responseType: 'blob' }).then(r => {
      if (!active) return
      objectUrl = URL.createObjectURL(r.data); setUrl(objectUrl)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id])
  return url ? <img src={url} alt="Stored item condition" className="h-32 w-32 rounded-xl border object-cover" /> : <div className="grid h-32 w-32 place-items-center rounded-xl bg-zinc-100 text-xs">{error ? 'Photo unavailable' : 'Loading photo…'}</div>
}

export default function StoredInventory() {
  const { siteId } = useSite()
  const { user } = useAuth()
  return <WarehouseWorkspace key={`${siteId}:${user?.id}`} site={siteId || ''} userId={user?.id || ''} />
}

function WarehouseWorkspace({ site, userId }: { site: string; userId: string }) {
  const { user } = useAuth()
  const supervisor = user?.role === 'admin' || user?.permissions.includes('warehouse_supervisor')
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('Guided')
  const [wizard, setWizard] = useState<'menu' | 'receive' | 'dispatch'>('menu')
  const [wizardLabelConfirmed, setWizardLabelConfirmed] = useState(false)
  function startWizard(mode: 'receive' | 'dispatch') {
    setWizard(mode); setWizardLabelConfirmed(false); setSelected(''); setScannedItem(''); setScannedLocation(null)
  }
  function endWizard() {
    setWizard('menu'); setWizardLabelConfirmed(false); setSelected(''); setScannedItem(''); setScannedLocation(null)
  }
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState('')
  const [scannedItem, setScannedItem] = useState('')
  const [scannedLocation, setScannedLocation] = useState<Location | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const [printUrl, setPrintUrl] = useState('')
  const [format, setFormat] = useState('4x6')
  const [labelCodes, setLabelCodes] = useState<string[]>([])
  const [editingLocation, setEditingLocation] = useState('')
  const [editingItem, setEditingItem] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const queueKey = `pb_warehouse_scans:${userId}`
  const [pending, setPending] = useState<PendingScan[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(queueKey) || '[]'); return Array.isArray(saved) ? saved : [] } catch { return [] }
  })
  const pendingRef = useRef(pending)
  const lock = useRef(false)
  const photoRequest = useRef<{ file: File; id: string } | null>(null)
  const printRequest = useRef<{ key: string; id: string } | null>(null)
  const [device] = useState(() => {
    const id = localStorage.getItem('pb_warehouse_device') || crypto.randomUUID()
    localStorage.setItem('pb_warehouse_device', id); return id
  })
  useEffect(() => {
    const connected = () => setOnline(navigator.onLine)
    window.addEventListener('online', connected); window.addEventListener('offline', connected)
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', connected) }
  }, [])
  useEffect(() => () => { if (printUrl) URL.revokeObjectURL(printUrl) }, [printUrl])

  const locations = useQuery<Location[]>({ queryKey: ['warehouse', site, 'locations'], queryFn: () => api.get('/warehouse/locations', { params: { site } }).then(r => r.data), enabled: !!site })
  const summary = useQuery<Record<string, number>>({ queryKey: ['warehouse', site, 'summary'], queryFn: () => api.get('/warehouse/summary', { params: { site } }).then(r => r.data), enabled: !!site })
  const inventory = useQuery<{ data: Container[]; total: number; pages: number }>({ queryKey: ['warehouse', site, 'inventory', search, status, page], queryFn: () => api.get('/warehouse/containers', { params: { site, search, status, page } }).then(r => r.data), enabled: !!site })
  const detail = useQuery<Container>({ queryKey: ['warehouse', 'container', selected], queryFn: () => api.get(`/warehouse/containers/${selected}`).then(r => r.data), enabled: !!selected })
  const [historyPage, setHistoryPage] = useState(1)
  const history = useQuery<{ data: Event[]; total: number }>({ queryKey: ['warehouse', 'history', selected, historyPage], queryFn: () => api.get(`/warehouse/containers/${selected}/events`, { params: { page: historyPage } }).then(r => r.data), enabled: !!selected })
  const suggestions = useQuery<Location[]>({ queryKey: ['warehouse', 'suggestions', selected], queryFn: () => api.get(`/warehouse/containers/${selected}/suggestions`).then(r => r.data), enabled: !!selected && tab === 'Scan' })
  const item = detail.data
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['warehouse'] }) }
  function choose(id: string) { setSelected(id); setHistoryPage(1); setEditingItem(false) }
  function feedback(tone: 'success' | 'error' | 'warning', text: string) {
    setNotice({ tone, text })
    navigator.vibrate?.(tone === 'success' ? 80 : [120, 60, 120])
  }
  function saveQueue(queue: PendingScan[]) {
    // Persist before contacting the API. A storage quota error prevents the scan
    // being submitted, rather than promising a retry that cannot survive reload.
    localStorage.setItem(queueKey, JSON.stringify(queue))
    pendingRef.current = queue; setPending(queue)
  }
  async function submitScan(command: ScanCommand, retry = false) {
    if (lock.current) return
    lock.current = true; setBusy(true)
    try {
      if (!retry) saveQueue([...pendingRef.current, { command }])
      if (!navigator.onLine) { feedback('warning', 'Offline. Scan saved on this device; reconnect and retry before moving any item.'); return }
      const { data } = await api.post<ScanResult>('/warehouse/scans', command)
      saveQueue(pendingRef.current.filter(p => p.command.requestId !== command.requestId))
      if (!data.recognized) { setScannedItem(''); setScannedLocation(null); feedback('error', data.message || 'Unknown barcode.'); return }
      if (data.location) { setScannedLocation(data.location); feedback('success', `Location verified: ${data.location.name}. Scan the item next.`) }
      if (data.container) {
        choose(data.container._id)
        setScannedItem(data.container.displayCode)
        feedback('success', `${data.container.displayCode} · ${readable(data.container.currentStatus)}. ${data.nextAction || ''}`)
        if (command.action !== 'INSPECT') { setScannedLocation(null); setScannedItem('') }
      }
      refresh()
    } catch (err) {
      const message = apiError(err)
      try { saveQueue(pendingRef.current.map(p => p.command.requestId === command.requestId ? { ...p, error: message } : p)) } catch { /* Existing persisted command remains available. */ }
      feedback(message.includes('ALREADY SCANNED') ? 'warning' : 'error', message)
    } finally { lock.current = false; setBusy(false) }
  }
  const inspect = (barcode: string) => {
    if (pendingRef.current.length) { feedback('warning', 'Resolve pending scans before starting a new scan.'); return }
    void submitScan({ requestId: crypto.randomUUID(), barcode, action: 'INSPECT', deviceId: device })
  }
  async function print(codes: string[]) {
    if (printBusy || !codes.length) return
    const key = JSON.stringify({ codes, format })
    if (printRequest.current?.key !== key) printRequest.current = { key, id: crypto.randomUUID() }
    setPrintBusy(true)
    try {
      const response = await api.post('/warehouse/labels', { codes, format, requestId: printRequest.current.id }, { responseType: 'blob' })
      setPrintUrl(URL.createObjectURL(response.data)); printRequest.current = null; refresh()
      feedback('success', 'Labels ready. Open the PDF and print at actual size.')
    } catch (err) {
      const blob = (err as { response?: { data?: Blob } }).response?.data
      let message = apiError(err)
      if (blob instanceof Blob) { try { message = JSON.parse(await blob.text()).error || message } catch { /* Non-JSON error response. */ } }
      feedback('error', message)
    } finally { setPrintBusy(false) }
  }
  async function deleteLocationNow(id: string) {
    if (deleteBusy || !window.confirm('Delete this location? It has to be empty and have nothing nested under it.')) return
    setDeleteBusy(true)
    try { await api.delete(`/warehouse/locations/${id}`, { data: { requestId: crypto.randomUUID() } }); refresh(); feedback('success', 'Location deleted.') }
    catch (err) { feedback('error', apiError(err)) } finally { setDeleteBusy(false) }
  }
  async function deleteContainerNow(id: string) {
    if (deleteBusy) return
    const notes = window.prompt('Delete this item? It stays in the permanent history, but stops showing as active inventory. Optional reason:')
    if (notes === null) return
    setDeleteBusy(true)
    try {
      await api.delete(`/warehouse/containers/${id}`, { data: { requestId: crypto.randomUUID(), notes } })
      setSelected(''); setScannedItem(''); refresh(); feedback('success', 'Item deleted.')
    } catch (err) { feedback('error', apiError(err)) } finally { setDeleteBusy(false) }
  }
  const locationName = (id?: string) => locations.data?.find(l => l._id === id)?.name || id || '—'
  const allError = locations.error || summary.error || inventory.error

  if (!site) return <div className="p-6">Select a facility to open stored inventory.</div>
  return <div className="mx-auto max-w-7xl space-y-6 rounded-2xl bg-white p-4 text-zinc-950 sm:p-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-violet-700">PurpleBox · Warehouse</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Stored inventory</h1><p className="mt-2 text-zinc-500">Every item accounted for. Every movement recorded.</p></div>
      <Button className="!h-14 !px-7 !text-base" onClick={() => setTab('Scan')}><ScanLine size={22} /> Scan</Button>
    </header>
    <nav aria-label="Warehouse navigation" className="flex gap-1 overflow-x-auto border-b pb-2">{(['Guided', 'Today', 'Scan', 'Receive', 'Inventory', 'Locations', 'Labels'] as Tab[]).map(t => <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined} className={`min-h-12 whitespace-nowrap rounded-lg px-4 text-sm font-semibold ${tab === t ? 'bg-zinc-950 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}>{t === 'Guided' ? 'Guided steps' : t}</button>)}</nav>
    {!online && <div role="status" className="rounded-xl bg-amber-100 p-4 font-medium text-amber-900">Offline mode · {pending.length} scans waiting. Keep items in place until movement is confirmed.</div>}
    {notice && <div role={notice.tone === 'error' ? 'alert' : 'status'} aria-live="polite" className={`flex items-start justify-between gap-4 rounded-xl border p-5 text-lg font-medium ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : notice.tone === 'error' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}><span>{notice.text}</span><button aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={20} /></button></div>}
    {pending.length > 0 && <section className="space-y-3 rounded-xl border border-amber-300 p-4"><h2 className="font-semibold">{pending.length} pending scan{pending.length !== 1 ? 's' : ''}</h2>{pending.map((p, i) => <div className="flex flex-wrap items-center gap-3 text-sm" key={p.command.requestId}><span className="flex-1">{p.command.barcode} · {readable(p.command.action)}{p.error && <span className="block text-red-700">{p.error}</span>}</span><Button disabled={!online || busy || i !== 0} variant="outline" onClick={() => void submitScan(p.command, true)}>Retry scan</Button><Button variant="ghost" disabled={busy} onClick={() => {
      if (window.confirm('Remove this pending scan from this device? If the server may have accepted it, retry first to retrieve the confirmed result.')) { try { saveQueue(pendingRef.current.filter(q => q.command.requestId !== p.command.requestId)) } catch (err) { feedback('error', apiError(err)) } }
    }}>Discard</Button></div>)}</section>}
    {allError && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{apiError(allError)} <Button variant="outline" onClick={refresh}>Retry loading</Button></div>}
    {printUrl && <div className="flex flex-wrap items-center gap-4 rounded-xl border p-4"><Printer size={20} /><a href={printUrl} target="_blank" rel="noreferrer" className="font-semibold text-violet-700 underline">Open printable label PDF</a><span className="text-sm text-zinc-500">{format} · Print at 100% / actual size</span><button aria-label="Close label PDF link" onClick={() => setPrintUrl('')} className="ml-auto"><X size={18} /></button></div>}
    {tab === 'Today' && <>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[['CREATED', 'Awaiting receipt'], ['RECEIVED', 'Needs a photo'], ['AWAITING_PUTAWAY', 'Ready for putaway'], ['IN_STORAGE', 'In storage']].map(([key, label]) => <button key={key} className="rounded-xl border p-5 text-left hover:border-violet-400" onClick={() => { setStatus(key); setPage(1); setTab('Inventory') }}><p className="text-sm text-zinc-500">{label}</p><p className="mt-3 text-4xl font-semibold">{summary.isLoading ? '…' : summary.data?.[key] ?? '—'}</p></button>)}</section>
      <section className="rounded-2xl bg-zinc-950 p-6 text-white sm:p-8"><p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Next action</p><h2 className="mt-3 text-2xl font-semibold">{!locations.data?.length ? 'Map your first receiving area.' : (summary.data?.AWAITING_PUTAWAY || 0) > 0 ? 'Put received items into storage.' : 'Ready for the next arrival.'}</h2><p className="mt-2 max-w-xl text-zinc-300">{!locations.data?.length ? 'Create a receiving area and storage locations, then print their labels.' : 'Scan the item and its location. PurpleBox verifies the move and keeps the history.'}</p><Button className="mt-6 !h-12" onClick={() => setTab(!locations.data?.length ? 'Locations' : 'Scan')}>{!locations.data?.length ? 'Set up locations' : 'Start scanning'}</Button></section>
      <div className="flex items-center gap-3 text-sm text-zinc-500"><CheckCircle2 size={18} />Nothing moves without a scan. Customer property stays separate from storage capacity.</div>
    </>}
    {tab === 'Receive' && <ReceiveForm site={site} locations={locations.data || []} onCreated={items => { setLabelCodes(items.map(i => i.displayCode)); setTab('Labels'); refresh(); feedback('success', `${items.length} items created. Print and attach labels, then scan the receiving area and each item.`) }} />}
    {tab === 'Guided' && (() => {
      const Step = ({ n, title, state, children }: { n: number; title: string; state: 'done' | 'active' | 'waiting'; children?: React.ReactNode }) => (
        <div className={`rounded-xl border p-5 ${state === 'waiting' ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${state === 'done' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-violet-600 text-white' : 'bg-zinc-200 text-zinc-500'}`}>{state === 'done' ? '✓' : n}</span>
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          {state !== 'waiting' && <div className="mt-4 pl-11">{children}</div>}
        </div>
      )

      if (wizard === 'menu') return <section className="space-y-5">
        <div><h2 className="text-2xl font-semibold">What do you need to do?</h2><p className="mt-1 text-zinc-500">Pick one — each walks you through it step by step.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <button onClick={() => startWizard('receive')} className="rounded-2xl border-2 p-8 text-left hover:border-violet-400 hover:bg-violet-50/40">
            <Package size={28} className="text-violet-600" />
            <h3 className="mt-4 text-xl font-semibold">Receive a new item</h3>
            <p className="mt-2 text-zinc-500">A customer is dropping something off. Create it, label it, and put it away.</p>
          </button>
          <button onClick={() => startWizard('dispatch')} className="rounded-2xl border-2 p-8 text-left hover:border-violet-400 hover:bg-violet-50/40">
            <ScanLine size={28} className="text-violet-600" />
            <h3 className="mt-4 text-xl font-semibold">Return an item to a customer</h3>
            <p className="mt-2 text-zinc-500">A customer is picking something up. Confirm who, and mark it dispatched.</p>
          </button>
        </div>
      </section>

      if (wizard === 'receive') {
        const step1Done = !!item
        const step2Done = step1Done && wizardLabelConfirmed
        const step3Done = step1Done && item!.currentStatus !== 'CREATED'
        const step4Done = step1Done && item!.photoCount > 0
        const step5Done = step1Done && item!.currentStatus === 'IN_STORAGE'
        return <section className="space-y-4">
          <button onClick={endWizard} className="text-sm text-zinc-500 hover:text-zinc-900">← Back to guided steps</button>
          <h2 className="text-2xl font-semibold">Receiving a new item</h2>

          <Step n={1} title="Who is it for, and what is it?" state={step1Done ? 'done' : 'active'}>
            {step1Done ? <p>{item!.displayCode} — {item!.description || readable(item!.type)}</p> : locations.data?.some(l => l.kind === 'RECEIVING')
              ? <ReceiveForm site={site} locations={locations.data || []} lockQuantity submitLabel="Create item & continue" onCreated={items => { choose(items[0]._id); refresh(); feedback('success', 'Item created. Now print its label.') }} />
              : <p className="text-amber-800">A supervisor needs to create a Receiving location first (Locations tab) before you can receive anything.</p>}
          </Step>

          <Step n={2} title="Print the label and stick it on the box" state={step2Done ? 'done' : step1Done ? 'active' : 'waiting'}>
            <p className="text-zinc-500">This box's code is <span className="font-mono font-semibold text-zinc-900">{item?.displayCode}</span>. Print its label now and attach it to the actual box before continuing.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="outline" disabled={printBusy || !item} onClick={() => void print([item!.displayCode])}><Printer size={16} />Prepare printable PDF</Button>
              {printUrl && <a href={printUrl} target="_blank" rel="noreferrer" className="font-semibold text-violet-700 underline">Open printable label PDF</a>}
              <Button disabled={!item} onClick={() => setWizardLabelConfirmed(true)}>I've attached the label — Continue</Button>
            </div>
          </Step>

          <Step n={3} title="Confirm receipt" state={step3Done ? 'done' : step2Done ? 'active' : 'waiting'}>
            <p className="text-zinc-500">① Scan the tag at your <strong>Receiving</strong> area. ② Then scan the box's label you just attached.</p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <WarehouseScanner onScan={inspect} disabled={busy || pending.length > 0} />
              <div className="space-y-2 text-sm">
                {scannedLocation && scannedLocation.kind !== 'RECEIVING'
                  ? <p className="font-semibold text-red-700">✕ {scannedLocation.name} is a {readable(scannedLocation.kind)}, not your Receiving area — scan the Receiving tag instead.</p>
                  : <p>Location: {scannedLocation ? <span className="font-semibold text-emerald-700">✓ {scannedLocation.name}</span> : 'not yet scanned'}</p>}
                <p>Item: {scannedItem === item?.displayCode ? <span className="font-semibold text-emerald-700">✓ verified</span> : 'not yet scanned'}</p>
                <Button className="w-full !h-12" disabled={busy || !online || pending.length > 0 || !item || scannedItem !== item.displayCode || scannedLocation?.kind !== 'RECEIVING'} onClick={() => {
                  if (!scannedLocation || !item) return
                  void submitScan({ requestId: crypto.randomUUID(), barcode: scannedItem, locationBarcode: scannedLocation.displayCode, action: 'RECEIVE', deviceId: device })
                }}>Confirm receipt</Button>
              </div>
            </div>
          </Step>

          <Step n={4} title="Photograph its condition" state={step4Done ? 'done' : step3Done ? 'active' : 'waiting'}>
            <label className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold ${busy ? 'pointer-events-none opacity-50' : ''}`}>
              <Camera size={18} />{busy ? 'Saving…' : 'Add condition photo'}
              <input className="sr-only" aria-label="Add condition photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy || !item} onChange={async e => {
                const file = e.target.files?.[0]; if (!file || !item) return
                if (file.size > 8 * 1024 * 1024) { feedback('error', 'Photo must be under 8 MB.'); return }
                if (photoRequest.current?.file !== file) photoRequest.current = { file, id: crypto.randomUUID() }
                const data = new FormData(); data.append('photo', file); data.append('requestId', photoRequest.current.id)
                setBusy(true)
                try { await api.post(`/warehouse/containers/${item._id}/photos`, data); photoRequest.current = null; refresh(); feedback('success', 'Photo saved securely.') } catch (err) { feedback('error', apiError(err)) } finally { setBusy(false) }
              }} />
            </label>
          </Step>

          <Step n={5} title="Store it" state={step5Done ? 'done' : step4Done ? 'active' : 'waiting'}>
            <p className="text-zinc-500">① Walk the box to its shelf and scan the shelf's tag. ② Then scan the box's label again.</p>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <WarehouseScanner onScan={inspect} disabled={busy || pending.length > 0} />
              <div className="space-y-2 text-sm">
                {scannedLocation && !['SHELF', 'BIN', 'RACK'].includes(scannedLocation.kind)
                  ? <p className="font-semibold text-red-700">✕ {scannedLocation.name} is a {readable(scannedLocation.kind)} — scan a shelf, bin or rack instead.</p>
                  : <p>Shelf: {scannedLocation ? <span className="font-semibold text-emerald-700">✓ {scannedLocation.name}</span> : 'not yet scanned'}</p>}
                <p>Item: {scannedItem === item?.displayCode ? <span className="font-semibold text-emerald-700">✓ verified</span> : 'not yet scanned'}</p>
                <Button className="w-full !h-12" disabled={busy || !online || pending.length > 0 || !item || scannedItem !== item.displayCode || !scannedLocation || !['SHELF', 'BIN', 'RACK'].includes(scannedLocation.kind) || !item.photoCount} onClick={() => {
                  if (!scannedLocation || !item) return
                  void submitScan({ requestId: crypto.randomUUID(), barcode: scannedItem, locationBarcode: scannedLocation.displayCode, action: 'PUTAWAY', deviceId: device })
                }}>Confirm putaway</Button>
              </div>
            </div>
          </Step>

          {step5Done && <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
            <p className="text-lg font-semibold text-emerald-800">✅ Done — stored on {typeof item!.currentLocation === 'object' ? item!.currentLocation?.name : 'its shelf'}.</p>
            <Button className="mt-4 !h-12" onClick={() => startWizard('receive')}>Receive another item</Button>
          </div>}
        </section>
      }

      // wizard === 'dispatch'
      const dispatching = scannedLocation?.kind === 'DISPATCH'
      return <section className="space-y-4">
        <button onClick={endWizard} className="text-sm text-zinc-500 hover:text-zinc-900">← Back to guided steps</button>
        <h2 className="text-2xl font-semibold">Returning an item to a customer</h2>

        <Step n={1} title="Scan the item they're collecting" state={item ? 'done' : 'active'}>
          {item ? <p>{item.displayCode} — {item.description || readable(item.type)}</p> : <WarehouseScanner onScan={inspect} disabled={busy || pending.length > 0} />}
        </Step>

        {item && item.currentStatus === 'DISPATCHED' && <div className="rounded-xl border-2 border-zinc-300 bg-zinc-50 p-6 text-center">
          <p className="text-lg font-semibold text-zinc-700">This item was already dispatched.</p>
          <Button className="mt-4 !h-12" onClick={() => startWizard('dispatch')}>Start another return</Button>
        </div>}

        {item && item.currentStatus !== 'DISPATCHED' && <>
          <Step n={2} title="Scan your Dispatch/pickup counter tag" state={dispatching ? 'done' : 'active'}>
            <WarehouseScanner onScan={inspect} disabled={busy || pending.length > 0} />
            <p className="mt-2 text-sm">{scannedLocation && scannedLocation.kind !== 'DISPATCH'
              ? <span className="font-semibold text-red-700">✕ {scannedLocation.name} is a {readable(scannedLocation.kind)} — scan your Dispatch counter's tag instead.</span>
              : scannedLocation ? <span className="font-semibold text-emerald-700">✓ {scannedLocation.name}</span> : 'not yet scanned'}</p>
          </Step>
          <Step n={3} title="Confirm the handover" state={dispatching ? 'active' : 'waiting'}>
            <Button className="w-full !h-12 sm:w-auto" disabled={busy || !online || pending.length > 0 || scannedItem !== item.displayCode || !dispatching} onClick={() => {
              if (!scannedLocation) return
              const notes = window.prompt('Who is picking this up, or how was it confirmed? (required)')
              if (!notes?.trim()) return
              void submitScan({ requestId: crypto.randomUUID(), barcode: scannedItem, locationBarcode: scannedLocation.displayCode, action: 'DISPATCH', notes, deviceId: device })
            }}>Confirm dispatch</Button>
          </Step>
        </>}
      </section>
    })()}
    {tab === 'Scan' && (() => {
      const dispatching = scannedLocation?.kind === 'DISPATCH'
      const action = dispatching ? 'DISPATCH' : item?.currentStatus === 'CREATED' ? 'RECEIVE' : item?.currentStatus === 'IN_STORAGE' ? 'RELOCATE' : 'PUTAWAY'
      const actionLabel = dispatching ? 'Confirm dispatch' : item?.currentStatus === 'CREATED' ? 'Confirm receipt' : item?.currentStatus === 'IN_STORAGE' ? 'Authorize relocation' : 'Confirm putaway'
      const needsReason = action === 'RELOCATE' || action === 'DISPATCH'
      return <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <WarehouseScanner onScan={inspect} disabled={busy || pending.length > 0} />
          <div className="rounded-xl border p-5">
            <h3 className="font-semibold">Verified location</h3>
            <p className="mt-2 text-lg">{scannedLocation ? scannedLocation.name : 'Scan a receiving, storage or dispatch location'}</p>
            {scannedLocation && <p className="mt-1 font-mono text-sm text-zinc-500">{scannedLocation.displayCode} · {scannedLocation.warehouse}</p>}
          </div>
          {item && !dispatching && suggestions.data && suggestions.data.length > 0 && <div className="rounded-xl border p-5">
            <h3 className="font-semibold">Compatible storage locations</h3>
            <p className="mt-1 text-sm text-zinc-500">Available capacity, ordered by location code. Scan the physical label to verify.</p>
            {suggestions.data.map(l => <p key={l._id} className="mt-3 text-sm">{l.name} <span className="block font-mono text-zinc-500">{l.displayCode}</span></p>)}
          </div>}
        </div>
        <div className="rounded-xl border p-5">
          <h2 className="text-xl font-semibold">{item?.displayCode || 'Scan an item to begin'}</h2>
          {item ? <>
            <p className="mt-2 text-zinc-500">{item.description || readable(item.type)}</p>
            <p className="mt-4 text-lg font-medium">{item.nextAction}</p>
            <p className="mt-2 text-sm">{scannedItem === item.displayCode ? 'Item label verified' : 'Scan this item’s physical label to authorize the next step.'}</p>
            {item.currentStatus === 'DISPATCHED' ? <p className="mt-4 font-semibold text-zinc-500">Already returned to the customer.</p> : <>
              {item.currentStatus === 'IN_STORAGE' && !supervisor && !dispatching && <p className="mt-4 font-semibold text-amber-800">NO ACTIVE MOVEMENT AUTHORIZATION</p>}
              {(item.currentStatus !== 'IN_STORAGE' || supervisor || dispatching) && <Button className="mt-6 !h-14 w-full" disabled={busy || !online || pending.length > 0 || scannedItem !== item.displayCode || !scannedLocation || (!dispatching && item.currentStatus !== 'CREATED' && !item.photoCount)} onClick={() => {
                if (!scannedLocation) return
                const notes = needsReason ? window.prompt(dispatching ? 'Who is picking this up, or how was it confirmed? (required)' : 'Reason for supervisor relocation') : ''
                if (needsReason && !notes?.trim()) return
                void submitScan({ requestId: crypto.randomUUID(), barcode: scannedItem, locationBarcode: scannedLocation.displayCode, action, notes: notes || '', deviceId: device })
              }}>{actionLabel}</Button>}
              <p className="mt-3 text-sm text-zinc-500">{!dispatching && !item.photoCount ? 'Add a photo in the item details below before putaway.' : 'Confirm only after scanning both physical labels.'}</p>
            </>}
          </> : <p className="mt-3 text-zinc-500">The scanner recognizes item and location labels automatically.</p>}
        </div>
      </div>
    })()}
    {tab === 'Inventory' && <section className="space-y-4"><div className="flex flex-wrap gap-3"><div className="relative min-w-60 flex-1"><Search className="absolute left-3 top-4 text-zinc-400" size={18} /><Input aria-label="Search inventory" className="!h-12 !pl-10" placeholder="Code, customer, phone, booking, contents or location" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /></div><Select aria-label="Filter status" className="!h-12 !w-auto" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['CREATED', 'RECEIVED', 'AWAITING_PUTAWAY', 'IN_STORAGE', 'DISPATCHED'].map(s => <option key={s} value={s}>{readable(s)}</option>)}</Select></div>
      {inventory.isLoading ? <p role="status">Loading inventory…</p> : inventory.data?.data.length ? <div className="divide-y rounded-xl border">{inventory.data.data.map(c => <button key={c._id} onClick={() => choose(c._id)} className="flex min-h-24 w-full flex-wrap items-center gap-4 p-4 text-left hover:bg-zinc-50"><Package className="text-zinc-400" size={24} /><span className="min-w-40 flex-1"><span className="block font-semibold">{c.displayCode}</span><span className="block text-sm text-zinc-500">{c.description || readable(c.type)} · {typeof c.customer === 'object' ? c.customer?.fullName : ''}</span></span><span className="text-sm text-zinc-500">{c.currentStatus === 'DISPATCHED' ? 'Returned to customer' : typeof c.currentLocation === 'object' ? c.currentLocation?.name : 'Not located'}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(c.currentStatus)}`}>{readable(c.currentStatus)}</span></button>)}</div> : <div className="rounded-xl border border-dashed p-10 text-center"><Package className="mx-auto text-zinc-400" size={32} /><h3 className="mt-3 font-semibold">No items found</h3><p className="mt-2 text-sm text-zinc-500">Adjust your search or receive your first customer items.</p><Button className="mt-4 !h-12" onClick={() => setTab('Receive')}>Receive inventory</Button></div>}
      <div className="flex items-center justify-between gap-2 text-sm"><span>{inventory.data?.total ?? 0} items · Page {page}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" disabled={page >= (inventory.data?.pages || 1)} onClick={() => setPage(page + 1)}>Next</Button></div></div></section>}
    {tab === 'Locations' && <section className="space-y-5">
      {supervisor && <LocationForm site={site} locations={locations.data || []} onCreated={() => { refresh(); feedback('success', 'Location created. Print its label before scanning.') }} />}
      <div className="divide-y rounded-xl border">
        {locations.data?.map(l => <div key={l._id} className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <MapPin size={22} className="text-zinc-400" />
            <div className="flex-1">
              <p className="font-semibold">{l.name}</p>
              <p className="text-sm text-zinc-500">{l.warehouse} · {readable(l.kind)}{l.parent ? ` · ${locationName(l.parent)}` : ''}</p>
              <p className="font-mono text-xs text-zinc-500">{l.displayCode}</p>
            </div>
            <p className="text-sm">{l.usedContainers}{l.maxContainers != null ? ` / ${l.maxContainers}` : ''} stored{l.maxWeight != null && <span className="block text-zinc-500">{l.usedWeight.toFixed(1)} / {l.maxWeight} kg</span>}{l.maxVolume != null && <span className="block text-zinc-500">{l.usedVolume.toFixed(3)} / {l.maxVolume} m³</span>}</p>
            <Button variant="outline" disabled={printBusy} onClick={() => void print([l.displayCode])}><Printer size={16} />Label</Button>
            {supervisor && <Button variant="outline" onClick={() => setEditingLocation(editingLocation === l._id ? '' : l._id)}>Edit</Button>}
            {supervisor && <Button variant="outline" disabled={deleteBusy} onClick={() => void deleteLocationNow(l._id)}>Delete</Button>}
          </div>
          {editingLocation === l._id && <EditLocationForm location={l} onCancel={() => setEditingLocation('')} onSaved={() => { setEditingLocation(''); refresh(); feedback('success', 'Location updated.') }} />}
        </div>)}
        {!locations.data?.length && <p className="p-6 text-zinc-500">No locations yet. A supervisor can create your warehouse locations here.</p>}
      </div>
    </section>}
    {tab === 'Labels' && <section className="space-y-5"><div><h2 className="text-2xl font-semibold">Label center</h2><p className="mt-2 text-zinc-500">Code 128 and QR on every label. Codes contain no customer details.</p></div><Select aria-label="Label paper size" className="!h-12 sm:!w-72" value={format} onChange={e => setFormat(e.target.value)}><option value="4x6">4 × 6 inch thermal label</option><option value="A4">A4 paper</option></Select><textarea aria-label="Label codes, one per line" className="min-h-48 w-full rounded-xl border p-4 font-mono text-sm" value={labelCodes.join('\n')} onChange={e => setLabelCodes(e.target.value.split('\n'))} placeholder="PBX-BX-000001" /><p className="text-sm text-zinc-500">One existing code per line, up to 50 labels. Reprints require supervisor permission.</p><Button className="!h-14" disabled={printBusy || !labelCodes.some(c => c.trim())} onClick={() => void print(labelCodes.map(c => c.trim()).filter(Boolean))}><Printer size={18} />{printBusy ? 'Preparing labels…' : 'Prepare printable PDF'}</Button></section>}
    {selected && <section className="rounded-2xl border p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Item details</h2><button className="p-3" aria-label="Close item details" onClick={() => { setSelected(''); setScannedItem('') }}><X size={20} /></button></div>{detail.isLoading ? <p role="status">Loading item…</p> : detail.isError ? <p role="alert" className="text-red-700">{apiError(detail.error)}</p> : item && <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-mono text-xl font-semibold">{item.displayCode}</h3><p className="mt-2">{item.description || readable(item.type)}</p><p className="text-sm text-zinc-500">{typeof item.customer === 'object' ? item.customer?.fullName : ''}{typeof item.booking === 'object' ? ` · ${item.booking?.contractNo}` : ''}</p></div><span className={`rounded-full px-3 py-1 text-sm ${statusClass(item.currentStatus)}`}>{readable(item.currentStatus)}</span></div>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3"><p><span className="block text-zinc-500">Location</span>{item.currentStatus === 'DISPATCHED' ? 'Returned to customer' : typeof item.currentLocation === 'object' ? item.currentLocation?.name || 'Not yet located' : locationName(item.currentLocation || undefined)}</p><p><span className="block text-zinc-500">Condition</span>{readable(item.condition)}</p><p><span className="block text-zinc-500">Weight / dimensions</span>{item.weight ?? '—'} kg · {item.length ?? '—'} × {item.width ?? '—'} × {item.height ?? '—'} cm</p></div>
      {item.contents && <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-600">{item.contents}</p>}
      <div className="mt-5 flex flex-wrap gap-3">{item.photos?.map(p => <PrivatePhoto key={p._id} id={p._id} />)}</div>
      <div className="mt-5 flex flex-wrap gap-3"><label className={`inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold ${busy ? 'pointer-events-none opacity-50' : ''}`}><Camera size={18} />{busy ? 'Saving…' : 'Add condition photo'}<input className="sr-only" aria-label="Add condition photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return
        if (file.size > 8 * 1024 * 1024) { feedback('error', 'Photo must be under 8 MB.'); return }
        if (photoRequest.current?.file !== file) photoRequest.current = { file, id: crypto.randomUUID() }
        const data = new FormData(); data.append('photo', file); data.append('requestId', photoRequest.current.id)
        setBusy(true)
        try { await api.post(`/warehouse/containers/${item._id}/photos`, data); photoRequest.current = null; refresh(); feedback('success', 'Photo saved securely.') } catch (err) { feedback('error', apiError(err)) } finally { setBusy(false) }
      }} /></label><Button variant="outline" className="!h-12" disabled={printBusy} onClick={() => void print([item.displayCode])}><Printer size={18} />Print label</Button><Button variant="outline" className="!h-12" onClick={() => setTab('Scan')}><ScanLine size={18} />Scan to move</Button><Button variant="outline" className="!h-12" onClick={() => setEditingItem(v => !v)}>Edit</Button>{supervisor && <Button variant="outline" className="!h-12" disabled={deleteBusy} onClick={() => void deleteContainerNow(item._id)}>Delete</Button>}</div>
      {editingItem && <EditContainerForm item={item} onCancel={() => setEditingItem(false)} onSaved={() => { setEditingItem(false); refresh(); feedback('success', 'Item updated.') }} />}
      <div className="mt-8 border-t pt-5"><h3 className="text-lg font-semibold">Chain of custody</h3><p className="mt-1 text-sm text-zinc-500">Permanent event history · {history.data?.total ?? 0} events</p>{history.isError && <p role="alert" className="mt-3 text-red-700">{apiError(history.error)}</p>}<ol className="mt-4 space-y-4">{history.data?.data.map(event => <li key={event._id} className="border-l-2 border-violet-200 pl-4"><p className="font-medium">{readable(event.eventType)}</p><p className="text-sm text-zinc-500">{new Date(event.timestamp).toLocaleString()} · {event.employee?.name || 'Employee'}</p>{event.newStatus && <p className="text-sm">{event.previousStatus ? `${readable(event.previousStatus)} → ` : ''}{readable(event.newStatus)}</p>}{event.currentLocation && <p className="text-sm text-zinc-500">{event.previousLocation && event.previousLocation !== event.currentLocation ? `${locationName(event.previousLocation)} → ` : ''}{locationName(event.currentLocation)}</p>}{event.notes && <p className="text-sm">{event.notes}</p>}</li>)}</ol><div className="mt-4 flex gap-2"><Button variant="outline" disabled={historyPage === 1} onClick={() => setHistoryPage(historyPage - 1)}>Newer</Button><Button variant="outline" disabled={historyPage * 30 >= (history.data?.total || 0)} onClick={() => setHistoryPage(historyPage + 1)}>Older</Button></div></div>
    </>}</section>}
  </div>
}
