import type { Quote } from '../lib/types'

/**
 * Two small chips for a customer in a list: how complete their file is
 * (hover for what is missing), and what the WhatsApp ID form did — sent and
 * saved, still saving, or failed so somebody asks again.
 */
export default function CustomerReadiness({ customer }: { customer: Quote['customer'] | undefined | null }) {
  if (!customer?.profile && !customer?.whatsappId) return null
  const p = customer.profile
  const w = customer.whatsappId
  const pctTone = !p ? null : p.pct === 100 ? ['#ECFDF5', '#065F46'] : p.pct >= 60 ? ['#FFFBEB', '#92400E'] : ['#FEF2F2', '#991B1B']
  const doc = w?.idType === 'passport' ? 'Passport' : 'Emirates ID'
  const wa = !w ? null
    : w.status === 'saved' ? { bg: '#ECFDF5', fg: '#065F46', text: `${doc} received via WhatsApp`, title: `${w.filesSaved} photo(s) saved to Google Drive` }
    : w.status === 'processing' ? { bg: '#F5F3F7', fg: '#4B4453', text: `${doc} saving…`, title: 'Received on WhatsApp, saving to Google Drive' }
    : w.resolved ? { bg: '#F5F3F7', fg: '#4B4453', text: `${doc} upload failed · handled`, title: w.problem }
    : { bg: '#FEF2F2', fg: '#991B1B', text: w.status === 'partial' ? `${doc} partly saved (${w.filesSaved}/${w.filesTotal})` : `${doc} upload failed`, title: `${w.problem || 'Nothing reached Google Drive'} — ask the customer to send it again` }
  return (
    <div className="flex flex-wrap gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
      {p && pctTone && (
        <span
          title={p.missing.length ? `Missing: ${p.missing.join(', ')}` : 'Profile complete'}
          className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 inline-flex items-center gap-1"
          style={{ background: pctTone[0], color: pctTone[1] }}
        >
          <span style={{ width: 28, height: 4, borderRadius: 4, background: 'rgba(0,0,0,.08)', overflow: 'hidden', display: 'inline-block' }}>
            <span style={{ display: 'block', height: '100%', width: `${p.pct}%`, background: pctTone[1] }} />
          </span>
          Profile {p.pct}%
        </span>
      )}
      {wa && (
        <span title={wa.title} className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ background: wa.bg, color: wa.fg }}>
          {wa.text}
        </span>
      )}
    </div>
  )
}
