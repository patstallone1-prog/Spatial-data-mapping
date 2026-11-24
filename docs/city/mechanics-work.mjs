// Work done by hand, on top of the material engine (mechanics.mjs): driving a nail with a hammer,
// digging with a spade, pushing a thing, shoving a person, and carving wood with a knife. Each is
// the engine's own contact laws plus the one law that belongs to the act -- a nail's buckling and
// bending, a soil's cutting and breakout, a pusher's strength and footing, a person's balance -- and
// none is a rule about a particular pair. docs/62-material-mechanics.md ("Work by hand") gives each
// law and its source. Pure: no three.js, no clock, no randomness (tests/mechanics_work.test.mjs).

const DEG = Math.PI / 180, G = 9.81, LB_PER_IN = 175.13; // 1 lb/in = 175.13 N/m
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mmText = (m) => (m < 0.01 ? `${Math.round(m * 10000) / 10} mm` : `${Math.round(m * 1000)} mm`);

//: The numbers of the acts themselves (sources in the catalogue: nail_driving, soil_cutting,
//: push_strength, balance).
export const WORK = Object.freeze({
  //: Bending yield of nail wire (NDS Table 12S / ASTM F1575: 16d common, F_yb = 90 ksi).
  nail_bending_yield_pa: 620e6,
  //: A nail leaning this far is bent over: it will not drive, only bend further.
  bent_deg: 15,
  //: Driving a fresh nail takes a light set tap first (a quarter of a full blow).
  set_tap: 0.25,
  //: A standing adult's horizontal push, none to full strength (N), and how much of it is kept up.
  push_n: [300, 500], sustained: 0.6,
  //: A two-handed shove lasts about this long (s).
  shove_s: 0.15,
  //: Balance: leg length (m), the margin to the edge of the feet standing easy and braced (m), and
  //: the most one recovery step can catch (m/s).
  leg_m: 1.0, margin_easy_m: 0.1, margin_braced_m: 0.25, step_catch_mps: 1.3,
  //: Digging: a digger stands on the spade (their weight) or stamps on it (dropping this far, m);
  //: levers the handle back with this much force (N); a slice is this thick (m); a hole this wide (m2).
  stamp_m: 0.15, lever_n: 250, slice_m: 0.12, hole_m2: 0.16,
  //: Carving: a stroke is this long (m), pushed with this much (N), drawn this much (slice ratio).
  carve_stroke_m: 0.03, carve_push_n: 120, carve_slice: 1.5,
  //: Rolling resistance by what the wheels are (push_strength source).
  rolling: { car: 0.012, bicycle: 0.006, cart: 0.03, bin: 0.04, dolly: 0.02 },
});

//: Terzaghi's bearing factors for a friction angle (degrees).
function bearing(phiDeg) {
  const p = phiDeg * DEG;
  const Nq = Math.exp(Math.PI * Math.tan(p)) * Math.tan(Math.PI / 4 + p / 2) ** 2;
  const Nc = p > 1e-6 ? (Nq - 1) / Math.tan(p) : 5.14;
  return { Nq, Nc, Kp: Math.tan(Math.PI / 4 + p / 2) ** 2, K0: 1 - Math.sin(p) };
}

//: What a ground is called in a sentence.
const GROUND_NAME = { soil_loam: "loam", turf: "turf", forest_duff: "leaf litter", sand: "sand", gravel: "packed gravel", asphalt: "asphalt", concrete: "concrete",
  stucco: "stucco", granite: "stone", clay_brick: "brick", ice: "ice" };

export function createWork(M) {
  const raw = (id) => M.substance(id).raw;

  // ---- hammering a nail in ----------------------------------------------------------------------

  //: A fresh nail started in ``body`` (a wood body from M.body).
  function startNail(nailTool, body, { spot = "nail" } = {}) {
    return { nail: nailTool, body, wood: body, spot, driven_m: 0, work_j: 0, bend_deg: 0, blows: 0, home: false, bent: false, rash: [] };
  }

  //: One hammer blow on a nail. ``angle_deg``: how far the blow is off the nail's axis (0 square).
  //: Only the contact is measured: the face is crowned, so within its crown angle the point of
  //: contact rolls across the head and the push stays along the nail; past it the face lands on its
  //: rim and pushes the head sideways by the slant beyond the crown -- or, past friction, skids off
  //: the head into the wood (hammer rash). The square share of the blow drives the nail by the
  //: engine's point sinking (continuing its hole). While it drives, the head is dragged sideways
  //: with the face: twice the depth gained times the sideways share (the face decelerates along the
  //: nail but not across it). The exposed shank bends over once that passes its yield deflection,
  //: M_y L^2 / 3EI, shrunk by the axial load's share of its buckling load (a column near buckling
  //: bends easily); a square blow bends it only past buckling. Returns { state, outcome, text, ... };
  //: the state is new.
  function drive(hammer, state, { energy_j, angle_deg = 0, grain = "across" }) {
    const s = { ...state, blows: state.blows + 1 };
    const nail = s.nail, L = nail.length_m ?? nail.tip.width[nail.tip.width.length - 1][0];
    const d = nail.tip.width[nail.tip.width.length - 1][1], theta = Math.abs(angle_deg);
    const out = { angle_deg: theta, glanced: false, rash: null, bend_deg: s.bend_deg };
    if (s.home) return { ...out, state: s, outcome: "home", driven_m: 0, text: "it is in already: the head is down" };
    if (s.bent) return { ...out, state: s, outcome: "bent", driven_m: 0, text: `it is bent over ${Math.round(s.bend_deg)}°: draw it out with the claw and start another` };
    // A fresh nail is set with a tap first, so its first blow is light.
    const E = Math.max(0, energy_j) * (s.driven_m < 0.005 ? WORK.set_tap : 1);
    const nsub = M.substance(nail.substance), hsub = M.substance(hammer.substance);
    const mu = M.friction(hsub.family === "metal" ? "steel" : hammer.substance, nail.substance).dynamic;
    const face = hammer.face || { kind: "flat", radius_m: Infinity, diameter_m: 0.025 };
    const crown = face.kind !== "flat" ? 90 : Number.isFinite(face.radius_m) ? Math.asin(clamp(face.diameter_m / 2 / face.radius_m, 0, 1)) / DEG : 0;
    const past = Math.max(0, theta - crown);
    // The head is hard and flat: no dent to hold the rim, so it skids once the slant passes friction.
    const glanced = past > 0 && Math.tan(past * DEG) > mu;
    out.glanced = glanced;
    // The square share drives the nail; on a skid the face still lands its normal share.
    const axial = E * Math.cos(theta * DEG) ** 2;
    // Driving on from where it is: the wood ahead is fresh and the length in rubs, which is the
    // single-blow curve continued -- so the depth is where all the blows' work together sinks it.
    const work = s.work_j + axial;
    const r = M.strike(nail, s.wood, { feature: "tip", energy_j: work, grain, mode: "swing", spot: s.spot, guided: true });
    s.work_j = work;
    const before = s.driven_m;
    let driven = Math.min(L, Math.max(before, r.depth_m));
    // The sideways share: the rim's slant while the face holds (tan), friction's once it skids. The
    // drag stops where the shank's stiffness asks more than friction can pull (a short stub makes
    // the face slip over the head instead).
    const exposed = Math.max(L - before, 1e-3);
    const N = Math.max(r.force_n || 0, 0);
    const share = Math.min(Math.tan(past * DEG), mu);
    const gain = Math.max(0, driven - before);
    const E0 = nsub.raw.E_gpa * 1e9, I = (Math.PI * d ** 4) / 64;
    const Pcr = (Math.PI ** 2 * E0 * I) / (0.7 * exposed) ** 2;
    const My = (WORK.nail_bending_yield_pa * Math.PI * d ** 3) / 32;
    const yieldAt = (My * exposed * exposed) / (3 * E0 * I) * Math.max(1 - N / Pcr, 0);
    const stiff = (3 * E0 * I) / exposed ** 3;
    const drag = Math.min(2 * gain * share, (mu * N) / stiff);
    // A real nail is not perfectly straight: it buckles a little short of Euler's load (0.85).
    const ratio = N >= 0.85 * Pcr ? Infinity : drag / Math.max(yieldAt, 1e-9);
    let outcome = driven >= L - 1e-4 ? "home" : "driven";
    if (ratio >= 1) {
      // Past yield the shank takes a set: a plastic hinge at the wood turned by what the drag
      // carried the head past its yield deflection (buckling: a fifth of the length at once).
      const over = Number.isFinite(ratio) ? drag - yieldAt : exposed * 0.2;
      const turn = Math.atan(over / exposed) / DEG;
      s.bend_deg = Math.min(90, s.bend_deg + turn);
      // What turns the nail is not driving it.
      if (turn > 3) driven = before + (driven - before) * clamp(1 - turn / 30, 0.2, 1);
    }
    s.bent = s.bend_deg >= WORK.bent_deg;
    if (s.bent) outcome = "bent";
    s.body = r.body; s.driven_m = driven; s.home = outcome === "home";
    // A skid carries the face on into the wood beside the head.
    if (glanced) {
      const rash = M.strike(hammer, s.wood, { feature: "face", energy_j: E * Math.sin(theta * DEG) ** 2 * 0.5, angle_deg: 90 - theta, spot: "rash" });
      out.rash = { depth_m: rash.depth_m, kind: rash.mark.kind };
      s.rash = [...s.rash, out.rash];
    }
    // What it holds by when it is in: the NDS withdrawal design formula per length driven.
    const sg = raw(s.body.layers[0].substance).specific_gravity ?? 0.5;
    const holds_n = 1380 * sg ** 2.5 * (d / 0.0254) * LB_PER_IN * s.driven_m;
    const off = theta < 1 ? "square" : `${Math.round(theta)}° off square`;
    const gained = s.driven_m - before;
    const text = outcome === "bent"
      ? `${off}: it bends over (${Math.round(s.bend_deg)}°)${s.bent ? " -- draw it out with the claw" : ""}`
      : glanced ? `${off}: the face skids off the head${out.rash?.depth_m > 2e-4 ? ` and dents the wood ${mmText(out.rash.depth_m)}` : ""}; it goes in ${mmText(gained)}`
      : outcome === "home" ? `${off}: driven home (holds about ${Math.round(holds_n)} N)`
      : `${off}: in ${mmText(gained)} (${Math.round(s.driven_m * 1000)} of ${Math.round(L * 1000)} mm)${s.bend_deg > 3 ? `, leaning ${Math.round(s.bend_deg)}°` : ""}`;
    return { ...out, state: s, outcome, driven_m: gained, total_m: s.driven_m, force_n: N, bend_ratio: ratio, buckling_n: Pcr, crown_deg: crown, holds_n, bend_deg: s.bend_deg, text };
  }

  // ---- digging -------------------------------------------------------------------------------------

  //: One spadeful from ``ground`` (a substance id). The spade goes in under the digger's weight or
  //: a stamp until the soil's cutting resistance -- the edge's bearing (Terzaghi c N_c + gamma z N_q
  //: over the edge), the roots' fracture across the blade, and adhesion and friction on both faces
  //: (at rest, K0) -- matches it; it comes out only as deep as the handle can lever the slice free
  //: (passive breakout, Rankine K_p, about a third of the way up). ``o``: { digger_kg, strength,
  //: wet, hole (the hole so far: { volume_l }) }.
  function dig(spade, ground, o = {}) {
    const sub = raw(ground), bl = spade.blade || { width_m: 0.19, length_m: 0.29, thickness_m: 0.002, handle_m: 1 };
    const kg = o.digger_kg ?? 78, hole = { volume_l: o.hole?.volume_l ?? 0 };
    if (sub.family !== "soil" || !sub.soil) {
      // Not soil: the edge meets a hard surface and the engine says what a stamp does to it.
      const r = M.strike(spade, M.body({ substance: ground, shape: "block", thickness_m: 0.1 }), { feature: "edge", energy_j: kg * G * WORK.stamp_m, mode: "swing" });
      return { outcome: "refused", depth_m: r.depth_m, volume_l: 0, kg: 0, hole, limit: "surface",
        text: `the spade will not go into the ${GROUND_NAME[ground] || String(sub.name || ground).toLowerCase()}${r.depth_m > 2e-4 ? ` (it nicks it ${mmText(r.depth_m)})` : ""}: break it up first` };
    }
    const S = sub.soil, wet = Boolean(o.wet);
    const c = (wet ? (S.wet_cohesion_kpa ?? S.cohesion_kpa * 0.6) : S.cohesion_kpa) * 1e3;
    const phi = S.friction_deg - (wet && !S.wet_cohesion_kpa ? 4 : 0), ca = S.adhesion_kpa * 1e3 * (wet ? 0.6 : 1);
    const gamma = sub.density_kg_m3 * G, delta = S.metal_friction_deg * DEG;
    const { Nq, Nc, Kp, K0 } = bearing(phi);
    const w = bl.width_m, t = bl.thickness_m, R = sub.toughness_j_m2 || 0;
    const force = (z) => w * t * (c * Nc + gamma * z * Nq) + w * R + 2 * w * z * (ca + (K0 * gamma * z / 2) * Math.tan(delta));
    // Pushing in: the weight alone, then a stamp's energy on top (whichever goes deeper).
    const weight = kg * G, stampJ = kg * G * WORK.stamp_m;
    let zW = 0, zE = 0, W = 0;
    const dz = 0.002;
    for (let z = dz; z <= bl.length_m + 1e-9; z += dz) {
      const F = force(z);
      if (F <= weight) zW = z;
      W += F * dz;
      if (W <= stampJ + weight * z) zE = z;
    }
    const zPush = Math.max(zW, zE);
    // Levering out: the slice's passive breakout, its moment about the lip against the handle's.
    const lever = WORK.lever_n * (0.6 + 0.8 * clamp((o.strength ?? 50) / 100, 0, 1)) * bl.handle_m;
    const breakout = (z) => w * (0.5 * gamma * z * z * Kp + 2 * c * z * Math.sqrt(Kp)) * (2 * z / 3);
    let zLever = 0;
    for (let z = dz; z <= bl.length_m + 1e-9; z += dz) if (breakout(z) <= lever) zLever = z;
    const depth = Math.min(zPush, zLever, bl.length_m);
    const limit = depth >= bl.length_m - 1e-9 ? "blade" : zPush <= zLever ? "push" : "lever";
    const volume_l = depth * w * WORK.slice_m * 1000, mass = (volume_l / 1000) * sub.density_kg_m3;
    hole.volume_l += volume_l;
    hole.depth_m = hole.volume_l / 1000 / WORK.hole_m2;
    const what = GROUND_NAME[ground] || String(sub.name).toLowerCase();
    const holds = (sub.toughness_j_m2 || 0) >= 100 ? "the roots hold the rest" : "the soil holds the rest";
    const text = depth < 0.01 ? (limit === "lever" ? `the ${what} is too bound to lever out: cut round it first` : `the spade hardly goes into the ${what}`)
      : `a spadeful of ${what}: ${Math.round(depth * 100)} cm deep, ${volume_l.toFixed(1)} L (${mass.toFixed(1)} kg)${limit === "lever" ? ` -- ${holds}` : limit === "push" ? "" : ", the blade's full depth"}`;
    return { outcome: depth < 0.01 ? "stuck" : "dug", depth_m: depth, push_depth_m: zPush, lever_depth_m: zLever, limit, volume_l, kg: mass, hole, force_n: force(Math.max(depth, dz)), text };
  }

  // ---- pushing a thing, shoving a person ----------------------------------------------------------

  //: The most a pusher can push now: their strength, or their shoes' grip under their weight.
  function pushCapacity({ pusher_kg = 78, strength = 50, shoe = "shoe_rubber", ground = "concrete", wet = false } = {}) {
    const [lo, hi] = WORK.push_n;
    const strong = lo + (hi - lo) * clamp(strength / 100, 0, 1);
    const grip = M.friction(shoe, ground, { wet }).static * pusher_kg * G;
    return { n: Math.min(strong, grip), strength_n: strong, grip_n: grip, limit: grip < strong ? "footing" : "strength" };
  }

  //: Pushing ``thing``: { name, mass_kg, wheels: kind (WORK.rolling) | null, braked, base (its
  //: substance, for sliding), ground, slope_deg (up in the push's direction), wet }. A thing on
  //: wheels needs its rolling resistance; braked or without wheels it slides on its base (or its
  //: tyres). Returns { moves, need_n, push_n, limit, speed_mps, text }.
  function push(thing, pusher = {}) {
    const ground = thing.ground ?? "concrete", wet = Boolean(thing.wet), m = thing.mass_kg, a = (thing.slope_deg ?? 0) * DEG;
    const cap = pushCapacity({ ...pusher, ground, wet });
    let r, how;
    if (thing.wheels && !thing.braked) { r = WORK.rolling[thing.wheels] ?? 0.03; how = "rolls"; }
    else { r = M.friction(thing.wheels ? "rubber_tread" : thing.base ?? "steel", ground, { wet }).static; how = thing.wheels ? "skids on locked wheels" : "slides"; }
    const need = m * G * (r * Math.cos(a) + Math.sin(a));
    const name = String(thing.name || "it").toLowerCase();
    if (cap.n < need) {
      return { moves: false, need_n: need, push_n: cap.n, limit: cap.limit, speed_mps: 0, how,
        text: `the ${name} will not budge: it takes about ${Math.round(need)} N${thing.braked ? " (its brakes are on)" : ""}, ${cap.limit === "footing" ? `and your feet slip at ${Math.round(cap.n)} N` : `and you push ${Math.round(cap.n)} N`}` };
    }
    // Kept up, the push accelerates it against its rolling or sliding (dynamic) resistance.
    const kept = cap.n * WORK.sustained, dyn = how === "rolls" ? need : need * 0.85;
    const acc = Math.max(0, kept - dyn) / m;
    const speed = Math.min(1.4, acc * 1.0);
    return { moves: true, need_n: need, push_n: cap.n, limit: cap.limit, speed_mps: speed, how,
      text: speed < 0.05 ? `the ${name} ${how === "rolls" ? "creeps" : "shifts"} a little: it takes about ${Math.round(need)} N to start and you can keep up only ${Math.round(kept)} N`
        : `the ${name} ${how} (${speed.toFixed(1)} m/s after a second's push)` };
  }

  //: A two-handed shove at someone: { mass_kg, braced }. Their centre of mass is set moving at J/m;
  //: it carries past their feet in sqrt(leg/g) (the extrapolated centre of mass): within the margin
  //: they rock, past it they take a step back, past what one step catches they fall.
  function shove(person, pusher = {}) {
    const cap = pushCapacity(pusher);
    const m = person.mass_kg ?? 75, v = (cap.n * WORK.shove_s) / m;
    const reach = v * Math.sqrt(WORK.leg_m / G), margin = person.braced ? WORK.margin_braced_m : WORK.margin_easy_m;
    const catchV = WORK.step_catch_mps * (person.braced ? 1.3 : 1) * (person.frail ? 0.6 : 1);
    const outcome = reach <= margin ? "rocks" : v <= catchV ? "staggers" : "falls";
    return { outcome, speed_mps: v, reach_m: reach, push_n: cap.n,
      text: outcome === "rocks" ? "they rock back on their heels" : outcome === "staggers" ? "they stagger back a step" : "they go over backwards" };
  }

  // ---- carving -------------------------------------------------------------------------------------

  //: A stroke of a knife across ``body`` (wood). The hand leans the blade ``rake_deg`` off the
  //: surface and pushes: the share across the surface presses the edge in, the rest draws it
  //: along. Only the edge's own sharpness decides whether it bites: below the force to start a cut
  //: in that wood (the engine's initiationForce, which grows with the edge's radius) it skates;
  //: above it, it sinks until the cut's resistance takes the whole press (a force-limited cut, so
  //: a stroke takes a shaving, not a blow's depth). ``o``: { grain ("along" whittles, "across"
  //: chips against the fibres), rake_deg, push_n, carved_mm3 (so far) }.
  function carve(knife, body, o = {}) {
    const push_n = o.push_n ?? WORK.carve_push_n, rake = o.rake_deg ?? 25, grain = o.grain ?? "along";
    const press = push_n * Math.sin(rake * DEG);
    const start = M.initiationForce(knife, body, { feature: "edge", grain, slice: WORK.carve_slice });
    const width = Math.min(knife.edge.contact_length_m, 0.012);
    if (press < start) {
      return { outcome: "skate", depth_m: 0, mm3: 0, carved_mm3: o.carved_mm3 ?? 0, press_n: press, start_n: start, tool: knife, body,
        text: `the edge skates: it needs ${Math.round(start)} N pressed in to bite${knife.damage && knife.damage !== "none" ? ` (it is ${knife.damage})` : ""}, you press ${Math.round(press)} N` };
    }
    const pressed = { ...knife, grip_limit_n: press };
    const r = M.strike(pressed, body, { feature: "edge", energy_j: (push_n * WORK.carve_stroke_m) / (1 - M.constants.handheld_loss), mode: "thrust", slice: WORK.carve_slice, grain });
    const mm3 = r.depth_m * width * WORK.carve_stroke_m * 1e9;
    const total = (o.carved_mm3 ?? 0) + mm3;
    const text = mm3 < 1 ? `it barely marks the ${grain === "along" ? "grain" : "wood"}`
      : `${grain === "along" ? "a shaving" : "a chip"} ${mmText(r.depth_m)} thick (${Math.round(total)} mm³ carved)`;
    return { outcome: mm3 < 1 ? "mark" : "shaving", depth_m: r.depth_m, mm3, carved_mm3: total, press_n: press, start_n: start,
      tool: { ...r.tool, grip_limit_n: knife.grip_limit_n }, body: r.body, text };
  }

  return { startNail, drive, dig, push, shove, pushCapacity, carve, constants: WORK };
}
