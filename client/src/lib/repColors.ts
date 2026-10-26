/* Each rep's colour on the roster: an accent, a light tint for calendar
   cells and a deep tone for their text — soft blocks with a strong edge, in
   the CRM's blue / yellow / navy family. Shared by the roster calendar and
   the dashboard's Who is on now card. */
export const SWATCHES: { accent: string; tint: string; ink: string }[] = [
  { accent: '#3B7DDD', tint: '#C9DCF8', ink: '#123C7A' },  // PurpleBox blue
  { accent: '#0F9C84', tint: '#BDEBDF', ink: '#075446' },  // teal
  { accent: '#E09A0B', tint: '#FAE0A6', ink: '#7A4E00' },  // amber, the yellow's deeper side
  { accent: '#6F4BD8', tint: '#DAD0F7', ink: '#3D2391' },  // violet
  { accent: '#DD5555', tint: '#F7CFCF', ink: '#8A2020' },  // coral
  { accent: '#3D4A66', tint: '#D5DBE7', ink: '#141B2E' },  // navy slate
]

// Colours saved by the earlier calendar, moved onto this set.
const RENAMED: Record<string, string> = {
  '#7b4bbf': '#3B7DDD', '#3e8e6e': '#0F9C84', '#1b2238': '#3D4A66', '#c2410c': '#DD5555', '#0e7490': '#6F4BD8', '#b91c77': '#E09A0B',
  // and the lighter set this replaced
  '#4c8ce4': '#3B7DDD', '#14a38b': '#0F9C84', '#e8a317': '#E09A0B', '#7c5cd6': '#6F4BD8', '#e46a6a': '#DD5555',
}

/** A saved colour as one of the set, or '' when it is not one. */
export function repAccent(saved?: string | null) {
  const c = String(saved || '').toLowerCase()
  const mapped = (RENAMED[c] ?? c).toLowerCase()
  return SWATCHES.find((x) => x.accent.toLowerCase() === mapped)?.accent ?? ''
}

export const swatch = (accent: string) => SWATCHES.find((x) => x.accent.toLowerCase() === accent.toLowerCase()) ?? SWATCHES[0]
