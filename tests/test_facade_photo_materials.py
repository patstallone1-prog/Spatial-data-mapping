"""The facade photo reader's handling of fabric and smeared pictures (scripts/build_facade_photo_materials.py).

An awning across a shop band used to be read as clapboard in the awning's colour: CLIP had no
better answer among cladding classes, and the wall's colour was the median over the awning.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fpm", ROOT / "scripts" / "build_facade_photo_materials.py")
fpm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fpm)


def reading(top: str, p: float) -> dict[str, float]:
    rest = (1.0 - p) / (len(fpm.PROMPTS) - 1)
    return {c: (p if c == top else rest) for c in fpm.PROMPTS}


def test_tiles_cover_the_picture_in_a_two_by_three_grid():
    boxes = fpm.tiles(390, 501)
    assert len(boxes) == 6
    assert boxes[0] == (0, 0, 195, 167) and boxes[-1] == (195, 334, 390, 501)
    assert sum((x1 - x0) * (y1 - y0) for x0, y0, x1, y1 in boxes) == 390 * 501


def test_fabric_tiles_are_left_out_and_smeared_tiles_are_not():
    whole = reading("wood_siding", 0.5)
    tiles = [reading("stucco_render", 0.6)] * 4 + [reading("fabric", 0.7), reading("smeared", 0.9)]
    why, keep = fpm.wall_reading(whole, tiles)
    assert why is None
    assert keep == [True, True, True, True, False, True]


def test_a_wall_that_is_all_awning_or_all_smear_says_nothing():
    why, _ = fpm.wall_reading(reading("fabric", 0.6), [reading("stucco_render", 0.5)] * 6)
    assert why == "fabric"
    why, _ = fpm.wall_reading(reading("smeared", 0.8), [reading("stucco_render", 0.5)] * 6)
    assert why == "smeared"
    why, _ = fpm.wall_reading(reading("wood_siding", 0.5), [reading("fabric", 0.5)] * 6)
    assert why == "fabric"


def test_an_unsure_reject_answer_is_not_a_rejection():
    why, keep = fpm.wall_reading(reading("smeared", 0.4), [reading("fabric", 0.3)] * 6)
    assert why is None and all(keep)


def test_cladding_is_renormalised_without_the_reject_classes():
    c = fpm.cladding_of(reading("fabric", 0.5))
    assert set(c) == set(fpm.CLADDING)
    assert abs(sum(c.values()) - 1.0) < 1e-3


def test_colour_ignores_the_awning_tiles():
    px = np.full((300, 200, 3), 200, np.uint8)       # a cream wall
    px[100:300] = (60, 150, 70)                      # a green awning over the lower two thirds
    img = Image.fromarray(px)
    boxes = fpm.tiles(200, 300)
    keep = [True, True, False, False, False, False]
    colour, _ = fpm.kept_colour(img, boxes, keep)
    assert colour == [200, 200, 200]
    everything, _ = fpm.wall_colour(img)
    assert everything == [60, 150, 70]  # what the whole-picture median used to give the wall


def test_pooling_skips_rejected_walls_but_counts_them():
    walls = [
        {"building": "1", "weight": 1.0, "cladding": {c: (0.9 if c == "stucco_render" else 0.1 / 9) for c in fpm.CLADDING},
         "colour": [220, 210, 190]},
        {"building": "1", "weight": 1.0, "cladding": None, "rejected": "fabric", "colour": None},
        {"building": "2", "weight": 1.0, "cladding": None, "rejected": "smeared", "colour": None},
    ]
    out = fpm.pool(walls)
    assert out["1"]["class"] == "stucco_render" and out["1"]["walls"] == 2
    assert out["1"]["walls_rejected"] == {"fabric": 1}
    assert out["1"]["colour"] == "#dcd2be"
    assert "class" not in out["2"] and "colour" not in out["2"] and out["2"]["walls_rejected"] == {"smeared": 1}


def test_a_version_one_journal_row_still_pools():
    row = {"building": "3", "weight": 0.8, "probs": {c: (0.8 if c == "brick" else 0.2 / 9) for c in fpm.CLADDING},
           "colour": [150, 60, 40]}
    assert fpm.pool([row])["3"]["class"] == "brick"
