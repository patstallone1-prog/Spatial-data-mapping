// Freeway guide signs (smc/highways/signs.py): each record's panel drawn to the California MUTCD's
// layout -- white legend on green, the exit number on a tab over the right edge, the routes'
// shields above the places -- and stood on what carries it: a truss over the lanes, two posts at
// the right shoulder, the gore's posts between the ramp and the road, or a route marker's post.
// Copied to docs/highway-sign-renderer.mjs by scripts/build_highway_signs.py; the page imports it
// with THREE and the ground's heights, so nothing here knows the page.

export const GREEN = "#00704a";
const WHITE = "#ffffff";
//: Legend sizes, metres (CA MUTCD Table 2E-4, freeway guide signs: 16 in capitals, 12 in lower
//: case; 13.3 in for an exit tab's). Panels grow to fit their legend and no further.
const M = { margin: 0.35, line: 0.62, text: 0.42, shield: 1.05, shieldText: 0.3, distance: 0.48,
  arrow: 0.85, tab: 0.62, tabText: 0.34, gap: 0.3 };
const CLEARANCE_M = 5.3;          // 17 ft 4 in under an overhead panel (Caltrans Highway Design Manual 309.2)
const ROADSIDE_BOTTOM_M = 2.1;    // 7 ft to a roadside panel's bottom
const SHOULDER_M = 3.0;
const MAX_PX = 1024;
const FONT = "'Roboto Condensed','Arial Narrow',Arial,Helvetica,sans-serif";

//: Where each part of a panel goes, in metres from its top-left, given a ``measure(text, size)``
//: that answers the width of text at that capital height. Pure, so it is tested without a page.
export function layoutSign(sign, measure) {
  const legend = sign.legend || {};
  const shields = legend.shields || [];
  const lines = (legend.lines || []).filter(Boolean);
  if (sign.kind === "route_marker") {
    const w = Math.max(1.2, shields.length * (M.shield + M.gap) - M.gap + 2 * 0.15);
    return { w, h: 0.45 + M.shield + 0.3, kind: "marker", shields, tab: null };
  }
  const rows = [];
  let y = M.margin, width = 0;
  if (shields.length) {
    const shieldsW = shields.length * (M.shield + M.gap) - M.gap;
    rows.push({ type: "shields", y, h: M.shield + M.shieldText, w: shieldsW });
    width = Math.max(width, shieldsW);
    y += M.shield + M.shieldText + M.gap;
  }
  for (const text of lines) {
    const size = sign.kind === "gore" ? M.text * 1.15 : M.text;
    const w = measure(text, size);
    rows.push({ type: "text", text, y, h: M.line, size, w });
    width = Math.max(width, w);
    y += M.line;
  }
  if (legend.distance) {
    const w = measure(legend.distance, M.distance * 0.75);
    rows.push({ type: "text", text: legend.distance, y: y + 0.1, h: M.distance, size: M.distance * 0.75, w });
    width = Math.max(width, w);
    y += M.distance + 0.1;
  }
  if (legend.arrow) {
    rows.push({ type: "arrow", arrow: legend.arrow, y: y + 0.05, h: M.arrow, w: M.arrow });
    width = Math.max(width, M.arrow);
    y += M.arrow + 0.05;
  }
  const w = Math.min(9, Math.max(sign.kind === "gore" ? 1.5 : 3, width + 2 * M.margin));
  const h = Math.max(sign.kind === "gore" ? 1.2 : 1.8, y + M.margin);
  const tab = legend.tab ? { text: legend.tab, w: measure(legend.tab, M.tabText) + 0.5, h: M.tab } : null;
  return { w, h, rows, tab, kind: "guide" };
}

function shieldPath(ctx, net, x, y, w, h) {
  ctx.beginPath();
  if (net === "I") {
    ctx.moveTo(x, y + h * 0.1);
    ctx.quadraticCurveTo(x + w * 0.25, y - h * 0.02, x + w / 2, y + h * 0.1);
    ctx.quadraticCurveTo(x + w * 0.75, y - h * 0.02, x + w, y + h * 0.1);
    ctx.bezierCurveTo(x + w * 1.02, y + h * 0.6, x + w * 0.7, y + h * 0.88, x + w / 2, y + h);
    ctx.bezierCurveTo(x + w * 0.3, y + h * 0.88, x - w * 0.02, y + h * 0.6, x, y + h * 0.1);
  } else if (net === "US") {
    ctx.moveTo(x + w * 0.08, y);
    ctx.lineTo(x + w * 0.92, y);
    ctx.quadraticCurveTo(x + w * 0.9, y + h * 0.12, x + w, y + h * 0.2);
    ctx.bezierCurveTo(x + w, y + h * 0.75, x + w * 0.6, y + h * 0.82, x + w / 2, y + h);
    ctx.bezierCurveTo(x + w * 0.4, y + h * 0.82, x, y + h * 0.75, x, y + h * 0.2);
    ctx.quadraticCurveTo(x + w * 0.1, y + h * 0.12, x + w * 0.08, y);
  } else {
    // California's spade.
    ctx.moveTo(x + w / 2, y);
    ctx.bezierCurveTo(x + w * 0.62, y + h * 0.12, x + w, y + h * 0.18, x + w, y + h * 0.45);
    ctx.bezierCurveTo(x + w, y + h * 0.8, x + w * 0.65, y + h * 0.95, x + w / 2, y + h);
    ctx.bezierCurveTo(x + w * 0.35, y + h * 0.95, x, y + h * 0.8, x, y + h * 0.45);
    ctx.bezierCurveTo(x, y + h * 0.18, x + w * 0.38, y + h * 0.12, x + w / 2, y);
  }
  ctx.closePath();
}

function drawShield(ctx, shield, x, y, s, k) {
  // s: the shield's size in metres; k: pixels a metre.
  const px = x * k, py = y * k, w = s * k, h = s * k;
  const digits = String(shield.ref).length;
  const font = (frac) => `bold ${Math.round(h * frac)}px ${FONT}`;
  if (shield.net === "I") {
    ctx.save(); shieldPath(ctx, "I", px, py, w, h); ctx.fillStyle = WHITE; ctx.fill(); ctx.clip();
    ctx.fillStyle = "#c8102e"; ctx.fillRect(px, py, w, h * 0.3);
    ctx.fillStyle = "#003f87"; ctx.fillRect(px, py + h * 0.34, w, h);
    ctx.restore();
    ctx.fillStyle = WHITE; ctx.font = font(0.13); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("INTERSTATE", px + w / 2, py + h * 0.19);
    ctx.font = font(digits > 2 ? 0.4 : 0.5); ctx.fillText(shield.ref, px + w / 2, py + h * 0.62);
  } else if (shield.net === "US") {
    ctx.fillStyle = "#000"; ctx.fillRect(px - w * 0.05, py - h * 0.05, w * 1.1, h * 1.1);
    shieldPath(ctx, "US", px, py, w, h); ctx.fillStyle = WHITE; ctx.fill();
    ctx.fillStyle = "#000"; ctx.font = font(digits > 2 ? 0.42 : 0.52); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(shield.ref, px + w / 2, py + h * 0.47);
  } else {
    shieldPath(ctx, "CA", px, py, w, h); ctx.fillStyle = WHITE; ctx.fill();
    shieldPath(ctx, "CA", px + w * 0.05, py + h * 0.05, w * 0.9, h * 0.9); ctx.fillStyle = GREEN; ctx.fill();
    ctx.fillStyle = WHITE; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = font(0.1); ctx.fillText("CALIFORNIA", px + w / 2, py + h * 0.28);
    ctx.font = font(digits > 2 ? 0.38 : 0.46); ctx.fillText(shield.ref, px + w / 2, py + h * 0.6);
  }
}

function drawArrow(ctx, kind, cx, y, s) {
  ctx.save();
  ctx.translate(cx, y + s / 2);
  if (kind === "up_right") ctx.rotate(Math.PI / 4);
  else if (kind === "down") ctx.rotate(Math.PI);
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(0, -s / 2); ctx.lineTo(s * 0.35, -s * 0.1); ctx.lineTo(s * 0.12, -s * 0.1);
  ctx.lineTo(s * 0.12, s / 2); ctx.lineTo(-s * 0.12, s / 2); ctx.lineTo(-s * 0.12, -s * 0.1);
  ctx.lineTo(-s * 0.35, -s * 0.1); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

//: The panel's face as a canvas: the green, its white border, and the legend laid out above.
export function paintSign(document, sign, layout) {
  const canvas = document.createElement("canvas");
  const k = Math.min(128, MAX_PX / Math.max(layout.w, layout.h));
  canvas.width = Math.ceil(layout.w * k); canvas.height = Math.ceil(layout.h * k);
  const ctx = canvas.getContext("2d");
  if (layout.kind === "marker") {
    ctx.fillStyle = WHITE; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.round(0.3 * k)}px ${FONT}`;
    const pitch = M.shield + M.gap;
    layout.shields.forEach((shield, i) => {
      const x = 0.15 + i * pitch;
      ctx.fillStyle = "#000"; ctx.fillText(shield.dir || "", (x + M.shield / 2) * k, 0.24 * k);
      drawShield(ctx, shield, x, 0.45, M.shield, k);
    });
    return canvas;
  }
  ctx.fillStyle = GREEN; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = WHITE; ctx.lineWidth = Math.max(2, 0.06 * k);
  roundRect(ctx, 0.08 * k, 0.08 * k, canvas.width - 0.16 * k, canvas.height - 0.16 * k, 0.15 * k); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = WHITE;
  for (const row of layout.rows) {
    if (row.type === "shields") {
      const shields = sign.legend.shields;
      const x0 = (layout.w - row.w) / 2;
      shields.forEach((shield, i) => {
        const x = x0 + i * (M.shield + M.gap);
        ctx.fillStyle = WHITE; ctx.font = `bold ${Math.round(M.shieldText * 0.8 * k)}px ${FONT}`;
        if (shield.dir) ctx.fillText(shield.dir, (x + M.shield / 2) * k, (row.y + M.shieldText * 0.45) * k);
        drawShield(ctx, shield, x, row.y + M.shieldText, M.shield, k);
      });
    } else if (row.type === "text") {
      ctx.fillStyle = WHITE; ctx.font = `bold ${Math.round(row.size * 1.4 * k)}px ${FONT}`;
      ctx.fillText(row.text, (layout.w / 2) * k, (row.y + row.h / 2) * k, (layout.w - 2 * M.margin) * k);
    } else if (row.type === "arrow") {
      drawArrow(ctx, row.arrow, (layout.w / 2) * k, row.y * k, row.h * k);
    }
  }
  return canvas;
}

function paintTab(document, tab) {
  const canvas = document.createElement("canvas");
  const k = 128;
  canvas.width = Math.ceil(tab.w * k); canvas.height = Math.ceil(tab.h * k);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = GREEN; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = WHITE; ctx.lineWidth = 0.05 * k;
  roundRect(ctx, 0.06 * k, 0.06 * k, canvas.width - 0.12 * k, canvas.height - 0.12 * k, 0.1 * k); ctx.stroke();
  ctx.fillStyle = WHITE; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(M.tabText * 1.4 * k)}px ${FONT}`;
  ctx.fillText(tab.text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

//: Every sign as one group of meshes. ``place(lon, lat)`` answers the page's {x, z};
//: ``ground(x, z)`` the ground's height; ``decks(x, z)`` the heights of the elevated roads over
//: the point (a sign on a viaduct stands on its deck). ``maxPanels`` caps the textures made.
export function buildHighwaySigns(THREE, signs, { place, ground, decks, document: doc = globalThis.document,
  maxPanels = 240 } = {}) {
  const group = new THREE.Group();
  group.name = "highway-signs";
  const measureCanvas = doc.createElement("canvas").getContext("2d");
  const measure = (text, size) => {
    const px = 100;
    measureCanvas.font = `bold ${px * 1.4}px ${FONT}`;
    return (measureCanvas.measureText(text).width / px) * size;
  };
  const steel = new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.6, roughness: 0.45 });
  const back = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.5, roughness: 0.5 });
  const post = new THREE.CylinderGeometry(0.16, 0.2, 1, 10);
  const counts = {};
  const textures = [];
  const panel = (canvas, w, h) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
    texture.anisotropy = 4;
    textures.push(texture);
    const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.35, metalness: 0.05 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), [back, back, back, back, face, back]);
    mesh.userData = { surface: "furniture:highway_sign" };
    return mesh;
  };
  const stand = (parent, x, y0, z, height) => {
    const mesh = new THREE.Mesh(post, steel);
    mesh.scale.set(1, height, 1);
    mesh.position.set(x, y0 + height / 2, z);
    mesh.userData = { surface: "furniture:sign_gantry" };
    parent.add(mesh);
  };
  for (const sign of signs.slice(0, maxPanels)) {
    const { x, z } = place(sign.p[0], sign.p[1]);
    const over = sign.deck && decks ? decks(x, z) : [];
    const y0 = over.length ? Math.max(...over) : ground(x, z);
    if (!Number.isFinite(y0)) continue;
    const layout = layoutSign(sign, measure);
    const theta = sign.bearing * Math.PI / 180;
    // The sign's own frame: x to the right of the traffic, z towards it (the face looks back
    // down the road), y up. Its origin is the carriageway's middle at road level.
    const frame = new THREE.Group();
    frame.position.set(x, y0, z);
    frame.rotation.y = -theta;
    const face = panel(paintSign(doc, sign, layout), layout.w, layout.h);
    const half = (sign.width_m || 11) / 2;
    if (sign.mount === "overhead") {
      // Over the right-hand lanes, from a truss across the whole carriageway.
      const right = half + SHOULDER_M;
      const centre = Math.max(0, half - layout.w / 2 - 0.5);
      const top = CLEARANCE_M + layout.h;
      face.position.set(centre, CLEARANCE_M + layout.h / 2, 0);
      const truss = new THREE.Mesh(new THREE.BoxGeometry(2 * right, 0.7, 0.7), steel);
      truss.position.set(0, CLEARANCE_M + layout.h * 0.55, -0.5);
      truss.userData = { surface: "furniture:sign_gantry" };
      frame.add(truss);
      stand(frame, -right, 0, -0.5, top);
      stand(frame, right, 0, -0.5, top);
    } else if (sign.mount === "gore") {
      face.position.set(0, ROADSIDE_BOTTOM_M + layout.h / 2, 0);
      stand(frame, -layout.w * 0.3, 0, -0.1, ROADSIDE_BOTTOM_M + layout.h);
      stand(frame, layout.w * 0.3, 0, -0.1, ROADSIDE_BOTTOM_M + layout.h);
    } else {
      const off = half + SHOULDER_M + 0.5 + layout.w / 2;
      face.position.set(off, ROADSIDE_BOTTOM_M + layout.h / 2, 0);
      if (layout.w > 2) {
        stand(frame, off - layout.w * 0.3, 0, -0.1, ROADSIDE_BOTTOM_M + layout.h);
        stand(frame, off + layout.w * 0.3, 0, -0.1, ROADSIDE_BOTTOM_M + layout.h);
      } else {
        stand(frame, off, 0, -0.1, ROADSIDE_BOTTOM_M + layout.h);
      }
    }
    frame.add(face);
    if (layout.tab) {
      const tab = panel(paintTab(doc, layout.tab), layout.tab.w, layout.tab.h);
      tab.position.set(face.position.x + layout.w / 2 - layout.tab.w / 2,
        face.position.y + layout.h / 2 + layout.tab.h / 2, 0);
      frame.add(tab);
    }
    frame.userData = { surface: "furniture:highway_sign", sign: sign.id, kind: sign.kind, basis: sign.basis };
    group.add(frame);
    counts[sign.kind] = (counts[sign.kind] || 0) + 1;
  }
  group.userData = { summary: { drawn: Object.values(counts).reduce((a, b) => a + b, 0), kinds: counts,
    offered: signs.length, basis: "inferred from OpenStreetMap exits and ramp destinations" } };
  group.userData.dispose = () => textures.forEach((t) => t.dispose());
  return group;
}
