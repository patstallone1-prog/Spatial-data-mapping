// ---- keeping things where they belong ----
//
// A rule the renderer did not have. Pavement belongs on the footway and paint belongs on the
// carriageway, and nothing was checking: an apron aimed by the wrong bearing laid concrete
// across an intersection, and it read as sidewalk squares scattered over the road. Every
// street's centreline and half-width goes into a grid once, and anything meant for the
// pavement asks before it is placed.
const CARRIAGEWAY_CELL = 30;
const carriagewayGrid = new Map();
const MIN_RENDER_ROAD_M = 2.8;
//: Widths a service road is drawn at when nothing measured it. A driveway is one car wide; a
//: parking aisle outside any mapped lot is two, so cars pass; an access road -- a service way
//: with no name and no service tag, the way into a car park -- is two cars, tight. Alleys keep
//: the street default.
const SERVICE_ROAD_M = { driveway: 3.4, "drive-through": 3.4, parking_aisle: 6.0, access: 5.0 };
//: And none of them has a footway down each side or paint down the middle. A driveway runs
//: from the kerb to a garage across the pavement; a parking aisle runs between two rows of
//: stalls. Drawn as streets they each grew two pavements and a yellow centreline.
const UNMARKED_SERVICE = new Set(Object.keys(SERVICE_ROAD_M));
function isUnmarkedService(way) { return UNMARKED_SERVICE.has(way.service); }
//: A tunnel that is a ramp under a building -- the Transbay bus ramps, a car park's entrance
//: going underground -- has nothing at the surface and is drawn nowhere. A road tunnel has a
//: mouth at each end, and that is what is drawn of it.
function isUndergroundWay(way) { return way.tunnel_kind === "underground"; }
function isRoadTunnel(way) { return way.tunnel_kind === "road"; }
//: A street beneath a building -- 1st Street under the Transbay transit centre -- is a street:
//: it has kerbs, pavement and corners, and nothing at its ends. Only a bore through a hill or
//: a ramp going underground is a tunnel to the rest of the model.
function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }
//: How far into the hill a road tunnel's bore is drawn from each mouth before it goes dark:
//: the portal gallery. Looking in from the street this is what is lit; the rest is under the
//: hill, where the camera cannot go, and the model is flat, so it is not drawn -- and the
//: street on the hill above it (Stockton Street runs over its own tunnel) is drawn at the
//: same level, which is the flat model's limit. Declared here because the carriageway grid,
//: built long before the tunnels are drawn, keeps only these stubs.
const TUNNEL_STUB_M = 9.0;
//: The hill at a mouth is drawn this far in at most: as far as the bore takes to get under the
//: flat ground (TUNNEL_RAMP_M below); less where a surface street crosses over it sooner,
//: since the flat model draws that street at grade.
const TUNNEL_STUB_MAX_M = 60.0;
//: The portal's width is read off the city's kerb lines on the approach, this far outside the
//: mouth, where the walls of the cut are. Declared here because the approach pieces are
//: aligned to the same reading before the streets are recentred.
const TUNNEL_APPROACH_FROM_M = 4.0;
const TUNNEL_APPROACH_TO_M = 30.0;
const MAX_RENDER_ROAD_M = 24.0;
const MAX_INFERRED_ROAD_M = 16.5;
const MIN_RENDER_WALK_M = 0.9;
const MAX_RENDER_WALK_M = 5.5;

function laneCountForWay(way) {
  const oneway = onewaySign(way) !== 0;
  const tagged = way.lanes || 0;
  const forward = way.lanes_fwd || (oneway ? tagged : Math.floor(tagged / 2));
  const backward = way.lanes_back || (oneway ? 0 : Math.floor(tagged / 2));
  return oneway ? (forward || tagged || 0)
    : (way.lanes_fwd || way.lanes_back ? (forward || 0) + (backward || 0) : tagged);
}

//: Road widths that came from the city's kerb lines, one way or another.
const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half", "tunnel_cut", "curb_profile", "lidar_profile"]);

function nominalRoadWidth(way) {
  // Keep official width metadata intact, but render one OSM way as one carriageway.
  // Broad right-of-way fallbacks and divided street matches otherwise turn a single mapped
  // way into a plaza-wide slab, which is what covers sidewalks/streets at curved junctions.
  // The 3.3 m class prior for access lanes was defeating the 5 m service
  // fallback, leaving vehicle approaches (including a fire station's) narrow.
  const raw = way.service === "access" && way.road_source === "class_prior"
    ? Math.max(way.road_m || 0, SERVICE_ROAD_M.access) : (way.road_m || 8.0);
  const lanes = laneCountForWay(way);
  // The lane cap reins in a width that was inferred from the right of way. A width measured
  // between the mapped kerbs is not that: Grant Avenue through Chinatown is 7.36 m kerb to
  // kerb and tagged lanes=1, because the other four metres are parked cars, and capped to one
  // lane it was drawn 4.75 m wide -- with the pavement laid from that kerb reaching a metre
  // and a third into the roadway, past the ends of the crossings, as a tongue at every corner.
  // Measured is measured: the kerb envelope read along the way (official_curbs, divided_half)
  // as much as the city's own kerb-to-kerb record. The lane cap once reined in Vallejo,
  // Union and Green Street from their measured 12-14 m to 8.1 because only one label counted.
  const measured = way._spans !== undefined || MEASURED_ROAD_SOURCES.has(way.road_source);
  const laneCap = lanes && !measured
    ? Math.max(4.2, lanes * 3.35 + 1.4, way.service === "access" ? SERVICE_ROAD_M.access : 0)
    : MAX_RENDER_ROAD_M;
  const sourceCap = measured ? MAX_RENDER_ROAD_M : MAX_INFERRED_ROAD_M;
  // A driveway or a parking aisle has no right of way of its own to fall back on: the eight
  // metre default is a street's, and drawn that wide beside a house it is the front garden.
  const serviceCap = SERVICE_ROAD_M[way.service] || Infinity;
  return Math.max(MIN_RENDER_ROAD_M, Math.min(raw, laneCap, sourceCap, serviceCap));
}

function renderedRoadWidth(way) {
  // A street may not be drawn wider than the room it has.
  //
  // Widths come from the recorded right of way where the kerbs were not surveyed, and a right
  // of way is the whole street -- footways, setbacks and all. Drawn as carriageway it reaches
  // past its own kerb and over whatever is next to it, and what is next to it is very often
  // another street: an alley inside the block, a service road beside an avenue, the second
  // half of a divided road. Trenton Street's pavement sat four metres inside a neighbour's
  // carriageway; Van Ness's sat inside its own twin. Nothing was wrong with the pavement.
  //
  // So no carriageway extends more than halfway to the next street's centreline. That is the
  // same rule a surveyor would use to divide a shared right of way, it needs no new data, and
  // it is computed once per way rather than per frame.
  if (way._renderRoadM === undefined) way._renderRoadM = nominalRoadWidth(way);
  return way._renderRoadM;
}

//: A neighbouring carriageway runs within this angle of the way it makes room for.
const NEIGHBOUR_PARALLEL_DEG = 30;

function segmentRunsAlongside(px, pz, bearing, other) {
  // Does this segment lie beside the point, running the same way? A cross street meets the way
  // at a junction and is not beside it; the same street carrying on is met at its endpoint.
  const [ax, az, bx, bz] = other;
  const dx = bx - ax;
  const dz = bz - az;
  const length2 = dx * dx + dz * dz;
  if (length2 < 1e-9) return false;
  let turn = Math.abs(Math.atan2(dz, dx) - bearing) % Math.PI;
  turn = Math.min(turn, Math.PI - turn);
  if (turn > (NEIGHBOUR_PARALLEL_DEG * Math.PI) / 180) return false;
  const t = ((px - ax) * dx + (pz - az) * dz) / length2;
  return t > 0.02 && t < 0.98;
}

//: Two ways are on the same level when neither is under or over the other: same OpenStreetMap
//: layer, and both tunnels or neither.
function sameLevel(a, b) {
  return (a.layer || 0) === (b.layer || 0) && isTunnelWay(a) === isTunnelWay(b)
    && Boolean(a.bridge) === Boolean(b.bridge);
}

//: Room a carriageway has between the buildings either side of it: twice the nearer facade
//: less a footway, at the tightest of a few stations. Null where no building faces the way.
const FACADE_ROOM_WALK_M = 1.4;
function roomBetweenFacades(way) {
  if (!footprintGrid.size || !way.points || way.points.length < 2) return null;
  const dense = densifyWay(way.points, 12);
  let tightest = null;
  for (let i = 1; i + 1 < dense.length; i += 1) {
    const [px, py] = xy(dense[i - 1][0], dense[i - 1][1]);
    const [x, y] = xy(dense[i][0], dense[i][1]);
    const [qx, qy] = xy(dense[i + 1][0], dense[i + 1][1]);
    const dx = qx - px, dz = -(qy - py);
    const span = Math.hypot(dx, dz) || 1;
    const nx = dz / span, nz = -dx / span;
    const left = rayFootprintDistance(x, -y, nx, nz, 30);
    const right = rayFootprintDistance(x, -y, -nx, -nz, 30);
    if (left === null || right === null) continue;
    const room = 2 * (Math.min(left, right) - FACADE_ROOM_WALK_M);
    if (tightest === null || room < tightest) tightest = room;
  }
  return tightest;
}

function clampRoadWidthsToNeighbours(ways) {
  const CELL = 40;
  const grid = new Map();
  const streets = ways.filter((w) => w.kind === "street" && w.points && w.points.length > 1
    && !isUndergroundWay(w));
  const segments = [];
  for (const way of streets) {
    way._renderRoadM = nominalRoadWidth(way);
    for (let i = 1; i < way.points.length; i += 1) {
      const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
      const [bx, by] = xy(way.points[i][0], way.points[i][1]);
      const seg = [ax, -ay, bx, -by, way];
      segments.push(seg);
      const x0 = Math.floor(Math.min(ax, bx) / CELL);
      const x1 = Math.floor(Math.max(ax, bx) / CELL);
      const z0 = Math.floor(Math.min(-ay, -by) / CELL);
      const z1 = Math.floor(Math.max(-ay, -by) / CELL);
      for (let ix = x0 - 1; ix <= x1 + 1; ix += 1) {
        for (let iz = z0 - 1; iz <= z1 + 1; iz += 1) {
          const key = `${ix}:${iz}`;
          let bucket = grid.get(key);
          if (!bucket) grid.set(key, bucket = []);
          bucket.push(seg);
        }
      }
    }
  }
  // The nearest other centreline running alongside each way, sampled along it.
  //
  // Alongside is the whole of it. This used to take the nearest other segment of any kind,
  // skipping only what was under three metres away, and the nearest segment to a point a few
  // metres along a way is nearly always the cross street at the junction it just left -- or
  // the same street carrying on beyond it, met at its endpoint. So every leg of every junction
  // was clamped to however far its first sample stood from the node: Grant Avenue, measured
  // between its kerbs at 7.36 m, was drawn 4.75 m wide out of Clay Street, and the pavement
  // laid from that kerb reached a metre and a third into the roadway and across the ends of
  // the crossing. A neighbour is a segment that runs beside this one: roughly parallel, with
  // its nearest point in its interior rather than at an end.
  const nearest = new Map();
  for (const [ax, az, bx, bz, way] of segments) {
    const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 8));
    const ownBearing = Math.atan2(bz - az, bx - ax);
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const ix = Math.floor(px / CELL);
      const iz = Math.floor(pz / CELL);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(`${ix + dx}:${iz + dz}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other[4] === way) continue;
            // A street on another level is not beside this one: Stockton Street on the hill
            // squeezed the Stockton Tunnel under it to 6.5 m. Nor is the same street carrying
            // on, split at a driveway node and drawn a metre off its own line.
            if (!sameLevel(way, other[4]) || (way.name && other[4].name === way.name)) continue;
            if (!segmentRunsAlongside(px, pz, ownBearing, other)) continue;
            const d = Math.sqrt(distanceToSegmentSquared(px, pz, other[0], other[1],
                                                         other[2], other[3]));
            // Under three metres is a way drawn on top of another, not a neighbour to make
            // room for; clamping to that would erase the street.
            if (d < 3.0) continue;
            const best = nearest.get(way);
            if (best === undefined || d < best) nearest.set(way, d);
          }
        }
      }
    }
  }
  let clamped = 0;
  for (const way of streets) {
    // A way drawn between the city's kerbs has its room measured; nothing clamps it.
    if (way._spans !== undefined) continue;
    // The approach outside a tunnel mouth is the cut between its retaining walls, measured
    // (alignTunnelApproaches); the streets on the hill above it are not its neighbours.
    if (way.road_source === "tunnel_cut") continue;
    // With no kerb to draw between, the building line is the next best evidence: a roadway
    // never runs through the houses either side of it. Genoa Place carried a 14.9 m right
    // of way between facades 6 m apart, and its pavement was laid through the buildings.
    // Not under a hill or a building: the houses over a tunnel are not beside it.
    const facadeRoom = isTunnelWay(way) || (way.layer || 0) !== 0 ? null : roomBetweenFacades(way);
    if (facadeRoom !== null && facadeRoom < way._renderRoadM) {
      way._renderRoadM = Math.max(MIN_RENDER_ROAD_M, facadeRoom);
      way.road_facade_clamped = true;
      clamped += 1;
    }
    const gap = nearest.get(way);
    if (gap === undefined) continue;
    // A street that says how many lanes it has does not get clamped below them. An avenue with
    // a service alley four metres off its kerb still has four lanes on it, and the alley is the
    // thing that is close, not the avenue that is wide.
    const lanes = laneCountForWay(way);
    const floor = Math.max(MIN_RENDER_ROAD_M, lanes ? lanes * 3.0 : 0);
    const room = Math.max(floor, gap);
    if (room < way._renderRoadM) {
      way._renderRoadM = room;
      clamped += 1;
    }
  }
  return clamped;
}

function renderedWalkWidth(way, fallback = 3.0) {
  const raw = way.walk_m || way.walk_fallback_m || fallback;
  return Math.max(MIN_RENDER_WALK_M, Math.min(raw, MAX_RENDER_WALK_M));
}

function addCarriagewaySegment(ax, az, bx, bz, half, source = null) {
  // The bearing rides along with the segment. Asking whether a point is on a roadway is not the
  // same question as asking whether it is in a junction: a bike lane is inside its own
  // carriageway for its whole length, and what marks the crossroads is a carriageway lying
  // across it rather than along it.
  const bearing = Math.atan2(bz - az, bx - ax);
  const minX = Math.floor((Math.min(ax, bx) - half) / CARRIAGEWAY_CELL);
  const maxX = Math.floor((Math.max(ax, bx) + half) / CARRIAGEWAY_CELL);
  const minZ = Math.floor((Math.min(az, bz) - half) / CARRIAGEWAY_CELL);
  const maxZ = Math.floor((Math.max(az, bz) + half) / CARRIAGEWAY_CELL);
  for (let ix = minX; ix <= maxX; ix += 1) {
    for (let iz = minZ; iz <= maxZ; iz += 1) {
      // A number, not a string: this grid is asked millions of times while the city is built.
      const key = ix * 1048576 + iz;
      let bucket = carriagewayGrid.get(key);
      if (!bucket) carriagewayGrid.set(key, bucket = []);
      bucket.push([ax, az, bx, bz, half, bearing, source]);
    }
  }
}

// ---- the street where the city's kerbs say it is ----
//
// OpenStreetMap's centreline is a line somebody drew down the middle of the road as they saw
// it, and along Grant Avenue through Chinatown it runs 1.75 m west of the middle of the road
// the city surveyed. Everything laid from that line -- the carriageway, the kerb, the pavement,
// the corners -- was 1.75 m west of where it stands, so the pavement corner on one side stood
// in the roadway past the end of the crossing, as a tongue, and on the other the road ran
// under the pavement. The crossings were right, because they were already read off the city's
// curb lines. Now the street is too: each way is moved sideways to the middle of the official
// kerbs it runs between, by one offset for the whole way (the median of its stations, which a
// street that is straight relative to its kerbs has), and where the kerbs were only inferred
// the width becomes the measured one.
//: Two street ways whose ends meet within this and run within STREET_JOIN_DEG of each other are
//: one street carrying on, not a junction. Declared here because a short way inherits its
//: recentring from the way that carries on from it.
const STREET_JOIN_M = 3.0;
const STREET_JOIN_DEG = 34.0;
//: Stations this far from a way's end are not asked: the ray would cross a curb return.
const RECENTRE_END_MARGIN_M = 8.0;
const RECENTRE_STATION_M = 4.0;
//: The stations have to agree: above this spread they are not one street between two kerbs.
const RECENTRE_MAX_SPREAD_M = 0.5;
//: And a move this large is not a recentring, it is a different street.
const RECENTRE_MAX_SHIFT_M = 4.0;
const RECENTRE_MIN_SHIFT_M = 0.12;

function officialKerbOffsetsAt(x, z, nx, nz, road) {
  // The kerb on each side, as signed distances along the left normal, or null.
  const reach = Math.min(30, road * 1.3 + 5);
  const hits = rayCurbIntersections(x, z, nx, nz, reach, officialCurbGrid);
  const negative = hits.filter((v) => v < -1.2).pop();
  const positive = hits.find((v) => v > 1.2);
  if (negative === undefined || positive === undefined) return null;
  const span = positive - negative;
  // The pair has to be this street's own two kerbs: a plausible width, roughly balanced.
  if (span < 3.0 || span > 30.0 || -negative > positive * 3.0 || positive > -negative * 3.0) {
    return null;
  }
  return { offset: (positive + negative) / 2, span };
}

//: Half of a divided road: a one-way way that OpenStreetMap says has a footway on one side
//: only -- and whose other half is there, running the other way beside it. The footway test
//: alone called every one-way street with one mapped sidewalk a half of something: Clay,
//: Bush, Geary, Pine, Leavenworth, drawn as wide as their lanes with the "median" side open,
//: which was most of the divided_half bucket's 3 m tail. The twin is found once, before the
//: kerb envelope is read (indexDividedTwins); a way not yet indexed keeps the footway test.
const DIVIDED_TWIN_MIN_M = 4.0;
const DIVIDED_TWIN_MAX_M = 40.0;

function isDividedHalf(way) {
  if (!(onewaySign(way) !== 0 && Array.isArray(way.walk_sides)
        && way.walk_sides.length === 1)) return false;
  return way._twin === undefined ? true : way._twin;
}

function indexDividedTwins(ways) {
  const oneways = ways.filter((w) => w.kind === "street" && w.points && w.points.length >= 2
    && onewaySign(w) !== 0);
  // A nameless one-way way has no twin to find: it is a link, not half of a street.
  for (const w of oneways) w._twin = false;
  const halves = oneways.filter((w) => w.name);
  const byName = new Map();
  for (const w of halves) {
    if (!byName.has(w.name)) byName.set(w.name, []);
    byName.get(w.name).push(w);
  }
  const local = new Map();
  const frameOf = (w) => {
    if (!local.has(w)) local.set(w, w.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; }));
    return local.get(w);
  };
  let twins = 0;
  for (const w of halves) {
    w._twin = false;
    const pa = frameOf(w);
    const ua = [pa[pa.length - 1][0] - pa[0][0], pa[pa.length - 1][1] - pa[0][1]];
    const la = Math.hypot(ua[0], ua[1]) || 1;
    for (const other of byName.get(w.name)) {
      if (other === w) continue;
      const pb = frameOf(other);
      const ub = [pb[pb.length - 1][0] - pb[0][0], pb[pb.length - 1][1] - pb[0][1]];
      const lb = Math.hypot(ub[0], ub[1]) || 1;
      if ((ua[0] * ub[0] + ua[1] * ub[1]) / (la * lb) > -0.85) continue;   // not opposite ways
      // The other half runs beside this one: its middle is a road's width away, alongside.
      const mid = pb[Math.floor(pb.length / 2)];
      let best = Infinity;
      for (let i = 1; i < pa.length; i += 1) {
        const d = Math.sqrt(distanceToSegmentSquared(mid[0], mid[1], pa[i - 1][0], pa[i - 1][1], pa[i][0], pa[i][1]));
        if (d < best) best = d;
      }
      if (best >= DIVIDED_TWIN_MIN_M && best <= DIVIDED_TWIN_MAX_M) { w._twin = true; twins += 1; break; }
    }
  }
  return twins;
}

//: A divided half's carriageway is as wide as its lanes; it has no kerb-to-kerb width of its
//: own, since the city's kerbs are the whole street's, and the right of way is the whole
//: street's too. Broadway east of Polk, two ways of two lanes each, had each half at the full
//: 11.85 m the right of way left over -- and the northern half's kerb 2.3 m out in the road.
function dividedHalfWidth(way) {
  const lanes = laneCountForWay(way);
  return lanes ? Math.max(4.2, lanes * 3.35 + 1.4) : Math.min(way.road_m || 8.0, 8.0);
}

//: How far along the way a station may stand from a vertex and still speak for it.
const RECENTRE_VERTEX_REACH_M = 12.0;
//: A way's vertices are no further apart than this before its kerb envelope is read, so a
//: turn pocket or a bulb-out forty metres from the nearest OpenStreetMap vertex is followed
//: rather than averaged away.
const ENVELOPE_VERTEX_M = 24.0;
//: An edge nearer the centreline than this is the centreline's own noise, not a kerb. Half a
//: lane: OpenStreetMap draws a three-metre alley's line a metre off its middle.
const ENVELOPE_MIN_EDGE_M = 0.6;
//: Ophir Alley is 2.9 m between its kerbs, and it is a street.
const ENVELOPE_MIN_SPAN_M = 2.4;
//: Stations within reach of one vertex may disagree by this much and still be one kerb: a
//: taper over the twelve metres either side of a vertex moves the middle by a metre.
const ENVELOPE_MAX_SPREAD_M = 0.9;
//: The shortest way whose envelope is read; below it there is no room for stations clear of
//: both curb returns.
const ENVELOPE_MIN_WAY_M = 10.0;
//: A recorded right of way this many times wider than the kerbs the way actually runs between
//: was matched to some other street's record: an alley given the avenue's width.
const ROW_MISMATCH_FACTOR = 2.0;
//: Where the record and the kerbs disagree by more than this, the kerbs win the label too.
const ENVELOPE_RELABEL_M = 1.0;

//: How many rays either side of a station say a kerb is there. For a divided half only the
//: footway side is an outer kerb: the median side is an island kerb, or where the city drew
//: none, the width the lanes say.
function envelopeEdgesAt(x, z, nx, nz, way, reach) {
  const kerbs = rayCurbIntersections(x, z, nx, nz, reach, officialCurbGrid);
  const oneway = onewaySign(way) !== 0;
  const islands = rayCurbIntersections(x, z, nx, nz, reach, officialIslandCurbGrid);
  const neg = (list) => list.filter((v) => v < -ENVELOPE_MIN_EDGE_M).pop();
  const pos = (list) => list.find((v) => v > ENVELOPE_MIN_EDGE_M);
  if (isDividedHalf(way)) {
    const side = way.walk_sides[0];
    const kerb = side > 0 ? pos(kerbs) : neg(kerbs);
    if (kerb === undefined) return null;
    // The inner edge: the city's island kerb, or the median the lidar measured (a raised
    // one is an island line too; a painted centre is a median line), or the lanes' width.
    const inner = islands.concat(officialMedianGrid.size
      ? rayCurbIntersections(x, z, nx, nz, reach, officialMedianGrid) : []).sort((p, q) => p - q);
    const island = side > 0 ? inner.filter((v) => v < kerb - 2.5 && v > -14).pop()
      : inner.find((v) => v > kerb + 2.5 && v < 14);
    if (island !== undefined) return side > 0 ? [island, kerb] : [kerb, island];
    const width = dividedHalfWidth(way);
    return side > 0 ? [kerb - width, kerb] : [kerb, kerb + width];
  }
  // Balance is judged more loosely on a narrow roadway, where a metre off the middle is a
  // third of the width.
  const plausible = (a, b, ratio) => a !== undefined && b !== undefined
    && b - a >= ENVELOPE_MIN_SPAN_M && b - a <= 30.0
    && -a <= b * Math.max(ratio, b - a < 5 ? 5 : 0) && b <= -a * Math.max(ratio, b - a < 5 ? 5 : 0);
  // Islands bound a one-way carriageway outright. A two-way street runs kerb to kerb -- a
  // refuge in its middle is drawn on it as the raised thing it is -- unless the "islands"
  // are a pair standing symmetrically either side of it a lane apart, which is not a refuge
  // but the kerbs of a narrow roadway inside a wide right of way: Broadway on the hill over
  // its own tunnel, 5.3 m between the walls the city files as islands, 28 m between the
  // outer kerbs of the cut.
  const all = kerbs.concat(islands).sort((p, q) => p - q);
  const a = neg(all), b = pos(all);
  if (oneway) {
    // The centreline of a one-way lane of a divided street is drawn off-centre on purpose,
    // and gets more room. An island kerb almost under the line is the lane's own edge, not
    // the line's noise: OpenStreetMap draws the Van Ness BRT lanes along the platform edge,
    // and skipping that edge read the whole avenue as the lane.
    const ENVELOPE_MIN_ISLAND_M = 0.15;
    const ia = islands.filter((v) => v < -ENVELOPE_MIN_ISLAND_M && v >= -ENVELOPE_MIN_EDGE_M).pop();
    const ib = islands.find((v) => v > ENVELOPE_MIN_ISLAND_M && v <= ENVELOPE_MIN_EDGE_M);
    const a1 = ia !== undefined ? ia : a, b1 = ib !== undefined ? ib : b;
    if (a1 !== undefined && b1 !== undefined && b1 - a1 >= ENVELOPE_MIN_SPAN_M && b1 - a1 <= 30.0
        && (ia !== undefined || ib !== undefined)) return [a1, b1];
    return plausible(a, b, 6.0) ? [a, b] : null;
  }
  // The island pair is judged as loosely as a one-way lane: OpenStreetMap's line for the
  // street on the hill over the Broadway tunnel runs 1.6 m from one wall and 6.4 m from the
  // other, and at the stricter ratio the walls were rejected and the 28 m cut taken instead.
  if (plausible(a, b, 6.0) && b - a >= 4.2 && (a !== neg(kerbs) || b !== pos(kerbs))) return [a, b];
  const ka = neg(kerbs), kb = pos(kerbs);
  return plausible(ka, kb, 3.0) ? [ka, kb] : null;
}

function recentreOnKerbEnvelope(way) {
  // The kerb envelope: at each vertex, where this street's two edges stand either side of
  // the centreline according to the city's kerb lines. The way is moved onto the middle of
  // them vertex by vertex and drawn as wide as they are at each point. This is the one
  // source of carriageway edges; the recorded right of way, the lane count and the room to
  // the next street are fallbacks for where the city drew no kerb.
  //
  // One offset for the whole way was the rule for a street between two kerbs, and it was
  // right where the kerbs are parallel; a divided half's outer kerb is not parallel to the
  // median it was drawn along, a turn pocket opens over forty metres, and a bulb-out steps
  // in near the corner -- so each vertex takes the offset and width of the stations around
  // it, where they agree.
  if (!way.points || way.points.length < 2) return false;
  // A busway's kerbs are the whole avenue's: it is its own lanes, in the middle of them.
  if (way.busway) return false;
  const length = wayLength(way.points);
  if (length < ENVELOPE_MIN_WAY_M) return false;
  // Clear of the curb returns at each end -- eight metres on a block, a quarter of the way
  // on a short connector between two junctions.
  const margin = Math.min(RECENTRE_END_MARGIN_M, length * 0.25);
  // Closer stations on a short way, so each vertex has a few within reach of it.
  const station = length < 60 ? RECENTRE_STATION_M / 2 : RECENTRE_STATION_M;
  const points = length > ENVELOPE_VERTEX_M * 1.25 ? densifyWay(way.points, ENVELOPE_VERTEX_M) : way.points;
  const guess = way.road_m || 8.0;
  const reach = Math.min(30, Math.max(guess, dividedHalfWidth(way)) * 1.3 + 5);
  const stations = [];
  const dense = densifyWay(points, station);
  let along = 0;
  for (let i = 1; i < dense.length - 1; i += 1) {
    const [px, py] = xy(dense[i - 1][0], dense[i - 1][1]);
    const [x, y] = xy(dense[i][0], dense[i][1]);
    const [qx, qy] = xy(dense[i + 1][0], dense[i + 1][1]);
    along += Math.hypot(x - px, y - py);
    if (along < margin || along > length - margin) continue;
    const dx = qx - px;
    const dz = -(qy - py);
    const span = Math.hypot(dx, dz) || 1;
    // The left normal, in the x/z frame the kerb grid is indexed in.
    const edges = envelopeEdgesAt(x, -y, dz / span, -dx / span, way, reach);
    if (!edges) continue;
    stations.push([along, (edges[0] + edges[1]) / 2, edges[1] - edges[0]]);
  }
  if (stations.length < 3) return false;
  // Each vertex: the median of the stations within reach, if they agree.
  const offsets = [];
  const spans = [];
  let at = 0;
  for (let j = 0; j < points.length; j += 1) {
    if (j > 0) {
      const [ax, ay] = xy(points[j - 1][0], points[j - 1][1]);
      const [bx, by] = xy(points[j][0], points[j][1]);
      at += Math.hypot(bx - ax, by - ay);
    }
    const nearby = stations.filter(([s]) => Math.abs(s - at) <= RECENTRE_VERTEX_REACH_M);
    const near = nearby.map(([, o]) => o).sort((p, q) => p - q);
    const widths = nearby.map(([, , w]) => w).sort((p, q) => p - q);
    if (near.length < 2) { offsets.push(null); spans.push([at, null]); continue; }
    const spread = near[Math.floor(near.length * 0.75)] - near[Math.floor(near.length * 0.25)];
    const median = near[Math.floor(near.length / 2)];
    const agreed = spread <= ENVELOPE_MAX_SPREAD_M;
    offsets.push(!agreed ? null
      : Math.max(-RECENTRE_MAX_SHIFT_M, Math.min(RECENTRE_MAX_SHIFT_M, median)));
    spans.push([at, agreed ? widths[Math.floor(widths.length / 2)] : null]);
  }
  if (offsets.filter((o) => o !== null).length < Math.min(2, points.length)) return false;
  // A vertex with no reading of its own carries its nearest neighbour's.
  for (let j = 0; j < spans.length; j += 1) {
    if (spans[j][1] !== null) continue;
    for (let k2 = 1; k2 < spans.length; k2 += 1) {
      const candidate = (spans[j - k2] || [])[1] ?? (spans[j + k2] || [])[1];
      if (candidate !== null && candidate !== undefined) { spans[j][1] = candidate; break; }
    }
  }
  const known = offsets.slice();
  for (let j = 0; j < offsets.length; j += 1) {
    if (known[j] !== null) continue;
    for (let k = 1; k < offsets.length; k += 1) {
      const candidate = known[j - k] ?? known[j + k];
      if (candidate !== null && candidate !== undefined) { offsets[j] = candidate; break; }
    }
  }
  way._spans = spans;
  way._node = [way.points[0].slice(), way.points[way.points.length - 1].slice()];
  way._shift = [offsets[0], offsets[offsets.length - 1]];
  way.points = offsets.some((o) => Math.abs(o) >= RECENTRE_MIN_SHIFT_M)
    ? offsetWay(points, offsets) : points;
  if (offsets.some((o) => Math.abs(o) >= RECENTRE_MIN_SHIFT_M)) {
    way.recentred_m = +Math.max(...offsets.map(Math.abs)).toFixed(3);
  }
  const sorted = spans.map(([, w]) => w).sort((p, q) => p - q);
  const envelope = +sorted[Math.floor(sorted.length / 2)].toFixed(3);
  const recorded = way.road_m;
  if (recorded && way.road_source === "row_minus_footways"
      && recorded > envelope * ROW_MISMATCH_FACTOR + 2.0) {
    // Brant Alley carried a 27.7 m right of way between kerbs 4 m apart: the centreline
    // index matched it to the avenue it leaves from. The record is not this street's.
    way.road_record_rejected = recorded;
  }
  if (isDividedHalf(way)) {
    way.road_m = envelope;
    way.road_source = "divided_half";
  } else if (!recorded || way.road_source !== "curb_geometry"
             || Math.abs(recorded - envelope) > ENVELOPE_RELABEL_M) {
    if (recorded && way.road_source === "curb_geometry") way.road_record_m = recorded;
    way.road_m = envelope;
    way.road_source = "official_curbs";
  }
  return true;
}

function halfWidthAt(way, along) {
  // The uniform kerb draws every street at its own single width, so the carriageway does not
  // widen and narrow along the block the way the survey read it. The envelope stays on the way.
  if (KERB_RENDER_UNIFORM) return renderedRoadWidth(way) / 2;
  const spans = way && way._spans;
  if (!spans || spans.length < 2) return renderedRoadWidth(way) / 2;
  if (along <= spans[0][0]) return spans[0][1] / 2;
  for (let i = 1; i < spans.length; i += 1) {
    if (along <= spans[i][0]) {
      const [a0, w0] = spans[i - 1];
      const [a1, w1] = spans[i];
      const t = a1 > a0 ? (along - a0) / (a1 - a0) : 0;
      return (w0 + (w1 - w0) * t) / 2;
    }
  }
  return spans[spans.length - 1][1] / 2;
}

//: Distance along a polyline to each of its points, in metres.
function alongDistances(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = xy(points[i - 1][0], points[i - 1][1]);
    const [bx, by] = xy(points[i][0], points[i][1]);
    out.push(out[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  return out;
}

function recentreStreetsOnOfficialKerbs(ways) {
  if (!officialCurbGrid.size) return { moved: 0, widened: 0, inherited: 0 };
  let moved = 0;
  let widened = 0;
  for (const way of ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
    if (isUnmarkedService(way) || isTunnelWay(way)) continue;
    // The approach outside a mouth is already on the cut's midline at the cut's width
    // (alignTunnelApproaches); the cut's median kerb would read as one wall here.
    if (way.tunnel_approach) continue;
    const before = way.road_source;
    if (!recentreOnKerbEnvelope(way)) continue;
    if (way.recentred_m) moved += 1;
    if (way.road_source !== before || way.road_record_m) widened += 1;
  }
  const inherited = inheritRecentring(ways);
  return { moved, widened, inherited };
}

function inheritRecentring(ways) {
  const CELL = 4;
  const ends = new Map();
  const keyOf = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
  for (const way of ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 2 || !way._shift) continue;
    const n = way.points.length;
    for (const [end, next] of [[0, 1], [n - 1, n - 2]]) {
      const [x, y] = xy(way._node[end === 0 ? 0 : 1][0], way._node[end === 0 ? 0 : 1][1]);
      const [qx, qy] = xy(way.points[next][0], way.points[next][1]);
      const bearing = Math.atan2(qy - y, qx - x);          // into the way
      const shift = way._shift[end === 0 ? 0 : 1];
      // The shift is signed to the left of this way's travel; leaving the far end backwards
      // flips it, so a neighbour reads it against its own travel below.
      let bucket = ends.get(keyOf(x, y));
      if (!bucket) ends.set(keyOf(x, y), bucket = []);
      bucket.push({ x, y, bearing, shift: end === 0 ? shift : -shift, way });
    }
  }
  let inherited = 0;
  for (const way of ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 2 || way._shift) continue;
    if (isUnmarkedService(way) || isTunnelWay(way) || !way.name) continue;
    const n = way.points.length;
    const found = [];
    for (const [end, next] of [[0, 1], [n - 1, n - 2]]) {
      const [x, y] = xy(way.points[end][0], way.points[end][1]);
      const [qx, qy] = xy(way.points[next][0], way.points[next][1]);
      const bearing = Math.atan2(qy - y, qx - x);
      let best = null;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bucket = ends.get(`${Math.floor(x / CELL) + dx}:${Math.floor(y / CELL) + dy}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other.way === way || other.way.name !== way.name) continue;
            if (Math.hypot(other.x - x, other.y - y) > STREET_JOIN_M) continue;
            let turn = Math.abs(other.bearing - bearing) * 180 / Math.PI;
            turn = Math.abs(((turn + 180) % 360) - 180);
            if (Math.abs(turn - 180) > STREET_JOIN_DEG) continue;
            if (!best) best = other;
          }
        }
      }
      // The neighbour leaves the node the other way, so its leftward shift is this way's
      // rightward one at the start and its leftward one at the end.
      if (best) found.push(end === 0 ? -best.shift : best.shift);
    }
    if (!found.length) continue;
    if (found.length === 2 && Math.abs(found[0] - found[1]) > 1.0) continue;
    const shift = found.reduce((a, b) => a + b, 0) / found.length;
    way._node = [way.points[0].slice(), way.points[n - 1].slice()];
    way._shift = [shift, shift];
    if (Math.abs(shift) >= RECENTRE_MIN_SHIFT_M) {
      way.points = offsetWay(way.points, shift);
      way.recentred_m = +shift.toFixed(3);
      way.recentred_from = "neighbour";
      inherited += 1;
    }
  }
  return inherited;
}

// Which building is under the cursor, from the footprints rather than from the meshes.
//
// The meshes are merged now, so a ray that hits one comes back with "the buildings" rather than
// with a building. The footprints are the identity, they are already in the payload, and asking
// them is both cheaper than a raycast through fifteen thousand objects and more forgiving: a
// click on a roof lands inside the footprint under it, which is the building you meant.
const FOOTPRINT_CELL = 60;
const footprintGrid = new Map();
const IMMERSED_MOUTHS = (DATA.ways || []).filter((way) => way.tunnel_design?.kind === "immersed_tube")
  .flatMap((way) => [way.points?.[0], way.points?.[way.points.length - 1]]).filter(Boolean)
  .map(([lon, lat]) => xy(lon, lat));
for (const way of [...DATA.ways, ...PARK_STRUCTURES]) {
  if (way.kind !== "building" || !way.points || way.points.length < 4) continue;
  // The portal is not a house. Its arch is rendered by addTunnel; indexing it
  // as a solid home spawned an opaque door across the bore.
  if (mappedTubePortalBuilding(way)) continue;
  const local = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of local) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const entry = { way, local, minX, maxX, minZ, maxZ };
  for (let ix = Math.floor(minX / FOOTPRINT_CELL); ix <= Math.floor(maxX / FOOTPRINT_CELL); ix += 1) {
    for (let iz = Math.floor(minZ / FOOTPRINT_CELL); iz <= Math.floor(maxZ / FOOTPRINT_CELL); iz += 1) {
      const key = `${ix}:${iz}`;
      let bucket = footprintGrid.get(key);
      if (!bucket) footprintGrid.set(key, bucket = []);
      bucket.push(entry);
    }
  }
}

function insideFootprint(entry, x, z) {
  if (x < entry.minX || x > entry.maxX || z < entry.minZ || z > entry.maxZ) return false;
  let inside = false;
  const ring = entry.local;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z)
        && x < ((xj - xi) * (z - zi)) / ((zj - zi) || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function buildingAt(x, z) {
  const bucket = footprintGrid.get(`${Math.floor(x / FOOTPRINT_CELL)}:${Math.floor(z / FOOTPRINT_CELL)}`);
  if (!bucket) return null;
  for (const entry of bucket) if (insideFootprint(entry, x, z)) return entry.way;
  return null;
}


//: How far from a facade the pavement stops: the building's own threshold and step.
const FACADE_GAP_M = 0.3;
//: A pavement whose width was never surveyed may reach this far to meet the building line.
const WALK_TO_FACADE_MAX_M = 7.0;

function rayFootprintDistance(x, z, dx, dz, reach) {
  // The distance along the ray from (x, z) to the first building edge, or null. The ray is
  // walked cell by cell through the footprint grid and each footprint's edges are tested
  // exactly, so the answer is the facade line, not the nearest sample to it.
  let best = null;
  const seen = new Set();
  for (let t = 0; t <= reach; t += FOOTPRINT_CELL / 2) {
    const key = `${Math.floor((x + dx * t) / FOOTPRINT_CELL)}:${Math.floor((z + dz * t) / FOOTPRINT_CELL)}`;
    const bucket = footprintGrid.get(key);
    if (!bucket) continue;
    for (const entry of bucket) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      const ring = entry.local;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [ax, az] = ring[j];
        const [bx, bz] = ring[i];
        const sx = bx - ax, sz = bz - az;
        const denominator = dx * sz - dz * sx;
        if (Math.abs(denominator) < 1e-9) continue;
        const qx = ax - x, qz = az - z;
        const alongRay = (qx * sz - qz * sx) / denominator;
        const alongEdge = (qx * dz - qz * dx) / denominator;
        if (alongEdge < 0 || alongEdge > 1 || alongRay < 0.05 || alongRay > reach) continue;
        if (best === null || alongRay < best) best = alongRay;
      }
    }
  }
  return best;
}


//: The open approach outside a tunnel mouth (split_tunnel_approaches) is a piece of the
//: tunnel's OpenStreetMap way, which for Broadway is the westbound bore's own line, 6 m off
//: the axis of the cut; drawn about that line at the way's recorded width the approach road
//: ran up the north wall and its pavement stood across the mouth of the south bore. The
//: approach is moved onto the midline of the cut the city's kerb lines draw outside the
//: mouth, and made as wide as the cut, the same reading the portal itself is built from
//: (tunnelApproach).
function alignTunnelApproaches(ways) {
  let aligned = 0;
  for (const way of ways) {
    if (!way.tunnel_approach || !way.points || way.points.length < 2) continue;
    const local = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
    // The mouth is the end that touches the bore: the last point of a "start" approach, the
    // first of an "end" one. Outward runs from the mouth along the approach.
    const [m, n] = way.tunnel_approach === "start"
      ? [local[local.length - 1], local[local.length - 2]] : [local[0], local[1]];
    const dx = n[0] - m[0], dz = n[1] - m[1];
    const len = Math.hypot(dx, dz) || 1;
    // tunnelApproach measures to the left of inward travel; inward here is -outward, and the
    // way runs outward for an "end" approach and inward for a "start" one.
    const found = tunnelApproach({ x: m[0], z: m[1] }, { x: dx / len, z: dz / len });
    if (!found) continue;
    const left = way.tunnel_approach === "end" ? -found.left : found.left;
    if (Math.abs(left) > 0.3) way.points = offsetWay(way.points, left);
    way.road_m = found.width;
    way.road_source = "tunnel_cut";
    way.tunnel_cut_shift_m = +left.toFixed(2);
    aligned += 1;
  }
  return aligned;
}
alignTunnelApproaches(DATA.ways);
indexDividedTwins(DATA.ways);

const recentred = recentreStreetsOnOfficialKerbs(DATA.ways);

// ---- bends ----
//
// OpenStreetMap draws a curving street as a few straight pieces meeting at an angle, and
// everything laid from that line -- kerb, pavement, paint, the strips between kerbs -- met at
// the same angle: a corner in the kerb where the road bends round Yacht Road and the
// Embarcadero. A bend of up to FILLET_MAX_DEG at a vertex inside a way is a curve, and it is
// drawn as one: the vertex becomes an arc tangent to both legs. A sharper angle is a corner
// and stays one; the ends of a way are junctions and are never moved.
const FILLET_MIN_DEG = 8.0;
const FILLET_MAX_DEG = 70.0;
const FILLET_LEG_MAX_M = 8.0;
const FILLET_STEP_M = 1.5;

function filletBends(points) {
  if (!points || points.length < 3) return points;
  const local = points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, y]; });
  const out = [points[0]];
  for (let i = 1; i + 1 < local.length; i += 1) {
    const [ax, ay] = local[i - 1];
    const [x, y] = local[i];
    const [bx, by] = local[i + 1];
    const l1 = Math.hypot(x - ax, y - ay), l2 = Math.hypot(bx - x, by - y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1 = [(x - ax) / l1, (y - ay) / l1], u2 = [(bx - x) / l2, (by - y) / l2];
    const turn = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))) * 180 / Math.PI;
    if (turn < FILLET_MIN_DEG || turn > FILLET_MAX_DEG || l1 < 3 || l2 < 3) { out.push(points[i]); continue; }
    const d = Math.min(l1 / 2.5, l2 / 2.5, FILLET_LEG_MAX_M);
    const p0 = [x - u1[0] * d, y - u1[1] * d];
    const p2 = [x + u2[0] * d, y + u2[1] * d];
    const steps = Math.max(3, Math.ceil((2 * d) / FILLET_STEP_M));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      // A quadratic Bezier through the legs' ends with the vertex as its control point:
      // tangent to both legs, and never further from the vertex than the legs are.
      const qx = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * x + t * t * p2[0];
      const qy = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * y + t * t * p2[1];
      out.push(lonLatFromXZ(qx, -qy));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function filletStreetBends(ways) {
  let bent = 0;
  for (const way of ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 3 || isTunnelWay(way)) continue;
    const before = way.points.length;
    way.points = filletBends(way.points);
    if (way.points.length !== before) { bent += 1; way._filleted = true; }
  }
  return bent;
}
const bendsFilleted = filletStreetBends(DATA.ways);

clampRoadWidthsToNeighbours(DATA.ways);

for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  if (isUndergroundWay(way)) continue;
  const half = renderedRoadWidth(way) / 2;
  // A road tunnel is roadway only at its two mouths; between them it is under the hill, and
  // the streets on the hill cross its line with their pavements intact.
  const runs = isRoadTunnel(way) ? tunnelStubs(tunnelCoveredPoints(way, way.points)) : [way.points];
  for (const run of runs) {
    const along = way._spans ? alongDistances(run) : null;
    for (let i = 1; i < run.length; i += 1) {
      const [ax, ay] = xy(run[i - 1][0], run[i - 1][1]);
      const [bx, by] = xy(run[i][0], run[i][1]);
      const segmentHalf = along
        ? (halfWidthAt(way, along[i - 1]) + halfWidthAt(way, along[i])) / 2 : half;
      addCarriagewaySegment(ax, -ay, bx, -by, segmentHalf, way);
    }
  }
}
STREETS_GRIDDED = carriagewayGrid.size > 0;

function distanceToSegmentSquared(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-9) {
    const ox = px - ax;
    const oz = pz - az;
    return ox * ox + oz * oz;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  const x = ax + dx * t;
  const z = az + dz * t;
  const ox = px - x;
  const oz = pz - z;
  return ox * ox + oz * oz;
}

function insideMeasuredCarriageway(x, z, slack) {
  // Inside a carriageway whose width was measured -- the lidar's kerb risers, or a city's own
  // curb lines -- rather than one inferred from the street's class or from a right of way.
  //
  // The difference decides whether a mapped footway that overlaps the road is the mapper's
  // error or ours. Where the kerb is measured it is the better line and the pavement drawn
  // over it is wrong. Where the width is a prior, or a right of way minus its footways -- which
  // makes Villa Terrace 53 m across -- the wide carriageway is ours, and deleting the
  // pavement inside it would erase a third of the footway in this corridor for our own guess.
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half, , source] of bucket) {
        if (!source || !MEASURED_ROAD_SOURCES.has(source.road_source)) continue;
        const limit = Math.max(0, half - slack);
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < limit * limit) return true;
      }
    }
  }
  return false;
}

function insideCarriageway(x, z, slack = 0.4) {
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (bucket) {
        for (const [ax, az, bx, bz, half] of bucket) {
          const limit = Math.max(0, half - slack);
          if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < limit * limit) return true;
        }
      }
    }
  }
  return false;
}

//: Whether a point is on the body of a carriageway other than the ways named -- for the
//: corner pieces. A corner is built from its two legs' own kerbs, so those two ways cannot
//: be the reason to refuse it: the stamped band is a segment's average width where the
//: corner is built at the node's, and a road that widens away from the junction overlapped
//: its own corner by a few decimetres. And no end caps: every way ending at a node reached
//: into every corner of the junction by its own half width. Only a third carriageway's body
//: across the wedge -- a slip lane, a diagonal street -- says the corner is on the road.
//: 403 of the corridor's 1,738 corners were refused for one of the two; they are the
//: missing corner chunks.
function onAnotherCarriageway(x, z, slack, exclude) {
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half, , source] of bucket) {
        if (source && exclude.includes(source)) continue;
        const ex = bx - ax, ez = bz - az;
        const l2 = ex * ex + ez * ez;
        if (l2 < 1e-9) continue;
        const t = ((x - ax) * ex + (z - az) * ez) / l2;
        if (t <= 0 || t >= 1) continue;                  // the body, not the caps
        const px = ax + ex * t, pz = az + ez * t;
        const limit = Math.max(0, half - slack);
        if ((x - px) ** 2 + (z - pz) ** 2 < limit * limit) return true;
      }
    }
  }
  return false;
}

function pavementSurroundedByStreet(x, z, width) {
  const reach = Math.max(0.85, Math.min(2.4, width));
  let sides = 0;
  if (insideCarriageway(x + reach, z, 0.0)) sides += 1;
  if (insideCarriageway(x - reach, z, 0.0)) sides += 1;
  if (insideCarriageway(x, z + reach, 0.0)) sides += 1;
  if (insideCarriageway(x, z - reach, 0.0)) sides += 1;
  return sides >= 3;
}

function lerpLonLat(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function pavementRunsOutsideCarriageway(points, width, discardDetached = false) {
  // Sidewalks and paths are solid concrete, not overlays. If any run of their centreline falls
  // inside a carriageway, split it out before a ribbon can be built over the street. The guard
  // samples both ribbon edges too, because a wide walk can have a clean centreline while its
  // inner edge still slides over asphalt around curves and mitred junctions.
  if (!points || points.length < 2) return [];
  const runs = [];
  let run = [];
  let runStartsAfterOverlap = false;
  let afterOverlap = false;
  // What "in the carriageway" means for a footway. It means the footway overlaps the road, and
  // the test for that is the footway's own edges -- not its centreline pushed outward.
  //
  // This guard used to inflate every carriageway by up to 1.15 m and then ask whether the
  // footway's centreline was inside it. But a footway sits with its inner edge against the
  // kerb, so its centreline is only half its width clear of the road: inflating the road by a
  // metre swallowed the centreline of a normal, correctly placed pavement. It suppressed 63 of
  // the 201 km of mapped footway in this corridor and erased 420 sidewalk ways outright, which
  // is what the black gaps along the kerb were. The geometry was right and the guard deleted it.
  const edge = Math.max(0.2, width / 2 - 0.12);
  const minimumRun = Math.max(0.9, Math.min(4.2, width * 1.15));
  const finish = (endedByOverlap = false) => {
    // A remnant shorter than roughly its own width is a detached slab, not a usable run of
    // sidewalk.  These were the isolated squares left between two crossing/intersection cuts.
    const runLength = run.length >= 2 ? wayLength(run) : 0;
    const detachedRemnant = discardDetached
      && (runStartsAfterOverlap || endedByOverlap) && runLength < 8.0;
    if (run.length >= 2 && runLength > minimumRun && !detachedRemnant) {
      run.startsAtRoad = runStartsAfterOverlap;
      run.endsAtRoad = endedByOverlap;
      runs.push(run);
    }
    run = [];
    runStartsAfterOverlap = false;
  };

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const [ax, ay] = xy(a[0], a[1]);
    const [bx, by] = xy(b[0], b[1]);
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length / 2.0));
    for (let k = i === 1 ? 0 : 1; k <= steps; k += 1) {
      const point = lerpLonLat(a, b, k / steps);
      const [x, y] = xy(point[0], point[1]);
      const z = -y;
      const dx = bx - ax;
      const dz = ay - by;
      const span = Math.hypot(dx, dz) || 1;
      const nx = -dz / span;
      const nz = dx / span;
      // Genuinely over the road: the middle of the footway is on the carriageway, or both of
      // its edges are. One edge inside the kerb line is the normal condition of a pavement
      // that abuts a street, and is not a reason to delete it.
      const innerEdge = insideCarriageway(x + nx * edge, z + nz * edge, 0.30);
      const outerEdge = insideCarriageway(x - nx * edge, z - nz * edge, 0.30);
      // Junction hulls are deliberately generous asphalt backstops.  Their convex envelope
      // also encloses the curb-ramp end of some mapped footways (Broadway/Van Ness is one),
      // although those points are outside every carriageway.  Trust the mapped footway there;
      // keep the box exclusion for inferred kerbside paving and the property-line underlay.
      const overlaps = insideCarriageway(x, z, 0.30)
        || (!discardDetached && insideJunctionBox(x, z))
        || (innerEdge && outerEdge)
        || pavementSurroundedByStreet(x, z, width);
    if (overlaps) {
      finish(true);
      afterOverlap = true;
    } else {
      if (!run.length) {
        runStartsAfterOverlap = afterOverlap;
        afterOverlap = false;
      }
      const last = run[run.length - 1];
        if (!last || Math.hypot((last[0] - point[0]) * metersPerLon,
                                (last[1] - point[1]) * metersPerLat) > 0.05) {
          run.push(point);
        }
      }
    }
  }
  finish(false);
  // A break in the pavement shorter than WALK_GAP_FILL_M is a cutout, not a street: a few
  // samples where the guard flickered over a kerb bulge or a driveway apron left a notch in the
  // footway a metre or two long. It is bridged, unless a carriageway lies *across* the
  // footway there -- the one thing that really does break a pavement.
  const WALK_GAP_FILL_M = 5.0;
  const crossedAt = (x, z, bearing) => {
    const cx = Math.floor(x / CARRIAGEWAY_CELL), cz = Math.floor(z / CARRIAGEWAY_CELL);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const [sax, saz, sbx, sbz, half, other] of carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz)) || []) {
          if (other === undefined) continue;
          let difference = Math.abs(other - bearing) % Math.PI;
          if (difference > Math.PI / 2) difference = Math.PI - difference;
          if (difference < Math.PI / 7) continue;
          const reach = half + 0.5;
          if (distanceToSegmentSquared(x, z, sax, saz, sbx, sbz) < reach * reach) return true;
        }
      }
    }
    return false;
  };
  const bridged = runs.length ? [runs[0]] : [];
  for (let i = 1; i < runs.length; i += 1) {
    const prev = bridged[bridged.length - 1], next = runs[i];
    const [ax, ay] = xy(prev[prev.length - 1][0], prev[prev.length - 1][1]);
    const [bx, by] = xy(next[0][0], next[0][1]);
    const mx = (ax + bx) / 2, mz = -(ay + by) / 2;
    if (Math.hypot(bx - ax, by - ay) < WALK_GAP_FILL_M && !insideJunctionBox(mx, mz)
        && !crossedAt(mx, mz, Math.atan2(-(by - ay), bx - ax))) {
      const joined = prev.concat(next);
      joined.startsAtRoad = prev.startsAtRoad;
      joined.endsAtRoad = next.endsAtRoad;
      bridged[bridged.length - 1] = joined;
    } else {
      bridged.push(next);
    }
  }
  // An end that meets a road is put on its kerb. The guard above asks every two metres and
  // about the middle of the strip, so a pavement ran up to two metres on past the kerb of the
  // street it met -- its corner standing out over the asphalt, a chunk at every corner -- or
  // stopped up to two metres short of it. Each such end is moved to where its whole end, both
  // corners and the middle, is last clear of the road, a fifth of a metre at a time.
  // An end that stops on its own -- a mapped footway drawn to the crossing's node, which is on
  // the kerb, at an angle -- is only ever moved back: half of it stood over the road as a flap.
  const half = width / 2;
  for (const run of bridged) {
    settleRunEnd(run, half, discardDetached, run.endsAtRoad);
    run.reverse();
    settleRunEnd(run, half, discardDetached, run.startsAtRoad);
    run.reverse();
  }
  return bridged;
}

//: How far a pavement's end may be moved back off the road, or on to meet it, and by what steps.
const RUN_END_BACK_M = 2.6;
const RUN_END_ON_M = 2.2;
const RUN_END_STEP_M = 0.2;

function settleRunEnd(run, half, discardDetached, meetsRoad) {
  // The last point of `run`, moved along its last segment until the end of the strip there --
  // its middle and both corners -- is clear of every carriageway by five centimetres.
  if (run.length < 2) return;
  const clear = (x, z, nx, nz) => {
    for (const s of [0, 1, -1]) {
      const px = x + nx * half * s, pz = z + nz * half * s;
      if (insideCarriageway(px, pz, 0.05)) return false;
      if (!discardDetached && insideJunctionBox(px, pz)) return false;
    }
    return true;
  };
  const toXZ = (p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; };
  let [ex, ez] = toXZ(run[run.length - 1]);
  let [px, pz] = toXZ(run[run.length - 2]);
  let span = Math.hypot(ex - px, ez - pz);
  if (span < 1e-6) return;
  let ux = (ex - px) / span, uz = (ez - pz) / span;
  const normal = () => [-uz, ux];
  let [nx, nz] = normal();
  if (clear(ex, ez, nx, nz)) {
    if (!meetsRoad) return;
    // Short of the road: on along the same line while the end stays clear.
    let t = 0;
    while (t + RUN_END_STEP_M <= RUN_END_ON_M && clear(ex + ux * (t + RUN_END_STEP_M), ez + uz * (t + RUN_END_STEP_M), nx, nz)) {
      t += RUN_END_STEP_M;
    }
    if (t > 0) run[run.length - 1] = lonLatFromXZ(ex + ux * t, ez + uz * t);
    return;
  }
  // Over the road: back along the run until it is clear, giving up whole segments as it goes.
  let back = 0;
  while (back < RUN_END_BACK_M) {
    back += RUN_END_STEP_M;
    let remaining = back;
    let i = run.length - 1;
    let [ax, az] = toXZ(run[i]);
    let x = ax, z = az;
    while (i > 0) {
      const [bx, bz] = toXZ(run[i - 1]);
      const seg = Math.hypot(ax - bx, az - bz);
      if (remaining <= seg) {
        const f = seg > 1e-6 ? remaining / seg : 0;
        x = ax + (bx - ax) * f; z = az + (bz - az) * f;
        ux = (ax - bx) / (seg || 1); uz = (az - bz) / (seg || 1);
        break;
      }
      remaining -= seg;
      ax = bx; az = bz; i -= 1;
      x = ax; z = az;
    }
    if (i === 0) return;                      // the whole run is on the road; leave it to the guard
    [nx, nz] = normal();
    if (clear(x, z, nx, nz)) {
      run.length = i + 1;
      run[i] = lonLatFromXZ(x, z);
      if (run.length < 2) return;
      return;
    }
  }
}

//: Where pavement was actually laid, as a coarse grid. A tree pit belongs in a footway and
//: nowhere else -- not in a park, not on a lawn, and certainly not in the road -- and the only
//: thing that knows where the footway ended up is the code that put it there.
const PAVED_CELL = 1.5;
const pavedGrid = new Map();
// The neutral property-line underlay is deliberately allowed beneath private lawns. Public
// park grass, however, must stop at its visible paved frontage. Keep that footprint separate
// from pavedGrid so excluding the park cannot erase a legitimate front lawn.
const UNDERLAY_CELL_M = 16;
const underlayGrid = new Map();
function stampParkPavement(run, width) {
  const edges = mitredEdges(run, width);
  if (!edges) return;
  for (let i = 1; i < edges.left.length; i += 1) {
    // These are the ribbon's *actual* top-face quads. Rounded capsules overcut the park
    // beyond a sidewalk run's blunt end, leaving a dark crescent at curb corners.
    const quad = [edges.left[i - 1], edges.left[i], edges.right[i], edges.right[i - 1]];
    const xs = quad.map((p) => p[0]), zs = quad.map((p) => p[1]);
    for (let ix = Math.floor(Math.min(...xs) / UNDERLAY_CELL_M);
         ix <= Math.floor(Math.max(...xs) / UNDERLAY_CELL_M); ix += 1) {
      for (let iz = Math.floor(Math.min(...zs) / UNDERLAY_CELL_M);
           iz <= Math.floor(Math.max(...zs) / UNDERLAY_CELL_M); iz += 1) {
        const key = `${ix}:${iz}`;
        let bucket = underlayGrid.get(key);
        if (!bucket) underlayGrid.set(key, bucket = []);
        bucket.push(quad);
      }
    }
  }
}
function parkPavementAt(x, z) {
  const bucket = underlayGrid.get(`${Math.floor(x / UNDERLAY_CELL_M)}:${Math.floor(z / UNDERLAY_CELL_M)}`);
  return Boolean(bucket && bucket.some((quad) => pointInRing(x, z, quad)));
}
//: Which way the footway runs through each cell. A tree pit is a square cut out of the paving,
//: and paving is laid square to the kerb -- so a pit turned a few degrees off the flags around
//: it reads as a mistake in the pavement rather than as an opening in it. This is what squares
//: them up, and it has to come from the ribbon because nothing else knows the kerb's bearing.
const pavedBearing = new Map();

//: Every piece of pavement as laid, exactly: each ribbon's segments with their half width and top
//: (above the ground), and each corner slab's outline, filed by cell. The paved cells above are a
//: metre and a half across -- right for a tree pit, too coarse to stand on: at the kerb a cell is
//: half road. The walker stands on these (pavementSurfaceAt).
const PAVED_SEGMENT_CELL_M = 8;
//: How far past a segment's end its pavement still counts: enough to close the seam between
//: two segments of one ribbon, no more.
const PAVED_SEGMENT_SEAM_M = 0.05;
//: The street sides the frontage fill walks (addFrontageFill), gathered as each street is laid.
const frontageSides = [];
const FRONTAGE_STEP_M = 1.0;
const FRONTAGE_PROBE_M = 0.1;
const FRONTAGE_MIN_M = 0.15;
const FRONTAGE_BELOW_M = 0.003;   // under the pavement it meets, so the two never fight
//: A stretch of a side with no pavement at all, but pavement on both sides of it along the same
//: kerb, is the same footway with a piece missing, and is carried through when it is no longer
//: than this.
const FRONTAGE_BRIDGE_M = 30;
const frontageStats = { sides: 0, stations: 0, filled_m2: 0, bridged_m: 0, unsurveyed: 0,
  skipped: { junction: 0, noPavement: 0, noRoom: 0 }, ways: {} };
const pavedSegmentGrid = new Map();
function filePavedShape(minX, minZ, maxX, maxZ, record) {
  for (let ix = Math.floor(minX / PAVED_SEGMENT_CELL_M); ix <= Math.floor(maxX / PAVED_SEGMENT_CELL_M); ix += 1)
    for (let iz = Math.floor(minZ / PAVED_SEGMENT_CELL_M); iz <= Math.floor(maxZ / PAVED_SEGMENT_CELL_M); iz += 1) {
      const key = ix * 1048576 + iz;
      if (!pavedSegmentGrid.has(key)) pavedSegmentGrid.set(key, []);
      pavedSegmentGrid.get(key).push(record);
    }
}
// A slab given by its outline (page x, z) at one top.
function stampPavedRing(ring, top) {
  const xs = ring.map((q) => q[0]), zs = ring.map((q) => q[1]);
  filePavedShape(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), { ring, top });
}
// The top of the pavement at (x, z), above the ground, or null where none is laid.
function pavementSurfaceAt(x, z) {
  const list = pavedSegmentGrid.get(Math.floor(x / PAVED_SEGMENT_CELL_M) * 1048576 + Math.floor(z / PAVED_SEGMENT_CELL_M));
  if (!list) return null;
  let best = null;
  for (const r of list) {
    if (best !== null && r.top <= best) continue;
    if (r.ring ? nearRing(r.ring, x, z, 0) : onPavedSegment(r, x, z)) best = r.top;
  }
  return best;
}
// Square-ended, as the ribbon is drawn: measured as a capsule, every run of pavement claimed
// half its width of ground past each end, and where a run stopped short of the next -- at a
// driveway, between two houses -- the walker stood a kerb's height over bare ground and the
// frontage fill took the gap for paved.
function onPavedSegment(r, x, z) {
  const ex = r.bx - r.ax, ez = r.bz - r.az, span = Math.hypot(ex, ez);
  const along = ((x - r.ax) * ex + (z - r.az) * ez) / span;
  if (along < -PAVED_SEGMENT_SEAM_M || along > span + PAVED_SEGMENT_SEAM_M) return false;
  return Math.abs((x - r.ax) * ez - (z - r.az) * ex) / span <= r.half;
}

function stampPaved(run, width, top) {
  // The ribbon's actual footprint, walked along its length and across its width.
  //
  // Dilating by whole cells instead put every tree within six metres of a footway on pavement,
  // which is 23,888 of the corridor's 25,123 street trees -- including the ones standing in
  // parks and back gardens next to one. A tree pit is a hole cut in a pavement, so the test has
  // to be whether the pavement is under the tree rather than near it.
  const half = Math.max(0.5, width / 2);
  for (let i = 1; i < run.length; i += 1) {
    const [ax, ay] = xy(run[i - 1][0], run[i - 1][1]);
    const [bx, by] = xy(run[i][0], run[i][1]);
    const az = -ay;
    const bz = -by;
    const span = Math.hypot(bx - ax, bz - az);
    if (span < 1e-6) continue;
    const exact = width / 2;
    filePavedShape(Math.min(ax, bx) - exact, Math.min(az, bz) - exact, Math.max(ax, bx) + exact, Math.max(az, bz) + exact,
      { ax, az, bx, bz, half: exact, top });
    const nx = -(bz - az) / span;
    const nz = (bx - ax) / span;
    const along = Math.max(1, Math.ceil(span / (PAVED_CELL * 0.6)));
    const across = Math.max(1, Math.ceil((half * 2) / (PAVED_CELL * 0.6)));
    for (let k = 0; k <= along; k += 1) {
      const t = k / along;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      for (let j = 0; j <= across; j += 1) {
        const off = -half + (2 * half * j) / across;
        // The pavement's own top surface, kept per cell. Kerb heights here run from 60 mm to
        // 445 mm, so a pit at one fixed height is buried under half the pavements in the city
        // and floating a hand's breadth above the other half.
        const key = `${Math.floor((x + nx * off) / PAVED_CELL)}:`
          + `${Math.floor((z + nz * off) / PAVED_CELL)}`;
        const known = pavedGrid.get(key);
        if (known === undefined || top > known) {
          pavedGrid.set(key, top);
          pavedBearing.set(key, Math.atan2(bz - az, bx - ax));
        }
      }
    }
  }
}

function pavementTopAt(x, z) {
  return pavedGrid.get(`${Math.floor(x / PAVED_CELL)}:${Math.floor(z / PAVED_CELL)}`);
}

function pavementBearingAt(x, z) {
  return pavedBearing.get(`${Math.floor(x / PAVED_CELL)}:${Math.floor(z / PAVED_CELL)}`);
}

//: A mapped footway with no surveyed width is drawn at this, and 3.6 m of concrete centred on
//: a line somebody drew by eye reaches 1.8 m either side of it. Where the kerb beside it was
//: measured, that is often 1.8 m the pavement does not have.
const WALK_FIT_SAMPLE_M = 2.0;
//: Never narrowed below this: a pavement that has shrunk to a kerb tile is not a pavement,
//: and at that point the run is better dropped by the carriageway guard than drawn as a line.
const WALK_FIT_MIN_M = 1.2;

function walkWidthAgainstMeasuredKerbs(points, width) {
  // The width this footway has room for, against the kerbs somebody measured.
  //
  // A mapped footway carries no width of its own in most cities, so it is drawn at the 3.6 m
  // fallback, centred on the mapped line. On 14th Street in Oakland that line runs closer to
  // the middle of the road than the lidar's kerb does, and the slab was laid over the asphalt
  // -- not far enough in for the carriageway guard to drop the run, which asks about the
  // centreline and about both edges together, and rightly keeps a pavement that merely abuts
  // a kerb. The answer is not to delete the pavement but to draw the width there is: the
  // strip is narrowed until its edge clears the measured kerb, and a footway beside an
  // inferred width -- a class prior, a right of way minus its footways -- is left alone,
  // because there the wide carriageway is our guess rather than the mapper's error.
  if (!points || points.length < 2 || !carriagewayGrid.size) return width;
  let intrusion = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const [ax, ay] = xy(a[0], a[1]);
    const [bx, by] = xy(b[0], b[1]);
    const span = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(span / WALK_FIT_SAMPLE_M));
    const nx = -(ay - by) / (span || 1);
    const nz = (bx - ax) / (span || 1);
    for (let k = 0; k <= steps; k += 1) {
      const point = lerpLonLat(a, b, k / steps);
      const [x, y] = xy(point[0], point[1]);
      const z = -y;
      // How far out this sample's edges have to move to clear a measured kerb, found by
      // halving between the edge and the centreline.
      for (const sign of [1, -1]) {
        let clear = 0;
        let over = width / 2;
        if (!insideMeasuredCarriageway(x + sign * nx * over, z + sign * nz * over, 0.15)) continue;
        for (let step = 0; step < 8; step += 1) {
          const mid = (clear + over) / 2;
          if (insideMeasuredCarriageway(x + sign * nx * mid, z + sign * nz * mid, 0.15)) over = mid;
          else clear = mid;
        }
        intrusion = Math.max(intrusion, width / 2 - clear);
      }
    }
  }
  if (intrusion <= 0.05) return width;
  return Math.max(WALK_FIT_MIN_M, width - 2 * intrusion);
}

function addPavementRibbon(points, width, color, opacity, y, thickness, surface,
                           discardDetached = false) {
  let laid = 0;
  for (const run of pavementRunsOutsideCarriageway(points, width, discardDetached)) {
    stampPaved(run, width, y + thickness / 2);
    addMerged(`walk:${surface}:${(Math.round(thickness / 0.05) * 0.05).toFixed(2)}`,
              ribbon(run, width, color, opacity, y, thickness, surface), surface);
    laid += wayLength(run);
  }
  return laid;
}

//: Widths to try for a kerbside footway, widest first, before giving up on one. The inner edge
//: stays on the kerb at every width, so a narrower attempt is the same pavement with less of it
//: rather than a pavement somewhere else.
//: The kerb's own tile: four inches of the top of the pavement at the street edge, and the face
//: down to the gutter. It is what curb paint is painted on.
const KERB_LIP_M = 0.1016;
const WALK_FALLBACK_WIDTHS_M = [1.0, 0.72, 0.52, 0.36, 0.24];
//: Below this share of the block face surviving, the width is too wide for the room there is.
const WALK_ENOUGH = 0.55;
//: A stretch of pavement holds its width for at least this far before changing it. Without it
//: the strip steps in and out every couple of metres wherever the carriageway guard flickers.
const WALK_WIDTH_RUN_M = 6.0;
//: A low visual pavement backstop from kerb toward the property line. It sits below grass and
//: front-yard surfaces, so lawns still win, but exposed slivers become concrete instead of the
//: black base plane.
const PROPERTY_LINE_PAVEMENT_WIDTH_M = 8.6;
//: The narrowest strip of made ground worth drawing between a kerb and a building. Below this
//: it is a survey sliver, not somewhere anybody walks.
const UNDERLAY_MIN_WIDTH_M = 0.8;
//: How far a width is held before the underlay is allowed to change it.
const UNDERLAY_RUN_M = 5.0;
//: Five centimetres under the flat model's ground rather than one above it: the underlay's top
//: is then 23 cm under the pavement's, room for a chord tolerance above the grid's noise
//: without the underlay standing up through the pavement on a bend.
const PROPERTY_LINE_PAVEMENT_Y = -0.05;
const PROPERTY_LINE_PAVEMENT_THICKNESS_M = 0.004;

