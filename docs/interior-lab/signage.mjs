// A shop's sign, as its owner sets it in the Interior Studio (lab.mjs, the Signage window) and as
// the city draws it over the door (docs/city/view.mjs): what carries the name -- an awning, the
// wall itself, a sign board, a sign out front -- how the name is lettered on it, and a line
// under it (a slogan, or what the shop sells, as a liquor store lists it). Kept on the design's
// house (house.signage), so it is saved, undone and sent with the layout, and checked again by
// the world before it is kept (normalizeSignage: nothing but what is listed here gets through).

export const SIGNAGE_SCHEMA = "kerbside.store_signage/1";
//: What carries the name.
export const SIGN_MEDIA = {
  awning: "Awning over the door",
  board: "Sign board on the building",
  painted: "Name painted on the building",
  standing: "Sign out front",
};
//: The awnings: a sloped shed awning (plain, or in stripes), a rounded dome, a flat canopy.
export const AWNING_TYPES = { sloped: "Sloped", striped: "Striped", dome: "Dome", flat: "Flat canopy" };
//: How tall the name's letters stand, in metres.
export const NAME_SIZES = { small: 0.2, medium: 0.3, large: 0.42 };
export const NAME_STYLES = {
  sans: { label: "Plain", font: "700 100px 'Helvetica Neue', Arial, sans-serif" },
  serif: { label: "Serif", font: "700 100px Georgia, 'Times New Roman', serif" },
  script: { label: "Script", font: "italic 700 100px 'Brush Script MT', 'Snell Roundhand', cursive" },
  stencil: { label: "Block capitals", font: "900 100px Impact, 'Arial Black', sans-serif", upper: true },
};
export const TAGLINE_MAX = 60, NAME_MAX = 40;
export const SIGNAGE_DEFAULT = Object.freeze({
  schema: SIGNAGE_SCHEMA, medium: "awning",
  awning: { type: "sloped", colour: "#2f5d50", stripe: "#f2efe6" },
  board: { colour: "#1f2a37" },
  name: { size: "medium", colour: "#f6f2e7", style: "sans" },
  tagline: { text: "", colour: "#f6f2e7" },
});

const colour = (v, fallback) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : fallback);
const pick = (v, table, fallback) => (typeof v === "string" && Object.hasOwn(table, v) ? v : fallback);
//: Text as it may be lettered: one line, printable, no longer than ``max``.
export function signText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
//: A sign as it is kept: every part one of the choices above, anything else put back to the
//: default. null for nothing (no sign set: the building keeps the one it was drawn with).
export function normalizeSignage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const D = SIGNAGE_DEFAULT;
  return {
    schema: SIGNAGE_SCHEMA,
    medium: pick(raw.medium, SIGN_MEDIA, D.medium),
    awning: { type: pick(raw.awning?.type, AWNING_TYPES, D.awning.type), colour: colour(raw.awning?.colour, D.awning.colour), stripe: colour(raw.awning?.stripe, D.awning.stripe) },
    board: { colour: colour(raw.board?.colour, D.board.colour) },
    name: { size: pick(raw.name?.size, NAME_SIZES, D.name.size), colour: colour(raw.name?.colour, D.name.colour), style: pick(raw.name?.style, NAME_STYLES, D.name.style) },
    tagline: { text: signText(raw.tagline?.text, TAGLINE_MAX), colour: colour(raw.tagline?.colour, colour(raw.name?.colour, D.tagline.colour)) },
  };
}
//: The same sign or not (for "changed signage" and for drawing it again only when it has).
export const sameSignage = (a, b) => JSON.stringify(normalizeSignage(a)) === JSON.stringify(normalizeSignage(b));

//: How a sign's lettering is laid out, in metres: the panel it is on -- [width, height] -- the
//: name's letter height, and the line under it (0 with none). The name is fitted to the width:
//: a long name on a narrow front is lettered smaller, never off the end.
export function signLayout(signage, name, frontage = 4.2) {
  const s = normalizeSignage(signage) || normalizeSignage({}), text = signText(name, NAME_MAX) || "Shop", line = s.tagline.text;
  const width = s.medium === "standing" ? 1.0 : Math.max(2.4, Math.min(7, frontage));
  const margin = s.medium === "standing" ? 0.08 : 0.18;
  // (A letter is about 0.62 of its height wide, a script a little less, block capitals a little more.)
  const wide = { sans: 0.6, serif: 0.6, script: 0.5, stencil: 0.56 }[s.name.style];
  const fit = (chars, height) => Math.min(height, (width - 2 * margin) / Math.max(1, chars * wide));
  const nameH = fit(text.length, s.medium === "standing" ? Math.min(0.2, NAME_SIZES[s.name.size]) : NAME_SIZES[s.name.size]);
  const tagH = line ? fit(line.length, nameH * 0.5) : 0;
  const height = nameH * 1.5 + (tagH ? tagH * 1.6 : 0);
  return { medium: s.medium, width, height: s.medium === "standing" ? Math.max(1.0, height + 0.3) : height, nameH, tagH, name: NAME_STYLES[s.name.style].upper ? text.toUpperCase() : text, tagline: line, margin };
}

//: The lettering drawn on a canvas ``w`` by ``h`` pixels standing for the layout's panel: the
//: name, and its line under it. ``ground``: the panel's own colour, or null to leave it clear
//: (lettering painted on a wall). Stripes: [a, b] for a striped awning's valance.
export function drawSign(ctx, signage, layout, w, h, { ground = null, stripes = null } = {}) {
  const s = normalizeSignage(signage) || normalizeSignage({}), px = h / layout.height;
  ctx.clearRect(0, 0, w, h);
  if (stripes) {
    const n = Math.max(6, Math.round(layout.width / 0.3));
    for (let i = 0; i < n; i += 1) { ctx.fillStyle = stripes[i % 2]; ctx.fillRect(Math.floor(i * w / n), 0, Math.ceil(w / n) + 1, h); }
    // (A band behind the lettering, so it reads over the stripes.)
    ctx.fillStyle = stripes[0]; ctx.globalAlpha = 0.86; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
  } else if (ground) { ctx.fillStyle = ground; ctx.fillRect(0, 0, w, h); }
  const font = NAME_STYLES[s.name.style].font;
  const line = (text, heightM, y, fill) => {
    const size = Math.max(6, heightM * px);
    ctx.font = font.replace("100px", `${size.toFixed(1)}px`);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = fill;
    const room = w - 2 * layout.margin * px, wide = ctx.measureText(text).width;
    ctx.save(); ctx.translate(w / 2, y);
    if (wide > room) ctx.scale(room / wide, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  const top = layout.medium === "standing" ? (layout.height - (layout.nameH * 1.5 + (layout.tagH ? layout.tagH * 1.6 : 0))) / 2 : 0;
  line(layout.name, layout.nameH, (top + layout.nameH * 0.78) * px, s.name.colour);
  if (layout.tagH) line(layout.tagline, layout.tagH * 0.9, (top + layout.nameH * 1.5 + layout.tagH * 0.7) * px, s.tagline.colour);
}

//: The sign built: a THREE.Group in the door's own frame -- x along the front, y up from the
//: pavement, z out from the wall -- with ``userData.signage`` the sign it is of. ``canvasOf(w, h)``
//: makes the canvas the lettering is drawn on (the page's; a test's stand-in).
export function buildSignage(THREE, signage, { name = "Shop", frontage = 4.2, doorHeight = 2.3, canvasOf = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }) } = {}) {
  const s = normalizeSignage(signage);
  const group = new THREE.Group();
  group.name = "store-signage";
  if (!s) return group;
  const L = signLayout(s, name, frontage);
  const lettering = (opts = {}) => {
    const hpx = 256, wpx = Math.min(2048, Math.max(256, Math.round(hpx * L.width / L.height / 64) * 64));
    const canvas = canvasOf(wpx, hpx);
    drawSign(canvas.getContext("2d"), s, L, wpx, hpx, opts);
    const map = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return new THREE.MeshLambertMaterial({ map, transparent: !opts.ground && !opts.stripes, alphaTest: !opts.ground && !opts.stripes ? 0.35 : 0, side: THREE.DoubleSide });
  };
  const flat = (hex) => new THREE.MeshLambertMaterial({ color: new THREE.Color(hex), side: THREE.DoubleSide });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = false; group.add(m); return m; };
  const top = doorHeight + 0.75;   // where a board or painted lettering stands on the wall
  if (s.medium === "awning") {
    const type = s.awning.type, out = type === "flat" ? 1.0 : 1.15, drop = type === "flat" ? 0.06 : 0.6, W = L.width;
    const cloth = flat(s.awning.colour);
    const valance = Math.max(0.3, L.height + 0.06);
    // The valance's hem clears a head under it; the awning goes up from there to the wall.
    const edge = doorHeight - 0.1 + valance, top = edge + drop;
    if (type === "dome") {
      // A quarter barrel from the wall round and down to the front edge, with its two ends.
      const n = 10, arc = [], pos = [], idx = [];
      for (let i = 0; i <= n; i += 1) { const a = (i / n) * Math.PI / 2; arc.push([edge + drop * Math.cos(a), out * Math.sin(a)]); }
      for (const [y, z] of arc) pos.push(-W / 2, y, z, W / 2, y, z);
      for (let i = 0; i < n; i += 1) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
      for (const sx of [-1, 1]) {
        const c = pos.length / 3;
        pos.push(sx * W / 2, edge, 0);
        for (const [y, z] of arc) pos.push(sx * W / 2, y, z);
        for (let i = 0; i < n; i += 1) idx.push(c, c + 1 + i, c + 2 + i);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      add(geo, cloth);
    } else if (type === "flat") {
      add(new THREE.BoxGeometry(W, 0.1, out), cloth, 0, top - 0.05, out / 2);
      // Two rods back up to the wall.
      for (const sx of [-1, 1]) { const rod = new THREE.CylinderGeometry(0.012, 0.012, Math.hypot(out * 0.8, 0.6), 5); rod.rotateX(Math.atan2(out * 0.8, 0.6)); add(rod, flat("#3a3d40"), sx * (W / 2 - 0.12), top + 0.3, out * 0.4); }
    } else {
      // A slope from the wall down and out, with its two sides.
      const slope = new THREE.PlaneGeometry(W, Math.hypot(out, drop));
      slope.rotateX(-Math.PI / 2 + Math.atan2(drop, out));
      const mat = type === "striped" ? (() => {
        const c = canvasOf(256, 64), g = c.getContext("2d"), n = Math.max(6, Math.round(W / 0.3));
        for (let i = 0; i < n; i += 1) { g.fillStyle = i % 2 ? s.awning.stripe : s.awning.colour; g.fillRect(Math.floor(i * 256 / n), 0, Math.ceil(256 / n) + 1, 64); }
        const map = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
      })() : cloth;
      add(slope, mat, 0, top - drop / 2, out / 2);
      for (const sx of [-1, 1]) {
        const side = new THREE.BufferGeometry();
        side.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, -drop, out, 0, -drop, 0], 3));
        side.computeVertexNormals();
        add(side, cloth, sx * W / 2, top, 0);
      }
    }
    // The valance across the front edge: the name is on it.
    const y = edge - valance / 2;
    const panel = add(new THREE.PlaneGeometry(W, valance), lettering(type === "striped" ? { stripes: [s.awning.colour, s.awning.stripe] } : { ground: s.awning.colour }), 0, y, out + 0.012);
    panel.userData.lettering = true;
  } else if (s.medium === "board") {
    const H = L.height + 0.16;
    add(new THREE.BoxGeometry(L.width + 0.16, H, 0.07), flat(s.board.colour), 0, top + H / 2 - 0.2, 0.05);
    add(new THREE.PlaneGeometry(L.width, L.height), lettering({ ground: s.board.colour }), 0, top + H / 2 - 0.2, 0.09).userData.lettering = true;
  } else if (s.medium === "painted") {
    add(new THREE.PlaneGeometry(L.width, L.height), lettering(), 0, top + L.height / 2 - 0.15, 0.03).userData.lettering = true;
  } else {
    // Out on the pavement by the door: a board on two legs, read from either way along the street.
    const post = flat("#2b2f33"), x = Math.min(frontage / 2, 1.5), z = 1.5, legs = 0.55;
    const board = new THREE.BoxGeometry(0.05, L.height, L.width);
    add(board, flat(s.board.colour), x, legs + L.height / 2, z);
    for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.05, legs, 0.05), post, x, legs / 2, z + sz * (L.width / 2 - 0.06));
    for (const sx of [-1, 1]) {
      const face = new THREE.PlaneGeometry(L.width, L.height);
      face.rotateY(sx * Math.PI / 2);
      add(face, lettering({ ground: s.board.colour }), x + sx * 0.03, legs + L.height / 2, z).userData.lettering = true;
    }
  }
  group.userData.signage = s;
  group.userData.layout = L;
  return group;
}
