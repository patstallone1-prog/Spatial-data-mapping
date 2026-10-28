// The object catalogue in the page: what a drawn thing is, what it is made of, and whether the
// walker goes over it, through it, under it or around it.
//
// docs/object-catalogue.json is the one copy (src/smc/world/catalogue.py validates it and the
// Unreal importer reads it). This module resolves a mesh's surface name to its archetype the
// same way, and keeps the things within the player's interaction radius as colliders: the same
// radius inside which they are described (nearby()). Nothing outside it is solid to the walker,
// and nothing inside it is left out.
//
// A mesh is solid where it is between the walker's step height and head clearance: the part of a
// street light's pole at body height stops the walker, its arm and lamp overhead do not, and a
// kerb low enough to step on is stepped over. What a soft archetype is (a shrub, long grass) the
// walker passes through, slowed. Basis never relaxes any of this: an inferred tree is as solid as
// a measured one and is reported as inferred.

//: Horizontal layers a mesh's own geometry is cut into, to find what of it is at body height.
const LAYERS = 12;
//: Grid cell for indexing instances and triangles (metres).
const CELL_M = 8;
//: How far the walker moves before the colliders round it are gathered again (metres).
const REFRESH_M = 0.75;
//: What is the ground, a building or a view overlay is not an object round the player: the ground
//: code stands the walker on it and the footprints hold it out of the buildings.
const NOT_NEARBY = new Set(["ground", "water", "view"]);
//: Parts of one thing (a street light's pole, arm and lamp) within this of each other are one line.
const SAME_THING_M = 2.5;
//: A part listed under the thing it belongs to: a crown is its tree's.
const PART_OF = { "vegetation.foliage": "vegetation.tree" };
//: Which of a thing's parts says how it is passed: the most solid one.
const TRAVERSAL_RANK = { go_around: 5, enter: 5, climb_over: 4, step_over: 3, walk_under: 2, pass_through: 1, walk_on: 0, swim: 0 };

export function normalise(surface) {
  const name = String(surface ?? "").split("|")[0].trim().toLowerCase();
  return name.replace(" ", ":");
}

export function createCatalogue(data) {
  const exact = data.surfaces.exact, prefixes = Object.keys(data.surfaces.prefix).sort((a, b) => b.length - a.length);
  const memo = new Map();
  function resolve(surface) {
    const name = normalise(surface);
    if (memo.has(name)) return memo.get(name);
    let id = exact[name] ?? null;
    if (!id && name.endsWith("_post")) id = exact[name.slice(0, -5)] ?? null;
    if (!id) { const p = prefixes.find((q) => name.startsWith(q)); id = p ? data.surfaces.prefix[p] : null; }
    memo.set(name, id);
    return id;
  }
  function archetype(surface) {
    const id = resolve(surface);
    return id ? { id, ...data.archetypes[id] } : null;
  }
  return { data, player: data.player, resolve, archetype, material: (id) => data.materials[id] || null,
    traversalText: (t) => data.traversal[t] || t };
}

//: A tree's leaf cards are its crown, not its trunk: the same split the Unreal exporter makes.
function surfaceOf(o) {
  const s = o.userData?.surface ?? o.parent?.userData?.surface;
  if (!s) return null;
  const material = Array.isArray(o.material) ? o.material[0] : o.material;
  if (String(s).startsWith("tree:") && material?.alphaTest > 0) return String(s).replace(/^tree:/, "foliage:");
  return s;
}

function basisOf(o, i, surface) {
  const u = o.userData || {};
  if (Array.isArray(u.instanceBasis) && u.instanceBasis[i]) return u.instanceBasis[i];
  // A park's equipment laid out to fill a mapped area is named so ("park:playground:fill").
  if (u.inferred || /:fill$|^inferred:/.test(String(surface || ""))) return "inferred";
  if (u.basis) return String(u.basis);
  if (u.source) return `mapped (${u.source})`;
  return "mapped";
}

// Per geometry, in its own frame: its height range and, for each of LAYERS slices of it, the
// horizontal box of every triangle that reaches into that slice.
const layerCache = new WeakMap();
function layersOf(geometry) {
  if (layerCache.has(geometry)) return layerCache.get(geometry);
  const pos = geometry.getAttribute("position");
  if (!pos || !pos.count) { layerCache.set(geometry, null); return null; }
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i += 1) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const h = Math.max(1e-6, y1 - y0), boxes = Array.from({ length: LAYERS }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  const index = geometry.index, n = index ? index.count : pos.count;
  for (let t = 0; t + 2 < n; t += 3) {
    let tx0 = Infinity, tz0 = Infinity, tx1 = -Infinity, tz1 = -Infinity, ty0 = Infinity, ty1 = -Infinity;
    for (let k = 0; k < 3; k += 1) {
      const v = index ? index.getX(t + k) : t + k, x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (z < tz0) tz0 = z; if (z > tz1) tz1 = z; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
    }
    const a = Math.max(0, Math.floor((ty0 - y0) / h * LAYERS)), b = Math.min(LAYERS - 1, Math.floor((ty1 - y0) / h * LAYERS));
    for (let l = a; l <= b; l += 1) {
      const box = boxes[l];
      if (tx0 < box[0]) box[0] = tx0; if (tz0 < box[1]) box[1] = tz0; if (tx1 > box[2]) box[2] = tx1; if (tz1 > box[3]) box[3] = tz1;
    }
  }
  const out = { y0, h, boxes };
  layerCache.set(geometry, out);
  return out;
}

function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

//: Whether a circle of radius r at (x, z) touches the convex outline pts ([x0, z0, x1, z1, ...]).
export function circleTouches(pts, x, z, r) {
  if (pts.length >= 6 && pointInPolygon(x, z, pts)) return true;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2)
    if (segmentDistance(x, z, pts[j], pts[j + 1], pts[i], pts[i + 1]) < r) return true;
  return false;
}

/**
 * The colliders and the description of what is round the player.
 *
 * roots() returns the groups to look in; it is asked again every few seconds, for what has
 * loaded since. update(x, feetY, z) gathers what is within the interaction radius when the
 * walker has moved; blocked(), speedAt() and nearby() answer from that.
 */
export function createProximity({ THREE, catalogue, roots, reindexMs = 4000 }) {
  const player = catalogue.player;
  const radius = player.interaction_radius_m, step = player.step_height_m, clearance = player.head_clearance_m;
  let candidates = [], indexedAt = -Infinity, at = null, colliders = [], described = [];
  const grids = new WeakMap(), m = new THREE.Matrix4(), v = new THREE.Vector3(), sphere = new THREE.Sphere();

  function reindex() {
    candidates = [];
    for (const root of roots()) root?.traverse?.((o) => {
      if (!o.isMesh || !o.geometry) return;
      const surface = surfaceOf(o);
      const a = surface && catalogue.archetype(surface);
      if (!a || NOT_NEARBY.has(a.family) || a.collision.source === "footprint" || a.collision.source === "host") return;
      const solid = a.collision.source === "mesh" && a.collision.blocks.includes("character");
      const soft = a.traversal === "pass_through" && a.speed < 1;
      // Ground, buildings and the layers that keep their own colliders are only described.
      candidates.push({ o, a, surface, solid, soft });
    });
    indexedAt = performance.now();
  }

  // Per mesh, once: where each instance (or, for a merged mesh, each triangle) is, by grid cell.
  function gridOf(c) {
    let g = grids.get(c.o);
    if (g && g.count === (c.o.isInstancedMesh ? c.o.count : 1) && g.version === c.o.matrixWorld.elements[12] + c.o.matrixWorld.elements[14]) return g;
    const o = c.o, cells = new Map(), put = (x, z, item) => {
      const key = `${Math.floor(x / CELL_M)}:${Math.floor(z / CELL_M)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(item);
    };
    o.updateWorldMatrix(true, false);
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i += 1) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); v.setFromMatrixPosition(m);
        put(v.x, v.z, i);
      }
    } else if (c.solid) {
      const pos = o.geometry.getAttribute("position"), index = o.geometry.index, n = index ? index.count : pos.count;
      const tri = [];
      for (let t = 0; t + 2 < n; t += 3) {
        const p = [];
        let y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < 3; k += 1) {
          v.fromBufferAttribute(pos, index ? index.getX(t + k) : t + k).applyMatrix4(o.matrixWorld);
          p.push(v.x, v.z); if (v.y < y0) y0 = v.y; if (v.y > y1) y1 = v.y;
        }
        tri.push({ p, y0, y1 });
        put((p[0] + p[2] + p[4]) / 3, (p[1] + p[3] + p[5]) / 3, tri.length - 1);
      }
      cells.triangles = tri;
    } else {
      // A merged soft or descriptive mesh: known by where it is, not triangle by triangle.
      o.geometry.boundingSphere || o.geometry.computeBoundingSphere();
      sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      put(sphere.center.x, sphere.center.z, -1);
      cells.sphere = sphere.clone();
    }
    g = { cells, count: o.isInstancedMesh ? o.count : 1, version: o.matrixWorld.elements[12] + o.matrixWorld.elements[14] };
    grids.set(o, g);
    return g;
  }

  // An instance's outline at body height: the union of its layers between step height and head
  // clearance above the feet, turned and placed by its matrix. Null where none of it is there.
  function instanceOutline(c, i, feet) {
    const layers = layersOf(c.o.geometry);
    if (!layers) return null;
    c.o.getMatrixAt(i, m); m.premultiply(c.o.matrixWorld);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, low = Infinity, high = -Infinity;
    for (let l = 0; l < LAYERS; l += 1) {
      const box = layers.boxes[l];
      if (box[0] > box[2]) continue;
      const ya = layers.y0 + layers.h * l / LAYERS, yb = layers.y0 + layers.h * (l + 1) / LAYERS;
      let wy0 = Infinity, wy1 = -Infinity;
      for (const y of [ya, yb]) for (const x of [box[0], box[2]]) for (const z of [box[1], box[3]]) {
        v.set(x, y, z).applyMatrix4(m); if (v.y < wy0) wy0 = v.y; if (v.y > wy1) wy1 = v.y;
      }
      if (wy0 < low) low = wy0; if (wy1 > high) high = wy1;
      if (wy1 <= feet + step || wy0 >= feet + clearance) continue;
      if (box[0] < x0) x0 = box[0]; if (box[1] < z0) z0 = box[1]; if (box[2] > x1) x1 = box[2]; if (box[3] > z1) z1 = box[3];
    }
    const mid = { low, high };
    // A trunk is solid where it stands; its limbs give way. Its lowest layer, wherever it reaches
    // into the walker's height.
    if (c.a.collision.shape === "trunk" && x0 <= x1) {
      const base = layers.boxes.find((box) => box[0] <= box[2]);
      [x0, z0, x1, z1] = base;
    }
    if (x0 > x1) return { pts: null, ...mid };
    const ymid = layers.y0 + layers.h / 2, pts = [];
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) { v.set(x, ymid, z).applyMatrix4(m); pts.push(v.x, v.z); }
    return { pts, ...mid };
  }

  function update(x, feet, z, force = false) {
    const now = performance.now();
    if (now - indexedAt > reindexMs) { reindex(); force = true; }
    if (!force && at && Math.hypot(x - at.x, z - at.z) < REFRESH_M && Math.abs(feet - at.feet) < 0.5) return false;
    at = { x, z, feet };
    colliders = []; described = [];
    const reach = Math.ceil(radius / CELL_M);
    for (const c of candidates) {
      const o = c.o;
      o.geometry.boundingSphere || o.geometry.computeBoundingSphere();
      if (!o.isInstancedMesh) {
        sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
        if (Math.hypot(sphere.center.x - x, sphere.center.z - z) > sphere.radius + radius) continue;
      }
      const g = gridOf(c), gx = Math.floor(x / CELL_M), gz = Math.floor(z / CELL_M);
      for (let dx = -reach; dx <= reach; dx += 1) for (let dz = -reach; dz <= reach; dz += 1) {
        for (const item of g.cells.get(`${gx + dx}:${gz + dz}`) || []) {
          if (o.isInstancedMesh) {
            const out = instanceOutline(c, item, feet);
            if (!out) continue;
            o.getMatrixAt(item, m); m.premultiply(o.matrixWorld); v.setFromMatrixPosition(m);
            const d = Math.hypot(v.x - x, v.z - z);
            if (d > radius) continue;
            described.push({ c, i: item, d, low: out.low, high: out.high, ax: v.x, az: v.z });
            if (out.pts && (c.solid || c.soft)) colliders.push({ c, i: item, pts: out.pts });
          } else if (g.cells.triangles) {
            const t = g.cells.triangles[item];
            if (t.y1 <= feet + step || t.y0 >= feet + clearance) continue;
            const d = Math.hypot((t.p[0] + t.p[2] + t.p[4]) / 3 - x, (t.p[1] + t.p[3] + t.p[5]) / 3 - z);
            if (d > radius) continue;
            colliders.push({ c, i: -1, pts: t.p });
            if (!described.some((e) => e.c === c)) described.push({ c, i: -1, d, low: t.y0, high: t.y1,
              ax: (t.p[0] + t.p[2] + t.p[4]) / 3, az: (t.p[1] + t.p[3] + t.p[5]) / 3 });
          } else if (g.cells.sphere) {
            const s = g.cells.sphere, d = Math.max(0, Math.hypot(s.center.x - x, s.center.z - z) - s.radius);
            if (d <= radius) described.push({ c, i: -1, d, low: s.center.y - s.radius, high: s.center.y + s.radius,
              ax: s.center.x, az: s.center.z });
          }
        }
      }
    }
    return true;
  }

  return {
    radius,
    update,
    reindex,
    //: Whether a walker of radius r standing at (x, z) is inside something solid at body height.
    blocked(x, z, r) {
      for (const k of colliders) if (k.c.solid && circleTouches(k.pts, x, z, r)) return k;
      return null;
    },
    //: The walking speed's fraction at (x, z): 1 in the open, less in a shrub or long grass.
    speedAt(x, z, r = 0) {
      let speed = 1;
      for (const k of colliders) if (k.c.soft && k.c.a.speed < speed && circleTouches(k.pts, x, z, r)) speed = k.c.a.speed;
      return speed;
    },
    //: What is round the player within the interaction radius, nearest first, one line per thing.
    nearby(limit = 6) {
      const out = [];
      for (const e of described.sort((a, b) => a.d - b.d)) {
        const a = e.c.a;
        let traversal = a.traversal;
        // What the walker actually does with this part, at its height above the feet.
        if (at && Number.isFinite(e.high) && e.high <= at.feet + step && a.traversal !== "pass_through") traversal = "step_over";
        else if (at && Number.isFinite(e.low) && e.low >= at.feet + clearance) traversal = "walk_under";
        const same = out.find((r) => r.archetype === a.id && Math.hypot(r.ax - e.ax, r.az - e.az) < SAME_THING_M);
        if (same) {
          if ((TRAVERSAL_RANK[traversal] ?? 0) > (TRAVERSAL_RANK[same.traversal] ?? 0)) same.traversal = traversal;
          continue;
        }
        const material = catalogue.material(a.material);
        out.push({ archetype: a.id, name: a.name, surface: e.c.surface, distance_m: +e.d.toFixed(1), traversal,
          material: material?.name, friction: material?.friction, breaks: a.durability.breaks, dies: a.durability.dies || null,
          basis: basisOf(e.c.o, e.i, e.c.surface), interactions: a.interactions, ax: e.ax, az: e.az });
      }
      const whole = out.filter((r) => !PART_OF[r.archetype] || !out.some((w) => w.archetype === PART_OF[r.archetype]
        && Math.hypot(w.ax - r.ax, w.az - r.az) < SAME_THING_M));
      return whole.slice(0, limit).map(({ ax, az, ...row }) => row);
    },
    stats: () => ({ candidates: candidates.length, colliders: colliders.length, described: described.length }),
    //: Surface names in the scene the catalogue does not know: kept empty by the catalogue tests.
    unresolved() {
      const missing = new Map();
      for (const root of roots()) root?.traverse?.((o) => {
        const s = o.isMesh && surfaceOf(o);
        if (s && !catalogue.resolve(s)) missing.set(s, (missing.get(s) || 0) + 1);
      });
      return Object.fromEntries(missing);
    },
  };
}
