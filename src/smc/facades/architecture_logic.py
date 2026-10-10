"""Soft architectural clues and hard display-access checks, never new measurements.

Repeated forms are separate objects of a likely common family. Nearby entrance
patterns prioritize review, but cannot supply hidden stairs or overwrite an anomaly.
"""

from __future__ import annotations

import math
from collections import Counter

MAX_UNSTEPPED_RISE_M = 0.1524  # Six inches; exact decimal avoids an equality roundoff failure.


def front_footprint_frame(points, a, b, normal):
    """Rigidly express a canonical XY ring in the photographic front's UV frame.

    Reject a stretched/skewed basis rather than pretending it preserves the prior.
    This is coordinate conversion, not photo-derived geometry.
    """
    vectors = [a, b, normal, *points]
    if len(points) < 3 or not all(
        len(p) == 2
        and all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in p
        )
        for p in vectors
    ):
        raise ValueError("finite two-dimensional canonical ring and front basis required")
    length = math.dist(a, b)
    if length < 0.1 or abs(math.hypot(*normal) - 1) > 1e-6:
        raise ValueError("unit normal and nonzero front required")
    tangent = [(b[i] - a[i]) / length for i in range(2)]
    if abs(sum(tangent[i] * normal[i] for i in range(2))) > 1e-6:
        raise ValueError("front normal must be perpendicular; refusing skewed prior")
    return [
        [sum((p[i] - a[i]) * axis[i] for i in range(2)) for axis in (tangent, normal)]
        for p in points
    ]


def canonical_front_binding(prior: dict | None, width: float) -> dict:
    """Does this photo frame lie on an outward edge of the current canonical ring?"""
    result = {"status": "unavailable", "geometry_modified": False, "metric_certified": False}
    if prior is None:
        return result
    ring = prior.get("ring", [])
    if (
        not prior.get("canonical_world_sha256")
        or len(ring) < 3
        or not all(
            len(p) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in p)
            for p in ring
        )
    ):
        return {**result, "status": "invalid"}
    signed = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1], strict=True))
    best = 0.0
    if abs(signed) > 0.01:
        for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
            length = math.dist(a, b)
            if length < 0.03 or max(abs(a[1]), abs(b[1])) > 0.06:
                continue
            outward_n = (a[0] - b[0] if signed > 0 else b[0] - a[0]) / length
            overlap = min(width, max(a[0], b[0])) - max(0, min(a[0], b[0]))
            if outward_n >= 0.99:
                best = max(best, overlap)
    return {
        **result,
        "status": "bound" if best > 0.03 else "unbound_or_normal_conflict",
        "overlap_m": best,
        "canonical_world_sha256": prior["canonical_world_sha256"],
    }


class NeighbourIndex:
    """Conservative 75 m candidate buckets; callers still apply exact distance gates.

    Longitude buckets intentionally use equatorial metres. Query reach expands
    with latitude, avoiding a global O(houses²) scan without dropping neighbours.
    """

    def __init__(self, fits):
        self.buckets = {}
        for fit in fits:
            if not fit.get("a"):
                continue
            lon, lat = fit["a"]
            key = (fit.get("region"), math.floor(lon * 111320 / 75), math.floor(lat * 110540 / 75))
            self.buckets.setdefault(key, []).append(fit)

    def near(self, fit):
        if not fit.get("a"):
            return []
        lon, lat = fit["a"]
        ix, iy = math.floor(lon * 111320 / 75), math.floor(lat * 110540 / 75)
        reach = math.ceil(1 / max(0.01, math.cos(math.radians(lat))))
        return [
            other
            for x in range(ix - reach, ix + reach + 1)
            for y in range(iy - 1, iy + 2)
            for other in self.buckets.get((fit.get("region"), x, y), [])
        ]


def door_access(opening: dict, ground: dict | None = None, image_sha256: str | None = None) -> dict:
    """Retain the observed threshold; suppress an unsupported elevated door display."""
    ref = ground or {}
    outside = 0.0
    basis = "canonical_facade_foot_prior_not_measured_outside_ground"
    if (
        ref.get("frame") == "relative_to_facade_foot"
        and ref.get("source")
        and isinstance(ref.get("outside_ground_m"), (float, int))
        and not isinstance(ref["outside_ground_m"], bool)
        and math.isfinite(ref["outside_ground_m"])
    ):
        outside = ref["outside_ground_m"]
        basis = "provenance_bound_outside_ground_control"
    v = opening.get("v")
    valid = isinstance(v, (float, int)) and not isinstance(v, bool) and math.isfinite(v)
    rise = v - outside if valid else None
    recess = opening.get("recess") or {}
    stairs = recess.get("stairs_evidence") or {}
    count = recess.get("steps")
    stair_rise = recess.get("rise_m")
    depth, landing = recess.get("depth_m"), recess.get("landing_depth_m")
    dimensions = (stair_rise, depth, landing)
    supported = bool(
        valid
        and recess.get("door_id") == opening.get("id")
        and recess.get("render_steps") is True
        and image_sha256
        and stairs.get("image_sha256") == image_sha256
        and stairs.get("visible") is True
        and stairs.get("reviewer")
        and recess.get("supported_by")
        and isinstance(count, int)
        and not isinstance(count, bool)
        and 1 <= count <= 30
        and all(
            isinstance(n, (float, int)) and not isinstance(n, bool) and math.isfinite(n)
            for n in dimensions
        )
        and abs(stair_rise - rise) <= 0.025
        and 0.10 <= stair_rise / count <= 0.23
        and landing >= 1.20
        and depth >= count * 0.30 + landing
    )
    allowed = bool(valid and (rise <= MAX_UNSTEPPED_RISE_M or supported))
    return {
        "schema": "kerbside.door_access/1",
        "render_allowed": allowed,
        "rise_m": rise,
        "outside_ground_m": outside,
        "ground_basis": basis,
        "maximum_unstepped_rise_m": MAX_UNSTEPPED_RISE_M,
        "stairs_supported": supported,
        "reason": None if allowed else "raised_door_without_aligned_supported_stairs",
        "geometry_modified": False,
    }


def repeated_forms(fit: dict) -> dict:
    """Compare visible opposite-end forms; never merge them or mirror hidden geometry."""
    width = fit.get("width_m", 0)
    if not isinstance(width, (float, int)) or not math.isfinite(width) or width <= 0:
        return {"pairs": [], "geometry_modified": False}
    shapes = [
        *({**o, "family": o["kind"]} for o in fit.get("outcrops", [])),
        *(
            {**o, "family": o["design"].get("shape_hint", o["design"].get("shape", "unknown"))}
            for o in fit.get("openings", [])
            if o.get("kind") == "window" and o.get("design")
        ),
    ]
    shapes = [
        o
        for o in shapes
        if all(
            isinstance(o.get(k), (float, int)) and math.isfinite(o[k]) for k in ("u", "v", "w", "h")
        )
        and o["w"] > 0
        and o["h"] > 0
    ]
    left = [
        o for o in shapes if o["u"] + o["w"] / 2 < width * (0.4 if o["kind"] == "window" else 0.5)
    ]
    right = [
        o for o in shapes if o["u"] + o["w"] / 2 > width * (0.6 if o["kind"] == "window" else 0.5)
    ]
    candidates = []
    for a in left:
        for b in right:
            if a.get("kind") != b.get("kind"):
                continue
            row = abs(a["v"] + a["h"] / 2 - b["v"] - b["h"] / 2)
            size = max(abs(a[k] - b[k]) / max(a[k], b[k]) for k in ("w", "h"))
            mirror = abs(a["u"] + a["w"] / 2 + b["u"] + b["w"] / 2 - width)
            if (
                row <= 0.25
                and size <= 0.20
                and (a["kind"] != "window" or mirror <= max(0.3, width * 0.08))
            ):
                candidates.append((row + mirror + size, a, b))
    pairs, used = [], set()
    for _, a, b in sorted(candidates, key=lambda item: item[0]):
        identity = ((a["kind"], a["id"]), (b["kind"], b["id"]))
        if any(i in used for i in identity):
            continue
        used.update(identity)
        same = a["family"] == b["family"]
        pairs.append(
            {
                "object_ids": [a["id"], b["id"]],
                "families": [a["family"], b["family"]],
                "status": "compatible_repeated_family" if same else "possible_asymmetry_review",
                "shared_style_hint": a["family"] if same else None,
                "mirror_alignment": abs(a["u"] + a["w"] / 2 + b["u"] + b["w"] / 2 - width)
                <= max(0.3, width * 0.08),
                "separate_objects": True,
                "basis": "visible_same_facade_symmetry_prior_not_independent_evidence",
                "render_new_geometry": False,
            }
        )
    return {"pairs": pairs, "geometry_modified": False, "hidden_counterparts_created": False}


def nearby_entry_pattern(fit: dict, neighbours: list[dict]) -> dict:
    """One reviewed vote per nearby house; matched street/region and oriented facade.

    A supplied block ID is honored. Without it, this is explicitly a nearby
    same-street clue, NOT a verified city-block majority. Unreviewed proposals
    cannot recursively reinforce one another into evidence.
    """
    address = fit.get("address") or {}
    street = address.get("street", "").strip().casefold()
    votes, seen, images = [], set(), set()
    a, b = fit.get("a"), fit.get("b")
    if not street or not fit.get("region") or not a or not b:
        return {"votes": [], "dominant_category": None, "geometry_modified": False}
    east = 111320 * math.cos(math.radians(a[1]))
    vector = ((b[0] - a[0]) * east, (b[1] - a[1]) * 110540)
    length = math.hypot(*vector)
    if length < 0.1:
        return {"votes": [], "dominant_category": None, "geometry_modified": False}
    for other in neighbours:
        identity = (other.get("region"), other.get("building_id"))
        if (
            identity == (fit.get("region"), fit.get("building_id"))
            or identity in seen
            or other.get("region") != fit["region"]
            or (other.get("address") or {}).get("street", "").strip().casefold() != street
            or other.get("review_status") != "reviewed_inferred_visual_parameters"
            or not other.get("image_sha256")
            or other["image_sha256"] in images
            or other["image_sha256"] == fit.get("image_sha256")
            or not other.get("a")
            or not other.get("b")
            or (fit.get("block_id") and other.get("block_id") != fit["block_id"])
        ):
            continue
        distance = math.hypot((other["a"][0] - a[0]) * east, (other["a"][1] - a[1]) * 110540)
        peer = ((other["b"][0] - other["a"][0]) * east, (other["b"][1] - other["a"][1]) * 110540)
        peer_length = math.hypot(*peer)
        if (
            distance > 75
            or peer_length < 0.1
            or sum(x * y for x, y in zip(vector, peer, strict=True)) / (length * peer_length)
            < math.cos(math.radians(15))
        ):
            continue
        categories = set()
        for door in other.get("openings", []):
            recess = door.get("recess") or {}
            if door.get("kind") != "door" or recess.get("category") not in {
                "short",
                "long",
                "overhang",
            }:
                continue
            if not door_access(door, other.get("ground_reference"), other["image_sha256"])[
                "stairs_supported"
            ]:
                continue
            categories.add(recess["category"])
        if len(categories) != 1:
            continue  # One building with several conflicting entries is not several votes.
        seen.add(identity)
        images.add(other["image_sha256"])
        votes.append(
            {
                "building_id": other["building_id"],
                "image_sha256": other["image_sha256"],
                "category": categories.pop(),
                "distance_m": round(distance, 1),
            }
        )
    counts = Counter(v["category"] for v in votes)
    dominant, count = counts.most_common(1)[0] if counts else (None, 0)
    strong = len(votes) >= 3 and count / len(votes) >= 2 / 3
    return {
        "votes": votes,
        "dominant_category": dominant if strong else None,
        "share": count / len(votes) if votes else None,
        "scope": "same_verified_block"
        if fit.get("block_id")
        else "nearby_same_street_not_verified_block",
        "action": "prioritize_entrance_evidence_review"
        if strong
        else "insufficient_reviewed_neighbours",
        "geometry_modified": False,
        "render_steps": False,
        "certainty_increased": False,
    }
