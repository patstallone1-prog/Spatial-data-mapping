// kerbfront.building/1 -> a three.js group. Local model x east / y north becomes scene x / -z,
// exactly as Kerbside's own renderer does. The storefront band is mounted by the app's renderer
// (./kerbside/renderer.mjs, vendored unchanged); everything else is drawn here.
//
// Every pickable mesh carries userData.sel = {type, ...ids} so the editor can select it.

import {createExteriorRenderer} from './kerbside/renderer.mjs';
import {createFinishes} from './materials.mjs';

export function wallFrame(model, i) {
  const ring = model.footprint, a = ring[i], b = ring[(i + 1) % ring.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  return {a, b, L, t, n: [t[1], -t[0]]}; // counter-clockwise ring: outward is the right hand
}

export function faceMatrix(THREE, f, lift = 0) {
  return new THREE.Matrix4().set(
    f.t[0], 0, f.n[0], f.a[0],
    0, 1, 0, lift,
    -f.t[1], 0, -f.n[1], -f.a[1],
    0, 0, 0, 1);
}

/** The model's storefronts as an smc.exteriors plan, for the app's renderer. */
export function toPlan(model) {
  return {
    id: model.id, schema: 'kerbside.inferred_exterior/1', validation: {passed: true}, evidence: {},
    references: [],
    facades: model.storefronts.filter(sf => sf.visible !== false).map(sf => {
      const f = wallFrame(model, sf.edge);
      return {
        id: sf.id, name: sf.name, category: sf.category || 'restaurant', brand: sf.brand || null,
        a: f.a, b: f.b, normal: f.n, u0: sf.u0, u1: sf.u1, band_height_m: sf.band_h,
        palette: sf.palette, material: sf.material, door_style: sf.door_style || null,
        portal_colour: sf.portal_colour || null, economics: {tier: sf.tier || 'standard'},
        identity_band: sf.identity_band || null, observed_bands: sf.observed_bands || [],
        openings: (sf.openings || []).map(o => ({...o, component_kind: o.kind === 'door' ? 'door' : o.kind === 'garage' ? 'garage' : 'window'})),
        signs: (sf.signs || []).filter(s => s.kind !== 'awning_valance' && s.visible !== false),
      };
    }),
  };
}

function textPlane(THREE, text, {ink = '#ffffff', bg = null, font = 'Georgia, serif', weight = 700, w = 2, h = 0.3, italic = false}) {
  const c = document.createElement('canvas'), px = Math.max(64, Math.min(2048, Math.round(w * 220)));
  c.width = px; c.height = Math.max(16, Math.round(px * h / w));
  const g = c.getContext('2d');
  if (bg) {g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);}
  let size = c.height * 0.72; g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
  while (g.measureText(text).width > c.width * 0.94 && size > 6) {size -= 1; g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;}
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({map: tex, transparent: !bg, alphaTest: bg ? 0 : 0.05, roughness: 0.6, side: THREE.DoubleSide});
}

/** A sign face drawn from layers (fractions of the sign's box) -- logos as vectors, no artwork
 *  copied: rect, roundrect, circle, halfdisc, ring, text. Without layers: centred text. */
export function signArt(THREE, s, fallbackText) {
  const w = s.w || 1, h = s.h || 0.4, c = document.createElement('canvas');
  const px = Math.max(96, Math.min(2048, Math.round(Math.max(w, h) * 260)));
  c.width = Math.max(16, Math.round(px * Math.min(1, w / h))); c.height = Math.max(16, Math.round(px * Math.min(1, h / w)));
  const g = c.getContext('2d'), W = c.width, H = c.height;
  if (s.bg) {g.fillStyle = s.bg; if (s.radius) {g.beginPath(); g.roundRect(0, 0, W, H, s.radius * H); g.fill();} else g.fillRect(0, 0, W, H);}
  const layers = s.layers || [{type: 'text', text: s.text || fallbackText, x: 0.5, y: 0.5, size: 0.72, fill: s.ink || '#f6f1e7', font: s.font, weight: s.weight, italic: s.italic}];
  for (const L of layers) {
    g.save(); g.fillStyle = L.fill || '#fff'; g.strokeStyle = L.stroke || 'transparent'; g.lineWidth = (L.line || 0) * H;
    const X = (L.x ?? 0) * W, Y = (L.y ?? 0) * H;
    if (L.type === 'rect') {g.fillRect(X, Y, (L.w ?? 1) * W, (L.h ?? 1) * H); if (L.line) g.strokeRect(X, Y, (L.w ?? 1) * W, (L.h ?? 1) * H);}
    else if (L.type === 'roundrect') {g.beginPath(); g.roundRect(X, Y, (L.w ?? 1) * W, (L.h ?? 1) * H, (L.r ?? 0.2) * H); g.fill(); if (L.line) g.stroke();}
    else if (L.type === 'circle' || L.type === 'ring') {g.beginPath(); g.arc(X, Y, (L.r ?? 0.4) * H, 0, Math.PI * 2); L.type === 'ring' ? g.stroke() : g.fill(); if (L.line && L.type === 'circle') g.stroke();}
    else if (L.type === 'halfdisc') {g.beginPath(); g.arc(X, Y, (L.r ?? 0.4) * H, Math.PI, 0); g.closePath(); g.fill();}
    else if (L.type === 'text') {
      let size = (L.size ?? 0.5) * H; const font = L.font || 'Georgia, serif', weight = L.weight || 700, it = L.italic ? 'italic ' : '';
      g.font = `${it}${weight} ${size}px ${font}`;
      const maxW = (L.maxw ?? 0.94) * W;
      if (L.spacing) g.letterSpacing = `${L.spacing * size}px`;
      while (g.measureText(L.text).width > maxW && size > 5) {size -= 1; g.font = `${it}${weight} ${size}px ${font}`;}
      g.textAlign = L.align || 'center'; g.textBaseline = 'middle';
      if (L.glow) {g.shadowColor = L.glow; g.shadowBlur = size * 0.35;}
      if (L.line) g.strokeText(L.text, X, Y);
      g.fillText(L.text, X, Y);
    }
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const glow = s.illumination && s.illumination !== 'none';
  return new THREE.MeshStandardMaterial({map: tex, transparent: !s.bg || !!s.radius, alphaTest: 0.04, roughness: 0.55, side: THREE.DoubleSide,
    emissive: glow ? '#ffffff' : '#000000', emissiveMap: glow ? tex : null, emissiveIntensity: glow ? 0.35 : 0});
}

function lattice(THREE, colour = '#2b3335', pitch = 0.28, kind = 'diamond') {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#4a5a60'; g.fillRect(0, 0, 128, 128);
  const grd = g.createLinearGradient(0, 0, 128, 128); grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = colour; g.lineWidth = 5;
  g.beginPath();
  if (kind === 'diamond') {g.moveTo(0, 0); g.lineTo(128, 128); g.moveTo(128, 0); g.lineTo(0, 128); g.moveTo(-64, 64); g.lineTo(64, -64); g.moveTo(64, 192); g.lineTo(192, 64); g.moveTo(-64, 64); g.lineTo(64, 192); g.moveTo(64, -64); g.lineTo(192, 64);}
  else {g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64);}
  g.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1 / pitch, 1 / pitch);
  return new THREE.MeshStandardMaterial({map: tex, roughness: 0.2, metalness: 0.4, side: THREE.DoubleSide});
}

function motifStrip(THREE, bg, fg, kind, spacing) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 128); g.fillStyle = fg; g.strokeStyle = fg; g.lineWidth = 6;
  if (kind === 'fan') {
    for (let k = 0; k < 7; k++) {const a0 = Math.PI + (k / 7) * Math.PI, a1 = a0 + Math.PI / 7 * 0.75; g.beginPath(); g.moveTo(128, 104); g.arc(128, 104, 70, a0, a1); g.closePath(); g.fill();}
  } else if (kind === 'dentil') {for (let x = 8; x < 256; x += 40) g.fillRect(x, 20, 24, 88);}
  else if (kind === 'chevron') {g.beginPath(); for (let x = 0; x <= 256; x += 64) {g.moveTo(x, 100); g.lineTo(x + 32, 28); g.lineTo(x + 64, 100);} g.stroke();}
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(1 / spacing, 1);
  return new THREE.MeshStandardMaterial({map: tex, roughness: 0.75, side: THREE.DoubleSide});
}

function stripes(THREE, a, b, width = 0.3, along = 4) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 8;
  const g = c.getContext('2d'); g.fillStyle = a; g.fillRect(0, 0, 256, 8); g.fillStyle = b; g.fillRect(128, 0, 128, 8);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(1 / (2 * width), 1);
  return new THREE.MeshStandardMaterial({map: tex, roughness: 0.92, side: THREE.DoubleSide});
}

function openingPath(THREE, o, flip = false) {
  const p = flip ? new THREE.Path() : new THREE.Shape(), u = o.u, v = o.v, w = o.w, h = o.h;
  const rise = o.shape === 'arched' ? Math.min(w / 2, h * 0.4) : o.shape === 'segmental' ? Math.min(w * 0.18, h * 0.2) : 0;
  p.moveTo(u, v); p.lineTo(u + w, v); p.lineTo(u + w, v + h - rise);
  // a round arch is a true semicircle (a parabola reads as pointed); segmental stays a shallow curve
  if (o.shape === 'arched' && rise === w / 2) p.absarc(u + w / 2, v + h - rise, rise, 0, Math.PI, false);
  else if (rise) p.quadraticCurveTo(u + w / 2, v + h + rise * (o.shape === 'arched' ? 1 : 0.9), u, v + h - rise);
  else p.lineTo(u, v + h);
  p.closePath();
  return p;
}

export async function createBuilder(THREE, {assetBase = null} = {}) {
  const fin = createFinishes(THREE);
  const app = await createExteriorRenderer(THREE, {}, assetBase || location.href, {glassOpacity: 0.55});
  const glass = new THREE.MeshStandardMaterial({color: '#4a5a60', roughness: 0.12, metalness: 0.55, side: THREE.DoubleSide});
  const dark = fin.plain('#15181a', 1);

  function build(model, opts = {}) {
    const root = new THREE.Group(); root.name = `model:${model.id}`;
    const add = (geo, mat, matrix, sel, parent = root) => {
      const m = new THREE.Mesh(geo, mat); if (matrix) m.applyMatrix4(matrix);
      m.castShadow = !mat.transparent; m.receiveShadow = true; if (sel) m.userData.sel = sel; parent.add(m); return m;
    };
    const box = (f, u, v, w, W, H, D, mat, sel, parent) =>
      add(new THREE.BoxGeometry(W, H, D), mat, faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(u, v, w)), sel, parent);
    const H = model.height_m, roof = model.roof || {}, parapet = roof.parapet_h ?? 0.6;

    // ---- street (one side per street the building fronts) ----------------------------------
    const sides = model.street_sides?.length ? model.street_sides : (model.storefronts[0] ? [{edge: model.storefronts[0].edge, ...model.street}] : []);
    if (opts.street !== false) for (const st of sides) {
      const f = wallFrame(model, st.edge);
      const walk = st.sidewalk_m ?? 3, kerb = st.kerb_m ?? 0.15, road = st.road_m ?? 12, ext = st.extend_m ?? 40;
      const u0 = (st.u0 ?? -ext + f.L / 2), u1 = (st.u1 ?? ext + f.L / 2), mid = (u0 + u1) / 2, len = u1 - u0;
      const slab = (w0, w1, y, mat) => {
        const g = new THREE.PlaneGeometry(len, w1 - w0); g.rotateX(-Math.PI / 2);
        const at = faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(mid, y, (w0 + w1) / 2));
        add(g, mat, at, {type: 'street'}).castShadow = false;
      };
      slab(0, walk, 0.002, fin.textured('concrete', st.sidewalk_colour || '#c9c5bb', 0.5));
      slab(walk, walk + road, -kerb, fin.plain(st.road_colour || '#4d4f51', 0.95));
      box(f, mid, -kerb / 2, walk - 0.08, len, kerb, 0.16, fin.plain('#b9b4aa', 0.9), {type: 'street'});
      const line = (w, colour, dashed) => {
        for (let u = u0; u < u1; u += dashed ? 3 : len) {
          const l = dashed ? 1.2 : len;
          box(f, u + l / 2, -kerb + 0.004, w, l, 0.004, 0.1, fin.plain(colour, 0.7), null);
        }
      };
      if (st.parking !== false) line(walk + (st.parking_m ?? 2.4), '#e8e4da', true);
      if (st.centre_line !== false && road > 8) {line(walk + road / 2 - 0.08, '#d7b13c', false); line(walk + road / 2 + 0.08, '#d7b13c', false);}
    }

    // ---- walls ------------------------------------------------------------------------------
    model.walls.forEach((wall, i) => {
      if (wall.visible === false) return;
      const f = wallFrame(model, i), L = f.L;
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(L, 0); shape.lineTo(L, H); shape.lineTo(0, H); shape.closePath();
      const holes = [];
      for (const sf of model.storefronts) if (sf.edge === i && sf.visible !== false) holes.push({u: sf.u0, v: 0, w: sf.u1 - sf.u0, h: sf.band_h});
      for (const o of wall.openings || []) holes.push(o);
      for (const o of holes) {
        const u0 = Math.max(0.02, o.u), u1 = Math.min(L - 0.02, o.u + o.w);
        if (u1 - u0 < 0.05) continue;
        shape.holes.push(openingPath(THREE, {...o, u: u0, w: u1 - u0, v: Math.max(0.001, o.v), h: Math.min(H - 0.02, o.v + o.h) - Math.max(0.001, o.v)}, true));
      }
      const mat = fin.textured(wall.material || 'stucco', wall.colour || '#d9d2c3', wall.texture_scale || 1);
      add(new THREE.ShapeGeometry(shape, 12), mat, faceMatrix(THREE, f), {type: 'wall', wall: i});
      const trim = fin.plain(wall.trim_colour || '#efeae0', 0.7);
      // openings
      for (const o of wall.openings || []) drawOpening(f, wall, o, trim, i);
      // belt courses and cornice
      for (const b of wall.belts || []) box(f, L / 2, b.v + b.h / 2, (b.depth ?? 0.06) / 2, L, b.h, b.depth ?? 0.06, fin.plain(b.colour || wall.trim_colour || '#efeae0', 0.7), {type: 'wall', wall: i});
      for (const fz of wall.friezes || []) {
        const u0 = fz.u0 ?? 0, u1 = fz.u1 ?? L, d = fz.depth ?? 0.05;
        const mat = fz.motif && fz.motif !== 'none' ? motifStrip(THREE, fz.colour || '#2f5a4c', fz.motif_colour || '#d8b45c', fz.motif, fz.spacing || 0.8) : fin.plain(fz.colour || '#2f5a4c', 0.75);
        const g = new THREE.BoxGeometry(u1 - u0, fz.h, d); g.translate((u0 + u1) / 2, fz.v + fz.h / 2, d / 2);
        // a box's front face UVs run 0..1: scale them to metres so the motif repeats at its spacing
        const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (u1 - u0));
        add(g, mat, faceMatrix(THREE, f), {type: 'wall', wall: i});
      }
      for (const pl of wall.pilasters || []) {
        const centres = Array.isArray(pl.u) ? pl.u : [pl.u];
        const mat = fin.plain(pl.colour || '#5e8c7b', 0.6), groove = fin.plain(pl.groove_colour || '#3f6a5b', 0.7), d = pl.depth ?? 0.14;
        for (const uc of centres) {
          const top = pl.v1, steps = pl.top === 'stepped' ? (pl.steps ?? 2) : 0, stepH = pl.step_h ?? 0.18;
          box(f, uc, (pl.v0 + top - steps * stepH) / 2, d / 2, pl.w, top - steps * stepH - pl.v0, d, mat, {type: 'wall', wall: i});
          for (let k = 1; k <= steps; k++) {
            const ww = pl.w * (1 - k / (steps + 1.5)), base = top - (steps - k + 1) * stepH;
            box(f, uc, base + stepH / 2, d / 2, ww, stepH, d, mat, {type: 'wall', wall: i});
          }
          if (pl.flutes) for (let k = 1; k <= pl.flutes; k++) {
            const x = uc - pl.w / 2 + (pl.w * k) / (pl.flutes + 1);
            box(f, x, (pl.v0 + top - steps * stepH) / 2, d + 0.005, 0.03, top - steps * stepH - pl.v0 - 0.1, 0.01, groove, {type: 'wall', wall: i});
          }
        }
      }
      // cladding bands: a stretch of the wall in another finish (cream render over brick), openings cut through
      for (const b of wall.bands || []) {
        const u0 = b.u0 ?? 0, u1 = b.u1 ?? L, sh = new THREE.Shape();
        sh.moveTo(u0, b.v0); sh.lineTo(u1, b.v0); sh.lineTo(u1, b.v1); sh.lineTo(u0, b.v1); sh.closePath();
        for (const o of wall.openings || []) if (o.kind !== 'bay' && o.v >= b.v0 && o.v + o.h <= b.v1 && o.u >= u0 && o.u + o.w <= u1) sh.holes.push(openingPath(THREE, o, true));
        add(new THREE.ShapeGeometry(sh, 8), fin.textured(b.material || 'stucco', b.colour || '#e6dccb', b.texture_scale || 1),
          faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(0, 0, b.depth ?? 0.02)), {type: 'wall', wall: i});
      }
      // ornaments: stone diamonds, roundels and plaques set on the wall
      for (const o of wall.ornaments || []) {
        const d = o.depth ?? 0.05, m = fin.plain(o.colour || wall.trim_colour || '#d9cbb4', 0.7), sel = {type: 'wall', wall: i};
        const g = o.shape === 'circle' ? new THREE.CylinderGeometry(o.w / 2, o.w / 2, d, 24).rotateX(Math.PI / 2) : new THREE.BoxGeometry(o.w / Math.SQRT2, o.h / Math.SQRT2, d);
        if (o.shape !== 'circle' && o.shape !== 'rect') g.rotateZ(Math.PI / 4);
        g.translate(o.u, o.v, d / 2); add(g, m, faceMatrix(THREE, f), sel);
      }
      // balconies and fire escapes: a slab on brackets with a railing (bars) around it
      for (const b of wall.balconies || []) {
        const d = b.depth ?? 0.8, rh = b.h ?? 1.0, m = fin.plain(b.colour || '#2a2b2a', 0.5, 0.5), sel = {type: 'wall', wall: i};
        box(f, b.u + b.w / 2, b.v - 0.03, d / 2, b.w, 0.06, d, m, sel);
        for (const [x, z, W, D] of [[b.u + b.w / 2, d - 0.02, b.w, 0.03], [b.u + 0.015, d / 2, 0.03, d], [b.u + b.w - 0.015, d / 2, 0.03, d]]) {
          box(f, x, b.v + rh - 0.02, z, W, 0.04, D, m, sel);
          box(f, x, b.v + 0.12, z, W, 0.03, D, m, sel);
        }
        for (let u = b.u + 0.12; u < b.u + b.w - 0.05; u += b.bar ?? 0.12) box(f, u, b.v + rh / 2, d - 0.02, 0.015, rh, 0.015, m, sel);
        if (b.ladder) box(f, b.u + b.w * 0.75, b.v - b.ladder / 2, d - 0.1, 0.4, b.ladder, 0.02, m, sel);
      }
      const c = wall.cornice ?? (wall.role === 'street' ? roof.cornice : null);
      if (c && c.h > 0) {
        box(f, L / 2, H - parapet - c.h / 2 + (c.raise ?? parapet), c.depth / 2, L + 0.02, c.h, c.depth, fin.plain(c.colour || '#efeae0', 0.7), {type: 'roof'});
        if (c.brackets) for (let u = 0.3; u < L - 0.2; u += c.brackets) box(f, u, H - parapet - c.h + (c.raise ?? parapet) - 0.12, c.depth / 2, 0.12, 0.24, c.depth * 0.9, fin.plain(c.colour || '#efeae0', 0.7), {type: 'roof'});
      }
      // parapet cap
      box(f, L / 2, H + 0.03, -0.1, L, 0.06, 0.3, fin.plain(wall.trim_colour || '#cfc8bb', 0.8), {type: 'roof'});
    });

    function drawOpening(f, wall, o, trim, wi) {
      const sel = {type: 'opening', wall: wi, id: o.id};
      const frameMat = fin.plain(o.frame_colour || wall.trim_colour || '#efeae0', 0.6);
      const reveal = fin.textured(wall.material || 'stucco', wall.colour || '#d9d2c3', wall.texture_scale || 1);
      const d = o.depth ?? 0.14, t = 0.055;
      if (o.kind === 'bay') return drawBay(f, wall, o, frameMat, sel);
      // reveals
      box(f, o.u + 0.01, o.v + o.h / 2, -d / 2, 0.02, o.h, d, reveal, sel);
      box(f, o.u + o.w - 0.01, o.v + o.h / 2, -d / 2, 0.02, o.h, d, reveal, sel);
      box(f, o.u + o.w / 2, o.v + 0.01, -d / 2, o.w, 0.02, d, reveal, sel);
      if (o.shape !== 'arched') box(f, o.u + o.w / 2, o.v + o.h - 0.01, -d / 2, o.w, 0.02, d, reveal, sel);
      const inner = openingPath(THREE, o);
      const pane = o.kind === 'door' ? fin.plain(o.colour || '#3a2f28', 0.6) : o.kind === 'garage' ? fin.plain(o.colour || '#8e938f', 0.5, 0.3)
        : o.glazing === 'diamond' || o.glazing === 'grid' ? lattice(THREE, o.frame_colour || '#2b3335', o.lattice_m || 0.28, o.glazing)
        : o.pane_colour ? fin.plain(o.pane_colour, 0.3) : glass;  // pane_colour: what the glass reads as (curtains, blinds, reflections)
      add(new THREE.ShapeGeometry(inner, 16), pane, faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(0, 0, -d)), sel);
      if (o.kind === 'door' && o.glazed !== false) {
        const g = {u: o.u + o.w * 0.18, v: o.v + o.h * 0.45, w: o.w * 0.64, h: o.h * 0.42};
        box(f, g.u + g.w / 2, g.v + g.h / 2, -d + 0.012, g.w, g.h, 0.01, glass, sel);
      }
      if (o.kind === 'garage') for (let y = o.v + 0.5; y < o.v + o.h; y += 0.5) box(f, o.u + o.w / 2, y, -d + 0.02, o.w, 0.02, 0.02, frameMat, sel);
      // frame + mullions
      if (o.kind === 'window') {
        box(f, o.u + t / 2, o.v + o.h / 2, -d + 0.03, t, o.h, 0.05, frameMat, sel);
        box(f, o.u + o.w - t / 2, o.v + o.h / 2, -d + 0.03, t, o.h, 0.05, frameMat, sel);
        box(f, o.u + o.w / 2, o.v + t / 2, -d + 0.03, o.w, t, 0.05, frameMat, sel);
        if (o.shape !== 'arched') box(f, o.u + o.w / 2, o.v + o.h - t / 2, -d + 0.03, o.w, t, 0.05, frameMat, sel);
        const [cols, rows] = o.mullions || [1, 1];
        for (let k = 1; k < cols; k++) box(f, o.u + (o.w * k) / cols, o.v + o.h / 2, -d + 0.035, 0.035, o.h, 0.04, frameMat, sel);
        for (let k = 1; k < rows; k++) box(f, o.u + o.w / 2, o.v + (o.h * k) / rows, -d + 0.035, o.w, 0.035, 0.04, frameMat, sel);
        if (o.sill !== false) box(f, o.u + o.w / 2, o.v - 0.03, 0.02, o.w + 0.12, 0.06, 0.1, trim, sel);
        if (o.hood) box(f, o.u + o.w / 2, o.v + o.h + 0.08, 0.04, o.w + 0.2, 0.12, 0.12, trim, sel);
        if (o.surround) for (const [x, y, W, Hh] of [[o.u - 0.06, o.v + o.h / 2, 0.1, o.h + 0.12], [o.u + o.w + 0.06, o.v + o.h / 2, 0.1, o.h + 0.12], [o.u + o.w / 2, o.v + o.h + 0.06, o.w + 0.24, 0.1]])
          box(f, x, y, 0.025, W, Hh, 0.05, trim, sel);
      }
    }

    function drawBay(f, wall, o, frameMat, sel) {
      // a canted bay: a front pane and two angled side panes projecting o.projection (0.6 m)
      const p = o.projection ?? 0.6, front = o.w * (o.front_share ?? 0.55), side = (o.w - front) / 2;
      // a bay may be clad differently from its wall (cream stucco bays on a brick front)
      const mat = fin.textured(o.material || wall.material || 'stucco', o.colour || wall.colour || '#d9d2c3', o.texture_scale || wall.texture_scale || 1);
      const local = (u, w) => [u, w];
      const pts = [local(o.u, 0), local(o.u + side, p), local(o.u + side + front, p), local(o.u + o.w, 0)];
      const v0 = o.v0 ?? o.v - (o.apron ?? 0.45), v1 = o.v1 ?? o.v + o.h + (o.head ?? 0.35);
      for (let k = 0; k < 3; k++) {
        const [u0, w0] = pts[k], [u1, w1] = pts[k + 1];
        const len = Math.hypot(u1 - u0, w1 - w0), ang = Math.atan2(w1 - w0, u1 - u0);
        const at = faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(u0, 0, w0)).multiply(new THREE.Matrix4().makeRotationY(-ang));
        const s = new THREE.Shape(); s.moveTo(0, v0); s.lineTo(len, v0); s.lineTo(len, v1); s.lineTo(0, v1); s.closePath();
        const hole = new THREE.Path(); const m = Math.min(0.12, len * 0.12);
        hole.moveTo(m, o.v); hole.lineTo(len - m, o.v); hole.lineTo(len - m, o.v + o.h); hole.lineTo(m, o.v + o.h); hole.closePath(); s.holes.push(hole);
        add(new THREE.ShapeGeometry(s), mat, at, sel);
        const g = new THREE.PlaneGeometry(len - 2 * m, o.h); g.translate(len / 2, o.v + o.h / 2, -0.06);
        add(g, glass, at, sel);
        for (const y of [o.v, o.v + o.h]) {const b = new THREE.BoxGeometry(len - 2 * m, 0.05, 0.06); b.translate(len / 2, y, -0.03); add(b, frameMat, at, sel);}
        const [cols] = o.mullions || [1, 1];
        for (let c = 1; c < Math.max(cols, k === 1 ? 2 : 1); c++) {const b = new THREE.BoxGeometry(0.04, o.h, 0.05); b.translate(m + (len - 2 * m) * c / Math.max(cols, 2), o.v + o.h / 2, -0.03); add(b, frameMat, at, sel);}
      }
      const trimM = fin.plain(o.trim_colour || wall.trim_colour || '#efeae0', 0.7);
      for (const y of [v0, v1]) {
        const s = new THREE.Shape(pts.map(([u, w]) => new THREE.Vector2(u, w)));
        const g = new THREE.ShapeGeometry(s); g.rotateX(Math.PI / 2); g.translate(0, y, 0);
        add(g, trimM, faceMatrix(THREE, f), sel);
      }
      // a moulded cap over the front pane: cornice band, and optionally a raised crest (pediment)
      if (o.cap) {
        const c = o.cap, ch = c.h ?? 0.25, at = faceMatrix(THREE, f);
        const g = new THREE.BoxGeometry(o.w + 0.1, ch, p + 0.12); g.translate(o.u + o.w / 2, v1 + ch / 2, (p + 0.12) / 2 - 0.02); add(g, fin.plain(c.colour || o.trim_colour || '#efeae0', 0.7), at, sel);
        if (c.crest_h) {
          const cw = front * (c.crest_w ?? 0.8), sh = new THREE.Shape();
          sh.moveTo(-cw / 2, 0); sh.lineTo(cw / 2, 0); sh.lineTo(cw / 2, c.crest_h * 0.55); sh.quadraticCurveTo(0, c.crest_h * 1.25, -cw / 2, c.crest_h * 0.55); sh.closePath();
          const cg = new THREE.ExtrudeGeometry(sh, {depth: 0.12, bevelEnabled: false}); cg.translate(o.u + o.w / 2, v1 + ch, p - 0.1);
          add(cg, fin.plain(c.colour || o.trim_colour || '#efeae0', 0.7), at, sel);
        }
      }
    }

    // ---- roof -------------------------------------------------------------------------------
    {
      const s = new THREE.Shape(model.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); g.translate(0, H - parapet, 0);
      add(g, fin.plain(roof.colour || '#8c8a84', 0.95), null, {type: 'roof'});
    }

    // ---- storefront band (the app's renderer) + awnings + extra signs --------------------
    const plan = toPlan(model);
    const band = new THREE.Group(); band.name = 'storefront-band';
    app.mount(band, plan);
    band.traverse(o => {
      if (!o.isMesh) return;
      o.userData.sel = {type: 'storefront', id: model.storefronts[0]?.id};
      // the app's renderer batches meshes per material; tag each with the facade it came from
    });
    root.add(band);
    for (const sf of model.storefronts) {
      if (sf.visible === false) continue;
      const f = wallFrame(model, sf.edge);
      // a hit target over the band so a click anywhere on it selects the storefront
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(sf.u1 - sf.u0, sf.band_h), new THREE.MeshBasicMaterial({visible: false}));
      hit.applyMatrix4(faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation((sf.u0 + sf.u1) / 2, sf.band_h / 2, 0.03)));
      hit.userData.sel = {type: 'storefront', id: sf.id}; root.add(hit);
      for (const a of sf.awnings || []) drawAwning(f, sf, a);
      for (const s of sf.extra_signs || []) drawExtraSign(f, sf, s);
      for (const l of sf.lights || []) drawLight(f, sf, l);
    }

    function drawAwning(f, sf, a) {
      if (a.visible === false) return;
      const sel = {type: 'awning', storefront: sf.id, id: a.id};
      const W = a.u1 - a.u0, uc = (a.u0 + a.u1) / 2, D = a.depth_m ?? 0.9, drop = a.drop_m ?? 0.3;
      const val = a.valance_h ?? (a.kind === 'box' ? 0.35 : 0.22);
      const cloth = a.stripe ? stripes(THREE, a.colour, a.stripe, a.stripe_w ?? 0.3)
        : a.material && a.material !== 'canvas' ? fin.textured(a.material, a.colour || '#264f43', 0.6) : fin.textured('canvas', a.colour || '#264f43', 1);
      const at = faceMatrix(THREE, f);
      const top = a.v ?? sf.band_h - 0.3; // where the awning meets the wall
      let frontY = top - drop;
      if (a.kind === 'dome' || a.kind === 'quarter_round') {
        // quarter-round profile from the wall (w 0, y top) out to the front edge (w D, y top-drop)
        const N = 14, pos = [], uv = [], idx = [];
        for (let k = 0; k <= N; k++) {
          const th = (k / N) * Math.PI / 2, w = D * Math.sin(th), y = top - drop + drop * Math.cos(th);
          pos.push(a.u0, y, w, a.u1, y, w); uv.push(a.u0, k / N, a.u1, k / N);
          if (k) {const q = 2 * k; idx.push(q - 2, q, q - 1, q - 1, q, q + 1);}
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeVertexNormals(); add(g, cloth, at, sel);
        for (const u of [a.u0, a.u1]) { // closed ends
          const ep = [u, top - drop, 0], ip = [];
          for (let k = 0; k <= N; k++) {const th = (k / N) * Math.PI / 2; ep.push(u, top - drop + drop * Math.cos(th), D * Math.sin(th)); if (k) ip.push(0, k, k + 1);}
          const e = new THREE.BufferGeometry(); e.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)); e.setIndex(ip); e.computeVertexNormals();
          add(e, cloth, at, sel);
        }
      } else if (a.kind === 'box' || a.kind === 'flat_canopy') {
        const th = a.kind === 'flat_canopy' ? 0.12 : 0.05;
        const g = new THREE.BoxGeometry(W, th, D); g.translate(uc, top - th / 2, D / 2); add(g, cloth, at, sel);
        frontY = top;
        if (a.kind === 'flat_canopy') for (const u of [a.u0 + 0.2, a.u1 - 0.2]) {
          const rod = new THREE.CylinderGeometry(0.012, 0.012, Math.hypot(D, 0.9)); rod.rotateX(Math.atan2(D, 0.9)); rod.translate(u, top + 0.45, D / 2);
          add(rod, fin.plain('#333', 0.4, 0.8), at, sel);
        }
      } else { // shed / retractable: a sloped plane
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([a.u0, top, 0, a.u1, top, 0, a.u1, frontY, D, a.u0, frontY, D], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([a.u0, 0, a.u1, 0, a.u1, 1, a.u0, 1], 2));
        g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals(); add(g, cloth, at, sel);
        if (a.sides !== false && a.kind !== 'retractable') for (const u of [a.u0, a.u1]) {
          const s = new THREE.BufferGeometry();
          s.setAttribute('position', new THREE.Float32BufferAttribute([u, top, 0, u, frontY, D, u, frontY - val, D, u, top - val * 0.4, 0], 3));
          s.setIndex([0, 1, 2, 0, 2, 3]); s.computeVertexNormals(); add(s, cloth, at, sel);
        }
        if (a.kind === 'retractable') for (const u of [a.u0 + 0.15, a.u1 - 0.15]) {
          const arm = new THREE.CylinderGeometry(0.015, 0.015, Math.hypot(D, drop)); arm.rotateX(Math.PI / 2 - Math.atan2(drop, D)); arm.translate(u, top - drop / 2 - 0.05, D / 2);
          add(arm, fin.plain('#555', 0.4, 0.7), at, sel);
        }
      }
      if (a.kind !== 'flat_canopy') {
        const vg = new THREE.PlaneGeometry(W, val); vg.translate(uc, frontY - val / 2, (a.kind === 'dome' || a.kind === 'quarter_round') ? D + 0.005 : D + 0.002);
        add(vg, a.valance_colour ? fin.plain(a.valance_colour, 0.9) : cloth, at, sel);
        if (a.valance_text) {
          const tw = Math.min(W * 0.9, a.valance_text.length * val * 0.55);
          const tg = new THREE.PlaneGeometry(tw, val * 0.8); tg.translate(a.text_u ?? uc, frontY - val / 2, D + 0.012);
          add(tg, textPlane(THREE, a.valance_text, {ink: a.text_colour || '#f6f1e7', w: tw, h: val * 0.8, font: a.font || 'Georgia, serif', italic: !!a.italic}), at, sel);
        }
      }
      if (a.text_on_slope) {
        const tw = Math.min(W * 0.8, a.text_on_slope.length * 0.22), th = 0.3;
        const tg = new THREE.PlaneGeometry(tw, th); const ang = Math.atan2(top - frontY, D);
        tg.rotateX(-(Math.PI / 2 - ang)); tg.translate(uc, (top + frontY) / 2 + 0.02, D / 2 + 0.02);
        add(tg, textPlane(THREE, a.text_on_slope, {ink: a.text_colour || '#f6f1e7', w: tw, h: th, font: a.font || 'Georgia, serif'}), at, sel);
      }
    }

    function drawExtraSign(f, sf, s) {
      if (s.visible === false) return;
      const sel = {type: 'sign', storefront: sf.id, id: s.id};
      const at = faceMatrix(THREE, f);
      const mat = signArt(THREE, s, sf.name);
      if (s.kind === 'blade') {
        const out = s.offset ?? 0.12, thick = s.thick ?? 0.08;
        const g = new THREE.BoxGeometry(thick, s.h, s.w); g.translate(s.u, s.v + s.h / 2, out + s.w / 2);
        add(g, fin.plain(s.edge_colour || s.bg || '#222', 0.6), at, sel);
        for (const side of [-1, 1]) {
          const p = new THREE.PlaneGeometry(s.w, s.h); p.rotateY(side * Math.PI / 2); p.translate(s.u + side * (thick / 2 + 0.003), s.v + s.h / 2, out + s.w / 2);
          add(p, mat, at, sel);
        }
        if (s.bracket !== false) {const arm = new THREE.BoxGeometry(0.04, 0.04, s.w + out); arm.translate(s.u, s.v + s.h + 0.06, (s.w + out) / 2); add(arm, fin.plain('#2b2b2b', 0.5, 0.6), at, sel);}
      } else if (s.kind === 'rooftop') {
        const w = s.offset ?? -0.4, thick = s.thick ?? 0.12;
        // the board behind the face; board_inset trims it top and bottom so discs can overhang it
        const bi = s.board_inset ?? 0, bh = s.h * (1 - 2 * bi);
        const g = new THREE.BoxGeometry(s.w, bh, thick); g.translate(s.u + s.w / 2, s.v + s.h / 2, w - thick / 2); add(g, fin.plain(s.edge_colour || '#e8e6df', 0.7), at, sel);
        const p = new THREE.PlaneGeometry(s.w, s.h); p.translate(s.u + s.w / 2, s.v + s.h / 2, w + 0.004); add(p, mat, at, sel);
        const roofV = H - (roof.parapet_h ?? 0.6);
        for (const k of [0.15, 0.5, 0.85]) {const leg = new THREE.BoxGeometry(0.08, s.v - roofV, 0.08); leg.translate(s.u + s.w * k, (s.v + roofV) / 2, w - thick); add(leg, fin.plain('#555', 0.6, 0.4), at, sel);}
      } else {
        const depth = s.kind === 'window_vinyl' ? -0.13 : s.kind === 'board' ? 0.06 : 0.04;
        if (s.kind === 'board') {const b = new THREE.BoxGeometry(s.w + 0.06, s.h + 0.06, 0.05); b.translate(s.u + s.w / 2, s.v + s.h / 2, 0.025); add(b, fin.plain(s.board || s.bg || '#1f2a26', 0.6), at, sel);}
        const g = new THREE.PlaneGeometry(s.w, s.h); g.translate(s.u + s.w / 2, s.v + s.h / 2, depth + 0.005);
        add(g, mat, at, sel);
      }
    }

    function drawLight(f, sf, l) {
      const at = faceMatrix(THREE, f), sel = {type: 'storefront', id: sf.id};
      if (l.kind === 'gooseneck') {
        const g = new THREE.CylinderGeometry(0.11, 0.06, 0.12, 12); g.translate(l.u, l.v, 0.35); add(g, fin.plain(l.colour || '#222', 0.4, 0.7), at, sel);
        const arm = new THREE.BoxGeometry(0.02, 0.02, 0.35); arm.translate(l.u, l.v + 0.05, 0.17); add(arm, fin.plain(l.colour || '#222', 0.4, 0.7), at, sel);
      } else if (l.kind === 'string') {
        const g = new THREE.BoxGeometry(l.u1 - l.u0, 0.01, 0.01); g.translate((l.u0 + l.u1) / 2, l.v, l.w ?? 0.5); add(g, fin.plain('#ffe8a8', 0.3, 0, {emissive: '#ffd27a', emissiveIntensity: 0.6}), at, sel);
      }
    }

    // ---- seating ----------------------------------------------------------------------------
    for (const s of model.seating || []) if (s.visible !== false) drawSeating(s);

    function chair(f, u, w, faceDir, mat, sel) {
      const at = faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(u, 0, w)).multiply(new THREE.Matrix4().makeRotationY(faceDir));
      const part = (W, Hh, D, x, y, z) => {const g = new THREE.BoxGeometry(W, Hh, D); g.translate(x, y, z); add(g, mat, at, sel);};
      part(0.42, 0.03, 0.42, 0, 0.45, 0);
      part(0.42, 0.4, 0.03, 0, 0.66, -0.2);
      for (const [x, z] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) part(0.025, 0.45, 0.025, x, 0.225, z);
    }
    function table(f, u, w, r, mat, sel, square = false) {
      const at = faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(u, 0, w));
      const top = square ? new THREE.BoxGeometry(r * 2, 0.03, r * 2) : new THREE.CylinderGeometry(r, r, 0.03, 24);
      top.translate(0, 0.74, 0); add(top, mat, at, sel);
      const leg = new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8); leg.translate(0, 0.37, 0); add(leg, mat, at, sel);
      const foot = new THREE.CylinderGeometry(0.22, 0.24, 0.03, 16); foot.translate(0, 0.015, 0); add(foot, mat, at, sel);
    }
    function umbrella(f, u, w, colour, sel) {
      const at = faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(u, 0, w));
      const pole = new THREE.CylinderGeometry(0.02, 0.02, 2.3, 8); pole.translate(0, 1.15, 0); add(pole, fin.plain('#ddd', 0.5), at, sel);
      const can = new THREE.ConeGeometry(1.1, 0.45, 8, 1, true); can.translate(0, 2.25, 0); add(can, fin.textured('canvas', colour || '#efe9dc', 1), at, sel);
    }

    function drawSeating(s) {
      const f = wallFrame(model, s.edge), st = model.street || {}, sel = {type: 'seating', id: s.id};
      const metal = fin.plain(s.colour || '#2f2f2c', 0.5, 0.4), chairM = fin.plain(s.chair_colour || s.colour || '#2f2f2c', 0.55, 0.3);
      if (s.kind === 'sidewalk_strip' || s.kind === 'patio') {
        const w = (s.offset_m ?? 0.15) + (s.depth_m ?? 0.95) / 2, sp = s.spacing_m ?? 1.55;
        const n = Math.max(1, Math.floor((s.u1 - s.u0) / sp));
        const start = (s.u0 + s.u1) / 2 - ((n - 1) * sp) / 2;
        for (let k = 0; k < n; k++) {
          const u = start + k * sp;
          table(f, u, w, s.table === 'four_top' ? 0.4 : 0.3, metal, sel, s.table_shape === 'square');
          if ((s.depth_m ?? 0.95) >= 1.4) {chair(f, u, w - 0.5, 0, chairM, sel); chair(f, u, w + 0.5, Math.PI, chairM, sel);}
          else {chair(f, u - 0.45, w, Math.PI / 2, chairM, sel); chair(f, u + 0.45, w, -Math.PI / 2, chairM, sel);}
          if (s.umbrellas) umbrella(f, u, w, s.umbrella_colour, sel);
        }
        if (s.barrier && s.barrier !== 'none') {
          const wb = (s.offset_m ?? 0.15) + (s.depth_m ?? 0.95) + 0.05;
          const g = new THREE.BoxGeometry(s.u1 - s.u0, s.barrier === 'rope' ? 0.02 : 0.9, 0.04);
          g.translate((s.u0 + s.u1) / 2, s.barrier === 'rope' ? 0.8 : 0.45, wb); add(g, fin.plain(s.barrier_colour || '#3c3c3a', 0.7), faceMatrix(THREE, f), sel);
        }
        return;
      }
      if (s.kind === 'parklet') {
        const side = (model.street_sides || []).find(x => x.edge === s.edge) || st;
        const walk = s.sidewalk_m ?? side.sidewalk_m ?? 3, kerb = side.kerb_m ?? 0.15, D = s.depth_m ?? 1.83;
        // zone 'sidewalk': the same enclosure built on the sidewalk against the facade (a café
        // enclosure), else in the parking lane from the kerb
        const onWalk = s.zone === 'sidewalk';
        const w0 = onWalk ? (s.offset_m ?? 0.1) : walk + (s.gap_m ?? 0.05), w1 = w0 + D, uc = (s.u0 + s.u1) / 2, L = s.u1 - s.u0;
        const at = faceMatrix(THREE, f);
        // deck, level with the sidewalk (a thin floor when it already stands on the sidewalk)
        const deckH = onWalk ? 0.02 : kerb;
        const deck = new THREE.BoxGeometry(L, deckH, D); deck.translate(uc, onWalk ? 0.012 : -kerb / 2 + 0.003, (w0 + w1) / 2);
        add(deck, fin.textured('wood_siding', s.deck_colour || '#7a5c43', 0.5), at, sel);
        // barrier on the street side and both ends
        const bh = s.barrier_h ?? 1.07, bm = s.barrier === 'rail' ? fin.plain(s.barrier_colour || '#3d3d3d', 0.5, 0.5)
          : s.barrier === 'low_wall' ? fin.textured('stucco', s.barrier_colour || '#e6dcc3', 1)
          : fin.textured('wood_siding', s.barrier_colour || '#4b3a2c', s.barrier === 'planks' ? 0.9 : 0.6);
        const wall = (u, w, W, D2) => {const g = new THREE.BoxGeometry(W, bh, D2); g.translate(u, bh / 2, w); add(g, bm, at, sel);};
        const thick = s.barrier === 'rail' ? 0.05 : s.barrier === 'planks' ? 0.12 : s.barrier === 'low_wall' ? 0.2 : 0.35;
        // street side, with an optional entrance gap [u0, u1]; and both ends
        const gap = s.entrance;
        if (gap) {for (const [a, b] of [[s.u0, gap[0]], [gap[1], s.u1]]) if (b - a > 0.05) wall((a + b) / 2, w1 - thick / 2, b - a, thick);}
        else wall(uc, w1 - thick / 2, L, thick);
        wall(s.u0 + thick / 2, (w0 + w1) / 2, thick, D); wall(s.u1 - thick / 2, (w0 + w1) / 2, thick, D);
        // horizontal rails of an enclosure frame (vinyl/glass panels between) on the street side and ends
        for (const rv of s.rails || []) {
          const rm = fin.plain(s.post_colour || '#b08a5e', 0.7);
          const g = new THREE.BoxGeometry(L, 0.07, 0.07); g.translate(uc, rv, w1 - 0.05); add(g, rm, at, sel);
          for (const u of [s.u0 + 0.05, s.u1 - 0.05]) {const e = new THREE.BoxGeometry(0.07, 0.07, D); e.translate(u, rv, (w0 + w1) / 2); add(e, rm, at, sel);}
        }
        if (s.barrier === 'rail') for (let u = s.u0; u <= s.u1; u += 1.0) {const g = new THREE.BoxGeometry(0.05, bh, 0.05); g.translate(u, bh / 2, w1 - 0.03); add(g, bm, at, sel);}
        if (s.plants !== false && s.barrier !== 'rail') for (let u = s.u0 + 0.4; u < s.u1 - 0.3; u += 0.55) {
          const g = new THREE.SphereGeometry(0.22 + ((u * 7) % 1) * 0.08, 8, 6); g.translate(u, bh + 0.12, w1 - thick / 2); add(g, fin.plain('#4d6b3a', 0.95), at, sel);
        }
        // benches along the barrier, tables between bench and sidewalk
        const inner = w1 - thick;
        if (s.benches && s.benches !== 'none') {
          const g = new THREE.BoxGeometry(L - 2 * thick - 0.1, 0.45, 0.45); g.translate(uc, 0.225, inner - 0.25); add(g, fin.textured('wood_siding', s.bench_colour || '#6b4b33', 0.5), at, sel);
          const back = new THREE.BoxGeometry(L - 2 * thick - 0.1, 0.45, 0.06); back.translate(uc, 0.65, inner - 0.04); add(back, fin.textured('wood_siding', s.bench_colour || '#6b4b33', 0.5), at, sel);
        }
        const sp = s.spacing_m ?? 1.6, n = Math.max(1, Math.floor((L - 2 * thick) / sp));
        const start = uc - ((n - 1) * sp) / 2;
        for (let k = 0; k < n; k++) {
          const u = start + k * sp, wt = inner - (s.benches && s.benches !== 'none' ? 0.85 : D / 2);
          table(f, u, wt, s.tables === 'four_top' ? 0.38 : 0.3, metal, sel, s.table_shape !== 'round');
          chair(f, u, wt - 0.55, 0, chairM, sel);
          if (!(s.benches && s.benches !== 'none')) chair(f, u, wt + 0.55, Math.PI, chairM, sel);
        }
        if (s.roof && s.roof !== 'none') {
          const rh = s.roof_h ?? 2.6, post = fin.plain(s.post_colour || '#3a3a38', 0.6, 0.3), ps = s.post_size ?? 0.08;
          const np = Math.max(2, Math.round(L / (s.post_spacing ?? 2.5)) + 1);
          const pus = s.post_us ?? Array.from({length: np}, (_, k) => s.u0 + 0.1 + (L - 0.2) * k / (np - 1));
          for (const u of pus) {for (const w of (s.posts_both_sides === false ? [w1 - 0.1] : [w0 + 0.1, w1 - 0.1])) {const g = new THREE.BoxGeometry(ps, rh, ps); g.translate(u, rh / 2, w); add(g, post, at, sel);}}
          const beam = new THREE.BoxGeometry(L, 0.14, 0.1); beam.translate(uc, rh - 0.07, w1 - 0.1); add(beam, post, at, sel);
          const pitch = s.roof_pitch ?? 0.15, roofMat = s.roof === 'slats' ? fin.textured('wood_siding', s.roof_colour || '#7a5c43', 0.4)
            : s.roof === 'corrugated' ? fin.textured('metal_panel', s.roof_colour || '#9aa0a2', 0.35) : fin.textured('canvas', s.roof_colour || '#e9e4d8', 1);
          const g = new THREE.BoxGeometry(L + 0.2, 0.03, D + 0.35);
          if (s.roof === 'corrugated') {const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (L + 0.2));}
          g.rotateX(pitch); g.translate(uc, rh + 0.1, (w0 + w1) / 2 - 0.05); add(g, roofMat, at, sel);
          if (s.wall_side_to_roof) for (const u of [s.u0 + 0.05, s.u1 - 0.05]) {const e = new THREE.BoxGeometry(0.05, rh - bh, D); e.translate(u, bh + (rh - bh) / 2, (w0 + w1) / 2); add(e, glass, at, sel);}
          if (s.glass_panels) {const gp = new THREE.BoxGeometry(L, rh - bh - 0.25, 0.02); gp.translate(uc, bh + (rh - bh - 0.25) / 2, w1 - 0.1); add(gp, new THREE.MeshStandardMaterial({color: '#9fb3b8', transparent: true, opacity: 0.28, roughness: 0.1, side: THREE.DoubleSide}), at, sel);}
        }
        if (s.umbrellas) for (let k = 0; k < n; k += 2) umbrella(f, start + k * sp, inner - 0.85, s.umbrella_colour, sel);
        // tall posts on the barrier (no roof) carrying string lights across the deck
        if (s.posts) {
          const ph = s.posts.h ?? 2.6, pm = fin.plain(s.posts.colour || s.barrier_colour || '#555', 0.7), np = Math.max(2, Math.round(L / (s.posts.spacing ?? 2.5)) + 1);
          const us = Array.from({length: np}, (_, k) => s.u0 + 0.06 + (L - 0.12) * k / (np - 1));
          const ps2 = s.posts.size ?? 0.09, pus2 = s.posts.us ?? us;
          for (const u of pus2) {const g = new THREE.BoxGeometry(ps2, ph, ps2); g.translate(u, ph / 2, w1 - 0.05); add(g, pm, at, sel);}
          // a beam along the post tops (a pergola edge without a roof)
          if (s.posts.beam) {const g = new THREE.BoxGeometry(L + 0.3, s.posts.beam_h ?? 0.2, 0.12); g.translate(uc, ph - (s.posts.beam_h ?? 0.2) / 2, w1 - 0.05); add(g, pm, at, sel);}
          if (s.string_lights) {
            const lm = fin.plain('#ffe8a8', 0.3, 0, {emissive: '#ffd27a', emissiveIntensity: 0.6});
            for (let k = 0; k + 1 < us.length; k++) {
              // a sagging run from post top to post top (three straight pieces)
              const a = [us[k], ph - 0.1], b = [us[k + 1], ph - 0.1], mid = [(a[0] + b[0]) / 2, ph - 0.45];
              for (const [p0, p1] of [[a, mid], [mid, b]]) {
                const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), g = new THREE.BoxGeometry(len, 0.015, 0.015);
                g.rotateZ(Math.atan2(p1[1] - p0[1], p1[0] - p0[0])); g.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, w1 - 0.05); add(g, lm, at, sel);
              }
            }
          }
        }
      }
    }

    // ---- street objects (trees, shelters, statues, planters, poles) --------------------------
    for (const o of model.street_objects || []) if (o.visible !== false) drawObject(o);
    function drawObject(o) {
      const f = wallFrame(model, o.edge ?? model.storefronts[0]?.edge ?? 0), sel = {type: 'object', id: o.id};
      const at = faceMatrix(THREE, f).multiply(new THREE.Matrix4().makeTranslation(o.u, 0, o.w ?? 3)).multiply(new THREE.Matrix4().makeRotationY(o.rot ?? 0));
      const part = (g, m) => add(g, m, at, sel);
      if (o.kind === 'tree') {
        const th = o.trunk_h ?? 2.6, r = o.r ?? 2.0;
        const t = new THREE.CylinderGeometry(0.1, 0.16, th + r * 0.5, 8); t.translate(0, (th + r * 0.5) / 2, 0); part(t, fin.plain(o.trunk_colour || '#6b5a48', 0.9));
        const leaf = fin.plain(o.colour || '#4f6b3a', 0.95);
        for (const [x, y, z, k] of [[0, 0, 0, 1], [r * 0.45, -r * 0.15, 0.2, 0.7], [-r * 0.45, -r * 0.1, -0.2, 0.72], [0.1, r * 0.35, 0.3, 0.65]]) {
          const g = new THREE.IcosahedronGeometry(r * k, 1); g.scale(1, o.squash ?? 0.8, 1); g.translate(x, th + r * 0.7 + y, z); part(g, leaf);
        }
      } else if (o.kind === 'bus_shelter') {
        const len = o.len ?? 4, d = o.depth ?? 1.4, h = o.h ?? 2.5, fr = fin.plain(o.frame_colour || '#8b8f8c', 0.4, 0.6);
        for (const x of [-len / 2, len / 2]) for (const z of [-d / 2, d / 2]) {const g = new THREE.BoxGeometry(0.07, h, 0.07); g.translate(x, h / 2, z); part(g, fr);}
        const gl = new THREE.MeshStandardMaterial({color: '#b8c6c8', transparent: true, opacity: 0.35, roughness: 0.1, side: THREE.DoubleSide});
        const back = new THREE.BoxGeometry(len, h - 0.3, 0.02); back.translate(0, (h - 0.3) / 2 + 0.15, o.back_side === 'street' ? d / 2 : -d / 2); part(back, gl);
        const roofG = new THREE.BoxGeometry(len + 0.3, 0.08, d + 0.3); roofG.translate(0, h, 0); part(roofG, fr);
        if (o.roof_style === 'wave') for (let k = 0, nW = o.waves ?? 5; k < nW; k++) {
          const g = new THREE.CylinderGeometry(0.28, 0.28, d + 0.3, 12, 1, false, 0, Math.PI); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 2);  // half-cylinder humps, axis across the shelter's depth
          g.scale(len / nW / 0.56, 1, 1); g.translate(-len / 2 + (k + 0.5) * len / nW, h + 0.04, 0); part(g, fin.plain(o.roof_colour || '#9d2f25', 0.6));
        }
        const bench = new THREE.BoxGeometry(len * 0.6, 0.05, 0.35); bench.translate(0, 0.45, o.back_side === 'street' ? d / 2 - 0.25 : -d / 2 + 0.25); part(bench, fr);
        if (o.ad) {const ad = new THREE.BoxGeometry(0.06, 1.8, 1.2); ad.translate(len / 2, 1.1, 0); part(ad, fin.plain(o.ad, 0.4));}
      } else if (o.kind === 'cone_statue') {
        const h = o.h ?? 1.6;
        const post = new THREE.CylinderGeometry(0.03, 0.03, h * 0.45, 8); post.translate(0, h * 0.225, 0); part(post, fin.plain('#333', 0.4, 0.6));
        const base = new THREE.CylinderGeometry(0.22, 0.25, 0.04, 16); base.translate(0, 0.02, 0); part(base, fin.plain('#333', 0.4, 0.6));
        const cone = new THREE.ConeGeometry(o.cone_r ?? 0.2, h * 0.38, 16); cone.rotateX(Math.PI); cone.translate(0, h * 0.45 + h * 0.19, 0); part(cone, fin.plain(o.cone_colour || '#d39a52', 0.8));
        const sr = (o.cone_r ?? 0.2) * 1.2, scoop = new THREE.SphereGeometry(sr, 16, 12); scoop.scale(1, 1.15, 1); scoop.translate(0, h * 0.64 + sr * 0.8, 0); part(scoop, fin.plain(o.scoop_colour || '#f2e2c6', 0.7));
        const tip = new THREE.ConeGeometry(sr * 0.62, sr * 0.9, 16); tip.translate(0, h * 0.64 + sr * 2.0, 0); part(tip, fin.plain(o.scoop_colour || '#f2e2c6', 0.7));
      } else if (o.kind === 'planter') {
        const len = o.len ?? 1.2, d = o.depth ?? 0.5, h = o.h ?? 0.6;
        const b = new THREE.BoxGeometry(len, h, d); b.translate(0, h / 2, 0); part(b, fin.plain(o.colour || '#3e4b42', 0.7));
        for (let x = -len / 2 + 0.25; x < len / 2; x += 0.4) {const g = new THREE.SphereGeometry(0.25, 8, 6); g.translate(x, h + 0.15, 0); part(g, fin.plain(o.plant_colour || '#4d6b3a', 0.95));}
      } else if (o.kind === 'pole') {
        const h = o.h ?? 9, g = new THREE.CylinderGeometry(o.r ?? 0.13, (o.r ?? 0.13) * 1.3, h, 10); g.translate(0, h / 2, 0); part(g, fin.plain(o.colour || '#7b6a58', 0.9));
        if (o.arm) {const a = new THREE.BoxGeometry(0.06, 0.06, o.arm); a.translate(0, h - 0.3, -o.arm / 2); part(a, fin.plain('#666', 0.5, 0.5));}
      } else if (o.kind === 'box') {
        const g = new THREE.BoxGeometry(o.len ?? 0.6, o.h ?? 1.0, o.depth ?? 0.5); g.translate(0, (o.h ?? 1) / 2, 0); part(g, fin.plain(o.colour || '#2f6b46', 0.6));
      } else if (o.kind === 'heater') {
        // a pyramid patio heater: square foot, glass flame tube in a frame, reflector cap
        const h = o.h ?? 2.3, fr = fin.plain(o.colour || '#b9bcbc', 0.35, 0.8);
        const foot = new THREE.BoxGeometry(0.5, 0.12, 0.5); foot.translate(0, 0.06, 0); part(foot, fr);
        const tube = new THREE.CylinderGeometry(0.05, 0.05, h - 0.4, 8); tube.translate(0, 0.12 + (h - 0.4) / 2, 0);
        part(tube, fin.plain('#ffb35c', 0.3, 0, {emissive: '#ff8a2a', emissiveIntensity: 0.5}));
        const cage = new THREE.CylinderGeometry(0.16, 0.24, h - 0.4, 4, 1, true); cage.rotateY(Math.PI / 4); cage.translate(0, 0.12 + (h - 0.4) / 2, 0);
        part(cage, new THREE.MeshStandardMaterial({color: '#c9d3d6', transparent: true, opacity: 0.35, roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide}));
        const cap = new THREE.ConeGeometry(0.42, 0.22, 4, 1, true); cap.rotateY(Math.PI / 4); cap.translate(0, h - 0.17, 0); part(cap, fr);
      } else if (o.kind === 'a_frame') {
        for (const sgn of [-1, 1]) {const g = new THREE.BoxGeometry(0.6, 0.95, 0.03); g.rotateX(sgn * 0.18); g.translate(0, 0.47, sgn * 0.09); part(g, fin.plain(o.colour || '#1f1f1f', 0.6));}
      }
    }

    // ---- neighbours -------------------------------------------------------------------------
    if (opts.context !== false) for (const c of model.context || []) {
      const shape = new THREE.Shape(c.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, {depth: c.height_m, bevelEnabled: false}); g.rotateX(-Math.PI / 2);
      const m = add(g, [fin.plain(c.roof_colour || '#8c8a84', 0.95), fin.textured('stucco', c.colour || '#d6d0c4', 1)], null, {type: 'context', id: c.id});
      // ExtrudeGeometry: group 0 = caps, group 1 = sides; side UVs are metres along/up
      m.material = [fin.plain(c.roof_colour || '#8c8a84', 0.95), fin.textured('stucco', c.colour || '#d6d0c4', 1)];
    }
    return root;
  }
  return {build, finishes: fin, dispose() {fin.dispose(); app.dispose();}};
}
