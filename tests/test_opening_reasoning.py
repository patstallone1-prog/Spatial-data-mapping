import cv2
import numpy as np
import pytest

from smc.facades.fit import entry_recess, extract_front
from smc.facades.opening_reasoning import normalize_label, reason_opening, reason_proposals


def panels():
    image = np.full((140, 160, 3), 150, np.uint8)
    for y in (24, 54, 84, 114):
        cv2.line(image, (3, y), (156, y), (30, 30, 30), 3)
    for x in (50, 105):
        cv2.line(image, (x, 4), (x, 136), (30, 30, 30), 3)
    return image


@pytest.mark.parametrize("width,height", [(2.4384, 2.1336), (2.7432, 2.1336), (4.8768, 2.1336)])
def test_garage_panels_are_not_steps_and_dimensions_are_never_resized(width, height):
    result = reason_opening(panels(), width, height, "stairs")
    assert result["class"] == "garage_candidate"
    assert not result["render_steps"]
    assert result["dimensions_m"] == {"width": width, "height": height}
    assert result["certainty"] == "inferred_rule_screen_not_measured"


def review(**extra):
    return {
        "visible": True,
        "image_sha256": "abc",
        "reviewer": "fixture",
        "at_least_one_tread": True,
        "at_door_threshold": True,
        "pedestrian_door_visible": True,
        **extra,
    }


@pytest.mark.parametrize("count", [1, 2, 5, 6])
def test_narrow_leaf_and_reviewed_threshold_tread_rule_out_vehicle_opening(count):
    result = reason_opening(
        panels(), 1.1, 2.5, "garage door", image_sha256="abc", step_review=review(count=count)
    )
    assert result["class"] == "stair_recess_candidate" and result["rules_out_garage"]
    assert not result["render_steps"]  # Rise/depth/footprint checks still needed.


def test_real_observation_wins_even_for_nonstandard_wide_entrance():
    result = reason_opening(
        panels(), 2.5, 2.5, "garage door", image_sha256="abc", step_review=review()
    )
    assert result["class"] == "stair_recess_candidate"
    assert "observed_entrance_overrides_standard_size_prior" in result["reasons"]


def test_driveway_lip_without_pedestrian_door_does_not_rule_out_garage():
    result = reason_opening(
        panels(),
        2.44,
        2.13,
        "garage door",
        image_sha256="abc",
        step_review=review(count=1, pedestrian_door_visible=False),
    )
    assert result["class"] == "garage_candidate" and not result["rules_out_garage"]


def test_size_alone_blank_opening_and_wrong_image_cannot_certify_garage_or_steps():
    image = np.full((140, 160, 3), 100, np.uint8)
    assert reason_opening(image, 2.44, 2.13, "door")["class"] == "unknown"
    assert not reason_opening(image, 1, 2.4, "stairs", image_sha256="other", step_review=review())[
        "steps_reviewed"
    ]
    assert not reason_opening(
        image,
        1,
        2.4,
        "stairs",
        image_sha256="abc",
        step_review=review(at_least_one_tread=False, count=0),
    )["steps_reviewed"]


def test_detected_horizontal_bands_at_narrow_door_are_only_review_candidates():
    image = np.full((200, 200, 3), 100, np.uint8)
    for y in (145, 170, 195):
        cv2.line(image, (60, y), (120, y), (240, 240, 240), 2)
    raw = [
        {"kind": "door door", "box": [0.3, 0.1, 0.6, 0.7], "score": 0.5},
        {"kind": "stairs", "box": [0.3, 0.7, 0.6, 0.99], "score": 0.4},
    ]
    result = reason_proposals(image, raw, 4, 4)
    assert raw[0]["kind"] == "door door"  # Raw evidence is immutable.
    decision = result[1]["opening_reasoning"]
    assert decision["associated_door"] and decision["class"] == "stair_recess_candidate"
    assert not decision["steps_reviewed"] and not decision["render_steps"]


def test_invalid_boxes_and_dimensions_fail_closed():
    image = panels()
    assert reason_proposals(image, [{"kind": "stairs", "box": [0, 0, float("nan"), 1]}], 4, 4) == []
    with pytest.raises(ValueError):
        reason_opening(image, float("nan"), 2, "door")
    assert normalize_label("door door") == "door"


def test_bad_box_does_not_shift_another_regions_review_identity():
    raw = [
        {"kind": "stairs", "box": [0, 0, float("nan"), 1], "score": 0.9},
        {"kind": "stairs", "box": [0.1, 0.1, 0.9, 0.9], "score": 0.5},
    ]
    result = reason_proposals(panels(), raw, 3, 3, image_sha256="abc", reviews={"0": review()})
    assert result[0]["proposal_index"] == 1
    assert not result[0]["opening_reasoning"]["steps_reviewed"]


def test_fitted_garage_never_receives_entry_steps_and_stair_label_is_quarantined():
    image = panels()
    labels = np.ones(image.shape[:2], np.uint8)
    controls = {
        "detector_proposals": [
            {"kind": "garage door", "box": [0.1, 0.08, 0.9, 0.95], "score": 0.8},
            {"kind": "stairs", "box": [0.1, 0.08, 0.9, 0.95], "score": 0.4},
        ]
    }
    fit = extract_front(image, labels, 3.1, 2.8, controls)
    assert fit["openings"][0]["kind"] == "garage_candidate"
    assert not fit["openings"][0]["recess"]["render_steps"]
    assert fit["details"][0]["kind"] == "opening_review_candidate"
    assert not fit["details"][0]["render"]
    assert not entry_recess({"kind": "garage_candidate", "id": "x"}, {}, {})["render_steps"]
