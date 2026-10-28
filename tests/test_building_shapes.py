"""Buildings in parts: setbacks, overhangs, courtyards and roofs, from OpenStreetMap's 3D tags."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "tests"))

import fetch_building_shapes as shapes  # noqa: E402
from test_corridor_geometry_rules import _extract, _page_js  # noqa: E402

NODE = shutil.which("node")
THREE = ROOT / "tools/unreal/node_modules/three/build/three.module.js"


def _square(x0: float, y0: float, d: float) -> list[list[float]]:
    return [[x0, y0], [x0 + d, y0], [x0 + d, y0 + d], [x0, y0 + d], [x0, y0]]


def _geom(points: list[list[float]]) -> list[dict[str, float]]:
    return [{"lon": x, "lat": y} for x, y in points]


def test_heights_read_metres_feet_and_storeys() -> None:
    assert shapes.metres("45") == 45 and shapes.metres("12.5 m") == 12.5 and shapes.metres("100 ft") == 30.48
    assert shapes.metres("tall") is None
    v = shapes.vertical({"building:levels": "10", "building:min_level": "2", "roof:shape": "pyramidal"})
    assert v == {"roof": "pyramidal", "height_m": 30.0, "min_height_m": 6.0}
    assert shapes.vertical({"roof:shape": "wavy", "height": "9"})["roof"] == "flat"


def test_split_multipolygon_members_are_stitched_into_rings() -> None:
    a, b = [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1]]
    rings = shapes.join_rings([a, b])
    assert len(rings) == 1 and rings[0][0] == rings[0][-1] and len(rings[0]) == 5


def test_parts_find_their_outline_and_missing_multipolygons_are_added() -> None:
    outline = {"kind": "building", "osm_id": 7, "points": _square(0, 0, 0.001), "height_m": 20}
    part_low = {"type": "way", "id": 1, "tags": {"building:part": "yes", "height": "12"},
                "geometry": _geom(_square(0, 0, 0.001))}
    part_tower = {"type": "way", "id": 2, "tags": {"building:part": "yes", "height": "80", "min_height": "12",
                                                     "roof:shape": "pyramidal", "roof:height": "10"},
                  "geometry": _geom(_square(0.0003, 0.0003, 0.0004))}
    hotel = {"type": "relation", "id": 99, "tags": {"type": "multipolygon", "building": "hotel", "name": "Palace",
                                                     "height": "37"},
             "members": [{"type": "way", "role": "outer", "geometry": _geom(_square(0.01, 0.01, 0.002))},
                         {"type": "way", "role": "inner", "geometry": _geom(_square(0.0108, 0.0108, 0.0004))}]}
    result = shapes.build([part_low, part_tower, hotel], [outline], {"west": 0, "south": 0, "east": 1, "north": 1})
    entry = result["buildings"]["7"]
    assert [p["osm"] for p in entry["parts"]] == ["w1", "w2"]
    assert entry["parts"][1] == {**entry["parts"][1], "min_height_m": 12, "height_m": 80, "roof": "pyramidal"}
    [extra] = result["extra"]
    assert extra["osm_id"] == -99 and extra["osm_ref"] == "relation/99" and extra["height_m"] == 37
    assert extra["archetype"] == "hotel" and extra["covered"] is True
    assert len(result["buildings"]["-99"]["holes"]) == 1, "the light well is kept as a courtyard"


def _run_shape(spec: dict, height: float = 20) -> dict:
    js = _page_js()
    script = "\n".join([
        f"import * as THREE from {json.dumps(THREE.as_uri())};",
        "const BAY_M=4.0, STOREY_M=3.2, midLon=0, midLat=0, metersPerLon=1, metersPerLat=1;",
        "function xy(lon, lat) { return [(lon - midLon) * metersPerLon, (lat - midLat) * metersPerLat]; }",
        _extract("facadeStoreyMetres", js),
        "const ROOF_DEFAULT_PITCH = 0.35;",
        _extract("compassBearing", js), _extract("shapedBuildingGeometry", js),
        f"const feature = {json.dumps(spec)};",
        f"const out = shapedBuildingGeometry(feature, {height});",
        "const pos = out.geometry.getAttribute('position'), n = out.geometry.getAttribute('normal');",
        "const [caps, walls] = out.geometry.groups;",
        "let lowCap = Infinity, upWrong = 0, downCaps = 0;",
        "for (let i = caps.start; i < caps.start + caps.count; i++) {",
        "  if (n.getY(i) < -0.5) downCaps++; else if (n.getY(i) < 0) upWrong++; lowCap = Math.min(lowCap, pos.getY(i)); }",
        "let outward = 0, inward = 0;",
        "for (let i = walls.start; i < walls.start + walls.count; i += 3) {",
        "  const cx = (pos.getX(i)+pos.getX(i+1)+pos.getX(i+2))/3, cz = (pos.getZ(i)+pos.getZ(i+1)+pos.getZ(i+2))/3;",
        "  const d = (cx - 10) * n.getX(i) + (cz + 10) * n.getZ(i); if (d > 0) outward++; else inward++; }",
        "out.geometry.computeBoundingBox();",
        "console.log(JSON.stringify({top: out.top, max: out.geometry.boundingBox.max.y, min: out.geometry.boundingBox.min.y,",
        "  lowCap, upWrong, downCaps, outward, inward, caps: caps.count, walls: walls.count}));",
    ])
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


needs_three = pytest.mark.skipif(NODE is None or not THREE.exists(), reason="node and tools/unreal three.js needed")
SQUARE = [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]


@needs_three
def test_a_pyramid_rises_to_its_apex_even_when_its_height_tag_is_short() -> None:
    # The Transamerica Pyramid's spire: min_height 30, height 60, a 230 m pyramidal roof.
    r = _run_shape({"points": SQUARE, "shape": {"parts": [
        {"outer": SQUARE, "height_m": 30, "roof": "flat"},
        {"outer": SQUARE, "min_height_m": 30, "height_m": 60, "roof": "pyramidal", "roof_height_m": 230}]}})
    assert r["top"] == 260 and r["max"] == pytest.approx(260)
    assert r["upWrong"] == 0 and r["inward"] == 0


@needs_three
def test_an_overhang_has_a_soffit_and_nothing_under_it() -> None:
    r = _run_shape({"points": SQUARE, "shape": {"parts": [
        {"outer": [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]], "min_height_m": 8, "height_m": 30, "roof": "flat"}]}})
    assert r["min"] == pytest.approx(8), "the cut-out under the overhang is open"
    assert r["downCaps"] > 0 and r["lowCap"] == pytest.approx(8)


@needs_three
def test_a_courtyard_is_a_hole_with_walls_facing_into_it() -> None:
    hole = [[8, 8], [12, 8], [12, 12], [8, 12], [8, 8]]
    r = _run_shape({"points": SQUARE, "shape": {"parts": [], "holes": [hole], "self": {"roof": "flat"}}}, height=15)
    assert r["top"] == 15
    # Four outer walls face out from the middle; the four courtyard walls face in towards it.
    assert r["outward"] == 8 and r["inward"] == 8


@needs_three
@pytest.mark.parametrize("roof", ["gabled", "hipped", "dome", "skillion"])
def test_every_roof_shape_closes_at_the_part_top(roof: str) -> None:
    r = _run_shape({"points": SQUARE, "shape": {"parts": [], "self": {"roof": roof, "roof_height_m": 6}}}, height=20)
    assert r["top"] == 20 and r["max"] == pytest.approx(20)
    assert r["upWrong"] == 0 and r["inward"] == 0


def test_the_page_draws_a_shaped_building_from_its_parts() -> None:
    js = _page_js()
    assert 'fetch(asset("sf-corridor-building-shapes.json")' in js
    body = _extract("buildingMesh", js)
    assert "shapedBuildingGeometry(feature, height)" in body and "if (!shaped) addRoofFurniture" in body
