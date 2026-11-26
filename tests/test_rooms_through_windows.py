"""Houses' real rooms built while walking and drawn from the pavement (docs/72-city-fixes-1126.md)."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "src/smc/renderer/page/module"


def test_houses_get_their_rooms_while_walking_not_only_when_stopped() -> None:
    src = (MODULES / "24-nearby-what-is-round-the.js").read_text()
    spec = re.search(r"const INTERIOR_ON_STOP = \{([^}]*)\}", src).group(1)
    assert "walk_near_m: 20" in spec and "walk_most: 3" in spec and "walk_every_ms: 1200" in spec
    body = src[src.index("function interiorsOnStop("):src.index("function interiorsOnStopReport(")]
    assert "!still && !driving" in body and "ahead(entry)" in body and "built_walking" in body


def test_rooms_are_drawn_from_the_pavement() -> None:
    src = (MODULES / "23-pins-1-2-and-3.js").read_text()
    assert "const INTERIOR_DRAW_M = 24;" in src


def test_the_city_can_ask_for_a_shops_fitted_interior() -> None:
    src = (MODULES / "30-the-living-city.js").read_text()
    hook = src[src.index("showFittedShop: id =>"):][:600]
    assert "buildInterior(entry)" in hook and "generatedInteriorRef" in hook
