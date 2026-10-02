"""Photo observations stay attributable and never become measured collision."""

from __future__ import annotations

import json

from scripts import build_photo_world_objects as photo
from smc.world.object import GeometryBasis


def fixtures():
    ring = [
        [-122.40000, 37.79000], [-122.39990, 37.79000],
        [-122.39990, 37.79008], [-122.40000, 37.79008],
    ]
    way = {"kind": "building", "osm_id": 42, "centroid": [-122.39995, 37.79004],
           "points": ring, "height_m": 9.0}
    wall = {"a": ring[0], "b": ring[1], "views": 3, "agreement": 0.91,
            "coverage": 0.89, "providers": ["mapillary"], "licenses": ["CC-BY-SA-4.0"],
            "frames": ["frame-a", "frame-b", "frame-c"],
            "openings": [["window", 2.0, 1.5, 1.2, 1.4, 0.9]]}
    return way, {"walls": [wall]}


def test_photo_openings_keep_prior_footprint_and_frame_evidence():
    way, surveyed = fixtures()
    obj, reasons = photo._object(way, surveyed)
    assert obj is not None, reasons
    assert obj.basis is GeometryBasis.INFERRED
    assert obj.geometry.eave_z == way["height_m"]
    assert len(obj.geometry.facades) == 1
    assert len(obj.geometry.facades[0].elements) == 1
    assert {r.locator for r in obj.evidence.refs if r.kind == "image"} == {
        "frame-a", "frame-b", "frame-c"
    }


def test_weak_or_ambiguous_wall_never_becomes_object():
    way, surveyed = fixtures()
    surveyed["walls"][0]["views"] = 2
    obj, reasons = photo._object(way, surveyed)
    assert obj is None
    assert reasons["weak_multiview_wall"] == 1


def test_journal_resumes_without_duplicate_records(tmp_path, monkeypatch):
    way, surveyed = fixtures()
    model = tmp_path / "model.json"
    survey = tmp_path / "survey.json"
    model.write_text(json.dumps({"ways": [way]}))
    survey.write_text(json.dumps({"buildings": {"42": surveyed}}))
    monkeypatch.setattr(photo, "MODEL", model)
    monkeypatch.setattr(photo, "SURVEY", survey)
    monkeypatch.setattr(photo, "OUT", tmp_path / "world")
    first = photo.build()
    second = photo.build()
    assert first["accepted_buildings"] == second["accepted_buildings"] == 1
    assert second["attempted_this_run"] == 0
    assert len((photo.OUT / "photo_objects.journal.jsonl").read_text().splitlines()) == 1
