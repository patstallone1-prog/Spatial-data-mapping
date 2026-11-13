// ---- the living city: people, traffic, money and law (docs/city/) ------------------------------
//
// Kerbside V2 in the page: the district's thousand people keeping their own days on its streets,
// its traffic, and you with a wallet, a room, a job, a car and the bills that follow -- tolls at
// the bridges' gantries, carpool and express lanes, speed cameras, parking, taxes -- on one set of
// books held by your party's host (docs/multiplayer.mjs carries it). docs/city/view.mjs does all
// of it; this part hands it what it needs of the page, as the multiplayer part does. Not on the
// headset or in a region drawn inside another's page.

//: Whether (x, z) is water by the map: in a region drawn inside this page, that region's own water
//: map (none there, and nothing is called water); here, this page's, and past its grid the Bay's
//: outline.
function waterMaskAt(x, z) {
  const guest = typeof guestUnder === "function" ? guestUnder(x, z) : null;
  if (guest?.ready) {
    if (!guest.api.mappedWaterAt) return null;
    const [gx, gz] = hostToGuest(guest, x, z);
    return guest.api.mappedWaterAt(gx, gz);
  }
  let wet = typeof mappedWaterAt === "function" ? mappedWaterAt(x, z) : null;
  if (wet === null && typeof perimeterWaterAt === "function" && outsideTerrainGrid(x, z)) wet = perimeterWaterAt(x, z);
  return wet;
}
//: A body of water the map closes in at (x, z) -- a pond, a lake, a fountain's basin -- in this
//: page's own world: {inland, basin}.
function cityInlandAt(x, z) {
  if (typeof INLAND_MASK === "undefined" || !INLAND_MASK || !TERRAIN_FRAME) return { inland: false, basin: false };
  const f = TERRAIN_FRAME, [east, north] = pageToTerrain(x, z, f);
  const c = Math.floor((east - f.x0) / f.step_m), r = Math.floor((north - f.y0) / f.step_m);
  if (r < 0 || c < 0 || r >= f.rows || c >= f.cols || !INLAND_MASK[r * f.cols + c]) return { inland: false, basin: false };
  const body = INLAND_WATER.find((w) => w.body.cells.includes(r * f.cols + c));
  return { inland: true, basin: Boolean(body && body.body.cells.length <= INLAND_WATER_BASIN_CELLS) };
}
//: The water at (x, z), if any, and which water it is: a fountain's basin or a pond the map
//: closes in, the Bay, the ocean, an estuary -- told apart by where it is (docs/city/rules.json).
function cityWaterAt(x, z) {
  if (typeof livingCity === "undefined" || !livingCity?.rules || waterMaskAt(x, z) !== true) return null;
  const guest = typeof guestUnder === "function" ? guestUnder(x, z) : null;
  const inland = guest?.ready ? (guest.api.cityInlandAt ? guest.api.cityInlandAt(...hostToGuest(guest, x, z)) : { inland: false, basin: false }) : cityInlandAt(x, z);
  const lon = midLon + x / metersPerLon, lat = midLat - z / metersPerLat;
  const cls = livingCity.classifyWater({ lon, lat, ...inland });
  return livingCity.water(cls, { lon, lat });
}
//: Whether the walker would stand on open water at (x, z): on the water's surface, not a deck,
//: a pier or a floor over it. Nobody walks on water.
function walkerOnWater(x, z, feet) {
  if (waterMaskAt(x, z) !== true) return false;
  return walkerGroundInfo(x, z, feet).kind === "terrain";
}

var livingCity = null;
// ---- City mode's own area: the Marina, loaded once ---------------------------------------------
//
// City mode is played in one place: the Marina (Chestnut, Union and Lombard Streets, the Marina
// Green and the Palace of Fine Arts). Switched to, it is built once, in full, behind a loading
// screen -- the square round you and the rest of the area with it -- and then nothing is
// streamed: the detail window is not rebuilt as you walk, the memory watch does not build it
// again smaller, and the view (held near the street, CITY_MAX_ORBIT_M) sees no further than a
// few blocks. The walker and the car stop at its edge. Explore streams the map as before.
const CITY_AREA = {
  name: "the Marina",
  // [south, west, north, east]: Greenwich to the water, Lyon to Laguna -- Lombard, Chestnut, the
  // Marina's blocks and the whole of its two parks, the Marina Green and Moscone (1.6 km²). It
  // stopped at Webster and short of the water once (1.2 km²), and the edge ran through both
  // parks: half a park in full and half the simple city's lawn, the houses past it plain.
  bbox: [37.7983, -122.4478, 37.8082, -122.4310],
  // Where you start if you were elsewhere: Chestnut and Fillmore.
  start: [-122.4363, 37.8008],
  // The view's reach: the far plane and the haze.
  farM: 1600, fogNear: 450, fogFar: 1500,
  // The world's cells kept while the area is held (it is built; nothing more is fetched).
  cellBytes: 32 * 1048576,
};
//: null in Explore; in City: {ready, requested, placed}.
var cityLock = null;
function cityAreaBoxXZ() {
  const [s, w, n, e] = CITY_AREA.bbox, [x0, y0] = xy(w, s), [x1, y1] = xy(e, n);
  return [x0, -y1, x1, -y0];
}
//: Whether (x, z) is in City mode's area (always, in Explore).
function cityAreaHolds(x, z) {
  if (!cityLock) return true;
  const [x0, z0, x1, z1] = cityLock.box;
  return x >= x0 && x <= x1 && z >= z0 && z <= z1;
}
const cityLoading = document.createElement("div");
cityLoading.id = "city-loading";
cityLoading.hidden = true;
cityLoading.setAttribute("role", "status");
cityLoading.style.cssText = "position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;"
  + "background:rgba(17,24,39,.82);color:#fff;font:600 18px/1.4 system-ui,sans-serif;text-align:center;padding:24px";
cityLoading.innerHTML = `<div>Loading ${CITY_AREA.name}…</div><div id="city-loading-step" style="font-weight:400;font-size:13px;opacity:.8"></div>`;
document.body.appendChild(cityLoading);
const cityLoadingCss = document.createElement("style");
cityLoadingCss.textContent = "#city-loading[hidden]{display:none!important}";
document.head.appendChild(cityLoadingCss);
//: Into City mode: the walker into the area, the area built once, the streaming held.
function enterCityArea() {
  if (META || ATTACH) return;
  cityLock = { ready: false, requested: 0, placed: false, box: cityAreaBoxXZ() };
  cityLoading.hidden = false;
  cityAreaStep();
}
function leaveCityArea() {
  const held = Boolean(cityLock);
  cityLock = null;
  if (held) worldCellCache.maxBytes = typeof desktopMemory !== "undefined" ? desktopMemory.cellBytes : STREAM.cellBytes;
  cityLoading.hidden = true;
  fitViewToAltitude();
}
//: Watched a few times a second until the area is up: asked for once the streets can be built,
//: asked again after a failure, shown when it is ready.
function cityAreaStep() {
  if (!cityLock || cityLock.ready) return;
  const step = document.getElementById("city-loading-step");
  const [lon, lat] = CITY_AREA.start;
  const [s, w, n, e] = CITY_AREA.bbox;
  const built = activeGuest?.ready && activeGuest.stripKey === "city";
  if (built) {
    cityLock.ready = true;
    cityLoading.hidden = true;
    // Nothing more is streamed while the area is held: the cells it was built from go down to a
    // little, and the simple city's tiles under it (hidden there) are let go.
    worldCellCache.maxBytes = CITY_AREA.cellBytes;
    worldCellCache.evict();
    evictTilesHeldByCity();
    if (!cityLock.placed) cityPlaceWalker();
    console.info(`kerbside: ${CITY_AREA.name} loaded for City mode in ${activeGuest.buildSeconds?.toFixed(1)} s`);
    requestFrame();
    return;
  }
  if (step) step.textContent = attaching?.progress?.textContent || (regionStreamingReady ? "Fetching the streets" : "Starting the map");
  const now = performance.now();
  if (regionStreamingReady && !attaching && now >= detailRetryAt && now - cityLock.requested > 3000) {
    // The walker into the area first, so the build and the view are where you will be.
    if (!cityLock.placed && !cityAreaHolds(avatar.position.x, avatar.position.z)) cityPlaceWalker();
    const region = regionAt(lon, lat);
    if (region) {
      cityLock.requested = now;
      attachRegion(region, { lon: (w + e) / 2, lat: (s + n) / 2 }, STREAM.arrival, true, { strip: [[w, s, e, n]], stripKey: "city" });
    }
  }
  setTimeout(cityAreaStep, 250);
}
function cityPlaceWalker() {
  if (!cityLock) return;
  cityLock.placed = true;
  if (cityAreaHolds(avatar.position.x, avatar.position.z)) return;   // already in it
  const [x, y] = xy(CITY_AREA.start[0], CITY_AREA.start[1]), z = -y;
  const at = (typeof walkerExteriorAt === "function" && walkerExteriorAt(x, z)) || { x, z };
  if (state.explore) setExplore(false);
  avatar.position.set(at.x, AVATAR_STAND_Y + walkerGroundAt(at.x, at.z), at.z);
  state.target.copy(avatar.position);
  placeCamera();
}
//: The walker's head, drawn into a small picture (a data URL) for the profile card. Drawn into its
//: own target, so the frame on screen is not touched; null with no avatar in sight.
let portraitTarget = null, portraitCamera = null, portraitCanvas = null;
const portraitAt = new THREE.Vector3();
function cityPortrait(size = 96) {
  if (!avatar.visible || !avatar.parent || ATTACH) return null;
  if (!portraitTarget || portraitTarget.width !== size) {
    portraitTarget?.dispose();
    portraitTarget = new THREE.WebGLRenderTarget(size, size);
    if (THREE.SRGBColorSpace) portraitTarget.texture.colorSpace = THREE.SRGBColorSpace;
    portraitCamera = new THREE.PerspectiveCamera(30, 1, 0.05, 4);
    portraitCanvas = document.createElement("canvas"); portraitCanvas.width = portraitCanvas.height = size;
  }
  const head = avatar.getObjectByName?.("mixamorigHead") || avatar.getObjectByName?.("Head") || avatar.getObjectByName?.("head");
  avatar.updateMatrixWorld(true);
  if (head) head.getWorldPosition(portraitAt);
  else { avatar.getWorldPosition(portraitAt); portraitAt.y += 1.55 * (avatar.scale.y || 1); }
  portraitAt.y += 0.06;
  const yaw = avatar.rotation.y, d = 0.62;
  portraitCamera.position.set(portraitAt.x + Math.sin(yaw) * d, portraitAt.y + 0.04, portraitAt.z + Math.cos(yaw) * d);
  portraitCamera.lookAt(portraitAt);
  const before = renderer.getRenderTarget();
  renderer.setRenderTarget(portraitTarget);
  renderer.clear();
  renderer.render(scene, portraitCamera);
  renderer.setRenderTarget(before);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(portraitTarget, 0, 0, size, size, px);
  const g = portraitCanvas.getContext("2d"), img = g.createImageData(size, size);
  // The target is read bottom row first: turned the right way up.
  for (let y = 0; y < size; y += 1) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  g.putImageData(img, 0, 0);
  return portraitCanvas.toDataURL("image/jpeg", 0.85);
}
//: The mode: "explore" (the map, search, directions, the free view) or "city" (the game: your
//: body, wallet, job, car, the shops, and the keys that act on them), switched on the map
//: controls' top line, beside the title.
//: Remembered on this device. The living city's people and traffic are out in both.
const MODE_KEY = "kerbside:mode";
var appMode = (() => { try { return localStorage.getItem(MODE_KEY) === "city" ? "city" : "explore"; } catch { return "explore"; } })();
function setAppMode(mode) {
  appMode = mode === "city" ? "city" : "explore";
  try { localStorage.setItem(MODE_KEY, appMode); } catch { /* private window */ }
  document.body.dataset.mode = appMode;
  // The pins are the map's: in the game the number keys choose from the bar, and the pins hide.
  if (typeof pinGroup !== "undefined") pinGroup.visible = appMode !== "city";
  const sw = document.getElementById("mode-switch");
  if (sw) { sw.dataset.mode = appMode; for (const b of sw.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.mode === appMode)); }
  const fold = document.getElementById("fold");
  if (fold) fold.textContent = appMode === "city" ? "☰ City" : "☰ Map";
  // The city is walked: the free view is put away. The map's controls stay the map's (search,
  // directions); you are the card at the top right, which opens your window.
  if (appMode === "city" && state.explore) setExplore(false);
  // City mode's area is built once and held; Explore streams again.
  if (appMode === "city" && !cityLock) enterCityArea();
  if (appMode !== "city" && cityLock) leaveCityArea();
  if (appMode !== "city") livingCity?.closePanel?.();
  requestFrame();
}
{
  const button = document.getElementById("city-open");
  const sw = document.getElementById("mode-switch");
  if (META || ATTACH) { button?.remove(); sw?.remove(); }
  else {
    sw.hidden = false;
    for (const b of sw.querySelectorAll("button")) b.addEventListener("click", () => setAppMode(b.dataset.mode));
    setAppMode(appMode);
    //: The region the walker is in, as the city needs it: its streets and buildings.
    //: Which streets these are: a lighter build holds only the square round where it was built,
    //: and walking on builds the same region round the walker again -- the same name, other
    //: streets. Keyed by the name alone, the city kept the first square's streets and put its
    //: people there, and the streets where you were stood empty (2026-11-08).
    const streetsKey = (name, ways) => `${name}:${ways.length}:${ways[0]?.osm_id ?? ""}:${ways[ways.length - 1]?.osm_id ?? ""}`;
    const regionData = () => {
      const p = avatar.position;
      const guest = guestUnder(p.x, p.z);
      if (guest?.ready && guest.api.cityWays) {
        const ways = guest.api.cityWays() || [];
        return { key: streetsKey(guest.region?.name || "guest", ways), region: guest.region?.name || "guest", ways, county: guest.region?.city || null,
          courts: guest.api.cityCourts?.() || [] };
      }
      if (!hostWorldActive || !(DATA.ways || []).length) return null;
      return { key: streetsKey(REGION_INDEX.host?.name || "host", DATA.ways), region: REGION_INDEX.host?.name || "host", ways: DATA.ways, county: REGION_INDEX.host?.city || null,
        courts: PARK_EVIDENCE?.court_layout?.courts || [] };
    };
    const onRoad = (x, z) => {
      const guest = guestUnder(x, z);
      if (guest?.ready) {
        const [gx, gz] = hostToGuest(guest, x, z);
        return guest.api.insideCarriageway ? guest.api.insideCarriageway(gx, gz, 0) || structuresAt(x, z).length > 0 : true;
      }
      if (outsideTerrainGrid(x, z)) return true;
      return insideCarriageway(x, z, 0) || structuresAt(x, z).length > 0;
    };
    const context = {
      THREE, root, asset: sharedAsset, avatar, standY: AVATAR_STAND_Y, button,
      // The view's camera: the crowd is drawn where it can be seen.
      camera: () => camera,
      enabled: () => !state.explore && !homeScreenUp(),
      // The game's keys, bars and buttons: in City mode only.
      cityMode: () => appMode === "city",
      toLonLat: (x, z) => [x / metersPerLon + midLon, -z / metersPerLat + midLat],
      fromLonLat: (lon, lat) => { const [x, y] = xy(lon, lat); return [x, -y]; },
      groundAt: (x, z) => walkerGroundAt(x, z),
      regionData, onRoad,
      // The kerb as drawn near (x, z) -- {x, z, nx, nz (out of the road), ax, az} -- and whether a
      // car may stand at it (driveways and painted kerb): where the world is built in full.
      kerbAt: (x, z, ax = null, az = null, reach = 6) => {
        const g = guestUnder(x, z);
        if (g?.ready) {
          if (!g.api.kerbAt) return null;
          const k = g.api.kerbAt(...hostToGuest(g, x, z), reach, ax === null ? null : ax / g.sx, az);
          if (!k) return null;
          const s = g.sx, nl = Math.hypot(k.nx * s, k.nz) || 1, al = Math.hypot(k.ax * s, k.az) || 1;
          return { x: g.ox + k.x * s, z: g.oz + k.z, nx: k.nx * s / nl, nz: k.nz / nl, ax: k.ax * s / al, az: k.az / al };
        }
        if (!hostWorldActive || typeof nearestKerbAt !== "function") return null;
        const k = nearestKerbAt(x, z, reach, ax, az);
        return k ? { x: k.x, z: k.z, nx: k.nx, nz: k.nz, ax: k.ax, az: k.az } : null;
      },
      kerbParking: (x, z, ax, az, halfLen, kind) => {
        const g = guestUnder(x, z);
        if (g?.ready) return g.api.kerbParking ? g.api.kerbParking(...hostToGuest(g, x, z), ax, az, halfLen, kind) : null;
        return hostWorldActive && typeof kerbParking === "function" ? kerbParking(x, z, ax, az, halfLen, kind) : null;
      },
      // City mode's area: the walker and the car stop at its edge; tasks outside it are not offered.
      inArea: (x, z) => cityAreaHolds(x, z),
      areaName: () => (cityLock ? CITY_AREA.name : null),
      // Its box, [x0, z0, x1, z1]: the living city keeps track of everyone in it (detail.mjs).
      areaBox: () => (cityLock ? cityLock.box : null),
      moveWalker: (mx, mz) => moveWalker(mx, mz),
      // The walker's legs for a move the city made (walking over to pick a thing up, a shop's
      // floor): ``distance`` metres the way (dx, dz), at a walk -- 0 stands it still. Without
      // it a walker moved by the city glided along in its standing pose.
      animateWalk: (distance, dx = 0, dz = 0) => {
        const moving = distance > 1e-4 && dx * dx + dz * dz > 1e-9;
        avatar.userData.pace = 0.6; avatar.userData.onStairs = false; avatar.userData.grade = 0;
        // The height stays where the city put it (a shop's floor is not the ground under it).
        const y = avatar.position.y;
        animateAvatar(moving ? distance : 0, new THREE.Vector3(dx, 0, dz), moving);
        avatar.position.y = y;
      },
      moveAvatarTo: (x, z, keepHeight = false) => {
        avatar.position.x = x; avatar.position.z = z;
        if (!keepHeight) avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(x, z, walkerFeetY());
        else avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(x, z);
        state.target.copy(avatar.position); placeCamera();
      },
      avatarVisible: (on) => { avatar.visible = on; avatar.userData.inCar = !on; },
      getYaw: () => state.yaw,
      // The walker turned to face (x, z): reaching for a thing, throwing.
      faceTo: (x, z) => { const dx = x - avatar.position.x, dz = z - avatar.position.z; if (dx * dx + dz * dz > 1e-6) avatar.rotation.y = Math.atan2(dx, dz); },
      //: The view swung round behind the car as it turns, not snapped.
      followYaw: (yaw, dt) => {
        let d = yaw - state.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        state.yaw += d * Math.min(1, dt * 3);
        state.target.copy(avatar.position); placeCamera();
      },
      waterAt: (x, z) => cityWaterAt(x, z),
      // The traffic signals' heads drawn here and in the region attached, {x, z, yaw} in this
      // page's metres (yaw: the way the lenses face), lit by ``stateOf(head)``: "red", "amber",
      // "green" or null.
      lightSignals: (stateOf) => {
        let lit = hostWorldActive && typeof setSignalLights === "function" ? setSignalLights(stateOf) : 0;
        const g = activeGuest?.ready ? activeGuest : null;
        if (g?.api.setSignalLights) {
          lit += g.api.setSignalLights((head) => {
            const fx = Math.sin(head.yaw) * g.sx, fz = Math.cos(head.yaw);
            return stateOf({ x: g.ox + head.x * g.sx, z: g.oz + head.z, yaw: Math.atan2(fx, fz), key: head });
          });
        }
        return lit;
      },
      // The garage doors (module 31) -- this page's, or those of the region attached where (x, z)
      // is, in its own metres: the nearest (of a building), and opening it.
      garages: {
        near(x, z, reach = 4, building = null) {
          const g = guestUnder(x, z), G = g?.ready ? g.api.garages : hostWorldActive ? garageDoors : null;
          if (!G) return null;
          const [gx, gz] = g?.ready ? hostToGuest(g, x, z) : [x, z];
          const d = G.near(gx, gz, reach, building);
          if (!d) return null;
          // (``open`` here is the action; whether it stands open is ``isOpen()``.)
          return { ...d, ...(g?.ready ? { x: g.ox + d.x * g.sx, z: g.oz + d.z } : {}),
            open: (seconds) => G.open(d.key, seconds), close: () => G.close(d.key), toggle: () => G.toggle(d.key), isOpen: () => G.isOpen(d.key) };
        },
        moving: () => (typeof garageDoors !== "undefined" ? garageDoors.moving() : 0) + (activeGuest?.ready && activeGuest.api.garages ? activeGuest.api.garages.moving() : 0),
        tick(dt) {
          if (typeof garageDoors !== "undefined") garageDoors.tick(dt);
          if (activeGuest?.ready && activeGuest.api.garages && activeGuest.api.garages !== garageDoors) activeGuest.api.garages.tick(dt);
        },
      },
      // The traffic's car models (the Kenney Car Kit) and crash debris.
      loadModel: (url) => new GLTFLoader().loadAsync(url),
      // The landscape's own trees round (x, z) (out past the regions: the Presidio's forest), and
      // felling them.
      natureTrees: (x, z, reach) => (typeof natureWorld !== "undefined" && natureWorld?.treesNear ? natureWorld.treesNear(x, z, reach) : []),
      fellTree: (ids) => (typeof natureWorld !== "undefined" ? natureWorld?.fell?.(ids) : null),
      // The object catalogue's view of what is round the walker: what a blow can land on.
      objects: () => (typeof objectProximity !== "undefined" ? objectProximity : null),
      // This device's account (kerbside-account.mjs): the money the backend has put in it.
      account: () => accountLibrary(),
      catalogueUrl: sharedAsset("object-catalogue.json"),
      transitUrl: sharedAsset("transit-stops.json"),
      // Inside a shop: the walker's eyes at (x, y, z), looking along ``yaw``; and back out.
      firstPerson: (on) => setFirstPerson(on),
      isFirstPerson: () => Boolean(state.firstPerson),
      placeAvatar: (x, y, z, yaw = null) => {
        avatar.position.set(x, y + AVATAR_STAND_Y, z);
        if (yaw !== null) { state.yaw = yaw; avatar.rotation.y = yaw; }
        state.target.copy(avatar.position); placeCamera();
      },
      setPitch: (pitch) => { state.pitch = pitch; placeCamera(); },
      setFloor: (y) => { state.floorY = y; placeCamera(); },
      goTo: (x, z) => goTo({ x, z }, { travel: true }),
      // The walker's face for the top bar's profile card: the scene drawn once, small, from a
      // camera a little in front of the head (its near objects only: the far plane is 4 m),
      // into a picture.
      portrait: (size = 96) => cityPortrait(size),
      // The walker's right hand, for what is held in it (the model's bone, where it has one).
      hand: () => avatar.getObjectByName?.("mixamorigRightHand") || avatar.getObjectByName?.("RightHand")
        || avatar.getObjectByName?.("hand_r") || avatar.getObjectByName?.("Hand_R") || null,
      // Beds within reach: the furniture of the rooms built round you (Z lies down only at one).
      bedsNear: (x, z, reach = 2.5) => {
        const out = [], v = new THREE.Vector3();
        if (typeof interiorsBuilt === "undefined") return out;
        for (const entry of interiorsBuilt) {
          if (!entry.interior?.group || x < entry.minX - reach || x > entry.maxX + reach || z < entry.minZ - reach || z > entry.maxZ + reach) continue;
          entry.interior.group.traverse((o) => {
            const s = o.userData?.surface || "", role = o.userData?.role || "";
            if (s !== "furnishing:bed" && role !== "bed") return;
            o.getWorldPosition(v);
            const d = Math.hypot(v.x - x, v.z - z);
            if (d <= reach) out.push({ x: v.x, z: v.z, d, building: String(entry.way.osm_id) });
          });
        }
        return out.sort((a, b) => a.d - b.d);
      },
      // A building's doors (the ones the walker uses: Enter), as {x, z, nx, nz} with n pointing in.
      doorsOf: (id) => {
        const entry = typeof footprintById !== "undefined" ? footprintById.get(String(id)) : null;
        return (entry?.doors || []).filter((d) => !d.atGrade).map((d) => ({ x: d.cx, z: d.cz, nx: d.nx, nz: d.nz }));
      },
      // Someone going in or out at (x, z): the door there swings open, and shut behind them.
      nudgeDoor: (x, z) => {
        if (typeof doorsNear === "undefined") return;
        const door = doorsNear(x, z, 1.4)[0];
        if (!door || door.open) return;
        const stamp = performance.now();
        door.open = true; door.npcShut = stamp;
        setTimeout(() => { if (door.npcShut === stamp) { door.open = false; door.npcShut = null; } }, 2600);
      },
      notify: (text) => console.info(`kerbside city: ${text}`),
      log: (text) => console.info(text),
    };
    const start = () => import(sharedAsset("city/view.mjs?rev=__CITY_HASH__")).then(async (lib) => {
      const city = await lib.startCity(context);
      const core = await import(sharedAsset("city/core.mjs?rev=__CITY_HASH__"));
      livingCity = Object.assign(city, { classifyWater: (at) => core.waterClass(city.rules, at) });
      if (multiplayer.session) livingCity.joinParty(multiplayer.session);
      multiplayer.listen?.(() => {
        if (multiplayer.session && livingCity) livingCity.joinParty(multiplayer.session);
        else livingCity?.leaveParty();
      });
      window.kerbsideCity = () => livingCity;
      requestFrame();
      return livingCity;
    }).catch((error) => console.warn("kerbside: the living city did not start", error));
    // Started once the world is up, so it costs the first build nothing.
    // ?city=0 leaves it out (for measuring what it costs).
    if (new URLSearchParams(location.search).get("city") !== "0") WORLD_READY.then(() => setTimeout(start, 1500));
  }
}
