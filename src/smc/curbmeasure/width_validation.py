"""Independent width scoring with whole-street holdouts, not fitted-reference residuals."""
from __future__ import annotations

import hashlib
import math
import statistics


def street_group(name: str) -> str:
    return " ".join(name.upper().replace(".", "").split())


def split_for(name: str) -> str:
    # All segments/sides on a named street stay in one partition across runs.
    digest = hashlib.sha256(("sidewalk-v1:" + street_group(name)).encode()).digest()
    return "untouched_test" if digest[0] < 85 else "development"


def cross_section(rings: list, origin: tuple, tangent: tuple) -> list[tuple[float, float]]:
    """Even-odd line/polygon intersection, including holes; coordinates in metres.

    Return signed offsets normal to the street. Half-open edge tests avoid duplicate
    polygon vertices. No street width/expected sidewalk dimension enters this operation.
    """
    tx, ty = tangent
    length = math.hypot(tx, ty)
    if length < 1e-9:
        raise ValueError("nonzero tangent required")
    tx, ty = tx / length, ty / length
    nx, ny = -ty, tx
    cuts = []
    for ring in rings:
        for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
            ax, ay = a[0] - origin[0], a[1] - origin[1]
            bx, by = b[0] - origin[0], b[1] - origin[1]
            u, v = ax * tx + ay * ty, bx * tx + by * ty
            if (u <= 0 < v) or (v <= 0 < u):
                t = -u / (v - u)
                cuts.append((ax + t * (bx - ax)) * nx + (ay + t * (by - ay)) * ny)
    cuts.sort()
    if len(cuts) % 2:
        return []  # invalid polygon/degeneracy is missing support, never a guessed width
    return [(a, b) for a, b in zip(cuts[::2], cuts[1::2], strict=True) if b - a > .01]


def nearest_side(intervals: list[tuple[float, float]], side: int) -> tuple | None:
    positive = [(a, b) if side > 0 else (-b, -a) for a, b in intervals]
    # A polygon over the street centre or multiple fragments cannot prove the back edge.
    positive = sorted((a, b) for a, b in positive if 1 < a < 35 and b > a)
    if not positive:
        return None
    a, b = positive[0]
    if any(c < b - .01 for c, _ in positive[1:]):
        return None
    return (a, b) if .3 <= b - a <= 12 else None


def summarize(rows: list[dict]) -> dict:
    # Each street contributes one median error, irrespective of pixel/station density.
    groups = {}
    for row in rows:
        groups.setdefault(row["street"], []).append(row["prediction_m"] - row["reference_m"])
    errors = [statistics.median(v) for v in groups.values()]
    absolute = sorted(statistics.mean(abs(x) for x in v) for v in groups.values())
    return {"stations": len(rows), "independent_street_groups": len(errors),
            "street_macro_mae_m": statistics.mean(absolute) if errors else None,
            "street_median_bias_m": statistics.median(errors) if errors else None,
            "street_p95_mae_m": absolute[min(len(absolute) - 1, math.ceil(.95 * len(absolute)) - 1)] if errors else None,
            "warning": "GIS agreement screen, not surveyed physical accuracy; source accuracy unknown"}
