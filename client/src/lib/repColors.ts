/* Each rep's colour on the roster: an accent, a light tint for calendar
   cells and a deep tone for their text — soft blocks with a strong edge, in
   the CRM's blue / yellow / navy family. Shared by the roster calendar and
   the dashboard's Who is on now card. */
export const SWATCHES: { accent: string; tint: string; ink: string }[] = [
  { accent: '#4C8CE4', tint: '#E8F0FC', ink: '#1E4E99' },  // PurpleBox blue
  { accent: '#14A38B', tint: '#E3F5F1', ink: '#0B6656' },  // teal
  { accent: '#E8A317', tint: '#FDF4DD', ink: '#8A5A00' },  // amber, the yellow's deeper side
  { accent: '#7C5CD6', tint: '#EFEBFB', ink: '#4A2FA0' },  // soft violet
  { accent: '#E46A6A', tint: '#FCEBEB', ink: '#9B2C2C' },  // coral
  { accent: '#3D4A66', tint: '#ECEFF5', ink: '#1B2238' },  // navy slate
]

// Colours saved by the earlier calendar, moved onto this set.
const RENAMED: Record<string, string> = { '#7b4bbf': '#4C8CE4', '#3e8e6e': '#14A38B', '#1b2238': '#3D4A66', '#c2410c': '#E46A6A', '#0e7490': '#7C5CD6', '#b91c77': '#E8A317' }

/** A saved colour as one of the set, or '' when it is not one. */
export function repAccent(saved?: string | null) {
  const c = String(saved || '').toLowerCase()
  const mapped = (RENAMED[c] ?? c).toLowerCase()
  return SWATCHES.find((x) => x.accent.toLowerCase() === mapped)?.accent ?? ''
}

export const swatch = (accent: string) => SWATCHES.find((x) => x.accent.toLowerCase() === accent.toLowerCase()) ?? SWATCHES[0]
