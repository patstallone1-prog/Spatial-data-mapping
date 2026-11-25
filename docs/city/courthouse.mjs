// The Superior Court of California, County of San Francisco -- the Civic Center Courthouse at
// 400 McAllister Street -- as a building you are taken to for your hearing (2026-11-24).
//
// The courthouse is outside the district the city draws, so you are brought there (a link in your
// summons) and, when the case is over, back to where you were with its sentence carried out. You
// may not leave before then (the doors are held while court is in session), but the floor is open
// to you: the lobby and its security screening, the corridor, Department 12's courtroom, the jury
// room the jurors go out to, the attorneys' conference rooms, the clerk's office, the judge's
// chambers and the holding cell behind the courtroom.
//
// Department 12 is laid out as California's criminal courtrooms are (Judicial Council, California
// Trial Court Facilities Standards 2011, chapter 4, "Courtrooms"): the judge's bench raised at the
// far end (the dais 0.9 m up: the standard's 18-24 in. above the well plus the bench's step), the
// clerk below and beside it and the court reporter at the foot, the witness stand between the bench
// and the jury box; the jury box along a side wall in two raised tiers (twelve and two alternates);
// the counsel tables facing the bench, the prosecution's nearer the jury; the bar -- a rail with a
// gate -- between the well and the public gallery's pews. Wood panelling to the door heads, plaster
// above, a coffered ceiling, the state's and the nation's flags, the court's seal over the bench.
//
// Pure: COURT_PLAN (rooms, doors, what stands in them), canWalk, seatsOf, castOf (who is in court
// and where they sit, the gallery filled by how grave the case is), hearingOf (the hearing's lines
// and beats, timed). buildCourthouse(THREE, ...) makes the building. Tests: tests/city_courthouse.test.mjs.
import { spectatorsFor } from "./law.mjs";
import { FIRST, LAST, rng } from "./people.mjs";

// ---- the plan (metres; x across, z in from the street doors; the floor at 0) -----------------
const room = (id, name, x0, z0, x1, z1, extra = {}) => ({ id, name, x0, z0, x1, z1, h: 3.6, ...extra });
export const COURT_PLAN = Object.freeze({
  rooms: [
    room("lobby", "Lobby and security screening", -7, 0, 7, 10, { h: 5.2, floor: "marble" }),
    room("corridor", "Third-floor corridor", -2.2, 10, 2.2, 40, { h: 4.2, floor: "marble" }),
    room("court", "Department 12", 2.2, 14, 20.2, 36, { h: 6.2, floor: "carpet" }),
    room("jury", "Jury deliberation room", 12, 6, 20.2, 14, { floor: "carpet" }),
    room("chambers", "Judge's chambers", 20.2, 21, 26.2, 30, { floor: "carpet" }),
    room("holding", "Holding cell", 20.2, 31, 24.2, 35.4, { floor: "concrete" }),
    room("assembly", "Jury assembly room", -12, 11, -2.2, 20.5, { floor: "carpet" }),
    room("conf1", "Attorney conference room 1", -7, 21.5, -2.2, 25.5, { floor: "carpet" }),
    room("conf2", "Attorney conference room 2", -7, 25.5, -2.2, 29.5, { floor: "carpet" }),
    room("clerk", "Criminal clerk's office", -11, 30.5, -2.2, 38.5, { floor: "marble" }),
  ],
  // Openings in the walls between rooms (an axis-aligned span on the shared wall).
  doors: [
    { id: "lobby-corridor", a: "lobby", b: "corridor", x0: -2.2, z0: 9.9, x1: 2.2, z1: 10.1, open: true },
    { id: "court", a: "corridor", b: "court", x0: 2.1, z0: 32.4, x1: 2.3, z1: 35.0, sign: "DEPARTMENT 12" },
    { id: "jury", a: "court", b: "jury", x0: 18.6, z0: 13.9, x1: 19.7, z1: 14.1 },
    { id: "chambers", a: "court", b: "chambers", x0: 20.1, z0: 25.9, x1: 20.3, z1: 27.0 },
    { id: "holding", a: "court", b: "holding", x0: 20.1, z0: 32.2, x1: 20.3, z1: 33.2, bars: true },
    { id: "assembly", a: "corridor", b: "assembly", x0: -2.3, z0: 14.6, x1: -2.1, z1: 16.4 },
    { id: "conf1", a: "corridor", b: "conf1", x0: -2.3, z0: 23.0, x1: -2.1, z1: 24.0 },
    { id: "conf2", a: "corridor", b: "conf2", x0: -2.3, z0: 27.0, x1: -2.1, z1: 28.0 },
    { id: "clerk", a: "corridor", b: "clerk", x0: -2.3, z0: 33.0, x1: -2.1, z1: 34.6 },
  ],
  //: The street doors: held shut while court is in session.
  exit: { x0: -1.4, z0: 0, x1: 1.4, z1: 0.6 },
  // Windows: [room, side, centre along the wall, width, sill, head].
  windows: [["court", "s", 5.2, 1.5, 1.4, 5.4], ["court", "s", 8.0, 1.5, 1.4, 5.4], ["court", "s", 13.0, 1.5, 1.4, 5.4], ["court", "s", 16.0, 1.5, 1.4, 5.4],
    ["jury", "n", 14.2, 1.5, 1.0, 3.2], ["jury", "n", 17.6, 1.5, 1.0, 3.2], ["corridor", "s", -1.0, 1.5, 0.9, 3.9], ["corridor", "s", 1.0, 1.5, 0.9, 3.9]],
  start: { x: 0, z: 30.5, yaw: -Math.PI / 2 },
  // What stands on the floor and cannot be walked through: [x0, z0, x1, z1, what].
  blocks: [
    // Lobby: the screening lane (x-ray belt, the arch), the deputies' desk, benches.
    [-3.2, 3.0, -1.0, 6.2, "x-ray"], [-0.9, 4.3, -0.65, 4.7, "arch"], [0.65, 4.3, 0.9, 4.7, "arch"], [2.6, 5.4, 5.2, 6.4, "desk"],
    [-6.6, 7.6, -4.0, 8.2, "bench"], [4.0, 7.6, 6.6, 8.2, "bench"],
    // Corridor benches.
    [-2.15, 20.0, -1.7, 22.6, "bench"], [1.7, 20.0, 2.15, 22.6, "bench"], [1.7, 27.0, 2.15, 29.6, "bench"],
    // Department 12: the gallery's pews (5 rows a side of the aisle), the bar, the well.
    ...[4.4, 5.5, 6.6, 7.7, 8.8].flatMap((x) => [[x - 0.32, 16.8, x + 0.26, 23.3, "pew"], [x - 0.32, 26.7, x + 0.26, 33.2, "pew"]]),
    [9.9, 14.0, 10.1, 24.4, "bar"], [9.9, 25.6, 10.1, 36.0, "bar"],
    [11.6, 20.0, 12.6, 23.6, "table"], [11.6, 26.4, 12.6, 30.0, "table"],
    [14.0, 24.7, 14.5, 25.3, "lectern"],
    [12.5, 14.0, 18.2, 18.5, "jury box"],
    [16.6, 19.9, 18.2, 21.5, "witness stand"],
    [16.7, 27.0, 18.1, 30.2, "clerk"], [15.8, 22.6, 16.6, 23.5, "reporter"],
    [18.2, 21.4, 18.8, 28.6, "bench"], [18.8, 21.4, 20.2, 21.6, "bench end"], [10.4, 32.6, 11.6, 33.6, "bailiff"],
    // The jury room: its table, the coffee counter.
    [13.6, 8.8, 18.6, 11.2, "table"], [12.0, 6.0, 12.6, 9.5, "counter"],
    // Chambers: the desk, the shelves.
    [22.0, 24.6, 24.2, 25.8, "desk"], [25.7, 21.0, 26.2, 30.0, "shelves"],
    // Holding: its bench.
    [22.6, 34.7, 24.2, 35.4, "bench"],
    // The assembly room's rows of chairs, the conference tables, the clerk's counter.
    ...[13.0, 14.6, 16.2, 17.8].map((z) => [-10.6, z, -4.4, z + 0.55, "chairs"]),
    [-5.6, 22.7, -3.6, 24.3, "table"], [-5.6, 26.7, -3.6, 28.3, "table"],
    [-6.0, 30.5, -5.4, 38.5, "counter"],
  ],
});
const roomById = new Map(COURT_PLAN.rooms.map((r) => [r.id, r]));
//: The room (x, z) is in, or null.
export function roomAt(x, z) {
  for (const r of COURT_PLAN.rooms) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
  return null;
}
//: Whether a walker (``pad`` m round them) can stand at (x, z): on a room's floor clear of its
//: walls -- or in a doorway -- and clear of what stands there. The street doors are not a way out.
export function canWalk(x, z, pad = 0.28) {
  const P = COURT_PLAN;
  let ok = P.rooms.some((r) => x >= r.x0 + pad && x <= r.x1 - pad && z >= r.z0 + pad && z <= r.z1 - pad);
  if (!ok) for (const d of P.doors) {
    const across = d.x1 - d.x0 < 0.5;   // in a wall that runs along z (it is crossed in x)
    if (across ? x >= d.x0 - 0.45 && x <= d.x1 + 0.45 && z >= d.z0 + pad && z <= d.z1 - pad : x >= d.x0 + pad && x <= d.x1 - pad && z >= d.z0 - 0.45 && z <= d.z1 + 0.45) { ok = true; break; }
  }
  if (!ok) return false;
  for (const [x0, z0, x1, z1] of P.blocks) if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) return false;
  return true;
}
//: Whether (x, z) is at the street doors (held while court sits).
export const atExit = (x, z) => x > COURT_PLAN.exit.x0 && x < COURT_PLAN.exit.x1 && z < COURT_PLAN.exit.z1 + 0.5;

//: The seats, by role: {role: [{x, z, y (the seat's floor), yaw (facing)}]}. Facing: yaw 0 looks
//: to -z; +PI/2 to -x; -PI/2 to +x (the bench, from the well and the gallery).
export function seatsOf() {
  const E = -Math.PI / 2, S = Math.PI, N = 0, W = Math.PI / 2;
  const s = (x, z, yaw, y = 0) => ({ x, z, yaw, y });
  const gallery = [];
  for (const x of [8.8, 7.7, 6.6, 5.5, 4.4]) for (const [z0, z1] of [[16.8, 23.3], [26.7, 33.2]]) for (let z = z0 + 0.35; z < z1 - 0.2; z += 0.58) gallery.push(s(x - 0.04, z, E));
  const jurors = [];
  for (let k = 0; k < 7; k += 1) jurors.push(s(13.0 + k * 0.76, 17.55, S, 0.18));
  for (let k = 0; k < 7; k += 1) jurors.push(s(13.0 + k * 0.76, 15.6, S, 0.55));
  const deliberation = [];
  for (let k = 0; k < 5; k += 1) { deliberation.push(s(14.1 + k * 1.05, 8.35, S)); deliberation.push(s(14.1 + k * 1.05, 11.65, N)); }
  deliberation.push(s(13.15, 10.0, E), s(19.05, 10.0, W));
  return {
    judge: [s(19.45, 25.0, W, 0.9)], clerk: [s(17.4, 28.6, W)], reporter: [s(16.2, 23.95, W)], bailiff: [s(11.0, 33.95, W)],
    witness: [s(17.45, 20.8, W, 0.3)], lectern: [s(13.55, 25.0, E)],
    prosecution: [s(11.15, 21.0, E), s(11.15, 22.6, E)], defence: [s(11.15, 27.4, E), s(11.15, 29.0, E)],
    jurors, gallery, deliberation, chambers: [s(23.1, 26.4, N)],
  };
}

const pickOf = (r, list) => list[Math.floor(r() * list.length) % list.length];
const personOf = (seed, role, ageLo = 24, ageHi = 72) => { const r = rng("court-person", seed); return { id: `court:${seed}`, name: `${pickOf(r, FIRST)} ${pickOf(r, LAST)}`, role, age: ageLo + Math.floor(r() * (ageHi - ageLo)) }; };
//: Who is in court for ``file`` (the trial's: judge, prosecutor, defence, accused, script) and
//: where each sits: the judge, the clerk, the court reporter, the bailiff, the prosecutor at the
//: table nearer the jury, your lawyer beside you (none if you speak for yourself), the witnesses
//: in the front row of the gallery until they are called, twelve jurors and two alternates, and
//: the public -- none for a traffic matter, a full house for something like a killing.
export function castOf(R, file, { severity = 1, seed = "" } = {}) {
  const S = seatsOf(), out = [];
  // (Dressed for it: the judge's robe black, the deputy's uniform the Sheriff's green-tan, counsel in suits.)
  const DRESS = { judge: { role: "judge", uniform: "#0d0d10" }, police: { role: "police", uniform: "#5b5a3f" }, court_clerk: { role: "court_clerk", uniform: "#3b4a63" }, lawyer: { title: "Attorney at law" } };
  const add = (id, name, role, seat, extra = {}) => out.push({ id, name, role, seat, home: seat, ...extra, person: { id, name, role: extra.dress && DRESS[extra.dress]?.role || (extra.dress ? null : role), age: extra.age ?? 45, ...(DRESS[extra.dress] || {}) } });
  const nm = (x, fb) => (typeof x === "string" ? x : x?.name) || fb;
  add("court:judge", nm(file.judge, "Judge"), "judge", S.judge[0], { dress: "judge", age: 58, sits: true, enters: true });
  add("court:clerk", personOf(`${seed}:clerk`, "clerk").name, "clerk", S.clerk[0], { dress: "court_clerk", sits: true });
  add("court:reporter", personOf(`${seed}:reporter`, "reporter").name, "reporter", S.reporter[0], { dress: "court_clerk", sits: true });
  add("court:bailiff", `Deputy ${personOf(`${seed}:bailiff`, "deputy").name.split(" ")[1]}`, "bailiff", S.bailiff[0], { dress: "police", age: 41 });
  add("court:people", nm(file.prosecutor, "Deputy District Attorney"), "prosecution", S.prosecution[0], { dress: "lawyer", sits: true, age: 39 });
  if (file.defence && (file.defence.kind !== "self")) add("court:defence", nm(file.defence, "Defence counsel"), "defence", S.defence[1], { dress: "lawyer", sits: true, age: 47 });
  const witnesses = [...new Set((file.script || []).filter((l) => l.who === "witness").map((l) => l.name))].slice(0, 4);
  witnesses.forEach((name, k) => add(`court:witness:${k}`, name, "witness", S.gallery[k * 2], { sits: true, age: 30 + k * 9 }));
  for (let k = 0; k < 14; k += 1) { const p = personOf(`${seed}:juror:${k}`, "juror"); add(`court:juror:${k}`, p.name, k < 12 ? "juror" : "alternate", S.jurors[k], { sits: true, age: p.age, n: k }); }
  const free = S.gallery.slice(8);
  const n = spectatorsFor(R, severity, seed, free.length);
  const r = rng("gallery-seats", seed), order = free.map((s, i) => ({ s, k: r() + (i < 30 ? -0.4 : 0) })).sort((a, b) => a.k - b.k);
  for (let k = 0; k < n; k += 1) { const p = personOf(`${seed}:public:${k}`, "public", 18, 80); add(`court:public:${k}`, p.name, "public", order[k].s, { sits: true, age: p.age }); }
  return out;
}

//: The hearing as beats, each timed (seconds): the court called to order, then each line of the
//: trial's script by whoever says it (the witness called to the stand first), the jury sent out,
//: their deliberation, their return, the verdict. ``words`` sets a line's length.
export function hearingOf(file) {
  const beats = [{ kind: "rise", who: "bailiff", text: "All rise. The Superior Court of California, County of San Francisco, Department 12, is now in session.", s: 7 },
    { kind: "order", who: "judge", text: "Please be seated. We're on the record.", s: 4, gavel: true }];
  const say = (text) => Math.max(4, Math.min(14, 2.2 + String(text).split(/\s+/).length * 0.3));
  let witness = -1, last = null;
  const names = [...new Set((file.script || []).filter((l) => l.who === "witness").map((l) => l.name))];
  for (const l of file.script || []) {
    if (l.who === "witness") { const k = names.indexOf(l.name); if (k !== witness) { if (witness >= 0) beats.push({ kind: "step_down", who: `witness:${witness}`, s: 3 }); witness = k; beats.push({ kind: "call", who: `witness:${k}`, text: `The People call ${l.name}.`, s: 6 }); } }
    else if (witness >= 0 && last === "witness") { beats.push({ kind: "step_down", who: `witness:${witness}`, s: 3 }); witness = -1; }
    beats.push({ kind: "line", who: l.who === "people" ? "prosecution" : l.who === "witness" ? `witness:${names.indexOf(l.name)}` : l.who, name: l.name, text: l.text, exhibits: l.exhibits || [], s: say(l.text) });
    last = l.who;
  }
  if (witness >= 0) beats.push({ kind: "step_down", who: `witness:${witness}`, s: 3 });
  beats.push({ kind: "charge", who: "judge", text: "Members of the jury, you have heard the evidence. You will now retire to the jury room to deliberate. Your verdict must be unanimous.", s: 8 });
  beats.push({ kind: "out", who: "jurors", s: 9 }, { kind: "deliberate", who: "jurors", s: 22 }, { kind: "back", who: "jurors", s: 9 });
  beats.push({ kind: "ask", who: "judge", text: "Has the jury reached a verdict?", s: 4 }, { kind: "verdict", who: "juror:0", s: 7 }, { kind: "sentence", who: "judge", s: 9, gavel: true }, { kind: "adjourn", who: "bailiff", text: "This court is adjourned.", s: 5 });
  return beats;
}
//: The way between two points through the doors (room by room: the doors along the way), for a
//: juror, the judge, a witness: [[x, z], ...].
export function pathBetween(a, b) {
  const ra = roomAt(a.x, a.z), rb = roomAt(b.x, b.z);
  const pts = [[a.x, a.z]];
  if (ra && rb && ra !== rb) {
    const door = COURT_PLAN.doors.find((d) => (d.a === ra.id && d.b === rb.id) || (d.b === ra.id && d.a === rb.id));
    if (door) { const cx = (door.x0 + door.x1) / 2, cz = (door.z0 + door.z1) / 2; const across = door.x1 - door.x0 < 0.5; pts.push(across ? [cx - 0.7, cz] : [cx, cz - 0.7], across ? [cx + 0.7, cz] : [cx, cz + 0.7]); if (pts.length && (across ? a.x > cx : a.z > cz)) { const t = pts[1]; pts[1] = pts[2]; pts[2] = t; } }
  }
  pts.push([b.x, b.z]);
  return pts;
}
// The well's own ways: a witness through the bar's gate to the stand; a juror along the box's
// front to its door.
export const WAYS = {
  toStand: [[10.0, 25.0], [15.2, 25.0], [15.6, 20.8]],
  fromStand: [[15.6, 20.8], [15.2, 25.0], [10.0, 25.0]],
  juryOut: [[18.9, 18.9], [19.15, 15.4], [19.15, 13.2], [18.2, 12.4]],
  judgeIn: [[21.6, 26.45], [19.9, 26.45], [19.45, 25.8]],
};

// ---- the building -------------------------------------------------------------------------------
//: The courthouse as a group, its floor at y 0 and its plan's frame (x, z): every wall, door,
//: pew, table and fitting; seats tagged for click-to-sit (userData.seats). ``judge``: the name on
//: the bench.
export function buildCourthouse(THREE, { judge = "", glass = null } = {}) {
  const G = new THREE.Group(); G.name = "kerbside-courthouse";
  const doc = globalThis.document;
  const tex = (w, h, draw, rep = [1, 1]) => { const cv = doc.createElement("canvas"); cv.width = w; cv.height = h; draw(cv.getContext("2d"), w, h); const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); if ("colorSpace" in t) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const grain = (base, dark, rings = 26) => (x, w, h) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    const r = rng("grain", base);
    for (let i = 0; i < rings; i += 1) { x.strokeStyle = dark; x.globalAlpha = 0.08 + r() * 0.14; x.lineWidth = 1 + r() * 3; x.beginPath(); let y = r() * h; x.moveTo(0, y); for (let px = 0; px <= w; px += 16) { y += (r() - 0.5) * 5; x.lineTo(px, y); } x.stroke(); }
    x.globalAlpha = 1;
  };
  const walnut = tex(256, 256, grain("#5b3a22", "#2c1a0e", 34)), oak = tex(256, 256, grain("#9a6b3f", "#5a3a1e", 28));
  const marble = tex(512, 512, (x, w, h) => {
    x.fillStyle = "#e9e5dd"; x.fillRect(0, 0, w, h);
    const r = rng("marble", 1);
    for (let i = 0; i < 18; i += 1) { x.strokeStyle = r() < 0.5 ? "#b9b3a8" : "#cfc8bc"; x.globalAlpha = 0.5; x.lineWidth = 0.6 + r() * 1.8; x.beginPath(); let px = r() * w, py = 0; x.moveTo(px, py); while (py < h) { px += (r() - 0.5) * 40; py += 10 + r() * 30; x.lineTo(px, py); } x.stroke(); }
    x.globalAlpha = 1; x.strokeStyle = "#cbc4b7"; x.lineWidth = 2; for (let k = 0; k <= 2; k += 1) { x.beginPath(); x.moveTo(k * w / 2, 0); x.lineTo(k * w / 2, h); x.moveTo(0, k * h / 2); x.lineTo(w, k * h / 2); x.stroke(); }
  }, [1, 1]);
  const carpet = tex(128, 128, (x, w, h) => { x.fillStyle = "#24304f"; x.fillRect(0, 0, w, h); x.fillStyle = "#2c3a5e"; for (let i = 0; i < w; i += 16) for (let j = 0; j < h; j += 16) if ((i + j) % 32 === 0) x.fillRect(i + 5, j + 5, 6, 6); x.fillStyle = "#8a6d2e"; for (let i = 0; i < w; i += 32) for (let j = 0; j < h; j += 32) x.fillRect(i + 15, j + 15, 2, 2); });
  // Each surface lit as the room's own lights would light it (no light of the scene's own is
  // added: a light changes every shader's program -- freeze-investigation): its colour carried
  // a share as its own glow, the scene's sky and sun the rest.
  const mats = new Map();
  const mat = (key, { color = 0xffffff, map = null, rough = 0.7, metal = 0, glow = 0.42, side = THREE.FrontSide, rep = null } = {}) => {
    if (mats.has(key)) return mats.get(key);
    const m = new THREE.MeshStandardMaterial({ color, map, roughness: rough, metalness: metal, side });
    m.emissive = new THREE.Color(color).multiplyScalar(glow); if (map) m.emissiveMap = map;
    mats.set(key, m);
    return m;
  };
  const M = {
    walnut: mat("walnut", { map: walnut, rough: 0.42 }), oak: mat("oak", { map: oak, rough: 0.5 }), panel: mat("panel", { map: walnut, rough: 0.38, color: 0xd9c2a8 }),
    plaster: mat("plaster", { color: 0xe8e0d0, rough: 0.92, glow: 0.5 }), ceiling: mat("ceiling", { color: 0xf2eee6, rough: 0.95, glow: 0.55, side: THREE.DoubleSide }),
    marble: mat("marble", { map: marble, rough: 0.2, glow: 0.45 }), carpet: mat("carpet", { map: carpet, rough: 0.98, glow: 0.4 }), concrete: mat("concrete", { color: 0xa9a59c, rough: 0.95 }),
    brass: mat("brass", { color: 0xc9a456, rough: 0.28, metal: 0.85, glow: 0.25 }), steel: mat("steel", { color: 0xb8bcc2, rough: 0.3, metal: 0.8, glow: 0.25 }),
    leather: mat("leather", { color: 0x4a1e1c, rough: 0.55 }), fabric: mat("fabric", { color: 0x3c4a66, rough: 0.9 }), black: mat("black", { color: 0x16181c, rough: 0.6, glow: 0.2 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff3d6 }), sign: mat("sign", { color: 0x1c2433, rough: 0.6 }), white: mat("white", { color: 0xf6f4ef, rough: 0.6, glow: 0.5 }), green: mat("green", { color: 0x2f5d43, rough: 0.6 }),
    paper: mat("paper", { color: 0xf3efe4, rough: 0.9, glow: 0.5 }), screen: new THREE.MeshBasicMaterial({ color: 0x0e1a2b }),
  };
  const add = (geo, m, x, y, z, ry = 0, parent = G) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = false; o.receiveShadow = false; parent.add(o); return o; };
  const box = (w, h, d, m, x, y, z, ry = 0, parent = G) => add(new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z, ry, parent);
  // Floors and ceilings, room by room.
  for (const r of COURT_PLAN.rooms) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const fm = r.floor === "marble" ? M.marble : r.floor === "concrete" ? M.concrete : M.carpet;
    const floor = new THREE.PlaneGeometry(w, d); floor.rotateX(-Math.PI / 2);
    const uv = floor.attributes.uv; for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * w / (r.floor === "marble" ? 2.4 : 1.6), uv.getY(i) * d / (r.floor === "marble" ? 2.4 : 1.6));
    add(floor, fm, cx, 0, cz).userData.surface = `floor:${r.floor}`;
    const ceil = new THREE.PlaneGeometry(w, d); ceil.rotateX(Math.PI / 2); add(ceil, M.ceiling, cx, r.h, cz);
  }
  // Walls: each room's four sides, with its doorways cut out, panelled to 2.4 m (the courtroom's
  // to 3.0, raised panels in walnut) and plaster above. Shared walls are drawn from both sides.
  const T = 0.18;
  const doorsOn = (r, side) => COURT_PLAN.doors.filter((d) => (d.a === r.id || d.b === r.id) && (side === "w" ? Math.abs(d.x0 + (d.x1 - d.x0) / 2 - r.x0) < 0.3 && d.x1 - d.x0 < 0.5 : side === "e" ? Math.abs(d.x0 + (d.x1 - d.x0) / 2 - r.x1) < 0.3 && d.x1 - d.x0 < 0.5 : side === "n" ? Math.abs(d.z0 + (d.z1 - d.z0) / 2 - r.z0) < 0.3 && d.z1 - d.z0 < 0.5 : Math.abs(d.z0 + (d.z1 - d.z0) / 2 - r.z1) < 0.3 && d.z1 - d.z0 < 0.5));
  const DOOR_H = 2.45;
  function wallRun(r, side) {
    const along = side === "w" || side === "e", a0 = along ? r.z0 : r.x0, a1 = along ? r.z1 : r.x1, fixed = side === "w" ? r.x0 : side === "e" ? r.x1 : side === "n" ? r.z0 : r.z1;
    const inward = side === "w" ? 1 : side === "e" ? -1 : side === "n" ? 1 : -1;
    const gaps = doorsOn(r, side).map((d) => (along ? [d.z0, d.z1] : [d.x0, d.x1])).sort((p, q) => p[0] - q[0]);
    if (side === "n" && r.id === "lobby") gaps.push([COURT_PLAN.exit.x0, COURT_PLAN.exit.x1]);
    const panelTo = r.id === "court" ? 3.0 : r.id === "chambers" ? 2.4 : r.id === "holding" ? 0 : 1.1;
    const pieces = [];
    const holes = [...gaps.map(([g0, g1]) => [g0, g1, 0, DOOR_H]), ...COURT_PLAN.windows.filter(([id, sd]) => id === r.id && sd === side).map(([, , c, w, y0, y1]) => [c - w / 2 - 0.08, c + w / 2 + 0.08, y0 - 0.06, y1 + 0.06])].sort((p, q) => p[0] - q[0]);
    let at = a0;
    for (const [g0, g1, h0, h1] of holes) { if (g0 > at) pieces.push([at, g0, 0, r.h]); if (h0 > 0) pieces.push([g0, g1, 0, h0]); pieces.push([g0, g1, h1, r.h]); at = Math.max(at, g1); }
    if (at < a1) pieces.push([at, a1, 0, r.h]);
    for (const [p0, p1, y0, y1] of pieces) {
      const len = p1 - p0, mid = (p0 + p1) / 2, h = y1 - y0;
      if (len <= 0.01 || h <= 0.01) continue;
      const geo = along ? new THREE.BoxGeometry(T, h, len) : new THREE.BoxGeometry(len, h, T);
      const x = along ? fixed + inward * T / 2 * 0 : mid, z = along ? mid : fixed;
      const ry = 0;
      const wall = add(geo, r.id === "holding" ? M.concrete : M.plaster, x, y0 + h / 2, z, ry);
      wall.userData.surface = "wall:plaster";
      // The panelling, on this room's face of the wall.
      const ph = Math.min(panelTo, y1) - y0;
      if (ph > 0.05 && y0 < panelTo) {
        const off = inward * (T / 2 + 0.02);
        const pg = along ? new THREE.BoxGeometry(0.04, ph, len) : new THREE.BoxGeometry(len, ph, 0.04);
        add(pg, r.id === "court" || r.id === "chambers" ? M.walnut : M.oak, along ? fixed + off : mid, y0 + ph / 2, along ? mid : fixed + off);
        // Raised panels and the cap rail, in the courtroom and chambers.
        if (r.id === "court" || r.id === "chambers") {
          const n = Math.max(1, Math.round(len / 1.1));
          for (let k = 0; k < n; k += 1) {
            const c = p0 + (k + 0.5) * len / n, pw = len / n - 0.22;
            for (const [py, phh] of [[0.25, Math.min(1.0, ph - 0.4)], [1.45, Math.max(0, ph - 1.75)]]) {
              if (phh < 0.2) continue;
              const g2 = along ? new THREE.BoxGeometry(0.03, phh, pw) : new THREE.BoxGeometry(pw, phh, 0.03);
              add(g2, M.panel, along ? fixed + off + inward * 0.03 : c, y0 + py + phh / 2, along ? c : fixed + off + inward * 0.03);
            }
          }
          const cap = along ? new THREE.BoxGeometry(0.09, 0.07, len) : new THREE.BoxGeometry(len, 0.07, 0.09);
          add(cap, M.walnut, along ? fixed + off + inward * 0.03 : mid, y0 + ph, along ? mid : fixed + off + inward * 0.03);
        }
      }
      // A skirting board and crown moulding all round.
      if (y0 === 0) { const sk = along ? new THREE.BoxGeometry(0.03, 0.14, len) : new THREE.BoxGeometry(len, 0.14, 0.03); add(sk, M.walnut, along ? fixed + inward * (T / 2 + 0.04) : mid, 0.07, along ? mid : fixed + inward * (T / 2 + 0.04)); }
      const cr = along ? new THREE.BoxGeometry(0.12, 0.12, len) : new THREE.BoxGeometry(len, 0.12, 0.12);
      add(cr, M.white, along ? fixed + inward * (T / 2 + 0.06) : mid, r.h - 0.06, along ? mid : fixed + inward * (T / 2 + 0.06));
    }
  }
  for (const r of COURT_PLAN.rooms) for (const side of ["n", "s", "w", "e"]) wallRun(r, side);
  // Doors: frames in walnut; each door leaf open into its room (the courtroom's a pair, with
  // round windows); a lit sign over the courtroom's.
  for (const d of COURT_PLAN.doors) {
    if (d.open) continue;
    const across = d.x1 - d.x0 < 0.5, len = across ? d.z1 - d.z0 : d.x1 - d.x0, cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    for (const s of [-1, 1]) { const g = across ? new THREE.BoxGeometry(0.3, DOOR_H + 0.1, 0.1) : new THREE.BoxGeometry(0.1, DOOR_H + 0.1, 0.3); add(g, M.walnut, across ? cx : cx + s * len / 2, (DOOR_H + 0.1) / 2, across ? cz + s * len / 2 : cz); }
    add(across ? new THREE.BoxGeometry(0.3, 0.12, len + 0.2) : new THREE.BoxGeometry(len + 0.2, 0.12, 0.3), M.walnut, cx, DOOR_H + 0.06, cz);
    if (d.bars) { for (let k = 0; k < 9; k += 1) add(new THREE.CylinderGeometry(0.015, 0.015, DOOR_H, 6), M.steel, cx, DOOR_H / 2, d.z0 + (k + 0.5) * len / 9); continue; }
    const leaves = d.id === "court" ? 2 : 1, lw = len / leaves;
    for (let k = 0; k < leaves; k += 1) {
      const leaf = new THREE.Group(), hinge = across ? d.z0 + (k === 0 ? 0 : len) : d.x0 + (k === 0 ? 0 : len);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.05, DOOR_H - 0.05, lw - 0.04), M.walnut); slab.position.set(0, (DOOR_H - 0.05) / 2, (k === 0 ? 1 : -1) * lw / 2); leaf.add(slab);
      if (d.id === "court") { const port = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), glass || M.screen); port.position.set(0.03, 1.6, (k === 0 ? 1 : -1) * lw / 2); port.rotation.y = Math.PI / 2; leaf.add(port); }
      const push = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.04), M.brass); push.position.set(0.05, 1.05, (k === 0 ? 1 : -1) * (lw - 0.12)); leaf.add(push);
      leaf.position.set(across ? cx : hinge, 0, across ? hinge : cz);
      leaf.rotation.y = (across ? 0 : Math.PI / 2) + (k === 0 ? 1 : -1) * 1.35;
      G.add(leaf);
    }
    if (d.sign) {
      const t = tex(512, 128, (x, w, h) => { x.fillStyle = "#1c2433"; x.fillRect(0, 0, w, h); x.fillStyle = "#e9d9a8"; x.font = "bold 54px Georgia, serif"; x.textAlign = "center"; x.fillText(d.sign, w / 2, 62); x.font = "28px Georgia, serif"; x.fillText(judge ? `HON. ${judge.toUpperCase()}` : "CRIMINAL", w / 2, 106); });
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: t })); sg.position.set(cx - 0.12, DOOR_H + 0.45, cz); sg.rotation.y = -Math.PI / 2; G.add(sg);
      const lit = tex(512, 96, (x, w, h) => { x.fillStyle = "#2a0606"; x.fillRect(0, 0, w, h); x.fillStyle = "#ff5040"; x.font = "bold 44px Arial, sans-serif"; x.textAlign = "center"; x.fillText("COURT IN SESSION", w / 2, 64); });
      const on = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.22), new THREE.MeshBasicMaterial({ map: lit })); on.position.set(cx - 0.12, DOOR_H + 0.95, cz); on.rotation.y = -Math.PI / 2; G.add(on);
    }
  }
  // The street doors, held: bronze and glass, and the deputies' notice on them.
  for (const s of [-1, 1]) box(1.36, 2.9, 0.08, M.brass, s * 0.7, 0, 0.05);
  const held = tex(512, 256, (x, w, h) => { x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.fillStyle = "#1c2433"; x.font = "bold 40px Arial"; x.textAlign = "center"; x.fillText("COURT IN SESSION", w / 2, 70); x.font = "26px Arial"; x.fillText("Parties to a case in session may not leave", w / 2, 130); x.fillText("the building until it is called and heard.", w / 2, 166); x.font = "italic 22px Arial"; x.fillText("San Francisco Sheriff's Office", w / 2, 222); });
  const note = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: held })); note.position.set(0, 1.5, 0.11); G.add(note);

  // ---- Department 12 ---------------------------------------------------------------------
  // The coffered ceiling: beams each way, lit drums hung between.
  for (let x = 4.2; x < 20.2; x += 2.0) box(0.22, 0.32, 22, M.white, x, 6.2 - 0.32, 25);
  for (let z = 16; z < 36; z += 2.0) box(18, 0.32, 0.22, M.white, 11.2, 6.2 - 0.32, z);
  for (let x = 5.2; x < 20; x += 4.0) for (let z = 17; z < 35; z += 4.0) {
    add(new THREE.CylinderGeometry(0.005, 0.005, 1.2, 4), M.black, x, 5.3, z);
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.32, 20, 1, true), M.brass, x, 4.6, z);
    add(new THREE.CircleGeometry(0.4, 20), M.lamp, x, 4.45, z).rotation.x = Math.PI / 2;
  }
  // The bench: on its dais, panelled, the judge's high-backed chair, the gavel on its block,
  // the nameplate; the seal over it between the flags.
  box(2.0, 0.45, 7.2, M.walnut, 19.2, 0, 25); box(1.6, 0.45, 6.8, M.walnut, 19.4, 0.45, 25);
  box(0.12, 1.35, 7.4, M.walnut, 18.3, 0, 25);
  for (let k = 0; k < 5; k += 1) box(0.03, 0.8, 1.2, M.panel, 18.23, 0.3, 22.0 + k * 1.5);
  box(0.75, 0.06, 7.4, M.walnut, 18.55, 1.32, 25);
  const nameplate = tex(512, 96, (x, w, h) => { x.fillStyle = "#3a2615"; x.fillRect(0, 0, w, h); x.fillStyle = "#e6c77a"; x.font = "bold 40px Georgia, serif"; x.textAlign = "center"; x.fillText(judge ? `JUDGE ${judge.split(" ").slice(-1)[0].toUpperCase()}` : "THE COURT", w / 2, 62); });
  const np = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.19), new THREE.MeshBasicMaterial({ map: nameplate })); np.position.set(18.22, 1.18, 25); np.rotation.y = -Math.PI / 2; G.add(np);
  // The chair: seat, a high back, the arms, leather and brass studs.
  const chair = (x, y, z, ry, high = false, m = M.leather) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; G.add(g);
    box(0.52, 0.1, 0.5, m, 0, 0.42, 0, 0, g); box(0.52, high ? 0.95 : 0.5, 0.08, m, 0, 0.5, 0.22, 0, g);
    box(0.06, 0.22, 0.42, m, -0.27, 0.5, 0, 0, g); box(0.06, 0.22, 0.42, m, 0.27, 0.5, 0, 0, g);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8), M.black, 0, 0.21, 0, 0, g);
    return g;
  };
  chair(19.45, 0.9, 25, -Math.PI / 2, true);
  const gavel = new THREE.Group(); gavel.position.set(18.8, 1.38, 24.2); G.add(gavel);
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 20), M.walnut, 0, 0.012, 0, 0, gavel);
  const hammer = new THREE.Group(); hammer.position.set(0, 0.05, 0.12); gavel.add(hammer);
  const head = add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 14), M.walnut, 0, 0.03, -0.1, 0, hammer); head.rotation.x = Math.PI / 2; head.rotation.z = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.008, 0.01, 0.22, 8), M.walnut, 0, 0.03, 0.0, 0, hammer).rotation.x = Math.PI / 2;
  box(0.02, 0.01, 0.3, M.brass, 18.8, 1.38, 25.6);   // (a pen on the docket)
  box(0.34, 0.02, 0.26, M.paper, 18.75, 1.38, 25.25);
  // The seal: the court's, in gold on navy, over the bench.
  const seal = tex(512, 512, (x, w) => {
    const c = w / 2; x.fillStyle = "#0f1b33"; x.beginPath(); x.arc(c, c, c - 4, 0, Math.PI * 2); x.fill();
    x.strokeStyle = "#d4b25c"; x.lineWidth = 10; x.beginPath(); x.arc(c, c, c - 14, 0, Math.PI * 2); x.stroke(); x.lineWidth = 3; x.beginPath(); x.arc(c, c, c - 72, 0, Math.PI * 2); x.stroke();
    x.fillStyle = "#d4b25c"; x.font = "bold 34px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
    const ring = (text, start, dir) => { const step = 0.115; [...text].forEach((ch, i) => { const a = start + dir * i * step; x.save(); x.translate(c + Math.cos(a) * (c - 44), c + Math.sin(a) * (c - 44)); x.rotate(a + dir * Math.PI / 2); x.fillText(ch, 0, 0); x.restore(); }); };
    const top = "SUPERIOR COURT OF CALIFORNIA", bot = "COUNTY OF SAN FRANCISCO";
    ring(top, -Math.PI / 2 - (top.length - 1) * 0.115 / 2, 1); ring(bot, Math.PI / 2 + (bot.length - 1) * 0.115 / 2, -1);
    // The bear on its ground, the star, EUREKA.
    x.fillStyle = "#d4b25c"; x.beginPath(); x.ellipse(c, c + 30, 92, 46, 0, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(c + 70, c - 2, 34, 28, 0, 0, Math.PI * 2); x.fill();
    for (const lx of [-60, -25, 30, 62]) x.fillRect(c + lx, c + 52, 18, 40);
    x.fillRect(c - 140, c + 96, 280, 8);
    x.beginPath(); for (let k = 0; k < 10; k += 1) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 14 : 34; x.lineTo(c - 96 + Math.cos(a) * rr, c - 74 + Math.sin(a) * rr); } x.fill();
    x.font = "bold 30px Georgia, serif"; x.fillText("EUREKA", c, c - 108);
  });
  const sealM = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48), new THREE.MeshBasicMaterial({ map: seal })); sealM.position.set(20.08, 3.8, 25); sealM.rotation.y = -Math.PI / 2; G.add(sealM);
  add(new THREE.TorusGeometry(0.86, 0.04, 8, 48), M.brass, 20.06, 3.8, 25, -Math.PI / 2);
  // The flags, on poles with gilt eagles, their cloth in folds.
  const flagTex = {
    us: tex(512, 270, (x, w, h) => { for (let k = 0; k < 13; k += 1) { x.fillStyle = k % 2 ? "#fff" : "#b22234"; x.fillRect(0, k * h / 13, w, h / 13 + 1); } x.fillStyle = "#3c3b6e"; x.fillRect(0, 0, w * 0.4, h * 7 / 13); x.fillStyle = "#fff"; for (let r = 0; r < 9; r += 1) for (let c = 0; c < (r % 2 ? 5 : 6); c += 1) { x.beginPath(); x.arc(14 + c * 33 + (r % 2 ? 16 : 0), 12 + r * 15, 4, 0, Math.PI * 2); x.fill(); } }),
    ca: tex(512, 340, (x, w, h) => { x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.fillStyle = "#b22234"; x.fillRect(0, h * 0.86, w, h * 0.14); x.beginPath(); for (let k = 0; k < 10; k += 1) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 12 : 30; x.lineTo(50 + Math.cos(a) * rr, 48 + Math.sin(a) * rr); } x.fill(); x.fillStyle = "#5a3b1e"; x.beginPath(); x.ellipse(w / 2, h * 0.48, 120, 52, 0, 0, Math.PI * 2); x.fill(); x.beginPath(); x.ellipse(w / 2 + 110, h * 0.42, 38, 30, 0, 0, Math.PI * 2); x.fill(); for (const lx of [-90, -50, 50, 90]) x.fillRect(w / 2 + lx, h * 0.55, 20, 44); x.fillStyle = "#3d7a2f"; x.fillRect(w / 2 - 160, h * 0.7, 320, 8); x.fillStyle = "#5a3b1e"; x.font = "bold 40px Georgia, serif"; x.textAlign = "center"; x.fillText("CALIFORNIA REPUBLIC", w / 2, h * 0.8); }),
  };
  const flag = (x, z, t) => {
    add(new THREE.CylinderGeometry(0.025, 0.03, 2.9, 10), M.brass, x, 1.45, z); add(new THREE.CylinderGeometry(0.22, 0.26, 0.08, 16), M.brass, x, 0.04, z); add(new THREE.SphereGeometry(0.06, 12, 8), M.brass, x, 2.95, z);
    const geo = new THREE.PlaneGeometry(0.95, 1.5, 12, 4), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) { const px = pos.getX(i), py = pos.getY(i); pos.setZ(i, Math.sin((px + 0.47) * 9) * 0.04 * (px + 0.47)); pos.setY(i, py - (px + 0.47) * 0.25); }
    geo.computeVertexNormals();
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.85, emissive: new THREE.Color(0x777777), emissiveMap: t }));
    cloth.position.set(x - 0.02, 2.05, z - 0.5); cloth.rotation.y = Math.PI / 2 + 0.25; G.add(cloth);
  };
  flag(19.7, 21.0, flagTex.us); flag(19.7, 29.0, flagTex.ca);
  // The clerk's desk and the court reporter's stenotype, at the bench's foot.
  box(1.4, 1.05, 3.2, M.walnut, 17.4, 0, 28.6); box(1.5, 0.05, 3.3, M.walnut, 17.4, 1.05, 28.6);
  chair(17.4, 0, 28.6, -Math.PI / 2, false, M.fabric);
  box(0.4, 0.3, 0.3, M.black, 17.0, 1.1, 27.6); box(0.5, 0.02, 0.36, M.paper, 17.1, 1.1, 29.4);
  box(0.8, 0.75, 0.9, M.walnut, 16.2, 0, 23.05); chair(16.2, 0, 23.95, -Math.PI / 2, false, M.fabric);
  box(0.24, 0.06, 0.18, M.black, 16.25, 0.75, 23.0); add(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), M.steel, 16.25, 0.55, 23.0);
  // The witness stand: a raised box with its rail, chair and microphone; beside it the screen
  // the exhibits are shown on.
  box(1.6, 0.3, 1.6, M.walnut, 17.4, 0, 20.7); box(0.08, 1.05, 1.6, M.walnut, 16.62, 0.3, 20.7); box(1.6, 1.05, 0.08, M.walnut, 17.4, 0.3, 19.92);
  box(0.12, 0.05, 1.6, M.walnut, 16.62, 1.35, 20.7);
  chair(17.45, 0.3, 20.8, -Math.PI / 2, false, M.leather);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.35, 6), M.black, 16.72, 1.5, 20.7); add(new THREE.SphereGeometry(0.025, 8, 6), M.black, 16.78, 1.68, 20.7);
  const exhibitCanvas = doc.createElement("canvas"); exhibitCanvas.width = 768; exhibitCanvas.height = 432;
  const exhibitTex = new THREE.CanvasTexture(exhibitCanvas); if ("colorSpace" in exhibitTex) exhibitTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: exhibitTex })); screen.position.set(15.0, 2.2, 14.25); G.add(screen);
  box(1.7, 1.0, 0.06, M.black, 15.0, 1.7, 14.2);
  const showExhibit = (title = "", side = "") => {
    const x = exhibitCanvas.getContext("2d"), w = exhibitCanvas.width, h = exhibitCanvas.height;
    x.fillStyle = "#0e1a2b"; x.fillRect(0, 0, w, h);
    if (title) { x.fillStyle = "#fffef9"; x.fillRect(60, 50, w - 120, h - 100); x.fillStyle = "#1d2430"; x.font = "bold 34px Georgia, serif"; x.textAlign = "center"; x.fillText(side === "defence" ? "DEFENCE EXHIBIT" : "PEOPLE'S EXHIBIT", w / 2, 120); x.font = "28px Georgia, serif"; const words = String(title).split(" "); let line = "", y = 200; for (const wd of words) { if ((line + wd).length > 34) { x.fillText(line, w / 2, y); y += 40; line = ""; } line += `${wd} `; } x.fillText(line, w / 2, y); }
    else { x.fillStyle = "#d4b25c"; x.font = "bold 30px Georgia, serif"; x.textAlign = "center"; x.fillText("SUPERIOR COURT · DEPARTMENT 12", w / 2, h / 2); }
    exhibitTex.needsUpdate = true;
  };
  showExhibit();
  // The jury box: two tiers behind a panelled front with a rail, fourteen chairs.
  box(5.7, 0.18, 1.6, M.walnut, 15.35, 0, 17.6); box(5.7, 0.55, 1.6, M.walnut, 15.35, 0, 15.6);
  box(5.7, 1.0, 0.08, M.walnut, 15.35, 0, 18.45); box(5.8, 0.06, 0.16, M.walnut, 15.35, 1.0, 18.45);
  for (let k = 0; k < 6; k += 1) box(0.75, 0.6, 0.03, M.panel, 13.0 + k * 0.9, 0.2, 18.5);
  const jurorSeats = seatsOf().jurors;
  for (const s of jurorSeats) chair(s.x, s.y, s.z, Math.PI, true, M.fabric);
  // The counsel tables (the prosecution's nearer the jury), their chairs, microphones and files;
  // the lectern between.
  for (const z0 of [20.0, 26.4]) {
    box(1.0, 0.74, 3.6, M.walnut, 12.1, 0, z0 + 1.8); box(1.08, 0.04, 3.7, M.walnut, 12.1, 0.74, z0 + 1.8);
    for (const dz of [1.0, 2.6]) { box(0.36, 0.03, 0.3, M.paper, 12.05, 0.78, z0 + dz); add(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), M.black, 12.4, 0.93, z0 + dz - 0.4); }
  }
  for (const s of [...seatsOf().prosecution, ...seatsOf().defence]) chair(s.x, 0, s.z, -Math.PI / 2, false, M.leather);
  box(0.5, 1.12, 0.6, M.walnut, 14.25, 0, 25.0); box(0.6, 0.05, 0.7, M.walnut, 14.25, 1.12, 25.0);
  // The bar: a walnut rail on turned balusters, its gate at the aisle.
  for (const [z0, z1] of [[14.0, 24.4], [25.6, 36.0]]) {
    box(0.12, 0.08, z1 - z0, M.walnut, 10.0, 0.92, (z0 + z1) / 2); box(0.12, 0.08, z1 - z0, M.walnut, 10.0, 0.06, (z0 + z1) / 2);
    const n = Math.round((z1 - z0) / 0.16), bal = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.03, 0.86, 8), M.walnut, n);
    const m4 = new THREE.Matrix4(); for (let k = 0; k < n; k += 1) { m4.makeTranslation(10.0, 0.53, z0 + (k + 0.5) * (z1 - z0) / n); bal.setMatrixAt(k, m4); }
    G.add(bal);
  }
  const gate = new THREE.Group(); gate.position.set(10.0, 0, 24.4); G.add(gate); gate.rotation.y = -0.35;
  box(0.06, 0.86, 1.1, M.walnut, 0, 0.1, 0.55, 0, gate); box(0.1, 0.06, 1.15, M.brass, 0, 0.96, 0.57, 0, gate);
  // The gallery: oak pews in five rows a side, each with its rounded ends and a kneeler rail.
  const pewEnd = (() => { const sh = new THREE.Shape(); sh.moveTo(-0.29, 0); sh.lineTo(0.26, 0); sh.lineTo(0.26, 0.98); sh.quadraticCurveTo(0.26, 1.12, 0.1, 1.12); sh.lineTo(-0.2, 1.12); sh.quadraticCurveTo(-0.29, 1.12, -0.29, 0.95); sh.lineTo(-0.29, 0); const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: false }); g.rotateY(Math.PI / 2); return g; })();
  for (const x of [4.4, 5.5, 6.6, 7.7, 8.8]) for (const [z0, z1] of [[16.8, 23.3], [26.7, 33.2]]) {
    const len = z1 - z0, cz = (z0 + z1) / 2;
    box(0.46, 0.06, len, M.oak, x - 0.04, 0.42, cz); box(0.06, 0.48, len, M.oak, x + 0.2, 0.48, cz); box(0.04, 0.42, len, M.oak, x - 0.24, 0, cz);
    for (const z of [z0, z1 - 0.05]) add(pewEnd, M.oak, x, 0, z);
  }
  // Tall windows down the courtroom's far side and the jury room's, to Civic Center beyond.
  const view = tex(1024, 512, (x, w, h) => {
    const sky = x.createLinearGradient(0, 0, 0, h * 0.7); sky.addColorStop(0, "#7fb0de"); sky.addColorStop(1, "#d8e6ef"); x.fillStyle = sky; x.fillRect(0, 0, w, h);
    const r = rng("civic", 1);
    for (let i = 0; i < 14; i += 1) { const bw = 40 + r() * 90, bh = 90 + r() * 200, bx = r() * w; x.fillStyle = `rgb(${150 + r() * 40},${150 + r() * 35},${145 + r() * 30})`; x.fillRect(bx, h * 0.72 - bh, bw, bh); x.fillStyle = "rgba(60,80,100,.35)"; for (let wy = h * 0.72 - bh + 10; wy < h * 0.7; wy += 14) for (let wx = bx + 6; wx < bx + bw - 6; wx += 12) x.fillRect(wx, wy, 6, 8); }
    // City Hall's dome across the plaza.
    const cx = w * 0.55, base = h * 0.6; x.fillStyle = "#e3dccd"; x.fillRect(cx - 260, base - 60, 520, 140); x.fillRect(cx - 90, base - 150, 180, 100);
    x.fillStyle = "#c9a85c"; x.beginPath(); x.ellipse(cx, base - 150, 82, 92, 0, Math.PI, 0); x.fill(); x.fillRect(cx - 8, base - 290, 16, 50); x.beginPath(); x.arc(cx, base - 292, 12, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#d9d0bf"; for (let k = -6; k <= 6; k += 1) x.fillRect(cx + k * 38 - 6, base - 50, 12, 110);
    x.fillStyle = "#4c7a3d"; for (let k = 0; k < 30; k += 1) { x.beginPath(); x.arc(r() * w, h * 0.76 + r() * 40, 18 + r() * 22, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = "#8d8a82"; x.fillRect(0, h * 0.82, w, h * 0.18);
  });
  const viewMat = new THREE.MeshBasicMaterial({ map: view });
  const windowRow = (xs, z, facing, yb = 1.2, ht = 3.6) => {
    for (const x of xs) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, ht), glass || new THREE.MeshBasicMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0.25 }));
      pane.position.set(x, yb + ht / 2, z - facing * 0.02); pane.rotation.y = facing > 0 ? Math.PI : 0; pane.userData.surface = "glass:window"; G.add(pane);
      for (const s of [-1, 1]) box(0.1, ht + 0.1, 0.12, M.white, x + s * 0.78, yb - 0.05, z - facing * 0.06);
      box(1.66, 0.1, 0.18, M.white, x, yb + ht, z - facing * 0.06); box(1.66, 0.12, 0.26, M.white, x, yb - 0.12, z - facing * 0.1);
      box(0.05, ht, 0.06, M.white, x, yb, z - facing * 0.06); box(1.5, 0.05, 0.06, M.white, x, yb + ht * 0.62, z - facing * 0.06);
    }
    const back = new THREE.Mesh(new THREE.PlaneGeometry(36, 18), viewMat); back.position.set((xs[0] + xs[xs.length - 1]) / 2, yb + 3, z + facing * 9); back.rotation.y = facing > 0 ? Math.PI : 0; G.add(back);
  };
  windowRow([5.2, 8.0, 13.0, 16.0], 36.0 + 0.09, 1, 1.4, 4.0);
  windowRow([14.2, 17.6], 6.0 - 0.09, -1, 1.0, 2.2);
  windowRow([-1.0, 1.0], 40.0 + 0.09, 1, 0.9, 3.0);
  // The bailiff's desk, a wall clock, the courtroom's own lit EXIT.
  box(1.2, 0.76, 1.0, M.walnut, 11.0, 0, 33.1); chair(11.0, 0, 33.95, -Math.PI / 2, false, M.fabric);
  const clock = tex(256, 256, (x, w) => { const c = w / 2; x.fillStyle = "#fff"; x.beginPath(); x.arc(c, c, c - 6, 0, Math.PI * 2); x.fill(); x.strokeStyle = "#222"; x.lineWidth = 8; x.stroke(); x.fillStyle = "#222"; for (let k = 0; k < 12; k += 1) { const a = k * Math.PI / 6; x.fillRect(c + Math.cos(a) * 100 - 3, c + Math.sin(a) * 100 - 3, 6, 6); } x.lineWidth = 7; x.beginPath(); x.moveTo(c, c); x.lineTo(c + 50, c - 40); x.moveTo(c, c); x.lineTo(c - 10, c - 90); x.stroke(); });
  const ck = new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), new THREE.MeshBasicMaterial({ map: clock })); ck.position.set(2.42, 3.6, 25); ck.rotation.y = Math.PI / 2; G.add(ck);

  // ---- the rest of the floor --------------------------------------------------------------
  // The lobby: the x-ray belt and its tunnel, the walk-through arch, the deputies' desk, benches,
  // the directory board, flags.
  box(2.2, 0.72, 0.7, M.steel, -2.1, 0, 4.6, Math.PI / 2); box(1.0, 0.7, 0.8, M.sign, -2.1, 0.72, 4.6, Math.PI / 2); box(2.3, 0.04, 0.6, M.black, -2.1, 0.74, 4.6, Math.PI / 2);
  for (const s of [-1, 1]) box(0.22, 2.1, 0.4, M.sign, s * 0.78, 0, 4.5); box(1.78, 0.2, 0.4, M.sign, 0, 2.1, 4.5);
  box(2.6, 1.05, 1.0, M.walnut, 3.9, 0, 5.9); box(2.7, 0.05, 1.1, M.marble, 3.9, 1.05, 5.9);
  chair(3.4, 0, 6.7, 0, false, M.fabric); chair(4.4, 0, 6.7, 0, false, M.fabric);
  for (const [x0, z, len, ry] of [[-5.3, 7.9, 2.6, 0], [5.3, 7.9, 2.6, 0]]) { box(len, 0.45, 0.5, M.oak, x0, 0, z, ry); box(len, 0.45, 0.06, M.oak, x0, 0.45, z + 0.22, ry); }
  const directory = tex(512, 640, (x, w, h) => { x.fillStyle = "#151d2b"; x.fillRect(0, 0, w, h); x.fillStyle = "#e9d9a8"; x.textAlign = "center"; x.font = "bold 30px Georgia"; x.fillText("CIVIC CENTER COURTHOUSE", w / 2, 50); x.font = "20px Georgia"; x.fillText("400 McAllister Street", w / 2, 80); x.textAlign = "left"; x.font = "22px Arial"; const rows = [["Dept. 12", "Criminal · Floor 3"], ["Jury Assembly", "Floor 3"], ["Criminal Clerk", "Floor 3"], ["Attorney Rooms", "Floor 3"], ["Self-Help Center", "Floor 1"], ["Traffic Court", "Floor 1"], ["Probate", "Floor 2"], ["Family Law", "Floor 4"], ["Civil", "Floor 5"]]; rows.forEach(([a, b], i) => { x.fillText(a, 40, 140 + i * 52); x.textAlign = "right"; x.fillText(b, w - 40, 140 + i * 52); x.textAlign = "left"; }); });
  const db = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), new THREE.MeshBasicMaterial({ map: directory })); db.position.set(-6.88, 1.9, 6.5); db.rotation.y = Math.PI / 2; G.add(db);
  flag(-6.4, 9.4, flagTex.us); flag(6.4, 9.4, flagTex.ca);
  // Corridor benches and a run of pendant lights; the elevators' doors, held for the court.
  for (const [x, z0] of [[-1.92, 20.0], [1.92, 20.0], [1.92, 27.0]]) { box(0.45, 0.45, 2.6, M.oak, x, 0, z0 + 1.3); box(0.06, 0.45, 2.6, M.oak, x + (x < 0 ? -0.2 : 0.2), 0.45, z0 + 1.3); }
  for (let z = 12; z < 40; z += 4) { add(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16), M.brass, 0, 3.95, z); add(new THREE.CircleGeometry(0.28, 16), M.lamp, 0, 3.88, z).rotation.x = Math.PI / 2; }
  for (const z of [11.2, 13.0]) { box(0.06, 2.4, 1.2, M.steel, 2.08, 0, z + 0.6); }
  // The jury room: the long table and its twelve chairs, the coffee counter, a water cooler,
  // the whiteboard with "Unanimous" on it.
  box(5.0, 0.74, 2.4, M.oak, 16.1, 0, 10.0); box(5.1, 0.04, 2.5, M.oak, 16.1, 0.74, 10.0);
  for (const s of seatsOf().deliberation) chair(s.x, 0, s.z, s.yaw, false, M.fabric);
  box(0.6, 0.9, 3.5, M.oak, 12.3, 0, 7.75); box(0.25, 0.35, 0.25, M.black, 12.3, 0.9, 6.8); box(0.28, 1.1, 0.28, M.white, 12.3, 0, 12.5);
  const wb = tex(512, 256, (x, w, h) => { x.fillStyle = "#fbfbf8"; x.fillRect(0, 0, w, h); x.strokeStyle = "#2a5db0"; x.lineWidth = 3; x.font = "30px 'Comic Sans MS', cursive"; x.fillStyle = "#2a5db0"; x.fillText("Verdict must be UNANIMOUS", 30, 60); x.fillText("Burden: beyond a reasonable doubt", 30, 110); x.fillStyle = "#b02a2a"; x.fillText("Guilty  |  Not guilty", 30, 170); });
  const wbm = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: wb })); wbm.position.set(20.08, 1.6, 10); wbm.rotation.y = -Math.PI / 2; G.add(wbm);
  for (let x = 13; x < 20; x += 3) add(new THREE.PlaneGeometry(1.2, 0.6), M.lamp, x, 3.58, 10).rotation.x = Math.PI / 2;
  // Chambers: the desk, its chairs, a wall of law reports, a robe on its hook.
  box(2.2, 0.76, 1.2, M.walnut, 23.1, 0, 25.2); chair(23.1, 0, 26.4, 0, true); chair(22.6, 0, 23.6, Math.PI, false, M.fabric); chair(23.6, 0, 23.6, Math.PI, false, M.fabric);
  box(0.4, 2.6, 9.0, M.walnut, 25.95, 0, 25.5);
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.06), new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: 0x333333 }), 360);
  { const m4 = new THREE.Matrix4(), c = new THREE.Color(), r = rng("books", 1); let k = 0; for (let shelf = 0; shelf < 6; shelf += 1) for (let i = 0; i < 60; i += 1) { m4.makeTranslation(25.8, 0.25 + shelf * 0.42, 21.3 + i * 0.14); books.setMatrixAt(k, m4); c.setHSL([0.0, 0.02, 0.6, 0.33][Math.floor(r() * 4)], 0.45, 0.18 + r() * 0.12); books.setColorAt(k, c); k += 1; } }
  G.add(books);
  add(new THREE.CylinderGeometry(0.22, 0.32, 1.3, 12), M.black, 20.7, 1.4, 29.4);
  for (let x = 21.5; x < 26; x += 2.4) add(new THREE.PlaneGeometry(1.0, 0.6), M.lamp, x, 3.58, 25.5).rotation.x = Math.PI / 2;
  // The holding cell: concrete, a steel bench, a steel toilet.
  box(1.6, 0.45, 0.5, M.steel, 23.4, 0, 35.05); box(0.45, 0.42, 0.55, M.steel, 20.8, 0, 34.9);
  add(new THREE.PlaneGeometry(0.8, 0.4), M.lamp, 22.2, 3.58, 33.2).rotation.x = Math.PI / 2;
  // The assembly room's rows, the conference rooms' tables, the clerk's counter and its windows.
  for (const z of [13.0, 14.6, 16.2, 17.8]) for (let x = -10.2; x < -4.4; x += 0.62) chair(x, 0, z + 0.28, 0, false, M.fabric);
  const tv = tex(512, 288, (x, w, h) => { x.fillStyle = "#0e1a2b"; x.fillRect(0, 0, w, h); x.fillStyle = "#e9d9a8"; x.font = "bold 30px Arial"; x.textAlign = "center"; x.fillText("JURY SERVICE", w / 2, 110); x.font = "22px Arial"; x.fillText("Please wait to be called to a courtroom.", w / 2, 160); x.fillText("$15 a day · Code Civ. Proc. 215", w / 2, 200); });
  const tvm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: tv })); tvm.position.set(-7.2, 2.0, 11.12); G.add(tvm);
  for (const z of [23.5, 27.5]) { box(2.0, 0.74, 1.6, M.oak, -4.6, 0, z); for (const [dx, dz, ry] of [[-0.6, -1.0, 0], [0.6, -1.0, 0], [-0.6, 1.0, Math.PI], [0.6, 1.0, Math.PI]]) chair(-4.6 + dx, 0, z + dz, ry, false, M.fabric); }
  box(0.6, 1.1, 8.0, M.walnut, -5.7, 0, 34.5); box(0.75, 0.05, 8.1, M.marble, -5.7, 1.1, 34.5);
  for (const z of [31.5, 34.5, 37.5]) { const sign = tex(256, 96, (x, w, h) => { x.fillStyle = "#1c2433"; x.fillRect(0, 0, w, h); x.fillStyle = "#e9d9a8"; x.font = "bold 28px Arial"; x.textAlign = "center"; x.fillText(z < 33 ? "FILINGS" : z < 36 ? "PAYMENTS" : "RECORDS", w / 2, 60); }); const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshBasicMaterial({ map: sign })); sm.position.set(-5.38, 2.0, z); sm.rotation.y = Math.PI / 2; G.add(sm); }
  for (const r of ["assembly", "conf1", "conf2", "clerk"]) { const q = roomById.get(r); for (let x = q.x0 + 1.2; x < q.x1 - 0.5; x += 2.6) for (let z = q.z0 + 1.2; z < q.z1 - 0.5; z += 2.6) add(new THREE.PlaneGeometry(1.2, 0.6), M.lamp, x, 3.58, z).rotation.x = Math.PI / 2; }
  // Room names by their doors.
  for (const d of COURT_PLAN.doors) {
    if (d.open || d.id === "court" || d.bars) continue;
    const r = roomById.get(d.b), across = d.x1 - d.x0 < 0.5;
    const t = tex(512, 96, (x, w, h) => { x.fillStyle = "#1c2433"; x.fillRect(0, 0, w, h); x.fillStyle = "#e9d9a8"; x.font = "bold 32px Arial"; x.textAlign = "center"; x.fillText(r.name.toUpperCase(), w / 2, 60); });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.26), new THREE.MeshBasicMaterial({ map: t }));
    const side = d.a === "corridor" ? (d.x0 < 0 ? 1 : -1) : -1;
    sm.position.set(across ? (d.x0 + d.x1) / 2 + side * 0.12 : (d.x0 + d.x1) / 2, DOOR_H + 0.3, across ? (d.z0 + d.z1) / 2 : (d.z0 + d.z1) / 2 + 0.12);
    sm.rotation.y = across ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : 0;
    G.add(sm);
  }
  // Seats to sit in (click-to-sit), in the plan's frame.
  const seats = [];
  for (const [role, list] of Object.entries(seatsOf())) if (["gallery", "defence", "jurors", "deliberation", "chambers", "witness"].includes(role)) for (const s of list) seats.push({ x: s.x, y: s.y + 0.45, z: s.z, role, yaw: s.yaw });
  G.userData.courtSeats = seats;
  return { group: G, gavel: hammer, showExhibit };
}
