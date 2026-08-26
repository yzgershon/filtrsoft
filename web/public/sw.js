/**
 * Service worker — the piece that makes Chrome offer INSTALL rather than
 * "Add shortcut to home screen".
 *
 * A manifest alone is not enough: Chrome's install criteria require a service
 * worker with a `fetch` handler, served over HTTPS. Assyze had neither, which
 * is why every other app in this repo installs and this one did not.
 *
 * TWO CACHES, TWO STRATEGIES, and the split matters:
 *
 *   · The APP SHELL is cache-first. It is versioned and immutable, so serving
 *     it from disk is both faster and correct.
 *   · The API is NETWORK-FIRST with a cache fallback. A deals feed that
 *     silently served yesterday's prices from cache would be worse than
 *     showing nothing — the whole product is "is this listing worth it right
 *     now". Cached responses are a courtesy for a dead train tunnel, never the
 *     preferred answer.
 *
 * Listing PHOTOS are cache-first with a hard cap: they are immutable at their
 * URL and re-downloading them on every scroll is the single biggest data cost
 * on a phone.
 */
const VERSION = "assyze-v1";
const SHELL = `${VERSION}-shell`;
const API = `${VERSION}-api`;
const IMGS = `${VERSION}-img`;
const MAX_IMGS = 160;

const SHELL_URLS = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  // `addAll` rejects the whole install if ANY url 404s, which would leave the
  // app permanently uninstallable. Each is added independently.
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.allSettled(SHELL_URLS.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  // Oldest first — `keys()` preserves insertion order.
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // ---- API: network first, cache only as a fallback -----------------------
  if (url.origin === self.location.origin && url.pathname.startsWith("/v1/")) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) (await caches.open(API)).put(request, res.clone());
        return res;
      } catch {
        const hit = await caches.match(request);
        if (hit) return hit;
        return new Response(
          JSON.stringify({ error: "offline", offline: true }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
    })());
    return;
  }

  // ---- listing photos: cache first, capped --------------------------------
  if (request.destination === "image") {
    e.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok || res.type === "opaque") {
          const c = await caches.open(IMGS);
          await c.put(request, res.clone());
          trim(IMGS, MAX_IMGS);
        }
        return res;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  // ---- navigations: network first so a deploy is picked up immediately ----
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(async () =>
        (await caches.match("/index.html")) ?? (await caches.match("/")) ?? Response.error()),
    );
    return;
  }

  // ---- everything else (hashed JS/CSS): cache first -----------------------
  e.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok && url.origin === self.location.origin) {
      (await caches.open(SHELL)).put(request, res.clone());
    }
    return res;
  })());
});
