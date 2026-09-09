"""What a photograph is worth, as a vector rather than a grade.

Until now the catalogue ranked its 386,624 frames by ``resolution_tier``: A above twelve
megapixels, B above six, C above the ingest floor. That is a statement about a sensor, and this
project measures kerbs. A twelve megapixel frame pointed at the sky outranked a two megapixel
frame with a kerb across the middle of it, and the ranking had no way to notice.

Value here is task-relative and is kept as its components. Nine of them, each between 0 and 1,
each traceable to one enrichment pass:

  sees_kerb      B7   the kerb line is in the frame -- the thing being measured
  sees_facade    B7   enough wall to rectify
  sees_road      B7   carriageway surface, for width and markings
  unoccluded     B7   not behind a lorry
  has_geometry   B4   a partner at a baseline that would actually fix a depth
  pose_trust     B6   how far this frame's position can be trusted after refinement
  metric_truth   B5   lidar depth exists for it, so it can supervise rather than be supervised
  placed         B3   it resolves to a street, a side and a station
  resolution     --   the old signal, kept, demoted to one term of nine

The scalar is a weighted sum of those, and the weights are the argument: they say the frame is
worth what it can contribute to a kerb measurement. They are stated here so they can be
disagreed with, and the components ship beside the scalar so that a different question can be
asked of the same file without recomputing anything.

Two things this deliberately does not do. It does not delete anything -- a frame with a value of
zero is a frame nothing currently needs, not a frame that is wrong, and the catalogue keeps it.
And it does not overwrite ``resolution_tier``; the tier remains as the source-quality fact it
always was, and stops being used as a proxy for worth.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

#: Megapixels at which the resolution term saturates. The Meta glasses deliver 1.56, and a
#: frame far above that is not proportionally more useful for a kerb three metres away.
RESOLUTION_FULL_MP = 8.0

#: A baseline in this band is what fixes a depth at street distances: closer and the parallax is
#: too small to triangulate, further and the two frames stop seeing the same wall.
BASELINE_LOW_M = 1.0
BASELINE_HIGH_M = 3.0

#: Position uncertainty at which pose trust has halved. Twenty centimetres is the refined
#: target; two metres is raw consumer GPS.
POSE_HALF_SIGMA_M = 0.6

#: The weights. They sum to one, and they are a claim about this project rather than a constant
#: of nature: the kerb is what is being measured, so seeing it and being able to triangulate it
#: are worth more than the sensor that took the picture.
WEIGHTS = {
    "sees_kerb": 0.26,
    "has_geometry": 0.20,
    "pose_trust": 0.14,
    "sees_facade": 0.11,
    "unoccluded": 0.09,
    "placed": 0.07,
    "sees_road": 0.05,
    "metric_truth": 0.05,
    "resolution": 0.03,
}

COMPONENTS = tuple(WEIGHTS)


@dataclass
class ValueVector:
    """One frame's contribution, component by component."""

    observation_uid: str
    sees_kerb: float = 0.0
    sees_facade: float = 0.0
    sees_road: float = 0.0
    unoccluded: float = 0.0
    has_geometry: float = 0.0
    pose_trust: float = 0.0
    metric_truth: float = 0.0
    placed: float = 0.0
    resolution: float = 0.0
    #: Which components were computed from real data rather than left at their default. A frame
    #: the semantic pass never reached scores zero on what it sees, and that is an absence of
    #: evidence -- recording it separately is what stops the two being confused later.
    known: set[str] = field(default_factory=set)

    def scalar(self) -> float:
        return sum(WEIGHTS[name] * getattr(self, name) for name in COMPONENTS)

    def limiting_factor(self) -> str:
        """The component holding this frame back the most, weighted by how much it counts.

        Not simply the smallest component: a frame missing the 3% resolution term is not held
        back by its sensor. This is the term whose absence costs the most, which is the one
        worth doing something about.
        """
        return max(COMPONENTS, key=lambda name: WEIGHTS[name] * (1.0 - getattr(self, name)))

    def confidence(self) -> float:
        """How much of the weight was actually measured rather than defaulted."""
        return sum(WEIGHTS[name] for name in self.known)


def _clamp(value: float) -> float:
    return 0.0 if value < 0.0 else 1.0 if value > 1.0 else value


def geometry_score(n_baseline: int | None, baseline_m: float | None,
                   parallax_deg: float | None) -> float:
    """Whether this frame has a partner it could be triangulated against.

    Having one is most of it; having several is better but not linearly so, because the second
    partner rarely adds a new view of the same wall. The baseline term is a band rather than a
    ramp: two frames a centimetre apart have no parallax, and two frames thirty metres apart are
    not looking at the same thing.
    """
    count = 0.0
    if n_baseline:
        count = 1.0 - math.exp(-float(n_baseline) / 1.6)
    band = 0.0
    if baseline_m is not None and baseline_m > 0:
        if BASELINE_LOW_M <= baseline_m <= BASELINE_HIGH_M:
            band = 1.0
        elif baseline_m < BASELINE_LOW_M:
            band = _clamp(baseline_m / BASELINE_LOW_M)
        else:
            band = _clamp(1.0 - (baseline_m - BASELINE_HIGH_M) / 9.0)
    angle = _clamp((parallax_deg or 0.0) / 12.0)
    return _clamp(0.5 * count + 0.3 * band + 0.2 * angle)


def pose_trust(position_sigma_m: float | None) -> float:
    if position_sigma_m is None or position_sigma_m < 0:
        return 0.0
    return _clamp(1.0 / (1.0 + position_sigma_m / POSE_HALF_SIGMA_M))


def resolution_score(megapixels: float | None) -> float:
    if not megapixels or megapixels <= 0:
        return 0.0
    return _clamp(megapixels / RESOLUTION_FULL_MP)


def build_value(uid: str, *, semantics: dict | None = None, pairs: dict | None = None,
                pose: dict | None = None, lidar: dict | None = None,
                context: dict | None = None, megapixels: float | None = None,
                eligible: bool = True) -> ValueVector:
    """Assemble one frame's value from whatever the enrichment passes know about it."""
    vector = ValueVector(observation_uid=uid)

    if semantics:
        vector.sees_kerb = _clamp(float(semantics.get("kerb_value") or 0.0))
        vector.sees_facade = _clamp(float(semantics.get("facade_value") or 0.0))
        vector.sees_road = _clamp(float(semantics.get("road_value") or 0.0))
        vector.unoccluded = _clamp(1.0 - float(semantics.get("occlusion") or 0.0))
        vector.known.update(("sees_kerb", "sees_facade", "sees_road", "unoccluded"))

    if pairs:
        vector.has_geometry = geometry_score(pairs.get("n_baseline_1_to_3m"),
                                             pairs.get("geometry_baseline_m"),
                                             pairs.get("geometry_parallax_deg"))
        vector.known.add("has_geometry")

    if pose:
        vector.pose_trust = pose_trust(pose.get("position_sigma_m"))
        vector.known.add("pose_trust")

    if lidar:
        # Coverage of the frame by returns, not merely the presence of a row: a lidar frame that
        # projects thirty points into the image is not supervision.
        vector.metric_truth = _clamp(float(lidar.get("image_coverage") or 0.0) * 2.0)
        vector.known.add("metric_truth")

    if context and context.get("segment_id"):
        # Placed on a street, on a side, at a station. The side is the part that matters -- a
        # frame that cannot be assigned to one kerb or the other cannot be used to measure one.
        placed = 0.5
        if context.get("street_side"):
            placed += 0.3
        if context.get("station_m") is not None:
            placed += 0.2
        vector.placed = _clamp(placed)
        vector.known.add("placed")

    vector.resolution = resolution_score(megapixels)
    vector.known.add("resolution")

    if not eligible:
        # An ineligible frame is out of region, undated or provider-deleted. It keeps its
        # components -- they are still true -- and scores zero, because nothing may schedule work
        # against it.
        for name in COMPONENTS:
            setattr(vector, name, 0.0)
    return vector
