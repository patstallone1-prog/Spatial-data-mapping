// Remove only zero-area faces from an existing GENERATED export into a NEW directory.
// This is diagnostic recovery, not restoration of faces previously lost to welding.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { usableTriangle, deduplicateFaces } from "./geometry.mjs";
import { auditManifest } from "./audit_tiles.mjs";

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); }
};

async function main() {
  const input = resolve(process.argv[2]), out = resolve(process.argv[3]);
  if (existsSync(out)) throw new Error("Choose a new diagnostic output directory; existing data never replaced");
  const manifest = JSON.parse(readFileSync(input, "utf8"));
  manifest.diagnostic_only = true;
  manifest.geometry_contract = "active-nondegenerate-v1";
  manifest.recovery = "Zero-area and exactly duplicate face removal only; source welding losses are NOT restored";
  manifest.surfaces = {};
  manifest.duplicate_faces_dropped = 0;
  mkdirSync(resolve(out, "tiles"), {recursive: true});
  for (const tile of manifest.tiles) {
    const file = resolve(dirname(input), tile.file);
    if (!file.startsWith(dirname(input) + "/")) throw new Error("Escaping source path");
    const bytes = readFileSync(file), sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== tile.sha256 || bytes.length !== tile.bytes) throw new Error("Corrupt source tile");
    const model = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    tile.source_sha256_chain = [sha, ...(tile.source_sha256_chain || (tile.source_sha256 ? [tile.source_sha256] : []))];
    tile.source_sha256 = sha;
    tile.removed_zero_area_faces = 0;
    tile.removed_duplicate_faces = 0;
    tile.triangles = 0;
    tile.surfaces = {};
    model.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry, pos = geometry.getAttribute("position"), index = geometry.index;
      const at = i => index ? index.getX(i) : i;
      const indexed = {getX:i=>pos.getX(at(i)), getY:i=>pos.getY(at(i)), getZ:i=>pos.getZ(at(i))};
      const count = index ? index.count : pos.count, keep = [];
      for (let i = 0; i < count; i += 3) {
        if (usableTriangle(indexed, i)) keep.push(at(i), at(i + 1), at(i + 2));
        else tile.removed_zero_area_faces += 1;
      }
      geometry.setIndex(keep);
      tile.removed_duplicate_faces += deduplicateFaces(geometry);
      const keptTriangles = geometry.index.count / 3;
      const surface = mesh.userData.surface || mesh.material.name;
      if (!surface) throw new Error("Lost surface provenance");
      tile.surfaces[surface] = (tile.surfaces[surface] || 0) + keptTriangles;
      tile.triangles += keptTriangles;
    });
    const result = Buffer.from(await new GLTFExporter().parseAsync(model.scene, {binary: true}));
    manifest.duplicate_faces_dropped += tile.removed_duplicate_faces;
    tile.file = `tiles/tile_${tile.ix}_${tile.iz}.glb`;
    tile.bytes = result.length;
    tile.sha256 = createHash("sha256").update(result).digest("hex");
    writeFileSync(resolve(out, tile.file), result);
    for (const [surface, count] of Object.entries(tile.surfaces)) manifest.surfaces[surface] = (manifest.surfaces[surface] || 0) + count;
  }
  const path = resolve(out, "manifest.json");
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(await auditManifest(path), null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
