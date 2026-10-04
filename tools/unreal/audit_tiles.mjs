// Independently decode final GLBs, including indexed/welded output, before UE import.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { usableTriangle } from "./geometry.mjs";

export async function auditManifest(path) {
  const root = dirname(resolve(path));
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (!manifest.tiles?.length) throw new Error("Empty export");
  const results = [];
  for (const tile of manifest.tiles) {
    const file = resolve(root, tile.file);
    if (!file.startsWith(root + "/")) throw new Error("Tile escapes export directory");
    const bytes = readFileSync(file);
    if (bytes.length !== tile.bytes || createHash("sha256").update(bytes).digest("hex") !== tile.sha256)
      throw new Error(`Hash/size mismatch: ${file}`);
    const model = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    let triangles = 0, degenerate = 0, duplicate = 0, meshes = 0;
    model.scene.traverse(mesh => {
      if (!mesh.isMesh) return;
      meshes += 1;
      const pos = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
      const count = index ? index.count : pos.count;
      if (count % 3) throw new Error("Partial triangle in GLB");
      const at = i => index ? index.getX(i) : i;
      const indexed = {getX:i=>pos.getX(at(i)), getY:i=>pos.getY(at(i)), getZ:i=>pos.getZ(at(i))};
      const faces = new Set();
      for (let i = 0; i < count; i += 3) {
        triangles += 1;
        if (!usableTriangle(indexed, i)) degenerate += 1;
        const a = at(i), b = at(i + 1), c = at(i + 2);
        const key = a <= b && a <= c ? `${a},${b},${c}` : b <= c ? `${b},${c},${a}` : `${c},${a},${b}`;
        if (faces.has(key)) duplicate += 1;
        faces.add(key);
      }
    });
    if (triangles !== tile.triangles) throw new Error(`Triangle count mismatch: ${tile.file}`);
    results.push({file: tile.file, meshes, triangles, degenerate, duplicate});
    if (degenerate) throw new Error(`Final GLB has ${degenerate} zero-area triangles: ${tile.file}`);
    if (duplicate) throw new Error(`Final GLB has ${duplicate} identical indexed faces: ${tile.file}`);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  auditManifest(process.argv[2]).then(results => console.log(JSON.stringify(results, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
