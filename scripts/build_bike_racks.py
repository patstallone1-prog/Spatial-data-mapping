#!/usr/bin/env python3
"""The city's public bicycle racks, from DataSF's Bicycle Parking Racks (hn4j-6fx5).

SFMTA's inventory of the racks it has installed: where each stands, how many racks and spaces,
and whether it is on the pavement (SIDEWALK), in a parking lane as a corral (ROADWAY) or in a
parklet. Racks in garages and on private parcels (GARAGE, GARAGE CAGE, PARCEL) are inside or
behind a building and are left out: nobody locks a bike to them from the street.

    python3 scripts/build_bike_racks.py            # from the cached download
    python3 scripts/build_bike_racks.py --fetch    # fetch the dataset again first

Writes ``bike-racks.json`` beside every San Francisco world's ``sf-corridor-furniture.json``
(the corridor, and each region whose box lies in the city), holding the racks inside its box.
The page draws them (module 21, addCityBikeRacks) and the living city's riders lock their
bicycles to them (fleet.mjs spotOf). Licence: Open Data Commons PDDL (public domain).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.net import use_certifi  # noqa: E402

DATASET = "hn4j-6fx5"
URL = (f"https://data.sf.gov/resource/{DATASET}.json?$limit=20000"
       "&$select=objectid,address,location,street,placement,racks,spaces,install_yr,shape")
CACHE = ROOT / "data/bike-racks/datasf-bicycle-parking.json"
#: Where a rider can reach the rack from the street.
STREET_PLACEMENTS = {"SIDEWALK", "ROADWAY", "PARKLET"}
#: San Francisco's box: a region outside it has none of the city's racks.
SF = {"west": -122.52, "east": -122.35, "south": 37.70, "north": 37.84}


def fetch() -> list[dict]:
    use_certifi()
    request = urllib.request.Request(URL, headers={"User-Agent": "kerbside-data-build"})
    with urllib.request.urlopen(request, timeout=120) as response:
        rows = json.loads(response.read(64 * 1024 ** 2))
    if not isinstance(rows, list) or len(rows) < 1000:
        raise ValueError(f"unexpected Bicycle Parking response: {type(rows).__name__} {len(rows) if isinstance(rows, list) else ''}")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"dataset": DATASET, "source": f"https://data.sfgov.org/d/{DATASET}",
                                 "license": "ODC-PDDL-1.0", "rows": rows}, separators=(",", ":")) + "\n")
    return rows


def records(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        shape = row.get("shape") or {}
        coords = shape.get("coordinates") if isinstance(shape, dict) else None
        placement = str(row.get("placement") or "").upper()
        if placement not in STREET_PLACEMENTS or not coords or len(coords) < 2:
            continue
        try:
            racks = max(1, min(20, int(float(row.get("racks") or 1))))
            spaces = max(1, min(60, int(float(row.get("spaces") or 2 * racks))))
        except ValueError:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        if not (SF["west"] <= lon <= SF["east"] and SF["south"] <= lat <= SF["north"]):
            continue
        out.append({"id": f"datasf:bike_rack:{row.get('objectid')}", "p": [round(lon, 7), round(lat, 7)],
                    "racks": racks, "spaces": spaces, "placement": placement.lower(),
                    "street": (row.get("street") or "").strip() or None,
                    "at": (row.get("location") or "").strip() or None,
                    "year": int(row["install_yr"]) if str(row.get("install_yr") or "").isdigit() else None})
    out.sort(key=lambda r: r["id"])
    return out


def worlds() -> list[Path]:
    """Each San Francisco world's folder (its furniture sidecar names its box)."""
    found = []
    for furniture in [ROOT / "docs/sf-corridor-furniture.json", *sorted((ROOT / "docs/regions").glob("*/sf-corridor-furniture.json")),
                      *sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-furniture.json"))]:
        if furniture.is_file():
            found.append(furniture.parent)
    return found


def bbox_of(folder: Path) -> dict | None:
    try:
        return json.loads((folder / "sf-corridor-furniture.json").read_text()).get("bbox")
    except (OSError, ValueError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    rows = fetch() if args.fetch or not CACHE.exists() else json.loads(CACHE.read_text())["rows"]
    every = records(rows)
    written = {}
    for folder in worlds():
        box = bbox_of(folder)
        if not box:
            continue
        inside = [r for r in every if box["west"] <= r["p"][0] <= box["east"] and box["south"] <= r["p"][1] <= box["north"]]
        target = folder / "bike-racks.json"
        if not inside:
            if target.exists():
                target.unlink()
            continue
        target.write_text(json.dumps({
            "schema": "kerbside.bike_racks/1",
            "source": f"DataSF Bicycle Parking Racks ({DATASET}), SFMTA",
            "license": "ODC-PDDL-1.0",
            "basis": "official install points; each rack drawn as an inverted U, parallel to the kerb on the pavement "
                     "and square to it in a roadway corral, as SFMTA installs them",
            "bbox": box,
            "racks": inside,
        }, separators=(",", ":")) + "\n")
        written[str(folder.relative_to(ROOT))] = {"sites": len(inside), "racks": sum(r["racks"] for r in inside)}
    print(json.dumps({"rows": len(rows), "street_sites": len(every), "worlds": written}, indent=1))


if __name__ == "__main__":
    main()
