// ---- how fine the ground has to be cut, place by place ----
//
// A surface is cut against a world lattice, and the lattice used to be one spacing for the
// whole city per surface kind: 2 m for plaza, 16 m for yards and parks. A single spacing
// cannot be right everywhere. On the flat of the Sunset a 16 m triangle lies on the ground;
// on Nob Hill the same triangle spans six metres of relief and sags metres through it, and the
// hill comes up through the lawn as the grey angular holes at 625 Pine and around St Mary's
// Square. Measured over this corridor's 2 m terrain grid, a 16 m span holds a median of 1.02 m
// of relief and 6.00 m at the 95th percentile.
//
// What decides the spacing is two things about a place, not one:
//
// *The total incline over the cell*, in degrees, rather than its average slope. A uniform
// grade and a flight of steps can share an average and need completely different meshes: the
// grade is a plane a coarse triangle sits on, the steps are a shape it bridges. Summing the
// angle of every step across the cell separates them -- a cell of dramatic ups and downs
// accumulates a large total however flat its ends are relative to each other.
//
// *How much is drawn on it.* Bare hillside nobody paves can stay coarse however steep it is;
// a cell carrying yards, paths, parks and plazas is one where the sag shows, and is worth the
// triangles. The count comes from the ground cover's own rings.
const LATTICE_CELL_M = 32.0;
//: Degrees of accumulated incline across one cell, and what each earns. The finest is the
//: terrain grid's own step, below which there is nothing left to resolve.
//: Tempered once already. Running the finest step down to the terrain grid's own two metres
//: took the corridor to 83 ms a frame -- twelve pictures a second, on a machine that draws the
//: unmodified model comfortably -- for a last few centimetres nobody can see. Four metres is
//: where the sag stops being visible and the frame rate survives.
const LATTICE_BY_INCLINE = [
  [600, 4.0],   // a cliff, a stair, a retaining wall
  [300, 6.0],
  [150, 8.0],
  [60, 12.0],
  [0, 16.0],    // flat ground: as it was
];
//: Cover rings over a cell that count as "much is drawn here", and the step finer it earns.
const LATTICE_BUSY_RINGS = 6;
//: Never coarser than this where anything is drawn at all.
const LATTICE_DRAWN_MAX_M = 12.0;

const latticeField = new Map();
let latticeCover = null;
//: The ground cover, once it has been fetched. The lattice reads it to tell a cell that
//: carries yards and paths from bare hillside nobody paves.
let GROUND = null;

function latticeCoverCounts() {
  // How many ground-cover rings touch each cell, by the rings' own vertices. The cover is what
  // makes a sag visible: it is drawn over the hill, and the hill comes through it.
  if (latticeCover) return latticeCover;
  latticeCover = new Map();
  const ground = (typeof GROUND === "object" && GROUND) || {};
  for (const key of ["parks", "yards", "lawns", "front_walks", "service_yards", "backyards",
                     "plazas", "courts", "pitches", "court_complexes"]) {
    for (const ring of ground[key] || []) {
      const pts = ring.p || ring;
      if (!Array.isArray(pts)) continue;
      const seen = new Set();
      for (const q of pts) {
        if (!Array.isArray(q) || q.length < 2) continue;
        const [x, y] = xy(q[0], q[1]);
        const cell = `${Math.floor(x / LATTICE_CELL_M)}:${Math.floor(-y / LATTICE_CELL_M)}`;
        if (seen.has(cell)) continue;      // one ring counts once per cell
        seen.add(cell);
        latticeCover.set(cell, (latticeCover.get(cell) || 0) + 1);
      }
    }
  }
  return latticeCover;
}

function latticeAt(x, z) {
  // The lattice spacing for the cell this point is in, worked out once per cell.
  if (!TERRAIN_FRAME) return TERRAIN_REFINE_M;
  const cx = Math.floor(x / LATTICE_CELL_M);
  const cz = Math.floor(z / LATTICE_CELL_M);
  // A number for the hot lookup (twice per edge cut, millions of times); the string only for
  // the once-per-cell count of rings.
  const known = latticeField.get(cx * 1048576 + cz);
  if (known !== undefined) return known;
  const key = `${cx}:${cz}`;
  // Total incline: the angle of every step of the terrain grid across the cell, added up.
  const step = TERRAIN_FRAME.step_m;
  const x0 = cx * LATTICE_CELL_M;
  const z0 = cz * LATTICE_CELL_M;
  let degrees = 0;
  let previousRow = null;
  for (let j = 0; j <= LATTICE_CELL_M; j += step) {
    const row = [];
    for (let i = 0; i <= LATTICE_CELL_M; i += step) {
      row.push(terrainHeightAt(x0 + i, z0 + j));
    }
    for (let i = 1; i < row.length; i += 1) {
      degrees += Math.atan2(Math.abs(row[i] - row[i - 1]), step) * 180 / Math.PI;
    }
    if (previousRow) {
      for (let i = 0; i < row.length; i += 1) {
        degrees += Math.atan2(Math.abs(row[i] - previousRow[i]), step) * 180 / Math.PI;
      }
    }
    previousRow = row;
  }
  let spacing = TERRAIN_REFINE_M;
  for (const [over, metres] of LATTICE_BY_INCLINE) {
    if (degrees >= over) { spacing = metres; break; }
  }
  const rings = latticeCoverCounts().get(key) || 0;
  if (rings > 0) spacing = Math.min(spacing, LATTICE_DRAWN_MAX_M);
  // Busy ground earns one step finer than its incline alone would buy.
  if (rings >= LATTICE_BUSY_RINGS) {
    const finer = LATTICE_BY_INCLINE.find(([, m]) => m < spacing);
    if (finer) spacing = finer[1];
  }
  latticeField.set(cx * 1048576 + cz, spacing);
  return spacing;
}

//: refineForTerrain in one call; refineForTerrainSteps the same work yielding every few thousand
//: triangles, for the lift of a window being built while someone walks (liftOntoGroundAsync): a
//: forty-thousand-vertex piece refined in one go held a frame for 0.15-0.3 s (2026-11-05).
function refineForTerrain(...args) { return runSteps(refineForTerrainSteps(...args)); }
function runSteps(steps) { let r; while (!(r = steps.next()).done); return r.value; }
//: A geometry's bounding sphere worked out as computeBoundingSphere does it -- the centre of its
//: box, the distance to the vertex farthest from that -- with a yield every 65,536 vertices: on
//: a piece of a city's street surface the one call was a sixth of a second. (Morph targets or
//: an interleaved or normalised position go to three.js itself.)
function* boundingSphereSteps(geometry) {
  const position = geometry.getAttribute("position");
  if (!position || geometry.morphAttributes?.position || position.isInterleavedBufferAttribute
      || position.normalized || position.itemSize !== 3) { geometry.computeBoundingSphere(); return; }
  const A = position.array, n = position.count;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i += 1) {
    if ((i & 65535) === 65535) yield;
    const x = A[i * 3], y = A[i * 3 + 1], z = A[i * 3 + 2];
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
  }
  const empty = x1 < x0 || y1 < y0 || z1 < z0;
  const cx = empty ? 0 : (x0 + x1) * 0.5, cy = empty ? 0 : (y0 + y1) * 0.5, cz = empty ? 0 : (z0 + z1) * 0.5;
  let far = 0;
  for (let i = 0; i < n; i += 1) {
    if ((i & 65535) === 65535) yield;
    const dx = cx - A[i * 3], dy = cy - A[i * 3 + 1], dz = cz - A[i * 3 + 2];
    far = Math.max(far, dx * dx + dy * dy + dz * dz);
  }
  if (!geometry.boundingSphere) geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingSphere.center.set(cx, cy, cz);
  geometry.boundingSphere.radius = Math.sqrt(far);
}
//: A generator run between frames, inside the build's slice.
async function runStepsSliced(steps) {
  let r;
  while (!(r = steps.next()).done) if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame();
  return r.value;
}
const REFINE_TRIANGLES_PER_STEP = 512;
function* refineForTerrainSteps(geometry, maxEdge = TERRAIN_REFINE_M, chord = TERRAIN_CHORD_M,
                          minEdge = TERRAIN_REFINE_MIN_M, snapToTerrain = false,
                          adaptive = false, keepSource = false) {
  const position = geometry.getAttribute("position");
  // A multi-material geometry's index ranges are its material groups; splitting would move them.
  if (!position || (geometry.groups && geometry.groups.length)) return geometry;
  const names = ["position", "normal", "uv", "color"].filter((n) => geometry.getAttribute(n));
  const sources = names.map((n) => geometry.getAttribute(n));
  // Growable double arrays: the same values a plain array held, without the garbage its
  // pushes made (the cut runs millions of times while the city is built).
  const lengths = sources.map((a) => a.count * a.itemSize);
  const arrays = sources.map((a, i) => {
    const out = new Float64Array(Math.max(64, lengths[i] * 2));
    out.set(a.array.subarray(0, lengths[i]));
    return out;
  });
  const sizes = sources.map((a) => a.itemSize);
  const index = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: position.count }, (_, i) => i);
  let count = position.count;
  const px = (i) => arrays[0][i * 3], pz = (i) => arrays[0][i * 3 + 2];
  // The bend rule may not run away, but it must be allowed to finish: a budget of a few times
  // the vertices the mesh started with ran out a third of the way through the corridor's
  // yards -- one mesh, a hundred and thirty thousand vertices -- and left the rest on chords a
  // metre off the hill. The budget is what the area the mesh covers could need at the finest
  // cut, which is bounded whatever the ground does under it.
  // The mesh's own area -- its triangles', not its box's: the corridor's yards are one mesh
  // whose box is the corridor -- at the finest cut, two triangles per MIN_M square.
  let area = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    area += Math.abs((px(b) - px(a)) * (pz(c) - pz(a)) - (px(c) - px(a)) * (pz(b) - pz(a))) / 2;
  }
  // The budget is what the area could need at the finest cut it may actually be given. With a
  // lattice that goes to the terrain grid's own two metres where the ground demands it, a
  // budget sized for the four-metre minimum would stop the refinement in exactly the places
  // that asked for it.
  const finest = adaptive ? Math.min(minEdge, maxEdge, LATTICE_BY_INCLINE[0][1])
                         : Math.min(minEdge, maxEdge);
  const areaBudget = area / (finest * finest) * 2;
  const budget = Math.min(REFINE_VERTEX_CAP,
                          Math.max(position.count * TERRAIN_REFINE_GROWTH + (HEADSET ? 8000 : 50000), areaBudget));
  // Where an edge is cut, and whether. Every part is refined on its own -- a pavement ribbon, the
  // corner piece beside it, the kerb tile in front -- and two parts that meet along a line used
  // to bisect it differently, so that on a hill one side stood on the ground where the other
  // was still on its chord: a crack the width of the chord's error, at every seam, "sloppy
  // edges". The cuts are now decided by the edge's endpoints alone: a long edge is cut where
  // it crosses a line of a fixed world lattice maxEdge apart (the crossing nearest its middle),
  // and a short one whose midpoint the ground leaves by more than the tolerance is cut in the
  // middle. Two parts sharing an edge make the same cuts, so the seam stays closed.
  // The surface's own spacing is a ceiling, not the answer: plaza asks for two metres and gets
  // them everywhere, a yard asks for sixteen and gets as many as the ground under it needs.
  // Read per edge from its endpoints, so two parts sharing an edge still cut it identically
  // and the seam stays closed.
  const latticeFor = adaptive
    ? (a, b) => Math.min(maxEdge, latticeAt(px(a), pz(a)), latticeAt(px(b), pz(b)))
    : () => maxEdge;
  const terrainOrigin = snapToTerrain && TERRAIN_FRAME
    ? terrainToPage(TERRAIN_FRAME.x0 + TERRAIN_FRAME.step_m / 2,
                    TERRAIN_FRAME.y0 + TERRAIN_FRAME.step_m / 2, TERRAIN_FRAME) : [0, 0];
  const [gridX, gridZ] = terrainOrigin;
  const cutAt = (a, b, len) => {
    const lattice = latticeFor(a, b);
    // The hard cap binds here, and only the hard cap. The lattice branch used to have no limit
    // at all, which was harmless while the lattice was one coarse number and fatal as soon as
    // it could ask for two metres over a merged mesh the size of the corridor: the cut index
    // is keyed as a * 2^24 + b, the mesh had nowhere to put its 16.7 millionth vertex, and the
    // ground build died with "Map maximum size exceeded" taking every park, yard and plaza in
    // the city with it.
    //
    // The budget is not the limit to use here. It is sized for the chord rule -- the optional
    // extra cuts that chase a bend -- and holding the lattice to it starved the plaza paving,
    // which had been refining past it quite happily: Huntington Park went from sixteen
    // centimetres off the hill to six and a half metres under it. The lattice is the
    // structural cut, the one that decides whether a surface follows the ground at all.
    if (count > REFINE_VERTEX_CAP) return -1;
    if (len >= Math.min(minEdge, lattice)) {
      let best = -1, bestOff = Infinity;
      // Both axes in turn, x then z (no per-call arrays: this runs millions of times).
      for (let axis = 0; axis < 2; axis += 1) {
        const pa = axis ? pz(a) : px(a), pb = axis ? pz(b) : px(b), origin = axis ? gridZ : gridX;
        const lo = Math.min(pa, pb), hi = Math.max(pa, pb);
        for (let k = Math.floor((lo - origin) / lattice) + 1; origin + k * lattice < hi; k += 1) {
          const t0 = (origin + k * lattice - pa) / (pb - pa);
          if (t0 > 1e-4 && t0 < 1 - 1e-4 && Math.abs(t0 - 0.5) < bestOff) { best = t0; bestOff = Math.abs(t0 - 0.5); }
        }
      }
      if (best >= 0) return best;
    }
    if (!TERRAIN_FRAME || !(chord > 0) || len <= minEdge / 4 || count > budget) return -1;
    // Match the height function used by liftOntoGround, including tunnel approaches. Using
    // the raw grid here left grass on a chord above a sidewalk following a cut's road level.
    const mid = groundLiftAt((px(a) + px(b)) / 2, (pz(a) + pz(b)) / 2);
    const bend = Math.abs(mid - (groundLiftAt(px(a), pz(a)) + groundLiftAt(px(b), pz(b))) / 2);
    // Down to the minimum edge for a bend over the tolerance; to half that for a bend over twice
    // it and a quarter for four times -- a retaining wall or a flight of steps in the grid, which
    // a four-metre edge can only drape over, and which the grid's own decimetre of noise never
    // reaches.
    if (bend > chord * 4 || (bend > chord * 2 && len > minEdge / 2) || (bend > chord && len > minEdge)) return 0.5;
    return -1;
  };
  // Keyed by the pair as one number: a string key here was a third of the lift's time. The same
  // pair is always cut at the same parameter, so the key needs no more.
  const cuts = new Map();
  // A store grown by doubling was copied whole in the middle of a step: at a city's size, a frame
  // of a third of a second. One three quarters full is grown between steps instead, a slice at a
  // time, the new one taking over once it has everything (a vertex is only ever added at the end,
  // so what is already copied never changes). The doubling in cut() is only the fallback.
  const GROW_SLICE = 1 << 21;
  let growing = null;
  const growStep = () => {
    if (!growing) {
      for (let k = 0; k < arrays.length; k += 1) {
        if (lengths[k] > arrays[k].length * 0.75) {
          growing = { k, from: arrays[k], to: new Float64Array(arrays[k].length * 2), copied: 0 };
          break;
        }
      }
      if (!growing) return;
    }
    const g = growing;
    if (arrays[g.k] !== g.from) { growing = null; return; }
    const end = Math.min(lengths[g.k], g.copied + GROW_SLICE);
    g.to.set(g.from.subarray(g.copied, end), g.copied);
    g.copied = end;
    if (g.copied >= lengths[g.k]) { arrays[g.k] = g.to; growing = null; }
  };
  const cut = (a, b, t0) => {
    const key = a < b ? a * 16777216 + b : b * 16777216 + a;
    let m = cuts.get(key);
    if (m !== undefined) return m;
    const s = a < b ? t0 : 1 - t0;          // the parameter from the lower index, so both orders agree
    const lo = Math.min(a, b), hi = Math.max(a, b);
    m = count;
    count += 1;
    for (let k = 0; k < arrays.length; k += 1) {
      const n = sizes[k];
      if (lengths[k] + n > arrays[k].length) {
        const grown = new Float64Array(arrays[k].length * 2);
        grown.set(arrays[k]);
        arrays[k] = grown;
      }
      const arr = arrays[k];
      for (let c = 0; c < n; c += 1) arr[lengths[k] + c] = arr[lo * n + c] * (1 - s) + arr[hi * n + c] * s;
      lengths[k] += n;
    }
    cuts.set(key, m);
    return m;
  };
  const out = [];
  const stack = [];
  let split = 0;
  let work = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    stack.push(index[t], index[t + 1], index[t + 2]);
    while (stack.length) {
      // Counted by the triangles examined, not those read in: one large triangle on a hill is
      // cut into thousands.
      if (++work % REFINE_TRIANGLES_PER_STEP === 0) { growStep(); yield; }
      const c = stack.pop(), b = stack.pop(), a = stack.pop();
      const ab = Math.hypot(px(a) - px(b), pz(a) - pz(b));
      const bc = Math.hypot(px(b) - px(c), pz(b) - pz(c));
      const ca = Math.hypot(px(c) - px(a), pz(c) - pz(a));
      // The longest edge that wants a cut is cut; the others come round again. (Longest first,
      // ties in edge order, as the stable sort this replaces gave them -- without allocating.)
      let e0 = 0, e1 = 1, e2 = 2, l0 = ab, l1 = bc, l2 = ca, tmp;
      if (l1 > l0) { tmp = l0; l0 = l1; l1 = tmp; tmp = e0; e0 = e1; e1 = tmp; }
      if (l2 > l1) { tmp = l1; l1 = l2; l2 = tmp; tmp = e1; e1 = e2; e2 = tmp; }
      if (l1 > l0) { tmp = l0; l0 = l1; l1 = tmp; tmp = e0; e0 = e1; e1 = tmp; }
      let edge = -1, at = -1;
      for (let o = 0; o < 3; o += 1) {
        const which = o === 0 ? e0 : o === 1 ? e1 : e2, len = o === 0 ? l0 : o === 1 ? l1 : l2;
        const t0 = which === 0 ? cutAt(a, b, len) : which === 1 ? cutAt(b, c, len) : cutAt(c, a, len);
        if (t0 >= 0) { edge = which; at = t0; break; }
      }
      if (edge < 0) { out.push(a, b, c); continue; }
      split += 1;
      if (edge === 0) { const m = cut(a, b, at); stack.push(a, m, c, m, b, c); }
      else if (edge === 1) { const m = cut(b, c, at); stack.push(a, b, m, a, m, c); }
      else { const m = cut(c, a, at); stack.push(a, b, m, m, b, c); }
    }
  }
  if (!split) return geometry;
  // Put together a slice at a time too: millions of values each way, read out in one go, were
  // half a second of one frame. The index takes the type setIndex would give it (Uint16 while
  // every vertex number is under 65,535).
  const refined = new THREE.BufferGeometry();
  for (let k = 0; k < names.length; k += 1) {
    const values = new Float32Array(lengths[k]);
    for (let a = 0; a < lengths[k]; a += GROW_SLICE) {
      values.set(arrays[k].subarray(a, Math.min(lengths[k], a + GROW_SLICE)), a);
      yield;
    }
    refined.setAttribute(names[k], new THREE.BufferAttribute(values, sizes[k]));
  }
  const corners = new Uint32Array(out.length);
  let highest = 0;
  for (let a = 0; a < out.length; a += 1) {
    const v = out[a];
    corners[a] = v;
    if (v > highest) highest = v;
    if ((a & 1048575) === 1048575) yield;
  }
  refined.setIndex(new THREE.BufferAttribute(highest >= 65535 ? corners : new Uint16Array(corners), 1));
  refined.userData = geometry.userData;
  if (!keepSource) geometry.dispose();
  return refined;
}

//: What stands on a surface stands on the surface as drawn. A tactile pad is a small quad laid
//: at the pavement's height over the ground grid; the pavement under it is a large triangle
//: lifted at its own vertices, and between them it runs on its chord, which on a hill is
//: centimetres off the grid -- eight and a half at Montgomery and Clay. So the pad was under
//: the pavement wherever the chord ran high. A crossing's paint was worse: lifted along the
//: straight line between its two ends while the road under it followed the grid, on any grade
//: change the road rose through it and the legs drew as triangles and fragments. No height
//: read from the grid can know what the drawn surface does; only the drawn surface can. After
//: the streets are lifted, every vertex of what stands on a surface is set from that surface's
//: rendered top under it (the highest, where surfaces overlap) plus its own few millimetres.
//: The surfaces' triangles are streamed past the vertices, bucketed by cell, so nothing the
//: size of the road is held twice.
const SETTLE_CELL_M = 2.0;
//: What settles onto what: the surfaces stood on, and each standing surface's height above them.
const SETTLE_RULES = [
  // A four-corner pad can span a bowed sidewalk triangle on a steep block. Subdivide it
  // before settling so concrete cannot poke through the yellow warning field.
  { onto: new Set(["walk", "walk_narrow"]), above: { tactile_warning: 0.030, curb_ramp: 0.012 }, grid: 0.18, label: "Setting the pads on the pavement" },
  // The green of a bike lane is paint too. Lifted onto the terrain by itself it lay a few
  // centimetres under the road ribbons of the ways around it wherever their triangles bowed
  // differently over the hill, and the asphalt showed through it in jagged patches that came
  // and went with the camera -- the "pixel cutouts" in the lane. It is set on the very road
  // surface it is painted on, before the lane's own edge lines, which are then set on top of
  // it. Not clipped by the kerb: a lane runs against it, and a clipped triangle would be the
  // very hole to close.
  { onto: new Set(["road"]), above: { bike: 0.015 }, grid: 0.5,
    label: "Painting the bike lanes on the road" },
  // Junction asphalt comes from several overlapping ribbons. Sample the paint at half-metre
  // spacing so the road cannot rise through the interior of a long triangle; a small lift
  // also absorbs the few-centimetre mismatch between independently triangulated ribbons.
  // Lane/centre/turn paint must use the very same rendered triangles. Independent terrain
  // lifts buried lane lines on Bush Street by up to 72 mm after the terrain-frame correction.
  // Onto the bike lane's green as well as the asphalt: its edge lines are painted on it.
  { onto: new Set(["road", "bike"]), above: { crossing: 0.06, crossing_edges: 0.06, marking: 0.030 }, grid: 0.5,
    occlude: new Set(["walk", "walk_narrow", "kerb", "divider_block", "median"]),
    label: "Painting the crossings and lanes on the road" },
];
//: The tree pits are squares of soil cut into the pavement, and are set on it the same way: lifted
//: onto the terrain by themselves they lay a few millimetres over the hill, and the pavement's
//: own triangles -- through its stations, its edges, its ramps -- bowed differently between
//: their vertices and came up through the soil by up to four centimetres, as white shards in
//: one pit in thirty along Chestnut. They are the ground cover's (module 18), which comes down
//: when the ground does, so they are settled once both it and the streets are down (module 19),
//: from the ground's group.
const PIT_SETTLE_RULE = { from: () => [groups.ground], onto: new Set(["walk", "walk_narrow", "kerb"]),
  above: { tree_pit: 0.008 }, grid: 0.5, spread: 0.15, reach: 0.9, label: "Setting the tree pits in the pavement" };
const settleKey = (x, z) => Math.floor(x / SETTLE_CELL_M) * 1048576 + Math.floor(z / SETTLE_CELL_M);
const SETTLE_COARSE_M = 8.0;
async function settleOnto(rule) {
  // The vertices to settle, by the cell each stands in, and the best top found for each.
  const buckets = new Map();
  const coarseBuckets = new Map();
  const coarseByX = new Map();
  const tops = new Map();
  const coverTops = new Map();
  const probes = new Map(), spreads = new Map();
  const topArrays = [], coverArrays = [];
  const standing = [];
  for (const group of rule.from ? rule.from() : [groups.streets]) {
    group.traverse((o) => { if (o.isMesh && o.geometry && rule.above[o.userData.surface] !== undefined) standing.push(o); });
  }
  if (!standing.length) return 0;
  for (const o of standing) {
    await maybeYield(rule.label);
    // Cut to a metre first, across as well as along: a crossing's paint had two vertices across
    // its width, and the road under a junction is several ribbons folding at their own stations,
    // so between those two vertices the road rose through the paint as a dark notch.
    if (rule.grid) o.geometry = await runStepsSliced(refineForTerrainSteps(o.geometry, rule.grid, 0));
    const position = o.geometry.getAttribute("position");
    const samples = [position];
    // Also read a little way out from each vertex, each way, and the highest taken (rule.spread):
    // where a pit's edge runs along the edge of a second, higher sheet of pavement -- a footway
    // laid over the kerbside one, not dropped at a driveway the other was -- its vertex is just off
    // the higher one, settles on the lower, and the higher stood up through the soil beside it.
    if (rule.spread) {
      const spread = [];
      for (const [dx, dz] of [[rule.spread, 0], [-rule.spread, 0], [0, rule.spread], [0, -rule.spread]]) {
        spread.push({ count: position.count, getX: (i) => position.getX(i) + dx, getZ: (i) => position.getZ(i) + dz });
      }
      spreads.set(o, spread);
      samples.push(...spread);
    }
    if (rule.occlude) {
      // Vertices alone miss a higher road triangle wholly inside a paint
      // triangle. Probe its centre too, without refining the whole city again.
      const index = o.geometry.getIndex(), n = index ? index.count : position.count;
      const centres = new Float32Array(Math.floor(n / 3) * 2);
      for (let t = 0; t + 2 < n; t += 3) {
        const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1, c = index ? index.getX(t + 2) : t + 2;
        centres[t / 3 * 2] = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
        centres[t / 3 * 2 + 1] = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
      }
      const probe = { count: centres.length / 2, getX: (i) => centres[i * 2], getZ: (i) => centres[i * 2 + 1] };
      probes.set(o, probe);
      samples.push(probe);
    }
    for (const sample of samples) {
     tops.set(sample, new Float32Array(sample.count).fill(NaN));
     coverTops.set(sample, new Float32Array(sample.count).fill(NaN));
     // Each vertex goes into the cells as (x, z, which sample, which vertex): the triangles are
     // streamed past millions of these, and reading the position back through its attribute
     // and the tops through a Map on every test was most of this pass's time.
     const sid = topArrays.length;
     topArrays.push(tops.get(sample));
     coverArrays.push(coverTops.get(sample));
     for (let i = 0; i < sample.count; i += 1) {
      const sx = sample.getX(i), sz = sample.getZ(i);
      const key = settleKey(sx, sz);
      let list = buckets.get(key);
      if (!list) buckets.set(key, list = []);
      list.push(sx, sz, sid, i);
      const coarseX = Math.floor(sx / SETTLE_COARSE_M);
      const coarseZ = Math.floor(sz / SETTLE_COARSE_M);
      const coarseKey = coarseX * 1048576 + coarseZ;
      let coarseList = coarseBuckets.get(coarseKey);
      if (!coarseList) {
        coarseBuckets.set(coarseKey, coarseList = []);
        let column = coarseByX.get(coarseX);
        if (!column) coarseByX.set(coarseX, column = new Map());
        column.set(coarseZ, coarseList);
      }
      coarseList.push(sx, sz, sid, i);
     }
    }
  }
  const coarseXs = [...coarseByX.keys()].sort((a, b) => a - b);
  const firstCoarseX = (x) => {
    let lo = 0, hi = coarseXs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (coarseXs[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const bases = [];
  groups.streets.traverse((o) => { if (o.isMesh && o.geometry && (rule.onto.has(o.userData.surface) || rule.occlude?.has(o.userData.surface))) bases.push(o); });
  for (const o of bases) {
    const targetArrays = rule.onto.has(o.userData.surface) ? topArrays : coverArrays;
    const position = o.geometry.getAttribute("position");
    const index = o.geometry.getIndex();
    const n = index ? index.count : position.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
      const ax = position.getX(a), az = position.getZ(a), bx = position.getX(b), bz = position.getZ(b), cx = position.getX(c), cz = position.getZ(c);
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const x0 = Math.floor(Math.min(ax, bx, cx) / SETTLE_CELL_M), x1 = Math.floor(Math.max(ax, bx, cx) / SETTLE_CELL_M);
      const z0 = Math.floor(Math.min(az, bz, cz) / SETTLE_CELL_M), z1 = Math.floor(Math.max(az, bz, cz) / SETTLE_CELL_M);
      const cX0 = Math.floor(Math.min(ax, bx, cx) / SETTLE_COARSE_M);
      const cX1 = Math.floor(Math.max(ax, bx, cx) / SETTLE_COARSE_M);
      const cZ0 = Math.floor(Math.min(az, bz, cz) / SETTLE_COARSE_M);
      const cZ1 = Math.floor(Math.max(az, bz, cz) / SETTLE_COARSE_M);
      // Iterate occupied paint columns only. A malformed/very broad road triangle can span
      // millions of empty grid cells; scanning its integer bbox froze the Oakland viewer.
      const coarseCandidates = [];
      for (let k = firstCoarseX(cX0); k < coarseXs.length && coarseXs[k] <= cX1; k += 1) {
        for (const [z, list] of coarseByX.get(coarseXs[k])) {
          if (z >= cZ0 && z <= cZ1) coarseCandidates.push(list);
        }
      }
      if (!coarseCandidates.length) continue;
      // A broad junction/backstop triangle can span hundreds of thousands of empty half-metre
      // cells.  Query only occupied eight-metre bins in that case.  Small road triangles keep
      // the fine index, so their exact barycentric settlement is unchanged.
      const broad = (x1 - x0 + 1) * (z1 - z0 + 1) > 256;
      const ay = position.getY(a), by = position.getY(b), cy = position.getY(c);
      const candidates = broad ? coarseCandidates : [];
      if (!broad) {
        for (let gx = x0; gx <= x1; gx += 1) {
          for (let gz = z0; gz <= z1; gz += 1) {
            const list = buckets.get(gx * 1048576 + gz);
            if (list) candidates.push(list);
          }
        }
      }
      for (const list of candidates) {
          for (let k = 0; k < list.length; k += 4) {
            const x = list[k], z = list[k + 1];
            const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
            const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
            const w = 1 - u - v;
            if (u < -1e-3 || v < -1e-3 || w < -1e-3) continue;
            const y = u * ay + v * by + w * cy;
            const best = targetArrays[list[k + 2]], vi = list[k + 3];
            if (Number.isNaN(best[vi]) || y > best[vi]) best[vi] = y;
          }
      }
      if ((i & 255) === 0) await maybeYield(rule.label);
    }
    await maybeYield(rule.label);
  }
  let settled = 0;
  for (const o of standing) {
    await maybeYield(rule.label);
    const above = rule.above[o.userData.surface];
    const position = o.geometry.getAttribute("position");
    const best = tops.get(position);
    for (const around of spreads.get(o) || []) {
      const near = tops.get(around);
      for (let i = 0; i < position.count; i += 1) {
        if (!Number.isNaN(near[i]) && (Number.isNaN(best[i]) || near[i] > best[i])) best[i] = near[i];
      }
    }
    if (rule.reach) fillFromNearestSettled(position, best, rule.reach);
    for (let i = 0; i < position.count; i += 1) {
      if (Number.isNaN(best[i])) continue;
      position.setY(i, best[i] + above);
      settled += 1;
    }
    const probe = probes.get(o);
    if (probe) {
      const index = o.geometry.getIndex(), n = index ? index.count : position.count;
      const centreTops = tops.get(probe), centreCover = coverTops.get(probe), vertexCover = coverTops.get(position);
      const raises = new Float32Array(position.count), kept = [];
      for (let t = 0; t + 2 < n; t += 3) {
        const ids = [0, 1, 2].map((j) => index ? index.getX(t + j) : t + j);
        const top = centreTops[t / 3], paintY = ids.reduce((s, i) => s + position.getY(i), 0) / 3;
        // Asphalt-only paint clipping is local to this triangle, never to
        // another crossing's bounding box. A physical island/corner is not paint.
        const centreBlocked = centreCover[t / 3] > (Number.isNaN(top) ? paintY : top + above) + 0.002;
        const edgeBlocked = ids.some((i) => vertexCover[i] > position.getY(i) + 0.002);
        if (centreBlocked || edgeBlocked) continue;
        kept.push(...ids);
        const delta = Number.isNaN(top) ? 0 : Math.max(0, top + above - paintY);
        for (const i of ids) raises[i] = Math.max(raises[i], delta);
      }
      for (let i = 0; i < position.count; i += 1) {
        if (raises[i] > 1e-5) position.setY(i, position.getY(i) + raises[i]);
      }
      if (kept.length < n) {
        o.geometry.setIndex(kept);
        o.userData.clippedPaintTriangles = (n - kept.length) / 3;
      }
    }
    position.needsUpdate = true;
    o.geometry.computeBoundingSphere();
  }
  return settled;
}
//: A vertex of a settled piece that no pavement triangle is under -- a pit's corner a hand's
//: breadth past the pavement's edge -- takes the top of the nearest one that was found, within
//: `reach`: left on the terrain it stood up to four centimetres under the pavement beside it,
//: and the pavement came up through that corner of the pit.
function fillFromNearestSettled(position, best, reach) {
  const cell = Math.max(reach, 0.25), found = new Map();
  const key = (x, z) => Math.floor(x / cell) * 1048576 + Math.floor(z / cell);
  for (let i = 0; i < position.count; i += 1) {
    if (Number.isNaN(best[i])) continue;
    const k = key(position.getX(i), position.getZ(i));
    let list = found.get(k);
    if (!list) found.set(k, list = []);
    list.push(i);
  }
  if (!found.size) return 0;
  const filled = [];
  for (let i = 0; i < position.count; i += 1) {
    if (!Number.isNaN(best[i])) continue;
    const x = position.getX(i), z = position.getZ(i);
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    let near = -1, nearD = reach * reach;
    for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const j of found.get((gx + dx) * 1048576 + gz + dz) || []) {
        const d = (position.getX(j) - x) ** 2 + (position.getZ(j) - z) ** 2;
        if (d <= nearD) { nearD = d; near = j; }
      }
    }
    if (near >= 0) filled.push(i, best[near]);
  }
  // Only from vertices found under the pavement, not from ones just filled.
  for (let k = 0; k < filled.length; k += 2) best[filled[k]] = filled[k + 1];
  return filled.length / 2;
}
async function settleOntoPavement() {
  if (!TERRAIN_FRAME) return 0;
  let settled = 0;
  for (const rule of SETTLE_RULES) settled += await settleOnto(rule);
  return settled;
}

//: Everything at ground level under an object is lifted onto the ground: merged street
//: surfaces vertex by vertex, an instanced tree or post at each instance's foot, a positioned
//: mesh at its position. The tunnels are not: their stations already carry the ground and
//: the cover the lidar measured over them. Each mesh is lifted once, refined first
//: (refineForTerrain) so that it follows the hill between its corners.
function liftOntoGround(object) {
  if (!TERRAIN_FRAME) return 0;
  let lifted = 0;
  object.updateMatrixWorld(true);
  object.traverse((o) => { lifted += liftOneMesh(o); });
  return lifted;
}
//: The same, a frame at a time: the merged street surfaces are millions of vertices.
async function liftOntoGroundAsync(object, label) {
  if (!TERRAIN_FRAME) return 0;
  let lifted = 0;
  object.updateMatrixWorld(true);
  const meshes = [];
  object.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (let i = 0; i < meshes.length; i += 1) {
    // A very large mesh is cut into pieces first, and the pieces stood on the ground one at a
    // time with the browser given a turn between them: one street mesh stood on the hill in a
    // single call held the page for ten seconds.
    const mesh = meshes[i];
    const position = !mesh.isInstancedMesh && mesh.geometry?.getAttribute("position");
    let wide = false;
    if (position && position.count > 2 * LIFT_SPLIT_MIN_VERTICES) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const b = mesh.geometry.boundingBox;
      wide = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) > 2 * LIFT_SPLIT_M;
    }
    const pieces = position && (position.count > LIFT_SPLIT_VERTICES || wide) && mesh.parent
      ? await runStepsSliced(tileMeshSteps(mesh, [LIFT_SPLIT_M, 2 * LIFT_SPLIT_M], LIFT_SPLIT_MIN_VERTICES)) : null;
    // Cut a step at a time, the mesh can have been let go (its window released) before the end.
    if (pieces && !mesh.parent) { for (const piece of pieces) piece.geometry.dispose(); meshes[i] = null; continue; }
    if (pieces) {
      const parent = mesh.parent;
      parent.remove(mesh);
      // The whole is not needed once it is in pieces: let it go now, not at the end of the pass.
      mesh.geometry.dispose();
      mesh.geometry = null;
      meshes[i] = null;
      for (const piece of pieces) {
        parent.add(piece);
        piece.updateMatrixWorld(true);
        lifted += await runStepsSliced(liftOneMeshSteps(piece));
        await maybeYield(`${label}: ${Math.round(100 * i / meshes.length)}%`);
      }
      continue;
    }
    lifted += await runStepsSliced(liftOneMeshSteps(mesh));
    await maybeYield(`${label}: ${Math.round(100 * i / meshes.length)}%`);
  }
  return lifted;
}
//: A step of the stand that held the page for half a second or more, said in the console: the
//: build yields only between steps, so one of these is a freeze of that long.
function noteSlowLift(what, mesh, position, started) {
  const took = performance.now() - started;
  if (took > 500) console.info(`kerbside: ${what} ${mesh.userData.surface || "mesh"} took ${Math.round(took)} ms`,
    { vertices: position ? position.count : 0, groups: mesh.geometry?.groups?.length || 0, instanced: Boolean(mesh.isInstancedMesh) });
}
const LIFT_SPLIT_VERTICES = 40000;
const LIFT_SPLIT_M = 120;
const LIFT_SPLIT_MIN_VERTICES = 3000;
const LIFT_M4 = new THREE.Matrix4(), LIFT_Q = new THREE.Quaternion(), LIFT_POS = new THREE.Vector3(), LIFT_SCL = new THREE.Vector3();
function liftOneMesh(o) { return runSteps(liftOneMeshSteps(o)); }
//: A park's, a yard's or a lot's polygon is drawn on the ground, and where it runs out over the
//: water -- Lake Merritt is inside the park mapped round it; a lot's parcel takes in the creek
//: at its back -- the green was laid on the water's surface, in the water's own plane, and from
//: any distance the two took turns: "patches of ground over water appearing and disappearing".
//: The triangles of such a cover wholly on the water (all three corners and the middle) are
//: left out once it is cut to the terrain; one along the shore keeps its edge. Not a plaza or a
//: walk: a pier's deck is one, and it is over the water by design.
const COVER_OFF_WATER = new Set(["park", "yard", "court", "lawn", "neutral_ground", "service_yard"]);
function coverOffWater(o) {
  const surface = String(o.userData.surface || "");
  return COVER_OFF_WATER.has(surface) || surface.startsWith("park:")
    || (surface.startsWith("inferred:") && !surface.includes("plaza"));
}
function dropTrianglesOverWater(geometry, world) {
  // One material only: a sheet drawn in groups keeps its triangles where its groups say.
  if ((geometry.groups?.length || 0) > 1) return 0;
  const p = geometry.getAttribute("position"), index = geometry.getIndex();
  const count = index ? index.count : p.count, keep = [], v = new THREE.Vector3();
  const wet = [false, false, false], at = [0, 0, 0, 0, 0, 0];
  let dropped = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    let all = true;
    for (let k = 0; k < 3; k += 1) {
      const i = index ? index.getX(t + k) : t + k;
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(world);
      at[k * 2] = v.x; at[k * 2 + 1] = v.z;
      wet[k] = overWaterAt(v.x, v.z);
      if (!wet[k]) { all = false; break; }
    }
    if (all && overWaterAt((at[0] + at[2] + at[4]) / 3, (at[1] + at[3] + at[5]) / 3)) { dropped += 1; continue; }
    for (let k = 0; k < 3; k += 1) keep.push(index ? index.getX(t + k) : t + k);
  }
  if (!dropped) return 0;
  geometry.setIndex(keep);
  geometry.clearGroups();
  return dropped;
}
function* liftOneMeshSteps(o) {
  const m = LIFT_M4, q = LIFT_Q, pos = LIFT_POS, scl = LIFT_SCL;
  {
    if (!o.isMesh || o.userData.liftedOntoGround) return 0;
    if (String(o.userData.surface || "").startsWith("tunnel") || o.userData.surface === "terrain") return 0;
    o.userData.liftedOntoGround = true;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i += 1) {
        o.getMatrixAt(i, m);
        m.decompose(pos, q, scl);
        pos.y += groundLiftAt(pos.x, pos.z);
        m.compose(pos, q, scl);
        o.setMatrixAt(i, m);
      }
      o.instanceMatrix.needsUpdate = true;
      if (o.computeBoundingSphere) o.computeBoundingSphere();
      return 1;
    }
    if (!o.geometry || !o.geometry.getAttribute("position")) return 0;
    const [limit, chord, minEdge, snapToTerrain, adaptive] = TERRAIN_REFINE_BY_SURFACE[o.userData.surface] || [TERRAIN_REFINE_M, TERRAIN_CHORD_M];
    // Refined into its own geometry and swapped in whole, so a frame drawn meanwhile draws the
    // mesh as it was, not half cut.
    const source = o.geometry;
    const refined = yield* refineForTerrainSteps(source, limit, chord, minEdge, snapToTerrain, adaptive, true);
    if (coverOffWater(o)) dropTrianglesOverWater(refined, o.matrixWorld);
    const attribute = refined.getAttribute("position");
    // Vertices are lifted in the world frame; a mesh that is placed rather than built where
    // it stands gets the lift on its own local axes.
    const world = o.matrixWorld;
    const inverse = new THREE.Matrix3().setFromMatrix4(world.clone().invert());
    const v = new THREE.Vector3(), up = new THREE.Vector3();
    for (let i = 0; i < attribute.count; i += 1) {
      if ((i & 4095) === 4095) yield;
      v.set(attribute.getX(i), attribute.getY(i), attribute.getZ(i)).applyMatrix4(world);
      // A cut road is lifted by its own level AFTER subdivision. Interpolating
      // a pre-lift delta and then sampling a different ground function produced
      // metre-high triangular pavement spikes under and beside portal decks.
      const lift = o.userData.groundLiftFunction
        ? o.userData.groundLiftFunction(v.x, v.z)
        : APPROACH_CUTS.length && ['walk','walk_narrow','walk_underlay','kerb'].includes(o.userData.surface)
          ? pavementLiftAt(v.x,v.z) : groundLiftAt(v.x, v.z);
      if (lift === 0) continue;
      up.set(0, lift, 0).applyMatrix3(inverse);
      attribute.setXYZ(i, attribute.getX(i) + up.x, attribute.getY(i) + up.y, attribute.getZ(i) + up.z);
    }
    attribute.needsUpdate = true;
    // Ground normals were still those of the original flat sheet: hills had geometry but
    // no slope lighting. Recompute only terrain-conforming covers, not building walls.
    if (["park", "yard", "court", "plaza", "front_walk", "neutral_ground", "service_yard", "park:play_surface",
         "park:skatepark_surface"].includes(o.userData.surface) || String(o.userData.surface||'').startsWith('inferred:')) {
      refined.computeVertexNormals();
    }
    // The bounds are what the culling reads; a tile lifted eighty metres up Nob Hill with the
    // sphere it had at sea level would vanish whenever the camera looked at it.
    yield* boundingSphereSteps(refined);
    if (refined.boundingBox) refined.computeBoundingBox();
    o.geometry = refined;
    if (refined !== source) source.dispose();
    return 1;
  }
}

// ---- the bay ----
//
// San Francisco is a peninsula with water on three sides, and this corridor is its waterfront.
// Beyond the mapped strip there was nothing at all: the ground plane stops at the bounding box
// and everything past it was background colour, which from the Embarcadero looking east is a
// void where the bay is.
//
// So: a disc of water round the city, and a plate of land inside it for the city to stand on.
// The disc is centred on San Francisco rather than on this corridor, because the corridor is
// off to one corner of it and a circle centred here would put the Pacific in the Mission. It is
// coarse -- a real coastline it is not -- but at three kilometres and beyond, which is where
// any of it is visible from, a coarse bay is the difference between a horizon and a hole.
const CITY = { lon: -122.4375, lat: 37.7575 };
//: Where the plate of land sits. Not on the city's centre: a square centred there reaches five
//: and a half kilometres north, which is past the shoreline, and the corner that sticks out into
//: the bay is a dark band between the quays and the water -- the exact seam this was meant to
//: close. Pushed south-west, its north edge lands just inside the waterfront and the coastline
//: bands take over from there.
const LAND_CENTRE = { lon: -122.4460, lat: 37.7490 };
//: Far enough that you would have to leave the city to see the end of it.
const BAY_RADIUS_M = 26000.0;
//: The peninsula, roughly. Eleven kilometres square covers San Francisco proper with a margin.
const LAND_SPAN_M = 11600.0;
//: The perimeter's cells are drawn in tiles this many cells a side, each culled on its own;
//: within a tile each row's runs of land and water are one quad each, so the three and a half
//: million cells of the atlas are a few tens of thousands of quads.
const PERIMETER_TILE_CELLS = 240;
//: A bridge deck over water stands this high above the sea -- a bay bridge's clearance -- and
//: comes down to the ground at each end no steeper than PERIMETER_BRIDGE_GRADE.
const PERIMETER_BRIDGE_CLEARANCE_M = 55.0;
const PERIMETER_BRIDGE_GRADE = 0.05;
const PERIMETER_PIER_M = 160.0;
//: The perimeter's tiles stand this far under the grid's own apron, so that where a cell
//: straddles the apron's edge the apron is drawn and not a fight between the two: at three
//: kilometres the depth buffer tells planes apart by the metre, not the centimetre.
const PERIMETER_UNDER_M = 2.0;
if (!PERIMETER && !ATTACH) {
  // No perimeter built: a disc of sea round the city, and the plate of land the city sits on,
  // over the middle of it. With the perimeter the disc lies wholly inside the atlas and would
  // only fight it for the pixels.
  const [cx, cy] = xy(CITY.lon, CITY.lat);
  const bay = new THREE.Mesh(
    new THREE.CircleGeometry(BAY_RADIUS_M, 96),
    new THREE.MeshStandardMaterial({
      color: 0x2c6187, roughness: 0.62, metalness: 0.04, envMapIntensity: 0.5,
    })
  );
  bay.rotation.x = -Math.PI / 2;
  bay.position.set(cx, BAY_Y, -cy);
  root.add(bay);
  {
    // No perimeter built: the plate of land the city sits on, over the middle of the bay.
    const [lx, ly] = xy(LAND_CENTRE.lon, LAND_CENTRE.lat);
    const land = new THREE.Mesh(
      new THREE.PlaneGeometry(LAND_SPAN_M, LAND_SPAN_M, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x3d5142, roughness: 1.0, metalness: 0.0 })
    );
    land.rotation.x = -Math.PI / 2;
    land.position.set(lx, PENINSULA_Y, -ly);
    root.add(land);
  }
}
//: The atlas under this page's own region (see the perimeter tiles below): hidden while the
//: region is drawn here in full, shown once it has been let go for another region.
const PERIMETER_FILL = [];
if (PERIMETER && !NATURE) {
  // The country round the region as the map has it: grass where the land is, sea where the
  // water is, in tiles, with the cells under the grid and its apron left to them.
  const f = PERIMETER.frame;
  const g = TERRAIN_FRAME;
  const apronWest = g ? g.x0 - TERRAIN_APRON_M : Infinity, apronEast = g ? g.x0 + g.cols * g.step_m + TERRAIN_APRON_M : -Infinity;
  const apronSouth = g ? g.y0 - TERRAIN_APRON_M : Infinity, apronNorth = g ? g.y0 + g.rows * g.step_m + TERRAIN_APRON_M : -Infinity;
  const underApron = (x, y) => x > apronWest && x < apronEast && y > apronSouth && y < apronNorth;
  const grass = TERRAIN_PLATE, sea = TERRAIN_SEA, sand = TERRAIN_SAND;
  // A cell corner in the atlas's frame, here: through lon/lat, since the frames differ.
  const here = (c, r) => {
    const lon = f.mid_lon + (f.x0 + c * f.step_m) / f.metres_per_lon;
    const lat = f.mid_lat + (f.y0 + r * f.step_m) / f.metres_per_lat;
    return xy(lon, lat);
  };
  for (let r0 = 0; r0 < f.rows; r0 += PERIMETER_TILE_CELLS) {
    for (let c0 = 0; c0 < f.cols; c0 += PERIMETER_TILE_CELLS) {
      const r1 = Math.min(f.rows, r0 + PERIMETER_TILE_CELLS), c1 = Math.min(f.cols, c0 + PERIMETER_TILE_CELLS);
      const position = [], colour = [], index = [];
      const fillPosition = [], fillColour = [], fillIndex = [];
      for (let r = r0; r < r1; r += 1) {
        // The row's runs: one quad per run of one kind, cut where the apron begins and ends.
        let c = c0;
        while (c < c1) {
          const wet = PERIMETER.cells[r * f.cols + c];
          const [xa, ya] = here(c, r);
          // A cell is left to the apron only when the whole of it lies under the apron: one
          // that straddles the apron's edge is drawn (under it, PERIMETER_UNDER_M down), or
          // the strip of it outside the apron was a line of sky along the edge.
          const whollyUnder = (x, y) => underApron(x + 0.5, y + 0.5) && underApron(x + f.step_m - 0.5, y + f.step_m - 0.5);
          const under = whollyUnder(xa, ya);
          let end = c + 1;
          while (end < c1 && PERIMETER.cells[r * f.cols + end] === wet) {
            const [xe, ye] = here(end, r);
            if (whollyUnder(xe, ye) !== under) break;
            end += 1;
          }
          {
            // Under the apron the cell goes into the fill: the country under this page's own
            // region, drawn only once that region's world has been let go for another's.
            const [P, C, I] = under ? [fillPosition, fillColour, fillIndex] : [position, colour, index];
            const [xb, yb] = here(end, r + 1);
            const h = (wet === 1 ? SEA_Y - 0.02 : PENINSULA_Y) - PERIMETER_UNDER_M;
            const col = wet === 1 ? sea : wet === 2 ? sand : grass;
            const base = P.length / 3;
            for (const [x, y] of [[xa, ya], [xb, ya], [xb, yb], [xa, yb]]) {
              P.push(x, h - earthDrop(x, -y), -y);
              C.push(col.r, col.g, col.b);
            }
            // Wound to face up (+y): z runs to -north.
            I.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
          c = end;
        }
      }
      for (const [P, C, I, fill] of [[position, colour, index, false], [fillPosition, fillColour, fillIndex, true]]) {
        if (!I.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
        geometry.setIndex(I);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const tile = new THREE.Mesh(geometry, TERRAIN_MATERIAL);
        tile.userData.surface = fill ? "perimeter_fill" : "perimeter";
        tile.userData.bayWide = true;
        tile.visible = !fill;
        if (fill) PERIMETER_FILL.push(tile);
        root.add(tile);
      }
    }
  }
  const bridgeCounts = buildBayBridges(g);
  console.info(`kerbside: perimeter ${PERIMETER.frame.cols}x${PERIMETER.frame.rows} cells, ${bridgeCounts.structures} bridges, ${bridgeCounts.towers} towers, ${bridgeCounts.piers} piers, ${bridgeCounts.ramps} viaducts down to the ground, ${bridgeCounts.headlands} headlands (${PERIMETER.source})`);
}

//: Water standing this far above the sea is not the sea: a reservoir in the hills, a lake in a
//: park. The elevation model is flattened over water to the water's own surface, so that is the
//: water's height. Every wet corner used to be put at sea level, which dug each lake in the hills
//: out to the sea's height -- Crystal Springs a ninety-metre pit -- and its banks were cliffs
//: down to it, painted half as water.
const INLAND_WATER_ABOVE_SEA_M = 1.5;
//: The cuttings a bridge's approach runs through (buildBayBridges registers them): the ground
//: over its road is taken down to it, and sloped back up at about 45 degrees either side. The
//: 3DEP ground at 10 m smooths a road cut away, so the Golden Gate's road ran on into the hill
//: north of the span. Segments {ax, az, ay, bx, bz, by, half, box}, in the atlas's heights.
var BRIDGE_CUTS;
function bridgeCutHeight(x,z,y) {
  if(!BRIDGE_CUTS)return y;
  for(const c of BRIDGE_CUTS){
    if(x<c.box[0]||x>c.box[2]||z<c.box[1]||z>c.box[3])continue;
    const dx=c.bx-c.ax,dz=c.bz-c.az,L=dx*dx+dz*dz,t=L?Math.max(0,Math.min(1,((x-c.ax)*dx+(z-c.az)*dz)/L)):0;
    const d=Math.hypot(x-c.ax-dx*t,z-c.az-dz*t),limit=c.ay+(c.by-c.ay)*t-.35+Math.max(0,d-c.half-2)*.9;
    if(y>limit)y=limit;
  }
  return y;
}
function natureVisualHeightAt(x,z,h,wet) {
  if(wet)return (Number.isFinite(h) && h > SEA_Y + INLAND_WATER_ABOVE_SEA_M ? h : SEA_Y)-earthDrop(x,z);
  const y=bridgeCutHeight(x,z,rawTerrainHeightAt(x,z,h))-earthDrop(x,z);
  if(activeGuest?.ready && activeGuest.box) {
    const g=activeGuest,[gx,gz]=hostToGuest(g,x,z),b=g.box;
    const distance=Math.max(0,b[0]-gx,gx-b[2],b[1]-gz,gz-b[3]);
    if(distance<120) {
      const edge=g.api.groundLiftAt(Math.max(b[0],Math.min(b[2],gx)),Math.max(b[1],Math.min(b[3],gz)))+g.oy;
      const t=distance/120,s=t*t*(3-2*t);return edge*(1-s)+y*s;
    }
  }
  return y;
}
if (NATURE) {
  const localBounds = BUILD_WINDOW ? (() => {
    const b=localWindowBox(BUILD_WINDOW.box);return new THREE.Vector4(...clipToTerrain([b.x,b.y,b.z,b.w]));
  })() : TERRAIN_FRAME ? new THREE.Vector4(...terrainPageRect()) : new THREE.Vector4(1,1,0,0);
  const hostBox={value:localBounds};
  natureWorld=natureLibrary.createNatureWorld({THREE,root,atlas:NATURE,
    toPage:(lon,lat)=>{const [x,y]=xy(lon,lat);return [x,-y];},
    fromPage:(x,z)=>[midLon+x/metersPerLon,midLat-z/metersPerLat],
    heightAt:natureVisualHeightAt,
    // The Bay's outline is a coarse grid: past the coastline's own 100 m band it laid square
    // blocks of water over Marin's shore (Horseshoe Bay, Sausalito). Where the land cover says
    // land (NLCD 21 and up, 30 m), it is land.
    waterAt:(x,z,s)=>mappedWaterAt(x,z) ?? (s.coastOverride ? s.water : s.water || (perimeterWaterAt(x,z)===true && !(s.cover>=21))),
    blockedAt:(x,z)=>inCity(x,z)||mappedBuiltAt(x,z)||Boolean(typeof guestUnder==="function"&&guestUnder(x,z)),
    // A bridge's own deck is drawn by the bridges: its road is not laid again on the ground under it.
    underDeck:(x,z)=>typeof elevatedDecksAt==="function"&&elevatedDecksAt(x,z).length>0,
    hostBox,guestBox:indoorCut.guestBox,onHeightsChanged:syncNatureTileHeights,motion:natureMotion,
    forestFloor:forestFloorLibrary,loadModel:(url)=>new GLTFLoader().loadAsync(url),overview:!HEADSET});
  natureWorld.hostBox=hostBox;natureWorld.localBounds=localBounds.clone();
  if(globeLibrary){
    // The disc under the atlas reaches its farthest corner from here; the globe rounds off past it.
    const b=NATURE.f.bbox;let cap=0;
    for(const lon of [b.west,b.east])for(const lat of [b.south,b.north]){const [x,y]=xy(lon,lat);cap=Math.max(cap,Math.hypot(x,y));}
    globe=globeLibrary.createGlobe(THREE,{parent:scene,lon0:midLon,lat0:midLat,maskUrl:sharedAsset("world/land-mask.png"),cap:cap+3000});
  }
  if(PERIMETER)buildBayBridges(TERRAIN_FRAME);
  if(BRIDGE_CUTS?.length)natureWorld.invalidate(); // ground already laid is cut again
}

