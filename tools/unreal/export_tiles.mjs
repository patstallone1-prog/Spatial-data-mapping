// Export the corridor the page builds as glTF tiles for Unreal.
//
// The page's own JavaScript builds every street, kerb, pavement, building, tree and post from
// the payload; nothing here re-implements that. The shipped page module is run in Node with
// the real three.js (npm, the same 0.160 the page loads) for geometry and a stub in place of
// the parts of the browser it cannot have -- the WebGL renderer, canvas textures, the DOM --
// then the scene is walked, every mesh baked into world space, cut into TILE_M tiles by
// triangle, merged per tile and material, and written as one .glb per tile with a manifest.
//
// Textures are not exported: the page paints them into canvases at run time. Each material
// keeps its colour and its *surface name* (road, walk, kerb, building, ...), which is what
// Unreal's material assignment keys on -- see unreal/Content/README.md for the mapping.
//
//   node tools/unreal/export_tiles.mjs [--tile 250] [--out build/unreal] [--only x,y]
//
// Run from the repository root after the page has been built:
//   node tools/unreal/export_tiles.mjs                       the corridor
//   node tools/unreal/export_tiles.mjs --region sf-sunset    one built region

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as THREE_REAL from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { triangleRange, usableTriangle, exactIndex, deduplicateFaces } from "./geometry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const TILE_M = Number(flag("--tile", 250));
const OUT = resolve(ROOT, flag("--out", "build/unreal"));
const ONLY = flag("--only", null);
// Which world to export. The corridor's page and payload sit in docs/; a region's sit in
// docs/regions/<name>/. Both are the same renderer reading the same shapes, so the exporter
// needs nothing but the directory they live in -- it was hard-wired to docs/ and so only the
// corridor could ever be exported, which is why seven of the eight built worlds had no tiles.
const REGION = flag("--region", null);
const WORLD = REGION ? `docs/app-regions/${REGION}` : "docs";
const PAGE = "app-model.html";
const GROUPS = ["streets", "mapped3d", "ground", "furniture"];

// ---- the browser the page expects, minus the drawing ------------------------------------
function stub(name = "stub") {
  const f = function () {};
  return new Proxy(f, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === Symbol.iterator) return function* () {};
      if (p === "then") return undefined;
      if (p === "length") return 0;
      return stub(String(p));
    },
    apply() { return stub(); }, construct() { return stub(); }, set() { return true; }, has() { return true; },
  });
}
class FakeCanvas {
  constructor() { this.width = 64; this.height = 64; this.style = {}; }
  getContext() { return stub("ctx"); }
  toDataURL() { return ""; }
  addEventListener() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { width: 1280, height: 800, left: 0, top: 0 }; }
}
class NoRenderer {
  constructor() { this.domElement = new FakeCanvas(); this.info = { render: {} }; this.capabilities = { getMaxAnisotropy: () => 1 }; this.shadowMap = {}; }
  setPixelRatio() {} setSize() {} render() {} dispose() {} setClearColor() {} getContext() { return stub(); }
}
class NoTexture extends THREE_REAL.Texture { constructor() { super(); this.image = null; } }
const THREE = {
  ...THREE_REAL,
  WebGLRenderer: NoRenderer,
  PMREMGenerator: class { fromScene() { return { texture: new NoTexture() }; } fromEquirectangular() { return { texture: new NoTexture() }; } dispose() {} },
  CanvasTexture: class extends NoTexture { constructor() { super(); } },
  TextureLoader: class { load() { return new NoTexture(); } },
  GLTFLoader: class { setCrossOrigin() { return this; } setPath() { return this; } load() {} loadAsync() { return new Promise(() => {}); } },
};
globalThis.__THREE = THREE;
globalThis.document = {
  getElementById: () => stub("element"), querySelector: () => null, querySelectorAll: () => [],
  createElement: (tag) => (tag === "canvas" ? new FakeCanvas() : stub("element")),
  body: stub(), documentElement: stub(), addEventListener() {}, hidden: false, visibilityState: "visible",
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1; globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
globalThis.location = { search: "", hash: "", href: "http://localhost/" };
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node", hardwareConcurrency: 4 }, configurable: true });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
// Nothing is drawn here: no timer is to stand in for the frames withheld above (requestFrame).
globalThis.__kerbsideNoFrames = true;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.Image = class { set src(v) { setTimeout(() => this.onload && this.onload(), 0); } };
globalThis.OffscreenCanvas = FakeCanvas;
globalThis.ResizeObserver = class { observe() {} };
// GLTFExporter reads its own Blob back through a FileReader; Node has Blob but no reader.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend && this.onloadend(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`; this.onloadend && this.onloadend(); }); }
};
globalThis.__kerbsideImport = (url) => {
  const path = decodeURIComponent(new URL(String(url), "http://localhost/").pathname).replace(/^\/+/, "");
  return import(pathToFileURL(resolve(ROOT, "docs", path)).href);
};
globalThis.fetch = async (url) => {
  const name = String(url).split("?")[0];
  try {
    const bytes = readFileSync(resolve(ROOT, WORLD, name));
    return { ok: true, status: 200, json: async () => JSON.parse(bytes.toString("utf8")),
             arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
             text: async () => bytes.toString("utf8") };
  } catch (e) { return { ok: false, status: 404, json: async () => { throw e; }, arrayBuffer: async () => null }; }
};

//: Which plants sway in Unreal: trees (trunks and leaves) and shrubs. Litter and deadwood lie.
function plantMotion(surface) {
  const s = String(surface);
  if (s.startsWith("tree:") || s.startsWith("foliage:")) return "tree";
  if (s.startsWith("understorey:")) return "shrub";
  return null;
}
const material_of = (o) => (Array.isArray(o.material) ? o.material[0] : o.material);

// ---- the page, as a module ---------------------------------------------------------------
function pageModule() {
  const html = readFileSync(resolve(ROOT, WORLD, PAGE), "utf8");
  const start = html.indexOf('<script type="module">') + '<script type="module">'.length;
  let js = html.slice(start, html.indexOf("</script>", start));
  js = js.replace(/^import \* as THREE from "[^"]+";/m, "const THREE = globalThis.__THREE;");
  js = js.replace(/^import \{ GLTFLoader \} from "[^"]+";/m, "const GLTFLoader = globalThis.__THREE.GLTFLoader;");
  // The page loads its shared modules (streaming, nature, grass, foliage) by dynamic import from
  // its own site; Node's loader takes files only, so each is read from docs/ where it is built.
  js = js.replace(/\bimport\((?=sharedAsset\(|asset\()/g, "globalThis.__kerbsideImport(");
  mkdirSync(OUT, { recursive: true });
  const path = resolve(OUT, "page.mjs");
  writeFileSync(path, js);
  return path;
}

async function main() {
  const t0 = performance.now();
  await import(pathToFileURL(pageModule()).href);
  const k = globalThis.kerbside;
  if (!k || !k.DATA || !k.DATA.ways || k.DATA.ways.length < 1000) throw new Error("the page built no world");
  // The ground layer and the furniture load after the first frame; give them a moment.
  for (let i = 0; i < 100 && !(k.groups.ground.children.length > 3); i += 1) await new Promise((r) => setTimeout(r, 100));
  console.log(`page built in ${((performance.now() - t0) / 1000).toFixed(1)} s: ${k.DATA.ways.length} ways`);

  // Mesh coordinates belong to the viewer bbox frame, NOT necessarily the lidar grid.
  const bounds = k.DATA.bbox;
  const midLat = (bounds.south + bounds.north) / 2;
  const frame = { mid_lon: (bounds.west + bounds.east) / 2, mid_lat: midLat,
    metres_per_lat: 111320, metres_per_lon: 111320 * Math.cos(midLat * Math.PI / 180),
    vertical_datum: k.TERRAIN?.meta?.vertical_datum || "source terrain datum; verify sidecar" };
  const tiles = new Map();   // "ix:iz" -> Map(materialKey -> {geometries, material, surface})
  const tileKey = (x, z) => `${Math.floor(x / TILE_M)}:${Math.floor(z / TILE_M)}`;
  const only = ONLY ? new Set(ONLY.split(";")) : null;

  const m4 = new THREE.Matrix4();
  let meshes = 0, triangles = 0, degenerateDropped = 0;
  function add(geometry, matrixWorld, material, surface) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrixWorld);
    // Positions, uvs and vertex colours only. Normals are left to the importer (tick
    // "recompute normals"): shipping them was a third of every tile.
    for (const name of Object.keys(g.attributes)) if (!["position", "uv", "color", "uv1", "uv2"].includes(name)) g.deleteAttribute(name);
    // Every plant in a bucket carries the sway channels, or none can be merged with it: a tree
    // cut at a wall is baked whole in the page and stands still (weight 0).
    if (plantMotion(surface) && !g.getAttribute("uv1")) {
      const n = g.getAttribute("position").count;
      g.setAttribute("uv1", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      g.setAttribute("uv2", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    const pos = g.getAttribute("position");
    const [start, end] = triangleRange(geometry, pos.count);
    // Cut by triangle centroid into tiles.
    const byTile = new Map();
    for (let t = start; t < end; t += 3) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) throw new Error("Nonfinite world coordinates; export rejected");
      const key = tileKey(cx, cz);
      if (only && !only.has(key)) continue;
      if (!usableTriangle(pos, t)) { degenerateDropped += 1; continue; }
      let list = byTile.get(key);
      if (!list) byTile.set(key, list = []);
      list.push(t);
    }
    const colour = material && material.color ? material.color.getHex() : 0x808080;
    const matKey = `${surface}|${colour.toString(16)}|${material && material.transparent ? "t" : "o"}`;
    for (const [key, list] of byTile) {
      const part = new THREE.BufferGeometry();
      for (const name of Object.keys(g.attributes)) {
        const src = g.getAttribute(name);
        const arr = new Float32Array(list.length * 3 * src.itemSize);
        let o = 0;
        for (const t of list) for (let v = 0; v < 3; v += 1) for (let c = 0; c < src.itemSize; c += 1) arr[o++] = src.array[(t + v) * src.itemSize + c];
        part.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize));
      }
      let tile = tiles.get(key);
      if (!tile) tiles.set(key, tile = new Map());
      let bucket = tile.get(matKey);
      if (!bucket) tile.set(matKey, bucket = { geometries: [], surface, colour, material });
      bucket.geometries.push(part);
      triangles += list.length;
    }
    g.dispose();
    meshes += 1;
  }

  //: The native foliage material's inputs, per vertex (unreal/Content/README.md, Foliage):
  //: UV1 = (how far up its plant this vertex is, 0 root to 1 top; the plant's height in
  //: metres) and UV2 = (a phase of its own, 0-1; the kind: 1 tree, 2 shrub). Unreal sways a
  //: vertex by the square of its height fraction times its plant's height, as the page does.
  function swayCopy(flat, world, kind) {
    const pos = flat.getAttribute("position"), n = pos.count;
    if (!flat.boundingBox) flat.computeBoundingBox();
    const top = Math.max(1e-3, flat.boundingBox.max.y);
    const scaleY = new THREE.Vector3().setFromMatrixColumn(world, 1).length();
    const at = new THREE.Vector3().setFromMatrixPosition(world);
    const phase = ((Math.sin(at.x * 12.9898 + at.z * 78.233) * 43758.5453) % 1 + 1) % 1;
    const uv1 = new Float32Array(n * 2), uv2 = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      uv1[i * 2] = Math.max(0, Math.min(1, pos.getY(i) / top)); uv1[i * 2 + 1] = top * scaleY;
      uv2[i * 2] = phase; uv2[i * 2 + 1] = kind === "tree" ? 1 : 2;
    }
    const copy = flat.clone();
    copy.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
    copy.setAttribute("uv2", new THREE.BufferAttribute(uv2, 2));
    return copy;
  }

  //: Grass clumps for Unreal over a tile's lawns -- park and yard ground -- about one a square
  //: metre, deterministic per tile, and none where any hard surface (a path, a walk, a court,
  //: a kerb, a tree pit) lies over the lawn: the page draws those on top of the turf.
  const LAWN = new Set(["park", "yard"]), CLUMPS_PER_M2 = 0.9;
  const SOFT = (s) => LAWN.has(s) || s === "terrain" || /^(tree|foliage|understorey|litter|deadwood):/.test(s)
    || s.startsWith("building") || s === "roof" || s.startsWith("fence") || s === "wall";
  function lawnClumps(key, buckets) {
    const lawn = [], hard = new Map(), cell = 4;
    for (const bucket of buckets.values()) {
      const surface = String(bucket.surface).split("|")[0];
      const isLawn = LAWN.has(surface);
      if (!isLawn && SOFT(surface)) continue;
      for (const g of bucket.geometries) {
        const pos = g.getAttribute("position");
        for (let t = 0; t + 2 < pos.count; t += 3) {
          const a = [pos.getX(t), pos.getY(t), pos.getZ(t)], b = [pos.getX(t + 1), pos.getY(t + 1), pos.getZ(t + 1)], c = [pos.getX(t + 2), pos.getY(t + 2), pos.getZ(t + 2)];
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
          if (len < 1e-9 || Math.abs(ny) / len < 0.7) continue;          // only ground that faces up
          if (isLawn) { lawn.push([a, b, c, Math.abs(ny) / 2]); continue; }
          const minX = Math.floor(Math.min(a[0], b[0], c[0]) / cell), maxX = Math.floor(Math.max(a[0], b[0], c[0]) / cell);
          const minZ = Math.floor(Math.min(a[2], b[2], c[2]) / cell), maxZ = Math.floor(Math.max(a[2], b[2], c[2]) / cell);
          if ((maxX - minX + 1) * (maxZ - minZ + 1) > 4096) continue;
          for (let gx = minX; gx <= maxX; gx += 1) for (let gz = minZ; gz <= maxZ; gz += 1) {
            const k2 = `${gx}:${gz}`; if (!hard.has(k2)) hard.set(k2, []); hard.get(k2).push([a, b, c]);
          }
        }
      }
    }
    const inside = (x, z, [a, b, c]) => {
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]); if (Math.abs(d) < 1e-12) return false;
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      return u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6;
    };
    let seed = [...key].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 2166136261);
    const rnd = () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return seed / 4294967296; };
    const out = [];
    for (const [a, b, c, area] of lawn) {
      let n = area * CLUMPS_PER_M2; const whole = Math.floor(n) + (rnd() < n - Math.floor(n) ? 1 : 0);
      for (let i = 0; i < whole; i += 1) {
        let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const x = a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, y = a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v, z = a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v;
        if ((hard.get(`${Math.floor(x / cell)}:${Math.floor(z / cell)}`) || []).some((t) => inside(x, z, t))) continue;
        out.push([+x.toFixed(2), +y.toFixed(3), +z.toFixed(2), Math.round(rnd() * 360), +(0.75 + rnd() * 0.6).toFixed(2)]);
      }
    }
    return out;
  }

  const roots = GROUPS.map((name) => k.groups[name]).filter(Boolean);
  k.scene.traverse((o) => { if (o.userData && o.userData.surface === "terrain") roots.push(o); });
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      // Browser distance culling toggles `visible` at runtime.  An export is a persistent
      // world tile, not a screenshot from the startup camera: omitting culled meshes erased
      // kerbs (and other fine surfaces) from tiles away from that camera.
      if (!o.isMesh || !o.geometry) return;
      // Every surface has a name the page gave it; what has none is named for the layer it is
      // in and the geometry it is, so nothing arrives in Unreal as "unlabelled".
      const layer = GROUPS.find((g) => k.groups[g] === root) || "scene";
      const surface = o.userData.surface || o.userData.kind || o.parent?.userData?.surface
        || `${layer}:${(o.geometry.type || "mesh").replace(/Geometry$/, "").toLowerCase()}`;
      if (surface === "water" || surface === "beach") return;
      // A tree's leaf cards are their own surface, so Unreal can give them the masked, two-sided
      // leaf material; its trunk and limbs keep the tree's.
      const leaf = String(surface).startsWith("tree:") && material_of(o)?.alphaTest > 0;
      const named = leaf ? String(surface).replace(/^tree:/, "foliage:") : surface;
      if (o.isInstancedMesh) {
        // The shared geometry made flat once, not once per instance; and with --only, an
        // instance whose place is nowhere near the tiles asked for is not cut at all (a region
        // has tens of thousands of poles, meters and signs).
        const flat = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        const at = new THREE.Vector3();
        const near = (x, z) => [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]].some(([dx, dz]) => only.has(tileKey(x + dx, z + dz)));
        for (let i = 0; i < o.count; i += 1) {
          o.getMatrixAt(i, m4);
          const world = m4.clone().premultiply(o.matrixWorld);
          if (only) {
            at.setFromMatrixPosition(world);
            if (!near(at.x, at.z)) continue;
          }
          const kind = plantMotion(named);
          if (kind) {
            const copy = swayCopy(flat, world, kind);
            add(copy, world, material_of(o), named);
            copy.dispose();
          } else add(flat, world, material_of(o), named);
        }
        if (flat !== o.geometry) flat.dispose();
        return;
      }
      add(o.geometry, o.matrixWorld, material_of(o), named);
    });
  }
  console.log(`${meshes} meshes cut into ${tiles.size} tiles, ${triangles} triangles; ${degenerateDropped} zero-area placeholders excluded`);

  const exporter = new GLTFExporter();
  const manifest = { schema_version: 2, geometry_contract: "active-nondegenerate-v1", region: REGION || "sf-corridor", tile_m: TILE_M, frame,
                     renderer_sha256: createHash("sha256").update(readFileSync(resolve(ROOT, WORLD, PAGE))).digest("hex"),
                     units: "metres, y up (glTF); the importer turns it z up",
                     degenerate_dropped: degenerateDropped, duplicate_faces_dropped: 0, tiles: [], surfaces: {} };
  mkdirSync(resolve(OUT, "tiles"), { recursive: true });
  mkdirSync(resolve(OUT, "grass"), { recursive: true });
  for (const [key, buckets] of [...tiles.entries()].sort()) {
    const scene = new THREE.Scene();
    const [ix, iz] = key.split(":").map(Number);
    let tileTris = 0;
    const grass = lawnClumps(key, buckets);
    const surfaces = {};
    let spawn = null;
    for (const [matKey, bucket] of buckets) {
      const flat = mergeGeometries(bucket.geometries, false);
      if (!flat) continue;
      // Indexed, with shared vertices found again: the page's merged surfaces repeat every
      // vertex per triangle, and a tile of them is three times the size it needs to be.
      const merged = exactIndex(flat);
      manifest.duplicate_faces_dropped += deduplicateFaces(merged);
      flat.dispose();
      const material = new THREE.MeshStandardMaterial({
        color: bucket.colour, roughness: bucket.material?.roughness ?? 0.9, metalness: bucket.material?.metalness ?? 0,
        vertexColors: Boolean(merged.getAttribute("color")), transparent: false, side: THREE.DoubleSide,
      });
      material.name = bucket.surface;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${bucket.surface}`;
      mesh.userData = { surface: bucket.surface, material_key: matKey };
      scene.add(mesh);
      if (!spawn && bucket.surface === "road") {
        const positions = merged.getAttribute("position");
        const ids = [merged.index.getX(0), merged.index.getX(1), merged.index.getX(2)];
        spawn = ["x", "y", "z"].map((_, axis) => ids.reduce((sum, id) => sum + positions.array[id * 3 + axis], 0) / 3);
      }
      const n = merged.index.count / 3;
      tileTris += n;
      surfaces[bucket.surface] = (surfaces[bucket.surface] || 0) + n;
      manifest.surfaces[bucket.surface] = (manifest.surfaces[bucket.surface] || 0) + n;
    }
    const glb = await exporter.parseAsync(scene, { binary: true, onlyVisible: true, includeCustomExtensions: false });
    const name = `tile_${ix}_${iz}.glb`;
    writeFileSync(resolve(OUT, "tiles", name), Buffer.from(glb));
    const x0 = ix * TILE_M, z0 = iz * TILE_M;
    const lonlat = frame ? [[frame.mid_lon + x0 / frame.metres_per_lon, frame.mid_lat - z0 / frame.metres_per_lat],
                            [frame.mid_lon + (x0 + TILE_M) / frame.metres_per_lon, frame.mid_lat - (z0 + TILE_M) / frame.metres_per_lat]] : null;
    let grassEntry = null;
    if (grass.length) {
      const text = JSON.stringify({ schema: "kerbside.grass_clumps/1", units: "glTF metres, y up; yaw degrees",
        basis: "inferred lawn cover on park/yard ground, off hard surfaces; not surveyed plants", clumps: grass });
      const file = `grass/${name.replace(/\.glb$/, ".json")}`;
      writeFileSync(resolve(OUT, file), text);
      grassEntry = { file, count: grass.length, sha256: createHash("sha256").update(text).digest("hex") };
    }
    manifest.tiles.push({ file: `tiles/${name}`, ix, iz, x0, z0, x1: x0 + TILE_M, z1: z0 + TILE_M, corners_lonlat: lonlat,
                          triangles: tileTris, surfaces, bytes: glb.byteLength, spawn_gltf_m: spawn, grass: grassEntry,
                          sha256: createHash("sha256").update(Buffer.from(glb)).digest("hex") });
    console.log(`  ${name}: ${tileTris} triangles, ${(glb.byteLength / 1e6).toFixed(1)} MB`);
  }
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`wrote ${manifest.tiles.length} tiles to ${OUT} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
