import { useState } from 'react'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.14)'

export type AskField = {
  key: string
  label: string
  type: 'text' | 'phone' | 'email' | 'number' | 'date' | 'select' | 'textarea'
  options?: string[]
  value?: string
  required?: boolean
}
export type AskFormSpec = { intro: string; title?: string; fields: AskField[]; submitLabel?: string }

const INPUT_TYPE: Record<AskField['type'], string> = { text: 'text', phone: 'tel', email: 'email', number: 'number', date: 'date', select: 'text', textarea: 'text' }

/**
 * The details the assistant asked for, as boxes to fill in. What it already
 * knew is filled in; the person checks it, fills the gaps, and the answers go
 * back to it as the next message.
 */
export default function AskForm({ form, busy, onSubmit }: { form: AskFormSpec; busy: boolean; onSubmit: (text: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(form.fields.map((f) => [f.key, f.value ?? ''])))
  const [tried, setTried] = useState(false)
  const missing = form.fields.filter((f) => f.required !== false && !String(values[f.key] ?? '').trim())

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setTried(true)
    if (missing.length || busy) return
    const lines = form.fields
      .map((f) => [f.label, String(values[f.key] ?? '').trim()] as const)
      .filter(([, v]) => v)
      .map(([l, v]) => `- ${l}: ${v}`)
    onSubmit(`${form.title ? `${form.title} details` : 'The details'}:\n${lines.join('\n')}`)
  }

  const box = (bad: boolean): React.CSSProperties => ({
    width: '100%', height: 38, padding: '0 11px', borderRadius: 9, fontSize: 13.5, color: INK, background: '#fff',
    border: `1px solid ${bad ? '#DC2626' : LINE}`, outline: 'none',
  })

  return (
    <form onSubmit={submit} aria-label={form.title || 'Details'} style={{ marginTop: 12 }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {form.fields.map((f) => {
          const bad = tried && f.required !== false && !String(values[f.key] ?? '').trim()
          const set = (v: string) => setValues((s) => ({ ...s, [f.key]: v }))
          const id = `ask-${f.key}`
          return (
            <label key={f.key} htmlFor={id} className={f.type === 'textarea' ? 'sm:col-span-2' : ''} style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 5 }}>
                {f.label}{f.required === false && <span style={{ fontWeight: 400 }}> · optional</span>}
              </span>
              {f.type === 'select' && f.options?.length ? (
                <select id={id} value={values[f.key]} onChange={(e) => set(e.target.value)} style={box(bad)}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  {values[f.key] && !f.options.includes(values[f.key]) && <option value={values[f.key]}>{values[f.key]}</option>}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea id={id} value={values[f.key]} onChange={(e) => set(e.target.value)} rows={2}
                  style={{ ...box(bad), height: 'auto', padding: '8px 11px', resize: 'vertical' }} />
              ) : (
                <input id={id} type={INPUT_TYPE[f.type]} value={values[f.key]} onChange={(e) => set(e.target.value)} style={box(bad)} />
              )}
            </label>
          )
        })}
      </div>
      <div className="flex items-center gap-3" style={{ marginTop: 14 }}>
        <button type="submit" disabled={busy} className="cursor-pointer disabled:opacity-50"
          style={{ background: PURPLE, color: '#fff', border: 0, borderRadius: 9, padding: '9px 16px', fontWeight: 700, fontSize: 13 }}>
          {busy ? 'Working…' : form.submitLabel || 'Continue'}
        </button>
        {tried && missing.length > 0 && <span style={{ fontSize: 12, color: '#B91C1C' }}>Fill in {missing.map((f) => f.label.toLowerCase()).join(', ')}.</span>}
      </div>
    </form>
  )
}
