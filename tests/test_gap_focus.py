"""The focused gap runner: whole areas in the order named, and a failed street probe asked again."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("run_gap_focus", ROOT / "scripts/run_gap_focus.py")
focus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(focus)


def test_areas_come_whole_in_the_order_named_and_reverse_the_intake_inside():
    jobs = [{"name": f"{area}-p{i}"} for area in ("a-gap", "b-gap", "c-gap") for i in range(3)]
    cells = focus.focus_cells(jobs, ["c-gap", "a-gap"])
    assert cells == ["c-gap-p2", "c-gap-p1", "c-gap-p0", "a-gap-p2", "a-gap-p1", "a-gap-p0"]


def test_missing_street_probe_is_asked_again_and_a_present_one_left(tmp_path, monkeypatch):
    monkeypatch.setattr(focus, "ROOT", tmp_path)
    cell = "sf-south-gap-p3-0-0"
    folder = tmp_path / "data/regions" / cell
    folder.mkdir(parents=True)
    path = folder / "capabilities.json"
    path.write_text(json.dumps({"osm": {}, "errors": {"osm": "HTTP Error 502"}}))
    assert focus.refresh_osm_probe(cell, counts=lambda bbox: {"highway_ways": 40, "buildings": 600})
    caps = json.loads(path.read_text())
    assert caps["osm"] == {"highway_ways": 40, "buildings": 600} and "osm" not in caps["errors"]

    def fail(bbox):
        raise AssertionError("a present probe is not asked again")

    assert focus.refresh_osm_probe(cell, counts=fail)


def test_a_probe_that_fails_again_leaves_the_file_alone(tmp_path, monkeypatch):
    monkeypatch.setattr(focus, "ROOT", tmp_path)
    cell = "sf-south-gap-p3-0-0"
    folder = tmp_path / "data/regions" / cell
    folder.mkdir(parents=True)
    (folder / "capabilities.json").write_text(json.dumps({"osm": {}}))

    def bad(bbox):
        raise OSError("502")

    assert not focus.refresh_osm_probe(cell, counts=bad)
    assert json.loads((folder / "capabilities.json").read_text()) == {"osm": {}}


def test_a_stage_failing_three_times_rests_then_is_tried_again():
    now = 10_000_000.0
    assert not focus.resting({"failures": 2, "at": now}, now)
    assert focus.resting({"failures": 3, "at": now - 60}, now)
    assert not focus.resting({"failures": 3, "at": now - focus.REST_S - 1}, now)
