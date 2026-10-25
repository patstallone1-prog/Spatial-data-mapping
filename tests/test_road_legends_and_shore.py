"""STOP before the crosswalk, floodlights off the courts, and the estuary drawn as water."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")


def _node(parts: list[str]) -> dict:
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@needs_node
def test_the_crosswalk_an_approach_stops_behind_is_a_painted_one_across_it() -> None:
    js = _page_js()
    result = _node([
        "const CROSSING_DEDUPE_CELL_M = 4; const crossingDrawGrid = new Map();",
        "const add = (pose) => { const k = `${Math.floor(pose.x / 4)}:${Math.floor(pose.z / 4)}`;"
        " if (!crossingDrawGrid.has(k)) crossingDrawGrid.set(k, []); crossingDrawGrid.get(k).push(pose); };",
        _extract("crossingBearingDifference", js),
        _extract("approachCrosswalk", js),
        # An approach from the east (u points east, out of the junction), 5 m to the kerb.
        "const a = { jx: 0, jz: 0, ux: 1, uz: 0, half: 5 };",
        "const none = approachCrosswalk(a);",
        # Unmarked, and one running along the street: neither is a crosswalk to stop behind.
        "add({ x: 8, z: 0, bearing: Math.PI / 2, length: 10, width: 3, tag: 'unmarked' });",
        "add({ x: 12, z: 0, bearing: 0, length: 10, width: 3 });",
        "const ignored = approachCrosswalk(a);",
        "add({ x: 9, z: 0.5, bearing: Math.PI / 2, length: 10, width: 3.7 });",
        "add({ x: 30, z: 0, bearing: Math.PI / 2, length: 10, width: 3 });",
        "console.log(JSON.stringify({ none, ignored, found: approachCrosswalk(a) }));",
    ])
    assert result["none"] is None and result["ignored"] is None
    assert result["found"] == {"along": 9, "width": 3.7}


def test_stop_and_signal_approaches_get_their_paint_after_the_furniture() -> None:
    js = _page_js()
    paint = _extract("paintRoadLegends", js)
    # The bar behind the crosswalk's near line; STOP behind the bar, on stop approaches only.
    assert "crosswalk.along + crosswalk.width / 2 + ROAD_LEGEND.barBehindCrossing" in paint
    assert 'if (a.kind !== "stop") continue;' in paint
    assert "groundLiftAt(x, z) + ROAD_TOP_M + lift" in paint and "/ 0.5" in paint
    assert 'noteLegendApproach(junction, leg, "stop")' in _extract("expandApproachSigns", js)
    assert 'noteLegendApproach(junction, leg, "signal")' in _extract("expandSignalApproaches", js)
    furniture = _extract("renderStreetFurniture", js)
    assert "noteOfficialStopApproach(x, z)" in furniture and "road_legends: paintRoadLegends()" in furniture
    assert '"furniture:road_legend": 600' in js
    # Unmarked crossings are kept in the crossing index, tagged.
    assert 'shouldDrawCrossing(surfacePoints, widthMeters, surfaceKind ? null : "unmarked")' in js


@needs_node
def test_a_window_cuts_the_landscape_only_over_its_own_terrain() -> None:
    js = _page_js()
    result = _node([
        "const midLon = -122.27, midLat = 37.80, metersPerLon = 88000, metersPerLat = 111320;",
        "const TERRAIN_MESH_STRIDE = 2;",
        "const TERRAIN_FRAME = { mid_lon: -122.27, mid_lat: 37.80, metres_per_lon: 88000, metres_per_lat: 111320,"
        " x0: -100, y0: -100, step_m: 2, cols: 101, rows: 101 };",
        _extract("terrainToPage", js),
        _extract("terrainPageRect", js),
        _extract("clipToTerrain", js),
        "console.log(JSON.stringify({ rect: terrainPageRect().map(Math.round),"
        " clipped: clipToTerrain([-300, -50, 50, 400]).map(Math.round) }));",
    ])
    assert result["rect"] == [-99, -101, 101, 99]
    # Past the terrain's south and west edges the landscape (and its water) is left alone.
    assert result["clipped"] == [-99, -50, 50, 99]
    page = js
    assert "groundBoxes:BUILD_WINDOW ? BUILD_WINDOW.boxes.map((b)=>{const a=xy(b[0],b[1]),c=xy(b[2],b[3]);" \
        "return clipToTerrain([a[0],-c[1],c[0],-a[1]]);})" in page
    assert "new THREE.Vector4(...clipToTerrain([b.x,b.y,b.z,b.w]))" in page


def test_water_comes_out_of_the_inferred_ground_and_parcel_plazas() -> None:
    sys.path.insert(0, str(ROOT / "tools"))
    import strip_ground_water
    from shapely.geometry import box

    frame = {"metres_per_lon": 88000.0, "metres_per_lat": 111320.0}
    water = box(0.0, 0.0, 0.001, 0.001)
    lawn = [[-0.0005, 0.0002], [0.0005, 0.0002], [0.0005, 0.0004], [-0.0005, 0.0004], [-0.0005, 0.0002]]
    # A plaza with the water in its middle: the cut leaves a hole, split into rings without one.
    plaza = [[-0.002, -0.002], [0.003, -0.002], [0.003, 0.003], [-0.002, 0.003], [-0.002, -0.002]]
    dry = [[0.002, 0.002], [0.0025, 0.002], [0.0025, 0.0025], [0.002, 0.002]]
    ground = {"inferred": [{"k": "grass", "p": lawn}, {"k": "paving", "p": dry}],
              "plazas": [{"id": "p1", "p": plaza}], "parks": [{"p": lawn}]}
    report = strip_ground_water.strip(ground, water, frame)
    assert report["inferred"]["touched"] == 1 and report["plazas"]["touched"] == 1
    from shapely.geometry import Polygon
    for row in ground["inferred"] + ground["plazas"]:
        assert Polygon(row["p"]).intersection(water).area < 1e-12
    assert ground["inferred"][0]["k"] == "grass" and Polygon(ground["inferred"][0]["p"]).bounds[2] <= 0.0
    assert {r["id"].split("~")[0] for r in ground["plazas"]} == {"p1"} and len(ground["plazas"]) >= 2
    assert ground["parks"] == [{"p": lawn}]                     # mapped parks are left alone
    # Future gap fills take the water out as they are written.
    assert "strip_ground_water.strip(ground, water, water_frame)" in (ROOT / "tools/infer_ground_gaps.py").read_text()


@needs_node
def test_a_floodlight_mapped_on_a_court_stands_just_off_it_aimed_at_it() -> None:
    js = _page_js()
    result = _node([
        "const COURT_LIGHT_OUT_M = 0.8;",
        _extract("pointInRing", js),
        "function distanceToSegmentSquared(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az;"
        " const L = dx * dx + dz * dz; const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;"
        " const x = ax + dx * t - px, z = az + dz * t - pz; return x * x + z * z; }",
        _extract("courtLightSpot", js),
        "const pad = { local: [[0, 0], [20, 0], [20, 10], [0, 10], [0, 0]], cx: 10, cz: 5 };",
        "console.log(JSON.stringify({ inside: courtLightSpot(18, 5, [pad]), beside: courtLightSpot(25, 5, [pad]),"
        " far: courtLightSpot(200, 5, [pad]) }));",
    ])
    inside = result["inside"]
    assert abs(inside["x"] - 20.8) < 1e-9 and inside["z"] == 5 and inside["aim"] == [10, 5]
    assert result["beside"] == {"x": 25, "z": 5, "aim": [10, 5]}
    assert result["far"]["aim"] is None
