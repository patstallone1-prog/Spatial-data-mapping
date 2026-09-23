"""Bounded visual-only facade displacement with hard canonical seams."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MAX_FACADE_DISPLACEMENT_M = 0.30
MAX_ACCEPTED_POINT_RESIDUAL_M = 0.45


@dataclass(frozen=True)
class ResidualSample:
    u: float  # 0..1 along canonical facade
    v: float  # 0..1 from ground to roof
    normal_offset_m: float
    weight: float
    source_id: str
    lidar: bool = False


@dataclass(frozen=True)
class ResidualResult:
    offset_m: np.ndarray
    accepted_samples: int
    rejected_samples: int
    independent_sources: int


def fit_facade_residual(samples: list[ResidualSample], shape: tuple[int, int] = (17, 17),
                        *, min_sources: int = 3, iterations: int = 80) -> ResidualResult:
    """Fit a smooth field.  Every perimeter texel remains on the canonical wall."""
    height, width = shape
    if height < 3 or width < 3:
        raise ValueError("residual grid needs an interior")
    accepted = [s for s in samples if 0 <= s.u <= 1 and 0 <= s.v <= 1
                and s.weight > 0 and abs(s.normal_offset_m) <= MAX_ACCEPTED_POINT_RESIDUAL_M]
    sources = {s.source_id for s in accepted}
    if len(sources) < min_sources and not any(s.lidar for s in accepted):
        return ResidualResult(np.zeros(shape, dtype=np.float32), 0, len(samples), len(sources))
    weighted = np.zeros(shape, dtype=np.float64)
    support = np.zeros(shape, dtype=np.float64)
    for sample in accepted:
        x = round(sample.u * (width - 1))
        y = round((1.0 - sample.v) * (height - 1))
        if x in (0, width - 1) or y in (0, height - 1):
            continue
        weighted[y, x] += sample.normal_offset_m * sample.weight
        support[y, x] += sample.weight
    field = np.zeros(shape, dtype=np.float64)
    for _ in range(iterations):
        neighbour = (field[:-2, 1:-1] + field[2:, 1:-1]
                     + field[1:-1, :-2] + field[1:-1, 2:]) / 4.0
        field[1:-1, 1:-1] = (neighbour + weighted[1:-1, 1:-1]) / (1.0 + support[1:-1, 1:-1])
        field[1:-1, 1:-1] = np.clip(field[1:-1, 1:-1],
                                      -MAX_FACADE_DISPLACEMENT_M, MAX_FACADE_DISPLACEMENT_M)
    return ResidualResult(field.astype(np.float32), len(accepted), len(samples) - len(accepted), len(sources))


def detail_supported(source_ids: set[str], *, lidar_support: bool = False) -> bool:
    return lidar_support or len(source_ids) >= 3


def verify_seam(field: np.ndarray, tolerance_m: float = 0.01) -> None:
    if field.ndim != 2 or max(float(np.abs(field[0]).max()), float(np.abs(field[-1]).max()),
                             float(np.abs(field[:, 0]).max()), float(np.abs(field[:, -1]).max())) > tolerance_m:
        raise ValueError("visual displacement detaches from a canonical seam")
