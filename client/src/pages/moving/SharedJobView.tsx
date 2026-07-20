import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Users, Truck, Calendar, Phone, AlertTriangle, StickyNote, Image } from 'lucide-react'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'
const PAPER = '#FDFCFA'
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const

interface SharedJob {
  jobNo: string
  status: string
  scheduledDate: string
  scheduledTimeSlot?: string
  customer: { fullName: string }
  pickupAddress: string
  pickupFloor?: string
  pickupHasElevator?: boolean
  deliveryAddress: string
  deliveryFloor?: string
  deliveryHasElevator?: boolean
  crew: Array<{ name: string; role: string; phone?: string; isSupervisor?: boolean }>
  trucks: Array<{ name: string; plateNumber?: string }>
  images: Array<{ url: string; originalName: string; category?: string }>
  moveOutPermitRequired?: boolean
  dispatchNotes?: string
  clientPackage?: { label: string } | null
}

const API = import.meta.env.VITE_API_URL || ''

export default function SharedJobView() {
  const { token } = useParams<{ token: string }>()
  const [job, setJob] = useState<SharedJob | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<number | null>(null)

  useEffect(() => {
    fetch(`${API}/api/moving-jobs/share/${token}`)
      .then(r => { if (!r.ok) throw new Error('Job not found'); return r.json() })
      .then(setJob)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: PAPER, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${PURPLE}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ color: MUTED, fontSize: 14 }}>Loading job details...</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (error || !job) return (
    <div style={{ minHeight: '100vh', background: PAPER, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
        <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, color: INK, marginBottom: 8 }}>Link expired or invalid</div>
        <div style={{ fontSize: 14, color: MUTED }}>This job share link is no longer available.</div>
      </div>
    </div>
  )

  const dateStr = job.scheduledDate
    ? new Date(job.scheduledDate).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    : ''

  return (
    <div style={{ minHeight: '100vh', background: PAPER }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px 48px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ ...HEADING, fontSize: 13, fontWeight: 700, color: PURPLE, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>PurpleBox Moving</div>
          <div style={{ ...HEADING, fontSize: 28, fontWeight: 700, color: INK }}>Job {job.jobNo}</div>
          {job.clientPackage?.label && (
            <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{job.clientPackage.label}</div>
          )}
        </div>

        {/* Date & Time */}
        <Section icon={<Calendar size={18} />} title="Schedule">
          <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{dateStr}</div>
          {job.scheduledTimeSlot && <div style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>{job.scheduledTimeSlot}</div>}
        </Section>

        {/* Customer */}
        <Section icon={<Users size={18} />} title="Customer">
          <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{job.customer?.fullName || '—'}</div>
        </Section>

        {/* Addresses */}
        <Section icon={<MapPin size={18} />} title="Locations">
          <AddressBlock label="Pickup" address={job.pickupAddress} floor={job.pickupFloor} elevator={job.pickupHasElevator} />
          <div style={{ height: 1, background: 'rgba(20,8,31,0.06)', margin: '12px 0' }} />
          <AddressBlock label="Delivery" address={job.deliveryAddress} floor={job.deliveryFloor} elevator={job.deliveryHasElevator} />
        </Section>

        {/* Crew */}
        {job.crew.length > 0 && (
          <Section icon={<Users size={18} />} title={`Crew (${job.crew.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {job.crew.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{c.name}</span>
                    {c.isSupervisor && <span style={{ fontSize: 11, background: '#FFF7ED', color: '#9A3412', padding: '1px 6px', borderRadius: 8, marginLeft: 6, fontWeight: 600 }}>Supervisor</span>}
                    <div style={{ fontSize: 12, color: MUTED }}>{c.role}</div>
                  </div>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} style={{ color: PURPLE, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, textDecoration: 'none' }}>
                      <Phone size={13} /> {c.phone}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Trucks */}
        {job.trucks.length > 0 && (
          <Section icon={<Truck size={18} />} title={`Trucks (${job.trucks.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {job.trucks.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{t.name}</span>
                  {t.plateNumber && <span style={{ fontSize: 13, color: MUTED, fontFamily: 'monospace' }}>{t.plateNumber}</span>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Permit Warning */}
        {job.moveOutPermitRequired && (
          <Section icon={<AlertTriangle size={18} />} title="Permit Required" accent="#DC2626">
            <div style={{ fontSize: 14, color: '#DC2626', fontWeight: 500 }}>Move-out permit is required for this job</div>
          </Section>
        )}

        {/* Notes */}
        {job.dispatchNotes && (
          <Section icon={<StickyNote size={18} />} title="Dispatch Notes">
            <div style={{ fontSize: 14, color: INK, whiteSpace: 'pre-wrap' }}>{job.dispatchNotes}</div>
          </Section>
        )}

        {/* Images */}
        {job.images.length > 0 && (
          <Section icon={<Image size={18} />} title={`Photos (${job.images.length})`}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {job.images.map((img, i) => (
                <div
                  key={i}
                  onClick={() => setLightbox(i)}
                  style={{ aspectRatio: '1', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: '#F3F0EA' }}
                >
                  <img src={img.url} alt={img.originalName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          </Section>
        )}

        <div style={{ textAlign: 'center', marginTop: 40, fontSize: 12, color: MUTED }}>
          Shared via PurpleBox Moving
        </div>
      </div>

      {/* Lightbox */}
      {lightbox !== null && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'grid', placeItems: 'center', padding: 16 }}
        >
          <img
            src={job.images[lightbox].url}
            alt={job.images[lightbox].originalName}
            style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8 }}
          />
          <div style={{ position: 'absolute', bottom: 24, color: 'white', fontSize: 13 }}>
            {lightbox + 1} / {job.images.length} — {job.images[lightbox].originalName}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, children, accent }: { icon: React.ReactNode; title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ color: accent || PURPLE }}>{icon}</div>
        <div style={{ ...HEADING, fontSize: 14, fontWeight: 700, color: accent || INK }}>{title}</div>
      </div>
      {children}
    </div>
  )
}

function AddressBlock({ label, address, floor, elevator }: { label: string; address?: string; floor?: string; elevator?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: INK }}>{address || '—'}</div>
      {floor && <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>Floor {floor} {elevator ? '(Elevator ✓)' : '(No elevator)'}</div>}
    </div>
  )
}
