// Pack the Unreal NPC export (tools/unreal/export_npc_characters.py) for the page:
//   node tools/build_npc_characters.mjs <export dir> [docs/city/models/npc]
// Copies the low-detail meshes, folds the three mannequin clips into one animation-only GLB (the
// mannequin's own mesh left out: 13,000 triangles a clip nobody draws), and writes the textures
// the page lays on (downscaled from the MetaHuman's baked 8K/2K maps) with a manifest.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function readGlb(buf) {
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
  const binStart = 20 + len + 8;
  return { json, bin: buf.subarray(binStart, binStart + buf.readUInt32LE(20 + len)) };
}
export function writeGlb(json, bin) {
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const cj = Buffer.alloc(8); cj.writeUInt32LE(j.length, 0); cj.writeUInt32LE(0x4e4f534a, 4);
  const cb = Buffer.alloc(8); cb.writeUInt32LE(b.length, 0); cb.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, cj, j, cb, b]);
}
//: The skeleton of the first clip and the animations of all, with only the data they read.
export function clipsOnly(files) {
  const first = readGlb(readFileSync(files[0][1])).json;
  const nodes = first.nodes.map(({ mesh, skin, ...n }) => n);
  const accessors = [], views = [], chunks = [];
  let offset = 0;
  const animations = [];
  for (const [name, file] of files) {
    const { json, bin } = readGlb(readFileSync(file));
    const names = json.nodes.map((n) => n.name);
    const remap = new Map();
    const take = (i) => {
      if (remap.has(i)) return remap.get(i);
      const a = json.accessors[i], v = json.bufferViews[a.bufferView];
      const start = (v.byteOffset || 0) + (a.byteOffset || 0);
      const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type], size = { 5126: 4, 5123: 2, 5121: 1 }[a.componentType];
      const bytes = Buffer.from(bin.subarray(start, start + a.count * comps * size));
      const padded = bytes.length % 4 ? Buffer.concat([bytes, Buffer.alloc(4 - (bytes.length % 4))]) : bytes;
      views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
      chunks.push(padded); offset += padded.length;
      const { bufferView, byteOffset, ...rest } = a;
      accessors.push({ ...rest, bufferView: views.length - 1 });
      remap.set(i, accessors.length - 1);
      return accessors.length - 1;
    };
    for (const anim of json.animations || []) {
      // Turns only, and the pelvis's place: a body of other proportions plays the clip by turning
      // its own bones (a mannequin's bone lengths would stretch it), and nothing is scaled.
      const kept = anim.channels.filter((c) => c.target.path === "rotation" || (c.target.path === "translation" && /^(pelvis|root)$/.test(names[c.target.node])));
      const samplers = [], channels = [];
      for (const c of kept) {
        const node = nodes.findIndex((n) => n.name === names[c.target.node]);   // by name, not by order
        if (node < 0) continue;
        const sm = anim.samplers[c.sampler];
        samplers.push({ ...sm, input: take(sm.input), output: take(sm.output) });
        channels.push({ sampler: samplers.length - 1, target: { node, path: c.target.path } });
      }
      animations.push({ name, samplers, channels });
    }
  }
  const json = { asset: { version: "2.0", generator: "kerbside build_npc_characters" }, scene: 0,
    scenes: [{ nodes: first.scenes[first.scene || 0].nodes }], nodes, animations, accessors, bufferViews: views, buffers: [{ byteLength: offset }] };
  return writeGlb(json, Buffer.concat(chunks));
}

//: Unreal 5.8's glTF exporter writes a MetaHuman's 16-bit skin weights as their low bytes (a
//: vertex reads 255,255,255,255, or 27,26,23,0): right at rest, torn the moment a bone turns. Its
//: lists of which bones each vertex follows are sound. So each vertex is weighted again among the
//: bones Unreal listed for it, by its distance from each bone (the segment from the bone to its
//: child, at the bind pose); a listed bone far beyond the nearest (the exporter's filler entries,
//: all one bone) gets nothing. Four bones a vertex, weights as floats, the second set dropped.
export function reweight(buf) {
  const { json, bin } = readGlb(buf);
  const skin = json.skins?.[0];
  if (!skin) return buf;
  const acc = json.accessors, views = json.bufferViews;
  const read = (i) => {
    const a = acc[i], v = views[a.bufferView], T = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], el = comps * T.BYTES_PER_ELEMENT, stride = v.byteStride || el;
    const out = new T(a.count * comps), base = (v.byteOffset || 0) + (a.byteOffset || 0);
    for (let k = 0; k < a.count; k += 1) out.set(new T(bin.buffer.slice(bin.byteOffset + base + k * stride, bin.byteOffset + base + k * stride + el)), k * comps);
    return out;
  };
  // The bones' heads at bind (mesh space): the inverse of each inverse bind matrix, its translation.
  const ibm = read(skin.inverseBindMatrices), nJ = skin.joints.length;
  const head = (j) => { const m = ibm.subarray(j * 16, j * 16 + 16); return invTranslation(m); };
  const heads = Array.from({ length: nJ }, (_, j) => head(j));
  const jointOf = new Map(skin.joints.map((node, j) => [node, j]));
  const tails = heads.map((h, j) => {
    const kids = (json.nodes[skin.joints[j]].children || []).map((c) => jointOf.get(c)).filter((c) => c !== undefined);
    if (!kids.length) return h;
    // The child furthest from the head marks the bone's length (a hand's middle finger, not a twist bone).
    return kids.map((c) => heads[c]).reduce((a, b) => (dist(h, b) > dist(h, a) ? b : a));
  });
  const appended = [];
  let offset = bin.length;
  for (const mesh of json.meshes) for (const prim of mesh.primitives) {
    const at = prim.attributes;
    if (at.JOINTS_0 === undefined) continue;
    const pos = read(at.POSITION), n = pos.length / 3;
    const lists = [read(at.JOINTS_0), at.JOINTS_1 !== undefined ? read(at.JOINTS_1) : null];
    const J = new Uint16Array(n * 4), W = new Float32Array(n * 4);
    for (let v = 0; v < n; v += 1) {
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
      const cands = [...new Set(lists.flatMap((l) => (l ? [...l.subarray(v * 4, v * 4 + 4)] : [])))];
      const d = cands.map((j) => segDist(p, heads[j], tails[j]));
      const near = Math.min(...d);
      const scored = cands.map((j, k) => [j, d[k] <= near * 2.2 + 0.015 ? 1 / Math.pow(d[k] + 0.01, 3) : 0]).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = scored.reduce((s, [, w]) => s + w, 0) || 1;
      scored.forEach(([j, w], k) => { J[v * 4 + k] = j; W[v * 4 + k] = w / sum; });
    }
    for (const [arr, type, name] of [[J, 5123, "JOINTS_0"], [W, 5126, "WEIGHTS_0"]]) {
      const bytes = Buffer.from(arr.buffer);
      views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
      acc.push({ bufferView: views.length - 1, componentType: type, count: n, type: "VEC4" });
      at[name] = acc.length - 1;
      appended.push(bytes); offset += bytes.length;
    }
    delete at.JOINTS_1; delete at.WEIGHTS_1;
  }
  const all = Buffer.concat([bin, ...appended]);
  json.buffers[0].byteLength = all.length;
  return writeGlb(json, all);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = L > 1e-9 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L)) : 0;
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}
//: The translation of the inverse of an affine column-major 4x4 (a bone's head, from its inverse bind).
function invTranslation(m) {
  const [a, b, c, , d, e, f, , g, h, i, , x, y, z] = m;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const inv = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  return [-(inv[0] * x + inv[3] * y + inv[6] * z), -(inv[1] * x + inv[4] * y + inv[7] * z), -(inv[2] * x + inv[5] * y + inv[8] * z)];
}

function main(src, out) {
  mkdirSync(out, { recursive: true });
  const MESHES = ["ada-body", "ada-face", "ada-outfit", "ada-hair", "manny"];
  for (const m of MESHES) {
    if (m.startsWith("ada-") && m !== "ada-hair") writeFileSync(join(out, `${m}.glb`), reweight(readFileSync(join(src, `${m}.glb`))));
    else copyFileSync(join(src, `${m}.glb`), join(out, `${m}.glb`));
  }
  writeFileSync(join(out, "clips.glb"), clipsOnly([["idle", join(src, "clip-idle.glb")], ["walk", join(src, "clip-walk.glb")], ["jog", join(src, "clip-jog.glb")]]));
  //: [the export's texture, the page's file, the longest side]
  const TEXTURES = [
    ["T_Body_BC_VT", "ada-body.jpg", 1024], ["T_Body_N_VT", "ada-body-normal.jpg", 512],
    ["T_Head_LOD3_BC_VT", "ada-face.jpg", 512], ["T_Head_LOD3_N_VT", "ada-face-normal.jpg", 512],
    ["T_EyeIrisL_BC", "ada-eye.jpg", 128], ["Hair_S_Coil_CardsAtlas_Attribute", "ada-hair.jpg", 512],
  ];
  for (const [name, file, size] of TEXTURES) {
    const from = join(src, "textures", `${name}.png`);
    if (!existsSync(from)) throw new Error(`missing ${from}`);
    const fmt = file.endsWith(".png") ? ["-s", "format", "png"] : ["-s", "format", "jpeg", "-s", "formatOptions", "72"];
    execFileSync("sips", [...fmt, "-Z", String(size), from, "--out", join(out, file)], { stdio: "ignore" });
  }
  const report = JSON.parse(readFileSync(join(src, "export.json"), "utf8"));
  writeFileSync(join(out, "manifest.json"), JSON.stringify({
    source: "Unreal Engine 5.8 project Kerbside: Epic MetaHuman 'Ada' and the UE5 mannequin, exported by tools/unreal/export_npc_characters.py",
    licence: "Epic Games content: Unreal Engine EULA / MetaHuman licence (use with Unreal-rendered or other real-time projects as Epic permits)",
    meshes: Object.fromEntries(MESHES.map((m) => [m, report.meshes[m] || null])),
    clips: report.clips,
  }, null, 1) + "\n");
  console.log("npc characters written to", out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, out = "docs/city/models/npc"] = process.argv.slice(2);
  if (!src) { console.error("usage: node tools/build_npc_characters.mjs <export dir> [out dir]"); process.exit(2); }
  main(src, out);
}
