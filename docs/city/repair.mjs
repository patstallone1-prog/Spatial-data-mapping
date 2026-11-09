// What breaks stays broken, then is boarded up, then is mended (rules.json repair): broken for
// half a day, plywood planks nailed over the hole after ``boarded_after_hours``, and back as it
// was within ``restored_within_days`` -- each break its own day for that within the window, from
// its id. Not triggered yet: nothing in the city breaks a window or a door so far. When something
// does, it asks repairStage for what to draw over the damage, and boardedPlanks for the planks.
// The stage is pure (tests/city_repair.test.mjs); the planks need THREE.

import { rng } from "./people.mjs";

const HOUR = 3_600_000;

//: Where a break at ``brokenAt`` (ms) stands at ``now``: "broken", "boarded" or "restored", when
//: each stage began and ends, and (boarded) how far the planks are on (0..1 over planks_s).
export function repairStage(R, id, brokenAt, now) {
  const P = R.repair;
  const boardAt = brokenAt + P.boarded_after_hours * HOUR;
  const last = brokenAt + P.restored_within_days * 24 * HOUR;
  // Mended some time after the boarding, by the end of the window at the latest.
  const share = P.restored_from_share + rng(String(id), "mend")() * (1 - P.restored_from_share);
  const restoreAt = Math.round(boardAt + (last - boardAt) * share);
  if (now < brokenAt) return { stage: "intact", boardAt, restoreAt };
  if (now < boardAt) return { stage: "broken", since: brokenAt, until: boardAt, boardAt, restoreAt };
  if (now < restoreAt) return { stage: "boarded", since: boardAt, until: restoreAt, boardAt, restoreAt, planks: Math.min(1, (now - boardAt) / (P.planks_s * 1000)) };
  return { stage: "restored", since: restoreAt, boardAt, restoreAt };
}

//: The planks over an opening ``w`` wide and ``h`` high, in its own frame (centre at the origin,
//: facing +z): rough boards across it at a slant, a couple crossing them, each with its nails.
//: ``k`` (0..1, repairStage's ``planks``) puts them up one after another: each swings in from
//: below and is nailed flat, so a fresh boarding is seen going up.
export function boardedPlanks(THREE, w, h, { seed = "planks", k = 1 } = {}) {
  const g = new THREE.Group();
  g.name = "boarded-planks";
  const r = rng(String(seed), "planks");
  const wood = [0xb08a5a, 0xa47c4c, 0xc29b6b, 0x9b7448];
  const mats = wood.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const nail = new THREE.MeshLambertMaterial({ color: 0x55585c });
  const board = 0.2, thick = 0.025;
  const rows = Math.max(2, Math.round(h / 0.32));
  const planks = [];
  for (let i = 0; i < rows; i += 1) {
    const y = -h / 2 + (i + 0.5) * (h / rows), tilt = (r() - 0.5) * 0.12;
    planks.push({ y, tilt, len: w + 0.18, z: thick / 2 });
  }
  // Two across the others, corner to corner, holding them.
  const diag = Math.atan2(h, w), len = Math.hypot(w, h) + 0.1;
  planks.push({ y: 0, tilt: diag, len, z: thick * 1.5 }, { y: 0, tilt: -diag, len, z: thick * 2.5 });
  planks.forEach((p, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.len, board, thick), mats[Math.floor(r() * mats.length) % mats.length]);
    const pivot = new THREE.Group();
    pivot.position.set(0, p.y, p.z);
    pivot.rotation.z = p.tilt;
    pivot.add(mesh);
    for (const s of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 6).rotateX(Math.PI / 2), nail);
      n.position.set(s * (p.len / 2 - 0.08), 0, thick / 2 + 0.004);
      mesh.add(n);
    }
    pivot.userData.order = i / planks.length;
    g.add(pivot);
  });
  placePlanks(g, k);
  return g;
}

//: The planks ``k`` of the way up (0: none yet, 1: all nailed flat).
export function placePlanks(g, k) {
  const n = g.children.length;
  g.children.forEach((pivot, i) => {
    const u = Math.max(0, Math.min(1, k * n - i));        // this plank's own 0..1
    pivot.visible = u > 0;
    const mesh = pivot.children[0];
    if (!mesh) return;
    // Swung up from hanging off its left nail to flat against the opening.
    mesh.rotation.z = (1 - u) * -1.1;
    mesh.position.z = (1 - u) * 0.12;
  });
  return g;
}
