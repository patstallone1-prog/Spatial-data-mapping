"""Unit conversion.

Every accessibility standard this project is measured against is written in inches and
percent; every piece of geometry the engine produces is in metres. Mixing the two silently
is the most likely source of a wrong answer that still looks plausible, so the conversion
lives in one place and the constants are exact by definition, not rounded.
"""

from __future__ import annotations

# Exact by international agreement (1959).
INCH_M: float = 0.0254
FOOT_M: float = 0.3048


def inches(value: float) -> float:
    """Inches to metres."""
    return value * INCH_M


def feet(value: float) -> float:
    """Feet to metres."""
    return value * FOOT_M


def to_inches(metres: float) -> float:
    """Metres to inches."""
    return metres / INCH_M


def to_feet(metres: float) -> float:
    """Metres to feet."""
    return metres / FOOT_M


def slope_from_ratio(rise: float, run: float) -> float:
    """Slope as a fraction (0.0833 for 1:12). Raises on a zero run."""
    if run == 0:
        raise ValueError("run must be non-zero")
    return rise / run


def ratio_from_slope(slope: float) -> float:
    """Slope fraction to the run of a 1:N ratio. 0.0833 -> 12.0."""
    if slope == 0:
        raise ValueError("slope must be non-zero")
    return 1.0 / slope


# --- Thresholds the product is graded against (docs/camera-only-fusion-respec.md 8.1a) ---

#: Vertical level change below which a discontinuity is passable without treatment.
LEVEL_CHANGE_PASSABLE_M: float = inches(0.25)
#: Above this a level change requires a ramp rather than a bevel.
LEVEL_CHANGE_RAMP_REQUIRED_M: float = inches(0.5)
#: Maximum compliant running slope for a curb ramp (1:12).
RAMP_RUNNING_SLOPE_MAX: float = 1.0 / 12.0
#: Maximum compliant cross slope (1:48).
CROSS_SLOPE_MAX: float = 1.0 / 48.0
#: Minimum clear width, ADA.
CLEAR_WIDTH_MIN_ADA_M: float = inches(36)
#: Minimum clear width, PROWAG.
CLEAR_WIDTH_MIN_PROWAG_M: float = inches(48)
#: Detectable-warning truncated dome nominal geometry.
DOME_DIAMETER_M: float = inches(0.9)
DOME_HEIGHT_M: float = inches(0.2)
