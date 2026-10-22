"""A neighbourhood's unfitted houses and restaurants, nearest the anchor first."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_focus_list_is_the_neighbourhoods_houses_and_restaurants_nearest_first() -> None:
    focus = _load("request_frontage_focus", "scripts/request_frontage_focus.py")
    marina = {"analysis_neighborhood": "Marina"}

    def way(i, lon, land_use=None, shops=None, parcel=marina):
        return {"kind": "building", "osm_id": i, "centroid": [lon, 37.80], "land_use": land_use,
                "shops": shops or [], "parcel": parcel, "address": {"formatted": f"{i} Francisco"}}
    ways = [way(1, -122.4300, "RESIDENTIAL- HOUSE, THREE FAMILY"),
            way(2, -122.4310, "NEIGHBORHOOD COMMERCIAL", [{"n": "A", "t": "restaurant"}]),
            way(3, -122.4295, "RESIDENTIAL- HOUSE, ONE FAMILY"),
            way(4, -122.4301, "RESIDENTIAL- HOUSE, ONE FAMILY"),             # fitted already
            way(5, -122.4302, "NEIGHBORHOOD COMMERCIAL", [{"n": "B", "t": "salon"}]),
            way(6, -122.4303, "RESIDENTIAL- HOUSE, ONE FAMILY", parcel={"analysis_neighborhood": "Presidio"})]
    rows = focus.focus_list(ways, "Marina", (-122.4300, 37.80), {"4"}, "sf-corridor")
    assert [r["building_id"] for r in rows] == ["1", "3", "2"]
    assert [r["kind"] for r in rows] == ["house", "house", "restaurant"]


def test_the_filter_reads_the_request_and_ignores_a_missing_or_broken_one(tmp_path) -> None:
    import sys
    sys.path.insert(0, str(ROOT / "src"))
    source = (ROOT / "scripts/filter_frontage_photos.py").read_text()
    start = source.index("def focus_order(")
    namespace = {"json": json, "Path": Path, "FOCUS_REQUEST": tmp_path / "none.json"}
    exec(source[start:source.index("\n\n\n", start)], namespace)
    order = namespace["focus_order"]
    assert order(tmp_path / "none.json") == {}
    (tmp_path / "bad.json").write_text("{")
    assert order(tmp_path / "bad.json") == {}
    (tmp_path / "ok.json").write_text(json.dumps({"buildings": [{"region": "sf-corridor", "building_id": 263276308},
                                                                {"region": "sf-corridor", "building_id": "7"}]}))
    assert order(tmp_path / "ok.json") == {("sf-corridor", "263276308"): 0, ("sf-corridor", "7"): 1}
    assert "batch = fair_batch(pending, records, args.sample, focus)" in source
