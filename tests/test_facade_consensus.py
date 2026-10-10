from copy import deepcopy

from smc.facades.consensus import certainty, cross_view, neighbourhood_reference, strict_view_gate


def view():
    return {
        "image_sha256": "a",
        "a": [-122, 37],
        "b": [-122.0001, 37],
        "width_m": 9,
        "height_m": 6,
        "openings": [{"id": "w", "kind": "window", "u": 1, "v": 4, "w": 1, "h": 1}],
    }


def test_strict_full_front_both_edge_and_centre_not_just_ninety_percent():
    c = {"geometry_pass": True, "angle_deg": 10, "edge_angle_deg": 36, "full_front_in_frame": True}
    assert not strict_view_gate(c)["metadata_pass"]
    c["edge_angle_deg"] = 30
    assert strict_view_gate(c)["metadata_pass"] and not strict_view_gate(c)["pass"]
    c.update(verified=True, review={"full_front_visible": True})
    assert strict_view_gate(c, reviewed_storeys=2)["pass"]
    assert not strict_view_gate(c, reviewed_storeys=1)["pass"]


def test_duplicate_pixels_not_independent_and_different_front_not_corroboration():
    a = view()
    b = deepcopy(a)
    assert cross_view(a, [a, b])["distinct_pixel_views"] == 1
    b["image_sha256"] = "b"
    b["a"][0] += 0.001
    assert cross_view(a, [a, b])["same_front_comparison_views"] == 0


def test_real_multiview_conflict_flags_without_mutating_geometry():
    a = view()
    b = deepcopy(a)
    b["image_sha256"] = "b"
    b["openings"][0]["u"] += 0.4
    c = cross_view(a, [a, b])
    assert not c["openings"][0]["comparisons"][0]["consistent"]
    a.update(
        multiview=c,
        appearance={"material": "stucco_render"},
        review_status="reviewed_inferred_visual_parameters",
    )
    assert "cross_view_conflict" in certainty(a, {"pass": True})["reasons"]
    assert a["openings"][0]["u"] == 1


def test_neighbour_entrance_prior_never_overwrites_unusual_dimensions():
    a = view()
    a["building_id"] = "one"
    a["openings"][0].update(kind="door", w=0.8, h=2.1)
    b = deepcopy(a)
    b["building_id"] = "two"
    b["a"][0] += 0.0002
    b["openings"][0]["w"] = 2
    before = deepcopy(a)
    result = neighbourhood_reference(a, [a, b])
    assert len(result["comparisons"]) == 1 and not result["geometry_modified"]
    assert a == before and result["comparisons"][0]["width_difference_m"] == 1.2


def test_reviewed_type_can_be_high_visual_but_never_metric_certified():
    a = view()
    a.update(
        appearance={"material": "stucco_render"},
        review_status="reviewed_inferred_visual_parameters",
    )
    a["openings"][0].update(kind="gated_entry_candidate", v=0, type_requires_review=True)
    assert certainty(a, {"pass": True})["tier"] == "low"
    a["openings"][0]["type_reviewed"] = True
    result = certainty(a, {"pass": True})
    assert result["tier"] == "high" and result["calibrated_probability"] is None


def test_review_checkbox_cannot_certify_a_stale_front_plane_or_inward_normal():
    a = view()
    a.update(appearance={"material": "stucco_render"},
             review_status="reviewed_inferred_visual_parameters",
             front_geometry_binding={"status": "unbound_or_normal_conflict"})
    result = certainty(a, {"pass": True})
    assert result["tier"] == "low"
    assert "photo_front_not_bound_to_current_canonical_geometry" in result["reasons"]
    assert a["openings"][0]["u"] == 1
