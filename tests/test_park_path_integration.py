from copy import deepcopy

import pytest

from smc.geo import Origin
from smc.parks.paths import annotate_paths


def world(kind="path"):
    return {"ways": [{"kind": kind, "osm_id": 1, "points": [[0, 0], [0.0002, 0]]}]}


def test_highway_never_substitutes_for_material_in_consumed_paths():
    for kind in ("path", "sidewalk"):
        out, _ = annotate_paths(world(kind), [])
        assert out["1"]["resolved"]["surface_material"] == "unknown"


def test_osm_material_and_width_flow_to_consumer_without_geometry_mutation():
    source = world()
    original = deepcopy(source)
    out, _ = annotate_paths(
        source,
        [],
        {"ways": {"1": {"tags": {"surface": "compacted", "width": "1.8", "highway": "footway"}}}},
    )
    assert source == original
    assert out["1"]["width_m"] == 1.8
    assert out["1"]["runs"][0]["resolved"]["surface_material"] == "compacted"


def test_reviewed_material_transition_keeps_join_exact_and_rejects_stale_review():
    source = world()
    length = 0.0002 * Origin(0, 0).metres_per_degree_lon
    evidence = {
        "basis": "imagery_multiview",
        "material": "earth",
        "source_id": "review:1",
        "confidence": 0.85,
        "reviewed": True,
        "independent_sequences": ["s1", "s2"],
    }
    reviews = {
        "1": [
            {
                "range_m": [length / 2, length],
                "evidence": evidence,
                "canonical_points": source["ways"][0]["points"],
            }
        ]
    }
    out, _ = annotate_paths(source, [], {"ways": {"1": {"tags": {"surface": "concrete"}}}}, reviews)
    runs = out["1"]["runs"]
    # OSM wins but the conflict remains available for review.
    assert runs[0]["points"][-1] == runs[1]["points"][0]
    assert runs[1]["resolved"]["conflicts"][0]["source_id"] == "review:1"
    reviews["1"][0]["canonical_points"] = [[1, 1], [2, 2]]
    _, rejected = annotate_paths(source, [], {}, reviews)
    assert rejected == [{"id": "1", "reason": "review_geometry_version_mismatch"}]


def test_explicit_asphalt_beats_beach_context_and_context_is_weak():
    source = world()
    park = {
        "id": "p",
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [
                    [-0.001, -0.001],
                    [0.001, -0.001],
                    [0.001, 0.001],
                    [-0.001, 0.001],
                    [-0.001, -0.001],
                ]
            ],
        },
    }
    beach = {
        "tags": {"natural": "beach"},
        "geometry": [{"lon": p[0], "lat": p[1]} for p in park["geometry"]["coordinates"][0]],
    }
    out, _ = annotate_paths(source, [park], {"contexts": [beach]})
    assert out["1"]["resolved"]["surface_material"] == "sand"
    assert out["1"]["resolved"]["confidence"] <= 0.45
    out, _ = annotate_paths(
        source, [park], {"contexts": [beach], "ways": {"1": {"tags": {"surface": "asphalt"}}}}
    )
    assert out["1"]["resolved"]["surface_material"] == "asphalt"


def test_invalid_intervals_fail_build_instead_of_silently_writing_wrong_path():
    source = world()
    with pytest.raises(ValueError, match="outside canonical path"):
        annotate_paths(
            source,
            [],
            {},
            {
                "1": [
                    {
                        "canonical_points": source["ways"][0]["points"],
                        "range_m": [0, 1000],
                        "evidence": {
                            "material": "earth",
                            "basis": "official_rpd",
                            "source_id": "rpd:asbuilt",
                            "confidence": 0.95,
                        },
                    }
                ]
            },
        )
