"""Observation eligibility and deterministic lightweight deduplication."""

from __future__ import annotations

from smc.imagery.region import Region
from smc.imagery.schema import TIER_A, TIER_B, TIER_C, TIER_REJECT, Observation

ABSOLUTE_MIN_MEGAPIXELS = 2.0
PREFERRED_MEGAPIXELS = 6.0
META_CLASS_MEGAPIXELS = 12.0

#: What the Meta glasses hand an application: 1440x1080, about 1.56 MP. It is the floor for a
#: reference frame, because an archive image smaller than this cannot be reduced to match what a
#: wearer's camera delivers -- it is already smaller, and upscaling it would invent detail the
#: photograph never held.
META_DELIVERY_MEGAPIXELS = 1440 * 1080 / 1e6


def resolution_tier(megapixels: float | None) -> str:
    """Quality tier from source pixels. Missing resolution stays reject-tier."""

    if megapixels is None or megapixels < ABSOLUTE_MIN_MEGAPIXELS:
        return TIER_REJECT
    if megapixels >= META_CLASS_MEGAPIXELS:
        return TIER_A
    if megapixels >= PREFERRED_MEGAPIXELS:
        return TIER_B
    return TIER_C


def mark_eligibility(
    observation: Observation, region: Region, *, min_megapixels: float = ABSOLUTE_MIN_MEGAPIXELS
) -> Observation:
    """Apply v1 source-quality gates without inventing missing provider facts."""

    tier = resolution_tier(observation.original_megapixels)
    observation.resolution_tier = tier
    reasons: list[str] = []
    if not region.bbox.contains(observation.latitude, observation.longitude):
        reasons.append("outside_region")
    if not observation.provider_image_id:
        reasons.append("missing_image_id")
    megapixels = observation.original_megapixels
    if megapixels is None or megapixels < min_megapixels:
        reasons.append(f"below_{min_megapixels:g}mp")
    if observation.quality_status and "deleted" in observation.quality_status.lower():
        reasons.append("provider_deleted")
    observation.eligible = not reasons
    observation.rejection_reason = ",".join(reasons) if reasons else None
    return observation


def exact_dedupe(observations: list[Observation]) -> list[Observation]:
    """Collapse only definite duplicates: same provider instance and image id."""

    seen: set[tuple[str, str, str]] = set()
    out: list[Observation] = []
    for obs in observations:
        key = (obs.provider, obs.provider_instance, obs.provider_image_id)
        if key in seen:
            obs.eligible = False
            obs.rejection_reason = "exact_duplicate"
            continue
        seen.add(key)
        out.append(obs)
    return out
