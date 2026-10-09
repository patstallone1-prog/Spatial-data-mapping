/* Kerbside service worker.
 * Keeps the installed app shell launchable without a connection. The 3D world
 * streams on demand, from the network, and is never stored here.
 */
const VERSION = "73d83e54886b8e82";
const CACHE = "kerbside-shell-" + VERSION;
const SHELL = [
  "./app.html",
  "./app-model.html",
  "./app-regions.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];
const SHELL_PATHS = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));
const isOldRuntimeCache = key => /^kerbside-[0-9a-f]{16}$/.test(key);

// Read-only diagnostics for installed-app upgrades. Never expose captures or URLs.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "KERBSIDE_CACHE_STATUS" || !event.ports?.[0]) return;
  event.waitUntil(caches.keys().then((keys) => event.ports[0].postMessage({
    version: VERSION, policy: "shell-only", cache: CACHE,
    obsoleteWorldCaches: keys.filter(isOldRuntimeCache).length,
  })));
});

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE
        && (isOldRuntimeCache(k) || k.startsWith("kerbside-shell-")))
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Only the shell is kept, and only so the installed app opens with no signal. Everything else
  // -- the payload, the ground, the cells, the tiles, the textures -- comes from the network and
  // is never stored here. The previous policy cloned raw responses for storage while the page
  // parsed them, adding I/O and possible transient buffering (not a second decoded 3D scene).
  // Those raw files were retained between visits and differed across installations. A
  // page could be served a stale tile or texture from it after the site had changed (the
  // version below fingerprints the app's files, not the tiles), and nothing would say so.
  const shell = SHELL_PATHS.has(url.pathname);
  // Canonical keys keep ?from=home, ?at=... and version queries from growing the cache.
  const key = new URL(url.href);
  key.search = "";
  if (!shell && request.mode !== "navigate") return;
  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (shell && response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(key.href, copy)).catch(() => {}));
        }
        return response;
      })
      // Off the network: the shell from the cache, and a navigation with nothing cached gets the
      // app, which can open with no signal.
      .catch(async () => {
        // Never search legacy data caches. A regional model must not receive app.html,
        // which silently launches a nested app/iframe and can consume another world.
        const cache = await caches.open(CACHE);
        const hit = shell && await cache.match(key.href);
        if (hit) return hit;
        if (request.mode === "navigate" && !url.pathname.endsWith("app-model.html")) {
          const app = await cache.match(new URL("./app.html", self.registration.scope).href);
          if (app) return app;
        }
        return new Response("Map data needs a network connection. Please reconnect and retry.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      })
  );
});
