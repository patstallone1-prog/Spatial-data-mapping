import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {weld, simplify, prune, dedup} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import fs from 'node:fs';
// Triangles each variant (node) may keep: enough to read as the plant at walking distance,
// few enough to instance hundreds of times.
const TARGET = {fern_02:2600, shrub_02:3500, shrub_03:3000, shrub_04:3500, shrub_sorrel_01:1800,
  weed_plant_02:2400, nettle_plant:3000, dandelion_01:1800, dry_branches_medium_01:900,
  tree_stump_01:1800, dead_tree_trunk:2600, rock_moss_set_01:900};
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync('out', {recursive: true});
const report = {};
for (const [name, target] of Object.entries(TARGET)) {
  const doc = await io.read(`prepped/${name}/${name}.gltf`);
  const root = doc.getRoot();
  for (const mat of root.listMaterials()) {
    mat.setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(1);
    mat.setOcclusionTexture(null);
  }
  await doc.transform(weld(), dedup());
  const variants = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    let tris = 0; for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
    variants.push({node: node.getName(), tris: Math.round(tris)});
  }
  const total = variants.reduce((n, v) => n + v.tris, 0);
  const perVariant = target * variants.length;
  const ratio = Math.min(1, perVariant / total);
  if (ratio < 1) await doc.transform(simplify({simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false}));
  await doc.transform(prune());
  let after = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) after += (p.getIndices()?.getCount() ?? 0) / 3;
  await io.write(`out/${name}.glb`, doc);
  report[name] = {variants: variants.map(v => v.node), tris_before: total, tris_after: Math.round(after), bytes: fs.statSync(`out/${name}.glb`).size};
  console.log(name, JSON.stringify(report[name]));
}
fs.writeFileSync('out/report.json', JSON.stringify(report, null, 1));
