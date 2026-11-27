// ---- the curb ramps the inventory says are at each corner --------------------------------
//
// Public Works lists every corner leg of every intersection -- 7,774 rows at 1,153 places --
// each placed at the intersection itself and named by its corner (NE, SW, or N/S/E/W where the
// return is a single leg) with ``crexist`` saying whether a ramp is there. That is not a
// position a crossing can end on, but it is the one record of where crossing ends belong: a
// span whose end stands at a corner the inventory gives a ramp is a crossing the city knows;
// one at a corner with no ramp record is a crossing the model drew on its own.
const RAMP_NODE_CELL_M = 40.0;
const RAMP_NODE_REACH_M = 22.0;
const rampNodeGrid = new Map();
const osmRampNodes = [];

function indexOsmCurbRamps(ways) {
  osmRampNodes.length = 0;
  for (const way of ways || []) {
    if (way.kind !== "curb_ramp" || !way.point) continue;
    const [x, y] = xy(way.point[0], way.point[1]);
    osmRampNodes.push({ x, z: -y, type: way.kerb_type,
                        accessible: way.accessible_lip === true, osmId: way.osm_id });
  }
}

function nearestOsmRamp(x, z, reach = 2.0) {
  let found = null;
  for (const ramp of osmRampNodes) {
    const distance = Math.hypot(x - ramp.x, z - ramp.z);
    if (distance <= reach && (!found || distance < found.distance)) {
      found = { ...ramp, distance };
    }
  }
  return found;
}

function indexCurbRamps(ramps) {
  rampNodeGrid.clear();
  for (const ramp of ramps || []) {
    const physical = ramp.position_basis === "physical_point";
    if (!ramp.p || (!ramp.c && !physical)) continue;
    const [x, y] = xy(ramp.p[0], ramp.p[1]);
    const key = `${Math.floor(x / RAMP_NODE_CELL_M)}:${Math.floor(-y / RAMP_NODE_CELL_M)}`;
    if (!rampNodeGrid.has(key)) rampNodeGrid.set(key, []);
    rampNodeGrid.get(key).push({ x, z: -y, physical, corner: String(ramp.c || "").toUpperCase(),
                                 exists: !(ramp.f || []).includes("no_ramp") });
  }
}

//: Which corner of the intersection at (nx, nz) a point stands in, by bearing: NE, NW, SE, SW.
function cornerOf(nx, nz, x, z) {
  const east = x - nx, north = -(z - nz);
  return `${north >= 0 ? "N" : "S"}${east >= 0 ? "E" : "W"}`;
}

//: The inventory's word on one crossing end: "ramp" (a ramp is recorded at this corner),
//: "no_ramp" (the corner is listed without one), or null (no intersection record within
//: reach). The corner's single-letter legs (N, S, E, W) count for both corners they touch.
function rampRecordAt(x, z) {
  const mapped = nearestOsmRamp(x, z, 2.0);
  if (mapped) return mapped.accessible ? "ramp" : "no_ramp";
  const cx = Math.floor(x / RAMP_NODE_CELL_M), cz = Math.floor(z / RAMP_NODE_CELL_M);
  let node = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const ramp of rampNodeGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        const d = Math.hypot(ramp.x - x, ramp.z - z);
        // Some municipal inventories locate the actual ramp rather than an
        // intersection centre. Never infer a 22 m corner reach from those points.
        if (ramp.physical) {
          if (d <= 2.0) return ramp.exists ? "ramp" : "no_ramp";
          continue;
        }
        if (d <= RAMP_NODE_REACH_M && (!node || d < node.d)) node = { d, x: ramp.x, z: ramp.z };
      }
    }
  }
  if (!node) return null;
  const corner = cornerOf(node.x, node.z, x, z);
  let found = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const ramp of rampNodeGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        if (ramp.physical) continue;
        if (Math.hypot(ramp.x - node.x, ramp.z - node.z) > 0.5) continue;
        const matches = ramp.corner === corner
          || (ramp.corner.length === 1 && corner.includes(ramp.corner));
        if (!matches) continue;
        if (ramp.exists) return "ramp";
        found = "no_ramp";
      }
    }
  }
  return found;
}

indexCurbRamps(OFFICIAL_GEOMETRY.curb_ramps || []);
indexOsmCurbRamps(DATA.ways);

//: A crossing's end lies on the kerb the model drew. The ray through the city's kerb lines
//: is cast along the crossing's own direction, and at a corner that direction meets the
//: curb return -- the kerb curving away from the road -- up to a metre and a half beyond
//: where the street's straight kerb, the one the carriageway is drawn to, stands. A span
//: ending there overshot the drawn roadway at 39% of crossings. Each end is walked back in
//: along the span until it stands on the drawn carriageway, no further than this; an end
//: that finds no roadway within it is left where the city's kerb line put it.
const CROSSING_END_WALK_BACK_M = 1.5;
const CROSSING_END_STEP_M = 0.05;

function endCrossingOnDrawnKerb(span) {
  if (!span || span.length < 2 || !carriagewayGrid.size) return span;
  const [ax, ay] = xy(span[0][0], span[0][1]);
  const [bx, by] = xy(span[span.length - 1][0], span[span.length - 1][1]);
  const az = -ay, bz = -by;
  const length = Math.hypot(bx - ax, bz - az);
  if (!(length > 2.0)) return span;
  const ux = (bx - ax) / length, uz = (bz - az) / length;
  const walkIn = (x, z, dx, dz) => {
    if (insideCarriageway(x + dx * CROSSING_END_STEP_M, z + dz * CROSSING_END_STEP_M, 0.0)) return 0;
    for (let t = CROSSING_END_STEP_M; t <= CROSSING_END_WALK_BACK_M; t += CROSSING_END_STEP_M) {
      if (insideCarriageway(x + dx * t, z + dz * t, 0.0)) return t - CROSSING_END_STEP_M;
    }
    return 0;
  };
  const ta = walkIn(ax, az, ux, uz);
  const tb = walkIn(bx, bz, -ux, -uz);
  if (ta === 0 && tb === 0) return snapCrossingEndsToOsmRamps(span);
  const out = [lonLatFromXZ(ax + ux * ta, az + uz * ta), lonLatFromXZ(bx - ux * tb, bz - uz * tb)];
  out.provenance = span.provenance;
  out.walkedBackM = [+ta.toFixed(2), +tb.toFixed(2)];
  return snapCrossingEndsToOsmRamps(out);
}

function snapCrossingEndsToOsmRamps(span) {
  if (!span || span.length < 2 || !osmRampNodes.length) return span;
  const output = span.map((p) => [...p]);
  let snapped = false;
  for (const i of [0, output.length - 1]) {
    const [x, y] = xy(output[i][0], output[i][1]);
    const ramp = nearestOsmRamp(x, -y, 1.25);
    if (!ramp || !ramp.accessible) continue;
    const j = i === 0 ? output.length - 1 : 0;
    const [ox, oy] = xy(output[j][0], output[j][1]);
    const vx = ox - x, vz = -oy + y;
    const length = Math.hypot(vx, vz);
    if (length < 2 || Math.abs((ramp.x - x) * vz - (ramp.z + y) * vx) / length > 0.75) continue;
    output[i] = lonLatFromXZ(ramp.x, ramp.z);
    snapped = true;
  }
  if (!snapped) return span;
  output.provenance = `${span.provenance || "osm_crossing"}+osm_kerb_node`;
  return output;
}

function crossingRectanglePoints(points) {
  const clipped = crossingRoadSpanPoints(points);
  if (clipped) return clipped;
  return [];
}

function sidewalkCrossingReplacementSpans(points, width) {
  if (!points || points.length < 2) return [];
  const samples = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const [ax, ay] = xy(a[0], a[1]);
    const [bx, by] = xy(b[0], b[1]);
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length / 1.0));
    for (let k = i === 1 ? 0 : 1; k <= steps; k += 1) {
      const point = lerpLonLat(a, b, k / steps);
      const [x, y] = xy(point[0], point[1]);
      // (A street's carriageway: across a driveway the pavement carries on -- see
      // insideStreetCarriageway.)
      samples.push({ point, x, z: -y, onRoad: insideStreetCarriageway(x, -y, 0.0) });
    }
  }
  const spans = [];
  let start = -1;
  const finish = (end) => {
    if (start < 0) return;
    const before = samples[start - 1];
    const after = samples[end + 1];
    if (before && after) {
      const clipped = crossingRoadSpanPoints([before.point, after.point]);
      if (clipped) spans.push(clipped);
    }
    start = -1;
  };
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].onRoad) {
      if (start < 0) start = i;
    } else {
      finish(i - 1);
    }
  }
  finish(samples.length - 1);
  return spans;
}

const CROSSING_DEDUPE_CELL_M = 4.0;
const CROSSING_DEDUPE_ANGLE_DEG = 12.0;
const crossingDrawGrid = new Map();
const crossingTrimStats = { trimmed: 0, dropped: 0 };
if (typeof window !== "undefined") window.kerbsideCrossingTrims = crossingTrimStats;   // (for checks)

function crossingDrawPose(points) {
  if (!points || points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const [ax, ay] = xy(a[0], a[1]);
  const [bx, by] = xy(b[0], b[1]);
  const az = -ay;
  const bz = -by;
  const length = Math.hypot(bx - ax, bz - az);
  if (!(length > 1.0)) return null;
  return {
    x: (ax + bx) / 2,
    z: (az + bz) / 2,
    bearing: Math.atan2(bz - az, bx - ax),
    length,
  };
}

function crossingBearingDifference(a, b) {
  let diff = Math.abs(a - b) % Math.PI;
  if (diff > Math.PI / 2) diff = Math.PI - diff;
  return diff;
}

function crossingDrawConflict(pose, width) {
  // The crossing already drawn that this one would double, or null. A query only: nothing is
  // registered, so the audit can ask the same question the draw loop asks.
  const cx = Math.floor(pose.x / CROSSING_DEDUPE_CELL_M);
  const cz = Math.floor(pose.z / CROSSING_DEDUPE_CELL_M);
  const angleLimit = (CROSSING_DEDUPE_ANGLE_DEG * Math.PI) / 180;
  const distanceLimit = Math.max(1.4, Math.min(3.4, (width || 3.7) * 0.75));
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = crossingDrawGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const other of bucket) {
        if (Math.hypot(other.x - pose.x, other.z - pose.z) > distanceLimit) continue;
        if (crossingBearingDifference(other.bearing, pose.bearing) > angleLimit) continue;
        return other;
      }
    }
  }
  return null;
}

//: A crossing's painted rectangle on the ground (page x, z), counter-clockwise: ``length`` along its
//: bearing, ``width`` across.
function crossingPaintRect(pose, width) {
  const ux = Math.cos(pose.bearing), uz = Math.sin(pose.bearing), vx = -uz, vz = ux;
  const L = pose.length / 2, W = (width || 3.7) / 2;
  const r = [[pose.x + ux * L + vx * W, pose.z + uz * L + vz * W], [pose.x - ux * L + vx * W, pose.z - uz * L + vz * W],
    [pose.x - ux * L - vx * W, pose.z - uz * L - vz * W], [pose.x + ux * L - vx * W, pose.z + uz * L - vz * W]];
  return crossingRingArea(r) < 0 ? r.reverse() : r;
}
function crossingRingArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i += 1) { const a = ring[i], b = ring[(i + 1) % ring.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
//: The area two counter-clockwise convex rings share (m2).
function crossingOverlapArea(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i += 1) {
    const A = clip[i], B = clip[(i + 1) % clip.length];
    const inside = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]) >= 0;
    const cut = (p, q) => {
      const a1 = B[1] - A[1], b1 = A[0] - B[0], c1 = a1 * A[0] + b1 * A[1];
      const a2 = q[1] - p[1], b2 = p[0] - q[0], c2 = a2 * p[0] + b2 * p[1], d = a1 * b2 - a2 * b1;
      return Math.abs(d) < 1e-12 ? q : [(b2 * c1 - b1 * c2) / d, (a1 * c2 - a2 * c1) / d];
    };
    const was = out; out = [];
    for (let j = 0; j < was.length; j += 1) {
      const P = was[j], Q = was[(j + 1) % was.length];
      if (inside(Q)) { if (!inside(P)) out.push(cut(P, Q)); out.push(Q); } else if (inside(P)) out.push(cut(P, Q));
    }
  }
  return out.length >= 3 ? Math.abs(crossingRingArea(out)) : 0;
}
//: Crossings already drawn whose paint this one's would lie over (2026-11-25: a crossing laid over
//: another at a corner, or two mapped across one another at a skewed junction, drew their stripes
//: through each other). Returns the drawn ones it overlaps by more than ``slack`` m2.
const CROSSING_OVERLAP_SLACK_M2 = 0.15;
//: A crossing shortened clear of another is not drawn shorter than this (m).
const CROSSING_MIN_AFTER_TRIM_M = 3.0;
function crossingOverlaps(pose, width) {
  const mine = crossingPaintRect(pose, width), hits = [];
  const reach = Math.ceil((pose.length / 2 + 6) / CROSSING_DEDUPE_CELL_M);
  const cx = Math.floor(pose.x / CROSSING_DEDUPE_CELL_M), cz = Math.floor(pose.z / CROSSING_DEDUPE_CELL_M);
  for (let dx = -reach; dx <= reach; dx += 1) for (let dz = -reach; dz <= reach; dz += 1) {
    for (const other of crossingDrawGrid.get(`${cx + dx}:${cz + dz}`) || []) {
      if (Math.hypot(other.x - pose.x, other.z - pose.z) > (pose.length + other.length) / 2 + 4) continue;
      if (crossingOverlapArea(mine, crossingPaintRect(other, other.width)) > CROSSING_OVERLAP_SLACK_M2) hits.push(other);
    }
  }
  return hits;
}
//: Shortens ``points`` (lon/lat, changed in place) from whichever end lies in a drawn crossing's
//: paint until it no longer overlaps one; false when that would leave it too short to draw.
//: The most of another crossing's paint an island-landing end may share at the island's nose (m²).
const CROSSING_ISLAND_CORNER_M2 = 3.0;
function trimCrossingClear(points, width) {
  let pose = crossingDrawPose(points);
  if (!pose) return false;
  for (let round = 0; round < 6; round += 1) {
    const hits = crossingOverlaps(pose, width);
    if (!hits.length) return true;
    // The end nearer what it overlaps is the one in it.
    const other = hits[0], ux = Math.cos(pose.bearing), uz = Math.sin(pose.bearing);
    const fromStart = (other.x - pose.x) * ux + (other.z - pose.z) * uz < 0;
    const end = fromStart ? 0 : points.length - 1, toward = fromStart ? points.length - 1 : 0;
    // An end carried on to an island's kerb (crossingReachesIslands) stays on the island: where
    // it only clips the corner of the crossing on the island's other side -- the two land on the
    // island's nose side by side -- it is not cut back off the island into the road (Fillmore &
    // Chestnut's slip lane, 2026-11-26: cut back 1.7 m, it stopped in the lane).
    if (points.onIsland?.[fromStart ? 0 : 1]
        && crossingOverlapArea(crossingPaintRect(pose, width), crossingPaintRect(other, other.width)) <= CROSSING_ISLAND_CORNER_M2) {
      crossingTrimStats.islandKept = (crossingTrimStats.islandKept || 0) + 1;
      return true;
    }
    let cut = 0;
    const whole = pose.length, keep = points[end].slice();
    for (let t = 0.25; whole - t >= CROSSING_MIN_AFTER_TRIM_M; t += 0.25) {
      points[end] = lerpLonLat(keep, points[toward], t / whole);
      const trial = crossingDrawPose(points);
      if (trial && crossingOverlapArea(crossingPaintRect(trial, width), crossingPaintRect(other, other.width)) <= CROSSING_OVERLAP_SLACK_M2) { cut = t; break; }
    }
    if (!cut) { points[end] = keep; return false; }
    pose = crossingDrawPose(points);
    if (!pose) return false;
  }
  return crossingOverlaps(pose, width).length === 0;
}

function shouldDrawCrossing(points, width, tag = null) {
  let pose = crossingDrawPose(points);
  if (!pose) return false;
  if (crossingDrawConflict(pose, width)) return false;
  // Over another crossing's paint: stopped short of it, or not drawn at all.
  if (crossingOverlaps(pose, width).length) {
    if (!trimCrossingClear(points, width)) { crossingTrimStats.dropped += 1; return false; }
    crossingTrimStats.trimmed += 1;
    pose = crossingDrawPose(points);
  }
  if (tag) pose.tag = tag;
  // Its width too: a sign post is kept off the paint (onCrossingGround).
  pose.width = width || 3.7;
  const key = `${Math.floor(pose.x / CROSSING_DEDUPE_CELL_M)}:${Math.floor(pose.z / CROSSING_DEDUPE_CELL_M)}`;
  let bucket = crossingDrawGrid.get(key);
  if (!bucket) crossingDrawGrid.set(key, bucket = []);
  bucket.push(pose);
  return true;
}

//: A sidewalk that OpenStreetMap draws straight through a junction gets a plain two-line
//: crossing where it crosses the road -- unless the junction already has a mapped crossing
//: there. Sidewalks are laid before crossings, so the stand-in used to claim the spot first and
//: the city's continental crossing was then thrown out as its duplicate (Grant and Clay: two
//: ladders from the inventory drawn, two replaced by lines 2 m inside the box). The mapped
//: crossings are indexed before anything is drawn and a stand-in within this distance of one,
//: running the same way, is not laid at all.
const MAPPED_CROSSING_YIELD_M = 6.0;
const MAPPED_CROSSING_YIELD_DEG = 30.0;
const mappedCrossingGrid = new Map();

function indexMappedCrossing(points, width = 3.7) {
  const pose = crossingDrawPose(points);
  if (!pose) return;
  pose.width = width;
  const key = `${Math.floor(pose.x / CROSSING_DEDUPE_CELL_M)}:${Math.floor(pose.z / CROSSING_DEDUPE_CELL_M)}`;
  let bucket = mappedCrossingGrid.get(key);
  if (!bucket) mappedCrossingGrid.set(key, bucket = []);
  bucket.push(pose);
  // Every cell its paint (and the clear margin round it) covers, for onMappedCrossing and
  // crossingClearAt (a divider's nose is cut back past its end: CROSSING_COVER_*).
  const ux = Math.cos(pose.bearing), uz = Math.sin(pose.bearing), L = pose.length / 2 + CROSSING_COVER_ALONG_M, W = width / 2 + CROSSING_COVER_ACROSS_M;
  const xs = [L * ux + W * uz, L * ux - W * uz, -L * ux + W * uz, -L * ux - W * uz];
  const zs = [L * uz - W * ux, L * uz + W * ux, -L * uz - W * ux, -L * uz + W * ux];
  const c = CROSSING_DEDUPE_CELL_M;
  for (let gx = Math.floor((pose.x + Math.min(...xs)) / c); gx <= Math.floor((pose.x + Math.max(...xs)) / c); gx += 1) {
    for (let gz = Math.floor((pose.z + Math.min(...zs)) / c); gz <= Math.floor((pose.z + Math.max(...zs)) / c); gz += 1) {
      const k = `${gx}:${gz}`;
      let list = mappedCrossingCover.get(k);
      if (!list) mappedCrossingCover.set(k, list = []);
      list.push(pose);
    }
  }
}

//: Road lines stop this far (m) either side of a mapped crosswalk's paint. The junction test
//: (markingRunsClearOfJunctions) only sees crosswalks inside a junction: the double yellow ran
//: straight through mid-block crosswalks and those at T-junctions and skewed corners, and lane
//: lines and the bike lane's edges through others (2026-11-25: 159 places in the Marina).
const CROSSING_LINE_CLEAR_M = 0.6;
//: How far past a crossing's paint its cells are indexed (m): its length either end (``along``,
//: the walking way: a divider's middle lies past the end of each carriageway's crossing) and
//: either side of its band (``across``: the nose cut back short of it, DIVIDER_NOSE_CLEAR_M).
const CROSSING_COVER_ALONG_M = 2.5, CROSSING_COVER_ACROSS_M = 2.2;
const mappedCrossingCover = new Map();
function onMappedCrossing(x, z, margin = CROSSING_LINE_CLEAR_M) {
  return crossingClearAt(x, z, 0.3, margin) !== null;
}
//: Whether (x, z) is within ``along`` of a mapped crossing's ends (the way across the road) and
//: ``across`` of its band's sides; the crossing (its pose) or null.
function crossingClearAt(x, z, along, across) {
  const list = mappedCrossingCover.get(`${Math.floor(x / CROSSING_DEDUPE_CELL_M)}:${Math.floor(z / CROSSING_DEDUPE_CELL_M)}`);
  if (!list) return null;
  for (const p of list) {
    const dx = x - p.x, dz = z - p.z, cb = Math.cos(p.bearing), sb = Math.sin(p.bearing);
    if (Math.abs(dx * cb + dz * sb) <= p.length / 2 + along && Math.abs(-dx * sb + dz * cb) <= (p.width || 3.7) / 2 + across) return p;
  }
  return null;
}
//: ``points`` (lon/lat) in the pieces that stay off mapped crosswalks.
function splitAtMappedCrossings(points, step = 1.0) {
  const dense = densifyWay(points, step), runs = [];
  let run = [];
  for (const p of dense) {
    const [x, y] = xy(p[0], p[1]);
    if (onMappedCrossing(x, -y)) { if (run.length >= 2) runs.push(run); run = []; } else run.push(p);
  }
  if (run.length >= 2) runs.push(run);
  return runs.filter((r) => wayLength(r) > 1.0);
}

function nearMappedCrossing(points) {
  const pose = crossingDrawPose(points);
  if (!pose) return false;
  const cx = Math.floor(pose.x / CROSSING_DEDUPE_CELL_M);
  const cz = Math.floor(pose.z / CROSSING_DEDUPE_CELL_M);
  const cells = Math.ceil(MAPPED_CROSSING_YIELD_M / CROSSING_DEDUPE_CELL_M);
  const angleLimit = (MAPPED_CROSSING_YIELD_DEG * Math.PI) / 180;
  for (let dx = -cells; dx <= cells; dx += 1) {
    for (let dz = -cells; dz <= cells; dz += 1) {
      const bucket = mappedCrossingGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const other of bucket) {
        if (Math.hypot(other.x - pose.x, other.z - pose.z) > MAPPED_CROSSING_YIELD_M) continue;
        if (crossingBearingDifference(other.bearing, pose.bearing) > angleLimit) continue;
        return true;
      }
    }
  }
  return false;
}

function arrowTexture(kind) {
  // A lane arrow, drawn once per kind. Painted arrows in California are long and narrow -- the
  // standard is about 2.3 m of arrow in a lane 3 m wide -- so the canvas is tall rather than
  // square and the plane it lands on keeps that ratio.
  const w = 64;
  const h = 160;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(242, 243, 238, 0.95)";
  ctx.strokeStyle = "rgba(242, 243, 238, 0.95)";
  ctx.lineWidth = 9;
  ctx.lineCap = "butt";
  const stemTop = kind === "through" ? 34 : 62;
  ctx.beginPath(); ctx.moveTo(w / 2, h - 12); ctx.lineTo(w / 2, stemTop); ctx.stroke();
  const head = (x, y, dir) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 17 * dir, y + 20);
    ctx.lineTo(x + 17 * dir, y + 20);
    ctx.closePath();
    ctx.fill();
  };
  if (kind === "through" || kind === "through_left" || kind === "through_right") {
    head(w / 2, 14, 1);
  }
  if (kind === "left" || kind === "through_left") {
    ctx.beginPath(); ctx.moveTo(w / 2, 62); ctx.lineTo(14, 62); ctx.stroke();
    ctx.save(); ctx.translate(10, 62); ctx.rotate(-Math.PI / 2); head(0, 0, 1); ctx.restore();
  }
  if (kind === "right" || kind === "through_right") {
    ctx.beginPath(); ctx.moveTo(w / 2, 62); ctx.lineTo(w - 14, 62); ctx.stroke();
    ctx.save(); ctx.translate(w - 10, 62); ctx.rotate(Math.PI / 2); head(0, 0, 1); ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Named for what it holds rather than "arrows": the keyboard handler further down already owns
// that word, and two `const ARROWS` in one script is a syntax error that takes the whole page.
const LANE_ARROW_TEXTURES = {};
function arrowFor(kind) {
  if (!LANE_ARROW_TEXTURES[kind]) LANE_ARROW_TEXTURES[kind] = arrowTexture(kind);
  return LANE_ARROW_TEXTURES[kind];
}

//: Where each lane arrow was painted (its rectangle of asphalt), for the paint plan: words laid
//: later keep off them (docs/street-paint.mjs).
const paintedArrows = [];

//: What a turn:lanes token means, reduced to the arrows this draws.
function arrowKind(token) {
  const parts = String(token || "").split(";").filter(Boolean);
  const has = (n) => parts.some((p) => p.includes(n));
  const straight = has("through") || parts.length === 0 || parts.includes("");
  if (has("left") && straight) return "through_left";
  if (has("right") && straight) return "through_right";
  if (has("left")) return "left";
  if (has("right")) return "right";
  if (straight) return "through";
  return null;
}

//: Where each lane's centre sits, as an offset from the street's own centreline.
//: The parked cars' lane along a kerb, where the city's parking policies say one is: SFMTA's
//: standard parallel parking lane, 8 ft (2026-11-26; it was 2.4 m).
const PARKING_LANE_M = 2.44;

// ---- the cross-sections -----------------------------------------------------------------
//
// A street arrives with `xs`: a station every four metres, each carrying the two kerbs the
// city's curb-line profile put there, and the bands between them -- parking from the city's
// policies, bike lanes from the map, travel lanes chosen from hypotheses against width priors
// -- as smc.facts.cross_section built them. Everything laid across the road here reads those
// bands rather than dividing a width by a count: the lane lines, the double yellow, the arrows
// and the bike lane. A station the solver could not close is `unresolved` and gets no paint.
//
// The page draws the roadway between the kerbs it measured itself (the kerb envelope), which
// can differ by a few centimetres from the profile the facts were built on, and by more where
// the facts fell back to the recorded width. So the bands are closed to the page's own width
// at each station: the fixed bands keep their widths and the travel lanes take the difference,
// within the same priors; where that is impossible the station is not painted.
const CROSS_SECTION_KIND = { p: "parking", b: "bike", f: "buffer", x: "transit", t: "travel",
                             n: "turn", m: "median", h: "shoulder", l: "loading", u: "unresolved" };
const CROSS_SECTION_LANE_MIN_M = 2.55;
const CROSS_SECTION_LANE_MAX_M = 5.2;

function crossSectionRowAt(way, along, half = null) {
  const rows = way && way.xs;
  if (!rows || !rows.length) return null;
  if (half !== null && typeof KERB_RENDER_UNIFORM !== "undefined" && KERB_RENDER_UNIFORM) {
    // A junction ray can hit the opposite street's curb (Presidio: 43.8 m,
    // eight inferred lanes on a tagged four-lane way). It is not evidence for
    // widening paint past a uniform curb. Choose one credible topology for
    // this uniform way; keep every original xs row unmodified for review.
    const count = laneCountForWay(way);
    const cached = way._uniformCrossSection;
    if (cached && cached.rows === rows && cached.half === half && cached.count === count) return cached.row;
    const middle = rows[Math.floor(rows.length / 2)][0];
    let best = null;
    for (const row of rows) {
      if (row[4] !== "r" || !Array.isArray(row[5])) continue;
      const travel = row[5].filter((b) => b[0] === "t" || b[0] === "n");
      if (!travel.length || (count && travel.length !== count)) continue;
      if (row[5].some((b) => b[0] === "u")) continue;
      const fixed = row[5].filter((b) => b[0] !== "t" && b[0] !== "n")
        .reduce((s, b) => s + b[1], 0);
      const lane = (half * 2 - fixed) / travel.length;
      if (lane < CROSS_SECTION_LANE_MIN_M || lane > CROSS_SECTION_LANE_MAX_M) continue;
      if (Math.abs(row[1] - row[2] - half * 2) > Math.max(1.5, half * 0.4)) continue;
      if (!best || Math.abs(row[0] - middle) < Math.abs(best[0] - middle)) best = row;
    }
    way._uniformCrossSection = { rows, half, count, row: best };
    return best;
  }
  let best = rows[0];
  for (const row of rows) if (Math.abs(row[0] - along) < Math.abs(best[0] - along)) best = row;
  return best;
}

//: The bands at a station closed to the page's drawn width: [{kind, dir, left, right}] from
//: the left kerb (+half) inward, or null where the station is unresolved or cannot close.
// ---- the parking census: each block's parked sides -------------------------------------------
//
// OpenStreetMap tags the parking on fewer than half the streets, and the meters only stand on the
// metered blocks. SFMTA's On-Street Parking Census (DataSF 9ivs-nf5y; tools/build_parking_census.py)
// counts the spaces on every block; the build says from the count and the kerb free of driveways
// which sides are parked. Each census block is laid on the street way it runs along (same name,
// parallel, its middle within reach), as a range of the way's length with the sides as the way
// runs. A block the census parks has a parking lane at those kerbs; the travel lanes are what is
// left (fitLaneBands). The census adds parking only: a block it counts none on keeps what the map
// and the meters say, since the census's zero is often a block it did not survey.
const PARKING_CENSUS = { reach_m: 12, parallel_cos: 0.94, end_trim_m: 2 };
let parkingCensusRecord = null;
function parkingCensusOnce() {
  if (parkingCensusRecord) return parkingCensusRecord;
  const url = typeof asset === "function" ? asset("sf-corridor-parking-census.json") : "sf-corridor-parking-census.json";
  return parkingCensusRecord = fetch(url, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}
function censusStreetKey(name) {
  return String(name || "").toUpperCase().replace(/\b(STREET|ST|AVENUE|AVE|BOULEVARD|BLVD|WAY|PLACE|PL|TERRACE|TER|COURT|CT|DRIVE|DR|ROAD|RD|LANE|LN|ALLEY|AL)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}
//: The census's blocks on the ways: way._parkingBlocks = [{from, to, sides, sure, cnn}], from and
//: to in metres along the way, sides +1 left of the way as it runs and -1 right.
function applyParkingCensus(streets, census) {
  if (census?.schema !== "kerbside.parking_census/1" || !Array.isArray(census.segments)) return 0;
  const byName = new Map();
  for (const way of streets) {
    const key = censusStreetKey(way.name);
    if (!key) continue;
    const pts = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    const cum = [0];
    for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let list = byName.get(key);
    if (!list) byName.set(key, list = []);
    list.push({ way, pts, cum });
  }
  // Where a point projects on to a way: [distance, metres along, direction of the segment, x, z].
  const project = (entry, x, z) => {
    let best = null;
    for (let i = 1; i < entry.pts.length; i += 1) {
      const [ax, az] = entry.pts[i - 1], [bx, bz] = entry.pts[i], ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
      if (!(L2 > 0)) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / L2));
      const d = Math.hypot(x - ax - ux * t, z - az - uz * t);
      if (!best || d < best[0]) best = [d, entry.cum[i - 1] + Math.sqrt(L2) * t, ux / Math.sqrt(L2), uz / Math.sqrt(L2), ax + ux * t, az + uz * t];
    }
    return best;
  };
  let matched = 0;
  for (const seg of census.segments) {
    parkingLaneStats.census_blocks += 1;
    const list = byName.get(censusStreetKey(seg.street));
    if (!list || !Array.isArray(seg.p) || seg.p.length < 2) continue;
    const pts = seg.p.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    const a = pts[0], b = pts[pts.length - 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(len > 4)) continue;
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // A divided street's halves are both named; each half takes the census's sides on its own
    // side of the block's line (its kerb), so both are matched, not only the nearest.
    for (const entry of list) {
      const m = project(entry, mid[0], mid[1]);
      if (!m || m[0] > PARKING_CENSUS.reach_m) continue;
      const cos = m[2] * dx + m[3] * dz;
      if (Math.abs(cos) < PARKING_CENSUS.parallel_cos) continue;
      const pa = project(entry, a[0], a[1]), pb = project(entry, b[0], b[1]);
      let from = Math.min(pa[1], pb[1]) + PARKING_CENSUS.end_trim_m, to = Math.max(pa[1], pb[1]) - PARKING_CENSUS.end_trim_m;
      if (!(to - from > 4)) continue;
      // The census's sides are as its line runs; flip them where the way runs the other way.
      let sides = (seg.sides || []).map((s) => (cos > 0 ? s : -s));
      // A half of a divided street, the census's line down the middle of the two: the half has
      // the census's kerb on its own side of that line, at its outer kerb (the side of the way
      // away from the line); its median side is not the census's.
      const oneway = typeof onewaySign === "function" ? onewaySign(entry.way) !== 0 : Boolean(entry.way.oneway);
      if (oneway && m[0] > 3.5) {
        const q = [m[4], m[5]], vx = q[0] - mid[0], vz = q[1] - mid[1];
        const censusSide = dx * vz - dz * vx < 0 ? 1 : -1;      // the side of the census line the half is on
        const outer = m[2] * vz - m[3] * vx < 0 ? 1 : -1;       // the way's side facing away from the line
        sides = (seg.sides || []).includes(censusSide) ? [outer] : [];
      }
      (entry.way._parkingBlocks ||= []).push({ from, to, sides, sure: seg.sure, cnn: seg.cnn });
      parkingLaneStats.census_block_sides += sides.length;
      matched += 1;
    }
  }
  parkingLaneStats.census_matched = matched;
  for (const list of byName.values()) for (const { way, cum } of list) {
    if (!way._parkingBlocks) continue;
    way._parkingBlocks.sort((p, q) => p.from - q.from);
    way._parkingLength = cum[cum.length - 1];
  }
  return matched;
}
//: The sides the census parks over at least half the way's length.
function censusMajoritySides(way) {
  const blocks = way && way._parkingBlocks, total = way && way._parkingLength;
  if (!blocks || !(total > 0)) return [];
  const out = [];
  const own = Array.isArray(way.parking_sides) ? way.parking_sides : [];
  for (const side of [1, -1]) {
    const covered = blocks.reduce((sum, b) => sum + (b.sides.includes(side) && (b.sides.length > 1 || !own.length) ? b.to - b.from : 0), 0);
    if (covered >= total / 2) out.push(side);
  }
  return out;
}
//: The parked sides at a point along a way: the way's own (map tags and the meters), and the
//: census block's there. Without an along, or off every block, the way's own.
function parkingSidesAt(way, along = null) {
  const blocks = way && way._parkingBlocks;
  if (along === null || !Array.isArray(blocks)) return Array.isArray(way && way.parking_sides) ? way.parking_sides : [];
  const own = Array.isArray(way._parkingOwn) ? way._parkingOwn : (Array.isArray(way.parking_sides) ? way.parking_sides : []);
  const block = blocks.find((b) => along >= b.from && along <= b.to);
  if (!block || !block.sides.length) return own;
  // The census does not say which side a one-sided block is parked on (the build guesses it
  // from the driveways): where the map or the meters already park a side, that is the one.
  if (block.sides.length === 1 && own.length) return own;
  const out = new Set(own);
  for (const s of block.sides) out.add(s);
  return out.size === own.length ? own : [...out].sort((p, q) => q - p);
}

// ---- the parking the city says is there, and the lanes that fit beside it ----------------------
//
// A street's lanes were shared out over whatever the map's tags left of its width: where the tags
// have no parking on a side that the city meters (the map's parking tags cover fewer than half
// the streets), the lanes were painted to the kerb, across the parked cars; and where the tagged
// count of lanes cannot fit beside the parking, they were painted anyway, each narrower than a car
// with its mirrors (Chestnut Street by Fillmore: four lanes of 2.6 m between two rows of meters,
// on a street of one lane each way -- the owner, 2026-11-24).
//
// The city's own record settles both (settleParkingLanes, once, before any paint): a side with
// its parking meters along it has a parking lane, PARKING_STALL_M wide; and the lanes are those
// that fit in what is left at LANE_FIT_MIN_M or more -- a two-way street loses them a pair at a
// time, one each way, so it is not left with two lanes one way and one the other.
const PARKING_STALL_M = 2.44;
const LANE_FIT_MIN_M = 2.9;
//: A side has a parking lane when it has this many of the city's meters, and one at least to
//: every so many metres of the street; a meter belongs to the street it stands within reach of.
const PARKING_METERS = { least: 2, every_m: 45, reach_m: 14, cell_m: 30 };
const parkingLaneStats = { meters: 0, placed: 0, sides_known: 0, sides_added: 0, ways_refitted: 0, ready: false,
                           census_blocks: 0, census_matched: 0, census_block_sides: 0, census_sides_added: 0 };
async function settleParkingLanes() {
  if (parkingLaneStats.ready || typeof streetFurnitureOnce !== "function") return parkingLaneStats;
  parkingLaneStats.ready = true;
  const record = await streetFurnitureOnce().catch(() => null);
  const meters = (record?.geometry_based?.parking_meters || []).filter((m) => m && Array.isArray(m.p));
  parkingLaneStats.meters = meters.length;
  const streets = (DATA.ways || []).filter((w) => w.kind === "street" && Array.isArray(w.points) && w.points.length >= 2 && w.tunnel_kind !== "underground");
  // The streets' segments by cell, for the meter that stands beside one.
  const C = PARKING_METERS.cell_m, grid = new Map();
  for (const way of streets) {
    const pts = way.points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
    way._parkLen = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      way._parkLen += len;
      const seg = [a[0], a[1], b[0], b[1], way];
      for (let k = 0, n = Math.max(1, Math.ceil(len / (C / 2))); k <= n; k += 1) {
        const key = Math.floor((a[0] + (b[0] - a[0]) * k / n) / C) + ":" + Math.floor((a[1] + (b[1] - a[1]) * k / n) / C);
        let list = grid.get(key);
        if (!list) grid.set(key, list = []);
        if (list[list.length - 1] !== seg) list.push(seg);
      }
    }
  }
  const counts = new Map();   // way -> [meters on its left, on its right]
  for (const meter of meters) {
    const [mx, my] = xy(meter.p[0], meter.p[1]), mz = -my;
    let best = null;
    for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1)
      for (const seg of grid.get((Math.floor(mx / C) + di) + ":" + (Math.floor(mz / C) + dj)) || []) {
        const [ax, az, bx, bz, way] = seg, ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz;
        if (!(L2 > 0)) continue;
        const t = ((mx - ax) * ux + (mz - az) * uz) / L2;
        if (t < -0.02 || t > 1.02) continue;   // beside the street, not beyond its end (round a corner it is the cross street's)
        const px = ax + ux * t, pz = az + uz * t, d = Math.hypot(mx - px, mz - pz);
        if (d > PARKING_METERS.reach_m || (best && d >= best.d)) continue;
        // (Left of the way it runs: +1, as parking_sides counts them.)
        best = { d, way, side: ux * (mz - az) - uz * (mx - ax) < 0 ? 1 : -1 };
      }
    if (!best) continue;
    parkingLaneStats.placed += 1;
    let c = counts.get(best.way);
    if (!c) counts.set(best.way, c = [0, 0]);
    c[best.side > 0 ? 0 : 1] += 1;
  }
  // The census's blocks (SFMTA's On-Street Parking Census, docs/75): which sides of each block
  // are parked, laid on the ways they run along.
  try { applyParkingCensus(streets, await parkingCensusOnce()); } catch (error) { console.warn("kerbside: the parking census was not applied", error); }
  for (const way of streets) {
    const tagged = Array.isArray(way.parking_sides) ? way.parking_sides : [];
    const known = new Set(tagged), c = counts.get(way) || [0, 0];
    for (const [side, n] of [[1, c[0]], [-1, c[1]]]) {
      if (known.has(side) || n < PARKING_METERS.least || n < way._parkLen / PARKING_METERS.every_m) continue;
      known.add(side); parkingLaneStats.sides_added += 1;
      (way.parking_basis ||= {})[side] = `sfmta_parking_meters:${n}`;
    }
    // The map's and the meters' sides hold the whole way; the census's hold block by block
    // (parkingSidesAt). A side the census parks over most of the way is the way's too, for the
    // city's traffic, which reads one set of sides a way.
    if (way._parkingBlocks) {
      way._parkingOwn = [...known].sort((p, q) => q - p);
      const own = way.parking_sides;
      way.parking_sides = way._parkingOwn;
      for (const side of censusMajoritySides(way)) if (!known.has(side)) {
        known.add(side); parkingLaneStats.census_sides_added += 1;
        (way.parking_basis ||= {})[side] = "sfmta_parking_census";
      }
      way.parking_sides = own;
    }
    delete way._parkLen;
    parkingLaneStats.sides_known += known.size;
    if (known.size !== tagged.length) { way.parking_sides_tagged = tagged.slice(); way.parking_sides = [...known].sort((p, q) => q - p); }
    // The lanes that fit beside it, for the city's traffic (the paint fits its own: fitLaneBands).
    const tags = Number(way.lanes) || 0;
    if (tags > 1 && way._spans === undefined && typeof renderedRoadWidth === "function") {
      const room = renderedRoadWidth(way) - known.size * PARKING_STALL_M, oneway = typeof onewaySign === "function" && onewaySign(way) !== 0;
      let fit = tags;
      while (fit > (oneway ? 1 : 2) && room / fit < LANE_FIT_MIN_M) fit -= oneway ? 1 : 2;
      if (fit !== tags) { way.lanes_fit = Math.max(1, fit); parkingLaneStats.ways_refitted += 1; }
    }
    // And block by block, for the city's traffic (2026-11-27): the sides parked on each census
    // block and the lanes that fit beside them, as the paint lays them (fitLaneBands reads the
    // same blocks) -- so a car's lane is the painted one, and a lane that ends where the parking
    // begins ends for the traffic too (fleet.mjs laneDropAhead: they merge before it).
    if (tags > 0 && way._parkingBlocks && way._spans === undefined && typeof renderedRoadWidth === "function") {
      const width = renderedRoadWidth(way), oneway = typeof onewaySign === "function" && onewaySign(way) !== 0;
      way._laneBlocks = way._parkingBlocks.map((b) => {
        const sides = parkingSidesAt(way, (b.from + b.to) / 2), room = width - sides.length * PARKING_STALL_M;
        let fit = tags;
        while (fit > (oneway ? 1 : 2) && room / fit < LANE_FIT_MIN_M) fit -= oneway ? 1 : 2;
        return { from: b.from, to: b.to, sides: sides.slice(), lanes: Math.max(1, fit) };
      });
    }
  }
  window.kerbsideParkingLanes = () => ({ ...parkingLaneStats });
  window.kerbsideParkingBlocks = (name) => (DATA.ways || []).filter((w) => w._parkingBlocks && (!name || censusStreetKey(w.name) === censusStreetKey(name)))
    .map((w) => ({ id: w.osm_id ?? w.id, name: w.name, sides: w.parking_sides, lanes: w.lanes, lanes_fit: w.lanes_fit, blocks: w._parkingBlocks }));
  return parkingLaneStats;
}
//: A station's bands made to agree with the parking known at the kerbs and to fit the street:
//: a parking lane put in at a kerb the city meters where the bands have a lane of traffic
//: against it; then lanes of traffic taken out until those left are LANE_FIT_MIN_M wide or
//: there is one each way -- on a two-way street one from each direction at a time, the ones
//: nearest the kerbs. Changes ``bands`` in place; returns it.
function fitLaneBands(way, bands, half, along = null) {
  const moving = (b) => b.kind === "travel" || b.kind === "turn";
  const sides = typeof parkingSidesAt === "function" ? parkingSidesAt(way, along)
    : (Array.isArray(way && way.parking_sides) ? way.parking_sides : []);
  const stall = () => ({ kind: "parking", width: PARKING_STALL_M, dir: 0, sub: "parallel", fitted: true });
  if (sides.includes(1) && moving(bands[0])) bands.unshift(stall());
  if (sides.includes(-1) && moving(bands[bands.length - 1])) bands.push(stall());
  for (;;) {
    const travel = bands.filter(moving);
    const fixed = bands.reduce((sum, b) => sum + (moving(b) ? 0 : b.width), 0);
    if (travel.length < 2 || (2 * half - fixed) / travel.length >= LANE_FIT_MIN_M) break;
    const dirs = [...new Set(travel.map((b) => b.dir))].filter((d) => travel.filter((b) => b.dir === d && b.kind === "travel").length > 1);
    if (!dirs.length) break;
    // (The lane of each direction nearest its kerb: the first such band from the left for the
    // direction that keeps left of the centre line as the bands run, the last for the other.)
    for (const d of dirs) {
      const idx = bands.map((b, i) => (b.kind === "travel" && b.dir === d ? i : -1)).filter((i) => i >= 0);
      const mid = (bands.length - 1) / 2, outer = Math.abs(idx[0] - mid) >= Math.abs(idx[idx.length - 1] - mid) ? idx[0] : idx[idx.length - 1];
      bands.splice(outer, 1);
    }
  }
  return bands;
}
function crossSectionBands(way, along, half) {
  const row = crossSectionRowAt(way, along, half);
  if (!row || row[4] === "u") return null;
  const bands = row[5].map((b) => ({ kind: CROSS_SECTION_KIND[b[0]] || b[0], width: b[1], dir: b[4] || 0, sub: b[5] || "" }));
  if (bands.some((b) => b.kind === "unresolved")) return null;
  fitLaneBands(way, bands, half, along);
  const travel = bands.filter((b) => b.kind === "travel" || b.kind === "turn");
  if (!travel.length) return null;
  const fixed = bands.filter((b) => !(b.kind === "travel" || b.kind === "turn")).reduce((sum, b) => sum + b.width, 0);
  let lane = (2 * half - fixed) / travel.length;
  if (lane < CROSS_SECTION_LANE_MIN_M || lane > CROSS_SECTION_LANE_MAX_M) {
    if (typeof KERB_RENDER_UNIFORM !== "undefined" && KERB_RENDER_UNIFORM) return null;
    // The page's width for the way can be a recorded figure narrower than the street it draws
    // -- Telegraph's protected tracks are drawn at the section's own offsets, 18 m apart, on a
    // way whose recorded width is 9 m -- and closing to it left lanes under two metres, so the
    // whole block went unpainted. The section's own widths are the measurement; they are used
    // where the page's cannot close, and paint off the drawn roadway is still clipped there.
    // Only for a page width narrower than the section: a far wider one is a street the facts
    // do not describe, and is left unpainted.
    const own = bands.reduce((sum, b) => sum + b.width, 0) / 2;
    if (own <= half) return null;
    lane = (2 * own - fixed) / travel.length;
    if (lane < CROSS_SECTION_LANE_MIN_M || lane > CROSS_SECTION_LANE_MAX_M) return null;
    half = own;
  }
  let edge = half;
  const out = [];
  for (const b of bands) {
    const width = (b.kind === "travel" || b.kind === "turn") ? lane : b.width;
    out.push({ kind: b.kind, dir: b.dir, sub: b.sub, left: edge, right: edge - width });
    edge -= width;
  }
  return out;
}

//: The bands of the resolved station nearest the way's middle, for the things placed once
//: per way (the arrows, the bike lane's line, the transition profile).
function crossSectionBandsNearMiddle(way, half) {
  const rows = way && way.xs;
  if (!rows || !rows.length) return null;
  const mid = rows[Math.floor(rows.length / 2)][0];
  const order = rows.slice().sort((a, b) => Math.abs(a[0] - mid) - Math.abs(b[0] - mid));
  for (const row of order) {
    const bands = crossSectionBands(way, row[0], half);
    if (bands) return bands;
  }
  return null;
}

//: What is painted between two neighbouring bands.
function crossSectionMarkKind(a, b) {
  const travelish = (x) => x.kind === "travel" || x.kind === "turn";
  if (travelish(a) && travelish(b)) {
    if (a.sub === "shared" || b.sub === "shared") return null;
    // Opposing directions meet at the centre: the double yellow. A turn lane in the middle
    // has a yellow on each side of it.
    if (a.kind === "turn" || b.kind === "turn" || (a.dir && b.dir && a.dir !== b.dir)) return "centre";
    return "lane";
  }
  if (a.kind === "bike" || b.kind === "bike") return "edge";
  if (a.kind === "transit" || b.kind === "transit") return "edge";
  if (a.kind === "median" || b.kind === "median") return "edge";
  return null;                       // parking against traffic: no line, the T's come later
}

//: The paint for a way from its cross-sections: runs of boundary polylines, each with a kind.
//: `points` is the polyline to paint along and `cutStart` how far along the way it begins.
function crossSectionMarks(way, sparse, cutStart) {
  if (!way.xs || !sparse || sparse.length < 2) return null;
  // Sampled every few metres, not only at the way's own vertices -- which can be a block
  // apart, so a change of cross-section between two of them cost the whole segment its line.
  const points = densifyWay(sparse, 4.0);
  const alongs = alongDistances(points);
  const marks = [];
  // A line is one line for as long as a line of its kind carries on at about the same offset.
  // Closing every run whenever the cross-section changed anywhere -- a parking lane starting,
  // a bike lane's buffer ending -- broke the double yellow at each change, and the new run only
  // began at the next sample, which left a bare stretch of centreline mid-block.
  let open = [];                     // {kind, offset, points, st: the stations its points stand at}
  const CONTINUE_M = 1.2;
  // A centre line whose offset steps further than that between two stations -- the lanes either
  // side of it changing where a street narrows (Bay, 24 m to 12 m: it jumped six metres sideways)
  // -- is the same centre line shifted: it is led over on a taper laid back along the wider
  // stretch, ten along for one across (MUTCD's lane-shift taper L = W S^2 / 60 at 25 mph), not
  // ended and begun again over there. Further across than CENTRE_SHIFT_MAX_M it is another line.
  const CENTRE_SHIFT_MAX_M = 8.0, CENTRE_TAPER_PER_M = 10;
  for (let i = 0; i < points.length; i += 1) {
    const along = cutStart + alongs[i];
    const bands = crossSectionBands(way, along, halfWidthAt(way, along));
    const [x, y] = xy(points[i][0], points[i][1]);
    const [ax, ay] = xy(points[Math.max(0, i - 1)][0], points[Math.max(0, i - 1)][1]);
    const [bx, by] = xy(points[Math.min(points.length - 1, i + 1)][0], points[Math.min(points.length - 1, i + 1)][1]);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len, ny = (bx - ax) / len;   // left of travel
    const at = (offset) => lonLatFromXZ(x + nx * offset, -(y + ny * offset));
    const here = [];
    for (let k = 0; bands && k < bands.length - 1; k += 1) {
      const kind = crossSectionMarkKind(bands[k], bands[k + 1]);
      if (kind) here.push({ kind, offset: bands[k].right });
    }
    const next = [];
    for (const mark of here) {
      let j = open.findIndex((run) => run.kind === mark.kind
        && Math.abs(run.offset - mark.offset) <= CONTINUE_M);
      if (j < 0 && mark.kind === "centre") {
        j = open.findIndex((run) => run.kind === "centre" && run.st.length >= 2
          && Math.abs(run.offset - mark.offset) <= CENTRE_SHIFT_MAX_M
          && !here.some((m) => m !== mark && m.kind === "centre" && Math.abs(run.offset - m.offset) <= CONTINUE_M));
        if (j >= 0) {
          // The taper: the stations behind, as far back as it reaches, eased over toward it.
          const run = open[j], shift = mark.offset - run.offset;
          const L = Math.abs(shift) * CENTRE_TAPER_PER_M;
          let d = Math.hypot(x - run.st[run.st.length - 1][0], y - run.st[run.st.length - 1][1]);
          for (let k = run.st.length - 1; k >= 0 && d < L; k -= 1) {
            const s = run.st[k], u = 1 - d / L, o = s[4] + shift * u * u * (3 - 2 * u);
            run.points[k] = lonLatFromXZ(s[0] + s[2] * o, -(s[1] + s[3] * o));
            if (k > 0) d += Math.hypot(s[0] - run.st[k - 1][0], s[1] - run.st[k - 1][1]);
          }
        }
      }
      if (j >= 0) {
        const run = open.splice(j, 1)[0];
        run.offset = mark.offset;
        run.points.push(at(mark.offset)); run.st.push([x, y, nx, ny, mark.offset]);
        next.push(run);
      } else {
        // A line that begins where another ended starts from the sample before, at its own
        // offset, so the change of marking happens on the road rather than a gap apart.
        const run = { kind: mark.kind, offset: mark.offset, points: [], st: [] };
        if (i > 0 && open.length) {
          const [px, py] = xy(points[i - 1][0], points[i - 1][1]);
          run.points.push(lonLatFromXZ(px + nx * mark.offset, -(py + ny * mark.offset)));
          run.st.push([px, py, nx, ny, mark.offset]);
        }
        run.points.push(at(mark.offset)); run.st.push([x, y, nx, ny, mark.offset]);
        next.push(run);
      }
    }
    for (const run of open) if (run.points.length >= 2) marks.push(run);
    open = next;
  }
  for (const run of open) if (run.points.length >= 2) marks.push(run);
  return marks.map(({ kind, points: p }) => ({ kind, points: p }));
}

//: The travel lanes of a way: the carriageway less its parking lanes, as [left edge offset,
//: right edge offset] from the centreline, left of travel positive. Lane lines, the centre
//: line, arrows and the bike lane are all placed inside this, not across the parked cars.
//: From the cross-sections where the way has them; the parking-side arithmetic is the
//: fallback for a way that does not.
function travelSpanAt(way, along, half) {
  const bands = crossSectionBands(way, along, half);
  if (!bands) return null;
  const travel = bands.filter((b) => b.kind === "travel" || b.kind === "turn");
  return [travel[0].left, travel[travel.length - 1].right];
}

function travelSpan(way, roadWidth) {
  const bands = crossSectionBandsNearMiddle(way, roadWidth / 2);
  if (bands) {
    const travel = bands.filter((b) => b.kind === "travel" || b.kind === "turn");
    return [travel[0].left, travel[travel.length - 1].right];
  }
  const sides = typeof parkingSidesAt === "function" ? parkingSidesAt(way, null)
    : (Array.isArray(way && way.parking_sides) ? way.parking_sides : []);
  const parkLeft = sides.includes(1) ? PARKING_LANE_M : 0;
  const parkRight = sides.includes(-1) ? PARKING_LANE_M : 0;
  // A street too narrow to park on both sides and still drive has the lanes it has.
  if (roadWidth - parkLeft - parkRight < 3.0) return [roadWidth / 2, -roadWidth / 2];
  return [roadWidth / 2 - parkLeft, -roadWidth / 2 + parkRight];
}

function laneOffsets(roadWidth, count, way = null) {
  const [left, right] = travelSpan(way, roadWidth);
  const width = left - right;
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(left - (i + 0.5) * (width / count));
  return out;
}

//: A broken centreline in the United States is a ten-foot stripe with a thirty-foot gap. The
//: numbers matter: at any other ratio it stops reading as a road marking and starts reading as
//: a dotted line somebody drew on a map.
const DASH_M = 3.05;
const GAP_M = 9.14;

//: Marking widths, in metres. The MUTCD normal width is four inches, and San Francisco paints
//: its lane lines and its centre lines at it. A double yellow is two of those with four inches
//: of road between them.
const MARK_W = 0.102;
const DOUBLE_GAP_M = 0.102;

function paintedLine(points, width, color, y,
                     { dash = false, dashM = DASH_M, gapM = GAP_M } = {}) {
  // A road marking is paint on a surface, with a width, and this used to draw it as a
  // THREE.Line -- one pixel wide however far away the camera is, and one pixel wide is not a
  // marking. Two of them 0.36 m apart down the middle of a wide street resolved into a pair of
  // grey threads with the dark road showing between: which is exactly the "thin black stretch
  // where the separator should be" that the centre of every two-way street was showing.
  //
  // Painted as geometry it has the width it has in the street, it takes the light the road
  // takes, and it goes away with distance the way paint does rather than staying one pixel.
  const position = [];
  const index = [];
  // Split at the actual stripe/gap boundaries, not at segment midpoints. A sparse way
  // whose midpoint falls in a gap used to lose its entire lane line (or paint one long slab).
  const runs = dash ? dashRuns(points, dashM, gapM) : [points];
  for (const run of runs) {
    const edges = mitredEdges(run, width);
    if (!edges) continue;
    const { left, right } = edges;
    for (let i = 1; i < left.length; i += 1) {
      const base = position.length / 3;
      position.push(left[i - 1][0], y, left[i - 1][1], right[i - 1][0], y, right[i - 1][1],
                    left[i][0], y, left[i][1], right[i][0], y, right[i][1]);
      index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  if (!index.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }));
  mesh.userData.surface = "marking";
  return mesh;
}

function cyclewayIsLane(value) {
  if (!value) return false;
  const text = String(value).toLowerCase();
  if (text.includes("no") || text.includes("none") || text.includes("shared_lane")) return false;
  return text.includes("lane") || text.includes("track") || text.includes("opposite");
}

function cyclewaySides(way) {
  const sides = [];
  const add = (side) => { if (!sides.includes(side)) sides.push(side); };
  if (cyclewayIsLane(way.cycleway_both)) { add(1); add(-1); }
  if (cyclewayIsLane(way.cycleway_left)) add(1);
  if (cyclewayIsLane(way.cycleway_right)) add(-1);
  if (!sides.length && cyclewayIsLane(way.cycleway)) {
    if (onewaySign(way) !== 0) add(-1);
    else { add(1); add(-1); }
  }
  if (!sides.length && way._bikeInferred) for (const side of way._bikeInferred) add(side);
  return sides;
}

// ---- a short piece of street between two pieces with a bike lane ----
//
// A lane painted block to block is one lane, but OpenStreetMap carries its tag on the pieces of
// the street it was mapped on, and a short piece left untagged between two tagged ones -- a
// bridge, a split at a driveway, a stretch somebody retraced -- was drawn as a hole in the
// lane, a cutout that seemed to pop up for no reason. Where a piece shorter than about a third
// of a block runs straight on from a lane at both ends, on the same side, the lane is taken to
// run through it too. It is recorded as inferred, and never overrides a tag saying "no".
const BIKE_GAP_INFER_M = 45.0;
const BIKE_GAP_STRAIGHT_DEG = 20.0;
const bikeInferenceStats = { ways: 0, metres: 0 };
function inferBikeLaneGaps(ways) {
  const ends = new Map();
  const keyOf = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const bearingAt = (pts, atStart) => {
    const [a, b] = atStart ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
    const [ax, ay] = xy(a[0], a[1]), [bx, by] = xy(b[0], b[1]);
    return Math.atan2(by - ay, bx - ax);
  };
  const streets = ways.filter((w) => w.kind === "street" && w.points && w.points.length >= 2);
  for (const way of streets) {
    for (const atStart of [true, false]) {
      const p = atStart ? way.points[0] : way.points[way.points.length - 1];
      const key = keyOf(p);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ way, atStart });
    }
  }
  const said = (v) => v !== undefined && v !== null && v !== "";
  for (const way of streets) {
    if (cyclewaySides(way).length) continue;
    if ([way.cycleway, way.cycleway_both, way.cycleway_left, way.cycleway_right].some(said)) continue;
    if (wayLength(way.points) > BIKE_GAP_INFER_M) continue;
    // The side a neighbour's lane is on, in this way's own direction, at each of its two ends.
    const sidesAt = (atStart) => {
      const mine = bearingAt(way.points, atStart);
      const found = new Set();
      for (const end of ends.get(keyOf(atStart ? way.points[0] : way.points[way.points.length - 1])) || []) {
        // Only a lane somebody mapped carries one through: inferred pieces do not chain.
        if (end.way === way || end.way._bikeInferred) continue;
        const theirs = cyclewaySides(end.way);
        if (!theirs.length) continue;
        // Their direction where they meet this way; running the other way round flips sides.
        const along = bearingAt(end.way.points, end.atStart);
        const same = end.atStart === !atStart;
        const heading = same ? along : along + Math.PI;
        let turn = Math.abs(heading - mine) % (2 * Math.PI);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (turn > BIKE_GAP_STRAIGHT_DEG * Math.PI / 180) continue;
        for (const s of theirs) found.add(same ? s : -s);
      }
      return found;
    };
    const head = sidesAt(true), tail = sidesAt(false);
    const both = [...head].filter((s) => tail.has(s));
    if (!both.length) continue;
    way._bikeInferred = both;
    bikeInferenceStats.ways += 1;
    bikeInferenceStats.metres += wayLength(way.points);
  }
}

// ---- bike lanes ------------------------------------------------------------------------------
//
// OpenStreetMap splits a street at every junction and at every change of tagging, so a lane that
// is unbroken on the ground arrives here in pieces. Howard Street is twenty ways over a
// kilometre and every one of them carries the same cycleway:right=track. Drawing each piece on
// its own, pulled back from both of its own ends so as not to run out into the crossroads, left
// a seven metre hole at each of the nineteen joins: a hundred and thirty metres of a continuous
// lane missing, in fragments, spread down the street. That is what "the bike lane cuts out
// randomly" looks like from the street, and the randomness is only where OSM happened to split.
//
// So every lane end is classified before anything is drawn. An end that another way's lane
// centre also reaches is a join in the data and nothing at all on the ground, and is not
// trimmed. An end no other lane reaches is where the lane really stops.

//: How close two ways' lane centres must come at their ends to be judged the same lane carrying
//: on. The widths either side of a join can differ -- Howard runs 15.9 to 17.8 m across its
//: twenty ways, which moves the lane centre by about a metre -- so this is wider than a join
//: would need if the widths agreed.
const BIKE_JOIN_M = 2.5;
//: How far a lane is pulled back from an end that really is one. Enough to stop at the kerb line
//: of the cross street rather than painting across it.
const BIKE_END_TRIM_M = 2.0;
//: Two carriageways whose bearings differ by more than this cross each other; below it, one is
//: the continuation of the other round a bend.
const BIKE_CROSS_ANGLE_DEG = 25.0;
//: Twenty-five feet, the MUTCD's approach length over which right-turning traffic merges across
//: the lane. The line between them is broken through it, which is what tells a rider the lane is
//: about to be crossed.
const BIKE_MIXING_M = 7.6;
//: Whether a crossbike dash (two or more lon/lat points) stands on a surveyed island or divider:
//: its middle between two island kerbs read along the dash and across it.
function crossbikeDashOnIsland(dash) {
  if (typeof islandKerbsAround !== "function" || !dash || dash.length < 2) return false;
  const [ax, ay] = xy(dash[0][0], dash[0][1]);
  const [bx, by] = xy(dash[dash.length - 1][0], dash[dash.length - 1][1]);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len, uz = -(by - ay) / len, mx = (ax + bx) / 2, mz = -(ay + by) / 2;
  return !!(islandKerbsAround(mx, mz, ux, uz, 6) && islandKerbsAround(mx, mz, -uz, ux, 6));
}
//: A crossbike: the dashed green trail San Francisco paints across the mouth of a junction where
//: the lane has no paint of its own.
const BIKE_CROSSBIKE_MARK_M = 0.9;
const BIKE_CROSSBIKE_GAP_M = 0.9;
//: The skip line through a mixing zone -- two feet of paint, four of road.
const BIKE_SKIP_M = 0.6;
const BIKE_SKIP_GAP_M = 1.2;

const bikeJoinGrid = new Map();

//: The ground the lanes actually cover, so that nothing else is laid on top of one. A tree pit
//: cut through a bike lane is the clearest case: the pit belongs to the footway, the lane belongs
//: to the carriageway, and a brown square across the green says the pavement runs into the road.
const BIKE_AREA_CELL = 4.0;
const bikeAreaGrid = new Map();

function stampBikeLane(points, side, offset) {
  const half = BIKE_LANE_M / 2;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = xy(points[i - 1][0], points[i - 1][1]);
    const [bx, by] = xy(points[i][0], points[i][1]);
    const segment = [ax, -ay, bx, -by, half];
    const x0 = Math.floor(Math.min(ax, bx) / BIKE_AREA_CELL);
    const x1 = Math.floor(Math.max(ax, bx) / BIKE_AREA_CELL);
    const z0 = Math.floor(Math.min(-ay, -by) / BIKE_AREA_CELL);
    const z1 = Math.floor(Math.max(-ay, -by) / BIKE_AREA_CELL);
    for (let ix = x0 - 1; ix <= x1 + 1; ix += 1) {
      for (let iz = z0 - 1; iz <= z1 + 1; iz += 1) {
        const key = `${ix}:${iz}`;
        let bucket = bikeAreaGrid.get(key);
        if (!bucket) bikeAreaGrid.set(key, bucket = []);
        bucket.push(segment);
      }
    }
  }
}

function insideBikeLane(x, z, slack = 0.0) {
  const cx = Math.floor(x / BIKE_AREA_CELL);
  const cz = Math.floor(z / BIKE_AREA_CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = bikeAreaGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half] of bucket) {
        const limit = half + slack;
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < limit * limit) return true;
      }
    }
  }
  return false;
}

function bikeLaneOffset(roadWidth, way = null, side = 1) {
  // From the cross-section where the way has one: the bike band's own centre on that side.
  if (way && way.xs && way.xs.length) {
    const bands = crossSectionBandsNearMiddle(way, roadWidth / 2);
    if (bands) {
      const bikes = bands.filter((b) => b.kind === "bike");
      const mine = side > 0 ? bikes[0] : bikes[bikes.length - 1];
      if (mine && Math.sign((mine.left + mine.right) / 2) === side) return Math.abs((mine.left + mine.right) / 2);
    }
  }
  // Against the kerb, or against the parked cars where the kerb is a parking lane: a class II
  // lane runs between the parking and the travel lane, which is where the cyclist is.
  const sides = Array.isArray(way && way.parking_sides) ? way.parking_sides : [];
  const parked = sides.includes(side) ? PARKING_LANE_M : 0;
  return Math.max(0.8, roadWidth / 2 - parked - BIKE_LANE_M / 2 - 0.18);
}

//: A lane's line along its kerb (2026-11-26). Set a fixed distance off the street's centre line,
//: a lane jumped wherever the next piece of the street was mapped at another width -- Bay east
//: of Fillmore is drawn 24 m across and the piece west of it 12, and the green stopped at one
//: kerb and started again six metres over, beside the double yellow -- and wandered where the
//: centre line was not midway between the kerbs. It keeps its distance from the kerb on its side
//: instead: the city's kerb, read across the street every BIKE_KERB_STEP_M (not in a junction's
//: box, where the cross street's corner is the nearest kerb), the lane's distance from it what
//: the cross-section or the parking says (bikeLaneOffset), moved over no faster than one metre in
//: BIKE_TAPER_M where the kerb steps. Where no kerb is read, the fixed offset as before.
const BIKE_KERB_STEP_M = 2.0, BIKE_TAPER_M = 6.0, BIKE_KERB_TRUST_M = 5.0;
const bikeLaneStats = { lanes: 0, kerbFollowed: 0, stations: 0, read: 0, farJoins: 0 };
function bikeLaneCentreLine(way, roadWidth, side) {
  const off0 = bikeLaneOffset(roadWidth, way, side);
  const pts = densifyWay(way.points, BIKE_KERB_STEP_M);
  if (pts.length < 2 || typeof officialCurbGrid === "undefined" || !officialCurbGrid.size) return offsetWay(pts, side * off0);
  const fromKerb = Math.max(0.2, roadWidth / 2 - off0);
  const local = pts.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  const read = local.map(([x, z], i) => {
    const a = local[Math.max(0, i - 1)], b = local[Math.min(local.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // (offsetWay's sense: + is to the left of travel, (-dz, dx) in x/z with z = -y.)
    const nx = side * (b[1] - a[1]) / L, nz = -side * (b[0] - a[0]) / L;
    bikeLaneStats.stations += 1;
    if (typeof insideJunctionBox === "function" && insideJunctionBox(x, z)) return null;
    const hits = rayCurbIntersections(x, z, nx, nz, roadWidth / 2 + BIKE_KERB_TRUST_M + 2, officialCurbGrid)
      .filter((t) => t > BIKE_LANE_M + 0.4).sort((p, q) => p - q);
    const kerb = hits[0];
    if (kerb === undefined || Math.abs(kerb - roadWidth / 2) > BIKE_KERB_TRUST_M) return null;
    bikeLaneStats.read += 1;
    return Math.max(0.8, kerb - fromKerb);
  });
  if (!read.some((v) => v !== null)) return offsetWay(pts, side * off0);
  bikeLaneStats.kerbFollowed += 1;
  // The gaps between readings filled in a line between them (the fixed offset past the last).
  const filled = read.slice();
  for (let i = 0; i < filled.length; i += 1) {
    if (filled[i] !== null) continue;
    let a = i - 1; while (a >= 0 && read[a] === null) a -= 1;
    let b = i + 1; while (b < read.length && read[b] === null) b += 1;
    filled[i] = a >= 0 && b < read.length ? read[a] + (read[b] - read[a]) * (i - a) / (b - a) : a >= 0 ? read[a] : b < read.length ? read[b] : off0;
  }
  // A reading off by a stray kerb (a driveway's lip, a bulb): the middle of five.
  const med = filled.map((_, i) => { const w = filled.slice(Math.max(0, i - 2), i + 3).sort((p, q) => p - q); return w[w.length >> 1]; });
  // Moved over no faster than the taper allows, both ways along.
  const step = BIKE_KERB_STEP_M / BIKE_TAPER_M;
  for (let i = 1; i < med.length; i += 1) med[i] = Math.min(Math.max(med[i], med[i - 1] - step), med[i - 1] + step);
  for (let i = med.length - 2; i >= 0; i -= 1) med[i] = Math.min(Math.max(med[i], med[i + 1] - step), med[i + 1] + step);
  return offsetWay(pts, med.map((v) => side * v));
}
//: A lane's two ends into the join grid, each with the way it points out of the lane: a join
//: is two ends that face each other, and the direction is what tells one from a T.
function indexLaneEnds(centre, street = null, side = 0, width = 0, flow = 0) {
  if (!centre || centre.length < 2) return;
  const length = wayLength(centre);
  for (const [end, prev, out] of [[centre[0], centre[1], -flow], [centre[centre.length - 1], centre[centre.length - 2], flow]]) {
    const [x, y] = xy(end[0], end[1]);
    const [px, py] = xy(prev[0], prev[1]);
    const len = Math.hypot(x - px, y - py) || 1;
    const key = `${Math.floor(x / BIKE_JOIN_M)}:${Math.floor(-y / BIKE_JOIN_M)}`;
    let bucket = bikeJoinGrid.get(key);
    if (!bucket) bikeJoinGrid.set(key, bucket = []);
    bucket.push([x, -y, (x - px) / len, -(y - py) / len, street, side, width, out, length]);
  }
}
//: The outward direction of a lane at one of its ends, for the join tests.
function laneEndDirection(centre, atStart) {
  const end = atStart ? centre[0] : centre[centre.length - 1];
  const prev = atStart ? centre[1] : centre[centre.length - 2];
  const [x, y] = xy(end[0], end[1]);
  const [px, py] = xy(prev[0], prev[1]);
  const len = Math.hypot(x - px, y - py) || 1;
  return [(x - px) / len, -(y - py) / len];
}
//: Two lane ends are a join when each points into the other: the lane carries on. Ends that
//: meet at a right angle are a T -- Battery's lane at Market -- where one lane stops and
//: eased onto the other it bent across the junction.
const BIKE_JOIN_FACING = -0.5;
function laneEndsFace(ux, uz, vx, vz) {
  if (ux === undefined || vx === undefined) return true;
  return ux * vx + uz * vz <= BIKE_JOIN_FACING;
}

function indexBikeLaneEnds(ways) {
  bikeJoinGrid.clear();
  bikeAreaGrid.clear();
  for (const way of ways) {
    if (way.kind === "cycleway" && way.points && way.points.length >= 2) {
      // A separate track's ends are joins too: the road's lane eases onto it and it onto the lane.
      indexLaneEnds(way.points);
      continue;
    }
    if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
    const sides = cyclewaySides(way);
    if (!sides.length) continue;
    const roadWidth = renderedRoadWidth(way);
    if (roadWidth < BIKE_LANE_M + 2.2) continue;
    for (const side of sides) {
      const centre = bikeLaneCentreLine(way, roadWidth, side);
      stampBikeLane(centre, side, bikeLaneOffset(roadWidth, way, side));
      indexLaneEnds(centre, way.name || null, side, roadWidth, laneFlow(way, side));
      bikeLaneStats.lanes += 1;
    }
  }
}

//: Over this much of its end a lane is eased sideways to meet the lane it joins. Two ways'
//: lane centres seldom land on the same point -- the widths differ, or one way was recentred
//: on the city's kerbs and the other was too short to be -- and drawn straight to their own
//: ends the two lanes stood a metre apart at the join, each line stopping dead where the
//: other's started. A lane bends over a few metres to line up with the next block.
const BIKE_BLEND_M = 12.0;

//: Which way a lane's riders go along its way: +1 with the points, -1 against. A one-way
//: street's lanes go its way; on a two-way street the right-hand lane (side -1) goes with the
//: points and the left-hand one against them. At a lane's end, the sign times +1 at the last
//: point (-1 at the first) is whether the riders leave the lane there (+1) or come into it.
function laneFlow(way, side) {
  const one = onewaySign(way);
  return one !== 0 ? one : side < 0 ? 1 : -1;
}
function bikeLaneJoinTarget(x, z, ux, uz, street = null, width = 0, flowOut = 0, length = 0) {
  // Where this lane end meets the lane it joins: halfway to the mean of the other ends here
  // that face it, so both lanes ease by half the gap and meet at one point. Null where the
  // lane simply ends, or where the only other end here is a lane it meets at an angle.
  // A short piece between long ones takes the whole step, drifted over its whole length (the
  // target's `drift`): Bay's lane jogged two metres where the thirty-metre piece before
  // Fillmore had no parking and the block east of it had, an S in the middle of the block.
  let sx = 0, sz = 0, n = 0, shortest = Infinity, longest = 0;
  const cx = Math.floor(x / BIKE_JOIN_M);
  const cz = Math.floor(z / BIKE_JOIN_M);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = bikeJoinGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const [px, pz, vx, vz, , , , , len = 0] of bucket) {
        const gap = Math.hypot(px - x, pz - z);
        if (gap > BIKE_JOIN_M) continue;
        if (gap < 0.05 && (ux === undefined || ux * vx + uz * vz > 0.99)) continue;   // this lane's own end
        if (!laneEndsFace(ux, uz, vx, vz)) continue;
        sx += px; sz += pz; n += 1;
        shortest = Math.min(shortest, len); longest = Math.max(longest, len);
      }
    }
  }
  if (n) {
    if (length && length <= BIKE_DRIFT_MAX_M && shortest > BIKE_DRIFT_RATIO * length) {
      const all = [sx / n, sz / n];
      all.drift = true;
      return all;
    }
    if (length && longest && longest * BIKE_DRIFT_RATIO < length && longest <= BIKE_DRIFT_MAX_M) return [x, z];
    return [(x + sx / n) / 2, (z + sz / n) / 2];
  }
  // A lane carried on past a kerb that steps (a street mapped wider, then narrower): the end of
  // the same street's lane facing this one straight on, up to BIKE_FAR_JOIN_M ahead and
  // BIKE_FAR_SIDE_M to one side -- the nearest sideways. Both ease half the step over their
  // blend (blendLaneEnd), a taper rather than a gap and a lane starting six metres over. Where
  // one street is mapped much wider than the other the wider one has the room to move over and
  // takes the whole step, the narrow one staying put: at Bay and Fillmore the lane beside the
  // island has the island under it if it moves, and the lane on the 24 m piece ten metres over
  // eases across to meet it. Only a lane whose riders go on into this one: the westbound lane
  // beside it on the same street ends there too, and joined to it was a green X across Bay.
  if (!street) return null;
  let best = null;
  const reach = Math.ceil(BIKE_FAR_JOIN_M / BIKE_JOIN_M);
  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let dz = -reach; dz <= reach; dz += 1) {
      for (const [px, pz, vx, vz, name, , w = 0, out = 0] of bikeJoinGrid.get(`${cx + dx}:${cz + dz}`) || []) {
        if (name !== street || ux === undefined || ux * vx + uz * vz > -0.9) continue;
        if (flowOut && out && flowOut === out) continue;   // both lanes' riders leave here, or both arrive
        const ahead = (px - x) * ux + (pz - z) * uz, aside = Math.abs(-(px - x) * uz + (pz - z) * ux);
        if (ahead < -0.5 || ahead > BIKE_FAR_JOIN_M || aside > BIKE_FAR_SIDE_M || aside < 0.05 && ahead < 0.05) continue;
        if (!best || aside < best.aside) best = { px, pz, aside, w };
      }
    }
  }
  if (!best) return null;
  bikeLaneStats.farJoins += 1;
  if (width && best.w && best.w < width - BIKE_WIDER_M) {    // the wider moves
    // ...across the junction's box, where the gap is painted as a crossbike: a step this big
    // drawn as a taper in the block ran the green over the double yellow.
    const all = [best.px, best.pz];
    all.inBox = true;
    return all;
  }
  if (width && best.w && best.w > width + BIKE_WIDER_M) return [x, z];               // the narrow stays
  return [(x + best.px) / 2, (z + best.pz) / 2];
}
const BIKE_FAR_JOIN_M = 9, BIKE_FAR_SIDE_M = 11.5, BIKE_WIDER_M = 2.0;
const BIKE_DRIFT_MAX_M = 45, BIKE_DRIFT_RATIO = 1.5, BIKE_BOX_STEP_MIN_M = 8;
//: How far back from a lane's end it lies in a junction's box: where a step across is drawn.
function laneBoxRunM(lane, atStart) {
  const ordered = atStart ? lane.slice().reverse() : lane;   // (the end in question last)
  let run = 0;
  for (let i = ordered.length - 1; i > 0; i -= 1) {
    const [x, y] = xy(ordered[i][0], ordered[i][1]);
    if (!insideJunctionBox(x, -y)) break;
    const [px, py] = xy(ordered[i - 1][0], ordered[i - 1][1]);
    run += Math.hypot(x - px, y - py);
  }
  return run;
}

function blendLaneEnd(points, target, atStart, maxM = Infinity, wantM = 0) {
  // Ease the lane's last BIKE_BLEND_M sideways so that its end lands on `target`.
  if (!points || points.length < 2) return points;
  const ordered = atStart ? points.slice().reverse() : points;
  const [ex, ey] = xy(ordered[ordered.length - 1][0], ordered[ordered.length - 1][1]);
  const shiftX = target[0] - ex;
  const shiftZ = target[1] - (-ey);
  if (Math.hypot(shiftX, shiftZ) < 0.05) return points;
  // (A bigger step is taken over a longer taper: four metres along for each one over.)
  // (No longer than the lane, so a lane joined at both ends keeps its other end where it was.)
  // (Or as long as asked: a whole short piece, or a junction's box.)
  const blendM = Math.min(maxM, wantM || Math.max(BIKE_BLEND_M, 4 * Math.hypot(shiftX, shiftZ)));
  const out = [];
  let fromEnd = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const [x, y] = xy(ordered[i][0], ordered[i][1]);
    if (i < ordered.length - 1) {
      const [nx, ny] = xy(ordered[i + 1][0], ordered[i + 1][1]);
      fromEnd += Math.hypot(x - nx, y - ny);
    }
    const t = Math.max(0, 1 - fromEnd / blendM);
    // Eased, so the bend starts gently rather than as a kink.
    const ease = t * t * (3 - 2 * t);
    out.unshift(ease > 0 ? lonLatFromXZ(x + shiftX * ease, -y + shiftZ * ease) : ordered[i]);
  }
  return atStart ? out.reverse() : out;
}

function bikeLaneEndsAt(x, z, ux, uz) {
  // How many lane ends stand here, this way's own included. More than one is a join -- when
  // the others face this one; given no direction, any end here counts.
  let found = 0;
  const cx = Math.floor(x / BIKE_JOIN_M);
  const cz = Math.floor(z / BIKE_JOIN_M);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = bikeJoinGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const [px, pz, vx, vz] of bucket) {
        const gap = Math.hypot(px - x, pz - z);
        if (gap > BIKE_JOIN_M) continue;
        // This lane's own end is the one here that points the same way; any other counts
        // only if it faces this one.
        const own = gap < 0.05 && (ux === undefined || ux * vx + uz * vz > 0.99);
        if (!own && !laneEndsFace(ux, uz, vx, vz)) continue;
        found += 1;
      }
    }
  }
  return found;
}

function trimWayEnds(points, cutStart, cutEnd) {
  // trimWay pulls both ends back by the same amount. A lane needs them separately: one end of a
  // way is often a join to be carried straight through and the other a junction to stop short of.
  if (points.length < 2) return points;
  const spans = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    const span = Math.hypot(x2 - x1, y2 - y1);
    spans.push(span);
    total += span;
  }
  let start = Math.max(0, cutStart);
  let end = Math.max(0, cutEnd);
  // Never eat the whole run. A short way asked for more than it has would leave nothing, which
  // is the hole all of this exists to close.
  const room = Math.max(0, total - 1.0);
  if (start + end > room) {
    const scale = (start + end) > 1e-6 ? room / (start + end) : 0;
    start *= scale;
    end *= scale;
  }
  if (start < 0.05 && end < 0.05) return points;
  const at = (distance) => {
    let travelled = 0;
    for (let i = 0; i < spans.length; i += 1) {
      if (travelled + spans[i] >= distance) {
        const t = spans[i] < 1e-6 ? 0 : (distance - travelled) / spans[i];
        return lerpLonLat(points[i], points[i + 1], t);
      }
      travelled += spans[i];
    }
    return points[points.length - 1];
  };
  const out = [at(start)];
  let travelled = 0;
  for (let i = 0; i < spans.length; i += 1) {
    travelled += spans[i];
    if (travelled > start + 0.01 && travelled < total - end - 0.01) out.push(points[i + 1]);
  }
  out.push(at(total - end));
  return out.length >= 2 ? out : points;
}

function crosswiseCarriagewayAt(x, z, bearing, slack = 0.0, ownWay = null, minorToo = true) {
  // Is this point standing in a street that crosses the one it belongs to? insideCarriageway
  // cannot answer it: a lane is inside its own carriageway everywhere along its length. What
  // separates a junction from the rest of the block is that the carriageway covering the point
  // runs across it rather than along it.
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  const limitAngle = (BIKE_CROSS_ANGLE_DEG * Math.PI) / 180;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half, other, source] of bucket) {
        if (ownWay && source === ownWay) continue;
        if (other === undefined) continue;
        // A driveway or a parking aisle meets the street; it does not cross it. The street's
        // paint carries on past it, as the double yellow does past every garage on a block.
        if (!minorToo && source && SERVICE_ROAD_M[source.service] !== undefined) continue;
        let difference = Math.abs(other - bearing) % Math.PI;
        if (difference > Math.PI / 2) difference = Math.PI - difference;
        if (difference < limitAngle) continue;
        const limit = Math.max(0, half - slack);
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < limit * limit) return true;
      }
    }
  }
  return false;
}

function bikeCrossingBreakAt(x, z, bearing, slack = 0.0, ownWay = null) {
  // A cross street is not always a place where the bike lane stops. At a four-way junction the
  // lane breaks at the end of the block and restarts on the far side; at a T-junction the side
  // street usually turns across a continuous bike lane. Treat it as a break only when the
  // crosswise carriageway has arms on both sides of the lane.
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  const limitAngle = (BIKE_CROSS_ANGLE_DEG * Math.PI) / 180;
  let before = false;
  let after = false;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half, other, source] of bucket) {
        if (ownWay && source === ownWay) continue;
        if (other === undefined) continue;
        let difference = Math.abs(other - bearing) % Math.PI;
        if (difference > Math.PI / 2) difference = Math.PI - difference;
        if (difference < limitAngle) continue;
        const limit = Math.max(0, half - slack);
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) >= limit * limit) continue;
        const ux = Math.cos(other);
        const uz = Math.sin(other);
        const a = (ax - x) * ux + (az - z) * uz;
        const b = (bx - x) * ux + (bz - z) * uz;
        const arm = Math.max(1.8, Math.min(4.2, half * 0.45));
        if (a < -arm || b < -arm) before = true;
        if (a > arm || b > arm) after = true;
      }
    }
  }
  return before && after;
}

function dashRuns(points, markM, gapM) {
  // The same polyline as a series of painted blocks, cut at the pattern rather than sampled by
  // it. Testing whole segments against the cycle -- which is what this did -- aliases as soon as
  // the segments are longer than the pattern, and they always are: the lane is densified every
  // two metres and a crossbike is 0.9 m of paint and 0.9 m of road, so segment after segment
  // landed in a gap and a dashed green trail across a junction came out as bare asphalt with one
  // stray block in the middle of it.
  const runs = [];
  const cycle = markM + gapM;
  let travelled = 0;
  let current = null;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    const span = Math.hypot(x2 - x1, y2 - y1);
    if (span < 1e-6) continue;
    let walked = 0;
    while (walked < span) {
      const at = travelled + walked;
      const phase = at % cycle;
      const painting = phase < markM;
      // How far to the next change of state, clipped to what is left of this segment.
      const step = Math.min(span - walked, (painting ? markM : cycle) - phase);
      if (painting) {
        const a = lerpLonLat(points[i - 1], points[i], walked / span);
        const b = lerpLonLat(points[i - 1], points[i], (walked + step) / span);
        if (current) current.push(b);
        else runs.push(current = [a, b]);
      } else {
        current = null;
      }
      walked += Math.max(step, 1e-6);
    }
    travelled += span;
  }
  return runs.filter((run) => run.length >= 2);
}

function bikeLaneZones(lane, ownWay = null, stepped = null) {
  //: Narrower than any street a lane could cross: a break this short is a gap, not a junction.
  const BIKE_MIN_CROSSING_M = 6.0;
  // Every sample along the lane labelled crossing, mixing or lane, and then gathered into runs.
  // (`stepped`: metres at each end where the lane steps across a junction's box to the lane it
  // joins -- painted as a crossbike, the dashes a city puts down where a lane jogs over.)
  const labels = [];
  const spans = [0];
  for (let i = 1; i < lane.length; i += 1) {
    const [x, y] = xy(lane[i][0], lane[i][1]);
    const [px, py] = xy(lane[i - 1][0], lane[i - 1][1]);
    spans.push(spans[i - 1] + Math.hypot(x - px, y - py));
  }
  const total = spans[spans.length - 1] || 0;
  for (let i = 0; i < lane.length; i += 1) {
    if (stepped && (spans[i] < stepped.start || total - spans[i] < stepped.end)) { labels.push("crossing"); continue; }
    const before = lane[Math.max(0, i - 1)];
    const after = lane[Math.min(lane.length - 1, i + 1)];
    const [x, y] = xy(lane[i][0], lane[i][1]);
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const bearing = Math.atan2(-ay + by, ax - bx);
    labels.push(bikeCrossingBreakAt(x, -y, bearing, 0.2, ownWay) ? "crossing" : "lane");
  }
  // A "crossing" too short to be a street -- a sample or two clipping a driveway's carriageway
  // or a mapped crossing's corner -- with lane on both sides of it is lane: it was a gap in the
  // paint, a few metres of bare road that seemed to pop up in the middle of a block.
  for (let i = 0; i < labels.length;) {
    if (labels[i] !== "crossing") { i += 1; continue; }
    let j = i;
    while (j + 1 < labels.length && labels[j + 1] === "crossing") j += 1;
    const inside = i > 0 && j < labels.length - 1;
    if (inside && spans[j] - spans[i] < BIKE_MIN_CROSSING_M) {
      for (let k = i; k <= j; k += 1) labels[k] = "lane";
    }
    i = j + 1;
  }
  // The mixing zone is the stretch of ordinary lane within twenty-five feet of a crossing, on
  // either side of it: two-way streets have right-turning traffic merging on both approaches.
  const crossings = [];
  for (let i = 0; i < labels.length; i += 1) if (labels[i] === "crossing") crossings.push(spans[i]);
  if (crossings.length) {
    for (let i = 0; i < labels.length; i += 1) {
      if (labels[i] !== "lane") continue;
      for (const at of crossings) {
        if (Math.abs(spans[i] - at) <= BIKE_MIXING_M) { labels[i] = "mixing"; break; }
      }
    }
  }
  const runs = [];
  let current = null;
  for (let i = 0; i < lane.length; i += 1) {
    if (!current || current.label !== labels[i]) {
      // Runs share their boundary point, so the paint of one meets the paint of the next
      // instead of leaving a sliver of bare road between them.
      if (current) current.points.push(lane[i]);
      runs.push(current = { label: labels[i], points: [] });
      if (i) current.points.push(lane[i - 1]);
    }
    current.points.push(lane[i]);
  }
  return runs.filter((run) => run.points.length >= 2);
}

//: The bike lanes' bands as laid, in pieces of up to 8 m, each the band between its two lines:
//: claimed on the paint plan (module 21), so no STOP or box is laid in a bike lane.
const paintedBikeBands = [];
function notePaintedBikeBand(points) {
  if (!Array.isArray(points) || points.length < 2) return;
  const pts = points.map(([lon, lat]) => { const [x, y] = xy(lon, lat); return [x, -y]; });
  for (let i = 1; i < pts.length; i += 1) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], len = Math.hypot(bx - ax, bz - az);
    if (!(len > 0.5)) continue;
    const n = Math.ceil(len / 8), ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let k = 0; k < n; k += 1) {
      const t0 = (k / n) * len, t1 = ((k + 1) / n) * len, tm = (t0 + t1) / 2;
      paintedBikeBands.push({ x: ax + ux * tm, z: az + uz * tm, ux, uz, along: (t1 - t0) / 2,
        across: Math.max(0.2, BIKE_LANE_M / 2 - BIKE_EDGE_W_M) });
    }
  }
}
function addBikeLaneMarkings(way, renderPoints, roadWidth, roadTop) {
  const sides = cyclewaySides(way);
  if (!sides.length || roadWidth < BIKE_LANE_M + 2.2) return;
  for (const side of sides) {
    // Along its kerb (bikeLaneCentreLine), as the join grid has it.
    const centre = bikeLaneCentreLine(way, roadWidth, side);
    if (!centre || centre.length < 2) continue;
    const [sx, sy] = xy(centre[0][0], centre[0][1]);
    const [ex, ey] = xy(centre[centre.length - 1][0], centre[centre.length - 1][1]);
    const flow = laneFlow(way, side);
    const centreM = wayLength(centre);
    const joinStart = bikeLaneJoinTarget(sx, -sy, ...laneEndDirection(centre, true), way.name || null, roadWidth, -flow, centreM);
    const joinEnd = bikeLaneJoinTarget(ex, -ey, ...laneEndDirection(centre, false), way.name || null, roadWidth, flow, centreM);
    const cutStart = joinStart ? 0 : BIKE_END_TRIM_M;
    const cutEnd = joinEnd ? 0 : BIKE_END_TRIM_M;
    let lane = densifyWay(trimWayEnds(centre, cutStart, cutEnd), 2.0);
    if (lane.length < 2) continue;
    const laneM = wayLength(lane);
    const wantFor = (target, atStart) => target.drift ? laneM
      : target.inBox ? Math.max(BIKE_BOX_STEP_MIN_M, laneBoxRunM(lane, atStart)) : 0;
    if (joinStart) lane = blendLaneEnd(lane, joinStart, true, joinEnd ? laneM : Infinity, wantFor(joinStart, true));
    if (joinEnd) lane = blendLaneEnd(lane, joinEnd, false, joinStart ? laneM : Infinity, wantFor(joinEnd, false));
    const stepped = joinStart?.inBox || joinEnd?.inBox
      ? { start: joinStart?.inBox ? wantFor(joinStart, true) : 0, end: joinEnd?.inBox ? wantFor(joinEnd, false) : 0 } : null;

    for (const run of bikeLaneZones(lane, way, stepped)) {
      if (run.label === "crossing") {
        // No lane lines across a junction -- the lane has no priority there and painting its
        // edges through would say it did. San Francisco marks the gap with a crossbike instead.
        for (const dash of dashRuns(run.points, BIKE_CROSSBIKE_MARK_M, BIKE_CROSSBIKE_GAP_M)) {
          // Not on an island the trail passes over (Fillmore's median end at Bay): paint is on
          // the road, and the rider rides round the nose or over its cut, never up its kerb.
          if (crossbikeDashOnIsland(dash)) continue;
          const block = ribbon(dash, BIKE_LANE_M, 0xffffff, 1.0, roadTop + 0.010, 0.012, "bike");
          if (block) addMerged("bike:fill", block, "bike");
        }
        continue;
      }
      // (Broken where a mapped crosswalk crosses it: the crosswalk is painted, not the lane.)
      for (const piece of splitAtMappedCrossings(run.points)) {
        if (run.label !== "mixing" && typeof notePaintedBikeBand === "function") notePaintedBikeBand(piece);
        const fill = ribbon(piece, BIKE_LANE_M, 0xffffff, 1.0, roadTop + 0.010, 0.012, "bike");
        if (fill) addMerged("bike:fill", fill, "bike");
        // Both edges, every metre of the way, whether or not there is green under them: the lines
        // are the lane and the colour is a treatment on top of it.
        const outer = paintedLine(offsetWay(piece, side * bikePaintEdgeOffset(BIKE_LANE_M)),
                                  BIKE_EDGE_W_M, 0xf2f5ef, roadTop + 0.030);
        const innerPoints = offsetWay(piece, -side * bikePaintEdgeOffset(BIKE_LANE_M));
        const inner = run.label === "mixing"
          ? paintedLine(densifyWay(innerPoints, BIKE_SKIP_M / 3), BIKE_EDGE_W_M, 0xf2f5ef,
                        roadTop + 0.032, { dash: true, dashM: BIKE_SKIP_M, gapM: BIKE_SKIP_GAP_M })
          : paintedLine(innerPoints, BIKE_EDGE_W_M, 0xf2f5ef, roadTop + 0.032);
        if (outer) addMerged("bike:edge", outer, "marking");
        if (inner) addMerged("bike:edge", inner, "marking");
      }
    }
  }
}

function dashedLine(points, color, opacity, y) {
  const vertices = points.map((p) => v3(p[0], p[1], y));
  const geom = new THREE.BufferGeometry().setFromPoints(vertices);
  const mat = new THREE.LineDashedMaterial({
    color, transparent: opacity < 1, opacity,
    dashSize: DASH_M, gapSize: GAP_M,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const obj = new THREE.Line(geom, mat);
  // LineDashedMaterial dashes by distance along the line, and that distance is not computed
  // for you. Without this every dashed line renders solid, which is exactly what it looks like
  // when it silently fails.
  obj.computeLineDistances();
  return obj;
}

//: A label's height as a fraction of the viewport, and the range beyond which it is not
//: drawn. A sprite with sizeAttenuation off keeps its size on screen however far away it is,
//: which is what a name on a map should do -- but it also means a name never shrinks out of
//: the way, so each kind of label is given the distance past which it stops being useful.
const LABEL_SCREEN_H = { street: 0.030, district: 0.042 };
const LABEL_RANGE_M = { street: 420, district: 6000 };

//: A label held at three per cent of the view is 28 CSS pixels tall, 56 on a Retina screen,
//: and its plate is three fifths of the canvas: 64 rows still give every screen pixel a texel
//: of its own. At 128 the 275 region markers held 96 MB of pictures nobody could see the
//: difference of. A district name stands larger and keeps the full canvas. (Written into the
//: function, not a constant beside it: the region markers ask for labels from a callback that
//: can run while the module is still on its way here -- a constant was not yet there, and the
//: page failed to start.)
function labelSprite(text, color = "#edf5f5", kind = "street") {
  const canvas = document.createElement("canvas");
  const scale = kind === "district" ? 1 : 0.5;
  canvas.width = 512 * scale;
  canvas.height = 128 * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);   // laid out on the 512 x 128 plate it always was
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = "rgba(7, 16, 19, 0.70)";
  ctx.strokeStyle = "rgba(214, 231, 234, 0.26)";
  ctx.lineWidth = 3;
  roundRect(ctx, 12, 22, 488, 76, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // The name is fitted rather than cut. Chopping at a fixed count of characters put
  // "University Avenue and the st" across a city; a name is set smaller until it fits the
  // plate, and only a name too long to read at all is shortened, with the ellipsis that says so.
  let size = 42;
  let shown = text;
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  while (ctx.measureText(shown).width > 450 && size > 24) {
    size -= 2;
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  }
  while (ctx.measureText(shown).width > 450 && shown.length > 4) {
    shown = shown.slice(0, -2) + "\u2026";
    if (shown.length > 6) shown = shown.slice(0, -2) + "\u2026";
  }
  ctx.fillText(shown, 256, 62);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthWrite: false,
  }));
  // Sized every frame from how far away it is, so it holds its share of the viewport.
  //
  // Not through sizeAttenuation: that leaves the sprite's scale in world units and has the
  // shader multiply by the view depth, which also picks up whatever scale stands above the
  // sprite in the graph -- so a name meant to be three per cent of the view came out nearer
  // twenty. The size is worked out here instead, from the camera's own field of view, where
  // it can be checked. As fixed world metres a district name was a 145-metre board lying over
  // the blocks it named and a street name a 78-metre one: from a low camera they filled the
  // view, and from a high one they tiled the city.
  sprite.userData.labelScreenH = LABEL_SCREEN_H[kind] || LABEL_SCREEN_H.street;
  sprite.userData.labelAspect = canvas.width / canvas.height;
  sprite.userData.labelRange = LABEL_RANGE_M[kind] || LABEL_RANGE_M.street;
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function labelAt(text, lon, lat, y, group, color = "#edf5f5", kind = "street") {
  const sprite = labelSprite(text, color, kind);
  const [x, yy] = xy(lon, lat);
  sprite.position.set(x, y, -yy);
  group.add(sprite);
}

function longestMidpoint(points) {
  let best = null;
  let bestLength = -1;
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = xy(points[i - 1][0], points[i - 1][1]);
    const [x2, y2] = xy(points[i][0], points[i][1]);
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length > bestLength) {
      bestLength = length;
      best = [(points[i - 1][0] + points[i][0]) / 2, (points[i - 1][1] + points[i][1]) / 2];
    }
  }
  return best;
}

