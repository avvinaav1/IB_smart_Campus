/* IB Smart Campus service worker: makes the site installable and shows push notifications. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  const title = data.title || "IB Smart Campus";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "You have a new notification.",
    icon: "/web-app-manifest-192x192.png",
    badge: "/favicon-96x96.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil((async () => {
    // External links (e.g. a call's meeting room) open in a new window; app links reuse an open tab.
    if (target.origin === self.location.origin) {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        return existing.navigate(target.href);
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
