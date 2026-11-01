// The exterior editor: a house's or a shop's front, drawn flat beside the world and edited by
// hand -- its windows (size, shape, panes, glass and frame colour), its doors, its garages, the
// stairs up to a door and the indents round them -- and the edited front drawn on the building
// as the edit goes. People correct their own houses; nobody else's guess stands over theirs.
//
// The page hands over what it knows (``ctx``: THREE, the building's walls, the windows and doors
// it drew, a still of the wall rendered from the street) and this module keeps everything else:
// the editor, the elevation, the edit itself, and the meshes that draw it. The editor fills the
// screen: on one side a still of the wall being edited, re-rendered from the world the moment
// anything changes, so you see the effect; on the other the options. It opens on the street
// side, seen from outside.
//
// "Save changes" is the one way an edit is kept: in this browser always (localStorage,
// ``EDITS_KEY``), and -- from a verified editor's account (docs/kerbside-account.mjs) -- in the
// canonical world everyone's page draws (supabase/kerbside_exterior_edits.sql).
//
// Lengths are metres. On the wall, ``u`` runs left to right as seen from the street and ``v`` up
// from the foot of the wall.

export const SCHEMA = "kerbside.exterior_edit/1";
export const EDITS_KEY = "kerbside:exterior-edits:v1";
//: The edited front stands this far proud of the wall, over what the page drew there (window
//: decals 2 cm out, storefront panels to 11 cm); its openings a little further out still.
export const SKIN_OUT_M = 0.13;
const SNAP_M = 0.05;
const ALIGN_M = 0.12;

// ---- shapes ----------------------------------------------------------------------------------
//
// Each is its outline in metres for a window ``w`` wide and ``h`` tall, anticlockwise from the
// bottom left, so the glass, the frame and the bars all come from the one outline.

const arc = (cx, cy, rx, ry, a0, a1, n = 18) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });

export const SHAPES = {
  rectangle: { name: "Rectangle", outline: (w, h) => [[0, 0], [w, 0], [w, h], [0, h]] },
  arched: { name: "Round arch", outline: (w, h) => {
    const r = Math.min(w / 2, h * 0.6), spring = h - r;
    return [[0, 0], [w, 0], ...arc(w / 2, spring, w / 2, r, 0, Math.PI)];
  } },
  segmental: { name: "Segmental arch", outline: (w, h) => {
    const rise = Math.min(h * 0.22, w * 0.2), spring = h - rise;
    return [[0, 0], [w, 0], ...arc(w / 2, spring, w / 2, rise, 0, Math.PI)];
  } },
  gothic: { name: "Pointed (Gothic)", outline: (w, h) => {
    const root3 = Math.sqrt(3) / 2, rise = Math.min(h * 0.5, w * root3), spring = h - rise, k = rise / (w * root3);
    const right = arc(0, 0, w, w, 0, Math.PI / 3, 12).map(([x, y]) => [x, spring + y * k]);
    const left = arc(w, 0, w, w, (2 * Math.PI) / 3, Math.PI, 12).map(([x, y]) => [x, spring + y * k]);
    return [[0, 0], [w, 0], ...right, ...left.slice(1)];
  } },
  tudor: { name: "Tudor", outline: (w, h) => {
    const rise = Math.min(h * 0.28, w * 0.3), spring = h - rise;
    const r = arc(w * 0.78, spring, w * 0.22, rise * 0.62, 0, Math.PI / 2, 8);
    const l = arc(w * 0.22, spring, w * 0.22, rise * 0.62, Math.PI / 2, Math.PI, 8);
    return [[0, 0], [w, 0], ...r, [w / 2, h], ...l];
  } },
  ogee: { name: "Ogee", outline: (w, h) => {
    const rise = Math.min(h * 0.35, w * 0.6), spring = h - rise;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
    const right = Array.from({ length: 13 }, (_, i) => { const t = i / 12; return [w - (w / 2) * t, spring + rise * ease(t)]; });
    const left = Array.from({ length: 12 }, (_, i) => { const t = 1 - (i + 1) / 12; return [(w / 2) * t, spring + rise * ease(t)]; });
    return [[0, 0], [w, 0], ...right, ...left];
  } },
  horseshoe: { name: "Horseshoe arch", outline: (w, h) => {
    const r = Math.min(w / 2, h * 0.45), cy = h - r, a = 0.42;
    const pts = arc(w / 2, cy, r, r, -a, Math.PI + a, 22);
    const x0 = pts[pts.length - 1][0], x1 = pts[0][0];
    return [[x0, 0], [x1, 0], ...pts];
  } },
  trefoil: { name: "Trefoil arch", outline: (w, h) => {
    const r = w / 6, spring = Math.max(h * 0.4, h - r * 1.75), up = r * 0.75;
    return [[0, 0], [w, 0], [w, spring], ...arc((5 * w) / 6, spring, r, r, 0, Math.PI, 8),
      [(2 * w) / 3, spring + up], ...arc(w / 2, spring + up, r, r, 0, Math.PI, 8).slice(1),
      [w / 3, spring], ...arc(w / 6, spring, r, r, 0, Math.PI, 8).slice(1)];
  } },
  shouldered: { name: "Shouldered", outline: (w, h) => {
    const s = Math.min(w, h) * 0.12;
    return [[0, 0], [w, 0], [w, h - s], [w - s, h - s], [w - s, h], [s, h], [s, h - s], [0, h - s]];
  } },
  rounded: { name: "Rounded corners", outline: (w, h) => {
    const r = Math.min(w, h) * 0.16;
    return [[r, 0], ...arc(w - r, r, r, r, -Math.PI / 2, 0, 5).slice(0), ...arc(w - r, h - r, r, r, 0, Math.PI / 2, 5),
      ...arc(r, h - r, r, r, Math.PI / 2, Math.PI, 5), ...arc(r, r, r, r, Math.PI, 1.5 * Math.PI, 5)];
  } },
  clipped: { name: "Clipped top", outline: (w, h) => {
    const c = Math.min(w, h) * 0.22;
    return [[0, 0], [w, 0], [w, h - c], [w - c, h], [c, h], [0, h - c]];
  } },
  oval: { name: "Oval", outline: (w, h) => arc(w / 2, h / 2, w / 2, h / 2, -Math.PI / 2, 1.5 * Math.PI, 32).slice(0, -1) },
  round: { name: "Round (oculus)", square: true, outline: (w, h) => arc(w / 2, h / 2, w / 2, h / 2, -Math.PI / 2, 1.5 * Math.PI, 32).slice(0, -1) },
  fanlight: { name: "Half-round fanlight", outline: (w, h) => [[0, 0], [w, 0], ...arc(w / 2, 0, w / 2, h, 0, Math.PI, 20).slice(1, -1)] },
  octagon: { name: "Octagon", outline: (w, h) => {
    const c = Math.min(w, h) * 0.29;
    return [[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]];
  } },
  hexagon: { name: "Hexagon", outline: (w, h) => [[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]] },
  diamond: { name: "Diamond", outline: (w, h) => [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]] },
  triangle: { name: "Gable (triangle)", outline: (w, h) => [[0, 0], [w, 0], [w / 2, h]] },
  quatrefoil: { name: "Quatrefoil", square: true, outline: (w, h) =>
    Array.from({ length: 64 }, (_, i) => {
      const t = (i / 64) * Math.PI * 2, r = 0.5 * (0.74 + 0.26 * Math.abs(Math.cos(2 * t)));
      return [w / 2 + w * r * Math.cos(t), h / 2 + h * r * Math.sin(t)];
    }) },
};

export const DOOR_STYLES = {
  panel: "Panelled", half_glass: "Half glass", glass: "Glass", double_panel: "Double, panelled",
  french: "French (double glass)", arched: "Arched top", dutch: "Dutch (split)",
};
export const GARAGE_STYLES = {
  slat: "Wood slats", sectional: "Sectional panels", carriage: "Carriage (swing)", roll_up: "Roll-up", glass: "Glass panels",
};
export const SHOPFRONT_STYLES = { modern: "Modern glass", traditional: "Traditional (riser, transom)" };
const GLASS_COLOURS = ["#9fb4bf", "#5f7684", "#3b4a52", "#6f8f7a", "#8a7a5c", "#2c3336", "#c79f4a", "#7d3b3b"];
const FRAME_COLOURS = ["#f2f0ea", "#1d1f21", "#e7dcc0", "#2f4a37", "#6b3427", "#8a5a32", "#7b8186", "#3b4f6b"];
const DOOR_COLOURS = ["#6b3427", "#1d1f21", "#2f4a37", "#3b4f6b", "#8a5a32", "#f2f0ea", "#b23a2f", "#c9a54a"];
const WOOD = "#8a5a32";

// ---- the edit ----------------------------------------------------------------------------------

let nextId = 1;
const newId = (kind) => `${kind}-${Date.now().toString(36)}-${nextId++}`;

export function loadEdits() {
  try { return JSON.parse(localStorage.getItem(EDITS_KEY) || "{}") || {}; } catch { return {}; }
}
function saveEdit(edit) {
  const all = loadEdits();
  if (edit) all[edit.osm_id] = edit;
  try { localStorage.setItem(EDITS_KEY, JSON.stringify(all)); return true; } catch { return false; }
}
function forgetEdit(id) {
  const all = loadEdits();
  delete all[id];
  try { localStorage.setItem(EDITS_KEY, JSON.stringify(all)); } catch { /* storage refused */ }
}

//: What an edit must hold to be drawn: the wall it is on (both corners, so a changed footprint
//: drops it rather than drawing it on the wrong wall) and openings with sizes that make sense.
export function validEdit(edit) {
  if (!edit || edit.schema !== SCHEMA || !edit.osm_id || !edit.wall) return false;
  const corner = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  if (!corner(edit.wall.a) || !corner(edit.wall.b) || !Array.isArray(edit.openings)) return false;
  return edit.openings.every((o) => ["window", "door", "garage", "shopfront"].includes(o.type)
    && [o.u, o.v, o.w, o.h].every(Number.isFinite) && o.w > 0.1 && o.h > 0.1 && o.w < 40 && o.h < 30);
}

// ---- geometry --------------------------------------------------------------------------------

function outlineOf(o) {
  const shape = o.type === "window" ? (SHAPES[o.shape] || SHAPES.rectangle)
    : o.type === "door" && o.style === "arched" ? SHAPES.arched : SHAPES.rectangle;
  return shape.outline(o.w, o.h);
}
//: Where a vertical (or, ``horizontal``, a horizontal) line across an outline enters and leaves it.
function span(points, at, horizontal = false) {
  const hits = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i], q = points[(i + 1) % points.length];
    const [a0, a1, b0, b1] = horizontal ? [p[1], q[1], p[0], q[0]] : [p[0], q[0], p[1], q[1]];
    if ((a0 - at) * (a1 - at) > 0 || a0 === a1) continue;
    hits.push(b0 + ((at - a0) / (a1 - a0)) * (b1 - b0));
  }
  return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
}
function inset(points, w, h, by) {
  const cx = w / 2, cy = h / 2, sx = Math.max(0.05, (w - 2 * by) / w), sy = Math.max(0.05, (h - 2 * by) / h);
  return points.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}
//: The bars dividing a window into ``cols`` by ``rows`` panes, each a [u, v, w, h] box clipped
//: to the outline.
function bars(o, points) {
  const out = [];
  const cols = Math.max(1, o.panes?.cols || 1), rows = Math.max(1, o.panes?.rows || 1);
  for (let i = 1; i < cols; i += 1) {
    const x = (o.w * i) / cols, s = span(points, x);
    if (s) out.push([x - 0.018, s[0], 0.036, s[1] - s[0]]);
  }
  for (let j = 1; j < rows; j += 1) {
    const y = (o.h * j) / rows, s = span(points, y, true);
    if (s) out.push([s[0], y - 0.018, s[1] - s[0], 0.036]);
  }
  return out;
}

// ---- textures for doors, garages and shopfronts -----------------------------------------------

const textureCache = new Map();
function canvasTexture(THREE, key, w, h, paint) {
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  paint(canvas.getContext("2d"), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textureCache.set(key, texture);
  return texture;
}
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16), c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
};
function glassFill(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#c4d3da"); g.addColorStop(0.55, "#647b87"); g.addColorStop(1, "#283238");
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
}
function doorTexture(THREE, style, colour) {
  return canvasTexture(THREE, `door|${style}|${colour}`, 128, 256, (ctx, W, H) => {
    const leaf = (x0, x1, kind) => {
      ctx.fillStyle = colour; ctx.fillRect(x0, 0, x1 - x0, H);
      ctx.strokeStyle = shade(colour, 0.6); ctx.lineWidth = 3; ctx.strokeRect(x0 + 2, 2, x1 - x0 - 4, H - 4);
      const pad = (x1 - x0) * 0.16;
      if (kind === "glass") { glassFill(ctx, x0 + pad, H * 0.07, x1 - x0 - 2 * pad, H * 0.8); }
      else if (kind === "half") {
        glassFill(ctx, x0 + pad, H * 0.08, x1 - x0 - 2 * pad, H * 0.36);
        ctx.strokeRect(x0 + pad, H * 0.55, x1 - x0 - 2 * pad, H * 0.36);
      } else {
        ctx.strokeStyle = shade(colour, 0.7); ctx.lineWidth = 2;
        for (const [y0, y1] of [[0.07, 0.42], [0.5, 0.92]]) {
          const half = (x1 - x0 - 3 * pad) / 2;
          ctx.strokeRect(x0 + pad, H * y0, half, H * (y1 - y0));
          ctx.strokeRect(x0 + 2 * pad + half, H * y0, half, H * (y1 - y0));
        }
      }
      ctx.fillStyle = "#d9c27a"; ctx.fillRect(x1 - pad * 0.9, H * 0.5, 4, 10);
    };
    if (style === "double_panel") { leaf(0, W / 2, "panel"); leaf(W / 2, W, "panel"); }
    else if (style === "french") { leaf(0, W / 2, "glass"); leaf(W / 2, W, "glass"); }
    else if (style === "glass") leaf(0, W, "glass");
    else if (style === "half_glass") leaf(0, W, "half");
    else leaf(0, W, "panel");
    if (style === "dutch") { ctx.fillStyle = shade(colour, 0.5); ctx.fillRect(0, H * 0.47, W, 5); }
  });
}
function garageTexture(THREE, style, colour) {
  return canvasTexture(THREE, `garage|${style}|${colour}`, 256, 192, (ctx, W, H) => {
    ctx.fillStyle = colour; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = shade(colour, 0.6); ctx.lineWidth = 2;
    if (style === "slat") {
      for (let x = 0; x < W; x += 9) { ctx.fillStyle = shade(colour, 0.82 + ((x / 9) % 3) * 0.08); ctx.fillRect(x, 0, 8, H); }
    } else if (style === "sectional") {
      for (let y = H / 4; y < H; y += H / 4) ctx.strokeRect(0, y - 1, W, 2);
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1)
        ctx.strokeRect(8 + (c * (W - 16)) / 4, 8 + (r * H) / 4, (W - 16) / 4 - 10, H / 4 - 16);
    } else if (style === "carriage") {
      ctx.fillRect(W / 2 - 2, 0, 4, H);
      for (const x0 of [0, W / 2]) {
        for (let k = 0; k < 3; k += 1) glassFill(ctx, x0 + 10 + k * ((W / 2 - 20) / 3), 10, (W / 2 - 20) / 3 - 6, H * 0.18);
        ctx.beginPath(); ctx.moveTo(x0 + 8, H - 8); ctx.lineTo(x0 + W / 2 - 8, H * 0.32); ctx.stroke();
        ctx.strokeRect(x0 + 8, H * 0.3, W / 2 - 16, H * 0.66);
      }
    } else if (style === "roll_up") {
      for (let y = 0; y < H; y += 6) { ctx.fillStyle = shade(colour, y % 12 ? 0.9 : 0.7); ctx.fillRect(0, y, W, 3); }
    } else if (style === "glass") {
      for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) glassFill(ctx, 6 + (c * W) / 4, 6 + (r * H) / 4, W / 4 - 12, H / 4 - 12);
    }
  });
}
function shopfrontTexture(THREE, style, colour, doorAt, pair) {
  return canvasTexture(THREE, `shop|${style}|${colour}|${doorAt}|${pair}`, 256, 128, (ctx, W, H) => {
    ctx.fillStyle = colour; ctx.fillRect(0, 0, W, H);
    const riser = style === "traditional" ? 26 : 8, head = 8, dw = pair ? 56 : 30;
    const dx = doorAt === "left" ? 8 : doorAt === "right" ? W - 8 - dw : W / 2 - dw / 2;
    const panes = doorAt === "left" ? [[dx + dw + 6, W - 6]] : doorAt === "right" ? [[6, dx - 6]] : [[6, dx - 6], [dx + dw + 6, W - 6]];
    for (const [x0, x1] of panes) {
      glassFill(ctx, x0, head, x1 - x0, H - head - riser);
      if (style === "traditional") {
        ctx.fillStyle = colour; ctx.fillRect(x0, head + 22, x1 - x0, 3);
        for (let x = x0 + 18; x < x1 - 8; x += 18) ctx.fillRect(x, head, 2, 22);
        ctx.strokeStyle = shade(colour, 0.6); ctx.strokeRect(x0 + 3, H - riser + 4, x1 - x0 - 6, riser - 10);
      }
    }
    ctx.fillStyle = "#24201c"; ctx.fillRect(dx, head, dw, H - head - 2);
    glassFill(ctx, dx + 4, head + 4, dw - 8, (H - head) * 0.7);
    if (pair) { ctx.fillStyle = colour; ctx.fillRect(dx + dw / 2 - 1, head, 2, H - head); }
  });
}

// ---- drawing an edit on the building ------------------------------------------------------------

//: The wall's frame in the world: its foot at ``a``, u along it (as the street sees it, left to
//: right), out from it; and ``frame`` a matrix taking (u, v, out) to the world.
function wallFrame(ctx, edit) {
  const { THREE } = ctx;
  const w = ctx.wallFromEdit(edit);
  if (!w) return null;
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(w.ux, 0, w.uz), new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(w.nx, 0, w.nz));
  m.setPosition(w.ax, w.base, w.az);
  return { ...w, matrix: m };
}

export function drawEdit(ctx, edit) {
  const { THREE } = ctx;
  if (!validEdit(edit)) return null;
  const wall = wallFrame(ctx, edit);
  if (!wall) return null;
  const group = new THREE.Group();
  group.name = `exterior-edit:${edit.osm_id}`;
  group.matrixAutoUpdate = false;
  group.matrix.copy(wall.matrix);
  const materials = new Map();
  const mat = (key, make) => { if (!materials.has(key)) materials.set(key, make()); return materials.get(key); };
  const flat = (colour, opts = {}) => mat(`flat|${colour}|${JSON.stringify(opts)}`,
    () => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.82, metalness: 0.02, ...opts }));
  const box = (u, v, out, w, h, d, material, surface) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(u + w / 2, v + h / 2, out + d / 2);
    mesh.userData.surface = surface;
    group.add(mesh);
    return mesh;
  };
  const plane = (u, v, out, w, h, material, surface) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(u + w / 2, v + h / 2, out);
    mesh.userData.surface = surface;
    group.add(mesh);
    return mesh;
  };
  const shapeMesh = (points, ox, oy, out, material, surface, holes = null, box = null) => {
    const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    if (holes) s.holes.push(new THREE.Path(holes.map(([x, y]) => new THREE.Vector2(x, y))));
    const geometry = new THREE.ShapeGeometry(s, 4);
    if (box) {
      // A picture on the shape (a door's) spans the whole opening, not a metre of it.
      const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, position.getX(i) / box[0], position.getY(i) / box[1]);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(ox, oy, out);
    mesh.userData.surface = surface;
    group.add(mesh);
    return mesh;
  };
  // The skin: the wall in its own colour over whatever the page drew on it.
  const wallColour = edit.wall_colour || ctx.wallColour;
  plane(0, 0, SKIN_OUT_M, wall.length, wall.height, ctx.wallMaterial ? ctx.wallMaterial(wallColour)
    : flat(wallColour, { roughness: 0.92 }), "wall");
  const front = SKIN_OUT_M + 0.005;
  const standing = [];
  for (const o of edit.openings) {
    const recess = Math.max(0, Math.min(1.5, o.recess_m || 0));
    if (recess > 0) {
      // An indent: the wall round the opening stands forward of it -- jambs, a head and a floor --
      // so the door or the garage sits back from the face of the house.
      const side = 0.22, wallMat = flat(wallColour, { roughness: 0.9 });
      box(o.u - side, o.v, front, side, o.h + side, recess, wallMat, "wall");
      box(o.u + o.w, o.v, front, side, o.h + side, recess, wallMat, "wall");
      box(o.u, o.v + o.h, front, o.w, side, recess, wallMat, "wall");
      if (o.v > 0.02) box(o.u - side, o.v - 0.06, front, o.w + 2 * side, 0.06, recess, flat("#8d8a84"), "pavement");
    }
    const out = front + 0.004;
    if (o.type === "window") {
      const points = outlineOf(o), f = 0.07;
      const frameCol = o.frame || "#f2f0ea";
      shapeMesh(points, o.u, o.v, out, mat(`glass|${o.glass}`, () => new THREE.MeshStandardMaterial({
        color: o.glass || "#5f7684", roughness: 0.12, metalness: 0.35, envMapIntensity: 1.4 })), "window");
      shapeMesh(points, o.u, o.v, out + 0.02, flat(frameCol, { side: THREE.DoubleSide }), "window_frame",
        inset(points, o.w, o.h, f));
      for (const [u, v, w, h] of bars(o, points)) box(o.u + u, o.v + v, out, w, h, 0.03, flat(frameCol), "window_frame");
      if (!SHAPES[o.shape]?.square && !["round", "oval", "diamond", "quatrefoil"].includes(o.shape))
        box(o.u - 0.06, o.v - 0.07, out, o.w + 0.12, 0.07, 0.1, flat(frameCol), "window_frame");
    } else if (o.type === "door") {
      const colour = o.colour || "#6b3427";
      const material = mat(`door|${o.style}|${colour}`, () => new THREE.MeshStandardMaterial({
        map: doorTexture(THREE, o.style || "panel", colour), roughness: 0.7 }));
      if (o.style === "arched") shapeMesh(outlineOf(o), o.u, o.v, out, material, "door", null, [o.w, o.h]);
      else plane(o.u, o.v, out, o.w, o.h, material, "door");
      const trim = flat(o.frame || "#f2f0ea");
      box(o.u - 0.08, o.v, out, 0.08, o.h + 0.08, 0.06, trim, "door");
      box(o.u + o.w, o.v, out, 0.08, o.h + 0.08, 0.06, trim, "door");
      if (o.style !== "arched") box(o.u - 0.08, o.v + o.h, out, o.w + 0.16, 0.08, 0.06, trim, "door");
      if (o.stairs?.steps > 0 && o.v > 0.05) {
        drawStairs(o, front + recess, box, flat);
        standing.push(stairSurface(wall, o, front, recess, ctx.groundAt));
      }
    } else if (o.type === "garage") {
      const colour = o.colour || WOOD;
      plane(o.u, o.v, out, o.w, o.h, mat(`garage|${o.style}|${colour}`, () => new THREE.MeshStandardMaterial({
        map: garageTexture(THREE, o.style || "slat", colour), roughness: 0.78 })), "garage");
      const trim = flat(o.frame || "#f2f0ea");
      box(o.u - 0.1, o.v, out, 0.1, o.h + 0.1, 0.07, trim, "garage");
      box(o.u + o.w, o.v, out, 0.1, o.h + 0.1, 0.07, trim, "garage");
      box(o.u - 0.1, o.v + o.h, out, o.w + 0.2, 0.1, 0.07, trim, "garage");
    } else if (o.type === "shopfront") {
      const colour = o.colour || "#1f2a30";
      plane(o.u, o.v, out, o.w, o.h, mat(`shop|${o.style}|${colour}|${o.door_at}|${o.pair}`,
        () => new THREE.MeshStandardMaterial({ map: shopfrontTexture(THREE, o.style || "modern", colour, o.door_at || "centre", !!o.pair),
          roughness: 0.4, metalness: 0.15 })), "storefront");
    }
  }
  group.updateMatrixWorld(true);
  // What the walker stands on: the page adds these to its standing surfaces, as it does a stoop's.
  group.userData.standing = standing;
  return group;
}

//: The stairs up to a door: ``steps`` of an even rise from the pavement to its sill, straight
//: out from it or turned to run along the wall, a landing at the top, and a rail if asked.
function drawStairs(o, out, box, flat) {
  const n = Math.max(1, Math.min(20, Math.round(o.stairs.steps)));
  const rise = o.v / n, tread = 0.28, width = o.w + 0.3, landing = 0.9;
  const stone = flat(o.stairs.colour || "#9a958c", { roughness: 0.95 }), rail = flat("#2a2a2a");
  const u0 = o.u - 0.15;
  box(u0, 0, out, width, o.v, landing, stone, "inferred:stairs");
  const dir = o.stairs.direction || "front";
  for (let k = 1; k < n; k += 1) {
    const top = o.v - k * rise;
    if (dir === "front") box(u0, 0, out + landing + (k - 1) * tread, width, top, tread, stone, "inferred:stairs");
    else {
      const s = dir === "left" ? -1 : 1;
      const u = s < 0 ? u0 - k * tread : u0 + width + (k - 1) * tread;
      box(u, 0, out, tread, top, landing, stone, "inferred:stairs");
    }
  }
  if (o.stairs.rail) {
    const posts = dir === "front"
      ? [[u0, out + landing + (n - 1) * tread], [u0 + width - 0.04, out + landing + (n - 1) * tread], [u0, out + landing], [u0 + width - 0.04, out + landing]]
      : [[u0, out + landing - 0.04], [u0 + width - 0.04, out + landing - 0.04]];
    for (const [u, z] of posts) box(u, 0, z, 0.04, o.v + 0.95, 0.04, rail, "inferred:railing");
    if (dir === "front") for (const u of [u0, u0 + width - 0.04]) box(u, o.v + 0.9, out, 0.04, 0.04, landing + (n - 1) * tread, rail, "inferred:railing");
    else box(u0, o.v + 0.9, out + landing - 0.04, width, 0.04, 0.04, rail, "inferred:railing");
  }
}

//: The same stairs as ground the walker climbs (the page's standing surfaces; see addStoop): the
//: height of the tread under a point, or null off them. Built to drawStairs' measurements, with the
//: indent's floor at the sill, and marked inferred -- a person drew them, nobody measured them.
//: ``groundAt`` lifts a tread the pavement covers (a sloping lot) to the pavement: no step down.
export function stairSurface(wall, o, front, recess = 0, groundAt = null) {
  const n = Math.max(1, Math.min(20, Math.round(o.stairs.steps)));
  const rise = o.v / n, tread = 0.28, width = o.w + 0.3, landing = 0.9, u0 = o.u - 0.15;
  const out = front + recess, dir = o.stairs.direction || "front", sill = wall.base + o.v;
  const surface = (x, z) => {
    const dx = x - wall.ax, dz = z - wall.az;
    const u = dx * wall.ux + dz * wall.uz, d = dx * wall.nx + dz * wall.nz;
    if (d < 0) return null;
    if (d < out) return recess > 0 && u >= o.u && u <= o.u + o.w ? sill : null;
    if (d <= out + landing && u >= u0 && u <= u0 + width) return sill;
    let k;
    if (dir === "front") {
      if (u < u0 || u > u0 + width) return null;
      k = Math.ceil((d - out - landing) / tread);
    } else {
      if (d > out + landing) return null;
      k = Math.ceil(dir === "left" ? (u0 - u) / tread : (u - u0 - width) / tread);
    }
    if (!(k >= 1 && k < n)) return null;
    const ground = groundAt?.(x, z);
    return Number.isFinite(ground) ? Math.max(sill - k * rise, ground) : sill - k * rise;
  };
  surface.priority = 1;
  surface.stairs = true;
  surface.inferred = true;
  surface.label = "Stairs (inferred)";
  return surface;
}

// ---- the panel -----------------------------------------------------------------------------------

const CSS = `
#xedit-shell{position:fixed;inset:0;z-index:90;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(360px,1fr);
  background:#0d1117;font:13px/1.4 system-ui,sans-serif}
#xedit-still{position:relative;min-width:0;min-height:0;background:#1b2229;overflow:hidden}
#xedit-still canvas{width:100%;height:100%;display:block;object-fit:cover}
#xedit-still .cap{position:absolute;left:14px;right:14px;bottom:12px;display:flex;align-items:center;gap:8px;color:#fff;
  text-shadow:0 1px 3px rgba(0,0,0,.7);font-size:13px}
#xedit-still .cap span{flex:1}
#xedit-still .cap button{border:1px solid rgba(255,255,255,.4);background:rgba(13,17,23,.55);color:#fff;border-radius:999px;
  width:34px;height:34px;font-size:15px;cursor:pointer;backdrop-filter:blur(6px)}
#xedit-still .cap button:hover{background:rgba(31,111,235,.75)}
#xedit-still .badge{position:absolute;top:12px;left:14px;padding:4px 10px;border-radius:999px;background:rgba(13,17,23,.6);color:#fff;font-size:12px}
#xedit-still .badge.live{background:rgba(31,111,235,.85)}
#xedit{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;
  background:var(--panel,#fff);color:var(--ink,#16202a);box-shadow:-8px 0 30px rgba(0,0,0,.35)}
@media (max-width:820px){#xedit-shell{grid-template-columns:1fr;grid-template-rows:38vh 1fr}}
#xedit .acct{display:flex;align-items:center;gap:6px;padding:6px 14px;font-size:12px;background:#f3f5f8;border-bottom:1px solid rgba(0,0,0,.08)}
#xedit .acct b{font-weight:600} #xedit .acct .ok{color:#1a7f37} #xedit .acct .who{flex:1}
#xedit .acct input{flex:1;min-width:0;padding:4px 6px;border-radius:6px;border:1px solid rgba(0,0,0,.2);font:inherit}
#xedit footer .save{background:#1f6feb;color:#fff;border-color:#1f6feb;font-weight:600;padding:7px 14px}
#xedit footer .save:hover{background:#1a5fcc}
#xedit header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(0,0,0,.1)}
#xedit header b{flex:1;font-size:14px}
#xedit .bar{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px;border-bottom:1px solid rgba(0,0,0,.08)}
#xedit button{border:1px solid rgba(0,0,0,.18);background:#f6f7f8;color:inherit;border-radius:8px;padding:5px 9px;font:inherit;cursor:pointer}
#xedit button:hover{background:#eceef1} #xedit button.on{background:#1f6feb;color:#fff;border-color:#1f6feb}
#xedit button:disabled{opacity:.45;cursor:default}
#xedit .wall{padding:8px 14px;background:#e9edf1}
#xedit svg{width:100%;height:auto;display:block;touch-action:none;background:#cfd8df;border-radius:8px}
#xedit .body{flex:1;overflow:auto;padding:10px 14px}
#xedit h4{margin:12px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;opacity:.65}
#xedit .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
#xedit .tile{display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px;font-size:10px;line-height:1.1;text-align:center}
#xedit .tile svg{background:none;width:34px;height:40px}
#xedit .row{display:flex;align-items:center;gap:8px;margin:5px 0}
#xedit .row label{width:92px;opacity:.75}
#xedit input[type=number]{width:70px;padding:4px;border-radius:6px;border:1px solid rgba(0,0,0,.2);font:inherit}
#xedit input[type=range]{flex:1}
#xedit .swatches{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
#xedit .sw{width:22px;height:22px;border-radius:6px;border:2px solid rgba(0,0,0,.15);padding:0;cursor:pointer}
#xedit .sw.on{border-color:#1f6feb;outline:2px solid #1f6feb}
#xedit footer{display:flex;gap:8px;align-items:center;padding:10px 14px;border-top:1px solid rgba(0,0,0,.1)}
#xedit footer .msg{flex:1;font-size:12px;opacity:.75}
#xedit .hint{font-size:12px;opacity:.7;margin:4px 0}
@media (prefers-color-scheme:dark){#xedit{background:#161b22;color:#e6edf3}#xedit button{background:#21262d;border-color:#30363d}
  #xedit button:hover{background:#2b3139}#xedit .wall{background:#0d1117}#xedit svg{background:#2b333b}
  #xedit .acct{background:#0d1117;border-color:#30363d}#xedit .acct input{background:#0d1117;color:inherit;border-color:#30363d}
  #xedit .acct .ok{color:#3fb950}}
`;

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k === "class") node.className = v;
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c.nodeType ? c : String(c));
  return node;
};
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const round = (x, step = SNAP_M) => Math.round(x / step) * step;
const fix = (x) => Math.round(x * 100) / 100;

let current = null;

//: Open the editor on ``feature``: the page's own description of its walls and what it drew on
//: them comes through ``ctx`` (the page's exteriorEditorContext).
export function open(ctx, feature) {
  close();
  if (!document.getElementById("xedit-css")) document.head.append(el("style", { id: "xedit-css" }, CSS));
  const id = String(feature.osm_id);
  const walls = ctx.wallsOf(feature);
  if (!walls.length) { ctx.notify?.("This building has no wall the editor can open."); return; }
  const saved = loadEdits()[id] || ctx.publishedEdit?.(id);
  let wallIndex = 0;
  if (saved && validEdit(saved)) {
    const k = walls.findIndex((w) => sameCorners(w, saved.wall));
    if (k >= 0) wallIndex = k;
  }
  const state = {
    ctx, feature, id, walls, wallIndex,
    edit: saved && validEdit(saved) && sameCorners(walls[wallIndex], saved.wall) ? structuredClone(saved)
      : startingEdit(ctx, feature, walls[wallIndex]),
    selected: null, matchFrom: null, undo: [], redo: [], group: null, dirty: false,
  };
  current = state;
  ctx.hideOriginal?.(feature, walls[wallIndex]);
  buildPanel(state);
  redraw(state);
  ctx.lookAtWall(walls[wallIndex]);
  ctx.pauseWorld?.(true);
  // The world round the wall is still arriving (its photographed facade, the trees): the still
  // is taken again as it comes in, then only when the edit changes.
  state.settling = [400, 1500, 3500, 7000].map((ms) => setTimeout(() => renderStill(state), ms));
}

export function close() {
  if (!current) return;
  const s = current;
  current = null;
  if (s.group) s.ctx.removeFromWorld(s.group);
  removeEventListener("keydown", s.keys);
  for (const t of s.settling || []) clearTimeout(t);
  clearTimeout(s.rebuild);
  s.unsubscribe?.();
  s.shell?.remove();
  s.ctx.pauseWorld?.(false);
  // What is saved is drawn as the page draws every saved edit; what is not, is gone.
  s.ctx.editsChanged?.(s.id);
}

function sameCorners(wall, ref) {
  const near = (p, q) => Math.abs(p[0] - q[0]) < 1e-7 && Math.abs(p[1] - q[1]) < 1e-7;
  return (near(wall.a, ref.a) && near(wall.b, ref.b)) || (near(wall.a, ref.b) && near(wall.b, ref.a));
}

//: The edit as the page drew the wall: its windows, doors, garages and shopfronts, so the first
//: thing the editor shows is the front everyone else sees.
function startingEdit(ctx, feature, wall) {
  const found = ctx.openingsOn(feature, wall);
  return {
    schema: SCHEMA, osm_id: String(feature.osm_id), wall: { a: wall.a, b: wall.b },
    length_m: fix(wall.length), height_m: fix(wall.height), wall_colour: ctx.wallColourOf(feature),
    openings: found.map((o) => ({ id: newId(o.type), ...o })),
    created: new Date().toISOString(),
  };
}

function snapshot(state) {
  state.undo.push(JSON.stringify(state.edit));
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
  state.dirty = true;
}
function change(state, fn) {
  snapshot(state);
  fn();
  redraw(state);
}

function buildPanel(state) {
  const { ctx, feature } = state;
  const address = feature.address?.formatted || feature.name || `Building ${state.id}`;
  const wallLabel = el("span");
  const msg = el("span", { class: "msg" });
  state.msg = (text) => { msg.textContent = text; };
  const elevation = svgEl("svg", { role: "img", "aria-label": "The wall, as seen from the street" });
  const inspector = el("div", { class: "body" });
  const tool = (label, title, fn, attrs = {}) => el("button", { title, on: { click: fn }, ...attrs }, label);
  const add = (type) => change(state, () => {
    const e = state.edit, L = state.walls[state.wallIndex].length, H = state.walls[state.wallIndex].height;
    const base = {
      window: { w: 1.0, h: 1.5, v: Math.min(H - 1.8, 3.2), shape: "rectangle", panes: { cols: 2, rows: 2 }, glass: "#5f7684", frame: "#f2f0ea" },
      door: { w: 1.0, h: 2.1, v: 0, style: "panel", colour: "#6b3427", recess_m: 0, stairs: { steps: 0, direction: "front", rail: true } },
      garage: { w: 2.6, h: 2.2, v: 0, style: "slat", colour: WOOD, recess_m: 0 },
      shopfront: { w: Math.min(6, L - 0.6), h: Math.min(3.4, H - 0.4), v: 0, style: "modern", colour: "#1f2a30", door_at: "centre", pair: false },
    }[type];
    const o = { id: newId(type), type, u: freeSpot(e.openings, L, base), ...base };
    e.openings.push(o);
    state.selected = o.id;
  });
  // The still: the wall as the world draws it, from the street, taken again on every change.
  const still = el("canvas", { "aria-label": "The wall as it looks in the world" });
  const badge = el("div", { class: "badge" }, "The wall, from the street");
  const stillPane = el("section", { id: "xedit-still", "aria-label": "The wall being edited" }, still, badge,
    el("div", { class: "cap" },
      tool("◀", "The previous wall", () => switchWall(state, -1)),
      wallLabel,
      tool("▶", "The next wall", () => switchWall(state, 1))));
  state.still = still;
  state.badge = badge;
  const acct = el("div", { class: "acct" });
  state.acct = acct;
  const panel = el("aside", { id: "xedit", "aria-label": "Exterior editor" },
    el("header", {}, el("b", {}, `Edit exterior — ${address}`),
      tool("✕", "Close the editor (Esc)", () => close())),
    acct,
    el("div", { class: "wall" },
      elevation,
      el("div", { class: "hint" }, "Click to select, drag to move, drag a corner to resize. Double-click the wall to add a window there. Every change shows on the wall at once.")),
    el("div", { class: "bar" },
      tool("+ Window", "Add a window", () => add("window")),
      tool("+ Door", "Add a door", () => add("door")),
      tool("+ Garage", "Add a garage door", () => add("garage")),
      tool("+ Shopfront", "Add a shopfront: glass and a shop door", () => add("shopfront")),
      tool("Duplicate", "A copy of the selected one beside it", () => duplicate(state)),
      tool("Delete", "Delete the selected one (Delete key)", () => remove(state)),
      tool("↶", "Undo (⌘Z)", () => undo(state)),
      tool("↷", "Redo (⇧⌘Z)", () => redo(state))),
    inspector,
    el("footer", {}, msg,
      tool("Start over", "Back to the front as it was drawn before any edit", () => reset(state)),
      el("button", { class: "save", title: "Keep this edit (⌘S): on this device, and for everyone when your account is verified",
        on: { click: () => save(state) } }, "Save changes")));
  const shell = el("div", { id: "xedit-shell", role: "dialog", "aria-modal": "true", "aria-label": `Edit exterior — ${address}` }, stillPane, panel);
  document.body.append(shell);
  state.shell = shell;
  state.panel = panel;
  drawAccount(state);
  if (ctx.account) {
    state.unsubscribe = ctx.account.onAccountChange(() => drawAccount(state));
    ctx.account.recheck();
  }
  state.wallLabel = wallLabel;
  state.svg = elevation;
  state.inspector = inspector;
  state.keys = (e) => {
    if (!current || e.target instanceof HTMLInputElement) return;
    if ((e.key === "Delete" || e.key === "Backspace") && state.selected) { e.preventDefault(); remove(state); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? redo : undo)(state); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(state); }
    else if (e.key === "Escape") { if (state.matchFrom) { state.matchFrom = null; redraw(state); } else close(); }
  };
  addEventListener("keydown", state.keys);
  wireElevation(state);
  state.msg(state.edit.openings.length ? "Showing the front as drawn. Edit it, then Save changes." : "Nothing is drawn on this wall yet: add windows and doors.");
}

function switchWall(state, step) {
  if (state.dirty && !confirm("Switch walls and drop the changes on this one that are not saved?")) return;
  state.wallIndex = (state.wallIndex + step + state.walls.length) % state.walls.length;
  const wall = state.walls[state.wallIndex];
  const saved = loadEdits()[state.id];
  state.edit = saved && validEdit(saved) && sameCorners(wall, saved.wall) ? structuredClone(saved) : startingEdit(state.ctx, state.feature, wall);
  state.selected = null; state.undo = []; state.redo = []; state.dirty = false;
  state.ctx.hideOriginal?.(state.feature, wall);
  state.ctx.lookAtWall(wall);
  redraw(state);
  for (const t of state.settling || []) clearTimeout(t);
  state.settling = [500, 2000].map((ms) => setTimeout(() => renderStill(state), ms));
}

function selectedOpening(state) { return state.edit.openings.find((o) => o.id === state.selected) || null; }
function duplicate(state) {
  const o = selectedOpening(state);
  if (!o) return state.msg("Select something to duplicate.");
  change(state, () => {
    const L = state.walls[state.wallIndex].length;
    const copy = { ...structuredClone(o), id: newId(o.type), u: Math.min(L - o.w, o.u + o.w + 0.4) };
    state.edit.openings.push(copy);
    state.selected = copy.id;
  });
}
function remove(state) {
  const o = selectedOpening(state);
  if (!o) return;
  change(state, () => { state.edit.openings = state.edit.openings.filter((x) => x !== o); state.selected = null; });
}
function undo(state) {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.edit));
  state.edit = JSON.parse(state.undo.pop());
  redraw(state);
}
function redo(state) {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.edit));
  state.edit = JSON.parse(state.redo.pop());
  redraw(state);
}
function reset(state) {
  if (!confirm("Remove your edit of this building and go back to the front as it was drawn?")) return;
  forgetEdit(state.id);
  if (state.ctx.account?.account().verified) state.ctx.account.removeCanonicalEdit(state.id);
  snapshot(state);
  state.edit = startingEdit(state.ctx, state.feature, state.walls[state.wallIndex]);
  state.ctx.editsChanged?.(state.id);
  state.selected = null;
  state.dirty = false;
  redraw(state);
  state.msg("Reset. The page's own front is back after a reload.");
}
//: Save changes: on this device always; in the canonical world too from a verified account.
async function save(state) {
  state.edit.updated = new Date().toISOString();
  state.edit.length_m = fix(state.walls[state.wallIndex].length);
  const local = saveEdit(state.edit);
  state.ctx.editsChanged?.(state.id, state.edit);
  state.dirty = false;
  const who = state.ctx.account?.account();
  if (!who?.verified) {
    state.msg(local ? "Saved on this device. Verify your account to change it for everyone."
      : "This browser would not keep it (private window?): it is drawn until you leave.");
    return;
  }
  state.msg("Saving for everyone…");
  const out = await state.ctx.account.saveCanonicalEdit(state.edit);
  if (current !== state) return;
  state.msg(out.canonical ? `Saved for everyone, as ${who.editor || "a verified editor"}.`
    : `Saved on this device; not for everyone yet (${out.why}). Save again to retry.`);
}

function drawAccount(state) {
  const box = state.acct, account = state.ctx.account;
  if (!box) return;
  if (!account) { box.replaceChildren(el("span", { class: "who" }, "Saves stay on this device.")); return; }
  const who = account.account();
  if (who.verified) {
    box.replaceChildren(el("span", { class: "who" }, el("span", { class: "ok" }, "✔ Verified editor "), el("b", {}, who.editor || who.name || "")),
      el("span", {}, "Saves change the world for everyone."));
    return;
  }
  const input = el("input", { type: "password", placeholder: "Paste your editor key", autocomplete: "off", "aria-label": "Editor key" });
  const go = el("button", { type: "button", title: "Check the key and keep it on this device" }, "Verify");
  const verify = async () => {
    go.disabled = true;
    const out = await account.verify(input.value);
    go.disabled = false;
    if (!out.ok) state.msg(out.why); else state.msg(`Verified as ${out.name}. Save changes now updates the world for everyone.`);
  };
  go.addEventListener("click", verify);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); verify(); } });
  box.replaceChildren(el("span", { class: "who" }, "Not verified: saves stay on this device."), input, go);
}

//: The still on the left: the page renders the wall from the street into it.
function renderStill(state) {
  if (current !== state || !state.still) return;
  const ok = state.ctx.renderWallStill?.(state.walls[state.wallIndex], state.still);
  state.badge.textContent = ok === false ? "The wall (still loading)" : state.dirty ? "Preview: not saved yet" : "The wall, from the street";
  state.badge.classList.toggle("live", Boolean(state.dirty));
}

// ---- the elevation ---------------------------------------------------------------------------

function wireElevation(state) {
  const svg = state.svg;
  const toWall = (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, state.walls[state.wallIndex].height - p.y];
  };
  let drag = null;
  svg.addEventListener("pointerdown", (e) => {
    const target = e.target.closest("[data-id]");
    const handle = e.target.closest("[data-handle]");
    const [u, v] = toWall(e);
    if (!target) { state.selected = null; redraw(state); return; }
    const o = state.edit.openings.find((x) => x.id === target.dataset.id);
    if (state.matchFrom && o && o.id !== state.matchFrom) {
      const src = state.edit.openings.find((x) => x.id === state.matchFrom);
      if (src) change(state, () => { const cx = o.u + o.w / 2; o.w = src.w; o.h = src.h; o.u = fix(cx - o.w / 2); if (src.shape) o.shape = src.shape; });
      state.msg("Size copied. Click another to copy it again, or Esc.");
      return;
    }
    state.selected = o.id;
    drag = { o, start: [u, v], from: { u: o.u, v: o.v, w: o.w, h: o.h }, handle: handle?.dataset.handle || null, moved: false };
    try { svg.setPointerCapture(e.pointerId); } catch { /* a pointer the page did not see go down */ }
    redraw(state, false);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [u, v] = toWall(e);
    const du = u - drag.start[0], dv = v - drag.start[1];
    if (!drag.moved) {
      if (Math.hypot(du, dv) < 0.02) return;
      snapshot(state);
      drag.moved = true;
    }
    const { o, from, handle } = drag;
    const free = e.shiftKey;
    const snap = (x) => (free ? x : round(x));
    if (!handle) {
      o.u = snap(from.u + du); o.v = Math.max(0, snap(from.v + dv));
      if (!free) alignTo(state, o);
    } else {
      if (handle.includes("l")) { o.u = snap(Math.min(from.u + from.w - 0.2, from.u + du)); o.w = fix(from.u + from.w - o.u); }
      if (handle.includes("r")) o.w = Math.max(0.2, snap(from.w + du));
      if (handle.includes("b")) { o.v = Math.max(0, snap(Math.min(from.v + from.h - 0.2, from.v + dv))); o.h = fix(from.v + from.h - o.v); }
      if (handle.includes("t")) o.h = Math.max(0.2, snap(from.h + dv));
      if (SHAPES[o.shape]?.square) o.h = o.w;
    }
    o.u = fix(o.u); o.v = fix(o.v); o.w = fix(o.w); o.h = fix(o.h);
    redraw(state, false);
  });
  const end = () => { if (drag) { drag = null; redraw(state); } };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", (e) => {
    if (e.target.closest("[data-id]")) return;
    const [u, v] = toWall(e);
    change(state, () => {
      const o = { id: newId("window"), type: "window", u: fix(round(u - 0.5)), v: fix(Math.max(0.3, round(v - 0.75))), w: 1.0, h: 1.5,
        shape: "rectangle", panes: { cols: 2, rows: 2 }, glass: "#5f7684", frame: "#f2f0ea" };
      state.edit.openings.push(o);
      state.selected = o.id;
    });
  });
}

//: A dragged opening lines up with the others: its sill or head with theirs, its sides with
//: theirs, within ALIGN_M.
function alignTo(state, o) {
  for (const other of state.edit.openings) {
    if (other === o) continue;
    for (const [mine, theirs] of [[o.v, other.v], [o.v + o.h, other.v + other.h]]) {
      if (Math.abs(mine - theirs) < ALIGN_M) { o.v += theirs - mine; break; }
    }
    for (const [mine, theirs] of [[o.u, other.u], [o.u + o.w, other.u + other.w], [o.u + o.w / 2, other.u + other.w / 2]]) {
      if (Math.abs(mine - theirs) < ALIGN_M) { o.u += theirs - mine; break; }
    }
  }
}

function drawElevation(state) {
  const svg = state.svg;
  const wall = state.walls[state.wallIndex];
  const L = wall.length, H = wall.height, pad = 0.6;
  svg.setAttribute("viewBox", `${-pad} ${-pad} ${L + 2 * pad} ${H + 2 * pad}`);
  svg.replaceChildren();
  const g = svgEl("g", { transform: `translate(0 ${H}) scale(1 -1)` });
  svg.append(g);
  g.append(svgEl("rect", { x: 0, y: 0, width: L, height: H, fill: state.edit.wall_colour || "#c8c2b8", stroke: "#333", "stroke-width": 0.04 }));
  g.append(svgEl("line", { x1: -pad, y1: 0, x2: L + pad, y2: 0, stroke: "#555", "stroke-width": 0.06 }));
  for (let y = 3; y < H - 0.5; y += 3) g.append(svgEl("line", { x1: 0, y1: y, x2: L, y2: y, stroke: "rgba(0,0,0,.18)", "stroke-width": 0.03, "stroke-dasharray": "0.2 0.2" }));
  for (const o of state.edit.openings) {
    const sel = o.id === state.selected, matching = o.id === state.matchFrom;
    const node = svgEl("g", { "data-id": o.id, transform: `translate(${o.u} ${o.v})`, style: "cursor:move" });
    const points = outlineOf(o);
    const fill = o.type === "window" ? (o.glass || "#5f7684") : o.type === "door" ? (o.colour || "#6b3427")
      : o.type === "garage" ? (o.colour || WOOD) : "#2f4552";
    node.append(svgEl("polygon", { points: points.map((p) => p.join(",")).join(" "), fill,
      stroke: o.type === "window" ? (o.frame || "#f2f0ea") : "#f2f0ea", "stroke-width": 0.07 }));
    if (o.type === "window") for (const [u, v, w, h] of bars(o, points)) node.append(svgEl("rect", { x: u, y: v, width: w, height: h, fill: o.frame || "#f2f0ea" }));
    if (o.type === "door" && o.stairs?.steps > 0 && o.v > 0.05) {
      const n = o.stairs.steps, step = o.v / n;
      for (let k = 0; k < n; k += 1) node.append(svgEl("rect", { x: -0.15, y: -o.v + k * step, width: o.w + 0.3, height: step, fill: "#9a958c", stroke: "#6d6962", "stroke-width": 0.02 }));
    }
    if (o.recess_m > 0) node.append(svgEl("rect", { x: -0.22, y: 0, width: o.w + 0.44, height: o.h + 0.22, fill: "none", stroke: "rgba(0,0,0,.45)", "stroke-width": 0.05 }));
    if (sel || matching) {
      node.append(svgEl("rect", { x: -0.05, y: -0.05, width: o.w + 0.1, height: o.h + 0.1, fill: "none",
        stroke: matching ? "#e3a008" : "#1f6feb", "stroke-width": 0.06, "stroke-dasharray": "0.18 0.1" }));
      if (sel) for (const [hx, hy, k] of [[0, 0, "lb"], [o.w, 0, "rb"], [o.w, o.h, "rt"], [0, o.h, "lt"], [o.w / 2, o.h, "t"], [o.w, o.h / 2, "r"]]) {
        node.append(svgEl("rect", { x: hx - 0.13, y: hy - 0.13, width: 0.26, height: 0.26, fill: "#fff", stroke: "#1f6feb", "stroke-width": 0.04, "data-handle": k, style: "cursor:nwse-resize" }));
      }
    }
    g.append(node);
  }
  state.wallLabel.textContent = `Wall ${state.wallIndex + 1} of ${state.walls.length} · ${L.toFixed(1)} m × ${H.toFixed(1)} m${wall.street ? " · street side" : ""}`;
}

// ---- the inspector ------------------------------------------------------------------------------

function numberRow(label, value, set, { min = 0, max = 30, step = 0.05 } = {}) {
  const input = el("input", { type: "number", value: fix(value), min, max, step });
  const range = el("input", { type: "range", value, min, max, step });
  const apply = (v) => { if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v))); };
  input.addEventListener("change", () => apply(Number(input.value)));
  range.addEventListener("change", () => apply(Number(range.value)));
  return el("div", { class: "row" }, el("label", {}, label), range, input);
}
function swatchRow(label, colours, value, set) {
  const custom = el("input", { type: "color", value: value || colours[0], title: "Any colour" });
  custom.addEventListener("change", () => set(custom.value));
  return el("div", {}, el("h4", {}, label), el("div", { class: "swatches" },
    ...colours.map((c) => el("button", { class: `sw${c === value ? " on" : ""}`, style: `background:${c}`, title: c, on: { click: () => set(c) } })),
    custom));
}
// Where a new opening goes: the middle of the widest stretch of wall its height band leaves
// clear of the openings already there, so a new door does not land on the garage.
function freeSpot(openings, length, box) {
  const busy = openings.filter((o) => o.v < box.v + box.h && box.v < o.v + o.h)
    .map((o) => [o.u - 0.15, o.u + o.w + 0.15]).sort((a, b) => a[0] - b[0]);
  let best = null, at = 0.1;
  for (const [a, b] of [...busy, [length - 0.1, length]]) {
    if (a - at >= box.w && (!best || a - at > best[1] - best[0])) best = [at, a];
    at = Math.max(at, b);
  }
  if (!best) return fix(Math.max(0.1, length / 2 - box.w / 2));
  return fix((best[0] + best[1]) / 2 - box.w / 2);
}
function tiles(options, value, set, thumb) {
  return el("div", { class: "grid" }, ...Object.entries(options).map(([key, name]) =>
    el("button", { class: `tile${key === value ? " on" : ""}`, title: typeof name === "string" ? name : name.name, on: { click: () => set(key) } },
      thumb ? thumb(key) : null, typeof name === "string" ? name : name.name)));
}
function shapeThumb(key) {
  const s = svgEl("svg", { viewBox: "-0.1 -0.1 1.2 1.6" });
  const pts = SHAPES[key].outline(1, SHAPES[key].square ? 1 : 1.4).map(([x, y]) => `${x},${1.4 - y}`).join(" ");
  s.append(svgEl("polygon", { points: pts, fill: "#5f7684", stroke: "#888", "stroke-width": 0.05 }));
  return s;
}
function stepper(label, value, set, min, max) {
  return el("div", { class: "row" }, el("label", {}, label),
    el("button", { on: { click: () => set(Math.max(min, value - 1)) } }, "−"),
    el("b", {}, String(value)),
    el("button", { on: { click: () => set(Math.min(max, value + 1)) } }, "+"));
}

function drawInspector(state) {
  const box = state.inspector;
  box.replaceChildren();
  const o = selectedOpening(state);
  const wall = state.walls[state.wallIndex];
  const edit = (fn) => change(state, fn);
  box.append(swatchRow("Wall colour", ["#d9d2c3", "#c8c2b8", "#e8e4da", "#9fb3bf", "#6f8f7a", "#b5715a", "#3b4f6b", "#f2efe6"],
    state.edit.wall_colour, (c) => edit(() => { state.edit.wall_colour = c; })));
  if (!o) {
    box.append(el("p", { class: "hint" }, "Select a window, door or garage on the wall above, or add one."));
    const windows = state.edit.openings.filter((x) => x.type === "window");
    if (windows.length > 1) box.append(el("div", { class: "row" },
      el("button", { on: { click: () => edit(() => { const v = Math.min(...windows.map((w) => w.v)); for (const w of windows) if (Math.abs(w.v - v) < 0.4) w.v = v; }) } }, "Line up the lowest row"),
      el("button", { on: { click: () => edit(() => { const first = windows[0]; for (const w of windows) { const c = w.u + w.w / 2; w.w = first.w; w.h = first.h; w.u = fix(c - w.w / 2); } }) } }, "Make all windows one size")));
    return;
  }
  const kind = { window: "Window", door: "Door", garage: "Garage door", shopfront: "Shopfront" }[o.type];
  box.append(el("h4", {}, `${kind} — size and place`));
  box.append(numberRow("Width (m)", o.w, (v) => edit(() => { const c = o.u + o.w / 2; o.w = v; o.u = fix(c - v / 2); if (SHAPES[o.shape]?.square) o.h = v; }), { min: 0.2, max: wall.length, step: 0.05 }));
  box.append(numberRow("Height (m)", o.h, (v) => edit(() => { o.h = v; if (SHAPES[o.shape]?.square) o.w = v; }), { min: 0.2, max: wall.height, step: 0.05 }));
  box.append(numberRow("From left (m)", o.u, (v) => edit(() => { o.u = v; }), { min: -1, max: wall.length, step: 0.05 }));
  box.append(numberRow("Above ground (m)", o.v, (v) => edit(() => { o.v = v; }), { min: 0, max: wall.height, step: 0.05 }));
  box.append(el("div", { class: "row" },
    el("button", { title: "Ten per cent bigger", on: { click: () => edit(() => scale(o, 1.1)) } }, "Bigger"),
    el("button", { title: "Ten per cent smaller", on: { click: () => edit(() => scale(o, 1 / 1.1)) } }, "Smaller"),
    el("button", { class: state.matchFrom === o.id ? "on" : "", title: "Then click the windows that should be this size",
      on: { click: () => { state.matchFrom = state.matchFrom === o.id ? null : o.id; state.msg(state.matchFrom ? "Click the windows to give this size. Esc to stop." : ""); redraw(state, false); } } }, "Copy size to…")));
  if (o.type === "window") {
    const same = (fn) => edit(() => { for (const x of state.edit.openings) if (x !== o && x.type === "window" && fn(x)) { const c = x.u + x.w / 2; x.w = o.w; x.h = o.h; x.u = fix(c - x.w / 2); } });
    box.append(el("div", { class: "row" },
      el("button", { on: { click: () => same((x) => Math.abs(x.v - o.v) < 0.5) } }, "Size to this row"),
      el("button", { on: { click: () => same(() => true) } }, "Size to every window"),
      el("button", { on: { click: () => edit(() => { for (const x of state.edit.openings) if (x.type === "window" && Math.abs(x.v - o.v) < 0.5) x.v = o.v; }) } }, "Level this row")));
    box.append(el("h4", {}, "Shape"));
    box.append(tiles(SHAPES, o.shape || "rectangle", (k) => edit(() => { o.shape = k; if (SHAPES[k].square) o.h = o.w; }), shapeThumb));
    box.append(el("h4", {}, "Panes"));
    box.append(stepper("Across", o.panes?.cols || 1, (n) => edit(() => { o.panes = { ...(o.panes || {}), cols: n }; }), 1, 10));
    box.append(stepper("Down", o.panes?.rows || 1, (n) => edit(() => { o.panes = { ...(o.panes || {}), rows: n }; }), 1, 10));
    box.append(el("div", { class: "row" }, el("button", { on: { click: () => edit(() => { o.panes = { cols: 1, rows: 1 }; }) } }, "One pane, no bars")));
    box.append(swatchRow("Pane colour", GLASS_COLOURS, o.glass, (c) => edit(() => { o.glass = c; })));
    box.append(swatchRow("Frame colour", FRAME_COLOURS, o.frame, (c) => edit(() => { o.frame = c; })));
  } else if (o.type === "door") {
    box.append(el("h4", {}, "Style"));
    box.append(tiles(DOOR_STYLES, o.style || "panel", (k) => edit(() => {
      o.style = k;
      if (["double_panel", "french"].includes(k) && o.w < 1.5) { const c = o.u + o.w / 2; o.w = 1.7; o.u = fix(c - 0.85); }
    })));
    box.append(swatchRow("Door colour", DOOR_COLOURS, o.colour, (c) => edit(() => { o.colour = c; })));
    box.append(swatchRow("Trim colour", FRAME_COLOURS, o.frame, (c) => edit(() => { o.frame = c; })));
    box.append(el("h4", {}, "Indent and stairs"));
    box.append(numberRow("Indent (m)", o.recess_m || 0, (v) => edit(() => { o.recess_m = v; }), { min: 0, max: 1.5, step: 0.05 }));
    const stairs = o.stairs || { steps: 0, direction: "front", rail: true };
    box.append(stepper("Steps", stairs.steps, (n) => edit(() => {
      o.stairs = { ...stairs, steps: n };
      // The door stands at the top of its stairs: a rise of about 18 cm a step.
      // A door still at the height its stairs gave it follows the count; one moved by hand stays.
      const following = o.v < 0.1 || Math.abs(o.v - stairs.steps * 0.18) < 0.02;
      if (following) o.v = Math.min(fix(n * 0.18), fix(wall.height - o.h));
    }), 0, 20));
    box.append(el("div", { class: "row" }, el("label", {}, "Stairs run"),
      ...["front", "left", "right"].map((d) => el("button", { class: stairs.direction === d ? "on" : "", on: { click: () => edit(() => { o.stairs = { ...stairs, direction: d }; }) } },
        { front: "Out", left: "Left", right: "Right" }[d])),
      el("button", { class: stairs.rail ? "on" : "", on: { click: () => edit(() => { o.stairs = { ...stairs, rail: !stairs.rail }; }) } }, "Railing")));
  } else if (o.type === "garage") {
    box.append(el("h4", {}, "Style"));
    box.append(tiles(GARAGE_STYLES, o.style || "slat", (k) => edit(() => { o.style = k; })));
    box.append(swatchRow("Door colour", [WOOD, "#6b4a2b", "#f2f0ea", "#1d1f21", "#7b8186", "#2f4a37", "#3b4f6b", "#b5715a"], o.colour, (c) => edit(() => { o.colour = c; })));
    box.append(el("h4", {}, "Indent"));
    box.append(numberRow("Indent (m)", o.recess_m || 0, (v) => edit(() => { o.recess_m = v; }), { min: 0, max: 1.5, step: 0.05 }));
  } else if (o.type === "shopfront") {
    box.append(el("h4", {}, "Style"));
    box.append(tiles(SHOPFRONT_STYLES, o.style || "modern", (k) => edit(() => { o.style = k; })));
    box.append(el("div", { class: "row" }, el("label", {}, "Door"),
      ...["left", "centre", "right"].map((d) => el("button", { class: (o.door_at || "centre") === d ? "on" : "", on: { click: () => edit(() => { o.door_at = d; }) } }, d)),
      el("button", { class: o.pair ? "on" : "", on: { click: () => edit(() => { o.pair = !o.pair; }) } }, "Double")));
    box.append(swatchRow("Frame colour", ["#1f2a30", "#1d1f21", "#2f4a37", "#6b3427", "#f2f0ea", "#3b4f6b", "#7b8186", "#b23a2f"], o.colour, (c) => edit(() => { o.colour = c; })));
  }
}
function scale(o, k) {
  const cu = o.u + o.w / 2;
  o.w = fix(Math.max(0.2, o.w * k)); o.h = fix(Math.max(0.2, o.h * k));
  o.u = fix(cu - o.w / 2);
}

function redraw(state, full = true) {
  drawElevation(state);
  if (full) drawInspector(state);
  clearTimeout(state.rebuild);
  state.rebuild = setTimeout(() => {
    if (current !== state) return;
    if (state.group) state.ctx.removeFromWorld(state.group);
    state.group = drawEdit(state.ctx, state.edit);
    if (state.group) state.ctx.addToWorld(state.group);
    requestAnimationFrame(() => renderStill(state));
  }, 60);
}
