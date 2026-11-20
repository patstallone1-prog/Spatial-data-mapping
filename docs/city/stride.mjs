// Nobody walks backwards or sideways: the body drawn for a person near you faces the way it steps,
// and steps only the way it faces.
//
// Where a person is comes from their day (people.mjs, fleet.mjs) and the view's own nudges -- a
// step aside for someone, round you, clear of a car. Any of those can move a person against the
// way they face for a moment: a crossing that doubles back, a walker brought back to their way
// after a detour, two stepping apart. Drawn as given, that is a walk backwards.
//
// So each one drawn near you has a body of their own that follows where they are (``strideStep``):
// it turns toward the way it has to go -- no quicker than a person turns at that speed (a wider
// turn the faster they go), and on the spot once nearly stopped -- and moves only along the way
// it faces, slowing while it turns. Wanting to go back the way they came, a person stops, turns
// round and goes. The body is never more than ``snap_m`` from where the person is: further (a
// teleport, someone just come into view) it is put there.

//: The numbers (m, s, rad).
export const STRIDE = {
  pivot_rad_s: 5.5,       // turning on the spot, nearly stopped: half a turn in about 0.6 s
  pivot_below_ms: 0.35,   // ... below this speed
  radius_m: 0.3,          // the tightest turn walking (m), and how much wider a metre a second
  radius_per_ms: 0.35,    // (a walk at 1.35 m/s turns on 0.77 m; a run at 3.5 on 1.5 m)
  min_turn_rad_s: 1.2,    // never turning slower than this while going
  accel: 5,               // how quickly speed follows what is wanted (1/s)
  catch_up: 1.0,          // up to this share faster than their pace while behind where they are
  catch_up_m: 1.2,        // ... reached this far behind
  top_ms: 4.5,
  snap_m: 4,              // further than this from where they are: put there
  still_m: 0.04,          // nearer than this: arrived
};

const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); return a < 0 ? a + Math.PI : a - Math.PI; };
//: The way a yaw faces (0 faces -z, as the city's people and cars do).
const fwd = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];

//: One frame of a body ``st`` ({x, z, yaw, v} or null, the first time) following ``e`` ({x, z,
//: yaw, moving, speed}: where the person is and the way they face standing still) over ``dt`` s.
//: Returns the body (``st`` changed, or a new one). ``pace``: the person's own walking speed.
export function strideStep(st, e, dt, pace = 1.35, P = STRIDE) {
  if (!st || !(dt > 0) || dt > 0.5 || Math.hypot(e.x - st.x, e.z - st.z) > P.snap_m) {
    return { x: e.x, z: e.z, yaw: e.yaw ?? 0, v: e.moving ? (e.speed ?? pace) : 0 };
  }
  const dx = e.x - st.x, dz = e.z - st.z, d = Math.hypot(dx, dz);
  const going = d > P.still_m && (e.moving || d > 0.25);
  const want = going ? Math.atan2(-dx, -dz) : (e.yaw ?? st.yaw);
  // The turn: on the spot when nearly stopped, else round a radius that widens with speed.
  const turn = st.v < P.pivot_below_ms ? P.pivot_rad_s : Math.max(P.min_turn_rad_s, st.v / (P.radius_m + P.radius_per_ms * st.v));
  const diff = wrap(want - st.yaw), step = turn * dt;
  st.yaw = wrap(st.yaw + Math.max(-step, Math.min(step, diff)));
  // Speed: their pace (a little more while behind), less the more they still have to turn --
  // nothing at all while what they want is behind them.
  const left = wrap(want - st.yaw), facing = Math.max(0, Math.cos(left));
  const own = Math.max(0.6, e.speed ?? pace);
  const wantV = going ? Math.min(P.top_ms, own * (1 + P.catch_up * Math.min(1, d / P.catch_up_m))) * facing * facing : 0;
  st.v += (wantV - st.v) * Math.min(1, dt * P.accel);
  if (st.v < 0.01) st.v = 0;
  // Along the way it faces, never past where they are.
  const [fx, fz] = fwd(st.yaw), along = dx * fx + dz * fz;
  const move = Math.max(0, Math.min(st.v * dt, along));
  st.x += fx * move; st.z += fz * move;
  return st;
}

//: The bodies of everyone drawn near you, by id: ``follow(entry, dt, pace)`` moves ``entry`` to
//: its body (where it is drawn, the way it faces, how fast it is going); ``sweep(now)`` lets go of
//: those not seen for a while.
export function strideBodies(P = STRIDE) {
  const bodies = new Map();
  return {
    follow(e, now, dt, pace) {
      const st = strideStep(bodies.get(e.id), e, dt, pace, P);
      st.seen = now;
      bodies.set(e.id, st);
      e.x = st.x; e.z = st.z; e.yaw = st.yaw;
      e.speed = st.v; e.moving = st.v > 0.2;
      return st;
    },
    forget(id) { bodies.delete(id); },
    sweep(now, ms = 3000) { for (const [id, st] of bodies) if (now - st.seen > ms) bodies.delete(id); },
    get size() { return bodies.size; },
  };
}
