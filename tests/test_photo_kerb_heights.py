"""Photographed kerb heights fill only streets the lidar left without one, and only if they agree
with the lidar where both measured."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "photo_kerb_heights", ROOT / "scripts/curbmeasure/photo_kerb_heights.py"
)
pkh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pkh)

LAT = 37.79
DEG = 1 / 111_320  # a metre of latitude


def street(osm_id, lon):
    """A north-south street 200 m long at ``lon``."""
    return {"kind": "street", "osm_id": osm_id, "points": [[lon, LAT], [lon, LAT + 200 * DEG]]}


def readings(lon, h, n=40, images=5, across_m=6.0):
    k = 1 / (111_320 * 0.7903)  # a metre of longitude at this latitude
    return [
        {
            "image": f"{lon}-{i % images}",
            "lon": lon + across_m * k,
            "lat": LAT + (20 + i * 4) * DEG,
            "h": h,
        }
        for i in range(n)
    ]


def region(tmp_path, ways, lidar, rows):
    base = tmp_path / "data/regions/cell"
    (base / "lidar").mkdir(parents=True)
    (base / "osm_ways.json").write_text(json.dumps(ways))
    (base / "lidar/kerb_heights.json").write_text(json.dumps(lidar))
    photo = tmp_path / "photo"
    photo.mkdir()
    (photo / "raw_observations.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    return photo


def test_agreeing_photographs_fill_only_the_streets_without_lidar(tmp_path):
    lons = [-122.46 + i * 0.002 for i in range(17)]  # about 176 m apart: no reading near two
    ways = [street(i, lon) for i, lon in enumerate(lons)]
    lidar = {f"osm:{i}": {"curb_height_m": 0.15, "curb_height_n": 20} for i in range(16)}
    rows = [
        r for i, lon in enumerate(lons) for r in readings(lon, 0.15 + (0.02 if i % 2 else -0.02))
    ]
    out = pkh.build("cell", region(tmp_path, ways, lidar, rows), tmp_path)
    assert out["accepted"] and out["checked_against_lidar"]["streets"] == 16
    assert set(out["heights"]) == {"osm:16"} and out["grade"] == "image"
    assert out["heights"]["osm:16"]["curb_height_m"] == 0.13  # its readings, not the lidar's neighbours


def test_photographs_that_disagree_with_the_lidar_fill_nothing(tmp_path):
    lons = [-122.46 + i * 0.002 for i in range(17)]
    ways = [street(i, lon) for i, lon in enumerate(lons)]
    lidar = {f"osm:{i}": {"curb_height_m": 0.15, "curb_height_n": 20} for i in range(16)}
    rows = [r for lon in lons for r in readings(lon, 0.30)]
    out = pkh.build("cell", region(tmp_path, ways, lidar, rows), tmp_path)
    assert not out["accepted"] and out["heights"] == {}


def test_a_reading_between_two_streets_or_from_too_few_images_is_not_used():
    k = pkh.np.array([111_320 * 0.7903, 111_320])
    ways = [street(1, -122.46), street(2, -122.46 + 10 / (111_320 * 0.7903))]  # 10 m apart
    xy, owner, keys = pkh.street_points(ways, k)
    between = readings(-122.46, 0.15, across_m=5.0)
    assert pkh.assign(between, xy, owner, keys, k) == {}
    few = {"osm:1": readings(-122.46, 0.15, images=2)}
    assert pkh.way_heights(few) == {}


def test_builder_takes_photo_heights_only_below_city_and_lidar():
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    block = source[source.index('photo_path = lidar_dir / "kerb_heights_photo.json"') :]
    block = block[: block.index("return dict(counts)")]
    assert 'photo.get("accepted")' in block and 'way.get("kerb_m")' in block
    assert '"photo_semantic"' in block and "xs" not in block  # heights only, never a kerb line
