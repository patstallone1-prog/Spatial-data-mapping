"""Deterministic frontage policy and real adapter regressions; no provider credentials."""

from __future__ import annotations

import dataclasses
import math
from collections import defaultdict
from datetime import UTC, datetime

import numpy as np
import pytest

from scripts.filter_frontage_photos import blocked_sightline, camera_for, matching_landmark
from smc.facades.frontage import (
    FrontagePolicy,
    apply_review,
    assess_view,
    capture_date,
    date_gate,
    frontage_envelopes,
    street_front,
)
from smc.facades.geometry import Camera, LocalFrame, Wall, project

NOW = datetime(2026, 10, 8, tzinfo=UTC)
WALL = Wall(0, 0, (-5, 0), (5, 0), (0, -1), 6)
ROW = {
    "captured_at": "2026-01-01T00:00:00Z",
    "license_id": "CC-BY-SA-4.0",
    "attribution": "real source photographer",
    "eligible": True,
}


def camera(x=0, y=-12, spherical=False, yaw=0):
    return Camera(
        x,
        y,
        2.4,
        math.radians(yaw),
        4096,
        2048 if spherical else 3072,
        spherical,
        None if spherical else math.radians(70),
    )


def assess(cam=None, wall=WALL, row=None, **kwargs):
    return assess_view(wall, cam or camera(), row or ROW, now=NOW, **kwargs)


def test_complete_dead_on_passes_but_is_not_automatically_verified():
    result = assess(posed=True)
    assert result["geometry_pass"] and result["full_front_in_frame"]
    assert result["angle_deg"] == 0 and not result["verified"]
    assert result["visibility_status"] == "not_pixel_verified"


def test_near_dead_on_outranks_far_or_oblique():
    assert assess(camera(y=-12))["rank"] > assess(camera(y=-30))["rank"]
    assert assess(camera())["rank"] > assess(camera(x=3))["rank"]


def test_angle_limit_is_not_heading_angle():
    # A camera aimed at a wall from its side is still badly foreshortened.
    c = camera(x=12, yaw=-45)
    assert "too_oblique" in assess(c)["reasons"]


def test_clipped_roof_rejected_even_if_centre_is_visible():
    result = assess(wall=dataclasses.replace(WALL, height_m=45))
    assert "front_cut_off" in result["reasons"]


def test_too_close_can_have_bad_edge_angles_and_be_cut_off():
    result = assess(camera(y=-3.1))
    assert "too_oblique" in result["reasons"]
    assert not result["full_front_in_frame"]


def test_panorama_wrap_is_not_a_false_border_or_two_separate_images():
    result = assess(camera(spherical=True, yaw=180))
    assert result["full_front_in_frame"] and result["geometry_pass"]


@pytest.mark.parametrize(
    "date,reason",
    [
        (None, "capture_date_unknown"),
        ("2026-10-09T00:00:00Z", "future_capture"),
        ("2016-10-07T23:59:59Z", "older_than_ten_years"),
        ("2016-10-08T00:00:00Z", None),
        ("2020-01-01", "capture_date_unknown"),
    ],
)
def test_date_means_capture_not_upload(date, reason):
    assert date_gate(date, NOW, FrontagePolicy()) == reason


def test_leap_cutoff_and_landmark_exception():
    now = datetime(2024, 2, 29, tzinfo=UTC)
    assert date_gate("2014-02-28T00:00:00Z", now, FrontagePolicy()) is None
    assert date_gate("1900-01-01T00:00:00Z", NOW, FrontagePolicy(), True) is None
    assert date_gate(None, NOW, FrontagePolicy(), True) == "capture_date_unknown"
    assert date_gate("2028-01-01T00:00:00Z", NOW, FrontagePolicy(), True) == "future_capture"


def test_landmark_exception_does_not_bypass_angle_or_rights():
    result = assess(camera(x=20), row={**ROW, "license_id": "unknown"}, landmark={"landmark_id": 3})
    assert {"too_oblique", "rights_or_attribution_unknown"} <= set(result["reasons"])


def test_redundant_distinct_views_survive_task_specific_selection():
    assert assess(row={**ROW, "eligible": False, "rejection_reason": "redundant_viewpoint"})[
        "geometry_pass"
    ]
    assert not assess(row={**ROW, "eligible": False, "rejection_reason": "provider_deleted"})[
        "geometry_pass"
    ]


def test_missing_pose_never_becomes_verified():
    review = {
        "image_sha256": "abc",
        "reviewer": "human",
        "occlusion_fraction": 0.05,
        "privacy_safe": True,
        "front_matches_building": True,
        "openings_legible": True,
        "full_front_visible": True,
    }
    policy = FrontagePolicy()
    assert apply_review(assess(posed=True), image_sha256="abc", review=review, policy=policy)[
        "verified"
    ]
    assert not apply_review(assess(), image_sha256="abc", review=review, policy=policy)["verified"]
    assert not apply_review(
        assess(posed=True), image_sha256="different", review=review, policy=policy
    )["verified"]
    assert not apply_review(
        assess(posed=True),
        image_sha256="abc",
        review={**review, "occlusion_fraction": 0.5},
        policy=policy,
    )["verified"]
    assert not apply_review(
        assess(posed=True),
        image_sha256="abc",
        review={**review, "occlusion_fraction": float("nan")},
        policy=policy,
    )["verified"]


def test_semantic_screen_rejects_sky_trees_ground_and_cars_not_just_bad_angles():
    from smc.facades.frontage_pixels import semantic_gate

    assert not semantic_gate({"architecture": 0.9, "sky": 0.02, "dynamic": 0.01})
    assert "sky_not_facade" in semantic_gate({"architecture": 0.1, "sky": 0.8})
    assert "vegetation_blocks_detail" in semantic_gate({"architecture": 0.6, "vegetation": 0.35})
    assert "people_or_vehicles_block_detail" in semantic_gate({"architecture": 0.7, "dynamic": 0.2})
    assert "ground_not_facade" in semantic_gate({"architecture": 0.5, "ground": 0.4})
    assert "invalid_semantics" in semantic_gate({"architecture": float("nan")})


def test_bay_fragments_are_joined_instead_of_selecting_just_a_door_panel():
    ring = [(-10, 0), (-2, 0), (-2, -1), (2, -1), (2, 0), (10, 0), (10, 12), (-10, 12)]
    road = [((-25, -15), (25, -15), "Front street")]
    fronts = frontage_envelopes(ring, 8, 0, road)
    assert len(fronts) == 1 and fronts[0][0].length_m == pytest.approx(20)
    assert fronts[0][0].midpoint[1] == pytest.approx(-1)
    assert frontage_envelopes(list(reversed(ring)), 8, 0, road)[0][0].length_m == pytest.approx(20)


def test_back_wall_is_not_street_front_and_winding_is_consistent():
    road = [((-20, -15), (20, -15), "Public Street")]
    assert street_front(WALL, road)[1] == "Public Street"
    back = dataclasses.replace(WALL, a=(5, 10), b=(-5, 10), normal=(0, 1))
    assert street_front(back, road) is None


def test_other_building_blocks_sightline_even_when_camera_is_head_on():
    rings = [[(-5, 0), (5, 0), (5, 10), (-5, 10)], [(-3, -8), (3, -8), (3, -4), (-3, -4)]]
    grid = defaultdict(list, {(-1, -1): [1], (0, -1): [1]})
    assert blocked_sightline(camera(), WALL, 0, rings, grid)
    assert not blocked_sightline(camera(), WALL, 0, rings, {})


def test_landmark_match_cannot_exempt_nearby_buildings_or_proposed_designations():
    building = {"centroid": [0.5, 0.5], "points": [[0, 0], [1, 0], [1, 1], [0, 0]]}
    feature = {
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[-1, -1], [2, -1], [2, 2], [-1, 2], [-1, -1]]],
        },
        "properties": {"status": "Adopted", "landmarkno": 1, "name": "Landmark"},
    }
    assert matching_landmark(building, [feature])["landmark_id"] == 1
    assert matching_landmark({**building, "centroid": [3, 3]}, [feature]) is None
    assert (
        matching_landmark(
            building, [{**feature, "properties": {**feature["properties"], "status": "Proposed"}}]
        )
        is None
    )


def test_reported_pose_conversion_preserves_axis_convention_but_is_not_solved():
    row = {
        "original_width": 2000,
        "original_height": 1500,
        "heading_deg": 0,
        "latitude": 0,
        "longitude": 0,
        "projection_type": "perspective",
        "pitch_deg": 0,
        "roll_deg": 0,
    }
    cam, solved = camera_for(row, LocalFrame(0, 0), None)
    assert not solved
    u, v, valid = project(cam, np.array([[0, 12, 2.4]]))
    assert valid[0] and u[0] == pytest.approx(1000) and v[0] == pytest.approx(750)
    assert capture_date("2025-01-01T00:00:00Z").tzinfo == UTC
