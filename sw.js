// ===== ?ㅽ봽?쇱씤 ?꾩슦誘?(?쒕퉬???뚯빱) =====
// ???뚯씪??湲곌린????ν빐 ?먭퀬, ?명꽣?룹씠 ?딄꺼???깆씠 ?대━寃??댁슂.
// ?????곗씠?곕뒗 Firebase媛 ?곕줈 湲곌린????ν빐 以섏슂.
const CACHE = 'mytodo-v6';

const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './cloud.js',
  './firebase-config.js',
  './push-config.js',
  './themes.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

// 踰꾩쟾???뺥빐吏??몃? ?뚯씪 (Firebase ?꾧뎄, 湲瑗?: ??踰?諛쏆쑝硫?諛붾뚯? ?딆븘??const IMMUTABLE_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // ???뚯씪: ?명꽣?룹뿉??理쒖떊 寃껋쓣 癒쇱? 諛쏄퀬, ???섎㈃ ??ν빐 ??寃껋쓣 ?⑥슂
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Firebase ?꾧뎄쨌湲瑗? ??ν빐 ??寃??덉쑝硫?洹멸구 諛붾줈 ?⑥슂
  if (IMMUTABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
  // 洹?諛뽰쓽 ?붿껌(濡쒓렇?? ???????? ?먮?吏 ?딆븘??});

// ===== ?뚮┝ =====
// ?뚮┝ ?쒕쾭媛 蹂대궦 ?뚮┝???붾㈃(?좉툑?붾㈃쨌?뚮┝?쇳꽣)???꾩썙??self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || '?섏쓽 ????, {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'mytodo',
    renotify: true,
    data: { url: data.url || './' },
  }));
});

// ?뚮┝???꾨Ⅴ硫??깆쓣 ?댁뼱??(?대? ?대젮 ?덉쑝硫?洹?李쎌쑝濡?
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) return open.focus();
    return self.clients.openWindow(event.notification.data?.url || './');
  })());
});
