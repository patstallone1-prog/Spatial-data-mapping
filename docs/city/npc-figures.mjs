// The people nearest you, drawn as Unreal characters: a lower-detail build of the project's
// MetaHuman (Ada) for the women, the UE5 mannequin for everyone else, each skinned and walking on
// the mannequin's own clips (idle, walk, jog). Exported from the Unreal project by
// tools/unreal/export_npc_characters.py and packed by tools/build_npc_characters.mjs into
// docs/city/models/npc/ (docs/51-near-ring-people-and-surfaces.md).
//
// Everyone in view big enough on the screen to be told from a jointed figure is drawn this way
// (figurePlan: FIGURE_MIN_PX tall, or within FIGURE_NEAR_YOU_M of you), and everyone on their way
// into that is given a character ahead, hidden, so it is one the moment they arrive. The jointed
// figures (view.mjs drawPeople) are only those further off, and past them the basic shapes.
// Nothing here is required: until the files load -- or where they are not published -- the page
// draws the people as it always did.

//: How many people at most are drawn as characters at once (each is its own skinned mesh). (It had
//: been the nearest 20 in view: on a busy block the twenty-first beside you was a jointed figure.)
export const NEAR_FIGURES_MAX = 64;
//: Characters at most held at once, drawn and readied together.
export const FIGURES_HELD_MAX = 96;
//: Characters made ahead, a few a frame, once the files are in: at least this many of each kind,
//: and more as more are coming (figurePlan's ``want``), so none is copied the moment someone steps in.
export const PREBAKE = { ada: 12, manny: 14, per_frame: 2, spare: 4 };
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
//: first), those to hold a character for, hidden (within it out of view, or heading into it within
//: FIGURE_PREP_S), and how many of each kind are wanted made.
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
  const want = { ada: 0, manny: 0 };
  for (const q of draw) want[q.female ? "ada" : "manny"] += 1;
  for (const q of ready) want[q.female ? "ada" : "manny"] += 1;
  return { draw, ready, want, spilled };
}
//: A figure kept for someone who has stepped out of the ring, to be had again without a fresh
//: copy, this long (ms); then it is put back in the pool.
const LINGER_MS = 2500;
//: The turn from a person's yaw to the export's own facing (+z) for it to face their way (-z).
export const FACING_OFFSET = Math.PI;
//: The clips' own speeds (m/s): a walk played at a person's pace turns as fast as they go.
const WALK_MS = 1.35, JOG_MS = 3.4;
//: The MetaHuman skin photograph's average colour (linear): a person's own tone is laid over it.
const SKIN_MEAN = [0.19, 0.085, 0.048];

const FILES = {
  body: "ada-body.glb", face: "ada-face.glb", outfit: "ada-outfit.glb", hair: "ada-hair.glb",
  manny: "manny.glb", clips: "clips.glb",
};
const TEX = { body: "ada-body.jpg", bodyN: "ada-body-normal.jpg", face: "ada-face.jpg", faceN: "ada-face-normal.jpg", eye: "ada-eye.jpg", hair: "ada-hair.jpg" };

//: ``store`` is the public store's npc/ folder (tools/publish_npc_characters.py): its current.json
//: names the build. Without it, or without a build there, the models come from ``base`` beside the
//: page (a local build; the folder is not in the public repo).
export function npcFigures(THREE, { loadModel, asset, parent, base = "city/models/npc/", store = null }) {
  // (cold: drawn without one readied; madeLate: copied at that moment; readied: given one ahead.)
  const S = { ready: false, failed: false, loading: null, kinds: {}, clips: null, pool: { ada: [], manny: [] }, live: new Map(), made: { ada: 0, manny: 0 }, warmed: null,
    cold: 0, madeLate: 0, readied: 0, short: 0 };
  let from = null;
  const url = (f) => (from ? from + f : asset(base + f));
  const storeBuild = async () => {
    if (!store) return null;
    const r = await fetch(new URL("current.json", store), { cache: "no-cache" }).catch(() => null);
    const cur = r?.ok ? await r.json().catch(() => null) : null;
    return cur?.build ? new URL(`${cur.build}/`, store).href : null;
  };
  const texLoader = new THREE.TextureLoader();
  const tex = (f, srgb = true) => new Promise((ok, no) => texLoader.load(url(f), (t) => {
    t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ok(t);
  }, undefined, no));
  const skinned = (root) => { const out = []; root.traverse((o) => o.isSkinnedMesh && out.push(o)); return out; };

  //: A skinned mesh moved onto another skeleton by bone name; a bone the other has not got (the
  //: face's own) follows the head. Its bind pose is the body's, so it sits where it was made.
  function rebind(mesh, skeleton, fallback) {
    const byName = new Map(skeleton.bones.map((b, i) => [b.name, i]));
    const head = byName.get(fallback);
    const bones = [], inverses = [];
    mesh.skeleton.bones.forEach((b, i) => {
      const j = byName.has(b.name) ? byName.get(b.name) : head;
      bones.push(skeleton.bones[j]);
      inverses.push(byName.has(b.name) ? mesh.skeleton.boneInverses[i].clone() : skeleton.boneInverses[j].clone());
    });
    mesh.bind(new THREE.Skeleton(bones, inverses), mesh.bindMatrix);
  }

  async function load() {
    from = await storeBuild();
    const [body, face, outfit, hair, manny, clips, t] = await Promise.all([
      loadModel(url(FILES.body)), loadModel(url(FILES.face)), loadModel(url(FILES.outfit)), loadModel(url(FILES.hair)),
      loadModel(url(FILES.manny)), loadModel(url(FILES.clips)),
      Promise.all(Object.entries(TEX).map(([k, f]) => tex(f, !/N$/.test(k)).then((v) => [k, v]))).then(Object.fromEntries),
    ]);
    // Unreal exports up to eight bones a vertex; three skins by four (JOINTS_0), so the four it
    // reads are scaled up to the whole: left short of one, a vertex was pulled toward the origin
    // as the limb moved -- shards off the hands and feet.
    for (const g of [body, face, outfit, manny]) for (const m of skinned(g.scene)) m.normalizeSkinWeights();
    // ---- Ada: the body, and on its skeleton the clothes, the face and (on the head) the hair.
    const ada = body.scene;
    ada.updateMatrixWorld(true);
    const bodyMesh = skinned(ada)[0], skel = bodyMesh.skeleton;
    // The bones as the mesh was bound, not as the file's nodes rest: in the MetaHuman's export
    // the two differ (fingers, twist bones), and every bone a clip does not drive kept the
    // nodes' angle -- the hands and feet tore.
    skel.pose(); ada.updateMatrixWorld(true);
    bodyMesh.material = new THREE.MeshStandardMaterial({ map: t.body, normalMap: t.bodyN, roughness: 0.62, metalness: 0 });
    bodyMesh.userData.part = "skin";
    for (const m of skinned(outfit.scene)) {
      rebind(m, skel, "spine_05");
      // The shirt and the shorts (their order in Unreal's material slots): coloured per person.
      m.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
      m.userData.part = m.geometry.boundingBox?.max.y > 1.2 || (m.geometry.computeBoundingBox(), m.geometry.boundingBox.max.y > 1.2) ? "top" : "bottom";
      ada.attach(m);
    }
    for (const m of skinned(face.scene)) {
      rebind(m, skel, "head");
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox, n = m.geometry.attributes.position.count;
      // The head (the biggest part), the two eyes (small, either side), the mouth.
      if (n > 80) { m.material = new THREE.MeshStandardMaterial({ map: t.face, normalMap: t.faceN, roughness: 0.6, metalness: 0 }); m.userData.part = "skin"; }
      else if (Math.abs((b.min.x + b.max.x) / 2) > 0.01) { m.material = new THREE.MeshStandardMaterial({ map: t.eye, roughness: 0.2, metalness: 0 }); }
      else { m.material = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.5, metalness: 0 }); }
      ada.attach(m);
    }
    const headBone = skel.bones.find((b) => b.name === "head");
    hair.scene.updateMatrixWorld(true);
    hair.scene.traverse((o) => {
      if (!o.isMesh) return;
      // Hair cards: the strands' coverage is the atlas's red; the colour is the person's.
      o.material = new THREE.MeshStandardMaterial({ color: 0x2b1d14, alphaMap: t.hair, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.7, metalness: 0 });
      o.material.onBeforeCompile = (shader) => {
        globalThis.__kerbsideProxyLight?.patch?.(shader);
        shader.fragmentShader = shader.fragmentShader.replace("#include <alphamap_fragment>", "#ifdef USE_ALPHAMAP\n diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).r;\n#endif");
      };
      o.material.customProgramCacheKey = () => "npc-hair-red";
      o.userData.part = "hair";
      headBone.attach(o);
    });
    ada.updateMatrixWorld(true);
    // ---- the mannequin: one part its body (the shirt's colour), one its joints (the trousers').
    // The mannequin: dressed by where each point of it is at rest -- legs the trousers', the
    // trunk and arms the shirt's, the head, neck and hands the skin's (bandedMaterial).
    const man = manny.scene;
    skinned(man)[0].skeleton.pose(); man.updateMatrixWorld(true);
    for (const m of skinned(man)) {
      const pos = m.geometry.attributes.position, band = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i += 1) {
        const x = Math.abs(pos.getX(i)), y = pos.getY(i);
        band[i] = y > 1.5 || (x > 0.27 && y < 1.02) ? 2 : y < 0.95 ? 0 : 1;
      }
      m.geometry.setAttribute("kbBand", new THREE.BufferAttribute(band, 1));
      m.material = bandedMaterial(THREE);
      m.userData.part = "banded";
    }
    S.kinds.ada = { root: ada, height: 1.68 };
    S.kinds.manny = { root: man, height: 1.8 };
    // The clips are the mannequin's: played on the mannequin as they are (turns only), and on
    // Ada retargeted -- each bone turned in the world as the mannequin's is turned from its rest,
    // since her bones do not rest at the mannequin's angles (a straight copy tore her hands).
    const turns = clips.animations.map((c) => new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((tr) => tr.name.endsWith(".quaternion"))));
    S.clips = { manny: Object.fromEntries(turns.map((c) => [c.name, c])), ada: Object.fromEntries(turns.map((c) => [c.name, retarget(THREE, c, skinned(man)[0].skeleton, skel)])) };
    for (const k of Object.values(S.kinds)) k.root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; } });
    S.ready = true;
  }

  //: A copy of a kind with its own skeleton, materials (to dress) and mixer.
  function make(kind) {
    const k = S.kinds[kind];
    const root = cloneSkinned(THREE, k.root);
    const parts = { skin: [], top: [], bottom: [], hair: [], banded: [] };
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.userData.part === "banded" ? bandedMaterial(THREE) : o.material.clone();
      parts[o.userData.part]?.push(o.material);
    });
    const holder = new THREE.Group();
    holder.add(root);
    holder.name = `city-person-figure-${kind}`;
    const mixer = new THREE.AnimationMixer(root);
    const actions = Object.fromEntries(Object.entries(S.clips[kind]).map(([n, c]) => [n, mixer.clipAction(c)]));
    for (const a of Object.values(actions)) { a.play(); a.weight = 0; }
    actions.idle.weight = 1;
    return { kind, holder, root, mixer, actions, parts, id: null, seen: 0, height: k.height, dressed: null };
  }
  const tmp = new THREE.Color();
  function dress(f, look) {
    const key = `${look.top}|${look.bottom}|${look.hair}|${look.skin}`;
    if (f.dressed === key) return;
    f.dressed = key;
    for (const m of f.parts.top) m.color.set(look.top);
    for (const m of f.parts.bottom) m.color.set(look.bottom);
    for (const m of f.parts.hair) m.color.set(look.hair);
    for (const m of f.parts.banded) { m.userData.bands[0].set(look.bottom); m.userData.bands[1].set(look.top); m.userData.bands[2].set(look.skin); }
    // The skin: the photographed face and body, toned toward the person's own (a share of it).
    // (The photograph's own average, linear, is about SKIN_MEAN: the person's tone over it.)
    if (f.parts.skin.length) { tmp.set(look.skin); for (const m of f.parts.skin) m.color.setRGB(...[tmp.r, tmp.g, tmp.b].map((c, i) => Math.max(0.5, Math.min(4, c / SKIN_MEAN[i])))); }
  }

  //: Each frame: ``list`` is [{id, x, y, z, yaw, height, build, speed, moving, female, look}],
  //: nearest first. Returns how many were drawn as characters.
  const start = () => { if (!S.loading && !S.failed) S.loading = load().catch((e) => { S.failed = true; console.warn("kerbside: the near-ring characters did not load; the jointed figures stand in", e?.message || e); }); };
  //: Made ahead (PREBAKE), a few a frame; the first of each kind drawn once out of sight, so its
  //: shaders are compiled before anyone needs it (every copy of a kind shares them).
  function prebake(want) {
    if (S.warmed) { for (const f of S.warmed) { f.holder.visible = false; f.holder.position.set(0, 0, 0); S.pool[f.kind].push(f); } S.warmed = []; }
    let n = 0;
    for (const kind of ["manny", "ada"]) {
      // Enough for everyone drawn or coming, and a few to spare: made ahead, never at the moment.
      const target = Math.max(PREBAKE[kind], Math.min(FIGURES_HELD_MAX, (want?.[kind] || 0) + PREBAKE.spare));
      while (S.made[kind] < target && n < PREBAKE.per_frame) {
        const f = make(kind); S.made[kind] += 1; n += 1;
        parent.add(f.holder);
        if (S.made[kind] === 1) { f.holder.visible = true; f.holder.position.set(0, -500, 0); f.mixer.update(0); (S.warmed ||= []).push(f); }
        else { f.holder.visible = false; S.pool[kind].push(f); }
      }
    }
  }
  //: ``ready``: those to hold a character for, out of sight (figurePlan), given one from those
  //: made ahead and dressed, so it is theirs when they come into view; ``want`` the kinds wanted.
  function hold(q) {
    const kind = q.female ? "ada" : "manny";
    let f = S.live.get(q.id);
    if (f && f.kind !== kind) { release(f); f = null; }
    return { f, kind };
  }
  function draw(list, now, dt, ready = [], want = null) {
    if (!S.ready) { start(); return 0; }
    prebake(want);
    for (const q of ready) {
      let { f, kind } = hold(q);
      if (!f) {
        f = S.pool[kind].pop();
        if (!f) { S.short += 1; continue; }    // (none made yet: prebake makes them)
        f.id = q.id; S.live.set(q.id, f);
        if (!f.holder.parent) parent.add(f.holder);
        S.readied += 1;
      }
      f.seen = now; f.holder.visible = false;
      dress(f, q.look);
    }
    let n = 0;
    for (const q of list) {
      if (n >= NEAR_FIGURES_MAX) break;
      let { f, kind } = hold(q);
      if (!f) {
        // Nobody readied: one made now (the stall this is all to avoid; counted).
        f = S.pool[kind].pop() || (S.made[kind] += 1, S.madeLate += 1, make(kind));
        f.id = q.id; S.live.set(q.id, f);
        if (!f.holder.parent) parent.add(f.holder);
        S.cold += 1;
      }
      f.seen = now; f.holder.visible = true;
      const s = q.height / f.height;
      f.holder.position.set(q.x, q.y, q.z);
      // The export faces +z (its toes lie +z of its feet: tests/city_npc_figures.test.mjs reads
      // the model files), and a person's yaw 0 walks -z (stride.mjs, view.mjs): turned half round,
      // as view.mjs turns the jointed figures (p.yaw + Math.PI). Drawn at q.yaw itself, every
      // character walked backwards while its yaw was right (2026-11-19 to 11-20).
      f.holder.rotation.set(0, q.yaw + FACING_OFFSET, 0);
      f.holder.scale.set(s * q.build, s, s * (0.92 + q.build * 0.08));
      dress(f, q.look);
      // The clip by pace: still, walking, jogging -- cross-faded by weight, played at their speed.
      const v = q.moving ? q.speed : 0;
      const want = v < 0.2 ? "idle" : v < 2.3 ? "walk" : "jog";
      const blend = Math.min(1, dt * 6);
      for (const [name, a] of Object.entries(f.actions)) a.weight += ((name === want ? 1 : 0) - a.weight) * blend;
      f.actions.walk.timeScale = Math.max(0.4, v / WALK_MS);
      f.actions.jog.timeScale = Math.max(0.6, v / JOG_MS);
      f.mixer.update(dt);
      n += 1;
    }
    for (const f of S.live.values()) if (f.seen !== now) { if (now - f.seen > LINGER_MS) release(f); else f.holder.visible = false; }
    return n;
  }
  function release(f) {
    S.live.delete(f.id);
    f.id = null; f.holder.visible = false;
    S.pool[f.kind].push(f);
  }
  return { draw, start, has: (id) => S.live.has(id), get ready() { return S.ready; }, get failed() { return S.failed; }, stats: () => ({ ready: S.ready, live: S.live.size, pooled: S.pool.ada.length + S.pool.manny.length, made: S.made.ada + S.made.manny, cold: S.cold, madeLate: S.madeLate, readied: S.readied, short: S.short }) };
}

//: A copy of a hierarchy with skinned meshes, each bound to the copy's own bones (three's
//: SkeletonUtils.clone, which is not in the page's bundle: the same walk over the two trees).
export function cloneSkinned(THREE, source) {
  const clone = source.clone(true);
  const pairs = new Map();
  const walk = (a, b) => { pairs.set(a, b); for (let i = 0; i < a.children.length; i += 1) walk(a.children[i], b.children[i]); };
  walk(source, clone);
  for (const [a, b] of pairs) {
    if (!a.isSkinnedMesh) continue;
    b.skeleton = a.skeleton.clone();
    b.bindMatrix.copy(a.bindMatrix);
    b.skeleton.bones = a.skeleton.bones.map((bone) => pairs.get(bone));
    b.bind(b.skeleton, b.bindMatrix);
  }
  return clone;
}

//: A material coloured in three bands by a ``kbBand`` attribute (0 trousers, 1 shirt, 2 skin):
//: one draw for the mannequin, dressed per person by its three colours (``userData.bands``).
function bandedMaterial(THREE) {
  const bands = [new THREE.Color(0x333333), new THREE.Color(0x888888), new THREE.Color(0xc68a63)];
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.04 });
  m.userData.bands = bands;
  m.onBeforeCompile = (shader) => {
    globalThis.__kerbsideProxyLight?.patch?.(shader);
    shader.uniforms.kbBands = { value: bands };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float kbBand; varying float vKbBand;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvKbBand = kbBand;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 kbBands[3]; varying float vKbBand;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vKbBand < 0.5 ? kbBands[0] : vKbBand < 1.5 ? kbBands[1] : kbBands[2];");
  };
  m.customProgramCacheKey = () => "npc-banded";
  return m;
}

//: ``clip`` (turns of ``from``'s bones) as turns of ``to``'s: each bone of ``to`` that ``from``
//: has is turned in the world as ``from``'s is turned from its rest, its children carried with it;
//: a helper bone (a twist, a corrective) turns with the limb it is named for, and the fingers keep
//: their rest under the hand. Baked once.
export function retarget(THREE, clip, from, to) {
  const Q = THREE.Quaternion;
  const restWorld = (skel) => { const m = new Map(); for (const b of skel.bones) { const q = new Q(); b.getWorldQuaternion(q); m.set(b.name, q); } return m; };
  const fromRest = restWorld(from), toRest = restWorld(to);
  // The limbs and the trunk: the fingers keep their rest under the hand.
  const fromBones = new Map(from.bones.filter((b) => MAIN_BONE.test(b.name)).map((b) => [b.name, b]));
  const tracks = new Map(clip.tracks.map((t) => [t.name.replace(/\.quaternion$/, ""), t]));
  const times = [...new Set(clip.tracks.flatMap((t) => [...t.times]))].sort((a, b) => a - b);
  // A track's value at time t (each track was keyed at the same times; nearest key otherwise).
  const valueAt = (t, i, out) => { const k = Math.max(0, Math.min(t.times.length - 1, nearest(t.times, times[i]))); return out.fromArray(t.values, k * 4); };
  const order = [];   // ``to``'s bones, parents first
  const visit = (b) => { order.push(b); for (const c of b.children) if (c.isBone) visit(c); };
  for (const b of to.bones) if (!b.parent?.isBone) visit(b);
  // A helper bone (a twist, a corrective root -- the MetaHuman has dozens, some hung from the
  // pelvis rather than the limb they shape) turns with the limb it is named for.
  const driverOf = (name) => {
    if (fromBones.has(name)) return name;
    const m = /^(thigh|calf|upperarm|lowerarm|clavicle|hand|foot|ball|spine_0[1-5]|neck_0[12]|head)(?:_.*?)?(_[lr])?$/.exec(name);
    if (!m) return null;
    const d = m[1] + (m[2] || "");
    return fromBones.has(d) ? d : null;
  };
  const drivers = new Map(order.map((b) => [b.name, driverOf(b.name)]).filter(([, d]) => d));
  const fromWorld = new Map(), toWorld = new Map(), out = new Map(order.filter((b) => drivers.has(b.name)).map((b) => [b.name, new Float32Array(times.length * 4)]));
  const q = new Q(), d = new Q(), inv = new Q();
  for (let i = 0; i < times.length; i += 1) {
    fromWorld.clear(); toWorld.clear();
    // ``from`` posed: its world turns down the hierarchy.
    for (const b of from.bones) {
      const local = tracks.has(b.name) ? valueAt(tracks.get(b.name), i, new Q()) : b.quaternion.clone();
      const parent = b.parent?.isBone ? fromWorld.get(b.parent.name) : (() => { const p = new Q(); b.parent?.getWorldQuaternion(p); return p; })();
      fromWorld.set(b.name, parent.clone().multiply(local));
    }
    for (const name of [...fromWorld.keys()]) if (!fromBones.has(name)) fromWorld.delete(name);
    for (const b of order) {
      const parent = b.parent?.isBone ? toWorld.get(b.parent.name) : (() => { const p = new Q(); b.parent?.getWorldQuaternion(p); return p; })();
      let world;
      const drv = drivers.get(b.name);
      if (drv && fromWorld.has(drv)) {
        d.copy(fromWorld.get(drv)).multiply(inv.copy(fromRest.get(drv)).invert());
        world = d.clone().multiply(toRest.get(b.name));
        q.copy(parent).invert().multiply(world).normalize();
        q.toArray(out.get(b.name), i * 4);
      } else world = parent.clone().multiply(b.quaternion);
      toWorld.set(b.name, world);
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, [...out].map(([name, v]) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, v)));
}
const MAIN_BONE = /^(pelvis|spine_0[1-5]|neck_0[12]|head|clavicle_[lr]|upperarm_[lr]|lowerarm_[lr]|hand_[lr]|thigh_[lr]|calf_[lr]|foot_[lr]|ball_[lr])$/;
function nearest(times, t) { let lo = 0, hi = times.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < t) lo = m + 1; else hi = m; } return lo; }
