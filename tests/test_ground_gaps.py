"""Ground nothing describes is given the surface around it (tools/infer_ground_gaps.py)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def _tool():
    spec = importlib.util.spec_from_file_location("infer_ground_gaps", ROOT / "tools/infer_ground_gaps.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_gap_takes_the_surface_around_it() -> None:
    tool = _tool()
    C = tool.C
    m = np.full((60, 60), C["building"], np.uint8)
    m[:, :20] = C["grass"]                     # a garden to the west
    m[:, 40:] = C["paving"]                    # a footway to the east
    m[:, 20:24] = C["bare"]                    # a sliver between the garden and the house
    m[:, 36:40] = C["bare"]                    # a sliver between the house and the footway
    fill, _ = tool.infer(m)
    kind = {name: 1 + i for i, name in enumerate(tool.FILL_KINDS)}
    assert (fill[:, 20:24] == kind["grass"]).all()
    assert (fill[:, 36:40] == kind["paving"]).all()
    assert (fill[m != C["bare"]] == 0).all()   # nothing measured is ever overwritten


def test_a_hole_in_a_parking_lot_is_asphalt() -> None:
    tool = _tool()
    C = tool.C
    m = np.full((80, 80), C["road"], np.uint8)
    m[:, 70:] = C["paving"]                    # the lot's footway, a few metres off
    m[30:40, 50:60] = C["bare"]
    fill, _ = tool.infer(m)
    assert (fill[30:40, 50:60] == 1 + tool.FILL_KINDS.index("asphalt")).all()


def test_the_fills_are_rings_on_the_page_frame() -> None:
    tool = _tool()
    fill = np.zeros((40, 40), np.uint8)
    fill[10:20, 10:30] = 1
    frame = {"midLon": -122.42, "midLat": 37.79, "mPerLon": 88000.0, "mPerLat": 111320.0}
    rings = tool.rings(fill, frame, west=0.0, south_z=0.0)
    assert len(rings) == 1 and rings[0]["k"] == "paving"
    ring = rings[0]["p"]
    assert ring[0] == ring[-1] and len(ring) >= 5
    lons = [p[0] for p in ring]
    # 0.5 m pixels: twenty of them across is ten metres, grown half a metre each side.
    assert abs((max(lons) - min(lons)) * 88000.0 - 11.0) < 1.0


def test_open_land_with_paths_across_it_is_green_not_paved() -> None:
    tool = _tool()
    C = tool.C
    m = np.full((200, 200), C["bare"], np.uint8)   # a hectare of unmapped hillside
    m[:, 98:102] = C["paving"]                      # a trail across it
    m[:, :4] = C["road"]
    fill, _ = tool.infer(m)
    bare = m == C["bare"]
    grass = 1 + tool.FILL_KINDS.index("grass")
    assert (fill[bare] == grass).mean() > 0.95


def test_the_page_draws_the_fills_under_every_mapped_surface() -> None:
    from tests.test_corridor_geometry_rules import NODE, _page_js
    if NODE is None:
        return
    js = _page_js()
    assert "const INFERRED_Y = 0.011;" in js and js.index("INFERRED_Y") < js.index("const PLAZA_Y")
    # Like the yards: after the terrain, before the yards and plazas, without a depth test.
    assert "side: THREE.DoubleSide, depthTest: false })), `inferred:${k}`);" in js
    assert "mesh.renderOrder = -1.5;" in js
    # Not counted as cover for the terrain lattice: twenty thousand slivers would make the whole
    # city draped finer, and the page twice as slow to build.
    lattice = js[js.index("function latticeCoverCounts"):js.index("function latticeAt")]
    assert '"inferred"' not in lattice
