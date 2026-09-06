"""Published rows into official geometry facts.

Most of this file is about refusing to be clever. The city's tables are unusually explicit
about what their columns mean, and the failures available here are all failures of reading:
taking a policy minimum for a measured width, taking a sentinel for a number, taking a foot for
a metre, or taking a street's two sides to be the same because one column said "Both".
"""

from __future__ import annotations

import math

import numpy as np

from smc.official.crs import geojson_points, geojson_rings
from smc.official.schema import (
    DocumentStatus,
    ExtractionMethod,
    OfficialFactClass,
    OfficialGeometryFact,
    feet_to_m,
)

#: A sidewalk narrower or wider than this in the survey is a data error, not a footway.
SIDEWALK_RANGE_FT = (2.0, 60.0)
#: Likewise for a right of way. San Francisco's widest ordinary streets are around 125 ft.
ROW_RANGE_M = (3.0, 60.0)
#: How well a width read off the right-of-way layer is actually known. The publisher says the
#: layer "is not provided at engineering levels of spatial accuracy", and it shows: Grant Avenue
#: and Pacific Avenue come out within inches of San Francisco's standard 50 ft and 68.75 ft
#: sections, while Market Street and Van Ness Avenue read about 75 ft against a recorded 120 ft
#: and 125 ft. Claiming 0.3 m on that would be inventing precision the city disclaims.
ROW_SIGMA_M = 1.5

_SIDES = {"left": 1, "right": -1, "both": 0, "north": 0, "south": 0, "east": 0, "west": 0}


def _f(value) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(out) else out


def segment_id(cnn) -> str:
    """A stable identity for a street segment, from the city's own centreline network id."""
    text = str(cnn).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return f"sfcnn:{text}"


def sidewalk_facts(rows, document) -> list[OfficialGeometryFact]:
    """Sidewalk widths, keeping the survey and the policy strictly apart.

    ``sidewalk_f`` is documented as "Actual sidewalk width in feet. Negative number indicates
    that the width varies, most 0s are unknown." So a negative is not a width and must never be
    used as one -- reading it literally would build footways on the wrong side of the kerb --
    and a zero is an absence of information rather than an absence of pavement.

    ``width_min`` and ``width_reco`` come from the Better Streets Plan. They are the same pair
    of numbers for every street of a given class, which is what a standard is. They are kept,
    because the gap between them and the survey is the interesting quantity, but they are
    stamped ``design_standard`` so nothing downstream can mistake one for a measurement.
    """
    facts: list[OfficialGeometryFact] = []
    for row in rows:
        cnn = row.get("cnn")
        if cnn is None:
            continue
        feature = segment_id(cnn)
        geometry = tuple(geojson_points(row.get("shape") or {}))
        side = _SIDES.get(str(row.get("side", "")).strip().lower(), 0)

        actual = _f(row.get("sidewalk_f"))
        if actual is not None and actual < 0:
            facts.append(OfficialGeometryFact(
                feature_id=feature, fact_class=OfficialFactClass.SIDEWALK_WIDTH,
                value=None, unit="m", document_id=document.document_id,
                document_status=DocumentStatus.EXISTING_SURVEY, geometry=geometry, side=side,
                source_label="sidewalk_f", flags=("width_varies",),
                source_value=actual, source_unit="ft",
            ))
        elif actual is not None and SIDEWALK_RANGE_FT[0] <= actual <= SIDEWALK_RANGE_FT[1]:
            facts.append(OfficialGeometryFact(
                feature_id=feature, fact_class=OfficialFactClass.SIDEWALK_WIDTH,
                value=round(feet_to_m(actual), 4), unit="m", document_id=document.document_id,
                document_status=DocumentStatus.EXISTING_SURVEY, geometry=geometry, side=side,
                source_label="sidewalk_f",
                # The 2014 study measured to the nearest foot, so half a foot is the floor on
                # how well any of these can agree with anything.
                horizontal_sigma_m=round(feet_to_m(0.5), 4),
                source_value=actual, source_unit="ft", valid_from="2014-01-01",
            ))

        for column, label in (("width_min", "better_streets_minimum"),
                              ("width_reco", "better_streets_recommended")):
            standard = _f(row.get(column))
            if standard is None or standard <= 0:
                continue
            facts.append(OfficialGeometryFact(
                feature_id=feature, fact_class=OfficialFactClass.SIDEWALK_WIDTH,
                value=round(feet_to_m(standard), 4), unit="m",
                document_id=document.document_id,
                document_status=DocumentStatus.DESIGN_STANDARD,
                geometry=(), side=side, source_label=label,
                source_value=standard, source_unit="ft",
                flags=("policy_not_observation", str(row.get("class") or "")),
            ))
    return facts


def _convex_hull(points: np.ndarray) -> np.ndarray:
    """Monotone chain. Returns the hull counter-clockwise, without a repeated last point."""
    order = np.lexsort((points[:, 1], points[:, 0]))
    ordered = points[order]
    if len(ordered) < 3:
        return ordered

    def half(sequence):
        out: list = []
        for point in sequence:
            while len(out) >= 2:
                a, b = out[-2], out[-1]
                if (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) > 0:
                    break
                out.pop()
            out.append(point)
        return out

    lower = half(ordered)
    upper = half(ordered[::-1])
    return np.array(lower[:-1] + upper[:-1])


def _principal_width_m(points: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Width and length of a roughly rectangular ring, in metres.

    The smallest rectangle that contains the shape, found by rotating the convex hull onto each
    of its own edges in turn -- for a right-of-way block, which is a rectangle with the corners
    knocked off, the short side of that rectangle is the dimension a surveyor would call the
    width.

    This began as a principal-component fit, which was wrong twice over. A GeoJSON ring repeats
    its first vertex to close itself, and that duplicated corner pulls the centroid and tilts
    both axes -- so every polygon in the dataset was measured slightly askew, a rectangle 20 m
    across coming out at 23.5. Worse, a component fit weights by where the vertices happen to
    be, so a long edge drawn with two points counts for less than a short one drawn with fifty.
    The hull has neither problem.
    """
    if len(points) < 3:
        return None
    unique = list(dict.fromkeys(points))
    if len(unique) < 3:
        return None
    lat0 = sum(p[1] for p in unique) / len(unique)
    scale = math.cos(math.radians(lat0))
    local = np.array([[(p[0] - unique[0][0]) * 111_320.0 * scale,
                       (p[1] - unique[0][1]) * 111_320.0] for p in unique])
    if not np.isfinite(local).all():
        return None
    hull = _convex_hull(local)
    if len(hull) < 3:
        return None

    best: tuple[float, float] | None = None
    for i in range(len(hull)):
        edge = hull[(i + 1) % len(hull)] - hull[i]
        length = float(np.linalg.norm(edge))
        if length < 1e-9:
            continue
        along = edge / length
        across = np.array([-along[1], along[0]])
        projected_along = hull @ along
        projected_across = hull @ across
        extent_a = float(projected_along.max() - projected_along.min())
        extent_b = float(projected_across.max() - projected_across.min())
        width, long_side = min(extent_a, extent_b), max(extent_a, extent_b)
        if best is None or width * long_side < best[0] * best[1]:
            best = (width, long_side)
    return best


def width_across(points: list[tuple[float, float]],
                 direction: tuple[float, float]) -> float | None:
    """Extent of a polygon measured square to a known street direction, in metres.

    This is the only definition of a street's width that does not depend on guessing which way
    the street runs. Both attempts at guessing were wrong on real data: a principal-component
    fit is skewed by the repeated closing vertex and by where the vertices happen to be dense,
    and the smallest enclosing rectangle turns diagonally on a block whose ends flare into the
    intersections -- it read Pacific Avenue, a standard 68.75 ft section, as fifty feet.

    The centreline is not a guess. Every right-of-way polygon is published against the CNN of
    the street it belongs to, and that street's own direction is what "across" means.
    """
    if len(points) < 3:
        return None
    unique = list(dict.fromkeys(points))
    if len(unique) < 3:
        return None
    lat0 = sum(p[1] for p in unique) / len(unique)
    scale = math.cos(math.radians(lat0))
    local = np.array([[(p[0] - unique[0][0]) * 111_320.0 * scale,
                       (p[1] - unique[0][1]) * 111_320.0] for p in unique])
    if not np.isfinite(local).all():
        return None
    across = np.array([-direction[1], direction[0]], dtype=np.float64)
    norm = float(np.linalg.norm(across))
    if norm < 1e-9:
        return None
    projected = local @ (across / norm)
    return float(projected.max() - projected.min())


def right_of_way_facts(rows, document, *, direction_for=None) -> list[OfficialGeometryFact]:
    """Right-of-way width per street segment, measured across the recorded polygon.

    ``direction_for`` maps a segment id to the unit direction of its centreline. Without one
    the width falls back to the smallest enclosing rectangle, which is worse and is flagged as
    such rather than presented as the same measurement.
    """
    facts: list[OfficialGeometryFact] = []
    for row in rows:
        cnn = row.get("cnn") or row.get("cnntext")
        if cnn is None:
            continue
        feature = segment_id(cnn)
        rings = geojson_rings(row.get("the_geom") or {})
        # Measured per part. A boulevard recorded as two polygons has two widths, and the
        # street's width is the wider of them -- not the spread of both clouds together, which
        # is what flattening them first would give.
        direction = direction_for(feature) if direction_for else None
        flags: tuple[str, ...] = ("not_engineering_accuracy",)
        if direction is not None:
            widths = [w for w in (width_across(r, direction) for r in rings) if w]
            if not widths:
                continue
            width, length = max(widths), None
        else:
            measured = [m for m in (_principal_width_m(r) for r in rings) if m]
            if not measured:
                continue
            width, length = max(measured, key=lambda m: m[0])
            flags = flags + ("direction_unknown",)
        points = geojson_points(row.get("the_geom") or {})
        if not (ROW_RANGE_M[0] <= width <= ROW_RANGE_M[1]):
            continue
        # A polygon as wide as it is long is an intersection or a plaza, and its "width" is not
        # a street width. Kept, flagged, and left for the consumer to decline.
        if length is not None and length < width * 1.5:
            flags = flags + ("not_block_shaped",)
        facts.append(OfficialGeometryFact(
            feature_id=feature, fact_class=OfficialFactClass.RIGHT_OF_WAY_WIDTH,
            value=round(width, 3), unit="m", document_id=document.document_id,
            document_status=DocumentStatus.RECORDED,
            geometry=tuple(points), source_label="ROW",
            horizontal_sigma_m=ROW_SIGMA_M, valid_from="2014-01-01", flags=flags,
        ))
    return facts


def curb_line_facts(rows, document) -> list[OfficialGeometryFact]:
    facts = []
    for row in rows:
        points = geojson_points(row.get("the_geom") or {})
        if len(points) < 2:
            continue
        layer = str(row.get("layer") or "").strip().upper()
        facts.append(OfficialGeometryFact(
            feature_id=f"sfcurb:{row.get('objectid')}",
            fact_class=OfficialFactClass.CURB_LINE,
            value=layer or None, unit=None, document_id=document.document_id,
            document_status=DocumentStatus.RECORDED,
            geometry=tuple(points), source_label=layer or None,
            horizontal_sigma_m=0.3,
        ))
    return facts


def curb_ramp_facts(rows, document) -> list[OfficialGeometryFact]:
    """Curb ramps, with the inventory's own condition findings carried as flags.

    ``liptoohigh`` is the city saying the lip at the bottom of this ramp is above tolerance.
    That is a claim about vertical geometry from an inspection, and it is the only vertical
    statement anywhere in the open records -- so it is worth keeping even though it is a flag
    rather than a height.
    """
    facts = []
    for row in rows:
        lon, lat = _f(row.get("longitude")), _f(row.get("latitude"))
        if lon is None or lat is None:
            continue
        flags = tuple(name for name, column in
                      (("lip_too_high", "liptoohigh"),
                       ("street_meets_ramp_poorly", "probstreetmeetcr"),
                       ("no_detectable_surface", "detectablesurf"),
                       ("too_narrow", "crtoonarrow"))
                      if _f(row.get(column)) == 1)
        facts.append(OfficialGeometryFact(
            feature_id=f"sframp:{row.get('locid')}",
            fact_class=OfficialFactClass.CURB_RAMP,
            value=str(row.get("curbreturnloc") or "") or None, unit=None,
            document_id=document.document_id,
            document_status=DocumentStatus.EXISTING_SURVEY,
            geometry=((lon, lat),), source_label="curb ramp inventory",
            valid_from=str(row.get("lastupdate") or "")[:10] or None,
            horizontal_sigma_m=1.0, flags=flags,
        ))
    return facts


def parcel_facts(rows, document) -> list[OfficialGeometryFact]:
    facts = []
    for row in rows:
        if str(row.get("active", "")).lower() in ("false", "0"):
            continue
        points = geojson_points(row.get("shape") or {})
        if len(points) < 4:
            continue
        facts.append(OfficialGeometryFact(
            feature_id=f"sfparcel:{row.get('mapblklot')}",
            fact_class=OfficialFactClass.PROPERTY_LINE,
            value=None, unit=None, document_id=document.document_id,
            document_status=DocumentStatus.RECORDED,
            geometry=tuple(points), source_label="assessor parcel",
            valid_from=str(row.get("date_map_add") or "")[:10] or None,
            horizontal_sigma_m=0.5,
            flags=("pw_recorded_map",) if str(row.get("pw_recorded_map","")).lower()
                  in ("true", "1") else (),
        ))
    return facts


def acceptance_index(rows) -> dict[str, dict]:
    """Acceptance ordinance and date per segment, for stamping other facts with a status."""
    index: dict[str, dict] = {}
    for row in rows:
        cnn = row.get("cnn")
        if cnn is None:
            continue
        index[segment_id(cnn)] = {
            "accepted_on": str(row.get("dateaccepted") or "")[:10] or None,
            "ordinance": row.get("ordinancenumber"),
            "jurisdiction": row.get("jurisdiction"),
        }
    return index


EXTRACTORS = {
    "sidewalk_widths": sidewalk_facts,
    "right_of_way": right_of_way_facts,
    "curbs_islands": curb_line_facts,
    "curb_ramps": curb_ramp_facts,
    "parcels": parcel_facts,
}
