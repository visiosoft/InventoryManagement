import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { api, apiError } from '../lib/api'

export type ClientInfoSubmission = {
  _id: string; createdAt: string; processedAt: string | null; resolvedAt: string | null
  status: 'processing' | 'saved' | 'partial' | 'failed'
  idType: string; fullName: string; phoneNormalized: string
  filesTotal: number; filesSaved: number; problems: string[]; filledFromId: string[]
  customer?: { _id: string; fullName: string } | null
}

const ID_LABEL: Record<string, string> = { emirates_id: 'Emirates ID', passport: 'Passport' }
const FIELD_LABEL: Record<string, string> = {
  emiratesId: 'Emirates ID no.', eidExpiry: 'ID expiry', passportNumber: 'passport no.', passportExpiry: 'passport expiry', nationality: 'nationality',
}
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** The one-line story of a WhatsApp ID submission, for a banner or a list row. */
export function describeSubmission(s: ClientInfoSubmission) {
  const doc = ID_LABEL[s.idType] || 'ID'
  if (s.status === 'processing') return { tone: 'grey' as const, title: `${doc} received — saving to Google Drive…`, detail: '' }
  if (s.status === 'saved') {
    return {
      tone: 'green' as const,
      title: `${doc} received on WhatsApp — ${s.filesSaved} photo${s.filesSaved === 1 ? '' : 's'} saved to Google Drive`,
      detail: s.filledFromId?.length ? `Filled in from the ID: ${s.filledFromId.map((f) => FIELD_LABEL[f] || f).join(', ')}` : '',
    }
  }
  return {
    tone: 'red' as const,
    title: s.status === 'partial'
      ? `${doc} only partly saved — ${s.filesSaved} of ${s.filesTotal} photos reached Google Drive`
      : `${doc} upload failed — nothing reached Google Drive`,
    detail: s.problems?.[0] || '',
  }
}

const TONES = {
  green: { bg: '#ECFDF5', border: '#A7F3D0', fg: '#065F46' },
  red: { bg: '#FEF2F2', border: '#FECACA', fg: '#991B1B' },
  grey: { bg: '#F5F3F7', border: '#E4DFEA', fg: '#4B4453' },
}

/**
 * Latest WhatsApp ID & details submission for a customer: saved to Drive, or
 * failed with the reason and a button to send the form again. Renders
 * nothing when the customer never used the form.
 */
export default function ClientInfoStatus({ customerId }: { customerId: string }) {
  const qc = useQueryClient()
  const { data } = useQuery<{ rows: ClientInfoSubmission[] }>({
    queryKey: ['client-info-submissions', 'customer', customerId],
    queryFn: () => api.get('/client-info/submissions', { params: { customer: customerId, limit: 1 } }).then((r) => r.data),
    enabled: Boolean(customerId),
    // While the photos are still being saved, check back until they are.
    refetchInterval: (q) => (q.state.data?.rows?.[0]?.status === 'processing' ? 5000 : false),
  })
  const resend = useMutation({
    mutationFn: (phone: string) => api.post('/client-info/send', { phone }),
    onSuccess: () => window.alert('Form sent again on WhatsApp.'),
    onError: (e) => window.alert(apiError(e)),
  })
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/client-info/submissions/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-info-submissions'] }),
  })

  const s = data?.rows?.[0]
  if (!s) return null
  const d = describeSubmission(s)
  const t = TONES[d.tone]
  const Icon = d.tone === 'green' ? CheckCircle2 : d.tone === 'red' ? AlertTriangle : Loader2

  return (
    <div style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.fg, borderRadius: 12, padding: '10px 12px' }}>
      <div className="flex items-start gap-2">
        <Icon size={16} className={d.tone === 'grey' ? 'animate-spin' : ''} style={{ flexShrink: 0, marginTop: 1 }} />
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 13, fontWeight: 700 }}>{d.title}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {when(s.createdAt)}{d.detail ? ` · ${d.detail}` : ''}
            {s.resolvedAt ? ' · marked as handled' : ''}
          </div>
          {d.tone === 'red' && !s.resolvedAt && (
            <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
              {s.phoneNormalized && (
                <button type="button" disabled={resend.isPending} onClick={() => resend.mutate(s.phoneNormalized)}
                  className="text-xs font-semibold rounded-full px-3 py-1 cursor-pointer disabled:opacity-50"
                  style={{ background: '#fff', border: `1px solid ${t.border}`, color: t.fg }}>
                  {resend.isPending ? 'Sending…' : 'Send the form again'}
                </button>
              )}
              <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate(s._id)}
                className="text-xs font-semibold rounded-full px-3 py-1 cursor-pointer disabled:opacity-50"
                style={{ background: 'transparent', border: `1px solid ${t.border}`, color: t.fg }}>
                Mark as handled
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
