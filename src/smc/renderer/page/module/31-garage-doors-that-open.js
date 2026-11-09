// ---- Garage doors that open ------------------------------------------------------------------
//: Every garage door is drawn merged with the others of its style (fourteen thousand doors in a
//: few draw calls). One that opens is drawn on its own, over its merged copy: the dark of the
//: garage behind it, and the door rolling up into the head of the opening over a couple of
//: seconds, then down again. Opened by the living city -- a resident's door goes up before their
//: car drives out and comes down after it, up as it comes home and down once it is in
//: (docs/city/view.mjs) -- and by the walker at a garage of a house they own or rent (Enter), in
//: City mode and on the map alike.
var garageDoors = (() => {
  const TRAVEL_S = 2.4;
  const live = new Map();     // key -> {door, k, until, group, panel}
  const group = new THREE.Group();
  group.name = "garage-doors-open";
  group.userData.bayWide = true;
  const dark = new THREE.MeshBasicMaterial({ color: 0x0c0e11, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  const doorMats = new Map();
  const doorMat = (map) => {
    if (!doorMats.has(map)) doorMats.set(map, new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0xb9b2a6, roughness: 0.78, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    return doorMats.get(map);
  };
  //: The nearest door to (x, z) within ``reach`` metres -- of one building, when ``building`` is given.
  function near(x, z, reach = 4, building = null) {
    let best = null;
    for (const d of GARAGE_DOORS.values()) {
      if (Math.abs(d.x - x) > reach || Math.abs(d.z - z) > reach) continue;
      if (building !== null && building !== undefined && d.building !== String(building)) continue;
      const e = Math.hypot(d.x - x, d.z - z);
      if (e <= reach && (!best || e < best.d)) best = { ...d, d: e };
    }
    return best ? { key: best.key, building: best.building, x: best.x, z: best.z, yaw: best.yaw, w: best.w, h: best.h, d: best.d, open: isOpen(best.key) } : null;
  }
  function entry(key) {
    let e = live.get(key);
    if (!e) {
      const door = GARAGE_DOORS.get(key);
      if (!door) return null;
      const g = new THREE.Group();
      const base = typeof groundLiftAt === "function" ? groundLiftAt(door.x, door.z) : 0;
      g.position.set(door.x, base, door.z);
      g.rotation.y = door.yaw;
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(door.w * 0.97, door.h * 0.98), dark);
      hole.position.set(0, door.h * 0.49, 0.015);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(door.w, door.h), doorMat(door.map));
      panel.position.set(0, door.h / 2, 0.03);
      g.add(hole, panel);
      group.add(g);
      e = { door, k: 0, until: 0, group: g, panel };
      live.set(key, e);
    }
    return e;
  }
  //: Up for ``seconds`` (forever, if not given: until shut).
  function open(key, seconds = Infinity) {
    const e = entry(key);
    if (!e) return false;
    e.until = Math.max(e.until, performance.now() + seconds * 1000);
    return true;
  }
  function close(key) { const e = live.get(key); if (e) e.until = 0; }
  function isOpen(key) { const e = live.get(key); return Boolean(e && e.until > performance.now()); }
  function toggle(key) { if (isOpen(key)) { close(key); return false; } open(key); return true; }
  //: How far up each moving door is, a frame on.
  function tick(dt) {
    if (!live.size) return;
    if (!group.parent) root.add(group);
    const now = performance.now();
    for (const [key, e] of live) {
      const want = e.until > now ? 1 : 0;
      e.k = want ? Math.min(1, e.k + dt / TRAVEL_S) : Math.max(0, e.k - dt / TRAVEL_S);
      if (!want && e.k <= 0) {
        e.group.removeFromParent();
        e.group.traverse((o) => o.geometry?.dispose());
        live.delete(key);
        continue;
      }
      // Rolled up into the head: what is left of the door hangs from the top of the opening.
      const k = e.k * e.k * (3 - 2 * e.k), left = Math.max(0.04, 1 - k * 0.96);
      e.panel.scale.y = left;
      e.panel.position.y = e.door.h * (1 - left / 2);
    }
  }
  function reset() { for (const e of live.values()) e.group.removeFromParent(); live.clear(); }
  return { near, open, close, toggle, isOpen, tick, reset, count: () => GARAGE_DOORS.size, moving: () => live.size };
})();
