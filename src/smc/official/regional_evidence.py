"""Bounded municipal reference ingestion. Inventories are not automatically surveys.

Keep original attributes, geometry and dataset metadata together. No source here may
change the canonical world without a separately reviewed adapter/promotion step.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, datetime
from urllib.parse import urlencode

from smc.official.berkeley import get_json

SJ = "https://geo.sanjoseca.gov/server/rest/services/OPN/OPN_OpenDataService/MapServer"
PA = "https://services6.arcgis.com/evmyRZRrsopdeog7/arcgis/rest/services"
SOURCES = {
    "oakland-curb-inventory": {
        "region": "oakland-downtown", "url": "https://data.oaklandca.gov/resource/87ce-u2wf.json",
        "api": "socrata", "attribution": "City of Oakland, Downtown Oakland Parking Study",
        "catalogue": "https://www.oaklandca.gov/Public-Safety-Streets/Transportation-Projects-Reports/Parking-and-Mobility-Related-Maps-and-Data",
        "meaning": "December 2015 parking/curb inventory; historic policy evidence, not current surveyed kerbs.",
    },
    "palo-alto-road-edges": {
        "region": "palo-alto-downtown", "url": PA + "/RoadEdges/FeatureServer/0",
        "attribution": "City of Palo Alto Open GIS",
        "catalogue": "https://opengis.cityofpaloalto.org/OpenGisData/",
        "meaning": "Mixed pavement/lip/face/back-of-curb linework; preserve SOURCE/INPUTMETHOD.",
    },
    "san-jose-sidewalks": {
        "region": "san-jose-downtown", "url": SJ + "/185",
        "attribution": "City of San Jose",
        "catalogue": "https://data.sanjoseca.gov/",
        "meaning": "Sidewalk polygons; WIDTH attribute units unverified; not an accessibility survey.",
    },
    "san-jose-curbfaces": {
        "region": "san-jose-downtown", "url": SJ + "/498",
        "attribution": "City of San Jose",
        "catalogue": "https://data.sanjoseca.gov/",
        "meaning": "Colour/restriction curb inventory, NOT a complete surveyed curb envelope.",
    },
    "san-jose-survey-controls": {
        "region": "san-jose-downtown", "url": SJ + "/279",
        "attribution": "City of San Jose",
        "catalogue": "https://data.sanjoseca.gov/",
        "meaning": "Survey benchmark inventory; datum/height fields require individual validation.",
    },
    "san-jose-project-lines": {
        "region": "san-jose-downtown", "url": SJ + "/533",
        "attribution": "City of San Jose",
        "catalogue": "https://data.sanjoseca.gov/",
        "meaning": "Capital project references, NOT proof of constructed/as-built geometry.",
    },
}


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def coordinates(value):
    if value and isinstance(value[0], (int, float)):
        yield value
    else:
        for child in value:
            yield from coordinates(child)


def fetch_inventory(source: dict, bbox: list[float], fetch=get_json) -> dict:
    south, west, north, east = bbox
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
        raise ValueError("invalid WGS84 bounds")
    url = source["url"]
    if source.get("api") == "socrata":
        return fetch_socrata_inventory(source, bbox, fetch)
    metadata = fetch(url + "?f=json")
    oid = metadata.get("objectIdField") or next(
        (f["name"] for f in metadata.get("fields", []) if f["type"] == "esriFieldTypeOID"), None)
    if not oid or metadata.get("error"):
        raise ValueError("missing layer metadata/object ID")
    query = {"where": "1=1", "geometry": f"{west},{south},{east},{north}",
             "geometryType": "esriGeometryEnvelope", "inSR": 4326,
             "spatialRel": "esriSpatialRelIntersects", "f": "json", "returnIdsOnly": "true"}
    ids_doc = fetch(url + "/query?" + urlencode(query))
    if "objectIds" not in ids_doc or ids_doc.get("exceededTransferLimit"):
        raise ValueError("incomplete ID enumeration; not measured empty")
    ids = sorted(ids_doc["objectIds"] or [])
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate source IDs")
    features = []
    for first in range(0, len(ids), 100):
        batch = ids[first:first + 100]
        page = fetch(url + "/query?" + urlencode({
            "objectIds": ",".join(map(str, batch)), "outFields": "*", "outSR": 4326,
            "returnGeometry": "true", "f": "geojson"}))
        if page.get("exceededTransferLimit") or "features" not in page:
            raise ValueError("truncated municipal page")
        found = [(f.get("properties") or {}).get(oid, f.get("id")) for f in page["features"]]
        if len(found) != len(batch) or set(found) != set(batch):
            raise ValueError("missing, duplicate or changed municipal IDs; retry whole acquisition")
        for feature in page["features"]:
            geometry = feature.get("geometry") or {}
            if not geometry.get("coordinates"):
                raise ValueError("missing reference geometry")
            for p in coordinates(geometry["coordinates"]):
                if len(p) < 2 or not all(math.isfinite(v) for v in p[:2]) or not (
                    -180 <= p[0] <= 180 and -90 <= p[1] <= 90
                ):
                    raise ValueError("invalid output CRS/coordinate")
        features.extend(page["features"])
    # Fetch again to catch an edit made during pagination. Stable IDs alone are insufficient.
    after = fetch(url + "?f=json")
    if metadata.get("editingInfo") != after.get("editingInfo"):
        raise ValueError("layer changed during acquisition; retry")
    return {"schema_version": 1, "source": source, "bbox_s_w_n_e": bbox,
            "retrieved_at": datetime.now(UTC).isoformat(), "metadata": metadata,
            "metadata_sha256": digest(metadata), "features": features,
            "sha256": digest(features), "horizontal_crs": "EPSG:4326",
            "native_spatial_reference": metadata.get("extent", {}).get("spatialReference"),
            "vertical_datum": "not_verified", "geometry_accuracy_m": None,
            "basis": "municipal_reference_inventory", "publishable_as_measured": False,
            "redistribution": "not_promoted_pending_rights_and_geometry_review"}


def fetch_socrata_inventory(source: dict, bbox: list[float], fetch=get_json) -> dict:
    south, west, north, east = bbox
    url = source["url"]
    meta_url = "https://data.oaklandca.gov/api/views/87ce-u2wf.json"
    metadata = fetch(meta_url)
    polygon = f"POLYGON(({west} {south},{east} {south},{east} {north},{west} {north},{west} {south}))"
    where = f"intersects(the_geom, '{polygon}')"
    count = fetch(url + "?" + urlencode({"$select": "count(*) AS n", "$where": where}))
    expected = int(count[0]["n"])
    rows = []
    for offset in range(0, expected, 500):
        page = fetch(url + "?" + urlencode({"$where": where, "$order": ":id",
                                            "$offset": offset, "$limit": 500}))
        if not isinstance(page, list) or not page:
            raise ValueError("incomplete Socrata page")
        rows.extend(page)
    after = fetch(meta_url)
    if len(rows) != expected or metadata.get("rowsUpdatedAt") != after.get("rowsUpdatedAt"):
        raise ValueError("Socrata inventory truncated or changed")
    features = [{"type": "Feature", "geometry": row["the_geom"],
                 "properties": {k: v for k, v in row.items() if k != "the_geom"}}
                for row in rows]
    return {"schema_version": 1, "source": source, "bbox_s_w_n_e": bbox,
            "retrieved_at": datetime.now(UTC).isoformat(), "metadata": metadata,
            "metadata_sha256": digest(metadata), "features": features, "sha256": digest(features),
            "horizontal_crs": "EPSG:4326", "vertical_datum": "not_used",
            "geometry_accuracy_m": None, "basis": "historic_municipal_inventory",
            "publishable_as_measured": False,
            "redistribution": "not_promoted_pending_rights_and_geometry_review"}
