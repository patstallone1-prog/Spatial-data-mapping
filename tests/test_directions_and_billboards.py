"""Directions from Valhalla, drawn on the ground; the billboards wear the project's own artwork."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_route_request_and_its_answer_are_read_as_valhalla_means_them() -> None:
    js = _page_js()
    script = "\n".join([
        'const ROUTE_COSTING = { walk: "pedestrian", bike: "bicycle", drive: "auto" };',
        _extract("decodePolyline6", js), _extract("routeRequest", js), _extract("summarizeTrip", js),
        """
        // Google's documented example, at six decimals: three points.
        const line = decodePolyline6("_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI");
        const walk = routeRequest([{ lat: 37.76, lon: -122.41 }, { lat: 37.77, lon: -122.42 }], "walk",
          { fewerHills: true, avoidStairs: true });
        const drive = routeRequest([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: 5, lon: 6 }], "drive");
        const trip = summarizeTrip({ summary: { time: 600, length: 1.2 }, legs: [
          { shape: "_izlhA~rlgdF", elevation: [10, 12, 11, 15], maneuvers: [{ instruction: "Walk north." }] }] });
        console.log(JSON.stringify({ line, walk, drive, trip }));
        """,
    ])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["line"] == [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]
    assert r["walk"]["costing"] == "pedestrian" and r["walk"]["alternates"] == 2
    assert r["walk"]["costing_options"]["pedestrian"] == {"use_hills": 0.1, "step_penalty": 100000}
    assert r["drive"]["costing"] == "auto" and r["drive"]["alternates"] == 0, "stops keep their order"
    assert [p["type"] for p in r["drive"]["locations"]] == ["break"] * 3
    assert (r["trip"]["seconds"], r["trip"]["ascent"], r["trip"]["descent"]) == (600, 6, 1)
    assert r["trip"]["steps"] == ["Walk north."]


def test_directions_never_follow_what_the_page_draws_and_say_where_they_come_from() -> None:
    js = _page_js()
    assert 'const ROUTING_URL = (document.querySelector(\'meta[name="kerbside-routing"]\')?.content' in js
    assert '"https://valhalla1.openstreetmap.de"' in js
    ribbon = _extract("routeRibbon", js)
    assert "walkerGroundAt(x, z) + ROUTE_LIFT_M" in ribbon and "inside(line[i])" in ribbon
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "OpenStreetMap contributors" in page and "the stops you enter are sent to that server" in page


def test_the_billboards_wear_the_three_artworks_and_only_dylumio_links_out() -> None:
    creatives = json.loads((ROOT / "docs/billboard-creatives.json").read_text())["boards"]
    images = {c["image"] for c in creatives.values()}
    assert images == {"billboards/animal-brawl.webp", "billboards/sim-trust-every-pixel.webp", "billboards/dylumio.webp"}
    for c in creatives.values():
        assert c["approved"] and c["sha256"] and (ROOT / "docs" / c["image"]).is_file()
        assert c.get("href") == ("https://dylumio.com" if c["image"].endswith("dylumio.webp") else None)
    js = _page_js()
    assert "const href=creative?.approved ? safeBillboardWebsite(creative.href || null)" in _extract("addBillboards", js)
