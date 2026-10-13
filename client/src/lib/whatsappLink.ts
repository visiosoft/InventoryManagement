/**
 * Opening a number in the real WhatsApp.
 *
 * First choice is the installed desktop app, through its own `whatsapp://`
 * address — the chat opens straight in the app without a browser page in
 * between. A browser cannot be told whether that worked, so it is inferred: if
 * the app (or the browser's "open this app?" prompt) takes over, the page
 * loses focus or is hidden almost at once. If nothing of the kind happens
 * within a moment, the app is not there, and the `wa.me` address is opened
 * instead, which lands on WhatsApp Web.
 *
 * Phones skip the attempt: `wa.me` is already handed to the WhatsApp app
 * there, and `whatsapp://` through a hidden frame is unreliable on mobile.
 */

export const waWebUrl = (number: string) => `https://wa.me/${number}`

/** A new tab for WhatsApp Web; falls back to this tab only if the browser
 *  refuses the pop-up. Not opened with the 'noopener' feature, because that
 *  makes window.open return null whether or not it worked, which would make a
 *  refusal impossible to tell from success. The opener is cut afterwards. */
function openWeb(url: string) {
  const w = window.open(url, '_blank')
  if (w) w.opener = null
  else window.location.assign(url)
}
export const waAppUrl = (number: string) => `whatsapp://send?phone=${number}`

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

/** How long to wait for the app to take over before falling back. Kept short:
 *  Safari only lets a page open a tab for about a second after a click. */
const WAIT_MS = 1200

export function openWhatsApp(number: string, waitMs = WAIT_MS): void {
  const web = waWebUrl(number)
  if (isMobile()) {
    openWeb(web)
    return
  }

  let tookOver = false
  const mark = () => { tookOver = true }
  window.addEventListener('blur', mark)
  window.addEventListener('pagehide', mark)
  document.addEventListener('visibilitychange', mark)

  // A hidden frame rather than navigating the page: if nothing handles the
  // address, the page stays exactly where it is instead of showing an error.
  const frame = document.createElement('iframe')
  frame.style.display = 'none'
  frame.src = waAppUrl(number)
  document.body.appendChild(frame)

  window.setTimeout(() => {
    window.removeEventListener('blur', mark)
    window.removeEventListener('pagehide', mark)
    document.removeEventListener('visibilitychange', mark)
    frame.remove()
    if (tookOver || !document.hasFocus()) return
    openWeb(web)
  }, waitMs)
}
