"""Realistic walking pace.

Nobody walks at a constant speed. Real pedestrian pace drifts continuously, dips at kerbs and
shop windows, stops dead at crossings, and speeds up on a clear stretch. A capture policy
validated at a fixed 1.4 m/s is validated against a pedestrian who does not exist.

This matters specifically because capture is gated on *distance travelled*. That gate was chosen
over a clock precisely so pace variation would stop mattering — but the claim has to be tested
against varying pace, not asserted. If frame spacing tracked speed, triangulation baselines
would swing with every stride and the geometry would degrade exactly where people slow down,
which is at the kerbs and crossings the product is about.

The model is an Ornstein-Uhlenbeck process around a preferred speed, plus Poisson stop events.
OU rather than white noise because pace is *correlated*: a person who is walking slowly now is
likely to still be walking slowly in a second, and independent per-step noise would average out
over any window and hide the problem.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True, slots=True)
class GaitConfig:
    """Pedestrian pace parameters. Defaults are ordinary adult walking."""

    preferred_speed_mps: float = 1.35
    #: Standard deviation of sustained pace variation.
    speed_sigma_mps: float = 0.28
    #: How quickly pace returns to preferred. Shorter means twitchier.
    correlation_time_s: float = 6.0
    #: Expected full stops per second (crossings, doorways, conversations).
    stop_rate_hz: float = 0.012
    stop_duration_mean_s: float = 9.0
    min_speed_mps: float = 0.0
    max_speed_mps: float = 2.4


class GaitSimulator:
    """Generates a speed trace for one walk."""

    def __init__(self, config: GaitConfig | None = None, rng: np.random.Generator | None = None):
        self._config = config or GaitConfig()
        self._rng = rng or np.random.default_rng(0)
        self._speed = self._config.preferred_speed_mps
        self._stop_remaining_s = 0.0

    @property
    def is_stopped(self) -> bool:
        return self._stop_remaining_s > 0.0

    def step(self, dt_s: float) -> float:
        """Advance and return the current speed."""
        if dt_s <= 0:
            raise ValueError("dt_s must be positive")
        config = self._config

        if self._stop_remaining_s > 0.0:
            self._stop_remaining_s -= dt_s
            return 0.0

        if self._rng.random() < config.stop_rate_hz * dt_s:
            self._stop_remaining_s = float(self._rng.exponential(config.stop_duration_mean_s))
            return 0.0

        decay = np.exp(-dt_s / config.correlation_time_s)
        driving = config.speed_sigma_mps * np.sqrt(max(0.0, 1.0 - decay**2))
        deviation = (self._speed - config.preferred_speed_mps) * decay + self._rng.normal(
            0.0, driving
        )
        self._speed = float(
            np.clip(
                config.preferred_speed_mps + deviation, config.min_speed_mps, config.max_speed_mps
            )
        )
        return self._speed

    def trace(self, duration_s: float, dt_s: float = 0.05) -> np.ndarray:
        """A full speed trace, for analysis and tests."""
        return np.array([self.step(dt_s) for _ in range(int(duration_s / dt_s))])
