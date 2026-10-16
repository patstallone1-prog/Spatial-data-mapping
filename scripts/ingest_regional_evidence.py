#!/usr/bin/env python3
"""Ingest municipal source evidence without rebuilding or replacing any rendered geometry."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.imagery.region import get_region  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.official.regional_evidence import SOURCES, fetch_inventory  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", choices=list(SOURCES), action="append")
    ap.add_argument("--out", type=Path, default=ROOT / "data/municipal_evidence")
    ap.add_argument("--manifest", type=Path, help="Small redistributable acquisition receipts, without raw GIS")
    args = ap.parse_args()
    use_certifi()
    errors = []
    receipts = []
    for name in args.source or SOURCES:
        source = SOURCES[name]
        b = get_region(source["region"]).bbox
        try:
            inventory = fetch_inventory(source, [b.south, b.west, b.north, b.east])
            folder = args.out / name
            folder.mkdir(parents=True, exist_ok=True)
            # Immutable content-addressed receipt; failed attempts never replace success.
            target = folder / (inventory["sha256"] + ".json")
            if not target.exists():
                target.write_text(json.dumps(inventory, separators=(",", ":")) + "\n")
            receipts.append({k: v for k, v in inventory.items() if k not in ("features", "metadata")}
                            | {"feature_count": len(inventory["features"]), "raw_path": str(target.relative_to(ROOT))})
            print(name, len(inventory["features"]), inventory["sha256"], flush=True)
        except Exception as exc:
            errors.append({"source": name, "error": str(exc)})
            print(name, "FAILED", str(exc), flush=True)
    if errors:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "failures.json").write_text(json.dumps(errors, indent=2) + "\n")
    if args.manifest:
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps({"sources": receipts, "failures": errors}, indent=2) + "\n")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
