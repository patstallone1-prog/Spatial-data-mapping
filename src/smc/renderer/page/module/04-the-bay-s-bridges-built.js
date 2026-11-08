// ---- the Bay's bridges, built as they are built ------------------------------------------------
//
// Every bridge the atlas has over the water, from the map's own ways: a deck of lanes with a
// walkway and a railing either side, a structure under it, and piers to the water. The great
// crossings are built to their designs and in their colours, each as one structure from the
// map's carriageways (which it draws a way for each direction or each deck):
//
// * the Golden Gate: International Orange, two stepped Art Deco towers 227 m over the water with
//   their four portal struts above the deck, the main cables over the tower tops and the
//   suspenders down from them every 15 m, the stiffening truss under the deck, six lanes, and a
//   red walkway each side behind an orange railing, from one headland to the other;
// * the Bay Bridge: the west span's twin suspension spans in grey, X-braced steel towers and the
//   double deck, from Rincon Hill to Yerba Buena Island; the east span's white self-anchored
//   tower and the Skyway's twin concrete girders down to the Oakland shore;
// * Richmond-San Rafael's grey cantilever trusses over the channels on a long trestle;
// * San Mateo-Hayward and the Dumbarton: long low trestles with a high-rise over the channel.
//
// Every end meets the ground it lands on at the ground's own height: where the map's way stops on
// a headland (the Golden Gate's bluffs, Yerba Buena Island) the headland is there, at the deck's
// level; everywhere else the deck comes down on a viaduct, no steeper than a road, to the ground
// beside it. Heights are the atlas's (the sea and the land as drawn round the regions), lowered
// with the Earth's curve like everything else out there.
// (A function: buildBayBridges runs, from the perimeter, before this part of the page has.)
function bridgePaint() { return {
  goldenGate: 0xc0362c, bayGrey: 0x9aa3a8, sasWhite: 0xe4e6e3, concrete: 0xbab6ad, steelGrey: 0x7d868c,
  asphalt: 0x3a3d40, walkRed: 0xa4402e, walkGrey: 0x9a978f, railGrey: 0xa9aeb1,
}; }
//: What a bridge is, from its name.
function bridgeDesign(name) {
  if (/Golden Gate Bridge/.test(name || "")) return "golden_gate";
  if (/Eisenhower/.test(name || "")) return "bay";
  if (/Richmond-San Rafael/.test(name || "")) return "richmond";
  if (/San Mateo - Hayward|Dumbarton/.test(name || "")) return "trestle";
  return "girder";
}
//: A line resampled to n points at equal spacing along it.
function resampleLine(pts, n) {
  const ds = [0];
  for (let i = 1; i < pts.length; i += 1) ds.push(ds[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = ds[ds.length - 1] || 1;
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k += 1) {
    const s = total * k / (n - 1);
    while (j < pts.length - 1 && ds[j] < s) j += 1;
    const t = (s - ds[j - 1]) / ((ds[j] - ds[j - 1]) || 1);
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t]);
  }
  return { pts: out, length: total };
}
//: The middle line of a bridge drawn as several parallel ways (a way a direction, or a deck).
function bridgeCentreline(ways) {
  const n = 200;
  const lines = ways.map((w) => w.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; }));
  const ref = lines[0];
  const aligned = lines.map((line) => {
    // Every way run the same way as the first.
    const d0 = Math.hypot(line[0][0] - ref[0][0], line[0][1] - ref[0][1]);
    const d1 = Math.hypot(line[line.length - 1][0] - ref[0][0], line[line.length - 1][1] - ref[0][1]);
    return d1 < d0 ? line.slice().reverse() : line;
  });
  const sampled = aligned.map((line) => resampleLine(line, n).pts);
  const pts = [];
  for (let k = 0; k < n; k += 1) {
    let sx = 0, sz = 0;
    for (const line of sampled) { sx += line[k][0]; sz += line[k][1]; }
    pts.push([sx / sampled.length, sz / sampled.length]);
  }
  return resampleLine(pts, n);
}

function buildBayBridges(g) {
  const BRIDGE_PAINT = bridgePaint();
  const ROAD_TOP_BRIDGE_M = 0.08;
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const water = SEA_Y - 0.02 - PERIMETER_UNDER_M;      // the sea as the atlas draws it
  const land = PENINSULA_Y - PERIMETER_UNDER_M;          // the land as the atlas draws it
  const groundAt = (x, z) => {
    const local=g ? pageToTerrain(x,z,g) : null;
    const inside = g && local[0] >= g.x0 && local[0] <= g.x0 + g.cols * g.step_m
      && local[1] >= g.y0 && local[1] <= g.y0 + g.rows * g.step_m;
    if (inside) return cutLiftAt(x, z) + ROAD_TOP_BRIDGE_M;
    if(typeof NATURE!=="undefined"&&NATURE&&!perimeterWaterAt(x,z))return rawTerrainHeightAt(x,z)+.15;
    return (perimeterWaterAt(x, z) ? water : land) + 0.15;
  };
  const materials = new Map();
  const mat = (color, opts = {}) => {
    const key = `${color}:${JSON.stringify(opts)}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, ...opts }));
    return materials.get(key);
  };
  const out = new THREE.Group();
  out.name = "bridges";
  out.userData.bayWide = true;
  const counts = { structures: 0, piers: 0, towers: 0, ramps: 0, headlands: 0 };
  // Everything is built in the atlas's heights, then lowered by the Earth's curve where it stands.
  const drop = (geometry) => {
    const p = geometry.getAttribute("position");
    for (let i = 0; i < p.count; i += 1) p.setY(i, p.getY(i) - earthDrop(p.getX(i), p.getZ(i)));
    p.needsUpdate = true;
    geometry.computeBoundingSphere();
    return geometry;
  };
  const boxes = new Map();       // material -> [matrix]
  const addBox = (material, x, y, z, w, h, d, yaw = 0) => {
    if (!boxes.has(material)) boxes.set(material, []);
    const e = earthDrop(x, z);
    boxes.get(material).push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - e, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(w, h, d)));
  };
  // A lane texture: asphalt and the white lines between the lanes, repeating down the deck.
  const laneMaps = new Map();
  const lanesMaterial = (lanes, median) => {
    const key = `${lanes}:${median}`;
    if (laneMaps.has(key)) return laneMaps.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#3d4043"; ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 2600; i += 1) { ctx.fillStyle = i % 2 ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.06)"; ctx.fillRect(random(i * 7) * 256, random(i * 13) * 128, 2, 2); }
    for (let lane = 1; lane < lanes; lane += 1) {
      const u = lane / lanes * 256;
      if (median && lane === lanes / 2) { ctx.fillStyle = "#c9b23c"; ctx.fillRect(u - 5, 0, 10, 128); continue; }
      ctx.fillStyle = "#e9e9e4"; ctx.fillRect(u - 1.5, 0, 3, 64);
    }
    ctx.fillStyle = "#e9e9e4"; ctx.fillRect(2, 0, 3, 128); ctx.fillRect(251, 0, 3, 128);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.9, side: THREE.DoubleSide });
    laneMaps.set(key, m);
    return m;
  };
  // A lattice for the trusses: the steel as bars with the sky between them.
  const trussMaps = new Map();
  const trussMaterial = (color) => {
    if (trussMaps.has(color)) return trussMaps.get(color);
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 128, 64);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 7;
    ctx.strokeRect(3, 3, 122, 58);
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(64, 0); ctx.lineTo(128, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64, 64); ctx.stroke();
    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const m = new THREE.MeshStandardMaterial({ color, map, alphaTest: 0.4, transparent: false, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    trussMaps.set(color, m);
    return m;
  };
  //: A strip swept along the deck: across from a to b, at heights ya and yb over the deck.
  const strip = (stations, a, b, ya, yb, material, vRepeatM = 12) => {
    const position = [], uv = [], index = [];
    let s = 0;
    stations.forEach((st, i) => {
      if (i) s += Math.hypot(st.x - stations[i - 1].x, st.z - stations[i - 1].z);
      position.push(st.x + st.rx * a, st.y + ya, st.z + st.rz * a, st.x + st.rx * b, st.y + yb, st.z + st.rz * b);
      uv.push(0, s / vRepeatM, 1, s / vRepeatM);
      if (i) { const k = i * 2; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(drop(geometry), material);
    mesh.userData.surface = "bridge";
    out.add(mesh);
    return mesh;
  };
  //: A tube along a curve: a cable.
  const cable = (points, radius, material) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const mesh = new THREE.Mesh(drop(new THREE.TubeGeometry(curve, Math.max(16, points.length * 2), radius, 6, false)), material);
    mesh.userData.surface = "bridge_cable";
    out.add(mesh);
  };
  //: The bridge being built, by name (what its deck is, to the walker: elevatedDecksAt).
  let deckName = null;
  //: The deck along a line, at heights h, with its lanes, walkways, railings and its underside.
  const deck = (stations, spec) => {
    const { width, lanes, walk, walkColor, railColor, depth = 2.2, median = false, structure = null } = spec;
    const half = width / 2, road = half - walk;
    // Where its road is, for what is laid on it (a route's line: elevatedRoadsAt). Built in the
    // atlas's heights and lowered by the Earth's curve, as the deck is.
    const info = { kind: "bridge", name: spec.name || deckName, reach: half, walkway: road, walkTop: 0.22 };
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1], b = stations[i];
      registerElevatedSegment(a.x, a.z, a.y - earthDrop(a.x, a.z), b.x, b.z, b.y - earthDrop(b.x, b.z), road, info);
    }
    strip(stations, -road, road, 0, 0, lanesMaterial(lanes, median), 14);
    const railMat = mat(railColor, { metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      strip(stations, side * road, side * half, 0.22, 0.22, mat(walkColor, { roughness: 0.85, side: THREE.DoubleSide }));
      strip(stations, side * road, side * road, 0, 0.22, mat(BRIDGE_PAINT.concrete, { side: THREE.DoubleSide }));
      // The railing: a solid top rail and a mid rail (box sections, not a flat ribbon), posts,
      // and the bars between them. It was one painted strip: a fence of paper from the walkway.
      rail(stations, side * (half - 0.06), 1.2, 1.36, 0.14, railMat);
      rail(stations, side * (half - 0.06), 0.62, 0.7, 0.08, railMat);
      strip(stations, side * (half - 0.06), side * (half - 0.06), 0.22, 1.2, trussMaterial(railColor), 1.4);
      posts(stations, side * (half - 0.06), 0.22, 1.36, 0.14, railColor, 2.6);
      // Between the lanes and the walkway, where it is wide enough to walk, a steel traffic
      // barrier on posts: the walkway is a path of its own, not the road's verge.
      if (walk >= 1.5) {
        rail(stations, side * (road + 0.12), 0.62, 0.95, 0.12, mat(BRIDGE_PAINT.railGrey, { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }));
        posts(stations, side * (road + 0.12), 0.22, 0.95, 0.14, BRIDGE_PAINT.railGrey, 3.2);
      }
      // The deck's edge.
      strip(stations, side * half, side * half, -depth, 0.22, mat(structure || BRIDGE_PAINT.concrete, { side: THREE.DoubleSide }));
    }
    strip(stations, -half, half, -depth, -depth, mat(structure || BRIDGE_PAINT.concrete, { side: THREE.DoubleSide }));
  };
  //: A rail along the deck: a box section `w` wide at offset `off`, from y0 to y1 over the deck.
  function rail(stations, off, y0, y1, w, material) {
    strip(stations, off - w / 2, off - w / 2, y0, y1, material);
    strip(stations, off + w / 2, off + w / 2, y0, y1, material);
    strip(stations, off - w / 2, off + w / 2, y1, y1, material);
  }
  //: Posts along the deck every `spacing` metres at offset `off`, from y0 to y1 over the deck.
  function posts(stations, off, y0, y1, w, color, spacing) {
    let s = 0, next = spacing / 2;
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1], b = stations[i], len = Math.hypot(b.x - a.x, b.z - a.z);
      while (next <= s + len) {
        const t = (next - s) / (len || 1), y = a.y + (b.y - a.y) * t;
        addBox(mat(color, { metalness: 0.5, roughness: 0.4 }), a.x + (b.x - a.x) * t + a.rx * off, y + (y0 + y1) / 2, a.z + (b.z - a.z) * t + a.rz * off,
          w, y1 - y0, w, Math.atan2(a.ux, a.uz));
        next += spacing;
      }
      s += len;
    }
  }
  //: Stations along a line: position, height, the way across (r) and the way along (u).
  const stationsFor = (line, heights) => line.map(([x, z], i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    return { x, z, y: heights[i], ux, uz, rx: -uz, rz: ux };
  });
  //: Piers from the deck to the water or the ground every spacing metres.
  const piers = (stations, spacing, width, color, skip = () => false) => {
    let s = 0, next = spacing / 2;
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1], b = stations[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      while (next <= s + len) {
        const t = (next - s) / (len || 1);
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, top = a.y + (b.y - a.y) * t - 2.2;
        const base = perimeterWaterAt(x, z) ? water - 2 : groundAt(x, z) - 0.5;
        if (top - base > 1.5 && !skip(next)) {
          for (const side of [-1, 1]) addBox(mat(color), x + a.rx * side * width * 0.3, (top + base) / 2, z + a.rz * side * width * 0.3, 2.2, top - base, 2.2, Math.atan2(a.ux, a.uz));
          addBox(mat(color), x, top - 0.8, z, 2.2, 1.6, width * 0.8, Math.atan2(a.ux, a.uz));
          counts.piers += 1;
        }
        next += spacing;
      }
      s += len;
    }
  };
  //: A headland under a bridge's end: the ground up to the deck, falling away round it.
  const headland = (x, z, top, radius) => {
    if(typeof NATURE!=="undefined"&&NATURE)return; // actual 3DEP land replaces invented green mounds
    const rings = 24, segs = 48, plateau = radius * 0.32;
    const position = [], colour = [], index = [];
    const green = new THREE.Color(0x5d7a45), dry = new THREE.Color(0x8a7d55);
    for (let r = 0; r <= rings; r += 1) {
      const rr = radius * r / rings;
      const t = Math.max(0, (rr - plateau) / (radius - plateau));
      const h = land + (top - land) * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, t)));
      for (let k = 0; k < segs; k += 1) {
        const a = k / segs * Math.PI * 2;
        const wobble = 1 + 0.12 * Math.sin(a * 3 + x * 0.01) * (r / rings);
        position.push(x + Math.cos(a) * rr * wobble, h - 0.6, z + Math.sin(a) * rr * wobble);
        const c = green.clone().lerp(dry, 0.35 * Math.sin(a * 5) * Math.sin(a * 5) + 0.15 * t);
        colour.push(c.r, c.g, c.b);
        if (r) {
          const i0 = (r - 1) * segs + k, i1 = (r - 1) * segs + (k + 1) % segs, i2 = r * segs + k, i3 = r * segs + (k + 1) % segs;
          index.push(i0, i2, i1, i1, i2, i3);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(drop(geometry), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    mesh.userData.surface = "bridge_headland";
    out.add(mesh);
    counts.headlands += 1;
  };
  //: Where an end comes down: a viaduct on, at a road's grade, to the ground beside it.
  const RAMP_GRADE = 0.045;
  const ramp = (end, before, top, spec) => {
    const ux = end[0] - before[0], uz = end[1] - before[1], len = Math.hypot(ux, uz) || 1;
    const line = [], heights = [];
    let y = top, s = 0;
    while (s < 3000) {
      const x = end[0] + ux / len * s, z = end[1] + uz / len * s;
      const g0 = groundAt(x, z);
      line.push([x, z]);
      heights.push(Math.max(g0, y));
      if (y <= g0) break;
      s += 10; y -= RAMP_GRADE * 10;
    }
    if (line.length < 2) return;
    const st = stationsFor(line, heights);
    deck(st, spec);
    piers(st, 30, spec.width, BRIDGE_PAINT.concrete);
    counts.ramps += 1;
  };
  // ---- the bridges, by design ----
  const ways = PERIMETER.bridges.filter((b) => b.over_water.some(Boolean) && b.points.length >= 2);
  const named = new Map();
  for (const way of ways) {
    const design = bridgeDesign(way.name);
    deckName = way.name || null;
    if (design === "girder" || design === "trestle") continue;
    // The Bay Bridge's west span and its east span are two structures either side of the island.
    const key = design === "bay" ? (Math.min(...way.points.map((p) => p[0])) < -122.366 ? "bay_west" : "bay_east") : design;
    if (!named.has(key)) named.set(key, []);
    named.get(key).push(way);
  }
  const endsShared = (pt, self) => ways.some((w) => w !== self && w.points.some(([lon, lat]) => {
    const [x, y] = xy(lon, lat);
    return Math.hypot(x - pt[0], -y - pt[1]) < 15;
  }));

  // The Golden Gate.
  if (named.has("golden_gate")) {
    deckName = named.get("golden_gate").find((w) => w.name)?.name || "Golden Gate Bridge";
    const { pts, length } = bridgeCentreline(named.get("golden_gate"));
    // Run it south to north: its south anchorage is the end with the smaller latitude.
    const line = pts[0][1] > pts[pts.length - 1][1] ? pts : pts.slice().reverse();
    const ds = [0];
    for (let i = 1; i < line.length; i += 1) ds.push(ds[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const total = ds[ds.length - 1];
    const side = 343 * total / 1966, main = total - 2 * side, mid = total / 2;
    const deckAt = (s) => {
      if (s < side) return water + 60 + (s / side);
      if (s > total - side) return water + 60 + ((total - s) / side);
      const t = (s - mid) / (main / 2);
      return water + 61 + 6 * (1 - t * t);
    };
    const st = stationsFor(line, ds.map(deckAt));
    const spec = { width: 27.4, lanes: 6, walk: 3.0, walkColor: BRIDGE_PAINT.walkRed, railColor: BRIDGE_PAINT.goldenGate,
                   structure: BRIDGE_PAINT.goldenGate, depth: 2.4, median: true };
    deck(st, spec);
    // The stiffening truss under the deck, 7.6 m deep, along the suspended spans.
    for (const sgn of [-1, 1]) strip(st, sgn * 13.7, sgn * 13.7, -9.9, -2.4, trussMaterial(BRIDGE_PAINT.goldenGate), 15);
    strip(st, -13.7, 13.7, -9.9, -9.9, trussMaterial(BRIDGE_PAINT.goldenGate), 15);
    const orange = mat(BRIDGE_PAINT.goldenGate, { roughness: 0.55, metalness: 0.25 });
    const at = (s) => {
      let i = 1; while (i < ds.length - 1 && ds[i] < s) i += 1;
      const t = (s - ds[i - 1]) / ((ds[i] - ds[i - 1]) || 1);
      const a = st[i - 1], b = st[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, rx: a.rx, rz: a.rz, ux: a.ux, uz: a.uz };
    };
    const towerTop = water + 227, legOff = 16.6;
    for (const s of [side, total - side]) {
      const p = at(s);
      const yaw = Math.atan2(p.ux, p.uz);
      // The pier the tower stands on, in the water.
      addBox(mat(BRIDGE_PAINT.concrete), p.x, water + 6, p.z, 50, 16, 34, yaw);
      // Each leg in setbacks: narrower as it rises, the Art Deco stepping of the original.
      for (const sgn of [-1, 1]) {
        const lx = p.x + p.rx * sgn * legOff, lz = p.z + p.rz * sgn * legOff;
        const steps = [[water + 14, water + 75, 10.4, 16.2], [water + 75, water + 130, 9.4, 14.6], [water + 130, water + 175, 8.4, 12.8],
                       [water + 175, water + 210, 7.4, 11.2], [water + 210, towerTop, 6.4, 9.6]];
        for (const [y0, y1, wAcross, dAlong] of steps) {
          addBox(orange, lx, (y0 + y1) / 2, lz, wAcross, y1 - y0, dAlong, yaw);
          // The vertical recesses that make the towers read as fluted.
          addBox(mat(0x9c2a22, { roughness: 0.6 }), lx, (y0 + y1) / 2, lz, wAcross + 0.3, y1 - y0 - 2, dAlong * 0.42, yaw);
        }
        addBox(orange, lx, towerTop + 2, lz, 7.0, 4, 10.4, yaw);          // the saddle housing
      }
      // The portal struts over the deck, and the one under it.
      for (const [y, h] of [[water + 92, 9], [water + 132, 8], [water + 170, 7], [water + 208, 7], [water + 52, 6]]) {
        addBox(orange, p.x, y, p.z, legOff * 2 + 2, h, 6.5, yaw);
        addBox(mat(0x9c2a22), p.x, y, p.z, legOff * 2 - 9, h - 3, 6.8, yaw);
      }
      counts.towers += 1;
    }
    // The main cables: over the tower tops, down to the deck at mid-span, and to the anchorages.
    for (const sgn of [-1, 1]) {
      const pts3 = [];
      for (let s = 0; s <= total; s += total / 120) {
        let y;
        if (s <= side) { const t = s / side; y = water + 64 + (towerTop - water - 64) * t * t; }
        else if (s >= total - side) { const t = (total - s) / side; y = water + 64 + (towerTop - water - 64) * t * t; }
        else { const t = (s - mid) / (main / 2); y = deckAt(s) + 4 + (towerTop - deckAt(s) - 4) * t * t; }
        const p = at(s);
        pts3.push([p.x + p.rx * sgn * legOff, y, p.z + p.rz * sgn * legOff]);
      }
      cable(pts3, 0.46, orange);
      // The suspenders, every 15 m: from the cable down to the deck's edge.
      for (let s = 15; s < total - 5; s += 15) {
        if (Math.abs(s - side) < 8 || Math.abs(s - (total - side)) < 8) continue;
        const p = at(s);
        const k = Math.round(s / (total / 120));
        const cy = pts3[Math.min(pts3.length - 1, k)][1];
        if (cy - p.y < 1) continue;
        addBox(orange, p.x + p.rx * sgn * legOff, (cy + p.y) / 2, p.z + p.rz * sgn * legOff, 0.12, cy - p.y, 0.12);
      }
    }
    // The lamps along the walkways.
    for (let s = 20; s < total; s += 50) {
      const p = at(s);
      for (const sgn of [-1, 1]) {
        addBox(orange, p.x + p.rx * sgn * 13.2, p.y + 4.2, p.z + p.rz * sgn * 13.2, 0.25, 8.4, 0.25);
        addBox(mat(0xfff1c8, { emissive: 0x9a8a60 }), p.x + p.rx * sgn * 12.4, p.y + 8.3, p.z + p.rz * sgn * 12.4, 0.5, 0.25, 0.5);
      }
    }
    // The anchorages, and the headlands the bridge lands on at either end.
    for (const [s, back] of [[0, -1], [total, 1]]) {
      const p = at(s), yaw = Math.atan2(p.ux, p.uz);
      // The anchorage: a mass of concrete under the deck's end, down to the ground. It stood
      // 3 m over the road, a block of stone across the bridge where it met the land.
      const ax = p.x + p.ux * back * 20, az = p.z + p.uz * back * 20, top = p.y - spec.depth - 0.3;
      const foot = Math.min(groundAt(ax, az), top - 6) - 4;
      addBox(mat(BRIDGE_PAINT.concrete), ax, (top + foot) / 2, az, spec.width - 3, top - foot, 50, yaw);
      // Clear of the towers, which stand in the water off Fort Point and Lime Point.
      headland(p.x + p.ux * back * 230, p.z + p.uz * back * 230, p.y - 0.15, 300);
      // The roadway on to the land: it leaves the span at the span's height and meets the
      // ground's road at no more than a 6 per cent grade, on piers while it is over it. A level
      // 180 m of deck ran on into the hillside or out over the slope before.
      const runOn = [], heights = [];
      let met = -1;
      for (let d = 0; d <= 600; d += 10) {
        const x = p.x + p.ux * back * d, z = p.z + p.uz * back * d, g = groundAt(x, z) - 0.05;
        const h = Math.max(p.y - 0.06 * d, Math.min(p.y + 0.06 * d, g));
        runOn.push([x, z]); heights.push(h);
        if (Math.abs(h - g) < 0.3) { if (met < 0) met = d; if (d - met >= 30) break; } else met = -1;
      }
      // The cutting it runs through, where the ground stands over its road.
      if (!BRIDGE_CUTS) BRIDGE_CUTS = [];
      for (let i = 1; i < runOn.length; i += 1) {
        const [ax2, az2] = runOn[i - 1], [bx2, bz2] = runOn[i], pad = spec.width / 2 + 70;
        BRIDGE_CUTS.push({ ax: ax2, az: az2, ay: heights[i - 1], bx: bx2, bz: bz2, by: heights[i], half: spec.width / 2,
          box: [Math.min(ax2, bx2) - pad, Math.min(az2, bz2) - pad, Math.max(ax2, bx2) + pad, Math.max(az2, bz2) + pad] });
      }
      const runSt = stationsFor(runOn, heights);
      deck(runSt, { ...spec, structure: BRIDGE_PAINT.concrete });
      piers(runSt, 40, spec.width, BRIDGE_PAINT.concrete, (d) => d < 50);
    }
    counts.structures += 1;
  }

  // The Bay Bridge's west span: twin suspension spans, double deck, grey.
  if (named.has("bay_west")) {
    deckName = named.get("bay_west").find((w) => w.name)?.name || "San Francisco–Oakland Bay Bridge (west span)";
    const { pts } = bridgeCentreline(named.get("bay_west"));
    // San Francisco to the island: west to east.
    const line = pts[0][0] < pts[pts.length - 1][0] ? pts : pts.slice().reverse();
    const ds = [0];
    for (let i = 1; i < line.length; i += 1) ds.push(ds[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const total = ds[ds.length - 1], centre = total / 2;
    const top = water + 58;
    // On to the deck at the San Francisco end from the ground at a road's grade; level over the water.
    const sfGround = groundAt(...line[0]);
    const heights = ds.map((s) => Math.min(top, sfGround + s * 0.05));
    const st = stationsFor(line, heights);
    const grey = mat(BRIDGE_PAINT.bayGrey, { roughness: 0.5, metalness: 0.35 });
    const spec = { width: 22, lanes: 5, walk: 0.8, walkColor: BRIDGE_PAINT.walkGrey, railColor: BRIDGE_PAINT.railGrey, structure: BRIDGE_PAINT.bayGrey, depth: 1.2 };
    deck(st, spec);
    // The lower deck, 10 m under, in the truss between the two.
    const lower = st.map((p) => ({ ...p, y: p.y - 10.5 }));
    deck(lower, spec);
    for (const sgn of [-1, 1]) strip(st, sgn * 11, sgn * 11, -12, -1.2, trussMaterial(BRIDGE_PAINT.bayGrey), 12);
    const at = (s) => {
      let i = 1; while (i < ds.length - 1 && ds[i] < s) i += 1;
      const t = (s - ds[i - 1]) / ((ds[i] - ds[i - 1]) || 1);
      const a = st[i - 1], b = st[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, rx: a.rx, rz: a.rz, ux: a.ux, uz: a.uz };
    };
    const towerTop = water + 160, legOff = 13;
    const towers = [-1058, -354, 354, 1058].map((d) => centre + d * total / 3200);
    for (const s of towers) {
      const p = at(s), yaw = Math.atan2(p.ux, p.uz);
      addBox(mat(BRIDGE_PAINT.concrete), p.x, water + 5, p.z, 40, 14, 28, yaw);
      for (const sgn of [-1, 1]) addBox(grey, p.x + p.rx * sgn * legOff, (water + 12 + towerTop) / 2, p.z + p.rz * sgn * legOff, 4.5, towerTop - water - 12, 7, yaw);
      // The X-bracing between the legs, panel by panel.
      for (let y = water + 72; y < towerTop - 10; y += 22) {
        addBox(grey, p.x, y, p.z, legOff * 2, 1.6, 2.2, yaw);
        for (const tilt of [-1, 1]) {
          const brace = new THREE.Matrix4().compose(new THREE.Vector3(p.x, y + 11 - earthDrop(p.x, p.z), p.z),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, tilt * Math.atan2(22, legOff * 2), "YXZ")),
            new THREE.Vector3(Math.hypot(22, legOff * 2), 1.0, 1.4));
          if (!boxes.has(grey)) boxes.set(grey, []);
          boxes.get(grey).push(brace);
        }
      }
      counts.towers += 1;
    }
    // The central anchorage, where the two spans meet.
    { const p = at(centre); addBox(mat(BRIDGE_PAINT.concrete), p.x, (water + top + 20) / 2, p.z, 60, top + 20 - water, 46, Math.atan2(p.ux, p.uz)); }
    // The cables of the two spans.
    for (const sgn of [-1, 1]) {
      for (const [a0, t0, t1, a1] of [[0, towers[0], towers[1], centre], [centre, towers[2], towers[3], total]]) {
        const pts3 = [];
        for (let k = 0; k <= 60; k += 1) {
          const s = a0 + (a1 - a0) * k / 60;
          let y;
          if (s <= t0) { const t = (s - a0) / (t0 - a0); y = top + 4 + (towerTop - top - 4) * t * t; }
          else if (s >= t1) { const t = (a1 - s) / (a1 - t1); y = top + 4 + (towerTop - top - 4) * t * t; }
          else { const m = (t0 + t1) / 2, t = (s - m) / ((t1 - t0) / 2); y = top + 4 + (towerTop - top - 4) * t * t; }
          const p = at(s);
          pts3.push([p.x + p.rx * sgn * legOff, y, p.z + p.rz * sgn * legOff]);
        }
        cable(pts3, 0.45, grey);
      }
    }
    piers(st, 60, 22, BRIDGE_PAINT.concrete, (s) => s > 300 && s < total - 50);
    // Yerba Buena Island, where it is, over the deck, with the tunnel's portal.
    const end = at(total);
    { const [ix, iy] = xy(-122.3655, 37.8105); headland(ix, -iy, water + 80, 560); }
    addBox(mat(BRIDGE_PAINT.concrete), end.x + end.ux * 8, top + 6, end.z + end.uz * 8, 30, 26, 6, Math.atan2(end.ux, end.uz));
    addBox(mat(0x0c0c0c), end.x + end.ux * 5, top + 3.5, end.z + end.uz * 5, 18, 6, 1, Math.atan2(end.ux, end.uz));
    addBox(mat(0x0c0c0c), end.x + end.ux * 5, top - 7, end.z + end.uz * 5, 18, 6, 1, Math.atan2(end.ux, end.uz));
    counts.structures += 1;
  }

  // The Bay Bridge's east span: the self-anchored suspension span and the Skyway, white.
  if (named.has("bay_east")) {
    deckName = named.get("bay_east").find((w) => w.name)?.name || "San Francisco–Oakland Bay Bridge (east span)";
    const { pts } = bridgeCentreline(named.get("bay_east"));
    const line = pts[0][0] < pts[pts.length - 1][0] ? pts : pts.slice().reverse();   // the island to Oakland
    const ds = [0];
    for (let i = 1; i < line.length; i += 1) ds.push(ds[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const total = ds[ds.length - 1];
    const oakGround = groundAt(...line[line.length - 1]);
    const top = water + 52;
    const heights = ds.map((s) => s < 1000 ? top : Math.max(oakGround, top - (s - 1000) * ((top - oakGround) / Math.max(1, total - 1050))));
    const st = stationsFor(line, heights);
    const white = mat(BRIDGE_PAINT.sasWhite, { roughness: 0.45, metalness: 0.2 });
    // Two decks side by side, the tower between them on the self-anchored span.
    for (const sgn of [-1, 1]) {
      const offset = st.map((p) => ({ ...p, x: p.x + p.rx * sgn * 15, z: p.z + p.rz * sgn * 15 }));
      deck(offset, { width: 23, lanes: 5, walk: sgn > 0 ? 4.5 : 0.6, walkColor: BRIDGE_PAINT.walkGrey, railColor: BRIDGE_PAINT.sasWhite, structure: BRIDGE_PAINT.sasWhite, depth: 5.5 });
      piers(offset, 160, 20, BRIDGE_PAINT.sasWhite, (s) => s < 860);
    }
    const at = (s) => {
      let i = 1; while (i < ds.length - 1 && ds[i] < s) i += 1;
      const t = (s - ds[i - 1]) / ((ds[i] - ds[i - 1]) || 1);
      const a = st[i - 1], b = st[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, rx: a.rx, rz: a.rz, ux: a.ux, uz: a.uz };
    };
    // The self-anchored span: its tower out in the water east of the island.
    const sasFrom = 240, sasTo = 860, towerS = 560, towerTop = water + 160;
    const p = at(towerS), yaw = Math.atan2(p.ux, p.uz);
    for (const [ox, oz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]])
      addBox(white, p.x + p.rx * ox + p.ux * oz, (water + towerTop) / 2, p.z + p.rz * ox + p.uz * oz, 3.6, towerTop - water, 3.6, yaw);
    addBox(white, p.x, towerTop - 4, p.z, 10, 8, 10, yaw);
    counts.towers += 1;
    // The single cable, looping over the tower and down to each deck's outer edge at both ends.
    for (const sgn of [-1, 1]) {
      const pts3 = [];
      for (let k = 0; k <= 50; k += 1) {
        const s = sasFrom + (sasTo - sasFrom) * k / 50;
        const q = at(s);
        const t = s < towerS ? (towerS - s) / (towerS - sasFrom) : (s - towerS) / (sasTo - towerS);
        const y = towerTop - 4 - (towerTop - 4 - (q.y + 2)) * Math.sqrt(Math.min(1, t));
        pts3.push([q.x + q.rx * sgn * 26, y, q.z + q.rz * sgn * 26]);
      }
      cable(pts3, 0.4, white);
    }
    counts.structures += 1;
    ramp(line[line.length - 1], line[line.length - 2], heights[heights.length - 1], { width: 52, lanes: 10, walk: 1, walkColor: BRIDGE_PAINT.walkGrey, railColor: BRIDGE_PAINT.sasWhite });
  }

  // Richmond-San Rafael: grey cantilever trusses over the channels, double-decked, on a trestle.
  if (named.has("richmond")) {
    deckName = named.get("richmond").find((w) => w.name)?.name || "Richmond–San Rafael Bridge";
    const { pts } = bridgeCentreline(named.get("richmond"));
    const line = pts[0][0] > pts[pts.length - 1][0] ? pts : pts.slice().reverse();   // Richmond (east) first
    const ds = [0];
    for (let i = 1; i < line.length; i += 1) ds.push(ds[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const total = ds[ds.length - 1];
    const humps = [0.24, 0.44].map((f) => f * total);
    const heights = ds.map((s) => {
      const near = Math.min(...humps.map((h) => Math.abs(s - h)));
      const high = near < 350 ? 1 : near < 1200 ? 1 - (near - 350) / 850 : 0;
      const base = water + 14 + 34 * high;
      // Up from the shore at a road's grade.
      const fromEnd = Math.min(s, total - s);
      const shore = groundAt(...line[s < total / 2 ? 0 : line.length - 1]);
      return Math.min(base, shore + fromEnd * 0.04);
    });
    const st = stationsFor(line, heights);
    const steel = mat(BRIDGE_PAINT.steelGrey, { roughness: 0.55, metalness: 0.35 });
    deck(st, { width: 16, lanes: 3, walk: 1.8, walkColor: BRIDGE_PAINT.walkGrey, railColor: BRIDGE_PAINT.railGrey, structure: BRIDGE_PAINT.concrete, depth: 1.5 });
    const lower = st.map((p) => ({ ...p, y: p.y - 8 }));
    deck(lower, { width: 16, lanes: 3, walk: 0.6, walkColor: BRIDGE_PAINT.walkGrey, railColor: BRIDGE_PAINT.railGrey, structure: BRIDGE_PAINT.concrete, depth: 1.2 });
    // The cantilever trusses: deep over the piers, shallow at mid-span.
    for (const h of humps) {
      const span = st.filter((p, i) => Math.abs(ds[i] - h) < 520);
      for (const sgn of [-1, 1]) strip(span, sgn * 8, sgn * 8, -10, 18, trussMaterial(BRIDGE_PAINT.steelGrey), 10);
      strip(span, -8, 8, 18, 18, trussMaterial(BRIDGE_PAINT.steelGrey), 10);
      counts.towers += 1;
    }
    piers(st, 90, 16, BRIDGE_PAINT.concrete);
    void steel;
    counts.structures += 1;
  }

  // Every other bridge over the water: a girder deck on piers, or a trestle with its high-rise.
  for (const way of ways) {
    const design = bridgeDesign(way.name);
    deckName = way.name || null;
    if (design !== "girder" && design !== "trestle") continue;
    const line = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    const ds = [0];
    for (let i = 1; i < line.length; i += 1) ds.push(ds[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const total = ds[ds.length - 1];
    const major = way.highway === "motorway" || way.highway === "trunk";
    const clearance = design === "trestle" ? 10 : major ? 14 : 7;
    // A trestle's high-rise over its channel; a girder's level span.
    const hump = design === "trestle" ? (/Dumbarton/.test(way.name) ? 0.5 : 0.15) * total : -1;
    const target = line.map(([x, z], i) => {
      const wet = way.over_water[i];
      let y = wet ? water + clearance : groundAt(x, z);
      if (hump >= 0 && wet) y += Math.max(0, 1 - Math.abs(ds[i] - hump) / 900) * (/Dumbarton/.test(way.name) ? 18 : 30);
      return y;
    });
    // No steeper than a road, either way.
    const h = target.slice();
    for (let i = 1; i < h.length; i += 1) h[i] = Math.max(h[i], h[i - 1] - RAMP_GRADE * (ds[i] - ds[i - 1]));
    for (let i = h.length - 2; i >= 0; i -= 1) h[i] = Math.max(h[i], h[i + 1] - RAMP_GRADE * (ds[i + 1] - ds[i]));
    const lanes = Math.max(1, Number(way.lanes) || (major ? 3 : 2));
    const spec = { width: lanes * 3.6 + 3.2, lanes, walk: major ? 0.8 : 1.6, walkColor: BRIDGE_PAINT.walkGrey,
                   railColor: BRIDGE_PAINT.railGrey, structure: BRIDGE_PAINT.concrete, depth: design === "trestle" ? 1.4 : 1.8 };
    const st = stationsFor(line, h);
    deck(st, spec);
    piers(st, design === "trestle" ? 36 : 45, spec.width, BRIDGE_PAINT.concrete);
    // Where an end is left in the air -- the map's way stops where the bridge is still high --
    // a viaduct carries the road on down to the ground; an end that meets another bridge stays.
    if (!endsShared(line[0], way) && h[0] - groundAt(...line[0]) > 0.5) ramp(line[0], line[1], h[0], spec);
    if (!endsShared(line[line.length - 1], way) && h[h.length - 1] - groundAt(...line[line.length - 1]) > 0.5)
      ramp(line[line.length - 1], line[line.length - 2], h[h.length - 1], spec);
    counts.structures += 1;
    void total;
  }
  // A deck is laid a strip, a railing and a cable at a time, all in world place: sixteen
  // hundred draws for a hundred and twenty thousand triangles. One mesh a material draws the same.
  const pieces = new Map();
  for (const mesh of out.children) {
    if (!mesh.isMesh || mesh.isInstancedMesh) continue;
    const key = `${mesh.material.uuid}|${mesh.userData.surface}`;
    if (!pieces.has(key)) pieces.set(key, []);
    pieces.get(key).push(mesh);
  }
  for (const list of pieces.values()) {
    if (list.length < 2) continue;
    const geometry = mergeParts(list.map((mesh) => mesh.geometry));
    for (const mesh of list) out.remove(mesh);
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const merged = new THREE.Mesh(geometry, list[0].material);
    merged.userData.surface = list[0].userData.surface;
    out.add(merged);
  }
  for (const [material, list] of boxes) {
    const mesh = new THREE.InstancedMesh(BOX, material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.surface = "bridge";
    out.add(mesh);
  }
  out.traverse((o) => { if (o.isMesh) { o.userData.bayWide = true; o.userData.liftedOntoGround = true; } });
  root.add(out);
  return counts;
}

// ---- the tile tree ---------------------------------------------------------------------------
//
// Past the region's own box the map used to be the atlas and nothing else: grass, sea, and a
// marker where Oakland was. So the Bay Area existed but the cities in it did not, and the only
// way to another one was to load another page -- which is unloaded territory by another name.
//
// This is one quadtree over the whole area (scripts/build_tiles.py), rooted on the atlas's box.
// Every built region's own geometry is in it, generalised per depth: the skyline at 25 m of
// error, every road at 5 m, the real footprints at 1.2 m. A tile is a complete picture of its
// square at its own error, so showing a tile's children hides the tile.
//
// Nothing here is chosen by zoom. Each tile is asked what its error would look like from where
// the camera is -- error * focal / distance, in pixels -- and refines only when that is more
// than a few pixels. So the far side of the bay stays four boxes and a line while the street
// under the walker is drawn to the kerb, and the two are the same tree.
//: Where the tile tree lives, relative to this page. One tree serves a whole site: the
//: corridor's page sits beside it, and a region's page two folders down reaches up to it
//: rather than carrying fifteen megabytes of its own copy (tools/build_pages.py rewrites
//: this line for a region's page).
const TILE_BASE = "tiles/";
const TILE_MAX_SCREEN_ERROR_PX = 3.0;
//: How many tiles may be in flight. More than this and the one you are about to need queues
//: behind six you are about to leave.
const TILE_MAX_CONCURRENT = 6;
//: Tiles are dropped when more than this is resident, furthest first, and never one that is
//: being drawn. Source bytes, which is what the index knows before it asks for anything.
let TILE_RESIDENT_BUDGET = STREAM.tileBytes;
//: The swap is faded rather than cut: at a boundary the new tile's first frame is otherwise a
//: visible step even when the geometry lines up.
const TILE_FADE_MS = 150;
//: The tree is walked every few frames. Walking it every frame costs more than it saves: the
//: camera cannot move far enough in four frames to change what is good enough.
const TILE_TRAVERSE_EVERY = 4;
//: How far ahead of the camera, in seconds of its own motion, the prefetch looks.
const TILE_PREFETCH_SECONDS = 4.0;

const tileGroupRoot = new THREE.Group();
tileGroupRoot.name = "tileTree";
root.add(tileGroupRoot);

const TILES = new Map();
//: "3/4/5" -> "2/2/2"; the root has none.
function tileParentId(id) {
  const [d, x, y] = id.split("/").map(Number);
  return d === 0 ? null : `${d - 1}/${Math.floor(x / 2)}/${Math.floor(y / 2)}`;
}
let TILE_INDEX = null;
const tileQueue = [];
let tileInFlight = 0;
let tileResidentBytes = 0;
const tileStats = { built: 0, drawn: 0, requested: 0, failed: 0, evicted: 0, bytes: 0 };

//: The region this page draws in full. Inside it the street renderer has every kerb, so the
//: tree draws nothing there -- feature by feature, since a coarse tile is far bigger than the
//: region and its other half is wanted.
//: Which region that is changes as the walker goes (attachRegion); the tree then rebuilds the
//: tiles over the old region and the new.
let TILE_OWN_BOXES = BUILD_WINDOW ? BUILD_WINDOW.boxes.map((b) => b.slice())
  : DATA.bbox ? [[DATA.bbox.west, DATA.bbox.south, DATA.bbox.east, DATA.bbox.north]] : null;
function tileOwnGround(lon, lat) {
  return TILE_OWN_BOXES !== null && TILE_OWN_BOXES.some((b) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
}
//: A line, cut into the runs of it that lie outside the region this page draws in full.
//:
//: Keeping or dropping a whole line by its first vertex leaves every street and every footway
//: that crosses the region's boundary drawn whole: a second carriageway over the real one and
//: a second pavement over the real pavement, for as far as the way runs. From above that is a
//: set of long pale lines lying across the city with the real roadwork visible underneath.
//:
//: ``stations`` carry at least ``lon`` and ``lat``; the runs come back as the same objects,
//: so a caller keeps whatever else it put in them.
function tileOutsideRuns(stations) {
  // Ownership is per fragment, not per station/feature. Endpoint-only clipping
  // let a two-vertex ribbon cross right through the measured world.
  return stations.length >= 2 ? [stations] : [];
}

function tileFocalPx(eye = camera) {
  const h = renderer.domElement.clientHeight || innerHeight || 900;
  return h / (2 * Math.tan(eye.fov * Math.PI / 360));
}
//: The error this tile would show from where the camera is, in pixels. Distance to the tile's
//: bounding sphere, not to its centre: a tile you are standing in the middle of is at zero.
function tileScreenErrorPx(tile, eye = camera) {
  const dx = eye.position.x - tile.cx;
  const dy = eye.position.y - tile.cy;
  const dz = eye.position.z - tile.cz;
  const distance = Math.max(1.0, Math.hypot(dx, dy, dz) - tile.radius);
  return tile.error * tileFocalPx(eye) / distance;
}
const TILE_FRUSTUM = new THREE.Frustum();
const TILE_MATRIX = new THREE.Matrix4();
const TILE_SPHERE = new THREE.Sphere();
function tileInView(tile) {
  TILE_SPHERE.center.set(tile.cx, tile.cy, tile.cz);
  TILE_SPHERE.radius = tile.radius;
  return TILE_FRUSTUM.intersectsSphere(TILE_SPHERE);
}

//: What a tile is worth fetching now. The shape the plan asked for: what is on screen and
//: about to be visibly wrong comes before what is merely near, and what is behind you comes
//: last. Higher is sooner.
function tilePriority(tile, screenError, onScreen, aheadness, eye = camera) {
  const km = Math.hypot(eye.position.x - tile.cx, eye.position.z - tile.cz) / 1000;
  return (onScreen ? 10 : 0) + Math.min(screenError, 60) * 5 + aheadness * 3 - km + (tile.depth >= 6 ? 4 : 0);
}

function tileHasContent(tile) {
  return tile.state === "cpu" || tile.state === "visible";
}
function tilePending(tile) {
  return tile.state === "requested" || tile.state === "downloading";
}

function requestTile(tile, screenError, onScreen = true, aheadness = 0, eye = camera) {
  if (tile.state !== "unavailable") {
    if (tilePending(tile)) tile.priority = Math.max(tile.priority, tilePriority(tile, screenError, onScreen, aheadness, eye));
    return;
  }
  if (!Object.keys(tile.assets).length) { tile.state = "cpu"; return; }   // an empty tile is ready
  tile.state = "requested";
  tile.priority = tilePriority(tile, screenError, onScreen, aheadness, eye);
  tileQueue.push(tile);
  tileStats.requested += 1;
  pumpTileQueue();
}

function pumpTileQueue() {
  while (tileInFlight < TILE_MAX_CONCURRENT && tileQueue.length) {
    let best = 0;
    for (let i = 1; i < tileQueue.length; i += 1) if (tileQueue[i].priority > tileQueue[best].priority) best = i;
    const tile = tileQueue.splice(best, 1)[0];
    if (tile.state !== "requested") continue;
    tile.state = "downloading";
    tileInFlight += 1;
    loadTile(tile).catch(() => { tile.state = "unavailable"; tileStats.failed += 1; })
      .finally(() => { tileInFlight -= 1; pumpTileQueue(); });
  }
}

async function loadTile(tile) {
  const layers = {};
  await Promise.all(Object.entries(tile.assets).map(async ([name, meta]) => {
    const response = await fetch(asset(TILE_BASE + meta.url), { cache: "no-cache" });
    if (!response.ok) throw new Error(`tile ${tile.id} ${name} ${response.status}`);
    layers[name] = await response.json();
  }));
  buildTile(tile, layers);
  tile.state = "cpu";
  tileResidentBytes += tile.bytes;
  tileStats.bytes += tile.bytes;
  evictTiles();
}

//: A tile's own metre frame, as the build wrote it: centimetres east and north of its
//: south-west corner. Two multiplies put a vertex in the page's frame.
function tileFrame(tile) {
  const [west, south, east, north] = tile.bbox;
  const ky = 111320.0;
  const kx = ky * Math.cos((south + north) / 2 * Math.PI / 180);
  const [x0, y0] = xy(west, south);
  return { x0, y0, sx: metersPerLon / kx / 100.0, sy: metersPerLat / ky / 100.0, kx, ky, west, south };
}

//: The tile street's sheets lie centimetres apart (TILE_LAWN_Y, TILE_ROAD_Y, TILE_WALK_Y) over the
//: landscape, and from a few kilometres out no depth buffer tells them apart: grass, tarmac,
//: footway and the ground under them took the same pixels in turn as the view moved, and the
//: whole city "kept flashing and changing colours" zoomed out. Polygon offset cannot help: the
//: logarithmic depth buffer writes its own depth. So each sheet is drawn pulled toward the eye
//: by this share of its distance per rank -- the same pixels, a nearer depth -- which keeps
//: them in their order at any range: 3 cm a rank at 100 m, 30 cm at 6 km.
const TILE_DEPTH_BIAS = 5e-5;
function tileDepthBias(material, rank) {
  const before = material.onBeforeCompile, key = material.customProgramCacheKey();
  const scale = (1 - rank * TILE_DEPTH_BIAS).toFixed(6);
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>",
      `#include <project_vertex>\nmvPosition.xyz *= ${scale};\ngl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => `${key}:tile-bias-${rank}`;
  material.needsUpdate = true;
}

function addTileMeshes(group, meshes) {
  // Three.js treats add() with zero arguments as add(undefined), and logs an error. A tile
  // layer can legitimately be empty after local-ground ownership removes its features.
  if (meshes.length) group.add(...meshes);
}

function buildTile(tile, layers) {
  const group = new THREE.Group();
  group.name = `tile:${tile.id}`;
  const f = tileFrame(tile);
  const lonOf = (cm) => f.west + cm / 100.0 / f.kx;
  const latOf = (cm) => f.south + cm / 100.0 / f.ky;
  // A material a tile, not one shared by all of them: the fade writes opacity, and on a
  // shared material one tile fading in took every other tile on the map with it -- which
  // read as the whole Bay Area blinking out whenever a boundary was crossed.
  const materials = {
    massing: TILE_MASSING_MATERIAL.clone(),
    buildings: TILE_BUILDING_MATERIAL.clone(),
    roads: TILE_ROAD_MATERIAL.clone(),
    pavement: TILE_WALK_MATERIAL.clone(),
    lawns: TILE_LAWN_MATERIAL.clone(),
    paint: TILE_PAINT_MATERIAL.clone(),
    yellow: TILE_YELLOW_MATERIAL.clone(),
    tactile: new THREE.MeshStandardMaterial({
      map: TACTILE_WARNING, color: 0xffffff, roughness: 0.86, metalness: 0.0,
      transparent: true, side: THREE.DoubleSide,
    }),
  };
  tile.materials = Object.values(materials);
  // The flat sheets of the tile street, in the order they lie: grass, tarmac, footway, paint.
  for (const [material, rank] of [[materials.lawns, 1], [materials.roads, 2], [materials.pavement, 3],
                                  [materials.paint, 4], [materials.yellow, 4], [materials.tactile, 4]])
    tileDepthBias(material, rank);
  // The houses are let in over the region drawn in full when the view is right out (tier 0).
  for(const material of tile.materials)applyBoxClip({traverse:visit=>visit({material})},
    material===materials.buildings || material===materials.massing ? tileBuildingBox : tileDetailBox,true);
  if (layers.massing) addTileMeshes(group, tileMassing(layers.massing, f, lonOf, latOf, materials.massing));
  if (layers.buildings) addTileMeshes(group, tileBuildings(layers.buildings, f, lonOf, latOf, materials.buildings));
  if (layers.lawns) addTileMeshes(group, tileLawns(layers.lawns, f, materials.lawns));
  // The street, from the outside in: carriageway and footways.  Crossings are not a wide road
  // ribbon: their resolved style becomes either repeated continental bars or two parallel lines,
  // plus the same full rectangular yellow warning fields used by the near-region renderer.
  for (const [name, material, height] of [["roads", materials.roads, TILE_ROAD_Y],
                                          ["roads_major", materials.roads, TILE_ROAD_Y],
                                          ["carriageway", materials.roads, TILE_ROAD_Y],
                                          ["pavement", materials.pavement, TILE_WALK_Y]]) {
    if (layers[name]) addTileMeshes(group, tileRoads(layers[name], f, lonOf, latOf, material, height));
  }
  if (layers.crossings_continental) {
    addTileMeshes(group, tileCrossings(layers.crossings_continental, "continental", f, lonOf, latOf,
                                       materials.paint, materials.tactile));
  }
  if (layers.crossings_parallel) {
    addTileMeshes(group, tileCrossings(layers.crossings_parallel, "parallel", f, lonOf, latOf,
                                       materials.paint, materials.tactile));
  }
  // The lane lines (derived: from the lanes the street facts inferred, as the street renderer's).
  if (layers.lanes_white) addTileMeshes(group, tileLaneLines(layers.lanes_white, "white", f, materials.paint));
  if (layers.lanes_yellow) addTileMeshes(group, tileLaneLines(layers.lanes_yellow, "yellow", f, materials.yellow));
  group.visible = false;
  // Deeper tiles draw after shallower ones, so a parent fading out lies over its children
  // rather than fighting them for the depth buffer while it goes.
  group.renderOrder = tile.depth;
  group.traverse((o) => { if (o.isMesh) {
    o.userData.surface = "tile"; o.userData.liftedOntoGround = true; o.renderOrder = tile.depth;
    if(typeof NATURE!=="undefined"&&NATURE&&!o.isInstancedMesh&&!o.userData.natureBuildings) {
      const p=o.geometry.getAttribute("position"),base=new Float32Array(p.count);
      for(let i=0;i<p.count;i++)base[i]=tileGroundAt(p.getX(i),p.getZ(i));
      o.userData.natureBases=base;
    }
  } });
  tile.group = group;
  // In the headset a tile is plain before it is first drawn (headsetSimplify), not a pass later.
  if (HEADSET) headsetSimplify(group);
  tileGroupRoot.add(group);
  tileStats.built += 1;
}

//: The colours the distance is drawn in. Not the near city's: a facade's own colour at four
//: kilometres is noise, and the city reads as one mass in the haze.
const TILE_WALL = new THREE.Color(0x8d99a6);
const TILE_ROOF = new THREE.Color(0x6f7a85);
const TILE_ROAD = new THREE.Color(0x4a4f55);
const TILE_MASSING_MATERIAL = new THREE.MeshStandardMaterial({ color: TILE_WALL, roughness: 0.92, metalness: 0.0, transparent: true });
const TILE_BUILDING_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, transparent: true });
const TILE_FACADE_TEXTURE = (()=>{
  const canvas=document.createElement("canvas");canvas.width=canvas.height=128;
  const c=canvas.getContext("2d");c.fillStyle="#fff";c.fillRect(0,0,128,128);
  c.fillStyle="#bac2c5";c.fillRect(35,32,58,72);c.fillStyle="#41515b";c.fillRect(39,36,50,64);
  c.fillStyle="#bfc4c5";c.fillRect(62,36,3,64);c.fillRect(39,66,50,3);
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
})();
TILE_BUILDING_MATERIAL.map=TILE_FACADE_TEXTURE;
const TILE_ROAD_MATERIAL = new THREE.MeshStandardMaterial({ color: TILE_ROAD, roughness: 0.96, metalness: 0.0, transparent: true, side: THREE.DoubleSide });
//: The footway and the paint on the road. The page's own concrete and its own white are what
//: the street renderer uses a few metres away, so the seam at the region's edge is a seam in
//: detail and not in colour.
const TILE_WALK = new THREE.Color(0x8e918a);
const TILE_PAINT_COLOUR = new THREE.Color(0xe8e8e4);
const TILE_WALK_MATERIAL = new THREE.MeshStandardMaterial({ color: TILE_WALK, roughness: 0.96, metalness: 0.0, transparent: true, side: THREE.DoubleSide });
//: The grass from far off (the tiles' lawns layer: parks, lawns and back yards): one plain
//: green, the average of the turf the street renderer lays, a shade lighter for the distance.
const TILE_LAWN = new THREE.Color(0x3a6630);
const TILE_LAWN_MATERIAL = new THREE.MeshStandardMaterial({ color: TILE_LAWN, roughness: 0.98, metalness: 0.0, transparent: true, side: THREE.DoubleSide });
const TILE_PAINT_MATERIAL = new THREE.MeshStandardMaterial({ color: TILE_PAINT_COLOUR, roughness: 0.9, metalness: 0.0, transparent: true, side: THREE.DoubleSide });
//: The centre line's yellow, as the street renderer paints it.
const TILE_YELLOW_MATERIAL = new THREE.MeshStandardMaterial({ color: 0xd9a514, roughness: 0.9, metalness: 0.0, transparent: true, side: THREE.DoubleSide });
//: The lines between lanes from a little way off: San Francisco's broken white (ten feet of
//: line, thirty of gap) and its double yellow (two four-inch lines, four inches apart), a
//: little wider than painted so a line a kilometre off is still a line and not a shimmer.
const TILE_LANE = { dashM: 3.05, gapM: 9.15, whiteM: 0.15, yellowM: 0.12, yellowGapM: 0.12 };
//: The tile street's own stack, over the atlas's ground: tarmac, the paint on it, the kerb's
//: height to the footway. Millimetres apart would fight; these are the real steps.
const TILE_ROAD_Y = 0.15;
const TILE_PAINT_Y = 0.22;
const TILE_WALK_Y = 0.30;
//: Lawns lie under the roads and footways, so a ring that runs into a street gives way to it.
const TILE_LAWN_Y = 0.08;
//: The ground the tile city stands on: the atlas's own surface, which is drawn
//: PERIMETER_UNDER_M under the region grid's apron so the two do not fight for the pixels
//: where they meet. Built on PENINSULA_Y instead, every street outside a region stood on a
//: two-metre plinth with a drop to the grass either side.
const TILE_GROUND_Y = PENINSULA_Y - PERIMETER_UNDER_M;
//: Over the landscape, the ground the simple city stands on is the landscape's as it draws it,
//: eased to the edge of a window drawn in full as the landscape is (natureVisualHeightAt). On the
//: bare terrain it was under that easing: the ground round a window rose over its streets and
//: lawns by up to thirteen metres.
function tileGroundAt(x, z) { return natureVisualHeightAt(x, z, null, false); }

const TILE_BOX = new THREE.BoxGeometry(1, 1, 1);
// Refined terrain must not bury an already-resident neighbouring city tile. Rebase its
// display geometry in place, retaining every triangle and avoiding network re-downloads.
//: The overview tiles stood again on ground that has just come in, a mesh at a time between
//: frames: all of them in one call held a walking frame for a quarter of a second (2026-11-05).
//: Each mesh keeps the ground it was last stood on, so a mesh done later is done the same.
const natureHeightQueue = [], natureHeightQueued = new Set();
let natureHeightPumping = false;
function syncNatureTileHeights(boxes) {
  if(typeof TILES==="undefined")return;
  for(const tile of TILES.values()) {
    if(!tile.group)continue;
    const [w,s,e,n]=tile.bbox;
    if(!boxes.some(b=>w<b[2]&&e>b[0]&&s<b[3]&&n>b[1]))continue;
    tile.group.traverse(o=>{ if(o.isMesh && !natureHeightQueued.has(o)) { natureHeightQueued.add(o); natureHeightQueue.push(o); } });
  }
  if (!natureHeightPumping && natureHeightQueue.length) { natureHeightPumping = true; nextTask().then(pumpNatureTileHeights); }
}
//: The mesh being restood, part done: a large overview mesh is its new heights worked out over
//: several slices and then set in one go, so it is never drawn half moved.
let natureHeightSteps = null;
function pumpNatureTileHeights() {
  const until = performance.now() + 6;
  while ((natureHeightSteps || natureHeightQueue.length) && performance.now() < until) {
    if (!natureHeightSteps) { const o = natureHeightQueue.shift(); natureHeightQueued.delete(o); natureHeightSteps = restandNatureMeshSteps(o); }
    if (natureHeightSteps.next().done) natureHeightSteps = null;
  }
  if (natureHeightSteps || natureHeightQueue.length) nextTask().then(pumpNatureTileHeights); else natureHeightPumping = false;
}
function restandNatureMesh(o) { for (const _ of restandNatureMeshSteps(o)); }
function* restandNatureMeshSteps(o) {
    {
      if(!o.parent)return;
      if(o.userData.natureMassing) {
        const a=o.userData.natureMassing,m=new THREE.Matrix4();
        for(let i=0;i<o.count;i++){
          o.getMatrixAt(i,m);const y=tileGroundAt(m.elements[12],m.elements[14]);
          m.elements[13]+=y-a[i];a[i]=y;o.setMatrixAt(i,m);
        }o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();return;
      }
      const p=o.geometry?.getAttribute("position");if(!p)return;
      if(o.userData.natureBuildings) {
        for(const b of o.userData.natureBuildings) {
          const next=Math.min(...b.ring.map(q=>tileGroundAt(q[0],q[1]))),delta=next-b.base;
          if(Math.abs(delta)<.0001)continue;
          for(let i=b.first;i<b.end;i++)p.setY(i,p.getY(i)+delta);b.base=next;
        }
      }else if(o.userData.natureBases) {
        const base=o.userData.natureBases,next=new Float64Array(p.count);
        for(let i=0;i<p.count;i++){
          if((i&2047)===2047)yield;
          next[i]=tileGroundAt(p.getX(i),p.getZ(i));
        }
        for(let i=0;i<p.count;i++){p.setY(i,p.getY(i)+next[i]-base[i]);base[i]=next[i];}
        o.geometry.computeVertexNormals();
      }else return;
      p.needsUpdate=true;o.geometry.computeBoundingSphere();
    }
}

function tileMassing(rows, f, lonOf, latOf, material) {
  const kept = [];
  for (const [cx, cy, halfA, halfB, bearing, height] of rows) {
    kept.push([cx, cy, halfA, halfB, bearing, height]);
  }
  if (!kept.length) return [];
  const mesh = new THREE.InstancedMesh(TILE_BOX, material, kept.length);
  const nature=typeof NATURE!=="undefined"&&NATURE;
  if(nature)mesh.userData.natureMassing=new Float32Array(kept.length);
  const dummy = new THREE.Object3D();
  kept.forEach(([cx, cy, halfA, halfB, bearing, height], i) => {
    const h = height / 100.0;
    const mx = f.x0 + cx * f.sx, mz = -(f.y0 + cy * f.sy);
    const base=nature ? tileGroundAt(mx,mz) : TILE_GROUND_Y-earthDrop(mx,mz);
    if(nature)mesh.userData.natureMassing[i]=base;
    dummy.position.set(mx, base + h / 2, mz);
    dummy.rotation.set(0, -bearing / 100.0 * Math.PI / 180, 0);
    dummy.scale.set(Math.max(2.0, halfA * f.sx * 2), h, Math.max(2.0, halfB * f.sy * 2));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return [mesh];
}

//: The archetypes the tile tree names, in the order smc.tiles.compile writes them.
const TILE_ARCHETYPES = ["residential", "office", "hotel", "retail", "restaurant", "civic",
                         "school", "industrial", "parking", "park", "generic"];
const TILE_COLOUR = new THREE.Color();
function tileInventedColour(archetype, at, height) {
  // A seed from where the building stands: the same building is the same colour every visit,
  // and two buildings side by side are not.
  const seed = ((Math.round(at[0] * 4) * 73856093) ^ (Math.round(at[1] * 4) * 19349663)) >>> 0;
  // Exactly what the street renderer does for a building no photograph reached: the
  // archetype's own palette where the archetype has one, and otherwise the palette of the
  // material its height and the city's building stock suggest. Four in five buildings outside
  // San Francisco are "generic", which has no archetype palette at all -- given one colour
  // for want of that fallback, every one of them came out the same pale block.
  const style = ARCHETYPE_STYLE[archetype];
  const palette = style && style.colours ? style.colours
                                         : pickMaterial(seed, height, archetype, null).colours;
  return TILE_COLOUR.setHex(palette[Math.floor(random(seed + 11) * palette.length)]);
}

function tileBuildings(rows, f, lonOf, latOf, material) {
  const position = [], colour = [], index = [], uv = [];
  const nature=typeof NATURE!=="undefined"&&NATURE,profiles=[];
  const roof = new THREE.Color();
  for (const row of rows) {
    const height = row[0] / 100.0;
    const packed = row[1];
    const archetype = TILE_ARCHETYPES[row[2]] || "generic";
    // Where the building stands, not where its ring happens to start: one on the region's
    // boundary whose first corner fell outside it was drawn whole, over the one the street
    // renderer had already drawn.
    let ringX = 0, ringY = 0, corners = 0;
    for (let i = 3; i + 1 < row.length; i += 2) { ringX += row[i]; ringY += row[i + 1]; corners += 1; }
    if (!corners) continue;
    const ring = [];
    for (let i = 3; i + 1 < row.length; i += 2) ring.push([f.x0 + row[i] * f.sx, -(f.y0 + row[i + 1] * f.sy)]);
    if (ring.length >= 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    if (ring.length < 3) continue;
    // The colour off a photograph of this building where there is one; otherwise the same
    // invented colour the street renderer gives an unsampled building -- its archetype's own
    // palette, picked by a seed from where it stands, so a city nobody has photographed is a
    // city of different houses rather than a field of identical pale blocks.
    const wall = packed >= 0 ? roof.setHex(packed) : tileInventedColour(archetype, ring[0], height);
    const drop = earthDrop(ring[0][0], ring[0][1]);
    const groundY = nature ? Math.min(...ring.map(p=>tileGroundAt(p[0],p[1]))) : TILE_GROUND_Y - drop;
    const firstVertex=position.length/3;
    const top = groundY + height;
    // The walls: a quad an edge, wound outward whichever way the ring runs.
    let area = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const flip = area > 0;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const vertexBase = position.length / 3;
      const p = flip ? [b, a] : [a, b];
      position.push(p[0][0], groundY, p[0][1], p[1][0], groundY, p[1][1],
                    p[1][0], top, p[1][1], p[0][0], top, p[0][1]);
      const repeats=Math.max(1,Math.round(Math.hypot(a[0]-b[0],a[1]-b[1])/2.7));
      const floors=Math.max(1,Math.round(height/3.1));
      uv.push(0,0,repeats,0,repeats,floors,0,floors);
      for (let k = 0; k < 4; k += 1) colour.push(wall.r, wall.g, wall.b);
      index.push(vertexBase, vertexBase + 1, vertexBase + 2,
                 vertexBase, vertexBase + 2, vertexBase + 3);
    }
    // The roof: the ring triangulated flat, a shade darker than the walls.
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    let faces = [];
    try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { faces = []; }
    if (faces.length) {
      const base = position.length / 3;
      const shade = wall.clone().multiplyScalar(0.82);
      for (const [x, z] of ring) { position.push(x, top, z); colour.push(shade.r, shade.g, shade.b); uv.push(.01,.01); }
      const up = THREE.ShapeUtils.isClockWise(contour);
      for (const [a, b, c] of faces) index.push(base + a, base + (up ? b : c), base + (up ? c : b));
    }
    if(nature)profiles.push({ring,base:groundY,first:firstVertex,end:position.length/3});
  }
  if (!index.length) return [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colour, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry, material);
  if(nature)mesh.userData.natureBuildings=profiles;
  return [mesh];
}

function natureTileStations(run) {
  if(typeof NATURE==="undefined"||!NATURE||run.length<2)return run;
  const output=[run[0]];
  for(let i=1;i<run.length;i++) {
    const a=run[i-1],b=run[i],ax=a.x??a.lx,az=a.z??a.lz,bx=b.x??b.lx,bz=b.z??b.lz;
    const n=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/10));
    for(let k=1;k<=n;k++) {
      const t=k/n,p={};for(const key of Object.keys(a))p[key]=a[key]+(b[key]-a[key])*t;output.push(p);
    }
  }return output;
}
//: The lawns layer: each ring ([x0, y0, ...] in the tile's centimetres) laid flat on the ground
//: and filled, all of a tile's in one mesh. Inside the region drawn in full the clip hides them
//: (tileDetailBox), and the street renderer's turf is there instead.
//: A park's polygon takes in its lake -- Lake Merritt is inside the park mapped round it -- and
//: filled whole, the far city's lawn was a green sheet over the lake, a few centimetres above
//: the water and from a distance taking turns with it. A ring with water under it (sampled every
//: TILE_LAWN_PROBE_M over its bounds) is cut into triangles no longer than TILE_LAWN_PIECE_M,
//: finer to TILE_LAWN_SHORE_M along the shore, and the pieces on the water are left out.
const TILE_LAWN_PROBE_M = 30, TILE_LAWN_PIECE_M = 40, TILE_LAWN_SHORE_M = 8;
function tileLawnWetTest() {
  if (typeof NATURE === "undefined" || !NATURE) return null;
  return (x, z) => mappedWaterAt(x, z) === true || inlandWaterAt(x, z) === 1 || natureWaterAt(x, z);
}
//: (A lawn smaller than TILE_LAWN_ASK_M2 over its bounds is not asked: a yard or a verge is
//: not where a lake is, and the far city has tens of thousands of them.)
const TILE_LAWN_ASK_M2 = 1600;
function ringOverWater(ring, wetAt) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); }
  if ((x1 - x0) * (z1 - z0) < TILE_LAWN_ASK_M2) return false;
  for (const p of ring) if (wetAt(p.x, p.y)) return true;
  for (let x = x0 + TILE_LAWN_PROBE_M / 2; x < x1; x += TILE_LAWN_PROBE_M)
    for (let z = z0 + TILE_LAWN_PROBE_M / 2; z < z1; z += TILE_LAWN_PROBE_M)
      if (wetAt(x, z) && pointInVectorRing(x, z, ring)) return true;
  return false;
}
function pointInVectorRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > z) !== (b.y > z) && x < (b.x - a.x) * (z - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
//: The dry pieces of triangle (a, b, c), as flat [ax, az, bx, bz, cx, cz] onto ``out``.
function dryLawnPieces(a, b, c, wetAt, out, depth = 0) {
  const longest = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
  if (longest > TILE_LAWN_PIECE_M && depth < 12) {
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
    for (const [p, q, r] of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) dryLawnPieces(p, q, r, wetAt, out, depth + 1);
    return;
  }
  const wet = [wetAt(a[0], a[1]), wetAt(b[0], b[1]), wetAt(c[0], c[1]), wetAt((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)];
  const n = wet.filter(Boolean).length;
  if (n === 4) return;
  if (n === 0 || longest <= TILE_LAWN_SHORE_M || depth >= 12) {
    if (!wet[3]) out.push(a[0], a[1], b[0], b[1], c[0], c[1]);
    return;
  }
  const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
  for (const [p, q, r] of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) dryLawnPieces(p, q, r, wetAt, out, depth + 1);
}
function tileLawns(rows, f, material) {
  const position = [], index = [], uv = [];
  const nature = typeof NATURE !== "undefined" && NATURE;
  const wetAt = tileLawnWetTest();
  const vertex = (x, z) => {
    const y = nature ? tileGroundAt(x, z) : TILE_GROUND_Y - earthDrop(x, z);
    position.push(x, y + TILE_LAWN_Y, z);
    if (!HEADSET) uv.push(x / 8, -z / 8);
    return position.length / 3 - 1;
  };
  for (const row of rows) {
    const ring = [];
    for (let i = 0; i + 1 < row.length; i += 2) ring.push(new THREE.Vector2(f.x0 + row[i] * f.sx, -(f.y0 + row[i + 1] * f.sy)));
    if (ring.length > 3 && ring[0].equals(ring[ring.length - 1])) ring.pop();
    if (ring.length < 3) continue;
    const triangles = THREE.ShapeUtils.triangulateShape(ring, []);
    if (wetAt && ringOverWater(ring, wetAt)) {
      const pieces = [];
      for (const [a, b, c] of triangles) dryLawnPieces([ring[a].x, ring[a].y], [ring[b].x, ring[b].y], [ring[c].x, ring[c].y], wetAt, pieces);
      for (let i = 0; i + 5 < pieces.length; i += 6)
        index.push(vertex(pieces[i], pieces[i + 1]), vertex(pieces[i + 2], pieces[i + 3]), vertex(pieces[i + 4], pieces[i + 5]));
      continue;
    }
    const base = position.length / 3;
    for (const p of ring) vertex(p.x, p.y);
    for (const [a, b, c] of triangles) index.push(base + a, base + b, base + c);
  }
  if (!index.length) return [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  if (!HEADSET) {
    // The same centimetre-grain turf as the detailed city, not a second plain-green skin.
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    if (!material.map) {
      material.map = grassTexture("park", 0);
      material.color.set(0xffffff);
      material.needsUpdate = true;
    }
  }
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return [mesh];
}

function tileRoads(rows, f, lonOf, latOf, material, height = TILE_ROAD_Y) {
  const position = [], index = [];
  for (const row of rows) {
    // A leading zero means the kerbs were measured: the row is the two kerb lines themselves,
    // left and right in turn, and the carriageway is the strip between them. Everything else
    // is a centreline with a width, which is what a way with no cross-sections has.
    if (row[0] === 0) {
      const stations = [];
      for (let i = 1; i + 3 < row.length; i += 4) {
        // The centre of the two kerbs is where the street is, and what decides whether this
        // station stands inside the region the page is drawing in full.
        stations.push({ lx: f.x0 + row[i] * f.sx, lz: -(f.y0 + row[i + 1] * f.sy),
                        rx: f.x0 + row[i + 2] * f.sx, rz: -(f.y0 + row[i + 3] * f.sy),
                        lon: lonOf((row[i] + row[i + 2]) / 2),
                        lat: latOf((row[i + 1] + row[i + 3]) / 2) });
      }
      for (const run of tileOutsideRuns(stations)) {
        const base = position.length / 3;
        (typeof NATURE!=="undefined"&&NATURE ? natureTileStations(run) : run).forEach(({ lx, lz, rx, rz }, n) => {
          position.push(lx, (typeof NATURE!=="undefined"&&NATURE ? tileGroundAt(lx,lz) : TILE_GROUND_Y-earthDrop(lx,lz)) + height, lz,
                        rx, (typeof NATURE!=="undefined"&&NATURE ? tileGroundAt(rx,rz) : TILE_GROUND_Y-earthDrop(rx,rz)) + height, rz);
          if (n) { const k = base + n * 2; index.push(k - 2, k, k - 1, k - 1, k, k + 1); }
        });
      }
      continue;
    }
    const width = Math.max(1.2, row[0] / 100.0);
    const stations = [];
    for (let i = 1; i + 1 < row.length; i += 2) {
      stations.push({ x: f.x0 + row[i] * f.sx, z: -(f.y0 + row[i + 1] * f.sy),
                      lon: lonOf(row[i]), lat: latOf(row[i + 1]) });
    }
    for (const run of tileOutsideRuns(stations)) {
      const pts = (typeof NATURE!=="undefined"&&NATURE ? natureTileStations(run) : run).map(({ x, z }) => [x, z]);
      // Every road in the tile goes into one buffer, so a road's triangles are indexed from
      // where its own vertices start. Indexed from zero -- which is what this did -- the
      // first road was a road and all the rest were slivers stitched back to its first two.
      const base = position.length / 3;
      for (let i = 0; i < pts.length; i += 1) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len * width / 2, nz = dx / len * width / 2;
        const lx = pts[i][0] + nx, lz = pts[i][1] + nz;
        const rx = pts[i][0] - nx, rz = pts[i][1] - nz;
        position.push(lx, (typeof NATURE!=="undefined"&&NATURE ? tileGroundAt(lx,lz) : TILE_GROUND_Y-earthDrop(lx,lz)) + height, lz,
                      rx, (typeof NATURE!=="undefined"&&NATURE ? tileGroundAt(rx,rz) : TILE_GROUND_Y-earthDrop(rx,rz)) + height, rz);
        if (i) { const k = base + i * 2; index.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
    }
  }
  if (!index.length) return [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return [new THREE.Mesh(geometry, material)];
}

function tileCrossings(rows, style, f, lonOf, latOf, paintMaterial, tactileMaterial) {
  const paintPosition = [], paintIndex = [];
  const tactilePosition = [], tactileUv = [], tactileIndex = [];
  const BAR_M = 0.43;
  const PERIOD_M = 0.86;
  const EDGE_M = 0.12;
  const PAD_DEPTH_M = 0.91;
  const PAD_SETBACK_M = 0.18;

  const addQuad = (position, index, cx, cz, ux, uz, halfAlong, halfAcross, y) => {
    const nx = -uz, nz = ux;
    const base = position.length / 3;
    for (const [along, across] of [[-halfAlong, -halfAcross], [halfAlong, -halfAcross],
                                   [halfAlong, halfAcross], [-halfAlong, halfAcross]]) {
      const x = cx + ux * along + nx * across;
      const z = cz + uz * along + nz * across;
      position.push(x, (typeof NATURE!=="undefined"&&NATURE ? tileGroundAt(x,z) : TILE_GROUND_Y-earthDrop(x,z)) + y, z);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return base;
  };

  const addPad = (at, into, crossingWidth) => {
    const dx = at[0] - into[0], dz = at[1] - into[1];
    const length = Math.hypot(dx, dz);
    if (!(length > 0.5)) return;
    const ux = dx / length, uz = dz / length;
    const width = Math.max(1.22, Math.min(1.52, crossingWidth));
    const cx = at[0] + ux * (PAD_DEPTH_M / 2 + PAD_SETBACK_M);
    const cz = at[1] + uz * (PAD_DEPTH_M / 2 + PAD_SETBACK_M);
    const base = addQuad(tactilePosition, tactileIndex, cx, cz, ux, uz,
                         PAD_DEPTH_M / 2, width / 2, TILE_WALK_Y + 0.018);
    tactileUv.push(0, 0, PAD_DEPTH_M / 0.48, 0,
                   PAD_DEPTH_M / 0.48, width / 0.48, 0, width / 0.48);
    // addQuad appends exactly four vertices; keep this assertion visible to future format edits.
    if (base * 2 + 8 !== tactileUv.length) throw new Error("tile tactile UV mismatch");
  };

  for (const row of rows) {
    const width = Math.max(1.2, row[0] / 100.0);
    // A crossing is one short object, so it is kept or dropped whole -- by its middle rather
    // than by its first vertex, which at the region's boundary decided it on the strength of
    // whichever end the map happened to draw first.
    let midX = 0, midY = 0, ends = 0;
    for (let i = 1; i + 1 < row.length; i += 2) { midX += row[i]; midY += row[i + 1]; ends += 1; }
    if (!ends) continue;
    const points = [];
    for (let i = 1; i + 1 < row.length; i += 2) {
      points.push([f.x0 + row[i] * f.sx, -(f.y0 + row[i + 1] * f.sy)]);
    }
    if (points.length < 2) continue;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      if (!(length > 0.5)) continue;
      const ux = dx / length, uz = dz / length;
      if (style === "parallel") {
        const offset = Math.max(0.25, width / 2 - EDGE_M / 2);
        const nx = -uz, nz = ux;
        for (const side of [-1, 1]) {
          addQuad(paintPosition, paintIndex,
                  (a[0] + b[0]) / 2 + nx * side * offset,
                  (a[1] + b[1]) / 2 + nz * side * offset,
                  ux, uz, length / 2, EDGE_M / 2, TILE_PAINT_Y);
        }
      } else {
        // Centre the bar sequence so both ends have equal clear paint margin.
        const count = Math.max(1, Math.floor((length + (PERIOD_M - BAR_M)) / PERIOD_M));
        const occupied = (count - 1) * PERIOD_M + BAR_M;
        const start = (length - occupied) / 2 + BAR_M / 2;
        for (let bar = 0; bar < count; bar += 1) {
          const along = start + bar * PERIOD_M;
          addQuad(paintPosition, paintIndex, a[0] + ux * along, a[1] + uz * along,
                  ux, uz, BAR_M / 2, width / 2, TILE_PAINT_Y);
        }
      }
    }
    addPad(points[0], points[1], width);
    addPad(points[points.length - 1], points[points.length - 2], width);
  }

  const meshes = [];
  if (paintIndex.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(paintPosition, 3));
    geometry.setIndex(paintIndex);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    meshes.push(new THREE.Mesh(geometry, paintMaterial));
  }
  if (tactileIndex.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(tactilePosition, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(tactileUv, 2));
    geometry.setIndex(tactileIndex);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    meshes.push(new THREE.Mesh(geometry, tactileMaterial));
  }
  return meshes;
}

//: A tile's lane lines: each row a polyline in the tile's centimetres. White is broken, the
//: dashes running on along the line across its vertices; yellow is two solid lines.
function tileLaneLines(rows, kind, f, material) {
  const position = [], index = [];
  const ground = (x, z) => (typeof NATURE!=="undefined"&&NATURE ? tileGroundAt(x,z) : TILE_GROUND_Y-earthDrop(x,z)) + TILE_PAINT_Y;
  const strip = (a, b, offset, half) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (!(len > 0.05)) return;
    const nx = -dz / len, nz = dx / len, base = position.length / 3;
    for (const [p, side] of [[a, -1], [b, -1], [b, 1], [a, 1]]) {
      const x = p[0] + nx * (offset + side * half), z = p[1] + nz * (offset + side * half);
      position.push(x, ground(x, z), z);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const row of rows) {
    const pts = [];
    for (let i = 0; i + 1 < row.length; i += 2) pts.push([f.x0 + row[i] * f.sx, -(f.y0 + row[i + 1] * f.sy)]);
    if (pts.length < 2) continue;
    if (kind === "yellow") {
      const off = (TILE_LANE.yellowM + TILE_LANE.yellowGapM) / 2;
      for (let i = 1; i < pts.length; i += 1) for (const side of [-1, 1]) strip(pts[i - 1], pts[i], side * off, TILE_LANE.yellowM / 2);
      continue;
    }
    // Broken white: the pattern's phase carried from one segment to the next.
    const period = TILE_LANE.dashM + TILE_LANE.gapM;
    let phase = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(len > 0)) continue;
      const at = (t) => [a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len];
      for (let s = -phase; s < len; s += period) {
        const from = Math.max(0, s), to = Math.min(len, s + TILE_LANE.dashM);
        if (to > from + 0.05) strip(at(from), at(to), 0, TILE_LANE.whiteM / 2);
      }
      phase = (phase + len) % period;
    }
  }
  if (!index.length) return [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return [new THREE.Mesh(geometry, material)];
}

//: The tiles to draw: from the root down, refining only where the tile being drawn would be
//: visibly wrong, and only where the children are already here. A parent stays up until every
//: child that is on screen has its geometry -- which is what makes the swap silent rather
//: than a hole that fills in.
