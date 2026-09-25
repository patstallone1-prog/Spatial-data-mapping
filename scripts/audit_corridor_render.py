#!/usr/bin/env python3
"""Ask the renderer's own rules what it is about to draw, without drawing it.

Two things keep going wrong on this map, from opposite directions, and neither is visible to a
test that reads the source. Ground cover laid over the carriageway -- front paths textured as
pavement, sitting in the middle of the street. And pavement deleted by a guard meant to prevent
exactly that, leaving black along the kerb. Each has now been fixed twice.

Looking at it is the honest check and is not always possible: a headless machine, or a browser
whose GPU has gone, and there is no picture to look at. But the rules that decide both are plain
geometry with no GPU in them, so this pulls them out of the page and runs them over the payload
the page will load. It reports, for the corridor as a whole:

  in the carriageway   ground rings whose corners stand on the roadway, before and after the
                       renderer's clip, and the fence runs that cross it
  beside the kerb      how much of the mapped footway survives the carriageway guard

Run it after any change to the widths, the guard, or the ground cover. It takes a few seconds
and it answers the question the screenshots were being used to answer.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_sf_corridor_3d.py"
PAGE_DATA = ROOT / "docs" / "sf-corridor-3d.json"
GROUND_DATA = ROOT / "docs" / "sf-corridor-ground.json"
OFFICIAL_DATA = ROOT / "docs" / "sf-corridor-official.json"
BASELINE_DATA = ROOT / "data" / "sf_corridor" / "audits" / "width_vs_kerb.json"

#: The rules, by name, exactly as the page defines them. Anything renamed fails loudly here
#: rather than quietly measuring nothing.
FUNCTIONS = (
    "distanceToSegmentSquared",
    "insideCarriageway",
    "pavementSurroundedByStreet",
    "addCarriagewaySegment",
    "dividerFootprintIsRoadborne",
    "laneCountForWay",
    "nominalRoadWidth",
    "renderedRoadWidth",
    "segmentRunsAlongside",
    "clampRoadWidthsToNeighbours",
    "renderedWalkWidth",
    "sameLevel",
    "rayFootprintDistance",
    "roomBetweenFacades",
    "isRoadTunnel",
    "isTunnelWay",
    "isDividedHalf",
    "indexDividedTwins",
    "dividedHalfWidth",
    "envelopeEdgesAt",
    "recentreOnKerbEnvelope",
    "halfWidthAt",
    "alongDistances",
    "officialKerbOffsetsAt",
    "inheritRecentring",
    "recentreStreetsOnOfficialKerbs",
    "offsetWay",
    "lerpLonLat",
    "wayLength",
    "trimWay",
    "trimWayEnds",
    "densifyWay",
    "lonLatFromXZ",
    "addOfficialCurbGridSegment",
    "closedPhysicalRing",
    "closedOfficialIslandRing",
    "indexMappedDividerGeometry",
    "indexOfficialCurbGeometry",
    "rayCurbIntersections",
    "officialCurbCrossingSpan",
    "crossingPaintLegs",
    "crossingRoadSpanPoints",
    "endCrossingOnDrawnKerb",
    "indexCurbRamps",
    "cornerOf",
    "rampRecordAt",
    "crossingRectanglePoints",
    "sidewalkCrossingReplacementSpans",
    "crossingDrawPose",
    "crossingBearingDifference",
    "crossingDrawConflict",
    "shouldDrawCrossing",
    "indexMappedCrossing",
    "nearMappedCrossing",
    "pavementRunsOutsideCarriageway",
    "mappedWalkNear",
    "kerbsideBlockedAt",
    "isUnmarkedService",
    "walkSidesToDraw",
    "indexStreetEnds",
    "streetContinuationsAt",
    "streetCarriesOn",
    "cornerLegAt",
    "kerbsideTrims",
    "walkFitsAt",
    "mappedWalkBeyondKerb",
    "bulbDepthAt",
    "halfWidthAt",
    "addBulbOuts",
    "addKerbsidePavement",
    "addPropertyLinePavementUnderlay",
)


def page_js() -> str:
    text = SOURCE.read_text(encoding="utf-8")
    start = text.index('<script type="module">')
    return text[start:text.index("</script>", start)]


def extract(name: str, js: str) -> str:
    head = f"function {name}("
    i = js.index(head)
    depth = 0
    body = -1
    for k in range(i + len(head) - 1, len(js)):
        if js[k] == "(":
            depth += 1
        elif js[k] == ")":
            depth -= 1
            if depth == 0:
                body = js.index("{", k)
                break
    depth = 0
    for k in range(body, len(js)):
        if js[k] == "{":
            depth += 1
        elif js[k] == "}":
            depth -= 1
            if depth == 0:
                return js[i:k + 1]
    raise AssertionError(f"{name} is not closed")


DRIVER = """
const fs = require('fs');
const DATA = JSON.parse(fs.readFileSync(process.env.PAGE_JSON, 'utf8'));
// A region outside San Francisco has no ground-cover record and no official geometry: the
// audit runs on what the page has, and the shares that need the city's kerbs come out empty.
const GROUND = fs.existsSync(process.env.GROUND_JSON) ? JSON.parse(fs.readFileSync(process.env.GROUND_JSON, 'utf8')) : { features: [] };
const OFFICIAL = fs.existsSync(process.env.OFFICIAL_JSON) ? JSON.parse(fs.readFileSync(process.env.OFFICIAL_JSON, 'utf8')) : { curb_lines: [], curb_ramps: [], islands: [], medians: [] };

const CARRIAGEWAY_CELL = 30;
const carriagewayGrid = new Map();
const OFFICIAL_CURB_CELL_M = 20.0;
const officialCurbGrid = new Map();
const officialIslandCurbGrid = new Map();
const crossingIslandCurbGrid = new Map();
const mappedDividerCurbGrid = new Map();
const officialMedianGrid = new Map();
const CROSSING_BRIDGE_GAP_M = 2.0;
const CROSSING_LEG_MIN_M = 0.7;
const CROSSING_STEP_M = 0.25;
const CROSSING_END_WALK_BACK_M = 1.5;
const RAMP_NODE_CELL_M = 40.0;
const RAMP_NODE_REACH_M = 22.0;
const rampNodeGrid = new Map();
const CROSSING_END_STEP_M = 0.05;
const CROSSING_MIN_ON_ROAD_M = 2.5;
const CROSSING_DEDUPE_CELL_M = 4.0;
const CROSSING_DEDUPE_ANGLE_DEG = 12.0;
const crossingDrawGrid = new Map();
const MAPPED_CROSSING_YIELD_M = 6.0;
const MAPPED_CROSSING_YIELD_DEG = 30.0;
const mappedCrossingGrid = new Map();
const bbox = DATA.bbox;
const midLat = (bbox.south + bbox.north) / 2;
const midLon = (bbox.west + bbox.east) / 2;
const metersPerLat = 111320;
const metersPerLon = metersPerLat * Math.cos(midLat * Math.PI / 180);
function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }
const MIN_RENDER_ROAD_M = 2.8;
const MAX_RENDER_ROAD_M = 24.0;
const MAX_INFERRED_ROAD_M = 16.5;
const SERVICE_ROAD_M = { driveway: 3.4, "drive-through": 3.4, parking_aisle: 6.0 };
const UNMARKED_SERVICE = new Set(Object.keys(SERVICE_ROAD_M));
function isUndergroundWay(way) { return way.tunnel_kind === "underground"; }
function isRoadTunnel(way) { return way.tunnel_kind === "road"; }
function tunnelStubs(points) { return [points]; }
const NEIGHBOUR_PARALLEL_DEG = 30;
const MIN_RENDER_WALK_M = 0.9;
const MAX_RENDER_WALK_M = 5.5;
const KERBSIDE_BLOCK_PROBE_M = 1.8;
const KERB_LIP_M = 0.1016;
const WALK_FALLBACK_WIDTHS_M = [1.0, 0.72, 0.52, 0.36, 0.24];
const WALK_ENOUGH = 0.55;
const WALK_WIDTH_RUN_M = 6.0;
const PROPERTY_LINE_PAVEMENT_WIDTH_M = 8.6;
const UNDERLAY_MIN_WIDTH_M = 0.8;
const UNDERLAY_RUN_M = 5.0;
const PROPERTY_LINE_PAVEMENT_Y = 0.012;
const PROPERTY_LINE_PAVEMENT_THICKNESS_M = 0.004;
const NARROW_WALK_M = 1.15;
const STREET_JOIN_M = 3.0;
const STREET_JOIN_DEG = 34.0;
const RECENTRE_END_MARGIN_M = 8.0;
const RECENTRE_STATION_M = 4.0;
const RECENTRE_MAX_SPREAD_M = 0.5;
const RECENTRE_MAX_SHIFT_M = 4.0;
const RECENTRE_MIN_SHIFT_M = 0.12;
const RECENTRE_VERTEX_REACH_M = 12.0;
const ENVELOPE_VERTEX_M = 24.0;
const ENVELOPE_MIN_EDGE_M = 0.6;
const ENVELOPE_MIN_SPAN_M = 2.4;
const ENVELOPE_MAX_SPREAD_M = 0.9;
const ENVELOPE_MIN_WAY_M = 10.0;
const ROW_MISMATCH_FACTOR = 2.0;
const ENVELOPE_RELABEL_M = 1.0;
const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half", "tunnel_cut"]);
const FACADE_GAP_M = 0.3;
const WALK_TO_FACADE_MAX_M = 7.0;
const FACADE_ROOM_WALK_M = 1.4;
// The building footprints, for the building line the widths and pavements are held to.
const FOOTPRINT_CELL = 60;
const footprintGrid = new Map();
for (const way of DATA.ways) {
  if (way.kind !== "building" || !way.points || way.points.length < 4) continue;
  const local = way.points.map((p) => { const [x, y] = xy(p[0], p[1]); return [x, -y]; });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of local) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const entry = { way, local, minX, maxX, minZ, maxZ };
  for (let ix = Math.floor(minX / FOOTPRINT_CELL); ix <= Math.floor(maxX / FOOTPRINT_CELL); ix += 1)
    for (let iz = Math.floor(minZ / FOOTPRINT_CELL); iz <= Math.floor(maxZ / FOOTPRINT_CELL); iz += 1) {
      const key = `${ix}:${iz}`;
      let bucket = footprintGrid.get(key);
      if (!bucket) footprintGrid.set(key, bucket = []);
      bucket.push(entry);
    }
}
const streetEndGrid = new Map();
const CORNER_JOIN_M = 1.0;
const CORNER_CELL_M = 4.0;
const cornerLegGrid = new Map();
const pavementCornerCuts = new Map();
const pavementCornerLaid = new Map();

__FUNCTIONS__

function addPavementRibbon(points, width, color, opacity, y, thickness, surface) {
  let laid = 0;
  for (const run of pavementRunsOutsideCarriageway(points, width)) laid += wayLength(run);
  return laid;
}
function stampPaved() {}
function insideJunctionBox() { return false; }
function ribbon(points, width) { return { points, width }; }
function addMerged() {}

const MAPPED_WALK_CELL = 40;
const mappedWalkGrid = new Map();
const MAPPED_WALK_ABUT_M = 7.0;
const MAPPED_WALK_GAP_MIN_M = 0.35;
const BULB_STATION_M = 2.0;
const KERB_FALLBACK = 0.126;
const KERB_RENDER_MAX_M = 0.2;
const ROAD_TOP_M = 0.06;
function surfaceMaterial() { return {}; }
const MAPPED_WALK_REACH_M = 11.0;
for (const way of DATA.ways) {
  if ((way.kind !== "sidewalk" && way.kind !== "path") || !way.points || way.points.length < 2) continue;
  for (let i = 1; i < way.points.length; i += 1) {
    const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
    const [bx, by] = xy(way.points[i][0], way.points[i][1]);
    const segment = [ax, -ay, bx, -by];
    const x0 = Math.floor(Math.min(ax, bx) / MAPPED_WALK_CELL);
    const x1 = Math.floor(Math.max(ax, bx) / MAPPED_WALK_CELL);
    const z0 = Math.floor(Math.min(-ay, -by) / MAPPED_WALK_CELL);
    const z1 = Math.floor(Math.max(-ay, -by) / MAPPED_WALK_CELL);
    for (let ix = x0 - 1; ix <= x1 + 1; ix += 1)
      for (let iz = z0 - 1; iz <= z1 + 1; iz += 1) {
        const key = `${ix}:${iz}`;
        let bucket = mappedWalkGrid.get(key);
        if (!bucket) mappedWalkGrid.set(key, bucket = []);
        bucket.push(segment);
      }
  }
}

// The same order the page uses: the city's kerbs first, every way moved onto its kerb
// envelope, then the fallbacks for the ways the city drew no kerb for.
indexOfficialCurbGeometry(OFFICIAL.curb_lines || []);
indexCurbRamps(OFFICIAL.curb_ramps || []);
const DIVIDED_TWIN_MIN_M = 4.0;
const DIVIDED_TWIN_MAX_M = 40.0;
indexDividedTwins(DATA.ways);
const recentred = recentreStreetsOnOfficialKerbs(DATA.ways);
indexMappedDividerGeometry(DATA.ways);
clampRoadWidthsToNeighbours(DATA.ways);
indexStreetEnds(DATA.ways);
for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  if (isUndergroundWay(way)) continue;
  const half = renderedRoadWidth(way) / 2;
  const along = way._spans ? alongDistances(way.points) : null;
  for (let i = 1; i < way.points.length; i += 1) {
    const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
    const [bx, by] = xy(way.points[i][0], way.points[i][1]);
    const segmentHalf = along
      ? (halfWidthAt(way, along[i - 1]) + halfWidthAt(way, along[i])) / 2 : half;
    addCarriagewaySegment(ax, -ay, bx, -by, segmentHalf, way);
  }
}

// -- rendered width against the city's kerbs -------------------------------------------------
//
// The one comparison that says whether a street is drawn as wide as it is. Kerb to kerb (or
// kerb to island kerb) read straight off the city's lines every eight metres along each way,
// against the width the way is drawn at, per source of that width. A street more than three
// metres off is drawn under its pavement or with black beside it.
const UNMARKED = new Set(["driveway", "drive-through", "parking_aisle", "access"]);
const widthRows = [];
for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  if (way.tunnel_kind || UNMARKED.has(way.service)) continue;
  const dense = densifyWay(way.points, 8);
  const spans = [];
  for (let i = 1; i + 1 < dense.length; i += 1) {
    const [px, py] = xy(dense[i - 1][0], dense[i - 1][1]);
    const [x, y] = xy(dense[i][0], dense[i][1]);
    const [qx, qy] = xy(dense[i + 1][0], dense[i + 1][1]);
    const dx = qx - px, dz = -(qy - py);
    const s = Math.hypot(dx, dz) || 1;
    const nx = dz / s, nz = -dx / s;
    // A divided half is measured from its outer kerb to the median: the city's island kerb
    // where it drew one, else the median the lidar measured (measure_medians_lidar.py) --
    // a raised one as an island line, a painted centre as a median line. The other buckets
    // never see the median lines: a painted centre is not a kerb.
    const hits = rayCurbIntersections(x, -y, nx, nz, 24, officialCurbGrid)
      .concat(rayCurbIntersections(x, -y, nx, nz, 24, officialIslandCurbGrid))
      .concat(isDividedHalf(way) ? rayCurbIntersections(x, -y, nx, nz, 24, officialMedianGrid) : [])
      .sort((a, b) => a - b);
    const neg = hits.filter((v) => v < -0.8).pop();
    const pos = hits.find((v) => v > 0.8);
    if (neg === undefined || pos === undefined || pos - neg > 40) continue;
    spans.push(pos - neg);
  }
  if (spans.length < 3) continue;
  spans.sort((a, b) => a - b);
  const kerb = spans[Math.floor(spans.length / 2)];
  const drawn = renderedRoadWidth(way);
  widthRows.push({ name: way.name || null, source: way.road_source || "none",
                   divided: isDividedHalf(way), enveloped: way._spans !== undefined,
                   drawnM: +drawn.toFixed(2), kerbM: +kerb.toFixed(2),
                   diffM: +(drawn - kerb).toFixed(2), rejectedRecordM: way.road_record_rejected || null,
                   layer: way.layer || 0, at: way.points[Math.floor(way.points.length / 2)] });
}
const widthBySource = {};
for (const row of widthRows) {
  const key = row.divided ? "divided_half" : row.source;
  (widthBySource[key] = widthBySource[key] || []).push(Math.abs(row.diffM));
}
const widthStat = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  // No kerb lines at all (a region without the city's records) is an empty comparison, not a crash.
  if (!sorted.length) return { ways: 0, medianAbsM: null, p90AbsM: null, over3M: 0 };
  return { ways: sorted.length,
           medianAbsM: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
           p90AbsM: +sorted[Math.floor(sorted.length * 0.9)].toFixed(2),
           over3M: sorted.filter((v) => v > 3).length };
};
// A way on another level -- a tunnel bore, a bridge deck, anything with a layer -- keeps the
// width it was measured at: the street over or under it is not beside it.
const levelRows = [];
for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  if (!((way.layer || 0) !== 0 || way.tunnel_kind === "road")) continue;
  // Named: the nameless ramps of a bridge approach run beside each other on their own level
  // and share it out as any two streets do.
  if (!way.name || !way.road_m || !MEASURED_ROAD_SOURCES.has(way.road_source)) continue;
  const drawn = renderedRoadWidth(way);
  const expected = Math.min(way.road_m, MAX_RENDER_ROAD_M);
  levelRows.push({ name: way.name || null, layer: way.layer || 0, tunnel: way.tunnel_kind || null,
                   roadM: +way.road_m.toFixed(2), drawnM: +drawn.toFixed(2),
                   clamped: drawn < expected - 0.05 });
}
// Streets and buildings: a roadway never runs through the houses either side of it, and a
// building never stands on the carriageway. Both counted from the footprints and the drawn
// carriageway, so a width or a footprint that puts one in the other fails here.
let buildingsOnRoad = 0;
for (const way of DATA.ways) {
  if (way.kind !== "building" || !way.points || way.points.length < 4) continue;
  let on = 0;
  for (const q of way.points) {
    const [x, y] = xy(q[0], q[1]);
    if (insideCarriageway(x, -y, -0.5)) on += 1;
  }
  if (on >= 2) buildingsOnRoad += 1;
}
let roadThroughFacade = 0;
for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  if (isTunnelWay(way) || UNMARKED.has(way.service)) continue;
  const half = renderedRoadWidth(way) / 2;
  const dense = densifyWay(way.points, 12);
  let through = false;
  for (let i = 1; i + 1 < dense.length && !through; i += 1) {
    const [px, py] = xy(dense[i - 1][0], dense[i - 1][1]);
    const [x, y] = xy(dense[i][0], dense[i][1]);
    const [qx, qy] = xy(dense[i + 1][0], dense[i + 1][1]);
    const dx = qx - px, dz = -(qy - py);
    const s = Math.hypot(dx, dz) || 1;
    const nx = dz / s, nz = -dx / s;
    for (const sign of [1, -1]) {
      const facade = rayFootprintDistance(x, -y, sign * nx, sign * nz, half + 0.5);
      if (facade !== null && facade < half - 0.5) { through = true; break; }
    }
  }
  if (through) roadThroughFacade += 1;
}
const widthReport = {
  ways: widthRows.length,
  buildings: { onRoad2plus: buildingsOnRoad, roadThroughFacade },
  otherLevels: { ways: levelRows.length, clamped: levelRows.filter((r) => r.clamped).length,
                 rows: levelRows.filter((r) => r.clamped).slice(0, 12) },
  enveloped: widthRows.filter((r) => r.enveloped).length,
  recordsRejected: widthRows.filter((r) => r.rejectedRecordM).length,
  tooNarrowOver3M: widthRows.filter((r) => r.diffM < -3).length,
  tooWideOver3M: widthRows.filter((r) => r.diffM > 3).length,
  all: process.env.AUDIT_WIDTH_ALL ? widthRows : undefined,
  medianAbsM: widthStat(widthRows.map((r) => Math.abs(r.diffM))).medianAbsM,
  bySource: Object.fromEntries(Object.entries(widthBySource).map(([k, v]) => [k, widthStat(v)])),
  worst: widthRows.slice().sort((a, b) => Math.abs(b.diffM) - Math.abs(a.diffM)).slice(0, 12),
  recentred,
};

// -- OSM physical dividers, distinct from the lane-paint pass -------------------------------
let dividerMapped = 0;
let dividerRendered = 0;
const dividerBySource = {};
for (const way of DATA.ways) {
  if (way.kind !== "divider" || !way.points || way.points.length < 4) continue;
  dividerMapped += 1;
  dividerBySource[way.divider_source] = (dividerBySource[way.divider_source] || 0) + 1;
  if (dividerFootprintIsRoadborne(way)) dividerRendered += 1;
}

// -- crosswalks attached to the local kerbs -------------------------------------------------
let crossingWays = 0;
let crossingRendered = 0;
let crossingKerbAttached = 0;
let crossingUnionBoundary = 0;
let crossingLengthM = 0;
let crossingOfficial = 0;
let crossingFallback = 0;
let crossingSplitForIslands = 0;
let crossingLegs = 0;
let crossingLegsAttached = 0;
let crossingWholeSpan = 0;
let crossingEnds = 0, crossingEndsRamp = 0, crossingEndsNoRamp = 0, crossingEndsNoRecord = 0;
const crossingSplitExamples = [];
const focusCrossingIds = new Set((process.env.FOCUS_CROSSING_IDS || "").split(",").filter(Boolean).map(Number));
const focusCrossings = [];
for (const way of DATA.ways) {
  if (way.kind !== "crossing" || !way.points || way.points.length < 2) continue;
  if (wayLength(way.points) > 40) continue;
  crossingWays += 1;
  const span = crossingRectanglePoints(way.points);
  if (!span || span.length < 2) continue;
  crossingRendered += 1;
  if (span.provenance === "sfmta_curbs") crossingOfficial += 1;
  if (span.provenance === "road_width_fallback") crossingFallback += 1;
  const legs = crossingPaintLegs(span);
  if (focusCrossingIds.has(Number(way.osm_id))) focusCrossings.push({
    osmId: way.osm_id, mapped: way.points, span, legs,
  });
  crossingLegs += legs.length;
  if (legs.length === 1 && legs[0] === span) crossingWholeSpan += 1;
  for (const leg of legs) {
    const [lax, lay] = xy(leg[0][0], leg[0][1]);
    const [lbx, lby] = xy(leg[leg.length - 1][0], leg[leg.length - 1][1]);
    const llen = Math.hypot(lbx - lax, lby - lay) || 1;
    const lux = (lbx - lax) / llen, luz = -(lby - lay) / llen;
    const ins = 0.25;
    if (insideCarriageway(lax + lux * ins, -lay + luz * ins, 0.0)
        && insideCarriageway(lbx - lux * ins, -lby - luz * ins, 0.0)) crossingLegsAttached += 1;
  }
  for (const end of [span[0], span[span.length - 1]]) {
    const [ex, ey] = xy(end[0], end[1]);
    const record = rampRecordAt(ex, -ey);
    crossingEnds += 1;
    if (record === "ramp") crossingEndsRamp += 1;
    else if (record === "no_ramp") crossingEndsNoRamp += 1;
    else crossingEndsNoRecord += 1;
  }
  if (legs.length > 1) {
    crossingSplitForIslands += 1;
    if (crossingSplitExamples.length < 6) {
      crossingSplitExamples.push({osmId: way.osm_id,
        at: [+((span[0][0] + span[1][0]) / 2).toFixed(6),
             +((span[0][1] + span[1][1]) / 2).toFixed(6)]});
    }
  }
  crossingLengthM += wayLength(span);
  const [ax, ay] = xy(span[0][0], span[0][1]);
  const [bx, by] = xy(span[1][0], span[1][1]);
  const az = -ay;
  const bz = -by;
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length;
  const uz = dz / length;
  const inset = 0.25;
  const aInside = insideCarriageway(ax + ux * inset, az + uz * inset, 0.0);
  const aOutside = insideCarriageway(ax - ux * inset, az - uz * inset, 0.0);
  const bInside = insideCarriageway(bx - ux * inset, bz - uz * inset, 0.0);
  const bOutside = insideCarriageway(bx + ux * inset, bz + uz * inset, 0.0);
  // The inset on both ends must be on the selected carriageway. The outset may still be in the
  // *other* street at a four-way junction, so report that stronger union-boundary check
  // separately rather than mislabelling a correct corner crossing as detached.
  if (aInside && bInside) crossingKerbAttached += 1;
  if (aInside && bInside && !aOutside && !bOutside) crossingUnionBoundary += 1;
  indexMappedCrossing(span);
}

// -- sidewalks drawn through a junction: the plain stand-in crossing they get, and whether it
// would have taken the place of a mapped crossing. The page lays sidewalks before crossings,
// so a stand-in that does not yield claims the spot and the city's crossing is thrown out as
// its duplicate. Laid here in the page's order: every stand-in that survives is registered,
// then every mapped crossing is asked whether it would still draw.
let standIns = 0;
let standInsYielding = 0;
let standInsLaid = 0;
for (const way of DATA.ways) {
  if ((way.kind !== "sidewalk" && way.kind !== "path") || !way.points || way.points.length < 2) continue;
  for (const span of sidewalkCrossingReplacementSpans(densifyWay(way.points), 3.7)) {
    standIns += 1;
    if (nearMappedCrossing(span)) { standInsYielding += 1; continue; }
    if (shouldDrawCrossing(span, 3.7, "stand-in")) standInsLaid += 1;
  }
}
let mappedSuppressedByStandIn = 0;
const suppressedExamples = [];
// A mapped crossing that OpenStreetMap drew twice is a duplicate of itself, which is the
// dedupe doing its job; only a conflict with a stand-in counts here.
for (const way of DATA.ways) {
  if (way.kind !== "crossing" || !way.points || way.points.length < 2) continue;
  if (wayLength(way.points) > 40) continue;
  const span = crossingRectanglePoints(way.points);
  if (!span || span.length < 2) continue;
  const pose = crossingDrawPose(span);
  const conflict = pose && crossingDrawConflict(pose, way.crossing_m || 3.7);
  if (conflict && conflict.tag === "stand-in") {
    mappedSuppressedByStandIn += 1;
    if (suppressedExamples.length < 6) {
      suppressedExamples.push({osmId: way.osm_id,
        at: [+((span[0][0] + span[1][0]) / 2).toFixed(6),
             +((span[0][1] + span[1][1]) / 2).toFixed(6)]});
    }
  }
}

// -- ground cover standing on the roadway ---------------------------------------------------
const layers = {};
for (const key of ["parks", "yards", "lawns", "backyards", "front_walks", "service_yards",
                   "pitches"]) {
  const rings = GROUND[key] || [];
  let touching = 0;
  let corners = 0;
  let cornersOn = 0;
  for (const item of rings) {
    let on = 0;
    for (const [lon, lat] of item.p) {
      const [x, y] = xy(lon, lat);
      corners += 1;
      if (insideCarriageway(x, -y, 0.15)) { on += 1; cornersOn += 1; }
    }
    if (on) touching += 1;
  }
  layers[key] = { rings: rings.length, ringsTouchingRoad: touching,
                  corners, cornersOnRoad: cornersOn };
}

let fenceRuns = 0;
let fenceOnRoad = 0;
for (const flat of Object.values(GROUND.fences || {})) {
  for (let i = 0; i + 3 < flat.length; i += 4) {
    fenceRuns += 1;
    // Along the run, not only at its ends: a long fence can pass clean through a street with
    // both of its endpoints on somebody's lawn.
    const steps = Math.max(2, Math.ceil(Math.hypot(flat[i + 2] - flat[i],
                                                   flat[i + 3] - flat[i + 1]) / 2));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      const x = flat[i] + (flat[i + 2] - flat[i]) * t;
      const y = flat[i + 1] + (flat[i + 3] - flat[i + 1]) * t;
      if (insideCarriageway(x, -y, 0.15)) { fenceOnRoad += 1; break; }
    }
  }
}

// -- footway surviving the guard --------------------------------------------------------------
let askedM = 0;
let keptM = 0;
let erased = 0;
let walkWays = 0;
for (const way of DATA.ways) {
  if (way.kind !== "sidewalk" || !way.points || way.points.length < 2) continue;
  walkWays += 1;
  const width = renderedWalkWidth(way, 3.6);
  const asked = wayLength(way.points);
  const runs = pavementRunsOutsideCarriageway(way.points, width);
  const kept = runs.reduce((sum, run) => sum + wayLength(run), 0);
  askedM += asked;
  keptM += kept;
  if (asked > 5 && kept < asked * 0.1) erased += 1;
}

// -- is there pavement beside every kerb ------------------------------------------------------
//
// The mapped sidewalk ways are not the only pavement: one is derived from each street's own kerb
// outward, which is what covers the blocks OpenStreetMap has no sidewalk for. The question that
// matters for the black-along-the-kerb regression is whether anything survives on each side of
// each street, from either source -- so this asks the derived one, way by way and side by side.
// (offsetWay is the page's own, pulled in with the rules above; a private copy here once
// shadowed it and could not take the per-vertex offsets the kerb envelope produces.)
let sides = 0;
let sidesBlockedByNeighbour = 0;
let sidesRequiringPavement = 0;
let sidesBare = 0;
const bareExamples = [];
const bareAll = [];
for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  if (wayLength(way.points) < 12) continue;
  const road = renderedRoadWidth(way);
  const walk = renderedWalkWidth(way, 4.0);
  const inner = road / 2;
  for (const side of walkSidesToDraw(way, way.points, inner)) {
    sides += 1;
    const stations = densifyWay(way.points, 5.0);
    let blockedStations = 0;
    for (let i = 0; i < stations.length; i += 1) {
      if (kerbsideBlockedAt(stations[Math.max(0, i - 1)], stations[i],
                           stations[Math.min(stations.length - 1, i + 1)], side, inner)) {
        blockedStations += 1;
      }
    }
    const blockedShare = blockedStations / Math.max(1, stations.length);
    // A median-facing side of a divided carriageway is supposed to have roadway beyond its
    // kerb, not a sidewalk. Count it separately instead of reporting correct road as a black
    // pavement hole.
    if (blockedShare >= 0.75) {
      sidesBlockedByNeighbour += 1;
      continue;
    }
    sidesRequiringPavement += 1;
    // Use the renderer's current run-based placement, not the old width-ladder approximation.
    // This keeps the audit from reporting black kerbs that the page no longer draws.
    const wanted = wayLength(way.points);
    const kept = addKerbsidePavement(way.points, side, inner, walk, 0, 1, 0, 0.1);
    const underlay = addPropertyLinePavementUnderlay(
      way.points, side, inner, walk, 0, 1);
    // The low adaptive underlay is an intentional pavement surface: it fills the survey and
    // property-line slivers the stable-width sidewalk cannot cover without stacking tiles.
    if (Math.max(kept, underlay) < wanted * 0.25) {
      sidesBare += 1;
      if (bareExamples.length < 10) {
        bareExamples.push({ street: way.name || way.osm_id, side,
                            at: way.points[Math.floor(way.points.length / 2)] });
      }
      if (process.env.AUDIT_BARE_ALL) {
        bareAll.push({ street: way.name || way.osm_id, osmId: way.osm_id, side,
                       lengthM: +wanted.toFixed(1), keptM: +kept.toFixed(1),
                       underlayM: +underlay.toFixed(1), roadM: +road.toFixed(1),
                       walkM: +walk.toFixed(1), blockedShare: +blockedShare.toFixed(2),
                       service: way.service || null,
                       walkSides: way.walk_sides || null,
                       at: way.points[Math.floor(way.points.length / 2)] });
      }
    }
  }
}

// -- the cross-sections: what the facts say about every station -----------------------------
function crossSectionReport() {
  const out = { ways: 0, stations: 0, resolved: 0, partial: 0, unresolved: 0,
                kerbSurvey: 0, kerbLidar: 0, kerbImage: 0, kerbMapped: 0, kerbInferred: 0,
                resolvedMeasured: 0,
                parkingMeasured: 0, parkingPrior: 0, parkingAssumed: 0, junctionsUnmatched: 0,
                reasons: {} };
  for (const way of DATA.ways) {
    if (!way.xs) continue;
    out.ways += 1;
    if (way.xs_junction) out.junctionsUnmatched += Object.keys(way.xs_junction).length;
    for (const row of way.xs) {
      out.stations += 1;
      out[{ r: "resolved", p: "partial", u: "unresolved" }[row[4]]] += 1;
      out[{ S: "kerbSurvey", L: "kerbLidar", I: "kerbImage", M: "kerbMapped", N: "kerbInferred" }[row[3]]] += 1;
      // Resolved *because measured*: the kerbs came off a survey or a sensor and the bands
      // closed between them. Resolved on a mapped width is a prior that fit, and is counted apart.
      if (row[4] === "r" && (row[3] === "S" || row[3] === "L" || row[3] === "I")) out.resolvedMeasured += 1;
      for (const b of row[5]) {
        if (b[0] !== "p") continue;
        if (b[2] === "I" || b[2] === "L") out.parkingMeasured += 1;
        else if (b[3] < 0.5) out.parkingAssumed += 1;
        else out.parkingPrior += 1;
      }
      for (const code of row[6] || []) out.reasons[code] = (out.reasons[code] || 0) + 1;
    }
  }
  out.resolvedShare = +(out.resolved / Math.max(1, out.stations)).toFixed(3);
  out.unresolvedShare = +(out.unresolved / Math.max(1, out.stations)).toFixed(3);
  out.kerbSurveyShare = +(out.kerbSurvey / Math.max(1, out.stations)).toFixed(3);
  out.kerbMeasuredShare = +((out.kerbSurvey + out.kerbLidar + out.kerbImage) / Math.max(1, out.stations)).toFixed(3);
  out.resolvedMeasuredShare = +(out.resolvedMeasured / Math.max(1, out.stations)).toFixed(3);
  return out;
}

console.log(JSON.stringify({
  kerbside: { sides, sidesBlockedByNeighbour, sidesRequiringPavement,
              sidesWithoutPavement: sidesBare,
              share: +(sidesBare / Math.max(1, sidesRequiringPavement)).toFixed(3),
              examples: bareExamples,
              all: process.env.AUDIT_BARE_ALL ? bareAll : undefined },
  groundOnCarriageway: layers,
  fences: { runs: fenceRuns, crossingRoad: fenceOnRoad },
  divider: { mapped: dividerMapped, rendered: dividerRendered, bySource: dividerBySource },
  crosswalk: {
    ways: crossingWays,
    rendered: crossingRendered,
    kerbAttached: crossingKerbAttached,
    attachedShare: +(crossingKerbAttached / Math.max(crossingRendered, 1)).toFixed(3),
    unionBoundary: crossingUnionBoundary,
    unionBoundaryShare: +(crossingUnionBoundary / Math.max(crossingRendered, 1)).toFixed(3),
    officialResolved: crossingOfficial,
    officialShare: +(crossingOfficial / Math.max(crossingRendered, 1)).toFixed(3),
    fallbackResolved: crossingFallback,
    // The bars as drawn: each leg of each crossing, ending on a drawn carriageway.
    legs: crossingLegs,
    legsAttached: crossingLegsAttached,
    legsAttachedShare: +(crossingLegsAttached / Math.max(crossingLegs, 1)).toFixed(3),
    wholeSpanFallback: crossingWholeSpan,
    splitForIslands: crossingSplitForIslands,
    ...(focusCrossingIds.size ? {focusCrossings} : {}),
    splitExamples: crossingSplitExamples,
    meanLengthM: +(crossingLengthM / Math.max(crossingRendered, 1)).toFixed(2),
    // Each end against the curb-ramp inventory: at a corner with a ramp, at one listed
    // without a ramp, or at no listed intersection at all.
    ends: crossingEnds,
    endsAtRamp: crossingEndsRamp,
    endsAtRampShare: +(crossingEndsRamp / Math.max(crossingEnds, 1)).toFixed(3),
    endsAtCornerWithoutRamp: crossingEndsNoRamp,
    endsWithNoRecord: crossingEndsNoRecord,
    // Sidewalk stand-ins, and the mapped crossings one would have displaced.
    standIns,
    standInsYielding,
    standInsLaid,
    mappedSuppressedByStandIn,
    suppressedExamples,
  },
  widthVsKerb: widthReport,
  crossSections: crossSectionReport(),
  footway: {
    ways: walkWays,
    askedKm: +(askedM / 1000).toFixed(2),
    keptKm: +(keptM / 1000).toFixed(2),
    keptShare: +(keptM / askedM).toFixed(3),
    waysErased: erased,
  },
}, null, 1));
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--page", type=Path, default=PAGE_DATA)
    ap.add_argument("--ground", type=Path, default=GROUND_DATA)
    ap.add_argument("--official", type=Path, default=OFFICIAL_DATA)
    ap.add_argument("--focus-crossing", type=int, action="append", default=[],
                    help="include mapped and rendered endpoints for an OSM crossing ID")
    ap.add_argument("--baseline", type=Path, nargs="?", const=BASELINE_DATA, default=None,
                    help="also write the regression baseline tests/test_width_vs_kerb.py holds "
                         "a build to (default data/sf_corridor/audits/width_vs_kerb.json)")
    args = ap.parse_args()

    node = shutil.which("node")
    if node is None:
        print("node is needed to run the renderer's own rules", file=sys.stderr)
        return 2

    js = page_js()
    driver = DRIVER.replace("__FUNCTIONS__",
                            "\n".join(extract(name, js) for name in FUNCTIONS))
    out = subprocess.run([node, "-e", driver], capture_output=True, text=True, timeout=900,
                         env={**os.environ, "PAGE_JSON": str(args.page),
                              "GROUND_JSON": str(args.ground),
            "OFFICIAL_JSON": str(args.official),
            "FOCUS_CROSSING_IDS": ",".join(map(str, args.focus_crossing))})
    if out.returncode != 0:
        print(out.stderr, file=sys.stderr)
        return 1
    print(out.stdout)
    if args.baseline is not None:
        report = json.loads(out.stdout)
        previous = (json.loads(args.baseline.read_text(encoding="utf-8"))
                    if args.baseline.exists() else {})
        args.baseline.write_text(json.dumps(baseline_from(report, previous), indent=1) + "\n",
                                 encoding="utf-8")
        print(f"baseline written to {args.baseline}", file=sys.stderr)
    return 0


def baseline_from(report: dict, previous: dict) -> dict:
    """The numbers a build is held to, read off one audit report.

    Every figure here is a measurement of the build the baseline was cut from; the notes are
    carried over from the previous baseline so the reasons for a deliberate step stay with it.
    """
    width = report["widthVsKerb"]
    crosswalk = report["crosswalk"]
    out = {
        "note": "Rendered carriageway width against the city's kerb lines, from "
                "scripts/audit_corridor_render.py (widthVsKerb). tests/test_width_vs_kerb.py "
                "fails when a build gets worse than this; regenerate deliberately with "
                "`python scripts/audit_corridor_render.py --baseline` after a change that "
                "improves it.",
        "ways": width["ways"],
        "enveloped": width["enveloped"],
        "tooNarrowOver3M": width["tooNarrowOver3M"],
        "tooWideOver3M": width["tooWideOver3M"],
        "medianAbsM": width["medianAbsM"],
        "bySource": width["bySource"],
        "otherLevelsClamped": width["otherLevels"]["clamped"],
        "crosswalkAttachedShare": crosswalk["attachedShare"],
        "crosswalkLegs": crosswalk["legs"],
        "crosswalkLegsAttachedShare": crosswalk["legsAttachedShare"],
        "crosswalkWholeSpanFallback": crosswalk["wholeSpanFallback"],
        "crosswalkSplitForIslands": crosswalk["splitForIslands"],
        "crosswalkStandInsLaid": crosswalk["standInsLaid"],
        "crosswalkEndsAtRampShare": crosswalk["endsAtRampShare"],
        "crossSectionStations": report["crossSections"]["stations"],
        "crossSectionResolvedShare": report["crossSections"]["resolvedShare"],
        "crossSectionUnresolvedShare": report["crossSections"]["unresolvedShare"],
        "crossSectionKerbSurveyShare": report["crossSections"]["kerbSurveyShare"],
        "crossSectionKerbMeasuredShare": report["crossSections"]["kerbMeasuredShare"],
        "crossSectionResolvedMeasuredShare": report["crossSections"]["resolvedMeasuredShare"],
        "crossSectionParkingMeasured": report["crossSections"]["parkingMeasured"],
        "crosswalkMappedSuppressedByStandIn": crosswalk["mappedSuppressedByStandIn"],
        "footwayKeptShare": report["footway"]["keptShare"],
        "kerbsideBareShare": report["kerbside"]["share"],
        "roadThroughFacade": width["buildings"]["roadThroughFacade"],
        "buildingsOnRoad2plus": width["buildings"]["onRoad2plus"],
    }
    for key, value in previous.items():
        if key.endswith("Note") and key not in out:
            out[key] = value
    return out


if __name__ == "__main__":
    raise SystemExit(main())
