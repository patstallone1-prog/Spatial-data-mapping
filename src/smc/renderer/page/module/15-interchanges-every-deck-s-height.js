// ---- interchanges: every deck's height solved together ----------------------------------------
//
// A freeway interchange is a graph of decks joined end to end, crossing over each other on two
// or three levels. Each deck used to be lifted on its own -- the Central Freeway at 5.2 m a
// layer, the stacked connectors (OpenStreetMap layer 2 and 3) not at all -- so the Hairball's
// ramps lay on the street and the decks that cross drew at one height. solveDeckLevels takes them
// together (docs/34-bridges-and-highways.md):
//
// * each deck is a line of stations every DECK_STATION_M; decks that share an end node share
//   that height exactly, and an end on an ordinary street is pinned to the street;
// * a highway deck aims for ground + DECK_LEVEL_M per OpenStreetMap layer (Caltrans' 16.5 ft
//   clearance over a freeway and the deck's depth); an ordinary bridge aims for the line between
//   its abutments, as it always did;
// * where two decks cross in plan, the one on the higher layer clears the lower by a level, and
//   a deck clears every street it passes over (bridgeClearanceControls);
// * no grade is steeper than 6% on a named freeway or 8% on a ramp or bridge.
//
// The heights are relaxed together (smoothing toward the targets, then each rule enforced in
// turn) a fixed number of times, so the result is the same on every load. What it reaches is
// reported (DECK_LEVEL_REPORT): every crossing's clearance, every deck's steepest grade.
const DECK_LEVEL_M = 6.6, DECK_STATION_M = 10, DECK_GRADES = { mainline: 0.06, ramp: 0.08 };
//: decks: [{ id, pts: [[x, z], ...], layer, highway, mainline, ends: [key, key], base?(x, z),
//:   controls?: [{ x, z, target }] }]; pins: Map(key -> height); ground(x, z).
//: Returns { profiles: Map(id -> (x, z) => height), stations: Map(id -> { pts, h }), report }.
function solveDeckLevels(decks, { ground, pins = new Map(), level = 6.6, step = 10,
  grades = { mainline: 0.06, ramp: 0.08 }, iterations = 260 } = {}) {
  const lines = decks.map((d) => {
    const pts = [d.pts[0]];
    for (let i = 1; i < d.pts.length; i += 1) {
      const [ax, az] = d.pts[i - 1], [bx, bz] = d.pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 1; k <= n; k += 1) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    const s = [0];
    for (let i = 1; i < pts.length; i += 1) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const lv = Math.max(1, Number(d.layer) || 1);
    const target = pts.map(([x, z]) => (d.highway || !d.base ? ground(x, z) + level * lv : d.base(x, z)));
    const floor = pts.map(([x, z]) => ground(x, z));
    const pinned = [pins.has(d.ends[0]) ? pins.get(d.ends[0]) : null, pins.has(d.ends[1]) ? pins.get(d.ends[1]) : null];
    const h = target.slice();
    if (pinned[0] !== null) h[0] = pinned[0];
    if (pinned[1] !== null) h[h.length - 1] = pinned[1];
    return { d, pts, s, h, target, floor, lv, pinned, grade: d.mainline ? grades.mainline : grades.ramp };
  });
  // Ends shared by decks: one height.
  const ties = new Map();
  lines.forEach((L, li) => L.d.ends.forEach((key, e) => {
    if (!ties.has(key)) ties.set(key, []);
    ties.get(key).push([li, e ? L.h.length - 1 : 0]);
  }));
  // Where two decks cross in plan, away from an end they share.
  const crossings = [];
  const box = lines.map((L) => L.pts.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]));
  for (let a = 0; a < lines.length; a += 1) for (let b = a + 1; b < lines.length; b += 1) {
    const A = lines[a], B = lines[b];
    if (A.lv === B.lv) continue;
    if (box[a][0] > box[b][2] || box[b][0] > box[a][2] || box[a][1] > box[b][3] || box[b][1] > box[a][3]) continue;
    const shared = A.d.ends.filter((k) => B.d.ends.includes(k));
    for (let i = 1; i < A.pts.length; i += 1) for (let j = 1; j < B.pts.length; j += 1) {
      const [p0, p1] = [A.pts[i - 1], A.pts[i]], [q0, q1] = [B.pts[j - 1], B.pts[j]];
      const rx = p1[0] - p0[0], rz = p1[1] - p0[1], sx = q1[0] - q0[0], sz = q1[1] - q0[1];
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((q0[0] - p0[0]) * sz - (q0[1] - p0[1]) * sx) / den, u = ((q0[0] - p0[0]) * rz - (q0[1] - p0[1]) * rx) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const x = p0[0] + rx * t, z = p0[1] + rz * t;
      if (shared.length && [A.pts[0], A.pts.at(-1)].some(([ex, ez]) => Math.hypot(ex - x, ez - z) < 25)) continue;
      const [up, upI, upT, lo, loI, loT] = A.lv > B.lv ? [a, i, t, b, j, u] : [b, j, u, a, i, t];
      crossings.push({ up, upI, upT, lo, loI, loT, x, z });
    }
  }
  // A deck over a street: the street's clearance at the point of the deck over it.
  const controls = [];
  lines.forEach((L, li) => (L.d.controls || []).forEach((c) => {
    let best = null;
    for (let i = 1; i < L.pts.length; i += 1) {
      const [ax, az] = L.pts[i - 1], [bx, bz] = L.pts[i];
      const dx = bx - ax, dz = bz - az, n = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / n));
      const dist = Math.hypot(ax + dx * t - c.x, az + dz * t - c.z);
      if (!best || dist < best.dist) best = { i, t, dist };
    }
    if (best && best.dist < 3) controls.push({ li, i: best.i, t: best.t, target: c.target });
  }));
  const at = (L, i, t) => L.h[i - 1] * (1 - t) + L.h[i] * t;
  // The end heights every deck must meet: a pin (the street), or the decks' shared mean.
  const endValues = () => {
    const out = new Map();
    for (const [key, members] of ties) out.set(key, pins.has(key) ? pins.get(key)
      : members.reduce((sum, [li, i]) => sum + lines[li].h[i], 0) / members.length);
    return out;
  };
  // A deck's heights: at least what it must clear (req), the least grade-limited profile over
  // that (each requirement a cone of the road's grade), and no further than its grade from the
  // heights its ends are held at. Exact for the grade by construction.
  const shape = (L, req, ends) => {
    const n = L.h.length, g = L.grade, h = L.h;
    for (let i = 0; i < n; i += 1) h[i] = Math.max(h[i], req[i]);
    const held = [[0, ends[0]], [n - 1, ends[1]]].filter(([, v]) => v !== null);
    for (const [k, v] of held) for (let i = 0; i < n; i += 1) h[i] = Math.max(h[i], v - g * Math.abs(L.s[i] - L.s[k]));
    for (let i = 1; i < n; i += 1) h[i] = Math.max(h[i], h[i - 1] - g * (L.s[i] - L.s[i - 1]));
    for (let i = n - 2; i >= 0; i -= 1) h[i] = Math.max(h[i], h[i + 1] - g * (L.s[i + 1] - L.s[i]));
    for (const [k, v] of held) for (let i = 0; i < n; i += 1) h[i] = Math.min(h[i], v + g * Math.abs(L.s[i] - L.s[k]));
  };
  for (let it = 0; it <= iterations; it += 1) {
    if (it < iterations) for (const L of lines) {
      const n = L.h.length;
      for (let i = 1; i < n - 1; i += 1) L.h[i] += 0.5 * ((L.h[i - 1] + L.h[i + 1]) / 2 - L.h[i]) + 0.06 * (L.target[i] - L.h[i]);
      for (const i of [0, n - 1]) L.h[i] += 0.2 * (L.target[i] - L.h[i]);
    }
    const ends = endValues();
    const req = lines.map((L) => L.floor.slice());
    for (const c of controls) { const r = req[c.li]; r[c.i - 1] = Math.max(r[c.i - 1], c.target); r[c.i] = Math.max(r[c.i], c.target); }
    for (const c of crossings) {
      const need = at(lines[c.lo], c.loI, c.loT) + level, r = req[c.up];
      r[c.upI - 1] = Math.max(r[c.upI - 1], need); r[c.upI] = Math.max(r[c.upI], need);
    }
    lines.forEach((L, li) => shape(L, req[li], L.d.ends.map((k) => ends.get(k))));
  }
  const report = { decks: lines.length, crossings: crossings.length, minClearance: Infinity, maxGrade: 0, maxGradeOver: 0, endGap: 0,
    streetControls: controls.length, minStreetMargin: Infinity };
  for (const c of crossings) report.minClearance = Math.min(report.minClearance, at(lines[c.up], c.upI, c.upT) - at(lines[c.lo], c.loI, c.loT));
  for (const c of controls) report.minStreetMargin = Math.min(report.minStreetMargin, at(lines[c.li], c.i, c.t) - c.target);
  for (const L of lines) for (let i = 1; i < L.h.length; i += 1) {
    const g = Math.abs(L.h[i] - L.h[i - 1]) / Math.max(1e-6, L.s[i] - L.s[i - 1]);
    report.maxGrade = Math.max(report.maxGrade, g);
    report.maxGradeOver = Math.max(report.maxGradeOver, g - L.grade);
  }
  for (const members of ties.values()) {
    const hs = members.map(([li, i]) => lines[li].h[i]);
    report.endGap = Math.max(report.endGap, Math.max(...hs) - Math.min(...hs));
  }
  const profiles = new Map(), stations = new Map();
  for (const L of lines) {
    const { pts, h } = L;
    stations.set(L.d.id, { pts, h, s: L.s });
    profiles.set(L.d.id, (x, z) => {
      let best = null;
      for (let i = 1; i < pts.length; i += 1) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const dx = bx - ax, dz = bz - az, n = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / n));
        const dist = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
        if (!best || dist < best.dist) best = { dist, y: h[i - 1] + (h[i] - h[i - 1]) * t };
      }
      return best ? best.y : h[0];
    });
  }
  return { profiles, stations, crossings, report };
}
var DECK_LEVEL_REPORT = null;
//: The Central Freeway's decks as solved with the rest (centralFreewayProfile reads them).
const CENTRAL_SOLVED = new Map();
const BRIDGE_LIFTS = (() => {
  const lifts = new Map();
  if (!REGION_BRIDGE_WAYS.length && !CENTRAL_FREEWAY_WAYS.length) return lifts;
  const keyOf = (x, z) => `${Math.round(x * 2)}:${Math.round(z * 2)}`;
  const parent = REGION_BRIDGE_WAYS.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = REGION_BRIDGE_WAYS.map((way) => [way.points[0], way.points[way.points.length - 1]]
    .map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; }));
  const byKey = new Map();
  ends.forEach((pair, i) => pair.forEach(([x, z]) => {
    const key = keyOf(x, z);
    if (byKey.has(key)) parent[find(i)] = find(byKey.get(key)); else byKey.set(key, i);
  }));
  const counts = new Map();
  ends.forEach((pair) => pair.forEach(([x, z]) => { const key = keyOf(x, z); counts.set(key, (counts.get(key) || 0) + 1); }));
  const groups = new Map();
  REGION_BRIDGE_WAYS.forEach((way, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
  // The interchanges: every group with a highway's deck in it, and the Central Freeway, solved
  // together (solveDeckLevels). An ordinary bridge's group is carried between its abutments.
  const solvedWays = [];
  for (const members of groups.values()) {
    if (members.some((i) => structureKindOf(REGION_BRIDGE_WAYS[i]) === "highway")) solvedWays.push(...members.map((i) => REGION_BRIDGE_WAYS[i]));
  }
  solvedWays.push(...CENTRAL_FREEWAY_WAYS);
  if (solvedWays.length) {
    const local = (p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; };
    const pins = new Map();
    const decks = solvedWays.map((way, i) => {
      const keys = [way.points[0], way.points[way.points.length - 1]].map(bridgeNodeKey);
      [way.points[0], way.points[way.points.length - 1]].forEach((p, e) => {
        if (GROUND_JOIN_NODES.has(keys[e])) { const [x, z] = local(p); pins.set(keys[e], groundLiftAt(x, z)); }
      });
      return { id: i, pts: densifyWay(way.points, 3).map(local), layer: Number(way.layer) || 1, highway: true,
        mainline: isHighwayName(way.name), ends: keys, controls: bridgeClearanceControls([way]) };
    });
    const solved = solveDeckLevels(decks, { ground: (x, z) => groundLiftAt(x, z), pins, level: DECK_LEVEL_M,
      step: DECK_STATION_M, grades: DECK_GRADES });
    DECK_LEVEL_REPORT = { ...solved.report, basis: "inferred: OpenStreetMap layers and shared nodes, Caltrans clearance and grade limits" };
    solvedWays.forEach((way, i) => {
      const lift = solved.profiles.get(i);
      // Piers keep clear of whatever passes under: the streets, and the decks below.
      const under = solved.crossings.filter((c) => c.up === i).map((c) => ({ x: c.x, z: c.z, half: (solvedWays[c.lo].road_m || 7) / 2 }));
      lift.clearanceControls = [...bridgeClearanceControls([way]), ...under];
      lift.clearanceBasis = "inferred_visual_not_measured";
      lift.groundLiftKey = "deck:" + i;
      lift.abutments = [];
      lift.level = Number(way.layer) || 1;
      if (CENTRAL_FREEWAY_WAYS.includes(way)) CENTRAL_SOLVED.set(way, lift); else lifts.set(way, lift);
    });
  }
  for (const members of groups.values()) {
    if (lifts.has(REGION_BRIDGE_WAYS[members[0]])) continue;
    const abutments = [];
    for (const i of members) for (const [x, z] of ends[i]) if (counts.get(keyOf(x, z)) === 1) abutments.push([x, z, groundLiftAt(x, z)]);
    if (!abutments.length) continue;
    const lift = (x, z) => {
      let sum = 0, weight = 0;
      for (const [ax, az, ah] of abutments) {
        const d = Math.hypot(ax - x, az - z);
        if (d < 0.5) return ah;
        const w = 1 / (d * d);
        sum += w * ah; weight += w;
      }
      return sum / weight;
    };
    const resolved=bridgeClearanceProfile(lift,abutments,
      bridgeClearanceControls(members.map(i=>REGION_BRIDGE_WAYS[i])));
    resolved.abutments = abutments;
    resolved.groundLiftKey='bridge:'+members[0];
    for (const i of members) lifts.set(REGION_BRIDGE_WAYS[i], resolved);
  }
  return lifts;
})();
function addRegionBridgeStructures() {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb8b5ad, roughness: 0.9 });
  const position = [], index = [];
  const pierMatrices = [];
  const quad = (a, b, c, d) => {
    const base = position.length / 3;
    position.push(...a, ...b, ...c, ...d);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [way, lift] of BRIDGE_LIFTS) {
    // The deck lift has interior clearance controls, not just endpoint heights.
    // Its parapets/underside must sample that same profile, or a long chord
    // still crosses the road even though the asphalt above it was corrected.
    const pts = densifyWay(way.points,3).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    const half = (way.road_m || 7) / 2 + 0.2;
    let s = 0, nextPier = 10;
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const ya = lift(ax, az) + ROAD_TOP_M, yb = lift(bx, bz) + ROAD_TOP_M;
      for (const side of [-1, 1]) {
        const o = side * half;
        // The parapet: its outer face down to the deck's underside, its top a metre over the road.
        quad([ax + nx * o, ya - 1.2, az + nz * o], [bx + nx * o, yb - 1.2, bz + nz * o], [bx + nx * o, yb + 1.0, bz + nz * o], [ax + nx * o, ya + 1.0, az + nz * o]);
        quad([ax + nx * (o - side * 0.3), ya + 1.0, az + nz * (o - side * 0.3)], [bx + nx * (o - side * 0.3), yb + 1.0, bz + nz * (o - side * 0.3)],
             [bx + nx * o, yb + 1.0, bz + nz * o], [ax + nx * o, ya + 1.0, az + nz * o]);
        quad([ax + nx * (o - side * 0.3), ya, az + nz * (o - side * 0.3)], [bx + nx * (o - side * 0.3), yb, bz + nz * (o - side * 0.3)],
             [bx + nx * (o - side * 0.3), yb + 1.0, bz + nz * (o - side * 0.3)], [ax + nx * (o - side * 0.3), ya + 1.0, az + nz * (o - side * 0.3)]);
      }
      // The deck's underside.
      quad([ax - nx * half, ya - 1.2, az - nz * half], [bx - nx * half, yb - 1.2, bz - nz * half], [bx + nx * half, yb - 1.2, bz + nz * half], [ax + nx * half, ya - 1.2, az + nz * half]);
      while (nextPier <= s + len) {
        const t = (nextPier - s) / len;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const top = ya + (yb - ya) * t - 1.2, base = terrainHeightAt(x, z);
        const underRoad=(lift.clearanceControls || []).some(c=>Math.hypot(x-c.x,z-c.z)<half+c.half+2);
        if (top - base > 2.5 && !underRoad) {
          pierMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (top + base) / 2, z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(nx, nz)),
            new THREE.Vector3(Math.max(1.2, half * 1.2), top - base, 1.1)));
        }
        nextPier += lift.level ? 32 : 18;   // a freeway viaduct's bents, an ordinary bridge's piers
      }
      s += len;
    }
  }
  if (index.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb8b5ad, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.userData = { surface: "bridge_parapet", liftedOntoGround: true,provenance:"inferred_visual_not_measured" };
    groups.streets.add(mesh);
  }
  if (pierMatrices.length) {
    const piers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), concrete, pierMatrices.length);
    pierMatrices.forEach((m, i) => piers.setMatrixAt(i, m));
    piers.instanceMatrix.needsUpdate = true;
    piers.computeBoundingSphere();
    piers.userData = { surface: "bridge_pier", liftedOntoGround: true };
    groups.streets.add(piers);
  }
  return { decks: BRIDGE_LIFTS.size, piers: pierMatrices.length };
}

//: The islands and their canopies (TRANSIT_CANOPIES), and the busways' paint.
function addTransitIslands() {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xc4c0b6, roughness: 0.88 });
  const tactile = new THREE.MeshStandardMaterial({ color: 0xe2bf3c, roughness: 0.7 });
  const roof = new THREE.MeshStandardMaterial({ color: STOP_ROOF_RED, roughness: 0.45, metalness: 0.25 });
  const post = new THREE.MeshStandardMaterial({ color: 0x5f676b, roughness: 0.45, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, transparent: true, opacity: 0.3,
    side: THREE.DoubleSide, depthWrite: false });
  realGlass(glass);
  const seat = new THREE.MeshStandardMaterial({ color: 0x8c949a, roughness: 0.5, metalness: 0.4 });
  const parts = new Map();
  const add = (material, x, y, z, w, h, d, yaw) => {
    if (!parts.has(material)) parts.set(material, []);
    parts.get(material).push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(w, h, d)));
  };
  const islands = [];
  for (const way of TRANSIT_CANOPIES) {
    const pts = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    // The canopy's long axis, from its longest edge.
    let best = 0, ux = 1, uz = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1], l = Math.hypot(dx, dz);
      if (l > best) { best = l; ux = dx / l; uz = dz / l; }
    }
    const nx = -uz, nz = ux;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let along = 0, across = 0;
    for (const [x, z] of pts) {
      along = Math.max(along, Math.abs((x - cx) * ux + (z - cz) * uz));
      across = Math.max(across, Math.abs((x - cx) * nx + (z - cz) * nz));
    }
    const yaw = Math.atan2(-uz, ux);
    const ground = groundLiftAt(cx, cz) + ROAD_TOP_M;
    // The platform: the canopy's length and more, kerb high, with a tactile strip down each edge.
    const length = Math.max(2 * along + 14, 30), width = Math.max(2 * across + 1.6, 3.2);
    add(concrete, cx, ground + 0.11, cz, length, 0.22, width, yaw);
    for (const sgn of [-1, 1]) add(tactile, cx + nx * sgn * (width / 2 - 0.35), ground + 0.225, cz + nz * sgn * (width / 2 - 0.35), length - 0.4, 0.01, 0.6, yaw);
    // The canopy over it, on posts.
    const top = ground + 0.22 + 3.0;
    add(roof, cx, top, cz, 2 * along + 0.6, 0.14, 2 * across + 0.6, yaw);
    for (let a = -along; a <= along + 0.01; a += Math.max(3, along)) {
      add(post, cx + ux * a, ground + 0.22 + 1.5, cz + uz * a, 0.14, 3.0, 0.14, yaw);
    }
    // A windscreen down the middle, and benches either side of it.
    add(glass, cx, ground + 0.22 + 1.2, cz, 2 * along - 0.4, 1.9, 0.03, yaw);
    for (const sgn of [-1, 1]) add(seat, cx + nx * sgn * 0.45, ground + 0.22 + 0.45, cz + nz * sgn * 0.45, Math.max(1.6, along), 0.06, 0.42, yaw);
    islands.push([cx, cz, length / 2 + 2]);
  }
  for (const [material, list] of parts) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData = { surface: "transit_island", liftedOntoGround: true };
    groups.streets.add(mesh);
  }
  TRANSIT_ISLAND_SPOTS.push(...islands);
  return { islands: islands.length, busways: BUSWAY_WAYS.length };
}
var TRANSIT_ISLAND_SPOTS = [];

// ---- the islands the survey has, ahead of the ones the page infers ----
//
// The aerial pass (scripts/build_ortho_islands.py, docs/sf-corridor-islands.json) gives the
// islands it saw raised, at the survey's own kerb lines. Between the two halves of a divided
// street the page also infers a median from the gap: wherever the gap was wide enough it was
// raised, kerb to kerb. Where the survey has an island in that gap, the survey's island is the
// island and the rest of the gap is roadway. At Fillmore & Chestnut the inferred one was a
// slab 5-8 m wide where the street has a strip under 2 m with angled parking beside it.
//
//: Islands confirmed from a photograph where the aerial pass could not confirm them, by the
//: survey's line ids (``lines`` in the islands file). 4137: the narrow island between
//: Fillmore's southbound lanes and its right-turn lane at Chestnut (street photograph,
//: 2026-11-26).
const CONFIRMED_SURVEY_ISLAND_LINES = new Set([4137]);
function surveyedIslandKept(island) {
  return island.basis !== "survey_unconfirmed" || Boolean(island.closed_in_survey)
    || (island.lines || []).some((id) => CONFIRMED_SURVEY_ISLAND_LINES.has(id));
}
//: The kept islands as x/z rings with their bounds: [{ ring, x0, z0, x1, z1 }].
const SURVEYED_ISLANDS = (typeof ORTHO_ISLANDS !== "undefined" && ORTHO_ISLANDS?.schema === "kerbside.islands/1")
  ? (ORTHO_ISLANDS.islands || []).filter(surveyedIslandKept)
    .map((island) => island.p.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; }))
    .filter((ring) => ring.length >= 4)
    .map((ring) => ({ ring, x0: Math.min(...ring.map((p) => p[0])), x1: Math.max(...ring.map((p) => p[0])),
      z0: Math.min(...ring.map((p) => p[1])), z1: Math.max(...ring.map((p) => p[1])) }))
  : [];
function surveyedIslandAt(x, z) {
  for (const s of SURVEYED_ISLANDS) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    if (pointInRing(x, z, s.ring)) return true;
  }
  return false;
}
//: Whether a surveyed island lies on the segment from (ax, az) to (bx, bz), looked at every
//: 0.4 m (the narrowest island the survey keeps is wider than that).
function surveyedIslandAcross(ax, az, bx, bz) {
  if (!SURVEYED_ISLANDS.length) return false;
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4));
  for (let k = 0; k <= n; k += 1) if (surveyedIslandAt(ax + (bx - ax) * k / n, az + (bz - az) * k / n)) return true;
  return false;
}
//: The pieces of a line (lon/lat points) not running beside a surveyed island: each point is
//: asked whether one lies within ``reach`` m to its left (a divided half's median side).
function clearOfSurveyedIslands(points, reach) {
  if (!SURVEYED_ISLANDS.length || points.length < 2) return [points];
  const xz = points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  const beside = xz.map(([x, z], i) => {
    const [px, pz] = xz[Math.max(0, i - 1)], [qx, qz] = xz[Math.min(xz.length - 1, i + 1)];
    const len = Math.hypot(qx - px, qz - pz) || 1;
    // Left of travel in x/z (z is south): (dz, -dx).
    const lx = (qz - pz) / len, lz = -(qx - px) / len;
    return surveyedIslandAcross(x, z, x + lx * reach, z + lz * reach);
  });
  const pieces = [];
  let run = [];
  points.forEach((p, i) => {
    if (beside[i]) { if (run.length >= 2) pieces.push(run); run = []; medianSurveyStats.edgeLinesCut += 1; return; }
    run.push(p);
  });
  if (run.length >= 2) pieces.push(run);
  return pieces;
}
//: Stations of an inferred median left as roadway because the survey has the island there, and
//: points of the median-edge line not painted beside one.
const medianSurveyStats = { yielded: 0, edgeLinesCut: 0 };
window.kerbsideMedianSurvey = () => ({ ...medianSurveyStats, islands: SURVEYED_ISLANDS.length });

const DRAW_ORDER = DATA.ways.slice().sort((a, b) => {
  const rank = (w) => w.kind === "divider" ? 2
    : (w.kind === "sidewalk" || w.kind === "path" ? 0 : 1);
  return rank(a) - rank(b);
});
let builtWays = 0;
//: The footpaths, laid once the streets, their walks and the frontage fill are down: each is cut
//: where it meets that pavement (pathCutAt), which is not known until it is laid.
const deferredPaths = [];
for (const way of DRAW_ORDER) {
 // The budget is asked after every way, not every thirty-second: a run of thirty-two buildings
 // was a third of a second of a walking frame. Asking only reads the clock.
 ++builtWays; if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame(`Building the streets: ${Math.round(100 * builtWays / DRAW_ORDER.length)}%`);
 const centralDeck = CENTRAL_FREEWAY_WAYS.includes(way) ? centralFreewayProfile(way) : null;
 WAY_LIFT = centralDeck || BRIDGE_LIFTS.get(way) || (["street","sidewalk","path","wall"].includes(way.kind)
   && !way.bridge && !(Number(way.layer)>0) && wayFollowsCut(way) ? cutRibbonLiftAt
   : way.kind === "crossing" && way.points && way.points.length >= 2 ? lineLiftFor(way.points) : null);
 if (way.kind === "street" && (centralDeck || BRIDGE_LIFTS.get(way))) registerElevatedWay(way, WAY_LIFT);
 if (way.kind === "beach") {
 const shape = footprintShape(way.points);
 if (shape) {
 const geom = new THREE.ShapeGeometry(shape);
 geom.rotateX(-Math.PI / 2);
 const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
 map: SAND, color: 0xffffff, roughness: 0.96, metalness: 0.0,
 side: THREE.DoubleSide,
 }));
 mesh.position.y = BEACH_Y;
 mesh.userData.surface = "beach";
 mesh.userData.liftedOntoGround = true;   // the beach is at the water's edge, not on the hill
 groups.ground.add(mesh);
 }
 continue;
 }
 if (way.kind === "pier") {
 // A pier's deck: scored concrete, lifted onto the ground the grid has under it (the quay's
 // height, carried out along the pier), so it stands over the water at the quay's level.
 const shape = footprintShape(way.points);
 if (shape) {
 const geom = new THREE.ShapeGeometry(shape);
 geom.rotateX(-Math.PI / 2);
 const uv = geom.getAttribute("uv"), pos = geom.getAttribute("position");
 for (let i = 0; i < uv.count; i += 1) uv.setXY(i, pos.getX(i) / 1.5, pos.getZ(i) / 1.5);
 const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
 map: SIDEWALK, color: 0xd8d8d4, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
 }));
 mesh.position.y = PIER_DECK_Y;
 mesh.userData.surface = "pier";
 groups.ground.add(mesh);
 }
 continue;
 }
 if (way.kind === "water") {
    // The bay, the lagoon and Aquatic Park. Nothing in the query reached them before, so the
    // whole northern edge of the corridor was drawn as ground. Where the grid has a measured
    // waterline the sea is the ground's own (the waterline pass set the grid to the surface
    // under these very polygons), and a sheet laid over it a centimetre up is a second plane
    // the depth buffer cannot tell from the first a few kilometres out: the bands off the
    // coastline were long shards of darker water from any height.
    if (LANDWATER || (TERRAIN && TERRAIN.meta.waterline && TERRAIN.meta.waterline.surface_m !== null
        && TERRAIN.meta.waterline.surface_m !== undefined)) continue;
    const shape = footprintShape(way.points);
    if (shape) {
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      // Flat and matte rather than polished. At 0.28 roughness the near water went almost black
      // whenever it was seen at a grazing angle with the sun off to one side -- which from a
      // quay is most of the time -- so the cove read as a hole while the far bay read as water.
      // A rougher, lighter surface loses the mirror and keeps the colour from every angle.
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color: 0x2c6187, roughness: 0.62, metalness: 0.04,
        envMapIntensity: 0.5, side: THREE.DoubleSide,
      }));
      mesh.position.y = WATER_Y;
      // Water is at sea level and stays there: lifted onto the terrain it stood over the
      // hillside as a sheet of reflecting blue wherever its polygon ran inland.
      mesh.userData.surface = "water";
      mesh.userData.liftedOntoGround = true;
      groups.streets.add(mesh);
    }
    continue;
  }
  if (way.kind === "divider") {
    if (!way.points || way.points.length < 2 || !dividerFootprintIsRoadborne(way)) continue;
    const divider = dividerBlockMesh(way, ROAD_TOP_M);
    if (divider) addMerged("divider:block", divider, "divider_block");
    continue;
  }
  if (way.kind === "poi" || way.kind === "coastline") continue;
  // A parking aisle on a mapped lot is the lot's surface (fold_parking_aisles_into_lots); it
  // fell through to the street branch here and was drawn as a six-metre road across the lot.
  if (way.kind === "parking_aisle") continue;
  if (way.kind === "wall") {
    // A wall the map draws along a tunnel's cut is that cut's retaining wall, which addCutWalls
    // builds to the cut's own road and the ground above it; stood on the ground here it leaned
    // across the cut, its foot on the road and its head on the hill.
    if (insideCutBand(way)) continue;
    const wall = addWall(way);
    if (wall) addMerged(`wall:${/brick/i.test(way.material || "") ? "brick" : "stone"}`, wall, "wall");
    continue;
  }
  if (way.kind === "parking_lot") {
    const lot = addParkingLot(way);
    if (lot) groups.streets.add(lot);
    continue;
  }
  if (way.kind === "building" && isTransitCanopy(way)) {
    TRANSIT_CANOPIES.push(way);
    continue;
  }
  if (way.kind === "building") {
    // This OSM footprint is the Posey headhouse around the tunnel mouth, not a solid
    // obstruction. The dedicated arched portal already represents its street face.
    if (mappedTubePortalBuilding(way)) continue;
    // On the ground, where a footprint is. At 1.8 m it was a plate floating at head height
    // through the middle of every building.
    // The flat footprint under a building is the fallback for one that has no 3D mesh. Drawn
    // for the covered ones too it is 15,213 slabs lying under 15,213 buildings, entirely hidden
    // and entirely paid for: sixteen thousand draw calls a frame that cannot be seen.
    if (way.covered) { dropEditedWallGarages(way); dropStorefrontGarages(way); }
    // Every building that has a footprint stands, surveyed or not. One outside the survey's
    // coverage (``covered`` false: 41 in the Marina -- the houses of Casa Way and Rico Way, the
    // park buildings at Moscone) was left as a faint plate on the ground, and the city put its
    // door there all the same: a door standing in the air (2026-11-19). Its height is the
    // city's lidar's, its walls the plain ones of its kind.
    const building = buildingMesh(way);
    if (!building) {
      const base = footprintMesh(way.points, way.covered ? 0x2b4148 : 0x1b2a2f,
                                 way.covered ? 0.42 : 0.18, 0.04);
      if (base) addMerged("footprint", base, "footprint");
    }
    if (!way.covered && building && building.isObject3D) groups.mapped3d.add(building);
    if (way.covered) {
      if (building && building.isObject3D) groups.mapped3d.add(building);
      // A dropped kerb outside means a way in. The city records 14,130 of these against
      // buildings in this corridor, with the width of each.
      for (const opening of way.garages || []) {
        const panel = garagePanel(opening, opening.colour ? new THREE.Color(liftSampledColour(opening.colour)).getHex()
          : way.colour !== undefined ? new THREE.Color(way.colour).getHex() : 0x9aa0a4);
        // Fourteen thousand garage doors, six styles between them, tinted to their building.
        // The tint is already in the texture, so keying on that merges them down to the number
        // of distinct doors the city actually has rather than the number of openings.
        if (panel) { rememberGarageDoor(panel, way.osm_id); addMerged("garage", panel, "garage"); }
        // The dropped kerb itself is made after the pavements are merged, in
        // dropKerbsAtDriveways: the pavement is let down, not a ramp laid on it.
      }
    }
    continue;
  }
  if (way.busway && way.points && way.points.length > 1) {
    // The busway's lanes painted red the way a bike lane is painted green, stopped at each
    // junction's box so the crosswalks run across it unbroken. The way still draws its own
    // asphalt below. It stands a few centimetres clear of the asphalt rather than one: the
    // carriageways' ribbons are long flat triangles laid on a hill, and between their vertices
    // they rise through a red that follows the ground -- the lane came out in torn patches.
    let run = [];
    const paintRun = () => {
      if (run.length > 1) {
        const fill = ribbon(run, Math.max(3.0, (way.road_m || 7.2) - 0.5), 0xa23a2c, 1.0, ROAD_TOP_M + 0.034, 0.012, "busway");
        if (fill) addMerged("busway:fill", fill, "busway");
      }
      run = [];
    };
    const dense = densifyWay(way.points, 1.5);
    dense.forEach((point, i) => {
      const [x, y] = xy(point[0], point[1]);
      const [px, py] = xy(...dense[Math.max(0, i - 1)]), [qx, qy] = xy(...dense[Math.min(dense.length - 1, i + 1)]);
      if (insideJunctionBox(x, -y) || medianCrossStreetAt(x, -y, qx - px, -(qy - py))) paintRun(); else run.push(point);
    });
    paintRun();
  }
  if (way.kind === "cycleway") {
    // A cycle track mapped as its own way (a road's cycleway=separate): the green and its two
    // edge lines, at road level, joined onto the lanes that run into it. No carriageway, no
    // kerbs, no footways -- it is a lane, not a street.
    if (!way.points || way.points.length < 2) continue;
    const trackWidth = way.track_m || (way.oneway && way.oneway !== "no" ? BIKE_LANE_M : BIKE_TRACK_TWO_WAY_M);
    let lane = densifyWay(way.points, 2.0);
    const [sx, sy] = xy(lane[0][0], lane[0][1]);
    const [ex, ey] = xy(lane[lane.length - 1][0], lane[lane.length - 1][1]);
    const joinStart = bikeLaneJoinTarget(sx, -sy, ...laneEndDirection(lane, true));
    const joinEnd = bikeLaneJoinTarget(ex, -ey, ...laneEndDirection(lane, false));
    if (joinStart) lane = blendLaneEnd(lane, joinStart, true);
    if (joinEnd) lane = blendLaneEnd(lane, joinEnd, false);
    const fill = ribbon(lane, trackWidth, 0xffffff, 1.0, ROAD_TOP_M + 0.010, 0.012, "bike");
    if (fill) addMerged("bike:fill", fill, "bike");
    for (const side of [1, -1]) {
      const edge = paintedLine(offsetWay(lane, side * bikePaintEdgeOffset(trackWidth)), BIKE_EDGE_W_M, 0xf2f5ef, ROAD_TOP_M + 0.030);
      if (edge) addMerged("bike:edge", edge, "marking");
    }
    continue;
  }
  const isPath = way.kind === "path";
  // A path across a plaza the map draws as paving (Union Square): the paving is the path. Laid
  // as kerb-height slabs on it, nineteen footways crossed and overlapped in a tangle of edges.
  if (isPath && pathInsidePlaza(way)) continue;
  // A short path mapped over the carriageway is a crossing (its markings are the crossing's
  // own): drawn as a kerb-height slab it lay diagonally across Powell and Post.
  if (isPath && pathMostlyOnRoad(way)) continue;
  // A footpath mapped along a street on the street's own walk: the walk is drawn already.
  if (isPath && !pathHasOwnMaterial(way) && pathAlongKerbsideWalk(way)) continue;
  const isCrossing = way.kind === "crossing";
  // A few OpenStreetMap ways tagged as crossings run the length of a block -- a path across a
  // plaza, a mis-tagged footway. Painted as ladders they laid bars clear across the scene.
  if (isCrossing && wayLength(way.points) > 40) continue;
  const isSidewalk = way.kind === "sidewalk";
  // A mapped sidewalk along a street's own kerbside walk: the street lays it, kerb to property
  // line, at its height (addKerbsidePavement); drawn again it was a second slab on the first.
  if (isSidewalk && typeof mappedSidewalkIsStreetWalk === "function" && mappedSidewalkIsStreetWalk(way)) continue;
  // White for everything: the value now comes from the texture, and tinting a photograph of
  // concrete amber to say "this is a crossing" was a legend, not a street.
  const color = 0xffffff;
  // Widths from San Francisco's own records where it has them: the surveyed footway width for
  // this segment and side, and the carriageway left over after both footways are taken out of
  // the recorded right of way. Every street used to be eight metres wide and every footway
  // 3.6, which made Grant Avenue and Van Ness the same street.
  // A San Francisco crosswalk band is about twelve feet, not seventeen. The extra width made
  // the bars sparse and the whole marking read as a couple of stripes.
  if (isUndergroundWay(way)) continue;
  // A path whose evidence names a material other than the footway concrete it was always drawn
  // in is laid in that material, run by run. Every other path keeps the pavement treatment --
  // kerb height, trimming at corners, crossing replacements -- exactly as before.
  if (isPath && pathHasOwnMaterial(way)) {
    deferredPaths.push({ lift: WAY_LIFT, draw: () => renderPedestrianPath(way) });
    continue;
  }
  const widthMeters = isCrossing ? (way.crossing_m || 3.7)
    : isSidewalk ? renderedWalkWidth(way, 3.6)
    : isPath ? 2.4
    : renderedRoadWidth(way);
  const renderPoints = densifyWay(way.points);
  if (centralDeck) addCentralFreewayDetails(way, renderPoints, widthMeters, centralDeck);
  // A road tunnel: its two mouths, and nothing at the surface between them.
  if (isRoadTunnel(way)) {
    const bore = addTunnel(way, renderPoints, widthMeters, ROAD_TOP_M);
    if (bore) groups.streets.add(bore);
    continue;
  }
 const surfacePoints = isCrossing ? crossingReachesIslands(crossingOverDividers(crossingRectanglePoints(renderPoints)), way.osm_id)
 : (isSidewalk || isPath) ? trimWalkwayForCorners(renderPoints, widthMeters) : renderPoints;
  // This kerb, not the city's median kerb. Four thousand nine hundred of these carry their own
  // measured height, spread from 60 to 445 mm; the fallback is the corridor median.
  // A measured kerb that is taller than any kerb is a measurement of something else -- a
  // planter wall, a step, a bank of ground the lidar's plane fit ran up. The record keeps its
  // number; the pavement is drawn no taller than a kerb can be, since at 445 mm a footway
  // read as a raised slab with a face you could sit on.
  const KERB = renderedKerbHeight(way);
  // Opaque, because these are surfaces rather than overlays. Once the kerb was built at its
  // measured 126 mm the old 0.62 made the footway a faint film on dark ground and it read as
  // missing -- the geometry was right and the material was still drawn like a diagram.
  const opacity = 1.0;
  // Heights are metres of actual street. They used to be chosen for legibility from above --
  // a footway was a 1.4 m slab floating 4.5 m up, and the measured-kerb band was a 5.5 m slab
  // three storeys in the air. Read from a bird's eye that was merely stylised; walked at street
  // level it made every footway taller than the person on it.
  const roadTop = ROAD_TOP_M;
  const surfaceY = isCrossing ? roadTop + 0.02
    : (isSidewalk || isPath) ? roadTop + KERB / 2 : roadTop / 2;
  const surfaceThickness = isCrossing ? 0.02 : (isSidewalk || isPath) ? KERB : roadTop;
 // A mapped sidewalk is the street's own walk, drawn as the kerbside walk is ("walk": its
 // concrete, its squares) however narrow it is mapped: as a narrow walk it lay over the kerbside
 // walk in another shade, a brown band along the shops on Chestnut (2026-11-21). A footpath
 // narrower than a walk is a narrow walk.
 const surfaceKind = isCrossing ? crossingMarkingKind(way)
  : isSidewalk ? "walk" : isPath ? (widthMeters <= NARROW_WALK_M ? "walk_narrow" : "walk") : "road";
  if (isCrossing && !shouldDrawCrossing(surfacePoints, widthMeters, surfaceKind ? null : "unmarked")) continue;
    // Continental unless we positively know otherwise. San Francisco has been converting its
    // marked crossings to ladders for years, and the inventory is demonstrably incomplete --
    // 598 of its points sit near no mapped crossing at all, which is the two datasets
    // disagreeing about where a crossing is rather than evidence that one is plain. The
  // ``continental`` flag still records the 817 the city confirms.
  if (isSidewalk || isPath) {
    addSidewalkCrossingReplacements(renderPoints, roadTop + 0.024);
    // walk_m is often inherited from the neighbouring street record, not a survey
    // of this mapped footway's position. Preserve that record, but fit *every*
    // placed ribbon to the measured carriageway; a valid width cannot justify
    // laying its inner edge over asphalt and hiding a crossing.
    // A footpath off the streets and their walks only (pathRunsOffStreets), once they are laid:
    // it ends at the pavement's edge, and the pavement carries on whole past it.
    const lay = (pieces) => {
      for (const piece of pieces) {
        if (!piece || piece.length < 2) continue;
        const fitted = walkWidthAgainstMeasuredKerbs(piece, widthMeters);
        addPavementRibbon(piece, fitted, color, opacity,
                          surfaceY, surfaceThickness,
                          fitted <= NARROW_WALK_M && !isSidewalk ? "walk_narrow" : surfaceKind, true);
      }
    };
    if (isPath) deferredPaths.push({ lift: WAY_LIFT,
      draw: () => lay(pathRunsOffStreets(way.points).map((run) => trimWalkwayForCorners(densifyWay(run), widthMeters))) });
    else lay([surfacePoints]);
  } else {
    // A crossing's paint is dense along its length -- a vertex every half metre -- because it
    // is settled onto the road as drawn afterwards (settleOnto), and it can only follow the
    // road's folds where it has vertices.
    const legs = isCrossing ? crossingPaintLegs(surfacePoints) : [surfacePoints];
    // The legs of one crossing share its run of bars (crossingLegPhases).
    const phases = isCrossing ? crossingLegPhases(legs, CROSSING_PAINT_END_TRIM_M) : [];
    const paintRuns = legs
      .map((run, k) => { const out = isCrossing ? densifyWay(trimWay(run, CROSSING_PAINT_END_TRIM_M), CROSSING_PAINT_STEP_M) : run; if (out && phases[k] != null) out.stripePhase = phases[k]; return out; })
      .filter((run) => run && run.length >= 2);
    if (!isCrossing || surfaceKind) {
      for (const paintRun of paintRuns) {
        // A divided half is as wide as the city's two kerbs say at each point along it.
        const widths = way._spans
          ? alongDistances(paintRun).map((along) => halfWidthAt(way, along) * 2) : widthMeters;
        addMerged(`ribbon:${surfaceKind}:${(Math.round(surfaceThickness / 0.05) * 0.05).toFixed(2)}`,
                  ribbon(paintRun, widths, color, opacity,
                         surfaceY, surfaceThickness, surfaceKind, paintRun.stripePhase ?? null), surfaceKind);
      }
    }
    if (isCrossing) {
      // The pads wait for the pavements and the corner pieces; see deferredTactilePads.
      deferredTactilePads.push({ points: surfacePoints, width: widthMeters, fallbackY: roadTop + KERB + 0.018 });
    }
  }
if (!isSidewalk && !isCrossing && !isPath) {
addBikeLaneMarkings(way, renderPoints, widthMeters, roadTop);
}
  // The footways, laid from the kerb outward on both sides. Drawn a centimetre below the
  // mapped sidewalk ways so that where OpenStreetMap has one the two do not fight, and so
  // that where it has none there is still pavement rather than a hole.
  if (!isSidewalk && !isCrossing && !isPath) {
    // Three metres was too narrow a fallback, and clamping the carriageways to the room they
    // have made it show: a narrower road leaves a wider strip between the kerb and the building
    // line, and a three metre footway no longer reached across it. San Francisco's minimum
    // sidewalk is ten feet and its commercial streets are commonly twelve to fifteen, so four
    // is both closer to the city and enough to meet the building.
    const walk = renderedWalkWidth(way, 4.0);
    const inner = widthMeters / 2;
    // Both sides unless one of them is inside another street's carriageway, which happens
    // wherever a divided road is drawn as two ways.
    // Both sides go to the frontage fill, drawn or not: where OpenStreetMap has no sidewalk on
    // a side but one is laid there anyway (a mapped footway, the next street's), the fill only
    // carries on what it finds at the kerb, so a side with nothing there gets nothing.
    for (const side of [1, -1]) frontageSides.push({ way, renderPoints, side, inner, walk, roadTop, color, opacity });
    for (const side of walkSidesToDraw(way, renderPoints, inner)) {
      addPropertyLinePavementUnderlay(renderPoints, side, inner, walk, color, opacity);
      addKerbsidePavement(renderPoints, side, inner, walk, color, opacity,
                          roadTop + KERB / 2 - KERBSIDE_BELOW_MAPPED_M, KERB, way);
    }
  }
  // A centreline belongs on a roadway, not on a footway: drawn on everything it read as a
  // white thread stitched over the whole city, and on a 3.6 m pavement it was simply wrong.
  // It does not belong on a crossing either -- a crosswalk has bars painted across it and no
  // line down its middle, and the bars are now real paint rather than a coloured slab.
  // A yellow centreline separates opposing traffic, so a one-way street does not have one.
  // Drawing it on every roadway put the marking on 784 segments of this corridor that do not
  // carry it -- and a yellow line specifically tells a driver there is traffic coming the
  // other way.
  // Lane dividers, from OpenStreetMap's own count. White and broken between lanes running the
  // same way; the yellow is reserved for the line that separates opposing traffic.
  if (!isSidewalk && !isCrossing && !isPath && !isUnmarkedService(way)) {
    const road = widthMeters;
    const [markCutStart, markCutEnd] = laneMarkingTrims(way, renderPoints, road);
    const markingPoints = trimWayEnds(renderPoints, markCutStart, markCutEnd);
    const markingRuns = markingRunsClearOfJunctions(markingPoints, way);
    // One profile, the same one the transitions and the trims read; this loop used to carry
    // its own copy of the lane arithmetic and the two could disagree.
    // The paints come from the one profile the transitions read too. White lane lines are
    // broken; the double yellow down the middle of the travel lanes is solid, which is what
    // San Francisco paints on a two-way street (a broken line means overtaking is allowed
    // and is the exception here). Both sit inside the travel lanes: with parking down one
    // side the yellow is off the road's middle, as it is in the street.
    if (markingPoints.length >= 2 && way.xs
        && (!(typeof KERB_RENDER_UNIFORM !== "undefined" && KERB_RENDER_UNIFORM)
            || crossSectionBandsNearMiddle(way, road / 2))) {
      // From the cross-sections: each boundary between bands is its own run, painted for
      // what the two bands are, and a station the solver could not close paints nothing.
      const apart = (MARK_W + DOUBLE_GAP_M) / 2;
      for (const mark of crossSectionMarks(way, markingPoints, markCutStart) || []) {
        for (const run of markingRunsClearOfJunctions(mark.points, way)) {
          if (mark.kind === "centre") {
            for (const side of [1, -1]) {
              const line = paintedLine(offsetWay(run, side * apart), MARK_W, 0xd8a92e, roadTop + 0.02);
              if (line) addMerged("marking:centre", line, "marking");
            }
          } else {
            const line = paintedLine(run, MARK_W, 0xdfe3e0, roadTop + 0.015, mark.kind === "lane" ? { dash: true } : {});
            if (line) addMerged(`marking:${mark.kind}`, line, "marking");
          }
        }
      }
    } else if (markingPoints.length >= 2) {
      for (const mark of laneMarkingPaints(laneMarkingProfile(way, road))) {
        for (const run of markingRuns) {
          const line = paintedLine(offsetWay(run, mark.offset), MARK_W, mark.color,
                                   roadTop + mark.y, mark.kind === "lane" ? { dash: true } : {});
          if (line) addMerged(`marking:${mark.kind}`, line, "marking");
        }
      }
    }
    // Half of a divided road (one-way, with its opposite-direction twin across a median): the
    // edge of its travel lanes on the median side is a solid yellow line -- the line that says
    // the traffic beyond runs the other way. Without it a divided street (Broadway in Oakland,
    // the Embarcadero) read as dashed white and nothing else, as if one-way.
    // Not beside an island the survey has in the gap: San Francisco paints no edge line along a
    // raised median's kerb (Fillmore north of Chestnut), and where the island stands off the
    // half, the line ran down the asphalt between them.
    if (way._twin === true && markingRuns.length) {
      const profile = laneMarkingProfile(way, road);
      const edge = (profile.left ?? road / 2) - MARK_W * 1.5;
      for (const run of markingRuns) {
        for (const piece of clearOfSurveyedIslands(offsetWay(run, edge), 9)) {
          const line = paintedLine(piece, MARK_W, 0xd8a92e, roadTop + 0.02);
          if (line) addMerged("marking:median-edge", line, "marking");
        }
      }
    }
    addLaneTransitionMarkings(way, renderPoints, road, roadTop);
  }
  // Turn arrows, at the end of the way -- which is where the junction is and where they are
  // painted. 224 ways in this corridor say which lane turns where.
  const turns = way.turn || way.turn_fwd;
  if (turns && way.road_m && !isSidewalk && !isCrossing) {
    const tokens = String(turns).split("|");
    const { offsets, laneWidth } = turnArrowLanes(way, widthMeters, tokens.length);
    for (let i = 0; i < tokens.length; i += 1) {
      const kind = arrowKind(tokens[i]);
      if (!kind) continue;
      // Clear the arrow from the junction before placing it. A fixed six-metre trim
      // could leave an isolated chevron in the middle of a broad intersection.
      const clearRuns = markingRunsClearOfJunctions(
        offsetWay(renderPoints, offsets[i]), way);
      const clearRun = clearRuns.length ? clearRuns[clearRuns.length - 1] : null;
      if (!clearRun || wayLength(clearRun) < 8.0) continue;
      const lane = trimWayEnds(clearRun, 0, 3.0);
      if (!lane || lane.length < 2) continue;
      const tail = lane[lane.length - 1];
      const before = lane[lane.length - 2];
      const [x1, y1] = xy(before[0], before[1]);
      const [x2, y2] = xy(tail[0], tail[1]);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(laneWidth * 0.6, 1.9), 2.6),
        new THREE.MeshStandardMaterial({
          map: arrowFor(kind), transparent: true, alphaTest: 0.35,
          roughness: 0.9, metalness: 0.02,
          polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10,
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = turnArrowSpin(x2 - x1, y2 - y1);
      mesh.position.set(x2, roadTop + 0.02, -y2);
      addMerged("arrow", mesh, "marking");
      const run = Math.hypot(x2 - x1, y2 - y1) || 1;
      paintedArrows.push({ x: x2, z: -y2, ux: (x2 - x1) / run, uz: -(y2 - y1) / run,
        along: 1.3, across: Math.min(laneWidth * 0.6, 1.9) / 2 });
    }
  }

  if (way.covered && (isCrossing || isSidewalk)) {
    // The measured kerb, marked. This sat at exactly the footway's own height and thickness --
    // two coplanar boxes occupying the same volume, which no depth buffer can order, so it
    // strobed pink against grey every frame. It now caps the kerb rather than sharing it.
    //
    // It is also survey data rather than street, so it belongs with the other layers that
    // describe the dataset and is off until asked for.
    groups.kerbs.add(ribbon(renderPoints, isCrossing ? 0.8 : 0.45, 0xff4d8f,
      0.95, roadTop + KERB + 0.03, 0.05));
  }
  // No street names floating over the roads: point at a street and press S.
}
WAY_LIFT = null;   // nothing built after the streets belongs to one way's cut
const regionBridges = addRegionBridgeStructures();
const transitIslands = addTransitIslands();
if (transitIslands.busways) console.info(`kerbside: ${transitIslands.busways} busway pieces, ${transitIslands.islands} island stations`);
if (regionBridges.decks) console.info(`kerbside: ${regionBridges.decks} bridge decks carried between their abutments, ${regionBridges.piers} piers`);
addCutWalls();

//: Where the roadway between the kerbs has been filled (medians, islands, asphalt), in half
//: metre cells, so nothing fills it twice.
const ROAD_FILL_CELL_M = 0.5;
const roadFillGrid = new Set();
//: The median of a divided road: the strip between the inner edges of its two halves, raised
//: a kerb's height. Narrower than this it is paint, not an island; wider it is a park.
const MEDIAN_MIN_M = 0.5;
const MEDIAN_MAX_M = 9.0;
//: The height of a median or an island is a kerb's: the same as the pavements either side,
//: so a mapped footway on a platform meets the island it stands on level rather than stepped.
const MEDIAN_KERB_M = 0.126;
const MEDIAN_STATION_M = 2.0;
//: The strip between the halves runs the whole way, end to end -- a way split at a driveway
//: node is followed by the next piece, and any margin here is a hole between them. The raised
//: median stops at the junction box; its nose is where the crossing is.
const MEDIAN_END_M = 0.0;
//: The dividers between a divided street's halves (addDividedMedians), as rings for
//: dividerPieces to lay with the islands: {ring: [[x, z]...], street}.
var TWIN_DIVIDER_RINGS = [];

//: How much of a divided street's gap, at a station, is parking rather than median: from this
//: half's inner edge (``near``) and from the twin's (``far``), in metres. A half parked on its
//: median side (the map, the meters or the census: parkingSidesAt) has a parking lane's width of
//: the gap that is road wherever that strip is not already carriageway; and a car park mapped in
//: the gap is road out to its far side. What is left is the median: Fillmore's angled parking,
//: Richardson's and the boulevards' median-side lanes were under a median the gap's full width.
const MEDIAN_PARKING_STEP_M = 0.25;
function medianParkingTrim(way, twin, along, side, ex, ez, nx, nz, edge) {
  const out = { near: 0, far: 0 };
  if (!(edge > 0)) return out;
  const at = (d) => [ex + nx * d, ez + nz * d];
  const road = (d) => { const [x, z] = at(d); return insideCarriageway(x, z, 0); };
  // A parking lane on this half's median side, where the half's own ribbon stops short of it.
  const sidesHere = typeof parkingSidesAt === "function" ? parkingSidesAt(way, along) : (way.parking_sides || []);
  if (sidesHere.includes(side) && !road(Math.min(edge, PARKING_LANE_M) * 0.5)) out.near = Math.min(edge, PARKING_LANE_M);
  // The twin's: its median side is the one facing this half.
  const twinSides = Array.isArray(twin?.parking_sides) ? twin.parking_sides : [];
  const twinMedian = Array.isArray(twin?.walk_sides) && twin.walk_sides.length === 1 ? -twin.walk_sides[0] : 0;
  if (twinMedian && twinSides.includes(twinMedian) && !road(edge - Math.min(edge, PARKING_LANE_M) * 0.5)) out.far = Math.min(edge - out.near, PARKING_LANE_M);
  // A car park in the gap: road from the edge it touches to its far side.
  if (typeof insideParkingRegion === "function") {
    let d = out.near;
    while (d + MEDIAN_PARKING_STEP_M <= edge - out.far && insideParkingRegion(...at(d + MEDIAN_PARKING_STEP_M / 2))) d += MEDIAN_PARKING_STEP_M;
    out.near = d;
    let e = out.far;
    while (edge - e - MEDIAN_PARKING_STEP_M >= out.near && insideParkingRegion(...at(edge - e - MEDIAN_PARKING_STEP_M / 2))) e += MEDIAN_PARKING_STEP_M;
    out.far = e;
  }
  return out;
}

function twinInnerEdgeAt(way, x, z, nx, nz) {
  // Along the ray from this half's inner edge across the median: the other half's edge.
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  let best = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half, , source] of bucket) {
        // The other half, or the piece of the same street it becomes for its last metres
        // into the junction, which OpenStreetMap often tags without the footway side.
        if (!source || source === way || source.name !== way.name) continue;
        if (!isDividedHalf(source) && onewaySign(source) === 0) continue;
        const sx = bx - ax, sz = bz - az;
        const segLength = Math.hypot(sx, sz) || 1;
        // Running alongside, not across.
        if (Math.abs((sx * -nz + sz * nx) / segLength) < 0.8) continue;
        const denominator = nx * sz - nz * sx;
        if (Math.abs(denominator) < 1e-6) continue;
        const qx = ax - x, qz = az - z;
        const alongRay = (qx * sz - qz * sx) / denominator;
        const alongSeg = (qx * nz - qz * nx) / denominator;
        if (alongSeg < -0.02 || alongSeg > 1.02) continue;
        const edge = alongRay - half;
        if (edge < 0 || edge > MEDIAN_MAX_M) continue;
        if (!best || edge < best.edge) best = { edge, twin: source };
      }
    }
  }
  return best;
}

//: A street crossing the strip here -- another street's carriageway, at an angle to it: where
//: one stretch of a median ends and the next begins (the junction), for medianKind. (At more
//: than 35 degrees to it; written in, as the medians are laid before a constant here is set.)
function medianCrossStreetAt(x, z, bearing, way) {
  const cx = Math.floor(x / CARRIAGEWAY_CELL), cz = Math.floor(z / CARRIAGEWAY_CELL);
  const limit = 35 * Math.PI / 180;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const [ax, az, bx, bz, half, other, source] of carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz)) || []) {
        if (!source || source === way || other === undefined || (way.name && source.name === way.name)) continue;
        let difference = Math.abs(other - bearing) % Math.PI;
        if (difference > Math.PI / 2) difference = Math.PI - difference;
        if (difference < limit) continue;
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < half * half) return true;
      }
    }
  }
  return false;
}
function addDividedMedians() {
  // Broadway east of Polk is two one-way ways, and once each was drawn at its own width from
  // its own kerb the ground between them showed: a dark strip down the middle of the street.
  // That strip is the median, and it is concrete at kerb height.
  let laid = 0;
  DATA.ways.forEach((way, i) => { way._i = i; });
  const positions = [];
  const uvs = [];
  const index = [];
  // A flat quad faces up whichever way round its corners come: the median is drawn from
  // whichever half has the lower index, and from the other half the corners run the other
  // way, which turned its normals down and lit the strip as a dark patch in the road.
  const facingUp = (a, b, c, d) => {
    let area = 0;
    for (const [pq, qr] of [[a, b], [b, c], [c, d], [d, a]]) area += pq[0] * qr[2] - qr[0] * pq[2];
    return area > 0 ? [a, b, c, d] : [a, d, c, b];
  };
  const quad = (a, b, c, d, flat = true) => {
    const base = positions.length / 3;
    const ring = flat ? facingUp(a, b, c, d) : [a, b, c, d];
    for (const [x, y, z] of ring) { positions.push(x, y, z); uvs.push(x / 4, z / 4); }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const road = { positions: [], uvs: [], index: [] };
  const roadQuad = (a, b, c, d) => {
    const base = road.positions.length / 3;
    for (const [x, y, z] of facingUp(a, b, c, d)) { road.positions.push(x, y, z); road.uvs.push(x / 8, z / 8); }
    road.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (const way of DATA.ways) {
    if (way.kind !== "street" || !isDividedHalf(way) || !way.points || way.points.length < 2) continue;
    const side = -way.walk_sides[0];                        // the median side
    const dense = densifyWay(way.points, MEDIAN_STATION_M);
    const length = wayLength(way.points);
    let along = 0;
    const top = ROAD_TOP_M + MEDIAN_KERB_M;
    const stations = [];
    for (let i = 0; i < dense.length; i += 1) {
      if (i > 0) {
        const [px, py] = xy(dense[i - 1][0], dense[i - 1][1]);
        const [x, y] = xy(dense[i][0], dense[i][1]);
        along += Math.hypot(x - px, y - py);
      }
      const inRange = along >= MEDIAN_END_M && along <= length - MEDIAN_END_M;
      const before = dense[Math.max(0, i - 1)];
      const after = dense[Math.min(dense.length - 1, i + 1)];
      const [bx, by] = xy(before[0], before[1]);
      const [ax, ay] = xy(after[0], after[1]);
      const dx = ax - bx, dz = by - ay;
      const span = Math.hypot(dx, dz) || 1;
      // The right normal in x/z; the median side is `side` times the left one.
      const rx = -dz / span, rz = dx / span;
      const nx = -side * rx, nz = -side * rz;
      const [hx, hy] = xy(dense[i][0], dense[i][1]);
      const halfHere = halfWidthAt(way, along);
      const ex = hx + nx * halfHere, ez = -hy + nz * halfHere; // this half's inner edge
      const found = inRange ? twinInnerEdgeAt(way, ex, ez, nx, nz) : null;
      // The ground between the halves is roadway first -- the median's nose stops short of
      // the crossing, and the box of the junction is asphalt between them -- and the raised
      // median stands on it, outside the junction box.
      // (Not where the survey has an island in the gap: that island is the median, drawn at its
      // own kerbs, and the rest of the gap is roadway.)
      const surveyed = Boolean(found) && surveyedIslandAcross(ex, ez, ex + nx * found.edge, ez + nz * found.edge);
      // The raised part is the gap less what is parked in it: a parking lane along either half's
      // median side, and a car park mapped in the gap (angled stalls along a median), are road,
      // not kerb (medianParkingTrim). The rest of the gap stays roadway.
      const trim = found ? medianParkingTrim(way, found.twin, along, side, ex, ez, nx, nz, found.edge) : null;
      const near0 = trim ? trim.near : 0, far0 = trim ? trim.far : 0;
      const kept = found ? found.edge - near0 - far0 : 0;
      const raised = found && kept >= MEDIAN_MIN_M && !surveyed
        && !insideJunctionBox(ex, ez) && !insideJunctionBox(ex + nx * 1.0, ez + nz * 1.0);
      if (found && (near0 || far0)) medianSurveyStats.parkedTrim = (medianSurveyStats.parkedTrim || 0) + 1;
      stations.push(found && found.edge >= 0.05
        ? { a: [ex + nx * near0, ez + nz * near0], b: [ex + nx * (found.edge - far0), ez + nz * (found.edge - far0)],
            twin: found.twin, raised, surveyed, nx, nz }
        : null);
    }
    // Two stations either side of a surveyed one are not raised either: an inferred piece
    // butting onto the survey's nose was the choppy start of the island.
    const nearSurveyed = stations.map((st, k) => stations.slice(Math.max(0, k - 2), k + 3).some((o) => o?.surveyed));
    stations.forEach((st, k) => { if (st && nearSurveyed[k]) { st.raised = false; medianSurveyStats.yielded += 1; } });
    // A station with no twin between two that have one -- where the other half is split into
    // a new way and the two pieces do not quite meet -- takes the strip its neighbours have.
    for (let i = 1; i + 1 < stations.length; i += 1) {
      if (stations[i] || !stations[i - 1]) continue;
      let j = i + 1;
      while (j < stations.length && !stations[j] && j - i < 3) j += 1;
      if (j >= stations.length || !stations[j]) continue;
      const from = stations[i - 1], to = stations[j];
      for (let m = i; m < j; m += 1) {
        const t = (m - (i - 1)) / (j - (i - 1));
        const lerp = (P, Q) => [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
        stations[m] = { a: lerp(from.a, to.a), b: lerp(from.b, to.b), twin: from.twin,
                        raised: from.raised && to.raised };
      }
    }
    // A divider (medianKind) is not raised here: each run of raised stations that is one is
    // handed on as a ring (TWIN_DIVIDER_RINGS), cut back short of its crosswalks with rounded
    // noses where the islands are laid (dividerPieces), unless an island there already has it.
    // Each stretch between crosswalks (or junction boxes) is judged on its own: Fillmore's twin
    // halves run unbroken from Chestnut to Marina, and judged as one strip, the thin islands
    // north of Bay made the 4.6 m refuge south of it a divider -- never raised, and the gap
    // paved over by the frontage fill in steps.
    for (let i = 0; i < stations.length;) {
      if (!stations[i]?.raised) { i += 1; continue; }
      let j = i;
      while (j + 1 < stations.length && stations[j + 1]?.raised) j += 1;
      const run = stations.slice(i, j + 1);
      const cut = run.map((st) => {
        const mx = (st.a[0] + st.b[0]) / 2, mz = (st.a[1] + st.b[1]) / 2;
        return insideJunctionBox(mx, mz) || crossingClearAt(mx, mz, 0.3, 0.3) !== null
          || medianCrossStreetAt(mx, mz, Math.atan2(st.a[0] - st.b[0], st.b[1] - st.a[1]), way);
      });
      const kindOf = new Array(run.length).fill(null);
      for (let p = 0; p < run.length;) {
        if (cut[p]) { p += 1; continue; }
        let q = p;
        while (q + 1 < run.length && !cut[q + 1]) q += 1;
        const piece = run.slice(p, q + 1);
        const widths = piece.map((st) => Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1])).sort((u, v) => u - v);
        const mid = piece[piece.length >> 1], mx = (mid.a[0] + mid.b[0]) / 2, mz = (mid.a[1] + mid.b[1]) / 2;
        const lower = way._i < mid.twin._i;
        if (piece.length >= 2) {
          const judged = medianKind({ width: widths[widths.length >> 1], length: (piece.length - 1) * MEDIAN_STATION_M, busStop: busStopOnMedian(mx, mz) });
          // (Counted once, from the half with the lower index, which draws it.)
          if (lower) countMedianKind(judged);
          for (let k = p; k <= q; k += 1) kindOf[k] = judged.kind;
          if (judged.kind === "divider" && lower) {
            TWIN_DIVIDER_RINGS.push({ ring: piece.map((st) => st.a).concat(piece.map((st) => st.b).reverse()), street: way.name || null });
          }
        }
        p = q + 1;
      }
      // A crosswalk's stations stay raised where the strip either side is a refuge (the walk
      // goes over it); between two dividers, or a divider and the strip's end, they are road.
      const near = (k, dir) => { for (let m = k + dir; m >= 0 && m < run.length; m += dir) if (!cut[m]) return kindOf[m]; return "divider"; };
      run.forEach((st, k) => {
        const kind = cut[k] ? (near(k, -1) === "refuge" || near(k, 1) === "refuge" ? "refuge" : "divider") : kindOf[k];
        if (kind === "divider") st.raised = false;
      });
      i = j + 1;
    }
    let previous = null;
    for (const station of stations) {
      // Each pair once: the half with the lower index draws it. Where the twin changes from
      // one piece to the next between two stations, the quad between them is drawn if either
      // piece is the higher, or the changeover is a hole.
      if (station && previous && (way._i < station.twin._i || way._i < previous.twin._i)) {
        const { a: pa, b: pb } = previous;
        const { a, b } = station;
        const under = ROAD_TOP_M - JUNCTION_BOX_DROP_M;
        roadQuad([pa[0], under, pa[1]], [a[0], under, a[1]], [b[0], under, b[1]], [pb[0], under, pb[1]]);
        stampFill(a[0], a[1], b[0], b[1]);
        stampFill(pa[0], pa[1], pb[0], pb[1]);
        if (station.raised && previous.raised) {
          quad([pa[0], top, pa[1]], [a[0], top, a[1]], [b[0], top, b[1]], [pb[0], top, pb[1]]);
          // The kerb faces, down to the road on both sides.
          quad([pa[0], ROAD_TOP_M, pa[1]], [pa[0], top, pa[1]], [a[0], top, a[1]], [a[0], ROAD_TOP_M, a[1]], false);
          quad([pb[0], top, pb[1]], [pb[0], ROAD_TOP_M, pb[1]], [b[0], ROAD_TOP_M, b[1]], [b[0], top, b[1]], false);
          laid += 1;
        }
      }
      previous = station;
    }
  }
  if (road.positions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(road.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(road.uvs, 2));
    geometry.setIndex(road.index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, surfaceMaterial("road", 0xffffff, 1.0));
    mesh.userData.surface = "road";
    addMerged("junction:box", mesh, "road");
  }
  if (!positions.length) return laid;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, surfaceMaterial("walk", 0xffffff, 1.0));
  mesh.userData.surface = "median";
  addMerged("median", mesh, "median");
  return laid;
}

// The corner pieces, once every pavement that meets at one is down; then the square at every
// corner of every junction, which completes the corners no way ends at (addJunctionSquares).
const cornersLaid = addPavementCorners();
const squaresLaid = addJunctionSquares();
if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame();   // between whole steps too (a hop's longest task)
const frontageFilled = await runStepsSliced(addFrontageFillSteps());
// The footpaths, each cut off the pavement as it now stands (a snapshot: not off one another).
PATH_CUT_GRID = new Map([...pavedSegmentGrid].map(([key, list]) => [key, list.slice()]));
for (const path of deferredPaths) {
  WAY_LIFT = path.lift;
  path.draw();
  if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame();
}
WAY_LIFT = null; PATH_CUT_GRID = null;
const pathsLaid = deferredPaths.splice(0).length;
//: The tactile pads at the crossings' ends, laid now that every pavement and corner piece is
//: down, each on top of the pavement it stands on. They used to be laid with the crossing at
//: the crossing's own kerb height, and a kerb height is measured per way: where the street's
//: kerb stood taller than the crossing's record, the corner piece stood over the pad and the
//: yellow showed through it as a sliver, or not at all. The pad's height is read from what was
//: laid under it (pavedGrid, the highest pavement top in the cells the pad covers); a pad at
//: an end with no pavement laid keeps the old height. Laid after the loop, they take the ground
//: grid's lift like the pavement, not the crossing's line.
let tactilePadsLaid = 0;
//: An end of a crossing out in the road -- two crossing ways joined mid-street, three meeting in
//: a junction with no island mapped -- has no kerb to step down from: nothing paved behind it,
//: carriageway all round. A pad there was a yellow square and a patch of pavement on the asphalt
//: (Lombard west, 2026-11-26); the bars just carry on.
function crossingEndInRoad(end, before) {
  const [ex, ey] = xy(end[0], end[1]);
  const [ix, iy] = xy(before[0], before[1]);
  const len = Math.hypot(ix - ex, iy - ey) || 1;
  const ux = (ex - ix) / len, uz = (-ey + iy) / len;
  for (const back of [0.3, 1.0, 1.8]) {
    for (const side of [-1, 0, 1]) {
      const x = ex + ux * back - uz * side * 1.2, z = -ey + uz * back + ux * side * 1.2;
      if (pavementTopAt(x, z) !== undefined) return false;
      if (!(insideCarriageway(x, z, 0) || insideJunctionBox(x, z))) return false;
    }
  }
  return true;
}
for (const pad of deferredTactilePads) {
  tactilePadsLaid += addCrossingTactilePads(pad.points, pad.width, (endpoint, into) => {
    const [ex, ey] = xy(endpoint[0], endpoint[1]);
    const [ix, iy] = xy(into[0], into[1]);
    const len = Math.hypot(ix - ex, iy - ey) || 1;
    const ux = (ex - ix) / len, uz = (-ey + iy) / len;     // out of the crossing, onto the pavement
    let top;
    for (const back of [0, 0.5, 1.0, 1.5]) {
      for (const side of [-1, 0, 1]) {
        const x = ex + ux * back - uz * side * pad.width * 0.4;
        const z = -ey + uz * back + ux * side * pad.width * 0.4;
        const here = pavementTopAt(x, z);
        if (here !== undefined && (top === undefined || here > top)) top = here;
      }
    }
    return top === undefined ? pad.fallbackY : top + 0.018;
  }, (end, before) => crossingEndOnDivider(end, before) !== null || crossingEndInRoad(end, before));
}
deferredTactilePads.length = 0;
const junctionBoxes = addJunctionBoxes();
const mediansLaid = addDividedMedians();

//: The plazas: paths mapped as closed areas of some size (a square's paving), as lon/lat rings.
function plazaRings() {
  if (plazaRings.found) return plazaRings.found;
  const out = [];
  for (const w of DATA.ways || []) {
    const pts = w.points;
    if (w.kind !== "path" || !pts || pts.length < 4) continue;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (Math.abs(a[0] - b[0]) > 1e-7 || Math.abs(a[1] - b[1]) > 1e-7) continue;
    let area = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const [ax, ay] = xy(...pts[i]), [bx, by] = xy(...pts[(i + 1) % pts.length]);
      area += ax * by - bx * ay;
    }
    if (Math.abs(area) / 2 < 600) continue;
    let w0 = Infinity, s0 = Infinity, e0 = -Infinity, n0 = -Infinity;
    for (const [lon, lat] of pts) { w0 = Math.min(w0, lon); e0 = Math.max(e0, lon); s0 = Math.min(s0, lat); n0 = Math.max(n0, lat); }
    out.push({ ring: pts, box: [w0, s0, e0, n0], way: w });
  }
  return (plazaRings.found = out);
}
//: Whether an open path lies across a plaza: most of its points inside one (not the plaza's own
//: outline).
function pathInsidePlaza(way) {
  const pts = way.points;
  if (!pts || pts.length < 2) return false;
  for (const p of plazaRings()) {
    if (p.way === way) return false;
    let inside = 0;
    for (const [lon, lat] of pts) {
      if (lon < p.box[0] || lon > p.box[2] || lat < p.box[1] || lat > p.box[3]) continue;
      let hit = false;
      for (let i = 0, j = p.ring.length - 1; i < p.ring.length; j = i++) {
        const [ax, ay] = p.ring[i], [bx, by] = p.ring[j];
        if ((ay > lat) !== (by > lat) && lon < (bx - ax) * (lat - ay) / (by - ay) + ax) hit = !hit;
      }
      if (hit) inside += 1;
    }
    if (inside >= Math.max(2, pts.length * 0.6)) return true;
  }
  return false;
}

//: The streets' centrelines in page metres, by 25 m cell, with their half-widths.
function streetSegmentGrid() {
  if (streetSegmentGrid.grid) return streetSegmentGrid.grid;
  const grid = new Map(), CELL = 25;
  for (const w of DATA.ways || []) {
    if (w.kind !== "street" || !w.points || w.points.length < 2 || w.bridge || w.tunnel) continue;
    const half = (w.road_m || (w.lanes || 2) * 3.3) / 2, walk = renderedWalkWidth(w), reach = Math.max(walk, w.walk_m || 0);
    const pts = w.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    for (let i = 1; i < pts.length; i += 1) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i], seg = { ax, az, bx, bz, half, walk, reach };
      for (let gx = Math.floor((Math.min(ax, bx) - half) / CELL); gx <= Math.floor((Math.max(ax, bx) + half) / CELL); gx += 1)
        for (let gz = Math.floor((Math.min(az, bz) - half) / CELL); gz <= Math.floor((Math.max(az, bz) + half) / CELL); gz += 1) {
          const k = `${gx}:${gz}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(seg);
        }
    }
  }
  return (streetSegmentGrid.grid = grid);
}
//: Whether a footpath runs along a street on that street's own kerbside walk: parallel to it,
//: and for most of its length with half or more of its width over the walk the street lays from
//: its kerb (``share`` of it). OpenStreetMap maps some pavements as plain footways
//: (Chestnut Street along Moscone); drawn as well, the footway lay on the street's walk at its
//: own kerb height, so a line of little kerb faces and a strip of another shade ran down the
//: middle of the pavement -- "a strip of road down the middle of the sidewalk" (2026-11-22).
//: The street's walk is that pavement already. (``share``: of the path's length; a parameter, not
//: a module constant, because the streets are laid before this file's constants are set.)
function pathAlongKerbsideWalk(way, width = 2.4, share = 0.75) {
  const pts = (way.points || []).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  if (pts.length < 2) return false;
  const grid = streetSegmentGrid();
  let along = 0, n = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0)) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len, steps = Math.max(1, Math.ceil(len / 1.5));
    for (let k = 0; k <= steps; k += 1) {
      const x = ax + (bx - ax) * k / steps, z = az + (bz - az) * k / steps;
      n += 1;
      for (const s of grid.get(`${Math.floor(x / 25)}:${Math.floor(z / 25)}`) || []) {
        const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz);
        if (!(L > 0) || Math.abs((dx * ux + dz * uz) / L) < 0.94) continue;
        const t = ((x - s.ax) * dx + (z - s.az) * dz) / (L * L);
        if (t < 0 || t > 1) continue;
        // Out from the kerb (the street's half-width), the path's centre; its width over the walk.
        const out = Math.abs((x - s.ax) * dz - (z - s.az) * dx) / L - s.half;
        const over = Math.min(out + width / 2, s.walk) - Math.max(out - width / 2, 0);
        if (over >= width / 2) { along += 1; break; }
      }
    }
  }
  return n > 0 && along >= n * share;
}
//: Whether (x, z) is on a street: its carriageway or the kerbside walk the street lays out to
//: its surveyed reach, round the ends of its segments as well as along them.
function onStreetOrItsWalk(x, z) {
  for (const s of streetSegmentGrid().get(`${Math.floor(x / 25)}:${Math.floor(z / 25)}`) || []) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L)) : 0;
    if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) < s.half + s.reach) return true;
  }
  return false;
}
//: Where a footpath stops: the roadway, the frontage paving, and once the streets are laid the
//: pavement they laid (PATH_CUT_GRID), or before that the street's own reach.
function pathCutAt(x, z) {
  if (insideCarriageway(x, z, 0)) return true;
  // The concrete between the walk and the property line is walk too (a park's frontage paving).
  if (parkPavementAt(x, z)) return true;
  return PATH_CUT_GRID ? pavementSurfaceAt(x, z, PATH_CUT_GRID) !== null : onStreetOrItsWalk(x, z);
}
//: A footpath's runs ([lon, lat] points) off the streets and their walks. A path that comes up to
//: a pavement ends at its edge: the pavement carries on whole and the path leads off it. Laid on
//: through, the path ran under the walk and showed through it as a dark tongue in the concrete
//: (Moscone, 2026-11-22). Each run is cut where it meets the walk's edge, to a few centimetres.
function pathRunsOffStreets(points, step = 0.5, shortest = 1.0) {
  const pts = (points || []).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  const runs = [];
  let run = [];
  const close = () => {
    let length = 0;
    for (let i = 1; i < run.length; i += 1) length += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    if (run.length >= 2 && length >= shortest) runs.push(run.map(([x, z]) => lonLatFromXZ(x, z)));
    run = [];
  };
  // Where the street begins between a point off it (a) and one on it (b), to 2 cm.
  const edge = (a, b) => {
    let lo = a, hi = b;
    for (let k = 0; k < 8; k += 1) {
      const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      if (pathCutAt(m[0], m[1])) hi = m; else lo = m;
    }
    return lo;
  };
  // The path's own corners, with samples between them to find where it meets a street.
  const samples = [];
  for (let i = 0; i < pts.length; i += 1) {
    if (!i) { samples.push(pts[0]); continue; }
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k += 1) samples.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  let prev = null, prevOn = false;
  for (const p of samples) {
    const on = pathCutAt(p[0], p[1]);
    if (prev && on !== prevOn) {
      if (on) { run.push(edge(prev, p)); close(); } else run.push(edge(p, prev));
    }
    if (!on) run.push(p);
    prev = p; prevOn = on;
  }
  close();
  return runs;
}
//: Whether a short path (under 40 m) lies half or more on a street's carriageway.
function pathMostlyOnRoad(way) {
  const pts = (way.points || []).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  let length = 0;
  for (let i = 1; i < pts.length; i += 1) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (!(length > 0) || length > 40) return false;
  const grid = streetSegmentGrid();
  let on = 0, n = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
    for (let k = 0; k <= steps; k += 1) {
      const x = ax + (bx - ax) * k / steps, z = az + (bz - az) * k / steps;
      n += 1;
      for (const s of grid.get(`${Math.floor(x / 25)}:${Math.floor(z / 25)}`) || []) {
        const dx = s.bx - s.ax, dz = s.bz - s.az, L = dx * dx + dz * dz;
        const t = L ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L)) : 0;
        if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) < s.half - 0.5) { on += 1; break; }
      }
    }
  }
  return on >= n * 0.5;
}

//: The turn of a lane arrow's plane (rotation.z, after its rotation.x of -PI/2) so that its head
//: points along (dx, dy) -- the way's direction in the page's x and y (y north, z = -y). The
//: plane's +y (the arrow's head) lands on the ground as -z, its +x as +x: so the turn is the
//: angle from +y to (dx, dy). It was -atan2(dx, -dy), which is right east and west and points
//: every arrow on a north-south street backwards, turn hooks mirrored (2026-11-25).
function turnArrowSpin(dx, dy) {
  return Math.atan2(-dx, dy);
}
//: Where the arrows for ``count`` turn:lanes tokens go across ``way`` (offsets left of its line)
//: and how wide each lane is. A one-way street's tokens span its travel lanes. A two-way
//: street's (turn:lanes:forward, or turn:lanes on it) are its forward lanes only, the right-hand
//: ones: spread over the whole road they put Bay Street's three forward arrows across all five
//: lanes, two in the oncoming traffic's.
function turnArrowLanes(way, roadWidth, count) {
  // The lanes the way's cross-section has where the arrows are, near its end: each arrow in the
  // middle of its own lane, measured, not the street's middle section shared out evenly.
  const rows = way && way.xs;
  if (rows && rows.length && count >= 1 && typeof crossSectionBands === "function") {
    const along = Math.max(0, rows[rows.length - 1][0] - 4);
    const half = typeof halfWidthAt === "function" ? halfWidthAt(way, along) : roadWidth / 2;
    const bands = crossSectionBands(way, along, half);
    const oneway1 = typeof onewaySign === "function" ? onewaySign(way) !== 0 : Boolean(way.oneway);
    const lanes = bands ? bands.filter((b) => (b.kind === "travel" || b.kind === "turn")
      && (oneway1 || (b.dir ? b.dir === 1 : (b.left + b.right) / 2 < 0))) : [];
    if (lanes.length === count) {
      return { offsets: lanes.map((b) => (b.left + b.right) / 2),
        laneWidth: lanes.reduce((sum, b) => sum + (b.left - b.right), 0) / count, measured: true };
    }
  }
  const [left, right] = travelSpan(way, roadWidth);
  const oneway = typeof onewaySign === "function" ? onewaySign(way) !== 0 : Boolean(way.oneway);
  const total = Number(way.lanes) || 0, forward = Number(way.lanes_fwd) || 0;
  if (oneway || count < 1) return { offsets: laneOffsets(roadWidth, count, way), laneWidth: (left - right) / Math.max(1, count) };
  let laneWidth;
  if (total > count && (!forward || forward === count)) laneWidth = (left - right) / total;
  else if (forward && total > forward) laneWidth = (left - right) / total;
  else laneWidth = (left - right) / 2 / count;
  const offsets = [];
  for (let i = 0; i < count; i += 1) offsets.push(right + (count - i - 0.5) * laneWidth);
  return { offsets, laneWidth };
}
