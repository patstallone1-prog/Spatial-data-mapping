// The kitchen as a place (docs/city/kitchen-panel.mjs plays it; docs/city/kitchen.mjs keeps the rules).
//
// A generic back-of-house room, dressed by the kind of restaurant: a fast-food line in stainless
// steel and red tile, a café in warm wood, a dining room's kitchen in marble and brass, an Asian
// kitchen in dark wood with red lanterns, an Indian one in terracotta and copper. The cook stands
// between two counters: the front one with the day's ingredients in bins, a work surface and the
// pass where plates go out; the back one with the stations this kind of kitchen has. The fridge,
// the freezer and the dry-goods shelves are behind.
//
// Food, utensils and the domestic appliances are Kenney's Food Kit and Furniture Kit (CC0,
// docs/city/models/kitchen/*/License.txt). What neither kit has -- a flat-top grill, a deep
// fryer, a drinks fountain, a pizza oven, a tandoor, a wok burner -- is made here in the same
// low-poly style. Everything is in metres; the counter top is at 0.92.
//
// Visual only: no rules, no server. createKitchenScene returns the room's layout (where each
// station's slots are, where the cook stands to use them) and the means to make and dress items.

export const COUNTER_Y = 0.92;
// Food is drawn a little larger than life so a stack reads from the camera.
const FOOD_SCALE = 1.35;
const BACK_Z = -1.0, FRONT_Z = 1.0, ROOM_X = 3.4;

// ---- how each kind of kitchen looks --------------------------------------------------------------
const STYLE_OF = {
  american: "fastfood", diner: "fastfood", pizza: "fastfood", mexican: "fastfood", deli: "fastfood",
  cafe: "cafe", bakery: "cafe", ice_cream: "cafe",
  restaurant: "fancy", italian: "fancy", seafood: "fancy", mediterranean: "fancy",
  chinese: "asian", japanese: "asian", korean: "asian", thai: "asian", vietnamese: "asian", indian: "indian",
};
export const STYLES = {
  fastfood: { name: "Fast food", floor: ["checker", "#c62f2f", "#f2f0ea", 0.3], wall: ["tile", "#f4f4f2", "#d9dcdf", 0.15], top: ["steel"], cabinet: "#b9bfc5",
    accent: "#e23b2e", accent2: "#f7c32e", light: 0xffffff, lightI: 2.2, warm: 0.15, apron: "#d73a2c", lamps: "panel" },
  cafe: { name: "Café", floor: ["planks", "#9a6b43", "#7d5434", 0.18], wall: ["plain", "#e9e1cf", "#d8ccb4"], top: ["wood", "#c89a66"], cabinet: "#8fb7a5",
    accent: "#4f8a77", accent2: "#f0b6a1", light: 0xffe2b8, lightI: 1.8, warm: 0.5, apron: "#4f8a77", lamps: "pendant", plants: true },
  fancy: { name: "Fine dining", floor: ["slate", "#2d3135", "#3a3f44", 0.6], wall: ["plain", "#25352f", "#1d2a25"], top: ["marble", "#f1efea"], cabinet: "#2b2f33",
    accent: "#c9a24a", accent2: "#8b2b2b", light: 0xffd6a0, lightI: 1.5, warm: 0.7, apron: "#1f2326", lamps: "pendant" },
  asian: { name: "Asian kitchen", floor: ["planks", "#4a3426", "#3b291e", 0.14], wall: ["plain", "#efe6d2", "#e0d3b8"], top: ["steel"], cabinet: "#7a1f1a",
    accent: "#b3261e", accent2: "#e2b13c", light: 0xffe9c4, lightI: 1.9, warm: 0.4, apron: "#202a44", lamps: "lantern" },
  indian: { name: "Indian kitchen", floor: ["tile", "#b65a33", "#a24d2a", 0.3], wall: ["plain", "#f0b85a", "#e3a548"], top: ["stone", "#d9cbb4"], cabinet: "#6b3a1f",
    accent: "#b87333", accent2: "#2f6d55", light: 0xffdcae, lightI: 1.9, warm: 0.55, apron: "#8a2a1d", lamps: "lantern" },
};
export const styleFor = (kind) => STYLES[STYLE_OF[kind] || "fastfood"];

// ---- what each ingredient looks like ---------------------------------------------------------------
// m: a Kenney food model ("file" or "file#node"), or p: a shape made here [shape, colour, w, h, d].
// chop / cook: the model once chopped / cooked. size: its longest side in metres. raw: its tint uncooked.
const PINK = [1.25, 0.62, 0.62];
const LOOK = {
  bun: { m: "burger#bun-bottom", size: 0.11 }, beef_patty: { m: "burger#patty", size: 0.1, raw: PINK }, cheese: { m: "burger#cheese", size: 0.1 },
  lettuce: { m: "burger#salad", size: 0.11 }, tomato: { m: "tomato", chop: "burger#tomato", size: 0.08 }, pickles: { p: ["disc", "#7fa64a", 0.05, 0.006] },
  ketchup: { p: ["splat", "#c0281f", 0.06, 0.006] }, mustard: { p: ["splat", "#e5b81f", 0.06, 0.006] }, mayo: { p: ["splat", "#f3ecd0", 0.06, 0.006] },
  hot_sauce: { p: ["splat", "#d24a1c", 0.05, 0.005] }, bbq_sauce: { p: ["splat", "#5b2414", 0.06, 0.006] }, salsa: { p: ["splat", "#c8432d", 0.07, 0.01] },
  soy_sauce: { p: ["splat", "#2a160c", 0.05, 0.004] }, fish_sauce: { p: ["splat", "#7a4a1a", 0.05, 0.004] }, teriyaki_sauce: { p: ["splat", "#4a2410", 0.06, 0.006] },
  curry_paste: { p: ["splat", "#5e8f2a", 0.06, 0.01] }, tikka_sauce: { p: ["splat", "#c4561e", 0.08, 0.012] }, tomato_sauce: { p: ["splat", "#b8321f", 0.09, 0.008] },
  olive_oil: { p: ["splat", "#b8b04a", 0.06, 0.003] }, tahini: { p: ["splat", "#d8c49a", 0.06, 0.006] }, gochujang: { p: ["splat", "#9e1f17", 0.05, 0.008] },
  tartar_sauce: { p: ["splat", "#ece6c8", 0.05, 0.008] }, wasabi: { p: ["blob", "#8fbf3a", 0.025, 0.015] }, maple_syrup: { p: ["splat", "#9a5a14", 0.07, 0.004] },
  chocolate_syrup: { p: ["splat", "#3b1d0e", 0.07, 0.004] }, salt: { p: ["cluster", "#ffffff", 0.03, 0.006] }, spice_mix: { p: ["cluster", "#a8542a", 0.03, 0.006] },
  sugar: { p: ["cluster", "#fbfbf6", 0.03, 0.006] },
  potato: { p: ["blob", "#b88a52", 0.09, 0.06], chop: { p: ["sticks", "#efd9a0", 0.09, 0.03] }, fry: { m: "fries", size: 0.11 } },
  steak: { m: "meat-raw", cook: "meat-cooked", size: 0.15, raw: PINK }, chicken: { m: "meat-raw", cook: "meat-cooked", size: 0.12, raw: [1.15, 0.85, 0.8] },
  chicken_half: { m: "turkey", size: 0.18, raw: [1.2, 0.95, 0.85] }, chicken_wings: { m: "meat-ribs", size: 0.13, raw: [1.2, 0.85, 0.8] },
  pork: { m: "meat-raw", cook: "meat-cooked", size: 0.12, raw: PINK }, bacon: { m: "bacon-raw", cook: "bacon", size: 0.12 }, ham: { p: ["disc", "#e59aa0", 0.09, 0.006] },
  turkey: { p: ["disc", "#efd4c0", 0.09, 0.006] }, beef_slices: { m: "meat-raw", cook: "meat-cooked", size: 0.1, raw: PINK }, lamb: { m: "meat-raw", cook: "meat-cooked", size: 0.11, raw: PINK },
  shrimp: { p: ["cluster", "#f19a7a", 0.07, 0.02] }, fish_fillet: { m: "fish", size: 0.16, raw: [1.1, 1, 1] }, salmon: { m: "fish", chop: "sushi-salmon", size: 0.14, raw: [1.3, 0.8, 0.7] },
  tuna: { m: "fish", chop: "sushi-salmon", size: 0.13, raw: [1.3, 0.6, 0.6] }, oysters: { m: "mussel", chop: "mussel-open", size: 0.07 }, crab: { p: ["blob", "#d4502c", 0.16, 0.06] },
  clams: { m: "mussel", size: 0.06 }, tofu: { p: ["cube", "#f3efe2", 0.06, 0.04] }, egg: { m: "egg", cook: "egg-cooked", size: 0.06 },
  chickpeas: { p: ["cluster", "#d8b56a", 0.06, 0.02] }, beans: { p: ["cluster", "#8a4f35", 0.06, 0.02] }, peas: { p: ["cluster", "#7cc04a", 0.05, 0.015] },
  peanuts: { p: ["cluster", "#c49a5a", 0.05, 0.015] }, mozzarella: { m: "cheese-cut", size: 0.07, tint: [1.15, 1.15, 1.1] }, parmesan: { p: ["cluster", "#f2e3a8", 0.05, 0.008] },
  cream_cheese: { p: ["splat", "#fbf8ef", 0.05, 0.01] }, butter: { p: ["cube", "#f5df7a", 0.035, 0.02] }, milk: { m: "carton-small", size: 0.09 }, cream: { m: "carton-small", size: 0.08, tint: [1, 0.96, 0.85] },
  yogurt: { m: "cup", size: 0.07 }, sour_cream: { p: ["splat", "#fbf8ef", 0.05, 0.01] }, ice_cream: { m: "ice-cream-scoop-mint", size: 0.06, tint: [1.2, 1.1, 1.05] },
  bread: { m: "bread", size: 0.1 }, baguette: { m: "loaf-baguette", size: 0.2 }, bagel: { m: "donut", size: 0.09, tint: [1.05, 0.85, 0.6] }, tortilla: { p: ["disc", "#ead7a0", 0.16, 0.004] },
  pita: { p: ["disc", "#e6cf98", 0.15, 0.01] }, pizza_dough: { p: ["disc", "#f0dfb8", 0.26, 0.015] }, pizza_slice_baked: { p: ["wedge", "#e2a34a", 0.14, 0.015] },
  naan_dough: { p: ["disc", "#efdcb0", 0.18, 0.01] }, pastry_dough: { m: "croissant", size: 0.1, raw: [1.1, 1.05, 0.9] }, dumpling_wrappers: { p: ["disc", "#f4ecd9", 0.08, 0.01] },
  pasta: { p: ["sticks", "#f1d98a", 0.15, 0.02] }, arborio: { p: ["cluster", "#f4f0e4", 0.06, 0.02] }, rice: { m: "rice-ball", size: 0.08 }, noodles: { p: ["nest", "#efd585", 0.1, 0.03] },
  rice_noodles: { p: ["nest", "#f3efe2", 0.1, 0.03] }, ramen_noodles: { p: ["nest", "#efd585", 0.1, 0.03] }, flour: { m: "bag-flat", size: 0.12 }, nori: { p: ["disc", "#1f3a26", 0.1, 0.003] },
  chips_bag: { m: "bag", size: 0.14 }, onion: { m: "onion", chop: "onion-half", size: 0.07 }, cucumber: { p: ["blob", "#3f7a2e", 0.14, 0.035], chop: { p: ["disc", "#b9d88a", 0.035, 0.008] } },
  carrot: { m: "carrot", size: 0.14, chop: { p: ["cluster", "#ef8a2a", 0.05, 0.01] } }, cabbage: { m: "cabbage", size: 0.12, chop: { p: ["leaves", "#b7d77a", 0.08, 0.02] } },
  bell_pepper: { m: "paprika", chop: "paprika-slice", size: 0.08 }, chili: { m: "paprika", size: 0.05, tint: [1.2, 0.6, 0.5] }, mushroom: { m: "mushroom", chop: "mushroom-half", size: 0.05 },
  garlic: { p: ["blob", "#f4efe2", 0.03, 0.03] }, ginger: { p: ["blob", "#d9b67a", 0.05, 0.025] }, scallion: { m: "leek", size: 0.14 }, cilantro: { p: ["leaves", "#3e8f3a", 0.05, 0.01] },
  basil: { p: ["leaves", "#2f7d32", 0.05, 0.01] }, bean_sprouts: { p: ["sticks", "#f2f0d8", 0.06, 0.015] }, spinach: { p: ["leaves", "#2c6b2a", 0.08, 0.015] }, broccoli: { m: "broccoli", size: 0.08 },
  avocado: { m: "avocado", chop: "advocado-half", size: 0.08 }, lime: { m: "lemon", chop: "lemon-half", size: 0.05, tint: [0.55, 1.1, 0.45] }, lemon: { m: "lemon", chop: "lemon-half", size: 0.06 },
  oranges: { m: "orange", size: 0.07 }, banana: { m: "banana", size: 0.15 }, berries: { m: "strawberry", size: 0.04 }, coconut_milk: { m: "can-small", size: 0.08 },
  ramen_broth: { m: "bowl-broth", size: 0.14 }, broth: { m: "bowl-broth", size: 0.12 }, chocolate: { m: "chocolate", size: 0.08 },
  coffee_beans: { m: "cup", size: 0.07, tint: [0.5, 0.35, 0.25], cook: "cup-coffee" }, tea_leaves: { m: "cup", size: 0.07, cook: "cup-tea" },
  soda_syrup: { m: "cup", size: 0.09, cook: "soda-glass" }, ice: { p: ["cluster", "#d7f0ff", 0.04, 0.02] }, water_bottle: { m: "soda-bottle", size: 0.16, tint: [0.7, 0.9, 1.2] },
  beer_keg: { m: "glass", size: 0.11, cook: "glass", cookTint: [1.25, 0.95, 0.45] }, wine: { m: "glass-wine", size: 0.13, cook: "wine-red", cookTint: [1, 1, 1] },
};
const ROLE_SHAPE = { protein: ["blob", "#c87a6a", 0.08, 0.03], starch: ["blob", "#e2c48a", 0.08, 0.04], veg: ["blob", "#5f9e3e", 0.06, 0.04], sauce: ["splat", "#a0522d", 0.06, 0.006],
  dairy: ["cube", "#f5efdc", 0.05, 0.03], herb: ["leaves", "#3e8f3a", 0.05, 0.01], fruit: ["blob", "#e0a030", 0.06, 0.05], sweet: ["blob", "#6a3a1e", 0.05, 0.03], spice: ["cluster", "#a8542a", 0.03, 0.006],
  drink: ["cup", "#ffffff", 0.07, 0.09] };

// ---- textures painted here ------------------------------------------------------------------------------
function canvasTex(THREE, draw, size = 256, repeat = [1, 1]) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function surface(THREE, [kind, a, b, rough = 0.5], repeat) {
  const noise = (g, s, n, alpha) => { for (let i = 0; i < n; i += 1) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${alpha})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); } };
  if (kind === "steel") {
    const map = canvasTex(THREE, (g, s) => { const gr = g.createLinearGradient(0, 0, s, 0); gr.addColorStop(0, "#c9ced3"); gr.addColorStop(0.5, "#e4e8ec"); gr.addColorStop(1, "#c3c8cd"); g.fillStyle = gr; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 2) { g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.05})`; g.fillRect(0, y, s, 1); } }, 256, repeat);
    return new THREE.MeshStandardMaterial({ map, metalness: 0.75, roughness: 0.32 });
  }
  const map = canvasTex(THREE, (g, s) => {
    g.fillStyle = a; g.fillRect(0, 0, s, s);
    if (kind === "checker") { g.fillStyle = b; for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) if ((x + y) % 2) g.fillRect(x * s / 4, y * s / 4, s / 4, s / 4); }
    if (kind === "tile") { g.strokeStyle = b; g.lineWidth = 3; for (let i = 0; i <= 4; i += 1) { g.beginPath(); g.moveTo(0, i * s / 4); g.lineTo(s, i * s / 4); g.stroke(); g.beginPath(); g.moveTo(((i + (i % 2) * 0.5) * s) / 4, 0); for (let r = 0; r < 4; r += 1) { const off = (r % 2) * s / 8; g.moveTo(i * s / 4 + off, r * s / 4); g.lineTo(i * s / 4 + off, (r + 1) * s / 4); } g.stroke(); } }
    if (kind === "planks") { for (let i = 0; i < 6; i += 1) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * s / 6, s, s / 6 - 2); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect((i * 97) % s, i * s / 6, 2, s / 6); } noise(g, s, 1500, 0.06); }
    if (kind === "slate") { for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * s / 2 + 2, y * s / 2 + 2, s / 2 - 4, s / 2 - 4); } noise(g, s, 3000, 0.08); }
    if (kind === "marble") { g.strokeStyle = "rgba(120,120,130,.35)"; for (let i = 0; i < 9; i += 1) { g.lineWidth = 0.5 + Math.random() * 1.5; g.beginPath(); let x = Math.random() * s, y = 0; g.moveTo(x, y); while (y < s) { x += (Math.random() - 0.5) * 30; y += 12; g.lineTo(x, y); } g.stroke(); } }
    if (kind === "wood") { for (let y = 0; y < s; y += 3) { g.fillStyle = `rgba(80,45,20,${0.05 + Math.random() * 0.08})`; g.fillRect(0, y, s, 1); } }
    if (kind === "stone") noise(g, s, 4000, 0.07);
    if (kind === "plain") noise(g, s, 800, 0.03);
  }, 256, repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: kind === "marble" ? 0.25 : rough, metalness: 0.02 });
}

// ---- the room --------------------------------------------------------------------------------------
//: Builds the kitchen for ``kind`` with ``stations`` (rules ids). ``kit`` gives loadModel(url) and asset(path).
export async function createKitchenScene(THREE, { canvas, kind, stations, kit, title = "Kitchen", menu = [] }) {
  const S = styleFor(kind);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(S.wall[2] || S.wall[1]).multiplyScalar(0.55);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);
  const hits = [];   // things a click can land on
  const hit = (obj, data) => { obj.traverse((o) => { if (o.isMesh) { o.userData.hit = data; hits.push(o); } }); return obj; };
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });
  const box = (w, h, d, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = m.receiveShadow = true; return m; };
  const cyl = (rt, rb, h, mat, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = m.receiveShadow = true; return m; };
  const steel = surface(THREE, ["steel"], [1, 1]), darkSteel = std("#3a3f45", { metalness: 0.7, roughness: 0.35 });

  // Light: a warm or cool key from above, fill, and the lamps of the style.
  scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(S.floor[1]), 0.55));
  const key = new THREE.DirectionalLight(S.light, S.lightI);
  key.position.set(1.5, 4.5, 2.5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 3, bottom: -3, near: 0.5, far: 12 }); key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.PointLight(S.light, 6, 9); fill.position.set(-1.5, 2.6, 1.2); scene.add(fill);

  // Floor and walls.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_X * 2, 5), surface(THREE, S.floor, [ROOM_X * 1.2, 2.5]));
  floor.rotation.x = -Math.PI / 2; floor.position.z = 0.2; floor.receiveShadow = true; scene.add(floor);
  hit(floor, { type: "floor" });
  const wallMat = surface(THREE, S.wall, [ROOM_X * 1.5, 1.6]);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_X * 2, 3.2), wallMat); back.position.set(0, 1.6, BACK_Z - 0.32); back.receiveShadow = true; scene.add(back);
  for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.2), wallMat); side.position.set(sx * ROOM_X, 1.6, 0.2); side.rotation.y = -sx * Math.PI / 2; side.receiveShadow = true; scene.add(side); }
  // A stripe of the accent colour, and the menu board.
  const stripe = box(ROOM_X * 2, 0.08, 0.01, std(S.accent)); stripe.position.set(0, 1.55, BACK_Z - 0.31); scene.add(stripe);
  const boardCanvas = document.createElement("canvas"); boardCanvas.width = 512; boardCanvas.height = 256;
  const bg = boardCanvas.getContext("2d"); bg.fillStyle = S.lamps === "panel" ? "#1d1d1d" : "#23201c"; bg.fillRect(0, 0, 512, 256);
  bg.strokeStyle = S.accent; bg.lineWidth = 8; bg.strokeRect(4, 4, 504, 248);
  bg.fillStyle = S.accent2; bg.font = "bold 36px system-ui, sans-serif"; bg.fillText(title.slice(0, 24), 22, 52);
  bg.fillStyle = "#f3efe6"; bg.font = "21px system-ui, sans-serif";
  menu.slice(0, 8).forEach((m, i) => { const x = 22 + (i % 2) * 248, y = 96 + Math.floor(i / 2) * 38; bg.fillText(m.name.slice(0, 15), x, y); bg.fillStyle = S.accent2; bg.fillText(m.price, x + 168, y); bg.fillStyle = "#f3efe6"; });
  const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace;
  const menuBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: boardTex, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 0.35, roughness: 0.8 }));
  menuBoard.position.set(0.4, 2.35, BACK_Z - 0.3); scene.add(menuBoard);

  // ---- models ----------------------------------------------------------------------------------------
  const cache = new Map();
  const load = (path) => {
    if (!cache.has(path)) cache.set(path, kit.loadModel(kit.asset(`city/models/kitchen/${path}.glb`)).then((g) => g.scene).catch(() => null));
    return cache.get(path);
  };
  //: A Kenney model (or one node of it), scaled so its longest side is ``size`` m, sitting on y 0, centred.
  const fitted = (src, size, keepXZ = false) => {
    const o = src.clone(true);
    o.traverse((m) => { if (m.isMesh) { m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone(); m.castShadow = m.receiveShadow = true; } });
    const wrap = new THREE.Group(); wrap.add(o);
    const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3());
    const k = size / Math.max(sz.x, sz.y, sz.z, 1e-6);
    o.scale.multiplyScalar(k);
    const b2 = new THREE.Box3().setFromObject(o), c = b2.getCenter(new THREE.Vector3());
    o.position.sub(new THREE.Vector3(keepXZ ? 0 : c.x, b2.min.y, keepXZ ? 0 : c.z));
    return wrap;
  };
  async function kenney(spec, size) {
    const [file, node] = spec.split("#");
    const root = await load(`food/${file}`);
    if (!root) return null;
    let src = root;
    if (node) {
      src = root.getObjectByName(node);
      if (!src) return null;
      src = src.clone(true); src.position.set(0, 0, 0);
    }
    return fitted(src, size);
  }
  //: A device: the furniture kit's, scaled to ``w`` wide (or to its own height ``h``).
  async function furniture(name, { w = null, h = null, tint = null } = {}) {
    const root = await load(`furniture/${name}`);
    if (!root) return null;
    const o = root.clone(true);
    o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.castShadow = m.receiveShadow = true; if (tint) m.material.color.multiply(new THREE.Color(tint)); } });
    const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3());
    const k = w ? w / sz.x : h / sz.y;
    o.scale.multiplyScalar(k);
    const b2 = new THREE.Box3().setFromObject(o), c = b2.getCenter(new THREE.Vector3());
    o.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
    const g = new THREE.Group(); g.add(o);
    return g;
  }

  // ---- a shape made here, in the kits' style ----------------------------------------------------------
  function shape([kind, color, w, h]) {
    const mat = std(color, { roughness: 0.7 }), g = new THREE.Group();
    const add = (m) => { m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    if (kind === "disc") add(new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 20), mat)).position.y = h / 2;
    else if (kind === "splat") { const m = add(new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2.2, h, 9), mat)); m.position.y = h / 2; m.scale.set(1, 1, 0.85); m.rotation.y = 0.7; }
    else if (kind === "blob") { const m = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat)); m.scale.set(w, h, w * 0.8); m.position.y = h / 2; }
    else if (kind === "cube") add(new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.8), mat)).position.y = h / 2;
    else if (kind === "wedge") { const m = add(new THREE.Mesh(new THREE.CylinderGeometry(w, w, h, 3, 1, false, 0, Math.PI / 3), mat)); m.position.y = h / 2; }
    else if (kind === "nest") { const m = add(new THREE.Mesh(new THREE.TorusGeometry(w / 3, h / 1.6, 8, 18), mat)); m.rotation.x = Math.PI / 2; m.position.y = h / 2; }
    else if (kind === "cup") { add(new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2.6, h, 16), mat)).position.y = h / 2; }
    else if (kind === "sticks" || kind === "cluster" || kind === "leaves") {
      const n = kind === "sticks" ? 7 : kind === "leaves" ? 5 : 9;
      for (let i = 0; i < n; i += 1) {
        const a = i * 2.39996, r = (w / 2.6) * Math.sqrt((i + 0.5) / n);
        const geo = kind === "sticks" ? new THREE.BoxGeometry(w, h * 0.5, h * 0.5) : kind === "leaves" ? new THREE.SphereGeometry(w / 3.2, 7, 5) : new THREE.IcosahedronGeometry(h * 0.6, 0);
        const m = add(new THREE.Mesh(geo, mat));
        m.position.set(Math.cos(a) * r, h * (kind === "sticks" ? 0.3 + (i % 3) * 0.4 : 0.5), Math.sin(a) * r);
        m.rotation.y = a * (kind === "sticks" ? 0.6 : 1);
        if (kind === "leaves") m.scale.set(1, 0.18, 0.6);
      }
    }
    return g;
  }

  // ---- items: the food, as it is ---------------------------------------------------------------------
  //: The look of an ingredient in a state: {chain: [...processes], ratio, q}. Resolves to an Object3D.
  async function itemObject(ing, role, state = { chain: [] }) {
    const L = LOOK[ing] || { p: ROLE_SHAPE[role] || ROLE_SHAPE.veg };
    const chopped = state.chain.includes("chop"), heat = state.chain.find((p) => ["grill", "fry", "boil", "saute", "bake", "micro", "toast", "steam", "wok", "brew", "pour"].includes(p));
    let spec = L;
    if (heat === "fry" && L.fry) spec = L.fry;
    else if (heat && L.cook && !chopped) spec = { m: L.cook, size: L.size };
    else if (chopped && L.chop) spec = typeof L.chop === "string" ? { m: L.chop, size: L.size } : L.chop;
    let o = spec.m ? await kenney(spec.m, spec.size || L.size || 0.08) : null;
    if (!o) o = shape(spec.p || L.p || ROLE_SHAPE[role] || ROLE_SHAPE.veg);
    if (chopped && !L.chop && !spec.m) o.scale.y *= 0.6;
    if (chopped && !L.chop && spec.m) { o.scale.y *= 0.55; o.scale.x *= 1.1; }
    o.scale.multiplyScalar(FOOD_SCALE);
    tint(o, ing, state);
    o.userData.ing = ing;
    return o;
  }
  //: Colour by how it was cooked: raw meat pink, browned when right, dark when overdone, black burnt.
  function tint(o, ing, { chain = [], ratio = 1 } = {}) {
    const L = LOOK[ing] || {};
    const heat = chain.some((p) => ["grill", "fry", "saute", "bake", "micro", "toast", "wok"].includes(p));
    const wet = chain.some((p) => ["boil", "steam"].includes(p));
    let c = new THREE.Color(1, 1, 1);
    if (L.tint) c.setRGB(...L.tint);
    if (!heat && !wet && L.raw) c.setRGB(...L.raw);
    if (chain.includes("brew") || chain.includes("pour")) { if (L.cookTint) c.setRGB(...L.cookTint); }
    if (heat) {
      const r = ratio ?? 1, raw = new THREE.Color(...(L.raw || [1, 1, 1]));
      const done = chain.includes("fry") ? new THREE.Color(1.05, 0.88, 0.55) : new THREE.Color(0.95, 0.85, 0.75);
      if (r < 1) c = raw.lerp(done, Math.max(0, Math.min(1, r)));
      else if (r < 1.65) c = done.clone().lerp(new THREE.Color(0.45, 0.3, 0.2), (r - 1) / 0.65);
      else c = new THREE.Color(0.45, 0.3, 0.2).lerp(new THREE.Color(0.08, 0.07, 0.06), Math.min(1, (r - 1.65) / 0.6));
    } else if (wet) c.multiplyScalar(1.05);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.userData.base ??= m.material.color.clone();
      m.material.color.copy(m.userData.base).multiply(c);
    });
  }

  // ---- counters ---------------------------------------------------------------------------------------
  const top = S.top[0] === "steel" ? steel : surface(THREE, [S.top[0], S.top[1], S.top[1], 0.45], [2, 0.5]);
  const cab = std(S.cabinet, { roughness: 0.55, metalness: S.top[0] === "steel" ? 0.4 : 0.05 });
  function counter(x0, x1, z, d) {
    const g = new THREE.Group(), w = x1 - x0;
    const body = box(w, COUNTER_Y - 0.04, d - 0.04, cab); body.position.set((x0 + x1) / 2, (COUNTER_Y - 0.04) / 2, z); g.add(body);
    const slab = box(w + 0.02, 0.04, d, top); slab.position.set((x0 + x1) / 2, COUNTER_Y - 0.02, z); g.add(slab);
    for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.6) { const handle = box(0.12, 0.012, 0.012, darkSteel); handle.position.set(x, COUNTER_Y - 0.14, z + Math.sign(d) * (d / 2)); g.add(handle); }
    scene.add(g);
    return g;
  }
  // Front counter: the pass on the left, the ingredient bins, the work surface, the board and bowl.
  const front = counter(-2.7, 2.7, FRONT_Z, 0.72);
  // The pass: a raised steel shelf under heat lamps, where plates go out.
  const PASS = { x0: -2.65, x1: -1.65, z: FRONT_Z + 0.12 };
  const pass = box(PASS.x1 - PASS.x0, 0.03, 0.42, steel); pass.position.set((PASS.x0 + PASS.x1) / 2, COUNTER_Y + 0.06, PASS.z); scene.add(pass);
  for (const sx of [PASS.x0 + 0.05, PASS.x1 - 0.05]) { const leg = box(0.03, 0.06, 0.4, steel); leg.position.set(sx, COUNTER_Y + 0.03, PASS.z); scene.add(leg); }
  const lampMat = std("#2b2b2b", { emissive: 0xff5a1f, emissiveIntensity: 0.6 });
  for (let i = 0; i < 2; i += 1) {
    const lamp = box(0.42, 0.06, 0.16, lampMat); lamp.position.set(PASS.x0 + 0.27 + i * 0.47, COUNTER_Y + 0.75, PASS.z); scene.add(lamp);
    const rod = cyl(0.01, 0.01, 1.4, darkSteel, 6); rod.position.set(lamp.position.x, COUNTER_Y + 1.45, PASS.z); scene.add(rod);
    const glow = new THREE.PointLight(0xff8a3c, 1.6, 1.2); glow.position.set(lamp.position.x, COUNTER_Y + 0.6, PASS.z); scene.add(glow);
  }
  const passHit = new THREE.Mesh(new THREE.BoxGeometry(PASS.x1 - PASS.x0, 0.04, 0.44), new THREE.MeshBasicMaterial({ visible: false }));
  passHit.position.set((PASS.x0 + PASS.x1) / 2, COUNTER_Y + 0.08, PASS.z); scene.add(passHit); hit(passHit, { type: "pass" });
  const passSlots = [0, 1, 2].map((i) => new THREE.Vector3(PASS.x0 + 0.18 + i * 0.32, COUNTER_Y + 0.075, PASS.z));
  // The work surface (a click there puts down what you hold).
  const WORK = { x0: -1.5, x1: 1.45, z0: FRONT_Z - 0.06, z1: FRONT_Z + 0.3 };
  const work = new THREE.Mesh(new THREE.BoxGeometry(WORK.x1 - WORK.x0, 0.01, WORK.z1 - WORK.z0), new THREE.MeshBasicMaterial({ visible: false }));
  work.position.set((WORK.x0 + WORK.x1) / 2, COUNTER_Y + 0.005, (WORK.z0 + WORK.z1) / 2); scene.add(work); hit(work, { type: "work" });
  // A line on the counter marking the work surface.
  const edge = box(WORK.x1 - WORK.x0, 0.002, 0.01, std(S.accent)); edge.position.set((WORK.x0 + WORK.x1) / 2, COUNTER_Y + 0.001, WORK.z0 - 0.02); scene.add(edge);
  // Back counter, under the stations.
  const backCounter = counter(-2.25, ROOM_X - 0.1, BACK_Z, 0.62);
  const walk = { x0: -2.9, x1: 2.9, z0: BACK_Z + 0.5, z1: FRONT_Z - 0.55 };

  // ---- the bins of the day's ingredients, on the front counter --------------------------------------
  const bins = [];
  async function setBins(list, R) {
    for (const b of bins) scene.remove(b.group);
    bins.length = 0;
    const n = Math.min(list.length, 10), w = (WORK.x1 - WORK.x0) / Math.max(n, 1);
    for (let i = 0; i < n; i += 1) {
      const ing = list[i], g = new THREE.Group();
      const x = WORK.x0 + w * (i + 0.5), z = FRONT_Z - 0.24;
      const tub = box(Math.min(0.26, w - 0.02), 0.08, 0.2, std("#d5dade", { metalness: 0.6, roughness: 0.3 })); tub.position.y = 0.04; g.add(tub);
      const inner = box(Math.min(0.24, w - 0.04), 0.01, 0.18, std("#9aa3ab", { metalness: 0.5 })); inner.position.y = 0.075; g.add(inner);
      g.position.set(x, COUNTER_Y, z);
      scene.add(g);
      const role = R.kitchen.ingredients[ing]?.role;
      for (let k = 0; k < 3; k += 1) {
        const o = await itemObject(ing, role, { chain: [] });
        const sc = Math.min(1, (Math.min(0.26, w - 0.02) * 0.55) / Math.max(0.05, LOOK[ing]?.size || 0.08));
        o.scale.multiplyScalar(sc); o.position.set((k - 1) * Math.min(0.07, w / 4), 0.08 + k * 0.004, (k % 2) * 0.03 - 0.015); o.rotation.y = k * 1.3;
        g.add(o);
      }
      hit(g, { type: "bin", ing });
      bins.push({ ing, group: g, x, z, approach: new THREE.Vector3(x, 0, walk.z1) });
    }
  }

  // ---- the stations ------------------------------------------------------------------------------------
  const COUNTER_TOP = ["board", "bowl"];
  const WIDTH = { grill: 0.9, fryer: 0.62, stove: 0.78, oven: 0.78, pizza_oven: 1.0, tandoor: 0.8, wok: 0.7, steamer: 0.55, drinks: 0.62, microwave: 0.5, blender: 0.34, espresso: 0.48, kettle: 0.34, toaster: 0.34 };
  const layout = {};
  const backList = stations.filter((s) => !COUNTER_TOP.includes(s));
  const span = (ROOM_X - 0.2) - (-2.2), want = backList.reduce((s, id) => s + (WIDTH[id] || 0.6) + 0.06, 0), squeeze = Math.min(1, span / want);
  let bx = -2.2;
  const lit = {};
  for (const id of backList) {
    const w = (WIDTH[id] || 0.6) * squeeze, x = bx + w / 2; bx += w + 0.06 * squeeze;
    layout[id] = await device(id, x, BACK_Z, w, true);
  }
  // On the front counter, right of the bins: the board and the bowl.
  if (stations.includes("board")) layout.board = await device("board", 1.82, FRONT_Z + 0.02, 0.5, false);
  if (stations.includes("bowl")) layout.bowl = await device("bowl", 2.38, FRONT_Z + 0.02, 0.36, false);

  async function device(id, x, z, w, back) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const facing = back ? 1 : -1;   // back-counter devices face the room (+z)
    let slots = [], topY = COUNTER_Y, label = id;
    const onTop = (o) => { o.position.y += COUNTER_Y; g.add(o); return o; };
    const glowMat = (color) => std("#222", { emissive: color, emissiveIntensity: 0 });
    let glow = null;
    if (id === "grill") {
      const plate = box(w - 0.04, 0.03, 0.52, std("#1e1f21", { metalness: 0.6, roughness: 0.5 })); plate.position.y = COUNTER_Y + 0.015; g.add(plate);
      const rim = box(w, 0.06, 0.04, steel); rim.position.set(0, COUNTER_Y + 0.03, -0.27); g.add(rim);
      glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.08, 0.46), new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0 })); glow.rotation.x = -Math.PI / 2; glow.position.y = COUNTER_Y + 0.032; g.add(glow);
      for (let i = 0; i < 4; i += 1) slots.push(new THREE.Vector3(-w / 2 + (w / 4) * (i + 0.5), COUNTER_Y + 0.031, 0.05));
      topY = COUNTER_Y + 0.031;
    } else if (id === "fryer") {
      const body = box(w, 0.06, 0.55, steel); body.position.y = COUNTER_Y + 0.03; g.add(body);
      for (const sx of [-1, 1]) {
        const well = box(w / 2 - 0.06, 0.02, 0.36, std("#c8902a", { emissive: 0x4a2a00, emissiveIntensity: 0.3, roughness: 0.15, metalness: 0.2 })); well.position.set(sx * w / 4, COUNTER_Y + 0.05, 0.02); g.add(well);
        const basket = box(w / 2 - 0.1, 0.06, 0.26, std("#9aa0a6", { metalness: 0.8, roughness: 0.4, wireframe: true })); basket.position.set(sx * w / 4, COUNTER_Y + 0.08, 0.02); g.add(basket);
        const handle = box(0.02, 0.02, 0.18, darkSteel); handle.position.set(sx * w / 4, COUNTER_Y + 0.13, 0.22); g.add(handle);
        slots.push(new THREE.Vector3(sx * w / 4, COUNTER_Y + 0.07, 0.02));
      }
      const back2 = box(w, 0.3, 0.06, steel); back2.position.set(0, COUNTER_Y + 0.15, -0.26); g.add(back2);
    } else if (id === "stove" || id === "oven") {
      const s2 = await furniture(id === "stove" ? "kitchenStove" : "kitchenStoveElectric", { w });
      if (s2) { s2.position.y = 0; s2.scale.y *= COUNTER_Y / (new THREE.Box3().setFromObject(s2).getSize(new THREE.Vector3()).y || 1); g.add(s2); }
      if (id === "stove") {
        for (let i = 0; i < 4; i += 1) {
          const sx = (i % 2 ? 1 : -1) * w / 4.2, sz = i < 2 ? 0.1 : -0.1;
          const ring = cyl(0.07, 0.07, 0.01, glowMat(0xff3b1f), 16); ring.position.set(sx, COUNTER_Y + 0.005, sz); g.add(ring);
          const pot = await kenney(i % 2 ? "pot" : "frying-pan", i % 2 ? 0.2 : 0.24);
          if (pot) { pot.position.set(sx, COUNTER_Y + 0.01, sz); g.add(pot); }
          slots.push(new THREE.Vector3(sx, COUNTER_Y + (i % 2 ? 0.05 : 0.03), sz));
        }
      } else {
        glow = new THREE.PointLight(0xff7a2a, 0, 0.9); glow.position.set(0, 0.45, 0.25); g.add(glow);
        for (let i = 0; i < 3; i += 1) slots.push(new THREE.Vector3(-w / 3 + (w / 3) * i, COUNTER_Y + 0.01, 0));
        label = "oven";
      }
    } else if (id === "pizza_oven") {
      const base = box(w, COUNTER_Y, 0.6, std("#6b4a3a")); base.position.y = COUNTER_Y / 2; g.add(base);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(w / 2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), std("#a8553a", { roughness: 0.9 })); dome.position.y = COUNTER_Y; dome.scale.z = 0.62; dome.castShadow = true; g.add(dome);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16, 0, Math.PI), std("#1a0d06", { emissive: 0xff5a1f, emissiveIntensity: 0.4 })); mouth.position.set(0, COUNTER_Y, w / 2 * 0.62 + 0.002); g.add(mouth);
      glow = mouth.material;
      for (let i = 0; i < 3; i += 1) slots.push(new THREE.Vector3(-0.28 + i * 0.28, COUNTER_Y + 0.005, 0.33));
      const shelf = box(w, 0.02, 0.18, steel); shelf.position.set(0, COUNTER_Y - 0.01, 0.36); g.add(shelf);
    } else if (id === "tandoor") {
      const pot = cyl(w / 2.2, w / 2.6, COUNTER_Y + 0.05, std("#b4643a", { roughness: 0.95 }), 20); pot.position.y = (COUNTER_Y + 0.05) / 2; g.add(pot);
      const mouth = cyl(w / 3.2, w / 3.2, 0.012, std("#2a0f05", { emissive: 0xff5a1f, emissiveIntensity: 0.5 })); mouth.position.y = COUNTER_Y + 0.05; g.add(mouth);
      glow = mouth.material;
      for (let i = 0; i < 3; i += 1) slots.push(new THREE.Vector3(Math.cos(i * 2.1) * w / 6, COUNTER_Y + 0.06, Math.sin(i * 2.1) * w / 6));
    } else if (id === "wok") {
      const burner = box(w, 0.08, 0.55, steel); burner.position.y = COUNTER_Y + 0.04; g.add(burner);
      for (const sx of [-1, 1]) {
        const flame = cyl(0.08, 0.05, 0.02, glowMat(0x3b6bff)); flame.position.set(sx * w / 4, COUNTER_Y + 0.09, 0); g.add(flame);
        const pan = await kenney("frying-pan", 0.3); if (pan) { pan.position.set(sx * w / 4, COUNTER_Y + 0.1, 0); pan.traverse((m) => m.isMesh && m.material.color.multiplyScalar(0.6)); g.add(pan); }
        slots.push(new THREE.Vector3(sx * w / 4, COUNTER_Y + 0.12, 0));
      }
    } else if (id === "steamer") {
      for (let i = 0; i < 3; i += 1) {
        const st2 = await kenney("steamer", 0.18); if (st2) { st2.position.set(-w / 3 + (w / 3) * i, COUNTER_Y, 0); g.add(st2); }
        slots.push(new THREE.Vector3(-w / 3 + (w / 3) * i, COUNTER_Y + 0.07, 0));
      }
    } else if (id === "drinks") {
      const tower = box(w, 0.55, 0.32, std(S.accent, { roughness: 0.35, metalness: 0.2 })); tower.position.set(0, COUNTER_Y + 0.275, -0.12); g.add(tower);
      const logo = box(w * 0.8, 0.12, 0.005, std("#ffffff", { emissive: 0xffffff, emissiveIntensity: 0.4 })); logo.position.set(0, COUNTER_Y + 0.45, 0.042); g.add(logo);
      const tray = box(w, 0.02, 0.2, darkSteel); tray.position.set(0, COUNTER_Y + 0.01, 0.12); g.add(tray);
      for (let i = 0; i < 3; i += 1) { const nz = cyl(0.015, 0.012, 0.06, darkSteel, 8); nz.position.set(-w / 3 + (w / 3) * i, COUNTER_Y + 0.25, 0.05); g.add(nz); }
      for (let i = 0; i < 2; i += 1) slots.push(new THREE.Vector3(-w / 4 + (w / 2) * i, COUNTER_Y + 0.02, 0.12));
    } else {
      const F = { microwave: ["kitchenMicrowave", 0.48], blender: ["kitchenBlender", 0.22], espresso: ["kitchenCoffeeMachine", 0.42], toaster: ["toaster", 0.3] }[id];
      if (F) { const o = await furniture(F[0], { w: F[1] }); if (o) onTop(o); }
      if (id === "kettle") { const o = await kenney("pot", 0.22); if (o) onTop(o); }
      if (id === "board") { const o = await kenney("cutting-board", 0.42); if (o) { o.rotation.y = Math.PI / 2; onTop(o); } const kn = await kenney("cooking-knife-chopping", 0.2); if (kn) { kn.position.set(0.17, COUNTER_Y + 0.03, 0.12); kn.rotation.y = 0.4; g.add(kn); } }
      if (id === "bowl") { const o = await kenney("bowl", 0.3); if (o) onTop(o); }
      const at = { microwave: [0.0, 0.03], blender: [0, 0.2], espresso: [0, 0.03], toaster: [0, 0.1], kettle: [0, 0.12], board: [0, 0.03], bowl: [0, 0.04] }[id] || [0, 0.02];
      const n = id === "bowl" ? 1 : id === "espresso" || id === "toaster" || id === "kettle" ? 2 : 1;
      for (let i = 0; i < n; i += 1) slots.push(new THREE.Vector3(n > 1 ? (i - 0.5) * 0.12 : at[0], COUNTER_Y + at[1], id === "espresso" ? 0.14 : 0));
    }
    if (!back) g.rotation.y = 0;
    scene.add(g);
    hit(g, { type: "station", id });
    const world = slots.map((s) => s.clone().add(new THREE.Vector3(x, 0, z)));
    return { id, group: g, x, z, w, slots: world, glow, approach: new THREE.Vector3(x, 0, back ? walk.z0 : walk.z1), facing };
  }

  // ---- storage behind: the fridge, the freezer, the dry shelves ----------------------------------------
  const storage = {};
  {
    const fridge = await furniture("kitchenFridgeLarge", { h: 1.95 });
    if (fridge) { fridge.rotation.y = Math.PI / 2; fridge.position.set(-ROOM_X + 0.42, 0, BACK_Z + 0.55); scene.add(fridge); hit(fridge, { type: "store", kept: "fridge" }); }
    const freezer = await furniture("kitchenFridgeLarge", { h: 1.95, tint: "#cfe6ff" });
    if (freezer) { freezer.rotation.y = Math.PI / 2; freezer.position.set(-ROOM_X + 0.42, 0, BACK_Z + 1.35); scene.add(freezer); hit(freezer, { type: "store", kept: "freezer" }); }
    storage.fridge = { approach: new THREE.Vector3(-ROOM_X + 1.05, 0, BACK_Z + 0.55), at: new THREE.Vector3(-ROOM_X + 0.42, 1.2, BACK_Z + 0.55) };
    storage.freezer = { approach: new THREE.Vector3(-ROOM_X + 1.05, 0, BACK_Z + 1.35), at: new THREE.Vector3(-ROOM_X + 0.42, 1.2, BACK_Z + 1.35) };
    // Shelves along the back wall above the stations, and a tall rack on the right.
    const shelfMat = S.top[0] === "steel" ? steel : std(S.cabinet);
    for (const y of [1.55, 1.95]) { const sh = box(4.6, 0.03, 0.28, shelfMat); sh.position.set(0.55, y, BACK_Z - 0.17); scene.add(sh); }
    const deco = ["bottle-oil", "soy", "can", "bag-flat", "honey", "shaker-salt", "pepper-mill", "bottle-ketchup", "carton", "can-small", "pot", "pan-stew", "plate-deep", "bowl"];
    for (let i = 0; i < 16; i += 1) { const o = await kenney(deco[i % deco.length], 0.14 + (i % 3) * 0.03); if (o) { o.position.set(-1.6 + i * 0.29, i % 2 ? 1.565 : 1.965, BACK_Z - 0.17); o.rotation.y = i; scene.add(o); } }
    const rack = new THREE.Group();
    for (let i = 0; i < 4; i += 1) { const sh = box(0.9, 0.03, 0.4, shelfMat); sh.position.y = 0.3 + i * 0.45; rack.add(sh); }
    for (const sx of [-0.44, 0.44]) for (const sz of [-0.19, 0.19]) { const post = box(0.03, 1.75, 0.03, darkSteel); post.position.set(sx, 0.875, sz); rack.add(post); }
    for (let i = 0; i < 12; i += 1) { const o = await kenney(["bag", "bag-flat", "can", "carton", "can-small", "bottle-oil"][i % 6], 0.16); if (o) { o.position.set(-0.32 + (i % 4) * 0.21, 0.315 + Math.floor(i / 4) * 0.45, 0); o.rotation.y = i * 0.7; rack.add(o); } }
    rack.rotation.y = -Math.PI / 2; rack.position.set(ROOM_X - 0.25, 0, BACK_Z + 1.3); scene.add(rack); hit(rack, { type: "store", kept: "dry" });
    storage.dry = { approach: new THREE.Vector3(ROOM_X - 0.9, 0, BACK_Z + 1.3), at: new THREE.Vector3(ROOM_X - 0.25, 1.0, BACK_Z + 1.3) };
    const bin = await furniture("trashcan", { h: 0.62 });
    if (bin) { bin.position.set(2.95, 0, FRONT_Z - 0.62); scene.add(bin); hit(bin, { type: "trash" }); }
    storage.trash = { approach: new THREE.Vector3(2.6, 0, walk.z1), at: new THREE.Vector3(2.95, 0.6, FRONT_Z - 0.62) };
  }
  // The style's lamps and touches.
  if (S.lamps === "pendant") for (let i = 0; i < 3; i += 1) {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.18, 18, 1, true), std(S.accent, { side: THREE.DoubleSide, metalness: 0.6, roughness: 0.3 })); shade.position.set(-1 + i * 1.4, 2.3, BACK_Z + 0.05); scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1cc })); bulb.position.set(-1 + i * 1.4, 2.23, BACK_Z + 0.05); scene.add(bulb);
    const l = new THREE.PointLight(0xffd59a, 4, 3.5); l.position.set(-1 + i * 1.4, 2.15, BACK_Z + 0.1); scene.add(l);
  }
  if (S.lamps === "lantern") for (let i = 0; i < 4; i += 1) {
    const lan = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshStandardMaterial({ color: S.accent, emissive: S.accent, emissiveIntensity: 0.8 })); lan.scale.y = 1.25; lan.position.set(-1.8 + i * 1.3, 2.35, BACK_Z + 0.05); scene.add(lan);
    for (const dy of [-0.17, 0.17]) { const cap = cyl(0.07, 0.07, 0.03, std(S.accent2)); cap.position.set(lan.position.x, 2.35 + dy, BACK_Z + 0.05); scene.add(cap); }
    const l = new THREE.PointLight(0xff9a6a, 2.2, 3); l.position.copy(lan.position); scene.add(l);
  }
  if (S.lamps === "panel") for (let i = 0; i < 2; i += 1) { const p = box(1.2, 0.03, 0.4, new THREE.MeshBasicMaterial({ color: 0xffffff })); p.position.set(-1 + i * 2, 2.9, 0.2); scene.add(p); }
  if (S.plants) for (const [px, pz] of [[-ROOM_X + 0.4, FRONT_Z + 0.2], [ROOM_X - 0.35, FRONT_Z - 0.1]]) { const pl = await furniture("pottedPlant", { h: 0.9 }); if (pl) { pl.position.set(px, 0, pz); scene.add(pl); } }

  // ---- the cook ---------------------------------------------------------------------------------------
  const chef = new THREE.Group();
  const jacket = std("#f6f6f2", { roughness: 0.8 }), apronMat = std(S.apron, { roughness: 0.8 }), skin = std("#d9a882"), trousers = std("#2a2d33");
  const legs = [-1, 1].map((sx) => { const l = box(0.11, 0.78, 0.12, trousers); l.position.set(sx * 0.08, 0.39, 0); chef.add(l); return l; });
  const torso = box(0.38, 0.56, 0.24, jacket); torso.position.y = 1.06; chef.add(torso);
  const apron = box(0.34, 0.6, 0.02, apronMat); apron.position.set(0, 0.88, 0.13); chef.add(apron);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 14), skin); head.position.y = 1.48; head.castShadow = true; chef.add(head);
  const hat = cyl(0.11, 0.1, 0.16, jacket); hat.position.y = 1.62; chef.add(hat);
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), jacket); puff.scale.y = 0.6; puff.position.y = 1.72; chef.add(puff);
  for (const sx of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), std("#1b1b1b")); eye.position.set(sx * 0.045, 1.5, 0.108); chef.add(eye); }
  const arms = [-1, 1].map((sx) => {
    const pivot = new THREE.Group(); pivot.position.set(sx * 0.24, 1.3, 0);
    const arm = box(0.085, 0.42, 0.09, jacket); arm.position.y = -0.2; pivot.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin); hand.position.y = -0.43; pivot.add(hand);
    chef.add(pivot); return pivot;
  });
  const holdAt = new THREE.Group(); holdAt.position.set(0, 1.12, 0.3); chef.add(holdAt);
  chef.position.set(0, 0, 0);
  scene.add(chef);
  let walkPhase = 0, chopT = 0;
  //: The cook's pose: walking (speed m/s), holding something, chopping.
  function pose(dt, { speed = 0, holding = false, chopping = false }) {
    walkPhase += dt * speed * 9;
    const swing = Math.sin(walkPhase) * Math.min(1, speed / 1.5) * 0.6;
    legs[0].rotation.x = swing; legs[1].rotation.x = -swing;
    chef.position.y = Math.abs(Math.sin(walkPhase)) * 0.02 * Math.min(1, speed);
    if (chopping) chopT = 0.25;
    chopT = Math.max(0, chopT - dt);
    if (holding) { arms[0].rotation.x = arms[1].rotation.x = -0.95; }
    else if (chopT > 0) { arms[1].rotation.x = -1.1 + Math.sin(chopT * 40) * 0.5; arms[0].rotation.x = -0.9; }
    else { arms[0].rotation.x = -swing * 0.8; arms[1].rotation.x = swing * 0.8; }
  }

  // ---- steam and sizzle -------------------------------------------------------------------------------
  const N = 260, pos = new Float32Array(N * 3), life = new Float32Array(N), vel = new Float32Array(N * 3);
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const puffs = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(puffs);
  let pi = 0;
  function emit(at, kind) {
    const i = pi = (pi + 1) % N;
    pos[i * 3] = at.x + (Math.random() - 0.5) * 0.08; pos[i * 3 + 1] = at.y + 0.03; pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.08;
    vel[i * 3] = (Math.random() - 0.5) * 0.05; vel[i * 3 + 1] = kind === "steam" ? 0.25 + Math.random() * 0.2 : 0.12 + Math.random() * 0.25; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    life[i] = kind === "steam" ? 1.6 : 0.6;
  }
  function stepPuffs(dt) {
    for (let i = 0; i < N; i += 1) {
      if (life[i] <= 0) { pos[i * 3 + 1] = -10; continue; }
      life[i] -= dt;
      for (let k = 0; k < 3; k += 1) pos[i * 3 + k] += vel[i * 3 + k] * dt;
    }
    pgeo.attributes.position.needsUpdate = true;
  }

  // ---- the camera follows the cook a little -----------------------------------------------------------
  // High over the front counter, looking down on the work surface with the back counter behind the cook.
  const CAM = { y: 4.2, z: 2.45, ly: 0.15, lz: -0.3 };
  const look = new THREE.Vector3();
  function frame(dt) {
    const tx = Math.max(-1.4, Math.min(1.4, chef.position.x * 0.5));
    camera.position.lerp(new THREE.Vector3(tx, CAM.y, CAM.z), Math.min(1, dt * 3));
    look.lerp(new THREE.Vector3(tx, CAM.ly, CAM.lz), Math.min(1, dt * 3));
    camera.lookAt(look);
  }
  camera.position.set(0, CAM.y, CAM.z); look.set(0, CAM.ly, CAM.lz); camera.lookAt(look);
  function resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
  const ray = new THREE.Raycaster();
  //: What is under the pointer at (ndc x, y): the nearest thing that answers to a click.
  function pick(nx, ny, extra = []) {
    ray.setFromCamera({ x: nx, y: ny }, camera);
    const list = ray.intersectObjects([...extra, ...hits], false);
    return list.find((h2) => h2.object.userData.hit || h2.object.userData.item) || null;
  }
  function project(v) { const p = v.clone().project(camera); return { x: (p.x + 1) / 2, y: (1 - p.y) / 2, behind: p.z > 1 }; }
  return {
    THREE, scene, camera, CAM, renderer, chef, holdAt, layout, storage, bins, setBins, passSlots, PASS, WORK, walk, style: S, COUNTER_Y,
    itemObject, tint, kenney, pose, emit, stepPuffs, frame, resize, pick, project, lit,
    render: () => renderer.render(scene, camera),
    dispose: () => { renderer.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); }); },
  };
}
