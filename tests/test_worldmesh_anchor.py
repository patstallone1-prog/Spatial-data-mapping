"""The dense cloud anchored to the lidar: found, bounded, and written without loss."""
import numpy as np
import pytest

from smc.worldmesh.anchor import _turn, anchor_cloud, fit, read_ply


def street(rng, n=60_000):
    """A road with a facade either side and a cross wall: enough planes to fix all six numbers."""
    along = rng.uniform(-40, 40, n)
    road = np.column_stack([along, rng.uniform(-14, 14, n), 0.02 * along])  # a 2% grade, and yards
    north = np.column_stack([rng.uniform(-40, 40, n), np.full(n, 9.0), rng.uniform(0, 12, n)])
    south = np.column_stack([rng.uniform(-40, 40, n), np.full(n, -9.0), rng.uniform(0, 9, n)])
    cross = np.column_stack([np.full(n, 30.0), rng.uniform(-9, 9, n), rng.uniform(0, 6, n)])
    return np.vstack([road, north, south, cross])


def test_the_cloud_is_moved_onto_the_lidar():
    rng = np.random.default_rng(3)
    lidar = street(rng)
    R, t = _turn(np.radians([0.0, 0.0, 3.0])), np.array([0.6, -0.4, 0.45])
    cloud = (street(rng) - t) @ R + rng.normal(0, 0.02, (240_000, 3))   # where the photographs put it
    found = fit(cloud, lidar)
    assert found.accepted
    assert found.yaw_deg == pytest.approx(3.0, abs=0.05) and found.tilt_deg < 0.05
    assert np.asarray(found.shift_m) == pytest.approx(t, abs=0.02)
    assert found.after_m < 0.03 < found.before_m


def test_a_fit_that_tips_the_block_over_is_refused():
    rng = np.random.default_rng(4)
    lidar = street(rng)
    cloud = street(rng) @ _turn(np.radians([6.0, 0.0, 0.0]))
    found = fit(cloud, lidar)
    assert not found.accepted and np.allclose(found.rotation, np.eye(3)) and found.shift_m == [0, 0, 0]


def test_the_anchored_ply_keeps_every_point_colour_and_normal(tmp_path):
    rng = np.random.default_rng(5)
    lidar = street(rng, 20_000)
    shift = np.array([0.3, 0.2, -0.25])
    xyz = street(rng, 20_000) - shift
    dtype = [("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("nx", "<f4"), ("ny", "<f4"), ("nz", "<f4"),
             ("red", "u1"), ("green", "u1"), ("blue", "u1")]
    v = np.zeros(len(xyz), dtype)
    v["x"], v["y"], v["z"], v["nz"], v["red"] = xyz[:, 0], xyz[:, 1], xyz[:, 2], 1.0, 200
    header = (f"ply\nformat binary_little_endian 1.0\nelement vertex {len(v)}\n"
              + "".join(f"property {'float' if t[1] == '<f4' else 'uchar'} {t[0]}\n" for t in dtype)
              + "end_header\n").encode()
    fused = tmp_path / "fused.ply"
    fused.write_bytes(header + v.tobytes())
    found = anchor_cloud(fused, tmp_path / "anchored.ply", lidar)
    _, out = read_ply(tmp_path / "anchored.ply")
    assert found.accepted and len(out) == len(v)
    assert np.column_stack([out["x"], out["y"], out["z"]]) == pytest.approx(xyz + shift, abs=0.02)
    assert (out["red"] == 200).all() and out["nz"] == pytest.approx(1.0, abs=1e-3)
