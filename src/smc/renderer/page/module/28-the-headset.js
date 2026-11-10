// ---- the headset (META) --------------------------------------------------------------------
//
//: The follow view off the headset (the page in the headset's browser, before you go in): the
//: same place behind and above the walker as in the headset (META_FOLLOW), and nearer than
//: META_FOLLOW_NEAREST_M it is the walker's eyes.
const META_FOLLOW_NEAREST_M = 0.8;
//: (The orbit looks at the walker's middle, so the view stands `up` and a little more over it.)
function metaFollowDistance() { const F = metaLibrary.META_FOLLOW; return Math.hypot(F.back, F.up + 0.6); }
function metaFollowPitch() { const F = metaLibrary.META_FOLLOW; return Math.atan2(F.up + 0.6, F.back); }
//
// docs/meta-xr.mjs runs the session, the controllers and the panels; the page lends it the world
// through these hooks. The page's own controls are put away: there is one way to see (out of
// your own eyes), one light, and the few blocks round you.
var metaXR = null;
//: What the page holds, in bytes, as the memory governor reads it: the browser's own share (an
//: allowance), the script heap, and the geometry and textures handed to the GPU -- counted
//: from the scene every couple of seconds, each buffer once.
function metaMemory() {
  const geometries = new Set(), textures = new Set();
  let gpu = 0;
  scene.traverse((o) => {
    if (o.geometry && !geometries.has(o.geometry)) {
      geometries.add(o.geometry);
      for (const attribute of Object.values(o.geometry.attributes || {})) gpu += attribute.array?.byteLength || 0;
      gpu += o.geometry.index?.array?.byteLength || 0;
    }
    if (o.isInstancedMesh) gpu += o.instanceMatrix.array.byteLength;
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      for (const key of ["map", "normalMap", "roughnessMap", "alphaMap", "emissiveMap", "aoMap"]) {
        const t = m[key];
        if (!t || textures.has(t)) continue;
        textures.add(t);
        const image = t.image || {};
        // Mipmapped RGBA: a third again for the smaller levels.
        gpu += (image.width || 0) * (image.height || 0) * 4 * (t.generateMipmaps === false ? 1 : 4 / 3);
      }
    }
  });
  const cells = worldCellCache.snapshot().residentBytes;
  const js = performance.memory?.usedJSHeapSize || cells + tileResidentBytes + 300 * 1048576;
  const baseline = metaLibrary.META_MEMORY.baseline;
  return { baseline, js, gpu: Math.round(gpu), cells, tiles: tileResidentBytes, total: baseline + js + Math.round(gpu),
    measuredHeap: Boolean(performance.memory) };
}
//: The governor's plan carried out: the square's size for the next build, and what is shed.
function applyMetaMemoryPlan(plan) {
  const M = metaLibrary.META_STREAM;
  STREAM.radius = plan.radius;
  STREAM.arrival = Math.min(M.arrival, plan.radius);
  STREAM.keep = Math.round(plan.radius * M.keep / M.radius);
  STREAM.lead = Math.round(plan.radius * M.lead / M.radius);
  if (plan.shed) {
    worldCellCache.maxBytes = Math.max(16 * 1048576, Math.round(worldCellCache.maxBytes / 2));
    worldCellCache.evict();
    TILE_RESIDENT_BUDGET = Math.max(8 * 1048576, Math.round(TILE_RESIDENT_BUDGET / 2));
    evictTiles();
  } else if (plan.level === "restore") {
    worldCellCache.maxBytes = Math.min(M.cellBytes, worldCellCache.maxBytes * 2);
    TILE_RESIDENT_BUDGET = Math.min(M.tileBytes, TILE_RESIDENT_BUDGET * 2);
  }
  // Over the emergency line the square round you is built again at once, at its smallest; the
  // one it replaces goes when the new one stands.
  if (plan.shed === "all" && !attaching) {
    const lon = midLon + avatar.position.x / metersPerLon, lat = midLat - avatar.position.z / metersPerLat;
    const region = regionAt(lon, lat);
    if (region) attachRegion(region, { lon, lat }, plan.radius, true);
  }
  console.info(`kerbside: memory ${plan.level}: ${(metaMemory().total / 1073741824).toFixed(2)} GiB; square ${2 * plan.radius} m`);
}
//: On a computer the page watches its own heap as the headset build does (META_MEMORY): a
//: Chrome tab is ended by the browser at about 4 GiB of script heap, and the page had been
//: reaching 3-4.5 GiB after a few jumps -- the freezes and the crash while editing a house.
//: Over ``aim`` the caches it can rebuild from the network (world cells, terrain tiles) are
//: halved and trimmed -- once on going over, and again only if the heap goes on growing; over
//: ``emergency`` the square round you is built again smaller (the window it replaces, and what
//: only it held, goes once the new one stands); under ``restoreBelow`` the budgets come back.
//:
//: It had rebuilt the square every time the heap crossed the emergency line, and the heap
//: crosses it twice a minute in a big region (a rebuild holds two squares at once): the square
//: went up again every half minute at the same size, each time handing the street to the grey
//: tile tree while it stood, the living city's people dealt again with it, and the caches
//: emptied every four seconds besides -- the flashes to grey and back, and the slowness
//: (measured at the Marina, 2026-11-08: eleven rebuilds in two minutes standing still).
//: Now a rebuild is only made when it makes the square smaller, at most once a minute.
const DESKTOP_MEMORY = { aim: 2.6 * 1073741824, emergency: 3.3 * 1073741824, restoreBelow: 1.9 * 1073741824, everyMs: 4000,
  minRadius: 150, shrink: 0.6, rebuildEveryMs: 60_000, trimGrowth: 1.12 };
const desktopMemory = { level: "ok", cellBytes: worldCellCache.maxBytes, tileBytes: TILE_RESIDENT_BUDGET, radius: STREAM.radius, sheds: 0,
  rebuilds: 0, lastRebuild: -Infinity, trimmedAt: 0 };
//: What one look at the heap does (pure, for the tests): trim, rebuild smaller, restore, or nothing.
function desktopMemoryPlan(used, M, D, { attaching = false, windowRadius = M.radius, now = 0 } = {}) {
  if (used >= D.aim) {
    const trim = M.level === "ok" || used > M.trimmedAt * D.trimGrowth;
    const target = Math.max(D.minRadius, Math.round(windowRadius * D.shrink));
    const rebuild = used >= D.emergency && !attaching && target < windowRadius - 20 && now - M.lastRebuild >= D.rebuildEveryMs;
    return { level: used >= D.emergency ? "emergency" : "over", trim, rebuild: rebuild ? target : null };
  }
  if (used < D.restoreBelow && M.level !== "ok") return { level: "ok", restore: true };
  return { level: M.level };
}
function desktopMemoryTick() {
  const used = performance.memory?.usedJSHeapSize;
  if (!(used > 0) || document.hidden) return;
  const D = DESKTOP_MEMORY, M = desktopMemory, now = performance.now();
  const windowRadius = activeGuest?.detailRadius || BUILD_WINDOW?.radius || STREAM.radius;
  const plan = desktopMemoryPlan(used, M, D, { attaching: Boolean(attaching), windowRadius, now });
  if (plan.trim) {
    worldCellCache.maxBytes = Math.max(32 * 1048576, Math.round(worldCellCache.maxBytes / 2));
    worldCellCache.evict();
    TILE_RESIDENT_BUDGET = Math.max(16 * 1048576, Math.round(TILE_RESIDENT_BUDGET / 2));
    evictTiles();
    M.sheds += 1; M.trimmedAt = used;
    console.info(`kerbside: heap ${(used / 1073741824).toFixed(2)} GiB, ${plan.level}: caches trimmed`);
  }
  // City mode's area is held as it was built: the caches are trimmed, but it is not built again.
  if (plan.rebuild && !(typeof cityLock !== "undefined" && cityLock)) {
    STREAM.radius = plan.rebuild;
    M.rebuilds += 1; M.lastRebuild = now;
    const lon = midLon + avatar.position.x / metersPerLon, lat = midLat - avatar.position.z / metersPerLat;
    const region = regionAt(lon, lat);
    if (region) attachRegion(region, { lon, lat }, STREAM.radius, true);
    console.info(`kerbside: heap ${(used / 1073741824).toFixed(2)} GiB: the square round you built again at ${2 * STREAM.radius} m`);
  }
  if (plan.restore) {
    worldCellCache.maxBytes = M.cellBytes;
    TILE_RESIDENT_BUDGET = M.tileBytes;
    STREAM.radius = M.radius;
    M.trimmedAt = 0;
  }
  M.level = plan.level;
}
window.kerbsideMemory = () => ({ ...desktopMemory, heap: performance.memory?.usedJSHeapSize || null, limits: DESKTOP_MEMORY });
if (!META && !ATTACH && performance.memory) setInterval(desktopMemoryTick, DESKTOP_MEMORY.everyMs);
if (META) {
  for (const id of ["hud", "settings-toggle", "settings-page", "compass", "addr", "route-end", "fold"]) {
    const element = document.getElementById(id);
    if (element) { element.hidden = true; element.style.display = "none"; }
  }
  document.querySelectorAll(".compass, #compass-rose").forEach((element) => { element.closest("div")?.setAttribute("hidden", ""); });
  // Following the walker from a little behind and above (META_FOLLOW), not out of its eyes.
  setFirstPerson(false);
  state.dist = metaFollowDistance();
  state.pitch = metaFollowPitch();
  state.tilt = 0;
  scene.add(new THREE.AmbientLight(HEADSET_FILL.colour, HEADSET_FILL.intensity));
  // Started at the street corner nearest where you were put down (unless a place was asked
  // for), looking along the street -- not into the side of the house beside you.
  let resume = null;
  try {
    resume = JSON.parse(sessionStorage.getItem("kerbside:meta-resume") || "null");
    sessionStorage.removeItem("kerbside:meta-resume");
  } catch (error) { /* a fresh start */ }
  if (resume && Number.isFinite(resume.lon) && Number.isFinite(resume.lat)) {
    // Started again by the memory governor: back where you stood, facing the same way.
    const [x, y] = xy(resume.lon, resume.lat);
    goToNow(new THREE.Vector3(x, 0, -y), { travel: true });
  } else if (!new URLSearchParams(location.search).has("at")) {
    let corner = null;
    for (const c of DATA.intersections || []) {
      if (!c.a || !c.b) continue;
      const [cx, cy] = xy(c.lon, c.lat), d = Math.hypot(cx - avatar.position.x, -cy - avatar.position.z);
      if (!corner || d < corner.d) corner = { d, x: cx, z: -cy };
    }
    if (corner && corner.d < 400) goToNow(new THREE.Vector3(corner.x, 0, corner.z), { travel: true });
  }
  { const yaw = Number.isFinite(resume?.yaw) ? resume.yaw : streetHeadingAt(avatar.position.x, avatar.position.z);
    if (Number.isFinite(yaw)) { state.yaw = yaw; state.look = 0; placeCamera(); } }
  camera.near = metaLibrary.META_VIEW.near;
  camera.far = metaLibrary.META_VIEW.far;
  camera.updateProjectionMatrix();
  if (scene.fog) { scene.fog.near = metaLibrary.META_VIEW.fogNear; scene.fog.far = metaLibrary.META_VIEW.fogFar; }
  metaXR = metaLibrary.createMetaXR({ THREE, renderer, scene, camera, hooks: {
    // In once the streets and ground stand and the square round you is built.
    ready: () => Boolean(window.kerbsideReady?.streets && window.kerbsideReady?.ground) && detailCovers(avatar.position),
    status: () => (attaching?.progress?.textContent) || document.getElementById("progress")?.textContent || "Loading the streets round you…",
    feet: () => ({ x: avatar.position.x, y: avatar.position.y - AVATAR_STAND_Y, z: avatar.position.z }),
    indoors: () => Boolean(state.indoors),
    showWalker: (on) => { avatar.visible = on; },
    // How far back from the walker the view can stand before a building is in the way.
    clearBehind: (x0, z0, x1, z1) => {
      const length = Math.hypot(x1 - x0, z1 - z0);
      for (let d = 0.25; d <= length; d += 0.25) {
        const t = d / length;
        if (buildingAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return d;
      }
      return Infinity;
    },
    heading: (yaw, place) => { state.yaw = yaw; state.look = 0; if (place) placeCamera(); },
    walk: (dx, dz) => { moveWalker(dx, dz); state.target.copy(avatar.position); },
    describeCentre: () => describeAhead(),
    enterOrLeave: () => enterOrLeave(),
    search: async (query) => { searchPlaces(query); await searchPlacesLoaded(); return searchPlaces(query); },
    facing: () => streetHeadingAt(avatar.position.x, avatar.position.z),
    travelTo: (place) => {
      const [x, y] = xy(place.lon, place.lat);
      gps.follow = false;
      goToNow(addressLanding(new THREE.Vector3(x, 0, -y)), { travel: true });
    },
    directionsTo: (place, mode) => window.kerbsideRoute.directionsTo(place, mode),
    endRoute: () => window.kerbsideRoute.end(),
    // Starting again where you stand (the governor's last step): `ask` says only whether it may.
    reload: (ask) => {
      try {
        const last = Number(sessionStorage.getItem("kerbside:meta-reloaded") || 0);
        if (Date.now() - last < 120000) return false;
        if (ask) return true;
        const lon = midLon + avatar.position.x / metersPerLon, lat = midLat - avatar.position.z / metersPerLat;
        sessionStorage.setItem("kerbside:meta-reloaded", String(Date.now()));
        sessionStorage.setItem("kerbside:meta-resume", JSON.stringify({ lon, lat, yaw: state.yaw }));
        sessionStorage.setItem("kerbside:meta-reload-why", JSON.stringify(metaXR?.state?.planLog || []));
      } catch (error) { return false; }
      location.reload();
      return true;
    },
    resetView: () => {
      const at = walkerExteriorAt(avatar.position.x, avatar.position.z);
      if (at) goToNow(at, { travel: true });
      state.indoors = false;
    },
    radius: () => STREAM.radius,
    memory: metaMemory,
    applyMemoryPlan: applyMetaMemoryPlan,
    onEnter: () => { ++frameRequest; renderer.setAnimationLoop(animate); },
    onExit: () => { renderer.setAnimationLoop(null); requestFrame(); },
  } });
  // What the headset draws: only what you could see. A Quest 3 holds its frame rate at about a
  // million triangles and a few hundred draws; the page as built draws eight million -- most of
  // it past the haze (the canopy and hills round the Bay, the simple city, the bridges) or out
  // of sight (the furniture inside every house). Past the far plane, the Bay-wide canopy, and
  // rooms you are not in are left out of the drawing (their layers, so whatever else
  // shows or hides them is left alone); twice a second, as you walk.
  const metaSphere = new THREE.Sphere();
  const metaCulled = { hidden: 0, shown: 0, triangles: 0 };
  function metaCullLeaf(o, bayWide, interior) {
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    metaSphere.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    const near = metaSphere.center.distanceTo(avatar.position) - metaSphere.radius;
    // Small things off -- a door, a sign, a house's porch -- are a draw each for a few pixels:
    // a thing a few metres across is left out past twenty-five metres, one under twenty past
    // a hundred.
    const r = metaSphere.radius;
    const hide = o.userData.surface === "nature_canopy_proxy" || near > metaLibrary.META_VIEW.far
      || (r < 4 && near > 25) || (r < 20 && near > 100)
      || (interior && !(state.indoors && near < metaLibrary.META_VIEW.room));
    if (hide) {
      if (o.userData.metaMask === undefined) o.userData.metaMask = o.layers.mask;
      o.layers.mask = 0;
      metaCulled.hidden++;
    } else {
      if (o.userData.metaMask !== undefined) { o.layers.mask = o.userData.metaMask; delete o.userData.metaMask; }
      metaCulled.shown++;
      metaCulled.triangles += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3 * (o.isInstancedMesh ? o.count : 1);
    }
  }
  function metaCullTree(o, bayWide, interior) {
    if (!o.visible) return;
    bayWide = bayWide || Boolean(o.userData.bayWide);
    interior = interior || o.name === "interiors" || Boolean(o.userData.sharedInteriorAsset);
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) metaCullLeaf(o, bayWide, interior);
    for (const child of o.children) metaCullTree(child, bayWide, interior);
  }
  function metaCull() {
    metaCulled.hidden = metaCulled.shown = metaCulled.triangles = 0;
    scene.updateMatrixWorld();
    metaCullTree(scene, false, false);
  }
  setInterval(metaCull, 500);
  scene.matrixWorldAutoUpdate = false;
  window.kerbsideMeta = { xr: metaXR, memory: metaMemory, stream: STREAM, applyMemoryPlan: applyMetaMemoryPlan, culled: metaCulled, cull: metaCull, plain: headsetStats,
    //: Why the window round you is or is not being built again, for looking into on the headset.
    get streaming() { return { attaching: Boolean(attaching), wanted: Boolean(attachWanted), retryIn: Math.round(detailRetryAt - performance.now()),
      checkedAgo: Math.round(performance.now() - detailCheckAt), frames: frameCount, ready: window.kerbsideReady,
      guest: activeGuest ? { region: activeGuest.region.name, radius: activeGuest.detailRadius, ready: activeGuest.ready } : null,
      host: hostWorldActive, plan: metaXR.state.plan }; } };
  // Without a headset (a desktop, for a look): the same buttons on the keyboard, the arrows to walk.
  addEventListener("keydown", (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typingIn(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === "a") metaXR.describe();
    else if (key === "b") metaXR.toggleMenu();
    else if (key === "x") metaXR.enterOrLeave();
    else return;
    e.preventDefault();
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (metaXR.clickAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)) e.stopImmediatePropagation();
  }, true);
  // In: straight into the headset where the browser allows it, else from the button.
  const enter = document.createElement("button");
  enter.id = "meta-enter";
  enter.textContent = "Enter Kerbside";
  enter.style.cssText = "position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:60;font:600 20px system-ui,sans-serif;"
    + "padding:16px 28px;border-radius:999px;border:0;background:#2563eb;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.35)";
  const help = document.createElement("p");
  help.id = "meta-help";
  help.style.cssText = "position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:60;margin:0;max-width:min(92vw,560px);"
    + "font:14px/1.45 system-ui,sans-serif;color:#fff;background:rgba(15,20,28,.85);padding:10px 16px;border-radius:12px;text-align:center";
  help.textContent = "Left stick: walk (hold the left trigger to walk faster) · Right stick: turn · A: what you are looking at · "
    + "B: menu (search, directions, reset view) · X: in and out of houses";
  document.body.append(help, enter);
  metaXR.startWhenAllowed(enter).then((started) => { if (started) { enter.hidden = true; help.hidden = true; } });
}
if (!ATTACH) animate();
setTimeout(() => { loadPhotoMaterialLibrary(); }, 1500);

// ---- memory: lossless, recoverable snapshots of static ground buffers ----
// Dropping arrays permanently broke later uploads/context restoration. Keep compressed copies
// instead: array getters synchronously restore exact bits whenever Three needs to upload again.
// No geometry detail is removed. Codec failure leaves buffers resident, never null externally.
const geometryRecovery = await Promise.all([
  import(sharedAsset("recoverable-geometry.mjs")), import(sharedAsset("vendor/fflate-0.8.2.mjs")),
]).catch(error => { console.warn("Ground buffers retained: recovery codec unavailable", error); return null; });
// The buffers are deflated in a worker, started from this site (never from the object store,
// where the module itself may be read from: a worker must be the page's own origin).
geometryRecovery?.[0].useCompressionWorker?.(new URL("recoverable-geometry-worker.mjs", new URL(
  document.querySelector('meta[name="kerbside-regions"]')?.content || "regions.json", location.href)).href);
const RELEASE_SURFACES = new Set(["walk", "walk_underlay", "walk_narrow", "marking", "crossing_edges",
  "road", "crossing", "bike", "curb_ramp", "tactile_warning", "parking_lot", "median"]);
const RELEASE_BYTES_PER_FRAME = 24 << 20;
const releaseQueue = [];
groups.streets.traverse((o) => {
  if (o.isMesh && !o.isInstancedMesh && o.geometry && RELEASE_SURFACES.has(o.userData.surface)) releaseQueue.push(o);
});
function noRaycast() {}
function releaseSomeGeometry() {
  let bytes = 0;
  while (releaseQueue.length && bytes < RELEASE_BYTES_PER_FRAME) {
    const mesh = releaseQueue.pop();
    const g = mesh.geometry;
    if (!g || g.userData.released) continue;
    // Ground picking already uses canonical footprints/terrain rather than these display meshes.
    mesh.raycast = noRaycast;
    // Culling needs the bounds; they are taken while the vertices are still here.
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    g.userData.released = true;
    for (const a of [...Object.values(g.attributes), g.index]) {
      if (!a || !a.array) continue;
      bytes += a.array.byteLength;
      if (geometryRecovery?.[0].makeRecoverable(a, geometryRecovery[1])) a.needsUpdate = true;
    }
  }
  return releaseQueue.length;
}
(function releasePump() {
  if (releaseSomeGeometry()) setTimeout(releasePump, 120);
})();

// ---- inspection ----
//
// Everything above is written to be looked at, and for a long stretch of this build there was
// nobody able to look: the window was not being composited, so every screenshot came back
// empty and the only evidence a fix had worked was that the code said it should have. That is
// how the crosswalks and the kerbs regressed twice without anyone noticing.
//
// Rendering does not need a visible window -- only compositing does -- so this takes its own
// picture into its own buffer, and answers what is actually standing at a given point on the
// ground. Between them a caller with no screen can both see the model and measure it.
// The Bay Area, from the root down. Loaded after the region's own world so the street the
// page opens on is never waiting behind the country round it.
if (!ATTACH) await loadTileTree();

// ---- the exterior editor ---------------------------------------------------------------------
//
// A person corrects a building's front by hand (docs/exterior-editor.mjs): right-click it, or
// point at it and press E. The module keeps the panel and the edit; the page tells it what the
// building's walls are and what it drew on them, and draws every saved edit on load.
let exteriorEditorModule = null;
const exteriorEditorLibrary = () => (exteriorEditorModule ??= import(sharedAsset("exterior-editor.mjs?rev=__EXTERIOR_EDITOR_HASH__")));
const exteriorEditGroups = new Map();
const buildingWayById = new Map((DATA.ways || []).filter((w) => w.kind === "building").map((w) => [String(w.osm_id), w]));
//: A building's walls for the editor: the street-facing ones first, nearest the street first,
//: then the rest, widest first. Each runs left to right as seen from outside it.
//: Exterior edits as drawn in the world, in a group of their own that stays when this page lets its
//: region go to the streamed world (releaseHostWorld): an edit stays on its building whichever
//: window draws the building, and the editor's preview with it.
const exteriorEditRoot = new THREE.Group();
exteriorEditRoot.name = "exterior-edits";
exteriorEditRoot.userData.bayWide = true;
root.add(exteriorEditRoot);
function exteriorWalls(feature) {
  const ring = feature.points.slice();
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  const local = ring.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  const cx = local.reduce((t, p) => t + p[0], 0) / local.length, cz = local.reduce((t, p) => t + p[1], 0) / local.length;
  const base = feature._treeClipBase ?? groundBaseFor(feature.points);
  const height = HOME_RENDER.get(String(feature.osm_id))?.height ?? ((feature._treeClipRoof ?? base + (Number(feature.height_m) || 9)) - base);
  const walls = [];
  for (let i = 0; i < ring.length; i += 1) {
    let a = ring[i], b = ring[(i + 1) % ring.length], pa = local[i], pb = local[(i + 1) % ring.length];
    const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (length < 1.2) continue;
    let ux = (pb[0] - pa[0]) / length, uz = (pb[1] - pa[1]) / length;
    let nx = uz, nz = -ux;
    const mx = (pa[0] + pb[0]) / 2, mz = (pa[1] + pb[1]) / 2;
    const probe = buildingAt(mx + nx * 0.3, mz + nz * 0.3);
    if ((probe && String(probe.osm_id) === String(feature.osm_id)) || (!probe && (mx - cx) * nx + (mz - cz) * nz < 0)) { nx = -nx; nz = -nz; }
    // Right-handed (along, up, out): u then runs to the right of someone outside looking at it.
    if (nx * -uz + nz * ux < 0) { [a, b] = [b, a]; [pa, pb] = [pb, pa]; ux = -ux; uz = -uz; }
    const d = streetDistanceFacing({ x: mx, z: mz, nx, nz });
    const street = d < 40 && !buildingAt(mx + nx, mz + nz);
    walls.push({ a, b, ax: pa[0], az: pa[1], ux, uz, nx, nz, length, height, base, street, streetDistance: street ? d : Infinity });
  }
  // The front first: the street walls, a whole face before a corner's chamfer or a jog in the
  // wall (under three metres), the nearer the street the sooner, a longer face counting for some.
  const rank = (w) => (w.street ? 0 : 2) + (w.street && w.length < 3 ? 1 : 0);
  return walls.sort((p, q) => (rank(p) - rank(q)) || ((p.street ? p.streetDistance - 0.25 * p.length : 0)
    - (q.street ? q.streetDistance - 0.25 * q.length : 0)) || (q.length - p.length));
}
function exteriorWallFromEdit(edit) {
  const feature = buildingWayById.get(String(edit.osm_id));
  if (!feature) return null;
  const near = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;
  const wall = exteriorWalls(feature).find((w) => (near(w.a, edit.wall.a) && near(w.b, edit.wall.b))
    || (near(w.a, edit.wall.b) && near(w.b, edit.wall.a)));
  return wall || null;
}
//: What the page drew on a wall, as the editor's openings: the house's windows and doors and
//: their stoops, the garages behind its kerb cuts, a shop's fronts; and on a wall with nothing
//: known on it, a window a storey for the editor to start from.
function exteriorOpeningsOn(feature, wall) {
  const id = String(feature.osm_id), out = [];
  const project = (x, z, w) => ({ u: (x - wall.ax) * wall.ux + (z - wall.az) * wall.uz - w / 2,
    off: Math.abs((x - wall.ax) * wall.nx + (z - wall.az) * wall.nz) });
  const entry = footprintById.get(id), spec = HOME_RENDER.get(id);
  const layout = entry && spec ? homeWindowLayout(entry, spec) : null;
  for (const edge of layout?.edges || []) {
    for (const o of edge.windows) {
      const cx = edge.a[0] + edge.ux * (o.u + o.w / 2), cz = edge.a[1] + edge.uz * (o.u + o.w / 2);
      const at = project(cx, cz, o.w);
      if (at.off > 0.35 || at.u < -0.2 || at.u + o.w > wall.length + 0.2) continue;
      out.push({ type: "window", u: +at.u.toFixed(2), v: +(o.v - wall.base).toFixed(2), w: +o.w.toFixed(2), h: +o.h.toFixed(2),
        shape: homeWindowArchSpring(o) !== null ? "arched" : "rectangle",
        panes: { cols: (o.design?.vertical_bars?.length || 0) + 1, rows: (o.design?.horizontal_bars?.length || 0) + 1 },
        glass: "#5f7684", frame: o.design?.trim?.colour || "#f2f0ea" });
    }
  }
  for (const d of entry?.doors || []) {
    if (!Number.isFinite(d.cx)) continue;
    const at = project(d.cx, d.cz, d.width);
    if (at.off > 0.6) continue;
    const floor = entryFloorY(entry), rise = d.stoopPlan ? floor - d.stoopPlan.street : 0;
    out.push({ type: "door", u: +at.u.toFixed(2), v: +Math.max(0, floor - wall.base).toFixed(2), w: +d.width.toFixed(2), h: DOOR_HEIGHT_M,
      style: "panel", colour: "#6b3427", recess_m: 0,
      stairs: { steps: rise > 0.08 ? Math.ceil(rise / STEP_RISE_M) : 0, direction: "front", rail: true } });
  }
  if (!out.some((o) => o.type === "door") && feature._frontDoor) {
    const at = project(feature._frontDoor.x, feature._frontDoor.z, 1.05);
    if (at.off < 0.6) out.push({ type: "door", u: +at.u.toFixed(2), v: 0, w: 1.05, h: DOOR_HEIGHT_M, style: "panel",
      colour: "#6b3427", recess_m: 0, stairs: { steps: 0, direction: "front", rail: true } });
  }
  for (const g of feature.garages || []) {
    const [ax, ay] = xy(g.a[0], g.a[1]), [bx, by] = xy(g.b[0], g.b[1]);
    const w = Math.min(g.w || 2.6, wall.length), at = project(ax + (bx - ax) * g.t, -(ay + (by - ay) * g.t), w);
    if (at.off > 1.0) continue;
    out.push({ type: "garage", u: +at.u.toFixed(2), v: 0, w: +w.toFixed(2), h: Number.isFinite(g.h) ? g.h : GARAGE_HEIGHT_M,
      style: "slat", colour: "#8a5a32", recess_m: 0 });
  }
  const shopWall = hasStorefront(feature) ? storefrontWall(feature) : null;
  if (shopWall && Math.hypot(shopWall.x - (wall.ax + wall.ux * wall.length / 2), shopWall.z - (wall.az + wall.uz * wall.length / 2)) < 0.5) {
    for (const bay of shopBays(feature, shopWall)) {
      const [x, z] = [shopWall.x + Math.cos(shopWall.yaw) * bay.centre, shopWall.z - Math.sin(shopWall.yaw) * bay.centre];
      const at = project(x, z, bay.share * 0.97);
      out.push({ type: "shopfront", u: +at.u.toFixed(2), v: 0, w: +(bay.share * 0.97).toFixed(2),
        h: +Math.min(3.6, wall.height - 0.3).toFixed(2), style: "modern", colour: "#1f2a30", door_at: "centre",
        pair: PAIR_DOOR_TRADES.has(bay.trade) });
    }
  }
  if (!out.some((o) => o.type === "window")) {
    const first = out.some((o) => o.type === "shopfront") ? 4.3 : out.some((o) => o.type === "garage") ? 3.2 : 1.0;
    const across = Math.max(1, Math.floor((wall.length - 0.6) / 2.4));
    for (let v = first; v + 1.7 < wall.height; v += 3.0) for (let k = 0; k < across; k += 1) {
      const u = (wall.length * (k + 0.5)) / across - 0.55;
      if (out.some((o) => o.type !== "window" && u < o.u + o.w + 0.2 && u + 1.1 > o.u - 0.2 && v < o.v + o.h + 0.2)) continue;
      out.push({ type: "window", u: +u.toFixed(2), v: +v.toFixed(2), w: 1.1, h: 1.5, shape: "rectangle",
        panes: { cols: 2, rows: 2 }, glass: "#5f7684", frame: "#f2f0ea" });
    }
  }
  return out;
}
//: What a cladding map averages to, as a linear colour: its median texel, so the windows
//: painted on a facade map do not count as wall. A flat map (a painted house) is white.
const WALL_MAP_ALBEDO = new Map();
function wallMapAlbedo(map) {
  const white = new THREE.Color(1, 1, 1);
  const image = map?.image;
  if (!map || map.userData?.flat) return white;
  if (WALL_MAP_ALBEDO.has(map.uuid)) return WALL_MAP_ALBEDO.get(map.uuid);
  if (!image) return white;
  let found = white;
  try {
    const n = 24, canvas = document.createElement("canvas");
    canvas.width = canvas.height = n;
    const c2 = canvas.getContext("2d", { willReadFrequently: true });
    c2.drawImage(image, 0, 0, n, n);
    const px = c2.getImageData(0, 0, n, n).data, ch = [[], [], []];
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k += 1) ch[k].push(px[i + k]);
    const median = (a) => a.sort((p, q) => p - q)[a.length >> 1] / 255;
    found = new THREE.Color().setRGB(median(ch[0]), median(ch[1]), median(ch[2]), THREE.SRGBColorSpace);
  } catch { found = white; } // an unreadable image (not yet decoded, or cross-origin)
  WALL_MAP_ALBEDO.set(map.uuid, found);
  return found;
}
//: The colour a building's wall is drawn in: its vertex tint times its cladding, in linear
//: light, which is what reaches the screen before the lighting. The editor opens on this
//: colour, so opening it changes nothing; a house the page has no record of keeps its own.
function drawnWallColour(feature) {
  const look = BUILDING_WALL_LOOK.get(String(feature.osm_id ?? feature));
  if (!look) return `#${new THREE.Color(HOME_RENDER.get(String(feature.osm_id))?.tint ?? (feature.colour || 0xc8c2b8)).getHexString()}`;
  return `#${new THREE.Color(look.tint).multiply(wallMapAlbedo(look.map)).getHexString()}`;
}
//: The editor's wall skin in the world's own finish: the same cladding (where the map has no
//: painted windows, which the editor draws as real openings), roughness and reflection, tinted
//: so that it averages to the chosen colour. Left as it opened, it is the world's wall exactly.
function exteriorWallMaterial(colour, edit, wall) {
  const look = BUILDING_WALL_LOOK.get(String(edit?.osm_id));
  if (!look) return null;
  const albedo = wallMapAlbedo(look.map);
  const painted = new THREE.Color(colour);
  const unchanged = painted.getHexString() === new THREE.Color(look.tint).multiply(albedo).getHexString();
  const need = [painted.r / Math.max(albedo.r, 1e-3), painted.g / Math.max(albedo.g, 1e-3), painted.b / Math.max(albedo.b, 1e-3)];
  const tint = unchanged ? new THREE.Color(look.tint) : new THREE.Color(...need);
  // A colour the cladding cannot be tinted to (paler or bluer than the brick allows) is paint
  // laid over it: flat, in the world's finish.
  const reachable = unchanged || need.every((c) => c <= 1.0001);
  const bare = reachable && look.map && (look.map.userData?.bare || look.map.userData?.flat);
  let map = null;
  if (bare) {
    map = look.map.clone();
    map.userData = { ...map.userData, editClone: true };   // this wall's own: freed with the edit
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set((wall?.length || 4) / BAY_M, (wall?.height || look.storey) / look.storey);
    map.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({
    color: bare ? tint : painted, map, roughness: look.rough, metalness: look.metal,
    envMapIntensity: look.env,
  });
}
function exteriorEditorContext() {
  return {
    THREE,
    wallsOf: exteriorWalls,
    wallFromEdit: exteriorWallFromEdit,
    openingsOn: exteriorOpeningsOn,
    wallColourOf: drawnWallColour,
    wallMaterial: exteriorWallMaterial,
    wallColour: "#c8c2b8",
    groundAt: (x, z) => terrainGroundAt(x, z),
    publishedEdit: (id) => publishedExteriorEdit(id),
    // An edit's stairs are ground: the walker climbs them like a stoop (exterior-editor stairSurface).
    addToWorld: (group) => {
      exteriorEditRoot.add(group);
      for (const surface of group.userData.standing || []) standingSurfaces.add(surface);
    },
    removeFromWorld: (group) => {
      group.parent?.remove(group);
      for (const surface of group.userData.standing || []) standingSurfaces.delete(surface);
      group.traverse((o) => { o.geometry?.dispose(); });
      // Its materials are its own (the shared door and garage pictures are not), and so is the
      // cladding cut to this wall's size: the editor redraws on every change, and each drawing
      // left behind had kept its materials and a copy of the texture on the GPU.
      for (const m of group.userData.materials || []) {
        if (m?.map?.userData?.editClone) m.map.dispose();
        m?.dispose?.();
      }
    },
    lookAtWall: (wall) => {
      if (state.firstPerson) setFirstPerson(false);
      const mx = wall.ax + wall.ux * wall.length / 2, mz = wall.az + wall.uz * wall.length / 2;
      state.target.set(mx, wall.base + Math.min(wall.height / 2, 6), mz);
      state.yaw = Math.atan2(wall.nx, wall.nz);
      state.pitch = 0.1;
      state.dist = Math.max(9, Math.min(60, Math.max(wall.length * 1.3, wall.height * 1.25)));
      placeCamera();
    },
    hideOriginal: (feature) => {
      const drawn = exteriorEditGroups.get(String(feature.osm_id));
      if (drawn) drawn.visible = false;
      // The editor's preview stands in for it, stairs and all.
      for (const surface of drawn?.userData.standing || []) standingSurfaces.delete(surface);
    },
    editsChanged: (id, edit) => drawSavedExteriorEdit(id, edit === undefined ? newerEdit(publishedExteriorEdit(id), localExteriorEdits()[id]) : edit),
    renderWallStill,
    pauseWorld: (paused) => { worldPaused = paused; if (!paused) requestFrame(); },
    notify: (text) => { if (addrBox) { addrBox.textContent = text; addrBox.hidden = false; } },
  };
}
async function drawSavedExteriorEdit(id, edit) {
  const old = exteriorEditGroups.get(id);
  if (old) { exteriorEditorContext().removeFromWorld(old); exteriorEditGroups.delete(id); }
  if (!edit) return;
  const library = await exteriorEditorLibrary();
  const context = exteriorEditorContext();
  const group = library.drawEdit(context, edit);
  if (group) { context.addToWorld(group); exteriorEditGroups.set(id, group); }
}
//: A building in the region drawn beside the page is that region's: its walls, its windows, its
//: ground and the world its edit is drawn into are the region's own (its exteriorEditorContext),
//: and only the camera and the still are the page's, in the page's metres. Taken from the page's
//: own context, a region's building had no wall to draw on: every edit of it, the preview as you
//: tap and the saved edit after, drew nothing.
function guestWallToHost(g, w) {
  let ux = w.ux * g.sx, uz = w.uz, nx = w.nx / g.sx, nz = w.nz;
  const s = Math.hypot(ux, uz) || 1, t = Math.hypot(nx, nz) || 1;
  ux /= s; uz /= s; nx /= t; nz /= t;
  return { ...w, ax: w.ax * g.sx + g.ox, az: w.az + g.oz, ux, uz, nx, nz, length: w.length * s, base: w.base + g.oy };
}
function exteriorEditorContextFor(featureOrId) {
  const host = exteriorEditorContext();
  const id = String(featureOrId?.osm_id ?? featureOrId);
  const g = activeGuest;
  if (buildingWayById.has(id) || !g?.ready || !g.api.hasExteriorBuilding?.(id)) return host;
  const inner = g.api.exteriorEditorContext();
  return { ...inner,
    lookAtWall: (wall) => host.lookAtWall(guestWallToHost(g, wall)),
    renderWallStill: (wall, canvas) => renderWallStill(guestWallToHost(g, wall), canvas),
    pauseWorld: host.pauseWorld, notify: host.notify };
}
async function openExteriorEditor(feature) {
  if (META || !feature || feature.kind !== "building") return;
  hideAddress();
  const [library, account] = await Promise.all([exteriorEditorLibrary(), accountLibrary().catch(() => null)]);
  library.open({ ...exteriorEditorContextFor(feature), account }, feature);
}
//: While the editor covers the screen the live view is not drawn (the world still streams and
//: builds round the wall it looks at); the editor's still is drawn instead.
var worldPaused = false;
const stillCamera = new THREE.PerspectiveCamera(50, 1, 0.3, 6000);
//: The wall being edited, seen square-on from the street, rendered into ``canvas``: the page's own
//: renderer from a camera of its own, the part of the frame the canvas shows cut from it. Things
//: between the camera and the wall more than three metres out from it (street trees, a parked
//: van) are left out by the near plane, so the wall is what you see.
function renderWallStill(wall, canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(rect.width * ratio)), h = Math.max(2, Math.round(rect.height * ratio));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const source = renderer.domElement, sw = source.width, sh = source.height;
  if (!sw || !sh) return false;
  const target = w / h, sourceAspect = sw / sh;
  const cropW = target < sourceAspect ? sh * target : sw, cropH = target < sourceAspect ? sh : sw / target;
  const fh = cropH / sh, tan = Math.tan((stillCamera.fov * Math.PI) / 360);
  const needH = (wall.height + 1.4) * 1.12, needW = wall.length * 1.25;
  const visible = Math.max(needH, needW / target) / fh;
  const distance = Math.max(6, visible / (2 * tan));
  const mx = wall.ax + wall.ux * wall.length / 2, mz = wall.az + wall.uz * wall.length / 2;
  const ground = wall.base, eye = ground + Math.min(wall.height * 0.45, 1.7 + distance * 0.08);
  stillCamera.aspect = sourceAspect;
  // A street wall has the street in front of it: trees and vans more than three metres out are
  // cut by the near plane. A side or back wall has the neighbour's house against it, so the cut
  // is at its own face (the near plane is square to the wall), and the wall shows, not next door.
  stillCamera.near = Math.max(0.3, distance - (wall.street ? 3.0 : 0.25));
  // Only the street round the wall is drawn: the rest of the world is culled by the far plane
  // (the sky is the scene's background, not geometry), so a still costs a block, not the city.
  stillCamera.far = distance + 320;
  stillCamera.position.set(mx + wall.nx * distance, eye, mz + wall.nz * distance);
  stillCamera.lookAt(mx, ground + wall.height / 2, mz);
  stillCamera.updateProjectionMatrix();
  const walkerShown = avatar.visible;
  avatar.visible = false;
  // Nobody's rooms in the picture: a bed against the party wall next door is not this wall.
  const roomsShown = interiorGroup.visible;
  interiorGroup.visible = false;
  renderer.render(scene, stillCamera);
  interiorGroup.visible = roomsShown;
  avatar.visible = walkerShown;
  const g = canvas.getContext("2d");
  g.drawImage(source, (sw - cropW) / 2, (sh - cropH) / 2, cropW, cropH, 0, 0, w, h);
  // The wall being edited, picked out: the rest of the picture dimmed and the wall outlined, so
  // which of a house's walls this is cannot be mistaken.
  const corners = [[0, 0], [wall.length, 0], [wall.length, wall.height], [0, wall.height]].map(([u, v]) => {
    const p = new THREE.Vector3(wall.ax + wall.ux * u, wall.base + v, wall.az + wall.uz * u).project(stillCamera);
    return [((p.x + 1) / 2 * sw - (sw - cropW) / 2) * w / cropW, ((1 - p.y) / 2 * sh - (sh - cropH) / 2) * h / cropH];
  });
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = "rgba(8,12,18,0.42)";
  g.fill("evenodd");
  g.beginPath();
  corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.lineWidth = Math.max(2, 3 * ratio);
  g.strokeStyle = "#ffb547";
  g.setLineDash([10 * ratio, 6 * ratio]);
  g.stroke();
  g.restore();
  return true;
}
//: The way into the editor from a building's card: a button on it.
function offerExteriorEdit(feature) {
  if (META || !addrBox || addrBox.hidden || feature?.kind !== "building") return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "addr-edit";
  button.textContent = "Edit exterior";
  button.title = "Correct this building's front: windows, doors, garages, stairs (E)";
  button.addEventListener("click", () => openExteriorEditor(feature));
  addrBox.append(document.createElement("br"), button);
  addrBox.style.pointerEvents = "auto";
}
if (!META) {
  canvas.addEventListener("contextmenu", (e) => {
    if (cityGame()) return;
    const feature = pickedFeature(e.clientX, e.clientY);
    if (feature?.kind === "building" && showAddress(feature, e.clientX, e.clientY)) offerExteriorEdit(feature);
  });
  addEventListener("keydown", (e) => {
    if ((e.key !== "e" && e.key !== "E") || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || !pointerAt) return;
    if (cityGame()) return;   // the exterior editor is Explore's
    const feature = pickedFeature(...pointerAt);
    if (feature?.kind === "building") openExteriorEditor(feature);
  });
  for (const id of EXTERIOR_EDITS.keys()) drawSavedExteriorEdit(id, EXTERIOR_EDITS.get(id));
}

// Other people's walkers in the same world (docs/multiplayer.mjs): a room is a link, the walkers
// travel peer to peer, and there is no server of ours. Not on the headset or a guest region.
var multiplayer = { session: null };
{
  const button = document.getElementById("play-together");
  if (META || ATTACH) button?.remove();
  else {
    const library = () => import(sharedAsset("multiplayer.mjs?rev=__MULTIPLAYER_HASH__"));
    let was = null; // the walker's last place, to tell walking from standing
    const context = {
      THREE, root, buildAvatar: buildCharacterAvatar, avatarScale: AVATAR_SCALE, standY: AVATAR_STAND_Y,
      page: location.pathname,
      me: () => {
        const p = avatar.position, moving = Boolean(was) && Math.hypot(p.x - was.x, p.z - was.z) > 0.01;
        was = { x: p.x, z: p.z };
        return { x: p.x, z: p.z, feet: p.y - AVATAR_STAND_Y, yaw: livingCity?.driving ? state.yaw : avatar.rotation.y, moving,
          stairs: moving && Boolean(avatar.userData.onStairs), car: livingCity?.carState?.() || null };
      },
      // A walker in a car is drawn as the car (docs/city/view.mjs).
      placeCar: (peer, s) => livingCity?.placePeerCar(peer, s),
      toLonLat: (x, z) => [x / metersPerLon + midLon, -z / metersPerLat + midLat],
      fromLonLat: (lon, lat) => { const [x, y] = xy(lon, lat); return [x, -y]; },
      groundAt: (x, z) => walkerGroundAt(x, z),
      requestFrame,
    };
    Object.assign(multiplayer, {
      goTo: (x, z) => goTo(new THREE.Vector3(x + 1.5, 0, z + 1.5), { travel: true, zoom: true }),
      notify: (text) => { if (addrBox) { addrBox.textContent = text; addrBox.hidden = false; } },
    });
    const listeners = new Set();
    const told = () => { for (const fn of listeners) try { fn(); } catch {} };
    Object.assign(multiplayer, {
      onJoin: (session) => { button?.setAttribute("aria-pressed", "true"); session?.onChange(told); told(); },
      onLeave: () => { button?.setAttribute("aria-pressed", "false"); told(); },
      // For the home screen: join a party by code (a new one when empty), leave it, hear of it.
      join: async (code, name) => {
        const lib = await library();
        multiplayer.session?.leave();
        multiplayer.session = await lib.join(context, { room: lib.cleanRoomCode(code) || lib.newRoomCode(), name: lib.cleanName(name) || "Walker" });
        multiplayer.onJoin(multiplayer.session);
        return multiplayer.session;
      },
      leave: () => { multiplayer.session?.leave(); multiplayer.session = null; multiplayer.onLeave(); },
      listen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    });
    const open = async (room) => (await library()).openPanel(context, multiplayer, { room });
    button?.addEventListener("click", () => open());
    const invited = new URLSearchParams(location.search).get("room");
    if (invited) open(invited);
    addEventListener("pagehide", () => multiplayer.session?.leave());
  }
}

// ---- the home screen's side of the page ----------------------------------------------------------
//
// What docs/home-lobby.mjs asks of the page. Called as the page starts, before most of the world
// exists: anything that needs the world waits for its first frame (WORLD_READY).
var worldReadyNow = false;
WORLD_READY.then(() => { worldReadyNow = true; if (!contributorMode) setContributorMode(false); });
//: The avatar's look (home-lobby LOOKS): its outfit tints the walker; a ring at its feet in its
//: team's colour.
var walkerLook = null;
function applyWalkerLook(look) {
  walkerLook = look;
  if (typeof avatar === "undefined" || !look) return;
  showWalkerFigure(look);
  // The Soldier's own colours (a creator figure tints its outfit itself).
  const soldier = avatar.getObjectByName("soldier-figure") || avatar.getObjectByName("imported-realistic-demo-character");
  soldier?.traverse((node) => {
    if (!node.isMesh || node.name === "contact-shadow" || node.userData.teamRing) return;
    if (!avatar.userData.demoCharacterLoaded || !node.parent || node.parent === avatar) return;
    node.userData.baseColour ??= node.material.color.getHex();
    if (!node.userData.ownMaterial) { node.material = node.material.clone(); node.userData.ownMaterial = true; }
    node.material.color.set(node.userData.baseColour).multiply(new THREE.Color(look.outfit));
  });
  let ring = avatar.children.find((c) => c.userData.teamRing);
  if (!ring) {
    ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 48),
      new THREE.MeshBasicMaterial({ color: look.team, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.86;
    ring.userData.teamRing = true;
    avatar.add(ring);
  }
  ring.material.color.set(look.team);
}
if (!META && !ATTACH) homeLibrary().then((home) => applyWalkerLook(home.loadLook())).catch(() => {});
//: Contributor layers: the survey's own, for people building the map.
var CONTRIBUTOR_LAYERS = ["coverage", "observations", "sequences", "kerbs", "official", "chunks", "gaps"];
var CONTRIBUTOR_DEFAULT_ON = new Set(["coverage", "observations", "sequences", "kerbs"]);
function setContributorMode(on) {
  contributorMode = on;
  try { localStorage.setItem(CONTRIBUTOR_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  document.body.classList.toggle("contributor", on);
  if (!worldReadyNow) return;
  for (const layer of CONTRIBUTOR_LAYERS) {
    if (!groups[layer]) continue;
    const visible = on && CONTRIBUTOR_DEFAULT_ON.has(layer);
    if (visible) ensureLazyLayer(layer);
    groups[layer].visible = visible;
    document.querySelector(`button[data-layer="${layer}"]`)?.setAttribute("aria-pressed", String(visible));
  }
  requestFrame();
}
//: Where Explore world puts you: a place you chose, kept on this device.
var SPAWN_KEY = "kerbside:spawn";
function readSpawn() {
  try {
    const spawn = JSON.parse(localStorage.getItem(SPAWN_KEY) || "null");
    return spawn && Number.isFinite(spawn.lon) && Number.isFinite(spawn.lat) ? spawn : null;
  } catch { return null; }
}
function spawnLabelAt(x, z) {
  let best = null;
  for (const c of DATA.intersections || []) {
    if (!c.a || !c.b) continue;
    const [cx, cy] = xy(c.lon, c.lat), d = Math.hypot(cx - x, -cy - z);
    if (!best || d < best.d) best = { d, label: `${c.a} & ${c.b}` };
  }
  return best && best.d < 250 ? `Near ${best.label}` : null;
}
function spawnHere() {
  if (!worldReadyNow) return false;
  const lon = avatar.position.x / metersPerLon + midLon, lat = -avatar.position.z / metersPerLat + midLat;
  const spawn = { lon: +lon.toFixed(7), lat: +lat.toFixed(7), yaw: state.yaw,
    label: spawnLabelAt(avatar.position.x, avatar.position.z), page: location.pathname };
  try { localStorage.setItem(SPAWN_KEY, JSON.stringify(spawn)); } catch { return false; }
  return spawn;
}
var spawnApplied = false;
function applySpawn() {
  const spawn = readSpawn();
  if (!spawn || spawnApplied) return;
  spawnApplied = true;
  const [x, y] = xy(spawn.lon, spawn.lat);
  if (!tileOwnGround(spawn.lon, spawn.lat)) window.kerbsideOpenFullRegionAt?.(spawn.lon, spawn.lat);
  goTo(new THREE.Vector3(x, 0, -y), { travel: true, zoom: true });
  if (Number.isFinite(spawn.yaw)) { state.yaw = spawn.yaw; placeCamera(); }
}
function homeContext() {
  const afterReady = (fn) => (...args) => WORLD_READY.then(() => fn(...args));
  return {
    THREE, GLTFLoader, modelUrl: WALKER_MODEL_URL, avatars: avatarBuilder,
    regionTitle: document.title.replace(/^Kerbside\s*/, "").replace(/\s*3D$/, ""),
    account: null,
    multiplayer: {
      session: () => (typeof multiplayer !== "undefined" && multiplayer?.session) || null,
      join: async (code, name) => { await WORLD_READY; return multiplayer.join(code, name); },
      leave: () => { if (worldReadyNow) multiplayer.leave(); },
      onChange: (fn) => {
        let off = null, gone = false;
        WORLD_READY.then(() => { if (!gone) off = multiplayer.listen(fn); fn(); });
        return () => { gone = true; off?.(); };
      },
    },
    look: { set: afterReady((look) => applyWalkerLook(look)) },
    spawn: {
      get: readSpawn,
      useWalker: () => { const spawn = spawnHere(); if (spawn) stagedSpawn = JSON.stringify(readSpawn()); return spawn; },
      clear: () => { try { localStorage.removeItem(SPAWN_KEY); } catch { /* private mode */ } WORLD_READY.then(stageWorld); },
      pickInWorld: afterReady(() => homeModule.then((home) => home.spawnBar({
        onSet: () => { const spawn = spawnHere(); if (spawn) stagedSpawn = JSON.stringify(readSpawn()); if (addrBox && spawn) { addrBox.textContent = `Spawn point set${spawn.label ? `: ${spawn.label}` : ""}.`; addrBox.hidden = false; } },
      }))),
    },
    contributor: { get: () => contributorMode, set: (on) => setContributorMode(on) },
    openMap: afterReady(() => { const fold = document.getElementById("fold"); if (fold && fold.getAttribute("aria-expanded") !== "true") fold.click(); }),
    openSettings: afterReady(() => document.getElementById("settings-toggle")?.click()),
    openCapture: () => window.open(new URL("/app.html", location.origin).href, "_blank", "noopener"),
    //: Loaded through (WORLD_LOADED), not just drawn: the lobby lets no one in before.
    whenReady: () => WORLD_LOADED,
    //: How far along, 0..1, for the loading screen's bar (loadFraction).
    fraction: loadFraction,
    //: How the world is coming on: the page's own progress line while it builds, then what it is
    //: still fetching round the spawn (null once it is all in).
    progress: () => {
      const box = document.getElementById("progress");
      const drawing = box && !box.hidden && box.textContent.trim();
      if (drawing) return drawing;
      if (worldLoadedNow) return null;
      if (!worldReadyNow) return "Drawing the world";
      const waiting = worldLoadWaiting();
      return waiting.length ? `Loading ${waiting.join(", ")}` : "Settling the world";
    },
    onOpen: () => {
      document.body.classList.add("home-open");
      tellAppShell(true);
      WORLD_READY.then(() => { if (document.body.classList.contains("home-open")) stageWorld(); });
    },
    onClose: ({ enter }) => { document.body.classList.remove("home-open"); tellAppShell(false); if (enter) WORLD_READY.then(stageWorld); },
  };
}
//: The app (docs/app.html) holds the model in a frame; its tab bar stands aside for the home screen.
function tellAppShell(open) {
  try { if (window.parent !== window) window.parent.postMessage({ kerbside: "home", open }, location.origin); } catch { /* not ours */ }
}
//: Where Explore world puts you -- the spawn point if one is set, otherwise down to the walker
//: where it stands -- taken while the home screen is still up: the camera goes there behind the
//: lobby, so the street-level detail streams in while you choose, and Explore world has only to
//: lift the lobby off it. Taken once per spawn point: back home and out again leaves you where
//: you were.
var stagedSpawn;
function stageWorld() {
  const spawn = readSpawn(), key = JSON.stringify(spawn), fresh = stagedSpawn !== key;
  stagedSpawn = key;
  if (spawn) {
    if (fresh) { spawnApplied = false; applySpawn(); }
  } else if (fresh || Math.hypot(state.target.x - avatar.position.x, state.target.z - avatar.position.z) > 30) {
    // The walker, wherever it has got to since (a location fix can move it after the first frame).
    state.target.copy(avatar.position);
    state.dist = ARRIVAL_DIST;
    state.pitch = Math.min(state.pitch, 0.45);
    placeCamera();
  }
  requestFrame();
}
//: Loaded through, not only drawn. The first frame (WORLD_READY) says the world can be seen;
//: this says everything round the spawn is in and working -- its square of detail attached, the
//: cells, ground tiles and facade pictures fetched, the walker's figure and the object catalogue
//: (what stops it) loaded -- and has stayed so for a moment, since the detail check asks for the
//: next square a beat after the camera moves. The home screen holds every way into the world
//: until then (the owner, 2026-10-31: never into a world still assembling, however finished
//: it looks).
const SETTLED_FOR_MS = 2000;
let catalogueSettled = false;
objectCatalogueReady.finally(() => { catalogueSettled = true; });
function worldLoadWaiting() {
  const waiting = [];
  if (!worldReadyNow) return ["drawing the world"];
  const cells = worldCellCache.snapshot();
  if (attaching || attachWanted) waiting.push("the streets round you");
  if (activeGuest && !activeGuest.ready) waiting.push(activeGuest.region?.title || "the region round you");
  if (cells.active || cells.queued) waiting.push(`map cells (${(cells.active || 0) + (cells.queued || 0)})`);
  if (tileInFlight || tileQueue.length) waiting.push(`ground (${tileInFlight + tileQueue.length} tiles)`);
  if (facadeQueue.length || facadeInFlight) waiting.push(`facades (${facadeQueue.length + facadeInFlight})`);
  if (avatar.userData.demoCharacterLoaded === undefined) waiting.push("your walker");
  if (!catalogueSettled) waiting.push("what stops the walker");
  // The street furniture and the freeway signs open with the city (groups.furniture), asked for
  // once the ground is down: held for too, until they are drawn or given up on.
  if (groups.furniture.visible && !window.kerbsideReady?.ground) waiting.push("the ground");
  if (groups.furniture.visible) for (const [layer, label] of [["furniture", "street furniture"], ["highway_signs", "freeway signs"]]) {
    if (lazyLayersWanted.has(layer) && lazyLayerBuilders.has(layer) && !lazyLayersSettled.has(layer)) waiting.push(label);
  }
  return waiting;
}
WORLD_READY.then(() => {
  let settledSince = 0;
  const check = () => {
    const now = performance.now();
    if (worldLoadWaiting().length) settledSince = 0;
    else settledSince ||= now;
    if (settledSince && now - settledSince >= SETTLED_FOR_MS) { worldLoadedNow = true; worldLoaded(); return; }
    setTimeout(check, 250);
  };
  check();
});
window.kerbsideLoadState = () => ({ loaded: worldLoadedNow, waiting: worldLoadedNow ? [] : worldLoadWaiting() });
pageIsReady();

window.kerbside = {
  scene, camera, renderer, groups, DATA, DETAIL_MANIFEST, fullDetailFeature, detailKey,
  TILES, tileStats, updateTileTree, selectTiles, tileScreenErrorPx, tilePriority, tileGroupRoot,
  tunnelFloorAt, walkerGroundAt, tunnelBores, terrainHeightAt, groundLiftAt, TERRAIN,
  cutLiftAt, approachRoadAt, wayFollowsCut, APPROACH_CUTS, junctionBoxHulls,
  goTo, setFirstPerson, placeCamera, state, avatar, roadSurfacesAt, routeSurfaceHeights, elevatedRoadsAt, elevatedDecksAt, structuresAt, walkerGroundInfo, walkPace, publicStairs, publicStairAt,
  outsideTerrainGrid, drawnGroundAt, returnToGps, GPS_LEASH, gps, followGps, onCrossingGround, busZonePieces, treeVariant, homeWindowLayout, HOME_RENDER, cullDetailByDistance, DETAIL_RANGE_M, mergeStats, THREE,
  xy, insideCarriageway, buildingAt,
  moveWalker, wallSegmentsNear, nearestDoor, doorsNear, toggleDoor, footprintById, requestInteriors, buildInterior,
  pickedFeature, openExteriorEditor, exteriorEditGroups, buildingWayById, multiplayer,
  // The landscape (forest floor, scans) and the globe, for inspection.
  get natureWorld() { return natureWorld; }, get globe() { return globe; }, get activeGuest() { return activeGuest; },
  get deckLevels() { return DECK_LEVEL_REPORT; }, deckEdgeSegmentsNear,
  // Ponds, fountains and lakes drawn at their own level (INLAND_WATER), for inspection.
  get inlandWater() {
    const f = TERRAIN_FRAME;
    return INLAND_WATER.map((w) => {
      let e = 0, n = 0;
      for (const i of w.body.cells) { e += i % f.cols; n += Math.floor(i / f.cols); }
      const [x, z] = terrainToPage(f.x0 + (e / w.body.cells.length + 0.5) * f.step_m, f.y0 + (n / w.body.cells.length + 0.5) * f.step_m, f);
      return { x, z, level: w.level, cells: w.body.cells.length, outline: Boolean(w.rings) };
    });
  },
  // The corner pieces: how many cuts were decided and how many pieces laid between them.
  recentred,
  junctionBoxes, insideJunctionBox, rampRecordAt, indexCurbRamps, cornerOf,
  kerbVerticesDropped,
  nearestKerbAt, furnitureAnchor, bestFacadeWall, wallPoint, shopBays, carriagewayGrid, CARRIAGEWAY_CELL,
  pavementTopAt, parkingLayout, rayCurbIntersections, officialCurbGrid, officialKerbOffsetsAt,
  mappedWalkBeyondKerb, mappedWalkGrid, MAPPED_WALK_CELL, crossingRoadSpanPoints, crossingPaintLegs,
  officialIslandCurbGrid, officialMedianGrid, isDividedHalf, recentreOnKerbEnvelope, envelopeEdgesAt, sameLevel, roadwayCovered, roadFillGrid, filledAt, cornerLegs, cornerLegsAt, cornerNeighbour, bulbDepthAt, legBulb, cornerQuad, pavementCornerCuts,
  crossingDrawGrid, sidewalkCrossingReplacementSpans, crossingDrawPose, densifyWay, crossingRectanglePoints,
  twinInnerEdgeAt, halfWidthAt, filletBends, bendsFilleted, tunnelCoveredPoints, tunnelApproachWidth,
  corners: { cuts: pavementCornerCuts.size, valid: [...pavementCornerCuts.values()].filter((c) => c.valid).length,
             laid: cornersLaid, legs: cornerLegs.length,
             ends: pavementCornerLaid.size, skipped: addPavementCorners.skipped,
             squares: squaresLaid, squaresSkipped: addJunctionSquares.skipped },
  junctionSquares, treeIslands: treeIslandStats, pavementSurfaceAt, frontageFill: frontageStats,
  cornersAt(lon, lat, reach = 3.0) {
    // The legs at a junction, with what was decided and laid at each: for looking at one.
    const [x, y] = xy(lon, lat);
    return cornerLegs.filter((leg) => Math.hypot(leg.x - x, leg.y - y) <= reach).map((leg) => ({
      id: leg.id, name: leg.way.name, bearing: +(leg.bearing * 180 / Math.PI).toFixed(1),
      inner: +leg.inner.toFixed(2), walk: +leg.walk.toFixed(2), length: +leg.length.toFixed(1),
      boxExit: leg.boxExit, internal: !!leg.way._junctionInternal,
      sides: Object.fromEntries([1, -1].map((side) => {
        const c = pavementCornerCuts.get(`${leg.id}:${side}`);
        const l = pavementCornerLaid.get(`${leg.id}:${side}`);
        return [side, {
          neighbour: c ? c.B.id : null, cut: c ? +c.cut.toFixed(2) : null, valid: c ? c.valid : null,
          tK: c ? +c.tK.toFixed(2) : null, tO: c ? +c.tO.toFixed(2) : null,
          laid: l ? +l.width.toFixed(2) : null,
        }];
      })),
    }));
  },

  /** A photograph of one place, from a camera this call positions. */
  /** The camera one shot would be taken with, without taking it: what the tile tree is
      settled against before a contact sheet is made. */
  shootCamera({ lon, lat, from = 180, tilt = 52, heading = 30, w = 720, h = 405, fov = 45,
                targetY = null } = {}) {
    const [x, y] = xy(lon, lat);
    const target = new THREE.Vector3(x, targetY === null ? groundLiftAt(x, -y) : targetY, -y);
    const yaw = (heading * Math.PI) / 180;
    const pitch = (tilt * Math.PI) / 180;
    const cam = new THREE.PerspectiveCamera(fov, w / h, 0.5, FAR_M);
    cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * from,
                     target.y + Math.sin(pitch) * from,   // above the ground the target is on
                     target.z + Math.cos(yaw) * Math.cos(pitch) * from);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    return cam;
  },

  shoot(spec = {}) {
    const { w = 720, h = 405, quality = 0.72 } = spec;
    const cam = window.kerbside.shootCamera(spec);
    // The tile tree is measured from the eye it is seen with.
    updateTileTree(performance.now(), cam);
    // One renderer, kept. A browser gives a page about sixteen WebGL contexts and does not
    // hand them back on dispose() as promptly as the next call needs them: building a fresh
    // renderer per photograph exhausted them after a dozen shots, and the page that came up
    // next could not get a context for the map itself. That failure looks exactly like a
    // build that has broken.
    if (!this._shot) {
      this._shot = new THREE.WebGLRenderer({
        antialias: true, alpha: false, logarithmicDepthBuffer: true,
        preserveDrawingBuffer: true,
      });
      this._shot.setPixelRatio(1);
      this._shot.outputColorSpace = renderer.outputColorSpace;
      this._shot.toneMapping = renderer.toneMapping;
      this._shot.toneMappingExposure = renderer.toneMappingExposure;
    }
    this._shot.setSize(w, h, false);
    // The environment map belongs to the map's own WebGL context; a second renderer cannot
    // read it, and glass and metal with nothing to reflect come out black. Every curtain-wall
    // building in a photograph was a black block for that reason, and the fault was reported
    // as one in the model. The photograph renderer keeps a sky of its own.
    if (!this._shotEnvironment) this._shotEnvironment = skyEnvironment(this._shot, SKY);
    const environment = scene.environment;
    scene.environment = this._shotEnvironment;
    // The fine surfaces are culled by distance from the map's camera; the photograph is taken
    // from its own, so they are culled for it, and put back for the map's next frame.
    cullDetailByDistance(0, cam);
    cullLabelsByDistance(0, cam);
    try {
      this._shot.render(scene, cam);
    } finally {
      scene.environment = environment;
      cullDetailByDistance(0);
    }
    return this._shot.domElement.toDataURL("image/jpeg", quality);
  },

  /** What is standing at a point on the ground, straight down from above.
   *
   * Only what is being drawn. The survey layers -- coverage cells at ninety metres, sequence
   * paths at thirty-two -- are in the scene and switched off, and a raycast does not care that
   * a thing is invisible. Counting those as "what is on the ground here" is how an audit comes
   * back saying half the corridor is covered in something it cannot name.
   */
  probe(lon, lat) {
    const [x, y] = xy(lon, lat);
    const down = new THREE.Raycaster(new THREE.Vector3(x, 400, -y),
                                     new THREE.Vector3(0, -1, 0), 0.1, 900);
    // Sprites ask the raycaster which camera is looking at them, and there is no answer unless
    // one is handed over -- the street labels are sprites, so without this the probe throws
    // before it reaches the first piece of ground.
    down.camera = camera;
    const stack = [];
    for (const hit of down.intersectObject(root, true)) {
      let node = hit.object;
      let hidden = false;
      let label = null;
      let kind = null;
      while (node) {
        if (node.visible === false) { hidden = true; break; }
        if (!label && node.userData && node.userData.surface) label = node.userData.surface;
        if (!kind && node.userData && node.userData.kind) kind = node.userData.kind;
        node = node.parent;
      }
      if (hidden) continue;
      if (hit.object.type === "Sprite") continue;
      stack.push({ what: label || kind || "unnamed", y: +hit.point.y.toFixed(3) });
      if (stack.length >= 6) break;
    }
    return { x: +x.toFixed(2), z: +(-y).toFixed(2), road: insideCarriageway(x, -y, 0), stack };
  },

  /** The two things that keep going wrong, counted rather than eyeballed.
   *
   * Nothing may stand on the carriageway that is not carriageway, and there must be pavement
   * where a pavement belongs. Both have regressed more than once from opposite directions -- a
   * guard so tight it deleted 63 km of footway, and ground cover so loose it laid front paths
   * down the middle of the road -- and neither shows up in any test that reads the source.
   * This walks the streets themselves and reports what is actually drawn.
   */
  audit({ every = 5, alongEvery = 25.0 } = {}) {
    const streets = DATA.ways.filter((w) => w.kind === "street" && w.points
                                            && w.points.length > 1);
    const PAVED = new Set(["road", "crossing", "crossing_edges", "marking", "apron"]);
    const intruders = {};
    const missing = { sampled: 0, bare: 0, examples: [] };
    let onRoad = 0;
    for (let s = 0; s < streets.length; s += every) {
      const way = streets[s];
      const half = (way.road_m || 8.0) / 2;
      for (let i = 1; i < way.points.length; i += 1) {
        const a = way.points[i - 1];
        const b = way.points[i];
        const [ax, ay] = xy(a[0], a[1]);
        const [bx, by] = xy(b[0], b[1]);
        const span = Math.hypot(bx - ax, by - ay);
        const steps = Math.max(1, Math.round(span / alongEvery));
        const nx = -(by - ay) / (span || 1);
        const ny = (bx - ax) / (span || 1);
        for (let k = 0; k < steps; k += 1) {
          const t = (k + 0.5) / steps;
          const lon = a[0] + (b[0] - a[0]) * t;
          const lat = a[1] + (b[1] - a[1]) * t;
          const [px, py] = xy(lon, lat);
          // In the roadway: whatever is on top had better be roadway.
          for (const across of [-half * 0.55, 0, half * 0.55]) {
            const qx = px + nx * across;
            const qy = py + ny * across;
            if (!insideCarriageway(qx, -qy, 0.6)) continue;
            onRoad += 1;
            const top = this.probeXY(qx, qy)[0];
            if (top && !PAVED.has(top.what)) {
              intruders[top.what] = (intruders[top.what] || 0) + 1;
            }
          }
          // Just outside the kerb: there had better be a footway.
          for (const side of [1, -1]) {
            const qx = px + nx * side * (half + 1.4);
            const qy = py + ny * side * (half + 1.4);
            if (insideCarriageway(qx, -qy, 0.2)) continue;
            missing.sampled += 1;
            const top = this.probeXY(qx, qy)[0];
            if (!top || (top.what !== "walk_underlay" && top.y < 0.02)) {
              missing.bare += 1;
              if (missing.examples.length < 12) {
                missing.examples.push({ street: way.name || way.osm_id, lon, lat });
              }
            }
          }
        }
      }
    }
    return {
      inRoadway: { sampled: onRoad, intruders },
      besideKerb: { sampled: missing.sampled, bare: missing.bare,
                    share: missing.sampled ? +(missing.bare / missing.sampled).toFixed(3) : 0,
                    examples: missing.examples },
    };
  },

  probeXY(x, y) {
    const down = new THREE.Raycaster(new THREE.Vector3(x, 400, -y),
                                     new THREE.Vector3(0, -1, 0), 0.1, 900);
    down.camera = camera;
    const stack = [];
    for (const hit of down.intersectObject(root, true)) {
      let node = hit.object;
      let hidden = false;
      let label = null;
      let kind = null;
      while (node) {
        if (node.visible === false) { hidden = true; break; }
        if (!label && node.userData && node.userData.surface) label = node.userData.surface;
        if (!kind && node.userData && node.userData.kind) kind = node.userData.kind;
        node = node.parent;
      }
      if (hidden || hit.object.type === "Sprite") continue;
      stack.push({ what: label || kind || "unnamed", y: +hit.point.y.toFixed(3) });
      if (stack.length >= 6) break;
    }
    return stack;
  },
};

