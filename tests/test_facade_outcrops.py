import pytest

from smc.facades.outcrops import (
    contains,
    infer_candidates,
    profile,
    reviewed_outcrops,
    within_property,
)


def controls(kind="canted_bay", depth=0.6):
    return {
        "image_sha256": "image",
        "property_boundary": {
            "a": [0, 0],
            "b": [10, 0],
            "normal": [0, 1],
            "ring": [[-1, -3], [11, -3], [11, 1], [-1, 1]],
            "source": "surveyed parcel fixture",
            "sha256": "boundary-v1",
        },
        "reviewed_outcrops": [
            {
                "kind": kind,
                "image_sha256": "image",
                "reviewer": "fixture",
                "visible": True,
                "box": [0.2, 0.05, 0.8, 0.7],
                "depth_m": depth,
            }
        ],
    }


def test_all_shapes_keep_location_and_never_become_canonical_measurements():
    for kind in ("canted_bay", "box_bay", "rounded_bay", "oriel"):
        result = reviewed_outcrops(controls(kind), 10, 9)[0]
        assert result["render"] and result["depth_m"] == 0.6
        assert result["u"] == 2 and result["w"] == pytest.approx(6)
        assert result["depth_basis"] == "inferred_not_measured"
        assert not result["canonical_geometry_modified"]
        assert within_property(result["profile"], controls()["property_boundary"])


def test_street_sized_depth_is_clamped_at_property_and_flags_low_certainty():
    result = reviewed_outcrops(controls(depth=30), 10, 9)[0]
    assert result["depth_m"] < 1 and result["certainty"] == "low"
    assert result["restriction"] == "property_or_physical_limit"
    assert within_property(result["profile"], controls()["property_boundary"])


def test_missing_property_and_wrong_image_abstain():
    c = controls()
    c.pop("property_boundary")
    result = reviewed_outcrops(c, 10, 9)[0]
    assert not result["render"] and result["depth_m"] == 0 and result["certainty"] == "low"
    c["reviewed_outcrops"][0]["image_sha256"] = "wrong"
    assert reviewed_outcrops(c, 10, 9) == []


def test_nonunit_or_nonfinite_boundary_cannot_bypass_physical_depth_limit():
    c = controls()
    c["property_boundary"]["normal"] = [0, 10]
    assert not reviewed_outcrops(c, 10, 9)[0]["render"]
    c["property_boundary"]["a"] = [float("nan"), 0]
    assert not reviewed_outcrops(c, 10, 9)[0]["render"]


def test_concave_parcel_does_not_allow_an_edge_to_jump_across_public_space():
    boundary = controls()["property_boundary"]
    boundary["ring"] = [[-1, -3], [11, -3], [11, 1], [6, 1], [6, 0.2], [4, 0.2], [4, 1], [-1, 1]]
    assert not within_property(profile("box_bay", 2, 6, 0.7), boundary)
    assert contains([5, 0.1], boundary["ring"]) and not contains([5, 0.8], boundary["ring"])


def test_window_triplets_are_only_review_candidates_never_random_projections():
    windows = [
        {"id": str(i), "kind": "window", "u": u, "v": 3, "w": w, "h": 1.5}
        for i, (u, w) in enumerate([(1, 0.5), (2, 2), (4.5, 0.5)])
    ]
    candidates = infer_candidates(windows, "image")
    assert len(candidates) == 1 and not candidates[0]["render"] and candidates[0]["depth_m"] is None
    assert candidates[0]["image_sha256"] == "image"
