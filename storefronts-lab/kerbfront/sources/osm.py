"""OpenStreetMap: businesses with full tags, building outlines and named street centrelines.

Overpass answers this Mac when the request carries a User-Agent (the earlier 406s were a bare
urllib client). A Geofabrik ``.osm.pbf`` can be given instead (``pbf=``) when Overpass is busy;
that path needs ``osmium`` (``uv pip install --python .venv/bin/python osmium``).

Tags kept for exteriors: name, brand, shop/amenity/craft/office/tourism/leisure/healthcare,
cuisine, outdoor_seating, opening_hours, wheelchair, website, addr:*, building:*, roof:*,
check_date, start_date, level, entrance, plus anything starting with ``building``/``roof``.
"""

from __future__ import annotations

import urllib.parse

from ..config import BBox
from .http import get_json

OVERPASS = "https://overpass-api.de/api/interpreter"
KINDS = ("shop", "amenity", "craft", "office", "tourism", "leisure", "healthcare")
ROADS = "primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|trunk"


def query(b: BBox) -> str:
    bb = f"({b.south},{b.west},{b.north},{b.east})"
    pois = "".join(f'nwr["{k}"]{bb};' for k in KINDS)
    return (f"[out:json][timeout:180];({pois}way[\"building\"]{bb};"
            f"way[\"highway\"~\"^({ROADS})$\"][\"name\"]{bb};"
            f"node[\"entrance\"]{bb};);out tags geom;")


def fetch(b: BBox, refresh: bool = False) -> tuple[list[dict], dict]:
    rec = get_json("osm", OVERPASS, None, data="data=" + urllib.parse.quote(query(b)), refresh=refresh, timeout=240)
    els = rec["body"].get("elements", [])
    prov = {"dataset": "osm-overpass", "url": OVERPASS, "retrieved_at": rec["retrieved_at"],
            "osm_base": rec["body"].get("osm3s", {}).get("timestamp_osm_base"),
            "licence": "ODbL 1.0, (c) OpenStreetMap contributors"}
    return els, prov


def split(elements: list[dict]) -> dict[str, list[dict]]:
    """{"pois", "buildings", "streets", "entrances"} with lon/lat and a flat geometry list."""
    out: dict[str, list[dict]] = {"pois": [], "buildings": [], "streets": [], "entrances": []}
    for e in elements:
        tags = e.get("tags", {})
        geom = e.get("geometry") or []
        if e["type"] == "node":
            lon, lat = e.get("lon"), e.get("lat")
        elif geom:
            lon = sum(p["lon"] for p in geom) / len(geom)
            lat = sum(p["lat"] for p in geom) / len(geom)
        elif "bounds" in e:
            bd = e["bounds"]
            lon, lat = (bd["minlon"] + bd["maxlon"]) / 2, (bd["minlat"] + bd["maxlat"]) / 2
        else:
            continue
        rec = {"id": f"{e['type']}/{e['id']}", "tags": tags, "lon": lon, "lat": lat,
               "geometry": [(p["lon"], p["lat"]) for p in geom]}
        if "highway" in tags and e["type"] == "way":
            out["streets"].append(rec)
        elif any(k in tags for k in KINDS):
            out["pois"].append(rec)
        elif "building" in tags and e["type"] == "way":
            out["buildings"].append(rec)
        elif "entrance" in tags:
            out["entrances"].append(rec)
    return out


def from_pbf(path: str, b: BBox) -> list[dict]:  # pragma: no cover - needs osmium + a pbf
    import osmium

    els: list[dict] = []

    class H(osmium.SimpleHandler):
        def node(self, n):
            if n.location.valid() and b.contains(n.location.lat, n.location.lon):
                tags = {t.k: t.v for t in n.tags}
                if any(k in tags for k in KINDS) or "entrance" in tags:
                    els.append({"type": "node", "id": n.id, "lat": n.location.lat,
                                "lon": n.location.lon, "tags": tags})

        def way(self, w):
            tags = {t.k: t.v for t in w.tags}
            if not ("building" in tags or "highway" in tags or any(k in tags for k in KINDS)):
                return
            try:
                geom = [{"lon": n.lon, "lat": n.lat} for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            if any(b.contains(p["lat"], p["lon"]) for p in geom):
                els.append({"type": "way", "id": w.id, "tags": tags, "geometry": geom})

    H().apply_file(path, locations=True)
    return els
