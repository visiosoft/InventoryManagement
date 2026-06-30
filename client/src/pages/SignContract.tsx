import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api'

interface ContractInfo {
  contractNo: string
  customerName: string
  startDate: string
  endDate: string
  rate: number
  billingPeriod: string
  deposit: number
  alreadySigned: boolean
  expiresAt: string
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtMoney(n: number) {
  return `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Reusable drawing canvas (used for both initials and signature) ────────────
function DrawCanvas({
  height = 128,
  lineWidth = 2.5,
  onCapture,
}: {
  height?: number
  lineWidth?: number
  onCapture: (url: string | null) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)

  useEffect(() => {
    const canvas = ref.current!
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    canvas.getContext('2d')!.scale(dpr, dpr)
  }, [])

  function pos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const src = 'touches' in e ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const canvas = ref.current!
    const { x, y } = pos(e.nativeEvent as MouseEvent | TouchEvent, canvas)
    const ctx = canvas.getContext('2d')!
    ctx.beginPath(); ctx.moveTo(x, y)
    drawing.current = true
  }

  function move(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1a2e'
    const { x, y } = pos(e.nativeEvent as MouseEvent | TouchEvent, canvas)
    ctx.lineTo(x, y); ctx.stroke()
    hasStroke.current = true
  }

  function end() {
    drawing.current = false
    if (hasStroke.current) onCapture(ref.current!.toDataURL('image/png'))
  }

  function clear() {
    const canvas = ref.current!
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
    hasStroke.current = false
    onCapture(null)
  }

  return (
    <div style={{ userSelect: 'none' }}>
      <canvas
        ref={ref}
        style={{ width: '100%', height, border: '2px dashed #ccc', borderRadius: 8, background: '#fff', cursor: 'crosshair', touchAction: 'none', display: 'block' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <button type="button" onClick={clear} style={{ fontSize: 12, color: '#888', cursor: 'pointer', background: 'none', border: 'none', padding: '4px 0' }}>
        Clear
      </button>
    </div>
  )
}

// ── Signature canvas (full-size) ──────────────────────────────────────────────
function SignatureCanvas({ onCapture }: { onCapture: (url: string | null) => void }) {
  return <DrawCanvas height={128} lineWidth={2.5} onCapture={onCapture} />
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SignContract() {
  const { token } = useParams<{ token: string }>()

  const [info, setInfo]               = useState<ContractInfo | null>(null)
  const [loadErr, setLoadErr]         = useState('')
  const [mode, setMode]               = useState<'draw' | 'type'>('draw')
  const [signerName, setName]         = useState('')
  const [sigDataUrl, setSigUrl]       = useState<string | null>(null)
  const [agreed, setAgreed]           = useState(false)
  const [busy, setBusy]               = useState(false)
  const [submitErr, setSubmitErr]     = useState('')
  const [done, setDone]               = useState(false)
  const [signedDocUrl, setSignedDocUrl] = useState('')

  useEffect(() => {
    fetch(`${apiBase}/sign/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setLoadErr(data.error); return }
        setInfo(data)
        if (data.customerName) {
          setName(data.customerName)
        }
      })
      .catch(() => setLoadErr('Could not load contract details'))
  }, [token])

  const canSubmit = agreed && signerName.trim() && (mode === 'type' || sigDataUrl)

  async function handleSign() {
    if (!canSubmit) return
    setBusy(true)
    setSubmitErr('')
    try {
      const res = await fetch(`${apiBase}/sign/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          signatureDataUrl: mode === 'draw' ? sigDataUrl : null,
          signMode: mode,
          // Auto-derive initials from signer name — no separate UI needed
          initialsText: signerName.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').join(''),
          initialsDataUrl: null,
          initialsMode: 'type',
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSubmitErr(data.error || 'Signing failed'); return }
      setSignedDocUrl(data.signedDocUrl || '')
      setDone(true)
    } catch {
      setSubmitErr('Network error — please try again')
    } finally {
      setBusy(false)
    }
  }

  // ── Error / loading states ────────────────────────────────────────────────
  if (loadErr) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Link unavailable</h2>
          <p style={{ color: '#666' }}>{loadErr}</p>
        </div>
      </PageShell>
    )
  }

  if (!info) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading contract…</div>
      </PageShell>
    )
  }

  if (info.alreadySigned) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Already signed</h2>
          <p style={{ color: '#666' }}>Contract <strong>{info.contractNo}</strong> has already been signed and is active.</p>
        </div>
      </PageShell>
    )
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (done) {
    return (
      <PageShell>
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 64, marginBottom: 20 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Contract signed!</h2>
          <p style={{ color: '#555', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
            Thank you, <strong>{signerName}</strong>. Contract <strong>{info.contractNo}</strong> is now active.
            You will receive a copy of the signed agreement shortly.
          </p>
          {signedDocUrl && (
            <a
              href={signedDocUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-block', padding: '10px 24px', background: '#4f46e5', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}
            >
              View signed contract PDF
            </a>
          )}
        </div>
      </PageShell>
    )
  }

  // ── Main signing UI ───────────────────────────────────────────────────────
  const pdfUrl = `${apiBase}/sign/${token}/pdf#view=FitH`

  return (
    <PageShell>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Storage Rental Contract</h1>
          <p style={{ color: '#666', fontSize: 14 }}>
            {info.contractNo} · Please read the document below and sign to confirm your agreement.
          </p>
        </div>

        {/* Contract summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            ['Customer', info.customerName],
            ['Contract No', info.contractNo],
            ['Start Date', fmt(info.startDate)],
            ['End Date', fmt(info.endDate)],
            ['1st Month Invoice', fmtMoney(info.rate)],
            ['Security Deposit', info.deposit ? fmtMoney(info.deposit) : '—'],
          ].map(([label, val]) => (
            <div key={label} style={{ background: '#f9f9fb', borderRadius: 8, padding: '10px 14px', border: '1px solid #e5e5e5' }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{label}</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* PDF viewer — iframe works on Android Chrome and desktop; iOS blocks inline PDFs */}
        <div style={{ marginBottom: 24, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e5e5', background: '#f5f5f5' }}>
          <div style={{ padding: '8px 14px', background: '#f0f0f4', borderBottom: '1px solid #e5e5e5', fontSize: 13, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Contract Document</span>
            <a href={pdfUrl} target="_blank" rel="noreferrer" style={{ color: '#4f46e5', fontSize: 12, textDecoration: 'none' }}>Open in new tab ↗</a>
          </div>
          {/iPhone|iPad|iPod/i.test(navigator.userAgent) ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', background: '#fafafa' }}>
              <p style={{ color: '#555', fontSize: 14, marginBottom: 16 }}>
                PDF preview is not available on iOS. Please open it in a new tab to read the contract before signing.
              </p>
              <a
                href={pdfUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block', padding: '10px 24px', background: '#4f46e5', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 14 }}
              >
                📄 Open Contract PDF
              </a>
            </div>
          ) : (
            <iframe
              src={pdfUrl}
              title="Contract PDF"
              style={{ width: '100%', height: 'calc(100vh - 180px)', minHeight: 500, border: 'none', display: 'block' }}
            />
          )}
        </div>

        {/* ── Full signature section ─────────────────────────────────────── */}
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Electronic Signature</h2>

          {/* Draw / Type toggle */}
          <div style={{ display: 'flex', borderRadius: 8, border: '1px solid #e5e5e5', overflow: 'hidden', marginBottom: 20, fontSize: 14 }}>
            {(['draw', 'type'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  flex: 1, padding: '8px 0', fontWeight: 500, cursor: 'pointer', border: 'none',
                  background: mode === m ? '#4f46e5' : 'transparent',
                  color: mode === m ? '#fff' : '#555',
                  transition: 'background 0.15s',
                }}
              >
                {m === 'draw' ? '✏️ Draw signature' : 'Aa Type name'}
              </button>
            ))}
          </div>

          {mode === 'draw' ? (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>Sign in the box below using your mouse or finger</p>
              <SignatureCanvas onCapture={setSigUrl} />
              {!sigDataUrl && <p style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>Draw your signature above to continue</p>}
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>Your typed name will serve as your electronic signature</p>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              />
              {signerName && (
                <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 28, fontFamily: 'cursive', color: '#1a1a2e', border: '1px solid #e5e5e5', borderRadius: 8, marginTop: 10, background: '#fafafa' }}>
                  {signerName}
                </div>
              )}
            </div>
          )}

          {/* Full name field for draw mode */}
          {mode === 'draw' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, color: '#555', display: 'block', marginBottom: 6 }}>Full name (printed)</label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
          )}

          {/* Agreement checkbox */}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 14, background: '#f9f9fb', border: '1px solid #e5e5e5', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 2, width: 16, height: 16, accentColor: '#4f46e5', flexShrink: 0 }}
            />
            <span>
              I, <strong>{signerName || '…'}</strong>, confirm that I have read and agree to all terms and conditions
              of this contract. I understand that this electronic signature is legally binding.
            </span>
          </label>

          {submitErr && (
            <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{submitErr}</p>
          )}

          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={handleSign}
            style={{
              width: '100%', padding: '12px 0', fontWeight: 700, fontSize: 15, borderRadius: 8, border: 'none', cursor: canSubmit && !busy ? 'pointer' : 'not-allowed',
              background: canSubmit && !busy ? '#4f46e5' : '#c7c7d6',
              color: '#fff', transition: 'background 0.15s',
            }}
          >
            {busy ? 'Signing…' : '✅ Sign & activate contract'}
          </button>

          <p style={{ fontSize: 12, color: '#aaa', textAlign: 'center', marginTop: 12 }}>
            This link expires {fmt(info.expiresAt)}. Powered by PurpleBox Storage.
          </p>
        </div>
      </div>
    </PageShell>
  )
}

// ── Minimal shell (no sidebar / nav) ─────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f7', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ background: '#1a1a2e', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src="/Invoicelogo_Logo.png" alt="PurpleBox" style={{ height: 32, objectFit: 'contain' }} />
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>PurpleBox Storage</span>
      </header>
      <main>{children}</main>
    </div>
  )
}
