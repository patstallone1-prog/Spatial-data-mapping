// The city's vehicles, built in code: each kind's body from its side profile, the glass round its
// cabin (seen through: the seats, the dashboard and the wheel are inside), pillars and roof,
// lights, mirrors, a grille, and wheels with rims. One model's parts are three geometries:
//   paint  -- the bodywork, white, coloured per car by the instance colour;
//   glass  -- the windows, drawn see-through;
//   fixed  -- everything with a colour of its own (tyres, rims, trim, lights, the interior),
//             coloured by vertex.
// Front is -z, right is +x, the ground is y = 0 (the page's convention for its cars). The driver
// sits on the left, as in the United States.

//: Width, height and length (metres) of each kind: the same as the city's rules on the road.
export const VEHICLE_DIMS = {
  economy: [1.76, 1.45, 4.1], compact_ev: [1.8, 1.55, 4.3], sedan: [1.85, 1.45, 4.8], suv: [1.95, 1.75, 4.9], pickup: [2.0, 1.9, 5.6],
  delivery_van: [2.0, 2.55, 5.9], box_truck: [2.45, 3.3, 7.4], taxi: [1.85, 1.5, 4.7], bus: [2.6, 3.15, 12.2], patrol: [1.9, 1.55, 5.0],
};
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
