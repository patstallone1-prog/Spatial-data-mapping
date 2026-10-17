"""Dormant gap-region adapters using the established bounded ingestion pipeline.

Planning performs no network access and never adds regions to the active registry.
Envelopes intentionally include some water/nature; discovery must classify those
before deciding which cells justify urban ingestion. Sources are capabilities, not
claims that new cities have already been measured.
"""
from __future__ import annotations

import math

from smc.imagery.region import BBox, grid_regions

ADAPTERS = {
    "san-francisco": {"municipal": "existing DataSF/SFMTA adapters", "lidar": "CA_SanFrancisco_1_B23"},
    "san-mateo-county": {"municipal": "discovery required; no invented municipal endpoint", "lidar": "3DEP spatial collection discovery"},
    "santa-clara-county": {"municipal": "San Jose layers only inside their verified coverage; other cities require discovery", "lidar": "CA_SantaClaraCounty_2020"},
    "alameda-county": {"municipal": "Berkeley/Oakland adapters only inside their verified coverage", "lidar": "3DEP Alameda collection discovery"},
}


def subtract(box: list[float], cut: list[float]) -> list[list[float]]:
    s, w, n, e = box
    cs, cw, cn, ce = cut
    a, b, c, d = max(s, cs), max(w, cw), min(n, cn), min(e, ce)
    if a >= c or b >= d:
        return [box]
    return [v for v in ([s, w, a, e], [c, w, n, e], [a, w, c, b], [a, d, c, e])
            if v[0] < v[2] and v[1] < v[3]]


def plan_gaps(manifest: dict, built: list[dict], cell_km: float = 2.5) -> dict:
    if not math.isfinite(cell_km) or not .25 <= cell_km <= 5:
        raise ValueError("gap jobs must remain between 250 m and 5 km")
    if manifest.get("intake_enabled") is not False:
        raise ValueError("planning manifest must explicitly disable intake")
    covered = [r["bbox"] for r in built if r.get("built") and r.get("bbox")]
    jobs = []
    # Also subtract earlier planned envelopes, avoiding duplicate intake at overlaps.
    for region in manifest["regions"]:
        adapter = ADAPTERS[region["adapter"]]
        pieces = [region["bbox"]]
        for cut in covered:
            pieces = [p for box in pieces for p in subtract(box, cut)]
        for part, box in enumerate(pieces):
            for cell in grid_regions(BBox(*box), cell_km, f"{region['name']}-p{part}"):
                b = cell.bbox
                jobs.append({"name": cell.name, "bbox": [b.south, b.west, b.north, b.east],
                             "area_km2": b.area_km2, "adapter": region["adapter"],
                             "source_roles": {**adapter, "osm": "existing bounded OSM adapter",
                                              "imagery": "existing multi-provider provenance registry"},
                             "stage_order": ["discover", "osm", "terrain", "lidar", "imagery", "official", "build", "audit"],
                             "state": "planned_intake_disabled", "reason": region["reason"]})
        covered.append(region["bbox"])
    return {"schema": "kerbside.gap_plan/1", "intake_started": False, "cell_km": cell_km,
            "jobs": jobs, "area_km2": sum(j["area_km2"] for j in jobs),
            "note": "Planning area includes water/nature; no new measured coverage claimed."}
