"""One search across every built region: its corners, its addresses and its named places.

Each region's page could only find what was in its own payload, so a place across the bay could
not be searched for until its region had been chosen from a list. This gathers every built
region's intersections and addressed buildings into docs/search-index.json; the page searches it
alongside its own, and a hit in another region hands the walker over to that region's full model
(window.kerbsideOpenFullRegionAt), arriving at the place searched for.

Places are found by name: a building's own name, and the shops and places in it, each at the
building -- so "Transamerica Pyramid" or a cafe's name finds the building as its address does.

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


def rows_for(payload: dict, index: int) -> tuple[list, list, list]:
    corners, addresses, places = [], [], []
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
        name = way.get("name") or ""
        lon, lat = round(way["centroid"][0], 6), round(way["centroid"][1], 6)
        where = f" · {label}" if label else ""
        if name:
            places.append([f"{name}{where}", lon, lat, index])
        for shop in way.get("shops") or []:
            if shop.get("n") and shop["n"] != name:
                places.append([f"{shop['n']}{where}", lon, lat, index])
        if not label:
            continue
        addresses.append([label if not name else f"{label} ({name})", lon, lat, index])
    return corners, addresses, places


def main() -> None:
    index = json.loads((DOCS / "app-regions.json").read_text())["regions"]
    regions, corners, addresses, places = [], [], [], []
    for region in index:
        if not region.get("built"):
            continue
        path = payload_for(region)
        if path is None:
            continue
        i = len(regions)
        regions.append({"name": region["name"], "title": region.get("title") or region["name"]})
        c, a, p = rows_for(json.loads(path.read_text()), i)
        corners += c
        addresses += a
        places += p
    out = {"schema": "kerbside.search_index/1", "regions": regions, "corners": corners,
           "addresses": addresses, "places": places}
    target = DOCS / "search-index.json"
    target.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"search index: {len(regions)} regions, {len(corners):,} corners, {len(addresses):,} addresses, "
          f"{len(places):,} places, "
          f"{target.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
