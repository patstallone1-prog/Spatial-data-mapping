"""What a sampled wall colour has to be before it is believed.

A wall's colour is the median of the pixels a photograph shows of it (scripts/
build_building_colours.py). Where the wall projects onto the black band a panorama carries
at its poles, or a frame that came back dark, the median is black -- and 449 buildings in the
corridor were painted #000002, which no wall in daylight is. The floor here says a sample
that dark is not a sample. It is applied twice: when a wall is sampled, where the black
pixels are left out of the median before it is taken; and when a stored sample is read, so
the ones already on disk are refused without resampling every building.
"""

from __future__ import annotations

#: A wall whose median channel is under this, out of 255, is not a wall: it is the band.
MIN_WALL_CHANNEL = 28
#: A pixel with every channel under this is the band, not the wall, and is left out.
BAND_PIXEL_MAX = 6


def believable(hex_colour: str) -> bool:
    """Whether a sampled ``#rrggbb`` is bright enough to have come off a wall."""
    try:
        r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    except (TypeError, ValueError):
        return False
    return (r + g + b) / 3.0 >= MIN_WALL_CHANNEL
