import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
const BODY_TEXT = '#4A4357'
const PURPLE = '#5B2BC9'
const PURPLE_DEEP = '#4A1FA0'
const PAGE_BG = '#FBF8F2'
const CARD_BG = '#FFFFFF'
const SIDEBAR_BG = '#F6F0E4'
const LINE = 'rgba(20,8,31,.10)'
const BADGE_BG = '#EDE5FF'
const BADGE_BORDER = '#DDD0FF'
const BADGE_TEXT = '#4A1FA0'
const HEAD = "'Bricolage Grotesque', sans-serif"
const BODY = "'Plus Jakarta Sans', system-ui, sans-serif"

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

const fmtDateLong = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** yyyy-mm-dd, which is what the API expects. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

const addWeeksISO = (from: string | Date, weeks: number) =>
  isoDay(new Date(new Date(from).getTime() + weeks * 7 * 86400000))

/* ── Shared chrome ────────────────────────────────────────────────────────── */

function FontStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
      .renew-pill { transition: border-color .15s ease, background .15s ease; cursor: pointer; }
      .renew-pill:hover { border-color: #A78BFA; }
      .renew-method { transition: border-color .15s ease, background .15s ease; }
      .renew-method:hover { border-color: #A78BFA; }
      .renew-cta { transition: background .15s ease; }
      .renew-cta:hover:not(:disabled) { background: ${PURPLE_DEEP}; }
      .renew-num:focus { outline: none; border-color: ${PURPLE}; box-shadow: 0 0 0 3px rgba(91,43,201,.14); }
      .renew-sidebar { position: static; }
      @media (min-width: 860px) {
        .renew-sidebar { position: sticky; top: 92px; }
      }
    `}</style>
  )
}

/** A small storage-unit mark: a rounded tile with an inset door and shelf. */
function LogoMark() {
  return (
    <span style={{
      width: 30, height: 30, borderRadius: 8, background: PURPLE, display: 'block',
      position: 'relative', boxShadow: '0 4px 14px rgba(91,43,201,.32)', flex: '0 0 auto',
    }}>
      <span style={{ position: 'absolute', inset: 6, borderRadius: 3, border: '2px solid rgba(255,255,255,.85)' }} />
      <span style={{ position: 'absolute', left: 6, right: 6, top: 14, height: 2, background: 'rgba(255,255,255,.85)' }} />
    </span>
  )
}

function Header({ eyebrow }: { eyebrow: string }) {
  return (
    <div style={{ borderBottom: `1px solid ${LINE}`, background: 'rgba(251,248,242,.9)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 20 }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: HEAD, fontWeight: 700, fontSize: 21, letterSpacing: '-0.02em' }}>
          <LogoMark />
          <span>PurpleBox<span style={{ color: PURPLE }}>.</span></span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: '0.02em' }}>{eyebrow}</span>
      </div>
    </div>
  )
}

/** Narrow, single-card layout for every screen that isn't the picker itself. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: BODY, color: INK, background: PAGE_BG, minHeight: '100vh' }}>
      <FontStyle />
      <Header eyebrow="Contract renewal" />
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '48px 24px 64px' }}>
        {children}
        <p style={{ fontSize: 13, color: MUTED, marginTop: 28, textAlign: 'center' }}>
          Questions? Call <a href="tel:+97143293924" style={{ color: PURPLE }}>04 329 3924</a> or message us on{' '}
          <a href="https://wa.me/971542249946" style={{ color: PURPLE }}>WhatsApp</a>.
        </p>
      </div>
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${LINE}`, borderRadius: 22, padding: 28, marginBottom: 16,
      boxShadow: '0 1px 2px rgba(20,8,31,.05), 0 2px 10px rgba(20,8,31,.03)',
    }}>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, fontSize: 15 }}>
      <span style={{ color: BODY_TEXT }}>{label}</span>
      <span style={{ fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

/* ── Style helpers for the picker screen ─────────────────────────────────── */

const cardStyle: CSSProperties = {
  background: CARD_BG, border: `1px solid ${LINE}`, borderRadius: 22, padding: 28,
  boxShadow: '0 1px 2px rgba(20,8,31,.05), 0 2px 10px rgba(20,8,31,.03)',
}
const h2Style: CSSProperties = { fontFamily: HEAD, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', margin: 0 }
const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }
const badgeStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999,
  background: BADGE_BG, border: `1px solid ${BADGE_BORDER}`, color: BADGE_TEXT,
  fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
}

function pillStyle(active: boolean): CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
    minWidth: 82, padding: '12px 16px', borderRadius: 14,
    border: `1.5px solid ${active ? PURPLE : 'rgba(20,8,31,.14)'}`,
    background: active ? '#F3EEFF' : '#fff', color: active ? PURPLE_DEEP : INK,
  }
}

function methodStyle(active: boolean): CSSProperties {
  return {
    textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8,
    padding: '16px 18px', borderRadius: 16,
    border: `1.5px solid ${active ? PURPLE : 'rgba(20,8,31,.14)'}`,
    background: active ? '#F3EEFF' : '#fff', color: INK,
  }
}

function dotStyle(active: boolean): CSSProperties {
  return {
    width: 14, height: 14, borderRadius: 999, flex: '0 0 auto',
    border: `2px solid ${active ? PURPLE : 'rgba(20,8,31,.28)'}`,
    background: active ? PURPLE : 'transparent',
  }
}

function ctaStyle(disabled: boolean): CSSProperties {
  return {
    marginTop: 24, width: '100%', height: 56, border: 0, borderRadius: 999,
    background: disabled ? '#C9BEEA' : PURPLE, color: '#fff',
    fontFamily: BODY, fontSize: 15, fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
    boxShadow: disabled ? 'none' : '0 8px 24px rgba(91,43,201,.24)',
  }
}

export default function RenewContract() {
  const { contractId, token } = useParams()
  const [params] = useSearchParams()
  // Stripe sends them back here with the session id once the card is done.
  const returnedSession = params.get('done')

  const [options, setOptions] = useState<Options | null>(null)
  const [loadErr, setLoadErr] = useState('')
  // The number of weeks drives the date, not the other way round — billing is
  // always whole weeks, so there is no calendar date worth picking that this
  // can't already reach, and it keeps what is charged and what the contract
  // extends by permanently in agreement (no partial-week ambiguity to explain).
  const [weeks, setWeeks] = useState(12)
  const [weeksText, setWeeksText] = useState('12')
  const [price, setPrice] = useState<Price | null>(null)
  const [priceErr, setPriceErr] = useState('')
  const [method, setMethod] = useState<'card' | 'bank_transfer'>('card')
  const [busy, setBusy] = useState(false)

  const [clientSecret, setClientSecret] = useState('')
  const [renewalId, setRenewalId] = useState('')
  const [bankShown, setBankShown] = useState<{ total: number; reference: string } | null>(null)
  const [finalStatus, setFinalStatus] = useState<'applied' | 'paid' | null>(null)
  // Set from the status poll once payment lands — the picker's own `weeks`
  // cannot be trusted for this after a redirect-mode reload (see the poll
  // effect below), so the confirmation screens read this instead.
  const [resultEndDate, setResultEndDate] = useState('')

  const base = `${apiBase}/contracts/public/renewal/${contractId}/${token}`
  const endDate = useMemo(() => (options ? addWeeksISO(options.currentEndDate, weeks) : ''), [options, weeks])

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
        const defaultWeeks = o.choices[1]?.weeks || o.choices[0]?.weeks || 12
        setWeeks(defaultWeeks)
        setWeeksText(String(defaultWeeks))
        if (!o.cardAvailable) setMethod('bank_transfer')
      })
      .catch((e) => live && setLoadErr(e.message))
    return () => { live = false }
  }, [base])

  /* ── Price whatever duration is chosen ────────────────────────────────────
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
        if (body.newEndDate) setResultEndDate(String(body.newEndDate).slice(0, 10))
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

  /** Typing commits only on a valid 1–104 value; an in-progress edit (a
   *  cleared field, a stray character) is shown but not acted on, and a blur
   *  with nothing valid snaps back to the last real duration. */
  function onWeeksChange(raw: string) {
    setWeeksText(raw)
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 1 && n <= 104) setWeeks(n)
  }
  function onWeeksBlur() {
    setWeeksText(String(weeks))
  }
  function pickWeeks(w: number) {
    setWeeks(w)
    setWeeksText(String(w))
  }

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
        <Panel>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: '#B91C1C', margin: '0 0 12px' }}>We can&rsquo;t open this renewal</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: BODY_TEXT, margin: 0 }}>{loadErr}</p>
        </Panel>
      </Shell>
    )
  }

  if (!options) {
    return <Shell><Panel><p style={{ color: MUTED, margin: 0 }}>Loading your contract…</p></Panel></Shell>
  }

  const shownEndDate = resultEndDate || endDate

  if (finalStatus === 'applied') {
    return (
      <Shell>
        <Panel>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: '#047857', margin: '0 0 12px' }}>You&rsquo;re renewed</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: BODY_TEXT }}>
            Your contract <strong style={{ color: INK }}>{options.contractNo}</strong> now runs until{' '}
            <strong style={{ color: INK }}>{fmtDate(shownEndDate)}</strong>. Your invoice is on its way by email, along with a
            link to re-sign your agreement for the new term.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: BODY_TEXT, margin: 0 }}>Thank you for staying with PurpleBox.</p>
        </Panel>
      </Shell>
    )
  }

  if (finalStatus === 'paid') {
    return (
      <Shell>
        <Panel>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: INK, margin: '0 0 12px' }}>Payment received</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: BODY_TEXT, margin: 0 }}>
            We&rsquo;ve got your payment and we&rsquo;re updating your contract now. This page will finish on its own — you can also
            close it, we&rsquo;ll email you either way.
          </p>
        </Panel>
      </Shell>
    )
  }

  /* Back from Stripe but the webhook has not landed yet. Without this the
     picker would flash up again for a second, which reads as "it didn't work"
     to somebody who has just typed their card in. */
  if (returnedSession && !finalStatus) {
    return (
      <Shell>
        <Panel>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: INK, margin: '0 0 12px' }}>Checking your payment…</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: BODY_TEXT, margin: 0 }}>
            This takes a few seconds. You don&rsquo;t need to do anything — we&rsquo;ll email you the moment it&rsquo;s done.
          </p>
        </Panel>
      </Shell>
    )
  }

  if (bankShown) {
    return (
      <Shell>
        <Panel>
          <h1 style={{ fontFamily: HEAD, fontSize: 24, color: INK, margin: '0 0 12px' }}>Transfer AED {money(bankShown.total)}</h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: BODY_TEXT }}>
            Please use <strong style={{ color: INK }}>{bankShown.reference}</strong> as the payment reference so we can match it to
            your unit. We&rsquo;ll extend your contract to <strong style={{ color: INK }}>{fmtDate(endDate)}</strong> as soon as it
            lands, and email you the invoice and a link to re-sign.
          </p>
          <div style={{ background: BADGE_BG, border: `1px solid ${BADGE_BORDER}`, borderRadius: 14, padding: 18, marginTop: 8, display: 'grid', gap: 10 }}>
            <Row label="Account name" value={options.bank.accountName} />
            <Row label="Account number" value={options.bank.accountNumber} />
            <Row label="IBAN" value={options.bank.iban} />
            <Row label="Reference" value={bankShown.reference} />
          </div>
        </Panel>
      </Shell>
    )
  }

  if (clientSecret && stripePromise) {
    return (
      <Shell>
        <Panel>
          <h1 style={{ fontFamily: HEAD, fontSize: 22, color: INK, margin: '0 0 4px' }}>Pay by card</h1>
          <p style={{ fontSize: 14, color: MUTED, margin: '0 0 18px' }}>
            Renewing to {fmtDate(endDate)} · AED {money(price?.totalWithCardFee ?? 0)} including the {options.cardFeePct}% admin fee.
          </p>
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </Panel>
      </Shell>
    )
  }

  // ── The picker ───────────────────────────────────────────────────────────
  const unitLabel = options.units.map((u) => u.unitNumber).join(', ') || 'your unit'
  const repriced = options.rateSource === 'list' && options.previousMonthlyRate > 0
    && Math.abs(options.previousMonthlyRate - options.monthlyRate) > 0.5
  const total = method === 'card' ? (price?.totalWithCardFee ?? 0) : (price?.total ?? 0)
  const ctaLabel = busy
    ? 'One moment…'
    : method === 'card'
      ? `Pay AED ${money(total)}${options.cardMode === 'redirect' ? ' with Stripe' : ''}`
      : 'Get the bank details'

  return (
    <div style={{ fontFamily: BODY, color: INK, background: PAGE_BG, minHeight: '100vh' }}>
      <FontStyle />
      <Header eyebrow="Contract renewal" />

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 24px 64px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '10px 14px' }}>
          <span style={badgeStyle}>Unit {unitLabel}</span>
          <span style={{ fontSize: 13, color: MUTED }}>Contract {options.contractNo}</span>
        </div>

        <h1 style={{ fontFamily: HEAD, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.04, fontSize: 'clamp(30px, 5vw, 50px)', margin: '18px 0 0', maxWidth: '20ch' }}>
          {options.firstName ? `${options.firstName}, keep ` : 'Keep '}unit {unitLabel}
        </h1>
        <p style={{ margin: '18px 0 0', fontSize: 'clamp(15px, 1.3vw, 18px)', lineHeight: 1.55, color: BODY_TEXT, maxWidth: '54ch' }}>
          Your contract <strong style={{ color: INK, fontWeight: 600 }}>{options.contractNo}</strong> currently ends on{' '}
          <strong style={{ color: INK, fontWeight: 600 }}>{fmtDate(options.currentEndDate)}</strong>. Choose how long you&rsquo;d like to stay.
        </p>
        <p style={{ margin: '12px 0 0', fontSize: 14, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>
          AED {money(options.weeklyRate)} a week · billed in whole weeks
          {repriced && ` · your rate was AED ${money(options.previousMonthlyRate / 4)} a week`}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginTop: 40, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 20 }}>

            <section style={cardStyle}>
              <h2 style={h2Style}>How long?</h2>
              <p style={{ margin: '8px 0 0', fontSize: 14, color: MUTED }}>Billed in whole weeks. Pick a length or set your own.</p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
                {options.choices.map((c) => (
                  <button
                    key={c.weeks}
                    type="button"
                    className="renew-pill"
                    onClick={() => pickWeeks(c.weeks)}
                    style={pillStyle(c.weeks === weeks)}
                  >
                    <span style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{c.weeks}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.72 }}>weeks</span>
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 26 }}>
                <label style={{ flex: '1 1 150px', minWidth: 0, display: 'block' }}>
                  <span style={labelStyle}>Weeks</span>
                  <input
                    type="number" inputMode="numeric" min={1} max={104}
                    className="renew-num"
                    value={weeksText}
                    onChange={(e) => onWeeksChange(e.target.value)}
                    onBlur={onWeeksBlur}
                    style={{
                      marginTop: 8, width: '100%', height: 50, padding: '0 14px',
                      border: '1px solid rgba(20,8,31,.16)', borderRadius: 12, background: PAGE_BG,
                      fontFamily: BODY, fontSize: 16, fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                </label>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <span style={labelStyle}>Move-out date</span>
                  <div style={{
                    marginTop: 8, height: 50, padding: '0 14px', border: '1px dashed rgba(20,8,31,.20)', borderRadius: 12,
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, color: INK, fontVariantNumeric: 'tabular-nums',
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: PURPLE, flex: '0 0 auto' }} />
                    <span>{endDate ? fmtDateLong(endDate) : '—'}</span>
                  </div>
                </div>
              </div>

              {price && (
                <p style={{ margin: '18px 0 0', fontSize: 14, color: BODY_TEXT, lineHeight: 1.5 }}>
                  <strong style={{ color: INK }}>{price.weeks} week{price.weeks === 1 ? '' : 's'}</strong>
                  {' · you move out on '}
                  <strong style={{ color: INK }}>{fmtDate(endDate)}</strong>
                </p>
              )}
            </section>

            <section style={cardStyle}>
              <h2 style={h2Style}>How would you like to pay?</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 20 }}>
                {options.cardAvailable && (
                  <button type="button" className="renew-method" onClick={() => setMethod('card')} style={methodStyle(method === 'card')}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={dotStyle(method === 'card')} />
                      <span style={{ fontSize: 15, fontWeight: 700 }}>Pay online by card</span>
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.8 }}>
                      Secure payment via Stripe · renews straight away · {options.cardFeePct}% fee
                    </span>
                  </button>
                )}
                <button type="button" className="renew-method" onClick={() => setMethod('bank_transfer')} style={methodStyle(method === 'bank_transfer')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={dotStyle(method === 'bank_transfer')} />
                    <span style={{ fontSize: 15, fontWeight: 700 }}>Bank transfer</span>
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.8 }}>No fee · renews once it reaches us</span>
                </button>
              </div>
            </section>
          </div>

          <section className="renew-sidebar" style={{ background: SIDEBAR_BG, border: `1px solid ${LINE}`, borderRadius: 22, padding: 28 }}>
            <h2 style={h2Style}>Your renewal</h2>

            <div style={{ display: 'grid', gap: 14, marginTop: 22, fontVariantNumeric: 'tabular-nums' }}>
              <Row label={`Storage · ${price?.weeks ?? weeks} week${(price?.weeks ?? weeks) === 1 ? '' : 's'}`} value={price ? `AED ${money(price.subTotal)}` : '—'} />
              <Row label={`VAT (${price?.vatPct ?? options.vatPct}%)`} value={price ? `AED ${money(price.vatAmount)}` : '—'} />
              {method === 'card' && price && price.cardFeeAmount > 0 && (
                <Row label={`Admin fee (${price.cardFeePct}%)`} value={`AED ${money(price.cardFeeAmount)}`} />
              )}
            </div>

            <div style={{ height: 1, background: 'rgba(20,8,31,.14)', margin: '22px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
              <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>Total</span>
              <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 'clamp(24px, 3vw, 32px)', letterSpacing: '-0.03em', color: PURPLE_DEEP, fontVariantNumeric: 'tabular-nums' }}>
                AED {money(total)}
              </span>
            </div>

            <p style={{ margin: '14px 0 0', fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
              Renews to {fmtDate(endDate)}. No deposit is collected again.
            </p>

            {priceErr && <p style={{ margin: '10px 0 0', fontSize: 13, color: '#B91C1C' }}>{priceErr}</p>}

            <button type="button" className="renew-cta" onClick={start} disabled={busy || !price} style={ctaStyle(busy || !price)}>
              {ctaLabel}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 12, color: MUTED }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,.18)', flex: '0 0 auto' }} />
              <span>Same unit, same key. Nothing to move.</span>
            </div>
          </section>
        </div>

        <p style={{ margin: '32px 0 0', fontSize: 13, color: MUTED }}>
          Need a different length or a hand with anything?{' '}
          <a href="https://wa.me/971542249946" style={{ color: PURPLE }}>Message us on WhatsApp</a> or call{' '}
          <a href="tel:+97143293924" style={{ color: PURPLE }}>04 329 3924</a>.
        </p>
      </div>
    </div>
  )
}
