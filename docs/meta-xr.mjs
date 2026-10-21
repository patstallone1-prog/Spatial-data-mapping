// The headset version (docs/meta.html): Kerbside on a Meta Quest, in the headset's own view.
//
// It is the same city as the app, cut down to what a headset needs and can hold. You are always
// in first person, walking: the left stick walks, the right stick turns in steps, and you look
// round with your head. The light is always the same noon. You see a short way down the street
// -- the view ends in haze a couple of hundred metres off, as it does in other headset games --
// so only the few blocks round you are built and held, never the whole region. A long hop is a
// blink to black, not the map animation.
//
//   A  what you are looking at: the address of the house in the middle of your view, or the
//      street and its cross streets
//   B  the menu, at your side: search for a place (the headset's keyboard), go there or get
//      directions there, end the route, reset the view
//   X  in and out of houses (the door in front of you)
//   right trigger  presses a button on the menu, pointed at with the right controller
//
// The page (scripts/build_sf_corridor_3d.py, its META mode) supplies the world through `hooks`;
// this module owns the session, the controllers, the panels in front of you, and the memory
// governor that keeps the page inside its budget. The pure parts are exported for the tests.

const MiB = 1024 * 1024, GiB = 1024 * MiB;

//: How much is built and held round you. A 200 m square in full (100 m each way), rebuilt 45 m
//: ahead once you are within 55 m of its edge; a hop lands in a 160 m one first. 64 MiB of
//: cells and 32 MiB of the simple city: a tenth of the desktop app's. (A 300 m square was
//: three hundred draws an eye: a Quest 3 draws about a hundred at its frame rate.)
export const META_STREAM = { radius: 100, arrival: 80, keep: 55, lead: 45,
  cellBytes: 64 * MiB, cellConcurrency: 4, tileBytes: 32 * MiB };
//: How far you see: the near and far planes, and the haze the far edge fades into; `room`, how
//: near a room must be (with you indoors) to be drawn at all; `resolution`, the share of the
//: headset's own resolution drawn (the rest is filled in by the headset).
export const META_VIEW = { near: 0.1, far: 150, fogNear: 40, fogFar: 140, room: 25, resolution: 0.8 };
//: The memory the page may use, in bytes. It aims to stay under `aim` (4 GiB), sheds what it
//: holds above it, sheds everything it can above `emergency`, and `ceiling` (5 GiB) is the line
//: never crossed. `baseline` is what the browser itself takes before the page holds anything
//: (an allowance, not a measurement: the Quest browser does not report its own size to a page).
export const META_MEMORY = { aim: 4 * GiB, emergency: 4.5 * GiB, ceiling: 5 * GiB, restoreBelow: 3.2 * GiB,
  baseline: 0.9 * GiB, minRadius: 60, maxRadius: META_STREAM.radius, step: 0.8 };
//: Walking: metres a second at full stick, and with the left trigger held; the stick's dead
//: zone; snap turns of `snapDeg` once the right stick passes `snapAt`, re-armed under `release`.
export const META_WALK = { speed: 1.4, brisk: 3.2, dead: 0.18, snapDeg: 30, snapAt: 0.7, release: 0.35 };
//: Always this light: noon in San Francisco on the September equinox, clear.
export const META_NOON = "2026-09-22T12:00:00-07:00";
//: The xr-standard gamepad: the right controller's A and B, the left's X and Y, are buttons 4 and 5.
export const META_BUTTONS = { trigger: 0, squeeze: 1, a: 4, b: 5, x: 4, y: 5 };

//: What the governor does at `bytes` with the square at `radius` metres: shrink the square and
//: shed the caches over the aim; drop to the smallest square and shed everything over the
//: emergency line; grow back a step when well under the aim. {radius, shed, level}.
export function metaMemoryPlan(bytes, radius, M = META_MEMORY) {
  if (!(bytes >= 0)) return { radius, shed: null, level: "unknown" };
  // At its smallest and still over the line, what the page cannot let go of (the code of each
  // square built, which stays loaded) is let go the only way it can be: the page starts again
  // where you stand, behind the fade.
  if (bytes >= M.emergency && radius <= M.minRadius) return { radius, shed: "all", level: "reload" };
  if (bytes >= M.emergency) return { radius: M.minRadius, shed: "all", level: "emergency" };
  if (bytes >= M.aim) return { radius: Math.max(M.minRadius, Math.round(radius * M.step)), shed: "caches", level: "over" };
  if (bytes < M.restoreBelow && radius < M.maxRadius)
    return { radius: Math.min(M.maxRadius, Math.round(radius / M.step)), shed: null, level: "restore" };
  return { radius, shed: null, level: "ok" };
}

//: The walk for a frame: the left stick's (x, y) turned by the head's heading (`yaw`, radians,
//: 0 looking down -z), at `speed` m/s for `dt` seconds. Returns [dx, dz] in the page's metres.
export function stickWalk(x, y, yaw, speed, dt, W = META_WALK) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < W.dead) return [0, 0];
  const scale = Math.min(1, (magnitude - W.dead) / (1 - W.dead)) / magnitude;
  const sx = x * scale, sy = y * scale;            // stick forward is y < 0
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);  // forward
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);   // right
  const forward = -sy, right = sx;
  return [(fx * forward + rx * right) * speed * dt, (fz * forward + rz * right) * speed * dt];
}

//: A snap turn from the right stick's x: {turn (radians, 0 for none), armed}. Pushed past
//: `snapAt` it turns once; it must come back under `release` before it turns again.
export function snapTurn(x, armed, W = META_WALK) {
  if (armed && Math.abs(x) >= W.snapAt) return { turn: -Math.sign(x) * W.snapDeg * Math.PI / 180, armed: false };
  if (!armed && Math.abs(x) < W.release) return { turn: 0, armed: true };
  return { turn: 0, armed };
}

//: The headset's floor in the page: the reference space moved so its origin stands at the
//: walker's feet (x, y, z), turned by `yaw`. XRRigidTransform's position and orientation for
//: getOffsetReferenceSpace, which takes the inverse of where the origin goes.
export function rigOffset(x, y, z, yaw) {
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  // Rotate (-x, -y, -z) by -yaw about the vertical.
  const px = c * -x + s * -z, pz = -s * -x + c * -z;
  return { position: { x: px, y: -y, z: pz, w: 1 }, orientation: { x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) } };
}

//: The heading (radians about the vertical, 0 looking down -z) of a quaternion [x, y, z, w].
export function headingOf([qx, qy, qz, qw]) {
  // The view direction (0, 0, -1) turned by the quaternion, flattened.
  const dx = -2 * (qx * qz + qw * qy), dz = -(1 - 2 * (qx * qx + qy * qy));
  return Math.atan2(-dx, -dz);
}

// ---- the menu ---------------------------------------------------------------------------------
//
// One panel, drawn on a canvas, laid out in its own pixels. Rows are buttons: {id, label, y, h}.
//: The menu's canvas, in pixels; and its size in front of you, in metres.
export const MENU_PX = [900, 1200], MENU_M = [0.6, 0.8];
//: The rows of the menu for `state`: {query, results: [{label}], route, mode, status}.
export function menuRows(state) {
  const rows = [];
  let y = 120;
  const row = (id, label, h = 84, kind = "button") => { rows.push({ id, label, y, h, kind }); y += h + 14; };
  row("search", state.query ? `Search: ${state.query}` : "Search for a place or address", 96, "field");
  (state.results || []).slice(0, 5).forEach((place, i) => {
    rows.push({ id: `go:${i}`, label: place.label, y, h: 84, kind: "result", x0: 0, x1: 0.68 });
    rows.push({ id: `dir:${i}`, label: "Directions", y, h: 84, kind: "button", x0: 0.7, x1: 1 });
    y += 98;
  });
  y += 10;
  for (const mode of ["walk", "drive", "transit"])
    rows.push({ id: `mode:${mode}`, label: mode[0].toUpperCase() + mode.slice(1), y, h: 70, kind: state.mode === mode ? "on" : "off",
      x0: ["walk", "drive", "transit"].indexOf(mode) / 3, x1: (["walk", "drive", "transit"].indexOf(mode) + 1) / 3 - 0.02 });
  y += 84;
  if (state.route) row("end-route", "End route");
  row("reset", "Reset view");
  row("close", "Close menu (B)");
  return rows;
}
//: The row under the panel point (u, v) (0..1 across, 0..1 up, as a ray hit's uv gives it).
export function menuHit(rows, u, v) {
  const px = u * MENU_PX[0], py = (1 - v) * MENU_PX[1];
  for (const r of rows) {
    const x0 = (r.x0 ?? 0) * (MENU_PX[0] - 80) + 40, x1 = (r.x1 ?? 1) * (MENU_PX[0] - 80) + 40;
    if (py >= r.y && py <= r.y + r.h && px >= x0 && px <= x1) return r;
  }
  return null;
}

// ---- the session ------------------------------------------------------------------------------

export function createMetaXR({ THREE, renderer, scene, camera, hooks }) {
  const xr = renderer.xr;
  xr.enabled = true;
  xr.setReferenceSpaceType("local-floor");
  xr.setFoveation?.(1);
  xr.setFramebufferScaleFactor?.(META_VIEW.resolution);
  const state = { session: null, base: null, yaw: 0, armed: true, pressed: new Map(), menuOpen: false,
    query: "", results: [], mode: "walk", route: false, status: "", hover: null, info: null, infoUntil: 0,
    fade: 0, fadeTo: 0, lastMemoryAt: 0, memory: null, plan: null, planLog: [], overAtSmallest: 0, keyboard: false };

  // A panel: a canvas on a plane, drawn over the world (no depth test), always facing you.
  function panel(pixels, metres) {
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = pixels;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...metres),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    mesh.renderOrder = 1000;
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, canvas, ctx: canvas.getContext("2d"), texture };
  }
  const infoPanel = panel([900, 320], [0.72, 0.256]);
  const menu = panel(MENU_PX, MENU_M);
  const loading = panel([900, 260], [0.9, 0.26]);
  // The blink: a black shell round your head, faded in and out over a hop.
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
  shell.renderOrder = 1001; shell.visible = false; shell.frustumCulled = false; scene.add(shell);
  // The right controller's pointer, for the menu.
  const pointer = xr.getController(0), pointerB = xr.getController(1);
  const laserGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
  const laserMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false });
  for (const c of [pointer, pointerB]) {
    const laser = new THREE.Line(laserGeometry, laserMaterial);
    laser.scale.z = 2; laser.visible = false; laser.renderOrder = 1002; laser.name = "laser";
    c.add(laser); scene.add(c);
  }
  const raycaster = new THREE.Raycaster();
  //: What moves in the headset every frame: the panels, the blink and the pointers. The page
  //: brings the rest of its world's positions up to date only now and then (most of it never
  //: moves, and walking its thousands of objects every frame was a fifth of the frame), so these
  //: are brought up to date here, each frame.
  const movers = [infoPanel.mesh, menu.mesh, loading.mesh, shell, pointer, pointerB];
  const keepMoversPlaced = () => { for (const o of movers) o.updateMatrixWorld(true); };

  // The headset's keyboard: an ordinary text field, focused; what is typed is read from it.
  const field = document.createElement("input");
  field.type = "text"; field.autocomplete = "off"; field.setAttribute("aria-label", "Search for a place");
  field.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(field);
  field.addEventListener("input", () => { state.query = field.value; search(); });
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") { field.blur(); state.keyboard = false; } });
  field.addEventListener("blur", () => { state.keyboard = false; drawMenu(); });

  //: Every region's places load on the first search; a later answer for an older query is dropped.
  let searchTicket = 0;
  async function search() {
    const ticket = ++searchTicket, query = state.query.trim();
    const found = query ? await hooks.search(query) : [];
    if (ticket !== searchTicket) return;
    state.results = found.slice(0, 5);
    drawMenu();
  }
  //: Turn the floor so you face `yaw` (as the page's heading), wherever your head points now.
  function face(yaw) {
    if (!Number.isFinite(yaw)) return;
    if (state.session) { state.yaw += yaw - headPose().yaw; recentre(); }
    else hooks.heading?.(yaw, true);
  }

  // ---- drawing --------------------------------------------------------------------------------
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function fitText(ctx, text, width) {
    if (ctx.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
    return `${t}…`;
  }
  function drawInfo(lines) {
    const { ctx, canvas, texture } = infoPanel;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(15,20,28,.9)"; roundRect(ctx, 0, 0, canvas.width, canvas.height, 36); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "600 54px system-ui,sans-serif"; ctx.textBaseline = "top";
    ctx.fillText(fitText(ctx, lines[0] || "", canvas.width - 80), 40, 40);
    ctx.font = "400 38px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,.82)";
    lines.slice(1, 4).forEach((line, i) => ctx.fillText(fitText(ctx, line, canvas.width - 80), 40, 124 + i * 56));
    texture.needsUpdate = true;
  }
  function drawMenu() {
    const { ctx, canvas, texture } = menu;
    state.rows = menuRows(state);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(15,20,28,.92)"; roundRect(ctx, 0, 0, canvas.width, canvas.height, 40); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "700 56px system-ui,sans-serif"; ctx.textBaseline = "middle";
    ctx.fillText("Kerbside", 40, 64);
    if (state.status) { ctx.font = "400 30px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.fillText(fitText(ctx, state.status, canvas.width - 380), 340, 66); }
    for (const r of state.rows) {
      const x0 = (r.x0 ?? 0) * (canvas.width - 80) + 40, x1 = (r.x1 ?? 1) * (canvas.width - 80) + 40;
      const hover = state.hover === r.id;
      ctx.fillStyle = r.kind === "on" ? "#2563eb" : r.kind === "field" ? (state.keyboard ? "#1e3a8a" : "#253041")
        : hover ? "#3b4a61" : "#253041";
      roundRect(ctx, x0, r.y, x1 - x0, r.h, 22); ctx.fill();
      if (hover) { ctx.strokeStyle = "#93c5fd"; ctx.lineWidth = 4; ctx.stroke(); }
      ctx.fillStyle = "#fff"; ctx.font = `${r.kind === "result" ? 400 : 600} ${r.kind === "result" ? 34 : 38}px system-ui,sans-serif`;
      ctx.fillText(fitText(ctx, r.label, x1 - x0 - 48), x0 + 24, r.y + r.h / 2);
    }
    texture.needsUpdate = true;
  }
  function drawLoading(text) {
    const { ctx, canvas, texture } = loading;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(15,20,28,.92)"; roundRect(ctx, 0, 0, canvas.width, canvas.height, 36); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "600 52px system-ui,sans-serif"; ctx.textBaseline = "top";
    ctx.fillText("Kerbside", 40, 40);
    ctx.font = "400 34px system-ui,sans-serif"; ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.fillText(fitText(ctx, text || "Loading the streets round you…", canvas.width - 80), 40, 130);
    texture.needsUpdate = true;
  }

  // ---- placing things in front of you ----------------------------------------------------------
  const head = new THREE.Vector3(), headQ = new THREE.Quaternion(), ahead = new THREE.Vector3();
  function headPose() {
    camera.getWorldPosition(head); camera.getWorldQuaternion(headQ);
    return { yaw: headingOf([headQ.x, headQ.y, headQ.z, headQ.w]) };
  }
  //: Put `mesh` `distance` metres in front of you, `drop` below your eyes and `side` to the
  //: right (negative: left), turned to face you.
  function inFront(mesh, distance, drop = 0, side = 0) {
    const { yaw } = headPose();
    ahead.set(-Math.sin(yaw) * distance + Math.cos(yaw) * side, -drop, -Math.cos(yaw) * distance - Math.sin(yaw) * side);
    mesh.position.copy(head).add(ahead);
    mesh.lookAt(head.x, mesh.position.y, head.z);
  }

  // ---- what the buttons do ---------------------------------------------------------------------
  function showInfo(lines, seconds = 7) {
    drawInfo(lines);
    inFront(infoPanel.mesh, 1.4, 0.3);
    infoPanel.mesh.visible = true;
    state.infoUntil = performance.now() + seconds * 1000;
  }
  function describe() {
    const said = hooks.describeCentre();
    showInfo(said ? [said.title, ...said.lines] : ["Nothing to name there", "Look at a house or a street and press A"]);
  }
  function toggleMenu(open = !state.menuOpen) {
    state.menuOpen = open;
    if (open) { drawMenu(); inFront(menu.mesh, 0.85, 0.12, -0.32); }
    else { field.blur(); state.keyboard = false; }
    menu.mesh.visible = open;
  }
  function enterOrLeave() {
    const said = hooks.enterOrLeave();
    showInfo([said || "No door in front of you", said ? "" : "Walk up to a front door and press X"], 3);
  }
  async function blinkTo(move) {
    state.fadeTo = 1;
    await new Promise((resolve) => setTimeout(resolve, 220));
    try { await move(); } finally { state.fadeTo = 0; }
  }
  async function press(id) {
    if (id === "search") {
      // The headset's keyboard opens over a focused text field.
      field.value = state.query; state.keyboard = true; field.focus(); drawMenu();
      return;
    }
    if (id === "close") { toggleMenu(false); return; }
    if (id === "reset") { toggleMenu(false); await blinkTo(() => hooks.resetView()); recentre(); face(hooks.facing?.()); return; }
    if (id === "end-route") { hooks.endRoute(); state.route = false; state.status = ""; drawMenu(); return; }
    if (id.startsWith("mode:")) { state.mode = id.slice(5); drawMenu(); return; }
    const [kind, n] = id.split(":"), place = state.results[Number(n)];
    if (!place) return;
    if (kind === "go") {
      toggleMenu(false);
      await blinkTo(() => hooks.travelTo(place));
      recentre();
      face(hooks.facing?.());
      return;
    }
    if (kind === "dir") {
      state.status = "Finding a route…"; drawMenu();
      try {
        const found = await hooks.directionsTo(place, state.mode);
        state.route = Boolean(found);
        state.status = found ? `${Math.round(found.seconds / 60)} min · ${found.km.toFixed(1)} km` : "No route found";
      } catch (error) {
        state.status = "Directions unavailable just now";
      }
      drawMenu();
    }
  }

  // ---- the floor under you ---------------------------------------------------------------------
  //: The reference space moved to the walker's feet and heading. Done when either changes.
  let placed = null;
  function recentre(force = false) {
    if (!state.session || !state.base) return;
    const feet = hooks.feet();
    const key = `${feet.x.toFixed(3)},${feet.y.toFixed(3)},${feet.z.toFixed(3)},${state.yaw.toFixed(4)}`;
    if (!force && key === placed) return;
    placed = key;
    const { position, orientation } = rigOffset(feet.x, feet.y, feet.z, state.yaw);
    xr.setReferenceSpace(state.base.getOffsetReferenceSpace(new XRRigidTransform(position, orientation)));
  }

  // ---- each frame -----------------------------------------------------------------------------
  let lastAt = 0;
  function update(now) {
    const dt = lastAt ? Math.min(0.1, (now - lastAt) / 1000) : 0;
    lastAt = now;
    keepMoversPlaced();
    try { step(now, dt); } finally { keepMoversPlaced(); }
  }
  function step(now, dt) {
    const presenting = Boolean(state.session);
    // The blink.
    state.fade += (state.fadeTo - state.fade) * Math.min(1, dt * 12);
    shell.visible = state.fade > 0.01;
    shell.material.opacity = state.fade;
    if (shell.visible) camera.getWorldPosition(shell.position);
    if (infoPanel.mesh.visible && now > state.infoUntil) infoPanel.mesh.visible = false;
    const ready = hooks.ready();
    loading.mesh.visible = presenting && !ready;
    if (loading.mesh.visible) { if (Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) drawLoading(hooks.status()); inFront(loading.mesh, 1.6, 0); }
    governMemory(now);
    if (!presenting) return;
    // Where you face is where the walker faces: "the door in front of you" is the one you see.
    hooks.heading?.(headPose().yaw);
    let rightHand = null;
    for (const source of state.session.inputSources) {
      const pad = source.gamepad;
      if (!pad) continue;
      const hand = source.handedness;
      const axes = pad.axes.length >= 4 ? [pad.axes[2], pad.axes[3]] : [pad.axes[0] || 0, pad.axes[1] || 0];
      const was = state.pressed.get(hand) || [];
      const is = pad.buttons.map((b) => b.pressed);
      const down = (i) => is[i] && !was[i];
      state.pressed.set(hand, is);
      if (hand === "left" && ready && !state.keyboard) {
        const { yaw } = headPose();
        const speed = pad.buttons[META_BUTTONS.trigger]?.pressed ? META_WALK.brisk : META_WALK.speed;
        const [dx, dz] = stickWalk(axes[0], axes[1], yaw, speed, dt);
        if (dx || dz) hooks.walk(dx, dz);
        if (down(META_BUTTONS.x)) enterOrLeave();
      }
      if (hand === "right") {
        rightHand = source;
        if (ready && !state.menuOpen) {
          const turn = snapTurn(axes[0], state.armed);
          state.armed = turn.armed;
          if (turn.turn) state.yaw += turn.turn;
        }
        if (down(META_BUTTONS.a) && ready) describe();
        if (down(META_BUTTONS.b)) toggleMenu();
        // The trigger's press on the menu is the session's select event (below): a user
        // activation, which the headset's keyboard needs to open; a polled button is not.
      }
    }
    // The pointer: the right controller's ray against the menu.
    const controller = rightHand ? (state.session.inputSources[0] === rightHand ? pointer : pointerB) : null;
    for (const c of [pointer, pointerB]) c.getObjectByName("laser").visible = state.menuOpen && c === controller;
    if (state.menuOpen && controller) {
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
      const hit = raycaster.intersectObject(menu.mesh, false)[0];
      const row = hit?.uv ? menuHit(state.rows || [], hit.uv.x, hit.uv.y) : null;
      if ((row?.id || null) !== state.hover) { state.hover = row?.id || null; drawMenu(); }
    }
    recentre();
  }

  // ---- memory -------------------------------------------------------------------------------
  function governMemory(now) {
    if (now - state.lastMemoryAt < 2000) return;
    state.lastMemoryAt = now;
    const memory = hooks.memory();
    const plan = metaMemoryPlan(memory.total, hooks.radius());
    state.memory = memory; state.plan = plan;
    if (plan.level !== "ok") {
      state.planLog.push({ at: Math.round(now), total: memory.total, js: memory.js, gpu: memory.gpu, radius: hooks.radius(), level: plan.level });
      if (state.planLog.length > 30) state.planLog.shift();
    }
    // A build's working memory comes and goes in seconds; only a reading that stays over the
    // line at the smallest square (three in a row, six seconds) is what the page keeps.
    state.overAtSmallest = plan.level === "reload" ? state.overAtSmallest + 1 : 0;
    if (plan.level === "reload" && state.overAtSmallest < 3) {
      hooks.applyMemoryPlan({ ...plan, shed: "caches", level: "over" });
      return;
    }
    if (plan.level === "reload") {
      if (state.reloading) return;
      state.reloading = true;
      // Not twice in a row: a page over the line from the start sheds what it can instead.
      if (hooks.reload?.(true)) {
        state.fadeTo = 1;
        setTimeout(() => hooks.reload(false), 400);
        return;
      }
      state.reloading = false;
      hooks.applyMemoryPlan({ ...plan, shed: "caches", level: "over" });
      return;
    }
    if (plan.level !== "ok" && plan.level !== "unknown") hooks.applyMemoryPlan(plan);
  }

  // ---- starting ----------------------------------------------------------------------------
  async function start() {
    if (state.session || !navigator.xr) return false;
    const session = await navigator.xr.requestSession("immersive-vr", { requiredFeatures: ["local-floor"] });
    await xr.setSession(session);
    state.session = session;
    state.base = xr.getReferenceSpace();
    placed = null;
    session.addEventListener("select", (event) => {
      if (event.inputSource.handedness === "right" && state.menuOpen && state.hover) press(state.hover);
    });
    session.addEventListener("end", () => { state.session = null; state.base = null; toggleMenu(false); hooks.onExit?.(); });
    recentre(true);
    hooks.onEnter?.();
    return true;
  }
  //: Straight in where the browser allows it (an installed headset app launches into the view);
  //: otherwise from the Enter button, which a tap starts.
  async function startWhenAllowed(button) {
    const supported = await navigator.xr?.isSessionSupported?.("immersive-vr").catch(() => false);
    if (!supported) { if (button) { button.textContent = "Open this on a Meta Quest to enter"; button.disabled = true; } return false; }
    if (button) button.addEventListener("click", () => start().catch((e) => { button.textContent = `Could not start: ${e.message}`; }));
    navigator.xr.addEventListener?.("sessiongranted", () => start().catch(() => {}));
    return start().catch(() => false);
  }

  //: A click on the menu without a headset (the page on a desktop): (x, y) in -1..1.
  function clickAt(x, y) {
    if (!state.menuOpen) return false;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = raycaster.intersectObject(menu.mesh, false)[0];
    const row = hit?.uv ? menuHit(state.rows || [], hit.uv.x, hit.uv.y) : null;
    if (!row) return false;
    state.hover = row.id;
    press(row.id);
    return true;
  }

  return { update, start, clickAt, face, startWhenAllowed, state, toggleMenu, describe, enterOrLeave, press, search, field,
    get presenting() { return Boolean(state.session); } };
}
