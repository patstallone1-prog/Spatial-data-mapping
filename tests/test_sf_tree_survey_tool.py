"""tools/build_sf_tree_survey.py: a crown measured from the lidar, and the clearances the page uses."""
import math
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build_sf_tree_survey as tool  # noqa: E402


def _crown(radius=3.0, base=2.5, top=9.0, n=4000, seed=7):
    """Points through a round crown on a trunk at the origin, two returns a bin (leaves, branches)."""
    rng = np.random.default_rng(seed)
    angle = rng.uniform(0, 2 * math.pi, n)
    r = radius * np.sqrt(rng.uniform(0, 1, n))
    h = rng.uniform(base, top, n)
    return np.column_stack([r * np.cos(angle), r * np.sin(angle), h])


def test_a_crown_is_measured_in_eight_wedges_from_its_own_points() -> None:
    found = tool.profile(_crown(), 0.0)
    assert found is not None
    assert found["src"] == "usgs_3dep_2023"
    assert len(found["profile"]) == 8
    for reach, low, high in found["profile"]:
        assert 2.4 <= reach <= 3.1
        assert low < 4 and 8 < high <= 9.1
    assert 8.5 <= found["h"] <= 9.1
    assert 5 <= found["crown_m"] <= 6.2


def test_a_roof_or_a_wire_is_not_a_crown() -> None:
    # A flat roof: every bin one height, no depth of returns.
    xs, zs = np.meshgrid(np.linspace(-3, 3, 60), np.linspace(-3, 3, 60))
    roof = np.column_stack([xs.ravel(), zs.ravel(), np.full(xs.size, 6.0)])
    assert tool.profile(roof, 0.0) is None
    # Too few points to close a crown.
    assert tool.profile(_crown(n=40), 0.0) is None


def test_the_clearances_are_the_pages_own() -> None:
    # The page measures the same distances from the opening it settles on (module 18).
    page = (ROOT / "src/smc/renderer/page/module/18-inside-the-parks-playgrounds-dog.js").read_text()
    table = re.search(r"TREE_OBSTACLE_CLEARANCE_M = \{([^}]*)\}", page).group(1)
    page_m = {k: float(v) for k, v in re.findall(r"(\w+): ([\d.]+)", table)}
    assert page_m == tool.CLEARANCE_M
    # 25 ft from a stop sign, 5 ft from a hydrant, 3 ft from a meter or a parking sign.
    assert math.isclose(tool.CLEARANCE_M["stop"], 25 * 0.3048)
    assert math.isclose(tool.CLEARANCE_M["hydrant"], 5 * 0.3048)
    assert math.isclose(tool.CLEARANCE_M["meter"], 3 * 0.3048)


def test_obstacles_reach_only_the_trees_near_enough_to_matter() -> None:
    near = {"curb": [-122.43, 37.80, 0], "plot": [0.9144, 0.9144]}
    far = {"curb": [-122.4290, 37.8010, 0], "plot": [0.9144, 0.9144]}
    loose = {"p": [-122.43, 37.80]}   # no curb: not a curb-side opening
    hydrant = [-122.43, 37.80001]      # about a metre north of the near tree
    added = tool.add_obstacles([near, far, loose], [hydrant], "hydrant")
    assert added == 1
    assert near["obstacles"][0][-1] == "hydrant"
    assert "obstacles" not in far and "obstacles" not in loose
    # Asked again, the same hydrant is not added twice.
    assert tool.add_obstacles([near], [hydrant], "hydrant") == 0
