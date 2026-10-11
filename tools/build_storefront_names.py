"""Release verified name-only sidecars; private watcher never writes public assets."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def names_sidecar(payload: dict, audit: dict, raw_sha256: str) -> dict:
    if (audit.get("source_world_sha256") != raw_sha256
            or not audit.get("canonical_geometry_unchanged")):
        raise ValueError("stale or geometry-changing storefront audit cannot publish")
    buildings = {}
    for way in payload["ways"]:
        if way.get("kind") != "building":
            continue
        key = str(way.get("osm_id"))
        row = audit.get("buildings", {}).get(key)
        if not row or row["shops"] == way.get("shops", []):
            continue
        buildings[key] = {"shops": row["shops"], "points": way["points"],
                          "height_m": way.get("height_m")}
    return {
        "schema": "kerbside.storefront_names/1", "region": audit["region"],
        "source_world_sha256": raw_sha256, "bbox": payload["bbox"], "buildings": buildings,
        "basis": "source_matched_tenant_names; not photo_observed_sign_locations_or_interiors",
        "geometry_modified": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit-root", type=Path, required=True)
    args = parser.parse_args()
    for path in sorted(args.audit_root.glob("*.json")):
        audit = json.loads(path.read_text())
        if audit.get("schema") != "kerbside.storefront_name_audit/1":
            continue
        region = audit["region"]
        payload_path = ROOT / ("docs/sf-corridor-3d.json" if region == "sf-corridor"
                               else f"docs/app-regions/{region}/sf-corridor-3d.json")
        if not payload_path.exists():
            payload_path = ROOT / f"docs/regions/{region}/sf-corridor-3d.json"
        raw = payload_path.read_bytes()
        sidecar = names_sidecar(json.loads(raw), audit, hashlib.sha256(raw).hexdigest())
        destination = ROOT / ("docs/sf-corridor-storefront-names.json" if region == "sf-corridor"
                              else f"docs/app-regions/{region}/sf-corridor-storefront-names.json")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(sidecar, separators=(",", ":")) + "\n")
        print(f"{region}: {len(sidecar['buildings'])} bound name updates")


if __name__ == "__main__":
    main()
