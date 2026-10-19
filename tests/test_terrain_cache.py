"""The terrain build's lidar tiles do not outlive the tile, nor the stage.

Built with no cache folder, the reader kept every tile under the working directory's
build/lidar-cache; at a gigabyte or more a region it filled the internal disk on 2026-10-18.
"""

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_terrain  # noqa: E402

from smc.imagery.region import BBox, Region  # noqa: E402
from smc.lidar.ept import SF_DATASET, EptReader, LocalCloud  # noqa: E402


def test_terrain_reads_into_its_region_cache_and_leaves_nothing_behind(tmp_path, monkeypatch):
    bbox = BBox(south=37.8000, west=-122.4200, north=37.8036, east=-122.4155)
    region = Region("tiny", bbox, "test")
    caches: list[Path] = []
    leftovers: list[list[Path]] = []

    class FakeReader:
        def __init__(self, dataset, *, cache_dir=None):
            assert cache_dir is not None
            self.cache = cache_dir
            caches.append(cache_dir)
            self.calls = 0

        def around(self, lat, lon, radius_m, *, resolution_m):
            # What the earlier tiles left on disk, before this one writes its own.
            leftovers.append(sorted(self.cache.rglob("*.laz")) if self.cache.exists() else [])
            self.calls += 1
            tile = self.cache / "ept-data" / f"{self.calls}.laz"
            tile.parent.mkdir(parents=True, exist_ok=True)
            tile.write_bytes(b"\0" * 1024)
            if self.calls == 3:
                raise OSError("a tile the service would not serve")
            side = np.arange(-radius_m, radius_m, 3.0)
            east, north = (a.ravel() for a in np.meshgrid(side, side))
            up = 10.0 + 0.01 * east
            return LocalCloud(east, north, up, np.full(east.size, 2, dtype=np.uint8), lat, lon)

    monkeypatch.setattr(build_terrain, "ROOT", tmp_path)
    monkeypatch.setattr(build_terrain, "get_region", lambda name: region)
    monkeypatch.setattr(build_terrain, "EptReader", FakeReader)
    out = tmp_path / "terrain.bin"
    monkeypatch.setattr(sys, "argv", ["build_terrain.py", "--region", "tiny", "--out", str(out),
                                      "--centrelines", str(tmp_path / "none.json")])

    assert build_terrain.main() == 0
    assert out.exists()
    region_cache = tmp_path / "build" / "regions" / "tiny" / "terrain-cache"
    assert caches == [region_cache / SF_DATASET]
    assert len(leftovers) > 3
    # A tile's points are gone before the next is read, the one that failed among them.
    assert all(not left for left in leftovers)
    assert not region_cache.exists()


def test_a_reader_given_no_cache_keeps_it_in_the_checkout_not_the_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    reader = EptReader()
    assert reader._cache == ROOT / "build" / "lidar-cache" / SF_DATASET
