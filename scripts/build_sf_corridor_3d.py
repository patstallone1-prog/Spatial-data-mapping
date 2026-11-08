#!/usr/bin/env python3
"""Build an interactive 3D SF corridor map from the metadata catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import h3
import pyarrow.parquet as pq

from smc.buildings.enrichment import (
    ADDRESS_KEYS,
    BUSINESS_KEYS,
    building_id,
    merge_building_enrichment,
    normalize_osm_building,
)
from smc.facades.colour import believable
from smc.facts.build_cross_sections import prior_width_m
from smc.imagery.region import SF_CORRIDOR, BBox, Region, get_region
from smc.parks.surfaces import osm_surface, resolve_surface
from smc.renderer.template import page_template
from smc.renderer.tuning import DETAIL_TUNING, release_module_scope, tuned  # noqa: F401  (re-exported)

#: How far over a street's own class prior a recorded right of way may reach before it is
#: read as another street's record. A right of way is the whole legal strip -- setbacks,
#: stairs, the slope easement on a hillside -- so it is always the larger number; at nearly
#: twice the prior it has stopped describing this carriageway.
ROW_PRIOR_MAX_FACTOR = 1.8

#: Coordinates are published to seven decimals: about a centimetre at this latitude. Six was
#: a decimetre -- the model measures the kerbs to five centimetres and then rounded them to
#: eleven on the way to the page.
PRECISION = 7
BUILDING_ENRICHMENT = ROOT / "data" / "sf_building_enrichment" / "buildings.json"


def overpass_query(bbox: BBox) -> str:
    area = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
    return (
        "[out:json][timeout:60];("
        # Every class of road, not a subset. Leaving out motorway, trunk, unclassified and the
        # link roads meant the Embarcadero, the bridge approaches and every slip road were
        # never fetched at all -- so nothing was drawn there and those blocks came out black.
        f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|'
        f'service|living_street|road|busway|motorway_link|trunk_link|primary_link|'
        # And the cycle tracks mapped as ways of their own. A road tagged cycleway=separate has
        # its track drawn as a separate highway=cycleway way, and 2nd Street's protected lanes
        # are that for half their length: not fetched, the green stopped at every such block.
        f'secondary_link|tertiary_link|footway|pedestrian|steps|path|cycleway)$"]({area});'
        f'way["footway"~"^(sidewalk|crossing)$"]({area});'
        # These nodes locate real kerb transitions outside San Francisco's municipal
        # ramp inventory.  A crossing way alone cannot tell us where its lip is.
        f'node["kerb"]({area});'
        f'node["barrier"="kerb"]({area});'
        # A divider is concrete only when OSM maps a physical island or a raised kerb
        # footprint.  Lane/separation tags such as ``solid_line`` deliberately do not enter
        # this query: those remain road paint in the renderer.
        f'way["traffic_calming"="island"]({area});'
        f'way["barrier"="kerb"]["kerb"="raised"]({area});'
        # Walls that are walls: the Presidio's stone and brick retaining walls, garden walls on
        # Russian Hill. Fences are drawn from the city's property lines and are not this.
        f'way["barrier"~"^(wall|retaining_wall|city_wall)$"]({area});'
        # Surface car parks, as areas. Fetched as amenities already, but an amenity without a
        # building tag was being reduced to a point, and a car park is a piece of ground.
        f'way["amenity"="parking"]["parking"!="multi-storey"]["parking"!="underground"]({area});'
        f'way["building"]({area});'
        # Water. Nothing else in the query covers the bay, the lagoon or Aquatic Park, so the
        # whole northern edge of the corridor was drawn as ground and read as a hole.
        f'way["natural"="water"]({area});'
        f'way["waterway"="riverbank"]({area});'
        f'relation["natural"="water"]({area});'
        f'way["natural"="beach"]({area});'
        f'relation["natural"="beach"]({area});'
        # The piers. The coastline goes round them, so the waterline leaves them land; without
        # their decks that land is the grid's grey fill with the pier's footways drawn white
        # across it, which from above is a black car park with lines on it.
        f'way["man_made"="pier"]({area});'
        # The bay is not tagged as water. OpenStreetMap maps an ocean edge as a coastline way
        # with land on its right and water on its left, and that convention is the only thing
        # that says which side is wet.
        f'way["natural"="coastline"]({area});'
        # What things are. A building's own tags say more than its footprint does, and in a
        # city this densely mapped most of the answer is already here: amenity for restaurants
        # and fuel stations, shop for retail, tourism for hotels. The points matter as much as
        # the ways -- a restaurant is usually a node inside a building rather than the building.
        f'node["amenity"]({area});'
        f'node["shop"]({area});'
        f'node["tourism"]({area});'
        f'way["amenity"]({area});'
        f'way["shop"]({area});'
        f'way["tourism"]({area});'
        # The street's own furniture, which the amenity sweep above does not reach. A bus stop
        # is a highway tag, not an amenity, and it was never fetched in any region: benches
        # arrived by accident because a bench happens to be an amenity, and the stop that the
        # bench is usually next to did not.
        f'node["highway"="bus_stop"]({area});'
        f'node["public_transport"~"^(platform|stop_position)$"]({area});'
        f'way["public_transport"="platform"]({area});'
        f'node["highway"="street_lamp"]({area});'
        # Signs the city has put on a pole, as opposed to paint on the road.
        f'node["traffic_sign"]({area});'
        f'node["highway"~"^(traffic_signals|stop|give_way)$"]({area});'
        ");out geom;"
    )


def _sidewalk_sides(tags: dict) -> list[int] | None:
    """Which sides of a street OpenStreetMap says carry a footway.

    ``+1`` is left of the direction of travel and ``-1`` is right, matching the convention the
    rest of the codebase uses. Returns None when the tags say nothing, so the geometric guess
    still applies there rather than a silent "no footways".
    """
    both = tags.get("sidewalk:both")
    left = tags.get("sidewalk:left")
    right = tags.get("sidewalk:right")
    plain = tags.get("sidewalk")

    if both in ("yes", "separate"):
        return [1, -1]
    if both == "no":
        return []
    sides: list[int] = []
    stated = False
    if left is not None:
        stated = True
        if left not in ("no", "none"):
            sides.append(1)
    if right is not None:
        stated = True
        if right not in ("no", "none"):
            sides.append(-1)
    if stated:
        return sides
    if plain in ("both", "yes"):
        return [1, -1]
    if plain == "left":
        return [1]
    if plain == "right":
        return [-1]
    if plain in ("no", "none"):
        return []
    return None


#: How far out to sea the water is drawn.
#:
#: Nine kilometres was too far. A band that long runs from the shoreline clear across the city,
#: and although it sits below the roadway and the pavement it sits *above* the land plane -- so
#: it showed through every gap between them, as blue patches on the kerb ramps and in the middle
#: of the street. It passed the building test because eighteen square kilometres makes even a
#: few hundred buildings look sparse.
#:
#: Two kilometres reaches past the far edge of the corridor from any shoreline in it, which is
#: all it has to do: the bay disc laid beyond the bounding box carries the water from there to
#: the horizon.
#:
#: It was 600 m, then 1,400, on the reasoning that a band is safer than an attempt at the whole
#: bay. It was safer because the side it was drawn on was a guess: a band on the wrong side of
#: the line puts that much water over the city, which is what six of the fourteen water polygons
#: were doing. Now that the side is checked against the buildings and a band with a
#: neighbourhood in it is refused, a wrong one cannot ship, and the band can be as long as it
#: needs to be.
COASTAL_BAND_M = 2000.0

#: Lengths to try, longest first. A band that covers buildings at nine kilometres may be clean at
#: five hundred metres, and five hundred metres of water at the water's edge is worth far more
#: than nothing at all.
COASTAL_REACHES = (2000.0, 1200.0, 700.0, 300.0, 120.0)


def _coastline_water(points: list[list[float]], *, port: bool = True,
                     reach: float | None = None) -> list[list[float]] | None:
    """A strip of water on the seaward side of a coastline way.

    OpenStreetMap's convention is that a coastline runs with the land on its right and the
    water on its left, so the wet side is decided by the way's own direction rather than by
    guessing which way is out. The polygon is the coastline itself plus the same line pushed
    six hundred metres to port, closed at both ends.
    """
    if len(points) < 2:
        return None
    scale_lon = 88_000.0
    scale_lat = 111_320.0
    offset: list[list[float]] = []
    for i, (lon, lat) in enumerate(points):
        nxt = points[min(i + 1, len(points) - 1)]
        prv = points[max(i - 1, 0)]
        dx = (nxt[0] - prv[0]) * scale_lon
        dy = (nxt[1] - prv[1]) * scale_lat
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        # Left of travel is (-dy, dx). The convention says the water is to port, and the
        # convention is what is checked against the buildings by the caller.
        side = 1.0 if port else -1.0
        out = COASTAL_BAND_M if reach is None else reach
        offset.append([lon + side * (-dy / length) * out / scale_lon,
                       lat + side * (dx / length) * out / scale_lat])
    if len(offset) < 2:
        return None
    return points + offset[::-1]


def _ring_contains(ring: list[list[float]], lon: float, lat: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _ring_area_km2(ring: list[list[float]]) -> float:
    if len(ring) < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    scale_lat = 111_320.0
    scale_lon = scale_lat * math.cos(math.radians(lat0))
    twice = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i][0] * scale_lon, ring[i][1] * scale_lat
        x2, y2 = (ring[(i + 1) % len(ring)][0] * scale_lon,
                  ring[(i + 1) % len(ring)][1] * scale_lat)
        twice += x1 * y2 - x2 * y1
    return abs(twice) / 2 / 1e6


#: Buildings per square kilometre above which a polygon claiming to be water is not water.
#:
#: A count alone is the wrong test and it rejected Aquatic Park: that is a cove with a maritime
#: museum and two boathouses on its shore, so it contains more than a handful of buildings and
#: was refused, leaving a wedge of bare ground where the water should be. What separates a cove
#: from a band drawn over the city is not how many buildings are inside it but how densely --
#: this corridor runs to about two thousand per square kilometre, and a bay runs to a few.
MAX_BUILDINGS_PER_KM2 = 120.0


def dry_land_in(ring: list[list[float]], landmarks: list[tuple[float, float]]) -> int:
    """How many buildings stand inside a polygon that claims to be water."""
    return sum(1 for lon, lat in landmarks if _ring_contains(ring, lon, lat))


#: However sparse it works out, this many buildings inside a body of water is not a shoreline.
#: Density alone is not enough once the bands run nine kilometres out to meet the bay: such a
#: band covers eighteen square kilometres, so a few hundred buildings in it still reads as
#: twenty per square kilometre and passes. Both tests, and a polygon has to satisfy neither.
MAX_BUILDINGS_INSIDE = 40


def covers_the_city(ring: list[list[float]], landmarks: list[tuple[float, float]]) -> bool:
    """Whether a polygon claiming to be water has a neighbourhood inside it."""
    inside = dry_land_in(ring, landmarks)
    if inside <= 4:
        # A few buildings on a shoreline is a shoreline, whatever the polygon's size.
        return False
    if inside > MAX_BUILDINGS_INSIDE:
        return True
    area = _ring_area_km2(ring)
    if area <= 0:
        return True
    return inside / area > MAX_BUILDINGS_PER_KM2


def _relation_rings(element: dict, bbox: BBox) -> list[list[list[float]]]:
    """Closed outer rings of a multipolygon relation, clipped to what is worth keeping.

    Outer members arrive as separate ways that have to be strung end to end, and for something
    the size of San Francisco Bay the result runs to tens of thousands of points most of which
    are nowhere near this corridor. Rings entirely outside the region are dropped and the rest
    are thinned, because a coastline drawn to the metre costs megabytes and looks identical.
    """
    chains: list[list[list[float]]] = []
    for member in element.get("members") or []:
        if member.get("role") not in (None, "", "outer"):
            continue
        points = [[round(p["lon"], PRECISION), round(p["lat"], PRECISION)]
                  for p in (member.get("geometry") or []) if "lat" in p and "lon" in p]
        if len(points) >= 2:
            chains.append(points)
    if not chains:
        return []

    rings: list[list[list[float]]] = []
    pending = chains[:]
    current = pending.pop(0)
    while pending:
        joined = False
        for i, chain in enumerate(pending):
            if current[-1] == chain[0]:
                current = current + chain[1:]; pending.pop(i); joined = True; break
            if current[-1] == chain[-1]:
                current = current + chain[::-1][1:]; pending.pop(i); joined = True; break
        if not joined or current[0] == current[-1]:
            rings.append(current)
            current = pending.pop(0) if pending else []
            if not current:
                break
    if current:
        rings.append(current)

    out = []
    for ring in rings:
        if len(ring) < 4:
            continue
        inside = [p for p in ring
                  if bbox.west - 0.02 <= p[0] <= bbox.east + 0.02
                  and bbox.south - 0.02 <= p[1] <= bbox.north + 0.02]
        if len(inside) < 3:
            continue
        step = max(1, len(ring) // 4000)
        out.append(ring[::step])
    return out


def _int_text(value: object) -> int | None:
    try:
        found = int(str(value).strip().split(";")[0])
    except (TypeError, ValueError):
        return None
    return found if 1 <= found <= 12 else None


def _float_text(value: object) -> float | None:
    if value is None:
        return None
    text = str(value).strip().lower().replace(",", ".")
    if not text:
        return None
    if text.endswith("ft"):
        try:
            return float(text[:-2].strip()) * 0.3048
        except ValueError:
            return None
    if text.endswith("m"):
        text = text[:-1].strip()
    try:
        return float(text)
    except ValueError:
        return None


def _building_height(tags: dict[str, Any]) -> tuple[float, str]:
    # No upper bound on either. Both used to have one (300 m, 90 storeys), and a tag above it
    # was not clamped but *discarded* -- the building fell through to the 10.5 m default.
    height = _float_text(tags.get("height"))
    if height is not None and height >= 2.0:
        return height, "osm_height"
    levels = _float_text(tags.get("building:levels"))
    if levels is not None and levels >= 1.0:
        return max(3.2, levels * 3.2), "osm_levels"
    return 10.5, "inferred_default"


def _is_closed(points: list[list[float]]) -> bool:
    return len(points) >= 4 and points[0] == points[-1]


def physical_divider_feature(
    tags: dict[str, Any], points: list[list[float]], osm_id: object | None = None,
) -> dict[str, Any] | None:
    """Return one explicitly mapped raised road divider, never a painted separator.

    OSM represents the actual footprint of traffic islands as a closed way.  A generic
    ``barrier=kerb`` can equally be the outside edge of a pavement, so it is not enough;
    the way must either say it is a traffic-calming island or explicitly say that the kerb
    is raised.  Open kerb lines do not enclose concrete and therefore cannot safely become
    a filled block.
    """
    if not _is_closed(points):
        return None
    is_island = tags.get("traffic_calming") == "island"
    is_raised_kerb = tags.get("barrier") == "kerb" and tags.get("kerb") == "raised"
    if not (is_island or is_raised_kerb):
        return None
    material = str(tags.get("material") or tags.get("surface") or "concrete").lower()
    if material in {"paint", "painted", "wood", "metal", "plastic", "rubber"}:
        return None
    feature: dict[str, Any] = {
        "kind": "divider",
        "name": tags.get("name"),
        "points": points,
        "divider_source": "traffic_calming_island" if is_island else "raised_kerb",
        "divider_surface": material,
    }
    if osm_id is not None:
        feature["osm_id"] = osm_id
    return feature


def _centroid(points: list[list[float]]) -> list[float]:
    ring = points[:-1] if _is_closed(points) else points
    lon = sum(point[0] for point in ring) / len(ring)
    lat = sum(point[1] for point in ring) / len(ring)
    return [round(lon, PRECISION), round(lat, PRECISION)]


#: Overpass answers a corridor-sized query in about a minute and refuses it outright when it
#: is busy. A 504 from it is a queue, not a fault, and giving up on the first one meant a build
#: quietly fell back to whatever was in the cache -- so a change to how ways are classified
#: appeared to do nothing at all.
OVERPASS_MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
)


#: The corridor's query returns some 20,000 elements; a tenth of that is a broken answer.
OSM_MIN_ELEMENTS = 2_000

#: The region being built. The corridor by default; any region from data/regions/regions.json
#: with --region, in which case every path below moves under data/regions/<name>/ and the
#: page and its sidecars are written beside --out. A region outside San Francisco has no
#: municipal records: its official directory is empty and every consumer here already copes
#: with a missing file by dropping that rung of the ladder.
REGION: Region = SF_CORRIDOR
SITE_DIR = ROOT / "docs"


def project_path(path: Path) -> str:
    """Where a file sits, as the project names it: a region's site may be a link onto another
    drive (data/regions/<cell> on the HP P700), which resolves outside the checkout."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        pass
    try:
        return str(Path("data") / "regions" / REGION.name / "site" / path.relative_to(SITE_DIR))
    except ValueError:
        return path.name


def configure_region(region: Region, out: Path, official_dir: Path | None = None) -> None:
    """Point the build at a region: its box, its official records and where its site goes."""
    global REGION, SITE_DIR, OFFICIAL, TUNNEL_PORTALS, GROUND_COVER, GROUND_VIEWER, FURNITURE_VIEWER, FACADE_ROOT
    REGION = region
    SITE_DIR = out.resolve().parent
    if official_dir is None:
        official_dir = (ROOT / "data" / "sf_public_works" if region.name == SF_CORRIDOR.name
                        else ROOT / "data" / "regions" / region.name / "official")
    OFFICIAL = official_dir
    TUNNEL_PORTALS = official_dir / "tunnel_portals.json"
    GROUND_COVER = official_dir / "ground_cover.json"
    GROUND_VIEWER = SITE_DIR / "sf-corridor-ground.json"
    FURNITURE_VIEWER = SITE_DIR / "sf-corridor-furniture.json"
    FACADE_ROOT = SITE_DIR / "facades"


def load_building_colours(path: Path) -> dict[str, dict]:
    """The sampled colours keyed by osm_id; an old index-keyed file is refused, not misread."""
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if data.get("keyed_by") != "osm_id":
        raise SystemExit(f"{path} is keyed by building index, which no longer matches the map; "
                         "re-key it by osm_id (see scripts/build_building_colours.py)")
    # A sample the sampler would refuse today is refused here too: a black wall is the
    # panorama's band, not the building, and the building keeps its archetype's colour.
    return {key: sample for key, sample in data.get("buildings", {}).items() if believable(sample.get("c"))}


def normalize_osm_kerb_node(element: dict[str, Any]) -> dict[str, Any] | None:
    """Preserve mapped kerb transitions without treating every crossing node as a ramp.

    OSM's ``kerb=raised`` is positive evidence *against* a flush crossing.  An
    unspecified ``barrier=kerb`` is not enough to infer a ramp either.
    """
    if element.get("type") != "node" or "lon" not in element or "lat" not in element:
        return None
    tags = element.get("tags") or {}
    value = str(tags.get("kerb") or "").lower()
    if value not in {"lowered", "flush", "raised", "rolled"}:
        return None
    return {
        "kind": "curb_ramp",
        "point": [round(float(element["lon"]), PRECISION),
                  round(float(element["lat"]), PRECISION)],
        "kerb_type": value,
        "accessible_lip": value in {"lowered", "flush"},
        "tactile_paving": tags.get("tactile_paving"),
        "source": "osm_kerb_node",
        "osm_id": element.get("id"),
    }


def fetch_osm_kerb_nodes(bbox: BBox) -> list[dict[str, Any]]:
    """Fetch typed kerb nodes without changing the street-way cache measured by lidar."""
    query = ("[out:json][timeout:120];"
             f'node["kerb"~"^(lowered|flush|raised|rolled)$"]'
             f"({bbox.south},{bbox.west},{bbox.north},{bbox.east});out body;")
    last: Exception | None = None
    for mirror in OVERPASS_MIRRORS:
        try:
            request = urllib.request.Request(
                mirror + "?" + urllib.parse.urlencode({"data": query}),
                headers={"User-Agent": "Kerbside/0.1 curb-ramp supplement"})
            with urllib.request.urlopen(request, timeout=180) as response:
                data = json.loads(response.read().decode("utf-8"))
            if data.get("remark") and "error" in str(data["remark"]).lower():
                raise RuntimeError(str(data["remark"]))
            return [ramp for element in data.get("elements", [])
                    if (ramp := normalize_osm_kerb_node(element)) is not None]
        except Exception as exc:  # noqa: BLE001 - independent public mirrors
            last = exc
            print(f" kerb-node mirror {mirror.split('/')[2]}: {exc}", file=sys.stderr)
    raise RuntimeError(f"all Overpass mirrors refused kerb nodes: {last}")


def fetch_osm(bbox: BBox, *, attempts: int = 3, minimum_elements: int = OSM_MIN_ELEMENTS) -> list[dict[str, Any]]:
    if minimum_elements < 1:
        raise ValueError("a positive independently justified response floor is required")
    query = overpass_query(bbox)
    data = None
    last: Exception | None = None
    for attempt in range(attempts):
        for mirror in OVERPASS_MIRRORS:
            url = mirror + "?" + urllib.parse.urlencode({"data": query})
            request = urllib.request.Request(
                url, headers={"User-Agent": "Kerbside/0.1 SF corridor 3D viewer"})
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    answer = json.loads(response.read().decode("utf-8"))
                # A mirror under load answers 200 with a remark and few or no elements, and a
                # regional mirror answers outside its region with none. One such answer built
                # a corridor of no ways at all, wrote it over the cache, and exited 0: it is
                # a refusal, and the next mirror is asked.
                count = len(answer.get("elements") or [])
                remark = str(answer.get("remark") or "")
                if count < minimum_elements or remark:
                    raise RuntimeError(f"answered with {count} elements"
                                       f"{' and remark ' + remark if remark else ''}; expected "
                                       f"at least {minimum_elements} for these bounds")
                data = answer
                break
            except Exception as exc:  # noqa: BLE001 - any failure means try the next mirror
                last = exc
                print(f"  overpass {mirror.split('/')[2]}: {exc}", file=sys.stderr)
        if data is not None:
            break
        # Overpass throttles by address; a burst of cells from one worker waits its turn.
        time.sleep(30 * (attempt + 1))
    if data is None:
        raise RuntimeError(f"every Overpass mirror refused the query: {last}. Not building from that.")
    return osm_ways_from(data, bbox)


def osm_ways_from(data: dict[str, Any], bbox: BBox) -> list[dict[str, Any]]:
    """An Overpass answer -- or Overture's features put in its shape -- as the builder's ways."""
    ways = []
    # Coastlines cannot be turned into water until the buildings are known, because which side
    # of one is wet is decided by which side has no buildings on it.
    deferred_coastlines: list[tuple[str | None, list[list[float]]]] = []
    for element in data.get("elements", []):
        geometry = element.get("geometry") or []
        tags = element.get("tags") or {}

        # A relation. The bay is one, and so is every other body of water big enough to be
        # split across several ways -- which is why water came out as seven small ponds and
        # the whole northern edge of the corridor was drawn as ground.
        if element.get("type") == "relation" and not geometry:
            if tags.get("natural") == "water" or tags.get("waterway") == "riverbank":
                for ring in _relation_rings(element, bbox):
                    ways.append({"kind": "water", "name": tags.get("name"), "points": ring})
            elif tags.get("natural") == "beach":
                for ring in _relation_rings(element, bbox):
                    ways.append({"kind": "beach", "name": tags.get("name"), "points": ring})
            continue

        if not geometry:
            # A node. Most of what tells you what a building *is* arrives this way -- a
            # restaurant is a point inside a building far more often than it is the building --
            # and skipping everything without geometry threw all of it away.
            if element.get("type") == "node" and "lat" in element and "lon" in element:
                ramp = normalize_osm_kerb_node(element)
                if ramp is not None:
                    ways.append(ramp)
                kept = {k: tags[k] for k in (*ADDRESS_KEYS, *BUSINESS_KEYS)
                        if tags.get(k) not in (None, "")}
                if kept:
                    ways.append({
                        "kind": "poi",
                        "name": tags.get("name"),
                        "point": [round(element["lon"], PRECISION),
                                  round(element["lat"], PRECISION)],
                        "tags": kept,
                    })
            continue
        points = [
            [round(p["lon"], PRECISION), round(p["lat"], PRECISION)]
            for p in geometry
            if "lat" in p and "lon" in p
        ]
        if len(points) < 2:
            continue
        divider = physical_divider_feature(tags, points, element.get("id"))
        if divider is not None:
            ways.append(divider)
            continue
        if tags.get("natural") == "coastline":
            # Which side of the line is wet, checked rather than assumed.
            #
            # OpenStreetMap's convention is land to starboard, water to port, and the convention
            # is right often enough that it is worth starting from -- but a way drawn the other
            # way round puts a 1.4 km band of bay over the city, and six of the fourteen water
            # polygons in this corridor were doing exactly that: blue showing between the
            # buildings for half of North Beach.
            #
            # A bay with houses in it is not a bay. The buildings are the test, they are already
            # in hand, and they settle it without any guessing about which way is out to sea.
            deferred_coastlines.append((tags.get("name"), points))
            # The line itself is kept too: the waterline pass (smc.terrain.waterline) floods the
            # ground grid from the seaward side of it, which is the coastline as the map asserts
            # it and not a band guessed from it.
            ways.append({"kind": "coastline", "name": tags.get("name"), "points": points})
            continue
        if tags.get("natural") == "beach" and _is_closed(points):
            ways.append({"kind": "beach", "name": tags.get("name"), "points": points})
            continue
        if tags.get("man_made") == "pier" and _is_closed(points) and not tags.get("building"):
            ways.append({"kind": "pier", "name": tags.get("name"), "points": points, "osm_id": element.get("id")})
            continue
        if (tags.get("natural") == "water" or tags.get("waterway") == "riverbank"
                or tags.get("landuse") == "reservoir"):
            if _is_closed(points):
                ways.append({"kind": "water", "name": tags.get("name"), "points": points})
            continue
        barrier = tags.get("barrier")
        if barrier in ("wall", "retaining_wall", "city_wall") and len(points) >= 2:
            # A wall follows the ground it stands on, and the ground here is not flat: the
            # Presidio's walls run up slopes and along cuts. The height is what OpenStreetMap
            # says or, failing that, what the kind of wall usually is -- a retaining wall holds
            # back a bank and is taller than a garden wall.
            height = _float_text(tags.get("height")) or (1.6 if barrier == "retaining_wall" else 1.2)
            ways.append({
                "kind": "wall", "name": tags.get("name"), "points": points,
                "wall": barrier, "height_m": round(min(max(height, 0.4), 6.0), 2),
                "material": tags.get("material") or tags.get("wall"),
            })
            continue
        if (tags.get("amenity") == "parking" and not tags.get("building") and _is_closed(points)
                and tags.get("parking") not in ("multi-storey", "underground", "rooftop")):
            ways.append({
                "kind": "parking_lot", "name": tags.get("name"), "points": points,
                "surface": tags.get("surface"), "capacity": _int_text(tags.get("capacity")),
            })
            continue
        if tags.get("building") and _is_closed(points):
            osm_id = element.get("id")
            kept_tags = {
                key: tags[key]
                for key in (*ADDRESS_KEYS, *BUSINESS_KEYS)
                if tags.get(key) not in (None, "")
            }
            height, height_source = _building_height(tags)
            building = {
                "kind": "building",
                "name": tags.get("name"),
                "height_m": round(height, 2),
                "height_source": height_source,
                "centroid": _centroid(points),
                "points": points,
            }
            if osm_id is not None:
                building["osm_id"] = osm_id
                building["building_id"] = f"osm:way:{osm_id}"
            if kept_tags:
                building["tags"] = kept_tags
            # A building under the street: a Muni or BART station mapped as a footprint over
            # the junction it is beneath (Montgomery Street Station, building=train_station,
            # covers Market and Montgomery), a garage under a plaza. Drawn extruded it was a
            # seven-metre grey slab over the crossroads. Kept as a record with no height.
            try:
                layer = int(str(tags.get("layer", "")).strip())
            except ValueError:
                layer = None
            underground = (tags.get("location") == "underground" or (layer is not None and layer < 0)
                           or tags.get("building") in ("train_station", "subway_station")
                           or tags.get("public_transport") == "station" and tags.get("building") == "yes")
            if underground:
                building["underground"] = True
            ways.append(building)
            continue
        highway = tags.get("highway")
        if not highway and tags.get("footway") not in ("sidewalk", "crossing"):
            # An amenity, shop or tourism way that is not a building: a plaza, a school
            # ground, a bicycle rack, and 659 individual parking spaces. They are fetched for
            # what they say a place is, not for their outline, so each is a point like the
            # nodes are -- or nothing. Left to fall through, every one of them was a street:
            # a five metre carriageway on each parking space, stacked across the Marina Green
            # car park two and a half metres apart.
            kept = {k: tags[k] for k in (*ADDRESS_KEYS, *BUSINESS_KEYS)
                    if tags.get(k) not in (None, "")}
            if kept:
                ways.append({
                    "kind": "poi", "name": tags.get("name"),
                    "point": _centroid(points), "tags": kept,
                })
            continue
        if tags.get("footway") == "sidewalk":
            kind = "sidewalk"
        elif tags.get("footway") == "crossing":
            kind = "crossing"
        elif highway in PATH_HIGHWAYS:
            # Fetched because they are part of the walkable network, but they are not roads.
            # Classed as streets they were drawn with a carriageway, a centreline and a footway
            # down either side, which is a strange thing to do to a flight of steps.
            kind = "path"
        elif highway == "cycleway":
            # A cycle track of its own: drawn as the green track it is, not as a road.
            kind = "cycleway"
        else:
            kind = "street"
        feature = {
            "kind": kind,
            "name": tags.get("name"),
            "points": points,
        }
        if kind == "cycleway":
            feature["oneway"] = tags.get("oneway")
            try:
                feature["track_m"] = round(float(str(tags.get("width", "")).replace("m", "").strip()), 2)
            except ValueError:
                feature["track_m"] = None
        # The way's own id: what a lidar kerb profile, a measured height or a colour is keyed
        # by. Buildings carried it from the start; streets and footways did not, so nothing
        # measured off a street could be filed against it.
        if element.get("id") is not None:
            feature["osm_id"] = element.get("id")
        if kind in ("path", "sidewalk"):
            # Physical material is a separate observation from highway/footway type.
            feature["highway"] = highway
            if tags.get("surface"):
                feature["surface"] = tags["surface"]
            evidence = osm_surface(tags, f"osm:way:{element.get('id')}")
            feature["path_surface"] = resolve_surface([evidence] if evidence else [])
        if kind == "crossing":
            feature["crossing_type"] = tags.get("crossing")
            feature["crossing_markings"] = tags.get("crossing:markings")
            feature["marking_provenance"] = "osm_crossing_tags"
            feature["marking_confidence"] = 0.74 if tags.get("crossing:markings") else 0.56
        if kind == "street":
            feature["highway"] = tags.get("highway")
            # How the roadway is divided, as OpenStreetMap has it. This is the current answer
            # -- SFMTA's own lane counts came off a 2010 travel model -- and it is the only
            # source that distinguishes the directions.
            lanes = _int_text(tags.get("lanes"))
            forward = _int_text(tags.get("lanes:forward"))
            backward = _int_text(tags.get("lanes:backward"))
            if lanes:
                feature["lanes"] = lanes
            if forward:
                feature["lanes_fwd"] = forward
            if backward:
                feature["lanes_back"] = backward
            if tags.get("oneway") in ("yes", "-1", "true", "1", "no", "false", "0"):
                feature["osm_oneway"] = tags["oneway"]
            width = _float_text(tags.get("width"))
            if width and 2.0 <= width <= 60.0:
                feature["osm_width_m"] = round(width, 2)

            # Which lanes turn where. 225 ways in this corridor say so and none of it was being
            # read, so every junction was drawn as though every lane went straight on.
            for key, field in (("turn:lanes", "turn"),
                               ("turn:lanes:forward", "turn_fwd"),
                               ("turn:lanes:backward", "turn_back")):
                if tags.get(key):
                    feature[field] = tags[key]

            # Whether this street has a footway, per side, according to the people who mapped
            # it. Nine hundred ways say so outright and another thousand say so per side. The
            # model had been deriving it geometrically -- offset from the centreline and drop
            # the side if it lands in another carriageway -- which is a decent guess and is
            # beaten by a statement.
            walk = _sidewalk_sides(tags)
            if walk is not None:
                feature["osm_walk_sides"] = walk

            # Bike lanes are lane markings too, and 678 ways carry one.
            for key, field in (("cycleway", "cycleway"), ("cycleway:both", "cycleway_both"),
                               ("cycleway:left", "cycleway_left"),
                               ("cycleway:right", "cycleway_right")):
                if tags.get(key) and tags[key] not in ("no", "none"):
                    feature[field] = tags[key]

            # Vertical separation. A way on a layer above or below is a bridge deck or a tunnel
            # bore, and drawing it flat on the ground puts it through whatever it passes.
            layer = _int_text(tags.get("layer"))
            if layer:
                feature["layer"] = layer
            if tags.get("tunnel") not in (None, "no"):
                feature["tunnel"] = True
            if tags.get("bridge") not in (None, "no"):
                feature["bridge"] = True

            # A service road is an alley, a driveway or a parking aisle, and none of them is a
            # street with two footways and a centreline.
            if tags.get("service"):
                feature["service"] = tags["service"]
            speed = _int_text((tags.get("maxspeed") or "").split()[0]
                              if tags.get("maxspeed") else None)
            if speed:
                feature["maxspeed_mph"] = speed
        if kind == "crossing":
            # What kind of crossing it is, which the accessibility side of this project cares
            # about more than the rendering does.
            if tags.get("crossing:signals") not in (None, "no"):
                feature["signals"] = True
            if tags.get("crossing:island") not in (None, "no"):
                feature["island"] = True
            if tags.get("tactile_paving") not in (None, "no"):
                feature["tactile"] = tags.get("tactile_paving")
        ways.append(feature)

    # Now the coastlines, with the buildings in hand to say which side of each is dry.
    landmarks: list[tuple[float, float]] = []
    for way in ways:
        if way.get("kind") != "building" or not way.get("points"):
            continue
        ring = way["points"]
        landmarks.append((sum(p[0] for p in ring) / len(ring),
                          sum(p[1] for p in ring) / len(ring)))
    flipped = dropped = shortened = 0
    for name, points in deferred_coastlines:
        # The longest band, on whichever side, that does not cover the city.
        #
        # Dropping a coastline outright because its full-length band overlaps buildings throws
        # away the shoreline as well as the mistake, and the result is a dark seam between the
        # quay and the bay -- which is the thing this is all for. A short clean band still draws
        # the water at the water's edge, and the disc beyond the corridor covers the rest.
        chosen = None
        for reach in COASTAL_REACHES:
            for port in (True, False):
                band = _coastline_water(points, port=port, reach=reach)
                if not band:
                    continue
                if not covers_the_city(band, landmarks):
                    chosen = (band, port, reach)
                    break
            if chosen:
                break
        if chosen is None:
            dropped += 1
            continue
        band, port, reach = chosen
        if not port:
            flipped += 1
        if reach < COASTAL_BAND_M:
            shortened += 1
        ways.append({"kind": "water", "name": name, "points": band, "coastline_band": True})
    if deferred_coastlines:
        print(f"  coastline water: {len(deferred_coastlines) - dropped} bands "
              f"({flipped} drawn to starboard, {shortened} shortened to clear the city, "
              f"{dropped} dropped)", file=sys.stderr)
    return ways


#: What a shopfront sells, from what OpenStreetMap calls it. The vocabulary is deliberately
#: short: it exists to choose an awning and a typeface, not to catalogue retail. Order matters --
#: the first rule that matches wins, so `cuisine=pizza` is caught before `amenity=fast_food`.
TRADE_RULES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("pizza", "cuisine", ("pizza",)),
    ("pizza", "shop", ("pizza",)),
    ("cafe", "amenity", ("cafe", "coffee_shop")),
    ("cafe", "shop", ("coffee",)),
    ("bakery", "shop", ("bakery", "pastry", "confectionery")),
    ("bar", "amenity", ("bar", "pub", "nightclub", "biergarten")),
    ("restaurant", "amenity", ("restaurant", "fast_food", "food_court", "ice_cream")),
    ("grocery", "shop", ("supermarket", "greengrocer", "butcher", "seafood", "deli",
                         "farm", "health_food")),
    ("convenience", "shop", ("convenience", "kiosk", "newsagent", "tobacco", "alcohol",
                             "wine", "beverages")),
    ("clothing", "shop", ("clothes", "boutique", "shoes", "bag", "jewelry", "fashion",
                          "tailor", "fabric", "leather")),
    ("books", "shop", ("books", "stationery", "art", "music", "musical_instrument")),
    ("salon", "shop", ("hairdresser", "beauty", "massage", "cosmetics", "nail")),
    ("salon", "amenity", ("spa",)),
    ("pharmacy", "amenity", ("pharmacy", "doctors", "dentist", "clinic", "veterinary")),
    ("pharmacy", "shop", ("chemist", "optician", "medical_supply", "hearing_aids")),
    ("bank", "amenity", ("bank", "bureau_de_change", "atm", "post_office")),
    ("laundry", "shop", ("laundry", "dry_cleaning")),
    ("hardware", "shop", ("hardware", "doityourself", "paint", "electrical", "trade",
                          "car_repair", "bicycle", "locksmith")),
    ("florist", "shop", ("florist", "garden_centre")),
    ("hotel", "tourism", ("hotel", "hostel", "guest_house", "motel")),
)

#: A tag that says "a business is here" without saying which. Anything with one of these and a
#: name is a shopfront of some kind, and gets the generic treatment.
GENERIC_TRADE_KEYS = ("shop", "amenity", "craft", "office", "tourism")

#: Nothing behind a shopfront: these are amenities that occupy a point rather than a unit, and
#: putting an awning with "Bench" written on it over a doorway is worse than nothing.
NOT_A_SHOPFRONT = frozenset({
    "bench", "waste_basket", "recycling", "bicycle_parking", "parking", "parking_entrance",
    "parking_space", "drinking_water", "fountain", "toilets", "shelter", "telephone",
    "clock", "post_box", "charging_station", "car_sharing", "taxi", "bus_station",
    "vending_machine", "atm", "fire_hydrant", "grit_bin", "hunting_stand", "shower",
    "bicycle_repair_station", "public_bookcase", "letter_box", "smoking_area",
})

#: How many shopfronts one building is allowed to show. A block-long building on Columbus can
#: hold a dozen businesses, but its street wall can only carry so many signs before they stop
#: being legible, and four is about what fits.
MAX_SHOPFRONTS = 4


def trade_of(tags: dict) -> str | None:
    """Which trade a set of OpenStreetMap tags describes, if any."""
    for trade, key, values in TRADE_RULES:
        value = str(tags.get(key) or "").lower()
        if not value:
            continue
        # cuisine is a semicolon list; the others are single values in practice.
        parts = {p.strip() for p in value.replace(",", ";").split(";")}
        if parts & set(values):
            return trade
    for key in GENERIC_TRADE_KEYS:
        value = str(tags.get(key) or "").lower()
        if value and value not in NOT_A_SHOPFRONT and value not in ("yes", "no"):
            return "shop"
    return None


def attach_shopfronts(ways: list[dict]) -> int:
    """Give every building the businesses standing inside it.

    A shop is a point in OpenStreetMap far more often than it is a building: 3,163 of this
    corridor's points of interest carry a name, against 169 of its retail and restaurant
    footprints. Left as points they are invisible -- the renderer skips them -- and the shopfront
    on the building they are inside has nothing to write on it.

    So they are folded in here, where the building rings are in hand, and the payload carries the
    result rather than the points: a name and a trade per shopfront, which is what a sign needs.
    """
    buildings = [w for w in ways if w.get("kind") == "building" and w.get("points")]
    if not buildings:
        return 0
    lat0 = buildings[0]["points"][0][1]
    m_lat = 111_320.0
    m_lon = m_lat * math.cos(math.radians(lat0))
    cell = 60.0
    grid: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for building in buildings:
        ring = building["points"]
        xs = [p[0] * m_lon for p in ring]
        ys = [p[1] * m_lat for p in ring]
        building["_box"] = (min(xs), max(xs), min(ys), max(ys))
        for ix in range(int(min(xs) / cell), int(max(xs) / cell) + 1):
            for iy in range(int(min(ys) / cell), int(max(ys) / cell) + 1):
                grid[(ix, iy)].append(building)

    attached = 0
    for way in ways:
        if way.get("kind") != "poi":
            continue
        point = way.get("point")
        tags = way.get("tags") or {}
        name = way.get("name")
        if not point or not name:
            continue
        trade = trade_of(tags)
        if trade is None:
            continue
        x, y = point[0] * m_lon, point[1] * m_lat
        for building in grid.get((int(x / cell), int(y / cell)), ()):
            box = building["_box"]
            if not (box[0] <= x <= box[1] and box[2] <= y <= box[3]):
                continue
            if not _ring_contains(building["points"], point[0], point[1]):
                continue
            shops = building.setdefault("shops", [])
            if any(s["n"] == name for s in shops):
                break
            shops.append({"n": name, "t": trade})
            attached += 1
            break

    # A building that is itself the business -- Safeway, a named restaurant footprint -- gets its
    # own name as a shopfront when no point of interest supplied one.
    for building in buildings:
        building.pop("_box", None)
        if building.get("shops"):
            continue
        name = building.get("name")
        if not name:
            continue
        trade = trade_of(building.get("tags") or {})
        if trade is None and building.get("archetype") in ("retail", "restaurant"):
            trade = "shop"
        if trade:
            building["shops"] = [{"n": name, "t": trade}]
            attached += 1
    return attached


#: What a business is, from the category vocabulary Overture and Google share (snake_case
#: words such as ``coffee_shop``, ``clothing_store``, ``hair_salon``). Matched on the words in
#: the category, first rule wins, so ``pizza_restaurant`` is pizza before it is a restaurant.
PLACE_TRADE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("pizza", ("pizza",)),
    ("cafe", ("cafe", "coffee", "tea", "bubble", "juice", "dessert", "ice_cream")),
    ("bakery", ("bakery", "bakeries", "pastry", "donut", "bagel", "chocolate", "candy")),
    ("bar", ("bar", "pub", "brewery", "night_club", "nightclub", "lounge", "wine_bar",
             "cocktail")),
    ("restaurant", ("restaurant", "food", "diner", "grill", "bistro", "noodle", "sushi",
                    "taqueria", "sandwich", "burger", "steak", "seafood", "dim_sum")),
    ("grocery", ("grocery", "supermarket", "market", "butcher", "deli", "convenience",
                 "liquor")),
    ("clothing", ("clothing", "clothes", "fashion", "shoe", "boutique", "jewelry", "jeweler",
                  "apparel", "tailor", "bag", "lingerie", "bridal")),
    ("books", ("book", "stationery", "art_gallery", "gallery", "music", "record", "gift")),
    ("salon", ("salon", "beauty", "barber", "spa", "nail", "massage", "cosmetic", "tattoo")),
    ("pharmacy", ("pharmacy", "drugstore", "dentist", "dental", "doctor", "clinic",
                  "optometrist", "optical", "veterinar", "medical", "chiropract",
                  "acupunctur", "physical_therap")),
    ("bank", ("bank", "credit_union", "atm", "post_office", "currency", "insurance")),
    ("laundry", ("laundry", "laundromat", "dry_clean")),
    ("hardware", ("hardware", "auto", "car_repair", "bicycle", "bike", "locksmith",
                  "electronics", "phone", "computer", "appliance", "furniture", "paint")),
    ("florist", ("florist", "flower", "garden")),
    ("hotel", ("hotel", "hostel", "motel", "inn", "lodging", "guest_house")),
)

#: Categories that are not a shopfront: a place with one of these has no sign over a door.
NOT_A_PLACE_SHOPFRONT = (
    "parking", "atm", "bus_stop", "transit", "station", "apartment", "condominium",
    "residential", "housing", "real_estate_agent", "landmark", "monument", "park",
    "playground", "school", "university", "church", "religious", "place_of_worship", "public",
    "government", "office", "consulting", "lawyer", "attorney", "accountant", "association",
    "organization", "nonprofit", "construction", "contractor", "wholesale", "warehouse",
    "storage", "utility", "embassy", "hospital", "fire_station", "police", "courthouse",
    "cemetery", "point_of_interest", "establishment", "premise", "route", "locality",
)


def place_trade(category: str) -> str | None:
    """Which trade a place category describes, or None when it is not a shopfront."""
    words = str(category or "").lower().replace("-", "_").replace(" ", "_")
    if not words:
        return None
    if any(bad in words for bad in NOT_A_PLACE_SHOPFRONT):
        return None
    for trade, needles in PLACE_TRADE_RULES:
        if any(needle in words for needle in needles):
            return trade
    return "shop"


def attach_named_places(ways: list[dict[str, Any]]) -> dict[str, int]:
    """Name the shopfronts OpenStreetMap left unnamed, from the enrichment's places.

    The first pass folded OpenStreetMap's points of interest into the buildings they stand in.
    The buildings that got nothing -- most of the corridor's retail -- take their names here:
    from Overture's places (CDLA-Permissive-2.0; a point in the footprint, like the OSM ones),
    and from Google's Places answers where the city's own address on the building matched the
    place's. Each shopfront records where its name came from.
    """
    counts = {"overture_places": 0, "google_places": 0, "buildings_named": 0}
    for way in ways:
        if way.get("kind") != "building":
            continue
        shops = way.get("shops") or []
        # Names are facts, not the renderer's sign-space budget. Retain every
        # source-matched tenant, even when only a few signs fit on the street wall.
        before = len(shops)
        seen: set[str] = {str(s.get("n") or "").strip().casefold() for s in shops}
        for place in way.get("overture_places") or []:
            name = str(place.get("name") or "").strip()
            trade = place_trade(place.get("category") or "")
            if not name or trade is None or name.casefold() in seen:
                continue
            shops.append({"n": name, "t": trade, "s": "overture_places"})
            seen.add(name.casefold())
            counts["overture_places"] += 1
        if not before:
            for place in way.get("google_places") or []:
                if str(place.get("business_status") or "OPERATIONAL") != "OPERATIONAL":
                    continue
                reasons = set(place.get("match_reasons") or [])
                close = float(place.get("distance_m") or 999) <= 12.0
                if not ("address_match" in reasons or close):
                    continue
                name = str(place.get("name") or "").strip()
                trade = place_trade(place.get("primary_type") or "")
                if not name or trade is None or name.casefold() in seen:
                    continue
                shops.append({"n": name, "t": trade, "s": "google_places"})
                seen.add(name.casefold())
                counts["google_places"] += 1
        if shops:
            way["shops"] = shops
            counts["buildings_named"] += len(shops) > before
    return counts


def drop_water_over_land(ways: list[dict]) -> list[dict]:
    """Refuse any water polygon with a neighbourhood inside it."""
    landmarks = []
    for way in ways:
        if way.get("kind") != "building" or not way.get("points"):
            continue
        ring = way["points"]
        landmarks.append((sum(p[0] for p in ring) / len(ring),
                          sum(p[1] for p in ring) / len(ring)))
    if not landmarks:
        return ways
    kept, dropped = [], 0
    for way in ways:
        if way.get("kind") == "water" and way.get("points"):
            if covers_the_city(way["points"], landmarks):
                dropped += 1
                continue
        kept.append(way)
    if dropped:
        print(f"  dropped {dropped} water polygons drawn over buildings", file=sys.stderr)
    return kept


#: Ways fetched for the walking network that are not roads.
PATH_HIGHWAYS = frozenset({"footway", "steps", "pedestrian", "path"})
#: A bus lane: Van Ness's are 11 to 12 feet.
BUSWAY_LANE_M = 3.6


def busway_widths(ways: list[dict[str, Any]], frame: Any) -> None:
    """A busway splits round a platform into two pieces a few metres apart, one each way; the
    map gives each the lane count of the whole. A busway piece with another running beside it
    -- a lane or more away, for most of its length -- is one lane. The pieces are compared
    along their whole lines, not by their middles: a long piece one way and a short one the
    other have their middles a block apart while they run side by side."""
    lines = []
    for way in ways:
        if way.get("busway") and len(way.get("points") or []) >= 2:
            lines.append((way, [frame.to_xy(lon, lat) for lon, lat in way["points"]]))

    def distance(px: float, py: float, line: list[tuple[float, float]]) -> float:
        best = math.inf
        for (ax, ay), (bx, by) in zip(line, line[1:]):
            dx, dy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) or 1.0)))
            best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
        return best

    for way, line in lines:
        samples = []
        for (ax, ay), (bx, by) in zip(line, line[1:]):
            steps = max(1, int(math.hypot(bx - ax, by - ay) // 4.0))
            samples += [(ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps) for k in range(steps)]
        # Away from its own ends, where the piece it continues or splits from touches it.
        (sx, sy), (ex, ey) = line[0], line[-1]
        samples = [(x, y) for x, y in samples if min(math.hypot(x - sx, y - sy), math.hypot(x - ex, y - ey)) > 8.0]
        if not samples:
            continue
        beside = sum(1 for x, y in samples
                     if any(other is not way and 2.5 <= distance(x, y, other_line) <= 10.0
                            for other, other_line in lines))
        if beside >= len(samples) / 2:
            way["road_m"] = round(BUSWAY_LANE_M + 0.2, 2)


def reclassify(ways: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Re-derive ``kind`` from the tags the cache already holds.

    The cache stores ways after classification, so changing how a way is classified used to
    need a fresh Overpass fetch -- and Overpass refuses a corridor-sized query often enough
    that the change would silently do nothing instead. The highway tag is in the cache, so the
    classification can be redone from it.
    """
    kept: list[dict[str, Any]] = []
    for way in ways:
        if way.get("kind") == "street" and way.get("highway") in PATH_HIGHWAYS:
            way["kind"] = "path"
        # A street that is not a highway was an amenity, shop or tourism outline the fetch
        # once let through -- a plaza, a bicycle rack, a parking space. A fresh fetch keeps
        # the ones that name a place as points; the cache no longer holds their tags, so here
        # they can only go.
        if way.get("kind") == "street" and not way.get("highway"):
            continue
        # A station's footprint is under the street (see the fetch); the cache keeps the
        # building tag, so the flag can be set from it here as well.
        if way.get("kind") == "building" and (way.get("tags") or {}).get("building") in ("train_station", "subway_station"):
            way["underground"] = True
        kept.append(way)
    return kept


def street_intersections(ways: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Named street crossings, for searching by the way people actually describe a place.

    OpenStreetMap splits a way where another meets it, so two streets that cross share a node.
    Hashing the vertices and looking for coordinates used by more than one name finds the
    junctions without any geometric intersection test -- and without inventing crossings where
    a bridge merely passes over a road, which share no node and correctly do not appear.
    """
    at: dict[tuple[float, float], set[str]] = defaultdict(set)
    for way in ways:
        name = way.get("name")
        if way.get("kind") != "street" or not name:
            continue
        for lon, lat in way.get("points") or []:
            at[(round(float(lon), 6), round(float(lat), 6))].add(name)

    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    for (lon, lat), names in at.items():
        if len(names) < 2:
            continue
        ordered = sorted(names)
        for i, first in enumerate(ordered):
            for second in ordered[i + 1 :]:
                if (first, second) in seen:
                    continue
                seen.add((first, second))
                out.append({"a": first, "b": second, "lon": lon, "lat": lat})
    out.sort(key=lambda row: (row["a"], row["b"]))
    return out


def _crossing_source_style(way: dict[str, Any]) -> str | None:
    """Return only a marking style that an input source actually specifies."""
    markings = str(way.get("crossing_markings") or "").strip().lower()
    crossing = str(way.get("crossing_type") or "").strip().lower()
    legacy_guess = way.get("continental_source") in {
        "default_continental", "sibling_at_junction"
    }
    if markings in {"no", "none", "unmarked"} or crossing in {"no", "unmarked"}:
        return "unmarked"
    if ((way.get("continental") and not legacy_guess)
            or markings in {"zebra", "ladder", "continental"} or crossing == "zebra"):
        return "continental"
    if markings in {"lines", "parallel", "transverse", "crossing_edges"}:
        return "parallel"
    return None


def _crossing_centre(way: dict[str, Any]) -> tuple[float, float] | None:
    points = way.get("points") or []
    if len(points) < 2:
        return None
    spans: list[tuple[float, list[float], list[float]]] = []
    total = 0.0
    for a, b in zip(points, points[1:]):
        length = math.hypot((float(b[0]) - float(a[0])) * 88_000.0,
                            (float(b[1]) - float(a[1])) * 111_320.0)
        if length <= 0:
            continue
        spans.append((length, a, b))
        total += length
    if not spans:
        return float(points[0][0]), float(points[0][1])
    target = total / 2.0
    travelled = 0.0
    for length, a, b in spans:
        if travelled + length >= target:
            ratio = (target - travelled) / length
            return (float(a[0]) + (float(b[0]) - float(a[0])) * ratio,
                    float(a[1]) + (float(b[1]) - float(a[1])) * ratio)
        travelled += length
    return float(points[-1][0]), float(points[-1][1])


def resolve_crossing_marking_styles(
        ways: list[dict[str, Any]], intersections: list[dict[str, Any]]) -> dict[str, int]:
    """Use source style where known; otherwise choose once per physical intersection."""
    locations: list[tuple[str, float, float]] = []
    seen_locations: set[str] = set()
    for intersection in intersections:
        lon = float(intersection["lon"])
        lat = float(intersection["lat"])
        key = f"intersection:{lon:.6f}:{lat:.6f}"
        if key not in seen_locations:
            locations.append((key, lon, lat))
            seen_locations.add(key)

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for way in ways:
        if way.get("kind") != "crossing":
            continue
        # Older payloads called every unknown style continental. Remove that rendering guess;
        # the official SFMTA inventory and explicit OSM tags below remain authoritative.
        if way.get("continental_source") in {"default_continental", "sibling_at_junction"}:
            way.pop("continental", None)
            way.pop("continental_source", None)
        centre = _crossing_centre(way)
        if centre is None:
            continue
        lon, lat = centre
        nearest = None
        for key, junction_lon, junction_lat in locations:
            metres = math.hypot((junction_lon - lon) * 88_000.0,
                                (junction_lat - lat) * 111_320.0)
            if metres <= 26.0 and (nearest is None or metres < nearest[0]):
                nearest = (metres, key)
        group = nearest[1] if nearest else f"midblock:{lon:.5f}:{lat:.5f}"
        way["crossing_style_group"] = group
        grouped[group].append(way)

    counts: Counter = Counter()
    for group, members in grouped.items():
        known: Counter = Counter()
        for way in members:
            style = _crossing_source_style(way)
            if style in {"continental", "parallel"}:
                known[style] += 3 if way.get("continental_source") == "sfmta_inventory" else 1
        if known:
            group_style = sorted(known, key=lambda item: (-known[item], item))[0]
            provenance = "intersection_source_propagation"
            confidence = 0.68
        else:
            # Stable, evenly available alternatives—not an independent percentage draw per arm.
            group_style = ("continental" if hashlib.sha256(group.encode()).digest()[0] & 1
                           else "parallel")
            provenance = "deterministic_intersection_default"
            confidence = 0.52
        for way in members:
            source_style = _crossing_source_style(way)
            if source_style == "unmarked":
                way["resolved_crossing_marking"] = "unmarked"
                counts["explicit unmarked"] += 1
            elif source_style:
                way["resolved_crossing_marking"] = source_style
                counts[f"source {source_style}"] += 1
            else:
                way["resolved_crossing_marking"] = group_style
                way["marking_provenance"] = provenance
                way["marking_confidence"] = confidence
                counts[f"default {group_style}"] += 1
    return dict(counts)


#: A parking aisle is folded into the lot when at least this share of it lies on a mapped lot.
#: The rest of such an aisle is its entrance, crossing the pavement from the street.
PARKING_AISLE_IN_LOT_SHARE = 0.5


def _point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    hit = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


#: Tunnels of these road classes are bores through a hill with a mouth to draw. A busway or a
#: service tunnel is a ramp under a building and has nothing at the surface.
ROAD_TUNNEL_CLASSES = {"primary", "secondary", "tertiary", "residential", "unclassified", "trunk",
                       "primary_link", "secondary_link", "trunk_link"}
MIN_ROAD_TUNNEL_M = 40.0
TUNNEL_PORTALS = ROOT / "data" / "sf_public_works" / "tunnel_portals.json"   # set by configure_region


#: A way's portal record is keyed by its name and first point as the measurement wrote them
#: (scripts/measure_tunnel_portals.py). The points were later delivered at seven decimals
#: instead of six, the keys stopped matching, and every tunnel quietly fell back to default
#: portals with the way's ends for mouths. The match is by name and position now, not text.
PORTAL_KEY_TOLERANCE_M = 2.0


def _portal_record_for(way: dict[str, Any], portals: dict[str, dict]) -> dict:
    points = way.get("points") or []
    if not points:
        return {}
    key = str(way.get("osm_id") or f"{way.get('name')}:{points[0]}")
    if key in portals:
        return portals[key]
    name = str(way.get("name"))
    for candidate, record in portals.items():
        head, _, tail = candidate.rpartition(":")
        if head != name or not tail.startswith("["):
            continue
        try:
            lon, lat = json.loads(tail)
        except ValueError:
            continue
        for end in (points[0], points[-1]):
            if math.hypot((end[0] - lon) * 88_000.0, (end[1] - lat) * 111_320.0) <= PORTAL_KEY_TOLERANCE_M:
                return record
    return {}


def classify_tunnels(ways: list[dict[str, Any]]) -> dict[str, int]:
    """Say what each ``tunnel=yes`` way is, from the lidar where it has been read.

    Seventy-five ways in the corridor are tagged ``tunnel=yes``. Road class and length used to
    decide which were bores with a mouth, which put two stone headwalls on 1st Street where
    it merely passes under the Transbay transit centre. Now the lidar profile along each
    candidate (scripts/measure_tunnel_portals.py) says: a ``bore`` has hill over it and gets
    ``tunnel_kind="road"`` with its two mouths where the ground first stands over the road,
    its covered length, the cover profile along it and each end's headwall; an
    ``underpass`` has a building over it and no ground at all, and is drawn as the street it
    is; anything the lidar read as open, or never read, is ``"underground"`` -- the Transbay
    bus ramps, car park entrances -- and is not drawn at the surface.
    """
    portals: dict[str, dict] = {}
    if TUNNEL_PORTALS.exists():
        portals = json.loads(TUNNEL_PORTALS.read_text(encoding="utf-8")).get("tunnels", {})
    counts: Counter[str] = Counter()
    for way in ways:
        if way.get("kind") != "street" or not way.get("tunnel"):
            continue
        points = way.get("points") or []
        length = sum(math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
                     for a, b in zip(points[:-1], points[1:], strict=True))
        # Immersed road tubes have water rather than a lidar-visible hill above them.
        # The generic bore classifier therefore cannot discover them from cover returns.
        # Clearance is documented; floor depth remains explicitly inferred visual geometry.
        tube_clearance = {"Posey Tube": 4.47, "Webster Street Tube": 4.52}.get(way.get("name"))
        if tube_clearance is not None and len(points) >= 2:
            way["tunnel_kind"] = "road"
            way["tunnel_mouths"] = {"start": points[0], "end": points[-1]}
            way["tunnel_design"] = {
                "kind": "immersed_tube", "clearance_m": tube_clearance,
                "floor_below_water_m": 12.0,
                "profile_source": "inferred_visual_not_measured",
                "clearance_source": "Caltrans tube specifications; see docs/tunnel-geometry.md",
            }
            counts["immersed road tube"] += 1
            continue
        measured = _portal_record_for(way, portals)
        kind = measured.get("kind")
        if kind == "underpass":
            way["tunnel_kind"] = "underpass"
            counts["underpass beneath a building"] += 1
            continue
        if kind == "bore" or (not measured and way.get("highway") in ROAD_TUNNEL_CLASSES
                              and length >= MIN_ROAD_TUNNEL_M):
            way["tunnel_kind"] = "road"
            way["tunnel_length_m"] = round(length, 2)
            if measured:
                way["tunnel_length_m"] = measured.get("covered_length_m") or round(length, 2)
                way["tunnel_mouths"] = {
                    end: measured[end]["p"] for end in ("start", "end") if measured.get(end)
                }
                heights = {end: measured[end]["headwall_m"] for end in ("start", "end")
                           if measured.get(end) and measured[end].get("headwall_m") is not None}
                if heights:
                    way["tunnel_portal"] = heights
                # The road's level at each mouth, fitted on the open approach by the same
                # measurement. The terrain grid cannot give it: under a deck over a portal
                # (Bush Street over the Stockton Tunnel's) the grid has no ground returns and
                # is filled from the hill either side, seven metres over the road.
                road_z = {end: measured[end]["road_z"] for end in ("start", "end")
                          if measured.get(end) and measured[end].get("road_z") is not None}
                if len(road_z) == 2:
                    way["tunnel_road_z"] = road_z
                # Cover along the bore, metres of hill over the road every few metres from
                # the first mouth, for the buildings that stand on that hill.
                way["tunnel_cover"] = [[round(s - measured["start"]["s"], 1), c]
                                       for s, c in measured.get("cover", []) if c is not None]
                counts["road tunnel measured from the lidar"] += 1
            else:
                counts["road tunnel with default portals"] += 1
        else:
            way["tunnel_kind"] = "underground"
            counts["underground ramp"] += 1
    return dict(counts)


#: The lidar puts a mouth where the ground first stands 0.8 m over the road. A road tunnel's
#: roof is not 0.8 m over the road: for the first 26 m inside Broadway's east mouth the cover
#: climbs from 1.0 to 3.4 m, which is the top of the approach cut's retaining walls seen from
#: the centreline, not a roof, and drawn as a bore it was a shell 1.5 m high over the roadway.
#: The mouth is where the cover first clears this, for two samples running, and the piece
#: before it is the open cut it is; the move is recorded in ``tunnel_mouth_low_cover_m``.
TUNNEL_MIN_COVER_M = 3.5
#: A tunnel wider than this between its walls is two bores (the page's TUNNEL_TWIN_MIN_M).
TUNNEL_TWIN_MIN_M = 16.0


def _way_length_m(points: list[list[float]]) -> float:
    return sum(math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
               for a, b in zip(points[:-1], points[1:], strict=True))


def _slice_way(points: list[list[float]], s0: float, s1: float) -> list[list[float]]:
    """The piece of a lon/lat polyline between two distances along it."""
    out: list[list[float]] = []
    acc = 0.0
    for a, b in zip(points[:-1], points[1:], strict=True):
        seg = math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
        if seg <= 0:
            continue
        lo, hi = acc, acc + seg
        if hi < s0 or lo > s1:
            acc = hi
            continue
        t0 = max(0.0, (s0 - lo) / seg)
        t1 = min(1.0, (s1 - lo) / seg)
        start = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]
        end = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]
        if not out:
            out.append(start)
        out.append(end)
        acc = hi
    return out


def split_tunnel_approaches(ways: list[dict[str, Any]]) -> dict[str, int]:
    """Cut each measured bore at its mouths: the bore is the tunnel, the rest is street.

    OpenStreetMap ends a tunnel way where its tagging changes, which is metres from where the
    ground actually closes over the road (Broadway's east mouth is 13.6 m inside the way's
    end). The way used to be drawn as a tunnel from end to end, so the open approach outside
    the lidar's mouth had no roadway, no kerb and no pavement -- the gap the walker met right
    past the portal. The way is split where the lidar put the mouths: the piece between them
    keeps ``tunnel_kind="road"`` and is the bore; a piece outside is a street like any other,
    tagged ``tunnel_approach`` so the record says why it exists.

    A mouth is then moved inward to where the cover is a roof (TUNNEL_MIN_COVER_M). Bush
    Street stands on the Stockton Tunnel's south portal; while the model was flat the mouth
    was pushed past that junction so the junction could be drawn at grade. The ground is the
    lidar's now, Bush Street is drawn on the deck over the portal, and the mouth stays where
    the lidar put it, under the street.
    """
    counts: Counter[str] = Counter()
    added: list[dict[str, Any]] = []
    for way in ways:
        if way.get("tunnel_kind") != "road" or not way.get("tunnel_mouths"):
            continue
        points = way["points"]
        total = _way_length_m(points)
        mouths = way["tunnel_mouths"]

        def along(p: list[float]) -> float:
            best, acc = 0.0, 0.0
            best_d = None
            for a, b in zip(points[:-1], points[1:], strict=True):
                bx = (b[0] - a[0]) * 88_000.0
                by = (b[1] - a[1]) * 111_320.0
                px = (p[0] - a[0]) * 88_000.0
                py = (p[1] - a[1]) * 111_320.0
                seg2 = bx * bx + by * by
                t = max(0.0, min(1.0, (px * bx + py * by) / seg2)) if seg2 else 0.0
                d = math.hypot(px - bx * t, py - by * t)
                if best_d is None or d < best_d:
                    best_d, best = d, acc + math.sqrt(seg2) * t
                acc += math.sqrt(seg2)
            return best

        s0 = along(mouths["start"]) if mouths.get("start") else 0.0
        s1 = along(mouths["end"]) if mouths.get("end") else total
        low_cover = {}
        cover = [(s0 + rel, c) for rel, c in (way.get("tunnel_cover") or [])]
        deep = [i for i in range(len(cover) - 1)
                if cover[i][1] >= TUNNEL_MIN_COVER_M and cover[i + 1][1] >= TUNNEL_MIN_COVER_M]
        if deep:
            first, last = cover[deep[0]][0], cover[deep[-1] + 1][0]
            if first > s0 + 0.5:
                low_cover["start"] = round(first - s0, 1)
                s0 = first
            if last < s1 - 0.5:
                low_cover["end"] = round(s1 - last, 1)
                s1 = last
        # The road level at each mouth, carried along the measurement's straight road line
        # to wherever the mouth now stands.
        road_z = way.get("tunnel_road_z")
        mouth_z: dict[str, float] = {}
        if road_z:
            s_start = along(mouths["start"]) if mouths.get("start") else 0.0
            s_end = along(mouths["end"]) if mouths.get("end") else total
            span = s_end - s_start
            grade = (road_z["end"] - road_z["start"]) / span if span > 1.0 else 0.0
            mouth_z = {"start": round(road_z["start"] + grade * (s0 - s_start), 2),
                       "end": round(road_z["start"] + grade * (s1 - s_start), 2)}
        if s1 - s0 < MIN_ROAD_TUNNEL_M:
            counts["bore too short after its mouths were placed"] += 1
            continue
        for a, b, label in ((0.0, s0, "start"), (s1, total, "end")):
            if b - a < 2.0:
                continue
            piece = _slice_way(points, a, b)
            if len(piece) < 2:
                continue
            approach = {k: v for k, v in way.items()
                        if k not in ("tunnel", "tunnel_kind", "tunnel_length_m", "tunnel_portal",
                                 "tunnel_mouths", "tunnel_cover", "tunnel_road_z", "tunnel_design", "layer")}
            approach["points"] = piece
            approach["tunnel_approach"] = label
            if label in mouth_z:
                approach["tunnel_approach_road_z"] = mouth_z[label]
            # The cut outside a twin-bore tunnel carries both directions, whichever bore's
            # line OpenStreetMap drew the tunnel way along.
            if (way.get("road_m") or 0) > TUNNEL_TWIN_MIN_M:
                approach["oneway"] = None
                approach["osm_oneway"] = None
                approach["lanes"] = 2 * (way.get("lanes") or 2)
                approach.pop("lanes_fwd", None)
                approach.pop("lanes_back", None)
            added.append(approach)
            counts["approach drawn as street"] += 1
        bore = _slice_way(points, s0, s1)
        way["points"] = bore
        way["tunnel_length_m"] = round(s1 - s0, 2)
        way["tunnel_mouths"] = {"start": bore[0], "end": bore[-1]}
        if mouth_z:
            way["tunnel_road_z"] = mouth_z
        if low_cover:
            way["tunnel_mouth_low_cover_m"] = low_cover
            counts["mouth moved in to where the cover is a roof"] += len(low_cover)
        if way.get("tunnel_cover"):
            shift = low_cover.get("start", 0.0)
            way["tunnel_cover"] = [[round(s - shift, 1), c] for s, c in way["tunnel_cover"]
                                   if s - shift >= 0]
        counts["bore split at its mouths"] += 1
    ways.extend(added)
    return dict(counts)


def fold_parking_aisles_into_lots(ways: list[dict[str, Any]]) -> int:
    """Reclassify parking aisles that run over a mapped lot as part of that lot.

    OpenStreetMap draws a lot twice: as an ``amenity=parking`` area, and as the
    ``service=parking_aisle`` lines a car drives along inside it. The area is the surface; the
    aisles are routing. Drawn as streets, the aisles became eight-metre carriageways a few
    metres apart, stacked three deep over the lot's own asphalt and its bays (the Marina Green
    lot had three roadways on one point). An aisle that lies on a lot becomes
    ``kind="parking_aisle"`` and nothing in the renderer draws it; one outside any mapped lot
    stays a street, and the renderer draws it a lane wide.
    """
    lots = [w["points"] for w in ways if w.get("kind") == "parking_lot" and len(w.get("points") or []) >= 4]
    boxes = []
    for ring in lots:
        xs = [q[0] for q in ring]
        ys = [q[1] for q in ring]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))

    def on_a_lot(x: float, y: float) -> bool:
        for ring, (x0, y0, x1, y1) in zip(lots, boxes):
            if x0 <= x <= x1 and y0 <= y <= y1 and _point_in_ring(x, y, ring):
                return True
        return False

    folded = 0
    for way in ways:
        if way.get("kind") != "street":
            continue
        # Aisles say so; a lot's entrance is a service road with no service tag at all, and
        # the part of it inside the lot is lot surface too.
        if way.get("service") not in ("parking_aisle", "access"):
            continue
        points = way.get("points") or []
        if len(points) < 2:
            continue
        samples = [
            (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            for a, b in zip(points[:-1], points[1:], strict=True)
            for t in (0.1, 0.3, 0.5, 0.7, 0.9)
        ]
        share = sum(on_a_lot(x, y) for x, y in samples) / len(samples)
        if share >= PARKING_AISLE_IN_LOT_SHARE:
            way["kind"] = "parking_aisle"
            folded += 1
    return folded


PARKING_ZONES = ROOT / "build" / "street_furniture" / "parking_zones.json"
#: A block face is a parking lane when the city's parking policies cover this share of it.
PARKING_SIDE_SHARE = 0.3
PARKING_MATCH_M = 14.0
#: A parked car's lane, as San Francisco lays it out.
PARKING_LANE_M = 2.4


def _street_key(name: str | None) -> str:
    text = (name or "").upper().replace(".", "")
    for long, short in (("STREET", "ST"), ("AVENUE", "AVE"), ("BOULEVARD", "BLVD"),
                        ("PLACE", "PL"), ("TERRACE", "TER"), ("COURT", "CT"), ("LANE", "LN"),
                        ("DRIVE", "DR"), ("ROAD", "RD"), ("ALLEY", "ALY")):
        text = text.replace(f" {long}", f" {short}")
    return " ".join(text.split())


def annotate_parking_lanes(ways: list[dict[str, Any]]) -> dict[str, int]:
    """Which side of each street has a parking lane, from the city's parking block faces.

    OpenStreetMap's ``parking:lane`` tags are not in this corridor's cache and a lane count
    does not say where the parked cars are. SFMTA's curb policies do: every block face under
    General Parking, Residential Permit Parking or the like is a lane of parked cars. Each
    such block face is matched to the nearest street way of the same name within
    PARKING_MATCH_M, on the side its midpoint falls; a way whose side is parked along at
    least PARKING_SIDE_SHARE of its length gets that side in ``parking_sides`` (1 left of
    travel, -1 right), and the lane lines are then spaced over the travel lanes only.
    """
    counts: Counter[str] = Counter()
    if not PARKING_ZONES.exists():
        counts["parking block faces unavailable"] += 1
        return dict(counts)
    zones = json.loads(PARKING_ZONES.read_text(encoding="utf-8")).get("zones", [])
    streets = [w for w in ways if w.get("kind") == "street" and w.get("name")
               and len(w.get("points") or []) >= 2]
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for way in streets:
        by_name[_street_key(way["name"])].append(way)
        way["_parked"] = {1: 0.0, -1: 0.0}
    for zone in zones:
        candidates = by_name.get(_street_key(zone.get("street")))
        if not candidates:
            counts["block faces with no street of that name"] += 1
            continue
        points = zone["p"]
        length = sum(math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
                     for a, b in zip(points[:-1], points[1:], strict=True))
        mid = points[len(points) // 2]
        best: tuple[float, dict[str, Any], int] | None = None
        for way in candidates:
            pts = way["points"]
            for a, b in zip(pts[:-1], pts[1:], strict=True):
                ax, ay = 0.0, 0.0
                bx = (b[0] - a[0]) * 88_000.0
                by = (b[1] - a[1]) * 111_320.0
                px = (mid[0] - a[0]) * 88_000.0
                py = (mid[1] - a[1]) * 111_320.0
                seg2 = bx * bx + by * by
                t = max(0.0, min(1.0, (px * bx + py * by) / seg2)) if seg2 else 0.0
                dx, dy = px - bx * t, py - by * t
                distance = math.hypot(dx, dy)
                if distance > PARKING_MATCH_M:
                    continue
                side = 1 if (bx * py - by * px) > 0 else -1     # left of travel is positive
                if best is None or distance < best[0]:
                    best = (distance, way, side)
        if best is None:
            counts["block faces matched to no way"] += 1
            continue
        best[1]["_parked"][best[2]] += length
        counts["block faces matched"] += 1
    for way in streets:
        parked = way.pop("_parked")
        length = sum(math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
                     for a, b in zip(way["points"][:-1], way["points"][1:], strict=True))
        sides = [side for side in (1, -1)
                 if length > 0 and parked[side] >= PARKING_SIDE_SHARE * length]
        if sides:
            way["parking_sides"] = sides
            counts["ways with a parking lane"] += 1
    return dict(counts)


def annotate_cross_sections(ways: list[dict[str, Any]]) -> dict[str, int]:
    """Every street as measured cross-sections (smc.facts.cross_section): the kerbs from the
    city's curb-line profile at each station, the parking and bike bands from the policies and
    the map, the travel lanes chosen from hypotheses, and refusal where the width cannot be
    closed. The page draws its lane paint from these rather than from a count divided into a
    width."""
    from smc.facades.geometry import LocalFrame
    from smc.facts.build_cross_sections import build_cross_sections
    from smc.facts.cross_section import SourceGrade

    centrelines_path = OFFICIAL / "centrelines.json"
    profiles_path = OFFICIAL / "curb_profiles_corridor.json"
    # The city's curb-line profile where the city has one; the lidar's own reading of the
    # kerbs (scripts/measure_region_lidar.py) where it does not; and without either every
    # station's kerbs are the mapped width's, graded mapped or inferred: a lower rung each
    # time, never no rung.
    def _has_profiles(path: Path) -> bool:
        # A city-shaped file with nothing in it -- what an earlier region run left behind in
        # Oakland -- is not a city's record, and must not outrank the lidar's.
        try:
            return path.exists() and bool(json.loads(path.read_text()).get("profiles"))
        except (ValueError, AttributeError):
            return False
    if not (centrelines_path.exists() and _has_profiles(profiles_path)):
        centrelines_path = OFFICIAL / "centrelines_osm.json"
        profiles_path = OFFICIAL / "curb_profiles_lidar.json"
    has_profiles = centrelines_path.exists() and _has_profiles(profiles_path)
    bbox = {"south": REGION.bbox.south, "west": REGION.bbox.west,
            "north": REGION.bbox.north, "east": REGION.bbox.east}
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0, (bbox["west"] + bbox["east"]) / 2.0)
    table = json.loads(profiles_path.read_text()) if has_profiles else {}
    profiles = table.get("profiles", {})
    centrelines = json.loads(centrelines_path.read_text()) if has_profiles else []
    # A lidar profile (scripts/measure_region_lidar.py) is keyed by the way's own id and
    # stationed along the way itself; the way is its own centreline.
    grade = SourceGrade.LIDAR if table.get("grade") == "lidar" else SourceGrade.SURVEY
    if grade is SourceGrade.LIDAR:
        for way in ways:
            if way.get("kind") == "street" and way.get("osm_id") is not None:
                way["cnn"] = f"osm:{way['osm_id']}"
    bands_path = OFFICIAL / "parking_bands.json"
    measured = json.loads(bands_path.read_text()).get("bands", {}) if bands_path.exists() else {}
    counts = build_cross_sections(ways, centrelines, profiles, frame=frame, measured_parking=measured,
                                  profile_grade=grade)
    counts["kerb profiles"] = ("city" if grade is SourceGrade.SURVEY else "lidar") if has_profiles \
        else "none: kerbs from the mapped width"
    return counts


def alley_mouth_crossings(ways: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Short pedestrian crossings where alleys cut a sidewalk.

    OpenStreetMap often maps the alley carriageway and the sidewalks beside the main street,
    but not the little crosswalk/driveway apron between the two sidewalk halves. Rendering only
    the alley therefore cuts the pavement visually. These synthetic crossing ways are narrow,
    one-per-mouth, and only added when an alley endpoint lands on another non-alley street.
    """
    scale_lon = 88_000.0
    scale_lat = 111_320.0

    def to_xy(point: list[float]) -> tuple[float, float]:
        return point[0] * scale_lon, point[1] * scale_lat

    def to_lonlat(x: float, y: float) -> list[float]:
        return [round(x / scale_lon, PRECISION), round(y / scale_lat, PRECISION)]

    def point_segment_distance(point, a, b) -> float:
        px, py = to_xy(point)
        ax, ay = to_xy(a)
        bx, by = to_xy(b)
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        if length_sq < 1e-9:
            return math.hypot(px - ax, py - ay)
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
        return math.hypot(px - (ax + dx * t), py - (ay + dy * t))

    street_segments: list[tuple[list[float], list[float]]] = []
    for way in ways:
        if way.get("kind") != "street" or way.get("service") == "alley":
            continue
        points = way.get("points") or []
        for a, b in zip(points[:-1], points[1:]):
            street_segments.append((a, b))

    out: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for way in ways:
        if way.get("kind") != "street" or way.get("service") != "alley":
            continue
        points = way.get("points") or []
        if len(points) < 2:
            continue
        road_width = max(3.0, min(float(way.get("road_m") or 4.2), 6.5))
        for at_start in (True, False):
            mouth = points[0] if at_start else points[-1]
            inside = points[1] if at_start else points[-2]
            if min((point_segment_distance(mouth, a, b) for a, b in street_segments),
                   default=999.0) > 7.5:
                continue
            mx, my = to_xy(mouth)
            ix, iy = to_xy(inside)
            dx, dy = ix - mx, iy - my
            span = math.hypot(dx, dy)
            if span < 0.5:
                continue
            dx, dy = dx / span, dy / span
            cx, cy = mx + dx * 1.35, my + dy * 1.35
            nx, ny = -dy, dx
            half = road_width / 2 + 0.35
            a = to_lonlat(cx - nx * half, cy - ny * half)
            b = to_lonlat(cx + nx * half, cy + ny * half)
            key = (round(cx), round(cy))
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "kind": "crossing",
                "name": way.get("name"),
                "points": [a, b],
                "covered": way.get("covered", False),
                "alley_mouth": True,
                "crossing_m": 2.4,
                "continental": True,
            })
    return out


def district_bands() -> list[dict[str, Any]]:
    south, north = REGION.bbox.south, REGION.bbox.north
    if REGION.name != SF_CORRIDOR.name:
        # The corridor's districts are hand-drawn; any other region is one district, itself.
        return [{"name": REGION.description or REGION.name, "west": REGION.bbox.west, "east": REGION.bbox.east,
                 "south": south, "north": north}]
    return [
        {"name": "Marina", "west": -122.4475, "east": -122.4310, "south": 37.7975, "north": north},
        {"name": "Cow Hollow", "west": -122.4475, "east": -122.4235, "south": south, "north": 37.7975},
        {"name": "Russian Hill", "west": -122.4235, "east": -122.4115, "south": south, "north": north},
        {"name": "North Beach", "west": -122.4115, "east": -122.4020, "south": 37.7960, "north": north},
        {"name": "Chinatown", "west": -122.4115, "east": -122.4020, "south": south, "north": 37.7960},
        {"name": "Financial District", "west": -122.4020, "east": -122.3920, "south": south, "north": north},
    ]


def h3_boundary(cell: str) -> list[list[float]]:
    return [[round(lon, PRECISION), round(lat, PRECISION)] for lat, lon in h3.cell_to_boundary(cell)]


def _cell_resolution(cells: set[str]) -> int:
    if not cells:
        return 10
    return h3.get_resolution(next(iter(cells)))


def _feature_is_covered(feature: dict[str, Any], cells: set[str], resolution: int) -> bool:
    if not cells:
        return False
    sample_points = list(feature.get("points") or [])
    centroid = feature.get("centroid")
    if centroid:
        sample_points.append(centroid)
    for lon, lat in sample_points[:: max(1, len(sample_points) // 8)]:
        if h3.latlng_to_cell(lat, lon, resolution) in cells:
            return True
    return False


def annotate_osm_features(
    ways: list[dict[str, Any]], coverage: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    covered_cells = {
        row["coverage_cell"]
        for row in coverage
        if row.get("eligible_observations", 0) > 0
    }
    resolution = _cell_resolution(covered_cells)
    annotated = []
    height_sources = Counter()
    # "Covered" meant photographed: the corridor draws its buildings in 3D where the imagery
    # reached. A region built with no imagery at all is drawn whole, from the map and the
    # lidar, and its capability vector says which rungs it stands on.
    # A region other than the corridor is drawn whole as well: the terrain and the lidar
    # heights cover it, and a district with half its blocks missing is not a district.
    whole = not coverage or REGION.name != SF_CORRIDOR.name
    for feature in ways:
        item = dict(feature)
        item["covered"] = True if whole else _feature_is_covered(item, covered_cells, resolution)
        if item.get("kind") == "building":
            height_sources[item.get("height_source") or "unknown"] += 1
        annotated.append(item)
    counts = Counter(item.get("kind") for item in annotated)
    covered_counts = Counter(item.get("kind") for item in annotated if item.get("covered"))
    return annotated, {
        "features": dict(counts),
        "covered_features": dict(covered_counts),
        "building_height_sources": dict(height_sources),
    }


def record_activation(payload: dict[str, Any]) -> None:
    """Write what this build stood on into the region's capabilities.json."""
    from smc.regions.activation import activation
    caps_path = ROOT / "data" / "regions" / REGION.name / "capabilities.json"
    if not caps_path.exists():
        if REGION.name != SF_CORRIDOR.name:
            return
        caps = {"region": REGION.name, "vector": {}}
    else:
        caps = json.loads(caps_path.read_text())
    official_path = SITE_DIR / "sf-corridor-official.json"
    official = json.loads(official_path.read_text()) if official_path.exists() else None
    caps["activation"] = activation(payload, caps.get("vector", {}), official)
    caps["activation_note"] = ("available: what discovery found over the box; implemented: an extractor "
                               "exists for that source; active: it ran on this build and the count is "
                               "what it contributed. A property is truthful only when active matches "
                               "available.")
    caps_path.parent.mkdir(parents=True, exist_ok=True)
    caps_path.write_text(json.dumps(caps, indent=1) + "\n")
    print("  activation: " + ", ".join(
        f"{k}={v['active']}({v['count']}/{v['of']})" for k, v in caps["activation"].items()), file=sys.stderr)


def annotate_region_lidar(ways: list[dict[str, Any]]) -> dict[str, Any]:
    """What the region's own lidar pass measured (scripts/measure_region_lidar.py): a roof
    height for every footprint it saw, taken over the map's storey count and the default, and
    over a height a mapper wrote down where the two agree (smc.buildings.lidar_heights); and
    the kerb height along each street."""
    from smc.buildings.lidar_heights import adopt_lidar_height
    lidar_dir = ROOT / "data" / "regions" / REGION.name / "lidar"
    counts: Counter[str] = Counter()
    heights_path = lidar_dir / "building_heights.json"
    if heights_path.exists():
        heights = json.loads(heights_path.read_text()).get("buildings", {})
        for way in ways:
            if way.get("kind") != "building":
                continue
            found = heights.get(str(way.get("osm_id")))
            if not found:
                counts["building without a lidar roof"] += 1
                continue
            counts[{"adopted": "building height from the lidar",
                     "confirmed": "building's mapped height confirmed by the lidar",
                     "disagrees": "building kept the mapper's height over the lidar's",
                     }.get(adopt_lidar_height(way, found), "building height measured elsewhere")] += 1
    kerbs_path = lidar_dir / "kerb_heights.json"
    if kerbs_path.exists():
        kerbs = json.loads(kerbs_path.read_text())
        for way in ways:
            if way.get("kind") != "street" or way.get("osm_id") is None:
                continue
            found = kerbs.get(f"osm:{way['osm_id']}")
            if found and not way.get("kerb_m"):
                way["kerb_m"] = found["curb_height_m"]
                way["kerb_n"] = found["curb_height_n"]
                way["kerb_source"] = "lidar_region"
                counts["street kerb height from the lidar"] += 1
    # Photographed kerb heights (scripts/curbmeasure/photo_kerb_heights.py) for a street with
    # neither a city nor a lidar height, and only where the photographs agreed with the lidar
    # on the streets both measured: a lower rung, labelled so, never a kerb position.
    photo_path = lidar_dir / "kerb_heights_photo.json"
    if photo_path.exists():
        photo = json.loads(photo_path.read_text())
        if photo.get("accepted") and photo.get("grade") == "image":
            for way in ways:
                if way.get("kind") != "street" or way.get("osm_id") is None or way.get("kerb_m"):
                    continue
                found = photo.get("heights", {}).get(f"osm:{way['osm_id']}")
                if found:
                    way["kerb_m"] = found["curb_height_m"]
                    way["kerb_n"] = found["curb_height_n"]
                    way["kerb_source"] = "photo_semantic"
                    counts["street kerb height from photographs (below the lidar)"] += 1
    return dict(counts)


def annotate_building_enrichment(ways: list[dict[str, Any]]) -> dict[str, Any]:
    building_index = 0
    for way in ways:
        if way.get("kind") != "building":
            continue
        way["building_id"] = building_id(way, building_index)
        if way.get("tags"):
            seeded = normalize_osm_building(way, building_index)
            for key in ("address", "building_osm", "land_use", "osm_types", "archetype"):
                if seeded.get(key) not in (None, "", [], {}) and not way.get(key):
                    way[key] = seeded[key]
        building_index += 1

    summary: dict[str, Any] = {
        "available": BUILDING_ENRICHMENT.exists(),
        "buildings": building_index,
        "matched": 0,
    }
    if not BUILDING_ENRICHMENT.exists():
        return summary
    enrichment = json.loads(BUILDING_ENRICHMENT.read_text(encoding="utf-8"))
    counts = merge_building_enrichment(ways, enrichment)
    summary.update(counts)
    height_sources = Counter(
        str(way.get("height_source") or "missing") for way in ways if way.get("kind") == "building"
    )
    summary["final_with_height"] = sum(
        1 for way in ways if way.get("kind") == "building" and way.get("height_m")
    )
    summary["final_height_sources"] = dict(height_sources)
    summary["inferred_default_heights"] = height_sources.get("inferred_default", 0)
    summary["source"] = project_path(BUILDING_ENRICHMENT)
    return summary


def _rows(path: Path) -> list[dict]:
    """A catalogue table's rows, or none: a region whose imagery has not been harvested yet
    builds from the map, the lidar and the records, and its coverage layer is empty."""
    return pq.read_table(path).to_pylist() if path.exists() else []


def build_payload(root: Path, ways: list[dict[str, Any]]) -> dict[str, Any]:
    observations = _rows(root / "observations" / "external-000.parquet")
    coverage = _rows(root / "coverage" / "h3.parquet")
    sequences = _rows(root / "sequences" / "external.parquet")
    if not observations:
        print(f"  no observation catalogue under {root}: building without imagery", file=sys.stderr)
    # A fallback, and only that. This used to be *the* kerb height: one median taken over every
    # measurement in the corridor and built into every kerb in the model, which is how nine
    # thousand lidar slices became a single number. Each way now carries its own measured height
    # where we have one (see annotate_official); this is what a way without one falls back to,
    # and it is deliberately still the measured median rather than the nominal six inches.
    measured = [
        row["curb_height_m"]
        for row in pq.read_table(root / "depth" / "surfaces" / "surface_measurements.parquet").to_pylist()
        if row.get("curb_height_m") and row.get("provenance") == "measured"
    ] if (root / "depth" / "surfaces" / "surface_measurements.parquet").exists() else []
    measured.sort()
    kerb_height_m = measured[len(measured) // 2] if measured else 0.126

    depth_summary_path = root / "depth" / "stats" / "summary.json"
    depth_summary = (
        json.loads(depth_summary_path.read_text(encoding="utf-8"))
        if depth_summary_path.exists()
        else {}
    )
    ways, osm_summary = annotate_osm_features(ways, coverage)
    ground_summary = publish_ground_cover()
    furniture_summary = publish_street_furniture()
    building_summary = annotate_building_enrichment(ways)
    building_summary["lidar_region"] = annotate_region_lidar(ways)
    building_summary["named_places"] = attach_named_places(ways)
    print(f"  shopfronts named from places: {building_summary['named_places']}", file=sys.stderr)
    building_summary["facades"] = annotate_facades(ways)
    official_summary = annotate_official(ways, {
        "south": REGION.bbox.south, "west": REGION.bbox.west,
        "north": REGION.bbox.north, "east": REGION.bbox.east,
    })
    osm_summary["parking_aisles_folded_into_lots"] = fold_parking_aisles_into_lots(ways)
    osm_summary["tunnels"] = classify_tunnels(ways)
    osm_summary["tunnel_approaches"] = split_tunnel_approaches(ways)
    osm_summary["parking_lanes"] = annotate_parking_lanes(ways)
    osm_summary["cross_sections"] = annotate_cross_sections(ways)
    synthetic_alley_crossings = alley_mouth_crossings(ways)
    if synthetic_alley_crossings:
        ways.extend(synthetic_alley_crossings)
        osm_summary["features"]["crossing"] = (
            osm_summary["features"].get("crossing", 0) + len(synthetic_alley_crossings)
        )
        osm_summary["covered_features"]["crossing"] = (
            osm_summary["covered_features"].get("crossing", 0)
            + sum(1 for way in synthetic_alley_crossings if way.get("covered"))
        )
        osm_summary["synthetic_alley_mouth_crossings"] = len(synthetic_alley_crossings)
    intersections = street_intersections(ways)
    official_summary["crossing_marking_resolution"] = resolve_crossing_marking_styles(
        ways, intersections)
    obs_by_sequence: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for obs in observations:
        obs_by_sequence[obs["sequence_uid"]].append(obs)
    sequence_paths = []
    for sequence_uid, rows in obs_by_sequence.items():
        rows.sort(key=lambda r: (r["provider_sequence_index"] is None, r["provider_sequence_index"] or 0))
        eligible_rows = [r for r in rows if r["eligible"]]
        if len(eligible_rows) < 2:
            continue
        sequence_paths.append(
            {
                "id": sequence_uid,
                "provider": eligible_rows[0]["provider"],
                "points": [
                    [round(r["longitude"], PRECISION), round(r["latitude"], PRECISION)]
                    for r in eligible_rows[:: max(1, len(eligible_rows) // 90)]
                ],
            }
        )
    sample_observations = [
        {
            "id": row["observation_uid"],
            "provider": row["provider"],
            "lon": round(row["longitude"], PRECISION),
            "lat": round(row["latitude"], PRECISION),
            "heading": row["heading_deg"],
            "mp": row["original_megapixels"],
            "tier": row["resolution_tier"],
            "projection": row["projection_type"],
            "eligible": row["eligible"],
        }
        for row in observations[:: max(1, len(observations) // 4500)]
    ]
    return {
        "summary": {
            "observations": len(observations),
            "eligible": sum(1 for row in observations if row["eligible"]),
            "sequences": len(sequences),
            "coverage_cells": len(coverage),
            "providers": dict(Counter(row["provider"] for row in observations)),
            "osm": osm_summary,
            "cv_depth": depth_summary,
            "building_enrichment": building_summary,
            "street_furniture": furniture_summary,
        },
        "bbox": {
            "south": REGION.bbox.south,
            "west": REGION.bbox.west,
            "north": REGION.bbox.north,
            "east": REGION.bbox.east,
        },
        "kerb_height_m": round(kerb_height_m, 4),
        "official": official_summary,
        "ground_counts": ground_summary,
        "facades": photo_facades(),
        "intersections": intersections,
        "districts": district_bands(),
        "ways": ways,
        "coverage": [
            {
                "cell": row["coverage_cell"],
                "lat": row["latitude"],
                "lon": row["longitude"],
                "score": row["coverage_score"],
                "eligible": row["eligible_observations"],
                "total": row["total_observations"],
                "providers": row["unique_providers"],
                "mp": row["median_source_megapixels"],
                "boundary": h3_boundary(row["coverage_cell"]),
            }
            for row in coverage
        ],
        # A gap is a mapped street or footway whose ground nobody has photographed. It is
        # computed from the same cells the coverage layer uses, so the two cannot disagree: a
        # way is a gap exactly when none of the cells it passes through holds an eligible
        # observation. This is the layer that says where to send someone next.
        "gaps": [
            {"points": way["points"], "kind": way.get("kind"), "name": way.get("name")}
            for way in ways
            if way.get("kind") in ("street", "sidewalk", "crossing") and not way.get("covered")
        ],
        "observations": sample_observations,
        "sequence_paths": sequence_paths[:260],
    }


GROUND_COVER = ROOT / "data" / "sf_public_works" / "ground_cover.json"   # set by configure_region


GROUND_VIEWER = ROOT / "docs" / "sf-corridor-ground.json"          # set by configure_region
FURNITURE_VIEWER = ROOT / "docs" / "sf-corridor-furniture.json"


def publish_ground_cover() -> dict:
    """Copy the ground cover out to its own file beside the page.

    Its own file, not part of the payload: thirty-three thousand parcel rings and twenty-seven
    thousand trees are fourteen megabytes, and the page should not wait on them to draw a
    street. The map fetches it after the first frame, the way it does the facades.
    """
    if not GROUND_COVER.exists():
        return {"parks": 0, "yards": 0, "trees": 0}
    data = json.loads(GROUND_COVER.read_text())
    GROUND_VIEWER.write_text(json.dumps(data, separators=(",", ":")))
    return {key: len(value) for key, value in data.items()}


def publish_street_furniture() -> dict:
    """Build the optional street-furniture sidecar without embedding it in the map payload."""
    script = ROOT / "scripts" / "build_street_furniture.py"
    if not script.exists():
        return {"available": False, "reason": "missing build_street_furniture.py"}
    try:
        subprocess.run([sys.executable, str(script), "--out", str(FURNITURE_VIEWER), "--region", REGION.name], check=True)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "reason": str(exc)}
    if not FURNITURE_VIEWER.exists():
        return {"available": False, "reason": "sf-corridor-furniture.json was not written"}
    data = json.loads(FURNITURE_VIEWER.read_text(encoding="utf-8"))
    summary = dict(data.get("summary") or {})
    summary["available"] = True
    summary["source"] = project_path(FURNITURE_VIEWER)
    return summary


FACADE_ROOT = ROOT / "docs" / "facades"   # set by configure_region


def photo_facades() -> dict:
    """The walls that are photographs rather than procedural texture.

    Each one carries its own two endpoints, its outward bearing and how far up the cameras
    actually saw, so the map can hang a panel on it without having to match it back to a
    building. That matters: the building list is rebuilt from OpenStreetMap on every run and
    its indices are not stable, while a wall's two corners are the wall.
    """
    grid_path = FACADE_ROOT.parent / "sf-corridor-chunks.json"
    grid = json.loads(grid_path.read_text()) if grid_path.exists() else {"chunks": []}
    chunks = []
    walls = []
    for manifest_path in sorted(FACADE_ROOT.glob("*/manifest.json")):
        manifest = json.loads(manifest_path.read_text())
        key = manifest["chunk"]
        chunks.append({
            "key": key,
            "bbox": manifest["bbox"],
            "buildings": manifest.get("buildings_in_chunk", 0),
            "attempted": manifest.get("walls_attempted", 0),
            "textured": manifest.get("walls_textured", 0),
            "licenses": manifest.get("licenses", {}),
        })
        for wall in manifest["walls"]:
            walls.append({
                "c": key,
                "t": wall["texture"],
                "a": wall["a"],
                "b": wall["b"],
                "h": wall["photo_height_m"],
                "n": wall.get("normal_deg", 0.0),
            })
    done = {c["key"] for c in chunks}
    return {
        "chunks": chunks,
        "walls": walls,
        # The whole grid, so the map can show what has been done against what has not. A chunk
        # with a high readiness and no textures is the next one worth running.
        "grid": [
            {"k": c["key"], "w": c["west"], "s": c["south"], "e": c["east"], "n": c["north"],
             "b": c["buildings"], "o": c["observations"], "r": c["readiness"],
             "d": 1 if c["key"] in done else 0}
            for c in grid["chunks"]
        ],
    }


OFFICIAL = ROOT / "data" / "sf_public_works"   # set by configure_region
#: How near an inventory point has to be to the middle of a crossing way to be that crossing.
#: Generous enough for the offset between where the city drops the point and where OSM draws
#: the way, tight enough not to reach the next arm of the intersection.
CROSSWALK_MATCH_M = 20.0
#: Two crossings closer than this are legs of the same junction. A San Francisco junction is
#: about 25 m across; the far legs of a big one are further apart than this and are caught by
#: their own inventory point or by the leg between them.
CROSSWALK_SIBLING_M = 32.0
#: How far behind a dropped kerb the building it serves may stand. A footway and a small
#: setback; beyond this the cut serves a yard or a lot rather than a garage.
GARAGE_REACH_M = 22.0
#: A garage door: a double door is about 5.5 m; the city's longest curb cuts are thirty.
GARAGE_DOOR_MAX_M = 6.5


def _outward_bearing(ring, a, b) -> float:
    """Compass bearing of the outward normal of the wall from ``a`` to ``b``.

    The side of a wall that faces the street is not something the pair of endpoints can settle
    on its own: it depends on which way round the footprint was wound. Getting it wrong turns a
    garage door to face into the building, and a plane seen edge-on from the street reads as a
    grey slab standing on the pavement -- which is exactly what it did.
    """
    total = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        total += (x1 * y2 - x2 * y1)
    winding = 1.0 if total > 0 else -1.0
    dx = (b[0] - a[0]) * 88_000.0
    dy = (b[1] - a[1]) * 111_320.0
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return 0.0
    nx, ny = (dy / length) * winding, (-dx / length) * winding
    return math.degrees(math.atan2(nx, ny)) % 360.0


def _apron_anchor(index, segments, attributes, cut, road_mask=None) -> dict:
    """The kerb point beside a curb cut, and the bearing pointing away from the road.

    Returns nothing at all when the cut cannot be placed on a street. A missing anchor means
    the renderer draws no apron, which is the right answer: an apron whose direction is a guess
    is the thing that ended up lying across the carriageway.
    """
    placed = index.locate_full(cut[0], cut[1])
    if placed is None:
        return {}
    feature, station, side, _distance = placed
    vertices = index.segments.get(feature)
    if vertices is None or len(vertices) < 2:
        return {}
    attribute = attributes.get(feature) or {}
    record = segments.get(feature) or {}
    road = attribute.get("road_m")
    if not road:
        row = attribute.get("record_row_m") or record.get("right_of_way_m")
        road = max(3.0, row - 6.0) if row else 8.0

    # Walk the centreline to the station to get the local direction, then step out to the kerb.
    travelled = 0.0
    point = direction = None
    for start, end in zip(vertices[:-1], vertices[1:]):
        span = math.hypot(end[0] - start[0], end[1] - start[1])
        if span < 1e-9:
            continue
        if travelled + span >= station:
            t = (station - travelled) / span
            point = (start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t)
            direction = ((end[0] - start[0]) / span, (end[1] - start[1]) / span)
            break
        travelled += span
    if point is None:
        return {}
    # Left of travel is (-dy, dx); the side the cut is on decides the sign.
    nx, ny = -direction[1] * side, direction[0] * side
    kerb = (point[0] + nx * road / 2.0, point[1] + ny * road / 2.0)
    lon, lat = index.frame.to_lonlat(kerb[0], kerb[1])
    # The kerb of the street this cut belongs to can still land inside a *different* street's
    # carriageway -- which is what put two and a half thousand aprons in the middle of
    # intersections. The road mask is the authority; a cut whose kerb cannot be got clear of
    # the roadway gets no apron at all.
    if road_mask is not None:
        placed = road_mask.clear_of_road(lon, lat)
        if placed is None:
            return {}
        lon, lat = placed
    return {
        "kp": [round(lon, 7), round(lat, 7)],
        "on": round(math.degrees(math.atan2(nx, ny)) % 360, 1),
    }


def _project_fraction(a, b, point) -> float:
    """Where along a wall a point falls, 0 at ``a`` and 1 at ``b``."""
    ax = (b[0] - a[0]) * 88_000.0
    ay = (b[1] - a[1]) * 111_320.0
    length_squared = ax * ax + ay * ay
    if length_squared < 1e-9:
        return 0.5
    px = (point[0] - a[0]) * 88_000.0
    py = (point[1] - a[1]) * 111_320.0
    return max(0.0, min(1.0, (px * ax + py * ay) / length_squared))


def annotate_facades(ways: list[dict[str, Any]]) -> dict[str, Any]:
    """What the photographs said each building's wall looks like: its colour, its fingerprint.

    This lived inside :func:`annotate_official`, which returns early for a region that has no
    San Francisco centreline records -- and reading a colour off a photograph has nothing to do
    with San Francisco's centreline records. So every region outside the city skipped it: the
    633 colours read for Oakland, the 832 for San Jose, the 311 for Berkeley and the 319 for
    Palo Alto sat in files beside pages that drew every wall from its archetype and reported
    ``building_colour: none``. It needs the sampled files and an osm_id, and nothing else.
    """
    colours = load_building_colours(OFFICIAL / "building_colours.json")
    fingerprints_path = OFFICIAL / "facade_fingerprints.json"
    fingerprints = (json.loads(fingerprints_path.read_text()).get("buildings", {})
                    if fingerprints_path.exists() else {})
    if not colours and not fingerprints:
        return {"colours": 0, "fingerprints": 0}

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from smc.facades.match import Fingerprint, closest_render

    counts: Counter = Counter()
    covered_index = 0
    for way in ways:
        if way.get("kind") != "building" or not way.get("covered"):
            continue
        covered_index += 1
        key = str(way.get("osm_id") or "")
        sampled = colours.get(key)
        if sampled:
            way["colour"] = sampled["c"]
            way["colour_views"] = sampled["n"]
            counts["colour from a photograph"] += 1
        fingerprint = fingerprints.get(key)
        if fingerprint:
            match = closest_render(Fingerprint.from_json(fingerprint))
            way["facade"] = match.to_json()
            counts[f"facade matched to {match.material}"] += 1
    counts["colour still invented"] = covered_index - counts["colour from a photograph"]
    reviewed = load_reviewed_colours(ROOT / "data" / "contributed_houses")
    for way in ways:
        colour = reviewed.get(str(way.get("osm_id") or ""))
        if way.get("kind") == "building" and colour:
            way["colour"] = colour["c"]
            way["colour_basis"] = "reviewer_on_contributed_photographs"
            counts["colour from a reviewer"] += 1
    return dict(counts)


def load_reviewed_colours(folder: Path) -> dict[str, dict]:
    """Colours a reviewer gave from the contributed photographs (``reviewed_colours`` in a
    contributed spec), keyed by osm_id. They stand over a sampled colour, which a panorama's
    sky, shade or a tree can tint: 3400 Laguna's sampled blue and green against its orange brick."""
    colours: dict[str, dict] = {}
    for path in sorted(folder.glob("*.json")) if folder.exists() else []:
        spec = json.loads(path.read_text())
        for entry in spec.get("reviewed_colours", []) if isinstance(spec, dict) else []:
            if believable(entry.get("c")):
                for osm_id in entry["buildings"]:
                    colours[str(osm_id)] = entry
    return colours


def annotate_official(ways: list[dict[str, Any]], bbox: dict) -> dict[str, Any]:
    """Hang San Francisco's own recorded geometry on the ways we drew from OpenStreetMap.

    Everything the city publishes is keyed to a CNN, so each way is matched to the centreline
    it runs along and inherits that segment's recorded right of way, its surveyed footway width
    and -- from our own lidar rather than from any record, because no record carries one -- the
    curb height measured on that block.

    The last of those is the point of the exercise. The model used to take one median curb
    height, 126 mm, and build every kerb in San Francisco to it, which threw away nine thousand
    measurements to keep one number. A kerb outside a 1920s apartment block and a kerb at a
    rebuilt corner are not the same height and there was no way to tell from the model.
    """
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    from smc.facades.geometry import LocalFrame
    from smc.facades.match import Fingerprint, closest_render
    from smc.official.join import CentrelineIndex

    segments_path = OFFICIAL / "segments.json"
    centrelines_path = OFFICIAL / "centrelines.json"
    if not (segments_path.exists() and centrelines_path.exists()):
        return {"available": False}

    segments = {row["feature_id"]: row for row in json.loads(segments_path.read_text())}
    # Carriageway measured across the city's own curb lines, and which streets are one-way.
    attributes_path = OFFICIAL / "street_attributes.json"
    attributes = json.loads(attributes_path.read_text()) if attributes_path.exists() else {}
    # The city's inventory of which crossings are continental. Everything else that is marked
    # is two transverse lines, and the model has been painting ladders on all of them.
    crosswalks_path = OFFICIAL / "crosswalks.json"
    crosswalks = json.loads(crosswalks_path.read_text()) if crosswalks_path.exists() else []
    cuts_path = OFFICIAL / "curb_cuts.json"
    curb_cuts = json.loads(cuts_path.read_text()) if cuts_path.exists() else []
    # Colours sampled off photographs of each building, keyed by OpenStreetMap id. They were
    # keyed by the building's index among the covered buildings once, which held only as long
    # as no building was ever added to the map in front of another.
    colours_path = OFFICIAL / "building_colours.json"
    colours = load_building_colours(colours_path)
    # And the facade each photograph showed, matched to the closest render the page has
    # (smc.facades.match): the material and the storey rhythm, kept as the fingerprint so a
    # richer catalogue can be matched against later without looking at the photographs again.
    fingerprints_path = OFFICIAL / "facade_fingerprints.json"
    fingerprints = (json.loads(fingerprints_path.read_text()).get("buildings", {})
                    if fingerprints_path.exists() else {})
    crosswalk_cells: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for crosswalk in crosswalks:
        lon, lat = crosswalk["p"]
        crosswalk_cells[(int(lon * 2000), int(lat * 2000))].append(crosswalk)
    frame = LocalFrame((bbox["south"] + bbox["north"]) / 2.0,
                       (bbox["west"] + bbox["east"]) / 2.0)
    index = CentrelineIndex.from_centrelines(json.loads(centrelines_path.read_text()), frame)

    counts = Counter()
    for way in ways:
        if way.get("kind") not in ("street", "sidewalk", "crossing"):
            continue
        # A service road with no name and no service tag is an access road: the way into a
        # car park, the lane behind a block, the loop in front of a hotel. It has no record of
        # its own in the city's centreline file, so the index matches it to the street it
        # leaves from -- and it then inherited that street's right of way. The entrance to
        # the Walgreens lot off Broadway was drawn 11.85 m wide, nine metres into the lot,
        # with Broadway's footways down each side of it.
        if way.get("highway") == "service" and not way.get("service") and not way.get("name"):
            way["service"] = "access"
            counts["access road"] += 1
            continue
        # A busway is the lanes down the middle of another street (Van Ness's rapid transit):
        # matched to the city's record for that street it took the whole street's kerb-to-kerb
        # width, and was drawn as a third full carriageway over the other two -- its road over
        # their crossings and lane lines, its kerbs across theirs. It is its own lanes' width,
        # with no footway of its own (busway_widths, below, narrows the pieces that run either
        # side of a platform).
        if way.get("highway") == "busway":
            way["busway"] = True
            lanes = max(1, min(2, int(way.get("lanes") or 1)))
            way["road_m"] = round(BUSWAY_LANE_M * lanes, 2)
            way["road_source"] = "busway_lanes"
            way["osm_walk_sides"] = []
            counts["busway"] += 1
            continue
        placed = index.locate_way(way["points"], name=way.get("name") if way["kind"] == "street" else None)
        if placed is None:
            counts["unmatched"] += 1
            continue
        feature, side, distance = placed
        record = segments.get(feature)
        if record is None:
            counts["no record"] += 1
            continue
        way["cnn"] = feature
        way["cnn_name"] = record.get("name") or None
        counts["matched"] += 1

        if record.get("right_of_way_m"):
            way["row_m"] = record["right_of_way_m"]
            counts["with right of way"] += 1
        # The survey records a side where it knows one and "both" otherwise; a footway takes
        # the width for its own side of the street, never the other one's.
        walks = record.get("sidewalk_m") or {}
        width = walks.get(str(side)) or walks.get("0")
        if width:
            way["walk_m"] = width
            counts["with surveyed footway"] += 1
        if record.get("curb_height_m"):
            way["kerb_m"] = record["curb_height_m"]
            way["kerb_n"] = record.get("curb_height_n")
            way["kerb_sigma_m"] = record.get("curb_height_sigma_m")
            counts["with measured curb"] += 1
        if record.get("accepted_on"):
            way["accepted_on"] = record["accepted_on"]

        attribute = attributes.get(feature) or {}
        if attribute.get("oneway"):
            way["oneway"] = attribute["oneway"]
            counts["one-way"] += 1

        # The carriageway, in order of how directly it was measured.
        #
        # First choice is the distance between the city's two mapped curb faces, read every two
        # metres along the street. That is the width itself rather than an inference from it,
        # and it carries the bulb-outs and turning pockets that no single number can.
        #
        # Second choice is the right of way with both footways taken out of it. Where the survey
        # never measured the footway it is taken as a share of the right of way rather than a
        # fixed three metres: on a six-metre alley a fixed three would leave no roadway at all,
        # and clamping the roadway back up would make it wider than the right of way holding it.
        row_m = record.get("right_of_way_m")
        if attribute.get("record_row_m"):
            row_m = attribute["record_row_m"]
        if attribute.get("road_m"):
            way["road_m"] = attribute["road_m"]
            way["road_source"] = "curb_geometry"
            way["road_varies_m"] = round(attribute["road_p90_m"] - attribute["road_p10_m"], 2)
            counts["carriageway from curb lines"] += 1
        elif row_m:
            walk = way.get("walk_m") or min(3.0, row_m * 0.18)
            from_row = round(max(2.5, row_m - 2.0 * walk), 3)
            # A right of way that dwarfs what a street of this class can be has been matched to
            # the wrong street. It is the same fault the kerb envelope already catches for the
            # streets it can check -- Brant Alley carrying a 27.7 m right of way between kerbs
            # 4 m apart, because the centreline index matched it to the avenue it leaves from --
            # and on the streets with no measured kerb there was nothing to catch it: Villa
            # Terrace, a hillside street about eight metres across, took 53.4 m, and 496 ways
            # across three San Francisco districts took a figure more than this much over their
            # own class prior. Every one of them then drew at the 16.5 m cap on an inferred
            # width, which is where the asphalt over the front gardens came from.
            prior = prior_width_m(way)
            if from_row > prior * ROW_PRIOR_MAX_FACTOR:
                way["road_m"] = prior
                way["road_source"] = "class_prior"
                way["road_record_rejected_m"] = from_row
                counts["right of way rejected as another street's"] += 1
            else:
                way["road_m"] = from_row
                way["road_source"] = "row_minus_footways"
                counts["carriageway from right of way"] += 1
            if not way.get("walk_m"):
                way["walk_fallback_m"] = round(walk, 3)

    busway_widths(ways, frame)

    # -- which crossings are continental ----------------------------------------------------
    #
    # One inventory point marks one crossing, so the assignment has to be one to one. Matching
    # every crossing within reach of any point instead marked 2,383 of 2,517 as continental,
    # because a four-armed intersection with one ladder crossing has three other crossings
    # standing twenty metres from the same point.
    crossings = [w for w in ways if w.get("kind") == "crossing" and w.get("points")]
    crossing_cells: dict[tuple[int, int], list[int]] = defaultdict(list)
    for i, way in enumerate(crossings):
        centre = way["points"][len(way["points"]) // 2]
        crossing_cells[(int(centre[0] * 2000), int(centre[1] * 2000))].append(i)

    # Every plausible pairing, then the closest ones first. Walking the inventory in its own
    # order and giving each point its nearest free crossing let an early point take a crossing
    # that a later one was almost on top of, and 623 points ended up matching nothing.
    candidates = []
    for c, crosswalk in enumerate(crosswalks):
        lon, lat = crosswalk["p"]
        key = (int(lon * 2000), int(lat * 2000))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in crossing_cells.get((key[0] + dx, key[1] + dy), ()):
                    centre = crossings[i]["points"][len(crossings[i]["points"]) // 2]
                    metres = math.hypot((centre[0] - lon) * 88_000.0,
                                        (centre[1] - lat) * 111_320.0)
                    if metres <= CROSSWALK_MATCH_M:
                        candidates.append((metres, c, i))
    candidates.sort()
    claimed: set[int] = set()
    used_points: set[int] = set()
    for _metres, c, i in candidates:
        if i in claimed or c in used_points:
            continue
        claimed.add(i)
        used_points.add(c)
        crossings[i]["continental"] = True
        if crosswalks[c].get("year"):
            crossings[i]["crosswalk_year"] = crosswalks[c]["year"]
    counts["crosswalk matched no crossing"] = len(crosswalks) - len(used_points)
    counts["continental crossing"] = len(claimed)

    # An intersection is converted as a whole. SFMTA's inventory records each crossing it has
    # restriped, but the city restripes the legs of a junction together, and a mapped junction
    # with one ladder leg and three plain ones is the inventory being incomplete, not the
    # street. Every crossing standing at the same junction as a claimed one is a ladder too.
    # It keeps its own record of why, so the inventory's claims stay separable from this rule.
    siblings = 0
    for i in list(claimed):
        centre = crossings[i]["points"][len(crossings[i]["points"]) // 2]
        key = (int(centre[0] * 2000), int(centre[1] * 2000))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in crossing_cells.get((key[0] + dx, key[1] + dy), ()):
                    if j in claimed or crossings[j].get("continental"):
                        continue
                    other = crossings[j]["points"][len(crossings[j]["points"]) // 2]
                    metres = math.hypot((other[0] - centre[0]) * 88_000.0,
                                        (other[1] - centre[1]) * 111_320.0)
                    if metres <= CROSSWALK_SIBLING_M:
                        crossings[j]["continental"] = True
                        crossings[j]["continental_source"] = "sibling_at_junction"
                        siblings += 1
    for i in claimed:
        crossings[i]["continental_source"] = "sfmta_inventory"
    counts["continental by junction sibling"] = siblings
    # And the rest are ladders too, by default. The inventory lists what the city has restriped
    # and nothing says a crossing is plain: the 125 left over stand at junctions the inventory
    # has no point near at all -- the Embarcadero's, whose crossings are ladders on the ground.
    # Drawn as two transverse lines, a long one across a diagonal carriageway read as a pair of
    # stray white strokes through the junction. The provenance says it is a default.
    defaulted = 0
    for crossing in crossings:
        if crossing.get("continental"):
            continue
        crossing["continental"] = True
        crossing["continental_source"] = "default_continental"
        defaulted += 1
    counts["continental by default"] = defaulted

    # -- which sides of a street actually have room for a footway ---------------------------
    #
    # A footway derived from the centreline appears on both sides of every roadway, and on a
    # divided street OpenStreetMap draws each direction as its own way -- so the inner footway
    # of one carriageway lands in the middle of the other, and a boulevard came out with a
    # strip of pavement running down it where the centre line should be.
    #
    # A side is dropped when the ground it would occupy is inside some *other* street's
    # carriageway. Nothing else can tell the difference: the two ways are both roads, both
    # legitimate, and only their geometry says one of them is already paved.
    street_grid: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    roadways = [w for w in ways if w.get("kind") == "street" and w.get("points")]
    for way in roadways:
        half = (way.get("road_m") or 8.0) / 2.0
        for lon, lat in way["points"]:
            street_grid[(int(lon * 2500), int(lat * 2500))].append((id(way), lon, lat, half))

    dropped_sides = 0
    for way in roadways:
        half = (way.get("road_m") or 8.0) / 2.0
        walk = way.get("walk_m") or way.get("walk_fallback_m") or 3.0
        offset = half + walk / 2.0
        keep = []
        points = way["points"]
        samples = points[:: max(1, len(points) // 4)] or points
        for side in (1, -1):
            blocked = 0
            for i, (lon, lat) in enumerate(samples):
                nxt = samples[min(i + 1, len(samples) - 1)]
                dx = (nxt[0] - lon) * 88_000.0
                dy = (nxt[1] - lat) * 111_320.0
                length = math.hypot(dx, dy)
                if length < 1e-6:
                    continue
                # A point out on the footway, in degrees.
                px = lon + side * (-dy / length) * offset / (88_000.0)
                py = lat + side * (dx / length) * offset / 111_320.0
                cell = (int(px * 2500), int(py * 2500))
                for ddx in (-1, 0, 1):
                    for ddy in (-1, 0, 1):
                        for other_id, olon, olat, ohalf in street_grid.get(
                                (cell[0] + ddx, cell[1] + ddy), ()):
                            if other_id == id(way):
                                continue
                            metres = math.hypot((olon - px) * 88_000.0,
                                                (olat - py) * 111_320.0)
                            if metres < ohalf + 1.0:
                                blocked += 1
                                break
                        else:
                            continue
                        break
            if blocked * 2 <= len(samples):
                keep.append(side)
            else:
                dropped_sides += 1
        stated = way.get("osm_walk_sides")
        if stated is not None:
            # Somebody surveyed this street. Where they say a side has no footway, believe them
            # over a geometric guess -- and where they say it has one, still drop it if it
            # would land inside another carriageway, because that is a fact about the drawing
            # rather than about the street.
            keep = [side for side in stated if side in keep]
            way["walk_sides"] = keep
        elif len(keep) < 2:
            way["walk_sides"] = keep
    counts["footway sides inside another roadway"] = dropped_sides

    # -- curb cuts, and the garages behind them ----------------------------------------------
    #
    # A dropped kerb exists because something drives across the footway there, and the thing it
    # drives into is the building on the other side. The model has been drawing those buildings
    # with a solid ground floor and an unbroken kerb in front of them.
    #
    # The width is the city's own: a 13 ft cut is one car and a 26 ft cut is a pair of doors,
    # so the opening is sized rather than assumed.
    # Built once and shared: the same authority the ground cover uses.
    from smc.ground.exclusion import RoadMask
    road_mask = RoadMask(ways, bbox)

    walls_index: dict[tuple[int, int], list[tuple]] = defaultdict(list)
    for way_index, way in enumerate(ways):
        if way.get("kind") != "building" or not way.get("covered"):
            continue
        points = way["points"]
        for i in range(len(points) - 1):
            a, b = points[i], points[i + 1]
            mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            walls_index[(int(mid[0] * 3000), int(mid[1] * 3000))].append((way_index, a, b, mid))

    garages = 0
    unmatched_cuts = 0
    for cut in curb_cuts:
        points = cut["p"]
        centre = points[len(points) // 2]
        key = (int(centre[0] * 3000), int(centre[1] * 3000))
        needed = cut.get("m") or 3.5
        best = roomy = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for candidate in walls_index.get((key[0] + dx, key[1] + dy), ()):
                    _way_index, a, b, mid = candidate
                    metres = math.hypot((mid[0] - centre[0]) * 88_000.0,
                                        (mid[1] - centre[1]) * 111_320.0)
                    if metres > GARAGE_REACH_M:
                        continue
                    if best is None or metres < best[0]:
                        best = (metres, candidate)
                    # A frontage wide enough to hold the opening. Taking the nearest wall alone
                    # put doors on chamfered corners two metres long, which then clamped the
                    # opening down to something narrower than the kerb the city cut for it.
                    length = math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
                    if length >= max(2.5, needed * 0.9) and (roomy is None or metres < roomy[0]):
                        roomy = (metres, candidate)
        chosen = roomy or best
        if chosen is None:
            unmatched_cuts += 1
            continue
        _metres, (way_index, a, b, mid) = chosen
        way = ways[way_index]
        # Placed at the point of the wall nearest the cut, and no wider than the wall it is in --
        # or than a door. The city's record is the length of the dropped kerb, and 321 of them
        # run past twelve metres: a loading apron, a whole frontage, two lots' driveways in one
        # record. Drawn as one door that was a twenty-metre red door on a house, and a pavement
        # let down for twenty metres. The door is a door; the cut's own length is kept beside it.
        length = math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
        width = min(needed, max(2.0, length * 0.9), GARAGE_DOOR_MAX_M)
        way.setdefault("garages", []).append({
            "a": [round(a[0], 7), round(a[1], 7)],
            "b": [round(b[0], 7), round(b[1], 7)],
            "t": round(_project_fraction(a, b, centre), 4),
            "w": round(width, 2),
            "cut_m": round(needed, 2),
            "n": round(_outward_bearing(way["points"], a, b), 1),
            # Where the kerb was actually cut, so the apron can be laid between there and the
            # door rather than guessed at from the door alone.
            "cp": [round(centre[0], 7), round(centre[1], 7)],
            # A seed so a building keeps the same door between reloads, and two garages on one
            # building do not both get the same one.
            "s": (way_index * 31 + int(centre[0] * 1e5)) % 100000,
            # How wide the footway is here, so the apron stops at the property line.
            "walk": round(float((attributes.get(feature) or {}).get("record_sidewalk_m")
                                or (record.get("sidewalk_m") or {}).get("0") or 3.0), 2),
            # Where the kerb is, and which way is away from the road, measured on the street
            # the cut belongs to. Aiming the apron at the building instead let it set off
            # across the carriageway whenever the matched wall sat at an angle to the kerb.
            **_apron_anchor(index, segments, attributes, centre, road_mask),
        })
        garages += 1
    counts["garage openings"] = garages
    counts["curb cuts with no building"] = unmatched_cuts

    return {"available": True, "counts": dict(counts),
            "segments": len(segments),
            "curb_measured_segments": sum(1 for a in attributes.values() if "road_m" in a),
            "distinct_curb_heights": len({w["kerb_m"] for w in ways if w.get("kerb_m")})}


HTML = page_template()


#: Every field the page reads off a way. Anything else in the payload is being downloaded and
#: parsed by every visitor for nothing.
#:
#: The payload had grown to 33 MB, 26.6 of it buildings, and the largest single field in it was
#: `datasf_building_height` at 4.4 MB -- a provenance record the renderer never opens. Parsing
#: thirty-three megabytes of JSON is several seconds of blocked main thread before a frame is
#: drawn, and it is the largest part of what the map feels like when it is slow.
#:
#: Nothing is lost: this trims the *rendering*, and every field stripped here is still in the
#: enrichment tables the page was built from. tests/test_payload_is_only_what_is_drawn.py reads
#: this list back out of the renderer's own source, so a field that starts being used cannot be
#: silently stripped.
PAGE_FIELDS = {
    "crossing_type", "crossing_markings", "crossing_style_group",
    "resolved_crossing_marking", "marking_provenance", "marking_confidence",
    "continental_source",
    "service",
    "tunnel_kind", "tunnel_length_m",
    "tunnel_portal", "tunnel_mouths", "tunnel_cover", "tunnel_design", "tunnel_mouth_low_cover_m", "tunnel_road_z",
    "tunnel_approach", "tunnel_approach_road_z", "parking_sides", "xs", "xs_junction",
    "kerb_source", "height_points",
    "capacity",
  "surface",
    "path_surface", "path_runs",
    "material",
    "wall",
    "bridge",
    "layer",
    "tunnel",
    "address", "alley_mouth", "archetype", "centroid", "colour", "continental", "covered", "facade",
    "crossing_m", "cycleway", "cycleway_both", "cycleway_left", "cycleway_right",
    "divider_source", "divider_surface", "divider_width_m", "garages",
    "google_places", "height_m", "height_osm_m", "height_source", "kerb_m", "kind", "land_use", "lanes",
    "lanes_back", "lanes_fwd", "name", "oneway", "osm_id", "osm_oneway", "parcel", "place",
    "points", "road_m", "road_source", "sources", "tags", "turn", "turn_back", "turn_fwd", "busway",
    "shops", "track_m", "walk_fallback_m", "walk_m", "walk_sides", "zoning", "coastline_band", "underground",
}

#: The parts of the nested records the page opens. A parcel record carries six fields and the
#: page shows two of them.
PAGE_SUBFIELDS = {
    "parcel": {"blklot", "analysis_neighborhood"},
    "address": {"formatted", "house_number", "street"},
    "zoning": {"district"},
    "tags": {"building"},
}

DETAIL_SCHEMA_VERSION = 1
DETAIL_MANIFEST_NAME = "sf-corridor-detail-manifest.json"
DETAIL_SHARD_NAMES = {
    "west": "sf-corridor-detail-west.json",
    "east": "sf-corridor-detail-east.json",
}


def _detail_key(way: dict[str, Any], render_index: int | None = None) -> str:
    """Return the same feature key used by the browser detail loader.

    OSM numeric identifiers are only unique within their element type, and this render also
    contains split and synthetic features.  The payload index is the one genuinely unique key
    shared by the render JSON and its lossless detail archive.
    """

    if render_index is not None:
        return f"way:{render_index}"

    kind = str(way.get("kind") or "feature")
    osm_id = way.get("osm_id")
    if osm_id not in (None, ""):
        return f"{kind}:osm:{osm_id}"
    point = way.get("centroid") or way.get("point")
    if not point:
        points = way.get("points") or []
        point = points[0] if points else [0, 0]
    lon = round(float(point[0]), PRECISION) if len(point) >= 2 else 0
    lat = round(float(point[1]), PRECISION) if len(point) >= 2 else 0
    return f"{kind}:at:{lon}:{lat}:{way.get('name') or ''}"


def _detail_lon(way: dict[str, Any], fallback: float) -> float:
    point = way.get("centroid") or way.get("point")
    if point and len(point) >= 2:
        return float(point[0])
    points = way.get("points") or []
    if points:
        return sum(float(point[0]) for point in points) / len(points)
    return fallback


def _omitted_way_fields(way: dict[str, Any]) -> dict[str, Any]:
    """Fields removed from the render payload, including trimmed nested fields."""

    extra = {field: value for field, value in way.items() if field not in PAGE_FIELDS}
    for field, keep in PAGE_SUBFIELDS.items():
        value = way.get(field)
        if not isinstance(value, dict):
            continue
        omitted = {inner: inner_value for inner, inner_value in value.items() if inner not in keep}
        if omitted:
            extra[field] = omitted
    return extra


def write_detail_shards(payload: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    """Write the lossless part of the catalogue as two spatial, on-demand shards.

    The global render payload remains small and immediately usable.  These shards restore every
    field that :func:`slim_payload` removes, keyed without duplicating geometry, so inspecting a
    feature in the browser or downloading the PWA offline pack reconstructs its full record.
    """

    bbox = payload.get("bbox") or {}
    west = float(bbox.get("west", REGION.bbox.west))
    east = float(bbox.get("east", REGION.bbox.east))
    south = float(bbox.get("south", REGION.bbox.south))
    north = float(bbox.get("north", REGION.bbox.north))
    split_lon = (west + east) / 2
    rows: dict[str, list[dict[str, Any]]] = {"west": [], "east": []}
    collisions: set[str] = set()
    seen: set[str] = set()

    for render_index, way in enumerate(payload.get("ways", [])):
        fields = _omitted_way_fields(way)
        if not fields:
            continue
        key = _detail_key(way, render_index)
        if key in seen:
            collisions.add(key)
        seen.add(key)
        shard = "west" if _detail_lon(way, split_lon) < split_lon else "east"
        rows[shard].append({"key": key, "fields": fields})

    if collisions:
        sample = ", ".join(sorted(collisions)[:3])
        raise ValueError(f"detail feature keys must be unique; collisions: {sample}")

    out_dir.mkdir(parents=True, exist_ok=True)
    shard_meta = []
    for shard in ("west", "east"):
        shard_bbox = {
            "west": west if shard == "west" else split_lon,
            "south": south,
            "east": split_lon if shard == "west" else east,
            "north": north,
        }
        body = {
            "schema_version": DETAIL_SCHEMA_VERSION,
            "id": shard,
            "bbox": shard_bbox,
            "features": rows[shard],
        }
        encoded = json.dumps(body, separators=(",", ":"), default=str).encode("utf-8")
        filename = DETAIL_SHARD_NAMES[shard]
        (out_dir / filename).write_bytes(encoded)
        shard_meta.append({
            "id": shard,
            "file": filename,
            "bbox": shard_bbox,
            "features": len(rows[shard]),
            "bytes": len(encoded),
            "sha256": hashlib.sha256(encoded).hexdigest(),
        })

    facade_assets = sorted({
        f"facades/{wall['c']}/{wall['t']}"
        for wall in (payload.get("facades") or {}).get("walls", [])
        if wall.get("c") and wall.get("t")
    })
    core_assets = [
        "sf-corridor-3d.html",
        "sf-corridor-3d.json",
        DETAIL_MANIFEST_NAME,
        *DETAIL_SHARD_NAMES.values(),
        "sf-corridor-official.json",
        "sf-corridor-ground.json",
        "sf-corridor-furniture.json",
        "sf-corridor-chunks.json",
        "sf-corridor-priority.json",
        # The ground itself: without these the installed app's world is flat when offline.
        "sf-corridor-terrain.json",
        "sf-corridor-terrain.bin",
    ]
    manifest = {
        "schema_version": DETAIL_SCHEMA_VERSION,
        "key_strategy": "render_index",
        "strategy": "render-complete base plus two lossless on-demand archive shards",
        "base": "sf-corridor-3d.json",
        "split_lon": split_lon,
        "ways": len(payload.get("ways", [])),
        "detail_features": sum(len(items) for items in rows.values()),
        "shards": shard_meta,
        "offline_assets": core_assets + facade_assets,
        "accuracy": {
            "geometry_changed_by_slimming": False,
            "coordinate_decimals": PRECISION,
            "note": "Archive shards restore provenance and source attributes; render geometry is identical to the base payload.",
        },
    }
    manifest_path = out_dir / DETAIL_MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    return manifest


def slim_payload(payload: dict) -> dict[str, int]:
    """Drop everything the page does not draw, and report what went.

    The catalogue is the archive; the payload is a rendering of it. Shipping the archive to
    every browser that opens the map costs a second of parse per visitor and buys nothing.
    """
    dropped: dict[str, int] = {}

    def note(field: str, size: int) -> None:
        dropped[field] = dropped.get(field, 0) + size

    for way in payload.get("ways", []):
        for field in [k for k in way if k not in PAGE_FIELDS]:
            note(field, len(json.dumps(way[field], separators=(",", ":"), default=str)))
            del way[field]
        for field, keep in PAGE_SUBFIELDS.items():
            value = way.get(field)
            if not isinstance(value, dict):
                continue
            for inner in [k for k in value if k not in keep]:
                note(f"{field}.{inner}",
                     len(json.dumps(value[inner], separators=(",", ":"), default=str)))
                del value[inner]
            if not value:
                del way[field]
    return dropped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default=SF_CORRIDOR.name,
                        help="a region from data/regions/regions.json; the corridor by default")
    parser.add_argument("--catalog", type=Path, default=None,
                        help="the observation catalogue; default data/sf_corridor for the corridor, "
                             "data/regions/<name>/catalog otherwise")
    parser.add_argument("--out", type=Path, default=None,
                        help="the page; default docs/sf-corridor-3d.html for the corridor, "
                             "data/regions/<name>/site/sf-corridor-3d.html otherwise")
    parser.add_argument("--official-dir", type=Path, default=None,
                        help="the municipal records; default data/sf_public_works for the corridor, "
                             "data/regions/<name>/official otherwise")
    parser.add_argument("--osm-cache", type=Path, default=None)
    parser.add_argument("--reuse-osm", action="store_true")
    parser.add_argument("--refresh-kerb-nodes", action="store_true",
                        help="refresh a separate OSM curb-ramp node supplement, preserving the lidar street cache")
    parser.add_argument("--detail", choices=("site", "app"), default="site",
                        help="how finely the ground is cut. 'site' is sized for a browser tab "
                             "over the network; 'app' is the downloaded mirror, which has the "
                             "whole file on disk and no page-weight budget to keep to, and is "
                             "cut as finely as the terrain grid can justify.")
    parser.add_argument("--page-only", action="store_true",
                        help="regenerate the SF viewer HTML without rebuilding its published data")
    parser.add_argument("--allow-incomplete", action="store_true",
                        help="permit a deliberately incomplete SF build for local experiments")
    args = parser.parse_args()
    region = get_region(args.region)
    corridor = region.name == SF_CORRIDOR.name
    if args.catalog is None:
        args.catalog = Path("data/sf_corridor") if corridor else ROOT / "data" / "regions" / region.name / "catalog"
    if args.out is None:
        args.out = (Path("docs/sf-corridor-3d.html") if corridor
                    else ROOT / "data" / "regions" / region.name / "site" / "sf-corridor-3d.html")
    if args.osm_cache is None:
        args.osm_cache = (Path("data/sf_corridor/stats/osm_ways.json") if corridor
                          else ROOT / "data" / "regions" / region.name / "osm_ways.json")
    if args.page_only:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(tuned(HTML, args.detail), encoding="utf-8")
        print(f"{args.out} -> {args.out.stat().st_size / 1e3:.1f} kB viewer only")
        return 0
    if corridor and args.allow_incomplete and args.out.resolve() == (ROOT / "docs/sf-corridor-3d.html").resolve():
        parser.error("--allow-incomplete requires --out outside the published docs/sf-corridor-3d.html")
    if corridor and not args.allow_incomplete:
        missing_sources = []
        if not any((args.catalog / "observations").glob("*.parquet")):
            missing_sources.append(f"merged observation catalogue: {args.catalog / 'observations'}")
        official_source = args.official_dir or ROOT / "data" / "sf_public_works"
        if not (official_source / "parking_bands.json").is_file():
            missing_sources.append(f"curb-policy bands: {official_source / 'parking_bands.json'}")
        if missing_sources:
            parser.error("refusing to replace the complete SF map with an incomplete build; "
                         + "; ".join(missing_sources)
                         + ". Use --allow-incomplete only for a separate experimental output.")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    configure_region(region, args.out, args.official_dir)

    if args.reuse_osm and args.osm_cache.exists():
        ways = reclassify(json.loads(args.osm_cache.read_text(encoding="utf-8")))
        # The cache holds coastline bands that were already offset to one side, so which side
        # cannot be re-derived from them. What can still be checked is the result, and the same
        # rule applies: a bay with houses in it is not a bay.
        ways = drop_water_over_land(ways)
    else:
        ways = fetch_osm(REGION.bbox)
        args.osm_cache.parent.mkdir(parents=True, exist_ok=True)
        args.osm_cache.write_text(json.dumps(ways, indent=2) + "\n", encoding="utf-8")
    if not corridor:
        supplement = args.official_dir or ROOT / "data" / "regions" / region.name / "official"
        ramp_path = supplement / "osm_kerb_nodes.json"
        if args.refresh_kerb_nodes:
            ramps = fetch_osm_kerb_nodes(REGION.bbox)
            ramp_path.parent.mkdir(parents=True, exist_ok=True)
            ramp_path.write_text(json.dumps({"source": "OpenStreetMap via Overpass",
                                             "bbox": [REGION.bbox.south, REGION.bbox.west,
                                                      REGION.bbox.north, REGION.bbox.east],
                                             "ramps": ramps}, separators=(",", ":")) + "\n",
                                 encoding="utf-8")
        if ramp_path.exists():
            supplement_data = json.loads(ramp_path.read_text(encoding="utf-8"))
            if supplement_data.get("bbox") != [REGION.bbox.south, REGION.bbox.west,
                                                REGION.bbox.north, REGION.bbox.east]:
                raise SystemExit(f"{ramp_path} bbox differs from {region.name}; refresh kerb nodes")
            seen_ramps = {way.get("osm_id") for way in ways if way.get("kind") == "curb_ramp"}
            ways.extend(ramp for ramp in supplement_data.get("ramps", [])
                        if ramp.get("osm_id") not in seen_ramps)

    # Businesses are points; shopfronts belong to buildings. This is where the two meet, and it
    # runs before the payload is assembled so the archetype work can see the result.
    shopfronts = attach_shopfronts(ways)
    print(f"  shopfronts attached to buildings: {shopfronts}", file=sys.stderr)

    payload = build_payload(args.catalog, ways)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # Data beside the page rather than inside it. The page is then a few kilobytes that rarely
    # change, and the payload is one file the browser caches -- where inlining rewrote ten
    # megabytes of undedupable HTML into the repository on every single build.
    data_path = args.out.with_suffix(".json")
    detail_manifest = write_detail_shards(payload, args.out.parent)
    dropped = slim_payload(payload)
    if dropped:
        total = sum(dropped.values())
        top = sorted(dropped.items(), key=lambda kv: -kv[1])[:6]
        print(f"payload slimmed by {total / 1e6:.2f} MB: "
              + ", ".join(f"{name} {size / 1e6:.2f}" for name, size in top))
    print("full detail shards: " + ", ".join(
        f"{shard['id']} {shard['bytes'] / 1e6:.2f} MB"
        for shard in detail_manifest["shards"]
    ))
    # The terrain's own accuracy travels in the summary, and the capability record is then
    # written from what this build actually stood on (smc.regions.activation): available,
    # implemented, active, with counts.
    terrain_meta = SITE_DIR / "sf-corridor-terrain.json"
    terrain_bin = SITE_DIR / "sf-corridor-terrain.bin"
    if terrain_bin.exists() and terrain_meta.exists():
        # The map's water polygons say where the grid is water; the grid says how high the
        # water stands (smc.terrain.waterline). Idempotent, so a rebuild changes nothing more.
        from smc.terrain.waterline import apply_waterline
        closed_water = [w["points"] for w in payload["ways"] if w.get("kind") == "water"
                        and len(w.get("points") or []) >= 4 and w["points"][0] == w["points"][-1]
                        and not w.get("coastline_band")]
        coastlines = [w["points"] for w in payload["ways"] if w.get("kind") == "coastline" and len(w.get("points") or []) >= 2]
        # The buildings tell a flooded bay from a flooded town: a body of "water" with forty of
        # them in it is where the flood leaked, and is dropped.
        centroids = [w["centroid"] for w in payload["ways"] if w.get("kind") == "building" and w.get("centroid")]
        payload["summary"]["waterline"] = apply_waterline(terrain_bin, closed_water, coastlines, centroids)
        print(f"waterline: {payload['summary']['waterline']}")

    if terrain_meta.exists():
        meta = json.loads(terrain_meta.read_text())
        acc = meta.get("accuracy", {})
        payload["summary"]["terrain"] = {
            "source": meta.get("source"), "cells_with_ground": meta.get("cells_with_ground"),
            "roadway_rmse_m": (acc.get("roadway") or {}).get("rmse_m"),
            "all_rmse_m": (acc.get("all") or {}).get("rmse_m"),
        }
    data_path.write_text(json.dumps(payload, separators=(",", ":"), default=str), encoding="utf-8")
    record_activation(payload)
    # The country round the map -- land, water and the bridges, five miles out from every
    # region -- is one file shared by every page (scripts/build_perimeter.py), built after the
    # regions since it floods from their grids; a build that has one keeps it.
    # The page is the same for every region; only its name differs.
    page = HTML
    if region.name != SF_CORRIDOR.name:
        title = (region.description or region.name).split(":")[0]
        page = page.replace("Kerbside SF Corridor 3D", f"Kerbside {title} 3D")
        # The search hint names two San Francisco corners; a region's page suggests its own.
        streets = sorted({w.get("name") for w in ways if w.get("kind") == "street" and w.get("name")})
        hint = " &amp; ".join(streets[:2]) if len(streets) >= 2 else "a corner or an address"
        page = page.replace('placeholder="Columbus &amp; Broadway, or 600 Montgomery"', f'placeholder="{hint}, or an address"', 1)
    args.out.write_text(page, encoding="utf-8")
    print(f"{args.out} -> {args.out.stat().st_size / 1e3:.1f} kB page")
    print(f"{data_path} -> {data_path.stat().st_size / 1e6:.2f} MB payload")
    print(json.dumps(payload["summary"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
