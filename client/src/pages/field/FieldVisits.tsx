import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, MapPin, User, Phone, ChevronDown, ChevronUp, Trash2, Upload, X, FileVideo, Camera } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Spinner } from '../../components/ui'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

interface SiteVisitImage {
  url: string; filename: string; originalName: string; size: number
  storage: string; driveFileId: string; uploadedAt: string
}
interface SiteVisit {
  _id: string; visitNo: string; visitDate: string
  customerName: string; customerPhone: string; address: string; notes: string
  items: Array<{ name: string; qty: number }>
  images: SiteVisitImage[]; linkedJob?: string
  createdByName: string; createdAt: string
}

function isVideo(img: SiteVisitImage) {
  const ext = (img.filename || img.originalName || '').toLowerCase()
  return ext.endsWith('.mp4') || ext.endsWith('.mov') || ext.endsWith('.avi') || ext.endsWith('.webm')
}

export default function FieldVisits() {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const addFileRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [addingToVisitId, setAddingToVisitId] = useState<string | null>(null)
  const [addFileProgress, setAddFileProgress] = useState(0)

  const { data: visits = [], isLoading } = useQuery<SiteVisit[]>({
    queryKey: ['site-visits'],
    queryFn: () => api.get('/site-visits').then(r => r.data),
  })

  const handleCreate = async () => {
    if (!customerName.trim()) return setError('Customer name required')
    setUploading(true); setUploadProgress(0); setError('')
    try {
      const fd = new FormData()
      fd.append('visitDate', visitDate)
      fd.append('customerName', customerName)
      fd.append('customerPhone', customerPhone)
      fd.append('address', address)
      fd.append('notes', notes)
      files.forEach(f => fd.append('files', f))
      await api.post('/site-visits', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
        onUploadProgress: (e) => { if (e.total) setUploadProgress(Math.round((e.loaded * 100) / e.total)) },
      })
      qc.invalidateQueries({ queryKey: ['site-visits'] })
      setShowForm(false); setCustomerName(''); setCustomerPhone(''); setAddress(''); setNotes(''); setFiles([])
    } catch (err) {
      setError(apiError(err))
    } finally {
      setUploading(false)
    }
  }

  const handleAddFiles = async (visitId: string, fileList: FileList) => {
    const MAX = 500 * 1024 * 1024
    const all = Array.from(fileList)
    const arr = all.filter(f => f.size <= MAX)
    if (arr.length < all.length) alert(`${all.length - arr.length} file(s) skipped — max 500 MB each`)
    if (!arr.length) return
    setAddingToVisitId(visitId); setAddFileProgress(0)
    try {
      const fd = new FormData()
      arr.forEach(f => fd.append('files', f))
      await api.post(`/site-visits/${visitId}/images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300000,
        onUploadProgress: (e) => { if (e.total) setAddFileProgress(Math.round((e.loaded * 100) / e.total)) },
      })
      qc.invalidateQueries({ queryKey: ['site-visits'] })
    } catch (err) {
      alert(apiError(err))
    } finally {
      setAddingToVisitId(null); setAddFileProgress(0)
    }
  }

  const handleDeleteImage = async (visitId: string, imgIdx: number) => {
    if (!confirm('Delete this file?')) return
    try {
      await api.delete(`/site-visits/${visitId}/images/${imgIdx}`)
      qc.invalidateQueries({ queryKey: ['site-visits'] })
    } catch (err) { alert(apiError(err)) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this visit?')) return
    try {
      await api.delete(`/site-visits/${id}`)
      qc.invalidateQueries({ queryKey: ['site-visits'] })
    } catch (err) { alert(apiError(err)) }
  }

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Site Visits</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="h-9 px-3 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5"
          style={{ background: PURPLE }}
        >
          <Plus size={14} /> New Visit
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Visit Date</label>
              <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg border border-border text-sm mt-1" />
            </div>
            <div>
              <label style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Phone</label>
              <input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Phone"
                className="w-full h-9 px-2.5 rounded-lg border border-border text-sm mt-1" />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Customer Name *</label>
            <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" autoFocus
              className="w-full h-9 px-2.5 rounded-lg border border-border text-sm mt-1" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Address</label>
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Visit address"
              className="w-full h-9 px-2.5 rounded-lg border border-border text-sm mt-1" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Notes..."
              className="w-full px-2.5 py-2 rounded-lg border border-border text-sm mt-1 resize-none" />
          </div>

          {/* File picker */}
          <div>
            <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden"
              onChange={e => { if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)]); e.target.value = '' }} />
            <button onClick={() => fileRef.current?.click()} type="button"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-primary/30 text-xs font-medium text-primary">
              <Camera size={14} /> Add Photos / Videos
            </button>
            {files.length > 0 && (
              <p style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{files.length} file(s) selected</p>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {uploading ? (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span style={{ color: MUTED }}>Uploading…</span>
                <span style={{ color: PURPLE, fontWeight: 600 }}>{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${uploadProgress}%`, background: PURPLE }} />
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setShowForm(false)}
                className="flex-1 h-10 rounded-xl border border-border text-sm font-medium">Cancel</button>
              <button onClick={handleCreate}
                className="flex-1 h-10 rounded-xl text-white text-sm font-semibold" style={{ background: PURPLE }}>
                Save Visit
              </button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {visits.length === 0 ? (
        <div className="text-center pt-12 space-y-2">
          <MapPin size={32} className="mx-auto" style={{ color: MUTED, opacity: 0.4 }} />
          <p style={{ fontSize: 14, color: MUTED }}>No site visits yet</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visits.map(visit => {
            const isOpen = expanded === visit._id
            return (
              <div key={visit._id} className="rounded-xl border border-border bg-card overflow-hidden">
                <button className="w-full text-left p-3.5" onClick={() => setExpanded(isOpen ? null : visit._id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{visit.visitNo}</span>
                        <span style={{ fontSize: 10, color: MUTED }}>
                          {new Date(visit.visitDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        {visit.images.length > 0 && (
                          <span style={{ fontSize: 10, color: MUTED }}>{visit.images.length} file{visit.images.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: INK }} className="truncate">{visit.customerName}</p>
                      {visit.address && <p style={{ fontSize: 11, color: MUTED }} className="truncate">{visit.address}</p>}
                    </div>
                    <div className="shrink-0 mt-1" style={{ color: MUTED }}>
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-3.5 pb-3.5 space-y-3 mt-0 pt-3">
                    {visit.customerPhone && (
                      <a href={`tel:${visit.customerPhone}`} className="flex items-center gap-2" style={{ fontSize: 12, color: PURPLE }}>
                        <Phone size={12} /> {visit.customerPhone}
                      </a>
                    )}
                    {visit.notes && <p style={{ fontSize: 12, color: INK, whiteSpace: 'pre-wrap' }}>{visit.notes}</p>}

                    {/* Items */}
                    {visit.items && visit.items.length > 0 && (
                      <div>
                        <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, marginBottom: 4 }}>ITEMS</p>
                        <div className="flex flex-wrap gap-1.5">
                          {visit.items.map((it, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full text-xs border border-border" style={{ color: INK }}>
                              {it.name} × {it.qty}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Images */}
                    {visit.images.length > 0 && (() => {
                      const photos = visit.images.filter((img, i) => !isVideo(img)).map((img, _, __, i = visit.images.indexOf(img)) => ({ img, origIdx: i }))
                      const videos = visit.images.filter(img => isVideo(img)).map((img, _, __, i = visit.images.indexOf(img)) => ({ img, origIdx: i }))
                      return (
                        <div className="space-y-3">
                          {photos.length > 0 && (
                            <div>
                              <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, marginBottom: 4 }}>Photos ({photos.length})</p>
                              <div className="grid grid-cols-3 gap-1.5">
                                {photos.map(({ img, origIdx }) => {
                                  const thumbUrl = img.storage === 'drive' && img.driveFileId
                                    ? `https://drive.google.com/thumbnail?id=${img.driveFileId}&sz=w400` : img.url
                                  return (
                                    <div key={origIdx} className="relative aspect-square rounded-lg overflow-hidden border group">
                                      <img src={thumbUrl} className="w-full h-full object-cover" loading="lazy" />
                                      <button
                                        onClick={() => handleDeleteImage(visit._id, origIdx)}
                                        className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 flex items-center justify-center text-white"
                                      ><X size={10} /></button>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {videos.length > 0 && (
                            <div>
                              <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, marginBottom: 4 }}>Videos ({videos.length})</p>
                              <div className="space-y-2">
                                {videos.map(({ img, origIdx }) => (
                                  <div key={origIdx} className="rounded-lg overflow-hidden border bg-black">
                                    <video
                                      src={img.driveFileId ? `/api/site-visits/drive-stream/${img.driveFileId}` : img.url}
                                      controls playsInline preload="none"
                                      className="w-full" style={{ maxHeight: 200 }}
                                    />
                                    <div className="px-2 py-1.5 bg-white flex items-center justify-between">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <FileVideo size={12} style={{ color: MUTED }} />
                                        <span style={{ fontSize: 10, color: MUTED }} className="truncate">{img.originalName || img.filename}</span>
                                      </div>
                                      <button onClick={() => handleDeleteImage(visit._id, origIdx)}
                                        className="h-6 w-6 rounded border border-red-200 flex items-center justify-center text-red-500 shrink-0">
                                        <Trash2 size={10} />
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

                    {/* Add files + Delete */}
                    <div className="flex items-center justify-between gap-2">
                      {addingToVisitId === visit._id ? (
                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between text-xs">
                            <span style={{ color: MUTED }}>Uploading…</span>
                            <span style={{ color: PURPLE, fontWeight: 600 }}>{addFileProgress}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${addFileProgress}%`, background: PURPLE }} />
                          </div>
                        </div>
                      ) : (
                        <>
                          <input
                            ref={el => { addFileRefs.current[visit._id] = el }}
                            type="file" multiple accept="image/*,video/*" style={{ display: 'none' }}
                            onChange={e => { if (e.target.files?.length) { handleAddFiles(visit._id, e.target.files); e.target.value = '' } }}
                          />
                          <button type="button" onClick={() => addFileRefs.current[visit._id]?.click()}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border-2 border-dashed border-primary/30 text-xs font-medium text-primary">
                            <Upload size={12} /> Add Files
                          </button>
                        </>
                      )}
                      <button onClick={() => handleDelete(visit._id)}
                        className="h-8 w-8 rounded-lg border border-red-200 flex items-center justify-center text-red-500">
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <p style={{ fontSize: 10, color: MUTED }}>
                      Created by {visit.createdByName || 'Unknown'} · {new Date(visit.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
