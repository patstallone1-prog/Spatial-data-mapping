// ---- public stairways ----------------------------------------------------------------------
//
// OpenStreetMap's flights of public steps (highway=steps: ingest_steps.py writes them beside the
// payload, sf-corridor-stairs.json). Each is given a stepped profile along it from the ground under it -- risers
// of about STAIR_RISE_M, or as many as the map counts, the treads never below the hill -- and
// drawn as the treads it is. The walker stands on the tread under it (publicStairAt), so it
// climbs a flight step by step at a stair's pace rather than gliding up the hill beside it.
const STAIR_RISE_M = 0.17;
const STAIR_WIDTH_M = 2.2;
const STAIR_SAMPLE_M = 0.3;
const STAIR_CELL_M = 16;
const publicStairs = [];
const publicStairGrid = new Map();
function indexPublicStairs(flights) {
  for (const way of flights || []) {
    if (!way.points || way.points.length < 2) continue;
    const local = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    const xs = [], zs = [], ds = [];
    let along = 0;
    for (let i = 0; i < local.length; i += 1) {
      const [ax, az] = local[i];
      if (i) {
        const [px, pz] = local[i - 1], span = Math.hypot(ax - px, az - pz);
        for (let k = 1; k <= Math.ceil(span / STAIR_SAMPLE_M); k += 1) {
          const t = k / Math.ceil(span / STAIR_SAMPLE_M);
          xs.push(px + (ax - px) * t); zs.push(pz + (az - pz) * t); ds.push(along + span * t);
        }
        along += span;
      } else { xs.push(ax); zs.push(az); ds.push(0); }
    }
    let hs = xs.map((x, i) => groundLiftAt(x, zs[i]));
    if (hs[hs.length - 1] < hs[0]) { xs.reverse(); zs.reverse(); hs.reverse(); ds.reverse(); for (let i = 0; i < ds.length; i += 1) ds[i] = along - ds[i]; }
    const low = hs[0];
    // The hill's running top from the foot, so the treads only ever climb and never dip into it.
    const top = [];
    hs.forEach((h, i) => top.push(Math.max(i ? top[i - 1] : low, h)));
    const rise = top[top.length - 1] - low;
    if (rise < 0.35) continue;    // a level path that happens to be tagged steps: walked as a path
    const count = Number.isInteger(way.step_count) && way.step_count > 0 ? way.step_count : Math.max(1, Math.round(rise / STAIR_RISE_M));
    const each = rise / count;
    const q = top.map((m) => low + Math.min(count, Math.ceil((m - low) / each - 1e-6)) * each);
    const stair = { xs, zs, ds, hs, q, half: STAIR_WIDTH_M / 2, osm_id: way.osm_id, count };
    publicStairs.push(stair);
    for (let i = 1; i < xs.length; i += 1) {
      const key = `${Math.floor(xs[i] / STAIR_CELL_M)}:${Math.floor(zs[i] / STAIR_CELL_M)}`;
      if (!publicStairGrid.has(key)) publicStairGrid.set(key, []);
      const bucket = publicStairGrid.get(key);
      if (bucket[bucket.length - 1] !== stair) bucket.push(stair);
    }
  }
}
//: The tread of a public flight under (x, z), or null.
function publicStairAt(x, z) {
  // The centreline's cell does not own the whole tread width at cell boundaries.
  const bucket=new Set();
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)
    for(const stair of publicStairGrid.get(`${Math.floor(x/STAIR_CELL_M)+dx}:${Math.floor(z/STAIR_CELL_M)+dz}`)||[])bucket.add(stair);
  if (!bucket.size) return null;
  let best = null, bestD2 = Infinity;
  for (const stair of bucket) {
    const { xs, zs, q, half } = stair;
    for (let i = 1; i < xs.length; i += 1) {
      const ax = xs[i - 1], az = zs[i - 1], dx = xs[i] - ax, dz = zs[i] - az;
      const len2 = dx * dx + dz * dz;
      if (!(len2 > 0)) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d2 = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d2 > half * half || d2 >= bestD2) continue;
      // Off either end of the flight is not on it.
      if ((i === 1 && t === 0 && ((x - ax) * dx + (z - az) * dz) < 0) || (i === xs.length - 1 && t === 1
          && ((x - xs[i]) * dx + (z - zs[i]) * dz) > 0)) continue;
      bestD2 = d2;
      best = t < 0.5 ? q[i - 1] : q[i];
    }
  }
  return best;
}
//: The treads, drawn: one box per tread from a little under the hill to the tread's top.
function addPublicStairTreads() {
  if (!publicStairs.length) return 0;
  const positions = [], index = [];
  const box = (ax, az, bx, bz, half, bottom, topY) => {
    const len = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / len * half, nz = (bx - ax) / len * half;
    const c = [[ax - nx, az - nz], [bx - nx, bz - nz], [bx + nx, bz + nz], [ax + nx, az + nz]];
    const base = positions.length / 3;
    for (const y of [bottom, topY]) for (const [x, z] of c) positions.push(x, y, z);
    for (const [a, b, cc, d] of [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
      index.push(base + a, base + b, base + cc, base + a, base + cc, base + d);
    }
  };
  let treads = 0;
  for (const { xs, zs, hs, q, half } of publicStairs) {
    let start = 0;
    for (let i = 1; i <= q.length; i += 1) {
      if (i < q.length && Math.abs(q[i] - q[start]) < 1e-6) continue;
      const end = Math.min(i, q.length - 1);
      let bottom = Infinity;
      for (let k = start; k <= end; k += 1) bottom = Math.min(bottom, hs[k]);
      // A tread a single sample long is a riser's depth: given its sample's length either way.
      const sx = xs[start], sz = zs[start], ex = end > start ? xs[end] : xs[Math.min(start + 1, xs.length - 1)];
      const ez = end > start ? zs[end] : zs[Math.min(start + 1, zs.length - 1)];
      box(sx, sz, ex, ez, half, bottom - 0.4, q[start] + 0.02);
      treads += 1;
      start = i;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9c9a92, roughness: 0.92 }));
  mesh.userData = { surface: "public_stairs", source: "openstreetmap_highway_steps", liftedOntoGround: true };
  mesh.receiveShadow = true;
  groups.streets.add(mesh);
  return treads;
}
// The flights come in their own small file (scripts/ingest_steps.py), so the world payload --
// which other files are bound to by its hash -- is left as it was.
fetch(asset("sf-corridor-stairs.json"), { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((data) => {
  if (!data?.stairs?.length) return;
  indexPublicStairs(data.stairs);
  const treads = addPublicStairTreads();
  console.info(`kerbside: ${publicStairs.length} public stairways, ${treads} treads`);
}).catch(() => {});

//: Whether a mapped wall runs in a cut's wall band (within a few metres of either side).
function insideCutBand(way) {
  if (!APPROACH_CUTS.length || !way.points) return false;
  return way.points.every((p) => {
    const [x, y] = xy(p[0], p[1]);
    return APPROACH_CUTS.some((cut) => {
      const dx = x - cut.mx, dz = -y - cut.mz;
      const along = dx * cut.ux + dz * cut.uz;
      const off = Math.abs(dx * cut.uz - dz * cut.ux);
      return along > -3 && along < cut.reach + 3 && off > cut.half - 3 && off < cut.half + CUT_WALL_T_M + 3;
    });
  });
}
//: The cut's road level at ``along`` metres out from its mouth.
function cutRoadAt(cut, along) {
  return cut.mouthZ + (cut.farZ - cut.mouthZ) * Math.max(0, Math.min(1, along / cut.reach));
}
//: The retaining walls of every cut: on each side a block from the road up to the ground
//: outside, CUT_WALL_T_M thick and capped, from the mouth out to where the ground has come down
//: to the road. The terrain under the block is lowered with the cut (trenchGroundAt), so what
//: stands either side of a tunnel's approach is a wall, not a slope of grass and asphalt.
const CUT_WALL_STEP_M = 2.0;
function retainingTopEnvelope(samples,maxGrade=.12) {
  // Smallest grade-bounded cap that stays above every sampled soil height.
  // Only an inferred structure changes; the terrain evidence is untouched.
  const top=samples.map(p=>p.top);
  for(let i=1;i<top.length;i++)top[i]=Math.max(top[i],top[i-1]-maxGrade*(samples[i].along-samples[i-1].along));
  for(let i=top.length-2;i>=0;i--)top[i]=Math.max(top[i],top[i+1]-maxGrade*(samples[i+1].along-samples[i].along));
  return top;
}
function addCutWalls() {
  if (!APPROACH_CUTS.length) return 0;
  const material = new THREE.MeshStandardMaterial({
    map: WALL_TEXTURES.stone || (WALL_TEXTURES.stone = stoneWallTexture()),
    color: 0xd2cec6, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
  });
  const positions = [], uvs = [], indices = [];
  const quad = (a, b, c, d, uLen, vLen) => {
    const base = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    uvs.push(0, 0, uLen / 3, 0, uLen / 3, vLen / 3, 0, vLen / 3);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  let walls = 0;
  for (const cut of APPROACH_CUTS) {
    const { mx, mz, ux, uz } = cut;
    for (const side of [-1, 1]) {
      // n points across the cut, out to this side.
      const nx = uz * side, nz = -ux * side;
      const inner = cut.half, outer = cut.half + CUT_WALL_T_M;
      const at = (along, off) => [mx + ux * along + nx * off, mz + uz * along + nz * off];
      const steps = Math.max(2, Math.ceil(cut.reach / CUT_WALL_STEP_M));
      const samples=[];
      for(let k=0;k<=steps;k++) {
        const along=Math.min(cut.reach,k*CUT_WALL_STEP_M),road=cutRoadAt(cut,along);
        const [ox,oz]=at(along,outer+1);
        samples.push({along,road,top:Math.max(road,terrainHeightAt(ox,oz))});
      }
      if(cut.levelBasis==="inferred_terrain_endpoint") {
        const envelope=retainingTopEnvelope(samples);
        samples.forEach((p,i)=>{p.top=envelope[i];});
      }
      let prev = null;
      for (let k = 0; k <= steps; k += 1) {
        const {along,road,top}=samples[k];
        const here = { along, road, top, i: at(along, inner), o: at(along, outer) };
        if (prev && (prev.top - prev.road > 0.15 || here.top - here.road > 0.15)) {
          const len = here.along - prev.along;
          // The face to the cut, the cap, and the back.
          quad([prev.i[0], prev.road - 0.3, prev.i[1]], [here.i[0], here.road - 0.3, here.i[1]],
               [here.i[0], here.top, here.i[1]], [prev.i[0], prev.top, prev.i[1]], len, here.top - here.road);
          quad([prev.i[0], prev.top, prev.i[1]], [here.i[0], here.top, here.i[1]],
               [here.o[0], here.top, here.o[1]], [prev.o[0], prev.top, prev.o[1]], len, CUT_WALL_T_M);
          quad([prev.o[0], prev.top, prev.o[1]], [here.o[0], here.top, here.o[1]],
               [here.o[0], here.road - 0.3, here.o[1]], [prev.o[0], prev.road - 0.3, prev.o[1]], len, here.top - here.road);
          walls += 1;
        }
        prev = here;
      }
    }
  }
  if (!indices.length) return 0;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  // "tunnel_*": built at its own heights, never lifted onto the ground again.
  mesh.userData.surface = "tunnel_cut_wall";
  mesh.castShadow = mesh.receiveShadow = true;
  groups.streets.add(mesh);
  return walls;
}

function addTunnel(way, renderPoints, roadWidth, roadTop) {
  // A road tunnel is the bore through the hill, at the level the lidar read for its road:
  // the ground less the cover measured over it at each station (measure_tunnel_portals.py).
  // The hill is the terrain the whole model now stands on; the mouths are where the lidar
  // put them; at each a headwall of one design -- the arch, its lining, a parapet -- stands
  // against the hillside. The bore is swept the whole way between the mouths with a walkway
  // along each wall and lights at the crown, and a walker goes in one end and out the other.
  // The portal is as wide as the city's kerbs on the approach say the cut is, and wider than
  // sixteen metres it is two bores with a pier between them, which is what Broadway's is.
  //
  // It used to be drawn as a lining lying on flat ground, then as a stub at each mouth ending
  // in a wall of dark, then as a bore sunk under a flat world at 15%. With the ground itself
  // measured none of those stand-ins are needed.
  if (renderPoints.length < 2) return null;
  const covered = tunnelAxis(way, tunnelCoveredPoints(way, renderPoints));
  if (covered.length < 2) return null;
  const group = new THREE.Group();
  // Darker than daylight concrete, as a bore is seen from the street: the lighter lining read
  // as a grey slab filling the arch.
  const lining = new THREE.MeshStandardMaterial({
    color: 0x45484c, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide,
    emissive: 0x0b0c0d,
  });
  const concrete = new THREE.MeshStandardMaterial({
    color: 0x9d9e9a, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide, emissive: 0x141414,
  });
  const light = new THREE.MeshBasicMaterial({ color: 0xffebbd });
  const lightHousing = new THREE.MeshStandardMaterial({ color: 0x252b2e, roughness: 0.78, metalness: 0.28 });
  const measured = way.tunnel_portal || {};
  const design = way.tunnel_design && way.tunnel_design.kind === "immersed_tube"
    ? way.tunnel_design : null;
  const crown = design ? design.clearance_m : TUNNEL_CROWN_M;
  const spring = design ? Math.min(3.6, crown - 0.3) : TUNNEL_WALL_M;
  const total = wayLength(covered);
  group.userData.tunnelLengthM = Number(way.tunnel_length_m || total);
  group.userData.mouthCount = 2;
  group.userData.profileSource = design ? design.profile_source : "lidar_or_terrain";
  const H = crown + TUNNEL_SHELL_M + TUNNEL_PARAPET_M;
  const halves = [];
  const ends = [["start", covered], ["end", covered.slice().reverse()]].map(([label, inwardPoints]) => {
    const pts = inwardPoints.map((p) => { const [x, y] = xy(p[0], p[1]); return new THREE.Vector3(x, 0, -y); });
    if (pts.length < 2) return null;
    const inward = { x: pts[1].x - pts[0].x, z: pts[1].z - pts[0].z };
    const len = Math.hypot(inward.x, inward.z) || 1;
    inward.x /= len; inward.z /= len;
    const mouth = { x: pts[0].x, z: pts[0].z };
    return { label, inwardPoints, pts, inward, mouth,
             approach: tunnelApproachWidth(mouth, { x: -inward.x, z: -inward.z }) };
  }).filter(Boolean);
  const approaches = ends.map((e) => e.approach).filter((v) => v);
  const width = Math.max(MIN_RENDER_ROAD_M, Math.min(40, approaches.length ? Math.max(...approaches) : roadWidth));
  const bores = width > TUNNEL_TWIN_MIN_M ? 2 : 1;
  const boreWidth = Math.min(TUNNEL_BORE_MAX_M, (width - (bores - 1) * TUNNEL_PIER_M) / bores);
  const half = boreWidth / 2;
  const offsets = bores === 2 ? [-(boreWidth + TUNNEL_PIER_M) / 2, (boreWidth + TUNNEL_PIER_M) / 2] : [0];
  // The cover profile is measured along the way's own line from its first mouth; each bore's
  // line is a sideways copy of it, so the same profile serves both.
  const cover = Array.isArray(way.tunnel_cover) ? way.tunnel_cover : null;
  const oneway = onewaySign(way) !== 0;
  let mouthFloor = {};
  for (const off of offsets) {
    const line = offsetWay(covered, off);
    const stations = tunnelStations(line, cover, way.tunnel_road_z || null, design);
    if (stations.length < 2) continue;
    tunnelBores.push({ stations, half, crown, spring, group, walkWidth:TUNNEL_WALK_W_M,
      walkHeight:TUNNEL_WALK_H_M,roadOffset:TUNNEL_ROAD_Y_M,wayId:way.osm_id });
    if (!mouthFloor.start) mouthFloor = { start: stations[0].floor, end: stations[stations.length - 1].floor };
    const inner = sweepAlongBore(stations, (st) => tunnelSectionPoints(half, st.cap, crown, spring), lining, "tunnel");
    if (inner) group.add(inner);
    // A lining has thickness. A single two-sided inner skin left terrain specks
    // in its folds and opened the world when the cover was thin at an underpass.
    const shell = sweepAlongBore(stations, st => tunnelSectionPoints(half+TUNNEL_SHELL_M,
      st.cap+TUNNEL_SHELL_M,crown+TUNNEL_SHELL_M,spring+TUNNEL_SHELL_M), concrete, "tunnel_shell");
    const shellBase = sweepAlongBore(stations, () => [[-half-TUNNEL_SHELL_M,-.05],
      [half+TUNNEL_SHELL_M,-.05]], concrete, "tunnel_shell");
    if(shell)group.add(shell);if(shellBase)group.add(shellBase);
    const floor = sweepAlongBore(stations, () => [[-half, 0], [half, 0]],
                                 surfaceMaterial("road", 0xffffff, 1.0), "tunnel_floor");
    if (floor) group.add(floor);
    for (const side of [-1, 1]) {
      const inside = half - TUNNEL_WALK_W_M;
      const walk = sweepAlongBore(stations, () => side < 0
        ? [[-half, TUNNEL_WALK_H_M], [-inside, TUNNEL_WALK_H_M], [-inside, 0]]
        : [[inside, 0], [inside, TUNNEL_WALK_H_M], [half, TUNNEL_WALK_H_M]], concrete, "tunnel_walk");
      if (walk) group.add(walk);
    }
    const laneRoom = boreWidth - 2 * TUNNEL_WALK_W_M;
    // The road itself, carried through the bore. Inferred where the survey stops at the
    // portal, which is everywhere: what is known is the width between the walkways and the
    // level of the floor, and that is a carriageway.
    if (laneRoom > 0.6) {
      const asphalt = new THREE.MeshStandardMaterial({
        color: 0x2f3439, roughness: 0.95, metalness: 0.0,
        side: THREE.DoubleSide, emissive: 0x0a0c0e,
      });
      const deck = sweepAlongBore(stations,
        () => [[-laneRoom / 2, TUNNEL_ROAD_Y_M], [laneRoom / 2, TUNNEL_ROAD_Y_M]],
        asphalt, "tunnel_road");
      if (deck) group.add(deck);
      // An edge line against each walkway, the same white the approach carries.
      const edgePaint = new THREE.MeshStandardMaterial({
        color: 0xdfe3e0, roughness: 0.82, side: THREE.DoubleSide,
        emissive: 0xdfe3e0, emissiveIntensity: 0.22,
      });
      for (const side of [-1, 1]) {
        const u = side * (laneRoom / 2 - TUNNEL_EDGE_INSET_M);
        const edge = sweepAlongBore(stations,
          () => [[u - MARK_W / 2, TUNNEL_ROAD_Y_M + 0.006], [u + MARK_W / 2, TUNNEL_ROAD_Y_M + 0.006]],
          edgePaint, "tunnel_marking");
        if (edge) group.add(edge);
      }
    }
    const marks = oneway
      ? [{ u: 0, color: 0xdfe3e0, dash: true }]
      : [{ u: -(MARK_W + DOUBLE_GAP_M) / 2, color: 0xd8a92e }, { u: (MARK_W + DOUBLE_GAP_M) / 2, color: 0xd8a92e }];
    if (laneRoom >= 5.2) {
      for (const mark of marks) {
        const paint = new THREE.MeshStandardMaterial({ color: mark.color, roughness: 0.82, side: THREE.DoubleSide,
                                                       emissive: mark.color, emissiveIntensity: 0.25 });
        const paintStations=mark.dash ? tunnelPaintStations(stations,DASH_M,GAP_M) : stations;
        const strip = sweepAlongBore(paintStations, () => {
          return [[mark.u - MARK_W / 2, 0.012], [mark.u + MARK_W / 2, 0.012]];
        }, paint, "tunnel_marking");
        if (strip) group.add(strip);
      }
    }
    // Sparse sweep sections turned short lamps into huge triangular streaks. Physical
    // fittings are independent boxes at measured stations, aligned with the local bore.
    const lampStations = stations.filter((st, i) => i >= 2 && i < stations.length - 2 && i % 3 === 2);
    if (lampStations.length) {
      const mount = new THREE.InstancedMesh(
        new THREE.BoxGeometry(TUNNEL_LIGHT_W_M + 0.16, 0.08, TUNNEL_LAMP_M + 0.16),
        lightHousing, lampStations.length);
      const lens = new THREE.InstancedMesh(
        new THREE.BoxGeometry(TUNNEL_LIGHT_W_M, 0.035, TUNNEL_LAMP_M),
        light, lampStations.length);
      const up = new THREE.Vector3(0, 1, 0);
      const unit = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < lampStations.length; i += 1) {
        const st = lampStations[i];
        const yaw = Math.atan2(st.ux, st.uz);
        const turn = new THREE.Quaternion().setFromAxisAngle(up, yaw);
        const ceiling = st.floor + Math.min(st.cap, crown) - 0.12;
        mount.setMatrixAt(i, new THREE.Matrix4().compose(
          new THREE.Vector3(st.x, ceiling, st.z), turn, unit));
        lens.setMatrixAt(i, new THREE.Matrix4().compose(
          new THREE.Vector3(st.x, ceiling - 0.055, st.z), turn, unit));
      }
      mount.instanceMatrix.needsUpdate = lens.instanceMatrix.needsUpdate = true;
      mount.userData.surface = lens.userData.surface = "tunnel_light";
      group.add(mount, lens);
    }
  }
  for (const { label, pts, inward } of ends) {
    const here = pts[0];
    const yaw = Math.atan2(inward.x, inward.z);
    const base = (mouthFloor[label] !== undefined ? mouthFloor[label] : groundLiftAt(here.x, here.z) + TUNNEL_FLOOR_M) - TUNNEL_FLOOR_M;
    // The headwall: one design at both ends, the arches cut through it, standing against
    // the hillside at the bore's own level. Across the whole cut and its retaining walls where
    // the mouth has a cut, so the walls run into it, and up to the hill over the mouth, which
    // it holds back: a fixed-height wall left the hillside showing above and around it.
    const cut = APPROACH_CUTS.map((c) => ({ c, d: Math.hypot(c.mx - here.x, c.mz - here.z) }))
      .filter((e) => e.d < 20).sort((a, b) => a.d - b.d)[0]?.c || null;
    const W = cut ? Math.max(width / 2 + TUNNEL_PORTAL_MARGIN_M, cut.half + CUT_WALL_T_M)
      : width / 2 + TUNNEL_PORTAL_MARGIN_M;
    let hill = 0;
    for (let off = -W; off <= W + 1e-6; off += W / 6) {
      // Inside the mouth, across the wall's width and as far in as the ground is opened
      // behind it: the ground the wall and its crown cap stand against.
      for (const inM of cut ? [1.5, PORTAL_OPEN_IN_M + 1] : [1.5]) {
        const sx = here.x - inward.z * off + inward.x * inM, sz = here.z + inward.x * off + inward.z * inM;
        hill = Math.max(hill, terrainHeightAt(sx, sz) + 0.5 - (base + roadTop));
      }
    }
    const HW = Math.min(30, Math.max(H, hill));
    const face = new THREE.Shape();
    face.moveTo(-W, -0.3); face.lineTo(W, -0.3); face.lineTo(W, HW); face.lineTo(-W, HW); face.lineTo(-W, -0.3);
    for (const off of offsets) {
      const arch = tunnelArchShape(half, false, crown, spring).getPoints(28).map((q) => new THREE.Vector2(q.x + off, q.y));
      face.holes.push(new THREE.Path(arch));
    }
    const slab = new THREE.ExtrudeGeometry(face, { depth: TUNNEL_PORTAL_DEPTH_M, bevelEnabled: false });
    const portal = new THREE.Mesh(slab, new THREE.MeshStandardMaterial({
      map: WALL_TEXTURES.stone || (WALL_TEXTURES.stone = stoneWallTexture()),
      color: 0xd8d4cc, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
    }));
    portal.position.set(here.x, base + roadTop, here.z);
    portal.rotation.y = yaw;
    portal.userData.surface = "tunnel_portal";
    portal.userData.headwallM = +HW.toFixed(2);
    portal.userData.boreWidthM = +boreWidth.toFixed(2);
    portal.userData.bores = bores;
    portal.userData.widthSource = approaches.length ? "sfmta_curbs_on_approach" : "road_width";
    portal.userData.coverM = measured[label] || null;
    if (cut) {
      // The crown cap: the ground behind the headwall is opened so the arches show the bore
      // (inTubePortalOpening), and this closes that opening from above at the hill's level.
      const depth = PORTAL_OPEN_IN_M + 1;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(2 * W, 0.6, depth), portal.material);
      cap.position.set(0, HW - 0.3, depth / 2);
      cap.userData.surface = "tunnel_portal";
      portal.add(cap);
    }
    group.add(portal);
    halves.push({ label, width, bores, cover: measured[label] || null });
  }
  group.userData.halves = halves;
  return group;
}

//: A surface car park: asphalt, and bays 2.5 m by 5.0 m painted in angled rows off its frontage.
//: Its two heights sit in the ground stack (see GROUND_STACK) and are declared here because the
//: street loop that draws car parks runs before that block does.
const PARKING_Y = 0.0275;      // a surface car park's asphalt, between the frontages and the courts
const PARKING_LINE_Y = 0.046;  // the bays painted on it
//: A surface lot as Bay Area lots are striped: stalls nosed in square to the aisle, 2.7 m wide
//: and 5.5 m deep, two-way aisles 7.3 m wide between rows, a drive aisle across each end so a
//: car can circle the rows, and the front row broken where the lot's entrance is.
const PARKING_BAY_W_M = 2.7;
const PARKING_BAY_L_M = 5.5;
const PARKING_AISLE_M = 7.3;
const PARKING_END_AISLE_M = 6.5;
const PARKING_ENTRY_M = 7.0;
//: No line is painted closer than this to the lot's edge.
const PARKING_EDGE_M = 0.3;
//: How far a lot's mapped edge may stand from the street's kerb and still be that street's
//: frontage, and the footway allowed between them before the lot's asphalt begins.
const PARKING_FORECOURT_MAX_M = 14.0;
const PARKING_FORECOURT_WALK_M = 3.0;

function parkingAsphaltTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Weathered asphalt: grey, paler than the roadway -- a lot sees less traffic and more sun.
  // (It was #4a4c4e under dark oil patches, which the lighting took to near black.)
  ctx.fillStyle = "#77797a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.22; i += 1) {
    ctx.fillStyle = random(i * 19) < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.07)";
    ctx.fillRect(random(i * 3) * size, random(i * 7) * size, 1, 1);
  }
  // A few oil marks where cars sit, faint.
  for (let i = 0; i < 10; i += 1) {
    ctx.fillStyle = "rgba(30,30,32,0.10)";
    ctx.beginPath();
    ctx.ellipse(random(i * 11) * size, random(i * 13) * size, 4 + random(i * 17) * 10, 3 + random(i * 23) * 6, random(i) * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / 6, 1 / 6);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
let PARKING_ASPHALT = null;

//: A lot's frame: the frontage edge as the u axis, the lot's depth behind it as v. The frontage
//: is the longest ring edge with a street kerb facing it within `reach`; a lot with no street
//: at any edge (one inside a block, reached by an alley) takes its longest edge.
function parkingLayout(ring, reach) {
  let frontage = null;
  let longest = null;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    const span = Math.hypot(bx - ax, bz - az);
    if (span < 6) continue;
    if (!longest || span > longest.span) longest = { i, span };
    const kerb = nearestKerbAt((ax + bx) / 2, (az + bz) / 2, reach);
    if (!kerb) continue;
    const toEdge = [(ax + bx) / 2 - kerb.x, (az + bz) / 2 - kerb.z];
    const away = Math.hypot(toEdge[0], toEdge[1]) || 1;
    if ((toEdge[0] * kerb.nx + toEdge[1] * kerb.nz) / away < 0.75) continue;
    if (Math.abs(((bx - ax) * kerb.ax + (bz - az) * kerb.az) / span) < 0.8) continue;
    if (!frontage || span > frontage.span) frontage = { i, span };
  }
  const edge = frontage || longest;
  if (!edge) return null;
  const [ox, oz] = ring[edge.i];
  const [bx, bz] = ring[edge.i + 1];
  const ex = (bx - ox) / edge.span, ez = (bz - oz) / edge.span;
  let nx = -ez, nz = ex;
  // v points into the lot.
  let cx = 0, cz = 0;
  for (let i = 0; i < ring.length - 1; i += 1) { cx += ring[i][0]; cz += ring[i][1]; }
  cx /= ring.length - 1; cz /= ring.length - 1;
  if ((cx - ox) * nx + (cz - oz) * nz < 0) { nx = -nx; nz = -nz; }
  let u0 = Infinity, u1 = -Infinity, depth = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const u = (ring[i][0] - ox) * ex + (ring[i][1] - oz) * ez;
    const v = (ring[i][0] - ox) * nx + (ring[i][1] - oz) * nz;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v > depth) depth = v;
  }
  return { ox, oz, ex, ez, nx, nz, u0, u1, depth, frontage: Boolean(frontage) };
}

function addParkingLot(way) {
  const ring = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  if (ring.length < 4) return null;
  const group = new THREE.Group();
  // The slab.
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const slab = new THREE.ShapeGeometry(shape);
  slab.rotateX(-Math.PI / 2);
  // Planar UVs in metres, so the texture repeat is the texture's own scale.
  const uv = slab.getAttribute("uv");
  const pos = slab.getAttribute("position");
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, pos.getX(i), pos.getZ(i));
  slab.translate(0, PARKING_Y, 0);
  if (!PARKING_ASPHALT) PARKING_ASPHALT = parkingAsphaltTexture();
  const ground = new THREE.Mesh(slab, new THREE.MeshStandardMaterial({
    map: PARKING_ASPHALT, color: 0xffffff, roughness: 0.96, metalness: 0.0,
  }));
  ground.userData.surface = "parking_lot";
  group.add(ground);

  // The forecourt: the strip between the lot's mapped edge and the pavement of the street it
  // opens onto. OpenStreetMap draws a car park to its property line and this model lays its
  // pavement from the kerb, and the ground between the two -- often several metres, since a
  // car park's frontage is a dropped kerb and no footway to speak of -- was the pale concrete
  // underlay: a slab of sidewalk eight metres deep along the front of every lot. It is the
  // lot's own asphalt.
  const forecourt = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    const span = Math.hypot(bx - ax, bz - az);
    if (span < 3) continue;
    const kerb = nearestKerbAt((ax + bx) / 2, (az + bz) / 2, PARKING_FORECOURT_MAX_M);
    if (!kerb) continue;
    // The kerb has to face this edge: its way out of the road points at the lot.
    const toEdge = [(ax + bx) / 2 - kerb.x, (az + bz) / 2 - kerb.z];
    const away = Math.hypot(toEdge[0], toEdge[1]) || 1;
    if ((toEdge[0] * kerb.nx + toEdge[1] * kerb.nz) / away < 0.75) continue;
    // Along the kerb's own direction, the edge should run roughly parallel to it.
    const ex = (bx - ax) / span, ez = (bz - az) / span;
    if (Math.abs(ex * kerb.ax + ez * kerb.az) < 0.8) continue;
    const walk = PARKING_FORECOURT_WALK_M;
    const corners = [];
    for (const [px, pz] of [[ax, az], [bx, bz]]) {
      const depth = (px - kerb.x) * kerb.nx + (pz - kerb.z) * kerb.nz;   // out from the kerb
      const pull = depth - walk;                                          // to the walk's outer edge
      if (pull < 0.3) { corners.length = 0; break; }
      corners.push([px - kerb.nx * pull, pz - kerb.nz * pull]);
    }
    if (corners.length !== 2) continue;
    forecourt.push([[ax, az], [bx, bz], corners[1], corners[0]]);
  }
  if (forecourt.length) {
    const positions = [];
    const uvs = [];
    const index = [];
    for (const quad of forecourt) {
      const base = positions.length / 3;
      for (const [x, z] of quad) { positions.push(x, PARKING_Y, z); uvs.push(x, z); }
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const apron = new THREE.Mesh(geometry, ground.material);
    apron.userData.surface = "parking_lot";
    group.add(apron);
  }

  // The stalls. A lot is laid out from its frontage -- the edge that faces the street it opens
  // onto -- in rows parallel to it: a row nosed in along the frontage (broken at the entrance),
  // a two-way aisle, then double rows back to back with an aisle between each pair, and a row
  // against the back. A drive aisle runs across each end so the aisles join into a loop. Each
  // stall is divided from the next by one painted line and has a wheel stop at its head. A
  // stall is only kept where the whole of it is lot: inside the ring, on nothing else.
  const inside = (x, z) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const stripes = [];
  const stops = [];
  const accessible = [];
  const layout = parkingLayout(ring, PARKING_FORECOURT_MAX_M);
  const rejected = { ring: 0, carriageway: 0, pavement: 0 };
  if (layout) {
    const { ox, oz, ex, ez, nx, nz, u0, u1, depth } = layout;
    const R = PARKING_BAY_L_M, W = PARKING_BAY_W_M, A = PARKING_AISLE_M;
    const at = (u, v) => [ox + ex * u + nx * v, oz + ez * u + nz * v];
    const m = PARKING_EDGE_M;
    // Rows as [near v, far v, +1 heads toward the frontage side / -1 toward the back].
    const rows = [];
    const room = depth - 2 * m;
    if (room >= 2 * R + A) {
      rows.push({ va: m, vb: m + R, head: m, front: true });
      const between = room - 2 * R;
      const doubles = Math.max(0, Math.floor((between - A) / (2 * R + A)));
      const aisle = (between - doubles * 2 * R) / (doubles + 1);
      let v = m + R + aisle;
      for (let d = 0; d < doubles; d += 1) {
        rows.push({ va: v, vb: v + R, head: v + R }, { va: v + R, vb: v + 2 * R, head: v + R });
        v += 2 * R + aisle;
      }
      rows.push({ va: depth - m - R, vb: depth - m, head: depth - m });
    } else if (room >= R + 4.0) {
      rows.push({ va: depth - m - R, vb: depth - m, head: depth - m });   // one row, at the back
    }
    // End aisles: a lot long enough to circle keeps a drive aisle clear across each end.
    const span = u1 - u0;
    const ends = span > 4 * W + 2 * PARKING_END_AISLE_M ? PARKING_END_AISLE_M : 0.5;
    const ua = u0 + ends, ub = u1 - ends;
    // The entrance: where a mapped driveway or aisle meets the frontage, else its middle.
    let entryU = (u0 + u1) / 2;
    if (layout.frontage) {
      let best = Infinity;
      for (const w of DATA.ways) {
        if (w.kind !== "street" || !["driveway", "parking_aisle", "access"].includes(w.service) || !w.points) continue;
        for (const p of [w.points[0], w.points[w.points.length - 1]]) {
          const [px, py] = xy(p[0], p[1]);
          const du = (px - ox) * ex + (-py - oz) * ez, dv = (px - ox) * nx + (-py - oz) * nz;
          if (du < u0 || du > u1 || Math.abs(dv) > 8 || Math.abs(dv) >= best) continue;
          best = Math.abs(dv);
          entryU = du;
        }
      }
    }
    const usable = (corners) => {
      for (const [x, z] of corners) {
        if (!inside(x, z)) { rejected.ring += 1; return false; }
        if (insideCarriageway(x, z, 0.2)) { rejected.carriageway += 1; return false; }
      }
      // Under a footway is not lot (the outer, head end may tuck under its edge).
      for (const [x, z] of corners.slice(0, 2)) {
        if ((pavementTopAt(x, z) || 0) > 0.1) { rejected.pavement += 1; return false; }
      }
      return true;
    };
    let firstAccessible = true;
    for (const row of rows) {
      const count = Math.floor((ub - ua) / W);
      if (count < 1) continue;
      const start = ua + ((ub - ua) - count * W) / 2;
      const keep = [];
      for (let s = 0; s < count; s += 1) {
        const sa = start + s * W, sb = sa + W;
        // The entrance gap in the front row.
        if (row.front && sb > entryU - PARKING_ENTRY_M / 2 && sa < entryU + PARKING_ENTRY_M / 2) { keep.push(false); continue; }
        // Aisle end (open to the aisle) first in the list, head end last.
        const aisleV = row.head === row.va ? row.vb : row.va;
        keep.push(usable([at(sa, row.head), at(sb, row.head), at(sb, aisleV), at(sa, aisleV), at((sa + sb) / 2, (row.va + row.vb) / 2)]));
      }
      for (let s = 0; s <= count; s += 1) {
        // A dividing line wherever a kept stall has an edge.
        if (!keep[s - 1] && !keep[s]) continue;
        const u = start + s * W;
        const [ax, az] = at(u, row.va), [bx, bz] = at(u, row.vb);
        stripes.push([ax, az, bx, bz]);
      }
      for (let s = 0; s < count; s += 1) {
        if (!keep[s]) continue;
        const uc = start + (s + 0.5) * W;
        const inward = row.head === row.va ? 1 : -1;
        const [sx, sz] = at(uc, row.head + inward * 0.75);
        stops.push([sx, sz]);
        // One accessible stall, on the front row beside the entrance, painted blue.
        if (firstAccessible && row.front && Math.abs(uc - entryU) < PARKING_ENTRY_M / 2 + W * 1.6) {
          accessible.push([at(uc - W / 2 + 0.06, row.va), at(uc + W / 2 - 0.06, row.va),
                           at(uc + W / 2 - 0.06, row.vb), at(uc - W / 2 + 0.06, row.vb)]);
          firstAccessible = false;
        }
      }
    }
    way._parking = { layout, rows: rows.length, entryU, endAisles: ends };
  }
  const lineGeometry = (segments, width) => {
    const positions = [], index = [];
    for (const [ax, az, bx, bz] of segments) {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len * width / 2, pz = dx / len * width / 2;
      const base = positions.length / 3;
      positions.push(ax + px, PARKING_LINE_Y, az + pz, ax - px, PARKING_LINE_Y, az - pz,
                     bx - px, PARKING_LINE_Y, bz - pz, bx + px, PARKING_LINE_Y, bz + pz);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  };
  if (accessible.length) {
    const positions = [], index = [];
    for (const quad of accessible) {
      const base = positions.length / 3;
      for (const [x, z] of quad) positions.push(x, PARKING_LINE_Y - 0.004, z);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const blue = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: 0x2a5d9f, roughness: 0.8, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    blue.userData.surface = "parking_bays";
    group.add(blue);
  }
  if (stops.length) {
    const parts = [];
    for (const [sx, sz] of stops) {
      const box = new THREE.BoxGeometry(1.8, 0.12, 0.15);
      const yaw = layout ? Math.atan2(-layout.ez, layout.ex) : 0;
      box.rotateY(yaw);
      box.translate(sx, PARKING_Y + 0.06, sz);
      parts.push(box);
    }
    const merged = mergeParts(parts);
    if (merged) {
      const stopsMesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.9 }));
      stopsMesh.userData.surface = "parking_wheel_stop";
      stopsMesh.castShadow = true;
      group.add(stopsMesh);
    }
  }
  way._parking = { ...(way._parking || {}), stripes: stripes.length, stops: stops.length, rejected };
  if (stripes.length) {
    const lines = new THREE.Mesh(lineGeometry(stripes, MARK_W), new THREE.MeshStandardMaterial({
      color: 0xe9ebe6, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    }));
    lines.userData.surface = "parking_bays";
    group.add(lines);
  }
  return group;
}

// Mapped footways first, then everything else.
//
// Pavement comes from two places: the footways OpenStreetMap maps, and the pavement derived from
// each street's own kerb for the blocks it does not map. Drawn in payload order the two
// interleave, so a street laid its derived pavement before the mapped footway beside it existed,
// and both ended up on the ground: two slabs of different widths, with different tile origins,
// a centimetre apart in the same plane. Over a fifth of the paved ground in the corridor was
// doubled that way, and doubled pavement is what "broken tiles" looks like from above.
//
// With the mapped ones laid first, every derived station can ask whether the ground under it is
// already paved -- which is a question pavedGrid can answer, because laying pavement is what
// stamps it. Nothing else in this loop depends on the order: the meshes are merged by material
// and separated by height, not by when they were added.
const ROAD_TOP_M = 0.06;
//: How far the pavement laid from a street's kerb stands below a mapped footway, so that where
//: the two overlap they do not fight. It was 15 mm, a step underfoot wherever one met the other.
//: The street surfaces are cut to one terrain-snapped grid now (STREET_GRID_SURFACES), so the two
//: follow the hill identically and 5 mm is enough; the headset, which has no such grid, keeps 15.
const KERBSIDE_BELOW_MAPPED_M = HEADSET ? 0.015 : 0.005;
//: Set once the pavement index and the carriageways are declared, for the walker, which may ask
//: for the ground before this part of the module has run. (var: read before then.)
var STREET_STANDING = { roadTop: ROAD_TOP_M };
// The Central Freeway is OSM bridge geometry.  Draping its carriageway onto the lidar ground
// puts it through the streets underneath.  Each shared bridge node gets one deck elevation;
// a terminal joined to an at-grade road eases back to that road instead of ending in a step.
const CENTRAL_FREEWAY_WAYS = (DATA.ways || []).filter((way) =>
  way.kind === "street" && way.bridge && way.name === "Central Freeway" && way.points && way.points.length >= 2);
const bridgeNodeKey = (p) => `${p[0].toFixed(6)}:${p[1].toFixed(6)}`;
const CENTRAL_DECK_NODES = new Map();
const GROUND_JOIN_NODES = new Set();
for (const way of DATA.ways || []) {
  if (way.kind !== "street" || way.bridge || !way.points || way.points.length < 2) continue;
  GROUND_JOIN_NODES.add(bridgeNodeKey(way.points[0]));
  GROUND_JOIN_NODES.add(bridgeNodeKey(way.points[way.points.length - 1]));
}
for (const way of CENTRAL_FREEWAY_WAYS) {
  for (const p of [way.points[0], way.points[way.points.length - 1]]) {
    const [x, y] = xy(p[0], p[1]);
    const key = bridgeNodeKey(p);
    const deck = groundLiftAt(x, -y) + 5.2 * Math.max(1, Math.min(2, Number(way.layer) || 1));
    CENTRAL_DECK_NODES.set(key, Math.max(deck, CENTRAL_DECK_NODES.get(key) || -Infinity));
  }
}
function centralFreewayProfile(way) {
  // Solved with the interchanges it belongs to (solveDeckLevels); the old two-end line otherwise.
  if (CENTRAL_SOLVED.has(way)) return CENTRAL_SOLVED.get(way);
  const pts = way.points || [];
  if (pts.length < 2) return null;
  const ends = [pts[0], pts[pts.length - 1]];
  const heights = ends.map((p) => {
    const [x, y] = xy(p[0], p[1]);
    const key = bridgeNodeKey(p);
    return GROUND_JOIN_NODES.has(key) ? groundLiftAt(x, -y) : CENTRAL_DECK_NODES.get(key);
  });
  const local = pts.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  const lengths = [0];
  for (let i = 1; i < local.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(local[i][0] - local[i - 1][0], local[i][1] - local[i - 1][1]));
  const total = lengths[lengths.length - 1] || 1;
  return (x, z) => {
    let nearest = { d: Infinity, s: 0 };
    for (let i = 1; i < local.length; i += 1) {
      const [ax, az] = local[i - 1], [bx, bz] = local[i];
      const dx = bx - ax, dz = bz - az, n = dx * dx + dz * dz;
      const t = n ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / n)) : 0;
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < nearest.d) nearest = { d, s: lengths[i - 1] + Math.sqrt(n) * t };
    }
    return heights[0] + (heights[1] - heights[0]) * nearest.s / total;
  };
}
function addCentralFreewayDetails(way, points, width, deckAt) {
  for (const side of [-1, 1]) {
    const edge = offsetWay(points, side * Math.max(0, width / 2 - 0.18));
    const parapet = ribbon(edge, 0.36, 0xb9b9b3, 1, ROAD_TOP_M + 0.48, 0.96, "bridge_parapet");
    if (parapet) addMerged("bridge:parapet", parapet, "bridge_parapet");
  }
  // Columns are deliberately tagged visual/inferred.  They do not alter the canonical road
  // or its collision and are omitted where the deck is too low for a pier.
  const stations = densifyWay(points, 24);
  for (let i = 1; i + 1 < stations.length; i += 1) {
    const [x, y] = xy(stations[i][0], stations[i][1]), z = -y;
    const earth = groundLiftAt(x, z), deck = deckAt(x, z);
    if (deck - earth < 3.5) continue;
    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, deck - earth, 8),
      new THREE.MeshStandardMaterial({ color: 0x9a9d9b, roughness: 0.94 }));
    support.position.set(x, (deck + earth) / 2, z);
    support.userData.surface = "bridge_support";
    support.userData.provenance = "inferred_visual";
    support.userData.liftedOntoGround = true;
    groups.streets.add(support);
  }
}
//: A crossing's paint has a vertex every this far along its legs, for settleOnto.
const CROSSING_PAINT_STEP_M = 0.5;
indexMappedDividerGeometry(DATA.ways);
for (const way of DATA.ways) {
  if (way.kind !== "crossing" || !way.points || way.points.length < 2) continue;
  if (wayLength(way.points) > 40) continue;
  const span = crossingRectanglePoints(way.points);
  if (!span || span.length < 2) continue;
  indexMappedCrossing(span);
  const crossingWidth = way.crossing_m || 3.7;
  addCrossingAsphaltBackstop(span, crossingWidth, ROAD_TOP_M);
}
// ---- the region's own bridges: decks carried between their abutments -------------------------
//
// A street on a bridge was laid on the ground like any other, and the lidar's ground under an
// overpass is whatever the bridge crosses: Oakland's streets over the I-980 cutting went down
// into it and up out of it. A bridge is now carried on a straight deck between its abutments:
// the bridge ways that meet end to end are taken together, the ends where they meet ordinary
// street are the abutments, and the deck's height anywhere along them is drawn from the
// ground's height at those (weighted by nearness). Each deck has a concrete parapet along both
// edges, and piers down to the ground wherever it stands clear of it.
// ---- busways and the stations in the middle of the road --------------------------------------
//
// A busway (OpenStreetMap highway=busway: Van Ness's rapid transit) is the lanes down the middle
// of another street. It is drawn as a street of its own lanes' width (the payload's busway_lanes),
// painted red between junctions. A station on it is an island: the map draws its canopy as a building
// (building=yes, amenity=shelter) and the page drew that as a ten-metre house in the road. A
// structure tagged a shelter, or a small one with no measured height standing beside a busway,
// is drawn as what it is: a raised platform with its tactile edges, the canopy on its posts, a
// windscreen and benches; the agencies' stops on it stand on it rather than at the far kerb.
const BUSWAY_WAYS = (DATA.ways || []).filter((way) => way.busway && way.points && way.points.length >= 2);
const BUSWAY_SEGMENTS = BUSWAY_WAYS.flatMap((way) => {
  const pts = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  return pts.slice(1).map((b, i) => [pts[i][0], pts[i][1], b[0], b[1], (way.road_m || 7.2) / 2]);
});
function nearBusway(x, z, reach) {
  for (const [ax, az, bx, bz] of BUSWAY_SEGMENTS) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    if (Math.hypot(ax + dx * t - x, az + dz * t - z) < reach) return true;
  }
  return false;
}
//: Is a street lying across this direction here -- a cross street over the busway? A divided
//: avenue meets its cross streets at two T junctions, one each side, and neither junction's
//: box reaches the busway between them: the red ran on through the crossroads.
function crossStreetAt(x, z, dx, dz) {
  const length = Math.hypot(dx, dz);
  if (!(length > 1e-6)) return false;
  const ux = dx / length, uz = dz / length;
  const bucket = carriagewayGrid.get(Math.floor(x / CARRIAGEWAY_CELL) * 1048576 + Math.floor(z / CARRIAGEWAY_CELL));
  if (!bucket) return false;
  for (const [ax, az, bx, bz, half, bearing, source] of bucket) {
    if (source && source.busway) continue;
    if (Math.abs(Math.cos(bearing) * ux + Math.sin(bearing) * uz) > 0.6) continue;
    if (distanceToSegmentSquared(x, z, ax, az, bx, bz) <= half * half) return true;
  }
  return false;
}

//: The busway nearest a point: where on it, its direction, its half width, and which side of it
//: the point lies.
function nearestBuswayAt(x, z, reach) {
  let best = null;
  for (const [ax, az, bx, bz, half] of BUSWAY_SEGMENTS) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (l * l)));
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(px - x, pz - z);
    if (d < reach && (!best || d < best.distance)) {
      const ux = dx / l, uz = dz / l;
      best = { x: px, z: pz, ux, uz, half, distance: d, side: ((x - px) * -uz + (z - pz) * ux) >= 0 ? 1 : -1 };
    }
  }
  return best;
}
const TRANSIT_CANOPIES = [];
function isTransitCanopy(way) {
  const tags = way.tags || {};
  if (tags.amenity === "shelter" || tags.shelter_type === "public_transport") return true;
  if (!BUSWAY_SEGMENTS.length || !way.points || !way.centroid) return false;
  // A measured height over a storey is a building; a guessed one says nothing.
  if (way.height_source && !String(way.height_source).startsWith("inferred") && way.height_m > 6) return false;
  const area = footprintArea(way.points);
  if (!(area < 90)) return false;
  const [x, y] = xy(way.centroid[0], way.centroid[1]);
  return nearBusway(x, -y, 9);
}
const REGION_BRIDGE_WAYS = (DATA.ways || []).filter((way) => way.kind === "street" && way.bridge && !way.tunnel
  && way.points && way.points.length >= 2 && !CENTRAL_FREEWAY_WAYS.includes(way)
  && !/Transbay|Bus Ramp/i.test(way.name || ""));
const INFERRED_BRIDGE_CLEARANCE_M=4.8,REGION_DECK_DEPTH_M=1.2;
function bridgeClearanceControls(ways) {
  const controls=new Map();
  for(const way of ways)for(let i=1;i<way.points.length;i++) {
    const [ax,ay]=xy(...way.points[i-1]),[bx,by]=xy(...way.points[i]),az=-ay,bz=-by;
    const rx=bx-ax,rz=bz-az,length=Math.hypot(rx,rz),seen=new Set();
    if(length<.1)continue;
    for(let ix=Math.floor(Math.min(ax,bx)/CARRIAGEWAY_CELL);ix<=Math.floor(Math.max(ax,bx)/CARRIAGEWAY_CELL);ix++)
      for(let iz=Math.floor(Math.min(az,bz)/CARRIAGEWAY_CELL);iz<=Math.floor(Math.max(az,bz)/CARRIAGEWAY_CELL);iz++)
        for(const [cx,cz,dx,dz,,bearing,source] of carriagewayGrid.get(ix*1048576+iz)||[]) {
          if(!source || source.kind!=="street" || source.bridge || source.tunnel || source.underground)continue;
          const key=[cx,cz,dx,dz].join(':');if(seen.has(key))continue;seen.add(key);
          const sx=dx-cx,sz=dz-cz,den=rx*sz-rz*sx;
          if(Math.abs(den)<.3*length*Math.hypot(sx,sz))continue;
          const t=((cx-ax)*sz-(cz-az)*sx)/den,u=((cx-ax)*rz-(cz-az)*rx)/den;
          // Shared ends are bridge ramps/junctions, not an undercrossing.
          if(t<0 || t>1 || u<=.001 || u>=.999)continue;
          const x=ax+rx*t,z=az+rz*t;
          const target=groundLiftAt(x,z)+INFERRED_BRIDGE_CLEARANCE_M+REGION_DECK_DEPTH_M;
          controls.set(Math.round(x*10)+':'+Math.round(z*10),{x,z,target,bearing,half:source.road_m/2 || 4});
        }
  }
  return [...controls.values()];
}
function bridgeClearanceProfile(base,abutments,controls) {
  if(!controls.length)return base;
  const lift=(x,z)=>{
    const original=base(x,z),endDistance=Math.min(...abutments.map(([ax,az])=>Math.hypot(x-ax,z-az)));
    let required=original;
    for(const c of controls)required=Math.max(required,c.target-.08*Math.hypot(x-c.x,z-c.z));
    // Keep every existing abutment exact; never create a vertical step at a ramp.
    return original+(required-original)*Math.min(1,endDistance/20);
  };
  lift.clearanceBasis="inferred_visual_not_measured";lift.clearanceControls=controls;
  return lift;
}
