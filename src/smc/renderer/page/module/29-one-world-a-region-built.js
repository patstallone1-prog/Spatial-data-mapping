// ---- one world: a region built in this page, wherever the walker goes ------------------------
//
// Every region was its own page, and crossing from one to another loaded the next page: a blank
// screen and a rebuild. Now the next region is built in this page, from its own page's code run
// "attached" (see ATTACH at the top): handed this page's renderer, it builds its region's world
// into a group this page places in its scene at that region's offset -- in the same frame as the
// tile tree's simple city -- and gives back the few things this page asks of it: the ground
// under the walker, the walls to walk round, the doors, and its own culling each frame.
//
// One region is drawn in full at a time: the one the walker went to. The one left behind is let
// go -- its world, geometry, textures and all -- and the tile tree draws it as the simple city
// again, so the page holds one region's detail however far it is taken.

//: An attached region's world: where it stands in this page, and what it answers.
function hostToGuest(g, x, z) { return [(x - g.ox) / g.sx, z - g.oz]; }
//: What is built at (x, z) over the ground, wherever it was built -- this page or the region
//: attached over it: each deck with its height in this page's frame, what kind of structure it
//: is (a bridge, a highway) and its name.
function structuresAt(x, z) {
  const guest = typeof guestUnder === "function" ? guestUnder(x, z) : null;
  if (guest && guest.api.elevatedDecksAt) {
    const [gx, gz] = hostToGuest(guest, x, z);
    return guest.api.elevatedDecksAt(gx, gz).map((d) => ({ ...d, top: d.top + guest.oy, base: d.base + guest.oy }));
  }
  return elevatedDecksAt(x, z);
}
function guestUnder(x, z) {
  const g = activeGuest;
  if (!g || !g.ready) return null;
  const [gx, gz] = hostToGuest(g, x, z);
  return (g.boxes || [g.box]).some((b) => gx >= b[0] && gx <= b[2] && gz >= b[1] && gz <= b[3]) ? g : null;
}
function regionAt(lon, lat) {
  let best = null, bestD = Infinity;
  for (const region of REGION_INDEX.list) {
    const [south, west, north, east] = region.bbox;
    if (lon < west || lon > east || lat < south || lat > north) continue;
    const d = Math.hypot(lon - (west + east) / 2, lat - (south + north) / 2);
    if (d < bestD) { best = region; bestD = d; }
  }
  return best;
}
//: A searched place's cells fetched as soon as it is found, before anyone asks to go (the
//: search, module 22): its region's main files' cells round it, nearest first, into the shared
//: cell cache at a low priority, so the jump, when it comes, builds from what is already here
//: (attachRegion asks the cache for the same addresses). At most PREWARM_BYTES of them, and
//: never more than the cache has room for; one place at a time.
const PREWARM_FILES = ["sf-corridor-3d.json", "sf-corridor-official.json", "sf-corridor-furniture.json", "sf-corridor-world-objects.json"];
const PREWARM_RADIUS_M = 220, PREWARM_BYTES = 32 * 1048576;
let prewarmedAt = "";
function prewarmPlaceCells(lon, lat) {
  if (ATTACH || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const region = regionAt(lon, lat);
  if (!region) return null;
  const key = `${region.name}:${lon.toFixed(4)}:${lat.toFixed(4)}`;
  if (key === prewarmedAt) return null;
  prewarmedAt = key;
  const folder = new URL("./", new URL(REGION_INDEX.root + region.path, location.href)).href;
  const padLon = PREWARM_RADIUS_M / metersPerLon, padLat = PREWARM_RADIUS_M / metersPerLat;
  const box = [lon - padLon, lat - padLat, lon + padLon, lat + padLat];
  let room = Math.min(PREWARM_BYTES, Math.max(0, worldCellCache.maxBytes - worldCellCache.snapshot().residentBytes));
  return Promise.all(PREWARM_FILES.map(async (name) => {
    const cells = viaStore(folder + name).replace(/([^/]+)\.json$/, "cells/$1/");
    const manifest = await worldCellCache.load(`${cells}manifest.json`, -10).catch(() => null);
    if (!manifest?.cells) return 0;
    let queued = 0;
    for (const cell of worldStreaming.windowCells(manifest, box, lon, lat)) {
      const bytes = (manifest.cells[cell] || 0) * 4;
      if (bytes > room) continue;
      room -= bytes; queued += 1;
      worldCellCache.load(`${cells}${cell}.json`, -20).catch(() => {});
    }
    return queued;
  })).then((counts) => ({ region: region.name, cells: counts.reduce((t, n) => t + n, 0) }));
}
function disposeTree(object, all = false) { object.traverse((o) => disposeOne(o, all)); }
function disposeOne(o, all = false) {
    if (o.geometry && (all || !o.userData.sharedInteriorAsset)) o.geometry.dispose();
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"])
        if (m[key] && m[key].dispose && !m[key].userData?.shared) m[key].dispose();
      m.dispose();
    }
}
//: The tiles over a region rebuilt, for which region is now drawn in full.
function invalidateTilesTouching(boxes) {
  for (const tile of TILES.values()) {
    if (!tile.group) continue;
    const [w, s, e, n] = tile.bbox;
    if (!boxes.some((b) => b && w < b[2] && e > b[0] && s < b[3] && n > b[1])) continue;
    tileGroupRoot.remove(tile.group);
    tile.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const material of tile.materials || []) material.dispose();
    tile.materials = null;
    tile.group = null;
    tile.state = "unavailable";
    tileResidentBytes -= tile.bytes;
    tileGeometryResident -= tile.geometryBytes || 0;
  }
}
//: This page's own region let go: everything of its world but the tile tree, the walker, and
//: the country and bridges round the whole Bay; the atlas fills the hole its ground leaves.
function releaseHostWorld() {
  if(natureWorld){natureWorld.hostBox.value.set(1,1,0,0);natureWorld.invalidate();}
  if (!hostWorldActive) return;
  hostWorldActive = false;
  if(grassStrands)grassStrands.dispose();
  grassSurfaceAt?.clear?.();grassStrands=null;grassSurfaceAt=null;grassSampleAt=null;
  for (const child of [...root.children]) {
    if (child === tileGroupRoot || child === avatar || child.userData.bayWide) continue;
    root.remove(child);
    disposeTree(child);
  }
  for (const fill of PERIMETER_FILL) fill.visible = true;
  terrainTiles.length = 0;
  tunnelBores.length = 0;
  billboardFaces.length = 0;
  billboardTextureCache.clear();
  detailTiles = [];
  detailCells = null;
  labelSprites = [];
  // Keep this initial bounded window's lightweight collision footprints: looking
  // at another city must not let the stationary walker pass through its old house.
  MERGED.clear();
  BUILDING_VISUAL_RANGES.clear();
  indoorCutEntry = null;
  indoorCut.count.value = 0;
}
//: A released window's own copies of its geometry and pictures, emptied. Its module can never be
//: unloaded -- a script once run stays -- and whatever it still points at stays with it: two
//: hundred megabytes a hop, measured, until these went. The GPU's copies went with dispose().
//: `all`: a released window's own furniture models too -- they are shared only within it.
function emptyTree(object, all = false) { object.traverse((o) => emptyOne(o, all)); }
function emptyOne(o, all = false) {
  {
    if (o.userData.sharedInteriorAsset && !all) return;
    if (o.geometry) {
      for (const attribute of Object.values(o.geometry.attributes || {})) {
        // An interleaved attribute reads its array from the buffer it shares with others.
        const holder = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
        // A compressed buffer says its type and length without being inflated to say them.
        const Type = holder?.recoverableType, length = Type ? holder.recoverableLength : holder?.array?.length;
        if (length) { holder.array = new (Type || holder.array.constructor)(0); holder.count = 0; }
      }
      const index = o.geometry.index;
      if (index && (index.recoverableType || index.array)) {
        index.array = new (index.recoverableType || index.array.constructor)(0); index.count = 0;
      }
    }
    if (o.isInstancedMesh && o.instanceMatrix) { o.instanceMatrix.array = new Float32Array(0); o.count = 0; }
    for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) {
      for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"]) {
        const image = m[key]?.image;
        // A picture every window draws with (a photographed facade, a lawn) stays with the page.
        if (!image || m[key].userData?.shared) continue;
        if (typeof image.close === "function") image.close();
        else if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) image.width = image.height = 0;
      }
    }
  }
}
//: A window let go: out of the scene at once, and its GPU copies and arrays let go a few
//: milliseconds at a time after. Done in one go, a whole square's thousands of meshes were
//: disposed and emptied inside the frame that showed the next one (part of a jump's longest
//: frame, 2026-11-05).
const releasing = [];
let releasePumping = false;
function releaseGuest(g) {
  if (!g) return;
  const root = g.root, api = g.api;
  if (root) scene.remove(root);
  if (g.url) URL.revokeObjectURL(g.url);
  g.api = null;
  g.root = null;
  g.window = null;   // its stand-in window holds its world too
  if (!root && !api) return;
  const all = [];
  root?.traverse((o) => { all.push(o); });
  releasing.push({ all, i: 0, api });
  if (!releasePumping) { releasePumping = true; nextTask().then(pumpRelease); }
}
function pumpRelease() {
  const until = performance.now() + 6;
  while (releasing.length && performance.now() < until) {
    const job = releasing[0];
    if (job.i < job.all.length) {
      const o = job.all[job.i++];
      try { disposeOne(o, true); emptyOne(o, true); } catch (error) { console.warn("kerbside: released window kept its arrays", error); }
      continue;
    }
    // Every group let go of what it holds, not only the root: the window's code stays loaded
    // and keeps its own groups (its rooms, its doors), and a model still on its way when the
    // window went is hung on a group nothing then holds.
    for (const o of job.all) { o.children.length = 0; o.parent = null; }
    try { if (job.api && job.api.release) job.api.release(); } catch (error) { console.warn("kerbside: a released window kept some of its world", error); }
    releasing.shift();
  }
  if (releasing.length) nextTask().then(pumpRelease); else releasePumping = false;
}
//: Shader programs outlive the windows that first drew them. three.js destroys a program when the
//: last material using it is disposed, so letting go of the window behind a jump threw away the
//: programs the next window -- built from the same code, with the same materials -- needed again,
//: and it linked 35-50 of them inside one frame (0.3-0.4 s) the first time it drew. Each program
//: is held once more than its materials hold it; there are some two hundred kinds, small on the
//: GPU, and past six hundred new ones are left to come and go as before. (The count is the
//: function's own: the frame loop starts before the module's later declarations are reached.)
function keepShaderPrograms() {
  const programs = renderer.info.programs;
  keepShaderPrograms.kept ??= 0;
  if (!programs || keepShaderPrograms.kept >= 600) return;
  for (const program of programs) {
    if (program.kerbsideKept) continue;
    program.kerbsideKept = true;
    program.usedTimes++;
    if (++keepShaderPrograms.kept >= 600) break;
  }
}
//: A region page's code, compiled once and run as a function for each window. Run as a module
//: of its own -- a new blob each time -- every window parsed and compiled two megabytes of code
//: again inside the frame of a jump (0.3-0.5 s), and kept it, with everything its top-level names
//: held, for as long as the page stayed open: a module cannot be unloaded. A function's scope goes
//: when nothing holds it. Its two static imports (three.js and its loader) stay at the top of the
//: one module; everything else is the function's body, with the window's stand-ins as its first
//: lines, as the prelude was.
const GUEST_FACTORIES = new Map();
const GUEST_IMPORT = /^import\s[^;]*\sfrom\s"[^"]+";\s*$/;
function guestFactory(located, prelude) {
  let made = GUEST_FACTORIES.get(located);
  if (!made) {
    const imports = [], body = [];
    for (const line of located.split("\n")) (GUEST_IMPORT.test(line) ? imports : body).push(line);
    const inner = prelude.replace("const __kerbsideGuestIn = globalThis.__kerbsideGuest;\n", "");
    const source = imports.join("\n") + "\nexport default async function kerbsideWindow(__kerbsideGuestIn) {\n"
      + inner + body.join("\n") + "\n}\n";
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    made = import(url).then((m) => m.default);
    made.catch(() => GUEST_FACTORIES.delete(located));
    GUEST_FACTORIES.set(located, made);
  }
  return made;
}
//: The page's code, ready to run attached: its document and window are stand-ins, so whatever
//: it shows or listens for goes nowhere, and it shares this page's three.js (the same URL).
function guestStandIns(page, metas) {
  const elements = new Map();
  const body = document.createElement("div");
  const element = (id) => {
    if (!elements.has(id)) {
      const tag = id === "scene" ? "canvas" : id === "find" ? "input" : id === "region" ? "select" : id === "hits" ? "ul"
        : id === "settings-page" ? "form" : "div";
      elements.set(id, document.createElement(tag));
    }
    return elements.get(id);
  };
  const doc = new Proxy({}, {
    get(_, prop) {
      if (prop === "getElementById") return element;
      if (prop === "body") return body;
      if (prop === "querySelector") return (selector) => {
        const name = /meta\[name="([^"]+)"\]/.exec(selector || "");
        return name && metas[name[1]] !== undefined ? { content: metas[name[1]] } : null;
      };
      if (prop === "querySelectorAll") return () => [];
      if (prop === "addEventListener" || prop === "removeEventListener") return () => {};
      const value = Reflect.get(document, prop);
      return typeof value === "function" ? value.bind(document) : value;
    },
  });
  const own = {};
  const win = new Proxy(own, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "addEventListener" || prop === "removeEventListener") return () => {};
      const value = Reflect.get(window, prop);
      return typeof value === "function" ? value.bind(window) : value;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  return { document: doc, window: win, own };
}
const regionBadge = document.createElement("div");
regionBadge.id = "region-loading";
regionBadge.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:30;background:rgba(20,20,20,.78);color:#fff;"
  + "font:12px/1.4 system-ui,sans-serif;padding:6px 10px;border-radius:6px;pointer-events:none;transition:opacity .5s";
regionBadge.hidden = true;
document.body.appendChild(regionBadge);
// ---- the way, in full: a strip along the directions ------------------------------------------
//
// With directions chosen, the window drawn in full is the square round the walker and a strip
// along the way -- a couple of blocks wide (ROUTE_STRIP.halfM either side), from the walker on to
// the end, as far as its area allows -- so a jump along the way lands in the street as it is,
// and a walk along it never meets the simple city. The square leads along the way, wider where
// the walker is and is going. The strip is cut into pieces a few hundred metres long, a box
// each (merged where the way runs straight), within the region being drawn.
const ROUTE_STRIP = { halfM: 100, pieceM: 220, maxBoxes: BOX_SET_MAX - 1,
  km2: STREAM.radius >= 400 ? 0.8 : 0.3, aheadM: 160 };
function routeLine() {
  if (META) return null;   // the headset holds only the blocks round you
  const result = typeof route !== "undefined" ? route.results[route.chosen] : null;
  return result?.line?.length > 1 ? result.line : null;
}
function routeStripKey() {
  const line = routeLine();
  return line ? `${route.chosen}:${line.length}:${line[0].join(",")}:${line[line.length - 1].join(",")}` : "";
}
//: The strip's boxes in `region` for a walker at `centre` ({lon, lat}): [west, south, east,
//: north] each, nearest the walker first, ahead along the way before behind.
function routeStrip(region, centre) {
  const line = routeLine();
  if (!line || !region) return [];
  const [rs, rw, rn, re] = region.bbox;
  const P = line.map(([lon, lat]) => [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]);
  const [cx, cy] = [(centre.lon - midLon) * metersPerLon, (centre.lat - midLat) * metersPerLat];
  let at = 0, best = Infinity;
  P.forEach(([x, y], i) => { const d = Math.hypot(x - cx, y - cy); if (d < best) { best = d; at = i; } });
  // Pieces of the way, walking out from the walker: ahead first, then behind.
  const pieces = [];
  for (const step of [1, -1]) {
    let piece = [P[at]], run = 0;
    for (let i = at + step; i >= 0 && i < P.length; i += step) {
      run += Math.hypot(P[i][0] - P[i - step][0], P[i][1] - P[i - step][1]);
      piece.push(P[i]);
      if (run >= ROUTE_STRIP.pieceM) { pieces.push(piece); piece = [P[i]]; run = 0; }
    }
    if (piece.length > 1) pieces.push(piece);
  }
  const boxes = [];
  let area = 0;
  const h = ROUTE_STRIP.halfM;
  for (const piece of pieces) {
    const xs = piece.map((p) => p[0]), ys = piece.map((p) => p[1]);
    const b = [Math.min(...xs) - h, Math.min(...ys) - h, Math.max(...xs) + h, Math.max(...ys) + h];
    // In the region's own box, in degrees.
    const box = [Math.max(rw, midLon + b[0] / metersPerLon), Math.max(rs, midLat + b[1] / metersPerLat),
                 Math.min(re, midLon + b[2] / metersPerLon), Math.min(rn, midLat + b[3] / metersPerLat)];
    if (box[2] <= box[0] || box[3] <= box[1]) continue;
    const km2 = windowAreaKm2([box]);
    if (area + km2 > ROUTE_STRIP.km2) break;
    // A straight run is one box: merged with the last when that adds little but the join.
    const last = boxes[boxes.length - 1];
    if (last) {
      const union = [Math.min(last[0], box[0]), Math.min(last[1], box[1]), Math.max(last[2], box[2]), Math.max(last[3], box[3])];
      const grow = windowAreaKm2([union]) - windowAreaKm2([last]);
      if (grow <= km2 * 1.15 && area + grow <= ROUTE_STRIP.km2) { boxes[boxes.length - 1] = union; area += grow; continue; }
    }
    if (boxes.length >= ROUTE_STRIP.maxBoxes) break;
    boxes.push(box);
    area += km2;
  }
  return boxes;
}
//: Where the way goes on from (lon, lat), ROUTE_STRIP.aheadM along it, if the walker is on it.
function routeAheadOf(lon, lat) {
  const line = routeLine();
  if (!line) return null;
  const P = line.map(([a, b]) => [(a - midLon) * metersPerLon, (b - midLat) * metersPerLat]);
  const x = (lon - midLon) * metersPerLon, y = (lat - midLat) * metersPerLat;
  let at = 0, best = Infinity;
  P.forEach(([px, py], i) => { const d = Math.hypot(px - x, py - y); if (d < best) { best = d; at = i; } });
  if (best > 80) return null;
  let run = 0, i = at;
  while (i + 1 < P.length && run < ROUTE_STRIP.aheadM) { run += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); i += 1; }
  return i > at ? [midLon + P[i][0] / metersPerLon, midLat + P[i][1] / metersPerLat] : null;
}
window.kerbsideRouteStrip = () => {
  const lon = midLon + avatar.position.x / metersPerLon, lat = midLat - avatar.position.z / metersPerLat;
  const region = regionAt(lon, lat), boxes = region ? routeStrip(region, { lon, lat }) : [];
  return { key: routeStripKey(), boxes, km2: +windowAreaKm2(boxes).toFixed(3),
    drawn: activeGuest?.windowBoxes?.length ? activeGuest.windowBoxes.length - 1 : 0, active: activeGuest?.stripKey || "" };
};

function checkDetailExpansion(now) {
  // City mode's area is built once and not streamed (module 30, cityLock).
  if(typeof cityLock!=="undefined" && cityLock)return;
  if(ATTACH || !regionStreamingReady || attaching || now<detailRetryAt || now-detailCheckAt<1000
    || !window.kerbsideReady?.streets || !window.kerbsideReady?.ground)return;
  // Right out over the map (zoom tier 0) the houses are the tile tree's and the paint is gone:
  // a square built in full there is not seen, and building it slowed the region's tiles. It is
  // built when the view comes back down.
  if(!state.firstPerson && zoomTier===0)return;
  detailCheckAt=now;
  const focus=state.firstPerson ? avatar.position : state.target;
  const lon=midLon+focus.x/metersPerLon,lat=midLat-focus.z/metersPerLat;
  const region=regionAt(lon,lat);if(!region)return;
  const owner=activeGuest,box=owner?.windowBox || BUILD_WINDOW?.box;
  if(!box)return;
  if(region!==(owner?.region || REGION_INDEX.host)) {
    attachRegion(region,{lon,lat},STREAM.arrival);detailPreviousFocus=[lon,lat];detailPreviousAt=now;return;
  }
  const [s,w,n,e]=region.bbox;
  // Directions chosen since this window was built: built again, with the strip along the way.
  const stripKey=routeStripKey();
  if(stripKey && stripKey!==(owner?.stripKey || "")) {
    const ahead=routeAheadOf(lon,lat),c=ahead ? {lon:(lon+ahead[0])/2,lat:(lat+ahead[1])/2} : {lon,lat};
    attachRegion(region,{lon:Math.max(w,Math.min(e,c.lon)),lat:Math.max(s,Math.min(n,c.lat))},STREAM.radius);
    detailPreviousFocus=[lon,lat];detailPreviousAt=now;return;
  }
  // How fast the focus is going (metres a second since the last look, a teleport aside) and
  // how long the last window took: the next is asked for that much sooner, that far ahead.
  const seconds=detailPreviousAt ? (now-detailPreviousAt)/1000 : 0;
  const moved=detailPreviousFocus && seconds>0 ? Math.hypot((lon-detailPreviousFocus[0])*metersPerLon,
    (lat-detailPreviousFocus[1])*metersPerLat)/seconds : 0;
  const speed=moved<60 ? moved : 0;
  // On the way, the square leads along it rather than along the last step.
  const ahead=routeAheadOf(lon,lat);
  // A jump (a click across the map) is not a heading: led along it, the square was built 180 m
  // past where the walker landed, which left them under `keep` from its far side, and it was
  // built again round them at once -- two builds a click.
  const previous=ahead ? [2*lon-ahead[0],2*lat-ahead[1]] : moved<60 ? detailPreviousFocus : null;
  const request=worldStreaming.detailRequest(box,owner?.detailRadius || BUILD_WINDOW.radius,
    [lon,lat],[metersPerLon,metersPerLat],previous,[w,s,e,n],
    {...STREAM,speed,buildSeconds:owner?.buildSeconds || 8});
  detailPreviousFocus=[lon,lat];detailPreviousAt=now;
  if(!request)return;
  // Landed on the strip: it is already drawn, so the next square is built at full size round
  // the walker, offscreen, rather than a small arrival square in a hurry.
  const onStrip=(owner?.windowBoxes || []).slice(1).some(b=>lon>=b[0] && lon<=b[2] && lat>=b[1] && lat<=b[3]);
  const radius=onStrip ? Math.max(request.radius,STREAM.radius) : request.radius;
  attachRegion(region,{lon:Math.max(w,Math.min(e,request.lon)),lat:Math.max(s,Math.min(n,request.lat))},radius);
}
window.kerbsideStreamDetail=()=>{
  const cache=worldCellCache.snapshot(),usage=activeGuest?.api.municipalUsage || municipalUsage;
  return `Detail: ${activeGuest?.region.title || REGION_INDEX.host?.title || "local"}`
    +`${attaching ? ` (loading nearby window: ${attaching.progress?.textContent || "fetching"})` : ""}; `
    +`${2*(activeGuest?.detailRadius || BUILD_WINDOW?.radius || 0)} m detail width; ${activeGuest?.buildSeconds?.toFixed(1) || "initial"} s build; `
    +`cells ${(cache.residentBytes/1048576).toFixed(1)} / ${(STREAM.cellBytes/1048576).toFixed(0)} MiB, ${cache.active} fetching, ${cache.hits} reused. `
    +`Municipal sidewalks: ${usage.sidewalks}; curb records: ${usage.curbColourRecords}.`;
};
//: `force`: built again even where the square asked for fits in the one drawn (the headset's
//: memory governor, shrinking it).
async function attachRegion(region, centre = null, radius = META ? STREAM.arrival : 220, force = false, own = null) {
  if (ATTACH || !regionStreamingReady || !region) return;
  const isHost = REGION_INDEX.host && region.name === REGION_INDEX.host.name;
  if (!centre && ((isHost && hostWorldActive) || (activeGuest && activeGuest.region === region))) return;
  centre ||= {lon:midLon+avatar.position.x/metersPerLon,lat:midLat-avatar.position.z/metersPerLat};
  const [rs,rw,rn,re]=region.bbox;
  if(!Number.isFinite(centre.lon) || !Number.isFinite(centre.lat)
    || centre.lon<rw || centre.lon>re || centre.lat<rs || centre.lat>rn)return;
  // The strip along the way, with any square but a hurried arrival's.
  // Keyed by the directions it was laid for, even where none of the way is in this region, so a
  // window is built for a set of directions once.
  // (Or boxes of the caller's own: City mode's area.)
  const strip = own?.strip || (radius > STREAM.arrival ? routeStrip(region, centre) : []);
  const stripKey = own?.stripKey ?? (radius > STREAM.arrival ? routeStripKey() : "");
  if (!force && activeGuest?.region === region && activeGuest.windowBox && (activeGuest.stripKey || "") === stripKey) {
    const b=activeGuest.windowBox;
    if(radius<=activeGuest.detailRadius && worldStreaming.windowMargin(b,[centre.lon,centre.lat],
      [metersPerLon,metersPerLat],[rw,rs,re,rn])>=STREAM.keep)return;
  }
  // In City mode only the area's own build is made (cityAreaStep).
  if (typeof cityLock !== "undefined" && cityLock && stripKey !== "city") return;
  if (attaching) {
    if(attaching.region===region && Math.hypot((centre.lon-attaching.centre.lon)*metersPerLon,
      (centre.lat-attaching.centre.lat)*metersPerLat)<100 && (attaching.stripKey||"")===stripKey)return;
    attachWanted = {region,centre,radius,own}; return;
  }
  worldCellCache.focus();
  attaching = {region,centre,stripKey};
  regionBadge.textContent = `Loading ${region.title} in full…`;
  regionBadge.style.opacity = "1";
  regionBadge.hidden = false;
  let previous = activeGuest;
  // City mode's area is built behind its loading screen: the window that was there goes first,
  // so the two are never held at once (4.2 GB at the hand-over into the Marina, measured).
  if (stripKey === "city" && previous) { releaseGuest(previous); activeGuest = null; previous = null; }
  let candidate=null;
  try {
    // Build a bounded replacement offscreen. Never discard the last working window
    // before the new one succeeds; network errors retain the old world.
    const pageUrl = new URL(REGION_INDEX.root + region.path, location.href);
    const html = await fetch(pageUrl.href, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${region.name} page ${r.status}`);
      return r.text();
    });
    const meta = (name) => (new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html) || [])[1];
    const code = (/<script type="module">([\s\S]*?)<\/script>/.exec(html) || [])[1];
    if (!code) throw new Error(`${region.name} page has no renderer`);
    const absolute = (value) => new URL(value || "./", pageUrl).href;
    const metas = {
      "kerbside-assets": absolute(meta("kerbside-assets")),
      "kerbside-visual-support": meta("kerbside-visual-support") ? absolute(meta("kerbside-visual-support")) : "",
      "kerbside-regions": absolute(meta("kerbside-regions") || "app-regions.json"),
      "kerbside-app-mode": meta("kerbside-app-mode") || "",
    };
    const stand = guestStandIns(pageUrl, metas);
    attaching.progress=stand.document.getElementById("progress");
    // (``window``: the attached region's own stand-in window -- its window.kerbside for checks.)
    const holder = { region, ready: false, centre, detailRadius:radius, strip, stripKey, startedAt:performance.now(), window: stand.window };
    candidate=holder;
    globalThis.__kerbsideGuest = {
      renderer, assets: metas["kerbside-assets"], visualSupport: metas["kerbside-visual-support"],
      natureBacked:Boolean(NATURE), headset: META, canonicalEdits: CANONICAL_EXTERIOR_EDITS || {},
      detailWindow:{...centre,radius:holder.detailRadius,strip:holder.strip},cellCache:{
        load:(url,priority)=>worldCellCache.load(new URL(url,pageUrl).href,priority),
        snapshot:()=>worldCellCache.snapshot(),focus:()=>worldCellCache.focus()},
      document: stand.document, window: stand.window,
      onRoot(groupRoot) {
        holder.root = groupRoot;
        groupRoot.visible = false;
        scene.add(groupRoot);
        globalThis.__kerbsideGuest = null;
      },
    };
    globalThis.__kerbsideGuest.resolve = (path) => new URL(path, pageUrl).href;
    const prelude = "const __kerbsideGuestIn = globalThis.__kerbsideGuest;\n"
      + "const document = __kerbsideGuestIn.document, window = __kerbsideGuestIn.window;\n"
      + "const addEventListener = () => {}, removeEventListener = () => {};\n";
    // A region page fetches some files by a path relative to itself; run from this page those
    // paths would be this page's, and the region would be built from this region's data.
    const located = code.replace(/fetch\("(?!https?:)([^"]+)"/g, 'fetch(__kerbsideGuestIn.resolve("$1")')
      .replace(/const (PAYLOAD_URL|GROUND_URL) = ("[^"]+");/g,'const $1 = __kerbsideGuestIn.resolve($2);');
    const makeWindow = await guestFactory(located, prelude);
    await makeWindow(globalThis.__kerbsideGuest);
    const api = stand.own.kerbsideGuestApi;
    if (!api || !holder.root) throw new Error(`${region.name} did not build`);
    holder.api = api;
    await api.ready();
    if(attachWanted && (attachWanted.region!==region || Math.hypot(
      (attachWanted.centre.lon-centre.lon)*metersPerLon,(attachWanted.centre.lat-centre.lat)*metersPerLat)>holder.detailRadius*.8)) {
      releaseGuest(holder);candidate=null;return;
    }
    // Where its world stands in this page: its middle at that place in this page's metres, its
    // east-west metres scaled to this page's (the two differ by the cosine of their latitudes),
    // and lowered by the Earth's curve between the two middles, as the simple city is.
    const [hx, hy] = xy(api.midLon, api.midLat);
    holder.ox = hx;
    holder.oz = -hy;
    holder.sx = metersPerLon / api.metersPerLon;
    holder.oy = -earthDrop(hx, -hy);
    holder.root.position.set(holder.ox, holder.oy, holder.oz);
    holder.root.scale.set(holder.sx, 1, 1);
    holder.root.updateMatrixWorld(true);
    api.setRootInverse(holder.root.matrixWorld.clone().invert());
    holder.box = api.groundBox;
    holder.boxes = api.groundBoxes || [api.groundBox];
    holder.windowBox = api.windowBox || [api.bbox.west,api.bbox.south,api.bbox.east,api.bbox.north];
    holder.windowBoxes = api.windowBoxes || [holder.windowBox];
    holder.lastAt = performance.now();
    // In the headset every surface's shader is compiled here, behind the loading panel: compiled
    // as each first came into view, each stalled the headset a fraction of a second, and where
    // you turned stayed black until it had. (On a Quest 3, once compiled, the square draws at
    // the headset's 90 frames a second.)
    // Plain before the first compile, the page's own world as well as the one coming in, so the
    // programs compiled behind the loading panel are the ones drawn.
    if (META) { headsetSimplify(holder.root); headsetSimplify(scene); }
    // On a computer too: the window's first frame linked its shaders one after another, waiting
    // on each (two seconds of a hop, measured 2026-11-03), and the walker stood frozen through it.
    if (renderer.compileAsync) {
      holder.root.visible = true;
      const compiled = renderer.compileAsync(holder.root, camera, scene);
      holder.root.visible = false;
      await Promise.race([compiled.catch(() => {}), new Promise((resolve) => setTimeout(resolve, META ? 10000 : 5000))]);
    }
    // And its buffers and pictures sent to the GPU a few megabytes a frame, before it is shown:
    // shown first, the whole square went up in the one frame that showed it (a second or more).
    if (!META) await preuploadWindow(holder.root);
    holder.ready = true;
    holder.buildSeconds=(performance.now()-holder.startedAt)/1000;
    noteDetailBuild(holder.buildSeconds, holder.windowBoxes || [holder.windowBox]);
    detailRegionsSeen.add(region.name);
    console.info(`kerbside: ${region.name} detail handoff ready in ${holder.buildSeconds.toFixed(1)} s`);
    if (hostWorldActive) releaseHostWorld();
    if (previous) releaseGuest(previous);
    holder.root.visible = true;
    activeGuest = holder;
    natureWorld?.invalidate();
    // The tree draws the simple city everywhere but here, and the country under it gives way.
    TILE_OWN_BOXES = holder.windowBoxes.map((b) => b.slice());
    setBoxSet(tileDetailBox, TILE_OWN_BOXES.map(localWindowBox));
    setCityAsTiles(zoomTier === 0);
    setBoxSet(indoorCut.guestBox, holder.boxes.map(([x0, z0, x1, z1]) =>
      new THREE.Vector4(holder.ox + x0 * holder.sx, holder.oz + z0, holder.ox + x1 * holder.sx, holder.oz + z1)));
    cullForced = true;
    regionBadge.textContent = `${region.title}`;
    setTimeout(() => { regionBadge.style.opacity = "0"; }, 2500);
  } catch (error) {
    if(candidate && candidate!==activeGuest)releaseGuest(candidate);
    console.warn("kerbside: could not build", region.name, error);
    regionBadge.textContent = `Could not load ${region.title}`;
    setTimeout(() => { regionBadge.style.opacity = "0"; }, 4000);
    globalThis.__kerbsideGuest = null;
    detailRetryAt=performance.now()+4000;
  } finally {
    attaching = null;
    const next = attachWanted;
    attachWanted = null;
    if (next && performance.now()>=detailRetryAt) attachRegion(next.region,next.centre,next.radius,false,next.own);
  }
}
window.kerbsideAttachRegion = (name) => attachRegion(REGION_INDEX.list.find((r) => r.name === name));
window.kerbsideActiveRegion = () => (activeGuest ? { name: activeGuest.region.name, ready: activeGuest.ready,
  offset: [activeGuest.ox, activeGuest.oy, activeGuest.oz], scale: activeGuest.sx, world: () => activeGuest?.window?.kerbside || null } : { name: REGION_INDEX.host?.name, host: hostWorldActive });
//: Each frame the attached region is shown the page's eye and walker, culls its own detail and
//: works its own doors; what it says back -- indoors, a message -- is shown by this page.
const guestAvatarAt = new THREE.Vector3();
function guestFrame(now) {
  const g = activeGuest;
  keepWalkerOutside();
  const dt = Math.min(0.1, (now - g.lastAt) / 1000);
  g.lastAt = now;
  const [gx, gz] = hostToGuest(g, avatar.position.x, avatar.position.z);
  guestAvatarAt.set(gx, avatar.position.y - g.oy, gz);
  const said = g.api.tick({ eye: camera, dist: state.dist, firstPerson: state.firstPerson, at: guestAvatarAt, dt });
  if (hostWorldActive) return;
  state.indoors = said.indoors;
  setHint(said.hint);
  if (said.indoors && !state.firstPerson) { setFirstPerson(true); state.autoFirstPerson = true; }
  if (!said.indoors && state.autoFirstPerson) setFirstPerson(false);
  // The lamp of the room the walker is in, from the attached region's.
  indoorLight.intensity = said.light ? INDOOR_LIGHT_CD : 0;
  if (said.light) indoorLight.position.set(g.ox + said.light[0] * g.sx, said.light[1] + g.oy, g.oz + said.light[2]);
}

// What this world gives a page that holds it attached (read by attachRegion).
function guestTick({ eye, dist, firstPerson, at, dt }) {
  camera.fov = eye.fov; camera.aspect = eye.aspect; camera.near = eye.near; camera.far = eye.far;
  camera.updateProjectionMatrix();
  camera.position.copy(eye.position).applyMatrix4(ROOT_INVERSE);
  camera.quaternion.copy(eye.quaternion);
  camera.updateMatrixWorld(true);
  state.dist = dist;
  state.firstPerson = firstPerson;
  avatar.position.copy(at);
  if(grassStrands&&grassSurfaceAt)grassStrands.update(at.x,at.z,camera.position.y-at.y);
  foliageMotion?.update(performance.now(),at);
  if (cullDetailByDistance(frameCount) || frameCount % DETAIL_REINDEX_FRAMES === 0) cullLabelsByDistance(frameCount);
  frameCount += 1;
  updateDoors(dt);
  return {
    indoors: Boolean(state.indoors),
    hint: doorHint.hidden || doorHint.style.opacity === "0" ? null : doorHint.textContent,
    light: indoorLight.intensity > 0 ? [indoorLight.position.x, indoorLight.position.y, indoorLight.position.z] : null,
  };
}
//: Every name at the top of this module let go of what it holds -- written out when the page is
//: built (tuned), from the module's own declarations: each `let` and `var` pointed at nothing,
//: each Map, Set and list made here emptied. Only a released window calls it.
function releaseModuleScope() {
  /*__RELEASE_MODULE_SCOPE__*/
}
window.kerbsideGuestApi = {
  interiorStatus,
  ready:async()=>{if(await groundReady===false)throw Error("Destination ground unavailable; previous window retained");},
  cityAsTiles:(simple)=>showDetailBuildings(!simple),
  municipalUsage,
  windowBox:BUILD_WINDOW?.core,
  windowBoxes:BUILD_WINDOW?.boxes,
  groundBoxes:BUILD_WINDOW ? BUILD_WINDOW.boxes.map((b)=>{const a=xy(b[0],b[1]),c=xy(b[2],b[3]);return clipToTerrain([a[0],-c[1],c[0],-a[1]]);}) : null,
  billboardFaces,
  root, bbox: DATA.bbox, midLon, midLat, metersPerLon,
  // The ground this world draws, in its own metres: its terrain grid and the apron round it.
  groundBox: BUILD_WINDOW ? (()=>{
    const b=BUILD_WINDOW.box,a=xy(b[0],b[1]),c=xy(b[2],b[3]);return clipToTerrain([a[0],-c[1],c[0],-a[1]]);
  })() : TERRAIN_FRAME ? (() => {
    const f = TERRAIN_FRAME;
    if(ATTACH?.natureBacked) return terrainPageRect();
    const corners = [[f.x0 - TERRAIN_APRON_M, f.y0 - TERRAIN_APRON_M],
                     [f.x0 + f.cols * f.step_m + TERRAIN_APRON_M, f.y0 + f.rows * f.step_m + TERRAIN_APRON_M]]
      .map(([e, n]) => terrainToPage(e, n, f));
    return [Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]),
            Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1])];
  })() : (() => { const [x0, y0] = xy(DATA.bbox.west, DATA.bbox.south); const [x1, y1] = xy(DATA.bbox.east, DATA.bbox.north);
    return [x0, -y1, x1, -y0]; })(),
  walkerGroundAt, walkerGroundInfo, elevatedDecksAt, walkableStairRecessAt, tunnelSurfaceAt, tunnelMoveAllowed, tunnelWalkMeshes, approachPassageAt, groundLiftAt, wallSegmentsNear, terrainTiles, exteriorLanding, firstBuildingCollision,
  walkerFootprintBlocked,
  // Its buildings' exterior edits, drawn in its own world (openExteriorEditor on the page).
  exteriorEditorContext, hasExteriorBuilding: (id) => buildingWayById.has(String(id)),
  deckEdgeSegmentsNear, deckLevels: () => DECK_LEVEL_REPORT,
  buildingTopAt,
  eligibleLanding, pickRayBuilding, streetNameAt, crossStreetsAt,
  // The living city's district here (docs/city/view.mjs): read once, as the region arrives.
  cityWays: () => DATA.ways, cityCourts: () => PARK_EVIDENCE?.court_layout?.courts || [], insideCarriageway, mappedWaterAt, cityInlandAt,
  signalHeads: () => signalLamps?.heads || [], setSignalLights,
  // The kerb as it is drawn, and whether a car may stand at it (the living city's parking).
  kerbAt: (x, z, reach = 6, ax = null, az = null) => { if (ax !== null) { const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; } return nearestKerbAt(x, z, reach, ax, az); }, kerbParking,
  // Its garage doors, opened and shut in its own world (module 31).
  get garages() { return typeof garageDoors === "undefined" ? null : garageDoors; },
  tick: guestTick,
  toggleNearestDoor: operateNearestDoor,
  setRootInverse(matrix) {
    ROOT_INVERSE.copy(matrix); tunnelVoidInverse.copy(matrix); detailCells = null; cullForced = true;
    // Box uniforms are in renderer/world metres, just like the fragment position.
    if(BUILD_WINDOW) {
      setBoxSet(detailClipBox,BUILD_WINDOW.boxes.map(box=>{
        const b=localWindowBox(box),a=new THREE.Vector3(b.x,0,b.y).applyMatrix4(root.matrixWorld),
          c=new THREE.Vector3(b.z,0,b.w).applyMatrix4(root.matrixWorld);
        return new THREE.Vector4(Math.min(a.x,c.x),Math.min(a.z,c.z),Math.max(a.x,c.x),Math.max(a.z,c.z));
      }));
      showDetailBuildings(detailBuildingsShown);
    }
  },
  // Let go: what this world holds is emptied, since the code that built it stays loaded.
  release() {
    if(grassStrands)grassStrands.dispose();
    grassSurfaceAt?.clear?.();grassStrands=null;grassSurfaceAt=null;grassSampleAt=null;
    terrainTiles.length = 0;
    tunnelBores.length = 0;
    billboardFaces.length = 0;
    billboardTextureCache.clear();
    detailTiles = [];
    detailCells = null;
    labelSprites = [];
    footprintGrid.clear();
    footprintById.clear();
    MERGED.clear();
    GARAGE_DOORS.clear(); garageDoors?.reset();
    BUILDING_VISUAL_RANGES.clear();
    HOME_RENDER.clear();
    interiorsBuilt.clear();
    if (DATA.ways) DATA.ways.length = 0;
    if (TERRAIN) { TERRAIN.data = null; TERRAIN.visualData = null; }
    // And everything else held at the top of the module -- every grid, cache and list, and what
    // was fetched -- since a module, once run, is never unloaded: whatever it still points at
    // stays for as long as the page does. A hundred megabytes a window, before this.
    for (const kept of [
      typeof lazyLayerBuilders !== "undefined" ? lazyLayerBuilders : null,
      typeof lazyLayersWanted !== "undefined" ? lazyLayersWanted : null,
      typeof WORLD_MATERIAL_CACHE !== "undefined" ? WORLD_MATERIAL_CACHE : null,
      typeof latticeField !== "undefined" ? latticeField : null, typeof TILES !== "undefined" ? TILES : null,
      typeof TILE_CACHE !== "undefined" ? TILE_CACHE : null,
      typeof PEDESTRIAN_TEXTURES !== "undefined" ? PEDESTRIAN_TEXTURES : null,
      typeof MERGED !== "undefined" ? MERGED : null,
      typeof BUILDING_VISUAL_RANGES !== "undefined" ? BUILDING_VISUAL_RANGES : null,
      typeof HOME_RENDER !== "undefined" ? HOME_RENDER : null,
      typeof CANONICAL_MATERIALS !== "undefined" ? CANONICAL_MATERIALS : null,
      typeof officialCurbGrid !== "undefined" ? officialCurbGrid : null,
      typeof officialIslandCurbGrid !== "undefined" ? officialIslandCurbGrid : null,
      typeof crossingIslandCurbGrid !== "undefined" ? crossingIslandCurbGrid : null,
      typeof mappedDividerCurbGrid !== "undefined" ? mappedDividerCurbGrid : null,
      typeof officialMedianGrid !== "undefined" ? officialMedianGrid : null,
      typeof rampNodeGrid !== "undefined" ? rampNodeGrid : null,
      typeof crossingDrawGrid !== "undefined" ? crossingDrawGrid : null,
      typeof mappedCrossingGrid !== "undefined" ? mappedCrossingGrid : null,
      typeof bikeJoinGrid !== "undefined" ? bikeJoinGrid : null,
      typeof bikeAreaGrid !== "undefined" ? bikeAreaGrid : null,
      typeof ROOF_CACHE !== "undefined" ? ROOF_CACHE : null,
      typeof SOUTH_WINDOW_CACHE !== "undefined" ? SOUTH_WINDOW_CACHE : null,
      typeof ENTRY_CACHE !== "undefined" ? ENTRY_CACHE : null,
      typeof GARAGE_CACHE !== "undefined" ? GARAGE_CACHE : null,
      typeof carriagewayGrid !== "undefined" ? carriagewayGrid : null,
      typeof footprintGrid !== "undefined" ? footprintGrid : null,
      typeof pavedGrid !== "undefined" ? pavedGrid : null,
      typeof underlayGrid !== "undefined" ? underlayGrid : null,
      typeof pavedBearing !== "undefined" ? pavedBearing : null,
      typeof mappedWalkGrid !== "undefined" ? mappedWalkGrid : null,
      typeof streetEndGrid !== "undefined" ? streetEndGrid : null,
      typeof cornerLegGrid !== "undefined" ? cornerLegGrid : null,
      typeof pavementCornerCuts !== "undefined" ? pavementCornerCuts : null,
      typeof pavementCornerLaid !== "undefined" ? pavementCornerLaid : null,
      typeof junctionBoxGrid !== "undefined" ? junctionBoxGrid : null,
      typeof intersectionGrid !== "undefined" ? intersectionGrid : null,
      typeof planeAtlases !== "undefined" ? planeAtlases : null,
      typeof planeAtlasSlots !== "undefined" ? planeAtlasSlots : null,
      typeof GAS_PRICE_CACHE !== "undefined" ? GAS_PRICE_CACHE : null,
      typeof PHOTO_OPENING_TEXTURES !== "undefined" ? PHOTO_OPENING_TEXTURES : null,
      typeof homeDesignMaterials !== "undefined" ? homeDesignMaterials : null,
      typeof SIGN_SLOTS !== "undefined" ? SIGN_SLOTS : null,
      typeof SIGN_MATERIALS !== "undefined" ? SIGN_MATERIALS : null,
      typeof SIGN_SINKS !== "undefined" ? SIGN_SINKS : null,
      typeof STOREFRONT_TEXTURES !== "undefined" ? STOREFRONT_TEXTURES : null,
      typeof ROOF_PARTS !== "undefined" ? ROOF_PARTS : null,
      typeof OUTBUILDING_CACHE !== "undefined" ? OUTBUILDING_CACHE : null,
      typeof facadeLive !== "undefined" ? facadeLive : null,
      typeof facadeGrid !== "undefined" ? facadeGrid : null,
      typeof publicStairGrid !== "undefined" ? publicStairGrid : null,
      typeof CENTRAL_DECK_NODES !== "undefined" ? CENTRAL_DECK_NODES : null,
      typeof GROUND_JOIN_NODES !== "undefined" ? GROUND_JOIN_NODES : null,
      typeof roadFillGrid !== "undefined" ? roadFillGrid : null,
      typeof GRASS_TEXTURES !== "undefined" ? GRASS_TEXTURES : null,
      typeof TREE_BARK_MATERIALS !== "undefined" ? TREE_BARK_MATERIALS : null,
      typeof billboardTextureCache !== "undefined" ? billboardTextureCache : null,
      typeof PLATE_SLOTS !== "undefined" ? PLATE_SLOTS : null,
      typeof PLATE_MATERIALS !== "undefined" ? PLATE_MATERIALS : null,
      typeof signPlateGrid !== "undefined" ? signPlateGrid : null,
      typeof touches !== "undefined" ? touches : null, typeof held !== "undefined" ? held : null,
      typeof detailShardCache !== "undefined" ? detailShardCache : null,
      typeof detailRegionsSeen !== "undefined" ? detailRegionsSeen : null,
      typeof findableMarkers !== "undefined" ? findableMarkers : null,
      typeof standingSurfaces !== "undefined" ? standingSurfaces : null,
      typeof footprintById !== "undefined" ? footprintById : null,
      typeof doorsShown !== "undefined" ? doorsShown : null,
      typeof gateMaterials !== "undefined" ? gateMaterials : null,
      typeof homeShells !== "undefined" ? homeShells : null,
      typeof homeDecalIndex !== "undefined" ? homeDecalIndex : null,
      typeof homeDecalHidden !== "undefined" ? homeDecalHidden : null,
      typeof interiorsBuilt !== "undefined" ? interiorsBuilt : null,
      typeof interiorWallMaterials !== "undefined" ? interiorWallMaterials : null,
      typeof paintMaterials !== "undefined" ? paintMaterials : null,
      typeof carpetMaterials !== "undefined" ? carpetMaterials : null,
      typeof interiorAssetPromises !== "undefined" ? interiorAssetPromises : null,
      typeof interiorModelPromises !== "undefined" ? interiorModelPromises : null,
      typeof paintingMaterials !== "undefined" ? paintingMaterials : null,
      typeof houseFloorMaterials !== "undefined" ? houseFloorMaterials : null]) try { if (typeof kept?.clear === "function") kept.clear(); } catch (error) { /* a frozen one stays */ }
    for (const list of [
      typeof yieldWaiters !== "undefined" ? yieldWaiters : null,
      typeof terrainTiles !== "undefined" ? terrainTiles : null,
      typeof PERIMETER_FILL !== "undefined" ? PERIMETER_FILL : null,
      typeof tileQueue !== "undefined" ? tileQueue : null,
      typeof osmRampNodes !== "undefined" ? osmRampNodes : null,
      typeof cornerLegs !== "undefined" ? cornerLegs : null,
      typeof junctionBoxHulls !== "undefined" ? junctionBoxHulls : null,
      typeof tactileWarningPads !== "undefined" ? tactileWarningPads : null,
      typeof deferredTactilePads !== "undefined" ? deferredTactilePads : null,
      typeof signAtlases !== "undefined" ? signAtlases : null,
      typeof facadePanels !== "undefined" ? facadePanels : null,
      typeof DRIVEWAY_ZONES !== "undefined" ? DRIVEWAY_ZONES : null,
      typeof facadeQueue !== "undefined" ? facadeQueue : null,
      typeof tunnelBores !== "undefined" ? tunnelBores : null,
      typeof publicStairs !== "undefined" ? publicStairs : null,
      typeof TRANSIT_CANOPIES !== "undefined" ? TRANSIT_CANOPIES : null,
      typeof TRANSIT_ISLAND_SPOTS !== "undefined" ? TRANSIT_ISLAND_SPOTS : null,
      typeof PARK_PARTS !== "undefined" ? PARK_PARTS : null,
      typeof billboardFaces !== "undefined" ? billboardFaces : null,
      typeof stationWalls !== "undefined" ? stationWalls : null,
      typeof plateAtlases !== "undefined" ? plateAtlases : null,
      typeof streetLandingSegments !== "undefined" ? streetLandingSegments : null,
      typeof homeDecalMeshes !== "undefined" ? homeDecalMeshes : null,
      typeof modelWaiters !== "undefined" ? modelWaiters : null,
      typeof frameSamples !== "undefined" ? frameSamples : null,
      typeof detailTiles !== "undefined" ? detailTiles : null,
      typeof labelSprites !== "undefined" ? labelSprites : null,
      typeof releaseQueue !== "undefined" ? releaseQueue : null]) try { if (Array.isArray(list)) list.length = 0; } catch (error) { /* a frozen one stays */ }
    const emptyRecord = (record) => {
      if (!record || typeof record !== "object") return;
      for (const key of Object.keys(record)) {
        const value = record[key];
        if (Array.isArray(value)) value.length = 0;
        else if (value instanceof Map || value instanceof Set) value.clear();
        else if (value && typeof value === "object" && !ArrayBuffer.isView(value)) delete record[key];
        else if (ArrayBuffer.isView(value)) delete record[key];
      }
    };
    // The asset map is not this window's: every window reads the one the page fetched.
    for (const record of [DATA, OFFICIAL_GEOMETRY, WORLD_OBJECTS, PERIMETER, VISUAL_SUPPORT, STORE_NAMES, PARK_EVIDENCE,
      ELECTRICAL_SPANS, INVENTORY_CROSSINGS, MUNICIPAL_CONTEXT, GROUND, FRONTAGE_FITS, MATERIAL_ASSIGNMENTS,
      INTERIORS]) try { emptyRecord(record); } catch (error) { /* a frozen one stays */ }
    GROUND = null;
    releaseModuleScope();
  },
};
// Animation can start while later top-level awaits are still building labels/UI.
// Only enable handoffs once every declaration and the guest API are initialized.
regionStreamingReady = true;
