// ---- Into the water: wading, swimming, treading water -------------------------------------------
//: In City mode the walker goes into the water as a person does: in the shallows the feet stay on
//: the bottom and the water comes up the legs as far as the bottom is under its surface; deeper
//: than the chest (WATER_WADE.swimDepth) the walker swims, lying in the water with the head up --
//: at a swim, or fast (Shift) for as long as there is stamina for it -- and with too little stamina
//: to swim, it treads water upright, kicking, until enough comes back (docs/city/view.mjs swim).
//: The map has no soundings, so how deep the water is comes from how far it is to dry ground and
//: what that ground is: a beach shelves gently, a sea wall or a pier drops straight into a couple
//: of metres, a pond is a metre or so at its middle and a fountain's basin a hand or two. The car
//: is still kept out of it (moveWalker), and on the map nobody walks on water (walkerOnWater).
var WATER_WADE = {
  // Deeper than this over the bottom (m) the walker swims.
  swimDepth: 1.3,
  // How far the shore is looked for, and the depth past it.
  shoreSearchM: 40, seaMax: 9,
  // A beach shelves this many metres down for each metre out; a wall drops wallDrop at its foot.
  beachSlope: 0.07, wallDrop: 1.8, wallSlope: 0.25, wallOverM: 0.7,
  // A pond (closed in by the map) and a fountain's basin.
  pondSlope: 0.22, pondMax: 1.6, basinMax: 0.45,
  // Where the hips are, under the surface: lying swimming, and treading (head up) -- the head
  // over the water by headUp.
  swimHips: 0.15, headUp: 0.12,
  // How far forward the body lies at a swim (rad), and how quickly it lies down or comes up.
  lie: 1.35, lieRate: 2.4,
};
var waterDepthCells = null;
//: Whether the walker may go into the water here and now: in City mode, on foot.
function walkerMayWade() {
  return typeof cityGame === "function" && cityGame() && typeof livingCity !== "undefined" && Boolean(livingCity)
    && !livingCity.driving && !livingCity.riding && !livingCity.inside;
}
function waterInland(x, z) {
  const guest = typeof guestUnder === "function" ? guestUnder(x, z) : null;
  if (guest?.ready) return guest.api.cityInlandAt ? guest.api.cityInlandAt(...hostToGuest(guest, x, z)) : { inland: false, basin: false };
  return typeof cityInlandAt === "function" ? cityInlandAt(x, z) : { inland: false, basin: false };
}
//: How deep the water is at (x, z) (m; 0 on land), by how far it is to the nearest dry ground and
//: what that is. Kept a metre square at a time.
function waterDepthAt(x, z) {
  if (typeof waterMaskAt !== "function" || waterMaskAt(x, z) !== true) return 0;
  const key = Math.floor(x) * 1048576 + Math.floor(z);
  if (!waterDepthCells || waterDepthCells.size > 40000) waterDepthCells = new Map();
  const had = waterDepthCells.get(key);
  if (had !== undefined) return had;
  const cx = Math.floor(x) + 0.5, cz = Math.floor(z) + 0.5, W = WATER_WADE;
  let d = W.shoreSearchM, sx = null, sz = null;
  search: for (let r = 0.75; r <= W.shoreSearchM; r += r < 6 ? 0.75 : r < 16 ? 1.5 : 3) {
    const n = Math.max(12, Math.round(r * 2.5));
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * Math.PI * 2, px = cx + Math.cos(a) * r, pz = cz + Math.sin(a) * r;
      if (waterMaskAt(px, pz) !== true) { d = r; sx = px; sz = pz; break search; }
    }
  }
  const inland = waterInland(cx, cz);
  let depth;
  if (inland.basin) depth = Math.min(W.basinMax, 0.12 + 0.08 * d);
  else if (inland.inland) depth = Math.min(W.pondMax, 0.15 + d * W.pondSlope);
  else {
    // A wall (a sea wall, a pier's edge, the harbour's side) stands well over the water: deep at
    // its foot. A beach meets the water at its own level.
    const over = sx === null || typeof walkerGroundAt !== "function" ? 0 : walkerGroundAt(sx, sz) - SEA_Y;
    const wall = over > W.wallOverM || (typeof mappedBuiltAt === "function" && sx !== null && mappedBuiltAt(sx, sz));
    depth = Math.min(W.seaMax, wall ? W.wallDrop + d * W.wallSlope : Math.max(0.05, d * W.beachSlope));
  }
  waterDepthCells.set(key, depth);
  return depth;
}
//: The walker in the water at (x, z) over ground at ``groundY``: null where it is not (on land,
//: on a deck or a pier over the water, out of City mode), else {mode: "wade" | "swim", feet (the
//: height the rig's feet are put at), depth (of water over the bottom)}. One object, reused.
var walkerWet = { mode: "wade", feet: 0, depth: 0, bottom: 0 };
function walkerWaterAt(x, z, groundY) {
  if (typeof WATER_WADE === "undefined" || !WATER_WADE || !walkerMayWade() || (typeof walkerOnWater === "function" && !walkerOnWater(x, z, groundY))) return null;
  const depth = waterDepthAt(x, z);
  if (depth <= 0.03) return null;
  const bottom = Math.min(groundY, SEA_Y - depth), over = SEA_Y - bottom;
  walkerWet.depth = over; walkerWet.bottom = bottom;
  if (over < WATER_WADE.swimDepth) { walkerWet.mode = "wade"; walkerWet.feet = bottom; return walkerWet; }
  // Afloat: the hips under the surface by how far the body lies (swimHips lying down; upright,
  // low enough that only the head is out).
  const lie = avatar.userData.swimLie || 0, upright = SEA_Y + WATER_WADE.headUp - walkerHeadOverHips();
  walkerWet.mode = "swim";
  walkerWet.feet = (upright + (SEA_Y - WATER_WADE.swimHips - upright) * lie) - AVATAR_STAND_Y;
  return walkerWet;
}
//: How high the walker's head is over its hips (the rig's origin), measured once a figure as it
//: stands; 0.75 m until it can be.
var walkerHeadCache = { key: null, h: 0.75 };
function walkerHeadOverHips() {
  const model = avatar.getObjectByName("imported-realistic-demo-character");
  const key = model?.uuid || null;
  if (key === walkerHeadCache.key) return walkerHeadCache.h;
  if (!model || (avatar.userData.swimLie || 0) > 0.01) return walkerHeadCache.h;
  let head = null;
  for (const n of ["mixamorigHead", "Head", "head", "neck_01", "Neck"]) { head = avatar.getObjectByName(n); if (head) break; }
  if (!head) { walkerHeadCache.key = key; return walkerHeadCache.h; }
  avatar.updateMatrixWorld(true);
  const p = head.getWorldPosition(new THREE.Vector3());
  const h = (p.y - avatar.position.y) / Math.max(1e-3, avatar.scale.y || 1);
  walkerHeadCache.key = key; walkerHeadCache.h = h > 0.3 && h < 1.6 ? h : 0.75;
  return walkerHeadCache.h;
}
//: Each frame, after the clip: the body laid down in the water to swim, or upright to tread water
//: or wade, and the stroke's state from the living city (its stamina says which). ``model`` is the
//: walker's figure; its tilt for a hill was set just before.
var swimBase = { key: null, y: 0, z: 0 };
function swimBodyPose(model, dt) {
  if (typeof WATER_WADE === "undefined" || !WATER_WADE) return;
  const wet = avatar.userData.water || null;
  const sw = wet && wet.mode === "swim" && typeof livingCity !== "undefined" && livingCity?.swim
    ? livingCity.swim(dt, Boolean(avatar.userData.lastMoving)) : null;
  avatar.userData.swim = sw;
  const goal = sw && (sw.mode === "swim" || sw.mode === "sprint") ? 1 : 0;
  const was = avatar.userData.swimLie || 0;
  const lie = goal > was ? Math.min(goal, was + WATER_WADE.lieRate * dt) : Math.max(goal, was - WATER_WADE.lieRate * dt);
  avatar.userData.swimLie = lie;
  if (!model) return;
  if (swimBase.key !== model.uuid) { swimBase.key = model.uuid; swimBase.y = model.position.y; swimBase.z = model.position.z; }
  if (lie < 1e-3) { if (was >= 1e-3) { model.position.y = swimBase.y; model.position.z = swimBase.z; } return; }
  // Laid forward about the feet, then put back so the hips stay where the rig's origin is.
  const th = WATER_WADE.lie * lie, s = Math.max(1e-3, avatar.scale.y || 1), hip = AVATAR_RADIUS / s;
  model.rotation.x += th;
  model.position.y = swimBase.y + hip * (1 - Math.cos(th));
  model.position.z = swimBase.z - hip * Math.sin(th);
}
