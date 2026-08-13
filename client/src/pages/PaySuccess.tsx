import { useSearchParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

export default function PaySuccess() {
  const [params] = useSearchParams()
  const invoiceNo = params.get('invoice')

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#FBF8F2' }}>
      <div className="max-w-sm w-full text-center rounded-2xl border bg-white p-8" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
        <div className="mx-auto mb-4 h-14 w-14 rounded-full flex items-center justify-center" style={{ background: `${PURPLE}15`, color: PURPLE }}>
          <CheckCircle2 size={30} />
        </div>
        <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, color: INK }}>
          Payment received
        </h1>
        <p className="mt-2 text-sm" style={{ color: MUTED }}>
          {invoiceNo ? <>Thank you — invoice <strong>{invoiceNo}</strong> is paid.</> : 'Thank you — your payment has been received.'}
          {' '}A receipt will follow from PurpleBox.
        </p>
        <p className="mt-6 text-xs" style={{ color: MUTED }}>You can close this window now.</p>
      </div>
    </div>
  )
}
