"""Strict, auditable street-front photograph selection, not a reconstruction verdict.

All input frames/sequence links survive in the source catalogue. This module ranks
views for a different task; it never spatially thins a photogrammetry flight.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import numpy as np

from smc.facades.geometry import Camera, Wall, project, walls_of

FREE_LICENSES = {
    "CC0-1.0",
    "CC-BY-4.0",
    "CC-BY-SA-4.0",
    "CC-BY-SA-3.0",
    "CC-BY-3.0",
    "Public-Domain",
    "etalab-2.0",
}


@dataclass(frozen=True)
class FrontagePolicy:
    max_angle_deg: float = 35.0
    max_edge_angle_deg: float = 55.0
    min_distance_m: float = 3.0
    max_distance_m: float = 55.0
    min_frame_coverage: float = 0.90
    min_pixels_per_m: float = 12.0
    max_occlusion: float = 0.15
    border_fraction: float = 0.015
    years: int = 10

    def __post_init__(self):
        if (
            not 0 < self.max_angle_deg < 90
            or not self.max_angle_deg <= self.max_edge_angle_deg < 90
        ):
            raise ValueError("invalid angular thresholds")
        if not 0 < self.min_distance_m < self.max_distance_m:
            raise ValueError("invalid distance thresholds")
        if not 0 < self.min_frame_coverage <= 1 or not 0 <= self.max_occlusion < 1:
            raise ValueError("invalid coverage thresholds")
        if self.years < 1 or self.min_pixels_per_m <= 0 or not 0 <= self.border_fraction < 0.2:
            raise ValueError("invalid sampling/date policy")


def capture_date(value: Any) -> datetime | None:
    """Capture epoch, NEVER upload/ingestion date. Missing/naive stays unknown."""
    try:
        date = (
            value
            if isinstance(value, datetime)
            else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        )
        return date.astimezone(UTC) if date.utcoffset() is not None else None
    except (ValueError, TypeError, OverflowError):
        return None


def date_gate(
    value: Any, now: datetime, policy: FrontagePolicy, landmark: bool = False
) -> str | None:
    date = capture_date(value)
    if date is None:
        return "capture_date_unknown"
    if date > now:
        return "future_capture"
    try:
        cutoff = now.replace(year=now.year - policy.years)
    except ValueError:  # February 29 -> February 28, not a drifting 3650-day approximation.
        cutoff = now.replace(year=now.year - policy.years, day=28)
    return "older_than_ten_years" if date < cutoff and not landmark else None


def nearest_point(a, b, p):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(
        0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / max(dx * dx + dy * dy, 1e-12))
    )
    return a[0] + t * dx, a[1] + t * dy


def street_front(wall: Wall, segments: list[tuple]) -> tuple[float, str] | None:
    """A public street lies outside and roughly parallel to this facade.

    Walkways/parking aisles/private drives do not establish a street frontage.
    Party walls/back yards aren't fronts just because a camera can see them.
    """
    mx, my = wall.midpoint
    best = None
    tx, ty = (wall.b[0] - wall.a[0]) / wall.length_m, (wall.b[1] - wall.a[1]) / wall.length_m
    for a, b, name in segments:
        qx, qy = nearest_point(a, b, (mx, my))
        dx, dy = qx - mx, qy - my
        dist = math.hypot(dx, dy)
        out = dx * wall.normal[0] + dy * wall.normal[1]
        road_len = math.dist(a, b)
        if not 2 <= dist <= 40 or out / max(dist, 1e-9) < math.cos(math.radians(45)):
            continue
        if road_len < 1 or abs(((b[0] - a[0]) * tx + (b[1] - a[1]) * ty) / road_len) < math.cos(
            math.radians(45)
        ):
            continue
        if best is None or dist < best[0]:
            best = (dist, name)
    return best


def wall_samples(wall: Wall, nx: int = 11, nz: int = 9) -> np.ndarray:
    t, z = np.meshgrid(np.linspace(0, 1, nx), np.linspace(0, wall.height_m, nz))
    return np.column_stack(
        (
            wall.a[0] + t.ravel() * (wall.b[0] - wall.a[0]),
            wall.a[1] + t.ravel() * (wall.b[1] - wall.a[1]),
            z.ravel(),
        )
    )


def frontage_envelopes(ring, height_m, building_index, segments):
    """Join fragmented/bay-window frontage; tiny panels are not a whole house.

    A selection prior, NEVER measured geometry. Corner fronts stay separate;
    require at least 80% of the building's width projected onto the facade axis.
    """
    groups = []
    for wall in walls_of(ring, height_m, building_index, min_length_m=0.5):
        road = street_front(wall, segments)
        if not road:
            continue
        for group in groups:
            first = group[0][0]
            if (
                road[1] == group[0][1][1]
                and np.dot(first.normal, wall.normal) >= math.cos(math.radians(12))
                and abs(np.dot(np.subtract(first.midpoint, wall.midpoint), first.normal)) <= 4
            ):
                group.append((wall, road))
                break
        else:
            groups.append([(wall, road)])
    fronts = []
    for group in groups:
        first = group[0][0]
        normal = np.asarray(first.normal)
        tangent = (np.asarray(first.b) - first.a) / first.length_m
        points = np.asarray([p for wall, _ in group for p in (wall.a, wall.b)])
        along, depth = points @ tangent, points @ normal
        entire = np.asarray(ring) @ tangent
        if along.max() - along.min() < (entire.max() - entire.min()) * 0.8:
            continue
        offset = depth.max()
        wall = Wall(
            building_index,
            first.wall_index,
            tuple(tangent * along.min() + normal * offset),
            tuple(tangent * along.max() + normal * offset),
            first.normal,
            height_m,
        )
        if wall.length_m >= 4:
            fronts.append((wall, group[0][1]))
    return fronts


DEFAULT_POLICY = FrontagePolicy()


def assess_view(
    wall: Wall,
    camera: Camera,
    row: dict,
    *,
    now: datetime,
    policy: FrontagePolicy = DEFAULT_POLICY,
    landmark: dict | None = None,
    posed: bool = False,
    blocked: bool = False,
) -> dict:
    """Predict view geometry; unknown pose/occlusion can NEVER silently pass review."""
    reasons = []
    issue = date_gate(row.get("captured_at"), now, policy, landmark is not None)
    if issue:
        reasons.append(issue)
    if row.get("license_id") not in FREE_LICENSES or not row.get("attribution"):
        reasons.append("rights_or_attribution_unknown")
    if row.get("availability_status") == "provider_deleted":
        reasons.append("provider_deleted")
    # Redundancy is not rejection for this task; nearby distinct frames remain valuable.
    if not row.get("eligible", True) and row.get("rejection_reason") not in (
        "redundant_viewpoint",
        "exact_duplicate",
    ):
        reasons.append("source_ineligible")
    if blocked:
        reasons.append("building_blocks_sightline")
    mx, my = wall.midpoint
    dx, dy = camera.x - mx, camera.y - my
    dist = math.hypot(dx, dy)
    standoff = dx * wall.normal[0] + dy * wall.normal[1]
    angle = math.degrees(math.acos(max(-1, min(1, standoff / max(dist, 1e-9)))))
    edge_angle = max(
        math.degrees(
            math.acos(
                max(
                    -1,
                    min(
                        1,
                        ((camera.x - x) * wall.normal[0] + (camera.y - y) * wall.normal[1])
                        / max(math.hypot(camera.x - x, camera.y - y), 1e-9),
                    ),
                )
            )
        )
        for x, y in (wall.a, wall.b)
    )
    if standoff < policy.min_distance_m or dist > policy.max_distance_m:
        reasons.append("distance")
    if angle > policy.max_angle_deg or edge_angle > policy.max_edge_angle_deg:
        reasons.append("too_oblique")
    points = wall_samples(wall)
    u, v, valid = project(camera, points)
    # A panorama seam wraps; it isn't an image border and must not split a facade in half.
    bx, by = camera.width * policy.border_fraction, camera.height * policy.border_fraction
    valid &= (v >= by) & (v < camera.height - by)
    if not camera.spherical:
        valid &= (u >= bx) & (u < camera.width - bx)
    coverage = float(valid.mean())
    full = bool(valid.all())
    if coverage < policy.min_frame_coverage:
        reasons.append("front_cut_off")
    # Actual angular pixel sampling, not megapixels alone.
    ppm = (
        camera.width / (2 * math.pi)
        if camera.spherical
        else camera.focal_px or camera.width / (2 * math.tan((camera.hfov_rad or 1.2) / 2))
    ) / max(dist, 1e-9)
    ppm *= max(0, math.cos(math.radians(angle)))
    if ppm < policy.min_pixels_per_m:
        reasons.append("insufficient_detail")
    rank = [
        int(full),
        round(coverage, 5),
        -int(angle // 10),
        round(ppm, 3),
        round(math.cos(math.radians(angle)), 5),
        round(-dist, 3),
        str(row.get("captured_at") or ""),
    ]
    return {
        "geometry_pass": not reasons,
        "reasons": reasons,
        "full_front_in_frame": full,
        "full_front_basis": "predicted from canonical height; pixel/human confirmation required",
        "frame_coverage": round(coverage, 5),
        "angle_deg": round(angle, 3),
        "edge_angle_deg": round(edge_angle, 3),
        "distance_m": round(dist, 3),
        "pixels_per_m": round(ppm, 3),
        "rank": rank,
        "pose_status": "provider_solved" if posed else "estimated_or_incomplete",
        "visibility_status": "not_pixel_verified",
        "verified": False,
        "landmark_exception": landmark,
        "sampling_basis": "canonical wall and camera; not independent geometry truth",
    }


def apply_review(
    result: dict, *, image_sha256: str, review: dict | None, policy: FrontagePolicy
) -> dict:
    """Only image-bound human review can promote a view; model masks are screening."""
    out = dict(result)
    if not review:
        return out
    if review.get("image_sha256") != image_sha256 or not review.get("reviewer"):
        out["visibility_status"] = "review_hash_or_reviewer_invalid"
        return out
    fraction = review.get("occlusion_fraction")
    if (
        not isinstance(fraction, (int, float))
        or not math.isfinite(fraction)
        or not 0 <= fraction <= 1
    ):
        out["visibility_status"] = "review_occlusion_invalid"
        return out
    out["visibility_status"] = "human_reviewed"
    out["review"] = review
    out["verified"] = bool(
        result["geometry_pass"]
        and result["pose_status"] == "provider_solved"
        and fraction <= policy.max_occlusion
        and review.get("front_matches_building") is True
        and review.get("openings_legible") is True
        and review.get("full_front_visible") is True
        and review.get("privacy_safe") is True
    )
    return out
