import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Printer, DollarSign, Camera, X, CalendarDays, Share2 } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Spinner, Textarea, movingJobStatusLabel } from '../../components/ui'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

function getLocalDateString(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface PriceModalState { jobId: string; jobNo: string; currentCost: number }

function buildShareMessage(job: MovingJob) {
  const crew = (job.crew ?? []) as Array<{ worker: { name: string; role: string; phone?: string }; role?: string; isSupervisor?: boolean }>
  const trucks = (job.trucks ?? []) as Array<{ truck: { name: string; plateNumber?: string } }>
  const images = job.images ?? []
  const pkg = job.clientPackage
  const dateStr = job.scheduledDate
    ? new Date(job.scheduledDate).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    : ''

  const lines: string[] = []
  lines.push(`📦 *Job ${job.jobNo}*`)
  lines.push(`📅 ${dateStr}${job.scheduledTimeSlot ? ` · ${job.scheduledTimeSlot}` : ''}`)
  if (pkg?.label) lines.push(`📋 Package: ${pkg.label}`)
  lines.push('')

  lines.push(`👤 *Customer:* ${job.customer?.fullName || '—'}`)
  if (job.customer?.phone) lines.push(`📞 ${job.customer.phone}`)
  lines.push('')

  lines.push(`📍 *Pickup:* ${job.pickupAddress || '—'}`)
  if (job.pickupFloor) lines.push(`   Floor: ${job.pickupFloor}${job.pickupHasElevator ? ' (Elevator ✓)' : ' (No elevator)'}`)
  lines.push(`📍 *Delivery:* ${job.deliveryAddress || '—'}`)
  if (job.deliveryFloor) lines.push(`   Floor: ${job.deliveryFloor}${job.deliveryHasElevator ? ' (Elevator ✓)' : ' (No elevator)'}`)
  lines.push('')

  if (crew.length > 0) {
    lines.push(`👥 *Crew (${crew.length}):*`)
    crew.forEach(c => {
      const sup = c.isSupervisor ? ' ⭐' : ''
      lines.push(`  • ${c.worker.name} (${c.role || c.worker.role})${sup}${c.worker.phone ? ' — ' + c.worker.phone : ''}`)
    })
    lines.push('')
  }

  if (trucks.length > 0) {
    lines.push(`🚛 *Trucks (${trucks.length}):*`)
    trucks.forEach(t => {
      lines.push(`  • ${t.truck.name}${t.truck.plateNumber ? ' — ' + t.truck.plateNumber : ''}`)
    })
    lines.push('')
  }

  if (job.moveOutPermitRequired) lines.push(`⚠️ *Move-out permit required*\n`)
  if (job.dispatchNotes) lines.push(`📝 *Notes:* ${job.dispatchNotes}\n`)

  if (images.length > 0) {
    lines.push(`🖼 ${images.length} estimation photo(s) available`)
    lines.push(`View job: ${window.location.origin}/moving/jobs/${job._id}`)
  }

  return lines.join('\n')
}

function JobDispatchCard({ job, index, onPriceOverride }: { job: MovingJob; index: number; onPriceOverride: (s: PriceModalState) => void }) {
  const [lightbox, setLightbox] = useState<{ url: string; name: string; idx: number } | null>(null)

  const crew = (job.crew ?? []) as Array<{ worker: { name: string; role: string; phone?: string }; role?: string; isSupervisor?: boolean }>
  const trucks = (job.trucks ?? []) as Array<{ truck: { name: string; plateNumber?: string } }>
  const images = job.images ?? []
  const override = job.fieldPriceOverride
  const pkg = job.clientPackage
  const clientPrice = pkg?.agreedPrice
    ? pkg.agreedPrice + (pkg.additionalCharges ?? []).reduce((s, a) => s + (a.amount || 0), 0)
    : null

  function imgUrl(img: typeof images[number], size = 800) {
    return img.storage === 'drive' && img.driveFileId
      ? `https://drive.google.com/thumbnail?id=${img.driveFileId}&sz=w${size}`
      : img.url
  }

  function handleShare() {
    const msg = buildShareMessage(job)
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  function goLightbox(dir: 1 | -1) {
    if (!lightbox) return
    const next = (lightbox.idx + dir + images.length) % images.length
    setLightbox({ url: imgUrl(images[next], 1600), name: images[next].originalName || `Photo ${next + 1}`, idx: next })
  }

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }} className="print:break-inside-avoid">
      {/* Card header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span style={{ fontSize: 12, color: MUTED }}>#{index + 1}</span>
            <Link to={`/moving/jobs/${job._id}`} style={{ fontSize: 15, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }} className="hover:opacity-80">
              {job.jobNo}
            </Link>
            <Badge tone="blue">{movingJobStatusLabel(job.status)}</Badge>
            {override?.amount != null && (
              <span style={{ fontSize: 11, background: '#FFF7ED', color: '#9A3412', border: '1px solid rgba(234,88,12,0.15)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                Field Price: AED {override.amount.toLocaleString()}
              </span>
            )}
            {clientPrice != null && override?.amount == null && (
              <span style={{ fontSize: 11, background: '#ECFDF5', color: '#065F46', border: '1px solid rgba(5,150,105,0.15)', padding: '2px 8px', borderRadius: 20, fontWeight: 600 }}>
                Client: AED {clientPrice.toLocaleString()}
              </span>
            )}
          </div>
          <div className="print:hidden flex items-center gap-2">
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              style={{ fontSize: 12, fontWeight: 600, color: '#059669', background: '#ECFDF5', border: '1px solid rgba(5,150,105,0.15)', padding: '6px 12px', borderRadius: 10 }}
            >
              <Share2 size={13} />
              Share
            </button>
            <button
              onClick={() => onPriceOverride({ jobId: job._id, jobNo: job.jobNo, currentCost: job.costs?.total ?? 0 })}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              style={{ fontSize: 12, fontWeight: 600, color: '#9A3412', background: '#FFF7ED', border: '1px solid rgba(234,88,12,0.15)', padding: '6px 12px', borderRadius: 10 }}
            >
              <DollarSign size={13} />
              {override?.amount != null ? 'Revise Price' : 'Adjust Price'}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1" style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 500, color: INK }}>{job.customer?.fullName}</span>
          {job.customer?.phone && <span style={{ color: MUTED }}>· {job.customer.phone}</span>}
          {pkg?.label && <span style={{ color: MUTED }}>· {pkg.label}</span>}
        </div>
      </div>

      {/* Photo gallery */}
      {images.length > 0 ? (
        <div style={{ borderBottom: '1px solid rgba(20,8,31,0.06)', background: '#FAF8F5' }}>
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <Camera size={13} style={{ color: MUTED }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Estimation Photos · {images.length} photo{images.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
            {images.map((img, ii) => (
              <button key={ii} type="button"
                onClick={() => setLightbox({ url: imgUrl(img, 1600), name: img.originalName || `Photo ${ii + 1}`, idx: ii })}
                className="shrink-0 relative group"
              >
                <img src={imgUrl(img, 400)} alt={img.originalName || `Photo ${ii + 1}`}
                  className="h-28 w-28 sm:h-32 sm:w-32 object-cover rounded-xl border shadow-sm group-hover:opacity-90 transition-opacity"
                />
                {img.originalName && (
                  <span className="absolute bottom-0 left-0 right-0 px-1.5 py-1 text-[10px] text-white bg-black/50 rounded-b-xl truncate block">
                    {img.originalName}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="print:hidden flex items-center gap-2 px-5 py-3" style={{ borderBottom: '1px solid rgba(20,8,31,0.06)', background: '#FAF8F5' }}>
          <Camera size={13} style={{ color: MUTED, opacity: 0.5 }} />
          <span style={{ fontSize: 12, color: MUTED }}>No estimation photos uploaded for this job</span>
        </div>
      )}

      {/* Job details */}
      <div style={{ padding: 20 }} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
          <div className="space-y-3">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Pickup</div>
              <div style={{ fontWeight: 500, color: INK, lineHeight: 1.4 }}>{job.pickupAddress || '—'}</div>
              {job.pickupFloor && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Floor: {job.pickupFloor}</div>}
              {job.pickupHasElevator && <div style={{ fontSize: 12, color: '#059669', fontWeight: 500, marginTop: 2 }}>✓ Elevator available</div>}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Delivery</div>
              <div style={{ fontWeight: 500, color: INK, lineHeight: 1.4 }}>{job.deliveryAddress || '—'}</div>
              {job.deliveryFloor && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Floor: {job.deliveryFloor}</div>}
              {job.deliveryHasElevator && <div style={{ fontSize: 12, color: '#059669', fontWeight: 500, marginTop: 2 }}>✓ Elevator available</div>}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Crew ({crew.length})</div>
            {crew.length === 0 ? (
              <div style={{ fontSize: 13, color: MUTED }}>No crew assigned</div>
            ) : (
              <ul className="space-y-1.5">
                {crew.map((c, ci) => (
                  <li key={ci} className="flex items-start gap-1.5">
                    {c.isSupervisor && <span style={{ color: '#F59E0B', fontSize: 12, marginTop: 2 }}>★</span>}
                    <div>
                      <span style={{ fontWeight: 500, color: INK }}>{c.worker.name}</span>
                      <span style={{ color: MUTED, fontSize: 12, marginLeft: 4, textTransform: 'capitalize' }}>({c.role || c.worker.role})</span>
                      {c.worker.phone && <div style={{ fontSize: 12, color: MUTED }}>{c.worker.phone}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Trucks ({trucks.length})</div>
              {trucks.length === 0 ? (
                <div style={{ fontSize: 13, color: MUTED }}>No trucks assigned</div>
              ) : (
                <ul className="space-y-1">
                  {trucks.map((t, ti) => (
                    <li key={ti} style={{ fontWeight: 500, color: INK }}>
                      {t.truck.name}
                      {t.truck.plateNumber && <span style={{ color: MUTED, fontWeight: 400, marginLeft: 4, fontSize: 12 }}>({t.truck.plateNumber})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Time Slot</div>
              <div style={{ fontWeight: 500, color: INK }}>{job.scheduledTimeSlot || '—'}</div>
              {job.estimatedDurationHours ? <div style={{ fontSize: 12, color: MUTED }}>{job.estimatedDurationHours}h estimated</div> : null}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Pricing</div>
              {clientPrice != null ? (
                <div style={{ fontWeight: 700, color: '#059669' }}>Client: AED {clientPrice.toLocaleString()}</div>
              ) : (
                <div style={{ fontSize: 13, color: INK }}>Cost est.: <span style={{ fontWeight: 600 }}>AED {(job.costs?.total ?? 0).toLocaleString()}</span></div>
              )}
              {override?.amount != null && (
                <div style={{ fontSize: 13, color: '#9A3412', fontWeight: 700, marginTop: 2 }}>Field override: AED {override.amount.toLocaleString()}</div>
              )}
              {override?.supervisorName && <div style={{ fontSize: 12, color: MUTED }}>by {override.supervisorName}</div>}
              {override?.notes && <div style={{ fontSize: 12, color: MUTED, fontStyle: 'italic', marginTop: 2 }}>{override.notes}</div>}
            </div>
          </div>
        </div>

        {job.dispatchNotes && (
          <div style={{ borderTop: '1px solid rgba(20,8,31,0.06)', paddingTop: 12, fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: MUTED }}>Dispatch Notes: </span>
            <span style={{ color: INK }}>{job.dispatchNotes}</span>
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 print:hidden" onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={() => setLightbox(null)}>
            <X size={20} />
          </button>
          <p className="absolute top-4 left-1/2 -translate-x-1/2 text-xs text-white/60 font-medium">{lightbox.idx + 1} / {images.length}</p>
          <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-[80vh] rounded-xl shadow-2xl object-contain" onClick={e => e.stopPropagation()} />
          <p className="mt-3 text-xs text-white/60">{lightbox.name}</p>
          {images.length > 1 && (
            <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-3 pointer-events-none">
              <button className="pointer-events-auto p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={e => { e.stopPropagation(); goLightbox(-1) }}>‹</button>
              <button className="pointer-events-auto p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors" onClick={e => { e.stopPropagation(); goLightbox(1) }}>›</button>
            </div>
          )}
          <div className="absolute bottom-4 flex gap-1.5 overflow-x-auto max-w-[90vw]">
            {images.map((img, ii) => (
              <button key={ii}
                onClick={e => { e.stopPropagation(); setLightbox({ url: imgUrl(img, 1600), name: img.originalName || `Photo ${ii + 1}`, idx: ii }) }}
                className={`shrink-0 h-12 w-12 rounded-lg overflow-hidden border-2 transition-all ${ii === lightbox.idx ? 'border-white scale-110' : 'border-white/20 opacity-60 hover:opacity-100'}`}
              >
                <img src={imgUrl(img, 200)} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function MovingDispatch() {
  const qc = useQueryClient()
  const [date, setDate] = useState(() => getLocalDateString(new Date()))
  const [priceModal, setPriceModal] = useState<PriceModalState | null>(null)
  const [priceErr, setPriceErr] = useState('')

  const [year, month, day] = date.split('-').map(Number)
  const from = new Date(year, month - 1, day, 0, 0, 0, 0)
  const to = new Date(year, month - 1, day, 23, 59, 59, 999)

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['moving-dispatch', date],
    queryFn: () => api.get('/moving-jobs/schedule', {
      params: { from: from.toISOString(), to: to.toISOString() },
    }).then(r => r.data),
  })

  const fieldPriceMut = useMutation({
    mutationFn: ({ jobId, body }: { jobId: string; body: Record<string, unknown> }) =>
      api.patch(`/moving-jobs/${jobId}/field-price`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moving-dispatch', date] })
      setPriceModal(null)
      setPriceErr('')
    },
    onError: (e) => setPriceErr(apiError(e)),
  })

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <>
      <style>{`
        @media print {
          body { background: white; }
          .dispatch-header, .print\\:hidden { display: none !important; }
          .sidebar-nav { display: none; }
          @page { margin: 0.4in; size: A4; }
        }
      `}</style>
      <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
        {/* Top bar */}
        <div className="dispatch-header flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
          <div>
            <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Dispatch</div>
            <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{dateLabel}</div>
          </div>
          <div className="flex items-center gap-2.5">
            <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3">
              <CalendarDays size={16} color={MUTED} />
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 14, color: INK }}
              />
            </div>
            <button
              onClick={() => window.print()}
              style={{ height: 40, borderRadius: 10, background: '#F3F0EA', color: MUTED, fontSize: 14, fontWeight: 600, padding: '0 16px' }}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Printer size={14} />Print
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : jobs.length === 0 ? (
          <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
            <CalendarDays size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>No jobs scheduled</div>
            <div style={{ fontSize: 13, color: MUTED }}>No jobs are scheduled for this date</div>
          </div>
        ) : (
          <div className="space-y-4 print:space-y-8">
            {jobs.map((job, i) => (
              <JobDispatchCard key={job._id} job={job} index={i} onPriceOverride={setPriceModal} />
            ))}
          </div>
        )}

        {/* Field price override modal */}
        <Modal open={priceModal !== null} title={`Adjust Field Price — ${priceModal?.jobNo}`} onClose={() => { setPriceModal(null); setPriceErr('') }}>
          {priceModal && (
            <form onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              fieldPriceMut.mutate({
                jobId: priceModal.jobId,
                body: {
                  amount: Number(f.get('amount')),
                  notes: String(f.get('notes') || ''),
                  supervisorName: String(f.get('supervisorName') || ''),
                },
              })
            }} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Estimated cost from job sheet: <span className="font-semibold text-foreground">AED {priceModal.currentCost.toLocaleString()}</span>
              </p>
              <p className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Use this if on-site conditions reveal more or less work than originally estimated. The revised price will be used when creating or revising the invoice.
              </p>
              <Field label="Revised Field Price (AED)">
                <Input name="amount" type="number" min="0" step="0.01" required placeholder="Enter final agreed price" defaultValue={priceModal.currentCost} />
              </Field>
              <Field label="Supervisor Name">
                <Input name="supervisorName" placeholder="Your name" />
              </Field>
              <Field label="Reason / Notes">
                <Textarea name="notes" rows={3} placeholder="e.g. Extra floor, additional items not on survey, access issues…" />
              </Field>
              {priceErr && <p className="text-sm text-red-600">{priceErr}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={() => { setPriceModal(null); setPriceErr('') }}>Cancel</Button>
                <Button type="submit" disabled={fieldPriceMut.isPending}>
                  {fieldPriceMut.isPending ? 'Saving…' : 'Save Field Price'}
                </Button>
              </div>
            </form>
          )}
        </Modal>
      </div>
    </>
  )
}
