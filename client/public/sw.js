/**
 * The service worker, which exists for one reason: it is the only thing that
 * can receive a notification while the app is closed.
 *
 * Everything else in PurpleBox is polling, and polling stops when the tab does
 * — so a follow-up set for Thursday at four could only ever reach somebody who
 * happened to be looking. This runs whether or not anybody is.
 *
 * Deliberately not a caching worker. It does not intercept fetches and does
 * not serve anything offline: caching a single-page app badly is how people
 * end up staring at a version from last week, and nothing here needs it.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'PurpleBox';
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    // Same tag replaces rather than stacks, so rescheduling a follow-up cannot
    // leave two notifications for the same lead sitting there.
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  // Focus a tab that is already open rather than opening a second one — being
  // reminded twice about the same lead in two windows helps nobody.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate?.(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
