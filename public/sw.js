const CACHE = "open-wardrobe-shell-v1";
const IMAGE_CACHE = "wardrobe-images-v1";
const ACTIVE_CACHES = new Set([CACHE, IMAGE_CACHE]);
const MAX_IMAGE_ENTRIES = 800;
const SHELL = ["/", "/manifest.webmanifest"];

async function trimImageCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_IMAGE_ENTRIES;
  if (overflow > 0) await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => !ACTIVE_CACHES.has(key)).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Library assets are immutable (served max-age=31536000, immutable) — cache-first,
  // no revalidation needed. Job-in-progress assets are excluded: they're no-store because
  // a regenerate can replace them under the same URL.
  if (url.pathname.startsWith("/api/import/library/")) {
    event.respondWith(caches.open(IMAGE_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
        trimImageCache(cache);
      }
      return response;
    }));
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
  }
});
