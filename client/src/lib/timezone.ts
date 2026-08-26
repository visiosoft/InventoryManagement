/**
 * The app runs on Dubai time, whatever the machine reading it thinks.
 *
 * Every date on screen used to be formatted in the viewer's own timezone,
 * because `toLocaleString(undefined, …)` means "wherever this computer is".
 * That is the wrong default here: the business is in one city, the server
 * already fixes its day boundaries at UTC+4 for digests and follow-up
 * reminders, and a laptop set to another zone made the same lead look like it
 * arrived on a different day to two people looking at it together.
 *
 * There are ~200 formatting calls across ~60 files. Rather than pin the zone
 * at each one — and miss the next one somebody writes — the three Date
 * formatting methods take Dubai as their default. An explicit `timeZone` in
 * the options still wins, so anything that genuinely needs another zone can
 * ask for it.
 *
 * Only the default changes. Locale is left alone, so nothing else about how
 * dates read moves.
 */

export const APP_TIMEZONE = 'Asia/Dubai'

/** UTC+4 all year — the Gulf has no daylight saving, so this stays exact. */
export const APP_UTC_OFFSET_HOURS = 4

type Formatter = 'toLocaleString' | 'toLocaleDateString' | 'toLocaleTimeString'

type LocaleFormatter = (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
) => string

function pin(method: Formatter) {
  const proto = Date.prototype as unknown as Record<Formatter, LocaleFormatter>
  const original = proto[method]
  proto[method] = function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    const opts: Intl.DateTimeFormatOptions = { ...(options || {}) }
    if (!opts.timeZone) opts.timeZone = APP_TIMEZONE
    return original.call(this, locales, opts)
  }
}

export function useDubaiTime() {
  pin('toLocaleString')
  pin('toLocaleDateString')
  pin('toLocaleTimeString')
}

/** Today in Dubai as 'YYYY-MM-DD', for comparing against stored day strings. */
export function dubaiToday(now: Date = new Date()): string {
  return new Date(now.getTime() + APP_UTC_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10)
}

/**
 * A stored instant as 'YYYY-MM-DDTHH:mm' in Dubai, for `datetime-local`
 * inputs. Those have no timezone of their own and show exactly what they are
 * given, so handing them the viewer's local time showed the wrong hour.
 */
export function toDubaiDatetimeLocal(input?: string | Date | null): string {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() + APP_UTC_OFFSET_HOURS * 3600_000).toISOString().slice(0, 16)
}

/** The reverse: what a Dubai wall-clock reading actually means in UTC. */
export function fromDubaiDatetimeLocal(value: string): string {
  if (!value) return ''
  const asUtc = new Date(`${value}:00.000Z`).getTime()
  if (Number.isNaN(asUtc)) return ''
  return new Date(asUtc - APP_UTC_OFFSET_HOURS * 3600_000).toISOString()
}
