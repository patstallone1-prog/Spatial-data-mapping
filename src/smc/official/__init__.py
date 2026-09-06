"""San Francisco's own records of its streets, kept separate from what we observed.

The city surveyed these streets long before we photographed them. Where it published the
result, that is a better skeleton than anything recovered from imagery -- and where it did not,
the gap is worth knowing about precisely. This package fetches what is published, converts it
honestly, and compares it against our own measurements without letting either one silently
overwrite the other.
"""

from smc.official.schema import (
    DocumentStatus,
    ExtractionMethod,
    OfficialDocument,
    OfficialFactClass,
    OfficialGeometryFact,
    feet_to_m,
    rank,
)

__all__ = [
    "DocumentStatus", "ExtractionMethod", "OfficialDocument", "OfficialFactClass",
    "OfficialGeometryFact", "feet_to_m", "rank",
]
