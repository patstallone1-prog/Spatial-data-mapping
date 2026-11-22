// Getting into a car and out of it, as a body does: walked over to the driver's door, turned with
// your back to the seat, down onto it, and your legs swung in after you, facing the wheel; out,
// the legs swung out first, up off the seat and a step away from the car. Pure: where the body is
// and how it is bent at each moment (``entryPose``), and where the door and the seat are on a car
// (``carPoints``). The viewer (view.mjs) walks the walker, places it and bends its bones by these.

//: The phases of getting in, in seconds: turned round at the door, sat down, legs in.
export const ENTRY = { turn: 0.35, sit: 0.6, legs: 0.45, walkSpeed: 1.5, door: 0.55, seatDrop: 0.45 };
//: Getting out: legs out, up off the seat, a step away.
export const EXIT = { legs: 0.45, stand: 0.55, step: 0.45 };

const ease = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

//: Where on a car at (x, z) facing ``yaw`` (forward (-sin, -cos)), [w, h, l] in size, the
//: driver's door is to stand at and the driver's seat is: the left side (the driver's in
//: America), or the right with ``side`` -1. {door, seat, out}: points, and the way out of the
//: door ({x, z} unit, away from the car).
export function carPoints(car, dims, side = 1, gap = ENTRY.door) {
  const [w, , l] = dims;
  const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), lx = -Math.cos(car.yaw) * side, lz = Math.sin(car.yaw) * side;
  // The seat a little behind the middle of the car, a third of the way across it; the door at
  // its side, by the seat's front edge.
  const back = -0.06 * l;
  const seat = { x: car.x + fx * back + lx * w * 0.22, z: car.z + fz * back + lz * w * 0.22 };
  const door = { x: car.x + fx * (back + 0.15) + lx * (w / 2 + gap), z: car.z + fz * (back + 0.15) + lz * (w / 2 + gap) };
  return { door, seat, out: { x: lx, z: lz }, forward: { x: fx, z: fz } };
}

//: The body at ``t`` seconds into getting in (``into`` true) or out: {phase, at: 0..1 of the way
//: from the door to the seat, drop (m the hips are lowered), face (rad from facing out of the
//: door toward the car's front: pi facing the car, 0 the back to the seat, pi/2 seated), thigh, shin
//: (rad the hips and knees are bent), lean (the back), done}.
export function entryPose(t, into = true) {
  if (into) {
    const a = ENTRY.turn, b = a + ENTRY.sit, c = b + ENTRY.legs;
    if (t < a) {
      // Turned round at the door, the back to the seat: from facing the car, round by the front
      // (the way the open door is), to facing out of the door.
      const k = ease(t / a);
      return { phase: "turn", at: 0, drop: 0, face: Math.PI * (1 - k), thigh: 0, shin: 0, lean: 0, done: false };
    }
    if (t < b) {
      // Down onto the seat, in through the door as the hips go down.
      const k = ease((t - a) / ENTRY.sit);
      return { phase: "sit", at: k, drop: ENTRY.seatDrop * k, face: 0, thigh: 1.45 * k, shin: -1.4 * k, lean: 0.25 * Math.sin(Math.PI * k), done: false };
    }
    // The legs swung in after: the body turned to face the front.
    const k = ease((t - b) / ENTRY.legs);
    return { phase: "legs", at: 1, drop: ENTRY.seatDrop, face: Math.PI / 2 * k, thigh: 1.45, shin: -1.4, lean: 0.1 * (1 - k), done: t >= c };
  }
  const a = EXIT.legs, b = a + EXIT.stand, c = b + EXIT.step;
  if (t < a) {
    const k = ease(t / a);
    return { phase: "legs", at: 1, drop: ENTRY.seatDrop, face: Math.PI / 2 * (1 - k), thigh: 1.45, shin: -1.4, lean: 0.1 * k, done: false };
  }
  if (t < b) {
    // Up and out: the hips rise as the body comes out through the door, leaning forward to stand.
    const k = ease((t - a) / EXIT.stand);
    return { phase: "stand", at: 1 - k, drop: ENTRY.seatDrop * (1 - k), face: 0, thigh: 1.45 * (1 - k), shin: -1.4 * (1 - k), lean: 0.4 * Math.sin(Math.PI * k), done: false };
  }
  // A step away from the car, turning to walk.
  const k = ease((t - b) / EXIT.step);
  return { phase: "step", at: -0.9 * k, drop: 0, face: 0, thigh: 0, shin: 0, lean: 0, done: t >= c, stepping: true };
}
//: How long getting in (after the walk to the door) or out takes, s.
export const entryTime = (into = true) => (into ? ENTRY.turn + ENTRY.sit + ENTRY.legs : EXIT.legs + EXIT.stand + EXIT.step);

//: Where the body stands at ``pose`` (entryPose) by a car's ``points`` (carPoints): {x, z, yaw}
//: (the walker's yaw: atan2 of the way it faces).
export function entrySpot(points, pose) {
  const { door, seat, out, forward } = points;
  const k = pose.at;
  // From the door to the seat (``at`` 0..1), or past the door, out (``at`` < 0).
  const x = k >= 0 ? door.x + (seat.x - door.x) * k : door.x - out.x * k;
  const z = k >= 0 ? door.z + (seat.z - door.z) * k : door.z - out.z * k;
  // ``face`` 0 is facing out of the door (the back to the seat); pi/2 is facing the front; pi,
  // facing the car. Stepping away, facing out.
  const ax = Math.cos(pose.face), sx = Math.sin(pose.face);
  const wx = out.x * ax + forward.x * sx, wz = out.z * ax + forward.z * sx;
  return { x, z, yaw: Math.atan2(wx, wz) };
}
