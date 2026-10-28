#!/usr/bin/env python3
"""Twenty preselected apartment/garage cases: twelve synthetic and eight mapped shells."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Point, Polygon, box, mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.interiors.kerbside import mapped_geometry  # noqa: E402


def fixtures():
    cases = []
    programs = [
        ("duplex-one-floor", 14, 15, [3.1], 2, 0, "auto"),
        ("triplex-two-floors", 16, 15, [3.1, 2.9], 3, 0, "auto"),
        ("four-family", 16, 16, [3.1, 2.9], 4, 0, "auto"),
        ("five-family", 16, 16, [3.1, 2.9, 2.8], 5, 0, "auto"),
        ("five-one-floor", 25, 20, [3.1], 5, 0, "auto"),
        ("rotated-four", 16, 17, [3.1, 2.9], 4, 0, "auto"),
        ("setback-three", 18, 17, [3.1, 2.9], 3, 0, "auto"),
        ("one-car-attached", 12, 14, [3.1, 2.9], 1, 1, "room"),
        ("two-car-attached", 14, 14, [3.1, 2.9], 1, 2, "room"),
        ("three-car-floor", 14, 17, [3.1, 2.9], 1, 3, "floor"),
        ("four-car-floor", 14, 17, [3.1, 2.9, 2.8], 1, 4, "floor"),
        ("apartments-with-parking", 16, 17, [3.1, 2.9, 2.8], 3, 2, "auto"),
    ]
    for name, w, d, heights, households, cars, mode in programs:
        p = box(0, 0, w, d)
        entrance = Point(0.8, 0)
        if name == "setback-three":
            p = Polygon([(0, 0), (18, 0), (18, 10), (13, 10), (13, 17), (0, 17)])
        if name == "rotated-four":
            p = affinity.rotate(p, 23, origin=(0, 0))
            entrance = affinity.rotate(entrance, 23, origin=(0, 0))
        row = dict(
            id="residential-" + name,
            name=name.replace("-", " ").title(),
            footprint=mapping(p),
            storeys=[{"height_m": h} for h in heights],
            households=households,
            entrance=list(entrance.coords[0]),
            units="metres",
            source="synthetic stress geometry; not a measured address",
            neighborhood_price_per_sqft=600,
        )
        if cars:
            width = 2.6 if cars == 1 else 5.3
            row.update(
                garage_cars=cars,
                garage_mode=mode,
                garages=[
                    dict(
                        id=name + ":opening",
                        a=[0, 0],
                        b=[w, 0],
                        u=w / 2 - width / 2,
                        w=width,
                        h=2.4,
                        basis="synthetic opening for capacity test",
                        measured=False,
                        confidence=0.2,
                        freshness=None,
                        corroboration_count=0,
                    )
                ],
            )
        if name == "one-car-attached":
            row["garages"][0]["v"] = -0.35
        cases.append(row)
    page = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    fits = json.loads((ROOT / "docs/sf-corridor-interiors.json").read_text())["buildings"]
    apartments = []
    garages = []
    for w in page["ways"]:
        if w.get("kind") != "building":
            continue
        kind = w.get("tags", {}).get("building")
        if kind not in {"house", "detached", "apartments"}:
            continue
        try:
            g = mapped_geometry(w, fits.get(str(w["osm_id"])))
        except ValueError:
            continue
        if not 125 <= g["geometry_evidence"]["footprint_area_m2"] <= 320:
            continue
        n = g["geometry_evidence"]["storeys"]
        if not 2 <= n <= 5 or not 2.6 <= g["height_m"] <= 5:
            continue
        row = dict(
            id=f"residential-osm-{w['osm_id']}",
            osm_id=str(w["osm_id"]),
            name=f"Mapped {kind} {w['osm_id']}",
            **g,
            storeys=[{"height_m": g["height_m"]} for _ in range(n)],
            households=n if kind == "apartments" else 1,
            household_evidence="illustrative 2-5 family program; mapped dwelling count unavailable"
            if kind == "apartments"
            else "single-family OSM classification",
            source="Kerbside published shell and canonical openings",
            neighborhood_price_per_sqft=None,
        )
        key = hashlib.sha256(str(w["osm_id"]).encode()).hexdigest()
        if kind == "apartments":
            apartments.append((key, row))
        elif w.get("garages"):
            garages.append((key, row))
    selected = [r for _, r in sorted(apartments)[:4]] + [r for _, r in sorted(garages)[:4]]
    if len(selected) != 8:
        raise ValueError(
            "eight eligible mapped cases unavailable; do not replace failures after solving"
        )
    return cases + selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "docs/inferred-residential")
    parser.add_argument("--fixtures-only", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rows = fixtures()
    path = args.out / "request.json"
    path.write_text(json.dumps(rows, indent=2) + "\n")
    cmd = [
        sys.executable,
        str(ROOT / "scripts/build_inferred_interiors.py"),
        "--input",
        str(path),
        "--out",
        str(args.out),
        "--include-garages",
    ]
    if args.fixtures_only:
        cmd += ["--fixtures-only"]
    raise SystemExit(subprocess.call(cmd))


if __name__ == "__main__":
    main()
