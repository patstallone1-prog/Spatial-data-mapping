"""The trees stage's direct read finds exactly the trees the stored point cells gave."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_point_cells  # noqa: E402
import detect_lidar_trees  # noqa: E402

from smc.lidar.ept import CLASS_GROUND  # noqa: E402


def _cell(seed: int = 4) -> tuple[np.ndarray, np.ndarray]:
    """A 126 m cell: sloping ground, a house, and a dozen crowns of different heights."""
    rng = np.random.default_rng(seed)
    ground = rng.uniform(-63, 63, (60_000, 2))
    gz = 12.0 + 0.03 * ground[:, 0]
    parts = [np.column_stack([ground, gz + rng.normal(0, 0.02, len(ground))])]
    classes = [np.full(len(ground), CLASS_GROUND, np.uint8)]
    for _ in range(12):
        cx, cy = rng.uniform(-50, 50, 2)
        h, r = rng.uniform(5, 18), rng.uniform(2, 5)
        n = 3000
        a, d = rng.uniform(0, 2 * np.pi, n), r * np.sqrt(rng.uniform(0, 1, n))
        x, y = cx + d * np.cos(a), cy + d * np.sin(a)
        z = 12.0 + 0.03 * x + h * (1 - 0.5 * (d / r) ** 2) - rng.uniform(0, 3, n)
        parts.append(np.column_stack([x, y, z]))
        classes.append(np.full(n, 1, np.uint8))
    house = rng.uniform(-8, 8, (4000, 2)) + np.array([30.0, -30.0])
    parts.append(np.column_stack([house, 12.0 + 0.03 * house[:, 0] + 7.0]))
    classes.append(np.full(len(house), 6, np.uint8))
    return np.concatenate(parts), np.concatenate(classes)


def test_the_direct_read_finds_the_same_trees_as_the_stored_cell(tmp_path):
    xyz, classes = _cell()
    lon0, lat0 = -122.27, 37.87
    ring = np.array([[30 - 8, -38], [38, -38], [38, -22], [22, -22], [22, -38]], float)
    kx = 111_320.0 * np.cos(np.radians(lat0))
    rings = [np.column_stack([lon0 + ring[:, 0] / kx, lat0 + ring[:, 1] / 111_320.0])]
    boxes = np.array([[r[:, 0].min(), r[:, 1].min(), r[:, 0].max(), r[:, 1].max()] for r in rings])
    meta = {"cell": "0:0", "origin_lon": lon0, "origin_lat": lat0, "dataset": "TEST",
            "base_z_m": None}

    cm, kept_classes, base_z = build_point_cells.stored_points(xyz, classes)
    meta["base_z_m"] = base_z
    path = tmp_path / "0:0.npz"
    np.savez_compressed(path, xyz_cm=cm, classification=kept_classes,
                        source=np.zeros(len(cm), np.uint8),
                        meta=np.frombuffer(json.dumps(meta).encode(), dtype=np.uint8))
    stored = detect_lidar_trees.cell_trees(path, rings, boxes)

    # find_lidar_trees.cell, without the fetch: the kept points as the store reads them back.
    kept = cm.astype(np.float64) / 100.0
    kept[:, 2] += base_z
    direct = detect_lidar_trees.trees_in(kept, kept_classes, {k: v for k, v in meta.items()
                                                              if k != "base_z_m"}, rings, boxes)
    assert len(stored) >= 8
    assert json.dumps(direct) == json.dumps(stored)


def test_the_trees_stage_reads_the_lidar_once_and_treats_no_points_as_no_trees():
    source = (ROOT / "scripts/enrich_region.py").read_text()
    assert '"scripts/find_lidar_trees.py"' in source
    assert "build_point_cells.py\", region" not in source
    assert "if code == 3:" in source
    import find_lidar_trees
    assert find_lidar_trees.NO_POINTS == 3
