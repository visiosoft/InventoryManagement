import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Plus, Trash2, X } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui'

interface SurveyItem {
  description: string
  qty: number
  estimatedVolumeCbm: number
  fragile: boolean
  notes: string
}

interface SurveyPhoto {
  url: string       // thumbnail / embeddable URL for <img>
  viewUrl?: string  // open-in-Drive link
  name: string
  mimeType?: string
}

interface SurveyRoom {
  name: string
  items: SurveyItem[]
  photos: SurveyPhoto[]
}

interface Survey {
  _id?: string
  job: string
  rooms: SurveyRoom[]
  notes: string
  totalEstimatedVolumeCbm: number
  recommendedTruckType: string
  surveyedBy?: string
}

function newItem(): SurveyItem {
  return { description: '', qty: 1, estimatedVolumeCbm: 0, fragile: false, notes: '' }
}

function newRoom(): SurveyRoom {
  return { name: '', items: [newItem()], photos: [] }
}

function calcTotal(rooms: SurveyRoom[]): number {
  return rooms.reduce((sum, r) => sum + r.items.reduce((s, it) => s + (it.estimatedVolumeCbm * it.qty), 0), 0)
}

export default function MovingSurveyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [rooms, setRooms] = useState<SurveyRoom[]>([])
  const [notes, setNotes] = useState('')
  const [surveyedBy, setSurveyedBy] = useState('')
  const [recommendedTruckType, setRecommendedTruckType] = useState('')
  const [err, setErr] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [uploadingRoom, setUploadingRoom] = useState<number | null>(null)
  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([])

  const { data: job } = useQuery<MovingJob>({
    queryKey: ['moving-job', id],
    queryFn: () => api.get(`/moving-jobs/${id}`).then(r => r.data),
  })

  const { isLoading, data: surveyData } = useQuery<Survey>({
    queryKey: ['moving-survey', id],
    queryFn: () => api.get(`/moving-surveys/job/${id}`).then(r => r.data),
    enabled: !!id,
  })

  useEffect(() => {
    if (!surveyData) return
    const data = surveyData
    const loaded = data.rooms?.length
      ? data.rooms.map(r => ({
          name: r.name || '',
          items: r.items?.length ? r.items.map(it => ({
            description: it.description || '',
            qty: it.qty ?? 1,
            estimatedVolumeCbm: it.estimatedVolumeCbm ?? 0,
            fragile: it.fragile ?? false,
            notes: it.notes || '',
          })) : [newItem()],
          photos: (r as any).photos || [],
        }))
      : [newRoom()]
    setRooms(loaded)
    setNotes(data.notes || '')
    setSurveyedBy(data.surveyedBy || '')
    setRecommendedTruckType(data.recommendedTruckType || '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyData])

  const saveMut = useMutation({
    mutationFn: () => {
      const total = parseFloat(calcTotal(rooms).toFixed(3))
      return api.put(`/moving-surveys/job/${id}`, {
        rooms,
        notes,
        surveyedBy,
        recommendedTruckType,
        totalEstimatedVolumeCbm: total,
        surveyedAt: new Date().toISOString(),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moving-job', id] })
      setSaveMsg('Survey saved successfully')
      setTimeout(() => setSaveMsg(''), 3000)
    },
    onError: (e) => setErr(apiError(e)),
  })

  async function uploadPhotos(roomIdx: number, files: FileList) {
    setErr('')
    setUploadingRoom(roomIdx)
    try {
      const form = new FormData()
      for (const f of Array.from(files)) form.append('photos', f)
      const res = await api.post(`/moving-surveys/job/${id}/photos`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const newPhotos: SurveyPhoto[] = res.data.photos
      setRooms(prev => prev.map((r, i) =>
        i === roomIdx ? { ...r, photos: [...r.photos, ...newPhotos] } : r
      ))
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setUploadingRoom(null)
    }
  }

  function updateRoom(idx: number, patch: Partial<SurveyRoom>) {
    setRooms(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  function addRoom() {
    setRooms(prev => [...prev, newRoom()])
  }

  function removeRoom(idx: number) {
    setRooms(prev => prev.filter((_, i) => i !== idx))
  }

  function addItem(roomIdx: number) {
    setRooms(prev => prev.map((r, i) => i === roomIdx ? { ...r, items: [...r.items, newItem()] } : r))
  }

  function removeItem(roomIdx: number, itemIdx: number) {
    setRooms(prev => prev.map((r, i) =>
      i === roomIdx ? { ...r, items: r.items.filter((_, ii) => ii !== itemIdx) } : r
    ))
  }

  function updateItem(roomIdx: number, itemIdx: number, patch: Partial<SurveyItem>) {
    setRooms(prev => prev.map((r, i) =>
      i === roomIdx
        ? { ...r, items: r.items.map((it, ii) => ii === itemIdx ? { ...it, ...patch } : it) }
        : r
    ))
  }

  function removePhoto(roomIdx: number, photoIdx: number) {
    setRooms(prev => prev.map((r, i) =>
      i === roomIdx ? { ...r, photos: r.photos.filter((_, pi) => pi !== photoIdx) } : r
    ))
  }

  const totalVol = calcTotal(rooms)

  if (isLoading) return <div className="p-12"><Spinner /></div>

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to={`/moving/jobs/${id}`}
          className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Survey</h1>
          {job && (
            <p className="text-sm text-muted-foreground">
              {job.jobNo} — {job.customer?.fullName}
            </p>
          )}
        </div>
        {job && (
          <Badge tone={{ draft: 'gray', confirmed: 'blue', survey_done: 'purple', in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red' }[job.status] ?? 'gray'}>
            {job.status.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>

      {/* Error / success */}
      {err && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-700">{err}</div>}
      {saveMsg && <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-700">{saveMsg}</div>}

      {/* Job summary */}
      {job && (
        <Card>
          <CardBody className="py-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Pickup:</span> <span className="ml-1 font-medium">{job.pickupAddress || '—'}</span></div>
              <div><span className="text-muted-foreground">Delivery:</span> <span className="ml-1 font-medium">{job.deliveryAddress || '—'}</span></div>
              <div><span className="text-muted-foreground">Date:</span> <span className="ml-1 font-medium">{job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString('en-GB') : '—'}</span></div>
              <div><span className="text-muted-foreground">Time:</span> <span className="ml-1 font-medium">{job.scheduledTimeSlot || '—'}</span></div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Rooms */}
      {rooms.map((room, rIdx) => (
        <Card key={rIdx}>
          <CardHeader
            title={
              <div className="flex items-center gap-2 flex-1">
                <Input
                  value={room.name}
                  onChange={e => updateRoom(rIdx, { name: e.target.value })}
                  placeholder={`Room ${rIdx + 1} name (e.g. Living Room)`}
                  className="text-base font-semibold h-9 flex-1"
                />
              </div>
            }
            action={
              <Button size="sm" variant="ghost" onClick={() => removeRoom(rIdx)} className="text-red-500 hover:text-red-700">
                <Trash2 size={16} />
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {/* Items table */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Items</p>
              {room.items.map((item, iIdx) => (
                <div key={iIdx} className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
                  <div className="flex gap-2 items-start">
                    <div className="flex-1">
                      <Input
                        value={item.description}
                        onChange={e => updateItem(rIdx, iIdx, { description: e.target.value })}
                        placeholder="Item description"
                        className="h-10"
                      />
                    </div>
                    <button
                      onClick={() => removeItem(rIdx, iIdx)}
                      className="p-2 text-muted-foreground hover:text-red-500 transition-colors mt-0.5"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Qty">
                      <Input
                        type="number"
                        min="1"
                        value={item.qty}
                        onChange={e => updateItem(rIdx, iIdx, { qty: Number(e.target.value) })}
                        className="h-9"
                      />
                    </Field>
                    <Field label="Volume (CBM)">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.estimatedVolumeCbm}
                        onChange={e => updateItem(rIdx, iIdx, { estimatedVolumeCbm: Number(e.target.value) })}
                        className="h-9"
                      />
                    </Field>
                    <Field label="Fragile?">
                      <div className="flex items-center h-9 gap-2">
                        <input
                          type="checkbox"
                          id={`fragile-${rIdx}-${iIdx}`}
                          checked={item.fragile}
                          onChange={e => updateItem(rIdx, iIdx, { fragile: e.target.checked })}
                          className="w-4 h-4 rounded accent-primary"
                        />
                        <label htmlFor={`fragile-${rIdx}-${iIdx}`} className="text-sm select-none cursor-pointer">
                          Yes
                        </label>
                      </div>
                    </Field>
                  </div>
                  <Input
                    value={item.notes}
                    onChange={e => updateItem(rIdx, iIdx, { notes: e.target.value })}
                    placeholder="Item notes (optional)"
                    className="h-9 text-sm"
                  />
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => addItem(rIdx)} className="w-full">
                <Plus size={14} className="mr-1" /> Add Item
              </Button>
            </div>

            {/* Photos */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Photos</p>
              {room.photos.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {room.photos.map((photo, pIdx) => (
                    <div key={pIdx} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
                      <a href={photo.viewUrl || photo.url} target="_blank" rel="noreferrer" className="block w-full h-full">
                        <img
                          src={photo.url}
                          alt={photo.name}
                          className="w-full h-full object-cover"
                        />
                      </a>
                      <button
                        onClick={() => removePhoto(rIdx, pIdx)}
                        className="absolute top-1 right-1 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <input
                  ref={el => { fileInputRefs.current[rIdx] = el }}
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRefs.current[rIdx]?.click()}
                  disabled={uploadingRoom === rIdx}
                  className="h-10"
                >
                  <Camera size={14} className="mr-1" />
                  {uploadingRoom === rIdx ? 'Uploading…' : 'Add Photos'}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ))}

      {/* Add room button */}
      <Button variant="outline" onClick={addRoom} className="w-full h-12 text-base">
        <Plus size={18} className="mr-2" /> Add Room
      </Button>

      {/* Survey meta */}
      <Card>
        <CardHeader title="Survey Details" />
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Total Estimated Volume (CBM)">
              <div className="flex items-center h-10 px-3 rounded-lg border border-border bg-muted/30 font-semibold text-lg">
                {totalVol.toFixed(2)} CBM
              </div>
            </Field>
            <Field label="Recommended Truck Type">
              <Select
                value={recommendedTruckType}
                onChange={e => setRecommendedTruckType(e.target.value)}
                className="h-10"
              >
                <option value="">— Select truck type —</option>
                <option value="small">Small (&lt;15 CBM)</option>
                <option value="medium">Medium (15–30 CBM)</option>
                <option value="large">Large (30–50 CBM)</option>
                <option value="extra_large">Extra Large (&gt;50 CBM)</option>
              </Select>
            </Field>
          </div>
          <Field label="Surveyed By">
            <Input
              value={surveyedBy}
              onChange={e => setSurveyedBy(e.target.value)}
              placeholder="Your name"
              className="h-10"
            />
          </Field>
          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any additional survey notes…"
              rows={3}
            />
          </Field>
        </CardBody>
      </Card>

      {/* Save */}
      <div className="flex gap-3 pb-8">
        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="flex-1 h-12 text-base"
        >
          {saveMut.isPending ? 'Saving…' : 'Save Survey'}
        </Button>
        <Button
          variant="outline"
          onClick={() => navigate(`/moving/jobs/${id}`)}
          className="h-12"
        >
          Back to Job
        </Button>
      </div>
    </div>
  )
}
