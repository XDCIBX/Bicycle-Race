// Сервис-воркер: игра работает офлайн после первого запуска (в т.ч. на iPhone с экрана «Домой»).
// Файлы игры — «сначала сеть»: при интернете всегда свежая версия, без сети — копия из кэша.
// Фото с Wikimedia Commons — кэш навсегда.
const BUILD = 7;
const VERSION = `velorush-v${BUILD}`;
const PHOTOS = 'velorush-photos-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/data.js', 'js/state.js', 'js/track.js', 'js/progression.js', 'js/render.js', 'js/race.js', 'js/triathlon.js', 'js/bikeart.js', 'js/photos.js', 'js/ui.js', 'js/main.js',
  'assets/photos/credits.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — в обход HTTP-кэша браузера, чтобы не закэшировать устаревший файл.
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.all(ASSETS.map((a) => fetch(new Request(a, { cache: 'reload' })).then((res) => (res.ok ? c.put(a, res) : null)).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== PHOTOS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/(^|\.)wikimedia\.org$/.test(url.hostname)) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
