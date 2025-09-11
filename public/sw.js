/* Simple SW: cache básico + offline */
const CACHE = 'fj-cache-v1';

// Ajusta la lista a lo que tu app necesita en producción
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png'
];

// Precarga
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Limpia caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estrategia:
// - Navegación (HTML): network-first con fallback a cache
// - Estáticos (mismo origen): cache-first con revalidación
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo GET
  if (req.method !== 'GET') return;

  // Navegaciones -> network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Misma-origen estáticos -> cache-first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((netRes) => {
          caches.open(CACHE).then((c) => c.put(req, netRes.clone()));
          return netRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
