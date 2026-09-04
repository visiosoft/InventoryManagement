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
/** A generated stand-in rather than a name somebody gave us. */
export const isPlaceholderName = (n?: string) => !n || /^whatsapp\s*contact/i.test(n.trim())

export function convDisplayName(c: {
  displayName?: string
  customer?: { fullName?: string } | null
  lead?: { fullName?: string } | null
  phone?: string
  phoneNormalized: string
}) {
  const placeholder = isPlaceholderName
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

/* A tint and its ink, as a pair.
 *
 * Ten solid saturated discs down the side of the inbox competed with the names
 * beside them and with every badge on the row — the loudest thing on screen was
 * the one carrying the least information. A pale disc with the letter in the
 * same hue identifies somebody just as well and lets the name be the thing you
 * see. Each pair is checked for contrast in its own right, so the letter is
 * readable rather than decorative. */
const AVATAR_COLORS: { bg: string; fg: string }[] = [
  { bg: '#EDE9FE', fg: '#6D28D9' },   // violet
  { bg: '#FCE7F3', fg: '#BE185D' },   // pink
  { bg: '#DBEAFE', fg: '#1D4ED8' },   // blue
  { bg: '#D1FAE5', fg: '#047857' },   // green
  { bg: '#E0E7FF', fg: '#4338CA' },   // indigo
  { bg: '#FEE2E2', fg: '#B91C1C' },   // red
  { bg: '#FEF3C7', fg: '#92400E' },   // amber
  { bg: '#CCFBF1', fg: '#0F766E' },   // teal
  { bg: '#F3E8FF', fg: '#7E22CE' },   // purple
  { bg: '#FFE4E6', fg: '#BE123C' },   // rose
]

/** Stable per-contact colour, derived from the number so it never shifts. */
function avatarColor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function Avatar({ seed, label, size = 40 }: { seed: string; label: string; size?: number }) {
  const { bg, fg } = avatarColor(seed)
  return (
    <div
      className="wa-avatar shrink-0 rounded-full flex items-center justify-center font-bold"
      style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.34 }}
      aria-hidden
    >
      {initials(label)}
    </div>
  )
}
