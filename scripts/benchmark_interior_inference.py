#!/usr/bin/env python3
"""Repeat a fixed, mixed interior cohort; compare complete deterministic outputs.

Writes only to build/ by default. Does not publish layouts, update lab inputs or
change map overlays. Profiles are separate from the unprofiled wall-clock runs.
"""

from __future__ import annotations

import argparse
import cProfile
import hashlib
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def cases():
    houses = json.loads((ROOT / "docs/inferred-interiors/inputs.json").read_text())
    apartments = json.loads((ROOT / "docs/inferred-residential/inputs.json").read_text())
    history = json.loads((ROOT / "docs/inferred-restaurants/history.json").read_text())
    result = []
    for key in ["stress-compact", "stress-family", "stress-L-wing", "osm-460228342"]:
        result.append(("house", next(r for r in houses if r["id"] == key)))
    for key in [
        "residential-duplex-one-floor",
        "residential-triplex-two-floors",
        "residential-setback-three",
    ]:
        result.append(("house", next(r for r in apartments if r["id"] == key)))
    recent = history["rounds"][-1]
    for stratum in ["pickup", "irregular", "regular"]:
        row = next(r for r in recent["selected"] if r["stratum"] == stratum)
        result.append(("restaurant", row))
    return result


def held_out_cases():
    import math

    def outline(w, d, angle=0):
        t = math.radians(angle)
        ring = [
            [x * math.cos(t) - y * math.sin(t), x * math.sin(t) + y * math.cos(t)]
            for x, y in [(0, 0), (w, 0), (w, d), (0, d), (0, 0)]
        ]
        return {"type": "Polygon", "coordinates": [ring]}

    return [
        (
            "house",
            {
                "id": "heldout-single",
                "footprint": outline(11.7, 13.4),
                "storeys": [{"height_m": 2.95}],
                "bedrooms": 2,
            },
        ),
        (
            "house",
            {
                "id": "heldout-duplex",
                "footprint": outline(14, 16),
                "storeys": [{"height_m": 3.1}, {"height_m": 2.9}],
                "households": 2,
                "entrance": [0.9, 0],
            },
        ),
        (
            "restaurant",
            {
                "id": "heldout-pickup",
                "footprint": outline(8, 11),
                "service_mode": "pickup",
                "average_spend_per_person": 16,
            },
        ),
        (
            "restaurant",
            {
                "id": "heldout-rotated-dining",
                "footprint": outline(12, 14, 17),
                "average_spend_per_person": 61,
            },
        ),
        (
            "restaurant",
            {
                "id": "heldout-narrow-counter",
                "footprint": outline(5.8, 15),
                "service_mode": "counter",
                "average_spend_per_person": 23,
            },
        ),
    ]


def run(kind, row):
    from smc.interiors.inference import HouseInput, infer_house
    from smc.interiors.inference.catalog import Catalog
    from smc.interiors.restaurants import RestaurantInput, infer_restaurant

    catalog = Catalog(ROOT / "docs/interior-assets/manifest.json")
    return (
        infer_house(HouseInput.from_json(row), catalog)
        if kind == "house"
        else infer_restaurant(RestaurantInput.from_json(row), catalog)
    )


def digest(result):
    return hashlib.sha256(
        json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", type=Path, default=ROOT / "build/interior-performance/current")
    p.add_argument("--compare", type=Path, help="earlier benchmark folder")
    p.add_argument("--repeat", type=int, default=3)
    p.add_argument("--profile", action="store_true")
    p.add_argument("--case", action="append", help="run only these case IDs")
    p.add_argument("--source-root", type=Path, help="read-only source snapshot root with src/smc")
    p.add_argument("--held-out", action="store_true", help="use five extra unseen caller programs")
    args = p.parse_args()
    if args.source_root:
        sys.path.insert(0, str(args.source_root.resolve() / "src"))
    if not 1 <= args.repeat <= 10:
        raise ValueError("repeat must be 1-10")
    args.out.mkdir(parents=True, exist_ok=True)
    report = {
        "selection": (
            "fixed 10-case pool selected before profiling; four single-family, "
            "three two/three-family, three restaurant programs"
        ),
        "cases": [],
    }
    baseline = json.loads((args.compare / "results.json").read_text()) if args.compare else None
    pool = held_out_cases() if args.held_out else cases()
    if args.held_out:
        report["selection"] = "five held-out caller programs, without venue-specific rules"
    selected = [(kind, row) for kind, row in pool if not args.case or row["id"] in args.case]
    if not selected:
        raise ValueError("no matching benchmark cases")
    report["selected_ids"] = [row["id"] for _, row in selected]
    # Keep module import/startup outside the inference timing, as in the baseline.
    import importlib

    importlib.import_module("smc.interiors.inference")
    importlib.import_module("smc.interiors.restaurants")
    for kind, row in selected:
        times = []
        hashes = []
        error = None
        for _ in range(args.repeat):
            start = time.perf_counter()
            try:
                result = run(kind, row)
                sha = digest(result)
            except ValueError as exc:
                result = {"error": str(exc)}
                sha = digest(result)
                error = str(exc)
            times.append(time.perf_counter() - start)
            hashes.append(sha)
        record = {
            "id": row["id"],
            "kind": kind,
            "seconds": times,
            "median_seconds": statistics.median(times),
            "sha256": hashes[-1],
            "deterministic": len(set(hashes)) == 1,
            "passed": error is None,
        }
        (args.out / (row["id"] + ".json")).write_text(json.dumps(result, indent=2) + "\n")
        if baseline:
            previous = next(r for r in baseline["cases"] if r["id"] == row["id"])
            record.update(
                identical_output=record["sha256"] == previous["sha256"],
                speedup=previous["median_seconds"] / record["median_seconds"],
            )
        report["cases"].append(record)
        (args.out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(record), flush=True)
    if args.profile:
        for kind, row in [selected[0], selected[-1]]:
            profiler = cProfile.Profile()
            profiler.runcall(run, kind, row)
            profiler.dump_stats(str(args.out / (row["id"] + ".prof")))
    return int(
        any(not r["deterministic"] or r.get("identical_output") is False for r in report["cases"])
    )


if __name__ == "__main__":
    raise SystemExit(main())
