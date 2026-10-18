import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {simplify, prune, weld} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import fs from 'node:fs';
// Far versions: geometry only (the near file's material is reused), ~1/8 of the triangles.
const TARGET = {fern_02:320, shrub_02:450, shrub_03:400, shrub_04:450, shrub_sorrel_01:120,
  weed_plant_02:350, nettle_plant:400, dandelion_01:260};
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name, target] of Object.entries(TARGET)) {
  const doc = await io.read(`out/${name}.glb`), root = doc.getRoot();
  let tris = 0, n = 0;
  for (const node of root.listNodes()) { const m = node.getMesh(); if (!m) continue; n++;
    for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3; }
  for (const t of root.listTextures()) t.dispose();
  await doc.transform(weld(), simplify({simplifier: MeshoptSimplifier, ratio: Math.min(1, target * n / tris), error: 0.08}), prune());
  let after = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) after += p.getIndices().getCount() / 3;
  await io.write(`out/${name}.lod1.glb`, doc);
  console.log(name, Math.round(tris), '->', Math.round(after), fs.statSync(`out/${name}.lod1.glb`).size);
}
