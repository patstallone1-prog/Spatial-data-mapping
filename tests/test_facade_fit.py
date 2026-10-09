import cv2
import numpy as np
import pytest

from smc.facades.fit import entry_recess, extract_front, opening_design, storey_constraint


def test_height_and_storeys_conflict_instead_of_silently_rescaling_house():
    assert storey_constraint(9.6, 3, [])["storey_height_m"] == pytest.approx(3.2)
    assert storey_constraint(4, 3, [])["status"] == "conflict"
    assert storey_constraint(10, None, [2, 5, 8])["status"] == "inferred"
    assert storey_constraint(10, None, [])["status"] == "unknown"


def test_observed_windows_preserve_long_wide_panes_and_never_cross_roof():
    image = np.full((300, 400, 3), (150, 170, 190), np.uint8)
    labels = np.ones((300, 400), np.uint8)
    for x, y, w, h in [(30, 50, 35, 75), (140, 150, 130, 50), (300, 0, 40, 50)]:
        image[y : y + h, x : x + w] = 40
        labels[y : y + h, x : x + w] = 8
    fit = extract_front(image, labels, 8, 6, {"levels": 2})
    windows = [o for o in fit["openings"] if o["kind"] == "window"]
    assert {o["design"]["shape"] for o in windows} >= {"tall", "panoramic"}
    assert all(o["v"] + o["h"] <= 5.85 for o in windows)
    assert fit["appearance"]["colour"] == "#beaa96"
    assert not fit["canonical_geometry_modified"] and not fit["inch_accuracy_verified"]


def test_visible_mullions_are_preserved_not_a_universal_sash():
    pane = np.full((100, 180, 3), 40, np.uint8)
    cv2.line(pane, (60, 0), (60, 99), (220, 220, 220), 3)
    cv2.line(pane, (120, 0), (120, 99), (220, 220, 220), 3)
    result = opening_design(pane, 3.6, 2)
    assert len(result["vertical_bars"]) == 2
    assert result["horizontal_bars"] == []


def test_long_recess_does_not_imply_second_floor_without_supported_rise():
    door = {"id": "entry"}
    story = {"storey_height_m": 3}
    controls = {"recess": {"category": "long", "door_id": "entry"}}
    assert not entry_recess(door, controls, story)["render_steps"]
    controls["recess"].update({"depth_m": 7, "rise_m": 3, "supported_by": ["survey:threshold"]})
    result = entry_recess(door, controls, story)
    assert result["render_steps"] and result["second_floor_supported"]
    assert result["steps"] * 0.3 + result["landing_depth_m"] <= result["depth_m"]
    assert not entry_recess({"id": "other-door"}, controls, story)["render_steps"]


def test_short_steps_must_fit_within_property_and_have_evidence():
    controls = {
        "recess": {
            "category": "short",
            "door_id": "entry",
            "depth_m": 1,
            "rise_m": 0.4,
            "supported_by": ["photo:steps"],
        }
    }
    assert not entry_recess({"id": "entry"}, controls, {})["render_steps"]
    controls["recess"]["depth_m"] = 2.1
    assert entry_recess({"id": "entry"}, controls, {})["render_steps"]


def test_ground_heights_require_shared_datum_and_provenance():
    image = np.full((200, 200, 3), 170, np.uint8)
    labels = np.ones((200, 200), np.uint8)
    result = extract_front(image, labels, 4, 4, {"ground_reference": {"threshold_m": 1}})
    assert result["conflicts"] == ["ground_datum_or_provenance_missing"]
