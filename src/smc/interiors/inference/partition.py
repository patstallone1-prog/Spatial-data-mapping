"""Search connected circulation cuts instead of stretching a rectangular template.

Each cut must leave connected usable rooms and join the existing circulation network.
Candidates with slivers or disconnected wings are discarded; no outline area is invented.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from smc.interiors.inference.model import HouseInput

HALL_WIDTH = 1.12
WALL_INSET = 0.15


def polygons(g) -> list[Polygon]:
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for x in getattr(g, "geoms", []) for p in polygons(x)]


def lines(g) -> list[LineString]:
    if g.is_empty:
        return []
    if g.geom_type == "LineString":
        coords = list(g.simplify(1e-7).coords)
        return [LineString([a, b]) for a, b in itertools.pairwise(coords) if math.dist(a, b) > 0.02]
    return [p for x in getattr(g, "geoms", []) for p in lines(x)]


def width(p: Polygon) -> float:
    q = list(p.minimum_rotated_rectangle.exterior.coords)
    return min(math.dist(q[i], q[i + 1]) for i in range(4))


def shared(a, b):
    return a.boundary.intersection(b.boundary.buffer(1e-6, cap_style=2))


def split_candidates(p: Polygon, hall, count: int, compact=False):
    x0, y0, x1, y1 = p.bounds
    for axis in (0, 1):
        lo, hi = ((x0, x1), (y0, y1))[axis]
        for f in (0.5, 0.4, 0.6, 0.3, 0.7, 0.42, 0.58) if compact else (0.5, 0.4, 0.6, 0.3, 0.7):
            v = lo + (hi - lo) * f
            cutter = (
                box(v - HALL_WIDTH / 2, y0 - 1, v + HALL_WIDTH / 2, y1 + 1)
                if axis == 0
                else box(x0 - 1, v - HALL_WIDTH / 2, x1 + 1, v + HALL_WIDTH / 2)
            )
            seam = p.intersection(cutter)
            parts = polygons(p.difference(cutter))
            if len(parts) != 2 or len(polygons(seam)) != 1:
                continue
            if hall is not None and shared(seam, hall).length < HALL_WIDTH * 0.7:
                continue
            if any(q.area < 7 or width(q) < (1.5 if compact else 2.25) for q in parts):
                continue
            if compact and max(width(q) for q in parts) < 2.25:
                continue
            areas = sorted(q.area for q in parts)
            # A remaining one-room leaf may be a bathroom; leave enough area for beds elsewhere.
            ratio = 1 / max(2, count)
            score = abs(areas[0] / sum(areas) - ratio) + seam.area / p.area * 0.3
            yield score, parts, seam


def subdivide(regions: list[Polygon], hall, count: int, compact=False):
    regions = list(regions)
    while len(regions) < count:
        choices = []
        for i, p in enumerate(regions):
            for cost, parts, seam in split_candidates(p, hall, count - len(regions) + 1, compact):
                choices.append((cost - p.area / 200, i, parts, seam))
        if not choices:
            raise ValueError("not enough space for the requested room program and circulation")
        _, i, parts, seam = min(choices, key=lambda c: c[0])
        regions[i : i + 1] = parts
        hall = unary_union([hall, seam])
    return regions, hall


def open_split(p: Polygon, ratio: float = 0.5, preferred_axis: int = 0) -> tuple[Polygon, Polygon]:
    """Split functional zones with no wall or corridor between them."""
    x0, y0, x1, y1 = p.bounds
    choices = []
    for axis in (0, 1):
        lo, hi = ((x0, x1), (y0, y1))[axis]
        for f in (ratio, 0.5, 0.4, 0.6):
            v = lo + (hi - lo) * f
            half = box(x0 - 1, y0 - 1, v, y1 + 1) if axis == 0 else box(x0 - 1, y0 - 1, x1 + 1, v)
            a, b = p.intersection(half), p.difference(half)
            if a.geom_type != "Polygon" or b.geom_type != "Polygon":
                continue
            if min(a.area, b.area) < 6 or min(width(a), width(b)) < 2.0:
                continue
            choices.append((abs(a.area / p.area - ratio) + (axis != preferred_axis), a, b))
    if not choices:
        raise ValueError("public space cannot fit distinct kitchen, living and dining zones")
    _, a, b = min(choices, key=lambda c: c[0])
    return a, b


@dataclass
class Partition:
    angle: float
    floors: list[dict]
    stair: Polygon | None
    cost: float


def _partition_candidates(
    spec: HouseInput,
    ground_beds: int | None = None,
    public_axis: int = 0,
    kitchen_axis: int = 0,
    stair_preference: float = 0.5,
) -> list[Partition]:
    """Try orientations and circulation positions; one room program for all candidates."""
    n = len(spec.storeys)
    total = sum(
        (s.footprint if s.footprint is not None else spec.footprint).area for s in spec.storeys
    )
    bedrooms = spec.bedrooms or max(1, min(5, int(total / 55 + 0.5)))
    origin = spec.footprint.centroid.coords[0]
    rect = list(spec.footprint.minimum_rotated_rectangle.exterior.coords)
    a, b = max(itertools.pairwise(rect), key=lambda ab: math.dist(*ab))
    bearing = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    choices = []
    for angle in (bearing, bearing + 90, bearing + 180, bearing + 270):
        floors = [
            affinity.rotate(
                s.footprint if s.footprint is not None else spec.footprint, -angle, origin=origin
            ).buffer(-WALL_INSET, join_style=2)
            for s in spec.storeys
        ]
        if any(p.geom_type != "Polygon" for p in floors):
            continue
        x0, y0, x1, y1 = floors[0].bounds
        entrance = (
            affinity.rotate(Point(spec.entrance), -angle, origin=origin)
            if spec.entrance is not None
            else Point((x0 + x1) / 2, y0 - WALL_INSET)
        )
        for fraction in (0.42, 0.50, 0.58, 0.34, 0.66):
            y = y0 + (y1 - y0) * fraction
            strip = box(
                min(p.bounds[0] for p in floors) - 1,
                y - HALL_WIDTH / 2,
                max(p.bounds[2] for p in floors) + 1,
                y + HALL_WIDTH / 2,
            )
            stair = None
            if n > 1:
                risers = math.ceil(max(s.height_m for s in spec.storeys[:-1]) / 0.18)
                run = math.ceil(risers / 2) * 0.27 + 1.12
                common = floors[0]
                for p in floors[1:]:
                    common = common.intersection(p)
                for f in (stair_preference, 0.5, 0.3, 0.7, 0.2, 0.8):
                    x = x0 + (x1 - x0) * f
                    candidate = box(
                        x - 1.12, y - HALL_WIDTH / 2 - run, x + 1.12, y - HALL_WIDTH / 2
                    )
                    if common.covers(candidate.buffer(0.03, join_style=2)):
                        stair = candidate
                        break
                if stair is None:
                    continue
            built = []
            bed_left = bedrooms
            try:
                for level, p in enumerate(floors):
                    hall = p.intersection(strip)
                    if hall.geom_type != "Polygon":
                        raise ValueError("disconnected hall")
                    available = p.difference(stair) if stair is not None else p
                    parts = polygons(available.difference(strip))
                    if len(parts) != 2 or any(q.area < 8 for q in parts):
                        raise ValueError("disconnected or unusable wings")
                    rooms = []
                    if level == 0:
                        public = min(parts, key=lambda q: q.distance(entrance))
                        private = [q for q in parts if q is not public]
                        # In multi-storey homes the private sleeping floor is upstairs, unless
                        # there are enough bedrooms to need an accessible ground-floor bedroom.
                        beds = (
                            bed_left
                            if n == 1
                            else ground_beds
                            if ground_beds is not None
                            else max(0, bedrooms - 3 * (n - 1))
                        )
                        utility = n > 1 and private[0].area > 24 and not spec.office
                        count = beds + 1 + int(spec.office) + int(utility)
                        private, hall = subdivide(private, hall, count, spec.compact_program)
                        # Kitchen and dining share a wide boundary and open directly to living.
                        living, rest = open_split(public, 0.52, public_axis)
                        if rest.distance(entrance) + 0.05 < living.distance(entrance):
                            living, rest = rest, living
                        kitchen, dining = open_split(rest, 0.55, kitchen_axis)
                        rooms.extend([("living", living), ("kitchen", kitchen), ("dining", dining)])
                    else:
                        beds = math.ceil(bed_left / (n - level))
                        private, hall = subdivide(parts, hall, beds + 1, spec.compact_program)
                    private.sort(key=lambda q: q.area)
                    bath = private.pop(0)
                    # A compact ground floor WC is allowed only when a full bath exists above.
                    rooms.append(("toilet" if n > 1 and level == 0 else "full_bathroom", bath))
                    if level == 0 and n > 1 and utility:
                        rooms.append(("utility", private.pop(0)))
                    if level == 0 and spec.office:
                        rooms.append(("office", private.pop(0)))
                    private.sort(key=lambda q: -q.area)
                    for q in private:
                        rooms.append(("primary_bedroom" if bed_left == bedrooms else "bedroom", q))
                        bed_left -= 1
                    if hall.geom_type != "Polygon":
                        raise ValueError("hall network must stay connected")
                    if any(
                        shared(q, hall).length < 0.84
                        for k, q in rooms
                        if k not in {"living", "kitchen", "dining"}
                    ):
                        raise ValueError("private room has no full-width access from the hall")
                    built.append({"rooms": rooms, "hall": hall, "inside": p})
                if bed_left:
                    continue
                # Penalise circulation cost, small beds and entrance through a private wing.
                cost = sum(f["hall"].area / f["inside"].area for f in built) / n
                if n > 1:
                    cost += sum("bedroom" in k for k, _ in built[0]["rooms"]) * 0.15
                cost += (
                    min(
                        q.distance(entrance)
                        for k, q in built[0]["rooms"]
                        if k in {"living", "kitchen", "dining"}
                    )
                    / 5
                )
                cost += sum(
                    max(0, 11 - q.area) * 0.1
                    for f in built
                    for k, q in f["rooms"]
                    if "bedroom" in k
                )
                choices.append(Partition(angle, built, stair, cost))
            except ValueError:
                continue
    if not choices:
        raise ValueError(
            "no feasible single-family plan: reduce the room program or revise the "
            "footprint; narrow/disconnected wings are not silently filled"
        )
    answers = sorted(choices, key=lambda p: p.cost)
    for answer in answers:
        restore_frame(answer, origin)
    return answers


def restore_frame(answer: Partition, origin) -> None:
    for floor in answer.floors:
        floor["rooms"] = [
            (k, affinity.rotate(p, answer.angle, origin=origin)) for k, p in floor["rooms"]
        ]
        for key in ("hall", "inside"):
            floor[key] = affinity.rotate(floor[key], answer.angle, origin=origin)
    if answer.stair is not None:
        answer.stair = affinity.rotate(answer.stair, answer.angle, origin=origin)


def partition_candidates(spec: HouseInput) -> list[Partition]:
    options = []
    diagnostics = []
    for ground_beds in (0, None) if len(spec.storeys) > 1 else (None,):
        for public_axis in (0, 1):
            for kitchen_axis in (0, 1):
                for stair_preference in (0.5, 0.25, 0.75) if len(spec.storeys) > 1 else (0.5,):
                    try:
                        options.extend(
                            _partition_candidates(
                                spec, ground_beds, public_axis, kitchen_axis, stair_preference
                            )
                        )
                    except ValueError as exc:
                        diagnostics.append(str(exc))
    if not options:
        raise ValueError("; ".join(dict.fromkeys(diagnostics)))
    return sorted(options, key=lambda candidate: candidate.cost)


def choose_partition(spec: HouseInput) -> Partition:
    return partition_candidates(spec)[0]
