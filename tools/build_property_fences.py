"""Build docs/property-fences.json: which San Francisco properties are fenced, and where.

Sources (snapshots kept gzipped in data/sf_fences/, fetched with ``--fetch``):

* DataSF gtnh-hgvs  City Lands: every parcel the city owns, by department (school district
  campuses, parks, reservoirs, yards, stations).
* DataSF 7e7j-59qk  Schools: public and private, as points; a private school's parcel is the
  Planning land-use parcel (c5ge-t6pj, institutional floor area > 0) under its point.
* DataSF rny7-88gk  Linear assets of the Recreation and Parks Department: the fences and gates
  in the parks, surveyed as lines. This is what says which sides of a park are fenced.
* DataSF c5ge-t6pj  Land use: the parcels flagged as car parks.
* OpenStreetMap (Overpass): mapped fences, walls, hedges and gates; school, nursery and car
  park outlines with their access tags.

The verdicts are smc.parks.fencing's. Usage:

    PYTHONPATH=src python tools/build_property_fences.py [--fetch] [--out docs/property-fences.json]
"""
import argparse
import gzip
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "src")]

from shapely.geometry import LineString, Polygon  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

from smc.parks import fencing as F  # noqa: E402

SNAPSHOTS = ROOT / "data" / "sf_fences"
BOX = (37.70, -122.53, 37.84, -122.35)   # south, west, north, east
SOCRATA = "https://data.sfgov.org/resource/{id}.json?{query}"
SOURCES = {
    "city_lands": ("gtnh-hgvs", {"$limit": 20000}),
    "schools": ("7e7j-59qk", {"$limit": 5000}),
    "rpd_linear": ("rny7-88gk", {"$limit": 200000}),
    "land_use_institutional": ("c5ge-t6pj", {"$where": "cie > 0", "$select": "the_geom,ludb_id,cie,mapblklot", "$limit": 50000}),
    "land_use_parking": ("c5ge-t6pj", {"$where": "parking_lo = true", "$select": "the_geom,ludb_id,mapblklot", "$limit": 50000}),
}
OVERPASS = "https://overpass-api.de/api/interpreter"
OVERPASS_QUERY = (
    "[out:json][timeout:180];("
    'way["barrier"~"^(fence|wall|hedge|gate)$"]({box});'
    'node["barrier"~"^(gate|entrance|kissing_gate|swing_gate|lift_gate)$"]({box});'
    'way["amenity"~"^(school|kindergarten|childcare|parking)$"]({box});'
    'way["landuse"="cemetery"]({box});'
    ");out body geom;"
)
AGENT = "kerbside-map-build/1.0"


def fetch(name: str) -> list | dict:
    if name == "osm":
        body = urllib.parse.urlencode({"data": OVERPASS_QUERY.format(box=",".join(map(str, BOX)))}).encode()
        request = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": AGENT})
    else:
        dataset, query = SOURCES[name]
        request = urllib.request.Request(SOCRATA.format(id=dataset, query=urllib.parse.urlencode(query)), headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=600) as response:  # noqa: S310 - fixed public hosts
        return json.loads(response.read())


def save_snapshot(name: str, rows) -> dict:
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(rows, separators=(",", ":"), sort_keys=True).encode()
    with gzip.GzipFile(SNAPSHOTS / f"{name}.json.gz", "wb", mtime=0) as handle:
        handle.write(raw)
    return {"name": name, "dataset": SOURCES[name][0] if name in SOURCES else "openstreetmap", "sha256": hashlib.sha256(raw).hexdigest(),
            "rows": len(rows["elements"] if isinstance(rows, dict) else rows), "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def load_snapshot(name: str):
    with gzip.open(SNAPSHOTS / f"{name}.json.gz", "rb") as handle:
        return json.loads(handle.read())


def osm_ring(element) -> Polygon | None:
    pts = [F.to_xy((g["lon"], g["lat"])) for g in element.get("geometry") or []]
    if len(pts) < 4 or pts[0] != pts[-1]:
        return None
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.geom_type != "Polygon" or poly.area < 30:
        return None
    return poly


def gather(data: dict) -> tuple[list, list, list, Counter]:
    """(properties, fences, gates, counts) from the snapshots, in local metres."""
    counts = Counter()
    properties, fences, gates = [], [], []

    def add(pid, name, verdict, polygon, source):
        properties.append({"id": pid, "name": name, "verdict": verdict, "polygon": polygon, "source": source})
        counts[f"{source}:{verdict.kind}:{verdict.verdict}"] += 1

    # The city's own land.
    for row in data["city_lands"]:
        poly = F.polygon_xy(row.get("shape") or {})
        if poly is None:
            continue
        add(f"city:{row['land_id']}", (row.get("land_name") or "").title(), F.classify("city_land", category=row.get("category") or "", name=row.get("land_name") or ""), poly, "city_land")
    campuses = [p["polygon"] for p in properties if p["verdict"].kind == "school"]
    campus_tree = STRtree(campuses) if campuses else None

    def on_campus(point) -> bool:
        return campus_tree is not None and any(campuses[i].buffer(15).contains(point) for i in campus_tree.query(point.buffer(15)))

    # Schools not on the district's land: the institutional parcel under the school's point.
    parcels = [(F.polygon_xy(r.get("the_geom") or {}), r) for r in data["land_use_institutional"]]
    parcels = [(p, r) for p, r in parcels if p is not None]
    parcel_tree = STRtree([p for p, _ in parcels]) if parcels else None
    for row in data["schools"]:
        if row.get("status") not in (None, "Active") or not row.get("longitude"):
            continue
        try:
            point = F.point_xy(float(row["longitude"]), float(row["latitude"]))
        except ValueError:   # ("Information Redacted": a school whose address is withheld)
            counts["school_location_withheld"] += 1
            continue
        if on_campus(point):
            continue
        hits = [parcels[i] for i in (parcel_tree.query(point.buffer(25)) if parcel_tree is not None else []) if parcels[i][0].distance(point) <= 25]
        if not hits:
            counts["school_without_parcel"] += 1
            continue
        poly, parcel = min(hits, key=lambda h: h[0].distance(point))
        add(f"school:{row.get('cds_code') or parcel['ludb_id']}", row.get("school") or "", F.classify("school"), poly, "school")
        campuses.append(poly)
        campus_tree = STRtree(campuses)

    # OpenStreetMap's outlines, and its barriers.
    osm = data["osm"]["elements"]
    lots = []
    for el in osm:
        tags = el.get("tags") or {}
        if el["type"] == "way" and (tags.get("amenity") in {"school", "kindergarten", "childcare", "parking"} or tags.get("landuse") == "cemetery"):
            poly = osm_ring(el)
            if poly is None:
                continue
            verdict = F.classify("osm", tags=tags)
            if verdict.kind in {"school", "nursery"} and on_campus(poly.representative_point()):
                continue
            add(f"osm:{el['id']}", tags.get("name") or "", verdict, poly, "osm")
            if verdict.kind == "parking":
                lots.append(poly)
            elif verdict.kind == "school":
                campuses.append(poly)
                campus_tree = STRtree(campuses)
        elif el["type"] == "way" and tags.get("barrier") in {"fence", "wall", "hedge"}:
            pts = [F.to_xy((g["lon"], g["lat"])) for g in el.get("geometry") or []]
            if len(pts) < 2 or LineString(pts).length < 1.5:
                continue
            style = F.evidence_style(tags.get("fence_type"), tags.get("barrier")) or "chain_link"
            height = None
            try:
                height = float(tags["height"]) if 0.4 <= float(tags.get("height", "x")) <= 6 else None
            except ValueError:
                pass
            fences.append({"line": LineString(pts), "style": style, "height_m": height, "src": f"osm:way/{el['id']}"})
        elif el["type"] == "way" and tags.get("barrier") == "gate":
            pts = [F.to_xy((g["lon"], g["lat"])) for g in el.get("geometry") or []]
            if len(pts) >= 2:
                line = LineString(pts)
                gates.append({"point": line.interpolate(0.5, normalized=True), "width_m": max(1.0, min(6.0, line.length)), "src": f"osm:way/{el['id']}"})
        elif el["type"] == "node" and tags.get("barrier"):
            gates.append({"point": F.point_xy(el["lon"], el["lat"]), "width_m": 4.0 if tags["barrier"] == "lift_gate" else 1.2, "src": f"osm:node/{el['id']}"})
    lot_tree = STRtree(lots) if lots else None
    for row in data["land_use_parking"]:
        poly = F.polygon_xy(row.get("the_geom") or {})
        if poly is None:
            continue
        point = poly.representative_point()
        if lot_tree is not None and any(lots[i].contains(point) for i in lot_tree.query(point)):
            continue
        add(f"landuse:{row['ludb_id']}", "", F.classify("land_use_parking"), poly, "land_use")

    # The parks department's surveyed fences and gates. Where OpenStreetMap maps the same fence,
    # the survey's line is the one kept.
    surveyed = []
    for row in data["rpd_linear"]:
        kind = row.get("asset_type")
        if kind not in {"Fence", "Gate"}:
            continue
        for part, line in enumerate(F.lines_xy(row.get("shape") or {})):
            if kind == "Fence":
                style = F.evidence_style(row.get("asset_subtype")) or "chain_link"
                surveyed.append({"line": line, "style": style, "height_m": F.EVIDENCE_HEIGHT[style], "src": f"rpd:{row['asset_id']}" + (f".{part}" if part else "")})
            else:
                gates.append({"point": line.interpolate(0.5, normalized=True), "width_m": max(1.0, min(6.0, line.length)), "src": f"rpd:{row['asset_id']}"})
    if surveyed:
        near = unary_union([f["line"].buffer(2.5) for f in surveyed])
        kept = [f for f in fences if f["line"].intersection(near).length <= 0.6 * f["line"].length]
        counts["osm_fences_same_as_surveyed"] = len(fences) - len(kept)
        fences = kept + surveyed
    counts["fence_lines"], counts["gates"] = len(fences), len(gates)
    return properties, fences, gates, counts


def build(data: dict) -> dict:
    properties, fences, gates, counts = gather(data)
    records = F.assemble(properties, fences, gates)
    verdicts = Counter(f"{r['kind']}:{r['verdict']}" for r in records)
    # (Open and building-only properties are the record of a decision, not something to draw:
    # kept as a count and a short list, not as rings.)
    drawn = [r for r in records if r["verdict"] in {F.FENCED, F.EVIDENCE}]
    undrawn = [{"id": r["id"], "name": r["name"], "kind": r["kind"], "verdict": r["verdict"], "basis": r["basis"], "at": r["ring"][0]} for r in records if r not in drawn]
    return {"schema": 1, "frame": {"lon0": F.LON0, "lat0": F.LAT0},
            "rules": {"gate_max_between_m": 80, "gate_min_apart_m": 15, "on_line_m": F.ON_LINE_M},
            "counts": {"inputs": dict(sorted(counts.items())), "verdicts": dict(sorted(verdicts.items())),
                       "fence_m_recorded": round(sum(LineString([F.to_xy(p) for p in run["p"]]).length for r in drawn for run in r.get("runs", [])))},
            "properties": drawn, "decided_open": undrawn}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--fetch", action="store_true", help="download the sources again into data/sf_fences/")
    parser.add_argument("--out", default=str(ROOT / "docs" / "property-fences.json"))
    args = parser.parse_args(argv)
    names = [*SOURCES, "osm"]
    if args.fetch:
        manifest = {"schema": 1, "license": "PDDL (DataSF); ODbL (OpenStreetMap contributors)", "sources": [save_snapshot(n, fetch(n)) for n in names]}
        (SNAPSHOTS / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    out = build({n: load_snapshot(n) for n in names})
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(json.dumps(out["counts"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
