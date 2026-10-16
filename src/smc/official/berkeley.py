"""Berkeley's public transportation inventory, distinct from surveyed curb geometry.

The general GIS portal hides useful PublicWorks layers. Use that city's own REST
service, not empty Socrata tables or a guessed municipal-data adapter. Ramp points
are recorded locations, NOT measured slope/height or verified accessibility.
"""

from __future__ import annotations

import hashlib
import json
import math
import urllib.parse
import urllib.request
from datetime import UTC, datetime

SERVICE = "https://gis.cityofberkeley.info/arcgis/rest/services/PublicWorks/PubWorks/MapServer"
ATTRIBUTION = "City of Berkeley, Public Works GIS"
TERMS = "https://berkeleyca.gov/your-government/public-records/open-data-portal"
LAYERS = {
    "curb_ramps": (
        13,
        "OBJECTID,FACILITYID,RAMP_TYPE,RAMPTYPE,TRUNCATED_DOME,DETECTWARN,LASTUPDATE",
    ),
    "crosswalks": (14, "OBJECTID,COLOR,CONDITION,MARKING_TY,WIDTH,UNIQUEID"),
}


def get_json(url: str) -> dict:
    request = urllib.request.Request(
        url, headers={"User-Agent": "Kerbside municipal geometry audit"}
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.load(response)
    if "error" in data:
        raise RuntimeError(f"Berkeley inventory error: {data['error']}")
    return data


def fetch_layer(kind: str, bbox: list[float], fetch=get_json) -> dict:
    """Enumerate IDs, then fetch bounded batches. Fail closed on any missing row."""
    layer, fields = LAYERS[kind]
    south, west, north, east = bbox
    query = {
        "where": "1=1",
        "geometry": f"{west},{south},{east},{north}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "f": "json",
        "returnIdsOnly": "true",
    }
    url = f"{SERVICE}/{layer}/query"
    ids_doc = fetch(url + "?" + urllib.parse.urlencode(query))
    if "objectIds" not in ids_doc:
        raise ValueError("inventory ID enumeration missing; not an empty inventory")
    ids = sorted(set(ids_doc["objectIds"] or []))
    features = []
    for first in range(0, len(ids), 200):
        params = {
            "objectIds": ",".join(map(str, ids[first : first + 200])),
            "outFields": fields,
            "outSR": 4326,
            "returnGeometry": "true",
            "f": "geojson",
        }
        doc = fetch(url + "?" + urllib.parse.urlencode(params))
        if "features" not in doc or doc.get("exceededTransferLimit"):
            raise ValueError("incomplete municipal inventory page")
        features.extend(doc["features"])
    found = [(f.get("properties") or {}).get("OBJECTID", f.get("id")) for f in features]
    if len(found) != len(ids) or set(found) != set(ids):
        raise ValueError("municipal inventory IDs changed or response was truncated; retry")
    raw = json.dumps(features, sort_keys=True, separators=(",", ":")).encode()
    return {
        "kind": kind,
        "features": features,
        "source": f"{SERVICE}/{layer}",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "bbox_s_w_n_e": bbox,
        "retrieved_at": datetime.now(UTC).isoformat(),
        "attribution": ATTRIBUTION,
        "rights_url": TERMS,
        "basis": "recorded_municipal_inventory",
        "vertical_datum": "not_used",
        "horizontal_crs": "EPSG:4326",
        "unknown_units": ["WIDTH"],
        "geometry_accuracy_m": None,
    }


def normalize_ramps(inventory: dict) -> list[dict]:
    out = []
    south, west, north, east = inventory["bbox_s_w_n_e"]
    for feature in inventory["features"]:
        geometry = feature.get("geometry") or {}
        point = geometry.get("coordinates") or []
        if geometry.get("type") != "Point" or len(point) < 2:
            raise ValueError("curb ramp is not a point")
        lon, lat = point[:2]
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (lon, lat)):
            raise ValueError("nonfinite ramp coordinate")
        if not (west - 0.01 <= lon <= east + 0.01 and south - 0.01 <= lat <= north + 0.01):
            raise ValueError("ramp outside query bounds; CRS mismatch")
        properties = feature.get("properties") or {}
        # ArcGIS transforms the query envelope to the layer's UTM frame; the
        # resulting rectangle can include points just beyond the original box.
        if not (west <= lon <= east and south <= lat <= north):
            continue
        # This is an inventory of both missing and existing ramp locations. A
        # recorded NONE is not permission to render an accessible curb cut.
        ramp_type = properties.get("RAMPTYPE") or properties.get("RAMP_TYPE")
        if str(ramp_type).strip().lower() not in ("apex", "perpendicular", "mid"):
            continue
        oid = properties.get("OBJECTID", feature.get("id"))
        updated = properties.get("LASTUPDATE")
        observed_at = (
            datetime.fromtimestamp(updated / 1000, UTC).isoformat() if updated is not None else None
        )
        warning = properties.get("TRUNCATED_DOME")
        out.append(
            {
                "p": [lon, lat],
                "f": ["no_detectable_surface"] if str(warning).upper() == "NO" else [],
                "c": None,
                "id": f"berkeley:curb_ramp:{oid}",
                "basis": "recorded",
                "source_id": f"berkeley:curb_ramps:{inventory['sha256']}",
                "confidence": 0.8,
                "corroboration_count": 1,
                "observed_at": observed_at,
                "accessibility_verified": False,
                "ramp_type": str(ramp_type).lower(),
                "position_basis": "physical_point",
            }
        )
    return out


def merge_sidecar(previous: dict, inventory: dict) -> dict:
    """Replace only this adapter's prior records; preserve all unrelated geometry."""
    old = [
        r
        for r in previous.get("curb_ramps", [])
        if not str(r.get("id", "")).startswith("berkeley:curb_ramp:")
    ]
    generated = [
        s for s in previous.get("generated_from", []) if not s.startswith("berkeley:curb_ramps:")
    ]
    generated.append(f"berkeley:curb_ramps:{inventory['sha256']}")
    sources = {
        k: v
        for k, v in previous.get("source_documents", {}).items()
        if not k.startswith("berkeley:curb_ramps:")
    }
    sources[generated[-1]] = {
        "url": inventory["source"],
        "sha256": inventory["sha256"],
        "retrieved_at": inventory["retrieved_at"],
        "attribution": ATTRIBUTION,
        "rights_url": TERMS,
        "horizontal_crs": "EPSG:4326",
        "vertical_datum": "not_used",
        "geometry_accuracy_m": None,
    }
    return {
        **previous,
        "generated_from": generated,
        "source_documents": sources,
        "curb_ramps": old + normalize_ramps(inventory),
        "curb_lines": previous.get("curb_lines", []),
    }
