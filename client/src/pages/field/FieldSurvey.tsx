import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Camera, Plus, X, CheckCircle } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Spinner } from '../../components/ui'

interface SurveyItem {
  description: string
  qty: number
  fragile: boolean
}

interface SurveyRoom {
  name: string
  items: SurveyItem[]
  photos: Array<{ url: string; viewUrl?: string; name: string }>
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function newItem(): SurveyItem {
  return { description: '', qty: 1, fragile: false }
}

function newRoom(): SurveyRoom {
  return { name: '', items: [newItem()], photos: [] }
}

export default function FieldSurvey() {
  const navigate = useNavigate()
  const today = todayIso()
  const [selectedJobId, setSelectedJobId] = useState('')
  const [rooms, setRooms] = useState<SurveyRoom[]>([newRoom()])
  const [notes, setNotes] = useState('')
  const [surveyedBy, setSurveyedBy] = useState('')
  const [uploadingRoom, setUploadingRoom] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<MovingJob[]>({
    queryKey: ['field-jobs-today'],
    queryFn: () => api.get('/moving-jobs/schedule', { params: { from: today, to: today } }).then(r => r.data),
  })

  const saveMut = useMutation({
    mutationFn: () =>
      api.put(`/moving-surveys/job/${selectedJobId}`, {
        rooms,
        notes,
        surveyedBy,
        totalEstimatedVolumeCbm: 0,
        surveyedAt: new Date().toISOString(),
      }),
    onSuccess: () => setDone(true),
    onError: (e) => setErr(apiError(e)),
  })

  async function uploadPhotos(roomIdx: number, files: FileList) {
    setErr('')
    setUploadingRoom(roomIdx)
    try {
      const form = new FormData()
      for (const f of Array.from(files)) form.append('photos', f)
      const res = await api.post(`/moving-surveys/job/${selectedJobId}/photos`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const newPhotos = res.data.photos as Array<{ url: string; viewUrl?: string; name: string }>
      setRooms(prev => prev.map((r, i) =>
        i === roomIdx ? { ...r, photos: [...r.photos, ...newPhotos] } : r
      ))
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setUploadingRoom(null)
    }
  }

  function addRoom() {
    setRooms(prev => [...prev, newRoom()])
  }

  function removeRoom(idx: number) {
    setRooms(prev => prev.filter((_, i) => i !== idx))
  }

  function updateRoom(idx: number, name: string) {
    setRooms(prev => prev.map((r, i) => i === idx ? { ...r, name } : r))
  }

  function addItem(rIdx: number) {
    setRooms(prev => prev.map((r, i) => i === rIdx ? { ...r, items: [...r.items, newItem()] } : r))
  }

  function removeItem(rIdx: number, iIdx: number) {
    setRooms(prev => prev.map((r, i) =>
      i === rIdx ? { ...r, items: r.items.filter((_, ii) => ii !== iIdx) } : r
    ))
  }

  function updateItem(rIdx: number, iIdx: number, patch: Partial<SurveyItem>) {
    setRooms(prev => prev.map((r, i) =>
      i === rIdx
        ? { ...r, items: r.items.map((it, ii) => ii === iIdx ? { ...it, ...patch } : it) }
        : r
    ))
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center pt-24 space-y-5 text-center px-4">
        <CheckCircle size={64} className="text-green-500" />
        <h2 className="text-2xl font-bold text-foreground">Survey Saved!</h2>
        <p className="text-muted-foreground">The survey has been submitted successfully.</p>
        <button
          onClick={() => { setDone(false); setRooms([newRoom()]); setSelectedJobId(''); setNotes(''); setSurveyedBy('') }}
          className="h-12 px-8 rounded-xl bg-primary text-primary-foreground font-semibold"
        >
          Start Another Survey
        </button>
        <button
          onClick={() => navigate('/field')}
          className="text-sm text-muted-foreground underline"
        >
          Go to Home
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      <h1 className="text-xl font-bold text-foreground">Moving Survey</h1>

      {err && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-700">{err}</div>
      )}

      {/* Job selector */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Select Job</label>
        {jobsLoading ? (
          <div className="h-12 flex items-center"><Spinner /></div>
        ) : (
          <select
            value={selectedJobId}
            onChange={e => setSelectedJobId(e.target.value)}
            className="w-full h-12 px-3 rounded-xl border border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">— Select a job —</option>
            {jobs.map(j => (
              <option key={j._id} value={j._id}>
                {j.jobNo} — {j.customer?.fullName}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Surveyed by */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Your Name</label>
        <input
          value={surveyedBy}
          onChange={e => setSurveyedBy(e.target.value)}
          placeholder="Enter your name"
          className="w-full h-12 px-3 rounded-xl border border-border bg-card text-base focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* Rooms */}
      {rooms.map((room, rIdx) => (
        <div key={rIdx} className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Room header */}
          <div className="flex items-center gap-2 p-3 border-b border-border bg-muted/30">
            <input
              value={room.name}
              onChange={e => updateRoom(rIdx, e.target.value)}
              placeholder={`Room ${rIdx + 1} (e.g. Living Room)`}
              className="flex-1 h-10 px-3 rounded-lg border border-border bg-card text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {rooms.length > 1 && (
              <button
                onClick={() => removeRoom(rIdx)}
                className="p-2 text-red-500 hover:text-red-700"
              >
                <X size={18} />
              </button>
            )}
          </div>

          <div className="p-3 space-y-3">
            {/* Items */}
            {room.items.map((item, iIdx) => (
              <div key={iIdx} className="space-y-2 p-3 rounded-xl bg-muted/30 border border-border">
                <div className="flex gap-2">
                  <input
                    value={item.description}
                    onChange={e => updateItem(rIdx, iIdx, { description: e.target.value })}
                    placeholder="Item description"
                    className="flex-1 h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {room.items.length > 1 && (
                    <button onClick={() => removeItem(rIdx, iIdx)} className="p-2 text-muted-foreground hover:text-red-500">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground">Qty:</label>
                    <input
                      type="number"
                      min="1"
                      value={item.qty}
                      onChange={e => updateItem(rIdx, iIdx, { qty: Number(e.target.value) })}
                      className="w-16 h-8 px-2 rounded-lg border border-border bg-card text-sm text-center focus:outline-none"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={item.fragile}
                      onChange={e => updateItem(rIdx, iIdx, { fragile: e.target.checked })}
                      className="w-4 h-4 rounded accent-primary"
                    />
                    <span className="text-xs text-muted-foreground">Fragile</span>
                  </label>
                </div>
              </div>
            ))}

            <button
              onClick={() => addItem(rIdx)}
              className="w-full h-9 rounded-xl border border-dashed border-border text-muted-foreground text-sm font-medium hover:bg-muted/50 transition-colors flex items-center justify-center gap-1"
            >
              <Plus size={14} /> Add Item
            </button>

            {/* Photos */}
            {room.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {room.photos.map((p, pIdx) => (
                  <a key={pIdx} href={p.viewUrl || p.url} target="_blank" rel="noreferrer"
                    className="aspect-square rounded-lg bg-muted border border-border overflow-hidden block">
                    <img
                      src={p.url}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  </a>
                ))}
              </div>
            )}

            {/* Photo upload — only show if a job is selected */}
            {selectedJobId && (
              <>
                <input
                  ref={el => { fileRefs.current[rIdx] = el }}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={e => {
                    if (e.target.files?.length) {
                      uploadPhotos(rIdx, e.target.files)
                      e.target.value = ''
                    }
                  }}
                />
                <button
                  onClick={() => fileRefs.current[rIdx]?.click()}
                  disabled={uploadingRoom === rIdx}
                  className="w-full h-10 rounded-xl border border-border bg-muted text-sm font-medium flex items-center justify-center gap-2 hover:bg-muted/70 transition-colors disabled:opacity-60"
                >
                  <Camera size={16} />
                  {uploadingRoom === rIdx ? 'Uploading…' : 'Take / Add Photos'}
                </button>
              </>
            )}
          </div>
        </div>
      ))}

      <button
        onClick={addRoom}
        className="w-full h-12 rounded-xl border-2 border-dashed border-primary/40 text-primary font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/5 transition-colors"
      >
        <Plus size={18} /> Add Room
      </button>

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any additional notes about the move…"
          rows={3}
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
        />
      </div>

      {/* Save */}
      <button
        onClick={() => saveMut.mutate()}
        disabled={!selectedJobId || saveMut.isPending}
        className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-base disabled:opacity-60 transition-colors hover:bg-primary/90"
      >
        {saveMut.isPending ? 'Saving…' : 'Submit Survey'}
      </button>
    </div>
  )
}
