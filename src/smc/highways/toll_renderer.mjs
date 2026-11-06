// Toll plazas and gantries (smc/highways/tolls.py), drawn to Caltrans' standard dimensions on the
// road each stands on: a gantry is a truss over the whole carriageway and its shoulders, 6.1 m
// clear, with a reader and a camera over every lane; a booth is a kiosk on a raised island with a
// yellow impact attenuator at the nose facing the traffic; a plaza's canopy is a slab over the
// lanes on posts. Copied to docs/highway-toll-renderer.mjs by scripts/build_highway_tolls.py; the
// page imports it with THREE and the ground's heights, so nothing here knows the page.

export const GANTRY_CLEARANCE_M = 6.1;
export const SHOULDER_M = 3.0;
export const CANOPY_CLEARANCE_M = 5.6;
const ISLAND_M = { length: 14, width: 1.6, height: 0.2 };
const BOOTH_M = { length: 2.0, width: 1.4, height: 2.6 };

function stripes(doc, THREE) {
  const c = doc.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#f2c200"; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#151515";
  for (let i = -64; i < 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 80, 64); g.lineTo(i + 64, 64); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

//: Where each toll stands, in its own frame: x to the right of the traffic, z back towards it
//: (the traffic comes from +z), y up from the road. Pure, for the tests.
export function gantryLayout(record) {
  const lanes = Math.max(1, record.lanes || Math.round((record.width_m || 11) / 3.66));
  const road = record.width_m || lanes * 3.66;
  const half = road / 2 + SHOULDER_M;
  const lane = road / lanes;
  return { half, clearance: GANTRY_CLEARANCE_M, readers: Array.from({ length: lanes }, (_, i) => -road / 2 + lane * (i + 0.5)) };
}

export function buildTolls(THREE, records, { place, ground, decks, document: doc = globalThis.document } = {}) {
  const group = new THREE.Group();
  group.name = "highway-tolls";
  const steel = new THREE.MeshStandardMaterial({ color: 0x9a9fa4, metalness: 0.6, roughness: 0.42 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.3, roughness: 0.5 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.9 });
  const booth = new THREE.MeshStandardMaterial({ color: 0xd9d4c7, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x31485a, metalness: 0.4, roughness: 0.12, envMapIntensity: 1.3 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6, side: THREE.DoubleSide });
  const attenuator = new THREE.MeshStandardMaterial({ map: doc ? stripes(doc, THREE) : null, color: doc ? 0xffffff : 0xf2c200, roughness: 0.6 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const counts = {};
  const part = (parent, material, [x, y, z], [w, h, d], surface) => {
    const m = new THREE.Mesh(box, material);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.userData = { surface, provenance: "inferred_visual_not_measured" };
    parent.add(m);
    return m;
  };
  // The road as the world draws it there: a deck where one is drawn over the spot (a bridge's
  // approach may be carried on a viaduct the plaza in fact stands at grade beside), else the ground.
  const roadTop = (x, z) => {
    const over = decks ? decks(x, z) : [];
    return over.length ? Math.max(...over) : ground(x, z);
  };
  const framed = (record) => {
    const { x, z } = place(record.p[0], record.p[1]);
    const y0 = roadTop(x, z);
    if (!Number.isFinite(y0)) return null;
    const frame = new THREE.Group();
    frame.position.set(x, y0, z);
    frame.rotation.y = -((record.bearing || 0) * Math.PI) / 180;
    frame.userData = { toll: record.id, kind: record.kind, name: record.name || null, basis: record.basis };
    return frame;
  };
  const outlined = (record, base, top, material, surface) => {
    const pts = record.outline.map(([lon, lat]) => place(lon, lat));
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: top - base, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = base;
    mesh.userData = { surface, toll: record.id, provenance: "inferred_visual_not_measured" };
    return { mesh, pts };
  };
  for (const r of records) {
    if (!Array.isArray(r?.p)) continue;
    if (r.kind === "toll_gantry") {
      const frame = framed(r);
      if (!frame) continue;
      const { half, clearance, readers } = gantryLayout(r);
      for (const side of [-1, 1]) {
        part(frame, steel, [side * half, (clearance + 1.4) / 2, 0], [0.55, clearance + 1.4, 0.55], "furniture:toll_gantry");
        part(frame, concrete, [side * half, 0.3, 0], [1.1, 0.6, 1.1], "furniture:toll_gantry");
      }
      // The truss: two chords and the box between them.
      part(frame, steel, [0, clearance + 1.2, 0], [2 * half + 0.6, 0.3, 0.9], "furniture:toll_gantry");
      part(frame, steel, [0, clearance + 0.15, 0], [2 * half + 0.6, 0.3, 0.9], "furniture:toll_gantry");
      part(frame, steel, [0, clearance + 0.68, 0.4], [2 * half, 0.8, 0.06], "furniture:toll_gantry");
      for (const u of readers) {
        part(frame, dark, [u, clearance - 0.25, 0.1], [0.55, 0.4, 0.45], "furniture:toll_reader");
        part(frame, dark, [u + 0.7, clearance - 0.15, 0.25], [0.22, 0.22, 0.4], "furniture:toll_camera");
      }
      group.add(frame);
    } else if (r.kind === "toll_booth") {
      const frame = framed(r);
      if (!frame) continue;
      part(frame, concrete, [0, ISLAND_M.height / 2, 0], [ISLAND_M.width, ISLAND_M.height, ISLAND_M.length], "furniture:toll_island");
      const b = BOOTH_M;
      part(frame, booth, [0, ISLAND_M.height + b.height / 2, 0], [b.width, b.height, b.length], "furniture:toll_booth");
      part(frame, glass, [0, ISLAND_M.height + 1.75, 0], [b.width + 0.04, 0.9, b.length * 0.8], "furniture:toll_booth");
      part(frame, roof, [0, ISLAND_M.height + b.height + 0.08, 0], [b.width + 0.5, 0.16, b.length + 0.5], "furniture:toll_booth");
      // The nose meets the traffic: an attenuator on the upstream end of the island.
      part(frame, attenuator, [0, 0.55, ISLAND_M.length / 2 + 1.6], [0.9, 0.9, 3.2], "furniture:toll_attenuator");
      group.add(frame);
    } else if ((r.kind === "toll_canopy" || r.kind === "toll_booth_building") && Array.isArray(r.outline) && r.outline.length >= 3) {
      const c = place(r.p[0], r.p[1]);
      const base = roadTop(c.x, c.z);
      if (!Number.isFinite(base)) continue;
      if (r.kind === "toll_canopy") {
        const { mesh, pts } = outlined(r, base + CANOPY_CLEARANCE_M, base + CANOPY_CLEARANCE_M + 0.9, roof, "furniture:toll_canopy");
        group.add(mesh);
        // Posts at the outline's corners, set in a little.
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        const corners = pts.slice(0, pts.length - (pts.length > 3 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].z - pts.at(-1).z) < 0.1 ? 1 : 0));
        for (const p of corners) {
          const d = Math.hypot(cx - p.x, cz - p.z) || 1, x = p.x + (cx - p.x) / d * 0.6, z = p.z + (cz - p.z) / d * 0.6;
          const post = part(group, steel, [x, 0, z], [0.45, CANOPY_CLEARANCE_M, 0.45], "furniture:toll_canopy");
          post.position.y = base + CANOPY_CLEARANCE_M / 2;
        }
      } else {
        group.add(outlined(r, base, base + 2.8, booth, "furniture:toll_booth").mesh);
      }
    } else continue;
    counts[r.kind] = (counts[r.kind] || 0) + 1;
  }
  group.userData.summary = { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  return group;
}
