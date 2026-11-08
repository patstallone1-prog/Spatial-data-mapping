// ---- what is actually standing there ----
//
// Seven hundred and twenty six of these footprints are small and sit deep inside a block, and
// they were all being drawn as houses: extruded to ten and a half metres, dressed in a window
// grid, given a shopfront. A forty square metre box ten metres tall with windows on it is not a
// building anybody would recognise -- it is the thing that reads, from above, as a tiny mystery
// house in the middle of somebody's garden.
//
// Most of them are real. San Francisco blocks are full of rear cottages, workshops and garages,
// and five hundred of these have a height the city's lidar actually measured. What was invented
// was the treatment, and in 355 cases the height as well: those carry `inferred_default`, which
// is the corridor's median building height applied to a garden shed.
//
// So the question asked here is not "is it real" but "what is it", and the answer comes from
// the two things the data does say: how big its footprint is, and where its height came from.
const OUTBUILDING_TAGS = new Set(["shed", "garage", "garages", "hut", "cabin", "service",
                                  "toilets", "container", "kiosk", "outbuilding", "greenhouse",
                                  "carport"]);
//: A roof is a roof. `building=roof` is OpenStreetMap for a canopy over something -- a petrol
//: forecourt, a bus stand, a covered walk -- with no walls under it, and there are 57 of them
//: here. Extruded, each one is a solid ten metre block standing on open ground.
const CANOPY_TAGS = new Set(["roof", "canopy"]);
//: Above this a small footprint is a real narrow building -- a tower on a corner lot, a stair
//: core -- rather than a shed with a made-up height. It is generous: 1.35 times the square root
//: of the floor area puts a 100 m^2 house at 13.5 m, which is four storeys.
const SLENDER_LIMIT = 1.35;
//: What an outbuilding actually is. One storey, or two for a large one, and never more.
const OUTBUILDING_MAX_M = 6.2;
//: Under this a footprint is not a room anyone stands in: the smallest house in the city covers
//: thirty square metres and more. Two at Moscone Recreation Center, 1.6 and 4.4 m^2, carry the
//: park's parcel address and its PUBLIC land use, which made them buildings, and a default
//: 10.5 m made each a house a storey wide and three high. What is that small is a structure:
//: a mast, a cabinet, a booth (structureMesh), and never has a door, windows or rooms.
const STRUCTURE_MAX_M2 = 8;
//: A structure no wider than this is a pole, and one with no measured height is a mast that
//: tall; a wider one is a cabinet or a booth, STRUCTURE_BOX_M high unless measured.
const STRUCTURE_POLE_M = 2.5;
const STRUCTURE_BOX_M = 2.6;

function structureClass(feature, areaM2) {
  const tag = (feature.tags || {}).building;
  if (CANOPY_TAGS.has(tag)) return "canopy";
  if (areaM2 > 0 && areaM2 < STRUCTURE_MAX_M2) return "structure";
  if (OUTBUILDING_TAGS.has(tag)) return "outbuilding";
  // The city's own records outrank every guess below.
  //
  // A garden shed has no street address, no land-use classification and no business in it. San
  // Francisco assigns all three, and a footprint that carries one is a building whatever its
  // size or however its height was arrived at.
  //
  // Without this, "we had to infer the height" was being read as evidence of a shed: 348
  // footprints fell into that branch and 318 of them had a street address, 326 a land use and
  // 16 a shop inside. The standard lot in this city is twenty-five feet by a hundred, so the
  // house on it covers well under the 150 m2 floor -- three-family houses on Larkin Street were
  // being drawn as garden outbuildings, with the dark tar-paper shed roof that goes with one,
  // and from above a house painted in shed roof reads as a hole in the block.
  if (feature.address || feature.land_use || (feature.shops && feature.shops.length)) {
    return "building";
  }
  // A height OpenStreetMap states is a statement about this building and is believed. A lidar
  // median over a forty square metre footprint in a dense block is a measurement of whatever
  // was tallest in the cell, which is usually the building next door.
  const stated = feature.height_source === "osm_height" || feature.height_source === "osm_levels"
    || feature.height_osm_m != null;
  if (stated || areaM2 >= 150) return "building";
  const height = feature.height_m || 0;
  if (feature.height_source === "inferred_default" || !feature.height_source) return "outbuilding";
  if (height > SLENDER_LIMIT * Math.sqrt(Math.max(areaM2, 1))) return "outbuilding";
  return "building";
}

function footprintWalls(points) {
  if (!points || points.length < 3) return [];
  const local = points.map((p) => {
    const [x, y] = xy(p[0], p[1]);
    return [x, -y];
  });
  const sameEnds = Math.hypot(local[0][0] - local[local.length - 1][0],
                              local[0][1] - local[local.length - 1][1]) < 0.05;
  const ring = sameEnds ? local.slice(0, -1) : local;
  const centroid = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0])
    .map((v) => v / ring.length);
  const walls = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const span = Math.hypot(dx, dz);
    if (span < 3.0) continue;
    let nx = -dz / span;
    let nz = dx / span;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if ((mid[0] - centroid[0]) * nx + (mid[1] - centroid[1]) * nz < 0) {
      nx = -nx; nz = -nz;
    }
    const baseYaw = Math.atan2(-dz, dx);
    const leftNx = -dz / span, leftNz = dx / span;
    const yaw = (nx * leftNx + nz * leftNz) > 0.5 ? baseYaw : baseYaw + Math.PI;
    walls.push({ x: mid[0], z: mid[1], span, nx, nz, yaw });
  }
  return walls;
}

function placeSlab(metrics, color, y = 0.075) {
  const geometry = new THREE.ShapeGeometry(metrics.shape);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness: 0.92, metalness: 0.02,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
  }));
  mesh.position.y = y;
  return mesh;
}

// Balconies, sills, bollards, pumps, shopfront trim: fifty thousand small parts across the
// corridor, each its own mesh and its own material, and none of them picked or moved. They go
// into the merge like the streets do -- a balcony is still there, it is simply drawn in the
// same call as every other balcony that shares its colour.
function makeBox(x, y, z, w, h, d, color, roughness) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.04 })
  );
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

function boxPart(group, x, y, z, w, h, d, color, roughness = 0.82) {
  const mesh = makeBox(x, y + BUILDING_LIFT_M, z, w, h, d, color, roughness);
  addMerged("part", mesh, "detail");
  return mesh;
}

function rotatedBoxPart(group, x, y, z, w, h, d, color, roughness = 0.82, rotationY = 0) {
  // Turned before it is merged: the merge bakes the transform in, so a rotation set afterwards
  // would be applied to nothing.
  const mesh = makeBox(x, y + BUILDING_LIFT_M, z, w, h, d, color, roughness);
  mesh.rotation.y = rotationY;
  addMerged("part", mesh, "detail");
  return mesh;
}

//: The small canvases the planes carry -- a shopfront, a sign, a price board -- packed into
//: shared atlases. A shopfront's canvas is keyed by its trade, its variant and the frame's
//: colour, and the frame takes the building's tint: nine hundred and fifty shopfronts were
//: nine hundred distinct textures, so nine hundred draw calls, for a few thousand triangles.
//: Drawn into atlases of PLANE_ATLAS_PX a side, one family per canvas size, and the plane's
//: UVs moved to its cell, they share a material per atlas: nine draw calls. A canvas that
//: repeats across its plane cannot be atlased and is left as it is.
const PLANE_ATLAS_PX = 2048;
//: A gutter round each cell, filled with the cell's own edge, so that the mip levels do not
//: blend one shopfront into its neighbour in the atlas.
const PLANE_ATLAS_PAD = 4;
const planeAtlases = new Map();
const planeAtlasSlots = new Map();
function atlasSlotFor(map) {
  if (!map || !map.image) return null;
  const image = map.image;
  const w = Number(image.width) || 0, h = Number(image.height) || 0;
  if (!w || !h || w > 512 || h > 512 || typeof image.getContext !== "function") return null;
  if (map.wrapS === THREE.RepeatWrapping || map.wrapT === THREE.RepeatWrapping) return null;
  if (map.repeat.x !== 1 || map.repeat.y !== 1 || map.offset.x !== 0 || map.offset.y !== 0) return null;
  let slot = planeAtlasSlots.get(map.uuid);
  if (slot) return slot;
  const family = `${w}x${h}`;
  let atlases = planeAtlases.get(family);
  if (!atlases) planeAtlases.set(family, atlases = []);
  const cellW = w + 2 * PLANE_ATLAS_PAD, cellH = h + 2 * PLANE_ATLAS_PAD;
  const cols = Math.floor(PLANE_ATLAS_PX / cellW), rows = Math.floor(PLANE_ATLAS_PX / cellH);
  if (!cols || !rows) return null;
  let atlas = atlases[atlases.length - 1];
  if (!atlas || atlas.used >= cols * rows) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = PLANE_ATLAS_PX;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = map.colorSpace;
    texture.anisotropy = map.anisotropy;
    atlas = { canvas, ctx: canvas.getContext("2d"), texture, used: 0 };
    atlases.push(atlas);
  }
  const i = atlas.used++;
  const x0 = (i % cols) * cellW, y0 = Math.floor(i / cols) * cellH;
  const ctx = atlas.ctx;
  // The gutter first, as the image's own edges stretched, then the image over the middle.
  ctx.drawImage(image, 0, 0, w, 1, x0, y0, cellW, PLANE_ATLAS_PAD + 1);
  ctx.drawImage(image, 0, h - 1, w, 1, x0, y0 + PLANE_ATLAS_PAD + h - 1, cellW, PLANE_ATLAS_PAD + 1);
  ctx.drawImage(image, 0, 0, 1, h, x0, y0 + PLANE_ATLAS_PAD, PLANE_ATLAS_PAD + 1, h);
  ctx.drawImage(image, w - 1, 0, 1, h, x0 + PLANE_ATLAS_PAD + w - 1, y0 + PLANE_ATLAS_PAD, PLANE_ATLAS_PAD + 1, h);
  ctx.drawImage(image, x0 + PLANE_ATLAS_PAD, y0 + PLANE_ATLAS_PAD);
  atlas.texture.needsUpdate = true;
  // A canvas is drawn from the top down and a texture read from the bottom up.
  slot = { texture: atlas.texture,
           u0: (x0 + PLANE_ATLAS_PAD) / PLANE_ATLAS_PX, v0: 1 - (y0 + PLANE_ATLAS_PAD + h) / PLANE_ATLAS_PX,
           su: w / PLANE_ATLAS_PX, sv: h / PLANE_ATLAS_PX };
  planeAtlasSlots.set(map.uuid, slot);
  return slot;
}

function planePart(group, x, y, z, w, h, map, rotationY = 0) {
  const geometry = new THREE.PlaneGeometry(w, h);
  const slot = atlasSlotFor(map);
  if (slot) {
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, slot.u0 + uv.getX(i) * slot.su, slot.v0 + uv.getY(i) * slot.sv);
    map = slot.texture;
  }
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map, color: 0xffffff, transparent: true, alphaTest: 0.22,
      roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide,
    })
  );
  mesh.position.set(x, y + h / 2 + BUILDING_LIFT_M, z);
  mesh.rotation.y = rotationY;
  // Shopfronts, windows, signage: 38,256 of these, sharing a few dozen cached textures between
  // them. Keyed on the texture rather than on the material object, they merge down to those.
  addMerged("plane", mesh, "detail");
  return mesh;
}

function wallPoint(wall, along = 0, out = 0) {
  const tx = Math.cos(wall.yaw);
  const tz = -Math.sin(wall.yaw);
  return {
    x: wall.x + tx * along + wall.nx * out,
    z: wall.z + tz * along + wall.nz * out,
  };
}

function bestFacadeWall(feature, preferSouth = false) {
  const walls = footprintWalls(feature.points).filter((wall) => wall.span > 4.2);
  if (!walls.length) return null;
  const scored = walls.map((wall) => {
    const south = Math.max(0, wall.nz);
    const widthScore = wall.span;
    const southScore = preferSouth ? south * 18 : south * 3;
    return { wall, score: widthScore + southScore };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].wall;
}

function gasPriceTexture(seed) {
  const canvas = document.createElement("canvas");
  canvas.width = 96; canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(238,240,236,0.98)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const brand = random(seed + 4) < 0.5 ? "#d94732" : "#2368a2";
  ctx.fillStyle = brand;
  ctx.fillRect(0, 0, canvas.width, 34);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("GAS", 48, 24);
  ctx.fillStyle = "#101417";
  ctx.font = "11px system-ui, sans-serif";
  for (const [i, label] of ["REG", "MID", "PREM"].entries()) {
    const y = 55 + i * 33;
    const dollars = 4 + Math.floor(random(seed + i * 17) * 2);
    const cents = 19 + Math.floor(random(seed + i * 23) * 70);
    ctx.fillText(label, 24, y);
    ctx.font = "bold 21px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${dollars}.${String(cents).padStart(2, "0")}`, 86, y + 2);
    ctx.textAlign = "center";
    ctx.font = "11px system-ui, sans-serif";
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.moveTo(10, y + 11); ctx.lineTo(86, y + 11); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.42)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 93, 157);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const GAS_PRICE_CACHE = new Map();
function gasPriceTextureFor(seed) {
  const key = Math.floor(random(seed + 17) * 12);
  if (!GAS_PRICE_CACHE.has(key)) GAS_PRICE_CACHE.set(key, gasPriceTexture(seed + key * 101));
  return GAS_PRICE_CACHE.get(key);
}

function pumpIsland(group, x, z, brand) {
  boxPart(group, x, 0.08, z, 3.8, 0.22, 1.35, 0x2a2e30, 0.72);
  for (const side of [-1, 1]) {
    boxPart(group, x + side * 0.85, 0.30, z, 0.56, 1.45, 0.42, 0xe9eceb, 0.48);
    boxPart(group, x + side * 0.85, 1.60, z, 0.62, 0.18, 0.46, brand, 0.42);
    const hose = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.018, 6, 18, Math.PI * 1.15),
      new THREE.MeshStandardMaterial({ color: 0x171a1c, roughness: 0.78, metalness: 0.18 })
    );
    hose.position.set(x + side * 1.17, 1.0, z + 0.25);
    hose.rotation.set(Math.PI / 2, 0, side > 0 ? 0.35 : -0.35);
    group.add(hose);
  }
  for (const sx of [-1.75, 1.75]) {
    for (const sz of [-0.75, 0.75]) {
      boxPart(group, x + sx, 0, z + sz, 0.18, 0.72, 0.18, 0xd8b12f, 0.58);
    }
  }
}

function balconyPart(group, wall, y, seed) {
  const width = Math.min(3.4, Math.max(2.0, wall.span * 0.24));
  const depth = 0.72;
  const along = (random(seed + 19) - 0.5) * wall.span * 0.28;
  const center = wallPoint(wall, along, depth / 2 + 0.12);
  rotatedBoxPart(group, center.x, y, center.z, width, 0.12, depth, 0x6a7478, 0.66, wall.yaw);
  const front = wallPoint(wall, along, depth + 0.18);
  const tx = Math.cos(wall.yaw);
  const tz = -Math.sin(wall.yaw);
  rotatedBoxPart(group, front.x, y + 0.12, front.z, width, 0.58, 0.055, 0xd4d0c2, 0.54, wall.yaw);
  for (const side of [-1, 1]) {
    rotatedBoxPart(group,
      center.x + tx * side * width / 2 + wall.nx * depth * 0.48,
      y + 0.12,
      center.z + tz * side * width / 2 + wall.nz * depth * 0.48,
      0.055, 0.50, depth, 0xd4d0c2, 0.54, wall.yaw);
  }
}

//: A balcony the detector found on a photographed front, drawn though no one has reviewed it:
//: this far out from the wall (about three feet), its floor at the bottom of the window it serves.
const INFERRED_BALCONY_DEPTH_M = 0.9;
const INFERRED_BALCONY_COLOUR = "#2b2d30";
//: Proposals the detector makes for a balcony. Its "fire escape" one storey tall at one window is a
//: balcony too: a fire escape climbs the front, and it boxed 1547 Francisco's balcony that way. A
//: box shorter than a rail is a ledge -- the foot of a bay window (1535 Francisco) -- not a balcony.
const BALCONY_MIN_BOX_M = 1.0;
//: The lowest a balcony's floor is: above a garage storey. A railing in front of a window lower
//: than that is a stoop's or a porch's, which the entry draws (a fifth of the Sunset's houses
//: carried one as a "balcony" a metre or two up).
const BALCONY_MIN_FLOOR_M = 2.4;
function balconyProposal(detail) {
  if (detail.render || ![detail.u, detail.v, detail.w, detail.h].every(Number.isFinite) || detail.w < 0.4
      || detail.h < BALCONY_MIN_BOX_M) return false;
  return detail.kind === "balcony" || (["fire escape", "fire_escape"].includes(detail.kind) && detail.h < 3.2);
}
// The balconies to draw on a front from the detector's proposals: each tied to the window it
// serves -- across it, with that window's foot inside the box's height -- floored at that
// window's foot and as wide as the box or the window (with its frame), whichever is wider. One
// balcony boxed twice is drawn once, and a box drawn round several balconies at one height
// gives way to them (the narrower are taken first).
function inferredBalconies(fit, length) {
  const windows = (fit.openings || []).filter((o) => ["window", "door"].includes(o.kind)
    && [o.u, o.v, o.w, o.h].every(Number.isFinite) && o.v > 1.5);
  const found = [];
  for (const box of (fit.details || []).filter(balconyProposal)) {
    let best = null, bestOverlap = 0;
    for (const o of windows) {
      const overlap = Math.min(box.u + box.w, o.u + o.w) - Math.max(box.u, o.u);
      if (overlap < 0.3 * Math.min(o.w, box.w) || o.v < box.v - 0.5 || o.v > box.v + box.h) continue;
      if (overlap > bestOverlap) { best = o; bestOverlap = overlap; }
    }
    if (!best || best.v < BALCONY_MIN_FLOOR_M || best.v > fit.height_m - 1.2) continue;
    const u0 = Math.max(0, Math.min(box.u, best.u - 0.15));
    const u1 = Math.min(length, Math.max(box.u + box.w, best.u + best.w + 0.15));
    if (u1 - u0 >= 0.6) found.push({ u0, u1, y: best.v, colour: box.colour });
  }
  found.sort((a, b) => (a.u1 - a.u0) - (b.u1 - b.u0));
  const kept = [];
  for (const c of found) {
    const clash = kept.some((k) => Math.abs(k.y - c.y) < 0.4
      && Math.min(k.u1, c.u1) - Math.max(k.u0, c.u0) > 0.5 * Math.min(k.u1 - k.u0, c.u1 - c.u0));
    if (!clash) kept.push(c);
  }
  return kept.map((c) => ({ kind: "balcony", u: c.u0, w: c.u1 - c.u0, depth_m: INFERRED_BALCONY_DEPTH_M,
    platform_heights_m: [c.y], material: "metal", style: "vertical_bars", inferred: true,
    colour: /^#[0-9a-f]{6}$/i.test(c.colour || "") ? c.colour : INFERRED_BALCONY_COLOUR }));
}

function photoDetailParts(group, feature) {
  const fit = frontageFitFor(feature);
  if (!fit?.a || !fit?.b) return;
  const [ax, ay] = xy(...fit.a), [bx, by] = xy(...fit.b);
  const dx = bx-ax, dz = ay-by, L = Math.hypot(dx,dz);
  if (L < .2) return;
  const out=frontageNormalFor(fit);if(!out)return;
  const tx=dx/L, tz=dz/L, [nx,nz]=out, yaw=-Math.atan2(tz,tx);
  const at = (u,n) => [ax+tx*u+nx*n,-ay+tz*u+nz*n];
  // Reviewed balconies and fire escapes as reviewed; where there are none, the detector's balconies.
  const reviewed = (fit.details || []).filter((d) => d.render && ["balcony","fire_escape"].includes(d.kind));
  for (const detail of reviewed.length ? fit.details || [] : inferredBalconies(fit, L)) {
    if ((!detail.inferred && (!detail.render || !detail.visible || !detail.reviewer || detail.image_sha256 !== fit.image_sha256))
        || !["balcony","fire_escape"].includes(detail.kind)
        || ![detail.u,detail.w,detail.depth_m].every(Number.isFinite)
        || detail.u < 0 || detail.w <= 0 || detail.u+detail.w > L+.05
        || detail.depth_m <= 0 || detail.depth_m > 2.5
        || !/^#[0-9a-f]{6}$/i.test(detail.colour || "")) continue;
    const heights = detail.platform_heights_m || [];
    if (!heights.length || !heights.every(y=>Number.isFinite(y) && y>0 && y<=fit.height_m-1.2)) continue;
    const colour = Number.parseInt(detail.colour.slice(1),16);
    const roughness = detail.material === "metal" ? .48 : .82;
    const center = detail.u+detail.w/2, depth=detail.depth_m;
    const part = (u,y,n,w,h,d) => {
      const p=at(u,n);
      const mesh=makeBox(p[0],y+BUILDING_LIFT_M,p[1],w,h,d,colour,roughness);
      mesh.material.metalness=detail.material === "metal" ? .65 : .04;
      mesh.rotation.y=yaw;
      addMerged("part",mesh,"detail");
      return mesh;
    };
    const railBeam = (u0,y0,u1,y1,n) => {
      const a=at(u0,n), b=at(u1,n);
      const direction=new THREE.Vector3(b[0]-a[0],y1-y0,b[1]-a[1]);
      const length=direction.length();
      if(length<.01) return;
      const beam=makeBox(0,0,0,.025,length,.025,colour,roughness);
      beam.material.metalness=detail.material === "metal" ? .65 : .04;
      beam.position.set((a[0]+b[0])/2,(y0+y1)/2+BUILDING_LIFT_M,(a[1]+b[1])/2);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
      addMerged("part",beam,"detail");
    };
    for (const y of heights) {
      part(center,y-.10,depth/2,detail.w,.10,depth);
      part(center,y+1.0,depth,detail.w,.045,.045);
      if (detail.style === "solid_panel") part(center,y+.05,depth,detail.w,.95,.05);
      else if(detail.style === "lattice") for(let u=detail.u;u<detail.u+detail.w;u+=.45) {
        const end=Math.min(detail.u+detail.w,u+.45);
        railBeam(u,y+.10,end,y+.95,depth); railBeam(u,y+.95,end,y+.10,depth);
      }
      else for(let u=detail.u;u<=detail.u+detail.w;u+=.18) part(u,y,depth,.025,1.0,.025);
      for(const u of [detail.u,detail.u+detail.w]) {
        part(u,y+1.0,depth/2,.045,.045,depth);
        for(let n=.1;n<depth;n+=.18) part(u,y,n,.025,1.0,.025);
      }
    }
    if(detail.kind === "fire_escape") for(let i=1;i<heights.length;i++) {
      const low=heights[i-1], high=heights[i], stairWidth=Math.min(.65,detail.w*.35);
      const run=detail.w-stairWidth;
      const count=Math.ceil((high-low)/.18);
      for(let k=0;k<count;k++) {
        const u=detail.u+stairWidth/2+run*(k+.5)/count;
        part(u,low+(high-low)*(k+1)/count-.04,depth/2,run/count,.04,Math.min(.75,depth));
      }
    }
  }
}

const PHOTO_OPENING_TEXTURES = new Map();
function photoOpeningTexture(kind, design) {
  const colour=/^#[0-9a-f]{6}$/i.test(design?.colour || "") ? design.colour : "#8b8980";
  const horizontal=design?.panel_lines?.horizontal || [], vertical=design?.panel_lines?.vertical || [];
  const key=JSON.stringify([kind,colour,horizontal,vertical]);
  if(PHOTO_OPENING_TEXTURES.has(key))return PHOTO_OPENING_TEXTURES.get(key);
  const canvas=document.createElement("canvas");canvas.width=canvas.height=128;
  const ctx=canvas.getContext("2d");ctx.fillStyle=colour;ctx.fillRect(0,0,128,128);
  ctx.strokeStyle="rgba(20,20,20,.45)";ctx.lineWidth=1.5;
  for(const y of horizontal){ctx.beginPath();ctx.moveTo(0,y*128);ctx.lineTo(128,y*128);ctx.stroke();}
  for(const x of vertical){ctx.beginPath();ctx.moveTo(x*128,0);ctx.lineTo(x*128,128);ctx.stroke();}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  PHOTO_OPENING_TEXTURES.set(key,texture);return texture;
}

// The window pictures. They stand here, above the first building drawn, because an accepted
// photographed front on a building that is not a home draws its windows with them while the
// streets are built -- further down, they were not yet initialised and the page stopped.
//: A window's frame -- sash, bars and mullions -- where nothing measured its colour: painted
//: white, as San Francisco's are far more often than not. A trim colour read off the photograph
//: (design.trim.colour) stands over it.
const WINDOW_FRAME_DEFAULT = "#eeede8";
const homeWindowTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 96;
  const ctx = canvas.getContext("2d");
  // The frame: the shell's frame colour (homeFrameMaterial), a sash bar across and a mullion.
  ctx.fillStyle = WINDOW_FRAME_DEFAULT;
  ctx.fillRect(0, 0, 64, 96);
  // The glass: the shell's dark glass, a little lighter toward the top where it takes the sky.
  const sky = ctx.createLinearGradient(0, 0, 0, 96);
  sky.addColorStop(0, "#3a4b56");
  sky.addColorStop(0.55, "#2a3740");
  sky.addColorStop(1, "#222d34");
  ctx.fillStyle = sky;
  ctx.fillRect(3, 3, 27, 90);
  ctx.fillRect(34, 3, 27, 90);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
})();
const homeDecalMaterial = new THREE.MeshStandardMaterial({ map: homeWindowTexture, roughness: 0.14,
  metalness: 0.2, envMapIntensity: 1.0 });
const homeDesignMaterials = new Map();
function homeDesignMaterial(design) {
  if (!design) return homeDecalMaterial;
  const trimColour=/^#[0-9a-f]{6}$/i.test(design.trim?.colour || "") ? design.trim.colour : WINDOW_FRAME_DEFAULT;
  const key = JSON.stringify([design.vertical_bars || [], design.horizontal_bars || [],trimColour,design.shape,design.arch_spring_fraction,"clear"]);
  if (homeDesignMaterials.has(key)) return homeDesignMaterials.get(key);
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const arch=homeWindowArchSpring({design,w:128,h:128});
  if(arch===null) {ctx.fillStyle = trimColour; ctx.fillRect(0,0,128,128);ctx.clearRect(4,4,120,120);}
  else {
    ctx.beginPath();ctx.moveTo(4,124);ctx.lineTo(124,124);
    for(let i=0;i<=32;i++){const t=1-i/32;ctx.lineTo(4+120*t,4+120*(1-arch-(1-arch)*Math.sqrt(Math.max(0,1-(2*t-1)**2))));}
    ctx.closePath();ctx.strokeStyle=trimColour;ctx.lineWidth=6;ctx.stroke();ctx.save();ctx.clip();
  }
  // Far decals still contain a neutral glass layer, not empty alpha over painted wall.
  // Detailed nearby shells supply the real hole and identically clear two-sided glazing.
  ctx.fillStyle="rgba(231,240,243,0.12)";ctx.fillRect(4,4,120,120);
  ctx.fillStyle = trimColour;
  for (const t of design.vertical_bars || []) ctx.fillRect(t*128-1.5,4,3,120);
  for (const t of design.horizontal_bars || []) ctx.fillRect(4,t*128-1.5,120,3);
  if(arch!==null)ctx.restore();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map:texture, roughness:.08,metalness:0, envMapIntensity:.4, transparent:true, depthWrite:false, alphaTest:.05 });
  homeDesignMaterials.set(key,material); return material;
}
function photoOpeningParts(group,feature,includeWindows=false) {
  const fit=frontageFitFor(feature);
  if(!fit?.a || !fit?.b)return;
  const [ax,ay]=xy(...fit.a),[bx,by]=xy(...fit.b),dx=bx-ax,dz=ay-by,L=Math.hypot(dx,dz);
  if(L<.2)return;
  const out=frontageNormalFor(fit);if(!out)return;
  const tx=dx/L,tz=dz/L,[nx,nz]=out,yaw=-Math.atan2(tz,tx);
  for(const o of fit.openings || []) {
    if(typeof storeExteriorFor==="function") {
      const exterior=storeExteriorFor(feature);
      if(exterior?.facades.some(f=>f.openings.some(p=>p.v<f.band_height_m
        && p.kerbside_source_record && JSON.stringify(p.kerbside_source_record)===JSON.stringify(o))))continue;
    }
    // By role (coarse_openings.py): a window outline above the ground storey, a door at any other
    // way in on foot. The garages are drawn as garage doors with their kerb (addPhotoGarages),
    // the entry by the door system with its stair or alcove and gate, a gate as part of its entry.
    const role=o.role || (o.kind==="window" ? "window" : o.kind==="door" ? "entrance" : null);
    if(!["window","entrance"].includes(role) || (role==="window" && !includeWindows)
       || o.kind==="gated_entry_candidate" || o.absorbed_into_entry || o.id===fit.primary_entry?.door_id
       || ![o.u,o.v,o.w,o.h].every(Number.isFinite) || o.u<0 || o.u+o.w>L+.05
       || o.v<0 || o.v+o.h>fit.height_m-.1 || o.w<=0 || o.h<=0)continue;
    // This path draws flat panels, not connected stairwells. Never let photo thresholds
    // float over six inches above outside ground, including old fits without access metadata.
    if(role!=="window") {
      const ref=fit.ground_reference;
      const ground=ref?.frame==="relative_to_facade_foot" && ref.source
        && Number.isFinite(ref.outside_ground_m) ? ref.outside_ground_m : 0;
      if(o.render_allowed===false || o.v-ground>.1524)continue;
      // Also compare against the ground actually drawn outside both ends of the leaf.
      // A source control cannot excuse a mismatched terrain/base in the current scene.
      if(typeof terrainGroundAt!=="function" || ![0,.5,1].every(t=>{
        const u=o.u+o.w*t, x=ax+tx*u+nx*.3, z=-ay+tz*u+nz*.3;
        const street=terrainGroundAt(x,z);
        return Number.isFinite(street) && o.v+BUILDING_LIFT_M-street<=.1524+1e-9;
      }))continue;
    }
    const u=o.u+o.w/2,out=.085;
    const map=role==="window" ? homeDesignMaterial(o.design).map : photoOpeningTexture("door",o.design);
    const mesh=planePart(group,ax+tx*u+nx*out,o.v,-ay+tz*u+nz*out,o.w,o.h,map,yaw);
    mesh.userData={surface:o.kind,canonicalBuilding:String(feature.osm_id),grade:"reviewed_inferred_visual_parameters",openingId:o.id};
  }
}

// ---- shopfronts ----
//
// Two thousand seven hundred and twenty eight businesses in this corridor, each with a name and
// a trade, and until now not one of them had its name anywhere. A shop is a point in
// OpenStreetMap far more often than it is a building, so the names were folded onto the
// buildings in the build; what is left is to write them where a shop writes them.
//
// Which is above the door, on a sign band or on an awning, and in San Francisco it is far more
// often a flat board fixed to the wall than a canvas awning -- the awning is the exception on
// these streets, not the rule. The proportions below are estimates and are labelled as such:
// nobody publishes a census of awnings. They are pitched at what the trade actually does, which
// is the part that is not guesswork. A bank puts its name on a board in cut letters; a cafe
// puts it on a valance; a corner store has a dome awning over the door with the same name
// printed on the skirt.

//: How the name is set, by trade. A hairdresser's sign and a hardware store's sign are not the
//: same object and never have been: one is a script with a lot of air round it and the other is
//: as much bold condensed capital as will fit in the space.
const TRADE_TYPE = {
  restaurant:  { font: '600 34px Georgia, "Times New Roman", serif', caps: false, track: 0.5 },
  pizza:       { font: '700 34px Georgia, serif', caps: true, track: 1.5 },
  cafe:        { font: 'italic 600 34px Georgia, serif', caps: false, track: 0.5 },
  bakery:      { font: 'italic 600 34px "Palatino Linotype", Georgia, serif', caps: false, track: 0.5 },
  bar:         { font: '700 32px "Trebuchet MS", Verdana, sans-serif', caps: true, track: 2.5 },
  grocery:     { font: '800 32px "Arial Narrow", Arial, sans-serif', caps: true, track: 1 },
  convenience: { font: '800 32px "Arial Narrow", Arial, sans-serif', caps: true, track: 1 },
  clothing:    { font: '300 28px "Helvetica Neue", Arial, sans-serif', caps: true, track: 7 },
  books:       { font: '500 32px Georgia, serif', caps: false, track: 1 },
  salon:       { font: 'italic 600 36px "Brush Script MT", "Segoe Script", cursive', caps: false, track: 0 },
  pharmacy:    { font: '700 32px Arial, Helvetica, sans-serif', caps: true, track: 1 },
  bank:        { font: '500 30px Georgia, serif', caps: true, track: 4 },
  laundry:     { font: '700 30px Arial, Helvetica, sans-serif', caps: true, track: 2.5 },
  hardware:    { font: '800 30px Arial, Helvetica, sans-serif', caps: true, track: 1 },
  florist:     { font: 'italic 500 34px Georgia, serif', caps: false, track: 0.5 },
  hotel:       { font: '400 32px Georgia, serif', caps: true, track: 6 },
  office:      { font: '500 30px "Helvetica Neue", Arial, sans-serif', caps: true, track: 3 },
  civic:       { font: '500 30px Georgia, serif', caps: true, track: 3.5 },
  school:      { font: '600 30px Georgia, serif', caps: true, track: 2 },
  residential: { font: '500 28px "Helvetica Neue", Arial, sans-serif', caps: false, track: 1.2 },
  industrial:  { font: '800 28px "Arial Narrow", Arial, sans-serif', caps: true, track: 1 },
  shop:        { font: '600 32px "Helvetica Neue", Arial, sans-serif', caps: true, track: 2 },
};

//: Which awning each trade puts up, as a share. `board` is the flat sign fixed against the wall
//: with no canvas at all, and it is the most common thing on a San Francisco shopfront by a wide
//: margin -- the others are the ones people picture. Estimates, per the note above.
const AWNING_MIX = {
  restaurant:  { board: 0.42, straight: 0.24, dome: 0.12, shed: 0.14, retractable: 0.08 },
  pizza:       { board: 0.40, straight: 0.22, dome: 0.20, shed: 0.10, retractable: 0.08 },
  cafe:        { board: 0.36, straight: 0.26, dome: 0.14, shed: 0.10, retractable: 0.14 },
  bakery:      { board: 0.40, straight: 0.24, dome: 0.16, shed: 0.10, retractable: 0.10 },
  bar:         { board: 0.62, straight: 0.14, dome: 0.08, shed: 0.12, retractable: 0.04 },
  grocery:     { board: 0.50, straight: 0.20, dome: 0.14, shed: 0.12, retractable: 0.04 },
  convenience: { board: 0.46, straight: 0.16, dome: 0.24, shed: 0.10, retractable: 0.04 },
  clothing:    { board: 0.66, straight: 0.10, dome: 0.06, shed: 0.14, retractable: 0.04 },
  books:       { board: 0.70, straight: 0.10, dome: 0.06, shed: 0.10, retractable: 0.04 },
  salon:       { board: 0.48, straight: 0.16, dome: 0.22, shed: 0.08, retractable: 0.06 },
  pharmacy:    { board: 0.74, straight: 0.10, dome: 0.06, shed: 0.08, retractable: 0.02 },
  bank:        { board: 0.88, straight: 0.04, dome: 0.02, shed: 0.06, retractable: 0.00 },
  laundry:     { board: 0.66, straight: 0.12, dome: 0.10, shed: 0.10, retractable: 0.02 },
  hardware:    { board: 0.72, straight: 0.10, dome: 0.06, shed: 0.10, retractable: 0.02 },
  florist:     { board: 0.42, straight: 0.20, dome: 0.22, shed: 0.08, retractable: 0.08 },
  hotel:       { board: 0.52, straight: 0.12, dome: 0.10, shed: 0.24, retractable: 0.02 },
  shop:        { board: 0.60, straight: 0.14, dome: 0.10, shed: 0.12, retractable: 0.04 },
};

//: The name is drawn once into a shared canvas and every sign takes a rectangle of it, so that
//: two thousand seven hundred signs are a handful of textures rather than two thousand seven
//: hundred. 2048 is the largest size that is safe everywhere.
const SIGN_ATLAS_PX = 2048;
//: Row height in the atlas. Names are packed along a row and wrapped to the next, so a short
//: name costs a short rectangle rather than a whole cell.
const SIGN_ROW_PX = 46;
const SIGN_PAD_PX = 5;
//: Slots are at most this wide. Anything that will not fit is set smaller until it does, which
//: is what a signwriter does with a long name on a fixed board.
const SIGN_MAX_PX = 460;
const SIGN_MIN_SCALE = 0.42;

const signAtlases = [];

function newSignAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIGN_ATLAS_PX;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SIGN_ATLAS_PX, SIGN_ATLAS_PX);
  ctx.textBaseline = "middle";
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const atlas = { canvas, ctx, texture, x: SIGN_PAD_PX, y: SIGN_PAD_PX, index: signAtlases.length };
  signAtlases.push(atlas);
  return atlas;
}

function drawTracked(ctx, text, x, y, track) {
  // Letter spacing, by hand: canvas has no tracking, and a fashion sign without it is not a
  // fashion sign. Returns the width drawn.
  if (!track) {
    ctx.fillText(text, x, y);
    return ctx.measureText(text).width;
  }
  let at = x;
  for (const letter of text) {
    ctx.fillText(letter, at, y);
    at += ctx.measureText(letter).width + track;
  }
  return at - x - track;
}

function measureTracked(ctx, text, track) {
  if (!track) return ctx.measureText(text).width;
  let width = 0;
  for (const letter of text) width += ctx.measureText(letter).width + track;
  return Math.max(0, width - track);
}

const SIGN_SLOTS = new Map();

function inkFor(colour) {
  // Letters that read: dark on a light board, light on a dark one. Every sign used to be set
  // in near-white, which on the pale awnings the lighter buildings get was white on cream.
  const hsl = {};
  colour.getHSL(hsl, THREE.SRGBColorSpace);
  return hsl.l > 0.52 ? "dark" : "light";
}

function signSlot(name, trade, ink = "light") {
  const key = `${trade}|${ink}|${name}`;
  const cached = SIGN_SLOTS.get(key);
  if (cached) return cached;

  const style = TRADE_TYPE[trade] || TRADE_TYPE.shop;
  const text = style.caps ? name.toUpperCase() : name;
  let atlas = signAtlases[signAtlases.length - 1] || newSignAtlas();
  const ctx = atlas.ctx;

  // Set it at the trade's own size, then shrink until it fits the board. A long name in a small
  // face is what a signwriter does; a long name overflowing the board is what nobody does.
  const base = RegExp("(\\d+)px").exec(style.font);
  const basePx = base ? Number(base[1]) : 32;
  let scale = 1.0;
  let width = 0;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    ctx.font = style.font.replace(RegExp("(\\d+)px"), `${Math.max(12, Math.round(basePx * scale))}px`);
    width = measureTracked(ctx, text, style.track * scale) + SIGN_PAD_PX * 2;
    if (width <= SIGN_MAX_PX || scale <= SIGN_MIN_SCALE) break;
    scale = Math.max(SIGN_MIN_SCALE, scale * 0.9);
  }
  width = Math.min(SIGN_MAX_PX, Math.ceil(width));

  if (atlas.x + width > SIGN_ATLAS_PX - SIGN_PAD_PX) {
    atlas.x = SIGN_PAD_PX;
    atlas.y += SIGN_ROW_PX;
  }
  if (atlas.y + SIGN_ROW_PX > SIGN_ATLAS_PX - SIGN_PAD_PX) {
    atlas = newSignAtlas();
  }
  const ax = atlas.x;
  const ay = atlas.y;
  const c = atlas.ctx;
  c.font = ctx.font;
  c.textBaseline = "middle";
  // Painted letters, with the faint shadow a raised letter throws on the board behind it.
  c.fillStyle = ink === "dark" ? "rgba(255,255,255,0.30)" : "rgba(0,0,0,0.34)";
  drawTracked(c, text, ax + SIGN_PAD_PX + 1.2, ay + SIGN_ROW_PX / 2 + 1.4, style.track * scale);
  c.fillStyle = ink === "dark" ? "rgba(24,22,20,0.97)" : "rgba(250,248,242,0.97)";
  drawTracked(c, text, ax + SIGN_PAD_PX, ay + SIGN_ROW_PX / 2, style.track * scale);
  atlas.texture.needsUpdate = true;
  atlas.x += width + SIGN_PAD_PX;

  const slot = {
    atlas,
    u0: ax / SIGN_ATLAS_PX,
    u1: (ax + width) / SIGN_ATLAS_PX,
    // Canvas y runs down and texture v runs up.
    v0: 1 - (ay + SIGN_ROW_PX) / SIGN_ATLAS_PX,
    v1: 1 - ay / SIGN_ATLAS_PX,
    aspect: width / SIGN_ROW_PX,
  };
  SIGN_SLOTS.set(key, slot);
  return slot;
}

const SIGN_MATERIALS = new Map();

function signMaterial(atlas) {
  if (!SIGN_MATERIALS.has(atlas.index)) {
    SIGN_MATERIALS.set(atlas.index, new THREE.MeshStandardMaterial({
      map: atlas.texture, transparent: true, alphaTest: 0.22, side: THREE.DoubleSide,
      roughness: 0.72, metalness: 0.0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12,
    }));
  }
  return SIGN_MATERIALS.get(atlas.index);
}

//: Awning colours are the building's own, lightened. A shopfront is painted to go with the
//: building it is cut into, and the awning is a shade up from the wall rather than a colour of
//: its own.
function awningColour(tint) {
  const colour = new THREE.Color(tint);
  const hsl = {};
  colour.getHSL(hsl);
  // Lighter than the wall, and with a floor. A proportional lift alone is not enough on this
  // city's stock: the walls are stated dark to survive the exposure, so a fifth again of very
  // little is still very little, and every awning came out near black against a near black
  // building. Canvas is dyed, not stained -- it is lighter than the masonry it hangs off
  // whatever the masonry is -- so the floor is what makes it read as an awning at all.
  const lifted = Math.max(hsl.l * 1.35 + 0.12, 0.34);
  colour.setHSL(hsl.h, Math.min(0.85, hsl.s * 1.35 + 0.08), Math.min(0.72, lifted));
  return colour;
}

function pickAwning(trade, seed) {
  const mix = AWNING_MIX[trade] || AWNING_MIX.shop;
  let roll = random(seed * 1.7 + 97.3);
  for (const kind of ["board", "straight", "dome", "shed", "retractable"]) {
    roll -= mix[kind] || 0;
    if (roll <= 0) return kind;
  }
  return "board";
}

//: The awning parts, collected like everything else: one mesh per kind for the whole city, with
//: the store's colour on the vertices.
const AWNING_MATERIALS = {};

function awningMaterial(kind) {
  if (!AWNING_MATERIALS[kind]) {
    AWNING_MATERIALS[kind] = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
      roughness: kind === "board" ? 0.72 : kind === "band" ? 0.8 : 0.88,
      metalness: kind === "board" ? 0.12 : 0.0,
    });
  }
  return AWNING_MATERIALS[kind];
}

function awningQuad(sink, corners, colours) {
  const base = sink.positions.length / 3;
  for (let i = 0; i < 4; i += 1) {
    sink.positions.push(corners[i][0], corners[i][1] + BUILDING_LIFT_M, corners[i][2]);
    const c = colours[i] || colours[0];
    sink.colours.push(c.r, c.g, c.b);
    sink.uvs.push(0, 0);
  }
  sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function newSink() {
  return { positions: [], colours: [], uvs: [], indices: [] };
}

function flushSink(sink, material, surface) {
  if (!sink.indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(sink.colours, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
  geometry.setIndex(sink.indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.surface = surface;
  mesh.frustumCulled = false;
  return mesh;
}

const AWNING_SINKS = {};
const SIGN_SINKS = new Map();

function awningSink(kind) {
  if (!AWNING_SINKS[kind]) AWNING_SINKS[kind] = newSink();
  return AWNING_SINKS[kind];
}

function signSink(atlas) {
  if (!SIGN_SINKS.has(atlas.index)) SIGN_SINKS.set(atlas.index, newSink());
  return SIGN_SINKS.get(atlas.index);
}

function addSignFace(atlas, corners, slot) {
  // Corners run bottom-left, bottom-right, top-right, top-left as the sign is read.
  const sink = signSink(atlas);
  const base = sink.positions.length / 3;
  const uv = [[slot.u0, slot.v0], [slot.u1, slot.v0], [slot.u1, slot.v1], [slot.u0, slot.v1]];
  for (let i = 0; i < 4; i += 1) {
    sink.positions.push(corners[i][0], corners[i][1] + BUILDING_LIFT_M, corners[i][2]);
    sink.uvs.push(uv[i][0], uv[i][1]);
    sink.colours.push(1, 1, 1);
  }
  sink.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// The five. One of them -- the board -- is not an awning at all, and it is the one San Francisco
// actually has most of: a painted or cut-letter sign fixed flat to the wall above the glass.
//
// Each is built in the wall's own frame: `along` runs left to right across the shopfront, `out`
// is away from the wall, `up` is up. The wall hands over a point and two directions and the
// shapes below never have to think about which way the building faces.
function shopFrame(wall, centreAlong) {
  const ax = Math.cos(wall.yaw);
  const az = -Math.sin(wall.yaw);
  const ox = wall.nx;
  const oz = wall.nz;
  const cx = wall.x + ax * centreAlong;
  const cz = wall.z + az * centreAlong;
  return (along, out, up) => [cx + ax * along + ox * out, up, cz + az * along + oz * out];
}

//: The underside of an awning is not one flat tone. It is darkest where it meets the wall and
//: lifts towards the front edge, where the sky gets under it -- which is the whole difference
//: between an awning and a box.
function underTones(colour) {
  const deep = colour.clone().multiplyScalar(0.30);
  const lip = colour.clone().multiplyScalar(0.62);
  return { deep, lip };
}

function buildBoard(sink, at, width, colour, slot, atlas) {
  // A sign board on the wall: a shallow box, its face carrying the name.
  const top = 4.35;
  const tall = Math.min(1.05, Math.max(0.62, width * 0.13));
  const bottom = top - tall;
  const out = 0.14;
  const half = width / 2;
  const face = colour.clone().multiplyScalar(0.94);
  const edge = colour.clone().multiplyScalar(0.66);
  // Face.
  awningQuad(sink, [at(-half, out, bottom), at(half, out, bottom),
                    at(half, out, top), at(-half, out, top)], [face]);
  // The four returns to the wall, so it reads as a board with depth rather than a decal.
  awningQuad(sink, [at(-half, 0, top), at(half, 0, top),
                    at(half, out, top), at(-half, out, top)], [edge]);
  awningQuad(sink, [at(-half, out, bottom), at(half, out, bottom),
                    at(half, 0, bottom), at(-half, 0, bottom)],
             [edge.clone().multiplyScalar(0.7)]);
  for (const side of [-1, 1]) {
    awningQuad(sink, [at(side * half, 0, bottom), at(side * half, out, bottom),
                      at(side * half, out, top), at(side * half, 0, top)], [edge]);
  }
  const inset = 0.05;
  const signH = Math.min(tall - 0.20, 0.62);
  const signW = Math.min(width - 0.3, signH * slot.aspect);
  const mid = (top + bottom) / 2;
  addSignFace(atlas, [
    at(-signW / 2, out + inset, mid - signH / 2), at(signW / 2, out + inset, mid - signH / 2),
    at(signW / 2, out + inset, mid + signH / 2), at(-signW / 2, out + inset, mid + signH / 2),
  ], slot);
}

function buildSloped(sink, at, width, colour, slot, atlas, scalloped) {
  // The classic canvas awning: a sheet from the wall out and down, with a valance hanging from
  // its front edge. The name goes on the valance, which is where it goes in life.
  const wallTop = 4.25;
  const frontTop = 3.35;
  const reach = Math.min(1.75, Math.max(1.05, width * 0.16));
  const valance = 0.42;
  const half = width / 2;
  const { deep, lip } = underTones(colour);
  const sheet = colour.clone();

  awningQuad(sink, [at(-half, 0, wallTop), at(half, 0, wallTop),
                    at(half, reach, frontTop), at(-half, reach, frontTop)], [sheet]);
  // Underside, shaded from the wall outward.
  awningQuad(sink, [at(-half, reach, frontTop - 0.012), at(half, reach, frontTop - 0.012),
                    at(half, 0, wallTop - 0.012), at(-half, 0, wallTop - 0.012)],
             [lip, lip, deep, deep]);
  // The two triangular cheeks.
  for (const side of [-1, 1]) {
    awningQuad(sink, [at(side * half, 0, wallTop), at(side * half, reach, frontTop),
                      at(side * half, reach, frontTop - valance), at(side * half, 0, wallTop)],
               [colour.clone().multiplyScalar(0.80)]);
  }
  if (!scalloped) {
    awningQuad(sink, [at(-half, reach, frontTop - valance), at(half, reach, frontTop - valance),
                      at(half, reach, frontTop), at(-half, reach, frontTop)], [sheet]);
  } else {
    // A scalloped skirt, cut as geometry rather than faked with a texture: each bay is a
    // half-round, and the round is what says "retractable" at a glance.
    const bays = Math.max(3, Math.round(width / 0.55));
    const bayW = width / bays;
    for (let i = 0; i < bays; i += 1) {
      const left = -half + i * bayW;
      const steps = 5;
      for (let k = 0; k < steps; k += 1) {
        const t0 = k / steps;
        const t1 = (k + 1) / steps;
        const x0 = left + bayW * t0;
        const x1 = left + bayW * t1;
        const d0 = valance * Math.sin(Math.PI * t0) * 0.85 + valance * 0.15;
        const d1 = valance * Math.sin(Math.PI * t1) * 0.85 + valance * 0.15;
        awningQuad(sink, [at(x0, reach, frontTop - d0), at(x1, reach, frontTop - d1),
                          at(x1, reach, frontTop), at(x0, reach, frontTop)], [sheet]);
      }
    }
  }
  const signH = Math.min(valance - 0.14, 0.30);
  const signW = Math.min(width - 0.24, signH * slot.aspect);
  const mid = frontTop - valance * 0.52;
  addSignFace(atlas, [
    at(-signW / 2, reach + 0.03, mid - signH / 2), at(signW / 2, reach + 0.03, mid - signH / 2),
    at(signW / 2, reach + 0.03, mid + signH / 2), at(-signW / 2, reach + 0.03, mid + signH / 2),
  ], slot);
}

function buildDome(sink, at, width, colour, slot, atlas) {
  // A quarter-round dome over the door, and the name curved round it -- which comes free from
  // laying the sign on the same arc as the canvas rather than on a flat plane in front of it.
  const top = 4.15;
  const radius = Math.min(1.30, Math.max(0.85, width * 0.16));
  const half = Math.min(width, 3.4) / 2;
  const { deep, lip } = underTones(colour);
  const sheet = colour.clone();
  const steps = 9;
  const arc = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * (Math.PI / 2);
    arc.push([Math.sin(t) * radius, top - (1 - Math.cos(t)) * radius]);
  }
  for (let i = 1; i < arc.length; i += 1) {
    const [o0, u0] = arc[i - 1];
    const [o1, u1] = arc[i];
    awningQuad(sink, [at(-half, o0, u0), at(half, o0, u0), at(half, o1, u1), at(-half, o1, u1)],
               [sheet]);
    const shade = i / (arc.length - 1);
    const tone = deep.clone().lerp(lip, shade);
    awningQuad(sink, [at(half, o0 - 0.012, u0), at(-half, o0 - 0.012, u0),
                      at(-half, o1 - 0.012, u1), at(half, o1 - 0.012, u1)], [tone]);
  }
  // The two round cheeks, as fans.
  for (const side of [-1, 1]) {
    for (let i = 1; i < arc.length; i += 1) {
      const base = sink.positions.length / 3;
      const p = [at(side * half, 0, top), at(side * half, arc[i - 1][0], arc[i - 1][1]),
                 at(side * half, arc[i][0], arc[i][1])];
      const tone = colour.clone().multiplyScalar(0.78);
      for (const point of p) {
        sink.positions.push(point[0], point[1], point[2]);
        sink.colours.push(tone.r, tone.g, tone.b);
        sink.uvs.push(0, 0);
      }
      sink.indices.push(base, base + 1, base + 2);
    }
  }
  // The name, following the arc across its lower half where a dome awning carries it.
  const signSteps = 6;
  const from = Math.floor(steps * 0.45);
  const to = Math.min(steps, from + signSteps);
  const signH = Math.min(width - 0.3, 2.9);
  const halfSign = Math.min(half - 0.12, (signH / 2));
  const sink2 = signSink(atlas);
  for (let i = from; i < to; i += 1) {
    const t0 = (i - from) / (to - from);
    const t1 = (i + 1 - from) / (to - from);
    const [o0, u0] = arc[i];
    const [o1, u1] = arc[i + 1];
    const base = sink2.positions.length / 3;
    const pts = [at(-halfSign, o1 + 0.02, u1), at(halfSign, o1 + 0.02, u1),
                 at(halfSign, o0 + 0.02, u0), at(-halfSign, o0 + 0.02, u0)];
    const v0 = slot.v0 + (slot.v1 - slot.v0) * (1 - t1);
    const v1 = slot.v0 + (slot.v1 - slot.v0) * (1 - t0);
    const uv = [[slot.u0, v0], [slot.u1, v0], [slot.u1, v1], [slot.u0, v1]];
    for (let k = 0; k < 4; k += 1) {
      sink2.positions.push(pts[k][0], pts[k][1], pts[k][2]);
      sink2.uvs.push(uv[k][0], uv[k][1]);
      sink2.colours.push(1, 1, 1);
    }
    sink2.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function buildShed(sink, at, width, colour, slot, atlas) {
  // A fixed canopy: flat on top, a deep fascia at the front carrying the name, closed at the
  // sides. The one that reads as joinery rather than as canvas.
  const top = 4.30;
  const reach = Math.min(1.55, Math.max(1.0, width * 0.15));
  const fascia = 0.58;
  const half = width / 2;
  const { deep, lip } = underTones(colour);
  const sheet = colour.clone();
  const face = colour.clone().multiplyScalar(0.97);

  awningQuad(sink, [at(-half, 0, top), at(half, 0, top),
                    at(half, reach, top), at(-half, reach, top)], [sheet]);
  awningQuad(sink, [at(-half, reach, top), at(half, reach, top),
                    at(half, reach, top - fascia), at(-half, reach, top - fascia)], [face]);
  awningQuad(sink, [at(-half, reach, top - fascia - 0.012), at(half, reach, top - fascia - 0.012),
                    at(half, 0, top - fascia - 0.012), at(-half, 0, top - fascia - 0.012)],
             [lip, lip, deep, deep]);
  for (const side of [-1, 1]) {
    awningQuad(sink, [at(side * half, 0, top), at(side * half, reach, top),
                      at(side * half, reach, top - fascia), at(side * half, 0, top - fascia)],
               [colour.clone().multiplyScalar(0.80)]);
  }
  const signH = Math.min(fascia - 0.16, 0.40);
  const signW = Math.min(width - 0.26, signH * slot.aspect);
  const mid = top - fascia * 0.5;
  addSignFace(atlas, [
    at(-signW / 2, reach + 0.03, mid - signH / 2), at(signW / 2, reach + 0.03, mid - signH / 2),
    at(signW / 2, reach + 0.03, mid + signH / 2), at(-signW / 2, reach + 0.03, mid + signH / 2),
  ], slot);
}

//: The lowest building a shop's sign goes on; below SIGN_FULL_HEIGHT_M every sign and awning
//: is taken down by the difference, so a one-storey corner shop has its board under its eaves.
const SHOP_SIGN_MIN_HEIGHT_M = 3.4;
const SIGN_FULL_HEIGHT_M = 4.6;
//: Of each trade's shops, the share that also hang a sign out from the wall over the pavement,
//: read by people walking along it (a blade); and the share whose name is cut letters fixed to
//: the wall itself rather than a board. Estimates, like AWNING_MIX.
const BLADE_SHARE = {
  restaurant: 0.32, pizza: 0.3, cafe: 0.4, bakery: 0.36, bar: 0.55, grocery: 0.2, convenience: 0.25,
  clothing: 0.3, books: 0.45, salon: 0.38, pharmacy: 0.3, bank: 0.12, laundry: 0.3, hardware: 0.3,
  florist: 0.35, hotel: 0.5, shop: 0.28,
};
const LETTERS_SHARE = {
  bank: 0.55, pharmacy: 0.45, clothing: 0.45, hotel: 0.4, office: 0.6, books: 0.25, salon: 0.25,
  restaurant: 0.2, cafe: 0.18, shop: 0.3,
};
//: Trades that put tables out under umbrellas where the pavement has room, and how often.
const SIDEWALK_SEATING = { cafe: 0.6, restaurant: 0.45, pizza: 0.4, bakery: 0.45, bar: 0.3 };
//: Room a table needs: its umbrella's reach from the wall, and the pavement left beyond it.
const SEATING_OUT_M = 1.35;
const SEATING_CLEAR_M = 2.6;
const UMBRELLA_COLOURS = [0xf1ede2, 0x2f5d43, 0x9b2a24, 0x23364f, 0xd9a441, 0x3b3b3b];

function addShopfronts(feature, seed, height, tint) {
  if(typeof storeExteriorFor==="function" && storeExteriorFor(feature))return;
  const shops = feature.shops;
  if (!shops || !shops.length || feature.exteriorEdit) return;
  // Only where a shopfront can be: a ground floor with room above the glass for a sign. A
  // one-storey shop lower than a sign's usual height takes it lower (SIGN_FULL_HEIGHT_M).
  if (height < SHOP_SIGN_MIN_HEIGHT_M) return;
  const wall = storefrontWall(feature);
  if (!wall || wall.span < STOREFRONT_MIN_WALL_M) return;
  const drop = Math.min(0, height - SIGN_FULL_HEIGHT_M);

  // Several businesses share a street wall by dividing it, which is what a block of shops is:
  // the same bays the storefronts are drawn in, so each sign is over its own front.
  const colour = awningColour(tint);
  const bays = shopBays(feature, wall);
  for (let i = 0; i < bays.length; i += 1) {
    const shop = bays[i].shop;
    if (!shop || !shop.n) continue;
    const share = bays[i].share;
    const centre = bays[i].centre;
    const width = Math.min(share * 0.82, 7.5);
    if (width < 2.2) continue;
    const frame = shopFrame(wall, centre);
    const at = (along, out, up) => frame(along, out, up + drop);
    const trade = shop.t || "shop";
    const roll = (k) => random(seed + i * 31.7 + k);
    let kind = pickAwning(trade, seed + i * 31.7);
    // Cut letters on the wall stand in for a board: a bank's name in brass, a boutique's.
    if (kind === "board" && roll(5.3) < (LETTERS_SHARE[trade] || 0)) kind = "letters";
    const sink = awningSink(kind === "letters" ? "board" : kind);
    if (kind === "letters") {
      const slot = signSlot(shop.n, trade, inkFor(new THREE.Color(tint)));
      buildLetters(at, width, slot, slot.atlas);
    } else {
      const slot = signSlot(shop.n, trade, inkFor(colour));
      if (kind === "board") buildBoard(sink, at, width, colour, slot, slot.atlas);
      else if (kind === "dome") buildDome(sink, at, width, colour, slot, slot.atlas);
      else if (kind === "shed") buildShed(sink, at, width, colour, slot, slot.atlas);
      else buildSloped(sink, at, width, colour, slot, slot.atlas, kind === "retractable");
    }
    // A sign out over the pavement as well, at one end of the front: a tall one up the storeys
    // above for a bar, a hotel or a theatre where there are storeys to hang it on.
    if (roll(9.1) < (BLADE_SHARE[trade] || 0.25)) {
      const side = roll(2.2) < 0.5 ? -1 : 1;
      const tall = ["bar", "hotel", "restaurant"].includes(trade) && height >= 7.5 && roll(4.4) < 0.5;
      const bladeColour = roll(6.6) < 0.5 ? colour.clone().multiplyScalar(0.55) : new THREE.Color(0xf2efe6);
      const slot = signSlot(shop.n, trade, inkFor(bladeColour));
      buildBlade(awningSink("blade"), frame, wall, side * (width / 2 - 0.25), bladeColour, slot, slot.atlas,
        tall ? { bottom: 4.7, top: Math.min(height - 0.4, 8.2), reach: 0.62, vertical: true }
          : { bottom: 2.75 + drop, top: 3.45 + drop, reach: 0.95, vertical: false });
    }
    if (roll(12.7) < (SIDEWALK_SEATING[trade] || 0)) addSidewalkSeating(frame, width, seed + i * 7.9);
  }
}

//: A name in letters fixed straight to the wall over the glass: no board, the wall's own colour
//: behind it, and the letters a few centimetres proud of it.
function buildLetters(at, width, slot, atlas) {
  const signH = Math.min(0.62, Math.max(0.36, width * 0.08));
  const signW = Math.min(width - 0.4, signH * slot.aspect);
  const mid = 3.95;
  addSignFace(atlas, [
    at(-signW / 2, 0.07, mid - signH / 2), at(signW / 2, 0.07, mid - signH / 2),
    at(signW / 2, 0.07, mid + signH / 2), at(-signW / 2, 0.07, mid + signH / 2),
  ], slot);
}

//: A blade: a panel standing out from the wall on a bracket, its name on both faces so it reads
//: walking either way along the pavement. ``frame`` is the front's shopFrame (along, out, up);
//: ``along`` where on the front it hangs. A tall one's name runs up it.
function buildBlade(sink, frame, wall, along, colour, slot, atlas, { bottom, top, reach, vertical }) {
  const thick = 0.07, gap = 0.12;
  const o0 = gap, o1 = gap + reach;
  const edge = colour.clone().multiplyScalar(0.7);
  const bracket = new THREE.Color(0x2a2a2a);
  // The bracket from the wall over the panel's top, and the panel itself: a box.
  awningQuad(sink, [frame(along - 0.02, 0, top + 0.04), frame(along + 0.02, 0, top + 0.04),
                    frame(along + 0.02, o1 + 0.05, top + 0.04), frame(along - 0.02, o1 + 0.05, top + 0.04)], [bracket]);
  for (const s of [-1, 1]) {
    awningQuad(sink, [frame(along + s * thick / 2, o0, bottom), frame(along + s * thick / 2, o1, bottom),
                      frame(along + s * thick / 2, o1, top), frame(along + s * thick / 2, o0, top)], [colour]);
  }
  awningQuad(sink, [frame(along - thick / 2, o1, bottom), frame(along + thick / 2, o1, bottom),
                    frame(along + thick / 2, o1, top), frame(along - thick / 2, o1, top)], [edge]);
  awningQuad(sink, [frame(along - thick / 2, o0, bottom), frame(along + thick / 2, o0, bottom),
                    frame(along + thick / 2, o1, bottom), frame(along - thick / 2, o1, bottom)], [edge]);
  // Which way "out" runs for someone reading each face: the face towards +along is read by a
  // person looking back along the wall, whose right hand is (az, -ax) in plan.
  const ax = Math.cos(wall.yaw), az = -Math.sin(wall.yaw);
  const rightIsOut = az * wall.nx - ax * wall.nz > 0;
  const pad = 0.08, w = reach - 2 * pad, h = top - bottom - 2 * pad;
  for (const s of [-1, 1]) {
    const a = along + s * (thick / 2 + 0.006);
    // Reading left to right runs from the wall out on one face and from the end in on the other.
    const outwards = (s > 0) === rightIsOut;
    const near = outwards ? o0 + pad : o1 - pad, far = outwards ? o1 - pad : o0 + pad;
    if (!vertical) {
      const signH = Math.min(h, w / slot.aspect), mid = (bottom + top) / 2;
      const signW = signH * slot.aspect, c = (near + far) / 2, dir = Math.sign(far - near);
      addSignFace(atlas, [frame(a, c - dir * signW / 2, mid - signH / 2), frame(a, c + dir * signW / 2, mid - signH / 2),
                          frame(a, c + dir * signW / 2, mid + signH / 2), frame(a, c - dir * signW / 2, mid + signH / 2)], slot);
    } else {
      // Turned a quarter: the name reads up the blade, its foot towards the reader's right.
      const len = Math.min(h, w * slot.aspect), across = len / slot.aspect, mid = (bottom + top) / 2;
      const c = (near + far) / 2, dir = Math.sign(far - near);
      const footSide = c + dir * across / 2, headSide = c - dir * across / 2;
      addSignFace(atlas, [frame(a, footSide, mid - len / 2), frame(a, footSide, mid + len / 2),
                          frame(a, headSide, mid + len / 2), frame(a, headSide, mid - len / 2)], slot);
    }
  }
}

//: Tables out on the pavement under umbrellas, in front of the window, where there is room for
//: them and for people to pass: never on the road, never against the next building.
const SEATING_SINK = newSink();
function addSidewalkSeating(frame, width, seed) {
  const sets = Math.max(1, Math.min(3, Math.floor((width - 0.6) / 2.3)));
  const colour = new THREE.Color(UMBRELLA_COLOURS[Math.floor(random(seed + 3.3) * UMBRELLA_COLOURS.length)]);
  for (let k = 0; k < sets; k += 1) {
    const along = -width / 2 + width * (k + 0.5) / sets;
    const [x, , z] = frame(along, SEATING_OUT_M, 0);
    const [fx, , fz] = frame(along, SEATING_OUT_M + SEATING_CLEAR_M, 0);
    if (insideCarriageway(x, z, 0) || insideCarriageway(fx, fz, 0) || buildingAt(x, z)) continue;
    umbrellaSet(frame, along, colour, random(seed + k * 1.9) < 0.5);
  }
}

function umbrellaSet(frame, along, colour, square) {
  const sink = SEATING_SINK;
  const out = SEATING_OUT_M;
  const metal = new THREE.Color(0x3a3d40), top = new THREE.Color(0xd8d2c4), chair = new THREE.Color(0x4a3a2c);
  const box = (a0, a1, o0, o1, y0, y1, c) => {
    const p = (a, o, y) => frame(a, o, y);
    awningQuad(sink, [p(a0, o0, y1), p(a1, o0, y1), p(a1, o1, y1), p(a0, o1, y1)], [c]);
    awningQuad(sink, [p(a0, o0, y0), p(a1, o0, y0), p(a1, o0, y1), p(a0, o0, y1)], [c]);
    awningQuad(sink, [p(a1, o1, y0), p(a0, o1, y0), p(a0, o1, y1), p(a1, o1, y1)], [c]);
    awningQuad(sink, [p(a0, o1, y0), p(a0, o0, y0), p(a0, o0, y1), p(a0, o1, y1)], [c]);
    awningQuad(sink, [p(a1, o0, y0), p(a1, o1, y0), p(a1, o1, y1), p(a1, o0, y1)], [c]);
  };
  // The table: a top on a post; two chairs either side of it along the wall.
  box(along - 0.36, along + 0.36, out - 0.36, out + 0.36, 0.72, 0.75, top);
  box(along - 0.03, along + 0.03, out - 0.03, out + 0.03, 0, 0.72, metal);
  for (const s of [-1, 1]) {
    box(along + s * 0.62 - 0.21, along + s * 0.62 + 0.21, out - 0.21, out + 0.21, 0.44, 0.47, chair);
    box(along + s * 0.81 - 0.02, along + s * 0.81 + 0.02, out - 0.21, out + 0.21, 0.47, 0.9, chair);
  }
  // The umbrella: its pole through the table and a canopy of eight panels (four for a square one).
  box(along - 0.02, along + 0.02, out - 0.02, out + 0.02, 0.75, 2.45, metal);
  const sides = square ? 4 : 8, r = square ? 1.25 : 1.15, rim = 2.05, apex = 2.5;
  // One face: the awnings' material is two-sided, and lit from beneath it is the darker.
  for (let k = 0; k < sides; k += 1) {
    const t0 = (k / sides) * Math.PI * 2 + (square ? Math.PI / 4 : 0), t1 = ((k + 1) / sides) * Math.PI * 2 + (square ? Math.PI / 4 : 0);
    const c0 = frame(along + Math.cos(t0) * r, out + Math.sin(t0) * r, rim);
    const c1 = frame(along + Math.cos(t1) * r, out + Math.sin(t1) * r, rim);
    const tip = frame(along, out, apex);
    awningQuad(sink, [c0, c1, tip, tip], [k % 2 ? colour : colour.clone().multiplyScalar(0.92)]);
  }
}

function cleanName(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function buildingNameTrade(feature) {
  if (TRADE_TYPE[feature.archetype]) return feature.archetype;
  if (feature.archetype === "generic") return "office";
  return "shop";
}

function addBuildingNamePlaque(group, feature, seed, height, tint) {
  if(typeof storeExteriorFor==="function" && storeExteriorFor(feature))return;
  const name = feature.name;
  if (!name || height < 4.8) return;
  const clean = cleanName(name);
  if (!clean) return;
  const shops = feature.shops || [];
  if (shops.some((shop) => cleanName(shop.n) === clean)) return;
  const wall = (hasStorefront(feature) ? storefrontWall(feature) : null)
    || bestFacadeWall(feature, false) || bestFacadeWall(feature, true);
  if (!wall || wall.span < 5.0) return;

  const trade = buildingNameTrade(feature);
  const colour = awningColour(tint).multiplyScalar(0.58);
  const slot = signSlot(name, trade, inkFor(colour));
  const boardH = Math.min(0.86, Math.max(0.50, height * 0.055));
  const signH = Math.max(0.30, boardH - 0.18);
  const boardW = Math.min(wall.span - 0.7, Math.max(3.0, signH * slot.aspect + 0.42));
  if (!(boardW > 2.4)) return;
  const signW = Math.min(boardW - 0.32, signH * slot.aspect);
  const bottom = Math.min(height - boardH - 0.25, Math.max(3.05, Math.min(5.5, height * 0.38)));
  if (!(bottom > 1.5)) return;

  const sink = awningSink("board");
  const corner = (along, y, out = 0.16) => {
    const point = wallPoint(wall, along, out);
    return [point.x, y, point.z];
  };
  awningQuad(sink, [
    corner(-boardW / 2, bottom),
    corner(boardW / 2, bottom),
    corner(boardW / 2, bottom + boardH),
    corner(-boardW / 2, bottom + boardH),
  ], [colour]);
  const signBottom = bottom + (boardH - signH) / 2;
  addSignFace(slot.atlas, [
    corner(-signW / 2, signBottom, 0.19),
    corner(signW / 2, signBottom, 0.19),
    corner(signW / 2, signBottom + signH, 0.19),
    corner(-signW / 2, signBottom + signH, 0.19),
  ], slot);
}

function emitShopfronts() {
  for (const kind of Object.keys(AWNING_SINKS)) {
    const mesh = flushSink(AWNING_SINKS[kind], awningMaterial(kind), `awning:${kind}`);
    if (mesh) groups.mapped3d.add(mesh);
  }
  const seating = flushSink(SEATING_SINK, awningMaterial("seating"), "street_cafe");
  if (seating) groups.mapped3d.add(seating);
  for (const [index, sink] of SIGN_SINKS) {
    const mesh = flushSink(sink, signMaterial(signAtlases[index]), "sign");
    if (mesh) groups.mapped3d.add(mesh);
  }
}

//: The building's garages that stand on this wall: their centre along it and their width.
function garagesOnWall(feature, wall) {
  const tx = Math.cos(wall.yaw), tz = -Math.sin(wall.yaw);
  const out = [];
  for (const g of feature.garages || []) {
    const [ax, ay] = xy(g.a[0], g.a[1]), [bx, by] = xy(g.b[0], g.b[1]);
    if (!(Math.hypot(bx - ax, by - ay) > 0.5)) continue;
    const gx = ax + (bx - ax) * g.t, gz = -(ay + (by - ay) * g.t);
    const off = (gx - wall.x) * wall.nx + (gz - wall.z) * wall.nz;
    if (Math.abs(off) > 1.0) continue;
    const along = (gx - wall.x) * tx + (gz - wall.z) * tz;
    if (Math.abs(along) > wall.span / 2 + 0.5) continue;
    out.push({ along, w: g.w || 2.6, ref: g });
  }
  return out;
}

function addGroundFacadeDetail(group, feature, seed, height, tint) {
  if(typeof storeExteriorFor==="function" && storeExteriorFor(feature))return;
  // Never place an extra invented front door/shop backdrop on a reviewed photo front, nor on a
  // front a person drew themselves (its doors and shopfronts are theirs).
  if(frontageFitFor(feature) || feature.exteriorEdit)return;
  // A building with businesses in it, or of a business's kind, gets its storefronts; a house
  // gets its door.
  if (hasStorefront(feature)) {
    addStorefronts(group, feature, seed, height, tint);
    return;
  }
  const residential = feature.archetype === "residential" || feature.archetype === "generic";
  if (!residential) return;
  // Every house has a front door. It stands on the wall the garage is on when there is one --
  // the street side, where San Francisco's doors sit beside their garages -- otherwise on the
  // house's best street wall, and on another wall if that one has no room. It is never under a
  // garage: the door used simply to give way to one, and a house with a garage, which is most
  // of them, was left with no door at all.
  const spot = frontDoorSpot(feature);
  if (!spot) return;
  const { wall, along } = spot;
  // The entry picture is a door a third of its width: a 3.2 m panel is a 1.05 m door.
  const panelW = 3.2;
  const panelH = Math.min(3.35, height - 0.3);
  const anchor = wallPoint(wall, along, 0.11);
  planePart(group, anchor.x, 0.06, anchor.z, panelW, panelH,
            entryTextureFor(seed, feature.archetype), wall.yaw);
  feature._frontDoor = { x: anchor.x, z: anchor.z, yaw: wall.yaw, nx: wall.nx, nz: wall.nz };
}

//: How far a wall's outward side is from the nearest street centreline it faces (Infinity when
//: no street within 60 m lies in front of it).
function streetDistanceFacing(wall) {
  if (!junctionVertexGrid) indexJunctionVertices();
  let best = Infinity;
  const cx = Math.floor(wall.x / JUNCTION_CELL_M), cz = Math.floor(wall.z / JUNCTION_CELL_M);
  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dz = -3; dz <= 3; dz += 1) {
      for (const v of junctionVertexGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        if (v.i + 1 >= v.pts.length) continue;
        const [bx, bz] = v.pts[v.i + 1];
        const d = Math.sqrt(distanceToSegmentSquared(wall.x, wall.z, v.x, v.z, bx, bz));
        if (d >= best || d > 60) continue;
        // In front of the wall, not behind it.
        const px = (v.x + bx) / 2 - wall.x, pz = (v.z + bz) / 2 - wall.z;
        if (px * wall.nx + pz * wall.nz <= 0) continue;
        best = d;
      }
    }
  }
  return best;
}

//: Clear wall either side of a door and between a door and a garage.
const DOOR_CLEAR_M = 0.35;
const DOOR_LEAF_M = 1.05;
//: Whether the next building stands against a wall (a party wall): another footprint 0.15 m
//: outside it -- the probe the window rule keeps windows off with (homeWindowLayout) -- at its
//: middle or a third of the way either side. Both houses of a touching pair keep it solid.
function partyWall(feature, wall) {
  return [-1 / 3, 0, 1 / 3].some((t) => {
    const p = wallPoint(wall, t * wall.span, 0.15), other = buildingAt(p.x, p.z);
    return other && other !== feature;
  });
}
//: Where a house's front door goes: a wall and a position along it, clear of every garage. A
//: party wall never has it while the house has any other wall long enough.
function frontDoorSpot(feature) {
  const long = footprintWalls(feature.points).filter((w) => w.span >= DOOR_LEAF_M + 2 * DOOR_CLEAR_M);
  const open = long.filter((w) => !partyWall(feature, w));
  const walls = open.length ? open : long;
  if (!walls.length) return null;
  const garageWall = walls.map((w) => ({ w, g: garagesOnWall(feature, w) }))
    .filter((r) => r.g.length).sort((a, b) => b.g.length - a.g.length)[0];
  // The street side: walls that face a street, nearest street first. A wall against the
  // next building (a party wall) or facing away from every street is not where a door goes.
  const facing = walls.map((w) => ({ w, d: streetDistanceFacing(w) }))
    .filter((r) => r.d < Infinity && !buildingAt(r.w.x + r.w.nx * 1.0, r.w.z + r.w.nz * 1.0))
    .sort((a, b) => a.d - b.d).map((r) => r.w);
  const order = [];
  if (garageWall) order.push(garageWall.w);
  order.push(...facing);
  const best = bestFacadeWall(feature, true);
  if (best && (walls !== open || !partyWall(feature, best))) order.push(best);
  order.push(...walls);
  for (const wall of order) {
    const garages = garagesOnWall(feature, wall);
    const free = (u) => Math.abs(u) <= wall.span / 2 - DOOR_LEAF_M / 2 - DOOR_CLEAR_M
      && garages.every((g) => Math.abs(u - g.along) >= g.w / 2 + DOOR_LEAF_M / 2 + DOOR_CLEAR_M);
    // Beside the garage first (the side with more wall), then out from the middle.
    const candidates = [];
    for (const g of garages) {
      const gap = g.w / 2 + DOOR_LEAF_M / 2 + DOOR_CLEAR_M;
      candidates.push(g.along + gap, g.along - gap);
    }
    for (let step = 0; step <= wall.span / 2; step += 0.25) candidates.push(step, -step);
    const u = candidates.find(free);
    if (u !== undefined) return { wall, along: u };
  }
  return null;
}

