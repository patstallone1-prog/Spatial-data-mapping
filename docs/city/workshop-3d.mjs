import { VEHICLE_DIMS, vehicleMaterials, FLEET_FOR } from "./vehicles.mjs";
import { buildUnderbody } from "./workshop-underbody.mjs";

//: The model a car is drawn as on the lift: the fleet's full-detail model nearest its kind (the
//: traffic's kit cars are low in detail; one car at a time can be the full one).
export function bayModel(model) {
  if (FLEET_FOR[model]) return model;
  return { pickup: "suv", delivery_van: "suv", sedan: "economy", taxi: "economy", compact_ev: "economy" }[model] || model;
}

// All service points are in the vehicle's local frame. Kerbside vehicles face -Z.
export function serviceGeometry(model) {
  const [w, h, l] = VEHICLE_DIMS[model] || VEHICLE_DIMS.sedan;
  return {
    wing: [-w * 0.51, h * 0.5, -l * 0.32],
    rail: [-w * 0.47, h * 0.61, -l * 0.39],
    sill: [-w * 0.51, h * 0.29, -l * 0.19],
    arch: [-w * 0.52, h * 0.48, -l * 0.27],
    ground: [-w * 0.29, h * 0.56, -l * 0.29],
    lug: [-w * 0.15, h * 0.6, -l * 0.29],
    socket: [w * 0.18, h * 0.57, -l * 0.33],
    coil: [w * 0.13, h * 0.6, -l * 0.31],
    load: [w * 0.24, h * 0.6, -l * 0.33],
  };
}

export function workshopScene(T, host, order, colour, makeCar, onSelect, onHover = () => {}) {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x263943);
  host.append(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(39, 1, 0.025, 60);
  scene.fog = new T.FogExp2(0x263943, 0.041);
  scene.add(new T.HemisphereLight(0xfff0cf, 0x8ca3af, 2.5));
  const key = new T.DirectionalLight(0xfff7dc, 3.2);
  key.position.set(-3, 7, -4);
  scene.add(key);
  const fill = new T.DirectionalLight(0xb4d7eb, 1.8);
  fill.position.set(4, 4, 2);
  scene.add(fill);
  const owned = new Set(),
    disposable = (x) => (owned.add(x), x);
  const mat = (color, metalness = 0.15) =>
    disposable(new T.MeshStandardMaterial({ color, metalness, roughness: 0.53 }));
  const steel = mat(0x70818a, 0.7),
    rubber = mat(0x222b31),
    brass = mat(0xe2ae55, 0.65),
    blue = mat(0x366b7a),
    red = mat(0xa44843);
  const mesh = (parent, geometry, material, x, y, z) => {
    const m = new T.Mesh(disposable(geometry), material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const box = (parent, x, y, z, w, h, l, m) => mesh(parent, new T.BoxGeometry(w, h, l), m, x, y, z);
  const shown = bayModel(order.model);
  const LIFT_LOW = 0.72, LIFT_HIGH = 1.62;
  let lift = LIFT_LOW, liftGoal = LIFT_LOW;
  const [w, h, l] = VEHICLE_DIMS[shown] || VEHICLE_DIMS.sedan;
  box(scene, 0, -0.09, 0, 18, 0.18, 18, mat(0x516066));
  const grid = new T.GridHelper(18, 18, 0x667479, 0x59686d);
  scene.add(grid);
  owned.add(grid.geometry);
  owned.add(grid.material);
  // The two-post lift: its arms and pads ride up with the car (raised to work underneath).
  const carriage = new T.Group();
  scene.add(carriage);
  for (const side of [-1, 1]) {
    box(scene, side * (w * 0.5 + 0.66), 1.48, 0.7, 0.22, 2.96, 0.32, blue);
    box(scene, side * (w * 0.5 + 0.66), 0.09, 0.7, 0.6, 0.18, 0.72, rubber);
    // The carriage on the post, and its two swing arms out to the jacking points under the sill
    // (the underside left open to see, as a two-post lift leaves it).
    const armY = Math.max(0.15, Math.min(0.26, h * 0.16)) - 0.075;
    box(carriage, side * (w * 0.5 + 0.55), armY, 0.7, 0.2, 0.16, 0.3, steel);
    for (const z of [-l * 0.3 + 0.42, l * 0.3 - 0.42]) {
      const from = new T.Vector3(side * (w * 0.5 + 0.5), armY, 0.7), to = new T.Vector3(side * w * 0.44, armY, z);
      const arm = box(carriage, 0, 0, 0, 0.1, 0.07, from.distanceTo(to), steel);
      arm.position.copy(from).lerp(to, 0.5);
      arm.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      mesh(carriage, new T.CylinderGeometry(0.06, 0.06, 0.05, 20), rubber, to.x, armY + 0.055, to.z);
      mesh(carriage, new T.CylinderGeometry(0.05, 0.05, 0.03, 16), brass, to.x, armY + 0.025, to.z);
    }
  }
  carriage.position.y = lift;
  const root = new T.Group();
  root.position.y = lift;
  scene.add(root);
  const car = makeCar(shown, colour, order.shade);
  root.add(car);
  // The underside, in detail: one car at a time is drawn here (workshop-underbody.mjs).
  buildUnderbody(T, root, { dims: [w, h, l], model: shown, own: disposable });
  const loc = serviceGeometry(shown),
    point = (id) => new T.Vector3(...loc[id]);
  const power = order.fault !== "fender",
    bay = new T.Group();
  root.add(bay);
  // The removable wing or bonnet inspection cutaway is clipped out of the actual city body.
  // Clone surface materials so viewing this car never changes the traffic renderer's materials.
  const planes = power
    ? [
        new T.Plane(new T.Vector3(0, 0, 1), l * 0.205),
        new T.Plane(new T.Vector3(0, 0, -1), -l * 0.475),
        new T.Plane(new T.Vector3(0, -1, 0), lift + h * 0.42),
        new T.Plane(new T.Vector3(1, 0, 0), -w * 0.4),
        new T.Plane(new T.Vector3(-1, 0, 0), -w * 0.4),
      ]
    : [
        new T.Plane(new T.Vector3(1, 0, 0), w * 0.39),
        new T.Plane(new T.Vector3(0, 0, 1), l * 0.18),
        new T.Plane(new T.Vector3(0, 0, -1), -l * 0.46),
        new T.Plane(new T.Vector3(0, -1, 0), lift + h * 0.32),
      ];
  const originals = new Map();
  function cutaway() {
    if (!order.active && order.verified) return;
    car.traverse((o) => {
      if (!o.isMesh || originals.has(o)) return;
      const original = o.material;
      originals.set(o, original);
      const m = disposable(original.clone());
      m.onBeforeCompile = original.onBeforeCompile;
      m.customProgramCacheKey = original.customProgramCacheKey.bind(original);
      m.clippingPlanes = planes;
      m.clipIntersection = true;
      o.material = m;
    });
  }
  const cable = (a, b, m) => {
    const v = b.clone().sub(a),
      tube = mesh(bay, new T.CylinderGeometry(0.014, 0.014, v.length(), 10), m, 0, 0, 0);
    tube.position.copy(a).lerp(b, 0.5);
    tube.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v.normalize());
    return tube;
  };
  const leads = {};
  const replacement = new T.Group();
  bay.add(replacement);
  if (power) {
    box(bay, 0, h * 0.43, -l * 0.34, w * 0.77, 0.075, l * 0.23, steel);
    box(bay, -w * 0.16, h * 0.49, -l * 0.31, w * 0.23, h * 0.17, l * 0.12, rubber);
    box(bay, w * 0.18, h * 0.49, -l * 0.33, w * 0.19, h * 0.1, l * 0.11, blue);
    if (order.fault === "ground") {
      const a = point("ground"),
        b = point("lug");
      cable(a, a.clone().lerp(b, 0.36), rubber);
      cable(a.clone().lerp(b, 0.65), b, rubber);
    } else cable(point("ground"), point("lug"), rubber);
    for (const [id, material] of [
      ["coil", red],
      ["load", brass],
    ]) {
      const pin = point(id),
        harness = pin.clone().add(new T.Vector3(0.03, -0.03, 0.23));
      cable(harness, harness.clone().lerp(pin, 0.68), material);
      leads[id] = cable(harness.clone().lerp(pin, 0.68), pin, material);
    }
    if (order.fault === "ground") {
      const strap = box(replacement, -w * 0.22, h * 0.585, -l * 0.29, w * 0.15, 0.023, 0.044, brass);
      strap.rotation.z = 0.12;
    } else box(replacement, ...loc.socket, 0.13, 0.1, 0.12, rubber);
  } else {
    const outline = new T.Shape();
    outline.moveTo(-0.52, 0);
    outline.lineTo(-0.52, 0.35);
    outline.quadraticCurveTo(0, 0.5, 0.52, 0.34);
    outline.lineTo(0.52, 0);
    outline.lineTo(0.36, 0);
    outline.quadraticCurveTo(0.02, 0.56, -0.36, 0);
    outline.closePath();
    const panel = mesh(
      replacement,
      new T.ExtrudeGeometry(outline, { depth: 0.035, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 }),
      mat(colour, 0.5),
      -w * 0.51,
      h * 0.34,
      -l * 0.32,
    );
    panel.rotation.y = Math.PI / 2;
    panel.scale.set(l * 0.27, h * 0.65, 1);
  }
  const targets = [],
    fasteners = {},
    markers = {};
  for (const [id, coords] of Object.entries(loc)) {
    const m = mat(0x77bab4, 0.65);
    const bolt = mesh(bay, new T.CylinderGeometry(0.032, 0.032, 0.035, 6), m, ...coords);
    fasteners[id] = bolt;
    const washer = mesh(bay, new T.TorusGeometry(0.033, 0.006, 6, 18), steel, ...coords);
    washer.rotation.x = -Math.PI / 2;
    washer.position.y -= 0.017;
    if (id === "coil" || id === "load") {
      box(bay, coords[0], coords[1] - 0.016, coords[2], 0.065, 0.035, 0.078, rubber);
      box(bay, coords[0], coords[1], coords[2] - 0.022, 0.012, 0.018, 0.036, brass);
    }
    const ring = mesh(bay, new T.TorusGeometry(0.058, 0.008, 8, 28), m, ...coords);
    ring.rotation.x = -Math.PI / 2;
    bolt.userData.site = ring.userData.site = id;
    targets.push(bolt, ring);
    markers[id] = m;
  }
  let selected = null,
    angle = -0.72,
    pitch = 0.52,
    radius = l * 1.38,
    drag = null,
    frame = 0,
    animation = 0,
    mounted = false,
    pulse = 0;
  const focus = new T.Vector3(0, lift + h * 0.5, -l * 0.13),
    goal = focus.clone();
  const tool = new T.Group();
  bay.add(tool);
  mesh(tool, new T.CylinderGeometry(0.032, 0.032, 0.06, 12), steel, 0, 0, 0);
  box(tool, 0, 0.035, 0.105, 0.029, 0.023, 0.22, steel);
  box(tool, 0, 0.036, 0.225, 0.046, 0.039, 0.12, rubber);
  const jaws = new T.Group();
  bay.add(jaws);
  for (const side of [-1, 1]) {
    const grip = box(jaws, side * 0.032, 0.025, 0.115, 0.022, 0.028, 0.16, blue);
    grip.rotation.y = side * 0.21;
    box(jaws, side * 0.012, 0.024, 0.008, 0.013, 0.018, 0.078, steel);
  }
  let workedSite = null,
    previousMounts = new Set(order.mounts);
  tool.visible = false;
  function select(id, zoom = false) {
    if (!loc[id]) return;
    selected = id;
    if (zoom) {
      goal.copy(point(id));
      goal.y += lift;
      radius = power ? 1.75 : 2.4;
    }
    onSelect(id);
  }
  function resize() {
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
    camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  canvas.onpointerdown = (e) => {
    drag = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drag) {
      const r = canvas.getBoundingClientRect(),
        ray = new T.Raycaster();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      ray.setFromCamera({ x: (2 * x) / r.width - 1, y: 1 - (2 * y) / r.height }, camera);
      const id = ray.intersectObjects(targets, false)[0]?.object.userData.site;
      onHover(id, x, y);
      canvas.style.cursor = id ? "pointer" : "grab";
      return;
    }
    angle -= (e.clientX - drag.x) * 0.008;
    pitch = Math.min(1.44, Math.max(-1.38, pitch + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX;
    drag.y = e.clientY;
  };
  canvas.onpointerleave = () => onHover(null);
  canvas.onpointercancel = () => {
    drag = null;
  };
  canvas.onpointerup = (e) => {
    if (drag && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) {
      const r = canvas.getBoundingClientRect(),
        ray = new T.Raycaster();
      ray.setFromCamera(
        { x: (2 * (e.clientX - r.left)) / r.width - 1, y: 1 - (2 * (e.clientY - r.top)) / r.height },
        camera,
      );
      const hit = ray.intersectObjects(targets, false)[0];
      if (hit) select(hit.object.userData.site);
    }
    drag = null;
  };
  canvas.onwheel = (e) => {
    e.preventDefault();
    radius = Math.min(l * 2, Math.max(0.6, radius * Math.exp(e.deltaY * 0.001)));
  };
  function update(o) {
    workedSite = o.mounts.find((id) => !previousMounts.has(id)) || null;
    previousMounts = new Set(o.mounts);
    order = o;
    if (!o.active && o.verified) {
      for (const [mesh, original] of originals) mesh.material = original;
      bay.visible = false;
      goal.set(0, lift + h * 0.5, -l * 0.13);
      radius = l * 1.38;
    }
    for (const [id, lead] of Object.entries(leads)) lead.visible = o.fault !== "relay" || o.mounts.includes(id);
    if (order.seated && !mounted) {
      animation = performance.now();
      mounted = true;
    }
    pulse = performance.now();
  }
  function draw(now) {
    frame = requestAnimationFrame(draw);
    cutaway();
    if (Math.abs(lift - liftGoal) > 1e-3) {
      const was = lift;
      lift += Math.sign(liftGoal - lift) * Math.min(Math.abs(liftGoal - lift), 0.012);
      root.position.y = carriage.position.y = lift;
      // (The cutaway's planes are in the world: they rise with the car.)
      for (const p of planes) if (p.normal.y < -0.5) p.constant = lift + h * (power ? 0.42 : 0.32);
      goal.y += lift - was; focus.y += lift - was;
    }
    focus.lerp(goal, 0.09);
    camera.position.set(
      focus.x + Math.sin(angle) * Math.cos(pitch) * radius,
      Math.max(0.08, focus.y + Math.sin(pitch) * radius),
      focus.z - Math.cos(angle) * Math.cos(pitch) * radius,
    );
    camera.lookAt(focus);
    replacement.visible = order.seated;
    const t = Math.max(0, 1 - (now - animation) / 650);
    replacement.position.set(power ? 0 : -t * 0.6, power ? t * 0.5 : 0, 0);
    for (const id of Object.keys(markers))
      markers[id].color.setHex(order.mounts.includes(id) ? 0x62c48a : id === selected ? 0xffcc65 : 0x77bab4);
    const motion = Math.min(1, Math.max(0, (now - pulse) / 750));
    const gripping = ["lug", "arch", "coil", "load"].includes(workedSite);
    tool.visible = Boolean(workedSite && motion < 1 && !gripping);
    jaws.visible = Boolean(workedSite && motion < 1 && gripping);
    if (workedSite) {
      const hand = gripping ? jaws : tool;
      hand.position.copy(point(workedSite));
      hand.position.y += 0.05 + (1 - motion) * 0.04;
      hand.rotation.y = Math.sin(motion * Math.PI * 5) * 0.48;
      if (gripping) jaws.scale.x = 0.8 + 0.3 * Math.cos(motion * Math.PI * 4);
      const bolt = fasteners[workedSite];
      bolt.rotation.y = motion * Math.PI * 3;
      bolt.position.y = loc[workedSite][1] + (1 - motion) * 0.035;
    }
    renderer.render(scene, camera);
  }
  update(order);
  draw(performance.now());
  //: The ways to look at the car: [name, what it shows, the lift raised?, focus, angle, pitch, radius].
  const VIEWS = {
    overview: { lift: LIFT_LOW, at: [0, h * 0.5, -l * 0.13], angle: -0.72, pitch: 0.52, radius: l * 1.38 },
    front: { lift: LIFT_LOW, at: [0, h * 0.5, -l * 0.3], angle: -0.12, pitch: 0.38, radius: l * 0.95 },
    left: { lift: LIFT_LOW, at: [-w * 0.45, h * 0.45, -l * 0.28], angle: -1.45, pitch: 0.22, radius: 1.9 },
    engine: { lift: LIFT_LOW, at: [0, h * 0.58, -l * 0.33], angle: -0.25, pitch: 1.05, radius: 1.7 },
    under: { lift: LIFT_HIGH, at: [0, 0.25, -l * 0.05], angle: -0.55, pitch: -0.62, radius: l * 0.72 },
    rear: { lift: LIFT_LOW, at: [0, h * 0.45, l * 0.25], angle: Math.PI - 0.5, pitch: 0.42, radius: l * 1.1 },
  };
  function view(name) {
    const v = VIEWS[name] || VIEWS.overview;
    liftGoal = v.lift;
    goal.set(v.at[0], lift + v.at[1], v.at[2]);   // (the lift carries the goal with it as it rises)
    angle = v.angle; pitch = v.pitch; radius = v.radius;
  }
  const scratch = new T.Vector3();
  return {
    select,
    update,
    view,
    underbody() { view("under"); },
    overview() { view("overview"); },
    //: Where marker ``id`` is on the screen (pixels in the host), and whether it is in front of the camera.
    project(id) {
      if (!loc[id]) return null;
      scratch.copy(point(id)).applyMatrix4(root.matrixWorld).project(camera);
      return { x: (scratch.x + 1) / 2 * host.clientWidth, y: (1 - scratch.y) / 2 * host.clientHeight, front: scratch.z < 1 };
    },
    //: The part being fitted, seen arriving (for a drop on the car).
    get shown() { return shown; },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      const shared = vehicleMaterials(T);
      for (const [m, original] of originals) {
        m.material = original;
        if (original !== shared.fixed && original !== shared.glass && original !== shared.paint) original.dispose();
        if (m.isInstancedMesh) m.dispose();
      }
      car.traverse((m) => {
        if (!m.isMesh || originals.has(m)) return;
        if (m.material !== shared.fixed && m.material !== shared.glass && m.material !== shared.paint)
          m.material.dispose();
        if (m.isInstancedMesh) m.dispose();
      });
      car.userData.bayDisposed = true;
      for (const obj of owned) obj.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
