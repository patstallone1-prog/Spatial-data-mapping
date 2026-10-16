import copy
import json
from urllib.parse import parse_qs, urlparse

import pytest

from smc.official.berkeley import fetch_layer, merge_sidecar, normalize_ramps


def inventory():
    return {
        "features": [
            {
                "id": 4,
                "properties": {"OBJECTID": 4, "RAMP_TYPE": "APEX"},
                "geometry": {"type": "Point", "coordinates": [-122.26, 37.87]},
            }
        ],
        "bbox_s_w_n_e": [37.865, -122.275, 37.88, -122.255],
        "source": "city-layer",
        "sha256": "hash",
        "retrieved_at": "2026-10-15",
    }


def test_merging_retains_other_sources_and_is_idempotent():
    original = {
        "curb_lines": [{"p": [[0, 0], [1, 0]]}],
        "curb_ramps": [{"id": "osm:1", "p": [-122.261, 37.87]}],
        "other": {"preserve": True},
    }
    frozen = copy.deepcopy(original)
    merged = merge_sidecar(original, inventory())
    assert original == frozen
    assert merge_sidecar(merged, inventory()) == merged
    assert len(merged["curb_ramps"]) == 2
    assert merged["curb_lines"] == original["curb_lines"]
    assert merged["other"] == original["other"]
    assert not merged["curb_ramps"][-1]["accessibility_verified"]
    assert merged["curb_ramps"][-1]["observed_at"] is None


def test_missing_page_is_an_error_not_empty_success():
    def fetch(url):
        q = parse_qs(urlparse(url).query)
        if "returnIdsOnly" in q:
            return {"objectIds": [4, 5]}
        return {"features": inventory()["features"]}

    with pytest.raises(ValueError, match="truncated"):
        fetch_layer("curb_ramps", inventory()["bbox_s_w_n_e"], fetch)


def test_absent_and_undocumented_ramp_types_are_not_rendered():
    for kind in ("NONE", "X", None):
        data = inventory()
        data["features"][0]["properties"]["RAMP_TYPE"] = kind
        assert normalize_ramps(data) == []


def test_small_query_envelope_overreach_is_clipped_not_misdiagnosed_as_crs_error():
    data = inventory()
    data["features"][0]["geometry"]["coordinates"] = [-122.27507, 37.87]
    assert normalize_ramps(data) == []


def test_wrong_crs_and_wrong_geometry_rejected():
    data = inventory()
    data["features"][0]["geometry"]["coordinates"] = [562000, 4192000]
    with pytest.raises(ValueError, match="CRS"):
        normalize_ramps(data)
    data["features"][0]["geometry"]["type"] = "LineString"
    with pytest.raises(ValueError, match="not a point"):
        normalize_ramps(data)


def test_inventory_reads_all_ids_with_explicit_output_crs():
    calls = []

    def fetch(url):
        q = parse_qs(urlparse(url).query)
        calls.append(q)
        if "returnIdsOnly" in q:
            return {"objectIds": [4]}
        assert q["outSR"] == ["4326"]
        return {"features": inventory()["features"]}

    result = fetch_layer("curb_ramps", inventory()["bbox_s_w_n_e"], fetch)
    assert len(result["features"]) == 1
    assert len(result["sha256"]) == 64
    assert len(calls) == 2
    json.dumps(result, allow_nan=False)
