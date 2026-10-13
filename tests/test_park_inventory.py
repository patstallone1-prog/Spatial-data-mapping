import pytest

from smc.parks.inventory import build_inventory


def test_publisher_ids_link_park_facility_and_area_without_inventing_material_or_access():
    result = build_inventory(
        [{"property_id": "p1", "property_name": "Moscone"}],
        [{"facility_id": "f1", "property_id": "p1", "facility_type": "Restroom"}],
        [{"funcarea_id": "a1", "facility_id": "f1", "property_id": "p1",
          "functional_area_type": "Path"}],
    )
    assert result["parks"][0]["children"] == ["rpd:facility:p1:f1", "rpd:functional_area:p1:a1"]
    restroom, path = result["objects"]
    assert restroom["children"] == ["rpd:functional_area:p1:a1"]
    assert restroom["kind"] == "Restroom"
    assert path["surface_material"] == "unknown"
    assert path["accessibility"]["status"] == "unknown"
    assert not path["geometry"]
    assert path["geometry_confidence"] == 0


def test_missing_parent_is_reported_not_attached_to_nearest_named_park():
    result = build_inventory([], [{"facility_id": "f1", "property_id": "missing"}], [])
    assert result["unresolved"] == [{"id": "rpd:facility:missing:f1", "reason": "park_identity_not_in_snapshot"}]
    assert len(result["objects"]) == 1


def test_duplicate_facility_identity_fails_before_overwriting_an_object():
    with pytest.raises(ValueError, match="duplicate"):
        build_inventory([], [{"facility_id": "f1"}, {"facility_id": "f1"}], [])


def test_distinct_gis_parts_share_logical_facility_but_retain_geometry_and_dates():
    square = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    result = build_inventory([{"property_id": "p1"}], [
        {"facility_id": "f1", "objectid": "row1", "property_id": "p1",
         "facility_type": "Landscaped Area", "shape": square, "data_as_of": "2025-01-01"},
        {"facility_id": "f1", "objectid": "row2", "property_id": "p1",
         "facility_type": "Landscaped Area", "shape": square, "data_as_of": "2026-01-01"},
    ], [])
    facility = result["objects"][0]
    assert len(facility["parts"]) == 2
    assert facility["parts"][1]["provenance"]["data_as_of"] == "2026-01-01"
    assert len(facility["geometry"]["coordinates"]) == 2
    assert result["parks"][0]["children"] == ["rpd:facility:p1:f1"]


def test_legacy_facility_ids_reused_in_different_parks_never_cross_attach():
    result = build_inventory([{"property_id": "p1"}, {"property_id": "p2"}], [
        {"facility_id": "same", "property_id": "p1"},
        {"facility_id": "same", "property_id": "p2"},
    ], [])
    assert len(result["objects"]) == 2
    assert result["parks"][0]["children"] != result["parks"][1]["children"]
    assert not result["unresolved"]
