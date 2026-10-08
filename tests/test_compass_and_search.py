"""The compass, the cross streets that S names, and search by name across every region."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def test_s_names_the_cross_streets_either_side() -> None:
    js = _page_js()
    # An east-west street, Main, with corners at x = -100 (Oak) and +100 (Pine) and +300 (Elm);
    # a busway's corner at 0 that is never a cross street. Metres = degrees x 1000 here.
    script = "\n".join([
        "function xy(lon, lat) { return [lon * 1000, lat * 1000]; }",
        _extract("distanceToSegmentSquared", js),
        "const DATA = { ways: [{ kind: 'street', name: 'Main', points: [[-0.5, 0], [0.5, 0]] }],",
        "  intersections: [{ a: 'Main', b: 'Oak', lon: -0.1, lat: 0 }, { a: 'Pine', b: 'Main', lon: 0.1, lat: 0 },",
        "                  { a: 'Main', b: 'Elm', lon: 0.3, lat: 0 }, { a: 'Main', b: 'Bus Lane', lon: 0.0, lat: 0 }] };",
        "const BUSWAY_NAMES = new Set(['Bus Lane']);",
        "const AT_CORNER_M = 18;",
        _extract("crossStreetsAt", js),
        "console.log(JSON.stringify({ mid: crossStreetsAt(40, 0, 'Main'), corner: crossStreetsAt(98, 0, 'Main') }));",
    ])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    assert {result["mid"]["ahead"], result["mid"]["behind"]} == {"Pine", "Oak"}
    assert result["corner"]["at"] == "Pine" and set(result["corner"]["next"]) == {"Oak", "Elm"}


def test_the_compass_shows_the_way_the_walker_is_going() -> None:
    js = _page_js()
    assert 'compass.id = "compass";' in js and "updateCompass(now);" in _extract("animate", js)
    update = _extract("updateCompass", js)
    assert 'compassRose.setAttribute("transform", `rotate(${-view})`);' in update
    assert 'compassArrow.setAttribute("transform", `rotate(${going - view})`);' in update
    assert "avatar.userData.lastMove = [direction.x, direction.z, performance.now()];" in js
    # A guest region has no screen of its own to put one on.
    assert "const compass = ATTACH ? null :" in js


def test_search_finds_places_by_name_in_every_region() -> None:
    index = json.loads((ROOT / "docs/search-index.json").read_text())
    names = {row[0].split(" · ")[0] for row in index["places"]}
    assert "Transamerica Pyramid" in names and "Tartine Bakery" in names
    regions = {row[3] for row in index["places"]}
    assert len(regions) >= 6
    js = _page_js()
    assert "elsewhere.places = take(all.places || []);" in js
    assert "[places, corners, addresses, elsewhere.places, elsewhere.corners, elsewhere.addresses]" in js
    # A house number nobody mapped finds the nearest on that street, by the street's own name.
    assert "const street = entry.label.split(\" · \")[0].toLowerCase();" in js
