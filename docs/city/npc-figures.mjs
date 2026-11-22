// The people nearest you, drawn as MakeHuman people: one low-poly body for the men and one for the
// women (MakeHuman's own CC0 proxies), and over it parts from MakeHuman's CC0 library -- a top and
// a bottom (each suit cut at the waist, so any top goes with any bottom), shoes, a hairstyle, a
// beard or a moustache, a hat, eyebrows, eyes. Built by tools/avatars/build_crowd_people.py in
// headless Blender, published to the store's crowd/ folder by tools/avatars/publish_crowd_people.py
// (docs/55-makehuman-crowd.md).
//
// Drawn the way a crowd is drawn: every part is one instanced draw for everyone wearing it, skinned
// on the graphics card from the bones of each clip (idle, walk, run) baked once into a texture.
// Nobody is copied and nothing is made when someone steps near: a fixed room for
// NEAR_FIGURES_MAX people, each frame filled with whoever is there. Each person is themselves by
// what is drawn for them -- which parts, their colours, their skin, their height, their build and
// their age (morphs: thinner, heavier, more muscled, older) -- all chosen from who they are.
//
// Everyone in view big enough on the screen to be told from a jointed figure is drawn this way
// (figurePlan: FIGURE_MIN_PX tall, or within FIGURE_NEAR_YOU_M of you). The jointed figures
// (view.mjs drawPeople) are those further off, and past them the basic shapes. Nothing here is
// required: until the files load -- or where they are not published -- the page draws the people
// as it always did.

//: How many people at most are drawn as characters at once: the room each part's instances have.
import { BIKE, pedalAt } from "./vehicles.mjs";

export const NEAR_FIGURES_MAX = 80;
//: (Kept for figurePlan: those drawn and those coming, together. Nothing is readied ahead now --
//: a person costs nothing until drawn -- but the plan still says who is coming.)
export const FIGURES_HELD_MAX = 96;
//: A person this many CSS pixels tall on the screen, or more, is drawn as a character: below it
//: a jointed figure and a character are a few pixels apart (at 1080 pixels high and the page's 50
//: degree view, about 78 m off).
export const FIGURE_MIN_PX = 26;
//: Within this of you (the walker), a character however small the view makes them.
export const FIGURE_NEAR_YOU_M = 30;
//: Readied this long before they come into it, along the way they are going (s), and this much
//: further out besides (m: the camera moves too).
export const FIGURE_PREP_S = 6, FIGURE_PREP_M = 8;

//: How far off (m, from the camera) a person ``height`` m tall stands FIGURE_MIN_PX tall, for a
//: view ``fovDeg`` degrees high on a screen ``screenPx`` CSS pixels high.
export function figureReach(fovDeg, screenPx, height = 1.75, minPx = FIGURE_MIN_PX) {
  return (height * screenPx) / (2 * Math.tan((fovDeg * Math.PI) / 360) * minPx);
}
//: Who is a character this frame. ``people``: [{id, x, z, vx, vz, female, fits, inView}] (fits: a
//: character can do what they are doing). ``cam``, ``you``: {x, z}. Returns {draw, ready, want}:
//: those drawn (in view, within ``reach`` of the camera or FIGURE_NEAR_YOU_M of you, nearest
//: first), those coming (within it out of view, or heading into it within FIGURE_PREP_S), and how
//: many of each body.
export function figurePlan(people, cam, you, reach, { prepS = FIGURE_PREP_S, prepM = FIGURE_PREP_M, max = NEAR_FIGURES_MAX, held = FIGURES_HELD_MAX, has = null } = {}) {
  // (One already a character keeps it a little further out, so one on the edge does not flick.)
  const inside = (q, x, z, grow) => {
    const g = grow + (has && has(q.id) ? reach * 0.12 : 0);
    return Math.hypot(x - cam.x, z - cam.z) <= reach + g || Math.hypot(x - you.x, z - you.z) <= FIGURE_NEAR_YOU_M + g;
  };
  const draw = [], ready = [];
  for (const q of people) {
    if (!q.fits) continue;
    q.d = Math.hypot(q.x - cam.x, q.z - cam.z);
    if (inside(q, q.x, q.z, 0)) { (q.inView ? draw : ready).push(q); continue; }
    // On the way in: anywhere along the next prepS seconds of their way (sampled each second).
    const v = Math.hypot(q.vx || 0, q.vz || 0);
    if (v <= 0.05) { if (inside(q, q.x, q.z, prepM)) ready.push(q); continue; }
    for (let t = 1; t <= prepS; t += 1) if (inside(q, q.x + q.vx * t, q.z + q.vz * t, prepM)) { ready.push(q); break; }
  }
  const byD = (a, b) => a.d - b.d;
  draw.sort(byD); ready.sort(byD);
  const spilled = Math.max(0, draw.length - max);
  if (spilled) draw.length = max;
  if (ready.length > held - draw.length) ready.length = Math.max(0, held - draw.length);
  const want = { female: 0, male: 0 };
  for (const q of draw) want[q.female ? "female" : "male"] += 1;
  for (const q of ready) want[q.female ? "female" : "male"] += 1;
  return { draw, ready, want, spilled };
}

//: The turn from a person's yaw to the export's own facing (+z) for it to face their way (-z).
export const FACING_OFFSET = Math.PI;
//: The clips' own speeds (m/s): a walk played at a person's pace turns as fast as they go.
export const WALK_MS = 1.35, RUN_MS = 3.4;
//: The clips baked this many frames a second (each frame blended with the next as it plays).
export const BAKE_FPS = 30;
//: A change of clip (idle, walk, run) cross-faded over this long (s).
const FADE_S = 0.3;
//: The phone they carry (the imported smartphone, beside the page).
export const PHONE_FILE = "city/models/objects/imp-smartphone.glb";
//: The slots a person is dressed in, in the order they are drawn.
export const SLOTS = ["body", "head", "mouth", "top", "bottom", "shoes", "hair", "facial_hair", "hat", "eyebrows", "eyes"];
//: Hats by how often they are worn on a San Francisco street: a baseball cap most, a beanie some,
//: a fedora seldom (an older man's, mostly). Shares of everyone.
export const HATS = [["baseball_cap", 0.09], ["beanie", 0.035], ["fedora01", 0.008]];
//: The legs with no pocket for a phone (wardrobe.mjs dressFor ``legs``): their wearers leave it
//: at home.
export const NO_POCKETS = new Set(["skirt", "running_shorts", "leggings", "dress"]);
//: Phone cases (sRGB), by how common.
const PHONE_CASES = ["#1b1b1e", "#1b1b1e", "#1b1b1e", "#2a2d33", "#e8e6e1", "#3b4f7a", "#7a3b4f", "#c9b48a", "#4f6b4a"];
//: The ways of walking (bake): each person keeps one.
export const WALKS = ["Walk", "WalkBrisk", "WalkEasy", "WalkSway"];
//: The clips played once rather than round and round (work's reach to a counter).
const ONCE = /:reach$/;
//: A kitchen counter's top above the floor (metres): kitchen-3d.mjs's COUNTER_Y.
export const COUNTER_TOP = 0.92;

// ---- who wears what ---------------------------------------------------------------------------

//: A small seeded stream (mulberry32 on a string's hash): the same person, the same draws.
function stream(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickOf = (r, list) => list[Math.floor(r() * list.length) % list.length];
//: The wardrobe's garments (wardrobe.mjs dressFor ``top``) to MakeHuman's suits: a suit or a
//: button-up the elegant suit, work clothes the work suit, running gear the sports suit.
const TOP_PREFER = { suit: "elegantsuit", button_up: "elegantsuit", hi_vis: "worksuit", work_jacket: "worksuit", chef: "worksuit", scrubs: "worksuit", running: "sportsuit" };
const LEGS_PREFER = { suit_trousers: "elegantsuit", work_trousers: "worksuit", scrubs: "worksuit", running_shorts: "sportsuit", sweatpants: "sportsuit" };
//: Hairstyles by the wardrobe's cut (dressFor ``hair``), for each body.
const CUTS = {
  female: { long: ["long01", "long01", "ponytail01", "braid01", "bob02"], collar: ["bob02", "bob02", "short02", "afro01"], short: ["short03", "short04", "short02", "afro01"] },
  male: { long: ["long01", "ponytail01"], collar: ["short02", "afro01", "short01"], short: ["short01", "short03", "short04", "short02", "afro01"] },
};
const BEARD_SHARE = 0.12, MOUSTACHE_SHARE = 0.09;
const HAT_COLOURS = { fedora01: ["#2b2b2e", "#4a3b2c", "#6b5a45", "#1f2a36", "#8a7d6b"],
  baseball_cap: ["#1f2a44", "#14171c", "#8a1c22", "#2f5d34", "#c9c3b5", "#d9a23a", "#3a6fb0", "#5a5f66"],
  beanie: ["#22252b", "#5a2b2b", "#2d3e57", "#6d6a63", "#7a5a2c", "#3e5a3c"] };
//: Hair under a cap or a beanie: close-cut, or tied back out of it.
const UNDER_HAT = { male: ["short03", "short02", "short01"], female: ["ponytail01", "bob02", "short02"] };

//: A body's parts by slot: [{index, asset, id, slot}] from the manifest's ``parts``.
export function slotsOf(parts) {
  const out = Object.fromEntries(SLOTS.map((s) => [s, []]));
  parts.forEach((p, index) => (out[p.slot] ||= []).push({ index, asset: p.asset, id: p.id, slot: p.slot }));
  return out;
}
//: What a person wears, from who they are (``look``: the view's lookOf -- colours, the wardrobe's
//: garment and cut, age, heritage, build) and the parts a body has (slotsOf). Returns
//: {sex, parts: [{slot, index, colour}], weight, muscle, old, height, width}: every choice the
//: person's own, from their id.
export function crowdLook(id, look, slots, { height = 1.75, build = 1, female = null, modelHeight = 1.75 } = {}) {
  const r = stream(String(id) + "|crowd");
  const sex = female === true ? "female" : female === false ? "male" : r() < 0.5 ? "female" : "male";
  const s = slots[sex] || slots;
  const parts = [];
  // (What the garment asks for where the body has one; else the everyday kinds; else any.)
  const pref = (list, want) => { const hit = want ? list.filter((p) => p.asset.includes(want)) : []; return hit.length ? hit : list.filter((p) => !/elegant|work|sport/.test(p.asset)); };
  const choose = (slot, want) => { const list = s[slot] || []; if (!list.length) return null; const c = pref(list, want); return pickOf(r, c.length ? c : list); };
  const add = (slot, part, colour) => { if (part) parts.push({ slot, index: part.index, colour }); };
  add("body", { index: -1 }, look?.skin || "#c99a7a");
  // The face, finer than the body, and the inside of the mouth behind it.
  add("head", (s.head || [])[0], look?.skin || "#c99a7a");
  add("mouth", (s.mouth || [])[0], "#4a2a2c");
  // A top and a bottom from any of the suits (a casual top over another suit's trousers): the
  // garment and the legs say which kinds.
  add("top", choose("top", TOP_PREFER[look?.garment] || null), look?.top || "#56606b");
  add("bottom", choose("bottom", LEGS_PREFER[look?.legs] || null), look?.bottom || "#2f3640");
  add("shoes", choose("shoes"), look?.shoes || "#2a2a2a");
  const age = look?.age ?? 35;
  // A hat by how often each is worn (HATS), where the body has it.
  let hat = null;
  { const u = r(); let acc = 0;
    for (const [asset, share] of HATS) { acc += share * (asset === "fedora01" ? (age > 50 && sex === "male" ? 3 : 0.5) : asset === "baseball_cap" && age > 60 ? 0.6 : 1); if (u < acc) { hat = (s.hat || []).find((p) => p.asset === asset) || null; break; } } }
  // Everyone has hair: the wardrobe's cut, a close crop for the bald.
  const cut = look?.cut && look.cut !== "none" ? look.cut : "short";
  const names = hat ? UNDER_HAT[sex] : look?.bald ? ["short04"] : (CUTS[sex][cut] || CUTS[sex].short);
  // (Curls more for those whose heritage has them; otherwise the cut's list as it is.)
  const afro = look?.heritage === "black" && !hat && !look?.bald && r() < 0.45;
  const hairName = afro ? "afro01" : pickOf(r, names);
  add("hair", (s.hair || []).find((p) => p.asset === hairName) || choose("hair"), look?.hair || "#2b1d14");
  if (sex === "male" && age >= 18) {
    const b = r();
    if (b < BEARD_SHARE) add("facial_hair", (s.facial_hair || []).find((p) => /beard/.test(p.asset)), look?.hair || "#2b1d14");
    else if (b < BEARD_SHARE + MOUSTACHE_SHARE) add("facial_hair", (s.facial_hair || []).find((p) => /moustache/.test(p.asset)), look?.hair || "#2b1d14");
  }
  if (hat) add("hat", hat, pickOf(r, HAT_COLOURS[hat.asset] || HAT_COLOURS.baseball_cap));
  add("eyebrows", choose("eyebrows"), look?.hair || "#2b1d14");
  add("eyes", choose("eyes"), "#ffffff");
  // The build: the wardrobe's (wider or narrower about each sex's own) to the weight morph; some
  // muscle; age to the older body and skin.
  const mean = sex === "female" ? 0.9 : 1;
  const weight = Math.max(-1, Math.min(1, ((build - mean) / 0.14) * 0.85 + (r() - 0.5) * 0.3));
  const muscle = Math.max(0, Math.min(1, r() * (sex === "male" ? 0.7 : 0.35)));
  const old = Math.max(0, Math.min(1, (age - 38) / 42));
  // A phone, in a pocket if they have one (else left at home); the way they walk.
  const pocket = !NO_POCKETS.has(look?.legs) && age >= 12;
  const phone = pocket ? pickOf(r, PHONE_CASES) : null;
  const walk = WALKS[Math.floor(r() * WALKS.length) % WALKS.length], pace = 0.92 + r() * 0.16;
  return { sex, parts, weight, muscle, old, height: height / modelHeight, width: 1 + (build - mean) * 0.25, phone, walk, pace };
}

// ---- the renderer -----------------------------------------------------------------------------

//: ``store`` is the public store's npc/ folder (as the page names it): the crowd is beside it in
//: crowd/, whose current.json names the build. Without one, the files come from ``base`` beside
//: the page (a local build; the folder is not in the public repo).
//: ``work``: also bake the kitchen's clips (WORK_CLIPS: carrying, reaching to a counter, chopping,
//: stirring, pouring) and where the hands are in every frame (handsOf), for a cook whose hands hold
//: what they carry; ``only``: load just that body ("male" or "female").
export function npcFigures(THREE, { loadModel, asset, parent, base = "city/models/crowd/", store = null, capacity = NEAR_FIGURES_MAX, work = false, only = null }) {
  const S = { ready: false, failed: false, loading: null, retryAt: 0, bodies: {}, manifest: null, drawn: new Set(), drawnPrev: new Set(), anim: new Map(), looks: new Map(),
    warm: 0, bakeMs: 0, frames: 0, last: { people: 0, draws: 0, triangles: 0 } };
  let from = null;
  const url = (f) => (from ? from + f : asset(base + f));
  const crowdStore = () => {
    if (!store) return null;
    try { return new URL("../crowd/", new URL(store, globalThis.location?.href)).href; } catch { return null; }
  };
  const storeBuild = async () => {
    const at = crowdStore();
    if (!at) return null;
    const r = await fetch(new URL("current.json", at), { cache: "no-cache" }).catch(() => null);
    const cur = r?.ok ? await r.json().catch(() => null) : null;
    return cur?.build ? new URL(`${cur.build}/`, at).href : null;
  };
  const texLoader = new THREE.TextureLoader();
  const tex = (f) => new Promise((ok, no) => texLoader.load(url(f), (t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ok(t); }, undefined, no));

  //: A texture's average (linear), over its covered pixels (alpha over a half): a colour laid over
  //: it is the person's own, the texture's light and dark kept.
  function meanOf(texture) {
    const img = texture.image;
    try {
      const c = (globalThis.OffscreenCanvas ? new OffscreenCanvas(16, 16) : Object.assign(document.createElement("canvas"), { width: 16, height: 16 }));
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      const acc = [0, 0, 0, 0];
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) { acc[0] += lin(d[i]); acc[1] += lin(d[i + 1]); acc[2] += lin(d[i + 2]); acc[3] += 1; }
      return acc[3] ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] : [0.5, 0.5, 0.5];
    } catch { return [0.5, 0.5, 0.5]; }
  }
  //: A buffer attribute's values as plain floats (normalized, interleaved or not).
  function floats(attr, size) {
    const out = new Float32Array(attr.count * size);
    const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (let i = 0; i < attr.count; i += 1) for (let k = 0; k < size; k += 1) out[i * size + k] = get[k].call(attr, i);
    return out;
  }

  //: Every clip baked into one texture: a row a frame, three texels a bone (the rows of its
  //: matrix, from rest to posed, in the file's own space); ``table`` names each clip's first row,
  //: frames and length. Made here from the three the file has (Idle, Walk, Run): the ways of
  //: walking (WALKS), the cyclist, and the phone held to the ear, up to film, or read -- and
  //: taken out of a pocket into each.
  function bake(gltf, skeleton, hand) {
    const t0 = performance.now();
    const root = gltf.scene, mixer = new THREE.AnimationMixer(root);
    const clipOf = (n) => gltf.animations.find((a) => a.name === n) || gltf.animations.find((a) => a.name.toLowerCase().includes(n.toLowerCase()));
    const src = { Idle: clipOf("Idle"), Walk: clipOf("Walk"), Run: clipOf("Run") };
    const nb = skeleton.bones.length, width = nb * 3;
    const B = boneMap(skeleton);
    const V3 = () => new THREE.Vector3(), Q4 = () => new THREE.Quaternion();
    const pos = (b, out = V3()) => out.setFromMatrixPosition(b.matrixWorld);
    const wq = (o, out = Q4()) => o.getWorldQuaternion(out);
    const sample = (k, t) => { mixer.stopAllAction(); const a = mixer.clipAction(src[k]); a.reset().play(); mixer.setTime(((t % src[k].duration) + src[k].duration) % src[k].duration); };
    const update = () => root.updateMatrixWorld(true);
    //: A turn ``q`` in the world given to ``bone`` (its children carried with it).
    const turnWorld = (bone, q) => { const pw = wq(bone.parent); bone.quaternion.premultiply(pw.clone().invert().multiply(q).multiply(pw)); bone.updateMatrixWorld(true); };
    const setWorldQ = (bone, q) => { const pw = wq(bone.parent); bone.quaternion.copy(pw.invert().multiply(q)); bone.updateMatrixWorld(true); };
    const aim = (bone, from, to) => { const o = pos(bone); const q = Q4().setFromUnitVectors(from.clone().sub(o).normalize(), to.clone().sub(o).normalize()); turnWorld(bone, q); };
    //: Two bones reaching ``target`` with their end, the joint between bent toward ``pole``.
    function ik(upper, lower, end, target, pole) {
      if (!upper || !lower || !end) return;
      const A = pos(upper), Bj = pos(lower), C = pos(end);
      const a = A.distanceTo(Bj), b = Bj.distanceTo(C);
      const d = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, A.distanceTo(target)));
      const u = target.clone().sub(A).normalize();
      const pv = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
      const ca = (a * a + d * d - b * b) / (2 * a * d), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
      aim(upper, Bj, A.clone().add(u.multiplyScalar(ca * a)).add(pv.multiplyScalar(sa * a)));
      aim(lower, pos(end), target);
    }
    const rotX = (a) => Q4().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a), rotZ = (a) => Q4().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
    // ---- the pedestrian's stand (the walk's passing step, upright) and the idle on it
    const stand = new Map(), idle0 = new Map(), dq = Q4();
    if (src.Walk && B.leftfoot && B.rightfoot) {
      const pa = V3(), pb = V3();
      let best = Infinity;
      for (let f = 0; f < 60; f += 1) {
        sample("Walk", (f / 60) * src.Walk.duration); update();
        pos(B.leftfoot, pa); pos(B.rightfoot, pb);
        const d = Math.hypot(pa.x - pb.x, pa.z - pb.z) + Math.abs(pa.y - pb.y) * 2;
        if (d < best) { best = d; for (const b of skeleton.bones) stand.set(b, [b.quaternion.clone(), b.position.clone()]); }
      }
    }
    const putStand = () => { for (const [b, [qt, at0]] of stand) { b.quaternion.copy(qt); if (b === B.hips) b.position.copy(at0); } update(); };
    if (stand.size && B.spine && B.head) {
      // (Upright: the walk leans into its step; standing, the spine is turned to put the head over
      // the hips.)
      putStand();
      const lean = pos(B.head).sub(pos(B.spine)).normalize();
      const C = Q4().setFromUnitVectors(lean, new THREE.Vector3(0, 1, 0)), pW = wq(B.spine.parent);
      stand.get(B.spine)[0].copy(pW.clone().invert().multiply(C).multiply(pW).multiply(stand.get(B.spine)[0]));
    }
    if (src.Idle && stand.size) { sample("Idle", 0); for (const b of skeleton.bones) idle0.set(b, b.quaternion.clone().invert()); }
    const poseIdle = (t) => {
      sample("Idle", t);
      if (idle0.size) for (const [b, [qt, at0]] of stand) { dq.multiplyQuaternions(idle0.get(b), b.quaternion); b.quaternion.multiplyQuaternions(qt, dq); if (b === B.hips) b.position.copy(at0); }
      update();
    };
    // ---- the ways of walking: the walk's swing of the arms, of the hips, the lean and the head
    const STYLE = { Walk: {}, WalkBrisk: { arms: 1.35, lean: 0.07 }, WalkEasy: { arms: 0.55, hips: 0.8, lean: -0.03, slouch: 0.12 }, WalkSway: { arms: 0.9, hips: 1.8, roll: 0.05 } };
    const ARMS = ["leftshoulder", "leftarm", "leftforearm", "rightshoulder", "rightarm", "rightforearm"].map((k) => B[k]).filter(Boolean);
    const HIPS = ["hips", "spine", "spine1"].map((k) => B[k]).filter(Boolean);
    const scaleFromStand = (bones, k) => { for (const b of bones) { const s0 = stand.get(b)?.[0]; if (!s0) continue; const d = s0.clone().invert().multiply(b.quaternion); b.quaternion.copy(s0).multiply(Q4().slerp(d, k)); } };
    const poseWalk = (style, t) => {
      sample("Walk", t);
      const st = STYLE[style] || {};
      if (st.arms && st.arms !== 1) scaleFromStand(ARMS, st.arms);
      if (st.hips && st.hips !== 1) scaleFromStand(HIPS, st.hips);
      update();
      if (st.lean && B.spine1) turnWorld(B.spine1, rotX(st.lean));
      if (st.slouch && B.neck) turnWorld(B.neck, rotX(st.slouch));
      if (st.roll && B.spine) turnWorld(B.spine, rotZ(st.roll * Math.sin((t / src.Walk.duration) * Math.PI * 2)));
    };
    const poseRun = (t) => { sample("Run", t); update(); };
    // ---- the phone: held at the ear, up ahead to film, in front to read; and in the pocket
    const PH = {
      call: { at: "head", off: [-0.085, 0.07, 0.01], L: [0, 0.8, -0.6], N: [1, 0, 0], pole: [-1, -0.6, 0.25], head: rotZ(0.12) },
      record: { at: "neck", off: [-0.11, 0.12, 0.4], L: [0, 1, 0.05], N: [0, 0.12, -1], pole: [-0.9, -1, -0.1] },
      text: { at: "spine2", off: [-0.05, -0.04, 0.3], L: [0, 0.55, 0.83], N: [0, 0.83, -0.55], pole: [-0.7, -1, -0.3], head: rotX(0.32) },
    };
    const POCKET = [-0.17, -0.09, 0.07];
    const basis = (L, N) => { const l = L.clone().normalize(), n = N.clone().sub(l.clone().multiplyScalar(N.dot(l))).normalize(); return new THREE.Matrix4().makeBasis(l.clone().cross(n), l, n); };
    const bindFrame = basis(hand.L, hand.N), bindQ = Q4().setFromRotationMatrix(bindFrame);
    const held = Object.fromEntries(Object.entries(PH).map(([k, p]) => {
      const q = Q4().setFromRotationMatrix(basis(new THREE.Vector3(...p.L), new THREE.Vector3(...p.N))).multiply(bindQ.clone().invert());
      return [k, { ...p, q, hand: q.clone().multiply(hand.bindQ) }];
    }));
    const grip = hand.grip.clone();   // (the phone's middle from the wrist, as bound)
    const ease = (x) => x * x * (3 - 2 * x);
    //: The phone ``kind`` brought up by ``u`` (0 at the side, 1 held): the hand to the pocket
    //: (u to 0.3), in it (to 0.45), then up to where it is held, turned as it is held.
    function phone(kind, u) {
      const p = held[kind];
      if (!p || u <= 0 || !B.rightarm) return;
      const anchor = pos(B[p.at] || B.head).add(new THREE.Vector3(...p.off));
      const wrist = anchor.clone().sub(grip.clone().applyQuaternion(p.q));
      const pocket = pos(B.hips).add(new THREE.Vector3(...POCKET));
      const h0 = pos(B.righthand), q0 = wq(B.righthand);
      let target, q = null;
      if (u < 0.3) target = h0.lerp(pocket, ease(u / 0.3));
      else if (u < 0.45) target = pocket;
      else { const s = ease(Math.min(1, (u - 0.45) / 0.55)); target = pocket.clone().lerp(wrist, s); q = q0.clone().slerp(p.hand, s); }
      ik(B.rightarm, B.rightforearm, B.righthand, target, new THREE.Vector3(...(u < 0.45 ? [-0.5, 0, -1] : p.pole)));
      if (q) setWorldQ(B.righthand, q);
      if (p.head && u > 0.45 && B.head) turnWorld(B.head, Q4().slerp(p.head, ease(Math.min(1, (u - 0.45) / 0.55))));
    }
    // ---- the cyclist: sat on the saddle, leant to the bars, the feet on the pedals going round
    const fromBike = (p) => new THREE.Vector3(-p[0], p[1], -p[2]);   // (the bike faces -z, the model +z)
    function poseCycle(f, frames) {
      putStand();
      const seat = fromBike([0, BIKE.saddle[1] + 0.085, BIKE.saddle[2] + 0.03]);
      B.hips.position.copy(B.hips.parent.worldToLocal(seat.clone())); update();
      const grips = [fromBike(BIKE.grips[0]), fromBike(BIKE.grips[1])].map((g) => g.add(new THREE.Vector3(0, 0.02, -0.06)));
      // Lean forward from the waist till the hands come to the bars.
      if (B.spine1 && B.rightarm) {
        const reach = pos(B.rightarm).distanceTo(pos(B.rightforearm)) + pos(B.rightforearm).distanceTo(pos(B.righthand));
        const q0 = B.spine1.quaternion.clone();
        let best = 0, miss = Infinity;
        for (let a = 0.1; a <= 1.2; a += 0.05) {
          B.spine1.quaternion.copy(q0); update(); turnWorld(B.spine1, rotX(a));
          const m = Math.abs(pos(B.rightarm).distanceTo(grips[1]) - reach * 0.93);
          if (m < miss) { miss = m; best = a; }
        }
        B.spine1.quaternion.copy(q0); update(); turnWorld(B.spine1, rotX(best));
        if (B.neck) turnWorld(B.neck, rotX(-best * 0.6));   // (the head up, looking ahead)
      }
      ik(B.rightarm, B.rightforearm, B.righthand, grips[1], new THREE.Vector3(-1, -0.8, -0.4));
      ik(B.leftarm, B.leftforearm, B.lefthand, grips[0], new THREE.Vector3(1, -0.8, -0.4));
      const crank = (-2 * Math.PI * f) / frames;
      for (const side of ["left", "right"]) {
        const up = B[`${side}upleg`], knee = B[`${side}leg`], foot = B[`${side}foot`];
        const ankle = fromBike(pedalAt(side, crank)).add(new THREE.Vector3(0, 0.085, -0.09));
        ik(up, knee, foot, ankle, new THREE.Vector3(side === "left" ? 0.15 : -0.15, 0.2, 1));
      }
    }
    // ---- the jobs: each clip's frames and how each is posed
    const idleD = src.Idle?.duration || 2, walkD = src.Walk?.duration || 1, runD = src.Run?.duration || 0.7;
    const n = (d) => Math.max(2, Math.round(d * BAKE_FPS));
    const jobs = [
      { name: "Idle", frames: n(idleD), duration: idleD, pose: (t) => poseIdle(t) },
      ...WALKS.map((w) => ({ name: w, frames: n(walkD), duration: walkD, pose: (t) => poseWalk(w, t) })),
      { name: "Run", frames: n(runD), duration: runD, pose: (t) => poseRun(t) },
      { name: "Cycle", frames: 24, duration: 1, fixed: true, pose: (t, f) => poseCycle(f, 24) },
    ];
    // ---- at work (a kitchen): the hands to a counter, carrying, chopping, stirring, pouring. The
    // targets are in metres in the model's frame (facing +z, the floor at 0); a counter's top is
    // COUNTER_TOP. The spine bends to reach; the hands' places are recorded for every frame below.
    if (work && B.leftarm && B.rightarm) {
      const W3 = (x, y, z) => new THREE.Vector3(x, y, z), hips0 = (() => { putStand(); return pos(B.hips).y; })();
      const arms = (Lt, Rt, bend = 0) => {
        const dy = pos(B.hips).y - hips0;
        if (bend && B.spine1) turnWorld(B.spine1, rotX(bend));
        ik(B.leftarm, B.leftforearm, B.lefthand, Lt.clone().add(W3(0, dy, 0)), W3(0.8, -1, -0.4));
        ik(B.rightarm, B.rightforearm, B.righthand, Rt.clone().add(W3(0, dy, 0)), W3(-0.8, -1, -0.4));
      };
      const T = COUNTER_TOP;
      const carryL = W3(0.13, T + 0.1, 0.3), carryR = W3(-0.13, T + 0.1, 0.3);
      const reachL = W3(0.12, T + 0.06, 0.47), reachR = W3(-0.12, T + 0.06, 0.47);
      jobs.push(
        { name: "Idle:carry", frames: n(idleD), duration: idleD, pose: (t) => { poseIdle(t); arms(carryL, carryR); } },
        { name: "Walk:carry", frames: n(walkD), duration: walkD, pose: (t) => { poseWalk("Walk", t); arms(carryL, carryR); } },
        // (Played once: down to the counter and back up, the bottom of it half-way.)
        { name: "Idle:reach", frames: n(0.8), duration: 0.8, pose: (t, f, N) => { poseIdle(0); const u = Math.sin((Math.PI * f) / (N - 1)); arms(carryL.clone().lerp(reachL, u), carryR.clone().lerp(reachR, u), 0.3 * u); } },
        { name: "Idle:chop", frames: n(0.5), duration: 0.5, pose: (t) => { poseIdle(0); const u = (1 - Math.cos((t / 0.5) * Math.PI * 2)) / 2; arms(W3(0.14, T + 0.05, 0.45), W3(-0.05, T + 0.05 + 0.1 * u, 0.44), 0.14); } },
        { name: "Idle:stir", frames: n(1.2), duration: 1.2, pose: (t) => { poseIdle(t); const a = (t / 1.2) * Math.PI * 2; arms(W3(0.21, T + 0.07, 0.36), W3(-0.03 + 0.05 * Math.cos(a), T + 0.12, 0.45 + 0.05 * Math.sin(a)), 0.1); } },
        { name: "Idle:pour", frames: n(1), duration: 1, pose: (t) => { poseIdle(t); const u = Math.sin((t / 1) * Math.PI * 2) * 0.015; arms(W3(0.09, T + 0.24 + u, 0.42), W3(-0.09, T + 0.26 + u, 0.4), 0.08); } },
      );
    }
    for (const kind of Object.keys(PH)) {
      jobs.push({ name: `Idle:${kind}`, frames: n(idleD), duration: idleD, pose: (t) => { poseIdle(t); phone(kind, 1); } });
      jobs.push({ name: `Walk:${kind}`, frames: n(walkD), duration: walkD, pose: (t) => { poseWalk("Walk", t); phone(kind, 1); } });
      jobs.push({ name: `Idle:pull-${kind}`, frames: n(1), duration: 1, pose: (t, f, N) => { poseIdle(t); phone(kind, f / (N - 1)); } });
      jobs.push({ name: `Walk:pull-${kind}`, frames: n(walkD), duration: walkD, pose: (t, f, N) => { poseWalk("Walk", t); phone(kind, f / (N - 1)); } });
    }
    const rows = jobs.reduce((a, j) => a + j.frames, 0);
    const data = new Float32Array(width * rows * 4);
    // (At work: each row's hands -- the left's and the right's grip, in the model's frame.)
    const hands = work ? new Float32Array(rows * 6) : null;
    const gripL = B.lefthandmiddle1 || B.lefthand, gripR = B.righthandmiddle1 || B.righthand, gp = V3();
    root.position.set(0, 0, 0); update();
    skeleton.pose(); update();
    const rest = pos(B.hips || skeleton.bones[0]), at = V3(), M = new THREE.Matrix4();
    const table = {};
    let row = 0;
    for (const job of jobs) {
      if ((job.name.startsWith("Idle") && !src.Idle) || (job.name.startsWith("Walk") && !src.Walk) || (job.name === "Run" && !src.Run)) continue;
      table[job.name] = { start: row, frames: job.frames, duration: job.duration };
      for (let f = 0; f < job.frames; f += 1, row += 1) {
        root.position.set(0, 0, 0); update();
        job.pose((f / job.frames) * job.duration, f, job.frames);
        if (!job.fixed) {
          // (In place: the hips' way over the ground taken off, so a walk is walked where they are.)
          pos(B.hips || skeleton.bones[0], at);
          root.position.set(rest.x - at.x, 0, rest.z - at.z);
        }
        update();
        if (hands && gripL && gripR) { pos(gripL, gp).toArray(hands, row * 6); pos(gripR, gp).toArray(hands, row * 6 + 3); }
        for (let b = 0; b < nb; b += 1) {
          M.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]);
          const e = M.elements, o = (row * width + b * 3) * 4;
          for (let r = 0; r < 3; r += 1) { data[o + r * 4] = e[r]; data[o + r * 4 + 1] = e[4 + r]; data[o + r * 4 + 2] = e[8 + r]; data[o + r * 4 + 3] = e[12 + r]; }
        }
      }
    }
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    root.position.set(0, 0, 0); skeleton.pose(); update();
    const texture = new THREE.DataTexture(data, width, Math.max(1, row), THREE.RGBAFormat, THREE.FloatType);
    texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
    S.bakeMs += performance.now() - t0;
    return { texture, table, hands };
  }
  //: The skeleton's bones by their Mixamo names, lower case, the rig's prefix off ("hips",
  //: "rightforearm", ...).
  function boneMap(skeleton) {
    const out = {};
    for (const b of skeleton.bones) { const k = b.name.toLowerCase().replace(/^mixamorig[:_]?/, ""); out[k] ||= b; }
    return out;
  }
  //: Where the right hand is as bound, and how a phone sits in it: along the fingers (L), out of
  //: the palm (N), its middle ``grip`` from the wrist.
  function handFrame(skeleton) {
    const B = boneMap(skeleton);
    skeleton.pose(); skeleton.bones[0].parent?.updateMatrixWorld(true);
    for (const b of skeleton.bones) b.updateMatrixWorld(true);
    const p = (b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
    const wrist = p(B.righthand), mid = B.righthandmiddle1 ? p(B.righthandmiddle1) : wrist.clone().add(new THREE.Vector3(0, -0.08, 0));
    const L = mid.clone().sub(wrist).normalize();
    const across = (B.righthandindex1 && B.righthandpinky1) ? p(B.righthandindex1).sub(p(B.righthandpinky1)) : new THREE.Vector3(0, 0, 1);
    const N = new THREE.Vector3().crossVectors(L, across).normalize();
    const grip = L.clone().multiplyScalar(0.075).add(N.clone().multiplyScalar(0.022));
    return { index: skeleton.bones.indexOf(B.righthand), wrist, L, N, grip, bindQ: B.righthand.getWorldQuaternion(new THREE.Quaternion()) };
  }

  //: The material for a part: its kind says how it is coloured -- ``skin`` (the photographed
  //: skin, young and old, toned to the person), ``cloth`` (the person's colour, its fabric's light
  //: and dark from _shade), ``tint`` (hair, brows, beards: a texture's coverage and grain in the
  //: person's colour), ``plain`` (the eyes, as they are), ``phone`` (the case in the person's
  //: colour, the screen and the glass as they are). ``extra`` defines: KB_BODY (the body: hidden
  //: under what is worn), KB_JAW (the head: its jaw opened as they talk).
  function material(kind, u, maps, extra = []) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: kind === "plain" ? 0.25 : kind === "phone" ? 0.35 : kind === "cloth" ? 0.88 : 0.68, metalness: 0,
      map: maps.map || null, side: kind === "tint" ? THREE.DoubleSide : THREE.FrontSide, alphaTest: kind === "tint" ? 0.42 : 0 });
    m.defines = { KB_CROWD: "", [`KB_${kind.toUpperCase()}`]: "" };
    for (const d of extra) m.defines[d] = "";
    const key = `kb-crowd-${kind}${extra.length ? "-" + extra.join("-") : ""}`;
    m.customProgramCacheKey = () => key;
    m.onBeforeCompile = (shader) => {
      globalThis.__kerbsideProxyLight?.patch?.(shader);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = VERTEX_HEAD + shader.vertexShader
        .replace("#include <beginnormal_vertex>", VERTEX_NORMAL)
        .replace("#include <begin_vertex>", VERTEX_POSITION);
      shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader.replace("#include <map_fragment>", FRAGMENT_MAP);
    };
    return m;
  }

  //: The room for ``capacity`` people's instance values on ``g``.
  function instanced(g, triangles) {
    const inst = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    const attrs = { pos: inst("kbPos", 4), anim: inst("kbAnim", 4), shape: inst("kbShape", 4), color: inst("kbColor", 4), mask: inst("kbMask", 2) };
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return { geometry: g, attrs, triangles };
  }
  //: A part's geometry for instancing: the file's points, normals and texture place, its bones (as
  //: the body's skeleton numbers them) and weights, its four morphs, its _cover or _shade (and the
  //: head's _jaw); and the room for ``capacity`` people's instance values.
  function partGeometry(mesh, boneIndex, morphNames) {
    const src = mesh.geometry, g = new THREE.InstancedBufferGeometry();
    g.setIndex(src.index ? new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1) : null);
    g.setAttribute("position", new THREE.BufferAttribute(floats(src.attributes.position, 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(floats(src.attributes.normal, 3), 3));
    if (src.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(floats(src.attributes.uv, 2), 2));
    const n = src.attributes.position.count;
    const joints = floats(src.attributes.skinIndex, 4), weights = floats(src.attributes.skinWeight, 4);
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) { joints[i * 4 + k] = boneIndex[joints[i * 4 + k]] ?? 0; sum += weights[i * 4 + k]; }
      if (sum > 0) for (let k = 0; k < 4; k += 1) weights[i * 4 + k] /= sum;
    }
    g.setAttribute("kbJoint", new THREE.BufferAttribute(joints, 4));
    g.setAttribute("kbWeight", new THREE.BufferAttribute(weights, 4));
    const dict = mesh.morphTargetDictionary || {}, targets = src.morphAttributes?.position || [];
    morphNames.forEach((name, k) => {
      const t = targets[dict[name]];
      let d = t ? floats(t, 3) : new Float32Array(n * 3);
      if (t && !src.morphTargetsRelative) { const p = g.attributes.position.array; d = d.map((v, i) => v - p[i]); }
      g.setAttribute(`kbM${k}`, new THREE.BufferAttribute(d, 3));
    });
    // _cover (the body: the bits of the parts over each point, in two halves of 12 bits, kept
    // exact in floats) or _shade (a garment's light and dark); else 1. The head's _jaw (how much of
    // the jaw each point is) in the second.
    const aux = new Float32Array(n * 2).fill(1);
    const cover = src.attributes._cover, shade = src.attributes._shade, jaw = src.attributes._jaw;
    for (let i = 0; i < n; i += 1) {
      if (cover) { const c = Math.round(cover.getX(i)); aux[i * 2] = c & 0xfff; aux[i * 2 + 1] = Math.floor(c / 4096); }
      else if (shade) aux[i * 2] = shade.getX(i);
      if (jaw) aux[i * 2 + 1] = jaw.getX(i);
    }
    g.setAttribute("kbAux", new THREE.BufferAttribute(aux, 2));
    return instanced(g, (src.index ? src.index.count : n) / 3);
  }

  //: The phone (the imported smartphone, every mesh of it in one): 15 cm long, in the right hand as
  //: the body was bound -- along the fingers, its back on the palm, the screen out -- and moved
  //: by the hand's bone alone. Its case takes the person's colour (kbAux.x the case's light and
  //: dark); the screen, the glass and the camera are as they are (kbAux.x below 0: the grey).
  function phoneGeometry(gltf, hand) {
    gltf.scene.updateMatrixWorld(true);
    const pieces = [];
    let biggest = null;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const c = m?.color ? m.color.clone() : new THREE.Color(0.5, 0.5, 0.5);
      if (m?.map?.image) { const mean = meanOf(m.map); c.r *= mean[0]; c.g *= mean[1]; c.b *= mean[2]; }
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      g.computeBoundingBox();
      const size = g.boundingBox.getSize(new THREE.Vector3());
      const area = size.x * size.y + size.y * size.z + size.x * size.z;
      const piece = { g, lum, area, name: `${o.name} ${m?.name || ""}`, metal: m?.metalness || 0 };
      pieces.push(piece);
      if (!/screen|display|glass|lens|camera/i.test(piece.name) && (!biggest || area > biggest.area)) biggest = piece;
    });
    if (!pieces.length) return null;
    // Its frame: the longest side along the fingers, the thinnest out of the palm (the screen's
    // side out), centred.
    const all = new THREE.Box3();
    for (const p of pieces) all.union(p.g.boundingBox);
    const size = all.getSize(new THREE.Vector3()), mid = all.getCenter(new THREE.Vector3());
    const axes = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
    const [longA, wideA, thinA] = axes;
    const screen = pieces.find((p) => /screen|display/i.test(p.name)) || pieces.reduce((a, b) => (a.lum < b.lum && a !== biggest ? a : b));
    const sc = screen.g.boundingBox.getCenter(new THREE.Vector3());
    const out = sc.getComponent(thinA) >= mid.getComponent(thinA) ? 1 : -1;
    const k = 0.15 / size.getComponent(longA);
    const pos = [], nor = [], aux = [], idx = [];
    const basis = new THREE.Matrix4().makeBasis(hand.L.clone().cross(hand.N), hand.L, hand.N);
    const at = hand.wrist.clone().add(hand.grip);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    const local = (src, dst, scale, centre) => {
      // (The file's axes to the phone's: across x, long y, out z.)
      const sx = (src.getComponent(wideA) - centre.getComponent(wideA)) * scale, sy = (src.getComponent(longA) - centre.getComponent(longA)) * scale, sz = (src.getComponent(thinA) - centre.getComponent(thinA)) * scale * out;
      return dst.set(sx, sy, sz);
    };
    const zero = new THREE.Vector3();
    // (Kept right-handed: two axes swapped or one flipped turns the faces inside out.)
    const flips = ([wideA, longA, thinA].join() === [0, 1, 2].join() || [wideA, longA, thinA].join() === "1,2,0" || [wideA, longA, thinA].join() === "2,0,1") ? 1 : -1;
    const inside = flips * out < 0;
    for (const p of pieces) {
      const g = p.g.index ? p.g.toNonIndexed() : p.g;
      g.computeVertexNormals();
      const P = g.attributes.position, Nn = g.attributes.normal, base = pos.length / 3;
      const shade = p === biggest || (p.lum > 0.02 && p.area > biggest.area * 0.5 && !/screen|display|glass|lens|camera/i.test(p.name)) ? 1 : -Math.max(0.015, Math.min(0.6, p.lum));
      for (let i = 0; i < P.count; i += 1) {
        local(v.fromBufferAttribute(P, i), v, k, mid).applyMatrix4(basis).add(at);
        local(nv.fromBufferAttribute(Nn, i), nv, 1, zero);
        if (inside) nv.negate();
        nv.transformDirection(basis);
        pos.push(v.x, v.y, v.z); nor.push(nv.x, nv.y, nv.z); aux.push(shade, 0);
      }
      for (let i = 0; i < P.count; i += 3) idx.push(base + i, base + (inside ? i + 2 : i + 1), base + (inside ? i + 1 : i + 2));
    }
    const n = pos.length / 3, g = new THREE.InstancedBufferGeometry();
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute("kbJoint", new THREE.BufferAttribute(new Float32Array(n * 4).fill(hand.index), 4));
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) w[i * 4] = 1;
    g.setAttribute("kbWeight", new THREE.BufferAttribute(w, 4));
    for (let m = 0; m < 4; m += 1) g.setAttribute(`kbM${m}`, new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("kbAux", new THREE.BufferAttribute(new Float32Array(aux), 2));
    return instanced(g, idx.length / 3);
  }

  async function loadBody(sex, spec, phoneFile) {
    const gltf = await loadModel(url(spec.file));
    gltf.scene.updateMatrixWorld(true);
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const kbOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.kb) { try { return typeof p.userData.kb === "string" ? JSON.parse(p.userData.kb) : p.userData.kb; } catch { return null; } } return null; };
    const nameOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.kb) return p.name; return o.name; };
    const bodyMesh = meshes.find((m) => kbOf(m)?.slot === "body") || meshes[0];
    const skeleton = bodyMesh.skeleton;
    const boneAt = new Map(skeleton.bones.map((b, i) => [b.name, i]));
    const hand = handFrame(skeleton);
    const { texture, table, hands } = bake(gltf, skeleton, hand);
    const [young, old] = await Promise.all(spec.skins.map((f) => tex(f)));
    const skinMean = meanOf(young);
    const parts = [];
    const byId = new Map(meshes.map((m) => [nameOf(m).replace(/\./g, ""), m]));
    const list = [{ id: "body", slot: "body", mesh: bodyMesh }, ...spec.parts.map((p) => ({ ...p, mesh: byId.get(p.id.replace(/\./g, "")) || meshes.find((m) => nameOf(m).includes(p.id)) }))];
    const bodyPost = new THREE.Matrix4().multiplyMatrices(bodyMesh.matrixWorld, bodyMesh.bindMatrixInverse);
    // (The jaw's hinge, in the head's own space: the manifest's is the file's.)
    const jaw = new THREE.Vector3().fromArray(spec.jaw_pivot || [0, 0, 0]);
    await Promise.all(list.map(async (p) => {
      if (!p.mesh) { console.warn("kerbside: crowd part not in the file", sex, p.id); return; }
      const m = p.mesh;
      const boneIndex = m.skeleton.bones.map((b) => boneAt.get(b.name) ?? 0);
      const post = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, m.bindMatrixInverse);
      const u = { kbBones: { value: texture }, kbBind: { value: m.bindMatrix.clone() }, kbPost: { value: post }, kbOldMap: { value: old }, kbMean: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        kbJawPivot: { value: jaw.clone().applyMatrix4(m.matrixWorld.clone().invert()) } };
      let kind = "cloth", maps = {};
      const extra = [];
      if (p.slot === "body") { kind = "skin"; maps = { map: young }; u.kbMean.value.fromArray(skinMean); extra.push("KB_BODY"); }
      else if (p.slot === "head") { kind = "skin"; maps = { map: young }; u.kbMean.value.fromArray(skinMean); extra.push("KB_JAW"); }
      else if (p.texture) {
        const t = await tex(`${sex}/${p.texture}`).catch(() => null);
        if (t) { kind = p.slot === "eyes" ? "plain" : "tint"; maps = { map: t }; u.kbMean.value.fromArray(meanOf(t)); }
      }
      const { geometry, attrs, triangles } = partGeometry(m, boneIndex, S.manifest.morphs);
      const mesh = new THREE.Mesh(geometry, material(kind, u, maps, extra));
      mesh.name = `city-crowd-${sex}-${p.id}`;
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
      mesh.matrixAutoUpdate = false; mesh.raycast = () => {};
      // (Drawn after the ground and the jointed figures: the hair's cut-outs last of the people.)
      mesh.renderOrder = kind === "tint" ? 2 : 1;
      parent.add(mesh);
      // (A hat's lowest edge, as bound: the hair is not drawn above it, so none shows through.)
      let hatLine = 0;
      if (p.slot === "hat") hatLine = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).applyMatrix4(m.bindMatrix).min.y + 0.012;
      parts[p.slot === "body" ? 0 : spec.parts.indexOf(spec.parts.find((q) => q.id === p.id)) + 1] = { id: p.id, slot: p.slot, kind, mesh, attrs, triangles, n: 0, hatLine };
    }));
    // The phone, in this body's right hand.
    let phone = null;
    if (phoneFile) {
      const g = phoneGeometry(phoneFile, hand);
      if (g) {
        const u = { kbBones: { value: texture }, kbBind: { value: new THREE.Matrix4() }, kbPost: { value: bodyPost }, kbOldMap: { value: old }, kbMean: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, kbJawPivot: { value: new THREE.Vector3() } };
        const mesh = new THREE.Mesh(g.geometry, material("phone", u, {}));
        mesh.name = `city-crowd-${sex}-phone`;
        mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
        mesh.matrixAutoUpdate = false; mesh.raycast = () => {}; mesh.renderOrder = 1;
        parent.add(mesh);
        phone = { id: "phone", slot: "phone", kind: "phone", mesh, attrs: g.attrs, triangles: g.triangles, n: 0 };
      }
    }
    // The model's own height, from its body as it was bound (feet to the crown): the manifest's
    // is measured in Blender before the export's own scale, and is not the file's.
    const box = new THREE.Box3().setFromBufferAttribute(bodyMesh.geometry.attributes.position).applyMatrix4(bodyMesh.matrixWorld);
    const height = box.max.y - box.min.y > 0.5 ? box.max.y - box.min.y : spec.height_m || 1.75;
    return { sex, parts, phone, table, hands, height, slots: slotsOf(spec.parts), skinMean };
  }

  async function load() {
    from = await storeBuild();
    const r = await fetch(url("crowd.json"), { cache: "no-cache" });
    if (!r.ok) throw new Error(`crowd.json ${r.status}`);
    S.manifest = await r.json();
    // (The phone from beside the page, not the store: it is one of the page's own models.)
    const phoneFile = await loadModel(asset(PHONE_FILE)).catch((e) => { console.warn("kerbside: the crowd's phone did not load", e?.message || e); return null; });
    for (const [sex, spec] of Object.entries(S.manifest.bodies)) if (!only || sex === only) S.bodies[sex] = await loadBody(sex, spec, phoneFile);
    S.ready = true;
  }
  const start = () => {
    if (S.loading || (S.failed && performance.now() < S.retryAt)) return;
    S.failed = false;
    S.loading = load().catch((e) => {
      S.failed = true; S.loading = null; S.retryAt = performance.now() + 60_000;
      console.warn("kerbside: the near-ring people did not load; the jointed figures stand in", e?.message || e);
    });
  };

  // ---- each frame -----------------------------------------------------------------------------
  const tone = new THREE.Color();
  //: A person's look, chosen once (and again only if who they are changes: a new look object).
  function lookFor(q) {
    let L = S.looks.get(q.id);
    if (L && L.src === q.look && L.h === q.height) return L;
    const sex = q.female === true ? "female" : q.female === false ? "male" : null;
    const body = S.bodies[sex || (stream(String(q.id))() < 0.5 ? "female" : "male")] || Object.values(S.bodies)[0];
    const pick = crowdLook(q.id, q.look, { [body.sex]: body.slots }, { height: q.height, build: q.build ?? 1, female: body.sex === "female", modelHeight: body.height });
    // The colours, linear, as each part takes them: the skin over the skin photograph's average
    // (kept within bounds: never so far over it that a face is drawn white).
    const colours = pick.parts.map((p) => {
      tone.set(p.colour);
      if (p.slot === "body" || p.slot === "head") return [tone.r / body.skinMean[0], tone.g / body.skinMean[1], tone.b / body.skinMean[2]].map((v) => Math.max(0.25, Math.min(3.5, v)));
      return [tone.r, tone.g, tone.b];
    });
    const phone = pick.phone ? tone.set(pick.phone).toArray() : null;
    let mask = 0;
    const bits = S.manifest.bodies[body.sex].parts;
    for (const p of pick.parts) if (p.index >= 0 && bits[p.index]?.bit != null) mask += 2 ** bits[p.index].bit;
    const hat = pick.parts.find((p) => p.slot === "hat");
    const hatLine = hat ? body.parts[hat.index + 1]?.hatLine || 0 : 0;
    L = { src: q.look, h: q.height, body, pick, colours, phone, hatLine, maskLo: mask % 4096, maskHi: Math.floor(mask / 4096) };
    if (S.looks.size > 4000) S.looks.clear();
    S.looks.set(q.id, L);
    return L;
  }
  //: What a person's ``clip`` (the city's, clips.mjs) asks of the phone: at the ear, up to film,
  //: read; or nothing.
  const phoneOf = (clip) => (clip === "phone" || clip === "walk_phone" || clip === "sit_phone" || clip === "call" ? "call" : clip === "film" || clip === "record" ? "record" : clip === "walk_text" || clip === "text" ? "text" : null);
  //: Where a person is in their clips: the clip they are in, how far through it, and the one they
  //: are leaving as it fades; the phone out (``phone``, and ``pull``: 0 to 1 as it is brought out of
  //: the pocket); the mouth.
  function animate(q, L, dt, now) {
    const body = L.body, table = body.table;
    let a = S.anim.get(q.id);
    if (!a) { const r = stream(String(q.id) + "|phase"); a = { clip: "Idle", t: r() * 3, prev: null, pt: 0, fade: 1, seen: now, phone: null, pull: 1, mouth: 0, talk: r() * 10 }; S.anim.set(q.id, a); }
    a.seen = now;
    const v = q.moving ? q.speed || 0 : 0;
    const pick = L.pick, style = table[pick.walk] ? pick.walk : "Walk";
    // The phone wanted -- only by someone with a pocket to carry it (it is at home otherwise), and
    // not on a bicycle or at a run.
    const running = v >= 2.3;
    const wantPhone = !q.ride && !running && L.phone ? phoneOf(q.clip) : null;
    if (wantPhone !== a.phone) { a.phone = wantPhone; a.pull = wantPhone ? 0 : 1; }
    let want;
    const gait = v < 0.2 ? "Idle" : "Walk";
    // At work: the clip asked for (carrying walks as it carries), started again for each new ask.
    if (q.work) {
      want = q.work === "carry" ? `${gait}:carry` : `Idle:${q.work}`;
      if (table[want]) {
        if (want === a.clip && q.workKey !== a.workKey && ONCE.test(want)) { a.prev = a.clip; a.pt = a.t; a.t = 0; a.fade = 0; }
        a.workKey = q.workKey;
      } else want = null;
    }
    if (want) { /* at work */ }
    else if (q.ride) want = "Cycle";
    else if (running) want = "Run";
    else if (a.phone && a.pull < 1) want = `${gait}:pull-${a.phone}`;
    else if (a.phone) want = `${gait}:${a.phone}`;
    else want = gait === "Walk" ? style : "Idle";
    if (!table[want]) want = gait === "Walk" ? (table[style] ? style : "Walk") : "Idle";
    if (want !== a.clip) {
      const walking = (c) => c.startsWith("Walk") || c === "Run";
      // (A walk from a walk keeps its step: the same place in the stride.)
      const keep = walking(want) && walking(a.clip) && want !== "Run" && a.clip !== "Run";
      a.prev = a.clip; a.pt = a.t; a.clip = want; a.fade = 0;
      a.t = want.includes(":pull-") || ONCE.test(want) ? 0 : keep ? (a.t / (table[a.prev]?.duration || 1)) * table[want].duration : a.t;
    }
    const stride = WALK_MS * (pick.height || 1) * (pick.pace || 1);
    const rate = (c) => (c.startsWith("Walk") ? Math.max(0.45, v / stride) : c === "Run" ? Math.max(0.6, v / (RUN_MS * (pick.height || 1))) : 1);
    a.t += dt * rate(a.clip);
    if (a.clip.includes(":pull-")) a.pull = Math.min(1, a.t / table[a.clip].duration);
    if (a.prev) { a.pt += dt * rate(a.prev); a.fade += dt / FADE_S; if (a.fade >= 1) { a.prev = null; a.fade = 1; } }
    // The mouth: open and shut a syllable at a time while they talk, shut otherwise.
    let mouth = 0;
    if (q.talking) {
      a.talk += dt;
      const s = a.talk * 6.2;
      const syl = Math.abs(Math.sin(s)) ** 0.8 * (0.55 + 0.45 * Math.sin(s * 0.37 + 1.3)) * (Math.sin(a.talk * 0.9) > -0.75 ? 1 : 0.15);
      mouth = 0.15 + 0.85 * syl;
    }
    a.mouth += (mouth - a.mouth) * Math.min(1, dt * 18);
    return a;
  }
  const FA = { a: 0, b: 0, w: 0 }, FB = { a: 0, b: 0, w: 0 };
  const frameOf = (table, clip, t, out, once = false) => {
    const c = table[clip] || table.Idle;
    const x = once ? Math.min(c.frames - 1.001, Math.max(0, (t / c.duration) * c.frames)) : ((t / c.duration) % 1 + 1) % 1 * c.frames, f = Math.floor(x);
    out.a = c.start + f; out.b = c.start + (once ? Math.min(c.frames - 1, f + 1) : (f + 1) % c.frames); out.w = x - f;
    return out;
  };
  //: The cyclist's frame for the crank at ``crank`` (radians, vehicles.mjs crankTurn).
  const cycleFrame = (table, crank, out) => {
    const c = table.Cycle;
    const x = (((crank / (-2 * Math.PI)) % 1) + 1) % 1 * c.frames, f = Math.floor(x);
    out.a = c.start + f; out.b = c.start + ((f + 1) % c.frames); out.w = x - f;
    return out;
  };

  //: Each frame: ``list`` is [{id, x, y, z, yaw, height, build, speed, moving, female, look, clip,
  //: talking, ride, crank}], nearest first (``clip``: the city's, clips.mjs -- "phone", "film",
  //: "walk_text", ... -- for the phone; ``ride``: on a bicycle, ``crank`` its crank's turn; ``y``
  //: then the ground under it). Returns how many were drawn (the first so many of ``list``).
  function draw(list, now, dt) {
    if (!S.ready) { start(); return 0; }
    const bodies = S.bodyList ||= Object.values(S.bodies);
    for (const b of bodies) { for (const p of b.parts) if (p) p.n = 0; if (b.phone) b.phone.n = 0; }
    const was = S.drawnPrev; S.drawnPrev = S.drawn; S.drawn = was;
    S.drawn.clear();
    let n = 0, triangles = 0;
    // The first frame ready: one of everything drawn below the ground, so every part's shader is
    // compiled at once, before anyone needs it.
    if (!S.warm) {
      S.warm = 1;
      for (const b of bodies) { for (const p of b.parts) if (p) put(p, 0, -500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1); if (b.phone) put(b.phone, 0, -500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1); }
    }
    for (const q of list) {
      if (n >= capacity) break;
      const L = lookFor(q), body = L.body, pick = L.pick;
      const a = animate(q, L, dt, now);
      const once = a.clip.includes(":pull-") || ONCE.test(a.clip);
      const f = a.clip === "Cycle" && body.table.Cycle ? cycleFrame(body.table, q.crank || 0, FA) : frameOf(body.table, a.clip, a.t, FA, once);
      // (Fading from the last clip: this clip's frame, and the last's in the fade's share.)
      let fb = f.b, fw = f.w;
      if (a.prev) { const g = a.prev === "Cycle" ? cycleFrame(body.table, q.crank || 0, FB) : frameOf(body.table, a.prev, a.pt, FB, a.prev.includes(":pull-") || ONCE.test(a.prev)); fb = g.a; fw = 1 - a.fade; }
      a.fa = f.a; a.fb = fb; a.fw = fw; a.scale = q.ride ? 1 : pick.height; a.body = body;
      const yaw = (q.yaw || 0) + FACING_OFFSET;
      // (On a bicycle, as tall as the model: the saddle, bars and pedals are where the bake put them.)
      const height = q.ride ? 1 : pick.height;
      for (let k = 0; k < pick.parts.length; k += 1) {
        const part = body.parts[pick.parts[k].index + 1];
        if (!part || part.n >= capacity) continue;
        const c = L.colours[k];
        // (The fourth of the clip's values: the mouth for the head, the hat's edge for the hair.)
        const w = part.slot === "head" ? a.mouth : part.slot === "hair" ? L.hatLine : 0;
        put(part, q.x, q.y, q.z, yaw, f.a, fb, fw, w, pick.weight, pick.muscle, pick.old, height, c[0], c[1], c[2], pick.width, L.maskLo, L.maskHi);
        triangles += part.triangles;
      }
      // The phone, once it is out of the pocket (and gone at once as it is put away).
      if (body.phone && a.phone && a.pull >= 0.45 && body.phone.n < capacity) {
        const c = L.phone;
        put(body.phone, q.x, q.y, q.z, yaw, f.a, fb, fw, 0, 0, 0, 0, height, c[0], c[1], c[2], pick.width, 0, 0);
        triangles += body.phone.triangles;
      }
      S.drawn.add(q.id);
      n += 1;
    }
    let draws = 0;
    for (const b of bodies) for (const p of b.phone ? [...b.parts, b.phone] : b.parts) {
      if (!p) continue;
      p.mesh.visible = p.n > 0;
      p.mesh.geometry.instanceCount = p.n;
      if (p.n) { draws += 1; for (const at of p.attrList ||= Object.values(p.attrs)) { at.clearUpdateRanges?.(); at.addUpdateRange?.(0, p.n * at.itemSize); at.needsUpdate = true; } }
    }
    // Clip places let go a few seconds after someone was last drawn.
    if ((S.frames += 1) % 120 === 0) for (const [id, a] of S.anim) if (now - a.seen > 5000) S.anim.delete(id);
    S.last.people = n; S.last.draws = draws; S.last.triangles = triangles;
    return n;
  }
  function put(p, x, y, z, yaw, fa, fb, fw, mouth, weight, muscle, old, height, r, g, b, width, maskLo = 0, maskHi = 0) {
    // (Written in place: nothing made a person a frame.)
    const o = p.n * 4, A = p.attrs, P = A.pos.array, N = A.anim.array, H = A.shape.array, C = A.color.array, K = A.mask.array;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = yaw;
    N[o] = fa; N[o + 1] = fb; N[o + 2] = fw; N[o + 3] = mouth;
    H[o] = weight; H[o + 1] = muscle; H[o + 2] = old; H[o + 3] = height;
    C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = width;
    K[p.n * 2] = maskLo; K[p.n * 2 + 1] = maskHi;
    p.n += 1;
  }
  return {
    draw, start,
    has: (id) => S.drawn.has(id) || S.drawnPrev.has(id),
    get ready() { return S.ready; }, get failed() { return S.failed; },
    //: Where someone is in their clips (for checks: the clip, the phone and how far out).
    //: Where ``id``'s hands are as last drawn, in their own frame (metres, facing +z, the floor at
    //: 0): {left, right, mid} (only with ``work``).
    handsOf(id) {
      const a = S.anim.get(id), H = a?.body?.hands;
      if (!H || a.fa == null) return null;
      const k = a.fw, s = a.scale || 1, at = (i) => (H[a.fa * 6 + i] * (1 - k) + H[a.fb * 6 + i] * k) * s;
      const left = [at(0), at(1), at(2)], right = [at(3), at(4), at(5)];
      return { left, right, mid: [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2] };
    },
    //: The clip ``id`` is in, and how far through (0 to 1).
    clipOf(id) { const a = S.anim.get(id); const c = a && a.body?.table[a.clip]; return a ? { clip: a.clip, u: c ? Math.min(1, a.t / c.duration) : 0 } : null; },
    stateOf: (id) => { const a = S.anim.get(id); return a ? { clip: a.clip, phone: a.phone, pull: +a.pull.toFixed(2), mouth: +a.mouth.toFixed(2) } : null; },
    stats: () => ({ ready: S.ready, heights: Object.fromEntries(Object.entries(S.bodies).map(([k, b]) => [k, +b.height.toFixed(3)])), failed: S.failed, capacity, live: S.last.people, draws: S.last.draws, triangles: S.last.triangles, bakeMs: Math.round(S.bakeMs), looks: S.looks.size,
      clips: Object.keys(Object.values(S.bodies)[0]?.table || {}), phone: Object.values(S.bodies).map((b) => b.phone?.triangles || 0),
      parts: Object.fromEntries(Object.entries(S.bodies).map(([k, b]) => [k, b.parts.filter(Boolean).length])) }),
  };
}

// ---- the shaders (three's MeshStandardMaterial, its position and normal made here) -------------

const VERTEX_HEAD = /* glsl */ `
attribute vec4 kbJoint; attribute vec4 kbWeight; attribute vec2 kbAux;
attribute vec3 kbM0; attribute vec3 kbM1; attribute vec3 kbM2; attribute vec3 kbM3;
attribute vec4 kbPos; attribute vec4 kbAnim; attribute vec4 kbShape; attribute vec4 kbColor; attribute vec2 kbMask;
uniform highp sampler2D kbBones; uniform mat4 kbBind; uniform mat4 kbPost; uniform vec3 kbJawPivot;
varying vec3 vKbColor; varying float vKbAux; varying float vKbOld; varying float vKbHide; varying float vKbCut;
mat4 kbBone(float j, float frame) {
  int x = int(j + 0.5) * 3, y = int(frame + 0.5);
  vec4 a = texelFetch(kbBones, ivec2(x, y), 0), b = texelFetch(kbBones, ivec2(x + 1, y), 0), c = texelFetch(kbBones, ivec2(x + 2, y), 0);
  return transpose(mat4(a, b, c, vec4(0.0, 0.0, 0.0, 1.0)));
}
mat4 kbSkin(float frame) {
  return kbWeight.x * kbBone(kbJoint.x, frame) + kbWeight.y * kbBone(kbJoint.y, frame) + kbWeight.z * kbBone(kbJoint.z, frame) + kbWeight.w * kbBone(kbJoint.w, frame);
}
vec3 kbYaw(vec3 v) { float c = cos(kbPos.w), s = sin(kbPos.w); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
// The jaw: turned down about its hinge (the x axis through it) by angle a.
vec3 kbJawTurn(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
#ifdef KB_JAW
  varying float vKbInner;
#endif
`;
const VERTEX_NORMAL = /* glsl */ `
  mat4 kbM = kbPost * ((1.0 - kbAnim.z) * kbSkin(kbAnim.x) + kbAnim.z * kbSkin(kbAnim.y)) * kbBind;
  float kbJawA = 0.0;
  #ifdef KB_JAW
    kbJawA = kbAnim.w * 0.15 * kbAux.y;
    // The inside of the lips (the lower's top, turned up; the upper's underside, turned down): in
    // the mouth's shadow, seen as the jaw opens.
    float kbLip = step(kbJawPivot.y - 0.058, position.y) * step(position.y, kbJawPivot.y - 0.03) * step(kbJawPivot.z + 0.06, position.z);
    vKbInner = kbLip * max(kbAux.y * step(normal.z, 0.4), (1.0 - kbAux.y) * step(normal.y, -0.3));
  #endif
  vec3 objectNormal = normalize(kbYaw(mat3(kbM) * kbJawTurn(normal, kbJawA)));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
  vKbColor = kbColor.rgb; vKbOld = kbShape.z; vKbAux = kbAux.x; vKbHide = 0.0; vKbCut = -1.0;
  #ifdef KB_TINT
    // Hair under a hat: none of it above the hat's edge.
    if (kbAnim.w > 0.0) vKbCut = (kbBind * vec4(position, 1.0)).y - kbAnim.w;
  #endif
  #ifdef KB_BODY
    // Skin under what they wear: drawn just inside it, and cut away (a fragment's worth) below.
    int kbLo = int(kbAux.x + 0.5) & int(kbMask.x + 0.5), kbHi = int(kbAux.y + 0.5) & int(kbMask.y + 0.5);
    vKbHide = (kbLo != 0 || kbHi != 0) ? 1.0 : 0.0;
  #endif
`;
const VERTEX_POSITION = /* glsl */ `
  float kbW = kbShape.x;
  vec3 kbP = position + kbM0 * max(-kbW, 0.0) + kbM1 * max(kbW, 0.0) + kbM2 * kbShape.y + kbM3 * kbShape.z;
  kbP -= normal * 0.012 * vKbHide;
  #ifdef KB_JAW
    kbP = kbJawPivot + kbJawTurn(kbP - kbJawPivot, kbJawA);
  #endif
  vec3 transformed = (kbM * vec4(kbP, 1.0)).xyz;
  transformed *= vec3(kbShape.w * kbColor.w, kbShape.w, kbShape.w * (0.92 + kbColor.w * 0.08));
  transformed = kbYaw(transformed) + kbPos.xyz;
  #ifdef USE_ALPHAHASH
    vPosition = transformed;
  #endif
`;
const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vKbColor; varying float vKbAux; varying float vKbOld; varying float vKbHide; varying float vKbCut;
uniform sampler2D kbOldMap; uniform vec3 kbMean;
#ifdef KB_JAW
  varying float vKbInner;
#endif
`;
const FRAGMENT_MAP = /* glsl */ `
  #if defined(KB_SKIN)
    if (vKbHide > 0.5) discard;
    vec4 kbYoung = texture2D(map, vMapUv), kbOlder = texture2D(kbOldMap, vMapUv);
    diffuseColor.rgb *= mix(kbYoung.rgb, kbOlder.rgb, vKbOld) * vKbColor;
    // (Skin is never brighter than the palest skin is: no face is drawn chalk-white, whatever the
    // tone and the photograph make of it.)
    float kbLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb *= min(1.0, 0.62 / max(kbLum, 1e-3));
    diffuseColor.rgb = min(diffuseColor.rgb, vec3(0.92));
    #ifdef KB_JAW
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.03, 0.035), vKbInner * 0.85);
    #endif
  #elif defined(KB_CLOTH)
    diffuseColor.rgb *= vKbColor * vKbAux;
  #elif defined(KB_PHONE)
    diffuseColor.rgb *= vKbAux < 0.0 ? vec3(-vKbAux) : vKbColor * vKbAux;
  #elif defined(KB_TINT)
    if (vKbCut > 0.0) discard;
    vec4 kbT = texture2D(map, vMapUv);
    float kbL = dot(kbT.rgb, vec3(0.2126, 0.7152, 0.0722)) / max(0.02, dot(kbMean, vec3(0.2126, 0.7152, 0.0722)));
    diffuseColor.rgb *= vKbColor * clamp(kbL, 0.4, 1.7);
    diffuseColor.a *= kbT.a;
  #else
    #ifdef USE_MAP
      diffuseColor *= texture2D(map, vMapUv);
    #endif
  #endif
`;
