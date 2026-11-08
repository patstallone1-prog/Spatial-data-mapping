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
      samples.push({ point, x, z: -y, onRoad: insideCarriageway(x, -y, 0.0) });
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

function shouldDrawCrossing(points, width, tag = null) {
  const pose = crossingDrawPose(points);
  if (!pose) return false;
  if (crossingDrawConflict(pose, width)) return false;
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

function indexMappedCrossing(points) {
  const pose = crossingDrawPose(points);
  if (!pose) return;
  const key = `${Math.floor(pose.x / CROSSING_DEDUPE_CELL_M)}:${Math.floor(pose.z / CROSSING_DEDUPE_CELL_M)}`;
  let bucket = mappedCrossingGrid.get(key);
  if (!bucket) mappedCrossingGrid.set(key, bucket = []);
  bucket.push(pose);
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
//: The parked cars' lane along a kerb, where the city's parking policies say one is.
const PARKING_LANE_M = 2.4;

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
function crossSectionBands(way, along, half) {
  const row = crossSectionRowAt(way, along, half);
  if (!row || row[4] === "u") return null;
  const bands = row[5].map((b) => ({ kind: CROSS_SECTION_KIND[b[0]] || b[0], width: b[1], dir: b[4] || 0, sub: b[5] || "" }));
  if (bands.some((b) => b.kind === "unresolved")) return null;
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
  let open = [];                     // {kind, offset, points}
  const CONTINUE_M = 1.2;
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
      const j = open.findIndex((run) => run.kind === mark.kind
        && Math.abs(run.offset - mark.offset) <= CONTINUE_M);
      if (j >= 0) {
        const run = open.splice(j, 1)[0];
        run.offset = mark.offset;
        run.points.push(at(mark.offset));
        next.push(run);
      } else {
        // A line that begins where another ended starts from the sample before, at its own
        // offset, so the change of marking happens on the road rather than a gap apart.
        const run = { kind: mark.kind, offset: mark.offset, points: [] };
        if (i > 0 && open.length) {
          const [px, py] = xy(points[i - 1][0], points[i - 1][1]);
          run.points.push(lonLatFromXZ(px + nx * mark.offset, -(py + ny * mark.offset)));
        }
        run.points.push(at(mark.offset));
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
  const sides = Array.isArray(way && way.parking_sides) ? way.parking_sides : [];
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

//: A lane's two ends into the join grid, each with the way it points out of the lane: a join
//: is two ends that face each other, and the direction is what tells one from a T.
function indexLaneEnds(centre) {
  if (!centre || centre.length < 2) return;
  for (const [end, prev] of [[centre[0], centre[1]], [centre[centre.length - 1], centre[centre.length - 2]]]) {
    const [x, y] = xy(end[0], end[1]);
    const [px, py] = xy(prev[0], prev[1]);
    const len = Math.hypot(x - px, y - py) || 1;
    const key = `${Math.floor(x / BIKE_JOIN_M)}:${Math.floor(-y / BIKE_JOIN_M)}`;
    let bucket = bikeJoinGrid.get(key);
    if (!bucket) bikeJoinGrid.set(key, bucket = []);
    bucket.push([x, -y, (x - px) / len, -(y - py) / len]);
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
      const centre = offsetWay(way.points, side * bikeLaneOffset(roadWidth, way, side));
      stampBikeLane(centre, side, bikeLaneOffset(roadWidth, way, side));
      indexLaneEnds(centre);
    }
  }
}

//: Over this much of its end a lane is eased sideways to meet the lane it joins. Two ways'
//: lane centres seldom land on the same point -- the widths differ, or one way was recentred
//: on the city's kerbs and the other was too short to be -- and drawn straight to their own
//: ends the two lanes stood a metre apart at the join, each line stopping dead where the
//: other's started. A lane bends over a few metres to line up with the next block.
const BIKE_BLEND_M = 12.0;

function bikeLaneJoinTarget(x, z, ux, uz) {
  // Where this lane end meets the lane it joins: halfway to the mean of the other ends here
  // that face it, so both lanes ease by half the gap and meet at one point. Null where the
  // lane simply ends, or where the only other end here is a lane it meets at an angle.
  let sx = 0, sz = 0, n = 0;
  const cx = Math.floor(x / BIKE_JOIN_M);
  const cz = Math.floor(z / BIKE_JOIN_M);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = bikeJoinGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const [px, pz, vx, vz] of bucket) {
        const gap = Math.hypot(px - x, pz - z);
        if (gap > BIKE_JOIN_M) continue;
        if (gap < 0.05 && (ux === undefined || ux * vx + uz * vz > 0.99)) continue;   // this lane's own end
        if (!laneEndsFace(ux, uz, vx, vz)) continue;
        sx += px; sz += pz; n += 1;
      }
    }
  }
  if (!n) return null;
  return [(x + sx / n) / 2, (z + sz / n) / 2];
}

function blendLaneEnd(points, target, atStart) {
  // Ease the lane's last BIKE_BLEND_M sideways so that its end lands on `target`.
  if (!points || points.length < 2) return points;
  const ordered = atStart ? points.slice().reverse() : points;
  const [ex, ey] = xy(ordered[ordered.length - 1][0], ordered[ordered.length - 1][1]);
  const shiftX = target[0] - ex;
  const shiftZ = target[1] - (-ey);
  if (Math.hypot(shiftX, shiftZ) < 0.05) return points;
  const out = [];
  let fromEnd = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const [x, y] = xy(ordered[i][0], ordered[i][1]);
    if (i < ordered.length - 1) {
      const [nx, ny] = xy(ordered[i + 1][0], ordered[i + 1][1]);
      fromEnd += Math.hypot(x - nx, y - ny);
    }
    const t = Math.max(0, 1 - fromEnd / BIKE_BLEND_M);
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

function bikeLaneZones(lane, ownWay = null) {
  //: Narrower than any street a lane could cross: a break this short is a gap, not a junction.
  const BIKE_MIN_CROSSING_M = 6.0;
  // Every sample along the lane labelled crossing, mixing or lane, and then gathered into runs.
  const labels = [];
  const spans = [0];
  for (let i = 0; i < lane.length; i += 1) {
    const before = lane[Math.max(0, i - 1)];
    const after = lane[Math.min(lane.length - 1, i + 1)];
    const [x, y] = xy(lane[i][0], lane[i][1]);
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const bearing = Math.atan2(-ay + by, ax - bx);
    labels.push(bikeCrossingBreakAt(x, -y, bearing, 0.2, ownWay) ? "crossing" : "lane");
    if (i) {
      const [px, py] = xy(lane[i - 1][0], lane[i - 1][1]);
      spans.push(spans[i - 1] + Math.hypot(x - px, y - py));
    }
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

function addBikeLaneMarkings(way, renderPoints, roadWidth, roadTop) {
  const sides = cyclewaySides(way);
  if (!sides.length || roadWidth < BIKE_LANE_M + 2.2) return;
  for (const side of sides) {
    const offset = bikeLaneOffset(roadWidth, way, side);
    const centre = offsetWay(renderPoints, side * offset);
    if (!centre || centre.length < 2) continue;
    const [sx, sy] = xy(centre[0][0], centre[0][1]);
    const [ex, ey] = xy(centre[centre.length - 1][0], centre[centre.length - 1][1]);
    const joinStart = bikeLaneJoinTarget(sx, -sy, ...laneEndDirection(centre, true));
    const joinEnd = bikeLaneJoinTarget(ex, -ey, ...laneEndDirection(centre, false));
    const cutStart = joinStart ? 0 : BIKE_END_TRIM_M;
    const cutEnd = joinEnd ? 0 : BIKE_END_TRIM_M;
    let lane = densifyWay(trimWayEnds(centre, cutStart, cutEnd), 2.0);
    if (lane.length < 2) continue;
    if (joinStart) lane = blendLaneEnd(lane, joinStart, true);
    if (joinEnd) lane = blendLaneEnd(lane, joinEnd, false);

    for (const run of bikeLaneZones(lane, way)) {
      if (run.label === "crossing") {
        // No lane lines across a junction -- the lane has no priority there and painting its
        // edges through would say it did. San Francisco marks the gap with a crossbike instead.
        for (const dash of dashRuns(run.points, BIKE_CROSSBIKE_MARK_M, BIKE_CROSSBIKE_GAP_M)) {
          const block = ribbon(dash, BIKE_LANE_M, 0xffffff, 1.0, roadTop + 0.010, 0.012, "bike");
          if (block) addMerged("bike:fill", block, "bike");
        }
        continue;
      }
      const fill = ribbon(run.points, BIKE_LANE_M, 0xffffff, 1.0, roadTop + 0.010, 0.012, "bike");
      if (fill) addMerged("bike:fill", fill, "bike");
      // Both edges, every metre of the way, whether or not there is green under them: the lines
      // are the lane and the colour is a treatment on top of it.
      const outer = paintedLine(offsetWay(run.points, side * bikePaintEdgeOffset(BIKE_LANE_M)),
                                BIKE_EDGE_W_M, 0xf2f5ef, roadTop + 0.030);
      const innerPoints = offsetWay(run.points, -side * bikePaintEdgeOffset(BIKE_LANE_M));
      const inner = run.label === "mixing"
        ? paintedLine(densifyWay(innerPoints, BIKE_SKIP_M / 3), BIKE_EDGE_W_M, 0xf2f5ef,
                      roadTop + 0.032, { dash: true, dashM: BIKE_SKIP_M, gapM: BIKE_SKIP_GAP_M })
        : paintedLine(innerPoints, BIKE_EDGE_W_M, 0xf2f5ef, roadTop + 0.032);
      if (outer) addMerged("bike:edge", outer, "marking");
      if (inner) addMerged("bike:edge", inner, "marking");
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

