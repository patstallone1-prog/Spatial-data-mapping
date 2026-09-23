"""Geometry-guided visual reconstruction over immutable Kerbside surfaces.

This package deliberately produces visual artifacts beside the canonical world.  A
consumer must use the original geometry for measurements and collision.
"""

from smc.reconstruction.contracts import PILOT_BBOX, PILOT_CHUNKS, Coverage

__all__ = ["PILOT_BBOX", "PILOT_CHUNKS", "Coverage"]
