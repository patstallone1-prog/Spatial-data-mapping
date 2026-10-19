#!/usr/bin/env python3
"""Compare served regional evidence with the Marina reference and source-side artifacts.

Read-only: never rebuild an active agent's regions or silently upgrade inferred facts.
Fractions use each region's own eligible features, not incomparable raw totals.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGIONS = (
    "sf-corridor",
    "sf-mission",
    "sf-haight-castro",
    "sf-sunset",
    "oakland-downtown",
    "berkeley-downtown",
    "palo-alto-downtown",
    "san-jose-downtown",
)
MEASURED_HEIGHTS = {"lidar_region", "datasf_lidar_median_height"}


def read(path: Path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def fraction(n: int, d: int) -> dict:
    return {"count": n, "of": d, "share": round(n / d, 4) if d else None}


def audit_region(source: Path, published: Path, region: str, *, site: Path | None = None) -> dict:
    """``site`` audits a build that is not published yet -- a cell's own ``site`` folder, as the
    cloud gate does (smc.cloud.gate) -- by the same rules as a published region."""
    if site is not None:
        asset_site = site
    else:
        site = (
            published / "docs" if region == "sf-corridor" else published / "docs" / "regions" / region
        )
        asset_site = site
        app_site = published / "docs/app-regions" / region
        if (app_site / "sf-corridor-3d.json").is_file():
            site = app_site  # The app's expanded Oakland payload outranks its frozen website.
        if region == "oakland-downtown" and site == app_site:
            asset_site = app_site
    payload_path = site / "sf-corridor-3d.json"
    payload = read(payload_path)
    if payload is None:
        return {"region": region, "status": "not_published"}
    base = source / "data" / "regions" / region
    official = source / "data" / "sf_public_works" if region == "sf-corridor" else base / "official"
    ways = payload.get("ways", [])
    buildings = {
        str(w["osm_id"]): w
        for w in ways
        if w.get("kind") == "building" and w.get("osm_id") is not None
    }
    streets = [w for w in ways if w.get("kind") == "street"]
    grades = Counter(row[3] for w in streets for row in w.get("xs", []) if len(row) >= 4)
    bcount = len(buildings)
    colour = read(official / "building_colours.json", {}).get("buildings", {})
    survey = read(official / "facade_survey.json", {}).get("buildings", {})
    height = read(base / "lidar" / "building_heights.json", {})
    if "buildings" in height:
        height = height["buildings"]
    source_colours = set(colour) & buildings.keys()
    not_served = sorted(k for k in source_colours if not buildings[k].get("colour"))
    survey_ids = set(survey) & buildings.keys()
    source_ground = read(official / "ground_cover.json", {})
    ground_path = asset_site / "sf-corridor-ground.json"
    if region == "sf-corridor" and (site / "app-sf-corridor-ground.json").is_file():
        ground_path = site / "app-sf-corridor-ground.json"
    served_ground = read(ground_path, {})
    ground_counts = {
        k: {"source": len(source_ground.get(k, [])), "served": len(served_ground.get(k, []))}
        for k in ("trees", "parks", "yards", "lawns", "front_walks", "courts")
    }
    latest = {}
    journal = base / "lidar" / "cells.jsonl"
    if journal.exists():
        for line in journal.read_text().splitlines():
            if line:
                row = json.loads(line)
                latest[row["cell"]] = row
    errors = [r for r in latest.values() if r.get("error") or r.get("retry")]
    official_sidecar = read(asset_site / "sf-corridor-official.json", {})
    terrain = read(asset_site / "sf-corridor-terrain.json", {})
    metrics = {
        "sampled_colour": fraction(sum(bool(w.get("colour")) for w in buildings.values()), bcount),
        "lidar_height": fraction(
            sum(w.get("height_source") in MEASURED_HEIGHTS for w in buildings.values()), bcount
        ),
        "height_not_default": fraction(
            sum(
                w.get("height_source") not in (None, "inferred_default") for w in buildings.values()
            ),
            bcount,
        ),
        "measured_kerb_stations": fraction(grades["S"] + grades["L"], sum(grades.values())),
        "surveyed_facade_available": fraction(len(survey_ids), bcount),
    }
    context = read(published / "docs/municipal-context.manifest.json", {})
    municipal = next((r for r in context.get("regions", []) if r["region"] == region), {})
    fits = read(published / "docs/sf-corridor-frontage-fits.manifest.json", {})
    fit_count = 0
    for tile in fits.get("tiles", []):
        if tile.get("region") == region or f"/{region}/" in tile.get("path", ""):
            fit_count += len(read(published / "docs" / tile["path"], {}).get("buildings", {}))
    issues = []
    if not_served:
        issues.append(f"{len(not_served)} sampled source colours absent from served buildings")
    for kind, counts in ground_counts.items():
        if counts["source"] > counts["served"]:
            issues.append(
                f"{kind}: {counts['source']} source vs {counts['served']} served; "
                "rebuild not assumed"
            )
    if errors:
        issues.append(f"{len(errors)} latest lidar cells failed or await retry")
    for kind in ("trees", "yards"):
        if not ground_counts[kind]["served"]:
            issues.append(f"no {kind} records in served ground sidecar")
    return {
        "region": region,
        "status": "reference" if region == "sf-corridor" else "audited",
        "payload": {
            "path": str(payload_path.relative_to(published))
            if payload_path.is_relative_to(published) else str(payload_path),
            "sha256": hashlib.sha256(payload_path.read_bytes()).hexdigest(),
        },
        "counts": {
            "buildings": bcount,
            "streets": len(streets),
            "observations": payload.get("summary", {}).get("observations", 0),
            "curb_lines": len(official_sidecar.get("curb_lines", [])),
            "curb_ramps": len(official_sidecar.get("curb_ramps", [])),
        },
        "metrics": metrics,
        "kerb_grades": dict(grades),
        "ground_counts": ground_counts,
        "ground_path": str(ground_path.relative_to(published))
        if ground_path.is_relative_to(published) else str(ground_path),
        "photo_derived_facades": {"count": fit_count, "measured_geometry": False},
        "additional_municipal_evidence": municipal,
        "kerb_share_basis": "Canonical evidence grades; does not imply measured curb shapes are drawn.",
        "terrain": {
            "grid_step_m": terrain.get("frame", {}).get("step_m"),
            "reported_roadway_accuracy": terrain.get("accuracy", {}).get("roadway"),
            "sensor_accuracy_note": terrain.get("sensor_accuracy_note"),
            "no_data_cells": terrain.get("cells_no_data"),
            "filled_cells": terrain.get("cells_filled"),
        },
        "source_colours_missing_ids": not_served,
        "lidar_latest_cells": len(latest),
        "lidar_failed_cells": len(errors),
        "issues": issues,
        "limitations": [
            "OSM height tags are not automatically claimed as measured lidar heights.",
            "Mapped curb ramps/lines do not prove renderer endpoint alignment.",
            "Evidence coverage is not visual quality or independent accuracy.",
            "Source/served ground counts diagnose missing publication, not geometric truth.",
        ],
    }


def audit(source: Path, published: Path) -> dict:
    rows = [audit_region(source, published, region) for region in REGIONS]
    baseline = rows[0]["metrics"]
    for row in rows[1:]:
        if "metrics" not in row:
            continue
        gaps = []
        for name, value in row["metrics"].items():
            ref = baseline[name]["share"]
            share = value["share"]
            if ref and share is not None and share < ref * 0.75:
                gaps.append(name)
        row["below_75_percent_of_reference_share"] = gaps
    return {
        "schema_version": 1,
        "purpose": "regional_evidence_parity_audit",
        "reference": "sf-corridor",
        "regions": rows,
        "all_regions_equal": all(
            not r.get("below_75_percent_of_reference_share")
            and not r.get("issues")
            and r["status"] == "audited"
            for r in rows[1:]
        ),
        "policy": "75% reference-share screen prioritizes ingestion; "
        "never manufactures missing truth",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source-root", type=Path, default=ROOT)
    ap.add_argument("--published-root", type=Path, default=ROOT)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    result = audit(args.source_root, args.published_root)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    for row in result["regions"]:
        print(
            row["region"],
            {k: v["share"] for k, v in row.get("metrics", {}).items()},
            row.get("issues", []),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
