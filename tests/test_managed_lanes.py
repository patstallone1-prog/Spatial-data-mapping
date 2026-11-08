"""Carpool and express lanes from OpenStreetMap (smc.highways.lanes, scripts/build_managed_lanes.py)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from smc.highways.lanes import lane_from_way, lane_kind, managed_lane_indices, parse_hours, simplify

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_managed_lanes.py"

I80 = {"type": "way", "id": 4598065, "geometry": [{"lat": 37.9920521, "lon": -122.3075032}, {"lat": 37.9923736, "lon": -122.3066053},
       {"lat": 37.9926382, "lon": -122.3056903}, {"lat": 37.9932684, "lon": -122.3021273}],
       "tags": {"highway": "motorway", "hov:lanes": "designated|||", "lanes": "4", "name": "Eastshore Freeway", "oneway": "yes", "ref": "I 80",
                "hov:conditional": "designated @ (Mo-Fr 05:00-10:00, 15:00-19:00)"}}
CA85 = {"type": "way", "id": 4629955, "geometry": [{"lat": 37.3908288, "lon": -122.0686769}, {"lat": 37.3878941, "lon": -122.068844}],
        "tags": {"highway": "motorway", "hov:lanes": "designated||", "lanes": "3", "oneway": "yes", "ref": "CA 85", "toll:hov": "no"}}


def test_hours_lanes_and_kinds() -> None:
    hours, weekdays = parse_hours("designated @ (Mo-Fr 05:00-10:00, 15:00-19:00)")
    assert hours == [[5, 10], [15, 19]] and weekdays
    assert parse_hours(None) == (None, False)
    assert managed_lane_indices({"hov:lanes": "designated|||"}) == [0]
    assert lane_kind({"toll:hov": "no"}) == "express"
    assert lane_kind({"name": "San Tomas Expressway"}) == "hov", "an expressway is a road, not an express lane"
    assert len(simplify([(-122.0, 37.0), (-122.00001, 37.00001), (-122.0, 37.01)])) == 2
    lane = lane_from_way(I80)
    assert lane.kind == "hov" and lane.lanes == 4 and lane.managed == [0] and lane.minimum == 2 and lane.weekdays_only
    assert lane_from_way({**I80, "tags": {**I80["tags"], "highway": "residential"}}) is None


def test_the_script_builds_the_lanes_file(tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("build_managed_lanes", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cache = tmp_path / "overpass.json"
    cache.write_text(json.dumps({"elements": [I80, CA85, I80]}))
    out = tmp_path / "lanes.json"
    assert module.main(["--cache", str(cache), "--out", str(out)]) == 0
    payload = json.loads(out.read_text())
    assert payload["schema"] == "kerbside.managed_lanes/1"
    assert payload["counts"] == {"hov": 1, "express": 1}
    assert {lane["id"] for lane in payload["lanes"]} == {"way/4598065", "way/4629955"}


def test_the_published_lanes_file() -> None:
    payload = json.loads((ROOT / "docs" / "managed-lanes.json").read_text())
    assert payload["counts"]["hov"] > 1000 and payload["counts"]["express"] > 100
