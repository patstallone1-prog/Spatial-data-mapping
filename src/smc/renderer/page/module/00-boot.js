import * as THREE from "https://esm.sh/three@0.160.0";
//: Muni's red: the roof of every shelter and of every station canopy. Up here because the
//: stops are built from a fetch that can land while the module is still running.
const STOP_ROOF_RED = 0xb4282e;
// Where the payload, the official geometry, the detail shards and the facade photographs
// are served from. Empty means beside this page (GitHub Pages); tools/build_pages.py sets it
// to an object-storage origin when the assets are published there instead, so the page in
// git stays small and the data lives where a city's worth of it can.
// One world, many regions: this same code runs again, in the same page, for every region the
// walker goes to (attachRegion, below). Run that way -- "attached" -- it is handed the page's
// renderer and its region's asset folder, builds its region's world into a group the page places
// in its own scene, and draws nothing, listens to nothing and shows nothing of its own; its
// document and window are stand-ins the page gives it (see guestSource).
const ATTACH = globalThis.__kerbsideGuest || null;
//: The headset version (docs/meta.html; docs/meta-xr.mjs): first person only, always noon, a
//: short view, and only the few blocks round you built and held, inside a memory budget.
const META = !ATTACH && document.querySelector('meta[name="kerbside-mode"]')?.content === "meta";
//: Built for the headset: the page in headset mode, or a square it is building. The ground is cut
//: coarser, only the fences in the square are made, and the grass has no blades -- a Quest 3
//: draws about a million triangles a frame at its frame rate; a square built for a desktop
//: is three.
const HEADSET = META || Boolean(ATTACH?.headset);
//: The headset's materials: one plain lit surface each (Lambert), its colour the colour its
//: picture averaged to. A house's walls, the streets and the pavements were each a photograph
//: or a painted texture with its relief and its gloss, lit by the sky's reflection -- more than
//: the headset could draw. A cut-out (a leaf, a decal with see-through parts) keeps its
//: picture: without it a leaf is a square. (A cut-out by its picture's own alpha: a tile is
//: transparent only to fade in.) Changed where it stands, so whatever holds a material -- a
//: fade, a door, a clip into the detail window -- holds the same one.
const HEADSET_AVERAGES = new WeakMap();
//: A picture whose least opaque sample is below this has see-through parts, and is kept.
const HEADSET_CUTOUT_ALPHA = 0.97;
function headsetAverage(texture) {
  // { colour, alpha (the least opaque sample) }, or null while it cannot be read.
  if (HEADSET_AVERAGES.has(texture)) return HEADSET_AVERAGES.get(texture);
  let found = null;
  try {
    const image = texture.image, space = texture.colorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    let r = 0, g = 0, b = 0, alpha = 1, n = 0;
    if (image?.data && image.width) {
      const d = image.data, unit = d instanceof Uint8Array || d instanceof Uint8ClampedArray ? 255 : 1;
      const stride = (d.length / (image.width * image.height)) | 0 || 4;
      const step = Math.max(1, Math.floor(image.width * image.height / 4096)) * stride;
      for (let i = 0; i + 2 < d.length; i += step) {
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n += 1;
        if (stride >= 4) alpha = Math.min(alpha, d[i + 3] / unit);
      }
      if (n) found = { colour: new THREE.Color().setRGB(r / n / unit, g / n / unit, b / n / unit, space), alpha };
    } else if (image && (image.naturalWidth || image.width)) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, 8, 8);
      const d = context.getImageData(0, 0, 8, 8).data;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; alpha = Math.min(alpha, d[i + 3] / 255); n += 1; }
      found = { colour: new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, space), alpha };
    }
  } catch (error) { found = null; }   // not loaded yet, or not readable: tried again next pass
  if (found) HEADSET_AVERAGES.set(texture, found);
  return found;
}
const HEADSET_DROPPED_MAPS = ["normalMap", "roughnessMap", "metalnessMap", "aoMap", "bumpMap", "displacementMap",
  "lightMap", "envMap", "emissiveMap"];
const headsetStats = { materials: 0, flattened: 0 };
function headsetSimplify(object) {
  object.traverse((o) => {
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      const fresh = m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial;
      if (!fresh && !m.userData.headsetPlain) continue;
      let changed = fresh;
      // (A picture loaded later -- the bark's grain -- is flattened when the next pass finds it.)
      if (m.map && !(m.alphaTest > 0) && !m.alphaMap) {
        const picture = headsetAverage(m.map);
        if (picture && picture.alpha >= HEADSET_CUTOUT_ALPHA) {
          m.color.multiply(picture.colour); m.map = null; changed = true; headsetStats.flattened += 1;
        } else if (!picture && HEADSET_PENDING) {
          // Not loaded yet: drawn plain until it is (headsetSettlePictures), rather than drawn
          // in full until a pass finds it -- the house that came up textured and then went flat.
          HEADSET_PENDING.set(m, m.map); m.map = null; changed = true;
        }
      }
      for (const key of HEADSET_DROPPED_MAPS) if (m[key]) { m[key] = null; changed = true; }
      if (!changed) continue;
      if (fresh) {
        // The page's own Standard material, drawn with three's Lambert program: the same
        // colour, opacity, sides, depth and stencil, and the same shader additions.
        m.type = "MeshLambertMaterial";
        m.isMeshStandardMaterial = false;
        m.isMeshLambertMaterial = true;
        m.userData.headsetPlain = true;
        headsetStats.materials += 1;
      }
      m.needsUpdate = true;
    }
  });
}
//: Materials whose picture had not loaded when they were made plain, with the picture: once it
//: has, an opaque one gives its colour and a see-through one (a leaf, a decal) goes back on.
//: One list for the page and every square it builds (kept on three's Object3D, which they
//: share), settled by the page's frame.
const HEADSET_PENDING = HEADSET ? (THREE.Object3D.prototype.kerbsideHeadsetPending ??= new Map()) : null;
function headsetSettlePictures() {
  for (const [m, map] of HEADSET_PENDING || []) {
    const picture = headsetAverage(map);
    if (!picture) continue;
    HEADSET_PENDING.delete(m);
    if (picture.alpha >= HEADSET_CUTOUT_ALPHA) { m.color.multiply(picture.colour); headsetStats.flattened += 1; }
    else m.map = map;
    m.needsUpdate = true;
  }
}
//: Made plain as it is put in the scene, not on the next pass: drawn once in full, a material
//: was a second shader program and an uploaded picture for nothing, and it showed -- the world
//: came up in full and then went plain, a house at a time. (Once, on three's own Object3D,
//: which the squares built for the headset share.)
if (HEADSET && !THREE.Object3D.prototype.kerbsideHeadsetAdd) {
  const add = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function headsetAdd(...objects) {
    const result = add.apply(this, objects);
    for (const object of objects) if (object?.isObject3D) headsetSimplify(object);
    return result;
  };
  THREE.Object3D.prototype.kerbsideHeadsetAdd = true;
}
//: With no sky reflection on a plain surface, the shade side of a street was nearly black: the
//: headset's own fill light makes up the light the reflection gave.
const HEADSET_FILL = { colour: 0xe8eef5, intensity: 1.3 };

const WORLD_BUILD_STARTED=performance.now();
//: The region drawn in full besides this page's own, once the walker has gone there; whether this
//: page's own world is still drawn; and the built regions, from the page's region index.
let activeGuest = null;
let hostWorldActive = true;
let regionStreamingReady = false;
let attaching = null, attachWanted = null, detailRetryAt=0, detailCheckAt=0, detailPreviousFocus=null, detailPreviousAt=0;
const REGION_INDEX = { list: [], root: "", host: null };
const ASSET_BASE = ATTACH ? ATTACH.assets
  : (document.querySelector('meta[name="kerbside-assets"]') || {}).content || "";
//: Where each data file is kept: an immutable, content-named copy in the object store
//: (tools/publish_chunks.py writes the map), or -- for anything not in the map, or with no map --
//: the site itself. The page and its code stay on the site; the city's data does not have to.
//: A file in the object store is named by its content (tools/publish_chunks.py): it never changes,
//: so the browser's copy is used as it is, without asking the store again whether it is still
//: current -- a round trip for every tile and every file of a square, each time it is built.
//: Everything else (the site's own files, which a deploy replaces) is still revalidated.
const IMMUTABLE_CHUNK = /\/chunks\/[0-9a-f]{24}\.[a-z0-9]+$/;
const fetch = (input, init) => (IMMUTABLE_CHUNK.test(String(input?.url ?? input))
  ? globalThis.fetch(input, { ...init, cache: "force-cache" }) : globalThis.fetch(input, init));
//: Fetched and parsed once for the page and every window attached to it. 435,000 names, 46 MB
//: of JSON: each window ran this line again, parsed it again (0.2-0.3 s) and kept its own copy
//: (85 MB) for as long as the page was open -- a window's code is never unloaded -- so twelve
//: jumps held a gigabyte of the same map (measured 2026-11-05). It is only ever read.
const ASSET_MAP = await (globalThis.__kerbsideAssetMap ??= fetch("/asset-map.json", { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : null)).catch(() => null));
function viaStore(href) {
  const files = ASSET_MAP?.files;
  if (!files || !ASSET_MAP.base) return href;
  // Only for a page whose origin the store's CORS lets read it; previews and local
  // servers on other ports keep reading the site's own copies.
  const origins = ASSET_MAP.origins;
  if (origins && !origins.includes("*") && !origins.includes(location.origin)) return href;
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return href;
  const object = files[url.pathname.replace(/^\/+/, "")];
  return object ? `${ASSET_MAP.base.replace(/\/+$/, "")}/${object}` : href;
}
const asset = (name) => viaStore(ASSET_BASE ? `${ASSET_BASE.replace(/\/+$/, "")}/${name}` : name);
const sharedAsset = (name) => viaStore(new URL(name, new URL(
  document.querySelector('meta[name="kerbside-regions"]')?.content || "regions.json", location.href)).href);
//: This device's account (docs/kerbside-account.mjs): who is editing, and whether verified.
let accountModule = null;
const accountLibrary = () => (accountModule ??= import(sharedAsset("kerbside-account.mjs?rev=__KERBSIDE_ACCOUNT_HASH__")));
// ---- the home screen ---------------------------------------------------------------------------
//
// The app opens on its home screen (docs/home-lobby.mjs) while the world loads behind it: your
// avatar, your party, and Explore world. A link that already says where to go -- a place (?at=),
// an invitation (?room=), a walk on from another region -- goes straight in.
let homeModule = null;
//: The walker's model: the home screen shows it on its platform before the world is built.
const WALKER_MODEL_URL = "https://threejs.org/examples/models/gltf/Soldier.glb";
const homeLibrary = () => (homeModule ??= import(sharedAsset("home-lobby.mjs?rev=__HOME_LOBBY_HASH__")));
//: The avatar creator's figures (docs/avatar-builder.mjs): MakeHuman bodies and parts kept in
//: the store under avatars/, shared by the home screen's creator and the walker.
let avatarBuilderModule = null;
const avatarBuilder = () => (avatarBuilderModule ??= import(sharedAsset("avatar-builder.mjs?rev=__AVATAR_BUILDER_HASH__"))
  .then((m) => m.createAvatarBuilder({ THREE, GLTFLoader, base: new URL("avatars", storeInteriorBase() || new URL("/store/", location.href)).href }))
  .catch((error) => { avatarBuilderModule = null; throw error; }));
let worldIsReady = null, pageIsReady = null;
//: Settled with the first frame drawn and the page's own code all run (the first frame can come
//: before the module has reached its end): what the home screen's buttons wait for.
const WORLD_READY = Promise.all([new Promise((resolve) => { worldIsReady = resolve; }),
                                 new Promise((resolve) => { pageIsReady = resolve; })]);
//: Loaded through, not merely drawn: resolved once everything round the spawn is fetched, built
//: and held still for a moment (the check is at the end of the page). The home screen, opened
//: well before that, waits on it.
let worldLoaded = null, worldLoadedNow = false;
const WORLD_LOADED = new Promise((resolve) => { worldLoaded = resolve; });
//: The loading screen's bar, 0..1, never back. Up to the first frame (0.8 of it) the build's own
//: progress line, read against its stages as long as each took on an app boot (2026-11-03: 31 s
//: to the first frame -- the fetch 9 s, the streets 4, standing them and the ground cover on the
//: hill 14, the paint 4), creeping on through a stage that gives no figure; then the share of
//: what was still coming in round the spawn. Declared here, before the home screen opens: read
//: from state declared at the page's end it threw until the build got there, and the bar sat
//: still for the whole build and then jumped.
const BOOT_STAGES = [[/^Loading/, 0, 0.23, 9], [/^Building the streets/, 0.23, 0.33, 4],
  [/^Standing the/, 0.33, 0.70, 14], [/^(Setting|Painting)/, 0.70, 0.80, 4]];
const bootLoad = { shown: 0, stage: 0, since: performance.now(), figure: 0, peak: 0, readyAt: 0, at: performance.now() };
function loadFraction() {
  if (worldLoadedNow) return 1;
  const now = performance.now();
  const ease = (seconds, expected) => 1 - Math.exp(-seconds / Math.max(1, expected));
  let target;
  if (!worldReadyNow) {
    const line = document.getElementById("progress")?.textContent?.trim() || "";
    const found = BOOT_STAGES.findIndex(([re]) => re.test(line));
    if (found > bootLoad.stage) { bootLoad.stage = found; bootLoad.since = now; bootLoad.figure = 0; }
    if (found === bootLoad.stage) bootLoad.figure = Math.max(bootLoad.figure, Number(line.match(/(\d+)\s*%/)?.[1] || 0) / 100);
    const [, from, to, expected] = BOOT_STAGES[bootLoad.stage];
    const within = Math.max(bootLoad.figure, 0.95 * ease((now - bootLoad.since) / 1000, expected));
    target = from + (to - from) * Math.min(1, within);
  } else {
    bootLoad.readyAt ||= now;
    const left = worldLoadWaiting().reduce((n, item) => n + (Number(item.match(/\((\d+)/)?.[1]) || 1), 0);
    bootLoad.peak = Math.max(bootLoad.peak, left);
    const within = Math.max(1 - left / Math.max(1, bootLoad.peak), 0.9 * ease((now - bootLoad.readyAt) / 1000, 6));
    target = 0.8 + 0.2 * Math.min(0.99, within);
  }
  // A stage that comes early, or a figure that leaps, is taken at a pace: never more than 15% a second.
  const rise = 0.15 * Math.max(0, now - bootLoad.at) / 1000;
  bootLoad.at = now;
  return bootLoad.shown = Math.max(bootLoad.shown, Math.min(target, bootLoad.shown + rise));
}
window.kerbsideLoadFraction = loadFraction;
const HOME_SKIPPED = META || ATTACH || (() => {
  try {
    const query = new URLSearchParams(location.search);
    return query.get("home") === "0" || query.has("at") || query.has("room") || query.has("inspect")
      || Boolean(sessionStorage.getItem("kerbside:region-arrival")) || Boolean(sessionStorage.getItem("kerbside:meta-resume"));
  } catch { return false; }
})();
//: Contributor tools (the survey layers, the region's numbers, capture) are off unless turned on.
const CONTRIBUTOR_KEY = "kerbside:contributor";
let contributorMode = (() => { try { return localStorage.getItem(CONTRIBUTOR_KEY) === "1"; } catch { return false; } })();
document.body.classList.toggle("contributor", contributorMode);
if (!HOME_SKIPPED) Promise.all([homeLibrary(), accountLibrary().catch(() => null)])
  .then(([home, account]) => home.openHome({ ...homeContext(), account }))
  .catch((error) => console.warn("Home screen failed to load", error));
const worldStreaming = await import(sharedAsset("world-streaming.mjs?rev=__WORLD_STREAMING_HASH__"));
//: How much of the world is held, and how wide a square is built in full round the walker. A
//: desktop or laptop (not a phone or a tablet, and 8 GB or more where the browser says) builds an
//: 800 m square, keeps 384 MiB of cells so a rebuild reuses what the last one fetched, and keeps
//: 320 MiB of the simple city resident; a small device keeps the 700 m square and 48 MiB it had.
//: Wider is not better: a 900 m square took 17.5 s to build round Pacific Heights, a 700 m one
//: 7 s, and a walker who arrives before the build is on the simple city all that while. An
//: arrival after a jump is built small (220 m) so the block underfoot comes first.
const metaLibrary = META ? await import(sharedAsset("meta-xr.mjs?rev=__META_XR_HASH__")) : null;
const STREAM = META ? { ...metaLibrary.META_STREAM } : (!deviceIsSmall() && !(navigator.deviceMemory && navigator.deviceMemory < 8))
  // The square is the size the app's first build is (LIGHT_RADII_M[2]): a wider one here had the
  // streaming throw the first world away and build it all again 50 m wider the moment it was
  // drawn -- half a minute's work and a ten-second freeze, with nobody having moved.
  // The lead no more than the square less `keep`: a walker who stops is still inside the
  // keep line from every side, and is not built round again for standing still.
  ? { radius: 350, arrival: 220, keep: 270, lead: 80, cellBytes: 384 * 1048576, cellConcurrency: 8, tileBytes: 320 * 1048576 }
  : { ...worldStreaming.DETAIL_SMALL, cellBytes: 48 * 1048576, cellConcurrency: 4, tileBytes: 48 * 1048576 };
const worldCellCache = ATTACH?.cellCache
  || new worldStreaming.CellCache({ maxBytes: STREAM.cellBytes, concurrency: STREAM.cellConcurrency });
window.kerbsideStreaming = () => worldCellCache.snapshot();
// One shared landscape for host and attached regions; failure retains the older backdrop.
const natureLibrary = ATTACH ? null : await import(sharedAsset("nature-runtime.mjs?rev=__NATURE_RUNTIME_HASH__"))
  .catch(error => { console.warn("kerbside: landscape runtime unavailable", error); return null; });
const vegetationLibrary = await import(sharedAsset("vegetation-geometry.mjs"))
  .catch(error => { console.warn("kerbside: tree wall clipping unavailable",error);return null; });
//: The near forest floor's scanned plants, leaves and grass (docs/forest-floor.mjs), and the
//: globe the view zooms out to (docs/globe.mjs). Without either the landscape stands as it was.
const forestFloorLibrary = natureLibrary ? await import(sharedAsset("forest-floor.mjs?rev=__FOREST_FLOOR_HASH__"))
  .catch(error => { console.warn("kerbside: forest floor unavailable", error); return null; }) : null;
const globeLibrary = natureLibrary ? await import(sharedAsset("globe.mjs?rev=__GLOBE_HASH__"))
  .catch(error => { console.warn("kerbside: globe unavailable", error); return null; }) : null;
var globe = null;
// No hop animation on a long move (it was docs/teleport-map.mjs: the camera pulled up into black,
// a map played the hop, and the camera came back down). A click goes there at once; the new
// place streams in round you.
const NATURE = natureLibrary ? await natureLibrary.loadNatureAtlas(sharedAsset)
  .catch(error => { console.warn("kerbside: landscape evidence unavailable", error); return null; }) : null;
var natureWorld = null;
const grassLibrary = await import(sharedAsset("grass-strands.mjs?rev=__GRASS_STRANDS_HASH__"))
  .catch(error=>{console.warn("kerbside: grass strands unavailable; retaining textured turf",error);return null;});
var grassStrands = null;
var grassSurfaceAt = null;
//: Where grass grows on this page's ground: off every path, wall, road, building and water.
var grassSampleAt = null;
//: Wind in the trees and shrubs, grass parted underfoot (docs/foliage-motion.mjs): one for this
//: page's own plants, in its own coordinates, and one for the landscape's.
const foliageLibrary = await import(sharedAsset("foliage-motion.mjs?rev=__FOLIAGE_MOTION_HASH__"))
  .catch(error=>{console.warn("kerbside: foliage motion unavailable; plants stand still",error);return null;});
const foliageMotion = foliageLibrary?.createFoliageMotion(THREE) || null;
//: What each drawn thing is made of, how it breaks and how the walker passes it
//: (docs/object-catalogue.mjs over docs/object-catalogue.json). Without it only the buildings,
//: tunnels and the forest's logs stop the walker, as before.
const objectCatalogueReady = ATTACH ? Promise.resolve(null) : Promise.all([
  import(sharedAsset("object-catalogue.mjs?rev=__OBJECT_CATALOGUE_HASH__")),
  fetch(sharedAsset("object-catalogue.json?rev=__OBJECT_CATALOGUE_DATA_HASH__"))
    .then((r) => r.ok ? r.json() : Promise.reject(new Error(`object catalogue: ${r.status}`))),
]).then(([library, data]) => ({ library, catalogue: library.createCatalogue(data) }))
  .catch((error) => { console.warn("kerbside: object catalogue unavailable; only buildings and logs stop the walker", error); return null; });
const natureMotion = foliageLibrary && !ATTACH ? foliageLibrary.createFoliageMotion(THREE) : null;
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

// Curb returns and bulb-outs are part of the base street geometry, not merely a comparison
// overlay.  Load the compact official sidecar before laying out crossings; a network failure
// still leaves the renderer's local-road-width fallback available.
const EMPTY_DETAIL_MANIFEST = { shards: [], offline_assets: [] };
const EMPTY_WORLD_OBJECTS = { objects: [] };
const VISUAL_SUPPORT_URL = ATTACH ? ATTACH.visualSupport || ""
  : (document.querySelector('meta[name="kerbside-visual-support"]') || {}).content || "";
// ---- the lighter build, for a device that cannot hold the whole region -------------------------
//
// Built whole, the corridor is twelve square kilometres of kerbs, footways, buildings and ground:
// about three gigabytes while it builds and two after. A phone or a small laptop cannot hold
// that; the browser kills the page and loads it again, and it builds again, and is killed again
// -- the page "loading, showing its first frame, failing and reloading". Nothing here depends on
// the computer it was made on; it is the size.
//
// So a page on such a device builds the square round the walker in full, and the city's tile
// tree -- the simple, streamed model of every region -- draws the rest; going further than the
// square builds the square round the new place. It fetches only the 500 m cells of each large
// file that the square touches (tools/build_window_cells.py): parsing the whole files first was
// a gigabyte and a half on its own. A page that dies while it loads (a mark is left in storage as
// it starts and taken away once it has drawn and held for half a minute) loads lighter next
// time, a step at a time, whatever the device said about itself -- for a day, not for good. A
// computer that once ran short (swap full, the tab discarded while it built) is not small; held
// for good, one bad hour kept a Mac on the smallest square for every visit after.
const LOAD_MARK_KEY = "kerbside:loading";
//: The size chosen in the settings: kept until it is chosen again.
const LIGHT_KEY = "kerbside:world";
//: The size a load that died stepped down to, and when: held for RECOVERY_HOLD_MS.
const RECOVERY_KEY = "kerbside:world-recovery";
const RECOVERY_HOLD_MS = 24 * 60 * 60 * 1000;
//: The key that held both, a choice and a step down, with no way to tell them apart.
const RETIRED_LIGHT_KEY = "kerbside:light";
//: Half the side of the square built in full, by level: 0 is the whole region.
const LIGHT_RADII_M = [0, 650, 350, 220];
let runtimeCacheRecovery = Promise.resolve();
function clearLegacyRuntimeCaches() {
  if (typeof caches === "undefined") return Promise.resolve();
  // Only obsolete downloadable world responses. Captures in IndexedDB, preferences and
  // unrelated application caches are not recovery targets; the current shell remains usable.
  return caches.keys().then(keys => Promise.all(keys.filter(key => /^kerbside-[0-9a-f]{16}$/.test(key))
    .map(key => caches.delete(key)))).catch(() => {});
}
function validLightLevel(value, fallback = 0) {
  const n = Number(value);
  return value !== null && value !== "" && Number.isFinite(n)
    ? Math.max(0, Math.min(LIGHT_RADII_M.length - 1, Math.floor(n))) : fallback;
}
//: Under 8 GB of memory (Chrome reports it), or a phone or a tablet.
function deviceIsSmall() {
  return (typeof navigator !== "undefined")
    && ((navigator.deviceMemory && navigator.deviceMemory < 8)
        || /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent || "")
        || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || "")));
}
const LIGHT_LEVEL = (() => {
  if (ATTACH) return ATTACH.detailWindow ? 1 : 0;
  // A choice made in the settings stands; otherwise the device's own say. Either way a load
  // that died takes the next one a step lighter, and the step holds for a day.
  let level = document.querySelector('meta[name="kerbside-app-mode"]') ? 2 : (deviceIsSmall() ? 1 : 0);
  try {
    localStorage.removeItem(RETIRED_LIGHT_KEY);
    const chosen = localStorage.getItem(LIGHT_KEY);
    level = validLightLevel(chosen, level);
    const held = JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null");
    const age = held && Date.now() - held.at;
    if (held && Number.isFinite(age) && age >= 0 && age < RECOVERY_HOLD_MS) level = Math.max(level, validLightLevel(held.level));
    else if (held) localStorage.removeItem(RECOVERY_KEY);
  } catch (error) { /* preferences may be unavailable */ }
  // Retire a legacy persisted whole-city choice in installed apps: returning
  // visitors must get bounded streaming too, not another multi-GB reload loop.
  // Explicit ?full remains available to geometry exports and full-world audits.
  if (document.querySelector('meta[name="kerbside-app-mode"]') && level === 0) level = 2;
  const query = new URLSearchParams(location.search);
  if (query.has("full")) level = 0;
  if (query.has("light")) level = validLightLevel(query.get("light"), 1);
  try {
    // Session storage is per tab, so another open map does not look like a crashed load.
    const mark = JSON.parse(sessionStorage.getItem(LOAD_MARK_KEY) || "null");
    const age = mark && Date.now() - mark.at;
    if (mark && Number.isFinite(age) && age >= 0 && age < 15 * 60 * 1000) {
      level = Math.min(LIGHT_RADII_M.length - 1, Math.max(level, validLightLevel(mark.level)) + 1);
      try { localStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: Date.now(), level })); } catch (error) { /* this tab still recovers */ }
      runtimeCacheRecovery = clearLegacyRuntimeCaches();
    }
  } catch (error) { /* without storage, the device's own say is all there is */ }
  return level;
})();
await runtimeCacheRecovery; // recovery completes before a single world response is requested
if (!ATTACH) {
  try { sessionStorage.setItem(LOAD_MARK_KEY, JSON.stringify({ at: Date.now(), level: LIGHT_LEVEL })); }
  catch (error) { /* no mark: a crash goes unnoticed, and the device's own say stands */ }
}
// A deliberate reload, normal close or region handover is not a renderer crash.
function clearLoadMark() {
  if (ATTACH) return;
  try { sessionStorage.removeItem(LOAD_MARK_KEY); } catch (error) { /* storage may be unavailable */ }
}
if (!ATTACH) addEventListener("pagehide", clearLoadMark);
//: Called once the page has drawn and held: the load survived.
let loadSurvivalScheduled = false;
function markLoadSurvived() {
  if (ATTACH || loadSurvivalScheduled || !window.kerbsideReady?.streets || !window.kerbsideReady?.ground) return;
  loadSurvivalScheduled = true;
  setTimeout(() => { if (!window.kerbsideBoot?.error) clearLoadMark(); }, 30000);
}
//: The square: round the place asked for (?at=lon,lat), or where a hand-over arrives, or the
//: middle of the region; kept inside the region's box.
function windowSpec(bbox) {
  if (!bbox) return null;
  let lon = (bbox.west + bbox.east) / 2, lat = (bbox.south + bbox.north) / 2;
  try {
    const at = new URLSearchParams(location.search).get("at");
    const arrival = JSON.parse(sessionStorage.getItem("kerbside:region-arrival") || "null");
    if (at && at.split(",").length === 2 && at.split(",").every((v) => Number.isFinite(Number(v)))) [lon, lat] = at.split(",").map(Number);
    else if (arrival && arrival.path === location.pathname && Number.isFinite(arrival.lon)) [lon, lat] = [arrival.lon, arrival.lat];
  } catch (error) { /* the middle of the region */ }
  if (ATTACH?.detailWindow) ({lon, lat} = ATTACH.detailWindow);
  const radius = ATTACH?.detailWindow?.radius || (META ? STREAM.radius : LIGHT_RADII_M[LIGHT_LEVEL]);
  const kLon = 111320 * Math.cos(lat * Math.PI / 180), kLat = 111320;
  const clip = (b) => [Math.max(bbox.west, b[0]), Math.max(bbox.south, b[1]), Math.min(bbox.east, b[2]), Math.min(bbox.north, b[3])];
  const core = clip([lon - radius / kLon, lat - radius / kLat, lon + radius / kLon, lat + radius / kLat]);
  // With directions, the strip along the way (routeStrip, [west, south, east, north] each),
  // inside the region, beside the square round the walker.
  const strip = (ATTACH?.detailWindow?.strip || []).map(clip).filter((b) => b[2] > b[0] && b[3] > b[1]);
  const boxes = [core, ...strip];
  const box = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
               Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  return { lon, lat, radius, box, core, boxes };
}
function makeWindow(spec) {
  if (!spec) return null;
  const { box } = spec;
  const boxes = spec.boxes || [box];
  const inside = (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
    && boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);
  // Anything with a position: a [lon, lat] pair, or an object or list holding them anywhere.
  const near = (value, depth = 0) => {
    if (depth > 5 || value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) {
      if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") return inside(value[0], value[1]);
      if (value.some((v) => near(v, depth + 1))) return true;
      // A segment can cross the window with BOTH ends outside; a polygon can
      // enclose it without any vertex inside. Preserve this contextual geometry.
      const points=value.filter(v=>Array.isArray(v)&&v.length>=2&&typeof v[0]==="number"&&typeof v[1]==="number");
      if(points.length<2)return false;
      const w=Math.min(...points.map(p=>p[0])),e=Math.max(...points.map(p=>p[0])),
        s=Math.min(...points.map(p=>p[1])),n=Math.max(...points.map(p=>p[1]));
      return boxes.some(b=>w<=b[2] && e>=b[0] && s<=b[3] && n>=b[1]);
    }
    if (typeof value.lon === "number" && typeof value.lat === "number") return inside(value.lon, value.lat);
    for (const key of ["centroid", "p", "points", "c", "anchor", "lines", "position"]) {
      if (key in value && near(value[key], depth + 1)) return true;
    }
    return false;
  };
  return { ...spec, boxes, core: spec.core || box, inside, near };
}
//: The cells of a file the square touches, put back together as the file was; the whole file
//: where it has no cells. ``full`` fetches it whole.
async function fetchWindowed(url, full) {
  if (!LIGHT_SPEC) return full();
  url = ATTACH ? ATTACH.resolve(url) : new URL(url,location.href).href;
  const folder = url.replace(/([^/]+)\.json$/, "cells/$1/");
  try {
    const manifest = await worldCellCache.load(`${folder}manifest.json`,100);
    if (!manifest) throw Error(`Missing cell manifest: ${folder}`);
    const doc = await worldCellCache.load(`${folder}base.json`,100);
    // The square's cells nearest first, then the strip's, each once.
    const keys = [...new Set((LIGHT_SPEC.boxes || [LIGHT_SPEC.box]).flatMap((b) =>
      worldStreaming.windowCells(manifest,b,LIGHT_SPEC.lon,LIGHT_SPEC.lat)))];
    const gathered = new Map(manifest.paths.map((path) => [path, new Map()]));
    // Closest cells first, with bounded shared fetch/parse concurrency.
    const cells = await Promise.all(keys.map((key,i)=>worldCellCache.load(`${folder}${key}.json`,90-i)));
    for (const cell of cells) {
      for (const [path, rows] of Object.entries(cell)) {
        const into = gathered.get(path);
        if (into) for (const [index, item] of rows) into.set(index, item);
      }
    }
    for (const [path, items] of gathered) {
      const list = [...items.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
      const [head, tail] = path.split(".");
      if (tail) doc[head][tail] = list; else doc[head] = list;
    }
    // Expand source readiness up to a kilometre beyond the current square, nearest
    // first. Do not queue more decoded data than the shared LRU can retain.
    const b=LIGHT_SPEC.core || LIGHT_SPEC.box,padLon=1000/(111320*Math.cos(LIGHT_SPEC.lat*Math.PI/180)),padLat=1000/111320;
    const halo=worldStreaming.windowCells(manifest,[b[0]-padLon,b[1]-padLat,b[2]+padLon,b[3]+padLat],LIGHT_SPEC.lon,LIGHT_SPEC.lat);
    let warmBytes=0;
    const room=Math.max(0,48*1048576-worldCellCache.snapshot().residentBytes);
    for(const key of halo)if(!keys.includes(key)) {
      const bytes=(manifest.cells[key] || 0)*4;if(warmBytes+bytes>room)continue;
      warmBytes+=bytes;worldCellCache.load(`${folder}${key}.json`,-20).catch(()=>{});
    }
    return doc;
  } catch (error) {
    // Only genuinely unindexed sidecars may use the whole-file path. A transient
    // failed cell must not silently allocate a whole city and kill the installed app.
    if (String(error.message).includes("cell HTTP 404") && String(error.message).includes("manifest.json")) return full();
    throw error;
  }
}
//: The payload's and the ground's own URLs, which the app's pages point at their own copies.
const PAYLOAD_URL = asset("sf-corridor-3d.json");
const GROUND_URL = asset("sf-corridor-ground.json");
//: Where the square is, read from the payload's cells before anything is fetched.
const LIGHT_SPEC = LIGHT_LEVEL ? await fetch(PAYLOAD_URL.replace(/([^/]+)\.json$/, "cells/$1/manifest.json"), { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : null)).then((m) => windowSpec(m && m.bbox)).catch(() => null) : null;
const [DATA, OFFICIAL_GEOMETRY, DETAIL_MANIFEST, TERRAIN, PERIMETER, VISUAL_SUPPORT, WORLD_OBJECTS, STORE_NAMES, PARK_EVIDENCE, ELECTRICAL_SPANS, INVENTORY_CROSSINGS, BUILDING_SHAPES, ORTHO_ISLANDS, ORTHO_ROOFS, LIDAR_ROOF_SHAPES] = await Promise.all([
  fetchWindowed(PAYLOAD_URL, () => fetch(PAYLOAD_URL, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`payload ${r.status}`);
    return r.json();
  })),
  fetchWindowed(asset("sf-corridor-official.json"), () => fetch(asset("sf-corridor-official.json"), { cache: "no-cache" })
    .then((r) => r.ok ? r.json() : { curb_lines: [], curb_ramps: [] }))
    .catch(() => ({ curb_lines: [], curb_ramps: [] })),
  fetch(asset("sf-corridor-detail-manifest.json"), { cache: "no-cache" })
    .then((r) => r.ok ? r.json() : EMPTY_DETAIL_MANIFEST)
    .catch(() => EMPTY_DETAIL_MANIFEST),
  // The ground: a grid of lidar heights (scripts/build_terrain.py). Without it the model is
  // flat, which it was for its first year; with it Russian Hill is a hill.
  fetch(asset("sf-corridor-terrain.json"), { cache: "no-cache" })
    .then((r) => r.ok ? r.json() : null)
    .then(async (meta) => {
      if (!meta) return null;
      const bytes = await fetch(asset("sf-corridor-terrain.bin"), { cache: "no-cache" })
        .then((r) => r.ok ? r.arrayBuffer() : null);
      if (!bytes) return null;
      return { meta, data: new Int16Array(bytes) };
    })
    .catch(() => null),
  // The country round the map, five miles out from every region and all the country between
  // them: land or water on a 40 m grid from the map's coastline, and the bridges that leave
  // the regions (scripts/build_perimeter.py). One file for every page, in a frame of its own;
  // each row is run lengths, land first, alternating. Without it the page ends at its box in
  // a plate and a disc.
  // An attached region leaves the country round it to the page that holds it.
  (ATTACH ? Promise.resolve(null) : fetch(asset("sf-corridor-perimeter.json"), { cache: "no-cache" })
    .then((r) => r.ok ? r.json() : null))
    .then((p) => {
      if (!p || !p.runs) return null;
      const f = p.frame;
      const cells = new Uint8Array(f.rows * f.cols);
      for (let r = 0; r < f.rows; r += 1) {
        let c = 0;
        const runs = p.runs[r];
        for (let i = 0; i + 1 < runs.length; i += 2) {
          if (runs[i + 1]) cells.fill(runs[i + 1], r * f.cols + c, r * f.cols + c + runs[i]);
          c += runs[i];
        }
      }
      return { frame: f, cells, bridges: p.bridges || [], counts: p.counts, source: p.source, regions: p.regions || [] };
    })
    .catch(() => null),
  VISUAL_SUPPORT_URL ? fetch(VISUAL_SUPPORT_URL, { cache: "no-cache" })
    .then((r) => r.ok ? r.arrayBuffer() : null)
    .then((bytes) => bytes ? new Uint8Array(bytes) : null)
    .catch(() => null) : Promise.resolve(null),
  // Reconstructed visual objects are optional; canonical geometry remains separate.
  fetchWindowed(asset("sf-corridor-world-objects.json"), () => fetch(asset("sf-corridor-world-objects.json"), { cache: "no-cache" })
    .then((r) => r.ok ? r.json() : EMPTY_WORLD_OBJECTS))
    .catch(() => EMPTY_WORLD_OBJECTS),
  fetch(ATTACH ? ATTACH.resolve("sf-corridor-storefront-names.json")
    : new URL("sf-corridor-storefront-names.json", location.href), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
  fetch(asset("sf-corridor-parks.json"), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
  // Pole-to-pole spans reconstructed from PG&E's network, the poles and photographs
  // (scripts/build_electrical_spans.py). Only photograph-confirmed spans are in it.
  fetch(asset("sf-corridor-electrical.json"), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
  // The crosswalks SFMTA's inventory records at junctions OpenStreetMap maps no crossing at
  // (tools/build_inventory_crossings.py): the app's own, beside the payload, so the website's
  // payload is not changed. A page without the file draws the payload's crossings alone.
  fetch(asset("app-inventory-crossings.json"), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
  // Building parts, roofs and courtyards from OpenStreetMap (scripts/fetch_building_shapes.py).
  fetch(asset("sf-corridor-building-shapes.json"), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
  // Kerb islands and roofs read off the aerial photographs (scripts/build_ortho_islands.py,
  // scripts/build_ortho_roofs.py).
  fetch(asset("sf-corridor-islands.json"), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
  fetch(asset("sf-corridor-roofs.json"), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
  // Roof shapes read off the lidar (scripts/measure_roof_shapes.py): the hipped roofs only.
  fetch(asset("sf-corridor-roof-shapes.json"), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).catch(() => null),
]);
if (INVENTORY_CROSSINGS?.schema === "kerbside.inventory_crossings/1" && Array.isArray(DATA?.ways)) {
  for (const crossing of INVENTORY_CROSSINGS.crossings || []) {
    if (crossing.kind === "crossing" && Array.isArray(crossing.points) && crossing.points.length >= 2) DATA.ways.push(crossing);
  }
}
// What OpenStreetMap says about a building's shape that its outline cannot: parts with their
// own heights and starting heights, roof shapes, courtyards -- and the buildings mapped as
// multipolygons, whose outer ways carry no building tag and so never reached the payload.
// A shape applies only to the outline it was taken against (its point count and first point).
function applyBuildingShapes(data, shapes) {
  if (shapes?.schema !== "kerbside.building_shapes/1" || !Array.isArray(data?.ways)
      || !["west","east","north","south"].every(k=>shapes.bbox?.[k]===data.bbox?.[k])) return 0;
  for (const extra of shapes.extra || []) {
    if (extra?.kind === "building" && Array.isArray(extra.points) && extra.points.length >= 4) data.ways.push(extra);
  }
  let applied = 0;
  for (const feature of data.ways) {
    if (feature.kind !== "building") continue;
    const entry = shapes.buildings?.[String(feature.osm_id)];
    if (!entry || entry.guard?.n !== feature.points?.length
        || !entry.guard.first?.every((v, j) => v === feature.points[0][j])) continue;
    feature.shape = entry;
    applied += 1;
  }
  return applied;
}
applyBuildingShapes(DATA, BUILDING_SHAPES);
//: A roof the lidar says is hipped, on an outline OpenStreetMap gives no shape: drawn on the
//: smallest rectangle round the outline (the footprints it is read on are within 8% of one).
//: Tested against roofs labelled from the photographs: right 64-76% of the time, the rest roofs
//: with crossing ridges, never a flat roof (scripts/measure_roof_shapes.py).
function applyLidarRoofShapes(data, shapes) {
  if (shapes?.schema !== "kerbside.roof_shapes/1" || !Array.isArray(data?.ways)
      || !["west","east","north","south"].every(k=>shapes.bbox?.[k]===data.bbox?.[k])) return 0;
  let applied = 0;
  for (const feature of data.ways) {
    if (feature.kind !== "building" || feature.shape) continue;
    const entry = shapes.buildings?.[String(feature.osm_id)];
    if (!entry || entry.guard?.n !== feature.points?.length
        || !entry.guard.first?.every((v, j) => v === feature.points[0][j])) continue;
    feature.shape = { parts: [{ outer: entry.outer, roof: entry.roof, roof_height_m: entry.roof_height_m }], source: "lidar" };
    applied += 1;
  }
  return applied;
}
{ const hipped = applyLidarRoofShapes(DATA, LIDAR_ROOF_SHAPES); if (hipped) console.info(`kerbside: ${hipped} hipped roofs from the lidar`); }
// Evidence annotations are not a replacement world. An exact-footprint guard prevents a
// stale sidecar from applying a restroom style to a newer/changed canonical building.
function applyParkEvidence(data, evidence) {
  if (evidence?.schema !== "kerbside.park_evidence/1" || evidence.geometry_modified !== false) return [];
  const structures = [], objects = evidence.objects || [];
  const byBuilding = new Map();
  for (const object of objects) {
    if (object.render === "canonical_building_style") {
      const key = String(object.canonical_building_id);
      if (!byBuilding.has(key)) byBuilding.set(key, []);
      byBuilding.get(key).push(object);
    } else if (object.render === "inventory_structure" && object.semantic_confidence > 0
        && object.p?.some(p => p[0]>=data.bbox.west && p[0]<=data.bbox.east
          && p[1]>=data.bbox.south && p[1]<=data.bbox.north)) {
      structures.push({ kind: "building", osm_id: object.id, points: object.p,
        height_m: object.height_m, height_source: object.height_basis, covered: true,
        parkFacility: object, name: object.name, archetype: "park_facility" });
    }
  }
  for (const feature of data.ways) {
    const claims = byBuilding.get(String(feature.osm_id)) || [];
    const claim = claims.find(c => c.canonical_points?.length === feature.points?.length
      && c.canonical_points.every((p,i)=>p.every((v,j)=>v === feature.points[i][j]))
      && c.canonical_height_m === (feature.height_m ?? null));
    if (claim) feature.parkFacility = claim;
    const path = evidence.paths?.[String(feature.osm_id)];
    if (["path", "sidewalk"].includes(feature.kind) && path
        && path.points?.length === feature.points?.length
        && path.points.every((p,i)=>p.every((v,j)=>v === feature.points[i][j]))) {
      feature.path_surface = path.resolved;
      feature.path_runs = path.runs;
      feature.path_width_m = path.width_m;
      feature.park_id = path.park_id;
    }
  }
  return structures;
}
const PARK_STRUCTURES = applyParkEvidence(DATA, PARK_EVIDENCE);
function applyStorefrontNames(data, inventory) {
  const bbox = data.bbox;
  if (inventory?.schema !== "kerbside.storefront_names/1" || inventory.geometry_modified !== false
      || !["west","east","north","south"].every(k=>inventory.bbox?.[k]===bbox?.[k])) return 0;
  let applied=0;
  for (const feature of data.ways) {
    if (feature.kind !== "building") continue;
    const entry=inventory.buildings?.[String(feature.osm_id)];
    if (!entry || entry.height_m !== (feature.height_m ?? null)
        || !Array.isArray(entry.points) || entry.points.length !== feature.points?.length
        || !entry.points.every((p,i)=>Array.isArray(p) && p.length===2
          && p.every((v,j)=>Number.isFinite(v) && v===feature.points[i][j]))) continue;
    const names=(entry.shops || []).filter(s=>s && typeof s.n === "string"
      && s.n.trim() && s.n.length<=200 && typeof s.t === "string");
    if (!names.length) continue;
    // A tenant point does not establish a ground-floor shopfront or its sign position.
    // Keep names searchable/on the address card without inventing new facade geometry.
    feature.tenant_names=names;
    applied+=1;
  }
  return applied;
}
applyStorefrontNames(DATA, STORE_NAMES);
//: What people drew on their own fronts (docs/exterior-editor.mjs): the edits published for
//: everyone (scripts/merge_exterior_edits.py), and over them this browser's own.
const EXTERIOR_EDITS_KEY = "kerbside:exterior-edits:v1";
// The canonical edits -- what verified editors saved, for everyone -- asked for beside the
// published file, so a building's own windows give way to them as it is built.
const [PUBLISHED_EXTERIOR_EDITS, CANONICAL_EXTERIOR_EDITS] = await Promise.all([
  fetch(asset("sf-corridor-exterior-edits.json"), { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  // A region drawn beside the page has the page's own (it fetched them): a verified edit shows there too.
  META ? {} : ATTACH ? (ATTACH.canonicalEdits || {}) : accountLibrary().then((m) => m.canonicalEdits()).catch(() => ({})),
]);
//: The newer of two edits of one building (by when each was saved).
const newerEdit = (a, b) => (!a ? b || null : !b ? a : String(b.updated || "") > String(a.updated || "") ? b : a);
const publishedExteriorEdit = (id) => newerEdit(PUBLISHED_EXTERIOR_EDITS?.edits?.[id], CANONICAL_EXTERIOR_EDITS?.[id]);
function localExteriorEdits() {
  try { return JSON.parse(localStorage.getItem(EXTERIOR_EDITS_KEY) || "{}") || {}; } catch { return {}; }
}
const EXTERIOR_EDITS = new Map();
{
  const published = PUBLISHED_EXTERIOR_EDITS?.schema === "kerbside.exterior_edits/1" ? PUBLISHED_EXTERIOR_EDITS.edits || {} : {};
  const local = META ? {} : localExteriorEdits();
  for (const id of new Set([...Object.keys(published), ...Object.keys(CANONICAL_EXTERIOR_EDITS || {}), ...Object.keys(local)])) {
    EXTERIOR_EDITS.set(id, newerEdit(publishedExteriorEdit(id), local[id]));
  }
}
const MATERIAL_ASSIGNMENTS = await fetch(asset("sf-corridor-materials.json"), { cache: "no-cache" })
  .then((r) => r.ok ? r.json() : { assigned: {} })
  .catch(() => ({ assigned: {} }));
// Image-derived visual fits are optional and reviewed, never canonical replacements. They come in
// immutable tiles (tools/tile_frontage_fits.py): the small manifest is revalidated, and only the
// tiles over this page's area are fetched -- each named by its content's hash, so cached for good.
// The whole city's fits in one file was 67 MB fetched by every page before it drew a building.
const FRONTAGE_FITS = await loadFrontageFits();
// Researched storefront exteriors (smc.exteriors; docs/30-storefront-exterior-inference.md),
// published by scripts/publish_store_exteriors.py the way the frontage fits are: a small shared
// manifest names each world's plans by its area, and only those over this page's are fetched.
// The worlds themselves are not rewritten (their bytes are what names and fits are bound to).
// The renderer and its chain marks have fixed names beside the manifest, and a plan file must be
// a storefront-exteriors.json on this site, so a manifest can never point the page at other code;
// with no manifest, or none over this area, nothing more loads and the map draws as before.
const STOREFRONT_PLAN_PATH=/^(?:(?:regions|app-regions)\/[a-z0-9-]+\/)?storefront-exteriors\.json$/;
async function loadStoreExteriorBundle() {
  const index=await fetch(sharedAsset("storefront-exteriors.manifest.json"),{cache:"no-cache"})
    .then(r=>r.ok?r.json():null).catch(()=>null);
  if(index?.schema!=="kerbside.storefront_exterior_tiles/1" || !Array.isArray(index.tiles))return null;
  const b=LIGHT_SPEC ? {west:LIGHT_SPEC.box[0],south:LIGHT_SPEC.box[1],east:LIGHT_SPEC.box[2],north:LIGHT_SPEC.box[3]} : DATA.bbox;
  const wanted=index.tiles.filter(t=>typeof t?.path==="string" && STOREFRONT_PLAN_PATH.test(t.path)
    && Array.isArray(t.bbox) && (!b || (t.bbox[0]<=b.east && t.bbox[2]>=b.west && t.bbox[1]<=b.north && t.bbox[3]>=b.south)));
  if(!wanted.length)return null;
  try {
    const [plans, module, assets] = await Promise.all([
      Promise.all(wanted.map(t=>fetch(sharedAsset(`${t.path}?v=${encodeURIComponent(t.sha256 || "")}`))
        .then(r=>r.ok?r.json():null).catch(()=>null))),
      import(sharedAsset(`storefront-renderer.mjs?v=${encodeURIComponent(index.renderer_sha256 || "")}`)),
      fetch(sharedAsset("storefront-assets/manifest.json")).then(r=>r.ok?r.json():null),
    ]);
    // Worlds overlap (the Mission is inside the corridor): each keeps its own plans, and a
    // building takes the first that fits the shell it is drawn with.
    const collections=plans.filter(c=>c?.schema==="kerbside.storefront_exteriors/1" && c.buildings);
    if(!collections.length || !assets)return null;
    const base=new URL(sharedAsset("storefront-assets/"),location.href).href;
    const renderer=await module.createExteriorRenderer(THREE,assets,base);
    return {collections,renderer,bound:module.boundExterior};
  } catch(error) {
    console.warn("Storefront exteriors unavailable; retaining original renderer",error);
    return null;
  }
}
const STORE_EXTERIOR_RUNTIME = await loadStoreExteriorBundle();
//: The researched exterior for this building, or null: none in the bundle, a front a person
//: drew (theirs wins), or a shell it no longer fits (buildingMesh turns it off).
const storeExteriorBound=new WeakMap();
function storeExteriorFor(feature) {
  if(feature._storeExteriorDisabled || feature.exteriorEdit || !STORE_EXTERIOR_RUNTIME)return null;
  // Asked of a building by every detail pass it has; the shell it is matched against does not
  // change while the feature lives, so the match is made once.
  if(!storeExteriorBound.has(feature)) {
    let plan=null;
    for(const collection of STORE_EXTERIOR_RUNTIME.collections) {
      if((plan=STORE_EXTERIOR_RUNTIME.bound(feature,collection)))break;
    }
    storeExteriorBound.set(feature,plan);
  }
  return storeExteriorBound.get(feature);
}
window.kerbsideStorefrontExteriors=()=>({enabled:Boolean(STORE_EXTERIOR_RUNTIME),
  buildings:(STORE_EXTERIOR_RUNTIME?.collections || []).reduce((n,c)=>n+Object.keys(c.buildings).length,0),
  missingAssets:STORE_EXTERIOR_RUNTIME?.renderer?.missingAssets || [],canonicalGeometryModified:false});
const MUNICIPAL_CONTEXT = await (async()=>{
  const index=await fetch(sharedAsset("municipal-context.manifest.json"),{cache:"no-cache"}).then(r=>r.ok?r.json():null).catch(()=>null);
  const b=DATA.bbox, found=index?.regions?.find(r=>r.bbox[0]<b.north && r.bbox[2]>b.south && r.bbox[1]<b.east && r.bbox[3]>b.west);
  if(!found)return null;
  const context=await fetch(sharedAsset(found.path)).then(r=>r.ok?r.json():null).catch(()=>null);
  return context?.schema==="kerbside.municipal_context/1" ? context : null;
})();
const municipalUsage={sidewalks:0,curbColourRecords:0,referenceRecords:MUNICIPAL_CONTEXT?.references?.length || 0};
window.kerbsideMunicipal=()=>({...municipalUsage,sources:MUNICIPAL_CONTEXT?.sources || [],measuredGeometryChanged:false});
async function loadFrontageFits() {
  const empty = { schema: "kerbside.facade_fits/1", buildings: {} };
  const manifest = await fetch(sharedAsset("sf-corridor-frontage-fits.manifest.json"), { cache: "no-cache" })
    .then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!manifest || !Array.isArray(manifest.tiles)) return empty;
  const b = LIGHT_SPEC ? {west:LIGHT_SPEC.box[0],south:LIGHT_SPEC.box[1],east:LIGHT_SPEC.box[2],north:LIGHT_SPEC.box[3]} : DATA.bbox;
  const wanted = manifest.tiles.filter((t) => !b || (t.bbox[0] <= b.east && t.bbox[2] >= b.west
    && t.bbox[1] <= b.north && t.bbox[3] >= b.south));
  const url = (path) => manifest.base ? `${manifest.base.replace(/\/+$/, "")}/${path}` : sharedAsset(path);
  const parts = await Promise.all(wanted.map((t) => fetch(url(t.path))
    .then((r) => r.ok ? r.json() : null).catch(() => null)));
  for (const part of parts) Object.assign(empty.buildings, part?.buildings || {});
  return empty;
}
function frontageNormalFor(fit) {
  if(![fit?.a,fit?.b].every(p=>Array.isArray(p) && p.length===2 && p.every(Number.isFinite)))return null;
  const [ax,ay]=xy(...fit.a),[bx,by]=xy(...fit.b),L=Math.hypot(bx-ax,by-ay);
  if(L<.2)return null;
  const tx=(bx-ax)/L,tz=(ay-by)/L;
  const ring=fit.canonical_footprint;
  let expected=null;
  if(Array.isArray(ring) && ring.length>=3) {
    if(!ring.every(p=>Array.isArray(p) && p.length>=2 && p.slice(0,2).every(Number.isFinite)))return null;
    const local=ring.map(p=>{const [x,y]=xy(...p);return [x,-y];});
    const signed=local.reduce((sum,p,i)=>{const q=local[(i+1)%local.length];return sum+p[0]*q[1]-q[0]*p[1];},0);
    if(!Number.isFinite(signed) || Math.abs(signed)<.01)return null;
    let bestOverlap=0;
    for(let i=0;i<local.length;i++) {
      const p=local[i],q=local[(i+1)%local.length],dx=q[0]-p[0],dz=q[1]-p[1],length=Math.hypot(dx,dz);
      if(length<.03 || Math.abs((dx*tx+dz*tz)/length)<.96)continue;
      const off=Math.max(Math.abs((p[0]-ax)*-tz+(p[1]+ay)*tx),Math.abs((q[0]-ax)*-tz+(q[1]+ay)*tx));
      if(off>.06)continue;
      const limits=[(p[0]-ax)*tx+(p[1]+ay)*tz,(q[0]-ax)*tx+(q[1]+ay)*tz];
      const overlap=Math.min(L,Math.max(...limits))-Math.max(0,Math.min(...limits));
      if(overlap<=bestOverlap)continue;
      bestOverlap=overlap;
      expected=signed>0 ? [dz/length,-dx/length] : [-dz/length,dx/length];
    }
    if(!expected)return null; // registered plane has no bound canonical front edge
  }
  const n=fit.front_normal_enu;
  if(n!==undefined) {
    if(!Array.isArray(n) || n.length!==2 || !n.every(Number.isFinite)
       || Math.abs(Math.hypot(...n)-1)>.001)return null;
    const scene=[n[0],-n[1]];
    if(Math.abs(scene[0]*tx+scene[1]*tz)>.01
       || (expected && scene[0]*expected[0]+scene[1]*expected[1]<.99))return null;
    return scene;
  }
  // Legacy fits may recover orientation from their exact bound footprint, never
  // from an unconditional left-hand normal or arbitrary endpoint order.
  return expected;
}
function frontageFitFor(feature) {
  // A fit the reconstructor accepted (match_frontage_facades.py, auto_review), or one a person
  // reviewed: either is drawn.
  if (FRONTAGE_FITS.schema !== "kerbside.facade_fits/1") return null;
  const fit = FRONTAGE_FITS.buildings?.[String(feature.osm_id)];
  if (!fit || !["reviewed_inferred_visual_parameters", "auto_accepted_visual_parameters"].includes(fit.review_status)
      || fit.canonical_geometry_modified || fit.conflicts?.length
      || (fit.openings || []).some(o=>o.kind === "garage_candidate" && o.recess?.render_steps)
      || !Array.isArray(fit.canonical_footprint) || !Array.isArray(feature.points)
      || JSON.stringify(fit.canonical_footprint) !== JSON.stringify(feature.points)
      || !Number.isFinite(fit.height_m) || !Number.isFinite(Number(feature.height_m))
      || Math.abs(Number(feature.height_m) - fit.height_m) > 0.05) return null;
  return fit;
}
function houseCertainty(feature) {
  const fit = frontageFitFor(feature);
  const appearance = (MATERIAL_ASSIGNMENTS.assigned || {})[String(feature.osm_id)];
  return {
    level: fit?.certainty?.tier || "low",
    aiReviewRequired: fit?.certainty?.ai_review_required ?? true,
    front: fit ? "reviewed photo-derived visual layout (not surveyed)" : "inferred facade layout",
    appearance: fit ? "reviewed image appearance" : appearance ? "photo-classified appearance" : "procedural appearance",
    height: feature.height_source || "unknown height source",
    unseenSides: "inferred", metricAccuracy: fit?.inch_accuracy_verified ? "independently verified" : "not inch-verified",
  };
}
document.getElementById("obs").textContent = DATA.summary.observations.toLocaleString();
document.getElementById("eligible").textContent = DATA.summary.eligible.toLocaleString();
document.getElementById("seq").textContent = DATA.summary.sequences.toLocaleString();
document.getElementById("cells").textContent = DATA.summary.coverage_cells.toLocaleString();
document.getElementById("surfaces").textContent = (DATA.summary.cv_depth.surface_rows || 0).toLocaleString();
document.getElementById("measured").textContent = (DATA.summary.cv_depth.measured_curb_height_count || 0).toLocaleString();
const detailBytes = (DETAIL_MANIFEST.shards || []).reduce((sum, shard) => sum + (shard.bytes || 0), 0);
document.getElementById("detailnote").textContent = DETAIL_MANIFEST.shards.length
  ? `Full source detail — ${(detailBytes / 1e6).toFixed(1)} MB in two lossless archive shards; the nearby half loads automatically when you inspect a feature.`
  : "Full source detail is unavailable in this build; render geometry remains complete.";


const canvas = document.getElementById("scene");
if (!ATTACH) {
  // The browser takes the context back under memory pressure and usually returns it (the
  // renderer rebuilds what it drew): only one not back in ten seconds stops the map.
  let contextLostTimer = 0;
  canvas.addEventListener("webglcontextlost", () => {
    window.kerbsideBoot.contextLost = true;
    clearTimeout(contextLostTimer);
    contextLostTimer = setTimeout(() => {
      window.kerbsideBoot.error = "The graphics context was interrupted. Please retry the map.";
      window.kerbsideBoot.errorKind = "graphics";
    }, 10000);
  });
  canvas.addEventListener("webglcontextrestored", () => {
    clearTimeout(contextLostTimer);
    window.kerbsideBoot.contextLost = false;
    if (window.kerbsideBoot.errorKind === "graphics") {
      window.kerbsideBoot.error = null; window.kerbsideBoot.errorKind = null;
    }
  });
}
// A logarithmic depth buffer, because this scene spans five orders of magnitude: a 126 mm kerb
// has to stay distinct from the road it sits on while a two-kilometre corridor is on screen. With
// the ordinary buffer, precision falls with the square of distance -- at a thousand metres it is
// about 0.6 m, and street markings separated by two centimetres flickered in and out as the
// depth test picked a different winner each frame.
const renderer = ATTACH ? ATTACH.renderer : new THREE.WebGLRenderer({
  // In the headset the view ends a couple of hundred metres off, where the ordinary buffer is
  // fine-grained enough, and the logarithmic one costs a headset's GPU its early depth test.
  canvas, antialias: true, alpha: false, logarithmicDepthBuffer: !META,
});
// Each new shader was checked for errors by reading its program log at once, which waits for
// the driver to finish compiling it: a whole-second stall the first time a house's windows,
// a sign or a tree kind came into view. The shaders are the library's own; the check is off.
if (renderer.debug) renderer.debug.checkShaderErrors = false;
