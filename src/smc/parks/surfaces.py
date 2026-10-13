"""Resolve pedestrian materials from explicit evidence, never from the highway category.

Context is deliberately weak. It can suggest sand by a beach or soil in a forest,
but cannot override a tagged asphalt path or a completed official specification.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from itertools import pairwise
from math import hypot, isfinite
from typing import Any

MATERIAL_CLASSES = {
    "asphalt": "paved",
    "concrete": "paved",
    "paving_stones": "paved",
    "paved": "paved",
    "sett": "paved",
    "cobblestone": "paved",
    "gravel": "improved_unpaved",
    "fine_gravel": "improved_unpaved",
    "compacted": "improved_unpaved",
    "decomposed_granite": "improved_unpaved",
    "stabilized_soil": "improved_unpaved",
    "dirt": "natural",
    "earth": "natural",
    "ground": "natural",
    "grass": "natural",
    "woodchips": "natural",
    "sand": "natural",
    "mud": "natural",
    "wood": "boardwalk",
    "boardwalk": "boardwalk",
    "unknown": "unknown",
}
ALIASES = {
    "paving stones": "paving_stones",
    "pavers": "paving_stones",
    "fine gravel": "fine_gravel",
    "decomposed granite": "decomposed_granite",
    "dg": "decomposed_granite",
    "stabilised soil": "stabilized_soil",
    "stabilized soil": "stabilized_soil",
    "wood chips": "woodchips",
    "wood_chips": "woodchips",
    "unpaved": "unknown",
    "soil": "earth",
}
PRIORITY = {
    "official_rpd": 0,
    "osm_surface": 1,
    "imagery_multiview": 2,
    "imagery_auto_multiview": 2.5,
    "imagery_single": 3,
    "imagery_auto_single": 3.5,
    "context": 4,
}
#: Automated segmentation (Mapillary's own classes, no human review) is capped below a
#: reviewed reading of the same photographs.
CAP = {
    "official_rpd": 0.95,
    "osm_surface": 0.85,
    "imagery_multiview": 0.90,
    "imagery_auto_multiview": 0.78,
    "imagery_single": 0.75,
    "imagery_auto_single": 0.6,
    "context": 0.45,
}
CURRENT_STATES = {"existing", "current", "recorded", "as_built", "completed"}


def normalize_material(value: str | None) -> tuple[str, str]:
    """Keep specific material, including sand/mud, but do not guess from mixed/unknown tags."""
    material = (value or "unknown").strip().lower().replace("-", "_")
    material = ALIASES.get(material, material)
    if material not in MATERIAL_CLASSES:
        return "unknown", "unknown"
    return MATERIAL_CLASSES[material], material


@dataclass(frozen=True)
class SurfaceEvidence:
    material: str
    basis: str
    source_id: str
    confidence: float
    source_url: str | None = None
    observed_at: str | None = None
    project_state: str = "existing"
    reviewed: bool = False
    independent_sequences: tuple[str, ...] = ()


def _accepted(evidence: SurfaceEvidence) -> tuple[dict[str, Any] | None, str | None]:
    category, material = normalize_material(evidence.material)
    basis = evidence.basis
    if basis not in PRIORITY or not evidence.source_id:
        return None, "missing_or_unsupported_provenance"
    if category == "unknown":
        return None, "unresolved_material"
    if basis == "official_rpd" and evidence.project_state not in CURRENT_STATES:
        return None, "project_not_current"
    if basis.startswith("imagery_auto"):
        if basis == "imagery_auto_multiview" and len(set(evidence.independent_sequences)) < 2:
            basis = "imagery_auto_single"
    elif basis.startswith("imagery"):
        if not evidence.reviewed:
            return None, "imagery_not_reviewed"
        if basis == "imagery_multiview" and len(set(evidence.independent_sequences)) < 2:
            basis = "imagery_single"
    if not 0 < evidence.confidence <= 1:
        return None, "invalid_confidence"
    return {
        **asdict(evidence),
        "claimed_confidence": evidence.confidence,
        "basis": basis,
        "surface_class": category,
        "surface_material": material,
        "confidence": min(evidence.confidence, CAP[basis]),
    }, None


def _capture_time(item: dict) -> float:
    try:
        # Missing/invalid dates cannot masquerade as current acquisition dates.
        value = datetime.fromisoformat((item.get("observed_at") or "").replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.timestamp()
    except (ValueError, OverflowError):
        return 0


def resolve_surface(evidence: list[SurfaceEvidence], *, highway: str | None = None) -> dict:
    """Rank evidence while retaining alternatives, conflicts and rejection reasons.

    ``highway`` is intentionally not used to assign physical material. Geometry,
    accessibility and appearance certainty remain separate claims.
    """
    accepted, rejected = [], []
    for record in evidence:
        item, reason = _accepted(record)
        if item:
            accepted.append(item)
        else:
            rejected.append({**asdict(record), "reason": reason})
    accepted.sort(
        key=lambda item: (
            PRIORITY[item["basis"]],
            -_capture_time(item),
            -item["confidence"],
            item["source_id"],
        )
    )
    winner = accepted[0] if accepted else None
    return {
        "schema_version": 1,
        "path_type": highway,
        "surface_class": winner["surface_class"] if winner else "unknown",
        "surface_material": winner["surface_material"] if winner else "unknown",
        "basis": winner["basis"] if winner else "unknown",
        "confidence": winner["confidence"] if winner else 0,
        "source_id": winner["source_id"] if winner else None,
        "geometry_changed": False,
        "evidence": accepted,
        "rejected": rejected,
        "conflicts": [
            item
            for item in accepted[1:]
            if winner and item["surface_material"] != winner["surface_material"]
        ],
    }


def osm_surface(
    tags: dict, source_id: str, observed_at: str | None = None
) -> SurfaceEvidence | None:
    """Only an explicit surface tag supplies physical-material evidence."""
    value = tags.get("surface")
    if not value:
        return None
    return SurfaceEvidence(str(value), "osm_surface", source_id, 0.85, observed_at=observed_at)


def contextual_surface(
    *,
    source_id: str,
    beach_distance_m: float | None = None,
    forest: bool = False,
    riverbed: bool = False,
) -> SurfaceEvidence | None:
    """A labelled hypothesis, not a measured surface or a highway-to-material shortcut.

    A path by a stream or through wetland is likely soft and muddy; through woodland or scrub,
    bare earth; by a beach, sand. Capped at 0.45 and ranked below every observation, so it
    only ever fills an otherwise unknown path. A beach *and* woodland is ambiguous: unknown.
    """
    near_beach = beach_distance_m is not None and 0 <= beach_distance_m <= 40
    if near_beach and (forest or riverbed):
        return None
    if near_beach:
        return SurfaceEvidence("sand", "context", source_id, 0.35)
    if riverbed:
        return SurfaceEvidence("mud", "context", source_id, 0.3)
    if forest:
        return SurfaceEvidence("earth", "context", source_id, 0.35)
    return None


def split_path_surfaces(
    points: list[list[float]],
    intervals: list[tuple[float, float, SurfaceEvidence]],
    *,
    canonical_id: str,
    highway: str | None = None,
) -> list[dict]:
    """Split at evidenced material transitions along a metric ENU polyline, without moving it.

    Points may carry elevation as a third coordinate, preserved by interpolation.
    Every original bend is retained. Unknown gaps stay unknown; overlapping or
    contradictory observations go through the same evidence resolver.
    """
    if len(points) < 2 or any(
        len(p) != len(points[0]) or len(p) < 2 or not all(isfinite(v) for v in p) for p in points
    ):
        raise ValueError("need finite metric path coordinates")
    chain = [0.0]
    for a, b in pairwise(points):
        span = hypot(b[0] - a[0], b[1] - a[1])
        if span == 0 and a != b:
            raise ValueError("vertical edge needs a 3D path adapter")
        chain.append(chain[-1] + span)
    length = chain[-1]
    if length <= 0:
        raise ValueError("path has zero horizontal length")
    boundaries = {0.0, length}
    for start, end, _record in intervals:
        if not isfinite(start) or not isfinite(end) or start < 0 or end > length or end <= start:
            raise ValueError("surface interval outside canonical path")
        boundaries.update((start, end))

    def station(distance: float) -> list[float]:
        for i in range(1, len(chain)):
            if chain[i] < distance or chain[i] == chain[i - 1]:
                continue
            t = (distance - chain[i - 1]) / (chain[i] - chain[i - 1])
            return [a + t * (b - a) for a, b in zip(points[i - 1], points[i], strict=True)]
        return points[-1].copy()

    out = []
    cuts = sorted(boundaries)
    for start, end in pairwise(cuts):
        middle = (start + end) / 2
        active = [record for lo, hi, record in intervals if lo <= middle < hi]
        geometry = [
            station(start),
            *[p.copy() for s, p in zip(chain, points, strict=True) if start < s < end],
            station(end),
        ]
        out.append(
            {
                "id": f"{canonical_id}:surface:{float(start).hex()}:{float(end).hex()}",
                "canonical_id": canonical_id,
                "range_m": [start, end],
                "points": geometry,
                **resolve_surface(active, highway=highway),
            }
        )
    return out
