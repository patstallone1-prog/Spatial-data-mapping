// ---- inside the parks: playgrounds, dog areas, picnic areas, gardens, fitness, skateparks ----
//
// RPD's Facilities and Functional Areas (and OpenStreetMap's playgrounds outside them) say an
// area exists and give its outline: that is evidence. What stands inside an RPD playground is
// a fill: common equipment packed to the outline, by the age band RPD records where it records
// one, varied by a seed per playground, and tagged as a visual prior. A piece OpenStreetMap
// mapped stands where it was mapped. A playground (and a community garden) is fenced, with the
// gate where people come in: a mapped gate, else where a path crosses or meets the boundary,
// else the boundary nearest a path (smc.parks.areas.place_gates).
const PLAY_COLOURS = [0xc9452f, 0x2e78bd, 0xeeb12c, 0x3c9450, 0x7a4fa3, 0xe0782a, 0x1f9696];
const PLAY_FRAMES = [0x3d6b52, 0x52585e, 0x2b4f7a, 0x6b4b36];
//: Poured-rubber safety surfacing in the colours it is laid in: blue, terracotta, green, sand.
const PLAY_RUBBER = [0x86a9c4, 0xc97e62, 0x7fae72, 0xa9a5cf, 0xc8b58e];
const PARK_WOOD = 0x8c6a48;
const PARK_GEOMETRIES = {};
function parkGeometry(key) {
  if (PARK_GEOMETRIES[key]) return PARK_GEOMETRIES[key];
  let g;
  if (key === "box") g = new THREE.BoxGeometry(1, 1, 1);
  else if (key === "cyl") g = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  else if (key === "roof") { g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); g.rotateY(Math.PI / 4); }
  else if (key === "arc") g = new THREE.TorusGeometry(1, 0.03, 5, 16, Math.PI);
  else if (key === "ring") g = new THREE.TorusGeometry(1, 0.03, 5, 28);
  else if (key === "chute") g = slideChuteGeometry();
  return (PARK_GEOMETRIES[key] = g);
}
//: A slide's bed and walls, unit height (top at y=1, exit at y=0) and 2.4 m of run along +x:
//: steep from the deck, levelling into a short run-out, as a moulded slide is shaped.
function slideChuteGeometry() {
  const n = 18, run = 2.4, half = 0.28, wall = 0.16;
  const pos = [], idx = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const s = Math.min(1, t / 0.85);
    const y = 1 - (3 * s * s - 2 * s * s * s);
    const x = t * run;
    pos.push(x, y + wall, -half, x, y, -half, x, y, half, x, y + wall, half);
  }
  for (let i = 0; i < n; i += 1) {
    const a = i * 4, b = (i + 1) * 4;
    for (const [p, q] of [[0, 1], [1, 2], [2, 3]]) {
      idx.push(a + p, b + p, b + q, a + p, b + q, a + q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// One part of a piece of equipment, in the module's own frame (x along it, z across, y up).
function pp(list, g, c, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  list.push({ g, c, x, y, z, sx, sy, sz, rx, ry, rz });
}
function deckTower(parts, cx, cz, deckY, postH, colours, roof = true) {
  for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]])
    pp(parts, "cyl", colours.frame, cx + dx, postH / 2, cz + dz, 0.12, postH, 0.12);
  pp(parts, "box", 0x6f7378, cx, deckY, cz, 1.5, 0.08, 1.5);
  if (roof) pp(parts, "roof", colours.a, cx, postH + 0.42, cz, 1.9, 0.85, 1.9);
}
function slideOff(parts, x, z, yaw, height, colour) {
  // Chute leaves the deck edge at (x, z) heading along yaw (0 = +x of the module).
  pp(parts, "chute", colour, x, 0.32, z, 1, Math.max(0.4, height - 0.32), 1, 0, yaw, 0);
}
const PLAY_MODULES = {
  tower: { w: 8.0, d: 6.0, build(p, c) {
    deckTower(p, -1.6, 0, 1.5, 3.1, c);
    deckTower(p, 1.3, 0, 1.1, 2.2, { ...c, a: c.b });
    pp(p, "box", c.b, -0.15, 1.31, 0, 1.4, 0.06, 0.75, 0, 0, Math.atan2(0.4, 1.4));
    for (const s of [-1, 1]) pp(p, "box", c.frame, -0.15, 1.75, s * 0.4, 1.45, 0.05, 0.04, 0, 0, Math.atan2(0.4, 1.4));
    slideOff(p, -1.6, -0.75, Math.PI / 2, 1.5, c.c);
    pp(p, "box", c.a, -2.38, 1.95, 0, 0.04, 0.8, 1.4);
    pp(p, "box", c.c, 2.2, 0.62, 0, 0.08, 1.35, 1.25, 0, 0, -0.33);
    for (let i = 0; i < 5; i += 1) pp(p, "box", PLAY_COLOURS[i], 2.35 - i * 0.07, 0.2 + i * 0.22, -0.4 + (i % 3) * 0.35, 0.09, 0.08, 0.1, 0, 0, -0.33);
    for (let i = 0; i < 4; i += 1) pp(p, "box", 0x6f7378, -1.6, 0.18 + i * 0.36, 0.95 + i * 0.28 - 0.0, 1.0, 0.06, 0.32);
  } },
  tot: { w: 5.0, d: 4.2, build(p, c) {
    deckTower(p, 0, 0, 0.75, 1.9, c);
    slideOff(p, 0.75, 0, 0, 0.75, c.c);
    for (let i = 0; i < 3; i += 1) pp(p, "box", 0x6f7378, -0.95 - i * 0.3, 0.13 + i * 0.22, 0, 0.32, 0.06, 1.0);
    pp(p, "cyl", c.b, 0, 0.36, -1.45, 0.72, 1.4, 0.72, Math.PI / 2, 0, 0);
  } },
  swings: { w: 7.4, d: 6.4, build(p, c, toddler) {
    const lean = Math.atan2(0.9, 2.4), leg = Math.hypot(2.4, 0.9);
    for (const sx of [-3, 3]) {
      pp(p, "cyl", c.frame, sx, 1.2, 0.45, 0.11, leg, 0.11, -lean, 0, 0);
      pp(p, "cyl", c.frame, sx, 1.2, -0.45, 0.11, leg, 0.11, lean, 0, 0);
    }
    pp(p, "cyl", c.frame, 0, 2.4, 0, 0.13, 6.1, 0.13, 0, 0, Math.PI / 2);
    for (const x of [-2.1, -0.9, 0.9, 2.1]) {
      for (const s of [-0.22, 0.22]) pp(p, "cyl", 0x9aa0a4, x + s, 1.43, 0, 0.018, 1.95, 0.018);
      if (toddler) pp(p, "box", c.a, x, 0.5, 0, 0.46, 0.3, 0.36);
      else pp(p, "box", 0x262626, x, 0.45, 0, 0.5, 0.05, 0.22);
    }
  } },
  slide: { w: 2.2, d: 5.4, build(p, c) {
    for (const s of [-0.3, 0.3]) pp(p, "cyl", c.frame, s, 0.95, -2.0, 0.07, 2.0, 0.07, -0.26, 0, 0);
    for (let i = 0; i < 5; i += 1) pp(p, "cyl", 0x9aa0a4, 0, 0.3 + i * 0.35, -2.2 + i * 0.1, 0.05, 0.6, 0.05, 0, 0, Math.PI / 2);
    pp(p, "box", 0x6f7378, 0, 1.8, -1.6, 0.8, 0.06, 0.8);
    for (const s of [-0.38, 0.38]) pp(p, "cyl", c.frame, s, 0.9, -1.6, 0.08, 1.8, 0.08);
    slideOff(p, 0, -1.2, -Math.PI / 2, 1.8, c.a);
  } },
  dome: { w: 4.2, d: 4.2, build(p, c) {
    const R = 1.7;
    for (let k = 0; k < 4; k += 1) pp(p, "arc", c.a, 0, 0, 0, R, R, R, 0, k * Math.PI / 4, 0);
    for (const phi of [0.02, Math.PI / 6, Math.PI / 3]) {
      const r = R * Math.cos(phi);
      pp(p, "ring", c.b, 0, R * Math.sin(phi), 0, r, r, r, Math.PI / 2, 0, 0);
    }
  } },
  spinner: { w: 3.4, d: 3.4, build(p, c) {
    pp(p, "cyl", c.a, 0, 0.3, 0, 2.0, 0.08, 2.0);
    pp(p, "cyl", c.frame, 0, 0.6, 0, 0.12, 1.0, 0.12);
    pp(p, "ring", c.b, 0, 0.92, 0, 0.8, 0.8, 0.8, Math.PI / 2, 0, 0);
    for (let k = 0; k < 4; k += 1) pp(p, "cyl", c.frame, 0.8 * Math.cos(k * Math.PI / 2), 0.62, 0.8 * Math.sin(k * Math.PI / 2), 0.05, 0.6, 0.05);
  } },
  seesaw: { w: 4.2, d: 1.8, build(p, c) {
    pp(p, "box", c.frame, 0, 0.2, 0, 0.3, 0.4, 0.3);
    pp(p, "box", c.a, 0, 0.45, 0, 3.4, 0.08, 0.26, 0, 0, 0.12);
    for (const s of [-1, 1]) {
      pp(p, "box", 0x262626, s * 1.45, 0.45 - s * 0.17 + 0.06, 0, 0.4, 0.06, 0.3, 0, 0, 0.12);
      pp(p, "cyl", c.frame, s * 1.15, 0.62 - s * 0.14, 0, 0.04, 0.32, 0.04);
    }
  } },
  springs: { w: 3.4, d: 2.0, build(p, c) {
    for (const [s, col] of [[-0.8, c.a], [0.8, c.c]]) {
      pp(p, "cyl", 0x3a3d40, s, 0.24, 0, 0.18, 0.46, 0.18);
      pp(p, "box", col, s, 0.62, 0, 0.75, 0.3, 0.28);
      pp(p, "box", col, s + 0.32, 0.86, 0, 0.24, 0.3, 0.2);
      pp(p, "cyl", 0x262626, s + 0.22, 0.86, 0, 0.03, 0.34, 0.03, Math.PI / 2, 0, 0);
    }
  } },
  sandpit: { w: 4.2, d: 4.2, build(p) {
    for (const s of [-1, 1]) {
      pp(p, "box", PARK_WOOD, 0, 0.14, s * 1.85, 3.95, 0.28, 0.25);
      pp(p, "box", PARK_WOOD, s * 1.85, 0.14, 0, 0.25, 0.28, 3.45);
    }
    pp(p, "box", 0xd6c59b, 0, 0.06, 0, 3.45, 0.08, 3.45);
  } },
  house: { w: 2.6, d: 2.6, build(p, c) {
    for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]])
      pp(p, "cyl", c.frame, dx, 1.0, dz, 0.1, 2.0, 0.1);
    pp(p, "box", 0x6f7378, 0, 0.25, 0, 1.8, 0.06, 1.8);
    pp(p, "roof", c.a, 0, 2.38, 0, 2.2, 0.75, 2.2);
    pp(p, "box", c.b, -0.9, 0.7, 0, 0.05, 0.8, 1.8);
    pp(p, "box", c.c, 0, 0.7, 0.9, 1.8, 0.8, 0.05);
  } },
  balance: { w: 3.8, d: 1.2, build(p, c) {
    for (const x of [-1.3, 0, 1.3]) pp(p, "cyl", c.frame, x, 0.12, 0, 0.12, 0.24, 0.12);
    pp(p, "box", c.a, 0, 0.3, 0, 3.2, 0.12, 0.15);
  } },
};
const AGE_PLAN = {
  "2-5": { main: ["tot", "tot"], fill: ["springs", "house", "sandpit", "slide", "seesaw", "swings"] },
  "5-12": { main: ["tower", "tower"], fill: ["swings", "dome", "spinner", "slide", "balance", "springs"] },
  all: { main: ["tower", "tot", "tower"], fill: ["swings", "dome", "springs", "slide", "spinner", "seesaw", "house", "balance", "sandpit"] },
};

function insideRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function pageRing(ring) {
  return ring.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
}
//: The area's own axes: the smallest rectangle round it, from the edge directions.
function areaFrame(pts) {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const ux = dx / len, uz = dz / len;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of pts) {
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      a = Math.min(a, u); b = Math.max(b, u); c = Math.min(c, v); d = Math.max(d, v);
    }
    const area = (b - a) * (d - c);
    if (!best || area < best.area) best = { area, ux, uz, minU: a, maxU: b, minV: c, maxV: d };
  }
  if (!best) return null;
  best.page = (u, v) => [u * best.ux - v * best.uz, u * best.uz + v * best.ux];
  best.yaw = Math.atan2(-best.uz, best.ux);
  return best;
}
//: Every corner, edge midpoint and the middle of a module's rectangle (grown by margin) lie
//: inside the outline and out of its holes, and it overlaps nothing already placed.
function rectFits(frame, rings, holes, placed, u, v, w, d, margin) {
  const hw = w / 2 + margin, hd = d / 2 + margin;
  for (const [a, b] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
    const [x, z] = frame.page(u + a * hw, v + b * hd);
    if (!rings.every((ring) => insideRing(x, z, ring))) return false;
    if (holes.some((hole) => insideRing(x, z, hole))) return false;
  }
  return !placed.some((r) => Math.abs(r.u - u) < (r.w + w) / 2 + 0.5 && Math.abs(r.v - v) < (r.d + d) / 2 + 0.5);
}
function seededShuffle(list, seed) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random(seed + i * 31) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
//: Pack equipment into one outline. The first piece goes as near the middle as it fits; the rest
//: wherever they fit, in a seeded order, until nothing more does or the playground is full.
function fillPlayground(...args) { return runSteps(fillPlaygroundSteps(...args)); }
//: The same packing, giving the frame back every 64 spots tried: a playground that is full is
//: every spot tried against every piece left, and one park's was a fifth of a second.
function* fillPlaygroundSteps(frame, rings, holes, plan, seed, sand, toddler, limit = 9, taken = []) {
  // Pieces already standing (mapped by OpenStreetMap) are obstacles in this frame, not fill.
  const placed = taken.map((t) => ({ ...t, fixed: true }));
  const step = 0.75;
  let tried = 0;
  const tryPlace = function* (kind, central) {
    const spec = PLAY_MODULES[kind];
    for (const turned of random(seed + kind.length) < 0.5 ? [false, true] : [true, false]) {
      const w = turned ? spec.d : spec.w, d = turned ? spec.w : spec.d;
      const spots = [];
      for (let u = frame.minU + w / 2; u <= frame.maxU - w / 2; u += step)
        for (let v = frame.minV + d / 2; v <= frame.maxV - d / 2; v += step) spots.push([u, v]);
      const mu = (frame.minU + frame.maxU) / 2, mv = (frame.minV + frame.maxV) / 2;
      const order = central ? spots.sort((a, b) => Math.hypot(a[0] - mu, a[1] - mv) - Math.hypot(b[0] - mu, b[1] - mv))
        : seededShuffle(spots, seed + placed.length * 97);
      for (const [u, v] of order) {
        if ((++tried & 63) === 0) yield;
        if (rectFits(frame, rings, holes, placed, u, v, w, d, 0.6)) {
          placed.push({ kind, u, v, w, d, turned, toddler });
          return true;
        }
      }
    }
    return false;
  };
  // The main structure goes nearest the middle; a large playground takes a second one.
  const area = (frame.maxU - frame.minU) * (frame.maxV - frame.minV);
  let mains = 0;
  for (const kind of plan.main) {
    if (mains >= (area > 900 ? 2 : 1)) break;
    if (yield* tryPlace(kind, mains === 0)) mains += 1;
  }
  const fill = seededShuffle(plan.fill.filter((k) => k !== "sandpit" || sand || random(seed + 5) < 0.3), seed);
  if (sand) { fill.splice(fill.indexOf("sandpit"), 1); fill.unshift("sandpit"); }
  const filled = () => placed.filter((p) => !p.fixed).length + taken.length;
  // A big playground is a lot of equipment: the fill goes round again while there is room.
  for (const kind of area > 600 ? [...fill, ...fill] : fill) { if (filled() >= limit) break; yield* tryPlace(kind, false); }
  // Fill to fit: the small pieces again while there is room.
  for (const kind of ["springs", "balance", "house", "seesaw", "springs"]) {
    if (filled() >= limit) break;
    yield* tryPlace(kind, false);
  }
  return placed.filter((p) => !p.fixed);
}

const PARK_PARTS = [];
const PARK_PART_M = new THREE.Matrix4(), PARK_PART_Q = new THREE.Quaternion(), PARK_PART_E = new THREE.Euler();
const PARK_PART_P = new THREE.Vector3(), PARK_PART_S = new THREE.Vector3();
//: A piece of equipment stands on the ground under its own middle: every part of it is lifted
//: by the same amount, so a climbing tower on a slope does not shear.
function placeParkModule(parts, x, z, yaw, surface) {
  const base = groundLiftAt(x, z) + PLAYGROUND_Y;
  const module = new THREE.Matrix4().compose(new THREE.Vector3(x, base, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  for (const p of parts) {
    PARK_PART_P.set(p.x, p.y, p.z);
    PARK_PART_Q.setFromEuler(PARK_PART_E.set(p.rx, p.ry, p.rz));
    PARK_PART_S.set(p.sx, p.sy, p.sz);
    PARK_PART_M.compose(PARK_PART_P, PARK_PART_Q, PARK_PART_S).premultiply(module);
    PARK_PARTS.push({ g: p.g, c: p.c, m: PARK_PART_M.clone(), surface });
  }
}
function emitParkParts() {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.12 });
  const twoSided = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
  const groupsOf = new Map();
  for (const part of PARK_PARTS) {
    const key = `${part.surface}|${part.g}`;
    if (!groupsOf.has(key)) groupsOf.set(key, []);
    groupsOf.get(key).push(part);
  }
  const colour = new THREE.Color();
  for (const [key, list] of groupsOf) {
    const [surface, g] = key.split("|");
    const mesh = new THREE.InstancedMesh(parkGeometry(g), g === "chute" ? twoSided : material, list.length);
    list.forEach((part, i) => { mesh.setMatrixAt(i, part.m); mesh.setColorAt(i, colour.setHex(part.c)); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData = { surface, basis: surface.endsWith(":mapped") ? "osm_playground_feature" : "visual_prior_fill",
      liftedOntoGround: true };
    groups.ground.add(mesh);
  }
  PARK_PARTS.length = 0;
}

function playFenceTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "rgba(255,255,255,1)";
  for (let x = 2; x < 64; x += 8) ctx.fillRect(x, 3, 3, 59);
  ctx.fillRect(0, 4, 64, 4);
  ctx.fillRect(0, 54, 64, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  return texture;
}
function rubberTexture(hex) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d"), image = ctx.createImageData(128, 128);
  const c = new THREE.Color(hex);
  for (let i = 0; i < 128 * 128; i += 1) {
    const n = (random(i * 3 + hex) * 2 - 1) * 10;
    image.data[i * 4] = Math.max(0, Math.min(255, c.r * 255 + n));
    image.data[i * 4 + 1] = Math.max(0, Math.min(255, c.g * 255 + n));
    image.data[i * 4 + 2] = Math.max(0, Math.min(255, c.b * 255 + n));
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

//: A fence round the outline, open where each gate is, with the gate leaf swung inward.
//: The ways into a fenced park area: its recorded gates, or with none, one in the middle of its
//: longest side, recorded as a fallback.
function parkAreaGates(area, pts) {
  const gates = (area.gates || []).map((g) => { const [x, y] = xy(g.p[0], g.p[1]); return { x, z: -y, w: g.width_m || 1.2 }; });
  if (!gates.length) {
    let best = null;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const span = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (!best || span > best.span) best = { span, x: (pts[i][0] + pts[i + 1][0]) / 2, z: (pts[i][1] + pts[i + 1][1]) / 2 };
    }
    if (best) gates.push({ x: best.x, z: best.z, w: 1.2, fallback: true });
  }
  return gates;
}
//: Every fenced park area's gates, noted (noteFenceGate) before any fence is laid: a property's
//: or a mapped fence along a playground's side keeps the playground's way in open.
//: How high a walk gate's bar is over the ground at its underside (m): clear of a walker's head
//: from a walk or a kerb half a metre up.
const GATE_BAR_CLEAR_M = 2.55;
//: The narrowest way in drawn (m, post to post): a walker is 0.6 m across, and a post 0.14.
const GATE_MIN_W_M = 1.1;
function noteParkAreaGates(areas) {
  let noted = 0;
  for (const area of areas || []) {
    if (!(area.kind === "playground" || area.kind === "garden" || (area.kind === "dog_area" && area.fence))) continue;
    const pts = pageRing(area.p);
    if (pts.length < 4) continue;
    for (const gate of parkAreaGates(area, pts)) {
      let best = null;
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], span = Math.hypot(bx - ax, bz - az);
        if (span < 0.3) continue;
        const ux = (bx - ax) / span, uz = (bz - az) / span, t = (gate.x - ax) * ux + (gate.z - az) * uz;
        const off = Math.abs(-(gate.x - ax) * uz + (gate.z - az) * ux);
        if (t > -0.3 && t < span + 0.3 && off < 0.6 && (!best || off < best.off)) best = { off, ax, az, ux, uz, t, span };
      }
      if (!best) continue;
      const lo = Math.max(0, best.t - gate.w / 2), hi = Math.min(best.span, best.t + gate.w / 2);
      noteFenceGate(best.ax + best.ux * lo, best.az + best.uz * lo, best.ax + best.ux * hi, best.az + best.uz * hi);
      noted += 1;
    }
  }
  return noted;
}
function fenceArea(area, pts, height, kind, sink) {
  const gates = parkAreaGates(area, pts);
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const span = Math.hypot(bx - ax, bz - az);
    if (span < 0.3) continue;
    const ux = (bx - ax) / span, uz = (bz - az) / span;
    // The openings on this edge, as distances along it.
    const cuts = [];
    for (const gate of gates) {
      const t = (gate.x - ax) * ux + (gate.z - az) * uz;
      const off = Math.abs(-(gate.x - ax) * uz + (gate.z - az) * ux);
      if (t > -0.3 && t < span + 0.3 && off < 0.6) cuts.push([Math.max(0, t - gate.w / 2), Math.min(span, t + gate.w / 2), gate]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let at = 0;
    const runs = [];
    for (const [lo, hi] of cuts) { if (lo > at) runs.push([at, lo]); at = Math.max(at, hi); }
    if (at < span) runs.push([at, span]);
    for (const [lo, hi] of runs) {
      if (hi - lo < 0.2) continue;
      const x0 = ax + ux * lo, z0 = az + uz * lo, x1 = ax + ux * hi, z1 = az + uz * hi;
      let crosses = false;
      for (let c = 0; c <= Math.max(2, Math.ceil((hi - lo) / 2)); c += 1) {
        const f = c / Math.max(2, Math.ceil((hi - lo) / 2));
        if (insideCarriageway(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, 0.15)) { crosses = true; break; }
      }
      if (crosses) continue;
      // What no other fence or wall already carries (layFence), with its posts.
      for (const [p0x, p0z, p1x, p1z] of sink.fence(x0, z0, x1, z1, height)) {
        const piece = Math.hypot(p1x - p0x, p1z - p0z);
        for (let d = 0; d <= piece + 0.01; d += 2.4) sink.posts.push([p0x + ux * d, p0z + uz * d, height + 0.1, 0.045]);
        sink.posts.push([p1x, p1z, height + 0.1, 0.045]);
      }
    }
    for (const [lo, hi, gate] of cuts) {
      // Gate posts either side; the leaf hinged on one and swung 70 degrees into the area.
      const hx = ax + ux * lo, hz = az + uz * lo;
      sink.posts.push([hx, hz, height + 0.25, 0.06], [ax + ux * hi, az + uz * hi, height + 0.25, 0.06]);
      const inward = (-(cx - ax) * uz + (cz - az) * ux) > 0 ? 1 : -1;
      const ang = 70 * Math.PI / 180;
      const lx = ux * Math.cos(ang) - inward * uz * Math.sin(ang), lz = uz * Math.cos(ang) + inward * ux * Math.sin(ang);
      const leaf = hi - lo - 0.05;
      sink.quad(hx, hz, hx + lx * leaf, hz + lz * leaf, height, leaf);
      sink.gates.push({ area: area.id, kind, basis: gate.fallback ? "fallback_longest_side" : "evidence" });
    }
  }
}
function fenceSink() {
  const sink = { positions: [], uvs: [], indices: [], posts: [], gates: [] };
  sink.quad = (x0, z0, x1, z1, h, span) => {
    groundedFencePanel(sink,x0,z0,x1,z1,PLAYGROUND_Y,h,1,h);
  };
  sink.fence = (x0, z0, x1, z1, h) => layFence(sink, x0, z0, x1, z1, PLAYGROUND_Y, h, 1, h);
  return sink;
}
function emitFence(sink, material, surface) {
  if (sink.indices.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
    geom.setIndex(sink.indices);
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, material);
    mesh.userData = { surface, gates: sink.gates.length,liftedOntoGround:true,
      elevationBasis:"terrain_sampled_0.75m" };
    groups.ground.add(mesh);
  }
  if (sink.posts.length) {
    const post = new THREE.InstancedMesh(parkGeometry("cyl"),
      new THREE.MeshStandardMaterial({ color: 0x2f3a33, roughness: 0.5, metalness: 0.5 }), sink.posts.length);
    const dummy = new THREE.Object3D();
    sink.posts.forEach(([x, z, h, r], i) => {
      dummy.position.set(x, PLAYGROUND_Y + h / 2, z);
      dummy.scale.set(r * 2, h, r * 2);
      dummy.updateMatrix();
      post.setMatrixAt(i, dummy.matrix);
    });
    post.instanceMatrix.needsUpdate = true;
    post.computeBoundingSphere();
    post.userData = { surface: `${surface}_post` };
    groups.ground.add(post);
  }
}

function benchParts(parts) {
  pp(parts, "box", PARK_WOOD, 0, 0.45, 0, 1.6, 0.05, 0.42);
  pp(parts, "box", PARK_WOOD, 0, 0.72, -0.2, 1.6, 0.36, 0.05);
  for (const s of [-0.7, 0.7]) pp(parts, "box", 0x3d4245, s, 0.22, 0, 0.06, 0.44, 0.42);
  return parts;
}
function picnicParts(parts) {
  pp(parts, "box", PARK_WOOD, 0, 0.74, 0, 1.8, 0.05, 0.76);
  for (const s of [-0.62, 0.62]) pp(parts, "box", PARK_WOOD, 0, 0.45, s, 1.8, 0.045, 0.26);
  for (const s of [-0.7, 0.7]) pp(parts, "box", 0x4a4f52, s, 0.37, 0, 0.06, 0.74, 1.4);
  return parts;
}
function bedParts(parts, seed) {
  pp(parts, "box", 0x7a5a3c, 0, 0.16, 0, 3.0, 0.32, 1.2);
  pp(parts, "box", 0x3b2b1e, 0, 0.325, 0, 2.86, 0.02, 1.06);
  for (let i = 0; i < 5; i += 1) {
    const g = [0x4f7f3a, 0x6b8f3a, 0x3f6b37, 0x7c9a45][Math.floor(random(seed + i) * 4)];
    const h = 0.2 + random(seed + i * 7) * 0.35;
    pp(parts, "box", g, -1.15 + i * 0.58, 0.33 + h / 2, (random(seed + i * 3) - 0.5) * 0.5, 0.42, h, 0.42);
  }
  return parts;
}
function fitnessParts(parts, k) {
  const frame = 0x2e6b4f;
  if (k % 3 === 0) {
    for (const s of [-0.7, 0.7]) pp(parts, "cyl", frame, s, 1.15, 0, 0.1, 2.3, 0.1);
    pp(parts, "cyl", 0x9aa0a4, 0, 2.2, 0, 0.05, 1.5, 0.05, 0, 0, Math.PI / 2);
  } else if (k % 3 === 1) {
    for (const [x, z] of [[-0.9, -0.3], [0.9, -0.3], [-0.9, 0.3], [0.9, 0.3]]) pp(parts, "cyl", frame, x, 0.55, z, 0.09, 1.1, 0.09);
    for (const z of [-0.3, 0.3]) pp(parts, "cyl", 0x9aa0a4, 0, 1.1, z, 0.05, 1.9, 0.05, 0, 0, Math.PI / 2);
  } else {
    pp(parts, "box", frame, 0, 0.4, 0, 1.6, 0.06, 0.45, 0, 0, 0.25);
    for (const s of [-0.6, 0.6]) pp(parts, "cyl", frame, s, 0.25 + s * 0.15, 0, 0.07, 0.5 + s * 0.3, 0.07);
  }
  return parts;
}

//: Cells in a rectangle grid inside an outline: where tables, beds and stations go.
function gridSpots(frame, rings, holes, w, d, gapU, gapV, margin, limit) {
  const spots = [];
  for (let u = frame.minU + margin + w / 2; u <= frame.maxU - margin - w / 2; u += w + gapU)
    for (let v = frame.minV + margin + d / 2; v <= frame.maxV - margin - d / 2; v += d + gapV)
      if (rectFits(frame, rings, holes, [], u, v, w, d, 0.3)) spots.push([u, v]);
  return spots.slice(0, limit);
}

function buildParkAreas(areas) { return runSteps(buildParkAreasSteps(areas)); }
//: A park at a time, and inside one, a slice of its playground packing at a time.
function* buildParkAreasSteps(areas) {
  const stats = { playgrounds: 0, modules: 0, mapped_pieces: 0, gates: 0, fallback_gates: 0, dog_areas: 0,
    picnic_tables: 0, garden_beds: 0, fitness_stations: 0, skateparks: 0 };
  if (!areas || !areas.length) return stats;
  const surfaces = new Map();
  const picket = fenceSink(), chain = fenceSink();
  for (const area of areas) {
    yield;
    const pts = pageRing(area.p);
    if (pts.length < 4) continue;
    const frame = areaFrame(pts);
    if (!frame) continue;
    const holes = (area.holes || []).map(pageRing);
    const seed = area.seed || 1;
    const centre = frame.page((frame.minU + frame.maxU) / 2, (frame.minV + frame.maxV) / 2);
    if (!insideBBoxPage(centre[0], centre[1])) continue;
    if (area.kind === "playground") {
      stats.playgrounds += 1;
      const material = area.surface?.material;
      const finish = material === "sand" ? 0xd6c59b : ["woodchips", "wood_chips", "bark"].includes(material) ? 0x9a7b55
        : material === "grass" ? null : PLAY_RUBBER[seed % PLAY_RUBBER.length];
      if (finish !== null) {
        if (!surfaces.has(finish)) surfaces.set(finish, []);
        surfaces.get(finish).push(area.p);
      }
      const colours = { frame: PLAY_FRAMES[seed % PLAY_FRAMES.length], a: PLAY_COLOURS[seed % 7],
        b: PLAY_COLOURS[(seed >> 3) % 7], c: PLAY_COLOURS[(seed >> 6) % 7] };
      const mapped = area.equipment || [];
      const taken = [];
      for (const piece of mapped) {
        const spec = PLAY_MODULES[{ climber: "dome", structure: "tot", spring_rider: "springs", playhouse: "house",
          swing: "swings" }[piece.kind] || piece.kind];
        if (!spec) continue;
        const [x, y] = xy(piece.p[0], piece.p[1]);
        const parts = [];
        spec.build(parts, colours, false);
        placeParkModule(parts, x, -y, frame.yaw, "park:playground:mapped");
        taken.push({ x, z: -y, w: spec.w, d: spec.d });
        stats.mapped_pieces += 1;
      }
      {
        const zones = (area.zones || []).filter((z) => z.p && z.p.length >= 4);
        const passes = zones.length ? zones.map((z) => ({ ring: pageRing(z.p), age: z.age })) : [{ ring: pts, age: area.age }];
        for (const pass of passes) {
          const zoneFrame = areaFrame(pass.ring) || frame;
          const plan = AGE_PLAN[pass.age] || AGE_PLAN.all;
          // Mapped pieces into this frame's own axes, as rectangles the fill must keep clear of.
          const obstacles = taken.map((t) => ({ kind: "mapped", w: t.w, d: t.d,
            u: t.x * zoneFrame.ux + t.z * zoneFrame.uz, v: -t.x * zoneFrame.uz + t.z * zoneFrame.ux }));
          const placed = yield* fillPlaygroundSteps(zoneFrame, [pts, pass.ring], holes, plan, seed + pass.ring.length,
            Boolean(area.sand_play) || material === "sand", pass.age === "2-5",
            Math.max(4, Math.min(16, Math.round((area.area_m2 || 200) / 70))), obstacles);
          for (const m of placed) {
            const parts = [];
            PLAY_MODULES[m.kind].build(parts, colours, m.toddler);
            const [x, z] = zoneFrame.page(m.u, m.v);
            placeParkModule(parts, x, z, zoneFrame.yaw + (m.turned ? Math.PI / 2 : 0), "park:playground:fill");
            stats.modules += 1;
          }
        }
      }
      // A bench for the grown-ups, inside, along the longest side.
      const bench = gridSpots(frame, [pts], holes, 1.6, 0.5, 6, 100, 0.9, 2);
      for (const [u, v] of bench.slice(0, frame.area > 120 ? 2 : 1)) {
        const [x, z] = frame.page(u, v);
        placeParkModule(benchParts([]), x, z, frame.yaw, "park:bench");
      }
      fenceArea(area, pts, area.fence?.height_m || 1.2, "playground", picket);
    } else if (area.kind === "dog_area") {
      stats.dog_areas += 1;
      // A sign and a waste station by the way in, benches along a side. No fence assumed.
      const spots = gridSpots(frame, [pts], holes, 1.6, 0.5, 8, 100, 1.0, 2);
      for (const [u, v] of spots) { const [x, z] = frame.page(u, v); placeParkModule(benchParts([]), x, z, frame.yaw, "park:bench"); }
      const [sx, sz] = frame.page(frame.minU + 1.2, (frame.minV + frame.maxV) / 2);
      if (insideRing(sx, sz, pts)) {
        const parts = [];
        pp(parts, "cyl", 0x3d4245, 0, 1.0, 0, 0.07, 2.0, 0.07);
        pp(parts, "box", 0x2f5d3a, 0, 1.75, 0, 0.62, 0.42, 0.03);
        pp(parts, "cyl", 0x3d4245, 0.9, 0.55, 0, 0.06, 1.1, 0.06);
        pp(parts, "box", 0x2f5d3a, 0.9, 0.9, 0.08, 0.28, 0.4, 0.14);
        placeParkModule(parts, sx, sz, frame.yaw, "park:dog_area");
      }
      if (area.fence) fenceArea(area, pts, area.fence.height_m || 1.5, "dog_area", chain);
    } else if (area.kind === "picnic") {
      const tables = area.tables?.length ? area.tables.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y, "mapped"]; })
        : gridSpots(frame, [pts], holes, 1.8, 1.6, 2.4, 2.2, 0.8, 14).map(([u, v]) => [...frame.page(u, v), "fill"]);
      for (const [x, z, basis] of tables) { placeParkModule(picnicParts([]), x, z, frame.yaw, `park:picnic:${basis}`); stats.picnic_tables += 1; }
    } else if (area.kind === "garden") {
      for (const [u, v] of gridSpots(frame, [pts], holes, 3.0, 1.2, 1.0, 0.9, 0.8, 40)) {
        const [x, z] = frame.page(u, v);
        placeParkModule(bedParts([], seed + Math.round(u * 13 + v * 7)), x, z, frame.yaw, "park:garden");
        stats.garden_beds += 1;
      }
      fenceArea(area, pts, area.fence?.height_m || 1.5, "garden", chain);
    } else if (area.kind === "fitness") {
      const spots = gridSpots(frame, [pts], holes, 2.0, 1.2, 2.5, 2.0, 0.6, 8);
      spots.forEach(([u, v], k) => {
        const [x, z] = frame.page(u, v);
        placeParkModule(fitnessParts([], k + seed), x, z, frame.yaw, "park:fitness");
        stats.fitness_stations += 1;
      });
    } else if (area.kind === "skatepark") {
      stats.skateparks += 1;
      if (!surfaces.has("skate")) surfaces.set("skate", []);
      surfaces.get("skate").push(area.p);
      const spots = gridSpots(frame, [pts], holes, 3.2, 2.4, 3, 3, 1.0, 3);
      spots.forEach(([u, v], k) => {
        const parts = [];
        if (k % 3 === 0) { pp(parts, "box", 0xa9a59c, 0, 0.25, 0, 3.0, 0.5, 2.0); pp(parts, "cyl", 0x9aa0a4, 0, 0.52, 0.8, 0.05, 3.0, 0.05, 0, 0, Math.PI / 2); }
        else if (k % 3 === 1) { pp(parts, "box", 0xa9a59c, 0, 0.45, 0, 3.0, 0.1, 2.4, 0, 0, 0.32); pp(parts, "box", 0xa9a59c, 1.35, 0.45, 0, 0.3, 0.9, 2.4); }
        else { for (const s of [-1.2, 1.2]) pp(parts, "cyl", 0x52585e, s, 0.2, 0, 0.06, 0.4, 0.06); pp(parts, "cyl", 0x9aa0a4, 0, 0.4, 0, 0.06, 3.0, 0.06, 0, 0, Math.PI / 2); }
        const [x, z] = frame.page(u, v);
        placeParkModule(parts, x, z, frame.yaw, "park:skatepark");
      });
    }
  }
  for (const [finish, rings] of surfaces) {
    const geom = ringGeometry(rings, PLAYGROUND_Y, true, null, finish === "skate");
    if (!geom) continue;
    // As a mapped plaza is: the coarse terrain backdrop bridges above fine ground on a steep
    // cell, so the surface is drawn over that backdrop, not depth-fought against it.
    const material = finish === "skate"
      ? new THREE.MeshStandardMaterial({ map: SIDEWALK, color: 0xc9c6bd, roughness: 0.85, side: THREE.DoubleSide, depthTest: false })
      : new THREE.MeshStandardMaterial({ map: rubberTexture(finish), color: 0xffffff, roughness: 0.92, side: THREE.DoubleSide, depthTest: false });
    const surfaceMesh = addGround(new THREE.Mesh(geom, material), finish === "skate" ? "park:skatepark_surface" : "park:play_surface");
    surfaceMesh.renderOrder = -1;
  }
  const picketMaterial = new THREE.MeshStandardMaterial({ map: playFenceTexture(), alphaTest: 0.5, side: THREE.DoubleSide,
    color: 0x2f3a33, roughness: 0.55, metalness: 0.45 });
  emitFence(picket, picketMaterial, "park:playground_fence");
  const chainMaterial = chainlinkMaterial();
  chain.uvs.forEach((v, i) => { chain.uvs[i] = i % 2 ? v * 2.5 : v / 0.6; });
  emitFence(chain, chainMaterial, "park:garden_fence");
  stats.gates = picket.gates.length + chain.gates.length;
  stats.fallback_gates = [...picket.gates, ...chain.gates].filter((g) => g.basis !== "evidence").length;
  emitParkParts();
  return stats;
}
function insideBBoxPage(x, z) {
  const [w, s] = xy(DATA.bbox.west, DATA.bbox.south), [e, n] = xy(DATA.bbox.east, DATA.bbox.north);
  return x >= w && x <= e && z <= -s && z >= -n;
}

// ---- fences on property lines ----
//
// docs/property-fences.json (tools/build_property_fences.py) says which properties are fenced:
// a school round its yard, a reservoir or a works yard, a park on the sides the parks department
// surveyed a fence on and no others, a car park that is closed to the public or has a mapped
// fence. An open car park, a public building (its walls are the barrier) and a park side with no
// recorded fence get nothing. Here the line is walked against what stands there: no fence where
// a building is on the line, none across a roadway, none where a court's or a playground's own
// fence already is. The gates are the recorded ones, and inferred ones where people would come
// in (docs/property-fences.mjs placeGates): each is a clear opening with a dark frame round it.
const PROPERTY_FENCE_STYLE = {
  chain_link: { surface: "fence:chainlink", post: 0x1c1f21 },
  bars: { surface: "fence:picket", post: 0x22272a },
  rail: { surface: "fence:picket", post: 0x22272a },
  picket: { surface: "fence:picket", post: 0x2f3a33 },
  split_rail: { surface: "fence:picket", post: 0x5a4632 },
  board: { surface: "fence:board", post: 0x3a2b20 },
  wall: { surface: "fence:wall", post: null },
  hedge: { surface: "fence:wall", post: null },
};
async function buildPropertyFences() {
  const b = DATA.bbox;
  if (!b) return null;
  const box = BUILD_WINDOW?.box || [b.west, b.south, b.east, b.north];
  if (box[0] > -122.34 || box[2] < -122.53 || box[1] > 37.84 || box[3] < 37.70) return null;
  const [api, response] = await Promise.all([import(sharedAsset("property-fences.mjs")), fetch(sharedAsset("property-fences.json"))]);
  if (!response.ok) throw Error("property fences HTTP " + response.status);
  const data = await response.json();
  const stats = { properties: 0, fence_m: 0, gates: 0, gates_recorded: 0, gates_inferred: 0, by_kind: {}, skipped_m: 0 };
  // The fences others draw: a court's surround, a playground's, a garden's.
  const drawn = [];
  for (const pad of COURT_PADS) drawn.push(pad.local);
  for (const area of PARK_EVIDENCE?.areas || []) if (area.kind === "playground" || area.kind === "garden" || area.fence) drawn.push(pageRing(area.p));
  const drawnGrid = new Map(), cell = (x, z) => Math.floor(x / 12) + ":" + Math.floor(z / 12);
  for (const ring of drawn) for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i], q = ring[i + 1], n = Math.max(1, Math.ceil(Math.hypot(q[0] - a[0], q[1] - a[1]) / 6));
    for (let k = 0; k <= n; k += 1) { const key = cell(a[0] + (q[0] - a[0]) * k / n, a[1] + (q[1] - a[1]) * k / n); if (!drawnGrid.has(key)) drawnGrid.set(key, []); if (!drawnGrid.get(key).includes(ring)) drawnGrid.get(key).push(ring); }
  }
  const alreadyFenced = (x, z) => {
    for (let dx = -12; dx <= 12; dx += 12) for (let dz = -12; dz <= 12; dz += 12)
      for (const ring of drawnGrid.get(cell(x + dx, z + dz)) || [])
        for (let i = 0; i + 1 < ring.length; i += 1) if (distanceToSegmentSquared(x, z, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]) < 2.5 * 2.5) return true;
    return false;
  };
  const streetOff = (x, z) => { const seg = nearestCarriagewaySegment(x, z); return seg ? Math.sqrt(distanceToSegmentSquared(x, z, seg[0], seg[1], seg[2], seg[3])) : Infinity; };
  // On a property's own line: no fence where a building stands on it, or a roadway crosses it.
  const lineBlocked = (x, z, ux, uz) => insideCarriageway(x, z, 0.15) || buildingAt(x, z) || buildingAt(x - uz * 0.9, z + ux * 0.9) || buildingAt(x + uz * 0.9, z - ux * 0.9) || alreadyFenced(x, z);
  // A recorded fence is where it was recorded: only off the roadway and out of the buildings.
  const recordedBlocked = (x, z) => insideCarriageway(x, z, 0.15) || buildingAt(x, z) || alreadyFenced(x, z);
  // How good a spot is for a way in: beside a footway or a park path, facing a street, with open
  // ground both sides -- never straight into a wall or out into the roadway.
  const gateScore = (x, z, ux, uz) => {
    const nx = -uz, nz = ux;
    let v = 0, walls = 0;
    for (const side of [1, -1]) {
      if (buildingAt(x + nx * side * 2, z + nz * side * 2)) walls += 1;
      if (insideCarriageway(x + nx * side * 1.2, z + nz * side * 1.2, 0)) return -Infinity;
      for (const reach of [1.5, 3]) {
        const px = x + nx * side * reach, pz = z + nz * side * reach;
        if (parkPavementAt(px, pz)) { v += 3; break; }
        if (pavementSurfaceAt(px, pz) !== null) { v += 2; break; }
      }
    }
    if (walls === 2) return -Infinity;
    const off = streetOff(x, z);
    if (off < 16) v += 3 - off / 8;
    return v - walls * 2;
  };
  const sinks = new Map(), frames = [];
  const sinkOf = (style) => { if (!sinks.has(style)) sinks.set(style, { positions: [], uvs: [], indices: [], posts: [] }); return sinks.get(style); };
  const toPage = (p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; };
  // Every property's runs and ways in first, and every way in noted (noteFenceGate) before any
  // panel is laid: a neighbour's fence along a shared line keeps this one's gate open.
  const cut = [];
  let k = 0;
  for (const prop of data.properties) {
    if (((k += 1) & 7) === 0) await new Promise((r) => setTimeout(r));
    const ring = prop.ring.map(toPage);
    if (!ring.some(([x, z]) => insideBBoxPage(x, z))) continue;
    // What carries fence: the line itself where the property is fenced, and the recorded lines.
    const sets = [];
    if (prop.verdict === "fenced") sets.push({ style: prop.fence.style, h: prop.fence.height_m, runs: api.fenceRuns([ring], { blocked: lineBlocked }) });
    for (const run of prop.runs || []) sets.push({ style: run.style, h: run.height_m, runs: api.fenceRuns([run.p.map(toPage)], { blocked: recordedBlocked }) });
    const runs = sets.flatMap((g) => g.runs.map((run) => ({ ...run, style: g.style, h: g.h })));
    if (!runs.length) continue;
    // (A recorded way in is at least GATE_MIN_W_M across: a half-metre gate was drawn, and no
    // walker fits through one.)
    const known = (prop.gates || []).map((g) => { const [x, z] = toPage(g.p); return { x, z, w: g.width_m ? Math.max(GATE_MIN_W_M, g.width_m) : g.width_m, src: g.src }; });
    const gates = api.placeGates(runs, { known, score: gateScore, drive: prop.kind === "parking", rules: { max_between_m: data.rules.gate_max_between_m, min_apart_m: data.rules.gate_min_apart_m } });
    stats.properties += 1; stats.by_kind[prop.kind] = (stats.by_kind[prop.kind] || 0) + 1;
    runs.forEach((run, i) => {
      const { panels, openings } = api.cutGates(run, gates.filter((g) => g.run === i));
      for (const o of openings) noteFenceGate(o.a[0], o.a[1], o.b[0], o.b[1]);
      cut.push({ run, panels, openings });
    });
  }
  for (const { run, panels, openings } of cut) {
    if (((k += 1) & 15) === 0) await new Promise((r) => setTimeout(r));
    const sink = sinkOf(run.style), tile = run.style === "chain_link" ? 0.6 : run.style === "board" || run.style === "wall" || run.style === "hedge" ? 1.5 : 1;
    for (const panel of panels) for (let j = 0; j + 1 < panel.length; j += 1) {
      const [sx, sz] = panel[j], [ex, ez] = panel[j + 1];
      if (Math.hypot(ex - sx, ez - sz) < 0.2) continue;
      // Only what no other fence or wall already carries (layFence), with its posts.
      for (const [ax, az, bx, bz] of layFence(sink, sx, sz, ex, ez, YARD_Y, run.h, tile, run.style === "chain_link" ? 0.4 : run.h)) {
        const span = Math.hypot(bx - ax, bz - az);
        stats.fence_m += span;
        for (let d = 0; d < span; d += 2.8) sink.posts.push([ax + (bx - ax) * d / span, az + (bz - az) * d / span, run.h + 0.08]);
        sink.posts.push([bx, bz, run.h + 0.08]);
        // Chain link hangs from a top rail and is laced to a wire along the foot.
        if (run.style === "chain_link") (sink.rails ||= []).push([ax, az, bx, bz, run.h, 0.042], [ax, az, bx, bz, 0.06, 0.012]);
      }
    }
    for (const o of openings) {
      frames.push({ ...o, h: run.h, drive: o.w > 3 });
      stats.gates += 1; if (o.basis === "recorded") stats.gates_recorded += 1; else stats.gates_inferred += 1;
    }
  }
  const barMap = playFenceTexture();
  const materialOf = (style) => style === "chain_link" ? chainlinkMaterial()
    : style === "board" ? fenceMaterial(FENCE_STYLE.board) : style === "wall" ? fenceMaterial(FENCE_STYLE.wall)
    : style === "hedge" ? new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: 1, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ map: barMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: style === "split_rail" ? 0 : 0.45, color: PROPERTY_FENCE_STYLE[style]?.post ?? 0x22272a });
  const dummy = new THREE.Object3D();
  for (const [style, sink] of sinks) {
    if (!sink.indices.length) continue;
    const look = PROPERTY_FENCE_STYLE[style] || PROPERTY_FENCE_STYLE.chain_link;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
    geom.setIndex(sink.indices);
    geom.computeVertexNormals();
    const mesh = addGround(new THREE.Mesh(geom, materialOf(style)), look.surface + "|property");
    mesh.userData.liftedOntoGround = true; mesh.userData.elevationBasis = "terrain_sampled_0.75m"; mesh.userData.basis = "property_fences";
    if (look.post !== null && sink.posts.length) {
      const posts = new THREE.InstancedMesh(parkGeometry("cyl"), new THREE.MeshStandardMaterial({ color: look.post, roughness: 0.5, metalness: style === "chain_link" ? 0.1 : 0.5 }), sink.posts.length);
      sink.posts.forEach(([x, z, h], i) => { dummy.position.set(x, groundLiftAt(x, z) + YARD_Y + h / 2, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(0.06, h, 0.06); dummy.updateMatrix(); posts.setMatrixAt(i, dummy.matrix); });
      posts.instanceMatrix.needsUpdate = true;
      posts.userData = { surface: look.surface + "_post|property", liftedOntoGround: true };
      groups.ground.add(posts);
    }
    if (sink.rails?.length) {
      const rails = new THREE.InstancedMesh(parkGeometry("cyl"), new THREE.MeshStandardMaterial({ color: look.post ?? 0x1c1f21, roughness: 0.5, metalness: 0.1 }), sink.rails.length);
      const up = new THREE.Vector3(0, 1, 0), along = new THREE.Vector3();
      sink.rails.forEach(([ax, az, bx, bz, h, d], i) => {
        const ya = groundLiftAt(ax, az) + YARD_Y + h, yb = groundLiftAt(bx, bz) + YARD_Y + h;
        along.set(bx - ax, yb - ya, bz - az); const len = along.length() || 1;
        dummy.position.set((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2); dummy.quaternion.setFromUnitVectors(up, along.divideScalar(len)); dummy.scale.set(d, len, d); dummy.updateMatrix(); rails.setMatrixAt(i, dummy.matrix);
      });
      dummy.rotation.set(0, 0, 0);
      rails.instanceMatrix.needsUpdate = true;
      rails.userData = { surface: look.surface + "_rail|property", liftedOntoGround: true };
      groups.ground.add(rails);
    }
  }
  // The ways in: a clear opening, a dark post each side and (a walk gate) a dark bar over it, so
  // it reads as a doorway in the fence from down the street. The bar stands GATE_BAR_CLEAR_M
  // over the ground: at 2.1 m it was under a walker's head clearance (the object catalogue's
  // 2.0 m over the feet) for anyone coming off a raised walk, and the open gate was a wall from
  // that side -- a hole in the fence you could see through and not walk through (2026-11-22).
  if (frames.length) {
    const parts = [];
    for (const f of frames) {
      const top = f.drive ? f.h + 0.25 : Math.max(GATE_BAR_CLEAR_M + 0.14, f.h + 0.3), ux = (f.b[0] - f.a[0]) / (f.w || 1), uz = (f.b[1] - f.a[1]) / (f.w || 1), yaw = Math.atan2(-uz, ux);
      const ya = groundLiftAt(f.a[0], f.a[1]) + YARD_Y, yb = groundLiftAt(f.b[0], f.b[1]) + YARD_Y;
      parts.push([f.a[0], ya + top / 2, f.a[1], 0.14, top, 0.14, yaw], [f.b[0], yb + top / 2, f.b[1], 0.14, top, 0.14, yaw]);
      if (!f.drive) parts.push([(f.a[0] + f.b[0]) / 2, Math.max(ya, yb) + top - 0.07, (f.a[1] + f.b[1]) / 2, f.w + 0.14, 0.14, 0.14, yaw]);
    }
    const frame = new THREE.InstancedMesh(parkGeometry("box"), new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.6, metalness: 0.3 }), parts.length);
    parts.forEach(([x, y, z, sx, sy, sz, yaw], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix(); frame.setMatrixAt(i, dummy.matrix); });
    frame.instanceMatrix.needsUpdate = true;
    frame.userData = { surface: "fence:gate_frame|property", gates: frames.length, liftedOntoGround: true };
    groups.ground.add(frame);
  }
  stats.fence_m = Math.round(stats.fence_m);
  stats.decided_open = data.decided_open.length;
  return stats;
}

// Inventory-only structures are separate visual evidence, not appended to DATA.ways.
for (const feature of PARK_STRUCTURES) {
  const mesh=parkFacilityMesh(feature);if(mesh)groups.mapped3d.add(mesh);
}

const treePlotCorners = new Map();
//: A trunk stands this clear of the roadway's edge at least (m); the opening cut for a tree in
//: paving that is not a footway (the city's 4 ft minimum), and how far over the ground it is laid.
const TREE_ROAD_CLEAR_M = 0.3, TREE_HARD_OPENING_M = 1.22, TREE_HARD_OPENING_Y = 0.045;
//: Public Works / Better Streets: how far a tree's opening stands from what the survey records
//: near it (tools/build_sf_tree_survey.py CLEARANCE_M) -- 25 ft from a stop sign, 5 ft from a
//: hydrant, 3 ft from a parking sign or a meter.
const TREE_OBSTACLE_CLEARANCE_M = { stop: 7.62, hydrant: 1.524, meter: 0.9144, sign: 0.9144 };
//: How many openings were put on the walk's squares, and how many were left where the survey has them.
const treeSquareStats = { squared: 0, unsquared: 0, slid: 0, asSurveyed: 0, squareOpening: 0, onGrass: 0, merged: 0, mergedFrom: 0, hardOpening: 0, kerbEdge: 0, offFence: 0, onFence: 0, poleMoved: 0, poleDropped: 0 };
const sfSurvey = (async () => {
  const b = DATA.bbox;
  if (!b) return null;
  const box = BUILD_WINDOW?.box || [b.west,b.south,b.east,b.north];
  if (box[0] > -122.34 || box[2] < -122.53 || box[1] > 37.84 || box[3] < 37.70) return null;
  const api = await import(sharedAsset("sf-tree-placement.mjs"));
  const trees = await api.surveyedTrees(box, async path => {
    const response = await fetch(sharedAsset("sf-tree-survey/"+path));
    if (!response.ok) throw Error("Tree survey HTTP "+response.status);
    return response.json();
  });
  return {trees, api};
})().catch(e => { console.warn("Tree survey unavailable",e); return null; });
const groundReady = (async () => {
  let ground;
  try {
    ground = windowLists(await fetchWindowed(GROUND_URL, () => fetch(GROUND_URL, { cache: "no-cache" }).then((r) => r.json())));
    ground = applyCourtLayout(ground,PARK_EVIDENCE,HEADSET);
    const publicWalks=(MUNICIPAL_CONTEXT?.sidewalks || []).filter(r=>!BUILD_WINDOW || BUILD_WINDOW.near(r));
    ground.front_walks=[...(ground.front_walks || []),...publicWalks];
    municipalUsage.sidewalks=publicWalks.length;
    // The lattice asks how much is drawn on a cell before it decides how finely to cut it.
    GROUND = ground;
    latticeCover = null;
    latticeField.clear();
  } catch (err) {
    window.kerbsideReady = Object.assign(window.kerbsideReady || {}, { ground: true });
    return false;
  }

  // Height matters more than it looks. There is a base plane at y=0 spanning the whole bbox in
  // near-black (0x0c171b) -- it is what the unmapped ground reads as. Parks and yards were being
  // laid at y=-0.06 and y=-0.07, underneath it, so every one of them was built, merged, added to
  // the scene and then covered over by the very plane it was there to replace. That is what
  // Moscone and Fort Mason were: not missing polygons, buried ones. They belong between the base
  // plane and the top of the roadway (0.06), so they cover the black without climbing the kerb.
  const excludeGrassAt = hardGroundExclusion(ground);
  const excludeParkAt = (x, z) => excludeGrassAt(x, z) || parkPavementAt(x, z);
  const classifiedGround = ground.lawns || ground.backyards || ground.front_walks || ground.service_yards;
  // Ground no record describes, given the surface around it (tools/infer_ground_gaps.py): a
  // sliver behind a row of houses, the strip between a kerb and a frontage the parcels stop
  // short of. Drawn below everything, so no mask is needed to keep it off a footway: the
  // footway is drawn over it.
  const inferred = ground.inferred || [];
  // What the aerial photographs say each of these is (docs/imagery-truth.json, module 21): a
  // ring they could see -- with the roofs and the shade left out, and a second photograph of
  // another year agreeing, or its neighbours of the same kind all being one thing -- is drawn
  // as what it is: a school's yard in asphalt, not the footway's concrete; a planted lot in
  // grass. One they could not call is drawn as it was inferred.
  await loadImageryTruth();
  const coverSeen = IMAGERY_TRUTH?.ground || null;
  const seenAs = (list, item) => coverSeen?.[list]?.[item.id ?? `${item.p[0][0]},${item.p[0][1]}`] || null;
  const inferredOf = (k) => inferred.filter((item) => (seenAs("inferred", item) || item.k) === k);
  const seenGrass = [], seenAsphalt = [];
  const grassRings = classifiedGround
    ? [...(ground.lawns || []), ...(ground.backyards || [])]
    : (ground.yards || []);
  const grassMask = await grassHardMask(excludeGrassAt,
    [...(ground.parks || []), ...grassRings].map((item) => item.p));
  if(grassLibrary){
    const grid=new Map();
    const walls=new Map();
    for(const way of DATA.ways||[])if(way.kind==="wall"){
      const points=(way.points||[]).map(p=>{const [x,y]=xy(...p);return [x,-y];});
      for(let i=1;i<points.length;i++){const [a,b]=[points[i-1],points[i]];
        for(let z=Math.floor((Math.min(a[1],b[1])-.5)/16);z<=Math.floor((Math.max(a[1],b[1])+.5)/16);z++)
          for(let x=Math.floor((Math.min(a[0],b[0])-.5)/16);x<=Math.floor((Math.max(a[0],b[0])+.5)/16);x++){
            const key=`${x}:${z}`;if(!walls.has(key))walls.set(key,[]);walls.get(key).push([a,b]);
          }
      }
    }
    for(const [items,park] of [[ground.parks||[],true],[grassRings,false]])for(const item of items){
      const ring=clipRingToBox(item.p);if(!ring)continue;
      const local=ring.map(p=>{const [x,y]=xy(...p);return [x,-y];});
      const xs=local.map(p=>p[0]),zs=local.map(p=>p[1]);
      for(let z=Math.floor(Math.min(...zs)/16);z<=Math.floor(Math.max(...zs)/16);z++)
        for(let x=Math.floor(Math.min(...xs)/16);x<=Math.floor(Math.max(...xs)/16);x++){
          const key=`${x}:${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push({local,park});
        }
    }
    grassSampleAt=(x,z)=>{
        if(excludeGrassAt(x,z)||insideCarriageway(x,z,.15)||parkPavementAt(x,z)||buildingAt(x,z)||mappedWaterAt(x,z))return null;
        const mask=grassMask.texture.image;
        const mx=Math.floor((x-grassMask.west)/(grassMask.east-grassMask.west)*mask.width);
        const my=Math.floor((-z-grassMask.south)/(grassMask.north-grassMask.south)*mask.height);
        if(mx<0||my<0||mx>=mask.width||my>=mask.height||mask.data[my*mask.width+mx]<255)return null;
        if((walls.get(`${Math.floor(x/16)}:${Math.floor(z/16)}`)||[])
          .some(([a,b])=>distanceToSegmentSquared(x,z,...a,...b)<.5**2))return null;
        const row=(grid.get(`${Math.floor(x/16)}:${Math.floor(z/16)}`)||[]).find(r=>pointInRing(x,z,r.local));
        if(!row)return null;
        const y=grassSurfaceAt?.(x,z);return y===null||y===undefined?null:{y:y+.002,park:row.park};
      };
    if(!HEADSET)grassStrands=grassLibrary.createGrassStrands(THREE,{parent:groups.ground,motion:foliageMotion,
      onMesh:mesh=>{if(BUILD_WINDOW)applyBoxClip(mesh,detailClipBox);},sample:grassSampleAt});
  }
  const parkVariants = GRASS_VARIANTS;
  for (let variant = 0; variant < parkVariants; variant += 1) {
    const rings = (ground.parks || [])
      .filter((p) => grassVariantForRing(p.p, parkVariants) === variant)
      .map((p) => p.p);
    const parkGeom = ringGeometry(rings, PARK_Y, true, excludeParkAt);
    if (parkGeom) {
      addGround(new THREE.Mesh(parkGeom,
        maskedGrassMaterial(grassTexture("park", variant), grassMask, 0.97, true)), "park");
    }
  }

  const yardVariants = GRASS_VARIANTS;
  for (let variant = 0; variant < yardVariants; variant += 1) {
    const rings = grassRings
      .filter((y) => grassVariantForRing(y.p, yardVariants) === variant)
      .map((y) => y.p);
    const yardGeom = ringGeometry(rings, YARD_Y, true, excludeGrassAt);
    if (yardGeom) {
      addGround(new THREE.Mesh(yardGeom,
        maskedGrassMaterial(grassTexture("yard", variant), grassMask, 0.98)), "yard");
    }
  }

  const frontWalkGeom = ringGeometry((ground.front_walks || []).map((y) => y.p), FRONT_WALK_Y, true, null, true);
  if (frontWalkGeom) {
    addGround(new THREE.Mesh(frontWalkGeom, new THREE.MeshStandardMaterial({
      map: SIDEWALK, color: 0xffffff, roughness: 0.96, metalness: 0.0,
      side: THREE.DoubleSide,
    })), "front_walk");
  }

  // The ground left on a commercial, office, downtown or public lot: a forecourt, a service
  // yard, a plaza -- paved, in the same concrete as the footways, so that downtown is not a
  // meadow between the towers (scripts/build_ground_cover.py decides which lots).
  for (const y of ground.plazas || []) { const k = seenAs("plazas", y); if (k === "grass") seenGrass.push(y.p); else if (k === "asphalt") seenAsphalt.push(y.p); }
  const plazaGeom = ringGeometry((ground.plazas || []).filter((y) => !["grass", "asphalt"].includes(seenAs("plazas", y))).map((y) => y.p), PLAZA_Y, true, null, true);
  if (plazaGeom) {
    const plazaMesh = new THREE.Mesh(plazaGeom, new THREE.MeshStandardMaterial({
      map: SIDEWALK, color: 0xc4c1b8, roughness: 0.96, metalness: 0.0,
      side: THREE.DoubleSide, depthTest: false,
    }));
    // The coarse backdrop can bridge above the finer measured ground in steep 4 m cells.
    // Draw the mapped plaza over that *visual backdrop* without moving its ground geometry;
    // later roads and buildings still use the normal depth test and stand above the plaza.
    plazaMesh.renderOrder = -1;
    addGround(plazaMesh, "plaza");
  }

  const serviceAs = (y) => seenAs("service_yards", y) || (y.basis === "unbuilt_nonpark_parcel" ? "paving" : "asphalt");
  const neutralService = (ground.service_yards || []).filter((y) => serviceAs(y) === "paving");
  const serviceRings = (ground.service_yards || []).filter((y) => serviceAs(y) === "asphalt");
  for (const y of ground.service_yards || []) if (serviceAs(y) === "grass") seenGrass.push(y.p);
  const neutralServiceGeom = ringGeometry(neutralService.map((y) => y.p), SERVICE_YARD_Y, true, null, true);
  if (neutralServiceGeom) {
    // An unbuilt parcel is not evidence of lawn. Keep it as a restrained hardscape
    // fallback until city land-use or imagery resolves it.
    // A fallback is the last thing that should show: drawn first after the terrain, without
    // a depth test, and under the fills inferred from imagery, so every mapped surface on the
    // parcel paints over it. It used to be depth-tested at its own few millimetres over the
    // ground, above a car park's (PARKING_Y) asphalt, and the two follow the hill on different
    // tessellations: the parcel's grey paving won here and lost there, and the Oxford Tract car
    // park at Walnut and Delaware was a grey slab with blotches of its own asphalt and stalls
    // breaking through. The parcel is the whole lot, so the slab was the lot's size.
    const neutralMesh = addGround(new THREE.Mesh(neutralServiceGeom, new THREE.MeshStandardMaterial({
      map: SIDEWALK, color: 0xa6a39a, roughness: 0.98, metalness: 0.0, side: THREE.DoubleSide,
      depthTest: false,
    })), "neutral_ground");
    neutralMesh.renderOrder = -1.6;
  }
  const serviceGeom = ringGeometry(serviceRings.map((y) => y.p), SERVICE_YARD_Y);
  if (serviceGeom) {
    addGround(new THREE.Mesh(serviceGeom, new THREE.MeshStandardMaterial({
      color: 0x3d403d, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
    })), "service_yard");
  }

  // The lots the photographs show are planted, or are asphalt (a school's yard): as the fills are.
  for (const [rings, material, surface] of [
    [seenGrass, { map: grassTexture("yard", 0), color: 0xffffff, roughness: 0.98 }, "inferred:grass"],
    [seenAsphalt, { map: ROAD, color: 0xffffff, roughness: 0.92 }, "inferred:asphalt"],
  ]) {
    const geom = rings.length ? ringGeometry(rings, PLAZA_Y, false) : null;
    if (!geom) continue;
    const mesh = addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ ...material, metalness: 0.0, side: THREE.DoubleSide, depthTest: false })), surface);
    mesh.renderOrder = -1;
    mesh.userData.basis = "aerial_photograph";
  }
  for (const [k, material] of [
    ["grass", { map: grassTexture("yard", 0), color: 0xffffff, roughness: 0.98 }],
    ["paving", { map: SIDEWALK, color: 0xd2cfc6, roughness: 0.96 }],
    ["asphalt", { map: ROAD, color: 0xffffff, roughness: 0.92 }],
    ["service", { map: SIDEWALK, color: 0xa6a39a, roughness: 0.98 }],
  ]) {
    // Not clipped to the carriageway: it lies under the road surface, and the strip the clip
    // would cut away at a road's edge is exactly the bare ground it is there to cover. Drawn
    // as the yards and plazas are, straight after the terrain and without a depth test: the
    // terrain is a coarse backdrop that bridges above the finer ground in places, and depth
    // tested against it whole patches of the fill vanished -- a fifth of a square kilometre in
    // Oakland. Before the yards and plazas, so a mapped surface always paints over a fill.
    const geom = ringGeometry(inferredOf(k).map((item) => item.p), INFERRED_Y, false, null, k === "paving" || k === "service");
    if (geom) {
      const mesh = addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        ...material, metalness: 0.0, side: THREE.DoubleSide, depthTest: false })), `inferred:${k}`);
      mesh.renderOrder = -1.5;
    }
  }

  // The setbacks behind the footways: paved on to the house fronts where nothing else is laid.
  // A lawn counts where it is seen: its ring, less the hard ground carved out of it, and less
  // the underlay, which is drawn over a yard (a Mallorca Way front yard was concrete to the eye
  // and a lawn to the ring test, and was left with the ledge).
  const lawnRing = ringCover(grassRings.map((item) => item.p));
  const parkRing = ringCover((ground.parks || []).map((item) => item.p));
  const plantedRing = ringCover(inferredOf("grass").map((item) => item.p).concat(seenGrass));
  const lawnDrawnAt = (x, z) => !parkPavementAt(x, z) && ((lawnRing(x, z) && !excludeGrassAt(x, z))
    || (parkRing(x, z) && !excludeParkAt(x, z)) || plantedRing(x, z));
  for (const mesh of addFrontageSetbacks(lawnDrawnAt)) addGround(mesh, "walk");
  window.kerbsideFrontageSetbacks = frontageSetbackStats;
  // The fences, one layer to a boundary (layFence): the park areas' ways in noted first, then the
  // property lines -- schools, yards, the parks' surveyed ones, the closed car parks -- with their
  // ways in, then the ground's mapped and inferred fences where neither already stands. The courts
  // and the park areas' own fences come later, and carry on from whatever is there.
  window.kerbsideFenceGates = noteParkAreaGates(PARK_EVIDENCE?.areas || []);
  window.kerbsidePropertyFences = await buildPropertyFences().catch((error) => { console.warn("kerbside: property fences", error); return null; });
  await runStepsSliced(buildFencesSteps(ground));

  // ---- tree pits ----
  //
  // A street tree in San Francisco stands in a square cut out of the pavement, and the pavement
  // is what makes it a pit: the same tree on a lawn is just a tree, and a brown square under it
  // would be a hole in the grass. So this asks where the footways actually ended up rather than
  // where they were meant to be, and cuts a pit only where one of them is underfoot.
  //
  // The city's own standard is a four foot by four foot minimum opening and six by six on a
  // wider sidewalk, which is what the size below is; the bigger the trunk the bigger the pit,
  // because a tree that outgrows its opening gets the opening enlarged.
  const pits = { positions: [], uvs: [], indices: [] };
  let pitCount = 0;
  // No tree between a kerb cut and the garage it serves: it would stand in the car's way.
  // A tree the city puts well inside a carriageway stands on an island it has not mapped --
  // a planted median, a refuge -- and is drawn as one (addTreeIslands); one in a junction's box
  // is a corner tree recorded in the wrong place, and is left out rather than drawn in the road.
  const islandTrees = [];
  const survey = await sfSurvey;
  if (survey) {
    // The survey is the city's: it stands in for the inventory's trees inside San Francisco
    // (south of 37.708 is Daly City, whose own trees stay); the lidar's canopy trees (yards,
    // parks) stay where no surveyed tree is within 4 m of them.
    const retained = (ground.trees || []).filter(t=>t.src?.startsWith("lidar_canopy") || t.p[1] < 37.7081);
    const occupied = new Map();
    const key=(x,z)=>Math.floor(x/4)+":"+Math.floor(z/4);
    for (const t of survey.trees) {
      const [x,y]=xy(...t.p), k=key(x,-y);
      if (!occupied.has(k)) occupied.set(k,[]);
      occupied.get(k).push([x,-y]);
    }
    ground.trees = [...survey.trees.filter(t=>!BUILD_WINDOW || BUILD_WINDOW.inside(...t.p)), ...retained.filter(t=>{
      const [x,y]=xy(...t.p);
      for(let dx=-4;dx<=4;dx+=4) for(let dz=-4;dz<=4;dz+=4)
        if(occupied.get(key(x+dx,-y+dz))?.some(([a,b])=>Math.hypot(x-a,-y-b)<=4)) return false;
      return true;
    })];
  }
  const notThere = stackedTreesToDrop(ground.trees || [], (tree) => {
    const [tx, ty] = xy(tree.p[0], tree.p[1]);
    const seg = nearestCarriagewaySegment(tx, -ty);
    return seg ? Math.sqrt(distanceToSegmentSquared(tx, -ty, seg[0], seg[1], seg[2], seg[3])) : Infinity;
  });
  treeIslandStats.address_points = notThere.size;
  // One tree recorded more than once a little apart (re-surveyed, or in two sources) is one tree,
  // at the average of its records (sf-tree-placement.mjs mergeClumps).
  if ((ground.trees || []).length > 1) {
    const clumps = await import(sharedAsset("sf-tree-placement.mjs"));
    const before = ground.trees.length - notThere.size;
    ground.trees = clumps.mergeClumps(ground.trees.filter((t) => !notThere.has(t)));
    treeSquareStats.merged = ground.trees.filter((t) => t.merged).length;
    treeSquareStats.mergedFrom = before - ground.trees.length + treeSquareStats.merged;
  }
  const trunkGrid = new Map(), trunkCell=(x,z)=>Math.floor(x/5)+":"+Math.floor(z/5);
  for (const t of ground.trees || []) {
    if (notThere.has(t)) continue;
    const [x,y]=xy(...t.p), key=trunkCell(x,-y);
    if (!trunkGrid.has(key)) trunkGrid.set(key,[]);
    trunkGrid.get(key).push(t);
  }
  function treeCrowding(x,z,tree) {
    for(let dx=-5;dx<=5;dx+=5) for(let dz=-5;dz<=5;dz+=5)
      for(const t of trunkGrid.get(trunkCell(x+dx,z+dz)) || []) {
        const [a,b]=xy(...t.p);
        if(t!==tree && Math.hypot(x-a,z+b)<4.572) return true;
      }
    return false;
  }
  function treeCrossingNear(x,z) {
    const cx=Math.floor(x/CROSSING_DEDUPE_CELL_M), cz=Math.floor(z/CROSSING_DEDUPE_CELL_M);
    for(let dx=-5;dx<=5;dx++) for(let dz=-5;dz<=5;dz++)
      for(const p of crossingDrawGrid.get(`${cx+dx}:${cz+dz}`) || []) {
        const a=x-p.x,b=z-p.z,c=Math.cos(p.bearing),s=Math.sin(p.bearing);
        if(Math.abs(a*c+b*s)<p.length/2+3.048 && Math.abs(b*c-a*s)<(p.width || 3.7)/2+3.048) return true;
      }
    return false;
  }
  // The openings are cut on the walk's squares, so the walks are waited for (module 19 lays
  // them; not for ever: a minute, then the openings stand where the survey puts them).
  let walkSquares = null;
  if (survey && (ground.trees || []).some(t=>t.curb)) {
    const laid = await Promise.race([streetSurfacesLaid.then(()=>true), new Promise(r=>setTimeout(()=>r(false),60000))]);
    if (laid) try { walkSquares = walkSquareIndex((ground.trees || []).filter(t=>t.curb).map(t=>{const [a,b]=xy(...t.curb);return [a,-b];})); }
      catch (error) { console.warn("kerbside: the walk's squares could not be read; openings stand as surveyed", error); }
  }
  const walkable = (x,z)=>pavementSurfaceAt(x,z)!==null && !insideCarriageway(x,z,0)
    && !insideBikeLane(x,z,.15) && !buildingAt(x,z) && !inDriveway(x,z);
  // Every pole a tree could be standing against: the city's lights, signs, meters and signals,
  // where the furniture layer will stand them (furnitureAnchor). A tree and a pole were drawn in
  // one spot -- the survey's tree and the city's light a hand apart, or carried together by the
  // kerb each is set back from. The record is waited for a little; without it the trees stand as
  // they did.
  const poleGrid = new Map(), poleCell = (x, z) => Math.floor(x / 2) + ":" + Math.floor(z / 2);
  if ((ground.trees || []).length) {
    const record = await Promise.race([streetFurnitureOnce().catch(() => null), new Promise((r) => setTimeout(() => r(null), 20000))]);
    const official = record?.geometry_based || {};
    for (const list of [official.street_lights, official.street_signs, official.parking_meters, official.traffic_signals, official.small_cells]) {
      for (const item of list || []) {
        if (!item?.p) continue;
        const [rx, ry] = xy(item.p[0], item.p[1]);
        // (Only those with a tree anywhere near are worked out in full.)
        let near = false;
        for (let dx = -5; dx <= 5 && !near; dx += 5) for (let dz = -5; dz <= 5 && !near; dz += 5) near = trunkGrid.has(trunkCell(rx + dx, -ry + dz));
        if (!near) continue;
        let a = null;
        try { a = furnitureAnchor(item); } catch (error) { a = null; }
        const px = a ? a.x : rx, pz = a ? a.z : -ry, key = poleCell(px, pz);
        if (!poleGrid.has(key)) poleGrid.set(key, []);
        poleGrid.get(key).push([px, pz]);
      }
    }
  }
  const poleNear = (x, z, clear = TREE_POLE_CLEAR_M) => {
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1)
      for (const q of poleGrid.get((cx + dx) + ":" + (cz + dz)) || []) if (Math.hypot(q[0] - x, q[1] - z) < clear) return q;
    return null;
  };
  //: Where a tree with no opening of its own stands clear of the pole beside it: stepped straight
  //: away from it, a little further each try, onto ground a tree can stand on. Null: nowhere.
  const stepOffPole = (x, z, clear, okAt) => {
    const q = poleNear(x, z, clear);
    if (!q) return [x, z];
    let ux = x - q[0], uz = z - q[1]; const d = Math.hypot(ux, uz);
    if (d < 0.02) { ux = 1; uz = 0; } else { ux /= d; uz /= d; }
    for (const [vx, vz] of [[ux, uz], [-uz, ux], [uz, -ux]]) for (const reach of [clear + 0.08, clear + 0.4, clear + 0.8]) {
      const nx = q[0] + vx * reach, nz = q[1] + vz * reach;
      if (okAt(nx, nz) && !poleNear(nx, nz, clear)) return [nx, nz];
    }
    return null;
  };
  const trees = (ground.trees || []).filter((tree) => {
    if (notThere.has(tree)) return false;
    let [tx, ty] = xy(tree.p[0], tree.p[1]);
    if (overWaterAt(tx, -ty)) return false;
    let tz=-ty;
    if (tree.curb && survey) {
      const [cx,cy]=xy(...tree.curb);
      const seg=nearestCarriagewaySegment(cx,-cy);
      if (seg) {
        const dx=seg[2]-seg[0], dz=seg[3]-seg[1];
        const u=Math.max(0,Math.min(1,((cx-seg[0])*dx+(-cy-seg[1])*dz)/(dx*dx+dz*dz || 1)));
        const out=[cx-seg[0]-u*dx,-cy-seg[1]-u*dz];
        let plot=survey.api.sidewalkPlot(tree,[cx,-cy,tree.curb[2]],out,walkable);
        if (plot && walkSquares) {
          // Slid and stretched onto the walk's own squares, where it is still all walk there.
          const squared = walkSquarePlot(walkSquares, plot);
          if (squared !== plot && squared.corners.every(([x,z])=>walkable(x,z))) { plot = squared; treeSquareStats.squared += 1; }
          else treeSquareStats.unsquared += 1;
        }
        if (plot) {
          // The Public Works distances, asked of an opening.
          const breaksRule = (p) => {
            const [x,z]=p.center;
            const junction=junctionSquares.some(q=>Math.hypot(q.kx-x,q.kz-z)<q.reach+7.62);
            const driveway=DRIVEWAY_ZONES.some(d=>x>=d.minX-1.524 && x<=d.maxX+1.524 && z>=d.minZ-1.524 && z<=d.maxZ+1.524
              && (pointInRing(x,z,d.ring) || d.ring.some((a,i)=>{const b=d.ring[(i+1)%d.ring.length];return distanceToSegmentSquared(x,z,...a,...b)<1.524**2;})));
            const obstructed=tree.obstacles?.some(([lon,lat,kind])=>{
              const [a,b]=xy(lon,lat); return Math.hypot(a-x,b+z)<(TREE_OBSTACLE_CLEARANCE_M[kind] ?? .9144);
            }) || treeFireEscapes.some(([a,b])=>distanceToSegmentSquared(x,z,...a,...b)<3.048**2);
            return obstructed || junction || driveway || treeCrowding(x,z,tree) || treeCrossingNear(x,z) || Boolean(poleNear(x,z));
          };
          // Where no tree could ever stand: in the junction's box, in the water, across a drive.
          const impossible = ([x,z]) => insideJunctionBox(x,z) || overWaterAt(x,z) || inDriveway(x,z);
          // The opening slid along the walk a whole square or two, to where the distances hold;
          // the tree goes with it (the survey's own fix is a metre or two either way).
          const [c0,c1]=plot.corners, run=Math.hypot(c1[0]-c0[0],c1[1]-c0[1]) || 1;
          const ax=(c1[0]-c0[0])/run, az=(c1[1]-c0[1])/run;
          const slid = (d) => d === 0 ? plot : { ...plot, center:[plot.center[0]+ax*d,plot.center[1]+az*d],
            corners:plot.corners.map(([px,pz])=>[px+ax*d,pz+az*d]) };
          let placed = null;
          if (!impossible(plot.center)) {
            // (A tree that is the average of several records has no exact spot: looked for further.)
            for (const d of tree.merged ? [0, SLAB_M, -SLAB_M, 2*SLAB_M, -2*SLAB_M, 3*SLAB_M, -3*SLAB_M, 4*SLAB_M, -4*SLAB_M] : [0, SLAB_M, -SLAB_M, 2*SLAB_M, -2*SLAB_M]) {
              const p = slid(d);
              if (d && !p.corners.every(([px,pz])=>walkable(px,pz))) continue;
              if (!impossible(p.center) && !breaksRule(p)) { placed = p; if (d) treeSquareStats.slid += 1; break; }
            }
            // A surveyed tree is there whatever the rules say: where no slide clears them, its
            // opening is cut where it stands, a real one, not the tree in bare concrete.
            // (But never with a pole in it: no slide cleared the pole, and the tree is left out.)
            if (!placed && poleNear(plot.center[0], plot.center[1])) { treeSquareStats.poleDropped += 1; return false; }
            if (!placed) { placed = plot; treeSquareStats.asSurveyed += 1; }
          }
          if (placed) {
            const [x,z]=placed.center;
            tree.p=[x/metersPerLon+midLon,-z/metersPerLat+midLat];
            treePlotCorners.set(tree,placed.corners);
            return true;
          }
        }
      }
    }
    // A tree with no kerb-side opening, beside a pole: stepped off it, or left out.
    {
      const paved = pavementSurfaceAt(tx, tz) !== null, clear = paved ? TREE_POLE_CLEAR_M : TREE_POLE_CLEAR_SOFT_M;
      if (poleNear(tx, tz, clear)) {
        const to = stepOffPole(tx, tz, clear, (x, z) => !insideCarriageway(x, z, -TREE_ROAD_CLEAR_M) && !buildingAt(x, z) && !inDriveway(x, z) && !insideBikeLane(x, z, .1)
          && !overWaterAt(x, z) && (pavementSurfaceAt(x, z) !== null) === paved && !nearestFenceLine(x, z, TREE_FENCE_CLEAR_M));
        if (!to) { treeSquareStats.poleDropped += 1; return false; }
        tx = to[0]; tz = to[1]; ty = -tz;
        tree.p = [tx / metersPerLon + midLon, -tz / metersPerLat + midLat];
        treeSquareStats.poleMoved += 1;
      }
    }
    if (buildingAt(tx,tz) || inDriveway(tx,tz) || insideBikeLane(tx,tz,.1)) return false;
    // None in the street: not in a junction's box, and not with its trunk on the roadway's edge.
    if (!insideCarriageway(tx,tz,0)) {
      if (insideJunctionBox(tx,tz)) { treeIslandStats.junction += 1; return false; }
      if (insideCarriageway(tx,tz,-TREE_ROAD_CLEAR_M)) { treeSquareStats.kerbEdge += 1; return false; }
      return true;
    }
    if (!tree.island || insideJunctionBox(tx, tz)) {
      treeIslandStats.junction += 1;
      return false;
    }
    islandTrees.push({ x: tx, z: -ty, tree });
    return true;   // drawn, on its island (and with no pit: the island is planted)
  });
  addTreeIslands(islandTrees);
  // Every tree standing in anything but natural ground has an opening. Off the footways (a
  // plaza, a paved lot, a school's yard, a car park, a playground's surface) it is a four-foot
  // square of soil, square to the nearest street.
  const hardPits = { positions: [], uvs: [], indices: [] };
  const inferredHard = [...inferredOf("paving"), ...inferredOf("asphalt"), ...inferredOf("service")].map((item) => {
    const ring = item.p.map((q) => { const [x, y] = xy(q[0], q[1]); return [x, -y]; });
    return { ring, minX: Math.min(...ring.map((q) => q[0])), maxX: Math.max(...ring.map((q) => q[0])), minZ: Math.min(...ring.map((q) => q[1])), maxZ: Math.max(...ring.map((q) => q[1])) };
  });
  const hardGroundAt = (x, z) => excludeGrassAt(x, z) || insideParkingRegion(x, z)
    || inferredHard.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && pointInRing(x, z, r.ring));
  const hardOpening = (tree, tx, tz) => {
    if (treePlotCorners.has(tree) || islandTrees.some((t) => t.tree === tree) || !hardGroundAt(tx, tz)) return false;
    const seg = nearestCarriagewaySegment(tx, tz), len = seg ? Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) || 1 : 1;
    const c = seg ? (seg[2] - seg[0]) / len : 1, s = seg ? (seg[3] - seg[1]) / len : 0, half = TREE_HARD_OPENING_M / 2;
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([u, v]) => [tx + u * c - v * s, tz + u * s + v * c]);
    if (corners.some(([x, z]) => insideCarriageway(x, z, 0) || buildingAt(x, z))) return false;
    const base = hardPits.positions.length / 3;
    corners.forEach(([x, z], i) => { hardPits.positions.push(x, groundLiftAt(x, z) + TREE_HARD_OPENING_Y, z); hardPits.uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); });
    hardPits.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    treePlotCorners.set(tree, corners);
    treeSquareStats.hardOpening += 1;
    return true;
  };
  // No tree on a fence's line: one there is moved square off it, to the side it stands on (a
  // kerbside tree in its cut-out opening is at the kerb, far from any property's fence, and keeps
  // its opening).
  const treeRoom = (x, z) => !insideCarriageway(x, z, 0) && !buildingAt(x, z) && !overWaterAt(x, z);
  for (const tree of trees) {
    if (treePlotCorners.has(tree) || islandTrees.some((t) => t.tree === tree)) continue;
    const [tx, ty] = xy(tree.p[0], tree.p[1]);
    const moved = treeOffFence(tx, -ty, treeRoom);
    if (!moved) { if (nearestFenceLine(tx, -ty, TREE_FENCE_CLEAR_M)) treeSquareStats.onFence += 1; continue; }
    tree.p = [moved[0] / metersPerLon + midLon, -moved[1] / metersPerLat + midLat];
    treeSquareStats.offFence += 1;
  }
  for (const tree of trees) {
    const [tx, ty] = xy(tree.p[0], tree.p[1]);
    const tz = -ty;
    const top = pavementTopAt(tx, tz);
    if (top === undefined) { hardOpening(tree, tx, tz); continue; }
    if (insideCarriageway(tx, tz, 0.2)) continue;
    let corners = treePlotCorners.get(tree);
    if (!corners) {
      // Any other tree standing in paving -- a surveyed tree with no curb-side opening of its
      // own (a property-side cutout, a tree the survey placed on the walk), or the inventory's --
      // has an opening: one of the walk's own squares, three feet, square to the walk. On grass
      // (a park, a lawn, a yard: no paving under it) it has none.
      const bearing = pavementBearingAt(tx, tz);
      if (bearing === undefined) { if (!hardOpening(tree, tx, tz) && survey) treeSquareStats.onGrass += 1; continue; }
      const c=Math.cos(bearing),s=Math.sin(bearing),half=.4572;
      const square=[[-half,-half],[half,-half],[half,half],[-half,half]].map(([u,v])=>[tx+u*c-v*s,tz+u*s+v*c]);
      const open = (q) => q.every(([x,z])=>pavementSurfaceAt(x,z)!==null && !insideCarriageway(x,z,0) && !insideBikeLane(x,z,.15));
      if (!open(square)) { if (!hardOpening(tree, tx, tz) && survey) treeSquareStats.onGrass += 1; continue; }
      let plot = { center:[tx,tz], corners:square };
      if (walkSquares) { const squared = walkSquarePlot(walkSquares, plot); if (squared !== plot && open(squared.corners)) plot = squared; }
      corners = plot.corners;
      if (plot.center[0] !== tx || plot.center[1] !== tz) tree.p=[plot.center[0]/metersPerLon+midLon,-plot.center[1]/metersPerLat+midLat];
      treePlotCorners.set(tree,corners);
      treeSquareStats.squareOpening += 1;
    }
    const base = pits.positions.length / 3;
    for (const [i,[x,z]] of corners.entries()) {
      pits.positions.push(x, top + PIT_LIFT_M, z);
      pits.uvs.push(i===1 || i===2 ? 1 : 0,i>=2 ? 1 : 0);
    }
    pits.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    pitCount += 1;
  }
  if (pits.indices.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(pits.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(pits.uvs, 2));
    geom.setIndex(pits.indices);
    geom.computeVertexNormals();
    addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      map: soilTexture(), color: 0xffffff, roughness: 1.0, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    })), "tree_pit");
  }
  if (hardPits.indices.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(hardPits.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(hardPits.uvs, 2));
    geom.setIndex(hardPits.indices);
    geom.computeVertexNormals();
    // (Drawn as the paving it is cut in is: over the coarse backdrop, after the plazas.)
    const mesh = addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ map: soilTexture(), color: 0xffffff, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide, depthTest: false })), "tree_pit|hard_ground");
    mesh.renderOrder = -0.9;
  }
  window.kerbsideTreeOpenings = () => ({ ...treeSquareStats, footway: pitCount });

  // Trees, one instanced mesh per variant. The trunk diameter the city recorded sets the size:
  // a three inch stem is a sapling and a thirty inch one has a crown over the roadway.
  const byVariant = new Map();
  for (const tree of trees) {
    // In the headset every street tree is the one tree in the one bark: a model and a bark a
    // kind was more than it could draw.
    const kind = HEADSET ? HEADSET_TREE_KIND : tree.v;
    if (!byVariant.has(kind)) byVariant.set(kind, []);
    byVariant.get(kind).push(tree);
  }
  const dummy = new THREE.Object3D();
  const treeClipStats={anchors:trees.length,clipped:0};
  const wallMask = !HEADSET && vegetationLibrary ? treeWallMask(trees) : null;
  if (wallMask) treeClipStats.mask = { texels: wallMask.texels, step_m: wallMask.step, houses: wallMask.houses };
  //: Whether a crown of `radius` round (x, z) reaches into a house.
  function treeWallTouches(x, z, radius) {
    const [x0, z0] = wallMask.origin, n = Math.ceil(radius / wallMask.step);
    const ci = Math.floor((x - x0) / wallMask.step), cj = Math.floor((z - z0) / wallMask.step);
    for (let j = Math.max(0, cj - n); j <= Math.min(wallMask.h - 1, cj + n); j += 2)
      for (let i = Math.max(0, ci - n); i <= Math.min(wallMask.w - 1, ci + n); i += 2)
        if (wallMask.top[j * wallMask.w + i] > TREE_WALL_NONE) return true;
    return false;
  }
  // Clip only the geometry invading a house; mapped sidewalk tree anchors,
  // diameters, order and seeded rotations remain exactly the same.
  function treeBuildingPrisms(x,z,radius){
    const seen=new Set(),prisms=[];
    for(let c=Math.floor((x-radius)/FOOTPRINT_CELL);c<=Math.floor((x+radius)/FOOTPRINT_CELL);c++)
      for(let r=Math.floor((z-radius)/FOOTPRINT_CELL);r<=Math.floor((z+radius)/FOOTPRINT_CELL);r++)
        for(const entry of footprintGrid.get(`${c}:${r}`)||[]){
          if(seen.has(entry))continue;seen.add(entry);
          if(x+radius<entry.minX||x-radius>entry.maxX||z+radius<entry.minZ||z-radius>entry.maxZ)continue;
          const ring=entry.local.slice();if(ring.length>1&&Math.hypot(ring[0][0]-ring.at(-1)[0],ring[0][1]-ring.at(-1)[1])<.001)ring.pop();
          const base=(entry.way._treeClipBase??groundBaseFor(entry.way.points))-.1;
          const top=(entry.way._treeClipRoof??(base+Math.max(3,entry.way.height_m||10.5)))+.1;
          for(const indices of THREE.ShapeUtils.triangulateShape(ring.map(p=>new THREE.Vector2(...p)),[]))
            prisms.push(vegetationLibrary.trianglePrismPlanes(indices.map(i=>ring[i]),base,top));
        }
    return prisms;
  }
  for (const [kind, list] of byVariant) {
    const proto = treeVariant(kind);
    let prototypeRadius=0,prototypeHeight=0;for(const part of proto.children){part.geometry.computeBoundingBox();const b=part.geometry.boundingBox;
      prototypeRadius=Math.max(prototypeRadius,Math.hypot(Math.max(Math.abs(b.min.x),Math.abs(b.max.x)),Math.max(Math.abs(b.min.z),Math.abs(b.max.z))));
      prototypeHeight=Math.max(prototypeHeight,b.max.y);}
    // Every tree of the kind is an instance of it here (the far tier): its bark, big limbs and
    // leaf cards, at its measured height and spread. Round you the near tier (treeNear) draws
    // it in full, its crown shaped to the lidar's, in place of the instance.
    if (!HEADSET) treeNearProtos.set(kind, proto);
    const instances = list;
    const scales=instances.map(tree=>treeScale(tree,kind,prototypeHeight,prototypeRadius));
    // Off the headset a tree that meets a house is one more instance of its kind, cut at the
    // wall as it is drawn (treeWallMask); only whether it meets one is asked here.
    const clipping=instances.map((tree,i)=>{if(!vegetationLibrary)return null;
      const [x,y]=xy(...tree.p);
      if(wallMask){const hit=treeWallTouches(x,-y,scales[i][0]*prototypeRadius);if(hit)treeClipStats.clipped++;return null;}
      const prisms=treeBuildingPrisms(x,-y,scales[i][0]*prototypeRadius);if(prisms.length)treeClipStats.clipped++;return prisms.length?prisms:null;});
    for (const part of proto.children) {
      if (wallMask) cutTreeAtWalls(part, wallMask);
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, instances.length-clipping.filter(Boolean).length);
      if (wallMask) mesh.customDepthMaterial = part.userData.treeDepth;
      mesh.userData.surface = `tree:${kind}`;   // named for the tile exporter and the audit
      // Each tree's own basis, by instance: a lidar crown is measured, an inventory point mapped.
      mesh.userData.instanceBasis = [];
      let instance=0;const clipped=[];
      for (let i = 0; i < instances.length; i += 1) {
        const tree = instances[i];
        const [x, y] = xy(tree.p[0], tree.p[1]);
        // Measured height and crown where the lidar gave them; else from the trunk.
        const [across, up] = scales[i];
        dummy.position.set(x, 0, -y);
        dummy.scale.set(across, up, across);
        // At zero here: liftOntoGround(groups.ground) puts every instance on the hill once.
        // Adding the ground here as well stood every tree twice as high as the hill it was on.
        dummy.position.y = part.position.y * up;
        // (A tree with a measured crown faces north, as the crown it is shaped to does.)
        dummy.rotation.set(0, tree.profile ? 0 : random(i * 7 + kind.length) * Math.PI * 2, 0);
        dummy.updateMatrix();
        if(clipping[i]){
          dummy.position.y+=groundLiftAt(x,-y);dummy.updateMatrix();
          const baked=part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone();baked.applyMatrix4(dummy.matrix);
          const attributes=Object.fromEntries(Object.entries(baked.attributes).map(([name,a])=>[name,{array:a.array,size:a.itemSize}]));
          const result=vegetationLibrary.clipOutsidePrisms(attributes,clipping[i]);baked.dispose();
          if(result.position.length){const g=new THREE.BufferGeometry();for(const [name,values] of Object.entries(result))g.setAttribute(name,new THREE.Float32BufferAttribute(values,attributes[name].size));
            g.computeBoundingSphere();clipped.push(g);}
          // A tree cut at a wall is baked and clipped one at a time; a square's worth of them
          // in one go held the page for two to four seconds of every window built.
          await maybeYield("Planting the trees");
        }else{mesh.setMatrixAt(instance++, dummy.matrix);
          if(part===proto.children[0]&&!HEADSET)treeNearSpec.push({x,z:-y,kind,tree,across,up,yaw:dummy.rotation.y});
          mesh.userData.instanceBasis.push(tree.src ? `measured (${tree.src.replace(/_/g, " ")})` : "mapped (city tree inventory)");}
      }
      mesh.instanceMatrix.needsUpdate = true;
      if(mesh.count)groups.ground.add(mesh);
      if(clipped.length){const fixed=new THREE.Mesh(mergeParts(clipped),part.material);
        fixed.userData={surface:`tree:${kind}`,liftedOntoGround:true,treeWallClipped:true};groups.ground.add(fixed);}
    }
  }
  if (wallMask) wallMask.top = null;
  window.kerbsideTreeClearance=treeClipStats;
  window.kerbsideTreeSquares=treeSquareStats;
  understoreyReady=()=>buildParkUnderstorey(trees);

  buildCourts(ground);
  // What is inside the parks: playgrounds and the other recreation areas (RPD / OpenStreetMap).
  window.kerbsideParkAreas = await runStepsSliced(buildParkAreasSteps(PARK_EVIDENCE?.areas || []));
  window.kerbsideFenceLayers = fenceLayStats;
  tileGroup(groups.ground);
  await liftOntoGroundAsync(groups.ground, "Standing the ground cover on the hill");
  // The near tier: which instance each tree is, now that they stand where they will be drawn.
  if (!HEADSET && treeNearSpec.length) {
    try { treeNear = treeNearIndex(treeNearSpec, survey); }
    catch (error) { console.warn("kerbside: the near trees are not drawn (the far ones are)", error); treeNear = null; }
  }
  // The walker stands on these as they are now drawn (walkCoverTopAt).
  registerWalkCover(groups.ground);
  if(grassStrands&&grassLibrary){const meshes=[];
    groups.ground.traverse(o=>{if(o.isMesh&&["yard","park"].includes(o.userData.surface))meshes.push(o);});
    grassSurfaceAt=grassLibrary.triangleGroundSampler(meshes);grassStrands?.invalidate();
    window.kerbsideUnderstorey=understoreyReady?.();}
  installTunnelVoidCuts(groups.ground,true);
  window.kerbsideReady = Object.assign(window.kerbsideReady || {}, { ground: true });
  // The ground is down; now the things that stand on it.
  if (groups.furniture.visible) ensureLazyLayer("furniture");
})();

// Everything collected off the roofs while the buildings were being built, in nine meshes.
emitRoofParts();
// And every awning and every sign, in one mesh per awning kind and one per name atlas.
emitShopfronts();
// And every street surface, marking and piece of facade detail, by material. The detail is
// merged into the same group the buildings are in so that it sits under the same layer toggle.
// Streets keep their own layer, so the surfaces and markings flush there and the facade
// detail flushes in with the buildings it belongs to.
const isBuilt = (key) => key.startsWith("part|") || key.startsWith("plane|")
  || key.startsWith("roof|") || key.startsWith("wall|") || key.startsWith("garage|");
// Reconstructed kerbs and other swept objects join the street geometry: merged by material,
// tiled, culled at the kerb's range, and stood on the ground by the lift every street surface
// gets -- built, like the rest, at flat heights from the road's top.
//: A reconstructed kerb is drawn where the page's own pavement meets it: the road and the
//: pavement are still laid from widths, and where the survey puts the kerb well out from the
//: pavement edge those widths drew, the measured kerb would stand alone in the asphalt. Those
//: stretches wait for the surfaces to be bounded by the kerbs themselves, and are counted.
//: (A kerb is the edge of its walk, one thing: the walk stands its own kerb face along its whole
//: edge, and a measured kerb is drawn only as that edge's finer drawing, where it lies on it --
//: pavement within a hand of it on the footway side. It was drawn with the pavement up to a metre
//: and a half away, and where the walk curved off to a corner or the two lines disagreed the
//: measured kerb hung in the road by itself with the walk ending short of it: Chestnut and
//: Filbert, 2026-11-23. Never again apart: off the walk's edge, only the walk's own kerb.)
const WORLD_KERB_SUPPORT_M = [0.1, 0.25];
const worldSweepStats = { drawn: 0, unsupported_m: 0, supported_m: 0 };
function worldPavedBeside(anchor, east, north, nx, ny) {
  for (const d of WORLD_KERB_SUPPORT_M) {
    const [x, z] = worldLocalToPage(anchor, east + nx * d, north + ny * d);
    if (pavementTopAt(x, z) !== undefined) return true;
  }
  return false;
}
//: Whether a surveyed curb at (east, north) has pavement on its far side too (the way ``nx, ny``,
//: away from the walk it edges): then it is inside a walk the page drew whole -- a planter's or a
//: park's old edge the survey caught -- and drawn there it was a broken white line down the
//: middle of the pavement (Chestnut Street along Moscone, 2026-11-22). A kerb has the roadway,
//: or ground below it, on that side.
function worldInsideWalk(anchor, east, north, nx, ny) {
  for (const d of [0.5, 1.0]) {
    const [x, z] = worldLocalToPage(anchor, east + nx * d, north + ny * d);
    if (pavementTopAt(x, z) === undefined || insideCarriageway(x, z, 0)) return false;
  }
  return true;
}
//: The surveyed curbs' concrete: the curb's troweled pour (KERB_CONCRETE, its fifteen-foot joints
//: near you), in the survey's shade.
let SURVEYED_CURB_MATERIAL = null;
function surveyedCurbMaterial() {
  return SURVEYED_CURB_MATERIAL ||= new THREE.MeshStandardMaterial({
    map: KERB_CONCRETE, color: 0xd8d6d0, roughness: 0.9, metalness: 0.0 });
}
function emitWorldSweeps() {
  for (const record of (WORLD_OBJECTS.objects || [])) {
    if (!record.sweep) continue;
    const side = record.sweep.params && record.sweep.params.side ? record.sweep.params.side.value : 0;
    const curb = record.type === "curb";
    for (const piece of worldSupportedPieces(record, side)) {
      // A curb in the standard section, laid with the curb's own concrete by the metre.
      const { vertices, index, uv } = sweepGeometryLocal(piece.path, piece.breaks, false,
                                                         curb ? sfCurbSection(piece.profile) : piece.profile,
                                                         !!record.sweep.closed_profile, !!record.sweep.caps);
      if (!index.length) continue;
      const position = new Float32Array(vertices.length);
      for (let i = 0; i < vertices.length; i += 3) {
        const [x, z] = worldLocalToPage(record.anchor, vertices[i], vertices[i + 1]);
        position[i] = x;
        position[i + 1] = ROAD_TOP_M + vertices[i + 2];
        position[i + 2] = z;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
      if (curb) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv.map((m) => m / WALK_UV_M), 2));
      geometry.setIndex(index);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, curb ? surveyedCurbMaterial() : worldObjectMaterial(record.material));
      mesh.userData.surface = "kerb";
      addMerged(`reconstructed:${record.type}`, mesh, "kerb");
      worldSweepStats.drawn += 1;
    }
  }
  return worldSweepStats.drawn;
}
//: Where a swept kerb curves round a junction's corner -- its curb return -- it is not drawn.
//: The corner is the square its two pavements make (addJunctionSquares), with its own kerb
//: faces, and the measured curve stood on that square as a strip of white tile with slivers of
//: road either side of it where it met the straight kerbs. A bend is a turn of more than this
//: over CURB_RETURN_WINDOW_M either side of a point, within reach of a corner square.
const CURB_RETURN_TURN_DEG = 22;
const CURB_RETURN_WINDOW_M = 3;
//: How near a corner square's outline a measured kerb point counts as on it.
const CURB_ON_SQUARE_M = 0.35;
// Inside the ring, or within ``slack`` of one of its sides.
function nearRing(ring, x, z, slack) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / ((bz - az) || 1e-9) + ax) inside = !inside;
    const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / ((ex * ex + ez * ez) || 1)));
    if (Math.hypot(ax + ex * t - x, az + ez * t - z) < slack) return true;
  }
  return inside;
}
function curbReturnAt(anchor, dense) {
  if (!junctionSquares.length) return null;
  const out = new Array(dense.length).fill(false);
  const w = CURB_RETURN_WINDOW_M;     // the path is densified to a metre
  // Out to the path's own ends: a return that began within a window of an end had that end
  // left standing, a stub of curved kerb proud of the square.
  for (let i = 1; i + 1 < dense.length; i += 1) {
    const p = Math.max(0, i - w), n = Math.min(dense.length - 1, i + w);
    const a = Math.atan2(dense[i][1] - dense[p][1], dense[i][0] - dense[p][0]);
    const b = Math.atan2(dense[n][1] - dense[i][1], dense[n][0] - dense[i][0]);
    let turn = Math.abs(b - a) * 180 / Math.PI;
    turn = Math.min(turn, 360 - turn);
    if (turn < CURB_RETURN_TURN_DEG) continue;
    const [x, z] = worldLocalToPage(anchor, dense[i][0], dense[i][1]);
    if (!junctionSquares.some((q) => Math.hypot(q.kx - x, q.kz - z) < q.reach)) continue;
    for (let k = p; k <= n; k += 1) out[k] = true;
  }
  // Nor a kerb on the square itself -- along its kerb lines or across it: the square stands
  // its own kerb faces there, and a measured kerb a hand's breadth off them stood up through
  // its slab as a sliver.
  for (let i = 0; i < dense.length; i += 1) {
    if (out[i]) continue;
    const [x, z] = worldLocalToPage(anchor, dense[i][0], dense[i][1]);
    if (junctionSquares.some((q) => q.ring && Math.hypot(q.kx - x, q.kz - z) < q.reach + 1
        && nearRing(q.ring, x, z, CURB_ON_SQUARE_M))) out[i] = true;
  }
  // Nor is what is left between a return and the path's end, or between two returns, kept when
  // it is shorter than a window: a sliver of kerb standing on its own at the corner.
  for (let i = 0; i < dense.length;) {
    if (out[i]) { i += 1; continue; }
    let j = i;
    while (j < dense.length && !out[j]) j += 1;
    if (j - i < w && (i === 0 || out[i - 1]) && (j === dense.length || out[j]) && (i > 0 || j < dense.length))
      for (let k = i; k < j; k += 1) out[k] = true;
    i = j;
  }
  return out;
}
//: The stretches of a swept kerb with the page's pavement on its footway side, each as its own
//: path (densified to a metre, breaks carried across). A swept object with no footway side
//: (a fence, a rail) is drawn whole.
//: The shortest stretch of a measured kerb drawn on its own.
const WORLD_KERB_MIN_PIECE_M = 1.5;
function worldSupportedPieces(record, side) {
  const level = worldSweepLevel(record.sweep.lods);
  const base = worldSweepLocal(record);   // for the profile, uniform-kerb rule applied
  const profile = base.profile;
  const raw = [];
  for (let i = 0; i < level.path.length; i += 2) raw.push([level.path[i] / 1000, level.path[i + 1] / 1000]);
  const breakSet = new Set(level.breaks || []);
  if (!side) return [{ path: raw.map(([e, n]) => [e, n, 0]), breaks: [...breakSet], profile }];
  const dense = [], isBreak = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (i > 0) {
      const [ae, an] = raw[i - 1], [be, bn] = raw[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(be - ae, bn - an) / 1.0));
      for (let s = 1; s < steps; s += 1) {
        dense.push([ae + (be - ae) * s / steps, an + (bn - an) * s / steps]);
        isBreak.push(false);
      }
    }
    dense.push(raw[i]);
    isBreak.push(breakSet.has(i));
  }
  const returning = record.type === "curb" ? curbReturnAt(record.anchor, dense) : null;
  const supported = dense.map(([e, n], i) => {
    if (returning && returning[i]) return false;
    const j = Math.min(i, dense.length - 2);
    const de = dense[j + 1][0] - dense[j][0], dn = dense[j + 1][1] - dense[j][1];
    const len = Math.hypot(de, dn) || 1;
    return worldPavedBeside(record.anchor, e, n, side * -dn / len, side * de / len)
      && !(record.type === "curb" && worldInsideWalk(record.anchor, e, n, side * dn / len, -side * de / len));
  });
  const pieces = [];
  let run = [], runBreaks = [];
  const flush = () => {
    // A stretch shorter than a kerb stone is not drawn: where the measured kerb and the page's
    // pavement part company, a metre of it stood alone in the road at the corner, a sliver.
    let length = 0;
    for (let k = 1; k < run.length; k += 1) length += Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]);
    if (run.length >= 2 && length >= WORLD_KERB_MIN_PIECE_M) pieces.push({ path: run.map(([e, n]) => [e, n, 0]), breaks: runBreaks, profile });
    else if (run.length >= 2) { worldSweepStats.supported_m -= length; worldSweepStats.unsupported_m += length; }
    run = [];
    runBreaks = [];
  };
  for (let i = 0; i < dense.length; i += 1) {
    const step = i ? Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]) : 0;
    if (!supported[i]) { worldSweepStats.unsupported_m += step; flush(); continue; }
    if (run.length) worldSweepStats.supported_m += step;
    if (isBreak[i] && run.length) runBreaks.push(run.length);
    run.push(dense[i]);
  }
  flush();
  return pieces;
}
if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame();   // between whole steps too (a hop's longest task)
const worldSweepsDrawn = emitWorldSweeps();
flushMerged(groups.streets, (key) => !isBuilt(key));
flushMerged(groups.mapped3d, isBuilt);
// A garage door is at the level of the driveway outside it, which is the street's ground there.
for (const mesh of groups.mapped3d.children) if (mesh.userData.surface === "garage") liftOntoGround(mesh);

// Reconstructed rigid objects -- a curved bench, a fitted bollard, a scanned sculpture -- each
// with its levels of detail. A level is shown from the distance at which the detail it leaves
// out (its measured geometric error) shrinks below the tile tree's own pixel threshold, so an
// object refines on exactly the rule the rest of the city does.
function worldLodDistance(errorM) {
  if (!(errorM > 0)) return 0;
  const perPixel = 2 * Math.tan((camera.fov * Math.PI) / 360) / Math.max(window.innerHeight, 1);
  return errorM / (perPixel * TILE_MAX_SCREEN_ERROR_PX);
}
function renderWorldMeshes() {
  let drawn = 0;
  for (const record of (WORLD_OBJECTS.objects || [])) {
    if (!record.mesh || !record.mesh.lods.length) continue;
    const lod = new THREE.LOD();
    const levels = [...record.mesh.lods].sort((a, b) => b.level - a.level);
    for (const level of levels) {
      const group = new THREE.Group();
      for (const part of level.parts) {
        const v = part.v, position = new Float32Array(v.length);
        for (let i = 0; i < v.length; i += 3) {
          position[i] = v[i] / 1000;
          position[i + 1] = v[i + 2] / 1000;
          position[i + 2] = -v[i + 1] / 1000;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
        geometry.setIndex(part.i);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, worldObjectMaterial(part.material));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      lod.addLevel(group, level === levels[0] ? 0 : worldLodDistance(level.err_m));
    }
    const [x, z] = worldLocalToPage(record.anchor, 0, 0);
    const top = pavementTopAt(x, z);
    lod.position.set(x, (top === undefined ? ROAD_TOP_M : top) + groundLiftAt(x, z), z);
    lod.userData = { surface: "reconstructed", worldObject: {
      id: record.id, type: record.type, basis: record.basis, confidence: record.confidence,
      prov: record.prov } };
    groups.reconstructed.add(lod);
    drawn += 1;
  }
  return drawn;
}
const worldMeshesDrawn = renderWorldMeshes();
if (worldSweepsDrawn || worldMeshesDrawn) {
  console.info(`reconstructed objects: ${worldSweepsDrawn} swept pieces, ${worldMeshesDrawn} rigid; `
    + `${Math.round(worldSweepStats.supported_m)} m of kerb drawn, `
    + `${Math.round(worldSweepStats.unsupported_m)} m waiting on surfaces bounded by the kerbs`);
}

