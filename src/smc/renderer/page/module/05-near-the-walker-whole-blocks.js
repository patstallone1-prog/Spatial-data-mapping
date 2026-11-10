// ---- near the walker: whole blocks, then core shapes ----
//
// The screen-error rule refined whatever the camera happened to be looking at, so turning
// round on a street corner asked for a different set of tiles, and the blocks beside you
// arrived only once you faced them. Near the ground the rule is now the simple one: the block
// you are on and the blocks round it are loaded in full (the finest tiles within
// TILE_FULL_RING_M, whichever way you face), a few rounds of blocks beyond that as their core
// building shapes, and the next ring of full blocks is fetched ahead so walking into it costs
// nothing. Up high, looking at the map rather than a street, the screen-error rule stands.
const TILE_FULL_DEPTH = 8;
const TILE_CORE_DEPTH = 6;
const TILE_FULL_RING_M = 320;
const TILE_CORE_RING_M = 1500;
const TILE_PREFETCH_RING_M = 650;
const TILE_RING_HEIGHT_M = 700;
const tileFocus = new THREE.Vector3();
let tileRingsActive = false;
function tileRect(tile) {
  if (!tile.rect) {
    const [west, south, east, north] = tile.bbox;
    const [x0, y0] = xy(west, south), [x1, y1] = xy(east, north);
    tile.rect = [Math.min(x0, x1), Math.min(-y0, -y1), Math.max(x0, x1), Math.max(-y0, -y1)];
  }
  return tile.rect;
}
function tileRingDistance(tile) {
  const [x0, z0, x1, z1] = tileRect(tile);
  const dx = Math.max(x0 - tileFocus.x, 0, tileFocus.x - x1);
  const dz = Math.max(z0 - tileFocus.z, 0, tileFocus.z - z1);
  return Math.hypot(dx, dz);
}
//: The region round the walker, filled out to its edges at the finest depth once the window
//: round the walker is built: the houses' real footprints in their own colours, the streets,
//: pavements and crossings -- the simple city at its best, wherever the walker goes next in it.
//: It grows a ring at a time while nothing else is loading, furthest ahead first.
const TILE_FILL_STEP_M = 250, TILE_FILL_EVERY_MS = 900;
//: Right out over the region (zoom tier 0) it is still filled, a depth up: the houses in their
//: own colours, the carriageways and the pavements, without the lane paint and crossings that
//: are under a pixel from there. Pulled back that far it used to give way to grey massing and
//: road lines, and a region looked unbuilt from above.
const TILE_FILL_FAR_DEPTH = 7;
const tileFill = { region: null, rect: null, radius: 0, reach: 0, lastAt: 0, focus: new THREE.Vector3() };
//: How much built geometry the fill may grow the tiles to (a small device holds a third).
const TILE_FILL_GEOMETRY_BYTES = (typeof deviceIsSmall === "function" && deviceIsSmall() ? 100 : 300) * 1048576;
function tileFillDepth(tile) {
  if (!tileFill.rect || tileFill.radius <= 0) return null;
  // Past the fill's share of memory nothing more is fetched for it; what it has stays.
  if (tileGeometryResident >= TILE_FILL_GEOMETRY_BYTES && !tileHasContent(tile)) return null;
  const [x0, z0, x1, z1] = tileRect(tile), r = tileFill.rect;
  if (x1 < r[0] || x0 > r[2] || z1 < r[1] || z0 > r[3]) return null;
  // Ahead of a moving walker counts nearer, behind further: the fill leans the way it goes.
  const d = tileRingDistance(tile) * (1 - 0.45 * tileAheadness(tile));
  return d <= tileFill.radius ? (zoomTier < 1 ? TILE_FILL_FAR_DEPTH : TILE_FULL_DEPTH) : null;
}
//: In City mode the area is drawn in full by its own build, and nothing past it is filled:
//: the tree is not refined under the area (it is hidden there) and the region round it is not
//: filled out block by block -- that fill, standing still in the Marina, was building and
//: throwing away lawns at 300 MB a minute and pushed the heap over the tab's limit.
function tileHeldByCity(tile) {
  if (typeof cityLock === "undefined" || !cityLock) return false;
  const [x0, z0, x1, z1] = tileRect(tile), b = cityLock.box;
  return x0 >= b[0] && x1 <= b[2] && z0 >= b[1] && z1 <= b[3];
}
function growTileFill(now) {
  if (META) { tileFill.rect = null; return; }   // the headset holds only the blocks round you
  if (typeof cityLock !== "undefined" && cityLock) { tileFill.rect = null; tileFill.region = null; return; }
  const region = typeof activeGuest !== "undefined" && activeGuest ? activeGuest.region : REGION_INDEX.host;
  if (!region || !TILE_INDEX?.regions?.[region.name]) { tileFill.rect = null; return; }
  if (tileFill.region !== region || tileFill.focus.distanceTo(tileFocus) > 500) {
    // A new region, or a jump within one: begin again from the walker.
    const [s, w, n, e] = region.bbox, [ax, ay] = xy(w, s), [bx, by] = xy(e, n);
    tileFill.region = region;
    tileFill.rect = [Math.min(ax, bx), Math.min(-ay, -by), Math.max(ax, bx), Math.max(-ay, -by)];
    tileFill.radius = TILE_FULL_RING_M;
    tileFill.lastAt = now;
  }
  tileFill.focus.copy(tileFocus);
  const r = tileFill.rect;
  tileFill.reach = Math.max(...[[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]
    .map(([x, z]) => Math.hypot(x - tileFocus.x, z - tileFocus.z)));
  // Pulled back over the map (kerbs gone, zoom tier 1 or 0) the whole region is wanted at once:
  // there is no street underfoot to wait for, and the queue fetches the nearest first.
  if (zoomTier <= 1) { if (tileGeometryResident < TILE_FILL_GEOMETRY_BYTES) tileFill.radius = tileFill.reach; return; }
  // Only while the window and the tiles are idle: the street underfoot always comes first.
  const cells = worldCellCache.snapshot();
  // And only while the tiles' geometry is under TILE_FILL_GEOMETRY_BYTES: a filled tile stays
  // drawn (it cannot be let go), and the fill went on to the region's edges, half a gigabyte and
  // growing, with nothing else asking for it.
  const idle = !attaching && !cells.active && !cells.queued && tileInFlight === 0 && tileQueue.length === 0
    && tileGeometryResident < TILE_FILL_GEOMETRY_BYTES;
  if (idle && tileFill.radius < tileFill.reach && now - tileFill.lastAt > TILE_FILL_EVERY_MS) {
    tileFill.radius = Math.min(tileFill.reach, tileFill.radius + TILE_FILL_STEP_M);
    tileFill.lastAt = now;
  }
}
window.kerbsideTileFill = () => ({ region: tileFill.region?.name || null, radius: Math.round(tileFill.radius),
  geometryMB: Math.round(tileGeometryResident / 1048576),
  reach: Math.round(tileFill.reach), complete: tileFill.reach > 0 && tileFill.radius >= tileFill.reach });
//: The depth this tile should be drawn to near the walker, or null where the screen-error
//: rule decides.
function tileRingDepth(tile) {
  if (tileHeldByCity(tile)) return null;
  const fill = tileFillDepth(tile);
  if (!tileRingsActive) return fill;
  const d = tileRingDistance(tile);
  if (d <= TILE_FULL_RING_M) return TILE_FULL_DEPTH;
  if (fill !== null) return fill;
  if (d <= TILE_CORE_RING_M) return TILE_CORE_DEPTH;
  return null;
}

function selectTiles(tile, out, eye = camera) {
  const ring = tileRingDepth(tile);
  if (ring === null && !tileInView(tile)) return;
  const error = tileScreenErrorPx(tile, eye);
  const refine = tile.children.length > 0 && !tileHeldByCity(tile) && (ring !== null ? tile.depth < ring
    // Outside the rings, near the ground: nothing finer than core shapes.
    : error > TILE_MAX_SCREEN_ERROR_PX && (!tileRingsActive || tile.depth < TILE_CORE_DEPTH));
  if (!refine) { out.push(tile); return; }
  const kids = tile.children.map((id) => TILES.get(id)).filter(Boolean);
  let ready = true;
  for (const kid of kids) {
    const wanted = tileRingDepth(kid) !== null;
    if (!wanted && !tileInView(kid)) continue;
    if (!tileHasContent(kid)) { requestTile(kid, error, tileInView(kid), tileAheadness(kid, eye), eye); ready = false; }
  }
  if (!ready) { out.push(tile); return; }
  for (const kid of kids) selectTiles(kid, out, eye);
}

//: The next ring of full blocks, fetched before the walker reaches it.
function prefetchRing(tile, eye = camera) {
  if (tileRingDistance(tile) > TILE_PREFETCH_RING_M || tileHeldByCity(tile)) return;
  if (tile.depth >= TILE_FULL_DEPTH) {
    if (!tileHasContent(tile) && !tilePending(tile)) requestTile(tile, 0, false, tileAheadness(tile, eye), eye);
    return;
  }
  for (const id of tile.children) {
    const kid = TILES.get(id);
    if (kid) prefetchRing(kid, eye);
  }
}

//: How far a tile lies in the direction the camera is moving, from -1 (behind) to 1 (ahead).
const tileMotion = new THREE.Vector3();
let tileLastCamera = new THREE.Vector3();
let tileLastAt = 0;
function tileAheadness(tile, eye = camera) {
  if (tileMotion.lengthSq() < 1e-6) return 0;
  const dx = tile.cx - eye.position.x, dz = tile.cz - eye.position.z;
  const len = Math.hypot(dx, dz) || 1;
  return (dx / len) * tileMotion.x + (dz / len) * tileMotion.z;
}

//: The ring outside what is drawn: the neighbours of the deepest tiles on screen, and the
//: ones the camera is moving towards, asked for before they are needed. Crossing a boundary
//: should not be the moment the next square starts loading.
function prefetchTiles(drawn, eye = camera) {
  if (tileInFlight >= TILE_MAX_CONCURRENT) return;
  const speed = tileMotion.length();
  for (const tile of drawn) {
    if (tile.depth < 3) continue;
    const parent = TILES.get(tile.parent);
    if (!parent) continue;
    for (const id of parent.children) {
      const sibling = TILES.get(id);
      if (!sibling || tileHasContent(sibling) || tilePending(sibling) || tileHeldByCity(sibling)) continue;
      const ahead = tileAheadness(sibling, eye);
      // Behind you, and not moving: it can wait until it is looked at.
      if (speed > 0.5 && ahead < -0.2) continue;
      requestTile(sibling, TILE_MAX_SCREEN_ERROR_PX, tileInView(sibling), ahead, eye);
    }
    for (const id of tile.children) {
      const kid = TILES.get(id);
      if (kid && !tileHasContent(kid) && !tilePending(kid) && !tileHeldByCity(kid) && tileAheadness(kid, eye) > 0.2) {
        requestTile(kid, TILE_MAX_SCREEN_ERROR_PX, false, tileAheadness(kid, eye), eye);
      }
    }
  }
}

//: Resident geometry, dropped from the far end. Never a tile being drawn, and never one whose
//: parent is gone -- dropping an ancestor is how a hole opens.
function evictTiles(eye = camera) {
  if (tileResidentBytes <= TILE_RESIDENT_BUDGET) return;
  const candidates = [];
  for (const tile of TILES.values()) {
    if (!tileHasContent(tile) || !tile.group || tile.drawn) continue;
    candidates.push(tile);
  }
  candidates.sort((a, b) => (b.lastDrawn === a.lastDrawn
    ? Math.hypot(b.cx - eye.position.x, b.cz - eye.position.z) - Math.hypot(a.cx - eye.position.x, a.cz - eye.position.z)
    : a.lastDrawn - b.lastDrawn));
  for (const tile of candidates) {
    if (tileResidentBytes <= TILE_RESIDENT_BUDGET * 0.8) break;
    tileGroupRoot.remove(tile.group);
    tile.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const material of tile.materials || []) material.dispose();
    tile.materials = null;
    tile.group = null;
    tile.state = "unavailable";
    tileResidentBytes -= tile.bytes;
    tileGeometryResident -= tile.geometryBytes || 0;
    tileStats.evicted += 1;
  }
}
//: The tiles City mode does not draw, let go when its area is up: those under the area (hidden
//: there by its own build, tileHeldByCity) and those past the ring round you that Explore had
//: filled in -- 578 MB of them kept for nothing (2026-11-09).
function evictTilesHeldByCity() {
  for (const tile of TILES.values()) {
    if (!tile.group || tile.drawn || !(tileHeldByCity(tile) || tileRingDistance(tile) > TILE_PREFETCH_RING_M)) continue;
    tileGroupRoot.remove(tile.group);
    tile.group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    for (const material of tile.materials || []) material.dispose();
    tile.materials = null;
    tile.group = null;
    tile.state = "unavailable";
    tileResidentBytes -= tile.bytes;
    tileGeometryResident -= tile.geometryBytes || 0;
    tileStats.evicted += 1;
  }
}

let tileFrame_ = 0;
function updateTileTree(now, eye = camera) {
  if (!TILE_INDEX) return;
  if (eye === camera && (tileFrame_++ % TILE_TRAVERSE_EVERY) !== 0) return;
  // Where the camera is going, in metres a second, smoothed.
  const at = now || performance.now();
  if (tileLastAt) {
    const dt = Math.max(0.001, (at - tileLastAt) / 1000);
    tileMotion.set((eye.position.x - tileLastCamera.x) / dt, 0, (eye.position.z - tileLastCamera.z) / dt);
    const speed = tileMotion.length();
    if (speed > 0.001) tileMotion.multiplyScalar(1 / speed);
    else tileMotion.set(0, 0, 0);
  }
  tileLastCamera.copy(eye.position);
  tileLastAt = at;

  eye.updateMatrixWorld();
  TILE_MATRIX.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse);
  TILE_FRUSTUM.setFromProjectionMatrix(TILE_MATRIX);

  // Where the walker is, or the point the map camera orbits; the rings apply near the ground.
  tileFocus.copy(typeof state !== "undefined" ? (state.firstPerson ? avatar.position : state.target) : eye.position);
  tileRingsActive = eye.position.y - tileFocus.y < TILE_RING_HEIGHT_M;
  if (eye === camera) growTileFill(at);
  const drawn = [];
  const rootTile = TILES.get("0/0/0");
  if (rootTile) selectTiles(rootTile, drawn, eye);
  if (rootTile && tileRingsActive && tileInFlight < TILE_MAX_CONCURRENT) prefetchRing(rootTile, eye);
  const wanted = new Set(drawn.map((t) => t.id));
  for (const tile of TILES.values()) {
    if (!tile.group) { tile.drawn = false; continue; }
    const show = wanted.has(tile.id);
    if (show) {
      // A tile that is wanted is solid at once. Fading it *in* meant that in the frame it was
      // first chosen it was drawn at nothing, and a tile chosen in the same frame its parent
      // was dropped left a hole -- the very seam the fade was there to hide.
      tile.group.visible = true;
      tile.fadeOutFrom = 0;
      for (const material of tile.materials || []) material.opacity = 1;
      tile.lastDrawn = at;
    } else if (tile.drawn) {
      // Not wanted any more: the children that replace it are already solid underneath, so
      // the parent is faded out over it rather than cut.
      tile.fadeOutFrom = at;
    }
    if (!show && tile.fadeOutFrom) {
      const k = Math.min(1, Math.max(0, (at - tile.fadeOutFrom) / TILE_FADE_MS));
      for (const material of tile.materials || []) material.opacity = 1 - k;
      if (k >= 1) { tile.group.visible = false; tile.fadeOutFrom = 0; }
    }
    tile.drawn = show;
  }
  for (const marker of regionMarkers.children) {
    const within = marker.userData.hideWithin;
    if (!within) continue;
    if (marker.userData.posts) { showRegionPosts(marker, eye, within); continue; }
    marker.visible = Math.hypot(eye.position.x - marker.position.x, eye.position.z - marker.position.z) > within;
  }
  tileStats.drawn = drawn.length;
  tileStats.deepest = drawn.reduce((d, t) => Math.max(d, t.depth), 0);
  prefetchTiles(drawn, eye);
}

//: The region posts, one instance each: out (scaled to nothing) within `within` of the eye.
const regionPostMatrix = new THREE.Matrix4();
function showRegionPosts(posts, eye, within) {
  const { posts: at, postShown: shown } = posts.userData;
  let changed = false;
  for (let i = 0; i < at.length; i += 1) {
    const show = Math.hypot(eye.position.x - at[i][0], eye.position.z - at[i][2]) > within;
    if (show === shown[i]) continue;
    shown[i] = show; changed = true;
    regionPostMatrix.makeTranslation(at[i][0], at[i][1], at[i][2]);
    if (!show) regionPostMatrix.scale(new THREE.Vector3(0, 0, 0));
    posts.setMatrixAt(i, regionPostMatrix);
  }
  if (changed) posts.instanceMatrix.needsUpdate = true;
}

async function loadTileTree() {
  let index = null;
  try {
    const response = await fetch(asset(TILE_BASE + "index.json"), { cache: "no-cache" });
    if (response.ok) index = await response.json();
  } catch (e) { index = null; }
  if (!index || !index.tiles) return;
  for (const row of index.tiles) {
    const [west, south, east, north] = row.bbox;
    const [x0, y0] = xy(west, south);
    const [x1, y1] = xy(east, north);
    const bytes = Object.values(row.assets || {}).reduce((sum, a) => sum + (a.bytes || 0), 0);
    TILES.set(row.id, {
      id: row.id, depth: Number(row.id.split("/")[0]), bbox: row.bbox,
      children: row.children || [], parent: tileParentId(row.id),
      assets: row.assets || {}, bytes,
      error: row.geometric_error_m,
      cx: (x0 + x1) / 2, cy: PENINSULA_Y + 40, cz: -(y0 + y1) / 2,
      radius: Math.hypot(x1 - x0, y1 - y0) / 2 + 60,
      state: "unavailable", group: null, materials: null, drawn: false, lastDrawn: 0, fadeOutFrom: 0, priority: 0,
    });
  }
  TILE_INDEX = index;
  console.info(`kerbside: tile tree ${TILES.size} tiles, depths 0..${index.max_depth}, `
    + `errors ${JSON.stringify(index.error_at_depth)} (${index.source})`);
}

function line(points, color, opacity = 1, y = 2, widthHint = 1) {
  const geom = new THREE.BufferGeometry().setFromPoints(points.map((p) => v3(p[0], p[1], y)));
  const mat = new THREE.LineBasicMaterial({
    color, transparent: opacity < 1, opacity,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const obj = new THREE.Line(geom, mat);
  obj.userData.widthHint = widthHint;
  return obj;
}

const TILE_CACHE = new Map();
function tiledMap(base, name, repeatU, repeatV) {
  // A box's UVs run 0..1 per face, so one shared texture would stretch its pattern by however
  // long that stretch of road happens to be -- five-foot slabs on a short segment and ribbons
  // on a long one. Each distinct repeat gets a clone, bucketed to the nearest whole tile so a
  // few dozen textures cover thousands of segments. The clone shares the image; only the
  // repeat differs, so this costs almost nothing.
  const u = Math.max(1, Math.round(repeatU));
  const v = Math.max(1, Math.round(repeatV));
  const key = `${name}:${u}x${v}`;
  if (!TILE_CACHE.has(key)) {
    const map = base.clone();
    map.needsUpdate = true;
    map.repeat.set(u, v);
    TILE_CACHE.set(key, map);
  }
  return TILE_CACHE.get(key);
}

//: How many metres of ground one repeat of each surface covers. With the pattern carried in
//: the vertex UVs rather than in a cloned texture, a footway's slabs stay 1.52 m whatever the
//: shape of the run.
function surfaceScale(surface, width) {
  if (surface === "walk") return [SLAB_M, SLAB_M];
  if (surface === "kerb") return [SLAB_M, SLAB_M];
  if (surface === "walk_underlay") return [SLAB_M, SLAB_M];
  if (surface === "walk_narrow") return [NARROW_SLAB_M, width];
  if (surface === "bike") return [5.5, BIKE_LANE_M];
  if (surface === "road") return [8.0, 8.0];
  if (surface === "divider_block") return [DIVIDER_TILE_M, DIVIDER_TILE_M];
  // A crossing way runs in the direction a person walks. Continental bars cut across that
  // width, one after another along the walking direction, so the repeat is on u, not v.
  if (surface === "crossing") return [CROSSING_PERIOD_M, width];
  if (surface === "crossing_edges") return [1e6, width];
  return [4.0, 4.0];
}

function surfaceBase(surface) {
  if (surface && surface.startsWith("path:")) return pedestrianTexture(surface.slice(5));
  if (surface === "walk") return SIDEWALK;
  if (surface === "kerb") return SIDEWALK;
  if (surface === "walk_underlay") return SIDEWALK;
  if (surface === "walk_narrow") return NARROW_SIDEWALK;
  if (surface === "bike") return BIKE_LANE;
  if (surface === "road") return ROAD;
  if (surface === "divider_block") return DIVIDER_BLOCK;
  if (surface === "crossing") return CROSSING;
  if (surface === "crossing_edges") return CROSSING_EDGES;
  return null;
}

const PEDESTRIAN_TEXTURES = new Map();
function pedestrianTexture(material) {
  if (PEDESTRIAN_TEXTURES.has(material)) return PEDESTRIAN_TEXTURES.get(material);
  if (["concrete", "paved", "unknown"].includes(material)) return SIDEWALK;
  if (material === "asphalt") return ROAD;
  const colours = {sand:[188,171,133],earth:[132,111,83],dirt:[132,111,83],ground:[132,111,83],
    mud:[107,96,76],grass:[89,117,68],woodchips:[140,112,80],gravel:[151,146,132],
    fine_gravel:[162,151,127],compacted:[162,151,127],decomposed_granite:[174,151,115],
    stabilized_soil:[163,146,119],wood:[139,117,86],boardwalk:[139,117,86],
    paving_stones:[159,154,143],sett:[145,143,135],cobblestone:[145,143,135],unknown:[151,153,147]};
  const rgb = colours[material] || colours.unknown;
  const canvas = document.createElement("canvas"); canvas.width=canvas.height=256;
  const ctx=canvas.getContext("2d"),image=ctx.createImageData(256,256);
  // Micro-scale texture only. No large repeated blotches; colour is a visual prior, not a
  // measurement of this path. The observation and certainty stay on its mesh/sidecar.
  for(let i=0;i<256*256;i++) {
    const noise=(random(i+791)*2-1)*14;
    for(let c=0;c<3;c++) image.data[i*4+c]=Math.max(0,Math.min(255,rgb[c]+noise));
    image.data[i*4+3]=255;
  }
  ctx.putImageData(image,0,0);
  if (["wood","boardwalk"].includes(material)) {
    ctx.fillStyle="rgba(35,29,22,.35)";
    for(let y=0;y<256;y+=26)ctx.fillRect(0,y,256,2);
  } else if (["paving_stones","sett","cobblestone"].includes(material)) {
    ctx.strokeStyle="rgba(60,60,56,.35)";ctx.lineWidth=2;
    for(let y=0;y<256;y+=32)for(let x=-(y%64?32:0);x<256;x+=64)ctx.strokeRect(x,y,64,32);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.colorSpace=THREE.SRGBColorSpace;PEDESTRIAN_TEXTURES.set(material,texture);return texture;
}

const FOOTWAY_LOOK = new Set(["unknown", "concrete", "paved"]);
function pathHasOwnMaterial(way) {
  const runs = way.path_runs?.length ? way.path_runs.map((r) => r.resolved) : [way.path_surface];
  return runs.some((r) => r && r.surface_material && !FOOTWAY_LOOK.has(r.surface_material));
}

function renderPedestrianPath(way) {
  const runs = way.path_runs?.length ? way.path_runs : [{points:way.points,resolved:way.path_surface}];
  for(const run of runs) {
    if(!run.points || run.points.length<2)continue;
    const observed=run.resolved || {},material=observed.surface_material || "unknown";
    const width=way.path_width_m || 2.4;
    const mesh=ribbon(densifyWay(run.points,.5),width,0xffffff,1,
      ROAD_TOP_M+.006,.008,`path:${material}`);
    mesh.userData.pathEvidence={material,confidence:observed.confidence || 0,
      basis:observed.basis || "unknown",geometry_changed:false,source:observed.source_id || null,
      width_basis:way.path_width_m ? "osm_width" : "visual_width_prior"};
    // Included in the existing walk/grass exclusion and terrain draping families, but
    // merged only with paths of this material, never the concrete sidewalk batch.
    addMerged(`path:${material}`,mesh,"walk");
  }
}

//: A mitre longer than this would spike out of a hairpin, so the join is cut off instead.
const MAX_MITRE = 2.6;

function mitredEdges(points, width) {
  // The two edges of a band following a polyline, joined at each vertex rather than butted.
  // `width` is one number, or one per point where the band is not the same width all along:
  // a divided road's half widens toward the tunnel it feeds.
  //
  // Every surface in this model used to be a chain of separate boxes, one per segment, each
  // rotated to its own bearing. On a straight run that is invisible. On a curve the boxes
  // splay apart like a fan and leave wedges of ground between them, and around a corner they
  // scatter -- which is what all the loose pavement squares were. A band with mitred joins has
  // no seams to open because it is one surface.
  const varying = Array.isArray(width);
  const path = [];
  const halves = [];
  points.forEach((point, k) => {
    const [x, y] = xy(point[0], point[1]);
    const last = path[path.length - 1];
    if (!last || Math.hypot(x - last[0], -y - last[1]) > 0.05) {
      path.push([x, -y]);
      halves.push((varying ? width[Math.min(k, width.length - 1)] : width) / 2);
    }
  });
  if (path.length < 2) return null;

  const left = [];
  const right = [];
  const distances = [0];
  for (let i = 0; i < path.length; i += 1) {
    const previous = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    // Both directions point *along* the way. Taking the incoming one reversed made the two
    // cancel on a straight run, so the bisector was a zero vector, normalising it produced
    // whatever the floating point gave back, and the band exploded into shards.
    const inDir = i === 0 ? null : norm(path[i], previous);
    const outDir = i === path.length - 1 ? null : norm(next, path[i]);
    const a = inDir || outDir;
    const b = outDir || inDir;
    // The mitre bisects the turn; dividing by the cosine of half the turn keeps the band's
    // width constant through it instead of pinching.
    let mx = a[1] + b[1];
    let mz = -(a[0] + b[0]);
    const length = Math.hypot(mx, mz);
    if (length < 1e-6) {
      // A hairpin folded back on itself: there is no bisector. Use the outgoing normal.
      mx = b[1]; mz = -b[0];
    } else {
      mx /= length; mz /= length;
    }
    const cosine = Math.max(0.38, mx * a[1] + mz * -a[0]);
    const scale = Math.min(MAX_MITRE, 1 / cosine) * halves[i];
    left.push([path[i][0] + mx * scale, path[i][1] + mz * scale]);
    right.push([path[i][0] - mx * scale, path[i][1] - mz * scale]);
    if (i > 0) {
      distances.push(distances[i - 1] +
        Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    }
  }
  return { path, left, right, distances };
}

function norm(to, from) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
}

function crossingStripePhase(length) {
  // Fit a whole number of 430 mm bars plus 430 mm gaps, then divide the leftover equally
  // between both curb faces.  Starting every ribbon at texture-u zero clipped a full bar at
  // one curb and left a gap at the other, making a geometrically centred crossing look crooked.
  const bars = Math.max(1, Math.floor(length / CROSSING_PERIOD_M + 0.5));
  const paintedSequence = (bars - 0.5) * CROSSING_PERIOD_M;
  const margin = Math.max(0, (length - paintedSequence) / 2);
  return (1 - margin / CROSSING_PERIOD_M) % 1;
}

function ribbon(points, widthOrWidths, color, opacity, y, thickness = 1.4, surface = null) {
  const edges = mitredEdges(points, widthOrWidths);
  if (!edges) return new THREE.Group();
  const { left, right, distances } = edges;
  const width = Array.isArray(widthOrWidths)
    ? widthOrWidths.reduce((a, b) => a + b, 0) / widthOrWidths.length : widthOrWidths;
  const [scaleU, scaleV] = surfaceScale(surface, width);
  const phaseU = surface === "crossing"
    ? crossingStripePhase(distances[distances.length - 1] || 0) : 0;
  const top = y + thickness / 2;
  const bottom = y - thickness / 2;

  const position = [];
  const uv = [];
  const index = [];
  const push = (x, z, height, u, v) => {
    position.push(x, height, z);
    uv.push(u, v);
    return position.length / 3 - 1;
  };

  // The running surface.
  const topRow = [];
  for (let i = 0; i < left.length; i += 1) {
    const u = distances[i] / scaleU + phaseU;
    topRow.push([
      push(left[i][0], left[i][1], top, u, 0),
      push(right[i][0], right[i][1], top, u, width / scaleV),
    ]);
  }
  for (let i = 1; i < topRow.length; i += 1) {
    const [al, ar] = topRow[i - 1];
    const [bl, br] = topRow[i];
    index.push(al, bl, ar, ar, bl, br);
  }

  // The two faces of the band's own thickness, which is what a kerb is.
  if (thickness > 0.05) {
    for (const [side, sign] of [[left, 1], [right, -1]]) {
      const rows = [];
      for (let i = 0; i < side.length; i += 1) {
        const u = distances[i] / scaleU + phaseU;
        rows.push([
          push(side[i][0], side[i][1], top, u, 0),
          push(side[i][0], side[i][1], bottom, u, thickness / scaleV),
        ]);
      }
      for (let i = 1; i < rows.length; i += 1) {
        const [at, ab] = rows[i - 1];
        const [bt, bb] = rows[i];
        if (sign > 0) index.push(at, ab, bt, bt, ab, bb);
        else index.push(at, bt, ab, ab, bt, bb);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, surfaceMaterial(surface, color, opacity));
  // What this is, carried on the mesh itself. Without it nothing downstream -- the inspection
  // probe, and the checks that use it -- can tell a footway laid in the road from a footway.
  mesh.userData.surface = surface || "road";
  mesh.userData.widthMeters = width;
  return mesh;
}

function surfaceMaterial(surface, color, opacity) {
  // One material per surface, so a corner piece and the ribbons it joins share a draw call
  // and, more to the point, a texture and a shade: the fingerprint that merges them is built
  // from these properties.
  const painted = surface === "crossing" || surface === "crossing_edges";
  return new THREE.MeshStandardMaterial({
    color, opacity, roughness: surface === "road" ? 0.86 : 0.94, metalness: 0.02,
    // Alpha-tested road paint belongs in the opaque queue. Sorting overlapping transparent
    // crossing rectangles produced the dark smears seen at perpendicular seams.
    transparent: opacity < 1,
    // Paint or not paint, at the half: below this the edge fades over a texel and a bar reads
    // as dissolving into the road at the far end of a street.
    alphaTest: painted ? 0.5 : 0,
    depthWrite: true,
    map: surfaceBase(surface),
    side: THREE.DoubleSide,
    polygonOffset: painted,
    polygonOffsetFactor: painted ? -4 : 0,
    polygonOffsetUnits: painted ? -8 : 0,
    // The kerb carries its paint on its own vertices: red, yellow, white, green or blue over the
    // same concrete texture, which is what painted concrete looks like. The colour is put on
    // when the curb policy loads, and it is in the tile rather than laid over it.
    vertexColors: surface === "kerb",
  });
}

// ---- one draw call per material, not per thing ----
//
// The map was issuing 65,985 draw calls a frame. Not 2.4 million triangles' worth of geometry --
// the triangles were fine -- but a hundred and twenty thousand separate objects, each with its
// own matrix to update, its own frustum test and its own state change. That is several seconds
// of processor per frame before a pixel is drawn, and it is the whole of what the map feels
// like when it is slow.
//
// Almost none of it needed to be separate. Thirty-six thousand street ribbons share eight
// materials between them; they never move, never toggle individually, and nothing picks them.
// So they are collected by material and merged, and the eight that come out draw the same
// pixels as the thirty-six thousand that went in.
//
// What stays separate is what has to: a building is picked by right-clicking it and carries its
// own address, so it keeps its own mesh.
const MERGED = new Map();
// A nearby house can replace its batched facade with a shell cut around the
// same windows and doors used by its interior. Keep reversible index ranges.
const BUILDING_VISUAL_RANGES = new Map();
const HOME_RENDER = new Map();
//: Every building's wall as drawn: vertex tint, cladding map, finish (exterior editor).
const BUILDING_WALL_LOOK = new Map();
let BUILDING_VISUAL_ID = null;

function materialKey(material) {
  // By what it draws, not by which object it is. Every one of these meshes builds its own
  // MeshStandardMaterial, so there were 50,279 distinct material objects across the facade
  // detail and 1,732 across the streets -- and nothing could share a draw call with anything.
  // Fingerprinted on the properties that actually change the pixels, the same fifty thousand
  // collapse to a couple of dozen.
  if (!material) return "none";
  if (Array.isArray(material)) return "multi:" + material.map(materialKey).join("|");
  return [
    material.type,
    material.map ? material.map.uuid : "-",
    material.color ? material.color.getHexString() : "-",
    (material.roughness ?? 0).toFixed(2),
    (material.metalness ?? 0).toFixed(2),
    material.transparent ? "t" : "o",
    (material.opacity ?? 1).toFixed(2),
    (material.alphaTest ?? 0).toFixed(2),
    material.side,
    material.polygonOffset ? `${material.polygonOffsetFactor}/${material.polygonOffsetUnits}` : "-",
    // These change the pixels too, and now that buckets share material objects a bucket whose
    // colour rides on its vertices must never borrow a material that ignores them.
    material.vertexColors ? "vc" : "-",
    (material.envMapIntensity ?? 1).toFixed(2),
    material.emissive ? material.emissive.getHexString() : "-",
    material.depthWrite === false ? "nodw" : "dw",
  ].join(":");
}

//: One material object per fingerprint. Two buckets that draw the same pixels -- a roof and a
//: yard wall in the same texture, say -- used to hold two material objects, and the renderer
//: re-bound every uniform between them; with one object it sorts them together and binds once.
const CANONICAL_MATERIALS = new Map();
function addMerged(key, mesh, surface) {
  if (!mesh || !mesh.geometry) return;
  // A copy, never the object itself: BufferGeometry.clone() shares userData between a
  // geometry and its clones, so tagging a wall slice tagged the roof sliced from the same
  // extrusion -- and every nearby house shell then hid its roof with its walls.
  if (BUILDING_VISUAL_ID !== null && (key === "wall" || key === "plane"))
    mesh.geometry.userData = { ...mesh.geometry.userData, homeId: BUILDING_VISUAL_ID };
  const fingerprint = materialKey(mesh.material);
  const liftKey=typeof cutLiftAt === "function" && WAY_LIFT===cutLiftAt ? 'cut-road' : WAY_LIFT?.groundLiftKey;
  const deferredLift=Boolean(liftKey);
  const full = `${key}|${fingerprint}${deferredLift ? ':'+liftKey : ''}`;
  let bucket = MERGED.get(full);
  if (!bucket) {
    let material = CANONICAL_MATERIALS.get(fingerprint);
    if (!material) CANONICAL_MATERIALS.set(fingerprint, material = mesh.material);
    MERGED.set(full, bucket = { material, surface, parts: [], groundLift:deferredLift ? WAY_LIFT : null });
  }
  // The mesh's own placement has to be baked in: a merged geometry has no transform of its own,
  // and every one of these was positioned rather than built where it stands.
  mesh.updateMatrix();
  if (!mesh.matrix.equals(IDENTITY)) mesh.geometry.applyMatrix4(mesh.matrix);
  if (WAY_LIFT && !deferredLift) {
    // Pre-lifted by what this way's ground differs from the grid by, so that the one lift
    // onto the grid that every merged mesh gets later lands these vertices on the way's own
    // ground -- the road in the cut, not the deck over it.
    const attribute = mesh.geometry.getAttribute("position");
    for (let i = 0; i < attribute.count; i += 1) {
      const x = attribute.getX(i), z = attribute.getZ(i);
      const delta = WAY_LIFT(x, z) - groundLiftAt(x, z);
      if (delta !== 0) attribute.setY(i, attribute.getY(i) + delta);
    }
  }
  bucket.parts.push(mesh.geometry);
}

const IDENTITY = new THREE.Matrix4();

//: Merged meshes are cut into tiles this wide, each culled on its own. Merged by material alone,
//: a bucket was one mesh spanning the corridor that could never be culled: standing on one block
//: in first person drew every kerb in the corridor -- twenty-seven million triangles a frame,
//: a few frames a second on an ordinary laptop. Tiled, a street corner draws its own tiles.
//: At this size the whole corridor on screen is a little over a thousand draw calls.
const MERGE_TILE_M = 400.0;
//: A tile is worth its draw call when it carries about this many vertices. A bucket whose
//: tiles would be thinner is cut at twice the size, and thinner still it stays one mesh: the
//: buildings' hundred and seventy texture buckets carry two million triangles between them,
//: and tiled at four hundred metres they were three thousand draw calls for nothing.
const MERGE_TILE_MIN_VERTICES = 40000;
//: What the merge did, for the console: parts in, meshes out, triangles.
const mergeStats = { parts: 0, meshes: 0, triangles: 0 };

function flushMerged(group, match = () => true) {
  let saved = 0;
  for (const [key, bucket] of [...MERGED]) {
    if (!match(key)) continue;
    MERGED.delete(key);
    const parts = bucket.parts.filter((geometry) => geometry.getAttribute("position"));
    let total = 0;
    for (const geometry of parts) total += geometry.getAttribute("position").count;
    // Each part goes in the tile under the middle of its box; a part is never split. The tile
    // size is the smallest at which the tiles are worth their draw calls.
    let tiles = new Map([["all", parts]]);
    if (total >= 2 * MERGE_TILE_MIN_VERTICES) {
      for (const geometry of parts) geometry.computeBoundingBox();
      for (const size of [MERGE_TILE_M, 2 * MERGE_TILE_M, 4 * MERGE_TILE_M]) {
        const attempt = new Map();
        for (const geometry of parts) {
          const box = geometry.boundingBox;
          const tile = `${Math.floor((box.min.x + box.max.x) / (2 * size))}:${Math.floor((box.min.z + box.max.z) / (2 * size))}`;
          let list = attempt.get(tile);
          if (!list) attempt.set(tile, list = []);
          list.push(geometry);
        }
        if (total / attempt.size >= MERGE_TILE_MIN_VERTICES) { tiles = attempt; break; }
      }
    }
    for (const list of tiles.values()) {
      const merged = mergeParts(list);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, bucket.material);
      for (const range of merged.userData.homeRanges || []) {
        let list = BUILDING_VISUAL_RANGES.get(range.id);
        if (!list) BUILDING_VISUAL_RANGES.set(range.id, list = []);
        list.push({ mesh, start: range.start, indices: range.indices });
      }
      // The class survives the merge, so the probe and the audit can still say what is underfoot.
      mesh.userData.surface = bucket.surface;
      mesh.userData.mergeKey = key;
      if(bucket.groundLift)mesh.userData.groundLiftFunction=bucket.groundLift;
      // A tile is culled when it is off screen. A bucket small enough to stay one mesh spans the
      // corridor and is always on screen; culling it would only cost the test.
      mesh.frustumCulled = tiles.size > 1;
      if (mesh.frustumCulled) merged.computeBoundingSphere();
      group.add(mesh);
      saved += list.length;
      mergeStats.meshes += 1;
      mergeStats.triangles += merged.index.count / 3;
    }
    mergeStats.parts += parts.length;
  }
  return saved;
}

//: One geometry from many, straight into typed arrays. The merge used to grow four JavaScript
//: arrays a number at a time and convert them at the end -- for fifteen million triangles that
//: is a few hundred million pushes and a heap the size of the payload several times over.
function mergeParts(parts) {
  let vertices = 0, indices = 0;
  for (const geometry of parts) {
    const count = geometry.getAttribute("position").count;
    const index = geometry.getIndex();
    vertices += count;
    indices += index ? index.count : count;
  }
  if (!indices) return null;
  const positions = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const normals = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const merged = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let v = 0, k = 0;
  const homeRanges = [];
  for (const geometry of parts) {
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    const normal = geometry.getAttribute("normal");
    // The colour a building carries on its vertices, because its tint can no longer live on
    // its material -- there is one material now for a hundred and fifty buildings. Dropping
    // this attribute in the merge, which is what happened first, leaves the shader reading a
    // colour that is not there: every building in the city came out black.
    const colour = geometry.getAttribute("color");
    const n = position.count;
    for (let i = 0; i < n; i += 1) {
      const p3 = (v + i) * 3, p2 = (v + i) * 2;
      positions[p3] = position.getX(i); positions[p3 + 1] = position.getY(i); positions[p3 + 2] = position.getZ(i);
      // A merged geometry has one attribute set or none, so a part without UVs still has to
      // contribute two numbers per vertex or every vertex after it reads the wrong pair.
      if (uv) { uvs[p2] = uv.getX(i); uvs[p2 + 1] = uv.getY(i); }
      if (normal) { normals[p3] = normal.getX(i); normals[p3 + 1] = normal.getY(i); normals[p3 + 2] = normal.getZ(i); }
      else normals[p3 + 1] = 1;
      if (colour) { colours[p3] = colour.getX(i); colours[p3 + 1] = colour.getY(i); colours[p3 + 2] = colour.getZ(i); }
      else { colours[p3] = 1; colours[p3 + 1] = 1; colours[p3 + 2] = 1; }
    }
    const start = k;
    const index = geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i += 1) merged[k++] = v + index.getX(i);
    else for (let i = 0; i < n; i += 1) merged[k++] = v + i;
    if (geometry.userData.homeId !== undefined)
      homeRanges.push({ id: String(geometry.userData.homeId), start,
        indices: merged.slice(start, k) });
    v += n;
    geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(new THREE.BufferAttribute(merged, 1));
  geometry.userData.homeRanges = homeRanges;
  return geometry;
}

//: The same tiling for a group whose meshes were laid straight into it -- the ground cover, the
//: street furniture -- rather than through the merge. Every mesh over MERGE_TILE_MIN_VERTICES
//: is cut along tile lines, triangle by triangle, into pieces culled on their own; an instanced
//: mesh is split by where its instances stand. Run before the group is lifted, so that the
//: pieces get their bounds from the lift.
function tileGroup(group) {
  if(BUILD_WINDOW)applyBoxClip(group,detailClipBox);
  let cut = 0;
  for (const mesh of group.children.slice()) {
    if (!mesh.isMesh || !mesh.geometry) continue;
    const pieces = mesh.isInstancedMesh ? tileInstanced(mesh) : tileMesh(mesh);
    if (!pieces) continue;
    group.remove(mesh);
    for (const piece of pieces) group.add(piece);
    cut += 1;
  }
  return cut;
}
const tileKeyOf = (x, z) => `${Math.floor(x / MERGE_TILE_M)}:${Math.floor(z / MERGE_TILE_M)}`;
function inheritMesh(piece, mesh) {
  piece.position.copy(mesh.position);
  piece.quaternion.copy(mesh.quaternion);
  piece.scale.copy(mesh.scale);
  piece.userData = { ...mesh.userData };
  piece.name = mesh.name;
  piece.renderOrder = mesh.renderOrder;
  piece.castShadow = mesh.castShadow;
  piece.receiveShadow = mesh.receiveShadow;
  if (mesh.customDepthMaterial) piece.customDepthMaterial = mesh.customDepthMaterial;
  piece.frustumCulled = true;
  return piece;
}
function tileMesh(...args) { return runSteps(tileMeshSteps(...args)); }
//: The cutting, a step at a time (every 2,048 triangles, and each piece): a city's fine street
//: surface is millions of triangles, and cut in one go it was a frame of nearly three seconds.
function* tileMeshSteps(mesh, sizes = [MERGE_TILE_M, 2 * MERGE_TILE_M, 4 * MERGE_TILE_M],
                  minVertices = MERGE_TILE_MIN_VERTICES) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  // A multi-material geometry's index ranges are its material groups; cutting would move them.
  if (!position || position.count < 2 * minVertices || (geometry.groups && geometry.groups.length)) return null;
  mesh.updateMatrixWorld(true);
  const index = geometry.getIndex();
  const triangles = Math.floor((index ? index.count : position.count) / 3);
  // The arrays read once and directly: through getX and getComponent, a value at a time, the
  // cutting was a fifth of a second a street mesh (2026-11-05). A plain attribute's array holds
  // exactly what those return; an interleaved or normalised one is still read through them.
  const plain = (a) => !a.isInterleavedBufferAttribute && !a.normalized;
  const indexArray = index && plain(index) ? index.array : null;
  const vertexAt = indexArray ? (t, j) => indexArray[t * 3 + j]
    : (t, j) => index ? index.getX(t * 3 + j) : t * 3 + j;
  // Each triangle's centre, once; then the tile size at which the tiles are worth drawing.
  const centres = new Float32Array(triangles * 2);
  const v = new THREE.Vector3();
  const P = plain(position) && position.itemSize === 3 ? position.array : null;
  for (let t = 0; t < triangles; t += 1) {
    if ((t & 2047) === 2047) yield;
    let cx = 0, cz = 0;
    for (let j = 0; j < 3; j += 1) {
      const i = vertexAt(t, j);
      if (P) v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); else v.set(position.getX(i), position.getY(i), position.getZ(i));
      v.applyMatrix4(mesh.matrixWorld);
      cx += v.x; cz += v.z;
    }
    centres[t * 2] = cx / 3; centres[t * 2 + 1] = cz / 3;
  }
  let byTile = null;
  for (const size of sizes) {
    const attempt = new Map();
    for (let t = 0; t < triangles; t += 1) {
      if ((t & 2047) === 2047) yield;
      const key = Math.floor(centres[t * 2] / size) * 1048576 + Math.floor(centres[t * 2 + 1] / size);
      let list = attempt.get(key);
      if (!list) attempt.set(key, list = []);
      list.push(t);
    }
    if (position.count / attempt.size >= minVertices) { byTile = attempt; break; }
  }
  if (!byTile || byTile.size < 2) return null;
  const names = ["position", "normal", "uv", "color"].filter((n) => geometry.getAttribute(n));
  const pieces = [];
  // Each source vertex's number in the piece being cut (-1: not in it), one array for every
  // piece, put back after each.
  const remap = new Int32Array(position.count).fill(-1);
  let work = 0;
  for (const tris of byTile.values()) {
    const order = [];
    const idx = new Uint32Array(tris.length * 3);
    let k = 0;
    for (const t of tris) {
      if ((++work & 2047) === 0) yield;
      for (let j = 0; j < 3; j += 1) {
        const i = vertexAt(t, j);
        let m = remap[i];
        if (m < 0) { m = order.length; order.push(i); remap[i] = m; }
        idx[k++] = m;
      }
    }
    for (const i of order) remap[i] = -1;
    const g = new THREE.BufferGeometry();
    for (const n of names) {
      const src = geometry.getAttribute(n);
      const size = src.itemSize;
      const arr = new Float32Array(order.length * size);
      const A = plain(src) ? src.array : null;
      for (let a = 0; a < order.length; a += 1) {
        if ((a & 65535) === 65535) yield;
        const o = order[a] * size;
        if (A) for (let c = 0; c < size; c += 1) arr[a * size + c] = A[o + c];
        else for (let c = 0; c < size; c += 1) arr[a * size + c] = src.getComponent(order[a], c);
      }
      g.setAttribute(n, new THREE.BufferAttribute(arr, size));
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    yield* boundingSphereSteps(g);
    pieces.push(inheritMesh(new THREE.Mesh(g, mesh.material), mesh));
    yield;
  }
  geometry.dispose();
  return pieces;
}
//: The fine paint and kerb work is cut to a few decimetres so it lies on the hill (settleOnto,
//: refineForTerrain), and was then drawn in four-hundred-metre tiles: a tile was drawn whole
//: if any of it was in range, so crossings and lane lines a kilometre off -- under a pixel, or
//: behind the blocks -- cost as much as the ones underfoot. Cut into these cells after it is
//: laid, the same triangles are drawn only where DETAIL_RANGE_M says they can be seen.
const FINE_SURFACE_CELL_M = {
  crossing: 150, crossing_edges: 150, marking: 150, tactile_warning: 150, curb_ramp: 150,
  kerb: 150, walk_underlay: 200, bike: 200, court_line: 200,
};
const FINE_SURFACE_MIN_VERTICES = 4000;
function cellFineSurfaces(group) { return runSteps(cellFineSurfacesSteps(group)); }
function* cellFineSurfacesSteps(group) {
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.geometry && FINE_SURFACE_CELL_M[o.userData.surface]) meshes.push(o);
  });
  let cut = 0;
  for (const mesh of meshes) {
    const size = FINE_SURFACE_CELL_M[mesh.userData.surface];
    const pieces = yield* tileMeshSteps(mesh, [size, 2 * size, 4 * size], FINE_SURFACE_MIN_VERTICES);
    if (!pieces || !mesh.parent) continue;
    const parent = mesh.parent;
    parent.remove(mesh);
    for (const piece of pieces) parent.add(piece);
    cut += pieces.length;
  }
  return cut;
}
//: An instanced mesh is split where a tile would still hold this many instances: a tile of
//: three conifers is a draw call for three trees.
const INSTANCED_TILE_MIN = 250;
function tileInstanced(mesh) {
  if (mesh.count < 2 * INSTANCED_TILE_MIN) return null;
  mesh.updateMatrixWorld(true);
  const m = new THREE.Matrix4();
  const at = new Float32Array(mesh.count * 2);
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, m);
    m.premultiply(mesh.matrixWorld);
    at[i * 2] = m.elements[12]; at[i * 2 + 1] = m.elements[14];
  }
  let byTile = null;
  for (const size of [MERGE_TILE_M, 2 * MERGE_TILE_M, 4 * MERGE_TILE_M]) {
    const attempt = new Map();
    for (let i = 0; i < mesh.count; i += 1) {
      const key = `${Math.floor(at[i * 2] / size)}:${Math.floor(at[i * 2 + 1] / size)}`;
      let list = attempt.get(key);
      if (!list) attempt.set(key, list = []);
      list.push(i);
    }
    if (mesh.count / attempt.size >= INSTANCED_TILE_MIN) { byTile = attempt; break; }
  }
  if (!byTile || byTile.size < 2) return null;
  const colour = new THREE.Color();
  const pieces = [];
  for (const ids of byTile.values()) {
    const piece = new THREE.InstancedMesh(mesh.geometry, mesh.material, ids.length);
    ids.forEach((i, j) => {
      mesh.getMatrixAt(i, m);
      piece.setMatrixAt(j, m);
      if (mesh.instanceColor) { mesh.getColorAt(i, colour); piece.setColorAt(j, colour); }
    });
    piece.instanceMatrix.needsUpdate = true;
    if (piece.instanceColor) piece.instanceColor.needsUpdate = true;
    inheritMesh(piece, mesh);
    piece.computeBoundingSphere();
    pieces.push(piece);
  }
  return pieces;
}

function offsetWay(points, metres) {
  // The same polyline, shifted sideways. Positive is to the left of travel. `metres` may be
  // one number for the whole way or one per vertex.
  //
  // The footway used to be drawn on whatever centreline OpenStreetMap gave its sidewalk ways,
  // which is not tied to the road at all. Once the carriageway came from the mapped kerbs it
  // was narrower than the right of way it had been derived from, and a strip of bare ground
  // opened between the two along most of the corridor -- black, where the pavement should be.
  // Deriving the footway from the kerb instead means there is nothing for a gap to open in.
  if (points.length < 2) return points;
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const dx = ax - bx;
    const dy = ay - by;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) { out.push(points[i]); continue; }
    const nx = -dy / length;
    const ny = dx / length;
    const here = Array.isArray(metres) ? metres[i] : metres;
    // Back to degrees, at this latitude.
    out.push([
      points[i][0] + (nx * here) / (111320 * Math.cos(points[i][1] * Math.PI / 180)),
      points[i][1] + (ny * here) / 111320,
    ]);
  }
  return out;
}

function wayLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

function densifyWay(points, maxSpan = 5.0) {
  if (!points || points.length < 2) return points || [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const [ax, ay] = xy(a[0], a[1]);
    const [bx, by] = xy(b[0], b[1]);
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length / maxSpan));
    for (let k = 1; k <= steps; k += 1) out.push(lerpLonLat(a, b, k / steps));
  }
  return out;
}

function trimWay(points, metres) {
  // The same way with both ends pulled back.
  //
  // A footway derived from the centreline runs the full length of its street, intersections
  // included -- so at every crossroads four of them ran out over the carriageway and, sitting
  // a kerb's height above it, buried the road in pavement. Stopping short of the corner is
  // also what a real footway does: the kerb turns the corner rather than crossing it.
  if (points.length < 2) return points;
  let total = 0;
  const spans = [];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    const span = Math.hypot(x2 - x1, y2 - y1);
    spans.push(span);
    total += span;
  }
  const cut = Math.min(metres, total / 3);
  if (!(cut > 0.2)) return points;

  const walk = (from, direction) => {
    let remaining = cut;
    let i = from;
    while (i >= 0 && i < spans.length) {
      const span = spans[i];
      if (span >= remaining) {
        const t = direction > 0 ? remaining / span : 1 - remaining / span;
        const a = points[i];
        const b = points[i + 1];
        return [i + (direction > 0 ? 0 : 1),
                [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]];
      }
      remaining -= span;
      i += direction;
    }
    return null;
  };
  const head = walk(0, 1);
  const tail = walk(spans.length - 1, -1);
  if (!head || !tail || head[0] >= tail[0]) return points;
  return [head[1], ...points.slice(head[0] + 1, tail[0]), tail[1]];
}

function trimWalkwayForCorners(points, width) {
  // Crosswalks now end on surveyed curb faces, so they no longer need a circular exclusion
  // zone carved out of the sidewalk.  Keep the mapped walkway continuous here; the exact
  // carriageway-overlap pass below clips only the part that is genuinely on asphalt.
  return points || [];
}

function lonLatFromXZ(x, z) {
  const originLon = typeof midLon === "number" ? midLon : 0;
  const originLat = typeof midLat === "number" ? midLat : 0;
  return [x / metersPerLon + originLon, -z / metersPerLat + originLat];
}

const SIDEWALK_INTERSECTION_CUT_EXTRA_M = 3.0;
const SIDEWALK_INTERSECTION_CUT_MAX_M = 10.5;

function intersectionWalkwayCutback(width) {
  return Math.max(3.0, Math.min(SIDEWALK_INTERSECTION_CUT_MAX_M,
    (width || 3.6) + SIDEWALK_INTERSECTION_CUT_EXTRA_M));
}

const OFFICIAL_CURB_CELL_M = 20.0;
const officialCurbGrid = new Map();
const officialIslandCurbGrid = new Map();
// Only a closed surveyed footprint can establish where crossing paint must stop.
// Open island curb fragments are useful road-envelope evidence, but do not prove
// that the space between them is concrete rather than asphalt.
const crossingIslandCurbGrid = new Map();
const mappedDividerCurbGrid = new Map();
//: The middle of a divided street where the lidar found no raised median (role "median",
//: source "lidar"): the inner edge of each half for the kerb envelope, and nothing else --
//: a painted centre is not a kerb and must not part a crossing or stop a pavement.
const officialMedianGrid = new Map();

function addOfficialCurbGridSegment(grid, ax, az, bx, bz) {
  const x0 = Math.floor(Math.min(ax, bx) / OFFICIAL_CURB_CELL_M);
  const x1 = Math.floor(Math.max(ax, bx) / OFFICIAL_CURB_CELL_M);
  const z0 = Math.floor(Math.min(az, bz) / OFFICIAL_CURB_CELL_M);
  const z1 = Math.floor(Math.max(az, bz) / OFFICIAL_CURB_CELL_M);
  for (let ix = x0; ix <= x1; ix += 1) {
    for (let iz = z0; iz <= z1; iz += 1) {
      const key = `${ix}:${iz}`;
      let bucket = grid.get(key);
      if (!bucket) grid.set(key, bucket = []);
      bucket.push([ax, az, bx, bz]);
    }
  }
}

function closedPhysicalRing(points) {
  if (!points || points.length < 4) return null;
  const ring = points.map(([lon, lat]) => {
    const [x, y] = xy(lon, lat);
    return [x, -y];
  });
  const first = ring[0], last = ring[ring.length - 1];
  if (Math.hypot(last[0] - first[0], last[1] - first[1]) > 0.12) return null;
  let twiceArea = 0;
  for (let i = 1; i < ring.length; i += 1) {
    twiceArea += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  }
  // A folded line can return to its start without enclosing a physical island.
  return Math.abs(twiceArea) >= 0.8 ? ring : null;
}

function closedOfficialIslandRing(line) {
  return line.r === "island" ? closedPhysicalRing(line.p) : null;
}

function indexMappedDividerGeometry(ways) {
  mappedDividerCurbGrid.clear();
  for (const way of ways || []) {
    if (way.kind !== "divider") continue;
    const ring = closedPhysicalRing(way.points);
    if (!ring) continue;
    for (let i = 1; i < ring.length; i += 1) {
      addOfficialCurbGridSegment(mappedDividerCurbGrid,
        ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]);
    }
  }
}

function indexOfficialCurbGeometry(lines) {
  officialCurbGrid.clear();
  officialIslandCurbGrid.clear();
  crossingIslandCurbGrid.clear();
  officialMedianGrid.clear();
  for (const line of lines || []) {
    if (!line.p || line.p.length < 2) continue;
    const grid = line.r === "island" ? officialIslandCurbGrid
      : line.r === "median" ? officialMedianGrid : officialCurbGrid;
    const closedIsland = closedOfficialIslandRing(line) !== null;
    for (let i = 1; i < line.p.length; i += 1) {
      const [ax, ay] = xy(line.p[i - 1][0], line.p[i - 1][1]);
      const [bx, by] = xy(line.p[i][0], line.p[i][1]);
      if (Math.hypot(bx - ax, by - ay) < 0.04) continue;
      addOfficialCurbGridSegment(grid, ax, -ay, bx, -by);
      if (closedIsland) addOfficialCurbGridSegment(crossingIslandCurbGrid, ax, -ay, bx, -by);
    }
  }
}

function rayCurbIntersections(x, z, dx, dz, reach, grid) {
  const x0 = Math.floor((x - reach) / OFFICIAL_CURB_CELL_M);
  const x1 = Math.floor((x + reach) / OFFICIAL_CURB_CELL_M);
  const z0 = Math.floor((z - reach) / OFFICIAL_CURB_CELL_M);
  const z1 = Math.floor((z + reach) / OFFICIAL_CURB_CELL_M);
  const hits = [];
  const seen = new Set();
  for (let ix = x0; ix <= x1; ix += 1) {
    for (let iz = z0; iz <= z1; iz += 1) {
      const bucket = grid.get(`${ix}:${iz}`);
      if (!bucket) continue;
      for (const segment of bucket) {
        const key = segment.join(":");
        if (seen.has(key)) continue;
        seen.add(key);
        const [ax, az, bx, bz] = segment;
        const sx = bx - ax;
        const sz = bz - az;
        const denominator = dx * sz - dz * sx;
        if (Math.abs(denominator) < 1e-6) continue;
        const qx = ax - x;
        const qz = az - z;
        const alongRay = (qx * sz - qz * sx) / denominator;
        const alongCurb = (qx * dz - qz * dx) / denominator;
        if (alongCurb < -0.015 || alongCurb > 1.015 || Math.abs(alongRay) > reach) continue;
        hits.push(alongRay);
      }
    }
  }
  hits.sort((a, b) => a - b);
  return hits.filter((value, i) => i === 0 || Math.abs(value - hits[i - 1]) > 0.18);
}

function officialCurbCrossingSpan(x, z, dx, dz, expectedHalfWidth, mappedLength = 0) {
  // Uniform kerbs and survey kerbs are alternative render policies, not two
  // boundaries that paint can mix. Retain the survey for inspection, but never
  // use a curb return from it to shorten/rotate a default-road crosswalk.
  if (typeof KERB_RENDER_UNIFORM !== "undefined" && KERB_RENDER_UNIFORM) return null;
  if (!officialCurbGrid.size) return null;
  // How far to look for the kerbs: past the carriageway this crossing was matched to, and
  // past the length OpenStreetMap drew it. On a divided road the matched carriageway is one
  // half of the street and the crossing spans both: from the middle of Broadway's eastbound
  // half the north kerb stood fifteen metres off, the reach was twelve, and the crossing fell
  // back to that half's own width -- eight metres of paint across a twenty metre street.
  const reach = Math.min(32.0, Math.max(12.0, expectedHalfWidth * 2.8, mappedLength * 0.75 + 3.0));
  const hits = rayCurbIntersections(x, z, dx, dz, reach, officialCurbGrid);
  const negative = hits.filter((value) => value < -0.45).pop();
  const positive = hits.find((value) => value > 0.45);
  if (negative === undefined || positive === undefined) return null;
  const span = positive - negative;
  // Reject a curb pair from the wrong road arm.  The wide upper bound still permits Van Ness
  // and divided streets; the ratio check catches a nearby alley curb paired with a far block.
  if (span < 2.4 || span > 42.0 || -negative > positive * 3.4 || positive > -negative * 3.4) {
    return null;
  }
  const points = [
    lonLatFromXZ(x + dx * negative, z + dz * negative),
    lonLatFromXZ(x + dx * positive, z + dz * positive),
  ];
  points.provenance = "sfmta_curbs";
  return points;
}

//: Bars are painted on roadway. A crossing's legs are the runs of its span that lie on a
//: drawn carriageway or in a junction box; a gap between two runs is bridged where it is a
//: strip of asphalt narrower than this with no island kerb in it, and breaks the crossing
//: where it is an island -- which is where a walker stops halfway and the bars resume.
const CROSSING_BRIDGE_GAP_M = 2.0;
const CROSSING_LEG_MIN_M = 0.7;
const CROSSING_STEP_M = 0.25;

function crossingPaintLegs(points) {
  if (!points || points.length < 2) return [points];
  const [ax, ay] = xy(points[0][0], points[0][1]);
  const [bx, by] = xy(points[points.length - 1][0], points[points.length - 1][1]);
  const az = -ay;
  const bz = -by;
  const length = Math.hypot(bx - ax, bz - az);
  if (!(length > 1.0)) return [points];
  const dx = (bx - ax) / length;
  const dz = (bz - az) / length;
  const islandHits = (grid) => grid.size
    ? rayCurbIntersections(ax, az, dx, dz, length + 0.5, grid)
        .filter((value) => value > 0.2 && value < length - 0.2)
    : [];
  const officialIslands = islandHits(crossingIslandCurbGrid);
  const mappedIslands = islandHits(mappedDividerCurbGrid);
  const islands = officialIslands.concat(mappedIslands).sort((a, b) => a - b);
  // Between an odd and an even island kerb the span stands on the island, not the road --
  // whether or not the carriageway grid runs on beneath it.
  const onIsland = (tt) => officialIslands.filter((v) => v < tt).length % 2 === 1
    || mappedIslands.filter((v) => v < tt).length % 2 === 1;
  // A run ends where the island kerb is when one was hit in the last step, and otherwise
  // halfway between the last station on the road and the first off it.
  const edgeBetween = (t0, t1) => islands.find((v) => v >= t0 && v <= t1) ?? (t0 + t1) / 2;
  // The runs of the span on roadway.
  const runs = [];
  let start = null;
  let previous = 0;
  const steps = Math.ceil(length / CROSSING_STEP_M);
  for (let i = 0; i <= steps; i += 1) {
    const tt = Math.min(i * CROSSING_STEP_M, length);
    const x = ax + dx * tt, z = az + dz * tt;
    const on = (insideCarriageway(x, z, 0.05) || insideJunctionBox(x, z)) && !onIsland(tt);
    if (on && start === null) start = i === 0 ? 0 : edgeBetween(previous, tt);
    if (!on && start !== null) { runs.push([start, edgeBetween(previous, tt)]); start = null; }
    previous = tt;
  }
  if (start !== null) runs.push([start, length]);
  if (!runs.length) return [points];
  // Bridge the gaps that are asphalt, keep the ones that are islands.
  const legs = [runs[0]];
  for (let i = 1; i < runs.length; i += 1) {
    const last = legs[legs.length - 1];
    const gap = runs[i][0] - last[1];
    const island = islands.some((v) => v > last[1] - 0.1 && v < runs[i][0] + 0.1);
    if (gap <= CROSSING_BRIDGE_GAP_M && !island) last[1] = runs[i][1];
    else legs.push(runs[i].slice());
  }
  const out = legs.filter(([t0, t1]) => t1 - t0 >= CROSSING_LEG_MIN_M)
    .map(([t0, t1]) => [lonLatFromXZ(ax + dx * t0, az + dz * t0), lonLatFromXZ(ax + dx * t1, az + dz * t1)]);
  return out.length ? out : [points];
}

indexOfficialCurbGeometry(OFFICIAL_GEOMETRY.curb_lines || []);

//: A crossing mapped straight across a divided avenue -- both carriageways and the median or
//: the busway between -- is one crossing kerb to kerb. Its span was read from its longest piece
//: on the road out to the nearest kerbs, and on Van Ness those are the median's: the bars ran
//: across one carriageway and stopped, and the other carriageway and the busway were bare. The
//: whole mapped line is cast to the kerbs at its two ends; the legs then break only at a real
//: island (crossingPaintLegs).
function acrossTheWholeRoad(span, points) {
  // No vertex of the mapped line further than this off its chord: straight across.
  const CROSSING_STRAIGHT_M = 2.0;
  if (!span || span.length < 2 || !points || points.length < 3) return span;
  const [ax, ay] = xy(points[0][0], points[0][1]);
  const [bx, by] = xy(points[points.length - 1][0], points[points.length - 1][1]);
  const az = -ay, bz = -by, length = Math.hypot(bx - ax, bz - az);
  if (!(length > 14)) return span;
  const ux = (bx - ax) / length, uz = (bz - az) / length;
  for (const [lon, lat] of points) {
    const [x, y] = xy(lon, lat);
    if (Math.abs((x - ax) * uz - (-y - az) * ux) > CROSSING_STRAIGHT_M) return span;
  }
  const along = (p) => { const [x, y] = xy(p[0], p[1]); return (x - ax) * ux + (-y - az) * uz; };
  const s0 = Math.min(along(span[0]), along(span[span.length - 1]));
  const s1 = Math.max(along(span[0]), along(span[span.length - 1]));
  if (s1 - s0 >= length - 6) return span;
  // Only where the line goes on across more roadway: another carriageway, or a busway, beyond
  // the span. A line that runs on onto the pavement keeps the span it has.
  let more = false;
  for (let t = 1; t < length - 1 && !more; t += 0.5) {
    if (t > s0 - 1.5 && t < s1 + 1.5) continue;
    more = insideCarriageway(ax + ux * t, az + uz * t, 0.0);
  }
  if (!more) return span;
  // The kerbs nearest the mapped line's two ends.
  const hits = typeof KERB_RENDER_UNIFORM !== "undefined" && KERB_RENDER_UNIFORM
    ? [] : rayCurbIntersections(ax, az, ux, uz, length + 4, officialCurbGrid);
  const near = (target) => hits.filter((h) => Math.abs(h - target) <= 4)
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  // Where the city drew no kerb there, the mapped line's own end: it ends on the kerb's node,
  // and endCrossingOnDrawnKerb brings it to the kerb as drawn.
  const h0 = near(0) ?? 0, h1 = near(length) ?? length;
  const from = Math.min(h0, s0), to = Math.max(h1, s1);
  if (to - from > 42.0) return span;
  const wide = [lonLatFromXZ(ax + ux * from, az + uz * from), lonLatFromXZ(ax + ux * to, az + uz * to)];
  wide.provenance = `${span.provenance || "sfmta_curbs"}_across_divided`;
  return wide;
}

//: How much of a crossing way has to lie on the carriageway before it is a crossing of it.
const CROSSING_MIN_ON_ROAD_M = 2.5;
function crossingRoadSpanPoints(points) {
  // OSM supplies the pedestrian desire line; SFMTA supplies the physical curb boundaries.  The
  // segment actually traversing asphalt is used as a ray through the paired curb faces, retaining
  // real skew and terminating on bulb-outs/curb returns.  The local road normal remains the
  // fallback when the official survey is absent or cannot produce a credible pair.
  if (!points || points.length < 2) return null;
  let a = points[0];
  let b = points[points.length - 1];
  let bestRoadMetres = -1;
  // Prefer the part of the OSM polyline that actually traverses asphalt. Its outer connector
  // legs can run a long way along a sidewalk and make the end-to-end chord point almost along
  // the street instead of across it.
  for (let i = 1; i < points.length; i += 1) {
    const candidateA = points[i - 1];
    const candidateB = points[i];
    const [cax, cay] = xy(candidateA[0], candidateA[1]);
    const [cbx, cby] = xy(candidateB[0], candidateB[1]);
    const candidateLength = Math.hypot(cbx - cax, cby - cay);
    if (!(candidateLength > 0.5)) continue;
    const steps = Math.max(3, Math.ceil(candidateLength / 0.75));
    let roadSamples = 0;
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      if (insideCarriageway(cax + (cbx - cax) * t,
                            -cay + (cay - cby) * t, 0.0)) roadSamples += 1;
    }
    const roadMetres = candidateLength * roadSamples / (steps + 1);
    if (roadMetres > bestRoadMetres) {
      bestRoadMetres = roadMetres;
      a = candidateA;
      b = candidateB;
    }
  }
  const [ax, ay] = xy(a[0], a[1]);
  const [bx, by] = xy(b[0], b[1]);
  const az = -ay;
  const bz = -by;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (!(length > 1.2)) return null;
  const ux = dx / length;
  const uz = dz / length;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const cx = Math.floor(mx / CARRIAGEWAY_CELL);
  const cz = Math.floor(mz / CARRIAGEWAY_CELL);
  let best = null;
  const seen = new Set();
  for (let gx = -1; gx <= 1; gx += 1) {
    for (let gz = -1; gz <= 1; gz += 1) {
      const bucket = carriagewayGrid.get((cx + gx) * 1048576 + (cz + gz));
      if (!bucket) continue;
      for (const [rx0, rz0, rx1, rz1, half] of bucket) {
        const key = `${rx0}:${rz0}:${rx1}:${rz1}:${half}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const rdx = rx1 - rx0;
        const rdz = rz1 - rz0;
        const roadLength = Math.hypot(rdx, rdz);
        if (!(roadLength > 0.2) || !(half >= 1.2)) continue;
        const rux = rdx / roadLength;
        const ruz = rdz / roadLength;
        const parallel = Math.abs(ux * rux + uz * ruz);
        if (parallel > 0.72) continue;
        const denominator = ux * ruz - uz * rux;
        if (Math.abs(denominator) < 0.08) continue;
        const qx = rx0 - mx;
        const qz = rz0 - mz;
        const alongCrossing = (qx * ruz - qz * rux) / denominator;
        const alongRoad = (qx * uz - qz * ux) / denominator;
        const roadMargin = Math.max(half, 2.0);
        if (alongRoad < -roadMargin || alongRoad > roadLength + roadMargin) continue;
        if (Math.abs(alongCrossing) > length / 2 + Math.max(half, 8.0)) continue;
        const score = Math.abs(alongCrossing) + parallel * 24 - Math.min(half, 12) * 0.03;
        if (!best || score < best.score) {
          best = {
            x: mx + ux * alongCrossing,
            z: mz + uz * alongCrossing,
            nx: -ruz,
            nz: rux,
            half,
            score,
          };
        }
      }
    }
  }
  if (!best || best.half * 2 < 2.4 || best.half * 2 > 42) return null;
  // The way has to cross the road it is matched to, not touch it. A footway tagged as a
  // crossing that starts at the kerb corner and runs off across the corner at forty-five
  // degrees -- the kerb-ramp link OpenStreetMap draws at many a junction -- has a metre of
  // it on the asphalt, and drawn as a span of that road it was a second ladder crossing at a
  // skew over the first (Stockton at Sutter).
  if (bestRoadMetres < Math.min(CROSSING_MIN_ON_ROAD_M, best.half * 0.6)) return null;
  if (best.nx * ux + best.nz * uz < 0) {
    best.nx *= -1;
    best.nz *= -1;
  }
  const curbSpan = officialCurbCrossingSpan(best.x, best.z, ux, uz, best.half, wayLength(points));
  if (curbSpan) return endCrossingOnDrawnKerb(acrossTheWholeRoad(curbSpan, points));
  // At an acute junction the road's rounded index caps also cover the short
  // ramp-to-ramp connector around the corner. Its 3.8 m mapped link was being
  // expanded into an 8.4 m ladder through concrete at Broadway/Telegraph.
  // Without actual curb evidence, do not invent more than 40% of the span.
  if (wayLength(points) < best.half * 2 * 0.60) return null;
  const fallback = [
    lonLatFromXZ(best.x - best.nx * best.half, best.z - best.nz * best.half),
    lonLatFromXZ(best.x + best.nx * best.half, best.z + best.nz * best.half),
  ];
  fallback.provenance = "road_width_fallback";
  const across = acrossTheWholeRoad(fallback, points);
  return across === fallback ? fallback : endCrossingOnDrawnKerb(across);
}

