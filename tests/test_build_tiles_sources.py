"""Clean checkouts must retain all published regions in the tile tree."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_tile_sources_use_published_region_when_local_build_is_absent(tmp_path: Path, monkeypatch):
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_tiles

    monkeypatch.setattr(build_tiles, "ROOT", tmp_path)
    published = tmp_path / "docs/regions/oakland-downtown"
    published.mkdir(parents=True)
    (published / "sf-corridor-3d.json").write_text("{}")
    assert build_tiles.site_of("oakland-downtown") == published
    local = tmp_path / "data/regions/oakland-downtown/site"
    local.mkdir(parents=True)
    (local / "sf-corridor-3d.json").write_text("{}")
    assert build_tiles.site_of("oakland-downtown") == local
    assert build_tiles.site_of("sf-corridor") == tmp_path / "docs"


def test_tile_build_refuses_to_drop_previously_published_cities(tmp_path: Path):
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_tiles

    index = tmp_path / "index.json"
    index.write_text(json.dumps({"regions": {"sf-corridor": {}, "oakland-downtown": {}}}))
    assert build_tiles.missing_published_regions(index, {"sf-corridor": tmp_path}) == {
        "oakland-downtown",
    }
    assert not build_tiles.missing_published_regions(index, {
        "sf-corridor": tmp_path, "oakland-downtown": tmp_path,
    })


def test_committed_tile_index_keeps_eight_regions_and_every_asset_exists():
    root = ROOT / "docs/tiles"
    index = json.loads((root / "index.json").read_text())
    assert set(index["regions"]) == {
        "sf-corridor", "sf-mission", "sf-haight-castro", "sf-sunset",
        "oakland-downtown", "berkeley-downtown", "palo-alto-downtown",
        "san-jose-downtown",
    }
    assert len(index["tiles"]) >= 800
    crossing_layers = {"crossings_continental", "crossings_parallel"}
    assert crossing_layers <= {name for tile in index["tiles"] for name in tile["assets"]}
    for tile in index["tiles"]:
        assert "crossings" not in tile["assets"]
        for asset in tile["assets"].values():
            path = root / asset["url"]
            assert path.is_file(), path
            assert path.stat().st_size == asset["bytes"], path
