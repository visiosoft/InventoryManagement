import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Printer, DollarSign, Camera, X } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Spinner, Textarea } from '../../components/ui'

function getLocalDateString(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface PriceModalState { jobId: string; jobNo: string; currentCost: number }

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

  function goLightbox(dir: 1 | -1) {
    if (!lightbox) return
    const next = (lightbox.idx + dir + images.length) % images.length
    setLightbox({ url: images[next].url, name: images[next].originalName || `Photo ${next + 1}`, idx: next })
  }

  return (
    <Card className="print:break-inside-avoid overflow-hidden">
      {/* Card header */}
      <CardHeader
        title={
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground font-normal">#{index + 1}</span>
            <Link to={`/moving/jobs/${job._id}`} className="hover:underline print:no-underline font-semibold">
              {job.jobNo}
            </Link>
            <Badge tone="blue">{job.status.replace(/_/g, ' ')}</Badge>
            {override?.amount != null && (
              <span className="text-xs bg-amber-500/10 text-amber-700 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium">
                Field Price: AED {override.amount.toLocaleString()}
              </span>
            )}
            {clientPrice != null && override?.amount == null && (
              <span className="text-xs bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium">
                Client: AED {clientPrice.toLocaleString()}
              </span>
            )}
          </div>
        }
        subtitle={
          <span className="flex items-center gap-2 flex-wrap text-sm">
            <span className="font-medium">{job.customer?.fullName}</span>
            {job.customer?.phone && <span className="text-muted-foreground">· {job.customer.phone}</span>}
            {pkg?.label && <span className="text-muted-foreground">· {pkg.label}</span>}
          </span>
        }
        action={
          <button
            onClick={() => onPriceOverride({ jobId: job._id, jobNo: job.jobNo, currentCost: job.costs?.total ?? 0 })}
            className="print:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 transition-colors border border-amber-500/20"
          >
            <DollarSign size={13} />
            {override?.amount != null ? 'Revise Price' : 'Adjust Price'}
          </button>
        }
      />

      {/* ── Photo gallery — always visible ───────────────────────────────── */}
      {images.length > 0 ? (
        <div className="border-t border-b bg-muted/30">
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <Camera size={13} className="text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Estimation Photos · {images.length} photo{images.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
            {images.map((img, ii) => (
              <button
                key={ii}
                type="button"
                onClick={() => setLightbox({ url: img.url, name: img.originalName || `Photo ${ii + 1}`, idx: ii })}
                className="shrink-0 relative group"
              >
                <img
                  src={img.url}
                  alt={img.originalName || `Photo ${ii + 1}`}
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
        <div className="border-t px-4 py-3 flex items-center gap-2 bg-muted/20 print:hidden">
          <Camera size={13} className="text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">No estimation photos uploaded for this job</p>
        </div>
      )}

      {/* ── Job details ───────────────────────────────────────────────────── */}
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-sm">
          {/* Addresses */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pickup</p>
              <p className="leading-snug font-medium">{job.pickupAddress || '—'}</p>
              {job.pickupFloor && <p className="text-muted-foreground text-xs mt-0.5">Floor: {job.pickupFloor}</p>}
              {job.pickupHasElevator && <p className="text-xs text-emerald-600 font-medium mt-0.5">✓ Elevator available</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivery</p>
              <p className="leading-snug font-medium">{job.deliveryAddress || '—'}</p>
              {job.deliveryFloor && <p className="text-muted-foreground text-xs mt-0.5">Floor: {job.deliveryFloor}</p>}
              {job.deliveryHasElevator && <p className="text-xs text-emerald-600 font-medium mt-0.5">✓ Elevator available</p>}
            </div>
          </div>

          {/* Crew */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Crew ({crew.length})
            </p>
            {crew.length === 0 ? (
              <p className="text-muted-foreground text-sm">No crew assigned</p>
            ) : (
              <ul className="space-y-1.5">
                {crew.map((c, ci) => (
                  <li key={ci} className="flex items-start gap-1.5">
                    {c.isSupervisor && <span className="text-amber-500 text-xs mt-0.5">★</span>}
                    <div>
                      <span className="font-medium">{c.worker.name}</span>
                      <span className="text-muted-foreground capitalize text-xs ml-1">({c.role || c.worker.role})</span>
                      {c.worker.phone && (
                        <p className="text-muted-foreground text-xs">{c.worker.phone}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Trucks + timing + pricing */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Trucks ({trucks.length})
              </p>
              {trucks.length === 0 ? (
                <p className="text-muted-foreground text-sm">No trucks assigned</p>
              ) : (
                <ul className="space-y-1">
                  {trucks.map((t, ti) => (
                    <li key={ti} className="font-medium">
                      {t.truck.name}
                      {t.truck.plateNumber && (
                        <span className="text-muted-foreground font-normal ml-1 text-xs">({t.truck.plateNumber})</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Time Slot</p>
              <p className="font-medium">{job.scheduledTimeSlot || '—'}</p>
              {job.estimatedDurationHours ? (
                <p className="text-muted-foreground text-xs">{job.estimatedDurationHours}h estimated</p>
              ) : null}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pricing</p>
              {clientPrice != null ? (
                <p className="font-bold text-emerald-700">Client: AED {clientPrice.toLocaleString()}</p>
              ) : (
                <p className="text-sm">Cost est.: <span className="font-semibold">AED {(job.costs?.total ?? 0).toLocaleString()}</span></p>
              )}
              {override?.amount != null && (
                <p className="text-sm text-amber-700 font-bold mt-0.5">
                  Field override: AED {override.amount.toLocaleString()}
                </p>
              )}
              {override?.supervisorName && (
                <p className="text-xs text-muted-foreground">by {override.supervisorName}</p>
              )}
              {override?.notes && (
                <p className="text-xs text-muted-foreground italic mt-0.5">{override.notes}</p>
              )}
            </div>
          </div>
        </div>

        {job.dispatchNotes && (
          <div className="pt-3 border-t text-sm">
            <span className="font-semibold text-muted-foreground">Dispatch Notes: </span>
            {job.dispatchNotes}
          </div>
        )}
      </CardBody>

      {/* Lightbox with prev/next */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 print:hidden"
          onClick={() => setLightbox(null)}
        >
          {/* Close */}
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={() => setLightbox(null)}
          >
            <X size={20} />
          </button>

          {/* Counter */}
          <p className="absolute top-4 left-1/2 -translate-x-1/2 text-xs text-white/60 font-medium">
            {lightbox.idx + 1} / {images.length}
          </p>

          {/* Image */}
          <img
            src={lightbox.url}
            alt={lightbox.name}
            className="max-w-full max-h-[80vh] rounded-xl shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />

          {/* Caption */}
          <p className="mt-3 text-xs text-white/60">{lightbox.name}</p>

          {/* Prev / Next */}
          {images.length > 1 && (
            <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-between px-3 pointer-events-none">
              <button
                className="pointer-events-auto p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                onClick={e => { e.stopPropagation(); goLightbox(-1) }}
              >‹</button>
              <button
                className="pointer-events-auto p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                onClick={e => { e.stopPropagation(); goLightbox(1) }}
              >›</button>
            </div>
          )}

          {/* Thumbnail strip */}
          <div className="absolute bottom-4 flex gap-1.5 overflow-x-auto max-w-[90vw]">
            {images.map((img, ii) => (
              <button
                key={ii}
                onClick={e => { e.stopPropagation(); setLightbox({ url: img.url, name: img.originalName || `Photo ${ii + 1}`, idx: ii }) }}
                className={`shrink-0 h-12 w-12 rounded-lg overflow-hidden border-2 transition-all ${
                  ii === lightbox.idx ? 'border-white scale-110' : 'border-white/20 opacity-60 hover:opacity-100'
                }`}
              >
                <img src={img.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
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
      <div className="space-y-5">
        <div className="dispatch-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <PageHeader title="Dispatch" subtitle={dateLabel} />
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="h-9 rounded-lg border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer size={14} className="mr-1" />Print
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : jobs.length === 0 ? (
          <Card><CardBody><EmptyState message="No jobs scheduled for this date" /></CardBody></Card>
        ) : (
          <div className="space-y-4 print:space-y-8">
            {jobs.map((job, i) => (
              <JobDispatchCard
                key={job._id}
                job={job}
                index={i}
                onPriceOverride={setPriceModal}
              />
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
