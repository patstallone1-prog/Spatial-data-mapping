// The living city's things -- what you buy, carry, drop, find and see on a shop's shelves -- from
// the user's object lab (Kerbside-object-lab-2026-11-13: Kenney's food, furniture, survival,
// retro-urban and industrial kits, Poly Haven scans and two Poly Pizza models, all CC0), made
// small enough to fetch one at a time in the page.
//
//   node scripts/build_city_objects.mjs --lab ~/Documents/Kerbside-object-lab-2026-11-13 \
//        --modules ~/Documents/Kerbside-object-lab-2026-11-13 --out docs/city/models/objects
//
// ``--modules``: a folder with node_modules/@gltf-transform/*, meshoptimizer and sharp (the lab's
// own has them). The lab is the source of truth for what each model is and how it was sized:
// library.json (each model, its LODs, provider, licence), inventory-coverage.json (which model
// each shop item has, and how good a match it is) and world-coverage.json (the world's kinds).
// This script only:
//   - takes the models the coverage binds to an item with a ``generic_match``, ``representative``
//     or ``label_required`` status, and those the dishes and packs below are composed of. A
//     ``reference_only`` or ``gap`` item keeps its drawn shape: the lab says the model is not it;
//   - writes each model once, its levels of detail as nodes ``near`` (LOD0 if it is at most
//     NEAR_MAX triangles, else LOD1) and ``far`` (LOD2, if it is fewer by a fifth), sharing one
//     set of textures (each at most TEX px, WebP; Kenney's 512 px palette kept as it is);
//   - turns the furniture kit's unlit materials into lit ones (the city is lit);
//   - writes docs/city/objects.json: each model's file, size and tiers, each item's model (or its
//     composition), the label tint a ``label_required`` item gets, and the credits.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith("--") ? [...out, [a.slice(2), all[i + 1]]] : out), []));
const tilde = (p) => (p?.startsWith("~") ? join(homedir(), p.slice(1)) : p);
for (const k of ["lab", "modules", "out"]) if (!args[k]) throw new Error(`--${k} is needed`);
const LAB = resolve(tilde(args.lab)), OUT = resolve(tilde(args.out));
const need = createRequire(join(resolve(tilde(args.modules)), "package.json"));
const load = async (name) => import(pathToFileURL(need.resolve(name)).href);
const { NodeIO } = await load("@gltf-transform/core");
const { ALL_EXTENSIONS, EXTTextureWebP, KHRMaterialsUnlit } = await load("@gltf-transform/extensions");
const { dedup, prune, meshopt, mergeDocuments, getBounds, unpartition } = await load("@gltf-transform/functions");
const { MeshoptEncoder, MeshoptDecoder } = await load("meshoptimizer");
const sharp = (await load("sharp")).default;
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const NEAR_MAX = 3500;   // triangles: in the hand and on the shelf in front of you
const TEX = 256;         // px: a held hammer is about 150 px tall on a 1080p screen

const lib = JSON.parse(readFileSync(join(LAB, "library.json"), "utf8"));
const cov = JSON.parse(readFileSync(join(LAB, "inventory-coverage.json"), "utf8"));
const world = JSON.parse(readFileSync(join(LAB, "world-coverage.json"), "utf8"));
const assets = new Map(lib.assets.map((a) => [a.id, a]));

// ---- what each item is drawn as ------------------------------------------------------------------
//
// Statuses the lab gave each binding: an item is drawn with its model where the lab found one fit
// to show (generic_match, representative) or fit once labelled (label_required: the model's family,
// tinted the product's colour). recipe_required items are drawn as the compositions below, of the
// lab's own models; the rest keep the page's drawn shape.
const SHOWN = new Set(["generic_match", "representative", "label_required"]);

//: Label colours (sRGB) for the label_required items: the colour of the product's own pack.
const LABEL = {
  beer: "#b9852c", energy_drink: "#3fb34f", milk: "#e9eef2", protein_shake: "#d8c9a6", bandage: "#d9534f", pain_relief: "#3b6fb6",
  cold_medicine: "#e08b2b", vitamins: "#f2c94c", prescription: "#f4f4f0", nails: "#8b949c", paint: "#6c8cbf", motor_oil: "#2d2d2d",
  chips: "#d64933", gum: "#4ec3c9", iced_tea: "#9a5a24", sports_drink: "#2a7de1", wine_bottle: "#5b1220", spirits: "#9a6a2a",
  cereal: "#e9a43a", coffee_beans: "#5a3b26", dry_pasta: "#e6c56b", frozen_pizza: "#3b6fb6", yogurt: "#f1f1f1", screws: "#8b949c",
  batteries: "#2c2c2c", coolant: "#43b04a", dog_food: "#b5651d", cat_food: "#7a4fa3", pet_treats: "#c94f7c", board_game: "#b23b3b",
};
//: Items the lab left without a model where one of its own models fits plainly (bound here).
const EXTRA = {
  first_aid_kit: { asset: "ph-medical_box", status: "representative" },
  glass_shards: { asset: "k-food-plate-broken", status: "representative", tint: "#cfe3ea", glass: true },
  car_door: { asset: null, status: "kit_debris" },
};
//: Compositions: a base (a plate, a bowl, a bag) and what sits on it, in metres in the item's own
//: frame (+z its front), each part scaled so its longest side is ``len``. ``on``: the share of the
//: base's height the parts stand at (food sits down in a bowl). ``tint``: the part's colour.
const DISH = (base, len, parts, on = 0.55) => ({ base: { asset: base, len }, on, parts });
const RECIPES = {
  burger_fries: DISH("k-food-plate-dinner", 0.26, [{ asset: "k-food-burger", len: 0.11, x: -0.045 }, { asset: "k-food-fries", len: 0.1, x: 0.06, z: 0.02 }]),
  steak_frites: DISH("k-food-plate-dinner", 0.26, [{ asset: "k-food-meat-cooked", len: 0.14, x: -0.04 }, { asset: "k-food-fries", len: 0.1, x: 0.07 }]),
  fish_and_chips: DISH("k-food-plate-dinner", 0.27, [{ asset: "k-food-fish", len: 0.17, x: -0.03, yaw: 0.5 }, { asset: "k-food-fries", len: 0.1, x: 0.08 }]),
  breakfast_plate: DISH("k-food-plate-dinner", 0.26, [{ asset: "k-food-egg-cooked", len: 0.08, x: -0.05 }, { asset: "k-food-bacon", len: 0.1, x: 0.05, z: -0.03 }, { asset: "k-food-bread", len: 0.08, x: 0.04, z: 0.05 }]),
  tacos: DISH("k-food-plate-rectangle", 0.28, [{ asset: "k-food-taco", len: 0.1, x: -0.08 }, { asset: "k-food-taco", len: 0.1, x: 0 }, { asset: "k-food-taco", len: 0.1, x: 0.08 }]),
  sushi_set: DISH("k-food-plate-rectangle", 0.26, [{ asset: "k-food-maki-salmon", len: 0.035, x: -0.09 }, { asset: "k-food-maki-salmon", len: 0.035, x: -0.05 }, { asset: "k-food-maki-vegetable", len: 0.035, x: -0.01 }, { asset: "k-food-sushi-salmon", len: 0.05, x: 0.04 }, { asset: "k-food-sushi-egg", len: 0.05, x: 0.09 }]),
  korean_bbq: DISH("k-food-plate-dinner", 0.26, [{ asset: "k-food-meat-ribs", len: 0.14, x: -0.02 }, { asset: "k-food-paprika-slice", len: 0.04, x: 0.08, z: 0.04 }]),
  shawarma: DISH("k-food-plate-dinner", 0.26, [{ asset: "k-food-skewer", len: 0.18, yaw: 0.6 }, { asset: "k-food-tomato-slice", len: 0.04, x: 0.08, z: 0.05 }]),
  ramen: DISH("k-food-bowl-broth", 0.16, [{ asset: "k-food-egg-half", len: 0.04, x: 0.02 }, { asset: "k-food-chopstick", len: 0.2, z: 0.05, y: 0.04, yaw: 0.2 }], 0.7),
  chow_mein: DISH("k-food-bowl-broth", 0.16, [{ asset: "k-food-chopstick", len: 0.2, z: 0.05, y: 0.04, yaw: 0.2 }], 0.7),
  pho: DISH("k-food-bowl-broth", 0.17, [{ asset: "k-food-meat-cooked", len: 0.06, x: -0.02 }, { asset: "k-food-chopstick", len: 0.2, z: 0.05, y: 0.04, yaw: 0.2 }], 0.7),
  clam_chowder: DISH("k-food-plate", 0.2, [{ asset: "k-food-loaf-round", len: 0.13 }]),
  pasta_dish: DISH("k-food-plate-deep", 0.24, [{ asset: "k-food-bowl-cereal", len: 0.13, tint: "#e8c37a" }, { asset: "k-food-tomato-slice", len: 0.03, x: 0.02, y: 0.03 }], 0.3),
  risotto: DISH("k-food-plate-deep", 0.24, [{ asset: "k-food-bowl-cereal", len: 0.13, tint: "#efe4c4" }, { asset: "k-food-mushroom-half", len: 0.03, x: 0.02, y: 0.03 }], 0.3),
  teriyaki: DISH("k-food-bowl", 0.15, [{ asset: "k-food-meat-cooked", len: 0.08, y: 0.02, tint: "#7a3d16" }], 0.6),
  fried_rice: DISH("k-food-bowl-cereal", 0.15, [{ asset: "k-food-egg-half", len: 0.035, x: 0.02, y: 0.02 }], 0.7),
  kung_pao: DISH("k-food-bowl", 0.15, [{ asset: "k-food-paprika-slice", len: 0.04, x: -0.02, y: 0.03 }, { asset: "k-food-meat-cooked", len: 0.06, x: 0.02, y: 0.02, tint: "#a24a1c" }], 0.6),
  pad_thai: DISH("k-food-plate-dinner", 0.24, [{ asset: "k-food-bowl-cereal", len: 0.12, tint: "#e0a95a" }, { asset: "k-food-lemon-half", len: 0.04, x: 0.08 }], 0.3),
  green_curry: DISH("k-food-bowl-soup", 0.15, [{ asset: "k-food-paprika-slice", len: 0.035, x: 0.02, y: 0.03, tint: "#4e9a3a" }], 0.7),
  tikka_masala: DISH("k-food-bowl-soup", 0.15, [{ asset: "k-food-meat-cooked", len: 0.05, x: 0.01, y: 0.02, tint: "#c0561e" }], 0.7),
  bibimbap: DISH("k-food-bowl", 0.16, [{ asset: "k-food-egg-cooked", len: 0.07, y: 0.03 }, { asset: "k-food-carrot", len: 0.05, x: 0.04, y: 0.02, yaw: 1.2 }], 0.6),
  six_pack: { base: null, parts: [0, 1, 2].flatMap((i) => [-1, 1].map((j) => ({ asset: "k-food-soda-can", len: 0.123, x: (i - 1) * 0.068, z: j * 0.034 }))) },
  eggs: { base: { asset: "k-furniture-cardboardBoxOpen", len: 0.3, squash: 0.25 }, on: 0.35, parts: [0, 1, 2, 3, 4, 5].flatMap((i) => [-1, 1].map((j) => ({ asset: "k-food-egg", len: 0.055, x: (i - 2.5) * 0.047, z: j * 0.024 }))) },
  vegetables: { base: null, parts: [{ asset: "k-food-broccoli", len: 0.14, x: -0.05 }, { asset: "k-food-carrot", len: 0.17, x: 0.05, z: 0.03, yaw: 1.4, lie: true }, { asset: "k-food-tomato", len: 0.07, x: 0.04, z: -0.05 }, { asset: "k-food-onion", len: 0.07, x: -0.02, z: 0.06 }] },
  groceries: { base: { asset: "k-food-bag", len: 0.36 }, on: 0.75, parts: [{ asset: "k-food-loaf-baguette", len: 0.3, x: -0.04, y: 0.05, yaw: 0.2, tilt: 0.5 }, { asset: "k-food-celery-stick", len: 0.2, x: 0.05, y: 0.02 }] },
  scrap_metal: { base: null, parts: [{ asset: "k-food-soda-can-crushed", len: 0.12, tint: "#8b949c" }, { asset: "k-food-soda-can-crushed", len: 0.1, x: 0.08, z: 0.03, yaw: 2, tint: "#6f767c" }, { asset: "k-food-soda-can-crushed", len: 0.11, x: -0.06, z: 0.06, yaw: 4, tint: "#9aa1a6" }] },
  bar_snacks: DISH("k-food-bowl", 0.12, [{ asset: "k-food-cookie", len: 0.04, y: 0.02 }, { asset: "k-food-cookie", len: 0.04, x: 0.02, y: 0.025, yaw: 1 }], 0.6),
  ingredient_box: { base: { asset: "k-furniture-cardboardBoxOpen", len: 0.45 }, on: 0.55, parts: [{ asset: "k-food-cabbage", len: 0.14, x: -0.08 }, { asset: "k-food-carrot", len: 0.17, x: 0.07, yaw: 1.3, lie: true }, { asset: "k-food-tomato", len: 0.07, x: 0.02, z: 0.08 }] },
};

// ---- choose ---------------------------------------------------------------------------------------
const items = {};
const used = new Set();
for (const x of [...cov.existing_items, ...cov.proposed_additions]) {
  const recipe = RECIPES[x.id];
  if (recipe) {
    items[x.id] = { status: "composed", recipe, from: x.status, name: x.name };
    if (recipe.base) used.add(recipe.base.asset);
    for (const p of recipe.parts) used.add(p.asset);
    continue;
  }
  const extra = EXTRA[x.id];
  if (extra) { items[x.id] = { status: extra.status, asset: extra.asset, name: x.name, ...(extra.tint ? { tint: extra.tint } : {}), ...(extra.glass ? { glass: true } : {}) }; if (extra.asset) used.add(extra.asset); continue; }
  if (!SHOWN.has(x.status) || !x.asset_id || !assets.has(x.asset_id)) { items[x.id] = { status: x.status, asset: null, name: x.name }; continue; }
  items[x.id] = { status: x.status, asset: x.asset_id, name: x.name, ...(x.status === "label_required" && LABEL[x.id] ? { tint: LABEL[x.id] } : {}) };
  used.add(x.asset_id);
}
const worldOut = {};
for (const w of world) {
  const list = w.candidate_assets.filter((a) => assets.has(a) && !/reference only/.test(w.method));
  if (!list.length) continue;
  worldOut[w.archetype] = { assets: list, method: w.method };
  for (const a of list) used.add(a);
}
for (const a of used) if (!assets.has(a)) throw new Error(`no model ${a} in the lab`);

// ---- write ----------------------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".glb")) rmSync(join(OUT, f));
const tris = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0), 0);

async function smallTextures(doc, kenney) {
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage(), size = t.getSize();
    if (kenney && size?.[0] <= 512) continue;   // the palette: swatches, not a picture
    const out = await sharp(img).resize({ width: Math.min(TEX, size?.[0] || TEX), height: Math.min(TEX, size?.[1] || TEX), fit: "inside" }).webp({ quality: 80, effort: 6 }).toBuffer();
    t.setImage(out).setMimeType("image/webp");
    if (t.getURI()) t.setURI(t.getURI().replace(/\.(png|jpe?g)$/i, ".webp"));
  }
}

const outAssets = {};
let total = 0;
for (const id of [...used].sort()) {
  const a = assets.get(id);
  const lods = a.lods.slice().sort((p, q) => p.level - q.level);
  const near = lods[0].triangles <= NEAR_MAX || !lods[1] ? lods[0] : lods[1];
  const far = lods.find((l) => l.level > near.level && l.triangles <= near.triangles * 0.8) || null;
  const doc = await io.read(join(LAB, near.file));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const top = doc.createNode("near");
  for (const n of scene.listChildren()) { scene.removeChild(n); top.addChild(n); }
  scene.addChild(top);
  if (far) {
    const other = await io.read(join(LAB, far.file));
    const map = mergeDocuments(doc, other);
    const farNode = doc.createNode("far");
    for (const s of other.getRoot().listScenes()) {
      const mine = map.get(s);
      for (const n of mine.listChildren()) { mine.removeChild(n); farNode.addChild(n); }
      mine.dispose();
    }
    scene.addChild(farNode);
  }
  // Lit, not unlit: the furniture kit's colours are flat swatches meant for an unlit look.
  for (const ext of root.listExtensionsUsed()) if (ext.extensionName === "KHR_materials_unlit") ext.dispose();
  for (const m of root.listMaterials()) if (m.getRoughnessFactor() === 1 && m.getMetallicFactor() === 1 && !m.getMetallicRoughnessTexture()) m.setMetallicFactor(0).setRoughnessFactor(0.8);
  await smallTextures(doc, a.provider === "Kenney");
  if (root.listTextures().some((t) => t.getMimeType() === "image/webp")) doc.createExtension(EXTTextureWebP).setRequired(true);
  await doc.transform(dedup(), prune(), unpartition(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const file = `${id}.glb`;
  await io.write(join(OUT, file), doc);
  const bytes = statSync(join(OUT, file)).size;
  total += bytes;
  const nearNode = root.listNodes().find((n) => n.getName() === "near");
  const b = getBounds(nearNode);
  outAssets[id] = {
    file, bytes, provider: a.provider, pack: a.pack || null, source: a.source, license: a.license,
    dims: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => +v.toFixed(4)),
    tiers: [{ node: "near", triangles: near.triangles, lod: near.level }, ...(far ? [{ node: "far", triangles: far.triangles, lod: far.level }] : [])],
  };
  process.stdout.write(`${id} ${(bytes / 1024).toFixed(0)} KB ${outAssets[id].tiers.map((t) => t.triangles).join("/")}\n`);
}

const manifest = {
  schema: "kerbside.city_objects/1",
  basis: "scripts/build_city_objects.mjs from the user's object lab (Kerbside-object-lab-2026-11-13, OBJECTS-INTERACTIONS-AND-RESALE-PLAN.md section 2). Models are CC0 (Kenney, Poly Haven, Poly Pizza); sizes are the lab's proposed representative dimensions, and an item is drawn at its catalogue length_m (rules.json items).",
  lod: { near_px: 160, far_px: 48, cull_px: 5, hysteresis: 0.15, near_max_triangles: NEAR_MAX, texture_px: TEX },
  credits: [...new Set(Object.values(outAssets).map((a) => `${a.provider}${a.pack ? ` (${a.pack})` : ""}, CC0-1.0`))].sort(),
  assets: outAssets,
  items,
  world: worldOut,
};
writeFileSync(join(OUT, "..", "..", "objects.json"), `${JSON.stringify(manifest, null, 1)}\n`);
const drawn = Object.values(items).filter((i) => i.asset || i.recipe).length;
console.log(`${Object.keys(outAssets).length} models, ${(total / 1e6).toFixed(2)} MB; ${drawn} of ${Object.keys(items).length} items drawn with a model`);
