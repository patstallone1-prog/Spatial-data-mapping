// The home screen: what the app opens on. Most visits are for the world, not to contribute, so
// this is a game's front end -- your avatar in the middle on its platform, friends' slots either
// side with a + to invite them into your world, and the big way in: Explore world. Beside it,
// Multiplayer, Customize avatar and Set spawn point. Everything else the app does (capturing
// photographs, the map's survey layers, coverage, the region's numbers) is behind Contributor
// tools, off unless you turn it on.
//
// The page hands over what it knows (``ctx``): three.js and its glTF loader, the walker's model,
// the account, multiplayer, the avatar's look and the spawn point, and what to do to enter the
// world. This module keeps the screen.
//
// The avatar is made in Customize avatar: a MakeHuman figure from docs/avatar-builder.mjs (body,
// height and build, face shape, skin, eyes, hair and its colour, facial hair, outfit, shoes, hat),
// which the page hands over as ctx.avatars; or the original Soldier. It is kept with the look.

export const LOOK_KEY = "kerbside:avatar-look";
export const LOOKS = {
  outfit: [["Standard", "#ffffff"], ["Desert", "#e7c58f"], ["Arctic", "#dfe8f0"], ["Forest", "#8fb07a"],
           ["Crimson", "#e07a72"], ["Navy", "#7f98c8"], ["Night", "#6b6f78"], ["Gold", "#f2cf63"]],
  team: [["Blaze", "#ff7a1a"], ["Volt", "#ffd21a"], ["Toxic", "#5dff6a"], ["Ice", "#3fd5ff"],
         ["Plasma", "#b46bff"], ["Rose", "#ff4f9a"], ["Steel", "#c9d3dc"]],
};
export const DEFAULT_LOOK = { outfit: "#ffffff", team: "#ff7a1a" };

export function loadLook(storage = globalThis.localStorage) {
  try {
    const look = JSON.parse(storage.getItem(LOOK_KEY) || "null");
    const ok = (v, list) => list.some(([, hex]) => hex === v);
    if (look && ok(look.outfit, LOOKS.outfit) && ok(look.team, LOOKS.team)) {
      const obj = (v) => (v && typeof v === "object" ? v : null);
      return { outfit: look.outfit, team: look.team, avatar: obj(look.avatar), lastCreator: obj(look.lastCreator) };
    }
  } catch { /* private mode, or nothing kept */ }
  return { ...DEFAULT_LOOK };
}
export function saveLook(look, storage = globalThis.localStorage) {
  try { storage.setItem(LOOK_KEY, JSON.stringify(look)); return true; } catch { return false; }
}

const FONT = "https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&display=swap";
const CSS = `
#home{position:fixed;inset:0;z-index:80;display:grid;grid-template-rows:auto 1fr auto;color:#eef3f8;
  font-family:Rajdhani,"Avenir Next Condensed","Arial Narrow",system-ui,sans-serif;letter-spacing:.02em;
  background:radial-gradient(120% 90% at 50% 62%,rgba(255,122,26,.20) 0%,rgba(10,14,22,.55) 42%,rgba(5,7,12,.92) 100%),
             linear-gradient(180deg,rgba(6,9,15,.75),rgba(6,9,15,.35) 40%,rgba(6,9,15,.85));
  backdrop-filter:blur(5px) saturate(1.1);-webkit-backdrop-filter:blur(5px) saturate(1.1);user-select:none}
#home::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.22;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.05) 0 1px,transparent 1px 4px),
             linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px) 0 0/80px 80px,
             linear-gradient(0deg,rgba(255,255,255,.06) 1px,transparent 1px) 0 0/80px 80px}
#home .top{display:flex;align-items:center;gap:16px;padding:18px 28px;position:relative}
#home .logo{font-size:34px;font-weight:700;font-style:italic;letter-spacing:.12em;text-transform:uppercase;
  background:linear-gradient(180deg,#fff 0%,#ffd7a8 55%,#ff7a1a 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 2px 0 rgba(0,0,0,.6))}
#home .logo small{display:block;font-size:12px;letter-spacing:.42em;color:#9fb0c2;-webkit-text-fill-color:#9fb0c2;font-style:normal}
#home .grow{flex:1}
#home .player{display:flex;align-items:center;gap:12px;padding:8px 16px 8px 8px;background:linear-gradient(90deg,rgba(20,28,40,.9),rgba(20,28,40,.55));
  border:1px solid rgba(255,255,255,.14);clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)}
#home .player .chip{width:42px;height:42px;display:grid;place-items:center;font-weight:700;font-size:20px;color:#10151d;
  background:var(--team);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
#home .player b{display:block;font-size:19px;line-height:1}
#home .player span{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#9fb0c2}
#home .player .ver{color:#5dff6a}
#home .stage{position:relative;display:grid;grid-template-columns:1fr minmax(260px,420px) 1fr;align-items:center;min-height:0;padding:0 28px}
#home .avatar{position:relative;height:100%;min-height:300px}
#home .avatar canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
#home .avatar .tag{position:absolute;left:50%;bottom:6%;transform:translateX(-50%);padding:4px 18px;font-size:18px;font-weight:700;
  text-transform:uppercase;letter-spacing:.14em;background:rgba(8,12,18,.75);border-bottom:3px solid var(--team);white-space:nowrap}
#home .party{display:flex;flex-direction:column;gap:18px;align-items:center}
#home .slot{width:min(150px,22vw);aspect-ratio:3/4;display:grid;place-items:center;align-content:center;gap:6px;cursor:pointer;position:relative;
  background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.02));border:2px dashed rgba(255,255,255,.28);color:#c9d6e2;
  clip-path:polygon(18px 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%,0 18px);transition:transform .15s,background .15s,border-color .15s}
#home .slot:hover,#home .slot:focus-visible{transform:translateY(-3px) scale(1.03);border-color:var(--team);background:linear-gradient(160deg,rgba(255,122,26,.22),rgba(255,255,255,.03));outline:none}
#home .slot .plus{font-size:54px;line-height:1;font-weight:700;color:var(--team);text-shadow:0 0 18px var(--team)}
#home .slot small{font-size:13px;letter-spacing:.2em;text-transform:uppercase}
#home .slot.taken{border-style:solid;border-color:rgba(255,255,255,.45);cursor:default}
#home .slot.taken .plus{font-size:30px;width:56px;height:56px;display:grid;place-items:center;color:#10151d;text-shadow:none;
  clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
#home .bottom{display:flex;align-items:flex-end;gap:18px;padding:18px 28px 26px;position:relative;flex-wrap:wrap}
#home .menu{display:flex;flex-direction:column;gap:10px;align-items:stretch;min-width:min(360px,100%)}
#home .menu .row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
#home button.hb{position:relative;border:0;cursor:pointer;color:#eef3f8;font:700 17px/1 inherit;letter-spacing:.14em;text-transform:uppercase;
  padding:14px 16px;background:linear-gradient(180deg,#2a3646,#16202c);box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -3px 0 rgba(0,0,0,.35);
  clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px);transition:transform .12s,filter .12s}
#home button.hb::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--team);opacity:.85}
#home button.hb:hover,#home button.hb:focus-visible{filter:brightness(1.25);transform:translateY(-2px);outline:none}
#home button.hb:active{transform:translateY(1px)}
#home button.hb[aria-pressed=true]{background:linear-gradient(180deg,#3a4b60,#1e2a38)}
#home button.go{font-size:34px;letter-spacing:.16em;padding:22px 36px;color:#1a1004;
  background:linear-gradient(180deg,#ffe08a 0%,#ffb13b 45%,#ff7a1a 100%);
  box-shadow:inset 0 2px 0 rgba(255,255,255,.7),inset 0 -5px 0 rgba(120,40,0,.45),0 0 34px rgba(255,122,26,.55);
  clip-path:polygon(22px 0,100% 0,100% calc(100% - 22px),calc(100% - 22px) 100%,0 100%,0 22px)}
#home button.go::after{display:none}
#home button.go small{display:block;font-size:13px;letter-spacing:.3em;margin-top:4px;color:#5a2a00}
#home .side{display:flex;flex-direction:column;gap:8px;font-size:14px;color:#9fb0c2;max-width:360px}
#home .side button{align-self:flex-start}
#home .status{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#9fb0c2}
#home .status i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#5dff6a;margin-right:6px;box-shadow:0 0 8px #5dff6a}
#home.world-loading .needs-world{opacity:.45;cursor:wait;filter:grayscale(.6)}
#home .status.loading i{background:#ffd21a;box-shadow:0 0 8px #ffd21a;animation:hblink 1s infinite}
@keyframes hblink{50%{opacity:.3}}
#home .sheet{position:absolute;right:28px;bottom:110px;width:min(420px,calc(100vw - 32px));max-height:min(70vh,640px);overflow:auto;padding:18px 18px 16px;
  background:linear-gradient(180deg,rgba(18,25,36,.97),rgba(10,14,22,.97));border:1px solid rgba(255,255,255,.14);border-top:3px solid var(--team);
  clip-path:polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px);z-index:2}
#home .sheet h3{margin:0 0 10px;font-size:22px;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center}
#home .sheet h3 span{flex:1}
#home .sheet p{margin:6px 0 10px;font-size:15px;color:#b8c6d3;letter-spacing:.01em;line-height:1.35}
#home .sheet label{display:block;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9fb0c2;margin:12px 0 6px}
#home .sheet input{width:100%;box-sizing:border-box;padding:10px 12px;font:600 17px inherit;color:#fff;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.2);outline:none}
#home .sheet input:focus{border-color:var(--team)}
#home .sheet .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
#home .sheet .x{border:0;background:none;color:#9fb0c2;font-size:24px;cursor:pointer}
#home .hsw{display:flex;flex-wrap:wrap;gap:8px}
#home .hsw button{width:40px;height:40px;border:2px solid rgba(255,255,255,.2);cursor:pointer;
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)}
#home .hsw button[aria-pressed=true]{border-color:#fff;box-shadow:inset 0 0 0 3px rgba(0,0,0,.35)}
#home .sheet.creator{width:min(460px,calc(100vw - 32px));max-height:min(78vh,760px)}
#home .htabs{display:flex;gap:4px;margin:0 0 6px;flex-wrap:wrap}
#home .htabs button{flex:1;border:0;cursor:pointer;padding:9px 6px;font:700 14px/1 inherit;letter-spacing:.14em;text-transform:uppercase;
  color:#9fb0c2;background:rgba(255,255,255,.05);border-bottom:3px solid transparent}
#home .htabs button[aria-pressed=true]{color:#fff;background:rgba(255,255,255,.1);border-bottom-color:var(--team)}
#home .hchips{display:flex;flex-wrap:wrap;gap:6px}
#home .hchips button{border:1px solid rgba(255,255,255,.2);cursor:pointer;padding:8px 11px;font:600 14px/1 inherit;letter-spacing:.06em;
  color:#dce6ef;background:rgba(255,255,255,.05)}
#home .hchips button[aria-pressed=true]{border-color:var(--team);color:#fff;background:rgba(255,255,255,.14);box-shadow:inset 0 -3px 0 var(--team)}
#home .hchips button.sw{width:34px;height:34px;padding:0}
#home .hrange{display:grid;grid-template-columns:110px 1fr;align-items:center;gap:10px;margin:4px 0}
#home .hrange span{font-size:14px;color:#c9d6e2;letter-spacing:.04em}
#home .hrange input{width:100%;padding:0;accent-color:var(--team);background:none;border:0}
#home .sheet small.credit{display:block;margin-top:14px;font-size:11px;color:#7f8fa0;letter-spacing:.02em;line-height:1.3}
#home .code{font-size:30px;font-weight:700;letter-spacing:.3em;color:var(--team)}
#home .tools{display:grid;gap:8px}
#home .tools button{text-align:left}
#home-return{position:fixed;left:16px;bottom:64px;z-index:30;border:0;cursor:pointer;color:#1a1004;font:700 14px/1 Rajdhani,system-ui,sans-serif;
  letter-spacing:.16em;text-transform:uppercase;padding:10px 16px;background:linear-gradient(180deg,#ffe08a,#ff9a2a);
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px);box-shadow:0 0 18px rgba(255,122,26,.45)}
#spawn-bar{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:31;display:flex;gap:10px;align-items:center;padding:10px 12px 10px 18px;
  color:#eef3f8;font:600 16px Rajdhani,system-ui,sans-serif;letter-spacing:.06em;background:rgba(10,14,22,.9);border-bottom:3px solid #ff7a1a;
  clip-path:polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)}
#spawn-bar button{border:0;cursor:pointer;font:700 14px Rajdhani,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:9px 14px;
  background:#ff9a2a;color:#1a1004}
#spawn-bar button.ghost{background:#2a3646;color:#eef3f8}
@media (max-width:820px){#home .stage{grid-template-columns:1fr;grid-template-rows:auto 1fr auto}#home .party{flex-direction:row}
  #home .slot{width:min(110px,26vw)} #home .bottom{flex-direction:column;align-items:stretch} #home .menu .row{grid-template-columns:1fr}
  #home button.go{font-size:26px}}
`;

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
};

let open = null;

//: The avatar on its platform: its own small renderer, the walker's model, turned by dragging.
function avatarStage(ctx, host, look) {
  const { THREE } = ctx;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 1.25, 5.4);
  camera.lookAt(0, 0.95, 0);
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x20140a, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffa04a, 2.2);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);
  // The platform: a dark disc, a glowing ring in the team's colour, and light coming up.
  const platform = new THREE.Group();
  platform.add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.12, 64),
    new THREE.MeshStandardMaterial({ color: 0x141b25, roughness: 0.4, metalness: 0.6 })));
  const ringMaterial = new THREE.MeshBasicMaterial({ color: look.team, transparent: true, opacity: 0.95 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.03, 12, 96), ringMaterial);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.065;
  platform.add(ring);
  const glowMaterial = new THREE.MeshBasicMaterial({ color: look.team, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.08, 1.6, 64, 1, true), glowMaterial);
  glow.position.y = 0.86;
  platform.add(glow);
  platform.position.y = -0.06;
  scene.add(platform);
  const turn = new THREE.Group();
  scene.add(turn);
  let model = null, mixer = null, soldier = null, figure = null, current = look, shown = 0;
  const tint = (outfit) => {
    if (model !== soldier) return;
    model?.traverse((node) => {
      if (!node.isMesh) return;
      node.material = node.material.clone();
      node.material.color.set(outfit);
    });
  };
  const outfitTint = (l) => (l.outfit && l.outfit.toLowerCase() !== "#ffffff" ? l.outfit : null);
  const creator = (l) => Boolean(ctx.avatars) && l.avatar?.model !== "soldier";
  const play = (object, clips) => {
    turn.clear();
    turn.add(object);
    model = object;
    mixer = new THREE.AnimationMixer(object);
    const idle = clips.find((a) => a.name === "Idle") || clips[0];
    if (idle) mixer.clipAction(idle).play();
  };
  // A skinned figure's own bounds are its unposed vertices in bone space (a box a fifth of its
  // height): measured from each skinned mesh's posed bounding box instead, as the page does.
  const bounds = (object) => {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    object.traverse((node) => {
      if (!node.isMesh) return;
      if (node.isSkinnedMesh) { node.computeBoundingBox(); box.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld)); }
      else box.expandByObject(node);
    });
    return box;
  };
  const showSoldier = () => {
    if (soldier) { play(soldier, soldier.userData.clips); tint(current.outfit); return; }
    new ctx.GLTFLoader().load(ctx.modelUrl, (gltf) => {
      soldier = gltf.scene;
      soldier.userData.clips = gltf.animations;
      const box = bounds(soldier);
      const height = Math.max(0.1, box.max.y - box.min.y);
      soldier.scale.setScalar(1.8 / height);
      soldier.position.y = -bounds(soldier).min.y;
      soldier.rotation.y = Math.PI;
      if (!creator(current)) { play(soldier, gltf.animations); tint(current.outfit); }
    }, undefined, () => { host.dataset.failed = "1"; });
  };
  // A creator figure faces +z and stands on its feet at its own size; the platform is sized
  // for a 1.8 m figure, so every body is drawn at that scale (a shorter body stands shorter).
  const show = async (l) => {
    const mine = ++shown;
    if (!creator(l)) { showSoldier(); return; }
    try {
      const builder = await ctx.avatars();
      if (!figure) {
        figure = await builder.build(l.avatar || {}, { outfitTint: outfitTint(l) });
        figure.holder = new THREE.Group();
        figure.holder.scale.setScalar(1.8 / 1.7);
        figure.holder.add(figure.root);
      } else {
        await figure.set(l.avatar || {}, { outfitTint: outfitTint(l) });
      }
      if (mine !== shown) return;
      if (model !== figure.holder || mixer?.getRoot() !== figure.holder || figure.clips !== figure.animations) {
        figure.clips = figure.animations;
        play(figure.holder, figure.animations);
      }
    } catch (error) {
      console.warn("Avatar creator unavailable; showing the Soldier.", error);
      if (mine === shown) showSoldier();
    }
  };
  show(look);
  let yaw = -0.35, spin = 0.0025, dragging = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { dragging = e.clientX; renderer.domElement.setPointerCapture(e.pointerId); spin = 0; });
  renderer.domElement.addEventListener("pointermove", (e) => { if (dragging === null) return; yaw += (e.clientX - dragging) * 0.012; dragging = e.clientX; });
  renderer.domElement.addEventListener("pointerup", () => { dragging = null; spin = 0.0025; });
  const clock = new THREE.Clock();
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const w = host.clientWidth, h = host.clientHeight;
    if (w && h && (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio()))) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const dt = Math.min(0.05, clock.getDelta());
    yaw += spin;
    turn.rotation.y = yaw;
    ring.material.opacity = 0.75 + 0.2 * Math.sin(performance.now() / 400);
    mixer?.update(dt);
    renderer.render(scene, camera);
  };
  frame();
  return {
    setLook(next) {
      current = next;
      ringMaterial.color.set(next.team); glowMaterial.color.set(next.team);
      if (creator(next) || model !== soldier) show(next); else tint(next.outfit);
    },
    dispose() { shown++; cancelAnimationFrame(raf); figure?.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}

export function isOpen() { return Boolean(open); }
export function close() { open?.close(); }

export function openHome(ctx) {
  if (open) return open;
  if (!document.getElementById("home-font")) document.head.append(el("link", { id: "home-font", rel: "stylesheet", href: FONT }));
  if (!document.getElementById("home-css")) document.head.append(el("style", { id: "home-css" }, CSS));
  document.getElementById("home-return")?.remove();
  let look = loadLook();
  const who = () => ctx.account?.account() || { name: null, verified: false };
  const root = el("div", { id: "home", role: "dialog", "aria-modal": "true", "aria-label": "Kerbside home", style: `--team:${look.team}` });
  const status = el("div", { class: "status loading" }, el("i"), "Loading the world…");
  const chip = el("div", { class: "chip" });
  const playerName = el("b");
  const playerSub = el("span");
  const player = el("div", { class: "player", title: "Your name and account" }, chip, el("div", {}, playerName, playerSub));
  const drawPlayer = () => {
    const a = who(), name = a.editor || a.name || "Explorer";
    chip.textContent = name.slice(0, 1).toUpperCase();
    playerName.textContent = name;
    playerSub.replaceChildren(a.verified ? el("span", { class: "ver" }, "✔ Verified editor") : "Explorer");
    tag.textContent = name;
  };
  const tag = el("div", { class: "tag" });
  const avatarBox = el("div", { class: "avatar", "aria-label": "Your avatar (drag to turn)" }, tag);
  // Party slots: four, two each side. A friend in the room takes one.
  const slots = [0, 1, 2, 3].map((i) => el("button", { class: "slot", type: "button", "aria-label": "Invite a friend into your world",
    on: { click: () => inviteSheet() } }, el("div", { class: "plus" }, "+"), el("small", {}, "Invite")));
  const drawParty = () => {
    const session = ctx.multiplayer.session();
    const others = session ? session.players() : [];
    slots.forEach((slot, i) => {
      const p = others[i];
      slot.classList.toggle("taken", Boolean(p));
      if (p) {
        slot.replaceChildren(el("div", { class: "plus", style: `background:${p.colour}` }, (p.name || "?").slice(0, 1).toUpperCase()), el("small", {}, p.name || "Friend"));
        slot.setAttribute("aria-label", `${p.name} is in your world`);
      } else {
        slot.replaceChildren(el("div", { class: "plus" }, "+"), el("small", {}, session ? "Invite" : "Add friend"));
        slot.setAttribute("aria-label", "Invite a friend into your world");
      }
    });
    mpButton.setAttribute("aria-pressed", String(Boolean(session)));
    mpButton.textContent = session ? `Party · ${session.room}` : "Multiplayer";
  };
  const stage = el("div", { class: "stage" },
    el("div", { class: "party" }, slots[0], slots[1]), avatarBox, el("div", { class: "party" }, slots[2], slots[3]));

  const sheetHost = el("div");
  const sheet = (title, ...body) => {
    const s = el("section", { class: "sheet", role: "dialog", "aria-label": title },
      el("h3", {}, el("span", {}, title), el("button", { class: "x", type: "button", title: "Close", "aria-label": "Close", on: { click: () => sheetHost.replaceChildren() } }, "×")),
      ...body);
    sheetHost.replaceChildren(s);
    return s;
  };

  const inviteSheet = async () => {
    const session = ctx.multiplayer.session();
    if (!session) return multiplayerSheet(true);
    const link = session.link();
    const copy = el("button", { class: "hb", type: "button", on: { click: async () => {
      try { await navigator.clipboard.writeText(link); copy.textContent = "Link copied"; }
      catch { prompt("Invite link", link); }
    } } }, "Copy invite link");
    const share = navigator.share ? el("button", { class: "hb", type: "button", on: { click: () => navigator.share({ title: "Join me in Kerbside", url: link }).catch(() => {}) } }, "Share…") : null;
    sheet("Invite friends", el("p", {}, "Send this link. When your friend opens it they join your party and appear in a slot here, and you see each other in the world."),
      el("div", { class: "code" }, session.room), el("div", { class: "acts" }, copy, share));
  };

  const multiplayerSheet = (thenInvite = false) => {
    const session = ctx.multiplayer.session();
    if (session) {
      const players = session.players();
      return sheet("Multiplayer", el("p", {}, `You are in party ${session.room} as ${session.me.name}. ${players.length ? `${players.length} with you.` : "Nobody else yet."}`),
        el("div", { class: "acts" },
          el("button", { class: "hb", type: "button", on: { click: () => inviteSheet() } }, "Invite"),
          el("button", { class: "hb", type: "button", on: { click: () => { ctx.multiplayer.leave(); sheetHost.replaceChildren(); drawParty(); } } }, "Leave party")));
    }
    const name = el("input", { value: who().editor || who().name || "", maxlength: 24, placeholder: "Your name", "aria-label": "Your name" });
    const code = el("input", { value: "", maxlength: 12, placeholder: "Code (empty: start a new party)", "aria-label": "Party code" });
    const go = el("button", { class: "hb", type: "button", on: { click: async () => {
      go.disabled = true; go.textContent = "Connecting…";
      ctx.account?.setName(name.value);
      try {
        await ctx.multiplayer.join(code.value, name.value);
        drawPlayer(); drawParty();
        if (thenInvite) inviteSheet(); else multiplayerSheet();
      } catch (error) {
        go.disabled = false; go.textContent = "Try again";
        sheet("Multiplayer", el("p", {}, `Could not connect: ${error.message || error}`));
      }
    } } }, "Start or join party");
    sheet("Multiplayer", el("p", {}, "Play in the same world with friends. Start a party and invite them, or type the code a friend sent you. Positions go directly between your browsers; nothing is stored."),
      el("label", {}, "Name"), name, el("label", {}, "Party code"), code, el("div", { class: "acts" }, go));
  };

  //: Customize avatar: the creator, a tab at a time. Every change shows on the platform at once
  //: and is kept; the walker takes it when the change settles.
  let creatorTab = "Body";
  const customizeSheet = async () => {
    if (!ctx.avatars) return colourSheet();
    const wait = sheet("Customize avatar", el("p", {}, "Loading the parts…"));
    let builder, cat;
    try { builder = await ctx.avatars(); cat = await builder.catalogue(); } catch { return colourSheet("The avatar parts did not load; here are the colours."); }
    if (sheetHost.firstChild !== wait) return;
    const lib = builder;
    const current = () => lib.sanitizeAvatar(look.avatar?.model === "soldier" ? { ...(look.lastCreator || {}) } : look.avatar || {}, cat);
    let settle = 0;
    const commit = (avatar, { now = false } = {}) => {
      look = { ...look, avatar };
      if (avatar.model !== "soldier") look.lastCreator = avatar;
      saveLook(look);
      stageAvatar?.setLook(look);
      clearTimeout(settle);
      settle = setTimeout(() => ctx.look?.set(look), now ? 0 : 400);
    };
    const change = (patch, opts) => { commit({ ...current(), ...patch, model: "creator" }, opts); draw(); };
    const chips = (options, value, pick, { swatch = false } = {}) => el("div", { class: "hchips" },
      options.map(([v, label, colour]) => el("button", { type: "button", "aria-pressed": String(v === value), title: label,
        class: swatch ? "sw" : "", style: swatch ? `background:${colour || v || "#555"}` : "",
        on: { click: () => pick(v) } }, swatch ? "" : label)));
    const range = (label, value, min, max, step, onInput) => {
      const input = el("input", { type: "range", min, max, step, value, "aria-label": label,
        on: { input: () => onInput(+input.value, false), change: () => onInput(+input.value, true) } });
      return el("div", { class: "hrange" }, el("span", {}, label), input);
    };
    const shape = (id) => (v, done) => {
      const a = current();
      commit({ ...a, model: "creator", sliders: { ...a.sliders, [id]: v } }, { now: done });
    };
    const items = (slot, a) => cat.items.filter((i) => i.slot === slot && i.files[a.body]).map((i) => [i.id, i.label]);
    const skinLabel = (n) => n.replace(/_(male|female)$/, "").replace("middleage", "middle-aged").replace(/_/g, " ").replace("2", " II");
    const tabs = {
      Body: (a) => [
        el("label", {}, "Body"), chips([["male", "Male"], ["female", "Female"]], a.body, (body) => {
          commit({ ...lib.defaultAvatar(body), sliders: a.sliders, height: a.height, head: a.head, head_amount: a.head_amount, eyes: a.eyes, hair_colour: a.hair_colour });
          draw();
        }),
        el("label", {}, "Build"),
        range("Height", a.height, lib.HEIGHT_RANGE[0], lib.HEIGHT_RANGE[1], 0.01, (v, done) => commit({ ...current(), model: "creator", height: v }, { now: done })),
        ...lib.SLIDERS.Body.map(([id, label, two]) => range(label, a.sliders[id] || 0, two ? -1 : 0, 1, 0.05, shape(id))),
        el("label", {}, "Skin"), chips(cat.skins[a.body].map((n) => [n, skinLabel(n)]), a.skin, (skin) => change({ skin })),
        el("label", {}, "Look"), el("div", { class: "acts" },
          el("button", { class: "hb", type: "button", on: { click: () => change(randomAvatar(a.body)) } }, "Randomise"),
          el("button", { class: "hb", type: "button", on: { click: () => change(lib.defaultAvatar(a.body)) } }, "Reset"),
          el("button", { class: "hb", type: "button", "aria-pressed": "false", on: { click: () => {
            commit({ model: "soldier" }, { now: true }); draw();
          } } }, "Use the Soldier")),
      ],
      Face: (a) => [
        el("label", {}, "Head shape"), chips(lib.HEAD_SHAPES, a.head, (head) => change({ head })),
        a.head ? range("Strength", a.head_amount, 0, 1, 0.05, (v, done) => commit({ ...current(), model: "creator", head_amount: v }, { now: done })) : null,
        el("label", {}, "Face"), ...lib.SLIDERS.Face.map(([id, label, two]) => range(label, a.sliders[id] || 0, two ? -1 : 0, 1, 0.05, shape(id))),
        el("label", {}, "Features"), ...lib.SLIDERS.Features.map(([id, label, two]) => range(label, a.sliders[id] || 0, two ? -1 : 0, 1, 0.05, shape(id))),
        el("label", {}, "Eye colour"), chips(Object.keys(cat.eye_files).map((c) => [c, c.replace("light", " light").replace("bluegreen", "blue-green")]), a.eyes, (eyes) => change({ eyes })),
      ],
      Hair: (a) => [
        el("label", {}, "Hair"), chips([["", "None"], ...items("hair", a)], a.hair, (hair) => change({ hair })),
        el("label", {}, "Hair colour"), chips(lib.HAIR_COLOURS.map(([hex, label]) => [hex, label, hex || "linear-gradient(135deg,#3b2618,#a8763f)"]), a.hair_colour, (hair_colour) => change({ hair_colour }), { swatch: true }),
        el("label", {}, "Facial hair"), chips([["", "None"], ...items("facial_hair", a)], a.facial_hair, (facial_hair) => change({ facial_hair })),
        el("label", {}, "Eyebrows"), chips(items("eyebrows", a), a.eyebrows, (eyebrows) => change({ eyebrows })),
      ],
      Outfit: (a) => [
        el("label", {}, "Outfit"), chips(items("outfit", a), a.outfit, (outfit) => change({ outfit })),
        el("label", {}, "Outfit colour"), swatches("outfit"),
        el("label", {}, "Shoes"), chips([["", "Barefoot"], ...items("shoes", a)], a.shoes, (shoes) => change({ shoes })),
        el("label", {}, "Hat"), chips([["", "None"], ...items("hat", a)], a.hat, (hat) => change({ hat })),
      ],
      Name: () => [
        el("label", {}, "Name"), nameInput(), el("label", {}, "Team colour"), swatches("team"),
        el("p", {}, "Your friends see your name over your walker."),
      ],
    };
    const randomAvatar = (body) => {
      const pick = (list) => list[Math.floor(Math.random() * list.length)];
      const a = lib.defaultAvatar(body);
      const opt = (slot, chance) => (Math.random() < chance ? pick(items(slot, a))?.[0] || "" : "");
      const sliders = {};
      for (const [id, , two] of Object.values(lib.SLIDERS).flat()) sliders[id] = +((two ? Math.random() * 2 - 1 : Math.random()) * 0.7).toFixed(2);
      return { ...a, sliders, skin: pick(cat.skins[body]), eyes: pick(Object.keys(cat.eye_files)),
        height: +(lib.HEIGHT_RANGE[0] + Math.random() * (lib.HEIGHT_RANGE[1] - lib.HEIGHT_RANGE[0])).toFixed(2),
        head: pick(lib.HEAD_SHAPES)[0], head_amount: +(0.3 + Math.random() * 0.6).toFixed(2),
        hair: opt("hair", 0.92), hair_colour: pick(lib.HAIR_COLOURS)[0], facial_hair: body === "male" ? opt("facial_hair", 0.45) : "",
        eyebrows: pick(items("eyebrows", a))[0], outfit: pick(items("outfit", a))[0], shoes: pick(items("shoes", a))[0], hat: opt("hat", 0.15) };
    };
    const draw = () => {
      const soldierOn = look.avatar?.model === "soldier";
      const a = current();
      const body = soldierOn && creatorTab !== "Name"
        ? [el("p", {}, "You are the Soldier. Make your own figure instead:"),
           el("div", { class: "acts" }, el("button", { class: "hb", type: "button", on: { click: () => change({}) } }, "Use my figure"))]
        : tabs[creatorTab](a);
      const s = sheet("Customize avatar",
        el("div", { class: "htabs", role: "tablist" }, Object.keys(tabs).map((t) => el("button", { type: "button", role: "tab",
          "aria-pressed": String(t === creatorTab), on: { click: () => { creatorTab = t; draw(); } } }, t))),
        ...body, el("small", { class: "credit" }, `Figures: ${cat.credit}`));
      s.classList.add("creator");
    };
    draw();
  };

  const nameInput = () => {
    const name = el("input", { value: who().editor || who().name || "", maxlength: 24, placeholder: "Your name", "aria-label": "Your name",
      on: { change: () => { ctx.account?.setName(name.value); drawPlayer(); } } });
    return name;
  };
  const swatches = (kind) => el("div", { class: "hsw", role: "group", "aria-label": kind },
    LOOKS[kind].map(([label, hex]) => el("button", { type: "button", title: label, "aria-label": label, "aria-pressed": String(look[kind] === hex),
      style: `background:${hex}`, on: { click: (e) => {
        look = { ...look, [kind]: hex };
        saveLook(look);
        stageAvatar?.setLook(look);
        ctx.look?.set(look);
        root.style.setProperty("--team", look.team);
        for (const b of e.currentTarget.parentNode.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
      } } })));

  //: Without the creator (the page gave no avatars, or its parts did not load): name and colours.
  const colourSheet = (note) => {
    sheet("Customize avatar", el("p", {}, note || "Your name and colours, here and in the world. Your friends see your name over your walker."),
      el("label", {}, "Name"), nameInput(), el("label", {}, "Outfit"), swatches("outfit"), el("label", {}, "Team colour"), swatches("team"));
  };

  const spawnSheet = () => {
    const current = ctx.spawn.get();
    const label = current ? current.label || `${current.lat.toFixed(5)}, ${current.lon.toFixed(5)}` : "The middle of the area (default)";
    sheet("Set spawn point", el("p", {}, "Where Explore world puts you. ", el("b", {}, `Now: ${label}`)),
      el("div", { class: "tools" },
        el("button", { class: "hb needs-world", type: "button", on: { click: () => { if (closeHome()) ctx.spawn.pickInWorld(); } } }, "Choose in the world…"),
        el("button", { class: "hb", type: "button", on: { click: () => { ctx.spawn.useWalker(); spawnSheet(); } } }, "Where my walker is now"),
        el("button", { class: "hb", type: "button", disabled: !current, on: { click: () => { ctx.spawn.clear(); spawnSheet(); } } }, "Back to the default")));
  };

  const toolsSheet = () => {
    const on = ctx.contributor.get();
    const toggle = el("button", { class: "hb", type: "button", "aria-pressed": String(on), on: { click: () => {
      ctx.contributor.set(!ctx.contributor.get());
      toolsSheet();
    } } }, on ? "Contributor tools: on" : "Contributor tools: off");
    sheet("Contributor tools", el("p", {}, "For people helping to build the map: the survey layers (coverage, photographs, sequences, measured kerbs), the region's numbers, and the capture app. Most visits don't need them."),
      el("div", { class: "tools" }, toggle,
        el("button", { class: "hb needs-world", type: "button", on: { click: () => { if (closeHome()) ctx.openMap(); } } }, "Map, search and directions"),
        el("button", { class: "hb needs-world", type: "button", on: { click: () => { if (closeHome()) ctx.openSettings(); } } }, "Settings and layers"),
        el("button", { class: "hb", type: "button", on: { click: () => ctx.openCapture() } }, "Capture photographs (opens the capture app)")));
  };

  const mpButton = el("button", { class: "hb", type: "button", on: { click: () => multiplayerSheet() } }, "Multiplayer");
  const go = el("button", { class: "hb go needs-world", type: "button", "aria-disabled": "true", on: { click: () => closeHome(true) } }, "Explore world", el("small", {}, ctx.regionTitle || "The Bay Area"));
  const bottom = el("div", { class: "bottom" },
    el("div", { class: "side" }, status,
      el("button", { class: "hb", type: "button", on: { click: () => toolsSheet() } }, "Contributor tools")),
    el("div", { class: "grow" }),
    el("div", { class: "menu" }, go,
      el("div", { class: "row" }, mpButton,
        el("button", { class: "hb", type: "button", on: { click: () => customizeSheet() } }, "Customize avatar"),
        el("button", { class: "hb", type: "button", on: { click: () => spawnSheet() } }, "Set spawn point"))));
  root.append(el("div", { class: "top" }, el("div", { class: "logo" }, "Kerbside", el("small", {}, "The Bay Area, down to the kerb")), el("div", { class: "grow" }), player),
    stage, bottom, sheetHost);
  document.body.append(root);
  const stageAvatar = avatarStage(ctx, avatarBox, look);
  drawPlayer();
  const unsubscribe = ctx.account?.onAccountChange(drawPlayer);
  const offParty = ctx.multiplayer.onChange(drawParty);
  drawParty();
  const keys = (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "Enter" && !sheetHost.firstChild) { e.preventDefault(); closeHome(true); }
    else if (e.key === "Escape") { if (sheetHost.firstChild) sheetHost.replaceChildren(); }
  };
  addEventListener("keydown", keys, true);
  // Nothing leaves the lobby for the world until the world is loaded through -- every square
  // round the spawn fetched and built, the walker and what stops it in -- not merely drawn.
  const ready = ctx.whenReady?.() || Promise.resolve();
  let loaded = false;
  root.classList.add("world-loading");
  // Until it is ready, the world's own progress line: it loads behind the lobby from the start.
  const progress = setInterval(() => {
    const line = ctx.progress?.();
    if (line && status.classList.contains("loading")) status.replaceChildren(el("i"), line.slice(0, 64));
  }, 400);
  ready.then(() => {
    loaded = true;
    root.classList.remove("world-loading");
    go.removeAttribute("aria-disabled");
    clearInterval(progress); status.className = "status"; status.replaceChildren(el("i"), "World ready");
  });
  go.focus();

  //: Returns whether the lobby closed: not while the world is still loading.
  function closeHome(enter = false) {
    if (!open || !loaded) return false;
    open = null;
    removeEventListener("keydown", keys, true);
    clearInterval(progress);
    unsubscribe?.(); offParty?.();
    stageAvatar.dispose();
    root.remove();
    const back = el("button", { id: "home-return", type: "button", title: "Back to the home screen", on: { click: () => openHome(ctx) } }, "⌂ Home");
    document.body.append(back);
    ctx.onClose?.({ enter });
    return true;
  }
  open = { close: () => closeHome(false), root };
  ctx.onOpen?.();
  return open;
}

//: The bar shown while choosing a spawn point in the world.
export function spawnBar({ onSet, onCancel }) {
  document.getElementById("spawn-bar")?.remove();
  if (!document.getElementById("home-css")) document.head.append(el("style", { id: "home-css" }, CSS));
  const bar = el("div", { id: "spawn-bar", role: "status" }, "Walk or click to where you want to start, then",
    el("button", { type: "button", on: { click: () => { bar.remove(); onSet(); } } }, "Set spawn here"),
    el("button", { class: "ghost", type: "button", on: { click: () => { bar.remove(); onCancel?.(); } } }, "Cancel"));
  document.body.append(bar);
  return bar;
}
