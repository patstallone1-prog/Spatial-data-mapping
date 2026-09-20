"""What the sources can say about a region, found by asking them.

Every region is built from the same ladder of sources, and the ladder drops rungs where a
source has nothing: San Francisco has kerb lines, curb ramps, parking policies and signs as
municipal records; Oakland has none of those in this project yet, and a region there is built
from OpenStreetMap, Overture, the lidar and the imagery -- to a lower confidence, said so in
the capability vector rather than silently. Nothing here assumes; each probe is a cheap
request against the source with the region's box, and the answer is written down with the
time it was asked.

The probes:

* OpenStreetMap -- how many highway ways and buildings Overpass counts in the box;
* USGS 3DEP -- which Entwine point-cloud collections cover the box (from the public index of
  every collection's boundary) and how much of the box each covers;
* imagery -- how many Mapillary images the Graph API reports for the box (capped: the point
  is coverage, not a census; the harvest does the census), and whether Panoramax has any;
* municipal records -- which of the project's official-record adapters apply, by the city the
  box lies in; San Francisco is the only city with adapters today;
* Overture -- reference buildings and places, everywhere, ODbL, reference only.
"""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from smc.imagery.region import BBox, Region

ENTWINE_INDEX = "https://usgs.entwine.io/boundaries/resources.geojson"
OVERPASS = "https://overpass-api.de/api/interpreter"
MAPILLARY_GRAPH = "https://graph.mapillary.com/images"
PANORAMAX_SEARCH = "https://api.panoramax.xyz/api/search"
USER_AGENT = "Kerbside/0.1 region discovery"

#: Cities with municipal-record adapters in this project, by the box that contains them.
#: The adapters are the ones scripts/build_sf_official_geometry.py runs; a region in the box
#: gets them all. Anything outside gets none, and the ladder says so.
MUNICIPAL: dict[str, dict[str, Any]] = {
    "san-francisco": {
        "bbox": BBox(south=37.700, west=-122.530, north=37.835, east=-122.350),
        "records": ["curb_lines", "curb_ramps", "sidewalk_widths", "right_of_way", "parking_policies",
                    "color_curb", "signs", "crosswalks", "parcels", "centrelines", "street_trees"],
        "source": "DataSF / SFMTA open data",
    },
}
#: How many Mapillary images the probe asks for at most. Coverage, not a census.
IMAGERY_PROBE_CAP = 500


@dataclass
class Capabilities:
    region: str
    bbox: list[float]
    probed_at: str
    osm: dict[str, Any] = field(default_factory=dict)
    lidar: dict[str, Any] = field(default_factory=dict)
    imagery: dict[str, Any] = field(default_factory=dict)
    municipal: dict[str, Any] = field(default_factory=dict)
    overture: dict[str, Any] = field(default_factory=lambda: {"buildings": True, "places": True,
                                                             "licence": "ODbL, reference only"})
    vector: dict[str, str] = field(default_factory=dict)
    errors: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> dict:
        return asdict(self)


def _get(url: str, *, timeout: float = 60.0, headers: dict | None = None) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


# -- OpenStreetMap ---------------------------------------------------------------------------

def overpass_counts(bbox: BBox, fetch=_get) -> dict[str, int]:
    box = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
    query = (f'[out:json][timeout:60];(way["highway"]({box}););out count;'
             f'(way["building"]({box});relation["building"]({box}););out count;')
    data = json.loads(fetch(OVERPASS + "?" + urllib.parse.urlencode({"data": query})))
    counts = [e.get("tags", {}) for e in data.get("elements", []) if e.get("type") == "count"]
    ways = int(counts[0].get("ways", 0)) if counts else 0
    buildings = int(counts[1].get("total", 0)) if len(counts) > 1 else 0
    return {"highway_ways": ways, "buildings": buildings}


# -- USGS 3DEP lidar -------------------------------------------------------------------------

def _ring_bbox(coords) -> tuple[float, float, float, float]:
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    return min(lats), min(lons), max(lats), max(lons)


def _overlap(a: tuple[float, float, float, float], b: BBox) -> float:
    """Share of ``b`` covered by box ``a``."""
    south = max(a[0], b.south)
    west = max(a[1], b.west)
    north = min(a[2], b.north)
    east = min(a[3], b.east)
    if north <= south or east <= west:
        return 0.0
    return ((north - south) * (east - west)) / max(1e-12, (b.north - b.south) * (b.east - b.west))


def lidar_collections(bbox: BBox, index: dict | None = None, fetch=_get,
                      cache: Path | None = None) -> list[dict[str, Any]]:
    """Entwine collections whose footprint overlaps the box, most recent first.

    The public index is one GeoJSON of every collection's boundary (tens of MB); it is cached
    on disk so a second region on the same day costs nothing. Overlap is by bounding box of
    the boundary -- a collection's outline is a ragged polygon, and a box that lies inside its
    bounding box but outside the outline will show up here; the terrain build finds out.
    """
    if index is None:
        if cache and cache.exists() and time.time() - cache.stat().st_mtime < 7 * 86400:
            index = json.loads(cache.read_text())
        else:
            raw = fetch(ENTWINE_INDEX, timeout=300)
            index = json.loads(raw)
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_bytes(raw)
    found = []
    for feature in index.get("features", []):
        name = (feature.get("properties") or {}).get("name") or (feature.get("id") or "")
        geometry = feature.get("geometry") or {}
        rings = []
        if geometry.get("type") == "Polygon":
            rings = [geometry["coordinates"][0]]
        elif geometry.get("type") == "MultiPolygon":
            rings = [poly[0] for poly in geometry["coordinates"]]
        best = 0.0
        for ring in rings:
            best = max(best, _overlap(_ring_bbox(ring), bbox))
        if best > 0:
            props = feature.get("properties") or {}
            found.append({"dataset": name, "coverage": round(best, 3),
                          "points": props.get("count") or props.get("points"),
                          "url": props.get("url") or f"https://s3-us-west-2.amazonaws.com/usgs-lidar-public/{name}/ept.json"})
    # Best coverage first, and among equals the newest: the names end in the year
    # (CA_SanFrancisco_1_B23 is 2023).
    found.sort(key=lambda r: (-r["coverage"], -_year_of(r["dataset"])))
    return found


def _year_of(dataset: str) -> int:
    digits = "".join(ch for ch in dataset[-4:] if ch.isdigit())
    if not digits:
        return 0
    year = int(digits)
    return year + 2000 if year < 100 else year


# -- imagery ---------------------------------------------------------------------------------

def mapillary_count(bbox: BBox, token: str | None = None, fetch=_get) -> dict[str, Any]:
    token = token or os.environ.get("MAPILLARY_TOKEN") or ""
    if not token:
        return {"available": None, "reason": "MAPILLARY_TOKEN not set"}
    # The middle of the box, a few hundred metres across: the Graph API answers a box of a
    # whole district with an error, and coverage at the centre says what a harvest will find.
    lat, lon = bbox.centre
    half_lat = min(0.003, (bbox.north - bbox.south) / 2)
    half_lon = min(0.004, (bbox.east - bbox.west) / 2)
    box = f"{lon - half_lon},{lat - half_lat},{lon + half_lon},{lat + half_lat}"
    # A dense box answered at the full cap comes back as a server error; ask for less.
    last: Exception | None = None
    for limit in (IMAGERY_PROBE_CAP, 100, 25):
        query = urllib.parse.urlencode({"bbox": box, "fields": "id", "limit": limit})
        try:
            data = json.loads(fetch(f"{MAPILLARY_GRAPH}?{query}", headers={"Authorization": f"OAuth {token}"}))
        except Exception as exc:
            last = exc
            continue
        n = len(data.get("data", []))
        return {"available": n > 0, "images_seen": n, "capped": n >= limit}
    raise RuntimeError(f"Mapillary probe failed at every size: {last}")


def panoramax_count(bbox: BBox, fetch=_get) -> dict[str, Any]:
    query = urllib.parse.urlencode({"bbox": f"{bbox.west},{bbox.south},{bbox.east},{bbox.north}", "limit": 100})
    data = json.loads(fetch(f"{PANORAMAX_SEARCH}?{query}"))
    n = len(data.get("features", []))
    return {"available": n > 0, "images_seen": n, "capped": n >= 100}


# -- municipal -------------------------------------------------------------------------------

def municipal_records(bbox: BBox) -> dict[str, Any]:
    for city, entry in MUNICIPAL.items():
        if _overlap((entry["bbox"].south, entry["bbox"].west, entry["bbox"].north, entry["bbox"].east), bbox) > 0.5:
            return {"city": city, "records": list(entry["records"]), "source": entry["source"]}
    return {"city": None, "records": [], "source": None}


# -- the vector ------------------------------------------------------------------------------

def capability_vector(osm: dict, lidar: list[dict], imagery: dict, municipal: dict) -> dict[str, str]:
    """One word per property for where its facts will come from, top rung first."""
    records = set(municipal.get("records", []))
    has_lidar = any(c.get("coverage", 0) >= 0.5 for c in lidar)
    has_imagery = bool((imagery.get("mapillary") or {}).get("available") or (imagery.get("panoramax") or {}).get("available"))
    return {
        "kerbs": "official" if "curb_lines" in records else "lidar" if has_lidar else "none",
        "sidewalk_width": "official" if "sidewalk_widths" in records else "lidar" if has_lidar else "osm",
        "kerb_height": "lidar" if has_lidar else "imagery" if has_imagery else "none",
        "terrain": "lidar" if has_lidar else "none",
        "buildings": "osm+overture" if osm.get("buildings") else "overture",
        "building_height": "lidar" if has_lidar else "osm",
        "building_colour": "imagery" if has_imagery else "none",
        "parking": "official" if "parking_policies" in records else "imagery" if has_imagery else "none",
        "curb_ramps": "official" if "curb_ramps" in records else "osm",
        "signs": "official" if "signs" in records else "osm",
        "crossings": "official" if "crosswalks" in records else "osm",
        "lanes": "osm+priors",
        "streets": "osm" if osm.get("highway_ways") else "none",
    }


def discover(region: Region, *, cache_dir: Path | None = None, fetch=_get) -> Capabilities:
    caps = Capabilities(region=region.name,
                        bbox=[region.bbox.south, region.bbox.west, region.bbox.north, region.bbox.east],
                        probed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    try:
        caps.osm = overpass_counts(region.bbox, fetch)
    except Exception as exc:  # a probe that fails is recorded, not fatal
        caps.errors["osm"] = str(exc)
    try:
        caps.lidar = {"collections": lidar_collections(
            region.bbox, fetch=fetch, cache=(cache_dir / "entwine-index.geojson") if cache_dir else None)}
    except Exception as exc:
        caps.errors["lidar"] = str(exc)
        caps.lidar = {"collections": []}
    imagery: dict[str, Any] = {}
    for name, probe in (("mapillary", mapillary_count), ("panoramax", panoramax_count)):
        try:
            imagery[name] = probe(region.bbox, fetch=fetch)
        except Exception as exc:
            caps.errors[name] = str(exc)
    caps.imagery = imagery
    caps.municipal = municipal_records(region.bbox)
    caps.vector = capability_vector(caps.osm, caps.lidar["collections"], caps.imagery, caps.municipal)
    return caps
