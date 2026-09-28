"""Regression gates for resumable regional lidar and published curb profiles."""

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from ingest_region import stage_outputs_ready
from measure_region_lidar import load_successful_cells, write_outputs


def test_failed_cells_remain_retryable(tmp_path):
    journal = tmp_path / "cells.jsonl"
    journal.write_text("\n".join(json.dumps(row) for row in (
        {"cell": "1:1", "error": "timeout", "streets": {}, "buildings": {}},
        {"cell": "2:2", "osm_sha256": "current", "dataset": "collection-a",
         "streets": {"42": []}, "buildings": {}},
        {"cell": "2:2", "error": "later retry timed out", "streets": {}, "buildings": {}},
        {"cell": "3:3", "streets": {}, "buildings": {}},
    )) + "\n")
    assert list(load_successful_cells(journal, osm_sha256="current", dataset="collection-a")) == ["2:2"]
    assert not load_successful_cells(journal, osm_sha256="different", dataset="collection-a")


def test_lidar_stage_requires_nonempty_curb_profiles(tmp_path):
    (tmp_path / "osm_ways.json").write_text("[]")
    (tmp_path / "lidar").mkdir()
    profiles = tmp_path / "curb_profiles_lidar.json"
    completion = tmp_path / "lidar" / "completion.json"
    outputs = [profiles, completion]
    assert not stage_outputs_ready("lidar", outputs)
    profiles.write_text('{"profiles":{}}')
    assert not stage_outputs_ready("lidar", outputs)
    profiles.write_text('{"profiles":{"osm:42":{"samples":[]}}}')
    completion.write_text(json.dumps({"profiles": 1, "cells": 1, "osm_sha256":
                                      hashlib.sha256(b"[]").hexdigest()}))
    assert stage_outputs_ready("lidar", outputs)
    (tmp_path / "osm_ways.json").write_text('[{}]')
    assert not stage_outputs_ready("lidar", outputs)


def test_lidar_output_writes_profile_for_measured_street(tmp_path):
    (tmp_path / "lidar").mkdir()
    street = {"osm_id": 42, "name": "Test Street", "points": [[-122.27, 37.8], [-122.27, 37.8001]]}
    station = {"lon": -122.27, "lat": 37.80005, "l": 6.0, "r": 6.2,
               "lh": 0.15, "rh": 0.16, "n": 100}
    count = write_outputs("test-cell", tmp_path, [street],
                          {"0:0": {"streets": {"42": [station]}, "buildings": {}}})
    profiles = json.loads((tmp_path / "official" / "curb_profiles_lidar.json").read_text())["profiles"]
    assert count == 1
    assert profiles["osm:42"]["samples"][0]["l"] == 6.0
