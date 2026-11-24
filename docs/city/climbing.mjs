// Climbing as statics: whether a body can hold still on what its hands and feet touch, worked out
// from the same material mechanics as every other contact (docs/city/mechanics.mjs). Nothing here
// knows what a wall or a fence is: a climber is a weight at a centre of mass held by up to four
// contacts, each pushing along its surface's normal (or pulling off it, as far as an adhesive lets
// it), each sliding past its friction cone, each limited by what the limb can bear on that hold.
// A small linear programme finds the contact forces that balance the weight and its moment with the
// least worst share of any limb's strength; that share is the effort, and it holds while it is at
// most 1. docs/62-material-mechanics.md and docs/63-context-controls-and-hints.md say how a game uses it.
//
// Holds are described as they sit in the world, not on the wall: ``slope_deg`` is the slant of the
// gripped surface from level, positive sloping down and away (a sloper), negative tilting in (an
// incut jug). A flat ledge is 0 whatever the wall does. "none" (or a foot "smear") is the wall's own
// face: the limb presses on it and only friction holds it.

const G = 9.81, DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

//: The body and strength figures (sources: docs/object-catalogue.json mechanics "finger_strength").
function steps(a, b, d) { const out = []; for (let v = a; v <= b + 1e-9; v += d) out.push(Math.round(v * 1000) / 1000); return out; }

export const CLIMBER = Object.freeze({
  //: Bodyweight the strength figures are counted against (a 75 kg adult).
  reference_kg: 75,
  //: One hand on a 20 mm flat edge (half crimp), as a share of reference bodyweight, from strength
  //: 0 to 100: two hands make 0.4-1.6 bodyweights (untrained 0.5-0.65, elite 1.3-1.6).
  edge20_share: [0.2, 0.8],
  //: Edge depth at which a hand's hold is reckoned, and how it falls off for shallower edges
  //: (force about the square root of depth below 20 mm; more than the fingers' pads gains little).
  edge_ref_m: 0.02, edge_power: 0.6, edge_max_gain: 1.2,
  //: One hand wrapped round a jug (a bar, a branch), as a share of bodyweight: everyone can hang
  //: from two; the strongest from one.
  jug_share: [0.55, 1.2],
  //: An open hand on a sloper bears like a jug: friction, not the fingers, is its limit.
  sloper_share: 0.9,
  //: A palm or a shoe pressed flat on a face, and a leg on a foothold (shares of bodyweight).
  press_share: [0.4, 0.9], leg_share: [1.2, 2.2],
  //: How the body sits: hands this share of height above the feet along the wall, the centre of
  //: mass this share of the way up between them and this far off the wall's face.
  reach_share: 0.9, com_share: 0.55, com_off_m: 0.3,
  //: The postures a climber picks between: hips this far off the wall (from chest against it to
  //: leant back on bent arms), hands this share of height above the feet (from a high step to a
  //: full stretch). Posture is continuous; a 5 cm step finds the best to within about 1 %.
  postures: { off_m: steps(0.05, 0.6, 0.05), reach_share: steps(0.7, 1.0, 0.05) },
});

// ---- a small linear programme -------------------------------------------------------------------

//: Minimise c.x subject to A_eq x = b_eq, A_ub x <= b_ub, x >= 0. Dense two-phase simplex with
//: Bland's rule (the problems here have a dozen variables). Returns { x, value } or null.
export function linprog(c, Aeq, beq, Aub, bub) {
  const n = c.length, rows = [], rhs = [];
  let slacks = 0, arts = 0;
  const kinds = [];
  for (let i = 0; i < Aub.length; i++) { const flip = bub[i] < 0; rows.push(Aub[i].map((v) => (flip ? -v : v))); rhs.push(Math.abs(bub[i])); kinds.push(flip ? "ge" : "le"); }
  for (let i = 0; i < Aeq.length; i++) { const flip = beq[i] < 0; rows.push(Aeq[i].map((v) => (flip ? -v : v))); rhs.push(Math.abs(beq[i])); kinds.push("eq"); }
  const m = rows.length;
  for (const k of kinds) { if (k !== "eq") slacks++; if (k !== "le") arts++; }
  const W = n + slacks + arts;
  const T = [], basis = [];
  let si = n, ai = n + slacks;
  for (let i = 0; i < m; i++) {
    const row = new Array(W + 1).fill(0);
    for (let j = 0; j < n; j++) row[j] = rows[i][j];
    if (kinds[i] === "le") { row[si] = 1; basis.push(si++); }
    else if (kinds[i] === "ge") { row[si++] = -1; row[ai] = 1; basis.push(ai++); }
    else { row[ai] = 1; basis.push(ai++); }
    row[W] = rhs[i];
    T.push(row);
  }
  const EPS = 1e-9;
  const pivot = (r, col) => {
    const p = T[r][col];
    for (let j = 0; j <= W; j++) T[r][j] /= p;
    for (let i = 0; i < m; i++) if (i !== r && Math.abs(T[i][col]) > EPS) { const f = T[i][col]; for (let j = 0; j <= W; j++) T[i][j] -= f * T[r][j]; }
    basis[r] = col;
  };
  const run = (cost, allowed) => {
    for (let it = 0; it < 500; it++) {
      // Reduced costs.
      let enter = -1;
      for (let j = 0; j < W; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        let rc = cost[j] || 0;
        for (let i = 0; i < m; i++) rc -= (cost[basis[i]] || 0) * T[i][j];
        if (rc < -EPS) { enter = j; break; }
      }
      if (enter < 0) return true;
      let leave = -1, best = Infinity;
      for (let i = 0; i < m; i++) if (T[i][enter] > EPS) { const ratio = T[i][W] / T[i][enter]; if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[leave])) { best = ratio; leave = i; } }
      if (leave < 0) return false; // unbounded
      pivot(leave, enter);
    }
    return true;
  };
  // Phase 1: drive the artificials out.
  const c1 = new Array(W).fill(0);
  for (let j = n + slacks; j < W; j++) c1[j] = 1;
  run(c1, () => true);
  let infeas = 0;
  for (let i = 0; i < m; i++) if (basis[i] >= n + slacks) infeas += T[i][W];
  if (infeas > 1e-6) return null;
  // Pivot any artificial still basic (at zero) out where it can be.
  for (let i = 0; i < m; i++) if (basis[i] >= n + slacks) { const j = T[i].findIndex((v, k) => k < n + slacks && Math.abs(v) > EPS); if (j >= 0) pivot(i, j); }
  const c2 = new Array(W).fill(0);
  for (let j = 0; j < n; j++) c2[j] = c[j];
  if (!run(c2, (j) => j < n + slacks)) return null;
  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = T[i][W];
  return { x, value: c.reduce((s, v, j) => s + v * x[j], 0) };
}

// ---- statics of a body on contacts --------------------------------------------------------------

//: Can a weight at ``com`` (x, y; y up) be held by ``contacts``? Each: { at: [x, y], normal: [nx, ny]
//: (out of the surface, toward the body), mu, capacity_n (the most the limb bears along the
//: normal), adhesion_n (sliding grip that needs no push), pull_n (how hard it can pull off the
//: surface) }. Returns { holds, effort (the worst limb's share of its capacity), forces }. A
//: limb's capacity bounds the size of its whole force, push and slide together.
export function balance({ weight_n, com, contacts }) {
  const k = contacts.length;
  if (!k) return { holds: false, effort: Infinity, forces: [], reason: "nothing to hold" };
  // Variables per contact: n' = N + pull (>= 0), t+ and t- (>= 0); then s (the effort).
  const nv = 3 * k + 1, S = 3 * k;
  const Aeq = [new Array(nv).fill(0), new Array(nv).fill(0), new Array(nv).fill(0)];
  const beq = [0, weight_n, weight_n * com[0]];
  const Aub = [], bub = [];
  contacts.forEach((c, i) => {
    const [nx, ny] = c.normal, tx = -ny, ty = nx, [x, y] = c.at, pull = c.pull_n || 0;
    const cols = [[3 * i, nx, ny], [3 * i + 1, tx, ty], [3 * i + 2, -tx, -ty]];
    for (const [j, fx, fy] of cols) { Aeq[0][j] += fx; Aeq[1][j] += fy; Aeq[2][j] += x * fy - y * fx; }
    // The pull-off offset moves the constant to the right-hand side.
    beq[0] += pull * nx; beq[1] += pull * ny; beq[2] += pull * (x * ny - y * nx);
    // Friction cone (with any adhesive grip): t+ + t- <= mu N + adhesion.
    const row = new Array(nv).fill(0); row[3 * i + 1] = 1; row[3 * i + 2] = 1; row[3 * i] = -c.mu;
    Aub.push(row); bub.push((c.adhesion_n || 0) - c.mu * pull);
    // Limb strength bounds the whole force, not just its push: |F| <= s capacity, as a polygon
    // (N cos a + |T| sin a <= s capacity for a = 0 to 90 degrees in steps: within 2% of the circle).
    for (const a of [0, 22.5, 45, 67.5, 90]) {
      const ca = Math.cos(a * DEG), sa = Math.sin(a * DEG), cap = new Array(nv).fill(0);
      cap[3 * i] = ca; cap[3 * i + 1] = sa; cap[3 * i + 2] = sa; cap[S] = -Math.max(c.capacity_n, 1e-6) / Math.cos(11.25 * DEG);
      Aub.push(cap); bub.push(pull * ca);
    }
  });
  const cost = new Array(nv).fill(0); cost[S] = 1;
  const sol = linprog(cost, Aeq, beq, Aub, bub);
  if (!sol) return { holds: false, effort: Infinity, forces: [], reason: "no balance: friction and the holds' angles cannot hold the weight" };
  const forces = contacts.map((c, i) => ({ normal_n: sol.x[3 * i] - (c.pull_n || 0), tangent_n: sol.x[3 * i + 1] - sol.x[3 * i + 2] }));
  const effort = sol.x[S];
  return { holds: effort <= 1 + 1e-9, effort, forces };
}

// ---- a climber on a wall -------------------------------------------------------------------------

export function createClimbing(M, figures = CLIMBER) {
  const F = figures;
  const lerp = (a, s) => a[0] + (a[1] - a[0]) * clamp(s / 100, 0, 1);

  //: What a limb can bear on a hold (N along its normal), for a climber of ``strength``.
  function capacity(limb, hold, strength) {
    const BW = F.reference_kg * G;
    if (limb === "foot") {
      const leg = lerp(F.leg_share, strength) * BW;
      if (!hold || hold === "smear" || hold.kind === "none") return lerp(F.press_share, strength) * BW * 2;
      return leg * clamp(Math.sqrt((hold.depth_m ?? 0.02) / 0.01), 0.2, 1);
    }
    const kind = hold?.kind ?? "none";
    if (kind === "none") return lerp(F.press_share, strength) * BW;
    if (kind === "jug") return lerp(F.jug_share, strength) * BW;
    if (kind === "sloper") return F.sloper_share * lerp(F.jug_share, strength) * BW;
    const depth = Math.max(hold.depth_m ?? 0.02, 0);
    return lerp(F.edge20_share, strength) * BW * clamp((depth / F.edge_ref_m) ** F.edge_power, 0, F.edge_max_gain);
  }

  //: The contacts and centre of mass for one posture (hips ``off`` the wall, hands at ``reach``
  //: of height above the feet).
  function stance({ wall, hands, feet, climber, stem }, off, reachShare) {
    const height = climber.height_m ?? 1.75, strength = climber.strength ?? 20;
    const th = (wall.angle_deg ?? 0) * DEG;
    // Wall frame: u runs up the wall's face, n out of it toward the climber.
    const u = [Math.sin(th), Math.cos(th)], n = [Math.cos(th), -Math.sin(th)];
    const reach = reachShare * height;
    const handAt = [u[0] * reach, u[1] * reach], footAt = [0, 0];
    const cond = { wet: wall.wet, temperature_c: wall.temperature_c };
    const contacts = [], labels = [];
    const gap = stem?.gap_m ?? 0;
    const add = (limb, hold, at, side, index) => {
      const onFace = !hold || hold === "smear" || hold.kind === "none";
      const surfaceSub = (!onFace && hold.substance) || wall.substance;
      const who = limb === "hand" ? climber.hands ?? "skin" : climber.feet ?? "shoe_rubber";
      const area = M.contactor(who).area_m2 ?? 0;
      const f = M.friction(who, surfaceSub, { ...cond, wet: hold?.wet ?? cond.wet, area_m2: area });
      let normal;
      if (onFace) normal = side ? [-n[0], -n[1]] : n;
      else {
        // A hold's gripped surface, by its slant from level: + slopes down and away from the wall's
        // face, - tilts in. "Away" is the direction the climber hangs out from the wall.
        const away = side ? -1 : 1, a = (hold.slope_deg ?? 0) * DEG;
        normal = [Math.sin(a) * away, Math.cos(a)];
      }
      // A hold stands out of the face: the limb bears on the middle of its top, half its depth out.
      const out = onFace ? 0 : (hold.recessed ? 0 : (hold.depth_m ?? 0) / 2) * (side ? -1 : 1);
      const base = side ? [at[0] + n[0] * gap, at[1] + n[1] * gap] : at;
      const pos = [base[0] + n[0] * out, base[1] + n[1] * out];
      contacts.push({ at: pos, normal, mu: f.static, adhesion_n: f.adhesive_n, pull_n: 0.25 * f.adhesive_n, capacity_n: capacity(limb, onFace ? null : hold, strength) });
      labels.push(`${limb} ${index + 1}`);
    };
    hands.forEach((h, i) => add("hand", h, handAt, Boolean(stem) && i === 1, i));
    feet.forEach((f, i) => add("foot", f, footAt, Boolean(stem) && i === 1, i));
    // The centre of mass: off the wall between hands and feet; with nothing for the feet the body
    // hangs straight down from its hands.
    let com;
    if (stem) com = [u[0] * reach * F.com_share + n[0] * gap / 2, u[1] * reach * F.com_share + n[1] * gap / 2];
    else if (!feet.length) com = [handAt[0], handAt[1] - 0.9];
    else com = [u[0] * reach * F.com_share + n[0] * off, u[1] * reach * F.com_share + n[1] * off];
    return { contacts, labels, com };
  }

  //: The best of the postures a climber can take (hips nearer or further off the wall, arms more or
  //: less bent): the one asking least of the worst-loaded limb.
  function best(spec, kg) {
    let top = null;
    const offs = spec.feet.length && !spec.stem ? F.postures.off_m : [F.com_off_m];
    for (const off of offs) for (const reachShare of F.postures.reach_share) {
      const st = stance(spec, off, reachShare);
      const r = balance({ weight_n: kg * G, com: st.com, contacts: st.contacts });
      if (!top || r.effort < top.effort) top = { ...r, contacts: st.contacts, labels: st.labels, posture: { hips_off_wall_m: off, reach_share: reachShare } };
    }
    return top;
  }

  //: Whether the climber holds still, and whether they can climb: { holds (all limbs on, still),
  //: effort (the worst limb's share of its strength; holds while at most 1), limiting (that limb),
  //: climbable (each limb can let go in turn while the rest hold: the three points of contact a move
  //: needs), releases (which can), posture, forces, contacts }. ``wall``: { angle_deg (0 vertical,
  //: + overhanging, 90 a roof, - a slab), substance, wet, temperature_c }. ``hands``: holds; ``feet``:
  //: holds or "smear"; ``climber``: { kg, height_m, strength (0-100), load_kg, hands (contactor),
  //: feet (contactor) }; ``stem``: { gap_m } for a second, facing wall.
  function climb({ wall, hands = [], feet = [], climber = {}, stem = null }) {
    const kg = (climber.kg ?? 75) + (climber.load_kg ?? 0);
    const spec = { wall, hands, feet, climber, stem };
    const r = best(spec, kg);
    let limiting = "friction";
    if (r.forces.length) {
      let worst = -1;
      r.forces.forEach((f, i) => { const share = Math.hypot(f.normal_n, f.tangent_n) / r.contacts[i].capacity_n; if (share > worst) { worst = share; limiting = r.labels[i]; } });
    }
    const releases = {};
    if (r.holds) {
      hands.forEach((_, i) => { releases[`hand ${i + 1}`] = best({ ...spec, hands: hands.filter((__, j) => j !== i) }, kg).holds; });
      feet.forEach((_, i) => { releases[`foot ${i + 1}`] = best({ ...spec, feet: feet.filter((__, j) => j !== i) }, kg).holds; });
    }
    const climbable = r.holds && Object.values(releases).every(Boolean) && hands.length + feet.length >= 2;
    return { holds: r.holds, effort: r.effort, limiting, climbable, releases, posture: r.posture, forces: r.forces, contacts: r.contacts, reason: r.reason };
  }

  return { climb, capacity, balance, figures: F };
}
