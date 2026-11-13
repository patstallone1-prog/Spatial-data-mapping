// The living city's vehicles from the user's imported fleet (Imported_Unreal_Fleet_Final.zip) and
// bicycle (Voltage_MTB_Unreal_Optimized_One_Bike.zip), made small enough for the web.
//
//   node scripts/build_city_fleet.mjs --fleet <unzipped fleet>/Ready_GLB --bike <unzipped bike> \
//        --modules <a folder with node_modules/@gltf-transform/*, meshoptimizer and sharp> \
//        --out docs/city/models/fleet
//
// The tools are not the repository's own: install them in a scratch folder first
// (npm install @gltf-transform/core@4.1.1 @gltf-transform/extensions@4.1.1
//  @gltf-transform/functions@4.1.1 meshoptimizer sharp) and pass it as --modules.
//
// Each vehicle is written twice: ``<id>-npc.glb`` for the traffic nearest you (the pack's LOD1, the
// Porsche simplified further: its LOD1 is 81,000 triangles) and ``<id>-full.glb`` for the one you
// drive or ride (the pack's full model, inside and all). Every one is baked the same way:
//   - turned to face -z (the page's front), centred, its wheels on y = 0, in metres as it was;
//   - its parts merged by what they are drawn with: ``body`` (colour per vertex from each part's
//     own material, and a ``_PAINT`` weight of 1 on the paintable body), an atlas per photographic
//     texture (its paint mask, where the pack gave one, in the texture's alpha), and ``glass``;
//   - textures at most 1024 pixels and WebP; geometry quantised and meshopt-compressed
//     (EXT_meshopt_compression: the page's GLTFLoader is given the decoder).
// The bicycle is the pack's LOD3 only (the others are 12 and 26 MB), its textures sampled into
// vertex colours (they are 256 pixels), split into the parts that turn: the frame, each wheel, the
// crank and each pedal, each about its own pivot. ``fleet.json`` records what each came to: its
// size, its triangles, the bicycle's saddle, grips, pedals and axles, and the bus's sign.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith("--") ? [...out, [a.slice(2), all[i + 1]]] : out), []));
for (const k of ["fleet", "bike", "modules", "out"]) if (!args[k]) throw new Error(`--${k} is needed`);
const need = createRequire(join(resolve(args.modules), "package.json"));
const load = async (name) => import(pathToFileURL(need.resolve(name)).href);
const { NodeIO, Document } = await load("@gltf-transform/core");
const { ALL_EXTENSIONS, EXTTextureWebP } = await load("@gltf-transform/extensions");
const { weld, dedup, prune, simplify, meshopt, getBounds } = await load("@gltf-transform/functions");
const { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } = await load("meshoptimizer");
const sharp = (await load("sharp")).default;
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const OUT = resolve(args.out);
mkdirSync(OUT, { recursive: true });

//: The vehicles: the city's kind each stands for, the turn that puts its front at -z (the pack's
//: cars face +z, the Porsche and the truck -x), the materials that are its paint, and the
//: texture that carries a paint mask.
const FLEET = {
  cuore: { dir: "Daihatsu_Cuore", kind: "economy", turn: Math.PI, paint: /^METAL_Paintable_Body/ },
  jeep: { dir: "Jeep_Renegade_2016", kind: "suv", turn: Math.PI, paint: /^$/, oneAtlas: true, mask: "Jeep_Paint_Mask.png" },
  porsche: { dir: "Porsche_911", kind: "sports", turn: -Math.PI / 2, paint: /^METAL_Paintable_Body/, full: "Porsche_911_Full_Optimized.glb", simplify: 0.18 },
  truck: { dir: "Delivery_Truck", kind: "box_truck", turn: -Math.PI / 2, paint: /^PAINT_Truck_Cabin/ },
  bus: { dir: "City_Bus", kind: "bus", turn: Math.PI, paint: /^$/, mask: "Bus_Body_Paint_Mask_2048.png", maskOn: /^PAINT_Bus/, flipV: /^PAINT_Bus/,
    stretch: [2.59 / 2.391, 3.1 / 2.699, 12.2 / 8.981], round: /^w_/ },
};
//: The pack's bus is a 9 m midibus; Muni runs 40-foot buses (New Flyer Xcelsior XDE40 and XT40:
//: 12.2-12.5 m long, 2.59 m wide, about 3.1 m to the roof without the trolley gear). It is drawn as
//: one: stretched to that size, its wheels moved with the body but kept round (scaled by its
//: width's share only).
function stretch(prims, [sx, sy, sz], round) {
  for (const p of prims) {
    const n = p.pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    if (round.test(p.node)) { for (let i = 0; i < n; i += 1) { cx += p.pos[i * 3]; cy += p.pos[i * 3 + 1]; cz += p.pos[i * 3 + 2]; } cx /= n; cy /= n; cz /= n; }
    const keep = round.test(p.node);
    for (let i = 0; i < n; i += 1) {
      const k = i * 3;
      if (keep) {
        p.pos[k] = cx * sx + (p.pos[k] - cx) * sx; p.pos[k + 1] = (p.pos[k + 1] - cy) * sx + cy * sx; p.pos[k + 2] = cz * sz + (p.pos[k + 2] - cz) * sx;
      } else {
        p.pos[k] *= sx; p.pos[k + 1] *= sy; p.pos[k + 2] *= sz;
        const a = p.nor[k] / sx, b = p.nor[k + 1] / sy, c = p.nor[k + 2] / sz, l = Math.hypot(a, b, c) || 1;
        p.nor[k] = a / l; p.nor[k + 1] = b / l; p.nor[k + 2] = c / l;
      }
    }
  }
}
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

//: Every primitive of a document in world space after ``turn``: positions, normals, uvs, indices,
//: and its material.
function worldPrims(doc, turn) {
  const c = Math.cos(turn), s = Math.sin(turn);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute("POSITION"), N = prim.getAttribute("NORMAL"), U = prim.getAttribute("TEXCOORD_0"), I = prim.getIndices();
      const n = P.getCount(), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = U ? new Float32Array(n * 2) : null;
      const v = [0, 0, 0], w = [0, 0, 0];
      for (let i = 0; i < n; i += 1) {
        P.getElement(i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        pos[i * 3] = x * c + z * s; pos[i * 3 + 1] = y; pos[i * 3 + 2] = -x * s + z * c;
        if (N) {
          N.getElement(i, w);
          const a = m[0] * w[0] + m[4] * w[1] + m[8] * w[2], b = m[1] * w[0] + m[5] * w[1] + m[9] * w[2], d = m[2] * w[0] + m[6] * w[1] + m[10] * w[2];
          const l = Math.hypot(a, b, d) || 1;
          nor[i * 3] = (a * c + d * s) / l; nor[i * 3 + 1] = b / l; nor[i * 3 + 2] = (-a * s + d * c) / l;
        }
        if (uv) { U.getElement(i, w); uv[i * 2] = w[0]; uv[i * 2 + 1] = w[1]; }
      }
      const idx = I ? Uint32Array.from(I.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      // Some of the pack's meshes carry no normals (the Daihatsu's, the Porsche's): smooth ones
      // from the faces round each point (area-weighted, the vertices at one place -- the
      // Porsche's are one to a face -- taken together).
      if (!N) {
        const key = (i) => `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`;
        const sum = new Map();
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
          const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
          const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          for (const q of [idx[t], idx[t + 1], idx[t + 2]]) {
            const k = key(q), s = sum.get(k) || [0, 0, 0];
            s[0] += nx; s[1] += ny; s[2] += nz; sum.set(k, s);
          }
        }
        for (let i = 0; i < n; i += 1) {
          const s = sum.get(key(i)) || [0, 1, 0], l = Math.hypot(s[0], s[1], s[2]) || 1;
          nor[i * 3] = s[0] / l; nor[i * 3 + 1] = s[1] / l; nor[i * 3 + 2] = s[2] / l;
        }
      }
      out.push({ node: node.getName(), parent: node.getParentNode()?.getName() || "", material: prim.getMaterial(), pos, nor, hasNormals: Boolean(N), uv, idx });
    }
  }
  return out;
}
//: The box round a list of world prims.
function boundsOf(prims) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], p.pos[i + k]); max[k] = Math.max(max[k], p.pos[i + k]); }
  return { min, max };
}
function shift(prims, dx, dy, dz) { for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) { p.pos[i] += dx; p.pos[i + 1] += dy; p.pos[i + 2] += dz; } }

//: The paint mask's 0 in a texture's alpha (docs/city/vehicles.mjs fleetMaterial takes it off).
const ALPHA_FLOOR = 8;
//: A WebP of at most ``size`` pixels square from an image, with ``mask`` (any image) as its alpha.
async function webp(image, size, mask = null) {
  // (Each step its own pipeline: sharp orders a pipeline's operations itself, and its
  // removeAlpha ran after the joined mask.)
  const rgb = await sharp(Buffer.from(image)).removeAlpha().resize(size, size, { fit: "fill" }).raw().toBuffer();
  if (!mask) return sharp(rgb, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 82, effort: 6 }).toBuffer();
  const alpha = await sharp(mask).greyscale().resize(size, size, { fit: "fill" }).raw().toBuffer();
  const rgba = Buffer.alloc(size * size * 4);
  // The mask from ALPHA_FLOOR up, never 0: WebP throws away the colour under a fully clear
  // pixel, and the unpainted parts (the window band, the front's grille) are the colour.
  for (let i = 0; i < size * size; i += 1) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = ALPHA_FLOOR + Math.round(alpha[i] * (255 - ALPHA_FLOOR) / 255); }
  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).webp({ quality: 82, alphaQuality: 100, effort: 6 }).toBuffer();
}

//: One merged primitive per group into a new document.
async function writeGroups(groups, file, { simplifyRatio = 0, texSize = 1024 } = {}) {
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = doc.createBuffer();
  const scene = doc.createScene("vehicle");
  for (const g of groups) {
    const n = g.pos.length / 3;
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(g.pos).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(n > 65535 ? g.idx : Uint16Array.from(g.idx)).setBuffer(buffer));
    prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(g.nor).setBuffer(buffer));
    if (g.uv) prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(g.uv).setBuffer(buffer));
    if (g.col) prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(g.col).setBuffer(buffer));
    if (g.paint) prim.setAttribute("_PAINT", doc.createAccessor().setType("SCALAR").setArray(g.paint).setBuffer(buffer));
    const mat = doc.createMaterial(g.name).setMetallicFactor(g.metal ?? 0.2).setRoughnessFactor(g.rough ?? 0.6).setExtras(g.extras || {});
    if (g.glass) mat.setBaseColorFactor(g.glass).setAlphaMode("BLEND").setDoubleSided(true);
    if (g.image) mat.setBaseColorTexture(doc.createTexture(g.name).setMimeType("image/webp").setImage(await webp(g.image, texSize, g.mask)));
    prim.setMaterial(mat);
    scene.addChild(doc.createNode(g.name).setMesh(doc.createMesh(g.name).addPrimitive(prim)));
  }
  await doc.transform(weld(), ...(simplifyRatio ? [simplify({ simplifier: MeshoptSimplifier, ratio: simplifyRatio, error: 0.01 })] : []), dedup(), prune(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await io.write(file, doc);
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  return { bytes: statSync(file).size, triangles: tris };
}

//: Groups of a vehicle's prims: the colour-per-vertex body, one per atlas, and the glass.
async function groupVehicle(prims, spec, folder) {
  const groups = new Map();
  const group = (key, init) => { if (!groups.has(key)) groups.set(key, { name: key, pos: [], nor: [], idx: [], uv: null, col: null, paint: null, ...init }); return groups.get(key); };
  let atlasMain = null;
  for (const p of prims) {
    const mat = p.material, name = mat?.getName() || "", tex = mat?.getBaseColorTexture();
    const glass = /^GLASS/.test(name) || mat?.getAlphaMode() === "BLEND";
    let g;
    if (glass) g = group("glass", { glass: mat.getBaseColorFactor(), metal: 0.1, rough: 0.12 });
    else if (tex) {
      const key = spec.oneAtlas ? "atlas" : `atlas-${sha(tex.getImage()).slice(0, 8)}`;
      const masked = spec.mask && (spec.oneAtlas || (spec.maskOn && spec.maskOn.test(name)));
      const image = masked && spec.dir === "Jeep_Renegade_2016" ? readFileSync(join(folder, "car_jeep_ren.jpg")) : tex.getImage();
      g = group(masked ? "paint-atlas" : key, { uv: [], image, mask: masked ? readFileSync(join(folder, spec.mask)) : null, metal: mat.getMetallicFactor(), rough: mat.getRoughnessFactor(), extras: masked ? { paintInAlpha: true } : {} });
      if (masked) atlasMain = g;
    } else g = group("body", { col: [], paint: [], metal: 0.45, rough: 0.4 });
    const base = g.pos.length / 3;
    for (let i = 0; i < p.pos.length; i += 1) g.pos.push(p.pos[i]);
    for (let i = 0; i < p.nor.length; i += 1) g.nor.push(p.nor[i]);
    for (const k of p.idx) g.idx.push(base + k);
    const count = p.pos.length / 3;
    if (g.uv) for (let i = 0; i < count * 2; i += 1) g.uv.push(p.uv ? p.uv[i] : 0);
    if (g.col) {
      const f = mat ? mat.getBaseColorFactor() : [0.5, 0.5, 0.5, 1], paint = spec.paint.test(name) ? 1 : 0;
      for (let i = 0; i < count; i += 1) { g.col.push(f[0], f[1], f[2]); g.paint.push(paint); }
    }
  }
  void atlasMain;
  return [...groups.values()].map((g) => ({ ...g, pos: Float32Array.from(g.pos), nor: Float32Array.from(g.nor), idx: Uint32Array.from(g.idx), uv: g.uv && Float32Array.from(g.uv), col: g.col && Float32Array.from(g.col), paint: g.paint && Float32Array.from(g.paint) }))
    .sort((a, b) => (a.name === "glass") - (b.name === "glass"));
}

const manifest = { basis: "scripts/build_city_fleet.mjs from the user's Imported_Unreal_Fleet_Final and Voltage_MTB packs; front -z, wheels on y = 0, metres", vehicles: {}, bike: null };

for (const [id, spec] of Object.entries(FLEET)) {
  const folder = join(args.fleet, spec.dir);
  const entry = { kind: spec.kind };
  // The box from the full model: the one the city's size for the kind is.
  let frame = null;
  for (const [tier, src] of [["full", spec.full || "FULL.glb"], ["npc", "LOD1.glb"]]) {
    const doc = await io.read(join(folder, src));
    const prims = worldPrims(doc, spec.turn);
    if (spec.stretch) stretch(prims, spec.stretch, spec.round);
    // The bus's bodywork carries its uvs upside down (v from the bottom, as the pack's Unreal
    // export left it): drawn as they are, its left side takes the window-frame strip at the
    // atlas's foot and comes out black. Turned over, both sides fall on their own panels.
    if (spec.flipV) for (const p of prims) if (p.uv && spec.flipV.test(p.material?.getName() || "")) for (let i = 1; i < p.uv.length; i += 2) p.uv[i] = 1 - p.uv[i];
    if (!frame) {
      const b = boundsOf(prims);
      frame = { dx: -(b.min[0] + b.max[0]) / 2, dy: -b.min[1], dz: -(b.min[2] + b.max[2]) / 2 };
      entry.dims = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +v.toFixed(3));
    }
    shift(prims, frame.dx, frame.dy, frame.dz);
    if (tier === "full") {
      // The bus's destination sign: the front's top band, where the glass ends (measured here
      // from the glass and the body, recorded for the page's lit sign).
      if (id === "bus") {
        const glass = prims.filter((p) => /^GLASS/.test(p.material?.getName() || ""));
        const body = prims.filter((p) => /^PAINT_Bus/.test(p.material?.getName() || ""));
        const gb = boundsOf(glass), bb = boundsOf(body);
        let frontGlassTop = -Infinity, frontX = 0;
        for (const p of glass) for (let i = 0; i < p.pos.length; i += 3) if (p.pos[i + 2] < gb.min[2] + 0.25) { frontGlassTop = Math.max(frontGlassTop, p.pos[i + 1]); frontX = Math.max(frontX, Math.abs(p.pos[i])); }
        entry.sign = { front_z: +bb.min[2].toFixed(3), glass_top_y: +frontGlassTop.toFixed(3), roof_y: +bb.max[1].toFixed(3), half_width: +frontX.toFixed(3) };
      }
    }
    const groups = await groupVehicle(prims, spec, folder);
    const file = join(OUT, `${id}-${tier}.glb`);
    const r = await writeGroups(groups, file, { simplifyRatio: tier === "npc" ? spec.simplify || 0 : 0, texSize: 1024 });
    entry[tier] = { file: `${id}-${tier}.glb`, ...r, groups: groups.map((g) => g.name) };
    console.log(id, tier, r);
  }
  manifest.vehicles[id] = entry;
}

// ---- the bicycle --------------------------------------------------------------------------------
{
  const doc = await io.read(join(args.bike, "Models/Voltage_MTB_LOD3_Distant.glb"));
  const pivots = JSON.parse(readFileSync(join(args.bike, "Metadata/Voltage_MTB_Assembly_Pivots.json"), "utf8")).pivots_m;
  const turn = Math.PI / 2;   // the pack's front is +x
  const prims = worldPrims(doc, turn);
  const b = boundsOf(prims);
  const dx = -(b.min[0] + b.max[0]) / 2, dy = -b.min[1], dz = -(b.min[2] + b.max[2]) / 2;
  shift(prims, dx, dy, dz);
  const place = ([x, y, z]) => [x * Math.cos(turn) + z * Math.sin(turn) + dx, y + dy, -x * Math.sin(turn) + z * Math.cos(turn) + dz].map((v) => +v.toFixed(4));
  const P = Object.fromEntries(Object.entries(pivots).map(([k, v]) => [k, place(v)]));
  // The textures, to sample into vertex colours; the masks, to sample the paint.
  const pixels = new Map();
  const raw = async (key, buf) => {
    if (!pixels.has(key)) { const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); pixels.set(key, { data, w: info.width, h: info.height }); }
    return pixels.get(key);
  };
  const frameMask = await raw("frame-mask", readFileSync(join(args.bike, "Textures/Frame_Paint_Mask.png")));
  const forkMask = await raw("fork-mask", readFileSync(join(args.bike, "Textures/Fork_Paint_Mask.png")));
  const at = (img, u, v, ch = 0) => {
    const x = Math.min(img.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.w))), y = Math.min(img.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.h)));
    return img.data[(y * img.w + x) * 4 + ch] / 255;
  };
  const partOf = (p) => (/^Front_Wheel/.test(p.node) ? "wheel_front" : /^Rear_Wheel/.test(p.node) ? "wheel_rear" : /^Cranks/.test(p.node) ? "crank"
    : /^PedalL/.test(p.node) ? "pedal_left" : /^PedalR/.test(p.node) ? "pedal_right" : "frame");
  const pivotOf = { frame: [0, 0, 0], wheel_front: P.front_axle, wheel_rear: P.rear_axle, crank: P.crankset, pedal_left: P.left_pedal, pedal_right: P.right_pedal };
  const groups = new Map();
  let saddle = null;
  const grips = [];
  for (const p of prims) {
    const part = partOf(p), mat = p.material, name = mat?.getName() || "", tex = mat?.getBaseColorTexture();
    const img = tex ? await raw(sha(tex.getImage()), Buffer.from(tex.getImage())) : null, f = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    const mask = /^PAINT_Frame_Masked/.test(name) ? frameMask : /^PAINT_Fork_Accent/.test(name) ? forkMask : null;
    if (!groups.has(part)) groups.set(part, { name: part, pos: [], nor: [], idx: [], col: [], paint: [], metal: 0.3, rough: 0.5 });
    const g = groups.get(part), base = g.pos.length / 3, [ox, oy, oz] = pivotOf[part], n = p.pos.length / 3;
    for (let i = 0; i < n; i += 1) {
      g.pos.push(p.pos[i * 3] - ox, p.pos[i * 3 + 1] - oy, p.pos[i * 3 + 2] - oz);
      g.nor.push(p.nor[i * 3], p.nor[i * 3 + 1], p.nor[i * 3 + 2]);
      const u = p.uv ? p.uv[i * 2] : 0, v = p.uv ? p.uv[i * 2 + 1] : 0;
      const rgb = img ? [0, 1, 2].map((k) => srgbToLinear(at(img, u, v, k)) * f[k]) : [f[0], f[1], f[2]];
      g.col.push(...rgb);
      g.paint.push(mask && p.uv ? (at(mask, u, v) > 0.5 ? 1 : 0) : 0);
    }
    for (const k of p.idx) g.idx.push(base + k);
    // The saddle's top, and the grips (the bars' rubber at either end).
    if (/^Seat__/.test(p.node)) {
      let top = -Infinity, sx = 0, sz = 0, k = 0;
      for (let i = 0; i < n; i += 1) top = Math.max(top, p.pos[i * 3 + 1]);
      for (let i = 0; i < n; i += 1) if (p.pos[i * 3 + 1] > top - 0.02) { sx += p.pos[i * 3]; sz += p.pos[i * 3 + 2]; k += 1; }
      saddle = [sx / k, top, sz / k];
    }
    if (/^ForkUBars__PLASTIC/.test(p.node)) {
      let maxX = 0;
      for (let i = 0; i < n; i += 1) maxX = Math.max(maxX, Math.abs(p.pos[i * 3]));
      for (const side of [-1, 1]) {
        let sx = 0, sy = 0, sz = 0, k = 0;
        for (let i = 0; i < n; i += 1) if (p.pos[i * 3] * side > maxX - 0.1) { sx += p.pos[i * 3]; sy += p.pos[i * 3 + 1]; sz += p.pos[i * 3 + 2]; k += 1; }
        grips.push([sx / k, sy / k, sz / k]);
      }
    }
  }
  const list = [...groups.values()].map((g) => ({ ...g, pos: Float32Array.from(g.pos), nor: Float32Array.from(g.nor), idx: Uint32Array.from(g.idx), col: Float32Array.from(g.col), paint: Float32Array.from(g.paint) }));
  const r = await writeGroups(list, join(OUT, "bike-npc.glb"));
  const r3 = (a) => a.map((v) => +v.toFixed(4));
  manifest.bike = {
    file: "bike-npc.glb", ...r, dims: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +v.toFixed(3)),
    parts: list.map((g) => g.name), pivots: P, saddle: r3(saddle), grips: grips.map(r3),
    crank_radius: +Math.hypot(P.right_pedal[1] - P.crankset[1], P.right_pedal[2] - P.crankset[2]).toFixed(4),
    wheel_radius: +(P.front_axle[1]).toFixed(4),
  };
  console.log("bike", r, manifest.bike);
}
writeFileSync(join(OUT, "fleet.json"), `${JSON.stringify(manifest, null, 1)}\n`);
