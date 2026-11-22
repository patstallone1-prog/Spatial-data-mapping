// The underside of the one car on the lift (workshop-3d.mjs): what a mechanic sees from the pit.
// Only one car is drawn at a time, so it is built in detail: the floor and its tunnel, both
// subframes, the arms and their bushings, the steering rack and tie rods, brake discs, calipers and
// their hoses, springs and dampers, the anti-roll bar and its drop links, the sump and gearbox (or
// an electric car's battery and its orange high-voltage cables), the exhaust from the manifold to
// the tailpipe on rubber hangers under its heat shields, the fuel tank on its straps, the brake and
// fuel lines clipped along the tunnel, the wheel-speed sensors' loom, and the jacking points.
//
// The car's frame: front at -z, wheels on y = 0, metres; ``dims`` is [width, height, length].

export function buildUnderbody(T, root, { dims, model, own }) {
  const [w, h, l] = dims;
  const mat = (color, metalness = 0.2, roughness = 0.55, extra = {}) => own(new T.MeshStandardMaterial({ color, metalness, roughness, ...extra }));
  const M = {
    pan: mat(0x2b3034, 0.25, 0.8),
    steel: mat(0x7b8790, 0.75, 0.38),
    dark: mat(0x3b4247, 0.6, 0.5),
    rubber: mat(0x1b1f22, 0, 0.9),
    alloy: mat(0xb9c1c6, 0.85, 0.3),
    rust: mat(0x6e4b35, 0.5, 0.7),
    exhaust: mat(0x5a4c44, 0.7, 0.55),
    shield: mat(0xd7dade, 0.95, 0.22),
    disc: mat(0x8d9296, 0.9, 0.35),
    caliper: mat(0xa8322c, 0.4, 0.45),
    copper: mat(0xb87333, 0.8, 0.35),
    loom: mat(0x15181a, 0, 0.75),
    plug: mat(0xe2a532, 0.2, 0.5),
    hv: mat(0xe8661f, 0.1, 0.5),
    battery: mat(0x40474d, 0.5, 0.55),
    plastic: mat(0x26292b, 0, 0.85),
  };
  const g = new T.Group();
  g.name = "bay-underbody";
  root.add(g);
  const mesh = (geo, m, x = 0, y = 0, z = 0, parent = g) => { const o = new T.Mesh(own(geo), m); o.position.set(x, y, z); parent.add(o); return o; };
  const box = (x, y, z, sx, sy, sz, m) => mesh(new T.BoxGeometry(sx, sy, sz), m, x, y, z);
  const cyl = (r, len, m, seg = 20) => new T.CylinderGeometry(r, r, len, seg);
  //: A tube from a to b (each [x, y, z]): a rod, a pipe, an arm.
  function rod(a, b, r, m, seg = 14) {
    const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A);
    const o = mesh(cyl(r, d.length(), m, seg), m);
    o.position.copy(A).lerp(B, 0.5);
    o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    return o;
  }
  //: A bent pipe or a cable through ``points``.
  function bent(points, r, m, radial = 12) {
    const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)));
    return mesh(new T.TubeGeometry(curve, Math.max(40, points.length * 16), r, radial, false), m);
  }
  //: A rubber bushing (an eye) at p, its axis along ``axis``.
  function bushing(p, axis = "x", r = 0.028) {
    const o = mesh(new T.CylinderGeometry(r, r, 0.05, 18), M.rubber, ...p);
    if (axis === "x") o.rotation.z = Math.PI / 2; else if (axis === "z") o.rotation.x = Math.PI / 2;
    const sleeve = mesh(new T.CylinderGeometry(r * 0.45, r * 0.45, 0.056, 12), M.steel, ...p);
    sleeve.rotation.copy(o.rotation);
    return o;
  }
  const hex = (p, r = 0.012, m = M.alloy) => { const o = mesh(new T.CylinderGeometry(r, r, 0.012, 6), m, ...p); return o; };
  const ev = model === "compact_ev";
  const rwd = model === "sports" || model === "suv" || model === "pickup" || model === "delivery_van" || model === "box_truck";
  const floorY = Math.max(0.15, Math.min(0.26, h * 0.16));
  const track = w * 0.42, hubY = Math.max(0.26, Math.min(0.42, h * 0.22));
  const front = -l * 0.3, rear = l * 0.3;

  // ---- the floor, its tunnel and the sills --------------------------------------------------------
  box(0, floorY + 0.03, 0, w * 0.82, 0.02, l * 0.66, M.pan);
  const tunnel = mesh(new T.CylinderGeometry(0.13, 0.13, l * 0.56, 28, 1, true, Math.PI / 2, Math.PI), M.pan, 0, floorY + 0.02, l * 0.02);
  tunnel.rotation.x = Math.PI / 2; tunnel.rotation.z = Math.PI; tunnel.material.side = T.DoubleSide;
  for (const s of [-1, 1]) {
    box(s * w * 0.44, floorY + 0.02, 0, 0.09, 0.07, l * 0.56, M.pan);
    // Pressed ribs across the floor pan, and the jacking points under each sill.
    for (let i = -3; i <= 3; i += 1) box(s * w * 0.22, floorY + 0.016, i * l * 0.075, w * 0.26, 0.012, 0.025, M.pan);
    for (const z of [front + 0.42, rear - 0.42]) { box(s * w * 0.44, floorY - 0.025, z, 0.1, 0.02, 0.12, M.dark); box(s * w * 0.44, floorY - 0.04, z, 0.02, 0.02, 0.1, M.steel); }
  }
  // Longitudinal rails from front to rear, under the floor.
  for (const s of [-1, 1]) bent([[s * w * 0.31, floorY + 0.1, front - 0.25], [s * w * 0.31, floorY - 0.01, front + 0.25], [s * w * 0.3, floorY - 0.01, rear - 0.25], [s * w * 0.31, floorY + 0.1, rear + 0.2]], 0.035, M.dark, 8);

  // ---- the front: subframe, arms, steering, brakes, springs ---------------------------------------
  const sub = floorY - 0.02;
  rod([-w * 0.3, sub, front - 0.2], [w * 0.3, sub, front - 0.2], 0.03, M.dark, 8);
  rod([-w * 0.3, sub, front + 0.2], [w * 0.3, sub, front + 0.2], 0.03, M.dark, 8);
  for (const s of [-1, 1]) {
    rod([s * w * 0.3, sub, front - 0.2], [s * w * 0.3, sub, front + 0.2], 0.03, M.dark, 8);
    // Lower arm: a wishbone from two bushings on the subframe to the ball joint at the hub.
    const ball = [s * (track - 0.08), hubY - 0.13, front];
    bushing([s * w * 0.28, sub, front - 0.14]); bushing([s * w * 0.28, sub, front + 0.14]);
    rod([s * w * 0.28, sub, front - 0.14], ball, 0.017, M.steel); rod([s * w * 0.28, sub, front + 0.14], ball, 0.017, M.steel);
    mesh(new T.SphereGeometry(0.024, 14, 10), M.dark, ...ball);
    // The knuckle, the disc, the caliper and its hose.
    rod(ball, [s * (track - 0.09), hubY + 0.12, front], 0.02, M.rust);
    const disc = mesh(new T.CylinderGeometry(0.15, 0.15, 0.024, 40), M.disc, s * (track - 0.04), hubY, front); disc.rotation.z = Math.PI / 2;
    const hat = mesh(new T.CylinderGeometry(0.07, 0.07, 0.04, 24), M.disc, s * (track - 0.025), hubY, front); hat.rotation.z = Math.PI / 2;
    const cal = box(s * (track - 0.06), hubY + 0.06, front + 0.11, 0.06, 0.09, 0.07, M.caliper); cal.rotation.x = -0.5;
    bent([[s * (track - 0.07), hubY + 0.1, front + 0.13], [s * (track - 0.16), hubY + 0.2, front + 0.2], [s * w * 0.34, floorY + 0.12, front + 0.3]], 0.006, M.rubber, 8);
    // Strut: the damper body, the coil around it, the top mount.
    rod([s * (track - 0.1), hubY + 0.08, front + 0.02], [s * (track - 0.16), hubY + 0.52, front + 0.04], 0.03, M.dark);
    const coil = [];
    for (let i = 0; i <= 120; i += 1) { const a = i * 0.42, k = i / 120; coil.push([s * (track - 0.1 - 0.06 * k) + 0.058 * Math.cos(a), hubY + 0.2 + k * 0.28, front + 0.03 + 0.058 * Math.sin(a)]); }
    bent(coil, 0.009, M.steel, 8);
    // Tie rod from the rack to the steering arm, its boot, the rack's clamp.
    rod([s * w * 0.18, hubY + 0.02, front + 0.1], [s * (track - 0.1), hubY + 0.02, front + 0.12], 0.011, M.steel);
    const boot = mesh(new T.LatheGeometry(Array.from({ length: 13 }, (_, i) => new T.Vector2(0.025 + 0.008 * (1 + Math.cos(i * Math.PI / 2)), (i - 6) * 0.008)), 24), M.rubber, s * w * 0.2, hubY + 0.02, front + 0.1);
    boot.rotation.z = Math.PI / 2;
    // Half-shaft and its two CV boots.
    if (!rwd || model === "suv") {
      rod([s * 0.12, hubY, front], [s * (track - 0.08), hubY, front], 0.018, M.steel);
      for (const x of [s * 0.17, s * (track - 0.13)]) { const cv = mesh(new T.LatheGeometry(Array.from({ length: 17 }, (_, i) => new T.Vector2(0.032 + 0.011 * (1 + Math.cos(i * Math.PI / 2)), (i - 8) * 0.006)), 28), M.rubber, x, hubY, front); cv.rotation.z = Math.PI / 2; }
    }
    // The wheel-speed sensor and its lead along the arm to the body.
    box(s * (track - 0.07), hubY - 0.04, front - 0.09, 0.022, 0.03, 0.022, M.plastic);
    bent([[s * (track - 0.07), hubY - 0.03, front - 0.1], [s * (track - 0.2), hubY + 0.05, front - 0.12], [s * w * 0.32, floorY + 0.06, front - 0.05], [s * w * 0.28, floorY + 0.03, front + 0.4]], 0.004, M.loom, 6);
  }
  rod([-w * 0.2, hubY + 0.02, front + 0.1], [w * 0.2, hubY + 0.02, front + 0.1], 0.024, M.alloy);   // the rack
  // Anti-roll bar across, its bushings and the drop links up to the struts.
  bent([[-track + 0.12, hubY + 0.05, front - 0.12], [-w * 0.3, sub + 0.02, front - 0.08], [w * 0.3, sub + 0.02, front - 0.08], [track - 0.12, hubY + 0.05, front - 0.12]], 0.015, M.dark, 10);
  for (const s of [-1, 1]) { bushing([s * w * 0.22, sub + 0.03, front - 0.08], "x", 0.022); rod([s * (track - 0.12), hubY + 0.05, front - 0.12], [s * (track - 0.13), hubY + 0.22, front - 0.04], 0.008, M.steel); }

  // ---- the power: engine sump and gearbox, or the battery and its cables ---------------------------
  if (ev) {
    const pack = box(0, floorY - 0.045, l * 0.02, w * 0.66, 0.08, l * 0.46, M.battery);
    pack.name = "battery";
    for (let i = -4; i <= 4; i += 1) for (const s of [-1, 1]) hex([s * w * 0.32, floorY - 0.088, l * 0.02 + i * l * 0.05], 0.011);
    for (let i = -3; i <= 3; i += 1) box(0, floorY - 0.087, l * 0.02 + i * l * 0.06, w * 0.6, 0.006, 0.02, M.dark);
    // The motor and inverter at the front, the orange high-voltage cables back to the pack.
    const motor = mesh(new T.CylinderGeometry(0.12, 0.12, w * 0.32, 28), M.alloy, 0, hubY + 0.02, front + 0.05); motor.rotation.z = Math.PI / 2;
    box(0.1, hubY + 0.13, front - 0.08, 0.26, 0.12, 0.22, M.alloy);
    for (const dx of [-0.05, 0.05]) bent([[0.1 + dx, hubY + 0.08, front + 0.03], [0.1 + dx, floorY - 0.02, front + 0.35], [dx * 2, floorY - 0.04, l * 0.02 - l * 0.23]], 0.013, M.hv, 10);
  } else {
    // Sump with its drain plug, the bell housing and gearbox behind it.
    box(0, hubY - 0.02, front + 0.02, 0.36, 0.14, 0.32, M.alloy);
    for (let i = 0; i < 5; i += 1) box(0, hubY - 0.095, front - 0.11 + i * 0.065, 0.32, 0.008, 0.012, M.alloy);
    hex([0.08, hubY - 0.098, front + 0.12], 0.014, M.steel);
    box(0, floorY + 0.14, front - 0.22, 0.42, 0.24, 0.18, M.dark);   // the engine block's foot behind the radiator support
    const bell = mesh(new T.CylinderGeometry(0.15, 0.1, 0.2, 28), M.alloy, rwd ? 0 : -w * 0.15, hubY + 0.04, front + 0.3);
    bell.rotation.x = Math.PI / 2;
    box(rwd ? 0 : -w * 0.15, hubY - 0.01, front + 0.52, 0.2, 0.16, 0.3, M.alloy);
    // Oil filter, and a coolant hose from the front.
    const filter = mesh(new T.CylinderGeometry(0.04, 0.04, 0.1, 20), M.caliper, 0.2, hubY + 0.03, front - 0.02); filter.rotation.z = 0.6;
    bent([[-0.2, floorY + 0.2, front - 0.3], [-0.24, hubY + 0.06, front - 0.18], [-0.16, hubY + 0.04, front - 0.05]], 0.018, M.rubber, 10);
  }
  // A propeller shaft and the rear differential, for a car driven at the back.
  if (rwd && !ev) {
    rod([0, hubY - 0.02, front + 0.68], [0, hubY - 0.01, rear - 0.2], 0.032, M.steel, 18);
    for (const z of [front + 0.7, l * 0.02, rear - 0.22]) { const uj = mesh(new T.SphereGeometry(0.04, 16, 12), M.dark, 0, hubY - 0.015, z); uj.scale.z = 0.7; }
    box(0, floorY + 0.01, l * 0.02, 0.12, 0.05, 0.08, M.rubber);   // centre bearing
    const diff = mesh(new T.SphereGeometry(0.12, 28, 20), M.alloy, 0, hubY, rear); diff.scale.set(1.1, 0.9, 1);
    for (const s of [-1, 1]) rod([s * 0.1, hubY, rear], [s * (track - 0.08), hubY, rear], 0.02, M.steel);
  }

  // ---- the exhaust: down the tunnel to the back on rubber hangers --------------------------------
  if (!ev) {
    const ex = -0.06, y0 = floorY - 0.02;
    const path = [[ex, hubY + 0.15, front - 0.15], [ex, hubY - 0.04, front + 0.2], [ex, y0, front + 0.6], [ex, y0, l * 0.0], [ex, y0, rear - 0.6], [w * 0.22, y0, rear - 0.25], [w * 0.28, y0, rear + 0.32]];
    bent(path, 0.026, M.exhaust, 14);
    const cat = mesh(new T.CylinderGeometry(0.065, 0.065, 0.32, 28), M.exhaust, ex, y0 + 0.005, front + 0.82); cat.rotation.x = Math.PI / 2;
    const res = mesh(new T.CylinderGeometry(0.05, 0.05, 0.26, 24), M.exhaust, ex, y0, l * 0.08); res.rotation.x = Math.PI / 2;
    const muffler = mesh(new T.CapsuleGeometry(0.09, 0.3, 8, 24), M.exhaust, w * 0.2, y0 + 0.01, rear + 0.05); muffler.rotation.z = Math.PI / 2; muffler.scale.set(1, 1, 0.75);
    const tip = mesh(new T.CylinderGeometry(0.035, 0.035, 0.1, 20, 1, true), M.alloy, w * 0.28, y0, rear + 0.37); tip.rotation.x = Math.PI / 2; tip.material.side = T.DoubleSide;
    // Heat shields over the hot parts, and the rubber hangers the pipe hangs from.
    for (const [z, len] of [[front + 0.82, 0.46], [l * 0.08, 0.4], [rear + 0.05, 0.36]]) {
      const shield = mesh(new T.CylinderGeometry(0.1, 0.1, len, 28, 1, true, Math.PI * 0.15, Math.PI * 0.7), M.shield, z > rear - 0.1 ? w * 0.2 : ex, y0 + 0.03, z);
      shield.rotation.x = Math.PI / 2; shield.material.side = T.DoubleSide;
    }
    for (const [x, z] of [[ex, front + 1.05], [ex, l * 0.2], [w * 0.2, rear - 0.12], [w * 0.28, rear + 0.24]]) {
      rod([x, y0 + 0.02, z], [x, floorY + 0.03, z], 0.004, M.steel);
      const hanger = mesh(new T.TorusGeometry(0.018, 0.008, 8, 18), M.rubber, x, y0 + 0.045, z); hanger.rotation.y = Math.PI / 2;
    }
    // The fuel tank on its two straps in front of the rear axle, and its filler neck to the side.
    const tank = box(-w * 0.12, floorY - 0.03, rear - 0.55, w * 0.5, 0.14, 0.46, M.plastic);
    tank.name = "fuel-tank";
    for (const dz of [-0.14, 0.14]) box(-w * 0.12, floorY - 0.105, rear - 0.55 + dz, w * 0.52, 0.006, 0.035, M.steel);
    bent([[-w * 0.3, floorY + 0.0, rear - 0.5], [-w * 0.4, floorY + 0.15, rear - 0.3], [-w * 0.46, floorY + 0.3, rear - 0.2]], 0.02, M.rubber, 10);
  }

  // ---- the rear: a twist beam, or a subframe with arms ---------------------------------------------
  if (model === "economy" || model === "taxi" || model === "compact_ev" || model === "sedan") {
    rod([-track + 0.12, hubY - 0.02, rear], [track - 0.12, hubY - 0.02, rear], 0.04, M.dark, 18);
    for (const s of [-1, 1]) { rod([s * (track - 0.12), hubY - 0.02, rear], [s * w * 0.33, floorY + 0.02, rear - 0.42], 0.035, M.dark); bushing([s * w * 0.33, floorY + 0.02, rear - 0.42], "x", 0.034); }
  } else {
    rod([-w * 0.3, sub, rear - 0.18], [w * 0.3, sub, rear - 0.18], 0.03, M.dark, 8);
    rod([-w * 0.3, sub, rear + 0.18], [w * 0.3, sub, rear + 0.18], 0.03, M.dark, 8);
    for (const s of [-1, 1]) {
      for (const dz of [-0.14, 0.14]) { bushing([s * w * 0.27, sub, rear + dz]); rod([s * w * 0.27, sub, rear + dz], [s * (track - 0.09), hubY - 0.1, rear + dz * 0.3], 0.015, M.steel); }
      rod([s * w * 0.27, sub + 0.08, rear - 0.05], [s * (track - 0.09), hubY + 0.1, rear - 0.02], 0.012, M.steel);
    }
  }
  for (const s of [-1, 1]) {
    const disc = mesh(new T.CylinderGeometry(0.135, 0.135, 0.02, 40), M.disc, s * (track - 0.04), hubY, rear); disc.rotation.z = Math.PI / 2;
    box(s * (track - 0.06), hubY + 0.07, rear - 0.1, 0.05, 0.08, 0.06, M.caliper);
    rod([s * (track - 0.12), hubY - 0.04, rear + 0.06], [s * (track - 0.16), hubY + 0.42, rear + 0.08], 0.026, M.dark);   // damper
    const coil = [];
    for (let i = 0; i <= 100; i += 1) { const a = i * 0.45, k = i / 100; coil.push([s * (track - 0.24) + 0.055 * Math.cos(a), floorY - 0.0 + k * 0.17, rear - 0.05 + 0.055 * Math.sin(a)]); }
    bent(coil, 0.009, M.steel, 8);
    bent([[s * (track - 0.06), hubY + 0.1, rear - 0.12], [s * (track - 0.15), hubY + 0.18, rear - 0.25], [s * w * 0.32, floorY + 0.08, rear - 0.35]], 0.006, M.rubber, 8);
  }

  // ---- lines along the tunnel: brake (steel), fuel (copper-coloured), the loom; their clips --------
  for (const [dx, r, m] of [[0.17, 0.0055, M.steel], [0.195, 0.0055, M.steel], [0.22, 0.007, M.copper], [0.25, 0.011, M.loom]]) {
    bent([[dx, floorY + 0.06, front + 0.3], [dx + 0.02, floorY + 0.005, front + 0.5], [dx, floorY + 0.005, l * 0.05], [dx - 0.02, floorY + 0.005, rear - 0.7], [dx + 0.06, floorY + 0.04, rear - 0.35]], r, m, 8);
  }
  for (let i = -4; i <= 3; i += 1) box(0.21, floorY + 0.012, l * 0.05 + i * l * 0.07, 0.11, 0.01, 0.018, M.plastic);
  for (const z of [front + 0.6, l * 0.02, rear - 0.6]) box(0.26, floorY - 0.004, z, 0.03, 0.022, 0.04, M.plug);   // the loom's connectors
  // A front splash shield (black plastic) with its clips, behind the bumper.
  box(0, floorY - 0.04, front - 0.55, w * 0.62, 0.012, 0.36, M.plastic);
  for (let i = -2; i <= 2; i += 1) hex([i * w * 0.13, floorY - 0.048, front - 0.4], 0.009, M.plastic);
  return g;
}
