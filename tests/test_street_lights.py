"""San Francisco's streetlights as their pole types are built, and the small cells on them.

The SFPUC's layer gives each light's pole type; its Streetlight Catalog gives what that type is:
a 28.5 ft steel pole with a 6 ft mast arm and a cobra head, a 29 ft fluted pole with an acorn
pendant, a 16 ft pedestrian post top. The page draws each so, the arm sweeping up and out over
the road, and the carriers' small cells sit on top of those poles rather than on poles of their own.
"""

from __future__ import annotations

import json
import runpy
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
INGEST = runpy.run_path(str(ROOT / "scripts/ingest_streetlights.py"))


def _row(kind: str, lon: float = -122.42, lat: float = 37.76, **extra) -> dict:
    return {"assetnum": "1", "pole_type": kind, "material": "STEEL", "status": "ACTIVE", "lon": lon, "lat": lat, **extra}


def test_each_pole_type_has_its_catalog_form_and_height() -> None:
    rows = [_row("SL-StdSteel"), _row("SL-FluteSteel"), _row("SL-LPoulsen14"), _row("SL-RndConc"),
            _row("SL-Wall"), _row("SL-Ceiling"), _row("TS-StdSteel"), _row("SL-StdSteel", status="REMOVED")]
    lights = INGEST["records"](rows)
    assert [x["pole_type"] for x in lights] == ["SL-StdSteel", "SL-FluteSteel", "SL-LPoulsen14", "SL-RndConc"]
    steel, fluted, poulsen, concrete = lights
    assert (steel["form"], steel["height_m"], steel["arm_m"], steel["luminaire"]) == ("mast_arm", 8.69, 1.83, "cobra_head")
    assert (fluted["form"], fluted["height_m"], fluted["arm_m"]) == ("pendant", 8.84, 2.13)
    assert (poulsen["form"], poulsen["height_m"], poulsen["arm_m"]) == ("post_top", 4.27, 0)
    assert concrete["finish"] == "concrete" and concrete["height_m"] == 8.53
    assert all(x["height_m"] < 10 for x in lights), "no streetlight is a 10.5 m utility pole"


def test_a_mapillary_pole_on_a_streetlight_is_that_streetlight() -> None:
    lights = [{"p": [-122.42, 37.76]}]
    poles = [{"id": "near", "p": [-122.42003, 37.76002]}, {"id": "far", "p": [-122.4209, 37.76]}]
    assert [p["id"] for p in INGEST["off_streetlights"](poles, lights)] == ["far"]


def test_the_published_furniture_has_the_citys_streetlights() -> None:
    furniture = json.loads((ROOT / "docs/regions/sf-mission/sf-corridor-furniture.json").read_text())
    lights = furniture["geometry_based"]["street_lights"]
    assert len(lights) > 1000
    assert {x["form"] for x in lights} >= {"mast_arm", "pendant", "post_top"}
    assert any(s.get("id") == "sfpuc_streetlights" for s in furniture["sources"])


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_arm_sweeps_up_and_out_over_the_road_to_a_cobra_head() -> None:
    script = _extract("streetLightParts", _page_js()) + """
console.log(JSON.stringify({
  arm: streetLightParts("mast_arm", 8.69, 1.83),
  pendant: streetLightParts("pendant", 8.84, 2.13),
  post: streetLightParts("post_top", 4.88, 0),
}));
"""
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    parts = json.loads(out.stdout)
    arm = parts["arm"]
    assert arm["shaft"] < 8.69 and len(arm["rods"]) == 2 and len(arm["heads"]) == 1
    start, knee, end = arm["rods"][0]["a"], arm["rods"][0]["b"], arm["rods"][1]["b"]
    assert start[2] == 0 and knee[2] > 0 and end[2] == pytest.approx(1.83), "out over the road"
    assert start[1] < knee[1] < end[1] == pytest.approx(8.69), "rising to the head"
    assert arm["heads"][0]["at"][2] > end[2] and not arm["globes"], "a cobra head, not a bare bulb"
    pendant = parts["pendant"]
    assert pendant["globes"][0]["at"][2] == pytest.approx(2.13) and pendant["globes"][0]["at"][1] < 8.84
    post = parts["post"]
    assert not post["rods"] and post["globes"][0]["at"][2] == 0 and post["globes"][0]["at"][1] < 4.88


def test_small_cells_ride_the_streetlights_and_span_wires_hang_from_trolley_poles() -> None:
    js = _page_js()
    network = _extract("addElectricalNetwork", js)
    assert "for (const poles of [hostPoles, poleRows])" in network
    assert 'row.form === "mast_arm" || row.form === "pendant"' in network
    furniture = _extract("renderStreetFurniture", js)
    assert "addElectricalNetwork(furniture, lights.rows)" in furniture
    assert "addTrolleyWires(inferred.trolley_wires || [], lights.rows)" in furniture
    assert 'startsWith("TP-")' in _extract("addTrolleyWires", js)


def test_one_pole_is_drawn_per_pole_and_wires_meet_their_poles() -> None:
    mapped = [{"id": "osm:utility_pole:node:1", "p": [-122.42, 37.76]}]
    detected = [{"id": "mapillary:utility_pole:2", "p": [-122.42002, 37.76001]},   # 2 m off: the same pole
                {"id": "mapillary:utility_pole:3", "p": [-122.4204, 37.76]},       # 35 m on: the next one
                {"id": "mapillary:utility_pole:4", "p": [-122.42041, 37.76002]}]   # 2 m off that
    osm, seen = INGEST["one_per_pole"]([dict(p) for p in mapped], [dict(p) for p in detected])
    assert [p["id"] for p in osm] == ["osm:utility_pole:node:1"], "a mapped pole anchors its cluster"
    assert len(seen) == 1 and seen[0]["merged_detections"]
    # A wire's end is the detection that stays.
    _, seen = INGEST["one_per_pole"]([], [dict(p) for p in detected[1:]], frozenset({"mapillary:utility_pole:4"}))
    assert [p["id"] for p in seen] == ["mapillary:utility_pole:4"]
    # And a pole a wire ends on is never taken for the streetlight beside it.
    lights = [{"p": [-122.42041, 37.76002]}]
    assert INGEST["off_streetlights"](detected[2:], lights, frozenset({"mapillary:utility_pole:4"})) == [detected[2]]


def test_the_published_poles_are_one_per_pole() -> None:
    import math
    inferred = json.loads((ROOT / "docs/regions/sf-mission/sf-corridor-furniture.json").read_text())["inferred"]
    poles = [p["p"] for p in inferred["utility_poles"] + inferred["detected_utility_poles"]]
    k = math.cos(math.radians(37.76)) * 111_320
    close = sum(1 for i, a in enumerate(poles) for b in poles[i + 1:]
                if abs(a[0] - b[0]) < 1e-4 and math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * 110_540) < 3)
    assert close <= len(poles) * 0.01, close


def test_trolley_span_poles_are_shared_between_ways() -> None:
    wires = _extract("addTrolleyWires", _page_js())
    assert "const shared = standingSpanPole(qx, qz);" in wires
    assert "const TROLLEY_POLE_SHARE_M = 6;" in _page_js()
