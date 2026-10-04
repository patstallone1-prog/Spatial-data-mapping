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
globalThis.fetch = async (url) => {
  const name = String(url).split("?")[0];
  try {
    const bytes = readFileSync(resolve(ROOT, WORLD, name));
    return { ok: true, status: 200, json: async () => JSON.parse(bytes.toString("utf8")),
             arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
             text: async () => bytes.toString("utf8") };
  } catch (e) { return { ok: false, status: 404, json: async () => { throw e; }, arrayBuffer: async () => null }; }
};

// ---- the page, as a module ---------------------------------------------------------------
function pageModule() {
  const html = readFileSync(resolve(ROOT, WORLD, PAGE), "utf8");
  const start = html.indexOf('<script type="module">') + '<script type="module">'.length;
  let js = html.slice(start, html.indexOf("</script>", start));
  js = js.replace(/^import \* as THREE from "[^"]+";/m, "const THREE = globalThis.__THREE;");
  js = js.replace(/^import \{ GLTFLoader \} from "[^"]+";/m, "const GLTFLoader = globalThis.__THREE.GLTFLoader;");
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
    for (const name of Object.keys(g.attributes)) if (!["position", "uv", "color"].includes(name)) g.deleteAttribute(name);
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
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i += 1) {
          o.getMatrixAt(i, m4);
          add(o.geometry, m4.clone().premultiply(o.matrixWorld), Array.isArray(o.material) ? o.material[0] : o.material, surface);
        }
        return;
      }
      add(o.geometry, o.matrixWorld, Array.isArray(o.material) ? o.material[0] : o.material, surface);
    });
  }
  console.log(`${meshes} meshes cut into ${tiles.size} tiles, ${triangles} triangles; ${degenerateDropped} zero-area placeholders excluded`);

  const exporter = new GLTFExporter();
  const manifest = { schema_version: 2, geometry_contract: "active-nondegenerate-v1", region: REGION || "sf-corridor", tile_m: TILE_M, frame,
                     renderer_sha256: createHash("sha256").update(readFileSync(resolve(ROOT, WORLD, PAGE))).digest("hex"),
                     units: "metres, y up (glTF); the importer turns it z up",
                     degenerate_dropped: degenerateDropped, duplicate_faces_dropped: 0, tiles: [], surfaces: {} };
  mkdirSync(resolve(OUT, "tiles"), { recursive: true });
  for (const [key, buckets] of [...tiles.entries()].sort()) {
    const scene = new THREE.Scene();
    const [ix, iz] = key.split(":").map(Number);
    let tileTris = 0;
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
    manifest.tiles.push({ file: `tiles/${name}`, ix, iz, x0, z0, x1: x0 + TILE_M, z1: z0 + TILE_M, corners_lonlat: lonlat,
                          triangles: tileTris, surfaces, bytes: glb.byteLength, spawn_gltf_m: spawn,
                          sha256: createHash("sha256").update(Buffer.from(glb)).digest("hex") });
    console.log(`  ${name}: ${tileTris} triangles, ${(glb.byteLength / 1e6).toFixed(1)} MB`);
  }
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`wrote ${manifest.tiles.length} tiles to ${OUT} in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
