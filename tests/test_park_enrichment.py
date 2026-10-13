from copy import deepcopy

from smc.parks.enrichment import build_enrichment, canonical_hash
from smc.parks.inventory import build_inventory


def polygon(x=0, width=0.0001):
    return {
        "type": "Polygon",
        "coordinates": [[[x, 0], [x + width, 0], [x + width, 0.0001], [x, 0.0001], [x, 0]]],
    }


def world():
    return {
        "bbox": {"west": -0.001, "south": -0.001, "east": 0.001, "north": 0.001},
        "ways": [
            {
                "kind": "building",
                "osm_id": 10,
                "height_m": 3.4,
                "points": polygon()["coordinates"][0],
            }
        ],
    }


def inventory(kind="Restroom", geom=None):
    return build_inventory(
        [{"property_id": "1", "shape": polygon()}],
        [
            {
                "facility_id": "2",
                "objectid": "part",
                "property_id": "1",
                "facility_type": kind,
                "shape": geom or polygon(),
            }
        ],
        [],
    )


def test_park_annotation_preserves_canonical_geometry_and_height():
    source = world()
    previous = deepcopy(source)
    out = build_enrichment(inventory(), source)
    assert source == previous
    assert out["canonical_geometry_sha256"] == canonical_hash(previous)
    assert out["objects"][0]["render"] == "canonical_building_style"
    assert out["objects"][0]["canonical_building_id"] == "10"
    assert out["objects"][0]["role"] == "public_restroom"
    assert out["objects"][0]["surface_material"] == "unknown"


def test_restroom_room_cannot_replace_the_whole_clubhouse():
    out = build_enrichment(inventory(geom=polygon(width=0.000025)), world())
    assert out["objects"][0]["render"] == "canonical_building_amenity"


def test_unmatched_shed_uses_inventory_geometry_not_random_location():
    geom = polygon(x=0.0003)
    out = build_enrichment(inventory("Maintenance Building", geom), world())
    obj = out["objects"][0]
    assert obj["render"] == "inventory_structure"
    assert obj["polygon"] == geom["coordinates"]
    assert obj["height_basis"] == "visual_type_prior_not_measured"


def test_ambiguous_overlap_is_reviewed_not_used_as_house_style():
    source = world()
    source["ways"].append({**source["ways"][0], "osm_id": 11})
    out = build_enrichment(inventory(), source)
    assert out["objects"][0]["render"] == "semantic_only"
    assert out["review"][0]["reason"] == "ambiguous_building_overlap"


def test_page_semantics_never_invent_missing_objects_or_coordinates():
    out = build_enrichment(inventory(), world(), {"rpd:park:1": {"features": ["benches"]}})
    assert len(out["objects"]) == 1
    assert out["parks"][0]["page_evidence"]["features"] == ["benches"]
