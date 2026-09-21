/* Kerbside service worker.
 *
 * Two jobs. The first is to make the app installable at all: Chrome will not offer an install
 * prompt for a page with no service worker handling fetches, so without this file the Android
 * button has nothing to call. The second is to let the app open with no signal, which matters
 * because the places worth surveying are often the places with no bars.
 *
 * Strategy is network-first for documents and data and cache-first for the static shell. A redeploy has
 * to be picked up immediately -- an app that keeps serving last week's build from cache is a bug
 * that looks like a working app -- while icons and the manifest never change within a version.
 */
const VERSION = "d3fe6462de04ea24";
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

async function reportFull3d(source, detail) {
  const message = { type: "CACHE_FULL_3D_PROGRESS", ...detail };
  if (source && typeof source.postMessage === "function") {
    source.postMessage(message);
    return;
  }
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== "CACHE_FULL_3D") return;

  event.waitUntil((async () => {
    try {
      const manifestUrl = new URL("./sf-corridor-detail-manifest.json", self.registration.scope);
      const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
      if (!manifestResponse.ok) throw new Error(`detail manifest returned ${manifestResponse.status}`);
      const manifest = await manifestResponse.clone().json();
      const assets = [...new Set([
        "sf-corridor-detail-manifest.json",
        ...(Array.isArray(manifest.offline_assets) ? manifest.offline_assets : []),
      ])];
      const cache = await caches.open(CACHE);
      let done = 0;
      let failed = 0;
      let bytes = 0;

      await cache.put(manifestUrl, manifestResponse.clone());
      for (const asset of assets) {
        const assetUrl = new URL(asset, self.registration.scope);
        try {
          const response = asset === "sf-corridor-detail-manifest.json"
            ? manifestResponse.clone()
            : await fetch(assetUrl, { cache: "no-store" });
          if (!response.ok) throw new Error(`${response.status}`);
          const length = Number(response.headers.get("content-length"));
          if (Number.isFinite(length)) bytes += length;
          await cache.put(assetUrl, response);
          done += 1;
        } catch (error) {
          failed += 1;
        }
        await reportFull3d(event.source, {
          state: "progress",
          done,
          failed,
          total: assets.length,
          bytes,
          file: asset,
        });
      }

      await reportFull3d(event.source, {
        state: failed ? "partial" : "complete",
        done,
        failed,
        total: assets.length,
        bytes,
      });
    } catch (error) {
      await reportFull3d(event.source, {
        state: "error",
        error: `Full 3D download failed: ${error && error.message ? error.message : "network or storage error"}.`,
      });
    }
  })());
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
