"""Canonical world objects: measured geometry, its evidence, and what it compiles to.

See :mod:`smc.world.object` and ``docs/25-geometry-compiler.md``.
"""

from smc.world.object import (
    Detail,
    Evidence,
    EvidenceRef,
    FitRecord,
    GeometryBasis,
    WorldObject,
)

__all__ = ["Detail", "Evidence", "EvidenceRef", "FitRecord", "GeometryBasis", "WorldObject"]
