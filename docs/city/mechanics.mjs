// Material mechanics: what happens when one thing meets another, worked out from what each is made
// of and the shapes that meet -- never from a rule about a particular pair. A knife and a tree, an
// axe and a log, a club and a window, a climber's fingers and a ledge are all the same few laws
// applied to the object catalogue's substances (docs/object-catalogue.json "mechanics"; figures and
// their sources there) and to an implement's geometry. docs/62-material-mechanics.md explains each
// law, its source and its limits. Pure: no three.js, no clock, no randomness.
//
// Laws, in the order a contact meets them:
//  * Friction is adhesive (true contact area: best on smooth, clean, dry surfaces), hysteretic
//    (deforming over texture: best on rough ones) and boundary; water cuts the adhesive share where
//    the texture cannot drain it, ice near melting wets itself, chalk dries sweat, dry adhesives
//    stick by shear over their area on smooth surfaces only.
//  * An edge or a point sinks in against a force that is the sum of (Atkins 2009): the material's
//    fracture energy over the new cut, the pressure the rounded apex needs to make the material give
//    (it flows at its hardness, or fails at its failure strain), the wedge pushing the cut faces apart
//    (a crush pressure that depends on the grain, or the elastic opening of the cut), and friction on
//    the flanks. If merely indenting is cheaper than separating, the material dents instead of being
//    cut. The energy of the blow, the force the hand and the tool's own point can carry, the blade's
//    length and the body's thickness end it.
//  * A wedge drives a crack ahead of itself: it runs while the flank load keeps the stress
//    intensity above the plane's toughness; in a round struck on its end the halves bend open like a
//    double cantilever under the wedge's thickness and the round splits through.
//  * Hard sharp contacts crack brittle things (Lawn, Evans & Marshall); a tempered pane falls to dice
//    once a crack passes its compressed skin.
//  * A blunt face meets the surface elastically (Hertz), then plastically at the softer side's
//    hardness. A plate shares the blow with its own mass and bends; glass breaks when the bending,
//    or the bending of the patch under the face, passes its strength (plus temper); a steel plate
//    bends only past its plastic collapse load. The striking thing is a body too: a bottle breaks on
//    the same terms.
//  * The tool pays: its apex flattens where the work is harder than it, rolls (or, if brittle,
//    chips) where the apex's bending stress passes its strength, wears with abrasive grit, and its
//    point bends where it meets something it cannot sink into.
//  * A body keeps its marks. Cuts across the fibres sever them; a round's strength is the section
//    modulus of what is left, so a notch weakens a trunk and a slit along the grain hardly does. A
//    tree stands while its strength exceeds what its own weight asks of it (felling: a hinge of a
//    tenth of the diameter).

const DEG = Math.PI / 180, MPA = 1e6, GPA = 1e9, HV = 9.807e6, JANKA_AREA = 1e-4, JANKA_BALL = 0.01128;
//: Wood's bearing pressure under the finest contacts, as a multiple of its Janka pressure (cell walls).
const WOOD_BEARING_CAP = 10;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

//: The engine's own constants: each is a property of the laws above, not of any material or case.
export const CONSTANTS = Object.freeze({
  //: Share of an apex's load that acts sideways in a well-aimed stroke (misalignment, asymmetry).
  lateral_share: 0.05,
  //: Extra sideways share per unit sine of the strike's slant.
  oblique_lateral: 0.3,
  //: Closure pressure of crushed material on the flanks behind the wedge, as a share of its crush
  //: pressure: set from the NDS nail-withdrawal formula (tests/mechanics.test.mjs checks it).
  flank_recovery: 0.45,
  //: Share of a hand-delivered blow lost in the wrist, the grip and the tool's own vibration.
  handheld_loss: 0.2,
  //: Flaw size that sets a brittle material's strength under a point or an apex (m).
  micro_flaw_m: 1e-6,
  //: Shallower than this a mark is a scratch (m).
  scratch_m: 2e-4,
  //: A cut at least this wide at the surface, and this wide for its depth, reads as a wedge (V) kerf.
  wedge_width_m: 3e-3, wedge_ratio: 0.12,
  //: Archard coefficient of two-body abrasion by grit as hard as the tool (Rabinowicz: 1e-2 to 1e-1).
  wear_coefficient: 1e-2,
  //: Two cuts this many degrees apart in a notch pop the chip between them.
  chip_tilt_deg: 30,
  //: What a standing trunk's own weight and lean ask of its bending strength (a felling hinge).
  tree_demand: 0.015,
  //: Friction of a water film itself (boundary lubrication).
  wet_boundary: 0.06,
  //: A brittle crack this long reads as a crack, not a chip (m).
  crack_m: 3e-4,
  //: An edge counts as damaged (dulled or rolled) once its radius has doubled: the force to start
  //: a cut rises about in proportion to the radius (McCarthy et al. 2007), so the next cut takes
  //: twice the push. Its radius is kept exactly either way.
  noticed_radius: 2,
  //: The chamfer round a flat striking face's rim (m): a hammer's face is ground with about a
  //: 1.5 mm bevel so that a canted blow lands on a rounded rim, not a corner.
  face_rim_m: 1.5e-3,
});

// ---- substances ------------------------------------------------------------------------------

function prepare(id, r) {
  if (!r) return null;
  const base = { id, name: r.name, family: r.family, rho: r.density_kg_m3 ?? 0, surface: r.surface || { smoothness: 0.5, texture: 0.3, energy: 0.6 }, raw: r };
  if (r.family === "fluid") return { ...base, fluid: true };
  const E = (r.E_gpa ?? 1) * GPA, nu = r.nu ?? 0.3, Ep = E / (1 - nu * nu);
  const g = r.grain ? {
    cpar: r.grain.compression_parallel_mpa * MPA, cperp: r.grain.compression_perp_mpa * MPA, shear: r.grain.shear_parallel_mpa * MPA,
    tperp: r.grain.tension_perp_mpa * MPA, Hside: r.grain.side_hardness_n / JANKA_AREA, Ralong: r.grain.toughness_along_j_m2, Racross: r.grain.toughness_across_j_m2,
  } : null;
  const Eperp = r.E_perp_gpa != null ? r.E_perp_gpa * GPA : E;
  const plastic = !["tissue", "elastomer", "fabric", "food", "plant"].includes(r.family) || r.hardness_mpa != null || r.hardness_hv != null;
  let H = r.hardness_mpa != null ? r.hardness_mpa * MPA : r.hardness_hv != null ? r.hardness_hv * HV : g ? g.Hside : null;
  const uts = (r.uts_mpa ?? 0) * MPA;
  const yieldPa = r.yield_mpa != null ? r.yield_mpa * MPA : H != null ? H / 3 : uts;
  if (H == null) H = plastic ? 3 * yieldPa : Infinity;
  const K = r.fracture_toughness_mpa_m != null ? r.fracture_toughness_mpa_m * MPA : Math.sqrt(Ep * (r.toughness_j_m2 ?? 0));
  const Gc = r.toughness_j_m2 ?? (K * K) / Ep;
  const brittle = Boolean(r.brittle);
  const epsF = r.failure_strain ?? (uts > 0 ? uts / E : 0.01);
  // Under a point or an apex a brittle solid fails at the strength its smallest flaws allow.
  const sigmaLocal = brittle ? Math.max(uts, K / Math.sqrt(Math.PI * CONSTANTS.micro_flaw_m)) : null;
  // The pressure that makes it give under an apex: it flows at its hardness, or it fails at its
  // failure strain (soft solids: an apex must stretch them that far first).
  const Eside = g ? Eperp : E;
  const pEdge = Math.min(H, Math.PI * Eside * (brittle ? sigmaLocal / E : epsF));
  return {
    ...base, E, Ep, Eperp, nu, H, yield: yieldPa, uts, K, Gc, brittle, epsF, sigmaLocal, pEdge, grain: g,
    comp: r.compressive_mpa != null ? r.compressive_mpa * MPA : null,
    Habr: r.abrasive_hardness_hv != null ? r.abrasive_hardness_hv * HV : Math.min(H, 2 * GPA),
    pointStrength: (r.point_strength_mpa ?? r.uts_mpa ?? 0) * MPA, residual: (r.residual_compression_mpa ?? 0) * MPA,
    compressionDepth: r.compression_depth_share ?? 0, fragments: r.fragments || null,
    damagePressure: r.damage_pressure_mpa != null ? r.damage_pressure_mpa * MPA : null,
    melts: r.melts_c ?? null, premeltFrom: r.premelt_from_c ?? null,
  };
}

//: The properties that matter for a cut in one direction. ``grain``: "across" (the cut plane
//: crosses the fibres: a chop into a trunk's side), "along" (the plane holds the fibres: a blade
//: held along a trunk, or one splitting a board), "end" (into the end grain). Isotropic substances
//: ignore it.
function directional(s, grain = "across") {
  if (s.grain) {
    const g = s.grain, across = grain === "across", end = grain === "end";
    const pc = end ? Math.max(s.pEdge, g.cpar) : s.pEdge;
    const R = across ? g.Racross : g.Ralong;
    const Eopen = across ? s.E : s.Eperp;
    // Wood bears harder the narrower what presses it (Eurocode 5 embedment, f_h = 0.082 rho d^-0.3,
    // which is the Janka pressure at the Janka ball's 11.28 mm), up to its cell walls' strength.
    const pcAt = (w) => pc * clamp((Math.max(w, 1e-7) / JANKA_BALL) ** -0.3, 0.5, WOOD_BEARING_CAP);
    return { pc, pcAt, flows: true, qPlastic: across ? g.cpar : g.cperp, R, Eopen, K: Math.sqrt((Eopen / (1 - s.nu * s.nu)) * R), plane: across ? "across" : "along" };
  }
  // What flows is pushed aside at its hardness; a soft elastic solid is stretched aside until it
  // tears, so its sides bear no more than its tensile strength (and it is never merely dented).
  const flows = Number.isFinite(s.H);
  return { pc: s.pEdge, pcAt: () => s.pEdge, flows, qPlastic: flows ? s.H : Math.max(s.uts, 1), R: s.Gc, Eopen: s.E, K: s.K, plane: "isotropic" };
}

// ---- piecewise profiles --------------------------------------------------------------------------

function interp(profile, x) {
  if (x <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) {
    const [x1, y1] = profile[i];
    if (x <= x1) { const [x0, y0] = profile[i - 1]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1); }
  }
  return profile[profile.length - 1][1];
}
//: ∫0^x of a piecewise-linear profile.
function integral(profile, x) {
  let s = 0;
  for (let i = 1; i < profile.length && profile[i - 1][0] < x; i++) {
    const [x0, y0] = profile[i - 1], [x1] = profile[i], xe = Math.min(x, x1);
    s += (y0 + interp(profile, xe)) * 0.5 * (xe - x0);
  }
  const last = profile[profile.length - 1];
  if (x > last[0]) s += last[1] * (x - last[0]);
  return s;
}

export function createMechanics(catalogue) {
  const MX = catalogue.mechanics;
  if (!MX) throw new Error("the object catalogue has no mechanics section");
  const cache = new Map();
  function substance(id) {
    if (id && typeof id === "object") return id;
    if (!cache.has(id)) {
      const raw = MX.substances[id] ?? (catalogue.materials?.[id]?.mechanics ? MX.substances[catalogue.materials[id].mechanics] : null);
      if (!raw) throw new Error(`unknown substance ${id}`);
      const key = MX.substances[id] ? id : catalogue.materials[id].mechanics;
      cache.set(id, prepare(key, raw));
    }
    return cache.get(id);
  }
  //: The substance a catalogue material (or a city item's material) is made of.
  const ofMaterial = (material) => catalogue.materials?.[material]?.mechanics ?? MX.item_materials?.[material] ?? null;

  // ---- friction --------------------------------------------------------------------------------

  function contactor(id) {
    if (id && typeof id === "object") return id;
    const c = MX.contactors[id];
    if (c) return c;
    // Any substance can be the thing touching: a hard one grips like bare steel, a soft one like rubber.
    const s = substance(id);
    const soft = s.E < 0.1 * GPA;
    return soft ? { adhesion: 0.5, hysteresis: 0.5, base: 0.1, moisture: 0 } : MX.contactors.steel;
  }

  //: Friction of ``contactorId`` on a surface of ``substanceId``: { static, dynamic, adhesive_n }.
  //: ``cond``: { wet, temperature_c, area_m2 (for a dry adhesive's force) }.
  function friction(contactorId, substanceId, cond = {}) {
    const c = contactor(contactorId), s = substance(substanceId);
    if (s.fluid) return { static: 0, dynamic: 0, adhesive_n: 0 };
    const S = s.surface.smoothness, X = s.surface.texture, gamma = s.surface.energy;
    let adh = c.adhesion * gamma * (0.35 + 0.65 * S);
    let hyst = c.hysteresis * X;
    let base = c.base;
    // Chalk on a very smooth surface is a layer of powder between skin and surface.
    if (c.powder) adh *= 1 - 0.4 * clamp((S - 0.6) / 0.4, 0, 1);
    // Water: only what the texture drains leaves true contact; the film itself is boundary friction.
    const drained = clamp(X * 1.2 + (1 - S) * 0.3, 0, 1);
    const wetting = (w) => { adh *= 1 - w * (1 - 0.6 * drained); hyst *= 1 - 0.15 * w; base = base * (1 - w) + CONSTANTS.wet_boundary * w; };
    if (c.moisture) wetting(c.moisture * 0.5);
    if (cond.wet) wetting(1);
    let mu = adh + hyst + base;
    // Ice wets itself as it nears melting: a premelted film covers more of it the warmer it is.
    if (s.melts != null) {
      // The film's share 1 - ((melts - T) / (melts - from))^1.5 follows rubber-on-ice friction
      // falling from about 0.3 at -20 C to 0.1-0.2 at -10 C and 0.05 near melting.
      const T = cond.temperature_c ?? -10, from = s.premeltFrom ?? -22;
      const film = cond.wet ? 1 : 1 - clamp((s.melts - T) / (s.melts - from), 0, 1) ** 1.5;
      mu = mu * (1 - film) + 0.03 * film;
    }
    let adhesive = 0;
    if (c.dry_adhesive_kpa) adhesive = c.dry_adhesive_kpa * 1e3 * (cond.area_m2 ?? c.area_m2 ?? 0) * S ** (c.smooth_power ?? 4) * (cond.wet ? 0.1 : 1);
    return { static: mu, dynamic: 0.85 * mu, adhesive_n: adhesive };
  }

  //: Standing on a slope: holds while static friction covers the slope's tangent.
  function slope({ contactor: c, substance: s, slope_deg, wet = false, temperature_c }) {
    const mu = friction(c, s, { wet, temperature_c }).static, needed = Math.tan(slope_deg * DEG);
    return { holds: mu >= needed, mu, needed, margin: mu - needed, max_slope_deg: Math.atan(mu) / DEG };
  }

  // ---- implements and bodies -------------------------------------------------------------------

  //: A fresh implement from the catalogue (its state -- edge and tip radii, damage -- on top level).
  function tool(id) {
    const t = MX.implements[id];
    if (!t) throw new Error(`unknown implement ${id}`);
    // Each feature keeps its own sharpness: a knife's point has its own short side edges, which a
    // day of chopping with the main edge does not dull (and a stab does not dull the edge).
    const side = t.tip ? t.tip.side_radius_m ?? (t.tip.sharp_sides ? t.edge?.radius_m ?? t.tip.radius_m : t.tip.radius_m) : null;
    return JSON.parse(JSON.stringify({ id, ...t, edge_radius_m: t.edge?.radius_m ?? null, tip_radius_m: t.tip?.radius_m ?? null, tip_side_radius_m: side, damage: "none", blows: 0 }));
  }

  //: A struck body. ``spec``: { substance | layers: [{substance, thickness_m}], shape: "round" |
  //: "plate" | "sheet" | "block" | "half_space" | "layers", diameter_m, length_m, thickness_m,
  //: span_m, fixed (true), mass_kg, upright, temperature_c, demand }.
  function body(spec) {
    const layers = spec.layers ? spec.layers.map((l) => ({ substance: l.substance, thickness_m: l.thickness_m })) : [{ substance: spec.substance, thickness_m: null }];
    return { ...spec, layers, fixed: spec.fixed ?? true, marks: [], broken: false, split: false, shattered: false };
  }
  const thicknessOf = (b) => {
    if (b.shape === "layers") return b.layers.reduce((s, l) => s + l.thickness_m, 0);
    if (b.shape === "round") return b.diameter_m;
    if (b.thickness_m != null) return b.thickness_m;
    return Infinity;
  };
  const layerAt = (b, depth) => {
    if (b.layers.length === 1) return b.layers[0].substance;
    let z = 0;
    for (const l of b.layers) { z += l.thickness_m; if (depth < z) return l.substance; }
    return b.layers[b.layers.length - 1].substance;
  };
  //: How long an edge lying across a round meets it at a depth: the chord.
  const chordAt = (b, depth, grain) => b.shape === "round" && grain !== "along" ? 2 * Math.sqrt(Math.max(0, depth) * Math.max(0, b.diameter_m - depth)) : Infinity;

  // ---- sinking an edge or a point in -----------------------------------------------------------

  function sharpGeometry(t, feature) {
    if (feature === "edge") {
      const e = t.edge, r = t.edge_radius_m ?? e.radius_m, p = e.profile;
      const x1 = p.find((q) => q[0] > 0) || [1, 0];
      const tanB = Math.max(0.02, (x1[1] - p[0][1]) / (2 * x1[0]));
      // A knife's spine follows its edge into the cut; an axe's eye stops at its cheeks' end.
      return { feature, r, L: e.contact_length_m, t: (x) => interp(p, x) + 2 * r, hmax: e.max_depth_m ?? Infinity, tanB, flankArea: (x) => x };
    }
    const tp = t.tip, rho = t.tip_radius_m ?? tp.radius_m;
    // The point is rounded to rho in the blade's plane; a round point is rounded all round.
    const w = (x) => Math.max(interp(tp.width, x), 2 * rho);
    const th = tp.round ? w : (x) => Math.max(interp(tp.thickness, x), 1e-5);
    const tanB = Math.max(0.02, (interp(tp.thickness, 0.01) - interp(tp.thickness, 0)) / 0.02);
    const tipArea = tp.round ? Math.PI * rho * rho : w(0) * th(0);
    // Only what touches counts: the point's apex (rho) and its own side edges -- never the main
    // edge's state, which is elsewhere on the blade.
    const side = t.tip_side_radius_m ?? tp.side_radius_m ?? (tp.sharp_sides ? t.edge?.radius_m ?? rho : rho);
    return { feature, r: side, rho, w, t: th, hmax: tp.width[tp.width.length - 1][0], tanB, tipArea,
      sharpSides: tp.sharp_sides ?? 0, round: Boolean(tp.round), flankArea: (x) => integral(tp.width, x) };
  }

  //: The resistance (N) to the cut at distance x along the blade, and what makes it up. ``o``:
  //: { start (depth below the surface where the blade enters), cos (of the cut's slant), x0 (length
  //: already cut: only friction there), grain, slice, angle }.
  function resistance(tl, tsub, geo, b, o) {
    const C = CONSTANTS, Htool = tsub.H, sliceF = 1 / Math.sqrt(1 + (o.slice ?? 0) ** 2);
    const rub = tsub.family === "metal" ? "steel" : tsub.id;
    const per = new Map();
    const props = (id) => {
      if (!per.has(id)) {
        const s = substance(id);
        per.set(id, s.fluid ? { s } : { s, d: directional(s, o.grain), mu: friction(rub, id).dynamic });
      }
      return per.get(id);
    };
    const thick = thicknessOf(b);
    return (x) => {
      const depth = o.start + x * o.cos;
      const { s, d, mu } = props(layerAt(b, Math.min(depth, thick - 1e-9)));
      if (s.fluid) return { F: 0, regime: "sep", s, depth, width: 0, thickness: 0, qLat: 0, fric: 0, front: 0, pc: 0, pcT: 0 };
      const fresh = x > o.x0, p = (w) => Math.min(d.pcAt(w), Htool), pcT = p(geo.feature === "edge" ? 2 * geo.r : 2 * geo.rho);
      let width, thickness, frontSep, frontInd, flank;
      if (geo.feature === "edge") {
        width = Math.min(geo.L, chordAt(b, depth, o.grain));
        if (!(width > 1e-4)) width = 1e-4;
        thickness = geo.t(x);
        frontSep = fresh ? width * (d.R + 2 * geo.r * pcT) * sliceF : 0;
        frontInd = fresh ? pcT * 2 * geo.r * width : 0;
        flank = 2 * width * x;
      } else {
        width = geo.w(x); thickness = geo.t(x);
        // A flat blade's sharp sides cut; its blunt sides (a spine) tear at the crush pressure; a
        // round point cuts nothing and only wedges the material apart.
        const sharp = geo.sharpSides / 2;
        const sides = geo.round ? 0 : sharp * 2 * geo.r * p(2 * geo.r) + (1 - sharp) * thickness * p(thickness);
        frontSep = fresh ? (width * (d.R + sides) * sliceF + geo.tipArea * pcT) : 0;
        frontInd = fresh ? width * sides + geo.tipArea * pcT : 0;
        flank = 2 * geo.flankArea(x);
      }
      // The cut faces are pushed apart: crushed at the crush pressure, or opened elastically like a
      // pressurised crack as long as the cut (opening = the blade's thickness) -- whichever is less.
      const a = Math.max(Math.min(x, width / 2), 1e-6);
      const qEl = (d.Eopen / (1 - s.nu * s.nu)) * thickness / (4 * a);
      const crushes = d.qPlastic <= qEl;
      const qLat = crushes ? d.qPlastic : qEl;
      const qClose = crushes ? C.flank_recovery * d.qPlastic : qEl;
      const wedge = fresh ? qLat * thickness * width : 0;
      const Fsep = frontSep + wedge + mu * qClose * flank;
      // Not parting it at all: the faces push it aside just the same, with no crack to relax behind
      // them. Only what flows (or crushes) can be dented; a soft elastic solid parts once stretched.
      const Find = d.flows ? frontInd + wedge + mu * d.qPlastic * flank : Infinity;
      const regime = Find < Fsep ? "ind" : "sep";
      return { F: Math.min(Fsep, Find), Fsep, regime, s, d, depth, width, thickness, qLat, fric: mu * (regime === "sep" ? qClose : d.qPlastic) * flank, pWall: p(thickness),
        front: regime === "sep" ? frontSep : frontInd, pc: d.pcAt(geo.feature === "edge" ? 2 * geo.r : 2 * geo.rho), pcT };
    };
  }

  //: Steps the cut in until its energy, a force limit, the blade or the body runs out.
  function sink(tl, tsub, geo, b, o) {
    const C = CONSTANTS, Htool = tsub.H, toolSigma = tsub.brittle ? tsub.uts : tsub.yield, thick = thicknessOf(b);
    const force = resistance(tl, tsub, geo, b, o);
    const tipCap = (x, st) => {
      // A point driven along its own axis by blows on its head (a nail) is held sideways by the
      // hole behind it: it bends where it stands out of the work, not where it enters
      // (mechanics-work.mjs drive), so the entry section's cap does not apply.
      if (geo.feature !== "tip" || !st.d || o.guided) return Infinity;
      // A point the work cannot hold sideways bends at the section where it enters.
      const exposure = clamp(Math.log10(st.pc / Htool) + 2.3, 0, 1);
      const k = (C.lateral_share + C.oblique_lateral * Math.sin((o.angle ?? 0) * DEG)) * exposure;
      if (k <= 0) return Infinity;
      const xs = Math.max(x, 3 * geo.rho);
      return (toolSigma * geo.w(xs) * geo.t(xs) ** 2) / (6 * k * xs);
    };
    let x = 0, W = 0, Fprev = 0, last = null, Fpeak = 0, limit = "energy", through = false;
    for (let i = 0; i < 20000; i++) {
      const dx = Math.max(1e-7, Math.min(0.02 * x + 2e-7, 5e-4));
      const xn = x + dx;
      if (o.start + xn * o.cos >= thick) { through = true; limit = "through"; x = (thick - o.start) / o.cos; break; }
      if (xn > geo.hmax) { limit = "blade"; x = geo.hmax; break; }
      const st = force(xn);
      const cap = Math.min(o.Fcap, tipCap(xn, st));
      if (st.F >= cap) {
        limit = cap === o.Fcap ? "grip" : "point";
        x += dx * clamp((cap - Fprev) / Math.max(1e-9, st.F - Fprev), 0, 1);
        last = force(Math.max(x, 1e-7)); Fpeak = Math.max(Fpeak, cap); break;
      }
      const dW = 0.5 * (Fprev + st.F) * dx;
      if (W + dW >= o.energy) { x += dx * clamp((o.energy - W) / Math.max(1e-15, dW), 0, 1); W = o.energy; last = force(Math.max(x, 1e-7)); Fpeak = Math.max(Fpeak, last.F); break; }
      W += dW; Fprev = st.F; x = xn; last = st; Fpeak = Math.max(Fpeak, st.F);
    }
    const st = last || force(1e-7);
    return { along: x, depth: o.start + x * o.cos, W, limit, through, regime: x > o.x0 ? st.regime : "sep", Fpeak, F: st.F, pWall: st.pWall ?? 0,
      qLat: st.qLat, fric: st.fric, front: st.front, pc: st.pc, pcT: st.pcT, width: st.width, thickness: st.thickness, sub: st.s, dir: st.d };
  }

  //: The force (N) at which ``tl``'s edge or point starts to part ``b``: the most cutting asks for
  //: over its first tenth of a millimetre (before that it may only dent it).
  function initiationForce(tl, b, { feature = "edge", grain = "across", slice = 0 } = {}) {
    const tsub = substance(tl.substance), geo = sharpGeometry(tl, feature);
    const force = resistance(tl, tsub, geo, b, { start: 0, cos: 1, x0: 0, grain, slice });
    let peak = 0;
    for (let x = 1e-7; x <= 1e-4; x *= 1.1) peak = Math.max(peak, force(x).Fsep);
    return peak;
  }

  // ---- what a sharp contact leaves -----------------------------------------------------------------

  function crackFrom(sub, dir, pen, b, geo, grain) {
    // A wedge's flanks load the cut's faces: the crack ahead runs until the stress intensity of that
    // line load falls to the plane's toughness.
    const P = pen.qLat * Math.max(pen.depth, 1e-6);
    let a = dir.K > 0 ? ((2 * P) / dir.K) ** 2 / Math.PI : 0;
    let through = false;
    // A round struck on its end: its halves are a double cantilever opened by the wedge's thickness.
    if (b.shape === "round" && grain === "end" && sub.grain) {
      const h = b.diameter_m / 2, t = pen.thickness, G = sub.grain.Ralong;
      const aDcb = ((3 * sub.E * h ** 3 * t ** 2) / (16 * G)) ** 0.25;
      a = Math.max(a, aDcb);
      through = a >= b.length_m;
    }
    // A brittle solid also cracks from the contact itself (indentation fracture).
    if (sub.brittle && sub.K > 0 && Number.isFinite(sub.H)) {
      const chi = 0.016 * Math.sqrt(sub.E / sub.H);
      a = Math.max(a, ((chi * pen.Fpeak) / sub.K) ** (2 / 3));
    }
    return { length: a, beyond: Math.max(0, a - pen.depth), through };
  }

  const RANK = { none: 0, dented: 1, dulled: 1, rolled: 2, chipped: 3, bent: 4, broken: 5, shattered: 6 };
  const worst = (a, b) => (RANK[b] > RANK[a || "none"] ? b : a || "none");

  //: What the cut did to the tool: { tool (its new state, keeping its worst damage), damage (this blow's) }.
  function wearTool(tl, tsub, geo, pen, o) {
    const C = CONSTANTS, next = JSON.parse(JSON.stringify(tl));
    next.blows = (tl.blows || 0) + 1;
    let damage = "none";
    const worse = (d) => { damage = worst(damage, d); };
    if (!pen.sub || pen.sub.fluid) return { tool: next, damage };
    const k = C.lateral_share + C.oblique_lateral * Math.sin((o.angle ?? 0) * DEG);
    const toolSigma = tsub.brittle ? tsub.uts : tsub.yield;
    const r0 = geo.feature === "edge" ? geo.r : geo.rho;
    // Dulling adds up blow by blow: it is judged against the radius as sharpened.
    const sharpKey = geo.feature === "edge" ? "sharp_edge_radius_m" : "sharp_tip_radius_m";
    const rSharp = tl[sharpKey] ?? r0;
    next[sharpKey] = rSharp;
    let r = r0;
    // The apex carries the cut's front (its fracture work and bluntness pressure) per unit length.
    const fApex = pen.front / Math.max(pen.width, 1e-9);
    // Harder work than the tool: the apex flattens until it bears the contact at the tool's hardness.
    if (pen.pc > tsub.H) { r = Math.max(r, (pen.pc / tsub.H) * r0 * 2); worse("dulled"); }
    // The apex bends sideways under its share of the load: past the tool's strength it rolls over
    // (or, brittle, chips) back to where its section carries that bending.
    const tanB = geo.tanB, sigma = (1.5 * k * fApex) / (Math.max(r, 1e-9) * tanB);
    if (sigma > toolSigma) {
      const reach = (1.5 * k * fApex) / (toolSigma * tanB * tanB);
      r = Math.max(r, reach * tanB);
      if (tsub.brittle) worse("chipped"); else if (r > C.noticed_radius * rSharp) worse("rolled");
    }
    // Grit wears the edge's flanks under the whole load of the cut (Archard, two-body abrasion):
    // volume per unit edge length = K min(Habr/Htool, 1.5)^2 (F / length) s / Htool, s the edge's slide.
    const ratio = clamp(pen.sub.Habr / tsub.H, 0, 1.5);
    const load = Math.max(pen.F ?? pen.Fpeak, 0) / Math.max(pen.width, 1e-9);
    const v = (C.wear_coefficient * ratio * ratio * load * pen.along * (1 + (o.slice ?? 0))) / tsub.H;
    const beta = Math.atan(tanB), cB = Math.max(1e-3, 1 / tanB - (Math.PI / 2 - beta));
    r = Math.sqrt(r * r + v / cB);
    if (r > C.noticed_radius * rSharp && damage === "none") worse("dulled");
    if (pen.limit === "point") worse(tsub.brittle ? "broken" : "bent");
    if (geo.feature === "edge") next.edge_radius_m = r;
    else {
      next.tip_radius_m = r;
      // The point's side edges take the same grit as its flanks (they are what slides in).
      if (geo.sharpSides > 0) next.tip_side_radius_m = Math.sqrt(geo.r * geo.r + v / cB);
    }
    next.damage = worst(tl.damage, damage);
    return { tool: next, damage };
  }

  // ---- a round's strength: section modulus of what is left -----------------------------------------

  const GRID = 48;
  function sectionStrength(b, marks) {
    const R0 = b.diameter_m / 2, n = GRID, h = (2 * R0) / n;
    const cells = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = -R0 + (i + 0.5) * h, y = -R0 + (j + 0.5) * h;
      if (x * x + y * y <= R0 * R0) cells.push([x, y]);
    }
    const regions = marks.flatMap((m) => (m.severed || []).map((r) => ({ ...r, at: (m.at_deg ?? 0) * DEG })));
    const kept = cells.filter(([x, y]) => !regions.some((r) => {
      const u = x * Math.cos(r.at) + y * Math.sin(r.at), v = -x * Math.sin(r.at) + y * Math.cos(r.at);
      return u > R0 - r.depth_m && (r.full || Math.abs(v) <= r.width_m / 2);
    }));
    // The fully plastic section modulus about the axis that halves the area: wood fails in bending
    // with its compressed side yielded, and unlike the elastic modulus (I over the farthest fibre)
    // it can only fall as wood is cut away.
    const Z = (pts, ang) => {
      if (!pts.length) return 0;
      const nx = Math.cos(ang), ny = Math.sin(ang);
      const d = pts.map(([x, y]) => x * nx + y * ny).sort((a, b) => a - b);
      const k = d.length, mid = k % 2 ? d[(k - 1) / 2] : (d[k / 2 - 1] + d[k / 2]) / 2;
      let Zp = 0;
      for (const v of d) Zp += Math.abs(v - mid);
      return Zp * h * h;
    };
    let worst = Infinity;
    for (let k = 0; k < 8; k++) { const ang = (k * Math.PI) / 8; worst = Math.min(worst, Z(kept, ang) / Z(cells, ang)); }
    return clamp(worst, 0, 1);
  }

  function strengthLeft(b) {
    if (b.shattered || (b.split && b.shape === "round")) return 0;
    if (b.shape === "round") return sectionStrength(b, b.marks);
    if (b.shape === "plate" || b.shape === "sheet") {
      const holes = b.marks.filter((m) => m.kind === "hole" || m.through);
      return holes.length ? clamp(1 - holes.reduce((s, m) => s + (m.length_m || 0), 0) / (b.span_m || 1), 0, 1) : 1;
    }
    return 1;
  }

  function demandOf(b) {
    if (b.demand != null) return b.demand;
    return b.shape === "round" && b.fixed && b.upright ? CONSTANTS.tree_demand : 0;
  }

  // ---- blunt contact ---------------------------------------------------------------------------

  function plateOf(b, s) {
    const t = b.thickness_m, a = (b.span_m ?? 1) / 2;
    const D = (s.E * t ** 3) / (12 * (1 - s.nu * s.nu));
    return { t, a, D, k: (16 * Math.PI * D * (1 + s.nu)) / ((3 + s.nu) * a * a), m: 0.25 * s.rho * t * Math.PI * a * a, Z: 8 * Math.sqrt(D * s.rho * t) };
  }

  //: Steps a blunt face in until the local share of the blow is spent: elastic (Hertz) until the
  //: mean pressure reaches 1.1 Y, then elastic-plastic, the mean pressure rising with the contact's
  //: size as Johnson's expanding cavity has it (p/Y = 2/3 (1 + ln(E* a / 3 Y R))) up to the
  //: hardness H. The dent left is the depth less the elastic spring-back of the contact.
  function press(R, Estar, Y, Hs, aFace, energy, Fcap = Infinity) {
    const yielding = Number.isFinite(Hs) && Number.isFinite(Y);
    const pY = yielding ? Math.min(1.1 * Y, Hs) : Infinity;
    const dy = yielding ? ((3 * Math.PI * pY) / (4 * Estar)) ** 2 * R : Infinity;
    const force = (d) => {
      if (d <= dy) { const a = Math.sqrt(R * d); return { F: (4 / 3) * Estar * Math.sqrt(R) * d ** 1.5, a, plastic: false }; }
      const a = Math.min(Math.sqrt(2 * R * d - R * dy), aFace);
      const pm = clamp((2 / 3) * Y * (1 + Math.log(Math.max((Estar * a) / (3 * Y * R), 1))), pY, Hs);
      return { F: pm * Math.PI * a * a, a, plastic: true };
    };
    let d = 0, W = 0, Fp = 0, st = { F: 0, a: 0, plastic: false };
    for (let i = 0; i < 6000; i++) {
      const dd = Math.max(1e-8, Math.min(0.01 * d + 1e-8, 2e-4));
      const nx = force(d + dd);
      if (nx.F >= Fcap) { st = { ...nx, F: Fcap }; d += dd; break; }
      const dW = 0.5 * (Fp + nx.F) * dd;
      if (W + dW >= energy) { d += dd * clamp((energy - W) / Math.max(dW, 1e-15), 0, 1); st = force(d); W = energy; break; }
      W += dW; d += dd; Fp = nx.F; st = nx;
    }
    const a = Math.max(st.a, 1e-6), pm = st.F / (Math.PI * a * a);
    const perm = st.plastic ? Math.max(0, d - (Math.PI * a * pm) / (2 * Estar)) : 0;
    return { depth: d, perm, F: st.F, a, pm, plastic: st.plastic, W };
  }

  function blunt(tl, tsub, b, o) {
    const C = CONSTANTS, face = tl.face;
    if (!face) throw new Error(`${tl.id} has no face to strike with`);
    const top = substance(b.layers[0].substance);
    if (top.fluid) return { outcome: "none", depth_m: 0, mark: { kind: "none", depth_m: 0, width_m: 0, length_m: 0 }, toolDamage: "none" };
    // A layered body (flesh) gives like the material within the contact's reach under it.
    let tgt = top;
    if (b.shape === "layers") {
      let z = 0, inv = 0, wsum = 0;
      for (const l of b.layers) { const s = substance(l.substance), w = Math.max(0, Math.min(z + l.thickness_m, 0.03) - z); if (w > 0) { inv += w / s.E; wsum += w; } z += l.thickness_m; }
      tgt = { ...top, E: wsum / inv, Ep: wsum / inv / (1 - top.nu ** 2) };
    }
    const Ht = tgt.grain ? tgt.grain.Hside : Number.isFinite(tgt.H) ? tgt.H : Infinity;
    const Htool = tsub.grain ? tsub.grain.Hside : Number.isFinite(tsub.H) ? tsub.H : Infinity;
    // Yield in the direction pressed: wood across its grain crushes from its perpendicular
    // compression strength; a stone from its compressive strength; a metal from its yield.
    const yieldOf = (x) => x.grain ? x.grain.cperp : x.comp ?? (Number.isFinite(x.H) ? x.yield : Infinity);
    const Et = tgt.grain ? tgt.Eperp : tgt.E, Eo = tsub.grain ? tsub.Eperp : tsub.E;
    const Estar = 1 / ((1 - tgt.nu ** 2) / Et + (1 - tsub.nu ** 2) / Eo);
    const R1 = face.radius_m, R2 = b.shape === "round" ? b.diameter_m / 2 : Infinity;
    const R = face.kind === "cylinder" && Number.isFinite(R2) ? Math.sqrt(R1 * R2) : 1 / (1 / R1 + 1 / R2);
    const aFace = face.kind === "flat" ? face.diameter_m / 2 : face.kind === "cylinder" ? Math.min(face.length_m / 2, R1) : R1;
    const softerIsTool = Htool < Ht, Hs = Math.min(Ht, Htool);
    const m = tl.strike_mass_kg ?? tl.mass_kg;
    let E = o.energy;
    let Eloc = E, Eglob = 0, plate = null, Fcap = Infinity;
    const thin = b.shape === "plate" || b.shape === "sheet";
    if (thin) {
      plate = plateOf(b, tgt);
      if (b.shape === "sheet") { const T0 = 0.02 * tgt.uts * b.thickness_m; plate.k = (2 * Math.PI * T0) / Math.log(plate.a / 0.03); plate.Z = Math.sqrt(plate.k * plate.m) * 2; }
      Eloc = (E * plate.m) / (m + plate.m); Eglob = (E * m) / (m + plate.m);
      Fcap = plate.Z * Math.sqrt((2 * E) / m);
    }
    const loc = press(R, Estar, softerIsTool ? yieldOf(tsub) : yieldOf(tgt), Hs, aFace, Eloc, Fcap);
    const res = { outcome: "bounce", depth_m: 0, mark: { kind: "none", depth_m: 0, width_m: 2 * loc.a, length_m: 2 * loc.a }, toolDamage: "none", F: loc.F, contact_radius_m: loc.a, pressure_pa: loc.pm };
    const effects = [];
    // The plate bends under the share of the blow that moves it.
    let sigmaB = 0, Fg = 0;
    if (plate) {
      Fg = Math.sqrt(2 * plate.k * Eglob);
      const b0 = Math.min(loc.a, plate.a), t = plate.t;
      const r0 = b0 < 1.7 * t ? Math.sqrt(1.6 * b0 * b0 + t * t) - 0.675 * t : b0;
      const sigG = ((3 * Fg) / (2 * Math.PI * t * t)) * ((1 + tgt.nu) * Math.log(plate.a / Math.max(r0, 1e-5)) + 1);
      const sigL = 0.75 * loc.pm * Math.min(loc.a, plate.a) ** 2 / (t * t);
      sigmaB = Math.max(sigG, sigL);
      if (b.shape === "sheet") {
        const T = Math.max(Fg, loc.F) / (2 * Math.PI * Math.max(loc.a, 0.005));
        if (T >= tgt.uts * b.thickness_m) effects.push("through");
      } else if (tgt.brittle) {
        // Glass fails as a whole pane; other brittle boards break through under the blow.
        if (sigmaB >= tgt.pointStrength + tgt.residual) effects.push(tgt.family === "glass" ? "shatter" : "through");
      } else if (Fg > (Math.PI * tgt.yield * t * t) / 2) effects.push("bent");
    }
    // A brittle surface cracks at the edge of an elastic contact (Hertz cone) or crushes under it.
    if (tgt.brittle && !effects.includes("shatter")) {
      const sigmaT = ((1 - 2 * tgt.nu) / 3) * 1.5 * loc.pm;
      if (sigmaT >= tgt.sigmaLocal * 0.5 || (loc.plastic && !softerIsTool)) effects.push(loc.plastic && !softerIsTool ? "chip" : "crack");
    }
    // The thing swung is a body too: a shell (a bottle, a bat) bends under the patch it lands on.
    if (tl.body?.shape === "shell") {
      const tt = tl.body.thickness_m, aa = Math.min(loc.a, tl.body.span_m / 2);
      const sig = (0.75 * loc.pm * aa * aa) / (tt * tt);
      const strength = tsub.brittle ? tsub.pointStrength + tsub.residual : tsub.yield;
      if (sig >= strength) res.toolDamage = tsub.brittle ? "shattered" : "dented";
    }
    if (softerIsTool && loc.perm > 1e-4 && res.toolDamage === "none") res.toolDamage = "dented";
    const dent = softerIsTool ? 0 : loc.perm;
    const bruise = tgt.damagePressure != null && loc.pm >= tgt.damagePressure;
    if (effects.includes("shatter")) { res.outcome = "shatter"; res.mark = { kind: "shatter", depth_m: plate.t, width_m: b.span_m, length_m: b.span_m, fragments: tgt.fragments || "shards" }; }
    else if (effects.includes("through")) { res.outcome = "through"; res.mark = { kind: "hole", depth_m: b.thickness_m, width_m: 2 * loc.a, length_m: 2 * loc.a }; }
    else if (effects.includes("crack") || effects.includes("chip")) { const k = effects.includes("chip") ? "chip" : "crack"; res.outcome = "crack"; res.mark = { kind: k, depth_m: Math.max(dent, loc.a * 0.3), width_m: 2 * loc.a, length_m: 2 * loc.a }; }
    else if (dent >= 2e-5 || bruise || effects.includes("bent")) { res.outcome = "dent"; res.mark = { kind: "dent", depth_m: dent, width_m: 2 * loc.a, length_m: 2 * loc.a, bruise: bruise || undefined, bent: effects.includes("bent") || undefined }; }
    res.depth_m = res.mark.depth_m;
    res.restitution = loc.plastic ? clamp(Math.sqrt(Math.max(0, 1 - loc.perm / Math.max(loc.depth, 1e-9))), 0, 1) * 0.6 : 0.8;
    res.bending_stress_pa = sigmaB; res.global_force_n = Fg;
    return res;
  }

  // ---- one strike ----------------------------------------------------------------------------------

  //: What a mark severs of a round's fibres: an open notch its whole chord, a kerf its edge's length.
  function severedOf(m) {
    if (!m.severs) return [];
    const out = [];
    if ((m.open_m || 0) > 0) out.push({ depth_m: m.open_m, full: true });
    if ((m.kerf_m || 0) > (m.open_m || 0)) out.push({ depth_m: m.kerf_m, width_m: m.length_m, full: false });
    return out;
  }

  //: Strike ``b`` with ``tl``. ``d``: { feature: "edge" | "tip" | "face", energy_j, angle_deg (from
  //: the surface normal), grain ("across" | "along" | "end"), tilt_deg (the cut's slant in a notch,
  //: + from above, - from below), spot (a name: blows at one spot add up), at_deg (where round a
  //: round), slice (slice/push ratio of a drawn cut), guided (a point driven on its axis, held
  //: sideways by its own hole: a nail), mode ("thrust": pushed by the hand, so limited
  //: by the grip; "swing": the head's momentum; tips default to thrust) }. Returns what happened, with the new body and
  //: the new tool (``tool.damage`` its worst so far, ``tool_damage`` this blow's); neither argument
  //: is changed.
  function strike(tl, b, d) {
    const C = CONSTANTS, feature = d.feature ?? (tl.edge ? "edge" : tl.tip ? "tip" : "face");
    const tsub = substance(tl.substance);
    const nb = JSON.parse(JSON.stringify(b));
    const angle = d.angle_deg ?? 0, grain = d.grain ?? "across";
    const mTool = tl.strike_mass_kg ?? tl.mass_kg;
    const massShare = nb.fixed ? 1 : (nb.mass_kg ?? Infinity) / (mTool + (nb.mass_kg ?? Infinity));
    const E = Math.max(0, d.energy_j) * (1 - C.handheld_loss) * (Number.isFinite(massShare) ? massShare : 1);
    const En = E * Math.cos(angle * DEG) ** 2;
    const base = { feature, energy_j: d.energy_j, glanced: false, stuck: false, withdraw_n: 0 };

    if (feature === "face") {
      // Only what touches is measured. A flat face canted past its crown lands on its rim -- a
      // ring of the chamfer's radius round the face's edge, which presses like a body with the two
      // radii's geometric mean (Hertz, two curvatures) -- so a canted hammer leaves a crescent,
      // deeper and narrower than a square blow's round dent.
      const tilt = Math.abs(d.face_tilt_deg ?? angle);
      const face = tl.face;
      const crown = face?.kind === "flat" ? Math.asin(clamp(face.diameter_m / 2 / face.radius_m, 0, 1)) / DEG : 90;
      const onRim = Boolean(face) && face.kind === "flat" && tilt > crown;
      const rimR = face?.rim_radius_m ?? C.face_rim_m;
      const struck = onRim ? { ...tl, face: { kind: "sphere", radius_m: Math.sqrt(rimR * face.diameter_m / 2) } } : tl;
      let r = blunt(struck, tsub, nb, { energy: En, angle });
      // The rim sinks only until the face's far side comes down too (depth D tan(tilt - crown));
      // the rest of the blow is borne by the whole face. The rim's work so far is taken as
      // rising with the square of its depth (its force growing about linearly with it).
      if (onRim) {
        const flat = face.diameter_m * Math.tan((tilt - crown) * DEG);
        if (r.depth_m > flat) {
          const left = En * (1 - (flat / r.depth_m) ** 2);
          const whole = blunt(tl, tsub, nb, { energy: left, angle });
          const deeper = flat + whole.depth_m;
          r = { ...whole, depth_m: deeper, outcome: whole.outcome === "bounce" ? "dent" : whole.outcome,
            mark: { ...whole.mark, kind: whole.mark.kind === "none" ? "dent" : whole.mark.kind, depth_m: deeper, crescent_m: flat } };
        } else r.mark = { ...r.mark, crescent_m: r.depth_m };
      }
      // A slanting blunt blow skids along unless friction and the dent's own wall (its depth over
      // its contact radius: the slope the face must climb out of) take the sideways push.
      let glanced = false;
      if (angle > 0 && !substance(nb.layers[0].substance).fluid) {
        const mu = friction(tsub.family === "metal" ? "steel" : tsub.id, nb.layers[0].substance).dynamic;
        const wall = (r.mark?.depth_m || 0) / Math.max(r.contact_radius_m || 1e-6, 1e-6);
        glanced = Math.tan(angle * DEG) > mu + wall;
      }
      if (glanced && (r.outcome === "bounce" || r.outcome === "dent")) {
        r.outcome = "glance";
        if (r.mark.kind === "none") r.mark = { ...r.mark, kind: "scuff" };
        // The skid drags the patch into a streak along the blow.
        r.mark.length_m = (r.mark.length_m || 0) + (r.mark.width_m || 0) * Math.tan(angle * DEG);
      }
      const mark = { ...r.mark, spot: d.spot ?? null, feature, severs: false, rim: onRim || undefined };
      if (mark.kind !== "none") nb.marks.push(mark);
      if (r.outcome === "shatter") { nb.shattered = true; nb.broken = true; }
      if (r.outcome === "through") nb.broken = nb.shape === "sheet" ? nb.broken : nb.broken;
      const ntool = JSON.parse(JSON.stringify(tl));
      ntool.blows = (tl.blows || 0) + 1;
      ntool.damage = worst(tl.damage, r.toolDamage);
      const left = strengthLeft(nb);
      nb.broken = nb.broken || left < demandOf(nb);
      return { ...base, glanced, on_rim: onRim, outcome: r.outcome, depth_m: r.depth_m, mark, force_n: r.F, restitution: r.restitution, contact_radius_m: r.contact_radius_m,
        bending_stress_pa: r.bending_stress_pa, body: nb, tool: ntool, tool_damage: r.toolDamage, strength_left: left, broken: nb.broken,
        layers_reached: [nb.layers[0].substance] };
    }

    const geo = sharpGeometry(tl, feature);
    // Blows at the same spot, in the same plane and with the same feature continue what is there.
    const spot = d.spot ?? null, tilt = d.tilt_deg ?? 0, cosT = Math.max(Math.cos(tilt * DEG), 0.1);
    const prior = spot != null ? nb.marks.find((m) => m.spot === spot && m.plane_grain === grain && m.feature === feature) : null;
    let start = 0, x0 = 0, chipping = false;
    if (prior) {
      const open = prior.open_m || 0, kerf = prior.kerf_m || 0;
      start = open;
      if (kerf > open && Math.abs(tilt - (prior.kerf_tilt_deg ?? 0)) < C.chip_tilt_deg) x0 = (kerf - open) / cosT;
      else if (kerf > open) chipping = true;
    }
    // A thrust is pushed by the hand, which slips past its grip; a swung head carries its own load.
    const thrust = (d.mode ?? (feature === "tip" ? "thrust" : "swing")) === "thrust";
    const pen = sink(tl, tsub, geo, nb, { energy: En, Fcap: thrust ? tl.grip_limit_n ?? Infinity : Infinity, start, cos: cosT, x0, grain, slice: d.slice ?? 0, angle, guided: Boolean(d.guided) });
    // A slanting blow skids off unless its bite can take the sideways push (the slant's tangent).
    let glanced = false, along = pen.along;
    const sub = pen.sub;
    if (angle > 0 && sub && !sub.fluid) {
      const mu = friction(tsub.family === "metal" ? "steel" : tsub.id, sub.id).dynamic;
      // The kerf's wall bears the sideways push at the blade's thickness scale.
      const bite = En > 0 ? (Math.min(pen.pWall, tsub.H) * pen.along * pen.along * Math.max(pen.width, 1e-6)) / En : 0;
      if (Math.tan(angle * DEG) > mu + bite) { glanced = true; along = pen.along * clamp(mu / Math.tan(angle * DEG), 0, 1); }
    }
    const depth = glanced ? start + along * cosT : pen.depth;
    const fresh = Math.max(0, depth - start);
    const dir = pen.dir || (sub && !sub.fluid ? directional(sub, grain) : null);
    const crack = sub && !sub.fluid && dir ? crackFrom(sub, dir, { ...pen, depth: fresh }, nb, geo, grain) : { length: 0, beyond: 0, through: false };
    const thick = thicknessOf(nb);
    const layers = [];
    { let z = 0; for (const l of nb.layers) { if (depth > z || !layers.length) layers.push(l.substance); z += l.thickness_m ?? Infinity; } }

    // What shape the cut is: a round point leaves a hole; a blade a slit, or a V-shaped kerf where
    // the blade is thick for its depth.
    const width = pen.thickness, length = pen.width;
    const shape = geo.feature === "tip" && geo.round ? "hole"
      : width >= C.wedge_width_m && width >= C.wedge_ratio * Math.max(depth, 1e-6) ? "wedge" : "slit";
    const brittleIso = Boolean(sub && sub.brittle && !sub.grain);
    let kind, outcome;
    if (glanced) { kind = depth > 1e-6 ? "scratch" : "none"; outcome = "glance"; }
    else if (pen.through) { kind = shape; outcome = "through"; }
    else if (brittleIso && sub.compressionDepth > 0 && crack.length >= sub.compressionDepth * thick) { kind = "shatter"; outcome = "shatter"; }
    else if (brittleIso && crack.length >= C.crack_m) { kind = "crack"; outcome = "crack"; }
    else if (brittleIso && fresh > 1e-6) { kind = "chip"; outcome = "crack"; }
    else if (crack.through) { kind = "split"; outcome = "split"; }
    else if (depth < C.scratch_m) { kind = depth > 1e-7 ? "scratch" : "none"; outcome = depth > 1e-7 ? "scratch" : "bounce"; }
    else if (pen.regime === "ind") { kind = "dent"; outcome = "dent"; }
    else { kind = shape; outcome = "cut"; }
    // Fibres: a cut across the grain severs what it passes; along the grain it parts them.
    const severs = nb.shape === "round" && outcome === "cut" && grain === "across";

    let mark;
    if (prior) {
      mark = prior;
      const open = prior.open_m || 0, kerf = prior.kerf_m || 0;
      // A notch spans the trunk's face; one blow opens its edge's length of it.
      const share = nb.shape === "round" && geo.feature === "edge" ? clamp(geo.L / Math.max(chordAt(nb, open + 1e-3, grain), 1e-6), 0, 1) : 1;
      if (chipping) {
        // The chip between the old kerf and this cut pops once this cut reaches half way under it.
        if (fresh >= 0.5 * (kerf - open)) {
          mark.open_m = open + Math.min(kerf - open, fresh) * share;
          // Fibres once cut stay cut: the old kerf below the chip still severs them.
          mark.kerf_m = Math.max(kerf, mark.open_m, open + fresh);
          mark.kerf_tilt_deg = tilt;
        }
      } else {
        mark.kerf_m = Math.max(kerf, depth);
        if (x0 === 0) mark.kerf_tilt_deg = tilt;
      }
      mark.depth_m = Math.max(mark.open_m || 0, mark.kerf_m || 0);
      mark.width_m = Math.max(mark.width_m || 0, width, 2 * (mark.open_m || 0) * Math.tan(Math.max(Math.abs(tilt), 1) * DEG));
      mark.length_m = Math.max(mark.length_m || 0, length);
      mark.blows = (mark.blows || 1) + 1;
      if ((mark.open_m || 0) > 0) mark.kind = "notch";
      else if (mark.kind === "none" || mark.kind === "scratch") mark.kind = kind;
      mark.severs = mark.severs || severs;
      mark.split_m = Math.max(mark.split_m || 0, crack.beyond);
    } else {
      mark = { spot, feature, plane_grain: grain, kind, depth_m: depth, width_m: width, length_m: length, split_m: crack.beyond, tilt_deg: tilt,
        kerf_m: kind === "none" ? 0 : depth, kerf_tilt_deg: tilt, open_m: 0, severs, at_deg: d.at_deg ?? 0, blows: 1 };
      if (kind !== "none") nb.marks.push(mark);
    }
    mark.severed = severedOf(mark);
    if (outcome === "split") { nb.split = true; nb.broken = true; mark.kind = "split"; }
    if (outcome === "shatter") { nb.shattered = true; nb.broken = true; }
    if (brittleIso && crack.length >= thick && Number.isFinite(thick)) { nb.broken = true; mark.through = true; }
    if (pen.through) mark.through = true;
    const left = strengthLeft(nb);
    nb.broken = nb.broken || left < demandOf(nb);
    const worn = wearTool(tl, tsub, geo, { ...pen, along }, { angle, slice: d.slice ?? 0 });
    // Pulling it back out: the flanks' grip at rest (static friction).
    const withdraw = glanced ? 0 : pen.fric / 0.85;
    return { ...base, outcome, glanced, depth_m: depth, mark: { ...mark }, force_n: pen.Fpeak, limit: pen.limit, crack_m: crack.length,
      withdraw_n: withdraw, stuck: withdraw > 0.25 * (tl.grip_limit_n ?? Infinity), layers_reached: layers,
      body: nb, tool: worn.tool, tool_damage: worn.damage, strength_left: left, broken: nb.broken };
  }

  return { substance, ofMaterial, contactor, friction, slope, tool, body, strike, initiationForce, strengthLeft,
    directional: (id, g) => directional(substance(id), g), constants: CONSTANTS, data: MX };
}
