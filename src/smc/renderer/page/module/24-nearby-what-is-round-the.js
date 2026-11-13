// ---- nearby: what is round the walker, within the same radius that makes it solid ----------
const NEARBY_VERB = { go_around: "go around", step_over: "step over", climb_over: "climb over or go around",
  walk_under: "walk under", pass_through: "walk through", enter: "enter by its door", walk_on: "walk on", swim: "swim" };
if (!ATTACH && !HEADSET) {
  const panel = document.createElement("div");
  panel.id = "nearby";
  panel.hidden = true;
  document.body.appendChild(panel);
  setInterval(() => {
    if (!objectProximity || !state.firstPerson) { panel.hidden = true; return; }
    const rows = objectProximity.nearby(4);
    if (!rows.length) { panel.hidden = true; return; }
    panel.replaceChildren();
    const head = document.createElement("div");
    head.className = "head";
    head.textContent = `Nearby · within ${objectProximity.radius} m`;
    panel.append(head);
    for (const r of rows) {
      const row = document.createElement("div"), sub = document.createElement("div");
      row.className = "row";
      sub.className = "sub";
      row.textContent = `${r.name} · ${r.distance_m} m · ${NEARBY_VERB[r.traversal] || r.traversal}`;
      sub.textContent = [r.material, r.friction && `grip ${r.friction.dynamic.toFixed(2)} (wet ${r.friction.wet.toFixed(2)})`,
        r.basis].filter(Boolean).join(" · ");
      row.append(sub);
      panel.append(row);
    }
    panel.hidden = false;
  }, 500);
}

// ---- doors -------------------------------------------------------------------------------------
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x5b3b25, roughness: 0.6, metalness: 0.05 });
const doorwayMaterial = new THREE.MeshBasicMaterial({ color: 0x2a221b, side: THREE.DoubleSide });
// The facade is merged into tiles and has no hole where a door is, so an open doorway is a
// portal: the rooms and the swung leaf are drawn first (INTERIOR_ORDER), then this pane writes
// depth and no colour at the doorway, so the facade behind it fails the depth test and the rooms
// show through. Only while the eye is outside that building -- from inside there is nothing to
// see through (the facade's back faces are not drawn), and the pane would hide the street.
// After the terrain (-2) and the plazas (-1, drawn without a depth test over the coarse
// backdrop), before the buildings (0): anything drawn after the plazas is not painted over by
// them. Groups keep order 0 -- three.js compares a group's order before its members'.
const INTERIOR_ORDER = -0.5;
const portalMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
const doorGroup = new THREE.Group();
doorGroup.name = "doors";
root.add(doorGroup);
const doorsShown = new Set();
function showDoor(door) {
  if (door.mesh) return;
  const street = terrainGroundAt(door.cx - door.nx * 0.6, door.cz - door.nz * 0.6);
  // A generic doorway inferred from a footprint must not fill a tunnel opening.
  if(typeof pointInTunnelVoid === "function"
      && pointInTunnelVoid(door.cx,street+DOOR_HEIGHT_M/2,door.cz))return;
  const pe = door.photoEntry;
  let ground, stoopPlan, frontStair = null;
  if (pe) {
    // The photograph says how this door is reached: up a long or a short flight to the
    // threshold it measured, into an alcove at the pavement, or straight in. The rooms are at
    // the threshold.
    const stairs = pe.kind === "long_stair" || pe.kind === "short_stair";
    ground = stairs ? street + Math.max(STEP_RISE_M, pe.threshold_m) : street + 0.02;
    // A house set back behind its stair: the flight runs out to the property line and the house
    // starts where it ends. Only where the front has no such room is the stair cut into it.
    // Where the photographs together placed the flight (multiview): along the front, rising
    // sideways to the door, or straight out from it as far as they measured.
    const measured = pe.stair && pe.stair.basis === "multiview_plane_sweep" ? pe.stair : null;
    if (stairs && measured?.orientation === "sideways") frontStair = planSideStair(door, street, ground, measured);
    if (stairs && !frontStair) {
      frontStair = planFrontStair(door, street, ground, pe.recess_width_m,
        measured?.orientation === "perpendicular" ? measured.run_m : null);
    }
    stoopPlan = pe.kind === "flat_alcove" ? planAlcove(door, street, pe.alcove)
      : stairs && !frontStair ? planInwardStoop(door, street, ground, pe.recess_width_m,
        measured?.orientation === "recessed" ? measured.depth_m : null) : null;
    if (!door.entry.interior) door.entry.floorY = ground;
  } else {
    ground = entryFloorY(door.entry);
    stoopPlan = planInwardStoop(door, street, ground);
  }
  // A guessed door on a flat frontage is not evidence for a flight of stairs.
  // Nor can an observed door be drawn floating above the street when its
  // footprint has no room for an inward flight: leave it unrendered for review.
  // Where the floor is above the street and no inward flight fits the footprint, the door is
  // the street-level entry San Francisco's hillside houses have -- a door at the pavement with
  // the stair behind it. It used to be left out altogether, and on the hills that was most
  // houses: a garage, and no door. It is drawn closed and solid; it does not open onto a floor
  // a storey up.
  door.atGrade = ground - street >= 0.08 && !stoopPlan && !frontStair;
  // Where the floor is only a little above the street, the rooms are brought down to the door:
  // the house is entered at street level and its floor is the street's (the hill inside the
  // footprint is hidden while the walker is in it -- see indoorGroundCut). A house whose floor
  // is a full storey up keeps its closed street door, and says it has no interior.
  if (door.atGrade && ground - street <= ROOMS_LOWERED_MAX_M && !door.entry.interior && !pe) {
    door.entry.floorY = street + 0.05;
    door.entry.roomsLowered = true;
    door.atGrade = false;
  }
  if (door.atGrade && ground - street > 4.0) return;
  const leafGround = door.atGrade ? street : ground;
  if (!door.atGrade) addStoop(door, street, ground, stoopPlan);
  if (frontStair) (frontStair.side ? addSideStair : addFrontStair)(door, frontStair);
  if (pe?.gate) addGate(door, street);
  // Independent of photo/UI flags: a raised runtime leaf must have a real flight up to it.
  if (!Number.isFinite(leafGround) || !Number.isFinite(street)
      || (leafGround - street > .1524 && !door.stoopPlan && !door.frontStair)) return;
  const hinge = new THREE.Group();
  // Hinged at the t0 end, standing a hair outside the wall so it is not lost in it.
  const hx = door.entry.local[door.edge][0] + (door.entry.local[door.edge + 1][0] - door.entry.local[door.edge][0]) * door.t0;
  const hz = door.entry.local[door.edge][1] + (door.entry.local[door.edge + 1][1] - door.entry.local[door.edge][1]) * door.t0;
  // A raised entry's leaf belongs at the end of its recessed stair and landing.
  // A door on a flat frontage stands in front of the facade's photograph (FACADE_STANDOFF_M)
  // so it is never painted over by the picture of the wall it is in.
  const leafDepth = door.stoopPlan ? door.stoopPlan.depth : -DOOR_STANDOFF_M;
  hinge.position.set(hx + door.nx * leafDepth, leafGround, hz + door.nz * leafDepth);
  hinge.rotation.y = Math.atan2(-door.uz, door.ux);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(door.width, DOOR_HEIGHT_M, 0.05), doorMaterial);
  leaf.position.set(door.width / 2, DOOR_HEIGHT_M / 2, 0);
  leaf.castShadow = true;
  leaf.renderOrder = INTERIOR_ORDER;
  hinge.add(leaf);
  const portalBottom = door.stoopPlan ? street : ground;
  const portalHeight = ground + DOOR_HEIGHT_M - portalBottom;
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.1, door.width - 0.04), portalHeight - 0.02), portalMaterial);
  // In front of the facade photograph and its glazing details, so the recess it reveals is
  // not hidden behind a picture of the wall.
  portal.position.set(hx + door.ux * door.width / 2 - door.nx * PORTAL_STANDOFF_M, portalBottom + portalHeight / 2,
    hz + door.uz * door.width / 2 - door.nz * PORTAL_STANDOFF_M);
  portal.rotation.y = Math.atan2(-door.uz, door.ux);
  portal.renderOrder = INTERIOR_ORDER + 0.1;
  portal.visible = false;
  // The opening behind the leaf: dark until the rooms behind it are built.
  const opening = new THREE.Mesh(new THREE.PlaneGeometry(door.width, DOOR_HEIGHT_M), doorwayMaterial);
  opening.position.set(hx + door.ux * door.width / 2 - door.nx * 0.02, ground + DOOR_HEIGHT_M / 2,
    hz + door.uz * door.width / 2 - door.nz * 0.02);
  opening.rotation.y = Math.atan2(-door.uz, door.ux) + Math.PI;
  opening.visible = false;
  doorGroup.add(hinge, opening, portal);
  door.portal = portal;
  door.mesh = hinge;
  door.leaf = leaf;
  door.opening = opening;
  door.inward = 1;
  // Which way round the leaf swings inward depends on which side of the edge is inside.
  const probe = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), hinge.rotation.y);
  door.inward = probe.x * door.nx + probe.z * door.nz > 0 ? 1 : -1;
  doorsShown.add(door);
  door.entry.shellNeedsRebuild = true;
}
const stoopMaterial = new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9 });
function planInwardStoop(door, street, floor, photographedWidth = null, measuredDepth = null) {
  const rise = floor - street;
  if (rise < 0.08) return null;
  const steps = Math.ceil(rise / STEP_RISE_M);
  if (door.source === 2) {
    const uphill = terrainGroundAt(door.cx + door.nx * 1.2, door.cz + door.nz * 1.2);
    if (steps > 3 || uphill - street < 0.15) return null;
  }
  // A photographed stairwell is as wide as the photo shows it, if the footprint has the room;
  // otherwise as wide as the door's.
  const widths = Number.isFinite(photographedWidth) && photographedWidth > door.width + 0.4
    ? [Math.min(door.width + 2.4, photographedWidth), door.width + 0.4] : [door.width + 0.4];
  // How far into the house the photographs placed the flight's top (multiview) sets its treads,
  // within what treads are; else the standard tread.
  const landingDepth = STEP_LANDING_TREADS * STEP_TREAD_M;
  const tread = Number.isFinite(measuredDepth) && measuredDepth > landingDepth
    ? Math.min(0.42, Math.max(0.24, (measuredDepth - landingDepth) / steps)) : STEP_TREAD_M;
  for (const width of widths) {
    const plan = stoopAtWidth(door, street, floor, rise, steps, width, tread);
    if (plan) return plan;
  }
  return null;
}

function stoopAtWidth(door, street, floor, rise, steps, width, tread = STEP_TREAD_M) {
  const landingDepth = STEP_LANDING_TREADS * STEP_TREAD_M;
  const depth = steps * tread + landingDepth;
  const treads = Array.from({ length: steps }, (_, i) => ({
    near: i * tread,
    far: (i + 1) * tread,
    top: street + rise * (i + 1) / steps,
  }));
  treads.push({ near: steps * STEP_TREAD_M, far: depth, top: floor, landing: true });
  // Sample the whole stairwell, not only four corners: a concave footprint can
  // leave the building and re-enter it before the landing.
  for (const tread of treads) {
    for (let across = 0; across <= Math.ceil(width / 0.2); across += 1) {
      const along = -width / 2 + width * across / Math.ceil(width / 0.2);
      for (let n = 0; n <= Math.ceil((tread.far - tread.near) / 0.2); n += 1) {
        const inward = Math.max(0.03, tread.near + (tread.far - tread.near)
          * n / Math.ceil((tread.far - tread.near) / 0.2));
        const x = door.cx + door.ux * along + door.nx * inward;
        const z = door.cz + door.uz * along + door.nz * inward;
        if (!insideFootprint(door.entry, x, z)) return null;
      }
    }
  }
  return { steps, rise, width, depth, landingDepth, tread, street, floor, treads };
}

//: A flat alcove: a recess at the pavement as wide as the photograph measured it and as deep as
//: the footprint gives it (entry_inference infers the depth; the walls here may make it less),
//: with the door at its back. A stoop with no steps -- the same recess, landing and portal.
function planAlcove(door, street, alcove) {
  const want = Math.max(door.width + 0.2, Math.min(door.width + 2.4, alcove?.width_m || door.width + 0.6));
  for (const depth of [alcove?.depth_m || 1.2, 1.0, 0.8, 0.6]) {
    for (const width of [want, door.width + 0.2]) {
      let fits = true;
      for (let a = 0; a <= 8 && fits; a += 1) {
        for (let n = 0; n <= 6 && fits; n += 1) {
          const along = -width / 2 + width * a / 8, inward = Math.max(0.03, depth * n / 6);
          if (!insideFootprint(door.entry, door.cx + door.ux * along + door.nx * inward,
            door.cz + door.uz * along + door.nz * inward)) fits = false;
        }
      }
      if (fits) return { steps: 0, rise: 0, width, depth, landingDepth: depth, street, floor: street,
        alcove: true, treads: [{ near: 0, far: depth, top: street, landing: true }] };
    }
  }
  return null;
}

//: How far the house's front is set back from its property line: walked out from the door to
//: the road, less the pavement (0 where the front is at the back of the pavement).
function frontSetback(door) {
  for (let s = 0.5; s <= 14; s += 0.25) {
    if (insideCarriageway(door.cx - door.nx * s, door.cz - door.nz * s, 0)) return Math.max(0, s - SIDEWALK_GUESS_M);
  }
  return 0;
}
//: A flight out in front of the house, from the property line up to a landing at its door: the
//: house is set back behind its stair and starts where the stair ends. Null where the front has
//: not the room for the whole flight, or something stands where it would.
function planFrontStair(door, street, floor, photographedWidth = null, measuredRun = null) {
  const rise = floor - street;
  if (rise < 0.08) return null;
  const steps = Math.ceil(rise / STEP_RISE_M);
  const landingDepth = STEP_LANDING_TREADS * STEP_TREAD_M;
  // A run the photographs measured sets the treads (within what a stair's treads are); else the
  // standard tread.
  const tread = Number.isFinite(measuredRun) && measuredRun > landingDepth
    ? Math.min(0.42, Math.max(0.24, (measuredRun - landingDepth) / steps)) : STEP_TREAD_M;
  const run = landingDepth + steps * tread;
  if (run > frontSetback(door) + 0.05) return null;
  const widths = Number.isFinite(photographedWidth) && photographedWidth > door.width + 0.4
    ? [Math.min(door.width + 2.4, photographedWidth), door.width + 0.4] : [door.width + 0.4];
  for (const width of widths) {
    let clear = true;
    for (let a = 0; a <= 8 && clear; a += 1) {
      for (let o = 1; o <= Math.ceil(run / 0.25) && clear; o += 1) {
        const along = -width / 2 + width * a / 8, out = Math.min(run, o * 0.25);
        const x = door.cx + door.ux * along - door.nx * out, z = door.cz + door.uz * along - door.nz * out;
        if (buildingAt(x, z) || insideCarriageway(x, z, 0)) clear = false;
      }
    }
    if (!clear) continue;
    const treads = Array.from({ length: steps }, (_, i) => ({
      near: landingDepth + (steps - 1 - i) * tread, far: landingDepth + (steps - i) * tread,
      top: street + rise * (i + 1) / steps,
    }));
    return { front: true, steps, rise, width, run, landingDepth, tread, street, floor, treads };
  }
  return null;
}
function addFrontStair(door, plan) {
  door.frontStair = plan;
  const { width, street, floor, landingDepth, run, steps, rise } = plan;
  const group = new THREE.Group();
  for (const tread of plan.treads) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, tread.top - street + 0.05, tread.far - tread.near),
      stoopMaterial);
    box.position.set(0, (tread.top + street - 0.05) / 2, (tread.near + tread.far) / 2);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
  }
  const landing = new THREE.Mesh(new THREE.BoxGeometry(width, floor - street + 0.05, landingDepth), stoopMaterial);
  landing.position.set(0, (floor + street - 0.05) / 2, landingDepth / 2);
  landing.castShadow = true;
  landing.receiveShadow = true;
  group.add(landing);
  // Local z points out of the building, toward the street; x along the wall.
  group.position.set(door.cx, 0, door.cz);
  group.rotation.y = Math.atan2(-door.nx, -door.nz);
  group.traverse((o) => { if (o.isMesh) o.renderOrder = INTERIOR_ORDER; });
  doorGroup.add(group);
  door.frontStairMesh = group;
  const each = rise / steps;
  door.frontStairSurface = (x, z) => {
    const dx = x - door.cx, dz = z - door.cz;
    const along = dx * door.ux + dz * door.uz, out = -(dx * door.nx + dz * door.nz);
    if (Math.abs(along) > width / 2 || out < -0.05 || out > run) return null;
    if (out <= landingDepth) return floor;
    const fromTop = Math.min(steps - 1, Math.floor((out - landingDepth) / (plan.tread || STEP_TREAD_M)));
    return street + each * (steps - fromTop);
  };
  door.frontStairSurface.priority = 1;
  door.frontStairSurface.stairs = true;
  standingSurfaces.add(door.frontStairSurface);
}

//: A flight along the front (multiview measured it: smc.facades.multiview): it rises sideways,
//: parallel to the wall, to a landing in front of the door, as wide out from the wall as the
//: photographs placed its outer side. In front of the house, where there is the room -- not on the
//: pavement, not into a building. Null where it does not fit, and the door is reached as before.
function planSideStair(door, street, floor, stair) {
  const rise = floor - street;
  if (rise < 0.08 || !door.photoTangent || !Number.isFinite(stair.rises_toward)) return null;
  const steps = Math.ceil(rise / STEP_RISE_M);
  const width = Math.min(2.2, Math.max(0.8, stair.width_m || 1.2));
  if (width > frontSetback(door) + 0.05) return null;
  const tread = Number.isFinite(stair.run_m) && steps > 1
    ? Math.min(0.42, Math.max(0.24, stair.run_m / (steps - 1))) : STEP_TREAD_M;
  const run = Math.max(0, steps - 1) * tread;
  const landingLength = door.width + 0.4;
  // The foot is the low end: away from the door, against the way it rises along the fit's wall.
  const [tx, tz] = door.photoTangent;
  const rising = Math.sign(tx * door.ux + tz * door.uz) * stair.rises_toward;
  const footSide = rising >= 0 ? -1 : 1;
  for (let a = 0; a <= Math.ceil((landingLength + run) / 0.25); a += 1) {
    const along = footSide * (-landingLength / 2 + Math.min(landingLength + run, a * 0.25));
    for (let o = 0; o <= Math.ceil(width / 0.25); o += 1) {
      const out = Math.max(0.05, Math.min(width - 0.05, o * 0.25));
      const sx = door.cx + door.ux * along - door.nx * out, sz = door.cz + door.uz * along - door.nz * out;
      if (buildingAt(sx, sz) || insideCarriageway(sx, sz, 0)) return null;
    }
  }
  return { front: true, side: true, steps, rise, width, run: width, flightRun: run, tread,
    landingLength, footSide, street, floor };
}
function addSideStair(door, plan) {
  door.frontStair = plan;
  const { width, street, floor, steps, rise, tread, landingLength, footSide, flightRun } = plan;
  const each = rise / steps;
  const group = new THREE.Group();
  // Local z out of the building, toward the street (as addFrontStair's); local x along the wall,
  // one way or the other -- ``sx`` says which.
  group.position.set(door.cx, 0, door.cz);
  group.rotation.y = Math.atan2(-door.nx, -door.nz);
  const sx = Math.cos(group.rotation.y) * door.ux - Math.sin(group.rotation.y) * door.uz >= 0 ? 1 : -1;
  const box = (along0, along1, top) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(along1 - along0), top - street + 0.05, width), stoopMaterial);
    mesh.position.set(sx * (along0 + along1) / 2, (top + street - 0.05) / 2, width / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  box(-landingLength / 2, landingLength / 2, floor);
  for (let k = 0; k < steps - 1; k += 1) {
    const near = landingLength / 2 + k * tread;
    box(footSide * near, footSide * (near + tread), street + each * (steps - 1 - k));
  }
  group.traverse((o) => { if (o.isMesh) o.renderOrder = INTERIOR_ORDER; });
  doorGroup.add(group);
  door.frontStairMesh = group;
  door.frontStairSurface = (x, z) => {
    const dx = x - door.cx, dz = z - door.cz;
    const along = dx * door.ux + dz * door.uz, out = -(dx * door.nx + dz * door.nz);
    if (out < -0.05 || out > width) return null;
    if (Math.abs(along) <= landingLength / 2) return floor;
    const past = along * footSide - landingLength / 2;
    if (past < 0 || past > flightRun) return null;
    const k = Math.min(steps - 2, Math.floor(past / tread));
    return street + each * (steps - 1 - k);
  };
  door.frontStairSurface.priority = 1;
  door.frontStairSurface.stairs = true;
  standingSurfaces.add(door.frontStairSurface);
}

function addStoop(door, street, floor, plan = planInwardStoop(door, street, floor)) {
  door.stoopPlan = plan;
  if (!plan) return;
  if (door.entry.interior) {
    removeInterior(door.entry);
    buildInterior(door.entry);
  }
  const { steps, rise, width, depth } = plan;
  const each = rise / steps;
  const group = new THREE.Group();
  for (const tread of plan.treads.filter((item) => !item.landing)) {
    // The lowest tread starts at the facade, then rises *into* the property.
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, tread.top - street + 0.05,
      tread.far - tread.near), stoopMaterial);
    box.position.set(0, (tread.top + street - 0.05) / 2, (tread.near + tread.far) / 2);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
  }
  const landing = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, plan.landingDepth), stoopMaterial);
  landing.position.set(0, floor - 0.04, depth - plan.landingDepth / 2);
  landing.receiveShadow = true;
  group.add(landing);
  // Local z points into the building (its inward normal), x along the wall.
  group.position.set(door.cx, 0, door.cz);
  group.rotation.y = Math.atan2(door.nx, door.nz);
  // Drawn before the doorway portal, which reveals it through the facade.
  group.traverse((o) => { if (o.isMesh) o.renderOrder = INTERIOR_ORDER; });
  doorGroup.add(group);
  door.stoop = group;
  // The walker climbs it: the height at a point is the tread it stands on.
  door.stoopSurface = (x, z) => {
    const dx = x - door.cx, dz = z - door.cz;
    const along = dx * door.ux + dz * door.uz;
    const inward = dx * door.nx + dz * door.nz;
    if (Math.abs(along) > width / 2 || inward < 0 || inward > depth
        || !insideFootprint(door.entry, x, z)) return null;
    if (inward >= steps * (plan.tread || STEP_TREAD_M)) return floor;
    const i = Math.min(steps - 1, Math.max(0, Math.floor(inward / (plan.tread || STEP_TREAD_M))));
    return street + each * (i + 1);
  };
  door.stoopSurface.priority = 1;
  door.stoopSurface.stairs = true;
  standingSurfaces.add(door.stoopSurface);
}


// ---- the gate in front of an entry -------------------------------------------------------------
//
// An iron gate at the pavement, pickets across a garden, a solid gate in a wall: the photograph
// saw it (entry_inference: style, height, colour) in front of the door. Where the house stands at
// the back of the pavement the gate closes the mouth of its stair or alcove; where it is set back
// behind a garden the gate stands at the property line, the fence the photo saw runs either side,
// and a path leads from the gate to the door. It opens with Enter, inward, like a door.
//: The pavement assumed between the kerb and the property line: San Francisco's usual ten feet.
const SIDEWALK_GUESS_M = 3.0;
const GATE_OPEN_RAD = 1.45;
const gateMaterials = new Map();
function gateMaterial(colour, style) {
  const key = `${style}:${colour}`;
  if (!gateMaterials.has(key)) {
    const iron = style === "bars";
    let hex = iron ? 0x1d1f21 : style === "pickets" ? 0xe9e4d8 : 0x6b4f37;
    if (/^#[0-9a-f]{6}$/i.test(colour || "")) hex = parseInt(colour.slice(1), 16);
    gateMaterials.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: iron ? 0.45 : 0.8,
      metalness: iron ? 0.6 : 0.0 }));
  }
  return gateMaterials.get(key);
}
//: A panel of fence or a gate leaf, from x = 0 to ``width``, standing on y = 0, in the x/y plane.
function fencePanel(width, height, style, material) {
  const group = new THREE.Group();
  const add = (w, h, d, x, y) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    box.position.set(x, y, 0);
    box.castShadow = true;
    group.add(box);
  };
  const frame = style === "bars" ? 0.035 : 0.06;
  add(frame, height, frame, frame / 2, height / 2);
  add(frame, height, frame, width - frame / 2, height / 2);
  add(width, frame, frame, width / 2, height - frame / 2);
  add(width, frame, frame, width / 2, Math.min(0.15, height * 0.1));
  if (style === "bars") {
    const n = Math.max(2, Math.round(width / 0.12));
    for (let i = 1; i < n; i += 1) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, height - 0.04, 6), material);
      bar.position.set(width * i / n, height / 2, 0);
      group.add(bar);
    }
    add(width, frame * 0.7, frame * 0.7, width / 2, height * 0.55);
  } else if (style === "pickets") {
    const pitch = 0.125;
    for (let x = 0.07; x < width - 0.06; x += pitch) add(0.09, height - 0.1, 0.02, x + 0.045, height / 2);
  } else {
    add(width - 2 * frame, height - 0.2, 0.03, width / 2, height / 2);
  }
  return group;
}
//: How far along its line a fence runs looking for a wall to meet.
const FENCE_REACH_M = 9;
//: A fence end this close to a wall meets it.
const FENCE_MEETS_M = 0.06;
const gateStats = { drawn: 0, recessed: 0, refused: 0 };
window.kerbsideGates = () => ({ ...gateStats });
//: Where a gate and its fence go, in the door's frame (along the wall, out from it), and whether
//: they close the entry: the gate stands in the house's entry -- across the mouth of its recess,
//: or out on the property line in front of its door -- and the fence either side ends against a
//: wall, with no gap a person could walk round the gate through. Out on the line, each side runs
//: from the gate to the first wall on that line (a neighbour's front, a bay of its own); where no
//: wall stands before the end of the house's front, it runs to that end and back to the house's
//: corner. A fence never runs across a garage or its driveway: ``keepClear`` (spans along the
//: wall, in the door's frame) turns it back to the wall at the near edge of each.
//: ``solidAt(x, z)`` says whether a point is inside a building.
function gateLayout(door, width, out, recessed, solidAt, keepClear = []) {
  const at = (along, outward) => [door.cx + door.ux * along - door.nx * outward,
    door.cz + door.uz * along - door.nz * outward];
  // The wall beside a point on the fence: a few centimetres further on, in the direction the
  // run was going (or, at the front, just inside it).
  const meets = (along, outward, dAlong, dOut) => solidAt(...at(along + dAlong * FENCE_MEETS_M,
    outward + dOut * FENCE_MEETS_M));
  if (recessed) {
    // Across the mouth of the recess: the front wall stands either side of it.
    const ok = meets(-width / 2, 0, -1, -1) && meets(width / 2, 0, 1, -1);
    return { runs: [], ok, gaps: ok ? [] : ["recess_mouth"] };
  }
  if (solidAt(...at(0, out)) || solidAt(...at(-width / 2, out)) || solidAt(...at(width / 2, out))) {
    return { runs: [], ok: false, gaps: ["gate_inside_a_building"] };
  }
  const a = door.entry.local[door.edge], b = door.entry.local[door.edge + 1];
  const ends = [a, b].map(([px, pz]) => (px - door.cx) * door.ux + (pz - door.cz) * door.uz)
    .sort((p, q) => p - q);
  const runs = [], gaps = [];
  for (const side of [-1, 1]) {
    const from = side * width / 2;
    let corner = side * Math.max(Math.abs(side < 0 ? ends[0] : ends[1]), width / 2);
    for (const [c0, c1] of keepClear) {
      const near = side < 0 ? c1 : c0;
      if (side * (near - from) >= 0 && side * (near - corner) < 0) corner = near;
    }
    let hit = null;
    for (let s = 0; s <= FENCE_REACH_M && side * (from + side * s - corner) <= 0; s += 0.05) {
      if (solidAt(...at(from + side * s, out))) { hit = from + side * Math.max(0, s - 0.05); break; }
    }
    if (hit !== null) {
      if (Math.abs(hit - from) > 0.05) runs.push([from, out, hit, out]);
      if (!meets(hit, out, side, 0)) gaps.push(side < 0 ? "left" : "right");
      continue;
    }
    // No wall on the line before the house's corner: along to the corner, and back to it.
    if (Math.abs(corner - from) > 0.05) runs.push([from, out, corner, out]);
    runs.push([corner, out, corner, 0]);
    if (!meets(corner - side * FENCE_MEETS_M * 2, 0, 0, -1)) gaps.push(side < 0 ? "left" : "right");
  }
  return { runs, ok: !gaps.length, gaps };
}
function addGate(door, street) {
  const pe = door.photoEntry, gate = pe?.gate;
  if (!gate || door.gate) return;
  // How far the front is set back: walked out from the door until the road, less the pavement.
  const setback = frontSetback(door);
  const recessed = Boolean(door.stoopPlan) && setback < 1.0;
  const width = recessed ? door.stoopPlan.width : Math.min(1.8, Math.max(0.9, gate.w || 1.2));
  const height = Math.min(2.4, Math.max(1.0, gate.h || 1.6));
  // At the property line -- beyond the foot of a stair that runs out to it.
  const out = recessed ? 0.03 : door.frontStair ? Math.max(door.frontStair.run + 0.05, setback - 0.1)
    : Math.max(0.6, setback - 0.1);
  // The check: in the entry, and closed against the walls either side -- or not drawn at all.
  // The garages on this wall, with a little room either side, in the door's frame.
  const [wallX, wallZ] = door.entry.local[door.edge];
  const doorAlong = (door.cx - wallX) * door.ux + (door.cz - wallZ) * door.uz;
  const keepClear = garageSpansOnEdge(door.entry, door.edge)
    .map(([u, w]) => [u - w / 2 - 0.3 - doorAlong, u + w / 2 + 0.3 - doorAlong]);
  const layout = gateLayout(door, width, out, recessed, (x, z) => Boolean(buildingAt(x, z)), keepClear);
  if (!layout.ok) { gateStats.refused += 1; door.gateRefused = layout.gaps; return; }
  const material = gateMaterial(gate.colour, gate.style || "bars");
  const yaw = Math.atan2(-door.uz, door.ux);
  const at = (along, outward) => [door.cx + door.ux * along - door.nx * outward,
    door.cz + door.uz * along - door.nz * outward];
  const group = new THREE.Group();
  const [hx, hz] = at(-width / 2, out);
  const base = recessed ? street : terrainGroundAt(...at(0, out));
  const hinge = new THREE.Group();
  hinge.position.set(hx, base, hz);
  hinge.rotation.y = yaw;
  hinge.add(fencePanel(width, height, gate.style || "bars", material));
  group.add(hinge);
  const segments = [];
  // The fence the photograph saw beside the gate gives the rest its style and colour.
  const run = (frontageFitFor(door.entry.way)?.entries?.fences || [])[0] || {};
  const style = run.style || gate.style || "bars";
  const fenceMaterial = gateMaterial(run.colour || gate.colour, style);
  for (const [s0, o0, s1, o1] of layout.runs) {
    const [px, pz] = at(s0, o0), [qx, qz] = at(s1, o1);
    const length = Math.hypot(qx - px, qz - pz);
    if (length < 0.05) continue;
    const panel = fencePanel(length, Math.min(2.4, Math.max(0.8, run.h || height)), style, fenceMaterial);
    panel.position.set(px, terrainGroundAt(px, pz), pz);
    panel.rotation.y = Math.atan2(-(qz - pz), qx - px);
    group.add(panel);
    segments.push([px, pz, qx, qz]);
  }
  if (!recessed && !door.frontStair) {
    // The path from the gate to the door.
    const path = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.9, width - 0.2), 0.06, out),
      new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.95 }));
    const [mx, mz] = at(0, out / 2);
    path.position.set(mx, terrainGroundAt(mx, mz) + 0.03, mz);
    path.rotation.y = yaw;
    path.receiveShadow = true;
    group.add(path);
  }
  group.traverse((o) => { if (o.isMesh) o.renderOrder = INTERIOR_ORDER; });
  doorGroup.add(group);
  const [ex, ez] = at(width / 2, out);
  gateStats.drawn += 1;
  if (recessed) gateStats.recessed += 1;
  door.gate = { group, hinge, yaw, width, open: false, angle: 0, segments, layout,
    leaf: [hx, hz, ex, ez], cx: (hx + ex) / 2, cz: (hz + ez) / 2 };
}
//: The gate within reach of the walker, if one is nearer than any door.
function nearestGate() {
  const x = avatar.position.x, z = avatar.position.z;
  let best = null, bestD = DOOR_REACH_M;
  for (const door of doorsShown) {
    if (!door.gate) continue;
    const d = Math.hypot(door.gate.cx - x, door.gate.cz - z);
    if (d < bestD) { best = door.gate; bestD = d; }
  }
  return best;
}
function swingGates(dt) {
  for (const door of doorsShown) {
    const gate = door.gate;
    if (!gate) continue;
    const target = gate.open ? GATE_OPEN_RAD : 0;
    if (Math.abs(target - gate.angle) < 1e-3) continue;
    gate.angle += Math.sign(target - gate.angle) * Math.min(Math.abs(target - gate.angle), dt * 2.5);
    // Swings inward, toward the door, like the door does.
    gate.hinge.rotation.y = gate.yaw + door.inward * gate.angle;
  }
}

function hideDoor(door) {
  if (!door.mesh) return;
  if (door.frontStairMesh) {
    doorGroup.remove(door.frontStairMesh);
    door.frontStairMesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    standingSurfaces.delete(door.frontStairSurface);
    door.frontStairMesh = null;
    door.frontStair = null;
  }
  if (door.gate) {
    doorGroup.remove(door.gate.group);
    door.gate.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    door.gate = null;
  }
  if (door.stoop) {
    doorGroup.remove(door.stoop);
    door.stoop.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    standingSurfaces.delete(door.stoopSurface);
    door.stoop = null;
  }
  doorGroup.remove(door.mesh, door.opening, door.portal);
  door.leaf.geometry.dispose();
  door.opening.geometry.dispose();
  door.portal.geometry.dispose();
  door.mesh = null;
  doorsShown.delete(door);
}

function doorsNear(x, z, reach) {
  const found = [];
  const seen = new Set();
  const span = Math.ceil(reach / FOOTPRINT_CELL);
  for (let ix = -span; ix <= span; ix += 1) {
    for (let iz = -span; iz <= span; iz += 1) {
      const bucket = footprintGrid.get(`${Math.floor(x / FOOTPRINT_CELL) + ix}:${Math.floor(z / FOOTPRINT_CELL) + iz}`);
      if (!bucket) continue;
      for (const entry of bucket) {
        if (seen.has(entry) || !entry.doors) continue;
        seen.add(entry);
        for (const door of entry.doors) {
          const d = Math.hypot(door.cx - x, door.cz - z);
          if (d <= reach) found.push([d, door]);
        }
      }
    }
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, door]) => door);
}

const doorHint = document.createElement("div");
doorHint.id = "door-hint";
doorHint.style.cssText = "position:fixed;left:50%;bottom:72px;transform:translateX(-50%);"
  + "background:rgba(20,20,20,.78);color:#fff;font:13px/1.4 system-ui,sans-serif;padding:7px 12px;"
  + "border-radius:6px;pointer-events:none;max-width:min(92vw,520px);text-align:center;z-index:20";
doorHint.hidden = true;
document.body.appendChild(doorHint);

//: The most the rooms are brought down to meet a street door below the house's floor.
const ROOMS_LOWERED_MAX_M = 1.6;
//: Messages over the view fade after this long; the same message is not shown again until
//: something else has been shown or the walker has moved on.
const HINT_SHOW_MS = 4000;
doorHint.style.transition = "opacity .6s";
let hintText = null, hintSince = 0;
function setHint(text) {
  if (!text) {
    doorHint.hidden = true;
    hintText = null;
    return;
  }
  const now = performance.now();
  if (text !== hintText) {
    hintText = text;
    hintSince = now;
    doorHint.textContent = text;
    doorHint.style.opacity = "1";
    doorHint.hidden = false;
  } else if (now - hintSince > HINT_SHOW_MS) {
    doorHint.style.opacity = "0";
  }
}

//: The door of a room in the house the walker is in, within reach.
function nearestRoomDoor() {
  if (!state.indoors) return null;
  let best = null, bestD = 1.7;
  for (const entry of interiorsBuilt) {
    for (const d of entry.interior?.roomDoors || []) {
      if (d.y !== undefined && Math.abs(d.y - walkerFeetY()) > 1.5) continue;
      const dist = Math.hypot(d.x - avatar.position.x, d.z - avatar.position.z);
      if (dist < bestD) { best = d; bestD = dist; }
    }
  }
  return best;
}
function swingRoomDoors(dt) {
  for (const entry of interiorsBuilt) {
    for (const d of entry.interior?.roomDoors || []) {
      const target = d.open ? 1.45 : 0;
      if (Math.abs(target - d.angle) < 1e-3) continue;
      d.angle += Math.sign(target - d.angle) * Math.min(Math.abs(target - d.angle), dt * 3.0);
      d.leaf.rotation.y = d.angle;
    }
  }
}

function nearestDoor() {
  const x = avatar.position.x, z = avatar.position.z;
  if(typeof occupiedTunnelAt === "function" && occupiedTunnelAt(x,z,walkerFeetY()))return null;
  const near = doorsNear(x, z, DOOR_DRAW_M).filter((d) => d.mesh)
    .map((d) => {
      const depth = d.stoopPlan?.depth || 0;
      return [Math.min(Math.hypot(d.cx - x, d.cz - z),
        Math.hypot(d.cx + d.nx * depth - x, d.cz + d.nz * depth - z)), d];
    }).filter(([distance]) => distance <= DOOR_REACH_M).sort((a, b) => a[0] - b[0]);
  return near.length ? near[0][1] : null;
}

//: The house the walker went into by Enter at its door: the one footprint it may stand in.
//: Walking never takes it in -- an open door is not a way through a wall -- nor does a click, a
//: search or GPS. It is let go when the walker leaves the footprint or the rooms are taken down.
//: (var: read by the landing and wall checks, which the tests run on their own.)
var enteredEntry = null;
//: How far past the threshold -- or past the top of an inward stoop -- the walker is put down.
const ENTER_STEPS_M = [0.8, 0.55, 1.2, 1.6];

// Where Enter at this door puts the walker: just inside, clear of the partitions, on the floor.
function enterThroughDoor(door) {
  const entry = door.entry;
  if (!entry.interior) buildInterior(entry);
  if (!entry.interior) return null;
  const depth = door.stoopPlan?.depth || 0;
  for (const step of ENTER_STEPS_M) {
    const p = { x: door.cx + door.nx * (depth + step), z: door.cz + door.nz * (depth + step) };
    pushOutOfWalls(p, wallSegmentsNear(p.x, p.z));
    if (insideFootprint(entry, p.x, p.z) && !insideEntranceRecess(entry, p.x, p.z)) return p;
  }
  return null;
}

// Enter at a door: outside, it opens and the walker is put just inside; inside the house it went
// into, the walker steps back out and the door is closed behind. Returns where the walker goes,
// in this world's metres, or null when it stays (no rooms here: the door only swings).
function toggleDoor(door) {
  if (door.atGrade) return null;           // a street door onto a stair: shown, not walked through
  const x = avatar.position.x, z = avatar.position.z;
  if (enteredEntry === door.entry && insideFootprint(door.entry, x, z)) {
    enteredEntry = null;
    door.open = false;
    return { x: door.cx - door.nx * 1.2, z: door.cz - door.nz * 1.2, yaw: Math.atan2(door.nx, door.nz) };
  }
  const wasOpen = door.open;
  door.open = true; door.npcShut = null;
  const inside = enterThroughDoor(door);
  if (!inside) {
    door.open = !wasOpen;
    return null;
  }
  enteredEntry = door.entry;
  return { ...inside, yaw: Math.atan2(-door.nx, -door.nz) };
}

// Put the walker down at a door's threshold (see toggleDoor), facing through it.
function placeWalkerAtDoor(at) {
  avatar.position.set(at.x, AVATAR_STAND_Y + walkerGroundAt(at.x, at.z), at.z);
  state.target.copy(avatar.position);
  state.yaw = at.yaw;
  state.look = 0;
  GPS_LEASH.on = false;
  placeCamera();
}

function insideEntranceRecess(entry, x, z) {
  return (entry?.doors || []).some((d) => {
    if (!d.stoopPlan) return false;
    const dx = x - d.cx, dz = z - d.cz;
    const across = dx * d.ux + dz * d.uz, inward = dx * d.nx + dz * d.nz;
    return Math.abs(across) <= d.stoopPlan.width / 2 + 0.1
      && inward >= -0.1 && inward <= d.stoopPlan.depth + 0.1;
  });
}

// Leave ordinary doors/walls solid. Only an actually rendered stair recess is
// walkable, with body clearance at both sides and at its property-interior end.
function stairRecessClear(entry,x,z){
  return (entry?.doors||[]).some(d=>{
    const p=d.stoopPlan;if(!p||!(p.steps>0)||!d.stoopSurface?.stairs)return false;
    const dx=x-d.cx,dz=z-d.cz,across=dx*d.ux+dz*d.uz,inward=dx*d.nx+dz*d.nz;
    return Math.abs(across)<=p.width/2-WALKER_RADIUS_M
      && inward>=-WALKER_RADIUS_M-.05 && inward<=p.depth-WALKER_RADIUS_M;
  });
}
function walkableStairRecessAt(x,z){
  const guest=typeof guestUnder === "function" ? guestUnder(x,z) : null;
  if(guest?.ready&&guest.api.walkableStairRecessAt)return guest.api.walkableStairRecessAt(...hostToGuest(guest,x,z));
  const entries=footprintGrid.get(`${Math.floor(x/FOOTPRINT_CELL)}:${Math.floor(z/FOOTPRINT_CELL)}`)||[];
  return entries.some(e=>stairRecessClear(e,x,z));
}

//: The nearest room door or gate opened or shut ({ said }), or the nearest front door opened and
//: the walker taken through it ({ at }, in this world's metres; see toggleDoor); null where there
//: is none near. An attached region answers for its own (toggleNearestDoor): it had only its
//: front doors, so in a detail window no room door or garden gate ever opened.
function operateNearestDoor() {
  const roomDoor = nearestRoomDoor();
  if (roomDoor) { roomDoor.open = !roomDoor.open; return { said: roomDoor.open ? "Door opened" : "Door shut" }; }
  const gate = nearestGate();
  const door = nearestDoor();
  const ax = avatar.position.x, az = avatar.position.z;
  if (gate && (!door || Math.hypot(gate.cx - ax, gate.cz - az) < Math.hypot(door.cx - ax, door.cz - az))) {
    gate.open = !gate.open;
    return { said: gate.open ? "Gate opened" : "Gate shut" };
  }
  if (!door) return null;
  // A shop's or restaurant's door: no house rooms behind it. In the game the shop is walked
  // into (the living city's room for it: enterOrLeave); elsewhere the door only swings.
  if (!entryRoomsPossible(door.entry) && commercialInterior(door.entry)) {
    if (typeof cityGame === "function" && cityGame()) return { shopIn: String(door.entry.way.osm_id) };
    door.open = !door.open; door.npcShut = null;
    return { said: door.open ? "Door opened: the shop's own rooms are not drawn yet" : "Door shut" };
  }
  return { at: toggleDoor(door) };
}
//: The nearest door, gate or room door opened or shut, and the walker taken through a front door
//: (Enter; X in the headset). What happened, in a few words, or null where there is none near.
function enterOrLeave() {
  const g = !hostWorldActive && activeGuest && activeGuest.ready ? activeGuest : null;
  const done = g ? g.api.toggleNearestDoor() : operateNearestDoor();
  if (!done) return null;
  // A shop's door, in the game: into the city's room for the shop there.
  if (done.shopIn) {
    if (typeof livingCity !== "undefined" && livingCity?.enterBuilding?.(done.shopIn)) return "Inside";
    return "Closed";
  }
  if (done.said) return done.said;
  // An attached region says where, in its own metres (mirrored when its sx is negative).
  if (done.at) placeWalkerAtDoor(g ? { x: g.ox + done.at.x * g.sx, z: g.oz + done.at.z, yaw: done.at.yaw * Math.sign(g.sx) } : done.at);
  return done.at ? (state.indoors ? "Inside" : "Outside") : "Door";
}
addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.target instanceof HTMLButtonElement) return;   // Enter on a focused button presses it
  // In the game, Enter is in and out first: your car, the bus at the stop, a shop's door, your
  // garage. On the map, your own garage (the living city's, docs/city/view.mjs enterKey).
  if (typeof livingCity !== "undefined" && livingCity?.enterKey?.({ map: !cityGame() })) { e.preventDefault(); return; }
  if (enterOrLeave()) e.preventDefault();
});

//: The light of the room the walker is in: one lamp, moved to the ceiling light of whichever
//: room that is and out when the walker is outdoors. One light that stays in the scene, not one
//: per house: adding or removing a light recompiles every material in view, and each house the
//: walker came near used to do both.
const INDOOR_LIGHT_CD = 9;
const indoorLight = new THREE.PointLight(0xffe7c4, 0, 9, 2);
indoorLight.name = "indoor-light";
scene.add(indoorLight);
function updateIndoorLight(entry, x, z) {
  let target = null;
  if (state.indoors && entry?.interior) {
    for (const room of entry.interior.rooms || []) {
      if (room.light && pointInRing(x, z, room.pts)) { target = room.light; break; }
    }
    if (!target && entry.interior.lights?.length) {
      target = entry.interior.lights.reduce((best, l) =>
        (!best || Math.hypot(l[0] - x, l[2] - z) < Math.hypot(best[0] - x, best[2] - z) ? l : best), null);
    }
  }
  indoorLight.intensity = target ? INDOOR_LIGHT_CD : 0;
  if (target) indoorLight.position.set(target[0], target[1] - 0.12, target[2]);
}

//: Points the terrain cut at the lowered house the walker is in or at the door of.
let indoorCutEntry = null;
function updateIndoorGroundCut(x, z) {
  // The house the walker is in; or, outside, the one whose walls are nearest. Measured by the
  // boxes round the footprints, as it was, the houses of a terrace on a lot turned off the grid
  // all stood at distance nought -- their boxes overlap -- and the first built won: inside one
  // house the hill was cut out of its neighbour, and stood up through the walker's own floor.
  let best = null, bestD = 30;
  for (const entry of interiorsBuilt) {
    if (!entry.roomsLowered) continue;
    const box = Math.hypot(Math.max(entry.minX - x, 0, x - entry.maxX), Math.max(entry.minZ - z, 0, z - entry.maxZ));
    if (box >= bestD) continue;
    let d = 0;
    if (!insideFootprint(entry, x, z)) {
      d = Infinity;
      const ring = entry.local;
      for (let i = 0; i + 1 < ring.length; i += 1) {
        d = Math.min(d, Math.sqrt(distanceToSegmentSquared(x, z, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1])));
      }
      // Never level with the house one is in.
      d += 1e-3;
    }
    if (d < bestD) { best = entry; bestD = d; }
  }
  if (best === indoorCutEntry) return;
  indoorCutEntry = best;
  const ring = best ? best.local.slice(0, -1) : [];
  if (!best || ring.length > INDOOR_CUT_MAX) { indoorCut.count.value = 0; return; }
  ring.forEach(([px, pz], i) => indoorCut.ring.value[i].set(px, pz));
  indoorCut.count.value = ring.length;
  indoorCut.floor.value = best.floorY;
}

function updateDoors(dt) {
  // This page's own region let go for another: the doors are the attached region's (guestFrame).
  if (!hostWorldActive) return;
  const x = avatar.position.x, z = avatar.position.z;
  // Out of the house it went into (or its rooms gone), the walker is held outside again.
  if (enteredEntry && (!enteredEntry.interior || !insideFootprint(enteredEntry, x, z))) enteredEntry = null;
  for (const door of doorsNear(x, z, DOOR_DRAW_M)) showDoor(door);
  for (const door of [...doorsShown]) {
    if (Math.hypot(door.cx - x, door.cz - z) > DOOR_DRAW_M * 1.2 && !door.open) hideDoor(door);
  }
  pumpHomeDecals();
  updateHomeShells(x, z);
  updateShellGlass();
  for (const door of doorsShown) {
    const target = door.open ? Math.PI / 2 * 0.95 : 0;
    door.angle += Math.sign(target - door.angle) * Math.min(Math.abs(target - door.angle), dt * 3.5);
    door.leaf.parent.rotation.y = Math.atan2(-door.uz, door.ux) - door.inward * door.angle;
    door.opening.visible = door.angle > 0.05 && !door.entry.interior;
    // A recessed entry is open to the street whether or not its door is: its stair and landing
    // show through the facade always; a flat doorway only once its door stands open.
    door.portal.visible = !door.entry.homeShell
      && (Boolean(door.stoopPlan) || (door.angle > 0.05 && Boolean(door.entry.interior)))
      && !insideFootprint(door.entry, camera.position.x, camera.position.z);
  }
  const door = nearestDoor();
  const inPassage=occupiedTunnelAt(x,z,walkerFeetY()) || approachPassageAt(x,z,walkerFeetY());
  const inside = inPassage ? null : buildingAt(x, z);
  const insideEntry = inside && footprintById.get(String(inside.osm_id));
  const insideId = inside && !insideEntranceRecess(insideEntry, x, z) ? String(inside.osm_id) : null;
  // A walker already inside (arrived by search, or a saved position) gets the rooms too.
  if (inside && INTERIORS) {
    const entry = footprintById.get(String(inside.osm_id));
    if (entry && !entry.interior) buildInterior(entry);
  }
  // Inside a house the view is the walker's own eyes: the house keeps its roof and its walls,
  // and the rooms are seen as they would be. This applies to saved indoor positions as well as
  // doorway entries; a stair or landing recess is not a room. Walking out puts back the view
  // the walker had, unless they chose first person themselves.
  if (insideId && insideEntry?.interior && !state.firstPerson) {
    setFirstPerson(true);
    state.autoFirstPerson = true;
  }
  if (!insideId && state.autoFirstPerson) setFirstPerson(false);
  state.indoors = Boolean(insideId && insideEntry?.interior);
  swingRoomDoors(dt);
  swingGates(dt);
  const roomDoor = nearestRoomDoor();
  const gateNear = !roomDoor ? nearestGate() : null;
  if (gateNear && (!door || Math.hypot(gateNear.cx - x, gateNear.cz - z) < Math.hypot(door.cx - x, door.cz - z))) {
    setHint(`Enter — ${gateNear.open ? "close" : "open"} the gate`);
  } else if (roomDoor) {
    setHint(`Enter — ${roomDoor.open ? "close" : "open"} the door`);
  } else if (door) {
    setHint(door.atGrade ? "No house interior"
      : enteredEntry === door.entry && insideFootprint(door.entry, x, z) ? "Enter — go out"
      : entryRoomsPossible(door.entry) ? (door.entry.interior || !door.entry.generatedInteriorRef ? "Enter — go in" : "Enter — go in (its rooms are on their way)")
      : commercialInterior(door.entry) && typeof cityGame === "function" && cityGame() ? "Enter — go into the shop"
      : `Enter — ${door.open ? "close" : "open"} the door`);
  } else if (inside && footprintById.get(String(inside.osm_id))?.interior) {
    setHint("Inside — rooms laid out from a generic plan fitted to this house");
  } else {
    setHint(null);
  }
  updateIndoorGroundCut(x, z);
  updateIndoorLight(insideEntry, x, z);
  if (modelWaiters.length) releaseNearModels();
  // Interiors nobody is near are taken down again.
  for (const entry of interiorsBuilt) {
    const cx = (entry.minX + entry.maxX) / 2, cz = (entry.minZ + entry.maxZ) / 2;
    if (Math.hypot(cx - x, cz - z) > INTERIOR_KEEP_M + Math.hypot(entry.maxX - entry.minX, entry.maxZ - entry.minZ) / 2) removeInterior(entry);
  }
  // Built within INTERIOR_KEEP_M so a step inside is instant, but drawn only from a few metres
  // off: from the street the rooms are behind dark glass, and eight houses' rooms were a
  // quarter of every frame's draws.
  const ex = camera.position.x, ez = camera.position.z;
  for (const entry of interiorsBuilt) {
    if (!entry.interior?.group) continue;
    const dx = Math.max(entry.minX - ex, 0, ex - entry.maxX), dz = Math.max(entry.minZ - ez, 0, ez - entry.maxZ);
    entry.interior.group.visible = Math.hypot(dx, dz) < INTERIOR_DRAW_M;
  }
}

