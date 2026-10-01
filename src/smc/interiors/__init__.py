"""Generic interior layouts: real floor plans, normalised into templates an envelope can take.

The interior pass (``docs/24-scans-interiors-and-reconstruction-readiness.md`` §A7) fits a
layout to each building from its outside -- footprint, storeys, measured windows. The layouts
come from published floor-plan datasets, each read by its own adapter into one schema
(:mod:`smc.interiors.schema`), with its licence carried on every template.
"""

from smc.interiors.schema import LayoutTemplate, Opening, Room, Storey, Structure

__all__ = ["LayoutTemplate", "Opening", "Room", "Storey", "Structure"]
