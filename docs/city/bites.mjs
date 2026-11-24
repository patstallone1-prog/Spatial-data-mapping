// What is left of a piece of food, seen from above: its outline as a fine raster (a mask), bites
// and knife cuts taken out of it, and the outline traced back out of what is left (marching
// squares, then thinned), for the food's layers to be rebuilt from (dish-models.mjs).
//
// A bite is the front teeth's arc: a row of small circles along a wider one, so what is left has
// the scalloped edge a real bite leaves. A cut is a straight line: what is past it comes away as a
// piece of its own (a forkful of steak), with the cut's line along its side.
//
// Pure: no three.js (tests/city_bites.test.mjs).

//: A mask of ``n`` by ``n`` cells over the square [-half, half]² (metres): 1 where there is food.
export function createMask(half, n = 96) {
  return { half, n, cell: (2 * half) / n, data: new Uint8Array(n * n) };
}
const at = (M, i, j) => (i < 0 || j < 0 || i >= M.n || j >= M.n ? 0 : M.data[j * M.n + i]);
const centre = (M, i) => -M.half + (i + 0.5) * M.cell;

//: Fill the mask where ``inside(x, z)``.
export function fillMask(M, inside) {
  for (let j = 0; j < M.n; j += 1) for (let i = 0; i < M.n; i += 1) if (inside(centre(M, i), centre(M, j))) M.data[j * M.n + i] = 1;
  return M;
}
//: Inside the polygon [[x, z], ...] (even-odd).
export function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export const copyMask = (M) => ({ ...M, data: M.data.slice() });
//: How much food is left (m²).
export const areaOf = (M) => { let s = 0; for (const v of M.data) s += v; return s * M.cell * M.cell; };
//: Each cell of ``M`` kept only where ``B`` has food too (B's frame the same).
export function intersect(M, B) { for (let k = 0; k < M.data.length; k += 1) M.data[k] &= B.data[k]; return M; }

//: The bite's shape: the circles a mouth's front teeth take, centred at (x, z) with its open side
//: facing (dx, dz) (the way the mouth comes from): a big arc of ``r`` and the teeth's scallops.
export function biteCircles(x, z, dx, dz, r = 0.024) {
  const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, px = -uz, pz = ux;
  const out = [[x, z, r]];
  // The teeth: six marks along the arc's inner edge.
  for (let k = -3; k <= 3; k += 1) {
    const a = (k / 3) * 1.05, cx = x - ux * r * Math.cos(a) * 0.82 + px * r * Math.sin(a) * 0.95, cz = z - uz * r * Math.cos(a) * 0.82 + pz * r * Math.sin(a) * 0.95;
    out.push([cx, cz, r * 0.24]);
  }
  return out;
}
//: Take ``circles`` [[x, z, r]] out of the mask; the area taken (m²).
export function subtractCircles(M, circles) {
  let taken = 0;
  for (let j = 0; j < M.n; j += 1) for (let i = 0; i < M.n; i += 1) {
    const k = j * M.n + i;
    if (!M.data[k]) continue;
    const x = centre(M, i), z = centre(M, j);
    if (circles.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 <= r * r)) { M.data[k] = 0; taken += 1; }
  }
  return taken * M.cell * M.cell;
}
//: Cut along the line through (x, z) with normal (nx, nz): what is on the normal's side comes off
//: as a mask of its own (returned), the rest stays in ``M``.
export function cutOff(M, x, z, nx, nz, keep = () => true) {
  const piece = { ...M, data: new Uint8Array(M.data.length) };
  for (let j = 0; j < M.n; j += 1) for (let i = 0; i < M.n; i += 1) {
    const k = j * M.n + i;
    if (!M.data[k]) continue;
    const cx = centre(M, i), cz = centre(M, j);
    if ((cx - x) * nx + (cz - z) * nz > 0 && keep(cx, cz)) { piece.data[k] = 1; M.data[k] = 0; }
  }
  return piece;
}

//: The edge of what is left the furthest along (dx, dz) from its middle, nearest the line through
//: the middle that way: where a mouth coming from that way bites next. Null when nothing is left.
export function frontEdge(M, dx, dz) {
  const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
  let sx = 0, sz = 0, n = 0;
  for (let j = 0; j < M.n; j += 1) for (let i = 0; i < M.n; i += 1) if (M.data[j * M.n + i]) { sx += centre(M, i); sz += centre(M, j); n += 1; }
  if (!n) return null;
  const mx = sx / n, mz = sz / n;
  let best = null, bs = -Infinity;
  for (let j = 0; j < M.n; j += 1) for (let i = 0; i < M.n; i += 1) {
    if (!M.data[j * M.n + i]) continue;
    const x = centre(M, i), z = centre(M, j), along = (x - mx) * ux + (z - mz) * uz, off = Math.abs((x - mx) * -uz + (z - mz) * ux);
    const s = along - off * 0.6;
    if (s > bs) { bs = s; best = [x, z]; }
  }
  return { x: best[0], z: best[1], mx, mz };
}

//: The outlines of what is left: [{ points: [[x, z], ...], area (signed: + an outline, - a hole) }],
//: traced along the cells' edges (marching squares on cell corners) and thinned to within
//: ``tolerance`` of the trace. Largest first.
export function contours(M, tolerance = M.cell * 0.6) {
  const n = M.n, cellAt = (i, j) => at(M, i, j);
  // Edges between food and not, as directed segments on the corner lattice (food on the left).
  const next = new Map(), key = (i, j) => j * (n + 2) + i;
  const seg = (i0, j0, i1, j1) => { const k = key(i0, j0); if (!next.has(k)) next.set(k, []); next.get(k).push([i1, j1]); };
  for (let j = -1; j < n; j += 1) for (let i = -1; i < n; i += 1) {
    const a = cellAt(i, j), r = cellAt(i + 1, j), d = cellAt(i, j + 1);
    // Between (i, j) and (i+1, j): the vertical edge at corner column i+1.
    if (a !== r) { if (a) seg(i + 1, j, i + 1, j + 1); else seg(i + 1, j + 1, i + 1, j); }
    if (a !== d) { if (a) seg(i + 1, j + 1, i, j + 1); else seg(i, j + 1, i + 1, j + 1); }
  }
  const loops = [];
  const used = new Set();
  for (const [k0, outs] of next) {
    for (let o = 0; o < outs.length; o += 1) {
      const id = `${k0}:${o}`;
      if (used.has(id)) continue;
      const loop = [];
      let k = k0, oi = o;
      for (let guard = 0; guard < 100000; guard += 1) {
        used.add(`${k}:${oi}`);
        const [i1, j1] = next.get(k)[oi];
        loop.push([i1, j1]);
        k = key(i1, j1);
        const cand = next.get(k) || [];
        oi = cand.findIndex((_, q) => !used.has(`${k}:${q}`));
        if (oi < 0) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  const toXZ = ([i, j]) => [-M.half + i * M.cell, -M.half + j * M.cell];
  return loops.map((l) => {
    const pts = simplify(smooth(l.map(toXZ)), tolerance);
    return { points: pts, area: signedArea(pts) };
  }).filter((c) => Math.abs(c.area) > M.cell * M.cell * 2).sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
}
export function signedArea(pts) {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return s / 2;
}
//: The staircase of cell edges rounded off (each corner cut: Chaikin, once).
function smooth(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}
//: Douglas-Peucker on a closed loop.
function simplify(pts, tol) {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  const dp = (a, b) => {
    let worst = -1, wd = tol;
    const [ax, az] = pts[a], [bx, bz] = pts[b], L = Math.hypot(bx - ax, bz - az) || 1e-9;
    for (let i = a + 1; i < b; i += 1) { const d = Math.abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L; if (d > wd) { wd = d; worst = i; } }
    if (worst >= 0) { keep[worst] = 1; dp(a, worst); dp(worst, b); }
  };
  const half = Math.floor(pts.length / 2);
  keep[0] = keep[half] = 1;
  dp(0, half); dp(half, pts.length - 1);
  keep[pts.length - 1] = 1;
  return pts.filter((_, i) => keep[i]);
}
//: The outlines as shapes: each outer outline with the holes inside it ({outer, holes}).
export function shapesOf(M, tolerance) {
  const cs = contours(M, tolerance), outers = cs.filter((c) => c.area > 0), holes = cs.filter((c) => c.area < 0);
  return outers.map((o) => ({ outer: o.points, holes: holes.filter((h) => inPolygon(o.points, h.points[0][0], h.points[0][1])).map((h) => h.points) }));
}
