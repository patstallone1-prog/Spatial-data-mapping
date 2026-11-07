"""Parcel-bound car dealerships: retained shells, connected aisles and brand facades.

All unobserved placements are design priors, never a survey or a parking-code approval.
A parcel and a building are distinct inputs. No bounding rectangle replaces either.
"""

from __future__ import annotations

import copy
import heapq
import math
from itertools import pairwise

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

from smc.exteriors.engine import infer_exterior
from smc.exteriors.library import library
from smc.exteriors.model import ExteriorInput
from smc.exteriors.stations import evidence

AISLE = 6.5
STALL_WIDTH = 2.8
STALL_LENGTH = 5.5
WALK = 1.8


def _polygon(value, label):
    p = shape(value)
    if not isinstance(p, Polygon) or p.is_empty or not p.is_valid or p.area < 1:
        raise ValueError(label + " requires a valid Polygon, including any courtyards")
    return p


def _lines(g):
    if g.is_empty:
        return []
    return (
        [g]
        if g.geom_type == "LineString"
        else [p for c in getattr(g, "geoms", ()) for p in _lines(c)]
    )


def _vertices(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return list(g.exterior.coords)[:-1] + [p for r in g.interiors for p in list(r.coords)[:-1]]
    return [p for c in g.geoms for p in _vertices(c)]


def _route(free, start, end):
    """Visibility path within already eroded clearance geometry; never crosses a hole."""
    safe = free.buffer(1e-7)
    if not safe.covers(Point(start)) or not safe.covers(Point(end)):
        return None
    if safe.covers(LineString([start, end])):
        return [list(start), list(end)]
    nodes = [tuple(start), tuple(end), *_vertices(free)]
    edges = [[] for _ in nodes]
    for i, a in enumerate(nodes):
        for j in range(i):
            b = nodes[j]
            if safe.covers(LineString([a, b])):
                d = math.dist(a, b)
                edges[i].append((j, d))
                edges[j].append((i, d))
    pending, costs, previous = [(0, 0)], {0: 0}, {}
    while pending:
        cost, i = heapq.heappop(pending)
        if cost > costs[i]:
            continue
        if i == 1:
            path = [1]
            while path[-1] != 0:
                path.append(previous[path[-1]])
            return [list(nodes[j]) for j in reversed(path)]
        for j, d in edges[i]:
            total = cost + d
            if total < costs.get(j, float("inf")):
                costs[j], previous[j] = total, i
                heapq.heappush(pending, (total, j))
    return None


def infer_dealership(row):
    source = copy.deepcopy(row)
    if row.get("units", "metres") != "metres":
        raise ValueError("dealership requires local metres")
    if not row.get("id") or not row.get("name"):
        raise ValueError("dealership identity and name required")
    site = _polygon(row["site_polygon"], "actual parcel")
    spec = ExteriorInput.from_json(row["building"])
    if not site.covers(spec.footprint):
        raise ValueError("building lies outside its parcel")
    public = [f for f in spec.frontages if f.get("role", "public") == "public"]
    if not public:
        raise ValueError("supply the actual showroom frontage edge")
    facade = infer_exterior(spec)
    if not facade["validation"]["passed"]:
        raise ValueError("invalid showroom facade: " + str(facade["validation"]["errors"]))
    primary = next(f for f in facade["facades"] if f["role"] == "public")
    if primary["category"] != "car_dealership":
        raise ValueError(
            "dealership tenant must use car_dealership category or an explicit dealer brand"
        )
    doors = [o for o in primary["openings"] if o["component_kind"] == "door"]
    if not doors:
        raise ValueError("showroom needs an entrance")
    refs = primary["references"]
    a, b = primary["a"], primary["b"]
    length = math.dist(a, b)
    t, n = [(b[i] - a[i]) / length for i in range(2)], primary["normal"]
    forward = [t[0], n[0], t[1], n[1], a[0], a[1]]
    inverse = [
        t[0],
        t[1],
        n[0],
        n[1],
        -sum(t[i] * a[i] for i in range(2)),
        -sum(n[i] * a[i] for i in range(2)),
    ]

    def local(p):
        return affinity.affine_transform(p, inverse)

    def world(p):
        return affinity.affine_transform(p, forward)

    def point(p):
        return list(world(Point(p)).coords[0])

    boundary, building = local(site), local(spec.footprint)
    obstacles = [_polygon(o["polygon"], "obstacle") for o in row.get("obstacles", [])]
    if any(not site.covers(p) for p in obstacles):
        raise ValueError("obstacle outside parcel")
    blocked = unary_union([building.buffer(0.25), *[local(p) for p in obstacles]])
    free = boundary.buffer(-0.25, join_style=2).difference(blocked)
    # Supplied driveway centerlines include the parcel boundary and an inner staging point.
    # They are kept verbatim; no automatic curb cut is fabricated from a building footprint.
    drives, gates = [], []
    for i, d in enumerate(row.get("driveways", [])):
        w = float(d.get("width_m", AISLE))
        if not math.isfinite(w) or w < AISLE:
            raise ValueError("two-way driveway needs at least 6.5 m rendering clearance")
        line = LineString(d["points"])
        if line.length < w / 2 + 0.5 or not site.buffer(0.01).covers(line):
            raise ValueError("driveway needs a boundary-to-interior centerline")
        if site.boundary.distance(Point(line.coords[0])) > 0.1:
            raise ValueError("driveway must start at the supplied parcel boundary")
        corridor = line.buffer(w / 2, cap_style=2, join_style=2)
        if not site.buffer(0.01).covers(corridor) or corridor.intersects(spec.footprint):
            raise ValueError("driveway clearance leaves parcel or intersects building")
        if any(corridor.intersection(p).area > 1e-5 for p in obstacles):
            raise ValueError("driveway blocked by source obstacle")
        drives.append(
            dict(
                id=f"{row['id']}:drive:{i}",
                points=copy.deepcopy(d["points"]),
                width_m=w,
                polygon=mapping(corridor),
                evidence=evidence(d, refs),
                source_record=copy.deepcopy(d),
            )
        )
        gates.append(list(local(Point(line.coords[-1])).coords[0]))
    if not drives:
        raise ValueError("parcel driveway centerlines required; do not invent road access")
    # Reserve a protected entrance approach before any car placement.
    door = doors[0]
    entry = (door["u"] + door["w"] / 2, 0.95)
    pedestrian_free = boundary.buffer(-WALK / 2, join_style=2).difference(
        unary_union([building.buffer(0.02), *[local(p).buffer(WALK / 2) for p in obstacles]])
    )
    pedestrian = None
    for gate in gates:
        candidate = _route(pedestrian_free, entry, gate)
        if candidate and (
            pedestrian is None or LineString(candidate).length < LineString(pedestrian).length
        ):
            pedestrian = candidate
    if pedestrian is None:
        raise ValueError("no clear pedestrian approach from driveway to showroom entrance")
    walk = LineString(pedestrian).buffer(WALK / 2, cap_style=2, join_style=2)
    # Extend the final metre right to the door threshold (erosion excludes the wall itself).
    walk = unary_union([walk, box(entry[0] - WALK / 2, 0, entry[0] + WALK / 2, entry[1])])
    if (
        not boundary.buffer(0.001).covers(walk)
        or walk.intersection(building).area > 1e-5
        or any(walk.intersection(local(p)).area > 1e-5 for p in obstacles)
    ):
        raise ValueError("entrance approach does not fit source parcel")
    lanes, route_rows, reserved = [], [], [local(shape(d["polygon"])) for d in drives]
    center_free = free.buffer(-AISLE / 2, join_style=2)
    service_aprons = []
    for f in facade["facades"]:
        L = math.dist(f["a"], f["b"])
        tangent = [(f["b"][i] - f["a"][i]) / L for i in range(2)]
        for opening in f["openings"]:
            if opening["component_kind"] != "garage":
                continue
            u = opening["u"] + opening["w"] / 2
            threshold = [f["a"][i] + tangent[i] * u for i in range(2)]
            outer = [threshold[i] + f["normal"][i] * 6 for i in range(2)]
            apron = LineString([threshold, outer]).buffer(
                max(3.5, opening["w"]) / 2, cap_style=2, join_style=2
            )
            start = list(local(Point(outer)).coords[0])
            paths = [_route(center_free, start, g) for g in gates]
            paths = [p for p in paths if p]
            if (
                not paths
                or not site.covers(apron)
                or apron.intersection(spec.footprint).area > 1e-5
            ):
                raise ValueError("service opening has no clear vehicle approach")
            path = min(paths, key=lambda p: LineString(p).length)
            connection = LineString(path).buffer(AISLE / 2, cap_style=2, join_style=2)
            reserved += [local(apron), connection]
            service_aprons.append(
                dict(
                    opening_id=opening["id"],
                    polygon=mapping(apron),
                    points=[threshold, outer],
                    width_m=max(3.5, opening["w"]),
                    evidence=copy.deepcopy(opening["evidence"]),
                )
            )
            route_rows.append(
                dict(
                    points=[point(p) for p in path],
                    width_m=AISLE,
                    polygon=mapping(world(connection)),
                    evidence=evidence(refs=refs),
                )
            )
    minx, _, maxx, _ = boundary.bounds
    requested = row.get("requested_display_cars", 80)
    if type(requested) is not int or not 0 <= requested <= 1000:
        raise ValueError("requested_display_cars must be an integer from 0 to 1000")

    def pack(candidate_lanes, candidate_reserved):
        available = free.difference(unary_union([*candidate_reserved, walk])).buffer(1e-7)
        fitted, occupied = [], []
        for lane_index, lane in enumerate(candidate_lanes):
            x0, y0, x1, _ = local(LineString(lane["points"])).bounds
            for side in (-1, 1):
                x = x0 + STALL_WIDTH / 2
                while x <= x1 - STALL_WIDTH / 2 + 1e-6 and len(fitted) < requested:
                    cy = y0 + side * (AISLE / 2 + STALL_LENGTH / 2)
                    p = box(
                        x - STALL_WIDTH / 2,
                        cy - STALL_LENGTH / 2,
                        x + STALL_WIDTH / 2,
                        cy + STALL_LENGTH / 2,
                    )
                    if available.covers(p) and not any(
                        p.intersection(q).area > 1e-6 for q in occupied
                    ):
                        fitted.append(
                            dict(
                                id=f"{row['id']}:stall:{len(fitted)}",
                                kind="display",
                                center=point((x, cy)),
                                polygon=mapping(world(p)),
                                width_m=STALL_WIDTH,
                                length_m=STALL_LENGTH,
                                heading_degrees=math.degrees(math.atan2(n[1] * side, n[0] * side)),
                                aisle_index=lane_index,
                                evidence=evidence(refs=refs),
                            )
                        )
                        occupied.append(p)
                    x += STALL_WIDTH
        return fitted

    # Fixed, bounded offset search for every parcel. Rank actual fitted capacity, then
    # circulation area. The grid is never tuned to a test identity or a rectangular proxy.
    pitch = AISLE + STALL_LENGTH * 2
    base_routes, base_reserved = route_rows.copy(), reserved.copy()
    best, chosen_offset, offsets = None, None, []
    if not center_free.is_empty:
        start_y, end_y = center_free.bounds[1], center_free.bounds[3]
        boundary_anchor = (boundary.bounds[1] + AISLE / 2 + STALL_LENGTH + 0.3 - start_y) % pitch
        offsets = sorted({pitch * i / 7 for i in range(7)} | {boundary_anchor})
        for offset_index, offset in enumerate(offsets):
            candidate_lanes, candidate_routes, candidate_reserved = (
                [],
                base_routes.copy(),
                base_reserved.copy(),
            )
            y = start_y + offset + 0.001
            while y <= end_y:
                for segment in _lines(
                    center_free.intersection(LineString([(minx - 1, y), (maxx + 1, y)]))
                ):
                    if segment.length < STALL_WIDTH:
                        continue
                    mid = list(segment.interpolate(0.5, normalized=True).coords[0])
                    paths = [_route(center_free, mid, gate) for gate in gates]
                    paths = [p for p in paths if p]
                    if not paths:
                        continue
                    path = min(paths, key=lambda p: LineString(p).length)
                    lane = segment.buffer(AISLE / 2, cap_style=2, join_style=2)
                    connection = LineString(path).buffer(AISLE / 2, cap_style=2, join_style=2)
                    candidate_reserved += [lane, connection]
                    candidate_lanes.append(
                        dict(
                            points=[point(p) for p in segment.coords],
                            width_m=AISLE,
                            polygon=mapping(world(lane)),
                            evidence=evidence(refs=refs),
                        )
                    )
                    candidate_routes.append(
                        dict(
                            points=[point(p) for p in path],
                            width_m=AISLE,
                            polygon=mapping(world(connection)),
                            evidence=evidence(refs=refs),
                        )
                    )
                y += pitch
            candidate_stalls = pack(candidate_lanes, candidate_reserved)
            rank = (len(candidate_stalls), -unary_union(candidate_reserved).area, -offset_index)
            if best is None or rank > best:
                best, chosen_offset = rank, offset
                lanes, route_rows, stalls = candidate_lanes, candidate_routes, candidate_stalls
    if best is None:
        lanes, route_rows, stalls = [], base_routes, []
    # The closest fitted bay is reserved for visitors rather than filled with a display car.
    # Explicit measured stalls, including accessible stalls, take precedence and are not moved.
    measured_stalls = []
    for index, raw in enumerate(row.get("parking_stalls", [])):
        p = _polygon(raw["polygon"], "observed stall")
        rectangle = p.minimum_rotated_rectangle
        edges = list(rectangle.exterior.coords)
        pa, pb = max(pairwise(edges), key=lambda edge: math.dist(*edge))
        heading = float(
            raw.get("heading_degrees", math.degrees(math.atan2(pb[1] - pa[1], pb[0] - pa[0])))
        )
        center = raw.get("center", list(p.centroid.coords[0]))
        if (
            len(center) != 2
            or not all(math.isfinite(float(v)) for v in center)
            or not math.isfinite(heading)
            or not p.covers(Point(center))
        ):
            raise ValueError("observed stall has an invalid center or heading")
        vehicle = affinity.rotate(
            box(center[0] - 2.2, center[1] - 0.92, center[0] + 2.2, center[1] + 0.92),
            heading,
            origin=center,
        )
        measured_stalls.append(
            dict(
                copy.deepcopy(raw),
                id=str(raw.get("id", f"{row['id']}:observed:{index}")),
                kind=raw.get("kind", "visitor"),
                center=list(center),
                heading_degrees=heading,
                render_vehicle=p.covers(vehicle),
                source_record=copy.deepcopy(raw),
                evidence=evidence(raw, refs),
            )
        )
    if measured_stalls:
        # Observations were not considered by the inferred packing, so remove inferred conflicts.
        protected = unary_union([shape(s["polygon"]) for s in measured_stalls])
        stalls = [s for s in stalls if shape(s["polygon"]).intersection(protected).area < 1e-6]
        stalls += measured_stalls
    elif stalls:
        near = min(stalls, key=lambda s: math.dist(s["center"], point(entry)))
        near["kind"] = "visitor"
    # Interior display cars use the real (possibly concave) shell and retain a clear entry spine.
    inner = building.buffer(-0.8, join_style=2)
    entry_spine = box(entry[0] - 1.2, building.bounds[1], entry[0] + 1.2, 0)
    showroom_cars, furniture = [], []
    for sign in (-1, 1):
        cx, cy = entry[0] + sign * (door["w"] / 2 + 2.5), -2.8
        counter = box(cx - 1.2, cy - 0.4, cx + 1.2, cy + 0.4)
        if inner.covers(counter.buffer(0.7)) and not counter.buffer(0.7).intersects(entry_spine):
            furniture.append(
                dict(
                    role="reception",
                    facade_id=primary["id"],
                    center=point((cx, cy)),
                    width_m=2.4,
                    depth_m=0.8,
                    polygon=mapping(world(counter)),
                    evidence=evidence(refs=refs),
                )
            )
            break
    x0, y0, x1, y1 = inner.bounds
    for y in _range(y0 + 3.1, y1 - 3.1, 7.5):
        for x in _range(x0 + 1.8, x1 - 1.8, 5.0):
            p = box(x - 1.4, y - 2.7, x + 1.4, y + 2.7)
            if (
                inner.covers(p)
                and not p.intersects(entry_spine)
                and not any(p.intersects(local(shape(f["polygon"])).buffer(1)) for f in furniture)
            ):
                showroom_cars.append(
                    dict(
                        id=f"{row['id']}:showroom:{len(showroom_cars)}",
                        center=point((x, y)),
                        polygon=mapping(world(p)),
                        heading_degrees=math.degrees(math.atan2(n[1], n[0])),
                        floor_y_m=0.06,
                        evidence=evidence(refs=refs),
                    )
                )
            if len(showroom_cars) >= 6:
                break
        if len(showroom_cars) >= 6:
            break
    style = library()["brands"].get(primary["brand"], {})
    result = dict(
        schema="kerbside.inferred_dealership/1",
        id=row["id"],
        name=row["name"],
        site_polygon=copy.deepcopy(row["site_polygon"]),
        source_input=source,
        canonical_geometry_modified=False,
        building=facade,
        brand=primary["brand"],
        style=copy.deepcopy(style),
        evidence=evidence(row.get("geometry_evidence"), refs),
        references=[r for r in library()["sources"] if r["id"] in refs],
        driveways=drives,
        aisles=lanes,
        connections=route_rows,
        service_aprons=service_aprons,
        pedestrian_paths=[
            dict(
                points=[point(p) for p in pedestrian],
                width_m=WALK,
                polygon=mapping(world(walk)),
                evidence=evidence(refs=refs),
            )
        ],
        stalls=stalls,
        obstacles=copy.deepcopy(row.get("obstacles", [])),
        showroom=dict(
            cars=showroom_cars,
            furniture=furniture,
            polygon=mapping(spec.footprint.buffer(-0.5)),
            height_m=min(spec.height_m - 0.25, 5.5),
        ),
        warnings=[],
        layout_search=dict(
            offset_candidates=len(offsets),
            chosen_offset_m=chosen_offset,
            objective="fitted capacity then circulation area",
        ),
        not_an_as_built_survey=True,
    )
    if len(stalls) < requested:
        result["warnings"].append(
            f"Capacity reduced from {requested} to {len(stalls)} to retain clear circulation."
        )
    result["validation"] = validate_dealership(result)
    return result


def _range(start, end, step):
    while start <= end:
        yield start
        start += step


def validate_dealership(plan):
    """Re-evaluate physical invariants, including source stalls conflicting with circulation."""
    errors = []
    site = shape(plan["site_polygon"])
    building = shape(plan["building"]["footprint"])
    cars = [shape(s["polygon"]) for s in plan["stalls"]]
    routes = [
        shape(r["polygon"])
        for r in plan["driveways"] + plan["aisles"] + plan["connections"] + plan["service_aprons"]
    ]
    walks = [shape(r["polygon"]) for r in plan["pedestrian_paths"]]
    obstacles = [shape(r["polygon"]) for r in plan["obstacles"]]
    for p in cars + routes + walks:
        if not site.buffer(0.011).covers(p):
            errors.append("placement outside source parcel")
        if p.intersection(building).area > 1e-5:
            errors.append("placement intersects retained building")
        if any(p.intersection(q).area > 1e-5 for q in obstacles):
            errors.append("placement intersects source obstacle")
    for i, p in enumerate(cars):
        if any(p.intersection(q).area > 1e-5 for q in cars[:i]):
            errors.append("overlapping vehicle spaces")
        if any(p.intersection(q).area > 1e-5 for q in routes + walks):
            errors.append("vehicle space blocks circulation")
    ids = [s["id"] for s in plan["stalls"]]
    if len(ids) != len(set(ids)):
        errors.append("duplicate vehicle-space identity")
    if not plan["pedestrian_paths"]:
        errors.append("missing pedestrian approach")
    for s in plan["stalls"]:
        if s.get("source_record"):
            continue
        if s["width_m"] < STALL_WIDTH or s["length_m"] < STALL_LENGTH:
            errors.append("inferred stall squeezed below design clearance")
        i = s["aisle_index"]
        if (
            i >= len(plan["aisles"])
            or shape(s["polygon"]).distance(shape(plan["aisles"][i]["polygon"])) > 0.01
        ):
            errors.append("vehicle space has no adjacent aisle")
    for furniture in plan["showroom"]["furniture"]:
        if not building.covers(shape(furniture["polygon"])):
            errors.append("showroom furniture outside retained shell")
    for car in plan["showroom"]["cars"]:
        if not building.covers(shape(car["polygon"])):
            errors.append("showroom car outside retained shell")
    network = unary_union(routes).buffer(0.015)
    for lane in plan["aisles"]:
        if not any(
            network.geom_type == "Polygon"
            or any(
                g.covers(shape(lane["polygon"]).representative_point())
                and g.intersects(shape(d["polygon"]))
                for g in network.geoms
            )
            for d in plan["driveways"]
        ):
            errors.append("aisle disconnected from driveway")
    return dict(passed=not errors, errors=sorted(set(errors)), warnings=plan["warnings"])


def build_dealership_bundle(out, rows):
    """Build an isolated inspectable format; retain rejected cases in the manifest."""
    import json
    import shutil
    from importlib.resources import files
    from pathlib import Path

    out = Path(out)
    package = files("smc.exteriors")
    scenes, rejected, seen = {}, [], set()
    for row in rows:
        key = str(row["id"])
        if key in seen:
            raise ValueError("duplicate dealership identity")
        seen.add(key)
        try:
            plan = infer_dealership(row)
            if plan["validation"]["passed"]:
                scenes[key] = plan
            else:
                rejected.append(dict(id=key, errors=plan["validation"]["errors"]))
        except (ValueError, KeyError, TypeError) as error:
            rejected.append(dict(id=key, errors=[str(error)]))
    manifest = dict(
        schema="kerbside.dealership_scenes/1",
        selected=[r["id"] for r in rows],
        dealerships=scenes,
        rejected=rejected,
    )
    (out / "dealership-scenes.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for name in ("dealership-renderer.mjs", "dealership-preview.mjs", "dealership-preview.html"):
        shutil.copyfile(
            str(package.joinpath(name)),
            out / ("dealerships.html" if name.endswith(".html") else name),
        )
    return dict(selected=len(rows), passed=len(scenes), rejected=rejected)


def from_kerbside_dealership(site_way, building_way, *, driveways, streets=(), fit=None):
    """Convert a real shop=car parcel and its separate canonical shell into one metre frame.

    Driveway centerlines are longitude/latitude source observations, not invented curb cuts.
    Heights, footprint vertices and reviewed window/door records come from Kerbside's adapter.
    """
    from dataclasses import asdict

    from smc.exteriors.kerbside import from_kerbside

    tags = site_way.get("tags", {})
    if site_way.get("kind") == "building" or tags.get("building") or tags.get("shop") != "car":
        raise ValueError("requires a separate shop=car site polygon, not a building footprint")
    spec = from_kerbside(building_way, streets, fit)
    lon, lat = spec.origin_lon_lat
    scale = 111320 * math.cos(math.radians(lat))

    def local(p):
        return [(p[0] - lon) * scale, (p[1] - lat) * 111320]

    building = asdict(spec)
    building["footprint"] = mapping(spec.footprint)
    brand = building_way.get("tags", {}).get("brand") or tags.get("brand")
    for tenant in building["tenants"]:
        tenant["category"] = "car_dealership"
        if brand:
            tenant["brand"] = brand
    source_drives = []
    for d in driveways:
        source_drives.append(
            dict(
                copy.deepcopy(d),
                points=[local(p) for p in d["points"]],
                canonical_lon_lat=copy.deepcopy(d["points"]),
            )
        )
    result = dict(
        id=str(site_way["osm_id"]),
        name=site_way.get("name") or building_way["name"],
        units="metres",
        site_polygon=mapping(
            Polygon(
                [local(p) for p in site_way["points"]],
                holes=[[local(p) for p in ring] for ring in site_way.get("holes", [])],
            )
        ),
        building=building,
        driveways=source_drives,
        origin_lon_lat=[lon, lat],
        canonical_site_points=copy.deepcopy(site_way["points"]),
        geometry_evidence=copy.deepcopy(
            site_way.get("geometry_evidence")
            or dict(source_id="kerbside:" + str(site_way["osm_id"]), inferred=True)
        ),
    )
    return result
