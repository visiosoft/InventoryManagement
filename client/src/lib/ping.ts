/**
 * The notification sound, shared.
 *
 * This lived inside the WhatsApp console, which meant anything else that
 * needed to make a noise had to grow its own copy — and a second audio element
 * playing the same clip a moment later is heard as one stuttering ring rather
 * than two events.
 *
 * One element, one floor under it. Browsers refuse playback before a user
 * gesture, so the element is primed with a muted play/pause on the first
 * interaction, and every failure is swallowed: audio is a nicety and must
 * never break the page it is on.
 */

const PING_SRC = '/whatsappaduio.mp3'

/* How long the sound stays quiet after ringing.
 *
 * This was two seconds, which only stopped two rings being heard as one
 * stutter. But the inbox polls every ten seconds and rings once per poll that
 * carries a new chat, so a busy morning was up to six rings a minute — a
 * metronome, and the thing staff actually complained about.
 *
 * Half a minute is long enough that a busy stretch is a handful of rings
 * rather than a stream, and short enough that a genuinely new conversation
 * still gets heard. The unread counts and the blink carry everything else,
 * which is the right division: the badge is for what is waiting, the sound is
 * only for "look now". */
const PING_GAP_MS = 30_000

let pingEl: HTMLAudioElement | null = null
let pingPrimed = false
let lastPingAt = 0

function getPingElement(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (!pingEl) {
    try {
      pingEl = new Audio(PING_SRC)
      pingEl.preload = 'auto'
    } catch {
      return null
    }
  }
  return pingEl
}

/** Muted play/pause on a gesture, so later programmatic plays are allowed. */
export function primePing() {
  if (pingPrimed) return
  const el = getPingElement()
  if (!el) return
  pingPrimed = true
  try {
    el.muted = true
    const p = el.play()
    const settle = () => { try { el.pause(); el.currentTime = 0 } catch { /* ignore */ } el.muted = false }
    if (p && typeof p.then === 'function') p.then(settle, () => { el.muted = false })
    else settle()
  } catch {
    el.muted = false
  }
}

export function playPing() {
  const el = getPingElement()
  if (!el) return
  const now = Date.now()
  if (now - lastPingAt < PING_GAP_MS) return
  lastPingAt = now
  try {
    el.currentTime = 0 // otherwise a second message plays from the finished end
    const p = el.play()
    if (p && typeof p.catch === 'function') p.catch(() => { /* blocked — never mind */ })
  } catch {
    /* audio is a nicety — never let it break the page */
  }
}

/**
 * Prime on the first gesture anywhere on the page.
 *
 * Returns the teardown. Priming is per-page: a sound can only play somewhere
 * the person has already clicked, which is why every page that wants one has
 * to ask.
 */
export function listenForPingPriming(): () => void {
  if (typeof window === 'undefined') return () => {}
  const prime = () => primePing()
  window.addEventListener('pointerdown', prime, { once: true })
  window.addEventListener('keydown', prime, { once: true })
  return () => {
    window.removeEventListener('pointerdown', prime)
    window.removeEventListener('keydown', prime)
  }
}
