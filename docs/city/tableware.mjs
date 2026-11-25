// Tableware at its real sizes: plates, bowls, cups, mugs and glasses turned on a lathe from their
// profiles, cutlery cut from its outline, and a few things food comes in (a sushi board, a diner's
// basket, a bamboo steamer, a to-go cup, foil). Each drinking vessel carries its inner profile (for
// the liquid in it, eat-play.mjs) and where a hand holds it: a wine glass by its stem, a mug by
// its handle, a pint round its body.
//
// Frames: a vessel stands on its base at the origin, +y up; a handle sticks out along +x; the side
// drunk from is +z. Cutlery lies along +z (its business end, a fork's tines, a knife's blade, at
// +z), handle toward -z, its top face up. Metres throughout.
//
// The sizes are the common ones: a 27 cm dinner plate, a 20 cm ramen bowl, a 12 oz mug, a nonic
// pint (568 ml), a 35 cl wine glass, a 19 cm table fork, a 23 cm dinner knife.

const cache = new WeakMap();
//: Per-THREE shared materials and geometries (one of each made, for every place set).
function shared(THREE) {
  if (!cache.has(THREE)) cache.set(THREE, { geo: new Map(), mat: new Map() });
  return cache.get(THREE);
}
const memo = (THREE, key, make) => { const s = shared(THREE).geo; if (!s.has(key)) s.set(key, make()); return s.get(key); };

//: A canvas texture painted by ``draw(g, w, h)``, or null where there is no canvas (node).
export function paintTexture(THREE, w, h, draw, { repeat = null, srgb = true } = {}) {
  const doc = globalThis.document;
  if (!doc?.createElement) return null;
  const c = doc.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

//: The materials of the table: glazed porcelain (white, a soft glaze shine), stoneware (a mug's
//: speckled glaze), clear glass (thin, bright edges; no transmission pass -- it would draw the
//: scene twice), stainless steel, oiled wood, bamboo, paper, foil, red plastic.
export function tablewareMaterials(THREE) {
  const m = shared(THREE).mat;
  if (m.has("porcelain")) return Object.fromEntries(m);
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  m.set("porcelain", P({ color: 0xf6f4ee, roughness: 0.22, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.08 }));
  m.set("stoneware", P({ color: 0x31475a, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.15,
    map: paintTexture(THREE, 128, 128, (g, w, h) => { g.fillStyle = "#3a5266"; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i += 1) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "20,28,36" : "180,190,200"},${0.15 + Math.random() * 0.25})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }) }));
  m.set("glass", P({ color: 0xf2f8fa, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, depthWrite: false, side: THREE.DoubleSide }));
  m.set("steel", new THREE.MeshStandardMaterial({ color: 0xd9dde0, roughness: 0.18, metalness: 1, side: THREE.DoubleSide }));
  m.set("wood", new THREE.MeshStandardMaterial({ color: 0xb07a48, roughness: 0.6,
    map: paintTexture(THREE, 128, 256, (g, w, h) => { g.fillStyle = "#b5804c"; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 2) { g.fillStyle = `rgba(90,50,22,${0.05 + Math.random() * 0.12})`; g.fillRect(x, 0, 1, h); } }) }));
  m.set("bamboo", new THREE.MeshStandardMaterial({ color: 0xd8bf86, roughness: 0.7,
    map: paintTexture(THREE, 256, 64, (g, w, h) => { g.fillStyle = "#d9c08a"; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 5) { g.fillStyle = `rgba(120,90,40,${0.15 + Math.random() * 0.15})`; g.fillRect(x, 0, 1, h); } }, { repeat: [3, 1] }) }));
  m.set("paper", new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.9 }));
  m.set("checked", new THREE.MeshStandardMaterial({ roughness: 0.9, color: 0xffffff,
    map: paintTexture(THREE, 128, 128, (g, w, h) => { g.fillStyle = "#f4efe4"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(196,40,36,.85)"; for (let i = 0; i < 8; i += 2) { g.fillRect(i * w / 8, 0, w / 8, h); g.fillRect(0, i * h / 8, w, h / 8); } }, { repeat: [2, 2] }) }));
  m.set("kraft", new THREE.MeshStandardMaterial({ color: 0xb98d58, roughness: 0.95 }));
  m.set("lid", new THREE.MeshStandardMaterial({ color: 0xf5f5f3, roughness: 0.4 }));
  m.set("sleeve", new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.95 }));
  m.set("foil", new THREE.MeshStandardMaterial({ color: 0xdcdfe2, roughness: 0.28, metalness: 1, flatShading: true }));
  m.set("plastic_red", new THREE.MeshStandardMaterial({ color: 0xc8231f, roughness: 0.45 }));
  m.set("linen", new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.95 }));
  m.set("slate", new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.85 }));
  m.set("wrap_paper", new THREE.MeshStandardMaterial({ color: 0xece5d3, roughness: 0.9, side: THREE.DoubleSide }));
  return Object.fromEntries(m);
}

const V2 = (THREE, pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
//: Turned on a lathe: ``profile`` [[r, y], ...] from the axis at the bottom, out and up the
//: outside, over the rim and down the inside (so the normals face out of the solid).
export function lathe(THREE, profile, segments = 40) {
  const g = new THREE.LatheGeometry(V2(THREE, profile), segments);
  g.computeVertexNormals();
  return g;
}

// ---- the vessels' profiles ------------------------------------------------------------------------

//: Each vessel: ``outer`` (the lathe profile), ``inner`` ([[r, y]] from the inside bottom up to the
//: rim: where a liquid can be), ``rim`` (the rim's height), ``grip`` (how and where a hand holds
//: it: wrap | stem | handle | pinch, at [x, y, z] in its frame, and the palm's facing), ``ml``.
export const VESSELS = {
  // A 27 cm dinner plate: a foot ring, a shallow well, a rim that rises and turns out.
  plate: { outer: [[0, 0.005], [0.085, 0.005], [0.088, 0], [0.094, 0], [0.097, 0.004], [0.112, 0.011], [0.133, 0.02], [0.136, 0.023], [0.134, 0.025], [0.111, 0.016], [0.096, 0.011], [0.086, 0.0105], [0, 0.0105]], material: "porcelain", top: 0.0105, radius: 0.136 },
  side_plate: { outer: [[0, 0.004], [0.06, 0.004], [0.062, 0], [0.067, 0], [0.07, 0.004], [0.088, 0.015], [0.09, 0.018], [0.088, 0.019], [0.07, 0.01], [0, 0.009]], material: "porcelain", top: 0.009, radius: 0.09 },
  saucer: { outer: [[0, 0.003], [0.04, 0.003], [0.042, 0], [0.046, 0], [0.05, 0.005], [0.068, 0.016], [0.07, 0.018], [0.068, 0.019], [0.05, 0.01], [0.022, 0.008], [0.021, 0.01], [0, 0.01]], material: "porcelain", top: 0.01, radius: 0.07 },
  // A 20 cm ramen bowl, 9 cm deep: a foot, a deep curve, a straight rim.
  ramen_bowl: { outer: [[0, 0.008], [0.036, 0.008], [0.038, 0], [0.044, 0], [0.046, 0.008], [0.07, 0.03], [0.09, 0.06], [0.1, 0.088], [0.1, 0.092], [0.095, 0.092], [0.094, 0.087], [0.085, 0.06], [0.065, 0.033], [0.042, 0.016], [0, 0.013]], inner: [[0, 0.013], [0.042, 0.016], [0.065, 0.033], [0.085, 0.06], [0.094, 0.087]], rim: 0.092, material: "porcelain", ml: 1100, grip: { kind: "wrap", at: [0, 0.04, -0.085], palm: [0, 0, 1] } },
  // A 16 cm soup or rice bowl.
  bowl: { outer: [[0, 0.006], [0.028, 0.006], [0.03, 0], [0.036, 0], [0.038, 0.007], [0.058, 0.025], [0.074, 0.05], [0.08, 0.066], [0.08, 0.07], [0.076, 0.07], [0.075, 0.065], [0.068, 0.049], [0.053, 0.027], [0.034, 0.012], [0, 0.01]], inner: [[0, 0.01], [0.034, 0.012], [0.053, 0.027], [0.068, 0.049], [0.075, 0.065]], rim: 0.07, material: "porcelain", ml: 600, grip: { kind: "wrap", at: [0, 0.035, -0.07], palm: [0, 0, 1] } },
  // A 12 oz diner mug, a handle on its side.
  mug: { outer: [[0, 0.003], [0.036, 0.003], [0.038, 0], [0.041, 0.004], [0.042, 0.05], [0.042, 0.096], [0.041, 0.098], [0.038, 0.098], [0.037, 0.094], [0.037, 0.012], [0, 0.01]], inner: [[0, 0.01], [0.037, 0.012], [0.037, 0.094]], rim: 0.098, material: "stoneware", ml: 350, handle: { from: 0.078, to: 0.024, out: 0.032, r: 0.006 }, grip: { kind: "handle", at: [0.068, 0.052, 0], palm: [-1, 0, 0] } },
  // A cappuccino cup on its saucer: a rounded bowl on a little foot.
  cup: { outer: [[0, 0.002], [0.02, 0.002], [0.022, 0], [0.026, 0.004], [0.036, 0.016], [0.044, 0.035], [0.047, 0.058], [0.047, 0.062], [0.044, 0.062], [0.043, 0.057], [0.04, 0.035], [0.032, 0.017], [0.02, 0.009], [0, 0.008]], inner: [[0, 0.008], [0.02, 0.009], [0.032, 0.017], [0.04, 0.035], [0.043, 0.057]], rim: 0.062, material: "porcelain", ml: 180, handle: { from: 0.052, to: 0.02, out: 0.024, r: 0.0045 }, grip: { kind: "handle", at: [0.062, 0.038, 0], palm: [-1, 0, 0] }, saucer: true },
  // A nonic pint: a heavy base, the bulge a third down from the rim.
  pint: { outer: [[0, 0], [0.029, 0], [0.031, 0.002], [0.034, 0.05], [0.04, 0.115], [0.0435, 0.126], [0.0415, 0.134], [0.043, 0.15], [0.041, 0.15], [0.0395, 0.134], [0.0415, 0.126], [0.038, 0.115], [0.0315, 0.05], [0.028, 0.012], [0, 0.012]], inner: [[0, 0.012], [0.028, 0.012], [0.0315, 0.05], [0.038, 0.115], [0.0415, 0.126], [0.0395, 0.134], [0.041, 0.15]], rim: 0.15, material: "glass", ml: 568, grip: { kind: "wrap", at: [0, 0.07, -0.036], palm: [0, 0, 1] } },
  // A red wine glass: foot, stem, a tulip bowl.
  wine: { outer: [[0, 0], [0.037, 0], [0.038, 0.002], [0.006, 0.006], [0.0035, 0.012], [0.0035, 0.09], [0.008, 0.1], [0.03, 0.115], [0.042, 0.14], [0.042, 0.17], [0.034, 0.21], [0.0333, 0.21], [0.041, 0.17], [0.041, 0.14], [0.029, 0.116], [0.008, 0.103], [0, 0.102]], inner: [[0, 0.102], [0.008, 0.103], [0.029, 0.116], [0.041, 0.14], [0.041, 0.17], [0.0333, 0.21]], rim: 0.21, material: "glass", ml: 350, grip: { kind: "stem", at: [0, 0.05, 0], palm: [0, 0, 1] } },
  // A cocktail coupe: a shallow wide bowl on a stem.
  coupe: { outer: [[0, 0], [0.035, 0], [0.036, 0.002], [0.005, 0.006], [0.003, 0.012], [0.003, 0.095], [0.012, 0.102], [0.035, 0.115], [0.05, 0.13], [0.054, 0.14], [0.053, 0.14], [0.049, 0.13], [0.034, 0.116], [0.012, 0.105], [0, 0.104]], inner: [[0, 0.104], [0.012, 0.105], [0.034, 0.116], [0.049, 0.13], [0.053, 0.14]], rim: 0.14, material: "glass", ml: 200, grip: { kind: "stem", at: [0, 0.055, 0], palm: [0, 0, 1] } },
  // A highball (juice, iced tea, water, a soda): straight, a thick base.
  highball: { outer: [[0, 0], [0.032, 0], [0.033, 0.002], [0.034, 0.14], [0.0325, 0.14], [0.0315, 0.012], [0, 0.012]], inner: [[0, 0.012], [0.0315, 0.012], [0.0325, 0.14]], rim: 0.14, material: "glass", ml: 380, grip: { kind: "wrap", at: [0, 0.06, -0.034], palm: [0, 0, 1] } },
  // A soda-fountain glass (a milkshake, a smoothie): a foot and a flared tulip.
  shake: { outer: [[0, 0], [0.034, 0], [0.035, 0.003], [0.012, 0.01], [0.01, 0.03], [0.022, 0.06], [0.035, 0.12], [0.046, 0.19], [0.0445, 0.19], [0.0335, 0.12], [0.0205, 0.062], [0.009, 0.034], [0, 0.034]], inner: [[0, 0.034], [0.009, 0.034], [0.0205, 0.062], [0.0335, 0.12], [0.0445, 0.19]], rim: 0.19, material: "glass", ml: 480, grip: { kind: "wrap", at: [0, 0.09, -0.032], palm: [0, 0, 1] } },
  // A 16 oz paper cup with its lid (a deli's coffee): drunk through the lid's hole.
  togo: { outer: [[0, 0.002], [0.028, 0.002], [0.029, 0], [0.03, 0.004], [0.044, 0.135], [0.0435, 0.135], [0.0295, 0.006], [0, 0.006]], inner: [[0, 0.006], [0.0295, 0.006], [0.0435, 0.135]], rim: 0.135, material: "paper", ml: 470, lid: true, grip: { kind: "wrap", at: [0, 0.06, -0.038], palm: [0, 0, 1] } },
};

//: The vessel a drink is served in, by the dish (and the vessel the kitchen names).
export function vesselFor(dish, served = "cup") {
  const by = { coffee: "mug", deli_coffee: "togo", latte: "cup", tea: "cup", iced_tea: "highball", juice: "highball", smoothie: "shake", milkshake: "shake",
    soda: "highball", water: "highball", beer: "pint", glass_of_wine: "wine", cocktail: "coupe", ramen: "ramen_bowl", pho: "ramen_bowl" };
  return by[dish] || (served === "glass" ? "highball" : served === "bowl" ? "bowl" : served === "cup" ? "mug" : served);
}

//: A handle: a C of tube out from the side (+x) between heights ``from`` and ``to``.
function handleGeometry(THREE, { from, to, out, r }, at) {
  const h = (from - to) / 2;
  const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(at(from) - 0.002, from, 0), new THREE.Vector3(at(from) + out * 1.25, from + h * 0.25, 0),
    new THREE.Vector3(at(to) + out * 1.25, to - h * 0.25, 0), new THREE.Vector3(at(to) - 0.002, to, 0));
  return new THREE.TubeGeometry(curve, 20, r, 8, false);
}
//: The radius of the outer profile at height ``y`` (its outermost there).
function radiusAt(profile, y) {
  let best = 0;
  for (let i = 1; i < profile.length; i += 1) {
    const [r0, y0] = profile[i - 1], [r1, y1] = profile[i];
    if ((y - y0) * (y - y1) <= 0 && y0 !== y1) best = Math.max(best, r0 + (r1 - r0) * (y - y0) / (y1 - y0));
  }
  return best;
}

//: A vessel built: a Group named for it, its spec in ``userData.vessel`` (inner, rim, grip, ml).
export function makeVessel(THREE, kind) {
  const spec = VESSELS[kind];
  if (!spec) throw new Error(`no vessel ${kind}`);
  const M = tablewareMaterials(THREE), g = new THREE.Group();
  g.name = `vessel:${kind}`;
  const body = new THREE.Mesh(memo(THREE, `v:${kind}`, () => lathe(THREE, spec.outer, spec.material === "glass" ? 48 : 40)), M[spec.material]);
  body.castShadow = spec.material !== "glass"; body.receiveShadow = true;
  if (spec.material === "glass") body.renderOrder = 3;
  g.add(body);
  if (spec.handle) {
    const hm = new THREE.Mesh(memo(THREE, `h:${kind}`, () => handleGeometry(THREE, spec.handle, (y) => radiusAt(spec.outer, y))), M[spec.material]);
    hm.castShadow = true; g.add(hm);
  }
  if (spec.saucer) {
    const s = makeVessel(THREE, "saucer");
    s.position.y = -VESSELS.saucer.top + 0.0005; s.name = "saucer"; g.add(s);
    g.userData.saucer = s;
  }
  if (spec.lid) {
    // A sip lid: a domed ring snapped over the rim, a slot to drink from at +z; a card sleeve.
    const lid = new THREE.Mesh(memo(THREE, "lid", () => lathe(THREE, [[0, 0.135], [0.03, 0.137], [0.038, 0.142], [0.045, 0.143], [0.0465, 0.14], [0.0465, 0.133], [0.0445, 0.133]], 40)), M.lid);
    const slot = new THREE.Mesh(memo(THREE, "slot", () => new THREE.BoxGeometry(0.012, 0.002, 0.004)), M.slate);
    slot.position.set(0, 0.1435, 0.039);
    const sleeve = new THREE.Mesh(memo(THREE, "sleeve", () => lathe(THREE, [[0.0385, 0.045], [0.0412, 0.045], [0.0448, 0.1], [0.0421, 0.1]], 40)), M.sleeve);
    g.add(lid, slot, sleeve);
  }
  g.userData.vessel = { kind, ...spec };
  return g;
}

// ---- cutlery ------------------------------------------------------------------------------------------

//: A flat outline [[x, z], ...] cut out ``t`` thick (its top at y = t), its length along +z, then
//: bent: ``bend(z)`` lifts it at each point along (a fork's tines curve up, a spoon's handle).
function cutOut(THREE, outline, t, bend = () => 0, bevel = 0.0006) {
  const s = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);   // the shape's y (-z) to the world's z; the extrusion up
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 1) p.setY(i, p.getY(i) + bend(p.getZ(i)));
  g.computeVertexNormals();
  return g;
}
//: A handle's outline: from its end at -z to its neck, widening to ``w`` at the end.
const handle = (len, w, neck, z0) => {
  const out = [], n = 10;
  for (let i = 0; i <= n; i += 1) { const t = i / n, z = z0 - len + len * t; out.push([((1 - t) * w + t * neck) / 2 * (i === 0 ? 0.6 : 1), z]); }
  return out;
};
//: A table fork, 19 cm: four tines curving up at the end.
function forkGeometry(THREE) {
  const right = [...handle(0.115, 0.022, 0.006, 0.02), [0.0035, 0.03], [0.012, 0.045], [0.0125, 0.075]];
  // The tines: four of 4.3 mm with 2.6 mm slots between, 30 mm long, their tips rounded off.
  const tips = [];
  for (const [a, b] of [[0.0125, 0.0082], [0.0056, 0.0013], [-0.0013, -0.0056], [-0.0082, -0.0125]]) tips.push([a, 0.077], [a, 0.104], [(a + b) / 2, 0.107], [b, 0.104], [b, 0.077]);
  const left = right.map(([x, z]) => [-x, z]).reverse();
  const outline = [...right.slice(0, -1), ...tips, ...left.slice(1)];
  return cutOut(THREE, outline, 0.0018, (z) => (z > 0.04 ? 0.012 * ((z - 0.04) / 0.066) ** 2 : 0) + (z < -0.06 ? 0.004 * ((-0.06 - z) / 0.035) : 0));
}
//: A dinner knife, 23 cm: a rounded blade with a straight spine, a heavier handle.
function knifeGeometry(THREE) {
  const blade = [[0.0055, 0.0], [0.009, 0.03], [0.0095, 0.08], [0.0075, 0.105], [0.0, 0.115], [-0.009, 0.1], [-0.0095, 0.06], [-0.0075, 0.0]];
  const b = cutOut(THREE, blade, 0.0015);
  const h = cutOut(THREE, [[0.0075, -0.115], [0.0095, -0.06], [0.0082, 0.0], [-0.0082, 0.0], [-0.0095, -0.06], [-0.0075, -0.115]], 0.006, () => 0, 0.0025);
  return mergeSimple(THREE, [h, b]);
}
//: A dessert spoon, 18 cm: an oval bowl 4.5 by 3 cm on a curved handle.
function spoonGeometry(THREE) {
  const hd = cutOut(THREE, [...handle(0.12, 0.02, 0.005, 0.0), [0.004, 0.012], [-0.004, 0.012], ...handle(0.12, 0.02, 0.005, 0.0).map(([x, z]) => [-x, z]).reverse()], 0.0018, (z) => (z < -0.05 ? 0.006 * ((-0.05 - z) / 0.07) : 0) + (z > -0.01 ? 0.004 : 0));
  const bowl = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38);
  bowl.scale(0.03, 0.022, 0.046); bowl.translate(0, 0.0101, 0.035);
  return mergeSimple(THREE, [hd, bowl]);
}
//: Chopsticks, a pair 23 cm long, square at the top, tapering to round points.
function chopstickGeometry(THREE) {
  const one = new THREE.CylinderGeometry(0.0018, 0.0035, 0.23, 8); one.rotateX(Math.PI / 2);
  const a = one.clone().translate(0.006, 0.004, 0.0), b = one.clone().translate(-0.006, 0.004, 0.0);
  return mergeSimple(THREE, [a, b]);
}
export function makeUtensil(THREE, kind) {
  const M = tablewareMaterials(THREE);
  const geo = memo(THREE, `u:${kind}`, () => (kind === "fork" ? forkGeometry(THREE) : kind === "knife" ? knifeGeometry(THREE) : kind === "spoon" ? spoonGeometry(THREE) : chopstickGeometry(THREE)));
  const m = new THREE.Mesh(geo, kind === "chopsticks" ? M.bamboo : M.steel);
  m.name = `utensil:${kind}`; m.castShadow = true;
  // Where it is held (the hand's grip), and its working point (the tines' tips, the blade's edge
  // midway, the bowl of the spoon, the chopsticks' points), in its frame.
  m.userData.utensil = { kind, grip: kind === "chopsticks" ? [0, 0.004, -0.06] : [0, 0.004, -0.06], tip: kind === "fork" ? [0, 0.014, 0.1] : kind === "knife" ? [0, 0.001, 0.06] : kind === "spoon" ? [0, 0.004, 0.035] : [0, 0.004, 0.112] };
  return m;
}

//: Non-indexed geometries' positions, normals and uvs end to end in one (the same attributes).
export function mergeSimple(THREE, parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const total = flat.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const out = new THREE.BufferGeometry();
  let k = 0;
  // The parts' material groups kept (a layer's faces one material, its sides another).
  const grouped = flat.some((g) => g.groups.length);
  for (const g of flat) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, k * 3); nor.set(g.attributes.normal.array, k * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, k * 2);
    if (grouped) { if (g.groups.length) for (const q of g.groups) out.addGroup(k + q.start, q.count, q.materialIndex); else out.addGroup(k, g.attributes.position.count, 0); }
    k += g.attributes.position.count;
  }
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return out;
}

// ---- what food comes in -----------------------------------------------------------------------------

//: A sushi board (a geta: a slab on two feet), a pizza board (round, a handle), a diner's red
//: basket lined with checked paper, a bamboo steamer, a paper bag, a slate.
export function makeServer(THREE, kind) {
  const M = tablewareMaterials(THREE), g = new THREE.Group();
  g.name = `server:${kind}`;
  const add = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  if (kind === "board") {
    add(memo(THREE, "geta", () => roundedSlab(THREE, 0.3, 0.16, 0.018, 0.008)), M.wood, 0, 0.022, 0);
    for (const x of [-0.11, 0.11]) add(memo(THREE, "geta-foot", () => new THREE.BoxGeometry(0.02, 0.022, 0.15)), M.wood, x, 0.011, 0);
    g.userData.top = 0.04; g.userData.size = [0.3, 0.16];
  } else if (kind === "pizza_board") {
    add(memo(THREE, "pboard", () => new THREE.CylinderGeometry(0.17, 0.17, 0.016, 48)), M.wood, 0, 0.008, 0);
    add(memo(THREE, "pboard-h", () => roundedSlab(THREE, 0.05, 0.11, 0.016, 0.01)), M.wood, 0, 0.008, -0.215);
    g.userData.top = 0.016; g.userData.size = [0.34, 0.34];
  } else if (kind === "basket") {
    // An oval plastic basket: a woven-looking wall, the paper in it.
    add(memo(THREE, "basket", () => { const b = lathe(THREE, [[0, 0.004], [0.07, 0.004], [0.075, 0], [0.08, 0.004], [0.095, 0.05], [0.098, 0.052], [0.092, 0.052], [0.078, 0.008], [0, 0.008]], 32); b.scale(1.35, 1, 1); return b; }), M.plastic_red);
    add(memo(THREE, "basket-paper", () => { const p = new THREE.PlaneGeometry(0.24, 0.2, 12, 10); p.rotateX(-Math.PI / 2); const a = p.attributes.position; for (let i = 0; i < a.count; i += 1) { const x = a.getX(i), z = a.getZ(i); const d = Math.max(Math.abs(x) / 0.12, Math.abs(z) / 0.1); a.setY(i, d > 0.62 ? (d - 0.62) * 0.11 : 0); } p.computeVertexNormals(); return p; }), M.checked, 0, 0.009, 0);
    g.userData.top = 0.011; g.userData.size = [0.2, 0.15];
  } else if (kind === "steamer") {
    add(memo(THREE, "steamer", () => lathe(THREE, [[0, 0.004], [0.085, 0.004], [0.088, 0], [0.09, 0], [0.09, 0.05], [0.084, 0.05], [0.084, 0.01], [0, 0.01]], 36)), M.bamboo);
    g.userData.top = 0.01; g.userData.size = [0.17, 0.17];
  } else if (kind === "bag") {
    // A kraft paper bag, its top rolled open.
    add(memo(THREE, "bag", () => { const b = new THREE.BoxGeometry(0.13, 0.2, 0.08, 4, 8, 3); const a = b.attributes.position; for (let i = 0; i < a.count; i += 1) { const y = a.getY(i); if (y > 0.07) { a.setX(i, a.getX(i) * (1 + (y - 0.07) * 0.6)); a.setZ(i, a.getZ(i) * (1 + (y - 0.07) * 1.5)); } } b.translate(0, 0.1, 0); b.computeVertexNormals(); return b; }), M.kraft);
    g.userData.top = 0.2; g.userData.size = [0.13, 0.08];
  } else if (kind === "wrap") {
    g.userData.top = 0; g.userData.size = [0.2, 0.2];
  }
  return g;
}
//: A slab w by d, t thick, its corners rounded r (its base at y = 0... centred: from -t/2 to t/2).
export function roundedSlab(THREE, w, d, t, r) {
  const s = new THREE.Shape(), x = w / 2 - r, z = d / 2 - r;
  s.moveTo(-x, -d / 2); s.lineTo(x, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -z); s.lineTo(w / 2, z); s.quadraticCurveTo(w / 2, d / 2, x, d / 2);
  s.lineTo(-x, d / 2); s.quadraticCurveTo(-w / 2, d / 2, -w / 2, z); s.lineTo(-w / 2, -z); s.quadraticCurveTo(-w / 2, -d / 2, -x, -d / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: t - 0.002, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.translate(0, -t / 2 + 0.001, 0);
  g.computeVertexNormals();
  return g;
}

// ---- a place laid at a table ------------------------------------------------------------------------

//: A place laid for one, in the frame of a seat looking along -z at the table's edge (the place's
//: middle ``depth`` m in, on the top at y = 0): a dinner plate, the fork to its left and the knife
//: and spoon to its right, a water glass above the knife, a wine glass beside it at a ``fine``
//: table, a napkin folded under the fork. As {porcelain, glass, steel, linen} geometries (each one
//: merged, so a table of places is a handful of draws). ``segments``: round things' facets (fewer
//: for a house's tables seen across a room).
export function placeSetting(THREE, { fine = false, depth = 0.24, segments = 40 } = {}) {
  const parts = { porcelain: [], glass: [], steel: [], linen: [] };
  const put = (geo, key, x, z, yaw = 0, y = 0) => { const g = geo.clone(); g.rotateY(yaw); g.translate(x, y, z); parts[key].push(g.index ? g.toNonIndexed() : g); };
  put(memo(THREE, `v:plate:${segments}`, () => lathe(THREE, VESSELS.plate.outer, segments)), "porcelain", 0, -depth);
  // The cutlery lies with its business end away from the sitter (-z): turned round.
  put(memo(THREE, "u:fork", () => forkGeometry(THREE)), "steel", -0.17, -depth + 0.01, Math.PI, 0.0025);
  put(memo(THREE, "u:knife", () => knifeGeometry(THREE)), "steel", 0.165, -depth + 0.01, Math.PI);
  if (fine) put(memo(THREE, "u:spoon", () => spoonGeometry(THREE)), "steel", 0.2, -depth + 0.01, Math.PI);
  put(memo(THREE, "napkin", () => { const n = roundedSlab(THREE, 0.1, 0.18, 0.006, 0.004); n.translate(0, 0.003, 0); return n; }), "linen", -0.17, -depth + 0.01);
  put(memo(THREE, `v:highball:${segments}`, () => lathe(THREE, VESSELS.highball.outer, Math.max(12, segments - 8))), "glass", 0.17, -depth - 0.17);
  if (fine) put(memo(THREE, `v:wine:${segments}`, () => lathe(THREE, VESSELS.wine.outer, Math.max(12, segments - 8))), "glass", 0.08, -depth - 0.2);
  const out = {};
  for (const [k, list] of Object.entries(parts)) if (list.length) out[k] = mergeSimple(THREE, list);
  return out;
}

//: A mug as one geometry (its body and handle): for a house's coffee table, in its own material.
export function mugGeometry(THREE, segments = 20) {
  const spec = VESSELS.mug;
  return memo(THREE, `mug:${segments}`, () => mergeSimple(THREE, [lathe(THREE, spec.outer, segments), handleGeometry(THREE, spec.handle, (y) => radiusAt(spec.outer, y))]));
}
//: A fruit bowl's bowl, and the fruit in it: {bowl, fruit} geometries (fruit: oranges and lemons
//: heaped, one geometry with its colours per vertex).
export function fruitBowlGeometry(THREE, segments = 20) {
  return memo(THREE, `fruitbowl:${segments}`, () => {
    const bowl = lathe(THREE, VESSELS.bowl.outer, segments).scale(1.35, 0.9, 1.35);
    const fruit = [], cols = [];
    const at = [[0, 0.055, 0, 0.037, 0xf28a1a], [0.045, 0.05, 0.02, 0.035, 0xf2981f], [-0.04, 0.05, 0.03, 0.034, 0xf0c419], [0.01, 0.05, -0.05, 0.036, 0xf28a1a], [-0.02, 0.09, -0.01, 0.033, 0xe8c21c]];
    for (const [x, y, z, r, c] of at) {
      const g = new THREE.SphereGeometry(r, 12, 9).toNonIndexed();
      g.scale(1, c === 0xf0c419 || c === 0xe8c21c ? 0.8 : 0.95, c === 0xf0c419 || c === 0xe8c21c ? 1.25 : 1);
      g.translate(x, y, z); fruit.push(g);
      const col = new THREE.Color(c);
      for (let i = 0; i < g.attributes.position.count; i += 1) cols.push(col.r, col.g, col.b);
    }
    const f = mergeSimple(THREE, fruit);
    f.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cols), 3));
    return { bowl, fruit: f };
  });
}
