import { useEffect, useState, useRef, type FormEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Upload, Plus, Trash2, X, Image, FileVideo, Clock } from 'lucide-react'
import { portalApi, portalApiError } from '../../lib/customerAuth'

type VisitImage = { url: string; originalName: string; size: number; _id: string }
type Visit = { _id: string; notes: string; images: VisitImage[]; createdAt: string }
type Job = {
  _id: string; jobNo: string; status: string
  pickupAddress: string; pickupFloor: string; pickupHasElevator: boolean
  deliveryAddress: string; deliveryFloor: string; deliveryHasElevator: boolean
  scheduledDate: string; scheduledTimeSlot: string
  clientPackage?: { label?: string }
  notes: string
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#F3F0FF', color: '#5B2BC9', label: 'Draft' },
  confirmed: { bg: '#E0F2FE', color: '#0369A1', label: 'Confirmed' },
  in_progress: { bg: '#FFF7ED', color: '#C2410C', label: 'In Progress' },
  completed: { bg: '#ECFDF5', color: '#059669', label: 'Completed' },
  invoiced: { bg: '#F0FDF4', color: '#15803D', label: 'Invoiced' },
  cancelled: { bg: '#FEF2F2', color: '#B91C1C', label: 'Cancelled' },
}

export default function PortalJobDetail() {
  const { id } = useParams<{ id: string }>()
  const [job, setJob] = useState<Job | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([
      portalApi.get(`/customer-portal/moves/${id}`),
      portalApi.get(`/customer-portal/moves/${id}/visits`),
    ]).then(([jobRes, visitRes]) => {
      setJob(jobRes.data.data)
      setVisits(visitRes.data.visits || [])
    }).finally(() => setLoading(false))
  }, [id])

  function handleFiles(picked: FileList | null) {
    if (!picked) return
    const arr = Array.from(picked).filter(f => f.size <= 50 * 1024 * 1024)
    setFiles(prev => [...prev, ...arr])
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!notes.trim() && !files.length) return
    setUploading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('notes', notes)
      files.forEach(f => fd.append('files', f))
      const { data } = await portalApi.post(`/customer-portal/moves/${id}/visits`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setVisits(prev => [data.visit, ...prev])
      setNotes('')
      setFiles([])
      setShowForm(false)
    } catch (err) {
      setError(portalApiError(err))
    } finally {
      setUploading(false)
    }
  }

  async function deleteVisit(visitId: string) {
    if (!confirm('Delete this visit entry?')) return
    try {
      await portalApi.delete(`/customer-portal/moves/${id}/visits/${visitId}`)
      setVisits(prev => prev.filter(v => v._id !== visitId))
    } catch (err) {
      alert(portalApiError(err))
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-2 rounded-full" style={{ borderColor: '#5B2BC9', borderTopColor: 'transparent' }} /></div>
  }

  if (!job) {
    return (
      <div className="text-center py-20">
        <h2 className="text-lg font-bold" style={{ color: '#14081F' }}>Job not found</h2>
        <Link to="/portal" className="text-sm font-medium mt-2 inline-block" style={{ color: '#5B2BC9' }}>Back to jobs</Link>
      </div>
    )
  }

  const s = STATUS_STYLE[job.status] || STATUS_STYLE.draft

  function imgSrc(url: string) {
    if (url.includes('drive.google.com/thumbnail')) return url.replace(/sz=w\d+/, 'sz=w800')
    return url
  }

  function fullSrc(url: string) {
    if (url.includes('drive.google.com/thumbnail')) {
      const id = url.match(/id=([^&]+)/)?.[1]
      return id ? `https://drive.google.com/uc?id=${id}` : url
    }
    return url
  }

  return (
    <div>
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setLightbox(null)}><X size={28} /></button>
          <img src={lightbox} className="max-w-full max-h-[90vh] rounded-lg object-contain" onClick={e => e.stopPropagation()} />
        </div>
      )}

      <Link to="/portal" className="inline-flex items-center gap-1.5 text-sm font-medium mb-5" style={{ color: '#5B2BC9' }}>
        <ArrowLeft size={16} /> Back to jobs
      </Link>

      {/* Job info card */}
      <div className="rounded-2xl border p-5 mb-6" style={{ background: '#fff', borderColor: 'rgba(20,8,31,.08)' }}>
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-lg font-bold" style={{ color: '#14081F' }}>{job.jobNo}</h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: s.bg, color: s.color }}>{s.label}</span>
          {job.clientPackage?.label && <span className="text-xs" style={{ color: '#756E80' }}>{job.clientPackage.label}</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm" style={{ color: '#756E80' }}>
          {job.pickupAddress && (
            <div className="flex items-start gap-2">
              <MapPin size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="text-[10px] uppercase font-semibold tracking-wider mb-0.5">Pickup</div>
                <div style={{ color: '#14081F' }}>{job.pickupAddress}</div>
                {(job.pickupFloor || job.pickupHasElevator) && (
                  <div className="text-xs">Floor {job.pickupFloor}{job.pickupHasElevator ? ' (elevator)' : ''}</div>
                )}
              </div>
            </div>
          )}
          {job.deliveryAddress && (
            <div className="flex items-start gap-2">
              <MapPin size={14} className="mt-0.5 shrink-0" style={{ color: '#5B2BC9' }} />
              <div>
                <div className="text-[10px] uppercase font-semibold tracking-wider mb-0.5">Delivery</div>
                <div style={{ color: '#14081F' }}>{job.deliveryAddress}</div>
                {(job.deliveryFloor || job.deliveryHasElevator) && (
                  <div className="text-xs">Floor {job.deliveryFloor}{job.deliveryHasElevator ? ' (elevator)' : ''}</div>
                )}
              </div>
            </div>
          )}
          {job.scheduledDate && (
            <div className="flex items-center gap-2">
              <Calendar size={14} className="shrink-0" />
              <span style={{ color: '#14081F' }}>
                {new Date(job.scheduledDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                {job.scheduledTimeSlot && ` · ${job.scheduledTimeSlot}`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Visits section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold" style={{ color: '#14081F' }}>Site Visits</h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl text-sm font-semibold transition-colors"
            style={{ background: '#5B2BC9', color: '#fff' }}
          >
            <Plus size={16} /> Add Visit
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-2xl border p-5 mb-6" style={{ background: '#fff', borderColor: 'rgba(20,8,31,.08)' }}>
          <div className="mb-4">
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#14081F' }}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe what you see — rooms, items, special instructions..."
              rows={3}
              className="w-full rounded-xl border-2 px-4 py-3 text-sm resize-none focus:outline-none transition-colors"
              style={{ borderColor: '#E8E0D4', background: '#FDFBF7', color: '#14081F' }}
              onFocus={e => e.target.style.borderColor = '#5B2BC9'}
              onBlur={e => e.target.style.borderColor = '#E8E0D4'}
            />
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#14081F' }}>Photos & Videos</label>
            <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={e => handleFiles(e.target.files)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 transition-colors"
              style={{ borderColor: '#D4C0F0', background: '#F9F5FF', color: '#5B2BC9' }}
            >
              <Upload size={22} />
              <span className="text-xs font-medium">Tap to add photos or videos</span>
            </button>
          </div>

          {files.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
              {files.map((f, i) => (
                <div key={i} className="relative rounded-lg overflow-hidden aspect-square" style={{ background: '#F3F0FF' }}>
                  {f.type.startsWith('video') ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                      <FileVideo size={24} style={{ color: '#5B2BC9' }} />
                      <span className="text-[10px] px-1 text-center truncate w-full" style={{ color: '#756E80' }}>{f.name}</span>
                    </div>
                  ) : (
                    <img src={URL.createObjectURL(f)} className="w-full h-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,.6)' }}
                  >
                    <X size={12} color="#fff" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-lg border px-3 py-2.5 text-xs mb-3" style={{ borderColor: '#f0c0c0', background: '#fef2f2', color: '#b91c1c' }}>
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={uploading || (!notes.trim() && !files.length)}
              className="flex-1 h-10 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#5B2BC9', color: '#fff' }}
            >
              {uploading ? 'Uploading...' : 'Save Visit'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setNotes(''); setFiles([]); setError('') }}
              className="h-10 px-4 rounded-xl text-sm font-medium border"
              style={{ borderColor: '#E8E0D4', color: '#756E80' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {visits.length === 0 && !showForm && (
        <div className="rounded-2xl border p-8 text-center" style={{ background: '#fff', borderColor: 'rgba(20,8,31,.08)' }}>
          <Image size={40} style={{ color: '#D4C0F0' }} className="mx-auto mb-3" />
          <p className="text-sm font-medium" style={{ color: '#14081F' }}>No visits yet</p>
          <p className="text-xs mt-1" style={{ color: '#756E80' }}>Add a visit to upload photos and notes about your property.</p>
        </div>
      )}

      <div className="space-y-4">
        {visits.map(visit => (
          <div key={visit._id} className="rounded-2xl border p-5" style={{ background: '#fff', borderColor: 'rgba(20,8,31,.08)' }}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 text-xs" style={{ color: '#756E80' }}>
                <Clock size={12} />
                {new Date(visit.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}
                {new Date(visit.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </div>
              <button
                onClick={() => deleteVisit(visit._id)}
                className="h-7 w-7 rounded-lg flex items-center justify-center transition-colors hover:bg-red-50"
                title="Delete visit"
              >
                <Trash2 size={14} style={{ color: '#B91C1C' }} />
              </button>
            </div>

            {visit.notes && (
              <p className="text-sm mb-3 whitespace-pre-wrap" style={{ color: '#14081F' }}>{visit.notes}</p>
            )}

            {visit.images.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {visit.images.map(img => (
                  <div
                    key={img._id}
                    className="relative rounded-lg overflow-hidden aspect-square cursor-pointer hover:opacity-90 transition-opacity"
                    style={{ background: '#F3F0FF' }}
                    onClick={() => setLightbox(fullSrc(img.url))}
                  >
                    <img src={imgSrc(img.url)} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
