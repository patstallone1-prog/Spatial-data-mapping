"""One search across every built region: its corners and its addresses, wherever they are.

Each region's page could only find what was in its own payload, so a place across the bay could
not be searched for until its region had been chosen from a list. This gathers every built
region's intersections and addressed buildings into docs/search-index.json; the page searches it
alongside its own, and a hit in another region hands the walker over to that region's full model
(window.kerbsideOpenFullRegionAt), arriving at the place searched for.

Compact by design -- it is fetched the first time someone types: each row is
[label, lon, lat, region index], coordinates to six decimals (about ten centimetres).
"""
from __future__ import annotations

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def payload_for(region: dict) -> pathlib.Path | None:
    name = region["name"]
    path = DOCS / "sf-corridor-3d.json" if name == "sf-corridor" else DOCS / "regions" / name / "sf-corridor-3d.json"
    return path if path.exists() else None


def rows_for(payload: dict, index: int) -> tuple[list, list]:
    corners, addresses = [], []
    seen = set()
    for c in payload.get("intersections") or []:
        if not (c.get("a") and c.get("b")) or c.get("lon") is None:
            continue
        label = f"{c['a']} & {c['b']}"
        key = (label, round(c["lon"], 4), round(c["lat"], 4))
        if key in seen:
            continue
        seen.add(key)
        corners.append([label, round(c["lon"], 6), round(c["lat"], 6), index])
    for way in payload.get("ways") or []:
        if way.get("kind") != "building" or not way.get("centroid"):
            continue
        address = way.get("address") or {}
        label = address.get("formatted") or " ".join(
            str(v) for v in (address.get("house_number"), address.get("street")) if v)
        if not label:
            continue
        name = way.get("name") or ""
        lon, lat = way["centroid"]
        row = [label if not name else f"{label} ({name})", round(lon, 6), round(lat, 6), index]
        addresses.append(row)
    return corners, addresses


def main() -> None:
    index = json.loads((DOCS / "app-regions.json").read_text())["regions"]
    regions, corners, addresses = [], [], []
    for region in index:
        if not region.get("built"):
            continue
        path = payload_for(region)
        if path is None:
            continue
        i = len(regions)
        regions.append({"name": region["name"], "title": region.get("title") or region["name"]})
        c, a = rows_for(json.loads(path.read_text()), i)
        corners += c
        addresses += a
    out = {"schema": "kerbside.search_index/1", "regions": regions, "corners": corners, "addresses": addresses}
    target = DOCS / "search-index.json"
    target.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"search index: {len(regions)} regions, {len(corners):,} corners, {len(addresses):,} addresses, "
          f"{target.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
