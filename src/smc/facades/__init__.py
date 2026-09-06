"""Turning ingested street photographs into building facades.

The map has, until now, dressed every building in a procedural texture: a window grid drawn
into a canvas, coloured from San Francisco's building stock by percentage. That makes a street
look inhabited, and it describes no particular building. This package does the other thing --
it finds the photograph that actually looks at a given wall, and rectifies that wall out of it.
"""

from smc.facades.geometry import (
    Camera,
    Wall,
    LocalFrame,
    project,
    score_view,
    walls_of,
)

__all__ = ["Camera", "LocalFrame", "Wall", "project", "score_view", "walls_of"]
