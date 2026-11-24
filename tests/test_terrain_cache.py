"""The terrain build's lidar tiles are never written to disk, and a reader given no cache folder
keeps its cache in the checkout, not wherever the script was started.

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


def test_terrain_reads_tiles_without_caching_them_and_a_missing_tile_is_a_hole(tmp_path, monkeypatch):
    bbox = BBox(south=37.8000, west=-122.4200, north=37.8036, east=-122.4155)
    region = Region("tiny", bbox, "test")
    readers: list[dict] = []
    calls: list[int] = []

    class FakeReader:
        def __init__(self, dataset, **kwargs):
            readers.append(kwargs)

        def around(self, lat, lon, radius_m, *, resolution_m):
            calls.append(1)
            if len(calls) == 3:
                raise OSError("a tile the service would not serve")
            side = np.arange(-radius_m, radius_m, 3.0)
            east, north = (a.ravel() for a in np.meshgrid(side, side))
            up = 10.0 + 0.01 * east
            return LocalCloud(east, north, up, np.full(east.size, 2, dtype=np.uint8), lat, lon)

    monkeypatch.setattr(build_terrain, "ROOT", tmp_path)
    monkeypatch.setattr(build_terrain, "get_region", lambda name: region)
    monkeypatch.setattr(build_terrain, "EptReader", FakeReader)
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "terrain.bin"
    monkeypatch.setattr(sys, "argv", ["build_terrain.py", "--region", "tiny", "--out", str(out),
                                      "--centrelines", str(tmp_path / "none.json")])

    assert build_terrain.main() == 0
    assert out.exists()
    assert readers == [{"cache": False}]
    assert len(calls) > 3
    assert not (tmp_path / "build").exists()


def test_a_reader_given_no_cache_keeps_it_in_the_checkout_not_the_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    reader = EptReader()
    assert reader._cache == ROOT / "build" / "lidar-cache" / SF_DATASET
