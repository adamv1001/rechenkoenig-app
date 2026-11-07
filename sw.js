const PREFIX = 'rechenkoenig-app-';
const CACHE = `${PREFIX}v1`;
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(ASSETS.map(async (asset) => {
    const response = await fetch(asset, { cache: 'reload' });
    if (!response.ok) throw new Error(`Precache failed for ${asset}`);
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    await cache.put(asset, new Response(await response.blob(), {
      status: response.status,
      statusText: response.statusText,
      headers
    }));
  }));
}

async function cacheReady() {
  const cache = await caches.open(CACHE);
  for (const asset of ASSETS) {
    const hit = await cache.match(asset);
    if (!hit || !hit.ok) return false;
  }
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'rechenkoenig-cache-status') return;
  const source = event.source;
  event.waitUntil((async () => {
    let ready = false;
    try {
      ready = await cacheReady();
    } catch {
      ready = false;
    }
    source?.postMessage({ type: 'rechenkoenig-cache-status', ready });
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.registration.scope)) return;
  if (new URL(request.url).pathname.endsWith('/sw.js')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return fetch(request);
  })());
});
