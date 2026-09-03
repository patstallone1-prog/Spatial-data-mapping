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

from smc.lidar.curb import MAX_STEP_M, MIN_STEP_M, find_kerb_line
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
