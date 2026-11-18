/* NavNet service worker — makes the app usable with no network.
 *  • Map tiles  (any …/z/x/y.png): cache-first from "navnet-tiles" (filled by the
 *    "Download offline map" button and by normal browsing).
 *  • App shell  (HTML/JS/CSS/fonts): network-first, falls back to cache when offline.
 *  • Trip data  (GET /api/trips/:id, /messages): network-first, cached copy when offline.
 * Writes (POST/PATCH) and Socket.IO are never cached; the app queues them itself.
 */
const APP = "navnet-app-v3";
const TILES = "navnet-tiles";
const API = "navnet-api-v1";
const TILE_RE = /\/\d+\/\d+\/\d+(@2x)?\.png$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(["/", "/favicon.svg", "/manifest.webmanifest"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("navnet-app-") && k !== APP).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function tileFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") cache.put(req.url, res.clone());
    return res;
  } catch {
    // Offline and never downloaded: a transparent tile keeps the map usable (route + markers still draw).
    return new Response(
      Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0)),
      { headers: { "Content-Type": "image/png" } },
    );
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      const shell = await caches.open(APP).then((c) => c.match("/"));
      if (shell) return shell;
    }
    return new Response(JSON.stringify({ success: false, error: { message: "You're offline" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/socket.io")) return;

  if (TILE_RE.test(url.pathname)) return e.respondWith(tileFirst(req));
  if (url.pathname.startsWith("/api/")) {
    // Only trip snapshots / messages are worth having offline; never cache auth or geo search.
    if (/^\/api\/trips\/[^/]+(\/(messages|pois|expenses))?$/.test(url.pathname) || url.pathname === "/api/trips/joined") {
      return e.respondWith(networkFirst(req, API));
    }
    return;
  }
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") return e.respondWith(networkFirst(new Request("/"), APP));
    return e.respondWith(networkFirst(req, APP));
  }
});
