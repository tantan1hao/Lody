/* Push-only worker. Do not add a fetch cache here: hashed Vite assets
 * must keep their network/HTTP cache behavior. */
const DEFAULT_TITLE = 'Lody OSS';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const readPushPayload = (event) => {
  if (!event.data) {
    return {};
  }
  try {
    const parsed = event.data.json();
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    const text = event.data.text();
    return text ? { body: text } : {};
  }
};

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : DEFAULT_TITLE;
  const body = typeof payload.body === 'string' ? payload.body : '';
  const url = typeof payload.url === 'string' ? payload.url : '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { url },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: typeof payload.tag === 'string' ? payload.tag : 'lody-oss',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target =
    event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client && target) {
            return client.navigate(target).then((navigated) => navigated ?? client.focus());
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
      return undefined;
    })
  );
});
