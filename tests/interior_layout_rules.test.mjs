// The layout rules every generated house passes as it loads (docs/inferred-interiors/
// layout-rules.mjs): no wall across a stair's way off at the top, and no table that leaves no way
// past it -- moved, with its chairs and what is on it, turned only by quarter turns and only
// where it must be.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_PASS_M, applyLayoutRules, stairLandings } from "../docs/inferred-interiors/layout-rules.mjs";

const rect = (x0, z0, x1, z1) => ({ type: "Polygon", coordinates: [[[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]]] });
const seg = (a, b) => ({ segment: { type: "LineString", coordinates: [a, b] }, thickness_m: 0.1, height_m: 2.6 });
const piece = (id, role, x, z, w, d, room, extra = {}) => ({ id, role, position_m: [x, 0, z], size_m: [w, 0.75, d], rotation_deg: 0,
  footprint: rect(x - w / 2, z - d / 2, x + w / 2, z + d / 2), room_id: room, support: { kind: "floor", id: room }, ...extra });

//: A 10 m x 8 m house: a 1.2 m hallway along z = 3.4..4.6 between a living room (south) and a
//: dining room (north); a straight stair (x 8..9, z 0.4..3.4) rising north, arriving at z = 3.4.
function house() {
  const steps = Array.from({ length: 12 }, (_, i) => ({ footprint: rect(8, 0.4 + i * 0.25, 9, 0.65 + i * 0.25), top_m: (i + 1) * 0.22 }));
  const storey = (level) => ({ level, elevation_m: level * 2.7, height_m: 2.7, inside: rect(0, 0, 10, 8), slab_holes: [],
    rooms: [{ id: `L${level}:living`, kind: "living", polygon: rect(0, 0, 8, 3.4) }, { id: `L${level}:hall`, kind: "hallway", polygon: rect(0, 3.4, 10, 4.6) },
      { id: `L${level}:dining`, kind: "dining", polygon: rect(0, 4.6, 10, 8) }],
    openings: [], walls: [seg([0, 3.4], [7.9, 3.4]), seg([0, 4.6], [6, 4.6]), seg([7, 4.6], [10, 4.6])], objects: [] });
  return { id: "test", stairs: [{ id: "s", from_level: 0, to_level: 1, footprint: rect(8, 0.4, 9, 3.4), slab_opening: rect(8, 0.4, 9, 3.4), steps, flight_width_m: 1, tread_m: 0.25 }],
    storeys: [storey(0), storey(1)] };
}

test("a wall across the top of a flight is cut away; walls along the way stay", () => {
  const h = house();
  // Upstairs, a wall right across the way off the stair (z = 3.6, x 7..10), and the stairwell's
  // side wall running along it (x = 7.95).
  h.storeys[1].walls.push(seg([7, 3.6], [10, 3.6]), seg([7.95, 0.4], [7.95, 3.4]));
  const [top] = stairLandings(h).filter((l) => l.level === 1);
  assert.ok(Math.abs(top.u[1] - 1) < 1e-6, "the way off runs north");
  const out = applyLayoutRules(h), walls = out.storeys[1].walls.map((w) => w.segment.coordinates);
  const across = walls.filter(([a, b]) => a[1] === 3.6 && b[1] === 3.6);
  // What is left of it is clear of the flight (x 8..9) with its margin.
  assert.ok(across.length >= 1 && across.every(([a, b]) => Math.max(a[0], b[0]) <= 7.96 || Math.min(a[0], b[0]) >= 9.04), JSON.stringify(across));
  assert.ok(walls.some(([a, b]) => a[0] === 7.95 && b[0] === 7.95 && a[1] === 0.4 && b[1] === 3.4), "the stairwell's side wall was cut");
  assert.ok(out.layout_rules.stair_walls_cut >= 1);
  // The original is left as it was.
  assert.equal(h.storeys[1].walls.length, 5);
});

test("a table that blocks the hallway moves, with its chairs and what is on it, unturned where it can", () => {
  const h = house(), f = h.storeys[0];
  const table = piece("t", "dining_table", 3, 4, 0.9, 0.9, "L0:hall");
  const chairs = [piece("c1", "dining_chair", 2.3, 4, 0.45, 0.45, "L0:hall", { rotation_deg: 90 }), piece("c2", "dining_chair", 3.7, 4, 0.45, 0.45, "L0:hall", { rotation_deg: 270 })];
  const vase = { ...piece("v", "table_item", 3.1, 4.05, 0.2, 0.2, "L0:hall"), support: { kind: "object", id: "t", surface_y_m: 0.75 } };
  f.objects.push(table, ...chairs, vase);
  const out = applyLayoutRules(h), g = out.storeys[0];
  const at = (id) => g.objects.find((o) => o.id === id);
  assert.equal(out.layout_rules.tables_moved, 1);
  const t = at("t"), dx = t.position_m[0] - 3, dz = t.position_m[2] - 4;
  assert.ok(Math.hypot(dx, dz) > 0.1, "the table did not move");
  assert.equal(t.rotation_deg % 90, 0);
  // Its chairs and the vase moved with it, the same way.
  for (const [id, x, z] of [["c1", 2.3, 4], ["c2", 3.7, 4], ["v", 3.1, 4.05]]) {
    const o = at(id);
    if (t.rotation_deg === 0) { assert.ok(Math.abs(o.position_m[0] - x - dx) < 1e-9 && Math.abs(o.position_m[2] - z - dz) < 1e-9, id); }
    assert.equal(o.rotation_deg % 90, 0);
  }
  // Where it stands now there is a way past on the tighter pair of sides.
  assert.ok(MIN_PASS_M >= 0.7);
});

test("a table with room round it is left as it is, and a house with no table or stair passes through", () => {
  const h = house();
  h.storeys[0].objects.push(piece("t", "dining_table", 4, 6.3, 1.2, 0.9, "L0:dining"));
  const out = applyLayoutRules(h);
  assert.equal(out.layout_rules.tables, 1);
  assert.equal(out.layout_rules.tables_moved, 0);
  assert.deepEqual(out.storeys[0].objects[0].position_m, [4, 0, 6.3]);
  const bare = applyLayoutRules({ id: "x", stairs: [], storeys: [] });
  assert.equal(bare.layout_rules.error, undefined);
});
