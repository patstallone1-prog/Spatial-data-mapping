#!/usr/bin/env python3
"""Ingest reviewed CC0 hospitality props from Poly Haven's checksum-pinned file API."""

import json
from pathlib import Path

from build_interior_assets import poly_haven
from expand_interior_library import enrich, write_manifest

ROOT = Path(__file__).resolve().parents[1]
ASSETS = {
    "metal_stool_01": "bar_stool",
    "metal_stool_02": "bar_stool",
    "metal_stool_03": "bar_stool",
    "wooden_stool_01": "bar_stool",
    "wooden_stool_02": "bar_stool",
    "folding_wooden_stool": "bar_stool",
    "carved_wooden_plate": "table_item",
    "CoffeeCart_01": "coffee_cart",
}


def main():
    directory = ROOT / "docs/interior-assets"
    path = directory / "manifest.json"
    data = json.loads(path.read_text())
    existing = {r["id"] for r in data["assets"]}
    failures = []
    for key, role in ASSETS.items():
        if key in existing:
            continue
        try:
            row = poly_haven(key, role)
            enrich(row, directory)
            row["tier"] = "economy" if key.startswith("metal_") else "standard"
            data["assets"].append(row)
            write_manifest(path, data)
            print("added", key, flush=True)
        except Exception as exc:
            failures.append({"id": key, "reason": str(exc)})
            print("FAIL", key, str(exc), flush=True)
    data["hospitality_expansion"] = {
        "failures": failures,
        "source": "https://polyhaven.com/models?c=food",
        "license": "CC0-1.0",
    }
    write_manifest(path, data)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
