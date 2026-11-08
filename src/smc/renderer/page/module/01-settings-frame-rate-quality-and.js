// ---- settings: frame rate, quality, and how hard the build may work the machine ------------
//
// Opened from the gear at the top right, and from the console: kerbsideSettings.set({ fps: 30,
// quality: "low" }). Kept in this browser (localStorage), read before anything is built, so the
// build itself is paced by them. Quality is four presets; each sets the drawing resolution, how
// far small things are drawn (detail range), how close the camera must be before windows, doors
// and materials are drawn (zoom detail), and how the build is paced: it works for budgetMs, then
// rests for restMs, so the machine's load is level rather than a minute at full stretch.
const QUALITY_PRESETS = {
  low: { label: "Low", fineGround: false, pixelRatio: 0.75, detailScale: 0.55, lodScale: 0.55, budgetMs: 14, restMs: 22 },
  medium: { label: "Medium", fineGround: false, pixelRatio: 1, detailScale: 0.8, lodScale: 0.8, budgetMs: 20, restMs: 14 },
  high: { label: "High", fineGround: true, pixelRatio: 1, detailScale: 1, lodScale: 1, budgetMs: 28, restMs: 10 },
  max: { label: "Max", fineGround: true, pixelRatio: 2, detailScale: 1.4, lodScale: 1.6, budgetMs: 60, restMs: 0 },
};
const FPS_CHOICES = [15, 30, 45, 60, 0];
const SETTINGS_KEY = "kerbside:settings";
//: The default: High, except where the device says it is small -- under 8 GB of memory (Chrome
//: reports it), or a phone or tablet -- where the fine ground is more than it can hold: Medium.
const SMALL_DEVICE = deviceIsSmall();
const SETTINGS = { fps: 30, quality: SMALL_DEVICE ? "medium" : "high" };
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  if (FPS_CHOICES.includes(saved.fps)) SETTINGS.fps = saved.fps;
  if (QUALITY_PRESETS[saved.quality]) SETTINGS.quality = saved.quality;
} catch (error) { /* settings are a convenience; the defaults stand without storage */ }
// And from the address, for this visit: ?quality=medium&fps=60.
{
  const query = new URLSearchParams(location.search);
  if (QUALITY_PRESETS[query.get("quality")]) SETTINGS.quality = query.get("quality");
  if (query.has("fps") && FPS_CHOICES.includes(Number(query.get("fps")))) SETTINGS.fps = Number(query.get("fps"));
}
// The headset: the light preset, every frame the headset asks for (it sets the rate).
if (META) { SETTINGS.quality = "low"; SETTINGS.fps = 0; }
const QUALITY = () => QUALITY_PRESETS[SETTINGS.quality];

//: The square built in full on a lighter build, round the place decided before the fetches.
const BUILD_WINDOW = LIGHT_LEVEL ? makeWindow(LIGHT_SPEC || windowSpec(DATA.bbox)) : null;
if (BUILD_WINDOW) {
  const before = DATA.ways.length;
  DATA.ways = DATA.ways.filter((way) => BUILD_WINDOW.near(way.points || way.centroid));
  for (const key of ["intersections", "observations", "coverage", "sequence_paths", "gaps"]) {
    if (Array.isArray(DATA[key])) DATA[key] = DATA[key].filter((item) => BUILD_WINDOW.near(item));
  }
  if (OFFICIAL_GEOMETRY) {
    for (const key of ["curb_lines", "curb_ramps"]) {
      if (Array.isArray(OFFICIAL_GEOMETRY[key])) OFFICIAL_GEOMETRY[key] = OFFICIAL_GEOMETRY[key].filter((item) => BUILD_WINDOW.near(item));
    }
  }
  if (WORLD_OBJECTS && Array.isArray(WORLD_OBJECTS.objects)) WORLD_OBJECTS.objects = WORLD_OBJECTS.objects.filter((o) => BUILD_WINDOW.near(o));
  console.info(`kerbside: lighter build (level ${LIGHT_LEVEL}): ${DATA.ways.length.toLocaleString()} of `
    + `${before.toLocaleString()} ways, the ${(2 * BUILD_WINDOW.radius / 1000).toFixed(1)} km square round `
    + `${BUILD_WINDOW.lon.toFixed(5)}, ${BUILD_WINDOW.lat.toFixed(5)}; the tile tree draws the rest`);
}
//: Past the square's edge, less this, the square is built again round the walker.
const LIGHT_EDGE_M = 120;
let lightWindowStart = null;
// Build a replacement in-page, retaining the last working window until it is ready.
function rebuildRoundHere(lon, lat, force = false) {
  if (!ATTACH && REGION_INDEX.host) attachRegion(REGION_INDEX.host,{lon,lat},STREAM.radius,force);
}
//: The walker has walked, or been taken, near the edge of the square: build round it again.
function checkLightWindow(frame) {
  if (!hostWorldActive || !BUILD_WINDOW || frame % 30 !== 0) return;
  // Never navigate merely because a restored/default spawn is near a window boundary.
  // Only actual movement or teleporting after the first frame can request a new window.
  if (!lightWindowStart) { lightWindowStart = [avatar.position.x, avatar.position.z]; return; }
  if (Math.hypot(avatar.position.x - lightWindowStart[0], avatar.position.z - lightWindowStart[1]) < 1) return;
  const lon = midLon + avatar.position.x / metersPerLon, lat = midLat - avatar.position.z / metersPerLat;
  const b = DATA.bbox;
  if (b && (lon < b.west || lon > b.east || lat < b.south || lat > b.north)) return;
  const kLon = metersPerLon, kLat = metersPerLat;
  const [w, s0, e, n] = BUILD_WINDOW.box;
  const margin = Math.min((lon - w) * kLon, (e - lon) * kLon, (lat - s0) * kLat, (n - lat) * kLat);
  // Only where the square is not already the region's own edge.
  const atRegionEdge = b && ((lon - b.west) * kLon < LIGHT_EDGE_M || (b.east - lon) * kLon < LIGHT_EDGE_M
    || (lat - b.south) * kLat < LIGHT_EDGE_M || (b.north - lat) * kLat < LIGHT_EDGE_M);
  if (margin < LIGHT_EDGE_M && !atRegionEdge) {
    rebuildRoundHere(lon, lat);
    lightWindowStart=[avatar.position.x,avatar.position.z];
  }
}
//: The ground cover, the furniture: each kept to the square, list by list.
function windowLists(container) {
  if (!BUILD_WINDOW || !container) return container;
  for (const [key, value] of Object.entries(container)) {
    if (Array.isArray(value)) container[key] = value.filter((item) => BUILD_WINDOW.near(item));
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, list] of Object.entries(value)) {
        if (Array.isArray(list) && list.length && typeof list[0] === "object") value[inner] = list.filter((item) => BUILD_WINDOW.near(item));
      }
    }
  }
  return container;
}
// Drawn at the preset's resolution: one pixel per CSS pixel at High. At a Retina display's 2x the
// GPU shades four times the pixels, and that is what was bringing laptops down while the world
// loaded; Max draws at the display's own resolution.
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY().pixelRatio));
// Without tone mapping the renderer clips: anything the lights push past 1.0 lands on pure
// white and everything above that threshold flattens into the same colour. With a bright sky
// and a bright sun that was most of the ground, which is why making the carriageway texture
// darker changed almost nothing on screen -- the surface was already saturated and the extra
// darkness was being clipped away before it could be seen. Filmic tone mapping rolls the
// highlights off instead, so the difference between a near-black road and a mid-grey footway
// survives to the pixel.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
const scene = new THREE.Scene();
// Haze, not ink. The fog took everything past 1,900 m to 0x071013, which is near black, so the
// bay and the far side of the city faded into the same darkness whatever was drawn there. It
// clears to the sky's own horizon band now, so the far city fades into the sky rather than into
// a colour of its own.
//: The horizon's colour, which the fog clears to. Taken from the sky texture's own horizon band
//: so that the far city fades into the sky rather than into a colour of its own. Declared here
//: rather than beside the sky itself: the fog is set up with the scene, long before the sky
//: texture is drawn, and a const cannot be read before it is reached.
const HORIZON = new THREE.Color(0xbcd0dc);
//: The fog closes where the far plane cuts, so the cut is never seen: past it is sky. The far
//: plane reaches the five-mile perimeter from the far side of a region.
const FAR_M = 30000;
scene.fog = new THREE.Fog(HORIZON, 2400, FAR_M * 0.96);

// The near plane is the other half of the depth problem: precision scales with it, and 0.1 m
// bought nothing since the camera never comes closer than a few metres to anything.
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, FAR_M);
// The measured median kerb, in metres: 9,376 lidar slices, cross-checked against Waymo
// ground-level lidar to within 1 mm of median. The model is built to it rather than to nominal.
//: What a way falls back to when nothing has measured its kerb. Not a standard six inches --
//: the median of everything the lidar did measure in this corridor.
const KERB_FALLBACK = DATA.kerb_height_m || 0.126;
//: The tallest kerb the model will draw. San Francisco's standard is six inches; eight is the
//: most a kerb face gets before it is a wall.
const KERB_RENDER_MAX_M = 0.2;

// ---- one kerb, everywhere ----
//
// Every kerb is drawn the way an unmeasured one is drawn: the region's own median height, and
// the way's single width rather than the width read station by station along it.
//
// The measurements are not discarded and nothing upstream changes. way.kerb_m still carries
// the height the lidar read for that street, way._spans still carries the kerb envelope, the
// cross-sections still carry every station, and the capability record still reports what was
// measured and how much of it. They are simply not what the renderer draws from.
//
// The reason is that a measured kerb and an inferred one were being drawn by two different
// paths, and the measured path is the one that breaks: at Pine and Stockton the corner pieces
// are assembled from the two legs' own kerb lines, the lines disagree where the survey put
// them, and the corner is dropped -- leaving a staircase of disconnected slabs with the road
// showing between them. An inferred kerb has no disagreement to have, so it closes. Until the
// corner builder can take two measured lines that do not meet and still produce a corner, a
// street drawn consistently is worth more than a street drawn accurately in places and
// broken in others.
const KERB_RENDER_UNIFORM = true;

function renderedKerbHeight(way) {
  if (KERB_RENDER_UNIFORM) return Math.min(KERB_FALLBACK, KERB_RENDER_MAX_M);
  return Math.min((way && way.kerb_m) || KERB_FALLBACK, KERB_RENDER_MAX_M);
}

const root = new THREE.Group();
if (ATTACH) ATTACH.onRoot(root); else scene.add(root);
//: The street vertices by cell (indexJunctionVertices): read by the junction approaches and by
//: where a house's front door goes, which is decided while the buildings are built.
const JUNCTION_CELL_M = 20;
let junctionVertexGrid = null;
const groups = {
  streets: new THREE.Group(),
  mapped3d: new THREE.Group(),
  coverage: new THREE.Group(),
  observations: new THREE.Group(),
  sequences: new THREE.Group(),
  districts: new THREE.Group(),
  kerbs: new THREE.Group(),
  facades: new THREE.Group(),
  ground: new THREE.Group(),
  furniture: new THREE.Group(),
  official: new THREE.Group(),
  chunks: new THREE.Group(),
  gaps: new THREE.Group(),
  reconstructed: new THREE.Group(),
};
// What opens is the city: streets, buildings, districts. The survey layers -- where photographs
// were taken, which cells are covered, which sequences ran, which ways are missing -- are all
// about the state of the dataset rather than about the place, and starting with them lit turns
// a map of San Francisco into a progress chart. They are one click away and they stay.
// Street furniture is not in this list. Signs, kerb paint and bus stops are the place, not the
// dataset -- a San Francisco block without its signs is not the block -- so they open with the
// city. The layer is still lazy: it is fetched once the ground has landed, so the first paint is
// not held up by it.
for (const off of ["coverage", "observations", "sequences", "gaps", "kerbs", "chunks",
                   "official"]) {
  groups[off].visible = false;
}
Object.values(groups).forEach((g) => root.add(g));

// The other regions this site has built, from an index build_pages.py writes beside the
// site's root (tools/build_pages.py: regions.json). The page in a region's own folder is told
// where that index is by the meta tag; without one, or where it is missing, the switcher stays
// hidden and the page is the one region it was built for.
(async () => {
  if (ATTACH) return;
  const meta = document.querySelector('meta[name="kerbside-regions"]');
  const index = meta && meta.content;
  if (!index) return;
  let regions;
  try {
    const response = await fetch(index, { cache: "no-cache" });
    if (!response.ok) return;
    regions = await response.json();
  } catch (err) {
    return;
  }
  const list = (regions && regions.regions) || [];
  if (list.length < 2) return;
  const select = document.getElementById("region");
  const group = document.getElementById("regiongroup");
  const here = location.pathname.replace(/\/[^/]*$/, "/");
  const root = index.replace(/[^/]+$/, "");
  const fullRegions = list.filter((region) => region.built && region.bbox);
  function openFullRegion(region, lon, lat) {
    const url = new URL(root + region.path, location.href);
    try {
      sessionStorage.setItem("kerbside:region-arrival", JSON.stringify({
        path: url.pathname, lon, lat, yaw: state.yaw, pitch: state.pitch,
        dist: Math.min(state.dist, ARRIVAL_DIST), firstPerson: state.firstPerson,
      }));
    } catch (error) { /* navigation also works when storage is unavailable */ }
    location.assign(url.href);
  }
  REGION_INDEX.list = fullRegions;
  REGION_INDEX.root = root;
  // Arriving somewhere drawn only as the simple city: its region is built here, in this page,
  // while you carry on (attachRegion). Nothing reloads; the caller goes on to travel there.
  window.kerbsideOpenFullRegionAt = (lon, lat) => {
    if (tileOwnGround(lon, lat)) return false;
    const destination = regionAt(lon, lat);
    // Build one bounded replacement, not a second whole city. Retain the old
    // window until the replacement's streets and ground are ready.
    if (destination) attachRegion(destination,{lon,lat});
    return false;
  };
  for (const region of list) {
    const option = document.createElement("option");
    option.value = new URL(root + region.path, location.href).pathname;
    option.textContent = `${region.title}${region.built ? "" : " (not built)"}`;
    option.disabled = !region.built;
    if (option.value.replace(/[^/]*$/, "") === here) option.selected = true;
    select.appendChild(option);
  }
  // Choosing a region flies you there. It used to load another page, which is a blank screen,
  // a rebuild, and a new world that does not remember where you were -- for a place that is
  // already drawn, across the bay, in the same model you are standing in.
  select.addEventListener("change", () => {
    const region = list.find((r) => new URL(root + r.path, location.href).pathname === select.value);
    // The installed app's regional pages use the full local renderer and local region payload.
    // Do not stop at the far-field tree when its user asks to enter a different city.
    if (region && region.bbox) flyToRegion(region);
    else location.href = select.value;
  });
  const current = list.find((r) => new URL(root + r.path, location.href).pathname.replace(/[^/]*$/, "") === here);
  REGION_INDEX.host = current || null;
  document.getElementById("regionnote").textContent = current && current.note ? current.note : "";
  // One world: there is no region to choose. Every built region is in the model -- in full where
  // you are, as the tile tree's simple blocks everywhere else -- and wherever you go, by search,
  // on foot, or by bringing the camera down over a place and letting it settle, the place you
  // arrive in is drawn in full (its region's model is loaded, arriving where you were looking).
  group.hidden = true;
  setInterval(() => {
    // Not until the page is built and drawing (the timers below are declared with it).
    if (!window.kerbside || !window.kerbsideOpenFullRegionAt) return;
    if (!state.firstPerson && state.dist > REGION_ENTER_DIST_M) return;
    if (!state.firstPerson && performance.now() - Math.max(lastMovedAt, lastInputAt) < REGION_SETTLE_MS) return;
    const focus=state.firstPerson ? avatar.position : state.target;
    const lon = midLon + focus.x / metersPerLon;
    const lat = midLat - focus.z / metersPerLat;
    window.kerbsideOpenFullRegionAt(lon, lat);
  }, 1000);
  //: How much of the screen a region should fill when you are flown to it: far enough out that
  //: its whole box is in view, which for a two-kilometre district is about two kilometres up.
  const REGION_FRAME = 1.4;
  function flyToRegion(region, { now = false } = {}) {
    const [south, west, north, east] = region.bbox;
    // An overview tile omits signs, lawns and other city details. Load that
    // city's complete survey, preserving the destination and view direction.
    attachRegion(region,{lon:(west+east)/2,lat:(south+north)/2});
    const [x, y] = xy((west + east) / 2, (south + north) / 2);
    const [x0, y0] = xy(west, south);
    const [x1, y1] = xy(east, north);
    setFirstPerson(false);
    state.target.set(x, PENINSULA_Y, -y);
    state.dist = Math.max(600, Math.hypot(x1 - x0, y1 - y0) * REGION_FRAME);
    state.pitch = 0.95; state.tilt = 0;
    if (typeof avatar !== "undefined") avatar.position.set(x, AVATAR_STAND_Y, -y);
    placeCamera();
    // The tree has a moment's warning that the world is about to be somewhere else.
    updateTileTree(performance.now());
    const note = document.getElementById("regionnote");
    if (note) {
      note.textContent = `${region.title}. `;
      const link = document.createElement("a");
      link.href = new URL(root + region.path, location.href).pathname;
      link.textContent = "Open the full survey here";
      link.style.color = "#8fd0ff";
      note.appendChild(link);
    }
  }
  window.kerbsideFlyToRegion = flyToRegion;
  // The markers are drawn with the module's labels and its tile tree, which this loader -- run
  // beside the module, not after it -- can reach before the module has: it stopped there with
  // a declaration not yet made, and the page reported that it had failed to start. So it waits
  // for the whole module (regionStreamingReady, set as its last line).
  while (!regionStreamingReady) await new Promise((resolve) => setTimeout(resolve, 100));
  // The other built regions, as markers standing over their ground in the perimeter -- a
  // click on one opens it. What was rendered is visible from where you are, across the bay.
  // One post shape and paint for every marker: a hundred and more regions made a material each.
  const postGeometry = new THREE.CylinderGeometry(3, 3, 150, 8);
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.6 });
  // And one draw for all the posts: 275 posts were 275 draw calls a frame from anywhere the
  // markers stand in view. Each is an instance, put out (scaled to nothing) as its mesh was.
  const postsAt = [];
  for (const region of list) {
    if (!region.built || region === current || !region.bbox) continue;
    const [south, west, north, east] = region.bbox;
    const [x, y] = xy((west + east) / 2, (south + north) / 2);
    // The perimeter reaches every region and the country between; a region past the far plane
    // is simply not drawn from here, and the switcher above still lists it.
    const sprite = labelSprite(`${region.title}  \u2192`, "#e8f4ff", 900);
    sprite.position.set(x, 160, -y);
    // A marker is a signpost across the bay, not a billboard over the street it names: it
    // goes out once the region under it is being drawn as a place rather than pointed at.
    sprite.userData.hideWithin = REGION_MARKER_HIDE_M;
    sprite.userData.href = new URL(root + region.path, location.href).href;
    sprite.userData.region = region;
    sprite.userData.surface = "region_marker";
    regionMarkers.add(sprite);
    // A post from the marker to the ground, so it reads as standing somewhere.
    postsAt.push([x, 75 + PENINSULA_Y, -y]);
    // Regional extents are a loading boundary, not a physical rectangle on land
    // or sea. Keep the navigable signpost; do not draw a box through the ocean.
  }
  if (postsAt.length) {
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postsAt.length);
    const m = new THREE.Matrix4();
    postsAt.forEach(([x, y, z], i) => posts.setMatrixAt(i, m.makeTranslation(x, y, z)));
    posts.computeBoundingSphere();
    posts.userData.posts = postsAt;
    posts.userData.postShown = postsAt.map(() => true);
    posts.userData.hideWithin = REGION_MARKER_HIDE_M;
    regionMarkers.add(posts);
  }
})();
//: Closer than this to a region's marker you are at the region, and the tile tree is drawing
//: its streets: the label comes off.
const REGION_MARKER_HIDE_M = 2500.0;
//: Brought down within this of the ground over another region, and left there this long, the
//: camera is somewhere: that region's full model is loaded.
const REGION_ENTER_DIST_M = 700;
const REGION_SETTLE_MS = 1500;
const regionMarkers = new THREE.Group();
regionMarkers.name = "regionMarkers";
scene.add(regionMarkers);

const lazyLayerBuilders = new Map();
//: A layer asked for before it is registered. The build yields to the browser now, so the
//: ground, which arrives by fetch, can finish and ask for the furniture that stands on it
//: while the script is still laying streets and has not reached the furniture's registration.
//: Asked for early, a layer is built the moment it is registered; dropped, it never was.
const lazyLayersWanted = new Set();
function registerLazyLayer(layer, builder) {
  lazyLayerBuilders.set(layer, { builder, promise: null });
  if (lazyLayersWanted.has(layer)) ensureLazyLayer(layer);
}
//: Layers that open with another: the freeway signs and tolls are street furniture.
const LAZY_COMPANIONS = { furniture: ["highway_signs", "highway_tolls", "waterworks"] };
//: Layers built (or given up on) -- the home screen waits for the ones that are open.
const lazyLayersSettled = new Set();
function ensureLazyLayer(layer) {
  lazyLayersWanted.add(layer);
  for (const companion of LAZY_COMPANIONS[layer] || []) ensureLazyLayer(companion);
  const entry = lazyLayerBuilders.get(layer);
  if (!entry || entry.promise) return;
  lazyLayersSettled.delete(layer);
  entry.promise = Promise.resolve()
    .then(entry.builder)
    .catch((err) => {
      console.warn(`Could not build ${layer} layer`, err);
      entry.promise = null;
    })
    .finally(() => lazyLayersSettled.add(layer));
}

const bbox = DATA.bbox;
const midLat = (bbox.south + bbox.north) / 2;
const midLon = (bbox.west + bbox.east) / 2;
const metersPerLat = 111320;
const metersPerLon = metersPerLat * Math.cos(midLat * Math.PI / 180);
function localWindowBox(box) {
  const a=xy(box[0],box[1]),b=xy(box[2],box[3]);
  return new THREE.Vector4(a[0],-b[1],b[0],-a[1]);
}
//: What is drawn in full is a set of boxes, not one: the square round the walker and, with
//: directions, the strip along the way (routeStrip). A clip is up to BOX_SET_MAX of them, the
//: rest empty (EMPTY_BOX: x1 < x0, inside nothing), as x0, z0, x1, z1 in the scene's metres.
const BOX_SET_MAX = 12;
const EMPTY_BOX = new THREE.Vector4(1e12, 1e12, -1e12, -1e12);
function boxSet(list = []) { return Array.from({ length: BOX_SET_MAX }, (_, i) => (list[i] || EMPTY_BOX).clone()); }
function setBoxSet(uniform, list) { for (let i = 0; i < BOX_SET_MAX; i += 1) uniform.value[i].copy(list[i] || EMPTY_BOX); }
function inBoxSet(boxes, x, z) { return boxes.some((b) => x >= b.x && x <= b.z && z >= b.y && z <= b.w); }
const WINDOW_BOXES = BUILD_WINDOW ? BUILD_WINDOW.boxes : null;
const detailClipBox={value:boxSet(WINDOW_BOXES ? WINDOW_BOXES.map(localWindowBox) : [new THREE.Vector4(-1e12,-1e12,1e12,1e12)])};
const tileDetailBox={value:boxSet(WINDOW_BOXES ? WINDOW_BOXES.map(localWindowBox) : [localWindowBox([bbox.west,bbox.south,bbox.east,bbox.north])])};
//: The houses' own clip, inside the one above: emptied when the view is right out over the Bay
//: and the tile tree's simple city stands in for them (setCityAsTiles); and the tile tree's
//: houses', let in over the region then.
const BUILDING_SURFACES = new Set(["wall", "roof", "garage", "plane", "footprint", "reconstructed", "facade"]);
const detailBuildingBox = { value: boxSet(detailClipBox.value) };
const tileBuildingBox = { value: boxSet(tileDetailBox.value) };
// Both tiers share an exact fragment boundary. Never rebuild/drop whole coarse tiles
// on a handoff: their geometry remains ready outside the new full-detail rectangle.
//: A material clipped to a box set: drawn only inside it, or (excludeInside) only outside. A
//: material may carry more than one clip (a house's: the window's and the houses' own), each
//: under its own uniform name.
let boxClipCount = 0;
function applyBoxClip(object, uniform, excludeInside=false) {
  uniform.clipName ||= `uDetailBoxes${++boxClipCount}`;
  const name = uniform.clipName;
  object.traverse(o=>{
    for(const material of o.material ? (Array.isArray(o.material)?o.material:[o.material]) : []) {
      const owners=material.userData.detailOwnerships ||= [];
      const before=material.onBeforeCompile,cacheKey=material.customProgramCacheKey();
      // Known by its name too: a material cloned after it was clipped (the tunnel cut does) has
      // its userData copied through JSON, so the list no longer holds this uniform itself, and
      // a second copy of the clip redefined its uniform -- the shader failed to compile and
      // every lawn and car park in the window drew nothing over the bare ground.
      if(owners.includes(uniform)||cacheKey.includes(`:ownership-v2:${name}:`))continue;
      owners.push(uniform);
      material.onBeforeCompile=function(shader,renderer){
        before.call(this,shader,renderer);shader.uniforms[name]=uniform;
        if(!shader.vertexShader.includes('varying vec3 vDetailWorld;'))
          shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vDetailWorld;')
            .replace('#include <project_vertex>',`#include <project_vertex>
          vec4 detailPosition=vec4(transformed,1.0);
          #ifdef USE_INSTANCING
          detailPosition=instanceMatrix*detailPosition;
          #endif
          vDetailWorld=(modelMatrix*detailPosition).xyz;`);
        if(!shader.fragmentShader.includes('varying vec3 vDetailWorld;'))
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vDetailWorld;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
          `#include <common>\nuniform vec4 ${name}[${BOX_SET_MAX}];`)
          .replace('void main() {',`void main() {
          {bool inDetail=false;
          for(int i=0;i<${BOX_SET_MAX};i++){vec4 b=${name}[i];
            if(vDetailWorld.x>=b.x && vDetailWorld.x<=b.z && vDetailWorld.z>=b.y && vDetailWorld.z<=b.w)inDetail=true;}
          if(${excludeInside ? 'inDetail' : '!inDetail'}) discard;}`);
      };
      material.customProgramCacheKey=()=>cacheKey+`:ownership-v2:${name}:`+excludeInside;
      material.needsUpdate=true;
    }
  });
}
function clipDetailWorld() {
  if(!BUILD_WINDOW)return;
  for(const child of root.children) {
    if(child.name==="kerbside-walker" || child===tileGroupRoot || child.userData.bayWide)continue;
    applyBoxClip(child,detailClipBox);
  }
}
function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }

// ---- the ground -----------------------------------------------------------------------------
//
// TERRAIN is the lidar's ground surface in its recorded frame, which may differ from
// the corridor's middle. Everything that stands on the ground asks it how high the ground is
// there: the merged street surfaces vertex by vertex, a building at the lowest corner of its
// footprint, a tree or a post at its foot, the walker at each step, the camera where it lands.
const TERRAIN_FRAME = TERRAIN ? TERRAIN.meta.frame : null;
// Never assume the payload bounding-box centre equals the survey grid's origin. Convert
// through geographic coordinates, retaining each frame's longitude scale independently.
function pageToTerrain(x, z, f) {
  return [(midLon + x / metersPerLon - f.mid_lon) * f.metres_per_lon,
          (midLat - z / metersPerLat - f.mid_lat) * f.metres_per_lat];
}
function terrainToPage(east, north, f) {
  return [(f.mid_lon + east / f.metres_per_lon - midLon) * metersPerLon,
          -(f.mid_lat + north / f.metres_per_lat - midLat) * metersPerLat];
}
// Visual land/water identity comes from mapped geometry, never from a low height or absent
// lidar return.  The original measured grid remains TERRAIN.data; this app-only companion
// fills unsupported *land* cells for drawing, without exporting them as measurements.
const LANDWATER = TERRAIN_FRAME && VISUAL_SUPPORT && VISUAL_SUPPORT.length === TERRAIN_FRAME.rows * TERRAIN_FRAME.cols
  ? VISUAL_SUPPORT : null;
function mappedWaterAt(x, z) {
  if (!LANDWATER || !TERRAIN_FRAME) return null;
  const f = TERRAIN_FRAME;
  const [east, north] = pageToTerrain(x, z, f);
  const c = Math.floor((east - f.x0) / f.step_m), r = Math.floor((north - f.y0) / f.step_m);
  return r >= 0 && r < f.rows && c >= 0 && c < f.cols ? LANDWATER[r * f.cols + c] === 1 : null;
}
function mappedBuiltAt(x, z) {
  if (!LANDWATER || !TERRAIN_FRAME) return false;
  const f = TERRAIN_FRAME;
  const [east, north] = pageToTerrain(x, z, f);
  const c = Math.floor((east - f.x0) / f.step_m), r = Math.floor((north - f.y0) / f.step_m);
  return r >= 0 && r < f.rows && c >= 0 && c < f.cols && LANDWATER[r * f.cols + c] === 2;
}
//: The next task, as soon as the browser will run one. A timer, except in a hidden page, where a
//: timer is held to once a second (and to once a minute after five): there the next task is a
//: message to itself, which is delivered at once. Every slice of background work that hands the
//: thread back between steps comes back through here -- through a timer, a page left in another
//: tab while it built (or a display that went to sleep) took six minutes over a build of 22 s.
//: (A function: the work that uses it starts before the module's later declarations are reached.)
function nextTask() {
  return new Promise((resolve) => {
    if (!globalThis.document?.hidden || typeof MessageChannel === "undefined") { setTimeout(resolve, 0); return; }
    if (!nextTask.channel) {
      const channel = new MessageChannel(), waiters = [];
      channel.port1.onmessage = () => { const go = waiters.shift(); if (go) go(); };
      if (typeof channel.port1.unref === "function") channel.port1.unref();
      nextTask.channel = { waiters, port: channel.port2 };
    }
    nextTask.channel.waiters.push(resolve);
    nextTask.channel.port.postMessage(0);
  });
}
//: The ground grid's whole-grid passes (the land repaired under missing returns, the water taken
//: a body at a time) run before the build's own pacing is set up, and over a few million cells
//: each: run straight through they were the longest frame of a jump (0.4-0.5 s). They give the
//: frame back every GROUND_PASS_SLICE_MS, checking the clock every 16,384 cells.
const GROUND_PASS_SLICE_MS = 6;
let groundPassAt = performance.now();
function groundPassDue() { return performance.now() - groundPassAt > GROUND_PASS_SLICE_MS; }
async function groundPassYield() { await nextTask(); groundPassAt = performance.now(); }
if (LANDWATER) {
  const f = TERRAIN_FRAME, original = TERRAIN.data, n = original.length;
  const visual = new Int16Array(original);
  const missing = new Uint8Array(n);
  const queue = new Int32Array(n);
  const inferred = [];
  const measuredSurface = TERRAIN.meta.waterline?.surface_m;
  const flattened = measuredSurface == null ? null : Math.round((measuredSurface - f.base_m) * 100);
  let tail = 0;
  groundPassAt = performance.now();
  for (let i = 0; i < n; i += 1) {
    if ((i & 16383) === 0 && groundPassDue()) await groundPassYield();
    if (LANDWATER[i] === 1) continue;
    // A real low-lying shoreline must stay low. Only mapped dry structures repair cells
    // flattened by the older waterline pass; elsewhere, keep the lidar sample as measured.
    if (original[i] === f.nodata || (LANDWATER[i] === 2 && flattened !== null
        && Math.abs(original[i] - flattened) <= 1)) {
      missing[i] = 1;
    } else queue[tail++] = i;
  }
  // Each cell hands its value on to its missing neighbours, left, right, up, down (in that order).
  const take = (i, j) => { visual[j] = visual[i]; missing[j] = 0; inferred.push(j); queue[tail++] = j; };
  for (let head = 0; head < tail; head += 1) {
    if ((head & 16383) === 0 && groundPassDue()) await groundPassYield();
    const i = queue[head], r = Math.floor(i / f.cols), c = i - r * f.cols;
    if (c > 0 && missing[i - 1]) take(i, i - 1);
    if (c + 1 < f.cols && missing[i + 1]) take(i, i + 1);
    if (r > 0 && missing[i - f.cols]) take(i, i - f.cols);
    if (r + 1 < f.rows && missing[i + f.cols]) take(i, i + f.cols);
  }
  const fallback = Math.round(((measuredSurface ?? -0.14) + 1.0 - f.base_m) * 100);
  for (let i = 0; i < n; i += 1) {
    if (!missing[i]) continue;
    visual[i] = fallback;
    inferred.push(i);
  }
  // A few harmonic passes take the blocky nearest-station plateaus out of broad unsurveyed
  // patches. Only inferred values move; every measured centimetre stays untouched.
  for (let pass = 0; pass < 8 && inferred.length; pass += 1) {
    const next = new Int16Array(visual);
    for (let k = 0; k < inferred.length; k += 1) {
      if ((k & 16383) === 0 && groundPassDue()) await groundPassYield();
      const i = inferred[k], r = Math.floor(i / f.cols), c = i - r * f.cols;
      let sum = 0, count = 0;
      if (c > 0 && LANDWATER[i - 1] !== 1) { sum += visual[i - 1]; count += 1; }
      if (c + 1 < f.cols && LANDWATER[i + 1] !== 1) { sum += visual[i + 1]; count += 1; }
      if (r > 0 && LANDWATER[i - f.cols] !== 1) { sum += visual[i - f.cols]; count += 1; }
      if (r + 1 < f.rows && LANDWATER[i + f.cols] !== 1) { sum += visual[i + f.cols]; count += 1; }
      if (count) next[i] = Math.round(sum / count);
    }
    visual.set(next);
  }
  TERRAIN.visualData = visual;
  TERRAIN.visualInferredCount = inferred.length;
}
// ---- water that is not the sea ----------------------------------------------------------------
//
// The map's water is rasterised onto the 2 m grid (VISUAL_SUPPORT) and every water cell was drawn
// as the sea, at the sea's height. A fountain on a plaza or a pond in a park is water at its own
// level and its own shape: a twenty-square-metre fountain came out as a few square cells sunk to
// sea level -- a square hole of blue -- and a lake up a hill as a pit with the sea at its bottom.
// So the grid's water is taken a body at a time (each connected run of water cells): one whose
// shore stands clear of the sea, and which does not run off the grid's edge, is inland water. Its
// cells are its bed, let down under it, and it is drawn flat at the shore's level less a hand --
// to the map's own outline where this page has it, else to the run's outline smoothed between
// cell centres (marching squares), never as a block of squares. The sea is untouched.
//: Three metres: a tidal marsh or a lagoon behind a beach (Crissy Field's stands two metres
//: up at its shore) is the sea's own water and stays the sea.
const INLAND_WATER_MIN_ABOVE_SEA_M = 3.0;
//: The water stands this far under the lowest part of its shore (the 15th percentile, so one low
//: return at a drain does not sink it), and its bed this far under the water.
const INLAND_WATER_BELOW_SHORE_M = 0.12;
const INLAND_WATER_BED_M = 0.6;
//: A body of water this small (cells of 2 m) is a fountain or a garden pool: its water stands at
//: the paving round it, a few centimetres proud, or the plaza drawn over it hides it.
const INLAND_WATER_POOL_CELLS = 40;
//: And a body this small with no outline of its own is drawn as a round basin (water.basin).
const INLAND_WATER_BASIN_CELLS = 12;
const INLAND_BASIN_RIM = { width: 0.3, rise: 0.3, segments: 28 };
const INLAND_WATER = [];
let INLAND_MASK = null;
if (LANDWATER) {
  const f = TERRAIN_FRAME, data = TERRAIN.data, vis = TERRAIN.visualData, cols = f.cols, rows = f.rows;
  const sea = TERRAIN.meta.waterline?.surface_m ?? -0.14;
  const label = new Int32Array(LANDWATER.length).fill(-1);
  const stack = new Int32Array(LANDWATER.length);
  const bodies = [];
  let visited = 0;
  groundPassAt = performance.now();
  for (let start = 0; start < LANDWATER.length; start += 1) {
    if ((start & 16383) === 0 && groundPassDue()) await groundPassYield();
    if (LANDWATER[start] !== 1 || label[start] >= 0) continue;
    const id = bodies.length, cells = [], shore = [];
    let edge = false, top = 0, c0 = cols, c1 = 0, r0 = rows, r1 = 0;
    label[start] = id; stack[top++] = start;
    while (top) {
      if ((++visited & 16383) === 0 && groundPassDue()) await groundPassYield();
      const i = stack[--top], r = Math.floor(i / cols), c = i - r * cols;
      cells.push(i);
      if (c < c0) c0 = c; if (c > c1) c1 = c; if (r < r0) r0 = r; if (r > r1) r1 = r;
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) edge = true;
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (LANDWATER[j] === 1) {
          if (label[j] < 0 && (dr === 0 || dc === 0)) { label[j] = id; stack[top++] = j; }
        } else if (data[j] !== f.nodata) shore.push(f.base_m + data[j] / 100);
      }
    }
    bodies.push({ cells, shore, edge, c0, c1, r0, r1 });
  }
  const cellCentre = (c, r) => terrainToPage(f.x0 + (c + 0.5) * f.step_m, f.y0 + (r + 0.5) * f.step_m, f);
  // The map's own outlines, where this page has them, by the body their middle is in.
  const rings = new Map();
  for (const way of DATA.ways || []) {
    if (way.kind !== "water" || way.coastline_band || !Array.isArray(way.points) || way.points.length < 4) continue;
    const ring = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    let cx = 0, cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    const [east, north] = pageToTerrain(cx / ring.length, cz / ring.length, f);
    const c = Math.floor((east - f.x0) / f.step_m), r = Math.floor((north - f.y0) / f.step_m);
    if (r < 0 || c < 0 || r >= rows || c >= cols || label[r * cols + c] < 0) continue;
    const id = label[r * cols + c];
    if (!rings.has(id)) rings.set(id, []);
    rings.get(id).push(ring);
  }
  for (const [id, body] of bodies.entries()) {
    if (body.edge || body.shore.length < 3) continue;
    body.shore.sort((p, q) => p - q);
    const pool = body.cells.length <= INLAND_WATER_POOL_CELLS;
    const level = pool ? body.shore[Math.floor((body.shore.length - 1) * 0.5)] + 0.03
      : body.shore[Math.floor((body.shore.length - 1) * 0.15)] - INLAND_WATER_BELOW_SHORE_M;
    if (level < sea + INLAND_WATER_MIN_ABOVE_SEA_M) continue;
    INLAND_MASK ??= new Uint8Array(LANDWATER.length);
    const outlines = rings.get(id) || null;
    for (const i of body.cells) {
      const r = Math.floor(i / cols), c = i - r * cols;
      const [x, z] = cellCentre(c, r);
      const under = !outlines || outlines.some((ring) => pointInRing(x, z, ring));
      // Under the water, its bed; a cell the raster put outside the map's outline, its shore.
      INLAND_MASK[i] = under ? 1 : 2;
      vis[i] = Math.round(((under ? level - INLAND_WATER_BED_M : level + INLAND_WATER_BELOW_SHORE_M) - f.base_m) * 100);
    }
    INLAND_WATER.push({ id, level, rings: outlines, body });
  }
  // The water's surface for a body with no outline of its own: the run's cells as a field of 1s
  // and 0s at the cell centres, filled to the 0.5 contour, so its edge runs between centres on
  // the diagonal where the run does -- a round pond comes out round, not as a stair of squares.
  for (const water of INLAND_WATER) {
    if (water.rings) continue;
    // A pool of a few cells is a fountain's basin, and the cells say only where and how big:
    // drawn from them it was a square or a diamond of blue two metres across. It is drawn as an
    // ellipse of the same area along the cells' own spread, in a stone rim (water.basin).
    if (water.body.cells.length <= INLAND_WATER_BASIN_CELLS) {
      const pts = water.body.cells.map((i) => cellCentre(i % cols, Math.floor(i / cols)));
      let mx = 0, mz = 0;
      for (const [x, z] of pts) { mx += x; mz += z; }
      mx /= pts.length; mz /= pts.length;
      let sxx = 0, szz = 0, sxz = 0;
      for (const [x, z] of pts) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
      const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const l1 = (sxx + szz) / 2 + Math.hypot((sxx - szz) / 2, sxz), l2 = (sxx + szz) / 2 - Math.hypot((sxx - szz) / 2, sxz);
      const area = water.body.cells.length * f.step_m * f.step_m;
      const ratio = Math.min(2.5, Math.sqrt((l1 + 1) / (Math.max(0, l2) + 1)));
      const b = Math.sqrt(area / (Math.PI * ratio)), a = b * ratio;
      water.basin = { x: mx, z: mz, a, b, angle };
      continue;
    }
    const { c0, c1, r0, r1 } = water.body;
    const inside = (c, r) => r >= 0 && c >= 0 && r < rows && c < cols && label[r * cols + c] === water.id;
    const tris = [];
    for (let r = r0 - 1; r <= r1; r += 1) for (let c = c0 - 1; c <= c1; c += 1) {
      // The square between four cell centres, corners anticlockwise from (c, r).
      const corner = [[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]];
      const on = corner.map(([cc, rr]) => inside(cc, rr));
      const count = on.filter(Boolean).length;
      if (!count) continue;
      const poly = [];
      for (let k = 0; k < 4; k += 1) {
        const [ca, ra] = corner[k], [cb, rb] = corner[(k + 1) % 4];
        if (on[k]) poly.push([ca, ra]);
        if (on[k] !== on[(k + 1) % 4]) poly.push([(ca + cb) / 2, (ra + rb) / 2]);
      }
      const page = poly.map(([cc, rr]) => terrainToPage(f.x0 + (cc + 0.5) * f.step_m, f.y0 + (rr + 0.5) * f.step_m, f));
      for (let k = 1; k + 1 < page.length; k += 1) tris.push(page[0], page[k], page[k + 1]);
    }
    water.triangles = tris;
  }
}
//: Whether (x, z) is on water: the map's water, or a lake's bed; past the edge of the page's own
//: grid (a park running out of the region over its lake), the nature atlas's water.
function overWaterAt(x, z) {
  const mapped = mappedWaterAt(x, z);
  return mapped === null ? natureWaterAt(x, z) : mapped || inlandWaterAt(x, z) === 1;
}
//: The nature world's water where it is up -- its coastlines decide the bay's edge -- and the
//: atlas's own until then (the first far tiles are built before the nature world is).
function natureWaterAt(x, z) {
  if (typeof NATURE === "undefined" || !NATURE) return false;
  const at = NATURE.local(midLon + x / metersPerLon, midLat - z / metersPerLat);
  return Boolean((typeof natureWorld !== "undefined" && natureWorld?.ground ? natureWorld.ground(...at) : NATURE.sample(...at))?.water);
}
//: 1 inside a body of inland water (its bed), 2 on the grid's overspill round one (its shore),
//: 0 elsewhere.
function inlandWaterAt(x, z) {
  if (!INLAND_MASK) return 0;
  const f = TERRAIN_FRAME;
  const [east, north] = pageToTerrain(x, z, f);
  const c = Math.floor((east - f.x0) / f.step_m), r = Math.floor((north - f.y0) / f.step_m);
  return r >= 0 && r < f.rows && c >= 0 && c < f.cols ? INLAND_MASK[r * f.cols + c] : 0;
}
//: The earth is round, and over a Bay Area it shows. Eight kilometres out the ground is five
//: metres below the plane you are standing on; at forty it is a hundred and twenty-five. Drawn
//: flat, the far shore sat too high, the horizon was a hard line across the sky, and the whole
//: model read as a tabletop -- which is what "the earth seems flat" is.
//:
//: The drop is the sagitta of the earth's own curve, d squared over twice the radius, and it
//: starts at the edge of the region's own grid rather than at the camera: inside the grid it
//: would be a few centimetres of nothing, and a step at the boundary is worse than no curve at
//: all. Written this way it is zero at the edge and matches the real curve well past it.
const EARTH_RADIUS_M = 6371000.0;
function terrainFlatRadius(f) {
  let radius = 0;
  for (const east of [f.x0, f.x0 + f.cols * f.step_m]) {
    for (const north of [f.y0, f.y0 + f.rows * f.step_m]) {
      const [x, z] = terrainToPage(east, north, f);
      radius = Math.max(radius, Math.hypot(x, z));
    }
  }
  return radius;
}
const EARTH_FLAT_M = TERRAIN_FRAME
  ? terrainFlatRadius(TERRAIN_FRAME)
  : 3000.0;
function earthDrop(x, z) {
  // The old flat background used a cosmetic sagitta, but each attached city's own
  // flat frame dropped a different amount. A source-backed continuous orthometric
  // atlas must use one height datum, not introduce metre-scale artificial border steps.
  if ((typeof NATURE!=="undefined"&&NATURE) || (typeof ATTACH!=="undefined"&&ATTACH?.natureBacked)) return 0;
  const d2 = x * x + z * z;
  const flat2 = EARTH_FLAT_M * EARTH_FLAT_M;
  return d2 <= flat2 ? 0 : (d2 - flat2) / (2 * EARTH_RADIUS_M);
}

// ---- the sea ------------------------------------------------------------------------------
//
//: The height of the water's surface, measured: the median of the grid's returns off the water
//: (smc.terrain.waterline writes it into the grid's metadata, and set every cell inside the
//: map's water polygons to it). Ground at or under the surface, plus a margin for the returns'
//: own spread, is water: the backdrop is drawn as sea there, at SEA_Y, and nothing stands on it.
const SEA_SURFACE_M = (TERRAIN && TERRAIN.meta.waterline && TERRAIN.meta.waterline.surface_m !== null
  && TERRAIN.meta.waterline.surface_m !== undefined) ? TERRAIN.meta.waterline.surface_m : -0.14;
//: Ground under this is water. Where the waterline pass set the grid's water cells to the
//: surface (smc.terrain.waterline records how many), the water is exactly at the surface and
//: a hand's breadth covers it; otherwise the returns off the water spread a quarter of a
//: metre either side of the surface and the band is wider. The wide band on a grid whose
//: water was already set flooded the quays of Jack London Square, which stand a metre over
//: the estuary, between the buildings.
const WATERLINE_M = SEA_SURFACE_M + ((TERRAIN && TERRAIN.meta.waterline && TERRAIN.meta.waterline.cells_water) ? 0.06 : 0.45);
//: Where the sea is drawn: a hand above the returns, so that no water-surface return shows
//: through the sea as a grey fleck.
const SEA_Y = SEA_SURFACE_M + 0.12;
//: Over open water with no returns at all -- outside the lidar, the middle of the bay -- the
//: ground is the sea's surface. It stood a low quay's height above it once, so that a pier
//: drawn there stood out of the water, and the open bay inside the grid was drawn as a grey
//: shelf for it; the piers stand on the grid's own ground now (the coastline goes round them),
//: and the open water is water.
const OPEN_WATER_GROUND_M = SEA_SURFACE_M;
//: Where the terrain has no data (outside the lidar, under the bay) the ground is the sea's.
function rawTerrainHeightAt(x, z, natureHeight = null) {
  if(!TERRAIN_FRAME && Number.isFinite(natureHeight))return natureHeight;
  if (!TERRAIN_FRAME) return typeof NATURE !== "undefined" && NATURE
    ? NATURE.sample(...NATURE.local(midLon+x/metersPerLon,midLat-z/metersPerLat))?.height ?? 0 : 0;
  const f = TERRAIN_FRAME;
  const [east, north] = pageToTerrain(x, z, f);
  const fx = (east - f.x0) / f.step_m - 0.5;
  const fy = (north - f.y0) / f.step_m - 0.5;
  const distance = Math.max(0,-fx,-fy,fx-(f.cols-1),fy-(f.rows-1))*f.step_m;
  const nature = distance>0 && typeof NATURE!=="undefined" && NATURE
    ? Number.isFinite(natureHeight) ? {height:natureHeight}
      : NATURE.sample(...NATURE.local(midLon+x/metersPerLon,midLat-z/metersPerLat)) : null;
  // A distant query must not inherit sea level from a clamped, missing city-edge cell.
  // With no canonical edge evidence there is nothing legitimate to blend against.
  if(distance>=120 && nature)return nature.height;
  const c0 = Math.max(0, Math.min(f.cols - 2, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(f.rows - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - r0));
  const d = TERRAIN.visualData || TERRAIN.data;
  const at = (r, c) => d[r * f.cols + c];
  const v00 = at(r0, c0), v10 = at(r0, c0 + 1), v01 = at(r0 + 1, c0), v11 = at(r0 + 1, c0 + 1);
  // A no-data corner takes the value of a corner that has data; four no-data corners is
  // outside the surveyed ground.
  const vals = [v00, v10, v01, v11];
  const good = vals.filter((v) => v !== f.nodata);
  if (!good.length) return nature?.height ?? OPEN_WATER_GROUND_M;
  const fill = good[0];
  const g = vals.map((v) => (v === f.nodata ? fill : v));
  const cm = g[0] * (1 - tx) * (1 - ty) + g[1] * tx * (1 - ty) + g[2] * (1 - tx) * ty + g[3] * tx * ty;
  const localHeight = f.base_m + cm / 100.0;
  // Preserve city measurements; join the atlas outside them, not a flat edge plateau.
  // This is the city's hottest geometry query. Do not allocate atlas samples for every
  // measured curb/terrain vertex: the nature atlas is irrelevant inside the survey grid.
  if (distance===0 || typeof NATURE==="undefined" || !NATURE) return localHeight;
  if(!nature)return localHeight;
  const t = Math.min(1,distance/120), smooth=t*t*(3-2*t);
  return localHeight*(1-smooth)+nature.height*smooth;
}
function terrainHeightAt(x, z) {
  if (mappedWaterAt(x, z) === true) return streetOverWaterAt(x, z) ?? OPEN_WATER_GROUND_M;
  if (inlandWaterAt(x, z) === 1) return streetOverWaterAt(x, z) ?? rawTerrainHeightAt(x, z);
  return rawTerrainHeightAt(x, z);
}
//: The map's water is rasterised on the 2 m grid, and a street along a shore crosses cells the
//: raster calls water: there the ground was the water's (the sea's surface, or a lake's bed let
//: down under it), and the street dipped into the lake for a cell or two and came back out --
//: "roads cutting in and out with segments in lakes" round Lake Merritt. A street (with its
//: pavements) on a wet cell within STREET_SHORE_REACH_CELLS of dry ground stands on that
//: ground's height instead; one further out over open water is a bridge, on its own deck.
//: (A var, set once the streets are in the carriageway grid: the terrain is asked long
//: before that grid is declared, and until then there is no street to stand on the shore.)
var STREETS_GRIDDED = false;
const STREET_SHORE_REACH_CELLS = 3, STREET_OVER_WATER_SLACK_M = 4.5;
function streetOverWaterAt(x, z) {
  if (!STREETS_GRIDDED || !TERRAIN_FRAME || !insideCarriageway(x, z, STREET_OVER_WATER_SLACK_M)) return null;
  return nearestDryHeightAt(x, z, STREET_SHORE_REACH_CELLS);
}
//: The height of the nearest grid cell that is neither the map's water nor a lake's bed, within
//: ``reach`` cells of (x, z), or null.
function nearestDryHeightAt(x, z, reach) {
  const f = TERRAIN_FRAME, d = TERRAIN.visualData || TERRAIN.data;
  if (!f || !d || !LANDWATER) return null;
  const [east, north] = pageToTerrain(x, z, f);
  const c = Math.floor((east - f.x0) / f.step_m), r = Math.floor((north - f.y0) / f.step_m);
  for (let ring = 1; ring <= reach; ring += 1) {
    let best = null, bestD = Infinity;
    for (let dr = -ring; dr <= ring; dr += 1) for (let dc = -ring; dc <= ring; dc += 1) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= f.rows || cc >= f.cols) continue;
      const i = rr * f.cols + cc;
      if (LANDWATER[i] === 1 || (INLAND_MASK && INLAND_MASK[i] === 1) || d[i] === f.nodata) continue;
      const dist = dr * dr + dc * dc;
      if (dist < bestD) { bestD = dist; best = f.base_m + d[i] / 100; }
    }
    if (best !== null) return best;
  }
  return null;
}
//: The ground's height at a point: what everything at ground level is lifted by. The terrain
//: grid, except in the open cut outside a tunnel mouth: under a street decked over the portal
//: (Bush Street over the Stockton Tunnel's south mouth) the grid has no ground returns and was
//: filled from the hill either side, so the road there would climb seven metres onto the deck
//: in its last few metres. The cut's road is the line from the level the lidar fitted at the
//: mouth (tunnel_approach_road_z) to the grid's own level at the cut's far end, and the ground
//: in the cut is never above it.
const APPROACH_CUT_MARGIN_M = 4.0;
//: The cut is corrected this far out from the mouth at least: the grid's fill under a deck
//: reaches a few metres past the deck's edge, and the street outside may be another way.
const APPROACH_CUT_REACH_M = 40.0;
const APPROACH_CUT_INSIDE_M = 6.0;
const APPROACH_CUTS = (DATA.ways || []).flatMap((way) => {
  if (!way.tunnel_approach || way.tunnel_approach_road_z === undefined || !TERRAIN_FRAME) return [];
  const pts = (way.points || []).map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  if (pts.length < 2) return [];
  // The mouth is the end of the piece that meets the bore: the end of a "start" approach,
  // the start of an "end" one. The cut runs straight out from it.
  const [mx, mz] = way.tunnel_approach === "start" ? pts[pts.length - 1] : pts[0];
  const [ox, oz] = way.tunnel_approach === "start" ? pts[0] : pts[pts.length - 1];
  const away = Math.hypot(ox - mx, oz - mz);
  if (!(away > 0.5)) return [];
  const ux = (ox - mx) / away, uz = (oz - mz) / away;
  const reach = Math.max(away, APPROACH_CUT_REACH_M);
  const mouthZ = way.tunnel_approach_road_z;
  const farZ = terrainHeightAt(mx + ux * reach, mz + uz * reach);
  return [{ mx, mz, ux, uz, reach, mouthZ, farZ, half: (way.road_m || 12) / 2 + APPROACH_CUT_MARGIN_M,
            way }];
});
//: The retaining wall either side of a cut is drawn as a block this thick, its top at the
//: ground outside: the terrain is lowered under it too, so the hill's slope down to the road
//: lies behind the wall rather than in front of it.
const CUT_WALL_T_M = 4.5;
//: How steep a road outside a mouth may climb to meet the ground (a cut is ended there).
const CUT_ROAD_GRADE = 0.09;
// Every road tunnel's mouth has its cut, whether or not the map drew an approach piece for it:
// the Stockton Tunnel's north mouth had none, and the hill ran down over its road.
for (const way of (TERRAIN_FRAME ? DATA.ways || [] : [])) {
  if (way.tunnel_kind !== "road" || !way.points || way.points.length < 2) continue;
  const pts = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  for (const end of ["start", "end"]) {
    // SF has measured mouth levels; other regions still need a continuous
    // approach, using the same explicitly inferred endpoint as their bore floor.
    const mouth = way.tunnel_mouths?.[end] || (end === "start" ? way.points[0] : way.points[way.points.length-1]);
    const at = end === "start" ? pts[0] : pts[pts.length-1];
    const mouthZ = way.tunnel_road_z?.[end] ?? terrainHeightAt(...at);
    if (!mouth || mouthZ === undefined) continue;
    const [x, y] = xy(mouth[0], mouth[1]);
    const mx = x, mz = -y;
    if (APPROACH_CUTS.some((c) => Math.hypot(c.mx - mx, c.mz - mz) < 15)) continue;
    // The local tangent matters: a curved tube's far end is not its approach direction.
    const far = end === "start" ? pts[1] : pts[pts.length-2];
    let ux = mx - far[0], uz = mz - far[1];
    const len = Math.hypot(ux, uz);
    if (!(len > 1)) continue;
    ux /= len; uz /= len;
    // Out to where the ground comes down to a road that has climbed from the mouth at no more
    // than a street's grade.
    const inferredLevel=!way.tunnel_road_z;
    let reach = inferredLevel ? 200 : 60;
    // A single low terrain sample six metres outside an unmeasured mouth is
    // not the end of its approach. Carry the grade at least through the local
    // road window, then meet the terrain without an abrupt step at its end.
    for (let r = inferredLevel ? APPROACH_CUT_REACH_M : 6; r <= (inferredLevel ? 200 : 60); r += 2) {
      const delta=terrainHeightAt(mx + ux * r, mz + uz * r)-mouthZ;
      if ((inferredLevel ? Math.abs(delta) : delta) <= CUT_ROAD_GRADE * r + (inferredLevel ? 0 : .4)) {
        reach = inferredLevel ? r : Math.max(10, r + 4);break;
      }
    }
    const rawFar=terrainHeightAt(mx + ux * reach, mz + uz * reach);
    const farZ = Math.max(inferredLevel ? mouthZ-CUT_ROAD_GRADE*reach : -Infinity,
      Math.min(rawFar,mouthZ+CUT_ROAD_GRADE*reach));
    APPROACH_CUTS.push({ mx, mz, ux, uz, reach, mouthZ, farZ,
      half: (way.road_m || 12) / 2 + APPROACH_CUT_MARGIN_M, way, synthesised: true,
      levelBasis:way.tunnel_road_z ? "measured_mouth" : "inferred_terrain_endpoint" });
  }
}
// Every cut runs straight out along its own tunnel's line from that tunnel's mouth. A cut taken
// from its approach piece pointed wherever the piece's far end lay -- Broadway's west approach
// bends -- and its walls ran across the road at an angle to the headwall.
for (const cut of APPROACH_CUTS) {
  if (cut.synthesised) continue;
  let best = null;
  for (const way of DATA.ways || []) {
    if (way.tunnel_kind !== "road" || !way.tunnel_mouths || !way.points || way.points.length < 2) continue;
    const pts = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
    for (const end of ["start", "end"]) {
      const m = way.tunnel_mouths[end];
      if (!m) continue;
      const [x, y] = xy(m[0], m[1]);
      const d = Math.hypot(x - cut.mx, -y - cut.mz);
      if (d < 15 && (!best || d < best.d)) {
        const far = end === "start" ? pts[pts.length - 1] : pts[0];
        best = { d, mx: x, mz: -y, far };
      }
    }
  }
  if (!best) continue;
  let ux = best.mx - best.far[0], uz = best.mz - best.far[1];
  const len = Math.hypot(ux, uz);
  if (!(len > 1)) continue;
  cut.mx = best.mx; cut.mz = best.mz; cut.ux = ux / len; cut.uz = uz / len;
  cut.farZ = terrainHeightAt(cut.mx + cut.ux * cut.reach, cut.mz + cut.uz * cut.reach);
}
// A street carried over the mouth on a deck (Bush Street over the Stockton Tunnel's south mouth)
// stands on the deck; the first metres outside a mouth with no such street are the cut's road.
// ``deck`` is how far out from the mouth a crossing street's deck reaches; zero where none does.
for (const cut of APPROACH_CUTS) {
  let deck = 0, overhead = false;
  for (const way of DATA.ways || []) {
    if (way.kind !== "street" || way === cut.way || way.tunnel || way.tunnel_approach || !way.points) continue;
    const pts = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const l = Math.hypot(bx - ax, bz - az);
      if (!(l > 0.5)) continue;
      if (Math.abs(((bx - ax) * cut.ux + (bz - az) * cut.uz) / l) > 0.6) continue;     // runs along the cut
      const samples = Math.max(2, Math.ceil(l / 2));
      for (let q = 0; q <= samples; q += 1) {
        const t = q / samples;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const along = (x - cut.mx) * cut.ux + (z - cut.mz) * cut.uz;
        const off = Math.abs((x - cut.mx) * cut.uz - (z - cut.mz) * cut.ux);
        if (along < -APPROACH_CUT_INSIDE_M - 2 || along > 14 || off > cut.half + 6) continue;
        // A street across the cut whose road is up at the hill, not down in the cut.
        if (terrainHeightAt(x, z) < cut.mouthZ + 2) continue;
        overhead = true;
        deck = Math.max(deck, Math.min(14, along + (way.road_m || 10) / 2));
      }
    }
  }
  // Where no street passes over the mouth there is one ground there, the cut's road, from a
  // few metres inside the mouth out: the approach's own pieces run into the mouth, and given
  // the hill's height there by one rule and the road's by another, the terrain fitting that
  // subdivides them afterwards stretched them into ramps up the headwall.
  cut.deck = overhead ? Math.max(0, deck) : -APPROACH_CUT_INSIDE_M;
}
//: The cut's road level at a point inside a cut, else null. ``outsideOnly`` leaves out the
//: metres under and beside the deck's edge, where a point has two heights.
function approachRoadAt(x, z, outsideOnly = false) {
  for (const cut of APPROACH_CUTS) {
    const dx = x - cut.mx, dz = z - cut.mz;
    const along = dx * cut.ux + dz * cut.uz;
    // A few metres into the bore as well: the approach's own geometry runs a little past
    // the mouth, and under the deck there is nothing else at ground level.
    if (along < (outsideOnly ? cut.deck : -APPROACH_CUT_INSIDE_M) || along > cut.reach + 0.5) continue;
    if (Math.abs(dx * cut.uz - dz * cut.ux) > cut.half) continue;
    const t = Math.max(0, Math.min(1, along / cut.reach));
    return cut.mouthZ + (cut.farZ - cut.mouthZ) * t;
  }
  return null;
}
function inferredApproachLevelAt(x,z,outsideOnly=false) {
  for(const cut of APPROACH_CUTS) {
    const dx=x-cut.mx,dz=z-cut.mz,along=dx*cut.ux+dz*cut.uz;
    if(along<(outsideOnly ? cut.deck : -APPROACH_CUT_INSIDE_M) || along>cut.reach+.5
        || Math.abs(dx*cut.uz-dz*cut.ux)>cut.half)continue;
    // A measured cut remains measurement-led. Only an unmeasured engineered
    // approach uses a graded visual road rather than the noisy terrain below it.
    return cut.levelBasis==="inferred_terrain_endpoint" ? cutRoadAt(cut,along) : null;
  }
  return null;
}
//: The ground everything is lifted by: the grid, and outside a tunnel mouth never above the
//: cut's road line -- the grid there is filled from the hill either side, and a cross street
//: lifted onto that fill met the approach road, lifted onto the cut, a metre or two up at the
//: junction: the crossing paint, settled onto the highest road under each vertex, crumpled
//: between the two (Sutter at the Stockton tunnel). Under the deck inside the mouth a point
//: has two heights, the deck's and the road's, and only what runs through the cut (WAY_LIFT,
//: cutLiftAt) takes the road's; everything else there stands on the deck.
function groundLiftAt(x, z) {
  if (typeof guestUnder === "function" && activeGuest) {
    const guest = guestUnder(x, z);
    if (guest) { const [gx, gz] = hostToGuest(guest, x, z); return guest.api.groundLiftAt(gx, gz) + guest.oy; }
  }
  const ground = terrainHeightAt(x, z);
  const inferred=typeof inferredApproachLevelAt === "function" ? inferredApproachLevelAt(x,z,true) : null;
  if(inferred!==null)return inferred;
  const road = approachRoadAt(x, z, true);
  return road === null ? ground : Math.min(ground, road);
}
//: The ground for what runs *through* the cut -- the approach road, its kerbs and pavements,
//: the street that carries on out of it, a post beside it: the grid, but never above the
//: cut's road line. One point under a deck has two heights, the deck's and the road's; which
//: one a vertex takes is decided by the way it belongs to (WAY_LIFT), not by where it is.
function cutLiftAt(x, z) {
  const inferred=typeof inferredApproachLevelAt === "function" ? inferredApproachLevelAt(x,z) : null;
  if(inferred!==null)return inferred;
  const ground = terrainHeightAt(x, z);
  const road = approachRoadAt(x, z);
  return road === null ? ground : Math.min(ground, road);
}
function cutRibbonLiftAt(x,z,outsideOnly=false) {
  // Only geometry belonging to an approach way uses this profile. Its wide
  // sidewalk underlay must share the road plane, rather than sampling the top
  // of the retaining wall at its outer vertices and forming concrete teeth.
  // This does NOT widen the excavated terrain or the walkable lower corridor.
  const ground=outsideOnly ? groundLiftAt(x,z) : terrainHeightAt(x,z);
  const margin=typeof PROPERTY_LINE_PAVEMENT_WIDTH_M === 'number' ? PROPERTY_LINE_PAVEMENT_WIDTH_M : 8.6;
  for(const cut of APPROACH_CUTS) {
    const dx=x-cut.mx,dz=z-cut.mz,along=dx*cut.ux+dz*cut.uz;
    if(along < (outsideOnly ? cut.deck : -APPROACH_CUT_INSIDE_M) || along>cut.reach+.5
        || Math.abs(dx*cut.uz-dz*cut.ux)>cut.half+margin)continue;
    const road=cutRoadAt(cut,along);
    const level=cut.levelBasis==='inferred_terrain_endpoint' ? road : Math.min(ground,road);
    // Outside the actual cut, return gradually to the property surface. A
    // hard outer width cutoff merely moved the same concrete teeth sideways.
    const t=Math.max(0,Math.min(1,(Math.abs(dx*cut.uz-dz*cut.ux)-cut.half)/margin));
    return level+(ground-level)*t*t*(3-2*t);
  }
  return ground;
}
cutRibbonLiftAt.groundLiftKey='cut-road-ribbon';
function pavementLiftAt(x,z) { return cutRibbonLiftAt(x,z,true); }
//: The ground the terrain itself is drawn at. In the cut, from the mouth out, it is the cut's
//: road -- under the retaining walls too, so the hill comes down behind them and not in front
//: of them. Behind the mouth it is the hill, untouched: the headwall stands against it. (It
//: used to be lowered six metres into the hill as well, which left a pit over the bore.)
function trenchGroundAt(x, z) {
  const ground = terrainHeightAt(x, z);
  for (const cut of APPROACH_CUTS) {
    const dx = x - cut.mx, dz = z - cut.mz;
    const along = dx * cut.ux + dz * cut.uz;
    // From just behind the headwall's face (which hides it): the grid runs at an angle to
    // the cut, and a cell in front of the mouth whose far corner was on the hill stood up
    // in the arch.
    if (along < -1.5 || along > cut.reach + 0.5) continue;
    if (Math.abs(dx * cut.uz - dz * cut.ux) > cut.half + CUT_WALL_T_M) continue;
    const road = cut.mouthZ + (cut.farZ - cut.mouthZ) * Math.max(0, Math.min(1, along / cut.reach));
    return cut.levelBasis==="inferred_terrain_endpoint" ? road : Math.min(ground, road);
  }
  return ground;
}
//: Does this way run along a cut rather than over it? The approach pieces do; so does the
//: street that continues out of the cut, whose bearing inside the strip is the cut's.
const CUT_ALONG_COS = Math.cos(35 * Math.PI / 180);
function wayFollowsCut(way) {
  if (!APPROACH_CUTS.length || !way.points || way.points.length < 2) return false;
  if (way.tunnel_approach && way.tunnel_approach_road_z !== undefined) return true;
  const pts = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0)) continue;
    const bx_ = (bx - ax) / len, bz_ = (bz - az) / len;
    for (const cut of APPROACH_CUTS) {
      if (Math.abs(bx_ * cut.ux + bz_ * cut.uz) < CUT_ALONG_COS) continue;
      for (const [x, z] of [[ax, az], [bx, bz], [(ax + bx) / 2, (az + bz) / 2]]) {
        const dx = x - cut.mx, dz = z - cut.mz;
        const along = dx * cut.ux + dz * cut.uz;
        if (along >= -0.5 && along <= cut.reach + 0.5 && Math.abs(dx * cut.uz - dz * cut.ux) <= cut.half) return true;
      }
    }
  }
  return false;
}
//: The lift the way being built wants for its vertices, when it is not the plain ground.
//: addMerged applies the difference from the ground now; liftOntoGround adds the ground later.
let WAY_LIFT = null;
//: A crossing is one flat piece of paint between two kerbs: it stands on the line between
//: the ground at its two ends, not on the grid under its middle -- over a portal that grid is
//: the cut's road eight metres down, and the crossing over the deck fell into it.
function lineLiftFor(points) {
  const [ax, ay] = xy(points[0][0], points[0][1]);
  const [bx, by] = xy(points[points.length - 1][0], points[points.length - 1][1]);
  const az = -ay, bz = -by;
  const ha = groundLiftAt(ax, az), hb = groundLiftAt(bx, bz);
  const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
  return (x, z) => {
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2)) : 0;
    return ha + (hb - ha) * t;
  };
}
//: A building stands on the lowest ground under its footprint, so no corner floats.
function groundBaseFor(points) {
  if (!TERRAIN_FRAME || !points || !points.length) return 0;
  let low = Infinity;
  for (const p of points) {
    const [x, y] = xy(p[0], p[1]);
    low = Math.min(low, terrainHeightAt(x, -y));
  }
  return Number.isFinite(low) ? low : 0;
}
//: How far the ground a building's height was measured from stands above the ground it is
//: drawn from. The lidar height is the roof over the median ground return in the footprint's
//: box and four metres round it (smc.lidar.region.building_height), and the building is drawn
//: up from the lowest corner so that no corner floats. On a slope the two differ, and drawn
//: from the low corner with the measured height the roof came out short by the difference:
//: the Oxford Research Unit at Walnut and Delaware, on five metres of fall, stood with its
//: roof under the uphill pavement and looked buried. Sampled the way the measure is, on a grid
//: over the same box, the median of the terrain there; capped, so a bad terrain cell cannot
//: stand a house on stilts.
var BUILDING_FOOT_PAD_M = 4, BUILDING_RISE_MAX_M = 12, BUILDING_FOOT_SAMPLES = 400;
function groundRiseFor(points, low = groundBaseFor(points)) {
  if (!TERRAIN_FRAME || !points || points.length < 3) return 0;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) {
    const [x, y] = xy(p[0], p[1]);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, -y); z1 = Math.max(z1, -y);
  }
  x0 -= BUILDING_FOOT_PAD_M; x1 += BUILDING_FOOT_PAD_M; z0 -= BUILDING_FOOT_PAD_M; z1 += BUILDING_FOOT_PAD_M;
  const step = Math.max(2, Math.sqrt((x1 - x0) * (z1 - z0) / BUILDING_FOOT_SAMPLES));
  const heights = [];
  for (let x = x0; x <= x1 + 1e-6; x += step)
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const h = terrainHeightAt(x, z);
      if (Number.isFinite(h)) heights.push(h);
    }
  if (!heights.length || !Number.isFinite(low)) return 0;
  heights.sort((a, b) => a - b);
  const median = heights[heights.length >> 1];
  return Math.max(0, Math.min(BUILDING_RISE_MAX_M, median - low));
}
//: The build hands the browser a frame every so often. Without that the whole corridor was one
//: synchronous run of half a minute or more, which on a phone is "Page unresponsive" and a
//: kill; with it the same work takes a little longer and shows its progress.
//: How long the build may hold the thread before it hands a frame back. Long enough that
//: the yields themselves cost little (a frame is sixteen milliseconds), short enough that the
//: page scrolls and the progress reads.
//: How long the build may hold the thread before it hands a frame back, and how long it then
//: rests: from the quality preset.
let YIELD_BUDGET_MS = QUALITY().budgetMs;
let lastYieldAt = performance.now();
function yieldFrame(progress) {
  const box = document.getElementById("progress");
  if (box && progress !== undefined) { box.textContent = progress; box.hidden = false; }
  lastYieldAt = performance.now();
  // A frame when the browser gives one; a timer when it does not. In a hidden tab neither is
  // any good -- requestAnimationFrame never fires and a timer is held to once a second, which
  // made a build of five hundred yields a build of eight minutes for anyone who opened the
  // page and looked at another tab -- so there the yield is a message to itself, which the
  // browser delivers at once and which still lets the event loop turn.
  return new Promise((resolve) => {
    let settled = false;
    // The slice is timed from when the build resumes, not from when it stopped. Timed from the
    // stop, a wait longer than the budget -- every wait, while a detail square is built behind
    // a city being drawn (about sixty milliseconds each) -- had used the next slice up before
    // it began, and the build did one step a frame: 88% of a square's sixteen seconds waiting.
    const go = () => { if (!settled) { settled = true; lastYieldAt = performance.now(); resolve(); } };
    if (typeof document !== "undefined" && document.hidden) { yieldWaiters.push(go); yieldChannel.port2.postMessage(0); return; }
    // One window's slice a frame. Every window -- this page's and each square attached to it --
    // builds with its own budget, and two squares building at once took a slice each between
    // the same two frames: twice the budget, and the walk stuttered while both were going
    // (measured 2026-11-05). A window that finds another has had this frame waits for the next.
    const turn = globalThis.__kerbsideBuildTurn || (globalThis.__kerbsideBuildTurn = { at: -1e9, owner: null, frame: -1 });
    const take = () => {
      if (settled) return;
      const t = performance.now(), frames = globalThis.__kerbsideFrames ?? -1;
      if (viewMoving() && turn.owner !== BUILD_OWNER && turn.frame === frames && t - turn.at < BUILD_TURN_WAIT_MS) {
        setTimeout(take, 8);
        return;
      }
      turn.at = t; turn.owner = BUILD_OWNER; turn.frame = frames;
      go();
    };
    // The rest: the build gives the machine this long between slices of work.
    // A frame when one comes, but never waiting on one: a browser on battery, or a tab it has
    // decided is in the background, stops handing out frames, and a build that waited fifty
    // milliseconds for each of thousands of yields then took the better part of an hour.
    const rest = QUALITY().restMs;
    requestAnimationFrame(() => setTimeout(take, rest));
    setTimeout(take, rest + 8);
  });
}
//: This window, as the owner of a build slice (see yieldFrame).
const BUILD_OWNER = {};
//: How long a window waits for a frame to be drawn before it builds anyway: a page that draws no
//: frames (one being exported, a browser holding them back) must still finish its build.
const BUILD_TURN_WAIT_MS = 120;
//: While the view moves -- a walk, a drag, a jump on its way -- the build takes a short slice, so
//: a frame with a slice in it is still a frame of a walk rather than a stumble. At rest it takes
//: the preset's full budget again.
const MOVING_SLICE_MS = 8;
const MOVING_HOLD_MS = 800;
function viewMoving() { return performance.now() - (globalThis.__kerbsideMovedAt || -1e9) < MOVING_HOLD_MS; }
function sliceBudget() { return viewMoving() ? Math.min(YIELD_BUDGET_MS, MOVING_SLICE_MS) : YIELD_BUDGET_MS; }
const yieldChannel = new MessageChannel();
const yieldWaiters = [];
yieldChannel.port1.onmessage = () => { const go = yieldWaiters.shift(); if (go) go(); };
// An open port keeps Node's event loop alive, and the page smoke test runs this page in Node.
if (typeof yieldChannel.port1.unref === "function") yieldChannel.port1.unref();
//: Yield only when the budget is spent: the caller can ask on every iteration.
function maybeYield(progress) {
  if (performance.now() - lastYieldAt < sliceBudget()) return null;
  return yieldFrame(progress);
}
//: The lift of the building being built. Its walls are lifted in their own geometry; the
//: detail hung on them -- shopfronts, awnings, signs, roof furniture, the merged parts -- is
//: written in world coordinates from a ground of zero, and takes this so it stays on the
//: building it belongs to rather than at sea level inside the hill.
let BUILDING_LIFT_M = 0;
function v3(lon, lat, z = 0) { const [x, y] = xy(lon, lat); return new THREE.Vector3(x, z, -y); }

