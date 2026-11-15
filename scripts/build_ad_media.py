#!/usr/bin/env python3
"""The city's permitted general advertising signs, added to the mapped advertising.

San Francisco Planning keeps the inventory of every legal general advertising sign (billboards,
rooftop and wall signs: the General Advertising Sign Program, https://sfplanning.org/general-
advertising-sign-program). Its public map (https://sfplanninggis.org/gasp/) reads the layer
GASP_Records through the department's map proxy; this reads it the same way.

A record is a permit at an address: where the sign is, not its size, face or mount. Those are
inferred where it is drawn (module 19, billboardAnchor with support "auto"): on the roof of a
low building, high on the wall of a taller one facing the street, or on poles where nothing is
built. Each face is a standard 30-sheet poster (12 by 25 ft) until something says otherwise.
A permit within 30 m of a billboard OpenStreetMap already maps is that board: it is noted on
the mapped one (``permit_record``), not drawn twice. Two permits at one address (within 6 m) are
one structure with two faces: back to back on a roof or poles, or on two walls of a building.

    python3 scripts/build_ad_media.py            # from the cached download
    python3 scripts/build_ad_media.py --fetch    # fetch the inventory again first

Only the record's id, status, address, description and point are kept: the planners' names and
contact details in the layer are not copied.
"""
from __future__ import annotations

import argparse
import json
import math
import runpy
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.billboards import enrich_advertisement  # noqa: E402
from smc.net import use_certifi  # noqa: E402

LAYER = "https://sfplanninggis.org/arcgiswa/rest/services/GASP_Pro/MapServer/0/query"
PROXY = "https://sfplanninggis.org/proxy/DotNet/proxy.ashx?"
CACHE = ROOT / "data/ad-media/sf-planning-general-advertising-signs.json"
FIELDS = "OBJECTID,record_id,record_status,record_name,address,description"
ID_PREFIX = "sfplanning:gas:"
#: A permit this near a mapped billboard is that billboard.
SAME_BOARD_M = 30.0
#: Permits this near each other are one sign structure (its faces).
SAME_SITE_M = 6.0
#: A 30-sheet poster, 12 by 25 ft: the face most of the city's general advertising signs carry.
POSTER_SIZE = "7.62x3.66"


def fetch() -> list[dict]:
    use_certifi()
    query = urllib.parse.urlencode({"where": "1=1", "outFields": FIELDS, "outSR": "4326", "f": "json",
                                    "resultRecordCount": "2000"})
    request = urllib.request.Request(f"{PROXY}{LAYER}?{query}", headers={
        "User-Agent": "kerbside-data-build", "Referer": "https://sfplanninggis.org/gasp/"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.loads(response.read(16 * 1024 ** 2))
    features = data.get("features")
    if not isinstance(features, list) or len(features) < 100:
        raise ValueError(f"unexpected sign inventory response: {str(data)[:200]}")
    rows = []
    for f in features:
        a, g = f.get("attributes") or {}, f.get("geometry") or {}
        if not isinstance(g.get("x"), (int, float)) or not isinstance(g.get("y"), (int, float)):
            continue
        rows.append({"record_id": a.get("record_id"), "status": a.get("record_status"),
                     "name": a.get("record_name"), "address": a.get("address"),
                     "description": a.get("description"), "p": [round(g["x"], 7), round(g["y"], 7)]})
    rows.sort(key=lambda r: str(r["record_id"]))
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"source": "SF Planning, General Advertising Sign Program (GASP_Records)",
                                 "map": "https://sfplanninggis.org/gasp/", "rows": rows}, indent=0) + "\n")
    return rows


def metres_between(a, b) -> float:
    kx = 111_320.0 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 111_320.0)


def standing(row: dict) -> bool:
    text = f"{row.get('description') or ''}".lower()
    return row.get("status") == "Permitted" and "removed" not in text


def sites(rows: list[dict]) -> list[list[dict]]:
    """The permits grouped by the structure they are on: those within SAME_SITE_M of each other."""
    groups: list[list[dict]] = []
    for row in rows:
        for group in groups:
            if metres_between(group[0]["p"], row["p"]) <= SAME_SITE_M:
                group.append(row)
                break
        else:
            groups.append([row])
    return groups


def record(group: list[dict]) -> dict:
    row = group[0]
    tags = {"advertising": "billboard", "support": "auto", "size": POSTER_SIZE}
    if len(group) > 1:
        tags["sides"] = "2"
    return enrich_advertisement({
        "id": f"{ID_PREFIX}{row['record_id']}", "kind": "ad_panel", "ad_kind": "billboard",
        "permit_records": [r["record_id"] for r in group],
        "p": row["p"], "bearing": None, "confidence": 0.8,
        "source": "sf_planning_general_advertising_sign_program", "license": "public record (SF Planning)",
        "provenance": "permitted_sign_location; face size, mount and facing inferred",
        "geometry_basis": "permit_address_point", "address": row.get("name") or row.get("address"),
        "creative": "rotation",
        "tags": tags,
    })


def merge(document: dict, rows: list[dict]) -> dict:
    box = document.get("bbox") or {}
    inferred = document.setdefault("inferred", {})
    ads = [r for r in inferred.get("ad_panels", []) if not str(r.get("id", "")).startswith(ID_PREFIX)]
    for r in ads:
        r.pop("permit_record", None)
    boards = [r for r in ads if r.get("ad_kind") == "billboard" and r.get("p")]
    added = matched = 0
    for group in sites(rows):
        row = group[0]
        lon, lat = row["p"]
        if not (box.get("west", 1e9) <= lon <= box.get("east", -1e9) and box.get("south", 1e9) <= lat <= box.get("north", -1e9)):
            continue
        near = min(boards, key=lambda b: metres_between(b["p"], row["p"]), default=None)
        if near is not None and metres_between(near["p"], row["p"]) <= SAME_BOARD_M:
            near["permit_record"] = row["record_id"]
            matched += 1
            continue
        ads.append(record(group))
        added += 1
    inferred["ad_panels"] = ads
    counts = (document.setdefault("summary", {}).setdefault("inferred_counts", {}))
    counts["ad_panels"] = len(ads)
    return {"added": added, "matched_mapped_boards": matched}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    rows = fetch() if args.fetch or not CACHE.exists() else json.loads(CACHE.read_text())["rows"]
    rows = [r for r in rows if standing(r)]
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    out = {}
    for path in [ROOT / "docs/sf-corridor-furniture.json", *sorted((ROOT / "docs/regions").glob("*/sf-corridor-furniture.json")),
                 *sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-furniture.json"))]:
        if not path.is_file():
            continue
        document = json.loads(path.read_text())
        before = json.dumps(document.get("inferred", {}).get("ad_panels", []), sort_keys=True)
        stats = merge(document, rows)
        if json.dumps(document["inferred"]["ad_panels"], sort_keys=True) == before:
            continue
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        if (path.parent / "cells/sf-corridor-furniture/manifest.json").exists():
            cut(path)
        out[str(path.relative_to(ROOT))] = stats
    print(json.dumps({"standing_permits": len(rows), "worlds": out}, indent=1))


if __name__ == "__main__":
    main()
