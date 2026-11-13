// ---- pins: 1, 2 and 3 ------------------------------------------------------------------------
//
// A number key drops that pin on the ground under the pointer (under the walker where there is no
// pointer); once it is down, the same key takes the walker back to it. Shift and the number moves
// it to the pointer; the number then Delete (or Backspace) takes it away. Three, no more. Typing in a field -- the search, the directions -- is never a
// pin. Kept in this browser, per page.
const PIN_COUNT = 3;
const PIN_COLOURS = [0xe0402f, 0x2f6fe0, 0xe0a52f];
const PIN_KEY = `kerbside:pins:${location.pathname}`;
const pinGroup = new THREE.Group();
pinGroup.name = "pins";
if (!ATTACH) root.add(pinGroup);
const pins = new Array(PIN_COUNT).fill(null);
//: Markers kept findable from any height: drawn at their own size (``base`` times the model's)
//: up close and, past ``near`` metres from the eye, grown with the distance so they keep their
//: size on the screen -- zoomed out over the whole city a pin is still there to find. A marker
//: of height h is h * base / near radians tall from there: about 0.04, forty pixels on a laptop
//: (it was 0.13, a pin a seventh of the screen high). Each stands on the ground at x, z.
const findableMarkers = new Set();
const markerAt = new THREE.Vector3();
function keepMarkersFindable() {
  for (const marker of findableMarkers) {
    if (!marker.object.visible) continue;
    marker.object.getWorldPosition(markerAt);
    marker.object.scale.setScalar((marker.base || 1) * Math.max(1, camera.position.distanceTo(markerAt) / marker.near));
  }
}
//: A pin for a place (a search's, a route's ends): drawn over everything, as a map's pins are --
//: over the route's ribbon and through the houses -- in that order. It goes in the transparent
//: pass: that is drawn after every opaque thing, render order or not, so an opaque pin without a
//: depth test was painted over by the see-through ground near the street. And three sorts that
//: pass by the nearest group's render order first: the tile tree's groups carry their depth (up
//: to 8), so the pin's own group carries its order too, or the tiles' ground went over it.
function pinOnTop(object, order = 27) {
  if (object.isGroup) object.renderOrder = order;
  object.traverse((o) => {
    if (!o.material) return;
    o.material.depthTest = false; o.material.depthWrite = false; o.material.transparent = true;
    o.renderOrder = o.isSprite ? order + 3 : order;
  });
  return object;
}
const pinToast = ATTACH ? null : document.createElement("div");
if (pinToast) {
  pinToast.id = "pin-toast";
  pinToast.setAttribute("role", "status");
  pinToast.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:40;"
    + "background:rgba(17,24,39,.88);color:#fff;font:600 13px/1.3 system-ui,sans-serif;padding:8px 14px;"
    + "border-radius:999px;pointer-events:none;opacity:0;transition:opacity .25s";
  document.body.append(pinToast);
}
let pinToastTimer = 0;
function pinSay(text) {
  if (!pinToast) return;
  pinToast.textContent = text;
  pinToast.style.opacity = "1";
  clearTimeout(pinToastTimer);
  pinToastTimer = setTimeout(() => { pinToast.style.opacity = "0"; }, 1800);
}
function pinLabel(n, colour) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = `#${colour.toString(16).padStart(6, "0")}`;
  g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill();
  g.lineWidth = 4; g.strokeStyle = "#fff"; g.stroke();
  g.fillStyle = "#fff"; g.font = "bold 38px system-ui,sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 32, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.renderOrder = 30;
  return sprite;
}
function placePin(i, x, z) {
  if (pins[i]) { pinGroup.remove(pins[i].mesh); findableMarkers.delete(pins[i].marker); }
  const colour = PIN_COLOURS[i];
  const mesh = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), material);
  stem.position.y = 1.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), material);
  head.position.y = 2.55;
  const label = pinLabel(i + 1, colour);
  label.position.y = 3.6;
  label.scale.set(1.4, 1.4, 1);
  mesh.add(stem, head, label);
  mesh.position.set(x, walkerGroundAt(x, z), z);
  mesh.userData.liftedOntoGround = true;
  pinGroup.add(mesh);
  const marker = { object: mesh, near: 110, x, z };
  findableMarkers.add(marker);
  pins[i] = { x, z, mesh, label, marker };
}
function savePins() {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify(pins.map((p) => (p ? [+p.x.toFixed(2), +p.z.toFixed(2)] : null))));
  } catch (error) { /* this visit only */ }
}
try {
  const saved = JSON.parse(localStorage.getItem(PIN_KEY) || "null");
  if (!ATTACH && Array.isArray(saved)) {
    saved.slice(0, PIN_COUNT).forEach((p, i) => {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) placePin(i, p[0], p[1]);
    });
  }
} catch (error) { /* no saved pins, or storage unavailable */ }
// The ground under a pin can arrive after it does (a saved pin, the terrain still loading):
// each stands on whatever ground there is now.
// (Unreferenced: run headless -- tools/unreal/export_tiles.mjs -- it must not keep Node alive.)
if (!ATTACH) setInterval(() => {
  for (const marker of findableMarkers) marker.object.position.y = walkerGroundAt(marker.x, marker.z);
}, 2000)?.unref?.();
//: Whether a key press belongs to a field being typed in rather than to the map.
function typingIn(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement || Boolean(target?.isContentEditable);
}
function pinKey(e) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || "");
  const n = m ? Number(m[1]) : Number(e.key);
  return Number.isInteger(n) && n >= 1 && n <= PIN_COUNT ? n - 1 : -1;
}
//: How long after its number a Delete still means that pin.
const PIN_DELETE_WINDOW_MS = 4000;
let pinChosen = null;
//: Takes pin i away: its marker, its place in this browser.
function removePin(i) {
  if (!pins[i]) return false;
  pinGroup.remove(pins[i].mesh);
  findableMarkers.delete(pins[i].marker);
  pins[i] = null;
  savePins();
  return true;
}
//: The number, then Delete or Backspace: the pin of that number goes (held together, or the
//: Delete within a few seconds of the number).
function pinToDelete(e, chosen, now) {
  if (e.key !== "Delete" && e.key !== "Backspace") return -1;
  return chosen && (chosen.held || now - chosen.at <= PIN_DELETE_WINDOW_MS) ? chosen.i : -1;
}
addEventListener("keydown", (e) => {
  if (ATTACH || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (typingIn(e.target) || typingIn(document.activeElement)) return;
  if (cityGame()) return;   // in the game the number keys choose from the bar
  // The key's own time, not the page's: a frame busy building must not run the window out.
  const doomed = pinToDelete(e, pinChosen, e.timeStamp);
  if (doomed >= 0) {
    e.preventDefault();
    pinChosen = null;
    pinSay(removePin(doomed) ? `Pin ${doomed + 1} deleted` : `No pin ${doomed + 1} to delete`);
    return;
  }
  const i = pinKey(e);
  if (i < 0) return;
  e.preventDefault();
  pinChosen = { i, at: e.timeStamp, held: true };
  if (pins[i] && !e.shiftKey) {
    // Back to the pin: the walker stands beside it, on the street if it is in a building.
    // Brought in to street level, from however far out the view was.
    const landing = eligibleLanding(new THREE.Vector3(pins[i].x, 0, pins[i].z)) || new THREE.Vector3(pins[i].x, 0, pins[i].z);
    hideAddress();
    if (state.firstPerson) setFirstPerson(false);
    goTo(landing, { travel: true, zoom: true });
    pinSay(`Back at pin ${i + 1} — Delete removes it`);
    return;
  }
  const ground = pointerAt ? groundAt(pointerAt[0], pointerAt[1]) : null;
  const x = ground ? ground.x : avatar.position.x, z = ground ? ground.z : avatar.position.z;
  const moved = Boolean(pins[i]);
  placePin(i, x, z);
  savePins();
  pinSay(moved ? `Pin ${i + 1} moved — press ${i + 1} to come back` : `Pin ${i + 1} dropped — press ${i + 1} to come back`);
});
addEventListener("keyup", (e) => {
  if (pinChosen && pinKey(e) === pinChosen.i) pinChosen.held = false;
});
//: Settings' "Clear pins".
function clearPins() {
  for (let i = 0; i < PIN_COUNT; i += 1) removePin(i);
  savePins();
}

// ---- the compass ------------------------------------------------------------------------------
//
// A compass rose in the corner, turned so its north is the world's north as the view looks, and
// a red arrow that is the way the walker is going: up the middle when it walks the way the view
// looks or stands still, turned with it when it walks another way. The bearing is under it.
// Only the page's own: a region drawn as a guest in it has no screen of its own to put one on.
const compass = ATTACH ? null : document.createElement("div");
if (compass) {
  compass.id = "compass";
  compass.setAttribute("aria-label", "Compass");
  compass.style.cssText = "position:fixed;right:16px;top:16px;z-index:25;width:64px;height:80px;"
    + "pointer-events:none;font:600 10px/1 system-ui,sans-serif;color:#1d2a33;text-align:center";
  compass.innerHTML = `<svg viewBox="-50 -50 100 100" width="64" height="64">
  <circle r="47" fill="rgba(255,255,255,.88)" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>
  <g id="compass-rose">
    <path d="M0,-38 L6,-6 L38,0 L6,6 L0,38 L-6,6 L-38,0 L-6,-6 Z" fill="#c8d0d6" stroke="#7d8a93" stroke-width="0.8"/>
    <path d="M0,-38 L6,-6 L0,0 Z M38,0 L6,6 L0,0 Z M0,38 L-6,6 L0,0 Z M-38,0 L-6,-6 L0,0 Z" fill="#7d8a93"/>
    <path d="M27,-27 L4,-4 L-27,27 L-4,4 Z M-27,-27 L-4,4 L27,27 L4,-4 Z" fill="#dfe4e7" opacity=".9"/>
    <text y="-40" font-size="11" text-anchor="middle" dominant-baseline="middle" fill="#b4282e">N</text>
    <text x="40" font-size="9" text-anchor="middle" dominant-baseline="middle">E</text>
    <text y="41" font-size="9" text-anchor="middle" dominant-baseline="middle">S</text>
    <text x="-40" font-size="9" text-anchor="middle" dominant-baseline="middle">W</text>
  </g>
  <path id="compass-arrow" d="M0,-30 L7,-12 L2,-14 L2,10 L-2,10 L-2,-14 L-7,-12 Z" fill="#d23a2c" stroke="#7a1c14" stroke-width="0.8"/>
</svg><div id="compass-reading" style="margin-top:2px;background:rgba(255,255,255,.88);border-radius:6px;padding:3px 0"></div>`;
  document.body.append(compass);
}
const compassRose = compass?.querySelector("#compass-rose");
const compassReading = compass?.querySelector("#compass-reading");
const compassArrow = compass?.querySelector("#compass-arrow");
const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compassForward = new THREE.Vector3();
let compassShown = null;
const bearingOf = (east, north) => (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
//: The way the view looks and the way the walker is going, in degrees clockwise from north.
function compassBearings(now = performance.now()) {
  camera.getWorldDirection(compassForward);
  const view = Math.hypot(compassForward.x, compassForward.z) > 1e-6
    ? bearingOf(compassForward.x, -compassForward.z) : (compassShown?.view ?? 0);
  const move = avatar.userData.lastMove;
  const going = move && now - move[2] < 600 ? bearingOf(move[0], -move[1]) : view;
  return { view, going };
}
function updateCompass(now) {
  if (!compass) return;
  const { view, going } = compassBearings(now);
  const key = `${Math.round(view)}:${Math.round(going)}`;
  if (compassShown && compassShown.key === key) return;
  compassShown = { key, view };
  compassRose.setAttribute("transform", `rotate(${-view})`);
  compassArrow.setAttribute("transform", `rotate(${going - view})`);
  const heading = Math.round(going) % 360;
  compassReading.textContent = `${COMPASS_POINTS[Math.round(heading / 45) % 8]} ${heading}°`;
}

// ---- the compass box: turn the walker, move the sun ------------------------------------------
//
// Click the compass: a larger rose opens with the walker's heading on its red needle -- drag the
// needle (or use the arrow keys) and the walker turns to face that way. Under it, the day's sun
// path as a semicircle from sunrise on the left to sunset on the right, the sun a blue dot on it
// where the sun is now. Drag the dot and the sun moves across the sky, the time it stands for
// shown as it goes; ‹ › step a day back or forward. The sky then shows the weather a National
// Weather Service station observed at that hour (sky-history.mjs) -- for an hour still to come,
// the day before's at that hour. R puts the sky back on live San Francisco time.
const SF_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short",
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const SF_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
const sunDial = { open: false, date: null, sunCalc: null, history: null, ask: 0, timer: 0, dragging: null };
const sunDialBox = compass ? document.createElement("div") : null;
if (sunDialBox) {
  sunDialBox.id = "sun-dial";
  sunDialBox.setAttribute("role", "dialog");
  sunDialBox.setAttribute("aria-label", "Heading and sun");
  sunDialBox.hidden = true;
  sunDialBox.style.cssText = "position:fixed;right:16px;top:104px;z-index:26;width:272px;max-width:calc(100vw - 32px);"
    + "background:rgba(255,255,255,.95);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.28);padding:12px 12px 10px;"
    + "font:500 12px/1.35 system-ui,sans-serif;color:#1d2a33;user-select:none;touch-action:none";
  sunDialBox.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center">
  <strong style="font-size:13px">Heading &amp; sun</strong>
  <button id="sun-dial-close" aria-label="Close" style="border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#55616a">×</button></div>
<svg id="sun-dial-rose" viewBox="-60 -60 120 120" width="176" height="176" tabindex="0" aria-label="Drag the needle to turn"
  style="display:block;margin:4px auto 0;cursor:grab;outline:none">
  <circle r="57" fill="#f4f6f7" stroke="rgba(0,0,0,.2)" stroke-width="1.2"/>
  ${Array.from({ length: 72 }, (_, i) => { const a = i * 5 * Math.PI / 180, l = i % 9 === 0 ? 7 : i % 3 === 0 ? 4 : 2;
    return `<line x1="${(Math.sin(a) * 56).toFixed(2)}" y1="${(-Math.cos(a) * 56).toFixed(2)}" x2="${(Math.sin(a) * (56 - l)).toFixed(2)}" y2="${(-Math.cos(a) * (56 - l)).toFixed(2)}" stroke="#7d8a93" stroke-width="${l > 4 ? 1.2 : .6}"/>`; }).join("")}
  <path d="M0,-40 L6,-6 L40,0 L6,6 L0,40 L-6,6 L-40,0 L-6,-6 Z" fill="#c8d0d6" stroke="#7d8a93" stroke-width="0.8"/>
  <path d="M0,-40 L6,-6 L0,0 Z M40,0 L6,6 L0,0 Z M0,40 L-6,6 L0,0 Z M-40,0 L-6,-6 L0,0 Z" fill="#7d8a93"/>
  <text y="-46" font-size="10" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="#b4282e">N</text>
  <text x="46" font-size="9" text-anchor="middle" dominant-baseline="middle">E</text>
  <text y="47" font-size="9" text-anchor="middle" dominant-baseline="middle">S</text>
  <text x="-46" font-size="9" text-anchor="middle" dominant-baseline="middle">W</text>
  <g id="sun-dial-needle"><path d="M0,-50 L6,-8 L0,-11 L-6,-8 Z" fill="#d23a2c" stroke="#7a1c14" stroke-width=".8"/>
    <path d="M0,50 L5,8 L0,11 L-5,8 Z" fill="#e9eef1" stroke="#7d8a93" stroke-width=".8"/>
    <circle r="4.5" fill="#1d2a33"/></g>
</svg>
<div id="sun-dial-heading" style="text-align:center;font-weight:700;margin:2px 0 6px"></div>
<svg id="sun-dial-arc" viewBox="0 0 240 132" width="248" height="136" aria-label="Drag the sun to set the time"
  style="display:block;margin:0 auto;cursor:grab;overflow:visible">
  <line x1="6" y1="120" x2="234" y2="120" stroke="#9aa6ae" stroke-width="1.2"/>
  <path d="M20,120 A100,100 0 0 1 220,120" fill="none" stroke="#f0b429" stroke-width="2" stroke-dasharray="4 4"/>
  <text x="20" y="131" font-size="9" text-anchor="middle" fill="#55616a" id="sun-dial-rise"></text>
  <text x="220" y="131" font-size="9" text-anchor="middle" fill="#55616a" id="sun-dial-set"></text>
  <circle id="sun-dial-sun" r="9" fill="#2f7de1" stroke="#fff" stroke-width="2.5" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"/>
</svg>
<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
  <button id="sun-dial-back" aria-label="A day earlier" style="border:0;background:#e9eef1;border-radius:8px;width:28px;height:26px;cursor:pointer">‹</button>
  <div id="sun-dial-time" style="font-weight:700;text-align:center;flex:1"></div>
  <button id="sun-dial-forward" aria-label="A day later" style="border:0;background:#e9eef1;border-radius:8px;width:28px;height:26px;cursor:pointer">›</button></div>
<div id="sun-dial-weather" style="color:#55616a;text-align:center;margin-top:4px;min-height:16px"></div>
<button id="sun-dial-live" style="display:block;margin:6px auto 0;border:0;background:#1d2a33;color:#fff;border-radius:999px;padding:5px 12px;cursor:pointer;font:600 11px system-ui,sans-serif">Live SF time (R)</button>`;
  document.body.append(sunDialBox);
  const svg = compass.querySelector("svg");
  svg.style.pointerEvents = "auto";
  svg.style.cursor = "pointer";
  svg.setAttribute("role", "button");
  svg.setAttribute("aria-label", "Open heading and sun");
  svg.addEventListener("click", () => toggleSunDial());
  sunDialBox.querySelector("#sun-dial-close").addEventListener("click", () => toggleSunDial(false));
  sunDialBox.querySelector("#sun-dial-live").addEventListener("click", () => resetSkyToLive());
  sunDialBox.querySelector("#sun-dial-back").addEventListener("click", () => stepSunDay(-1));
  sunDialBox.querySelector("#sun-dial-forward").addEventListener("click", () => stepSunDay(1));
  const rose = sunDialBox.querySelector("#sun-dial-rose"), arc = sunDialBox.querySelector("#sun-dial-arc");
  const pointIn = (el, e, box) => { const r = el.getBoundingClientRect();
    return [box[0] + (e.clientX - r.left) / r.width * box[2], box[1] + (e.clientY - r.top) / r.height * box[3]]; };
  rose.addEventListener("pointerdown", (e) => { sunDial.dragging = "rose"; rose.setPointerCapture(e.pointerId); turnRoseTo(e); });
  arc.addEventListener("pointerdown", (e) => { sunDial.dragging = "sun"; arc.setPointerCapture(e.pointerId); moveSunTo(e); });
  for (const el of [rose, arc]) {
    el.addEventListener("pointermove", (e) => { if (sunDial.dragging === "rose") turnRoseTo(e); else if (sunDial.dragging === "sun") moveSunTo(e); });
    el.addEventListener("pointerup", () => { sunDial.dragging = null; });
    el.addEventListener("pointercancel", () => { sunDial.dragging = null; });
  }
  function turnRoseTo(e) {
    const [x, y] = pointIn(rose, e, [-60, -60, 120, 120]);
    if (Math.hypot(x, y) < 3) return;
    faceBearing(bearingOf(x, -y));
  }
  rose.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0;
    if (!step) return;
    e.preventDefault(); e.stopPropagation();
    faceBearing((compassBearings().view + step + 360) % 360);
  });
  function moveSunTo(e) {
    const day = sunDayOf(sunDial.date || new Date());
    if (!day) return;
    const [x, y] = pointIn(arc, e, [0, 0, 240, 132]);
    const theta = Math.min(Math.PI, Math.max(0, Math.atan2(120 - y, x - 120)));
    setSkyTime(new Date(+day.rise + (1 - theta / Math.PI) * (day.set - day.rise)));
  }
}
//: Turn the walker -- and the view with it -- to face `bearing` degrees clockwise from north.
function faceBearing(bearing) {
  const b = bearing * Math.PI / 180;
  state.yaw = -b;
  if (typeof avatar !== "undefined" && avatar) avatar.rotation.y = Math.PI - b;
  placeCamera();
  drawSunDial();
}
//: Sunrise and sunset of the San Francisco day holding `date`.
function sunDayOf(date) {
  if (!sunDial.sunCalc) return null;
  const local = new Date(new Date(date).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const noonish = new Date(+date + (12 - local.getHours()) * 3600000 - local.getMinutes() * 60000);
  const t = sunDial.sunCalc.getTimes(noonish, midLat, midLon);
  return { rise: t.sunrise, set: t.sunset };
}
function setSkyTime(date) {
  if (!environmentController) return;
  sunDial.date = date;
  environmentController.setTime(date);
  const preview = document.querySelector('select[aria-label="Time preview"]');
  if (preview) preview.value = "live";
  drawSunDial();
  // The weather that was, once the dragging pauses -- not a request per pixel.
  clearTimeout(sunDial.timer);
  const ask = ++sunDial.ask;
  sunDial.timer = setTimeout(async () => {
    const line = sunDialBox?.querySelector("#sun-dial-weather");
    if (line) line.textContent = "Looking up the weather then…";
    try {
      sunDial.history ??= (await import(sharedAsset("sky-history.mjs"))).createWeatherHistory(midLat, midLon);
      const seen = await sunDial.history.at(date);
      if (ask !== sunDial.ask || !sunDial.date) return;
      environmentController.setConditions(seen || null);
      if (line) line.textContent = seen
        ? `${seen.text || seen.preset.replace("_", " ")} · ${Math.round(seen.wind)} m/s — ${seen.standsIn ? "not yet happened; weather observed" : "observed"} at ${seen.station} ${(seen.standsIn ? SF_TIME : SF_CLOCK).format(new Date(seen.observed))}`
        : "No observation near that hour — weather preset shown";
    } catch (error) {
      if (ask === sunDial.ask && line) line.textContent = "Observed weather unavailable — weather preset shown";
    }
  }, 350);
}
function stepSunDay(days) {
  const now = Date.now(), from = sunDial.date || new Date();
  // weather.gov keeps about a week of observations; ahead, a day or two of yesterday's weather.
  const next = new Date(Math.min(now + 3 * 86400000, Math.max(now - 6 * 86400000, +from + days * 86400000)));
  setSkyTime(next);
}
function resetSkyToLive() {
  sunDial.date = null; sunDial.ask += 1;
  clearTimeout(sunDial.timer);
  environmentController?.setTime(null);
  environmentController?.setConditions(null);
  const preview = document.querySelector('select[aria-label="Time preview"]');
  if (preview) preview.value = "live";
  const line = sunDialBox?.querySelector("#sun-dial-weather");
  if (line) line.textContent = "";
  drawSunDial();
}
//: The box opens under the compass, wherever the compass is (in City mode it sits under the
//: profile card), so the two never cover each other; too tall for what is left, it scrolls.
function placeSunDial() {
  if (!sunDialBox || !compass) return;
  const C = compass.getBoundingClientRect();
  const top = Math.round((C.height ? C.bottom : 96) + 8);
  sunDialBox.style.top = `${top}px`;
  sunDialBox.style.maxHeight = `${Math.max(160, (globalThis.innerHeight || 800) - top - 12)}px`;
  sunDialBox.style.overflowY = "auto";
}
globalThis.addEventListener?.("resize", () => { if (sunDial.open) placeSunDial(); });
async function toggleSunDial(open = !sunDial.open) {
  if (!sunDialBox) return;
  sunDial.open = open;
  if (open) placeSunDial();
  sunDialBox.hidden = !open;
  if (open && !sunDial.sunCalc) sunDial.sunCalc = (await import(sharedAsset("vendor/suncalc-1.9.0.mjs"))).default;
  drawSunDial();
  if (open) sunDialBox.querySelector("#sun-dial-rose").focus({ preventScroll: true });
}
function drawSunDial() {
  if (!sunDialBox || !sunDial.open) return;
  const view = compassBearings().view, heading = Math.round(view) % 360;
  sunDialBox.querySelector("#sun-dial-needle").setAttribute("transform", `rotate(${view})`);
  sunDialBox.querySelector("#sun-dial-heading").textContent = `Facing ${COMPASS_POINTS[Math.round(heading / 45) % 8]} ${heading}°`;
  const date = sunDial.date || new Date(), day = sunDayOf(date);
  if (!day) return;
  const f = (date - day.rise) / (day.set - day.rise), night = f < 0 || f > 1;
  const theta = Math.PI * (1 - Math.min(1, Math.max(0, f)));
  const sunDot = sunDialBox.querySelector("#sun-dial-sun");
  sunDot.setAttribute("cx", (120 + 100 * Math.cos(theta)).toFixed(1));
  sunDot.setAttribute("cy", (120 - 100 * Math.sin(theta)).toFixed(1));
  sunDot.setAttribute("opacity", night ? ".35" : "1");
  sunDialBox.querySelector("#sun-dial-rise").textContent = `↑ ${SF_CLOCK.format(day.rise)}`;
  sunDialBox.querySelector("#sun-dial-set").textContent = `${SF_CLOCK.format(day.set)} ↓`;
  sunDialBox.querySelector("#sun-dial-time").textContent = `${SF_TIME.format(date)}${sunDial.date ? "" : " · live"}${night ? " · night" : ""}`;
}

// ---- solid buildings, doors that open, and the rooms behind them ------------------------------
//
// A building is solid: the walker is a circle WALKER_RADIUS_M across its feet and is held off
// every footprint's walls, sliding along them rather than stopping dead. The way in is a door.
// Each building's doors come with its fitted interior (scripts/build_interiors_fit.py): an
// entrance a mapper put on the outline in OpenStreetMap, else a door or shopfront the facade
// survey photographed, else one inferred at the middle of the wall nearest a street. Stand by
// one and press Enter: it swings open, the gap in the wall is passable, and the rooms behind it
// are built -- a real plan of somewhere else (a Swiss apartment building, a single dwelling),
// chosen because its proportions fit this footprint and tiled where the building is several
// plans long. It is labelled what it is: a stand-in, not this building's interior.
const WALKER_RADIUS_M = 0.3;
const WALK_SUBSTEP_M = 0.15;
const DOOR_REACH_M = 1.8;
const DOOR_HEIGHT_M = 2.1;
//: Doors are drawn this far from the walker: far enough that one is not seen to appear.
const DOOR_DRAW_M = 120;
const INTERIOR_KEEP_M = 70;
//: Rooms are drawn with the camera this near their house: in at an open door, not past it.
const INTERIOR_DRAW_M = 15;
const INTERIOR_WALL_INSET_M = 0.08;
//: A room's paint on an outside wall (buildInterior) stands this much inside the shell's lining
//: (twice it for every other room, so two rooms meeting at a partition never share a plane), and
//: a room's edge counts as on an outside wall within ROOM_SKIN_REACH_M of it.
const ROOM_SKIN_INSET_M = 0.004;
const ROOM_SKIN_REACH_M = 0.35;
const DOOR_SOURCE = ["mapped (OpenStreetMap)", "photographed", "inferred"];
var standingSurfaces = new Set();
//: Steps on a stoop, and how deep each tread is.
const STEP_RISE_M = 0.18;
const STEP_TREAD_M = 0.3;
const STEP_LANDING_TREADS = 4;
const footprintById = new Map();

// A building on a hill stands on its highest ground: its floor is level with the ground at the
// top of the footprint, never under the hillside -- the terrain cannot be cut, so a floor below
// it would have the street running through the rooms. Where the street at a door is lower, the
// door has a stoop, as San Francisco's do. (The street's ground, not this, is still what the
// walker stands on outside.)
function entryFloorY(entry) {
  if (entry.floorY !== undefined) return entry.floorY;
  let top = -Infinity;
  for (const [x, z] of entry.local) top = Math.max(top, terrainGroundAt(x, z));
  const step = Math.max(2, Math.hypot(entry.maxX - entry.minX, entry.maxZ - entry.minZ) / 30);
  for (let x = entry.minX; x <= entry.maxX; x += step) {
    for (let z = entry.minZ; z <= entry.maxZ; z += step) {
      if (insideFootprint(entry, x, z)) top = Math.max(top, terrainGroundAt(x, z));
    }
  }
  entry.floorY = top + 0.05;
  return entry.floorY;
}
// The ground without any interior or stoop on it.
function terrainGroundAt(x, z) {
  // Building/entry foundations use surface terrain, not a bore below their footprint.
  return groundLiftAt(x, z);
}
for (const bucket of footprintGrid.values()) {
  for (const entry of bucket) footprintById.set(String(entry.way.osm_id), entry);
}

let INTERIORS = null;
let HOME_OPENINGS = { buildings: {} };
let HOME_OPENINGS_VERSION = 0;
//: Whether the photographed openings and the interiors (with their doors) have come back, or
//: failed to: the house windows are first laid out once both have.
let HOME_OPENINGS_SETTLED = false, INTERIORS_SETTLED = false;
fetch(sharedAsset("sf-corridor-home-openings.json"), { cache: "no-cache" })
  .then((r) => r.ok ? r.json() : null).then((data) => {
    if (data) { HOME_OPENINGS = data; HOME_OPENINGS_VERSION += 1; }
  })
  .catch(() => {})
  .finally(() => { HOME_OPENINGS_SETTLED = true; });
// A house the interior engine has an accepted interior for (inferred-interiors/map-overlay.json:
// its validation passed, published by scripts/run_interior_engine.py --publish) is furnished
// with that one in place of its fitted plan; any other keeps the plan, and a hypothesis that
// fails to load falls back to it too. Off in the headset, whose memory it would not fit, and
// with ?inferredInteriors=0.
let generatedInteriorModules = null;
function commercialInterior(entry) {
  const w = entry.way;
  return Boolean(w.shops?.length || ["retail","restaurant","office","hotel","industrial","commercial"].includes(w.archetype)
    || ["retail","commercial","industrial","office","hotel"].includes(w.tags?.building));
}
function interiorStatus(id) {
  const e=footprintById.get(String(id));
  if(!e)return null;
  const h=e.interior?.house;
  return {id:String(id),kind:e.generatedInteriorRef?.kind || (commercialInterior(e) ? "commercial_unresolved" : "house"),
    plan:e.interior?.plan || null,pending:Boolean(e.generatedInteriorPending),failed:Boolean(e.generatedInteriorFailed),
    floorY:e.floorY,roomsLowered:Boolean(e.roomsLowered),
    source:e.generatedInteriorRef?.file || null,confidence:h?.confidence,measured:h?.measured,
    rooms:h?.storeys.flatMap(f=>f.rooms.map(r=>r.kind)) || [],
    objects:h?.storeys.reduce((n,f)=>n+f.objects.length,0) || 0};
}
function requestGeneratedInteriors() {
  if (HEADSET || new URLSearchParams(location.search).get("inferredInteriors") === "0") return;
  const base = new URL("../inferred-interiors/", interiorAssetBase());
  Promise.all(["map-overlay.json","../inferred-restaurants/map-overlay.json"].map(file =>
    fetch(new URL(file,base),{cache:"no-cache"}).then(r=>r.ok?r.json():null).catch(()=>null))).then(layers => {
    for (const data of layers) for (const [id, ref] of Object.entries(data?.buildings || {})) {
      const entry = footprintById.get(id);
      if (entry && !entry.way.parkFacility && !entry.way._structure) {
        // A ground-floor restaurant is not a family house, even if a generic fitted plan
        // exists for its building. Multi-tenant buildings need tenant boundaries first.
        if (commercialInterior(entry) !== (ref.kind === "restaurant")) continue;
        if (ref.kind === "restaurant" && (JSON.stringify(ref.footprint) !== JSON.stringify(entry.way.points)
          || entry.way.shops?.length !== 1 || entry.way.shops[0].n !== ref.name)) continue;
        entry.generatedInteriorRef = {...ref, base};
        if (entry.interior) removeInterior(entry);
      }
    }
  }).catch(error => console.warn("kerbside: generated pilot unavailable", error))
    .finally(() => requestStoreInteriors(base));
}
//: The engine's houses beyond the site's own (scripts/run_interior_engine.py --homes --store):
//: each a gzipped file in the public store, listed by the overlay tile of its 0.02 degree square
//: (interiors/overlay/<tile>.json, named in its index.json). Only this store's own files are read.
const STORE_HOUSE_FILE = /^interiors\/houses\/[a-z0-9-]+\/osm-[0-9]+\.json$/;
const STORE_TILE_KEY = /^-?[0-9]{1,5}_-?[0-9]{1,5}$/;
function storeInteriorBase() {
  // The site's own /store path: every deployment rewrites it to the store, so it is read from
  // this page's origin (the store's CORS lets only the site itself read the store directly).
  return ASSET_MAP?.base ? new URL(`${ASSET_MAP.base.replace(/\/+$/, "")}/`, location.href) : null;
}
function requestStoreInteriors(base) {
  const store = storeInteriorBase();
  if (!store) return;
  fetch(new URL("interiors/overlay/index.json", store), { cache: "no-cache" })
    .then(r => r.ok ? r.json() : null).then(index => {
      const deg = Number(index?.tile_deg);
      if (!(deg > 0)) return;
      // The squares this page's own buildings stand in, of those the store has houses for.
      const listed = new Set(Object.keys(index.tiles || {}).filter(k => STORE_TILE_KEY.test(k)));
      const wanted = new Set();
      for (const entry of footprintById.values()) {
        const c = entry.way.centroid || entry.way.points?.[0];
        const key = c && `${Math.floor(c[0] / deg)}_${Math.floor(c[1] / deg)}`;
        if (key && listed.has(key)) wanted.add(key);
      }
      return Promise.all([...wanted].map(key => fetch(new URL(`interiors/overlay/${key}.json`, store))
        .then(r => r.ok ? r.json() : null).then(tile => {
          for (const [id, ref] of Object.entries(tile?.buildings || {})) {
            if (!STORE_HOUSE_FILE.test(String(ref?.file))) continue;
            const entry = footprintById.get(id);
            // The site's own accepted interior, where it has one, stays.
            if (!entry || entry.generatedInteriorRef || entry.way.parkFacility || entry.way._structure) continue;
            entry.generatedInteriorRef = {...ref, base, fileBase: store};
            if (entry.interior) removeInterior(entry);
          }
        }).catch(() => {})));
    }).catch(error => console.warn("kerbside: store interiors unavailable", error));
}
function requestGeneratedInterior(entry) {
  if (entry.generatedInteriorPending) return;
  entry.generatedInteriorPending = true;
  const ref = entry.generatedInteriorRef;
  if (!generatedInteriorModules) generatedInteriorModules = Promise.all([
    import(new URL("renderer.mjs", ref.base).href),
    import(new URL("kerbside-adapter.mjs", ref.base).href)
  ]);
  Promise.all([generatedInteriorModules,
    fetch(new URL(ref.file, ref.fileBase || ref.base)).then(r => { if (!r.ok) throw new Error("house unavailable"); return r.json(); })
  ]).then(([[rendererModule, adapter], house]) => {
    if (!house.validation?.passed || house.grade !== "inferred") throw new Error("invalid generated hypothesis");
    if (entry.interior) removeInterior(entry);
    const [lon, lat] = ref.origin_lon_lat;
    const floorY = entryFloorY(entry);
    const interior = adapter.mountGeneratedInterior(THREE, house, entry, {
      origin: xy(lon, lat), floorY, assetBase: interiorAssetBase(),
      loadAsset: url => new GLTFLoader().loadAsync(url).then(g => plainGlass(g.scene)),
      feetY: walkerFeetY, pointInRing, kind: ref.kind
    }, rendererModule.buildInferredHouse);
    // The engine draws no outside walls here (exterior: false): the house's shell is them. A
    // building with no shell -- every restaurant, and a house the shells do not reach -- has
    // only the city's facade, which is not drawn from inside, so its rooms stand in the same
    // lining as a fitted plan's, up to the top of its top storey (outsideWallLining).
    if (!entry.homeShell) {
      const holder = new THREE.Group();
      holder.name = `interior:${entry.way.osm_id}`;
      const top = Math.max(...house.storeys.map((f) => (f.elevation_m || 0) + (f.height_m || 0)));
      outsideWallLining(entry, holder, floorY, Math.max(2.4, top));
      holder.add(interior.group);
      interior.group = holder;
    }
    entry.interior = interior;
    interiorGroup.add(interior.group); standingSurfaces.add(interior.floorSurface); interiorsBuilt.add(entry);
  }).catch(error => {
    entry.generatedInteriorFailed = true;
    console.warn("kerbside: generated interior rejected; using fitted plan", error);
    buildInterior(entry);
  }).finally(() => {
    // Settled: an interior taken down later (the walker went on, the shell was rebuilt) is
    // requested again when it is next wanted, instead of the house standing empty.
    entry.generatedInteriorPending = false;
  });
}
let interiorsRequested = false;
function requestInteriors() {
  if (interiorsRequested) return;
  interiorsRequested = true;
  fetch(asset("sf-corridor-interiors.json"), { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.buildings) return;
      INTERIORS = data;
      requestGeneratedInteriors();
      for (const [id, record] of Object.entries(data.buildings)) {
        const entry = footprintById.get(id);
        if (!entry || entry.way.parkFacility || entry.way._structure) continue;
        entry.fit = record;
        entry.doors = (record[13] || []).map(([edge, t, width, source]) => doorOn(entry, edge, t, width, source))
          .filter(Boolean);
        settleDoors(entry);
      }
      console.info(`kerbside: interiors for ${Object.keys(data.buildings).length} buildings, `
        + `${data.library.length} plans (${JSON.stringify(data.summary.stretch)} stretch)`);
    })
    .catch(() => { /* no interiors for this page: buildings stay solid and closed */ })
    .finally(() => { INTERIORS_SETTLED = true; });
}

//: The garages on one footprint edge of an entry, as [centre along the edge, width] in metres.
function garageSpansOnEdge(entry, edge) {
  const a = entry.local[edge], b = entry.local[edge + 1];
  if (!a || !b) return [];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
  const out = [];
  for (const g of entry.way.garages || []) {
    const [gax, gay] = xy(g.a[0], g.a[1]), [gbx, gby] = xy(g.b[0], g.b[1]);
    const gx = gax + (gbx - gax) * g.t, gz = -(gay + (gby - gay) * g.t);
    const off = Math.abs((gx - a[0]) * -uz + (gz - a[1]) * ux);
    const u = (gx - a[0]) * ux + (gz - a[1]) * uz;
    if (off > 1.0 || u < -0.5 || u > length + 0.5) continue;
    out.push([u, g.w || 2.6]);
  }
  return out;
}

//: Every house has a usable front door, and no inferred door stands behind a garage door.
//: A door the interior fit inferred at the middle of the street wall is moved along it to clear
//: wall beside the garage (or dropped if there is none); a mapped or photographed door stays
//: where it was seen. A house left with no door gets the one its facade shows (_frontDoor).
function settleDoors(entry) {
  if (entry.way._structure) { entry.doors = []; return; }
  const kept = [];
  for (const door of entry.doors || []) {
    const a = entry.local[door.edge], b = entry.local[door.edge + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const spans = garageSpansOnEdge(entry, door.edge);
    const centre = (door.t0 + door.t1) / 2 * length;
    const clear = (u) => u >= door.width / 2 + 0.2 && u <= length - door.width / 2 - 0.2
      && spans.every(([g, w]) => Math.abs(u - g) >= w / 2 + door.width / 2 + DOOR_CLEAR_M);
    if (clear(centre) || door.source !== 2) { kept.push(door); continue; }
    const candidates = [];
    for (const [g, w] of spans) {
      const gap = w / 2 + door.width / 2 + DOOR_CLEAR_M;
      candidates.push(g + gap, g - gap);
    }
    for (let s = 0.25; s <= length; s += 0.25) candidates.push(centre + s, centre - s);
    const u = candidates.find(clear);
    if (u === undefined) continue;
    const moved = doorOn(entry, door.edge, u / length, door.width, door.source);
    if (moved) kept.push(moved);
  }
  // Inferred doors only, and the facade shows a front door: the shell shows that one. The fit
  // inferred its door on whichever wall it took to face the street, and that was often a side
  // or the back -- so from the street the house had a door from far off and none up close.
  if (entry.way._frontDoor && kept.every((door) => door.source === 2)) kept.length = 0;
  // The front door the photograph shows, and how it is reached. It replaces any door within a
  // few metres of it on the same wall, and every inferred door on that wall: the photograph
  // shows the wall, and where it saw no door there is none.
  const photo = photoEntryDoor(entry);
  if (photo) {
    const at = (photo.t0 + photo.t1) / 2;
    const a = entry.local[photo.edge], b = entry.local[photo.edge + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      const d = kept[i];
      if (d.edge === photo.edge && (d.source === 2 || Math.abs((d.t0 + d.t1) / 2 - at) * length < 3)) kept.splice(i, 1);
    }
    kept.unshift(photo);
    entry.doors = kept;
    return;
  }
  if (!kept.length && entry.way._frontDoor) {
    // The edge the facade's door is on, and where along it.
    const { x, z } = entry.way._frontDoor;
    let best = null;
    for (let edge = 0; edge + 1 < entry.local.length; edge += 1) {
      const a = entry.local[edge], b = entry.local[edge + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < DOOR_LEAF_M + 0.4) continue;
      const tt = ((x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1])) / (L * L);
      if (tt < 0 || tt > 1) continue;
      const d = Math.sqrt(distanceToSegmentSquared(x, z, a[0], a[1], b[0], b[1]));
      if (!best || d < best.d) best = { d, edge, tt };
    }
    if (best && best.d < 1.0) {
      const door = doorOn(entry, best.edge, best.tt, DOOR_LEAF_M, 2);
      if (door) kept.push(door);
    }
  }
  entry.doors = kept;
}

//: The front door the photograph shows (the fit's primary entry, entry_inference): on the
//: footprint edge the fitted front lies along, at the place along it the photo puts the door.
function photoEntryDoor(entry) {
  const fit = frontageFitFor(entry.way);
  const pe = fit?.primary_entry;
  if (!pe || !fit.a || !fit.b || ![pe.u, pe.w].every(Number.isFinite)) return null;
  const [ax, ay] = xy(...fit.a), [bx, by] = xy(...fit.b);
  const f = [ax, -ay], g = [bx, -by], span = Math.hypot(g[0] - f[0], g[1] - f[1]);
  if (span < 1) return null;
  const tx = (g[0] - f[0]) / span, tz = (g[1] - f[1]) / span;
  // Behind a gate the entry is where the gate is: the door the photo found may be a step aside.
  const centre = pe.gate && Number.isFinite(pe.gate.u) ? pe.gate.u + pe.gate.w / 2 : pe.u + pe.w / 2;
  const along = Math.min(span, Math.max(0, centre));
  const px = f[0] + tx * along, pz = f[1] + tz * along;
  let best = null;
  for (let edge = 0; edge + 1 < entry.local.length; edge += 1) {
    const a = entry.local[edge], b = entry.local[edge + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1.2 || Math.abs(((b[0] - a[0]) * tx + (b[1] - a[1]) * tz) / L) < 0.9) continue;
    const t = ((px - a[0]) * (b[0] - a[0]) + (pz - a[1]) * (b[1] - a[1])) / (L * L);
    if (t < 0 || t > 1) continue;
    const d = Math.sqrt(distanceToSegmentSquared(px, pz, a[0], a[1], b[0], b[1]));
    if (d < 1.5 && (!best || d < best.d)) best = { d, edge, t };
  }
  if (!best) return null;
  const leaf = pe.hidden_door ? DOOR_LEAF_M : Math.min(1.2, Math.max(0.8, pe.w));
  const door = doorOn(entry, best.edge, best.t, leaf, 1);
  if (door) {
    door.photoEntry = pe;
    // The fit's own along-the-wall direction: a stair's "rises toward" is measured on it.
    door.photoTangent = [tx, tz];
  }
  return door;
}

function doorOn(entry, edge, t, width, source) {
  const ring = entry.local;
  const a = ring[edge], b = ring[edge + 1];
  if (!a || !b) return null;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  if (length < width + 0.2) return null;
  const ux = dx / length, uz = dz / length;
  // Keep the whole leaf on the edge.
  const half = width / 2 / length;
  const tc = Math.min(1 - half, Math.max(half, t));
  const cx = a[0] + dx * tc, cz = a[1] + dz * tc;
  // Inward is the side of the edge the footprint is on.
  let nx = -uz, nz = ux;
  if (!insideFootprint(entry, cx + nx * 0.5, cz + nz * 0.5)) { nx = -nx; nz = -nz; }
  return { entry, edge, t0: tc - half, t1: tc + half, width, source, cx, cz, ux, uz, nx, nz,
           open: false, angle: 0, mesh: null };
}

// The wall segments within reach of a point: footprint edges with open doorways left out, the
// leaves of closed doors, and the partitions of any interior that has been built.
function wallSegmentsNear(x, z) {
  const out = typeof stationWallsNear === "function" && stationWalls && stationWalls.length ? stationWallsNear(x, z) : [];
  const guest = typeof guestUnder === "function" ? guestUnder(x, z) : null;
  if (guest) {
    const [gx, gz] = hostToGuest(guest, x, z);
    for (const [ax, az, bx, bz] of guest.api.wallSegmentsNear(gx, gz))
      out.push([guest.ox + ax * guest.sx, guest.oz + az, guest.ox + bx * guest.sx, guest.oz + bz]);
    // Where the attached region is drawn it is the only one with walls. This page's own
    // footprints are kept after it lets its world go (releaseHostWorld), so that the walker
    // cannot pass through a house the page no longer draws -- but their doors are this page's,
    // which it no longer opens, and over the attached region they stood as a second, closed
    // wall in every doorway: no front door of the square the page first built could be walked
    // through.
    if (!hostWorldActive) return out;
  }
  const seen = new Set();
  for (let ix = -1; ix <= 1; ix += 1) {
    for (let iz = -1; iz <= 1; iz += 1) {
      const bucket = footprintGrid.get(`${Math.floor(x / FOOTPRINT_CELL) + ix}:${Math.floor(z / FOOTPRINT_CELL) + iz}`);
      if (!bucket) continue;
      for (const entry of bucket) {
        if (seen.has(entry) || x < entry.minX - 3 || x > entry.maxX + 3 || z < entry.minZ - 3 || z > entry.maxZ + 3) continue;
        seen.add(entry);
        // A station under the street and a canopy on posts have no walls to walk into.
        if (entry.solid === undefined) {
          entry.solid = !entry.way.underground && structureClass(entry.way, footprintArea(entry.way.points)) !== "canopy";
        }
        if (!entry.solid) continue;
        const ring = entry.local;
        for (let i = 0; i + 1 < ring.length; i += 1) {
          const [ax, az] = ring[i];
          const [bx, bz] = ring[i + 1];
          const edgeLength = Math.hypot(bx - ax, bz - az);
          const gaps = (entry.doors || []).filter((d) => d.edge === i && (d.open || d.stoopPlan))
            .map((d) => d.stoopPlan?.width ? { ...d,
              t0: (d.t0 + d.t1) / 2 - d.stoopPlan.width / (2 * edgeLength),
              t1: (d.t0 + d.t1) / 2 + d.stoopPlan.width / (2 * edgeLength) } : d)
            .sort((p, q) => p.t0 - q.t0);
          let from = 0;
          for (const gap of gaps) {
            if (gap.t0 > from) out.push([ax + (bx - ax) * from, az + (bz - az) * from, ax + (bx - ax) * gap.t0, az + (bz - az) * gap.t0]);
            from = Math.max(from, gap.t1);
          }
          if (from < 1) out.push([ax + (bx - ax) * from, az + (bz - az) * from, bx, bz]);
        }
        for (const d of entry.doors || []) {
          if (d.gate) {
            for (const seg of d.gate.segments) out.push(seg);
            if (d.gate.angle < 0.3) out.push(d.gate.leaf);
          }
          if (!d.stoopPlan) continue;
          const depth = d.stoopPlan.depth;
          const half = (d.stoopPlan.width || d.width) / 2;
          for (const sign of [-1, 1]) out.push([
            d.cx + d.ux * half * sign, d.cz + d.uz * half * sign,
            d.cx + d.ux * half * sign + d.nx * depth,
            d.cz + d.uz * half * sign + d.nz * depth]);
          for (const [a, b] of [[-half, -d.width / 2], [d.width / 2, half]])
            if (b - a > 0.01) out.push([d.cx + d.ux * a + d.nx * depth,
              d.cz + d.uz * a + d.nz * depth, d.cx + d.ux * b + d.nx * depth,
              d.cz + d.uz * b + d.nz * depth]);
          if (!d.open) out.push([
            d.cx - d.ux * half + d.nx * depth, d.cz - d.uz * half + d.nz * depth,
            d.cx + d.ux * half + d.nx * depth, d.cz + d.uz * half + d.nz * depth]);
        }
        if (entry.interior) for (const s of entry.interior.segments) out.push(s);
      }
    }
  }
  return out;
}

function pushOutOfWalls(p, segments) {
  for (let pass = 0; pass < 3; pass += 1) {
    let moved = false;
    for (const [ax, az, bx, bz] of segments) {
      const sx = bx - ax, sz = bz - az;
      const len2 = sx * sx + sz * sz;
      const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - ax) * sx + (p.z - az) * sz) / len2)) : 0;
      const qx = ax + sx * t, qz = az + sz * t;
      const dx = p.x - qx, dz = p.z - qz;
      const d = Math.hypot(dx, dz);
      if (d >= WALKER_RADIUS_M || d < 1e-9) continue;
      const push = WALKER_RADIUS_M - d;
      p.x += (dx / d) * push;
      p.z += (dz / d) * push;
      moved = true;
    }
    if (!moved) return;
  }
}

function walkerFootprintBlocked(x, z) {
  const seen = new Set();
  const gx = Math.floor(x / FOOTPRINT_CELL), gz = Math.floor(z / FOOTPRINT_CELL);
  for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
    for (const entry of footprintGrid.get(`${gx + dx}:${gz + dz}`) || []) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      // Inside the house entered by its door, its walls (wallSegmentsNear) are what hold the walker.
      if (typeof enteredEntry !== "undefined" && entry === enteredEntry) continue;
      if(typeof stairRecessClear === "function" && stairRecessClear(entry,x,z))continue;
      if (insideFootprint(entry, x, z)) return true;
      const ring = entry.local;
      for (let i = 1; i < ring.length; i += 1) {
        if (distanceToSegmentSquared(x, z, ...ring[i - 1], ...ring[i]) < WALKER_RADIUS_M ** 2 - 1e-9) return true;
      }
    }
  }
  return false;
}

// What is within the interaction radius of the walker, from the object catalogue: solid where
// it is at body height (a pole, a trunk, a bench, a fence), passed through slowed where it is
// soft (a shrub), and described in the Nearby panel -- one radius for both.
var objectProximity = null;
objectCatalogueReady.then((ready) => {
  if (!ready) return;
  objectProximity = ready.library.createProximity({ THREE, catalogue: ready.catalogue,
    roots: () => [root, activeGuest?.ready ? activeGuest.root : null] });
  window.kerbsideNearby = () => ({ radius_m: objectProximity.radius, ...objectProximity.stats(),
    nearby: objectProximity.nearby(), unresolved: objectProximity.unresolved() });
});
//: Where the walker may go when (toX, toZ) is inside a thing: along one axis or the other, so it
//: slides round a pole rather than stopping dead on it. Null if neither is clear.
function slidePastObjects(fromX, fromZ, toX, toZ, belowBuildings, hit = null) {
  const clear = (x, z) => !objectProximity.blocked(x, z, WALKER_RADIUS_M)
    && (belowBuildings || (activeGuest?.ready ? true : !walkerFootprintBlocked(x, z)));
  const round = hit ? knockRoundObject(fromX, fromZ, toX, toZ, hit.pts) : null;
  if (round && clear(round[0], round[1])) return round;
  if (clear(toX, fromZ)) return [toX, fromZ];
  if (clear(fromX, toZ)) return [fromX, toZ];
  return null;
}

//: Anything no wider than this the walker is knocked round rather than stopped by: a pole, a
//: meter, a trunk, a bollard, a hydrant. A bench or a fence is longer, and is slid along.
const KNOCK_ROUND_MAX_M = 1.2;
//: And knocked this far clear of it, on top of just clearing it: a shoulder catching a pole.
const KNOCK_ROUND_BUMP_M = 0.06;
//: Where a walker heading from (fromX, fromZ) to (toX, toZ) goes instead when a small thing is
//: in the way: the whole step taken round its side, the side the walker was already heading for.
//
// The slide along the world's own axes stopped the walker dead at every pole met head-on: the
// step along the walking axis was blocked, and the one across it was the step's own sideways
// part -- nothing, walking straight at it. A pole is a point; a body walking into one is turned
// round it and goes on.
function knockRoundObject(fromX, fromZ, toX, toZ, pts) {
  if (!pts || pts.length < 6) return null;
  const n = pts.length / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < n; i += 1) { cx += pts[2 * i]; cz += pts[2 * i + 1]; }
  cx /= n; cz /= n;
  let reach = 0;
  for (let i = 0; i < n; i += 1) reach = Math.max(reach, Math.hypot(pts[2 * i] - cx, pts[2 * i + 1] - cz));
  if (2 * reach > KNOCK_ROUND_MAX_M) return null;
  const mx = toX - fromX, mz = toZ - fromZ, step = Math.hypot(mx, mz);
  if (!(step > 1e-6)) return null;
  // Out from the thing's middle to the walker; dead centre (inside it already) counts as square on.
  let rx = fromX - cx, rz = fromZ - cz;
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-6) { rx = -mx / step; rz = -mz / step; } else { rx /= rl; rz /= rl; }
  // The tangent the step leans toward. Square on, the walker's right shoulder takes it and they
  // go left of it, as people do, rather than freezing on a tie.
  let tx = -rz, tz = rx;
  const lean = tx * mx + tz * mz;
  if (lean < -1e-9) { tx = -tx; tz = -tz; }
  const ring = reach + WALKER_RADIUS_M + KNOCK_ROUND_BUMP_M;
  let nx = fromX + tx * step, nz = fromZ + tz * step;
  const dx = nx - cx, dz = nz - cz, d = Math.hypot(dx, dz);
  if (d < ring) { nx = cx + (dx / (d || 1)) * ring; nz = cz + (dz / (d || 1)) * ring; }
  return [nx, nz];
}

// Move the walker by (mx, mz), in steps short enough that no wall is crossed between checks,
// sliding along whatever it meets.
//: The walker's width against deadwood on the forest floor.
const WALKER_DEADWOOD_RADIUS_M = 0.25;
function moveWalker(mx, mz) {
  const objects = typeof objectProximity !== "undefined" ? objectProximity : null;
  if (objects) {
    const standing = walkerFeetY();
    objects.update(avatar.position.x, Number.isFinite(standing) ? standing : avatar.position.y, avatar.position.z);
    const slow = objects.speedAt(avatar.position.x, avatar.position.z, WALKER_RADIUS_M);
    mx *= slow; mz *= slow;
  }
  const distance = Math.hypot(mx, mz);
  const steps = Math.max(1, Math.ceil(distance / WALK_SUBSTEP_M));
  const segments = wallSegmentsNear(avatar.position.x + mx / 2, avatar.position.z + mz / 2);
  const p = { x: avatar.position.x, z: avatar.position.z };
  let feet=typeof walkerFeetY === "function" ? walkerFeetY() : null;
  // The parapets of the deck underfoot (a streamed region's own decks where one is drawn).
  {
    const cx = avatar.position.x + mx / 2, cz = avatar.position.z + mz / 2;
    const g = typeof guestUnder === "function" && activeGuest ? guestUnder(cx, cz) : null;
    if (g?.ready && g.api.deckEdgeSegmentsNear && Number.isFinite(feet)) {
      for (const [ax, az, bx, bz] of g.api.deckEdgeSegmentsNear(...hostToGuest(g, cx, cz), feet - g.oy))
        segments.push([g.ox + ax * g.sx, g.oz + az, g.ox + bx * g.sx, g.oz + bz]);
    } else if (!g && typeof deckEdgeSegmentsNear === "function") segments.push(...deckEdgeSegmentsNear(cx, cz, feet));
  }
  for (let i = 0; i < steps; i += 1) {
    const next = {x: p.x + mx / steps, z: p.z + mz / steps};
    const below=typeof occupiedTunnelAt === "function" ? occupiedTunnelAt(p.x,p.z,feet) : null;
    // The bore has its own solid envelope even at a shallow portal. An unrelated
    // 2D footprint above it must never become a wall across the underground road.
    const cut=typeof occupiedApproachAt === "function" ? occupiedApproachAt(p.x,p.z,feet) : null;
    const belowBuildings=Boolean(below || cut);
    if (segments.length && !belowBuildings) pushOutOfWalls(next, segments);
    const nextX = next.x, nextZ = next.z;
    const guest = typeof guestUnder === "function" && activeGuest ? guestUnder(nextX, nextZ) : null;
    const tunnelClear=guest?.ready && guest.api.tunnelMoveAllowed
      ? guest.api.tunnelMoveAllowed(...hostToGuest(guest,p.x,p.z),...hostToGuest(guest,nextX,nextZ),
        Number.isFinite(feet) ? feet-guest.oy : null)
      : typeof tunnelMoveAllowed !== "function" || tunnelMoveAllowed(p.x,p.z,nextX,nextZ,feet);
    if (!tunnelClear) break;
    let hit;
    if (belowBuildings) hit=null;
    else if (guest?.ready && guest.api.firstBuildingCollision) {
      const [ax, az] = hostToGuest(guest, p.x, p.z), [bx, bz] = hostToGuest(guest, nextX, nextZ);
      hit = guest.api.firstBuildingCollision(ax, az, bx, bz);
    } else hit = belowBuildings ? null : firstBuildingCollision(p.x, p.z, nextX, nextZ);
    if (hit !== null && hit !== undefined) break;
    const blocked = !belowBuildings && (guest?.ready && guest.api.walkerFootprintBlocked
      ? guest.api.walkerFootprintBlocked(...hostToGuest(guest, nextX, nextZ))
      : walkerFootprintBlocked(nextX, nextZ));
    if (blocked) break;
    // Fallen trunks, stumps and big rocks in a wood are climbed round, not walked through;
    // undergrowth is pushed through. A walker already standing in one may walk out of it.
    const wood = !belowBuildings && typeof natureWorld !== "undefined" && natureWorld?.deadwoodBlocked;
    if (wood && natureWorld.deadwoodBlocked(nextX, nextZ, WALKER_DEADWOOD_RADIUS_M)
        && !natureWorld.deadwoodBlocked(p.x, p.z, WALKER_DEADWOOD_RADIUS_M)) break;
    let toX = nextX, toZ = nextZ;
    // Poles, trunks (measured or inferred alike), benches and fences at body height. One already
    // inside one -- arrived by a teleport -- may walk out of it.
    const struck = objects ? objects.blocked(toX, toZ, WALKER_RADIUS_M) : null;
    if (struck && !objects.blocked(p.x, p.z, WALKER_RADIUS_M)) {
      const slide = slidePastObjects(p.x, p.z, toX, toZ, belowBuildings, struck);
      if (!slide) break;
      [toX, toZ] = slide;
    }
    // The living city's cars, parked or in traffic, and its buses: walked round, not through.
    // One standing inside one (a car pulled up on them) may walk out of it.
    const cars = typeof livingCity !== "undefined" ? livingCity?.walkerBlocked : null;
    if (cars && cars(toX, toZ, WALKER_RADIUS_M, p.x, p.z)) {
      // Slid along the car's side or its bumper (into the gap to the next car), not through it.
      const slid = livingCity.walkerSlide?.(p.x, p.z, toX, toZ, WALKER_RADIUS_M);
      if (slid) [toX, toZ] = slid;
      else if (!cars(toX, p.z, WALKER_RADIUS_M, p.x, p.z)) toZ = p.z;
      else if (!cars(p.x, toZ, WALKER_RADIUS_M, p.x, p.z)) toX = p.x;
      else break;
    }
    // Open water is not walked on: the shore, a pier, a deck or a bridge over it are. One already
    // on the water (dropped there) may walk off it.
    if (typeof walkerOnWater === "function" && walkerOnWater(toX, toZ, feet) && !walkerOnWater(p.x, p.z, feet)) break;
    // City mode's area ends here (module 30): Explore goes on.
    if (typeof cityAreaHolds === "function" && !cityAreaHolds(toX, toZ) && cityAreaHolds(p.x, p.z)) {
      if (typeof setHint === "function") setHint(`${CITY_AREA.name[0].toUpperCase()}${CITY_AREA.name.slice(1)} ends here: switch to Explore to go further.`);
      break;
    }
    p.x = toX;
    p.z = toZ;
    if (typeof walkerGroundAt === "function") feet=walkerGroundAt(p.x,p.z,feet);
  }
  const moved = Math.hypot(p.x - avatar.position.x, p.z - avatar.position.z);
  avatar.position.x = p.x;
  avatar.position.z = p.z;
  if (moved>0 && Number.isFinite(feet) && typeof AVATAR_STAND_Y === "number") {
    avatar.position.y=AVATAR_STAND_Y+feet;
  }
  return moved;
}

