"""Accepted engine interiors replace a house's fitted plan, and only accepted ones."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _engine():
    pytest.importorskip("shapely")
    spec = importlib.util.spec_from_file_location("run_interior_engine", ROOT / "scripts/run_interior_engine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _batch(folder: Path, houses: dict[str, dict]) -> None:
    folder.mkdir(parents=True)
    records, refs = [], {}
    for osm_id, house in houses.items():
        (folder / f"osm-{osm_id}.json").write_text(json.dumps(house))
        records.append({"id": f"osm-{osm_id}", "file": f"osm-{osm_id}.json", "passed": house["validation"]["passed"]})
        if house["validation"]["passed"]:
            refs[osm_id] = {"file": f"osm-{osm_id}.json", "origin_lon_lat": [-122.4, 37.8]}
    (folder / "manifest.json").write_text(json.dumps({"houses": records}))
    (folder / "map-overlay.json").write_text(json.dumps({"buildings": refs}))


def test_publishing_adds_accepted_houses_and_replaces_an_earlier_one(tmp_path) -> None:
    engine = _engine()
    site, out = tmp_path / "site", tmp_path / "build"
    site.mkdir()
    (site / "map-overlay.json").write_text(json.dumps({"buildings": {
        "1": {"file": "osm-1.json", "origin_lon_lat": [0, 0]}, "9": {"file": "osm-9.json", "origin_lon_lat": [0, 0]}}}))
    good = {"grade": "inferred", "validation": {"passed": True}}
    _batch(out / "sf-sunset/batch-000", {"1": {**good, "v": 2}, "2": good,
                                         "3": {"grade": "inferred", "validation": {"passed": False}}})
    assert engine.publish(out, site) == 2
    overlay = json.loads((site / "map-overlay.json").read_text())["buildings"]
    assert overlay["1"]["file"] == "houses/sf-sunset/osm-1.json"     # accepted again: the new one
    assert overlay["2"]["file"] == "houses/sf-sunset/osm-2.json"
    assert overlay["9"]["file"] == "osm-9.json"                      # not re-run: kept
    assert "3" not in overlay and not (site / "houses/sf-sunset/osm-3.json").exists()
    assert engine.publish(out, site) == 0                            # nothing new the second time


def test_the_map_furnishes_accepted_houses_by_default_except_in_the_headset() -> None:
    from tests.test_corridor_geometry_rules import _extract, _page_js
    gate = _extract("requestGeneratedInteriors", _page_js())
    assert 'if (HEADSET || new URLSearchParams(location.search).get("inferredInteriors") === "0") return;' in gate


def test_a_generated_interior_taken_down_can_be_requested_again() -> None:
    from tests.test_corridor_geometry_rules import _extract, _page_js
    request = _extract("requestGeneratedInterior", _page_js())
    assert "}).finally(() => {" in request and "entry.generatedInteriorPending = false;" in request
