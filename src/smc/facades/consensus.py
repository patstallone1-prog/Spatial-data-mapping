"""Cross-view consistency and explicit review queues, not calibrated probabilities."""

from __future__ import annotations

import math

from smc.facades.architecture_logic import door_access


def strict_view_gate(
    candidate: dict, min_storeys: int = 2, reviewed_storeys: int | None = None
) -> dict:
    reasons = []
    if not candidate.get("geometry_pass"):
        reasons.append("broad_geometry_gate_failed")
    for key in ("angle_deg", "edge_angle_deg"):
        value = candidate.get(key)
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value > 35:
            reasons.append(key + "_exceeds_35_or_unknown")
    if not candidate.get("full_front_in_frame"):
        reasons.append("full_front_not_predicted")
    review = candidate.get("review", {})
    pixel_full = bool(candidate.get("verified") and review.get("full_front_visible"))
    if reviewed_storeys is not None and reviewed_storeys < min_storeys:
        reasons.append("fewer_than_two_storeys")
    return {
        "metadata_pass": not reasons,
        "reasons": reasons,
        "max_angle_deg": 35,
        "min_storeys": min_storeys,
        "full_front_pixel_verified": pixel_full,
        "storeys_status": "reviewed"
        if reviewed_storeys is not None
        else "needs_image_storey_review",
        "pass": not reasons
        and pixel_full
        and reviewed_storeys is not None
        and reviewed_storeys >= min_storeys,
    }


def cross_view(best: dict, views: list[dict]) -> dict:
    """Only corroborate the same oriented front. Never copy neighbour dimensions."""
    unique = {v["image_sha256"]: v for v in views}
    usable = []
    for v in unique.values():
        if v["image_sha256"] == best["image_sha256"]:
            continue
        if max(math.dist(v[k], best[k]) for k in ("a", "b")) > 0.000004:
            continue  # Different wall/party wall/reversed frame is not evidence here.
        if abs(v["width_m"] - best["width_m"]) > 0.2 or abs(v["height_m"] - best["height_m"]) > 0.1:
            continue
        usable.append(v)
    rows = []
    for o in best["openings"]:
        matches = []
        for v in usable:
            compatible = [p for p in v["openings"] if p["kind"] == o["kind"]]
            if not compatible:
                continue

            def distance(p, reference=o):
                return math.hypot(
                    p["u"] + p["w"] / 2 - reference["u"] - reference["w"] / 2,
                    p["v"] + p["h"] / 2 - reference["v"] - reference["h"] / 2,
                )

            other = min(compatible, key=distance)
            error = distance(other)
            if error < max(o["w"], o["h"]) * 0.6:
                matches.append(
                    {
                        "image_sha256": v["image_sha256"],
                        "centre_residual_m": error,
                        "size_residual_m": max(abs(other[k] - o[k]) for k in ("w", "h")),
                        "consistent": error <= 0.25
                        and max(abs(other[k] - o[k]) for k in ("w", "h")) <= 0.25,
                    }
                )
        rows.append(
            {
                "opening_id": o["id"],
                "independent_pixel_views": len(matches) + 1,
                "comparisons": matches,
            }
        )
    return {
        "distinct_pixel_views": len(unique),
        "same_front_comparison_views": len(usable),
        "openings": rows,
        "geometry_modified": False,
        "basis": "registered_prior_consistency_not_triangulated_metric_truth",
    }


def certainty(fit: dict, gate: dict) -> dict:
    reasons = list(gate.get("reasons", []))
    if fit.get("front_geometry_binding", {}).get("status") in {"invalid", "unbound_or_normal_conflict"}:
        reasons.append("photo_front_not_bound_to_current_canonical_geometry")
    if not gate.get("pass"):
        reasons.append("front_or_two_storeys_not_image_verified")
    if not fit["openings"]:
        reasons.append("no_resolved_openings")
    if fit["appearance"].get("material", "unknown") == "unknown":
        reasons.append("material_unresolved")
    if any(b.get("material", "unknown") == "unknown" for b in fit["appearance"].get("bands", [])):
        reasons.append("floor_material_unresolved")
    if any(o.get("size_anomaly_requires_review") for o in fit["openings"]):
        reasons.append("opening_size_anomaly")
    if any(o.get("type_requires_review") and not o.get("type_reviewed") for o in fit["openings"]):
        reasons.append("entrance_or_garage_type_needs_review")
    if any(
        not door_access(o, fit.get("ground_reference"), fit.get("image_sha256"))["render_allowed"]
        for o in fit["openings"]
        if o.get("kind") in {"door", "gated_entry_candidate", "garage_candidate"}
    ):
        reasons.append("raised_door_without_aligned_supported_stairs")
    if any(o.get("access_check", {}).get("stairs_supported") for o in fit["openings"]):
        # Photo flat panels currently have no connected, footprint-validated stair consumer.
        reasons.append("photo_stair_runtime_connection_needs_review")
    if any(
        c["status"] != "consistent" for c in fit.get("sanity_checks", {}).get("window_columns", [])
    ):
        reasons.append("window_column_conflict")
    if any(
        not c["consistent"]
        for o in fit.get("multiview", {}).get("openings", [])
        for c in o["comparisons"]
    ):
        reasons.append("cross_view_conflict")
    # High is a reviewed visual tier, NOT an inch-accuracy or measured-fact label.
    if fit.get("review_status") != "reviewed_inferred_visual_parameters":
        reasons.append("render_alignment_not_reviewed")
    if any(o.get("certainty") == "low" for o in fit.get("outcrops", [])):
        reasons.append("outcrop_property_or_physical_limit")
    if fit.get("outcrop_candidates") and not fit.get("outcrops"):
        reasons.append("outcrop_shape_and_depth_need_review")
    return {
        "tier": "low" if reasons else "high",
        "reasons": sorted(set(reasons)),
        "calibrated_probability": None,
        "metric_basis": "canonical_priors; not independent measurement",
        "ai_review_required": bool(reasons),
        "keep_raw_locally": bool(reasons),
    }


def neighbourhood_reference(fit: dict, neighbours: list[dict]) -> dict:
    """Nearby same-entrance dimensions flag anomalies without making them typical."""
    matches = []
    for other in neighbours:
        if other.get("building_id") == fit.get("building_id") or not other.get("a"):
            continue
        lat = math.radians(fit["a"][1])
        metres = math.hypot(
            (other["a"][0] - fit["a"][0]) * 111320 * math.cos(lat),
            (other["a"][1] - fit["a"][1]) * 110540,
        )
        if metres > 75:
            continue
        for door in fit["openings"]:
            if door["kind"] not in {"door", "garage_candidate", "gated_entry_candidate"}:
                continue
            peers = [p for p in other["openings"] if p["kind"] == door["kind"]]
            for p in peers:
                matches.append(
                    {
                        "opening_id": door["id"],
                        "neighbour_id": other["building_id"],
                        "distance_m": round(metres, 1),
                        "width_difference_m": round(abs(p["w"] - door["w"]), 3),
                        "height_difference_m": round(abs(p["h"] - door["h"]), 3),
                        "basis": "neighbour_prior_not_this_house_measurement",
                    }
                )
    return {"comparisons": matches[:20], "geometry_modified": False}
