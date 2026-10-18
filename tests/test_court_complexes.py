"""A block of adjoining courts is one pad with one fence, as Moscone's two blocks are."""

from __future__ import annotations

import json
import math
from pathlib import Path

from smc.ground.courts import court_complexes
from tests.test_corridor_geometry_rules import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
KX, KY = 111_320 * math.cos(math.radians(37.8)), 110_540


def to_metres(lon, lat):
    return ((lon + 122.43) * KX, (lat - 37.8) * KY)


def to_lonlat(x, y):
    return (-122.43 + x / KX, 37.8 + y / KY)


def rect(sport: str, x: float, y: float, length: float = 23.8, width: float = 11.0) -> dict:
    ring = [to_lonlat(x, y), to_lonlat(x + length, y), to_lonlat(x + length, y + width),
            to_lonlat(x, y + width), to_lonlat(x, y)]
    return {"s": sport, "p": [list(p) for p in ring]}


def test_adjoining_courts_are_one_block_and_a_distant_one_is_not() -> None:
    pitches = [rect("tennis", 0, 0), rect("tennis", 0, 14.7), rect("basketball", 30, 0),
               rect("tennis", 200, 0), rect("soccer", 0, 29, 60, 40)]
    blocks = court_complexes(pitches, to_metres, to_lonlat)
    assert len(blocks) == 1
    block = blocks[0]
    assert [p.get("k") for p in pitches] == [block["id"]] * 3 + [None, None]
    assert block["surface"] == "hard" and block["s"] == "tennis"
    # The outline takes in the strip between the courts: it is one ring round all three.
    xs = [to_metres(*q)[0] for q in block["p"]]
    ys = [to_metres(*q)[1] for q in block["p"]]
    assert min(xs) < 1 and max(xs) > 53 and min(ys) < 1 and max(ys) > 25


def test_grouping_again_does_not_keep_old_blocks() -> None:
    pitches = [rect("tennis", 0, 0), rect("tennis", 0, 14.7)]
    court_complexes(pitches, to_metres, to_lonlat)
    pitches[1] = rect("tennis", 0, 100)
    pitches[0]["k"] = "c0"
    assert court_complexes(pitches, to_metres, to_lonlat) == []
    assert all("k" not in p for p in pitches)


def test_moscone_is_two_blocks() -> None:
    ground = json.loads((ROOT / "docs/app-sf-corridor-ground.json").read_text())
    near = []
    for block in ground["court_complexes"]:
        lon = sum(p[0] for p in block["p"]) / len(block["p"])
        lat = sum(p[1] for p in block["p"]) / len(block["p"])
        if -122.4350 < lon < -122.4300 and 37.8005 < lat < 37.8050:
            near.append(sorted(p["s"] for p in ground["pitches"] if p.get("k") == block["id"]))
    assert sorted(near) == [["basketball", "tennis", "tennis"],
                            ["basketball", "tennis", "tennis", "tennis"]]


def test_the_page_pads_and_fences_a_block_once() -> None:
    courts = _extract("buildCourts", _page_js())
    assert "const inBlock = new Set(complexes.map((c) => c.id));" in courts
    assert "!inBlock.has(p.k)" in courts
    assert '(ground.court_complexes || []).filter((c) => c.surface === "hard")' in _page_js()
