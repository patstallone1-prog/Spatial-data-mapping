from __future__ import annotations

import pytest

from smc.parks.surfaces import (
    SurfaceEvidence,
    _capture_time,
    contextual_surface,
    normalize_material,
    osm_surface,
    resolve_surface,
    split_path_surfaces,
)


@pytest.mark.parametrize("highway", ["footway", "path", "steps", "pedestrian"])
def test_highway_category_alone_never_claims_a_material(highway):
    assert resolve_surface([], highway=highway)["surface_class"] == "unknown"
    assert osm_surface({"highway": highway}, "osm:way:1") is None


@pytest.mark.parametrize(("material", "expected"), [
    ("asphalt", "paved"), ("decomposed granite", "improved_unpaved"),
    ("wood", "boardwalk"), ("sand", "natural"), ("mud", "natural"),
    ("asphalt;gravel", "unknown"), ("unpaved", "unknown"),
])
def test_material_taxonomy_retains_specific_truth(material, expected):
    assert normalize_material(material)[0] == expected


def test_completed_official_spec_wins_but_retains_conflicting_osm_and_photo_evidence():
    result = resolve_surface([
        SurfaceEvidence("gravel", "osm_surface", "osm:way:1", .85),
        SurfaceEvidence("dirt", "imagery_single", "photo:1", .75, reviewed=True),
        SurfaceEvidence("asphalt", "official_rpd", "rpd:project:1", .95,
                        project_state="completed"),
    ])
    assert result["surface_material"] == "asphalt"
    assert len(result["conflicts"]) == 2
    assert not result["geometry_changed"]


@pytest.mark.parametrize("status", ["proposed", "approved", "under_construction", "unknown"])
def test_planned_project_never_becomes_current_surface(status):
    result = resolve_surface([
        SurfaceEvidence("asphalt", "official_rpd", "rpd:project:1", .95, project_state=status),
        SurfaceEvidence("earth", "osm_surface", "osm:way:1", .85),
    ])
    assert result["surface_material"] == "earth"
    assert result["rejected"][0]["reason"] == "project_not_current"


def test_same_sequence_does_not_count_as_independent_multiview():
    result = resolve_surface([SurfaceEvidence(
        "concrete", "imagery_multiview", "photos:1", .99, reviewed=True,
        independent_sequences=("drive:1", "drive:1"))])
    assert result["basis"] == "imagery_single"
    assert result["confidence"] == .75


def test_unreviewed_image_predictions_remain_unpromoted():
    result = resolve_surface([SurfaceEvidence("concrete", "imagery_single", "photo:1", .99)])
    assert result["surface_class"] == "unknown"
    assert result["rejected"][0]["reason"] == "imagery_not_reviewed"


def test_beach_context_is_weak_and_cannot_paint_an_explicit_concrete_path_as_sand():
    guess = contextual_surface(source_id="context:beach:1", beach_distance_m=10)
    assert guess and guess.material == "sand" and guess.confidence <= .45
    result = resolve_surface([guess, SurfaceEvidence("concrete", "osm_surface", "osm:way:1", .85)])
    assert result["surface_material"] == "concrete"
    assert result["conflicts"][0]["surface_material"] == "sand"
    assert contextual_surface(source_id="mixed", beach_distance_m=10, forest=True) is None


def test_surface_transition_retains_canonical_bends_and_shared_seam_without_filling_unknown_gap():
    points = [[0., 0., 1.], [5., 0., 2.], [5., 5., 4.]]
    asphalt = SurfaceEvidence("asphalt", "osm_surface", "osm:way:1", .85)
    earth = SurfaceEvidence("earth", "imagery_single", "photo:1", .75, reviewed=True)
    result = split_path_surfaces(points, [(0., 3., asphalt), (7., 10., earth)], canonical_id="way:1")
    assert [part["surface_material"] for part in result] == ["asphalt", "unknown", "earth"]
    assert result[1]["points"] == [[3., 0., 1.6], [5., 0., 2.], [5., 2., 2.8]]
    assert result[0]["points"][-1] == result[1]["points"][0]
    assert result[1]["points"][-1] == result[2]["points"][0]
    assert all(not part["geometry_changed"] for part in result)
    assert points == [[0., 0., 1.], [5., 0., 2.], [5., 5., 4.]]


def test_surface_transition_cannot_extend_or_reverse_the_canonical_path():
    with pytest.raises(ValueError, match="outside"):
        split_path_surfaces([[0., 0.], [2., 0.]], [(0., 3., SurfaceEvidence(
            "earth", "context", "context:1", .35))], canonical_id="way:1")


def test_calendar_timestamp_ranking_does_not_depend_on_the_build_machines_timezone():
    assert _capture_time({"observed_at": "2026-10-12T00:00:00"}) == _capture_time(
        {"observed_at": "2026-10-12T00:00:00Z"})
