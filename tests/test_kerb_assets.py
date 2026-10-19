"""Bus zones square to their street; parking meters and Muni's trolleybus wires on the streets."""

from __future__ import annotations

import json
import runpy
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_bus_zone_near_a_corner_runs_parallel_to_its_street_not_on_the_diagonal() -> None:
    js = _page_js()
    script = "\n".join([_extract("streetSquareKerb", js), """
    // A street along x (centreline z = 0, half-width 5). The stop is past the segment's end, so
    // the nearest centreline point is the end (10, 0) and the raw normal is the diagonal to (14, 4).
    const d = Math.hypot(4, 4), raw = { x: 10 + 4 / d * 5, z: 4 / d * 5, nx: 4 / d, nz: 4 / d, ax: 1, az: 0, half: 5 };
    const sq = streetSquareKerb(raw);
    console.log(JSON.stringify({ nx: +sq.nx.toFixed(6), nz: +sq.nz.toFixed(6), x: +sq.x.toFixed(6), z: +sq.z.toFixed(6),
      passthrough: streetSquareKerb(null) }));
    """])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert (r["nx"], r["nz"]) == (0, 1), "square to the street, on the stop's side"
    assert (r["x"], r["z"]) == (10, 5), "the kerb square off the centreline"
    assert r["passthrough"] is None
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "const kerb = streetSquareKerb(nearestKerbAt(x, z, 25));" in page
    assert ".map((run) => run.map(streetSquareKerb))" in page


def test_meter_spaces_become_posts_with_their_heads_and_pay_stations_with_their_spaces() -> None:
    m = runpy.run_path(str(ROOT / "scripts/ingest_kerb_assets.py"))
    row = lambda post, station="-", kind="SS", lon=-122.41, lat=37.79, cap="Grey": {  # noqa: E731
        "post_id": post, "ms_pay_station_id": station, "meter_type": kind, "cap_color": cap,
        "street_name": "KEARNY ST", "street_num": "900", "longitude": str(lon), "latitude": str(lat)}
    out = m["meters_from_rows"]([row("1"), row("1"), row("2", cap="Yellow"),
                                 row("3", "PS-9", "MS", lon=-122.4100), row("4", "PS-9", "MS", lon=-122.4102),
                                 row("5", "PS-9", "MS", lon=-122.4104), {"post_id": "bad"}])
    singles = {r["id"]: r for r in out if r["meter_type"] == "single_space"}
    stations = [r for r in out if r["meter_type"] == "pay_station"]
    assert singles["sfmta:parking_meter:1"]["heads"] == 2 and singles["sfmta:parking_meter:2"]["cap_color"] == "yellow"
    assert len(stations) == 1 and stations[0]["spaces"] == 3 and stations[0]["p"][0] == -122.4102, "in the middle"
    assert all(r["provenance"] == "official_meter_inventory" for r in out)


def test_meters_and_trolley_wires_reach_the_streets() -> None:
    js = _page_js()
    assert "parking_meters: addParkingMeters((official.parking_meters || []).concat(inferred.parking_meters || [],\n      inferred.detected_parking_meters || []))" in js
    assert "trolley_wires: addTrolleyWires(inferred.trolley_wires || [], lights.rows)" in js
    spot = _extract("meterSpot", js)
    assert "streetSquareKerb(nearestKerbAt(x, -y, 8))" in spot and "!insideCarriageway(mx, mz, 0.05)" in spot
    wires = _extract("addTrolleyWires", js)
    # Span wires every TROLLEY.span metres along a line (trolleySpanStations places them).
    assert "trolleySpanStations(" in wires and "TROLLEY.span" in _extract("trolleySpanStations", js)
    furniture = json.loads((ROOT / "docs/sf-corridor-furniture.json").read_text())
    assert len(furniture["geometry_based"]["parking_meters"]) > 5000
    assert len(furniture["inferred"]["trolley_wires"]) > 300


def test_mapillary_poles_remain_without_inventing_wires_and_small_cells_stand_on_poles() -> None:
    js = _page_js()
    network = _extract("addElectricalNetwork", js)
    assert "(inferred.utility_poles || []).concat(inferred.detected_utility_poles || [])" in network
    # A pole detection alone cannot establish electrical connectivity.
    assert "pairs.push(" not in network and "inferred_pole_to_pole" not in network
    assert "filter(mappedOverheadLine)" in network and "small_cells" in network
    furniture = json.loads((ROOT / "docs/sf-corridor-furniture.json").read_text())
    # Every detection is kept; only the ones on a line are drawn as utility poles (ingest_streetlights).
    inferred = furniture["inferred"]
    assert len(inferred["detected_utility_poles"]) + len(inferred["detected_poles_unattributed"]) > 5000
    assert len(inferred["detected_utility_poles"]) > 2000
    assert len(furniture["geometry_based"]["small_cells"]) > 100
    ids = {s.get("id") for s in furniture["sources"]}
    assert {"mapillary_map_features", "sfdpw_wireless_permits"} <= ids


def test_mapillary_poles_near_a_trolley_wire_are_muni_s_and_left_out() -> None:
    m = runpy.run_path(str(ROOT / "scripts/ingest_kerb_assets.py"))
    wire = {"points": [[-122.4200, 37.7600], [-122.4100, 37.7600]]}
    poles = [{"p": [-122.4150, 37.76004]}, {"p": [-122.4150, 37.7610]}]
    assert m["off_trolley_lines"](poles, [wire]) == [poles[1]], "4 m off the wire is Muni's; 110 m is not"
    assert m["dedupe"]([{"p": [-122.4, 37.7]}, {"p": [-122.41, 37.7]}], [{"p": [-122.40003, 37.70002]}], 7.0) \
        == [{"p": [-122.41, 37.7]}]


def test_pins_drop_and_return_and_typing_is_never_a_pin() -> None:
    js = _page_js()
    pins = js[js.index("// ---- pins: 1, 2 and 3"):js.index("// ---- the compass")]
    assert "const PIN_COUNT = 3;" in pins
    assert "if (typingIn(e.target) || typingIn(document.activeElement)) return;" in pins
    assert "if (pins[i] && !e.shiftKey)" in pins and "goTo(landing, { travel: true, zoom: true });" in pins
    assert "groundAt(pointerAt[0], pointerAt[1])" in pins
    page = (ROOT / "docs/app-model.html").read_text()
    assert 'id="controls-help"' in page and "<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>" in page
    assert 'id="pins-clear"' in page


def test_oakland_poles_are_posts_and_its_ms1_meters_are_pay_stations() -> None:
    ingest = runpy.run_path(str(ROOT / "scripts/ingest_kerb_assets.py"))
    rows = [{"pole": "15-622", "meter_type": "MK5", "pole_statu": "Active", "longitude": "-122.275174",
             "latitude": "37.806816", "sub_area": "15th St", "config__na": "$2.00 per hr 2 Hour"},
            {"pole": "14-PS1", "meter_type": "MS1", "pole_statu": "Active", "longitude": "-122.27",
             "latitude": "37.80", "street_add": "Broadway"},
            {"pole": "9-101", "meter_type": "MK5", "pole_statu": "Bagged", "longitude": "-122.27", "latitude": "37.79"},
            {"pole": "9-102", "meter_type": "MS1", "pole_statu": "Temporarily removed",
             "longitude": "-122.27", "latitude": "37.79"}]
    meters = ingest["oakland_meters"](rows)
    assert [(m["id"], m["meter_type"]) for m in meters] == [
        ("oakland:parking_meter:15-622", "single_space"), ("oakland:pay_station:14-PS1", "pay_station"),
        ("oakland:parking_meter:9-101", "single_space")]
    assert meters[0]["p"] == [-122.275174, 37.806816] and meters[0]["rate"].startswith("$2.00")
    assert meters[0]["provenance"] == "official_meter_inventory"
