"""Footprint-constrained, explicitly inferred single-family interiors.

The source-plan adapters in ``smc.interiors`` remain observations of their source drawings.
This package creates hypotheses and never writes into those observed templates.
"""

from smc.interiors.inference.engine import infer_house
from smc.interiors.inference.model import HouseInput, StoreyInput

__all__ = ["HouseInput", "StoreyInput", "infer_house"]
