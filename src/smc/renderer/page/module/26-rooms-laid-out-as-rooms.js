// ---- rooms laid out as rooms: what goes against which wall, facing which way ----------------
//
// A room used to hold one piece of furniture wherever it fitted, turned whichever way fitted: a
// sofa could stand in the middle of the floor facing a wall. Each room is now laid out by the
// rules a room is furnished by. A sofa's back is to a wall and it faces into the room; the
// television is on the wall opposite, facing it, at a viewing distance, with a coffee table
// between and a rug under that; an armchair beside them turns to the table. A bed's head is to
// a wall, with a nightstand either side and a chest of drawers on another wall. Dining chairs
// face their table. Every piece is tested whole against the room, the building, the doorways,
// the stair and everything placed before it; what does not fit is left out, not squeezed in.
//
// The models are Poly Haven's (CC0) and scans from Google Scanned Objects (CC BY 4.0), listed in
// interior-assets/manifest.json. Each piece is drawn as a plain block until its model arrives.
// A piece's front is its local +z: a model is turned so its back (a sofa's or bed's tall side)
// is at -z.
const ROOM_DOOR_CLEAR_M = 0.8;
let interiorManifestPromise = null;
function interiorAssetBase() {
  const registry = document.querySelector('meta[name="kerbside-regions"]')?.content || "regions.json";
  return new URL("interior-assets/", new URL(registry, location.href));
}
function interiorManifest() {
  if (!interiorManifestPromise) {
    interiorManifestPromise = fetch(new URL("manifest.json", interiorAssetBase()).href)
      .then((r) => (r.ok ? r.json() : { assets: [] })).catch(() => ({ assets: [] }));
  }
  return interiorManifestPromise;
}
const interiorModelPromises = new Map();
//: Glass in a model (a bulb, a lamp's shade) is drawn as plain see-through glass, not as
//: three.js's transmission: one transmissive material anywhere in view makes the renderer draw
//: the whole scene a second time, every frame, into a buffer for it to refract -- the city twice
//: over for a light bulb, and every building material's shader looked up again for each pass.
const modelGlass = new THREE.MeshStandardMaterial({ color: 0xfff6e8, transparent: true, opacity: 0.35,
  roughness: 0.05, metalness: 0, emissive: 0xffe2b0, emissiveIntensity: 0.6, depthWrite: false });
function plainGlass(scene) {
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const swap = (m) => (m && (m.transmission > 0 || m.isMeshPhysicalMaterial && m.thickness > 0) ? modelGlass : m);
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return scene;
}
//: The furniture's models are fetched only for a house the walker is at: the rooms of a house
//: seen through its windows from the street stand as plain blocks, and the eight or so houses
//: round the starting point no longer each pull a sofa, a bed and their textures in while the
//: city is still being built. MODEL_NEAR_M from the house, or inside it, the models come.
const MODEL_NEAR_M = 30;
const modelWaiters = [];
let modelEntry = null;
function nearModelEntry(entry) {
  if (!entry || typeof avatar === "undefined") return false;
  const x = avatar.position.x, z = avatar.position.z;
  return Math.hypot(Math.max(entry.minX - x, 0, x - entry.maxX), Math.max(entry.minZ - z, 0, z - entry.maxZ)) < MODEL_NEAR_M;
}
function whenNear(entry, run) {
  if (!entry || nearModelEntry(entry)) return run();
  return new Promise((resolve) => modelWaiters.push({ entry, go: () => resolve(run()) }));
}
function releaseNearModels() {
  for (let i = modelWaiters.length - 1; i >= 0; i -= 1) {
    const waiter = modelWaiters[i];
    if (!waiter.entry.interior) { modelWaiters.splice(i, 1); continue; }
    if (nearModelEntry(waiter.entry)) { modelWaiters.splice(i, 1); waiter.go(); }
  }
}
//: The model for a role, chosen by seed among those the manifest has for it.
function interiorModel(role, seed) {
  if (modelEntry) { const entry = modelEntry; return whenNear(entry, () => loadInteriorModel(role, seed)); }
  return loadInteriorModel(role, seed);
}
function loadInteriorModel(role, seed) {
  return interiorManifest().then((manifest) => {
    const rows = (manifest.assets || []).filter((row) => (row.role || row.kind) === role);
    if (!rows.length) return null;
    const row = rows[Math.floor(random(seed) * rows.length) % rows.length];
    if (!interiorModelPromises.has(row.id)) {
      const url = new URL(row.model, interiorAssetBase()).href;
      interiorModelPromises.set(row.id, new GLTFLoader().loadAsync(url).then((gltf) => {
        const scene = plainGlass(gltf.scene);
        scene.userData.row = row;
        return scene;
      }).catch(() => null));
    }
    return interiorModelPromises.get(row.id);
  });
}
//: Which way a model's back is: the side its tallest parts are on (a sofa's back, a bed's head,
//: a chair's back). Returns true when that side is +z, so the model must be turned round.
function modelBackIsPlusZ(template) {
  if (template.userData.backPlusZ !== undefined) return template.userData.backPlusZ;
  template.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(template);
  const cut = box.min.y + (box.max.y - box.min.y) * 0.75;
  const centre = (box.min.z + box.max.z) / 2;
  let sum = 0, n = 0;
  const v = new THREE.Vector3();
  template.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y >= cut) { sum += v.z - centre; n += 1; }
    }
  });
  template.userData.backPlusZ = n > 0 && sum / n > 0.02 * (box.max.z - box.min.z);
  return template.userData.backPlusZ;
}
//: A piece: a holder at its place on the floor, drawn as a block until its model is in, the
//: model then scaled to sit inside the w x d x h the layout gave it.
function furniturePiece(group, role, seed, cx, cz, yaw, floorY, w, d, h, block, opts = {}) {
  const holder = new THREE.Group();
  holder.position.set(cx, floorY + (opts.lift || 0), cz);
  holder.rotation.y = yaw;
  holder.userData = { surface: `furnishing:${role}`, grade: "inferred_from_room_type",
    source: "fitted_external_floor_plan" };
  const placeholder = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, h, d * 0.92), block);
  placeholder.position.y = h / 2;
  placeholder.castShadow = true;
  holder.add(placeholder);
  group.add(holder);
  interiorModel(role, seed).then((template) => {
    if (!template || !holder.parent) return;
    const model = template.clone(true);
    const turn = opts.orient && modelBackIsPlusZ(template) ? Math.PI : 0;
    model.rotation.y = turn;
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = Math.min(opts.grow || 1, w / Math.max(size.x, 0.01), d / Math.max(size.z, 0.01),
      (opts.maxH || h * 1.6) / Math.max(size.y, 0.01));
    const centre = bounds.getCenter(new THREE.Vector3());
    model.scale.multiplyScalar(scale);
    model.position.set(-centre.x * scale, -bounds.min.y * scale, -centre.z * scale);
    model.traverse((o) => { if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      o.userData.sharedInteriorAsset = true;
    } });
    holder.remove(placeholder);
    placeholder.geometry.dispose();
    holder.add(model);
    holder.userData.assetLicense = template.userData.row?.license;
    holder.userData.assetSource = template.userData.row?.attribution;
    holder.userData.topY = size.y * scale;
    // The top's footprint: the model's own, as scaled into the piece's place.
    if (opts.onModel) opts.onModel(holder, size.y * scale, { w: size.x * scale, d: size.z * scale });
  });
  return holder;
}

//: The room as walls with inward normals, and a test for whether a w x d piece at (cx, cz)
//: turned to yaw stands clear of everything.
function roomLayout(entry, pts, doorsInPlan) {
  const walls = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.6) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    let nx = -uz, nz = ux;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (!pointInRing(mx + nx * 0.3, mz + nz * 0.3, pts)) { nx = -nx; nz = -nz; }
    walls.push({ a, b, len, ux, uz, nx, nz, index: i });
  }
  walls.sort((p, q) => q.len - p.len);
  const placed = [];
  const corners = (cx, cz, yaw, w, d) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // Local x is along (cos, -sin) and local z along (sin, cos) for a rotation.y of yaw.
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
      .map(([lx, lz]) => [cx + c * lx + s * lz, cz - s * lx + c * lz]);
  };
  const clear = (x, z, ignorePlaced) => pointInRing(x, z, pts) && insideFootprint(entry, x, z)
    && !(entry.accessZones || []).some((zone) => pointInRing(x, z, zone))
    && !doorsInPlan.some(([dx, dz]) => Math.hypot(dx - x, dz - z) < ROOM_DOOR_CLEAR_M)
    && (ignorePlaced || !placed.some((ring) => pointInRing(x, z, ring)));
  const fits = (cx, cz, yaw, w, d, ignorePlaced = false) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const nxs = Math.max(2, Math.ceil(w / 0.2)), nzs = Math.max(2, Math.ceil(d / 0.2));
    for (let i = 0; i <= nxs; i += 1) {
      for (let j = 0; j <= nzs; j += 1) {
        const lx = -w / 2 + w * i / nxs, lz = -d / 2 + d * j / nzs;
        if (!clear(cx + c * lx + s * lz, cz - s * lx + c * lz, ignorePlaced)) return false;
      }
    }
    return true;
  };
  const occupy = (cx, cz, yaw, w, d) => placed.push(corners(cx, cz, yaw, w, d));
  //: Places along a wall for a w x d piece backed onto it, middle of the wall first.
  const alongWall = (wall, w, d) => {
    const spots = [];
    for (let t = w / 2 + 0.06; t <= wall.len - w / 2 - 0.06; t += 0.2) spots.push(t);
    spots.sort((p, q) => Math.abs(p - wall.len / 2) - Math.abs(q - wall.len / 2));
    return spots.map((t) => ({
      cx: wall.a[0] + wall.ux * t + wall.nx * (d / 2 + 0.06),
      cz: wall.a[1] + wall.uz * t + wall.nz * (d / 2 + 0.06),
      yaw: Math.atan2(wall.nx, wall.nz), wall, t,
    }));
  };
  const centroid = pts.reduce((p, q) => [p[0] + q[0] / pts.length, p[1] + q[1] / pts.length], [0, 0]);
  return { walls, placed, fits, occupy, alongWall, centroid, clear };
}

//: A ceiling light: a fitting from the library at the ceiling, a lit bulb in it.
const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1d0 });
const cordMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
function addCeilingLight(group, layout, seed, floorY, height, kind) {
  let [x, z] = layout.centroid;
  if (!layout.clear(x, z, true)) {
    const found = layout.walls.length ? (() => {
      for (const wall of layout.walls) {
        const px = (wall.a[0] + wall.b[0]) / 2 + wall.nx * 1.0, pz = (wall.a[1] + wall.b[1]) / 2 + wall.nz * 1.0;
        if (layout.clear(px, pz, true)) return [px, pz];
      }
      return null;
    })() : null;
    if (!found) return null;
    [x, z] = found;
  }
  const ceiling = floorY + height;
  const fixture = new THREE.Group();
  fixture.position.set(x, ceiling, z);
  fixture.userData = { surface: "furnishing:ceiling_light", grade: "inferred_from_room_type" };
  const pendant = ["living", "dining", "bedroom"].includes(kind);
  // Close to the ceiling: a seven-foot walker's eyes are near two metres up, and a shade hung
  // lower filled the view in every room.
  const drop = pendant ? 0.16 : 0.2;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, drop, 6), cordMaterial);
  cord.position.y = -drop / 2;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), bulbMaterial);
  bulb.position.y = -drop - 0.05;
  fixture.add(cord, bulb);
  group.add(fixture);
  // The shade (or, in a hall or bathroom, the bulb's own glass) from the library, hung on the cord.
  interiorModel(pendant ? "ceiling_lamp" : "bulb", seed).then((template) => {
    if (!template || !fixture.parent) return;
    const model = template.clone(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const target = pendant ? 0.4 : 0.12;
    const scale = Math.min(target / Math.max(size.x, size.z, 0.01), (pendant ? 0.32 : 0.16) / Math.max(size.y, 0.01));
    const centre = bounds.getCenter(new THREE.Vector3());
    model.scale.multiplyScalar(scale);
    // Hung by its top from the end of the cord.
    model.position.set(-centre.x * scale, -drop - bounds.max.y * scale + (pendant ? 0.05 : 0.04), -centre.z * scale);
    model.traverse((o) => { if (o.isMesh) o.userData.sharedInteriorAsset = true; });
    fixture.add(model);
  });
  return [x, ceiling - drop - 0.05, z];
}

//: How far a small thing on a surface stays in from the surface's edge.
const SURFACE_EDGE_M = 0.03;
//: The scale a small thing (w x d) takes on a surface (surfaceW x surfaceD): its real size, an
//: outsized one brought down to 35 cm, and any that would overhang brought down to fit inside the
//: surface's edge. It stands at the surface's middle. Null when the surface holds nothing.
function itemOnSurface(w, d, surfaceW, surfaceD) {
  const roomW = surfaceW - 2 * SURFACE_EDGE_M, roomD = surfaceD - 2 * SURFACE_EDGE_M;
  if (!(roomW > 0.05 && roomD > 0.05)) return null;
  return Math.min(1, 0.35 / Math.max(w, d, 0.01), roomW / Math.max(w, 0.01), roomD / Math.max(d, 0.01));
}
//: A small scanned thing set on a surface once the surface's model (and so its height and its
//: footprint) is in: centred on it and wholly on it, never hanging off its side.
function setOnTop(role, seed) {
  return (h, top, surface) => {
    interiorModel(role, seed).then((template) => {
      if (!template || !h.parent) return;
      const model = template.clone(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = itemOnSurface(size.x, size.z, surface.w, surface.d);
      if (!scale) return;
      const centre = bounds.getCenter(new THREE.Vector3());
      model.scale.multiplyScalar(scale);
      model.position.set(-centre.x * scale, top - bounds.min.y * scale + 0.002, -centre.z * scale);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.sharedInteriorAsset = true; } });
      h.add(model);
    });
  };
}

//: A flat-screen television: a thin black panel in a bezel on a foot. Drawn, not a model: the
//: library's sets are old cathode-ray boxes.
const tvMaterials = {
  screen: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.18, metalness: 0.4 }),
  bezel: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.5 }),
};
function addTelevision(holder, width) {
  const tv = new THREE.Group();
  const h = width * 0.5625;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width, h, 0.045), tvMaterials.bezel);
  panel.position.y = 0.07 + h / 2;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.03, h - 0.03), tvMaterials.screen);
  screen.position.set(0, 0.07 + h / 2, 0.0235);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(width * 0.35, 0.02, 0.22), tvMaterials.bezel);
  foot.position.y = 0.01;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.03), tvMaterials.bezel);
  neck.position.set(0, 0.05, -0.01);
  tv.add(panel, screen, foot, neck);
  tv.userData = { surface: "furnishing:television", grade: "inferred_from_room_type" };
  holder.add(tv);
  return tv;
}

function furnishLiving(group, entry, layout, seed, floorY) {
  let sofa = null;
  for (const width of [2.1, 1.7]) {
    for (const wall of layout.walls) {
      for (const spot of layout.alongWall(wall, width, 0.95)) {
        if (layout.fits(spot.cx, spot.cz, spot.yaw, width, 0.95)) { sofa = { ...spot, w: width }; break; }
      }
      if (sofa) break;
    }
    if (sofa) break;
  }
  if (!sofa) return false;
  layout.occupy(sofa.cx, sofa.cz, sofa.yaw, sofa.w, 0.95);
  furniturePiece(group, "sofa", seed + 1, sofa.cx, sofa.cz, sofa.yaw, floorY, sofa.w, 0.95, 0.85,
    furnishingMaterials.fabric, { orient: true, grow: 1.05 });
  const nx = sofa.wall.nx, nz = sofa.wall.nz;
  // The television: on the wall the sofa faces, square to it and across a viewing distance.
  let tv = null;
  for (const wall of layout.walls) {
    if (wall.nx * nx + wall.nz * nz > -0.85) continue;
    const spots = layout.alongWall(wall, 1.5, 0.48).map((spot) => {
      const dx = spot.cx - sofa.cx, dz = spot.cz - sofa.cz;
      return { ...spot, distance: dx * nx + dz * nz, lateral: Math.abs(dx * -nz + dz * nx) };
    }).filter((spot) => spot.distance >= 1.9 && spot.distance <= 5.8)
      .sort((p, q) => p.lateral - q.lateral);
    for (const spot of spots) {
      if (spot.lateral > 1.2) break;
      if (layout.fits(spot.cx, spot.cz, spot.yaw, 1.5, 0.48)) { tv = spot; break; }
    }
    if (tv) break;
  }
  if (!tv) {
    // No wall opposite: the set stands free in front of the sofa, its back to the room's middle.
    for (const distance of [2.8, 2.4, 3.2, 2.1]) {
      const cx = sofa.cx + nx * distance, cz = sofa.cz + nz * distance;
      const yaw = Math.atan2(-nx, -nz);
      if (layout.fits(cx, cz, yaw, 1.5, 0.48)) { tv = { cx, cz, yaw }; break; }
    }
  }
  if (tv) {
    layout.occupy(tv.cx, tv.cz, tv.yaw, 1.5, 0.48);
    const stand = furniturePiece(group, "tv_stand", seed + 2, tv.cx, tv.cz, tv.yaw, floorY, 1.5, 0.48, 0.55,
      furnishingMaterials.wood, { maxH: 0.75, onModel: (holder, top) => { set.position.y = top; } });
    const set = addTelevision(stand, 1.25);
    set.position.y = 0.55;
  }
  // The coffee table, in front of the sofa; the rug under it and the sofa's front feet.
  const ctD = 0.6, gap = 0.42;
  const tableX = sofa.cx + nx * (0.95 / 2 + gap + ctD / 2), tableZ = sofa.cz + nz * (0.95 / 2 + gap + ctD / 2);
  if (layout.fits(tableX, tableZ, sofa.yaw, 1.1, ctD)) {
    layout.occupy(tableX, tableZ, sofa.yaw, 1.1, ctD);
    furniturePiece(group, "coffee_table", seed + 3, tableX, tableZ, sofa.yaw, floorY, 1.1, ctD, 0.42,
      furnishingMaterials.wood, { onModel: setOnTop("table_item", seed + 31) });
  }
  // An armchair against a side wall, turned to the coffee table.
  for (const wall of layout.walls) {
    if (Math.abs(wall.nx * nx + wall.nz * nz) > 0.35) continue;
    let done = false;
    for (const spot of layout.alongWall(wall, 0.85, 0.85)) {
      if (Math.hypot(spot.cx - tableX, spot.cz - tableZ) > 2.6) continue;
      const yaw = Math.atan2(tableX - spot.cx, tableZ - spot.cz);
      if (!layout.fits(spot.cx, spot.cz, yaw, 0.85, 0.85)) continue;
      layout.occupy(spot.cx, spot.cz, yaw, 0.85, 0.85);
      furniturePiece(group, "armchair", seed + 5, spot.cx, spot.cz, yaw, floorY, 0.85, 0.85, 0.85,
        furnishingMaterials.fabric, { orient: true, grow: 1.05 });
      done = true;
      break;
    }
    if (done) break;
  }
  addCornerPlant(group, layout, seed + 6, floorY);
  // A picture over the sofa.
  const picture = new THREE.Group();
  picture.position.set(sofa.wall.a[0] + sofa.wall.ux * sofa.t + nx * 0.03, floorY + 1.55,
    sofa.wall.a[1] + sofa.wall.uz * sofa.t + nz * 0.03);
  picture.rotation.y = sofa.yaw;
  // A framed picture, its painting made here: the library's frames were modelled with the art
  // on the side that turned out to face the wall.
  const frameMaterial = furnishingMaterials.wood;
  const pw = 0.9, ph = 0.62;
  for (const [w, h, x, y] of [[pw + 0.08, 0.04, 0, ph / 2 + 0.02], [pw + 0.08, 0.04, 0, -ph / 2 - 0.02],
                              [0.04, ph, -pw / 2 - 0.02, 0], [0.04, ph, pw / 2 + 0.02, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), frameMaterial);
    bar.position.set(x, y, 0.015);
    picture.add(bar);
  }
  const art = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), paintingMaterial(seed + 7));
  art.position.z = 0.012;
  picture.add(art);
  picture.userData = { surface: "furnishing:picture", grade: "inferred_from_room_type" };
  group.add(picture);
  return true;
}
//: Abstract paintings, a few dozen of them: fields of colour, a horizon, blocks, in these colourings.
const PAINTING_PALETTES = [
  ["#8e2a2a", "#1f2d4a", "#e8dcc2", "#c9a24a"], ["#24345a", "#e9e0cc", "#b5552f", "#7a8a9a"],
  ["#7f8f6a", "#efe6d2", "#c06a45", "#4a5a3a"], ["#3b3d40", "#8a8c8f", "#e7e7e2", "#5f6266"],
  ["#c49a2c", "#1f6f6f", "#f1e9d6", "#7a4b2a"], ["#d8a7a0", "#6b3a52", "#f3ebe1", "#a86a6a"],
  ["#4a6a8f", "#22314f", "#eef0f2", "#9bb0c8"], ["#d7c9ad", "#6a4a32", "#2b2622", "#a68b67"],
];
const paintingMaterials = new Map();
function paintingMaterial(seed) {
  const key = Math.floor(random(seed) * 24);
  if (paintingMaterials.has(key)) return paintingMaterials.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = 192; canvas.height = 132;
  const ctx = canvas.getContext("2d");
  const palette = PAINTING_PALETTES[key % PAINTING_PALETTES.length];
  ctx.fillStyle = palette[2]; ctx.fillRect(0, 0, 192, 132);
  const style = key % 3;
  if (style === 0) {
    // A horizon: sky and ground in two bands, a sun.
    ctx.fillStyle = palette[1]; ctx.fillRect(0, 70 + (key % 20), 192, 80);
    ctx.fillStyle = palette[3]; ctx.beginPath(); ctx.arc(40 + key * 5 % 110, 40, 14, 0, Math.PI * 2); ctx.fill();
  } else if (style === 1) {
    // Blocks of colour.
    for (let i = 0; i < 6; i += 1) {
      ctx.fillStyle = palette[i % 4];
      ctx.fillRect(random(key * 13 + i) * 150, random(key * 7 + i) * 100, 30 + random(key + i) * 60, 20 + random(key * 3 + i) * 50);
    }
  } else {
    // Soft vertical fields.
    for (let i = 0; i < 4; i += 1) { ctx.fillStyle = palette[i]; ctx.globalAlpha = 0.85; ctx.fillRect(i * 48, 0, 48, 132); }
    ctx.globalAlpha = 1;
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
  paintingMaterials.set(key, material);
  return material;
}

function addCornerPlant(group, layout, seed, floorY) {
  for (const wall of layout.walls) {
    for (const t of [0.4, wall.len - 0.4]) {
      const cx = wall.a[0] + wall.ux * t + wall.nx * 0.4, cz = wall.a[1] + wall.uz * t + wall.nz * 0.4;
      if (!layout.fits(cx, cz, 0, 0.5, 0.5)) continue;
      layout.occupy(cx, cz, 0, 0.5, 0.5);
      furniturePiece(group, "plant", seed, cx, cz, random(seed) * Math.PI * 2, floorY, 0.5, 0.5, 1.0,
        furnishingMaterials.fabric, { grow: 1.0, maxH: 1.3 });
      return true;
    }
  }
  return false;
}

function furnishBedroom(group, entry, layout, seed, floorY) {
  let bed = null;
  for (const [w, d] of [[1.6, 2.1], [1.4, 2.05], [1.0, 2.0]]) {
    for (const wall of layout.walls) {
      for (const spot of layout.alongWall(wall, w, d)) {
        if (layout.fits(spot.cx, spot.cz, spot.yaw, w, d)) { bed = { ...spot, w, d }; break; }
      }
      if (bed) break;
    }
    if (bed) break;
  }
  if (!bed) return false;
  layout.occupy(bed.cx, bed.cz, bed.yaw, bed.w, bed.d);
  const frame = furniturePiece(group, "bed", seed + 1, bed.cx, bed.cz, bed.yaw, floorY, bed.w, bed.d, 0.6,
    furnishingMaterials.wood, { orient: true, grow: 1.05, maxH: 1.4, onModel: (holder, top) => {
      // A frame is a frame: the mattress and the bedding go on it.
      const mattress = new THREE.Mesh(new THREE.BoxGeometry(bed.w * 0.9, 0.2, bed.d * 0.86), furnishingMaterials.linen);
      mattress.position.set(0, Math.min(top, 0.62) - 0.02, 0.04);
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(bed.w * 0.7, 0.12, 0.34), furnishingMaterials.linen);
      pillow.position.set(0, Math.min(top, 0.62) + 0.13, -bed.d * 0.36);
      holder.add(mattress, pillow);
    } });
  frame.userData.bed = true;
  const { wall, t } = bed;
  for (const side of [-1, 1]) {
    const along = t + side * (bed.w / 2 + 0.3);
    if (along < 0.25 || along > wall.len - 0.25) continue;
    const cx = wall.a[0] + wall.ux * along + wall.nx * 0.26, cz = wall.a[1] + wall.uz * along + wall.nz * 0.26;
    if (!layout.fits(cx, cz, bed.yaw, 0.45, 0.4)) continue;
    layout.occupy(cx, cz, bed.yaw, 0.45, 0.4);
    furniturePiece(group, "nightstand", seed + 2, cx, cz, bed.yaw, floorY, 0.45, 0.4, 0.55,
      furnishingMaterials.wood, { maxH: 0.7 });
  }
  // The chest of drawers on another wall, the one facing the bed first.
  const others = layout.walls.filter((w) => w !== wall)
    .sort((p, q) => (p.nx * wall.nx + p.nz * wall.nz) - (q.nx * wall.nx + q.nz * wall.nz));
  for (const other of others) {
    let done = false;
    for (const spot of layout.alongWall(other, 1.1, 0.5)) {
      if (!layout.fits(spot.cx, spot.cz, spot.yaw, 1.1, 0.5)) continue;
      layout.occupy(spot.cx, spot.cz, spot.yaw, 1.1, 0.5);
      furniturePiece(group, "dresser", seed + 3, spot.cx, spot.cz, spot.yaw, floorY, 1.1, 0.5, 0.9,
        furnishingMaterials.wood, { maxH: 1.3, onModel: setOnTop("shelf_item", seed + 41) });
      done = true;
      break;
    }
    if (done) break;
  }
  return true;
}

function furnishDining(group, entry, layout, seed, floorY, doorsInPlan, pts) {
  const placement = furnishingPlacement(entry, pts, [1.6, 1.0], doorsInPlan)
    || furnishingPlacement(entry, pts, [1.2, 0.8], doorsInPlan);
  if (!placement) return false;
  const { cx, cz, yaw } = placement;
  layout.occupy(cx, cz, yaw, 1.5, 0.9);
  furniturePiece(group, "dining_table", seed + 1, cx, cz, yaw, floorY, 1.5, 0.9, 0.75,
    furnishingMaterials.wood, { grow: 1.0, onModel: setOnTop("table_item", seed + 51) });
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const side of [-1, 1]) {
    for (const lx of [-0.4, 0.4]) {
      const lz = side * 0.78;
      const x = cx + c * lx + s * lz, z = cz - s * lx + c * lz;
      const face = Math.atan2(cx + c * lx - x, cz - s * lx - z);
      if (!layout.fits(x, z, face, 0.48, 0.5)) continue;
      layout.occupy(x, z, face, 0.48, 0.5);
      furniturePiece(group, "dining_chair", seed + 2, x, z, face, floorY, 0.48, 0.5, 0.9,
        furnishingMaterials.wood, { orient: true, maxH: 1.1 });
    }
  }
  return true;
}

function furnishOffice(group, entry, layout, seed, floorY) {
  let desk = null;
  for (const wall of layout.walls) {
    for (const spot of layout.alongWall(wall, 1.3, 0.65)) {
      if (layout.fits(spot.cx, spot.cz, spot.yaw, 1.3, 0.65)) { desk = spot; break; }
    }
    if (desk) break;
  }
  if (!desk) return false;
  layout.occupy(desk.cx, desk.cz, desk.yaw, 1.3, 0.65);
  // A desk is worked at facing the wall: its back is to the wall, the chair on the room side.
  furniturePiece(group, "desk", seed + 1, desk.cx, desk.cz, desk.yaw, floorY, 1.3, 0.65, 0.75,
    furnishingMaterials.wood, { maxH: 0.85 });
  const chairX = desk.cx + desk.wall.nx * 0.68, chairZ = desk.cz + desk.wall.nz * 0.68;
  const chairYaw = Math.atan2(-desk.wall.nx, -desk.wall.nz);
  if (layout.fits(chairX, chairZ, chairYaw, 0.55, 0.55)) {
    layout.occupy(chairX, chairZ, chairYaw, 0.55, 0.55);
    furniturePiece(group, "dining_chair", seed + 2, chairX, chairZ, chairYaw, floorY, 0.55, 0.55, 0.9,
      furnishingMaterials.wood, { orient: true, maxH: 1.1 });
  }
  for (const wall of layout.walls) {
    if (wall === desk.wall) continue;
    let done = false;
    for (const spot of layout.alongWall(wall, 0.9, 0.35)) {
      if (!layout.fits(spot.cx, spot.cz, spot.yaw, 0.9, 0.35)) continue;
      layout.occupy(spot.cx, spot.cz, spot.yaw, 0.9, 0.35);
      furniturePiece(group, "bookshelf", seed + 3, spot.cx, spot.cz, spot.yaw, floorY, 0.9, 0.35, 1.8,
        furnishingMaterials.wood, { maxH: 2.0 });
      done = true;
      break;
    }
    if (done) break;
  }
  return true;
}

//: A fixture that goes against a wall (a kitchen's counters, a laundry's machines, a bathroom's
//: basin) is drawn as before (addRoomFurnishing), backed onto the longest wall that takes it.
function furnishAgainstWall(group, entry, layout, kind, pts, floorY, doorsInPlan, seed) {
  const sizes = { kitchen: [1.8, 0.75], storage: [1.4, 0.75], bathroom: [0.75, 0.65] };
  const [w, d] = sizes[kind];
  for (const wall of layout.walls) {
    for (const spot of layout.alongWall(wall, w, d)) {
      if (!layout.fits(spot.cx, spot.cz, spot.yaw, w, d)) continue;
      layout.occupy(spot.cx, spot.cz, spot.yaw, w, d);
      const before = group.children.length;
      addRoomFurnishing(group, entry, kind, pts, floorY, doorsInPlan, spot);
      const holder = group.children[before];
      // On the counter between the sink and the hob; on the basin unit's top (0.655 m), not above it.
      if (holder && kind === "kitchen") setOnTop("counter_item", seed + 61)(holder, 0.89, { w: 0.42, d: 0.72 });
      if (holder && kind === "bathroom") setOnTop("bath_item", seed + 71)(holder, 0.655, { w: 0.7, d: 0.55 });
      return true;
    }
  }
  return false;
}

//: Lays a room out by its kind; returns where its light hangs, if it has one.
function furnishRoom(group, entry, room, floorY, height, doorsInPlan, index) {
  modelEntry = entry;
  try { return furnishRoomFor(group, entry, room, floorY, height, doorsInPlan, index); }
  finally { modelEntry = null; }
}
function furnishRoomFor(group, entry, room, floorY, height, doorsInPlan, index) {
  const { kind, pts } = room;
  const seed = (Math.abs(Number(entry.way.osm_id) || 0) * 31 + index * 7919) | 0;
  const layout = roomLayout(entry, pts, doorsInPlan);
  if (!layout.walls.length) return null;
  let furnished = false;
  if (kind === "living") furnished = furnishLiving(group, entry, layout, seed, floorY);
  else if (kind === "bedroom") furnished = furnishBedroom(group, entry, layout, seed, floorY);
  else if (kind === "dining") furnished = furnishDining(group, entry, layout, seed, floorY, doorsInPlan, pts);
  else if (kind === "office") furnished = furnishOffice(group, entry, layout, seed, floorY);
  else if (["kitchen", "storage", "bathroom"].includes(kind))
    furnished = furnishAgainstWall(group, entry, layout, kind, pts, floorY, doorsInPlan, seed);
  if (!furnished && ["living", "bedroom", "dining", "office"].includes(kind))
    addRoomFurnishing(group, entry, kind, pts, floorY, doorsInPlan);
  // Carpet is fitted to the room it is in (buildInterior), not laid as a rug.
  if (["balcony", "shaft", "elevator", "outdoor"].includes(kind)) return null;
  return addCeilingLight(group, layout, seed + 21, floorY, height, kind);
}

//: One floor through a house: a wood, chosen per house, under every room and the slab between
//: them. Floors by room kind laid concrete, tile and three woods side by side in one flat, and
//: where a room's plan stopped short of the walls the bare slab showed as a different ground.
//: The rooms differ by their carpets and their paint, not by what the floor is made of.
const HOUSE_FLOORS = [
  { base: "#b48a5e", line: "#8c6a45" }, { base: "#c9a57a", line: "#a3825b" },
  { base: "#8a6040", line: "#664530" }, { base: "#d8c3a0", line: "#b49e7c" },
  { base: "#a0714a", line: "#7a5436" }, { base: "#c2b39a", line: "#9c8d74" },
];
const houseFloorMaterials = new Map();
function houseFloorMaterial(houseSeed) {
  const index = Math.floor(random(houseSeed * 3 + 17) * HOUSE_FLOORS.length) % HOUSE_FLOORS.length;
  if (!houseFloorMaterials.has(index)) {
    const { base, line } = HOUSE_FLOORS[index];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 128, 128);
    // Planks: a row every 16 px, joints staggered, a little grain in each.
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = random(index * 1000 + i) < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)";
      ctx.fillRect(random(index * 7 + i * 3) * 128, random(index * 11 + i * 5) * 128, 6 + random(i) * 18, 1);
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let y = 0; y < 128; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke();
      const x = ((y / 16) % 2) * 64 + 20;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 16); ctx.stroke();
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(0.5, 0.5);
    houseFloorMaterials.set(index, new THREE.MeshStandardMaterial({ map, roughness: 0.7 }));
  }
  return houseFloorMaterials.get(index);
}

function stoopCutRing(door) {
  if (!door.stoopPlan) return null;
  const half = door.stoopPlan.width / 2;
  const start = 0.03;
  const end = door.stoopPlan.steps * STEP_TREAD_M + 0.02;
  return [[-half, start], [half, start], [half, end], [-half, end]]
    .map(([along, inward]) => [door.cx + door.ux * along + door.nx * inward,
                               door.cz + door.uz * along + door.nz * inward]);
}

function floorShapeWithStairCuts(ring, cuts) {
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const cut of cuts) {
    const hole = new THREE.Path();
    hole.moveTo(cut[0][0], -cut[0][1]);
    for (const [x, z] of cut.slice(1)) hole.lineTo(x, -z);
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
}

// A segment clipped to the inside of a footprint (inset by `inset`): the pieces between its
// crossings of the outline whose middles lie inside.
function clipToFootprint(entry, ax, az, bx, bz) {
  const ts = [0, 1];
  const ring = entry.local;
  const sx = bx - ax, sz = bz - az;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [cx, cz] = ring[i];
    const [dx, dz] = ring[i + 1];
    const ex = dx - cx, ez = dz - cz;
    const den = sx * ez - sz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((cx - ax) * ez - (cz - az) * ex) / den;
    const u = ((cx - ax) * sz - (cz - az) * sx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i += 1) {
    const tm = (ts[i] + ts[i + 1]) / 2;
    if (ts[i + 1] - ts[i] < 1e-4) continue;
    if (insideFootprint(entry, ax + sx * tm, az + sz * tm)) {
      out.push([ax + sx * ts[i], az + sz * ts[i], ax + sx * ts[i + 1], az + sz * ts[i + 1]]);
    }
  }
  return out;
}

function wallQuads(segments, bottom, height) {
  const positions = [], uv = [];
  for (const [ax, az, bx, bz] of segments) {
    const y0 = bottom, y1 = bottom + height;
    positions.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    const length = Math.hypot(bx - ax, bz - az);
    uv.push(0, 0, length, 0, length, height, 0, 0, length, height, 0, height);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function clipOutsideZones(segment, zones) {
  const [ax, az, bx, bz] = segment, dx = bx - ax, dz = bz - az;
  const ts = [0, 1];
  for (const ring of zones) for (let i = 0; i < ring.length; i += 1) {
    const c = ring[i], d = ring[(i + 1) % ring.length];
    const ex = d[0] - c[0], ez = d[1] - c[1], den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((c[0] - ax) * ez - (c[1] - az) * ex) / den;
    const u = ((c[0] - ax) * dz - (c[1] - az) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const pieces = [];
  for (let i = 0; i + 1 < ts.length; i += 1) {
    const m = (ts[i] + ts[i + 1]) / 2;
    if (ts[i + 1] - ts[i] > 1e-6
        && !zones.some((ring) => pointInRing(ax + dx * m, az + dz * m, ring)))
      pieces.push([ax + dx * ts[i], az + dz * ts[i], ax + dx * ts[i + 1], az + dz * ts[i + 1]]);
  }
  return pieces;
}

function entryAccessZones(entry, rooms) {
  const zones = [];
  const rect = (a, b, half) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.1) return null;
    const nx = -(b[1] - a[1]) / length * half, nz = (b[0] - a[0]) / length * half;
    const ring = [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz],
      [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]];
    const samples = Math.ceil(length / 0.2);
    for (let t = 0; t <= samples; t += 1) for (const sign of [-1, 0, 1]) {
      if (!insideFootprint(entry, a[0] + (b[0] - a[0]) * t / samples + nx * sign,
        a[1] + (b[1] - a[1]) * t / samples + nz * sign)) return null;
    }
    return ring;
  };
  for (const door of entry.doors || []) {
    if (!door.mesh) continue;
    const depth = door.stoopPlan?.depth || 0;
    const a = [door.cx + door.nx * 0.05, door.cz + door.nz * 0.05];
    const b = [door.cx + door.nx * (depth + 2.8), door.cz + door.nz * (depth + 2.8)];
    const foyer = rect(a, b, 1.4) || rect(a, b, Math.max(0.65, door.width / 2 + 0.12));
    if (foyer) zones.push(foyer);
    const targets = rooms.filter((r) => ["living", "dining", "corridor"].includes(r.kind))
      .map((r) => r.pts.reduce((p, q) => [p[0] + q[0] / r.pts.length, p[1] + q[1] / r.pts.length], [0, 0]))
      .sort((p, q) => Math.hypot(p[0] - b[0], p[1] - b[1]) - Math.hypot(q[0] - b[0], q[1] - b[1]));
    for (const target of targets) {
      const link = rect(b, target, 0.65);
      if (link) { zones.push(link); break; }
    }
  }
  return zones;
}

function entryTunnelConflict(entry) {
  // Never fit a generic home/door to a headhouse arch. Keep its clipped exterior
  // until there is real interior evidence. Cache after the bores have been built.
  if(entry._tunnelConflictCount===tunnelBores.length)return entry._tunnelConflict;
  entry._tunnelConflictCount=tunnelBores.length;entry._tunnelConflict=false;
  for(const bore of tunnelBores)for(const st of bore.stations) {
    if(st.x<entry.minX || st.x>entry.maxX || st.z<entry.minZ || st.z>entry.maxZ)continue;
    if(insideFootprint(entry,st.x,st.z)
        && pointInTunnelVoid(st.x,groundLiftAt(st.x,st.z)+1,st.z)) {
      entry._tunnelConflict=true;return true;
    }
  }
  return false;
}
//: The inside face of a building's outside walls, INTERIOR_WALL_INSET_M in from the facade and
//: drawn from both sides, with each door's opening, head and reveals; added to ``group`` (none
//: when it is null) from ``floorY`` up ``height``. The thresholds at the doors are returned
//: either way, for the floor.
//
// The city's batched facade is drawn one-sided, from the street: from inside a building it is
// not there at all. Rooms behind a facade with nothing standing in for its inside face showed
// the street through every outside wall, while the footprint the walker collides with held:
// walked up to, the wall that could be seen through stopped the walker at its line
// (2026-11-12, an engine restaurant entered in the Marina). Every interior without a shell of
// its own -- the fitted plans and the engine's houses and restaurants alike -- stands in one.
function outsideWallLining(entry, group, floorY, height) {
  const lining = [];
  // The doorway through the wall's depth: its two sides and its head, from the facade to the
  // lining, and its threshold over the floor's edge. The lining stands INTERIOR_WALL_INSET_M
  // inside the facade and the floor stops at it, so every outside door had a hollow either
  // side of it and over it, open to the windows and the gaps along the storey, and a slot in
  // the floor at the step: light showed through all of them, a shaft at every door's edge.
  const reveals = [], thresholds = [];
  const ring = entry.local;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    let nxI = -(bz - az) / len, nzI = (bx - ax) / len;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (!insideFootprint(entry, mx + nxI * 0.3, mz + nzI * 0.3)) { nxI = -nxI; nzI = -nzI; }
    const ox = nxI * INTERIOR_WALL_INSET_M, oz = nzI * INTERIOR_WALL_INSET_M;
    // Its ends mitred to the linings round the corners (liningMitre), as fractions of the edge.
    const [mitreStart, mitreEnd] = liningMitre(entry, i, INTERIOR_WALL_INSET_M).map((m) => m / len);
    let from = mitreStart;
    for (const door of (entry.doors || []).filter((d) => d.edge === i).sort((p, q) => p.t0 - q.t0)) {
      if (door.t0 > from) lining.push([ax + (bx - ax) * from + ox, az + (bz - az) * from + oz, ax + (bx - ax) * door.t0 + ox, az + (bz - az) * door.t0 + oz]);
      // Above the doorway.
      lining.push(null, [ax + (bx - ax) * door.t0 + ox, az + (bz - az) * door.t0 + oz, ax + (bx - ax) * door.t1 + ox, az + (bz - az) * door.t1 + oz]);
      // From a hair outside the facade to a hair inside the lining, so both seams are covered.
      const at = (t, o) => [ax + (bx - ax) * t + nxI * o, az + (bz - az) * t + nzI * o];
      const outer = -0.02, inner = INTERIOR_WALL_INSET_M + 0.02;
      for (const t of [door.t0, door.t1]) reveals.push({ kind: "side", a: at(t, outer), b: at(t, inner) });
      reveals.push({ kind: "head", corners: [at(door.t0, outer), at(door.t1, outer), at(door.t1, inner), at(door.t0, inner)] });
      thresholds.push([at(door.t0, outer - 0.03), at(door.t1, outer - 0.03), at(door.t1, inner), at(door.t0, inner)]);
      from = door.t1;
    }
    const to = 1 - mitreEnd;
    if (from < to) lining.push([ax + (bx - ax) * from + ox, az + (bz - az) * from + oz, ax + (bx - ax) * to + ox, az + (bz - az) * to + oz]);
  }
  if (!group) return { thresholds };
  const full = [], lintels = [];
  for (let k = 0; k < lining.length; k += 1) {
    if (lining[k] === null) { lintels.push(lining[k + 1]); k += 1; } else full.push(lining[k]);
  }
  group.add(new THREE.Mesh(wallQuads(full, floorY, height), plasterMaterial));
  if (lintels.length) group.add(new THREE.Mesh(wallQuads(lintels, floorY + DOOR_HEIGHT_M, Math.max(0.05, height - DOOR_HEIGHT_M)), plasterMaterial));
  if (reveals.length) {
    const position = [];
    const quad = (p, q, r, s) => position.push(...p, ...q, ...r, ...p, ...r, ...s);
    for (const reveal of reveals) {
      if (reveal.kind === "side") {
        const [px, pz] = reveal.a, [qx, qz] = reveal.b;
        quad([px, floorY, pz], [qx, floorY, qz], [qx, floorY + DOOR_HEIGHT_M, qz], [px, floorY + DOOR_HEIGHT_M, pz]);
      } else {
        const y = floorY + DOOR_HEIGHT_M;
        const [p, q, r, s] = reveal.corners.map(([x, z]) => [x, y, z]);
        quad(p, q, r, s);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.computeVertexNormals();
    const revealMesh = new THREE.Mesh(geometry, plasterMaterial);
    revealMesh.userData.surface = "interior_door_reveal";
    group.add(revealMesh);
  }
  return { thresholds };
}
//: Whether a building's door leads into rooms: the same rules buildInterior keeps. The door's
//: hint and Enter both ask this -- they asked only for a fitted plan, so a shop or restaurant
//: (whose rooms are not drawn without its own layout) said "Enter -- go in", opened its door and
//: left the walker on the step, looking in at a wall it could not walk through (2026-11-12).
function entryRoomsPossible(entry) {
  if (!entry || entry.way.parkFacility || entry.way._structure) return false;
  if (entryTunnelConflict(entry)) return false;
  if (entry.generatedInteriorRef && !entry.generatedInteriorFailed) return true;
  if (!HEADSET && commercialInterior(entry)) return false;
  return Boolean(INTERIORS && entry.fit);
}
function buildInterior(entry) {
  if (entry.way.parkFacility || entry.way._structure) return;
  if(entryTunnelConflict(entry))return;
  if (entry.generatedInteriorRef && !entry.generatedInteriorFailed) {
    if (!entry.interior) requestGeneratedInterior(entry);
    return;
  }
  // Without an accepted tenant-specific layout keep a shop's shell, not domestic bedrooms,
  // baths and sofas behind its sign. Residential upper floors require a separate envelope.
  if (!HEADSET && commercialInterior(entry)) return;
  if (entry.interior || !INTERIORS || !entry.fit) return;
  const [ti, rotated, nx, ny, lon, lat, yawDeg, L, W, storeys, storeyM] = entry.fit;
  const plan = INTERIORS.library[ti];
  if (!plan) return;
  const [cxE, cyN] = xy(lon, lat);
  const yaw = (yawDeg * Math.PI) / 180;
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const along = rotated ? plan.w : plan.l, across = rotated ? plan.l : plan.w;
  const sx = L / (nx * along), sy = W / (ny * across);
  // A plan point (u, v), in tile (i, j), to page x, z.
  const place = (u, v, i, j) => {
    const pu = rotated ? v : u, pv = rotated ? -u : v;
    const U = -L / 2 + (i + 0.5) * (L / nx) + pu * sx;
    const V = -W / 2 + (j + 0.5) * (W / ny) + pv * sy;
    const east = cxE + U * cosY - V * sinY;
    const north = cyN + U * sinY + V * cosY;
    return [east, -north];
  };
  const centreX = (entry.minX + entry.maxX) / 2, centreZ = (entry.minZ + entry.maxZ) / 2;
  const floorY = entryFloorY(entry);
  const homeSpec = HOME_RENDER.get(String(entry.way.osm_id));
  const visibleHeight = homeSpec ? homeSpec.base + homeSpec.height - floorY : null;
  // The ceiling at the first storey line, not the roof.
  const storeyStep = entry.homeShell && visibleHeight > 2.3 ? homeStoreyHeight(entry, visibleHeight) : null;
  const height = storeyStep
    ? Math.min(storeyStep, visibleHeight) - 0.06
    : Math.max(2.4, Math.min(storeyM || 3.0, 4.5)) - 0.06;
  const group = new THREE.Group();
  group.name = `interior:${entry.way.osm_id}`;
  const segments = [];
  const colouredSegments = new Map();
  const drawnPartitions = new Set();
  const doorsInPlan = [];
  const interiorDoorSpecs = new Map();
  const roomSpecs = [];
  const theme = Math.abs(Number(entry.way.osm_id) || 0) % INTERIOR_WALL_PALETTES.length;
  const stairCuts = (entry.doors || []).map(stoopCutRing).filter(Boolean);
  const accessRooms = [];
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1)
    for (const [kindIndex, flat] of plan.rooms) {
      const pts = [];
      for (let k = 0; k + 1 < flat.length; k += 2) pts.push(place(flat[k] / 100, flat[k + 1] / 100, i, j));
      accessRooms.push({ kind: INTERIORS.kinds[kindIndex], pts });
    }
  entry.accessZones = entryAccessZones(entry, accessRooms);
  const houseSeed = Math.abs(Number(entry.way.osm_id) || 0);
  const roomKindAt = (x, z) => (accessRooms.find((r) => pointInRing(x, z, r.pts)) || {}).kind || null;
  // Which rooms a line between two rooms divides (sampled a little either side of its middle).
  const sidesOf = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len * 0.3, nz = (bx - ax) / len * 0.3;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    return [roomKindAt(mx + nx, mz + nz), roomKindAt(mx - nx, mz - nz)];
  };
  let roomCounter = 0, lastPaint = -1;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (const [x, y, w] of plan.doors) {
        const [px, pz] = place(x, y, i, j);
        doorsInPlan.push([px, pz, w * Math.max(sx, sy)]);
      }
      for (const [kindIndex, flat] of plan.rooms) {
        const kind = INTERIORS.kinds[kindIndex];
        const pts = [];
        for (let k = 0; k + 1 < flat.length; k += 2) pts.push(place(flat[k] / 100, flat[k + 1] / 100, i, j));
        if (pts.length < 3) continue;
        // The room's floor, where the room lies inside the building.
        const inside = pts.filter(([px, pz]) => insideFootprint(entry, px, pz)).length;
        const edgesInside = pts.every((a, edge) => {
          const b = pts[(edge + 1) % pts.length];
          const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.2));
          for (let t = 1; t < n; t += 1)
            if (!insideFootprint(entry, a[0] + (b[0] - a[0]) * t / n,
              a[1] + (b[1] - a[1]) * t / n)) return false;
          return true;
        });
        if (inside === pts.length && edgesInside) {
          // A room polygon that meets the recessed entry cannot paint across
          // the open stairwell. The common slab below it carries the rest.
          const intersectsStair = stairCuts.some((cut) => cut.some(([px, pz]) => pointInRing(px, pz, pts))
            || pts.some(([px, pz]) => pointInRing(px, pz, cut)));
          if (!intersectsStair) {
            const shape = new THREE.Shape(pts.map(([px, pz]) => new THREE.Vector2(px, -pz)));
            const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), houseFloorMaterial(houseSeed));
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = floorY + 0.01;
            floor.receiveShadow = true;
            group.add(floor);
            // Fitted carpet in some rooms: the room's own shape, the pattern at its own size.
            const carpetSeed = houseSeed * 7 + roomCounter * 31;
            if (random(carpetSeed) < (CARPET_SHARE[kind] || 0)) {
              const style = CARPET_STYLES[Math.floor(random(carpetSeed + 3) * CARPET_STYLES.length) % CARPET_STYLES.length];
              const colour = Math.floor(random(carpetSeed + 9) * CARPET_COLOURS.length) % CARPET_COLOURS.length;
              const carpet = new THREE.Mesh(new THREE.ShapeGeometry(shape), carpetMaterial(style, colour));
              carpet.rotation.x = -Math.PI / 2;
              carpet.position.y = floorY + 0.022;
              carpet.receiveShadow = true;
              carpet.userData = { surface: "furnishing:carpet", carpet: style, colour };
              group.add(carpet);
            }
          }
        }
        // A partly clipped room can still hold a safe furnishing. Placement
        // tests the entire object's bounds against both room and footprint.
        const paint = roomPaint(houseSeed, roomCounter, lastPaint);
        lastPaint = paint;
        roomCounter += 1;
        roomSpecs.push({ kind, pts, paint });
        // Its walls, clipped to the footprint, with the plan's doorways left open.
        for (let k = 0; k < pts.length; k += 1) {
          const [ax, az] = pts[k];
          const [bx, bz] = pts[(k + 1) % pts.length];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.2) continue;
          let pieces = [[0, 1]];
          for (const [dx, dz, dw] of doorsInPlan) {
            const t = ((dx - ax) * (bx - ax) + (dz - az) * (bz - az)) / (len * len);
            const off = Math.abs((dx - ax) * (bz - az) - (dz - az) * (bx - ax)) / len;
            if (off > 0.45 || t < 0 || t > 1) continue;
            const doorKey = `${Math.round(dx * 10)}:${Math.round(dz * 10)}`;
            if (!interiorDoorSpecs.has(doorKey) && insideFootprint(entry, dx, dz)) {
              const sides = sidesOf(ax, az, bx, bz);
              interiorDoorSpecs.set(doorKey, { x: dx, z: dz, width: Math.min(1.25, Math.max(0.75, dw)),
                yaw: -Math.atan2(bz - az, bx - ax),
                // A door into a bedroom is a door, shut; a closet's opening and every other one is
                // a frame with no leaf to block it; between the open rooms not even that.
                kind: sides.includes("storage") ? "doorway"
                  : sides.some((k) => DOORED_ROOMS.has(k)) ? "private"
                  : sides.every((k) => OPEN_PLAN.has(k)) ? "open_plan" : "doorway" });
            }
            const half = Math.max(0.45, dw / 2) / len;
            pieces = pieces.flatMap(([p, q]) => (t - half > q || t + half < p) ? [[p, q]]
              : [[p, Math.max(p, t - half)], [Math.min(q, t + half), q]].filter(([r, s]) => s - r > 1e-3));
          }
          for (const [p, q] of pieces) {
            for (const s of clipToFootprint(entry, ax + (bx - ax) * p, az + (bz - az) * p,
                                            ax + (bx - ax) * q, az + (bz - az) * q)
              .flatMap((s) => clipOutsideZones(s, entry.accessZones))) {
              const mx = (s[0] + s[2]) / 2, mz = (s[1] + s[3]) / 2;
              // Template perimeter walls must not re-cover canonical window holes.
              if (entry.local.slice(0, -1).some((a, edge) => {
                const b = entry.local[edge + 1], dx = b[0] - a[0], dz = b[1] - a[1];
                const len = Math.hypot(dx, dz);
                const t = ((mx - a[0]) * dx + (mz - a[1]) * dz) / (len * len);
                return t >= 0 && t <= 1 && Math.abs((mx - a[0]) * dz - (mz - a[1]) * dx) / len < 0.25;
              })) continue;
              // Open plan: no wall between the kitchen, the living room and the dining room.
              const [sideA, sideB] = sidesOf(s[0], s[1], s[2], s[3]);
              if (OPEN_PLAN.has(sideA) && OPEN_PLAN.has(sideB)) continue;
              segments.push(s);
              const aKey = `${Math.round(s[0] * 100)}:${Math.round(s[1] * 100)}`;
              const bKey = `${Math.round(s[2] * 100)}:${Math.round(s[3] * 100)}`;
              const segmentKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
              if (drawnPartitions.has(segmentKey)) continue;
              drawnPartitions.add(segmentKey);
              if (!colouredSegments.has(paint)) colouredSegments.set(paint, []);
              colouredSegments.get(paint).push(s);
            }
          }
        }
      }
    }
  }
  // The outside walls' inner face in the paint of the room it bounds. The plan's own perimeter
  // walls are not drawn (they would cover the windows), so every room's outside wall was the
  // shell's lining, one colour for the whole house, beside partitions in each room's own: the
  // house's wall colour seen from inside, wherever a room met the outside. Each room paints its
  // stretch of each outside wall instead, a hair inside the lining and from the lining's own
  // panels, so the doors and windows stay open through it.
  // Where no room of the plan runs along a stretch of wall (a footprint the plan does not fill),
  // the room beside it carries its paint along.
  if (entry.homeShell?.liningFaces) {
    const skins = new Map();
    for (const face of entry.homeShell.liningFaces) {
      const off = (v) => (v[0] - face.a[0]) * face.nx + (v[1] - face.a[1]) * face.nz;
      const u = (v) => (v[0] - face.a[0]) * face.ux + (v[1] - face.a[1]) * face.uz;
      const lined = face.inset ?? INTERIOR_WALL_INSET_M;
      const [mitreStart, mitreEnd] = face.edge === null ? [0, 0] : liningMitre(entry, face.edge, lined + ROOM_SKIN_INSET_M * 2);
      const stretches = [];
      for (const { pts, paint } of roomSpecs) {
        for (let k = 0; k < pts.length; k += 1) {
          const p = pts[k], q = pts[(k + 1) % pts.length];
          if (Math.abs(off(p)) > ROOM_SKIN_REACH_M || Math.abs(off(q)) > ROOM_SKIN_REACH_M) continue;
          const u0 = Math.max(Math.min(u(p), u(q)), mitreStart), u1 = Math.min(Math.max(u(p), u(q)), face.length - mitreEnd);
          if (u1 - u0 >= 0.05) stretches.push([u0, u1, paint]);
        }
      }
      if (!stretches.length) {
        // A wall no room's edge runs along -- a recess in the footprint -- in the paint of the
        // room just inside it, or of the nearest.
        const mid = face.length / 2, inward = 0.5;
        const x = face.a[0] + face.ux * mid + face.nx * inward, z = face.a[1] + face.uz * mid + face.nz * inward;
        let nearest = roomSpecs.find(({ pts }) => pointInRing(x, z, pts)), best = Infinity;
        if (!nearest) for (const room of roomSpecs) {
          const cx = room.pts.reduce((t, v) => t + v[0], 0) / room.pts.length, cz = room.pts.reduce((t, v) => t + v[1], 0) / room.pts.length;
          const d = Math.hypot(cx - x, cz - z);
          if (d < best) { best = d; nearest = room; }
        }
        if (!nearest) continue;
        stretches.push([mitreStart, face.length - mitreEnd, nearest.paint]);
      }
      stretches.sort((p, q) => p[0] - q[0]);
      // End to end along the wall: each stretch to where the next begins, the first from the
      // wall's start and the last to its end.
      stretches[0][0] = mitreStart;
      for (let i = 0; i + 1 < stretches.length; i += 1) stretches[i][1] = Math.max(stretches[i][1], stretches[i + 1][0]);
      stretches[stretches.length - 1][1] = Math.max(stretches[stretches.length - 1][1], face.length - mitreEnd);
      stretches.forEach(([u0, u1, paint], i) => {
        const inset = lined + ROOM_SKIN_INSET_M * (1 + (i % 2));
        const panels = face.panels.map(([x0, y0, x1, y1]) => [Math.max(x0, u0), Math.max(y0, floorY), Math.min(x1, u1), Math.min(y1, floorY + height + 0.06)])
          .filter(([x0, y0, x1, y1]) => x1 > x0 + 1e-3 && y1 > y0 + 1e-3);
        if (!panels.length) return;
        if (!skins.has(paint)) skins.set(paint, []);
        skins.get(paint).push(homeWallGeometry(face.a, face.ux, face.uz, panels, face.nx * inset, face.nz * inset));
      });
    }
    for (const [paint, pieces] of skins) {
      const geometry = mergeParts(pieces);
      if (!geometry) continue;
      const skin = new THREE.Mesh(geometry, paintMaterial(paint));
      skin.receiveShadow = true;
      skin.userData.surface = "interior_wall_paint";
      group.add(skin);
    }
  }
  // The outside walls' inner face, inset, with the building's own doors open through it; and
  // the threshold at each door. (A house drawn as its own shell has no lining, and its shell
  // has its own reveals.)
  const { thresholds } = outsideWallLining(entry, entry.homeShell ? null : group, floorY, height);
  const ring = entry.local;
  if (thresholds.length) {
    const position = [];
    for (const corners of thresholds) {
      const [p, q, r, s] = corners.map(([x, z]) => [x, floorY + 0.004, z]);
      position.push(...p, ...q, ...r, ...p, ...r, ...s);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.computeVertexNormals();
    const sill = new THREE.Mesh(geometry, houseFloorMaterial(houseSeed));
    sill.userData.surface = "interior_threshold";
    group.add(sill);
  }
  for (const [paint, roomSegments] of colouredSegments) {
    const partitions = new THREE.Mesh(wallQuads(roomSegments, floorY, height), paintMaterial(paint));
    partitions.castShadow = true;
    group.add(partitions);
  }
  const roomDoors = [];
  for (const spec of interiorDoorSpecs.values()) {
    // Between the open rooms there is no door at all: they are one space.
    if (spec.kind === "open_plan") continue;
    const frame = new THREE.Group();
    frame.position.set(spec.x, floorY, spec.z);
    frame.rotation.y = spec.yaw;
    for (const x of [-spec.width / 2, spec.width / 2]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.055, DOOR_HEIGHT_M, 0.09),
        furnishingMaterials.wood);
      jamb.position.set(x, DOOR_HEIGHT_M / 2, 0);
      frame.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(spec.width, 0.06, 0.09), furnishingMaterials.wood);
    lintel.position.y = DOOR_HEIGHT_M;
    frame.add(lintel);
    frame.userData = { surface: "interior_door", grade: "fitted_plan_not_measured" };
    group.add(frame);
    if (spec.kind !== "private") continue;
    const leaf = new THREE.Group();
    leaf.position.x = -spec.width / 2;
    // A bedroom's door is shut until it is opened (Enter, next to it).
    leaf.rotation.y = 0;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.9, DOOR_HEIGHT_M - 0.07, 0.045),
      doorMaterial);
    panel.position.set(spec.width * 0.45, DOOR_HEIGHT_M / 2, 0);
    leaf.add(panel);
    frame.add(leaf);
    roomDoors.push({ x: spec.x, z: spec.z, leaf, open: false, angle: 0 });
  }
  // Share static wall/floor batches before repeating storeys; furniture and
  // door groups remain independent for asset replacement and leaf details.
  batchHomeShell(group);
  const lights = [];
  roomSpecs.forEach((room, index) => {
    room.light = furnishRoom(group, entry, room, floorY, height, doorsInPlan, index);
    if (room.light) lights.push(room.light);
  });
  // Floor and ceiling over the whole footprint.
  // The floors and ceilings stop at the lining, INTERIOR_WALL_INSET_M inside the outer wall:
  // run out to the footprint, their edges lay in the wall's own plane and showed through it
  // from the street as a dashed white line along every storey.
  const slabRing = insetRing(entry, ring.slice(0, -1), INTERIOR_WALL_INSET_M);
  const outline = floorShapeWithStairCuts(slabRing, stairCuts);
  const slab = new THREE.Mesh(new THREE.ShapeGeometry(outline), houseFloorMaterial(houseSeed));
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = floorY;
  slab.receiveShadow = true;
  slab.userData.surface = "interior_base_floor";
  const ceilingOutline = new THREE.Shape(slabRing.map(([px, pz]) => new THREE.Vector2(px, -pz)));
  const ceiling = new THREE.Mesh(new THREE.ShapeGeometry(ceilingOutline), ceilingMaterial);
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = floorY + height;
  ceiling.userData.surface = "interior_ceiling";
  group.add(slab, ceiling);
  if (storeyStep) {
    const groundObjects = [...group.children];
    // A floor on each storey line with a storey's room above it; the top one runs to the roof.
    for (let level = 1; level * storeyStep + 2.3 <= visibleHeight + 1e-6; level += 1) {
      const upperHeight = Math.min(storeyStep, visibleHeight - level * storeyStep) - 0.06;
      const stretch = upperHeight / height;
      const upper = new THREE.Group();
      upper.position.y = level * storeyStep;
      upper.userData = { surface: "interior_storey", level, grade: "repeated_fitted_plan_not_measured" };
      for (const original of groundObjects) {
        if (original === slab) continue;
        const copy = original.clone(true);
        copy.traverse((o) => { if (o.isMesh) o.userData.sharedInteriorAsset = true; });
        // Its ceiling and lights at its own storey line; its walls the storey's height.
        if (original === ceiling || original.userData.surface === "furnishing:ceiling_light")
          copy.position.y = original.position.y + upperHeight - height;
        else if (original.isMesh) { copy.scale.y = stretch; copy.position.y = floorY * (1 - stretch); }
        upper.add(copy);
      }
      // External entrance recesses belong only to the ground floor.
      const upperFloor = new THREE.Mesh(new THREE.ShapeGeometry(ceilingOutline), houseFloorMaterial(houseSeed));
      upperFloor.rotation.x = -Math.PI / 2;
      upperFloor.position.y = floorY;
      upperFloor.receiveShadow = true;
      upper.add(upperFloor);
      group.add(upper);
    }
  }
  group.traverse((o) => { if (o.isMesh) o.renderOrder = entry.homeShell ? 0 : INTERIOR_ORDER; });
  group.userData = { surface: "interior", grade: "inferred", plan: plan.id, source: plan.src,
    attribution: (INTERIORS.sources[plan.src] || {}).attribution, storeys, stretch: [entry.fit[11], entry.fit[12]] };
  interiorGroup.add(group);
  const source = INTERIORS.sources[plan.src] || {};
  const floorSurface = (x, z) => (insideFootprint(entry, x, z) ? floorY : null);
  standingSurfaces.add(floorSurface);
  entry.interior = { group, segments, floorSurface, rooms: roomSpecs, lights, roomDoors, floorY, height,
    plan: `${plan.src === "resplan" ? "ResPlan dwelling" : "Swiss Dwellings building"} ${plan.id}${nx * ny > 1 ? ` ×${nx * ny}` : ""} (${source.license || ""})` };
  interiorsBuilt.add(entry);
}

function removeInterior(entry) {
  if (!entry.interior) return;
  interiorGroup.remove(entry.interior.group);
  standingSurfaces.delete(entry.interior.floorSurface);
  entry.interior.group.traverse((o) => { if (o.geometry && !o.userData.sharedInteriorAsset) o.geometry.dispose(); });
  entry.interior = null;
  interiorsBuilt.delete(entry);
}
window.kerbsideInteriors = () => ({ loaded: Boolean(INTERIORS), built: [...interiorsBuilt].map((e) => e.way.osm_id),
  summary: INTERIORS && INTERIORS.summary, shells: [...homeShells].map((e) => ({
    id: e.way.osm_id, windows: e.homeShell.group.userData.windows,
    drawMeshes: e.homeShell.group.children.length, doors: (e.doors || []).map((d) => ({
      source: DOOR_SOURCE[d.source], rendered: Boolean(d.mesh), recessed: Boolean(d.stoopPlan),
      steps: d.stoopPlan?.steps, landingDepth: d.stoopPlan?.landingDepth })) })) });
requestInteriors();

// An opt-in development inspector exercises the same entrance and swept
// collision path as normal walking. It never opens a wall or substitutes data.
if (new URLSearchParams(location.search).get("inspect") === "interiors") {
  const inspector = document.createElement("details");
  inspector.id = "interior-inspector";
  inspector.open = true;
  inspector.style.cssText = "position:fixed;right:8px;top:64px;z-index:30;background:#fff;"
    + "color:#222;padding:8px;max-width:300px;max-height:70vh;overflow:auto;font:12px system-ui";
  inspector.innerHTML = '<summary>Interior inspection</summary><button id="inspect-entrance">Visit nearby house entrance</button>'
    + '<button id="inspect-door">Toggle entrance door</button><button id="inspect-step">Walk forward 0.25 m</button>'
    + '<button id="inspect-back">Look behind</button>'
    + '<button id="inspect-room">Inspect next furnished room</button>'
    + '<pre id="inspect-state" style="white-space:pre-wrap"></pre>';
  document.body.appendChild(inspector);
  for (const button of inspector.querySelectorAll("button"))
    button.style.cssText = "display:block;background:#f4f1e8;color:#222;margin:4px 0;border:1px solid #aaa";
  document.getElementById("inspect-entrance").onclick = () => {
    const candidates = doorsNear(avatar.position.x, avatar.position.z, 500)
      .filter((d) => HOME_RENDER.has(String(d.entry.way.osm_id)))
      .filter((d) => !buildingAt(d.cx - d.nx * 1.5, d.cz - d.nz * 1.5));
    const residential = candidates.filter((d) => d.entry.way.archetype === "residential"
      || d.entry.way.address || /RESIDENTIAL|HOUSE|DWELLING/i.test(d.entry.way.land_use || ""));
    const choices = residential.length ? residential : candidates;
    const d = choices.find((d) => d.source !== 2) || choices[0];
    if (!d) return;
    state.yaw = Math.atan2(-d.nx, -d.nz); state.look = 0;
    goTo(new THREE.Vector3(d.cx - d.nx * 1.5, 0, d.cz - d.nz * 1.5), { travel: true, zoom: true });
    setFirstPerson(false);
  };
  document.getElementById("inspect-door").onclick = () => { const d = nearestDoor(); if (d) toggleDoor(d); };
  document.getElementById("inspect-step").onclick = () => {
    moveWalker(-Math.sin(state.yaw) * 0.25, -Math.cos(state.yaw) * 0.25);
    avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(avatar.position.x, avatar.position.z);
    state.target.copy(avatar.position); placeCamera();
  };
  document.getElementById("inspect-back").onclick = () => { state.yaw += Math.PI; placeCamera(); };
  let inspectedRoom = 0;
  document.getElementById("inspect-room").onclick = () => {
    const b = buildingAt(avatar.position.x, avatar.position.z);
    const entry = b && footprintById.get(String(b.osm_id));
    const furnishings = entry?.interior?.group.children
      .filter((o) => o.userData.surface?.startsWith("furnishing:")) || [];
    for (let n = 0; n < furnishings.length; n += 1) {
      const item = furnishings[inspectedRoom++ % furnishings.length];
      const { x, z } = item.position;
      const ring = item.userData.roomRing;
      if (!ring) continue;
      for (let angle = 0; angle < 8; angle += 1) {
        const px = x + Math.cos(angle * Math.PI / 4) * 1.4;
        const pz = z + Math.sin(angle * Math.PI / 4) * 1.4;
        if (!pointInRing(px, pz, ring) || !insideFootprint(entry, px, pz)
            || insideEntranceRecess(entry, px, pz)) continue;
        if (entry.interior.segments.some(([ax, az, bx, bz]) =>
          distanceToSegmentSquared(px, pz, ax, az, bx, bz) < 0.35 ** 2)) continue;
        avatar.position.set(px, AVATAR_STAND_Y + walkerGroundAt(px, pz), pz);
        state.target.copy(avatar.position);
        state.yaw = Math.atan2(px - x, pz - z); state.look = -0.12;
        setFirstPerson(true);
        return;
      }
    }
  };
  setInterval(() => {
    const b = buildingAt(avatar.position.x, avatar.position.z);
    const e = b && footprintById.get(String(b.osm_id));
    const d = nearestDoor();
    const report = { loaded: Boolean(INTERIORS), firstPerson: state.firstPerson,
      building: b?.osm_id, door: d && { building: d.entry.way.osm_id, source: DOOR_SOURCE[d.source],
        open: d.open, steps: d.stoopPlan?.steps || 0, landing: d.stoopPlan?.landingDepth || 0 },
      shells: homeShells.size, windows: [...homeShells].reduce((n, h) => n + h.homeShell.group.userData.windows.length, 0),
      rooms: e?.interior?.group.userData, furniture: e?.interior?.group.children
        .filter((o) => o.userData.surface?.startsWith("furnishing:")).length,
      ground: walkerGroundAt(avatar.position.x, avatar.position.z),
      streetFurniture: document.getElementById("furniturenote")?.userData };
    if (d) report.entranceDepth = (avatar.position.x - d.cx) * d.nx + (avatar.position.z - d.cz) * d.nz;
    document.getElementById("inspect-state").textContent = JSON.stringify(report, null, 2);
  }, 500);
}

let previous = performance.now();
//: The arrows turn the walker round a curve whose radius grows with its speed: this many metres
//: of radius for each metre a second -- tight at a stroll, wider at a run -- and held between
//: WALK_TURN_RADIUS_MIN_M and WALK_TURN_RADIUS_MAX_M. Turned at one rate (1.8 radians a second)
//: at every speed, the walk's own speed -- 5.4 m/s on foot, 9 m/s and more orbiting -- swept
//: curves of 2 to 5 m: wide, and the wider the faster (2026-11-12).
const WALK_TURN_RADIUS_S = 0.45;
const WALK_TURN_RADIUS_MIN_M = 0.5;
const WALK_TURN_RADIUS_MAX_M = 3.0;
//: The fastest a walker's facing turns (radians a second). Where the curve at its speed would
//: turn it faster, it slows on the curve instead: the radius holds, as a runner's does.
const WALK_TURN_RATE_MAX = 2.2;
//: Left or Right alone walks round the curve at WALK_SIDE_PACE of the walking pace, as a person
//: turns -- never a spin on the spot, which looked like a turntable (2026-11-12).
const WALK_SIDE_PACE = 0.7;
//: Down turns the walker round at this rate (radians a second): about two thirds of a second,
//: two steps, at WALK_BACK_PACE of the pace -- a pivot, not a wide loop -- then walks back.
const WALK_BACK_TURN_RATE = 5;
const WALK_BACK_PACE = 0.3;
//: How quickly the view swings round behind a walker on the move (a share a second), and the
//: fastest it swings (radians a second): it follows the turn, behind it, rather than wheeling
//: round with the body. Seen from the walker's eyes it follows closer (the way ahead has to be
//: in view), and as fast as the body can turn, so it never falls further and further behind.
const WALK_VIEW_FOLLOW = 0.9;
const WALK_VIEW_MAX_RATE = 1.4;
const WALK_VIEW_FOLLOW_EYES = 6;
const WALK_VIEW_MAX_RATE_EYES = 3;
let walkTurnBack = null;
//: The curve a walker at ``speed`` (metres a second) turns on: { rate } in radians a second, and
//: { pace }, the share of the speed it keeps on it (less than all only where WALK_TURN_RATE_MAX
//: holds it back).
function walkTurn(speed) {
  const v = Math.max(0.1, speed);
  const radius = Math.min(WALK_TURN_RADIUS_MAX_M, Math.max(WALK_TURN_RADIUS_MIN_M, WALK_TURN_RADIUS_S * v));
  const rate = v / radius;
  return rate > WALK_TURN_RATE_MAX ? { rate: WALK_TURN_RATE_MAX, pace: WALK_TURN_RATE_MAX * radius / v } : { rate, pace: 1 };
}
//: One frame of steering from the arrows held (``held``) at ``speed`` (metres a second): the
//: walker's facing turned, and { way, pace } -- the unit way to walk this frame (a Vector3) and
//: the share of the walking speed -- or null when it stands.
function walkSteer(dt, speed = 1.4) {
  const turn = (held.has("ArrowRight") ? 1 : 0) - (held.has("ArrowLeft") ? 1 : 0);
  const up = held.has("ArrowUp"), down = held.has("ArrowDown");
  // The way the walker faces (rotation.y is atan2 of the way it walks), and right of it as the
  // walk has always had it.
  let h = avatar.rotation.y;
  const dirOf = (a) => [Math.sin(a), Math.cos(a)];
  const turnBy = (a, by) => {
    const [dx, dz] = dirOf(a), rx = dz, rz = -dx, c = Math.cos(by), s = Math.sin(by);
    return Math.atan2(dx * c + rx * s, dz * c + rz * s);
  };
  // Down: round to face back the way you came (the shorter way, or with the arrow held), then on.
  if (down && !up) {
    if (walkTurnBack === null) walkTurnBack = h + Math.PI;
  } else walkTurnBack = null;
  let walking = up, pace = 1;
  if (walkTurnBack !== null) {
    let gap = Math.atan2(Math.sin(walkTurnBack - h), Math.cos(walkTurnBack - h));
    const step = WALK_BACK_TURN_RATE * dt;
    if (Math.abs(gap) <= step) { h = walkTurnBack; walking = true; }
    else {
      // Which way round: the arrow held, or the right.
      const right = turnBy(h, step), left = turnBy(h, -step);
      const towards = (a) => Math.abs(Math.atan2(Math.sin(walkTurnBack - a), Math.cos(walkTurnBack - a)));
      h = turn > 0 ? right : turn < 0 ? left : Math.abs(gap) > Math.PI - 1e-3 ? right : (towards(right) < towards(left) ? right : left);
      walking = true;
      pace = WALK_BACK_PACE;
    }
  } else if (turn) {
    // Up with Left or Right, or Left or Right alone (on round at WALK_SIDE_PACE): round the
    // curve the speed sets (walkTurn).
    const share = up ? 1 : WALK_SIDE_PACE, curve = walkTurn(speed * share);
    h = turnBy(h, turn * curve.rate * dt);
    walking = true;
    pace = share * curve.pace;
  }
  avatar.rotation.y = h;
  if (!walking) {
    animateAvatar(0, new THREE.Vector3(), false);
    return null;
  }
  // The view comes round behind, easing after the turn and no faster than its own most (unless
  // it is being dragged; seen from the walker's eyes, forward is always the way the head goes).
  const [dx, dz] = dirOf(h);
  if (state.firstPerson || !dragging) {
    const eyes = state.firstPerson;
    const gap = Math.atan2(Math.sin(h + Math.PI - state.yaw), Math.cos(h + Math.PI - state.yaw));
    const most = (eyes ? WALK_VIEW_MAX_RATE_EYES : WALK_VIEW_MAX_RATE) * dt;
    state.yaw += Math.max(-most, Math.min(most, gap * Math.min(1, dt * (eyes ? WALK_VIEW_FOLLOW_EYES : WALK_VIEW_FOLLOW))));
  }
  return { way: new THREE.Vector3(dx, 0, dz), pace };
}
function animateAvatar(distance, direction, moving) {
  avatar.userData.lastMoving=moving;
  if (moving && direction.lengthSq()) {
    avatar.rotation.y = Math.atan2(direction.x, direction.z);
    avatar.userData.lastMove = [direction.x, direction.z, performance.now()];
    avatar.userData.walkPhase += distance * 4.8;
  }
  const swing = moving ? Math.sin(avatar.userData.walkPhase) : 0;
  // Keep the contact plane on the sampled surface.  Limbs and the imported walk
  // clip carry the gait; lifting the whole rig made both feet hover each step.
  // (In the air: the city's jump, avatar.userData.lift.)
  avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(avatar.position.x, avatar.position.z) + (avatar.userData.lift || 0);
  const climbing=moving&&avatar.userData.onStairs;
  avatar.userData.leftLeg.rotation.x = swing * (climbing?.85:.58);
  avatar.userData.rightLeg.rotation.x = -swing * (climbing?.85:.58);
  avatar.userData.leftArm.rotation.x = -swing * 0.48;
  avatar.userData.rightArm.rotation.x = swing * 0.48;
  avatar.userData.leftArm.rotation.z = 0.10;
  avatar.userData.rightArm.rotation.z = -0.10;
  // Up a hill or a flight of steps the walker walks, and its stride slows with the pace.
  const pace = moving ? (avatar.userData.pace ?? 1) : 1;
  setAvatarAction(moving ? ((climbing || pace < 0.7) && avatarActions.Walk ? "Walk" : "Run") : "Idle");
  if (avatarActiveAction) avatarActiveAction.timeScale = moving ? Math.max(0.5, Math.min(1.15, pace)) : 1;
}
function updateAvatarMixer(dt) {
  if (avatarMixer) {
    avatarMixer.update(dt);
    const model=avatar.getObjectByName("imported-realistic-demo-character");
    if(model)model.rotation.x=avatar.userData.lastMoving
      ? Math.max(-.12,Math.min(.12,-(avatar.userData.grade||0)*.18)) : 0;
  }
  // Over the clip: how the city's walker holds, lifts, swings and throws (view.mjs).
  avatar.userData.afterPose?.(dt);
}
function firstBuildingCollision(fromX, fromZ, toX, toZ) {
  // Sweep the whole movement segment so zoom-scaled steps cannot tunnel through a building.
  const dx = toX - fromX, dz = toZ - fromZ;
  if (dx * dx + dz * dz < 1e-12) return null;
  const seen = new Set();
  let first = null;
  const minX = Math.floor(Math.min(fromX, toX) / FOOTPRINT_CELL) - 1;
  const maxX = Math.floor(Math.max(fromX, toX) / FOOTPRINT_CELL) + 1;
  const minZ = Math.floor(Math.min(fromZ, toZ) / FOOTPRINT_CELL) - 1;
  const maxZ = Math.floor(Math.max(fromZ, toZ) / FOOTPRINT_CELL) + 1;
  for (let ix = minX; ix <= maxX; ix += 1) {
    for (let iz = minZ; iz <= maxZ; iz += 1) {
      for (const entry of footprintGrid.get(`${ix}:${iz}`) || []) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (insideFootprint(entry, fromX, fromZ)) continue;
        if (Math.max(fromX, toX) < entry.minX || Math.min(fromX, toX) > entry.maxX
            || Math.max(fromZ, toZ) < entry.minZ || Math.min(fromZ, toZ) > entry.maxZ) continue;
        const ring = entry.local;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
          const [ax, az] = ring[j], [bx, bz] = ring[i];
          const ex = bx - ax, ez = bz - az;
          const denominator = dx * ez - dz * ex;
          if (Math.abs(denominator) < 1e-9) continue;
          const qx = ax - fromX, qz = az - fromZ;
          const along = (qx * ez - qz * ex) / denominator;
          const onEdge = (qx * dz - qz * dx) / denominator;
          if (along < 0 || along > 1 || onEdge < 0 || onEdge > 1) continue;
          if(typeof stairRecessClear === "function" && stairRecessClear(entry,fromX+dx*along,fromZ+dz*along))continue;
          if (first === null || along < first) first = along;
        }
      }
    }
  }
  return first;
}
//: Where you are (navigator.geolocation), when you are in this region: the walker stands there and
//: walks and turns with you. Your position stays in this browser; it leaves it only as the start
//: of directions you ask for. Off in settings.
const GPS_KEY = "kerbside-gps";
const GPS_JUMP_M = 60;
const GPS_WALK_SPEED_MS = 4;
const gps = { fix: null, target: null, heading: null, watch: null, follow: true, placed: false,
  enabled: (() => { try { return localStorage.getItem(GPS_KEY) !== "off"; } catch { return true; } })() };
function startGps() {
  if (ATTACH || gps.watch !== null || !gps.enabled || !navigator.geolocation) return;
  gps.watch = navigator.geolocation.watchPosition((position) => {
    const { longitude: lon, latitude: lat, heading } = position.coords;
    gps.fix = { lon, lat, accuracy: position.coords.accuracy, at: position.timestamp };
    // Anywhere the map has a region, not only the one this page was opened on: where you are is
    // where you start (unless you have set a spawn point, which goTo has already put you at).
    const b = DATA.bbox, region = typeof regionAt === "function" ? regionAt(lon, lat) : null;
    if (!region && (lon < b.west || lon > b.east || lat < b.south || lat > b.north)) { gps.target = null; return; }
    const [x, y] = xy(lon, lat);
    // City mode is played in its own area: a location outside it does not take the walker out.
    if (typeof cityLock !== "undefined" && cityLock && !cityAreaHolds(x, -y)) { gps.target = null; return; }
    const first = !gps.placed;
    if (first && GPS_LEASH.on && typeof tileOwnGround === "function" && !tileOwnGround(lon, lat)) window.kerbsideOpenFullRegionAt?.(lon, lat);
    // Indoors (at home), or before the houses round you are in: the street outside, or the spot.
    const exterior = walkerExteriorAt(x, -y) || (first ? { x, z: -y } : null);
    if (!exterior) return;
    gps.target = new THREE.Vector3(exterior.x, 0, exterior.z);
    gps.heading = Number.isFinite(heading) ? heading : null;
    if (first && GPS_LEASH.on) {
      // The first fix: the walker stands where you are and the view comes to it -- unless you
      // have already walked it somewhere yourself.
      gps.placed = true;
      avatar.position.set(gps.target.x, AVATAR_STAND_Y + walkerGroundAt(gps.target.x, gps.target.z,
        groundLiftAt(gps.target.x,gps.target.z)), gps.target.z);
      state.indoors = false;
      state.target.copy(avatar.position);
      placeCamera();
    }
  }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
//: R: back to where you are -- the walker to your device's location, following it again.
function returnToGps() {
  GPS_LEASH.on = true;
  if (!gps.target) return false;
  const exterior = walkerExteriorAt(gps.target.x, gps.target.z);
  if (!exterior) return false;
  gps.target.set(exterior.x, 0, exterior.z);
  avatar.position.set(gps.target.x, AVATAR_STAND_Y + walkerGroundAt(gps.target.x, gps.target.z,
    groundLiftAt(gps.target.x,gps.target.z)), gps.target.z);
  state.indoors = false;
  gps.follow = true;
  state.target.copy(avatar.position);
  placeCamera();
  return true;
}
addEventListener("keydown", (e) => {
  if (ATTACH || e.repeat || e.metaKey || e.ctrlKey || e.altKey || (e.key !== "r" && e.key !== "R")) return;
  if (typingIn(e.target) || typingIn(document.activeElement)) return;
  if (cityGame()) return;   // the game keeps you where you are
  e.preventDefault();
  // A sky set to another hour (the compass box) goes back to live San Francisco time first.
  if (sunDial.date || environmentController?.snapshot()?.live === false) {
    resetSkyToLive();
    if (!gps.enabled) { pinSay("Sky back on live San Francisco time"); return; }
  }
  if (returnToGps()) pinSay("Back where you are");
  else pinSay(gps.enabled ? "Waiting for your location" : "Turn on “Show me at my location” in settings");
});
function stopGps() {
  if (gps.watch !== null) navigator.geolocation.clearWatch(gps.watch);
  gps.watch = null; gps.target = null;
}
//: One frame's walk toward where you are; true when the walker moved.
function followGps(dt) {
  if (!gps.target || held.size || !GPS_LEASH.on) return false;
  // The footprint window may have loaded after the original fix was recorded.
  const exterior = walkerExteriorAt(gps.target.x, gps.target.z);
  if (!exterior) return false;
  gps.target.set(exterior.x, 0, exterior.z);
  const dx = gps.target.x - avatar.position.x, dz = gps.target.z - avatar.position.z, d = Math.hypot(dx, dz);
  if (d > GPS_JUMP_M) {
    if (typeof cityLock !== "undefined" && cityLock && !cityAreaHolds(gps.target.x, gps.target.z)) return false;
    avatar.position.set(gps.target.x, AVATAR_STAND_Y + walkerGroundAt(gps.target.x, gps.target.z,
      groundLiftAt(gps.target.x,gps.target.z)), gps.target.z);
    return true;
  }
  if (d < 0.4) {
    if (gps.heading !== null) avatar.rotation.y = Math.PI - gps.heading * Math.PI / 180;
    return false;
  }
  // Faster the further behind, so a walker never trails a moving phone for long.
  const step = Math.min(d, Math.max(GPS_WALK_SPEED_MS, d) * dt);
  const move = new THREE.Vector3(dx / d * step, 0, dz / d * step);
  // GPS may drift into a house; its visual walker obeys the same walls as manual movement.
  const moved = moveWalker(move.x, move.z);
  avatar.position.y = AVATAR_STAND_Y + walkerGroundAt(avatar.position.x, avatar.position.z);
  avatar.userData.lastMove = [move.x, move.z, performance.now()];
  avatar.userData.pace = 1;
  animateAvatar(moved, move, moved > 0);
  if (gps.follow) { state.target.copy(avatar.position); placeCamera(); }
  return true;
}
//: The pace of walking on a slope, relative to the level: quicker downhill the steeper it is --
//: half as fast again at DOWNHILL_FULL_GRADE and steeper -- and slower uphill the steeper it is,
//: in proportion, to UPHILL_PACE_MIN at UPHILL_FULL_GRADE (a San Francisco hill: 30%, 17
//: degrees) and no slower past it. Tobler's hiking function had a ten per cent street at a
//: walker's 59% and Fillmore at 35%: a crawl for a map walked at a jog.
const DOWNHILL_PACE_MAX = 1.5;
const DOWNHILL_FULL_GRADE = 0.35;
const UPHILL_PACE_MIN = 0.6;
const UPHILL_FULL_GRADE = 0.3;
function toblerPace(grade) {
  // Past MAX_DROP_GRADE down, and MAX_WALK_GRADE up, the ground is not walked at all (walkPace).
  if (grade < 0) return 1 + (DOWNHILL_PACE_MAX - 1) * Math.min(1, -grade / DOWNHILL_FULL_GRADE);
  return 1 - (1 - UPHILL_PACE_MIN) * Math.min(1, grade / UPHILL_FULL_GRADE);
}
//: Steeper than this, plain ground is a cliff or a wall: not walked up, or off.
const MAX_WALK_GRADE = 0.85;
const MAX_DROP_GRADE = 1.2;
//: A flight of steps is climbed at this share of the walking pace, up or down.
const STAIR_PACE = 0.55;
const PACE_PROBE_M = 0.6;
//: On a hill the walker goes at its own pace (SLOPE_BASE_SPEED, the first-person walk) times the
//: slope's, however far out the view is zoomed: zoom changes how fast the map is crossed, not how
//: fast a body climbs. It was the whole speed that was held to 2.2 m/s on any slope past 8%,
//: after the slope's factor, so up and down every hill were the same slow walk.
const SLOPE_BASE_SPEED = 5.36;
function walkSurfaceSpeed(base,pace){
  if(pace.stairs)return Math.min(1.35,base*pace.factor);
  if(Math.abs(pace.grade||0)>.08)return Math.min(base,SLOPE_BASE_SPEED)*pace.factor;
  return base*pace.factor;
}
//: How the ground ahead lets the walker go: the pace (``factor``) and, where the way ahead is
//: a cliff of plain ground, the move turned along the slope instead (``move`` is changed in
//: place, to nothing where there is no way along). Stairs, floors and stoops are walked as they
//: are; far out from the street the walker is crossing the map, not climbing it.
function walkPace(move) {
  const x = avatar.position.x, z = avatar.position.z;
  const here = walkerGroundInfo(x, z);
  const probe = (dx, dz) => walkerGroundInfo(x + dx * PACE_PROBE_M, z + dz * PACE_PROBE_M);
  let ahead = probe(move.x, move.z);
  const stairs = here.kind === "stairs" || ahead.kind === "stairs";
  const crossing = avatarMoveSpeed() > STREET_SPEED * 3 || state.indoors;
  let grade = (ahead.y - here.y) / PACE_PROBE_M;
  const plain = here.kind === "terrain" && ahead.kind === "terrain";
  if (plain && !crossing && (grade > MAX_WALK_GRADE || grade < -MAX_DROP_GRADE)) {
    // Along the slope instead: the contour, the way that is level here.
    const e = probe(1, 0).y - here.y, n = probe(0, 1).y - here.y;
    const g = Math.hypot(e, n);
    if (g > 1e-6) {
      const cx = -n / g, cz = e / g, along = move.x * cx + move.z * cz;
      move.set(cx * along, 0, cz * along);
    }
    if (move.lengthSq() < 0.04) { move.set(0, 0, 0); return { factor: 0, blocked: true }; }
    move.normalize();
    ahead = probe(move.x, move.z);
    grade = (ahead.y - here.y) / PACE_PROBE_M;
    if (grade > MAX_WALK_GRADE || grade < -MAX_DROP_GRADE) { move.set(0, 0, 0); return { factor: 0, blocked: true }; }
  }
  let factor = crossing ? 1 : toblerPace(grade);
  if (stairs && !crossing) factor = Math.min(factor, STAIR_PACE);
  return { factor, stairs, grade };
}
function stepAvatar(now) {
  const dt = Math.min((now - previous) / 1000, 0.1);   // clamped: a backgrounded tab returns
  previous = now;                                       // with a huge delta and would teleport
  if (state.explore) { exploreStep(dt); return; }
  // At the wheel the arrows are the pedals and the wheel (docs/city/view.mjs); riding in a party
  // member's car, the walker goes where that car goes.
  if (typeof livingCity !== "undefined" && livingCity?.driving) { livingCity.drive(dt, held); updateAvatarMixer(dt); return; }
  if (typeof livingCity !== "undefined" && livingCity?.riding) { updateAvatarMixer(dt); return; }
  // Inside a shop (its room is the city's own): the walk is kept to the room.
  if (typeof livingCity !== "undefined" && livingCity?.inside) { livingCity.walkInside(dt, held); updateAvatarMixer(dt); return; }
  keepWalkerOutside();
  updateDoors(dt);
  // The city walking you somewhere (over to a thing G picks up) has the legs this frame; an
  // arrow pressed takes them back.
  if (typeof livingCity !== "undefined" && livingCity?.autoWalk) {
    if (held.size) livingCity.cancelAutoWalk?.();
    else if (livingCity.autoWalk(dt)) { updateAvatarMixer(dt); return; }
  }
  if (!held.size) {
    if (!followGps(dt)) animateAvatar(0, new THREE.Vector3(), false);
    updateAvatarMixer(dt);
    return;
  }
  // The arrows steer the walker as you would walk: Up goes the way you face, Left and Right turn
  // you (round a curve as wide as your speed, walkTurn -- Up with Left walks a curve, and letting
  // go of Left carries on straight the way you now face), Down turns you round in two steps and
  // walks back. Left or Right alone walks the curve slower. The view eases round behind.
  const scaled = avatarMoveSpeed();
  // The living city's bars: slowed when spent, faster sprinting (Shift) while stamina lasts.
  const vitalsPace = typeof livingCity !== "undefined" && livingCity?.walkFactor ? livingCity.walkFactor() : 1;
  const steered = walkSteer(dt, scaled * vitalsPace);
  if (!steered) { updateAvatarMixer(dt); return; }
  const move = steered.way;
  move.normalize();
  // Hills and stairs set the pace, and a cliff is not walked up (walkPace).
  const pace = walkPace(move);
  avatar.userData.pace = pace.factor;
  avatar.userData.onStairs=pace.stairs;
  avatar.userData.grade=pace.grade;
  if (!move.lengthSq()) { animateAvatar(0, new THREE.Vector3(), false); updateAvatarMixer(dt); return; }
  // Zoom changes flat-ground travel, not the rate at which a body climbs risers.
  const surfaceSpeed=walkSurfaceSpeed(scaled,pace)*vitalsPace*steered.pace;
  move.multiplyScalar(surfaceSpeed * dt);
  GPS_LEASH.on = false;   // walking yourself: the walker is yours until R or Reset view
  requestInteriors();
  // Canonical footprints stay solid for the walker, including when a door is open.
  const moved = moveWalker(move.x, move.z);
  const lon = midLon + avatar.position.x / metersPerLon;
  const lat = midLat - avatar.position.z / metersPerLat;
  if (window.kerbsideOpenFullRegionAt && window.kerbsideOpenFullRegionAt(lon, lat)) return;
  avatar.userData.lastMoving=moved>0;
  if (typeof livingCity !== "undefined") livingCity?.walked?.(moved, dt);
  animateAvatar(moved, move, moved>0);
  updateAvatarMixer(dt);
  state.target.copy(avatar.position);
  placeCamera();
}

//: The resolution is set by the frame time, measured, not by what the GPU is called. The first
//: FRAME_SAMPLE frames after loading are timed; if their median is over the budget and the
//: canvas is drawn at more than one device pixel per CSS pixel, the ratio is halved and the
//: sample taken again. A Retina display at 2x is four times the pixels of 1x; a laptop that
//: cannot fill them in forty milliseconds gets a sharp-enough picture that moves instead.
const FRAME_BUDGET_MS = 40;
const FRAME_SAMPLE = 90;
let frameSamples = [];
let lastFrameAt = 0;
function adaptResolution(now) {
  if (!frameSamples) return;
  const dt = lastFrameAt ? now - lastFrameAt : 0;
  lastFrameAt = now;
  // The first frame, and a frame after the tab was hidden, measure nothing.
  if (dt <= 0 || dt > 1000) return;
  frameSamples.push(dt);
  if (frameSamples.length < FRAME_SAMPLE) return;
  const sorted = frameSamples.slice().sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const ratio = renderer.getPixelRatio();
  if (median > FRAME_BUDGET_MS && ratio > 1) {
    const next = Math.max(1, ratio / 2);
    renderer.setPixelRatio(next);
    resize();
    console.info(`kerbside: median frame ${median.toFixed(0)} ms at ${ratio}x over ${FRAME_SAMPLE} frames; drawing at ${next}x`);
    frameSamples = [];
    return;
  }
  console.info(`kerbside: median frame ${median.toFixed(0)} ms at ${ratio}x over ${FRAME_SAMPLE} frames`);
  frameSamples = null;
}
window.kerbsideFrameStats = () => ({ samples: frameSamples ? frameSamples.length : null, pixelRatio: renderer.getPixelRatio() });

//: How far a fine surface is drawn from the camera, by its class. A kerb is twelve centimetres
//: tall and a lane line ten wide: past a few hundred metres neither covers a pixel, and at eye
//: level the blocks in between hide them anyway -- but the frustum test cannot know that, and
//: a first-person view down the Embarcadero drew every kerb to the far end of the corridor.
//: Culled by distance a tile at a time, on top of the frustum, scaled by the zoom. Surfaces
//: not listed -- the roadway, the pavement, the buildings, the ground -- are drawn to the fog.
const DETAIL_RANGE_M = {
  kerb: 500, marking: 400, crossing_edges: 400, crossing: 700, walk_underlay: 600, footprint: 600,
  wall: 800, front_walk: 700, tree_pit: 400, "tree:street": 1200, "tree:broad": 1500, "tree:columnar": 1200,
  // A warning pad is under a metre across and a ramp not much more: past these they are under
  // a pixel. A court's lines are five centimetres; a bike lane's green reads further off.
  tactile_warning: 300, curb_ramp: 350, court_line: 500, bike: 900, house_window: 900,
  "furniture:post": 500, "furniture:sign_plate": 400, "furniture:sign_back": 400, "furniture:bike_rack": 300,
  "furniture:shelter": 900, "furniture:curb_zone": 500, "furniture:bus_zone": 700, "furniture:road_legend": 600, sign: 400, detail: 700,
  roof_furniture: 600,
  // Poles and wires, lamps and signals: a wire is a pixel wide at a few hundred metres.
  "furniture:utility_pole": 900, "furniture:overhead_wire": 700, "furniture:trolley_wire": 700,
  "furniture:trolley_pole": 900, "furniture:street_light": 900, "furniture:traffic_signal": 700,
  "furniture:small_cell": 500, "furniture:bench": 400, "furniture:parking_meter": 400, "furniture:bus_stop": 500,
  "furniture:blank_ad": 500, "furniture:billboard": 1500, "furniture:station_entrance": 900,
  "furniture:power_tower": 5000, "furniture:comm_tower": 5000, "furniture:floodlight": 2500, window: 900,
};
let detailTiles = [];
let detailTilesFrame = 0;
//: The detail index walks the whole scene; it is rebuilt every few seconds, for what has loaded.
const DETAIL_REINDEX_FRAMES = 240;
const detailCentre = new THREE.Vector3();
