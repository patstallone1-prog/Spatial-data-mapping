// ---- the dropped kerb at every garage ----
//
// A driveway is not a ramp laid on the pavement: it is the pavement itself, let down to the
// gutter across the width of the door and flared a little either side, so a car rolls up off
// the street. The apron slab drew that ramp -- and drew it inside the solid pavement, whose
// kerb ran straight past every garage at full height with the slope buried under it. The
// pavement and its kerb tile are lowered here, on their own vertices, along the city's 14,130
// dropped kerbs: the kerb edge to the gutter, rising to footway level at the property line,
// flared over APRON_FLARE_M beyond the door on each side.
//: Longest triangle edge left over a driveway's drop, so the ramp has vertices to bend on.
const DROP_MAX_EDGE_M = 0.9;
//: Where a car may not stand at the kerb, as the street is drawn: every driveway let down
//: (filled here) and every stretch of painted kerb (addOfficialCurbZoneBands). The living city
//: parks only where neither is (kerbParking).
const KERB_RULES = { drops: [], paint: [], paintGrid: null, dropGrid: null };
//: A generator: the build runs it between frames (dropKerbsAtDrivewaysSteps). The arrays of a
//: plain attribute are read directly -- getX and getComponent a value at a time were most of its
//: half second a window (2026-11-05); they return the same numbers.
function* subdivideNearDropsSteps(geometry, grid, cell) {
  const source = geometry.getAttribute("position");
  // Quick test first: does any triangle of this mesh reach into a driveway at all?
  const index = geometry.getIndex();
  const triangles = index ? index.count / 3 : source.count / 3;
  const plain = (a) => !a.isInterleavedBufferAttribute && !a.normalized;
  const I = index && plain(index) ? index.array : null;
  const vertexOf = I ? (t, k) => I[t * 3 + k] : (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const SP = plain(source) && source.itemSize === 3 ? source.array : null;
  const dropsFor = (minX, maxX, minZ, maxZ) => {
    const found = new Set();
    for (let ix = Math.floor(minX / cell); ix <= Math.floor(maxX / cell); ix += 1) {
      for (let iz = Math.floor(minZ / cell); iz <= Math.floor(maxZ / cell); iz += 1) {
        for (const d of grid.get(`${ix}:${iz}`) || []) {
          if (d.maxX >= minX && d.minX <= maxX && d.maxZ >= minZ && d.minZ <= maxZ) found.add(d);
        }
      }
    }
    return found.size;
  };
  const near = new Uint8Array(triangles);
  let any = false;
  for (let t = 0; t < triangles; t += 1) {
    if ((t & 8191) === 8191) yield;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, high = false;
    for (let k = 0; k < 3; k += 1) {
      const v = vertexOf(t, k);
      const x = SP ? SP[v * 3] : source.getX(v), z = SP ? SP[v * 3 + 2] : source.getZ(v);
      if ((SP ? SP[v * 3 + 1] : source.getY(v)) >= ROAD_TOP_M + 0.03) high = true;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (!high || (maxX - minX <= DROP_MAX_EDGE_M && maxZ - minZ <= DROP_MAX_EDGE_M)) continue;
    if (dropsFor(minX, maxX, minZ, maxZ)) { near[t] = 1; any = true; }
  }
  if (!any) return geometry;
  const names = Object.keys(geometry.attributes);
  const sizes = names.map((n) => geometry.getAttribute(n).itemSize);
  const out = names.map(() => []);
  const read = (v) => names.map((n, a) => {
    const attr = geometry.getAttribute(n), row = [];
    for (let c = 0; c < sizes[a]; c += 1) row.push(attr.getComponent(v, c));
    return row;
  });
  const write = (p) => p.forEach((row, a) => out[a].push(...row));
  const mid = (p, q) => p.map((row, a) => row.map((value, c) => (value + q[a][c]) / 2));
  const span = (p, q) => Math.hypot(p[0][0] - q[0][0], p[0][1] - q[0][1], p[0][2] - q[0][2]);
  const split = (p, q, r, depth) => {
    const e0 = span(p, q), e1 = span(q, r), e2 = span(r, p);
    const longest = Math.max(e0, e1, e2);
    if (longest <= DROP_MAX_EDGE_M || depth > 14) { write(p); write(q); write(r); return; }
    // Halve the longest edge, keeping the winding.
    if (longest === e0) { const m = mid(p, q); split(p, m, r, depth + 1); split(m, q, r, depth + 1); }
    else if (longest === e1) { const m = mid(q, r); split(p, q, m, depth + 1); split(p, m, r, depth + 1); }
    else { const m = mid(r, p); split(p, q, m, depth + 1); split(m, q, r, depth + 1); }
  };
  const attrs = names.map((n) => geometry.getAttribute(n));
  const raw = attrs.map((a) => (plain(a) ? a.array : null));
  for (let t = 0; t < triangles; t += 1) {
    if ((t & 4095) === 4095) yield;
    if (near[t]) { split(read(vertexOf(t, 0)), read(vertexOf(t, 1)), read(vertexOf(t, 2)), 0); continue; }
    for (let k = 0; k < 3; k += 1) {
      const v = vertexOf(t, k);
      for (let a = 0; a < attrs.length; a += 1) {
        const A = raw[a], n = sizes[a], dst = out[a];
        if (A) for (let c = 0; c < n; c += 1) dst.push(A[v * n + c]);
        else for (let c = 0; c < n; c += 1) dst.push(attrs[a].getComponent(v, c));
      }
    }
  }
  const finer = new THREE.BufferGeometry();
  names.forEach((n, a) => {
    const attr = geometry.getAttribute(n);
    finer.setAttribute(n, new THREE.BufferAttribute(new attr.array.constructor(out[a]), sizes[a],
                                                    attr.normalized));
  });
  finer.userData = { ...geometry.userData };
  return finer;
}
//: How far out from a photographed garage its kerb is looked for.
const PHOTO_KERB_REACH_M = 25;
const photoDropStats = { cut: 0, noKerb: 0 };
//: The dropped kerb in front of a photographed garage: walked straight out from the door until
//: the kerb this model drew, facing back at the door. The ramp runs from the gutter up to the
//: footway over the pavement's width, flared either side (the drop below), so a car rolls up it.
function photoKerbDrop(g) {
  const [ax, ay] = xy(g.a[0], g.a[1]), [bx, by] = xy(g.b[0], g.b[1]);
  const gx = ax + (bx - ax) * g.t, gz = -(ay + (by - ay) * g.t);
  const bearing = (g.n || 0) * Math.PI / 180;
  const ox = Math.sin(bearing), oz = -Math.cos(bearing);
  for (let s = 0.5; s <= PHOTO_KERB_REACH_M; s += 0.5) {
    const kerb = nearestKerbAt(gx + ox * s, gz + oz * s, 1.0);
    // The kerb's normal points out of the road, back at the door.
    if (!kerb || kerb.nx * ox + kerb.nz * oz > -0.7) continue;
    const walk = Math.hypot(kerb.x - gx, kerb.z - gz);
    return { x: kerb.x, z: kerb.z, ox: kerb.nx, oz: kerb.nz, half: Math.max(1.1, (g.w || 2.6) / 2),
      depth: Math.max(1.5, Math.min(walk - 0.2, 3.0)), photo: true };
  }
  photoDropStats.noKerb += 1;
  return null;
}
function* dropKerbsAtDrivewaysSteps(ways) {
  const cell = 6.0;
  const grid = new Map();
  let openings = 0;
  let seen = 0;
  for (const way of ways) {
    if ((++seen & 255) === 0) yield;
    // Every cut the city measured, whichever house's door it turned out to be.
    const cuts = way.kerb_cuts || way.garages;
    if (way.kind !== "building" || !cuts) continue;
    for (const opening of cuts) {
      if (!opening.kp || opening.on === undefined) continue;
      const [kx, ky] = xy(opening.kp[0], opening.kp[1]);
      const bearing = opening.on * Math.PI / 180;
      const drop = {
        x: kx, z: -ky, ox: Math.sin(bearing), oz: -Math.cos(bearing),
        half: Math.max(1.1, (opening.w || 3.5) / 2), depth: Math.max(1.5, Math.min(opening.walk || 3.0, 5.0)),
      };
      // The city's kerb point is on the city's kerb line, which runs a metre or two from this
      // model's kerb on many blocks. The drop is made at the kerb that is drawn: the nearest
      // one, going inward from it the way the pavement does. Where none is near, the record
      // is of a driveway this model's kerb does not run past.
      const kerb = nearestKerbAt(drop.x, drop.z, 4.0);
      if (!kerb) continue;
      drop.x = kerb.x;
      drop.z = kerb.z;
      drop.ox = kerb.nx;
      drop.oz = kerb.nz;
      const reach = drop.half + APRON_FLARE_M + drop.depth;
      drop.minX = drop.x - reach; drop.maxX = drop.x + reach;
      drop.minZ = drop.z - reach; drop.maxZ = drop.z + reach;
      KERB_RULES.drops.push(drop);
      for (let ix = Math.floor((drop.x - reach) / cell); ix <= Math.floor((drop.x + reach) / cell); ix += 1) {
        for (let iz = Math.floor((drop.z - reach) / cell); iz <= Math.floor((drop.z + reach) / cell); iz += 1) {
          const key = `${ix}:${iz}`;
          let bucket = grid.get(key);
          if (!bucket) grid.set(key, bucket = []);
          bucket.push(drop);
        }
      }
      openings += 1;
    }
    // And a drop in front of every garage the photograph is sure of, cut or no cut on record.
    for (const g of way.garages || []) {
      if (!g.photo || !PHOTO_GARAGE_CERTAINTY.has(g.certainty)) continue;
      const drop = photoKerbDrop(g);
      if (!drop) continue;
      const reach = drop.half + APRON_FLARE_M + drop.depth;
      drop.minX = drop.x - reach; drop.maxX = drop.x + reach;
      drop.minZ = drop.z - reach; drop.maxZ = drop.z + reach;
      KERB_RULES.drops.push(drop);
      for (let ix = Math.floor(drop.minX / cell); ix <= Math.floor(drop.maxX / cell); ix += 1) {
        for (let iz = Math.floor(drop.minZ / cell); iz <= Math.floor(drop.maxZ / cell); iz += 1) {
          const key = `${ix}:${iz}`;
          let bucket = grid.get(key);
          if (!bucket) grid.set(key, bucket = []);
          bucket.push(drop);
        }
      }
      photoDropStats.cut += 1;
      openings += 1;
    }
  }
  if (!openings) return 0;
  const gutter = ROAD_TOP_M + 0.002;
  let lowered = 0;
  const dropped = [];
  groups.streets.traverse((o) => { if (o.isMesh && ["walk", "walk_narrow", "kerb"].includes(o.userData.surface)) dropped.push(o); });
  for (const o of dropped) {
    // The kerb and the pavement carry a vertex every few metres along the street. Lowering only
    // the ones inside a driveway let the drop run on, as one long slope, to the next vertex
    // outside it -- a diagonal slice out of the kerb metres long. The triangles over a driveway
    // are split first, so the drop is made exactly where the driveway is and nowhere else.
    const finer = yield* subdivideNearDropsSteps(o.geometry, grid, cell);
    if (finer !== o.geometry) { o.geometry.dispose(); o.geometry = finer; }
    const pos = o.geometry.getAttribute("position");
    let touched = false;
    for (let i = 0; i < pos.count; i += 1) {
      if ((i & 8191) === 8191) yield;
      const y = pos.getY(i);
      if (y < ROAD_TOP_M + 0.03) continue;                 // a face's foot, already at the gutter
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const bucket = grid.get(`${Math.floor(x / cell)}:${Math.floor(z / cell)}`);
      if (!bucket) continue;
      let lowest = y;
      for (const d of bucket) {
        const dx = x - d.x;
        const dz = z - d.z;
        const inward = dx * d.ox + dz * d.oz;
        const across = Math.abs(-dx * d.oz + dz * d.ox);
        if (inward < -0.35 || inward > d.depth || across > d.half + APRON_FLARE_M) continue;
        // Up the ramp from the gutter to footway level at the property line, and out across
        // the flare from full drop to none.
        const rise = Math.max(0, Math.min(1, inward / d.depth));
        const flare = across <= d.half ? 1 : 1 - (across - d.half) / APRON_FLARE_M;
        const ramp = gutter + (y - gutter) * rise;
        const target = y - (y - ramp) * flare;
        if (target < lowest) lowest = target;
      }
      if (lowest < y - 1e-4) {
        pos.setY(i, lowest);
        touched = true;
        lowered += 1;
      }
    }
    if (touched) {
      pos.needsUpdate = true;
      o.geometry.computeVertexNormals();
      o.geometry.computeBoundingSphere();
    }
    yield;
  }
  return lowered;
}
// Before the lift, while every height is still the flat model's: the drop reads the gutter as
// ROAD_TOP_M, and run after the lift it let every kerb and pavement near a driveway on a hill
// down to sea level -- a crater at each garage, eighty metres deep on Nob Hill.
if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame();   // between whole steps too (a hop's longest task)
const kerbVerticesDropped = await runStepsSliced(dropKerbsAtDrivewaysSteps(DATA.ways));
Object.assign(garageStats, { photoKerbCuts: photoDropStats.cut, photoKerbMissing: photoDropStats.noKerb });
// Everything at ground level stands on the ground the lidar measured (the tunnels carry their own).
await liftOntoGroundAsync(groups.streets, "Standing the streets on the ground");
installTunnelVoidCuts(groups.streets,true);
installTunnelVoidCuts(groups.mapped3d,true);
for(const tile of terrainTiles)installTunnelVoidCuts(tile);
// The survey layers that were built in the flat model's frame, beside the streets, stand on
// the same ground. Left out of the lift, the measured-kerb bands lay at the flat model's
// height while the city around them had been raised onto the hill: 2,244 ribbons at y = 0.24
// under a Sunset that the lidar puts at 79 m, which is 74 m of solid ground between the
// viewer and the layer. Nobody had seen it because the layer is off until asked for -- which
// is exactly why it was worth asking.
for (const [name, label] of [["kerbs", "Standing the measured kerbs on the ground"],
                             ["official", "Standing the city's records on the ground"],
                             ["chunks", "Standing the survey chunks on the ground"]]) {
  if (groups[name] && groups[name].children.length) {
    await liftOntoGroundAsync(groups[name], label);
  }
}
await settleOntoPavement();
// The tree pits come down with the ground cover, before these streets or after them: set into the
// pavement once both are (PIT_SETTLE_RULE).
groundReady.then((ok) => ok === false ? 0 : settleOnto(PIT_SETTLE_RULE)).then((n) => {
  window.kerbsideReady = Object.assign(window.kerbsideReady || {}, { treePits: n });
}).catch((error) => console.warn("kerbside: tree pits not set into the pavement", error));
await runStepsSliced(cellFineSurfacesSteps(groups.streets));
clipDetailWorld();
groundReady.then(()=>clipDetailWorld());
// The lowered houses' floors cut through whatever else is laid on the hill (INDOOR_CUT_SURFACES).
installIndoorGroundCut(groups.streets);
groundReady.then(() => installIndoorGroundCut(groups.ground));
//: For anything driving the page -- the audit's photographs, a test -- the moment the streets
//: are finished; the ground cover sets its own flag when it is down (see the ground fetch).
window.kerbsideReady = Object.assign(window.kerbsideReady || {}, { streets: true });
// Every material's shader compiled now, in the background where the driver can (parallel
// compile), rather than the first frame each thing comes into view -- a stall of up to a
// second, every time, the first time a house, a sign or a tree kind appeared.
if (renderer.compileAsync) renderer.compileAsync(scene, camera).catch(() => {});

const districtColors = [0x1d4d58, 0x355038, 0x4a3e61, 0x5a4930, 0x533749, 0x29475f];
DATA.districts.forEach((d, i) => {
  const [x1, y1] = xy(d.west, d.north);
  const [x2, y2] = xy(d.east, d.south);
  // A district is a label for a part of the city, not a thing standing in it. This used to be
  // a six-metre-tall translucent box covering a whole neighbourhood, and it was eating the
  // bottoms of buildings: a transparent mesh still writes depth by default, and the transparent
  // queue is sorted by object rather than by fragment, so wherever a district sorted in front
  // of a building the building's lowest six metres failed the depth test and vanished. What was
  // left was the top of a tower hanging in the air with nothing under it -- which looked like a
  // geometry bug in the buildings and was nothing of the kind.
  //
  // It is now a tint on the ground, under the roadway, writing no depth at all.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.abs(x2 - x1), Math.abs(y1 - y2)),
    new THREE.MeshBasicMaterial({
      color: districtColors[i % districtColors.length],
      // Faint. As a six-metre box at 0.2 this was a tinted volume you looked through; as a
      // ground plane the same opacity is a sheet of colour over a dark background, and the
      // block interiors came out mint green.
      transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x1 + x2) / 2, -0.08, -(y1 + y2) / 2);
  groups.districts.add(mesh);
  labelAt(d.name, (d.west + d.east) / 2, (d.south + d.north) / 2, 54, groups.districts, "#ffffff", "district");
});

const FURNITURE_POST_H_M = 2.7;
const FURNITURE_PANEL_BOTTOM_M = 2.05;
const MUNI_SHELTER_LENGTH_M = 4.0;
const MUNI_SHELTER_DEPTH_M = 1.45;
const MUNI_SHELTER_HEIGHT_M = 2.6;

//: How far a published curb-policy line may sit from this model's own kerb and still be taken to
//: describe it. Beyond this the line belongs to a street this model does not draw.
const CURB_SNAP_REACH_M = 14.0;
//: A jump further than this between consecutive snapped points means the policy line has left
//: this kerb for another one, not that it has bent.
const CURB_RUN_BREAK_M = 8.0;
//: Sampling step along a policy line before snapping. Finer than the kerb's own curvature.
const CURB_SAMPLE_M = 1.5;
//: The paint on a kerb is the top of the kerb and its face. This is the top.
const CURB_BAND_W_M = 0.16;

//: A kerb running more than this away from the policy line's own direction is a different kerb.
const CURB_ALIGN_DEG = 38.0;

//: Whether a car may stand at the kerb point (x, z), along (ax, az), ``halfLen`` either way:
//: null where it may, else why not -- a driveway, or paint: red (no stopping) and blue
//: (disabled) never; yellow (commercial loading) only a delivery vehicle; white (passenger
//: loading) only a fare or a ride-hail stop; green (short-term) anyone. ``kind``: "delivery",
//: "passenger" or null.
function kerbParking(x, z, ax, az, halfLen = 2.4, kind = null) {
  if (!KERB_RULES.dropGrid || KERB_RULES.dropGrid.count !== KERB_RULES.drops.length) {
    const grid = new Map();
    for (const d of KERB_RULES.drops)
      for (let ix = Math.floor(d.minX / 16); ix <= Math.floor(d.maxX / 16); ix += 1)
        for (let iz = Math.floor(d.minZ / 16); iz <= Math.floor(d.maxZ / 16); iz += 1) {
          const k = ix * 1048576 + iz;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(d);
        }
    grid.count = KERB_RULES.drops.length;
    KERB_RULES.dropGrid = grid;
  }
  const near = new Set();
  for (let ix = Math.floor((x - halfLen) / 16); ix <= Math.floor((x + halfLen) / 16); ix += 1)
    for (let iz = Math.floor((z - halfLen) / 16); iz <= Math.floor((z + halfLen) / 16); iz += 1)
      for (const d of KERB_RULES.dropGrid.get(ix * 1048576 + iz) || []) near.add(d);
  for (const d of near) {
    if (x < d.minX - halfLen || x > d.maxX + halfLen || z < d.minZ - halfLen || z > d.maxZ + halfLen) continue;
    const along = (d.x - x) * ax + (d.z - z) * az, across = Math.abs((d.x - x) * az - (d.z - z) * ax);
    if (Math.abs(along) < halfLen + d.half + 0.3 && across < 3) return "driveway";
  }
  if (!KERB_RULES.paintGrid) {
    KERB_RULES.paintGrid = new Map();
    for (const s of KERB_RULES.paint) {
      for (let ix = Math.floor(Math.min(s[0], s[2]) / 8); ix <= Math.floor(Math.max(s[0], s[2]) / 8); ix += 1)
        for (let iz = Math.floor(Math.min(s[1], s[3]) / 8); iz <= Math.floor(Math.max(s[1], s[3]) / 8); iz += 1) {
          const k = ix * 1048576 + iz;
          if (!KERB_RULES.paintGrid.has(k)) KERB_RULES.paintGrid.set(k, []);
          KERB_RULES.paintGrid.get(k).push(s);
        }
    }
  }
  for (let t = -halfLen; t <= halfLen + 1e-6; t += 1) {
    const px = x + ax * t, pz = z + az * t, list = KERB_RULES.paintGrid.get(Math.floor(px / 8) * 1048576 + Math.floor(pz / 8)) || [];
    for (const [sx, sz, ex, ez, colour] of list) {
      const ux = ex - sx, uz = ez - sz, L2 = ux * ux + uz * uz || 1, k = Math.max(0, Math.min(1, ((px - sx) * ux + (pz - sz) * uz) / L2));
      if (Math.hypot(px - sx - ux * k, pz - sz - uz * k) > 1.2) continue;
      if (colour === "red" || colour === "blue") return `${colour} kerb`;
      if (colour === "yellow" && kind !== "delivery") return "yellow kerb (loading)";
      if (colour === "white" && kind !== "passenger") return "white kerb (passengers)";
    }
  }
  return null;
}
function nearestKerbAt(x, z, reach = CURB_SNAP_REACH_M, alongX = null, alongZ = null) {
  // The closest point on a carriageway edge, and the way out of the road from there.
  //
  // SFMTA digitises its curb policy against its own centrelines. This model derives its kerbs
  // from measured curb geometry clamped to the room between neighbouring streets. The two are
  // close and never equal, so a policy line drawn where its own data puts it lands in the middle
  // of the roadway on one block and out on the pavement on the next -- which is exactly what red
  // zones floating in traffic looked like. Snapped to the kerb this model actually drew, it
  // lands on the kerb.
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  const span = Math.max(1, Math.ceil(reach / CARRIAGEWAY_CELL));
  let best = null;
  for (let dx = -span; dx <= span; dx += 1) {
    for (let dz = -span; dz <= span; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half] of bucket) {
        const ux = bx - ax;
        const uz = bz - az;
        const lengthSquared = ux * ux + uz * uz;
        if (lengthSquared < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / lengthSquared));
        const px = ax + ux * t;
        const pz = az + uz * t;
        const ox = x - px;
        const oz = z - pz;
        const away = Math.hypot(ox, oz);
        if (away < 1e-6) continue;                 // on the centreline: no side to be on
        const gap = Math.abs(away - half);
        if (gap > reach || (best && gap >= best.gap)) continue;
        const run = Math.sqrt(lengthSquared);
        // A kerb only describes this policy line if it runs the same way the line does. Without
        // that, consecutive samples near a corner snap alternately to the two streets meeting
        // there and the band comes out as a fan of triangles instead of a strip along one kerb.
        if (alongX !== null) {
          const dot = Math.abs((ux / run) * alongX + (uz / run) * alongZ);
          if (dot < Math.cos((CURB_ALIGN_DEG * Math.PI) / 180)) continue;
        }
        const nx = ox / away;
        const nz = oz / away;
        const kerbX = px + nx * half;
        const kerbZ = pz + nz * half;
        // A kerb is where a roadway stops. Where streets overlap -- an alley meeting an avenue,
        // a tunnel portal under a surface street -- the nearest carriageway edge can be the
        // alley's, and the alley's edge lies in the middle of the avenue. Snapping to it put
        // red zones and transit boxes out in the traffic lanes of Stockton Street. If the
        // candidate is still inside a roadway it is not a kerb, whatever it is nearest to.
        if (insideCarriageway(kerbX, kerbZ, 0.30)) continue;
        best = {
          gap,
          x: kerbX, z: kerbZ,                      // the kerb itself
          nx, nz,                                  // out of the road
          ax: ux / run, az: uz / run,              // along the street
          half,
        };
      }
    }
  }
  return best;
}

function kerbRunsFor(record, maxTurnDeg = null) {
  // A policy record's lines, resampled and snapped onto this model's kerb, broken wherever the
  // snap jumps to a different street.
  //
  // `maxTurnDeg` breaks the run where the kerb turns. A thin band of paint follows a kerb round
  // a corner quite happily, but anything offset far into the road cannot: offset three metres
  // inward, the two sides of a corner converge and cross, and the strip comes out as a fan of
  // wedges with its far edge collapsed to nothing. A bus zone is a straight stretch of kerb in
  // any case -- no bus loads passengers round a corner -- so breaking there is right twice over.
  const runs = [];
  const turnLimit = maxTurnDeg === null ? null : Math.cos((maxTurnDeg * Math.PI) / 180);
  for (const coords of record.lines || []) {
    if (!Array.isArray(coords) || coords.length < 2) continue;
    let run = [];
    const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
    for (let i = 1; i < coords.length; i += 1) {
      const a = coords[i - 1];
      const b = coords[i];
      if (!a || !b) continue;
      const [ax, ay] = xy(a[0], a[1]);
      const [bx, by] = xy(b[0], b[1]);
      const az = -ay;
      const bz = -by;
      const span = Math.hypot(bx - ax, bz - az);
      if (span < 1e-6) continue;
      const lineX = (bx - ax) / span;
      const lineZ = (bz - az) / span;
      const steps = Math.max(1, Math.ceil(span / CURB_SAMPLE_M));
      for (let step = i === 1 ? 0 : 1; step <= steps; step += 1) {
        const t = step / steps;
        const snap = nearestKerbAt(ax + (bx - ax) * t, az + (bz - az) * t,
                                   CURB_SNAP_REACH_M, lineX, lineZ);
        if (!snap) { flush(); continue; }
        const last = run[run.length - 1];
        if (last) {
          // A jump to another kerb, or a reversal of the side we are painting, ends the run.
          const moved = Math.hypot(snap.x - last.x, snap.z - last.z);
          const sameSide = snap.nx * last.nx + snap.nz * last.nz > 0.2;
          const turned = turnLimit !== null
            && snap.nx * last.nx + snap.nz * last.nz < turnLimit;
          if (moved > CURB_RUN_BREAK_M || !sameSide || turned) flush();
        }
        run.push(snap);
      }
    }
    flush();
  }
  return runs;
}

//: A sign point inside the roadway is carried this far onto the pavement from the nearest
//: kerb: a post stands a foot or so back from the kerb face.
const FURNITURE_KERB_SETBACK_M = 0.45;
//: And no further than this. A stop sign is digitised in the middle of the junction it
//: controls, seven metres from any kerb of a fifteen-metre street.
const FURNITURE_SNAP_REACH_M = 12.0;

function nearestGroundOffRoad(x, z, reach) {
  // The nearest point to (x, z) that is on neither a carriageway nor a junction box, by rings
  // of samples outward.
  for (let r = 0.6; r <= reach; r += 0.4) {
    for (let k = 0; k < 16; k += 1) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (insideCarriageway(px, pz, 0.15) || insideJunctionBox(px, pz)) continue;
      const sx = px + Math.cos(a) * FURNITURE_KERB_SETBACK_M;
      const sz = pz + Math.sin(a) * FURNITURE_KERB_SETBACK_M;
      if (buildingAt(sx, sz) || insideCarriageway(sx, sz, 0.15)
          || insideJunctionBox(sx, sz)) continue;
      return [sx, sz];
    }
  }
  return null;
}

function furnitureAnchor(item, reach = FURNITURE_SNAP_REACH_M) {
  if (!item || !item.p || item.p.length < 2) return null;
  let [x, y] = xy(item.p[0], item.p[1]);
  let z = -y;
  if (insideBikeLane(x, z, 0.15) || insideCarriageway(x, z, 0.25)) {
    // SFMTA's sign points are digitised against its centrelines and a good half of them land
    // on the roadway of this model, whose kerbs are a metre or two from where the city's
    // lines put them. They were dropped -- 14,000 of 24,600 signs -- when they are simply
    // on the wrong side of a kerb that is close by. Carried to the nearest kerb and set back
    // from it, a sign stands where a sign stands.
    const kerb = nearestKerbAt(x, z, reach);
    let moved = false;
    if (kerb) {
      const kx = kerb.x + kerb.nx * FURNITURE_KERB_SETBACK_M;
      const kz = kerb.z + kerb.nz * FURNITURE_KERB_SETBACK_M;
      if (!insideCarriageway(kx, kz, 0.1) && !insideJunctionBox(kx, kz)
          && !buildingAt(kx, kz)) { x = kx; z = kz; moved = true; }
    }
    if (!moved) {
      // At a junction the nearest kerb of one street is inside the other, and nearestKerbAt
      // rightly refuses it. The nearest ground that is not roadway is the corner, and that is
      // where a stop sign stands.
      const spot = nearestGroundOffRoad(x, z, reach);
      if (!spot) return null;
      x = spot[0];
      z = spot[1];
    }
  }
  const top = pavementTopAt(x, z);
  // On the hill over a tunnel mouth, on the hill: a sign post at ground level there stood
  // in the middle of the bore.
  const lift = groundLiftAt(x, z);
  return { x, z, y: (top === undefined ? ROAD_TOP_M + KERB_FALLBACK : top) + lift };
}

function furnitureBearing(item, index, anchor = null) {
  // A stated bearing is a measurement and is used as it stands.
  if (Number.isFinite(item.bearing)) return item.bearing * Math.PI / 180;
  // Otherwise it faces the road, because that is what street furniture does. This used to be a
  // random draw over the full circle: every one of the corridor's 19 shelters, 616 bus stop
  // flags and 375 bearingless stop signs pointed somewhere arbitrary, and a shelter with its
  // back to the kerb is not a shelter.
  const spot = anchor || furnitureAnchor(item);
  if (spot) {
    const kerb = nearestKerbAt(spot.x, spot.z);
    // The face looks back across the kerb into the roadway, so its normal is the inward one.
    if (kerb) return Math.atan2(-kerb.nx, -kerb.nz);
  }
  // Nothing near enough to face. Square to the world beats a spin of the wheel.
  return 0;
}

function panelMaterial(color, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide,
    transparent: opacity < 1, opacity,
  });
}

function addInstancedFurniturePanels(records, width, height, color, name, yBottom = FURNITURE_PANEL_BOTTOM_M,
                                      clash = null) {
  const anchors = records.map((item, index) => ({ item, index, anchor: furnitureAnchor(item) }))
    .filter((row) => row.anchor);
  // A panel is a sign too: it is placed against the plates already standing, lowered under one
  // it would meet ("lower") or left out ("skip"), never drawn through it.
  if (clash) {
    for (const row of anchors) {
      const yaw = furnitureBearing(row.item, row.index, row.anchor);
      const top = row.anchor.y + yBottom + height;
      let rect = null;
      if (clash === "lower") rect = placePlate(null, row.anchor.x, row.anchor.z, yaw, width, height, top, row.anchor.y + PLATE_MIN_BOTTOM_M);
      else {
        const trial = plateRect(null, row.anchor.x, row.anchor.z, yaw, width, top - height, top);
        if (!plateClash(trial)) rect = registerPlate(trial);
      }
      if (!rect) { row.anchor = null; signStats.droppedPanels += 1; continue; }
      row.bottom = rect.bottom - row.anchor.y;
    }
  }
  const kept = anchors.filter((row) => row.anchor);
  anchors.length = 0;
  anchors.push(...kept);
  if (!anchors.length) return 0;
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(width, height),
    panelMaterial(color),
    anchors.length);
  const dummy = new THREE.Object3D();
  anchors.forEach((row, i) => {
    dummy.position.set(row.anchor.x, row.anchor.y + (row.bottom ?? yBottom) + height / 2, row.anchor.z);
    dummy.rotation.set(0, furnitureBearing(row.item, row.index, row.anchor), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.surface = name;
  groups.furniture.add(mesh);
  return anchors.length;
}

function addStreetFurniturePosts(records) {
  const anchors = records.map((item, index) => ({ item, index, anchor: furnitureAnchor(item) }))
    .filter((row) => row.anchor);
  if (!anchors.length) return 0;
  const mesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.026, 0.032, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x9aa1a3, roughness: 0.48, metalness: 0.54 }),
    anchors.length);
  const dummy = new THREE.Object3D();
  anchors.forEach((row, i) => {
    dummy.position.set(row.anchor.x, row.anchor.y + FURNITURE_POST_H_M / 2, row.anchor.z);
    dummy.rotation.set(0, furnitureBearing(row.item, row.index, row.anchor), 0);
    dummy.scale.set(1, FURNITURE_POST_H_M, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  groups.furniture.add(mesh);
  return anchors.length;
}

// Billboard faces are not bus-shelter posters. Keep their physical dimensions,
// support height and individual creative metadata instead of instancing one tiny sign.
const billboardFaces = [];
const billboardTextureCache = new Map();
const billboardFrameMaterial = new THREE.MeshStandardMaterial({color:0x454b4a,roughness:.7,metalness:.5});
function safeBillboardWebsite(value) {
  if(typeof value!=="string" || /[\s\u0000-\u001f\u007f]/.test(value))return null;
  try { const url=new URL(value);return ["https:","http:"].includes(url.protocol)
    && !url.username && !url.password ? url.href : null; } catch {return null;}
}
function billboardSpec(item) {
  const raw=item.display_geometry || {},large=item.ad_kind==="billboard";
  const positive=(value,fallback)=>Number.isFinite(value) && value>0 && value<=200 ? value : fallback;
  const width=positive(raw.width_m,large ? 7.62 : 1.2),height=positive(raw.height_m,large ? 3.66 : 1.8);
  return {width,height,bottom:Number.isFinite(raw.bottom_m) && raw.bottom_m>=0 && raw.bottom_m<=200 ? raw.bottom_m : 2.84,
    sides:raw.sides===2 ? 2 : 1,support:raw.support || "poles",location:raw.location || "ground",
    azimuth:Number.isFinite(raw.azimuth_deg) ? raw.azimuth_deg : null,
    dimensionsBasis:raw.dimensions_basis || "inferred_standard_poster_not_measured",
    heightBasis:raw.height_basis || "inferred_mount_height"};
}
function billboardAnchor(item,spec) {
  if(!Array.isArray(item.p) || !item.p.slice(0,2).every(Number.isFinite))return null;
  const [px,py]=xy(...item.p);let x=px,z=-py,wallYaw=null;
  // A mapped advertising structure stays at its mapped site, not snapped into
  // the sidewalk by the street-sign anchor correction.
  if(spec.support.includes("wall")) {
    let best=9;
    for(const entry of footprintById.values()) {
      if(x<entry.minX-3 || x>entry.maxX+3 || z<entry.minZ-3 || z>entry.maxZ+3)continue;
      for(let i=1;i<entry.local.length;i++) {
        const a=entry.local[i-1],b=entry.local[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.1)continue;
        const t=Math.max(0,Math.min(1,((px-a[0])*dx+(-py-a[1])*dz)/(len*len)));
        const qx=a[0]+t*dx,qz=a[1]+t*dz,d=(px-qx)**2+(-py-qz)**2;if(d>=best)continue;
        let nx=-dz/len,nz=dx/len;if(insideFootprint(entry,qx+nx*.2,qz+nz*.2)){nx=-nx;nz=-nz;}
        best=d;x=qx+nx*.13;z=qz+nz*.13;wallYaw=Math.atan2(nx,nz);
      }
    }
  }
  let base=groundLiftAt(x,z)+(pavementTopAt(x,z) ?? ROAD_TOP_M);
  if((spec.location==="roof" || spec.support.includes("roof")) && spec.heightBasis==="inferred_mount_height") {
    const building=buildingAt(x,z);if(building)base+=Number(building.height_m)||0;
  }
  return {x,z,y:base,wallYaw};
}
function billboardImagePlacement(iw,ih,width,height,fit="contain") {
  const scale=(fit==="cover" ? Math.max : Math.min)(width/iw,height/ih);
  return [(width-iw*scale)/2,(height-ih*scale)/2,iw*scale,ih*scale];
}
function billboardTexture(creative,width,height) {
  if(!creative?.approved || !creative.license || !creative.sha256
    || !/^billboards\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|svg)$/i.test(creative.image || ""))return null;
  const key=`${creative.sha256}:${width/height}:${creative.fit || "contain"}`;
  if(billboardTextureCache.has(key))return billboardTextureCache.get(key);
  const promise=new Promise(resolve=>{
    new THREE.ImageLoader().load(`${sharedAsset(creative.image)}?v=${encodeURIComponent(creative.sha256)}`,image=>{
      const iw=image.naturalWidth || image.width,ih=image.naturalHeight || image.height;
      if(!iw || !ih || iw*ih>16777216){resolve(null);return;}
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(64,Math.min(2048,Math.round(2048*width/height)));
      canvas.height=Math.max(64,Math.min(2048,Math.round(canvas.width*height/width)));
      const context=canvas.getContext("2d");context.fillStyle="#f4f1e8";context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,...billboardImagePlacement(iw,ih,canvas.width,canvas.height,creative.fit));
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
      resolve(texture);
    },undefined,()=>resolve(null));
  });
  billboardTextureCache.set(key,promise);return promise;
}
function addBillboards(records,creatives={}) {
  let rendered=0;
  for(const item of records) {
    const spec=billboardSpec(item),anchor=billboardAnchor(item,spec);if(!anchor)continue;
    const group=new THREE.Group();group.position.set(anchor.x,anchor.y,anchor.z);
    group.rotation.y=spec.azimuth===null ? anchor.wallYaw ?? furnitureBearing({...item,bearing:null},0,anchor)
      : Math.PI-spec.azimuth*Math.PI/180;
    const frame=new THREE.Mesh(new THREE.BoxGeometry(spec.width+.16,spec.height+.16,.16),billboardFrameMaterial);
    frame.position.y=spec.bottom+spec.height/2;group.add(frame);
    if(!/wall|roof/.test(spec.support)) {
      const count=spec.support==="pole" ? 1 : 2;
      for(let i=0;i<count;i++) {
        const post=new THREE.Mesh(new THREE.CylinderGeometry(.12,.16,Math.max(.01,spec.bottom),8),billboardFrameMaterial);
        post.position.set(count===1 ? 0 : (i ? 1 : -1)*spec.width*.27,spec.bottom/2,0);group.add(post);
      }
    }
    const creative=creatives.schema==="kerbside.billboard_creatives/1" ? creatives.boards?.[item.id] : null;
    const source=/^osm:ad_panel:(node|way):(\d+)$/.exec(item.id || "");
    // A board wearing approved artwork links where the artwork says, or nowhere; a bare board
    // links to its operator's site or its map record.
    const href=creative?.approved ? safeBillboardWebsite(creative.href || null)
      : safeBillboardWebsite(item.website) || (source ? `https://www.openstreetmap.org/${source[1]}/${source[2]}` : null);
    const material=new THREE.MeshStandardMaterial({color:0xf4f1e8,roughness:.8,metalness:0,side:THREE.FrontSide});
    let requested=false;
    const loadCreative=()=>{
      if(requested)return;requested=true;
      const map=billboardTexture(creative,spec.width,spec.height);
      if(map)map.then(texture=>{
        if(!texture)return;
        if(!billboardFaces.some(face=>face.parent===group)){texture.dispose();return;}
        material.map=texture;material.color.set(0xffffff);material.needsUpdate=true;
      });
    };
    for(let side=0;side<spec.sides;side++) {
      const face=new THREE.Mesh(new THREE.PlaneGeometry(spec.width,spec.height),material);
      face.position.set(0,spec.bottom+spec.height/2,side ? -.083 : .083);face.rotation.y=side ? Math.PI : 0;
      face.userData={billboard:item,href,creativeLabel:creative?.label || "Mapped billboard; artwork not supplied",
        dimensionsBasis:spec.dimensionsBasis};face.onBeforeRender=loadCreative;
      group.add(face);billboardFaces.push(face);
    }
    group.userData={surface:"furniture:billboard",source:item.source,provenance:item.provenance,
      dimensionsBasis:spec.dimensionsBasis};groups.furniture.add(group);rendered++;
  }
  return rendered;
}
function activateBillboard(raycaster) {
  const visible=face=>{for(let p=face;p;p=p.parent){if(!p.visible)return false;if(p.isScene)return true;}return false;};
  const faces=billboardFaces.concat(activeGuest?.ready ? activeGuest.api.billboardFaces || [] : []);
  const hit=raycaster.intersectObjects(faces.filter(visible),false)[0];if(!hit)return false;
  // Clicking a wall does not activate a board behind it. Picking is performed
  // only on a click, not every animation frame or pointer movement.
  const blockers=raycaster.intersectObjects([groups.mapped3d,groups.ground,groups.furniture,...terrainTiles,
    ...(activeGuest?.ready && activeGuest.root ? [activeGuest.root] : [])],true);
  if(blockers.some(other=>visible(other.object) && other.distance<hit.distance-.03))return false;
  const href=safeBillboardWebsite(hit.object.userData.href);if(!href)return false;
  window.open(href,"_blank","noopener,noreferrer");return true;
}

//: A public bench: the seat, its back, and the two legs under it. Measured off the ones on
//: Market Street and within a few centimetres of every municipal bench in the four cities.
const BENCH_LENGTH_M = 1.8;
const BENCH_DEPTH_M = 0.52;
const BENCH_SEAT_Y_M = 0.44;
const BENCH_SEAT_THICK_M = 0.06;
const BENCH_BACK_H_M = 0.46;
const BENCH_LEG_M = 0.06;
const BENCH_SLATS = 0xa5714a;      // weathered hardwood
const BENCH_FRAME = 0x5c6266;      // painted cast iron

function addBenches(records) {
  // One geometry, one placement each: there are a few hundred to a region and they are
  // identical but for where they stand and which way they face.
  const anchors = records.map((item, index) => ({ item, index, anchor: furnitureAnchor(item) }))
    // A bench somebody has measured is drawn as measured (renderWorldMeshes); the catalogue
    // bench is only the fallback for the ones nobody has.
    .filter((row) => row.anchor && !furnitureClaimedAt(row.anchor.x, row.anchor.z, "bench"));
  if (!anchors.length) return 0;
  // One instanced mesh a part, sharing the same placement. The page has no geometry-merge
  // helper loaded and a bench is four boxes; four instanced draws for a few hundred benches
  // is cheaper than pulling in BufferGeometryUtils for them.
  const wood = new THREE.MeshStandardMaterial({ color: BENCH_SLATS, roughness: 0.78 });
  const iron = new THREE.MeshStandardMaterial({ color: BENCH_FRAME, roughness: 0.52, metalness: 0.42 });
  const parts = [];
  const seat = new THREE.BoxGeometry(BENCH_LENGTH_M, BENCH_SEAT_THICK_M, BENCH_DEPTH_M);
  seat.translate(0, BENCH_SEAT_Y_M, 0);
  parts.push([seat, wood]);
  const back = new THREE.BoxGeometry(BENCH_LENGTH_M, BENCH_BACK_H_M, BENCH_SEAT_THICK_M);
  back.translate(0, BENCH_SEAT_Y_M + BENCH_BACK_H_M / 2, -BENCH_DEPTH_M / 2 + BENCH_SEAT_THICK_M);
  parts.push([back, wood]);
  for (const sx of [-1, 1]) {
    const leg = new THREE.BoxGeometry(BENCH_LEG_M, BENCH_SEAT_Y_M, BENCH_DEPTH_M * 0.8);
    leg.translate(sx * (BENCH_LENGTH_M / 2 - 0.12), BENCH_SEAT_Y_M / 2, 0);
    parts.push([leg, iron]);
  }
  const dummy = new THREE.Object3D();
  const matrices = anchors.map((row, index) => {
    dummy.position.set(row.anchor.x, row.anchor.y, row.anchor.z);
    // Along the kerb, not across it: furnitureBearing already turns a piece of furniture to
    // the street it stands on, and a bench is set along the pavement rather than blocking it.
    dummy.rotation.set(0, furnitureBearing(row.item, row.index, row.anchor) + Math.PI / 2, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  });
  for (const [geometry, material] of parts) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.surface = "furniture:bench";
    mesh.castShadow = false;
    groups.furniture.add(mesh);
  }
  return anchors.length;
}

function addMuniShelters(records) {
  let added = 0;
  for (let i = 0; i < records.length; i += 1) {
    const item = records[i];
    const anchor = furnitureAnchor(item);
    if (!anchor) continue;
    const group = new THREE.Group();
    const yaw = furnitureBearing(item, i, anchor);
    group.position.set(anchor.x, anchor.y, anchor.z);
    group.rotation.y = yaw;
    boxPart(group, 0, MUNI_SHELTER_HEIGHT_M, 0, MUNI_SHELTER_LENGTH_M, 0.12, MUNI_SHELTER_DEPTH_M, 0xcfd8dc, 0.42);
    boxPart(group, -MUNI_SHELTER_LENGTH_M / 2 + 0.15, MUNI_SHELTER_HEIGHT_M / 2, -MUNI_SHELTER_DEPTH_M / 2, 0.08, MUNI_SHELTER_HEIGHT_M, 0.08, 0x9aa1a3, 0.46);
    boxPart(group, MUNI_SHELTER_LENGTH_M / 2 - 0.15, MUNI_SHELTER_HEIGHT_M / 2, -MUNI_SHELTER_DEPTH_M / 2, 0.08, MUNI_SHELTER_HEIGHT_M, 0.08, 0x9aa1a3, 0.46);
    boxPart(group, -MUNI_SHELTER_LENGTH_M / 2 + 0.5, 1.2, MUNI_SHELTER_DEPTH_M / 2 + 0.012, 1.2, 1.8, 0.035, 0xffffff, 0.35);
    boxPart(group, 0.3, 0.45, 0.25, 2.6, 0.16, 0.42, 0x546068, 0.66);
    group.userData = { source: item.source, provenance: item.provenance, spec: item.spec };
    groups.furniture.add(group);
    added += 1;
  }
  return added;
}


// ---- transit stops, as the agencies publish them ----------------------------------------------
//
// Every stop of every agency in the region (scripts/ingest_transit.py: transit-stops.json), each
// drawn as what stands there. A shelter: a roof on four posts, glass at the back and the upstream
// end, a bench inside and a route panel. A bench: a seat beside the pole. Every stop: the pole and
// its flag. Where the stop has a marked zone in the road (SFMTA's bus zones and bulbs), the zone is
// painted: a white box in the curb lane behind the stop, with BUS STOP lettered in it to read in
// the bus's direction of travel. A rail stop on a safety island stands on its island in the road.
//
// The shelters used to be built from parts queued for the buildings' merge, which had already
// been made by the time the furniture arrived: they were never drawn, anywhere. These are
// instanced, one mesh a part, placed stop by stop.
const STOP_SHELTER = { length: 4.0, depth: 1.5, height: 2.65 };
const STOP_ZONE = { behind: 18.0, ahead: 2.0, from: 0.25, width: 3.0, line: 0.15 };
const stopMaterials = {
  frame: new THREE.MeshStandardMaterial({ color: 0x5f676b, roughness: 0.45, metalness: 0.55 }),
  roof: new THREE.MeshStandardMaterial({ color: STOP_ROOF_RED, roughness: 0.45, metalness: 0.25 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, metalness: 0.1, transparent: true,
    opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  seat: new THREE.MeshStandardMaterial({ color: 0x8c949a, roughness: 0.5, metalness: 0.4 }),
  panel: new THREE.MeshStandardMaterial({ color: 0xf1f2ee, roughness: 0.6, emissive: 0x30302c }),
  island: new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 0.9 }),
  islandEdge: new THREE.MeshStandardMaterial({ color: 0xe8c547, roughness: 0.7 }),
};
//: A part of a stop as a unit box scaled and placed in the stop's own frame: x along the kerb,
//: y up, z towards the road (the open side of a shelter faces the road).
const SHELTER_PARTS = [
  ["roof", 0, STOP_SHELTER.height, 0, STOP_SHELTER.length + 0.2, 0.1, STOP_SHELTER.depth + 0.25],
  ["frame", -STOP_SHELTER.length / 2, STOP_SHELTER.height / 2, -STOP_SHELTER.depth / 2, 0.07, STOP_SHELTER.height, 0.07],
  ["frame", STOP_SHELTER.length / 2, STOP_SHELTER.height / 2, -STOP_SHELTER.depth / 2, 0.07, STOP_SHELTER.height, 0.07],
  ["frame", -STOP_SHELTER.length / 2, STOP_SHELTER.height / 2, STOP_SHELTER.depth / 2, 0.07, STOP_SHELTER.height, 0.07],
  ["frame", STOP_SHELTER.length / 2, STOP_SHELTER.height / 2, STOP_SHELTER.depth / 2, 0.07, STOP_SHELTER.height, 0.07],
  ["glass", 0, 1.3, -STOP_SHELTER.depth / 2, STOP_SHELTER.length - 0.1, 2.0, 0.02],
  ["glass", -STOP_SHELTER.length / 2, 1.3, 0, 0.02, 2.0, STOP_SHELTER.depth - 0.1],
  ["seat", -0.4, 0.46, -STOP_SHELTER.depth / 2 + 0.28, 2.2, 0.05, 0.42],
  ["frame", -1.4, 0.23, -STOP_SHELTER.depth / 2 + 0.28, 0.06, 0.46, 0.36],
  ["frame", 0.6, 0.23, -STOP_SHELTER.depth / 2 + 0.28, 0.06, 0.46, 0.36],
  ["panel", STOP_SHELTER.length / 2 - 0.6, 1.25, -STOP_SHELTER.depth / 2 + 0.03, 1.0, 1.7, 0.05],
];
const BENCH_PARTS = [
  ["seat", 0, 0.46, 0, 1.8, 0.05, 0.45],
  ["seat", 0, 0.75, -0.2, 1.8, 0.4, 0.04],
  ["frame", -0.8, 0.23, 0, 0.06, 0.46, 0.4],
  ["frame", 0.8, 0.23, 0, 0.06, 0.46, 0.4],
];
const unitBox = new THREE.BoxGeometry(1, 1, 1);
function instanceParts(parts, placements, surface) {
  if (!placements.length) return 0;
  const byMaterial = new Map();
  for (const part of parts) {
    if (!byMaterial.has(part[0])) byMaterial.set(part[0], []);
    byMaterial.get(part[0]).push(part);
  }
  const local = new THREE.Matrix4(), world = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [materialName, list] of byMaterial) {
    // Each part carries where its stop stands (clipAt): a window's edge takes or leaves a stop
    // whole (applyBoxClip, material.userData.wholeClip), never a part of one.
    const count = placements.length * list.length, at = new Float32Array(count * 2);
    const geometry = unitBox.clone();
    geometry.setAttribute("clipAt", new THREE.InstancedBufferAttribute(at, 2));
    stopMaterials[materialName].userData.wholeClip = true;
    const mesh = new THREE.InstancedMesh(geometry, stopMaterials[materialName], count);
    let i = 0;
    for (const { x, y, z, yaw } of placements) {
      world.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(1, 1, 1));
      for (const [, px, py, pz, w, h, d] of list) {
        local.compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
        mesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(world, local));
        at[2 * i] = x; at[2 * i + 1] = z;
        i += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.surface = surface;
    mesh.userData.liftedOntoGround = true;
    groups.furniture.add(mesh);
  }
  return placements.length;
}
//: BUS STOP, white, in a tile the road text quads all share.
let busStopTextMaterial = null;
function busStopText() {
  if (busStopTextMaterial) return busStopTextMaterial;
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 512);
  ctx.fillStyle = "#f4f4ef";
  // Road lettering is drawn long: tall letters, as a driver sees them foreshortened.
  ctx.font = "bold 150px system-ui, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save(); ctx.translate(128, 140); ctx.scale(0.62, 1.55); ctx.fillText("STOP", 0, 0); ctx.restore();
  ctx.save(); ctx.translate(128, 380); ctx.scale(0.62, 1.55); ctx.fillText("BUS", 0, 0); ctx.restore();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  busStopTextMaterial = new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.35, roughness: 0.75,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
  return busStopTextMaterial;
}
//: A stop's island in the road: eighteen metres of kerb, 2.4 m across, its bus side edged yellow.
const STOP_ISLAND_HALF_LENGTH_M = 9.0;
const STOP_ISLAND_HALF_M = 1.2;
//: A kerb point turned square to its street. nearestKerbAt's normal runs from the nearest point of
//: the carriageway's centreline to the point asked about; near a corner that nearest point is the
//: segment's end, and the normal comes out on a diagonal -- and with it every bus zone painted
//: there. The street's own direction is the segment's: the normal here is square to it, on the
//: side the point is, and the kerb point square off the centreline.
function streetSquareKerb(kerb) {
  if (!kerb || !Number.isFinite(kerb.ax) || !Number.isFinite(kerb.az)) return kerb;
  let nx = -kerb.az, nz = kerb.ax;
  if (nx * kerb.nx + nz * kerb.nz < 0) { nx = -nx; nz = -nz; }
  const fx = kerb.x - kerb.nx * kerb.half, fz = kerb.z - kerb.nz * kerb.half;
  return { ...kerb, nx, nz, x: fx + nx * kerb.half, z: fz + nz * kerb.half };
}
function addTransitStops(transit) {
  const stops = (transit.stops || []).filter((stop) => Number.isFinite(stop.lon) && Number.isFinite(stop.lat));
  const shelters = [], benches = [], poles = [], islands = [];
  const borders = [], texts = [];
  const quad = (list, corners, y) => {
    const base = list.length / 5;
    // Corners: [x, z, u, v] x4.
    for (const [x, z, u, v] of corners) list.push(x, y + (list === texts ? 0.004 : 0), z, u, v);
    return base;
  };
  const lonOf = (x) => midLon + x / metersPerLon, latOf = (z) => midLat - z / metersPerLat;
  for (const stop of stops) {
    const item = { p: [stop.lon, stop.lat], bearing: null, source: `gtfs:${stop.agency}`, provenance: stop.physical_source };
    let [x, y] = xy(stop.lon, stop.lat);
    let z = -y;
    // A stop on an island station stands on the island, which has its own canopy and benches.
    if (TRANSIT_ISLAND_SPOTS.some(([ix, iz, r]) => Math.hypot(ix - x, iz - z) < r + 6)) {
      poles.push(item);
      continue;
    }
    // A stop on an island beside a busway: the island runs along the busway, just clear of its
    // lane on the stop's side, and short of the junction and its crosswalks. Turned to the
    // nearest kerb it lay across the avenue wherever that kerb was the cross street's corner.
    const lane = stop.type === "SI" ? nearestBuswayAt(x, z, 14) : null;
    if (lane) {
      const nx = -lane.uz * lane.side, nz = lane.ux * lane.side;
      const out = lane.half + STOP_ISLAND_HALF_M + 0.15;
      let at = null;
      for (const shift of [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15]) {
        const cx = lane.x + nx * out + lane.ux * shift, cz = lane.z + nz * out + lane.uz * shift;
        const clear = [-STOP_ISLAND_HALF_LENGTH_M, 0, STOP_ISLAND_HALF_LENGTH_M].every((a) =>
          !insideJunctionBox(cx + lane.ux * a, cz + lane.uz * a));
        if (clear) { at = [cx, cz]; break; }
      }
      // The other agencies' stops at the same island: one island, one shelter.
      if (!at || islands.some((island) => Math.hypot(island.x - at[0], island.z - at[1]) < 2 * STOP_ISLAND_HALF_LENGTH_M)) {
        poles.push(item);
        continue;
      }
      const [cx, cz] = at, ground = groundLiftAt(cx, cz) + ROAD_TOP_M, yaw = Math.atan2(-lane.uz, lane.ux);
      // The island's yellow edge is its local +z side: the side the bus pulls up to.
      islands.push({ x: cx, y: ground, z: cz, yaw: lane.side > 0 ? yaw + Math.PI : yaw });
      if (stop.physical === "shelter") shelters.push({ x: cx + nx * 0.3, y: ground + 0.25, z: cz + nz * 0.3, yaw: lane.side > 0 ? yaw + Math.PI : yaw });
      poles.push({ ...item, p: [lonOf(cx + lane.ux * (STOP_ISLAND_HALF_LENGTH_M - 1.5)), latOf(cz + lane.uz * (STOP_ISLAND_HALF_LENGTH_M - 1.5))] });
      continue;
    }
    const onIsland = stop.type === "SI" && insideCarriageway(x, z, 0.0);
    const kerb = streetSquareKerb(nearestKerbAt(x, z, 25));
    if (!kerb) continue;
    // Along the kerb, and out of the road (n): the bus travels with the kerb on its right.
    const nx = kerb.nx, nz = kerb.nz;
    const dx = nz, dz = -nx;
    if (onIsland) {
      const ground = groundLiftAt(x, z) + ROAD_TOP_M;
      // Its length along the street: local x turned onto the direction of travel.
      islands.push({ x, y: ground, z, yaw: Math.atan2(-dz, dx) });
      const at = { x, y: ground + 0.25, z, yaw: Math.atan2(-dz, dx) };
      if (stop.physical === "shelter") shelters.push(at);
      else poles.push({ ...item, p: [lonOf(x), latOf(z)] });
      continue;
    }
    const anchor = furnitureAnchor(item);
    if (!anchor) continue;
    // Facing the road: the shelter's open side, the bench's seat.
    const yaw = Math.atan2(-nx, -nz);
    poles.push(item);
    if (stop.physical === "shelter") {
      // The shelter stands back from the kerb by its own depth, upstream of the pole.
      const sx = anchor.x + nx * (STOP_SHELTER.depth / 2 + 0.25) - dx * 3.0, sz = anchor.z + nz * (STOP_SHELTER.depth / 2 + 0.25) - dz * 3.0;
      if (!buildingAt(sx, sz) && !insideCarriageway(sx, sz, 0.1)) shelters.push({ x: sx, y: anchor.y, z: sz, yaw });
    } else if (stop.physical === "bench") {
      const bx = anchor.x + nx * 0.6 - dx * 1.8, bz = anchor.z + nz * 0.6 - dz * 1.8;
      if (!buildingAt(bx, bz) && !insideCarriageway(bx, bz, 0.1)) benches.push({ x: bx, y: anchor.y, z: bz, yaw });
    }
    if (stop.painted) {
      // The zone, in the curb lane behind the stop: a box of white line and the words in it.
      // Slid back up the kerb until none of it is in the junction or its crosswalks: a zone ends
      // short of the corner.
      let kx = kerb.x, kz = kerb.z, fits = false;
      for (const back of [0, 4, 8, 12, 16, 20]) {
        const bx = kerb.x - dx * back, bz = kerb.z - dz * back;
        let clear = true;
        for (let along = -STOP_ZONE.behind; along <= STOP_ZONE.ahead + 1.5 && clear; along += 2) {
          for (const across of [STOP_ZONE.from + 0.2, STOP_ZONE.from + STOP_ZONE.width - 0.2]) {
            const px = bx + dx * along - nx * across, pz = bz + dz * along - nz * across;
            if (!insideCarriageway(px, pz, 0) || insideJunctionBox(px, pz)) { clear = false; break; }
          }
        }
        if (clear) { kx = bx; kz = bz; fits = true; break; }
      }
      if (!fits) continue;
      const centreX = kx - nx * (STOP_ZONE.from + STOP_ZONE.width / 2) - dx * (STOP_ZONE.behind - STOP_ZONE.ahead) / 2;
      const centreZ = kz - nz * (STOP_ZONE.from + STOP_ZONE.width / 2) - dz * (STOP_ZONE.behind - STOP_ZONE.ahead) / 2;
      const roadY = groundLiftAt(centreX, centreZ) + ROAD_TOP_M + 0.034;
      const at = (along, across) => [kx + dx * along - nx * across, kz + dz * along - nz * across];
      const { behind, ahead, from, width, line } = STOP_ZONE;
      for (const [a0, a1, c0, c1] of [[-behind, ahead, from, from + line], [-behind, ahead, from + width - line, from + width],
                                       [-behind, -behind + line, from, from + width], [ahead - line, ahead, from, from + width]]) {
        const [p0, p1, p2, p3] = [at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)];
        const base = quad(borders, [[...p0, 0, 0], [...p1, 0, 0], [...p2, 0, 0], [...p3, 0, 0]], roadY);
        borders.index = borders.index || [];
        borders.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      // The words: 5 m long down the lane, 2.4 m across, reading towards where the bus is going.
      const t0 = -behind / 2 - 2.5, t1 = -behind / 2 + 2.5, c0 = from + width / 2 - 1.2, c1 = from + width / 2 + 1.2;
      const [q0, q1, q2, q3] = [at(t0, c1), at(t0, c0), at(t1, c0), at(t1, c1)];
      const base = quad(texts, [[...q0, 0, 0], [...q1, 1, 0], [...q2, 1, 1], [...q3, 0, 1]], roadY);
      texts.index = texts.index || [];
      texts.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const emit = (list, material, surface) => {
    if (!list.index || !list.index.length) return;
    const n = list.length / 5;
    const position = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      position[i * 3] = list[i * 5]; position[i * 3 + 1] = list[i * 5 + 1]; position[i * 3 + 2] = list[i * 5 + 2];
      uv[i * 2] = list[i * 5 + 3]; uv[i * 2 + 1] = list[i * 5 + 4];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(list.index);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { surface, source: "gtfs+sfmta_stop_type", liftedOntoGround: true };
    groups.furniture.add(mesh);
  };
  emit(borders, new THREE.MeshStandardMaterial({ color: 0xf2f5ef, roughness: 0.8, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }), "furniture:bus_zone");
  emit(texts, busStopText(), "furniture:bus_zone");
  const placed = {
    stops: stops.length,
    poles: addStreetFurniturePosts(poles),
    flags: addInstancedFurniturePanels(poles, 0.48, 0.34, 0x2a6db8, "furniture:bus_stop", 2.25, "lower"),
    shelters: instanceParts(SHELTER_PARTS, shelters, "furniture:shelter"),
    benches: instanceParts(BENCH_PARTS, benches, "furniture:bench"),
    islands: instanceParts([["island", 0, 0.12, 0, 2 * STOP_ISLAND_HALF_LENGTH_M, 0.25, 2 * STOP_ISLAND_HALF_M],
      ["islandEdge", 0, 0.251, STOP_ISLAND_HALF_M - 0.1, 2 * STOP_ISLAND_HALF_LENGTH_M, 0.01, 0.3]], islands, "furniture:shelter"),
    painted: texts.index ? texts.index.length / 6 : 0,
    entrances: addStationEntrances(transit.entrances || []),
  };
  transitStats.placed = placed;
  return placed;
}
const transitStats = { placed: null };
window.kerbsideTransit = () => ({ ...transitStats });


