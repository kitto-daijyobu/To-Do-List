// ===== 오프라인 도우미 (서비스 워커) =====
// 앱 파일을 기기에 저장해 두고, 인터넷이 끊겨도 앱이 열리게 해요.
// 할 일 데이터는 Firebase가 따로 기기에 저장해 줘요.
const CACHE = 'mytodo-v23';

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

// 버전이 정해진 외부 파일 (Firebase 도구, 글꼴): 한 번 받으면 바뀌지 않아요
const IMMUTABLE_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

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

  // 앱 파일: 인터넷에서 최신 것을 먼저 받고, 안 되면 저장해 둔 것을 써요
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

  // Firebase 도구·글꼴: 저장해 둔 게 있으면 그걸 바로 써요
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
  // 그 밖의 요청(로그인, 할 일 저장)은 손대지 않아요
});

// ===== 알림 =====
// 알림 서버가 보낸 알림을 화면(잠금화면·알림센터)에 띄워요
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || '나의 할 일', {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: data.tag || 'mytodo',
    renotify: true,
    data: { url: data.url || './' },
  }));
});

// 알림을 누르면 앱을 열어요 (이미 열려 있으면 그 창으로)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) return open.focus();
    return self.clients.openWindow(event.notification.data?.url || './');
  })());
});
