// ---- where OpenStreetMap says there is no pavement ----
//
// 988 of this corridor's 4,219 street ways carry `sidewalk=no` or `sidewalk:both=no`, and the
// renderer believed all of them: 41.6 km, 13.2% of the street network, drawn with no footway on
// either side. Polk Street is one. Sacramento Street is another. They have pavements.
//
// What the tag usually means on a street like those is "the pavement is mapped as its own way",
// which is what `sidewalk=separate` is for and what a great many mappers write `no` for instead.
// It is only worth believing when it is true, and whether it is true is checkable: if a mapped
// footway runs along that side, the tag is right and the derived pavement would double it. If
// nothing runs there, the tag is describing a mapping decision rather than a street, and
// believing it leaves bare ground between the kerb and the shopfronts.
const MAPPED_WALK_CELL = 40;
const mappedWalkGrid = new Map();
//: How far from the kerb line a mapped footway counts as being this street's pavement.
const MAPPED_WALK_REACH_M = 11.0;

for (const way of DATA.ways) {
  if ((way.kind !== "sidewalk" && way.kind !== "path") || !way.points || way.points.length < 2) {
    continue;
  }
  for (let i = 1; i < way.points.length; i += 1) {
    const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
    const [bx, by] = xy(way.points[i][0], way.points[i][1]);
    const segment = [ax, -ay, bx, -by, way];
    const x0 = Math.floor(Math.min(ax, bx) / MAPPED_WALK_CELL);
    const x1 = Math.floor(Math.max(ax, bx) / MAPPED_WALK_CELL);
    const z0 = Math.floor(Math.min(-ay, -by) / MAPPED_WALK_CELL);
    const z1 = Math.floor(Math.max(-ay, -by) / MAPPED_WALK_CELL);
    for (let ix = x0 - 1; ix <= x1 + 1; ix += 1) {
      for (let iz = z0 - 1; iz <= z1 + 1; iz += 1) {
        const key = `${ix}:${iz}`;
        let bucket = mappedWalkGrid.get(key);
        if (!bucket) mappedWalkGrid.set(key, bucket = []);
        bucket.push(segment);
      }
    }
  }
}

function mappedWalkNear(x, z, reach = MAPPED_WALK_REACH_M) {
  // Two questions share this index and they want different distances. "Does OpenStreetMap map a
  // footway along this side of the street, so that `sidewalk=no` can be believed?" is a question
  // about the side and wants the default eleven metres. "Is this exact spot already under a
  // mapped footway's slab?" is a question about the ground and wants about half a pavement.
  const ix = Math.floor(x / MAPPED_WALK_CELL);
  const iz = Math.floor(z / MAPPED_WALK_CELL);
  const limit = reach * reach;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = mappedWalkGrid.get(`${ix + dx}:${iz + dz}`);
      if (!bucket) continue;
      for (const [ax, az, bx, bz] of bucket) {
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < limit) return true;
      }
    }
  }
  return false;
}

//: The derived pavement meets a mapped footway on the same side of the street when the footway
//: lies within this of the kerb line; a footway further off is some other street's.
const MAPPED_WALK_ABUT_M = 7.0;
//: A gap narrower than this between the kerb line and the mapped footway's near edge is the
//: two lines disagreeing by a hand, not room for pavement of its own.
const MAPPED_WALK_GAP_MIN_M = 0.35;

function mappedWalkBeyondKerb(x, z, nx, nz, inner) {
  // The mapped footway on this side of the street at this station: where its near edge stands
  // out from the street's line, and the height it is drawn at.
  //
  // The derived pavement is laid from the OpenStreetMap kerb outward to a width of its own,
  // and the mapped footway is laid on OpenStreetMap's footway line at a width of its own, and
  // the two were never asked to agree. Where they overlapped the derived one was meant to hide
  // a centimetre under the mapped one -- but each takes its kerb height from its own record,
  // and a 200 mm derived slab under a 120 mm footway stood 70 mm proud of it. Where the
  // footway line stood further off than the derived width reached, the two were laid side by
  // side: two slabs of different heights, with a step between, nine metres of pavement along
  // the front of the Walgreens car park on Broadway. One footway, at the footway's height.
  const ix = Math.floor(x / MAPPED_WALK_CELL);
  const iz = Math.floor(z / MAPPED_WALK_CELL);
  let best = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = mappedWalkGrid.get(`${ix + dx}:${iz + dz}`);
      if (!bucket) continue;
      for (const [ax, az, bx, bz, way] of bucket) {
        if (!way || way.kind !== "sidewalk") continue;
        const sx = bx - ax, sz = bz - az;
        const span = Math.hypot(sx, sz) || 1;
        // Running along the street, not across it: a crossing of the footway network is a
        // sidewalk way too, and it is not the pavement beside this street.
        if (Math.abs((sx * -nz + sz * nx) / span) < 0.8) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / (span * span)));
        const qx = ax + sx * t, qz = az + sz * t;
        const out = (qx - x) * nx + (qz - z) * nz;              // along the outward normal
        const across = Math.abs((qx - x) * -nz + (qz - z) * nx);
        if (across > 3.0) continue;                              // the closest point is off the end
        const half = renderedWalkWidth(way, 3.6) / 2;
        if (out < inner - half || out > inner + MAPPED_WALK_ABUT_M) continue;
        if (best && out >= best.out) continue;
        const kerb = renderedKerbHeight(way);
        best = { out, edge: out - half, y: ROAD_TOP_M + kerb / 2, thickness: kerb };
      }
    }
  }
  return best;
}

//: How far beyond the kerb to look for another carriageway. Pavement belongs outside the street,
//: not in the slot between the two halves of a divided road.
const KERBSIDE_BLOCK_PROBE_M = 1.8;

function kerbsideBlockedAt(before, here, after, side, inner) {
  // Is the ground just beyond this kerb, at this point, inside some other carriageway?
  //
  // This used to be asked of the side as a whole: seven samples, and if three of them were
  // blocked the entire side lost its pavement -- including the stretches that were clear. A side
  // blocked for half its length came out bare for all of it, which is where 673 kerb stations
  // with room and nothing said against them were going. The question is a fact about a place,
  // so it is asked about each place.
  const centre = offsetWay([before, here, after], side * (inner + KERBSIDE_BLOCK_PROBE_M))[1];
  const [x, y] = xy(centre[0], centre[1]);
  return insideCarriageway(x, -y, 0.15);
}

function walkSidesToDraw(way, renderPoints, inner) {
  // Both sides unless OpenStreetMap says otherwise and the ground agrees with it.
  const stated = way.walk_sides;
  const drawn = [];
  if (isUnmarkedService(way) || way._junctionInternal || isTunnelWay(way)) return drawn;
  for (const side of [1, -1]) {
    if (stated === undefined) {
      drawn.push(side);
      continue;
    }
    if (stated.includes(side)) {
      drawn.push(side);
      continue;
    }
    // The tag excludes this side. Believe it only where a mapped footway is standing there.
    const kerb = offsetWay(renderPoints, side * (inner + 1.6));
    let sampled = 0;
    let covered = 0;
    for (let i = 0; i < kerb.length; i += Math.max(1, Math.floor(kerb.length / 6))) {
      const [x, y] = xy(kerb[i][0], kerb[i][1]);
      sampled += 1;
      if (mappedWalkNear(x, -y)) covered += 1;
    }
    if (!sampled || covered < sampled * 0.5) drawn.push(side);
  }
  return drawn;
}

const LANE_TRANSITION_TRIM_M = 9.0;
const LANE_TRANSITION_MAX_SHIFT_M = 3.4;
const streetEndGrid = new Map();

function indexStreetEnds(ways) {
  // OpenStreetMap splits a street wherever its tagging changes, not only where it meets another
  // street. Those splits are invisible on the ground, and pulling the pavement back from both
  // sides of one puts a gap in the middle of a block.
  streetEndGrid.clear();
  for (const way of ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
    if (isUndergroundWay(way)) continue;
    const n = way.points.length;
    for (const [end, next] of [[0, 1], [n - 1, n - 2]]) {
      const [ex, ey] = xy(way.points[end][0], way.points[end][1]);
      const [nx2, ny2] = xy(way.points[next][0], way.points[next][1]);
      // The bearing of the way as it leaves this end, so a stem meeting a crossbar is not read
      // as the crossbar carrying on.
      const bearing = Math.atan2(-ny2 + ey, nx2 - ex);
      const key = `${Math.floor(ex / STREET_JOIN_M)}:${Math.floor(-ey / STREET_JOIN_M)}`;
      let bucket = streetEndGrid.get(key);
      if (!bucket) streetEndGrid.set(key, bucket = []);
      bucket.push([ex, -ey, bearing, way]);
    }
  }
}

function streetContinuationsAt(way, x, z, bearing) {
  // Is there another street way leaving this same point in the opposite direction -- that is,
  // continuing the line this one is on?
  const cx = Math.floor(x / STREET_JOIN_M);
  const cz = Math.floor(z / STREET_JOIN_M);
  const limit = (STREET_JOIN_DEG * Math.PI) / 180;
  const matches = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = streetEndGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const [ex, ez, other, otherWay] of bucket) {
        if (otherWay === way) continue;
        if (Math.hypot(ex - x, ez - z) > STREET_JOIN_M) continue;
        // The other way leaves this point heading roughly back the way we came from, which is
        // what "the same street carrying on" looks like from the join.
        let turn = Math.abs(((other - bearing + Math.PI) % (2 * Math.PI)) - Math.PI);
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        if (Math.abs(Math.PI - turn) < limit) matches.push(otherWay);
      }
    }
  }
  return matches;
}

function streetCarriesOn(way, x, z, bearing) {
  return streetContinuationsAt(way, x, z, bearing).length > 0;
}

function kerbsideTrims(renderPoints, back, side = 0) {
  // How far to pull the pavement back from each end of this way: the full trim where the street
  // really stops at a junction, and nothing where it simply carries on into the next way.
  //
  // With a side given, the trim at a junction is the corner's own: exactly as far as the
  // crossing street's pavement reaches, so the two meet edge to edge with the corner piece
  // between them. That is asked before whether the street carries on, because at a crossroads
  // it does both -- the way continues straight through, and there is still a street coming in
  // on this side. Carrying on only means no cut where nothing comes in on that side, which is
  // a split in the tagging or the far side of a T. Without a side (the underlay asks that
  // way) it is the flat pull-back.
  const n = renderPoints.length;
  const [sx, sy] = xy(renderPoints[0][0], renderPoints[0][1]);
  const [s2x, s2y] = xy(renderPoints[1][0], renderPoints[1][1]);
  const [ex, ey] = xy(renderPoints[n - 1][0], renderPoints[n - 1][1]);
  const [e2x, e2y] = xy(renderPoints[n - 2][0], renderPoints[n - 2][1]);
  const startBearing = Math.atan2(-s2y + sy, s2x - sx);
  const endBearing = Math.atan2(-e2y + ey, e2x - ex);
  const cut = (x, y, dx, dy, bearing, awaySide) => {
    const leg = awaySide ? cornerLegAt(x, y, dx, dy) : null;
    const corner = leg && pavementCornerCuts.get(`${leg.id}:${awaySide}`);
    if (corner && corner.valid) return corner.cut;
    if (streetCarriesOn(null, x, -y, bearing)) return 0;
    // No corner to meet and no street to carry on into, but a junction box to stay out of.
    if (leg && leg.boxExit > 0) return Math.max(back, leg.boxExit + 0.5);
    return back;
  };
  return [
    cut(sx, sy, s2x - sx, s2y - sy, startBearing, side),
    // Leaving the far end the way runs backwards, so the pavement on its left is on the right.
    cut(ex, ey, e2x - ex, e2y - ey, endBearing, -side),
  ];
}

// ---- the corners ----
//
// A kerbside pavement is pulled back from each junction so that it does not run on into the
// crossing street, and both pavements that meet at a corner were pulled back by seven tenths
// of their own width past the other's kerb. That left two faults at every corner in the
// corridor, and they are the same fault seen from both sides: the square between the two
// kerb lines -- the one a person stands on to wait for the light -- had nothing on it, and
// the small square outside it, where both pull-backs had not reached, had both pavements on
// it, fighting for depth. "A single square missing at the corners", and the broken tiles
// beside it.
//
// The corner is its own piece of ground, bounded by the two kerb lines and the two lines
// where the pavements start. So each pavement is now cut where the crossing street's pavement
// ends -- the point where the two outer edges meet -- and the corner between the cuts and the
// kerbs is laid once, with its own kerb round the curb return. Nothing overlaps and nothing is
// left out. The cuts are decided before any pavement is laid, from the same widths the
// pavements use, so the pieces are made to meet rather than checked afterwards.
//: Way ends within this distance are one junction. A junction is a shared node, so this is
//: rounding, not tolerance.
const CORNER_JOIN_M = 1.0;
//: The angle between two legs for the ground between them to be a corner. Below the minimum it
//: is a sliver two pavements already cover between them; above the maximum it is one street
//: bending, which is what streetCarriesOn says and the pavement runs straight through.
const CORNER_MIN_DEG = 20;
const CORNER_MAX_DEG = 150;
const CORNER_CELL_M = 4.0;
//: Nodes this close are one junction. The Embarcadero's crossing with Broadway is drawn as
//: connector ways eleven to fifteen metres long between the nodes on its two carriageways,
//: and the junction -- its box, and the ways that are only its connectors -- is the whole of it.
const JUNCTION_CLUSTER_M = 16.0;
//: Two legs whose ground differs by more than this are on different levels -- the street
//: over a tunnel portal and the road in the cut under it -- and do not meet, however close
//: their nodes are on the map.
const JUNCTION_LEVEL_M = 2.5;
function sameLevelLegs(a, b) { return Math.abs(a.level - b.level) <= JUNCTION_LEVEL_M; }
const cornerLegGrid = new Map();
const cornerLegs = [];
//: `${leg.id}:${side}` -> { cut, corner geometry } for the pavement on that side of that leg,
//: side being left (+1) or right (-1) of the leg as it leaves the junction.
const pavementCornerCuts = new Map();
//: What was actually laid at each cut, recorded by addKerbsidePavement so the corner piece is
//: only put down between two pavements that exist.
const pavementCornerLaid = new Map();

function cornerLegAt(x, y, dx, dy) {
  // The indexed leg leaving this point in this direction, if any. The grid is keyed by the
  // node the way stood on, which a recentred way's end is within RECENTRE_MAX_SHIFT_M of.
  const span = Math.hypot(dx, dy) || 1;
  const ux = dx / span;
  const uy = dy / span;
  const cx = Math.floor(x / CORNER_CELL_M);
  const cy = Math.floor(y / CORNER_CELL_M);
  let best = null;
  let bestScore = -1;
  for (let ix = cx - 2; ix <= cx + 2; ix += 1) {
    for (let iy = cy - 2; iy <= cy + 2; iy += 1) {
      const bucket = cornerLegGrid.get(`${ix}:${iy}`);
      if (!bucket) continue;
      for (const leg of bucket) {
        if (Math.hypot(leg.x - x, leg.y - y) > CORNER_JOIN_M) continue;
        const score = leg.dx * ux + leg.dy * uy;
        if (score > 0.985 && score > bestScore) { best = leg; bestScore = score; }
      }
    }
  }
  return best;
}

function cornerLegsAt(leg) {
  // The other legs of this leg's junction: the ways that shared its node.
  const cx = Math.floor(leg.nx / CORNER_CELL_M);
  const cy = Math.floor(leg.ny / CORNER_CELL_M);
  const out = [];
  for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
    for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
      const bucket = cornerLegGrid.get(`${ix}:${iy}`);
      if (!bucket) continue;
      for (const other of bucket) {
        if (other === leg || !sameLevelLegs(other, leg)) continue;
        if (Math.hypot(other.nx - leg.nx, other.ny - leg.ny) <= CORNER_JOIN_M) out.push(other);
      }
    }
  }
  return out;
}

function cornerNeighbour(leg, side) {
  // The immediately adjacent leg round the junction on this side of this one: anticlockwise
  // for the left.  Do not skip over a same-named fork while searching.  That made A select C
  // across B while C selected B, leaving two non-reciprocal cuts that could never be filled by
  // a corner slab.  The angular wedge belongs to adjacent legs; if those two are one street
  // forking or bending, it simply is not a street corner.
  let best = null;
  let bestTurn = Infinity;
  for (const other of cornerLegsAt(leg)) {
    if (other.way._junctionInternal) continue;
    let turn = other.bearing - leg.bearing;
    turn = ((turn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (side < 0) turn = (2 * Math.PI - turn) % (2 * Math.PI);
    if (turn < 1e-6) continue;
    if (turn < bestTurn) { best = other; bestTurn = turn; }
  }
  if (!best) return null;
  const degrees = (bestTurn * 180) / Math.PI;
  if (degrees < CORNER_MIN_DEG || degrees > CORNER_MAX_DEG) return null;
  if (leg.way.name && best.way.name === leg.way.name) return null;
  return best;
}

function cornerFrame(A, B, side) {
  // The two kerb-side normals: A's toward its pavement on `side`, B's toward the same corner.
  const s = side;
  const a = [A.dx, A.dy];
  const b = [B.dx, B.dy];
  const na = [-s * a[1], s * a[0]];
  const nb = [s * b[1], -s * b[0]];
  const den = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(den) < 1e-6) return null;
  // Each leg measures from its own end: the two are the same node unless one of the ways was
  // recentred onto the city's kerbs, and then they stand a metre or two apart.
  const P = [A.x, A.y];
  const Q = [B.x, B.y];
  const qx = Q[0] - P[0];
  const qy = Q[1] - P[1];
  // Where the line `offA` out from A's centreline meets the line `offB` out from B's, as the
  // distances along each leg from its end.
  const meet = (offA, offB) => {
    const rx = qx + nb[0] * offB - na[0] * offA;
    const ry = qy + nb[1] * offB - na[1] * offA;
    return [(rx * b[1] - ry * b[0]) / den, (rx * a[1] - ry * a[0]) / den];
  };
  const alongA = (t, off) => [P[0] + a[0] * t + na[0] * off, P[1] + a[1] * t + na[1] * off];
  const alongB = (u, off) => [Q[0] + b[0] * u + nb[0] * off, Q[1] + b[1] * u + nb[1] * off];
  // Where A's cut line (across A at `cutA`) meets B's, as the offsets out from each centreline.
  const meetCuts = (cutA, cutB) => {
    const r2x = qx + b[0] * cutB - a[0] * cutA;
    const r2y = qy + b[1] * cutB - a[1] * cutA;
    const d2 = na[0] * nb[1] - na[1] * nb[0];
    if (Math.abs(d2) < 1e-6) return null;
    return [(r2x * nb[1] - r2y * nb[0]) / d2, (r2x * na[1] - r2y * na[0]) / d2];
  };
  return { a, b, na, nb, P, meet, alongA, alongB, meetCuts };
}

function cornerCutFor(A, side) {
  // How far along A its pavement on `side` is cut back at this junction: to where its outer
  // edge meets the outer edge of the next pavement round the corner. Capped as the flat
  // pull-back was, so a short way between two junctions keeps some pavement.
  const B = cornerNeighbour(A, side);
  if (!B) return null;
  const frame = cornerFrame(A, B, side);
  if (!frame) return null;
  const [tK, uK] = frame.meet(legInner(A, side), legInner(B, -side));
  const [tO, uO] = frame.meet(legInner(A, side) + A.walk, legInner(B, -side) + B.walk);
  // The kerb lines must meet in front of the junction on both legs, and the outer edges
  // further out than the kerbs. Where they do not -- a wide street meeting a narrow one at an
  // obtuse angle -- there is no corner square, and the flat pull-back stands.
  if (!(tK > 0 && uK > 0 && tO > tK && uO > uK)) return null;
  // The cut is not capped the way the flat pull-back was. The corner piece covers the ground
  // between the kerb corner and the cut, so nothing is lost to a long one -- and at an acute
  // corner on a wide street it is long: seventeen metres along Broadway where Columbus comes
  // in at fifty degrees. Only a way too short for the corners at both its ends is scaled, in
  // reconcilePavementCorners.
  return { B, frame, cut: tO, tK, uK, tO, uO, valid: false };
}

// ---- bulb-outs ----
//
// Polk Street's kerbs step three metres into the roadway on the approach to Broadway: a
// bulb-out, which shortens the crossing and slows the turn. The crossing was already read off
// the city's kerb lines and ended on the bulb; the pavement was laid a fixed half-width from
// the centreline and stopped at the mid-block kerb, and between the two the crossing appeared
// to stop three metres short of the pavement, in the bike lane. The kerb near a junction is
// where the city's line puts it.
//: How far from a way's end a kerb may step in and be a bulb-out, and how deep one is.
const BULB_ZONE_M = 30.0;
const BULB_MIN_M = 0.5;
const BULB_MAX_M = 5.0;
const BULB_STATION_M = 2.0;
//: Stations nearer the node than this are in the curb return, where the ray finds the cross
//: street's kerb; the corner takes its bulb from the stations just outside that.
const BULB_RETURN_M = 6.0;
const BULB_CORNER_M = 16.0;

function indexBulbOuts(ways) {
  if (!officialCurbGrid.size) return 0;
  let found = 0;
  for (const way of ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
    if (isUnmarkedService(way) || isTunnelWay(way)) continue;
    const inner = renderedRoadWidth(way) / 2;
    const dense = densifyWay(way.points, BULB_STATION_M);
    const length = wayLength(way.points);
    const bulbs = { 1: [], "-1": [] };
    let along = 0;
    for (let i = 0; i < dense.length; i += 1) {
      const [x, y] = xy(dense[i][0], dense[i][1]);
      if (i > 0) {
        const [px, py] = xy(dense[i - 1][0], dense[i - 1][1]);
        along += Math.hypot(x - px, y - py);
      }
      if (along > BULB_ZONE_M && along < length - BULB_ZONE_M) continue;
      const before = dense[Math.max(0, i - 1)];
      const after = dense[Math.min(dense.length - 1, i + 1)];
      const [bx, by] = xy(before[0], before[1]);
      const [ax, ay] = xy(after[0], after[1]);
      const dx = ax - bx;
      const dz = -(ay - by);
      const span = Math.hypot(dx, dz) || 1;
      // The left normal, in the x/z frame the kerb grid is indexed in.
      // Against the kerb line the way is drawn to here -- its envelope where the city's
      // kerbs gave it one -- not the one width down the middle of it.
      const local = way._spans ? halfWidthAt(way, along) : inner;
      const hits = rayCurbIntersections(x, -y, dz / span, -dx / span, local + 0.6, officialCurbGrid);
      for (const side of [1, -1]) {
        const kerb = side > 0 ? hits.find((v) => v > 1.2) : hits.filter((v) => v < -1.2).pop();
        let depth = kerb === undefined ? 0 : local - Math.abs(kerb);
        if (depth < BULB_MIN_M || depth > BULB_MAX_M) depth = 0;
        bulbs[side].push([along, depth]);
      }
    }
    // A station keeps its depth only where a neighbour agrees with it: one stray hit is a
    // parked kerb line crossing the ray, not a bulb.
    let any = false;
    for (const side of [1, -1]) {
      const list = bulbs[side];
      const kept = list.map(([along, depth], i) => {
        if (!depth) return [along, 0];
        const agree = [list[i - 1], list[i + 1]].some(
          (n) => n && n[1] && Math.abs(n[1] - depth) < 0.4);
        return [along, agree ? depth : 0];
      });
      bulbs[side] = kept;
      if (kept.some(([, d]) => d > 0)) any = true;
    }
    if (any) { way._bulbs = bulbs; found += 1; }
  }
  return found;
}

function bulbDepthAt(way, side, along) {
  // The bulb at this distance along the way, on this side of travel.
  const list = way && way._bulbs && way._bulbs[side];
  if (!list) return 0;
  let best = null;
  for (const station of list) {
    const gap = Math.abs(station[0] - along);
    if (gap <= BULB_STATION_M * 0.75 && (!best || gap < best[0])) best = [gap, station[1]];
  }
  return best ? best[1] : 0;
}

function legBulb(leg, side) {
  // The bulb a corner is built to: the median of the city's kerb, measured straight out from
  // the leg between the curb return and the far end of the approach, on the leg's own side.
  // Measured from the leg rather than read off the way, because OpenStreetMap splits a street
  // at every driveway node: Polk leaves Broadway as an eleven metre piece, and the approach
  // runs on into the next way.
  if (!officialCurbGrid.size) return 0;
  const depths = [];
  const nx = -side * leg.dy, nz = -side * leg.dx;                // outward, in x/z
  for (let t = BULB_RETURN_M; t <= BULB_CORNER_M; t += BULB_STATION_M) {
    const x = leg.x + leg.dx * t;
    const z = -(leg.y + leg.dy * t);
    const kerb = rayCurbIntersections(x, z, nx, nz, leg.inner + 0.6, officialCurbGrid)
      .find((v) => v > 1.2);
    if (kerb === undefined) continue;
    const depth = leg.inner - kerb;
    if (depth >= BULB_MIN_M && depth <= BULB_MAX_M) depths.push(depth);
  }
  if (depths.length < 2) return 0;
  depths.sort((p, q) => p - q);
  const median = depths[Math.floor(depths.length / 2)];
  // They have to agree: a kerb read at two depths is a return, not a bulb.
  if (depths[depths.length - 1] - depths[0] > 1.0) return 0;
  return median;
}

//: A leg's kerb line on one of its sides: its half road width, less the bulb-out there.
function legInner(leg, side) {
  return leg.inner - ((leg.bulb && leg.bulb[side]) || 0);
}

function streetCarryOn(leg) {
  // How far the street continues straight through this leg's node, as the length of the leg
  // of the same street that leaves it the other way -- or nothing, at a junction.
  if (!leg || !leg.way.name) return 0;
  let best = 0;
  for (const other of cornerLegsAt(leg)) {
    if (other.way === leg.way || other.way.name !== leg.way.name) continue;
    let turn = Math.abs(other.bearing - leg.bearing) * 180 / Math.PI;
    turn = Math.abs(((turn + 180) % 360) - 180);
    if (Math.abs(turn - 180) > STREET_JOIN_DEG) continue;
    best = Math.max(best, Math.min(other.length, 60));
  }
  return best;
}

function reconcilePavementCorners() {
  // Two passes over the decided cuts. First, a way whose two corners between them want more
  // than its length gives both up proportionally, so they meet rather than overlap. Then each corner is checked as the piece that will be laid -- its kerb
  // meeting before its cut, the two cut lines meeting outside both kerbs -- and only a corner
  // that passes makes a cut. A cut without the piece that fills up to it is the hole.
  // The whole of it: a nine metre stub of Broadway between Columbus and the next street is
  // two corners and nothing else, and that is what it is drawn as.
  const SHARE = 1.0;
  for (const leg of cornerLegs) {
    if (leg.end !== 0 || !leg.far) continue;
    for (const side of [1, -1]) {
      const near = pavementCornerCuts.get(`${leg.id}:${side}`);
      const far = pavementCornerCuts.get(`${leg.far.id}:${-side}`);
      // A way that ends where its street carries on -- OpenStreetMap splits a street at
      // every change of tagging -- has that much more room: Polk Street leaves Broadway as an
      // eleven metre piece, and the corner against Broadway's eighteen metres of carriageway
      // wants fourteen of it. Squeezed to eleven the corner failed its own check and the
      // pavement was cut on the diagonal with nothing filling it.
      const room = (leg.length + (near ? 0 : streetCarryOn(leg))
        + (far ? 0 : streetCarryOn(leg.far))) * SHARE;
      const want = (near ? near.cut : 0) + (far ? far.cut : 0);
      if (want <= room) continue;
      // Each corner keeps at least its kerb corner, and what room is left beyond the two kerb
      // corners is shared in proportion to how much each wanted past its own.
      const floorOf = (c) => (c ? c.tK + KERB_LIP_M + 0.25 : 0);
      const floors = floorOf(near) + floorOf(far);
      const beyond = (c) => (c ? Math.max(0, c.tO - floorOf(c)) : 0);
      const wanted = beyond(near) + beyond(far);
      const spare = Math.max(0, room - floors);
      const factor = wanted > 0 ? Math.min(1, spare / wanted) : 0;
      if (near) near.cut = floorOf(near) + beyond(near) * factor;
      if (far) far.cut = floorOf(far) + beyond(far) * factor;
    }
  }
  const lip = KERB_LIP_M;
  for (const leg of cornerLegs) {
    for (const side of [1, -1]) {
      const corner = pavementCornerCuts.get(`${leg.id}:${side}`);
      if (!corner) continue;
      const other = pavementCornerCuts.get(`${corner.B.id}:${-side}`);
      if (!other || other.B !== leg) continue;
      const [tKl, uKl] = corner.frame.meet(legInner(leg, side) + lip, legInner(corner.B, -side) + lip);
      const cuts = corner.frame.meetCuts(corner.cut, other.cut);
      if (!cuts) continue;
      const [vC, wC] = cuts;
      if (!(corner.cut > tKl + 0.05 && other.cut > uKl + 0.05)) continue;
      if (!(vC > legInner(leg, side) + lip + 0.2 && wC > legInner(corner.B, -side) + lip + 0.2)) continue;
      corner.valid = true;
    }
  }
  let valid = 0;
  for (const corner of pavementCornerCuts.values()) if (corner.valid) valid += 1;
  return valid;
}

function indexPavementCorners(ways) {
  cornerLegGrid.clear();
  cornerLegs.length = 0;
  pavementCornerCuts.clear();
  pavementCornerLaid.clear();
  for (const way of ways) {
    if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
    // A driveway has no pavement of its own; the street's runs across its mouth as an apron.
    // A tunnel's pavement is inside the hill. A busway is lanes in the middle of an avenue: no
    // pavement, no corners, and where its pieces split round a platform and join again that
    // is not a junction -- it was boxed as one, and the red lane stopped at every station.
    if (isUnmarkedService(way) || isTunnelWay(way) || way.busway) continue;
    const n = way.points.length;
    const walk = renderedWalkWidth(way, 4.0);
    const length = wayLength(way.points);
    for (const [end, next] of [[0, 1], [n - 1, n - 2]]) {
      const inner = way._spans ? Math.max(renderedRoadWidth(way) / 2, halfWidthAt(way, end === 0 ? 0 : length))
        : renderedRoadWidth(way) / 2;
      const [ex, ey] = xy(way.points[end][0], way.points[end][1]);
      const [nx2, ny2] = xy(way.points[next][0], way.points[next][1]);
      const span = Math.hypot(nx2 - ex, ny2 - ey);
      if (span < 1e-6) continue;
      // A way moved onto the city's kerbs no longer ends on the node it shares with the
      // streets that meet it; the junction is still where the node was.
      const node = way._node ? xy(way._node[end === 0 ? 0 : 1][0], way._node[end === 0 ? 0 : 1][1])
        : [ex, ey];
      const leg = {
        id: cornerLegs.length, x: ex, y: ey, nx: node[0], ny: node[1],
        dx: (nx2 - ex) / span, dy: (ny2 - ey) / span,
        bearing: Math.atan2(ny2 - ey, nx2 - ex), inner, walk, length, way, end, far: null,
        // The ground this leg's way stands on at the node: the cut's road for a way in a cut.
        level: (wayFollowsCut(way) ? cutLiftAt : groundLiftAt)(node[0], -node[1]),
      };
      leg.bulb = { 1: legBulb(leg, 1), "-1": legBulb(leg, -1) };
      // The leg at the other end of the same way, so a short way can share itself out.
      if (end !== 0) {
        const start = cornerLegs[cornerLegs.length - 1];
        if (start && start.way === way && start.end === 0) { start.far = leg; leg.far = start; }
      }
      cornerLegs.push(leg);
      const key = `${Math.floor(node[0] / CORNER_CELL_M)}:${Math.floor(node[1] / CORNER_CELL_M)}`;
      let bucket = cornerLegGrid.get(key);
      if (!bucket) cornerLegGrid.set(key, bucket = []);
      bucket.push(leg);
    }
  }
  // A way that runs from one node of a junction to another node of the same junction is the
  // junction, not a street: the connectors OpenStreetMap draws across the Embarcadero's
  // median between its two carriageways. They were getting a pavement down each side, laid
  // in the middle of the crossroads, and a corner piece where they met the carriageways.
  for (const leg of cornerLegs) {
    if (leg.end !== 0 || !leg.far) continue;
    if (leg.length > JUNCTION_CLUSTER_M) continue;
    if (Math.hypot(leg.far.nx - leg.nx, leg.far.ny - leg.ny) > JUNCTION_CLUSTER_M) continue;
    if (cornerLegsAt(leg).length < 2 || cornerLegsAt(leg.far).length < 2) continue;
    leg.way._junctionInternal = true;
  }
  // The box of each junction, and where each leg leaves it. A pavement with no corner to
  // meet -- its neighbour round the junction is one of those connectors -- starts where its
  // street leaves the box rather than a fixed pull-back from its node, which on the
  // Embarcadero's median left a strip of pavement standing in the crossroads.
  junctionBoxHulls.length = 0;
  junctionBoxGrid.clear();
  for (const legs of junctionClusters()) {
    if (legs.length < 3) continue;
    const hull = junctionBoxHull(legs);
    if (hull.length < 3) continue;
    junctionBoxHulls.push(hull);
    indexJunctionBox(hull);
    for (const leg of legs) {
      let t = 0;
      const limit = Math.min(leg.length, 60);
      while (t < limit && pointInRing(leg.x + leg.dx * t, leg.y + leg.dy * t, hull)) t += 0.5;
      leg.boxExit = t;
    }
  }
  for (const leg of cornerLegs) {
    if (leg.way._junctionInternal) continue;
    for (const side of [1, -1]) {
      const corner = cornerCutFor(leg, side);
      if (corner) pavementCornerCuts.set(`${leg.id}:${side}`, corner);
    }
  }
  return reconcilePavementCorners();
}

const junctionBoxHulls = [];
const JUNCTION_BOX_CELL_M = 30;
const junctionBoxGrid = new Map();

function indexJunctionBox(hull) {
  const xs = hull.map((q) => q[0]);
  const ys = hull.map((q) => q[1]);
  const x0 = Math.floor(Math.min(...xs) / JUNCTION_BOX_CELL_M);
  const x1 = Math.floor(Math.max(...xs) / JUNCTION_BOX_CELL_M);
  const y0 = Math.floor(Math.min(...ys) / JUNCTION_BOX_CELL_M);
  const y1 = Math.floor(Math.max(...ys) / JUNCTION_BOX_CELL_M);
  for (let ix = x0; ix <= x1; ix += 1) {
    for (let iy = y0; iy <= y1; iy += 1) {
      const key = `${ix}:${iy}`;
      let bucket = junctionBoxGrid.get(key);
      if (!bucket) junctionBoxGrid.set(key, bucket = []);
      bucket.push(hull);
    }
  }
}

function insideJunctionBox(x, z) {
  // Is this point (in the x/z frame) inside a junction's box? The box is roadway whatever the
  // ways through it say: the Embarcadero's carriageways carry on through their junction with
  // Broadway, and their median-side pavements carried on with them, into the crossroads.
  const y = -z;
  const bucket = junctionBoxGrid.get(
    `${Math.floor(x / JUNCTION_BOX_CELL_M)}:${Math.floor(y / JUNCTION_BOX_CELL_M)}`);
  if (!bucket) return false;
  for (const hull of bucket) if (pointInRing(x, y, hull)) return true;
  return false;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function junctionBoxHull(legs) {
  // Each leg's carriageway across its mouth, from its end to as far in as the widest leg
  // crossing it reaches.
  const widest = Math.max(...legs.map((l) => l.inner));
  const points = [];
  for (const l of legs) {
    const reach = Math.min(widest, l.length * 0.5);
    for (const t of [0, reach]) {
      for (const side of [1, -1]) {
        points.push([l.x + l.dx * t - side * l.dy * l.inner, l.y + l.dy * t + side * l.dx * l.inner]);
      }
    }
  }
  return convexHull(points);
}

function cornerQuad(leg, side) {
  // The corner piece for the pavement on this side of this leg, inset by the kerb tile: the
  // kerb-line meeting point, this pavement's cut on the kerb line, the meeting of the two cut
  // lines, and the other pavement's cut on its kerb line. Plus the kerb tile's own centreline
  // round the curb return. All in metres east and north of the origin.
  const corner = pavementCornerCuts.get(`${leg.id}:${side}`);
  if (!corner || !corner.valid) return null;
  const { B, frame } = corner;
  const other = pavementCornerCuts.get(`${B.id}:${-side}`);
  if (!other || !other.valid || other.B !== leg) return null;
  const cutA = corner.cut;
  const cutB = other.cut;
  const lip = KERB_LIP_M;
  const innerA = legInner(leg, side);
  const innerB = legInner(B, -side);
  const [tK] = frame.meet(innerA + lip, innerB + lip);
  const cuts = frame.meetCuts(cutA, cutB);
  if (!cuts) return null;
  const [vC] = cuts;
  const K = frame.alongA(tK, innerA + lip);
  const A1 = frame.alongA(cutA, innerA + lip);
  const C = frame.alongA(cutA, vC);
  const B1 = frame.alongB(cutB, innerB + lip);
  const [tk2] = frame.meet(innerA + lip / 2, innerB + lip / 2);
  const kerb = [frame.alongA(cutA, innerA + lip / 2), frame.alongA(tk2, innerA + lip / 2),
                frame.alongB(cutB, innerB + lip / 2)];
  return { K, A1, C, B1, kerb, frame, cutA, cutB, vC };
}

// ---- the junction box ----
//
// A junction is drawn as the ends of the ways that meet at it, and where they meet cleanly at
// one node the box is covered by their overlap. Where they do not -- the Embarcadero's
// junctions, drawn by OpenStreetMap as six ways ending on three nodes, or any junction whose
// ways were moved onto the city's kerbs -- the box has pockets in it that no ribbon reaches,
// and the low concrete underlay showed through them as pale slabs in the middle of the road.
// The box is its own piece of asphalt: the hull of every leg's carriageway across its mouth,
// a shade under the ribbons so it never fights them and shows only where they are not.
const JUNCTION_BOX_DROP_M = 0.004;

function junctionClusters() {
  // Every leg's node, merged with the nodes within JUNCTION_CLUSTER_M of it.
  const parent = cornerLegs.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const cell = JUNCTION_CLUSTER_M;
  const grid = new Map();
  for (const leg of cornerLegs) {
    const key = `${Math.floor(leg.nx / cell)}:${Math.floor(leg.ny / cell)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, bucket = []);
    bucket.push(leg);
  }
  for (const leg of cornerLegs) {
    const cx = Math.floor(leg.nx / cell);
    const cy = Math.floor(leg.ny / cell);
    for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
      for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
        for (const other of grid.get(`${ix}:${iy}`) || []) {
          if (other.id <= leg.id || !sameLevelLegs(other, leg)) continue;
          if (Math.hypot(other.nx - leg.nx, other.ny - leg.ny) <= JUNCTION_CLUSTER_M) {
            parent[find(other.id)] = find(leg.id);
          }
        }
      }
    }
  }
  const clusters = new Map();
  for (const leg of cornerLegs) {
    const root = find(leg.id);
    let members = clusters.get(root);
    if (!members) clusters.set(root, members = []);
    members.push(leg);
  }
  return [...clusters.values()];
}

function addJunctionBoxes() {
  let laid = 0;
  const top = ROAD_TOP_M - JUNCTION_BOX_DROP_M;
  for (const hull of junctionBoxHulls) {
    const position = [];
    const uv = [];
    const index = [];
    let cx = 0, cz = 0;
    for (const [x, y] of hull) {
      position.push(x, top, -y);
      uv.push(x / 8.0, -y / 8.0);
      cx += x / hull.length; cz -= y / hull.length;
    }
    // A junction in a cut is at the cut's road level, whatever the grid says under the deck's edge.
    WAY_LIFT = approachRoadAt(cx, cz) !== null ? cutLiftAt : null;
    for (let i = 1; i + 1 < hull.length; i += 1) index.push(0, i + 1, i);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, surfaceMaterial("road", 0xffffff, 1.0));
    mesh.userData.surface = "road";
    addMerged("junction:box", mesh, "road");
    laid += 1;
  }
  WAY_LIFT = null;
  return laid;
}

//: A flat-topped piece of pavement over a convex ring of points (metres east and north), with a
//: kerb face down to `bottom` along each of the edges named (index pairs into the ring) -- the
//: edges that face the road. Without the faces a slab stood on its kerb line is a lid: from
//: the road you saw under it, a slit of sky the depth of the kerb.
function squarePavementMesh(ring, kerbEdges, topAt, bottom, uOf, vOf, color, opacity) {
  if (!ring || ring.length < 3 || ring.some((q) => !q || !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) return null;
  // Counter-clockwise from above (east, north), so the triangles face up.
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [ax, an] = ring[i], [bx, bn] = ring[(i + 1) % ring.length];
    area += ax * bn - bx * an;
  }
  if (!(Math.abs(area) > 0.05)) return null;
  const order = area > 0 ? ring.map((_, i) => i) : ring.map((_, i) => ring.length - 1 - i);
  const position = [];
  const uv = [];
  const index = [];
  for (const i of order) {
    const q = ring[i];
    position.push(q[0], topAt(q), -q[1]);
    uv.push(uOf(q), vOf(q));
  }
  // Counter-clockwise in (east, north) is counter-clockwise seen from above, which faces up.
  for (let i = 1; i + 1 < order.length; i += 1) index.push(0, i, i + 1);
  for (const [a, b] of kerbEdges) {
    const qa = ring[a], qb = ring[b];
    const base = position.length / 3;
    const run = Math.hypot(qb[0] - qa[0], qb[1] - qa[1]) / WALK_UV_M, face = 0.15 / WALK_UV_M;
    position.push(qa[0], topAt(qa), -qa[1], qb[0], topAt(qb), -qb[1],
                  qb[0], bottom, -qb[1], qa[0], bottom, -qa[1]);
    uv.push(0, 0, run, 0, run, face, 0, face);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, surfaceMaterial("walk", color, opacity));
  mesh.userData.surface = "walk";
  return mesh;
}

// ---- the square at every corner ----
//
// The corner pieces above are made where a street's way ends at a junction. Where two streets
// both carry on through it -- Hyde across Union, most of the grid -- no way ends, no corner was
// decided, and the corner was left to the two pavements, each of which stops where the other
// street's carriageway begins, a few decimetres short of the kerb line and on its own sampling.
// What met there was two ragged ends, a notch of road between them and the curb's curve stood
// in it: a corner of five or six sides where there should be four. Every corner of every
// junction is now completed as the square the two pavements make between them -- the strip
// between each street's kerb line and the far side of the other's pavement -- drawn over both
// pavement ends in the same concrete, with its kerb faces down to the road. It is inferred, not
// measured: its shape is the two pavements', and nothing here says the city's corner is square.
const JUNCTION_SQUARE_MIN_DEG = 35;
//: A pavement narrower than this is not one to make a corner of.
const JUNCTION_SQUARE_MIN_WALK_M = 1.0;
//: Where the two pavements stand at different heights, the square takes the higher and runs down
//: to the lower over this much of it -- a slope, not a cut.
const JUNCTION_SQUARE_RAMP_M = 1.5;
const junctionSquares = [];

function streetForSquares(way) {
  return Boolean(way && way.kind === "street" && !isUnmarkedService(way) && !isTunnelWay(way)
    && !way.busway && !way._junctionInternal && !wayFollowsCut(way) && !way.bridge);
}

function carriagewayAlong(x, z, bearing, name, ways) {
  // Is (x, z) on a carriageway running this way: the street itself, or the next piece of it.
  const cx = Math.floor(x / CARRIAGEWAY_CELL), cz = Math.floor(z / CARRIAGEWAY_CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const [ax, az, bx, bz, half, other, source] of carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz)) || []) {
        if (!source || !(ways.includes(source) || (name && source.name === name))) continue;
        let difference = Math.abs(other - bearing) % Math.PI;
        if (difference > Math.PI / 2) difference = Math.PI - difference;
        if (difference > Math.PI / 6) continue;
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < half * half) return true;
      }
    }
  }
  return false;
}

function onThirdCarriageway(x, z, names, ways) {
  // On the body of a carriageway that is neither of the two streets nor a piece of either.
  const cx = Math.floor(x / CARRIAGEWAY_CELL), cz = Math.floor(z / CARRIAGEWAY_CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (const [ax, az, bx, bz, half, , source] of carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz)) || []) {
        if (!source || ways.includes(source) || (source.name && names.includes(source.name))) continue;
        if (isUnmarkedService(source)) continue;
        const limit = Math.max(0, half - 0.15);
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) < limit * limit) return true;
      }
    }
  }
  return false;
}

function junctionCrossings() {
  // Every place two streets' centrelines cross at a real angle, from the carriageway segments:
  // [x, z] of the crossing, and each street's segment there (unit direction, kerb offset, way).
  const found = [];
  const seen = new Map();
  const wayIndex = new Map(DATA.ways.map((w, i) => [w, i]));
  const minSin = Math.sin(JUNCTION_SQUARE_MIN_DEG * Math.PI / 180);
  for (const bucket of carriagewayGrid.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      const [ax, az, bx, bz, ha, , wa] = bucket[i];
      if (!streetForSquares(wa)) continue;
      const la = Math.hypot(bx - ax, bz - az);
      if (la < 0.5) continue;
      for (let j = i + 1; j < bucket.length; j += 1) {
        const [cx, cz, dx, dz, hb, , wb] = bucket[j];
        if (wb === wa || !streetForSquares(wb) || (wa.name && wa.name === wb.name)) continue;
        if (Math.abs(wa.layer || 0) !== Math.abs(wb.layer || 0)) continue;
        const lb = Math.hypot(dx - cx, dz - cz);
        if (lb < 0.5) continue;
        const ux = (bx - ax) / la, uz = (bz - az) / la, vx = (dx - cx) / lb, vz = (dz - cz) / lb;
        const cross = ux * vz - uz * vx;
        if (Math.abs(cross) < minSin) continue;
        // Where the two lines meet, as distances along each segment.
        const qx = cx - ax, qz = cz - az;
        const s = (qx * vz - qz * vx) / cross;
        const t = (qx * uz - qz * ux) / cross;
        // Reaching a little past each segment's ends, for a street that stops at the other's
        // centreline (or at its kerb, where the city's kerbs moved it).
        const reachA = hb + 1.0, reachB = ha + 1.0;
        if (s < -reachA || s > la + reachA || t < -reachB || t > lb + reachB) continue;
        const x = ax + ux * s, z = az + uz * s;
        // One junction once, however many of its streets' segments and cells find it: a street
        // split at the junction finds it from both pieces. Named streets by their names, an
        // unnamed one by its way.
        const label = (w) => w.name || `#${wayIndex.get(w)}`;
        const pair = [label(wa), label(wb)].sort().join("|");
        const near = seen.get(pair) || [];
        if (near.some(([px, pz]) => Math.hypot(px - x, pz - z) < Math.max(8, ha + hb))) continue;
        near.push([x, z]);
        seen.set(pair, near);
        found.push({ x, z, a: { ux, uz, half: ha, way: wa }, b: { ux: vx, uz: vz, half: hb, way: wb } });
      }
    }
  }
  return found;
}

function addJunctionSquares() {
  junctionSquares.length = 0;
  let laid = 0;
  const skipped = { noPavement: 0, onRoad: 0, shape: 0 };
  addJunctionSquares.skipped = skipped;
  for (const junction of junctionCrossings()) {
    const { a, b } = junction;
    // Left normals in x/z; offsets across each street are measured along them.
    const nA = [-a.uz, a.ux], nB = [-b.uz, b.ux];
    const dBnA = b.ux * nA[0] + b.uz * nA[1];
    const dAnB = a.ux * nB[0] + a.uz * nB[1];
    // The point offset u across A and v across B from the crossing.
    const at = (u, v) => [junction.x + a.ux * (v / dAnB) + b.ux * (u / dBnA),
                          junction.z + a.uz * (v / dAnB) + b.uz * (u / dBnA)];
    const names = [a.way.name, b.way.name].filter(Boolean);
    const ways = [a.way, b.way];
    const bearingA = Math.atan2(a.uz, a.ux), bearingB = Math.atan2(b.uz, b.ux);
    // Which sides of A the street B goes on to, and which sides of B the street A does.
    const sidesOf = (s, other, bearing, way) => [1, -1].filter((dir) => {
      const px = junction.x + s.ux * dir * (other.half + 2.5), pz = junction.z + s.uz * dir * (other.half + 2.5);
      return carriagewayAlong(px, pz, bearing, way.name, [way]);
    }).map((dir) => Math.sign(dir * (s === b ? dBnA : dAnB)));
    const bSides = sidesOf(b, a, bearingB, b.way);   // sides of A that B reaches
    const aSides = sidesOf(a, b, bearingA, a.way);   // sides of B that A reaches
    for (const sa of [1, -1]) {
      for (const sb of [1, -1]) {
        if (!bSides.includes(sa) || !aSides.includes(sb)) continue;
        const hA = a.half, hB = b.half;
        // Each pavement's width: the street's own, no further than the building line.
        let eA = renderedWalkWidth(a.way, 4.0), eB = renderedWalkWidth(b.way, 4.0);
        const facade = (u0, v0, dirx, dirz, nominal) => {
          const [px, pz] = at(u0, v0);
          const d = rayFootprintDistance(px, pz, dirx, dirz, nominal + 1.0);
          return d === null ? nominal : Math.max(JUNCTION_SQUARE_MIN_WALK_M, Math.min(nominal, d - FACADE_GAP_M));
        };
        eA = facade(sa * hA, sb * (hB + eB + 1.0), sa * nA[0], sa * nA[1], eA);
        eB = facade(sa * (hA + eA + 1.0), sb * hB, sb * nB[0], sb * nB[1], eB);
        // And there has to be pavement there to complete: each band, just past the square.
        const topOf = (points) => {
          let top;
          for (const [px, pz] of points) {
            const here = pavementTopAt(px, pz);
            if (here !== undefined && (top === undefined || here > top)) top = here;
          }
          return top;
        };
        const topA = topOf([at(sa * (hA + eA / 2), sb * (hB + eB + 1.2)), at(sa * (hA + eA / 2), sb * (hB + eB + 3.0))]);
        const topB = topOf([at(sa * (hA + eA + 1.2), sb * (hB + eB / 2)), at(sa * (hA + eA + 3.0), sb * (hB + eB / 2))]);
        if (topA === undefined || topB === undefined || eA < JUNCTION_SQUARE_MIN_WALK_M || eB < JUNCTION_SQUARE_MIN_WALK_M) {
          skipped.noPavement += 1;
          continue;
        }
        const K = at(sa * hA, sb * hB);
        const A1 = at(sa * hA, sb * (hB + eB));
        const C = at(sa * (hA + eA), sb * (hB + eB));
        const B1 = at(sa * (hA + eA), sb * hB);
        const mid = [(K[0] + C[0]) / 2, (K[1] + C[1]) / 2];
        if ([mid, K, A1, C, B1].some(([px, pz]) => onThirdCarriageway(px + (mid[0] - px) * 0.2, pz + (mid[1] - pz) * 0.2, names, ways))) {
          skipped.onRoad += 1;
          continue;
        }
        const top = Math.max(topA, topB) + 0.002;
        // Tiled square to street A, as A's pavement is.
        const uOf = (q) => (q[0] * a.ux + q[1] * a.uz) / WALK_UV_M;
        const vOf = (q) => (q[0] * nA[0] + q[1] * nA[1]) / WALK_UV_M;
        // The ring in metres east and north, which is what the mesh is built from.
        const en = (q) => [q[0], -q[1]];
        const square = squarePavementMesh([K, A1, C, B1].map(en), [[0, 1], [3, 0]], () => top,
          ROAD_TOP_M - 0.02, (q) => uOf(en(q)), (q) => vOf(en(q)), 0xffffff, 1.0);
        if (!square) { skipped.shape += 1; continue; }
        addMerged("walk:corner-square", square, "walk");
        // Down to the lower pavement, over the start of it: a slope, not a step. The ramp lies
        // on the lower pavement beyond the square's edge, from the square's height at that edge
        // to the pavement's own a ramp's length on; its kerb face continues the square's.
        const R = JUNCTION_SQUARE_RAMP_M;
        const ramps = [
          // A's pavement, past the edge A1-C.
          [topA, [A1, C, at(sa * (hA + eA), sb * (hB + eB + R)), at(sa * hA, sb * (hB + eB + R))]],
          // B's pavement, past the edge B1-C.
          [topB, [B1, C, at(sa * (hA + eA + R), sb * (hB + eB)), at(sa * (hA + eA + R), sb * hB)]],
        ];
        for (const [lower, corners] of ramps) {
          if (!(top - lower > 0.006)) continue;
          const ring = corners.map(en);
          const heights = new Map([[ring[0], top], [ring[1], top], [ring[2], lower + 0.002], [ring[3], lower + 0.002]]);
          const ramp = squarePavementMesh(ring, [[3, 0]], (q) => heights.get(q), ROAD_TOP_M - 0.02,
            (q) => uOf(en(q)), (q) => vOf(en(q)), 0xffffff, 1.0);
          if (ramp) addMerged("walk:corner-square", ramp, "walk");
        }
        stampPaved([lonLatFromXZ(K[0], K[1]), lonLatFromXZ(C[0], C[1])], Math.max(eA, eB) * 1.2, top);
        stampPavedRing([K, A1, C, B1], top);
        junctionSquares.push({ x: +mid[0].toFixed(2), z: +mid[1].toFixed(2), streets: names,
                               basis: "inferred", top: +top.toFixed(3),
                               // The kerb corner, and how far round it a curb return reaches.
                               kx: K[0], kz: K[1], reach: Math.max(eA, eB) + 2.0,
                               // Its outline: a measured kerb inside it or along its kerb lines is its own to draw.
                               ring: [K, A1, C, B1].map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]) });
        laid += 1;
      }
    }
  }
  return laid;
}

function addPavementCorners() {
  // Every corner between two pavements that were both laid up to their cuts.
  let laid = 0;
  const seen = new Set();
  // Why a cut got no piece, kept for the audit: each is a place to look.
  const skipped = { unlaid: 0, shape: 0, onRoad: 0 };
  addPavementCorners.skipped = skipped;
  for (const leg of cornerLegs) {
    for (const side of [1, -1]) {
      const corner = pavementCornerCuts.get(`${leg.id}:${side}`);
      if (!corner || !corner.valid) continue;
      const pairKey = side > 0 ? `${leg.id}:${corner.B.id}` : `${corner.B.id}:${leg.id}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      // The corner is a piece of ground in its own right: it is laid whenever its shape is
      // sound and it is off the road, whether or not the pavement beside it survived its
      // own fit -- a corner with a blocked pavement behind it is still a corner. The side
      // that was drawn lends its height, thickness and colour; if neither was, there is no
      // pavement here to be the corner of.
      // Neither side had a derived pavement -- OpenStreetMap maps both as footways of their
      // own, and the derived one stands down -- so the corner is laid as those are: the
      // fallback kerb, a centimetre and a half under the mapped footway, in the same white.
      const mine = pavementCornerLaid.get(`${leg.id}:${side}`)
        || pavementCornerLaid.get(`${corner.B.id}:${-side}`)
        || { width: 0, y: ROAD_TOP_M + KERB_FALLBACK / 2 - KERBSIDE_BELOW_MAPPED_M, thickness: KERB_FALLBACK,
             color: 0xffffff, opacity: 1.0 };
      if (!mine) { skipped.unlaid += 1; continue; }
      const quad = cornerQuad(leg, side);
      if (!quad) { skipped.shape += 1; continue; }
      const { K, A1, C, B1, kerb, frame, cutA, vC } = quad;
      // On the road after all -- a slip lane, a third carriageway through the wedge, a
      // junction box drawn wider than its legs. Asked of the middle and of each corner of the
      // piece pulled a little way in, since a piece can be clear at its centre and still have
      // a carriageway across one end of it.
      const mid = [(K[0] + A1[0] + C[0] + B1[0]) / 4, (K[1] + A1[1] + C[1] + B1[1]) / 4];
      const samples = [mid];
      for (const q of [K, A1, C, B1]) {
        samples.push([q[0] + (mid[0] - q[0]) * 0.2, q[1] + (mid[1] - q[1]) * 0.2]);
      }
      const legs = [leg.way, corner.B.way];
      if (samples.some(([sx, sy]) => onAnotherCarriageway(sx, -sy, 0.15, legs))) {
        skipped.onRoad += 1;
        continue;
      }
      const y = mine.y;
      const thickness = mine.thickness;
      const top = y + thickness / 2;
      // The slab, tiled in the pavement's own frame so its flags continue round the corner:
      // u runs along the leg from the cut, v across from the outer edge, as the ribbon's do.
      const uOf = (q) => ((q[0] - frame.P[0]) * frame.a[0] + (q[1] - frame.P[1]) * frame.a[1] - cutA) / WALK_UV_M;
      const vOf = (q) => (vC - ((q[0] - frame.P[0]) * frame.na[0] + (q[1] - frame.P[1]) * frame.na[1])) / WALK_UV_M;
      // Square to the kerb lines, with no kerb strip of its own round the return: the strip
      // was a curve of separate tile stood on the corner, and where it met the straight kerbs
      // either side the joins showed as slivers of road. The slab now reaches the two kerb lines
      // and carries its own kerb faces down to the road, so the corner is one square of
      // pavement that meets the kerbs either side flush.
      const [tKerb] = frame.meet(legInner(leg, side), legInner(corner.B, -side));
      const K0 = frame.alongA(tKerb, legInner(leg, side));
      const A0 = frame.alongA(cutA, legInner(leg, side));
      const B0 = frame.alongB(quad.cutB ?? cutA, legInner(corner.B, -side));
      const mesh = squarePavementMesh([K0, A0, C, B0], [[0, 1], [3, 0]], () => top,
        ROAD_TOP_M - 0.02, uOf, vOf, mine.color, mine.opacity);
      if (!mesh) { skipped.shape += 1; continue; }
      addMerged(`walk:walk:${(Math.round(thickness / 0.05) * 0.05).toFixed(2)}`, mesh, "walk");
      stampPaved([lonLatFromXZ(K0[0], -K0[1]), lonLatFromXZ(C[0], -C[1])],
                 Math.hypot(A0[0] - K0[0], A0[1] - K0[1]), top);
      stampPavedRing([K0, A0, C, B0].map(([east, north]) => [east, -north]), top);
      laid += 1;
    }
  }
  return laid;
}

function laneMarkingProfile(way, road = renderedRoadWidth(way)) {
  const oneway = onewaySign(way) !== 0;
  // From the cross-sections where the way has them, read at its middle station.
  if (way.xs && way.xs.length) {
    const bands = crossSectionBandsNearMiddle(way, road / 2);
    if (bands) {
      const travel = bands.filter((b) => b.kind === "travel" || b.kind === "turn");
      const forward = travel.filter((b) => b.dir === 1).length;
      const backward = travel.filter((b) => b.dir === -1).length;
      const shared = travel.some((b) => b.sub === "shared");
      return { oneway, total: travel.length, forward, backward,
               opposing: !oneway && !shared && backward > 0 && forward > 0,
               road, left: travel[0].left, right: travel[travel.length - 1].right,
               travel: travel[0].left - travel[travel.length - 1].right, fromCrossSection: true };
    }
    if (!(typeof KERB_RENDER_UNIFORM !== "undefined" && KERB_RENDER_UNIFORM)) {
      return { oneway, total: 0, forward: 0, backward: 0, opposing: false, road,
               left: road / 2, right: -road / 2, travel: road, fromCrossSection: true };
    }
  }
  const tagged = way.lanes || 0;
  const forward = way.lanes_fwd || (oneway ? tagged : Math.floor(tagged / 2));
  const backward = way.lanes_back || (oneway ? 0 : Math.floor(tagged / 2));
  const explicitTotal = oneway ? (forward || tagged || 0)
    : (way.lanes_fwd || way.lanes_back ? (forward || 0) + (backward || 0) : tagged);
  // Lanes are only guessed from the width of a street that is one. A way with no name is a
  // connector through a junction -- a slip, a turning link, the piece of the Embarcadero's
  // box that OpenStreetMap draws as its own way -- and at 17.6 m across it was guessed to
  // have four lanes, so three white lines ran diagonally through the crossroads.
  const named = Boolean(way.name);
  const [left, right] = travelSpan(way, road);
  const travel = left - right;
  const inferredTotal = explicitTotal || !named ? 0
    : travel >= 13.8 ? 4 : travel >= 9.0 ? 2 : travel >= 6.2 && oneway ? 2 : 1;
  const total = explicitTotal || inferredTotal;
  const opposing = !oneway && (explicitTotal ? total >= 2 : named && travel >= 5.6);
  return { oneway, total, forward, backward, opposing, road, left, right, travel };
}

function laneMarkingProfileChanged(a, b) {
  if (!a || !b) return false;
  return a.oneway !== b.oneway
    || a.total !== b.total
    || a.forward !== b.forward
    || a.backward !== b.backward
    || a.opposing !== b.opposing
    || Math.abs(a.road - b.road) > 1.1;
}

function laneTransitionCandidate(way, here, other) {
  if (!other) return false;
  if (way && other && way.name && other.name && way.name !== other.name) return false;
  const profile = laneMarkingProfile(other);
  return laneMarkingProfileChanged(here, profile);
}

function laneMarkingTransitions(way, renderPoints, roadWidth) {
  if (!way || !renderPoints || renderPoints.length < 2) return [0, 0];
  const n = renderPoints.length;
  const [sx, sy] = xy(renderPoints[0][0], renderPoints[0][1]);
  const [s2x, s2y] = xy(renderPoints[1][0], renderPoints[1][1]);
  const [ex, ey] = xy(renderPoints[n - 1][0], renderPoints[n - 1][1]);
  const [e2x, e2y] = xy(renderPoints[n - 2][0], renderPoints[n - 2][1]);
  const startBearing = Math.atan2(-s2y + sy, s2x - sx);
  const endBearing = Math.atan2(-e2y + ey, e2x - ex);
  const here = laneMarkingProfile(way, roadWidth);
  return [
    streetContinuationsAt(way, sx, -sy, startBearing).find(
      (other) => laneTransitionCandidate(way, here, other)) || null,
    streetContinuationsAt(way, ex, -ey, endBearing).find(
      (other) => laneTransitionCandidate(way, here, other)) || null,
  ];
}

//: A stop bar sits about a metre back from the crosswalk, and the crosswalk starts at the kerb
//: line of the street being crossed. This is the setback from that kerb line.
const JUNCTION_MARK_SETBACK_M = 1.6;

function junctionReachAt(x, z, bearing) {
  // How far back from a street's end the junction mouth reaches: the half-width of the widest
  // carriageway crossing it here. Zero where nothing crosses.
  const cx = Math.floor(x / CARRIAGEWAY_CELL);
  const cz = Math.floor(z / CARRIAGEWAY_CELL);
  const limit = (BIKE_CROSS_ANGLE_DEG * Math.PI) / 180;
  let reach = 0;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
      if (!bucket) continue;
      for (const [ax, az, bx, bz, half, other] of bucket) {
        if (other === undefined) continue;
        let difference = Math.abs(other - bearing) % Math.PI;
        if (difference > Math.PI / 2) difference = Math.PI - difference;
        if (difference < limit) continue;            // runs along this street, not across it
        const slack = half + 2.0;
        if (distanceToSegmentSquared(x, z, ax, az, bx, bz) > slack * slack) continue;
        if (half > reach) reach = half;
      }
    }
  }
  return reach;
}

function laneMarkingTrims(way, renderPoints, roadWidth) {
  // Lane lines stop at the junction. They are painted between the crossroads, not through them:
  // a driver reads the empty box as the place where the lanes give way to each other.
  //
  // This only ever trimmed where the lane count changed, so every centreline and lane divider
  // in the corridor ran straight out into the crossroads and met the markings of the street it
  // was crossing, at right angles, in the middle of the box. Austin and Gough had four of them
  // meeting in a cross.
  const [start, end] = laneMarkingTransitions(way, renderPoints, roadWidth);
  const trims = [
    start ? LANE_TRANSITION_TRIM_M : 0,
    end ? LANE_TRANSITION_TRIM_M : 0,
  ];
  const n = renderPoints.length;
  if (n < 2) return trims;
  const ends = [
    { at: 0, next: 1, slot: 0 },
    { at: n - 1, next: n - 2, slot: 1 },
  ];
  for (const { at, next, slot } of ends) {
    const [ex, ey] = xy(renderPoints[at][0], renderPoints[at][1]);
    const [nx2, ny2] = xy(renderPoints[next][0], renderPoints[next][1]);
    const bearing = Math.atan2(-ny2 + ey, nx2 - ex);
    // Whether the street carries on is the wrong question for paint. At a crossroads it does
    // carry on -- Gough runs straight through Austin -- and the markings must still stop, because
    // what matters is that something crosses here. Asking only whether something crosses gets
    // both cases right: a way merely split mid-block has nothing crossing it and keeps its lines.
    const reach = junctionReachAt(ex, -ey, bearing);
    if (reach > 0) trims[slot] = Math.max(trims[slot], reach + JUNCTION_MARK_SETBACK_M);
  }
  return trims;
}

//: Paint stops this far short of the roadway it crosses -- room for the crosswalk and the stop
//: bar in front of it.
const JUNCTION_CLEAR_M = 4.6;

//: The mapped intersection nodes, each with the reach of the junction around it. A carriageway
//: test alone leaves the middle of a wide crossroads uncovered -- neither street's own roadway
//: extends to the far side of the box -- and a dashed lane line survives out there as a short
//: fragment at an angle nothing else on the road shares.
const INTERSECTION_CELL = 40;
const intersectionGrid = new Map();

function indexIntersections(nodes) {
  intersectionGrid.clear();
  for (const node of nodes || []) {
    if (!Number.isFinite(node.lon) || !Number.isFinite(node.lat)) continue;
    const [x, y] = xy(node.lon, node.lat);
    const z = -y;
    // How big this junction is: the widest carriageway that reaches it.
    let half = 0;
    const cx = Math.floor(x / CARRIAGEWAY_CELL);
    const cz = Math.floor(z / CARRIAGEWAY_CELL);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = carriagewayGrid.get((cx + dx) * 1048576 + (cz + dz));
        if (!bucket) continue;
        for (const [ax, az, bx, bz, wide] of bucket) {
          const slack = wide + 2.0;
          if (distanceToSegmentSquared(x, z, ax, az, bx, bz) > slack * slack) continue;
          if (wide > half) half = wide;
        }
      }
    }
    if (!(half > 0)) continue;
    const radius = half + JUNCTION_CLEAR_M;
    const key = `${Math.floor(x / INTERSECTION_CELL)}:${Math.floor(z / INTERSECTION_CELL)}`;
    let bucket = intersectionGrid.get(key);
    if (!bucket) intersectionGrid.set(key, bucket = []);
    bucket.push([x, z, radius]);
  }
}

function insideIntersection(x, z) {
  const cx = Math.floor(x / INTERSECTION_CELL);
  const cz = Math.floor(z / INTERSECTION_CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      const bucket = intersectionGrid.get(`${cx + dx}:${cz + dz}`);
      if (!bucket) continue;
      for (const [ix, iz, radius] of bucket) {
        if ((x - ix) * (x - ix) + (z - iz) * (z - iz) < radius * radius) return true;
      }
    }
  }
  return false;
}

function markingRunsClearOfJunctions(points, way) {
  // A lane line broken wherever it passes through another street.
  //
  // Trimming the ends of the way is not enough, and that is what this used to do. OpenStreetMap
  // splits a street where its tagging changes, not where it meets another one, so a single way
  // runs through several crossroads -- and its centreline ran through all of them. Two double
  // yellows crossing each other at right angles in the middle of Gough and Green is what that
  // looks like. Asking every point whether a street crosses it there catches the junctions in
  // the middle of a way as well as the ones at its ends.
  const dense = densifyWay(points, 2.0);
  if (dense.length < 2) return [];
  const blocked = [];
  // An intersection's radius already includes the setback (JUNCTION_CLEAR_M); counted again
  // the paint stopped nine metres short of the cross street instead of at its crosswalk.
  const inJunction = [];
  const station = [0];
  for (let i = 0; i < dense.length; i += 1) {
    const before = dense[Math.max(0, i - 1)];
    const after = dense[Math.min(dense.length - 1, i + 1)];
    const [x, y] = xy(dense[i][0], dense[i][1]);
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const bearing = Math.atan2(-ay + by, ax - bx);
    blocked.push(crosswiseCarriagewayAt(x, -y, bearing, 0.2, way, false));
    inJunction.push(insideIntersection(x, -y));
    if (i) {
      const [px, py] = xy(dense[i - 1][0], dense[i - 1][1]);
      station.push(station[i - 1] + Math.hypot(x - px, y - py));
    }
  }
  // The paint stops short of the junction, not at its edge: the crosswalk and the stop bar in
  // front of it take the last few metres.
  const clear = blocked.map((b, i) => b || inJunction[i]);
  for (let i = 0; i < blocked.length; i += 1) {
    if (!blocked[i]) continue;
    for (let j = 0; j < blocked.length; j += 1) {
      if (Math.abs(station[j] - station[i]) <= JUNCTION_CLEAR_M) clear[j] = true;
    }
  }
  const runs = [];
  let run = [];
  const flush = () => { if (run.length >= 2) runs.push(run); run = []; };
  for (let i = 0; i < dense.length; i += 1) {
    // Cross-section offsets and bike transitions can outlive a road-width change.
    // Those samples are not paintable asphalt even when no junction crosses them.
    // Keep the sidewalk; do not raise displaced paint above it to hide the error.
    const [x, y] = xy(dense[i][0], dense[i][1]);
    if (clear[i] || !insideCarriageway(x, -y, MARK_W / 2)) flush();
    else run.push(dense[i]);
  }
  flush();
  return runs.filter((r) => wayLength(r) > 2.0);
}

function laneMarkingPaints(profile) {
  const marks = [];
  if (!profile) return marks;
  const left = profile.left ?? profile.road / 2;
  const right = profile.right ?? -profile.road / 2;
  const travel = left - right;
  const laneWidth = profile.total ? travel / profile.total : 0;
  if (profile.total >= 2 && laneWidth >= 2.6) {
    for (let i = 1; i < profile.total; i += 1) {
      if (profile.opposing && i === (profile.backward || Math.floor(profile.total / 2))) continue;
      const offset = left - i * laneWidth;
      if (offset < left - 0.35 && offset > right + 0.35) {
        marks.push({ offset, color: 0xdfe3e0, kind: "lane", y: 0.015 });
      }
    }
  }
  if (profile.opposing) {
    // Down the middle of the travel lanes, which is the middle of the road only where the
    // parking is the same on both sides.
    const middle = profile.backward && profile.total
      ? left - profile.backward * laneWidth : (left + right) / 2;
    const apart = (MARK_W + DOUBLE_GAP_M) / 2;
    marks.push({ offset: middle + apart, color: 0xd8a92e, kind: "centre", y: 0.02 });
    marks.push({ offset: middle - apart, color: 0xd8a92e, kind: "centre", y: 0.02 });
  }
  return marks;
}

function nearestTransitionPaint(mark, paints) {
  let best = null;
  let bestDelta = Infinity;
  for (const candidate of paints) {
    if (candidate.kind !== mark.kind) continue;
    const delta = Math.abs(candidate.offset - mark.offset);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

function transitionPaintPoints(points, cut, currentOffset, otherOffset, atStart) {
  if (!points || points.length < 2 || !(cut > 0.5)) return null;
  if (atStart) {
    const trimmed = trimWayEnds(points, cut, 0);
    if (!trimmed || trimmed.length < 2) return null;
    const base = [points[0], trimmed[0]];
    return [offsetWay(base, otherOffset)[0], offsetWay(base, currentOffset)[1]];
  }
  const trimmed = trimWayEnds(points, 0, cut);
  if (!trimmed || trimmed.length < 2) return null;
  const base = [trimmed[trimmed.length - 1], points[points.length - 1]];
  return [offsetWay(base, currentOffset)[0], offsetWay(base, otherOffset)[1]];
}

function addLaneTransitionMarkings(way, renderPoints, roadWidth, roadTop) {
  const [startOther, endOther] = laneMarkingTransitions(way, renderPoints, roadWidth);
  if (!startOther && !endOther) return;
  const here = laneMarkingProfile(way, roadWidth);
  const herePaints = laneMarkingPaints(here);
  if (!herePaints.length) return;
  for (const [other, atStart] of [[startOther, true], [endOther, false]]) {
    if (!other) continue;
    // A junction where the lanes do not carry through and no turn arrow says where the
    // difference goes (smc.facts.cross_section.match_junction) gets no taper: the taper is
    // a guess at where a lane goes, and the fact says the guess is not supported.
    if (way.xs_junction && way.xs_junction[atStart ? "start" : "end"]) continue;
    const otherProfile = laneMarkingProfile(other);
    if (here.oneway !== otherProfile.oneway || here.opposing !== otherProfile.opposing) continue;
    if (Math.abs(here.total - otherProfile.total) > 1) continue;
    const otherPaints = laneMarkingPaints(otherProfile);
    if (!otherPaints.length) continue;
    for (const mark of herePaints) {
      if (mark.kind === "centre") continue;
      const otherMark = nearestTransitionPaint(mark, otherPaints);
      if (!otherMark) continue;
      if (Math.abs(otherMark.offset - mark.offset) < 0.25) continue;
      if (Math.abs(otherMark.offset - mark.offset) > LANE_TRANSITION_MAX_SHIFT_M) continue;
      const points = transitionPaintPoints(
        renderPoints, LANE_TRANSITION_TRIM_M, mark.offset, otherMark.offset, atStart);
      if (!points || points.length < 2) continue;
      // A taper is painted on the approach to the junction, never across it. It is drawn at the
      // end of a way, which is where junctions are, so without this the diagonal ran out into
      // the box and crossed the stop bar of the street it was meeting -- a line at an angle
      // nothing else on the road shares, which is exactly what reads as a stray mark.
      for (const run of markingRunsClearOfJunctions(points, way)) {
        const taper = paintedLine(run, MARK_W, mark.color, roadTop + mark.y);
        if (taper) addMerged(`marking:transition:${mark.kind}`, taper, "marking");
      }
    }
  }
}

function addKerbsidePavement(renderPoints, side, inner, walk, color, opacity, streetY,
                             streetThickness, way = null) {
  // Pavement on one side of one street: the widest strip that fits at each point along it,
  // gathered into stretches, and each stretch laid once.
  //
  // Three bugs have lived here, and they pull in different directions.
  //
  // It was first laid at one width and dropped wherever it did not survive, which left 237 kerb
  // sides with no pavement at all -- bare ground between the kerb and the buildings, which is
  // the black strip along the shopfronts. Almost none of those sides had no room; they had less
  // room than four metres, because the neighbouring carriageway starts sooner than that.
  //
  // Then a ladder of widths was tried and a ribbon laid at every one of them, returning at the
  // first that covered enough. A narrow strip fits everywhere a wide one does and more, so the
  // narrow passes re-covered the ground the wide ones had just covered: up to five slabs in one
  // plane, each with its own tile origin, over a fifth of the paved ground in the corridor.
  //
  // Then one width was chosen for the whole side, which stopped the stacking and reintroduced
  // the holes: wherever that width was clipped away by a neighbouring carriageway the side got
  // nothing, and a third of the corridor's kerb ended up with less than a metre of pavement.
  //
  // The width is a property of the place, not of the side. Each point takes the widest strip
  // that fits there, which is the same thing the ladder was reaching for, and the run of points
  // that agree is laid as one ribbon -- so every point is covered by exactly one.
  const wanted = wayLength(renderPoints);
  if (!(wanted > 0)) return 0;
  const widths = WALK_FALLBACK_WIDTHS_M.map(
    (share) => Math.max(MIN_RENDER_WALK_M * 0.55, walk * share));
  // Whether the width came from the city's footway survey or is a share of the right of way.
  const surveyed = Boolean(way && way.walk_m);

  // Trimmed only where the street really ends. `inner + 0.7w` is over seven metres on an
  // ordinary street, and OpenStreetMap splits a street wherever its tagging changes -- so
  // trimming both ends of every way put a fifteen metre hole in the middle of a block at every
  // invisible split. Where the street carries on, so does the pavement.
  const back = Math.min(Math.max(1.2, inner + widths[0] * 0.7), wanted * 0.32);
  const [cutStart, cutEnd] = kerbsideTrims(renderPoints, back, side);
  // What reaches each cut, for the corner piece to meet: the pavement's height, thickness and
  // colour, and whether anything was laid at the cut. The far end runs backwards, so the
  // pavement on this way's left is on the right of the leg leaving that junction.
  const n = renderPoints.length;
  const recordEnd = (cut, end, next, awaySide, laidWidth) => {
    if (!(cut > 0)) return;
    const [ex, ey] = xy(renderPoints[end][0], renderPoints[end][1]);
    const [nx2, ny2] = xy(renderPoints[next][0], renderPoints[next][1]);
    const leg = cornerLegAt(ex, ey, nx2 - ex, ny2 - ey);
    if (leg) {
      pavementCornerLaid.set(`${leg.id}:${awaySide}`,
                             { width: laidWidth, y: streetY, thickness: streetThickness, color, opacity });
    }
  };
  const spine = densifyWay(trimWayEnds(renderPoints, cutStart, cutEnd), 2.0);
  // The kerb line at each station: the half road width, less the bulb-out where the city's
  // kerb steps in on the approach to a junction.
  const innerAt = [];
  const kerbAt = [];
  {
    let along = cutStart;
    for (let i = 0; i < spine.length; i += 1) {
      if (i > 0) {
        const [px, py] = xy(spine[i - 1][0], spine[i - 1][1]);
        const [x, y] = xy(spine[i][0], spine[i][1]);
        along += Math.hypot(x - px, y - py);
      }
      // The kerb line is where the way's envelope puts it at this station, which is where
      // the road under it is drawn to.
      const here = way && way._spans ? halfWidthAt(way, along) : inner;
      kerbAt.push(here);
      innerAt.push(here - bulbDepthAt(way, side, along));
    }
  }
  if (spine.length < 2) {
    // A way short enough that its two corners are the whole of its pavement.
    recordEnd(cutStart, 0, 1, side, widths[0]);
    recordEnd(cutEnd, n - 1, n - 2, -side, widths[0]);
    return 0;
  }

  // The pavement's width at each station, from the building line: the surveyed width, but
  // never into a building -- a quarter of the corridor's stations put the pavement through
  // the facade -- and, where the width was only a share of the right of way, out to the
  // facade where the facade is further than that. A surveyed width that stops short of the
  // building is a setback, and the ground beyond it is the yard the ground cover draws.
  const walkAt = [];
  const fits = widths.map(() => []);
  const meets = [];
  for (let i = 0; i < spine.length; i += 1) {
    const before = spine[Math.max(0, i - 1)];
    const after = spine[Math.min(spine.length - 1, i + 1)];
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const dx = ax - bx;
    const dz = by - ay;
    const span = Math.hypot(dx, dz) || 1;
    const nx = -dz / span;
    const nz = dx / span;
    const blocked = kerbsideBlockedAt(before, spine[i], after, side, kerbAt[i]);
    const [sx, sy] = xy(spine[i][0], spine[i][1]);
    // (nx, nz) is the right normal of travel in the x/z frame, and `side` counts left as
    // positive, so the way out of the road on this side is -side times it.
    const facade = rayFootprintDistance(sx, -sy, -side * nx, -side * nz,
                                        kerbAt[i] + WALK_TO_FACADE_MAX_M + 1.0);
    let target = walk;
    if (facade !== null) {
      const room = facade - kerbAt[i] - FACADE_GAP_M;
      if (room < walk - 0.6) target = Math.max(MIN_RENDER_WALK_M * 0.55, room);
      else if (!surveyed && facade - kerbAt[i] > walk + 1.0) {
        target = Math.min(facade - kerbAt[i] - FACADE_GAP_M, WALK_TO_FACADE_MAX_M);
      }
    }
    walkAt.push(target);
    for (let w = 0; w < widths.length; w += 1) {
      const width = Math.max(MIN_RENDER_WALK_M * 0.55, target * WALK_FALLBACK_WIDTHS_M[w]);
      const centre = offsetWay([before, spine[i], after], side * (kerbAt[i] + width / 2))[1];
      const [cx, cy] = xy(centre[0], centre[1]);
      fits[w].push(!blocked && walkFitsAt(cx, -cy, nx, nz, width));
    }
    // The mapped footway on this side, if OpenStreetMap has one here.
    meets.push(blocked ? null : mappedWalkBeyondKerb(sx, -sy, -side * nx, -side * nz, kerbAt[i]));
  }

  // One side of one block has one sidewalk width. Changing width mid-block produces exactly
  // the stray concrete islands seen at big intersections: two correct-looking slabs with a
  // wrong transition between them. Choose the widest width that covers enough of the side; if
  // none reaches the threshold, choose the width with the most coverage. Any remaining sliver
  // is handled by the low property-line underlay, not by changing sidewalk width.
  let pick = -1;
  let bestCoverage = -1;
  for (let w = 0; w < widths.length; w += 1) {
    const coverage = fits[w].filter(Boolean).length / Math.max(1, fits[w].length);
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      pick = w;
    }
    if (coverage >= WALK_ENOUGH) {
      pick = w;
      break;
    }
  }
  if (pick < 0 || bestCoverage <= 0) return 0;
  const chosen = fits[pick].map((ok) => ok ? pick : -1);
  // Where a mapped footway stands beyond the kerb line, the derived pavement is the strip
  // between the two -- the footway's own concrete, carried to the kerb -- at the footway's
  // height; where the footway reaches the kerb line, the derived pavement lies under it at
  // the footway's height less a centimetre, as it was always meant to. Stations that meet the
  // same footway the same way are one stretch.
  // The width at station i for ladder step w.
  const widthAt = (i, w) => Math.max(MIN_RENDER_WALK_M * 0.55, walkAt[i] * WALK_FALLBACK_WIDTHS_M[w]);
  const group = chosen.map((c, i) => {
    const met = meets[i];
    if (c < 0 || !met) return c < 0 ? c : `${c}:${Math.round(walkAt[i] / 0.5)}`;
    const gap = met.edge - kerbAt[i];
    if (gap >= MAPPED_WALK_GAP_MIN_M) return `gap:${Math.round(gap / 0.25)}:${met.thickness.toFixed(3)}`;
    return `under:${c}:${met.thickness.toFixed(3)}`;
  });

  recordEnd(cutStart, 0, 1, side, chosen[0] >= 0 ? widthAt(0, chosen[0]) : 0);
  recordEnd(cutEnd, n - 1, n - 2, -side,
            chosen[chosen.length - 1] >= 0 ? widthAt(chosen.length - 1, chosen[chosen.length - 1]) : 0);

  let laid = 0;
  const emit = (from, to) => {
    const pick = chosen[from];
    if (pick < 0 || to <= from) return;
    // One station of overlap with the next stretch, so a change of width is a step in the kerb
    // rather than a gap in the pavement.
    const stretch = spine.slice(from, Math.min(to + 2, spine.length));
    if (stretch.length < 2) return;
    // One width for the stretch: the median of what its stations asked for.
    const asked = [];
    for (let i = from; i <= to; i += 1) asked.push(widthAt(i, pick));
    asked.sort((p, q) => p - q);
    let width = asked[Math.floor(asked.length / 2)];
    let y = streetY;
    let thickness = streetThickness;
    const met = meets[from];
    if (met) {
      if (typeof group[from] === "string" && group[from].startsWith("gap:")) {
        let gap = 0;
        for (let i = from; i <= to; i += 1) gap = Math.max(gap, meets[i] ? meets[i].edge - kerbAt[i] : 0);
        width = Math.min(gap + KERB_LIP_M, MAX_RENDER_WALK_M);
        y = met.y;
        thickness = met.thickness;
      } else {
        y = met.y - 0.01;
        thickness = met.thickness;
      }
    }
    // The kerb: four inches of the top and the whole face, as its own tile along the street
    // edge. It is laid with the pavement rather than over it -- the same concrete, the same
    // height, the same merge -- and it is the thing the curb policy paints. Four inches is the
    // default where nothing was measured; SFMTA paints the face and the top edge of the kerb.
    //
    // With the pavement, and only where the pavement is. The pavement is dropped wherever it
    // lies over another street's carriageway, but a four-inch tile with its centre a hand's
    // breadth outside its own kerb line is hardly ever over anything -- so along the nameless
    // connector ways through the Embarcadero's junctions the kerb was laid where the
    // pavement was not: a thin white line across the crossroads at an angle nothing else on
    // the road shares. The kerb is the pavement's edge; where there is no pavement there is
    // no edge.
    const inset = width - KERB_LIP_M;
    // One offset per vertex of the stretch, where the kerb line moves along the way.
    const lineAt = (extra) => stretch.map((_, j) => side * (kerbAt[Math.min(from + j, kerbAt.length - 1)] + extra));
    if (inset > 0.2) {
      const walkCentre = offsetWay(stretch, lineAt(KERB_LIP_M + inset / 2));
      for (const run of pavementRunsOutsideCarriageway(walkCentre, inset)) {
        const surface = inset <= NARROW_WALK_M ? "walk_narrow" : "walk";
        stampPaved(run, inset, y + thickness / 2);
        addMerged(`walk:${surface}:${(Math.round(thickness / 0.05) * 0.05).toFixed(2)}`,
                  ribbon(run, inset, color, opacity, y, thickness, surface), surface);
        laid += wayLength(run);
        const kerb = offsetWay(run, -side * (inset / 2 + KERB_LIP_M / 2));
        stampPaved(kerb, KERB_LIP_M, y + thickness / 2);
        for (const lip of unclaimedKerbRuns(kerb)) {
          addMerged(`walk:kerb:${(Math.round(thickness / 0.05) * 0.05).toFixed(2)}`,
                    ribbon(lip, KERB_LIP_M, color, opacity, y, thickness, "kerb"), "kerb");
        }
      }
    } else {
      for (const run of unclaimedKerbRuns(offsetWay(stretch, lineAt(KERB_LIP_M / 2)))) {
        addPavementRibbon(run, KERB_LIP_M, color, opacity, y, thickness, "kerb");
      }
    }
  };
  let start = 0;
  for (let i = 1; i < group.length; i += 1) {
    if (group[i] !== group[start]) {
      emit(start, i - 1);
      start = i;
    }
  }
  emit(start, group.length - 1);
  addBulbOuts(spine, innerAt, kerbAt, side, color, opacity, streetY, streetThickness);
  return laid;
}

function addBulbOuts(spine, innerAt, kerbAt, side, color, opacity, y, thickness) {
  // The bulb-out: the pavement carried from the mid-block kerb line to the city's kerb where
  // that steps into the roadway, as a strip over the road at the pavement's own height, with a
  // kerb face on its road edge. The pavement behind it keeps its edge on the building line;
  // only the kerb moves.
  const depth = innerAt.map((v, i) => kerbAt[i] - v);
  if (!depth.some((d) => d > 0)) return 0;
  const edgeIn = offsetWay(spine, innerAt.map((v) => side * v));
  const edgeOut = offsetWay(spine, kerbAt.map((v) => side * (v + KERB_LIP_M + 0.02)));
  const top = y + thickness / 2 + 0.002;
  const bottom = y - thickness / 2;
  const positions = [];
  const uvs = [];
  const index = [];
  const quad = (a, b, c, d) => {
    const base = positions.length / 3;
    for (const [x, h, z] of [a, b, c, d]) { positions.push(x, h, z); uvs.push(x / 2, z / 2); }
    index.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const at = (point) => { const [x, y2] = xy(point[0], point[1]); return [x, -y2]; };
  let laid = 0;
  for (let i = 0; i + 1 < spine.length; i += 1) {
    if (!(depth[i] > 0 || depth[i + 1] > 0)) continue;
    const [ax, az] = at(edgeIn[i]);
    const [bx, bz] = at(edgeIn[i + 1]);
    const [cx, cz] = at(edgeOut[i + 1]);
    const [dx, dz] = at(edgeOut[i]);
    // Winding: the strip's top must face up whichever side of the street it is on.
    const cross = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
    const [P, Q, R, S] = cross < 0 ? [[ax, az], [bx, bz], [cx, cz], [dx, dz]]
      : [[dx, dz], [cx, cz], [bx, bz], [ax, az]];
    quad([P[0], top, P[1]], [Q[0], top, Q[1]], [R[0], top, R[1]], [S[0], top, S[1]]);
    // The kerb face along the road edge.
    const [F, G] = cross < 0 ? [[ax, az], [bx, bz]] : [[bx, bz], [ax, az]];
    quad([F[0], bottom, F[1]], [F[0], top, F[1]], [G[0], top, G[1]], [G[0], bottom, G[1]]);
    laid += 1;
  }
  if (!laid) return 0;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, surfaceMaterial("walk", color, opacity));
  mesh.userData.surface = "walk";
  addMerged("walk:bulb", mesh, "walk");
  return laid;
}

function addPropertyLinePavementUnderlay(renderPoints, side, inner, walk, color, opacity) {
  // The ground between the kerb and the property line, at whatever width will actually fit.
  //
  // The sidewalk proper is laid at one width for the whole side, because changing width
  // mid-block reads as two slabs with a mistake between them. That leaves gaps wherever the
  // chosen width does not fit -- a neighbouring carriageway close in, a corner, a pinch -- and
  // this is what fills them. It used to be laid at a fixed 8.6 m, which is wider than any
  // sidewalk in the corridor, so it was clipped by the carriageway guard in all the same places
  // the sidewalk was and then some: 720 kerb stations with room and nothing said against them
  // still came out bare. A gap-filler has to be narrower than the thing it is filling for, not
  // wider.
  //
  // Width may vary here in a way it may not above, because this is flat neutral ground under the
  // sidewalk rather than the sidewalk itself -- a step in it is not a step in a kerb.
  const wanted = wayLength(renderPoints);
  if (!(wanted > 0)) return 0;
  const widest = Math.max(PROPERTY_LINE_PAVEMENT_WIDTH_M, walk);
  const ladder = [];
  for (let w = widest; w >= UNDERLAY_MIN_WIDTH_M; w *= 0.72) ladder.push(w);
  ladder.push(UNDERLAY_MIN_WIDTH_M);
  const back = Math.min(Math.max(1.6, inner + 2.4), wanted * 0.32);
  const [cutStart, cutEnd] = kerbsideTrims(renderPoints, back);
  const spine = densifyWay(trimWayEnds(renderPoints, cutStart, cutEnd), 2.0);
  if (spine.length < 2) return 0;

  // The widest that fits at each station.
  const chosen = [];
  for (let i = 0; i < spine.length; i += 1) {
    const before = spine[Math.max(0, i - 1)];
    const after = spine[Math.min(spine.length - 1, i + 1)];
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const dx = ax - bx;
    const dz = by - ay;
    const run = Math.hypot(dx, dz) || 1;
    const nx = -dz / run;
    const nz = dx / run;
    let pick = -1;
    if (!kerbsideBlockedAt(before, spine[i], after, side, inner)) {
      for (let w = 0; w < ladder.length; w += 1) {
        const centre = offsetWay([before, spine[i], after], side * (inner + ladder[w] / 2))[1];
        const [cx, cy] = xy(centre[0], centre[1]);
        if (walkFitsAt(cx, -cy, nx, nz, ladder[w])) { pick = w; break; }
      }
    }
    chosen.push(pick);
  }
  // Hold a width for a few metres so the underlay is not rebuilt every two.
  const station = [0];
  for (let i = 1; i < spine.length; i += 1) {
    const [ax, ay] = xy(spine[i - 1][0], spine[i - 1][1]);
    const [bx, by] = xy(spine[i][0], spine[i][1]);
    station.push(station[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  for (let i = 1; i < chosen.length; i += 1) {
    if (chosen[i] === chosen[i - 1] || chosen[i] < 0 || chosen[i - 1] < 0) continue;
    let j = i;
    while (j < chosen.length && chosen[j] === chosen[i]) j += 1;
    if (station[Math.min(j, chosen.length - 1)] - station[i] < UNDERLAY_RUN_M) {
      for (let c = i; c < j; c += 1) chosen[c] = chosen[i - 1];
    }
  }

  let laid = 0;
  const emit = (from, to) => {
    const pick = chosen[from];
    if (pick < 0 || to <= from) return;
    const stretch = spine.slice(from, Math.min(to + 2, spine.length));
    if (stretch.length < 2) return;
    const width = ladder[pick];
    for (const run of pavementRunsOutsideCarriageway(
           offsetWay(stretch, side * (inner + width / 2)), width)) {
      stampParkPavement(run, width);
      addMerged("walk:property-underlay",
                ribbon(run, width, color, opacity, PROPERTY_LINE_PAVEMENT_Y,
                       PROPERTY_LINE_PAVEMENT_THICKNESS_M, "walk_underlay"),
                "walk_underlay");
      laid += wayLength(run);
    }
  };
  let start = 0;
  for (let i = 1; i < chosen.length; i += 1) {
    if (chosen[i] !== chosen[start]) { emit(start, i - 1); start = i; }
  }
  emit(start, chosen.length - 1);
  return laid;
}

function walkFitsAt(x, z, nx, nz, width) {
  // The same question pavementRunsOutsideCarriageway asks, at a single station: is a strip of
  // this width, with its inner edge on the kerb, off the roadway here? One edge inside the kerb
  // line is the normal condition of a pavement that abuts a street and is not a reason to
  // delete it; the middle of the strip being on the carriageway is.
  const edge = Math.max(0.2, width / 2 - 0.12);
  const innerEdge = insideCarriageway(x + nx * edge, z + nz * edge, 0.30);
  const outerEdge = insideCarriageway(x - nx * edge, z - nz * edge, 0.30);
  return !(insideCarriageway(x, z, 0.30)
    || insideJunctionBox(x, z)
    || (innerEdge && outerEdge)
    || pavementSurroundedByStreet(x, z, width));
}

function apronSlab(opening) {
  // The ramp at a dropped kerb.
  //
  // A driveway apron is not a slab laid on the pavement: it is the pavement itself falling
  // from footway level to road level over about a metre, which is why the kerb "drops" there
  // rather than stopping. Drawn flat it read as an extra square of sidewalk sitting in the
  // street -- the right shape in the wrong plane. Drawn as the ramp it is, with the kerb face
  // sloping instead of stepping, it reads as something a car drives over.
  if (!opening.kp || opening.on === undefined) return null;
  const [kx, ky] = xy(opening.kp[0], opening.kp[1]);
  const bearing = opening.on * Math.PI / 180;
  const depth = Math.max(1.0, Math.min(opening.walk || 3.0, 5.0));
  const width = Math.max(2.2, opening.w || 3.5);

  const ox = Math.sin(bearing);
  const oz = -Math.cos(bearing);
  const px = -oz;
  const pz = ox;

  const top = roadSurfaceTop();
  // Three rows: the gutter, where the ramp meets the road; the top of the slope; and the back
  // of the apron at the property line. Only the first is at road level.
  const rows = [
    { at: 0.0, y: 0.062, half: width / 2 },
    { at: Math.min(1.0, depth * 0.45), y: top, half: width / 2 + APRON_FLARE_M },
    { at: depth, y: top, half: width / 2 },
  ];

  const positions = [];
  const uvs = [];
  const index = [];
  for (const row of rows) {
    for (const sign of [-1, 1]) {
      const x = kx + ox * row.at + px * sign * row.half;
      const z = -ky + oz * row.at + pz * sign * row.half;
      // The rule, applied to every corner: a ramp with a corner in the carriageway means
      // something upstream is wrong about this cut, and none is better than one in the road.
      if (insideCarriageway(x, z, 0.2)) return null;
      positions.push(x, row.y, z);
      uvs.push(sign > 0 ? width / WALK_UV_M : 0, row.at / WALK_UV_M);
    }
  }
  for (let r = 1; r < rows.length; r += 1) {
    const a = (r - 1) * 2;
    const b = r * 2;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: SIDEWALK, color: 0xffffff, roughness: 0.94, metalness: 0.02,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }));
}

function garagePanel(opening, tint) {
  const [ax, ay] = xy(opening.a[0], opening.a[1]);
  const [bx, by] = xy(opening.b[0], opening.b[1]);
  const length = Math.hypot(bx - ax, by - ay);
  if (!(length > 0.5)) return null;
  const width = Math.min(opening.w, length * 0.9);
  const dx = (bx - ax) / length;
  const dy = (by - ay) / length;
  // Where along the wall the dropped kerb points, kept far enough from either end that the
  // opening does not run off the corner of the building.
  const half = width / 2;
  const t = Math.min(Math.max(opening.t * length, half), Math.max(half, length - half));
  const cx = ax + dx * t;
  const cy = ay + dy * t;

  const bearing = (opening.n || 0) * Math.PI / 180;
  const nx = Math.sin(bearing);
  const nz = -Math.cos(bearing);
  // Wood, every one: San Francisco's garage doors are panelled wood under their paint, and the
  // two wood designs (4 and 5) are the ones that read as that.
  const map = garageTextureFor(4 + (opening.s % 2), tint);
  // A photographed garage stands as tall as the photograph shows it.
  const height = Number.isFinite(opening.h) ? opening.h : GARAGE_HEIGHT_M;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    // Drawn in front of whatever lies on the wall behind it -- a facade photograph, a window
    // panel -- even where depth precision at a distance cannot tell a few centimetres apart.
    new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.78, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  );
  mesh.position.set(cx + nx * GARAGE_STANDOFF_M, height / 2, -cy + nz * GARAGE_STANDOFF_M);
  // A plane faces +z, so pi minus the bearing turns it to face the way the wall does. It was
  // atan2(nx, ny) + pi/2, which is ninety degrees out: every door stood side-on to its own
  // building, and read from the street as a grey slab planted on the pavement.
  mesh.rotation.y = Math.PI - bearing;
  return mesh;
}

const CROSSING = crossingTexture();
//: One bar plus one gap, in metres. San Francisco's continental bars run about 430 mm with a
//: matching space, which over a crossing band gives four or five of them. At 1.2 m the band
//: held only three and they read as long lines across the road rather than as a ladder.
const CROSSING_PERIOD_M = 0.86;

function tactileWarningTexture() {
  // Truncated-dome warning tile: the yellow pad at the sidewalk side of a curb ramp. It is not
  // a painted road marking; it sits on the footway where a pedestrian is about to step into the
  // crossing, and the capped domes need to read as raised even from a shallow camera angle.
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d8aa24";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.010; i += 1) {
    const shade = random(i * 19);
    ctx.fillStyle = shade < 0.55 ? "rgba(95,75,17,0.16)" : "rgba(255,238,128,0.15)";
    ctx.fillRect(random(i * 7) * size, random(i * 11) * size, 1.2, 1.2);
  }
  const pitch = 32;                                          // 50 mm centres: ADA's 1.6-2.4 in
  const radius = 5.6;
  for (let y = 12; y < size; y += pitch) {
    for (let x = 12; x < size; x += pitch) {
      const dome = ctx.createRadialGradient(x - 2.0, y - 2.4, 1.0, x, y, radius + 3.0);
      dome.addColorStop(0.00, "rgba(255,238,108,0.95)");
      dome.addColorStop(0.42, "rgba(225,174,36,0.98)");
      dome.addColorStop(0.74, "rgba(142,105,22,0.78)");
      dome.addColorStop(1.00, "rgba(84,62,18,0.18)");
      ctx.fillStyle = dome;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,226,83,0.98)";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,247,155,0.30)";
      ctx.beginPath();
      ctx.arc(x - 2.1, y - 2.3, radius * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(92,68,14,0.34)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const TACTILE_WARNING = tactileWarningTexture();
// A 3-by-5-foot warning field reads as a full rectangular truncated-dome panel from the demo
// camera, instead of the former yellow line spanning almost the whole crosswalk.
const TACTILE_PAD_DEPTH_M = 0.91;
//: The ramp the pad sits on: from the kerb back into the footway, with the flared sides San
//: Francisco pours. The pad is the first 24 in of it at the street; the rest is smooth concrete.
const CURB_RAMP_DEPTH_M = 1.55;
const CURB_RAMP_FLARE_M = 0.45;
const TACTILE_PAD_SETBACK_M = 0.18;
const TACTILE_PAD_MIN_W_M = 1.22;
const TACTILE_PAD_MAX_W_M = 1.52;
const TACTILE_TEXTURE_TILE_M = 0.48;
const TACTILE_CLEARANCE_M = 0.10;
const tactileWarningPads = [];

function tactilePadsOverlap(a, b) {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i += 1) {
      const p = polygon[i];
      const q = polygon[(i + 1) % polygon.length];
      const edgeX = q[0] - p[0];
      const edgeZ = q[1] - p[1];
      const length = Math.hypot(edgeX, edgeZ);
      if (!(length > 1e-6)) continue;
      const axisX = -edgeZ / length;
      const axisZ = edgeX / length;
      const range = (corners) => {
        const values = corners.map(([x, z]) => x * axisX + z * axisZ);
        return [Math.min(...values), Math.max(...values)];
      };
      const ar = range(a);
      const br = range(b);
      if (ar[1] + TACTILE_CLEARANCE_M < br[0]
          || br[1] + TACTILE_CLEARANCE_M < ar[0]) return false;
    }
  }
  return true;
}
function tactilePadCorners(endpoint, intoCrossing, crossingWidth) {
  const [ex, ey] = xy(endpoint[0], endpoint[1]);
  const [ix, iy] = xy(intoCrossing[0], intoCrossing[1]);
  const ez = -ey;
  const iz = -iy;
  const dx = ix - ex;
  const dz = iz - ez;
  const len = Math.hypot(dx, dz);
  if (!(len > 0.5)) return null;
  const outX = -dx / len;
  const outZ = -dz / len;
  const acrossX = -outZ;
  const acrossZ = outX;
  const width = Math.max(TACTILE_PAD_MIN_W_M, Math.min(TACTILE_PAD_MAX_W_M, crossingWidth));
  const depth = TACTILE_PAD_DEPTH_M;
  let cx = ex + outX * (depth / 2 + TACTILE_PAD_SETBACK_M);
  let cz = ez + outZ * (depth / 2 + TACTILE_PAD_SETBACK_M);
  const cornersAt = () => [
    [cx - acrossX * width / 2 - outX * depth / 2, cz - acrossZ * width / 2 - outZ * depth / 2],
    [cx + acrossX * width / 2 - outX * depth / 2, cz + acrossZ * width / 2 - outZ * depth / 2],
    [cx + acrossX * width / 2 + outX * depth / 2, cz + acrossZ * width / 2 + outZ * depth / 2],
    [cx - acrossX * width / 2 + outX * depth / 2, cz - acrossZ * width / 2 + outZ * depth / 2],
  ];
  for (let step = 0; step < 8; step += 1) {
    const corners = cornersAt();
    if (!insideCarriageway(cx, cz, 0.10)
        && !corners.some(([x, z]) => insideCarriageway(x, z, -0.05))) {
      return { corners, width, depth };
    }
    cx += outX * 0.25;
    cz += outZ * 0.25;
  }
  return null;
}

function crossingLandingCorners(endpoint, intoCrossing, crossingWidth) {
  // Derive concrete from the SAME accepted yellow rectangle. Independently
  // walking two rectangles away from the road left asphalt between them.
  const pad = tactilePadCorners(endpoint, intoCrossing, crossingWidth);
  if (!pad) return null;
  const [a, b, , d] = pad.corners;
  const ux = (d[0] - a[0]) / pad.depth, uz = (d[1] - a[1]) / pad.depth;
  const vx = (b[0] - a[0]) / pad.width, vz = (b[1] - a[1]) / pad.width;
  const border = 0.16, back = 0.64;
  let front = Math.min(border, TACTILE_PAD_SETBACK_M), side = border;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const corners = [
      [a[0] - vx * side - ux * front, a[1] - vz * side - uz * front],
      [b[0] + vx * side - ux * front, b[1] + vz * side - uz * front],
      [b[0] + vx * side + ux * (pad.depth + back), b[1] + vz * side + uz * (pad.depth + back)],
      [a[0] - vx * side + ux * (pad.depth + back), a[1] - vz * side + uz * (pad.depth + back)],
    ];
    if (!corners.some(([x, z]) => insideCarriageway(x, z, -0.05))) {
      return { corners, width: pad.width + side * 2, depth: pad.depth + front + back };
    }
    front *= 0.5; side *= 0.5;
  }
  // A flare failing at a tightly curved kerb must not leave the yellow bare.
  return { corners: pad.corners, width: pad.width, depth: pad.depth };
}

function addCrossingLandingPad(endpoint, intoCrossing, crossingWidth, y) {
  const pad = crossingLandingCorners(endpoint, intoCrossing, crossingWidth);
  if (!pad) return false;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    pad.corners[0][0], y, pad.corners[0][1],
    pad.corners[1][0], y, pad.corners[1][1],
    pad.corners[2][0], y, pad.corners[2][1],
    pad.corners[3][0], y, pad.corners[3][1],
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0,
    pad.width / WALK_UV_M, 0,
    pad.width / WALK_UV_M, pad.depth / WALK_UV_M,
    0, pad.depth / WALK_UV_M,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: SIDEWALK, color: 0xffffff, roughness: 0.94, metalness: 0.0,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5,
    polygonOffsetUnits: -10,
  }));
  mesh.userData.surface = "walk";
  addMerged("crossing:landing", mesh, "walk");
  return true;
}

function addCrossingLandingPads(points, crossingWidth, y) {
  if (!points || points.length < 2) return 0;
  let added = 0;
  if (addCrossingLandingPad(points[0], points[1], crossingWidth, y)) added += 1;
  if (addCrossingLandingPad(points[points.length - 1], points[points.length - 2],
                            crossingWidth, y)) added += 1;
  return added;
}

function addCrossingAsphaltBackstop(points, crossingWidth, roadTop) {
  // Surveyed curb faces can sit beyond the older constant-width road ribbon, especially at
  // flared corners and divided roads.  Crosswalk paint is transparent; give its exact span an
  // asphalt bed so a more accurate endpoint can never expose neutral unmapped ground below.
  if (!points || points.length < 2) return false;
  const a = points[0];
  const b = points[points.length - 1];
  const [ax, ay] = xy(a[0], a[1]);
  const [bx, by] = xy(b[0], b[1]);
  const length = Math.hypot(bx - ax, by - ay);
  if (!(length > 0.5)) return false;
  const extension = 0.55;
  const lonDx = (b[0] - a[0]) / length;
  const latDy = (b[1] - a[1]) / length;
  const backedSpan = [
    [a[0] - lonDx * extension, a[1] - latDy * extension],
    [b[0] + lonDx * extension, b[1] + latDy * extension],
  ];
  addMerged("road:crossing-backstop",
            ribbon(backedSpan, Math.max(2.4, crossingWidth + 0.70), 0xffffff, 1.0,
                   roadTop / 2, roadTop, "road"), "road");
  return true;
}

function addTactileWarningPad(endpoint, intoCrossing, crossingWidth, y) {
  const pad = tactilePadCorners(endpoint, intoCrossing, crossingWidth);
  if (!pad) return false;
  // Two mapped arms can terminate on one physical corner ramp. Keep one complete rectangle
  // there instead of stacking perpendicular pads into a yellow L/plus.
  if (tactileWarningPads.some((corners) => tactilePadsOverlap(corners, pad.corners))) return false;
  tactileWarningPads.push(pad.corners);
  // Replace the separate dark-grey ramp decal with continuous sidewalk concrete.
  // This landing includes the entire accepted pad, not just its rear edge.
  addCrossingLandingPad(endpoint, intoCrossing, crossingWidth, y - 0.012);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    pad.corners[0][0], y, pad.corners[0][1],
    pad.corners[1][0], y, pad.corners[1][1],
    pad.corners[2][0], y, pad.corners[2][1],
    pad.corners[3][0], y, pad.corners[3][1],
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0,
    pad.width / TACTILE_TEXTURE_TILE_M, 0,
    pad.width / TACTILE_TEXTURE_TILE_M, pad.depth / TACTILE_TEXTURE_TILE_M,
    0, pad.depth / TACTILE_TEXTURE_TILE_M,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: TACTILE_WARNING, color: 0xffffff, roughness: 0.86, metalness: 0.0,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -10,
    polygonOffsetUnits: -20,
  }));
  mesh.userData.surface = "tactile_warning";
  addMerged("crossing:tactile", mesh, "tactile_warning");
  return true;
}

//: ``y`` is a height, or a function of the end and the point after it that gives one.
function addCrossingTactilePads(points, crossingWidth, y) {
  if (!points || points.length < 2) return 0;
  const yAt = typeof y === "function" ? y : () => y;
  let added = 0;
  const first = points[0], second = points[1];
  const last = points[points.length - 1], penult = points[points.length - 2];
  if (addTactileWarningPad(first, second, crossingWidth, yAt(first, second))) added += 1;
  if (addTactileWarningPad(last, penult, crossingWidth, yAt(last, penult))) added += 1;
  return added;
}
const deferredTactilePads = [];

function addSidewalkCrossingReplacements(points, y) {
  const crossingWidth = 3.7;
  let added = 0;
  for (const span of sidewalkCrossingReplacementSpans(points, crossingWidth)) {
    if (nearMappedCrossing(span)) continue;
    if (!shouldDrawCrossing(span, crossingWidth, "stand-in")) continue;
    addMerged("ribbon:sidewalk-crossing-replacement",
      ribbon(span, crossingWidth, 0xffffff, 1.0, y, 0.02, "crossing_edges"),
      "crossing_edges");
    added += 1;
  }
  return added;
}

// Four independently seeded slabs make the aggregate and broom marks change at each joint
// instead of stamping one scored square across every sidewalk in the city.
const SLAB_BLOCK = 4;
function sidewalkSlab(variant, size, seed) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grit = (n) => random(n + seed * 977);
  const tone = 0.90 + grit(3) * 0.20;
  const base = [0x69, 0x6d, 0x65].map((v) => Math.round(v * tone));
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.02; i += 1) {
    ctx.fillStyle = grit(i * 13) < 0.56 ? "rgba(44,46,42,0.34)" : "rgba(166,168,158,0.22)";
    ctx.beginPath();
    ctx.arc(grit(i * 3) * size, grit(i * 5) * size, 1 + grit(i * 17) * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < size * size * 0.5; i += 1) {
    const shade = grit(i * 7);
    ctx.fillStyle = shade < 0.5 ? "rgba(0,0,0,0.20)"
      : shade < 0.85 ? "rgba(255,255,255,0.075)" : "rgba(104,96,84,0.16)";
    ctx.fillRect(grit(i * 3) * size, grit(i * 5) * size, 1, 1);
  }
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = grit(y * 29) < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.04)";
    ctx.fillRect(0, y, size, 1);
  }
  ctx.fillStyle = "rgba(58,60,56,0.20)";
  ctx.fillRect(0, 0, size, 6); ctx.fillRect(0, 0, 6, size);
  ctx.strokeStyle = "rgba(38,40,38,0.62)"; ctx.lineWidth = 3.0;
  if (variant === "narrow") {
    ctx.beginPath(); ctx.moveTo(1.5, 1.5); ctx.lineTo(size - 1.5, size - 1.5); ctx.stroke();
  } else ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  return canvas;
}
function sidewalkTexture(variant = "square") {
  const size = 128, block = variant === "narrow" ? 1 : SLAB_BLOCK;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * block;
  const ctx = canvas.getContext("2d");
  for (let bx = 0; bx < block; bx += 1) for (let by = 0; by < block; by += 1) {
    ctx.drawImage(sidewalkSlab(variant, size, bx * block + by), bx * size, by * size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

const SIDEWALK = sidewalkTexture();
const NARROW_SIDEWALK = sidewalkTexture("narrow");
//: One scored square, in metres. Five feet is the usual San Francisco pour.
const SLAB_M = 1.52;
const WALK_UV_M = SLAB_M * SLAB_BLOCK;
const NARROW_SLAB_M = 2.75;
const NARROW_WALK_M = 1.8;

function bikeLaneTexture() {
  // The green is a specified colour, not a mood. The Federal Highway Administration's interim
  // approval for green bicycle lanes fixes it by chromaticity, and what the approved coatings
  // come out as on the street is a deep emerald -- San Francisco's, laid over dark asphalt and
  // a few winters old, reads about here. The old #7fb99b was a pale sage: near enough to the
  // grass to be mistaken for it, and light enough that a white edge line painted on top of it
  // disappeared, which is why the lines read as missing when they were there all along.
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1c8752";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.18; i += 1) {
    const shade = random(i * 19);
    // The asphalt beneath showing through the wear, and the grit in the coating itself.
    ctx.fillStyle = shade < 0.55 ? "rgba(12,44,30,0.22)" : "rgba(126,196,158,0.14)";
    ctx.fillRect(random(i * 3) * size, random(i * 7) * size, 1, 1);
  }
  // No white bands baked into the edges of the tile. The lines beside a lane are 150 mm of
  // thermoplastic laid on the road, they are drawn as that, and a second painted-on pair a
  // tile's width apart fought with them wherever the tile happened to land.
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function sandTexture() {
  // Sand is grains, and grains are not one colour. Dry beach sand is quartz and feldspar with
  // dark magnetite and green olivine through it, so what the eye reads as "sand" is a fine
  // salt-and-pepper of half a dozen minerals over a pale ground -- and San Francisco's beaches
  // are the dark end of that, being largely granitic outwash.
  //
  // It was 35% coverage of single pixels in three colours, which averages to a flat tan card.
  // This is four mineral passes at different grain sizes over an uneven, wind-worked ground.
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b3a179";
  ctx.fillRect(0, 0, size, size);

  // The ground the grains lie on: damp patches, dry crests, and the shadow in the troughs of
  // the ripples the wind leaves. Without this the surface is flat however fine the grain is.
  for (let i = 0; i < 120; i += 1) {
    const r = 14 + random(i * 31) * 54;
    ctx.fillStyle = random(i * 7) < 0.5 ? "rgba(126,110,80,0.22)" : "rgba(214,199,163,0.20)";
    ctx.beginPath();
    ctx.arc(random(i * 3) * size, random(i * 5) * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Wind ripples: long shallow bands, a few centimetres apart, at a consistent angle.
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(0.5);
  for (let y = -size; y < size; y += 9) {
    ctx.fillStyle = "rgba(120,104,74,0.13)";
    ctx.fillRect(-size, y, size * 2, 3);
    ctx.fillStyle = "rgba(226,212,178,0.11)";
    ctx.fillRect(-size, y + 3, size * 2, 2);
  }
  ctx.restore();

  // The minerals, coarsest and darkest first. Quartz is most of it and is nearly white; the
  // dark specks are what stop a beach reading as a sheet of card.
  const grains = [
    ["rgba(52,44,32,0.55)", 1400, 1.6],     // magnetite, the black sand in the streaks
    ["rgba(122,96,58,0.45)", 5200, 1.3],    // feldspar
    ["rgba(198,176,132,0.40)", 9000, 1.1],  // the bulk of it
    ["rgba(243,236,214,0.42)", 5200, 1.0],  // quartz, catching the light
    ["rgba(96,120,84,0.28)", 900, 1.2],     // olivine, sparse and green
  ];
  let n = 0;
  for (const [colour, count, radius] of grains) {
    ctx.fillStyle = colour;
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const x = random(n * 2.7) * size;
      const y = random(n * 4.3) * size;
      const r = radius * (0.6 + random(n * 6.1) * 0.8);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // And the dark streaks the tide leaves along the high-water line, where the heavy minerals
  // concentrate. They are the one thing on a beach that is not uniform at any scale.
  for (let i = 0; i < 5; i += 1) {
    ctx.strokeStyle = "rgba(64,54,40,0.20)";
    ctx.lineWidth = 3 + random(i * 13) * 7;
    ctx.beginPath();
    let x = -10;
    let y = random(i * 17) * size;
    ctx.moveTo(x, y);
    while (x < size + 10) {
      x += 24;
      y += (random(x + i * 3) - 0.5) * 14;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // A beach is drawn from a ShapeGeometry, whose UVs are the footprint's own metres. A repeat
  // of six therefore lays a tile every sixteen centimetres, which minifies to a flat tan card
  // however finely the grains are drawn -- the same mistake the grass made. One third gives a
  // three metre tile, which is the scale the ripples and the tide streaks are drawn at.
  texture.repeat.set(1 / 3, 1 / 3);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const BIKE_LANE = bikeLaneTexture();
const SAND = sandTexture();
const BIKE_LANE_M = 1.75;
//: A two-way track mapped as its own way, where the map gives no width.
const BIKE_TRACK_TWO_WAY_M = 2.4;
const BIKE_EDGE_W_M = 0.18;

function bikePaintEdgeOffset(width) {
  // The stripe's whole width belongs *inside* the lane. Centering it on the
  // kerb buried its outer half under concrete, producing another partial line.
  return Math.max(0, width / 2 - BIKE_EDGE_W_M / 2 - 0.02);
}

// Which lane ends are joins and which are ends. Has to run after the widths are clamped, since
// the lane centre it keys on is measured from the carriageway edge, and after BIKE_LANE_M is
// declared, which is why it is here rather than beside the carriageway grid it reads.
inferBikeLaneGaps(DATA.ways);
indexBikeLaneEnds(DATA.ways);

// And which street ends are junctions rather than splits in the tagging, so the pavement is
// pulled back from the first and carries straight through the second.
indexStreetEnds(DATA.ways);

// Where the city's kerb steps in toward the junction -- a bulb-out -- the pavement follows it.
indexBulbOuts(DATA.ways);

// And the corners: where each pavement is cut at a junction, decided from the crossing
// street's pavement so that the two meet with the corner piece between them.
indexPavementCorners(DATA.ways);

// The junction boxes themselves, so no paint is carried across one.
indexIntersections(DATA.intersections);

//: Storey height and bay width in metres, so one tile of the facade covers one real storey.
const STOREY_M = 3.2;
const BAY_M = 4.0;

function facadeStoreyMetres(height) {
  // Fit a whole number of window rows between pavement and roof. Fixed 3.2 m
  // tiling clipped the upper windows on buildings of fractional-storey height.
  return height / Math.max(1, Math.round(height / STOREY_M));
}

// ExtrudeGeometry's default UVs come from the footprint's own coordinates, which stretches a
// facade by however large the building is in world space. This maps side walls to
// (distance along the wall, height) instead, so windows stay the same size on every building.
const FACADE_UV = {
  generateTopUV(geometry, vertices, a, b, c) {
    // Roofs carry no map, so these only need to exist and be finite.
    return [
      new THREE.Vector2(vertices[a * 3] / 20, vertices[a * 3 + 1] / 20),
      new THREE.Vector2(vertices[b * 3] / 20, vertices[b * 3 + 1] / 20),
      new THREE.Vector2(vertices[c * 3] / 20, vertices[c * 3 + 1] / 20),
    ];
  },
  generateSideWallUV(geometry, vertices, a, b, c, d) {
    const ax = vertices[a * 3], ay = vertices[a * 3 + 1], az = vertices[a * 3 + 2];
    const bx = vertices[b * 3], by = vertices[b * 3 + 1], bz = vertices[b * 3 + 2];
    const cz = vertices[c * 3 + 2], dz = vertices[d * 3 + 2];
    const run = Math.hypot(bx - ax, by - ay) / BAY_M;
    const base = Math.min(az, bz, cz, dz);
    const storey = facadeStoreyMetres(Math.max(0.1, Math.max(az, bz, cz, dz) - base));
    return [
      new THREE.Vector2(0, (az - base) / storey),
      new THREE.Vector2(run, (bz - base) / storey),
      new THREE.Vector2(run, (cz - base) / storey),
      new THREE.Vector2(0, (dz - base) / storey),
    ];
  },
};

function footprintShape(points) {
  if (!points || points.length < 4) return null;
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    const [x, y] = xy(point[0], point[1]);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  return shape;
}

function footprintMesh(points, color, opacity, y) {
  const shape = footprintShape(points);
  if (!shape) return null;
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  // No depth writing: this is a flat translucent plate the size of a building footprint, and
  // with depth on it hid whatever stood behind it.
  const mat = new THREE.MeshStandardMaterial({
    color, transparent: opacity < 1, opacity, roughness: 0.95, metalness: 0.02,
    side: THREE.DoubleSide, depthWrite: opacity >= 1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = y;
  return mesh;
}

function dividerFootprintIsRoadborne(feature) {
  // Both accepted sources state physical geometry.  Raised-kerb footprints often occupy the
  // intentional gap *between* separately mapped carriageways (Van Ness BRT is the conspicuous
  // corridor example), so requiring them to overlap a road ribbon deletes exactly the median
  // blocks this layer exists to restore.
  if (feature.divider_source === "traffic_calming_island"
      || feature.divider_source === "raised_kerb") return true;
  // Future explicit-width feeds still need a spatial guard before they may fill road space.
  const ring = feature.points.slice(0, -1);
  if (!ring.length) return false;
  let inside = 0;
  let cx = 0;
  let cz = 0;
  for (const point of ring) {
    const [x, y] = xy(point[0], point[1]);
    const z = -y;
    cx += x;
    cz += z;
    if (insideCarriageway(x, z, 0.35)) inside += 1;
  }
  cx /= ring.length;
  cz /= ring.length;
  return inside / ring.length >= 0.5 && insideCarriageway(cx, cz, 0.55);
}

function dividerBlockMesh(feature, roadTop) {
  const points = feature.points || [];
  if (points.length < 2) return null;
  const closed = points.length >= 4
    && points[0][0] === points[points.length - 1][0]
    && points[0][1] === points[points.length - 1][1];
  if (!closed) {
    // Reserved for explicit-width physical-divider feeds.  It makes the tile useful for a long
    // skinny strip while refusing to guess a fill from one bare kerb line.
    if (!feature.divider_width_m) return null;
    return ribbon(points, feature.divider_width_m, 0xffffff, 1,
      roadTop + DIVIDER_HEIGHT_M / 2, DIVIDER_HEIGHT_M, "divider_block");
  }
  const shape = footprintShape(points);
  if (!shape) return null;
  // Extruding the exact OSM ring naturally preserves pointed noses and triangular tapers.  A
  // one-step 35 mm bevel catches light at the kerb edge without swelling a narrow island enough
  // to cover adjacent lane paint.
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: DIVIDER_HEIGHT_M,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.035,
    bevelThickness: 0.025,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  const uv = geometry.getAttribute("uv");
  if (uv) {
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) / DIVIDER_TILE_M, uv.getY(i) / DIVIDER_TILE_M);
    }
    uv.needsUpdate = true;
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: DIVIDER_BLOCK,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.01,
    side: THREE.DoubleSide,
  }));
  mesh.position.y = roadTop + 0.01;
  mesh.userData.surface = "divider_block";
  return mesh;
}

function footprintMetrics(points) {
  const shape = footprintShape(points);
  if (!shape) return null;
  const local = points.map((p) => xy(p[0], p[1]));
  const xs = local.map((p) => p[0]);
  const ys = local.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    shape,
    x: (minX + maxX) / 2,
    z: -(minY + maxY) / 2,
    width: Math.max(4, maxX - minX),
    depth: Math.max(4, maxY - minY),
  };
}

function footprintArea(points) {
  if (!points || points.length < 4) return 0;
  const local = points.map((p) => xy(p[0], p[1]));
  let twice = 0;
  for (let i = 0; i < local.length - 1; i += 1) {
    twice += local[i][0] * local[i + 1][1] - local[i + 1][0] * local[i][1];
  }
  return Math.abs(twice) / 2;
}

