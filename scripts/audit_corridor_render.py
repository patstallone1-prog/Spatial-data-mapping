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

#: The rules, by name, exactly as the page defines them. Anything renamed fails loudly here
#: rather than quietly measuring nothing.
FUNCTIONS = (
    "distanceToSegmentSquared",
    "insideCarriageway",
    "addCarriagewaySegment",
    "laneCountForWay",
    "nominalRoadWidth",
    "renderedRoadWidth",
    "clampRoadWidthsToNeighbours",
    "renderedWalkWidth",
    "lerpLonLat",
    "wayLength",
    "trimWay",
    "pavementRunsOutsideCarriageway",
    "mappedWalkNear",
    "walkSidesToDraw",
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
const DATA = JSON.parse(require('fs').readFileSync(process.env.PAGE_JSON, 'utf8'));
const GROUND = JSON.parse(require('fs').readFileSync(process.env.GROUND_JSON, 'utf8'));

const CARRIAGEWAY_CELL = 30;
const carriagewayGrid = new Map();
const bbox = DATA.bbox;
const midLat = (bbox.south + bbox.north) / 2;
const midLon = (bbox.west + bbox.east) / 2;
const metersPerLat = 111320;
const metersPerLon = metersPerLat * Math.cos(midLat * Math.PI / 180);
function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }
const MIN_RENDER_ROAD_M = 2.8;
const MAX_RENDER_ROAD_M = 24.0;
const MAX_INFERRED_ROAD_M = 16.5;
const MIN_RENDER_WALK_M = 0.9;
const MAX_RENDER_WALK_M = 5.5;

__FUNCTIONS__

const MAPPED_WALK_CELL = 40;
const mappedWalkGrid = new Map();
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

clampRoadWidthsToNeighbours(DATA.ways);
for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  const half = renderedRoadWidth(way) / 2;
  for (let i = 1; i < way.points.length; i += 1) {
    const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
    const [bx, by] = xy(way.points[i][0], way.points[i][1]);
    addCarriagewaySegment(ax, -ay, bx, -by, half);
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
function offsetWay(points, metres) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const [bx, by] = xy(before[0], before[1]);
    const [ax, ay] = xy(after[0], after[1]);
    const dx = ax - bx;
    const dy = ay - by;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    out.push([points[i][0] + (nx * metres) / metersPerLon,
              points[i][1] + (ny * metres) / metersPerLat]);
  }
  return out;
}
let sides = 0;
let sidesBare = 0;
const bareExamples = [];
for (const way of DATA.ways) {
  if (way.kind !== "street" || !way.points || way.points.length < 2) continue;
  if (wayLength(way.points) < 12) continue;
  const road = renderedRoadWidth(way);
  const walk = renderedWalkWidth(way, 4.0);
  const inner = road / 2;
  for (const side of walkSidesToDraw(way, way.points, inner)) {
    sides += 1;
    // The same width ladder the renderer walks: the inner edge stays on the kerb and the strip
    // narrows until it fits, so a side counts as bare only when even a quarter-width strip at
    // the kerb is inside somebody else's carriageway.
    let kept = 0;
    let asked = 0;
    for (const share of [1.0, 1.0, 0.72, 0.52, 0.36, 0.24]) {
      const width = Math.max(MIN_RENDER_WALK_M * 0.55, walk * share);
      const centre = offsetWay(way.points, side * (inner + width / 2));
      asked = wayLength(centre);
      const back = Math.min(Math.max(1.2, inner + width * 0.7), asked * 0.32);
      const runs = pavementRunsOutsideCarriageway(trimWay(centre, back), width);
      kept = runs.reduce((sum, run) => sum + wayLength(run), 0);
      if (kept >= asked * 0.55) break;
    }
    if (kept < asked * 0.25) {
      sidesBare += 1;
      if (bareExamples.length < 10) {
        bareExamples.push({ street: way.name || way.osm_id, side,
                            at: way.points[Math.floor(way.points.length / 2)] });
      }
    }
  }
}

console.log(JSON.stringify({
  kerbside: { sides, sidesWithoutPavement: sidesBare,
              share: +(sidesBare / sides).toFixed(3), examples: bareExamples },
  groundOnCarriageway: layers,
  fences: { runs: fenceRuns, crossingRoad: fenceOnRoad },
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
                              "GROUND_JSON": str(args.ground)})
    if out.returncode != 0:
        print(out.stderr, file=sys.stderr)
        return 1
    print(out.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
