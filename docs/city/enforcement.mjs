// Who saw it. A moving violation -- speeding, a carpool lane short of its riders -- is charged
// only where it is seen: in the field of view of one of the map's enforcement cameras (the speed
// cameras view.mjs places along the arterials and draws on their poles), or with a patrol car
// near. The lane or the speedometer alone never fines anyone (rules.json enforcement.witness).
// Pure (tests/city_enforcement.test.mjs).

//: Whether a camera ({x, z, yaw}: it looks along -sin(yaw), -cos(yaw), the way its street runs)
//: has (x, z) in view: within its range and inside its cone.
export function cameraSees(cam, x, z, W) {
  const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
  if (d > W.camera_range_m) return false;
  if (d < 1.5) return true;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  return (dx * fx + dz * fz) / d >= Math.cos((W.camera_fov_deg / 2) * Math.PI / 180);
}

//: Who saw a car at ``at`` ({x, z}): the nearest camera with it in view, else a patrol car within
//: reach ({kind: "camera"|"police", id, x, z, d}), else null.
export function witnessOf(R, at, { cameras = [], vehicles = [] } = {}) {
  const W = R.enforcement.witness;
  let best = null;
  for (const c of cameras) {
    if (Math.abs(c.x - at.x) > W.camera_range_m || Math.abs(c.z - at.z) > W.camera_range_m) continue;
    if (!cameraSees(c, at.x, at.z, W)) continue;
    const d = Math.hypot(c.x - at.x, c.z - at.z);
    if (!best || d < best.d) best = { kind: "camera", id: c.id, x: c.x, z: c.z, d };
  }
  if (best) return best;
  for (const v of vehicles) {
    if (v.model !== "patrol" || v.wrecked) continue;
    const d = Math.hypot(v.x - at.x, v.z - at.z);
    if (d <= W.police_reach_m && (!best || d < best.d)) best = { kind: "police", id: v.id, x: v.x, z: v.z, d };
  }
  return best;
}
