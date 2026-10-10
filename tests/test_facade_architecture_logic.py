from copy import deepcopy

import pytest

from smc.facades.architecture_logic import (
    NeighbourIndex,
    canonical_front_binding,
    door_access,
    front_footprint_frame,
    nearby_entry_pattern,
    repeated_forms,
)
from smc.facades.fit import entry_recess, extract_front, storey_constraint


def test_canonical_front_conversion_is_rigid_never_a_stretched_photo_proxy():
    import math

    ring = [[100, 200], [104, 204], [106, 202], [102, 198]]
    normal = [1 / math.sqrt(2), -1 / math.sqrt(2)]
    transformed = front_footprint_frame(ring, ring[0], ring[1], normal)
    assert transformed[0] == [0, 0]
    for a, b, u, v in zip(
        ring, ring[1:] + ring[:1], transformed, transformed[1:] + transformed[:1], strict=True
    ):
        assert math.dist(a, b) == pytest.approx(math.dist(u, v))
    with pytest.raises(ValueError, match="unit normal"):
        front_footprint_frame(ring, ring[0], ring[1], [2, 0])
    with pytest.raises(ValueError, match="perpendicular"):
        front_footprint_frame(ring, ring[0], ring[1], [1, 0])
    with pytest.raises(ValueError, match="finite"):
        front_footprint_frame([[float("nan"), 0], *ring], ring[0], ring[1], normal)


def test_stale_photo_plane_and_inward_normal_remain_low_certainty_review_evidence():
    prior = {"canonical_world_sha256": "current", "ring": [[0, 0], [10, 0], [10, -8], [0, -8]]}
    assert canonical_front_binding(prior, 10)["status"] == "bound"
    prior["ring"].reverse()
    assert canonical_front_binding(prior, 10)["status"] == "bound"
    prior["ring"] = [[0, 0.2], [10, 0.2], [10, -8], [0, -8]]
    assert canonical_front_binding(prior, 10)["status"] == "unbound_or_normal_conflict"
    prior["ring"] = [[0, 0], [10, 0], [10, 8], [0, 8]]
    assert canonical_front_binding(prior, 10)["status"] == "unbound_or_normal_conflict"
    assert canonical_front_binding({"ring": prior["ring"]}, 10)["status"] == "invalid"


def entrance(image="photo", rise=3.0, door_id="d"):
    door = {"id": door_id, "kind": "door", "u": 1, "v": rise, "w": 1, "h": 2.1}
    evidence = {
        "door_id": door_id,
        "category": "long",
        "rise_m": rise,
        "depth_m": 7,
        "supported_by": ["photo:flight"],
        "stairs": {"visible": True, "image_sha256": image, "reviewer": "test"},
    }
    door["recess"] = entry_recess(
        door, {"image_sha256": image, "recess": evidence}, storey_constraint(9, 3, [])
    )
    return door


def house(key, distance=0):
    return {
        "building_id": key,
        "region": "sf-mission",
        "image_sha256": key,
        "a": [-122 + distance / 89000, 37],
        "b": [-122.0001 + distance / 89000, 37],
        "address": {"street": "Example Street"},
        "review_status": "reviewed_inferred_visual_parameters",
        "openings": [entrance(key)],
    }


@pytest.mark.parametrize("rise,allowed", [(0, True), (0.1524, True), (0.1525, False), (3, False)])
def test_exact_six_inch_unstepped_limit_preserves_observation(rise, allowed):
    door = {"id": "d", "v": rise}
    before = deepcopy(door)
    check = door_access(door)
    assert check["render_allowed"] is allowed
    assert door == before and not check["geometry_modified"]


def test_image_bound_aligned_stairs_and_four_tread_landing_required():
    door = entrance()
    assert door_access(door, image_sha256="photo")["stairs_supported"]
    for mutation in (
        {"door_id": "different"},
        {"rise_m": 2.9},
        {"landing_depth_m": 0.9},
        {"depth_m": 1},
        {"steps": True},
        {"render_steps": False},
        {"stairs_evidence": {"visible": True, "reviewer": "test", "image_sha256": "other"}},
    ):
        wrong = deepcopy(door)
        wrong["recess"].update(mutation)
        assert not door_access(wrong, image_sha256="photo")["render_allowed"]


def test_relative_outside_ground_control_requires_datum_and_source():
    door = {"id": "d", "v": 2.1}
    valid = {"frame": "relative_to_facade_foot", "source": "survey:ground", "outside_ground_m": 2}
    assert door_access(door, valid)["render_allowed"]
    for invalid in (
        {**valid, "source": ""},
        {**valid, "frame": "other"},
        {**valid, "outside_ground_m": float("nan")},
    ):
        assert not door_access(door, invalid)["render_allowed"]


def test_two_opposite_bays_share_family_but_remain_separate_and_no_hidden_copy():
    fit = {
        "width_m": 10,
        "outcrops": [
            {"id": "a", "kind": "canted_bay", "u": 0.5, "v": 3, "w": 2, "h": 4},
            {"id": "b", "kind": "canted_bay", "u": 7.5, "v": 3, "w": 2, "h": 4},
        ],
    }
    before = deepcopy(fit)
    result = repeated_forms(fit)
    assert result["pairs"][0]["object_ids"] == ["a", "b"]
    assert result["pairs"][0]["shared_style_hint"] == "canted_bay"
    assert result["pairs"][0]["separate_objects"]
    assert fit == before and not result["geometry_modified"]
    fit["outcrops"].pop()
    assert repeated_forms(fit)["pairs"] == []


def test_real_asymmetry_not_rewritten_and_each_object_pairs_once():
    fit = {
        "width_m": 10,
        "outcrops": [
            {"id": "a", "kind": "canted_bay", "u": 0.5, "v": 3, "w": 2, "h": 4},
            {"id": "b", "kind": "rounded_bay", "u": 7.5, "v": 3, "w": 2, "h": 4},
        ],
    }
    # Distinct kinds cannot be mistaken as the same shape just because position matches.
    assert repeated_forms(fit)["pairs"] == []
    fit["outcrops"][1]["kind"] = "canted_bay"
    fit["outcrops"].append({**fit["outcrops"][1], "id": "c"})
    assert len(repeated_forms(fit)["pairs"]) == 1


def test_reviewed_same_street_majority_prior_does_not_create_stairs():
    subject = house("subject")
    subject["openings"][0]["recess"] = {"category": "unknown", "render_steps": False}
    peers = [house(str(i), 10 * i) for i in range(1, 4)]
    before = deepcopy(subject)
    pattern = nearby_entry_pattern(subject, [*peers, peers[0]])
    assert pattern["dominant_category"] == "long" and len(pattern["votes"]) == 3
    assert pattern["scope"] == "nearby_same_street_not_verified_block"
    assert not pattern["render_steps"] and not pattern["certainty_increased"]
    assert subject == before


@pytest.mark.parametrize(
    "change",
    [
        {"region": "oakland-downtown"},
        {"address": {"street": "Elsewhere"}},
        {"review_status": "needs_visual_alignment_review"},
        {"image_sha256": "subject"},
        {"block_id": "another"},
        {"a": [-121, 37], "b": [-121.0001, 37]},
        {"a": [-122.0001, 37], "b": [-122, 37]},
    ],
)
def test_unrelated_unreviewed_far_and_opposite_fronts_never_vote(change):
    subject = house("subject")
    subject["block_id"] = "same"
    peers = [house(str(i), 10 * i) for i in range(1, 4)]
    for p in peers:
        p.update(block_id="same")
    peers[0].update(change)
    assert nearby_entry_pattern(subject, peers)["dominant_category"] is None


def test_multiple_entries_and_duplicate_pixels_do_not_manufacture_majority():
    subject = house("subject")
    peers = [house(str(i), 10 * i) for i in range(1, 4)]
    peers[1]["image_sha256"] = peers[0]["image_sha256"]
    assert nearby_entry_pattern(subject, peers)["dominant_category"] is None
    peers[1]["image_sha256"] = "2"
    second = entrance("1", 0.54, "short")
    second["recess"].update(category="short")
    peers[0]["openings"].append(second)
    assert nearby_entry_pattern(subject, peers)["dominant_category"] is None


def test_extractor_preserves_raised_threshold_but_blocks_display():
    import numpy as np

    image = np.full((300, 300, 3), 120, np.uint8)
    labels = np.ones((300, 300), np.uint8)
    fit = extract_front(
        image,
        labels,
        9,
        9,
        {
            "image_sha256": "photo",
            "levels": 3,
            "detector_proposals": [{"kind": "door", "box": [0.1, 0.4, 0.2, 0.65], "score": 0.8}],
        },
    )
    door = fit["openings"][0]
    assert door["v"] == 3.15 and not door["render_allowed"]
    assert door["access_check"]["reason"] == "raised_door_without_aligned_supported_stairs"


def test_asymmetric_bay_placement_is_not_forced_into_mirror_positions():
    fit = {
        "width_m": 10,
        "outcrops": [
            {"id": "a", "kind": "canted_bay", "u": 2.9, "v": 3, "w": 3, "h": 4},
            {"id": "b", "kind": "canted_bay", "u": 7.05, "v": 3, "w": 2.75, "h": 4},
        ],
    }
    result = repeated_forms(fit)
    assert result["pairs"][0]["shared_style_hint"] == "canted_bay"
    assert not result["pairs"][0]["mirror_alignment"]
    assert fit["outcrops"][0]["u"] == 2.9


def test_neighbour_index_keeps_close_houses_at_bucket_edges_and_excludes_other_cities():
    import math

    subject = house("subject")
    subject["a"] = [-122.420001, 37.780001]
    peers = []
    for angle in range(0, 360, 15):
        p = house(str(angle))
        p["a"] = [
            subject["a"][0]
            + 74.9
            * math.cos(math.radians(angle))
            / (111320 * math.cos(math.radians(subject["a"][1]))),
            subject["a"][1] + 74.9 * math.sin(math.radians(angle)) / 110540,
        ]
        peers.append(p)
    far = house("far", 10000)
    other_region = {**subject, "region": "oakland-downtown", "building_id": "wrong-region"}
    result = NeighbourIndex([*peers, far, other_region]).near(subject)
    assert {p["building_id"] for p in result} == {p["building_id"] for p in peers}
