#!/usr/bin/env python3
"""San Francisco's own streetlights, by pole type, into every San Francisco region's furniture
(and San Jose's, from its DOT fixture layer, into San Jose's).

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
drawn a second time as a wooden pole with crossarms.

And one pole is drawn per pole. Mapillary places a map feature per detection cluster, and one
pole is often several features a few metres apart -- nearest-neighbour distances between the
published poles peaked at 2-4 m, where poles stand 30-45 m apart -- so a block drew three or four
poles, crossarms and all, where one stands (and an old pole seen in 2019 beside the one that
replaced it). The span builder (scripts/build_electrical_spans.py) already merges detections
within 6 m into one pole and hangs its wires from that; the same merge
(smc.infrastructure.electrical.merge_duplicate_poles) is applied here to what the page draws, so
the poles drawn are the ones the wires hang from. And only poles with something saying they carry
a line are drawn as utility poles (on_the_lines): Mapillary's class is every pole, lamp posts and
sign poles included. Then the files' windowed cells are cut again.

    .venv/bin/python scripts/ingest_streetlights.py [--refresh]
"""

from __future__ import annotations

import argparse
import gzip
import itertools
import json
import math
import runpy
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.infrastructure.electrical import merge_duplicate_poles  # noqa: E402
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


def off_streetlights(poles: list[dict], lights: list[dict], span_ends: frozenset = frozenset()) -> list[dict]:
    """Mapillary's poles that are not one of the city's streetlights. A pole a photographed
    conductor ends on (``span_ends``) is a utility pole whatever stands beside it."""
    grid: dict[tuple[int, int], list[list[float]]] = {}
    for light in lights:
        grid.setdefault((int(light["p"][0] * 1500), int(light["p"][1] * 1500)), []).append(light["p"])
    kept = []
    for pole in poles:
        key = (int(pole["p"][0] * 1500), int(pole["p"][1] * 1500))
        near = [p for dx in (-1, 0, 1) for dy in (-1, 0, 1) for p in grid.get((key[0] + dx, key[1] + dy), [])]
        if str(pole["id"]) in span_ends or not any(metres(pole["p"], p) < SAME_POLE_M for p in near):
            kept.append(pole)
    return kept


def one_per_pole(mapped: list[dict], detected: list[dict],
                 span_ends: frozenset = frozenset()) -> tuple[list[dict], list[dict]]:
    """The mapped and detected poles with each physical pole once (merge_duplicate_poles), at the
    mean of its detections. Where a wire span ends on one of a pole's detections, that detection
    is the one drawn, so the wire meets the pole."""
    poles = mapped + detected
    if not poles:
        return mapped, detected
    lon0 = sum(p["p"][0] for p in poles) / len(poles)
    lat0 = sum(p["p"][1] for p in poles) / len(poles)
    k = math.cos(math.radians(lat0)) * 111_320.0
    by_id = {str(p["id"]): p for p in poles}
    merged, alias = merge_duplicate_poles(
        [{"id": str(p["id"]), "xy": ((p["p"][0] - lon0) * k, (p["p"][1] - lat0) * 111_320.0)} for p in poles])
    members: dict[str, list[str]] = {}
    for member, representative in alias.items():
        if member != representative:
            members.setdefault(representative, []).append(member)
    kept = set()
    for rep in merged:
        cluster = sorted([rep["id"], *members.get(rep["id"], [])])
        ends = [i for i in cluster if i in span_ends]
        chosen = rep["id"] if not ends or rep["id"] in ends else ends[0]
        pole = by_id[chosen]
        if len(cluster) > 1:
            pole["merged_detections"] = [i for i in cluster if i != chosen]
            # One pole seen from several places stands where they agree: the mean of its
            # detections (not another span's end, which is a pole of its own). A mapped pole
            # was placed by a person and stays where it was put.
            same = [by_id[i] for i in cluster if i == chosen or i not in span_ends]
            if not str(chosen).startswith("osm:") and len(same) > 1:
                pole["p_detected"] = pole["p"]
                pole["p"] = [round(sum(q["p"][0] for q in same) / len(same), 7),
                             round(sum(q["p"][1] for q in same) / len(same), 7)]
                pole["position_basis"] = "mean_of_merged_detections"
        kept.add(chosen)
        # A second span end in the cluster is a second pole the wires say is there.
        kept.update(ends)
    return ([p for p in mapped if str(p["id"]) in kept], [p for p in detected if str(p["id"]) in kept])


#: A detection this near PG&E's line route (GRIP) may be one of the line's poles.
ON_LINE_M = 8.0
#: Along a line, a detection this near a pole already drawn is that pole, or a lamp or sign post
#: beside it: a distribution line's poles stand 25-45 m apart.
LINE_POLE_SPACING_M = 12.0
GRIP = ROOT / "data/electrical/grip"


def grip_lines(region: str) -> list[list[list[float]]] | None:
    """PG&E's line sections in the region (scripts/ingest_pge_grip.py), or None where it has none."""
    path = GRIP / f"{region}.json.gz"
    if not path.is_file():
        return None
    return [line["points"] for line in json.loads(gzip.decompress(path.read_bytes())).get("lines", [])
            if len(line.get("points") or []) >= 2]


def on_the_lines(mapped: list[dict], detected: list[dict], span_ends: frozenset,
                 lines: list[list[list[float]]] | None) -> tuple[list[dict], list[dict]]:
    """Of the detected poles, the ones that are the electrical network's, and the rest.

    Mapillary's utility-pole class is every pole: lamp posts, signal and sign poles, as well as the
    wooden ones carrying the wires, detected every 8-12 m along a street. Every one was drawn as a
    10.5 m wooden pole with a crossarm and insulators, which jammed a block with crossarms where one
    line runs. A detection is drawn as a utility pole where something says it carries a line: a
    photographed span ends on it, or it stands on PG&E's route -- then thinned to the spacing a
    line's poles stand at, keeping the ones seen most. The rest are kept, undrawn, as poles of
    unknown kind. Where there is no PG&E route (Palo Alto runs its own utility), nothing is dropped.
    """
    if lines is None:
        return detected, []
    pts = mapped + detected
    if not pts:
        return detected, []
    lat0 = sum(p["p"][1] for p in pts) / len(pts)
    k = math.cos(math.radians(lat0)) * 111_320.0
    def xy(p):
        return (p[0] * k, p[1] * 110_540.0)
    cell = 25.0
    grid: dict[tuple[int, int], list] = {}
    for line in lines:
        q = [xy(p) for p in line]
        for a, b in itertools.pairwise(q):
            steps = max(1, int(math.dist(a, b) // cell) + 1)
            for t in range(steps + 1):
                x, y = a[0] + (b[0] - a[0]) * t / steps, a[1] + (b[1] - a[1]) * t / steps
                grid.setdefault((int(x // cell), int(y // cell)), []).append((a, b))
    def to_line(p) -> float:
        x, y = xy(p)
        best = math.inf
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for a, b in grid.get((int(x // cell) + dx, int(y // cell) + dy), []):
                    vx, vy = b[0] - a[0], b[1] - a[1]
                    t = max(0.0, min(1.0, ((x - a[0]) * vx + (y - a[1]) * vy) / ((vx * vx + vy * vy) or 1.0)))
                    best = min(best, math.hypot(x - a[0] - t * vx, y - a[1] - t * vy))
        return best
    confirmed = [p for p in detected if str(p["id"]) in span_ends]
    candidates = sorted((p for p in detected if str(p["id"]) not in span_ends and to_line(p["p"]) <= ON_LINE_M),
                        key=lambda p: (-len(p.get("merged_detections") or []), str(p["id"])))
    standing = [xy(p["p"]) for p in mapped + confirmed]
    drawn = list(confirmed)
    for pole in candidates:
        here = xy(pole["p"])
        if all(math.dist(here, s) >= LINE_POLE_SPACING_M for s in standing):
            standing.append(here)
            drawn.append(pole)
    ids = {str(p["id"]) for p in drawn}
    rest = [{**p, "kind": "pole", "drawn": False, "why_not_drawn": "no_line_evidence"}
            for p in detected if str(p["id"]) not in ids]
    return [p for p in detected if str(p["id"]) in ids], rest


SOURCE = {
    "id": "sfpuc_streetlights", "name": "SFPUC Streetlights (San Francisco Public Utilities Commission)",
    "url": "https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/SFPUC_Streetlights/FeatureServer/0",
    "license": "City and County of San Francisco public map layer (no licence stated)",
    "provenance": "official_asset_point",
    "methodology": "Active SFPUC-owned streetlights with their pole type. Height, arm and luminaire per pole type "
                   "from the SFPUC Streetlight Catalog (2022-02); traffic-signal, wall and ceiling mounts not drawn "
                   "as poles. Mapillary poles within 6 m of one dropped as the same pole.",
}


# San Jose publishes its lights too: DOT's Street Light Fixture layer, a record per fixture with
# its pole number, fixture type and mount, updated weekly. It says what the fixture is and not
# how tall the pole is, so the heights are the usual ones for each kind and say so.
#
# Mapillary's street-light map features were tried first, for the cities that publish nothing,
# and measured against this layer: 30% of them stand within 8 m of a light the city has, and
# 44% even among those seen four times or more. Drawn, most would be lamps where none stands,
# so they are not drawn; Oakland and Palo Alto have no streetlights until a city record turns
# up. Berkeley's turned up: below.
SAN_JOSE_LAYER = ("https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/"
                  "MapServer/425/query")
_SJ_ROADWAY = ("mast_arm", 30, 6, "cobra_head", "galvanized_steel",
               "roadway fixture on a mast arm; 30 ft pole and 6 ft arm assumed (the layer gives neither)")
_SJ_ACORN = ("post_top", 14, 0, "acorn", "dark_steel", "acorn post top; 14 ft pedestrian pole assumed")
#: San Jose fixture type: (form, pole height ft, arm ft, luminaire, finish, basis).
SAN_JOSE_FORMS = {
    "ROADWAY-LED": _SJ_ROADWAY, "ROADWAY-NONLED": _SJ_ROADWAY,
    "POST TOP-ACORN": _SJ_ACORN,
    "POST TOP-TWIN ACORN": ("twin_pendant", 14, 1.5, "acorn", "dark_steel",
                            "twin acorns on a crossarm; 14 ft pedestrian pole assumed"),
    "DOWNTOWN HELMET": ("post_top", 16, 0, "dome", "dark_steel",
                        "downtown helmet post top; 16 ft pedestrian pole assumed"),
    "MARTINI": ("post_top", 14, 0, "acorn", "dark_steel", "martini post top; 14 ft pole assumed"),
    "CANE": ("pendant", 16, 3, "acorn_pendant", "dark_steel",
             "cane arm with a hung luminaire; 16 ft pole and 3 ft arm assumed"),
}
#: Not a pole of its own: lights on buildings (uplight, soffit, wall), floodlights, and the
#: lights on a traffic signal's mast, which is drawn with the signal.
SAN_JOSE_NOT_POLES = {"UPLIGHT", "SOFFIT", "WALL", "WALLPACK", "FLOODLIGHT"}
SAN_JOSE_SOURCE = {
    "id": "san_jose_dot_streetlights", "name": "Street Light Fixture (City of San José DOT)",
    "url": SAN_JOSE_LAYER.removesuffix("/query"),
    "license": "City of San José GIS data, provided as is (no licence stated)",
    "provenance": "official_asset_point",
    "methodology": "Existing fixtures on their own poles, one per pole number; form from the fixture and mount "
                   "type, heights assumed per kind; building-mounted lights, floodlights and traffic-signal "
                   "mounts not drawn as poles. Mapillary poles within 6 m of one dropped as the same pole.",
}


def san_jose_streetlights(bbox: dict, refresh: bool, name: str) -> list[dict]:
    path = CACHE.parent / f"sanjose-streetlights-{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    rows, offset = [], 0
    while True:
        query = urllib.parse.urlencode({
            "geometry": f"{bbox['west']},{bbox['south']},{bbox['east']},{bbox['north']}",
            "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
            "outFields": "OBJECTID,BADGEID,LIGHTFIXTURETYPE,MOUNTTYPE,LIGHTSTATUS,POLEUSE,ISDUPLICATE",
            "outSR": 4326, "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": 1000,
            "f": "json"})
        page = json.loads(fetch(f"{SAN_JOSE_LAYER}?{query}", timeout=180))
        if "error" in page:
            raise SystemExit(f"San Jose streetlight layer: {page['error']}")
        features = page.get("features") or []
        rows += [{**f["attributes"], "lon": f["geometry"]["x"], "lat": f["geometry"]["y"]}
                 for f in features if f.get("geometry")]
        if not features or not page.get("exceededTransferLimit"):
            break
        offset += len(features)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    return rows


def san_jose_records(rows: list[dict]) -> list[dict]:
    poles: dict[str, dict] = {}
    for row in rows:
        fixture = (row.get("LIGHTFIXTURETYPE") or "").upper()
        mount = (row.get("MOUNTTYPE") or "").upper()
        if ((row.get("LIGHTSTATUS") or "").upper() != "EXISTING"
                or (row.get("ISDUPLICATE") or "").upper() == "YES"
                or fixture in SAN_JOSE_NOT_POLES or mount in SAN_JOSE_NOT_POLES
                or (row.get("POLEUSE") or "").upper() == "ST LIGHT & TRAFFIC SIGNAL"):
            continue
        spec = SAN_JOSE_FORMS.get(fixture) or (_SJ_ROADWAY if mount == "MAST ARM" else
                                               _SJ_ACORN if mount == "POST TOP" else None)
        if spec is None:
            continue
        form, height, arm, luminaire, finish, basis = spec
        if (row.get("POLEUSE") or "").upper() == "UTILITY":
            finish, basis = "wood", basis + "; on a utility pole"
        pole = str(row.get("BADGEID") or f"oid{row.get('OBJECTID')}")
        record = {
            "id": f"sanjose:streetlight:{pole}", "kind": "street_light",
            "p": [round(row["lon"], 7), round(row["lat"], 7)], "pole_type": fixture or mount,
            "form": form, "height_m": round(height * FT, 2), "arm_m": round(arm * FT, 2),
            "luminaire": luminaire, "finish": finish, "dimension_basis": basis,
            "source": SAN_JOSE_SOURCE["id"], "provenance": "official_asset_point",
        }
        # Two fixtures on one pole are one pole: the roadway arm is the one drawn.
        if pole not in poles or (form == "mast_arm" and poles[pole]["form"] != "mast_arm"):
            poles[pole] = record
    return list(poles.values())


# Berkeley's lights are the inventory its 2017 LED conversion made of every one of them
# (Socrata dz4s-un9u, "Streetlights20170921"): pole material, mounting height in bands, arm
# length in feet, single or twin heads. Not the "Streetlights" map (w9v4-y3pu), which is the
# empty shell smc.official.city_records describes.
BERKELEY_TABLE = "https://data.cityofberkeley.info/resource/dz4s-un9u.json"
#: Mounting-height band: the pole height drawn, in feet (the middle of the band).
BERKELEY_HEIGHT_FT = {"< 25 feet": 21, "<25 feet": 21, "25-30 feet": 27.5, "> 30 feet": 32}
BERKELEY_SOURCE = {
    "id": "berkeley_streetlights_2017", "name": "Streetlights20170921 (City of Berkeley)",
    "url": "https://data.cityofberkeley.info/d/dz4s-un9u",
    "license": "City of Berkeley open data (no licence stated)",
    "provenance": "official_asset_point",
    "methodology": "Every light in the city's 2017 LED conversion inventory; height the middle of its "
                   "mounting band, arm as recorded; a metal pole with an arm of 2 ft or less under 25 ft is a "
                   "post top (twin heads a pair on a crossarm); lights on wood poles drawn on wood. "
                   "Mapillary poles within 6 m of one dropped as the same pole.",
}


def berkeley_streetlights(bbox: dict, refresh: bool, name: str) -> list[dict]:
    path = CACHE.parent / f"berkeley-streetlights-{name}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    query = urllib.parse.urlencode({
        "$where": f"within_box(the_geom,{bbox['north']},{bbox['west']},{bbox['south']},{bbox['east']})",
        "$limit": 50000})
    rows = json.loads(fetch(f"{BERKELEY_TABLE}?{query}", timeout=180))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows))
    return rows


def berkeley_records(rows: list[dict]) -> list[dict]:
    out = []
    for row in rows:
        point = (row.get("the_geom") or {}).get("coordinates")
        if not point or (row.get("installed") or "YES").upper() != "YES":
            continue
        wood = (row.get("pole_mater") or "").lower() == "wood"
        band = (row.get("mounting_h") or "").strip()
        height = BERKELEY_HEIGHT_FT.get(band.lower(), 27.5)
        try:
            arm = float(row.get("arm_length") or 0)
        except ValueError:
            arm = 0.0
        twin = (row.get("heads") or "").lower() == "twin"
        if not wood and arm <= 2 and height < 25:
            form, luminaire, finish = ("twin_pendant" if twin else "post_top"), "acorn", "dark_steel"
            arm = 1.5 if twin else 0
        else:
            form, luminaire, finish = "mast_arm", "cobra_head", "wood" if wood else "galvanized_steel"
        out.append({
            "id": f"berkeley:streetlight:{row.get('facilityid') or row.get('unique_id')}", "kind": "street_light",
            "p": [round(float(point[0]), 7), round(float(point[1]), 7)],
            "pole_type": f"{row.get('pole_mater') or '?'} {band or '?'}", "material": (row.get("pole_mater") or "").lower() or None,
            "form": form, "height_m": round(height * FT, 2), "arm_m": round(arm * FT, 2),
            "luminaire": luminaire, "finish": finish, "heads": 2 if twin else 1,
            "dimension_basis": f"mounting band {band or 'unknown'}, arm {row.get('arm_length') or '?'} ft as recorded",
            "source": BERKELEY_SOURCE["id"], "provenance": "official_asset_point",
        })
    return out


#: The cities other than San Francisco that publish their lights: region prefix -> how.
CITY_LIGHTS = {
    "san-jose": (san_jose_streetlights, san_jose_records, SAN_JOSE_SOURCE),
    "berkeley": (berkeley_streetlights, berkeley_records, BERKELEY_SOURCE),
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--region", action="append",
                    help="only these regions' furniture files (sf-corridor for the corridor's)")
    args = ap.parse_args()
    use_certifi()
    lights = records(streetlights(args.refresh))
    files = [ROOT / "docs/sf-corridor-furniture.json",
             *sorted((ROOT / "docs/regions").glob("*/sf-corridor-furniture.json")),
             *sorted((ROOT / "docs/app-regions").glob("*/sf-corridor-furniture.json"))]
    if args.region:
        files = [f for f in files
                 if ("sf-corridor" if f.parent == ROOT / "docs" else f.parent.name) in args.region]
    cut = runpy.run_path(str(ROOT / "tools/build_window_cells.py"))["cut"]
    report = {}
    for path in files:
        try:
            spans = json.loads((path.parent / "sf-corridor-electrical.json").read_text()).get("spans") or []
        except (OSError, ValueError):
            spans = []
        span_ends = frozenset(str(s.get(k)) for s in spans for k in ("a", "b") if s.get(k) is not None)
        document = json.loads(path.read_text())
        bbox = document.get("bbox")
        if not bbox:
            continue
        here = [light for light in lights if inside(bbox, *light["p"])]
        source = SOURCE
        city = next((c for c in CITY_LIGHTS if path.parent.name.startswith(c)), None)
        if not here and city:
            fetch_city, to_records, source = CITY_LIGHTS[city]
            here = [light for light in to_records(fetch_city(bbox, args.refresh, path.parent.name))
                    if inside(bbox, *light["p"])]
        inferred = document.setdefault("inferred", {})
        before = len(inferred.get("detected_utility_poles") or [])
        entry = {}
        if here:
            document.setdefault("geometry_based", {})["street_lights"] = here
            inferred["detected_utility_poles"] = off_streetlights(inferred.get("detected_utility_poles") or [], here, span_ends)
            if source["id"] not in {s.get("id") for s in document.get("sources", []) if isinstance(s, dict)}:
                document.setdefault("sources", []).append(source)
            entry = {"street_lights": len(here),
                     "forms": {f: sum(1 for x in here if x["form"] == f) for f in sorted({x["form"] for x in here})},
                     "mapillary_poles_that_were_streetlights": before - len(inferred["detected_utility_poles"])}
        mapped, detected = inferred.get("utility_poles") or [], inferred.get("detected_utility_poles") or []
        if not here and not (mapped or detected):
            continue
        poles_before = len(mapped) + len(detected)
        inferred["utility_poles"], inferred["detected_utility_poles"] = one_per_pole(mapped, detected, span_ends)
        merged = len(inferred["utility_poles"]) + len(inferred["detected_utility_poles"])
        region = "sf-corridor" if path.parent == ROOT / "docs" else path.parent.name
        inferred["detected_utility_poles"], inferred["detected_poles_unattributed"] = on_the_lines(
            inferred["utility_poles"], inferred["detected_utility_poles"], span_ends, grip_lines(region))
        entry["utility_poles_detected_merged_drawn"] = [
            poles_before, merged, len(inferred["utility_poles"]) + len(inferred["detected_utility_poles"])]
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        if (path.parent / "cells/sf-corridor-furniture/manifest.json").exists():
            cut(path)
        report[str(path.relative_to(ROOT))] = entry
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
