import { useEffect, useRef, useState } from 'react'

/**
 * A number that visibly moves: when it changes, the old value slides out, the
 * new one slides in from the direction it moved, the tile flashes, and a
 * "+1" / "−1" tag stays for a few seconds. `upIsBad` turns a rise red (more
 * customers waiting) and a fall green (somebody was answered).
 */

const CSS = `
@keyframes lc-in-up { from { transform: translateY(60%); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes lc-in-down { from { transform: translateY(-60%); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes lc-flash { 0% { box-shadow: 0 0 0 0 var(--lc-c) } 40% { box-shadow: 0 0 0 6px var(--lc-c) } 100% { box-shadow: 0 0 0 0 transparent } }
@keyframes lc-tag { 0% { transform: translateY(4px); opacity: 0 } 15% { transform: none; opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }
@keyframes lc-dot { 0%, 100% { opacity: 1 } 50% { opacity: .3 } }
.lc-num-up { animation: lc-in-up .45s cubic-bezier(.2,.8,.2,1) }
.lc-num-down { animation: lc-in-down .45s cubic-bezier(.2,.8,.2,1) }
.lc-flash { animation: lc-flash 1.2s ease-out }
.lc-tag { animation: lc-tag 4s ease-out forwards }
.lc-live-dot { animation: lc-dot 1.6s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .lc-num-up, .lc-num-down, .lc-flash, .lc-live-dot { animation: none } }
`

export function LiveCounterStyles() {
  return <style>{CSS}</style>
}

export default function LiveCounter({ label, value, hint, upIsBad = false }: {
  label: string
  value: number
  hint?: string
  upIsBad?: boolean
}) {
  const prev = useRef(value)
  const [change, setChange] = useState<{ delta: number; key: number } | null>(null)

  useEffect(() => {
    if (value !== prev.current) {
      setChange({ delta: value - prev.current, key: Date.now() })
      prev.current = value
    }
  }, [value])
  // Back to plain after a few seconds, so a colour always means "just moved".
  useEffect(() => {
    if (!change) return
    const t = window.setTimeout(() => setChange(null), 6000)
    return () => window.clearTimeout(t)
  }, [change])

  const up = (change?.delta ?? 0) > 0
  const bad = change ? (up === upIsBad) : false
  const tone = !change ? '#14081F' : bad ? '#B91C1C' : '#15803D'
  const flash = !change ? 'transparent' : bad ? 'rgba(239,68,68,.35)' : 'rgba(34,197,94,.35)'

  return (
    <div key={change?.key} className={change ? 'lc-flash' : undefined}
      style={{ ['--lc-c' as string]: flash, position: 'relative', border: '1px solid rgba(20,8,31,.08)', borderRadius: 14, padding: '12px 14px', background: '#fff', overflow: 'hidden' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, height: 44, overflow: 'hidden' }}>
        <span className={change ? (up ? 'lc-num-up' : 'lc-num-down') : undefined}
          style={{ display: 'inline-block', fontSize: 36, fontWeight: 800, lineHeight: '44px', color: tone, fontVariantNumeric: 'tabular-nums', transition: 'color 1.5s' }}>
          {value}
        </span>
        {change && (
          <span className="lc-tag" style={{ fontSize: 13, fontWeight: 800, color: tone }}>
            {up ? '▲' : '▼'} {up ? '+' : '−'}{Math.abs(change.delta)}
          </span>
        )}
      </div>
      {hint && <div style={{ fontSize: 11, color: '#756E80' }}>{hint}</div>}
    </div>
  )
}
