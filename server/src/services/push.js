/**
 * Browser push, so a reminder reaches somebody who is not looking at the app.
 *
 * Everything else here is polling, which only works while a tab is open. A
 * follow-up set for Thursday at four is precisely the thing nobody is sitting
 * in front of the app for — the in-app strip is silent when it matters most.
 *
 * Web Push is the one channel that survives a closed tab, and it needs a
 * service worker in the browser, a VAPID key pair, and a stored subscription
 * per browser. Without the keys configured this whole module is inert and says
 * so rather than throwing on every send.
 */

import webpush from 'web-push';
import { PushSubscription } from '../models/index.js';

let configured = false;

/** Whether pushes can go out at all. Checked before anything is scheduled. */
export function pushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function publicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

function configure() {
  if (configured || !pushConfigured()) return configured;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:marketing@purplebox.ae',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  configured = true;
  return true;
}

/**
 * Push one message to every browser a person has registered.
 *
 * A subscription the push service rejects as gone (404/410) is deleted rather
 * than retried — a browser that has been cleared or replaced will never come
 * back, and keeping it means failing forever on every send.
 *
 * Returns { sent, gone, failed }; it never throws, because a reminder failing
 * to arrive must not take down whatever was raising it.
 */
export async function pushToUser(userId, payload) {
  if (!configure() || !userId) return { sent: 0, gone: 0, failed: 0 };

  const subs = await PushSubscription.find({ user: userId }).lean();
  const body = JSON.stringify(payload);
  const out = { sent: 0, gone: 0, failed: 0 };

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } },
        body,
      );
      out.sent += 1;
      await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastUsedAt: new Date() } });
    } catch (e) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) {
        await PushSubscription.deleteOne({ _id: sub._id });
        out.gone += 1;
      } else {
        out.failed += 1;
        console.error('[Push] send failed:', code || '', e?.message || e);
      }
    }
  }

  return out;
}
