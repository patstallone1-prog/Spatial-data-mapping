// How much of the living city is drawn, and how finely: the people and the traffic nearest you in
// full, then moderate just out of reach of that, then low, and past that not drawn at all -- only
// kept track of (their day says where they are at any moment), so that each is drawn in its basic
// form the moment it comes back into range.
//
// The full ring is not a circle round you. It reaches out ahead the way you are going -- further
// the faster -- and, riding a bus or a cab, along the road it is about to take: what you are about
// to see is drawn in full before you see it, and what is behind you drops back sooner.

//: Tiers, finest first.
export const FULL = 0, MODERATE = 1, LOW = 2, TRACKED = 3;

//: The rings' radii at a standstill (m): full, moderate and low; past the last, tracked only.
//: Cars carry further than people (bigger, and seen down the length of a street).
export const DETAIL_RINGS = { people: [55, 130, 240], cars: [85, 190, 360] };

//: A thing changes tier only once it is this share past the ring (either way), so one standing on
//: a ring's edge -- or you, pacing on it -- does not flick between two forms frame after frame.
export const DETAIL_HYSTERESIS = 0.08;

//: How far ahead the rings reach for a given speed (m/s): one at a standstill, 1.4 at a walk,
//: three or four at a city driving speed, never more than DETAIL_STRETCH_MAX.
export const DETAIL_STRETCH_PER_MS = 0.28;
export const DETAIL_STRETCH_MAX = 4.0;
//: Behind you the rings are pulled in a little at speed (what is behind falls away soonest).
export const DETAIL_BEHIND = 0.85;

//: A route ahead is followed this far (m) at most, and sampled every so many metres along it.
export const ROUTE_AHEAD_M = 420, ROUTE_STEP_M = 15;

//: The stretch for a speed.
export function stretchFor(speed) {
  return Math.min(DETAIL_STRETCH_MAX, 1 + Math.max(0, speed) * DETAIL_STRETCH_PER_MS);
}

//: The field round ``focus`` ({x, z}) moving at (vx, vz) m/s, with ``ahead`` the route about to be
//: taken (points {x, z, s}, s the metres along it from here). ``eff(x, z)`` is how far a point is
//: in the field's measure -- metres at a standstill, shorter ahead and along the route.
export function detailField(focus, { vx = 0, vz = 0, ahead = null } = {}) {
  const speed = Math.hypot(vx, vz);
  const hx = speed > 0.3 ? vx / speed : 0, hz = speed > 0.3 ? vz / speed : 0;
  const stretch = stretchFor(speed), behind = speed > 0.3 ? 1 + (1 / DETAIL_BEHIND - 1) * Math.min(1, speed / 6) : 1;
  // Further along a route than straight ahead: the road it takes is known, not guessed.
  const routeStretch = Math.max(stretch * 1.5, 3);
  const pts = ahead && ahead.length ? ahead : null;
  function eff(x, z) {
    const dx = x - focus.x, dz = z - focus.z;
    let e;
    if (hx || hz) {
      const along = dx * hx + dz * hz, across = dx * hz - dz * hx;
      e = Math.hypot(along > 0 ? along / stretch : along * behind, across);
    } else e = Math.hypot(dx, dz);
    // Along the route: as near as its nearest point ahead, plus that point's way along it (taken
    // at the route's stretch) -- a corner two hundred metres on is drawn as one fifty away.
    if (pts) {
      for (const p of pts) {
        const d = Math.abs(x - p.x) + Math.abs(z - p.z);
        if (d + p.s / routeStretch >= e) continue;
        const r = Math.hypot(x - p.x, z - p.z) + p.s / routeStretch;
        if (r < e) e = r;
      }
    }
    return e;
  }
  //: The tier for a thing of ``kind`` ("people" or "cars") at (x, z), given the tier it had (or
  //: undefined, the first time it is seen).
  function tier(kind, x, z, was) {
    const rings = DETAIL_RINGS[kind] || DETAIL_RINGS.people, e = eff(x, z);
    for (let i = 0; i < rings.length; i += 1) {
      const r = rings[i];
      const bound = was === undefined ? r : was <= i ? r * (1 + DETAIL_HYSTERESIS) : r * (1 - DETAIL_HYSTERESIS);
      if (e < bound) return i;
    }
    return TRACKED;
  }
  return { eff, tier, speed, stretch, heading: [hx, hz] };
}

//: Points along a polyline ``pts`` ([[x, z], ...] or [{x, z}, ...]) from (x, z) on, every
//: ROUTE_STEP_M up to ROUTE_AHEAD_M: what a route ahead is given to detailField as.
export function routeSamples(pts, from = null) {
  const P = (pts || []).map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p)).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z));
  if (from) P.unshift(from);
  const out = [];
  let s = 0, next = 0;
  for (let i = 1; i < P.length && s < ROUTE_AHEAD_M; i += 1) {
    const a = P[i - 1], b = P[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    while (next <= s + len && next <= ROUTE_AHEAD_M) {
      const k = len > 0 ? (next - s) / len : 0;
      out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, s: next });
      next += ROUTE_STEP_M;
    }
    s += len;
  }
  return out;
}

//: The focus's velocity, smoothed over about half a second from where it was: the walker and the
//: car say where they are, not how fast they are going.
export function velocityTracker(smooth_s = 0.5) {
  let last = null, vx = 0, vz = 0;
  return {
    update(x, z, dt) {
      if (last && dt > 0 && dt < 1) {
        const k = Math.min(1, dt / smooth_s), ix = (x - last.x) / dt, iz = (z - last.z) / dt;
        // A teleport (a jump of more than a car could go in the time) is not a speed.
        if (Math.hypot(ix, iz) < 60) { vx += (ix - vx) * k; vz += (iz - vz) * k; }
      }
      last = { x, z };
      return { vx, vz };
    },
    get: () => ({ vx, vz }),
  };
}

//: The things to draw, split by tier, nearest first within each, and no more of a tier than its
//: cap: past the cap a thing is drawn at the next tier down, not left out (a crowd too big to draw
//: in full is drawn in full near you and simpler further off). ``items`` carry ``detail`` and ``d``.
export function byTier(items, caps) {
  const out = [[], [], []];
  const sorted = items.filter((q) => q.detail < TRACKED).sort((a, b) => a.d - b.d);
  for (const q of sorted) {
    let t = q.detail;
    while (t < 2 && out[t].length >= caps[t]) t += 1;
    if (out[t].length < caps[t]) out[t].push(q);
  }
  return out;
}
