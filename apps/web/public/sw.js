// Talorys service worker. It only shows Web Push notifications: nothing is cached, so the
// app always loads fresh from the network. Payloads arrive encrypted end to end (RFC 8291).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * Only same-origin paths can be opened from a notification. Resolved as the browser will, so
 * "//host" and "/\host" (a backslash reads as a slash) cannot point at another origin.
 */
function safePath(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return "/";
  try {
    const resolved = new URL(url, self.location.origin);
    return resolved.origin === self.location.origin ? resolved.pathname + resolved.search + resolved.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Talorys";
  const id = typeof data.id === "string" && /^[\w-]{1,64}$/.test(data.id) ? data.id : undefined;
  // Buttons only for answers the server knows, and only as many as this browser shows.
  const max = typeof Notification !== "undefined" && Notification.maxActions ? Notification.maxActions : 2;
  const actions = id && Array.isArray(data.actions)
    ? data.actions
        .filter((a) => a && ACTIONS.includes(a.action) && typeof a.title === "string")
        .slice(0, max)
        .map((a) => ({ action: a.action, title: a.title.slice(0, 40) }))
    : [];
  // Every push must show a notification; browsers revoke permission from silent pushes.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: id,
      // A later try of the same alert replaces the earlier one and rings again.
      renotify: !!id,
      requireInteraction: data.sticky === true,
      actions,
      data: { url: safePath(data.url), id },
    }),
  );
});

/** Answers the push buttons send to the server, the same as the Telegram buttons. */
const ACTIONS = ["done", "snooze", "mute"];

async function openApp(url) {
  const target = new URL(safePath(url), self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
  if (open) return open.focus();
  return self.clients.openWindow(target);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, id } = event.notification.data ?? {};
  const action = ACTIONS.includes(event.action) ? event.action : null;
  event.waitUntil(
    (async () => {
      if (action && typeof id === "string") {
        try {
          const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/action`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "x-talorys-request": "1" },
            body: JSON.stringify({ action }),
          });
          // Answered: nothing else to do. Signed out or offline: open the app to answer there.
          if (res.ok) return;
        } catch {
          // Fall through to opening the app.
        }
      }
      return openApp(url);
    })(),
  );
});

// The browser replaced the subscription (keys rotated or it expired): register the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription?.options;
  if (!options?.applicationServerKey) return;
  event.waitUntil(
    (async () => {
      const sub = event.newSubscription ?? (await self.registration.pushManager.subscribe(options));
      const headers = { "content-type": "application/json", "x-talorys-request": "1" };
      // Free the old endpoint's device slot first, so the new one is not refused at the device limit.
      if (event.oldSubscription?.endpoint) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }),
        }).catch(() => {});
      }
      await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(sub.toJSON()),
      });
    })(),
  );
});
