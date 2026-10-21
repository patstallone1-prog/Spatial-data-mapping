"""Reclaim circulation tails and oversize wet rooms without inventing outline area."""

from __future__ import annotations

import heapq
import math
from itertools import combinations, pairwise

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from smc.interiors.inference.furnish import inward_point
from smc.interiors.inference.partition import lines, open_split, polygons, shared, width


def compact_wet_candidates(p, hall, kind):
    """Hall-facing compact rectangles; existing outline and access are preserved."""
    target = 3.8 if kind == "toilet" else 6.5
    sizes = (
        ((1.8, 2.1), (2, 2), (2.1, 2.2), (1.8, 2.4))
        if kind == "toilet"
        else ((2.2, 2.7), (2.4, 2.7), (2.5, 2.8), (2.2, 3.1), (2.7, 2.8))
    )
    options = []
    for edge in lines(shared(p, hall)):
        if edge.length < 1.0:
            continue
        a, b = edge.coords[0], edge.coords[-1]
        ux, uy = (b[0] - a[0]) / edge.length, (b[1] - a[1]) / edge.length
        nx, ny = -uy, ux
        c = edge.interpolate(0.5, normalized=True)
        if not p.covers(Point(c.x + nx * 0.2, c.y + ny * 0.2)):
            nx, ny = -nx, -ny
        for w, d in sizes:
            for fraction in (0.25, 0.5, 0.75, 0, 1):
                t = (
                    max(w / 2, min(edge.length - w / 2, edge.length * fraction))
                    if edge.length >= w
                    else edge.length / 2
                )
                x, y = a[0] + ux * t, a[1] + uy * t
                ring = [
                    (x + ux * u + nx * v, y + uy * u + ny * v)
                    for u, v in ((-w / 2, -0.002), (w / 2, -0.002), (w / 2, d), (-w / 2, d))
                ]
                wet = p.intersection(Polygon(ring))
                if wet.geom_type != "Polygon" or not wet.is_valid:
                    continue
                if (
                    wet.area < (3.0 if kind == "toilet" else 5.2)
                    or shared(wet, hall).length < 0.96
                    or width(wet) < 1.65
                ):
                    continue
                leftover = p.difference(wet)
                if any(q.area < 0.35 for q in polygons(leftover)):
                    continue
                options.append(
                    (abs(wet.area - target) + len(polygons(leftover)) * 0.3, wet, leftover)
                )
    # Remove repeated cuts so fixture feasibility work stays bounded.
    seen = set()
    for _, wet, extra in sorted(options, key=lambda row: row[0]):
        key = wet.wkb
        if key not in seen:
            seen.add(key)
            yield wet, extra


def _allocate_extra(rooms, extra, hall, parent, serial, room_fits):
    """Prefer extending useful adjacent rooms over creating another storage closet."""
    for p in polygons(extra):
        if p.area < 0.002:
            continue
        choices = []
        for r in rooms:
            if r["id"] == parent or r["kind"] in {"toilet", "full_bathroom", "hallway", "stair"}:
                continue
            if shared(p, r["shape"]).length < 0.25:
                continue
            merged = r["shape"].union(p)
            if (
                merged.geom_type != "Polygon"
                or not merged.is_valid
                or len(merged.interiors) > len(r["shape"].interiors)
            ):
                continue
            limit = (
                32
                if r["kind"] in {"living", "dining", "kitchen"}
                else 27
                if "bedroom" in r["kind"]
                else 12
            )
            preview = {**r, "shape": merged}
            if room_fits(preview):
                choices.append(
                    (max(0, merged.area - limit), -shared(p, r["shape"]).length, r, merged)
                )
        if choices and min(q[0] for q in choices) < 8:
            _, _, r, merged = min(choices, key=lambda q: q[:2])
            r["shape"] = merged
            continue
        if p.area >= 9 and width(p) >= 2.3 and shared(p, hall).length >= 1.05:
            key = f"{parent}:reclaimed:{serial}"
            serial += 1
            if p.area > 27:
                try:
                    lounge, study = open_split(p, 0.66)
                    if shared(lounge, hall).length < 1.0:
                        lounge, study = study, lounge
                    if shared(lounge, hall).length >= 1.0 and shared(lounge, study).length >= 1.0:
                        living = {"id": key, "kind": "living", "shape": lounge}
                        office = {
                            "id": key + ":study",
                            "kind": "office",
                            "shape": study,
                            "access_via": key,
                            "_access_shape": lounge,
                        }
                        if room_fits(living) and room_fits(office):
                            office.pop("_access_shape")
                            rooms.extend([living, office])
                            continue
                except ValueError:
                    pass
            for kind in ("living", "office", "utility") if p.area >= 12 else ("office", "utility"):
                candidate = {"id": key, "kind": kind, "shape": p}
                if room_fits(candidate):
                    rooms.append(candidate)
                    break
            else:
                raise ValueError("reclaimed space cannot be furnished")
        elif choices:
            _, _, r, merged = min(choices, key=lambda q: q[:2])
            r["shape"] = merged
        else:
            # Small detached wet-room surplus is a fitted cupboard, never an empty bathroom.
            parent_shape = next(r["shape"] for r in rooms if r["id"] == parent)
            candidate = {
                "id": f"{parent}:reclaimed:{serial}",
                "kind": "closet",
                "shape": p,
                "parent_room": parent,
                "_access_shape": parent_shape,
            }
            if not room_fits(candidate):
                raise ValueError("reclaimed cupboard cannot be furnished")
            candidate.pop("_access_shape")
            rooms.append(candidate)
            serial += 1
    return serial


def rightsize_wet_rooms(rooms, hall, wet_fits, add_half_bath=False):
    rooms = [dict(r) for r in rooms]
    report = {"wet_area_reclaimed_m2": 0.0, "half_baths_added": 0}
    for room in list(rooms):
        kind = room["kind"]
        if kind not in {"toilet", "full_bathroom"}:
            continue
        original = room["shape"]
        maximum = 5.0 if kind == "toilet" else 8.5
        # Compact a full bath when it can also serve a needed second WC.
        if original.area <= maximum and not (
            add_half_bath and kind == "full_bathroom" and original.area >= 9
        ):
            continue
        chosen = None
        fallback = None
        for index, (wet, extra) in enumerate(compact_wet_candidates(original, hall, kind)):
            candidate = {**room, "shape": wet}
            if not wet_fits(candidate):
                continue
            wc_options = []
            if add_half_bath and kind == "full_bathroom":
                for piece in polygons(extra):
                    for wc, _rest in compact_wet_candidates(piece, hall, "toilet"):
                        r = {"id": room["id"] + ":wc", "kind": "toilet", "shape": wc}
                        if wet_fits(r):
                            wc_options.append(r)
                            break
            for wc_room in [*wc_options, None]:
                trial = [{**r, "shape": wet} if r["id"] == room["id"] else dict(r) for r in rooms]
                surplus = extra
                if wc_room:
                    trial.append(wc_room)
                    surplus = extra.difference(wc_room["shape"])
                try:
                    _allocate_extra(trial, surplus, hall, room["id"], 0, wet_fits)
                except ValueError:
                    continue
                changed = [
                    r
                    for r in trial
                    if not any(
                        old["id"] == r["id"] and old["shape"].equals(r["shape"]) for old in rooms
                    )
                ]
                if not all(wet_fits({**r, "_preview_rooms": trial}) for r in changed):
                    continue
                if fallback is None:
                    fallback = (trial, wet, wc_room)
                if wc_room or not add_half_bath:
                    chosen = (trial, wet, wc_room)
                    break
            if chosen or (fallback and index >= 18):
                break
        chosen = chosen or fallback
        if chosen is None:
            raise ValueError(
                "oversize wet room cannot be compacted with usable fixtures and surplus"
            )
        rooms, wet, wc_room = chosen
        report["wet_area_reclaimed_m2"] += original.area - wet.area
        if wc_room:
            report["half_baths_added"] += 1
            add_half_bath = False
    return rooms, report


def _paths_in_hall(hall, terminals):
    free = hall.buffer(-0.43, join_style=2)
    part = next(
        (p for p in polygons(free) if all(p.buffer(0.025).covers(q) for q in terminals)), None
    )
    if part is None:
        return None
    vertices = [
        Point(p) for ring in [part.exterior, *part.interiors] for p in list(ring.coords)[:-1]
    ]
    points = terminals + vertices
    graph = [[] for _ in points]
    for i, j in combinations(range(len(points)), 2):
        line = LineString([points[i], points[j]])
        if part.buffer(0.0001).covers(line):
            graph[i].append((points[i].distance(points[j]), j))
            graph[j].append((points[i].distance(points[j]), i))
    distances = {0: 0.0}
    prev = {}
    queue = [(0.0, 0)]
    while queue:
        distance, i = heapq.heappop(queue)
        if distance > distances[i] + 1e-9:
            continue
        for length, j in graph[i]:
            cost = distance + length
            if cost < distances.get(j, math.inf):
                distances[j] = cost
                prev[j] = i
                heapq.heappush(queue, (cost, j))
    route = []
    for target in range(1, len(terminals)):
        if target not in distances:
            return None
        nodes = [target]
        while nodes[-1]:
            nodes.append(prev[nodes[-1]])
        route.append(LineString([points[i] for i in nodes]))
    return (
        unary_union(route).buffer(0.56, cap_style=3, join_style=2)
        if route
        else terminals[0].buffer(0.65)
    )


def reclaim_hallway(rooms, openings, angle=0):
    """Retain connected routes to real destinations, donate unsupported corridor ends."""
    hall_room = next((r for r in rooms if r["kind"] == "hallway"), None)
    if hall_room is None:
        return rooms, 0.0
    hall = hall_room["shape"]
    portals = [o for o in openings if hall_room["id"] in o["rooms"]]
    terminals = []
    keep = []
    for o in portals:
        line = LineString(o["segment"]["coordinates"])
        terminals.append(inward_point(hall, line, 0.55))
        keep.append(line.buffer(0.58, cap_style=3))
    if not terminals:
        return rooms, 0.0
    needed = _paths_in_hall(hall, terminals)
    if needed is None:
        return rooms, 0.0
    needed = unary_union([needed, *keep]).intersection(hall)
    # Rectilinear cells avoid carving diagonal slivers at corridor bends.
    local = affinity.rotate(hall, -angle, origin=(0, 0))
    required = affinity.rotate(needed, -angle, origin=(0, 0))
    xs = {x for x, y in local.exterior.coords}
    ys = {y for x, y in local.exterior.coords}
    for part in polygons(required):
        x0, y0, x1, y1 = part.bounds
        xs.update((x0, x1))
        ys.update((y0, y1))
    cells = []
    for x0, x1 in pairwise(sorted(xs)):
        for y0, y1 in pairwise(sorted(ys)):
            if x1 - x0 < 1e-6 or y1 - y0 < 1e-6:
                continue
            cell = local.intersection(box(x0, y0, x1, y1))
            if cell.intersection(required).area > 0.00001:
                cells.append(cell)
    if not cells:
        return rooms, 0.0
    retained = affinity.rotate(unary_union(cells), angle, origin=(0, 0))
    if retained.geom_type != "Polygon" or not retained.is_valid:
        return rooms, 0.0
    # Only donations that form usable, connected extensions are accepted.
    result = [dict(r) for r in rooms]
    target = next(r for r in result if r["id"] == hall_room["id"])
    reclaimed = 0.0
    for p in polygons(hall.difference(retained)):
        choices = []
        for r in result:
            if r["kind"] in {"hallway", "stair", "toilet", "full_bathroom", "closet"}:
                continue
            merged = r["shape"].union(p)
            if (
                shared(p, r["shape"]).length > 0.2
                and merged.geom_type == "Polygon"
                and merged.is_valid
            ):
                choices.append((-shared(p, r["shape"]).length, r, merged))
        remaining = target["shape"].difference(p)
        if choices and remaining.geom_type == "Polygon" and remaining.is_valid:
            _, r, merged = min(choices, key=lambda q: q[0])
            r["shape"] = merged
            target["shape"] = remaining
            reclaimed += p.area
    for r in result:
        if "hall" in r:
            r["hall"] = target["shape"]
    return result, reclaimed


def blind_corridor_ends(hall, portal_lines):
    """Detect full-width closed corridor caps extending beyond every destination.

    A turning recess shorter than 1.4m is retained as approach space. A genuine
    branch must contain a straight 0.86m-wide route for at least that distance.
    """
    boundary = hall.simplify(0.00001, preserve_topology=True)
    result = []
    for a, b in pairwise(boundary.exterior.coords):
        edge = LineString([a, b])
        if not 0.95 <= edge.length <= 1.35:
            continue
        c = edge.interpolate(0.5, normalized=True)
        if any(c.distance(p) <= 1.4 for p in portal_lines):
            continue
        nx, ny = -(b[1] - a[1]) / edge.length, (b[0] - a[0]) / edge.length
        if not hall.covers(Point(c.x + nx * 0.2, c.y + ny * 0.2)):
            nx, ny = -nx, -ny
        route = LineString([(c.x + nx * 0.45, c.y + ny * 0.45), (c.x + nx * 1.5, c.y + ny * 1.5)])
        if hall.buffer(0.001).covers(route.buffer(0.42, cap_style=2)):
            result.append(edge)
    return result


def trim_blind_ends(rooms, openings):
    result = [dict(r) for r in rooms]
    hall = next(r for r in result if r["kind"] == "hallway")
    portals = [
        LineString(o["segment"]["coordinates"]) for o in openings if hall["id"] in o["rooms"]
    ]
    protected = unary_union([p.buffer(0.65, cap_style=1) for p in portals])
    reclaimed = 0.0
    for _ in range(24):
        caps = blind_corridor_ends(hall["shape"], portals)
        changed = False
        for edge in caps:
            a, b = edge.coords[0], edge.coords[-1]
            ux, uy = (b[0] - a[0]) / edge.length, (b[1] - a[1]) / edge.length
            nx, ny = -uy, ux
            c = edge.interpolate(0.5, normalized=True)
            if not hall["shape"].covers(Point(c.x + nx * 0.2, c.y + ny * 0.2)):
                nx, ny = -nx, -ny
            depth = 0.0
            # Stop at the first destination or widening into a junction.
            for i in range(1, 801):
                d = i * 0.05
                cross = LineString(
                    [
                        (a[0] + nx * d - ux * 0.03, a[1] + ny * d - uy * 0.03),
                        (b[0] + nx * d + ux * 0.03, b[1] + ny * d + uy * 0.03),
                    ]
                )
                inner = LineString(
                    [
                        (a[0] + nx * d + ux * 0.02, a[1] + ny * d + uy * 0.02),
                        (b[0] + nx * d - ux * 0.02, b[1] + ny * d - uy * 0.02),
                    ]
                )
                if (
                    not hall["shape"].buffer(0.001).covers(inner)
                    or hall["shape"].intersection(cross).length > edge.length + 0.035
                    or cross.intersects(protected)
                ):
                    break
                depth = d
            if depth < 0.25:
                continue
            strip = Polygon(
                [
                    a,
                    b,
                    (b[0] + nx * depth, b[1] + ny * depth),
                    (a[0] + nx * depth, a[1] + ny * depth),
                ]
            )
            # Snap only overlay arithmetic at 0.1 micrometre resolution. Rotating
            # shared edges otherwise produces false disconnected unions at ~1e-15m.
            donation = hall["shape"].intersection(strip, grid_size=1e-7)
            remaining = hall["shape"].difference(strip, grid_size=1e-7)
            remaining_parts = polygons(remaining)
            if len(remaining_parts) == 1:
                remaining = remaining_parts[0]
            if (
                donation.geom_type != "Polygon"
                or remaining.geom_type != "Polygon"
                or not remaining.is_valid
            ):
                continue
            choices = []
            for r in result:
                if r["kind"] in {"hallway", "stair", "toilet", "full_bathroom"}:
                    continue
                seam = shared(donation, r["shape"]).length
                merged = r["shape"].union(donation, grid_size=1e-7)
                if (
                    seam > 0.25
                    and merged.geom_type == "Polygon"
                    and merged.is_valid
                    and (r["kind"] != "closet" or merged.area <= 6.5)
                ):
                    choices.append((-seam, r, merged))
            if choices:
                _, recipient, merged = min(choices, key=lambda q: q[0])
                recipient["shape"] = merged
                hall["shape"] = remaining
                reclaimed += donation.area
                changed = True
                break
        if not changed:
            break
    return result, reclaimed


def storage_half_bath(rooms, hall, room_fits):
    """Offer an additional hall-access WC before leaving surplus as a large cupboard."""
    if any(r["kind"] == "toilet" for r in rooms):
        return rooms, 0
    for room in sorted(rooms, key=lambda r: r["shape"].area, reverse=True):
        if room["kind"] != "closet" or shared(room["shape"], hall).length < 0.96:
            continue
        options = (
            [(room["shape"], Polygon())]
            if 3 <= room["shape"].area <= 5.5
            else compact_wet_candidates(room["shape"], hall, "toilet")
        )
        for wet, extra in options:
            wc = {**room, "kind": "toilet", "shape": wet}
            if not room_fits(wc):
                continue
            trial = [wc if r["id"] == room["id"] else dict(r) for r in rooms]
            try:
                _allocate_extra(trial, extra, hall, wc["id"], 0, room_fits)
            except ValueError:
                continue
            changed = [
                r
                for r in trial
                if r["id"] == wc["id"]
                or not any(
                    old["id"] == r["id"] and old["shape"].equals(r["shape"]) for old in rooms
                )
            ]
            if all(room_fits({**r, "_preview_rooms": trial}) for r in changed):
                return trial, 1
    return rooms, 0


def hall_laundry_niche(rooms, openings, room_fits):
    """Turn an otherwise blind hall end into a fitted stacked-laundry destination."""
    hall = next(r for r in rooms if r["kind"] == "hallway")
    portals = [
        LineString(o["segment"]["coordinates"]) for o in openings if hall["id"] in o["rooms"]
    ]
    protected = unary_union([o_line.buffer(0.70, cap_style=3) for o_line in portals])
    for edge in blind_corridor_ends(hall["shape"], portals):
        a, b = edge.coords[0], edge.coords[-1]
        nx, ny = -(b[1] - a[1]) / edge.length, (b[0] - a[0]) / edge.length
        c = edge.interpolate(0.5, normalized=True)
        if not hall["shape"].covers(Point(c.x + nx * 0.2, c.y + ny * 0.2)):
            nx, ny = -nx, -ny
        for depth in (1.8, 1.9, 2.0):
            niche = Polygon(
                [
                    a,
                    b,
                    (b[0] + nx * depth, b[1] + ny * depth),
                    (a[0] + nx * depth, a[1] + ny * depth),
                ]
            )
            if not hall["shape"].buffer(1e-6).covers(niche) or niche.intersects(protected):
                continue
            niche = hall["shape"].intersection(niche, grid_size=1e-7)
            rest = polygons(hall["shape"].difference(niche, grid_size=1e-7))
            if (
                niche.geom_type != "Polygon"
                or len(rest) != 1
                or shared(niche, rest[0]).length < 1.06
            ):
                continue
            laundry = {
                "id": hall["id"] + ":laundry",
                "kind": "utility",
                "shape": niche,
                "laundry_stack": True,
                "reused_space": "former_hall_end",
            }
            trial = [
                {**r, "shape": rest[0]} if r["id"] == hall["id"] else dict(r) for r in rooms
            ] + [laundry]
            if room_fits({**laundry, "_preview_rooms": trial}):
                return trial, niche.area
    return rooms, 0.0
