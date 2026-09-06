import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'

/**
 * The page a tenant renews on, reached from the expiry email or WhatsApp.
 *
 * Public and unauthenticated by necessity — a tenant has no account. The HMAC
 * token in the URL is the whole of the authorisation, and the server only ever
 * lets it touch the one contract it names.
 */

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const CREAM = '#EDE3CF'
const CARD = '#FBF8F2'
const HEAD = "'Bricolage Grotesque', Georgia, serif"

interface Choice {
  weeks: number
  endDate: string
  subTotal: number
  vatAmount: number
  total: number
  cardFeeAmount: number
  totalWithCardFee: number
}

interface Options {
  contractNo: string
  firstName: string
  units: { unitNumber: string; sizeSqf: number | null }[]
  currentEndDate: string
  monthlyRate: number
  weeklyRate: number
  previousMonthlyRate: number
  rateSource: 'list' | 'contract'
  vatPct: number
  cardFeePct: number
  choices: Choice[]
  stripePublishableKey: string
  cardAvailable: boolean
  /** 'embedded' renders Stripe's form here; 'redirect' sends them to Stripe. */
  cardMode: 'embedded' | 'redirect'
  bank: { accountName: string; accountNumber: string; iban: string; address: string }
}

interface Price {
  weeks: number
  weeklyRate: number
  subTotal: number
  vatPct: number
  vatAmount: number
  total: number
  cardFeePct: number
  cardFeeAmount: number
  totalWithCardFee: number
}

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** yyyy-mm-dd, which is what a date input wants and the API expects. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

/** The same durations the booking screen offers, so a renewal reads like a
 *  booking rather than a different product. Mirrors WEEK_OPTIONS in NewQuote. */
const WEEK_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20, 24, 36, 52]

const addWeeksISO = (from: string | Date, weeks: number) =>
  isoDay(new Date(new Date(from).getTime() + weeks * 7 * 86400000))

/**
 * The whole number of weeks between two dates, or null if it isn't one.
 *
 * Deliberately exact rather than rounded: it decides whether the dropdown can
 * show a duration or has to say "custom". Rounding here would let the dropdown
 * read "11 weeks" for a date that is ten and a half weeks out, and then
 * re-selecting that same 11 would silently move the date the tenant chose.
 */
function exactWeeks(from: string | Date, to: string): number | null {
  if (!to) return null
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000)
  if (days <= 0 || days % 7 !== 0) return null
  return days / 7
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: CREAM, padding: '5vh 16px 64px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <p style={{ fontFamily: HEAD, fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', color: INK, margin: '0 0 20px' }}>
          PurpleBox<span style={{ color: PURPLE }}>.</span>
        </p>
        {children}
        <p style={{ fontSize: 12.5, color: MUTED, marginTop: 26, textAlign: 'center' }}>
          Questions? Call <a href="tel:+97143293924" style={{ color: PURPLE }}>04 329 3924</a> or message us on{' '}
          <a href="https://wa.me/971542249946" style={{ color: PURPLE }}>WhatsApp</a>.
        </p>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: CARD, borderRadius: 18, padding: 28, marginBottom: 16 }}>{children}</div>
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: bold ? 16 : 14 }}>
      <span style={{ color: bold ? INK : MUTED, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: bold ? PURPLE : INK, fontWeight: bold ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

export default function RenewContract() {
  const { contractId, token } = useParams()
  const [params] = useSearchParams()
  // Stripe sends them back here with the session id once the card is done.
  const returnedSession = params.get('done')

  const [options, setOptions] = useState<Options | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [endDate, setEndDate] = useState('')
  const [price, setPrice] = useState<Price | null>(null)
  const [priceErr, setPriceErr] = useState('')
  const [method, setMethod] = useState<'card' | 'bank_transfer'>('card')
  const [busy, setBusy] = useState(false)

  const [clientSecret, setClientSecret] = useState('')
  const [renewalId, setRenewalId] = useState('')
  const [bankShown, setBankShown] = useState<{ total: number; reference: string } | null>(null)
  const [finalStatus, setFinalStatus] = useState<'applied' | 'paid' | null>(null)

  const base = `${apiBase}/contracts/public/renewal/${contractId}/${token}`

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true
    fetch(`${base}/options`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error || 'Could not load your contract')
        return body as Options
      })
      .then((o) => {
        if (!live) return
        setOptions(o)
        // Default to the middle preset rather than the shortest — most people
        // renew for longer than four weeks, and it saves a decision.
        setEndDate(o.choices[1]?.endDate || o.choices[0]?.endDate || '')
        if (!o.cardAvailable) setMethod('bank_transfer')
      })
      .catch((e) => live && setLoadErr(e.message))
    return () => { live = false }
  }, [base])

  /* ── Price whatever date is chosen ────────────────────────────────────────
   *
   * The server prices the date; the card fee is always returned and the page
   * decides whether to show it, so switching between card and transfer costs
   * no round trip. The server is still the only thing that decides the figure —
   * this never does arithmetic of its own. */
  const priceIt = useCallback(async (date: string) => {
    if (!date) return
    setPriceErr('')
    try {
      const r = await fetch(`${base}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEndDate: date }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || 'Could not price that date')
      setPrice(body as Price)
    } catch (e) {
      setPrice(null)
      setPriceErr(e instanceof Error ? e.message : 'Could not price that date')
    }
  }, [base])

  useEffect(() => { void priceIt(endDate) }, [endDate, priceIt])

  /* ── After Stripe returns, wait for the webhook to land ───────────────────
   *
   * Stripe's return reloads this page, so the renewal id held in state is gone
   * and only the session id in the URL survives. Either one identifies the
   * renewal, so poll by whichever we still have. The webhook usually arrives
   * within a second or two; until it does the tenant sees "payment received".
   */
  const pollRef = useRef<number | null>(null)
  const statusUrl = renewalId
    ? `${base}/status/${renewalId}`
    : returnedSession ? `${base}/session/${returnedSession}` : ''

  useEffect(() => {
    if (!statusUrl || finalStatus === 'applied') return

    const tick = async () => {
      try {
        const r = await fetch(statusUrl)
        if (!r.ok) return
        const body = await r.json()
        if (body.newEndDate) setEndDate(String(body.newEndDate).slice(0, 10))
        if (body.status === 'applied') {
          setFinalStatus('applied')
          if (pollRef.current) window.clearInterval(pollRef.current)
        } else if (body.status === 'paid') {
          setFinalStatus('paid')
        }
      } catch { /* transient — the next tick tries again */ }
    }
    void tick()
    pollRef.current = window.setInterval(tick, 2000)
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [statusUrl, finalStatus])

  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (options?.stripePublishableKey ? loadStripe(options.stripePublishableKey) : null),
    [options?.stripePublishableKey],
  )

  const dateBounds = useMemo(() => {
    if (!options) return { min: '', max: '' }
    const from = new Date(options.currentEndDate)
    return {
      min: isoDay(new Date(from.getTime() + 7 * 86400000)),
      max: isoDay(new Date(from.getTime() + 104 * 7 * 86400000)),
    }
  }, [options])

  /* Which duration the dropdown shows for the date currently chosen. A date
     that is not a listed whole number of weeks reads as "custom" rather than
     snapping to the nearest option, which would move the tenant's own date. */
  const durationValue = useMemo(() => {
    if (!options || !endDate) return ''
    const w = exactWeeks(options.currentEndDate, endDate)
    return w !== null && WEEK_OPTIONS.includes(w) ? String(w) : 'custom'
  }, [options, endDate])

  async function start() {
    if (!endDate || !price) return
    setBusy(true)
    setPriceErr('')
    try {
      const r = await fetch(`${base}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEndDate: endDate, method }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || 'Could not start the payment')
      setRenewalId(body.renewalId)
      if (body.method === 'bank_transfer') {
        setBankShown({ total: body.total, reference: body.reference })
      } else if (body.payUrl) {
        /* No publishable key on this account, so Stripe hosts the form. The
           success_url brings them back here with the session id, which is the
           same thing the embedded flow returns with — so everything after this
           point is identical. */
        window.location.href = body.payUrl
      } else {
        setClientSecret(body.clientSecret)
      }
    } catch (e) {
      setPriceErr(e instanceof Error ? e.message : 'Could not start the payment')
    } finally {
      setBusy(false)
    }
  }

  // ── Screens ───────────────────────────────────────────────────────────────
  if (loadErr) {
    return (
      <Shell>
        <Card>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: '#B91C1C', margin: '0 0 12px' }}>We can&rsquo;t open this renewal</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#4A4357', margin: 0 }}>{loadErr}</p>
        </Card>
      </Shell>
    )
  }

  if (!options) {
    return <Shell><Card><p style={{ color: MUTED, margin: 0 }}>Loading your contract…</p></Card></Shell>
  }

  if (finalStatus === 'applied') {
    return (
      <Shell>
        <Card>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: '#047857', margin: '0 0 12px' }}>You&rsquo;re renewed</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#4A4357' }}>
            Your contract <strong style={{ color: INK }}>{options.contractNo}</strong> now runs until{' '}
            <strong style={{ color: INK }}>{fmtDate(endDate)}</strong>. Your invoice is on its way by email.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#4A4357', margin: 0 }}>Thank you for staying with PurpleBox.</p>
        </Card>
      </Shell>
    )
  }

  if (finalStatus === 'paid') {
    return (
      <Shell>
        <Card>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: INK, margin: '0 0 12px' }}>Payment received</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#4A4357', margin: 0 }}>
            We&rsquo;ve got your payment and we&rsquo;re updating your contract now. This page will finish on its own — you can also
            close it, we&rsquo;ll email you either way.
          </p>
        </Card>
      </Shell>
    )
  }

  /* Back from Stripe but the webhook has not landed yet. Without this the
     picker would flash up again for a second, which reads as "it didn't work"
     to somebody who has just typed their card in. */
  if (returnedSession && !finalStatus) {
    return (
      <Shell>
        <Card>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: INK, margin: '0 0 12px' }}>Checking your payment…</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#4A4357', margin: 0 }}>
            This takes a few seconds. You don&rsquo;t need to do anything — we&rsquo;ll email you the moment it&rsquo;s done.
          </p>
        </Card>
      </Shell>
    )
  }

  if (bankShown) {
    return (
      <Shell>
        <Card>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: INK, margin: '0 0 12px' }}>Transfer AED {money(bankShown.total)}</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: '#4A4357' }}>
            Please use <strong style={{ color: INK }}>{bankShown.reference}</strong> as the payment reference so we can match it to
            your unit. We&rsquo;ll extend your contract to <strong style={{ color: INK }}>{fmtDate(endDate)}</strong> as soon as it
            lands, and email you the invoice.
          </p>
          <div style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', borderRadius: 14, padding: 18, marginTop: 8 }}>
            <Row label="Account name" value={options.bank.accountName} />
            <Row label="Account number" value={options.bank.accountNumber} />
            <Row label="IBAN" value={options.bank.iban} />
            <Row label="Reference" value={bankShown.reference} />
          </div>
        </Card>
      </Shell>
    )
  }

  if (clientSecret && stripePromise) {
    return (
      <Shell>
        <Card>
          <h1 style={{ fontFamily: HEAD, fontSize: 22, color: INK, margin: '0 0 4px' }}>Pay by card</h1>
          <p style={{ fontSize: 14, color: MUTED, margin: '0 0 18px' }}>
            Renewing to {fmtDate(endDate)} · AED {money(price?.totalWithCardFee ?? 0)} including the {options.cardFeePct}% card fee.
          </p>
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </Card>
      </Shell>
    )
  }

  const unitLabel = options.units.map((u) => u.unitNumber).join(', ') || 'your unit'
  const repriced = options.rateSource === 'list' && options.previousMonthlyRate > 0
    && Math.abs(options.previousMonthlyRate - options.monthlyRate) > 0.5

  return (
    <Shell>
      <Card>
        <h1 style={{ fontFamily: HEAD, fontSize: 26, lineHeight: 1.25, color: INK, margin: '0 0 10px' }}>
          {options.firstName ? `${options.firstName}, keep ` : 'Keep '}unit {unitLabel}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.65, color: '#4A4357', margin: '0 0 6px' }}>
          Your contract <strong style={{ color: INK }}>{options.contractNo}</strong> currently ends on{' '}
          <strong style={{ color: INK }}>{fmtDate(options.currentEndDate)}</strong>. Choose how long you&rsquo;d like to stay.
        </p>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>
          AED {money(options.weeklyRate)} a week · billed in whole weeks
          {repriced && ` · your rate was AED ${money(options.previousMonthlyRate / 4)} a week`}
        </p>
      </Card>

      <Card>
        <p style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 12px' }}>How long?</p>

        {/* The two are one choice seen from either end: pick weeks and the date
            follows, pick a date and the weeks follow. Both stay on screen so a
            tenant thinking in months and one thinking in dates each see the
            answer to the other. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: 13, color: MUTED, marginBottom: 6 }}>Duration</label>
            <select
              value={durationValue}
              onChange={(e) => {
                const v = e.target.value
                // 'custom' only ever describes the date already chosen — it is
                // not itself a choice, so it changes nothing.
                if (v === 'custom' || !v) return
                setEndDate(addWeeksISO(options.currentEndDate, parseInt(v, 10)))
              }}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 15, color: INK, cursor: 'pointer',
                border: '1px solid rgba(20,8,31,.16)', borderRadius: 10, background: '#fff',
              }}
            >
              <option value="">— Select —</option>
              {WEEK_OPTIONS.map((w) => (
                <option key={w} value={w}>{w} week{w !== 1 ? 's' : ''}</option>
              ))}
              <option value="custom">Custom end date</option>
            </select>
          </div>

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: 13, color: MUTED, marginBottom: 6 }}>Move-out date</label>
            <input
              type="date"
              value={endDate}
              min={dateBounds.min}
              max={dateBounds.max}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 15, color: INK,
                border: '1px solid rgba(20,8,31,.16)', borderRadius: 10, background: '#fff',
              }}
            />
          </div>
        </div>

        {endDate && price && (
          <p style={{ fontSize: 13, color: MUTED, margin: '12px 0 0' }}>
            <strong style={{ color: INK }}>
              {price.weeks} week{price.weeks === 1 ? '' : 's'}
            </strong>
            {' · you move out on '}
            <strong style={{ color: INK }}>{fmtDate(endDate)}</strong>
            {/* Only said when it actually happened, so it reads as an
                explanation of the figure rather than boilerplate. */}
            {exactWeeks(options.currentEndDate, endDate) === null && ' — part weeks are charged as a full week'}
          </p>
        )}
      </Card>

      {price && (
        <Card>
          <Row label={`Storage · ${price.weeks} week${price.weeks === 1 ? '' : 's'}`} value={`AED ${money(price.subTotal)}`} />
          <Row label={`VAT (${price.vatPct}%)`} value={`AED ${money(price.vatAmount)}`} />
          {method === 'card' && price.cardFeeAmount > 0 && (
            <Row label={`Card fee (${price.cardFeePct}%)`} value={`AED ${money(price.cardFeeAmount)}`} />
          )}
          <div style={{ borderTop: '1px solid rgba(20,8,31,.10)', marginTop: 8, paddingTop: 4 }}>
            <Row
              label="Total"
              value={`AED ${money(method === 'card' ? price.totalWithCardFee : price.total)}`}
              bold
            />
          </div>
          <p style={{ fontSize: 12.5, color: MUTED, margin: '10px 0 0' }}>
            Renews to {fmtDate(endDate)}. No deposit is collected again.
          </p>
        </Card>
      )}

      <Card>
        <p style={{ fontFamily: HEAD, fontSize: 15, fontWeight: 700, color: INK, margin: '0 0 12px' }}>How would you like to pay?</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {options.cardAvailable && (
            <button
              type="button"
              onClick={() => setMethod('card')}
              style={{
                flex: '1 1 180px', cursor: 'pointer', textAlign: 'left',
                background: method === 'card' ? PURPLE : 'transparent',
                color: method === 'card' ? '#fff' : INK,
                border: `1px solid ${method === 'card' ? PURPLE : 'rgba(20,8,31,.16)'}`,
                borderRadius: 12, padding: '12px 16px',
              }}
            >
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Pay online by card</span>
              <span style={{ display: 'block', fontSize: 12.5, opacity: 0.85 }}>
                Secure payment via Stripe · renews straight away · {options.cardFeePct}% fee
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMethod('bank_transfer')}
            style={{
              flex: '1 1 180px', cursor: 'pointer', textAlign: 'left',
              background: method === 'bank_transfer' ? PURPLE : 'transparent',
              color: method === 'bank_transfer' ? '#fff' : INK,
              border: `1px solid ${method === 'bank_transfer' ? PURPLE : 'rgba(20,8,31,.16)'}`,
              borderRadius: 12, padding: '12px 16px',
            }}
          >
            <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Bank transfer</span>
            <span style={{ display: 'block', fontSize: 12.5, opacity: 0.85 }}>No fee · renews once it reaches us</span>
          </button>
        </div>

        {priceErr && <p style={{ fontSize: 13, color: '#B91C1C', margin: '14px 0 0' }}>{priceErr}</p>}

        <button
          type="button"
          onClick={start}
          disabled={busy || !price}
          style={{
            width: '100%', marginTop: 16, padding: '13px 22px', borderRadius: 999, border: 'none',
            background: busy || !price ? '#B9AEC9' : PURPLE, color: '#fff',
            fontSize: 15, fontWeight: 700, cursor: busy || !price ? 'default' : 'pointer',
          }}
        >
          {busy
            ? 'One moment…'
            : method === 'card'
              ? `Pay AED ${money(price?.totalWithCardFee ?? 0)}${options.cardMode === 'redirect' ? ' with Stripe' : ''}`
              : 'Get the bank details'}
        </button>
      </Card>
    </Shell>
  )
}
