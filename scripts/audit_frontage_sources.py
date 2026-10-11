#!/usr/bin/env python3
"""Continuous private storefront/name and cell audit; publication is an explicit release.

Does not ingest restricted pixels, move canonical geometry, invent unnamed shops,
or claim a reference-model comparison has run when the model is unavailable.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import runpy
import sys
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.geometry import LocalFrame  # noqa: E402


def atomic(path: Path, value: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    with temp.open("w") as stream:
        json.dump(value, stream, indent=1, default=str)
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def geometry_hash(ways: list[dict]) -> str:
    """Only name attachment is allowed; catch heights, curbs or any other changed field."""
    return hashlib.sha256(json.dumps(
        [{k: v for k, v in way.items() if k not in {"shops", "overture_places"}}
         for way in ways], sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()


def audit_region(payload: dict, enrichment: list[dict], region: str, namespace: dict) -> dict:
    ways = copy.deepcopy(payload["ways"])
    before_hash = geometry_hash(ways)
    initial_names = sum(len(w.get("shops") or []) for w in ways if w.get("kind") == "building")
    by_id = {str(row.get("osm_id")): row for row in enrichment if row.get("osm_id")}
    withheld = 0
    for way in ways:
        if way.get("kind") != "building":
            continue
        matched = by_id.get(str(way.get("osm_id")))
        if not matched:
            continue
        # Reference name data cannot move the building or silently replace its height.
        places = matched.get("overture_places") or []
        eligible = [p for p in places if p.get("licence") == "CDLA-Permissive-2.0"
                    and isinstance(p.get("confidence"), (int, float))
                    and p["confidence"] >= 0.8]
        withheld += len(places) - len(eligible)
        way["overture_places"] = eligible
    namespace["attach_shopfronts"](ways)
    namespace["attach_named_places"](ways)
    if geometry_hash(ways) != before_hash:
        raise ValueError("name pass changed canonical world fields")
    bbox = payload["bbox"]
    frame = LocalFrame((bbox["north"] + bbox["south"]) / 2,
                       (bbox["east"] + bbox["west"]) / 2)
    cells, named, unresolved = defaultdict(list), {}, []
    buildings = [w for w in ways if w.get("kind") == "building"]
    for way in buildings:
        key = str(way.get("osm_id"))
        shops = way.get("shops") or []
        if shops:
            named[key] = {"address": way.get("address"), "shops": shops}
        elif way.get("archetype") in {"retail", "restaurant"}:
            unresolved.append({"building_id": key, "address": way.get("address"),
                               "reason": "no_source_matched_business_name"})
        centroid = way.get("centroid")
        if not centroid:
            continue
        x, y = frame.to_xy(*centroid)
        cell = f"{math.floor(x / 250)}:{math.floor(y / 250)}"
        cells[cell].append(key)
    return {
        "schema": "kerbside.storefront_name_audit/1", "region": region,
        "generated_at": datetime.now(UTC), "canonical_geometry_sha256": before_hash,
        "canonical_geometry_unchanged": True, "buildings": named,
        "counts": {"buildings": len(buildings), "initial_names": initial_names,
                   "names": sum(len(v["shops"]) for v in named.values()),
                   "unresolved_store_buildings": len(unresolved),
                   "withheld_low_confidence_or_rights_unknown_places": withheld},
        "unresolved": unresolved, "audit_cells_250m_not_official_blocks": dict(cells),
        "storefront_geometry": "procedural_until_photo_alignment_review",
        "business_interiors": "unknown; exterior pixels do not establish an interior",
        "requested_reference_comparison": "blocked_pending_rights_and_reference_assets",
        "automatically_publishes": False,
    }


def cell_diagnostics(audit: dict, fits: dict) -> dict:
    """Review signals from the latest checkpoint, not proof of metric accuracy."""
    building_cells = {key: cell for cell, keys in audit["audit_cells_250m_not_official_blocks"].items()
                      for key in keys}
    cells, flags = defaultdict(lambda: {"buildings": [], "flags": Counter()}), Counter()
    stale = 0
    for fit in fits.values():
        if fit.get("region") != audit["region"]:
            continue
        if fit.get("world_sha256") != audit.get("source_world_sha256"):
            stale += 1
            continue
        key = str(fit["building_id"])
        cell = building_cells.get(key)
        if cell is None:
            continue
        reasons = set(fit.get("certainty", {}).get("reasons", []))
        views = fit.get("multiview", {}).get("same_front_comparison_views", 0)
        if views < 1:
            reasons.add("no_second_registered_front_view")
        for opening in fit.get("openings", []):
            if (opening.get("kind") == "window"
                    and opening.get("v", 0) + opening.get("h", 0) > fit["height_m"] - 0.15):
                reasons.add("opening_reaches_prior_roof_envelope")
        cells[cell]["buildings"].append({"id": key, "address": fit.get("address"),
                                         "tier": fit.get("certainty", {}).get("tier", "unknown")})
        cells[cell]["flags"].update(reasons)
        flags.update(reasons)
    return {"basis": "private_photo_proposals_on_canonical_priors_not_reference_mesh_accuracy",
            "cells": dict(cells), "systematic_review_signals": dict(flags),
            "stale_world_fits_excluded": stale, "reference_mesh_comparison_completed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", nargs="+", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--enrichment", type=Path,
                        default=ROOT / "data/sf_building_enrichment/buildings.json")
    parser.add_argument("--watch-seconds", type=int, default=0)
    parser.add_argument("--fits", type=Path, default=ROOT / "build/facade-match/latest.json")
    args = parser.parse_args()
    if args.watch_seconds < 0:
        parser.error("negative watch interval")
    fingerprints = {}
    while True:
        namespace = runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))
        enrichment = json.loads(args.enrichment.read_text()) if args.enrichment.exists() else []
        enrichment_hash = hashlib.sha256(
            json.dumps(enrichment, sort_keys=True).encode()).hexdigest()
        summaries = {}
        fits = json.loads(args.fits.read_text()).get("buildings", {}) if args.fits.exists() else {}
        for region in args.regions:
            path = ROOT / ("docs/sf-corridor-3d.json" if region == "sf-corridor"
                           else f"docs/app-regions/{region}/sf-corridor-3d.json")
            if not path.exists():
                path = ROOT / f"docs/regions/{region}/sf-corridor-3d.json"
            if not path.exists():
                summaries[region] = {"status": "missing_canonical_input"}
                continue
            raw = path.read_bytes()
            fingerprint = hashlib.sha256(raw + enrichment_hash.encode()
                                         + Path(namespace["__file__"]).read_bytes()).hexdigest()
            out = args.output / f"{region}.json"
            if fingerprints.get(region) != fingerprint or not out.exists():
                result = audit_region(json.loads(raw), enrichment, region, namespace)
                result["source_world_sha256"] = hashlib.sha256(raw).hexdigest()
                atomic(out, result)
                fingerprints[region] = fingerprint
            result = json.loads(out.read_text())
            result["cell_diagnostics"] = cell_diagnostics(result, fits)
            atomic(out, result)
            summaries[region] = result["counts"]
        atomic(args.output / "status.json", {
            "at": datetime.now(UTC), "pid": os.getpid(), "regions": summaries,
            "status": "watching" if args.watch_seconds else "complete",
            "source_registry": json.loads(
                (ROOT / "data/reconstruction/dataset_catalog.json").read_text()),
            "automatically_publishes": False,
        })
        print(json.dumps({"status": "watching", "regions": summaries}), flush=True)
        if not args.watch_seconds:
            return
        time.sleep(args.watch_seconds)


if __name__ == "__main__":
    main()
