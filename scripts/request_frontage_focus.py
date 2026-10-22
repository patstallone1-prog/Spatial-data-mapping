#!/usr/bin/env python3
"""Ask the frontage supervisor to screen one neighbourhood's houses and restaurants first.

Writes ``build/frontage-supervisor/focus.request.json`` in the worktree the supervisor runs
from: the neighbourhood's houses (the city's RESIDENTIAL- HOUSE land uses) and its buildings
with a restaurant, cafe or bar in them, not yet fitted, nearest the anchor first. The photo
filter (filter_frontage_photos.focus_order) screens those before anything else; nothing is
approved or published by asking. Remove the file to go back to the fair order.

    .venv/bin/python scripts/request_frontage_focus.py --neighbourhood Marina \\
        --near "1547 Francisco" --worktree /Applications/Spatial-data-mapping-tunnel-ground-safety
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EATING = {"restaurant", "cafe", "bar", "bakery", "fast_food", "pub", "ice_cream"}


def wanted(way: dict) -> str | None:
    if any((shop.get("t") or "") in EATING for shop in way.get("shops") or []):
        return "restaurant"
    if (way.get("land_use") or "").startswith("RESIDENTIAL- HOUSE"):
        return "house"
    return None


def fitted_ids(region: str) -> set[str]:
    manifest = json.loads((ROOT / "docs/sf-corridor-frontage-fits.manifest.json").read_text())
    ids: set[str] = set()
    for tile in manifest["tiles"]:
        if tile["region"] == region:
            ids |= set(json.loads((ROOT / "docs" / tile["path"]).read_text())["buildings"])
    return ids


def focus_list(ways: list[dict], neighbourhood: str, anchor: tuple[float, float] | None,
               fitted: set[str], region: str) -> list[dict]:
    rows = []
    for way in ways:
        kind = way.get("kind") == "building" and wanted(way)
        if not kind or (way.get("parcel") or {}).get("analysis_neighborhood") != neighbourhood:
            continue
        if str(way.get("osm_id")) in fitted or not way.get("centroid"):
            continue
        lon, lat = way["centroid"]
        metres = 0.0 if anchor is None else math.hypot(
            (lon - anchor[0]) * 111_320 * math.cos(math.radians(lat)), (lat - anchor[1]) * 110_540)
        rows.append({"region": region, "building_id": str(way["osm_id"]), "kind": kind,
                     "address": (way.get("address") or {}).get("formatted"), "metres": round(metres)})
    rows.sort(key=lambda r: (r["metres"], r["building_id"]))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--neighbourhood", required=True, help="the parcel's analysis_neighborhood, e.g. Marina")
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--near", help="an address in the neighbourhood: the nearest are screened first")
    parser.add_argument("--worktree", type=Path, required=True, help="the checkout the supervisor runs from")
    args = parser.parse_args()
    payload = ROOT / ("docs/sf-corridor-3d.json" if args.region == "sf-corridor"
                      else f"docs/regions/{args.region}/sf-corridor-3d.json")
    data = json.loads(payload.read_text())
    ways = data if isinstance(data, list) else data["ways"]
    anchor = None
    if args.near:
        needle = args.near.lower()
        for way in ways:
            if needle in str((way.get("address") or {}).get("formatted", "")).lower() and way.get("centroid"):
                anchor = tuple(way["centroid"])
                break
        if anchor is None:
            parser.error(f"no building at {args.near!r}")
    rows = focus_list(ways, args.neighbourhood, anchor, fitted_ids(args.region), args.region)
    out = args.worktree / "build/frontage-supervisor/focus.request.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"requested_at": datetime.now(UTC).isoformat(), "neighbourhood": args.neighbourhood,
                               "near": args.near, "buildings": rows}, indent=1) + "\n")
    kinds = {k: sum(r["kind"] == k for r in rows) for k in ("house", "restaurant")}
    print(f"{out}: {len(rows)} buildings first ({kinds['house']} houses, {kinds['restaurant']} restaurants)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
