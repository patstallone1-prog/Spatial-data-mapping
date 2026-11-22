// The animals as they are drawn (animals.mjs says where each is and what it is doing).
//
// Three tiers, like the people's (detail.mjs), each a handful of instanced meshes for every
// animal of the kind in sight:
//
//   full      a dog, a cat or a rabbit near you: fourteen jointed parts -- a deep-chested body,
//             neck, a skull with a muzzle, eyes and nose, ears of its breed's kind, four legs of
//             two parts each with paws, a tail -- about 9,000 triangles, walking with its own
//             gait, sitting, limping, lying. Two coat colours an animal (the breed's).
//   moderate  the same animal past thirty metres: seven parts, some 1,400 triangles, legs swinging
//             straight. Birds are never drawn finer than this: a body and two wings that beat.
//   low       one shape, a few hundred triangles or fewer: a dog across the street, a sparrow, a rat.
//
// Modelled here: smooth lofted shapes to each breed's proportions, not scans of real animals.
// The birds are imported models (docs/city/models/birds, CC-BY 3.0, credited in birds.json):
// fetched the first time a species is drawn, the lofted bird standing in until it has come.
// THREE is passed in; nothing here touches the page.
import { FLIGHT, SPECIES } from "./animals.mjs";

export const ANIMAL_CAPS = { full: 24, mid: 120, low: 260, birds: 300, birdsLow: 320, rats: 24, leads: 60 };

//: The imported birds: one file a species, six parts each (tools/blender/build_city_birds.py).
//: ``stand`` has its origin at the feet; ``fly`` at the body's middle; each wing at its shoulder,
//: where it hinges, held level. Metres, the head toward -z. ``_low`` parts are the far tier.
export const BIRD_PARTS = ["stand", "stand_low", "fly", "fly_wing_l", "fly_wing_r", "fly_low"];
export const birdFile = (species) => `city/models/birds/${species}.glb`;

//: How each kind of pet is built on the one set of parts: scales of the reference dog (shoulder
//: 0.5 m, body 0.7 m).
const BUILD = {
  dog: { head: 1, leg: 1, neck: 1, body: 1, tail: 1 },
  cat: { head: 1.18, leg: 0.92, neck: 0.75, body: 0.9, tail: 1.5 },
  rabbit: { head: 1.3, leg: 0.5, neck: 0.5, body: 1.15, tail: 0.35 },
};
const H0 = 0.5, L0 = 0.7;

export function animalFigures({ THREE, add, loadModel = null, asset = (path) => path }) {
  // ---- shapes ----------------------------------------------------------------------------------
  //: A lofted tube along -z (the way it faces): rings [{z, rx, ry, y, x?}] of ``sides`` points.
  const loft = (rings, sides, { capA = true, capB = true } = {}) => {
    const pos = [], idx = [];
    for (const r of rings) for (let k = 0; k < sides; k += 1) {
      const a = (k / sides) * Math.PI * 2;
      // (Flatter underneath than on top: ``belly`` < 1 pulls the lower half in.)
      const sy = Math.sin(a), yy = sy < 0 ? sy * (r.belly ?? 1) : sy;
      pos.push((r.x || 0) + Math.cos(a) * r.rx, (r.y || 0) + yy * r.ry, r.z);
    }
    for (let i = 0; i + 1 < rings.length; i += 1) for (let k = 0; k < sides; k += 1) {
      const a = i * sides + k, b = i * sides + ((k + 1) % sides), c = a + sides, d = b + sides;
      idx.push(a, b, c, b, d, c);
    }
    const cap = (i, flip) => { const r = rings[i], at = pos.length / 3; pos.push(r.x || 0, r.y || 0, r.z); for (let k = 0; k < sides; k += 1) { const a = i * sides + k, b = i * sides + ((k + 1) % sides); if (flip) idx.push(at, b, a); else idx.push(at, a, b); } };
    if (capA) cap(0, true);
    if (capB) cap(rings.length - 1, false);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  //: Rings between key rings, eased: a smooth body from a few measured sections.
  const smooth = (keys, n) => {
    // (Catmull-Rom through the sections: eased from one to the next the surface rippled at each.)
    const out = [], val = (K, key) => K[key] ?? (key === "belly" ? 1 : 0);
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
    for (let i = 0; i + 1 < keys.length; i += 1) for (let k = 0; k < n; k += 1) {
      const t = k / n, A = keys[i], B = keys[i + 1], P = keys[Math.max(0, i - 1)], Q = keys[Math.min(keys.length - 1, i + 2)], r = {};
      for (const key of ["z", "rx", "ry", "y", "x", "belly"]) if (A[key] !== undefined || B[key] !== undefined) {
        const v = cr(val(P, key), val(A, key), val(B, key), val(Q, key), t);
        r[key] = key === "rx" || key === "ry" ? Math.max(0.001, v) : v;
      }
      out.push(r);
    }
    out.push({ ...keys[keys.length - 1] });
    return out;
  };
  const tint = (g, fn) => {
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i += 1) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v; }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  };
  const merge = (list) => {
    const pos = [], col = [], idx = [];
    let base = 0;
    for (const g of list) {
      const p = g.attributes.position, c = g.attributes.color;
      for (let i = 0; i < p.count; i += 1) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1); }
      for (const k of g.index.array) idx.push(k + base);
      base += p.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const ball = (rx, ry, rz, n, m) => { const g = new THREE.SphereGeometry(1, n, m); g.scale(rx, ry, rz); return g.index ? g : g.toNonIndexed(); };
  const moved = (g, x, y, z) => { g.translate(x, y, z); return g; };

  // The reference dog, facing -z, feet on y = 0, shoulder at H0. Chest at z = -0.24, rump at +0.36.
  const TOP = H0, CH = 0.385;   // the back's line; the chest's middle height
  const torso = (per, sides) => tint(loft(smooth([
    { z: -0.305, rx: 0.018, ry: 0.028, y: CH + 0.03 }, { z: -0.275, rx: 0.074, ry: 0.088, y: CH + 0.012 }, { z: -0.2, rx: 0.1, ry: 0.118, y: CH - 0.004, belly: 1.12 },
    { z: -0.05, rx: 0.106, ry: 0.115, y: CH, belly: 1.0 }, { z: 0.1, rx: 0.094, ry: 0.1, y: CH + 0.014, belly: 0.72 }, { z: 0.24, rx: 0.1, ry: 0.104, y: CH + 0.012, belly: 0.86 },
    { z: 0.34, rx: 0.086, ry: 0.092, y: CH + 0.012 }, { z: 0.39, rx: 0.05, ry: 0.056, y: CH + 0.02 }, { z: 0.412, rx: 0.014, ry: 0.018, y: CH + 0.026 }], per), sides, { capA: false, capB: false }), (x, y) => (y < CH - 0.05 ? 0.93 : 1));
  //: The second coat: chest and belly (a bib under the body), drawn a hair outside the first.
  const bib = (per, sides) => {
    const g = loft(smooth([{ z: -0.31, rx: 0.012, ry: 0.02, y: CH - 0.0 }, { z: -0.28, rx: 0.066, ry: 0.075, y: CH - 0.012 }, { z: -0.2, rx: 0.088, ry: 0.098, y: CH - 0.04 },
      { z: -0.05, rx: 0.084, ry: 0.088, y: CH - 0.036 }, { z: 0.08, rx: 0.05, ry: 0.05, y: CH - 0.03 }, { z: 0.16, rx: 0.008, ry: 0.012, y: CH - 0.03 }], per), sides, { capA: false, capB: false });
    return tint(g, () => 1);
  };
  //: Neck: from the chest up and forward to the skull. Pivot at its base (0, 0, 0).
  const neck = (per, sides) => tint(loft(smooth([{ z: 0.05, rx: 0.08, ry: 0.07, y: -0.07 }, { z: 0.0, rx: 0.08, ry: 0.088, y: 0.0 }, { z: -0.06, rx: 0.066, ry: 0.078, y: 0.075 }, { z: -0.11, rx: 0.058, ry: 0.066, y: 0.13 }, { z: -0.14, rx: 0.054, ry: 0.06, y: 0.165 }], per), sides), () => 1);
  //: Skull, with eyes and the bases of the ears: pivot where the neck ends.
  const skull = (n, m) => {
    const s = tint(moved(ball(0.07, 0.068, 0.092, n, m), 0, 0.014, -0.05), (x, y, z) => (z < -0.1 ? 0.96 : 1));
    const eye = (sx) => tint(moved(ball(0.0125, 0.0125, 0.008, Math.max(6, n >> 1), Math.max(4, m >> 1)), sx * 0.04, 0.034, -0.118), () => 0.04);
    const brow = (sx) => tint(moved(ball(0.022, 0.012, 0.014, Math.max(6, n >> 1), Math.max(4, m >> 1)), sx * 0.038, 0.052, -0.108), () => 0.9);
    return merge([s, eye(1), eye(-1), brow(1), brow(-1)]);
  };
  //: Muzzle and nose (scaled along z by the breed: a bulldog's is a third of a shepherd's).
  const muzzle = (per, sides) => {
    const g = tint(loft(smooth([{ z: 0.03, rx: 0.056, ry: 0.052, y: 0.0 }, { z: -0.03, rx: 0.045, ry: 0.042, y: -0.01 }, { z: -0.09, rx: 0.036, ry: 0.033, y: -0.016 }, { z: -0.122, rx: 0.026, ry: 0.025, y: -0.016 }, { z: -0.132, rx: 0.012, ry: 0.012, y: -0.014 }], per), sides), () => 1);
    const nose = tint(moved(ball(0.017, 0.014, 0.012, 8, 6), 0, 0.002, -0.134), () => 0.03);
    const jaw = tint(loft(smooth([{ z: 0.02, rx: 0.04, ry: 0.016, y: -0.044 }, { z: -0.105, rx: 0.024, ry: 0.011, y: -0.044 }], Math.max(2, per >> 1)), Math.max(6, sides >> 1)), () => 0.82);
    return merge([g, nose, jaw]);
  };
  //: An ear: a leaf, its base at (0, 0, 0), up along +y, cupped. Stood, folded or hung by the breed.
  const ear = (n) => {
    const pos = [], idx = [], rows = n, cols = Math.max(3, n >> 1);
    for (let i = 0; i <= rows; i += 1) { const t = i / rows, w = 0.04 * Math.sin(Math.PI * (0.2 + 0.8 * (1 - t))) * (1 - 0.2 * t); for (let k = 0; k <= cols; k += 1) { const u = k / cols - 0.5; pos.push(u * 2 * w, t * 0.095, -Math.cos(u * Math.PI) * 0.014 * (1 - t)); } }
    for (let i = 0; i < rows; i += 1) for (let k = 0; k < cols; k += 1) { const a = i * (cols + 1) + k, b = a + 1, c = a + cols + 1, d = c + 1; idx.push(a, b, c, b, d, c, a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return tint(g, (x, y) => 0.86 + 0.14 * Math.min(1, y / 0.05));
  };
  //: A leg's upper and lower parts, each hung from its joint at (0, 0, 0) down -y.
  const upperLeg = (per, sides, front) => tint(loft(smooth(front
    ? [{ z: 0, rx: 0.05, ry: 0.066, y: 0.05 }, { z: 0.004, rx: 0.042, ry: 0.05, y: -0.07 }, { z: 0, rx: 0.031, ry: 0.035, y: -0.17 }, { z: 0, rx: 0.027, ry: 0.03, y: -0.205 }]
    : [{ z: 0, rx: 0.058, ry: 0.085, y: 0.05 }, { z: -0.012, rx: 0.052, ry: 0.07, y: -0.07 }, { z: -0.022, rx: 0.035, ry: 0.042, y: -0.17 }, { z: -0.016, rx: 0.028, ry: 0.031, y: -0.205 }], per).map((r) => ({ z: r.y, rx: r.rx, ry: r.ry, y: -r.z })), sides), () => 1).rotateX(-Math.PI / 2);
  const lowerLeg = (per, sides, front) => {
    const shank = tint(loft(smooth(front
      ? [{ z: 0.006, rx: 0.026, ry: 0.028, y: 0 }, { z: -0.07, rx: 0.02, ry: 0.022, y: 0 }, { z: -0.14, rx: 0.018, ry: 0.02, y: 0 }, { z: -0.168, rx: 0.02, ry: 0.022, y: 0.004 }]
      : [{ z: 0.006, rx: 0.027, ry: 0.03, y: 0 }, { z: -0.06, rx: 0.02, ry: 0.024, y: -0.016 }, { z: -0.13, rx: 0.017, ry: 0.02, y: -0.006 }, { z: -0.168, rx: 0.02, ry: 0.022, y: 0.004 }], per).map((r) => ({ z: r.z, rx: r.rx, ry: r.ry, y: -r.y })), sides), () => 1).rotateX(-Math.PI / 2);
    const paw = tint(moved(ball(0.026, 0.017, 0.036, Math.max(6, sides - 2), 5), 0, -0.186, -0.012), (x, y) => (y < -0.196 ? 0.55 : 1));
    return merge([shank, paw]);
  };
  //: The tail: a tapering curve back from the rump, its base at (0, 0, 0). Held by the breed.
  const tailGeo = (per, sides) => tint(loft(smooth([{ z: 0, rx: 0.026, ry: 0.026, y: 0 }, { z: 0.08, rx: 0.022, ry: 0.022, y: -0.012 }, { z: 0.17, rx: 0.017, ry: 0.017, y: -0.03 }, { z: 0.25, rx: 0.011, ry: 0.011, y: -0.035 }, { z: 0.3, rx: 0.004, ry: 0.004, y: -0.03 }], per), sides), (x, y, z) => (z > 0.24 ? 0.92 : 1));

  const mat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.86, metalness: 0 });
  const inst = (name, geo, cap, material = mat()) => { const m = new THREE.InstancedMesh(geo, material, cap); m.name = name; m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, new THREE.Color(1, 1, 1)); add(m); return m; };
  const F = ANIMAL_CAPS.full, Md = ANIMAL_CAPS.mid;
  const full = {
    torso: inst("city-animal-torso", torso(6, 26), F), bib: inst("city-animal-bib", bib(5, 20), F), neck: inst("city-animal-neck", neck(4, 16), F),
    skull: inst("city-animal-skull", skull(22, 16), F), muzzle: inst("city-animal-muzzle", muzzle(4, 16), F), ear: inst("city-animal-ear", ear(8), F * 2),
    legUF: inst("city-animal-leg-uf", upperLeg(4, 14, true), F * 2), legUR: inst("city-animal-leg-ur", upperLeg(4, 14, false), F * 2),
    legLF: inst("city-animal-leg-lf", lowerLeg(4, 12, true), F * 2), legLR: inst("city-animal-leg-lr", lowerLeg(4, 12, false), F * 2), tail: inst("city-animal-tail", tailGeo(4, 12), F),
  };
  //: Moderate: the body with its neck in one, the head with its muzzle and ears in one, four
  //: straight legs, a tail.
  const midBody = merge([torso(2, 10), moved(neck(1, 8), 0, CH + 0.09, -0.24)]);
  const midHead = merge([skull(8, 6), moved(muzzle(1, 6), 0, -0.012, -0.085), moved(ear(3).rotateZ(-0.35), -0.045, 0.05, -0.02), moved(ear(3).rotateZ(0.35), 0.045, 0.05, -0.02)]);
  const midLeg = (front) => merge([upperLeg(1, 6, front), moved(lowerLeg(1, 6, front), 0, -0.2, 0)]);
  const mid = { body: inst("city-animal-mid-body", midBody, Md), head: inst("city-animal-mid-head", midHead, Md), legF: inst("city-animal-mid-leg-f", midLeg(true), Md * 2),
    legR: inst("city-animal-mid-leg-r", midLeg(false), Md * 2), tail: inst("city-animal-mid-tail", tailGeo(1, 5), Md) };
  //: Low: one shape, stood.
  const lowGeo = merge([torso(1, 6), moved(skull(5, 4), 0, CH + 0.27, -0.4), ...[[-0.07, -0.2], [0.07, -0.2], [-0.07, 0.3], [0.07, 0.3]].map(([x, z]) => moved(tint(new THREE.CylinderGeometry(0.03, 0.02, 0.36, 4, 1), () => 1), x, 0.18, z)), moved(tailGeo(1, 4), 0, CH + 0.08, 0.38)]);
  const low = inst("city-animal-low", lowGeo, ANIMAL_CAPS.low);

  // Birds: a body and two wings (moderate); one shape, wings out (low). Unit: body 0.3 long, span 0.6.
  const birdBody = merge([tint(loft(smooth([{ z: -0.15, rx: 0.012, ry: 0.012, y: 0.012 }, { z: -0.11, rx: 0.034, ry: 0.036, y: 0.018 }, { z: -0.04, rx: 0.05, ry: 0.052, y: 0 }, { z: 0.06, rx: 0.04, ry: 0.04, y: -0.004 }, { z: 0.15, rx: 0.02, ry: 0.008, y: 0 }, { z: 0.2, rx: 0.03, ry: 0.003, y: 0.004 }], 2), 8), (x, y, z) => (z > 0.1 ? 0.7 : y < -0.02 ? 1.0 : 0.85)),
    tint(moved(new THREE.ConeGeometry(0.008, 0.035, 4).rotateX(-Math.PI / 2), 0, 0.012, -0.165), () => 0.5)]);
  const wingGeo = (() => {
    // A wing out along +x from its root at (0, 0, 0): root, wrist, tip, with a trailing edge.
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.06, 0.13, 0.008, -0.07, 0.3, 0, -0.01, 0.14, 0, 0.07, 0, 0, 0.07], 3));
    g.setIndex([0, 1, 4, 1, 3, 4, 1, 2, 3, 0, 4, 1, 1, 4, 3, 1, 3, 2]);
    g.computeVertexNormals();
    return tint(g, (x) => 0.75 + 0.25 * (1 - x / 0.3));
  })();
  const birdLowGeo = merge([tint(loft([{ z: -0.14, rx: 0.02, ry: 0.02, y: 0 }, { z: -0.03, rx: 0.045, ry: 0.045, y: 0 }, { z: 0.18, rx: 0.02, ry: 0.006, y: 0 }], 4), () => 0.9), moved(wingGeo.clone().rotateZ(0.25), 0.03, 0.01, 0), moved(wingGeo.clone().scale(-1, 1, 1).rotateZ(-0.25), -0.03, 0.01, 0)]);
  const birds = { body: inst("city-bird-body", birdBody, ANIMAL_CAPS.birds), wing: inst("city-bird-wing", wingGeo, ANIMAL_CAPS.birds * 2, (() => { const m = mat(); m.side = THREE.DoubleSide; return m; })()),
    low: inst("city-bird-low", birdLowGeo, ANIMAL_CAPS.birdsLow, (() => { const m = mat(); m.side = THREE.DoubleSide; return m; })()) };
  const ratGeo = merge([tint(loft(smooth([{ z: -0.11, rx: 0.008, ry: 0.008, y: 0.02 }, { z: -0.06, rx: 0.028, ry: 0.026, y: 0.03 }, { z: 0.02, rx: 0.04, ry: 0.036, y: 0.036 }, { z: 0.09, rx: 0.03, ry: 0.03, y: 0.03 }, { z: 0.11, rx: 0.008, ry: 0.008, y: 0.02 }], 2), 6), () => 1),
    tint(loft([{ z: 0.1, rx: 0.006, ry: 0.006, y: 0.016 }, { z: 0.3, rx: 0.002, ry: 0.002, y: 0.008 }], 3), () => 0.8)]);
  const rats = inst("city-rat", ratGeo, ANIMAL_CAPS.rats);
  //: A lead: a thin strap from a hand or a post to a collar. Unit length along -z, from (0, 0, 0).
  const leads = inst("city-animal-lead", new THREE.BoxGeometry(0.012, 0.006, 1).translate(0, 0, -0.5), ANIMAL_CAPS.leads, new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.9 }));
  const all = [...Object.values(full), ...Object.values(mid), low, ...Object.values(birds), rats, leads];
  const tris = (m) => (m.geometry.index.count / 3) * (/ear|leg/.test(m.name) ? 2 : 1);
  const TRI = { full: Object.values(full).reduce((a, m) => a + tris(m), 0), mid: Object.values(mid).reduce((a, m) => a + tris(m), 0), low: lowGeo.index.count / 3 };

  // ---- placing ---------------------------------------------------------------------------------
  const M = new THREE.Matrix4(), P = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4(), S = new THREE.Matrix4(), ROOT = new THREE.Matrix4();
  const C1 = new THREE.Color(), C2 = new THREE.Color(), E = new THREE.Euler();
  const NECK = new THREE.Matrix4(), HEAD = new THREE.Matrix4(), HIP = new THREE.Matrix4(), SUB = new THREE.Matrix4();
  //: ``out`` = parent x translate x rotate: a joint's own frame.
  const frame = (out, parent, x, y, z, rx, ry, rz) => { T.makeTranslation(x, y, z); R.makeRotationFromEuler(E.set(rx, ry, rz, "YXZ")); return out.multiplyMatrices(parent, T).multiply(R); };
  //: M = a joint's frame, scaled: what is drawn there.
  const scaled = (f, sx, sy, sz) => { S.makeScale(sx, sy, sz); M.multiplyMatrices(f, S); };
  const n = new Map(all.map((m) => [m, 0]));
  const stats = { full: 0, mid: 0, low: 0, birds: 0, rats: 0, triangles: 0 };
  const put = (mesh, colour) => { const i = n.get(mesh); if (i >= mesh.instanceMatrix.count) return false; mesh.setMatrixAt(i, M); if (colour) mesh.setColorAt(i, colour); n.set(mesh, i + 1); return true; };
  //: ROOT x translate(x, y, z) x rotate(rx, ry, rz) x scale(sx, sy, sz) into M.
  const part = (x, y, z, rx, ry, rz, sx, sy, sz) => { T.makeTranslation(x, y, z); R.makeRotationFromEuler(E.set(rx, ry, rz, "YXZ")); S.makeScale(sx, sy, sz); M.multiplyMatrices(ROOT, T).multiply(R).multiply(S); };

  //: The body's pose for ``state`` at ``gait``: what each part's angles are.
  const POSE = { pitch: 0, drop: 0, roll: 0, head: 0, headTurn: 0, tail: 0, tailWag: 0, lf: 0, rf: 0, lr: 0, rr: 0, kf: 0, kr: 0, lift: -1, fold: 0 };
  function pose(state, gait, v, t, id) {
    const p = POSE; p.pitch = 0; p.drop = 0; p.roll = 0; p.head = 0; p.headTurn = 0; p.tail = 0; p.tailWag = 0; p.lf = p.rf = p.lr = p.rr = 0; p.kf = p.kr = 0; p.lift = -1; p.fold = 0;
    const moving = v > 0.15, run = state === "run" || state === "flee";
    if (state === "dead") { p.roll = Math.PI / 2; p.head = 0.5; p.tail = 0.9; p.lf = 0.5; p.rf = 0.2; p.lr = -0.4; p.rr = -0.1; return p; }
    if (moving) {
      // Walk: diagonal pairs, a quarter out of step; a run: front pair then hind pair (a bound).
      const amp = run ? 0.75 : 0.42, g = gait;
      if (run) { p.lf = Math.sin(g) * amp; p.rf = Math.sin(g + 0.5) * amp; p.lr = Math.sin(g + Math.PI) * amp; p.rr = Math.sin(g + Math.PI + 0.5) * amp; p.pitch = Math.sin(g) * 0.07; p.drop = 0.02 + Math.cos(g * 2) * 0.012; }
      else { p.lf = Math.sin(g) * amp; p.rr = Math.sin(g + 0.4) * amp; p.rf = Math.sin(g + Math.PI) * amp; p.lr = Math.sin(g + Math.PI + 0.4) * amp; p.drop = Math.cos(g * 2) * 0.006; }
      p.kf = 0.5; p.kr = 0.5; p.head = run ? -0.25 : 0.05 + Math.sin(g * 2) * 0.04; p.tail = run ? -0.3 : 0.15; p.tailWag = Math.sin(g) * 0.15;
      if (state === "limp") { p.lift = 0; p.drop += Math.max(0, Math.sin(g + Math.PI)) * 0.03; p.head = 0.3 + Math.max(0, Math.sin(g + Math.PI)) * 0.2; p.tail = 0.7; }
      return p;
    }
    if (state === "sit") { p.pitch = 0.3; p.drop = 0.1; p.fold = 1; p.head = 0.45; p.tail = 0.9; p.tailWag = Math.sin(t * 5 + id) * 0.25; p.headTurn = Math.sin(t * 0.4 + id) * 0.4; return p; }
    if (state === "alert") { p.head = -0.25; p.tail = -0.5; p.pitch = 0.04; p.lf = -0.08; p.rf = -0.08; return p; }
    p.head = 0.1 + Math.sin(t * 0.7 + id) * 0.05; p.headTurn = Math.sin(t * 0.33 + id * 1.7) * 0.5; p.tailWag = Math.sin(t * 6 + id) * 0.3; p.tail = 0.2;
    return p;
  }
  const TAIL = { up: -0.9, plume: -0.25, low: 0.55, curl: -1.2, stub: -0.2, long: -0.15 };
  let clock = 0;

  //: One dog, cat or rabbit: {x, y, z, yaw, species, breed, tier (0..2), state, gait, v, seed}.
  function quadruped(a) {
    const Sp = SPECIES[a.species], B = Sp?.breeds?.[a.breed];
    if (!B) return;
    const K = BUILD[a.species] || BUILD.dog, s = B.shoulder / H0, kz = (B.length / B.shoulder) / (L0 / H0) * K.body, id = (a.seed || 0) % 97;
    C1.setHex(B.coat[0]); C2.setHex(B.coat[1]);
    const legK = K.leg, legLen = 0.37 * legK, lift = (1 - legK) * 0.37;   // a shorter-legged animal's body rides lower
    if (a.tier >= 2) {
      T.makeTranslation(a.x, a.y - lift * s, a.z); R.makeRotationY(a.yaw); S.makeScale(s, s * (a.state === "dead" ? 0.4 : 1), s * kz);
      M.multiplyMatrices(T, R).multiply(S);
      if (put(low, C1)) { stats.low += 1; stats.triangles += TRI.low; }
      return;
    }
    const p = pose(a.state || "idle", a.gait || 0, a.v || 0, clock, id);
    // The root: where it stands, the way it faces, then the body's own pitch, roll and bob.
    T.makeTranslation(a.x, a.y, a.z); R.makeRotationFromEuler(E.set(0, a.yaw, 0, "YXZ")); ROOT.multiplyMatrices(T, R);
    S.makeScale(s, s, s); ROOT.multiply(S);
    // (Lying on its side it rests on its flank, not half in the ground.)
    T.makeTranslation(0, p.roll ? 0.115 : -lift - p.drop, 0); R.makeRotationFromEuler(E.set(p.pitch, 0, p.roll, "YXZ")); ROOT.multiply(T).multiply(R);
    const tailRot = (TAIL[B.tail] ?? 0) + p.tail, tailS = (B.tail === "stub" ? 0.3 : B.tail === "long" ? 1.25 : 1) * K.tail;
    const hx = 0.078, zF = -0.2 * kz, zR = 0.29 * kz, hipF = 0.4, hipR = 0.4;
    if (a.tier === 1) {
      part(0, 0, 0, 0, 0, 0, 1, 1, kz); if (!put(mid.body, C1)) return;
      part(0, CH + 0.25 * K.neck + 0.02, -0.24 * kz - 0.13 * K.neck, p.head * 0.6, p.headTurn * 0.5, 0, K.head, K.head, K.head * (0.7 + 0.5 * B.snout)); put(mid.head, C1);
      for (const [sx, z, ang, front] of [[-1, zF, p.lf, 1], [1, zF, p.rf, 1], [-1, zR, p.lr, 0], [1, zR, p.rr, 0]]) {
        part(sx * hx, front ? hipF : hipR, z, p.fold ? (front ? -p.pitch : 1.3) : ang, 0, 0, 1, p.fold && !front ? legK * 0.55 : legK, 1); put(front ? mid.legF : mid.legR, C1);
      }
      part(0, CH + 0.05, 0.39 * kz, tailRot, p.tailWag, 0, 1, 1, tailS); put(mid.tail, C1);
      stats.mid += 1; stats.triangles += TRI.mid;
      return;
    }
    part(0, 0, 0, 0, 0, 0, 1, 1, kz); if (!put(full.torso, C1)) return;
    put(full.bib, C2);
    // Neck and head, each in the frame of the one before: the neck from the chest's top front,
    // the skull on the neck's end, the muzzle and the ears on the skull.
    const nk = K.neck, nz = 0.6 + 0.4 * nk, kh = K.head;
    frame(NECK, ROOT, 0, CH + 0.07, -0.245 * kz, p.head * 0.5, p.headTurn * 0.4, 0);
    scaled(NECK, 1, nk, nz); put(full.neck, C1);
    frame(HEAD, NECK, 0, 0.165 * nk, -0.14 * nz, p.head * 0.5, p.headTurn * 0.6, 0);
    scaled(HEAD, kh, kh, kh); put(full.skull, C1);
    frame(SUB, HEAD, 0, -0.012 * kh, -0.1 * kh, 0, 0, 0);
    scaled(SUB, kh, kh, kh * (0.35 + 0.95 * B.snout)); put(full.muzzle, B.coat[1] !== B.coat[0] && a.species !== "cat" ? C2 : C1);
    // Ears: stood up, folded forward, hung, or a rabbit's long ones.
    const earRx = { prick: -0.15, fold: -1.25, drop: 0.15, long: -0.1 }[B.ears] ?? -0.15, earRz = { prick: 0.3, fold: 0.5, drop: 2.5, long: 0.12 }[B.ears] ?? 0.3, earS = (B.ears === "long" ? 2.1 : B.ears === "drop" ? 1.35 : 1) * kh;
    for (const sx of [-1, 1]) { frame(SUB, HEAD, sx * 0.04 * kh, 0.055 * kh, -0.02 * kh, earRx, 0, -sx * earRz); scaled(SUB, earS, earS, earS); put(full.ear, C1); }
    // Legs: the upper from its hip or shoulder; the lower from its knee, folded back as the leg
    // comes forward. Sat, the hind legs are folded under and the front ones stand.
    const legs = [[-1, zF, p.lf, 1, 0], [1, zF, p.rf, 1, 1], [-1, zR, p.lr, 0, 2], [1, zR, p.rr, 0, 3]];
    for (const [sx, z, ang0, front, k] of legs) {
      let ang = ang0, knee = Math.max(0, ang0) * 1.3 * (front ? p.kf : p.kr) * 2 + 0.06;
      if (p.fold) { if (front) { ang = -p.pitch + 0.12; knee = 0.02; } else { ang = 1.3; knee = 2.4; } }
      if (p.lift === k) { ang = 0.6; knee = 1.5; }
      frame(HIP, ROOT, sx * hx, front ? hipF : hipR, z, ang, 0, sx * 0.04);
      scaled(HIP, 1, legK, 1); put(front ? full.legUF : full.legUR, C1);
      frame(SUB, HIP, 0, -0.2 * legK, 0, -knee, 0, 0);
      scaled(SUB, 1, legK, 1); put(front ? full.legLF : full.legLR, k % 2 ? C2 : C1);
    }
    part(0, CH + 0.05, 0.39 * kz, tailRot, p.tailWag, 0, 1, 1, tailS); put(full.tail, C1);
    stats.full += 1; stats.triangles += TRI.full;
  }

  //: A bird: {x, y, z, yaw, species, flap (0..1), air, tier (1 or 2), k}.
  function bird(b) {
    const Sp = SPECIES[b.species]; if (!Sp) return;
    const model = birdModel(b.species);
    if (model) { modelBird(b, model); return; }
    const s = Sp.length / 0.3, ws = (Sp.span / 2) / 0.3;
    C1.setHex(Sp.coat[0]); C2.setHex(Sp.coat[1]);
    if (b.tier >= 2 || !b.air && b.tier >= 2) {
      T.makeTranslation(b.x, b.y + 0.05 * s, b.z); R.makeRotationY(b.yaw); S.makeScale(b.air ? ws : s * 0.35, s, s); M.multiplyMatrices(T, R).multiply(S);
      if (put(birds.low, C1)) { stats.birds += 1; stats.triangles += 26; }
      return;
    }
    // On the ground it stands a little up on its legs and pecks; in the air it banks into its turn.
    // (Perched, it sits up and looks about: no pecking at a lamp arm.)
    const peck = b.air || b.perch ? 0 : Math.max(0, Math.sin(clock * 3 + (b.k || 0) * 1.3)) * 0.5;
    T.makeTranslation(b.x, b.y + (b.air ? 0 : 0.055 * s), b.z); R.makeRotationFromEuler(E.set(b.air ? -0.05 : 0.25 + peck, b.yaw, b.air ? 0.25 : 0, "YXZ")); S.makeScale(s, s, s);
    ROOT.multiplyMatrices(T, R); M.copy(ROOT).multiply(S);
    if (!put(birds.body, C1)) return;
    // Flapping, the beat as wide as the flap asks; gliding (flap near 0), the wings held out a
    // little above level, still -- a gull's long glide, a pigeon's between bursts.
    const f = b.flap ?? 1, hz = FLIGHT[b.species]?.hz ?? (Sp.span > 1 ? 3 : 8);
    const beat = b.air ? (f > 0.08 ? Math.sin(clock * hz * Math.PI * 2 + (b.k || 0)) * (0.15 + 0.7 * f) : 0.12) : -1.35;
    for (const sx of [-1, 1]) { T.makeTranslation(sx * 0.03 * s, 0.02 * s, -0.01 * s); R.makeRotationFromEuler(E.set(0, b.air ? 0 : sx * 1.2, sx * beat, "YXZ")); S.makeScale(sx * ws, s, s * (b.air ? 1 : 0.8)); M.multiplyMatrices(ROOT, T).multiply(R).multiply(S); put(birds.wing, C2); }
    stats.birds += 1; stats.triangles += 60;
  }
  // ---- the imported birds ----------------------------------------------------------------------
  //: species -> undefined (not asked for), null (on its way), false (did not come), or its parts:
  //: {part: {mesh, at (the part's origin in the bird), tris}}.
  const models = new Map(), imported = new Set(), birdMat = mat();
  const shared = { stand: ANIMAL_CAPS.birds, stand_low: ANIMAL_CAPS.birdsLow, fly: ANIMAL_CAPS.birds, fly_wing_l: ANIMAL_CAPS.birds, fly_wing_r: ANIMAL_CAPS.birds, fly_low: ANIMAL_CAPS.birdsLow };
  function birdModel(species) {
    const have = models.get(species);
    if (have !== undefined || !loadModel) return have || null;
    models.set(species, null);
    let asked; try { asked = Promise.resolve(loadModel(asset(birdFile(species)))); } catch (error) { asked = Promise.reject(error); }
    asked.then((gltf) => {
      const found = {};
      gltf.scene.traverse((o) => { if (o.isMesh && BIRD_PARTS.includes(o.name)) found[o.name] = o; });
      const missing = BIRD_PARTS.filter((p) => !found[p]);
      if (missing.length) throw new Error(`no ${missing.join(", ")}`);
      const set = {};
      for (const p of BIRD_PARTS) {
        const o = found[p], g = o.geometry;
        // (Its own colours, a face at a time; each bird's instance colour only lightens or darkens it.)
        if (!g.attributes.color) throw new Error(`${p} has no colours`);
        const mesh = inst(`city-bird-${species}-${p}`, g, shared[p], birdMat);
        mesh.visible = false; all.push(mesh); n.set(mesh, 0); imported.add(mesh);
        set[p] = { mesh, at: o.position.clone(), tris: g.index ? g.index.count / 3 : g.attributes.position.count / 3 };
      }
      models.set(species, set);
    }).catch((error) => { models.set(species, false); console.warn(`kerbside: the ${species} model did not load; drawing the modelled one`, error?.message || error); });
    return null;
  }
  //: A bird from its model: the same {x, y, z, yaw, flap, air, perch, tier, k} as bird().
  function modelBird(b, set) {
    // Each bird a shade lighter or darker than the next (a flock is not one bird copied).
    const k = b.k || 0, h = Math.sin(k * 12.9898) * 43758.5453, shade = 0.9 + 0.2 * (h - Math.floor(h));
    C1.setRGB(shade, shade, shade);
    if (b.tier >= 2) {
      const part = b.air ? set.fly_low : set.stand_low;
      T.makeTranslation(b.x, b.y, b.z); R.makeRotationFromEuler(E.set(b.air ? -0.05 : 0, b.yaw, b.air ? 0.25 : 0, "YXZ")); M.multiplyMatrices(T, R);
      if (put(part.mesh, C1)) { stats.birds += 1; stats.triangles += part.tris; }
      return;
    }
    if (!b.air) {
      // Stood on its feet (the origin): pecking tips it forward over them; perched, it sits still.
      const peck = b.perch ? 0 : Math.max(0, Math.sin(clock * 3 + k * 1.3)) * 0.5;
      T.makeTranslation(b.x, b.y, b.z); R.makeRotationFromEuler(E.set(-peck * 0.8, b.yaw, 0, "YXZ")); M.multiplyMatrices(T, R);
      if (put(set.stand.mesh, C1)) { stats.birds += 1; stats.triangles += set.stand.tris; }
      return;
    }
    // In the air: banked into its turn; each wing beats on its own shoulder, about the body's
    // length (z) -- raised as the beat goes positive. Gliding, held a little above level.
    T.makeTranslation(b.x, b.y, b.z); R.makeRotationFromEuler(E.set(-0.05, b.yaw, 0.25, "YXZ")); ROOT.multiplyMatrices(T, R); M.copy(ROOT);
    if (!put(set.fly.mesh, C1)) return;
    const f = b.flap ?? 1, hz = FLIGHT[b.species]?.hz ?? 6;
    const beat = f > 0.08 ? Math.sin(clock * hz * Math.PI * 2 + k) * (0.15 + 0.7 * f) : 0.06;
    let tris = set.fly.tris;
    for (const [part, side] of [[set.fly_wing_l, -1], [set.fly_wing_r, 1]]) {
      T.makeTranslation(part.at.x, part.at.y, part.at.z); R.makeRotationZ(side * beat); M.multiplyMatrices(ROOT, T).multiply(R);
      if (put(part.mesh, C1)) tris += part.tris;
    }
    stats.birds += 1; stats.triangles += tris;
  }
  function rat(r) {
    const Sp = SPECIES.rat; C1.setHex(Sp.coat[0]);
    T.makeTranslation(r.x, r.y, r.z); R.makeRotationY(r.yaw); M.multiplyMatrices(T, R);
    if (put(rats, C1)) { stats.rats += 1; stats.triangles += 40; }
  }
  //: A lead from (x1, y1, z1) to (x2, y2, z2).
  const A3 = new THREE.Vector3(), B3 = new THREE.Vector3(), Q = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, -1), ONE = new THREE.Vector3();
  function lead(x1, y1, z1, x2, y2, z2) {
    A3.set(x1, y1, z1); B3.set(x2 - x1, y2 - y1, z2 - z1);
    const L = B3.length(); if (L < 0.05 || L > 8) return;
    Q.setFromUnitVectors(FWD, B3.multiplyScalar(1 / L)); M.compose(A3, Q, ONE.set(1, 1, L));
    put(leads, null);
  }
  function begin(t) { clock = t; for (const m of all) n.set(m, 0); stats.full = stats.mid = stats.low = stats.birds = stats.rats = stats.triangles = 0; }
  function end() {
    for (const m of all) { const k = n.get(m); if (m.count !== k || k) { m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }
    // (A species' parts with none drawn this frame are left out of the draw altogether.)
    for (const m of imported) m.visible = n.get(m) > 0;
  }
  return { begin, end, quadruped, bird, rat, lead, stats: () => ({ ...stats }), meshes: all,
    triangles: TRI, birdModels: () => Object.fromEntries([...models].map(([sp, m]) => [sp, m ? "loaded" : m === null ? "loading" : "failed"])) };
}
