/**
 * Shared presentation for WhatsApp contacts — used by the console and by the
 * notification bell in the top bar, which must name and colour a contact
 * identically or the same person looks like two.
 */

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** What to call a conversation.
 *
 *  The server resolves this against customers and leads and sends it as
 *  `displayName`. A lead created from a chat gets an auto-generated name like
 *  "WhatsApp Contact 4797", which is not a name — the number is more useful,
 *  so it is filtered here too in case an older payload arrives without the
 *  resolved field. */
export function convDisplayName(c: {
  displayName?: string
  customer?: { fullName?: string } | null
  lead?: { fullName?: string } | null
  phone?: string
  phoneNormalized: string
}) {
  const placeholder = (n?: string) => !n || /^whatsapp\s*contact/i.test(n.trim())
  if (c.displayName && !placeholder(c.displayName)) return c.displayName
  if (c.customer?.fullName) return c.customer.fullName
  if (!placeholder(c.lead?.fullName)) return c.lead!.fullName!
  return c.phone || `+${c.phoneNormalized}`
}

export function formatListTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return formatClock(iso)
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

function initials(label: string) {
  const cleaned = label.replace(/^\+/, '').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (/^\d/.test(words[0])) return cleaned.slice(-2)
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase()
}

const AVATAR_COLORS = ['#5B2BC9', '#7C3AED', '#9333EA', '#C026D3', '#DB2777', '#E11D48', '#EA580C', '#0891B2', '#0D9488', '#16A34A']

/** Stable per-contact colour, derived from the number so it never shifts. */
function avatarColor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function Avatar({ seed, label, size = 40 }: { seed: string; label: string; size?: number }) {
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center text-white font-bold"
      style={{ width: size, height: size, background: avatarColor(seed), fontSize: size * 0.34 }}
      aria-hidden
    >
      {initials(label)}
    </div>
  )
}
