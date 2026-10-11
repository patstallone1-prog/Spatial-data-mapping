import copy
import runpy
from pathlib import Path

import pytest

from scripts.audit_frontage_sources import audit_region, cell_diagnostics, geometry_hash
from smc.imagery.research_datasets import (
    correspondence_groups,
    parse_city_patch,
    parse_sf_xl_path,
)

ROOT = Path(__file__).resolve().parents[1]


def test_city_metadata_preserves_target_partners_without_inventing_time_or_truth():
    text = "d 1 2 3 4 37.79 -122.41 20 1 0 0 37.79 -122.4101 10 8 90 0 0"
    first = parse_city_patch(text, "patch.jpg")
    second = parse_city_patch(text.replace("d 1 2 3 4", "d 1 2 5 6"), "partner.jpg")
    groups = correspondence_groups([first, second])
    assert len(groups["1:2"]) == 2
    assert first["panorama_id"] != second["panorama_id"]
    assert first["captured_at"] is None and first["vertical_datum"] == "unknown"
    assert not first["production_eligible"]
    assert "manual" in first["geometry_basis"]
    with pytest.raises(ValueError):
        parse_city_patch(text + "\na 1 2", "partial.txt")
    with pytest.raises(ValueError):
        parse_city_patch(text.replace("20", "nan"), "corrupt.txt")


def test_sf_xl_crs_time_and_panorama_identity_are_not_guessed_from_coordinates():
    locator = "@551234@4181234@a@b@c@d@e@f@90@.jpg"
    row = parse_sf_xl_path(locator)
    assert row["utm_easting"] == 551234 and row["heading_deg"] == 90
    assert row["panorama_id"] is None and row["captured_at"] is None
    assert row["horizontal_crs"] == "unknown" and not row["production_eligible"]
    known = parse_sf_xl_path(locator, panorama_id="p")
    assert "not_independent" in known["independent_camera_status"]
    with pytest.raises(ValueError):
        parse_sf_xl_path("@551234@4181234@.jpg")


def test_storefront_names_survive_old_four_name_cap_and_preserve_geometry():
    namespace = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
    building = {"kind": "building", "osm_id": 1, "archetype": "retail", "height_m": 9,
                "points": [[-122, 37], [-121.9999, 37], [-121.9999, 37.0001],
                           [-122, 37.0001], [-122, 37]], "centroid": [-121.99995, 37.00005],
                "shops": [{"n": "Original", "t": "books"}]}
    payload = {"bbox": {"west": -122, "east": -121.999, "south": 37, "north": 37.001},
               "ways": [building]}
    source = [{"osm_id": 1, "overture_places": [
        {"name": f"Shop {i}", "category": "bakery", "confidence": 0.95,
         "licence": "CDLA-Permissive-2.0"} for i in range(6)] + [
        {"name": "Uncertain", "category": "cafe", "confidence": 0.55,
         "licence": "CDLA-Permissive-2.0"}]}]
    original = copy.deepcopy(payload)
    audit = audit_region(payload, source, "fixture", namespace)
    assert audit["counts"]["names"] == 7
    assert audit["counts"]["withheld_low_confidence_or_rights_unknown_places"] == 1
    assert audit["buildings"]["1"]["shops"][0]["n"] == "Original"
    assert payload == original
    assert audit["canonical_geometry_sha256"] == geometry_hash(payload["ways"])
    assert not audit["automatically_publishes"]


def test_name_audit_catches_accidental_canonical_mutation():
    payload = {"bbox": {"west": 0, "east": 1, "south": 0, "north": 1},
               "ways": [{"kind": "building", "osm_id": 1, "height_m": 4}]}

    def wrong(ways):
        ways[0]["height_m"] = 10

    with pytest.raises(ValueError, match="canonical"):
        audit_region(payload, [], "fixture", {"attach_shopfronts": wrong,
                                              "attach_named_places": lambda _: None})


def test_cell_review_uses_latest_world_and_does_not_claim_reference_accuracy():
    audit = {"region": "sf", "source_world_sha256": "current",
             "audit_cells_250m_not_official_blocks": {"0:0": ["1", "2"]}}
    fit = {"region": "sf", "building_id": "1", "world_sha256": "current",
           "height_m": 9, "certainty": {"tier": "low", "reasons": ["material_unresolved"]},
           "openings": [{"kind": "window", "v": 8, "h": 2}]}
    result = cell_diagnostics(audit, {"1": fit, "2": {**fit, "world_sha256": "old"}})
    assert result["stale_world_fits_excluded"] == 1
    assert result["systematic_review_signals"]["opening_reaches_prior_roof_envelope"] == 1
    assert not result["reference_mesh_comparison_completed"]
