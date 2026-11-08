// ---- trees: a trunk, limbs, and leaves ----
//
// Each kind is built once at unit size -- a trunk that forks into limbs and twigs, with clusters
// of leaf cards at the twigs' ends -- and instanced over the city's trees, scaled by the trunk
// the city measured. The kinds are built differently, not just proportioned differently: a
// street tree is a rounded crown on a few spreading limbs, a broad tree a wide flat-topped one,
// a columnar tree a narrow spire of upright limbs, a conifer a tiered cone of drooping whorls
// of needles, and a palm a bare ringed trunk with a crown of long arching fronds.
const TREE_LEAF_TEXTURES = new Map(), TREE_LEAF_NORMALS = new Map();
//: A broadleaf's leaf card: branch-ends of leaves painted vein by vein, with a normal map so
//: the veins catch the light (vegetation-geometry.mjs, leafCardTextures). Pale, so the
//: tree's own green (its vertex colour) colours it. Without the module, the older drawing.
function treeLeafTexture(kind) {
  if (TREE_LEAF_TEXTURES.has(kind)) return TREE_LEAF_TEXTURES.get(kind);
  if (kind === "broad" && vegetationLibrary?.leafCardTextures) {
    const pair = vegetationLibrary.leafCardTextures(THREE, { form: "street", layout: "spray", size: 1024, seed: 11 });
    TREE_LEAF_TEXTURES.set(kind, pair.map);
    TREE_LEAF_NORMALS.set(kind, pair.normalMap);
    return pair.map;
  }
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const rnd = (i) => random(i * 7919 + kind.length * 31);
  if (kind === "palm") {
    // A frond: a rib down the middle and narrow leaflets angled off it, longest mid-way.
    ctx.strokeStyle = "#5c6b33"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(size / 2, size); ctx.lineTo(size / 2, 2); ctx.stroke();
    for (let i = 0; i < 26; i += 1) {
      const y = size - 4 - i * 4.6, reach = Math.sin((i / 26) * Math.PI) * size * 0.46 + 4;
      for (const side of [-1, 1]) {
        ctx.strokeStyle = rnd(i * 2 + side) < 0.5 ? "#4f7a35" : "#5f8a3c"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(size / 2, y); ctx.lineTo(size / 2 + side * reach, y - reach * 0.45); ctx.stroke();
      }
    }
  } else if (kind === "conifer") {
    // Needles: short dark strokes fanning off twigs.
    for (let t = 0; t < 14; t += 1) {
      const x0 = rnd(t) * size, y0 = rnd(t + 50) * size, ang = rnd(t + 99) * Math.PI;
      for (let n = 0; n < 34; n += 1) {
        const a = ang + (rnd(t * 40 + n) - 0.5) * 1.6, len = 8 + rnd(t * 40 + n + 7) * 12;
        ctx.strokeStyle = rnd(t * 40 + n + 3) < 0.5 ? "#2a4a2c" : "#35573a"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); ctx.stroke();
      }
    }
  } else {
    // Broad leaves: thirty-odd pointed ovals at angles, lit a little on top.
    for (let i = 0; i < 34; i += 1) {
      const x = 14 + rnd(i) * (size - 28), y = 14 + rnd(i + 30) * (size - 28);
      const a = rnd(i + 60) * Math.PI * 2, l = 13 + rnd(i + 90) * 9;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      const g = ctx.createLinearGradient(0, -l / 2, 0, l / 2);
      g.addColorStop(0, rnd(i + 120) < 0.5 ? "#6f9a48" : "#5f8a3e");
      g.addColorStop(1, "#3e6229");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(0, 0, l * 0.36, l / 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(30,50,20,0.55)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -l / 2); ctx.lineTo(0, l / 2); ctx.stroke();
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  TREE_LEAF_TEXTURES.set(kind, texture);
  return texture;
}

//: A tapered cylinder from p to q (unit-tree coordinates).
function branchGeometry(p, q, r0, r1, sides = 5) {
  const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
  const length = Math.hypot(dx, dy, dz) || 1e-3;
  const geometry = new THREE.CylinderGeometry(r1, r0, length, sides, 1, true);
  geometry.translate(0, length / 2, 0);
  // Up the y axis, tipped over by the branch's angle from the vertical, turned to its bearing.
  geometry.rotateX(Math.acos(Math.max(-1, Math.min(1, dy / length))));
  geometry.rotateY(Math.atan2(dx, dz));
  geometry.translate(p.x, p.y, p.z);
  return geometry;
}
//: A leaf card: a square of leaves, centred at c, facing a random way, with a colour of its own
//: (the leaves of one tree are not all one green).
function leafCard(c, size, rnd, tint, droop = 0) {
  const geometry = new THREE.PlaneGeometry(size, size);
  geometry.rotateX(-Math.PI / 2 + (rnd() - 0.5) * 1.4 + droop);
  geometry.rotateY(rnd() * Math.PI * 2);
  geometry.translate(c.x, c.y, c.z);
  const shade = 0.82 + rnd() * 0.3;
  const colours = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let i = 0; i < colours.length; i += 3) {
    colours[i] = tint.r * shade; colours[i + 1] = tint.g * shade; colours[i + 2] = tint.b * shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  return geometry;
}

//: A street tree's bark, by kind: its pattern (vegetation-geometry.mjs, BARK_STYLES) in the
//: kind's own colour, with the photograph's grain laid in when it has loaded.
const TREE_BARK_STYLE = { palm: "palm", conifer: "pine", broad: "broadleaf", street: "broadleaf", columnar: "broadleaf" };
const TREE_BARK_MATERIALS = new Map();
let treeBarkGrain = null;
function treeBarkMaterial(kind, colour) {
  const style = TREE_BARK_STYLE[kind] || "broadleaf";
  if (TREE_BARK_MATERIALS.has(kind)) return TREE_BARK_MATERIALS.get(kind);
  const t = vegetationLibrary.barkTextures(THREE, { style, seed: kind.length * 17 + 3, grain: treeBarkGrain });
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).multiplyScalar(vegetationLibrary.BARK_GAIN),
    map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.94, metalness: 0 });
  TREE_BARK_MATERIALS.set(kind, material);
  return material;
}
// (Not in the headset: its bark is one plain colour, and the finer grain would only be drawn
// for a moment before it was made plain again.)
if (vegetationLibrary?.barkGrain && !HEADSET) vegetationLibrary.barkGrain(sharedAsset(vegetationLibrary.BARK_GRAIN_URL)).then((grain) => {
  if (!grain) return;
  treeBarkGrain = grain;
  for (const [kind, material] of TREE_BARK_MATERIALS) {
    const t = vegetationLibrary.barkTextures(THREE, { style: TREE_BARK_STYLE[kind] || "broadleaf", seed: kind.length * 17 + 3, grain });
    material.map?.dispose(); material.normalMap?.dispose();
    material.map = t.map; material.normalMap = t.normalMap; material.needsUpdate = true;
  }
});
//: Metres to the unit tree, about: a street tree is drawn a few times its unit size.
const TREE_UNIT_M = 5;

//: The one kind of street tree the headset draws (see the instancing in the ground build).
const HEADSET_TREE_KIND = "street";
function treeVariant(kind) {
  let s = 1 + kind.length * 101;
  const rnd = () => { s += 1; return random(s * 2654435761 % 1000003); };
  const bark = [], leaves = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // With the vegetation module, trunk and limbs are continuous round tubes, a limb running on
  // from its twig without a seam (barkTube); without it, a cylinder a piece.
  const tubes = vegetationLibrary?.barkTube ? { position: [], normal: [], uv: [] } : null;
  const limb = (points, radii, sides) => {
    if (tubes) vegetationLibrary.barkTube(tubes, points.map((p) => [p.x, p.y, p.z]), radii,
      [TREE_UNIT_M, TREE_UNIT_M], { sides, size: [TREE_UNIT_M, TREE_UNIT_M] });
    else for (let i = 1; i < points.length; i += 1) bark.push(branchGeometry(points[i - 1], points[i], radii[i - 1], radii[i], sides));
  };
  // The painted leaves are pale and take the tree's green from here; the older drawing (and the
  // palm's fronds and the conifer's needles) carry their own colour and want almost none.
  const painted = Boolean(vegetationLibrary?.leafCardTextures) && kind !== "palm" && kind !== "conifer";
  const tint = new THREE.Color(painted
    ? (kind === "broad" ? 0x7fae5a : kind === "columnar" ? 0x6f9e55 : 0x86b35e)
    : (kind === "broad" ? 0xe0ffd0 : kind === "columnar" ? 0xd0f0c0 : 0xffffff));
  // A cluster of leaf cards in an ellipsoid round c.
  const cluster = (c, rx, ry, cards, size, droop = 0) => {
    for (let i = 0; i < cards; i += 1) {
      const a = rnd() * Math.PI * 2, e = (rnd() - 0.5) * Math.PI, r = Math.cbrt(rnd());
      leaves.push(leafCard(V(c.x + Math.cos(a) * Math.cos(e) * rx * r, c.y + Math.sin(e) * ry * r,
        c.z + Math.sin(a) * Math.cos(e) * rx * r), size, rnd, tint, droop));
    }
  };
  if (kind === "palm") {
    // A tall slender trunk, a little bent, and fronds arching out and down from the top.
    const top = V(0.05, 1.05, 0.02);
    limb([V(0, -0.03, 0), V(0, 0.01, 0), V(0.02, 0.55, 0.01), top], [0.07, 0.065, 0.05, 0.045], 8);
    for (let i = 0; i < 11; i += 1) {
      const a = (i / 11) * Math.PI * 2 + rnd() * 0.3, len = 0.5 + rnd() * 0.14;
      const frond = new THREE.PlaneGeometry(0.3, len);
      frond.translate(0, len / 2, 0);
      frond.rotateX(-Math.PI / 2 - (0.12 + rnd() * 0.5));    // out from the crown, tips falling
      frond.rotateY(a);
      frond.translate(top.x, top.y, top.z);
      const colours = new Float32Array(frond.getAttribute("position").count * 3).fill(0.9 + rnd() * 0.1);
      frond.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      leaves.push(frond);
    }
  } else if (kind === "conifer") {
    // A trunk to the tip and whorls of branches shortening up it, needles along each.
    limb([V(0, -0.03, 0), V(0, 0.01, 0), V(0, 0.5, 0), V(0, 1.15, 0)], [0.085, 0.078, 0.045, 0.015], 8);
    const whorls = 7;
    for (let w = 0; w < whorls; w += 1) {
      const y = 0.28 + w * 0.12, reach = 0.36 * (1 - w / whorls) + 0.05;
      for (let b = 0; b < 4; b += 1) {
        const a = (b / 4) * Math.PI * 2 + w * 0.7 + rnd() * 0.4;
        const tip = V(Math.cos(a) * reach, y - reach * 0.35, Math.sin(a) * reach);
        limb([V(0, y, 0), tip], [0.018, 0.006], 4);
        cluster(V(tip.x * 0.6, y - reach * 0.18, tip.z * 0.6), reach * 0.55, 0.06, 4, reach * 1.1, 0.5);
      }
    }
    cluster(V(0, 1.12, 0), 0.05, 0.08, 2, 0.14);
  } else {
    // A trunk that forks into limbs, each limb into twigs, leaves at the twigs' ends. The limbs
    // reach a fifth less far than they did: the crowns stood out over the road and the houses.
    const shape = {
      street:   { trunk: 0.38, limbs: 4, spread: 0.75, rise: 0.30, reach: 0.24, crown: [0.20, 0.17], cards: 11 },
      broad:    { trunk: 0.34, limbs: 5, spread: 1.05, rise: 0.22, reach: 0.32, crown: [0.26, 0.15], cards: 11 },
      columnar: { trunk: 0.26, limbs: 4, spread: 0.22, rise: 0.62, reach: 0.12, crown: [0.11, 0.26], cards: 10 },
    }[kind] || { trunk: 0.38, limbs: 4, spread: 0.75, rise: 0.30, reach: 0.24, crown: [0.20, 0.17], cards: 11 };
    const fork = V(0, shape.trunk, 0);
    // Sunk a little and flared at the foot, and on past the fork a short way so the limbs
    // leave a trunk and not the open end of one.
    limb([V(0, -0.03, 0), V(0, 0.01, 0), V(0, shape.trunk * 0.3, 0), fork, V(0, fork.y + 0.05, 0)],
      [0.085, 0.078, 0.066, 0.05, 0.035], 9);
    for (let l = 0; l < shape.limbs; l += 1) {
      const a = (l / shape.limbs) * Math.PI * 2 + rnd() * 0.6;
      const out = shape.reach * (0.8 + rnd() * 0.4);
      const tip = V(Math.cos(a) * out * shape.spread / 0.75, fork.y + shape.rise * (0.8 + rnd() * 0.4),
        Math.sin(a) * out * shape.spread / 0.75);
      const twigs = [0, 1].map((t) => {
        const b = a + (t ? 0.6 : -0.6) + (rnd() - 0.5) * 0.3;
        return V(tip.x + Math.cos(b) * shape.reach * 0.45, tip.y + shape.rise * 0.35 * (0.6 + rnd() * 0.6),
          tip.z + Math.sin(b) * shape.reach * 0.45);
      });
      // The limb runs on into its first twig; the second leaves it at the tip.
      limb([fork.clone().multiplyScalar(0.92), tip, twigs[0]], [0.04, 0.022, 0.008], 6);
      limb([tip, twigs[1]], [0.02, 0.008], 4);
      for (const twig of twigs) cluster(twig, shape.crown[0], shape.crown[1], shape.cards, kind === "columnar" ? 0.22 : 0.32);
    }
    // The middle of the crown, so it is not hollow from below.
    cluster(V(0, fork.y + shape.rise * 1.15, 0), shape.crown[0] * 1.4, shape.crown[1] * 1.2, 14, 0.34);
  }
  const group = new THREE.Group();
  const barkColour = kind === "palm" ? 0x7a6a55 : kind === "conifer" ? 0x4a3a2c : 0x5a4a3a;
  let barkGeometry;
  if (tubes) {
    barkGeometry = new THREE.BufferGeometry();
    barkGeometry.setAttribute("position", new THREE.Float32BufferAttribute(tubes.position, 3));
    barkGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(tubes.normal, 3));
    barkGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(tubes.uv, 2));
  } else barkGeometry = mergeParts(bark);
  const barkMesh = new THREE.Mesh(barkGeometry, tubes ? treeBarkMaterial(kind, barkColour)
    : new THREE.MeshStandardMaterial({ color: barkColour, roughness: 0.95 }));
  barkMesh.geometry.computeBoundingSphere();
  group.add(barkMesh);
  const leafKind = kind === "palm" ? "palm" : kind === "conifer" ? "conifer" : "broad";
  const leafMap = treeLeafTexture(leafKind), leafNormal = TREE_LEAF_NORMALS.get(leafKind);
  const leafMaterial = new THREE.MeshStandardMaterial({
    map: leafMap, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: leafNormal ? 0.72 : 0.85, metalness: 0.0,
    ...(leafNormal ? { normalMap: leafNormal, normalScale: new THREE.Vector2(0.9, 0.9) } : {}) });
  // A far crown keeps its leaves (vegetation-geometry.mjs: its alpha held up in the texture's
  // smaller versions), rather than thinning to a bare trunk.
  vegetationLibrary?.keepLeavesAtDistance?.(leafMaterial, leafMap.image?.width || 128);
  const leafMesh = new THREE.Mesh(mergeParts(leaves), leafMaterial);
  // Lit as a crown, not as cards; and swayed by the wind (foliage-motion.mjs).
  vegetationLibrary?.foliageNormals?.(leafMesh.geometry.getAttribute("position").array,
    leafMesh.geometry.getAttribute("normal").array);
  leafMesh.geometry.computeBoundingSphere();
  group.add(leafMesh);
  foliageMotion?.apply(barkMesh.material, "bark");
  foliageMotion?.apply(leafMesh.material, "leaves");
  return group;
}
//: A tree's size: what the lidar measured where it measured one (its height and its crown,
//: tools/plant_lidar_trees.py), else the trunk the city measured -- roughly a foot of tree per
//: inch of diameter, capped where the prototype stops looking like the kind. A measured tree is
//: scaled to its own height and spread, within the kind's believable proportions; the trunk
//: rule capped every lidar tree at nine metres, a quarter of the tallest the city has.
function treeScale(tree, kind, protoHeight, protoRadius) {
  const maxScale = kind === "palm" ? 5.6 : kind === "columnar" ? 6.2 : kind === "conifer" ? 7.0 : 7.4;
  const byTrunk = Math.max(2.2, Math.min(maxScale, tree.d * 0.34));
  if (!(tree.h > 0) || !(protoHeight > 0)) return [byTrunk, byTrunk];
  const up = Math.min(60, tree.h) / protoHeight;
  const across = tree.crown_m > 0 && protoRadius > 0 ? (tree.crown_m / 2) / protoRadius : up;
  return [Math.max(up * 0.45, Math.min(up * 1.6, across)), up];
}

// ---- the understorey in the parks ----
//
// Under the park trees -- Golden Gate Park's woods, the Presidio's edges, a square's planes --
// the ground is shrubs and ferns, not mown turf. The city's inventory has the trees and none of
// what grows under them, so this is the landscape's own visual prior (nature-ecology.mjs's
// understorey, by how moist the fog belt keeps it) placed only beneath a tree's crown, only on
// park ground and only where grass would grow: never on a path, a court or a wall. Inferred,
// and marked so; a lawn in the open stays a lawn.
let understoreyReady = null;
function buildParkUnderstorey(trees) {
  const assets = vegetationLibrary?.vegetationAssets?.(THREE), at = vegetationLibrary?.undergrowthAt;
  if (!assets || !at || !grassSampleAt || !grassSurfaceAt) return null;
  const dummy = new THREE.Object3D(), colour = new THREE.Color(), colours = vegetationLibrary.UNDERGROWTH || {};
  const kind_of_tree = (tree) => tree.v || "street";
  const items = new Map(), litter = new Map(), sticks = [], stats = { trees: 0, plants: 0, litter: 0, deadwood: 0, inferred: true,
    basis: "nature-ecology understorey and litter priors under mapped crowns" };
  const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3(), q = new THREE.Quaternion(), yaw = new THREE.Quaternion();
  const placed = new Set();
  for (const tree of trees) {
    const [tx, ty] = xy(tree.p[0], tree.p[1]), tz = -ty;
    const centre = grassSampleAt(tx + 1.2, tz) || grassSampleAt(tx - 1.2, tz) || grassSampleAt(tx, tz + 1.2);
    if (!centre?.park) continue;
    stats.trees += 1;
    const crown = tree.crown_m ? tree.crown_m / 2 : Math.max(2, Math.min(6, (tree.d || 8) * 0.22));
    const [lon] = tree.p;
    // The fog belt west of Twin Peaks keeps a forest floor moist; downtown it is drier.
    const moisture = 0.45 + 0.35 * Math.max(0, Math.min(1, (-122.42 - lon) / 0.08));
    for (let k = 0; k < 14; k += 1) {
      const a = random(tree.p[0] * 1e6 + k * 17) * Math.PI * 2, r = crown * (0.25 + 0.85 * Math.sqrt(random(tree.p[1] * 1e6 + k * 29)));
      const x = tx + Math.cos(a) * r, z = tz + Math.sin(a) * r, key = `${Math.round(x / 1.5)}:${Math.round(z / 1.5)}`;
      if (placed.has(key)) continue;
      const ground = grassSampleAt(x, z);
      if (!ground?.park) continue;
      const plant = at(x, z, { cover: 41, water: false, moisture,
        habitat: { canopy: 65, forest: 0.85, scrub: 0.1, grass: 0.05, wetland: 0, developed: 0 } });
      if (!plant) continue;
      placed.add(key);
      if (!items.has(plant.kind)) items.set(plant.kind, []);
      items.get(plant.kind).push({ x, y: ground.y, z, r: plant.radius, h: plant.height, turn: a * 3.1 });
    }
    // And what has fallen from it: litter laid on the ground's slope, and sticks. No logs: a
    // city park's deadwood is cleared.
    if (kind_of_tree(tree) === "palm" || !vegetationLibrary.litterScatter) continue;
    const fall = vegetationLibrary.litterScatter(tx, tz, crown, kind_of_tree(tree) === "conifer" ? "pine" : "oak", { seed: 17 });
    for (const patch of fall.patches) {
      const ground = grassSampleAt(patch.x, patch.y);
      if (!ground?.park) continue;
      const e = grassSurfaceAt(patch.x + 1, patch.y), n = grassSurfaceAt(patch.x, patch.y - 1);
      normal.set(0, 1, 0);
      if (Number.isFinite(e) && Number.isFinite(n)) normal.set(-(e - ground.y), 1, (n - ground.y)).normalize();
      q.setFromUnitVectors(up, normal).multiply(yaw.setFromAxisAngle(up, patch.turn));
      if (!litter.has(patch.kind)) litter.set(patch.kind, []);
      litter.get(patch.kind).push({ x: patch.x, y: ground.y + 0.02, z: patch.y, size: patch.size * 0.8, q: q.toArray(), shade: patch.shade });
    }
    for (const stick of fall.sticks) {
      const ground = grassSampleAt(stick.x, stick.y);
      if (ground?.park) sticks.push({ x: stick.x, y: ground.y + stick.radius * 0.7, z: stick.y, ...stick });
    }
  }
  const assetsLitter = assets.litter && assets.deadwood;
  for (const [kind, list] of assetsLitter ? litter : []) {
    const part = assets.litter(kind), mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
    list.forEach((v, i) => {
      dummy.position.set(v.x, v.y, v.z); dummy.quaternion.fromArray(v.q); dummy.scale.set(v.size, 1, v.size); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, colour.setRGB(v.shade, v.shade, v.shade));
    });
    mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    mesh.userData = { surface: `litter:${kind}`, inferred: true, liftedOntoGround: true, confidence: "visual prior under mapped tree crowns" };
    if (BUILD_WINDOW) applyBoxClip(mesh, detailClipBox);
    groups.ground.add(mesh); stats.litter += list.length;
  }
  if (assetsLitter && sticks.length) {
    const part = assets.deadwood("stick"), mesh = new THREE.InstancedMesh(part.geometry, part.material, sticks.length);
    sticks.forEach((v, i) => {
      dummy.position.set(v.x, v.y, v.z); dummy.rotation.set(0, v.turn, 0); dummy.scale.set(v.length, v.radius, v.radius); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.computeBoundingSphere(); mesh.receiveShadow = true;
    mesh.userData = { surface: "deadwood:stick", inferred: true, liftedOntoGround: true };
    if (BUILD_WINDOW) applyBoxClip(mesh, detailClipBox);
    groups.ground.add(mesh); stats.deadwood += sticks.length;
  }
  for (const [kind, list] of items) {
    const part = assets.undergrowth(kind);
    foliageMotion?.apply(part.material, "shrub");
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
    list.forEach((v, i) => {
      dummy.position.set(v.x, v.y, v.z); dummy.scale.set(v.r, v.h, v.r); dummy.rotation.set(0, v.turn, 0); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const shade = 0.82 + random(i * 13 + kind.length) * 0.32;
      mesh.setColorAt(i, colour.setRGB(...(colours[kind]?.colour || [0.29, 0.39, 0.18]).map((c) => c * shade), THREE.SRGBColorSpace));
    });
    mesh.computeBoundingSphere();
    mesh.userData = { surface: `understorey:${kind}`, inferred: true, liftedOntoGround: true,
      confidence: "visual prior under mapped tree crowns; not surveyed plants" };
    if (BUILD_WINDOW) applyBoxClip(mesh, detailClipBox);
    groups.ground.add(mesh);
    stats.plants += list.length;
  }
  return stats;
}

// ---- garden fences ----
//
// The city surveys every property line, so the fences do not have to be guessed at -- but a
// property line is not a fence. Three quarters of one is. The part facing the street is open,
// the part running along a wall is the wall, and the boundary between two neighbours carries one
// fence rather than one each. Which edges survive those three tests is decided in the build,
// against the road band and the building footprints, so what arrives here is already only the
// inner lines. The kind is chosen per block: a block was laid out at one time by one builder,
// and its back fences match.
const FENCE_STYLE = {
  // Heights are the ones the build stamped on them, and the colours are stated well down from
  // the real thing for the same reason the court palette is -- this scene runs about two and a
  // half stops hot on a flat diffuse surface.
  board:      { h: 1.83, tile: 1.5, colour: 0x3a2b20, kind: "board" },
  board_tall: { h: 2.13, tile: 1.5, colour: 0x33302a, kind: "board" },
  picket:     { h: 1.07, tile: 1.2, colour: 0x8f9490, kind: "picket" },
  chainlink:  { h: 1.52, tile: 0.6, colour: 0xc6ced2, kind: "chainlink" },
  wall:       { h: 1.22, tile: 2.0, colour: 0x4a463f, kind: "wall" },
};

function boardTexture(colour) {
  // Vertical redwood boards about fifteen centimetres wide, with a dark line where they meet
  // and a rail shadow across the middle. The variation between boards is the whole trick: a
  // flat brown plane reads as a wall, and a fence is a row of separate pieces of wood.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#" + colour.toString(16).padStart(6, "0");
  ctx.fillRect(0, 0, size, size);
  const boards = 10;                                  // 1.5 m of fence, so 15 cm boards
  for (let i = 0; i < boards; i += 1) {
    const x = (i * size) / boards;
    const shade = (random(i * 13) - 0.5) * 0.28;
    ctx.fillStyle = shade > 0 ? `rgba(255,240,220,${shade})` : `rgba(0,0,0,${-shade})`;
    ctx.fillRect(x, 0, size / boards - 1, size);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x + size / boards - 1, 0, 1, size);   // the gap between two boards
    for (let g = 0; g < 14; g += 1) {                 // grain
      ctx.fillStyle = random(i * 31 + g) < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.06)";
      ctx.fillRect(x + random(i * 7 + g) * (size / boards), random(i * 11 + g) * size,
                   1, 6 + random(g) * 22);
    }
  }
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, size * 0.52, size, 3);              // the horizontal rail behind the boards
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function picketTexture(colour) {
  // Nine centimetre pickets with five centimetre gaps, on a 1.2 m tile, and the gaps are gaps:
  // you can see the garden through a picket fence, which is most of what makes it one.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const pitch = size * 0.14 / 1.2 * 1.2;              // 14 cm centres over a 1.2 m tile
  const wide = pitch * 0.64;
  const paint = "#" + colour.toString(16).padStart(6, "0");
  for (let x = 0; x < size; x += pitch) {
    ctx.fillStyle = paint;
    // Pickets stop short of the top of the tile so the fence has a profile, not a straight edge.
    ctx.fillRect(x, size * 0.06, wide, size);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(x + wide - 1, size * 0.06, 1, size);
  }
  ctx.fillStyle = paint;
  ctx.fillRect(0, size * 0.30, size, size * 0.07);    // top rail
  ctx.fillRect(0, size * 0.78, size, size * 0.07);    // bottom rail
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function wallTexture(colour) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#" + colour.toString(16).padStart(6, "0");
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.5; i += 1) {
    ctx.fillStyle = random(i * 5) < 0.5 ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.07)";
    ctx.fillRect(random(i * 3) * size, random(i * 7) * size, 1, 1);
  }
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(0, 0, size, 4);                        // the coping along the top
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function fenceMaterial(style) {
  const shared = { side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0 };
  if (style.kind === "chainlink") {
    return new THREE.MeshStandardMaterial({
      ...shared, map: chainlinkTexture(), color: style.colour,
      alphaTest: 0.55, roughness: 0.55, metalness: 0.45,
    });
  }
  if (style.kind === "picket") {
    return new THREE.MeshStandardMaterial({
      ...shared, map: picketTexture(style.colour), color: 0xffffff, alphaTest: 0.5,
    });
  }
  if (style.kind === "wall") {
    return new THREE.MeshStandardMaterial({
      ...shared, map: wallTexture(style.colour), color: 0xffffff, roughness: 0.95,
    });
  }
  return new THREE.MeshStandardMaterial({
    ...shared, map: boardTexture(style.colour), color: 0xffffff, roughness: 0.94,
  });
}

function addGround(mesh, what) {
  mesh.userData.surface = what;
  // Covers follow the excavated visual terrain, including the soil beneath a
  // retaining wall. Using the uncut property height stretched a paved sheet
  // from the approach road up through the wall as a row of white spikes.
  // Buildings and independently grounded fence panels keep their own anchors.
  if(APPROACH_CUTS.length && /^(yard|park|plaza|front_walk|service_yard|neutral_ground|court|inferred:)/.test(what))
    mesh.userData.groundLiftFunction=trenchGroundAt;
  // Like mapped plazas, fine grass surfaces must replace (not depth-fight) the
  // coarse terrain backdrop. Hard-surface masks remain authoritative, and roads,
  // pavements and buildings draw afterward with normal depth testing.
  if (what === "yard" || what === "park") mesh.renderOrder = -1;
  // A mapped sports pad replaces the backdrop just as paving does. The backdrop and the
  // pad use different terrain tessellations; depth-testing the finer pad against the coarse
  // backdrop exposed triangular green patches even where the grass mask was entirely zero.
  if (!HEADSET && (what === "court" || what === "court_line")) {
    mesh.material.depthTest = false;
    mesh.renderOrder = what === "court_line" ? -0.4 : -0.5;
  }
  groups.ground.add(mesh);
  return mesh;
}

const FENCE_GROUND_STEP_M = .75;
function groundedFencePanel(sink, ax, az, bx, bz, baseY, height, tileU, tileV = tileU) {
  const span=Math.hypot(bx-ax,bz-az);
  if (!(span>0) || !Number.isFinite(span)) return;
  const count=Math.max(1,Math.ceil(span/FENCE_GROUND_STEP_M));
  const base=sink.positions.length/3;
  for(let k=0;k<=count;k++) {
    const t=k/count,x=ax+(bx-ax)*t,z=az+(bz-az)*t;
    const ground=groundLiftAt(x,z)+baseY;
    // Thirty-five mm buried at each sample prevents pinholes along the bottom;
    // the top remains the intended fence height above the sampled ground.
    sink.positions.push(x,ground-.035,z,x,ground+height,z);
    sink.uvs.push(span*t/tileU,0,span*t/tileU,height/tileV);
    if(k) {
      const a=base+(k-1)*2,b=a+2;
      sink.indices.push(a,b,b+1,a,b+1,a+1);
    }
  }
}

function buildFences(ground) { return runSteps(buildFencesSteps(ground)); }
//: A kind at a time, and 64 segments at a time inside one (each is tested along its run against
//: the carriageway): a city's fences in one go were a fifth of a second.
function* buildFencesSteps(ground) {
  // Segments arrive as flat metres in the same frame the world is laid out in, grouped by the
  // kind their block was assigned. One merged mesh per kind, so five draw calls for the city.
  const fences = ground.fences || {};
  for (const kind of Object.keys(fences)) {
    const style = FENCE_STYLE[kind];
    const flat = fences[kind];
    if (!style || !flat || !flat.length) continue;
    const positions = [];
    const uvs = [];
    const indices = [];
    yield;
    for (let i = 0; i + 3 < flat.length; i += 4) {
      if ((i & 255) === 252) yield;
      const ax = flat[i], az = -flat[i + 1];
      const bx = flat[i + 2], bz = -flat[i + 3];
      const span = Math.hypot(bx - ax, bz - az);
      if (span < 0.4) continue;
      // In the headset, only the fences in the square: the rest of the region's are clipped
      // away on the desktop, but are still drawn.
      if (HEADSET && WINDOW_BOXES && !detailClipBox.value.some((b) => b.z >= b.x
        && Math.max(ax, bx) >= b.x - 10 && Math.min(ax, bx) <= b.z + 10
        && Math.max(az, bz) >= b.y - 10 && Math.min(az, bz) <= b.w + 10)) continue;
      // A last check against the one authority on where the road is. Along the run, not at its
      // two ends: a boundary fence can have both of its posts on somebody's lawn and pass clean
      // through the street in between, and testing only the endpoints let 35 of them do exactly
      // that. The build tests these too; between the two a fence across a carriageway cannot
      // survive either of them.
      let crosses = false;
      const checks = Math.max(2, Math.ceil(span / 2.0));
      for (let c = 0; c <= checks; c += 1) {
        const t = c / checks;
        if (insideCarriageway(ax + (bx - ax) * t, az + (bz - az) * t, 0.15)) {
          crosses = true;
          break;
        }
      }
      if (crosses) continue;
      groundedFencePanel({positions,uvs,indices},ax,az,bx,bz,YARD_Y,style.h,style.tile);
    }
    if (!indices.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const fence=addGround(new THREE.Mesh(geom, fenceMaterial(style)), "fence:" + kind);
    fence.userData.liftedOntoGround=true;
    fence.userData.elevationBasis="terrain_sampled_0.75m";
  }
}

// ---- courts and fields ----
//
// A tennis court is not a green rectangle. It is 23.77 by 10.97 metres of doubles court with the
// singles lines 1.37 inside that, service lines 6.40 from the net, a centre service line, a net
// that sags from 1.07 at the posts to 0.914 in the middle, and, in a city, a chainlink fence
// round the lot. Every one of those numbers is published by the sport, and every one of them is
// the same scale as the kerb heights and lane widths the rest of this model is drawn to, so the
// courts are drawn from the rulebook rather than from a sketch of one.
//
// What comes from the map is where they are, which way they face and how many there are: the
// pitch polygon gives a bearing and two dimensions, and the count is that rectangle divided by
// the size of a court. Moscone has the courts Moscone has.
//
// The colours are stated darker than the paint is. This scene carries a hemisphere light at
// 1.15 and a sun at 2.0 over ACES tone mapping, which is about two and a half stops of gain on
// a flat diffuse surface: a true court green of 0x41805f came out of it as pale cyan, closer to
// concrete than to acrylic. These are the colours that land right after the light, not before.
//: A floodlight mast (tower:type=lighting): the poles round the courts and fields. They were drawn
//: as cell masts, thirty metres with three sectors of antennas, some of them in the middle of a
//: tennis court where the map's point fell. A court's lights are about twelve metres, a head of
//: lamps tilted down at the court, and they stand round it: one whose point falls on a court
//: pad is put just outside its edge (COURT_LIGHT_OUT_M past it).
const FLOODLIGHT_DEFAULT_M = 12;
const COURT_LIGHT_OUT_M = 0.8;
//: The hard courts' pads in this page's metres (buildCourts), and the floodlights to seat round them.
const COURT_PADS = [];
let courtLights = null;
const COURT_STYLE = {
  tennis:     { surround: 0x1d3a2c, play: 0x28503b, line: 0.05, net: 1.07, netMid: 0.914,
                fence: 3.66 },
  pickleball: { surround: 0x1d3a2c, play: 0x1a4362, line: 0.05, net: 0.914, netMid: 0.86,
                fence: 3.05 },
  basketball: { surround: 0x25282c, play: 0x213e4c, line: 0.05, fence: 3.05 },
  basketball_half: { surround: 0x25282c, play: 0x213e4c, line: 0.05, fence: 3.05 },
  basketball_hoop: { surround: 0x25282c, play: 0x282c31, line: 0.05, fence: 3.05, bleed: 0.0 },
  volleyball: { surround: 0x25282c, play: 0x61492b, line: 0.05, net: 2.43, netMid: 2.43,
                fence: 3.05 },
  soccer:     { surround: null,     play: null,     line: 0.12 },
};

function courtSurface(color) {
  // Acrylic over asphalt: an even, slightly speckled colour. The speckle is what stops a flat
  // fill reading as a decal rather than as a surface somebody laid.
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.35; i += 1) {
    ctx.fillStyle = random(i * 3) < 0.5 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.10)";
    ctx.fillRect(random(i * 5) * size, random(i * 7) * size, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  // The canvas is painted in sRGB. Untagged, three.js read these darks as linear and lifted
  // them: the tennis green came out the pale mint of a swimming pool, and a court read as a
  // sheet of glass over the grass rather than as acrylic laid on asphalt.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  return texture;
}

function chainlinkTexture() {
  // Diamond mesh on a transparent ground, one 0.6 m tile. Drawn as lines rather than as a
  // greyed-out plane so that it thins out at a distance the way real fencing does.
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(196,204,208,1)";
  ctx.lineWidth = 1.4;
  for (let i = -size; i < size * 2; i += 11) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i + size, 0); ctx.lineTo(i, size); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function netTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(28,30,32,0.92)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= size; i += 6) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  // The white band along the top of a tennis net, which is the part you actually see.
  ctx.fillStyle = "rgba(240,242,238,0.96)";
  ctx.fillRect(0, 0, size, 7);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// A painter that works in one court's own coordinates: du along the length from the centre, dv
// across the width. Everything below is written in the units the rulebook uses.
function courtPainter(court, sink) {
  const [cx, cy] = xy(court.c[0], court.c[1]);
  const cz = -cy;
  const ca = Math.cos(court.a), sa = Math.sin(court.a);
  // The bearing was measured in the (east, north) frame the ground cover works in; here north
  // is -z, so the along-length axis picks up the sign flip and the across axis follows from it.
  const ux = ca, uz = -sa;
  const vx = -sa, vz = -ca;
  return {
    at(du, dv) { return [cx + ux * du + vx * dv, cz + uz * du + vz * dv]; },
    // A painted rectangle: `along` metres down the court, `across` metres over it.
    patch(du, dv, along, across, y) {
      const hl = along / 2, hw = across / 2;
      const corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]
        .map(([a, b]) => this.at(du + a, dv + b));
      const base = sink.positions.length / 3;
      for (const [x, z] of corners) { sink.positions.push(x, y, z); sink.uvs.push(x / 4, z / 4); }
      sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    },
    line(du, dv, along, across, width, y) {
      // A marking is a rectangle of paint. Along-court lines are `width` wide across, and
      // across-court lines are `width` wide along, which is how they meet square at the corners.
      if (along > across) this.patch(du, dv, along, width, y);
      else this.patch(du, dv, width, across, y);
    },
    arc(du, dv, radius, from, to, width, y, steps = 40) {
      // Circles are the one thing on a court that is not a rectangle, so they are drawn as a
      // ring of short rectangles -- enough of them that a nine metre centre circle reads round.
      const span = to - from;
      for (let i = 0; i < steps; i += 1) {
        const t0 = from + (span * i) / steps;
        const t1 = from + (span * (i + 1)) / steps;
        const a0 = [du + Math.cos(t0) * radius, dv + Math.sin(t0) * radius];
        const a1 = [du + Math.cos(t1) * radius, dv + Math.sin(t1) * radius];
        const mid = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2];
        const len = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) * 1.25;
        const theta = Math.atan2(a1[1] - a0[1], a1[0] - a0[0]);
        const c = Math.cos(theta), s = Math.sin(theta);
        const corners = [[-len / 2, -width / 2], [len / 2, -width / 2],
                         [len / 2, width / 2], [-len / 2, width / 2]]
          .map(([a, b]) => this.at(mid[0] + a * c - b * s, mid[1] + a * s + b * c));
        const base = sink.positions.length / 3;
        for (const [x, z] of corners) { sink.positions.push(x, y, z); sink.uvs.push(x / 4, z / 4); }
        sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    },
  };
}

function markCourt(court, paint) {
  const style = COURT_STYLE[court.s];
  const w = style.line;
  const y = COURT_LINE_Y;
  const L = court.l, W = court.w;
  if (court.s === "tennis") {
    // ITF: doubles 23.77 x 10.97, singles sidelines 1.37 in, service lines 6.40 from the net.
    paint.line(0, -W / 2, L, w, w, y);
    paint.line(0, W / 2, L, w, w, y);
    paint.line(0, -W / 2 + 1.37, L, w, w, y);
    paint.line(0, W / 2 - 1.37, L, w, w, y);
    paint.line(-L / 2, 0, w, W, w, y);
    paint.line(L / 2, 0, w, W, w, y);
    paint.line(-6.40, 0, w, W - 2.74, w, y);
    paint.line(6.40, 0, w, W - 2.74, w, y);
    paint.line(0, 0, 12.80, w, w, y);              // centre service line
    paint.line(-L / 2 + 0.05, 0, 0.10, w, w, y);   // centre marks on the baselines
    paint.line(L / 2 - 0.05, 0, 0.10, w, w, y);
  } else if (court.s === "pickleball") {
    // USA Pickleball: 44 x 20 feet, non-volley zone 7 feet either side of the net.
    paint.line(0, -W / 2, L, w, w, y);
    paint.line(0, W / 2, L, w, w, y);
    paint.line(-L / 2, 0, w, W, w, y);
    paint.line(L / 2, 0, w, W, w, y);
    paint.line(-2.13, 0, w, W, w, y);              // kitchen lines
    paint.line(2.13, 0, w, W, w, y);
    paint.line(-(2.13 + (L / 2 - 2.13) / 2), 0, L / 2 - 2.13, w, w, y);
    paint.line(2.13 + (L / 2 - 2.13) / 2, 0, L / 2 - 2.13, w, w, y);
  } else if (court.s === "basketball") {
    // The key is 5.79 by 4.88, the restricted circle 1.80, the arc 6.75 from the basket with
    // 0.90 straight in the corners -- the FIBA figures, which is what a public court is built to.
    paint.line(0, -W / 2, L, w, w, y);
    paint.line(0, W / 2, L, w, w, y);
    paint.line(-L / 2, 0, w, W, w, y);
    paint.line(L / 2, 0, w, W, w, y);
    paint.line(0, 0, w, W, w, y);                  // halfway line
    paint.arc(0, 0, 1.80, 0, Math.PI * 2, w, y);
    for (const end of [-1, 1]) {
      const baseline = end * L / 2;
      const key = baseline - end * 5.79 / 2;
      paint.line(key, -4.88 / 2, 5.79, w, w, y);
      paint.line(key, 4.88 / 2, 5.79, w, w, y);
      paint.line(baseline - end * 5.79, 0, w, 4.88, w, y);
      paint.arc(baseline - end * 5.79, 0, 1.80, 0, Math.PI * 2, w, y, 28);
      // The three point line: 0.90 from each sideline until the arc meets it.
      const hoop = baseline - end * 1.575;
      const straight = W / 2 - 0.90;
      const reach = Math.sqrt(Math.max(0, 6.75 * 6.75 - straight * straight));
      for (const side of [-1, 1]) {
        const from = baseline;
        const to = hoop - end * reach;
        paint.line((from + to) / 2, side * straight, Math.abs(to - from), w, w, y);
      }
      const half = Math.acos(Math.min(1, straight / 6.75));
      paint.arc(hoop, 0, 6.75, end > 0 ? Math.PI - half : -half,
                end > 0 ? Math.PI + half : half, w, y, 34);
    }
  } else if (court.s === "basketball_half") {
    // One basket, one key, one arc, and a line across the top where the full court would carry
    // on. The dimensions are the full court's; it is only the second half that is missing.
    paint.line(0, -W / 2, L, w, w, y);
    paint.line(0, W / 2, L, w, w, y);
    paint.line(-L / 2, 0, w, W, w, y);
    paint.line(L / 2, 0, w, W, w, y);
    const baseline = -L / 2;
    paint.line(baseline + 5.79 / 2, -4.88 / 2, 5.79, w, w, y);
    paint.line(baseline + 5.79 / 2, 4.88 / 2, 5.79, w, w, y);
    paint.line(baseline + 5.79, 0, w, 4.88, w, y);
    paint.arc(baseline + 5.79, 0, 1.80, 0, Math.PI * 2, w, y, 28);
    const hoop = baseline + 1.575;
    const straight = W / 2 - 0.90;
    const reach = Math.sqrt(Math.max(0, 6.75 * 6.75 - straight * straight));
    for (const side of [-1, 1]) {
      paint.line((baseline + hoop + reach) / 2, side * straight,
                 Math.abs(hoop + reach - baseline), w, w, y);
    }
    const half = Math.acos(Math.min(1, straight / 6.75));
    paint.arc(hoop, 0, 6.75, -half, half, w, y, 34);
  } else if (court.s === "volleyball") {
    paint.line(0, -W / 2, L, w, w, y);
    paint.line(0, W / 2, L, w, w, y);
    paint.line(-L / 2, 0, w, W, w, y);
    paint.line(L / 2, 0, w, W, w, y);
    paint.line(-3.0, 0, w, W, w, y);               // attack lines
    paint.line(3.0, 0, w, W, w, y);
  } else if (court.s === "soccer") {
    // The laws give ranges rather than one size, so the penalty area and the circle are fixed
    // (16.5 and 9.15 are not negotiable) and the pitch itself takes the size of the ground.
    paint.line(0, -W / 2, L, w, w, y);
    paint.line(0, W / 2, L, w, w, y);
    paint.line(-L / 2, 0, w, W, w, y);
    paint.line(L / 2, 0, w, W, w, y);
    paint.line(0, 0, w, W, w, y);
    // On a full pitch these are the laws' own figures. On a small-sided one they are scaled to
    // the ground, because a 9.15 metre centre circle on a twelve metre pitch would cross both
    // touchlines -- and most of the soccer in this corridor is played small-sided.
    const circle = Math.min(9.15, W * 0.16 + 1.0);
    paint.arc(0, 0, circle, 0, Math.PI * 2, w, y, 48);
    paint.patch(0, 0, 0.30, 0.30, y);
    for (const end of [-1, 1]) {
      const baseline = end * L / 2;
      const penalty = Math.min(16.5, L / 2 - 2);
      const penaltyW = Math.min(40.32, W - 2);
      const goalArea = Math.min(5.5, penalty / 2);
      const goalW = Math.min(18.32, penaltyW / 2);
      paint.line(baseline - end * penalty / 2, -penaltyW / 2, penalty, w, w, y);
      paint.line(baseline - end * penalty / 2, penaltyW / 2, penalty, w, w, y);
      paint.line(baseline - end * penalty, 0, w, penaltyW, w, y);
      paint.line(baseline - end * goalArea / 2, -goalW / 2, goalArea, w, w, y);
      paint.line(baseline - end * goalArea / 2, goalW / 2, goalArea, w, w, y);
      paint.line(baseline - end * goalArea, 0, w, goalW, w, y);
      paint.patch(baseline - end * Math.min(11.0, penalty * 0.66), 0, 0.30, 0.30, y);
    }
  }
}

function courtPostPoints(ax,az,bx,bz,h,headset) {
  const span=Math.hypot(bx-ax,bz-az), points=[];
  if(!(span>0))return points;
  if(headset) {
    // Attached Quest windows consume the regional viewer too: preserve their current posts.
    for(let d=0;d<span;d+=3)points.push([ax+(bx-ax)*d/span,az+(bz-az)*d/span,h]);
  } else {
    const bays=Math.max(1,Math.ceil(span/3));
    for(let j=0;j<=bays;j++)points.push([ax+(bx-ax)*j/bays,az+(bz-az)*j/bays,h]);
  }
  return points;
}
function applyCourtLayout(ground,evidence,headset) {
  const layout=evidence?.court_layout;
  if(headset || layout?.schema!=="kerbside.park_courts/1")return ground;
  const near=record=>!BUILD_WINDOW || BUILD_WINDOW.near(record.c || record.p);
  return {...ground,courts:layout.courts.filter(near),
    pitches:[...(layout.pitches || []).filter(near),...layout.pads.filter(near).map(p=>({...p,physicalPad:true}))],
    court_complexes:(layout.court_complexes || []).filter(near)};
}
function buildCourts(ground) {
  const courts = ground.courts || [];
  // A block of adjoining courts is one pad with one fence round it, not a fenced island per
  // court (smc.ground.courts.court_complexes): a pitch in a block that has arrived is drawn as
  // part of it. One whose block is in a cell not yet fetched is drawn on its own, as before.
  const complexes = ground.court_complexes || [];
  const inBlock = new Set(complexes.map((c) => c.id));
  const pitches = [...(ground.pitches || []).filter((p) => !inBlock.has(p.k)),
    ...complexes.map((c) => ({ s: c.s, p: c.p, block: true, dividers: c.d || [] }))];
  if (!courts.length && !pitches.length) return;

  // The ground each pitch stands on round its courts: the grass of the park it is in. It was a
  // dark green acrylic pad out to the mapped pitch's edge, which in the parks here is the lawn
  // the courts are set in, and it read as a dark patch that belonged to nothing. The courts'
  // own coloured surfaces (below) run their run-off past the lines; the fields are grass anyway.
  const parkVariantAt = (lon, lat) => {
    const park = (ground.parks || []).find((q) => pointInRing(lon, lat, q.p));
    return park ? grassVariantForRing(park.p, GRASS_VARIANTS) : 0;
  };
  const byVariant = new Map();
  for (const pitch of pitches) {
    if (!COURT_STYLE[pitch.s]) continue;
    const [lon, lat] = ringCentroid(pitch.p);
    const variant = COURT_STYLE[pitch.s].surround === null ? -1 : parkVariantAt(lon, lat);
    if (!byVariant.has(variant)) byVariant.set(variant, []);
    byVariant.get(variant).push(pitch.p);
  }
  for (const [variant, rings] of byVariant) {
    const geom = ringGeometry(rings, COURT_Y);
    if (!geom) continue;
    // The pad is lifted onto the hill at its own triangles' corners and a court's surface at its
    // own, a few centimetres apart over a court's length, and the pad's triangles came up through
    // the courts in patches. It is drawn before them and leaves the depth alone, so a court laid
    // on it is always over it; on the park it is grass on grass.
    const pad = addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      map: variant < 0 ? grassTexture() : grassTexture("park", variant),
      color: 0xffffff, roughness: 0.97, metalness: 0.0, side: THREE.DoubleSide, depthWrite: false,
    })), "court");
    pad.renderOrder = -0.5;
  }
  // Where the hard courts are, for the floodlights to stand round rather than on them.
  COURT_PADS.length = 0;
  for (const pitch of pitches) {
    if (!COURT_STYLE[pitch.s] || COURT_STYLE[pitch.s].surround === null) continue;
    const local = pitch.p.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    const [cx, cz] = ringCentroid(local);
    COURT_PADS.push({ local, cx, cz });
  }
  seatCourtLights();

  // The playing surfaces, then the paint. Two merged meshes for the whole city.
  const surfaces = new Map();
  const lines = { positions: [], uvs: [], indices: [] };
  const netQuads = [];
  const posts = [];
  const hoops = [];
  for (const court of courts) {
    const style = COURT_STYLE[court.s];
    if (!style) continue;
    const paint = courtPainter(court, lines);
    if (style.play !== null) {
      if (!surfaces.has(court.s)) surfaces.set(court.s, { positions: [], uvs: [], indices: [] });
      const surface = courtPainter(court, surfaces.get(court.s));
      // The coloured surface runs a little past the outside of the lines, as it is laid.
      const bleed = style.bleed === undefined ? 1.2 : style.bleed;
      surface.patch(0, 0, court.l + bleed, court.w + bleed, COURT_Y + 0.002);
    }
    markCourt(court, paint);

    if (style.net) {
      const a = paint.at(0, -court.w / 2 - 0.4);
      const b = paint.at(0, court.w / 2 + 0.4);
      netQuads.push([a, b, style.net, style.netMid]);
      posts.push([a, style.net], [b, style.net]);
    }
    const ends = court.s === "basketball" ? [-1, 1]
      : (court.s === "basketball_half" || court.s === "basketball_hoop") ? [-1] : [];
    for (const end of ends) {
      hoops.push({ at: paint.at(end * (court.l / 2 - 1.2), 0),
                   support: !HEADSET ? paint.at(end * (court.l / 2 + 0.45), 0) : null,
                   face: paint.at(end * (court.l / 2 - 1.2) + end * 1.0, 0) });
    }
  }

  for (const [sport, sink] of surfaces) {
    if (!sink.indices.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
    geom.setIndex(sink.indices);
    geom.computeVertexNormals();
    addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      map: courtSurface(COURT_STYLE[sport].play), color: 0xffffff,
      roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    })), "court");
  }
  if (lines.indices.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(lines.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(lines.uvs, 2));
    geom.setIndex(lines.indices);
    geom.computeVertexNormals();
    addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color: 0xf1f3ef, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    })), "court_line");
  }

  // Nets. A tennis net is not a flat sheet -- it is 1.07 at the posts and 0.914 in the middle,
  // and that sag is most of what makes it look like a net rather than a wall.
  if (netQuads.length) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (const [a, b, high, mid] of netQuads) {
      const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = 10;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = a[0] + (b[0] - a[0]) * t;
        const z = a[1] + (b[1] - a[1]) * t;
        const top = high + (mid - high) * Math.sin(Math.PI * t);
        positions.push(x, COURT_Y, z, x, COURT_Y + top, z);
        uvs.push(t * span / 1.2, 0, t * span / 1.2, top / 1.2);
      }
      const base = positions.length / 3 - (steps + 1) * 2;
      for (let i = 0; i < steps; i += 1) {
        const p = base + i * 2;
        indices.push(p, p + 1, p + 3, p, p + 3, p + 2);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    groups.ground.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      map: netTexture(), transparent: true, alphaTest: 0.28, side: THREE.DoubleSide,
      roughness: 0.9, metalness: 0.0,
    })));
  }
  if (posts.length) {
    const post = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.05, 0.055, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b3033, roughness: 0.6, metalness: 0.35 }),
      posts.length);
    const dummy = new THREE.Object3D();
    posts.forEach(([at, height], i) => {
      dummy.position.set(at[0], COURT_Y + height / 2, at[1]);
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      post.setMatrixAt(i, dummy.matrix);
    });
    post.instanceMatrix.needsUpdate = true;
    groups.ground.add(post);
  }

  // Backboards and rims. A hoop is 3.05 up and the board is 1.80 by 1.05, which is the one
  // dimension on a basketball court a bystander could check by eye.
  if (hoops.length) {
    const board = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.80, 1.05, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xdfe4e2, roughness: 0.35, metalness: 0.1 }),
      hoops.length);
    const rim = new THREE.InstancedMesh(
      new THREE.TorusGeometry(0.2286, 0.02, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0xc0562a, roughness: 0.5, metalness: 0.4 }),
      hoops.length);
    const pole = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.09, 1, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b3033, roughness: 0.6, metalness: 0.4 }),
      hoops.length);
    const supports = !HEADSET ? new THREE.InstancedMesh(new THREE.CylinderGeometry(.055,.055,1,6),
      new THREE.MeshStandardMaterial({color:0x2b3033,roughness:.6,metalness:.4}),hoops.length) : null;
    const dummy = new THREE.Object3D();
    hoops.forEach((hoop, i) => {
      const [x, z] = hoop.at;
      const heading = Math.atan2(hoop.face[0] - x, hoop.face[1] - z);
      dummy.position.set(x, COURT_Y + 3.05 + 0.30, z);
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      board.setMatrixAt(i, dummy.matrix);
      dummy.position.set(x - Math.sin(heading) * 0.4, COURT_Y + 3.05,
                         z - Math.cos(heading) * 0.4);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      rim.setMatrixAt(i, dummy.matrix);
      dummy.position.set(hoop.support?.[0] ?? x + Math.sin(heading) * 0.6, COURT_Y + 1.75,
                         hoop.support?.[1] ?? z + Math.cos(heading) * 0.6);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 3.5, 1);
      dummy.updateMatrix();
      pole.setMatrixAt(i, dummy.matrix);
      if(supports) {
        const a=new THREE.Vector3(...[hoop.support[0],COURT_Y+3.35,hoop.support[1]]);
        const b=new THREE.Vector3(x,COURT_Y+3.35,z),d=b.clone().sub(a);
        dummy.position.copy(a).add(b).multiplyScalar(.5);
        dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize());
        dummy.scale.set(1,d.length(),1);dummy.updateMatrix();supports.setMatrixAt(i,dummy.matrix);
      }
    });
    for (const mesh of [board, rim, pole, ...(supports ? [supports] : [])]) {
      mesh.instanceMatrix.needsUpdate = true;
      groups.ground.add(mesh);
    }
  }

  // The fence. Public courts in San Francisco are fenced, and the fence is most of their
  // silhouette from the street -- a court without one reads as a painted car park.
  const fencePositions = [];
  const fenceUvs = [];
  const fenceIndices = [];
  const fencePosts = [];
  const fenceRails = [], fenceJoints = new Map();
  for (const pitch of pitches) {
    const style = COURT_STYLE[pitch.s];
    if (!style || !style.fence) continue;
    // Within a block, the fence between one sport's courts and another's (court_complexes'
    // dividers), as tall as the taller of the two; courts of one sport share open run-off.
    const runs = [...(pitch.fence_runs ? pitch.fence_runs.map(r=>[r.p,style.fence]) : [[pitch.p, style.fence]]), ...(pitch.dividers || []).map((d) => [d.p,
      Math.max(...d.s.map((s) => (COURT_STYLE[s] || COURT_STYLE[`${s}_half`] || style).fence || style.fence))])];
    for (const [ring, h] of runs) for (let i = 0; i < ring.length - 1; i += 1) {
      const [ax, ay] = xy(ring[i][0], ring[i][1]);
      const [bx, by] = xy(ring[i + 1][0], ring[i + 1][1]);
      const az = -ay, bz = -by;
      const span = Math.hypot(bx - ax, bz - az);
      if (span < 0.4) continue;
      if (insideCarriageway(ax, az, -1.0) || insideCarriageway(bx, bz, -1.0)) continue;
      groundedFencePanel({positions:fencePositions,uvs:fenceUvs,indices:fenceIndices},
        ax,az,bx,bz,COURT_Y,h,.6);
      for (const [x,z] of courtPostPoints(ax,az,bx,bz,h,HEADSET)) {
        if (HEADSET) fencePosts.push([x,z,h]);
        else {
          // End and divider joints get a post too; one shared post, not two almost-touching
          // fence islands. Keep the existing inferred fence route rather than moving courts.
          const key=`${x.toFixed(2)}:${z.toFixed(2)}`, old=fenceJoints.get(key);
          if(!old || old[2]<h)fenceJoints.set(key,[x,z,h]);
        }
      }
      if(!HEADSET) {
        const sections=Math.max(1,Math.ceil(span/FENCE_GROUND_STEP_M));
        for(let j=0;j<sections;j++) {
          const at=k=>{const t=k/sections,x=ax+(bx-ax)*t,z=az+(bz-az)*t;
            return new THREE.Vector3(x,groundLiftAt(x,z)+COURT_Y+h,z);};
          fenceRails.push([at(j),at(j+1)]);
        }
      }
    }
  }
  if(!HEADSET)fencePosts.push(...fenceJoints.values());
  if(fenceRails.length) {
    const rails=new THREE.InstancedMesh(new THREE.CylinderGeometry(.026,.026,1,6),
      new THREE.MeshStandardMaterial({color:0x8d9498,roughness:.5,metalness:.55}),fenceRails.length);
    const dummy=new THREE.Object3D(), up=new THREE.Vector3(0,1,0);
    fenceRails.forEach(([a,b],i)=>{const d=b.clone().sub(a),length=d.length();
      dummy.position.copy(a).add(b).multiplyScalar(.5);
      dummy.quaternion.setFromUnitVectors(up,d.normalize());dummy.scale.set(1,length,1);
      dummy.updateMatrix();rails.setMatrixAt(i,dummy.matrix);});
    rails.userData={surface:"fence:court",liftedOntoGround:true};
    rails.instanceMatrix.needsUpdate=true;groups.ground.add(rails);
  }
  if (fenceIndices.length) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(fencePositions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(fenceUvs, 2));
    geom.setIndex(fenceIndices);
    geom.computeVertexNormals();
    const fence=new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      // Wire, not sheeting. The threshold is deliberately above what a minified mipmap of a
      // diamond mesh averages out to, so the fence thins away with distance instead of
      // resolving into the solid grey panel it first came out as.
      map: chainlinkTexture(), alphaTest: 0.55, side: THREE.DoubleSide,
      roughness: 0.55, metalness: 0.45, color: 0xc6ced2,
    }));
    fence.userData={surface:"fence:court",liftedOntoGround:true,elevationBasis:"terrain_sampled_0.75m"};
    groups.ground.add(fence);
  }
  if (fencePosts.length) {
    const post = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.035, 0.04, 1, 5),
      new THREE.MeshStandardMaterial({ color: 0x8d9498, roughness: 0.5, metalness: 0.55 }),
      fencePosts.length);
    const dummy = new THREE.Object3D();
    fencePosts.forEach(([x, z, h], i) => {
      dummy.position.set(x, COURT_Y + h / 2, z);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      post.setMatrixAt(i, dummy.matrix);
    });
    post.instanceMatrix.needsUpdate = true;
    groups.ground.add(post);
  }
}

