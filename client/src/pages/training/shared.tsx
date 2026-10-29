import type { ReactNode } from 'react'
import { STATUS, MUTED, LINE } from './theme'

/* Small pieces shared by the AI Training tabs. */

export function Pill({ status, children }: { status: string; children?: ReactNode }) {
  const s = STATUS[status] ?? { label: status, bg: '#F1EFF5', fg: MUTED }
  return <span style={{ background: s.bg, color: s.fg, borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{children ?? s.label}</span>
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd style={{ fontSize: 10.5, fontWeight: 700, border: `1px solid ${LINE}`, borderBottomWidth: 2, borderRadius: 5, padding: '0 5px', marginLeft: 4, color: MUTED, background: '#fff' }}>{children}</kbd>
}
