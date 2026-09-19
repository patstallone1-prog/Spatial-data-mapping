"""The kerb detector has to refuse more often than it accepts.

Every failure this module guards against was a real result from the aerial lidar before the
detector existed: a facade measured as a nine-metre kerb, a cambered road measured as a
forty-millimetre one. The plane splitter downstream will always return two surfaces and
therefore always return a height, so the whole question of whether a kerb is present has to be
answered here, before anything is fitted.
"""

from __future__ import annotations

import numpy as np
import pytest

from smc.lidar.curb import MAX_STEP_M, MIN_STEP_M, find_kerb_line, walk_run
from smc.lidar.ept import mercator_metres_per_true_metre


def surface(lateral, height, *, noise_m=0.01, per_bin=40, seed=0):
    """Points sampled across a profile defined by ``height(lateral)``."""
    rng = np.random.default_rng(seed)
    v = np.repeat(lateral, per_bin) + rng.uniform(-0.12, 0.12, lateral.size * per_bin)
    z = np.array([height(x) for x in v]) + rng.normal(0.0, noise_m, v.size)
    return v, z


def test_finds_a_kerb_at_the_step():
    lateral = np.arange(-4.0, 4.0, 0.25)
    v, z = surface(lateral, lambda x: 0.15 if x >= 0.5 else 0.0)
    offset = find_kerb_line(v, z)
    assert offset is not None
    assert offset == pytest.approx(0.5, abs=0.3)


def test_cambered_road_is_not_a_kerb():
    """The failure that produced 42 mm 'kerbs': a smooth cross-fall and nothing else."""
    lateral = np.arange(-6.0, 6.0, 0.25)
    v, z = surface(lateral, lambda x: 0.025 * x)
    assert find_kerb_line(v, z) is None


def test_retaining_wall_is_rejected():
    """San Francisco footways run beside walls and stairways; a metre is not a kerb."""
    lateral = np.arange(-4.0, 4.0, 0.25)
    v, z = surface(lateral, lambda x: 1.2 if x >= 0.5 else 0.0)
    assert find_kerb_line(v, z) is None


def test_step_below_the_sensor_floor_is_rejected():
    lateral = np.arange(-4.0, 4.0, 0.25)
    v, z = surface(lateral, lambda x: (MIN_STEP_M * 0.5) if x >= 0.0 else 0.0)
    assert find_kerb_line(v, z) is None


def test_a_kerb_buried_in_noise_is_rejected():
    """The same step, on a surface too rough to call it: the signal-to-noise gate."""
    lateral = np.arange(-4.0, 4.0, 0.25)
    v, z = surface(lateral, lambda x: 0.15 if x >= 0.5 else 0.0, noise_m=0.12)
    assert find_kerb_line(v, z) is None


def test_a_drop_toward_the_footway_is_not_a_kerb():
    """Sign matters: the across-axis points away from the road, so a kerb rises."""
    lateral = np.arange(-4.0, 4.0, 0.25)
    v, z = surface(lateral, lambda x: 0.0 if x >= 0.5 else 0.15)
    assert find_kerb_line(v, z) is None


def test_too_few_points_is_refused_rather_than_guessed():
    assert find_kerb_line(np.array([0.0, 1.0]), np.array([0.0, 0.15])) is None


@pytest.mark.parametrize("height", [MIN_STEP_M + 0.01, 0.15, MAX_STEP_M - 0.01])
def test_accepts_across_the_plausible_kerb_range(height):
    lateral = np.arange(-4.0, 4.0, 0.25)
    v, z = surface(lateral, lambda x: height if x >= 0.5 else 0.0)
    assert find_kerb_line(v, z) is not None


def test_mercator_scale_is_not_unity_in_san_francisco():
    """The 27% error that would silently widen every footway."""
    assert mercator_metres_per_true_metre(37.8) == pytest.approx(1.266, abs=0.005)
    assert mercator_metres_per_true_metre(0.0) == pytest.approx(1.0)


def _ground(lateral_edges: np.ndarray, level, noise_m: float = 0.01, per_bin: int = 40):
    """Ground returns across bins: ``level(x)`` gives the surface height, None means no ground."""
    rng = np.random.default_rng(3)
    lat, up = [], []
    for x in lateral_edges:
        z = level(x)
        if z is None:
            continue
        xs = rng.uniform(x, x + 0.25, per_bin)
        lat.append(xs)
        up.append(z + rng.normal(0.0, noise_m, per_bin))
    return np.concatenate(lat), np.concatenate(up)


def test_the_footway_is_the_walk_run_from_the_kerb_not_the_flat_extent():
    """A 3 m footway, then a 0.4 m planter wall, then more flat ground behind it. The old
    extent read the whole flat ground; the run stops at the step."""
    edges = np.arange(0.0, 8.0, 0.25)
    v, z = _ground(edges, lambda x: 0.15 if x < 3.0 else 0.55)
    run = walk_run(v, z, -0.125)
    assert run is not None
    width, level = run
    assert abs(width - 3.0) <= 0.3, width
    assert abs(level - 0.15) < 0.03


def test_the_footway_ends_where_the_ground_ends():
    """A building on the property line: no ground returns past 2.5 m."""
    edges = np.arange(0.0, 8.0, 0.25)
    v, z = _ground(edges, lambda x: 0.15 if x < 2.5 else None)
    width, _ = walk_run(v, z, -0.125)
    assert abs(width - 2.5) <= 0.3, width


def test_a_wall_standing_on_flat_ground_ends_the_footway():
    """A fence at 4 m with lawn beyond it at the same level: the ground alone would run on,
    the returns standing on the fence stop it."""
    edges = np.arange(0.0, 8.0, 0.25)
    v, z = _ground(edges, lambda x: 0.15)
    rng = np.random.default_rng(5)
    fence_v = rng.uniform(4.0, 4.25, 80)
    fence_z = 0.15 + rng.uniform(0.6, 1.8, 80)
    width, _ = walk_run(v, z, -0.125, standing_lateral=fence_v, standing_up=fence_z)
    assert abs(width - 4.0) <= 0.3, width


def test_a_gentle_cross_slope_is_walked_but_a_step_is_not():
    """Two percent across six metres is 12 cm of rise -- more than a step, spread out; the
    run follows it because the level is carried bin to bin."""
    edges = np.arange(0.0, 8.0, 0.25)
    v, z = _ground(edges, lambda x: 0.15 + 0.02 * x if x < 6.0 else None)
    width, _ = walk_run(v, z, -0.125)
    assert abs(width - 6.0) <= 0.3, width


def test_no_plateau_past_the_riser_is_no_footway():
    v, z = _ground(np.arange(-3.0, 0.0, 0.25), lambda x: 0.0)
    assert walk_run(v, z, 0.0) is None


def test_a_building_seen_from_above_ends_the_footway_and_a_tree_does_not():
    """Aerial lidar sees the roof, not the wall: under the eave the ground returns thin and
    the returns above take over. A tree's canopy is above the footway too, but the ground
    under it keeps its returns, so the run walks on under the tree."""
    rng = np.random.default_rng(9)
    edges = np.arange(0.0, 8.0, 0.25)
    # Ground: full density to 3.0 m, then a third of it under the roof.
    lat, up = [], []
    for x in edges:
        n = 40 if x < 3.0 else 12
        lat.append(rng.uniform(x, x + 0.25, n))
        up.append(0.15 + rng.normal(0, 0.01, n))
    v, z = np.concatenate(lat), np.concatenate(up)
    roof_v = rng.uniform(3.0, 8.0, 800)
    roof_z = 0.15 + rng.uniform(9.0, 12.0, 800)
    width, _ = walk_run(v, z, -0.125, standing_lateral=roof_v, standing_up=roof_z)
    assert abs(width - 3.0) <= 0.3, width
    # The same canopy over full-density ground: a tree.
    v2, z2 = _ground(edges, lambda x: 0.15)
    width2, _ = walk_run(v2, z2, -0.125, standing_lateral=roof_v, standing_up=roof_z)
    assert width2 >= 7.5, width2


def test_a_footway_the_lidar_cannot_see_is_refused_not_measured_short():
    """Ground returns that stop within a metre of the riser are an awning or a canopy over
    the footway, not a footway a metre wide."""
    edges = np.arange(0.0, 8.0, 0.25)
    v, z = _ground(edges, lambda x: 0.15 if x < 0.6 else None)
    assert walk_run(v, z, -0.125) is None
