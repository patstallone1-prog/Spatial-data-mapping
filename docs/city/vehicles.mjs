// The city's vehicles, built in code: each kind's body from its side profile, the glass round its
// cabin (seen through: the seats, the dashboard and the wheel are inside), pillars and roof,
// lights, mirrors, a grille, and wheels with rims. One model's parts are three geometries:
//   paint  -- the bodywork, white, coloured per car by the instance colour;
//   glass  -- the windows, drawn see-through;
//   fixed  -- everything with a colour of its own (tyres, rims, trim, lights, the interior),
//             coloured by vertex.
// Front is -z, right is +x, the ground is y = 0 (the page's convention for its cars). The driver
// sits on the left, as in the United States.

//: The imported fleet (scripts/build_city_fleet.mjs from the user's Unreal fleet pack; the files in
//: docs/city/models/fleet, their record in fleet.json): which kinds it draws, and each model's
//: own size -- width, height (to the top of its aerial or rails) and length, in metres, as
//: measured from the model once turned and set on its wheels. The bus is the pack's 9 m midibus
//: drawn as a Muni 40-footer (12.2 m by 2.59: the build stretches its body, not its wheels).
export const FLEET_FOR = { economy: "cuore", suv: "jeep", sports: "porsche", box_truck: "truck", bus: "bus" };
export const FLEET_DIMS = {
  cuore: [1.854, 1.608, 3.64], jeep: [1.94, 1.93, 4.23], porsche: [1.901, 1.37, 4.52], truck: [2.293, 3.073, 7.101], bus: [2.59, 3.1, 12.2],
};
//: Width, height and length (metres) of each kind: the city's rules on the road, the kerb space
//: a car takes, and what it is drawn as. A kind the fleet draws is that model's own size; the
//: others are a common car of the kind (makers' figures, body without mirrors): a Chevrolet Bolt
//: (compact EV), a Toyota Camry (sedan), a Ford F-150 SuperCrew with the 5.5 ft bed (pickup), a
//: Ford Transit 148" high roof (delivery van), a Toyota Prius (taxi), a Ford Police Interceptor
//: sedan (patrol) -- the Kenney Car Kit's bodies are stretched to them.
export const VEHICLE_DIMS = {
  economy: FLEET_DIMS.cuore, compact_ev: [1.77, 1.6, 4.15], sedan: [1.84, 1.45, 4.92], suv: FLEET_DIMS.jeep, pickup: [2.03, 1.96, 5.89],
  delivery_van: [2.06, 2.78, 5.98], box_truck: FLEET_DIMS.truck, taxi: [1.78, 1.43, 4.6], bus: FLEET_DIMS.bus, patrol: [1.94, 1.55, 5.15],
  sports: FLEET_DIMS.porsche,
};
//: The fleet's file for a kind at a tier: "npc" (the traffic nearest you: the pack's LOD1, the
//: Porsche cut to 15,000 triangles from its 200,000) or "full" (the one you drive or ride:
//: everything, the inside included). Null for a kind the fleet does not draw.
export function fleetFile(kind, tier = "npc") {
  const id = FLEET_FOR[kind];
  return id ? `city/models/fleet/${id}-${tier === "full" ? "full" : "npc"}.glb` : null;
}
//: Each car's shape along its length, as fractions of the length from the front (0) to the back
//: (1): where the windscreen starts (a) and meets the roof (b), where the roof ends (c) and the
//: back window meets the body (d); the bonnet's and the boot's heights, and the waist (belt) --
//: as fractions of the height.
const SHAPES = {
  economy: { a: 0.27, b: 0.43, c: 0.78, d: 0.93, hood: 0.56, boot: 0.6, belt: 0.62, hatch: true },
  compact_ev: { a: 0.24, b: 0.42, c: 0.8, d: 0.95, hood: 0.52, boot: 0.6, belt: 0.6, hatch: true },
  sedan: { a: 0.3, b: 0.45, c: 0.7, d: 0.83, hood: 0.58, boot: 0.62, belt: 0.64 },
  taxi: { a: 0.3, b: 0.45, c: 0.7, d: 0.83, hood: 0.58, boot: 0.62, belt: 0.64, sign: true },
  patrol: { a: 0.3, b: 0.45, c: 0.71, d: 0.84, hood: 0.58, boot: 0.62, belt: 0.63, lightbar: true },
  suv: { a: 0.25, b: 0.38, c: 0.9, d: 0.97, hood: 0.6, boot: 0.6, belt: 0.6, hatch: true },
  pickup: { a: 0.27, b: 0.37, c: 0.55, d: 0.58, hood: 0.6, boot: 0.55, belt: 0.58, bed: true },
  sports: { a: 0.3, b: 0.48, c: 0.66, d: 0.92, hood: 0.5, boot: 0.62, belt: 0.6, hatch: true },
};
const C = {
  tyre: [0.07, 0.07, 0.08], rim: [0.72, 0.74, 0.77], trim: [0.1, 0.1, 0.11], grille: [0.16, 0.17, 0.18],
  head: [0.97, 0.96, 0.9], tail: [0.72, 0.08, 0.06], seat: [0.22, 0.23, 0.25], dash: [0.12, 0.12, 0.13],
  wheel: [0.08, 0.08, 0.09], floor: [0.18, 0.18, 0.19], sign: [0.98, 0.84, 0.2], blue: [0.15, 0.35, 0.85], red: [0.85, 0.12, 0.1],
  white: [1, 1, 1], bed: [0.2, 0.2, 0.21], pole: [0.75, 0.75, 0.72],
};

//: The three part geometries of one kind (cached per THREE and kind).
const cache = new WeakMap();
export function vehicleParts(THREE, model) {
  if (!cache.has(THREE)) cache.set(THREE, new Map());
  const store = cache.get(THREE);
  const kind = VEHICLE_DIMS[model] ? model : "sedan";
  if (!store.has(kind)) store.set(kind, build(THREE, kind));
  return store.get(kind);
}
//: A whole vehicle as one group of three meshes (your own car, a parked one): `colour` paints it.
export function vehicleGroup(THREE, model, colour, { glassOpacity = 0.42 } = {}) {
  const parts = vehicleParts(THREE, model), m = vehicleMaterials(THREE);
  const g = new THREE.Group();
  const paint = new THREE.Mesh(parts.paint, new THREE.MeshStandardMaterial({ color: colour, metalness: 0.45, roughness: 0.38, vertexColors: true }));
  const glass = new THREE.Mesh(parts.glass, glassOpacity === m.glass.opacity ? m.glass : m.glass.clone());
  glass.material.opacity = glassOpacity;
  const fixed = new THREE.Mesh(parts.fixed, m.fixed);
  for (const o of [paint, glass, fixed]) { o.castShadow = o !== glass; o.receiveShadow = true; }
  g.add(paint, fixed, glass);
  return g;
}
//: The shared materials: the paint is per instance (instance colour over white vertices).
const materialCache = new WeakMap();
export function vehicleMaterials(THREE) {
  if (!materialCache.has(THREE)) {
    materialCache.set(THREE, {
      paint: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38, vertexColors: true }),
      glass: new THREE.MeshStandardMaterial({ color: 0x1d2a33, metalness: 0.6, roughness: 0.08, transparent: true, opacity: 0.42, depthWrite: false }),
      fixed: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.7, vertexColors: true }),
    });
  }
  return materialCache.get(THREE);
}

function build(THREE, kind) {
  const [w, h, l] = VEHICLE_DIMS[kind];
  const out = { paint: [], glass: [], fixed: [] };
  const add = (slot, geometry, colour = C.white) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    out[slot].push({ p: p.array.slice(0, p.count * 3), n: n.array.slice(0, n.count * 3), c: colour, count: p.count });
    geometry.dispose(); if (g !== geometry) g.dispose();
  };
  const box = (slot, bw, bh, bd, x, y, z, colour, rotX = 0, rotY = 0) => {
    const g = new THREE.BoxGeometry(bw, bh, bd);
    if (rotX) g.rotateX(rotX);
    if (rotY) g.rotateY(rotY);
    g.translate(x, y, z); add(slot, g, colour);
  };
  //: A side profile (points [z, y], z from the front -l/2 back) extruded across `width`.
  const profile = (slot, pts, width, colour = C.white, bevel = 0.04) => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.02, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
    g.rotateY(Math.PI / 2); g.translate(-(width - bevel * 2) / 2, 0, 0);
    add(slot, g, colour);
  };
  //: A bar from (z0, y0) to (z1, y1) at side x: a pillar.
  const bar = (slot, x, z0, y0, z1, y1, thick, colour = C.white) => {
    const len = Math.hypot(z1 - z0, y1 - y0);
    box(slot, thick, len, thick * 1.4, x, (y0 + y1) / 2, (z0 + z1) / 2, colour, Math.atan2(z1 - z0, y1 - y0));
  };
  const L = l / 2, r = kind === "bus" || kind === "box_truck" ? 0.5 : kind === "delivery_van" || kind === "pickup" ? 0.4 : 0.33;
  const wheelsAt = (front, back) => {
    for (const z of [front, back]) for (const s of [-1, 1]) {
      const tyre = new THREE.CylinderGeometry(r, r, 0.24, 18).rotateZ(Math.PI / 2).translate(s * (w / 2 - 0.1), r, z);
      add("fixed", tyre, C.tyre);
      const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.25, 12).rotateZ(Math.PI / 2).translate(s * (w / 2 - 0.095), r, z);
      add("fixed", rim, C.rim);
    }
  };
  const lights = (yHead, yTail, inset = 0.32) => {
    for (const s of [-1, 1]) {
      box("fixed", 0.34, 0.12, 0.06, s * w * inset, yHead, -L + 0.02, C.head);
      box("fixed", 0.3, 0.14, 0.06, s * w * inset, yTail, L - 0.02, C.tail);
    }
  };
  const seat = (x, z, y, sw = 0.5) => {
    box("fixed", sw, 0.14, 0.5, x, y, z, C.seat);                       // cushion
    box("fixed", sw, 0.6, 0.12, x, y + 0.34, z + 0.27, C.seat, -0.18);  // back
    box("fixed", sw * 0.6, 0.16, 0.1, x, y + 0.72, z + 0.33, C.seat);   // headrest
  };
  const steering = (x, y, z) => {
    const g = new THREE.TorusGeometry(0.18, 0.024, 6, 16).rotateX(-0.45).translate(x, y, z);
    add("fixed", g, C.wheel);
    box("fixed", 0.05, 0.05, 0.3, x, y - 0.06, z - 0.12, C.wheel, 0.5);
  };

  if (SHAPES[kind]) {
    const S = SHAPES[kind], at = (f) => -L + f * l;
    const clear = r * 0.95, belt = h * S.belt, hood = h * S.hood, boot = h * S.boot;
    // The body below the windows: nose, bonnet, the waist under the glass, boot or hatch, tail.
    const body = S.bed
      ? [[-L, clear + 0.15], [-L + 0.06, hood * 0.8], [-L + 0.25, hood], [at(S.a), belt], [at(S.d) + 0.1, belt], [at(S.d) + 0.1, hood * 0.62], [L, hood * 0.62], [L, clear + 0.1], [L - 0.2, clear], [-L + 0.2, clear]]
      : [[-L, clear + 0.15], [-L + 0.05, hood * 0.78], [-L + 0.3, hood], [at(S.a), belt * 0.98], [at(S.d), belt], ...(S.hatch ? [[L - 0.05, belt * 0.97]] : [[at(S.d) + 0.15, boot], [L - 0.1, boot]]), [L, boot * 0.75], [L, clear + 0.12], [L - 0.2, clear], [-L + 0.2, clear]];
    profile("paint", body, w);
    // The cabin's glass, a little inside the body, and the roof over it.
    const roof = h - 0.03;
    profile("glass", [[at(S.a) + 0.02, belt - 0.02], [at(S.b), roof - 0.02], [at(S.c), roof - 0.02], [at(S.d) - 0.02, belt - 0.02]], w * 0.9, C.white, 0);
    profile("paint", [[at(S.b) - 0.04, roof - 0.05], [at(S.b) + 0.02, roof + 0.03], [at(S.c) - 0.02, roof + 0.03], [at(S.c) + 0.04, roof - 0.05]], w * 0.9, C.white, 0.02);
    // Pillars: the windscreen's, the middle one and the back one, each side; and the mirrors.
    for (const s of [-1, 1]) {
      const x = s * w * 0.445;
      bar("paint", x, at(S.a), belt, at(S.b), roof, 0.07);
      bar("paint", x, (at(S.b) + at(S.c)) / 2, belt, (at(S.b) + at(S.c)) / 2, roof, 0.08);
      bar("paint", x, at(S.c), roof, at(S.d), belt, 0.1);
      box("paint", 0.18, 0.12, 0.08, s * (w / 2 + 0.07), belt + 0.06, at(S.a) + 0.08);
      box("fixed", 0.03, 0.03, 0.03, s * (w / 2 + 0.1), belt + 0.06, at(S.a) + 0.12, C.trim);
    }
    // The grille, bumpers, lights.
    box("fixed", w * 0.5, 0.16, 0.05, 0, hood * 0.62, -L + 0.01, C.grille);
    box("fixed", w * 0.96, 0.12, 0.08, 0, clear + 0.12, -L + 0.03, C.trim);
    box("fixed", w * 0.96, 0.12, 0.08, 0, clear + 0.12, L - 0.03, C.trim);
    lights(hood * 0.78, (S.hatch ? belt : boot) * 0.82);
    // Inside: the floor, the dashboard and the wheel, two seats in front and a bench behind.
    const seatY = clear + 0.3, front = at(S.a) + Math.max(0.75, (at(S.b) - at(S.a)) * 1.6);
    box("fixed", w * 0.86, 0.05, at(S.d) - at(S.a), 0, clear + 0.08, (at(S.a) + at(S.d)) / 2, C.floor);
    box("fixed", w * 0.86, 0.18, 0.32, 0, belt - 0.03, at(S.a) + 0.28, C.dash);
    steering(-w * 0.22, belt + 0.05, at(S.a) + 0.5);
    seat(-w * 0.22, front, seatY); seat(w * 0.22, front, seatY);
    if (at(S.c) - front > 0.9) seat(0, front + 0.95, seatY, w * 0.74);
    if (S.bed) {
      // The bed: its floor and sides, open at the top.
      const z0 = at(S.d) + 0.12, depth = L - z0;
      box("fixed", w * 0.9, 0.05, depth, 0, hood * 0.35, z0 + depth / 2, C.bed);
      for (const s of [-1, 1]) box("paint", 0.06, hood * 0.3, depth, s * w * 0.46, hood * 0.62 + 0.0, z0 + depth / 2);
      box("paint", w * 0.92, hood * 0.3, 0.06, 0, hood * 0.62, L - 0.03);
    }
    if (S.sign) box("fixed", 0.7, 0.2, 0.25, 0, roof + 0.13, (at(S.b) + at(S.c)) / 2, C.sign);
    if (S.lightbar) { box("fixed", 0.55, 0.1, 0.24, -0.3, roof + 0.08, (at(S.b) + at(S.c)) / 2, C.red); box("fixed", 0.55, 0.1, 0.24, 0.3, roof + 0.08, (at(S.b) + at(S.c)) / 2, C.blue); }
    wheelsAt(-L + Math.min(0.95, l * 0.19), L - Math.min(0.95, l * 0.2));
  } else if (kind === "bus") {
    // A city bus: a long box on small wheels, a band of glass down each side and across the
    // front, doors, and rows of seats inside.
    const floor = 0.42, sill = 1.15, top = h - 0.12;
    box("paint", w, sill - floor, l, 0, (sill + floor) / 2, 0);
    box("paint", w, h - top, l, 0, (h + top) / 2, 0);
    box("glass", w - 0.04, top - sill, l - 0.04, 0, (top + sill) / 2, 0);
    for (let z = -L + 0.1; z <= L - 0.1; z += 1.3) for (const s of [-1, 1]) box("paint", 0.05, top - sill, 0.12, s * (w / 2 - 0.01), (top + sill) / 2, z);
    for (const zd of [-L + 1.4, 0.6]) box("fixed", 0.04, h - floor - 0.3, 1.1, w / 2 + 0.005, (h + floor) / 2 - 0.15, zd, C.trim);  // doors (kerb side)
    box("fixed", w * 0.98, 0.3, 0.04, 0, h - 0.3, -L - 0.01, C.trim);   // route sign
    box("fixed", w * 0.96, 0.12, 0.08, 0, floor + 0.05, -L + 0.03, C.trim);
    box("fixed", w * 0.9, 0.05, l - 0.3, 0, floor + 0.02, 0, C.floor);
    box("fixed", w * 0.5, 0.25, 0.4, -w * 0.2, sill - 0.05, -L + 0.4, C.dash);
    steering(-w * 0.25, sill + 0.05, -L + 0.75);
    seat(-w * 0.25, -L + 1.2, floor + 0.35, 0.5);
    for (let z = -L + 2.8; z < L - 0.8; z += 0.85) for (const s of [-1, 1]) seat(s * w * 0.27, z, floor + 0.35, 0.85);
    lights(floor + 0.3, floor + 0.4, 0.38);
    wheelsAt(-L + 2.6, L - 3.2);
  } else {
    // A van or a box truck: a cab with its windscreen and side windows, and behind it the van's
    // own body or the box.
    const van = kind === "delivery_van", floor = r * 1.1, cab = van ? 2.0 : 2.2;
    const capH = van ? h - 0.05 : 2.55;
    const cabFront = -L, cabBack = -L + cab;
    profile("paint", [[cabFront, floor], [cabFront, floor + 0.9], [cabFront + 0.35, floor + 1.0], [cabBack, floor + 1.0], [cabBack, floor]], w);
    profile("glass", [[cabFront + 0.37, floor + 0.98], [cabFront + 0.75, capH - 0.1], [cabBack - 0.05, capH - 0.1], [cabBack - 0.05, floor + 0.98]], w * 0.94, C.white, 0);
    box("paint", w * 0.96, 0.12, cab - 0.75, 0, capH - 0.05, cabBack - (cab - 0.75) / 2);
    for (const s of [-1, 1]) { bar("paint", s * w * 0.465, cabFront + 0.37, floor + 0.98, cabFront + 0.75, capH - 0.1, 0.08); bar("paint", s * w * 0.465, cabBack - 0.6, floor + 0.98, cabBack - 0.6, capH - 0.1, 0.08); box("paint", 0.2, 0.25, 0.08, s * (w / 2 + 0.1), floor + 1.3, cabFront + 0.55); }
    if (van) box("paint", w, h - floor, l - cab, 0, (h + floor) / 2, cabBack + (l - cab) / 2);
    else {
      box("fixed", w * 0.9, 0.2, l - cab, 0, floor + 0.05, cabBack + (l - cab) / 2, C.trim);                 // chassis
      box("paint", w, h - floor - 0.2, l - cab - 0.15, 0, (h + floor + 0.2) / 2, cabBack + 0.15 + (l - cab - 0.15) / 2);
    }
    box("fixed", w * 0.6, 0.3, 0.05, 0, floor + 0.55, -L - 0.01, C.grille);
    box("fixed", w * 0.96, 0.14, 0.1, 0, floor, -L + 0.04, C.trim);
    box("fixed", w * 0.9, 0.2, 0.32, 0, floor + 0.98, cabFront + 0.55, C.dash);
    steering(-w * 0.24, floor + 1.05, cabFront + 0.8);
    seat(-w * 0.24, cabFront + 1.35, floor + 0.45); seat(w * 0.24, cabFront + 1.35, floor + 0.45);
    lights(floor + 0.65, floor + 0.5, 0.36);
    wheelsAt(-L + 1.0, L - (van ? 1.1 : 1.6));
  }

  const result = {};
  for (const [slot, list] of Object.entries(out)) {
    const count = list.reduce((n, x) => n + x.count, 0);
    const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), colour = new Float32Array(count * 3);
    let k = 0;
    for (const x of list) {
      position.set(x.p, k * 3); normal.set(x.n, k * 3);
      for (let i = 0; i < x.count; i += 1) colour.set(x.c, (k + i) * 3);
      k += x.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(position, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colour, 3));
    g.computeBoundingSphere();
    result[slot] = g;
  }
  result.dims = [w, h, l];
  return result;
}

// ---- the Kenney Car Kit's cars (CC0, www.kenney.nl; docs/city/models/kenney/License.txt) ----------
//
// The traffic's bodies: Kenney's low-poly cars, each made one geometry (its body and wheels, in
// place), turned to face -z, and stretched to the city's own size for its kind (VEHICLE_DIMS: the
// kit's cars are toy-short). The body's own paint (the colour most of its body is) takes each
// car's colour; glass, lights, tyres and liveries (a taxi's yellow, a police car's) keep the
// kit's. The kinds the imported fleet draws (FLEET_FOR) take the kit's model only until the
// fleet's has loaded (the bus, which the kit has not, the code-built one), and the sports car the
// kit's sports sedan.

//: The kit's models for each kind (more than one: a car takes one by its number).
export const KENNEY_FOR = {
  economy: ["hatchback-sports", "sedan"], compact_ev: ["sedan-sports", "hatchback-sports"], sedan: ["sedan", "sedan-sports"], suv: ["suv", "suv-luxury"], sports: ["sedan-sports"],
  pickup: ["truck"], delivery_van: ["delivery", "van"], box_truck: ["garbage-truck"], taxi: ["taxi"], patrol: ["police"],
  ambulance: ["ambulance"], firetruck: ["firetruck"],
};
//: Liveried: their colours are theirs, not repainted.
export const KENNEY_LIVERY = new Set(["taxi", "police", "ambulance", "firetruck", "garbage-truck"]);
export const KENNEY_DEBRIS = ["debris-bumper", "debris-door", "debris-plate-a", "debris-plate-small-a", "debris-tire", "debris-spoiler-a", "debris-bolt"];

//: One kit model as a single geometry with a ``paintMask`` attribute (1 where the body's paint
//: is), and its texture. ``dims``: [width, height, length] to stretch it to (null: as it is).
export function kenneyGeometry(THREE, gltf, dims, name = "") {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const parts = [];
  let map = null;
  scene.traverse((o) => { if (o.isMesh) { parts.push(o); map ||= o.material?.map || null; } });
  // The paint: the commonest texel under the body's vertices.
  let pixels = null, pw = 0, ph = 0;
  const img = map?.image;
  if (img && globalThis.OffscreenCanvas) {
    try {
      pw = img.width; ph = img.height;
      const cv = new OffscreenCanvas(pw, ph), g = cv.getContext("2d");
      g.drawImage(img, 0, 0); pixels = g.getImageData(0, 0, pw, ph).data;
    } catch { pixels = null; }
  }
  const texel = (u, v) => {
    if (!pixels) return -1;
    const x = Math.min(pw - 1, Math.max(0, Math.floor((u - Math.floor(u)) * pw))), y = Math.min(ph - 1, Math.max(0, Math.floor((v - Math.floor(v)) * ph)));
    const i = (y * pw + x) * 4;
    return (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
  };
  const livery = KENNEY_LIVERY.has(name);
  let paint = -1;
  if (!livery) {
    const count = new Map();
    for (const o of parts) {
      if (!/body/i.test(o.name) || !o.geometry.attributes.uv) continue;
      const uv = o.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) { const k = texel(uv.getX(i), uv.getY(i)); count.set(k, (count.get(k) || 0) + 1); }
    }
    let best = 0;
    for (const [k, n] of count) if (n > best && k >= 0) { best = n; paint = k; }
  }
  const pos = [], nor = [], uvs = [], mask = [], index = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const o of parts) {
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const base = pos.length / 3, body = /body/i.test(o.name);
    nm.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < P.count; i += 1) {
      v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
      if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z); } else nor.push(0, 1, 0);
      const u = U ? U.getX(i) : 0, w = U ? U.getY(i) : 0;
      uvs.push(u, w);
      mask.push(body && paint >= 0 && texel(u, w) === paint ? 1 : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i += 1) index.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i += 1) index.push(base + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("paintMask", new THREE.Float32BufferAttribute(mask, 1));
  geo.setIndex(index);
  // The kit's cars face +z: turned to face -z, on the ground, centred, and stretched to size.
  geo.rotateY(Math.PI);
  geo.computeBoundingBox();
  const b = geo.boundingBox, size = new THREE.Vector3(), mid = new THREE.Vector3();
  b.getSize(size); b.getCenter(mid);
  geo.translate(-mid.x, -b.min.y, -mid.z);
  if (dims) geo.scale(dims[0] / size.x, dims[1] / size.y, dims[2] / size.z);
  geo.computeBoundingSphere();
  return { geometry: geo, map, livery };
}
//: The kit's material: its texture, the paint taking the instance colour (and only the paint).
export function kenneyMaterial(THREE, map) {
  const m = new THREE.MeshLambertMaterial({ map, color: 0xffffff });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float paintMask;\nvarying float vPaint;")
      .replace("#include <color_vertex>", "#include <color_vertex>\nvPaint = paintMask;\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = mix(vec3(1.0), instanceColor.xyz, paintMask);\n#endif");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vPaint;")
      .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), vPaint);");
  };
  m.customProgramCacheKey = () => "kenney-paint-v1";
  return m;
}

// ---- the imported fleet (scripts/build_city_fleet.mjs) ------------------------------------------
//
// Each file is a few meshes, already turned to face -z, centred and on the ground: ``body`` (a
// colour per vertex from each part's own material, and ``_paint`` 1 on the paintable bodywork),
// an atlas per photographic texture -- ``paint-atlas`` carrying the paint mask in its alpha --,
// and ``glass``. Each becomes one instanced part; the paint takes the car's colour, nothing else.

//: The parts of a loaded fleet model: [{ name, geometry, tint, glass, map }] (``tint``: takes the
//: car's colour). The geometry is in the model's frame (each node's transform applied: the
//: build's quantisation leaves a scale and an offset on every node).
export function fleetParts(THREE, gltf) {
  const scene = gltf.scene, out = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    // Quantised positions and normals (integers, KHR_mesh_quantization) as floats first: moved
    // in place, they would be clamped to the integers' range.
    const geometry = new THREE.BufferGeometry();
    for (const [key, a] of Object.entries(o.geometry.attributes)) {
      if (key !== "position" && key !== "normal") { geometry.setAttribute(key, a); continue; }
      const f = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i += 1) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
      geometry.setAttribute(key, new THREE.BufferAttribute(f, 3));
    }
    geometry.setIndex(o.geometry.index);
    geometry.applyMatrix4(o.matrixWorld);
    geometry.computeBoundingSphere(); geometry.computeBoundingBox();
    const name = o.material?.name || o.name, glass = name === "glass" || Boolean(o.material?.transparent);
    out.push({ name, geometry, glass, map: o.material?.map || null, colour: o.material?.color?.clone() || null, opacity: o.material?.opacity ?? 1,
      tint: name === "body" ? Boolean(geometry.attributes._paint) : name === "paint-atlas" });
  });
  return out;
}
//: A fleet part's material. ``standard``: the lit, shinier one (your own car, near the camera);
//: else Lambert, as the rest of the traffic is. The paint: on ``body`` the instance colour where
//: ``_paint`` is 1; on ``paint-atlas`` the texture's own shading (its brightness) in the instance
//: colour where its alpha says paint -- the pack's recipe, Lerp(atlas, colour x luminance, mask).
//: ``livery`` ({ glsl, key }: a GLSL ``vec3 liveryAt(vec3 p, vec3 paint)`` of the place on the
//: body) paints by place instead of in one colour: the bus's.
export function fleetMaterial(THREE, part, { standard = false, livery = null } = {}) {
  if (part.glass) {
    return new THREE.MeshStandardMaterial({ color: part.colour || 0x1d2a33, metalness: 0.6, roughness: 0.08, transparent: true, opacity: Math.min(0.55, part.opacity), depthWrite: false, side: THREE.DoubleSide });
  }
  const opts = { color: 0xffffff, map: part.map || null, vertexColors: Boolean(part.geometry.attributes.color) };
  const m = standard ? new THREE.MeshStandardMaterial({ ...opts, metalness: part.name === "body" ? 0.35 : 0.1, roughness: part.name === "body" ? 0.45 : 0.65 }) : new THREE.MeshLambertMaterial(opts);
  if (!part.tint) return m;
  const atlas = part.name === "paint-atlas";
  const plain = "vec3 liveryAt(vec3 p, vec3 paint) { return paint; }";
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", ["#include <common>", atlas ? "" : "attribute float _paint;", "varying vec3 vPaint;", "varying float vPaintW;", "varying vec3 vBodyPos;"].join("\n"))
      .replace("#include <color_vertex>", ["#include <color_vertex>", "vPaint = vec3(1.0);", "#ifdef USE_INSTANCING_COLOR", "vPaint = instanceColor.xyz;", "#endif", "vBodyPos = position;",
        ...(atlas ? ["vPaintW = 1.0;", "#ifdef USE_COLOR", "vColor = vec3(1.0);", "#endif"] : ["vPaintW = _paint;", "#if defined(USE_COLOR) && defined(USE_INSTANCING_COLOR)", "vColor.xyz = color.xyz;", "#endif"])].join("\n"));
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", ["#include <common>", "varying vec3 vPaint;", "varying float vPaintW;", "varying vec3 vBodyPos;", livery ? livery.glsl : plain].join("\n"))
      .replace(atlas ? "#include <map_fragment>" : "#include <color_fragment>", atlas
        ? ["#include <map_fragment>", "{",
          "  float w = sampledDiffuseColor.a;",
          "  float lum = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));",
          "  vec3 tinted = liveryAt(vBodyPos, vPaint) * clamp(lum / 0.72, 0.3, 1.18);",
          "  diffuseColor.rgb = mix(sampledDiffuseColor.rgb, tinted, w);",
          "  diffuseColor.a = 1.0;", "}"].join("\n")
        : ["#include <color_fragment>", "diffuseColor.rgb = mix(diffuseColor.rgb, liveryAt(vBodyPos, vPaint) * 0.92, vPaintW);"].join("\n"));
  };
  m.customProgramCacheKey = () => `fleet-paint-v1-${atlas ? "atlas" : "body"}-${livery?.key || "plain"}-${standard ? "std" : "lam"}`;
  return m;
}
