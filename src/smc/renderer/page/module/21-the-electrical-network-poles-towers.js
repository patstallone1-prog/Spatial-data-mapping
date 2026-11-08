// ---- the electrical network: poles, towers, masts and the wires between them ----
//
// Poles, transmission towers and power lines come from OpenStreetMap; so do the cell and
// broadcast masts. Only an explicitly mapped overhead line supplies connectivity.
// Nearby poles (including photograph detections) are NOT evidence of a span: court lights
// and park poles otherwise acquire imaginary conductors across playing surfaces.
//
// A conductor hangs as a catenary, y = a cosh(x / a), where a is its horizontal tension over
// its weight per metre. One realistic starting point sets it: a forty-metre distribution span
// sags about a metre (2.5 per cent), which is a = 40^2 / (8 x 1.0) = 200 m. Holding the tension
// fixed, the sag then grows with the square of the span -- 0.4 m over 25 m, 2.3 m over 60 m --
// which is how a real line hangs, and spans between points at different heights are solved
// as the true asymmetric catenary through both.
const WIRE_CATENARY_A_M = 200;
const WIRE_SAMPLES = 14;
const POLE_DEFAULT_M = 10.5;
//: A small cell's own pole: a street light's height.
const SMALL_CELL_POLE_M = 8.5;
const TOWER_DEFAULT_M = 32;
//: A mapped line turning more than this at a point turns on a pole there.
const POWER_BEND_DEG = 15;
const MAST_DEFAULT_M = 30;
function ringCentroid(ring) {
  let sx = 0, sy = 0;
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i += 1) { sx += ring[i][0]; sy += ring[i][1]; }
  return [sx / Math.max(1, n), sy / Math.max(1, n)];
}
//: Where a floodlight mapped at (x, z) stands, and what it is aimed at: outside any court pad it
//: is on, just past the nearest edge; aimed at the nearest pad's middle within thirty metres.
function courtLightSpot(x, z, pads = COURT_PADS) {
  let spot = { x, z }, aim = null, best = 30;
  for (const pad of pads) {
    if (pointInRing(x, z, pad.local)) {
      let q = null, d = Infinity, normal = null;
      for (let i = 0; i + 1 < pad.local.length; i += 1) {
        const [ax, az] = pad.local[i], [bx, bz] = pad.local[i + 1];
        const L2 = (bx - ax) ** 2 + (bz - az) ** 2;
        if (!L2) continue;
        const s = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2));
        const px = ax + (bx - ax) * s, pz = az + (bz - az) * s, dd = Math.hypot(x - px, z - pz);
        if (dd < d) { d = dd; q = [px, pz]; const L = Math.sqrt(L2); normal = [(bz - az) / L, -(bx - ax) / L]; }
      }
      if (q) {
        let out = [q[0] + normal[0] * COURT_LIGHT_OUT_M, q[1] + normal[1] * COURT_LIGHT_OUT_M];
        if (pointInRing(out[0], out[1], pad.local)) out = [q[0] - normal[0] * COURT_LIGHT_OUT_M, q[1] - normal[1] * COURT_LIGHT_OUT_M];
        spot = { x: out[0], z: out[1] };
      }
      return { ...spot, aim: [pad.cx, pad.cz] };
    }
    const reach = Math.hypot(x - pad.cx, z - pad.cz);
    if (reach < best + 40) {
      for (let i = 0; i + 1 < pad.local.length; i += 1) {
        const d = Math.sqrt(distanceToSegmentSquared(x, z, ...pad.local[i], ...pad.local[i + 1]));
        if (d < best) { best = d; aim = [pad.cx, pad.cz]; }
      }
    }
  }
  return { ...spot, aim };
}
function seatCourtLights() {
  if (!courtLights) return;
  const { rows, pole, lamps } = courtLights;
  const dummy = new THREE.Object3D();
  rows.forEach((row, index) => {
    const spot = courtLightSpot(row.anchor.x, row.anchor.z);
    const H = Math.max(6, Math.min(40, parseFloat(row.item.height_m) || FLOODLIGHT_DEFAULT_M));
    const baseY = groundLiftAt(spot.x, spot.z);
    dummy.position.set(spot.x, baseY + H / 2, spot.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, H, 1);
    dummy.updateMatrix();
    pole.setMatrixAt(index, dummy.matrix);
    const yaw = spot.aim ? Math.atan2(spot.aim[0] - spot.x, spot.aim[1] - spot.z) : (row.item.bearing || 0) * Math.PI / 180;
    for (let k = 0; k < 4; k += 1) {
      const across = (k % 2 ? 0.32 : -0.32), up = (k < 2 ? 0.25 : -0.25);
      dummy.position.set(spot.x + Math.sin(yaw) * 0.35 + Math.cos(yaw) * across, baseY + H + up,
        spot.z + Math.cos(yaw) * 0.35 - Math.sin(yaw) * across);
      dummy.rotation.set(0, 0, 0);
      dummy.rotateY(yaw);
      dummy.rotateX(0.35);   // tilted down at the court
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lamps.setMatrixAt(index * 4 + k, dummy.matrix);
    }
  });
  pole.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  pole.computeBoundingSphere(); lamps.computeBoundingSphere();
}

function catenaryPoints(a, b, out, parameter = WIRE_CATENARY_A_M) {
  // Points of the conductor from a to b ({x, y, z}), as line-segment pairs pushed onto out.
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < 0.5) return;
  const h = b.y - a.y;
  const A = parameter;
  // The lowest point's offset along the span, for ends at different heights.
  const x0 = L / 2 - A * Math.asinh(h / (2 * A * Math.sinh(L / (2 * A))));
  const c = a.y - A * Math.cosh((0 - x0) / A);
  let prev = null;
  for (let i = 0; i <= WIRE_SAMPLES; i += 1) {
    const s = (i / WIRE_SAMPLES) * L;
    const p = [a.x + (b.x - a.x) * (s / L), A * Math.cosh((s - x0) / A) + c, a.z + (b.z - a.z) * (s / L)];
    if (prev) out.push(...prev, ...p);
    prev = p;
  }
}

function electricalAnchor(item) {
  const anchor = furnitureAnchor(item);
  if (anchor) return anchor;
  if (!item || !item.p) return null;
  const [x, y] = xy(item.p[0], item.p[1]);
  return { x, z: -y, y: groundLiftAt(x, -y) + ROAD_TOP_M };
}

function mappedOverheadLine(line) {
  return line && line.source === "openstreetmap"
    && line.geometry_basis === "osm_overhead_line_way"
    && /^osm:power_line:way:\d+$/.test(String(line.id))
    && ["line", "minor_line"].includes(line.power_kind)
    && !["underground", "submarine", "indoor"].includes(line.location)
    && Array.isArray(line.points) && line.points.length >= 2
    && line.points.every((p) => Array.isArray(p) && p.length >= 2
      && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function addElectricalNetwork(furniture, lightRows = []) {
  const inferred = furniture.inferred || {};
  // OpenStreetMap's poles and the ones Mapillary placed from its photographs (ingest_kerb_assets:
  // none within 7 m of a mapped one), one network.
  // A pole in the way from a kerb cut to its garage stands to the side of the driveway instead.
  const poleRows = (inferred.utility_poles || []).concat(inferred.detected_utility_poles || [])
    .map((item) => ({ item, anchor: furnitureAnchor(item) }))
    .filter((row) => row.anchor);
  for (const row of poleRows) {
    const clear = clearOfDriveway(row.anchor.x, row.anchor.z);
    if (!clear) continue;
    const top = pavementTopAt(clear.x, clear.z);
    row.anchor = { x: clear.x, z: clear.z,
      y: (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(clear.x, clear.z) };
    row.movedOutOfDriveway = true;
  }
  poleRows.forEach((row) => {
    row.height = Math.max(7, Math.min(16, parseFloat(row.item.height_m) || POLE_DEFAULT_M));
    row.yaw = furnitureBearing(row.item, 0, row.anchor);
  });
  // A pole that carries a reconstructed span turns its crossarm square to the line.
  const spans = electricalSpans();
  const poleById = new Map(poleRows.map((row) => [String(row.item.id), row]));
  for (const span of spans) {
    for (const id of [span.a, span.b]) {
      const row = poleById.get(String(id));
      if (!row || row.spanYaw !== undefined) continue;
      const [ax, ay] = xy(span.pa[0], span.pa[1]), [bx, by] = xy(span.pb[0], span.pb[1]);
      const dx = bx - ax, dz = -(by - ay), d = Math.hypot(dx, dz) || 1;
      const rx = -dz / d, rz = dx / d;
      row.spanYaw = Math.atan2(-rz, rx);
      row.yaw = row.spanYaw;
    }
  }
  const lines = (inferred.power_lines || []).filter(mappedOverheadLine).map((line) => ({ line,
    path: (line.points || []).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return { x, z: -y }; }) }));
  // A conductor cannot turn in the air: where a mapped line bends, something holds it. Where no
  // pole is mapped or photographed at a bend, one stands there, marked inferred; where none can
  // stand (a roof, a carriageway), the spans either side of the bend are not drawn.
  const unsupportedBends = new Set();
  for (const { line, path } of lines) {
    if (line.power_kind === "line") continue;  // towers: spans need mapped supports at both ends
    for (let i = 1; i < path.length - 1; i += 1) {
      const a = path[i - 1], b = path[i], c = path[i + 1];
      const l0 = Math.hypot(b.x - a.x, b.z - a.z), l1 = Math.hypot(c.x - b.x, c.z - b.z);
      if (l0 < 1 || l1 < 1) continue;
      const cos = ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) / (l0 * l1);
      if (cos > Math.cos(POWER_BEND_DEG * Math.PI / 180)) continue;
      if (poleRows.some((row) => Math.hypot(row.anchor.x - b.x, row.anchor.z - b.z) < 4)) continue;
      if (buildingAt(b.x, b.z) || insideCarriageway(b.x, b.z, 0.05)) { unsupportedBends.add(`${line.id}:${i}`); continue; }
      const top = pavementTopAt(b.x, b.z);
      poleRows.push({ item: { id: `inferred:line_bend_pole:${line.id}:${i}`, inferred: true,
        basis: "mapped overhead line turns here; no pole mapped or photographed" },
        anchor: { x: b.x, z: b.z, y: (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(b.x, b.z) },
        height: POLE_DEFAULT_M, yaw: Math.atan2(-(c.x - a.x), -(c.z - a.z)), inferredAtBend: true });
    }
  }
  // Poles.
  const dummy = new THREE.Object3D();
  if (poleRows.length) {
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.16, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0x5f4d3f, roughness: 0.95 }), poleRows.length);
    const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x4d4237, roughness: 0.9 }), poleRows.length * 2);
    const insulators = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0x8a9a8f, roughness: 0.4 }), poleRows.length * 3);
    poleRows.forEach((row, index) => {
      const { anchor, height, yaw } = row;
      dummy.position.set(anchor.x, anchor.y + height / 2, anchor.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      pole.setMatrixAt(index, dummy.matrix);
      // Primary crossarm near the top; a short secondary arm lower down for the service drop.
      [[height - 0.9, 2.4], [height - 3.2, 1.2]].forEach(([h, w], k) => {
        dummy.position.set(anchor.x, anchor.y + h, anchor.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(w, 0.11, 0.11);
        dummy.updateMatrix();
        arm.setMatrixAt(index * 2 + k, dummy.matrix);
      });
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      [-1.05, 0, 1.05].forEach((off, k) => {
        dummy.position.set(anchor.x + rx * off, anchor.y + height - 0.9 + 0.14, anchor.z + rz * off);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 0.22, 1);
        dummy.updateMatrix();
        insulators.setMatrixAt(index * 3 + k, dummy.matrix);
      });
    });
    for (const mesh of [pole, arm, insulators]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData = { surface: "furniture:utility_pole", source: "openstreetmap+mapillary_map_features" };
      groups.furniture.add(mesh);
    }
  }
  // Transmission towers: four battered legs, cross-bracing levels and two arms.
  const towerRows = (inferred.power_towers || []).map((item) => ({ item, anchor: electricalAnchor(item) }))
    .filter((row) => row.anchor);
  if (towerRows.length) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e9496, roughness: 0.55, metalness: 0.6 });
    const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, towerRows.length * 4);
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, towerRows.length * 6);
    towerRows.forEach((row, index) => {
      const H = Math.max(18, Math.min(60, parseFloat(row.item.height_m) || TOWER_DEFAULT_M));
      row.height = H;
      const base = 3.2, top = 0.9;
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz], k) => {
        const bx = sx * base, bz = sz * base, tx = sx * top, tz = sz * top;
        const len = Math.hypot(H, bx - tx, bz - tz);
        dummy.position.set(row.anchor.x + (bx + tx) / 2, row.anchor.y + H / 2, row.anchor.z + (bz + tz) / 2);
        dummy.lookAt(row.anchor.x + tx, row.anchor.y + H, row.anchor.z + tz);
        dummy.rotateX(Math.PI / 2);
        dummy.scale.set(0.16, len, 0.16);
        dummy.updateMatrix();
        legs.setMatrixAt(index * 4 + k, dummy.matrix);
      });
      const yaw = furnitureBearing(row.item, 0, row.anchor);
      [[0.35, 2.2 * 2], [0.6, 1.6 * 2], [0.8, 1.2 * 2], [0.86, 9], [0.94, 6.5], [0.99, 1.5]].forEach(([f, w], k) => {
        dummy.position.set(row.anchor.x, row.anchor.y + H * f, row.anchor.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(w, 0.18, 0.18);
        dummy.updateMatrix();
        bars.setMatrixAt(index * 6 + k, dummy.matrix);
      });
    });
    for (const mesh of [legs, bars]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData = { surface: "furniture:power_tower", source: "openstreetmap" };
      groups.furniture.add(mesh);
    }
  }
  // Cell and broadcast masts: a tapering monopole with three sectors of panel antennas.
  const lighting = (item) => item?.tags?.["tower:type"] === "lighting";
  const floodRows = (inferred.comm_towers || []).filter(lighting).map((item) => ({ item, anchor: electricalAnchor(item) }))
    .filter((row) => row.anchor);
  if (floodRows.length) {
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x8e9496, roughness: 0.45, metalness: 0.6 }), floodRows.length);
    const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.42, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x4a4f53, emissive: 0x2a2a24, roughness: 0.5, metalness: 0.4 }), floodRows.length * 4);
    courtLights = { rows: floodRows, pole, lamps };
    seatCourtLights();
    for (const mesh of [pole, lamps]) {
      mesh.userData = { surface: "furniture:floodlight", source: "openstreetmap" };
      groups.furniture.add(mesh);
    }
  }
  const mastRows = (inferred.comm_towers || []).filter((item) => !lighting(item))
    .map((item) => ({ item, anchor: electricalAnchor(item) })).filter((row) => row.anchor);
  if (mastRows.length) {
    const mast = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.6, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.5, metalness: 0.55 }), mastRows.length);
    const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 1.6, 0.14),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e3, roughness: 0.6 }), mastRows.length * 9);
    mastRows.forEach((row, index) => {
      // A mast on a roof stands on the roof: shorter, and from the roof up.
      const roof = buildingAt(row.anchor.x, row.anchor.z);
      const H = Math.max(6, Math.min(80, parseFloat(row.item.height_m) || (roof ? 6 : MAST_DEFAULT_M)));
      const baseY = roof ? row.anchor.y + (roof.height_m || 0) : row.anchor.y;
      dummy.position.set(row.anchor.x, baseY + H / 2, row.anchor.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(roof ? 0.4 : 1, H, roof ? 0.4 : 1);
      dummy.updateMatrix();
      mast.setMatrixAt(index, dummy.matrix);
      for (let sector = 0; sector < 3; sector += 1) {
        for (let k = 0; k < 3; k += 1) {
          const yaw = sector * (2 * Math.PI / 3) + (k - 1) * 0.35;
          const r = 0.75;
          dummy.position.set(row.anchor.x + Math.sin(yaw) * r, baseY + H - 1.2, row.anchor.z + Math.cos(yaw) * r);
          dummy.rotation.set(0, yaw, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          panels.setMatrixAt(index * 9 + sector * 3 + k, dummy.matrix);
        }
      }
    });
    for (const mesh of [mast, panels]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData = { surface: "furniture:comm_tower", source: "openstreetmap" };
      groups.furniture.add(mesh);
    }
  }
  // Small cells: the carriers' antennas on the city's poles (Public Works' permits). San
  // Francisco's are on its streetlights: on the top of the nearest arm or pendant light's pole
  // within a few metres, else of a utility pole; only where neither stands, on a slim pole of
  // their own at a streetlight's height. A canister at the top, the radio box lower down.
  const hostPoles = lightRows.filter((row) => row.form === "mast_arm" || row.form === "pendant");
  const cellRows = ((furniture.geometry_based || {}).small_cells || [])
    .map((item) => ({ item, anchor: furnitureAnchor(item) })).filter((row) => row.anchor);
  if (cellRows.length) {
    const grey = new THREE.MeshStandardMaterial({ color: 0x8d9396, roughness: 0.55, metalness: 0.4 });
    const canisters = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.17, 1.3, 12), grey, cellRows.length);
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.75, 0.3), grey, cellRows.length);
    const ownPoles = [];
    cellRows.forEach((row, index) => {
      let host = null;
      for (const poles of [hostPoles, poleRows]) {
        for (const pole of poles) {
          const d = Math.hypot(pole.anchor.x - row.anchor.x, pole.anchor.z - row.anchor.z);
          if (d < 5 && (!host || d < host.d)) host = { d, pole };
        }
        if (host) break;
      }
      const at = host ? host.pole.anchor : row.anchor;
      const top = host ? host.pole.height : SMALL_CELL_POLE_M;
      if (!host) ownPoles.push(at);
      dummy.position.set(at.x, at.y + top + 0.65, at.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      canisters.setMatrixAt(index, dummy.matrix);
      const yaw = furnitureBearing(row.item, 0, at);
      dummy.position.set(at.x + Math.sin(yaw) * 0.26, at.y + 3.0, at.z + Math.cos(yaw) * 0.26);
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      boxes.setMatrixAt(index, dummy.matrix);
    });
    const meshes = [canisters, boxes];
    if (ownPoles.length) {
      const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 1, 8), grey, ownPoles.length);
      ownPoles.forEach((at, index) => {
        dummy.position.set(at.x, at.y + SMALL_CELL_POLE_M / 2, at.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, SMALL_CELL_POLE_M, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(index, dummy.matrix);
      });
      meshes.push(poles);
    }
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData = { surface: "furniture:small_cell", source: "sfdpw_wireless_permits" };
      groups.furniture.add(mesh);
    }
  }
  // The conductors.
  const mapped = [];
  const supportsNear = (x, z) => {
    let best = null;
    for (const row of poleRows.concat(towerRows)) {
      const d = Math.hypot(row.anchor.x - x, row.anchor.z - z);
      if (d < 4 && (!best || d < best.d)) best = { d, row };
    }
    return best && best.row;
  };
  let mappedSpans = 0;
  for (const { line, path } of lines) {
    const tower = line.power_kind === "line";
    const offsets = tower ? [-3.6, 0, 3.6] : [-1.05, 0, 1.05];
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1], b = path[i];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 1 || d > (tower ? 450 : 90)) continue;
      if (unsupportedBends.has(`${line.id}:${i - 1}`) || unsupportedBends.has(`${line.id}:${i}`)) continue;
      const sa = supportsNear(a.x, a.z), sb = supportsNear(b.x, b.z);
      // A transmission line is strung only between supports that are mapped: its height is
      // the tower's, and guessed at both ends it flew across the city at roof height. An
      // unsupported distribution span is kept short enough to be a span at all.
      if (tower && !(sa && sb)) continue;
      if (!tower && !(sa && sb) && d > 60) continue;
      const ground = (p) => (pavementTopAt(p.x, p.z) ?? ROAD_TOP_M) + groundLiftAt(p.x, p.z);
      const ya = sa ? sa.anchor.y + (sa.height || POLE_DEFAULT_M) - (tower ? 0.14 * sa.height : 0.76) : ground(a) + (tower ? 27 : 9.6);
      const yb = sb ? sb.anchor.y + (sb.height || POLE_DEFAULT_M) - (tower ? 0.14 * sb.height : 0.76) : ground(b) + (tower ? 27 : 9.6);
      const rx = -(b.z - a.z) / d, rz = (b.x - a.x) / d;
      for (const off of offsets) {
        catenaryPoints({ x: a.x + rx * off, y: ya, z: a.z + rz * off },
          { x: b.x + rx * off, y: yb, z: b.z + rz * off }, mapped, tower ? 900 : WIRE_CATENARY_A_M);
      }
      mappedSpans += 1;
    }
  }
  // Reconstructed spans: PG&E's route says which poles are consecutive on a line; a photograph
  // showed the conductor. Phase count sets how many primaries hang from the crossarm, with the
  // neutral/secondary lower down; a span the photographs showed only at the communications
  // height is one cable there.
  const grip = [];
  let gripSpans = 0, telecomSpans = 0;
  for (const span of spans) {
    if (span.osm) continue;   // OpenStreetMap's own line already drew it
    const ra = poleById.get(String(span.a)), rb = poleById.get(String(span.b));
    const ea = ra ? ra.anchor : electricalAnchor({ p: span.pa }), eb = rb ? rb.anchor : electricalAnchor({ p: span.pb });
    if (!ea || !eb) continue;
    const d = Math.hypot(eb.x - ea.x, eb.z - ea.z);
    if (d < 4 || d > 100) continue;
    const ha = ra ? ra.height : POLE_DEFAULT_M, hb = rb ? rb.height : POLE_DEFAULT_M;
    const rx = -(eb.z - ea.z) / d, rz = (eb.x - ea.x) / d;
    if (span.type === "telecom") {
      catenaryPoints({ x: ea.x, y: ea.y + Math.min(6.2, ha - 3.8), z: ea.z },
        { x: eb.x, y: eb.y + Math.min(6.2, hb - 3.8), z: eb.z }, grip, 150);
      telecomSpans += 1;
      continue;
    }
    // The phase count is PG&E's attribute and ships only with its leave; without it one
    // primary is hung (and the neutral below), not an invented three-phase crossarm.
    const phases = Math.max(1, Math.min(3, Number(span.phases) || 1));
    const offsets = phases === 3 ? [-1.05, 0, 1.05] : phases === 2 ? [-1.05, 1.05] : [0.5];
    for (const off of offsets) {
      catenaryPoints({ x: ea.x + rx * off, y: ea.y + ha - 0.76, z: ea.z + rz * off },
        { x: eb.x + rx * off, y: eb.y + hb - 0.76, z: eb.z + rz * off }, grip);
    }
    catenaryPoints({ x: ea.x + rx * 0.45, y: ea.y + ha - 3.06, z: ea.z + rz * 0.45 },
      { x: eb.x + rx * 0.45, y: eb.y + hb - 3.06, z: eb.z + rz * 0.45 }, grip);
    gripSpans += 1;
  }
  const wireMaterial = new THREE.LineBasicMaterial({ color: 0x2c302f, opacity: 0.9, transparent: true });
  for (const [points, basis] of [[mapped, "osm_mapped_line"], [grip, "pge_route_poles_photo_confirmed"]]) {
    if (!points.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const wires = new THREE.LineSegments(geometry, wireMaterial);
    wires.userData = { surface: "furniture:overhead_wire", basis, sag: "catenary_a200m_inferred" };
    groups.furniture.add(wires);
  }
  return { utility_poles: poleRows.length, power_towers: towerRows.length, comm_towers: mastRows.length, floodlights: floodRows.length,
    small_cells: cellRows.length, mapped_wire_spans: mappedSpans, inferred_wire_spans: 0,
    reconstructed_spans: gripSpans, telecom_spans: telecomSpans };
}

//: The reconstructed spans for this world, only if the sidecar is the expected schema.
function electricalSpans() {
  if (ELECTRICAL_SPANS?.schema !== "kerbside.electrical_spans/1") return [];
  return (ELECTRICAL_SPANS.spans || []).filter((span) => Array.isArray(span.pa) && Array.isArray(span.pb)
    && ["electrical", "telecom"].includes(span.type) && span.c >= 0.85);
}

function addBikeRacks(anchors) {
  // An inverted U: two legs and a bar, 0.8 m high and 0.6 m wide, square to the kerb.
  if (!anchors.length) return 0;
  const legs = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.022, 0.022, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x2b2f31, roughness: 0.5, metalness: 0.6 }),
    anchors.length * 3);
  const dummy = new THREE.Object3D();
  anchors.forEach((a, i) => {
    const kerb = nearestKerbAt(a.x, a.z);
    const yaw = kerb ? Math.atan2(-kerb.nx, -kerb.nz) : 0;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (const [k, side] of [[0, -0.3], [1, 0.3]]) {
      dummy.position.set(a.x + rx * side, a.y + 0.4, a.z + rz * side);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 0.8, 1);
      dummy.updateMatrix();
      legs.setMatrixAt(i * 3 + k, dummy.matrix);
    }
    dummy.position.set(a.x, a.y + 0.8, a.z);
    dummy.rotation.set(0, yaw, Math.PI / 2);
    dummy.scale.set(1, 0.6, 1);
    dummy.updateMatrix();
    legs.setMatrixAt(i * 3 + 2, dummy.matrix);
  });
  legs.instanceMatrix.needsUpdate = true;
  legs.userData.surface = "furniture:bike_rack";
  groups.furniture.add(legs);
  return anchors.length;
}

function curbZoneColor(record) {
  const colors = {
    red: 0xd92d2d,
    yellow: 0xe3ba22,
    white: 0xf4f1e7,
    green: 0x24945a,
    blue: 0x2878d8,
  };
  return colors[record.curb_color] || null;
}

//: How far from a snapped policy line a kerb vertex may sit and still take its paint. The lip
//: is four inches wide and the snap lands on its street edge, so this only needs to reach across
//: the lip and absorb the snap's own error.
const KERB_PAINT_REACH_M = 0.45;

//: A Color Curb Program asset is a point and a length in feet: the middle of a painted zone
//: and how much of it there is. It becomes a line along the kerb the point is nearest, half
//: the length each way, and is painted like a policy zone. This is the inventory of paint
//: itself -- every driveway red, every green zone in the corridor is here and nowhere else.
const COLOR_CURB_MIN_M = 1.0;
function colorCurbRecordLines(record) {
  if (!record.p || record.p.length < 2) return [];
  const feet = Number(record.length_ft);
  const length = Math.max(COLOR_CURB_MIN_M, Number.isFinite(feet) && feet > 0 ? feet * 0.3048 : 6.0);
  const [x, y] = xy(record.p[0], record.p[1]);
  const kerb = nearestKerbAt(x, -y, CURB_SNAP_REACH_M);
  if (!kerb) return [];
  const half = length / 2;
  return [[lonLatFromXZ(kerb.x - kerb.ax * half, kerb.z - kerb.az * half),
           lonLatFromXZ(kerb.x + kerb.ax * half, kerb.z + kerb.az * half)]];
}

function addOfficialCurbZoneBands(records) {
  // Kerb paint, painted onto the kerb.
  //
  // The kerb is a tile of its own, laid with the pavement: four inches of the top and the whole
  // face. This colours that tile's vertices along each policy line -- red no stopping, yellow
  // commercial loading, white passenger loading, green short-term, blue accessible -- and the
  // paint is then in the pavement rather than a separate band floating over it, which is what
  // it was: a strip drawn where SFMTA had digitised the line, in traffic on one block and up on
  // the footway the next. Now the line is snapped to the kerb the model drew and the kerb's own
  // vertices take the colour, so it cannot be anywhere but on the kerb.
  const kerbs = [];
  groups.streets.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.surface === "kerb"
        && o.geometry.getAttribute("color")) kerbs.push(o);
  });
  if (!kerbs.length) return { segments: 0, unplaced: records.length, painted: 0 };

  // Every snapped policy segment, with its colour, in a grid.
  const CELL = 8;
  const grid = new Map();
  let segments = 0;
  let unplaced = 0;
  const byColour = {};
  for (const record of records) {
    const color = curbZoneColor(record);
    if (!color) continue;
    const lines = Array.isArray(record.lines) ? record.lines : colorCurbRecordLines(record);
    if (!lines.length) { unplaced += 1; continue; }
    const c = new THREE.Color(color);
    const runs = kerbRunsFor({ lines });
    if (!runs.length) { unplaced += 1; continue; }
    byColour[record.curb_color] = (byColour[record.curb_color] || 0) + 1;
    for (const run of runs) {
      for (let i = 1; i < run.length; i += 1) {
        const a = run[i - 1];
        const b = run[i];
        const seg = [a.x, a.z, b.x, b.z, c.r, c.g, c.b];
        const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL);
        const z0 = Math.floor(Math.min(a.z, b.z) / CELL), z1 = Math.floor(Math.max(a.z, b.z) / CELL);
        for (let ix = x0; ix <= x1; ix += 1) {
          for (let iz = z0; iz <= z1; iz += 1) {
            const key = `${ix}:${iz}`;
            let bucket = grid.get(key);
            if (!bucket) grid.set(key, bucket = []);
            bucket.push(seg);
          }
        }
        segments += 1;
      }
    }
  }
  // Then every kerb vertex asks whether a painted line runs past it.
  const reach2 = KERB_PAINT_REACH_M * KERB_PAINT_REACH_M;
  let painted = 0;
  for (const kerb of kerbs) {
    const pos = kerb.geometry.getAttribute("position");
    const col = kerb.geometry.getAttribute("color");
    let touched = false;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      let best = null;
      let bestD = reach2;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(`${cx + dx}:${cz + dz}`);
          if (!bucket) continue;
          for (const seg of bucket) {
            const d = distanceToSegmentSquared(x, z, seg[0], seg[1], seg[2], seg[3]);
            if (d < bestD) { bestD = d; best = seg; }
          }
        }
      }
      if (!best) continue;
      col.setXYZ(i, best[4], best[5], best[6]);
      painted += 1;
      touched = true;
    }
    if (touched) col.needsUpdate = true;
  }
  return { segments, unplaced, painted, byColour };
}

//: The curb lane a bus pulls into. Three metres is the lane, and the paint covers it.
const BUS_ZONE_WIDTH_M = 3.0;
//: The white edge SFMTA outlines a transit zone with.
const BUS_ZONE_BORDER_M = 0.12;
//: Below the lane lines, above the asphalt: the box is a surface treatment and the markings are
//: painted over it.
const BUS_ZONE_Y = ROAD_TOP_M + 0.006;
const BUS_ZONE_BORDER_Y = ROAD_TOP_M + 0.010;
//: Where the kerb turns more than this, the zone ends. Twenty degrees is a bend in a street;
//: more than that is a corner, and a bus zone does not wrap one.
const BUS_ZONE_MAX_TURN_DEG = 20.0;

// ---- parking meters --------------------------------------------------------------------------
//
// SFMTA's meters (scripts/ingest_kerb_assets.py: every on-street meter in service, from the city's
// own inventory) and, elsewhere, the parking ticket machines OpenStreetMap maps. A single-space
// meter is a head on a post -- two where two spaces share the post -- with its cap in the colour
// that says what kind of space it is; a pay station is a kiosk. Each stands just in from the kerb,
// square to the street, its face to the road.
const METER_SPEC = { setback: 0.45, post: 1.12, head: [0.22, 0.34, 0.16], kiosk: [0.42, 1.55, 0.32] };
const METER_CAP_COLOURS = { grey: 0x8e9599, yellow: 0xe6c229, black: 0x22262a, green: 0x2f8f4e, red: 0xc0392b,
  blue: 0x2b6cb0, purple: 0x6b46c1, brown: 0x7a5230 };
function meterSpot(item) {
  const [x, y] = xy(item.p[0], item.p[1]);
  const kerb = streetSquareKerb(nearestKerbAt(x, -y, 8));
  if (kerb) {
    const mx = kerb.x + kerb.nx * METER_SPEC.setback, mz = kerb.z + kerb.nz * METER_SPEC.setback;
    if (!insideCarriageway(mx, mz, 0.05) && !buildingAt(mx, mz)) {
      const top = pavementTopAt(mx, mz);
      return { x: mx, z: mz, y: (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(mx, mz),
        yaw: Math.atan2(-kerb.nx, -kerb.nz), ax: kerb.nz, az: -kerb.nx };
    }
  }
  const anchor = furnitureAnchor(item);
  return anchor ? { ...anchor, yaw: furnitureBearing(item, 0, anchor), ax: 1, az: 0 } : null;
}
function addParkingMeters(records) {
  const singles = [], kiosks = [];
  for (const item of records) {
    if (!item?.p) continue;
    const spot = meterSpot(item);
    if (!spot) continue;
    (item.meter_type === "pay_station" ? kiosks : singles).push({ item, spot });
  }
  const dummy = new THREE.Object3D();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.45, metalness: 0.6 });
  if (singles.length) {
    const heads = singles.reduce((n, r) => n + Math.max(1, Math.min(2, r.item.heads || 1)), 0);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.04, 0.045, 1, 8), metal, singles.length);
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(...METER_SPEC.head),
      new THREE.MeshStandardMaterial({ color: 0x5b6267, roughness: 0.5, metalness: 0.45 }), heads);
    const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(METER_SPEC.head[0] + 0.01, 0.06, METER_SPEC.head[2] + 0.01),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), heads);
    let h = 0;
    const colour = new THREE.Color();
    singles.forEach(({ item, spot }, i) => {
      dummy.position.set(spot.x, spot.y + METER_SPEC.post / 2, spot.z);
      dummy.rotation.set(0, spot.yaw, 0);
      dummy.scale.set(1, METER_SPEC.post, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      const n = Math.max(1, Math.min(2, item.heads || 1));
      for (let k = 0; k < n; k += 1) {
        const along = n === 2 ? (k ? 0.13 : -0.13) : 0;
        const hx = spot.x + spot.ax * along, hz = spot.z + spot.az * along;
        dummy.scale.set(1, 1, 1);
        dummy.position.set(hx, spot.y + METER_SPEC.post + METER_SPEC.head[1] / 2, hz);
        dummy.updateMatrix();
        bodies.setMatrixAt(h, dummy.matrix);
        dummy.position.set(hx, spot.y + METER_SPEC.post + METER_SPEC.head[1] + 0.03, hz);
        dummy.updateMatrix();
        caps.setMatrixAt(h, dummy.matrix);
        caps.setColorAt(h, colour.setHex(METER_CAP_COLOURS[item.cap_color] ?? METER_CAP_COLOURS.grey));
        h += 1;
      }
    });
    for (const mesh of [posts, bodies, caps]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData = { surface: "furniture:parking_meter", source: "sfmta_parking_meters", liftedOntoGround: true };
      groups.furniture.add(mesh);
    }
  }
  if (kiosks.length) {
    const kiosk = new THREE.InstancedMesh(new THREE.BoxGeometry(...METER_SPEC.kiosk), metal, kiosks.length);
    const screen = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.26, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x9fd3e6, roughness: 0.2, emissive: 0x1d3a45 }), kiosks.length);
    kiosks.forEach(({ spot }, i) => {
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, spot.yaw, 0);
      dummy.position.set(spot.x, spot.y + METER_SPEC.kiosk[1] / 2, spot.z);
      dummy.updateMatrix();
      kiosk.setMatrixAt(i, dummy.matrix);
      // The screen on the face to the pavement, where a driver stands to pay.
      const fx = -Math.sin(spot.yaw) * (METER_SPEC.kiosk[2] / 2 + 0.005), fz = -Math.cos(spot.yaw) * (METER_SPEC.kiosk[2] / 2 + 0.005);
      dummy.position.set(spot.x + fx, spot.y + 1.2, spot.z + fz);
      dummy.rotation.set(0, spot.yaw + Math.PI, 0);
      dummy.updateMatrix();
      screen.setMatrixAt(i, dummy.matrix);
    });
    for (const mesh of [kiosk, screen]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData = { surface: "furniture:parking_meter", source: "parking_pay_stations", liftedOntoGround: true };
      groups.furniture.add(mesh);
    }
  }
  return { single_space: singles.length, pay_stations: kiosks.length };
}

// ---- Muni's trolleybus wires ------------------------------------------------------------------
//
// The streets OpenStreetMap marks trolley_wire=yes carry Muni's overhead contact wires: a pair
// over each direction's lane (two wires, a trolley pole to each), about 5.6 m up, held by span
// wires strung between poles at the kerbs every forty metres or so. They are drawn as the power
// wires are -- thin dark lines -- with their span poles and the cross wires between them.
//: A span pole this close to one of the city's trolley poles is that pole.
const TROLLEY_POLE_SNAP_M = 9;
//: A span pole this close to another already standing is that pole.
const TROLLEY_POLE_SHARE_M = 6;
const TROLLEY = { height: 5.6, pair: 0.6, laneOffset: 2.4, onewayOffset: 1.4, span: 36, poleHeight: 7.6, crossAt: 6.6 };
//: Way ends this close are one node.
const TROLLEY_JOIN_M = 0.5;
//: A line's last span stands this far back from a junction it ends at, on the block, where
//: there are kerbs to stand its poles on (the junction's middle has none).
const TROLLEY_END_SPAN_BACK_M = 6;

function trolleyChains(paths) {
  // OpenStreetMap splits a street's wire into ways at every tag change, and a route that turns
  // the corner (Fillmore into Green) is two ways meeting at the junction. Drawn one way at a
  // time, each way's offset wires stop square at its end and the next way's start square at
  // its own: at a turn, the four wires end in the air across the junction. Ways meeting end to
  // end, where nothing else meets them, are one line -- two-way ways in either direction,
  // one-way ways only head to tail. paths: [{ path: [[x, z], ...], oneway }].
  // Returns [{ path, oneway, startOpen, endOpen }], open meaning nothing else meets that end.
  const keyOf = ([x, z]) => `${Math.round(x / TROLLEY_JOIN_M)},${Math.round(z / TROLLEY_JOIN_M)}`;
  const ends = new Map();
  paths.forEach((w, i) => {
    if (w.path.length < 2) return;
    for (const [at, end] of [[0, "start"], [w.path.length - 1, "end"]]) {
      const k = keyOf(w.path[at]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ i, end });
    }
  });
  const used = new Set();
  const partner = (i, end) => {
    const here = ends.get(keyOf(end === "start" ? paths[i].path[0] : paths[i].path.at(-1))) || [];
    if (here.length !== 2) return null;
    const other = here.find((e) => e.i !== i);
    if (!other || used.has(other.i) || paths[other.i].oneway !== paths[i].oneway) return null;
    if (paths[i].oneway && other.end === end) return null;  // head to head: opposite directions
    return other;
  };
  const degree = (pt) => (ends.get(keyOf(pt)) || []).length;
  const chains = [];
  paths.forEach((w, i) => {
    if (used.has(i) || w.path.length < 2) return;
    used.add(i);
    let path = w.path.slice();
    // Forward from the end, then back from the start.
    for (let cur = { i, end: "end" }, next; (next = partner(cur.i, cur.end));) {
      used.add(next.i);
      const p = paths[next.i].path;
      const along = next.end === "start" ? p : p.slice().reverse();
      path = path.concat(along.slice(1));
      cur = { i: next.i, end: next.end === "start" ? "end" : "start" };
    }
    for (let cur = { i, end: "start" }, next; (next = partner(cur.i, cur.end));) {
      used.add(next.i);
      const p = paths[next.i].path;
      const along = next.end === "end" ? p : p.slice().reverse();
      path = along.slice(0, -1).concat(path);
      cur = { i: next.i, end: next.end === "end" ? "start" : "end" };
    }
    chains.push({ path, oneway: w.oneway, startOpen: degree(path[0]) <= 1, endOpen: degree(path.at(-1)) <= 1 });
  });
  return chains;
}

function mitredOffsets(path) {
  // Each vertex's offset direction and length: the mean of the two segments' left normals,
  // lengthened so an offset line keeps its distance through the bend (at most twice, so a
  // hairpin does not throw a wire across the street). [[nx, nz, scale], ...]
  const normals = [];
  for (let i = 1; i < path.length; i += 1) {
    const dx = path[i][0] - path[i - 1][0], dz = path[i][1] - path[i - 1][1];
    const len = Math.hypot(dx, dz) || 1;
    normals.push([-dz / len, dx / len]);
  }
  return path.map((_, i) => {
    const a = normals[Math.max(0, i - 1)], b = normals[Math.min(normals.length - 1, i)];
    let mx = a[0] + b[0], mz = a[1] + b[1];
    const m = Math.hypot(mx, mz);
    if (m < 1e-6) return [a[0], a[1], 1];
    mx /= m; mz /= m;
    const cosHalf = mx * a[0] + mz * a[1];
    return [mx, mz, Math.min(2, 1 / Math.max(cosHalf, 0.5))];
  });
}

function trolleySpanStations(length, startOpen, endOpen) {
  // Distances along a line where its span wires cross: every TROLLEY.span metres, the first
  // and last on the block -- at an open end, at the end itself (the wire ends on that span);
  // at a junction, TROLLEY_END_SPAN_BACK_M short of it -- so no length of wire hangs past its
  // last support.
  const first = startOpen ? 0 : TROLLEY_END_SPAN_BACK_M;
  const last = length - (endOpen ? 0 : TROLLEY_END_SPAN_BACK_M);
  if (last <= first) return [length / 2];
  const stations = [];
  for (let d = first; d < last - TROLLEY.span / 4; d += TROLLEY.span) stations.push(d);
  stations.push(last);
  return stations;
}

//: Overhead wire never turns a corner sharply in the air: it rounds it in a curve of short
//: chords, each held out to a pole on the outside of the turn by a pull-off wire. A bend
//: sharper than TROLLEY_BEND_DEG is drawn so, on a curve of about TROLLEY_CURVE_R_M.
const TROLLEY_BEND_DEG = 20;
const TROLLEY_CURVE_R_M = 9;
//: The pull-off pole stands at the kerb about this far out from the bend's apex.
const TROLLEY_PULL_OFF_M = 9;
function filletTrolleyPath(path) {
  // path: [[x, z], ...]. Returns { path, bends: [{ apex, out, from, to }] }: each bend
  // sharper than TROLLEY_BEND_DEG replaced by an arc (indices from..to in the new path), with
  // out the unit vector to the outside of the turn.
  const out = [path[0]], bends = [];
  for (let i = 1; i < path.length - 1; i += 1) {
    const [px, pz] = path[i - 1], [cx, cz] = path[i], [nx, nz] = path[i + 1];
    const l0 = Math.hypot(cx - px, cz - pz), l1 = Math.hypot(nx - cx, nz - cz);
    if (l0 < 1e-6 || l1 < 1e-6) { out.push(path[i]); continue; }
    const d0 = [(cx - px) / l0, (cz - pz) / l0], d1 = [(nx - cx) / l1, (nz - cz) / l1];
    const turn = Math.acos(Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1])));
    if (turn < TROLLEY_BEND_DEG * Math.PI / 180) { out.push(path[i]); continue; }
    const t = Math.min(TROLLEY_CURVE_R_M * Math.tan(turn / 2), 0.45 * l0, 0.45 * l1);
    const r = t / Math.tan(turn / 2);
    const left = [-d0[1], d0[0]], side = d1[0] * left[0] + d1[1] * left[1] >= 0 ? 1 : -1;
    const inside = [left[0] * side, left[1] * side];
    const A = [cx - d0[0] * t, cz - d0[1] * t], B = [cx + d1[0] * t, cz + d1[1] * t];
    const C = [A[0] + inside[0] * r, A[1] + inside[1] * r];
    const steps = Math.max(3, Math.ceil(turn / (15 * Math.PI / 180)));
    const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
    const rot = (sign) => [C[0] + Math.cos(a0 + sign * turn) * r, C[1] + Math.sin(a0 + sign * turn) * r];
    const sign = Math.hypot(...[0, 1].map((k) => rot(1)[k] - B[k])) < Math.hypot(...[0, 1].map((k) => rot(-1)[k] - B[k])) ? 1 : -1;
    const from = out.length;
    for (let k = 0; k <= steps; k += 1) {
      const a = a0 + sign * turn * (k / steps);
      out.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r]);
    }
    const ox = d0[0] - d1[0], oz = d0[1] - d1[1], ol = Math.hypot(ox, oz) || 1;
    bends.push({ apex: [cx, cz], out: [ox / ol, oz / ol], from, to: out.length - 1 });
  }
  out.push(path.at(-1));
  return { path: out, bends };
}

function addTrolleyWires(records, lightRows = []) {
  const segments = [], poles = [];
  // Muni's span wires hang from the city's trolley poles, which carry streetlights and are in
  // its layer (TP-*): a span pole falling near one is that pole, already standing.
  const trolleyLights = lightRows.filter((row) => String(row.item.pole_type || "").startsWith("TP-"));
  const standing = (x, z) => {
    let best = null;
    for (const row of trolleyLights) {
      const d = Math.hypot(row.anchor.x - x, row.anchor.z - z);
      if (d < TROLLEY_POLE_SNAP_M && (!best || d < best.d)) best = { d, row };
    }
    return best && best.row;
  };
  // Each way places its own span poles, so a street mapped as two one-way ways, and every
  // junction where ways meet, stood a second pole a few metres from the first. A span pole
  // falling this close to one already standing hangs from that one.
  const placedPoles = new Map();
  const cellOf = (x, z) => `${Math.floor(x / TROLLEY_POLE_SHARE_M)},${Math.floor(z / TROLLEY_POLE_SHARE_M)}`;
  const standingSpanPole = (x, z) => {
    const cx = Math.floor(x / TROLLEY_POLE_SHARE_M), cz = Math.floor(z / TROLLEY_POLE_SHARE_M);
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const pole of placedPoles.get(`${cx + dx},${cz + dz}`) || []) {
        if (Math.hypot(pole.x - x, pole.z - z) < TROLLEY_POLE_SHARE_M) return pole;
      }
    }
    return null;
  };
  const groundAt = (x, z) => groundLiftAt(x, z) + ROAD_TOP_M;
  const supportAt = (x, z, reach) => {
    // Where a wire is tied off near (x, z): the city's trolley pole, a span pole already
    // standing, or a new pole at the kerb. [x, y, z] of the tie, or null where none can stand.
    const kerb = streetSquareKerb(nearestKerbAt(x, z, reach));
    if (!kerb) return null;
    const qx = kerb.x + kerb.nx * 0.5, qz = kerb.z + kerb.nz * 0.5;
    if (buildingAt(qx, qz) || insideCarriageway(qx, qz, 0.05)) return null;
    const real = standing(qx, qz);
    if (real) return [real.anchor.x, real.anchor.y + TROLLEY.crossAt, real.anchor.z];
    const shared = standingSpanPole(qx, qz);
    if (shared) return [shared.x, shared.y + TROLLEY.crossAt, shared.z];
    const top = pavementTopAt(qx, qz);
    const y = (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + groundLiftAt(qx, qz);
    const pole = { x: qx, y, z: qz };
    poles.push(pole);
    const key = cellOf(qx, qz);
    if (!placedPoles.has(key)) placedPoles.set(key, []);
    placedPoles.get(key).push(pole);
    return [qx, y + TROLLEY.crossAt, qz];
  };
  const spanAt = (px, pz, nx, nz) => {
    // A span wire across the street at (px, pz), between poles at the kerbs either side.
    const ends = [1, -1].map((side) => supportAt(px + nx * side * 7, pz + nz * side * 7, 6)).filter(Boolean);
    if (ends.length === 2) segments.push(...ends[0], ...ends[1]);
    return ends.length === 2;
  };
  const projected = records.map((wire) => ({
    oneway: Boolean(wire.oneway),
    path: (wire.points || []).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; }),
  }));
  for (const chain of trolleyChains(projected)) {
    const cleaned = chain.path.filter((pt, i, all) => i === 0 || Math.hypot(pt[0] - all[i - 1][0], pt[1] - all[i - 1][1]) >= 0.5);
    if (cleaned.length < 2) continue;
    const { path, bends } = filletTrolleyPath(cleaned);
    const offsets = chain.oneway
      ? [TROLLEY.onewayOffset - TROLLEY.pair / 2, TROLLEY.onewayOffset + TROLLEY.pair / 2]
      : [-TROLLEY.laneOffset - TROLLEY.pair / 2, -TROLLEY.laneOffset + TROLLEY.pair / 2,
         TROLLEY.laneOffset - TROLLEY.pair / 2, TROLLEY.laneOffset + TROLLEY.pair / 2];
    const mitres = mitredOffsets(path);
    const at = (i, o) => [path[i][0] + mitres[i][0] * mitres[i][2] * o, path[i][1] + mitres[i][1] * mitres[i][2] * o];
    const lengths = [0];
    for (let i = 1; i < path.length; i += 1) {
      const [ax, az] = path[i - 1], [bx, bz] = path[i];
      const len = Math.hypot(bx - ax, bz - az);
      lengths.push(lengths[i - 1] + len);
      const steps = Math.max(1, Math.ceil(len / 12));
      for (const o of offsets) {
        const a = at(i - 1, o), b = at(i, o);
        for (let k = 0; k < steps; k += 1) {
          const t0 = k / steps, t1 = (k + 1) / steps;
          const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
          const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
          segments.push(p0[0], groundAt(...p0) + TROLLEY.height, p0[1], p1[0], groundAt(...p1) + TROLLEY.height, p1[1]);
        }
      }
    }
    // Each curve hangs from a pole on the outside of its turn: a pull-off wire from the pole to
    // every wire at each of the curve's inner points. Where no pole can stand there, a span
    // across the street at either end of the curve holds it instead.
    for (const bend of bends) {
      const reach = TROLLEY.laneOffset + TROLLEY_PULL_OFF_M;
      const tie = supportAt(bend.apex[0] + bend.out[0] * reach, bend.apex[1] + bend.out[1] * reach, 7)
        || supportAt(bend.apex[0] + bend.out[0] * reach, bend.apex[1] + bend.out[1] * reach, 12);
      if (tie) {
        for (let k = bend.from + 1; k < bend.to; k += 1) {
          for (const o of offsets) {
            const w = at(k, o);
            segments.push(...tie, w[0], groundAt(...w) + TROLLEY.height, w[1]);
          }
        }
        continue;
      }
      for (const k of [bend.from, bend.to]) {
        const j = Math.min(path.length - 1, Math.max(1, k));
        const dx = path[j][0] - path[j - 1][0], dz = path[j][1] - path[j - 1][1], l = Math.hypot(dx, dz) || 1;
        spanAt(path[k][0], path[k][1], -dz / l, dx / l);
      }
    }
    // Span wires along the line, the first and last where they hold its ends.
    let seg = 1;
    for (const d of trolleySpanStations(lengths.at(-1), chain.startOpen, chain.endOpen)) {
      while (seg < path.length - 1 && lengths[seg] < d) seg += 1;
      const [ax, az] = path[seg - 1], [bx, bz] = path[seg];
      const len = lengths[seg] - lengths[seg - 1] || 1;
      const ux = (bx - ax) / len, uz = (bz - az) / len, t = d - lengths[seg - 1];
      spanAt(ax + ux * t, az + uz * t, -uz, ux);
    }
  }
  if (segments.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x2c302f }));
    lines.userData = { surface: "furniture:trolley_wire", source: "openstreetmap" };
    groups.furniture.add(lines);
  }
  if (poles.length) {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.15, 1, 10),
      new THREE.MeshStandardMaterial({ color: 0x4a5250, roughness: 0.55, metalness: 0.5 }), poles.length);
    const dummy = new THREE.Object3D();
    poles.forEach((pole, i) => {
      dummy.position.set(pole.x, pole.y + TROLLEY.poleHeight / 2, pole.z);
      dummy.scale.set(1, TROLLEY.poleHeight, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData = { surface: "furniture:trolley_pole", source: "openstreetmap", liftedOntoGround: true };
    groups.furniture.add(mesh);
  }
  return { wire_segments: segments.length / 6, span_poles: poles.length };
}

//: A bus zone shorter than this, once cut back from the crossings, is not painted.
const BUS_ZONE_MIN_M = 6.0;
//: The pieces of a zone's kerb run that are a bus zone: never through a junction or over a
//: crossing (a zone ends before the crosswalk, and the next one starts after it), never where
//: the paint would leave the roadway, and all on one side -- the side most of the run is on.
//: The kerb snap can catch the cross street's kerb round a corner, and the strip's white edge
//: came out on the other side of the zone across the crosswalk.
function busZonePieces(run) {
  if (run.length < 2) return [];
  const mid = BUS_ZONE_WIDTH_M / 2;
  // The side: the way the paint goes off the run's direction of travel.
  const dx = run[run.length - 1].x - run[0].x, dz = run[run.length - 1].z - run[0].z;
  const sideOf = (k) => Math.sign(dx * -k.nz - dz * -k.nx) || 1;
  let left = 0;
  for (const k of run) left += sideOf(k) > 0 ? 1 : 0;
  const side = left * 2 >= run.length ? 1 : -1;
  const pieces = [];
  let piece = [];
  const length = (p) => p.reduce((sum, k, i) => sum + (i ? Math.hypot(k.x - p[i - 1].x, k.z - p[i - 1].z) : 0), 0);
  const flush = () => { if (piece.length >= 2 && length(piece) >= BUS_ZONE_MIN_M) pieces.push(piece); piece = []; };
  for (const k of run) {
    const px = k.x - k.nx * mid, pz = k.z - k.nz * mid;
    const ok = sideOf(k) === side && !insideJunctionBox(px, pz) && !onCrossingGround(px, pz, 0.4)
      && insideCarriageway(px, pz, 0);
    if (ok) piece.push(k); else flush();
  }
  flush();
  return pieces;
}

function addBusZonePaint(records) {
  // The red box in the roadway at a bus zone.
  //
  // The curb beside it is already red -- every one of these carries curb_color red and is drawn
  // by the band pass above. What was missing is the part in the road: San Francisco marks its
  // transit stops with the curb lane itself in transit red, edged in white, so a driver can see
  // the zone from behind rather than having to read the kerb.
  const fill = { positions: [], index: [] };
  const border = { positions: [], index: [] };
  let zones = 0;
  const quad = (sink, ax, az, bx, bz, cx, cz, dx, dz, y) => {
    const base = sink.positions.length / 3;
    sink.positions.push(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz);
    sink.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const record of records) {
    // Square to the street at every sample: the zone runs parallel to the road, never on the
    // diagonal a corner's segment end gives (streetSquareKerb).
    for (const raw of kerbRunsFor(record, BUS_ZONE_MAX_TURN_DEG).map((run) => run.map(streetSquareKerb))) {
      for (const run of busZonePieces(raw)) {
        if (run.length < 2) continue;
        // Beyond a bike lane along the kerb -- the bus pulls in across it -- or from the kerb:
        // decided once for the whole stretch, by most of it, so the red does not step out and
        // back for a block where a lane was found under a sample or two and none is drawn.
        const inLane = run.filter((k) => insideBikeLane(k.x - k.nx * 0.6, k.z - k.nz * 0.6)).length;
        const from = inLane >= run.length * 0.6 ? BIKE_LANE_M + 0.35 : 0;
        const ain = from + BUS_ZONE_WIDTH_M, o = ain, w = BUS_ZONE_BORDER_M;
        zones += 1;
        for (let i = 1; i < run.length; i += 1) {
          const a = run[i - 1];
          const b = run[i];
          if (Math.hypot(b.x - a.x, b.z - a.z) < 0.05) continue;
          // Belt and braces: if the far edge has still converged, the quad is a wedge, not a
          // stretch of lane, and a wedge of red paint in the road is worse than a short gap.
          const farA = [a.x - a.nx * BUS_ZONE_WIDTH_M, a.z - a.nz * BUS_ZONE_WIDTH_M];
          const farB = [b.x - b.nx * BUS_ZONE_WIDTH_M, b.z - b.nz * BUS_ZONE_WIDTH_M];
          const near = Math.hypot(b.x - a.x, b.z - a.z);
          if (Math.hypot(farB[0] - farA[0], farB[1] - farA[1]) < near * 0.55) continue;
          quad(fill,
            a.x - a.nx * from, a.z - a.nz * from,
            b.x - b.nx * from, b.z - b.nz * from,
            b.x - b.nx * ain, b.z - b.nz * ain,
            a.x - a.nx * ain, a.z - a.nz * ain, BUS_ZONE_Y);
          // The white edge, on the traffic side only -- the kerb side is the kerb.
          quad(border,
            a.x - a.nx * o, a.z - a.nz * o,
            b.x - b.nx * o, b.z - b.nz * o,
            b.x - b.nx * (o - w), b.z - b.nz * (o - w),
            a.x - a.nx * (o - w), a.z - a.nz * (o - w), BUS_ZONE_BORDER_Y);
        }
      }
    }
  }
  const emit = (sink, color, name, roughness) => {
    if (!sink.positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
    geometry.setIndex(sink.index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color, roughness, metalness: 0.0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10,
    }));
    mesh.userData = { surface: name, source: "sfmta_curb_zones",
                      provenance: "official_transit_vehicle_loading_zone" };
    groups.furniture.add(mesh);
  };
  emit(fill, 0x8c2f2a, "bus_zone:fill", 0.9);
  emit(border, 0xf2f5ef, "bus_zone:border", 0.82);
  return zones;
}

//: Two mapped shelters closer than this are one shelter that somebody mapped twice, or the two
//: halves of one structure. Shorter than a shelter is long, so a genuine pair at opposite kerbs
//: of a wide street both survive.
const SHELTER_CLUSTER_M = 15.0;

function dedupeByDistance(records, metres) {
  const kept = [];
  for (const item of records) {
    if (!item || !item.p || item.p.length < 2) continue;
    const [x, y] = xy(item.p[0], item.p[1]);
    const z = -y;
    if (kept.some((other) => Math.hypot(other.x - x, other.z - z) < metres)) continue;
    kept.push({ x, z, item });
  }
  return kept.map((row) => row.item);
}

// The city's streetlights (SFPUC's layer, scripts/ingest_streetlights.py), each drawn as its pole
// type is built in the SFPUC Streetlight Catalog: a standard steel or concrete pole of 25 to 30 ft
// with an upswept mast arm of 4 to 8 ft out over the road and a cobra head at its end; a fluted
// pole with an acorn pendant hanging from its arm; a 14 or 16 ft pedestrian pole with its lamp
// on top; Market Street's three-globe Path of Gold; Chinatown's twin lanterns.
const STREET_LIGHT_FINISHES = {
  galvanized_steel: 0x9ea3a2, concrete: 0xb8b3a8, wood: 0x5f4d3f, dark_blue_steel: 0x2d3a4b,
  aluminium: 0xb6babc, dark_steel: 0x383c3b, red_steel: 0x9a2b22,
};
//: Base radius of each form's shaft; it tapers to 0.6 of it at the top.
const STREET_LIGHT_SHAFT_R = { mast_arm: 0.13, pendant: 0.13, post_top: 0.08, trident: 0.16, twin_pendant: 0.12 };
const STREET_LIGHT_ARM_R = 0.045;

//: One light's parts in its own frame: x across, y up, z out over the road from the pole's foot.
//: shaft: its height; rods: arm pieces a to b; heads: cobra heads; globes: lamps (sx, sy their
//: radii); caps: the hat over a lamp.
function streetLightParts(form, height, arm) {
  const H = height, A = Math.max(1.2, arm || 0);
  const parts = { shaft: H, rods: [], heads: [], globes: [], caps: [] };
  if (form === "pendant") {
    // A horizontal arm from the pole's top, the acorn hung from its end.
    parts.shaft = H + 0.15;
    parts.rods.push({ a: [0, H + 0.05, 0], b: [0, H + 0.12, A] }, { a: [0, H + 0.12, A], b: [0, H - 0.22, A], r: 0.025 });
    parts.caps.push({ at: [0, H - 0.25, A], r: 0.26 });
    parts.globes.push({ at: [0, H - 0.62, A], sx: 0.22, sy: 0.36 });
  } else if (form === "post_top") {
    parts.shaft = H - 0.75;
    parts.globes.push({ at: [0, H - 0.38, 0], sx: 0.22, sy: 0.38 });
    parts.caps.push({ at: [0, H - 0.02, 0], r: 0.2 });
  } else if (form === "dome") {
    parts.shaft = H - 0.3;
    parts.globes.push({ at: [0, H - 0.22, 0], sx: 0.32, sy: 0.12 });
    parts.caps.push({ at: [0, H - 0.08, 0], r: 0.4 });
  } else if (form === "trident") {
    parts.shaft = H - 0.55;
    parts.rods.push({ a: [-0.75, H - 0.7, 0], b: [0.75, H - 0.7, 0] });
    for (const [x, y] of [[0, H - 0.2], [-0.75, H - 0.4], [0.75, H - 0.4]]) {
      parts.globes.push({ at: [x, y, 0], sx: 0.22, sy: 0.26 });
    }
  } else if (form === "twin_pendant") {
    for (const side of [-1, 1]) {
      parts.rods.push({ a: [0, H - 0.35, 0], b: [side * A, H - 0.15, 0] });
      parts.caps.push({ at: [side * A, H - 0.3, 0], r: 0.2 });
      parts.globes.push({ at: [side * A, H - 0.62, 0], sx: 0.16, sy: 0.3 });
    }
  } else {
    // The mast arm: from a bracket below the pole's top it sweeps up and out over the road -- a
    // backwards L -- to the cobra head, whose lens faces down at the street.
    parts.shaft = H - 0.35;
    const knee = [0, H - 0.2, Math.max(0.5, 0.35 * A)];
    parts.rods.push({ a: [0, H - 0.95, 0], b: knee }, { a: knee, b: [0, H, A] });
    parts.heads.push({ at: [0, H - 0.04, A + 0.32] });
  }
  return parts;
}

function communicationMast(item,headset) {
  if(headset)return true; // independently released Quest appearance remains unchanged
  const type=item.tags?.["tower:type"];
  return type!=="lighting" && (type==="communication" || item.mobile===true);
}
function parkLightingRecords(inferred,headset) {
  if(headset)return [];
  const records=[...(inferred.lighting_masts || []),...(inferred.comm_towers || []).filter(r=>r.tags?.["tower:type"]==="lighting")];
  const seen=new Set();
  return records.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;}).map(r=>({...r,
    form:"mast_arm",finish:"galvanized_steel",height_m:Math.max(4,Math.min(20,parseFloat(r.height_m)||8)),arm_m:.8,
    dimension_basis:r.height_m ? "mapped_height" : "visual_lighting_prior_not_measured"}));
}
function courtEquipmentClear(x,z,ground) {
  return !(ground?.courts || []).some(c=>{
    const paint=courtPainter(c,null),[cx,cz]=paint.at(0,0),dx=x-cx,dz=z-cz;
    const a=-c.a, u=dx*Math.cos(a)+dz*Math.sin(a),v=-dx*Math.sin(a)+dz*Math.cos(a);
    return Math.abs(u)<c.l/2+.15 && Math.abs(v)<c.w/2+.15;
  });
}
function addStreetLights(records,anchorFor=furnitureAnchor) {
  const rows = records.map((item) => ({ item, anchor: anchorFor(item) })).filter((row) => row.anchor);
  if (!rows.length) return { rows, drawn: 0 };
  const colour = new THREE.Color();
  const shafts = [], rods = [], heads = [], globes = [], caps = [];
  for (const row of rows) {
    const { item, anchor } = row;
    const form = item.luminaire === "dome" ? "dome" : item.form;
    const H = Math.max(3.5, Math.min(11, parseFloat(item.height_m) || 8.7));
    const parts = streetLightParts(form, H, parseFloat(item.arm_m) || 0);
    const yaw = furnitureBearing(item, 0, anchor);
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const world = ([x, y, z]) => new THREE.Vector3(anchor.x + x * cos + z * sin, anchor.y + y, anchor.z - x * sin + z * cos);
    const finish = STREET_LIGHT_FINISHES[item.finish] ?? STREET_LIGHT_FINISHES.galvanized_steel;
    row.height = parts.shaft;
    row.form = form;
    shafts.push({ anchor, h: parts.shaft, r: STREET_LIGHT_SHAFT_R[form] || 0.1, c: finish });
    for (const rod of parts.rods) rods.push({ a: world(rod.a), b: world(rod.b), r: rod.r || STREET_LIGHT_ARM_R, c: finish });
    for (const head of parts.heads) heads.push({ at: world(head.at), yaw });
    for (const globe of parts.globes) globes.push({ ...globe, at: world(globe.at), yaw });
    for (const cap of parts.caps) caps.push({ ...cap, at: world(cap.at), c: item.finish === "red_steel" ? finish : 0x2a2f33 });
  }
  const dummy = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const meshes = [];
  const instanced = (geometry, material, list, place, tinted = false) => {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((part, i) => {
      dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.quaternion.identity(); dummy.scale.set(1, 1, 1);
      place(part);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (tinted) mesh.setColorAt(i, colour.setHex(part.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    meshes.push(mesh);
  };
  const painted = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.35 });
  instanced(new THREE.CylinderGeometry(0.6, 1, 1, 10), painted, shafts, (s) => {
    dummy.position.set(s.anchor.x, s.anchor.y + s.h / 2, s.anchor.z);
    dummy.scale.set(s.r, s.h, s.r);
  }, true);
  instanced(new THREE.CylinderGeometry(1, 1, 1, 6), painted, rods, (rod) => {
    dir.subVectors(rod.b, rod.a);
    const length = dir.length();
    dummy.position.addVectors(rod.a, rod.b).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(up, dir.normalize());
    dummy.scale.set(rod.r, length, rod.r);
  }, true);
  // The cobra head: a flat housing along the arm, its lens a pale panel underneath.
  instanced(new THREE.BoxGeometry(0.34, 0.15, 0.78),
    new THREE.MeshStandardMaterial({ color: 0x8b9192, roughness: 0.45, metalness: 0.5 }), heads, (h) => {
      dummy.position.copy(h.at); dummy.rotation.set(0, h.yaw, 0);
    });
  instanced(new THREE.BoxGeometry(0.26, 0.02, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xe9edf0, emissive: 0xfff4e2, emissiveIntensity: 0.45, roughness: 0.3 }),
    heads, (h) => { dummy.position.set(h.at.x, h.at.y - 0.085, h.at.z); dummy.rotation.set(0, h.yaw, 0); });
  instanced(new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xf2ead6, emissive: 0xfff0cc, emissiveIntensity: 0.35, roughness: 0.25 }),
    globes, (g) => { dummy.position.copy(g.at); dummy.scale.set(g.sx, g.sy, g.sx); });
  instanced(new THREE.ConeGeometry(1, 0.6, 12), painted, caps, (cap) => {
    dummy.position.copy(cap.at); dummy.scale.set(cap.r, cap.r, cap.r);
  }, true);
  for (const mesh of meshes) {
    mesh.userData = { surface: "furniture:street_light", source: "sfpuc_streetlights" };
    groups.furniture.add(mesh);
  }
  const forms = {};
  for (const row of rows) forms[row.form] = (forms[row.form] || 0) + 1;
  return { rows, drawn: rows.length, forms };
}

//: The plates' pictures, painted a slice at a time before they are placed. Each is painted once
//: and kept by its style and legend (plateSlot), so placing them after only reads them back;
//: painted inside the placement -- a few hundred legends measured word by word -- they were one
//: frame of 0.2-0.4 s whenever the furniture arrived.
async function prepaintPlates(records) {
  for (const item of records) {
    if (item && plateStyleFor(item) !== "street_name") plateSlot(item);
    if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame();
  }
}

async function renderStreetFurniture(furniture, transit = null, creatives = {}) {
  // The streets have been recentred on the city's kerbs since the buildings were built; the
  // junctions the signs and signals stand at are read from where the streets are now.
  junctionVertexGrid = null;
  const inferred = furniture.inferred || {};
  const official = furniture.geometry_based || {};
  // No ALL WAY plaques, and the street names come from the corner posts below: one post on a
  // corner of each junction with a blade for each street, rather than the inventory's blades
  // wherever each was digitised.
  const officialSigns = (official.street_signs || [])
    .filter((s) => !["all_way", "street_name"].includes(plateStyleFor(s)));
  // OpenStreetMap's stop and give-way points, one plate per approach they govern. Where the
  // city's own inventory has a stop or all-way sign within 25 m, the city's stands alone; the
  // inferred ones fill the junctions it does not list.
  const officialStopPoints = (official.street_signs || []).filter((s) => ["stop", "all_way"].includes(s.sign_kind) && s.p)
    .map((s) => { const [x, y] = xy(s.p[0], s.p[1]); return [x, -y]; });
  legendApproaches.length = 0; legendApproachKeys.clear();
  for (const [x, z] of officialStopPoints) noteOfficialStopApproach(x, z);
  const osmApproach = expandApproachSigns((inferred.street_signs || [])
    .filter((s) => s.sign_kind === "stop" || s.sign_kind === "yield"))
    .filter((s) => {
      const [x, y] = xy(s.p[0], s.p[1]);
      return !officialStopPoints.some(([ox, oz]) => Math.hypot(ox - x, oz + y) < 25);
    });
  const signs = officialSigns.length ? [] : (inferred.street_signs || [])
    .filter((s) => !["stop", "yield", "traffic_signal"].includes(s.sign_kind));
  const signalRecords = (official.traffic_signals || []).filter((r) => String(r.signal_type || "").toUpperCase() === "SIGNAL");
  const signalHeads = expandSignalApproaches(signalRecords.length ? signalRecords
    : (inferred.street_signs || []).filter((s) => s.sign_kind === "traffic_signal"));
  // The agencies' own stops, where the region has them, in place of OpenStreetMap's: every stop,
  // drawn as what stands there (addTransitStops). OpenStreetMap's shelters fed that reading.
  const transitStops = transit && (transit.stops || []).length ? transit : null;
  const stops = transitStops ? [] : inferred.bus_stops || [];
  // One shelter to a stop.
  //
  // A bus moves through an intersection two to four ways and each direction has its own stop,
  // but the shelter is built for one of them -- the others are a flag on a pole and paint on the
  // road. OpenStreetMap maps the structures individually, so two nodes twelve metres apart on
  // the same corner arrived as two shelters standing inside each other.
  const shelters = transitStops ? [] : dedupeByDistance(inferred.shelters || [], SHELTER_CLUSTER_M);
  const ads = inferred.ad_panels || [];
  const billboards=ads.filter(r=>r.ad_kind==="billboard"),smallAds=ads.filter(r=>r.ad_kind!=="billboard");
  // Every plate goes through one placement, so none is drawn inside another: the city's, the
  // approach plates, the corner blades, and OpenStreetMap's other signs where the city has none.
  const generic = officialSigns.length ? [] : signs.filter((s) => s.p);
  const corners = cornerStreetNameSigns();
  const plateRecords = officialSigns.concat(osmApproach, generic, corners);
  await prepaintPlates(plateRecords);
  const plates = addOfficialSignPlates(plateRecords, signalHeads);
  await maybeYield();
  const posts = stops.concat(smallAds);
  const lights = addStreetLights(official.street_lights || []);
  await maybeYield();
  // Sports lights keep their mapped anchors, never snap across a park to a street
  // kerb and never acquire cellular antennas merely because OSM calls them masts.
  const parkLights=addStreetLights(parkLightingRecords(inferred,HEADSET),item=>{
    const a=electricalAnchor(item);return a && courtEquipmentClear(a.x,a.z,GROUND) ? a : null;
  });
  const municipalCurbs=(MUNICIPAL_CONTEXT?.curb_colours || []).filter(r=>!BUILD_WINDOW || BUILD_WINDOW.near(r));
  municipalUsage.curbColourRecords=municipalCurbs.length;
  const placed = {
    street_lights: { drawn: lights.drawn, forms: lights.forms },
    park_lights: {drawn:parkLights.drawn,basis:"mapped_anchor_visual_fixture_prior"},
    posts: addStreetFurniturePosts(posts),
    official_signs: plates.signs,
    official_posts: plates.posts,
    traffic_signal_heads: addTrafficSignalHeads(signalHeads),
    inferred_approach_signs: osmApproach.length,
    electrical: addElectricalNetwork(furniture, lights.rows),
    bike_racks: plates.racks,
    generic_signs: generic.length,
    corner_name_posts: signStats.cornerPosts,
    bus_flags: addInstancedFurniturePanels(stops, 0.48, 0.34, 0x2a6db8, "furniture:bus_stop", 2.25, "lower"),
    ad_panels: addInstancedFurniturePanels(smallAds, 1.2, 1.8, 0xffffff, "furniture:blank_ad", 0.55, "skip"),
    billboards: addBillboards(billboards,creatives),
    shelters: addMuniShelters(shelters),
    transit: transitStops ? addTransitStops(transitStops) : null,
    benches: addBenches(inferred.benches || []),
    // The paint inventory first, then the policy zones that are paint by definition.
    curb_zone_bands: addOfficialCurbZoneBands((official.color_curbs || []).concat(official.curb_zones || [],
      municipalCurbs)),
    bus_zone_paint: addBusZonePaint((official.curb_zones || [])
      .filter((zone) => zone.policy_category === "Transit Vehicle Loading")),
    parking_meters: addParkingMeters((official.parking_meters || []).concat(inferred.parking_meters || [],
      inferred.detected_parking_meters || [])),
    trolley_wires: addTrolleyWires(inferred.trolley_wires || [], lights.rows),
    road_legends: paintRoadLegends(),
  };
  // Checked once everything stands: no two plates meet, no post is on a crossing.
  placed.sign_audit = auditSignPlates(plates.spots);
  if (signStats.clashes || signStats.onCrossing) console.warn("sign placement", { ...signStats });
  const note = document.getElementById("furniturenote");
  if (note) {
    const counts = furniture.summary?.inferred_counts || {};
    const officialCounts = furniture.summary?.geometry_based_counts || {};
    note.innerHTML = `<b>Street furniture</b> — ${Number(counts.street_signs || 0).toLocaleString()} inferred OSM sign anchors, `
      + `${Number(counts.bus_stops || 0).toLocaleString()} bus stop anchors, `
      + `${Number(counts.shelters || 0).toLocaleString()} shelter tags, `
      + `${Number(placed.billboards || 0).toLocaleString()} billboards; ${Number(placed.ad_panels || 0).toLocaleString()} smaller ad panels. `
      + `Official geometry: ${Number(officialCounts.street_signs || 0).toLocaleString()} signs, `
      + `${Number(officialCounts.traffic_signals || 0).toLocaleString()} signals, `
      + `${Number(officialCounts.curb_zones || 0).toLocaleString()} curb policy bands, `
      + `${Number(placed.bus_zone_paint || 0).toLocaleString()} transit zones painted; `
      + `${Number((placed.parking_meters?.single_space || 0) + (placed.parking_meters?.pay_stations || 0)).toLocaleString()} parking meters; `
      + `${Number(placed.trolley_wires?.span_poles || 0).toLocaleString()} trolleybus span poles; `
      + `${Number(placed.electrical?.utility_poles || 0).toLocaleString()} utility poles strung with `
      + `${Number((placed.electrical?.mapped_wire_spans || 0) + (placed.electrical?.reconstructed_spans || 0)
          + (placed.electrical?.telecom_spans || 0)).toLocaleString()} wire spans; `
      + `${Number(placed.electrical?.small_cells || 0).toLocaleString()} small cells.`;
    note.userData = placed;
  }
  tileGroup(groups.furniture);
}

registerLazyLayer("furniture", async () => {
  let furniture;
  try {
    furniture = windowLists(await fetchWindowed(asset("sf-corridor-furniture.json"),
      () => fetch(asset("sf-corridor-furniture.json"), { cache: "no-cache" }).then((r) => r.json())));
  } catch (err) {
    console.warn("Could not load street furniture", err);
    return;
  }
  const transit = windowLists(await fetch(asset("transit-stops.json"), { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const creatives=await fetch(sharedAsset("billboard-creatives.json"),{cache:"no-cache"})
    .then(r=>r.ok ? r.json() : {}).catch(()=>({}));
  await renderStreetFurniture(furniture, transit, creatives);
});

// Freeway guide signs (smc.highways; scripts/build_highway_signs.py), inferred from
// OpenStreetMap's exits and their ramps' destinations and published the way the storefronts
// are: a small shared manifest names each tile by its area, and only the tiles over this page's
// are fetched. A tile must be a highway-signs/<name>.json on this site and the renderer has one
// fixed name beside the manifest, so a manifest can never point the page at other code.
const HIGHWAY_SIGN_TILE_PATH = /^highway-signs\/[a-z0-9-]+\.json$/;
registerLazyLayer("highway_signs", async () => {
  const index=await fetch(sharedAsset("highway-signs.manifest.json"),{cache:"no-cache"})
    .then(r=>r.ok?r.json():null).catch(()=>null);
  if(index?.schema!=="kerbside.highway_sign_tiles/1" || !Array.isArray(index.tiles))return;
  const b=LIGHT_SPEC ? {west:LIGHT_SPEC.box[0],south:LIGHT_SPEC.box[1],east:LIGHT_SPEC.box[2],north:LIGHT_SPEC.box[3]} : DATA.bbox;
  const wanted=index.tiles.filter(t=>typeof t?.path==="string" && HIGHWAY_SIGN_TILE_PATH.test(t.path)
    && Array.isArray(t.bbox) && t.bbox[0]<=b.east && t.bbox[2]>=b.west && t.bbox[1]<=b.north && t.bbox[3]>=b.south);
  if(!wanted.length)return;
  const [tiles, module] = await Promise.all([
    Promise.all(wanted.map(t=>fetch(sharedAsset(`${t.path}?v=${encodeURIComponent(t.sha256 || "")}`))
      .then(r=>r.ok?r.json():null).catch(()=>null))),
    import(sharedAsset(`highway-sign-renderer.mjs?v=${encodeURIComponent(index.renderer_sha256 || "")}`)),
  ]);
  // A sign a few hundred metres outside the page still stands on its ground: the half-mile
  // sign for an exit inside it, seen down the road.
  const m=0.004;
  const signs=tiles.flatMap(t=>t?.schema==="kerbside.highway_signs/1" && Array.isArray(t.signs) ? t.signs : [])
    .filter(s=>Array.isArray(s?.p) && s.p[0]>=b.west-m && s.p[0]<=b.east+m && s.p[1]>=b.south-m && s.p[1]<=b.north+m);
  if(!signs.length)return;
  const group=module.buildHighwaySigns(THREE,signs,{
    place:(lon,lat)=>{const [x,y]=xy(lon,lat);return {x,z:-y};},
    ground:(x,z)=>groundLiftAt(x,z), decks:(x,z)=>elevatedRoadsAt(x,z), maxPanels:HEADSET ? 60 : 240});
  groups.furniture.add(group);
  window.kerbsideHighwaySigns=()=>group.userData.summary;
});

// Toll plazas and gantries (smc.highways.tolls; scripts/build_highway_tolls.py): every bridge's
// toll gantry, the booths still standing at the plazas and the canopies over them, from
// OpenStreetMap's toll_gantry and toll_booth, oriented and sized by the freeway each stands on.
// One small file for the whole Bay; the renderer has a fixed name beside it. The plazas stand at
// the bridges' ends, past every detailed region, in the world the page draws itself (with the
// bridges): so the page draws all of them, with the bridges, and a region's window none.
registerLazyLayer("highway_tolls", async () => {
  if (ATTACH) return;
  const index=await fetch(sharedAsset("highway-tolls.json"),{cache:"no-cache"})
    .then(r=>r.ok?r.json():null).catch(()=>null);
  if(index?.schema!=="kerbside.highway_tolls/1" || !Array.isArray(index.tolls))return;
  const tolls=index.tolls.filter(t=>Array.isArray(t?.p) && t.p.every(Number.isFinite));
  if(!tolls.length)return;
  const module=await import(sharedAsset(`highway-toll-renderer.mjs?v=${encodeURIComponent(index.renderer_sha256 || "")}`));
  const group=module.buildTolls(THREE,tolls,{
    place:(lon,lat)=>{const [x,y]=xy(lon,lat);return {x,z:-y};},
    ground:(x,z)=>groundLiftAt(x,z), decks:(x,z)=>elevatedRoadsAt(x,z)});
  // Bay-wide, as the bridges are: kept when the page lets its own world go for a window, and not
  // clipped to the detail window's box (clipDetailWorld) -- every plaza stands outside it.
  group.userData.bayWide = true;
  root.add(group);
  window.kerbsideHighwayTolls=()=>group.userData.summary;
});

// Water above and below the street (smc.waterworks; scripts/build_waterworks.py): streams, the
// gutter along every kerb, each storm drain as it is built and the wet line leading down to it,
// sewer lids fixed in the road, water tanks and a treatment plant's clarifiers and basins.
// Published as the freeway signs are: a manifest of tiles by area, and only the tiles over this
// page are fetched. Each drain carries where its water goes (window.kerbsideDrainsNear).
const WATERWORKS_TILE_PATH = /^waterworks\/[a-z0-9-]+\.json$/;
registerLazyLayer("waterworks", async () => {
  const index=await fetch(sharedAsset("waterworks.manifest.json"),{cache:"no-cache"})
    .then(r=>r.ok?r.json():null).catch(()=>null);
  if(index?.schema!=="kerbside.waterworks_tiles/1" || !Array.isArray(index.tiles))return;
  const b=LIGHT_SPEC ? {west:LIGHT_SPEC.box[0],south:LIGHT_SPEC.box[1],east:LIGHT_SPEC.box[2],north:LIGHT_SPEC.box[3]} : DATA.bbox;
  const wanted=index.tiles.filter(t=>typeof t?.path==="string" && WATERWORKS_TILE_PATH.test(t.path)
    && Array.isArray(t.bbox) && t.bbox[0]<=b.east && t.bbox[2]>=b.west && t.bbox[1]<=b.north && t.bbox[3]>=b.south);
  if(!wanted.length)return;
  const [tiles, module] = await Promise.all([
    Promise.all(wanted.map(t=>fetch(sharedAsset(`${t.path}?v=${encodeURIComponent(t.sha256 || "")}`))
      .then(r=>r.ok?r.json():null).catch(()=>null))),
    import(sharedAsset(`waterworks-renderer.mjs?v=${encodeURIComponent(index.renderer_sha256 || "")}`)),
  ]);
  // A window let go while its tiles were on their way has no ground left to stand them on.
  if (ATTACH && !groups.furniture.parent) return;
  const [w0,n0]=xy(b.west,b.north), [e0,s0]=xy(b.east,b.south);
  const minX=Math.min(w0,e0), maxX=Math.max(w0,e0), minZ=Math.min(-n0,-s0), maxZ=Math.max(-n0,-s0);
  const inArea=(x,z)=>x>=minX-30 && x<=maxX+30 && z>=minZ-30 && z<=maxZ+30;
  // Each carriageway segment once (the grid files one under every cell it crosses).
  const kerbSegments=()=>{ const seen=new Set(), out=[];
    for(const bucket of carriagewayGrid.values())for(const seg of bucket){
      if(seen.has(seg))continue; seen.add(seg);
      // A driveway or a parking aisle has no gutter of its own, and a bore has none to show.
      const way=seg[6]; if(way && (isUnmarkedService(way) || isTunnelWay(way)))continue;
      if(inArea(seg[0],seg[1])||inArea(seg[2],seg[3]))out.push(seg);
    }
    return out; };
  const builtAt=performance.now();
  const group=module.buildWaterworks(THREE,tiles.filter(t=>t?.schema==="kerbside.waterworks/1"),{
    place:(lon,lat)=>{const [x,y]=xy(lon,lat);return {x,z:-y};},
    ground:(x,z)=>groundLiftAt(x,z), roadTop:ROAD_TOP_M, kerbH:renderedKerbHeight(null),
    kerb:(x,z,reach)=>nearestKerbAt(x,z,reach), onRoad:(x,z,slack=0.4)=>insideCarriageway(x,z,slack),
    wet:(x,z)=>mappedWaterAt(x,z)===true, kerbSegments, inArea, headset:HEADSET});
  groups.furniture.add(group);
  const w=group.userData.summary;
  console.info(`kerbside: waterworks: ${w.drains} drains, ${w.lids} lids, ${w.streams} stream runs, `
    +`${Math.round(w.gutters_m)} m of gutter, ${w.tanks+w.towers+w.clarifiers+w.digesters} tanks in ${Math.round(performance.now()-builtAt)} ms`);
  window.kerbsideWaterworks=()=>({...group.userData.summary, plants:group.userData.plants,
    underground:group.userData.underground.length});
  window.kerbsideDrainsNear=(x,z,radius)=>group.userData.near(x,z,radius);
});

registerLazyLayer("coverage", () => {
for (const c of DATA.coverage) {
  const height = 10 + 92 * Math.min(1, c.score || 0);
  const radius = 9 + Math.min(26, c.eligible * 1.1);
  const color = c.score > 0.58 ? 0x4fbe86 : c.score > 0.34 ? 0xe0a84e : 0x355866;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 6, 1),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.46, roughness: 0.64 })
  );
  const [x, y] = xy(c.lon, c.lat);
  mesh.position.set(x, height / 2, -y);
  mesh.userData = c;
  groups.coverage.add(mesh);
}
});

registerLazyLayer("observations", () => {
for (const o of DATA.observations) {
  const geom = new THREE.ConeGeometry(o.eligible ? 5 : 3.5, o.eligible ? 24 : 12, 8);
  const mat = new THREE.MeshStandardMaterial({ color: o.provider === "kartaview" ? 0xff4d8f : 0x54c8e8, transparent: true, opacity: o.eligible ? 0.85 : 0.35 });
  const cone = new THREE.Mesh(geom, mat);
  const [x, y] = xy(o.lon, o.lat);
  cone.position.set(x, 18, -y);
  cone.rotation.z = Math.PI;
  cone.rotation.y = ((o.heading || 0) * Math.PI) / 180;
  groups.observations.add(cone);
}
});

registerLazyLayer("sequences", () => {
for (const s of DATA.sequence_paths) {
  groups.sequences.add(line(s.points, s.provider === "kartaview" ? 0xff4d8f : 0x54c8e8, 0.52, 32));
}
});

//: The opening view: the whole rendered region in its country, five miles of it every way,
//: with the other regions' markers standing in it -- from high enough that all of it fits,
//: which for a region a few kilometres across is a dozen kilometres up. A click brings the
//: walker down to a street; the wheel zooms in from here.
const OVERVIEW = { yaw: -0.45, pitch: 1.1, dist: 12500, look: 0.0, tilt: 0 };
//: How far the view turns up or down: just short of straight up and straight down (exactly
//: vertical, "up" is undefined and the view would spin).
const LOOK_LIMIT = 1.55;
//: The orbit's lowest pitch. Dragged on past it the view stops, as it stops at the ground
//: (ORBIT_GROUND_CLEAR_M). It used to tilt up instead (state.tilt), so that a drag that met the
//: ground kept going and swung the view round to the sky: it read as the camera bouncing off
//: the street and spinning, and it is gone. ``state.tilt`` stays 0; a saved view's is cleared.
const ORBIT_MIN_PITCH = 0.25;
//: How far over the ground the orbit camera stops: swung down towards a hill, or round to the
//: uphill side of the walker, it comes to rest this high over the ground instead of under it.
var ORBIT_GROUND_CLEAR_M = 0.8, cameraOnGround = false;
//: Blocked by a building, the orbit camera rises over it this much pitch at a time, up to this
//: pitch, before it is pulled in to the wall (placeCamera). Nearly overhead: beside a tower a
//: view from above the street is the one that clears it, and pulled in instead the camera stood
//: a few metres off the walker in the dark under the shopfronts.
var ORBIT_RISE_STEP = 0.06, ORBIT_RISE_MAX_PITCH = 1.52;
const ORBIT_MAX_TILT = ORBIT_MIN_PITCH + LOOK_LIMIT;
//: With the globe (docs/globe.mjs) the view goes out until the whole Earth is in it.
const MAX_ORBIT_DIST_M = globe ? 18000000 : 20000;
//: ``autoFirstPerson``: the walker went into a building and the view went to its eyes by
//: itself; walking out puts back the view it had. There is no view from above into a house:
//: a house keeps its roof, always.
const state = { ...OVERVIEW, target: new THREE.Vector3(0, 0, 0), firstPerson: false, autoFirstPerson: false };
function placeCamera() {
  // In the headset the headset places the view.
  if (META && renderer.xr.isPresenting) return;
  camera.up.set(0, 1, 0);
  if (state.firstPerson && typeof avatar !== "undefined") {
    // Out of the walker's eyes: the camera stands at eye height where the walker stands and
    // looks the way the arrows walk, so forward is forward. Dragging turns the head.
    const eye = avatar.position.clone();
    // A floor of the living city's own (inside a shop) stands in for the ground there.
    eye.y = AVATAR_EYE_Y + (Number.isFinite(state.floorY) ? state.floorY : walkerGroundAt(avatar.position.x, avatar.position.z));
    const forward = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw)).negate();
    const aim = eye.clone().add(forward.multiplyScalar(10 * Math.cos(state.look))).add(new THREE.Vector3(0, Math.sin(state.look) * 10, 0));
    camera.position.copy(eye);
    camera.lookAt(aim);
    return;
  }
  // The headset's follow view is always on the walker, wherever it was put down or walked to.
  if (META && typeof avatar !== "undefined") state.target.copy(avatar.position);
  const x = Math.sin(state.yaw) * Math.cos(state.pitch) * state.dist;
  const z = Math.cos(state.yaw) * Math.cos(state.pitch) * state.dist;
  const y = Math.sin(state.pitch) * state.dist;
  camera.position.copy(state.target).add(new THREE.Vector3(x, y, z));
  // A building between what the view looks at and where the camera would stand stops the camera
  // short of it, as its wall would stop you: turning the view round a house shows its wall, never
  // the rooms behind it. The distance asked for is kept, so turning back out lets the view out.
  cameraPulledIn = false;
  // From further out (the overview, a city from the air) nothing is pulled in: a tower near what
  // the view looks at would otherwise drag the camera down to the street.
  let blocked = state.dist <= ORBIT_BLOCK_REACH_M ? orbitBlockedAt(state.target, camera.position) : null;
  // Over it first. Pulled straight in, a camera with a shop behind it was shoved from sixty
  // metres out to the shop's wall, under its awning, in the dark between the shopfront and the
  // pavement, away from the walker: "auto full zoomed while still at some distance". So the view
  // keeps its distance and rises, as a camera crane would, until it clears the roofs behind;
  // only where no pitch clears them (a walker in a narrow lane between towers) is it pulled in.
  // state.pitch is left as it was, so turning away from the building brings the view back down.
  if (blocked !== null) {
    for (let pitch = state.pitch + ORBIT_RISE_STEP; pitch <= ORBIT_RISE_MAX_PITCH + 1e-6; pitch += ORBIT_RISE_STEP) {
      const at = new THREE.Vector3(Math.sin(state.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(state.yaw) * Math.cos(pitch))
        .multiplyScalar(state.dist).add(state.target);
      if (orbitBlockedAt(state.target, at) === null) { camera.position.copy(at); blocked = null; break; }
    }
  }
  if (blocked !== null) {
    camera.position.sub(state.target).setLength(blocked).add(state.target);
    cameraPulledIn = true;
  }
  // The ground stops it too. Not under the ground (a walker in a tunnel or a station has its
  // own bore to keep the camera in: constrainWorldCamera), and not from the air.
  cameraOnGround = false;
  if (state.dist <= ORBIT_BLOCK_REACH_M && typeof groundLiftAt === "function") {
    const floor = groundLiftAt(camera.position.x, camera.position.z);
    const under = groundLiftAt(state.target.x, state.target.z);
    if (Number.isFinite(floor) && !(state.target.y < under - 1) && camera.position.y < floor + ORBIT_GROUND_CLEAR_M) {
      camera.position.y = floor + ORBIT_GROUND_CLEAR_M;
      cameraOnGround = true;
    }
  }
  constrainWorldCamera();
  camera.lookAt(state.target);
  if (state.tilt > 0) camera.rotateX(Math.min(state.tilt, ORBIT_MAX_TILT));
  fitViewToAltitude();
}
//: Climbing, the view sees further and the haze lifts: the far plane reaches past the Earth's
//: horizon and the fog draws back with the height, so from on high the Bay -- and then the
//: world -- is seen clear rather than fading to grey. At the street both are as they were.
function fitViewToAltitude() {
  if (META) return;   // the headset's short view and its haze (META_VIEW) are fixed
  const h = Math.max(0, camera.position.y);
  const far = Math.max(FAR_M, Math.sqrt(2 * EARTH_RADIUS_M * h + h * h) * 1.15 + h);
  // Pulled in against a wall, the near plane comes in with the camera, so it does not cut into it.
  const near = state.firstPerson || cameraPulledIn ? 0.12 : Math.max(0.5, Math.min(h * 0.002, 4000));
  if (Math.abs(far - camera.far) > far * 0.02 || Math.abs(near - camera.near) > near * 0.05) {
    camera.far = far; camera.near = near; camera.updateProjectionMatrix();
  }
  if (scene.fog) { scene.fog.near = 2400 + h * 4; scene.fog.far = FAR_M * 0.96 + h * 12; }
}

var worldCameraRay = null;
function constrainWorldCamera() {
  // Orbiting a walker inside a bore must not put the eye through its roof/wall.
  const feet=typeof walkerFeetY === "function" ? walkerFeetY() : null;
  const at=typeof avatar !== "undefined" && !state.explore
    ? occupiedTunnelAt(avatar.position.x,avatar.position.z,feet) : null;
  if(at?.bore.group) {
    if(!worldCameraRay)worldCameraRay=new THREE.Raycaster();
    const origin=new THREE.Vector3(avatar.position.x,at.y+Math.min(1.7,at.clearance-.3),avatar.position.z);
    const direction=camera.position.clone().sub(origin),length=direction.length();
    if(length>.05) {
      direction.normalize();worldCameraRay.set(origin,direction);worldCameraRay.far=length;
      const solids=at.bore.group.children.filter(o=>["tunnel","tunnel_portal"].includes(o.userData.surface));
      at.bore.group.updateMatrixWorld(true);
      const hit=worldCameraRay.intersectObjects(solids,true)[0];
      if(hit)camera.position.copy(origin).addScaledVector(direction,Math.max(.05,hit.distance-.25));
    }
    const cameraBore=occupiedTunnelAt(camera.position.x,camera.position.z,at.y);
    if(cameraBore && camera.position.y>=cameraBore.floor+.15
        && camera.position.y<cameraBore.floor+cameraBore.clearance) return;
  }
  // The free/explore camera can look over roofs, but never underneath terrain.
  const cameraCut=typeof occupiedApproachAt === "function" && !state.explore
    ? occupiedApproachAt(camera.position.x,camera.position.z,feet) : null;
  if(cameraCut && camera.position.y>=cameraCut.y+.35 && camera.position.y<cameraCut.y+3.2)return;
  let surface=groundLiftAt(camera.position.x,camera.position.z);
  if(typeof NATURE!=="undefined" && NATURE && outsideTerrainGrid(camera.position.x,camera.position.z))
    surface=natureWorld?.groundAt(camera.position.x,camera.position.z) ?? surface-earthDrop(camera.position.x,camera.position.z);
  if(typeof outsideTerrainGrid === "function" && outsideTerrainGrid(camera.position.x,camera.position.z)) {
    const drawn=drawnGroundAt(camera.position.x,camera.position.z);
    if(Number.isFinite(drawn))surface=Math.max(surface,drawn);
  }
  const minimum=surface+.35;
  if(Number.isFinite(minimum))camera.position.y=Math.max(camera.position.y,minimum);
}
//: The orbit view stands this far short of a wall it would otherwise go through; and no building is
//: taller than ORBIT_TALLEST_M over what the view looks at (the line is not followed above it).
var ORBIT_WALL_GAP_M = 0.45;
var ORBIT_TALLEST_M = 340;
var ORBIT_BLOCK_REACH_M = 300;
var cameraPulledIn = false;
//: The building at (x, z) in this page's metres -- this page's own or the region's drawn over it --
//: and the height of its roof, or null.
function orbitBuildingTop(x, z) {
  const g = typeof guestUnder === "function" ? guestUnder(x, z) : null;
  if (g?.api.buildingTopAt) {
    const hit = g.api.buildingTopAt(...hostToGuest(g, x, z));
    return hit ? { way: hit.way, top: hit.top + g.oy } : null;
  }
  return buildingTopAt(x, z);
}
//: The building at (x, z) in this world's own metres, with its roof height over the ground.
function buildingTopAt(x, z) {
  let way = null;
  try { way = buildingAt(x, z); } catch { return null; }   // the footprints are not indexed yet
  if (!way) return null;
  // The roof as drawn, where it has been (a building on a slope is drawn taller than its
  // measured height from its low corner: groundRiseFor).
  return { way, top: (way._treeClipRoof ?? groundLiftAt(x, z) + (Number(way.height_m) || 10.5)) + 0.3 };
}
//: How far from ``target`` the orbit camera may stand on the line out to ``position`` before it
//: would be inside a building below its roof (less ORBIT_WALL_GAP_M, and clear of the wall to
//: either side), or null when nothing is in the way. The building the target is in (the walker
//: indoors) is not in the way: that view is the walker's own.
function orbitBlockedAt(target, position) {
  const dx = position.x - target.x, dy = position.y - target.y, dz = position.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 0.6)) return null;
  const home = orbitBuildingTop(target.x, target.z)?.way || null;
  const ux = dx / length, uy = dy / length, uz = dz / length;
  const ceiling = target.y + ORBIT_TALLEST_M;
  const inWall = (x, y, z) => { const hit = orbitBuildingTop(x, z); return Boolean(hit && hit.way !== home && y < hit.top); };
  const side = (s) => [target.x + ux * s, target.y + uy * s, target.z + uz * s];
  // Room to either side: a view along a wall at a slant would otherwise have it in its near plane.
  const crowded = (s) => {
    const [x, y, z] = side(s);
    return [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]].some(([ox, oz]) => inWall(x + ox, y, z + oz));
  };
  const backOff = (stop) => {
    while (stop > 0.3 && crowded(stop)) stop -= 0.25;
    return Math.max(0.3, stop);
  };
  for (let t = 0.3; ; t += t < 40 ? 0.3 : t < 150 ? 0.8 : 2) {
    const at = Math.min(t, length), y = target.y + uy * at;
    if (y > ceiling && uy >= 0) return null;
    // Back from the wall along the line, then until the camera has room to either side.
    if (inWall(target.x + ux * at, y, target.z + uz * at)) return backOff(Math.max(0.3, at - ORBIT_WALL_GAP_M));
    if (at >= length) return crowded(length) ? backOff(length) : null;
  }
}
function setFirstPerson(on) {
  if (on && state.explore) setExplore(false);
  state.firstPerson = on;
  if (!on) state.autoFirstPerson = false;
  if (typeof avatar !== "undefined") {
    // The walker is not drawn from inside its own head.
    avatar.visible = !on && !ATTACH; // Only the host owns the visible player.
    if (on) state.target.copy(avatar.position);
  }
  const button = document.getElementById("firstperson");
  if (button) button.setAttribute("aria-pressed", on ? "true" : "false");
  // At eye height the kerb is half a metre away; the orbit camera's near plane would cut it.
  camera.near = on ? 0.12 : 0.5;
  // Leaving the walker's eyes puts the zoom back; entering starts at 1x.
  state.zoom = 1;
  camera.fov = FIRST_PERSON_FOV;
  camera.updateProjectionMatrix();
  placeCamera();
}

let dragging = false, last = [0, 0];
canvas.addEventListener("pointerdown", (e) => {
  // Looking around while walking: the arrows held keep walking while the view is dragged round,
  // and the walk turns with the view. (A key whose release was lost is cleared on blur.)
  dragging = true;
  last = [e.clientX, e.clientY];
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging || touches.size > 1) return;
  const dx = e.clientX - last[0], dy = e.clientY - last[1];
  state.yaw -= dx * 0.006;
  if (state.firstPerson) {
    state.look = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, state.look - dy * 0.004));
  } else {
    // The drag stops at the lowest pitch, and at the ground: a drag on down holds the view
    // where it is rather than tilting it up (ORBIT_MIN_PITCH), and does not wind the pitch on
    // under the ground either, so dragging back up moves the view at once.
    const v = state.pitch + dy * 0.004;
    if (!(cameraOnGround && v < state.pitch)) state.pitch = Math.max(ORBIT_MIN_PITCH, Math.min(1.28, v));
    state.tilt = 0;
  }
  last = [e.clientX, e.clientY];
  placeCamera();
});
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointercancel", () => { dragging = false; held.clear(); });
canvas.addEventListener("lostpointercapture", () => { dragging = false; });
//: How far a wheel notch zooms (about a quarter of the distance for a notch of 100), and a
//: trackpad's pinch, whose steps are a few units each, faster still; a two-finger pinch on a touch
//: screen zooms by the change in the fingers' spread, raised to TOUCH_PINCH_POWER.
const WHEEL_ZOOM_PER_UNIT = 0.0025;
const TRACKPAD_PINCH_PER_UNIT = 0.012;
const TOUCH_PINCH_POWER = 1.6;
//: Up close a notch moves less: at this distance and beyond, a notch is its full quarter; nearer,
//: its share falls with the square root of the distance, to a fifth of it at the street.
const ZOOM_FULL_SPEED_M = 400;
const ZOOM_NEAR_SENSITIVITY = 0.2;
function zoomSensitivity(dist) {
  return Math.max(ZOOM_NEAR_SENSITIVITY, Math.min(1, Math.sqrt(dist / ZOOM_FULL_SPEED_M)));
}
// Zoom by a factor on the distance (> 1 out); in the walker's eyes, by field of view, 1x to 2x.
function zoomBy(factor) {
  // The headset's follow view: in as far as the walker's eyes, out no further than it starts.
  // (Guarded: the tests run this on its own.)
  if (typeof META !== "undefined" && META) {
    if (state.firstPerson) {
      if (factor > 1 && !state.indoors) { setFirstPerson(false); state.dist = META_FOLLOW_NEAREST_M; placeCamera(); }
      return;
    }
    state.dist = Math.min(metaFollowDistance(), state.dist * factor);
    if (state.dist < META_FOLLOW_NEAREST_M) { setFirstPerson(true); return; }
    placeCamera();
    return;
  }
  if (state.firstPerson) {
    state.zoom = Math.max(1, Math.min(FIRST_PERSON_MAX_ZOOM, (state.zoom || 1) / factor));
    camera.fov = FIRST_PERSON_FOV / state.zoom;
    camera.updateProjectionMatrix();
    return;
  }
  factor **= zoomSensitivity(state.dist);
  // Past the Bay each turn of the wheel covers more: a few turns from the region to the globe.
  if (state.dist > 30000) factor **= 1.9;
  state.dist = Math.max(8, Math.min(MAX_ORBIT_DIST_M, state.dist * factor));
  placeCamera();
  if (typeof autoExploreByZoom === "function") autoExploreByZoom();
}
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  // A trackpad pinch arrives as a wheel with ctrlKey; lines and pages are scaled to pixels.
  const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1;
  zoomBy(Math.exp(e.deltaY * unit * (e.ctrlKey ? TRACKPAD_PINCH_PER_UNIT : WHEEL_ZOOM_PER_UNIT)));
}, { passive: false });
const touches = new Map();
let pinchSpread = 0;
function touchSpread() {
  const [a, b] = [...touches.values()];
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2) { pinchSpread = touchSpread(); dragging = false; }
});
canvas.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size !== 2) return;
  const spread = touchSpread();
  if (pinchSpread > 0 && spread > 0) zoomBy((pinchSpread / spread) ** TOUCH_PINCH_POWER);
  pinchSpread = spread;
});
for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (e) => { touches.delete(e.pointerId); pinchSpread = 0; });
}
document.getElementById("firstperson").addEventListener("click", () => {
  setFirstPerson(!state.firstPerson);
});
document.getElementById("reset").addEventListener("click", () => {
  Object.assign(state, OVERVIEW);
  if (typeof avatar !== "undefined") {
    // Back to where you are, when the device knows and you are in this region; else the middle.
    const at = gps.target;
    avatar.position.set(at ? at.x : 0, AVATAR_STAND_Y + (at ? walkerGroundAt(at.x, at.z) : 0), at ? at.z : 0);
    state.target.copy(avatar.position);
    gps.follow = true;
    GPS_LEASH.on = true;
  }
  setFirstPerson(false);
});

