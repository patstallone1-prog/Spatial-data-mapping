/* Kerbside service worker.
 * Keeps the installed app shell launchable without a connection. The 3D world
 * streams on demand.
 * Documents and data are network-first so fresh geometry is never hidden by
 * an older cached copy.
 */
const VERSION = "f9cdbbe787f6509a";
const CACHE = "kerbside-" + VERSION;
const SHELL = [
  "./app.html",
  "./app-model.html",
  "./app-regions.json",
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data is not shell. The 3D map's payload is rebuilt every time the catalogue grows, and
  // serving it cache-first meant the page could load this week's code against last week's
  // observations -- new layers reading fields that were not in the JSON they got, and no error
  // anywhere to say so. Documents and data go to the network first and fall back to the cache;
  // only the shell, which does not change within a version, is served from cache first.
  const isDocument = request.mode === "navigate" || url.pathname.endsWith(".html")
    || url.pathname.endsWith(".json");

  if (isDocument) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        // Off the network: the cached copy if there is one. A navigation with nothing cached
        // gets the app shell, which can open with no signal; a data request gets an honest
        // failure -- handing a page's JSON fetch the app's HTML gave it "Unexpected token '<'"
        // in place of the truth, which is that the file could not be fetched.
        .catch(() => caches.match(request).then((hit) => {
          if (hit) return hit;
          if (request.mode === "navigate") return caches.match("./app.html");
          return new Response(JSON.stringify({ error: "offline", url: url.pathname }),
                              { status: 503, headers: { "Content-Type": "application/json" } });
        }))
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
