import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCustomerAuth, portalApiError } from '../../lib/customerAuth'

export default function PortalLogin() {
  const { requestOtp, verifyOtp } = useCustomerAuth()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handlePhone(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await requestOtp(phone)
      setStep('otp')
    } catch (err) {
      setError(portalApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleOtp(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await verifyOtp(phone, code)
      navigate('/portal', { replace: true })
    } catch (err) {
      setError(portalApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-10 relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #14081F 0%, #5B2BC9 70%, #7C4DFF 100%)' }}>
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-10" style={{ background: '#F5F0E8' }} />
        <div className="absolute bottom-10 -left-16 w-64 h-64 rounded-full opacity-10" style={{ background: '#F5F0E8' }} />
        <div className="flex items-center gap-3 relative z-10">
          <div className="h-11 w-11 rounded-xl flex items-center justify-center shadow-lg" style={{ background: '#F5F0E8' }}>
            <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-8 w-8 object-contain" />
          </div>
          <div>
            <div className="font-bold text-white text-lg leading-tight">PurpleBox</div>
            <div className="text-xs leading-tight" style={{ color: '#c4a8f0' }}>Customer Portal</div>
          </div>
        </div>
        <div className="relative z-10">
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Manage your<br />moves with ease.
          </h2>
          <p className="text-base leading-relaxed" style={{ color: '#d4c0f0' }}>
            Track your moving jobs, upload visit photos, and stay updated.
          </p>
        </div>
        <div className="relative z-10 text-xs" style={{ color: '#9a7cc0' }}>
          &copy; {new Date().getFullYear()} PurpleBox. All rights reserved.
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10" style={{ background: '#FBF8F2' }}>
        <div className="lg:hidden flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: '#5B2BC9' }}>
            <img src="/Invoicelogo_Logo.png" alt="PurpleBox" className="h-7 w-7 object-contain" />
          </div>
          <div>
            <div className="font-bold leading-tight" style={{ color: '#14081F' }}>PurpleBox</div>
            <div className="text-xs leading-tight" style={{ color: '#756E80' }}>Customer Portal</div>
          </div>
        </div>

        <div className="w-full max-w-sm">
          {step === 'phone' ? (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-bold" style={{ color: '#14081F' }}>Welcome</h1>
                <p className="text-sm mt-1" style={{ color: '#756E80' }}>Enter your phone number to sign in</p>
              </div>
              <form onSubmit={handlePhone} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#14081F' }}>Phone number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+971 50 123 4567"
                    required
                    autoFocus
                    className="w-full h-11 rounded-xl border-2 px-4 text-sm focus:outline-none transition-colors"
                    style={{ borderColor: '#E8E0D4', background: '#fff', color: '#14081F' }}
                    onFocus={e => e.target.style.borderColor = '#5B2BC9'}
                    onBlur={e => e.target.style.borderColor = '#E8E0D4'}
                  />
                </div>
                {error && (
                  <div className="rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: '#f0c0c0', background: '#fef2f2', color: '#b91c1c' }}>
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl font-semibold text-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                  style={{ background: '#5B2BC9', color: '#fff' }}
                >
                  {busy ? 'Sending...' : 'Send OTP'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-bold" style={{ color: '#14081F' }}>Enter OTP</h1>
                <p className="text-sm mt-1" style={{ color: '#756E80' }}>We sent a code to <strong style={{ color: '#14081F' }}>{phone}</strong></p>
              </div>
              <form onSubmit={handleOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#14081F' }}>Verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="1234"
                    required
                    autoFocus
                    className="w-full h-11 rounded-xl border-2 px-4 text-sm text-center tracking-[0.5em] font-mono focus:outline-none transition-colors"
                    style={{ borderColor: '#E8E0D4', background: '#fff', color: '#14081F', fontSize: 20 }}
                    onFocus={e => e.target.style.borderColor = '#5B2BC9'}
                    onBlur={e => e.target.style.borderColor = '#E8E0D4'}
                  />
                </div>
                {error && (
                  <div className="rounded-lg border px-3 py-2.5 text-xs" style={{ borderColor: '#f0c0c0', background: '#fef2f2', color: '#b91c1c' }}>
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-11 rounded-xl font-semibold text-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                  style={{ background: '#5B2BC9', color: '#fff' }}
                >
                  {busy ? 'Verifying...' : 'Verify & Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('phone'); setCode(''); setError('') }}
                  className="w-full text-sm font-medium mt-1"
                  style={{ color: '#5B2BC9' }}
                >
                  Change number
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
