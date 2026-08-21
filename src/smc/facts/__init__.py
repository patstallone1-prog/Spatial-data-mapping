"""The world-facts model — the thing the product actually sells."""

from smc.facts.schema import (
    FactClass,
    Provenance,
    Tier,
    WorldFact,
    tier_for_class,
)

__all__ = ["FactClass", "Provenance", "Tier", "WorldFact", "tier_for_class"]
