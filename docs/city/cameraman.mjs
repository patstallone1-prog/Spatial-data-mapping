// The cameraman (docs/70-cameraman-plan.md): the City view looks after itself the way a camera
// operator would. It keeps adjusting as you go, cuts to a better shot when one is needed, and
// shows what you are doing closer. When you hold the view it keeps your choice of where to look and
// bends the camera's path round whatever is in the way instead of stopping on it.
//
// This is the pure part, run in node by the tests: candidate shots, the visibility score, the drift,
// the cut rules and shot memory. It knows nothing of three.js. The page (module 32) gives it the
// subject's points, the view asked for, and an ``occlusion(from, to)`` query; it answers with the
// shot to stand at, a fade to draw over the screen, and whether the outline is needed.
//
// A shot is a set of offsets from the view asked for (the page's yaw, pitch and distance):
//   dYaw, dPitch (rad), distK (a share of the distance), shoulder (m to the camera's right, with the
//   aim moved half as far, so you sit off-centre), lift (m up), and focusMix (how far the aim moves
//   toward what you are dealing with: a person you talk to, a hand holding a phone).

//: The settings. ``strong`` is the default the user chose (2026-11-25): it pushes hard away from what is
//: in the way. ``gentle`` keeps nearer the view asked for; ``off`` is the old magic camera.
export const CAMERAMAN = {
  checkMs: 125,            // how often shots are scored (8 Hz)
  holdCutMs: 2500,         // a shot is held at least so long before another cut
  poorMs: { walk: 400, drive: 250, inside: 700 },   // seen this badly for so long, a cut is looked for
  poorBelow: 0.55,         // the drift's best seen share under which it is "poor"
  cutAbove: 0.85,          // a cut is made only to a shot seen at least this well
  minCutRad: 0.52,         // and at least 30 degrees away (less reads as a jump: it is drifted to)
  fadeOverRad: 1.75,       // a change of more than about 100 degrees fades out and in instead of swooping
  swoopS: { walk: 0.6, drive: 0.45, inside: 0.95 },
  fadeOutS: 0.2, fadeInS: 0.3,
  ghostBelow: 0.35, ghostAfterMs: 250,
  // The drift's ease: time constants (s) and the most it moves a second.
  ease: { strong: 0.28, gentle: 0.5, held: 0.14, inside: 0.6 },
  rate: { dYaw: 1.6, dPitch: 0.8, distK: 1.3, shoulder: 1.6, lift: 1.2, focusMix: 1.5 },
  // How far from the view asked for the drift may go.
  reach: { walk: 1.05, drive: 0.75, inside: 0.4 },
  // How much being seen counts against straying from the view asked for.
  seen: { strong: 3.2, gentle: 1.6 },
  // Named shots hold for so long after their event.
  holdEventMs: { fight: 3000, crash: 3500, arrive: 2500, door: 1500 },
  // At the wheel, stopped this long (at a light), the view cuts to the side; moving again, back.
  driveSideAfterMs: 4000, driveSideOffMps: 3,
};

const HOME = Object.freeze({ dYaw: 0, dPitch: 0, distK: 1, shoulder: 0, lift: 0, focusMix: 0 });
const KEYS = ["dYaw", "dPitch", "distK", "shoulder", "lift", "focusMix"];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (t) => t * t * (3 - 2 * t);

//: Where the camera stands, and what it looks at, for ``shot`` round ``aim`` given the view asked for
//: (``base``: yaw, pitch, dist). The same arithmetic as the page's placeCamera.
export function shotPose(base, aim, shot, focus = null) {
  const yaw = base.yaw + shot.dYaw, pitch = clamp(base.pitch + shot.dPitch, -0.15, 1.25), d = base.dist * shot.distK;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const fm = focus ? shot.focusMix : 0;
  const look = {
    x: aim.x + rx * shot.shoulder * 0.5 + (focus ? (focus.x - aim.x) * fm : 0),
    y: aim.y + (focus ? (focus.y - aim.y) * fm : 0),
    z: aim.z + rz * shot.shoulder * 0.5 + (focus ? (focus.z - aim.z) * fm : 0),
  };
  const at = {
    x: look.x + rx * shot.shoulder * 0.5 + Math.sin(yaw) * Math.cos(pitch) * d,
    y: look.y + Math.sin(pitch) * d + shot.lift,
    z: look.z + rz * shot.shoulder * 0.5 + Math.cos(yaw) * Math.cos(pitch) * d,
  };
  return { at, look, yaw, pitch, dist: d };
}

// ---- What is in the way ---------------------------------------------------------------------------

//: Whether the segment a->b passes through ``box``: a box turned ``yaw`` about the vertical, centre
//: (cx, cz), half sizes (hx, hz) along its own axes, from y0 to y1. Returns the entry fraction or -1.
export function segmentBox(a, b, box) {
  const c = Math.cos(box.yaw || 0), s = Math.sin(box.yaw || 0);
  // Into the box's own frame (x along its width, z along its length).
  const lx = (px, pz) => (px - box.cx) * c - (pz - box.cz) * s;
  const lz = (px, pz) => (px - box.cx) * s + (pz - box.cz) * c;
  const p0 = [lx(a.x, a.z), a.y, lz(a.x, a.z)], p1 = [lx(b.x, b.z), b.y, lz(b.x, b.z)];
  const lo = [-box.hx, box.y0, -box.hz], hi = [box.hx, box.y1, box.hz];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k += 1) {
    const d = p1[k] - p0[k];
    if (Math.abs(d) < 1e-9) { if (p0[k] < lo[k] || p0[k] > hi[k]) return -1; continue; }
    let ta = (lo[k] - p0[k]) / d, tb = (hi[k] - p0[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}
//: How much of ``ball`` (x, y, z, r) the segment a->b passes through: 0 when it misses, 1 straight
//: through the middle (the chord's share of the diameter).
export function segmentBall(a, b, ball) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
  if (L2 < 1e-9) return 0;
  const t = clamp(((ball.x - a.x) * dx + (ball.y - a.y) * dy + (ball.z - a.z) * dz) / L2, 0, 1);
  const px = a.x + dx * t - ball.x, py = a.y + dy * t - ball.y, pz = a.z + dz * t - ball.z;
  const d2 = px * px + py * py + pz * pz, r2 = ball.r * ball.r;
  return d2 >= r2 ? 0 : Math.sqrt(1 - d2 / r2);
}

//: The cheap set of things that block the view beside the buildings: boxes (poles, shelters, kiosks,
//: trunks, vehicles, fences) and balls (tree crowns), each with how solid it is to the eye (a crown
//: or a chain-link fence is partly see-through). Filed in squares, so a sight line only meets what
//: is near it. No meshes and no GPU readback.
export function createOccluders({ cell = 4 } = {}) {
  let items = [];
  const grid = new Map();
  const key = (ix, iz) => (ix + 32768) * 65536 + (iz + 32768);
  function file(item, i) {
    const r = item.kind === "ball" ? item.r : Math.hypot(item.hx, item.hz);
    const x = item.kind === "ball" ? item.x : item.cx, z = item.kind === "ball" ? item.z : item.cz;
    for (let ix = Math.floor((x - r) / cell); ix <= Math.floor((x + r) / cell); ix += 1) {
      for (let iz = Math.floor((z - r) / cell); iz <= Math.floor((z + r) / cell); iz += 1) {
        const k = key(ix, iz), list = grid.get(k);
        if (list) list.push(i); else grid.set(k, [i]);
      }
    }
  }
  const seen = new Uint32Array(1 << 16);
  let stamp = 0;
  return {
    //: Everything near the subject, replacing what was there.
    set(list) {
      items = list.filter((o) => o && (o.opacity ?? 1) > 0);
      grid.clear();
      items.forEach(file);
      stamp = 0; seen.fill(0);
    },
    get count() { return items.length; },
    //: How hidden ``b`` is from ``a`` by these things: 0 clear, 1 behind something solid. See-through
    //: things combine (two crowns hide more than one). ``skip(item)`` leaves some out (your own car).
    occlusion(a, b, skip = null) {
      stamp = stamp >= 0xfffffffe ? 1 : stamp + 1;
      if (stamp === 1) seen.fill(0);
      let clear = 1;
      const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / (cell * 0.5)));
      for (let s = 0; s <= n; s += 1) {
        const x = a.x + (b.x - a.x) * (s / n), z = a.z + (b.z - a.z) * (s / n);
        const list = grid.get(key(Math.floor(x / cell), Math.floor(z / cell)));
        if (!list) continue;
        for (const i of list) {
          if (i < seen.length) { if (seen[i] === stamp) continue; seen[i] = stamp; }
          const o = items[i];
          if (skip && skip(o)) continue;
          const op = o.opacity ?? 1;
          if (o.kind === "ball") { const f = segmentBall(a, b, o); if (f > 0) clear *= 1 - op * Math.min(1, f * 1.4); }
          else if (segmentBox(a, b, o) >= 0) clear *= 1 - op;
          if (clear < 0.02) return 1;
        }
      }
      return 1 - clear;
    },
  };
}

// ---- Shots -----------------------------------------------------------------------------------------

//: The shots near ``g`` the drift may ease to: the smallest changes first, one way at a time, then a
//: few together (round and in, round and over the shoulder). ``reach`` caps how far round.
function driftCandidates(g, reach, held, dragDir) {
  const out = [];
  const yaws = held ? [0, ...(dragDir ? [0.12 * dragDir, 0.25 * dragDir] : [])] : [0, 0.15, -0.15, 0.35, -0.35, 0.6, -0.6, 0.9, -0.9];
  const forms = [
    [0, 1, 0, 0], [0.14, 1, 0, 0], [0.3, 1, 0, 0], [-0.08, 1, 0, 0],
    [0, 0.78, 0, 0], [0, 0.58, 0, 0], [0.12, 0.7, 0, 0], [0.05, 0.45, 0, 0],
    [0, 1, 0.8, 0], [0, 1, -0.8, 0], [0, 0.78, 0.9, 0], [0, 0.78, -0.9, 0],
    [-0.06, 0.62, 0.6, 0], [-0.06, 0.62, -0.6, 0], [0, 1, 0, 0.8], [0.08, 0.85, 0, 0.6],
  ];
  for (const dy of yaws) {
    for (const [dp, k, sh, lift] of forms) {
      const dYaw = held ? dy : clamp(dy, -reach, reach);
      out.push({ dYaw, dPitch: dp, distK: k, shoulder: sh, lift, focusMix: g.focusMix });
    }
  }
  // Where it already is, and the view asked for.
  out.push({ ...g }, { ...HOME, focusMix: g.focusMix });
  return out;
}

//: A named shot for what you are doing, or null. ``you`` is where you stand, ``focus`` what you are
//: dealing with, ``base`` the view asked for.
export function namedShot(kind, { base, you, focus = null, side = 1 } = {}) {
  const toward = focus && you ? Math.atan2(you.x - focus.x, you.z - focus.z) : null;
  switch (kind) {
    // Over your shoulder at the person you talk to (or the counter you stand at).
    case "talk": case "counter":
      return { dYaw: toward === null ? 0.45 * side : wrap(toward + 0.35 * side - base.yaw), dPitch: -0.12, distK: 0.45, shoulder: 0.6 * side, lift: 0, focusMix: 0.45 };
    // Close on the phone in your hand, over the shoulder, looking down at it (for when a phone is
    // got out; the page asks it with the hand as the focus).
    case "phone":
      return { dYaw: -0.55 * side, dPitch: 0.35, distK: 0.2, shoulder: 0.3 * side, lift: 0, focusMix: 1 };
    // A fight: closer, from the side of the line between you, on the side the camera is already.
    case "fight":
      return { dYaw: toward === null ? 0 : wrap(toward + (Math.PI / 2) * side - base.yaw), dPitch: -0.04, distK: 0.6, shoulder: 0, lift: 0, focusMix: 0.4 };
    case "crash": return { dYaw: 0.5 * side, dPitch: 0.25, distK: 1.3, shoulder: 0, lift: 0, focusMix: 0.3 };
    case "arrive": return { dYaw: 0.6 * side, dPitch: 0.15, distK: 1.25, shoulder: 0, lift: 0, focusMix: 0 };
    case "door": return { ...HOME, distK: 0.7 };
    // At the wheel, waiting at a light: from the side of the car, low.
    case "drive_side": return { dYaw: 1.35 * side, dPitch: -0.2, distK: 0.85, shoulder: 0, lift: 0, focusMix: 0 };
    case "home": return { ...HOME };
    default: return null;
  }
}

// ---- The cameraman ---------------------------------------------------------------------------------

export function createCameraman(options = {}) {
  const C = { ...CAMERAMAN, ...options };
  const cur = { ...HOME }, goal = { ...HOME };
  let checkedAt = -Infinity, lastCutAt = -Infinity, poorSince = null, lowSince = null, ghost = false;
  let move = null;        // a swoop or fade under way: { kind, from, to, t0, dur, swapped }
  let event = null;       // the named shot held now: { kind, until }
  let stoppedSince = null, sideShot = false;
  const stats = { checks: 0, cuts: 0, swoops: 0, fades: 0, hard: 0, ghostMs: 0, rays: 0, lastScore: 1, lastMs: 0 };

  function seenShare(input, shot) {
    const { at } = shotPose(input.base, input.aim, shot, input.focus);
    if (input.solidAt && input.solidAt(at)) return -1;
    let w = 0, s = 0;
    for (const p of input.points) {
      const o = input.occlusion(at, p);
      stats.rays += 1;
      s += p.w * (1 - o); w += p.w;
    }
    if (input.focus && shot.focusMix > 0) { const o = input.occlusion(at, input.focus); stats.rays += 1; s += 0.7 * (1 - o); w += 0.7; }
    return w > 0 ? s / w : 1;
  }
  function cost(shot, from, mode, input) {
    const home = Math.abs(shot.dYaw) * 0.35 + Math.abs(shot.dPitch) * 0.6 + Math.abs(1 - shot.distK) * 0.55 + Math.abs(shot.shoulder) * 0.14 + Math.abs(shot.lift) * 0.12;
    const step = Math.abs(wrap(shot.dYaw - from.dYaw)) * 0.5 + Math.abs(shot.dPitch - from.dPitch) * 0.6 + Math.abs(shot.distK - from.distK) * 0.5 + Math.abs(shot.shoulder - from.shoulder) * 0.2 + Math.abs(shot.lift - from.lift) * 0.15;
    // Room ahead: going somewhere, the camera is kept behind you rather than in front, looking back.
    let ahead = 0;
    if (input?.travel && (input.speed || 0) > 0.8) {
      const yaw = input.base.yaw + shot.dYaw, L = Math.hypot(input.travel.x, input.travel.z) || 1;
      ahead = Math.max(0, (Math.sin(yaw) * input.travel.x + Math.cos(yaw) * input.travel.z) / L) * 0.6;
    }
    return home * (mode === "inside" ? 1.6 : 1) + step + ahead;
  }
  function best(input, list, mode, weight, from) {
    let top = null, topScore = -Infinity, topSeen = 0;
    // Cheapest first, and a shot that could not win even seen in full is not looked through.
    const costed = list.map((shot) => ({ shot, c: cost(shot, from, mode, input) })).sort((a, b) => a.c - b.c);
    for (const { shot, c } of costed) {
      if (weight - c <= topScore) break;
      const s = seenShare(input, shot);
      if (s < 0) continue;
      const score = s * weight - c;
      if (score > topScore) { top = shot; topScore = score; topSeen = s; }
    }
    return top ? { shot: top, seen: topSeen } : null;
  }
  function startMove(kind, to, now, mode) {
    const dur = kind === "fade" ? C.fadeOutS + C.fadeInS : kind === "cut" ? 0 : C.swoopS[mode] ?? C.swoopS.walk;
    move = { kind, from: { ...cur }, to: { ...to }, t0: now, dur: dur * 1000, swapped: false };
    Object.assign(goal, to);
    lastCutAt = now; poorSince = null;
    stats.cuts += 1;
    if (kind === "swoop") stats.swoops += 1; else if (kind === "fade") stats.fades += 1; else stats.hard += 1;
    if (kind === "cut") { Object.assign(cur, to); move = null; }
  }
  //: How a change of shot is made (2026-11-25): mostly swoops, and fades out and in for a change too
  //: big to swoop through; hard cuts in the car, and in a fight when the new shot is right round.
  //: Inside a room everything is gentler: always a slow swoop.
  function moveKind(to, mode, why) {
    const turn = Math.abs(wrap(to.dYaw - cur.dYaw));
    if (mode === "inside") return "swoop";
    if (mode === "drive") return "cut";
    if (why === "fight" && turn > 1.6) return "cut";
    return turn > C.fadeOverRad ? "fade" : "swoop";
  }

  //: One frame. Returns { shot, fade, ghost, cut } -- ``cut`` names a change of shot that began this
  //: frame ("swoop", "fade" or "cut"), for the page to pre-warm the new view's detail.
  function step(input) {
    const now = input.now, dt = Math.max(0, Math.min(0.1, input.dt || 0));
    const mode = input.mode || "walk", strength = input.strength || "strong";
    const held = Boolean(input.held), dragDir = Math.sign(input.dragDir || 0);
    let began = null;
    // One-shot happenings and what you are doing now.
    for (const e of input.events || []) {
      if (C.holdEventMs[e]) event = { kind: e, until: now + C.holdEventMs[e] };
      if (e === "enter_car" || e === "exit_car") { event = null; sideShot = false; if (!held) { startMove("swoop", { ...HOME }, now, mode); began = "swoop"; } }
    }
    if (event && now > event.until) event = null;
    const activity = input.activity || event?.kind || null;

    // At the wheel: stopped long enough at a light, the view cuts to the side; moving, it cuts back.
    if (mode === "drive" && !held) {
      if ((input.speed || 0) < 0.6) stoppedSince ??= now; else if ((input.speed || 0) > C.driveSideOffMps) stoppedSince = null;
      const wantSide = stoppedSince !== null && now - stoppedSince > C.driveSideAfterMs;
      if (wantSide !== sideShot && now - lastCutAt > C.holdCutMs) {
        sideShot = wantSide;
        const to = namedShot(wantSide ? "drive_side" : "home", { side: cur.dYaw < 0 ? -1 : 1 });
        startMove("cut", to, now, mode); began = "cut";
      }
    } else { stoppedSince = null; if (mode !== "drive") sideShot = false; }

    if (now - checkedAt >= C.checkMs && input.occlusion) {
      checkedAt = now;
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      stats.checks += 1;
      const weight = held ? C.seen.strong * 1.25 : C.seen[strength] ?? C.seen.strong;
      const reach = C.reach[mode] ?? C.reach.walk;
      const goalSeen = seenShare(input, goal);
      stats.lastScore = goalSeen;
      // A named shot for what you are doing (talking, a fight), held while it is seen well enough.
      const named = !held && activity ? namedShot(activity, { base: input.base, you: input.you, focus: input.focus, side: cur.dYaw < 0 ? -1 : 1 }) : null;
      if (named && !move && !sideShot) {
        const far = Math.abs(wrap(named.dYaw - goal.dYaw)) + Math.abs(named.distK - goal.distK);
        if (far > 0.25 && now - lastCutAt > C.holdCutMs * 0.5 && seenShare(input, named) >= 0.6) {
          const kind = moveKind(named, mode, activity); startMove(kind, named, now, mode); began = kind;
        }
      } else if (!move && !sideShot && (goalSeen < 0.97 || stats.checks % 8 === 0)) {
        // Drift: the best shot near where it is going (and, when clear, back toward the view asked for).
        const found = best(input, driftCandidates(goal, reach, held, dragDir), mode, weight, goal);
        if (found) Object.assign(goal, found.shot);
        const seen = found ? found.seen : goalSeen;
        // Poor for long enough, and not steering hard: a cut to a shot that sees you well.
        if (!held && seen < C.poorBelow) poorSince ??= now; else poorSince = null;
        const poorFor = poorSince === null ? 0 : now - poorSince;
        if (poorFor > (C.poorMs[mode] ?? C.poorMs.walk) && now - lastCutAt > C.holdCutMs && (input.steering || 0) < 0.6 && !input.crashFresh) {
          const wide = [];
          for (let k = 0; k < 12; k += 1) {
            const dYaw = wrap((k / 12) * Math.PI * 2);
            if (mode === "inside" && Math.abs(dYaw) > 0.9) continue;
            // Keep screen direction: the camera stays on the same side of your line of travel.
            if (input.travel && (input.speed || 0) > 0.8 && !sameSide(input, cur.dYaw, dYaw)) continue;
            for (const [dp, kk, sh] of [[0.1, 0.8, 0], [0.25, 0.7, 0], [0, 0.6, 0.6], [0.35, 1, 0]]) wide.push({ dYaw, dPitch: dp, distK: kk, shoulder: sh, lift: 0, focusMix: goal.focusMix });
          }
          const cut = best(input, wide, mode, weight * 2, HOME);
          if (cut && cut.seen >= C.cutAbove && cut.seen - seen > 0.3) {
            if (Math.abs(wrap(cut.shot.dYaw - cur.dYaw)) < C.minCutRad) Object.assign(goal, cut.shot);
            else { const kind = moveKind(cut.shot, mode, null); startMove(kind, cut.shot, now, mode); began = kind; }
          }
        }
      }
      // The outline: only when you have been hidden for a while and nothing has cleared it.
      const seenNow = seenShare(input, cur);
      if (seenNow < C.ghostBelow) lowSince ??= now; else lowSince = null;
      ghost = lowSince !== null && now - lowSince > C.ghostAfterMs;
      stats.lastMs = typeof performance !== "undefined" ? performance.now() - t0 : 0;
    }
    if (ghost) stats.ghostMs += dt * 1000;

    // Move toward the goal: a swoop or a fade under way, or the drift's ease.
    let fade = 0;
    if (move) {
      const t = move.dur > 0 ? clamp((now - move.t0) / move.dur, 0, 1) : 1;
      if (move.kind === "fade") {
        const outShare = C.fadeOutS / (C.fadeOutS + C.fadeInS);
        if (t < outShare) fade = t / outShare;
        else { if (!move.swapped) { Object.assign(cur, move.to); move.swapped = true; } fade = 1 - (t - outShare) / (1 - outShare); }
      } else {
        const k = smooth(t);
        for (const key of KEYS) cur[key] = key === "dYaw" ? move.from.dYaw + wrap(move.to.dYaw - move.from.dYaw) * k : move.from[key] + (move.to[key] - move.from[key]) * k;
      }
      if (t >= 1) { Object.assign(cur, move.to); move = null; }
    } else {
      const tau = held ? C.ease.held : mode === "inside" ? C.ease.inside : C.ease[strength] ?? C.ease.strong;
      const k = 1 - Math.exp(-dt / tau);
      for (const key of KEYS) {
        const want = key === "dYaw" ? cur.dYaw + wrap(goal.dYaw - cur.dYaw) : goal[key];
        const step = clamp((want - cur[key]) * k, -C.rate[key] * dt * (held ? 2 : 1), C.rate[key] * dt * (held ? 2 : 1));
        cur[key] += step;
      }
      cur.dYaw = wrap(cur.dYaw);
    }
    return { shot: { ...cur }, fade, ghost: ghost || Boolean(move && move.kind === "swoop" && stats.lastScore < C.ghostBelow), cut: began };
  }
  //: Which side of your line of travel a camera turned ``dYaw`` from the view asked for stands on:
  //: kept across a cut, so you still cross the screen the same way.
  function sameSide(input, a, b) {
    const tr = Math.atan2(input.travel.x, input.travel.z);
    const sideOf = (dYaw) => Math.sign(Math.sin(wrap(input.base.yaw + dYaw - tr)) || 1);
    const behind = (dYaw) => Math.abs(Math.sin(wrap(input.base.yaw + dYaw - tr))) < 0.42;
    return behind(b) || sideOf(a) === sideOf(b);
  }
  //: The view taken by hand: the turn and rise the cameraman had made become the view asked for (the
  //: page adds them to its yaw and pitch, so nothing jumps); how near, how high and how far to the
  //: side it stands are kept, and solved again round your drag from there.
  function taken() {
    const was = { dYaw: cur.dYaw, dPitch: cur.dPitch };
    cur.dYaw = 0; cur.dPitch = 0; cur.focusMix = 0;
    Object.assign(goal, cur);
    move = null; event = null; sideShot = false; poorSince = null;
    return was;
  }
  function reset() { Object.assign(cur, HOME); Object.assign(goal, HOME); move = null; event = null; lowSince = null; ghost = false; }
  return { step, taken, reset, stats, get current() { return { ...cur }; }, get goal() { return { ...goal }; }, get moving() { return move ? move.kind : null; } };
}
