// Film Powers app (installerad från Chrome). Sidorna hämtas alltid från nätet så att allt är färskt.
// Utan nät visas en enkel offline-sida. API-anrop och uppladdningar rörs aldrig.
const CACHE = 'fp-app-v2';
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});

// ---------- Notiser på datorn ----------
// Servern skickar { title, body, url, tag }. Är Film Power öppen och i fokus visas ingen ruta,
// sidan uppdaterar sig själv i stället. Annars visas en vanlig notis i datorns hörn.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    list.forEach((c) => c.postMessage({ type: 'fp-push' }));
    if (list.some((c) => c.focused && c.visibilityState === 'visible')) return undefined;
    return self.registration.showNotification(d.title || 'Film Power', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      data: { url: d.url || '/nyheter/#notiser' },
    });
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/nyheter/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (win) return win.focus().then(() => win.postMessage({ type: 'fp-open', url }));
    return self.clients.openWindow(url);
  }));
});
