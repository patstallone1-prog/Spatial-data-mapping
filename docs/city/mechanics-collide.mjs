// Object on object: what two things do to each other when one is pushed, dropped or driven into
// the other, on top of the material engine (mechanics.mjs). Every object is a stack of layers --
// a coat (paint, powder, clear) over its body (render, wood, steel, glass) -- and each layer meets
// the contact with its own hardness, stiffness, failure strain and, for a coat, the adhesion that
// holds it on. A mark goes down through the stack only as far as the force can push it: a scratch
// in a wall's paint stays in the paint until it is cut through, and the render under it is marked
// only by something that out-hardens the render too. As a whole each object has the strength and
// stiffness of its shape (a post, a beam, a box, a panel, a wall), so a blow that the contact does
// not take bends or breaks the weaker of the two -- and what it hits stops it, or is moved.
//
// docs/62-material-mechanics.md ("Object on object") gives each law and its source. Pure: no
// three.js, no clock, no randomness (tests/mechanics_collide.test.mjs).

const G = 9.81, SQ3 = Math.sqrt(3);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mm = (m) => (m < 0.001 ? `${Math.round(m * 1e6)} µm` : m < 0.01 ? `${(m * 1000).toFixed(1)} mm` : `${Math.round(m * 1000)} mm`);

//: The laws' own numbers (sources in the catalogue's mechanics.sources).
export const COLLIDE = Object.freeze({
  //: One solid grooves another only if at least this much harder than it (scratch_ratio, Tabor 1954).
  scratch_ratio: 1.2,
  //: Representative strain under a round contact, as a share of a / R (representative_strain, Tabor 1951).
  tabor_strain: 0.2,
  //: A sliding corner bears only on the leading half of its contact (scratch_hardness, ASTM G171).
  front_half: 0.5,
  //: Shallower than this, a mark does not show (m): a burnish at most.
  visible_m: 1e-6,
  //: A groove left in a coat shallower than this is a scuff, not a scratch (m).
  scuff_m: 5e-6,
  //: Abrasive wear of a softer thing dragged over grit (Archard K, two-body abrasion).
  grit_wear: 1e-2,
  //: Adhesive wear of the softer of two smooth solids dragged on each other (Archard K: 1e-6 to
  //: 1e-4 for polymers and metals on hard smooth faces, Rabinowicz; Lancaster 1973).
  adhesive_wear: 1e-5,
  //: The deepest a contact is followed (m): past this it has gone through whatever it is in.
  max_depth_m: 0.2,
});

export function createCollisions(M, catalogue) {
  const MX = M.data, A = catalogue.archetypes || {}, MAT = catalogue.materials || {};

  // ---- what each thing is: its layers and its shape ------------------------------------------------

  const directionalK = (s, grain) => M.directional(s.id, grain).K;

  //: One layer of a stack from its substance: the figures the contact laws read.
  function layerOf(subId, role, thickness_m, extra = {}) {
    const s = M.substance(subId), wood = Boolean(s.grain);
    const H = wood ? s.grain.Hside : s.H;
    return {
      role, substance: s.id, name: s.name, family: s.family, thickness_m,
      hardness_pa: H, yield_pa: wood ? s.grain.cperp : s.yield, modulus_pa: wood ? s.Eperp : s.E, nu: s.nu,
      strength_pa: s.uts, failure_strain: s.epsF, brittle: s.brittle,
      // Wood cracks along its grain (it splits) far more easily than across it.
      toughness_pa_m: wood ? directionalK(s, "along") : s.K, fracture_energy_j_m2: wood ? s.grain.Ralong : s.Gc,
      fracture_energy_across_j_m2: wood ? s.grain.Racross : s.Gc,
      // What a slider must out-harden to groove it: a gritty composite's grit, else its hardness.
      scratch_pa: s.raw.abrasive_hardness_hv != null ? s.Habr : H,
      gritty: s.raw.abrasive_hardness_hv != null,
      ...extra,
    };
  }

  //: The section's second moment, elastic and fully plastic moduli: a rectangle b x h, a round d,
  //: or a tube d with wall_m.
  function sectionOf(sec) {
    if (!sec) return null;
    if (sec.d_m != null) {
      const D = sec.d_m, d = sec.wall_m ? Math.max(0, D - 2 * sec.wall_m) : 0;
      const I = (Math.PI * (D ** 4 - d ** 4)) / 64;
      return { I, Z: (2 * I) / D, Zp: (D ** 3 - d ** 3) / 6, t: sec.wall_m ?? D };
    }
    const b = sec.b_m, h = sec.h_m;
    return { I: (b * h ** 3) / 12, Z: (b * h * h) / 6, Zp: (b * h * h) / 4, t: h };
  }

  //: Everything about one thing that a collision reads. ``id``: an archetype id (its form, coat and
  //: material from the catalogue) or a spec { material | substance, coat, form }. ``opt``: {
  //: cladding (a wall's claddings class: its material and its coat), coat (a coat id, or null for
  //: none), substance, mass_kg, fixed, form (fields over the catalogue's) }.
  function stats(id, opt = {}) {
    const spec = typeof id === "object" && id ? id : {};
    const key = typeof id === "string" ? id : spec.id ?? null;
    const arch = key ? A[key] : null;
    const form = { ...(key ? MX.forms?.[key] : null), ...(spec.form || {}), ...(opt.form || {}) };
    const clad = opt.cladding ? catalogue.claddings?.classes?.[opt.cladding] : null;
    const material = opt.material ?? spec.material ?? clad?.material ?? arch?.material ?? null;
    const subId = opt.substance ?? spec.substance ?? (clad ? null : form.substance) ?? M.ofMaterial(material);
    if (!subId) throw new Error(`no substance for ${key ?? material}`);
    const coatId = opt.coat !== undefined ? opt.coat : spec.coat !== undefined ? spec.coat : clad ? (MX.cladding_coats?.[opt.cladding] ?? null) : (form.coat ?? null);
    const coat = coatId ? MX.coatings?.[coatId] : null;
    if (coatId && !coat) throw new Error(`unknown coat ${coatId}`);
    const shape = form.shape ?? "wall";
    const sec = sectionOf(form.section);
    const bodyT = shape === "panel" || shape === "box" ? sec?.t ?? Infinity : Infinity;
    const layers = [];
    if (coat) layers.push(layerOf(coat.substance, "coat", coat.thickness_um * 1e-6, { coat: coatId, coat_name: coat.name, adhesion_pa: coat.adhesion_mpa * 1e6 }));
    layers.push(layerOf(subId, "body", bodyT));
    const body = M.substance(subId);
    const mass = opt.mass_kg ?? spec.mass_kg ?? form.mass_kg ?? null;
    const fixed = opt.fixed ?? spec.fixed ?? (shape === "wall" || shape === "ground" || mass == null);
    const out = {
      id: key, name: arch?.name ?? spec.name ?? body.name, shape, fixed, mass_kg: mass, layers, coat: coatId,
      material, substance: subId, edge_r_m: form.edge_r_m ?? 0.005, face_m2: form.face_m2 ?? 1, height_m: form.height_m ?? null,
      section: form.section ?? null, span_m: form.span_m ?? null,
      break_energy_j: arch?.durability?.break_energy_j ?? null, restitution: MAT[material]?.restitution ?? null,
      bend_force_n: Infinity, break_force_n: Infinity, stiffness_n_m: Infinity,
    };
    // As a whole: the force that bends it for good (a ductile one) and the force that breaks it.
    const E = body.E, nu = body.nu;
    // Wood and brittle solids break at their strength; metals and tough plastics yield first.
    const ductile = !body.brittle && !body.grain;
    const sigY = body.grain ? body.uts : body.brittle ? body.uts : body.yield, sigU = body.uts || sigY;
    if (sec && (shape === "beam" || shape === "post" || shape === "round")) {
      const L = form.span_m ?? 1, lever = shape === "post" ? 1 / L : 4 / L;
      out.stiffness_n_m = (shape === "post" ? 3 : 48) * E * sec.I / L ** 3;
      const sigB = form.flexural_mpa != null ? form.flexural_mpa * 1e6 : sigU;
      if (ductile) { out.bend_force_n = sigY * sec.Zp * lever; out.break_force_n = sigU * sec.Zp * lever; }
      else out.bend_force_n = out.break_force_n = sigB * sec.Z * lever;
    } else if (sec && (shape === "panel" || shape === "box")) {
      // A plate held round its edges, loaded at its middle: stiffness k = 16 pi D (1 + nu) / ((3 + nu)
      // a^2); a ductile sheet is dished in for good at its collapse load, 2 pi m_p whatever its shape
      // (m_p = sigma_y t^2 / 4: the yield-line solution); a brittle one breaks when the bending stress
      // under the load, spread through its thickness (Roark's r0 at b0 = t), reaches its strength
      // under a point (with any temper's compression).
      const t = sec.t, a = (form.span_m ?? sec.t * 100) / 2;
      const D = (E * t ** 3) / (12 * (1 - nu * nu));
      out.stiffness_n_m = (16 * Math.PI * D * (1 + nu)) / ((3 + nu) * a * a);
      const r0 = Math.sqrt(2.6) * t - 0.675 * t;
      const per = (2 * Math.PI * t * t) / (3 * ((1 + nu) * Math.log(a / r0) + 1));
      const sigB = form.flexural_mpa != null ? form.flexural_mpa * 1e6 : body.brittle ? (body.pointStrength || sigU) + body.residual : sigU;
      if (ductile) { out.bend_force_n = (Math.PI / 2) * sigY * t * t; out.break_force_n = Infinity; }   // dished, then holed (holed)
      else out.bend_force_n = out.break_force_n = sigB * per;
    }
    out.ductile = ductile;
    return out;
  }

  // ---- the contact ---------------------------------------------------------------------------------

  //: The shape a contact presses with, from the thing whose feature leads: a corner (a sphere of its
  //: corner radius), an edge (a cylinder of its edge radius along its height), or a face (flat).
  function geometry(lead, kind = "corner") {
    if (kind === "face") return { kind, A: lead.face_m2 };
    if (kind === "edge") return { kind, r: lead.shape === "round" ? lead.section.d_m / 2 : lead.edge_r_m, L: lead.shape === "round" ? lead.span_m ?? 1 : lead.height_m ?? lead.section?.b_m ?? 0.3 };
    return { kind: "corner", r: lead.edge_r_m };
  }
  const radiusAt = (g, h) => (g.kind === "face" ? Math.sqrt(g.A / Math.PI) : Math.sqrt(2 * g.r * Math.max(h, 0)));
  const areaAt = (g, h) => (g.kind === "face" ? g.A : g.kind === "edge" ? 2 * radiusAt(g, h) * g.L : Math.PI * radiusAt(g, h) ** 2);

  //: What gives, in order, as a contact of radius ``a`` goes into ``S``: each layer's flow pressure
  //: (a coat thinner than the contact is held in by it: confined_layer); a layer harder than one
  //: under it is carried down on it, not cut; sliding (``against``: the slider's scratch hardness),
  //: a layer it does not out-harden by the scratch ratio cannot be grooved at all.
  function giving(S, a, against) {
    const n = S.layers.length;
    const p = S.layers.map((l, i) => {
      let q = l.hardness_pa;
      if (i < n - 1 && Number.isFinite(l.thickness_m)) q = Math.max(q, l.yield_pa * (1 + (2 * a) / (3 * SQ3 * l.thickness_m)));
      if (against != null && against < COLLIDE.scratch_ratio * l.scratch_pa) q = Infinity;
      return q;
    });
    const segs = [];
    for (let i = 0; i < n; i++) {
      let below = Infinity;
      for (let j = i + 1; j < n; j++) below = Math.min(below, p[j]);
      if (i === n - 1 || p[i] <= below) segs.push({ i, t: i === n - 1 ? Infinity : S.layers[i].thickness_m, p: p[i] });
    }
    return { p, segs };
  }

  //: The force a contact of shape ``g`` takes to be ``h`` deep in ``S`` (plastic, the pressure of
  //: whatever is giving at each depth): a sphere F = 2 pi R int p dz; a cylinder F = 2 L int p
  //: d(rho); a flat its area at the pressure of what gives first. ``share``: of it that bears (a
  //: sliding corner's leading half).
  function forceAt(S, g, h, against, share = 1) {
    if (h <= 0) return 0;
    const { segs } = giving(S, Math.max(radiusAt(g, h), 1e-7), against);
    let F = 0, z0 = 0;
    if (g.kind === "face") {
      for (const s of segs) { if (h <= z0 + s.t) return g.A * s.p * share; z0 += s.t; }
      return Infinity;
    }
    for (const s of segs) {
      if (z0 >= h) break;
      const z1 = Math.min(h, z0 + s.t);
      if (g.kind === "corner") F += 2 * Math.PI * g.r * s.p * (z1 - z0);
      else F += 2 * g.L * s.p * (Math.sqrt(2 * g.r * (h - z0)) - Math.sqrt(2 * g.r * Math.max(0, h - z1)));
      z0 += s.t;
    }
    return F * share;
  }
  //: The depth at which ``S`` takes ``F`` (the inverse of forceAt), and the work done getting there.
  function depthFor(S, g, F, against, share = 1) {
    if (F <= 0) return { h: 0, W: 0 };
    let lo = 0, hi = 1e-6;
    while (forceAt(S, g, hi, against, share) < F && hi < COLLIDE.max_depth_m) hi *= 2;
    if (forceAt(S, g, hi, against, share) < F) return { h: COLLIDE.max_depth_m, W: F * COLLIDE.max_depth_m, through: true };
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (forceAt(S, g, mid, against, share) >= F) hi = mid; else lo = mid; }
    const h = hi;
    // Work: the integral of the force over the way in (a flat at its yield force does F h).
    let W = 0, prev = 0;
    const N = 24;
    for (let k = 1; k <= N; k++) { const z = (h * k) / N, f = Math.min(F, forceAt(S, g, z, against, share)); W += 0.5 * (prev + f) * (h / N); prev = f; }
    return { h, W };
  }

  //: Which layer of ``S`` is the surface once a contact ``h`` deep has cut what it cuts.
  function exposedAt(S, g, h, against) {
    const { segs } = giving(S, Math.max(radiusAt(g, h), 1e-7), against);
    let z0 = 0;
    for (const s of segs) { if (h < z0 + s.t - 1e-12) return S.layers[s.i]; z0 += s.t; }
    return S.layers[segs.at(-1).i];
  }

  //: The marks a contact ``h`` deep (``F`` on it) leaves in each layer of ``S``. ``other``: the
  //: counter-face's layer (for the spring-back), ``sliding``: a groove, ``length_m`` long.
  function marksIn(S, g, h, F, other, against, sliding, length_m, lead = false, share = 1) {
    const a = Math.max(radiusAt(g, h), 1e-7), { segs } = giving(S, a, against);
    // Spring-back: the elastic part of the depth comes back up (pi a p / 2E*, the unloading of a
    // flat-ended contact); what is left is the mark. A groove's floor springs back the same way,
    // but a coat cut to its floor while the contact was on it stays cut.
    const top = S.layers[segs[0].i], pm = F / Math.max(share * areaAt(g, h), 1e-12);
    const Estar = 1 / ((1 - top.nu ** 2) / top.modulus_pa + (1 - other.nu ** 2) / other.modulus_pa);
    const back = g.kind === "face" ? 0 : (Math.PI * a * pm) / (2 * Estar);
    const left = Math.max(0, h - back);
    const strain = g.kind === "face" ? h / a : (COLLIDE.tabor_strain * a) / g.r;
    const width = 2 * a;
    const out = S.layers.map((l) => ({ layer: l.role, substance: l.substance, kind: "none", depth_m: 0, width_m: 0, length_m: 0 }));
    let z0 = 0;
    const cutIdx = new Set(segs.map((s) => s.i));
    for (const s of segs) {
      const l = S.layers[s.i], m = out[s.i];
      const inIt = Math.max(0, Math.min(h, z0 + s.t) - z0), stays = Math.max(0, Math.min(left, z0 + s.t) - z0);
      if (inIt > 0 && Number.isFinite(s.p)) {
        const through = l.role === "coat" && h >= z0 + s.t - 1e-12;
        // What leads a slide is worn (rubbed down), what it is dragged over is grooved.
        if (l.role === "coat") {
          m.kind = through ? (sliding ? (lead ? "worn_through" : "cut_through") : "crushed") : stays < COLLIDE.visible_m ? "none" : stays < COLLIDE.scuff_m ? "scuff" : sliding ? (lead ? "worn" : "scratch") : "dent";
        } else if (stays >= COLLIDE.visible_m) {
          m.kind = sliding && lead ? "worn" : l.brittle ? "chip" : sliding ? "gouge" : "dent";
        }
        if (m.kind !== "none") Object.assign(m, { depth_m: through ? l.thickness_m : stays, width_m: width, length_m: sliding ? length_m : width });
      }
      z0 += s.t;
    }
    // A layer carried down on a softer one under it is stretched with the dent; a coat cut or
    // carried past its failure strain cracks, and a cracked coat lifts off as far as its own stress
    // can be held by its adhesion (shear_lag).
    // Dragged, a coat over a layer that is grooved under it is torn open along the groove.
    const dented = out.some((m, i) => i > 0 && m.kind !== "none");
    S.layers.forEach((l, i) => {
      const m = out[i];
      const carried = !cutIdx.has(i) && (dented || h > COLLIDE.visible_m);
      if (carried && sliding && dented && l.role === "coat") Object.assign(m, { kind: lead ? "worn_through" : "cut_through", depth_m: l.thickness_m, width_m: width, length_m });
      else if (carried && m.kind === "none" && h - back > COLLIDE.visible_m) Object.assign(m, { kind: "stretched", depth_m: Math.max(0, h - back), width_m: width, length_m: sliding ? length_m : width });
      if (l.role !== "coat" || m.kind === "none" || m.kind === "scuff") return;
      if (strain >= l.failure_strain) {
        const sigma = Math.min(l.modulus_pa * l.failure_strain, l.strength_pa || Infinity);
        const run = (Math.PI * sigma * l.thickness_m) / (2 * l.adhesion_pa);
        Object.assign(m, { cracked: true, flaked: true, kind: m.kind === "stretched" ? "flaked" : m.kind, flake_width_m: width + 2 * run });
      }
    });
    return { layers: out, strain, contact_radius_m: a, pressure_pa: pm, depth_m: h, spring_back_m: back };
  }

  //: The contact between ``P`` (whose feature leads) and ``Q`` under force ``F``: both are pressed
  //: with the same force; each takes it at the depth its own stack gives, and is marked there.
  //: ``sliding``: Q's surface is dragged past (only out-hardened layers are grooved, and a corner
  //: bears on half its contact).
  function contact(P, Q, F, { kind = "corner", sliding = false, length_m = 0 } = {}) {
    const g = geometry(P, kind), share = sliding && kind !== "face" ? COLLIDE.front_half : 1;
    let expP = P.layers[0], expQ = Q.layers[0];
    let dP, dQ;
    for (let pass = 0; pass < 3; pass++) {
      let aQ = sliding ? expP.scratch_pa : null, aP = sliding ? expQ.scratch_pa : null;
      // Neither out-hardens the other: they wear each other as plastic solids, no groove ruled out.
      if (sliding && aQ < COLLIDE.scratch_ratio * expQ.scratch_pa && aP < COLLIDE.scratch_ratio * expP.scratch_pa) aQ = aP = null;
      dQ = { ...depthFor(Q, g, F, aQ, share), against: aQ };
      dP = { ...depthFor(P, g, F, aP, share), against: aP };
      const nP = exposedAt(P, g, dP.h, aP), nQ = exposedAt(Q, g, dQ.h, aQ);
      if (nP === expP && nQ === expQ) break;
      expP = nP; expQ = nQ;
    }
    const mQ = marksIn(Q, g, dQ.h, F, expP, dQ.against, sliding, length_m, false, share);
    const mP = marksIn(P, g, dP.h, F, expQ, dP.against, sliding, length_m, true, share);
    // A soft thing dragged over a harder one leaves some of itself on it -- adhesive wear goes on
    // even where nothing yields -- unless the harder one is grooved: a transfer mark.
    if (sliding) {
      const [soft, hard, mHard, mSoft] = expP.scratch_pa <= expQ.scratch_pa ? [expP, expQ, mQ, mP] : [expQ, expP, mP, mQ];
      const top = mHard.layers.find((m) => m.kind !== "none" && m.kind !== "stretched") ? null : mHard.layers[0];
      if (top && TRANSFERS.has(soft.family) && soft.scratch_pa < hard.scratch_pa) Object.assign(top, { kind: "transfer", of: soft.substance, width_m: 2 * mSoft.contact_radius_m, length_m });
    }
    return { force_n: F, geometry: g, lead: mP, struck: mQ, work_j: dP.W + dQ.W };
  }

  // ---- whole objects: a push, a blow, a scrape ----------------------------------------------------------

  //: A sheet holed by the contact: the load sheared round the contact's rim (punching, 0.6 uts).
  const holed = (S, F, m) => {
    const l = S.layers.find((x) => x.role === "body");
    return Number.isFinite(l.thickness_m) && !l.brittle && l.family !== "wood" && F >= 2 * Math.PI * Math.max(m.contact_radius_m, 1e-4) * l.thickness_m * 0.6 * l.strength_pa;
  };
  //: What the whole of ``S`` does under a force ``F``: holds, bends for good, or breaks.
  //: (A ductile sheet or box is dished -- "dented" -- where a post or a beam is "bent"; a brittle
  //: or wooden one "cracks" at its strength and is "wrecked" only by the energy that destroys it.)
  const wholeUnder = (S, F, m) => (holed(S, F, m) ? "holed" : F >= S.break_force_n ? "cracked" : F >= S.bend_force_n ? (S.ductile ? (S.shape === "panel" || S.shape === "box" ? "dented" : "bent") : "cracked") : "holds");

  //: What leaves a smear of itself on what it is dragged over.
  const TRANSFERS = new Set(["polymer", "wood", "elastomer", "food"]);

  function frictionOf(P, Q) {
    try { return M.friction(P.layers[0].substance, Q.layers[0].substance); } catch { return { static: 0.5, dynamic: 0.43 }; }
  }

  //: ``P`` pushed against ``Q`` with ``force_n`` (a hand's push, a load leaning on it), ``angle_deg``
  //: off square to Q's face. The share across the face presses them together; the share along it
  //: drags P along Q if it beats their friction. Q is moved only if not fixed and the push beats
  //: its grip on the ground; otherwise P is stopped there.
  function push(P, Q, { force_n, angle_deg = 0, kind, length_m = 0.1, ground_mu = 0.6 } = {}) {
    const th = (Math.abs(angle_deg) * Math.PI) / 180, N = force_n * Math.cos(th), T = force_n * Math.sin(th);
    const fr = frictionOf(P, Q);
    const slides = T > fr.static * N;
    kind = kind ?? (angle_deg === 0 ? "face" : "corner");
    const c = contact(P, Q, N, { kind, sliding: slides, length_m: slides ? length_m : 0 });
    const moves = !Q.fixed && Q.mass_kg != null && N > ground_mu * Q.mass_kg * G;
    const res = {
      kind: "push", normal_n: N, along_n: T, slides, friction: fr, moves_other: moves, stopped: !moves,
      contact: c, lead_whole: wholeUnder(P, N, c.lead), struck_whole: wholeUnder(Q, N, c.struck),
      drag_n: slides ? fr.dynamic * N : 0,
    };
    res.text = describe(P, Q, res);
    return res;
  }

  //: ``P`` driven into ``Q`` at ``speed_mps`` (Q at rest). The blow's energy, 1/2 mu v^2 with the
  //: reduced mass mu (all of P's if Q is fixed), goes into the two objects' bending and the
  //: contact's dents, up to the force at which the weaker breaks: past that, what is left goes into
  //: breaking it, and if that is more than it takes to wreck it (its durability), it is wrecked.
  function impact(P, Q, { speed_mps, kind = "corner", mass_kg } = {}) {
    const mP = mass_kg ?? P.mass_kg ?? 10, mQ = Q.fixed ? Infinity : Q.mass_kg ?? Infinity;
    const mu = Number.isFinite(mQ) ? (mP * mQ) / (mP + mQ) : mP, KE = 0.5 * mu * speed_mps ** 2;
    const g = geometry(P, kind);
    const springs = (F) => (Number.isFinite(P.stiffness_n_m) ? (F * F) / (2 * P.stiffness_n_m) : 0) + (Number.isFinite(Q.stiffness_n_m) ? (F * F) / (2 * Q.stiffness_n_m) : 0);
    const energyAt = (F) => springs(F) + depthFor(P, g, F, null).W + depthFor(Q, g, F, null).W;
    const weaker = P.break_force_n <= Q.break_force_n ? "lead" : "struck", Fb = Math.min(P.break_force_n, Q.break_force_n);
    let F, breaks = null, left = 0;
    if (Number.isFinite(Fb) && energyAt(Fb) <= KE) { F = Fb; breaks = weaker; left = KE - energyAt(Fb); }
    else {
      let lo = 0, hi = 1;
      while (energyAt(hi) < KE && hi < 1e9) hi *= 2;
      for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (energyAt(mid) >= KE) hi = mid; else lo = mid; }
      F = hi;
    }
    const c = contact(P, Q, F, { kind });
    const breaker = breaks === "lead" ? P : breaks === "struck" ? Q : null;
    const wrecked = breaker && breaker.break_energy_j != null && left >= breaker.break_energy_j;
    // What comes back is what the two bodies stored as springs (the dents keep theirs), at most the
    // catalogue's measured restitution of the two materials.
    const cap = Math.max(P.restitution ?? 0.5, Q.restitution ?? 0.5);
    const e = KE > 0 ? Math.min(cap, Math.sqrt(clamp(springs(F) / KE, 0, 1))) : 0;
    const vP = Number.isFinite(mQ) ? (speed_mps * (mP - e * mQ)) / (mP + mQ) : -e * speed_mps;
    const vQ = Number.isFinite(mQ) ? (speed_mps * mP * (1 + e)) / (mP + mQ) : 0;
    const res = {
      kind: "impact", energy_j: KE, force_n: F, contact: c, restitution: e, speed_after_mps: vP, struck_speed_mps: vQ,
      lead_whole: breaks === "lead" ? (wrecked ? "wrecked" : P.ductile ? "broken" : "cracked") : wholeUnder(P, F, c.lead),
      struck_whole: breaks === "struck" ? (wrecked ? "wrecked" : Q.ductile ? "broken" : "cracked") : wholeUnder(Q, F, c.struck),
      stopped: !Number.isFinite(mQ) || vP <= 0.05 * speed_mps,
    };
    res.text = describe(P, Q, res);
    return res;
  }

  //: ``P`` dragged along ``Q``'s face, pressed on with ``normal_n``, for ``slide_m``: the groove each
  //: is left with, what is worn off it (the groove's section x length; a soft slider on grit by
  //: Archard), and the drag (friction plus ploughing the groove).
  function scrape(P, Q, { normal_n, slide_m = 0.1, kind = "corner" } = {}) {
    const c = contact(P, Q, normal_n, { kind, sliding: true, length_m: slide_m });
    const fr = frictionOf(P, Q);
    // A groove's section is about two thirds of its width times its depth (a round-bottomed one).
    const section = (m) => m.layers.reduce((s, l) => s + (["none", "transfer", "stretched"].includes(l.kind) ? 0 : (2 / 3) * l.width_m * l.depth_m), 0);
    const plough = (m, S) => m.layers.reduce((s, l, i) => s + (["none", "transfer", "stretched"].includes(l.kind) || !Number.isFinite(S.layers[i].hardness_pa) ? 0 : (2 / 3) * l.width_m * l.depth_m * S.layers[i].hardness_pa), 0);
    //: Worn off: the groove; a slider on grit is ground away besides, and the softer of two smooth
    //: faces loses some of itself to the other: V = K N s / H (Archard).
    //: (The face a thing slides on is the first of its layers not cut through.)
    const exposed = (S, m) => S.layers[Math.max(0, m.layers.findIndex((l) => !["cut_through", "worn_through", "crushed"].includes(l.kind)))];
    const worn = (mine, S, other) => {
      let v = section(mine) * slide_m;
      const H = Number.isFinite(S.layers[0].hardness_pa) ? S.layers[0].hardness_pa : S.layers[0].strength_pa;
      const theirs = other === P ? c.lead : c.struck;
      if (exposed(other, theirs).gritty) v = Math.max(v, (COLLIDE.grit_wear * normal_n * slide_m) / H);
      if (S.layers[0].scratch_pa <= other.layers[0].scratch_pa) v = Math.max(v, (COLLIDE.adhesive_wear * normal_n * slide_m) / H);
      return v;
    };
    const res = {
      kind: "scrape", normal_n, slide_m, contact: c, friction: fr,
      // The drag: friction, plus the ploughing of each groove (its section at the flow pressure).
      drag_n: fr.dynamic * normal_n + plough(c.struck, Q) + plough(c.lead, P),
      worn_lead_m3: worn(c.lead, P, Q), worn_struck_m3: worn(c.struck, Q, P),
    };
    res.text = describe(P, Q, res);
    return res;
  }

  // ---- words ----------------------------------------------------------------------------------------

  //: A substance in a word or two, as a passer-by would name it.
  const SHORT = { stucco: "render", clay_brick: "brick", mild_steel: "steel", aluminium_6061: "aluminium", grey_cast_iron: "cast iron", polypropylene: "plastic", polycarbonate: "plastic", glass_annealed: "glass", glass_tempered: "glass", douglas_fir_dry: "wood", douglas_fir_green: "wood", decayed_softwood: "rotten wood", sycamore_green: "bark", plasterboard: "plasterboard", latex_paint: "paint", alkyd_enamel: "paint", powder_coat: "powder coat", auto_clearcoat: "paint", thermoplastic_paint: "road paint", rubber_tread: "rubber" };
  const shortName = (id) => SHORT[id] ?? M.substance(id).name.split(/[,(]/)[0].trim().toLowerCase();
  //: Plain words for a result: what each layer of the struck thing and the leading thing got.
  function describe(P, Q, r) {
    const nameOf = (S) => String(S.name || "it").toLowerCase();
    const layerName = (S, i) => { const l = S.layers[i]; return l.role === "coat" ? (l.coat === "powder_coat" ? "powder coat" : l.coat === "road_marking" ? "road paint" : "paint") : shortName(l.substance); };
    const said = (S, marks, other) => {
      const bits = [];
      marks.layers.forEach((m, i) => {
        if (m.kind === "none") return;
        const what = layerName(S, i);
        if (m.kind === "cut_through") bits.push(`cut through the ${what}${m.flaked ? ", which flakes off round it" : ""} (${mm(m.width_m)} wide)`);
        else if (m.kind === "transfer") bits.push(`a smear of the ${nameOf(other)}'s ${shortName(m.of)} on the ${what}`);
        else if (m.kind === "worn_through") bits.push(`the ${what} worn through (${mm(m.width_m)})`);
        else if (m.kind === "worn") bits.push(`the ${what} worn ${mm(m.depth_m)} down`);
        else if (m.kind === "stretched") bits.push(`the ${what} stretched over the dent${m.flaked ? " and flaking" : ""}`);
        else if (m.kind === "flaked") bits.push(`the ${what} flaked off (${mm(m.flake_width_m)})`);
        else bits.push(`${m.kind === "scuff" ? "a scuff" : m.kind === "gouge" ? "a gouge" : m.kind === "chip" ? "a chip" : m.kind === "crushed" ? "the" : `a ${m.kind}`}${m.kind === "crushed" ? ` ${what} crushed` : ` in the ${what}`}${m.depth_m >= COLLIDE.visible_m && m.kind !== "crushed" ? ` ${mm(m.depth_m)} deep` : ""}${m.flaked && m.kind !== "flaked" ? ", the paint flaking round it" : ""}`);
      });
      // A coat that took it all: say that what is under it is untouched.
      const coat = S.layers[0].role === "coat", under = marks.layers[marks.layers.length - 1];
      if (coat && bits.length && under.kind === "none" && marks.layers[0].kind !== "transfer") bits.push(`the ${layerName(S, S.layers.length - 1)} under it unmarked`);
      return bits;
    };
    const q = said(Q, r.contact.struck, P), p = said(P, r.contact.lead, Q);
    const parts = [];
    const hurt = (w) => w && w !== "holds";
    if (q.length) parts.push(`The ${nameOf(Q)}: ${q.join("; ")}.`);
    else if (!hurt(r.struck_whole)) parts.push(`The ${nameOf(Q)} is not marked.`);
    if (p.length) parts.push(`The ${nameOf(P)}: ${p.join("; ")}.`);
    const WHOLE = { bent: "is bent", dented: "is dented in", cracked: "cracks", broken: "breaks", wrecked: "is smashed", holed: "is holed" };
    const whole = (S, w) => (WHOLE[w] ? `The ${nameOf(S)} ${WHOLE[w]}.` : "");
    const ws = [whole(Q, r.struck_whole), whole(P, r.lead_whole)].filter(Boolean);
    parts.push(...ws);
    if (r.kind === "push") parts.push(r.moves_other ? `It shoves the ${nameOf(Q)} along.` : r.slides ? `It slides along the ${nameOf(Q)}.` : `The ${nameOf(P)} stops against it.`);
    if (r.kind === "impact" && r.stopped && r.lead_whole !== "wrecked") parts.push(`The ${nameOf(P)} stops dead.`);
    return parts.join(" ");
  }

  return { stats, geometry, contact, push, impact, scrape, describe, laws: COLLIDE };
}
