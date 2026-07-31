import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Minus, Trash2, Search, CalendarCheck, MapPin, Phone, User, X, Upload, FileVideo, Briefcase, Pencil, Package } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Badge, Button, Field, Input, Modal, Spinner, Textarea } from '../../components/ui'
import { useNavigate } from 'react-router-dom'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const HOME_ITEMS = [
  'Sofa', 'Bed', 'Wardrobe', 'Dining Table', 'Chairs', 'TV', 'Fridge', 'Washing Machine',
  'Dryer', 'AC Unit', 'Microwave', 'Oven', 'Dishwasher', 'Coffee Table', 'Side Table',
  'Desk', 'Bookshelf', 'Mirror', 'Dresser', 'Mattress', 'Nightstand', 'Shoe Rack',
  'Kitchen Cabinet', 'Boxes', 'Bags', 'Bicycle', 'Gym Equipment', 'Piano',
]

interface ItemEntry { name: string; qty: number }

const VIDEO_EXTS = /\.(mp4|mov|avi|webm|mkv|m4v|3gp|wmv)$/i
const isVideo = (img: SiteVisitImage) => VIDEO_EXTS.test(img.filename || '') || VIDEO_EXTS.test(img.originalName || '')

interface SiteVisitImage {
  url: string
  filename: string
  originalName: string
  size: number
  storage: string
  driveFileId?: string
}

interface SiteVisit {
  _id: string
  visitNo: string
  visitDate: string
  customerName: string
  customerPhone: string
  address: string
  notes: string
  items: ItemEntry[]
  images: SiteVisitImage[]
  linkedJob?: string
  createdByName: string
  createdAt: string
}

export default function SiteVisits() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // form state
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemEntry[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // edit
  const [editId, setEditId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddr, setEditAddr] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editItems, setEditItems] = useState<ItemEntry[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr] = useState('')

  // convert to job
  const [convertVisit, setConvertVisit] = useState<SiteVisit | null>(null)
  const [custSearch, setCustSearch] = useState('')
  const [selectedCustId, setSelectedCustId] = useState('')
  const [converting, setConverting] = useState(false)
  const [convertErr, setConvertErr] = useState('')

  // lightbox
  const [lightboxImg, setLightboxImg] = useState<SiteVisitImage | null>(null)

  const { data, isLoading } = useQuery<{ visits: SiteVisit[]; total: number }>({
    queryKey: ['site-visits', search],
    queryFn: () => api.get('/site-visits', { params: { search: search || undefined, limit: 100 } }).then(r => r.data),
  })

  const visits = data?.visits || []

  const tapItem = (name: string, list: ItemEntry[], setList: React.Dispatch<React.SetStateAction<ItemEntry[]>>) => {
    const idx = list.findIndex(i => i.name === name)
    if (idx === -1) setList([...list, { name, qty: 1 }])
    else setList(list.map((it, i) => i === idx ? { ...it, qty: it.qty + 1 } : it))
  }

  const decItem = (name: string, list: ItemEntry[], setList: React.Dispatch<React.SetStateAction<ItemEntry[]>>) => {
    const idx = list.findIndex(i => i.name === name)
    if (idx === -1) return
    if (list[idx].qty <= 1) setList(list.filter((_, i) => i !== idx))
    else setList(list.map((it, i) => i === idx ? { ...it, qty: it.qty - 1 } : it))
  }

  const resetForm = () => {
    setShowForm(false)
    setVisitDate(new Date().toISOString().slice(0, 10))
    setCustomerName('')
    setCustomerPhone('')
    setAddress('')
    setNotes('')
    setItems([])
    setFiles([])
    setError('')
  }

  const totalFileSize = files.reduce((s, f) => s + f.size, 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!notes.trim()) { setError('Notes are required'); return }
    setUploading(true)
    setUploadProgress(0)
    setError('')
    try {
      const fd = new FormData()
      fd.append('visitDate', visitDate)
      fd.append('customerName', customerName)
      fd.append('customerPhone', customerPhone)
      fd.append('address', address)
      fd.append('notes', notes)
      if (items.length > 0) fd.append('items', JSON.stringify(items))
      files.forEach(f => fd.append('files', f))
      await api.post('/site-visits', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setUploadProgress(Math.round((e.loaded * 100) / e.total))
        },
      })
      resetForm()
      qc.invalidateQueries({ queryKey: ['site-visits'] })
    } catch (err) {
      setError(apiError(err))
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const startEdit = (visit: SiteVisit) => {
    setEditId(visit._id)
    setEditDate(new Date(visit.visitDate).toISOString().slice(0, 10))
    setEditName(visit.customerName)
    setEditPhone(visit.customerPhone)
    setEditAddr(visit.address)
    setEditNotes(visit.notes)
    setEditItems(visit.items || [])
    setEditErr('')
    setExpandedId(visit._id)
  }

  const cancelEdit = () => { setEditId(null); setEditErr('') }

  const saveEdit = async () => {
    if (!editId) return
    if (!editNotes.trim()) { setEditErr('Notes are required'); return }
    setEditSaving(true)
    setEditErr('')
    try {
      await api.put(`/site-visits/${editId}`, {
        visitDate: editDate,
        customerName: editName,
        customerPhone: editPhone,
        address: editAddr,
        notes: editNotes,
        items: editItems,
      })
      setEditId(null)
      qc.invalidateQueries({ queryKey: ['site-visits'] })
    } catch (err) {
      setEditErr(apiError(err))
    } finally {
      setEditSaving(false)
    }
  }

  const handleDeleteImage = async (visitId: string, imgIdx: number) => {
    if (!confirm('Delete this file?')) return
    try {
      await api.delete(`/site-visits/${visitId}/images/${imgIdx}`)
      qc.invalidateQueries({ queryKey: ['site-visits'] })
    } catch (err) {
      alert(apiError(err))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this site visit?')) return
    try {
      await api.delete(`/site-visits/${id}`)
      qc.invalidateQueries({ queryKey: ['site-visits'] })
    } catch (err) {
      alert(apiError(err))
    }
  }

  const { data: custPage } = useQuery<{ data: { _id: string; fullName: string; phone?: string }[] }>({
    queryKey: ['customers-search-visits', custSearch],
    queryFn: () => api.get('/customers', { params: { search: custSearch || undefined, limit: 15 } }).then(r => r.data),
    enabled: !!convertVisit,
  })
  const custList = custPage?.data ?? []

  const handleConvertToJob = async () => {
    if (!convertVisit || !selectedCustId) return
    setConverting(true)
    setConvertErr('')
    try {
      const job = await api.post(`/site-visits/${convertVisit._id}/convert-to-job`, { customerId: selectedCustId }).then(r => r.data)
      qc.invalidateQueries({ queryKey: ['site-visits'] })
      setConvertVisit(null)
      setCustSearch('')
      setSelectedCustId('')
      navigate(`/moving/jobs/${job._id}`)
    } catch (err) {
      setConvertErr(apiError(err))
    } finally {
      setConverting(false)
    }
  }

  if (isLoading) return <div className="flex justify-center p-20"><Spinner /></div>

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-4 sm:p-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Site Visits</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>
            Pre-move property assessments · {data?.total || 0} visit{(data?.total || 0) !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          disabled={showForm}
          style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 14, fontWeight: 600, padding: '0 20px' }}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <Plus size={16} /> New Visit
        </button>
      </div>

      {/* Search */}
      <div className="mb-5">
        <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3 max-w-sm">
          <Search size={16} color={MUTED} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by visit #, name, address..."
            style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: INK, width: '100%' }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* New Visit Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
          <div className="px-4 sm:px-5 py-3.5 border-b">
            <div className="flex items-center gap-2 font-semibold text-sm" style={{ color: INK }}>
              <CalendarCheck size={15} style={{ color: PURPLE }} /> New Site Visit
            </div>
          </div>
          <div className="px-4 sm:px-5 py-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Visit Date">
                  <Input type="date" value={visitDate} onChange={(e: any) => setVisitDate(e.target.value)} required />
                </Field>
                <Field label="Customer Name">
                  <Input value={customerName} onChange={(e: any) => setCustomerName(e.target.value)} placeholder="e.g. Ahmed Ali" autoFocus />
                </Field>
                <Field label="Customer Phone">
                  <Input value={customerPhone} onChange={(e: any) => setCustomerPhone(e.target.value)} placeholder="e.g. +971 50 123 4567" />
                </Field>
                <Field label="Address">
                  <Input value={address} onChange={(e: any) => setAddress(e.target.value)} placeholder="e.g. Marina Tower, Apt 1204" />
                </Field>
              </div>
              <Field label="Notes *">
                <Textarea
                  value={notes}
                  onChange={(e: any) => setNotes(e.target.value)}
                  placeholder="Describe what you see — rooms, items, access issues, special instructions..."
                  rows={4}
                />
              </Field>
              {/* Home Items Checklist */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Package size={14} style={{ color: PURPLE }} /> Home Items
                  </label>
                  {items.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${PURPLE}15`, color: PURPLE }}>
                      {items.reduce((s, i) => s + i.qty, 0)} item{items.reduce((s, i) => s + i.qty, 0) !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {HOME_ITEMS.map(name => {
                    const entry = items.find(i => i.name === name)
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => tapItem(name, items, setItems)}
                        onContextMenu={(e) => { e.preventDefault(); decItem(name, items, setItems) }}
                        className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all select-none"
                        style={{
                          background: entry ? PURPLE : '#F3F0EA',
                          color: entry ? 'white' : INK,
                          border: entry ? `1px solid ${PURPLE}` : '1px solid transparent',
                        }}
                      >
                        {name}
                        {entry && entry.qty > 1 && (
                          <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full text-[10px] font-bold bg-white" style={{ color: PURPLE }}>
                            {entry.qty}
                          </span>
                        )}
                        {entry && (
                          <span
                            onClick={(e) => { e.stopPropagation(); decItem(name, items, setItems) }}
                            className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-white/30 hover:bg-white/50 transition-colors cursor-pointer"
                          >
                            <Minus size={10} />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">Tap to add, tap again to increase qty. Use − to decrease.</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium">Photos & Videos</label>
                  {files.length > 0 && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                      {files.length} file{files.length !== 1 ? 's' : ''} selected
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  <input ref={fileRef} type="file" multiple accept="image/*,video/mp4,video/quicktime,video/mov,video/*" className="hidden"
                    onChange={(e) => {
                      const picked = e.target.files
                      if (!picked || !picked.length) return
                      const arr = Array.from(picked).filter(f => f.size <= 50 * 1024 * 1024)
                      setFiles(prev => [...prev, ...arr])
                      e.target.value = ''
                    }}
                  />
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 w-full h-24 rounded-xl border-2 border-dashed border-primary/30 bg-card cursor-pointer hover:bg-primary/10 transition-colors">
                    <Upload size={22} className="text-primary" />
                    <span className="text-xs font-medium text-primary">{files.length ? 'Add more photos or videos' : 'Tap to add photos or videos (max 50MB each)'}</span>
                  </button>
                  {files.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {files.map((f, i) => (
                        <div key={i} className="relative rounded-lg overflow-hidden bg-muted border">
                          {f.type.startsWith('video') ? (
                            <div className="aspect-square relative">
                              <video src={URL.createObjectURL(f)} className="w-full h-full object-cover" muted preload="metadata" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <div className="h-8 w-8 rounded-full bg-black/60 flex items-center justify-center">
                                  <FileVideo size={16} color="#fff" />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="aspect-square">
                              <img src={URL.createObjectURL(f)} className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="px-2 py-1 bg-card">
                            <div className="text-[10px] truncate text-muted-foreground">{f.name}</div>
                            <div className="text-[9px] text-muted-foreground/60">{(f.size / 1024 / 1024).toFixed(1)} MB</div>
                          </div>
                          <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                            className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 flex items-center justify-center hover:bg-red-600 transition-colors">
                            <X size={10} color="#fff" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              {uploading && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium">
                      Uploading {files.length} file{files.length !== 1 ? 's' : ''} ({(totalFileSize / 1024 / 1024).toFixed(1)} MB)
                    </span>
                    <span className="font-semibold" style={{ color: PURPLE }}>{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%`, background: PURPLE }}
                    />
                  </div>
                  {uploadProgress < 100 && (
                    <p className="text-[11px] text-muted-foreground">Please wait, uploading to cloud storage…</p>
                  )}
                  {uploadProgress >= 100 && (
                    <p className="text-[11px] text-green-600 font-medium">Upload complete, saving visit…</p>
                  )}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" type="button" onClick={resetForm} disabled={uploading}>Cancel</Button>
                <Button type="submit" disabled={uploading || !notes.trim()}>
                  {uploading ? `Uploading… ${uploadProgress}%` : 'Save Visit'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Visit List */}
      {visits.length === 0 && !showForm ? (
        <div className="text-center py-16">
          <CalendarCheck size={48} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-lg font-semibold" style={{ color: INK }}>No site visits yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first visit to document a property before the move</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visits.map(visit => {
            const expanded = expandedId === visit._id
            return (
              <div key={visit._id} style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
                <div
                  className="px-4 sm:px-5 py-3.5 sm:py-4 cursor-pointer hover:bg-black/[0.02] transition-colors"
                  onClick={() => setExpandedId(expanded ? null : visit._id)}
                >
                  <div className="flex items-start justify-between gap-2 sm:gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        <span className="font-semibold text-sm" style={{ color: PURPLE }}>{visit.visitNo}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(visit.visitDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        {visit.linkedJob && (
                          <Badge tone="green" className="text-[10px]">Linked to Job</Badge>
                        )}
                        {visit.items && visit.items.length > 0 && (
                          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5"><Package size={10} /> {visit.items.reduce((s: number, i: ItemEntry) => s + i.qty, 0)} items</span>
                        )}
                        {visit.images.length > 0 && (
                          <span className="text-[10px] text-muted-foreground/60">{visit.images.length} photo{visit.images.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 sm:gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
                        {visit.customerName && (
                          <span className="flex items-center gap-1"><User size={11} /> {visit.customerName}</span>
                        )}
                        {visit.customerPhone && (
                          <span className="flex items-center gap-1 hidden sm:flex"><Phone size={11} /> {visit.customerPhone}</span>
                        )}
                        {visit.address && (
                          <span className="flex items-center gap-1 truncate max-w-[180px] sm:max-w-none"><MapPin size={11} /> {visit.address}</span>
                        )}
                      </div>
                      <p className="text-sm text-foreground/80 mt-1.5 line-clamp-1 sm:line-clamp-2">{visit.notes}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!visit.linkedJob && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConvertVisit(visit); setConvertErr(''); setSelectedCustId(''); setCustSearch(visit.customerName || '') }}
                          title="Convert to Job"
                          className="text-green-600 hover:text-green-700 border-green-200 hover:border-green-300 hover:bg-green-50 h-8 text-xs hidden sm:flex"
                        >
                          <Briefcase size={13} className="mr-1" /> Create Job
                        </Button>
                      )}
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); startEdit(visit) }}
                        title="Edit visit"
                        className="h-8 w-8 rounded-lg border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleDelete(visit._id) }}
                        className="h-8 w-8 rounded-lg border border-red-200 flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded detail / Edit form */}
                {expanded && (
                  <div className="border-t px-4 sm:px-5 py-4 space-y-4">
                    {editId === visit._id ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <Field label="Visit Date">
                            <Input type="date" value={editDate} onChange={(e: any) => setEditDate(e.target.value)} />
                          </Field>
                          <Field label="Customer Name">
                            <Input value={editName} onChange={(e: any) => setEditName(e.target.value)} placeholder="e.g. Ahmed Ali" />
                          </Field>
                          <Field label="Customer Phone">
                            <Input value={editPhone} onChange={(e: any) => setEditPhone(e.target.value)} placeholder="e.g. +971 50 123 4567" />
                          </Field>
                          <Field label="Address">
                            <Input value={editAddr} onChange={(e: any) => setEditAddr(e.target.value)} placeholder="e.g. Marina Tower, Apt 1204" />
                          </Field>
                        </div>
                        <Field label="Notes *">
                          <Textarea value={editNotes} onChange={(e: any) => setEditNotes(e.target.value)} rows={4} />
                        </Field>
                        {/* Home Items Checklist (Edit) */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium flex items-center gap-1.5">
                              <Package size={14} style={{ color: PURPLE }} /> Home Items
                            </label>
                            {editItems.length > 0 && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${PURPLE}15`, color: PURPLE }}>
                                {editItems.reduce((s, i) => s + i.qty, 0)} item{editItems.reduce((s, i) => s + i.qty, 0) !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {HOME_ITEMS.map(name => {
                              const entry = editItems.find(i => i.name === name)
                              return (
                                <button
                                  key={name}
                                  type="button"
                                  onClick={() => tapItem(name, editItems, setEditItems)}
                                  onContextMenu={(e) => { e.preventDefault(); decItem(name, editItems, setEditItems) }}
                                  className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all select-none"
                                  style={{
                                    background: entry ? PURPLE : '#F3F0EA',
                                    color: entry ? 'white' : INK,
                                    border: entry ? `1px solid ${PURPLE}` : '1px solid transparent',
                                  }}
                                >
                                  {name}
                                  {entry && entry.qty > 1 && (
                                    <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full text-[10px] font-bold bg-white" style={{ color: PURPLE }}>
                                      {entry.qty}
                                    </span>
                                  )}
                                  {entry && (
                                    <span
                                      onClick={(e) => { e.stopPropagation(); decItem(name, editItems, setEditItems) }}
                                      className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-white/30 hover:bg-white/50 transition-colors cursor-pointer"
                                    >
                                      <Minus size={10} />
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1.5">Tap to add, tap again to increase qty. Use − to decrease.</p>
                        </div>
                        {editErr && <p className="text-sm text-red-600">{editErr}</p>}
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={cancelEdit}>Cancel</Button>
                          <Button onClick={saveEdit} disabled={editSaving || !editNotes.trim()}>
                            {editSaving ? 'Saving…' : 'Save Changes'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">Visit Date</span>
                            <p>{new Date(visit.visitDate).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                          </div>
                          {visit.customerName && (
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">Customer</span>
                              <p>{visit.customerName}{visit.customerPhone ? ` · ${visit.customerPhone}` : ''}</p>
                            </div>
                          )}
                          {visit.address && (
                            <div className="sm:col-span-2">
                              <span className="text-xs font-medium text-muted-foreground">Address</span>
                              <p>{visit.address}</p>
                            </div>
                          )}
                          <div className="sm:col-span-2">
                            <span className="text-xs font-medium text-muted-foreground">Notes</span>
                            <p className="whitespace-pre-wrap">{visit.notes}</p>
                          </div>
                          {visit.items && visit.items.length > 0 && (
                            <div className="sm:col-span-2">
                              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
                                <Package size={12} /> Home Items ({visit.items.reduce((s, i) => s + i.qty, 0)})
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {visit.items.map((it, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                                    style={{ background: `${PURPLE}12`, color: PURPLE, border: `1px solid ${PURPLE}25` }}
                                  >
                                    {it.name}
                                    {it.qty > 1 && (
                                      <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full text-[10px] font-bold bg-white" style={{ color: PURPLE }}>
                                        {it.qty}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {visit.images.length > 0 && (() => {
                          const indexed = visit.images.map((img, i) => ({ img, origIdx: i }))
                          const photos = indexed.filter(x => !isVideo(x.img))
                          const videos = indexed.filter(x => isVideo(x.img))
                          return (
                            <div className="space-y-4">
                              {photos.length > 0 && (
                                <div>
                                  <span className="text-xs font-medium text-muted-foreground mb-2 block">Photos ({photos.length})</span>
                                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                                    {photos.map(({ img, origIdx }) => {
                                      const thumbUrl = img.storage === 'drive' && img.driveFileId
                                        ? `https://drive.google.com/thumbnail?id=${img.driveFileId}&sz=w400`
                                        : img.url
                                      return (
                                        <div key={origIdx} className="relative aspect-square rounded-lg overflow-hidden border group">
                                          <img src={thumbUrl} className="w-full h-full object-cover cursor-pointer" loading="lazy"
                                            onClick={() => setLightboxImg(img)} />
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteImage(visit._id, origIdx) }}
                                            className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 flex items-center justify-center text-white sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red-600 transition-all"
                                          >
                                            <X size={12} />
                                          </button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}
                              {videos.length > 0 && (
                                <div>
                                  <span className="text-xs font-medium text-muted-foreground mb-2 block">Videos ({videos.length})</span>
                                  <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
                                    {videos.map(({ img, origIdx }) => (
                                      <div key={origIdx} className="rounded-xl overflow-hidden border bg-black" style={{ minWidth: 0 }}>
                                        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                                          <video
                                            src={img.driveFileId
                                              ? `/api/site-visits/drive-stream/${img.driveFileId}`
                                              : img.url}
                                            controls
                                            playsInline
                                            preload="none"
                                            className="absolute inset-0 w-full h-full object-contain bg-black"
                                          />
                                        </div>
                                        <div className="px-3 py-2 bg-white flex items-center justify-between min-w-0">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <FileVideo size={14} className="text-muted-foreground shrink-0" />
                                            <span className="text-xs text-muted-foreground truncate">{img.originalName || img.filename}</span>
                                            {img.size > 0 && <span className="text-[10px] text-muted-foreground/50 shrink-0">{(img.size / 1024 / 1024).toFixed(1)} MB</span>}
                                          </div>
                                          <button
                                            onClick={() => handleDeleteImage(visit._id, origIdx)}
                                            className="h-7 w-7 rounded-lg border border-red-200 flex items-center justify-center text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 ml-2"
                                          >
                                            <Trash2 size={13} />
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })()}

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground/60">
                            Created by {visit.createdByName || 'Unknown'} · {new Date(visit.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                          {!visit.linkedJob && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setConvertVisit(visit); setConvertErr(''); setSelectedCustId(''); setCustSearch(visit.customerName || '') }}
                              className="text-green-600 hover:text-green-700 border-green-200 hover:border-green-300 hover:bg-green-50 text-xs sm:hidden"
                            >
                              <Briefcase size={13} className="mr-1" /> Create Job
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Convert to Job Modal */}
      <Modal open={!!convertVisit} title="Create Job from Visit" onClose={() => setConvertVisit(null)}>
        <div className="space-y-4">
          {convertVisit && (
            <p className="text-sm text-muted-foreground">
              Creating a job from <strong>{convertVisit.visitNo}</strong>.
              {convertVisit.images.length > 0 && ` ${convertVisit.images.length} photo${convertVisit.images.length !== 1 ? 's' : ''} will be copied to the job.`}
            </p>
          )}
          <Field label="Select Customer *">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search customers..."
                value={custSearch}
                onChange={(e: any) => { setCustSearch(e.target.value); setSelectedCustId('') }}
                className="pl-9"
                autoFocus
              />
            </div>
          </Field>
          <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-1">
            {custList.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No customers found</p>
            ) : custList.map(c => (
              <button
                key={c._id}
                type="button"
                onClick={() => { setSelectedCustId(c._id); setCustSearch(c.fullName) }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm flex justify-between items-center transition-colors ${selectedCustId === c._id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'}`}
              >
                <span>{c.fullName}</span>
                {c.phone && <span className="text-xs text-muted-foreground">{c.phone}</span>}
              </button>
            ))}
          </div>
          {convertErr && <p className="text-sm text-red-600">{convertErr}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConvertVisit(null)}>Cancel</Button>
            <Button onClick={handleConvertToJob} disabled={!selectedCustId || converting}>
              {converting ? 'Creating…' : 'Create Job'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-2 sm:p-4" onClick={() => setLightboxImg(null)}>
          <button className="absolute top-3 right-3 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X size={20} />
          </button>
          {isVideo(lightboxImg) ? (
            <div className="w-full max-w-4xl" style={{ maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                  <video
                    src={lightboxImg.driveFileId
                      ? `/api/site-visits/drive-stream/${lightboxImg.driveFileId}`
                      : lightboxImg.url}
                    controls
                    autoPlay
                    playsInline
                    className="absolute inset-0 w-full h-full rounded-lg object-contain bg-black"
                  />
              </div>
            </div>
          ) : (
            <img
              src={lightboxImg.storage === 'drive' && lightboxImg.driveFileId
                ? `https://drive.google.com/thumbnail?id=${lightboxImg.driveFileId}&sz=w1600`
                : lightboxImg.url}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  )
}
