"""Observation eligibility and deterministic lightweight deduplication."""

from __future__ import annotations

import math

from smc.imagery.region import Region
from smc.imagery.schema import TIER_A, TIER_B, TIER_C, TIER_REJECT, Observation

ABSOLUTE_MIN_MEGAPIXELS = 2.0
PREFERRED_MEGAPIXELS = 6.0
META_CLASS_MEGAPIXELS = 12.0

#: What the Meta glasses hand an application: 1440x1080, about 1.56 MP.
META_DELIVERY_MEGAPIXELS = 1440 * 1080 / 1e6

#: The working floor, deliberately set a tenth below what the glasses deliver.
#:
#: The strict reading is that an archive image smaller than the glasses' own frame cannot be
#: reduced to match it, so it can never serve as a reference. That is true at the margin and
#: false in practice: a frame at 1.4 MP against a 1.56 MP query is a 5% linear shortfall, which
#: is well inside the scale range feature matching already tolerates, and rejecting it costs
#: real coverage for a difference no downstream step can detect. Coverage is the scarcer
#: resource here -- 96% of lidar-measured kerbs still have no photograph beside them.
INGEST_MIN_MEGAPIXELS = META_DELIVERY_MEGAPIXELS * 0.9


def resolution_tier(megapixels: float | None,
                    *, floor: float = INGEST_MIN_MEGAPIXELS) -> str:
    """Quality tier from source pixels. Missing resolution stays reject-tier.

    The floor tracks the catalogue's own ingest floor rather than a separate constant. When the
    floor was lowered to a tenth below what the glasses deliver, this ladder was left at two
    megapixels, so a frame the catalogue accepted came out labelled ``reject`` -- eligible and
    rejected at once. The audit then flagged it, correctly, as a contradiction.
    """

    if megapixels is None or megapixels < floor:
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

    tier = resolution_tier(observation.original_megapixels, floor=min_megapixels)
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


#: How near two frames must be, in metres, before they are candidates for being the same shot.
#:
#: This is set from what the measurement pipeline needs, not from what looks tidy. Consecutive
#: frames in these sequences sit about two metres apart, and triangulation wants baselines of one
#: to three metres -- so a filter that thinned to one frame per eight metres would delete
#: precisely the stereo partners the kerb measurement depends on. At three metres, a moving
#: camera keeps every frame it takes and only a stationary one repeats a bucket.
REDUNDANCY_SPACING_M = 3.0

#: Compass buckets. Two frames from the same spot facing opposite ways are not duplicates.
HEADING_BUCKETS = 8

#: How many frames one three-metre spot, facing one way, may keep. Generous on purpose: a
#: vehicle waiting at a light, or six cameras firing together on one rig, should not each be
#: treated as new coverage -- but nor should a second pass down the same street in another
#: season be thrown away. This drops the genuinely repeated frame and little else.
SAME_VIEW_LIMIT = 6

_METRES_PER_DEGREE_LAT = 111_320.0


def _viewpoint(observation: Observation) -> tuple:
    """A place and a direction, coarse enough that near-identical frames collide."""
    latitude = observation.latitude or 0.0
    step_lat = REDUNDANCY_SPACING_M / _METRES_PER_DEGREE_LAT
    step_lon = step_lat / max(math.cos(math.radians(latitude)), 1e-6)
    heading = observation.heading_deg
    octant = int((heading % 360) / (360 / HEADING_BUCKETS)) if heading is not None else -1
    return (
        round(latitude / step_lat),
        round((observation.longitude or 0.0) / step_lon),
        octant,
    )


def mark_redundant(observations: list[Observation], *, limit: int = SAME_VIEW_LIMIT) -> int:
    """Flag the fourth and later photograph of the same spot facing the same way.

    Coverage is not a count, but neither is it a cell. A cell holding a thousand frames from one
    drive knows less about a street than one holding twenty from six, and judging that at cell
    scale is too blunt: it discards the mid-block frame precisely where only the corners are
    known. So redundancy is judged at eight metres and one compass octant -- close enough that
    the frames really are of the same thing.

    Nothing is deleted. Rows stay in the catalogue marked ``redundant``, because the fact that a
    place was photographed a thousand times is itself worth knowing, and a later pass asking a
    different question should not have to crawl again to discover it.
    """
    seen: dict[tuple, int] = {}
    marked = 0
    for observation in observations:
        if not observation.eligible:
            continue
        key = _viewpoint(observation)
        count = seen.get(key, 0) + 1
        seen[key] = count
        if count > limit:
            observation.eligible = False
            observation.rejection_reason = "redundant_viewpoint"
            marked += 1
    return marked
