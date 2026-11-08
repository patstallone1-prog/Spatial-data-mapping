// ---- detail by zoom: the city falls away a layer at a time ----------------------------------
//
// Pulling back from the street, the smallest things go first and the city's own shape last:
//   4  everything, to the paving joints;
//   3  the paving's joints and the poles, wires, lamps, signals and street furniture go;
//   2  then the houses' windows and doors (the facade's painted openings with them) and signs;
//   1  then the kerbs and the bike lanes' edges -- the lane lines, crossings and the houses'
//      own colours and shapes stay;
//   0  only when the view is right out over the Bay: the paint, the trees and the houses' own
//      colours and footprints give way to the simple city the tile tree draws everywhere else.
// ZOOM_TIERS_M are camera distances (to the point the camera looks at), each the far side of a
// tier, scaled by the quality preset; each is entered a little closer than it is left, so
// standing at a boundary does not flicker. First person is always tier 4.
const ZOOM_TIERS_M = { street: 380, windows: 650, kerbs: 1300, city: 2600 };
const ZOOM_TOP = 4;
//: What goes at each tier, added to what went at the tier above.
const ZOOM_DROPS = {
  3: (surface) => surface.startsWith("furniture:") && !["furniture:power_tower", "furniture:comm_tower",
    "furniture:floodlight", "furniture:billboard", "furniture:station_entrance"].includes(surface)
    || surface === "tactile_warning" || surface === "curb_ramp" || surface === "detail" || surface === "sign",
  2: (surface) => surface === "house_window" || surface === "window" || surface === "roof_furniture"
    || surface === "furniture:billboard" || surface === "furniture:station_entrance",
  1: (surface) => surface === "kerb" || surface === "tree_pit" || surface === "walk_underlay"
    || surface === "court_line" || surface === "front_walk",
  0: (surface) => surface === "marking" || surface === "crossing_edges" || surface === "crossing"
    || surface === "bike" || surface.startsWith("tree:") || surface === "footprint"
    || surface === "furniture:power_tower" || surface === "furniture:comm_tower"
    || surface === "furniture:floodlight",
};
const ZOOM_HIDDEN = Object.fromEntries([0, 1, 2, 3, 4].map((tier) => [tier,
  (surface) => [3, 2, 1, 0].some((t) => t >= tier && ZOOM_DROPS[t](surface))]));
let zoomTier = ZOOM_TOP;
const PLAIN_MAP = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
PLAIN_MAP.needsUpdate = true;
let plainMaterials = null;
function setBuildingsPlain(plain) {
  if (!plainMaterials) {
    plainMaterials = new Set();
    root.traverse((o) => {
      if (!o.isMesh || !["wall", "roof"].includes(o.userData.surface)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.map) plainMaterials.add(m);
    });
  }
  // The texture is swapped, not removed: a material without a map is a different shader, and
  // two hundred of them recompiling at once is the stall this is meant to avoid.
  for (const m of plainMaterials) {
    if (plain && m.map !== PLAIN_MAP) { m.userData.fullMap = m.map; m.map = PLAIN_MAP; }
    else if (!plain && m.map === PLAIN_MAP && m.userData.fullMap) m.map = m.userData.fullMap;
  }
}
//: The paving's scored squares, there or not: the texture itself is given its own average
//: tone, so every pavement, kerb and plaza using it loses its joints at once and nothing
//: recompiles; the squares come back the same way.
const PAVING_TEXTURES = [SIDEWALK, NARROW_SIDEWALK];
function setPavingJoints(shown) {
  for (const texture of PAVING_TEXTURES) {
    if (!texture.userData.plain) {
      const plain = document.createElement("canvas");
      plain.width = plain.height = 4;
      plain.getContext("2d").drawImage(texture.image, 0, 0, 4, 4);
      texture.userData.full = texture.image;
      texture.userData.plain = plain;
    }
    const want = shown ? texture.userData.full : texture.userData.plain;
    if (texture.image !== want) { texture.image = want; texture.needsUpdate = true; }
  }
}
//: The houses as drawn here, or as the tile tree's simple city (tier 0): a clip box the
//: buildings' materials share, emptied to hide them, and the tile tree's buildings let in.
let cityAsTiles = false;
//: Called by the page that draws the tile tree: on an attached region's page by its host
//: (kerbsideGuestApi.cityAsTiles), which alone knows whether its tree has the region.
let detailBuildingsShown = true;
function showDetailBuildings(shown) { detailBuildingsShown = shown; setBoxSet(detailBuildingBox, shown ? detailClipBox.value : []); }
function setCityAsTiles(simple) {
  if (ATTACH) return;
  const region = activeGuest?.region || REGION_INDEX.host;
  // Only where the tile tree has this region: elsewhere the houses would just vanish.
  const swap = Boolean(simple && region && TILE_INDEX?.regions?.[region.name]);
  cityAsTiles = swap;
  setBoxSet(tileBuildingBox, swap ? [] : tileDetailBox.value);
  if (activeGuest?.ready) activeGuest.api.cityAsTiles?.(swap);
  else showDetailBuildings(!swap);
}
function updateZoomTier() {
  const scale = QUALITY().lodScale;
  const d = state.firstPerson ? 0 : state.dist;
  const edges = [ZOOM_TIERS_M.city, ZOOM_TIERS_M.kerbs, ZOOM_TIERS_M.windows, ZOOM_TIERS_M.street].map((m) => m * scale);
  // The tier for d, with a margin: go down a tier past 1.1 of its edge, come back under 0.9.
  let tier = zoomTier;
  while (tier < ZOOM_TOP && d < edges[tier] * 0.9) tier += 1;
  while (tier > 0 && d > edges[tier - 1] * 1.1) tier -= 1;
  if (tier === zoomTier) return false;
  zoomTier = tier;
  setPavingJoints(tier >= 4);
  setBuildingsPlain(tier <= 2);
  setCityAsTiles(tier === 0);
  return true;
}
//: The view the detail was last culled for: the culling only runs again once the camera has
//: moved or turned, or the zoom tier or quality has changed -- a still view costs nothing.
const lastCullEye = new THREE.Matrix4();
let cullForced = true;
function viewChanged(eye) {
  const a = eye.matrixWorld.elements, b = lastCullEye.elements;
  let moved = false;
  for (let i = 0; i < 16; i += 1) if (Math.abs(a[i] - b[i]) > (i >= 12 ? 0.5 : 0.002)) { moved = true; break; }
  if (moved) lastCullEye.copy(eye.matrixWorld);
  return moved;
}
function cullDetailByDistance(frame, eye = camera) {
  // The ground and the furniture arrive after the first frame: the list is rebuilt now and then.
  const tierChanged = eye === camera && updateZoomTier();
  // A new tier is applied to everything there is now, poles and wires that came in since the
  // last index too.
  const reindex = frame % DETAIL_REINDEX_FRAMES === 0 || tierChanged;
  if (eye === camera && !reindex && !tierChanged && !cullForced && !viewChanged(eye)) return false;
  cullForced = false;
  if (reindex) {
    detailTiles = [];
    root.traverse((o) => {
      // A transparent two-sided material is drawn by three.js in two passes, back faces then
      // front, and it flags the material for a new shader before each: with fifty such
      // materials (signs, footprints) that was the shader cache key rebuilt on every draw, every
      // frame -- a gigabyte of strings a minute and the collector running flat out. These are
      // flat plates; one pass draws them the same.
      if ((o.isMesh || o.isSprite) && o.material) {
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass) m.forceSinglePass = true;
      }
      // A building's materials share the clip that hands the houses to the tile tree (tier 0).
      if (o.isMesh && BUILDING_SURFACES.has(o.userData.surface) && !o.userData.buildingClip) {
        o.userData.buildingClip = true; applyBoxClip(o, detailBuildingBox);
      }
      // Wires are lines, not meshes; they are culled the same.
      if (!(o.isMesh || o.isLine) || !o.frustumCulled || !o.geometry || DETAIL_RANGE_M[o.userData.surface] === undefined) return;
      if (!o.isInstancedMesh && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      // An instanced mesh's bounds are its own, over its instances; its geometry's are the one
      // unit box at the origin, and read as the tile's they culled every sign post, planter
      // and tree more than a few hundred metres from the corridor's centre wherever the camera
      // stood -- which is what "the signs have no poles" was.
      if (o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere();
      if (o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere) detailTiles.push(o);
    });
  }
  // From above, what each tier keeps is seen from further off than at street level: its reach
  // grows with the view's distance, so pulling back drops a layer at a time and never the
  // paint the tier still shows.
  const overhead = eye === camera && !state.firstPerson ? Math.max(1, state.dist / 350) : 1;
  const zoom = FIRST_PERSON_FOV / eye.fov * QUALITY().detailScale * overhead;
  const hidden = ZOOM_HIDDEN[eye === camera ? zoomTier : ZOOM_TOP];
  if (reindex || !detailCells) indexDetailCells();
  // Cell by cell: a cell wholly out of sight or out of reach has its detail hidden once, and is
  // then passed over until it comes back -- the work follows what can be seen, not the city.
  cullFrustum.setFromProjectionMatrix(cullMatrix.multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
  for (const cell of detailCells) {
    const reach = cell.maxRange * zoom;
    const active = eye.position.distanceTo(cell.sphere.center) - cell.sphere.radius < reach
      && (eye !== camera || cullFrustum.intersectsSphere(cell.sphere));
    if (!active) {
      if (cell.active || reindex || tierChanged) for (const tile of cell.tiles) tile.visible = false;
      cell.active = false;
      continue;
    }
    cell.active = true;
    for (const tile of cell.tiles) {
      if (hidden(tile.userData.surface)) { tile.visible = false; continue; }
      // The lift cuts a very large mesh into pieces after the cells were indexed and lets the
      // whole go; until the cells are indexed again it is listed here without geometry.
      if (!tile.geometry) { tile.visible = false; continue; }
      // An instanced batch added after the cells were indexed may not have its sphere yet.
      if (tile.isInstancedMesh && !tile.boundingSphere) tile.computeBoundingSphere();
      if (!tile.isInstancedMesh && !tile.geometry.boundingSphere) tile.geometry.computeBoundingSphere();
      const sphere = tile.isInstancedMesh ? tile.boundingSphere : tile.geometry.boundingSphere;
      detailCentre.copy(sphere.center).applyMatrix4(tile.matrixWorld).applyMatrix4(ROOT_INVERSE);
      const gap = eye.position.distanceTo(detailCentre) - sphere.radius;
      tile.visible = gap < DETAIL_RANGE_M[tile.userData.surface] * zoom;
    }
  }
  return true;
}
//: The detail tiles by DETAIL_CELL_M cell, each cell with the sphere round all its tiles and the
//: longest range any of them is drawn to.
const DETAIL_CELL_M = 400;
let detailCells = null;
//: From the scene's frame to this world's own: the identity on a page drawing its own region; an
//: attached region's world stands in the page's scene at an offset (see attachRegion).
const ROOT_INVERSE = new THREE.Matrix4();
const cullFrustum = new THREE.Frustum(), cullMatrix = new THREE.Matrix4();
function indexDetailCells() {
  const cells = new Map();
  for (const tile of detailTiles) {
    const sphere = tile.isInstancedMesh ? tile.boundingSphere : tile.geometry.boundingSphere;
    const centre = sphere.center.clone().applyMatrix4(tile.matrixWorld).applyMatrix4(ROOT_INVERSE);
    const key = `${Math.floor(centre.x / DETAIL_CELL_M)}:${Math.floor(centre.z / DETAIL_CELL_M)}`;
    if (!cells.has(key)) cells.set(key, { tiles: [], spheres: [], maxRange: 0, active: true });
    const cell = cells.get(key);
    cell.tiles.push(tile);
    cell.spheres.push(new THREE.Sphere(centre, sphere.radius));
    cell.maxRange = Math.max(cell.maxRange, DETAIL_RANGE_M[tile.userData.surface] || 0);
  }
  detailCells = [...cells.values()].map((cell) => {
    const box = new THREE.Box3();
    for (const sphere of cell.spheres) box.union(sphere.getBoundingBox(new THREE.Box3()));
    cell.sphere = box.getBoundingSphere(new THREE.Sphere());
    delete cell.spheres;
    return cell;
  });
}
let frameCount = 0;

//: Labels keep their size on screen, so nothing makes a far one go away by itself: each is
//: hidden past the range its kind is useful over. Rebuilt on the same cadence as the detail
//: index, because street names are added as the streets are.
let labelSprites = [];
const labelCentre = new THREE.Vector3();

function cullLabelsByDistance(frame, eye = camera) {
  if (frame % DETAIL_REINDEX_FRAMES === 0) {
    labelSprites = [];
    root.traverse((o) => { if (o.isSprite && o.userData.labelRange) labelSprites.push(o); });
  }
  // A sprite h of the viewport high, at distance d, is 2 d tan(fov/2) h metres tall.
  const perMetre = 2 * Math.tan((eye.fov * Math.PI) / 360);
  for (const sprite of labelSprites) {
    labelCentre.setFromMatrixPosition(sprite.matrixWorld).applyMatrix4(ROOT_INVERSE);
    const away = eye.position.distanceTo(labelCentre);
    sprite.visible = away < sprite.userData.labelRange;
    if (!sprite.visible) continue;
    const height = Math.max(0.05, away * perMetre * sprite.userData.labelScreenH);
    sprite.scale.set(height * sprite.userData.labelAspect, height, 1);
  }
}

//: When nothing has moved and nobody has touched anything for IDLE_AFTER_MS, the view is drawn
//: only every IDLE_FRAME_MS -- enough to show what streams in -- instead of at the full rate.
const IDLE_AFTER_MS = 1500;
const IDLE_FRAME_MS = 250;
let lastInputAt = performance.now();
for (const type of ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"])
  addEventListener(type, () => { lastInputAt = performance.now(); }, { passive: true });
let lastFrameDrawnAt = 0, lastMovedAt = performance.now();
const homeScreenUp = () => document.body.classList.contains("home-open");
const lastDrawnEye = new THREE.Matrix4();
//: How long a frame may be withheld before a timer stands in for it.
const FRAME_STAND_IN_MS = 500;
let frameRequest = 0;
function requestFrame() {
  // A browser on battery, or one with no display, can stop handing out animation frames
  // altogether while the page is in plain view. The doors, the house windows and the shells are
  // laid out in this loop, so with no frame they never were: houses stood blank. A timer stands
  // in for a frame that has not come -- but not for a hidden tab, which is meant to rest, nor
  // where nothing is drawn at all (the Unreal exporter builds the city in Node: __kerbsideNoFrames).
  const id = ++frameRequest;
  requestAnimationFrame((t) => { if (id === frameRequest) animate(t); });
  if (!globalThis.__kerbsideNoFrames) setTimeout(() => {
    if (id === frameRequest && !document.hidden) animate(performance.now());
  }, FRAME_STAND_IN_MS);
}
function animate(now) {
  // In the headset the session hands out the frames (renderer.setAnimationLoop), and every one
  // is drawn: a frame withheld there is a frame of nothing in front of your eyes.
  const xrFrame = META && renderer.xr.isPresenting;
  if (!xrFrame) requestFrame();
  now = now || performance.now();
  environmentController?.update(now,{indoors:Boolean(state.indoors)});
  if(frameCount%60===0 && environmentController){const clock=document.getElementById("world-clock");
    if(clock)clock.textContent=`San Francisco time: ${environmentController.snapshot()?.localTime || ""}`;}
  if(frameCount%60===0 && !ATTACH){const output=document.getElementById("stream-status");
    if(output)output.textContent=window.kerbsideStreamDetail?.() || "Preparing world streaming…";}
  // The frame-rate cap, and the idle rate when nothing moves.
  const eye = camera.matrixWorld.elements, drawn = lastDrawnEye.elements;
  for (let i = 0; i < 16; i += 1) if (Math.abs(eye[i] - drawn[i]) > 1e-4) { lastMovedAt = now; break; }
  // Behind the home screen the world is out of sight: drawn at the idle rate however the
  // creator's sliders and the spinning figure move the pointer, which had drawn it at full rate
  // and left the creator seconds behind the hand (2026-11-02). Streaming still goes on.
  // Not while a window is being sent to the GPU ahead of its handoff (runPreupload): a batch a
  // frame, at the idle rate, a square took seconds longer to come in.
  const idle = homeScreenUp() || (now - Math.max(lastMovedAt, lastInputAt) > IDLE_AFTER_MS && !state.indoors
    && !preuploadJobs?.length);
  const interval = Math.max(SETTINGS.fps > 0 ? 1000 / SETTINGS.fps : 0, idle ? IDLE_FRAME_MS : 0);
  if (!xrFrame && interval && now - lastFrameDrawnAt < interval - 2) return;
  lastFrameDrawnAt = now;
  lastDrawnEye.copy(camera.matrixWorld);
  // The first frame drawn is the end of loading.
  const progress = document.getElementById("progress");
  if (progress && !progress.hidden) progress.hidden = true;
  worldIsReady?.();
  markLoadSurvived(); // only after BOTH the streets and asynchronous ground have finished
  if(natureWorld?.tick(now,camera,state.firstPerson?avatar.position:state.target))lastMovedAt=now;
  globe?.update(camera);
  foliageMotion?.update(now,avatar.position);natureMotion?.update(now,avatar.position);
  if(grassStrands&&grassSurfaceAt){const focus=state.firstPerson?avatar.position:state.target;
    grassStrands.update(focus.x,focus.z,camera.position.y-focus.y);}
  stepAvatar(now);
  if (multiplayer?.session?.tick(now)) lastMovedAt = now;
  if (typeof livingCity !== "undefined" && livingCity?.tick(now) && (livingCity.driving || state.dist < 600)) lastMovedAt = now;
  if (typeof livingCity !== "undefined" && livingCity && (livingCity.driving || livingCity.riding)) avatar.visible = false;
  updateCompass(now);
  if (sunDial.open && frameCount % 30 === 0) drawSunDial();
  if (frameCount % 30 === 0) updateRouteWidth();
  checkLightWindow(frameCount);
  noteFirstBuild();
  checkDetailExpansion(now);
  // Labels are re-sized and culled with the detail: only when the view has changed.
  if (cullDetailByDistance(frameCount) || frameCount % DETAIL_REINDEX_FRAMES === 0) cullLabelsByDistance(frameCount);
  frameCount += 1;
  if (frameCount % 20 === 0) {
    const focus = state.firstPerson ? avatar.position : state.target;
    updateFacadeStreaming(focus, camera.position.y - focus.y);
  }
  if (activeGuest && activeGuest.ready) guestFrame(now);
  updateTileTree(now);
  if(natureWorld && (frameCount===1 || frameCount%20===0)) {
    natureWorld.hostBox.value.copy(hostWorldActive ? natureWorld.localBounds : new THREE.Vector4(1,1,0,0));
    const focus=state.firstPerson ? avatar.position : state.target;
    // Not in the headset: the near detail of the hills round the Bay (nine squares two
    // kilometres across, generated as you go) stands past its haze.
    if(!HEADSET)natureWorld.update(focus.x,focus.z);
  }
  keepMarkersFindable();
  metaXR?.update(now);
  // In the headset the world's positions are brought up to date every sixth frame, not every
  // frame (scene.matrixWorldAutoUpdate is off there): almost none of it moves, and walking its
  // thousands of objects was a fifth of every frame. What does move each frame -- the panels,
  // the pointers -- the headset module places itself.
  if (META && frameCount % 6 === 0) scene.updateMatrixWorld();
  // What was built since -- a house's shell and rooms as you come to it -- made plain as well.
  // (A material given a new picture after it went in -- a photographed facade arriving -- is
  // still found by this pass.)
  if (META && frameCount % 30 === 0) { headsetSettlePictures(); headsetSimplify(scene); }
  if (!worldPaused) {
    if (!xrFrame) runPreupload();
    renderer.render(scene, camera);
    if (!ATTACH) markBootRendered();
  }
  // For every window's build (yieldFrame, sliceBudget): a frame has been drawn, and when the
  // view last moved.
  if (!ATTACH) { globalThis.__kerbsideFrames = frameCount; globalThis.__kerbsideMovedAt = Math.max(lastMovedAt, lastInputAt); }
  if (!ATTACH) keepShaderPrograms();
  // Only an uncapped rate is a measure of how long a frame takes to draw.
  if (SETTINGS.fps === 0) adaptResolution(now);
}

//: A window's geometry and pictures uploaded ahead of its handoff (attachRegion), a batch a
//: frame: the batch is drawn into one pixel at the corner of the frame about to be drawn over --
//: with the scene's own lights, so its shaders are the ones already compiled -- and drawing it is
//: what sends it to the GPU. The frame's own render then clears that pixel and draws the world.
//: (var: the first frame can be drawn before this part of the module has run.)
var PREUPLOAD_BYTES_PER_FRAME = 12 << 20, PREUPLOAD_LAYER = 30, PREUPLOAD_STALL_MS = 3000;
var preuploadJobs = [];
var preuploadViewport = new THREE.Vector4(), preuploadScissor = new THREE.Vector4();
function preuploadWindow(root) {
  if (!root) return Promise.resolve();
  return new Promise((resolve) => preuploadJobs.push({ root, meshes: null, i: 0, resolve, at: performance.now() }));
}
function attributeBytes(geometry) {
  let bytes = 0;
  for (const a of Object.values(geometry.attributes || {})) {
    const h = a.isInterleavedBufferAttribute ? a.data : a;
    bytes += h.recoverableType ? h.recoverableLength * h.recoverableType.BYTES_PER_ELEMENT : (h.array?.byteLength || 0);
  }
  const i = geometry.index;
  if (i) bytes += i.recoverableType ? i.recoverableLength * i.recoverableType.BYTES_PER_ELEMENT : (i.array?.byteLength || 0);
  return bytes;
}
function runPreupload() {
  if (!preuploadJobs?.length) return;
  // A page that draws no frames for a while (hidden) lets the window go up when it is shown.
  while (preuploadJobs.length && performance.now() - preuploadJobs[0].at > PREUPLOAD_STALL_MS && preuploadJobs[0].i) {
    preuploadJobs.shift().resolve();
  }
  const job = preuploadJobs[0];
  if (!job) return;
  if (!job.meshes) {
    job.meshes = [];
    job.root.traverse((o) => { if ((o.isMesh || o.isLine || o.isPoints) && o.geometry && o.visible) job.meshes.push(o); });
  }
  const batch = [];
  for (let bytes = 0; job.i < job.meshes.length && bytes < PREUPLOAD_BYTES_PER_FRAME;) {
    const o = job.meshes[job.i++];
    if (!o.parent || !o.geometry) continue;
    batch.push(o); bytes += attributeBytes(o.geometry);
  }
  if (batch.length) {
    const lights = [];
    scene.traverse((o) => { if (o.isLight) lights.push(o); });
    const culled = batch.map((o) => o.frustumCulled), mask = camera.layers.mask, shown = job.root.visible;
    const autoShadow = renderer.shadowMap.autoUpdate, scissorTest = renderer.getScissorTest();
    renderer.getViewport(preuploadViewport); renderer.getScissor(preuploadScissor);
    try {
      for (const o of batch) { o.layers.enable(PREUPLOAD_LAYER); o.frustumCulled = false; }
      for (const l of lights) l.layers.enable(PREUPLOAD_LAYER);
      camera.layers.set(PREUPLOAD_LAYER);
      job.root.visible = true;
      renderer.shadowMap.autoUpdate = false;
      renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true);
      renderer.render(scene, camera);
    } catch (error) { console.warn("kerbside: could not send a window ahead to the GPU", error); }
    finally {
      renderer.setViewport(preuploadViewport); renderer.setScissor(preuploadScissor); renderer.setScissorTest(scissorTest);
      renderer.shadowMap.autoUpdate = autoShadow;
      job.root.visible = shown;
      camera.layers.mask = mask;
      batch.forEach((o, k) => { o.layers.disable(PREUPLOAD_LAYER); o.frustumCulled = culled[k]; });
      for (const l of lights) l.layers.disable(PREUPLOAD_LAYER);
    }
    job.at = performance.now();
  }
  if (job.i >= job.meshes.length) { preuploadJobs.shift(); job.resolve(); }
}

// A nonessential callback can fail while the world is still building, then the
// renderer completes normally. Retire that stale startup error only after an
// actual frame succeeds with both streets and ground ready. Context loss keeps
// its own failure state until the browser restores it.
function markBootRendered() {
  const boot = window.kerbsideBoot, ready = window.kerbsideReady;
  if (!boot || !ready?.streets || !ready.ground || boot.contextLost) return;
  boot.rendered = true;
  if (boot.errorKind === "startup") { boot.error = null; boot.errorKind = null; }
}

// ---- the road surfaces as drawn --------------------------------------------------------------
//
// What is laid on a road -- a route's line -- has to lie on the road as it is drawn, and the
// road is not always the ground: a bridge's or the Central Freeway's deck stands over it, the
// Bay Bridge over the water, and a tunnel's floor is under the hill. Every elevated road is
// registered as it is built (its way and the lift it is drawn at, or a deck's stations) in a
// grid, and roadSurfacesAt gives every road surface at a point: the ground, the decks over it,
// the floor of a bore under it.
//: (var, no initialiser: the bridges register before this part of the module has run.)
var ELEVATED_ROADS;
//: The grid's cell (a function: asked before this part of the module has run).
function elevatedCellM() { return 40; }
//: info: what the deck is -- { kind: "bridge" | "highway", name, reach (the half-width a person
//: can stand on: the road and its walkways), walkway (the half-width where the walkway starts),
//: walkTop (how far the walkway stands over the road), paved (a street drawn on its lift, whose
//: pavements are the city's own: pavementSurfaceAt) }.
function registerElevatedSegment(ax, az, ay, bx, bz, by, half, info = null) {
  if (!ELEVATED_ROADS) ELEVATED_ROADS = new Map();
  if (![ax, az, ay, bx, bz, by, half].every(Number.isFinite)) return;
  const segment = { ax, az, ay, bx, bz, by, half, info };
  const reach = Math.max(half, info?.reach || 0) + 1;
  for (let gx = Math.floor((Math.min(ax, bx) - reach) / elevatedCellM()); gx <= Math.floor((Math.max(ax, bx) + reach) / elevatedCellM()); gx += 1) {
    for (let gz = Math.floor((Math.min(az, bz) - reach) / elevatedCellM()); gz <= Math.floor((Math.max(az, bz) + reach) / elevatedCellM()); gz += 1) {
      const key = `${gx}:${gz}`;
      if (!ELEVATED_ROADS.has(key)) ELEVATED_ROADS.set(key, []);
      ELEVATED_ROADS.get(key).push(segment);
    }
  }
}
function registerElevatedWay(way, lift) {
  if (!way.points || way.points.length < 2 || typeof lift !== "function") return;
  const half = (way.road_m || 7) / 2;
  // The deck carries the street's pavements too (they are drawn on the same lift).
  const walk = (way.walk_sides || []).length || way.walk_m ? Number(way.walk_m) || 2.4 : 0;
  const info = { kind: structureKindOf(way), name: way.name || null, reach: half + walk, paved: true };
  const pts = densifyWay(way.points,3).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    registerElevatedSegment(ax, az, lift(ax, az) + ROAD_TOP_M, bx, bz, lift(bx, bz) + ROAD_TOP_M, half, info);
  }
}
//: A deck is a highway's when it carries a freeway or one of its ramps -- by name, or stacked
//: over another deck (OpenStreetMap layer 2 and up: an interchange) -- and a bridge's otherwise.
//: (The payload keeps no road class: a name and a layer are what there is to go on.)
//: A freeway's name. (A function: the street build asks before this part of the module has run.)
function isHighwayName(name) { return /\b(Freeway|Highway|Expressway|Skyway|Interstate|Parkway)\b|^(I|US|CA|SR)[- ]\d/i.test(name || ""); }
function structureKindOf(way) {
  if (isHighwayName(way.name) || Number(way.layer) >= 2) return "highway";
  return highwayRampWays().has(way) ? "highway" : "bridge";
}
//: The unnamed decks that are a freeway's ramps: chained, end to end, to a freeway's deck (an
//: interchange's connectors carry no name of their own). Worked out once, from the ways.
function highwayRampWays() {
  if (highwayRampWays.found) return highwayRampWays.found;
  const decks = (DATA.ways || []).filter((w) => w.kind === "street" && w.bridge && !w.tunnel && w.points && w.points.length >= 2);
  const key = (p) => `${p[0].toFixed(6)}:${p[1].toFixed(6)}`;
  const byNode = new Map();
  for (const w of decks) for (const p of [w.points[0], w.points[w.points.length - 1]]) {
    const k = key(p); if (!byNode.has(k)) byNode.set(k, []); byNode.get(k).push(w);
  }
  const found = new Set(), queue = decks.filter((w) => isHighwayName(w.name) || Number(w.layer) >= 2);
  const seen = new Set(queue);
  while (queue.length) {
    const w = queue.shift();
    for (const p of [w.points[0], w.points[w.points.length - 1]]) for (const n of byNode.get(key(p)) || []) {
      if (seen.has(n) || n.name) continue;
      seen.add(n); found.add(n); queue.push(n);
    }
  }
  return (highwayRampWays.found = found);
}
//: The decks a person could stand on at (x, z), each with what it is: its height (top), the lift
//: under its road (base: a street's pavement stands on that), what kind of structure it is and
//: its name. The road's own surfaces (elevatedRoadsAt) are unchanged; this is the walker's.
function elevatedDecksAt(x, z) {
  const bucket = ELEVATED_ROADS && ELEVATED_ROADS.get(`${Math.floor(x / elevatedCellM())}:${Math.floor(z / elevatedCellM())}`);
  if (!bucket) return [];
  const out = [];
  for (const segment of bucket) {
    const { ax, az, ay, bx, bz, by, half, info } = segment;
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (!(len2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const off = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (off > Math.max(half, info?.reach || 0) + 0.3) continue;
    const road = ay + (by - ay) * t;
    const walkway = info?.walkway !== undefined && off > info.walkway;
    out.push({ top: road + (walkway ? info.walkTop || 0 : 0), base: road - ROAD_TOP_M, kind: info?.kind || "bridge",
      name: info?.name || null, paved: Boolean(info?.paved), walkway });
  }
  return out;
}
//: The parapets of the deck the walker is standing on, as wall segments (pushOutOfWalls): each
//: deck's two edges at the width a person can stand on, in 3 m pieces, for the decks whose road
//: is within a step of the feet. A piece is left open where another deck carries on beside it
//: at the same height -- a ramp leaving the road, a deck joining the next -- and every deck
//: overhead or underfoot is no wall at all, so the street under a viaduct walks freely.
function deckEdgeSegmentsNear(x, z, feet) {
  if (!Number.isFinite(feet) || !ELEVATED_ROADS) return [];
  const out = [];
  const near = new Set();
  for (let ix = -1; ix <= 1; ix += 1) for (let iz = -1; iz <= 1; iz += 1)
    for (const s of ELEVATED_ROADS.get(`${Math.floor(x / elevatedCellM()) + ix}:${Math.floor(z / elevatedCellM()) + iz}`) || []) near.add(s);
  for (const s of near) {
    const { ax, az, ay, bx, bz, by, half, info } = s;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05 || Math.min(Math.hypot(ax - x, az - z), Math.hypot(bx - x, bz - z)) > len + 12) continue;
    // Only the deck underfoot: its road within a step of the feet somewhere along this piece.
    if (feet < Math.min(ay, by) - 1.0 || feet > Math.max(ay, by) + 1.0) continue;
    const reach = Math.max(half, info?.reach || 0);
    const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nz = ux;
    const pieces = Math.max(1, Math.round(len / 3));
    for (const side of [-1, 1]) for (let k = 0; k < pieces; k += 1) {
      const t0 = k / pieces, t1 = (k + 1) / pieces, tm = (t0 + t1) / 2;
      const top = ay + (by - ay) * tm;
      if (Math.abs(top - feet) > 1.0) continue;
      const px = ax + (bx - ax) * tm + nx * side * (reach + 0.8), pz = az + (bz - az) * tm + nz * side * (reach + 0.8);
      if (elevatedDecksAt(px, pz).some((d) => Math.abs(d.top - top) < 1.2)) continue;
      // Not over the ground: a deck's end on the street is no edge.
      if (top - groundLiftAt(px, pz) < 1.0) continue;
      out.push([ax + (bx - ax) * t0 + nx * side * reach, az + (bz - az) * t0 + nz * side * reach,
        ax + (bx - ax) * t1 + nx * side * reach, az + (bz - az) * t1 + nz * side * reach]);
    }
  }
  return out;
}
//: DECK_STEP_M, 0.6 m: how far above the feet a deck may be and still be stepped onto -- a ramp
//: rises a few centimetres a step, a deck overhead is metres up. (Written into walkerGroundInfo:
//: the walker can be asked for its ground before this part of the module has run.)
//: The decks over (x, z): the height of each elevated road whose width covers the point.
function elevatedRoadsAt(x, z) {
  const bucket = ELEVATED_ROADS && ELEVATED_ROADS.get(`${Math.floor(x / elevatedCellM())}:${Math.floor(z / elevatedCellM())}`);
  if (!bucket) return [];
  const out = [];
  for (const { ax, az, ay, bx, bz, by, half } of bucket) {
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (!(len2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) > half + 0.5) continue;
    out.push(ay + (by - ay) * t);
  }
  return out;
}
//: Every road surface at (x, z), with what it is: the ground, each deck over it, a bore's floor.
function roadSurfacesAt(x, z) {
  const out = [{ y: groundLiftAt(x, z) + ROAD_TOP_M, kind: "ground" }];
  for (const y of elevatedRoadsAt(x, z)) out.push({ y, kind: "deck" });
  const floor = tunnelFloorAt(x, z);
  if (floor !== null) out.push({ y: floor + ROAD_TOP_M, kind: "tunnel" });
  const stair = typeof publicStairAt === "function" ? publicStairAt(x, z) : null;
  if (stair !== null) out.push({ y: stair, kind: "stairs" });
  return out;
}
//: The surface a line along the road keeps to, point by point. Where the road network says what
//: each point is on (``flags``: "bridge", "tunnel" or null, from Valhalla's edges), that: the
//: highest deck on a bridge, the bore's floor in a tunnel, the ground (or a stair) elsewhere --
//: so a route under a viaduct stays on the street, and one up a ramp is on the ramp. Where it
//: does not (a transit leg), continuity: from the ground at its start, then the surface nearest
//: the last at each point.
function routeSurfaceHeights(points, flags = null) {
  let previous = null;
  return points.map(([x, z], i) => {
    const surfaces = roadSurfacesAt(x, z);
    let pick = surfaces[0];
    if (flags) {
      const flag = flags[i];
      const decks = surfaces.filter((s) => s.kind === "deck"), bore = surfaces.find((s) => s.kind === "tunnel");
      if (flag === "bridge" && decks.length) pick = decks.reduce((a, b) => (b.y > a.y ? b : a));
      else if (flag === "tunnel" && bore) pick = bore;
      else if (!flag) pick = surfaces.find((s) => s.kind === "stairs") || surfaces[0];
      else if (previous !== null) for (const s of surfaces) if (Math.abs(s.y - previous) < Math.abs(pick.y - previous)) pick = s;
    } else if (previous !== null) {
      for (const s of surfaces) if (Math.abs(s.y - previous) < Math.abs(pick.y - previous)) pick = s;
    }
    previous = pick.y;
    return pick;
  });
}

// ---- directions ------------------------------------------------------------------------------
//
// Routes come from Valhalla -- an established routing engine over the legal OpenStreetMap street
// network -- never from a path over the triangles this page draws: a painted lane, an inferred
// stoop or a house interior is not evidence that anyone may go there. The FOSSGIS public server
// answers by default; a self-hosted one (tools/valhalla) is a matter of the page's
// kerbside-routing meta. Public transit comes from Transitous (MOTIS over the agencies' published
// GTFS). Walk, bike, drive and transit; ordered stops kept in the order given.
//
// There are no preference switches. Each mode asks for its candidates -- the router's own
// alternatives and a few variants of its costing (fewer hills, no steps, quiet streets, fewer
// turns) -- measures every one (time, climb, turns, steps, bike lanes; walking and transfers on
// transit), and tags the ones that are significantly better than the fastest at something
// (ROUTE_TAGS: each tag's threshold, absolute and relative, so one more block of bike lane on a
// long ride is not "bike lane friendly"). A tag also weighs a route up the list by how much it
// gains, per mode: three hundred feet less climbing counts six per cent on a bike. The route is
// drawn as a ribbon on the ground, depth-tested against the buildings, inside this region.
const ROUTING_URL = (document.querySelector('meta[name="kerbside-routing"]')?.content
  || "https://valhalla1.openstreetmap.de").replace(/\/+$/, "");
const TRANSIT_URL = (document.querySelector('meta[name="kerbside-transit-routing"]')?.content
  || "https://api.transitous.org").replace(/\/+$/, "");
const ROUTE_COSTING = { walk: "pedestrian", bike: "bicycle", drive: "auto" };
//: The costing variants asked for besides the plain one, per mode: each may find a route the
//: plain costing would not offer, and every route found is measured the same way.
const ROUTE_VARIANTS = {
  walk: [{}, { use_hills: 0.0 }, { step_penalty: 100000 }],
  bike: [{}, { use_hills: 0.0 }, { use_roads: 0.0 }, { maneuver_penalty: 60 }],
  drive: [{}, { maneuver_penalty: 60 }],
};
const ROUTE_BASE_OPTIONS = { pedestrian: { use_hills: 0.5 }, bicycle: { use_hills: 0.5, bicycle_type: "Hybrid" }, auto: {} };
//: The tags each mode can earn. A route earns one when it beats the fastest route on the metric
//: by at least ``min`` (and by ``rel`` of the fastest's value, where given) and no other route
//: beats it there. Its weight lifts it in the list: ``per`` of its time for each unit gained, up
//: to ``cap`` -- 0.00066 a metre is six per cent for ninety-one metres (three hundred feet).
const ROUTE_TAGS = {
  walk: [
    { id: "fewest_hills", label: "Fewest hills", metric: "ascent", lower: true, min: 15, rel: 0.25, per: 0.0012, cap: 0.12 },
    { id: "no_stairs", label: "Avoids stairs", metric: "stairs", zero: true, min: 1, per: 0.04, cap: 0.04 },
  ],
  bike: [
    { id: "fewest_hills", label: "Fewest hills", metric: "ascent", lower: true, min: 20, rel: 0.25, per: 0.00066, cap: 0.15 },
    { id: "bike_lanes", label: "Bike lane friendly", metric: "bikeShare", lower: false, min: 0.15, also: { metric: "bikeKm", min: 0.3 }, per: 0.12, cap: 0.10 },
    { id: "fewest_turns", label: "Fewest turns", metric: "turns", lower: true, min: 3, rel: 0.3, per: 0.005, cap: 0.06 },
  ],
  drive: [
    { id: "fewest_turns", label: "Fewest turns", metric: "turns", lower: true, min: 3, rel: 0.25, per: 0.004, cap: 0.06 },
  ],
  transit: [
    { id: "least_walking", label: "Least walking", metric: "walkM", lower: true, min: 250, rel: 0.25, per: 0.00008, cap: 0.10 },
    { id: "fewest_transfers", label: "Fewest transfers", metric: "transfers", lower: true, min: 1, per: 0.04, cap: 0.10 },
  ],
};
const ROUTE_MAX_STOPS = 5;
const ROUTE_MAX_SHOWN = 4;
const ROUTE_RIBBON_M = { chosen: 2.6, other: 1.4 };
//: From high up the ribbon widens to stay readable: about this share of the view's distance.
const ROUTE_RIBBON_PER_M = META ? 0.007 : 0.009;
//: How much wider than its ground width the ribbon may grow: enough to stay a few pixels wide
//: from the farthest the view goes (MAX_ORBIT_DIST_M).
const ROUTE_RIBBON_MAX_SCALE = 60;
let routeDrawnAt = 0;
const ROUTE_LIFT_M = 0.3;
//: The chosen route's ribbon a little higher again, over any alternative sharing its street.
const ROUTE_TOP_LIFT_M = 0.06;
const route = { mode: "walk", stops: [null, null], results: [], chosen: 0, pending: null };
const routeGroup = new THREE.Group();
routeGroup.name = "route";
// Kept through the page's own world being let go for a window drawn in full (releaseHostWorld
// takes everything else off root): the routes and their pins went with it, and the next
// directions found no parent to put their pins on -- an error, and the map offered a reload.
routeGroup.userData.bayWide = true;
root.add(routeGroup);
//: Valhalla's shapes: Google's polyline encoding at six decimal places (Transitous's at seven).
function decodePolyline6(text, precision = 6) {
  const points = [];
  const scale = 10 ** precision;
  let index = 0, lat = 0, lon = 0;
  while (index < text.length) {
    for (const which of [0, 1]) {
      // Arithmetic, not bitwise: at seven places (Transitous) a longitude of -122 is a zigzag
      // value past 2^31, and 32-bit shifts turned San Francisco's -122.42 into +92.33 -- every
      // transit route landed off the map and nothing was drawn.
      let result = 0, factor = 1, byte;
      do { byte = text.charCodeAt(index++) - 63; result += (byte % 32) * factor; factor *= 32; } while (byte >= 0x20);
      const delta = result % 2 ? -(result + 1) / 2 : result / 2;
      if (which === 0) lat += delta; else lon += delta;
    }
    points.push([lon / scale, lat / scale]);
  }
  return points;
}
function encodePolyline6(points) {
  let out = "", plat = 0, plon = 0;
  const put = (value) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of points) {
    const a = Math.round(lat * 1e6), b = Math.round(lon * 1e6);
    put(a - plat); put(b - plon);
    plat = a; plon = b;
  }
  return out;
}
function routeRequest(stops, mode, variant = {}, alternates = true) {
  const costing = ROUTE_COSTING[mode] || "pedestrian";
  const options = { [costing]: { ...ROUTE_BASE_OPTIONS[costing], ...variant } };
  return { locations: stops.map((p) => ({ lat: p.lat, lon: p.lon, type: "break" })), costing,
    costing_options: options, alternates: alternates && stops.length === 2 ? 2 : 0, units: "kilometers",
    elevation_interval: 30, language: "en-US" };
}
//: Valhalla's maneuver types that are a turn: right, sharp right, U-turns, sharp left, left, and
//: entering a roundabout. A slight bend, keeping straight and the start and end are not.
const TURN_MANEUVERS = new Set([10, 11, 12, 13, 14, 15, 26]);
//: Time, length, climb, turns and the line of one trip (Valhalla's trip or one of its alternates).
function summarizeTrip(trip) {
  let ascent = 0, descent = 0, turns = 0;
  const line = [], steps = [], stepInfo = [];
  for (const leg of trip.legs || []) {
    const heights = leg.elevation || [];
    for (let i = 1; i < heights.length; i += 1) {
      const d = heights[i] - heights[i - 1];
      if (d > 0) ascent += d; else descent -= d;
    }
    line.push(...decodePolyline6(leg.shape || ""));
    for (const m of leg.maneuvers || []) {
      if (m.instruction) { steps.push(m.instruction); stepInfo.push({ type: m.type, km: m.length || 0 }); }
      if (TURN_MANEUVERS.has(m.type)) turns += 1;
    }
  }
  return { seconds: trip.summary?.time || 0, km: trip.summary?.length || 0,
    ascent: Math.round(ascent), descent: Math.round(descent), turns, line, steps, stepInfo };
}
//: What the route runs over, edge by edge (Valhalla's trace_attributes on its own shape): how much
//: of it is on a cycle track or a painted bike lane, and how many flights of steps it climbs.
async function measureEdges(result, mode) {
  const costing = ROUTE_COSTING[mode];
  const response = await fetch(`${ROUTING_URL}/trace_attributes`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      encoded_polyline: encodePolyline6(result.line), shape_match: "edge_walk", costing,
      filters: { attributes: ["edge.length", "edge.use", "edge.cycle_lane", "edge.bridge", "edge.tunnel",
        "edge.begin_shape_index", "edge.end_shape_index", "shape"], action: "include" } }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.edges)) return result;
  let total = 0, bike = 0, stairs = 0;
  // Which of the route's points are on a bridge or in a tunnel, as the road network has them: the
  // ribbon is laid on the deck or the bore's floor there, and on the ground everywhere else.
  const shape = body.shape ? decodePolyline6(body.shape) : result.line;
  const flags = new Array(shape.length).fill(null);
  for (const edge of body.edges) {
    const km = edge.length || 0;
    total += km;
    if (edge.use === "cycleway" || edge.cycle_lane === "dedicated" || edge.cycle_lane === "separated") bike += km;
    else if (edge.cycle_lane === "shared") bike += km * 0.5;
    if (edge.use === "steps") stairs += 1;
    const flag = edge.tunnel ? "tunnel" : edge.bridge ? "bridge" : null;
    if (flag && Number.isInteger(edge.begin_shape_index) && Number.isInteger(edge.end_shape_index)) {
      for (let i = edge.begin_shape_index; i <= edge.end_shape_index && i < flags.length; i += 1) flags[i] = flag;
    }
  }
  return { ...result, line: shape.length > 1 ? shape : result.line, surface: flags,
    bikeKm: bike, bikeShare: total ? bike / total : 0, stairs };
}
//: Two routes that are the same way: their lines, resampled at the same shares of their length,
//: no more than 25 m apart on average.
function sameRoute(a, b) {
  if (Math.abs(a.km - b.km) > Math.max(0.05, 0.03 * Math.max(a.km, b.km))) return false;
  const sample = (line, n) => {
    const pts = line.map((p) => xy(...p)), cum = [0];
    for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 1, out = [];
    for (let k = 0, j = 1; k < n; k += 1) {
      const at = total * k / (n - 1);
      while (j < pts.length - 1 && cum[j] < at) j += 1;
      const span = cum[j] - cum[j - 1] || 1, t = Math.max(0, Math.min(1, (at - cum[j - 1]) / span));
      out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t]);
    }
    return out;
  };
  if (a.line.length < 2 || b.line.length < 2) return false;
  const pa = sample(a.line, 16), pb = sample(b.line, 16);
  let sum = 0;
  for (let i = 0; i < 16; i += 1) sum += Math.hypot(pa[i][0] - pb[i][0], pa[i][1] - pb[i][1]);
  return sum / 16 < 25;
}
async function requestValhalla(stops, mode) {
  const variants = ROUTE_VARIANTS[mode] || [{}];
  const answers = await Promise.allSettled(variants.map(async (variant, i) => {
    const response = await fetch(`${ROUTING_URL}/route`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(routeRequest(stops, mode, variant, i === 0)) });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.trip) throw new Error(body?.error || `routing answered ${response.status}`);
    return [body.trip, ...(body.alternates || []).map((a) => a.trip)].filter(Boolean).map(summarizeTrip);
  }));
  const found = [];
  for (const answer of answers) {
    if (answer.status !== "fulfilled") continue;
    for (const result of answer.value) if (!found.some((other) => sameRoute(other, result))) found.push(result);
  }
  if (!found.length) {
    const failure = answers.find((a) => a.status === "rejected");
    throw failure ? failure.reason : new Error("no route");
  }
  // Bike lanes, steps, bridges and tunnels are only in the edges: every candidate is measured.
  return Promise.all(found.slice(0, 6).map((result) => measureEdges(result, mode).catch(() => result)));
}
//: A Transitous itinerary as a route: its time, walking, transfers, line and what to do.
function summarizeItinerary(it) {
  const line = [], steps = [], under = [];
  let walkM = 0, km = 0;
  const NAMES = { BUS: "Bus", TRAM: "Streetcar", SUBWAY: "Metro", RAIL: "Train", REGIONAL_RAIL: "Train",
    FERRY: "Ferry", CABLE_CAR: "Cable car", FUNICULAR: "Funicular", COACH: "Coach" };
  for (const leg of it.legs || []) {
    const points = decodePolyline6(leg.legGeometry?.points || "", leg.legGeometry?.precision || 7);
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = xy(...points[i - 1]), [bx, by] = xy(...points[i]);
      km += Math.hypot(bx - ax, by - ay) / 1000;
    }
    line.push(...points);
    // A subway leg runs under the ground: drawn faint, on the ground over it.
    for (let i = 0; i < points.length; i += 1) under.push(leg.mode === "SUBWAY");
    const to = leg.to?.name && leg.to.name !== "END" ? leg.to.name : "your destination";
    if (leg.mode === "WALK") {
      walkM += leg.distance || 0;
      if ((leg.distance || 0) > 20) steps.push(`Walk ${Math.round(leg.distance)} m to ${to}.`);
    } else {
      const kind = NAMES[leg.mode] || "Transit";
      const name = leg.routeShortName ? `${kind} ${leg.routeShortName}` : kind;
      const toward = leg.headsign ? ` toward ${leg.headsign}` : "";
      const time = leg.startTime ? ` at ${new Date(leg.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
      steps.push(`${name}${toward}${time}, from ${leg.from?.name || "the stop"} to ${to}.`);
    }
  }
  return { seconds: it.duration || 0, km, ascent: 0, descent: 0, walkM: Math.round(walkM),
    transfers: it.transfers || 0, line, steps, under,
    departs: it.startTime || null };
}
async function requestTransit(stops) {
  if (stops.length !== 2) throw new Error("transit between two stops");
  const [a, b] = stops;
  const query = new URLSearchParams({ fromPlace: `${a.lat},${a.lon}`, toPlace: `${b.lat},${b.lon}`, numItineraries: "5" });
  const response = await fetch(`${TRANSIT_URL}/api/v1/plan?${query}`);
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.itineraries)) throw new Error(body?.error || `transit answered ${response.status}`);
  const found = [];
  for (const it of body.itineraries) {
    const result = summarizeItinerary(it);
    if (result.line.length > 1 && !found.some((other) => sameRoute(other, result))) found.push(result);
  }
  if (!found.length) throw new Error("no path");
  return found;
}
//: Each route's tags, and the order they are shown in. Against the fastest: a tag is earned by
//: beating it by the tag's threshold, and only by the best route at that metric; its weight is
//: the gain times ``per``, capped, and a route is ranked by its time less its weights.
function tagRoutes(results, mode) {
  if (!results.length) return results;
  const fastest = results.reduce((a, b) => (b.seconds < a.seconds ? b : a));
  const tags = ROUTE_TAGS[mode] || [];
  const out = results.map((r) => ({ ...r, tags: [], weight: 0 }));
  for (const tag of tags) {
    const value = (r) => r[tag.metric];
    const base = value(fastest);
    if (!Number.isFinite(base)) continue;
    const scored = out.filter((r) => Number.isFinite(value(r)));
    if (!scored.length) continue;
    const best = tag.lower || tag.zero ? Math.min(...scored.map(value)) : Math.max(...scored.map(value));
    // One route per tag: of those tied at the best value, the quickest.
    const holder = scored.filter((r) => value(r) === best).reduce((a, b) => (b.seconds < a.seconds ? b : a));
    for (const r of [holder]) {
      if (r.seconds === fastest.seconds && r.km === fastest.km) continue;
      let gain;
      if (tag.zero) gain = value(r) === 0 && base >= tag.min ? 1 : 0;
      else gain = tag.lower ? base - value(r) : value(r) - base;
      if (!(gain >= tag.min)) continue;
      if (tag.rel && base > 0 && gain < tag.rel * Math.abs(base)) continue;
      if (tag.also) {
        const extra = (r[tag.also.metric] ?? 0) - (fastest[tag.also.metric] ?? 0);
        if (!(extra >= tag.also.min)) continue;
      }
      r.tags.push({ id: tag.id, label: tag.label });
      r.weight += Math.min(tag.cap, tag.zero ? tag.per : gain * tag.per);
    }
  }
  const quickest = out.find((r) => r.seconds === fastest.seconds && r.km === fastest.km);
  if (out.length > 1 && quickest) quickest.tags.unshift({ id: "fastest", label: "Fastest" });
  for (const r of out) r.score = r.seconds * (1 - r.weight);
  return out.sort((a, b) => a.score - b.score).slice(0, ROUTE_MAX_SHOWN);
}
async function requestRoutes(stops, mode) {
  const found = mode === "transit" ? await requestTransit(stops) : await requestValhalla(stops, mode);
  return tagRoutes(found, mode);
}
//: A route as a ribbon on the road as drawn (routeSurfaceHeights): resampled every few metres so it
//: follows the hills, on a deck where the route is on a deck and on a bore's floor where it is in a
//: tunnel -- and there, and along a subway leg, a fainter copy on the ground over it, so the way
//: it goes is seen from above. Inside this region only (beyond it there is no ground to lay it on).
//: The heights are worked out once per route; a change of width only re-lays the ribbon.
function routeSamples(result) {
  if (result.samples) return result.samples;
  const b = DATA.bbox, inside = ([lon, lat]) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
  const runs = [];
  let run = [];
  const line = result.line, under = result.under || [], flagged = Array.isArray(result.surface) ? result.surface : null;
  const flush = () => { if (run.length > 1) runs.push(run); run = []; };
  for (let i = 0; i < line.length; i += 1) {
    if (!inside(line[i])) { flush(); continue; }
    const [x, y] = xy(...line[i]);
    const here = [x, -y, Boolean(under[i]), flagged ? flagged[i] ?? null : undefined];
    if (run.length) {
      const [px, pz, pu, pf] = run[run.length - 1], gap = Math.hypot(here[0] - px, here[1] - pz);
      // Between two points the way is what both ends are; at a change, what the start is.
      for (let k = 1; k < Math.floor(gap / 3); k += 1) {
        run.push([px + (here[0] - px) * k * 3 / gap, pz + (here[1] - pz) * k * 3 / gap, pu && here[2], pf === here[3] ? pf : pf ?? here[3]]);
      }
    }
    run.push(here);
  }
  flush();
  result.samples = runs.map((points) => {
    const surfaces = routeSurfaceHeights(points, flagged ? points.map((p) => p[3] ?? null) : null);
    return points.map(([x, z, subway], i) => {
      const ground = groundLiftAt(x, z) + ROAD_TOP_M;
      const s = surfaces[i];
      // Under the ground: in a bore whose floor is well under the hill, or on a subway leg.
      const hidden = subway || (s.kind === "tunnel" && ground - s.y > 2.0);
      return { x, z, y: subway ? ground : s.y, ground, hidden, kind: subway ? "subway" : s.kind };
    });
  });
  return result.samples;
}
//: `top`: the chosen route, drawn over the alternatives and the road paint. Where an alternative
//: shares a street with it the two ribbons lay at the same height, and the narrower grey one showed
//: through as a strand down the blue one's middle. `over`: from far out, drawn over the houses as a
//: map draws it, rather than on the ground between them, where it was never wider than the street.
function routeRibbon(result, width, colour, { top = false, over = false } = {}) {
  const group = new THREE.Group();
  // Over the houses, after the tile tree's see-through ground as the pins are (see pinOnTop).
  if (over) group.renderOrder = top ? 25 : 24;
  const offset = top ? { polygonOffsetFactor: -8, polygonOffsetUnits: -16 } : { polygonOffsetFactor: -4, polygonOffsetUnits: -8 };
  const material = new THREE.MeshBasicMaterial({ color: colour, polygonOffset: true, ...offset, side: THREE.DoubleSide,
    depthTest: !over, depthWrite: !over, transparent: over });
  const faint = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.45, depthWrite: false,
    polygonOffset: true, ...offset, side: THREE.DoubleSide, depthTest: !over });
  const lay = (points, heightOf, mat) => {
    if (points.length < 2) return;
    const positions = [], index = [];
    points.forEach((p, i) => {
      const a = points[Math.max(0, i - 1)], c = points[Math.min(points.length - 1, i + 1)];
      const len = Math.hypot(c.x - a.x, c.z - a.z) || 1, nx = -(c.z - a.z) / len * width / 2, nz = (c.x - a.x) / len * width / 2;
      const y = heightOf(p) + ROUTE_LIFT_M + (top ? ROUTE_TOP_LIFT_M : 0);
      positions.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz);
      if (i) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, mat);
    // Over the houses it is drawn after them (and under the pins, 26 and up); on the ground,
    // the chosen route after the alternatives.
    mesh.renderOrder = over ? (top ? 25 : 24) : (top ? 4 : 3);
    group.add(mesh);
  };
  let inside = 0;
  for (const points of routeSamples(result)) {
    inside += points.length;
    lay(points.filter((p) => p.kind !== "subway"), (p) => p.y, material);
    // The hidden stretches again, faint, on the ground over them.
    let stretch = [];
    for (const p of [...points, null]) {
      if (p && p.hidden) { stretch.push(p); continue; }
      lay(stretch, (q) => q.ground, faint);
      stretch = [];
    }
  }
  // From the street, the chosen route seen faintly through the houses in front of it, as a map
  // shows it: drawn only where it was in view, the near row hid whole stretches of it while the
  // grey alternative in the middle of the street stayed in sight.
  if (top && !over) {
    const ghost = new THREE.Group();
    ghost.renderOrder = 23;
    const through = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.35,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    for (const mesh of group.children) if (mesh.material === material) ghost.add(new THREE.Mesh(mesh.geometry, through));
    group.add(ghost);
  }
  return { group, inside };
}
//: How wide the ribbons are drawn at the present view: their ground width, or wider from above.
function routeScale() {
  return Math.min(ROUTE_RIBBON_MAX_SCALE, Math.max(1, (state.firstPerson ? 0 : state.dist) * ROUTE_RIBBON_PER_M / ROUTE_RIBBON_M.chosen));
}
//: From this far out the ribbon is drawn over the houses: past here it is wider than the street.
const ROUTE_OVER_HOUSES_M = 600;
const routeOverHouses = () => !state.firstPerson && state.dist > ROUTE_OVER_HOUSES_M;
let routeDrawnOver = false;
// Bounds in local metres, including every bend and every requested stop. Use both screen
// axes (a narrow window must still fit east/west routes), without moving the walker.
function routeOverviewPlan(points, aspect, fov) {
  const valid = points.filter(p => p.every(Number.isFinite));
  if (!valid.length) return null;
  const xs = valid.map(p => p[0]), zs = valid.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const halfFov = Math.tan(fov * Math.PI / 360);
  const distance = Math.max(90, (maxZ-minZ+60)/(2*halfFov), (maxX-minX+60)/(2*halfFov*aspect)) * 1.15;
  return {x:(minX+maxX)/2, z:(minZ+maxZ)/2, distance};
}
function showRouteOverview() {
  if (META) return;
  const chosen = route.results[route.chosen];
  const points = [...(chosen?.line || []), ...route.stops.filter(Boolean).map(s => [s.lon,s.lat])]
    .map(([lon,lat]) => {const [x,y]=xy(lon,lat); return [x,-y];});
  if (state.firstPerson) setFirstPerson(false);
  const view = routeOverviewPlan(points, camera.aspect, camera.fov);
  if (!view) return;
  gps.follow = false;
  state.target.set(view.x, walkerGroundAt(view.x,view.z), view.z);
  state.yaw = 0; state.pitch = Math.PI/2; state.tilt = 0;
  state.dist = Math.min(MAX_ORBIT_DIST_M,view.distance);
  placeCamera(); drawRoutes();
}
//: Redrawn only when the view's distance has changed a good deal, never every frame.
function updateRouteWidth() {
  if (!route.results.length) return;
  const scale = routeScale();
  if (Math.abs(Math.log(scale / (routeDrawnAt || 1))) > 0.4 || routeOverHouses() !== routeDrawnOver) drawRoutes();
}
function drawRoutes() {
  routeDrawnAt = routeScale();
  routeDrawnOver = routeOverHouses();
  for (const child of [...routeGroup.children]) {
    routeGroup.remove(child);
    child.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  route.results.forEach((result, i) => {
    if (i === route.chosen) return;
    routeGroup.add(routeRibbon(result, ROUTE_RIBBON_M.other * routeDrawnAt, 0x94a3b8, { over: routeDrawnOver }).group);
  });
  const chosen = route.results[route.chosen];
  if (!chosen) return 0;
  const drawn = routeRibbon(chosen, ROUTE_RIBBON_M.chosen * routeDrawnAt, 0x2563eb, { top: true, over: routeDrawnOver });
  routeGroup.add(drawn.group);
  return drawn.inside;
}
if (!ATTACH) {
  const panel = document.getElementById("route-panel");
  const stopsBox = document.getElementById("route-stops");
  const status = document.getElementById("route-status");
  const results = document.getElementById("route-results");
  results.setAttribute("role","listbox");
  results.setAttribute("aria-label","Route alternatives");
  const stepsList = document.getElementById("route-steps");
  const clear = document.getElementById("route-clear");
  // The route under way: its steps take the sidebar's place (nav-panel), the map beside them;
  // "Options" goes back to the directions, "Step-by-step directions" comes back, and ✕ folds the
  // sidebar away with the route still drawn (End route, or Escape, ends it).
  const hud = document.getElementById("hud");
  const sidebar = document.getElementById("map-sidebar");
  const navPanel = document.getElementById("nav-panel");
  const navSteps = document.getElementById("nav-steps");
  const navSummary = document.getElementById("nav-summary");
  const showSteps = document.getElementById("route-show-steps");
  const setHudOpen = (open) => {
    const fold = document.getElementById("fold");
    hud.dataset.open = String(open);
    fold.setAttribute("aria-expanded", String(open));
  };
  function showNavigation(steps) {
    navPanel.hidden = !steps;
    sidebar.hidden = Boolean(steps);
    if (steps) { setHudOpen(true); navSteps.scrollTop = 0; }
  }
  //: Valhalla's maneuver types as an arrow: starts and ends, straight on, the bends and turns
  //: each way, U-turns and roundabouts; anything else (a ramp, a ferry) a plain dot.
  const TURN_ARROWS = { 1: "●", 2: "●", 3: "●", 4: "◉", 5: "◉", 6: "◉", 7: "↑", 8: "↑", 9: "↗", 10: "↱", 11: "↱",
    12: "↷", 13: "↶", 14: "↰", 15: "↰", 16: "↖", 22: "↑", 23: "↗", 24: "↖", 25: "↑", 26: "⟳", 27: "↗" };
  const distanceText = (km) => km >= 1 ? `${km.toFixed(1)} km` : `${Math.max(5, Math.round(km * 1000 / 5) * 5)} m`;
  function renderNavigation() {
    const chosen = route.results[route.chosen];
    showSteps.hidden = !chosen;
    if (!chosen) { navSteps.replaceChildren(); navSummary.textContent = ""; return; }
    const mode = { walk: "walking", bike: "by bike", drive: "driving", transit: "by transit" }[route.mode] || "";
    navSummary.innerHTML = `<b>${minutes(chosen.seconds)}</b>${chosen.km ? `${chosen.km.toFixed(1)} km ` : ""}${mode}`;
    navSteps.replaceChildren(...(chosen.steps || []).map((text, i) => {
      const info = chosen.stepInfo?.[i];
      const item = document.createElement("li");
      const turn = Object.assign(document.createElement("span"), { className: "turn",
        textContent: (info && TURN_ARROWS[info.type]) || (route.mode === "transit" ? "⇢" : "•") });
      turn.setAttribute("aria-hidden", "true");
      item.append(turn, Object.assign(document.createElement("span"), { textContent: text }));
      if (info?.km > 0) item.append(Object.assign(document.createElement("span"), { className: "far", textContent: distanceText(info.km) }));
      return item;
    }));
  }
  document.getElementById("nav-back").addEventListener("click", () => showNavigation(false));
  document.getElementById("nav-close").addEventListener("click", () => setHudOpen(false));
  showSteps.addEventListener("click", () => showNavigation(true));
  const minutes = (s) => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`;
  // Where you are: the device's fix while it is on the map, and the walker otherwise -- a fix
  // from outside every region (the Mac at home) is not a start anyone here can walk from.
  const here = () => {
    if (gps.fix && regionAt(gps.fix.lon, gps.fix.lat)) return { label: "Your location", lon: gps.fix.lon, lat: gps.fix.lat, here: true };
    const p = avatar.position;
    return { label: "Your location", lon: p.x / metersPerLon + midLon, lat: -p.z / metersPerLat + midLat, here: true };
  };
  // A searched place: a pin, the view brought to it, and the directions from you to it filled in.
  const pin = new THREE.Group();
  const pinMaterial = new THREE.MeshBasicMaterial({ color: 0xdc2626 });
  const pinPoint = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 20), pinMaterial);
  pinPoint.rotation.x = Math.PI;
  pinPoint.position.y = 3;
  const pinHead = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 14), pinMaterial);
  pinHead.position.y = 6.5;
  pin.add(pinPoint, pinHead);
  pin.visible = false;
  pin.userData.bayWide = true;
  pinOnTop(pin);
  root.add(pin);
  //: A place's pin is 10.6 m to the top of its label as modelled: drawn at 0.45 of that (a little
  //: under five metres, a storey and a half) and held at about forty pixels from further off.
  const PLACE_PIN_BASE = 0.45, PLACE_PIN_NEAR_M = 125;
  const pinMarker = { object: pin, base: PLACE_PIN_BASE, near: PLACE_PIN_NEAR_M, x: 0, z: 0 };
  findableMarkers.add(pinMarker);
  // Blue pins at the directions' start, each stop and the end, lettered in order (A, the start),
  // and as findable from any height as the others.
  const ROUTE_PIN_BLUE = 0x2563eb;
  const routePinMaterial = new THREE.MeshBasicMaterial({ color: ROUTE_PIN_BLUE });
  let routePins = [];
  function clearRoutePins() {
    for (const marker of routePins) { root.remove(marker.object); findableMarkers.delete(marker); }
    routePins = [];
  }
  function placeRoutePins(stops) {
    clearRoutePins();
    stops.forEach((stop, i) => {
      if (!regionAt(stop.lon,stop.lat)) return;
      const [x, y] = xy(stop.lon, stop.lat);
      const object = new THREE.Group();
      const point = new THREE.Mesh(pinPoint.geometry, routePinMaterial);
      point.rotation.x = Math.PI;
      point.position.y = 3;
      const head = new THREE.Mesh(pinHead.geometry, routePinMaterial);
      head.position.y = 6.5;
      const label = pinLabel(String.fromCharCode(65 + i), ROUTE_PIN_BLUE);
      label.position.y = 10.6;
      label.scale.set(4.2, 4.2, 1);
      object.add(point, head, label);
      object.position.set(x, walkerGroundAt(x, -y), -y);
      object.userData.bayWide = true;
      pinOnTop(object, 28);
      root.add(object);
      const marker = { object, base: PLACE_PIN_BASE, near: PLACE_PIN_NEAR_M, x, z: -y };
      findableMarkers.add(marker);
      routePins.push(marker);
    });
    // The destination's own pin is now one of these.
    if (routePins.length) pin.visible = false;
  }
  window.kerbsideShowPlace = (place) => {
    const b = DATA.bbox;
    if (!(place.lon >= b.west && place.lon <= b.east && place.lat >= b.south && place.lat <= b.north)) return false;
    // The search at the top is for going places, not for directions: the walker is taken there
    // (outside, at the address: addressLanding) and the place is pinned. The directions are
    // left as they were; a route is asked for only in the From and To fields under it.
    const [x, y] = xy(place.lon, place.lat);
    pin.position.set(x, walkerGroundAt(x, -y), -y);
    pinMarker.x = x; pinMarker.z = -y;
    pin.visible = true;
    gps.follow = false;
    if (state.firstPerson) setFirstPerson(false);
    goTo(addressLanding(new THREE.Vector3(x, 0, -y)), { travel: true, zoom: true });
    return true;
  };
  // A start chosen in the directions is where the walker goes: put down there, outside, as a
  // search puts it (addressLanding), so the route is walked from where it begins.
  function walkerToStart(place) {
    const b = DATA.bbox;
    if (!(place.lon >= b.west && place.lon <= b.east && place.lat >= b.south && place.lat <= b.north)) {
      status.textContent = "The start is outside this region; the walker stays where it is.";
      return false;
    }
    const [x, y] = xy(place.lon, place.lat);
    gps.follow = false;
    goTo(addressLanding(new THREE.Vector3(x, 0, -y)), { travel: true, zoom: true });
    return true;
  }
  //: A pin at each end (and each stop) once they are chosen, before the route is asked for: the
  //: start is where you are when it is left blank.
  function pinStops() {
    const stops = route.stops.map((stop, i) => stop || (i === 0 ? here() : null));
    if (stops.length >= 2 && stops[stops.length - 1]) placeRoutePins(stops.filter(Boolean));
  }
  function renderStops() {
    stopsBox.replaceChildren();
    route.stops.forEach((stop, i) => {
      const row = document.createElement("div");
      row.className = "stop";
      const dot = document.createElement("span");
      dot.className = "dot";
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.placeholder = i === 0 ? "From (blank: where you are)" : i === route.stops.length - 1 ? "To" : "Stop";
      input.value = stop?.label || "";
      input.setAttribute("aria-label", input.placeholder);
      const list = document.createElement("ul");
      list.className = "hits";
      let offered = [];
      const choose = (place) => {
        route.stops[i] = place;
        input.value = place.label;
        offered = [];
        list.replaceChildren();
        if (i === 0) walkerToStart(place);
        pinStops();
      };
      input.addEventListener("input", () => {
        route.stops[i] = null;
        offered = searchPlaces(input.value).slice(0, 6);
        list.replaceChildren(...offered.map((place) => {
          const item = document.createElement("li");
          item.textContent = place.label;
          item.addEventListener("mousedown", (e) => {
            e.preventDefault();
            choose(place);
          });
          return item;
        }));
      });
      // Enter takes the first suggestion, as the search box does.
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || !offered.length) return;
        choose(offered[0]);
        e.preventDefault();
      });
      input.addEventListener("blur", () => setTimeout(() => list.replaceChildren(), 150));
      row.append(dot, input);
      if (i > 0 && i < route.stops.length - 1) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "✕";
        remove.setAttribute("aria-label", "Remove stop");
        remove.addEventListener("click", () => { route.stops.splice(i, 1); renderStops(); });
        row.append(remove);
      }
      row.append(list);
      stopsBox.append(row);
    });
    document.getElementById("route-add").disabled = route.stops.length >= ROUTE_MAX_STOPS;
  }
  function renderResults(drawnInside) {
    const quickest = Math.min(...route.results.map((r) => r.seconds));
    results.replaceChildren(...route.results.map((r, i) => {
      const item = document.createElement("li");
      item.setAttribute("aria-selected", String(i === route.chosen));
      item.setAttribute("role", "option");
      item.tabIndex = 0;
      const extra = r.seconds - quickest >= 60 ? ` <small>+${minutes(r.seconds - quickest)}</small>` : "";
      const tags = (r.tags || []).map((t) => `<em class="tag tag-${t.id}">${t.label}</em>`).join("");
      const detail = route.mode === "transit"
        ? `${r.transfers ? `${r.transfers} transfer${r.transfers > 1 ? "s" : ""}` : "No transfers"} · ${r.walkM} m walking`
        : `${r.km.toFixed(1)} km · ↑${r.ascent} m ↓${r.descent} m${route.mode !== "walk" ? ` · ${r.turns} turns` : ""}`;
      const choice = `<span class="route-choice">Route ${String.fromCharCode(65+i)}${i === route.chosen ? " ✓ Selected" : ""}</span>`;
      item.innerHTML = `${choice}<b>${minutes(r.seconds)}</b>${extra}${tags ? `<span class="tags">${tags}</span>` : ""}<span>${detail}</span>`;
      item.addEventListener("click", () => { route.chosen = i; renderResults(drawRoutes()); });
      item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") {e.preventDefault(); item.click();} });
      return item;
    }));
    const chosen = route.results[route.chosen];
    // The steps are read in their own panel (renderNavigation); the options list stays short.
    stepsList.replaceChildren();
    stepsList.hidden = true;
    renderNavigation();
    clear.hidden = !route.results.length;
    document.getElementById("route-end").hidden = !route.results.length;
    if (chosen) status.textContent = (route.mode === "drive" ? "Typical time, without live traffic. " : "")
      + (route.mode === "transit" ? "Scheduled times (Transitous, from the agencies' timetables). " : "")
      + (drawnInside < chosen.line.length * 0.5 ? "Part of this route is outside this region and is listed, not drawn." : "");
  }
  panel.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    route.mode = button.dataset.mode;
    panel.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    document.getElementById("route-add").hidden = route.mode === "transit";
    if (route.mode === "transit" && route.stops.length > 2) { route.stops = [route.stops[0], route.stops[route.stops.length - 1]]; renderStops(); }
  }));
  document.getElementById("route-add").addEventListener("click", () => {
    if (route.stops.length < ROUTE_MAX_STOPS) { route.stops.splice(route.stops.length - 1, 0, null); renderStops(); }
  });
  // The route ends from the panel's Clear, the End route button beside the map controls (shown
  // while a route is drawn, the panel folded or not), or Escape.
  const endRoute = () => {
    route.pending = null;
    route.results = []; route.chosen = 0; drawRoutes(); renderResults(0); status.textContent = "";
    pin.visible = false; gps.follow = true;
    clearRoutePins();
    showNavigation(false);
  };
  clear.addEventListener("click", endRoute);
  document.getElementById("route-end").addEventListener("click", endRoute);
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !route.results.length) return;
    if (!settingsForm.hidden) return;   // Escape closes the settings first
    endRoute();
  });
  document.getElementById("route-go").addEventListener("click", async () => {
    const stops = route.stops.map((stop, i) => stop || (i === 0 ? here() : null));
    if (stops.some((stop) => !stop)) { status.textContent = "Choose each stop from the suggestions."; return; }
    const queryKey = JSON.stringify([route.mode,stops.map(s=>[s.lon,s.lat])]);
    // Reopening the panel to choose Route B must not discard it and fetch Route A again.
    if (route.results.length && route.queryKey === queryKey) { showRouteOverview(); return; }
    // Directions from somewhere else start the walker there.
    if (!stops[0].here) walkerToStart(stops[0]);
    placeRoutePins(stops);
    status.textContent = "Finding routes…";
    const ticket = route.pending = Symbol("route");
    try {
      const found = await requestRoutes(stops, route.mode);
      if (ticket !== route.pending) return;
      route.results = found;
      route.chosen = 0;
      route.queryKey = queryKey;
      status.textContent = "";
      renderResults(drawRoutes());
      showRouteOverview();
      if (found.length) showNavigation(true);
    } catch (error) {
      if (ticket !== route.pending) return;
      route.results = [];
      drawRoutes();
      renderResults(0);
      status.textContent = /no path|no suitable/i.test(error.message)
        ? "No route was found between those stops for this mode."
        : "The routing service could not be reached; try again in a moment.";
    }
  });
  renderStops();
  //: Directions from where you are to `place`, laid on the ground (the headset's menu): the
  //: chosen route, or null.
  async function directionsTo(place, mode = "walk") {
    route.mode = mode;
    route.stops = [null, place];
    renderStops();
    const stops = [here(), place];
    placeRoutePins(stops);
    const ticket = route.pending = Symbol("route");
    const found = await requestRoutes(stops, mode);
    if (ticket !== route.pending) return null;
    route.results = found;
    route.chosen = 0;
    renderResults(drawRoutes());
    return found[0] || null;
  }
  window.kerbsideRoute = { request: requestRoutes, routeRequest, decodePolyline6, tagRoutes, state: route, group: routeGroup,
    directionsTo, end: endRoute, pins: () => routePins.map((m) => ({ at: m.object.position.toArray().map(Math.round), scale: +m.object.scale.x.toFixed(2), visible: m.object.visible, inScene: !!m.object.parent })) };
}

// The settings panel: the gear at the top right.
function applySettings(changes = {}) {
  if (FPS_CHOICES.includes(changes.fps)) SETTINGS.fps = changes.fps;
  if (QUALITY_PRESETS[changes.quality]) SETTINGS.quality = changes.quality;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); } catch (error) { /* this visit only */ }
  YIELD_BUDGET_MS = QUALITY().budgetMs;
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY().pixelRatio));
  resize();
  cullForced = true;
  zoomTier = ZOOM_TOP;
  setBuildingsPlain(false);
  setPavingJoints(true);
  setCityAsTiles(false);
  updateZoomTier();
  settingsForm.fps.value = String(SETTINGS.fps);
  settingsForm.quality.value = SETTINGS.quality;
  return { ...SETTINGS, ...QUALITY() };
}
// The settings page holds everything that is not wanted at once: how the map is drawn, its
// layers, its coverage notes and numbers, the legend and how to get around. Its button sits under
// the compass at the top right.
// The settings page's button is the last thing in the sidebar.
const settingsButton = document.getElementById("settings-toggle");
const settingsForm = document.getElementById("settings-page");
// A region drawn as a guest is handed a stand-in page: its parts are made where they are missing.
const settingsPart = (id, tag) => settingsForm.querySelector(`#${id}`)
  || settingsForm.appendChild(Object.assign(document.createElement(tag), { id }));
settingsPart("settings-display", "section").insertAdjacentHTML("beforeend", `
  <label class="row">Frame rate
    <select name="fps">${FPS_CHOICES.map((f) => `<option value="${f}">${f ? `${f} fps` : "Unlimited"}</option>`).join("")}</select></label>
  <label class="row">Quality
    <select name="quality">${Object.entries(QUALITY_PRESETS).map(([k, q]) => `<option value="${k}">${q.label}</option>`).join("")}</select></label>
  <label class="row">Build
    <select name="world">${LIGHT_RADII_M.map((r, i) => `<option value="${i}"${!i && document.querySelector('meta[name="kerbside-app-mode"]') ? " disabled" : ""}>${i ? `${(2 * r / 1000).toFixed(1)} km round you` : "Whole region (export only)"}</option>`).join("")}</select></label>
  <p class="note">Lower quality draws fewer pixels, brings detail in closer and loads more gently; Low and Medium also load a lighter ground (from the next load). Saved in this browser.</p>
  <output id="stream-status" class="note" aria-live="polite"></output>
  <label class="row">Show me at my location<input type="checkbox" name="gps" /></label>
  <p class="note">Your walker stands where your device says you are, and walks and turns with you, while you are in this region. Your location stays in this browser except as the start of directions you ask for.</p>`);
function showSettings(open) {
  if (!open) showControlsPage(false);
  settingsForm.hidden = !open;
  settingsButton.setAttribute("aria-expanded", String(open));
}
settingsPart("settings-close", "button").addEventListener("click", () => showSettings(false));
// The controls page: every control and what it does, in place of the rest of the settings.
function showControlsPage(open) {
  if (open) settingsForm.dataset.page = "controls"; else delete settingsForm.dataset.page;
  const page = settingsForm.querySelector("#controls-help");
  if (page) page.hidden = !open;
  settingsForm.scrollTop = 0;
}
settingsForm.querySelector("#controls-open")?.addEventListener("click", () => showControlsPage(true));
settingsForm.querySelector("#controls-back")?.addEventListener("click", () => showControlsPage(false));
settingsForm.querySelector("#pins-clear")?.addEventListener("click", () => { clearPins(); pinSay("Pins cleared"); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !settingsForm.hidden) showSettings(false); });
settingsForm.addEventListener("change", (e) => {
  if (e.target === settingsForm.gps) {
    gps.enabled = settingsForm.gps.checked;
    try { localStorage.setItem(GPS_KEY, gps.enabled ? "on" : "off"); } catch (error) { /* this visit only */ }
    if (gps.enabled) startGps(); else stopGps();
    return;
  }
  if (e.target === settingsForm.world) {
    // How much is built is decided before anything is: the page builds again.
    try { localStorage.setItem(LIGHT_KEY, settingsForm.world.value); localStorage.removeItem(RECOVERY_KEY); }
    catch (error) { /* this visit only */ }
    const url = new URL(location.href);
    url.searchParams.delete("full"); url.searchParams.delete("light");
    location.replace(url.href);
    return;
  }
  applySettings({ fps: Number(settingsForm.fps.value), quality: settingsForm.quality.value });
});
settingsForm.addEventListener("submit", (e) => e.preventDefault());
settingsButton.addEventListener("click", () => showSettings(settingsForm.hidden));
settingsForm.fps.value = String(SETTINGS.fps);
settingsForm.quality.value = SETTINGS.quality;
settingsForm.world.value = String(LIGHT_LEVEL);
if (settingsForm.gps) settingsForm.gps.checked = gps.enabled;
startGps();
window.kerbsideSettings = {
  get: () => ({ ...SETTINGS, ...QUALITY(), zoomTier }),
  set: (changes) => applySettings(changes),
  presets: QUALITY_PRESETS, fpsChoices: FPS_CHOICES,
};
{
  // What was built, for anyone reading the console: the merge's parts and meshes, the triangles
  // by group, the time. Measured on this machine; the same page on another will differ.
  const byGroup = {};
  for (const [name, group] of Object.entries(groups)) {
    let triangles = 0;
    group.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const count = o.geometry.index ? o.geometry.index.count : (o.geometry.getAttribute("position") || { count: 0 }).count;
      triangles += Math.floor(count / 3) * (o.isInstancedMesh ? o.count : 1);
    });
    if (triangles) byGroup[name] = `${(triangles / 1e6).toFixed(2)}M`;
  }
  console.info(`kerbside: built in ${((performance.now()-WORLD_BUILD_STARTED) / 1000).toFixed(1)} s; merged ${mergeStats.parts.toLocaleString()} parts into ${mergeStats.meshes.toLocaleString()} tiled meshes; triangles by group`, byGroup);
}
