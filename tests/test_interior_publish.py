"""Accepted engine interiors replace a house's fitted plan, and only accepted ones."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _engine():
    pytest.importorskip("shapely")
    spec = importlib.util.spec_from_file_location("run_interior_engine", ROOT / "scripts/run_interior_engine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _batch(folder: Path, houses: dict[str, dict]) -> None:
    folder.mkdir(parents=True)
    records, refs = [], {}
    for osm_id, house in houses.items():
        (folder / f"osm-{osm_id}.json").write_text(json.dumps(house))
        records.append({"id": f"osm-{osm_id}", "file": f"osm-{osm_id}.json", "passed": house["validation"]["passed"]})
        if house["validation"]["passed"]:
            refs[osm_id] = {"file": f"osm-{osm_id}.json", "origin_lon_lat": [-122.4, 37.8]}
    (folder / "manifest.json").write_text(json.dumps({"houses": records}))
    (folder / "map-overlay.json").write_text(json.dumps({"buildings": refs}))


def test_publishing_adds_accepted_houses_and_replaces_an_earlier_one(tmp_path) -> None:
    engine = _engine()
    site, out = tmp_path / "site", tmp_path / "build"
    site.mkdir()
    (site / "map-overlay.json").write_text(json.dumps({"buildings": {
        "1": {"file": "osm-1.json", "origin_lon_lat": [0, 0]}, "9": {"file": "osm-9.json", "origin_lon_lat": [0, 0]}}}))
    good = {"grade": "inferred", "validation": {"passed": True}}
    _batch(out / "sf-sunset/batch-000", {"1": {**good, "v": 2}, "2": good,
                                         "3": {"grade": "inferred", "validation": {"passed": False}}})
    assert engine.publish(out, site) == 2
    overlay = json.loads((site / "map-overlay.json").read_text())["buildings"]
    assert overlay["1"]["file"] == "houses/sf-sunset/osm-1.json"     # accepted again: the new one
    assert overlay["2"]["file"] == "houses/sf-sunset/osm-2.json"
    assert overlay["9"]["file"] == "osm-9.json"                      # not re-run: kept
    assert "3" not in overlay and not (site / "houses/sf-sunset/osm-3.json").exists()
    assert engine.publish(out, site) == 0                            # nothing new the second time


def test_the_map_furnishes_accepted_houses_by_default_except_in_the_headset() -> None:
    from tests.test_corridor_geometry_rules import _extract, _page_js
    gate = _extract("requestGeneratedInteriors", _page_js())
    assert 'if (HEADSET || new URLSearchParams(location.search).get("inferredInteriors") === "0") return;' in gate


def test_a_generated_interior_taken_down_can_be_requested_again() -> None:
    from tests.test_corridor_geometry_rules import _extract, _page_js
    request = _extract("requestGeneratedInterior", _page_js())
    assert "}).finally(() => {" in request and "entry.generatedInteriorPending = false;" in request


def test_a_homes_batch_goes_into_the_store_gzipped_with_its_overlay_tile(tmp_path) -> None:
    import gzip

    from smc.cloud.store import LocalStore
    engine = _engine()
    out, store = tmp_path / "build", LocalStore(tmp_path / "store")
    good = {"grade": "inferred", "validation": {"passed": True}}
    _batch(out / "sf-sunset/batch-000", {"1": good, "2": good,
                                         "3": {"grade": "inferred", "validation": {"passed": False}}})
    (out / "sf-sunset/batch-000/run.log").write_text("PASS\n")
    assert engine.publish_to_store(out / "sf-sunset/batch-000", store, out) == 2
    house = json.loads(gzip.decompress(store.get("interiors/houses/sf-sunset/osm-1.json")))
    assert house == good and store.meta("interiors/houses/sf-sunset/osm-1.json")["content_encoding"] == "gzip"
    key = engine.tile_key(-122.4, 37.8)
    tile = json.loads(gzip.decompress(store.get(f"interiors/overlay/{key}.json")))
    assert set(tile["buildings"]) == {"1", "2"}
    assert tile["buildings"]["1"]["file"] == "interiors/houses/sf-sunset/osm-1.json"
    index = json.loads(gzip.decompress(store.get("interiors/overlay/index.json")))
    assert index["tile_deg"] == engine.TILE_DEG and index["tiles"] == {key: 2}
    # Only the batch's record stays on disk, and a second publish puts nothing in again.
    assert sorted(p.name for p in (out / "sf-sunset/batch-000").iterdir()) == [
        "manifest.json", "map-overlay.json", "run.log", "store.json"]
    assert engine.publish_to_store(out / "sf-sunset/batch-000", store, out) == 0
    # A later batch in the same square adds to its tile, not replaces it.
    _batch(out / "sf-sunset/batch-001", {"4": good})
    engine.publish_to_store(out / "sf-sunset/batch-001", store, out)
    tile = json.loads(gzip.decompress(store.get(f"interiors/overlay/{key}.json")))
    assert set(tile["buildings"]) == {"1", "2", "4"}


def test_homes_take_buildings_mapped_yes_and_the_selection_is_frozen(tmp_path, monkeypatch) -> None:
    engine = _engine()
    def way(osm_id, building, **kw):
        s = 0.0001
        x, y = -122.5 + osm_id * 0.001, 37.75
        pts = [[x, y], [x + s * 1.2, y], [x + s * 1.2, y + s], [x, y + s], [x, y]]   # about 117 m2
        return {"kind": "building", "osm_id": osm_id, "tags": {"building": building}, "points": pts,
                "centroid": [x + s * 0.6, y + s * 0.5], "height_m": 7, **kw}
    ways = [way(1, "house"), way(2, "yes"), way(3, "terrace"), way(4, "yes", archetype="commercial"),
            way(5, "yes", height_m=20), way(6, "apartments"), way(7, "yes")]
    base = tmp_path / "region"
    base.mkdir()
    (base / "sf-corridor-3d.json").write_text(json.dumps({"ways": ways}))
    (base / "sf-corridor-interiors.json").write_text(json.dumps({"buildings": {}}))
    site = tmp_path / "site"
    site.mkdir()
    (site / "map-overlay.json").write_text(json.dumps({"buildings": {"7": {}}}))
    monkeypatch.setattr(engine, "region_base", lambda region: base)
    monkeypatch.setattr(engine, "PUBLISHED", site)
    assert {r["osm_id"] for r in engine.eligible("x")} == {"1"}
    rows = engine.home_selection("x", tmp_path / "out")
    assert {r["osm_id"] for r in rows} == {"1", "2", "3"}       # 7 is furnished by the site already
    (base / "sf-corridor-3d.json").write_text(json.dumps({"ways": []}))
    assert engine.home_selection("x", tmp_path / "out") == json.loads(json.dumps(rows))  # frozen


def test_an_outside_door_on_a_party_wall_is_found() -> None:
    spec = importlib.util.spec_from_file_location("build_inferred_interiors", ROOT / "scripts/build_inferred_interiors.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    def door(x0, y0, x1, y1, i):
        return {"id": f"d{i}", "rooms": ["r", "outside"],
                "segment": {"type": "LineString", "coordinates": [[x0, y0], [x1, y1]]}}
    house = {"envelope": {"party_walls": [{"edge": 1, "a": [0, 0], "b": [10, 0], "u0": 0, "u1": 10}]},
             "storeys": [{"openings": [door(4, 0, 5, 0, 1), door(0, 5, 0, 6, 2),
                                       {"id": "inner", "rooms": ["r", "s"], "segment": None}]}]}
    assert module.party_wall_conflicts(house) == ["d1"]


def test_the_page_reads_only_this_stores_house_files_and_keeps_the_sites_own() -> None:
    import re

    from tests.test_corridor_geometry_rules import _extract, _page_js
    page = _page_js()
    pattern = re.compile(re.search(r"const STORE_HOUSE_FILE = /(.+)/;", page).group(1).replace("\\\\", "\\"))
    assert pattern.match("interiors/houses/sf-sunset/osm-12.json")
    for foreign in ("https://x.invalid/interiors/houses/a/osm-1.json", "interiors/houses/../a/osm-1.json",
                    "interiors/houses/a/osm-1.json?x=1", "/interiors/houses/a/osm-1.json"):
        assert not pattern.match(foreign), foreign
    store = _extract("requestStoreInteriors", page)
    assert "entry.generatedInteriorRef ||" in store and "fileBase: store" in store
    assert "ref.fileBase || ref.base" in _extract("requestGeneratedInterior", page)


def test_a_front_door_never_stands_on_a_party_wall_while_another_wall_will_take_it() -> None:
    from tests.test_corridor_geometry_rules import _extract, _page_js
    spot = _extract("frontDoorSpot", _page_js())
    assert "const open = long.filter((w) => !partyWall(feature, w));" in spot
    assert "walls !== open || !partyWall(feature, best)" in spot


def test_a_tile_another_run_wrote_keeps_its_houses_when_this_run_adds_to_it(tmp_path) -> None:
    import gzip

    from smc.cloud.store import LocalStore
    engine = _engine()
    store = LocalStore(tmp_path / "store")
    key = engine.tile_key(-122.4, 37.8)
    # The cloud put house 7 in this square; the Mac's run (no ledger of it) adds house 1.
    other = {"schema": "kerbside.inferred_house_overlay/1", "tile": key,
             "buildings": {"7": {"file": "interiors/houses/sf-sunset/osm-7.json", "origin_lon_lat": [-122.4, 37.8]}}}
    store.put(f"interiors/overlay/{key}.json", gzip.compress(json.dumps(other).encode()))
    store.put("interiors/overlay/index.json", gzip.compress(json.dumps(
        {"schema": "kerbside.inferred_house_tiles/1", "tile_deg": engine.TILE_DEG, "tiles": {key: 1, "1_1": 4}}).encode()))
    _batch(tmp_path / "out/sf-sunset/batch-000", {"1": {"grade": "inferred", "validation": {"passed": True}}})
    assert engine.publish_to_store(tmp_path / "out/sf-sunset/batch-000", store) == 1
    tile = json.loads(gzip.decompress(store.get(f"interiors/overlay/{key}.json")))
    assert set(tile["buildings"]) == {"1", "7"}
    index = json.loads(gzip.decompress(store.get("interiors/overlay/index.json")))
    assert index["tiles"] == {key: 2, "1_1": 4}


def test_a_cloud_home_batch_is_the_macs_batch_and_its_houses_are_stored_by_the_controller() -> None:
    from smc.cloud.stages import home_batch, home_publish
    batch = home_batch("sf-sunset", 7, "abcd1234abcd1234")
    command = batch.command[0]
    assert command[command.index("--batch") + 1] == "sf-sunset:7" and "--homes" in command
    assert command[command.index("--batch-key") + 1] == "abcd1234abcd1234"
    assert batch.resource == "cpu" and batch.save == ["build/interior-homes/sf-sunset/batch-007"]
    store = home_publish(batch)
    assert store.resource == "control" and store.depends == [batch.id] and store.restore_from == [batch.id]
