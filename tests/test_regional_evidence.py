import copy
from urllib.parse import parse_qs, urlparse

import pytest

from smc.official.regional_evidence import fetch_inventory


def request_fixture(*, missing=False, bad_crs=False, edited=False):
    metadata = {"objectIdField": "OBJECTID", "editingInfo": {"lastEditDate": 1}}
    calls = []

    def fetch(url):
        q = parse_qs(urlparse(url).query)
        calls.append(q)
        if "/query" not in url:
            out = copy.deepcopy(metadata)
            if edited and len(calls) > 1:
                out["editingInfo"]["lastEditDate"] = 2
            return out
        if "returnIdsOnly" in q:
            return {"objectIds": [1, 2]}
        assert q["outSR"] == ["4326"]
        return {"features": [{"id": i, "properties": {"OBJECTID": i},
                              "geometry": {"type": "LineString", "coordinates":
                                           [[6000000 if bad_crs else -122, 37], [-122, 38]]}}
                             for i in ([1] if missing else [1, 2])]}
    return fetch


def test_complete_attributed_reference_is_not_promoted():
    result = fetch_inventory({"url": "https://city.test/0"}, [37, -123, 38, -121], request_fixture())
    assert len(result["features"]) == 2
    assert len(result["sha256"]) == 64
    assert not result["publishable_as_measured"]
    assert result["geometry_accuracy_m"] is None


@pytest.mark.parametrize("option,match", [("missing", "missing"), ("bad_crs", "CRS"), ("edited", "changed")])
def test_partial_wrong_crs_and_mutating_sources_fail_closed(option, match):
    with pytest.raises(ValueError, match=match):
        fetch_inventory({"url": "https://city.test/0"}, [37, -123, 38, -121],
                        request_fixture(**{option: True}))


def test_historic_curb_inventory_is_bounded_and_not_promoted_as_current_survey():
    def fetch(url):
        if "api/views" in url:
            return {"rowsUpdatedAt": 1}
        q = parse_qs(urlparse(url).query)
        assert "intersects(the_geom" in q["$where"][0]
        if "$select" in q:
            return [{"n": "1"}]
        return [{"the_geom": {"type": "LineString", "coordinates": [[-122, 37], [-122, 38]]},
                 "space_reg": "historic"}]
    result = fetch_inventory({"url": "https://data.oaklandca.gov/resource/87ce-u2wf.json",
                              "api": "socrata"}, [37, -123, 38, -121], fetch)
    assert len(result["features"]) == 1
    assert not result["publishable_as_measured"]
