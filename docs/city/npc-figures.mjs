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
//: The slots a person is dressed in, in the order they are drawn.
export const SLOTS = ["body", "top", "bottom", "shoes", "hair", "facial_hair", "hat", "eyebrows", "eyes"];

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
const HAT_SHARE = 0.06, BEARD_SHARE = 0.12, MOUSTACHE_SHARE = 0.09;
const HAT_COLOURS = ["#2b2b2e", "#4a3b2c", "#6b5a45", "#1f2a36", "#8a7d6b"];

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
  // A top and a bottom from any of the suits (a casual top over another suit's trousers): the
  // garment and the legs say which kinds.
  add("top", choose("top", TOP_PREFER[look?.garment] || null), look?.top || "#56606b");
  add("bottom", choose("bottom", LEGS_PREFER[look?.legs] || null), look?.bottom || "#2f3640");
  add("shoes", choose("shoes"), look?.shoes || "#2a2a2a");
  const age = look?.age ?? 35;
  const hat = r() < HAT_SHARE * (age > 45 ? 1.6 : 1);
  const cut = look?.cut || (look?.bald ? "none" : "short");
  if (cut !== "none") {
    const names = hat ? ["short04", "short03"] : (CUTS[sex][cut] || CUTS[sex].short);
    // (Curls more for those whose heritage has them; otherwise the cut's list as it is.)
    const afro = look?.heritage === "black" && !hat && r() < 0.45;
    const name = afro ? "afro01" : pickOf(r, names);
    add("hair", (s.hair || []).find((p) => p.asset === name) || choose("hair"), look?.hair || "#2b1d14");
  }
  if (sex === "male" && age >= 18) {
    const b = r();
    if (b < BEARD_SHARE) add("facial_hair", (s.facial_hair || []).find((p) => /beard/.test(p.asset)), look?.hair || "#2b1d14");
    else if (b < BEARD_SHARE + MOUSTACHE_SHARE) add("facial_hair", (s.facial_hair || []).find((p) => /moustache/.test(p.asset)), look?.hair || "#2b1d14");
  }
  if (hat) add("hat", choose("hat"), pickOf(r, HAT_COLOURS));
  add("eyebrows", choose("eyebrows"), look?.hair || "#2b1d14");
  add("eyes", choose("eyes"), "#ffffff");
  // The build: the wardrobe's (wider or narrower about each sex's own) to the weight morph; some
  // muscle; age to the older body and skin.
  const mean = sex === "female" ? 0.9 : 1;
  const weight = Math.max(-1, Math.min(1, ((build - mean) / 0.14) * 0.85 + (r() - 0.5) * 0.3));
  const muscle = Math.max(0, Math.min(1, r() * (sex === "male" ? 0.7 : 0.35)));
  const old = Math.max(0, Math.min(1, (age - 38) / 42));
  return { sex, parts, weight, muscle, old, height: height / modelHeight, width: 1 + (build - mean) * 0.25 };
}

// ---- the renderer -----------------------------------------------------------------------------

//: ``store`` is the public store's npc/ folder (as the page names it): the crowd is beside it in
//: crowd/, whose current.json names the build. Without one, the files come from ``base`` beside
//: the page (a local build; the folder is not in the public repo).
export function npcFigures(THREE, { loadModel, asset, parent, base = "city/models/crowd/", store = null, capacity = NEAR_FIGURES_MAX }) {
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

  //: Each clip's bones baked into one texture: a row a frame, three texels a bone (the rows of
  //: its matrix, from rest to posed, in the file's own space), and the clip's first row and length.
  function bake(gltf, skeleton) {
    const t0 = performance.now();
    const root = gltf.scene, mixer = new THREE.AnimationMixer(root);
    const names = S.manifest.clips;
    const clips = names.map((n) => gltf.animations.find((a) => a.name === n) || gltf.animations.find((a) => a.name.toLowerCase().includes(n.toLowerCase()))).filter(Boolean);
    const lengths = clips.map((c) => Math.max(2, Math.round(c.duration * BAKE_FPS)));
    const rows = lengths.reduce((a, b) => a + b, 0), nb = skeleton.bones.length, width = nb * 3;
    const data = new Float32Array(width * rows * 4);
    const hips = skeleton.bones.find((b) => /hips/i.test(b.name)) || skeleton.bones[0];
    root.position.set(0, 0, 0); root.updateMatrixWorld(true);
    const rest = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld), at = new THREE.Vector3(), M = new THREE.Matrix4();
    const table = {};
    // The idle a pedestrian stands in: the Soldier's own is a soldier's -- feet apart, one ahead,
    // the hips dropped, leant in -- so the whole body stands as at the walk's passing step (feet
    // together, arms down), and moves from it only as the idle moves from its own first frame
    // (breathing, a shift of the weight).
    const legs = skeleton.bones;
    const stand = new Map(), idle0 = new Map(), dq = new THREE.Quaternion();
    const walk = clips[names.indexOf("Walk")];
    if (walk) {
      const lf = skeleton.bones.find((b) => /left_?foot$/i.test(b.name)), rf = skeleton.bones.find((b) => /right_?foot$/i.test(b.name));
      const pa = new THREE.Vector3(), pb = new THREE.Vector3();
      let best = Infinity;
      mixer.stopAllAction(); mixer.clipAction(walk).reset().play();
      for (let f = 0; f < 60 && lf && rf; f += 1) {
        mixer.setTime((f / 60) * walk.duration); root.updateMatrixWorld(true);
        pa.setFromMatrixPosition(lf.matrixWorld); pb.setFromMatrixPosition(rf.matrixWorld);
        const d = Math.hypot(pa.x - pb.x, pa.z - pb.z) + Math.abs(pa.y - pb.y) * 2;
        if (d < best) { best = d; for (const b of legs) stand.set(b, [b.quaternion.clone(), b.position.clone()]); }
      }
    }
    // (Upright: the walk leans into its step; standing, the spine is turned to put the head over
    // the hips.)
    const spine = skeleton.bones.find((b) => /spine$/i.test(b.name)), head = skeleton.bones.find((b) => /head$/i.test(b.name));
    if (stand.size && spine && head && spine.parent) {
      for (const [b, [qt, at0]] of stand) { b.quaternion.copy(qt); if (/hips/i.test(b.name)) b.position.copy(at0); }
      root.updateMatrixWorld(true);
      const lean = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(spine.matrixWorld)).normalize();
      const C = new THREE.Quaternion().setFromUnitVectors(lean, new THREE.Vector3(0, 1, 0));
      const pW = spine.parent.getWorldQuaternion(new THREE.Quaternion());
      const q = pW.clone().invert().multiply(C).multiply(pW).multiply(stand.get(spine)[0]);
      stand.get(spine)[0].copy(q);
    }
    const idleClip = clips[names.indexOf("Idle")];
    if (idleClip && stand.size) {
      mixer.stopAllAction(); mixer.clipAction(idleClip).reset().play(); mixer.setTime(0);
      for (const b of legs) idle0.set(b, b.quaternion.clone().invert());
    }
    let row = 0;
    clips.forEach((clip, ci) => {
      mixer.stopAllAction();
      const a = mixer.clipAction(clip); a.reset().play();
      table[names[ci]] = { start: row, frames: lengths[ci], duration: clip.duration };
      for (let f = 0; f < lengths[ci]; f += 1, row += 1) {
        root.position.set(0, 0, 0);
        mixer.setTime((f / lengths[ci]) * clip.duration);
        if (names[ci] === "Idle" && idle0.size) for (const [b, [qt, at0]] of stand) {
          dq.multiplyQuaternions(idle0.get(b), b.quaternion);
          b.quaternion.multiplyQuaternions(qt, dq);
          if (/hips/i.test(b.name)) b.position.copy(at0);
        }
        root.updateMatrixWorld(true);
        // (In place: the hips' way over the ground taken off, so a walk is walked where they are.)
        at.setFromMatrixPosition(hips.matrixWorld);
        root.position.set(rest.x - at.x, 0, rest.z - at.z);
        root.updateMatrixWorld(true);
        for (let b = 0; b < nb; b += 1) {
          M.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]);
          const e = M.elements, o = (row * width + b * 3) * 4;
          for (let r = 0; r < 3; r += 1) { data[o + r * 4] = e[r]; data[o + r * 4 + 1] = e[4 + r]; data[o + r * 4 + 2] = e[8 + r]; data[o + r * 4 + 3] = e[12 + r]; }
        }
      }
    });
    mixer.stopAllAction(); mixer.uncacheRoot(root);
    root.position.set(0, 0, 0); root.updateMatrixWorld(true);
    const texture = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.FloatType);
    texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
    S.bakeMs += performance.now() - t0;
    return { texture, table };
  }

  //: The material for a part: its kind says how it is coloured -- ``skin`` (the photographed
  //: skin, young and old, toned to the person), ``cloth`` (the person's colour, its fabric's light
  //: and dark from _shade), ``tint`` (hair, brows, beards: a texture's coverage and grain in the
  //: person's colour), ``plain`` (the eyes, as they are).
  function material(kind, u, maps) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: kind === "plain" ? 0.25 : kind === "cloth" ? 0.88 : 0.68, metalness: 0,
      map: maps.map || null, side: kind === "tint" ? THREE.DoubleSide : THREE.FrontSide, alphaTest: kind === "tint" ? 0.42 : 0 });
    m.defines = { KB_CROWD: "", [`KB_${kind.toUpperCase()}`]: "" };
    m.customProgramCacheKey = () => `kb-crowd-${kind}`;
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

  //: A part's geometry for instancing: the file's points, normals and texture place, its bones (as
  //: the body's skeleton numbers them) and weights, its four morphs, its _cover or _shade; and the
  //: room for ``capacity`` people's instance values.
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
    // exact in floats) or _shade (a garment's light and dark); else 1.
    const aux = new Float32Array(n * 2).fill(1);
    const cover = src.attributes._cover, shade = src.attributes._shade;
    for (let i = 0; i < n; i += 1) {
      if (cover) { const c = Math.round(cover.getX(i)); aux[i * 2] = c & 0xfff; aux[i * 2 + 1] = Math.floor(c / 4096); }
      else if (shade) aux[i * 2] = shade.getX(i);
    }
    g.setAttribute("kbAux", new THREE.BufferAttribute(aux, 2));
    const inst = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    const attrs = { pos: inst("kbPos", 4), anim: inst("kbAnim", 4), shape: inst("kbShape", 4), color: inst("kbColor", 4), mask: inst("kbMask", 2) };
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return { geometry: g, attrs, triangles: (src.index ? src.index.count : n) / 3 };
  }

  async function loadBody(sex, spec) {
    const gltf = await loadModel(url(spec.file));
    gltf.scene.updateMatrixWorld(true);
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const kbOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.kb) { try { return typeof p.userData.kb === "string" ? JSON.parse(p.userData.kb) : p.userData.kb; } catch { return null; } } return null; };
    const nameOf = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.kb) return p.name; return o.name; };
    const bodyMesh = meshes.find((m) => kbOf(m)?.slot === "body") || meshes[0];
    const skeleton = bodyMesh.skeleton;
    const boneAt = new Map(skeleton.bones.map((b, i) => [b.name, i]));
    const { texture, table } = bake(gltf, skeleton);
    const [young, old] = await Promise.all(spec.skins.map((f) => tex(f)));
    const skinMean = meanOf(young);
    const parts = [];
    const byId = new Map(meshes.map((m) => [nameOf(m).replace(/\./g, ""), m]));
    const list = [{ id: "body", slot: "body", mesh: bodyMesh }, ...spec.parts.map((p) => ({ ...p, mesh: byId.get(p.id.replace(/\./g, "")) || meshes.find((m) => nameOf(m).includes(p.id)) }))];
    await Promise.all(list.map(async (p) => {
      if (!p.mesh) { console.warn("kerbside: crowd part not in the file", sex, p.id); return; }
      const m = p.mesh;
      const boneIndex = m.skeleton.bones.map((b) => boneAt.get(b.name) ?? 0);
      const post = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, m.bindMatrixInverse);
      const u = { kbBones: { value: texture }, kbBind: { value: m.bindMatrix.clone() }, kbPost: { value: post }, kbOldMap: { value: old }, kbMean: { value: new THREE.Vector3(0.5, 0.5, 0.5) } };
      let kind = "cloth", maps = {};
      if (p.slot === "body") { kind = "skin"; maps = { map: young }; u.kbMean.value.fromArray(skinMean); }
      else if (p.texture) {
        const t = await tex(`${sex}/${p.texture}`).catch(() => null);
        if (t) { kind = p.slot === "eyes" ? "plain" : "tint"; maps = { map: t }; u.kbMean.value.fromArray(meanOf(t)); }
      }
      const { geometry, attrs, triangles } = partGeometry(m, boneIndex, S.manifest.morphs);
      const mesh = new THREE.Mesh(geometry, material(kind, u, maps));
      mesh.name = `city-crowd-${sex}-${p.id}`;
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
      mesh.matrixAutoUpdate = false; mesh.raycast = () => {};
      // (Drawn after the ground and the jointed figures: the hair's cut-outs last of the people.)
      mesh.renderOrder = kind === "tint" ? 2 : 1;
      parent.add(mesh);
      parts[p.slot === "body" ? 0 : spec.parts.indexOf(spec.parts.find((q) => q.id === p.id)) + 1] = { id: p.id, slot: p.slot, kind, mesh, attrs, triangles, n: 0 };
    }));
    // The model's own height, from its body as it was bound (feet to the crown): the manifest's
    // is measured in Blender before the export's own scale, and is not the file's.
    const box = new THREE.Box3().setFromBufferAttribute(bodyMesh.geometry.attributes.position).applyMatrix4(bodyMesh.matrixWorld);
    const height = box.max.y - box.min.y > 0.5 ? box.max.y - box.min.y : spec.height_m || 1.75;
    return { sex, parts, table, height, slots: slotsOf(spec.parts), skinMean };
  }

  async function load() {
    from = await storeBuild();
    const r = await fetch(url("crowd.json"), { cache: "no-cache" });
    if (!r.ok) throw new Error(`crowd.json ${r.status}`);
    S.manifest = await r.json();
    for (const [sex, spec] of Object.entries(S.manifest.bodies)) S.bodies[sex] = await loadBody(sex, spec);
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
    // The colours, linear, as each part takes them: the skin over the skin photograph's average.
    const colours = pick.parts.map((p) => {
      tone.set(p.colour);
      if (p.slot === "body") return [tone.r / body.skinMean[0], tone.g / body.skinMean[1], tone.b / body.skinMean[2]].map((v) => Math.max(0.25, Math.min(3.5, v)));
      return [tone.r, tone.g, tone.b];
    });
    let mask = 0;
    const bits = S.manifest.bodies[body.sex].parts;
    for (const p of pick.parts) if (p.index >= 0 && bits[p.index]?.bit != null) mask += 2 ** bits[p.index].bit;
    L = { src: q.look, h: q.height, body, pick, colours, maskLo: mask % 4096, maskHi: Math.floor(mask / 4096) };
    if (S.looks.size > 4000) S.looks.clear();
    S.looks.set(q.id, L);
    return L;
  }
  //: Where a person is in their clips: the clip they are in, how far through it, and the one they
  //: are leaving as it fades.
  function animate(q, body, dt, now) {
    let a = S.anim.get(q.id);
    if (!a) { const r = stream(String(q.id) + "|phase"); a = { clip: "Idle", t: r() * 3, prev: null, pt: 0, fade: 1, seen: now }; S.anim.set(q.id, a); }
    a.seen = now;
    const v = q.moving ? q.speed || 0 : 0;
    const want = v < 0.2 ? "Idle" : v < 2.3 ? "Walk" : "Run";
    if (want !== a.clip && body.table[want]) { a.prev = a.clip; a.pt = a.t; a.clip = want; a.t = a.prev === "Idle" ? 0 : a.t; a.fade = 0; }
    const rate = (c) => (c === "Walk" ? Math.max(0.45, v / WALK_MS) : c === "Run" ? Math.max(0.6, v / RUN_MS) : 1);
    a.t += dt * rate(a.clip);
    if (a.prev) { a.pt += dt * rate(a.prev); a.fade += dt / FADE_S; if (a.fade >= 1) { a.prev = null; a.fade = 1; } }
    return a;
  }
  const FA = { a: 0, b: 0, w: 0 }, FB = { a: 0, b: 0, w: 0 };
  const frameOf = (table, clip, t, out) => {
    const c = table[clip] || table.Idle;
    const x = ((t / c.duration) % 1 + 1) % 1 * c.frames, f = Math.floor(x);
    out.a = c.start + f; out.b = c.start + ((f + 1) % c.frames); out.w = x - f;
    return out;
  };

  //: Each frame: ``list`` is [{id, x, y, z, yaw, height, build, speed, moving, female, look}],
  //: nearest first. Returns how many were drawn (the first so many of ``list``).
  function draw(list, now, dt) {
    if (!S.ready) { start(); return 0; }
    const bodies = S.bodyList ||= Object.values(S.bodies);
    for (const b of bodies) for (const p of b.parts) if (p) p.n = 0;
    const was = S.drawnPrev; S.drawnPrev = S.drawn; S.drawn = was;
    S.drawn.clear();
    let n = 0, triangles = 0;
    // The first frame ready: one of everything drawn below the ground, so every part's shader is
    // compiled at once, before anyone needs it.
    if (!S.warm) {
      S.warm = 1;
      for (const b of bodies) for (const p of b.parts) if (p) { put(p, 0, -500, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1); }
    }
    for (const q of list) {
      if (n >= capacity) break;
      const L = lookFor(q), body = L.body, pick = L.pick;
      const a = animate(q, body, dt, now);
      const f = frameOf(body.table, a.clip, a.t, FA);
      // (Fading from the last clip: this clip's frame, and the last's in the fade's share.)
      let fb = f.b, fw = f.w;
      if (a.prev) { const g = frameOf(body.table, a.prev, a.pt, FB); fb = g.a; fw = 1 - a.fade; }
      const yaw = (q.yaw || 0) + FACING_OFFSET;
      for (let k = 0; k < pick.parts.length; k += 1) {
        const part = body.parts[pick.parts[k].index + 1];
        if (!part || part.n >= capacity) continue;
        const c = L.colours[k];
        put(part, q.x, q.y, q.z, yaw, f.a, fb, fw, pick.weight, pick.muscle, pick.old, pick.height, c[0], c[1], c[2], pick.width, L.maskLo, L.maskHi);
        triangles += part.triangles;
      }
      S.drawn.add(q.id);
      n += 1;
    }
    let draws = 0;
    for (const b of bodies) for (const p of b.parts) {
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
  function put(p, x, y, z, yaw, fa, fb, fw, weight, muscle, old, height, r, g, b, width, maskLo = 0, maskHi = 0) {
    // (Written in place: nothing made a person a frame.)
    const o = p.n * 4, A = p.attrs, P = A.pos.array, N = A.anim.array, H = A.shape.array, C = A.color.array, K = A.mask.array;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = yaw;
    N[o] = fa; N[o + 1] = fb; N[o + 2] = fw; N[o + 3] = 0;
    H[o] = weight; H[o + 1] = muscle; H[o + 2] = old; H[o + 3] = height;
    C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = width;
    K[p.n * 2] = maskLo; K[p.n * 2 + 1] = maskHi;
    p.n += 1;
  }
  return {
    draw, start,
    has: (id) => S.drawn.has(id) || S.drawnPrev.has(id),
    get ready() { return S.ready; }, get failed() { return S.failed; },
    stats: () => ({ ready: S.ready, heights: Object.fromEntries(Object.entries(S.bodies).map(([k, b]) => [k, +b.height.toFixed(3)])), failed: S.failed, capacity, live: S.last.people, draws: S.last.draws, triangles: S.last.triangles, bakeMs: Math.round(S.bakeMs), looks: S.looks.size,
      parts: Object.fromEntries(Object.entries(S.bodies).map(([k, b]) => [k, b.parts.filter(Boolean).length])) }),
  };
}

// ---- the shaders (three's MeshStandardMaterial, its position and normal made here) -------------

const VERTEX_HEAD = /* glsl */ `
attribute vec4 kbJoint; attribute vec4 kbWeight; attribute vec2 kbAux;
attribute vec3 kbM0; attribute vec3 kbM1; attribute vec3 kbM2; attribute vec3 kbM3;
attribute vec4 kbPos; attribute vec4 kbAnim; attribute vec4 kbShape; attribute vec4 kbColor; attribute vec2 kbMask;
uniform highp sampler2D kbBones; uniform mat4 kbBind; uniform mat4 kbPost;
varying vec3 vKbColor; varying float vKbAux; varying float vKbOld; varying float vKbHide;
mat4 kbBone(float j, float frame) {
  int x = int(j + 0.5) * 3, y = int(frame + 0.5);
  vec4 a = texelFetch(kbBones, ivec2(x, y), 0), b = texelFetch(kbBones, ivec2(x + 1, y), 0), c = texelFetch(kbBones, ivec2(x + 2, y), 0);
  return transpose(mat4(a, b, c, vec4(0.0, 0.0, 0.0, 1.0)));
}
mat4 kbSkin(float frame) {
  return kbWeight.x * kbBone(kbJoint.x, frame) + kbWeight.y * kbBone(kbJoint.y, frame) + kbWeight.z * kbBone(kbJoint.z, frame) + kbWeight.w * kbBone(kbJoint.w, frame);
}
vec3 kbYaw(vec3 v) { float c = cos(kbPos.w), s = sin(kbPos.w); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
`;
const VERTEX_NORMAL = /* glsl */ `
  mat4 kbM = kbPost * ((1.0 - kbAnim.z) * kbSkin(kbAnim.x) + kbAnim.z * kbSkin(kbAnim.y)) * kbBind;
  vec3 objectNormal = normalize(kbYaw(mat3(kbM) * normal));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3(tangent.xyz);
  #endif
  vKbColor = kbColor.rgb; vKbOld = kbShape.z; vKbAux = kbAux.x; vKbHide = 0.0;
  #ifdef KB_SKIN
    // Skin under what they wear: drawn just inside it, and cut away (a fragment's worth) below.
    int kbLo = int(kbAux.x + 0.5) & int(kbMask.x + 0.5), kbHi = int(kbAux.y + 0.5) & int(kbMask.y + 0.5);
    vKbHide = (kbLo != 0 || kbHi != 0) ? 1.0 : 0.0;
  #endif
`;
const VERTEX_POSITION = /* glsl */ `
  float kbW = kbShape.x;
  vec3 kbP = position + kbM0 * max(-kbW, 0.0) + kbM1 * max(kbW, 0.0) + kbM2 * kbShape.y + kbM3 * kbShape.z;
  kbP -= normal * 0.012 * vKbHide;
  vec3 transformed = (kbM * vec4(kbP, 1.0)).xyz;
  transformed *= vec3(kbShape.w * kbColor.w, kbShape.w, kbShape.w * (0.92 + kbColor.w * 0.08));
  transformed = kbYaw(transformed) + kbPos.xyz;
  #ifdef USE_ALPHAHASH
    vPosition = transformed;
  #endif
`;
const FRAGMENT_HEAD = /* glsl */ `
varying vec3 vKbColor; varying float vKbAux; varying float vKbOld; varying float vKbHide;
uniform sampler2D kbOldMap; uniform vec3 kbMean;
`;
const FRAGMENT_MAP = /* glsl */ `
  #if defined(KB_SKIN)
    if (vKbHide > 0.5) discard;
    vec4 kbYoung = texture2D(map, vMapUv), kbOlder = texture2D(kbOldMap, vMapUv);
    diffuseColor.rgb *= mix(kbYoung.rgb, kbOlder.rgb, vKbOld) * vKbColor;
  #elif defined(KB_CLOTH)
    diffuseColor.rgb *= vKbColor * vKbAux;
  #elif defined(KB_TINT)
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
