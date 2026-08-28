/**
 * Turning browser notifications on for this device.
 *
 * A subscription belongs to a browser, not to a person: somebody who uses the
 * office desktop and their phone has to allow it on both, and clearing site
 * data on either revokes that one silently. So this is always "is this browser
 * registered", never "has this user enabled notifications".
 */

import { api } from './api'

/** Whether this browser could do it at all, before anything is asked of it. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

/** granted | denied | default — 'denied' cannot be undone from here. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/sw.js')
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

/** Is this browser already registered with the server? */
export async function pushSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  try {
    const reg = await registration()
    return Boolean(await reg.pushManager.getSubscription())
  } catch {
    return false
  }
}

/* The key arrives base64url and the Push API wants bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/**
 * Ask permission, register, and tell the server where to reach this browser.
 *
 * Throws with something a person can act on, because every step here fails for
 * a different and unrelated reason — no keys on the server, permission
 * refused, an insecure origin — and "could not enable notifications" would
 * leave somebody guessing which.
 */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser cannot show notifications')

  // Push needs a secure origin. localhost counts; a plain-http host does not.
  if (!window.isSecureContext) throw new Error('Notifications need a secure (https) connection')

  const { data } = await api.get<{ configured: boolean; publicKey: string }>('/push/key')
  if (!data.configured || !data.publicKey) {
    throw new Error('Push is not set up on the server yet')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for this site — allow them in your browser settings'
      : 'Notifications were not allowed')
  }

  const reg = await registration()
  await navigator.serviceWorker.ready

  const sub = await reg.pushManager.getSubscription()
    ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey) as BufferSource,
    })

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys })
}

/** Stop this browser being pushed to, at both ends. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  // The browser has already stopped listening; this stops us shouting.
  await api.post('/push/unsubscribe', { endpoint }).catch(() => {})
}
