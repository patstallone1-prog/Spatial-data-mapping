"""Cross-sections for every street way, from the city's kerb lines and what is known of the
space between them.

This is the producer for :mod:`smc.facts.cross_section`. For each street way it lays a
station every ``STATION_M`` metres, finds the city centreline segment the way belongs to and
reads the two kerb offsets there from the curb-line profile (``curb_profiles_corridor.json``,
the same reading the page's kerb envelope is made from), turns them into offsets from the
way's own line, places the bands that are known -- parking from the city's parking policies,
bike lanes from the map, with the arrangement each implies -- and hands the rest to
:func:`smc.facts.cross_section.allocate`. The stations are then fitted along the way and the
lane ends checked across every junction.

What comes out is written onto each way as ``xs`` (a list of stations) for the page to draw
from, and summarised for the audit. A way with no kerb reading at a station gets the kerbs
its recorded width implies, graded ``mapped`` or ``inferred`` so nothing downstream mistakes
that for a measurement.
"""

from __future__ import annotations

import itertools
import math
from collections import Counter
from typing import Any

from smc.facades.geometry import LocalFrame
from smc.facts.clearance import BuildingClearance
from smc.facts.cross_section import (
    PRIORS,
    STATION_M,
    Band,
    Kind,
    LaneEnd,
    SourceGrade,
    Station,
    allocate,
    fit_longitudinal,
    lane_ends,
    match_junction,
)
from smc.official.join import CentrelineIndex

#: A parallel parking lane where the city's policies say cars park and nothing has measured
#: the band: the regional prior, with the sigma of a prior.
PARKING_PRIOR_M = 2.3
PARKING_PRIOR_SIGMA_M = 0.3
#: A class II bike lane from the map, and the buffer of a buffered or parking-protected one.
BIKE_LANE_M = 1.7
BIKE_BUFFER_M = 0.9
#: The curb profile is read this far either side of a station before giving up on it.
PROFILE_WINDOW_M = 6.0
#: A kerb reading that puts the way outside its own carriageway is a wrong match, not a
#: measurement: the way and the segment are different streets.
MIN_HALF_M = 1.2


def _bearing(a: list[float], b: list[float]) -> tuple[float, float]:
    east = (b[0] - a[0]) * 88_000.0
    north = (b[1] - a[1]) * 111_320.0
    length = math.hypot(east, north) or 1.0
    return east / length, north / length


def _stations_along(points: list[list[float]], step_m: float) -> list[tuple[float, float, float, tuple[float, float]]]:
    """``(s, lon, lat, (ux, uy))`` every ``step_m`` along a lon/lat polyline."""
    out = []
    acc = 0.0
    next_s = step_m / 2.0
    for a, b in itertools.pairwise(points):
        seg = math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
        if seg <= 0:
            continue
        u = _bearing(a, b)
        while next_s <= acc + seg:
            t = (next_s - acc) / seg
            out.append((next_s, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, u))
            next_s += step_m
        acc += seg
    return out


def _profile_at(profile: dict | None, station_m: float,
                one_sided: bool = False) -> tuple[float | None, float | None] | None:
    """The kerb offsets nearest a station. The city's profile has both kerbs at every
    sample; a lidar profile may have one, and with ``one_sided`` that one is returned with
    None for the other, the caller taking the other side from the mapped width."""
    if not profile:
        return None
    best, best_gap = None, PROFILE_WINDOW_M + 1
    for sample in profile.get("samples", ()):
        l_off, r_off = sample.get("l"), sample.get("r")
        if l_off is None and r_off is None:
            continue
        if (l_off is None or r_off is None) and not one_sided:
            continue
        gap = abs(sample["s"] - station_m)
        # A sample with both kerbs beats a one-sided one at the same distance.
        if gap < best_gap or (gap == best_gap and best is not None and None in best):
            best, best_gap = (None if l_off is None else float(l_off), None if r_off is None else float(r_off)), gap
    return best if best_gap <= PROFILE_WINDOW_M else None


def _cycleway_sides(way: dict) -> dict[int, str]:
    """``{side: tag}`` for the sides with a bike lane; +1 left of travel, -1 right."""
    def is_lane(value: Any) -> bool:
        if not value:
            return False
        text = str(value).lower()
        if "no" in text or "none" in text or "shared_lane" in text:
            return False
        return "lane" in text or "track" in text or "opposite" in text

    sides: dict[int, str] = {}
    if is_lane(way.get("cycleway_both")):
        sides[1] = sides[-1] = str(way["cycleway_both"])
    if is_lane(way.get("cycleway_left")):
        sides[1] = str(way["cycleway_left"])
    if is_lane(way.get("cycleway_right")):
        sides[-1] = str(way["cycleway_right"])
    if not sides and is_lane(way.get("cycleway")):
        if way.get("oneway") or way.get("osm_oneway"):
            sides[-1] = str(way["cycleway"])
        else:
            sides[1] = sides[-1] = str(way["cycleway"])
    return sides


def parking_band_for_side(way: dict, side: int, measured: dict | None) -> Band | None:
    """The parking band on one side: measured from parked cars where the imagery has been
    read (smc.measure.parking_band), else the policy's prior, else none."""
    key = f"{way.get('cnn') or ''}:{side}"
    band = (measured or {}).get(key)
    if band and band.get("status") == "measured" and band.get("width_m"):
        return Band(Kind.PARKING, float(band["width_m"]), SourceGrade.IMAGE, 0.9,
                    sigma_m=float(band.get("sigma_m") or 0.1),
                    source=f"parked cars: {band.get('vehicles', 0)} over {band.get('dates', 0)} dates",
                    subtype=band.get("subtype") or "parallel")
    if band and band.get("status") == "none":
        return None
    if side in (way.get("parking_sides") or []):
        return Band(Kind.PARKING, PARKING_PRIOR_M, SourceGrade.INFERRED, 0.5,
                    sigma_m=PARKING_PRIOR_SIGMA_M, source="sfmta parking policy", subtype="parallel")
    return None


#: A carriageway width from the map alone, for a way with no kerb reading and no recorded
#: width: the map's lane count (or the class's usual one) at the travel prior, plus a parking
#: band each side where the class usually has one. Graded inferred; it is a prior.
CLASS_LANES = {"motorway": 3, "trunk": 2, "primary": 2, "secondary": 2, "tertiary": 2,
               "residential": 2, "unclassified": 2, "living_street": 1, "service": 1}
CLASS_PARKING_SIDES = {"primary": 1, "secondary": 2, "tertiary": 2, "residential": 2, "unclassified": 2,
                       "living_street": 1}


def prior_width_m(way: dict) -> float:
    highway = str(way.get("highway") or "residential")
    lanes = way.get("lanes") or CLASS_LANES.get(highway, 2)
    try:
        lanes = max(1, int(lanes))
    except (TypeError, ValueError):
        lanes = CLASS_LANES.get(highway, 2)
    if way.get("oneway") or way.get("osm_oneway"):
        lanes = max(1, lanes)
    width = lanes * PRIORS[Kind.TRAVEL][1]
    if not way.get("parking_sides"):
        width += CLASS_PARKING_SIDES.get(highway, 0) * PARKING_PRIOR_M
    return round(width, 2)


def fixed_bands_for_side(way: dict, side: int, measured_parking: dict | None = None) -> list[Band]:
    """The bands from one kerb inward that are known before any lane is placed."""
    bands: list[Band] = []
    parking = parking_band_for_side(way, side, measured_parking)
    cycle = _cycleway_sides(way).get(side)
    if cycle:
        track = "track" in cycle.lower()
        bike = Band(Kind.BIKE, BIKE_LANE_M, SourceGrade.MAPPED, 0.75, sigma_m=0.25,
                    source=f"osm cycleway={cycle}", subtype="track" if track else "lane")
        if parking and track:
            # A parking-protected track: kerb -> bike -> buffer -> parked cars -> traffic.
            bands += [bike, Band(Kind.BUFFER, BIKE_BUFFER_M, SourceGrade.INFERRED, 0.5), parking]
        elif parking:
            # A lane beside the parked cars: kerb -> parking -> bike -> traffic.
            bands += [parking, bike]
        else:
            bands.append(bike)
    elif parking:
        bands.append(parking)
    return bands


def build_cross_sections(
    ways: list[dict[str, Any]],
    centrelines: list[dict],
    profiles: dict[str, dict],
    *,
    frame: LocalFrame,
    step_m: float = STATION_M,
    measured_parking: dict | None = None,
    profile_grade: SourceGrade = SourceGrade.SURVEY,
) -> dict[str, int]:
    """Attach ``xs`` to every street way; return counts for the build summary.

    ``measured_parking`` maps ``"<cnn>:<side>"`` to a parking band measured from imagery
    (data/sf_public_works/parking_bands.json); a face without one takes the policy's prior.
    """
    index = CentrelineIndex.from_centrelines(centrelines, frame)
    clearance = BuildingClearance(ways, frame)
    counts: Counter[str] = Counter()
    ends_by_node: dict[tuple[float, float], list[tuple[str, LaneEnd]]] = {}

    for way in ways:
        if way.get("kind") != "street" or len(way.get("points") or []) < 2:
            continue
        if way.get("tunnel_kind") in ("underground",) or way.get("service") in ("driveway", "parking_aisle", "drive-through"):
            continue
        points = way["points"]
        oneway = bool(way.get("oneway") or way.get("osm_oneway"))
        named = bool(way.get("name"))
        road_m = float(way.get("road_m") or 0.0)
        width_is_prior = False
        if road_m <= 0:
            road_m = prior_width_m(way)
            width_is_prior = True
        profile = profiles.get(way.get("cnn") or "")
        stations: list[Station] = []
        for s_m, lon, lat, (ux, uy) in _stations_along(points, step_m):
            left = right = None
            grade = SourceGrade.INFERRED
            one_sided_here = False
            found = index.locate_full(lon, lat)
            if found is not None and profile is not None:
                feature, c_station, side, distance = found
                if feature == way.get("cnn"):
                    lidar = profile_grade is SourceGrade.LIDAR
                    reading = _profile_at(profile, c_station, one_sided=lidar)
                    if reading is not None:
                        l_off, r_off = reading
                        d = side * distance
                        # Does the way run with the city's segment or against it?
                        ahead = index.locate_full(lon + ux * 2.0 / 88_000.0, lat + uy * 2.0 / 111_320.0)
                        same = ahead is None or ahead[0] != feature or ahead[1] >= c_station
                        if not same:
                            l_off, r_off, d = r_off, l_off, -d
                        # A side the lidar did not read takes the mapped half width, and the
                        # station keeps the lidar grade with the reason recorded.
                        half = (road_m or prior_width_m(way)) / 2.0
                        one_side = l_off is None or r_off is None
                        left = (half if l_off is None else l_off) - d
                        right = -((half if r_off is None else r_off) + d)
                        if left < MIN_HALF_M or -right < MIN_HALF_M:
                            left = right = None   # the way is not between these kerbs
                        else:
                            grade = profile_grade
                            if one_side:
                                one_sided_here = True
            walled = False
            if left is None:
                left, right = road_m / 2.0, -road_m / 2.0
                grade = SourceGrade.MAPPED if (way.get("road_source") in ("curb_geometry", "official_curbs")
                                               and not width_is_prior) else SourceGrade.INFERRED
                if width_is_prior:
                    # A prior may not run under a building: bounded by the walls either side.
                    left, right_abs, walled = clearance.half_widths(lon, lat, ux, uy, road_m / 2.0, MIN_HALF_M)
                    right = -right_abs
                    if walled:
                        counts["stations bounded by a building wall"] += 1
            st = Station(s_m, lon, lat, left, right, grade)
            bands, status, reasons, score = allocate(
                st.width_m, fixed_bands_for_side(way, 1, measured_parking),
                fixed_bands_for_side(way, -1, measured_parking),
                oneway=oneway, lanes_tag=way.get("lanes"), lanes_forward_tag=way.get("lanes_fwd"),
                lanes_backward_tag=way.get("lanes_back"), named=named, left_kerb_m=left)
            if one_sided_here:
                reasons = [*reasons, "kerb_one_side"]
            if walled:
                reasons = [*reasons, "walled"]
            st.bands, st.status, st.reasons, st.score = bands, status, reasons, score
            stations.append(st)
        if not stations:
            counts["ways with no stations"] += 1
            continue
        if not way.get("road_m"):
            # The way had no recorded width, so what the stations found is its width: the
            # renderer drew such a way at eight metres whatever its kerbs said -- Grenard
            # Terrace, whose kerbs the city's profile puts 6.9 m apart, was an eight-metre
            # road under two houses. The median over the way, so one open station at an
            # alley's mouth does not widen the whole alley; the source says which rung it is.
            widths = sorted(st.width_m for st in stations)
            way["road_m"] = round(widths[len(widths) // 2], 2)
            grades = {st.kerb_grade for st in stations}
            if SourceGrade.SURVEY in grades:
                way["road_source"] = "curb_profile"
            elif SourceGrade.LIDAR in grades:
                way["road_source"] = "lidar_profile"
            elif any("walled" in st.reasons for st in stations):
                way["road_source"] = "building_walls"
                counts["ways narrowed to the room between buildings"] += 1
            else:
                way["road_source"] = "class_prior"
            counts[f"ways widthed from stations ({way['road_source']})"] += 1
        counts["steps flagged"] += fit_longitudinal(stations)
        for st in stations:
            counts[f"stations {st.status}"] += 1
            counts[f"kerbs {st.kerb_grade.value}"] += 1
            for b in st.bands:
                if b.kind is Kind.PARKING:
                    counts[f"parking bands {b.grade.value}"] += 1
        way["xs"] = [st.to_json() for st in stations]
        for end in lane_ends(stations, way.get("turn") or way.get("turn_fwd")):
            node = points[0] if end.end == "start" else points[-1]
            key = (round(node[0], 5), round(node[1], 5))
            ends_by_node.setdefault(key, []).append((way.get("name") or "", end))
        counts["ways with cross-sections"] += 1

    # Junctions: every node where two or more way ends meet.
    notes = 0
    for key, ends in ends_by_node.items():
        if len(ends) < 2:
            continue
        reasons = match_junction(ends)
        if reasons:
            notes += 1
            for way in ways:
                pts = way.get("points") or []
                if not pts or "xs" not in way:
                    continue
                for node, label in ((pts[0], "start"), (pts[-1], "end")):
                    if (round(node[0], 5), round(node[1], 5)) == key:
                        way.setdefault("xs_junction", {})[label] = reasons
    counts["junctions with a lane count that does not carry through"] = notes
    return dict(counts)
