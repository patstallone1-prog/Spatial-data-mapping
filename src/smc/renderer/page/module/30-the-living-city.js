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
//: The mode: "explore" (the map, search, directions, the free view) or "city" (the game: your
//: body, wallet, job, car, the shops, and the keys that act on them), switched at the top left.
//: Remembered on this device. The living city's people and traffic are out in both.
const MODE_KEY = "kerbside:mode";
var appMode = (() => { try { return localStorage.getItem(MODE_KEY) === "city" ? "city" : "explore"; } catch { return "explore"; } })();
function setAppMode(mode) {
  appMode = mode === "city" ? "city" : "explore";
  try { localStorage.setItem(MODE_KEY, appMode); } catch { /* private window */ }
  document.body.dataset.mode = appMode;
  const sw = document.getElementById("mode-switch");
  if (sw) { sw.dataset.mode = appMode; for (const b of sw.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.mode === appMode)); }
  const fold = document.getElementById("fold");
  if (fold) fold.textContent = appMode === "city" ? "☰ City" : "☰ Map";
  // The city is walked: the free view is put away, and the city's panel sits in the sidebar.
  if (appMode === "city" && state.explore) setExplore(false);
  if (appMode === "city") livingCity?.openPanel(true);
  else livingCity?.closePanel?.();
  requestFrame();
}
{
  const button = document.getElementById("city-open");
  const sw = document.getElementById("mode-switch");
  if (META || ATTACH) { button?.remove(); sw?.remove(); document.getElementById("city-dock")?.remove(); }
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
        return { key: streetsKey(guest.region?.name || "guest", ways), region: guest.region?.name || "guest", ways, county: guest.region?.city || null };
      }
      if (!hostWorldActive || !(DATA.ways || []).length) return null;
      return { key: streetsKey(REGION_INDEX.host?.name || "host", DATA.ways), region: REGION_INDEX.host?.name || "host", ways: DATA.ways, county: REGION_INDEX.host?.city || null };
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
      enabled: () => !state.explore && !homeScreenUp(),
      // The game's keys, bars and buttons: in City mode only.
      cityMode: () => appMode === "city",
      panelHost: () => (appMode === "city" ? document.getElementById("city-dock") : null),
      toLonLat: (x, z) => [x / metersPerLon + midLon, -z / metersPerLat + midLat],
      fromLonLat: (lon, lat) => { const [x, y] = xy(lon, lat); return [x, -y]; },
      groundAt: (x, z) => walkerGroundAt(x, z),
      regionData, onRoad,
      moveWalker: (mx, mz) => moveWalker(mx, mz),
      moveAvatarTo: (x, z, keepHeight = false) => {
        avatar.position.x = x; avatar.position.z = z;
        if (!keepHeight) avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(x, z, walkerFeetY());
        else avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(x, z);
        state.target.copy(avatar.position); placeCamera();
      },
      avatarVisible: (on) => { avatar.visible = on; avatar.userData.inCar = !on; },
      getYaw: () => state.yaw,
      //: The view swung round behind the car as it turns, not snapped.
      followYaw: (yaw, dt) => {
        let d = yaw - state.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        state.yaw += d * Math.min(1, dt * 3);
        state.target.copy(avatar.position); placeCamera();
      },
      waterAt: (x, z) => cityWaterAt(x, z),
      // The traffic's car models (the Kenney Car Kit) and crash debris.
      loadModel: (url) => new GLTFLoader().loadAsync(url),
      // The landscape's own trees round (x, z) (out past the regions: the Presidio's forest), and
      // felling them.
      natureTrees: (x, z, reach) => (typeof natureWorld !== "undefined" && natureWorld?.treesNear ? natureWorld.treesNear(x, z, reach) : []),
      fellTree: (ids) => (typeof natureWorld !== "undefined" ? natureWorld?.fell?.(ids) : null),
      // The object catalogue's view of what is round the walker: what a blow can land on.
      objects: () => (typeof objectProximity !== "undefined" ? objectProximity : null),
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
      // The walker's right hand, for what is held in it (the model's bone, where it has one).
      hand: () => avatar.getObjectByName?.("mixamorigRightHand") || avatar.getObjectByName?.("RightHand")
        || avatar.getObjectByName?.("hand_r") || avatar.getObjectByName?.("Hand_R") || null,
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
      if (appMode === "city") livingCity.openPanel(true);
      requestFrame();
      return livingCity;
    }).catch((error) => console.warn("kerbside: the living city did not start", error));
    // Started once the world is up, so it costs the first build nothing.
    // ?city=0 leaves it out (for measuring what it costs).
    if (new URLSearchParams(location.search).get("city") !== "0") WORLD_READY.then(() => setTimeout(start, 1500));
  }
}
