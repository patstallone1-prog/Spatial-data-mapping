// Play together: other people's walkers in the same world, with no server of Kerbside's own.
//
// A room is a short code anyone can share as a link (?room=CODE). Everyone in it sends where
// their walker is about ten times a second to everyone else, and draws the others' walkers from
// what arrives. Two ways the messages travel, both serverless for Kerbside:
//
// * between tabs of one browser, over a BroadcastChannel -- always on, and how this is tested;
// * between devices, peer to peer over WebRTC (Trystero). The peers find each other through
//   public Nostr relays, which pass only the encrypted handshake (the room code is its password);
//   positions then go directly between browsers. Each peer sees the others' network addresses,
//   as with any WebRTC call -- said in the panel before anyone joins.
//
// Positions travel as longitude and latitude, so a walker on the corridor and one on a region's
// own page meet at the same street corner; height travels as feet above the sender's ground and
// is set on the receiver's. Nothing is stored anywhere: leave the room and it is gone.

export const SCHEMA = 1;
export const SEND_HZ = 10;
//: A peer not heard from for this long has gone (closed the tab, lost the network).
export const PEER_TIMEOUT_MS = 6000;
//: Remote walkers are drawn this far in the past, between two positions already received.
export const INTERP_DELAY_MS = 150;
// jsDelivr's bundled build: the package's own file imports bare names a browser cannot resolve.
const TRYSTERO = "https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.25.4/+esm";
const APP_ID = "kerbside-world";
const COLOURS = ["#c0392b", "#2471a3", "#1e8449", "#b9770e", "#7d3c98", "#117a65", "#a04000", "#2e4053"];

//: A room code: six letters and digits without look-alikes (no 0/O, 1/I/L).
export function newRoomCode(random = Math.random) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
}

export function cleanRoomCode(text) {
  const code = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return code.length >= 4 ? code : null;
}

export function cleanName(text) {
  return String(text || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24) || null;
}

export function colourFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLOURS[h % COLOURS.length];
}

//: A received message, or null when it is not one: everything off the wire is checked.
export function readState(m) {
  if (!m || m.v !== SCHEMA || typeof m.id !== "string" || m.id.length > 64) return null;
  if (m.bye) return { id: m.id, bye: true };
  const finite = (x) => typeof x === "number" && Number.isFinite(x);
  if (!finite(m.lon) || !finite(m.lat) || Math.abs(m.lon) > 180 || Math.abs(m.lat) > 90) return null;
  return {
    id: m.id, name: cleanName(m.name) || "Walker", lon: m.lon, lat: m.lat,
    feet: finite(m.feet) ? m.feet : null, above: finite(m.above) ? Math.max(-2, Math.min(50, m.above)) : 0,
    yaw: finite(m.yaw) ? m.yaw : 0, moving: Boolean(m.moving), stairs: Boolean(m.stairs),
    page: typeof m.page === "string" ? m.page.slice(0, 200) : "", seq: finite(m.seq) ? m.seq : 0,
  };
}

//: Where a remote walker is drawn at ``t``: between the two samples either side of it, or the
//: last one held (never guessed forward, so a stopped walker does not overshoot).
export function sampleAt(samples, t) {
  if (!samples.length) return null;
  if (t <= samples[0].t) return samples[0];
  for (let i = samples.length - 1; i > 0; i -= 1) {
    const a = samples[i - 1], b = samples[i];
    if (t >= a.t && t <= b.t) {
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      let dy = b.yaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
        yaw: a.yaw + dy * k, moving: b.moving, stairs: b.stairs };
    }
  }
  return samples[samples.length - 1];
}

// ---- transports --------------------------------------------------------------------------------

function tabTransport(room, onMessage) {
  if (typeof BroadcastChannel !== "function") return null;
  const channel = new BroadcastChannel(`kerbside-room:${room}`);
  channel.onmessage = (e) => onMessage(e.data);
  return { name: "this browser", send: (m) => channel.postMessage(m), close: () => channel.close() };
}

async function peerTransport(room, onMessage, onPeers, load = (url) => import(url)) {
  const { joinRoom } = await load(TRYSTERO);
  const net = joinRoom({ appId: APP_ID, password: room }, room);
  const action = net.makeAction("walker");
  const peers = new Set();
  action.onMessage = (data) => onMessage(data);
  net.onPeerJoin = (id) => { peers.add(id); onPeers(peers.size); };
  net.onPeerLeave = (id) => { peers.delete(id); onPeers(peers.size); };
  return { name: "online", send: (m) => action.send(m), close: () => net.leave(), peers: () => peers.size };
}

// ---- the session -------------------------------------------------------------------------------

//: ``ctx`` is the page: THREE, root (where walkers are added), buildAvatar(), avatarScale, standY,
//: me() -> {x, z, feet, yaw, moving, stairs}, toLonLat(x, z), fromLonLat(lon, lat),
//: groundAt(x, z), page (this page's path), requestFrame().
export async function join(ctx, { room, name, online = true, now = () => performance.now(),
  random = Math.random, load } = {}) {
  const code = cleanRoomCode(room);
  if (!code) throw new Error("a room code is four to twelve letters or digits");
  const id = Array.from({ length: 4 }, () => Math.floor(random() * 0x10000).toString(16).padStart(4, "0")).join("");
  const peers = new Map();
  const listeners = new Set();
  const transports = [];
  let seq = 0, lastSent = 0, lastKey = "", status = "", closed = false;
  const me = { id, name: cleanName(name) || "Walker", colour: colourFor(id) };
  const changed = () => { for (const f of listeners) f(session.players()); };

  const receive = (raw) => {
    const m = readState(raw);
    if (!m || m.id === id || closed) return;
    if (m.bye) { drop(m.id); return; }
    let peer = peers.get(m.id);
    if (!peer) {
      peer = { id: m.id, name: m.name, colour: colourFor(m.id), samples: [], seq: -1, avatar: makeWalker(ctx, m.id, m.name) };
      peers.set(m.id, peer);
      ctx.root.add(peer.avatar);
      changed();
    }
    if (m.seq <= peer.seq) return; // the same message by both routes, or out of order
    peer.seq = m.seq;
    if (m.name !== peer.name) { peer.name = m.name; relabel(ctx, peer); changed(); }
    const [x, z] = ctx.fromLonLat(m.lon, m.lat);
    // Same page: the sender's own height. Elsewhere: on this page's ground, as high above it.
    const feet = m.page === ctx.page && m.feet !== null ? m.feet : (ctx.groundAt(x, z) ?? 0) + m.above;
    peer.heard = now();
    peer.samples.push({ t: peer.heard, x, y: feet, z, yaw: m.yaw, moving: m.moving, stairs: m.stairs });
    if (peer.samples.length > 20) peer.samples.splice(0, peer.samples.length - 20);
    ctx.requestFrame?.();
  };

  const drop = (peerId) => {
    const peer = peers.get(peerId);
    if (!peer) return;
    peers.delete(peerId);
    peer.avatar.parent?.remove(peer.avatar);
    peer.avatar.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose?.(); });
    changed();
  };

  const tab = tabTransport(code, receive);
  if (tab) transports.push(tab);
  if (online) {
    status = "connecting";
    try {
      transports.push(await peerTransport(code, receive, () => changed(), load));
      status = "online";
    } catch (error) {
      status = `online unavailable (${error.message || error}); this browser's tabs only`;
    }
  }

  const send = (message) => { for (const t of transports) { try { t.send(message); } catch { /* a closed peer */ } } };

  const session = {
    room: code, me, get status() { return status; },
    link(base = globalThis.location?.href || "") {
      const url = new URL(base);
      url.searchParams.set("room", code);
      return url.href;
    },
    players() {
      return [...peers.values()].map((p) => ({ id: p.id, name: p.name, colour: p.colour,
        at: p.samples.length ? { x: p.samples.at(-1).x, z: p.samples.at(-1).z } : null }));
    },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
    rename(text) { me.name = cleanName(text) || me.name; lastKey = ""; },
    //: Each frame: send this walker when due, move the others. True while anyone is moving, so
    //: the page keeps drawing at its full rate.
    tick(t = now()) {
      if (closed) return false;
      const here = ctx.me();
      if (here) {
        const [lon, lat] = ctx.toLonLat(here.x, here.z);
        const ground = ctx.groundAt(here.x, here.z);
        const message = { v: SCHEMA, id, name: me.name, lon: +lon.toFixed(7), lat: +lat.toFixed(7),
          feet: +here.feet.toFixed(2), above: ground === null || ground === undefined ? 0 : +(here.feet - ground).toFixed(2),
          yaw: +here.yaw.toFixed(3), moving: Boolean(here.moving), stairs: Boolean(here.stairs), page: ctx.page };
        const key = `${message.lon},${message.lat},${message.feet},${message.yaw},${message.moving},${me.name}`;
        // Ten a second while anything changes; once a second otherwise, so a new peer sees us.
        if ((key !== lastKey && t - lastSent >= 1000 / SEND_HZ) || t - lastSent >= 1000) {
          message.seq = ++seq;
          send(message);
          lastSent = t;
          lastKey = key;
        }
      }
      let moving = false;
      for (const peer of [...peers.values()]) {
        if (t - peer.heard > PEER_TIMEOUT_MS) { drop(peer.id); continue; }
        const s = sampleAt(peer.samples, t - INTERP_DELAY_MS);
        if (!s) continue;
        peer.avatar.position.set(s.x, ctx.standY + s.y, s.z);
        peer.avatar.rotation.y = s.yaw;
        animateWalker(peer.avatar, s.moving, s.stairs, t);
        moving ||= s.moving || t - peer.heard < INTERP_DELAY_MS * 2;
      }
      return moving;
    },
    leave() {
      if (closed) return;
      send({ v: SCHEMA, id, bye: true });
      closed = true;
      for (const peerId of [...peers.keys()]) drop(peerId);
      for (const t of transports) t.close();
      listeners.clear();
    },
  };
  return session;
}

// ---- the other walkers ---------------------------------------------------------------------------

function makeWalker(ctx, id, name) {
  const { THREE } = ctx;
  const walker = ctx.buildAvatar();
  walker.name = `remote-walker:${id}`;
  walker.scale.setScalar(ctx.avatarScale || 1);
  // Their own colour on the jacket, so two people are told apart at a glance.
  const colour = new THREE.Color(colourFor(id));
  walker.traverse((o) => {
    if (o.isMesh && /torso|shoulders|arm/.test(o.name || "") && o.material?.color) {
      o.material = o.material.clone();
      o.material.color.copy(colour);
    }
  });
  walker.userData.remote = true;
  walker.userData.label = makeLabel(THREE, name, colourFor(id));
  walker.add(walker.userData.label);
  return walker;
}

function makeLabel(THREE, name, colour) {
  const canvas = globalThis.document?.createElement("canvas");
  if (!canvas) return new THREE.Object3D();
  canvas.width = 256; canvas.height = 64;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(20,24,28,.78)";
  g.beginPath(); g.roundRect?.(4, 8, 248, 48, 22); g.fill();
  g.fillStyle = colour; g.beginPath(); g.arc(30, 32, 10, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.font = "600 26px system-ui,sans-serif"; g.textBaseline = "middle";
  g.fillText(name, 50, 33, 196);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false }));
  sprite.scale.set(1.0, 0.25, 1);
  sprite.position.set(0, 1.15, 0);
  sprite.name = "remote-walker-label";
  return sprite;
}

function relabel(ctx, peer) {
  const old = peer.avatar.userData.label;
  old.parent?.remove(old);
  old.material?.map?.dispose?.();
  peer.avatar.userData.label = makeLabel(ctx.THREE, peer.name, peer.colour);
  peer.avatar.add(peer.avatar.userData.label);
}

function animateWalker(walker, moving, stairs, t) {
  const u = walker.userData;
  const swing = moving ? Math.sin(t / 1000 * (stairs ? 7 : 9)) * (stairs ? 0.85 : 0.58) : 0;
  if (u.leftLeg) u.leftLeg.rotation.x = swing;
  if (u.rightLeg) u.rightLeg.rotation.x = -swing;
  if (u.leftArm) u.leftArm.rotation.x = -swing * 0.8;
  if (u.rightArm) u.rightArm.rotation.x = swing * 0.8;
}

// ---- the panel ----------------------------------------------------------------------------------

const CSS = `
#mp{position:fixed;left:12px;bottom:12px;z-index:35;width:min(300px,calc(100vw - 24px));background:var(--panel,#fff);
  color:var(--ink,#16202a);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);font:13px/1.4 system-ui,sans-serif;padding:12px}
#mp h3{margin:0 0 6px;font-size:14px;display:flex;align-items:center;gap:8px}#mp h3 span{flex:1}
#mp .note{color:#5c6770;font-size:12px;margin:6px 0}
#mp input{width:100%;box-sizing:border-box;border:1px solid rgba(0,0,0,.2);border-radius:8px;padding:6px 8px;font:inherit;margin:3px 0}
#mp button{border:1px solid rgba(0,0,0,.18);background:#f6f7f8;color:inherit;border-radius:8px;padding:5px 9px;font:inherit;cursor:pointer}
#mp button.primary{background:#1f6feb;color:#fff;border-color:#1f6feb}
#mp .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
#mp ul{list-style:none;margin:6px 0 0;padding:0;max-height:160px;overflow:auto}
#mp li{display:flex;align-items:center;gap:8px;padding:3px 0}#mp li i{width:10px;height:10px;border-radius:50%}
#mp li b{flex:1;font-weight:600}
#mp code{font-size:15px;letter-spacing:.12em}
@media (prefers-color-scheme:dark){#mp{--panel:#1d2329;--ink:#e6edf3}#mp button{background:#2a3138;border-color:#3d4650}#mp .note{color:#9aa6b1}
  #mp input{background:#11161b;color:inherit;border-color:#3d4650}}`;

//: The "Play together" panel. ``ui`` is the page: goTo(x, z) walks the view there.
export function openPanel(ctx, ui, { room: invited = null, storage = globalThis.localStorage } = {}) {
  const doc = globalThis.document;
  if (!doc.getElementById("mp-style")) doc.head.append(Object.assign(doc.createElement("style"), { id: "mp-style", textContent: CSS }));
  doc.getElementById("mp")?.remove();
  const box = Object.assign(doc.createElement("section"), { id: "mp" });
  box.setAttribute("aria-label", "Play together");
  doc.body.append(box);
  let saved = "";
  try { saved = storage?.getItem("kerbside:mp-name") || ""; } catch { /* private mode */ }
  const h = (tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); e.append(...kids); return e; };
  const close = h("button", { textContent: "×", title: "Close", onclick: () => box.remove() });

  const lobby = () => {
    const nameIn = h("input", { value: saved, placeholder: "Your name", maxLength: 24 });
    const roomIn = h("input", { value: invited || "", placeholder: "Room code (or leave empty for a new room)", maxLength: 12 });
    const go = h("button", { className: "primary", textContent: invited ? "Join room" : "Start or join", onclick: async () => {
      const name = cleanName(nameIn.value) || "Walker";
      try { storage?.setItem("kerbside:mp-name", name); } catch { /* private mode */ }
      go.disabled = true; go.textContent = "Connecting…";
      try {
        ui.session = await join(ctx, { room: cleanRoomCode(roomIn.value) || newRoomCode(), name });
        ui.onJoin?.(ui.session);
        inRoom(ui.session);
      } catch (error) { go.disabled = false; go.textContent = "Try again"; ui.notify?.(String(error.message || error)); }
    } });
    box.replaceChildren(h("h3", {}, h("span", { textContent: "Play together" }), close),
      h("p", { className: "note", textContent: "Walk the same streets with friends: share the room's link and you see each other's walkers. Positions go directly between your browsers (they see each other's network address, as in any video call); nothing is stored." }),
      nameIn, roomIn, h("div", { className: "row" }, go));
  };

  const inRoom = (session) => {
    const list = h("ul");
    const draw = (players) => {
      list.replaceChildren(...(players.length ? players.map((p) => h("li", {},
        h("i", { style: `background:${p.colour}` }), h("b", { textContent: p.name }),
        h("button", { textContent: "Go to", disabled: !p.at, onclick: () => p.at && ui.goTo?.(p.at.x, p.at.z) })))
        : [h("li", { className: "note", textContent: "Nobody else here yet. Send them the link." })]));
    };
    session.onChange(draw);
    draw(session.players());
    const copy = h("button", { className: "primary", textContent: "Copy invite link", onclick: async () => {
      try { await navigator.clipboard.writeText(session.link()); copy.textContent = "Copied"; }
      catch { prompt("Invite link", session.link()); }
    } });
    const leave = h("button", { textContent: "Leave", onclick: () => { session.leave(); ui.session = null; ui.onLeave?.(); lobby(); } });
    box.replaceChildren(h("h3", {}, h("span", {}, "Room ", h("code", { textContent: session.room })), close),
      h("p", { className: "note", textContent: `You are ${session.me.name}. ${session.status === "online" ? "Online" : session.status}.` }),
      list, h("div", { className: "row" }, copy, leave));
  };

  if (ui.session) inRoom(ui.session); else lobby();
  return box;
}
