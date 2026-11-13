// ---- the rest of the roadway ----
//
// Everything above draws a street as a ribbon of one width on OpenStreetMap's centreline, and
// the city's kerbs are where they are. Where the two disagree -- a centreline off the middle
// of its road, a street that widens for a turn pocket, a transit way drawn as three parallel
// ways, a median island -- the ground between the drawn carriageway and the kerb showed
// through as a black strip down the middle of the street. The roadway is the whole of the
// space between the kerbs. What no carriageway, pavement or median covers is filled here:
// asphalt at road level; a raised concrete island where the city's island kerbs bound the
// strip, which is where a walker stands halfway across; and a line where two carriageways
// meet across the strip -- a double yellow between opposing one-way ways, white otherwise.
const ROAD_FILL_STATION_M = 2.0;
const ROAD_FILL_STEP_M = 0.25;
const ROAD_FILL_MIN_M = 0.4;
const ROAD_FILL_ISLAND_MIN_M = 0.6;
//: A strip wider than this between two kerbs is a plaza or a lot the kerb file also bounds.
const ROAD_FILL_MAX_SPAN_M = 34.0;

function fillKey(x, z) { return `${Math.floor(x / ROAD_FILL_CELL_M)}:${Math.floor(z / ROAD_FILL_CELL_M)}`; }
function stampFill(ax, az, bx, bz) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (ROAD_FILL_CELL_M * 0.5)));
  for (let i = 0; i <= n; i += 1) {
    roadFillGrid.add(fillKey(ax + (bx - ax) * i / n, az + (bz - az) * i / n));
  }
}
function filledAt(x, z) { return roadFillGrid.has(fillKey(x, z)); }

function carriagewaySourceAt(x, z, slack = 0.1) {
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  let best = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half, bearing, source] of bucket) {
        const d = Math.sqrt(distanceToSegmentSquared(x, z, ax, az, bx, bz));
        if (d <= half + slack && (!best || d < best.d)) best = { d, bearing, source };
      }
    }
  }
  return best;
}

function roadwayCovered(x, z) {
  return insideCarriageway(x, z, 0.05) || insideJunctionBox(x, z)
    || (pavementTopAt(x, z) || 0) > 0 || filledAt(x, z);
}

//: The islands the aerial photographs decided (scripts/build_ortho_islands.py), as x/z rings:
//: the survey's ring where the photograph saw it raised, the photograph's own outline where the
//: survey left only pieces, and a ring the survey closed that the photograph could not see. Where
//: there are such islands, they are the region's islands: the fill no longer strings ragged
//: strips between fragments of kerb.
const ISLAND_RINGS = ORTHO_ISLANDS?.schema === "kerbside.islands/1" ? (ORTHO_ISLANDS.islands || [])
  .filter((island) => island.basis !== "survey_unconfirmed" || island.closed_in_survey)
  .map((island) => island.p.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; }))
  .filter((ring) => ring.length >= 4) : null;

function fillRoadwayToKerbs() {
  if (!officialCurbGrid.size) return { asphalt: 0, islands: 0, lines: 0 };
  const asphalt = { positions: [], uvs: [], index: [] };
  const island = { positions: [], uvs: [], index: [] };
  const lines = { yellow: [], white: [] };
  let counts = { asphalt: 0, islands: 0, lines: 0 };
  const quad = (sink, ring, y, scale) => {
    // Faces up: the ring is ordered so its signed area in x/z is positive.
    let area = 0;
    for (let i = 0; i < 4; i += 1) {
      const [x0, z0] = ring[i]; const [x1, z1] = ring[(i + 1) % 4];
      area += x0 * z1 - x1 * z0;
    }
    const ordered = area > 0 ? ring : [ring[0], ring[3], ring[2], ring[1]];
    const base = sink.positions.length / 3;
    for (const [x, z] of ordered) { sink.positions.push(x, y, z); sink.uvs.push(x / scale, z / scale); }
    sink.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const face = (sink, a, b, top, bottom) => {
    const base = sink.positions.length / 3;
    for (const [x, y, z] of [[a[0], bottom, a[1]], [a[0], top, a[1]], [b[0], top, b[1]], [b[0], bottom, b[1]]]) {
      sink.positions.push(x, y, z); sink.uvs.push(x / 4, y / 4);
    }
    sink.index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  // A strip is drawn from station to station, its edges following the kerbs either side,
  // rather than as one rectangle per station squared to the local tangent: on a curve those
  // rectangles fanned open on the outside and overlapped on the inside, a sawtooth along
  // every bend. Two runs at consecutive stations that cover the same part of the cross-
  // section are one strip; a run with no partner at the station before or after gets a
  // half-station cap so the strip still starts and ends where the gap does.
  const drawStrip = (prev, cur) => {
    const ring = [prev.a, cur.a, cur.b, prev.b];
    if (cur.island && prev.island) {
      const top = ROAD_TOP_M + MEDIAN_KERB_M;
      quad(island, ring, top, 4);
      face(island, prev.a, cur.a, top, ROAD_TOP_M);
      face(island, cur.b, prev.b, top, ROAD_TOP_M);
      counts.islands += 1;
    } else {
      quad(asphalt, ring, ROAD_TOP_M - JUNCTION_BOX_DROP_M, 8);
      counts.asphalt += 1;
      if (cur.line && prev.line && cur.line.sink === prev.line.sink) {
        for (let k2 = 0; k2 < cur.line.points.length; k2 += 1) {
          cur.line.sink.push([prev.line.points[k2], cur.line.points[k2]]);
        }
        counts.lines += 1;
      }
    }
  };
  for (const way of DATA.ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
    if (isTunnelWay(way) || isUnmarkedService(way)) continue;
    const dense = densifyWay(way.points, ROAD_FILL_STATION_M);
    let previous = [];
    for (let i = 0; i < dense.length; i += 1) {
      const before = dense[Math.max(0, i - 1)];
      const after = dense[Math.min(dense.length - 1, i + 1)];
      const [bx, by] = xy(before[0], before[1]);
      const [ax, ay] = xy(after[0], after[1]);
      const [hx, hy] = xy(dense[i][0], dense[i][1]);
      const dx = ax - bx, dz = -(ay - by);
      const span = Math.hypot(dx, dz) || 1;
      const ux = dx / span, uz = dz / span;                       // along
      const nx = dz / span, nz = -dx / span;                      // left, in x/z
      const x = hx, z = -hy;
      const halfStep = Math.min(ROAD_FILL_STATION_M, span / 2) / 2 + 0.06;
      const at = (t, s) => [x + nx * t + ux * s, z + nz * t + uz * s];
      const current = [];
      const hits = rayCurbIntersections(x, z, nx, nz, 22, officialCurbGrid);
      const neg = hits.filter((v) => v < -0.8).pop();
      const pos = hits.find((v) => v > 0.8);
      if (neg !== undefined && pos !== undefined && pos - neg <= ROAD_FILL_MAX_SPAN_M) {
        const islands = rayCurbIntersections(x, z, nx, nz, 22, officialIslandCurbGrid)
          .filter((v) => v > neg && v < pos);
        // Walk the cross-section, gathering the runs nothing covers.
        let runStart = null;
        const runs = [];
        for (let t = neg + 0.15; t <= pos - 0.15 + 1e-6; t += ROAD_FILL_STEP_M) {
          const sx = x + nx * t, sz = z + nz * t;
          const covered = roadwayCovered(sx, sz);
          if (!covered && runStart === null) runStart = t;
          if ((covered || t + ROAD_FILL_STEP_M > pos - 0.15) && runStart !== null) {
            const end = covered ? t - ROAD_FILL_STEP_M / 2 : t + ROAD_FILL_STEP_M / 2;
            if (end - runStart >= ROAD_FILL_MIN_M) runs.push([runStart - ROAD_FILL_STEP_M / 2, Math.min(end, pos)]);
            runStart = null;
          }
        }
        for (const [t0, t1] of runs) {
          const width = t1 - t0;
          const kerbed = (t) => islands.some((v) => Math.abs(v - t) <= 0.45);
          const run = { t0, t1, a: at(t0, 0), b: at(t1, 0), halfStep, at,
                        island: !ISLAND_RINGS && width >= ROAD_FILL_ISLAND_MIN_M && kerbed(t0) && kerbed(t1), line: null };
          if (!run.island) {
            // A line where two carriageways meet across the strip.
            const left = carriagewaySourceAt(...at(t0 - 0.35, 0));
            const right = carriagewaySourceAt(...at(t1 + 0.35, 0));
            if (left && right && left.source !== right.source && width <= 3.5) {
              const mid = (t0 + t1) / 2;
              const opposing = onewaySign(left.source) !== 0
                && onewaySign(right.source) !== 0
                && Math.abs(((left.bearing - right.bearing) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < Math.PI / 3;
              const offsets = opposing ? [-(MARK_W + DOUBLE_GAP_M) / 2, (MARK_W + DOUBLE_GAP_M) / 2] : [0];
              run.line = { sink: opposing ? lines.yellow : lines.white, points: offsets.map((off) => at(mid + off, 0)) };
            }
          }
          current.push(run);
          stampFill(...run.a, ...run.b);
        }
      }
      // Join each run to the one at the station before that covers the same ground.
      const matched = new Set();
      for (const run of current) {
        const partner = previous.find((p) => !matched.has(p) && p.island === run.island
          && Math.min(p.t1, run.t1) - Math.max(p.t0, run.t0) > 0.3);
        if (partner) {
          matched.add(partner);
          drawStrip(partner, run);
        } else {
          // A strip beginning here: capped back half a station.
          const cap = { ...run, a: run.at(run.t0, -run.halfStep), b: run.at(run.t1, -run.halfStep),
                        line: run.line && { sink: run.line.sink, points: run.line.points.map(([px2, pz2]) => [px2 - ux * run.halfStep, pz2 - uz * run.halfStep]) } };
          drawStrip(cap, run);
        }
      }
      for (const p of previous) {
        if (matched.has(p)) continue;
        // A strip ending at the station before: capped forward half a station.
        const cap = { ...p, a: p.at(p.t0, p.halfStep), b: p.at(p.t1, p.halfStep),
                      line: p.line && { sink: p.line.sink, points: p.line.points.map(([px2, pz2]) => [px2 + ux * p.halfStep, pz2 + uz * p.halfStep]) } };
        drawStrip(p, cap);
      }
      previous = current;
    }
    for (const p of previous) {
      const cap = { ...p, a: p.at(p.t0, p.halfStep), b: p.at(p.t1, p.halfStep),
                    line: p.line && { sink: p.line.sink, points: p.line.points.map(([px2, pz2]) => [px2, pz2]) } };
      drawStrip(p, cap);
    }
  }
  const emit = (sink, material, surface, key) => {
    if (!sink.positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(sink.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(sink.uvs, 2));
    geometry.setIndex(sink.index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.surface = surface;
    addMerged(key, mesh, surface);
  };
  emit(asphalt, surfaceMaterial("road", 0xffffff, 1.0), "road", "junction:box");
  emit(island, surfaceMaterial("walk", 0xffffff, 1.0), "median", "median");
  for (const [color, list, y] of [[0xd8a92e, lines.yellow, 0.02], [0xdfe3e0, lines.white, 0.015]]) {
    if (!list.length) continue;
    const positions = [];
    const index = [];
    for (const [a, b] of list) {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len * MARK_W / 2, pz = dx / len * MARK_W / 2;
      const base = positions.length / 3;
      const h = ROAD_TOP_M + y;
      positions.push(a[0] + px, h, a[1] + pz, a[0] - px, h, a[1] - pz,
                     b[0] - px, h, b[1] - pz, b[0] + px, h, b[1] + pz);
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    }));
    mesh.userData.surface = "marking";
    addMerged(`marking:fill:${color.toString(16)}`, mesh, "marking");
  }
  return counts;
}
if (performance.now() - lastYieldAt > sliceBudget()) await yieldFrame();   // between whole steps too (a hop's longest task)
const roadwayFilled = fillRoadwayToKerbs();

function addClosedOfficialIslandSurfaces() {
  let laid = 0;
  const rings = ISLAND_RINGS || (OFFICIAL_GEOMETRY.curb_lines || []).map(closedOfficialIslandRing);
  for (const ring of rings) {
    if (!ring) continue;
    // The closed official curb is the physical evidence. Do not reject it using
    // the approximate OSM carriageway ribbon, which can miss small junction islands.
    const shape = new THREE.Shape();
    ring.forEach(([x, z], i) => { if (i) shape.lineTo(x, -z); else shape.moveTo(x, -z); });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: MEDIAN_KERB_M + 0.006, bevelEnabled: false, steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, ROAD_TOP_M, 0);
    const mesh = new THREE.Mesh(geometry, surfaceMaterial("walk", 0xffffff, 1.0));
    mesh.userData.surface = "median";
    addMerged("median:official-closed-island", mesh, "median");
    laid += 1;
  }
  return laid;
}
const officialIslandsLaid = addClosedOfficialIslandSurfaces();

//: The pavement out to the property line. The city surveys each street's sidewalk width, kerb to
//: property line, but the pavement is laid at the widest strip that fits the whole side -- often
//: a metre or two -- and the underlay beyond it at whatever its ladder of widths allowed, a
//: few centimetres below the ground. What was left between the pavement and the house fronts was
//: bare ground, a step down from the kerbside, all along the block. Each street side is walked
//: a metre at a time: from the outer edge of the pavement actually laid there out to the
//: surveyed width, stopping at a house front or another carriageway, the same paving is laid at
//: the same height (marked inferred: the survey says it is pavement, not what it looks like).
//: A side whose width was never surveyed is left as it is.
function addFrontageFill() { return runSteps(addFrontageFillSteps()); }
//: A side of a street at a time (a city's frontage, filled in one go, was a fifth of a second).
function* addFrontageFillSteps() {
  for (const { way, renderPoints, side, inner, walk, roadTop, color, opacity } of frontageSides) {
    yield;
    // As far as the surveyed sidewalk reaches, or where it was not surveyed the width drawn.
    if (!(way.walk_m > 0)) frontageStats.unsurveyed += 1;
    const reach = inner + Math.max(walk, way.walk_m || 0);
    const spine = densifyWay(renderPoints, FRONTAGE_STEP_M).map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    if (spine.length < 2) continue;
    // Out from `start` to the first building, carriageway, junction or other pavement, or to the
    // reach of the footway.
    const outTo = (point, start) => {
      let to = start;
      while (to + FRONTAGE_PROBE_M <= reach) {
        const [px, pz] = point(to + FRONTAGE_PROBE_M);
        if (buildingAt(px, pz) || insideCarriageway(px, pz, 0) || insideJunctionBox(px, pz)) break;
        if (pavementSurfaceAt(px, pz) !== null && to > start + FRONTAGE_PROBE_M) break;   // a footway beyond
        to += FRONTAGE_PROBE_M;
      }
      return to;
    };
    // What is at each station along this side: pavement (with the strip between its outer edge
    // and the frontage), nothing, or something that is not this side's to fill.
    const stations = spine.map((here, i) => {
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(spine.length - 1, i + 1)];
      const run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // Outward on this side, in page x, z (offsetWay's sense: +side is to the left of travel).
      const nx = side * (b[1] - a[1]) / run, nz = -side * (b[0] - a[0]) / run;
      const point = (d) => [here[0] + nx * d, here[1] + nz * d];
      frontageStats.stations += 1;
      if (insideJunctionBox(...point(inner))) { frontageStats.skipped.junction += 1; return { kind: "junction" }; }
      let from = inner + 0.05, top = null;
      while (from < reach) {
        const t = pavementSurfaceAt(...point(from));
        if (t === null) break;
        top = top === null ? t : Math.max(top, t);
        from += FRONTAGE_PROBE_M;
      }
      if (top === null) {
        const [px, pz] = point(inner + 0.05);
        if (insideCarriageway(px, pz, 0) || buildingAt(px, pz)) return { kind: "blocked" };
        frontageStats.skipped.noPavement += 1;
        return { kind: "bare", point };
      }
      const to = outTo(point, from);
      if (to - from < FRONTAGE_MIN_M) { frontageStats.skipped.noRoom += 1; return { kind: "paved", top, edge: point(inner) }; }
      return { kind: "paved", top, edge: point(inner), fill: { from: from - 0.05, to, point, top: top - FRONTAGE_BELOW_M } };
    });
    // A bare stretch between two paved stations: the footway carried through from the kerb, at
    // the height of the pavement either side of it.
    for (let i = 0; i < stations.length; i += 1) {
      if (stations[i].kind !== "bare") continue;
      let j = i;
      while (j + 1 < stations.length && stations[j + 1].kind === "bare") j += 1;
      const before = stations[i - 1], after = stations[j + 1];
      if (before && after && before.kind === "paved" && after.kind === "paved"
          && (j - i + 1) * FRONTAGE_STEP_M <= FRONTAGE_BRIDGE_M) {
        for (let k = i; k <= j; k += 1) {
          const share = (k - i + 1) / (j - i + 2);
          const top = before.top + (after.top - before.top) * share;
          const { point } = stations[k];
          const to = outTo(point, inner);
          if (to - inner < FRONTAGE_MIN_M) continue;
          stations[k] = { kind: "bridged", top, edge: point(inner),
            fill: { from: inner, to, point, top: top - FRONTAGE_BELOW_M } };
          frontageStats.bridged_m += FRONTAGE_STEP_M;
        }
      }
      i = j;
    }
    const position = [], uv = [], index = [];
    let filledHere = 0;
    // Textured square to the kerb, as the ribbons are: `u` along the street (ux, uz), `v` across
    // it, or for a kerb face (`upright`) up it.
    const quad = (q, y, ux, uz, upright = false) => {
      const base = position.length / 3;
      for (const [k, v] of q.entries()) {
        position.push(v[0], y[k], v[1]);
        uv.push((v[0] * ux + v[1] * uz) / WALK_UV_M, (upright ? y[k] : v[1] * ux - v[0] * uz) / WALK_UV_M);
      }
      // Up, whichever way round this side runs (for a kerb face, out of the road).
      const ex = q[1][0] - q[0][0], ez = q[1][1] - q[0][1];
      const fx = q[3][0] - q[0][0], fz = q[3][1] - q[0][1];
      if (ez * fx - ex * fz > 0) index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    // One square-ended slab per station, so that where the frontage steps -- one house set back
    // from the next -- the pavement steps with it instead of being drawn across the corner in a
    // slant. Each is half as long again as the step: where a run of pavement ends between two
    // stations the slab still reaches it, and where neighbours overlap they are one plane and
    // one texture, so the join cannot be seen. (What overhangs a shorter neighbour is inside the
    // building that made it shorter.) Toward a station with nothing laid, only to the middle.
    const reachAlong = (other) => FRONTAGE_STEP_M * (other && other.fill ? 0.75 : 0.52);
    for (let i = 0; i < stations.length; i += 1) {
      const { fill } = stations[i];
      if (!fill) continue;
      const [nearX, nearZ] = fill.point(fill.from), [farX, farZ] = fill.point(fill.to);
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(spine.length - 1, i + 1)];
      const run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const ux = (b[0] - a[0]) / run, uz = (b[1] - a[1]) / run;
      const back = reachAlong(stations[i - 1]), ahead = reachAlong(stations[i + 1]);
      const ring = [[nearX - ux * back, nearZ - uz * back], [farX - ux * back, farZ - uz * back],
                    [farX + ux * ahead, farZ + uz * ahead], [nearX + ux * ahead, nearZ + uz * ahead]];
      quad(ring, [fill.top, fill.top, fill.top, fill.top], ux, uz);
      stampPavedRing(ring, fill.top + FRONTAGE_BELOW_M);
      filledHere += FRONTAGE_STEP_M * (fill.to - fill.from);   // (each step counted once)
    }
    // Where the footway was carried to the kerb, the kerb's face down to the road, to the kerb
    // of the pavement it was carried from.
    for (let i = 1; i < stations.length; i += 1) {
      const p = stations[i - 1], q = stations[i];
      if ((p.kind === "bridged" || q.kind === "bridged") && p.edge && q.edge) {
        const run = Math.hypot(q.edge[0] - p.edge[0], q.edge[1] - p.edge[1]) || 1;
        quad([p.edge, q.edge, q.edge, p.edge], [roadTop, roadTop, q.top - FRONTAGE_BELOW_M, p.top - FRONTAGE_BELOW_M],
             (q.edge[0] - p.edge[0]) / run, (q.edge[1] - p.edge[1]) / run, true);
      }
    }
    if (!index.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, surfaceMaterial("walk", color, opacity));
    mesh.userData.surface = "walk";
    mesh.userData.basis = "inferred";
    addMerged("walk:frontage-fill", mesh, "walk");
    frontageStats.sides += 1;
    frontageStats.filled_m2 += filledHere;
    frontageStats.ways[way.osm_id] = (frontageStats.ways[way.osm_id] || 0) + Math.round(filledHere);
  }
  frontageStats.filled_m2 = Math.round(frontageStats.filled_m2);
  return frontageStats;
}

//: A street tree at least this far inside a carriageway's edge stands on an island nobody has
//: mapped -- a planted median, a pedestrian refuge -- and the island is drawn, marked inferred,
//: instead of the tree in the asphalt (the tree filter in the ground build). The island is
//: TREE_ISLAND_WIDTH_M across the street and runs TREE_ISLAND_END_M past its first and last
//: tree; trees in a line along one street within TREE_ISLAND_JOIN_M of each other share one.
const TREE_ISLAND_DEPTH_M = 1.2;
const TREE_ISLAND_WIDTH_M = 1.5;
const TREE_ISLAND_END_M = 1.5;
const TREE_ISLAND_JOIN_M = 12;
const treeIslandStats = { islands: 0, trees: 0, junction: 0, list: [] };
function nearestCarriagewaySegment(x, z) {
  let best = null, bestD = Infinity;
  const cx = Math.floor(x / CARRIAGEWAY_CELL), cz = Math.floor(z / CARRIAGEWAY_CELL);
  for (let dx = -1; dx <= 1; dx += 1) for (let dz = -1; dz <= 1; dz += 1) {
    for (const segment of carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz)) || []) {
      const d = distanceToSegmentSquared(x, z, segment[0], segment[1], segment[2], segment[3]);
      if (d < bestD) { bestD = d; best = segment; }
    }
  }
  return best;
}
//: The city's tree list puts records it has no surveyed spot for at the property's address
//: point: several trees on one exact coordinate, and that point is often in the middle of the lot
//: -- one stood alone in the middle of Marina Middle School's yard (2026-11-12), 1,233 such
//: stacks across the corridor. Of a stack, one tree is kept (the largest), and only where it is
//: on the street (within TREE_STACK_STREET_M of a carriageway, where street trees are); a stack
//: further in is an address, not a tree. ``streetDistance(tree)``: metres to the nearest
//: carriageway. Returns the Set of records to leave out.
const TREE_STACK_STREET_M = 9;
function stackedTreesToDrop(trees, streetDistance) {
  const stacks = new Map();
  for (const tree of trees) {
    const key = `${tree.p[0]},${tree.p[1]}`;
    if (!stacks.has(key)) stacks.set(key, []);
    stacks.get(key).push(tree);
  }
  const drop = new Set();
  for (const stack of stacks.values()) {
    if (stack.length < 2) continue;
    const keep = stack.reduce((a, b) => ((b.d || 0) > (a.d || 0) ? b : a));
    const onStreet = streetDistance(keep) <= TREE_STACK_STREET_M;
    for (const tree of stack) if (tree !== keep || !onStreet) drop.add(tree);
  }
  return drop;
}
function addTreeIslands(list) {
  for (const t of list) {
    const segment = nearestCarriagewaySegment(t.x, t.z);
    if (!segment) continue;
    const len = Math.hypot(segment[2] - segment[0], segment[3] - segment[1]) || 1;
    t.ux = (segment[2] - segment[0]) / len;
    t.uz = (segment[3] - segment[1]) / len;
  }
  const trees = list.filter((t) => t.ux !== undefined);
  // In a line along one street, near enough: one island.
  const owner = trees.map((_, i) => i);
  const root = (i) => (owner[i] === i ? i : (owner[i] = root(owner[i])));
  for (let i = 0; i < trees.length; i += 1) for (let j = i + 1; j < trees.length; j += 1) {
    const a = trees[i], b = trees[j], dx = b.x - a.x, dz = b.z - a.z;
    if (Math.hypot(dx, dz) > TREE_ISLAND_JOIN_M || Math.abs(a.ux * b.ux + a.uz * b.uz) < 0.95) continue;
    if (Math.abs(-dx * a.uz + dz * a.ux) > 1.0) continue;
    owner[root(j)] = root(i);
  }
  const clusters = new Map();
  trees.forEach((t, i) => { const r = root(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(t); });
  const top = ROAD_TOP_M + MEDIAN_KERB_M;
  for (const members of clusters.values()) {
    const { x: x0, z: z0, ux, uz } = members[0];
    const nx = -uz, nz = ux;
    const along = members.map((t) => (t.x - x0) * ux + (t.z - z0) * uz);
    const across = members.map((t) => (t.x - x0) * nx + (t.z - z0) * nz);
    const mid = across.reduce((sum, c) => sum + c, 0) / across.length;
    const at = (a, c) => [x0 + ux * a + nx * c, z0 + uz * a + nz * c];
    let a0 = Math.min(...along) - TREE_ISLAND_END_M, a1 = Math.max(...along) + TREE_ISLAND_END_M;
    // Its ends stop short of a junction: the box is roadway.
    while (a1 - a0 > 1.0 && insideJunctionBox(...at(a0, mid))) a0 += 0.25;
    while (a1 - a0 > 1.0 && insideJunctionBox(...at(a1, mid))) a1 -= 0.25;
    const w = TREE_ISLAND_WIDTH_M / 2;
    const ring = [at(a0, mid - w), at(a1, mid - w), at(a1, mid + w), at(a0, mid + w)];
    const mesh = squarePavementMesh(ring.map(([x, z]) => [x, -z]), [[0, 1], [1, 2], [2, 3], [3, 0]], () => top,
      ROAD_TOP_M - 0.02, (q) => (q[0] * ux - q[1] * uz) / WALK_UV_M, (q) => (q[0] * nx - q[1] * nz) / WALK_UV_M,
      0xffffff, 1.0);
    if (!mesh) continue;
    mesh.userData.surface = "median";
    mesh.userData.basis = "inferred";
    mesh.userData.from = "street_trees";
    addGround(mesh, "median");
    stampPavedRing(ring, top);
    treeIslandStats.islands += 1;
    treeIslandStats.trees += members.length;
    treeIslandStats.list.push({ x: +x0.toFixed(1), z: +z0.toFixed(1), trees: members.length,
      length: +(a1 - a0).toFixed(1), basis: "inferred" });
  }
}

// Ground. Everything that is not a road, a footway or a building stands on something -- back
// yards, light wells, car parks, the middle of a block -- and none of it is mapped. Without a
// surface under them those became holes onto the background, which reads as black voids
// punched through the city. A dark neutral says "ground we have not described" rather than
// "nothing is here".
// Removed: a second full-bbox plate sat a centimetre above the first and did the same job in a
// different colour. Two backdrops is one too many, and this was the one showing through Aquatic
// Park as a dark wedge over the cove.

// ---- what is on the ground ----
//
// A third of this corridor had nothing drawn on it: back gardens, light wells, car parks, the
// middles of blocks, and the parks. It rendered as holes onto the background, which is where
// the black patches came from.
//
// None of it needed inventing. San Francisco maps its parks, and it maps every parcel, so the
// ground between a house and its property line is a polygon the city already holds. The trees
// are the part that would otherwise have been made up -- five procedural variants scattered at
// random would have looked like a city, while twenty-seven thousand real positions with a
// species and a trunk diameter each is this city.
//
// Everything here is merged or instanced. Thirty-three thousand separate meshes is thirty-three
// thousand draw calls and no frame rate; merged, it is four.
// The stack between the base plane (0) and the top of the carriageway (0.06). Everything on the
// ground goes in here, in the order a survey would find it: earth, then the surface laid on it,
// then the paint on that surface.
//
// Every layer names its own height. They used to be written as offsets from each other --
// the paved frontage went in at ``YARD_Y + 0.004`` -- and that arithmetic landed it on exactly
// PARK_Y, so wherever a parcel and a park overlapped, two large flat polygons occupied the same
// plane and the depth buffer had to choose between them per pixel. Over Joe DiMaggio Playground
// that came out as green tearing through grey in stripes, which is what a coincidence of two
// constants looks like from the street. GROUND_STACK below is checked at load, so a future
// collision stops the build rather than reappearing as a glitch nobody can place.
const INFERRED_Y = 0.011;      // ground no record describes, inferred from what surrounds it
const PLAZA_Y = 0.014;         // the paved remainder of a commercial or public lot
const YARD_Y = 0.016;          // a parcel's grass remainder
const SERVICE_YARD_Y = 0.019;  // the neutral slivers between buildings
const PARK_Y = 0.022;          // mapped public green
const FRONT_WALK_Y = 0.025;    // paving between a stoop and the pavement
const COURT_Y = 0.030;         // asphalt and turf laid inside a park
const PLAYGROUND_Y = 0.034;    // a playground's safety surface, a skatepark's concrete
const COURT_LINE_Y = 0.042;    // the paint on the courts
// PARKING_Y and PARKING_LINE_Y are declared with the car-park renderer, which the street loop
// reaches before this block runs; they are still checked in GROUND_STACK below.

//: No two of these may be equal, and none may reach the carriageway's own top at 0.06.
const GROUND_STACK = {
  YARD_Y, SERVICE_YARD_Y, PARK_Y, FRONT_WALK_Y, COURT_Y, PLAYGROUND_Y, COURT_LINE_Y, PARKING_Y, PARKING_LINE_Y, PIER_DECK_Y, PLAZA_Y,
};
{
  const seen = new Map();
  for (const [name, y] of Object.entries(GROUND_STACK)) {
    if (seen.has(y)) {
      throw new Error(`ground stack: ${name} and ${seen.get(y)} are both at ${y} m, `
        + "which is two surfaces in one plane and a depth fight wherever they overlap");
    }
    if (y >= 0.06) throw new Error(`ground stack: ${name} at ${y} m is up in the carriageway`);
    seen.set(y, name);
  }
}

//: How far above the pavement's own top the pit sits: enough that the two do not fight for the
//: same plane, and little enough that it still reads as an opening cut in it.
const PIT_LIFT_M = 0.004;

function soilTexture() {
  // Bare soil in a tree pit: dark, damp, uneven, with grit and leaf litter in it. Flat brown
  // reads as a painted square, which is the failure this has to avoid -- what makes it ground is
  // that no two square inches of it are the same colour.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3b2c1e";
  ctx.fillRect(0, 0, size, size);
  // Damp and dry patches first, so the grit below sits on something uneven.
  for (let i = 0; i < 60; i += 1) {
    const r = 6 + random(i * 17) * 26;
    ctx.fillStyle = random(i * 5) < 0.5 ? "rgba(26,18,11,0.45)" : "rgba(96,74,50,0.35)";
    ctx.beginPath();
    ctx.arc(random(i * 3) * size, random(i * 7) * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Grit, bark and the odd leaf.
  const grains = [
    ["rgba(20,14,9,0.60)", 2600, 1.5],
    ["rgba(74,56,36,0.50)", 2000, 1.2],
    ["rgba(120,96,64,0.45)", 1200, 1.0],
    ["rgba(150,128,86,0.35)", 500, 0.9],
  ];
  let n = 0;
  for (const [colour, count, radius] of grains) {
    ctx.fillStyle = colour;
    for (let i = 0; i < count; i += 1) {
      n += 1;
      ctx.beginPath();
      ctx.arc(random(n * 2.9) * size, random(n * 4.7) * size,
              radius * (0.5 + random(n * 6.3) * 0.9), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // The kerb of the pit: the cut edge of the pavement round it, which is what says "opening".
  ctx.strokeStyle = "rgba(150,150,142,0.55)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const GRASS_TEXTURES = new Map();
//: Every window's lawns, painted once for the page (grassTexture). Not disposed with a window.
const SHARED_GRASS = globalThis.__kerbsideGrass ??= new Map();
//: A dozen kinds of lawn, told apart by how the grass grows on them rather than by a palette:
//: how long the blades are, how many, how thick, how green, and how much of the ground shows
//: through as straw and soil. Every lawn polygon draws one of these, chosen by a hash of its
//: own ring, so neighbouring yards differ and the same yard is the same on every load.
const GRASS_KINDS = [
  { name: "mown fine",     hue: 112, sat: 0.42, light: 0.28, blades: 9000, len: 1.6, width: 1.0, brown: 0.02 },
  { name: "mown coarse",   hue: 106, sat: 0.40, light: 0.29, blades: 7000, len: 2.2, width: 1.2, brown: 0.03 },
  { name: "medium",        hue: 110, sat: 0.38, light: 0.27, blades: 6500, len: 3.2, width: 1.1, brown: 0.03 },
  { name: "medium dense",  hue: 116, sat: 0.45, light: 0.25, blades: 9500, len: 3.0, width: 1.0, brown: 0.015 },
  { name: "long wispy",    hue: 100, sat: 0.32, light: 0.30, blades: 4200, len: 6.5, width: 0.9, brown: 0.03 },
  { name: "long thick",    hue: 108, sat: 0.40, light: 0.24, blades: 5200, len: 5.5, width: 1.5, brown: 0.02 },
  { name: "tufted",        hue: 104, sat: 0.36, light: 0.28, blades: 3600, len: 4.5, width: 1.3, brown: 0.03, tufts: 160 },
  { name: "dry",           hue: 86,  sat: 0.28, light: 0.32, blades: 5000, len: 3.4, width: 1.0, brown: 0.06 },
  { name: "lush dark",     hue: 120, sat: 0.48, light: 0.22, blades: 8800, len: 2.8, width: 1.1, brown: 0.01 },
  { name: "lush light",    hue: 114, sat: 0.45, light: 0.33, blades: 8000, len: 2.6, width: 1.0, brown: 0.01 },
  { name: "worn",          hue: 98,  sat: 0.26, light: 0.28, blades: 3000, len: 2.4, width: 1.0, brown: 0.05 },
  { name: "clover",        hue: 118, sat: 0.40, light: 0.27, blades: 2400, len: 1.8, width: 1.0, brown: 0.02, leaves: 5000 },
];
const GRASS_VARIANTS = GRASS_KINDS.length;

function hslToBytes(h, s, l, out, at) {
  // Plain HSL to 8-bit sRGB, for a quarter of a million pixels per texture: cheaper than a
  // THREE.Color round trip through linear light for each.
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  out[at] = Math.round(channel(h + 1 / 3) * 255);
  out[at + 1] = Math.round(channel(h) * 255);
  out[at + 2] = Math.round(channel(h - 1 / 3) * 255);
}

function grassTexture(kind = "yard", variant = 0) {
  const key = `${kind}:${variant}`;
  if (GRASS_TEXTURES.has(key)) return GRASS_TEXTURES.get(key);
  // The same lawn in every window: each painted its own (a quarter of a million pixels and a
  // few thousand blades a texture, a freeze of a walking frame each) and held its own on the GPU.
  if (SHARED_GRASS.has(key)) { GRASS_TEXTURES.set(key, SHARED_GRASS.get(key)); return SHARED_GRASS.get(key); }
  // No pattern at any scale. This used to be a base green with a hundred soft patches, a set
  // of mowing lines and a field of blades, tiled every four metres -- and a patch or a mowing
  // line is a feature, so from any height the eye found the same feature every four metres
  // and the lawn was a grid. Now every pixel takes its own shade of green, a few per hundred
  // its own brown of soil or straw, and the blades go over that; nothing in the tile is
  // larger than a blade, so the repeat has nothing to show. What varies from lawn to lawn is
  // the kind of grass, one of GRASS_KINDS, and that is chosen per polygon.
  const spec = GRASS_KINDS[Math.abs(variant) % GRASS_VARIANTS];
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const seed = (variant + 1) * 991 + (kind === "park" ? 17 : 0);
  // Parks are kept a shade fuller than back yards.
  const light = spec.light + (kind === "park" ? 0.03 : 0);
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const colour = new THREE.Color();
  let n = 0;
  for (let i = 0; i < size * size; i += 1) {
    n += 1;
    const r1 = random(seed + n * 1.7);
    const r2 = random(seed + n * 2.3);
    const r3 = random(seed + n * 3.9);
    let h;
    let sat;
    let lit;
    if (r1 < spec.brown) {
      // Soil, or straw: a warm brown, sometimes pale.
      h = (28 + r2 * 18) / 360; sat = 0.35 + r3 * 0.2; lit = 0.22 + r2 * 0.22;
    } else {
      h = (spec.hue + (r2 - 0.5) * 22) / 360; sat = spec.sat + (r3 - 0.5) * 0.24;
      lit = light + (r1 - 0.5) * 0.22;
    }
    hslToBytes(h, sat, lit, data, i * 4);
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  // The blades: strokes of the kind's own length and thickness, dark to light so the field
  // has depth, leaning every way.
  const passes = [
    [0.18, 0.38, 0.9],
    [0.26, 0.30, 0.8],
    [0.42, 0.22, 0.6],
    [0.58, 0.10, 0.4],
  ];
  ctx.lineCap = "round";
  for (const [lightness, share, alpha] of passes) {
    const count = Math.round(spec.blades * share);
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const x = random(seed + n * 3.1) * size;
      const y = random(seed + n * 5.7) * size;
      const angle = random(seed + n * 7.3) * Math.PI * 2;
      const l = spec.len * (0.6 + random(seed + n * 11.9) * 0.9);
      colour.setHSL((spec.hue + (random(seed + n * 4.4) - 0.5) * 20) / 360,
                    spec.sat + 0.1, lightness + (random(seed + n * 6.1) - 0.5) * 0.12, THREE.SRGBColorSpace);
      ctx.strokeStyle = `rgba(${Math.round(colour.r * 255)},${Math.round(colour.g * 255)},${Math.round(colour.b * 255)},${alpha})`;
      ctx.lineWidth = spec.width * (0.7 + random(seed + n * 2.2) * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * l, y + Math.sin(angle) * l);
      ctx.stroke();
    }
  }
  // Tufts, where the kind has them: a knot of longer blades from one root.
  for (let t = 0; t < (spec.tufts || 0); t += 1) {
    n += 1;
    const x = random(seed + n * 3.3) * size;
    const y = random(seed + n * 5.1) * size;
    for (let b = 0; b < 9; b += 1) {
      n += 1;
      const angle = random(seed + n * 7.7) * Math.PI * 2;
      const l = spec.len * (1.2 + random(seed + n * 9.1));
      ctx.strokeStyle = `rgba(40,110,38,0.75)`;
      ctx.lineWidth = spec.width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * l, y + Math.sin(angle) * l);
      ctx.stroke();
    }
  }
  // Leaves, where the kind has them: clover's round ones.
  for (let t = 0; t < (spec.leaves || 0); t += 1) {
    n += 1;
    ctx.fillStyle = random(seed + n * 2.9) < 0.5 ? "rgba(70,150,60,0.55)" : "rgba(110,180,80,0.45)";
    ctx.beginPath();
    ctx.arc(random(seed + n * 3.7) * size, random(seed + n * 5.3) * size, 0.9 + random(seed + n * 7.9) * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // The ground meshes carry their own UVs at one tile per eight metres, and the tile is left
  // at that: eight metres of lawn at a centimetre and a half a pixel, with nothing in it that
  // could be recognised from one repeat to the next.
  texture.repeat.set(1, 1);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.shared = true;
  GRASS_TEXTURES.set(key, texture);
  SHARED_GRASS.set(key, texture);
  return texture;
}

function grassVariantForRing(ring, count) {
  if (!ring || !ring.length || count <= 1) return 0;
  let sx = 0;
  let sy = 0;
  for (const point of ring) {
    sx += point[0] || 0;
    sy += point[1] || 0;
  }
  const seed = Math.abs(Math.sin(sx * 1289.17 + sy * 2371.31 + ring.length * 19.7));
  return Math.floor(seed * count) % count;
}

//: How small a ground-cover triangle that straddles a kerb line is cut before it is judged.
const RING_CLIP_M = 3.0;
//: A ground-cover ring is cut to the region's box, this far past it. The Presidio's park
//: polygon runs kilometres past the corridor; lifted onto the ground at its corners, the
//: corner inside the box on a hill and the corner outside on nothing, it was a green
//: triangle a kilometre long tilted seventy metres into the air over the apron.
const RING_BOX_MARGIN_M = 40.0;
function clipRingToBox(ring) {
  const b=typeof BUILD_WINDOW!=="undefined" && BUILD_WINDOW
    ? {west:BUILD_WINDOW.box[0],south:BUILD_WINDOW.box[1],east:BUILD_WINDOW.box[2],north:BUILD_WINDOW.box[3]} : bbox;
  const [bw, bs] = xy(b.west, b.south), [be, bn] = xy(b.east, b.north);
  const west = bw - RING_BOX_MARGIN_M, east = be + RING_BOX_MARGIN_M, south = bs - RING_BOX_MARGIN_M, north = bn + RING_BOX_MARGIN_M;
  let poly = ring.map(([lon, lat]) => xy(lon, lat));
  // Sutherland-Hodgman against each of the four edges.
  for (const [inside, cut] of [
    [(p) => p[0] >= west, (a, b) => { const t0 = (west - a[0]) / (b[0] - a[0]); return [west, a[1] + (b[1] - a[1]) * t0]; }],
    [(p) => p[0] <= east, (a, b) => { const t0 = (east - a[0]) / (b[0] - a[0]); return [east, a[1] + (b[1] - a[1]) * t0]; }],
    [(p) => p[1] >= south, (a, b) => { const t0 = (south - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t0, south]; }],
    [(p) => p[1] <= north, (a, b) => { const t0 = (north - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t0, north]; }],
  ]) {
    const out = [];
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    poly = out;
    if (poly.length < 3) return null;
  }
  return poly.map(([x, y]) => lonLatFromXZ(x, -y));
}
// The source polygons for parks and parcels can overlap paved paths and mapped sport pitches.
// Elevation alone cannot establish precedence: the grass may bridge a steep 2 m terrain cell
// while the narrow path follows it. Keep hard surfaces out of grass triangulation altogether.
const HARD_GROUND_CELL_M = 16.0;
function hardGroundExclusion(ground) {
  const grid = new Map();
  const rows = [
    ...(ground.front_walks || []), ...(ground.plazas || []), ...(ground.service_yards || []),
    ...(DATA.ways||[]).filter(w=>w.kind==="parking_lot").map(w=>({p:w.points})),
    ...(ground.pitches || []).filter((p) => COURT_STYLE[p.s] && COURT_STYLE[p.s].surround !== null),
    // The pad between a block's courts is asphalt too, not grass showing between them.
    ...(ground.court_complexes || []).filter((c) => c.surface === "hard"),
    // Exclude the surface we actually draw, not only the source pitch: an oriented playing
    // rectangle (including its paint bleed) can extend beyond an irregular mapped outline.
    ...(!HEADSET ? hardCourtFootprints(ground) : []),
    // A playground's safety surface and a skatepark's concrete: no grass under them to show
    // through where the hill bulges between the surface's own vertices.
    ...((typeof PARK_EVIDENCE === "undefined" ? null : PARK_EVIDENCE)?.areas || []).filter((a) => (a.kind === "playground" && a.surface?.material !== "grass")
      || a.kind === "skatepark").map((a) => ({ p: a.p })),
  ];
  for (const row of rows) {
    const clipped = clipRingToBox(row.p);
    if (!clipped) continue;
    const ring = clipped.map(([lon, lat]) => xy(lon, lat));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    for (let ix = Math.floor(minX / HARD_GROUND_CELL_M);
         ix <= Math.floor(maxX / HARD_GROUND_CELL_M); ix += 1) {
      for (let iy = Math.floor(minY / HARD_GROUND_CELL_M);
           iy <= Math.floor(maxY / HARD_GROUND_CELL_M); iy += 1) {
        const key = `${ix}:${iy}`;
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, bucket = []);
        bucket.push(ring);
      }
    }
  }
  return (x, z) => {
    if (pavementTopAt(x, z) !== undefined) return true;
    const bucket = grid.get(`${Math.floor(x / HARD_GROUND_CELL_M)}:${Math.floor(-z / HARD_GROUND_CELL_M)}`);
    return Boolean(bucket && bucket.some((ring) => pointInRing(x, -z, ring)));
  };
}

function hardCourtFootprints(ground) {
  return (ground.courts || []).flatMap(court => {
    const style = COURT_STYLE[court.s];
    if (!style || style.surround === null) return [];
    const paint = courtPainter(court, null), bleed = style.bleed ?? 1.2;
    const l = (court.l + bleed) / 2, w = (court.w + bleed) / 2;
    const p = [[-l,-w],[l,-w],[l,w],[-l,w],[-l,-w]].map(([a,b]) => {
      const [x,z] = paint.at(a,b); return lonLatFromXZ(x,z);
    });
    return [{p}];
  });
}

// A triangle can cover a narrow path entirely between its vertices, so vertex/centroid
// clipping alone cannot guarantee that grass stays off paving. Rasterize the same hard-surface
// footprint once at one metre and discard grass fragments there on the GPU. The CPU clip above
// still shapes its boundary, but does not need to subdivide whole parks to path-pixel scale.
function grassRasterRows(rings, west, south, width, height, step) {
  const rows = Array.from({ length: height }, () => []);
  for (const ring of rings) {
    const local = ring.map((p) => xy(...p));
    if (!local.length) continue;
    const x0 = Math.max(0, Math.floor((Math.min(...local.map((p) => p[0])) - west) / step) - 1);
    const x1 = Math.min(width, Math.ceil((Math.max(...local.map((p) => p[0])) - west) / step) + 1);
    const y0 = Math.max(0, Math.floor((Math.min(...local.map((p) => p[1])) - south) / step) - 1);
    const y1 = Math.min(height, Math.ceil((Math.max(...local.map((p) => p[1])) - south) / step) + 1);
    if (x1 <= x0) continue;
    for (let y = y0; y < y1; y += 1) rows[y].push([x0, x1]);
  }
  return rows.map((ranges) => {
    const merged = [];
    for (const range of ranges.sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range.slice());
    }
    return merged;
  });
}

//: Async: a row at a time between frames -- the whole window in one go held a walking frame for
//: 0.2-0.4 s (2026-11-05).
async function grassHardMask(excludeAt, rings = null) {
  const b=typeof BUILD_WINDOW!=="undefined" && BUILD_WINDOW
    ? {west:BUILD_WINDOW.box[0],south:BUILD_WINDOW.box[1],east:BUILD_WINDOW.box[2],north:BUILD_WINDOW.box[3]} : bbox;
  const [bw, bs] = xy(b.west, b.south), [be, bn] = xy(b.east, b.north);
  // Three-quarter-metre cells retain the old two-channel mask's memory budget while
  // resolving narrow paths and stair-step edges more faithfully. One channel encodes
  // hard surface (0), park-only underlay (128), or grass (255).
  const step = 0.75;
  const west = bw - RING_BOX_MARGIN_M, south = bs - RING_BOX_MARGIN_M;
  const width = Math.ceil((be + RING_BOX_MARGIN_M - west) / step);
  const height = Math.ceil((bn + RING_BOX_MARGIN_M - south) / step);
  const east = west + width * step, north = south + height * step;
  const data = new Uint8Array(width * height).fill(255);
  // Test only conservative grass bounds. Roads and water miles outside any
  // grass mesh cannot contribute a fragment; querying them dominated startup.
  const rows = rings ? grassRasterRows(rings, west, south, width, height, step) : null;
  for (let iy = 0; iy < height; iy += 1) {
    await maybeYield();
    const y = south + (iy + 0.5) * step;
    for (const [first, end] of rows ? rows[iy] : [[0, width]]) for (let ix = first; ix < end; ix += 1) {
      const x = west + (ix + 0.5) * step, z = -y;
      const hard = excludeAt(x, z) || insideCarriageway(x, z, 0.15);
      data[iy * width + ix] = hard ? 0 : parkPavementAt(x, z) ? 128 : 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, west, east, south, north };
}

function maskedGrassMaterial(map, hardMask, roughness, park = false) {
  // GLSL ES does not implicitly divide floats by integer literals. Cell extents can be
  // exact metres (e.g. 3420), so force every injected coordinate to a float literal.
  const glslFloat = (value) => Number(value).toFixed(8);
  const material = new THREE.MeshStandardMaterial({
    map, color: 0xffffff, roughness, metalness: 0.0, side: THREE.DoubleSide, depthTest: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.groundHardMask = { value: hardMask.texture };
    shader.vertexShader = shader.vertexShader.replace("#include <common>",
      "#include <common>\nvarying vec2 vGroundHardUv;");
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
      `#include <begin_vertex>\nvGroundHardUv = vec2((position.x - ${glslFloat(hardMask.west)}) / ${glslFloat(hardMask.east - hardMask.west)}, `
      + `(-position.z - ${glslFloat(hardMask.south)}) / ${glslFloat(hardMask.north - hardMask.south)});`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
      "#include <common>\nvarying vec2 vGroundHardUv;\nuniform sampler2D groundHardMask;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>\nif (texture2D(groundHardMask, vGroundHardUv).r < ${park ? "0.75" : "0.25"}) discard;`);
  };
  // These extents are baked into the shader above. A shared key reused the
  // previous window/city's UV transform with the new mask, exposing random patches.
  material.customProgramCacheKey = () => `ground-hard-mask-v4-${park ? "park" : "yard"}-`
    + [hardMask.west,hardMask.east,hardMask.south,hardMask.north].map(glslFloat).join(":");
  return material;
}

function ringGeometry(rings, y, clipToRoad = true, excludeAt = null) {
  // One geometry for every ring handed in, triangulated by ear clipping through THREE.Shape.
  const positions = [];
  const uvs = [];
  const indices = [];
  for (const raw of rings) {
    const ring = clipRingToBox(raw);
    if (!ring) continue;
    const shape = new THREE.Shape();
    let started = false;
    for (const [lon, lat] of ring) {
      const [x, z] = xy(lon, lat);
      if (!started) { shape.moveTo(x, z); started = true; } else shape.lineTo(x, z);
    }
    if (!started) continue;
    let geom;
    try {
      geom = new THREE.ShapeGeometry(shape);
    } catch (err) {
      continue;                        // a self-intersecting ring; skip it rather than throw
    }
    const base = positions.length / 3;
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      // ShapeGeometry lays the shape in XY; this is a ground plane, so its y becomes -z.
      positions.push(pos.getX(i), y, -pos.getY(i));
      uvs.push(pos.getX(i) / 8, pos.getY(i) / 8);
    }
    const index = geom.getIndex();
    if (clipToRoad) {
      // The backstop. Ground cover is laid from parcels and park polygons, and a parcel
      // boundary is surveyed to the property line rather than to the kerb -- so a thousand of
      // these rings reach into the carriageway, and 753 of them are front paths that draw with
      // the pavement texture. Drawn unclipped they are the concrete slabs in the middle of the
      // road. A triangle whose centre is on the carriageway is not laid.
      // The centre alone is not enough, and neither are the corners. A park is a handful of
      // very large triangles, and one of those can have its centre over a road that clips a
      // corner of the park while the park itself is nowhere near it; a parcel's triangle can
      // have every corner on dry land and still lie across the alley between them -- Grenard
      // Terrace was a lawn. So a triangle whose corners and centre do not all agree is cut along
      // its longest edge, and cut again, until its pieces are under RING_CLIP_M or agree; a
      // piece with its centre and two corners on the carriageway is not laid. Only the
      // triangles that straddle the kerb line are cut, so a park stays a handful of triangles.
      const px = (i) => pos.getX(i), py = (i) => pos.getY(i);
      const local = new Map();            // extra vertices made by the cuts, keyed by pair
      let extra = 0;
      const extraPos = [];
      const gx = (i) => i < pos.count ? px(i) : extraPos[(i - pos.count) * 2];
      const gy = (i) => i < pos.count ? py(i) : extraPos[(i - pos.count) * 2 + 1];
      // Keep road-edge clipping here. Sidewalks, paths and courts are removed
      // by the sub-metre grass shader mask; rejecting a whole boundary triangle
      // for one hard-surface corner left jagged bare patches in the lawn.
      const blockedAt = (x, y) => insideCarriageway(x, -y, 0.15);
      const blockedCache = new Map();
      const road = (i) => {
        if (!blockedCache.has(i)) blockedCache.set(i, blockedAt(gx(i), gy(i)));
        return blockedCache.get(i);
      };
      const cutAt = (a, b) => {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        let m = local.get(key);
        if (m !== undefined) return m;
        m = pos.count + extra;
        extra += 1;
        extraPos.push((gx(a) + gx(b)) / 2, (gy(a) + gy(b)) / 2);
        local.set(key, m);
        return m;
      };
      const kept = [];
      const stack = [];
      const count = index ? index.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        stack.push(index ? index.getX(t) : t, index ? index.getX(t + 1) : t + 1, index ? index.getX(t + 2) : t + 2);
        while (stack.length) {
          const c = stack.pop(), b = stack.pop(), a = stack.pop();
          const ra = road(a), rb = road(b), rc = road(c);
          const centre = blockedAt((gx(a) + gx(b) + gx(c)) / 3, (gy(a) + gy(b) + gy(c)) / 3);
          const agree = ra === rb && rb === rc && rc === centre;
          const ab = Math.hypot(gx(a) - gx(b), gy(a) - gy(b));
          const bc = Math.hypot(gx(b) - gx(c), gy(b) - gy(c));
          const ca = Math.hypot(gx(c) - gx(a), gy(c) - gy(a));
          const longest = Math.max(ab, bc, ca);
          if (agree || longest < RING_CLIP_M) {
            if (!(centre && (ra + rb + rc) >= 2)) kept.push(a, b, c);
            continue;
          }
          if (longest === ab) { const m = cutAt(a, b); stack.push(a, m, c, m, b, c); }
          else if (longest === bc) { const m = cutAt(b, c); stack.push(a, b, m, a, m, c); }
          else { const m = cutAt(c, a); stack.push(a, b, m, m, b, c); }
        }
      }
      for (let k = 0; k < extra; k += 1) {
        positions.push(extraPos[k * 2], y, -extraPos[k * 2 + 1]);
        uvs.push(extraPos[k * 2] / 8, extraPos[k * 2 + 1] / 8);
      }
      for (let k = 0; k < kept.length; k += 1) indices.push(base + kept[k]);
    } else if (index) {
      for (let i = 0; i < index.count; i += 1) indices.push(base + index.getX(i));
    } else {
      // A non-indexed geometry lists its triangles as consecutive vertices. Only handling the
      // indexed case meant every ring contributed vertices and no faces, the merged geometry
      // came out with an empty index, and the whole thing returned null -- so the parks and
      // the gardens were built, found to be empty, and silently dropped. Which is why Moscone
      // and every yard were still black holes after the ground cover said it had filled them.
      for (let i = 0; i < pos.count; i += 1) indices.push(base + i);
    }
    geom.dispose();
  }
  if (!indices.length) return null;
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

