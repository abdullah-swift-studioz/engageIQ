/**
 * EngageIQ Web Push service worker.
 *
 * Must be served from the STOREFRONT origin (a service worker can only control the origin
 * it is served from). It renders notifications pushed by the EngageIQ Web Push channel and
 * routes a click to the notification's target URL.
 *
 * Built by esbuild to dist/eiq-sw.js. Not type-checked by tsc (the SDK has no tsc step),
 * so the worker-scope globals are referenced loosely.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const sw: any = self;

sw.addEventListener('push', (event: any) => {
  let data: { title?: string; body?: string; url?: string; icon?: string } = {};
  try {
    if (event.data) data = event.data.json();
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Notification';
  const options = {
    body: data.body || '',
    icon: data.icon || undefined,
    data: { url: data.url || '/' },
  };

  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener('notificationclick', (event: any) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients: any[]) => {
      // Focus an existing tab on the same URL if one is open; otherwise open a new one.
      for (const client of clients) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (sw.clients.openWindow) return sw.clients.openWindow(url);
      return undefined;
    }),
  );
});
