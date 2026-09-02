/* Kerbside service worker.
 *
 * Two jobs. The first is to make the app installable at all: Chrome will not offer an install
 * prompt for a page with no service worker handling fetches, so without this file the Android
 * button has nothing to call. The second is to let the app open with no signal, which matters
 * because the places worth surveying are often the places with no bars.
 *
 * Strategy is network-first for documents and cache-first for the static shell. A redeploy has
 * to be picked up immediately -- an app that keeps serving last week's build from cache is a bug
 * that looks like a working app -- while icons and the manifest never change within a version.
 */
const VERSION = "__VERSION__";
const CACHE = "kerbside-" + VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Individually, not addAll: one missing file must not leave the whole shell uncached.
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = request.mode === "navigate" || url.pathname.endsWith(".html");

  if (isDocument) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./app.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) =>
      hit ||
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
    )
  );
});
