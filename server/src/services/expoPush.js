/**
 * Push to the mobile app, via Expo.
 *
 * services/push.js already does this for the browser — a Web Push
 * subscription per tab, gone the moment somebody clears their history. The
 * phone is a different animal: one app, (usually) one or two devices per
 * person, logged in for weeks at a time, and the whole reason a lead
 * assignment needs to reach somebody who is not sitting at a desk.
 *
 * No VAPID-style key pair here — Expo's push service needs no server
 * credentials at all for its own project, only a per-device token the app
 * hands the server once it has permission. `EXPO_ACCESS_TOKEN` is optional
 * and only raises Expo's own rate limits; everything works without it.
 *
 * Nothing here throws. A lead must be assigned whatever Expo's service is
 * doing, exactly like services/push.js and services/mail.js.
 */

import { Expo } from 'expo-server-sdk';
import { User } from '../models/index.js';

const expo = new Expo(process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : {});

/** Whether mobile push is allowed to run at all. An operational kill switch,
 *  not a credentials check — Expo needs none. */
export function expoPushConfigured() {
  return process.env.EXPO_PUSH_DISABLED !== 'true';
}

/**
 * Push one message to every device a person is logged into the mobile app
 * on. A token Expo reports as dead (`DeviceNotRegistered` — the app was
 * uninstalled, or the person is logged in elsewhere now) is removed rather
 * than retried forever, the same rule services/push.js applies to a Web Push
 * subscription the browser has thrown away.
 *
 * Returns `{ sent, gone, failed }` and never throws.
 */
export async function pushExpoToUser(userId, payload = {}) {
  const out = { sent: 0, gone: 0, failed: 0 };
  if (!expoPushConfigured() || !userId) return out;

  try {
    const user = await User.findById(userId).select('pushTokens').lean();
    const tokens = (user?.pushTokens || []).filter((t) => Expo.isExpoPushToken(t));
    if (!tokens.length) return out;

    const messages = tokens.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      sound: payload.silent ? undefined : 'default',
      ...(payload.badge != null ? { badge: payload.badge } : {}),
      ...(payload.silent ? { _contentAvailable: true, priority: 'high' } : {}),
    }));

    const dead = [];
    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, i) => {
          if (ticket.status === 'ok') { out.sent += 1; return; }
          if (ticket.details?.error === 'DeviceNotRegistered') {
            dead.push(chunk[i].to);
            out.gone += 1;
          } else {
            out.failed += 1;
            console.error('[ExpoPush] send failed:', ticket.details?.error || ticket.message || '');
          }
        });
      } catch (e) {
        out.failed += chunk.length;
        console.error('[ExpoPush] chunk failed:', e.message);
      }
    }

    if (dead.length) {
      await User.updateOne({ _id: userId }, { $pull: { pushTokens: { $in: dead } } });
    }
  } catch (e) {
    console.error('[ExpoPush] could not push to', userId, e.message);
  }

  return out;
}

/**
 * Register (or refresh) one device's token.
 *
 * `$addToSet` keeps it idempotent — the app calls this again every time it
 * launches, not only the first time, and a token seen twice must stay one
 * entry rather than growing the array forever. Pulled off any other account
 * first: a phone that logs out and back in as somebody else must not keep
 * receiving the previous person's lead pushes.
 */
export async function registerExpoPushToken(userId, token) {
  if (!userId || !token || !Expo.isExpoPushToken(token)) return false;
  await User.updateMany({ _id: { $ne: userId }, pushTokens: token }, { $pull: { pushTokens: token } });
  await User.updateOne({ _id: userId }, { $addToSet: { pushTokens: token } });
  return true;
}

/** Stop pushing to one device — used when the app can tell the token is no
 *  longer good for anything (e.g. the person signed out). */
export async function unregisterExpoPushToken(userId, token) {
  if (!userId || !token) return false;
  await User.updateOne({ _id: userId }, { $pull: { pushTokens: token } });
  return true;
}
