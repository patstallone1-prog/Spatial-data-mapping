import json

import cv2
import numpy as np
import pytest

from smc.facades.fit import (
    entry_recess,
    extract_front,
    opening_design,
    reviewed_details,
    storey_constraint,
)


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
    json.dumps(fit)  # Semantic-rule NumPy dimensions must remain typed JSON facts.


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
    controls["recess"]["stairs"] = {"visible": True, "image_sha256": "abc", "reviewer": "test"}
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
            "stairs": {"visible": True, "image_sha256": "abc", "reviewer": "test"},
        }
    }
    assert not entry_recess({"id": "entry"}, controls, {})["render_steps"]
    controls["recess"]["depth_m"] = 2.1
    assert entry_recess({"id": "entry"}, controls, {})["render_steps"]


def test_visible_stairs_required_and_hidden_long_entry_lands_at_second_storey():
    evidence = {
        "door_id": "entry",
        "category": "long",
        "door_visible": False,
        "depth_m": 7,
        "supported_by": ["photo:ascending-flight"],
    }
    door = {"id": "entry"}
    story = storey_constraint(9, 3, [])
    assert not entry_recess(door, {"recess": evidence}, story)["render_steps"]
    evidence["stairs"] = {"visible": True, "image_sha256": "abc", "reviewer": "test"}
    result = entry_recess(door, {"recess": evidence}, story)
    assert result["render_steps"] and result["rise_m"] == 3
    assert result["landing_alignment"] == "second_storey_bottom"
    assert result["landing_depth_m"] == 4 * 0.30
    assert result["door_visibility"] == "hidden_inferred"


def test_observed_six_step_mini_recess_and_no_garage_as_steps():
    evidence = {
        "door_id": "entry",
        "category": "short",
        "depth_m": 3,
        "rise_m": 1.08,
        "supported_by": ["photo:flight"],
        "stairs": {"visible": True, "count": 6, "image_sha256": "abc", "reviewer": "test"},
    }
    assert entry_recess({"id": "entry"}, {"recess": evidence}, {})["steps"] == 6
    evidence["stairs"].pop("reviewer")
    assert not entry_recess({"id": "entry"}, {"recess": evidence}, {})["render_steps"]


def test_ground_heights_require_shared_datum_and_provenance():
    image = np.full((200, 200, 3), 170, np.uint8)
    labels = np.ones((200, 200), np.uint8)
    result = extract_front(image, labels, 4, 4, {"ground_reference": {"threshold_m": 1}})
    assert result["conflicts"] == ["ground_datum_or_provenance_missing"]


def test_details_require_image_bound_visibility_style_material_and_review():
    detail = {
        "kind": "fire_escape",
        "image_sha256": "abc",
        "visible": True,
        "reviewer": "test",
        "u": 2,
        "v": 3.2,
        "w": 2,
        "h": 3.6,
        "depth_m": 0.8,
        "height_basis": "nearest_storey_bottom",
        "colour": "#665544",
        "style": "lattice",
        "material": "metal",
    }
    controls = {"image_sha256": "abc", "reviewed_details": [detail]}
    result = reviewed_details(controls, 10, 9, storey_constraint(9, 3, []))
    assert result[0]["platform_heights_m"] == [3, 6]
    assert result[0]["collision"] == "canonical_only" and not result[0]["exact_style"]
    detail["image_sha256"] = "wrong"
    assert reviewed_details(controls, 10, 9, storey_constraint(9, 3, [])) == []


def test_detector_details_are_not_automatically_rendered_and_replace_dark_blob_proposals():
    image = np.full((200, 200, 3), 100, np.uint8)
    labels = np.ones((200, 200), np.uint8)
    controls = {
        "detector_proposals": [
            {"kind": "fire escape", "box": [0.3, 0.2, 0.6, 0.7], "score": 0.8},
            {"kind": "window", "box": [0.1, 0.2, 0.2, 0.5], "score": 0.8},
        ]
    }
    result = extract_front(image, labels, 6, 6, controls)
    assert len(result["openings"]) == 1
    assert len(result["details"]) == 1 and not result["details"][0]["render"]


def test_hidden_door_is_only_proposed_from_same_image_reviewed_ascending_flight():
    image = np.full((200, 200, 3), 170, np.uint8)
    labels = np.ones((200, 200), np.uint8)
    controls = {
        "levels": 3,
        "image_sha256": "abc",
        "detector_proposals": [],
        "hidden_entrance": {
            "door_id": "hidden",
            "u": 2,
            "w": 1,
            "category": "long",
            "door_visible": False,
            "depth_m": 7,
            "supported_by": ["photo:ascending"],
            "stairs": {"visible": True, "count": 5, "image_sha256": "abc", "reviewer": "test"},
        },
    }
    fit = extract_front(image, labels, 8, 9, controls)
    assert len(fit["openings"]) == 1
    door = fit["openings"][0]
    assert door["v"] == 3 and door["certainty"] == "inferred_not_observed"
    assert door["recess"]["steps"] > 5  # Five visible steps are an incomplete ascending fragment.
    controls["hidden_entrance"]["stairs"]["image_sha256"] = "another-photo"
    assert extract_front(image, labels, 8, 9, controls)["openings"] == []
