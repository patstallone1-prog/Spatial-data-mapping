"""Reading a city record, whichever of the three ways its city publishes it.

The three are a Socrata table, a Socrata geospatial export, and an ArcGIS feature service.
They differ in how a bounding box is asked for, how paging works, and what comes back, and
none of that is interesting above this module: every one of them answers with a list of
GeoJSON-shaped ``{"geometry": ..., "properties": ...}``.

A refusal is a refusal, not an empty answer. Where a service will not answer -- a token it now
wants, a layer withdrawn, an outage -- the result says so and the caller records a gap with a
reason, the same way the ground cover does. Nothing here raises into a build.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass

from smc.official.city_records import Record

USER_AGENT = "kerbside/city-records"
#: ArcGIS answers at most a few thousand features and says so; the rest are asked by offset.
ARCGIS_PAGE = 2000
#: Socrata tables page the same way.
SOCRATA_PAGE = 50_000


@dataclass
class Answer:
    """What came back, and what did not."""

    features: list[dict]
    refused: str = ""

    def __bool__(self) -> bool:
        return not self.refused


def _get(url: str, timeout: int = 180):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    return json.loads(urllib.request.urlopen(request, timeout=timeout).read())


def _inside(lon: float, lat: float, bbox: dict) -> bool:
    return (bbox["west"] <= lon <= bbox["east"]) and (bbox["south"] <= lat <= bbox["north"])


def _touches(geometry: dict, bbox: dict) -> bool:
    """Whether any vertex of the geometry falls in the box. Coarse on purpose: a geospatial
    export cannot be asked for a box, so this is the client-side filter after the fact."""
    def walk(coords):
        if not coords:
            return False
        if isinstance(coords[0], (int, float)):
            return _inside(float(coords[0]), float(coords[1]), bbox)
        return any(walk(c) for c in coords)
    return walk((geometry or {}).get("coordinates"))


def fetch(record: Record, bbox: dict, progress=None) -> Answer:
    """One record's features inside the box."""
    say = progress or (lambda _m: None)
    try:
        if record.api == "arcgis":
            return _arcgis(record, bbox, say)
        if record.api == "socrata_geospatial":
            return _socrata_geospatial(record, bbox, say)
        if record.api == "socrata_table":
            return _socrata_table(record, bbox, say)
    except Exception as exc:                      # a city's records are one source among many
        say(f"{record.key}: {record.title} refused: {exc}")
        return Answer([], refused=str(exc))
    return Answer([], refused=f"unknown api {record.api!r}")


def _arcgis(record: Record, bbox: dict, say) -> Answer:
    envelope = f"{bbox['west']},{bbox['south']},{bbox['east']},{bbox['north']}"
    out: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": "1=1", "outFields": "*", "geometry": envelope,
            "geometryType": "esriGeometryEnvelope", "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects", "outSR": "4326", "f": "geojson",
            "resultOffset": offset, "resultRecordCount": ARCGIS_PAGE,
        }
        url = f"{record.locator}/{record.layer}/query?{urllib.parse.urlencode(params)}"
        page = _get(url)
        if isinstance(page, dict) and page.get("error"):
            return Answer(out, refused=str(page["error"]))
        features = page.get("features") or []
        out.extend(features)
        say(f"{record.key}: {len(out)} features")
        more = (page.get("properties") or {}).get("exceededTransferLimit")
        if not more or not features:
            return Answer(out)
        offset += len(features)


def _socrata_geospatial(record: Record, bbox: dict, say) -> Answer:
    # A map layer, which has no row interface worth the name: /resource/<id>.json answers one
    # empty object per feature. The export carries the geometry and cannot be asked for a box,
    # so the whole layer comes down once and is filtered here.
    url = (f"https://{record.host}/api/geospatial/{record.locator}"
           "?method=export&format=GeoJSON")
    page = _get(url, timeout=600)
    features = page.get("features") or []
    inside = [f for f in features if _touches(f.get("geometry") or {}, bbox)]
    say(f"{record.key}: {len(inside)} of {len(features)} features in the region")
    return Answer(inside)


def _socrata_table(record: Record, bbox: dict, say) -> Answer:
    # No $select: a DataSF front end answers a $where happily and refuses the same query with a
    # $select on it, and the other Socrata hosts behave the same way. Columns are chosen here.
    where = ""
    if record.geometry:
        where = (f"within_box({record.geometry}, {bbox['north']}, {bbox['west']}, "
                 f"{bbox['south']}, {bbox['east']})")
    out: list[dict] = []
    while True:
        params = {"$limit": SOCRATA_PAGE, "$offset": len(out)}
        if where:
            params["$where"] = where
        url = f"https://{record.host}/resource/{record.locator}.json?{urllib.parse.urlencode(params)}"
        rows = _get(url)
        if not rows:
            break
        # A table whose rows are all empty is a geospatial layer wearing a table's clothes.
        if all(not row for row in rows):
            return Answer([], refused="rows carry no fields: this is a geospatial layer, "
                                      "which is served from /api/geospatial not /resource")
        for row in rows:
            geometry = row.get(record.geometry) if record.geometry else None
            if geometry is None and row.get("location") and isinstance(row["location"], dict):
                geometry = row["location"]
            out.append({"type": "Feature", "geometry": geometry,
                        "properties": {k: v for k, v in row.items() if k != record.geometry}})
        say(f"{record.key}: {len(out)} rows")
        if len(rows) < SOCRATA_PAGE:
            break
    return Answer(out)
