"""How a house is entered, read from its front photograph; and the fit accepted without a person."""

from __future__ import annotations

import numpy as np
import pytest

from smc.facades.auto_review import STATUS, accepted, decide
from smc.facades.entry_inference import (
    AUTOMATIC_REVIEWER,
    fence_runs,
    infer_entries,
    primary_entry,
)
from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

W, H, PPM = 8.0, 6.0, 40          # an 8 x 6 m front at 40 px a metre


def _front():
    bgr = np.full((int(H * PPM), int(W * PPM), 3), 200, np.uint8)
    labels = np.ones(bgr.shape[:2], np.uint8)          # all "building"
    return bgr, labels


def _px(u, v, w, h):
    """Metres on the front (v up from its foot) to a row/column slice."""
    rows = slice(int((H - v - h) * PPM), int((H - v) * PPM))
    cols = slice(int(u * PPM), int((u + w) * PPM))
    return rows, cols


def _door(u, v, w=1.0, h=2.1, ident="opening-0"):
    return {"id": ident, "kind": "door", "u": u, "v": v, "w": w, "h": h}


def test_a_door_up_a_tall_flight_is_a_long_stair_with_its_steps():
    bgr, labels = _front()
    labels[_px(3.0, 0.0, 1.4, 2.4)] = 53                 # stairs under the door
    result = infer_entries(bgr, labels, W, H, [_door(3.2, 2.4)], storey_height_m=3.0,
                           image_sha256="abc")
    entry = result["entries"][0]
    assert entry["kind"] == "long_stair" and entry["stair_pixels"]
    assert entry["to_second_storey"] is True
    recess = entry["recess"]
    assert recess["render_steps"] and recess["steps"] == 13 and recess["rise_m"] == pytest.approx(2.4)
    # The same fields an image-reviewed stair carried, from the automatic reviewer.
    assert recess["stairs_evidence"]["reviewer"] == AUTOMATIC_REVIEWER
    assert recess["stairs_evidence"]["image_sha256"] == "abc"


def test_a_raised_door_with_nothing_under_it_is_a_balcony_door_not_an_entry():
    bgr, labels = _front()
    result = infer_entries(bgr, labels, W, H, [_door(3.0, 3.1), _door(5.5, 0.0, ident="ground")])
    kinds = {e["door_id"]: e["kind"] for e in result["entries"]}
    assert kinds["opening-0"] == "upper_door" and "recess" not in result["entries"][0]
    assert primary_entry(result)["door_id"] == "ground"


def test_a_few_steps_are_a_short_stair():
    bgr, labels = _front()
    entry = infer_entries(bgr, labels, W, H, [_door(3.0, 0.7)])["entries"][0]
    assert entry["kind"] == "short_stair" and entry["recess"]["steps"] == 4


def test_a_door_at_the_pavement_between_shadowed_reveals_is_an_alcove_of_measured_width():
    bgr, labels = _front()
    bgr[_px(2.6, 0.0, 0.4, 2.1)] = 60                   # left reveal in shade
    bgr[_px(4.0, 0.0, 0.4, 2.1)] = 60                   # right reveal in shade
    entry = infer_entries(bgr, labels, W, H, [_door(3.0, 0.0)])["entries"][0]
    assert entry["kind"] == "flat_alcove"
    assert entry["alcove"]["width_m"] == pytest.approx(1.8, abs=0.06)
    assert 0.9 <= entry["alcove"]["depth_m"] <= 1.8
    assert entry["alcove"]["depth_basis"] == "inferred_from_width_prior"


def test_a_door_flush_with_a_lit_wall_is_flush():
    bgr, labels = _front()
    entry = infer_entries(bgr, labels, W, H, [_door(3.0, 0.0)])["entries"][0]
    assert entry["kind"] == "flush"


def test_a_fence_in_front_of_the_entry_gives_it_a_gate_and_a_bus_does_not():
    bgr, labels = _front()
    rows, cols = _px(1.0, 0.0, 6.0, 1.5)
    labels[rows, cols] = 32
    for x in range(cols.start, cols.stop, 5):              # iron bars
        bgr[rows, x:x + 2] = 20
    entry = infer_entries(bgr, labels, W, H, [_door(3.5, 0.0)])["entries"][0]
    assert entry["gate"]["style"] == "bars" and 1.2 <= entry["gate"]["h"] <= 1.7
    # A solid "fence" across the whole front is a vehicle the model mislabelled, not a fence.
    bgr, labels = _front()
    labels[_px(0.0, 0.0, 8.0, 2.2)] = 32
    assert fence_runs(bgr, labels, W, H) == []


def test_a_tall_flight_with_no_door_seen_gives_a_hidden_door_at_its_top():
    bgr, labels = _front()
    labels[_px(5.0, 0.0, 1.5, 2.7)] = 53
    result = infer_entries(bgr, labels, W, H, [], storey_height_m=3.0)
    entry = primary_entry(result)
    assert entry["kind"] == "long_stair" and entry["hidden_door"]
    assert entry["threshold_m"] == pytest.approx(2.7, abs=0.05)


def test_columns_and_garage_panels_are_not_front_doors():
    bgr, labels = _front()
    doors = [_door(1.0, 0.0, w=0.35, ident="column"), _door(3.0, 0.0, w=2.6, ident="garage")]
    assert infer_entries(bgr, labels, W, H, doors)["entries"] == []


def _fit(**over):
    fit = {
        "source_locator": "mapillary://mapillary.com/seq/123",
        "strict_frontage": {"metadata_pass": True},
        "selection_evidence": {"full_front_in_frame": True},
        "front_geometry_binding": {"status": "bound"},
        "canonical_geometry_modified": False,
        "conflicts": [],
        "appearance": {"colour": "#a0a0a0"},
        "openings": [{"id": "w", "kind": "window", "u": 1, "v": 3, "w": 1, "h": 1.4}],
        "width_m": 8.0, "height_m": 6.0,
    }
    fit.update(over)
    return fit


def test_a_coherent_fit_is_accepted_automatically():
    decision = decide(_fit())
    assert decision["accept"] and decision["reviewer"].startswith("automatic:")
    assert accepted(_fit(), decision)["review_status"] == STATUS


@pytest.mark.parametrize("change, reason", [
    ({"source_locator": "3d-street-view://google/abc"}, "source_restricted"),
    ({"strict_frontage": {"metadata_pass": False}}, "frontage_view_gate_failed"),
    ({"front_geometry_binding": {"status": "unbound"}}, "front_not_bound_to_building_edge"),
    ({"conflicts": ["threshold_conflict:opening-1"]}, "conflict:threshold_conflict:opening-1"),
    ({"openings": []}, "no_window_read"),
    ({"appearance": {"colour": None}}, "no_wall_colour_read"),
])
def test_an_incoherent_or_restricted_fit_is_rejected_with_its_reason(change, reason):
    decision = decide(_fit(**change))
    assert not decision["accept"] and reason in decision["reasons"]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_model_draws_accepted_fits_and_builds_their_entries():
    js = _page_js()
    assert '["reviewed_inferred_visual_parameters", "auto_accepted_visual_parameters"].includes' in js
    door = _extract("photoEntryDoor", js)
    assert "fit?.primary_entry" in door and "door.photoEntry = pe" in door
    show = _extract("showDoor", js)
    assert 'pe.kind === "flat_alcove" ? planAlcove(door, street, pe.alcove)' in show
    assert "if (pe?.gate) addGate(door, street);" in show
    gate = _extract("addGate", js)
    assert "const recessed = Boolean(door.stoopPlan) && setback < 1.0;" in gate
    # Opens with Enter, swings, and blocks the walker while it is shut.
    assert "gate.open = !gate.open;" in js and "swingGates(dt);" in js
    assert "if (d.gate.angle < 0.3) out.push(d.gate.leaf);" in js
    assert "d.source === 2 ||" in _extract("settleDoors", js)
