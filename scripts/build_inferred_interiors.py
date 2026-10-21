#!/usr/bin/env python3
"""Build a bounded, reproducible 16-house interior test set or caller-supplied houses.

The fixture selection happens before layout inference and never calls the solver to pick
convenient addresses. Eight artificial stress cases plus eight existing Kerbside footprints.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Polygon, box, mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.interiors.inference import HouseInput, infer_house  # noqa: E402
from smc.interiors.inference.catalog import Catalog  # noqa: E402
from smc.interiors.inference.engine import refresh_assets  # noqa: E402


def fixtures() -> list[dict]:
    artificial = [
        ("compact", box(0, 0, 9, 8), [2.65]),
        ("family", box(0, 0, 12, 10), [2.9, 2.7]),
        ("narrow", box(0, 0, 6.5, 18), [2.75]),
        ("L-wing", Polygon([(0, 0), (14, 0), (14, 6), (8, 6), (8, 12), (0, 12)]), [2.8]),
        (
            "U-court",
            Polygon([(0, 0), (16, 0), (16, 14), (11, 14), (11, 7), (5, 7), (5, 14), (0, 14)]),
            [3.1],
        ),
        (
            "T-wing",
            Polygon([(0, 0), (16, 0), (16, 6), (11, 6), (11, 14), (5, 14), (5, 6), (0, 6)]),
            [2.8],
        ),
        (
            "angled",
            affinity.rotate(Polygon([(0, 0), (13, 0), (11, 11), (1, 10)]), 23, origin=(0, 0)),
            [3.0],
        ),
        ("three-storey", box(0, 0, 11, 10), [3.0, 2.8, 2.6]),
    ]
    result = [
        {
            "id": f"stress-{name}",
            "name": name,
            "units": "metres",
            "footprint": mapping(p),
            "storeys": [{"height_m": h} for h in heights],
            "source": "synthetic stress fixture; not an address",
            "neighborhood_price_per_sqft": [220, 550, 1100][i % 3],
            "economics_source": "illustrative fixture input, not measured neighbourhood data",
            "office": name in {"family", "three-storey"},
        }
        for i, (name, p, heights) in enumerate(artificial)
    ]
    page = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    existing_fits = json.loads((ROOT / "docs/sf-corridor-interiors.json").read_text())["buildings"]
    candidates = []
    for way in page["ways"]:
        if way.get("kind") != "building" or way.get("tags", {}).get("building") not in {
            "house",
            "detached",
        }:
            continue
        pts = way.get("points", [])
        if not pts:
            continue
        lon, lat = way.get("centroid", pts[0])
        local = [
            ((x - lon) * 111320 * math.cos(math.radians(lat)), (y - lat) * 111320) for x, y in pts
        ]
        p = Polygon(local)
        if not p.is_valid or not 65 <= p.area <= 240:
            continue
        candidates.append(
            (hashlib.sha256(str(way["osm_id"]).encode()).hexdigest(), way, p, lon, lat)
        )
    for _, way, p, lon, lat in sorted(candidates)[:8]:
        height = float(way.get("height_m", 3))
        count = max(1, min(3, round(height / 3)))
        storey_m = max(2.4, min(4.5, height / count))
        fitted = existing_fits.get(str(way["osm_id"]))
        entrance = None
        if fitted and fitted[13]:
            edge, t, _, _ = fitted[13][0]
            a, b = list(p.exterior.coords)[edge : edge + 2]
            entrance = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        result.append(
            {
                "id": f"osm-{way['osm_id']}",
                "osm_id": str(way["osm_id"]),
                "entrance": entrance,
                "name": way.get("address", {}).get("formatted") or f"OSM {way['osm_id']}",
                "footprint": mapping(p),
                "units": "metres",
                "origin_lon_lat": [lon, lat],
                "storeys": [{"height_m": storey_m} for _ in range(count)],
                "source": "Kerbside published OSM footprint, local tangent-plane metres",
                "storey_evidence": "count and equal heights inferred from shell height",
                "shell_height_m": height,
                "office": False,
                "neighborhood_price_per_sqft": None,
            }
        )
    if len(result) != 16:
        raise ValueError("fixture source no longer supplies eight eligible mapped houses")
    return result


def write(path: Path, value: dict | list) -> None:
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="JSON array of metre-based HouseInput records")
    parser.add_argument("--out", type=Path, default=ROOT / "docs/inferred-interiors")
    parser.add_argument("--fixtures-only", action="store_true")
    parser.add_argument(
        "--reuse-synthetic",
        action="store_true",
        help="reuse unchanged stress cases when only mapped evidence changes",
    )
    parser.add_argument(
        "--refresh-assets",
        action="store_true",
        help="refresh the asset layer while preserving existing room geometry",
    )
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    inputs = json.loads(args.input.read_text()) if args.input else fixtures()
    if not 1 <= len(inputs) <= 20:
        raise ValueError("this pilot is bounded to at most twenty houses per run")
    # Resolve the existing facade before layout: floor lines and entrances must agree.
    write(args.out / "inputs.json", inputs)
    envelope = json.loads(
        subprocess.check_output(
            [
                "node",
                str(ROOT / "scripts/export_interior_envelopes.mjs"),
                str(args.out / "inputs.json"),
            ],
            text=True,
        )
    )
    for row in inputs:
        if row["id"] in envelope["buildings"]:
            e = envelope["buildings"][row["id"]]
            row.update(
                footprint=e["footprint"],
                entrance=e["entrance"],
                storeys=e["storeys"],
                envelope=e,
                total_height_m=e["shell_top_y_m"] - e["floor_y_m"],
                storey_evidence=(
                    "same Kerbside canonical floor/window rules; terrain foundation respected"
                ),
            )
    write(args.out / "envelopes.json", envelope)
    write(args.out / "inputs.json", inputs)
    if args.fixtures_only:
        return
    catalog = Catalog()
    records, overlay = [], {}
    for row in inputs:
        try:
            if args.reuse_synthetic and not row.get("osm_id"):
                house = json.loads((args.out / f"{row['id']}.json").read_text())
            elif args.refresh_assets:
                house = refresh_assets(
                    json.loads((args.out / f"{row['id']}.json").read_text()), catalog
                )
                if not house["validation"]["passed"]:
                    raise ValueError("asset refresh failed physical validation")
            else:
                house = infer_house(HouseInput.from_json(row), catalog)
            house["name"] = row.get("name", row["id"])
            house["input_evidence"] = row
            write(args.out / f"{row['id']}.json", house)
            record = {
                "id": row["id"],
                "name": house["name"],
                "file": row["id"] + ".json",
                "passed": True,
                "storeys": len(house["storeys"]),
                "style": house["style"]["name"],
                "metrics": house["validation"]["metrics"],
                "search": house["search"],
            }
            if row.get("osm_id"):
                overlay[row["osm_id"]] = {
                    "file": record["file"],
                    "origin_lon_lat": row["origin_lon_lat"],
                }
            print(f"PASS {row['id']}: {record['metrics']}", flush=True)
        except ValueError as exc:
            record = {
                "id": row["id"],
                "name": row.get("name", row["id"]),
                "passed": False,
                "reason": str(exc),
            }
            print(f"FAIL {row['id']}: {exc}", flush=True)
        records.append(record)
    write(
        args.out / "manifest.json",
        {
            "schema": "kerbside.inferred_house_batch/1",
            "selection": (
                "eight fixed stress shapes + eight OSM houses ordered by SHA256(id); "
                "no solver filtering"
            ),
            "houses": records,
            "passed": sum(r["passed"] for r in records),
            "total": len(records),
            "asset_manifest": "../interior-assets/manifest.json",
            "measured": False,
        },
    )
    write(
        args.out / "map-overlay.json",
        {"schema": "kerbside.inferred_house_overlay/1", "buildings": overlay},
    )
    if not all(r["passed"] for r in records):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
