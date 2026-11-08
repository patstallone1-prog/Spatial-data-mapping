"""The counties' and towns' outlines (scripts/build_jurisdictions.py) and what the city reads from them."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _builder():
    spec = importlib.util.spec_from_file_location("build_jurisdictions", ROOT / "scripts/build_jurisdictions.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_town_is_put_in_the_county_that_holds_it_and_san_francisco_is_its_own_county():
    build = _builder()
    square = lambda x0, y0, x1, y1: [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]  # noqa: E731
    data = build.assemble([
        {"level": 6, "name": "Marin County", "box": [0, 0, 10, 10], "rings": [square(0, 0, 10, 10)]},
        {"level": 6, "name": "San Francisco", "box": [0, -10, 10, 0], "rings": [square(0, -10, 10, 0)]},
        {"level": 8, "name": "Mill Valley", "box": [2, 2, 4, 4], "rings": [square(2, 2, 4, 4)]},
    ])
    assert [c["id"] for c in data["counties"]] == ["county:marin", "county:san-francisco"]
    assert data["cities"] == [{"id": "city:mill-valley", "name": "Mill Valley", "county": "county:marin", "box": [2, 2, 4, 4], "rings": [square(2, 2, 4, 4)]}]


def test_simplify_keeps_the_corners_and_drops_the_points_on_a_line():
    build = _builder()
    ring = [(0, 0), (0.5, 0.00001), (1, 0), (1, 1), (0, 1), (0, 0)]
    assert build.simplify(ring, 0.0003) == [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]


def test_the_published_outlines_cover_the_bay_and_carry_the_licence():
    data = json.loads((ROOT / "docs/city/jurisdictions.json").read_text())
    assert data["license"] == "ODbL-1.0"
    counties = {c["id"] for c in data["counties"]}
    assert {"county:san-francisco", "county:marin", "county:alameda", "county:san-mateo", "county:santa-clara", "county:contra-costa"} <= counties
    towns = {c["name"]: c["county"] for c in data["cities"]}
    assert towns["Mill Valley"] == "county:marin" and towns["Oakland"] == "county:alameda" and towns["Sausalito"] == "county:marin"
