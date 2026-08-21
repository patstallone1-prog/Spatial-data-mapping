"""GNSS error simulation.

CARLA's built-in GNSS sensor applies independent Gaussian noise per axis. Real receiver error
does not behave that way, and the difference decides whether the anchoring step looks solved
when it is not. Two properties matter:

* **Error is correlated in time.** A receiver's position error drifts over minutes, so
  consecutive frames in a burst share almost the same error. Independent per-frame noise would
  average away over a pass and hand the fusion engine an accuracy it will never see, because
  averaging a constant bias does not remove it.
* **Error is heavy-tailed near buildings.** Multipath produces occasional large excursions, not
  a wider Gaussian. Those excursions are what break naive association.

The model is a first-order Gauss-Markov bias plus white noise plus Poisson multipath spikes,
with presets calibrated so that the crowdsourced mix reproduces the ~5.5 m mean deviation
measured for crowdsourced camera positions in the literature (see docs/02-comparables.md).
"""

from __future__ import annotations

import enum
import math
from dataclasses import dataclass

import numpy as np


class Environment(enum.StrEnum):
    OPEN_SKY = "open_sky"
    SUBURBAN = "suburban"
    URBAN_CANYON = "urban_canyon"
    RTK_FIXED = "rtk_fixed"


@dataclass(frozen=True, slots=True)
class GnssErrorModel:
    """Parameters of the error process, per horizontal axis unless noted."""

    environment: Environment
    #: Standard deviation of the slowly varying bias.
    bias_sigma_m: float
    #: Gauss-Markov correlation time. Longer means error persists across a whole pass.
    correlation_time_s: float
    #: Per-sample white noise.
    white_sigma_m: float
    #: Expected multipath excursions per second.
    multipath_rate_hz: float
    #: Scale of a multipath excursion (exponential).
    multipath_scale_m: float
    #: Vertical error is roughly this multiple of horizontal.
    vertical_factor: float = 1.7


PRESETS: dict[Environment, GnssErrorModel] = {
    Environment.OPEN_SKY: GnssErrorModel(
        environment=Environment.OPEN_SKY,
        bias_sigma_m=1.0,
        correlation_time_s=240.0,
        white_sigma_m=0.5,
        multipath_rate_hz=0.002,
        multipath_scale_m=1.5,
    ),
    Environment.SUBURBAN: GnssErrorModel(
        environment=Environment.SUBURBAN,
        bias_sigma_m=2.2,
        correlation_time_s=180.0,
        white_sigma_m=0.8,
        multipath_rate_hz=0.02,
        multipath_scale_m=3.0,
    ),
    Environment.URBAN_CANYON: GnssErrorModel(
        environment=Environment.URBAN_CANYON,
        bias_sigma_m=6.0,
        correlation_time_s=120.0,
        white_sigma_m=2.0,
        multipath_rate_hz=0.12,
        multipath_scale_m=9.0,
    ),
    # ZED-F9P RTK fixed: 0.01 m + 1 ppm CEP. Modelled with no meaningful bias process because
    # the correction stream removes exactly the slowly varying component.
    Environment.RTK_FIXED: GnssErrorModel(
        environment=Environment.RTK_FIXED,
        bias_sigma_m=0.008,
        correlation_time_s=30.0,
        white_sigma_m=0.006,
        multipath_rate_hz=0.0005,
        multipath_scale_m=0.15,
        vertical_factor=2.0,
    ),
}


class GnssSimulator:
    """Stateful error generator. One instance per receiver per drive."""

    def __init__(self, model: GnssErrorModel, rng: np.random.Generator) -> None:
        self._model = model
        self._rng = rng
        self._bias = rng.normal(0.0, model.bias_sigma_m, size=3)
        self._bias[2] *= model.vertical_factor

    @property
    def model(self) -> GnssErrorModel:
        return self._model

    def step(self, dt_s: float) -> np.ndarray:
        """Advance by ``dt_s`` and return the ENU error vector in metres."""
        if dt_s < 0:
            raise ValueError("dt_s must be non-negative")
        m = self._model

        # First-order Gauss-Markov: decay toward zero, re-excited to hold its variance.
        decay = math.exp(-dt_s / m.correlation_time_s)
        driving_sigma = m.bias_sigma_m * math.sqrt(max(0.0, 1.0 - decay * decay))
        self._bias = self._bias * decay + self._rng.normal(0.0, driving_sigma, size=3)
        self._bias[2] = self._bias[2] * 1.0  # vertical scale already applied at init

        white = self._rng.normal(0.0, m.white_sigma_m, size=3)
        white[2] *= m.vertical_factor

        error = self._bias + white

        if self._rng.random() < 1.0 - math.exp(-m.multipath_rate_hz * max(dt_s, 1e-6)):
            direction = self._rng.normal(size=3)
            direction /= np.linalg.norm(direction) or 1.0
            error = error + direction * self._rng.exponential(m.multipath_scale_m)

        return error

    def horizontal_error(self, dt_s: float) -> float:
        e = self.step(dt_s)
        return float(np.hypot(e[0], e[1]))


def mean_horizontal_deviation(
    model: GnssErrorModel, *, samples: int = 20_000, dt_s: float = 1.0, seed: int = 0
) -> float:
    """Mean 2D error magnitude — the statistic the literature reports for crowdsourced GPS."""
    sim = GnssSimulator(model, np.random.default_rng(seed))
    return float(np.mean([sim.horizontal_error(dt_s) for _ in range(samples)]))


#: How a real contributor population is distributed across environments. Weighted toward the
#: canyon because crowdsourced capture concentrates in exactly the dense corridors where GNSS
#: is worst — the coverage argument in the re-spec (7) and the error argument are the same
#: argument. The mix's mean deviation is calibrated against the ~5.5 m reported for
#: crowdsourced camera positions; see docs/02-comparables.md.
CROWDSOURCED_MIX: dict[Environment, float] = {
    Environment.OPEN_SKY: 0.10,
    Environment.SUBURBAN: 0.40,
    Environment.URBAN_CANYON: 0.50,
}


def mix_mean_deviation(mix: dict[Environment, float] | None = None, *, seed: int = 0) -> float:
    weights = mix or CROWDSOURCED_MIX
    total = sum(weights.values())
    return sum(
        (w / total) * mean_horizontal_deviation(PRESETS[env], seed=seed + i)
        for i, (env, w) in enumerate(weights.items())
    )
