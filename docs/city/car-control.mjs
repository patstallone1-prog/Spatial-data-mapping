// Driving your car: the pedals and the wheel as a car has them, not a switch. The arrows press
// the pedals and turn the wheel -- a pedal goes down the longer it is held and comes up when let
// go, the wheel turns while an arrow is held and comes back by itself -- and the car answers as a
// car does: it pulls hard from a standstill and less the faster it goes, it slows by itself off
// the throttle (the engine, the tyres, the air), and the brake bites harder the further it is
// pressed. The wheel turns the car round a curve as tight as the wheels allow at a crawl and as
// wide as the tyres' grip needs at speed: radius v^2 / grip, never tighter than the lock allows.
//
// Three helpers do what a driver does without thinking about the pedals: a lane change (A or D:
// over one lane on a smooth S, the wheel turned and straightened for you), a stop (S: braking
// just hard enough to stand at the line of the red light ahead, or a comfortable stop where there
// is none), and parking (P: a path into the stall or kerb space you are by, driven slowly to it).
// Any arrow takes the car back from a helper.
//
// Pure: the viewer (view.mjs) moves the car by what this returns and keeps it to what it can
// drive on (the page's walls and kerbs).

export const DRIVE = {
  // The pedals: how far a pedal goes down a second while held, and comes up when let go.
  throttleRise: 1.5, throttleFall: 3.2, brakeRise: 1.3, brakeFall: 4.5,
  // Full throttle: so much acceleration from rest, and less with speed (the engine's power, as
  // a = power / v): a family car's 0-60 mph in about nine seconds.
  accel0: 3.4, power: 34,
  // Slowing with no pedal down: rolling (m/s^2), the air (k v^2), and the engine held in gear.
  rolling: 0.12, drag: 0.00042, engineBrake: 0.5,
  // The brake: a touch of it, and all of it (m/s^2: 0.85 g).
  brakeMin: 1.4, brakeMax: 8.3,
  // Reverse: slower, and no faster than a walk and a half.
  reverseAccel: 1.6, reverseTop: 4.2,
  // How long the brake is held at a standstill before the car goes into reverse (s).
  reverseHold: 0.35,
  // The wheel: how fast it turns while an arrow is held (full lock a second), and back by itself.
  steerRate: 1.7, steerReturn: 2.6,
  // At the road wheels: full lock (rad), and the grip the tyres hold round a curve (m/s^2).
  maxWheel: 0.6, grip: 5.5,
  // A lane: how wide, and how long a change takes (s) at a crawl and at speed.
  laneWidth: 3.2, laneTime: [2.2, 3.8], laneMinSpeed: 2,
  // A stop with no line to stop at, and how far short of a line the car stands (m).
  comfortStop: 2.6, lineMargin: 1.0,
  // Parking: the most speed on the way in, and how hard it slows at the end.
  parkSpeed: 2.2, parkBrake: 1.4,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const toward = (v, goal, up, down, dt) => (goal > v ? Math.min(goal, v + up * dt) : Math.max(goal, v - down * dt));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

//: A car's driving state, standing at (x, z) facing ``yaw`` (forward is (-sin yaw, -cos yaw)).
//: ``length`` (m) sets its wheelbase.
export function carState({ x = 0, z = 0, yaw = 0, length = 4.6 } = {}) {
  return { x, z, yaw, v: 0, throttle: 0, brake: 0, wheel: 0, gear: 1, stillFor: 0, wheelbase: Math.max(2.2, length * 0.6),
    lane: null, stopping: null, park: null, parked: true };
}

//: The tightest curve the car can take at ``v`` m/s: 1/radius (m^-1), by its lock at a crawl and
//: by its tyres' grip at speed.
export function maxCurvature(v, wheelbase, D = DRIVE) {
  const lock = Math.tan(D.maxWheel) / wheelbase;
  const s = Math.abs(v);
  return s < 0.5 ? lock : Math.min(lock, D.grip / (s * s));
}
//: The radius (m) of the curve the wheel at ``wheel`` (-1..1) takes the car round at ``v``.
export function turnRadius(v, wheel, wheelbase, D = DRIVE) {
  const k = Math.abs(wheel) * maxCurvature(v, wheelbase, D);
  return k > 1e-6 ? 1 / k : Infinity;
}

//: The acceleration (m/s^2, along the way the gear goes) the pedals give at speed ``s`` (>= 0).
export function pedalAccel(st, s, D = DRIVE) {
  const push = st.gear > 0 ? st.throttle * Math.min(D.accel0, D.power / Math.max(1, s)) : st.throttle * D.reverseAccel;
  const brake = st.brake > 0 ? D.brakeMin + st.brake * (D.brakeMax - D.brakeMin) : 0;
  const resist = (s > 0.01 ? D.rolling + D.drag * s * s : 0) + (st.throttle < 0.02 && s > 0.3 ? D.engineBrake : 0);
  return push - (s > 0 ? brake + resist : 0);
}

//: Over one lane (``dir``: +1 to the left, -1 to the right): begun if the car is going fast
//: enough. Returns why not, or null.
export function startLaneChange(st, dir, D = DRIVE, width = D.laneWidth) {
  if (st.park) return "Parking: an arrow takes the wheel back first.";
  if (st.gear < 0 || st.v < D.laneMinSpeed) return "Too slow to change lanes: get going first.";
  const T = clamp(D.laneTime[0] + st.v * 0.09, D.laneTime[0], D.laneTime[1]);
  st.lane = { dir: Math.sign(dir) || 1, t: 0, T, h0: st.yaw, width, done: 0 };
  st.stopping = null;
  return null;
}
//: Brake to a stop: at ``lineIn`` metres (the line of a red light ahead), or as comfortably as
//: a stop is made where there is no line.
export function startStop(st, lineIn = null) {
  st.stopping = { lineIn: Number.isFinite(lineIn) ? lineIn : null, travelled: 0 };
  st.lane = null;
}

//: A path for parking from where the car is to ``to`` ({x, z, yaw}: where it is to stand and
//: which way it faces). Forward when the space is ahead of the car, in reverse when it is
//: behind. {points, length, reverse}: points along it (x, z, the way it faces).
export function parkPath(from, to, steps = 40) {
  const f0 = [-Math.sin(from.yaw), -Math.cos(from.yaw)], f1 = [-Math.sin(to.yaw), -Math.cos(to.yaw)];
  const dx = to.x - from.x, dz = to.z - from.z, d = Math.hypot(dx, dz);
  const reverse = dx * f0[0] + dz * f0[1] < -0.5;
  // The way the car travels at each end: its nose leading going forward, its tail in reverse.
  const s = reverse ? -1 : 1, k = Math.max(1.2, d * 0.42);
  const P0 = [from.x, from.z], P1 = [from.x + f0[0] * k * s, from.z + f0[1] * k * s];
  const P2 = [to.x - f1[0] * k * s, to.z - f1[1] * k * s], P3 = [to.x, to.z];
  const pts = [];
  let length = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps, u = 1 - t;
    const x = u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0];
    const z = u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1];
    if (i) length += Math.hypot(x - pts[i - 1].x, z - pts[i - 1].z);
    pts.push({ x, z, s: length });
  }
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z;
    // The nose faces the way it goes forward; in reverse, away from the way it goes.
    pts[i].yaw = Math.hypot(tx, tz) > 1e-6 ? Math.atan2(-tx * s, -tz * s) : i ? pts[i - 1].yaw : from.yaw;
  }
  pts[pts.length - 1].yaw = to.yaw;
  return { points: pts, length, reverse, to };
}
//: Begin parking along ``path`` (parkPath).
export function startPark(st, path) {
  st.park = { path, s: 0 };
  st.lane = null; st.stopping = null;
}
//: Where along a park path the car is at distance ``s``: {x, z, yaw}.
export function alongPath(path, s) {
  const P = path.points;
  if (s <= 0) return P[0];
  for (let i = 1; i < P.length; i += 1) {
    if (P[i].s >= s) {
      const a = P[i - 1], b = P[i], t = (s - a.s) / Math.max(1e-6, b.s - a.s);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: a.yaw + wrap(b.yaw - a.yaw) * t };
    }
  }
  return P[P.length - 1];
}

//: One frame (``dt`` s) of driving with the arrows ``input`` ({up, down, left, right}) held.
//: ``env``: {top (the most speed here, m/s)}. Changes ``st`` (its speed, pedals, wheel, heading)
//: and returns the move {dx, dz} -- and {event} when a helper finished: "stopped", "parked",
//: "lane" (a lane change made).
export function stepCar(st, input, dt, env = {}, D = DRIVE) {
  const r = stepCarMove(st, input, dt, env, D);
  // Where it would be: the viewer puts back where it is (its walls and kerbs) before the next step.
  st.x += r.dx; st.z += r.dz;
  return r;
}
function stepCarMove(st, input, dt, env, D) {
  const { up = false, down = false, left = false, right = false } = input;
  const top = env.top ?? 30;
  let event = null;
  const steering = left || right;
  // An arrow takes the car back from a helper: the wheel from a lane change or the parking, the
  // pedals from a stop.
  if (st.park && (up || down || steering)) st.park = null;
  if (st.lane && steering) st.lane = null;
  if (st.stopping && up) st.stopping = null;
  if (up || down || steering) st.parked = false;

  // ---- parking: along the path, slowly, stopping at its end ----
  if (st.park) {
    const P = st.park.path, left_ = P.length - st.park.s;
    const want = Math.min(D.parkSpeed, Math.sqrt(2 * D.parkBrake * Math.max(0, left_)));
    const speed = toward(Math.abs(st.v), want, 1.2, 3, dt);
    st.park.s = Math.min(P.length, st.park.s + speed * dt);
    const at = alongPath(P, st.park.s);
    const dx = at.x - st.x, dz = at.z - st.z;
    st.yaw = at.yaw;
    st.v = P.reverse ? -speed : speed;
    st.throttle = 0; st.brake = 0; st.wheel = 0;
    if (st.park.s >= P.length - 0.02) { st.park = null; st.v = 0; st.parked = true; st.brake = 1; event = "parked"; }
    return { dx, dz, event };
  }

  // ---- the pedals ----
  const s0 = Math.abs(st.v);
  const still = s0 < 0.25;
  st.stillFor = still ? st.stillFor + dt : 0;
  // Into reverse: the brake held on at a standstill; back into drive with the throttle.
  if (st.gear > 0 && still && down && !up && st.stillFor > D.reverseHold && !st.stopping) { st.gear = -1; st.v = 0; }
  else if (st.gear < 0 && still && up && !down) { st.gear = 1; st.v = 0; }
  // The arrow that pushes the way the gear goes, and the one that brakes.
  const go = st.gear > 0 ? up : down, stop = st.gear > 0 ? down : up;
  let throttleGoal = go ? 1 : 0, brakeGoal = stop ? 1 : 0;
  if (st.stopping) {
    // Just hard enough: v^2 / 2d to the line, a comfortable stop where there is none.
    const S = st.stopping;
    let need = D.comfortStop;
    if (S.lineIn !== null) {
      const d = S.lineIn - S.travelled - D.lineMargin;
      need = d > 0.3 ? (s0 * s0) / (2 * d) : D.brakeMax;
    }
    throttleGoal = 0;
    brakeGoal = clamp((need - D.engineBrake - D.rolling - D.brakeMin) / (D.brakeMax - D.brakeMin), 0, 1);
    if (need > D.engineBrake + D.rolling + 0.2) brakeGoal = Math.max(brakeGoal, 0.02);
    if (s0 < 0.15) { st.stopping = null; st.v = 0; st.brake = 1; st.parked = true; event = "stopped"; }
  }
  st.throttle = toward(st.throttle, throttleGoal, D.throttleRise, D.throttleFall, dt);
  // (A helper's brake is set as it is needed, not pressed in slowly.)
  st.brake = st.stopping ? toward(st.brake, brakeGoal, 4, 4, dt) : toward(st.brake, brakeGoal, D.brakeRise, D.brakeFall, dt);
  if (st.parked && !go) st.brake = Math.max(st.brake, 0.5);   // held standing
  const cap = st.gear > 0 ? top : Math.min(top, D.reverseTop);
  let s = Math.max(0, s0 + pedalAccel(st, s0, D) * dt);
  s = Math.min(cap, s);
  st.v = st.gear * s;
  if (st.stopping) st.stopping.travelled += s * dt;

  // ---- the wheel, and the curve it takes the car round ----
  let fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
  let dx, dz;
  if (st.lane) {
    // A lane change: over ``width`` on a smooth S (y = W (t/T - sin(2 pi t / T) / 2 pi)), the
    // heading turned toward the new lane and back.
    const L = st.lane;
    L.t = Math.min(L.T, L.t + dt);
    const k = L.t / L.T, y = L.width * (k - Math.sin(2 * Math.PI * k) / (2 * Math.PI));
    const lat = y - L.done;
    L.done = y;
    const vy = (L.width / L.T) * (1 - Math.cos(2 * Math.PI * k));
    st.yaw = L.h0 + L.dir * Math.atan2(vy, Math.max(1, s));
    const hx = -Math.sin(L.h0), hz = -Math.cos(L.h0), lx = -Math.cos(L.h0), lz = Math.sin(L.h0);
    dx = hx * s * dt + lx * lat * L.dir; dz = hz * s * dt + lz * lat * L.dir;
    st.wheel = toward(st.wheel, 0, D.steerReturn, D.steerReturn, dt);
    if (L.t >= L.T) { st.yaw = L.h0; st.lane = null; event = "lane"; }
    return { dx, dz, event };
  }
  const steer = (left ? 1 : 0) - (right ? 1 : 0);
  st.wheel = steer ? toward(st.wheel, steer, D.steerRate, D.steerRate * 1.6, dt) : toward(st.wheel, 0, D.steerReturn, D.steerReturn, dt);
  const curvature = st.wheel * maxCurvature(st.v, st.wheelbase, D);
  // Round the curve: the yaw turns by the distance gone over the radius (backwards in reverse).
  const ds = st.v * dt;
  st.yaw += curvature * ds;
  fx = -Math.sin(st.yaw - curvature * ds / 2); fz = -Math.cos(st.yaw - curvature * ds / 2);
  dx = fx * ds; dz = fz * ds;
  return { dx, dz, event };
}

//: The way a signalled junction ahead holds the car: of ``signals`` ([{x, z, light, line}]: a
//: junction's centre, what its light shows the car's approach, and how far before the centre its
//: line is), the nearest within ``reach`` m ahead and within ``cone`` rad of the way the car is
//: going -- {distance to its line, light} -- or null.
export function lightAhead(st, signals, reach = 70, cone = 0.45) {
  const fx = -Math.sin(st.yaw), fz = -Math.cos(st.yaw);
  let best = null;
  for (const g of signals) {
    const dx = g.x - st.x, dz = g.z - st.z, along = dx * fx + dz * fz;
    if (along < 1 || along > reach) continue;
    if (Math.abs(Math.atan2(dx * fz - dz * fx, along)) > cone) continue;
    const toLine = along - (g.line ?? 6);
    if (toLine < -1) continue;
    if (!best || toLine < best.toLine) best = { toLine, light: g.light, x: g.x, z: g.z };
  }
  return best;
}
