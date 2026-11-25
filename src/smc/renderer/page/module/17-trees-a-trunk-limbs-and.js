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
//: ``detail``: "far" (the default) is the kind as every tree of it is instanced -- its bark, its
//: big limbs and its leaf cards, two in three of them a little larger, so the crown reads the
//: same with a third fewer polygons; "near" is every card, for the trees round you (treeNear).
function treeVariant(kind, detail = "far") {
  const cardShare = detail === "near" ? 1 : 0.65, cardSize = detail === "near" ? 1 : 1.15;
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
    // Every card's draws are taken whether it is kept or not, so the near and far kinds have
    // the same limbs and the same cards where they share them.
    const keep = Math.ceil(cards * cardShare);
    for (let i = 0; i < cards; i += 1) {
      const a = rnd() * Math.PI * 2, e = (rnd() - 0.5) * Math.PI, r = Math.cbrt(rnd());
      const at = V(c.x + Math.cos(a) * Math.cos(e) * rx * r, c.y + Math.sin(e) * ry * r,
        c.z + Math.sin(a) * Math.cos(e) * rx * r);
      const card = leafCard(at, size * cardSize, rnd, tint, droop);
      if (i < keep) leaves.push(card); else card.dispose();
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

// ---- a tree's opening, one of the walk's own squares ----
//
// The city cuts a sidewalk tree's opening out of the walk's squares: the opening is the
// square (three feet along the walk, or as many squares as its recorded length), its ends on
// the walk's own joints. The streets say where their joints are (module 19 marks them laid,
// streetSurfacesLaid); each opening is slid along the walk, at most half a square, to the
// squares it covers, and stretched to fill them, and its tree with it.
var streetSurfacesLaid = null, markStreetSurfacesLaid = null;
//: Squares a metre along a walk (three feet a square).
var WALK_SQUARES_PER_M = 1 / 0.9144;
streetSurfacesLaid = new Promise((resolve) => { markStreetSurfacesLaid = resolve; });
//: The street furniture's record (lights, signs, meters, signals), fetched once for whoever
//: asks first: the trees, which must stand clear of every pole (module 18), and the furniture
//: layer that draws them (module 21).
var streetFurnitureRecord = null;
function streetFurnitureOnce() {
  return streetFurnitureRecord ||= fetchWindowed(asset("sf-corridor-furniture.json"),
    () => fetch(asset("sf-corridor-furniture.json"), { cache: "no-cache" }).then((r) => r.json())).then(windowLists);
}
//: A trunk this near a pole (m) has the pole in its opening (a three-foot square) or in its
//: bark: the tree is slid along the walk or stepped away to clear it, or it is not drawn. On
//: grass, with no opening to keep clear, a little less.
var TREE_POLE_CLEAR_M = 0.75, TREE_POLE_CLEAR_SOFT_M = 0.6;
//: The walks' triangles round ``points`` ([x, z]), for walkSquareAt: null when none is drawn.
function walkSquareIndex(points, reach = 3) {
  const CELL = 4, wanted = new Set(), bins = new Map();
  for (const [x, z] of points) wanted.add(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`);
  if (!wanted.size) return null;
  const unit = new THREE.Vector3(1, 1, 1);
  groups.streets.traverse((o) => {
    if (!o.isMesh || !["walk", "walk_narrow"].includes(o.userData.surface)) return;
    if (o.position.lengthSq() || o.quaternion.w !== 1 || !o.scale.equals(unit)) return;
    const pos = o.geometry.getAttribute("position"), uv = o.geometry.getAttribute("uv"), idx = o.geometry.index;
    if (!pos || !uv) return;
    const squares = o.userData.surface === "walk" ? SLAB_BLOCK : NARROW_SLAB_M * WALK_SQUARES_PER_M;
    const n = idx ? idx.count : pos.count;
    for (let k = 0; k < n; k += 3) {
      const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
      const x0 = Math.min(pos.getX(a), pos.getX(b), pos.getX(c)), x1 = Math.max(pos.getX(a), pos.getX(b), pos.getX(c));
      const z0 = Math.min(pos.getZ(a), pos.getZ(b), pos.getZ(c)), z1 = Math.max(pos.getZ(a), pos.getZ(b), pos.getZ(c));
      if (x1 - x0 > 400 || z1 - z0 > 400) continue;
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i += 1)
        for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j += 1) {
          const key = `${i}:${j}`;
          if (!wanted.has(key)) continue;
          let list = bins.get(key);
          if (!list) bins.set(key, list = []);
          list.push([pos.getX(a), pos.getZ(a), uv.getX(a) * squares, pos.getX(b), pos.getZ(b), uv.getX(b) * squares,
            pos.getX(c), pos.getZ(c), uv.getX(c) * squares]);
        }
    }
  });
  return { CELL, bins };
}
//: The walk's squares at (x, z): how many squares along it is there (s, from the walk's start)
//: and which way and how fast s grows ([gx, gz], per metre); null off the walk.
function walkSquareAt(index, x, z) {
  for (const t of index?.bins.get(`${Math.floor(x / index.CELL)}:${Math.floor(z / index.CELL)}`) || []) {
    const [ax, az, as, bx, bz, bs, cx, cz, cs] = t;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    // s = s_c + gx (x - cx) + gz (z - cz) over the triangle.
    const e1x = ax - cx, e1z = az - cz, e2x = bx - cx, e2z = bz - cz, ds1 = as - cs, ds2 = bs - cs;
    const det = e1x * e2z - e2x * e1z;
    if (Math.abs(det) < 1e-9) continue;
    const gx = (ds1 * e2z - ds2 * e1z) / det, gz = (e1x * ds2 - e2x * ds1) / det;
    return { s: l1 * as + l2 * bs + l3 * cs, g: [gx, gz] };
  }
  return null;
}
//: An opening ({center, corners}: corners 0-1 along the curb) put on the walk's squares: slid
//: along the walk to them and stretched to fill them. The same opening where the walk's squares
//: cannot be read there (or run across the curb rather than along it).
function walkSquarePlot(index, plot) {
  const [x, z] = plot.center, at = walkSquareAt(index, x, z);
  if (!at) return plot;
  const [p0, p1, p2, p3] = plot.corners;
  const ax = p1[0] - p0[0], az = p1[1] - p0[1], length = Math.hypot(ax, az);
  const g2 = at.g[0] * at.g[0] + at.g[1] * at.g[1];
  if (!(length > 0.1) || !(g2 > 0)) return plot;
  // A metre along the walk is so many squares: three feet a square, or it is not this walk's.
  const perM = Math.sqrt(g2);
  if (Math.abs(perM * SLAB_M - 1) > 0.25 && Math.abs(perM * NARROW_SLAB_M - 1) > 0.25) return plot;
  const ux = ax / length, uz = az / length;
  if (Math.abs((at.g[0] * ux + at.g[1] * uz) / perM) < 0.9) return plot;
  // As many whole squares as the opening reaches into (a hair over one is still one): a 4 ft
  // opening is two squares, not cut back to one.
  const square = 1 / perM, count = Math.max(1, Math.ceil(length / square - 0.15));
  // The centre on a joint (an even count of squares) or the middle of one (odd).
  const goal = count % 2 ? Math.floor(at.s) + 0.5 : Math.round(at.s);
  const shiftS = goal - at.s;
  const sx = at.g[0] * shiftS / g2, sz = at.g[1] * shiftS / g2;
  if (Math.hypot(sx, sz) > square * 0.5 + 0.01) return plot;
  const stretch = count * square / length;
  const center = [x + sx, z + sz];
  const corners = plot.corners.map(([px, pz]) => {
    const dx = px - x, dz = pz - z, along = dx * ux + dz * uz;
    return [center[0] + dx + along * (stretch - 1) * ux, center[1] + dz + along * (stretch - 1) * uz];
  });
  return { center, corners, squares: count };
}

// ---- the trees round you, in full ----
//
// Two tiers of every tree. Far, it is an instance of its kind (treeVariant "far"): the kind's
// bark, its big limbs and two in three of its leaf cards, at the tree's measured height and
// spread -- one mesh a kind for the whole city. Near (TREE_NEAR_M round where you are), it is
// drawn on its own in place of its instance: every leaf card of the kind, and where the 2023
// USGS lidar measured the tree, its crown shaped to the measured one (sf-tree-placement.mjs
// shapeCrown: in eight wedges round the trunk, the crown's reach, its lowest branches and its
// top). The two share their materials, so a near tree is cut at a wall (cutTreeAtWalls: it
// is drawn in the ground's own frame) and moves in the wind as the far one does.
var TREE_NEAR_M = 70, TREE_NEAR_MAX = 60, TREE_NEAR_BUILDS = 3, TREE_NEAR_KEEP = 140, TREE_NEAR_EVERY_MS = 200;
//: Seen from further up than this the near tier is let go: the far one is what shows.
var TREE_NEAR_MAX_VIEW_M = 400;
//: Each tree as it was instanced ({x, z, kind, tree, across, up, yaw}), and each kind's far
//: prototype, collected as the ground is built (module 18); then the index (treeNearIndex).
var treeNearSpec = [], treeNearProtos = new Map(), treeNear = null;
function treeNearKey(x, z) { return `${Math.round(x * 4)}:${Math.round(z * 4)}`; }
//: Where each tree's instances are, once the ground is tiled and stood on the hill: every
//: instance of a kind's parts, by where it stands.
function treeNearIndex(spec, survey) {
  const instances = new Map(), rel = new Map(), m = new THREE.Matrix4();
  groups.ground.updateMatrixWorld(true);
  const inverse = groups.ground.matrixWorld.clone().invert();
  groups.ground.traverse((o) => {
    if (!o.isInstancedMesh || !String(o.userData.surface || "").startsWith("tree:")) return;
    const frame = o.matrixWorld.clone().premultiply(inverse);
    rel.set(o, frame);
    for (let i = 0; i < o.count; i += 1) {
      o.getMatrixAt(i, m);
      m.premultiply(frame);
      const key = treeNearKey(m.elements[12], m.elements[14]);
      let list = instances.get(key);
      if (!list) instances.set(key, list = []);
      list.push(o, i);
    }
  });
  const CELL = 32, grid = new Map();
  for (const t of spec) {
    t.key = treeNearKey(t.x, t.z);
    if (!instances.has(t.key)) continue;
    const cell = `${Math.floor(t.x / CELL)}:${Math.floor(t.z / CELL)}`;
    let list = grid.get(cell);
    if (!list) grid.set(cell, list = []);
    list.push(t);
  }
  treeNearSpec = [];
  return { CELL, grid, instances, rel, survey, protos: new Map(), envelopes: new Map(),
    shown: new Map(), keys: new Set(), cache: new Map(), at: -1e9, built: 0 };
}
var TREE_NEAR_ZERO = null, TREE_NEAR_UP = null;
//: One tree in full, in the ground's frame: a group of its parts, or null.
function treeNearBuild(t) {
  const T = treeNear, far = treeNearProtos.get(t.kind), at = T.instances.get(t.key);
  if (!far || !at) return null;
  let near = T.protos.get(t.kind);
  if (!near) T.protos.set(t.kind, near = treeVariant(t.kind, "near"));
  if (!TREE_NEAR_UP) TREE_NEAR_UP = new THREE.Vector3(0, 1, 0);
  // Where its instance stands on the hill.
  const m = new THREE.Matrix4();
  at[0].getMatrixAt(at[1], m);
  m.premultiply(T.rel.get(at[0]));
  const ground = m.elements[13] - far.children[0].position.y * t.up;
  const api = T.survey?.api, profile = Boolean(t.tree.profile && api?.shapeCrown);
  if (profile && !T.envelopes.has(t.kind))
    T.envelopes.set(t.kind, api.crownEnvelope(near.children[1].geometry.getAttribute("position").array));
  const place = new THREE.Matrix4().compose(new THREE.Vector3(t.x, ground, t.z),
    new THREE.Quaternion().setFromAxisAngle(TREE_NEAR_UP, t.yaw),
    profile ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(t.across, t.up, t.across));
  const group = new THREE.Group();
  group.userData.treeNear = t.tree.id || t.key;
  near.children.forEach((part, n) => {
    const farPart = far.children[n];
    if (!farPart) return;
    const geometry = part.geometry.clone();
    const position = geometry.getAttribute("position");
    // Metres from its foot: its measured crown, the trunk at its measured girth.
    if (profile) api.shapeCrown(position.array, T.envelopes.get(t.kind), t.tree.profile,
      Math.max(0.5, (t.tree.d || 12) * 0.0254 / 0.156));
    if (part.position.y) geometry.translate(0, part.position.y, 0);
    geometry.applyMatrix4(place);
    if (n === 1 && vegetationLibrary?.foliageNormals) vegetationLibrary.foliageNormals(position.array, geometry.getAttribute("normal").array);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, farPart.material);
    if (farPart.userData.treeDepth) mesh.customDepthMaterial = farPart.userData.treeDepth;
    for (let k = 0; k < at.length; k += 2) if (at[k].material === farPart.material) {
      mesh.castShadow = at[k].castShadow; mesh.receiveShadow = at[k].receiveShadow; break; }
    mesh.userData = { surface: "tree_near", liftedOntoGround: true, treeId: t.tree.id || null,
      basis: profile ? "measured crown (USGS 3DEP 2023 lidar), modeled branches" : "mapped (city tree inventory)" };
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  });
  group.matrixAutoUpdate = false;
  T.built += 1;
  return group;
}
function treeNearDispose(group) {
  group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
}
//: Each frame (it looks again every TREE_NEAR_EVERY_MS): the trees round ``focus`` drawn in
//: full, a few more each time, and those left behind given back to their instances.
// ---- the fallen leaves (docs/leaf-litter.mjs) ----------------------------------------------------
//: Leaves on the ground round the walker, each a leaf: under the trees that are drawn in full
//: near you (treeNear's index: the same trees, where they stand), on the ground the walker
//: walks on, and solid to walls and fences -- a leaf is never inside a building, and a fence's
//: mesh or pickets are too close for one to get through (it goes through a gate, which is a gap).
var leafLitter = null, leafLitterAt = 0;
const LEAF_FENCE_M = 0.09;
function leafSolid(x, z) {
  return Boolean(buildingAt(x, z)) || Boolean(nearestFenceLine(x, z, LEAF_FENCE_M));
}
function leafTrees(x, z, reach) {
  const T = typeof treeNear === "undefined" ? null : treeNear, out = [];
  if (!T) return out;
  const c = T.CELL;
  for (let i = Math.floor((x - reach) / c); i <= Math.floor((x + reach) / c); i += 1)
    for (let j = Math.floor((z - reach) / c); j <= Math.floor((z + reach) / c); j += 1)
      for (const t of T.grid.get(`${i}:${j}`) || []) {
        if (Math.hypot(t.x - x, t.z - z) > reach) continue;
        out.push({ x: t.x, z: t.z, key: t.key, kind: t.kind, crown: Math.max(1.6, Math.min(7, (t.across || 5) / 2)), seed: (Math.round(t.x * 4) * 73856093) ^ (Math.round(t.z * 4) * 19349663) });
      }
  return out;
}
//: Each frame the walker is on foot near the ground (not from high above: a leaf is not seen).
function leafLitterStep(at, now, viewHeight = 0) {
  if (typeof leafLibrary === "undefined" || !leafLibrary || typeof treeNear === "undefined" || !treeNear || !at) return;
  if (viewHeight > 40) { if (leafLitter) leafLitter.mesh.visible = false; leafLitterAt = now; return; }
  if (!leafLitter) {
    let refY = at.y;
    leafLitter = leafLibrary.createLeafLitter(THREE, { parent: groups.ground, trees: leafTrees, solid: leafSolid,
      ground: (x, z) => { const g = walkerGroundAt(x, z, refY); return Number.isFinite(g) ? g : refY; },
      wind: () => globalThis.kerbsideWind, windVector: foliageLibrary?.windVector || (() => [0.94, -0.34]) });
    leafLitter.setRef = (y) => { refY = y; };
    window.kerbsideLeaves = () => ({ ...leafLitter.stats });
  }
  leafLitter.mesh.visible = true;
  leafLitter.setRef(at.y);
  const dt = Math.min(0.1, Math.max(0, (now - (leafLitterAt || now)) / 1000));
  leafLitterAt = now;
  if (dt > 0) leafLitter.step(at, dt);
}
function treeNearStep(focus, now, viewHeight = 0) {
  const T = typeof treeNear === "undefined" ? null : treeNear;
  if (!T || !focus || now - T.at < TREE_NEAR_EVERY_MS) return;
  T.at = now;
  if (!TREE_NEAR_ZERO) TREE_NEAR_ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const wanted = [];
  if (viewHeight < TREE_NEAR_MAX_VIEW_M) {
    const r = TREE_NEAR_M, c = T.CELL;
    for (let i = Math.floor((focus.x - r) / c); i <= Math.floor((focus.x + r) / c); i += 1)
      for (let j = Math.floor((focus.z - r) / c); j <= Math.floor((focus.z + r) / c); j += 1)
        for (const t of T.grid.get(`${i}:${j}`) || []) {
          const d = Math.hypot(t.x - focus.x, t.z - focus.z);
          if (d < r) wanted.push([d, t]);
        }
    wanted.sort((a, b) => a[0] - b[0]);
    if (wanted.length > TREE_NEAR_MAX) wanted.length = TREE_NEAR_MAX;
  }
  const want = new Set(wanted.map((w) => w[1]));
  const touched = new Set();
  for (const [t, saved] of T.shown) {
    if (want.has(t)) continue;
    saved.group.removeFromParent();
    for (const [mesh, i, matrix] of saved.hidden) { mesh.setMatrixAt(i, matrix); touched.add(mesh); }
    T.shown.delete(t); T.keys.delete(t.key);
  }
  let builds = 0;
  for (const [, t] of wanted) {
    if (T.shown.has(t) || T.keys.has(t.key)) continue;
    let group = T.cache.get(t);
    if (group) T.cache.delete(t);
    else {
      if (builds >= TREE_NEAR_BUILDS) continue;
      builds += 1;
      try { group = treeNearBuild(t); } catch (error) { console.warn("kerbside: a near tree could not be drawn", error); group = null; }
      if (!group) {
        // Not tried again: it stays its instance.
        const list = T.grid.get(`${Math.floor(t.x / T.CELL)}:${Math.floor(t.z / T.CELL)}`);
        if (list) list.splice(list.indexOf(t), 1);
        continue;
      }
    }
    T.cache.set(t, group);
    groups.ground.add(group);
    group.updateMatrixWorld(true);
    const hidden = [], at = T.instances.get(t.key);
    for (let k = 0; k < at.length; k += 2) {
      const matrix = new THREE.Matrix4();
      at[k].getMatrixAt(at[k + 1], matrix);
      hidden.push([at[k], at[k + 1], matrix]);
      at[k].setMatrixAt(at[k + 1], TREE_NEAR_ZERO);
      touched.add(at[k]);
    }
    T.shown.set(t, { group, hidden }); T.keys.add(t.key);
  }
  for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
  // Those drawn and walked away from are kept a while, for coming back; then let go.
  if (T.cache.size > TREE_NEAR_KEEP) for (const [t, group] of T.cache) {
    if (T.cache.size <= TREE_NEAR_KEEP) break;
    if (T.shown.has(t)) continue;
    treeNearDispose(group); T.cache.delete(t);
  }
  window.kerbsideTreeNear = { shown: T.shown.size, kept: T.cache.size, built: T.built };
}

// ---- trees cut where they meet a house ----
//
// Most street trees stand close enough to a house that the prototype's crown, scaled to the tree,
// reaches into it, and the leaves showed through walls and rooms. They were cut by baking each
// such tree on its own -- every leaf of it copied out of the kind's one mesh and clipped against
// the house -- which in the Marina was two trees in three and 172 MB of copies (2026-11-09). Now
// every tree of a kind is an instance of the kind's one mesh, and the cut is made as it is drawn:
// the houses round the trees are laid into a height map (treeWallMask: each texel the top of the
// house standing on it), and a leaf or limb under that top is not drawn. The same cut, in full
// detail; a texel is TREE_WALL_STEP_M across, so the cut follows a wall to within that.
const TREE_WALL_STEP_M = 0.6, TREE_WALL_MAX_TEXELS = 4096, TREE_WALL_NONE = -60000;
//: The height map of the houses round `trees` ({p: [lon, lat]}), from the footprint grid: the
//: top of each house (its roof, or its height above its base) over the texels it covers;
//: TREE_WALL_NONE where there is none; half floats, a few megabytes for a square kilometre.
//: {texture, top, origin: [x0, z0], step, w, h, texels, houses}; `top` (the heights as numbers)
//: is for the build, let go after it.
function treeWallMask(trees) {
  if (!trees.length || typeof footprintGrid === "undefined") return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const tree of trees) {
    const [x, y] = xy(tree.p[0], tree.p[1]);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, -y); z1 = Math.max(z1, -y);
  }
  // As far round the trees as a crown spreads.
  const pad = 30;
  x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  let step = TREE_WALL_STEP_M;
  while ((x1 - x0) / step > TREE_WALL_MAX_TEXELS || (z1 - z0) / step > TREE_WALL_MAX_TEXELS) step *= 1.5;
  const w = Math.ceil((x1 - x0) / step), h = Math.ceil((z1 - z0) / step);
  const top = new Float32Array(w * h).fill(TREE_WALL_NONE);
  const seen = new Set();
  let houses = 0;
  for (const entries of footprintGrid.values()) for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (entry.maxX < x0 || entry.minX > x1 || entry.maxZ < z0 || entry.minZ > z1) continue;
    const base = (entry.way._treeClipBase ?? groundBaseFor(entry.way.points)) - 0.1;
    const roof = (entry.way._treeClipRoof ?? (base + Math.max(3, entry.way.height_m || 10.5))) + 0.1;
    const ring = entry.local;
    if (!ring || ring.length < 3) continue;
    houses += 1;
    // Scanline fill: each texel row's centre, the ring's crossings, filled between pairs.
    const j0 = Math.max(0, Math.floor((entry.minZ - z0) / step)), j1 = Math.min(h - 1, Math.ceil((entry.maxZ - z0) / step));
    for (let j = j0; j <= j1; j += 1) {
      const z = z0 + (j + 0.5) * step, xs = [];
      for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
        const [ax, az] = ring[m], [bx, bz] = ring[k];
        if ((az <= z) !== (bz <= z)) xs.push(ax + (z - az) / (bz - az) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / step - 0.5)), i1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / step - 0.5));
        for (let i = i0; i <= i1; i += 1) if (roof > top[j * w + i]) top[j * w + i] = roof;
      }
    }
  }
  const half = new Uint16Array(w * h);
  for (let k = 0; k < top.length; k += 1) half[k] = THREE.DataUtils.toHalfFloat(top[k]);
  const texture = new THREE.DataTexture(half, w, h, THREE.RedFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, top, origin: [x0, z0], step, w, h, texels: w * h, houses,
    frame: new THREE.Vector4(x0, z0, 1 / (w * step), 1 / (h * step)) };
}
//: A tree part's material (and the shadow it casts) taught to leave out what is under a house's
//: top in `mask` -- in the tree's own frame, the one the footprints are in.
function cutTreeAtWalls(part, mask) {
  const teach = (material) => {
    if (!material || material.userData.treeWallCut === mask) return material;
    material.userData.treeWallCut = mask;
    const before = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = function (shader, renderer) {
      before.call(this, shader, renderer);
      shader.uniforms.treeWallMask = { value: mask.texture };
      shader.uniforms.treeWallFrame = { value: mask.frame };
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vTreeLocal;")
        .replace("#include <project_vertex>", "#include <project_vertex>\n#ifdef USE_INSTANCING\n  vTreeLocal = (instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\n  vTreeLocal = transformed;\n#endif");
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
        "#include <common>\nvarying vec3 vTreeLocal;\nuniform sampler2D treeWallMask;\nuniform vec4 treeWallFrame;")
        .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n  {\n    vec2 wallAt = (vTreeLocal.xz - treeWallFrame.xy) * treeWallFrame.zw;\n"
          + "    if (all(greaterThan(wallAt, vec2(0.0))) && all(lessThan(wallAt, vec2(1.0))) && vTreeLocal.y < texture2D(treeWallMask, wallAt).r) discard;\n  }");
    };
    material.customProgramCacheKey = () => `${key}:tree-wall-cut`;
    material.needsUpdate = true;
    return material;
  };
  teach(part.material);
  // Its shadow cut the same: the depth it casts from, with the leaves' own picture for their edges.
  if (!part.userData.treeDepth) {
    part.userData.treeDepth = teach(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking,
      map: part.material.map || null, alphaTest: part.material.alphaTest || 0, side: part.material.side }));
  }
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
    // (The leaves themselves are leaves now, not patches of leaf texture: docs/leaf-litter.mjs,
    // leafLitterStep -- round the walker, each one its own, under every tree drawn in full. The
    // headset, which has none of that, keeps the patches.)
    for (const patch of typeof leafLibrary !== "undefined" && leafLibrary ? [] : fall.patches) {
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
    return chainlinkMaterial();
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

//: The paved covers laid from parcels (a parcel is surveyed to the property line, not the kerb),
//: cut off the roadway again once every roadway is known (recutGroundOffRoads).
const ROAD_CUT_SURFACES = new Set(["plaza", "front_walk", "service_yard", "neutral_ground"]);
//: ringGeometry cuts these covers off the carriageway as it lays them, but with the roadways known
//: at that moment. Where a region is built in pieces (City mode's area), some streets are indexed
//: after the ground is down, and what was paved on them stayed: slabs of pavement across the
//: lanes, through the bus zones' paint. Once the build has settled, any triangle whose centre and
//: two corners are on a carriageway is taken out (the same rule, with every roadway in).
//: And off a car park: the covers that are laid over a lot's ground (a lot's parcel is paved, so
//: it was given the pale paving of a plaza, and the lot's own asphalt showed through it in
//: patches where the two sheets crossed). Inside a lot's ground as drawn (PARKING_REGIONS: its
//: rectangle, or its outline) nothing is laid but the lot: the whole of it is its own colour.
const LOT_CUT_SURFACES = /^(plaza|front_walk|service_yard|neutral_ground|yard|inferred:)/;
function insideParkingRegion(x, z) {
  if (typeof PARKING_REGIONS === "undefined") return false;
  for (const lot of PARKING_REGIONS) {
    const b = lot.box;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    const ring = lot.ring;
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if ((ring[i][1] > z) !== (ring[j][1] > z) && x < (ring[j][0] - ring[i][0]) * (z - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
    }
    if (hit) return true;
  }
  return false;
}
//: A lot's outline as a clip: its corners in order with the inside on the left of every edge,
//: and whether it is convex (a lot drawn as its rectangle always is).
function lotClipOf(lot) {
  if (lot.clip) return lot.clip;
  const pts = lot.ring.slice(0, Math.hypot(lot.ring[0][0] - lot.ring.at(-1)[0], lot.ring[0][1] - lot.ring.at(-1)[1]) < 0.01 ? -1 : undefined);
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const ring = area >= 0 ? pts : pts.slice().reverse();
  let convex = ring.length >= 3;
  for (let i = 0; i < ring.length && convex; i += 1) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-6) convex = false;
  }
  return (lot.clip = { ring, convex });
}
//: What is left of a triangle outside a convex outline: convex pieces, each a list of points
//: [x, z, wa, wb, wc] (w: the point's weights on the triangle's own three corners, so anything the
//: corners carry can be worked out for it). ``null``: none of it is inside (the triangle as it is).
//: The outline's inside is on the left of each edge; a piece on the right of any edge is outside
//: the whole outline, and what is on the left of every edge is inside it and dropped.
function triangleOutsideConvex(tri, ring) {
  let inside = tri, touched = false;
  const out = [];
  for (let i = 0; i < ring.length && inside.length >= 3; i += 1) {
    const [px, pz] = ring[i], [qx, qz] = ring[(i + 1) % ring.length];
    const side = (v) => (qx - px) * (v[1] - pz) - (qz - pz) * (v[0] - px);
    const left = [], right = [];
    for (let k = 0; k < inside.length; k += 1) {
      const a = inside[k], b = inside[(k + 1) % inside.length], sa = side(a), sb = side(b);
      if (sa >= 0) left.push(a); if (sa < 0) right.push(a);
      if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
        const t = sa / (sa - sb), m = [0, 1, 2, 3, 4].map((j) => a[j] + (b[j] - a[j]) * t);
        left.push(m); right.push(m);
      }
    }
    if (right.length >= 3) { out.push(right); touched = true; }
    inside = left;
  }
  // (Nothing left on the inside: the outline never reached into it.)
  const areaOf = (poly) => { let s = 0; for (let k = 0; k < poly.length; k += 1) { const a = poly[k], b = poly[(k + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
  if (inside.length < 3 || areaOf(inside) < 1e-4) return null;
  return touched ? out.filter((poly) => areaOf(poly) > 1e-4) : [];
}
//: A cover's triangles taken off the car parks exactly: each triangle that reaches into a lot is
//: cut along the lot's outline and only the part inside goes. (They were dropped whole when their
//: middle and two corners were in a lot: where one straddled the outline, the part of it outside
//: went too, and the bare ground showed through the hole -- the pale triangles along both sides
//: of the lot in the yard of Marina Middle School, seen 2026-11-23 and traced to this.) A lot
//: with a dent in its outline is cut by halving the triangles that straddle it, to LOT_CUT_FINE_M.
const LOT_CUT_FINE_M = 0.5;
function cutCoverOffLots(mesh) {
  const geom = mesh.geometry, pos = geom.attributes.position, index = geom.getIndex();
  const e = mesh.matrixWorld.elements, ox = e[12], oz = e[14];
  const names = Object.keys(geom.attributes), added = names.map(() => []);
  let next = pos.count, cut = 0;
  const kept = [];
  const point = (ids, w) => {
    for (let k = 0; k < 3; k += 1) if (w[k] > 1 - 1e-9) return ids[k];
    names.forEach((name, n) => {
      const at = geom.attributes[name], size = at.itemSize;
      for (let c = 0; c < size; c += 1) added[n].push(w[0] * at.getComponent(ids[0], c) + w[1] * at.getComponent(ids[1], c) + w[2] * at.getComponent(ids[2], c));
    });
    return next++;
  };
  for (let t = 0; t < index.count; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    const P = ids.map((i) => [pos.getX(i) + ox, pos.getZ(i) + oz]);
    const x0 = Math.min(P[0][0], P[1][0], P[2][0]), x1 = Math.max(P[0][0], P[1][0], P[2][0]), z0 = Math.min(P[0][1], P[1][1], P[2][1]), z1 = Math.max(P[0][1], P[1][1], P[2][1]);
    // The pieces of this triangle still to be kept, as weights on its corners.
    let pieces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]], changed = false;
    for (const lot of PARKING_REGIONS) {
      const b = lot.box;
      if (x1 < b[0] || x0 > b[2] || z1 < b[1] || z0 > b[3] || !pieces.length) continue;
      const clip = lotClipOf(lot), at = (w) => [w[0] * P[0][0] + w[1] * P[1][0] + w[2] * P[2][0], w[0] * P[0][1] + w[1] * P[1][1] + w[2] * P[2][1]];
      const nextPieces = [];
      for (const piece of pieces) {
        if (clip.convex) {
          const res = triangleOutsideConvex(piece.map((w) => [...at(w), ...w]), clip.ring);
          if (res === null) { nextPieces.push(piece); continue; }
          changed = true;
          for (const poly of res) for (let k = 1; k + 1 < poly.length; k += 1) nextPieces.push([poly[0].slice(2), poly[k].slice(2), poly[k + 1].slice(2)]);
          continue;
        }
        // (A dented outline: halved until a piece is all in, all out, or too small to matter.)
        const stack = [piece];
        while (stack.length) {
          const q = stack.pop(), xy = q.map(at), inn = xy.map(([x, z]) => insideParkingRegion(x, z)), n = inn[0] + inn[1] + inn[2];
          const mid = [(xy[0][0] + xy[1][0] + xy[2][0]) / 3, (xy[0][1] + xy[1][1] + xy[2][1]) / 3];
          const long = Math.max(Math.hypot(xy[0][0] - xy[1][0], xy[0][1] - xy[1][1]), Math.hypot(xy[1][0] - xy[2][0], xy[1][1] - xy[2][1]), Math.hypot(xy[2][0] - xy[0][0], xy[2][1] - xy[0][1]));
          if (n === 0 && (q !== piece || !insideParkingRegion(mid[0], mid[1]))) { nextPieces.push(q); continue; }
          if (n === 3 || long <= LOT_CUT_FINE_M) { if (n === 3 || insideParkingRegion(mid[0], mid[1])) { changed = true; continue; } nextPieces.push(q); continue; }
          changed = true;
          const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], ab = m(q[0], q[1]), bc = m(q[1], q[2]), ca = m(q[2], q[0]);
          stack.push([q[0], ab, ca], [ab, q[1], bc], [ca, bc, q[2]], [ab, bc, ca]);
        }
      }
      pieces = nextPieces;
    }
    if (!changed) { kept.push(ids[0], ids[1], ids[2]); continue; }
    cut += 1;
    for (const piece of pieces) kept.push(point(ids, piece[0]), point(ids, piece[1]), point(ids, piece[2]));
  }
  if (!cut) return 0;
  if (next > pos.count) names.forEach((name, n) => {
    const at = geom.attributes[name], array = new at.array.constructor(next * at.itemSize);
    array.set(at.array.subarray(0, pos.count * at.itemSize)); array.set(added[n], pos.count * at.itemSize);
    geom.setAttribute(name, new THREE.BufferAttribute(array, at.itemSize, at.normalized));
  });
  geom.setIndex(kept);
  geom.computeBoundingBox(); geom.computeBoundingSphere();
  return cut;
}
//: A cover's triangles taken off whatever ``inside(x, z)`` says is not its ground, along the
//: edge of it: a triangle wholly inside goes, one wholly outside stays, and one that straddles
//: the edge is halved until each piece is one or the other or is under ``fine`` metres across
//: (kept if its middle is outside). Off the roadway this way (recutGroundOffRoads): the paving
//: was taken off a carriageway by dropping whole triangles, and along a street that curves the
//: ones that straddled its edge were left as a row of pale teeth down both sides of the road
//: (the service road off Chestnut Street, seen 2026-11-24).
const ROAD_CUT_FINE_M = 0.3;
//: (``only(t)``, where given, says which triangles -- by their first index -- are tested at all:
//: the others are kept whole without a look.)
//: (``exact(t, P)``, where given, may split a triangle exactly first -- [barycentric triangles], or
//: null to leave it whole -- before the halving looks at what is left.)
function cutCoverBy(mesh, inside, fine, only = null, exact = null) {
  const geom = mesh.geometry, pos = geom.attributes.position, index = geom.getIndex();
  const e = mesh.matrixWorld.elements, ox = e[12], oz = e[14];
  const names = Object.keys(geom.attributes), added = names.map(() => []);
  let next = pos.count, cut = 0;
  const kept = [];
  const point = (ids, w) => {
    for (let k = 0; k < 3; k += 1) if (w[k] > 1 - 1e-9) return ids[k];
    names.forEach((name, n) => {
      const at = geom.attributes[name], size = at.itemSize;
      for (let c = 0; c < size; c += 1) added[n].push(w[0] * at.getComponent(ids[0], c) + w[1] * at.getComponent(ids[1], c) + w[2] * at.getComponent(ids[2], c));
    });
    return next++;
  };
  for (let t = 0; t < index.count; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (only && !only(t)) { kept.push(ids[0], ids[1], ids[2]); continue; }
    const P = ids.map((i) => [pos.getX(i) + ox, pos.getZ(i) + oz]);
    const at = (w) => [w[0] * P[0][0] + w[1] * P[1][0] + w[2] * P[2][0], w[0] * P[0][1] + w[1] * P[1][1] + w[2] * P[2][1]];
    const whole = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], split = exact ? exact(t, P) : null;
    const stack = split ? split.slice() : [whole], pieces = [];
    let changed = Boolean(split);
    while (stack.length) {
      const q = stack.pop(), xy0 = q.map(at), inn = xy0.map(([x, z]) => (inside(x, z) ? 1 : 0)), n = inn[0] + inn[1] + inn[2];
      const mx = (xy0[0][0] + xy0[1][0] + xy0[2][0]) / 3, mz = (xy0[0][1] + xy0[1][1] + xy0[2][1]) / 3, mid = inside(mx, mz);
      const long = Math.max(Math.hypot(xy0[0][0] - xy0[1][0], xy0[0][1] - xy0[1][1]), Math.hypot(xy0[1][0] - xy0[2][0], xy0[1][1] - xy0[2][1]), Math.hypot(xy0[2][0] - xy0[0][0], xy0[2][1] - xy0[0][1]));
      if (n === 0 && !mid) { pieces.push(q); continue; }
      if ((n === 3 && mid) || long <= fine) { if (mid || n === 3) { changed = true; continue; } pieces.push(q); continue; }
      changed = true;
      const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], ab = m(q[0], q[1]), bc = m(q[1], q[2]), ca = m(q[2], q[0]);
      stack.push([q[0], ab, ca], [ab, q[1], bc], [ca, bc, q[2]], [ab, bc, ca]);
    }
    if (!changed) { kept.push(ids[0], ids[1], ids[2]); continue; }
    cut += 1;
    for (const piece of pieces) kept.push(point(ids, piece[0]), point(ids, piece[1]), point(ids, piece[2]));
  }
  if (!cut) return 0;
  if (next > pos.count) names.forEach((name, n) => {
    const at = geom.attributes[name], array = new at.array.constructor(next * at.itemSize);
    array.set(at.array.subarray(0, pos.count * at.itemSize)); array.set(added[n], pos.count * at.itemSize);
    geom.setAttribute(name, new THREE.BufferAttribute(array, at.itemSize, at.normalized));
  });
  geom.setIndex(kept);
  geom.computeBoundingBox(); geom.computeBoundingSphere();
  return cut;
}
//: Paving stops at a fence. A paved cover's triangle laid across a fence line, most of it on one
//: side and a bit of it -- up to FENCE_BITE.most_m -- on the other, showed that bit as a sliver
//: of concrete poking out under the fence into the lawn beyond (1,018 of them in the Marina,
//: 2026-11-24: plazas, the setbacks' walk, the inferred paving, service yards, courts). The bit
//: is cut off along the fence line (cutCoverBy's halving, to FENCE_BITE.fine_m); a cover that
//: truly runs on through a gap in the fence, further than that, is left alone.
const FENCE_BITE = { most_m: 1.5, fine_m: 0.12, slack_m: 0.03 };
const FENCE_PAVED_SURFACES = /^(plaza|front_walk|neutral_ground|walk|inferred:paving|inferred:service|inferred:asphalt|service_yard|court|park:play_surface|park:skatepark_surface)$/;
const fenceBiteStats = { bites: 0, meshes: 0, triangles: 0, left: 0 };
//: The fence lines a triangle (page x / z corners) lies across, each with the side its bit is on:
//: [{ax, az, ux, uz, L, side}] -- side the sign of the bit's offset from the line.
//: ``lawnAt(x, z)``: whether the far side is lawn. Only a bite into a lawn is cut: paving that
//: carries on beyond a fence (a yard paved both sides of it) keeps the triangle that lays it.
function fenceLinesAcross(V, lawnAt = () => true) {
  const out = [];
  // Every fence in the cells the triangle covers (a plaza's triangle can be tens of metres long).
  const xs = V.map((p) => p[0]), zs = V.map((p) => p[1]), C = FENCE_LINE_CELL_M, seen = new Set(), lines = [];
  for (let i = Math.floor(Math.min(...xs) / C); i <= Math.floor(Math.max(...xs) / C); i += 1)
    for (let j = Math.floor(Math.min(...zs) / C); j <= Math.floor(Math.max(...zs) / C); j += 1)
      for (const line of fenceLineGrid.get(`${i}:${j}`) || []) if (!seen.has(line)) { seen.add(line); lines.push(line); }
  for (const line of lines) {
    const [ax, az, bx, bz] = line, L = Math.hypot(bx - ax, bz - az);
    if (!(L > 0.3)) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    const sd = V.map(([x, z]) => ux * (z - az) - uz * (x - ax)), along = V.map(([x, z]) => (x - ax) * ux + (z - az) * uz);
    if (Math.max(...along) < 0 || Math.min(...along) > L) continue;
    const hi = Math.max(...sd), lo = Math.min(...sd);
    if (!(hi > FENCE_BITE.slack_m && lo < -FENCE_BITE.slack_m)) continue;
    // The bit is the smaller side; a cover reaching well past on both sides runs on through.
    const side = hi < -lo ? 1 : -1, bite = Math.min(hi, -lo);
    if (bite > FENCE_BITE.most_m) continue;
    // What is beyond, at the bite: a step off the line, square from the middle of its corners there.
    const tips = V.filter((_, k) => side * sd[k] > FENCE_BITE.slack_m);
    const ta = Math.min(L, Math.max(0, tips.reduce((t, [x, z]) => t + (x - ax) * ux + (z - az) * uz, 0) / tips.length));
    if (!lawnAt(ax + ux * ta - uz * side * 0.3, az + uz * ta + ux * side * 0.3)) continue;
    // ``alongside``: the triangle lies wholly beside the fence, end to end -- cut exactly on its
    // line; one reaching past an end of it (a gap, a gate) is halved, and only beside the fence.
    out.push({ ax, az, ux, uz, L, side, sd, along, alongside: Math.min(...along) >= -0.1 && Math.max(...along) <= L + 0.1 });
  }
  return out;
}
//: A polygon in barycentric corners clipped to where ``keep(w)`` is not negative (keep is linear).
function clipBarycentric(poly, keep) {
  const out = [];
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ka = keep(a), kb = keep(b);
    if (ka >= 0) out.push(a);
    if ((ka >= 0) !== (kb >= 0)) { const s = ka / (ka - kb); out.push([0, 1, 2].map((c) => a[c] + (b[c] - a[c]) * s)); }
  }
  return out;
}
function cutPavingAtFences(lawnAt = () => true) {
  const meshes = [];
  groups.ground.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && FENCE_PAVED_SURFACES.test(o.userData?.surface || "") && o.geometry?.getIndex?.()) meshes.push(o); });
  for (const mesh of meshes) {
    mesh.updateMatrixWorld();
    const geom = mesh.geometry, pos = geom.attributes.position, index = geom.getIndex();
    const e = mesh.matrixWorld.elements, ox = e[12], oz = e[14];
    // The fences each triangle lies across, by its first index: cutCoverBy asks of a point, and
    // the point is beyond a fence only for the triangles across that fence.
    const across = new Map();
    for (let t = 0; t < index.count; t += 3) {
      const V = [0, 1, 2].map((k) => { const i = index.getX(t + k); return [pos.getX(i) + ox, pos.getZ(i) + oz]; });
      const lines = fenceLinesAcross(V, lawnAt);
      if (lines.length) across.set(t, lines);
    }
    fenceBiteStats.bites += across.size;
    if (!across.size) continue;
    // Each fence's bite out of the triangle, exactly: the part beyond its line and beside it --
    // between its ends; past an end (a gap, a gate) the paving carries on.
    const exactly = (t) => {
      let polys = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]]];
      for (const f of across.get(t) || []) {
        const sdOf = (w) => w[0] * f.sd[0] + w[1] * f.sd[1] + w[2] * f.sd[2];
        const alongOf = (w) => w[0] * f.along[0] + w[1] * f.along[1] + w[2] * f.along[2];
        const next = [];
        for (const poly of polys) {
          next.push(clipBarycentric(poly, (w) => -f.side * sdOf(w)));
          const bite = clipBarycentric(poly, (w) => f.side * sdOf(w));
          if (bite.length < 3) continue;
          next.push(clipBarycentric(bite, (w) => -alongOf(w)));
          next.push(clipBarycentric(clipBarycentric(bite, (w) => alongOf(w)), (w) => alongOf(w) - f.L));
        }
        polys = next.filter((poly) => poly.length >= 3);
      }
      return polys.flatMap((poly) => poly.slice(1, -1).map((_, k) => [poly[0], poly[k + 1], poly[k + 2]]));
    };
    const cut = cutCoverBy(mesh, () => false, FENCE_BITE.fine_m, (t) => across.has(t), exactly);
    if (cut) { fenceBiteStats.meshes += 1; fenceBiteStats.triangles += cut; }
    // What is left after the cut, counted the same way (the measured check: 0 when it worked).
    const after = geom.attributes.position;
    for (let t = 0; t < geom.index.count; t += 3) {
      const V = [0, 1, 2].map((k) => { const i = geom.index.getX(t + k); return [after.getX(i) + ox, after.getZ(i) + oz]; });
      if (fenceLinesAcross(V, lawnAt).some((f) => f.sd.some((d, k) => d * f.side > 0.15 && f.along[k] > 0.05 && f.along[k] < f.L - 0.05))) fenceBiteStats.left += 1;
    }
  }
  return fenceBiteStats;
}
function recutGroundOffRoads() {
  let cut = 0;
  const meshes = [];
  const lots = typeof PARKING_REGIONS !== "undefined" && PARKING_REGIONS.length > 0;
  groups.ground.traverse((o) => { if (o.isMesh && (ROAD_CUT_SURFACES.has(o.userData?.surface) || (lots && LOT_CUT_SURFACES.test(o.userData?.surface || "")))) meshes.push(o); });
  for (const mesh of meshes) {
    const geom = mesh.geometry, pos = geom?.attributes?.position, index = geom?.getIndex();
    if (!pos || !index || !mesh.parent) continue;
    mesh.updateMatrixWorld();
    const e = mesh.matrixWorld.elements, kept = [];
    const roads = ROAD_CUT_SURFACES.has(mesh.userData.surface), lotCut = lots && LOT_CUT_SURFACES.test(mesh.userData.surface || "");
    // Off the roadway along its edge (cutCoverBy), not a whole triangle at a time.
    if (roads) cut += cutCoverBy(mesh, (x, z) => insideCarriageway(x, z, 0), ROAD_CUT_FINE_M);
    // Off the car parks, along their outlines exactly (cutCoverOffLots).
    if (lotCut) cut += cutCoverOffLots(mesh);
  }
  if (cut && typeof requestFrame === "function") requestFrame();
  return cut;
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
//: Every fence laid on the ground, by the cells of a 6 m grid it crosses: a tree is never stood
//: on one (treeOffFence). A trunk on a fence's line had the fence running through it -- half the
//: tree in the park, half on the pavement (Moscone, Chestnut Street, 2026-11-22).
const FENCE_LINE_CELL_M = 6, fenceLineGrid = new Map();
//: Whose fence is being laid now: a property, a block of courts, a park area, a ground record.
//: The builders set it before they lay one (fenceOwnedBy). A fence's free end is carried on only
//: to a wall or to more of its own fence (closeFenceEnds), never to another's: a court's fence
//: and a school's are two fences, and joining them shut a park path at Moscone (2026-11-24).
var fenceOwnerNow = null;
function fenceOwnedBy(owner) { fenceOwnerNow = owner == null ? null : String(owner); }
function noteFenceLine(ax, az, bx, bz) {
  const line = [ax, az, bx, bz], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (FENCE_LINE_CELL_M / 2)));
  line.owner = typeof fenceOwnerNow === "undefined" ? null : fenceOwnerNow;
  for (let k = 0; k <= n; k += 1) {
    const key = Math.floor((ax + (bx - ax) * k / n) / FENCE_LINE_CELL_M) + ":" + Math.floor((az + (bz - az) * k / n) / FENCE_LINE_CELL_M);
    if (!fenceLineGrid.has(key)) fenceLineGrid.set(key, []);
    const bucket = fenceLineGrid.get(key); if (bucket.at(-1) !== line) bucket.push(line);
  }
}
//: The fence line nearest (x, z) within ``reach``: {d, nx, nz} -- how far off it (m), and the
//: unit way from the line to the point -- or null.
function nearestFenceLine(x, z, reach) {
  let best = null;
  const cx = Math.floor(x / FENCE_LINE_CELL_M), cz = Math.floor(z / FENCE_LINE_CELL_M);
  for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1)
    for (const [ax, az, bx, bz] of fenceLineGrid.get(`${cx + dx}:${cz + dz}`) || []) {
      const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
      if (!(L2 > 0)) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / L2));
      const px = ax + ux * t, pz = az + uz * t, d = Math.hypot(x - px, z - pz);
      if (d >= reach || (best && d >= best.d)) continue;
      // Off the line's middle the way out is square to it, on the side the point is (exactly on
      // it, the left of its run); off an end, straight away from the end.
      const L = Math.sqrt(L2), side = (ux * (z - az) - uz * (x - ax)) >= 0 ? 1 : -1;
      const [nx, nz] = d > 1e-3 && (t === 0 || t === 1) ? [(x - px) / d, (z - pz) / d] : [-uz / L * side, ux / L * side];
      best = { d, nx, nz };
    }
  return best;
}
//: One boundary, one fence. Five builders lay fences -- the ground's mapped and inferred fences,
//: the property lines, the courts' surrounds, the playgrounds', the gardens' -- and none knew of
//: the others: the Marina had three kilometres of fence doubled a hand's breadth to a metre off
//: another fence, or run along a house's wall (2026-11-22). A fence is laid only where no fence
//: already stands alongside it within FENCE_DOUBLE_M and no building wall does; the one already
//: there carries the line on, in its own material. And a way in is a way in through every layer:
//: each gate is noted before any fence is laid (noteFenceGate), and no fence crosses one.
const FENCE_DOUBLE_M = 1.5;
//: How finely a fence is tested along its length, and the shortest piece worth laying (m).
const FENCE_PIECE_STEP_M = 0.25, FENCE_PIECE_MIN_M = 0.4;
//: How far either side of a gate's line the gate keeps a fence out (m).
const FENCE_GATE_REACH_M = 1.0;
const fenceGateGrid = new Map();
function noteFenceGate(ax, az, bx, bz) {
  const gate = [ax, az, bx, bz], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (FENCE_LINE_CELL_M / 2)));
  for (let k = 0; k <= n; k += 1) {
    const key = Math.floor((ax + (bx - ax) * k / n) / FENCE_LINE_CELL_M) + ":" + Math.floor((az + (bz - az) * k / n) / FENCE_LINE_CELL_M);
    if (!fenceGateGrid.has(key)) fenceGateGrid.set(key, []);
    const bucket = fenceGateGrid.get(key); if (bucket.at(-1) !== gate) bucket.push(gate);
  }
}
// (The car parks' gates, noted while this part was still to come: module 14.)
if (typeof parkingGatesPending !== "undefined") { fenceGatesOpen = true; for (const g of parkingGatesPending.splice(0)) noteFenceGate(...g); }
// Each line in the cells round (x, z), once.
function* fenceLinesNear(grid, x, z) {
  const cx = Math.floor(x / FENCE_LINE_CELL_M), cz = Math.floor(z / FENCE_LINE_CELL_M), seen = new Set();
  for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1)
    for (const line of grid.get(`${cx + dx}:${cz + dz}`) || []) if (!seen.has(line)) { seen.add(line); yield line; }
}
//: Whether a fence running (ux, uz) through (x, z) is the same boundary as one already laid --
//: square off its middle, not past either end (the next panel of a run carries on from the last's
//: end and is not beside it), within FENCE_DOUBLE_M and running the same way -- or a building's
//: wall: the building there, or alongside on either hand.
function fenceAlreadyThere(x, z, ux, uz) {
  for (const [ax, az, bx, bz] of fenceLinesNear(fenceLineGrid, x, z)) {
    const vx = bx - ax, vz = bz - az, L = Math.hypot(vx, vz);
    if (!(L > 0) || Math.abs(ux * vx + uz * vz) / L < 0.9) continue;
    const t = ((x - ax) * vx + (z - az) * vz) / L;
    if (t <= 0.05 || t >= L - 0.05) continue;
    if (Math.abs((x - ax) * vz - (z - az) * vx) / L < FENCE_DOUBLE_M) return true;
  }
  if (typeof buildingAt !== "function") return false;
  if (buildingAt(x, z)) return true;
  for (const d of [0.4, 0.8, 1.2, FENCE_DOUBLE_M]) if (buildingAt(x - uz * d, z + ux * d) || buildingAt(x + uz * d, z - ux * d)) return true;
  return false;
}
//: Whether (x, z) is in the way of a noted gate: within FENCE_GATE_REACH_M of its line, between its posts.
function inFenceGate(x, z) {
  for (const [ax, az, bx, bz] of fenceLinesNear(fenceGateGrid, x, z)) {
    const vx = bx - ax, vz = bz - az, L = Math.hypot(vx, vz);
    if (!(L > 0)) continue;
    const t = ((x - ax) * vx + (z - az) * vz) / L;
    if (t > -0.05 && t < L + 0.05 && Math.abs((x - ax) * vz - (z - az) * vx) / L < FENCE_GATE_REACH_M) return true;
  }
  return false;
}
//: The footpaths, for the fences they cross: each mapped path a way through (pathThroughFence).
let fencePathGrid = null;
function fencePaths() {
  if (fencePathGrid) return fencePathGrid;
  fencePathGrid = new Map();
  for (const way of (typeof DATA === "object" && DATA.ways) || []) {
    if (way.kind !== "path" || !way.points || way.points.length < 2) continue;
    const half = (way.path_width_m || 2.4) / 2;
    const pts = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    for (let i = 1; i < pts.length; i += 1) {
      const line = [pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], half];
      const n = Math.max(1, Math.ceil(Math.hypot(line[2] - line[0], line[3] - line[1]) / (FENCE_LINE_CELL_M / 2)));
      for (let k = 0; k <= n; k += 1) {
        const key = Math.floor((line[0] + (line[2] - line[0]) * k / n) / FENCE_LINE_CELL_M) + ":" + Math.floor((line[1] + (line[3] - line[1]) * k / n) / FENCE_LINE_CELL_M);
        if (!fencePathGrid.has(key)) fencePathGrid.set(key, []);
        const bucket = fencePathGrid.get(key); if (bucket.at(-1) !== line) bucket.push(line);
      }
    }
  }
  return fencePathGrid;
}
//: Whether a footpath crosses a fence running (ux, uz) at (x, z): the path's width there, and a
//: hand either side, is left open. A park path ran up to the chain-link round Moscone and stopped
//: at it, with no way through (2026-11-22).
function pathThroughFence(x, z, ux, uz) {
  for (const [ax, az, bx, bz, half] of fenceLinesNear(fencePaths(), x, z)) {
    const vx = bx - ax, vz = bz - az, L = Math.hypot(vx, vz);
    if (!(L > 0) || Math.abs(ux * vx + uz * vz) / L > 0.75) continue;   // along the fence, not through it
    const t = Math.max(0, Math.min(L, ((x - ax) * vx + (z - az) * vz) / L));
    if (Math.hypot(x - ax - vx * t / L, z - az - vz * t / L) < half + 0.2) return true;
  }
  return false;
}
//: Whether (x, z) is on a mapped public path's tread, whichever way a fence there would run: no
//: fence ever stands on one. (pathThroughFence keeps a path's way through a fence that crosses
//: it; this keeps a fence off the path itself -- along it, or closing across it.)
function onPublicPath(x, z) {
  for (const [ax, az, bx, bz, half] of fenceLinesNear(fencePaths(), x, z)) {
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
    if (!(L2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
    if (Math.hypot(x - ax - vx * t, z - az - vz * t) < Math.max(0.5, half - 0.1)) return true;
  }
  return false;
}
//: Whether a yard fence at (x, z), running (ux, uz), would stand between a street and the front
//: of a building: the building within FENCE_FRONT.wall_m of it on one side and the roadway
//: within FENCE_FRONT.street_m on the other. A school's or a depot's chain link fences its open
//: yard; where the building itself comes up to the street the building is the boundary, and the
//: fence drawn on along its front stood a few steps before its doors (Marina Middle School on
//: Chestnut Street, 2026-11-23).
const FENCE_FRONT = { wall_m: 9, street_m: 10 };
function fenceBeforeFront(x, z, ux, uz) {
  if (typeof buildingAt !== "function" || typeof insideCarriageway !== "function") return false;
  const nx = -uz, nz = ux;
  for (const side of [1, -1]) {
    let wall = false, street = false;
    for (let d = 1.5; d <= FENCE_FRONT.wall_m && !wall; d += 1.5) wall = Boolean(buildingAt(x + nx * side * d, z + nz * side * d));
    if (!wall) continue;
    for (let d = 1; d <= FENCE_FRONT.street_m && !street; d += 1.5) street = insideCarriageway(x - nx * side * d, z - nz * side * d, 0);
    if (street) return true;
  }
  return false;
}
//: The pieces of a fence from (ax, az) to (bx, bz) still to be laid: [[ax, az, bx, bz], ...].
//: ``yard``: a yard's fence (chain link), not laid before a building's front (fenceBeforeFront).
function fencePieces(ax, az, bx, bz, yard = false) {
  const span = Math.hypot(bx - ax, bz - az);
  if (!(span > 0)) return [];
  const ux = (bx - ax) / span, uz = (bz - az) / span, n = Math.max(1, Math.round(span / FENCE_PIECE_STEP_M));
  const pieces = [];
  let from = null;
  for (let k = 0; k <= n; k += 1) {
    const t0 = span * k / n, t1 = span * (k + 1) / n, tm = (t0 + t1) / 2;
    const free = k < n && !fenceAlreadyThere(ax + ux * tm, az + uz * tm, ux, uz) && !inFenceGate(ax + ux * tm, az + uz * tm)
      && !pathThroughFence(ax + ux * tm, az + uz * tm, ux, uz) && !(typeof onPublicPath === "function" && onPublicPath(ax + ux * tm, az + uz * tm)) && !(yard && fenceBeforeFront(ax + ux * tm, az + uz * tm, ux, uz));
    if (free && from === null) from = t0;
    if (!free && from !== null) {
      if (t0 - from >= FENCE_PIECE_MIN_M) pieces.push([ax + ux * from, az + uz * from, ax + ux * t0, az + uz * t0]);
      from = null;
    }
  }
  return pieces;
}
//: Lays what is left of a fence (fencePieces) into `sink`, and says which pieces it laid.
//: What layFence laid, and what it left to a fence, a wall or a gate already there (m).
const fenceLayStats = { laid_m: 0, left_m: 0 };
function layFence(sink, ax, az, bx, bz, baseY, height, tileU, tileV = tileU, yard = false) {
  const pieces = fencePieces(ax, az, bx, bz, yard);
  if (yard) { const whole = Math.hypot(bx - ax, bz - az), kept = pieces.reduce((t, q) => t + Math.hypot(q[2] - q[0], q[3] - q[1]), 0); fenceLayStats.front_m = (fenceLayStats.front_m || 0) + Math.max(0, whole - kept); }
  let laid = 0;
  for (const [px, pz, qx, qz] of pieces) { groundedFencePanel(sink, px, pz, qx, qz, baseY, height, tileU, tileV); laid += Math.hypot(qx - px, qz - pz); }
  fenceLayStats.laid_m += laid;
  fenceLayStats.left_m += Math.max(0, Math.hypot(bx - ax, bz - az) - laid);
  return pieces;
}
//: How far a trunk's middle stands off a fence at least (m): its own half-width and a hand.
const TREE_FENCE_CLEAR_M = 0.6;
//: Where a tree at (x, z) stands clear of every fence: moved square off the line it is on, to the
//: side it already stands on, as far as it needs to be and no further -- or null where that spot
//: is roadway or building (it stays where it was).
function treeOffFence(x, z, okAt = () => true) {
  let px = x, pz = z;
  for (let i = 0; i < 3; i += 1) {
    const f = nearestFenceLine(px, pz, TREE_FENCE_CLEAR_M);
    if (!f) return i ? [px, pz] : null;
    const push = TREE_FENCE_CLEAR_M - f.d + 0.02;
    const qx = px + f.nx * push, qz = pz + f.nz * push;
    if (okAt(qx, qz)) { px = qx; pz = qz; continue; }
    // That side has no room: the other side of the line, as far again.
    const rx = px - f.nx * (f.d + TREE_FENCE_CLEAR_M + 0.02), rz = pz - f.nz * (f.d + TREE_FENCE_CLEAR_M + 0.02);
    if (!okAt(rx, rz)) return null;
    px = rx; pz = rz;
  }
  return nearestFenceLine(px, pz, TREE_FENCE_CLEAR_M) ? null : [px, pz];
}
//: A tree's base on the ground: the round of it tested for lawn, and how far it may be moved to
//: stand wholly on the lawn it touches (m).
const TREE_ON_GRASS = { base_m: 0.6, reach_m: 3, step_m: 0.25, around: 8 };
//: Where a tree at (x, z) stands wholly on grass: null where its base touches no grass (it is in
//: paving) or is all on grass already (it stays); the nearest spot within TREE_ON_GRASS.reach_m
//: whose whole base is grass and where ``okAt`` allows a trunk; or false where there is none.
function treeOntoGrass(x, z, grassAt, okAt = () => true) {
  const { base_m: r, reach_m, step_m, around } = TREE_ON_GRASS;
  const ring = (cx, cz) => [[cx, cz], ...Array.from({ length: around }, (_, k) => {
    const a = k * 2 * Math.PI / around; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  })];
  const here = ring(x, z).map(([px, pz]) => grassAt(px, pz));
  if (!here.some(Boolean) || here.every(Boolean)) return null;
  for (let d = step_m; d <= reach_m + 1e-9; d += step_m) {
    // Round the circle at this distance, the side the grass is on first.
    const n = Math.max(8, Math.round(2 * Math.PI * d / step_m));
    let best = null;
    for (let k = 0; k < n; k += 1) {
      const a = k * 2 * Math.PI / n, cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d;
      if (!ring(cx, cz).every(([px, pz]) => grassAt(px, pz)) || !okAt(cx, cz)) continue;
      // Of the spots this far off, the one nearest the middle of the grass it touched.
      const score = here.reduce((s, g, i) => s + (g && i ? Math.cos(a - (i - 1) * 2 * Math.PI / around) : 0), 0);
      if (!best || score > best.score) best = { score, at: [cx, cz] };
    }
    if (best) return best.at;
  }
  return false;
}
//: Every panel laid, for the closing of the fences' free ends (closeFenceEnds): where it runs,
//: how it stands, and the mesh it is drawn in (whose material a closing panel takes).
var fencePanelsLaid = [];
function groundedFencePanel(sink, ax, az, bx, bz, baseY, height, tileU, tileV = tileU) {
  const span=Math.hypot(bx-ax,bz-az);
  if (!(span>0) || !Number.isFinite(span)) return;
  // (A gate's leaf, swung open, is not a fence with ends to close: sink.leaf.)
  if (!sink.closing && !sink.leaf && typeof fencePanelsLaid !== "undefined") fencePanelsLaid.push({ sink, ax, az, bx, bz, baseY, height, tileU, tileV,
    owner: typeof fenceOwnerNow === "undefined" ? null : fenceOwnerNow });
  noteFenceLine(ax, az, bx, bz);
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

// ---- no fence with a way round its end ----------------------------------------------------------
//
// A fence encloses: each end of it meets a wall or another fence, or it is a gate. Laid from
// records of single boundary lines, many had one end -- or both -- standing in the open: a
// school yard's chain link along two sides of the yard and stopped, a garden's fence along its
// front and nothing down its sides; walked round (the owner, 2026-11-24). Once every fence is
// laid, each end that meets nothing is carried on to what would close it: straight on to the
// first wall or more of its own fence in its way within FENCE_CLOSE.ahead_m, else square off its
// line, to either hand, to the nearest within FENCE_CLOSE.aside_m. Never onto another fence: two
// owners' fences are two fences (a court's and a school's, joined, shut a park path at Moscone,
// 2026-11-24), and another's fence in the way leaves the end as it is. Never across a roadway, a pavement, a
// mapped path, a noted gate or the way from a dropped kerb to its garage; and an end at a gate
// or a path (where the fence was parted on purpose) is left as it is.
const FENCE_CLOSE = { meet_m: 0.45, ahead_m: 25, aside_m: 10, back_m: 0.35, step_m: 0.25, least_m: 0.5 };
const fenceCloseStats = { ends: 0, met: 0, gates: 0, closed: 0, closed_m: 0, open: 0, other: 0 };
function closeFenceEnds() {
  const panels = fencePanelsLaid;
  if (!panels.length || typeof buildingAt !== "function") return fenceCloseStats;
  // Each panel's ends, and which of them meet another panel's end (the same fence carrying on).
  const key = (x, z) => `${Math.round(x / 0.3)}:${Math.round(z / 0.3)}`;
  const ends = new Map();
  for (const q of panels) for (const [x, z] of [[q.ax, q.az], [q.bx, q.bz]]) {
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) { const k = `${Math.round(x / 0.3) + dx}:${Math.round(z / 0.3) + dz}`; ends.set(k, (ends.get(k) || 0) + (dx || dz ? 0.001 : 1)); }
  }
  // Whether (x, z) is on a fence other than ``own`` (with ``mine``, only on more of own's fence:
  // its owner's -- an ownerless fence has none).
  const fenceAt = (x, z, own, reach = 0.2, mine = false) => {
    for (const line of fenceLinesNear(fenceLineGrid, x, z)) {
      const [ax, az, bx, bz] = line;
      if (mine && (own?.owner == null || line.owner !== own.owner)) continue;
      if (own && Math.abs(ax - own.ax) < 1e-6 && Math.abs(az - own.az) < 1e-6 && Math.abs(bx - own.bx) < 1e-6 && Math.abs(bz - own.bz) < 1e-6) continue;
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      if (!(L2 > 0)) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      if (Math.hypot(x - ax - vx * t, z - az - vz * t) < reach) return true;
    }
    return false;
  };
  // A public way: the roadway, a pavement, a park's paving, a mapped path's tread, a driveway.
  const publicWay = (x, z) => insideCarriageway(x, z, 0.1) || pavementTopAt(x, z) !== undefined
    || (typeof inDriveway === "function" && inDriveway(x, z))
    || (typeof parkPavementAt === "function" && parkPavementAt(x, z)) || (typeof onPublicPath === "function" && onPublicPath(x, z));
  // Along a ray from an end: how far to the first wall or more of its own fence, or null where
  // the way is not clear to one within ``reach``. Another owner's fence in the way stops it: two
  // fences are not joined into one (a court's and a school's shut a path between them, Moscone).
  // (The closing panel runs along the ray, (ux, uz): a path crossing the ray crosses it. The
  // test once took the ray's square for the panel's run, and let a closing cross the paths it
  // was meant to keep clear of.)
  const reachTo = (x, z, ux, uz, reach, own) => {
    for (let d = FENCE_CLOSE.step_m; d <= reach; d += FENCE_CLOSE.step_m) {
      const px = x + ux * d, pz = z + uz * d;
      if (buildingAt(px, pz)) return d - FENCE_CLOSE.step_m * 0.5;
      if (d > 0.5 && fenceAt(px, pz, own, 0.2, true)) return d;
      if (d > 0.5 && fenceAt(px, pz, own)) { fenceCloseStats.other += 1; return null; }
      if (publicWay(px, pz) || inFenceGate(px, pz) || pathThroughFence(px, pz, ux, uz)) return null;
    }
    return null;
  };
  const added = new Map();   // sink -> { positions, uvs, indices }
  for (const q of panels) {
    const span = Math.hypot(q.bx - q.ax, q.bz - q.az), ux = (q.bx - q.ax) / span, uz = (q.bz - q.az) / span;
    for (const [x, z, sx, sz] of [[q.ax, q.az, -ux, -uz], [q.bx, q.bz, ux, uz]]) {
      // An end another panel's end is at carries on: not an end.
      if ((ends.get(key(x, z)) || 0) >= 2) continue;
      fenceCloseStats.ends += 1;
      // Met already: a wall or another fence within a step of it.
      let met = Boolean(buildingAt(x + sx * 0.3, z + sz * 0.3)) || fenceAt(x + sx * 0.15, z + sz * 0.15, q, FENCE_CLOSE.meet_m);
      for (const [nx, nz] of [[-sz, sx], [sz, -sx]]) met ||= Boolean(buildingAt(x + nx * 0.35, z + nz * 0.35));
      if (met) { fenceCloseStats.met += 1; continue; }
      // Parted on purpose: a gate, or a path through.
      if (inFenceGate(x + sx * 0.6, z + sz * 0.6) || pathThroughFence(x + sx * 0.6, z + sz * 0.6, sx, sz) || pathThroughFence(x + sx * 1.6, z + sz * 1.6, sx, sz)) { fenceCloseStats.gates += 1; continue; }
      // Carried on: straight ahead first, then square to either hand (the nearer).
      let best = null;
      const ahead = reachTo(x, z, sx, sz, FENCE_CLOSE.ahead_m, q);
      if (ahead !== null) best = { d: ahead, ux: sx, uz: sz };
      // (To the side from a step back along the fence: an end that stops at a pavement's edge
      // is closed along the line behind it, not along the pavement.)
      else for (const [nx, nz] of [[-sz, sx], [sz, -sx]]) {
        const bx = x - sx * FENCE_CLOSE.back_m, bz = z - sz * FENCE_CLOSE.back_m;
        const d = reachTo(bx, bz, nx, nz, FENCE_CLOSE.aside_m, q);
        if (d !== null && (!best || d < best.d)) best = { d, ux: nx, uz: nz, x: bx, z: bz };
      }
      if (!best || best.d < FENCE_CLOSE.least_m) { fenceCloseStats.open += best ? 0 : 1; if (best) fenceCloseStats.met += 1; continue; }
      let sink = added.get(q.sink);
      if (!sink) added.set(q.sink, sink = { positions: [], uvs: [], indices: [], closing: true, from: q });
      const fx = best.x ?? x, fz = best.z ?? z;
      typeof fenceOwnedBy === "function" && fenceOwnedBy(q.owner);
      groundedFencePanel(sink, fx, fz, fx + best.ux * best.d, fz + best.uz * best.d, q.baseY, q.height, q.tileU, q.tileV);
      fenceCloseStats.closed += 1; fenceCloseStats.closed_m += best.d;
    }
  }
  // Each closing panel in the material of the fence it closes.
  for (const [from, sink] of added) {
    const material = from.mesh?.material;
    if (!material || !sink.indices.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
    geom.setIndex(sink.indices); geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, material);
    mesh.userData = { ...from.mesh.userData, closes: true, liftedOntoGround: true };
    mesh.renderOrder = from.mesh.renderOrder; mesh.castShadow = from.mesh.castShadow;
    (from.mesh.parent || groups.ground).add(mesh);
  }
  typeof fenceOwnedBy === "function" && fenceOwnedBy(null);
  fenceCloseStats.closed_m = Math.round(fenceCloseStats.closed_m);
  fencePanelsLaid = [];
  return fenceCloseStats;
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
    const fenceSink = { positions, uvs, indices };
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
      // One fence is the segments that run on end to end; the next that starts elsewhere is another.
      if (!(i >= 4 && Math.hypot(ax - flat[i - 2], az + flat[i - 1]) < 0.05)) typeof fenceOwnedBy === "function" && fenceOwnedBy(`ground:${kind}:${i}`);
      layFence(fenceSink,ax,az,bx,bz,YARD_Y,style.h,style.tile,style.tile,/chain/.test(String(kind)));
    }
    typeof fenceOwnedBy === "function" && fenceOwnedBy(null);
    if (!indices.length) continue;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    const fence=addGround(new THREE.Mesh(geom, fenceMaterial(style)), "fence:" + kind);
    fence.userData.liftedOntoGround=true;
    fenceSink.mesh=fence;
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

//: The plain concrete a court's slab is round its painted courts: the concrete's grey taken a
//: third of the way to the court's own colour, so the slab reads as the court's ground and not
//: as a car park beside it. (A tint over the concrete texture: SIDEWALK is pale, so the tint is
//: the colour the slab comes out.)
const COURT_SLAB_GREY = 0xb3b0a8, COURT_SLAB_TONE = 0.33;
function courtSlabColour(style) {
  const play = style.play ?? style.surround ?? COURT_SLAB_GREY, k = COURT_SLAB_TONE;
  const mix = (shift) => Math.round(((COURT_SLAB_GREY >> shift) & 255) * (1 - k) + ((play >> shift) & 255) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}
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

//: Chain link as it is made: wire woven into 2-inch diamonds, each wire hooked round the next
//: (the knuckles), in black vinyl. The wires are worked out in the shader from where a point of
//: the panel is in the world -- 50 mm apart, 4.8 mm thick with the coating -- and shaded round,
//: so the sun glints along them. A wire is never drawn thinner than a pixel: seen along the fence
//: the gaps close up and it reads as the dark screen a real one does, where a flat picture of
//: wires on a sheet vanished edge-on. Too far off for wires, it is a veil as dense as the wire is.
//: The fabric casts no fine shadow (it would be a solid sheet's); the posts and rails do.
let CHAINLINK_MATERIAL = null;
function chainlinkMaterial() {
  if (CHAINLINK_MATERIAL) return CHAINLINK_MATERIAL;
  const material = new THREE.MeshStandardMaterial({ color: 0x1b1e20, roughness: 0.42, metalness: 0, side: THREE.DoubleSide });
  material.userData.noShadow = true; material.userData.wire = "chainlink";
  const pageHook = THREE.Material.prototype.onBeforeCompile, pageKey = THREE.Material.prototype.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    pageHook.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 kbCLw; varying vec3 kbCLn;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nkbCLw = (modelMatrix * vec4(transformed, 1.0)).xyz; kbCLn = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 kbCLw; varying vec3 kbCLn;")
      .replace("#include <map_fragment>", `#include <map_fragment>
float kbCLo = 0.0; vec3 kbCLd = vec3(0.0, 1.0, 0.0);
{
  vec3 kbCN = normalize(kbCLn); vec2 kbCT = normalize(vec2(kbCN.z, -kbCN.x) + vec2(1e-5, 0.0));
  float kbCS = dot(kbCLw.xz, kbCT), kbCY = kbCLw.y;
  float kbCA = (kbCS + kbCY) * 14.142, kbCB = (kbCS - kbCY) * 14.142;      // in wire spacings: 0.7071 / 0.05 m
  float kbCFa = fwidth(kbCA), kbCFb = fwidth(kbCB), kbCW = 0.048;            // half a 4.8 mm wire, in spacings
  float kbCa = abs(fract(kbCA) - 0.5), kbCb = abs(fract(kbCB) - 0.5);
  if (max(kbCFa, kbCFb) > 0.6) {
    float kbCNv = abs(dot(kbCN, normalize(cameraPosition - kbCLw)));
    if (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > min(0.8, 4.0 * kbCW / max(kbCNv, 0.15))) discard;
  } else {
    float kbCKnot = (1.0 - smoothstep(0.0, 0.16, kbCa)) * (1.0 - smoothstep(0.0, 0.16, kbCb));
    float kbCWa = max(kbCW, 0.6 * kbCFa) * (1.0 + 1.2 * kbCKnot), kbCWb = max(kbCW, 0.6 * kbCFb) * (1.0 + 1.2 * kbCKnot);
    bool kbCOnA = kbCa < kbCWa, kbCOnB = kbCb < kbCWb;
    if (!kbCOnA && !kbCOnB) discard;
    vec3 kbCT3 = vec3(kbCT.x, 0.0, kbCT.y);
    if (kbCOnA && (!kbCOnB || kbCa / kbCWa < kbCb / kbCWb)) { kbCLo = (fract(kbCA) - 0.5) / kbCWa; kbCLd = (kbCT3 + vec3(0.0, 1.0, 0.0)) * 0.7071; }
    else { kbCLo = (fract(kbCB) - 0.5) / kbCWb; kbCLd = (kbCT3 - vec3(0.0, 1.0, 0.0)) * 0.7071; }
    kbCLo = clamp(kbCLo, -1.0, 1.0) * 0.85;
  }
}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
normal = normalize(normal * sqrt(max(0.0, 1.0 - kbCLo * kbCLo)) + normalize((viewMatrix * vec4(kbCLd, 0.0)).xyz) * kbCLo);`);
  };
  material.customProgramCacheKey = function () { return `${pageKey.call(this)}|chainlink`; };
  return (CHAINLINK_MATERIAL = material);
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
  // Outside a park (a schoolyard, a rec centre's yard, a block's private courts: 71 of the
  // city's courts) a hard court's ground is not a lawn: it was drawn as one, a ring of grass
  // round the basketball courts in a paved schoolyard (Marina Middle School, 2026-11-12). There
  // it is the court's own surround, asphalt in its colour ("hard:<colour>").
  const parkVariantAt = (lon, lat) => {
    const park = (ground.parks || []).find((q) => pointInRing(lon, lat, q.p));
    return park ? grassVariantForRing(park.p, GRASS_VARIANTS) : null;
  };
  // A hard court in a park is not set in the lawn either: inside its fence it is one slab, the
  // courts' coloured acrylic laid on it and the rest of it -- the run-off, the strip by the
  // fence -- plain concrete, unpainted, toned to the court ("slab:<colour>", courtSlabColour).
  // Its pad was the park's grass, and a tennis court's fence held as much lawn as court
  // (Moscone, 2026-11-24). A field (soccer: surround null) is grass still.
  const byVariant = new Map();
  for (const pitch of pitches) {
    const style = COURT_STYLE[pitch.s];
    if (!style) continue;
    const [lon, lat] = ringCentroid(pitch.p);
    const inPark = style.surround === null ? -1 : parkVariantAt(lon, lat);
    const variant = inPark === -1 ? -1 : inPark !== null ? `slab:${courtSlabColour(style)}` : `hard:${style.surround}`;
    if (!byVariant.has(variant)) byVariant.set(variant, []);
    byVariant.get(variant).push(pitch.p);
  }
  for (const [variant, rings] of byVariant) {
    const geom = ringGeometry(rings, COURT_Y);
    if (!geom) continue;
    if (typeof variant === "string" && variant.startsWith("slab:")) {
      const pad = addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        map: SIDEWALK, color: Number(variant.slice(5)), roughness: 0.93, metalness: 0.0,
        side: THREE.DoubleSide, depthWrite: false,
      })), "court");
      pad.renderOrder = -0.5;
      pad.userData.courtSlab = true;
      continue;
    }
    if (typeof variant === "string") {
      const pad = addGround(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        map: courtSurface(Number(variant.slice(5))), color: 0xffffff, roughness: 0.9, metalness: 0.0,
        side: THREE.DoubleSide, depthWrite: false,
      })), "court");
      pad.renderOrder = -0.5;
      continue;
    }
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
  const courtFenceSink = { positions: fencePositions, uvs: fenceUvs, indices: fenceIndices };
  const fencePosts = [];
  const fenceRails = [], fenceJoints = new Map();
  for (const [pitchIndex, pitch] of pitches.entries()) {
    const style = COURT_STYLE[pitch.s];
    if (!style || !style.fence) continue;
    typeof fenceOwnedBy === "function" && fenceOwnedBy(`court:${pitch.k ?? pitchIndex}`);
    // Within a block, the fence between one sport's courts and another's (court_complexes'
    // dividers), as tall as the taller of the two; courts of one sport share open run-off.
    const runs = [...(pitch.fence_runs ? pitch.fence_runs.map(r=>[r.p,style.fence]) : [[pitch.p, style.fence]]), ...(pitch.dividers || []).map((d) => [d.p,
      Math.max(...d.s.map((s) => (COURT_STYLE[s] || COURT_STYLE[`${s}_half`] || style).fence || style.fence))])];
    for (const [ring, h] of runs) for (let i = 0; i < ring.length - 1; i += 1) {
      const [sx, sy] = xy(ring[i][0], ring[i][1]);
      const [ex, ey] = xy(ring[i + 1][0], ring[i + 1][1]);
      const sz = -sy, ez = -ey;
      if (Math.hypot(ex - sx, ez - sz) < 0.4) continue;
      if (insideCarriageway(sx, sz, -1.0) || insideCarriageway(ex, ez, -1.0)) continue;
      // Only what no fence or wall already carries (layFence): a court beside another shares its fence.
      for (const [ax, az, bx, bz] of layFence(courtFenceSink,
        sx,sz,ex,ez,COURT_Y,h,.6)) {
      const span = Math.hypot(bx - ax, bz - az);
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
  }
  typeof fenceOwnedBy === "function" && fenceOwnedBy(null);
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
    // (Wire, not sheeting: chainlinkMaterial.)
    const fence=new THREE.Mesh(geom, chainlinkMaterial());
    fence.userData={surface:"fence:court",liftedOntoGround:true,elevationBasis:"terrain_sampled_0.75m"};
    groups.ground.add(fence);
    courtFenceSink.mesh=fence;
  }
  if (fencePosts.length) {
    const post = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.035, 0.04, 1, 5),
      new THREE.MeshStandardMaterial({ color: 0x1c1f21, roughness: 0.45, metalness: 0.2 }),
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

