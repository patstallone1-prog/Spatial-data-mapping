"""Count served inventory, not successful fits alone; unknowns stay in denominators."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any


def coverage_report(inventory: list[dict[str, str]]) -> dict[str, Any]:
    """Input rows: stable ID, category, geometry tier, appearance tier.

    The caller must enumerate its complete declared scope (cell/object catalog).
    Library photographs are distinct from actual rectified on-building imagery.
    Percentages describe that inventory only, never unenumerated city geometry.
    """
    geometry = {"reconstructed", "measured_spline", "mapped_primitive", "prior",
                "procedural", "unresolved", "mixed_prior_with_measured_detail", "measured_other",
                "prior_with_image_inferred_detail"}
    appearance = {"real_texture", "rectified_photo_material", "library_photo_material",
                  "procedural", "unknown"}
    groups: dict[str, dict[str, Counter]] = defaultdict(
        lambda: {"geometry": Counter(), "appearance": Counter()})
    seen = set()
    for row in inventory:
        key = row["id"]
        if not key or key in seen or not row.get("category"):
            raise ValueError("inventory must enumerate unique stable object IDs and categories")
        seen.add(key)
        if row.get("geometry") not in geometry or row.get("appearance") not in appearance:
            raise ValueError("unknown inventory tier; do not guess measured/photographic status")
        group = groups[row["category"]]
        group["geometry"][row["geometry"]] += 1
        group["appearance"][row["appearance"]] += 1
    result = {}
    for category, axes in sorted(groups.items()):
        total = sum(axes["geometry"].values())
        result[category] = {"total": total, **{
            axis: {"counts": dict(sorted(counts.items())),
                   "shares": {key: value / total for key, value in sorted(counts.items())}}
            for axis, counts in axes.items()
        }}
    return {"schema": "kerbside.world_coverage/1", "inventory_objects": len(inventory),
            "categories": result}
