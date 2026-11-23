// The living city's bought-in cars, second stage: the web files.
//
//   node scripts/build_city_cars.mjs --raw <folder of scripts/blender_city_cars.py's output> \
//        --modules <a folder with node_modules/@gltf-transform/*, meshoptimizer and sharp> \
//        [--fleet docs/city/models/fleet]
//
// (The tools are not the repository's own: as for scripts/build_city_fleet.mjs, install them in a
// scratch folder -- npm install @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1
// @gltf-transform/functions@4.1.1 meshoptimizer sharp -- and pass it as --modules.)
//
// Each car of scripts/city_cars.json comes from Blender as three files of parts (body, trim,
// metal, tyre, interior, lamp, glass), each part with the download's own materials. Here each part
// becomes one mesh the page draws in one call: its materials' colours -- and their pictures,
// sampled where each vertex sits -- baked into one colour per vertex (the paint white, with a
// ``_PAINT`` weight of 1: the page paints it each car's own colour, vehicles.mjs fleetMaterial),
// the glass one see-through colour. The coarse files are simplified to their budgets
// (meshoptimizer, error-bounded); everything is quantised and meshopt-compressed as the fleet is.
// ``cars.json`` records each car's size, triangles, source and licence, and its popularity.
//
// With --fleet, the imported fleet's models are given the same coarse file (``<id>-mid.glb``,
// from their traffic copy): the tier the code-built bodies used to draw.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith("--") ? [...out, [a.slice(2), all[i + 1]]] : out), []));
for (const k of ["raw", "modules"]) if (!args[k]) throw new Error(`--${k} is needed`);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const need = createRequire(join(resolve(args.modules), "package.json"));
const load = async (name) => import(pathToFileURL(need.resolve(name)).href);
const { NodeIO, Document } = await load("@gltf-transform/core");
const { ALL_EXTENSIONS } = await load("@gltf-transform/extensions");
const { weld, dedup, prune, simplify, meshopt } = await load("@gltf-transform/functions");
const { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } = await load("meshoptimizer");
const sharp = (await load("sharp")).default;
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const CONFIG = JSON.parse(readFileSync(join(ROOT, "scripts/city_cars.json"), "utf8"));
const OUT = join(ROOT, "docs/city/models/cars");
mkdirSync(OUT, { recursive: true });
//: What each coarse file's parts are made of (as scripts/blender_city_cars.py merges them).
const MERGED = { npc: { trim: ["trim", "interior", "lamp"] }, mid: { trim: ["trim", "tyre", "metal", "lamp"] } };
//: How far (a share of the part's size) the simplifier may move the surface: the traffic nearest
//: you a little, the cars further off more.
const ERROR = { npc: 0.006, mid: 0.02 };
//: The surface each part is (its material's looks, as the page's own parts are drawn).
const LOOK = {
  body: { metallic: 0.45, roughness: 0.38 }, trim: { metallic: 0, roughness: 0.75 }, metal: { metallic: 0.9, roughness: 0.3 },
  tyre: { metallic: 0, roughness: 0.92 }, interior: { metallic: 0, roughness: 0.85 }, lamp: { metallic: 0.1, roughness: 0.25 },
  glass: { metallic: 0.6, roughness: 0.08 },
};
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

//: A texture's pixels, decoded once.
const pictures = new Map();
async function picture(texture) {
  if (!pictures.has(texture)) {
    const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    pictures.set(texture, { data, w: info.width, h: info.height });
  }
  return pictures.get(texture);
}

//: One part's triangles from every primitive of every node named ``<lod>:<part>``: positions and
//: normals in the file's frame, a linear colour per vertex.
async function gather(doc) {
  const parts = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const part = node.getName().split(":").pop().replace(/\.\d+$/, "");
    const m = node.getWorldMatrix();
    const g = parts.get(part) || { pos: [], nor: [], col: [], idx: [] };
    parts.set(part, g);
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute("POSITION"), N = prim.getAttribute("NORMAL"), T = prim.getAttribute("TEXCOORD_0");
      const mat = prim.getMaterial(), base = mat?.getBaseColorFactor() || [1, 1, 1, 1];
      const tex = mat?.getBaseColorTexture(), pic = tex && T ? await picture(tex) : null;
      const start = g.pos.length / 3, v = [0, 0, 0], n = [0, 0, 0], uv = [0, 0];
      for (let i = 0; i < P.getCount(); i += 1) {
        P.getElement(i, v);
        g.pos.push(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
        if (N) { N.getElement(i, n); const x = m[0] * n[0] + m[4] * n[1] + m[8] * n[2], y = m[1] * n[0] + m[5] * n[1] + m[9] * n[2], z = m[2] * n[0] + m[6] * n[1] + m[10] * n[2], l = Math.hypot(x, y, z) || 1; g.nor.push(x / l, y / l, z / l); } else g.nor.push(0, 1, 0);
        let r = base[0], gg = base[1], b = base[2];
        if (pic) {
          T.getElement(i, uv);
          const px = ((Math.floor((uv[0] - Math.floor(uv[0])) * pic.w) % pic.w) + pic.w) % pic.w, py = ((Math.floor((uv[1] - Math.floor(uv[1])) * pic.h) % pic.h) + pic.h) % pic.h;
          const k = (py * pic.w + px) * 4;
          r *= srgbToLinear(pic.data[k] / 255); gg *= srgbToLinear(pic.data[k + 1] / 255); b *= srgbToLinear(pic.data[k + 2] / 255);
        }
        g.col.push(r, gg, b);
      }
      const I = prim.getIndices();
      if (I) for (let i = 0; i < I.getCount(); i += 1) g.idx.push(start + I.getScalar(i));
      else for (let i = 0; i < P.getCount(); i += 1) g.idx.push(start + i);
    }
  }
  return parts;
}

//: The same vertex once (where it is, its colour; its normals averaged): the simplifier collapses
//: edges between vertices, and a seam's two copies would hold it open.
function welded(g) {
  const key = new Map(), pos = [], nor = [], col = [], remap = new Int32Array(g.pos.length / 3);
  for (let i = 0; i < g.pos.length / 3; i += 1) {
    const k = [0, 1, 2].map((a) => Math.round(g.pos[i * 3 + a] * 2000)).join(",") + "|" + [0, 1, 2].map((a) => Math.round(g.col[i * 3 + a] * 40)).join(",");
    let j = key.get(k);
    if (j === undefined) { j = pos.length / 3; key.set(k, j); pos.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]); nor.push(0, 0, 0); col.push(g.col[i * 3], g.col[i * 3 + 1], g.col[i * 3 + 2]); }
    nor[j * 3] += g.nor[i * 3]; nor[j * 3 + 1] += g.nor[i * 3 + 1]; nor[j * 3 + 2] += g.nor[i * 3 + 2];
    remap[i] = j;
  }
  for (let j = 0; j < nor.length; j += 3) { const l = Math.hypot(nor[j], nor[j + 1], nor[j + 2]) || 1; nor[j] /= l; nor[j + 1] /= l; nor[j + 2] /= l; }
  return { pos, nor, col, idx: g.idx.map((i) => remap[i]) };
}

//: ``g`` simplified towards ``target`` triangles, no further than ``error`` allows; its unused
//: vertices dropped.
function simplified(g, target, error) {
  const w = welded(g);
  // A part in many small pieces (rims, bolts, grilles) stops short of its budget within the
  // error allowed; it is allowed more, a step at a time, up to eight times as much.
  const I = Uint32Array.from(w.idx), P = Float32Array.from(w.pos);
  let idx = I;
  for (let e = error; e <= error * 8 + 1e-9; e *= 2) {
    [idx] = MeshoptSimplifier.simplify(I, P, 3, Math.max(3, target * 3), e);
    if (idx.length <= target * 3 * 1.25) break;
  }
  // Still far over (a grille of a thousand separate bars): the bars are let run together.
  if (idx.length > target * 3 * 1.5) [idx] = MeshoptSimplifier.simplifySloppy(I, P, 3, null, Math.max(3, target * 3), error * 8);
  const used = new Map(), pos = [], nor = [], col = [], out = [];
  for (const i of idx) {
    let j = used.get(i);
    if (j === undefined) { j = pos.length / 3; used.set(i, j); pos.push(w.pos[i * 3], w.pos[i * 3 + 1], w.pos[i * 3 + 2]); nor.push(w.nor[i * 3], w.nor[i * 3 + 1], w.nor[i * 3 + 2]); col.push(w.col[i * 3], w.col[i * 3 + 1], w.col[i * 3 + 2]); }
    out.push(j);
  }
  return { pos, nor, col, idx: out };
}

const cars = {};
for (const [id, car] of Object.entries(CONFIG.cars)) {
  const record = { title: car.title, kind: car.kind, maker_dims: car.dims, source: car.source, popularity: car.popularity, lods: {} };
  for (const lod of ["full", "npc", "mid"]) {
    const src = join(resolve(args.raw), `${id}-${lod}.raw.glb`);
    const parts = await gather(await io.read(src));
    const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
    const tris = {};
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const [part, raw] of parts) {
      const budget = lod === "full" ? Infinity : (MERGED[lod][part] || [part]).reduce((s, p) => s + (CONFIG.budgets[lod][p] || 0), 0);
      const g = raw.idx.length / 3 > budget ? simplified(raw, budget, ERROR[lod]) : raw;
      if (!g.idx.length) continue;
      tris[part] = g.idx.length / 3;
      for (let i = 0; i < g.pos.length; i += 3) for (let a = 0; a < 3; a += 1) { lo[a] = Math.min(lo[a], g.pos[i + a]); hi[a] = Math.max(hi[a], g.pos[i + a]); }
      const n = g.pos.length / 3;
      const prim = doc.createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(Float32Array.from(g.pos)).setBuffer(buffer))
        .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(Float32Array.from(g.nor)).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(n > 65535 ? Uint32Array.from(g.idx) : Uint16Array.from(g.idx)).setBuffer(buffer));
      const look = LOOK[part] || LOOK.trim, material = doc.createMaterial(part).setMetallicFactor(look.metallic).setRoughnessFactor(look.roughness);
      if (part === "glass") {
        // One see-through colour: the panes' own, averaged (a tinted windscreen stays tinted).
        let r = 0, gg = 0, b = 0;
        for (let i = 0; i < g.col.length; i += 3) { r += g.col[i]; gg += g.col[i + 1]; b += g.col[i + 2]; }
        const k = 3 / g.col.length, dim = (c) => Math.min(0.25, c * k);
        material.setBaseColorFactor([dim(r), dim(gg), dim(b), 0.45]).setAlphaMode("BLEND");
      } else if (part === "body") {
        prim.setAttribute("_PAINT", doc.createAccessor().setType("SCALAR").setArray(new Float32Array(n).fill(1)).setBuffer(buffer));
        prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(new Float32Array(n * 3).fill(1)).setBuffer(buffer));
      } else {
        prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(Float32Array.from(g.col)).setBuffer(buffer));
      }
      prim.setMaterial(material);
      scene.addChild(doc.createNode(part).setMesh(doc.createMesh(part).addPrimitive(prim)));
    }
    await doc.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const file = join(OUT, `${id}-${lod}.glb`);
    await io.write(file, doc);
    record.lods[lod] = { file: `${id}-${lod}.glb`, bytes: statSync(file).size, triangles: Object.values(tris).reduce((a, b) => a + b, 0), parts: tris };
    if (lod === "full") record.dims = [0, 1, 2].map((a) => +(hi[a] - lo[a]).toFixed(3));
    console.log(id, lod, record.lods[lod].triangles, "triangles", record.lods[lod].bytes, "bytes");
  }
  cars[id] = record;
}
writeFileSync(join(OUT, "cars.json"), JSON.stringify({
  basis: "scripts/blender_city_cars.py then scripts/build_city_cars.mjs from scripts/city_cars.json; front -z, wheels on y = 0, metres; dims are the drawn model's width, height (to its roof or rails) and length, mirrors included",
  popularity_basis: CONFIG.about, cars,
}, null, 1) + "\n");

// ---- the imported fleet's coarse file ---------------------------------------------------------------
if (args.fleet) {
  const FLEET = resolve(args.fleet), MID_TRIANGLES = 1600, CRACKED = new Set(["jeep", "truck"]);
  const fleet = JSON.parse(readFileSync(join(FLEET, "fleet.json"), "utf8"));
  for (const [id, v] of Object.entries(fleet.vehicles)) {
    // From the traffic's own file -- the full one for the models whose LOD1 is cracked open along
    // its seams (docs/city/vehicles.mjs FULL_FOR_TRAFFIC: the Jeep and the truck).
    const tier = CRACKED.has(id) ? "full" : "npc", from = `${id}-${tier}.glb`;
    if (!existsSync(join(FLEET, from)) || !v[tier]) continue;
    const doc = await io.read(join(FLEET, from));
    const ratio = Math.min(1, MID_TRIANGLES / v[tier].triangles);
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: ERROR.mid }), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const file = join(FLEET, `${id}-mid.glb`);
    await io.write(file, doc);
    let t = 0;
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
    v.mid = { file: `${id}-mid.glb`, bytes: statSync(file).size, triangles: Math.round(t), groups: v[tier].groups, from: from };
    console.log("fleet", id, "mid", Math.round(t), "triangles");
  }
  writeFileSync(join(FLEET, "fleet.json"), JSON.stringify(fleet, null, 1) + "\n");
}
