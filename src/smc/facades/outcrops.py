"""Evidence-bound visual projections. Canonical geometry/collision never changes."""

from __future__ import annotations

import math

KINDS = {"canted_bay", "box_bay", "rounded_bay", "oriel"}
MAX_DEPTH_M = 1.2


def infer_candidates(openings: list[dict], image_sha256: str | None) -> list[dict]:
    """Triplet window patterns request depth/shape review; never create a bay."""
    windows = sorted((o for o in openings if o["kind"] == "window"), key=lambda o: (o["v"], o["u"]))
    rows = []
    for o in windows:
        row = next((r for r in rows if abs(r[0]["v"] - o["v"]) < 0.4), None)
        if row is None:
            rows.append([o])
        else:
            row.append(o)
    result = []
    for row in rows:
        row.sort(key=lambda o: o["u"])
        for i in range(len(row) - 2):
            left, middle, right = row[i : i + 3]
            if (
                middle["w"] < 1.5 * max(left["w"], right["w"])
                or max(o["h"] for o in (left, middle, right))
                - min(o["h"] for o in (left, middle, right))
                > 0.5
                or not 0 <= middle["u"] - left["u"] - left["w"] <= 0.8
                or not 0 <= right["u"] - middle["u"] - middle["w"] <= 0.8
            ):
                continue
            result.append(
                {
                    "kind": "outcrop_review_candidate",
                    "shape_hint": "canted_or_box_bay",
                    "u": left["u"],
                    "v": min(o["v"] for o in (left, middle, right)),
                    "w": right["u"] + right["w"] - left["u"],
                    "h": max(o["h"] for o in (left, middle, right)),
                    "opening_ids": [o["id"] for o in (left, middle, right)],
                    "image_sha256": image_sha256,
                    "render": False,
                    "depth_m": None,
                    "basis": "window_pattern_not_measured_projection",
                }
            )
    return result


def profile(kind: str, u: float, width: float, depth: float, side_fraction=0.2):
    if kind == "rounded_bay":
        return [
            [
                u + width / 2 + width / 2 * math.cos(math.pi - i * math.pi / 16),
                depth * math.sin(i * math.pi / 16),
            ]
            for i in range(17)
        ]
    inset = width * side_fraction if kind in {"canted_bay", "oriel"} else 0
    return [[u, 0], [u + inset, depth], [u + width - inset, depth], [u + width, 0]]


def contains(point, ring):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = (
            max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
            if dx or dy
            else 0
        )
        if math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < 1e-8:
            return True
        if (a[1] > y) != (b[1] > y) and x < a[0] + (y - a[1]) * dx / dy:
            inside = not inside
    return inside


def crossing(a, b, c, d):
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    return orient(a, b, c) * orient(a, b, d) < -1e-12 and orient(c, d, a) * orient(c, d, b) < -1e-12


def within_property(plan, boundary):
    a, b, n = boundary["a"], boundary["b"], boundary["normal"]
    L = math.dist(a, b)
    world = [
        [a[0] + (b[0] - a[0]) * u / L + n[0] * d, a[1] + (b[1] - a[1]) * u / L + n[1] * d]
        for u, d in plan
    ]
    ring = boundary["ring"]
    if not all(contains(p, ring) for p in world):
        return False
    for p, q in zip(world, world[1:] + world[:1], strict=True):
        if not contains([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], ring):
            return False
        if any(crossing(p, q, r, s) for r, s in zip(ring, ring[1:] + ring[:1], strict=True)):
            return False
    return True


def reviewed_outcrops(controls: dict, width: float, height: float) -> list[dict]:
    results = []
    boundary = controls.get("property_boundary", {})
    valid_boundary = bool(
        boundary.get("source")
        and boundary.get("sha256")
        and len(boundary.get("ring", [])) >= 3
        and all(
            len(p) == 2 and all(isinstance(v, (float, int)) and math.isfinite(v) for v in p)
            for p in boundary.get("ring", [])
        )
        and all(
            len(boundary.get(k, [])) == 2
            and all(isinstance(v, (float, int)) and math.isfinite(v) for v in boundary[k])
            for k in ("a", "b", "normal")
        )
        and math.dist(boundary["a"], boundary["b"]) > 0.1
        and abs(math.hypot(*boundary["normal"]) - 1) < 1e-6
        and abs(
            sum((boundary["b"][i] - boundary["a"][i]) * boundary["normal"][i] for i in range(2))
        )
        < 1e-5
    )
    for item in controls.get("reviewed_outcrops", []):
        if (
            item.get("kind") not in KINDS
            or not item.get("visible")
            or not item.get("reviewer")
            or item.get("image_sha256") != controls.get("image_sha256")
        ):
            continue
        box = item.get("box", [])
        if len(box) != 4 or not all(
            isinstance(v, (float, int)) and math.isfinite(v) and 0 <= v <= 1 for v in box
        ):
            continue
        x0, y0, x1, y1 = box
        if x1 <= x0 or y1 <= y0 or y0 * height < 0.05:
            continue
        u, v, w, h = x0 * width, (1 - y1) * height, (x1 - x0) * width, (y1 - y0) * height
        requested = item.get("depth_m", 0.6)
        if (
            not isinstance(requested, (float, int))
            or not math.isfinite(requested)
            or requested <= 0
        ):
            continue
        maximum = min(requested, MAX_DEPTH_M, w * 0.45)
        side = item.get("side_fraction", 0.2)
        if not isinstance(side, (float, int)) or not 0.08 <= side <= 0.4:
            continue
        depth = maximum if valid_boundary else 0.0
        if depth and not within_property(profile(item["kind"], u, w, depth, side), boundary):
            low, high = 0.0, depth
            for _ in range(24):
                mid = (low + high) / 2
                if within_property(profile(item["kind"], u, w, mid, side), boundary):
                    low = mid
                else:
                    high = mid
            depth = max(
                0, low - 0.01
            )  # Stay inside rather than touching an uncertain cadastral edge.
        constrained = depth < requested - 0.001
        # An existing canonical bay/return is not empty wall on which to add a
        # second projection. Keep both evidence records, suppress the extra mesh.
        prior = controls.get("canonical_front_geometry")
        overlap = canonical_relief_overlap(u, w, prior) if prior else False
        results.append(
            {
                "id": item.get("id", f"outcrop-{len(results)}"),
                "kind": item["kind"],
                "u": u,
                "v": v,
                "w": w,
                "h": h,
                "depth_m": depth,
                "requested_depth_m": requested,
                "profile": profile(item["kind"], u, w, depth, side),
                "render": depth >= 0.03 and not overlap,
                "certainty": "low" if constrained or overlap else "reviewed_shape_inferred_depth",
                "restriction": "canonical_front_relief_needs_depth_review"
                if overlap
                else "property_or_physical_limit"
                if valid_boundary and constrained
                else "property_boundary_missing"
                if not valid_boundary
                else None,
                "position_basis": "image_on_canonical_prior_not_independent_measurement",
                "depth_basis": "inferred_not_measured",
                "image_sha256": controls["image_sha256"],
                "property_source": boundary.get("source"),
                "property_sha256": boundary.get("sha256"),
                "canonical_geometry_modified": False,
                "canonical_world_sha256": prior.get("canonical_world_sha256") if prior else None,
                "canonical_relief_overlap": overlap,
            }
        )
    return results


def canonical_relief_overlap(u: float, width: float, prior: dict) -> bool:
    """Abstain where a reviewed projection would compound existing front relief.

    Only longitudinal portions in the 1.3 m front envelope count; perpendicular
    party walls and the back wall do not. Missing/invalid supplied prior fails
    closed. A 2D footprint cannot prove the relief's floor or photographic depth.
    """
    ring = prior.get("ring", [])
    if (
        not prior.get("canonical_world_sha256")
        or len(ring) < 3
        or not all(
            len(p) == 2
            and all(
                isinstance(v, (float, int)) and not isinstance(v, bool) and math.isfinite(v)
                for v in p
            )
            for p in ring
        )
    ):
        return True
    for a, b in zip(ring, ring[1:] + ring[:1], strict=True):
        du = b[0] - a[0]
        if abs(du) < 0.03:
            continue
        left, right = max(u, min(a[0], b[0])), min(u + width, max(a[0], b[0]))
        if right - left < 0.03:
            continue
        depths = [a[1] + (x - a[0]) / du * (b[1] - a[1]) for x in (left, right)]
        if max(depths) < -1.3 or min(depths) > 1.3:
            continue
        if max(abs(max(-1.3, min(1.3, n))) for n in depths) > 0.05:
            return True
    return False
