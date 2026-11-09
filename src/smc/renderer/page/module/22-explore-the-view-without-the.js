// ---- explore: the view without the walker ----
//
// E, or the Explore button: the walker is put away and the arrows move the view itself, over
// roofs and through walls, faster the farther out the view is. A click or a pin
// moves the view, not a walker. Turned off, the walker is stood on the nearest open ground to
// where the view is looking, and the view follows it again as before.
//: Metres a second the view moves at, per metre of its distance, and at least.
const EXPLORE_SPEED_PER_M = 0.8;
//: City mode (the game): E, R, Esc, a click to go somewhere and the pins are the map's, not the
//: game's -- there the click swings, the right click uses, and 1-8 choose from the bar.
function cityGame() { return typeof appMode !== "undefined" && appMode === "city"; }
const EXPLORE_SPEED_MIN = 8;
function setExplore(on, auto = false) {
  // The free view belongs to Explore mode: asked for in City mode (E), the switch goes over too.
  if (on && !auto && typeof appMode !== "undefined" && appMode === "city" && typeof setAppMode === "function") setAppMode("explore");
  if (META && on) return;   // no explore mode in the headset
  if (typeof avatar === "undefined" || typeof gps === "undefined" || Boolean(state.explore) === on) return;
  // Chosen (E or the button), explore stays at any zoom; left by hand while far out, the zoom
  // does not take it straight back.
  state.exploreAuto = on && auto;
  if (!auto) state.exploreAutoHeld = !on;
  if (on) {
    if (state.firstPerson) setFirstPerson(false);
    state.explore = true;
    state.exploreGps = { follow: gps.follow, leash: GPS_LEASH.on };
    gps.follow = false;
    GPS_LEASH.on = false;
    avatar.visible = false;
  } else {
    state.explore = false;
    const at = walkerExteriorAt(state.target.x, state.target.z);
    if (at) {
      avatar.position.set(at.x, AVATAR_STAND_Y + walkerGroundAt(at.x, at.z,groundLiftAt(at.x,at.z)), at.z);
      state.indoors = false;
    }
    avatar.visible = true;
    state.target.copy(avatar.position);
    placeCamera();
  }
  const button = document.getElementById("explore");
  if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
}
//: Explore by zoom: out past where the walker is drawn a few pixels tall, the view goes to
//: explore; back in, the walker stands where the view is. Out at 5 px, back at 8: a gap, so the
//: switch does not flicker at the edge. (A 2.1 m walker in an 800 px window: about 370 m out,
//: 230 m back.)
const AUTO_EXPLORE_OUT_PX = 5, AUTO_EXPLORE_IN_PX = 8;
function walkerPixelsAt(dist) {
  return innerHeight * AVATAR_HEIGHT * AVATAR_SCALE / (2 * dist * Math.tan(camera.fov * Math.PI / 360));
}
function autoExploreByZoom() {
  if (META || ATTACH || state.firstPerson) return;
  const px = walkerPixelsAt(state.dist);
  if (px >= AUTO_EXPLORE_IN_PX) state.exploreAutoHeld = false;
  if (!state.explore && !state.exploreAutoHeld && px < AUTO_EXPLORE_OUT_PX) setExplore(true, true);
  else if (state.explore && state.exploreAuto && px >= AUTO_EXPLORE_IN_PX) setExplore(false, true);
}
function exploreStep(dt) {
  if (!held.size) return;
  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).negate();
  const rightward = new THREE.Vector3(forward.z, 0, -forward.x);
  const move = new THREE.Vector3();
  if (held.has("ArrowUp")) move.add(forward);
  if (held.has("ArrowDown")) move.sub(forward);
  if (held.has("ArrowRight")) move.add(rightward);
  if (held.has("ArrowLeft")) move.sub(rightward);
  if (!move.lengthSq()) return;
  move.normalize().multiplyScalar(Math.max(EXPLORE_SPEED_MIN, state.dist * EXPLORE_SPEED_PER_M) * dt);
  state.target.x += move.x;
  state.target.z += move.z;
  state.target.y = groundLiftAt(state.target.x, state.target.z);
  placeCamera();
}
if (!ATTACH) {
  document.getElementById("explore").addEventListener("click", () => setExplore(!state.explore));
  addEventListener("keydown", (e) => {
    if ((e.key !== "e" && e.key !== "E") || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
        || e.target instanceof HTMLSelectElement) return;
    if (cityGame()) return;   // the game has no free view: the switch at the top left goes to Explore
    setExplore(!state.explore);
    e.preventDefault();
  });
}

// ---- gaps: mapped ways nobody has photographed ----
{
  const material = new THREE.LineBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.85 });
  let metres = 0;
  for (const gap of DATA.gaps || []) {
    const points = gap.points.map(([lon, lat]) => v3(lon, lat, 1.5));
    if (points.length < 2) continue;
    for (let i = 1; i < points.length; i += 1) metres += points[i].distanceTo(points[i - 1]);
    groups.gaps.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  const note = document.getElementById("gapnote");
  if (note) {
    const total = (DATA.gaps || []).length;
    note.textContent = total
      ? `${total.toLocaleString()} mapped ways, about ${(metres / 1000).toFixed(1)} km, have no eligible photograph over them.`
      : "Every mapped way in the region has at least one eligible photograph over it.";
  }
}

// The facade credit. These walls are other people's photographs, taken under CC BY-SA 4.0,
// and that licence is a condition rather than a courtesy: it wants the source named wherever
// the work is shown. It also happens to be the honest caption for the layer -- one chunk of
// this city is photographs and the rest of it is a guess about what the buildings look like.
{
  const note = document.getElementById("facadenote");
  const chunk = (FACADES.chunks || [])[0];
  if (note && chunk) {
    const licences = Object.keys(chunk.licenses || {}).join(", ") || "CC BY-SA 4.0";
    note.innerHTML =
      `<b>Photo facades</b> — chunk ${chunk.key}, ${chunk.textured} of ${chunk.attempted} walls ` +
      `across ${chunk.buildings} buildings, rectified from street-level frames and merged. ` +
      `Every other building wears a procedural texture. Imagery by Mapillary and KartaView ` +
      `contributors, ${licences}. Turn on <b>Chunks</b> for the grid and which square is next.`;
  }
}

// ---- search by corner or address ----
//
// People say where they are two ways: by naming two streets, or by giving a number and a street.
// The field takes both. Matching is per-word, which lets "market 4th" and "4th & market" find
// the same corner without the searcher having to guess the order or the ampersand, and lets
// "600 montgomery" find the building whether or not they typed "Street".
//
// A query that opens with a house number is asking for an address and gets addresses first;
// everything else leads with corners. That one rule is the whole ranking, and it is right nearly
// every time because nobody types a number when they mean a junction.
//: The same search, for the directions' stop fields (set inside the block below).
let searchPlaces = () => [];
//: Resolves once every region's places are searchable too (the headset's menu waits on it).
let searchPlacesLoaded = () => Promise.resolve();
{
  const field = document.getElementById("find");
  const hits = document.getElementById("hits");
  const corners = (DATA.intersections || []).map((c) => ({
    label: `${c.a} & ${c.b}`, hay: `${c.a} ${c.b}`.toLowerCase(),
    lon: c.lon, lat: c.lat,
  }));
  // Built once from the footprints rather than shipped a second time: the address is already on
  // the building, and so is the centroid to travel to.
  // And by name: a building's own name, and the name of every shop and place in it, each found
  // where the building stands -- "Transamerica Pyramid", "Pyramid Cafe".
  const addresses = [];
  const places = [];
  for (const way of DATA.ways) {
    if (way.kind !== "building" || !way.centroid) continue;
    const address = way.address || {};
    const label = address.formatted
      || [address.house_number, address.street].filter(Boolean).join(" ");
    const [lon, lat] = way.centroid;
    if (label) addresses.push({ label, hay: `${label} ${way.name || ""}`.toLowerCase(), lon, lat });
    const where = label ? ` · ${label}` : "";
    if (way.name) places.push({ label: `${way.name}${where}`, hay: `${way.name} ${label}`.toLowerCase(), lon, lat });
    const tenants=new Map([...(way.shops || []),...(way.tenant_names || [])].map(s=>[s.n,s]));
    for (const shop of tenants.values()) {
      if (!shop.n || shop.n === way.name) continue;
      places.push({ label: `${shop.n}${where}`, hay: `${shop.n} ${shop.t || ""} ${label}`.toLowerCase(), lon, lat });
    }
  }
  // Every other region's corners and addresses (tools/build_search_index.py), fetched the first
  // time anyone types: a place across the bay is found the same way as one down the street, and
  // travelling to it hands over to that region's full model -- no region to choose first.
  const elsewhere = { corners: [], addresses: [], places: [], loading: null };
  function searchEntryKey(label,lon,lat) { return `${label}|${lon.toFixed(5)}|${lat.toFixed(5)}`; }
  const localSearchKeys=new Set([...corners,...addresses,...places].map(p=>searchEntryKey(p.label,p.lon,p.lat)));
  function loadElsewhere() {
    if (elsewhere.loading) return elsewhere.loading;
    const index = document.querySelector('meta[name="kerbside-regions"]')?.content;
    if (!index) return (elsewhere.loading = Promise.resolve());
    const url = new URL("search-index.json", new URL(index, location.href));
    elsewhere.loading = fetch(url.href).then((r) => (r.ok ? r.json() : null)).then((all) => {
      if (!all) return;
      const titles = (all.regions || []).map((r) => r.title);
      const take = (rows) => rows
        // Only the INITIAL payload supplies the local lists above. A later guest
        // owning this address does not mean it exists in those frozen lists.
        .filter(([label, lon, lat]) => !localSearchKeys.has(searchEntryKey(label,lon,lat)))
        .map(([label, lon, lat, r]) => ({ label: `${label} · ${titles[r] || ""}`,
          hay: `${label} ${titles[r] || ""}`.toLowerCase(), lon, lat }));
      elsewhere.corners = take(all.corners || []);
      elsewhere.addresses = take(all.addresses || []);
      elsewhere.places = take(all.places || []);
      if (field.value) { showing = search(field.value); selected = showing.length ? 0 : -1; paint(); }
    }).catch(() => {});
    return elsewhere.loading;
  }
  let selected = -1;
  let showing = [];

  function match(list, words, limit) {
    const found = [];
    for (const entry of list) {
      if (words.every((w) => entry.hay.includes(w))) {
        found.push(entry);
        if (found.length >= limit) break;
      }
    }
    return found;
  }

  function search(query) {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return [];
    const numbered = /^\d/.test(words[0]);
    // Here first, then everywhere else that is mapped.
    const order = numbered
      ? [addresses, corners, places, elsewhere.addresses, elsewhere.corners, elsewhere.places]
      : [places, corners, addresses, elsewhere.places, elsewhere.corners, elsewhere.addresses];
    let found = [];
    for (const list of order) {
      if (found.length >= 8) break;
      found = found.concat(match(list, words, 8 - found.length));
    }
    // A house number nobody mapped: the nearest numbers on that street ("2400 mission" finds
    // 2410 Mission Street), here and elsewhere.
    if (!found.length && numbered && words.length > 1) {
      const wanted = Number(words[0]);
      const rest = words.slice(1);
      const near = [];
      for (const list of [addresses, elsewhere.addresses]) {
        for (const entry of list) {
          // The street, not the region's name: "mission" is a street and a district.
          const street = entry.label.split(" · ")[0].toLowerCase();
          if (!rest.every((w) => street.includes(w))) continue;
          const numbers = (entry.label.match(/^[\d;\-\s]+/) || [""])[0].match(/\d+/g);
          if (!numbers) continue;
          const gap = Math.min(...numbers.map((n) => Math.abs(Number(n) - wanted)));
          if (gap <= 200) near.push([gap, entry]);
        }
      }
      found = near.sort((a, b) => a[0] - b[0]).slice(0, 8).map(([, entry]) => entry);
    }
    return found;
  }

  function paint() {
    hits.replaceChildren();
    showing.forEach((place, index) => {
      const item = document.createElement("li");
      item.textContent = place.label;
      item.setAttribute("aria-selected", String(index === selected));
      item.addEventListener("click", () => travelTo(place));
      hits.append(item);
    });
  }

  function travelTo(place) {
    // A place here is gone to: the walker is put there and the place pinned (kerbsideShowPlace).
    // No directions: those are asked for in the From and To fields.
    if (window.kerbsideShowPlace && window.kerbsideShowPlace(place)) {
      field.value = place.label;
      showing = [];
      selected = -1;
      paint();
      return;
    }
    if (window.kerbsideOpenFullRegionAt &&
        window.kerbsideOpenFullRegionAt(place.lon, place.lat)) return;
    const [x, y] = xy(place.lon, place.lat);
    // A named place is an explicit destination: unlike pointer view gestures,
    // search is allowed to move the walker and close the distance.
    const landing = addressLanding(new THREE.Vector3(x, 0, -y));
    goTo(landing, { travel: true, zoom: true });
    field.value = place.label;
    showing = [];
    selected = -1;
    paint();
  }

  searchPlaces = (query) => { loadElsewhere(); return search(query); };
  searchPlacesLoaded = () => loadElsewhere();
  field.addEventListener("focus", loadElsewhere);
  field.addEventListener("input", () => {
    loadElsewhere();
    showing = search(field.value);
    selected = showing.length ? 0 : -1;
    paint();
  });
  field.addEventListener("keydown", (e) => {
    if (!showing.length) return;
    if (e.key === "ArrowDown") { selected = (selected + 1) % showing.length; paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { selected = (selected - 1 + showing.length) % showing.length; paint(); e.preventDefault(); }
    else if (e.key === "Enter") { travelTo(showing[Math.max(selected, 0)]); e.preventDefault(); }
    // Arrow keys inside the field steer the list, not the sphere; the walker's handler is on
    // the window and would otherwise start it moving while somebody is choosing a corner.
    e.stopPropagation();
  });
}

// Keep search and view controls visible; expand the data and layer menu on demand.
{
  const hud = document.getElementById("hud");
  const fold = document.getElementById("fold");
  fold.addEventListener("click", () => {
    const open = hud.dataset.open !== "false";
    hud.dataset.open = String(!open);
    fold.setAttribute("aria-expanded", String(!open));
    fold.textContent = open ? "Open map controls" : "Close map controls";
    fold.title = open ? "Open map controls" : "Close map controls";
  });
}

document.querySelectorAll("button[data-layer]").forEach((button) => {
  // The control reads its state from the scene rather than from the markup, so a layer's
  // default can be changed in one place without the buttons quietly disagreeing with it.
  button.setAttribute("aria-pressed", String(groups[button.dataset.layer].visible));
  button.addEventListener("click", () => {
    const layer = button.dataset.layer;
    const opening = !groups[layer].visible;
    if (opening) ensureLazyLayer(layer);
    groups[layer].visible = opening;
    button.setAttribute("aria-pressed", String(groups[layer].visible));
  });
});

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
// ---- a body to move through the city with ----
//
// Orbiting a model tells you its shape; walking it tells you its scale. A simple person is
// still cheap enough to keep the map self-contained, but reads as a body rather than as a
// marker: shoulders, feet, head height, gait and facing all make the kerb scale easier to feel.
const STREET_SPEED = 8.94;     // 20 mph in metres per second, at street level, orbiting
//: In the walker's own eyes the pace is a brisk 12 mph: fast enough to cross a block without
//: tedium, slow enough that a kerb and a doorway can be looked at as they pass.
const FIRST_PERSON_SPEED = 5.36;   // 12 mph
//: The first-person view zooms by narrowing its field: the wheel takes it from the full
//: 50 degrees down to half that, a 2x look at a sign or a kerb across the street.
const FIRST_PERSON_FOV = 50;
const FIRST_PERSON_MAX_ZOOM = 2.0;
// Keep the apparent screen-space pace stable as the orbit camera moves farther away.
// First-person remains a fixed 12 mph.
//: Inside a house the walker goes at a walking pace, 3 mph.
const INDOOR_SPEED = 1.341;
function avatarMoveSpeed() {
  if (state.indoors) return INDOOR_SPEED;
  if (state.firstPerson) return FIRST_PERSON_SPEED;
  const height = Math.max(1, renderer.domElement.clientHeight);
  const fov = camera.fov * Math.PI / 180;
  const metresPerPixel = 2 * state.dist * Math.tan(fov / 2) / height;
  const arrivalMetresPerPixel = 2 * ARRIVAL_DIST * Math.tan(fov / 2) / height;
  return STREET_SPEED * Math.max(1, metresPerPixel / arrivalMetresPerPixel);
}
const AVATAR_RADIUS = 0.9;     // 1.8 m across: a person, so everything else has a scale to read against
const AVATAR_HEIGHT = 2.1336;  // seven feet exactly, which is what the demo avatar is asked to be
//: The walker is drawn at the size above: one, once the figure is measured as it stands
//: (skinnedBounds) rather than by its unposed geometry, which had it ten metres tall.
const AVATAR_SCALE = 1.0;
const AVATAR_STAND_Y = AVATAR_RADIUS * AVATAR_SCALE;      // the rig's origin, feet on the ground
const AVATAR_EYE_Y = AVATAR_HEIGHT * AVATAR_SCALE * 0.93;  // where the first-person camera sits
const ARRIVAL_DIST = 45;       // close enough that a 126 mm kerb is a step rather than a line
const DEMO_CHARACTER_URL = WALKER_MODEL_URL;
const DEMO_CHARACTER_SOURCE = "Three.js Soldier.glb demo avatar with skinned idle/walk/run clips";
let avatarMixer = null;
let avatarActions = {};
let avatarActiveAction = null;
function avatarMaterial(color, roughness = 0.72, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function addAvatarBox(parent, name, x, y, z, w, h, d, color, roughness = 0.72) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), avatarMaterial(color, roughness));
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function addAvatarSphere(parent, name, x, y, z, r, color, roughness = 0.72) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), avatarMaterial(color, roughness));
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function addAvatarCylinder(parent, name, x, y, z, radiusTop, radiusBottom, h, color, roughness = 0.72) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, h, 18),
    avatarMaterial(color, roughness)
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
function addAvatarLimb(parent, name, x, y, z, length, radius, color) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(x, y, z);
  const limb = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.82, length, 12),
    avatarMaterial(color, 0.78)
  );
  limb.position.y = -length / 2;
  pivot.add(limb);
  parent.add(pivot);
  return pivot;
}
function buildCharacterAvatar() {
  const rig = new THREE.Group();
  rig.name = "walking-character-avatar";
  const skin = 0xc28a68;
  const skinShadow = 0x8f6046;
  const jacket = 0x293946;
  const jacketTrim = 0x111820;
  const denim = 0x263b5c;
  const shoe = 0x1b1c1f;
  const shoeSole = 0x2f3438;
  const shirt = 0xd6ddd4;
  const hair = 0x2d2119;
  const eye = 0x12161a;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.36, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadow.name = "contact-shadow";
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.888;
  rig.add(shadow);

  addAvatarCylinder(rig, "neck", 0, 0.49, -0.01, 0.065, 0.072, 0.14, skinShadow, 0.66);
  addAvatarBox(rig, "torso", 0, 0.13, 0, 0.40, 0.66, 0.22, jacket, 0.82);
  addAvatarBox(rig, "shoulders", 0, 0.40, 0, 0.54, 0.12, 0.24, jacket, 0.82);
  addAvatarBox(rig, "shirt", 0, 0.12, -0.119, 0.22, 0.55, 0.018, shirt, 0.86);
  addAvatarBox(rig, "left-lapel", -0.09, 0.22, -0.132, 0.04, 0.46, 0.016, jacketTrim, 0.84);
  addAvatarBox(rig, "right-lapel", 0.09, 0.22, -0.132, 0.04, 0.46, 0.016, jacketTrim, 0.84);
  addAvatarBox(rig, "zipper", 0, 0.12, -0.144, 0.018, 0.54, 0.012, 0xe2e7df, 0.52);
  addAvatarBox(rig, "hips", 0, -0.25, 0.01, 0.36, 0.18, 0.20, denim, 0.80);
  addAvatarSphere(rig, "head", 0, 0.68, -0.01, 0.17, skin, 0.62).scale.set(0.90, 1.06, 0.88);
  addAvatarSphere(rig, "hair", 0, 0.79, 0.01, 0.178, hair, 0.88).scale.set(0.96, 0.38, 0.88);
  addAvatarBox(rig, "hairline", 0, 0.735, -0.143, 0.22, 0.055, 0.035, hair, 0.88);
  addAvatarBox(rig, "left-eye", -0.055, 0.695, -0.158, 0.032, 0.018, 0.012, eye, 0.48);
  addAvatarBox(rig, "right-eye", 0.055, 0.695, -0.158, 0.032, 0.018, 0.012, eye, 0.48);
  addAvatarBox(rig, "nose", 0, 0.665, -0.174, 0.036, 0.040, 0.050, skinShadow, 0.62);
  addAvatarBox(rig, "mouth", 0, 0.617, -0.163, 0.070, 0.014, 0.012, 0x4d2a25, 0.58);
  addAvatarSphere(rig, "left-ear", -0.150, 0.675, -0.002, 0.035, skinShadow, 0.64).scale.set(0.42, 0.72, 0.28);
  addAvatarSphere(rig, "right-ear", 0.150, 0.675, -0.002, 0.035, skinShadow, 0.64).scale.set(0.42, 0.72, 0.28);
  addAvatarBox(rig, "backpack", 0, 0.13, 0.142, 0.33, 0.52, 0.12, 0x22302f, 0.9);
  addAvatarBox(rig, "left-strap", -0.17, 0.18, -0.139, 0.035, 0.58, 0.012, 0x1a2425, 0.9);
  addAvatarBox(rig, "right-strap", 0.17, 0.18, -0.139, 0.035, 0.58, 0.012, 0x1a2425, 0.9);

  rig.userData.leftArm = addAvatarLimb(rig, "left-arm", -0.285, 0.39, -0.005, 0.58, 0.046, jacket);
  rig.userData.rightArm = addAvatarLimb(rig, "right-arm", 0.285, 0.39, -0.005, 0.58, 0.046, jacket);
  rig.userData.leftHand = addAvatarSphere(rig.userData.leftArm, "left-hand", 0, -0.62, -0.01, 0.058, skin, 0.62);
  rig.userData.rightHand = addAvatarSphere(rig.userData.rightArm, "right-hand", 0, -0.62, -0.01, 0.058, skin, 0.62);
  rig.userData.leftLeg = addAvatarLimb(rig, "left-leg", -0.115, -0.31, 0, 0.64, 0.057, denim);
  rig.userData.rightLeg = addAvatarLimb(rig, "right-leg", 0.115, -0.31, 0, 0.64, 0.057, denim);
  rig.userData.leftFoot = addAvatarBox(rig.userData.leftLeg, "left-foot", 0, -0.66, -0.060, 0.14, 0.075, 0.27, shoe, 0.66);
  rig.userData.rightFoot = addAvatarBox(rig.userData.rightLeg, "right-foot", 0, -0.66, -0.060, 0.14, 0.075, 0.27, shoe, 0.66);
  addAvatarBox(rig.userData.leftLeg, "left-sole", 0, -0.704, -0.060, 0.15, 0.018, 0.28, shoeSole, 0.60);
  addAvatarBox(rig.userData.rightLeg, "right-sole", 0, -0.704, -0.060, 0.15, 0.018, 0.28, shoeSole, 0.60);
  rig.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  rig.userData.walkPhase = 0;
  return rig;
}
const avatar = buildCharacterAvatar();
avatar.name="kerbside-walker";
// An attached region's walker is the page's: its own stands in for it unseen (guestTick moves it).
if (ATTACH) avatar.visible = false;
avatar.scale.setScalar(AVATAR_SCALE);
avatar.position.set(0, AVATAR_STAND_Y, 0);
root.add(avatar);
// The camera is first placed once the walker exists: in first person it stands in the walker's eyes.
placeCamera();
function setAvatarAction(name) {
  const next = avatarActions[name] || avatarActions.Walk || avatarActions.Run || avatarActions.Idle;
  if (!next || next === avatarActiveAction) return;
  next.reset().fadeIn(0.18).play();
  if (avatarActiveAction) avatarActiveAction.fadeOut(0.18);
  avatarActiveAction = next;
}
function skinnedBounds(object) {
  // The box a skinned figure actually occupies. Box3.setFromObject reads each mesh's
  // geometry bounds, which for a skinned mesh are the unposed vertices in bone space -- a
  // box a fifth the height of the figure -- so the walker was fitted to seven feet and then
  // stood ten metres tall, a giant on every kerb it was meant to give a scale to.
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  object.traverse((node) => {
    if (!node.isMesh) return;
    if (node.isSkinnedMesh) {
      node.computeBoundingBox();
      box.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
    } else {
      box.expandByObject(node);
    }
  });
  return box;
}
function fitDemoCharacter(model) {
  const size = skinnedBounds(model).getSize(new THREE.Vector3());
  const scale = size.y > 0 ? AVATAR_HEIGHT / size.y : 1;
  model.scale.setScalar(scale);
  const fitted = skinnedBounds(model);
  model.position.y = -AVATAR_RADIUS - fitted.min.y;
  model.rotation.y = Math.PI;
}
function loadDemoCharacterAvatar(rig) {
  const loader = new GLTFLoader();
  loader.setCrossOrigin("anonymous");
  loader.load(DEMO_CHARACTER_URL, (gltf) => {
    const model = gltf.scene;
    model.name = "imported-realistic-demo-character";
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.material) node.material.roughness = Math.max(node.material.roughness || 0, 0.62);
    });
    fitDemoCharacter(model);
    // A creator figure already standing in (it loaded first) stays; the Soldier waits hidden.
    const creator = walkerFigure?.holder.parent === rig ? walkerFigure.holder : null;
    for (const child of rig.children) {
      if (child.name !== "contact-shadow" && !child.userData.teamRing && child !== creator) child.visible = false;
    }
    rig.userData.soldierClips = gltf.animations || [];
    if (creator) {
      model.name = "soldier-figure";
      model.visible = false;
      rig.add(model);
    } else {
      rig.add(model);
      avatarMixer = new THREE.AnimationMixer(model);
      avatarActions = {};
      for (const clip of gltf.animations || []) {
        avatarActions[clip.name] = avatarMixer.clipAction(clip);
      }
    }
    rig.userData.demoCharacterLoaded = true;
    if (walkerLook) applyWalkerLook(walkerLook);
    rig.userData.demoCharacterSource = DEMO_CHARACTER_SOURCE;
    rig.userData.motionBridge = "Unreal target: ARDY/MotionBricks policy output retargeted to this avatar rig.";
    setAvatarAction("Idle");
  }, undefined, (error) => {
    console.warn("Demo character failed to load; keeping procedural walker.", error);
    rig.userData.demoCharacterLoaded = false;
    rig.userData.demoCharacterSource = "procedural fallback";
  });
}
loadDemoCharacterAvatar(avatar);
//: The walker as the figure made in Customize avatar, in place of the Soldier once its parts are
//: loaded (the Soldier stays if they cannot be). Drawn by the Soldier's rule: the default body
//: is AVATAR_HEIGHT tall, a shorter or taller one in proportion; it faces +z as the rig does.
const CREATOR_DEFAULT_HEIGHT_M = 1.7;
let walkerFigure = null, walkerFigureTurn = 0;
async function showWalkerFigure(look) {
  const mine = ++walkerFigureTurn;
  const wanted = look && look.avatar?.model !== "soldier";
  const soldier = avatar.getObjectByName("imported-realistic-demo-character");
  try {
    if (!wanted) throw null;
    const builder = await avatarBuilder();
    const tint = look.outfit && look.outfit.toLowerCase() !== "#ffffff" ? look.outfit : null;
    if (!walkerFigure) {
      const figure = await builder.build(look.avatar || {}, { outfitTint: tint });
      const holder = new THREE.Group();
      holder.name = "creator-figure";
      holder.scale.setScalar(AVATAR_HEIGHT * AVATAR_SCALE / CREATOR_DEFAULT_HEIGHT_M);
      holder.position.y = -AVATAR_RADIUS;
      holder.add(figure.root);
      walkerFigure = { figure, holder, clips: null };
    } else {
      await walkerFigure.figure.set(look.avatar || {}, { outfitTint: tint });
    }
    if (mine !== walkerFigureTurn) return;
    const { figure, holder } = walkerFigure;
    if (holder.parent !== avatar) {
      // In for the Soldier, or for the boxes drawn until the Soldier loads.
      for (const child of avatar.children) {
        if (child.name !== "contact-shadow" && !child.userData.teamRing) child.visible = false;
      }
      if (soldier) soldier.name = "soldier-figure";
      holder.name = "imported-realistic-demo-character";
      holder.visible = true;
      avatar.add(holder);
    }
    if (walkerFigure.clips !== figure.animations) {
      walkerFigure.clips = figure.animations;
      avatarMixer?.stopAllAction();
      avatarMixer = new THREE.AnimationMixer(holder);
      avatarActions = Object.fromEntries(figure.animations.map((clip) => [clip.name, avatarMixer.clipAction(clip)]));
      avatarActiveAction = null;
      setAvatarAction("Idle");
    }
    holder.traverse((node) => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    requestFrame();
  } catch (error) {
    if (error) console.warn("Avatar creator unavailable; the walker stays the Soldier.", error);
    if (mine !== walkerFigureTurn || !walkerFigure || walkerFigure.holder.parent !== avatar) return;
    // Back to the Soldier.
    walkerFigure.holder.removeFromParent();
    walkerFigure.holder.name = "creator-figure";
    const back = avatar.getObjectByName("soldier-figure");
    if (back) { back.visible = true; back.name = "imported-realistic-demo-character"; }
    else for (const child of avatar.children) child.visible = true;   // the boxes, until it loads
    walkerFigure.clips = null;
    if (back && avatar.userData.soldierClips) {
      avatarMixer = new THREE.AnimationMixer(back);
      avatarActions = Object.fromEntries(avatar.userData.soldierClips.map((clip) => [clip.name, avatarMixer.clipAction(clip)]));
      avatarActiveAction = null;
      setAvatarAction("Idle");
    }
  }
}
try {
  const saved = JSON.parse(sessionStorage.getItem("kerbside:region-arrival") || "null");
  if (saved && saved.path === location.pathname && Number.isFinite(saved.lon)
      && Number.isFinite(saved.lat) && tileOwnGround(saved.lon, saved.lat)) {
    const [x, y] = xy(saved.lon, saved.lat);
    avatar.position.set(x, AVATAR_STAND_Y + walkerGroundAt(x, -y), -y);
    state.yaw = Number.isFinite(saved.yaw) ? saved.yaw : state.yaw;
    state.pitch = Number.isFinite(saved.pitch) ? saved.pitch : state.pitch; state.tilt = 0;
    state.dist = Number.isFinite(saved.dist) ? Math.max(8, saved.dist) : ARRIVAL_DIST;
    state.firstPerson = Boolean(saved.firstPerson);
    sessionStorage.removeItem("kerbside:region-arrival");
  }
} catch (error) { /* no saved arrival, or storage unavailable */ }
state.target.copy(avatar.position);
setFirstPerson(state.firstPerson);

const held = new Set();
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
addEventListener("keydown", (e) => {
  // F: into the walker's own eyes, or back out.
  if ((e.key === "f" || e.key === "F") && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey
      && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)
      && !(e.target instanceof HTMLSelectElement)) {
    setFirstPerson(!state.firstPerson);
    state.autoFirstPerson = false;
    e.preventDefault();
    return;
  }
  if (!ARROWS.has(e.key)) return;
  // Typing in a field is not steering. Without this, choosing a corner walks the sphere away.
  if (e.target instanceof HTMLInputElement) return;
  held.add(e.key);
  e.preventDefault();   // otherwise the arrows scroll the page out from under the canvas
});
addEventListener("keyup", (e) => held.delete(e.key));
addEventListener("blur", () => held.clear());   // a key held while tabbing away would stick

// Click to go there. The ray is cast at the ground rather than at the geometry, so clicking a
// rooftop puts you on the street beneath it instead of on the roof.
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pressedAt = [0, 0];
canvas.addEventListener("pointerdown", (e) => { pressedAt = [e.clientX, e.clientY]; });
const tip = document.getElementById("tip");

const wayIndex = new WeakMap(DATA.ways.map((way, index) => [way, index]));
const detailShardCache = new Map();

function detailKey(feature) {
  const renderIndex = wayIndex.get(feature);
  if (renderIndex !== undefined) return `way:${renderIndex}`;
  const kind = feature.kind || "feature";
  if (feature.osm_id !== undefined && feature.osm_id !== null && feature.osm_id !== "") {
    return `${kind}:osm:${feature.osm_id}`;
  }
  const point = feature.centroid || feature.point || (feature.points || [])[0] || [0, 0];
  const lon = Number(Number(point[0] || 0).toFixed(6));
  const lat = Number(Number(point[1] || 0).toFixed(6));
  return `${kind}:at:${lon}:${lat}:${feature.name || ""}`;
}

function featureLongitude(feature) {
  const point = feature.centroid || feature.point || (feature.points || [])[0];
  return point && point.length >= 2 ? Number(point[0]) : Number(DETAIL_MANIFEST.split_lon || 0);
}

async function fullDetailFeature(feature) {
  if (!feature || !(DETAIL_MANIFEST.shards || []).length) return feature;
  const lon = featureLongitude(feature);
  const side = lon < Number(DETAIL_MANIFEST.split_lon || 0) ? "west" : "east";
  const shard = DETAIL_MANIFEST.shards.find((candidate) => candidate.id === side)
    || DETAIL_MANIFEST.shards.find((candidate) =>
      lon >= candidate.bbox.west && lon <= candidate.bbox.east
    );
  if (!shard) return feature;
  let records = detailShardCache.get(shard.id);
  if (!records) {
    records = fetch(asset(shard.file), { cache: "no-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`detail shard ${response.status}`);
        return response.json();
      })
      .then((payload) => new Map((payload.features || []).map((row) => [row.key, row.fields])));
    detailShardCache.set(shard.id, records);
  }
  try {
    const fields = (await records).get(detailKey(feature));
    if (!fields) return feature;
    const full = { ...feature };
    for (const [field, value] of Object.entries(fields)) {
      if (value && !Array.isArray(value) && typeof value === "object"
          && full[field] && !Array.isArray(full[field]) && typeof full[field] === "object") {
        full[field] = { ...full[field], ...value };
      } else {
        full[field] = value;
      }
    }
    full._detailShard = shard.id;
    full._detailFieldCount = Object.keys(fields).length;
    full._renderIndex = wayIndex.get(feature);
    return full;
  } catch (error) {
    console.warn("Full feature detail could not be loaded; using render-complete record.", error);
    return { ...feature, _detailError: true };
  }
}

//: What OpenStreetMap records about getting in (scripts/fetch_access_osm.py): the entrances on
//: each building -- step-free or not, the door, steps -- and the places that say whether a
//: wheelchair gets in. Loaded the first time a building is asked about.
let ACCESS_DATA = null;
function accessData() {
  ACCESS_DATA ??= fetch(asset("sf-corridor-access.json"), { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.schema === "kerbside.access/1" ? d : null)).catch(() => null);
  return ACCESS_DATA;
}
async function accessLines(full) {
  const data = await accessData();
  if (!data || !Array.isArray(full.points)) return [];
  const id = Number(full.osm_id), out = [];
  const words = (e) => [e.entrance && e.entrance !== "yes" ? e.entrance : "", e.wheelchair === "yes" ? "step-free" : e.wheelchair === "no" ? "not step-free" : e.wheelchair === "limited" ? "limited access" : "",
    e.automatic_door && e.automatic_door !== "no" ? "automatic door" : "", e.door && e.door !== "no" ? `${e.door} door` : "", e.step_count ? `${e.step_count} steps` : "", e.ramp === "yes" ? "ramp" : ""].filter(Boolean).join(", ");
  const doors = data.entrances.filter((e) => e.building === id).map(words).filter(Boolean);
  if (doors.length) out.push(`Entrances: ${doors.slice(0, 4).join("; ")}${doors.length > 4 ? `; and ${doors.length - 4} more` : ""}`);
  const places = data.places.filter((p) => Array.isArray(p.p) && pointInRing(p.p[0], p.p[1], full.points));
  for (const p of places.slice(0, 3)) {
    const say = { yes: "wheelchair access", limited: "limited wheelchair access", no: "no wheelchair access" }[p.wheelchair] || `wheelchair: ${p.wheelchair}`;
    out.push(`${p.name}: ${say}${p["toilets:wheelchair"] === "yes" ? ", accessible toilet" : ""}${p["wheelchair:description"] ? ` (${p["wheelchair:description"]})` : ""}`);
  }
  if (out.length) out.push("Access: as published to OpenStreetMap (ODbL), not checked here");
  return out;
}

async function featureSummary(feature) {
  if (!feature) return null;
  const full = await fullDetailFeature(feature);
  const access = await accessLines(full).catch(() => []);
  const place = full.place || (full.google_places || [])[0] || {};
  const address = full.address || {};
  const parcel = full.parcel || {};
  const zoning = full.zoning || {};
  const lidar = full.datasf_building_height || {};
  const title = place.name || full.name || address.formatted || "Building";
  const certainty = houseCertainty(full);
  const lines = [
    `<b>${title}</b>`,
    `Certainty: ${certainty.level.toUpperCase()}; ${certainty.front}; ${certainty.appearance}; ${certainty.metricAccuracy}`,
    `Height basis: ${certainty.height}; unseen sides: ${certainty.unseenSides}`,
    address.formatted || place.formatted_address || "",
    full.archetype ? `Type: ${full.archetype.replaceAll("_", " ")}` : "",
    place.primary_type ? `Business: ${place.primary_type.replaceAll("_", " ")}` : "",
    full.land_use || zoning.district ? `Land use: ${full.land_use || zoning.district}` : "",
    zoning.code ? `Zoning: ${zoning.code}${zoning.district ? ` — ${zoning.district}` : ""}` : "",
    parcel.blklot ? `Parcel: ${parcel.blklot}` : "",
    parcel.planning_district ? `Planning district: ${parcel.planning_district}` : "",
    lidar.height_m ? `DataSF lidar height: ${Number(lidar.height_m).toFixed(2)} m (${lidar.height_method || "measured"})` : "",
    full.cnn_name ? `Street record: ${full.cnn_name}${full.cnn ? ` (CNN ${full.cnn})` : ""}` : "",
    feature.shape?.source === "lidar" ? `Roof: ${feature.shape.parts?.[0]?.roof || "shaped"}, read off the lidar` : "",
    ...access,
    full.sources ? `Sources: ${full.sources.join(", ")}` : "",
    full._detailShard ? `Full archive: ${full._detailFieldCount} restored fields · ${full._detailShard} shard` : "",
    full._detailError ? "Full archive: temporarily unavailable; showing render-complete record" : "",
  ].filter(Boolean);
  return lines.join("<br>");
}

function pickRayBuilding(origin,direction) {
  let best=null,bestT=Infinity;
  const seen=new Set();
  for(const bucket of footprintGrid.values())for(const entry of bucket) {
    if(seen.has(entry))continue;seen.add(entry);
    const floor=entry.way._treeClipBase??groundBaseFor(entry.way.points);
    const t=worldStreaming.rayPrism(origin,direction,entry.local,floor,entry.way._treeClipRoof??(floor+Math.max(3,entry.way.height_m || 10.5)));
    if(t===null || t>=bestT)continue;
    const x=origin[0]+t*direction[0],z=origin[2]+t*direction[2];
    if(BUILD_WINDOW && !BUILD_WINDOW.inside(midLon+x/metersPerLon,midLat-z/metersPerLat))continue;
    bestT=t;best={feature:entry.way,t};
  }
  return best;
}
function pickedFeature(clientX, clientY) {
  // Exact centre ray first, then an eight-pixel halo for narrow/edge-on facades.
  // Canonical prisms keep roofs/merged facade meshes and guest windows pickable.
  for(const [dx,dy] of [[0,0],[-8,0],[8,0],[0,-8],[0,8],[-6,-6],[6,-6],[-6,6],[6,6]]) {
    pointer.set(((clientX+dx)/innerWidth)*2-1,-((clientY+dy)/innerHeight)*2+1);
    ray.setFromCamera(pointer,camera);
    const feature=featureOnRay(ray.ray.origin,ray.ray.direction);
    if(feature)return feature;
  }
  return null;
}
//: The building a ray from `o` along `d` meets first, here or in the region drawn beside.
function featureOnRay(o,d) {
  let hit=hostWorldActive ? pickRayBuilding([o.x,o.y,o.z],[d.x,d.y,d.z]) : null;
  if(activeGuest?.ready) {
    const g=activeGuest;
    const other=g.api.pickRayBuilding([(o.x-g.ox)/g.sx,o.y-g.oy,o.z-g.oz],[d.x/g.sx,d.y,d.z]);
    if(other && (!hit || other.t<hit.t))hit=other;
  }
  return hit ? hit.feature : null;
}

function groundAt(clientX, clientY) {
  pointer.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  return groundOnRay();
}
//: What the picking ray meets first: the ground under it (groundUnderRay), or a deck over that
//: ground -- a bridge's, a highway's, an upper deck over a lower -- where the ray passes down
//: through the deck's surface on its way. A click on the Bay Bridge stands you on the bridge, on
//: the deck you clicked, not in the water under it.
function groundOnRay() {
  const ground = groundUnderRay();
  if (!ground || typeof structuresAt !== "function") return ground;
  const deck = deckOnRay(ground.distanceTo(ray.ray.origin));
  return deck || ground;
}
//: Where the ray first comes down through a deck's top, nearer than ``limit``, or null. Stepped
//: along the ray, finer near the eye, each step asking what is built there (structuresAt).
function deckOnRay(limit) {
  const o = ray.ray.origin, d = ray.ray.direction;
  if (d.y > -0.002) return null;
  let s = 0, previous = null;
  while (s <= limit) {
    const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
    if (previous) {
      for (const k of structuresAt(x, z)) {
        if (previous.y >= k.top - 0.05 && y <= k.top + 0.05) {
          const t = (previous.y - k.top) / Math.max(1e-6, previous.y - y);
          return new THREE.Vector3(previous.x + (x - previous.x) * t, k.top, previous.z + (z - previous.z) * t);
        }
      }
    }
    previous = { x, y, z };
    s += Math.max(0.4, s * 0.004);
  }
  return null;
}
//: The ground the picking ray (`ray`, set by the caller) meets first.
function groundUnderRay() {
  const guestMeshes=solids=>activeGuest?.ready && activeGuest.api.tunnelWalkMeshes
    ? activeGuest.api.tunnelWalkMeshes(solids) : [];
  const blocker=ray.intersectObjects(tunnelWalkMeshes(true).concat(guestMeshes(true)),false)[0]?.distance ?? Infinity;
  const tunnelHits=ray.intersectObjects(tunnelWalkMeshes().concat(guestMeshes(false)),false)
    .filter(h=>h.distance<blocker-.01);
  // The ground is the terrain where there is one -- a click on Russian Hill lands on the
  // hill, not on the sea-level plane under it -- and the flat plane elsewhere.
  if (terrainTiles.length || activeGuest?.ready || natureWorld) {
    const natureGround = natureWorld ? [...natureWorld.terrain.children] : [];
    const hits = ray.intersectObjects(activeGuest && activeGuest.ready
      ? [...terrainTiles, ...activeGuest.api.terrainTiles, ...natureGround] : [...terrainTiles,...natureGround], false);
    const visibleHits=hits.filter(h=>h.distance<blocker-.01
      && (h.object.userData.surface!=="terrain" || (activeGuest?.api.terrainTiles.includes(h.object)
        ? Boolean(guestUnder(h.point.x,h.point.z))
        : hostWorldActive && (!BUILD_WINDOW || BUILD_WINDOW.inside(midLon+h.point.x/metersPerLon,midLat-h.point.z/metersPerLat))))
      && !pointInTunnelVoid(h.point.x,h.point.y,h.point.z)
      && (!natureWorld || natureWorld.isVisibleGroundHit(h)));
    if (visibleHits.length) {
      if(tunnelHits.length && tunnelHits[0].distance<visibleHits[0].distance)return tunnelHits[0].point.clone();
      const hit = visibleHits[0].point.clone();
      hit.y = visibleHits[0].object.userData.surface==="nature_terrain"
        ? natureWorld.groundAt(hit.x,hit.z) ?? hit.y : hit.y + TERRAIN_MESH_UNDER_M;
      return hit;
    }
  }
  if(tunnelHits.length)return tunnelHits[0].point.clone();
  if(Number.isFinite(blocker))return null; // never click through a solid roof/wall into its floor
  const landing = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, landing) ? landing : null;
}

// Use surface street centrelines as safe destinations when a picked point is inside a
// building or the camera is too far away to choose a precise gap.
const streetLandingSegments = [];
for (const way of DATA.ways) {
  if (way.kind !== "street" || way.bridge || way.tunnel || !way.points) continue;
  for (let i = 1; i < way.points.length; i += 1) {
    const [ax, ay] = xy(...way.points[i - 1]);
    const [bx, by] = xy(...way.points[i]);
    const dx = bx - ax, dz = ay - by;
    if (dx * dx + dz * dz > 1) streetLandingSegments.push([ax, -ay, dx, dz]);
  }
}
//: The heading (as state.yaw) along the street nearest (x, z), or NaN with none near.
function streetHeadingAt(x, z) {
  let best = null;
  for (const [ax, az, dx, dz] of streetLandingSegments) {
    const len2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (!best || d < best.d) best = { d, dx, dz };
  }
  return best && best.d < 60 ? Math.atan2(-best.dx, -best.dz) : NaN;
}
function eligibleLanding(landing, forceStreet = false) {
  if (!landing) return null;
  // Consult the owner of the clicked point, never the original city's segments.
  const guest=guestUnder(landing.x,landing.z);
  if(guest) {
    const [x,z]=hostToGuest(guest,landing.x,landing.z);
    const at=guest.api.eligibleLanding({x,y:landing.y-guest.oy,z},forceStreet);
    return at ? new THREE.Vector3(guest.ox+at.x*guest.sx,guest.oy+at.y,guest.oz+at.z) : null;
  }
  // Far outside the loaded window, retain the clicked point. The destination
  // window resolves its exterior after loading instead of snapping across cities.
  const lon=midLon+landing.x/metersPerLon,lat=midLat-landing.z/metersPerLat;
  if(!hostWorldActive || !tileOwnGround(lon,lat))return landing;
  if (!forceStreet && undergroundLanding(landing)) return landing;
  if (!forceStreet && !buildingAt(landing.x, landing.z)) return landing;
  let best = null, bestD2 = 150 ** 2;
  for (const [ax, az, dx, dz] of streetLandingSegments) {
    const t = Math.max(0, Math.min(1, ((landing.x - ax) * dx + (landing.z - az) * dz) / (dx * dx + dz * dz)));
    const x = ax + t * dx, z = az + t * dz;
    const d2 = (x - landing.x) ** 2 + (z - landing.z) ** 2;
    if (d2 >= bestD2 || buildingAt(x, z)) continue;
    best = new THREE.Vector3(x, 0, z);
    bestD2 = d2;
  }
  return best || (!buildingAt(landing.x, landing.z) ? landing : null);
}

function addressLanding(landing) {
  // An address is not permission to teleport through a wall. Arrive just
  // outside its available entrance, looking into the same door used by walking.
  const building = buildingAt(landing.x, landing.z);
  const entry = building && footprintById.get(String(building.osm_id));
  for (const door of entry?.doors || []) {
    const x = door.cx - door.nx * 1.5, z = door.cz - door.nz * 1.5;
    if (buildingAt(x, z)) continue;
    state.yaw = Math.atan2(-door.nx, -door.nz);
    state.look = 0;
    return new THREE.Vector3(x, 0, z);
  }
  return eligibleLanding(landing);
}

// The visible walker stays outside every canonical footprint, even at open doors.
// Camera/interior inspection is independent; GPS uncertainty never authorizes entry.
function undergroundLanding(landing) {
  return landing && Number.isFinite(landing.y)
    && (Boolean(tunnelSurfaceAt(landing.x,landing.z,landing.y))
      || Boolean(approachPassageAt(landing.x,landing.z,landing.y)));
}

function exteriorLanding(landing) {
  if(typeof undergroundLanding === "function" && undergroundLanding(landing))return landing;
  if (!landing || !buildingAt(landing.x, landing.z)) return landing;
  const way = buildingAt(landing.x, landing.z);
  const entry = footprintById.get(String(way.osm_id));
  // The one exception: the house the walker went into through its door (toggleDoor).
  if (entry && typeof enteredEntry !== "undefined" && entry === enteredEntry) return landing;
  const candidates = [];
  const clearance = WALKER_RADIUS_M + 0.10;
  for (let i = 1; entry && i < entry.local.length; i += 1) {
    const [ax, az] = entry.local[i - 1], [bx, bz] = entry.local[i];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((landing.x - ax) * dx + (landing.z - az) * dz) / len2));
    const qx = ax + t * dx, qz = az + t * dz, len = Math.sqrt(len2);
    for (const sign of [-1, 1]) {
      const x = qx + sign * dz / len * clearance, z = qz - sign * dx / len * clearance;
      if (!buildingAt(x, z)) candidates.push({x, z, d: (x - landing.x) ** 2 + (z - landing.z) ** 2});
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0] || eligibleLanding(landing, true);
}

function walkerExteriorAt(x, z, referenceY) {
  const guest = typeof guestUnder === "function" && activeGuest ? guestUnder(x, z) : null;
  if (guest?.ready && guest.api.exteriorLanding) {
    const [gx, gz] = hostToGuest(guest, x, z);
    const at = guest.api.exteriorLanding({x: gx, z: gz,
      y:Number.isFinite(referenceY) ? referenceY-guest.oy : undefined});
    return at ? {x: guest.ox + at.x * guest.sx, z: guest.oz + at.z} : null;
  }
  return exteriorLanding({x, z,y:referenceY});
}

function keepWalkerOutside() {
  // In the game, inside a shop (its room is built on its own floor): the shop's walls hold the walker.
  if (Number.isFinite(state.floorY)) return;
  // A canonical building may be above a real bore. Its 2D footprint is not a
  // wall at the tunnel level; the bore's own shell contains the walker there.
  const underground=typeof occupiedTunnelAt === "function"
    ? occupiedTunnelAt(avatar.position.x,avatar.position.z,walkerFeetY()) : null;
  if(underground || (typeof occupiedApproachAt === "function"
      && occupiedApproachAt(avatar.position.x,avatar.position.z,walkerFeetY()))) return;
  // An evidence-backed recessed stairwell is exterior, not an interior room.
  if(typeof walkableStairRecessAt === "function" && walkableStairRecessAt(avatar.position.x,avatar.position.z))return;
  const at = walkerExteriorAt(avatar.position.x, avatar.position.z);
  if (!at) { avatar.visible = false; return; }
  if (Math.hypot(at.x - avatar.position.x, at.z - avatar.position.z) < 1e-6) return;
  avatar.position.set(at.x, AVATAR_STAND_Y + walkerGroundAt(at.x, at.z), at.z);
  state.target.copy(avatar.position);
  state.indoors = false;
}

//: Whether the walker keeps to where your device says you are (followGps). It does from the first
//: fix until you move it yourself -- the arrows, a click, a teleport, a pin -- and then stays
//: where you put it until R or Reset view brings it back (var: goTo can run before gps exists).
var GPS_LEASH = { on: true };
// A click moves the walker without changing zoom; dragging and wheel zoom never move it.
function goTo(landing, options = {}) {
  goToNow(landing, options);
}
//: How long a detail window takes to build here, in seconds a square kilometre: from the windows
//: built so far (smoothed), before any the page's own first build; DETAIL_FIRST_SECONDS for a
//: region whose page has not been fetched yet (its code, its manifest, its first cells).
let detailSecondsPerKm2 = null;
const DETAIL_DEFAULT_SECONDS = 8, DETAIL_FIRST_SECONDS = 1.5;
const detailRegionsSeen = new Set();
function noteDetailBuild(seconds, boxes) {
  const km2 = Math.max(0.01, windowAreaKm2(boxes));
  if (!(seconds > 0)) return;
  const rate = seconds / km2;
  detailSecondsPerKm2 = detailSecondsPerKm2 === null ? rate : detailSecondsPerKm2 * 0.6 + rate * 0.4;
}
function windowAreaKm2(boxes) {
  let area = 0;
  for (const b of boxes || []) area += Math.max(0, (b[2] - b[0]) * metersPerLon) * Math.max(0, (b[3] - b[1]) * metersPerLat) / 1e6;
  return area;
}
//: Whether the window drawn in full has the page point (x, z) in it.
function detailCovers(at) {
  const lon = midLon + at.x / metersPerLon, lat = midLat - at.z / metersPerLat;
  const region = typeof regionAt === "function" ? regionAt(lon, lat) : null;
  if (!region) return true;  // the open country: the landscape alone
  const owner = activeGuest;
  if (owner ? owner.region !== region : region !== REGION_INDEX.host || !hostWorldActive) return false;
  const boxes = owner?.windowBoxes || (owner?.windowBox ? [owner.windowBox] : BUILD_WINDOW ? [BUILD_WINDOW.box] : null);
  return !boxes || boxes.some((b) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
}
//: The page's own first window is the first measure of how fast this device builds: from the
//: page starting to its streets and ground standing (fetching included, as an arrival's is).
let firstBuildNoted = false;
function noteFirstBuild() {
  if (firstBuildNoted || ATTACH || !BUILD_WINDOW || !window.kerbsideReady?.streets || !window.kerbsideReady?.ground) return;
  firstBuildNoted = true;
  const started = window.kerbsideBoot?.startedAt;
  if (started) noteDetailBuild((Date.now() - started) / 1000, [BUILD_WINDOW.box]);
  if (REGION_INDEX.host) detailRegionsSeen.add(REGION_INDEX.host.name);
}
function goToNow(landing, { travel = false, zoom = false } = {}) {
  if (!landing) return;
  // Exploring there is no walker to send: the view goes, and comes in close as it would.
  if (state.explore && travel) {
    if (zoom) state.dist = ARRIVAL_DIST;
    state.target.set(landing.x, walkerGroundAt(landing.x, landing.z,landing.y), landing.z);
    placeCamera();
    return;
  }
  const pickedHeight=Number.isFinite(landing.y) && landing.y!==0 ? landing.y : undefined;
  const pickedX=landing.x,pickedZ=landing.z;
  if (travel) landing = walkerExteriorAt(landing.x, landing.z,pickedHeight);
  if (!landing) return;
  if (travel && GPS_LEASH) GPS_LEASH.on = false;
  // The ground where the click landed: the terrain's height, or the bore's floor inside a
  // tunnel. The orbit target and the walker's feet both stand on it.
  // Destination height, not the previous location's feet, selects the level. A
  // surface click above a tunnel must not teleport the walker into its bore.
  // A jump to a bridge's span (no pick: search, the map) stands on its deck, not in the water
  // under it: with no height, walkerGroundInfo stands on a deck over the water.
  const landingY=Number.isFinite(pickedHeight) && Math.hypot(pickedX-landing.x,pickedZ-landing.z)<.01
    ? pickedHeight : typeof elevatedDecksAt === "function" && elevatedDecksAt(landing.x,landing.z).length
      ? null : groundLiftAt(landing.x,landing.z);
  const ground = walkerGroundAt(landing.x, landing.z, landingY);
  if (travel && typeof walkerOnWater === "function" && walkerOnWater(landing.x, landing.z, ground)) {
    if (addrBox) { addrBox.textContent = "That is open water: click the shore, a pier or a bridge's deck."; addrBox.hidden = false; }
    return;
  }
  if (travel) {
    avatar.position.set(landing.x, AVATAR_STAND_Y + ground, landing.z);
    if (zoom) state.dist = ARRIVAL_DIST;
  }
  state.target.set(landing.x, (travel ? AVATAR_STAND_Y : 0) + ground, landing.z);
  placeCamera();
}

canvas.addEventListener("pointerup", (e) => {
  // A drag is an orbit, not a destination. Only a press that barely moved counts as a click.
  if (Number.isFinite(pressedAt[0]) && Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > 5) return;
  if (e.button === 2) return;   // a right click (a trackpad's two-finger tap) does nothing
  // A region marker first: it opens that region's page.
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  // In the game a click is the city's (a shop's checkout panel, else a swing); nobody is flown.
  if (cityGame()) { if (e.button === 0 && typeof livingCity !== "undefined" && livingCity?.click) livingCity.click(ray); return; }
  if(e.button===0 && activateBillboard(ray))return;
  // A marker is a place across the bay, not a link to another page: clicking one flies you
  // to it in the world you are already in.
  const marker = ray.intersectObjects(regionMarkers.children, false).find((h) => h.object.userData.href);
  if (marker) {
    const region = marker.object.userData.region;
    if (region && window.kerbsideFlyToRegion) window.kerbsideFlyToRegion(region);
    else location.href = marker.object.userData.href;
    return;
  }
  if (e.button !== 0) return;
  const landing = eligibleLanding(groundAt(e.clientX, e.clientY));
  if (landing) goTo(landing, { travel: true });
});

// The address, where the building is. Every footprint carries the parcel it stands on and the
// address the city has for it, so this is a lookup rather than a guess -- 15,673 of the 15,984
// buildings have one.
const addrBox = document.getElementById("addr");

function hideAddress() { if (addrBox) { addrBox.hidden = true; addrBox.style.pointerEvents = ""; } }

function showAddress(feature, clientX, clientY) {
  if (!addrBox) return false;
  const address = feature.address || {};
  const parcel = feature.parcel || {};
  const line = address.formatted
    || [address.house_number, address.street].filter(Boolean).join(" ");
  if (!line && !feature.name && feature.kind !== "building") return false;
  const rest = [
    feature.name && line ? feature.name : "",
    ...(feature.tenant_names || []).map(s=>s.n.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))),
    feature.inferredShop ? "Shopfront inferred: zoned for shops, between named ones; its name is not known" : "",
    parcel.blklot ? `Parcel ${parcel.blklot}` : "",
    parcel.analysis_neighborhood || "",
    `Certainty: ${houseCertainty(feature).level.toUpperCase()}; ${houseCertainty(feature).front}; ${houseCertainty(feature).metricAccuracy}`,
  ].filter(Boolean);
  addrBox.innerHTML = `<b>${line || feature.name || `Building ${feature.osm_id}`}</b>`
    + (rest.length ? `<br><span class="sub">${rest.join(" &middot; ")}</span>` : "");
  addrBox.hidden = false;
  // Placed after it is measurable, and kept inside the window rather than half off the edge.
  const box = addrBox.getBoundingClientRect();
  addrBox.style.left = `${Math.min(clientX + 12, innerWidth - box.width - 12)}px`;
  addrBox.style.top = `${Math.min(clientY + 12, innerHeight - box.height - 12)}px`;
  return true;
}

//: Every level a walker could stand on at (x, z), lowest first: the ground (the street, the
//: pavement, the hill) and each deck over it -- a highway's, a bridge's, both of the Bay Bridge's.
function levelsAt(x, z) {
  const out = [walkerGroundAt(x, z, -1e6)];
  for (const d of (typeof structuresAt === "function" ? structuresAt(x, z) : [])) out.push(d.top);
  out.sort((a, b) => a - b);
  return out.filter((y, i) => i === 0 || y - out[i - 1] > 1.5);
}
//: PageUp / PageDown: to the next level up or down where you stand -- onto the bridge over the
//: street, down from the upper deck to the lower, back to the ground.
addEventListener("keydown", (e) => {
  if ((e.key !== "PageUp" && e.key !== "PageDown") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || state.explore) return;
  if (typeof livingCity !== "undefined" && (livingCity?.driving || livingCity?.riding || livingCity?.inside)) return;
  const x = avatar.position.x, z = avatar.position.z, feet = walkerFeetY();
  const levels = levelsAt(x, z);
  const next = e.key === "PageUp" ? levels.find((y) => y > feet + 1) : [...levels].reverse().find((y) => y < feet - 1);
  e.preventDefault();
  if (next === undefined) return;
  avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(x, z, next);
  state.target.copy(avatar.position);
  placeCamera();
  if (addrBox) { addrBox.textContent = `Level ${levels.indexOf(next) + 1} of ${levels.length} here (${Math.round(next)} m)`; addrBox.hidden = false; }
});

canvas.addEventListener("contextmenu", (e) => {
  // No teleport on a right click: on a trackpad a two-finger tap is a right click, and one
  // landed in the middle of a pinch zoom flew the walker to wherever the fingers were. A click
  // moves the walker; search and pins go further.
  e.preventDefault();
  // In the game, a right click uses what you hold (eat, drink, wear: U).
  if (cityGame() && typeof livingCity !== "undefined" && livingCity?.useSelected) livingCity.useSelected();
});
canvas.addEventListener("pointerdown", hideAddress);
addEventListener("keydown", (e) => { if (e.key === "Escape") hideAddress(); });

// S: what is under the pointer. A building gives its address; a street its name. Only with
// the map panel closed -- with it open, S is a letter typed into the search.
let pointerAt = null;
canvas.addEventListener("pointermove", (e) => { pointerAt = [e.clientX, e.clientY]; });
function streetNameAt(x, z) {
  const guest=guestUnder(x,z);
  if(guest){const p=hostToGuest(guest,x,z);return guest.api.streetNameAt(...p);}
  let best = null;
  for (const way of DATA.ways) {
    // The bus lanes down Van Ness are not the street a walker is on: the avenue is.
    if (way.kind !== "street" || !way.name || !way.points || way.busway) continue;
    for (let i = 1; i < way.points.length; i += 1) {
      const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
      const [bx, by] = xy(way.points[i][0], way.points[i][1]);
      const d = distanceToSegmentSquared(x, z, ax, -ay, bx, -by);
      if (!best || d < best.d) best = { d, name: way.name, half: renderedRoadWidth(way) / 2 };
    }
  }
  return best && Math.sqrt(best.d) <= best.half + 4 ? best.name : null;
}
//: The busways' own names: lanes down the middle of an avenue, never a cross street.
const BUSWAY_NAMES = new Set(BUSWAY_WAYS.map((way) => way.name).filter(Boolean));
//: The cross streets either side of a point on a street: the corners at the ends of its block.
//: Within a corner's width the point is at that corner, and the next corners each way are given.
const AT_CORNER_M = 18;
function crossStreetsAt(x, z, name) {
  const guest=guestUnder(x,z);
  if(guest){const p=hostToGuest(guest,x,z);return guest.api.crossStreetsAt(...p,name);}
  // The street's own direction here, from its nearest segment.
  let best = null;
  for (const way of DATA.ways) {
    if (way.kind !== "street" || way.name !== name || !way.points) continue;
    for (let i = 1; i < way.points.length; i += 1) {
      const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
      const [bx, by] = xy(way.points[i][0], way.points[i][1]);
      const d = distanceToSegmentSquared(x, z, ax, -ay, bx, -by);
      if (!best || d < best.d) best = { d, ux: bx - ax, uz: -(by - ay) };
    }
  }
  const out = { at: null, ahead: null, behind: null, next: [] };
  if (!best) return out;
  const length = Math.hypot(best.ux, best.uz) || 1;
  const ux = best.ux / length, uz = best.uz / length;
  const sides = { ahead: new Map(), behind: new Map() };
  let atCorner = null;
  for (const c of DATA.intersections || []) {
    if (c.a !== name && c.b !== name) continue;
    const other = c.a === name ? c.b : c.a;
    if (!other || other === name || BUSWAY_NAMES.has(other)) continue;
    const [cx, cy] = xy(c.lon, c.lat);
    const dx = cx - x, dz = -cy - z;
    const along = dx * ux + dz * uz;
    // A corner of this street, not of a namesake a few blocks over or across a bend.
    if (Math.abs(dx * uz - dz * ux) > 40 || Math.abs(along) > 600) continue;
    const distance = Math.hypot(dx, dz);
    if (distance <= AT_CORNER_M && (!atCorner || distance < atCorner.distance)) atCorner = { other, distance, along };
    const side = along >= 0 ? sides.ahead : sides.behind;
    if (!side.has(other) || Math.abs(along) < side.get(other)) side.set(other, Math.abs(along));
  }
  const nearest = (side, skip) => [...side.entries()].filter(([n]) => n !== skip)
    .sort((p, q) => p[1] - q[1]).map(([n]) => n);
  if (atCorner) {
    out.at = atCorner.other;
    out.next = [nearest(sides.behind, atCorner.other)[0], nearest(sides.ahead, atCorner.other)[0]].filter(Boolean);
  } else {
    out.ahead = nearest(sides.ahead)[0] || null;
    out.behind = nearest(sides.behind)[0] || null;
  }
  return out;
}

//: What is in the middle of the headset's view: a house's address, or the street and its cross
//: streets. {title, lines} or null. The ray from the eye straight ahead.
function describeAhead() {
  const o = new THREE.Vector3(), d = new THREE.Vector3();
  camera.getWorldPosition(o); camera.getWorldDirection(d);
  const feature = featureOnRay(o, d);
  if (feature && feature.kind === "building") {
    const address = feature.address || {};
    const line = address.formatted || [address.house_number, address.street].filter(Boolean).join(" ");
    const lines = [feature.name && line ? feature.name : "", ...(feature.tenant_names || []).slice(0, 2).map((t) => t.n),
      feature.parcel?.analysis_neighborhood || ""].filter(Boolean);
    // "41 White Street" on the first line; the city and zip under it.
    const [street, ...rest] = (line || "").split(",").map((part) => part.trim());
    if (rest.length) lines.unshift(rest.join(", "));
    if (line || feature.name) return { title: street || feature.name, lines };
  }
  ray.ray.origin.copy(o); ray.ray.direction.copy(d); ray.near = 0; ray.far = Infinity;
  let ground = groundOnRay();
  // Looking level down the street the ray meets no ground near: the street a few metres ahead.
  if (!ground || Math.hypot(ground.x - o.x, ground.z - o.z) > 80) {
    const flat = Math.hypot(d.x, d.z) || 1;
    ground = new THREE.Vector3(avatar.position.x + d.x / flat * 6, 0, avatar.position.z + d.z / flat * 6);
  }
  const name = streetNameAt(ground.x, ground.z) || streetNameAt(avatar.position.x, avatar.position.z);
  if (!name) return null;
  const cross = crossStreetsAt(ground.x, ground.z, name);
  const lines = cross.at ? [`at ${cross.at}`, cross.next.length ? `next: ${cross.next.join(" · ")}` : ""]
    : cross.behind && cross.ahead ? [`between ${cross.behind} and ${cross.ahead}`]
    : cross.behind || cross.ahead ? [`near ${cross.behind || cross.ahead}`] : [];
  return { title: name, lines: lines.filter(Boolean) };
}
addEventListener("keydown", async (e) => {
  if (e.key !== "s" && e.key !== "S") return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (document.getElementById("hud")?.dataset.open === "true" || !pointerAt || !addrBox) return;
  const [cx, cy] = pointerAt;
  const feature = pickedFeature(cx, cy);
  if (feature && feature.kind === "building" && showAddress(feature, cx, cy)) {
    offerExteriorEdit(feature);
    // And everything known about it, in the panel: its full record is fetched on demand.
    const summary = await featureSummary(feature);
    if (summary && tip) tip.innerHTML = summary;
    return;
  }
  const ground = groundAt(cx, cy);
  const name = ground ? streetNameAt(ground.x, ground.z) : null;
  if (!name) { hideAddress(); return; }
  const clean = (text) => text.replace(/[<>&]/g, "");
  const cross = crossStreetsAt(ground.x, ground.z, name);
  const detail = cross.at
    ? `at ${clean(cross.at)}${cross.next.length ? `<br><span style="opacity:.75">next: ${cross.next.map(clean).join(" · ")}</span>` : ""}`
    : cross.behind && cross.ahead ? `between ${clean(cross.behind)} and ${clean(cross.ahead)}`
    : cross.behind || cross.ahead ? `near ${clean(cross.behind || cross.ahead)}` : "";
  addrBox.innerHTML = `<b>${clean(name)}</b>${detail ? `<br>${detail}` : ""}`;
  addrBox.hidden = false;
  const box = addrBox.getBoundingClientRect();
  addrBox.style.left = `${Math.min(cx + 12, innerWidth - box.width - 12)}px`;
  addrBox.style.top = `${Math.min(cy + 12, innerHeight - box.height - 12)}px`;
});

