#!/usr/bin/env python3
"""A fixed retail cohort selected before solving, with mapped rejections retained."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Polygon, box, mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.interiors.kerbside import mapped_geometry  # noqa: E402
from smc.interiors.stores import StoreInput, infer_store, validate_store  # noqa: E402

sys.path.insert(0, str(ROOT / "scripts"))
from ingest_grocery_inventory import chain_for  # noqa: E402


def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def synthetic():
    rows = []
    for key, kind, p, chain, entrances, parking in [
        ("tiny-corner", "corner_store", box(0, 0, 6, 9), "independent", [{"point": [2, 0]}], None),
        (
            "corner-snacks",
            "corner_store",
            box(0, 0, 9, 14),
            "independent",
            [{"point": [2.5, 0]}],
            None,
        ),
        (
            "corner-setback",
            "corner_store",
            Polygon([(0, 0), (10, 0), (10, 7), (8, 7), (8, 14), (0, 14)]),
            "independent",
            [{"point": [2.5, 0]}],
            None,
        ),
        ("supermarket", "grocery", box(0, 0, 28, 32), "safeway", [{"point": [7, 0]}], None),
        (
            "fresh-market",
            "grocery",
            affinity.rotate(box(0, 0, 30, 35), 27, origin=(0, 0)),
            "whole_foods",
            [],
            None,
        ),
        (
            "two-entrances",
            "grocery",
            box(0, 0, 36, 40),
            "trader_joes",
            [{"point": [7, 0]}, {"point": [36, 12]}],
            None,
        ),
        (
            "two-parking-levels",
            "grocery",
            box(0, 0, 44, 44),
            "safeway",
            [{"point": [13, 0]}],
            {"kind": "garage", "levels": 2, "footprint": mapping(box(0, 0, 44, 44))},
        ),
        (
            "three-parking-levels",
            "grocery",
            box(0, 0, 46, 44),
            "whole_foods",
            [{"point": [13, 0]}, {"point": [23, 0]}],
            {"kind": "garage", "levels": 3, "footprint": mapping(box(0, 0, 46, 44))},
        ),
    ]:
        if parking:
            parking.update(
                evidence=[{"source": "synthetic test program", "measured": False}],
                storey_height_m=3.2,
            )
        rows.append(
            {
                "id": "retail-" + key,
                "name": key.replace("-", " ").title(),
                "kind": kind,
                "footprint": mapping(p),
                "chain": chain,
                "entrances": entrances,
                "parking": parking,
                "height_m": 3.8,
                "units": "metres",
                "source": "synthetic stress polygon and illustrative program",
            }
        )
    rows.append(
        {
            "id": "retail-surface-parking",
            "name": "Corner Store With Surface Parking",
            "kind": "corner_store",
            "footprint": mapping(box(0, 0, 10, 14)),
            "height_m": 3.4,
            "entrances": [{"point": [3, 0]}],
            "chain": "independent",
            "units": "metres",
            "source": "synthetic stress polygon and supplied outdoor path",
            "parking": {
                "kind": "external",
                "levels": None,
                "external_footprint": mapping(box(-4, -23, 16, -3)),
                "pedestrian_path": mapping(box(1.8, -7, 4.2, 1)),
            },
        }
    )
    return rows


def mapped(out):
    grocery = []
    corners = []
    observations = json.loads((ROOT / "data/grocery-stores/parking-observations.json").read_text())[
        "observations"
    ]
    for page in [
        ROOT / "docs/sf-corridor-3d.json",
        *sorted((ROOT / "docs/regions").glob("*/sf-corridor-3d.json")),
    ]:
        region = "sf-corridor" if page.parent == ROOT / "docs" else page.parent.name
        fits = json.loads((page.parent / "sf-corridor-interiors.json").read_text())["buildings"]
        for w in json.loads(page.read_text())["ways"]:
            shops = w.get("shops", [])
            if w.get("kind") != "building" or len(shops) != 1:
                continue
            s = shops[0]
            name = s.get("n", "")
            kind = (
                "grocery"
                if (chain_for(name) != "independent" and "fuel" not in name.lower())
                or name == "Rainbow Grocery Coop"
                else "corner_store"
                if s.get("t") == "convenience"
                else None
            )
            if not kind:
                continue
            g = mapped_geometry(w, fits.get(str(w["osm_id"])), region=region)
            area = Polygon(g["footprint"]["coordinates"][0]).area
            if (
                not (150 <= area <= 7000 if kind == "grocery" else 45 <= area <= 230)
                or not 2.4 <= g["height_m"] <= 7
            ):
                continue
            row = {
                "id": "retail-osm-" + str(w["osm_id"]),
                "osm_id": str(w["osm_id"]),
                "name": name,
                **g,
                "kind": kind,
                "chain": chain_for(name),
                "region": region,
                "parking": {"kind": "unknown", "levels": None},
                "source": "Kerbside building polygon; full ground-floor retail tenancy unverified",
                "selection_hash": hashlib.sha256(str(w["osm_id"]).encode()).hexdigest(),
            }
            for obs in observations:
                if "osm:way:" + str(w["osm_id"]) in obs.get("osm_ids", []):
                    row["parking"] = obs["parking"]
            (grocery if kind == "grocery" else corners).append(row)
    # Stratification and SHA order happen before any layout attempt.
    selected = (
        sorted(grocery, key=lambda r: r["selection_hash"])[:6]
        + sorted(corners, key=lambda r: r["selection_hash"])[:4]
    )
    for region in dict.fromkeys(r["region"] for r in selected):
        group = [r for r in selected if r["region"] == region]
        temp = out / ("source-" + region + ".json")
        write(temp, group)
        env = os.environ.copy()
        env["KERBSIDE_REGION"] = region
        result = subprocess.run(
            ["node", "scripts/export_interior_envelopes.mjs", str(temp)],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=True,
        )
        envelope = json.loads(result.stdout)
        write(out / ("envelopes-" + region + ".json"), envelope)
        for row in group:
            e = envelope["buildings"].get(row["id"])
            if e:
                row.update(
                    footprint=e["footprint"],
                    height_m=e["storeys"][0]["height_m"],
                    envelope={
                        "windows": [
                            w for w in e["windows"] if w["v"] < e["storeys"][0]["height_m"]
                        ],
                        "balconies": [],
                        "source": e["source"],
                    },
                )
                row["geometry_evidence"]["canonical_rules_sha256"] = envelope[
                    "canonical_rules_sha256"
                ]
                row["geometry_evidence"]["footprint_area_m2"] = Polygon(
                    row["footprint"]["coordinates"][0]
                ).area
                if e.get("entrance"):
                    row["entrance"] = e["entrance"]
            # Preserve every fitted entry, rather than just the first one.
            base = ROOT / "docs" if region == "sf-corridor" else ROOT / "docs/regions" / region
            fit = json.loads((base / "sf-corridor-interiors.json").read_text())["buildings"].get(
                row["osm_id"]
            )
            if fit and len(fit) > 13:
                ring = row["footprint"]["coordinates"][0]
                entries = []
                for edge, t, width, source in fit[13] or []:
                    a, b = ring[edge], ring[edge + 1]
                    w = float(width or 1.2)
                    c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
                    entries.append(
                        {"point": c, "width_m": w, "basis": str(source), "measured": False}
                    )
                if entries:
                    row["entrances"] = entries
                    row.pop("entrance", None)
        temp.unlink()
    return selected


def publish(out, site=None):
    """Merge only validated retail cases into the existing, shared map index."""
    site = site or ROOT / "docs/inferred-interiors"
    refs = json.loads((out / "map-overlay.json").read_text())["buildings"]
    index = site / "map-overlay.json"
    previous = (
        json.loads(index.read_text())
        if index.exists()
        else {"schema": "kerbside.inferred_house_overlay/1", "buildings": {}}
    )
    for osm_id, ref in refs.items():
        file = out / ref["file"]
        h = json.loads(file.read_text())
        if h.get("schema") != "kerbside.inferred_store/1" or not validate_store(h)["passed"]:
            raise ValueError("cannot publish an invalid retail hypothesis")
        previous["buildings"][osm_id] = {**ref, "file": os.path.relpath(file, site)}
    index.write_text(json.dumps(previous, indent=1) + "\n")
    return len(refs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "docs/inferred-stores")
    parser.add_argument("--input", type=Path, help="caller JSON inputs, at most twenty")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="merge accepted stores into the local Kerbside map index",
    )
    args = parser.parse_args()
    args.out.mkdir(exist_ok=True, parents=True)
    rows = json.loads(args.input.read_text()) if args.input else synthetic() + mapped(args.out)
    if not 1 <= len(rows) <= 20:
        raise ValueError("review batches contain 1-20 stores")
    for row in rows:
        row["id"] = str(row["id"])
        row.setdefault("name", row["id"])
    write(args.out / "inputs.json", rows)
    results = []
    for row in rows:
        try:
            h = infer_store(StoreInput.from_json(row))
            h.update(name=row["name"], input_evidence=row)
            file = row["id"] + ".json"
            write(args.out / file, h)
            result = {
                "id": row["id"],
                "name": row["name"],
                "passed": True,
                "file": file,
                "storeys": len(h["storeys"]),
                "metrics": h["validation"]["metrics"],
            }
        except ValueError as exc:
            result = {"id": row["id"], "name": row["name"], "passed": False, "reason": str(exc)}
        results.append(result)
        print(row["id"], "PASS" if result["passed"] else result["reason"], flush=True)
    manifest = {
        "schema": "kerbside.retail_review/1",
        "houses": results,
        "passed": sum(r["passed"] for r in results),
        "total": len(results),
        "selection": (
            "caller-supplied retail cohort; failures retained"
            if args.input
            else "nine fixed stress programs + six grocery/four corner mapped shells "
            "in SHA order before solving; failures retained"
        ),
        "measured": False,
    }
    write(args.out / "manifest.json", manifest)
    write(
        args.out / "map-overlay.json",
        {
            "schema": "kerbside.inferred_house_overlay/1",
            "buildings": {
                r["osm_id"]: {
                    "file": r["id"] + ".json",
                    "origin_lon_lat": r["origin_lon_lat"],
                }
                for r in rows
                if r.get("osm_id") and any(x["id"] == r["id"] and x["passed"] for x in results)
            },
        },
    )
    if args.publish:
        print(f"Published {publish(args.out)} validated stores into the existing map index")
    return 0 if manifest["passed"] == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
