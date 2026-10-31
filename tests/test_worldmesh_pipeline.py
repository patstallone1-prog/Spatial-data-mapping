"""The world mesh's block, photographs, pairing, gate and cloud jobs."""
from pathlib import Path

import numpy as np
import pytest

from smc.worldmesh.block import Block, block_for_region, tiles_of
from smc.worldmesh.photos import Frame, frame_from_row, thin

ROOT = Path(__file__).resolve().parents[1]


def frame(i, seq="s1", lon=-122.4365, lat=37.8006, kind="perspective"):
    return Frame(id=str(i), sequence=seq, lon=lon, lat=lat, altitude_m=None, heading_deg=0,
                 captured_at=i, width=4000, height=3000, camera_type=kind, focal=0.8, k1=0, k2=0,
                 make=None, model=None, creator="someone", position_source="mapillary_sfm",
                 url="https://example.invalid/x.jpg", path=f"{seq}/{i}.jpg")


def test_blocks_tile_a_region_without_gaps_or_overlap():
    block = block_for_region("sf-corridor", ROOT)
    parts = tiles_of(block, 200.0)
    assert len(parts) > 50
    assert min(p.west for p in parts) == block.west
    assert max(p.east for p in parts) == pytest.approx(block.east)
    area = sum((p.east - p.west) * (p.north - p.south) for p in parts)
    assert area == pytest.approx((block.east - block.west) * (block.north - block.south))
    w, s, e, n = parts[0].bounds_m()
    assert 150 < e - w < 260 and 150 < n - s < 260


def test_thinning_drops_repeats_and_panoramas_only():
    still = [frame(i) for i in range(10)]                                     # waiting at a light
    moving = [frame(100 + i, "s2", lat=37.8 + i * 3e-5) for i in range(10)]   # 3.3 m apart
    pano = [frame(200 + i, "s3", lat=37.8 + i * 3e-5, kind="spherical") for i in range(10)]
    kept = thin(still + moving + pano)
    assert {f.sequence for f in kept} == {"s2"}                               # one still frame is too few
    assert len(kept) == 10


def test_a_row_prefers_the_computed_position_and_says_so():
    row = {"id": 1, "sequence": "a", "geometry": {"type": "Point", "coordinates": [-122.1, 37.1]},
           "computed_geometry": {"type": "Point", "coordinates": [-122.2, 37.2]},
           "camera_type": "perspective", "camera_parameters": [0.8, -0.1, 0.01],
           "creator": {"username": "u"}, "thumb_original_url": "https://example.invalid"}
    f = frame_from_row(row)
    assert (f.lon, f.lat, f.position_source) == (-122.2, 37.2, "mapillary_sfm")
    assert (f.focal, f.k1, f.k2, f.creator) == (0.8, -0.1, 0.01, "u")


def test_pairs_join_neighbours_and_each_sequence(tmp_path):
    from smc.worldmesh.reconstruct import write_pairs

    block = Block("b", -122.437, 37.8003, -122.436, 37.801)
    frames = [frame(i, "s1", lat=37.8003 + i * 4e-5) for i in range(12)]
    frames += [frame(50 + i, "s2", lon=-122.4369, lat=37.8003 + i * 4e-5) for i in range(12)]
    count = write_pairs(frames, block, tmp_path / "pairs.txt")
    lines = (tmp_path / "pairs.txt").read_text().splitlines()
    assert count == len(lines) > 24
    assert any(a.startswith("s1/") and b.startswith("s2/") for a, b in (line.split() for line in lines))


def test_the_gate_holds_what_it_cannot_measure():
    from smc.worldmesh.check import judge
    from smc.worldmesh.tiles import Mesh

    grid = np.stack(np.meshgrid(np.arange(30.0), np.arange(30.0)), -1).reshape(-1, 2)
    positions = np.hstack([grid, np.zeros((len(grid), 1))])
    i = np.arange(29 * 30).reshape(29, 30)[:, :29].ravel()
    faces = np.vstack([np.stack([i, i + 1, i + 31], 1), np.stack([i, i + 31, i + 30], 1)])
    mesh = Mesh(positions, faces)
    held = judge(mesh, registered_share=0.9, lidar=None)
    assert not held.passed and "no lidar" in held.reasons[0]
    rng = np.random.default_rng(1)
    near = np.hstack([rng.random((5000, 2)) * 29, rng.normal(0, 0.03, (5000, 1))])
    good = judge(mesh, registered_share=0.9, lidar=near)
    assert good.passed and good.median_m < 0.05
    off = judge(mesh, registered_share=0.9, lidar=near + np.array([0, 0, 0.4]))
    assert not off.passed and off.median_m > 0.15
    assert not judge(mesh, registered_share=0.4, lidar=near).passed


def test_cloud_jobs_fetch_on_cpu_and_solve_on_gpu():
    from smc.cloud.stages import worldmesh_jobs

    photos, solve = worldmesh_jobs("sf-corridor", "sf-corridor-3-4", (-122.44, 37.80, -122.43, 37.81))
    assert (photos.resource, solve.resource) == ("cpu", "gpu")
    assert solve.depends == [photos.id] and solve.restore_from == [photos.id]
    assert photos.optional and solve.optional
    assert photos.command[0][-1] == "photos" and solve.command[0][-1] == "solve,tiles,check"
    assert photos.save == solve.save == ["build/worldmesh/sf-corridor-3-4"]
