"""Aerial photographs: the sharpest source per square, and what is read off them."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

pytest.importorskip("rasterio")
pytest.importorskip("cv2")

import build_ortho_islands as islands  # noqa: E402
import build_ortho_roofs as roofs  # noqa: E402

from smc.imagery import ortho  # noqa: E402


def test_island_fragments_join_end_to_end_and_close() -> None:
    left = [(0.0, 0.0), (0.0, 20.0), (1.0, 21.0)]
    right = [(2.0, 21.0), (3.0, 20.0), (3.0, 0.0)]   # its nose open by a metre
    far = [(100.0, 0.0), (100.0, 10.0)]
    chains = islands.chains([left, right, far])
    joined = next(pts for pts, members in chains if len(members) == 2)
    assert math.dist(joined[0], joined[-1]) <= islands.CLOSE_M, "the two sides make one ring"
    assert any(members == [2] for _, members in chains), "an unrelated fragment stays apart"


def _pix(rgb: np.ndarray, nir: np.ndarray | None = None) -> dict:
    return {"rgb": rgb, "nir": nir, "valid": np.ones(rgb.shape[1:], bool), "pixel_m": 0.25, "gsd_m": 0.25,
            "sources": ["test"], "bounds": (0, 0, rgb.shape[2] * 0.25, rgb.shape[1] * 0.25)}


def test_a_raised_island_is_found_and_paint_is_not() -> None:
    rgb = np.full((3, 80, 80), 70, np.uint8)            # asphalt
    rgb[:, 20:60, 30:38] = 150                           # a 2 m wide concrete island
    rgb[:, :, 60] = 230                                  # a 25 cm paint line
    mask, contrast = islands.raised_mask(_pix(rgb), np.ones((80, 80), bool))
    assert contrast >= islands.CONTRAST
    assert mask[25:55, 31:37].all(), "the island"
    assert not mask[:, 59:62].any(), "the paint line is opened away"


def test_solar_arrays_repeat_at_a_modules_pitch_and_shade_does_not() -> None:
    lum = np.full((60, 60), 200.0)
    part = np.zeros((60, 60), bool)
    part[10:50, 10:50] = True
    panels = lum.copy()
    for x in range(10, 50):
        panels[10:50, x] = 230 if (x - 10) % 6 == 0 else 80   # a seam every 1.5 m
    assert roofs.module_rhythm(panels, part, 0.25) > roofs.SOLAR_RHYTHM
    shade = lum.copy()
    shade[10:50, 10:50] = 60
    assert roofs.module_rhythm(shade, part, 0.25) < roofs.SOLAR_RHYTHM


def test_squares_are_read_back_by_slicing_across_their_edges(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(ortho, "OUT", tmp_path)
    folder = tmp_path / "test-region"
    folder.mkdir()
    rows = []
    for i, value in ((0, 40), (1, 200)):
        sq = (10_000 + i, 20_000)
        bounds = ortho.square_bounds(sq)
        band = np.full((3, 1000, 1000), value, np.uint8)
        ortho._write(folder / f"{sq[0]}_{sq[1]}.rgb.tif", band, bounds)
        rows.append({"square": list(sq), "bounds_utm": list(bounds), "source": "test", "gsd_m": 0.25,
                     "pixels": 1000, "nir": False, "cover": 1.0})
    (folder / "manifest.json").write_text(json.dumps({"schema": "kerbside.ortho/1", "sources": {},
                                                      "squares": rows}))
    cache = ortho.SquareCache("test-region")
    x = 10_001 * ortho.GRID_M
    pix = cache.read((x - 5, 20_000 * ortho.GRID_M + 10, x + 5, 20_000 * ortho.GRID_M + 20))
    assert pix["rgb"].shape == (3, 40, 40) and pix["valid"].all()
    left, right = pix["rgb"][0, :, :20], pix["rgb"][0, :, 20:]
    assert abs(float(left.mean()) - 40) < 6 and abs(float(right.mean()) - 200) < 6
