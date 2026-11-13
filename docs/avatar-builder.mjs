// The avatar creator's figures: a MakeHuman body (male or female) with the parts it wears, each
// a glTF of its own skinned to the same Mixamo bones, built by
// tools/avatars/build_makehuman_avatars.py and served from the bucket under avatars/. Shape
// sliders are the body's morph targets (each part carries the same morphs, so a beard follows
// the jaw); height is a scale; skin and eye colour are textures swapped in; hair and outfit
// colours tint. The home screen's creator and the walker both build from here.
//
// An avatar is a small plain object (see defaultAvatar) kept with the look on this device.

export const AVATAR_VERSION = 1;
//: The slots a part goes in, in the creator's order, and whether one can be left empty.
export const SLOTS = [
  ["hair", "Hair", true], ["facial_hair", "Facial hair", true], ["eyebrows", "Eyebrows", false],
  ["outfit", "Outfit", false], ["shoes", "Shoes", true], ["hat", "Hat", true],
];
//: Parts drawn as cut-out strands rather than solid cloth.
const STRANDS = new Set(["hair", "facial_hair", "eyebrows", "eyelashes"]);
//: Parts every figure wears, whatever is chosen.
const ALWAYS = ["eyes", "eyelashes"];
//: The sliders, by tab: [id, label, two-ended]. A two-ended slider runs -1..1 between its "-"
//: and "+" morphs; a one-ended one 0..1 on its "+".
export const SLIDERS = {
  Body: [["weight", "Weight", true], ["muscle", "Muscle", true], ["belly", "Belly", false]],
  Face: [["face_fat", "Fullness", true], ["jaw", "Jaw width", true], ["chin", "Chin", true],
         ["chin_height", "Chin height", true], ["cheekbones", "Cheekbones", true]],
  Features: [["nose_width", "Nose width", true], ["nose_length", "Nose length", true], ["nose_hump", "Nose bridge", true],
             ["eyes", "Eyes", true], ["lips", "Lips", true], ["ears", "Ears", true]],
};
export const HEAD_SHAPES = [["", "Default"], ["head_oval", "Oval"], ["head_round", "Round"], ["head_square", "Square"],
  ["head_triangle", "Triangle"], ["head_heart", "Heart"], ["head_diamond", "Diamond"]];
//: Height as a ratio of the figure's own: the page decides how tall the figure stands.
export const HEIGHT_RANGE = [0.88, 1.12];
export const HAIR_COLOURS = [["", "Natural"], ["#1c1612", "Black"], ["#3b2618", "Dark brown"], ["#6a4426", "Brown"],
  ["#a8763f", "Light brown"], ["#d9b46a", "Blond"], ["#8f3a1c", "Auburn"], ["#c4c1bb", "Grey"], ["#f0ede6", "White"]];

const DEFAULTS = {
  male: { skin: "young_caucasian_male", hair: "hair/short02", outfit: "outfit/male_casualsuit01" },
  female: { skin: "young_caucasian_female", hair: "hair/bob01", outfit: "outfit/female_casualsuit01" },
};

export function defaultAvatar(body = "male") {
  const d = DEFAULTS[body] || DEFAULTS.male;
  return { v: AVATAR_VERSION, model: "creator", body: body in DEFAULTS ? body : "male", skin: d.skin, eyes: "brown",
    height: 1, head: "", head_amount: 0.5, sliders: {}, hair: d.hair, hair_colour: "", facial_hair: "",
    eyebrows: "eyebrows/eyebrow001", outfit: d.outfit, shoes: "shoes/shoes01", hat: "" };
}

const clamp = (v, lo, hi, or) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : or);

//: A kept avatar made safe to build: unknown fields dropped, numbers clamped. With the
//: catalogue, parts it does not offer for that body fall back to the default's.
export function sanitizeAvatar(raw, catalogue = null) {
  if (!raw || typeof raw !== "object") return defaultAvatar();
  if (raw.model === "soldier") return { v: AVATAR_VERSION, model: "soldier" };
  const a = defaultAvatar(raw.body === "female" ? "female" : "male");
  const str = (v) => (typeof v === "string" && v.length < 80 ? v : "");
  for (const k of ["skin", "eyes", "head", "hair", "hair_colour", "facial_hair", "eyebrows", "outfit", "shoes", "hat"]) {
    if (k in raw) a[k] = str(raw[k]);
  }
  if (a.hair_colour && !/^#[0-9a-f]{6}$/i.test(a.hair_colour)) a.hair_colour = "";
  a.height = clamp(raw.height, ...HEIGHT_RANGE, 1);
  a.head_amount = clamp(raw.head_amount, 0, 1, 0.5);
  for (const [id, , two] of Object.values(SLIDERS).flat()) {
    if (raw.sliders && id in raw.sliders) a.sliders[id] = clamp(raw.sliders[id], two ? -1 : 0, 1, 0);
  }
  if (!HEAD_SHAPES.some(([id]) => id === a.head)) a.head = "";
  if (catalogue) {
    const d = defaultAvatar(a.body);
    if (!(catalogue.skins[a.body] || []).includes(a.skin)) a.skin = d.skin;
    if (!(a.eyes in catalogue.eye_files)) a.eyes = "brown";
    for (const [slot, , optional] of SLOTS) {
      const item = catalogue.items.find((i) => i.id === a[slot]);
      if (item && item.slot === slot && item.files[a.body]) continue;
      a[slot] = optional && !a[slot] ? "" : (catalogue.items.find((i) => i.id === d[slot] && i.files[a.body])?.id
        || catalogue.items.find((i) => i.slot === slot && i.files[a.body] && (i.default || !optional))?.id || "");
    }
  }
  return a;
}

//: Each slider's morphs and weights for an avatar: {morph name: influence}.
export function morphWeights(avatar) {
  const out = {};
  for (const [id, , two] of Object.values(SLIDERS).flat()) {
    const v = avatar.sliders?.[id] || 0;
    if (v > 0) out[`${id}+`] = v;
    else if (v < 0 && two) out[`${id}-`] = -v;
  }
  if (avatar.head) out[`${avatar.head}+`] = avatar.head_amount ?? 0.5;
  return out;
}

//: The parts an avatar wears: catalogue items, the always-worn first.
export function wornItems(avatar, catalogue) {
  const ids = [...catalogue.items.filter((i) => ALWAYS.includes(i.slot)).map((i) => i.id),
    ...SLOTS.map(([slot]) => avatar[slot]).filter(Boolean)];
  return ids.map((id) => catalogue.items.find((i) => i.id === id)).filter((i) => i && i.files[avatar.body]);
}

//: One builder per page: the catalogue and every file are fetched once and shared by every
//: figure built from them.
//: MakeHuman's Caucasian skins are a pale pink-white (about rgb 188, 156, 138 on average), and
//: under the lobby's key light and the page's filmic tone mapping they drew ghostly white, the
//: features washed out of the face. They are multiplied by a warm tan -- the texture's own
//: detail, the freckles, the shading round the eyes and lips, all kept -- to about 180, 135, 108.
//: The other skins are drawn as they are.
export const SKIN_TINT = { caucasian: "#f4dac4" };
export function skinTintFor(skin) {
  return /caucasian/.test(String(skin || "")) ? SKIN_TINT.caucasian : "#ffffff";
}

export function createAvatarBuilder({ THREE, GLTFLoader, base = "/store/avatars" }) {
  const root = base.replace(/\/$/, "");
  const loader = new GLTFLoader();
  loader.setCrossOrigin("anonymous");
  const files = new Map(), textures = new Map();
  let catalogue = null;
  const loadCatalogue = () => (catalogue ??= fetch(`${root}/catalogue.json`, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`avatar catalogue ${r.status}`); return r.json(); })
    .catch((error) => { catalogue = null; throw error; }));
  const gltf = (path) => {
    if (!files.has(path)) {
      const p = loader.loadAsync(`${root}/${path}`);
      p.catch(() => files.delete(path));
      files.set(path, p);
    }
    return files.get(path);
  };
  const texture = (path) => {
    if (!textures.has(path)) {
      textures.set(path, new THREE.TextureLoader().loadAsync(`${root}/${path}`).then((t) => {
        t.flipY = false;   // glTF's UVs
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }));
    }
    return textures.get(path);
  };
  const meshesOf = (object) => {
    const out = [];
    object.traverse((n) => { if (n.isSkinnedMesh) out.push(n); });
    return out;
  };

  //: A tint that keeps the texture's shading but not its colour (hair: any colour, even
  //: lighter than the strands drawn).
  function tintMaterial(material, hex) {
    const m = material.clone();
    m.userData.tint = new THREE.Color(hex);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.tintColour = { value: m.userData.tint };
      shader.fragmentShader = "uniform vec3 tintColour;\n" + shader.fragmentShader.replace("#include <map_fragment>",
        `#include <map_fragment>
        float tintLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = tintColour * clamp(tintLum * 2.2, 0.0, 1.4);`);
    };
    m.customProgramCacheKey = () => "avatar-tint";
    m.color.set(0xffffff);
    return m;
  }

  //: A figure: build(avatar) gives {root, animations, set(avatar), dispose()}. root is a Group
  //: standing on its feet at the origin, facing +z; set() changes it in place (new parts load
  //: as needed, shapes and colours at once) and resolves when it shows the avatar.
  async function build(avatarIn, { outfitTint = null } = {}) {
    const cat = await loadCatalogue();
    let avatar = sanitizeAvatar(avatarIn, cat);
    const group = new THREE.Group();
    group.name = "avatar";
    let body = null, bodyMesh = null, bodySex = null, animations = [], worn = new Map(), fullIndex = null;
    let token = 0, coversKey = null, coloursKey = null;
    const tints = new Map();

    async function setBody(sex) {
      const g = await gltf(cat.bodies[sex].file);
      return { scene: cloneSkinned(g.scene), animations: g.animations };
    }
    function bindPart(partScene, slot) {
      const bones = new Map(bodyMesh.skeleton.bones.map((b) => [b.name, b]));
      const meshes = meshesOf(partScene);
      for (const mesh of meshes) {
        const skeleton = new THREE.Skeleton(mesh.skeleton.bones.map((b) => bones.get(b.name) || b), mesh.skeleton.boneInverses);
        mesh.removeFromParent();
        bodyMesh.parent.add(mesh);
        mesh.bind(skeleton, mesh.bindMatrix);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.material = mesh.material.clone();
        mesh.material.transparent = false;
        mesh.material.depthWrite = true;
        mesh.material.metalness = 0;
        if (STRANDS.has(slot)) {
          // Strands and lashes: cut, not blended, so they sort with everything else.
          mesh.material.alphaTest = 0.4;
          mesh.material.side = THREE.DoubleSide;
          mesh.material.roughness = Math.max(mesh.material.roughness ?? 1, 0.75);
        } else {
          // Cloth is solid: its textures' alpha is not a cut-out.
          mesh.material.alphaTest = 0;
          mesh.material.opacity = 1;
        }
      }
      return meshes;
    }
    function applyShape() {
      const weights = morphWeights(avatar);
      for (const mesh of [bodyMesh, ...[...worn.values()].flatMap((w) => w.meshes)]) {
        const dict = mesh.morphTargetDictionary;
        if (!dict) continue;
        mesh.morphTargetInfluences.fill(0);
        for (const [name, w] of Object.entries(weights)) if (name in dict) mesh.morphTargetInfluences[dict[name]] = w;
      }
      group.scale.setScalar(avatar.height || 1);
    }
    function applyCovers() {
      // Skin under the outfit and shoes is left out, so it never shows through them as the
      // figure moves: a triangle goes when all three of its corners are covered.
      const geometry = bodyMesh.geometry;
      fullIndex ??= geometry.index.array.slice();
      const vid = geometry.getAttribute("_vid");
      const hidden = new Set();
      for (const id of worn.keys()) {
        const item = cat.items.find((i) => i.id === id);
        for (const [a, b] of item?.covers?.[avatar.body] || []) for (let v = a; v <= b; v++) hidden.add(v);
      }
      if (!vid || !hidden.size) { geometry.setIndex(new THREE.BufferAttribute(fullIndex, 1)); return; }
      const keep = [];
      for (let i = 0; i < fullIndex.length; i += 3) {
        const a = fullIndex[i], b = fullIndex[i + 1], c = fullIndex[i + 2];
        if (hidden.has(Math.round(vid.getX(a))) && hidden.has(Math.round(vid.getX(b))) && hidden.has(Math.round(vid.getX(c)))) continue;
        keep.push(a, b, c);
      }
      geometry.setIndex(new THREE.BufferAttribute(new (fullIndex.constructor)(keep), 1));
    }
    async function applyColours(mine) {
      const [skin, eye] = await Promise.all([texture(cat.skin_files[avatar.skin]), texture(cat.eye_files[avatar.eyes])]);
      if (mine !== token) return;
      bodyMesh.material.map = skin;
      bodyMesh.material.color.set(skinTintFor(avatar.skin));
      bodyMesh.material.needsUpdate = true;
      for (const [id, w] of worn) {
        const item = cat.items.find((i) => i.id === id);
        for (const mesh of w.meshes) {
          if (item.slot === "eyes") { mesh.material.map = eye; mesh.material.needsUpdate = true; }
          if (item.slot === "hair" || item.slot === "eyebrows" || item.slot === "facial_hair") {
            const base = w.base.get(mesh), key = `${base.uuid}|${avatar.hair_colour}`;
            if (avatar.hair_colour && !tints.has(key)) tints.set(key, tintMaterial(base, avatar.hair_colour));
            mesh.material = avatar.hair_colour ? tints.get(key) : base;
          }
          if (item.slot === "outfit") {
            const base = w.base.get(mesh), key = `${base.uuid}|${outfitTint}`;
            if (outfitTint && !tints.has(key)) tints.set(key, base.clone().setValues({ color: outfitTint }));
            mesh.material = outfitTint ? tints.get(key) : base;
          }
        }
      }
    }

    async function set(next, opts = {}) {
      if (opts.outfitTint !== undefined) outfitTint = opts.outfitTint;
      avatar = sanitizeAvatar(next, cat);
      const mine = ++token;
      // A slider moves only shapes and height: drawn at once, nothing loaded or re-made.
      const want = wornItems(avatar, cat);
      const parts = JSON.stringify([avatar.body, want.map((i) => i.id).sort()]);
      const colours = JSON.stringify([avatar.skin, avatar.eyes, avatar.hair_colour, outfitTint]);
      if (avatar.body === bodySex && parts === coversKey && colours === coloursKey) { applyShape(); return figure; }
      if (avatar.body !== bodySex) {
        const b = await setBody(avatar.body);
        if (mine !== token) return;
        body?.removeFromParent();
        for (const w of worn.values()) for (const m of w.meshes) m.removeFromParent();
        worn = new Map();
        body = b.scene;
        animations = b.animations;
        bodyMesh = meshesOf(body)[0];
        bodyMesh.material = bodyMesh.material.clone();
        // Skin is opaque: the exporter marks it blended (MakeHuman's skin has an alpha
        // channel), which lets the mouth's inside show through the lips.
        Object.assign(bodyMesh.material, { transparent: false, depthWrite: true, alphaTest: 0, opacity: 1 });
        bodyMesh.castShadow = true;
        bodyMesh.frustumCulled = false;
        fullIndex = null;
        bodySex = avatar.body;
        group.add(body);
      }
      const loaded = await Promise.all(want.filter((i) => !worn.has(i.id)).map(async (i) => [i, await gltf(i.files[avatar.body])]));
      if (mine !== token) return;
      for (const [id, w] of worn) {
        if (want.some((i) => i.id === id)) continue;
        for (const m of w.meshes) m.removeFromParent();
        worn.delete(id);
      }
      for (const [item, g] of loaded) {
        const meshes = bindPart(cloneSkinned(g.scene), item.slot);
        worn.set(item.id, { meshes, base: new Map(meshes.map((m) => [m, m.material])) });
      }
      applyShape();
      if (parts !== coversKey) { applyCovers(); coversKey = parts; }
      await applyColours(mine);
      if (mine === token) coloursKey = colours;
      return figure;
    }

    const figure = {
      root: group,
      get animations() { return animations; },
      get avatar() { return avatar; },
      set,
      dispose() {
        token++;
        group.removeFromParent();
        group.traverse((n) => { if (n.isMesh) { n.geometry.dispose?.(); } });
      },
    };
    await set(avatar);
    return figure;
  }

  return { catalogue: loadCatalogue, build, base: root, defaultAvatar, sanitizeAvatar,
    SLIDERS, HEAD_SHAPES, SLOTS, HAIR_COLOURS, HEIGHT_RANGE };
}

//: A skinned scene copied with its own bones (three's SkeletonUtils.clone, inlined so the page
//: needs no other import): meshes share geometry and materials until changed.
function cloneSkinned(source) {
  const sourceLookup = new Map(), cloneLookup = new Map();
  const clone = source.clone();
  const walk = (a, b, fn) => { fn(a, b); for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i], fn); };
  walk(source, clone, (a, b) => { sourceLookup.set(b, a); cloneLookup.set(a, b); });
  clone.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const src = sourceLookup.get(node);
    node.skeleton = src.skeleton.clone();
    node.bindMatrix.copy(src.bindMatrix);
    node.skeleton.bones = src.skeleton.bones.map((bone) => cloneLookup.get(bone));
    node.bind(node.skeleton, node.bindMatrix);
    // Its own index, so hiding covered skin on one figure leaves the others whole.
    if (node.geometry.index) { node.geometry = node.geometry.clone(); }
  });
  return clone;
}
