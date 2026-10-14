#!/usr/bin/env python3
"""San Francisco's own streetlights, by pole type, into every San Francisco region's furniture.

The SFPUC owns about 25,000 of the city's streetlights and publishes every one of them as a point
with its pole type and material (the "SFPUC Streetlights" layer behind its streetlight map,
https://www.sfpuc.gov/construction-contracts/new-developments/street-pedestrian-lighting). The
layer says what the pole is -- standard steel, spun round concrete, octagonal concrete, fluted
steel, a 14 ft Louis Poulsen post top, a trolley pole carrying a light -- and not how tall it is
or what hangs on it. Those are the SFPUC Streetlight Catalog's (2022-02): a standard steel pole is
25 to 30 ft with a single elliptical mast arm of 4, 6 or 8 ft and a cobra head (Philips Road
Focus); a round concrete one 25 or 28 ft with a mast arm; an octagonal one 26.5 or 29 ft; a
fluted Union Metal one 29 ft with a 7 ft arm and a pendant (Philips Renaissance, Holophane
Memphis); the pedestrian poles 16 ft with a post top. Each record here carries the form its
type is built to (``FORMS``) and the catalog line it came from.

Written into each San Francisco furniture file whose area they fall in as
``geometry_based.street_lights``. A Mapillary utility pole within 6 m of one is that streetlight,
seen from the street: it is dropped from ``inferred.detected_utility_poles``, so the light is not
drawn a second time as a wooden pole with crossarms. Then the files' windowed cells are cut again.

    .venv/bin/python scripts/ingest_streetlights.py [--refresh]
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
from smc.net import use_certifi  # noqa: E402

CACHE = ROOT / "build" / "kerb_assets" / "sfpuc-streetlights.json"
LAYER = ("https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/"
         "SFPUC_Streetlights/FeatureServer/0/query")
PAGE = 2000
USER_AGENT = "Kerbside street furniture ingest (https://spatial-data-mapping.vercel.app)"
FT = 0.3048
#: A Mapillary pole this close to a city streetlight is that streetlight.
SAME_POLE_M = 6.0

_STEEL_ARM = ("mast_arm", 28.5, 6, "cobra_head", "galvanized_steel",
              "Ameron steel pole PL254-PL308: 25-30 ft, single elliptical mast arm 4-8 ft; Philips Road Focus")
_ROUND_STEEL = ("mast_arm", 28.5, 6, "cobra_head", "galvanized_steel",
                "Valmont DB00125 round tapered: 16, 25, 28.5 ft, single arm 1.83-6 ft")
_FLUTED = ("pendant", 29, 7, "acorn_pendant", "dark_blue_steel",
           "Union Metal N70028 round fluted tapered: 29 ft, single or dual 7 ft arm; "
           "Philips Renaissance / Holophane Memphis pendant")
_POST_TOP = ("post_top", 16, 0, "acorn", "dark_blue_steel",
             "pedestrian poles (KW RSP16, Lumec SM6N-16, Union Metal N1122): 16 ft, post-top tenon")
#: Each SFPUC pole type: (form, pole height ft, arm ft, luminaire, finish, catalog basis).
FORMS = {
    "SL-StdSteel": _STEEL_ARM,
    "SL-RndSteel": _ROUND_STEEL, "SL-MBRndSteel": _ROUND_STEEL, "SL-(MB)RndSteel": _ROUND_STEEL,
    "SL-SqSteel": ("mast_arm", 25, 4, "cobra_head", "galvanized_steel", "KW 25 ft pole, 4 ft arm"),
    "SL-OctaSteel": ("mast_arm", 29, 6, "cobra_head", "galvanized_steel",
                     "octagonal standard, as the Ameron 5B1 concrete: 26.5 or 29 ft, mast arm"),
    "SL-Davit": ("mast_arm", 30, 8, "cobra_head", "galvanized_steel", "Ameron steel pole, 30 ft with 8 ft arm"),
    "SL-RndConc": ("mast_arm", 28, 6, "cobra_head", "concrete",
                   "Ameron Contemporary 1C3 spun-cast concrete: 25 and 28 ft, post top or mast arm"),
    "SL-OctaConc": ("mast_arm", 29, 6, "cobra_head", "concrete",
                    "Ameron Contemporary 5B1 octagonal concrete: 26.5 or 29 ft, post top or mast arm "
                    "(Type D bracket, SFPUC PE2656.09-10)"),
    "TP-SqConc": ("mast_arm", 28, 6, "cobra_head", "concrete", "concrete trolley pole with a streetlight arm"),
    "SL-Wood": ("mast_arm", 25, 6, "cobra_head", "wood", "wood pole with a streetlight arm"),
    "SL-FluteSteel": _FLUTED, "TP-FluteSteel": _FLUTED,
    "SL-LPoulsen14": ("post_top", 14, 0, "dome", "aluminium", "Louis Poulsen 14 ft post top (named in the type)"),
    "SL-Alcott16": ("post_top", 16, 0, "acorn", "dark_blue_steel", "Alcott 16 ft post top (named in the type)"),
    "SL-StarkP": _POST_TOP, "SL-RndAlum": _POST_TOP,
    # Muni's trolley-wire poles carry a streetlight arm above the wire hangers.
    "TP-StdSteel": ("mast_arm", 30, 8, "cobra_head", "galvanized_steel",
                    "trolley pole with a streetlight arm; 30 ft with 8 ft arm as the Ameron steel pole"),
    "TP-RndSteel": ("mast_arm", 30, 8, "cobra_head", "galvanized_steel",
                    "trolley pole with a streetlight arm; 30 ft with 8 ft arm as the Ameron steel pole"),
    "TP-MBRndSteel": _ROUND_STEEL, "TP-(MB)RndSteel": _ROUND_STEEL,
    # Market Street's Path of Gold standards: three lamps on a trident crown. Not in the catalog;
    # the height is the standards' commonly given one.
    "TP-POGsteel": ("trident", 32, 0, "globes", "dark_steel", "Path of Gold standard, Market Street (not in the catalog)"),
    # Chinatown's dragon standards: two lanterns. Not in the catalog; height estimated.
    "SL-DraSteel": ("twin_pendant", 17, 2, "lantern", "red_steel", "Chinatown dragon standard (not in the catalog)"),
}
#: Not drawn as a pole: a light on a traffic signal's own pole (drawn with the signal), and the
#: wall and ceiling mounts, whose wall the layer does not give.
NOT_POLES = ("TS-", "SL-Wall", "SL-Ceiling")


def fetch(url: str, timeout: int = 120) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def streetlights(refresh: bool) -> list[dict]:
    if CACHE.exists() and not refresh:
        return json.loads(CACHE.read_text())
    rows, offset = [], 0
    while True:
        query = urllib.parse.urlencode({
            "where": "1=1", "outFields": "assetnum,pole_type,material,status", "outSR": 4326,
            "orderByFields": "objectid", "resultOffset": offset, "resultRecordCount": PAGE, "f": "json"})
        page = json.loads(fetch(f"{LAYER}?{query}"))
        if "error" in page:
            raise SystemExit(f"SFPUC layer: {page['error']}")
        features = page.get("features") or []
        rows += [{**f["attributes"], "lon": f["geometry"]["x"], "lat": f["geometry"]["y"]}
                 for f in features if f.get("geometry")]
        if len(features) < PAGE and not page.get("exceededTransferLimit"):
            break
        offset += len(features)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(rows))
    return rows


def records(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        kind = row.get("pole_type") or ""
        if (row.get("status") or "ACTIVE").upper() != "ACTIVE" or kind.startswith(NOT_POLES):
            continue
        form, height, arm, luminaire, finish, basis = FORMS.get(kind, _STEEL_ARM)
        out.append({
            "id": f"sfpuc:streetlight:{row.get('assetnum')}", "kind": "street_light",
            "p": [round(row["lon"], 7), round(row["lat"], 7)],
            "pole_type": kind, "material": (row.get("material") or "").lower() or None,
            "form": form, "height_m": round(height * FT, 2), "arm_m": round(arm * FT, 2),
            "luminaire": luminaire, "finish": finish,
            "dimension_basis": basis if kind in FORMS else f"unlisted type {kind!r}: as the standard steel pole",
            "source": "sfpuc_streetlights", "provenance": "official_asset_point",
        })
    return out


def inside(bbox: dict, lon: float, lat: float) -> bool:
    return bbox["west"] <= lon <= bbox["east"] and bbox["south"] <= lat <= bbox["north"]


def metres(a: list[float], b: list[float]) -> float:
    return math.hypot((a[0] - b[0]) * 88_000.0, (a[1] - b[1]) * 111_320.0)


def off_streetlights(poles: list[dict], lights: list[dict]) -> list[dict]:
    """Mapillary's poles that are not one of the city's streetlights."""
    grid: dict[tuple[int, int], list[list[float]]] = {}
    for light in lights:
        grid.setdefault((int(light["p"][0] * 1500), int(light["p"][1] * 1500)), []).append(light["p"])
    kept = []
    for pole in poles:
        key = (int(pole["p"][0] * 1500), int(pole["p"][1] * 1500))
        near = [p for dx in (-1, 0, 1) for dy in (-1, 0, 1) for p in grid.get((key[0] + dx, key[1] + dy), [])]
        if not any(metres(pole["p"], p) < SAME_POLE_M for p in near):
            kept.append(pole)
    return kept


SOURCE = {
    "id": "sfpuc_streetlights", "name": "SFPUC Streetlights (San Francisco Public Utilities Commission)",
    "url": "https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/SFPUC_Streetlights/FeatureServer/0",
    "license": "City and County of San Francisco public map layer (no licence stated)",
    "provenance": "official_asset_point",
    "methodology": "Active SFPUC-owned streetlights with their pole type. Height, arm and luminaire per pole type "
                   "from the SFPUC Streetlight Catalog (2022-02); traffic-signal, wall and ceiling mounts not drawn "
                   "as poles. Mapillary poles within 6 m of one dropped as the same pole.",
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    use_certifi()
    lights = records(streetlights(args.refresh))
    files = [ROOT / "docs/sf-corridor-furniture.json",
             *sorted((ROOT / "docs/regions").glob("*/sf-corridor-furniture.json")),
             *sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-furniture.json"))]
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    report = {}
    for path in files:
        document = json.loads(path.read_text())
        bbox = document.get("bbox")
        if not bbox:
            continue
        here = [light for light in lights if inside(bbox, *light["p"])]
        if not here:
            continue
        document.setdefault("geometry_based", {})["street_lights"] = here
        inferred = document.setdefault("inferred", {})
        before = len(inferred.get("detected_utility_poles") or [])
        inferred["detected_utility_poles"] = off_streetlights(inferred.get("detected_utility_poles") or [], here)
        if SOURCE["id"] not in {s.get("id") for s in document.get("sources", []) if isinstance(s, dict)}:
            document.setdefault("sources", []).append(SOURCE)
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        if (path.parent / "cells/sf-corridor-furniture/manifest.json").exists():
            cut(path)
        report[str(path.relative_to(ROOT))] = {
            "street_lights": len(here),
            "forms": {f: sum(1 for x in here if x["form"] == f) for f in sorted({x["form"] for x in here})},
            "mapillary_poles_that_were_streetlights": before - len(inferred["detected_utility_poles"])}
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
