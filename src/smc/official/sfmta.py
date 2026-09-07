"""SFMTA's ArcGIS services -- the city's own curb lines and dimensional records.

DataSF publishes tidy extracts; SFMTA publishes the working GIS underneath them, and for street
geometry that is a different class of data. Its ``MTA.curbs`` layer holds nine thousand curb
polylines inside this corridor against the thousand-odd in DataSF's basemap extract, and its
``MTA.BSM_streetwidths`` table holds right-of-way widths to the inch with the filename of the
sheet each one was read off.

Two things about these services shape the code here. The layers answer in WGS84 already, so
nothing needs reprojecting. And the useful join keys are not the ones you would expect: CNN is
null on a large minority of rows in both the curb layer and the width table, so the code that
uses them has to fall back to block-face names and street/cross-street pairs rather than assume
a foreign key that is often missing.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from smc.official.schema import DocumentStatus, OfficialDocument

ROOT = "https://services.sfmta.com/arcgis/rest/services"
USER_AGENT = "spatial-mapping-crowdsource/official (+non-commercial research)"
#: The services advertise 10,000 and honour pagination; asking for more silently truncates.
PAGE = 10_000


@dataclass(frozen=True)
class Layer:
    """One ArcGIS layer or table, and what kind of claim it makes about the world."""

    key: str
    path: str
    name: str
    record_type: str
    status: DocumentStatus
    #: Tables have no geometry and cannot be filtered spatially; they come back whole.
    spatial: bool = True
    methodology: str = ""
    #: Server-side filter. Some layers are a whole city of records with one category worth
    #: having, and fetching the rest to throw it away is rude as well as slow.
    where: str = "1=1"


LAYERS: dict[str, Layer] = {
    "curbs": Layer(
        "curbs", "ROW/rightofway/MapServer/1", "MTA.curbs", "curb_line",
        DocumentStatus.RECORDED, True,
        "Curb polylines from the City's SFGIS basemap, keyed to block faces and, where "
        "populated, to CNN. This is mapped curb geometry rather than a width derived from a "
        "centreline, so it carries bulb-outs, curb returns and varying carriageway width.",
    ),
    "street_widths": Layer(
        "street_widths", "ROW/rightofway/MapServer/5", "MTA.BSM_streetwidths",
        "street_width_record", DocumentStatus.RECORDED, False,
        "Right-of-way and sidewalk widths in feet and inches per block, with an OFFICIAL flag "
        "and the FILENAME of the sheet the dimension was read from. Sidewalk width is left "
        "empty on a large fraction of rows; right-of-way width is well populated.",
    ),
    "traffic_lanes": Layer(
        "traffic_lanes", "Traffic/traffic/MapServer/3", "MTA.CTA_trafficlanes",
        "lane_count", DocumentStatus.HISTORIC, True,
        "AM, off-peak and PM lane counts. SFMTA states these came from SFCTA's SF-CHAMP travel "
        "model and were converted to the CNN network in 2010-11, with update frequency unknown "
        "-- so they are a historic seed to be checked against imagery, not present-day truth.",
    ),
    "oneway": Layer(
        "oneway", "Traffic/traffic/MapServer/5", "MTA.oneway_streets", "oneway",
        DocumentStatus.RECORDED, True,
        "One-way designations with the MTA Board motion that set them.",
    ),
    "curb_cuts": Layer(
        "curb_cuts", "Parking/digitalcurb/MapServer/1", "MTA.curb_zones (Curb Cuts)",
        "curb_cut", DocumentStatus.EXISTING_SURVEY, True,
        "Curb zones whose primary policy is Curb Cuts: the stretches of kerb dropped for a "
        "driveway or a garage entrance, with the length of each and its position along the "
        "block face.",
        where="CZ_PRIMARY_CURB_POLICY='Curb Cuts'",
    ),
    "crosswalks": Layer(
        "crosswalks", "Traffic/traffic/MapServer/19", "MTA.continentalcrosswalks",
        "crosswalk", DocumentStatus.EXISTING_SURVEY, True,
        "Continental crosswalk inventory with installation and last-repaint years.",
    ),
}

CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}


class HarvestError(RuntimeError):
    pass


def _get(url: str, *, attempts: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code < 500 and exc.code != 429:
                raise HarvestError(f"{url} -> HTTP {exc.code}") from exc
            last = exc
        except OSError as exc:
            last = exc
        time.sleep(2 ** attempt)
    raise HarvestError(f"{url} failed after {attempts} attempts: {last}")


def fetch(
    layer: Layer,
    *,
    bbox: dict | None = None,
    cache_dir: Path,
    refresh: bool = False,
    progress=lambda _m: None,
) -> tuple[list[dict], OfficialDocument]:
    """Every feature of ``layer``, as ``{"properties": ..., "geometry": ...}`` dicts.

    Spatial layers come back as GeoJSON in WGS84; tables come back as plain attribute rows with
    a geometry of ``None``. Results are cached by layer and query, so a rerun costs nothing and
    a build stays reproducible.
    """
    where = layer.where
    key_source = f"{layer.path}|{where}|{bbox if layer.spatial else None}"
    key = hashlib.blake2b(key_source.encode(), digest_size=8).hexdigest()
    cache_path = cache_dir / f"{layer.key}-{key}.json"
    base = f"{ROOT}/{layer.path}/query"

    if cache_path.exists() and not refresh:
        payload = json.loads(cache_path.read_bytes())
        progress(f"{layer.name}: {len(payload['rows'])} rows from cache")
        return payload["rows"], _document(layer, base, payload["sha256"],
                                          payload["retrieved_at"])

    rows: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": where,
            "outFields": "*",
            "returnGeometry": "true" if layer.spatial else "false",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
            "f": "geojson" if layer.spatial else "json",
        }
        if layer.spatial and bbox is not None:
            params.update({
                "geometry": f"{bbox['west']},{bbox['south']},{bbox['east']},{bbox['north']}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": 4326,
                "outSR": 4326,
                "spatialRel": "esriSpatialRelIntersects",
            })
        payload = json.loads(_get(f"{base}?{urllib.parse.urlencode(params)}"))
        if layer.spatial:
            page = [{"properties": f.get("properties") or {}, "geometry": f.get("geometry")}
                    for f in payload.get("features", [])]
        else:
            page = [{"properties": f.get("attributes") or {}, "geometry": None}
                    for f in payload.get("features", [])]
        rows.extend(page)
        progress(f"{layer.name}: {len(rows)} rows")
        if len(page) < PAGE:
            break
        offset += len(page)

    canonical = json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()
    sha256 = hashlib.sha256(canonical).hexdigest()
    retrieved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(
        {"layer": layer.path, "sha256": sha256, "retrieved_at": retrieved_at, "rows": rows},
        separators=(",", ":")))
    return rows, _document(layer, base, sha256, retrieved_at)


def _document(layer: Layer, url: str, sha256: str, retrieved_at: str) -> OfficialDocument:
    return OfficialDocument(
        document_id=f"sfmta:{layer.key}:{sha256[:12]}",
        record_type=layer.record_type,
        source_url=url,
        sha256=sha256,
        retrieved_at=retrieved_at,
        status=layer.status,
        crs="EPSG:4326",
        methodology=layer.methodology or None,
    )
