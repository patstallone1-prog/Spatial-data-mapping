"""Furniture with door setbacks, physical support and traversable interaction points."""

from __future__ import annotations

import itertools
import math

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.model import geo
from smc.interiors.inference.partition import polygons

WALK_RADIUS = 0.28


def oriented_box(x: float, y: float, w: float, d: float, angle: float) -> Polygon:
    return affinity.translate(
        affinity.rotate(box(-w / 2, -d / 2, w / 2, d / 2), angle, origin=(0, 0)), x, y
    )


def inward_point(p: Polygon, line, distance: float = 0.65) -> Point:
    a, b = next(iter(line.coords)), list(line.coords)[-1]
    length = math.dist(a, b)
    c = line.interpolate(0.5, normalized=True)
    nx, ny = -(b[1] - a[1]) / length, (b[0] - a[0]) / length
    for sign in (1, -1):
        q = Point(c.x + nx * distance * sign, c.y + ny * distance * sign)
        if p.buffer(0.001).covers(q):
            return q
    return p.representative_point()


class RoomFurnisher:
    def __init__(
        self,
        room: dict,
        style: dict,
        catalog: Catalog,
        portals: list,
        floor_y: float,
        portal_zones: list | None = None,
        windows: list | None = None,
        walk_radius: float = WALK_RADIUS,
    ):
        self.room, self.style, self.catalog = room, style, catalog
        self.p = room["shape"]
        self.floor_y = floor_y
        self.windows = windows or []
        self.walk_radius = walk_radius
        self.items: list[dict] = []
        self.obstacles: list[Polygon] = []
        self.targets: list[Point] = []
        self.reservations: list[Polygon] = []
        self.door_zones = (
            portal_zones
            if portal_zones is not None
            else [line.buffer(0.72, cap_style=2) for line in portals]
        )
        self.starts = [inward_point(self.p, line) for line in portals]
        self.safe = self.p.buffer(-0.065, join_style=2)

    def reachable(self, obstacle: Polygon | None = None, target: Point | None = None) -> bool:
        obstacles = self.obstacles + ([obstacle] if obstacle is not None else [])
        free = self.p.buffer(-self.walk_radius, join_style=2)
        if obstacles:
            free = free.difference(unary_union(obstacles).buffer(self.walk_radius, join_style=2))
        points = self.starts + self.targets + ([target] if target is not None else [])
        return not points or any(
            all(part.buffer(0.015).covers(q) for q in points) for part in polygons(free)
        )

    def fits(self, poly: Polygon, target: Point | None = None) -> bool:
        return (
            self.safe.covers(poly)
            and not any(poly.intersects(z) for z in self.door_zones)
            and not any(
                poly.buffer(0.055, join_style=2).intersects(p)
                for p in self.obstacles + self.reservations
            )
            and self.reachable(poly, target)
        )

    def put(
        self,
        role,
        x,
        y,
        w,
        d,
        h,
        angle=0.0,
        *,
        required=False,
        supported_by=None,
        base_y=None,
        target=None,
        solid=True,
    ):
        poly = oriented_box(x, y, w, d, angle)
        if supported_by is None and not self.fits(poly, target):
            return None
        if supported_by is None:
            base = self.floor_y if base_y is None else base_y
            for window in self.windows:
                a, b = window["a"], window["b"]
                length = math.dist(a, b)
                ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
                u, width = window["u"], window["w"]
                edge = LineString(
                    [
                        (a[0] + ux * u, a[1] + uy * u),
                        (a[0] + ux * (u + width), a[1] + uy * (u + width)),
                    ]
                )
                if (
                    base + h > window["v"] + 0.02
                    and base < window["v"] + window["h"]
                    and poly.intersects(edge.buffer(0.23, cap_style=2))
                ):
                    return None
        index = len(self.items)
        item = {
            "id": f"{self.room['id']}:item:{index}",
            "role": role,
            "position_m": [x, self.floor_y if base_y is None else base_y, y],
            "size_m": [w, h, d],
            "rotation_deg": angle,
            "footprint": geo(poly),
            "room_id": self.room["id"],
            "required": required,
            "support": {
                "kind": "object" if supported_by else "floor",
                "id": supported_by["id"] if supported_by else self.room["id"],
                "surface_y_m": self.floor_y if base_y is None else base_y,
            },
            "asset": self.catalog.choose(role, self.style, (w, h, d), f"{self.room['id']}:{index}"),
            "materials": self.room["materials"],
            "grade": "inferred",
        }
        if target is not None:
            item["interaction_point_m"] = [target.x, target.y]
        self.items.append(item)
        if solid and supported_by is None:
            self.obstacles.append(poly)
            if target is not None:
                self.targets.append(target)
        return item

    def wall_spots(self, w, d):
        coords = list(self.p.exterior.coords)
        edges = sorted(itertools.pairwise(coords), key=lambda ab: -math.dist(*ab))
        for a, b in edges:
            length = math.dist(a, b)
            if length < w + 0.2:
                continue
            ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
            nx, ny = -uy, ux
            mid = Point((a[0] + b[0]) / 2 + nx * 0.15, (a[1] + b[1]) / 2 + ny * 0.15)
            if not self.p.covers(mid):
                nx, ny = -nx, -ny
            angle = math.degrees(math.atan2(-nx, ny))
            count = max(2, math.ceil((length - w - 0.2) / 0.24))
            ts = [w / 2 + 0.1 + (length - w - 0.2) * i / count for i in range(count + 1)]
            ts.sort(key=lambda t: abs(t - length / 2))
            for t in ts:
                x = a[0] + ux * t + nx * (d / 2 + 0.075)
                y = a[1] + uy * t + ny * (d / 2 + 0.075)
                target = Point(
                    x + nx * (d / 2 + max(0.43, self.walk_radius + 0.08)),
                    y + ny * (d / 2 + max(0.43, self.walk_radius + 0.08)),
                )
                yield x, y, angle, target, nx, ny

    def wall(self, role, sizes, *, required=False, bed=False):
        for w, d, h in sizes:
            for x, y, angle, target, nx, ny in self.wall_spots(w, d):
                if bed:
                    # The head backs onto a wall. A full-width foot aisle and one side remain
                    # clear, so a bed cannot be boxed in by storage on every side.
                    foot = oriented_box(
                        x + nx * (d / 2 + 0.38), y + ny * (d / 2 + 0.38), w, 0.7, angle
                    )
                    side_a = oriented_box(
                        x - ny * (w / 2 + 0.36), y + nx * (w / 2 + 0.36), 0.65, d, angle
                    )
                    side_b = oriented_box(
                        x + ny * (w / 2 + 0.36), y - nx * (w / 2 + 0.36), 0.65, d, angle
                    )
                    if not self.p.covers(foot) or not any(
                        self.p.covers(s) for s in (side_a, side_b)
                    ):
                        continue
                item = self.put(role, x, y, w, d, h, angle, required=required, target=target)
                if item:
                    if bed:
                        item["reserved_clearance"] = geo(foot)
                        self.reservations.append(foot)
                        side = next(s for s in (side_a, side_b) if self.p.covers(s))
                        item["side_clearance"] = geo(side)
                        self.reservations.append(side)
                    return item
        if required:
            raise ValueError(f"{self.room['id']}: no reachable {role} fits")
        return None

    def centre(self, role, sizes, required=False, surround=0.0):
        c = self.p.centroid
        x0, y0, x1, y1 = self.p.bounds
        spots = [(c.x, c.y)] + [
            (x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * j / 8)
            for i in range(1, 8)
            for j in range(1, 8)
        ]
        spots.sort(key=lambda q: math.dist(q, (c.x, c.y)))
        for w, d, h in sizes:
            for angle in (0, 90):
                for x, y in spots:
                    envelope = oriented_box(x, y, w + surround * 2, d + surround * 2, angle)
                    if surround and not self.fits(envelope):
                        continue
                    item = self.put(role, x, y, w, d, h, angle, required=required)
                    if item:
                        return item
        if required:
            raise ValueError(f"{self.room['id']}: no {role} fits")
        return None

    def dining_set(self):
        c = self.p.centroid
        x0, y0, x1, y1 = self.p.bounds
        spots = [
            (x0 + (x1 - x0) * i / 12, y0 + (y1 - y0) * j / 12)
            for i in range(1, 12)
            for j in range(1, 12)
        ]
        spots.sort(key=lambda q: math.dist(q, (c.x, c.y)))
        for w, d in ((1.3, 0.8), (0.9, 0.75)):
            for angle in (0, 90):
                a = math.radians(angle)
                for x, y in spots:
                    table_poly = oriented_box(x, y, w, d, angle)
                    chairs, targets = [], []
                    for sign in (-1, 1):
                        off = d / 2 + 0.32
                        cx, cy = x - math.sin(a) * off * sign, y + math.cos(a) * off * sign
                        chairs.append((cx, cy, oriented_box(cx, cy, 0.43, 0.43, angle)))
                        targets.append(
                            Point(cx - math.sin(a) * sign * 0.60, cy + math.cos(a) * sign * 0.60)
                        )
                    assembly = unary_union([table_poly] + [c[2] for c in chairs])
                    if not self.fits(assembly):
                        continue
                    old_targets = self.targets
                    self.targets = old_targets + targets
                    works = self.reachable(assembly)
                    self.targets = old_targets
                    if not works:
                        continue
                    table = self.put("dining_table", x, y, w, d, 0.75, angle, required=True)
                    if table is None:
                        continue
                    self.on_top(table)
                    for i, (cx, cy, _) in enumerate(chairs):
                        self.put(
                            "dining_chair",
                            cx,
                            cy,
                            0.43,
                            0.43,
                            0.85,
                            angle + (180 if i else 0),
                            target=targets[i],
                            required=True,
                        )
                    return
        raise ValueError(f"{self.room['id']}: no reachable dining set fits")

    def on_top(self, parent, role="table_item", size=(0.19, 0.19, 0.12)):
        if parent is None:
            return
        x, base, y = parent["position_m"]
        w, d, h = size
        # Same XY centre, explicit support reference and exact contact elevation.
        self.put(
            role,
            x,
            y,
            w,
            d,
            h,
            parent["rotation_deg"],
            supported_by=parent,
            base_y=base + parent["size_m"][1],
            solid=False,
        )

    def furnish(self):
        kind = self.room["kind"]
        if "bedroom" in kind:
            beds = [(1.8, 2.05, 0.9), (1.5, 2, 0.85), (0.95, 2, 0.8)]
            if self.style["tier"] == "economy" or kind == "bedroom":
                beds = beds[1:]
            self.wall("bed", beds, required=True, bed=True)
            table = self.wall("nightstand", [(0.45, 0.4, 0.5)])
            self.on_top(table, "counter_item", (0.1, 0.1, 0.1))
            self.wall("dresser", [(0.9, 0.45, 0.85)])
        elif kind == "living":
            self.wall("sofa", [(2.2, 0.85, 0.85), (1.65, 0.8, 0.8)], required=True)
            table = self.centre("coffee_table", [(0.9, 0.5, 0.4), (0.6, 0.45, 0.4)])
            self.on_top(table)
            self.wall("armchair", [(0.75, 0.8, 0.9)])
        elif kind == "dining":
            self.dining_set()
        elif kind == "kitchen":
            self.wall("sink_counter", [(0.85, 0.62, 0.91)], required=True)
            self.wall("cooker", [(0.65, 0.62, 0.91)], required=True)
            self.wall("refrigerator", [(0.72, 0.72, 1.85)], required=True)
            counter = self.wall("counter", [(1.0, 0.62, 0.91), (0.65, 0.62, 0.91)])
            self.on_top(counter, "counter_item")
        elif kind in {"full_bathroom", "toilet"}:
            self.wall("toilet", [(0.55, 0.72, 0.78)], required=True)
            self.wall("bath_sink", [(0.65, 0.5, 0.85)], required=True)
            if kind == "full_bathroom":
                self.wall("bath_shower", [(1.6, 0.75, 2.05), (1.45, 0.7, 2.05)], required=True)
        elif kind == "office":
            desk = self.wall("desk", [(1.2, 0.6, 0.75), (0.95, 0.55, 0.75)], required=True)
            x, _, y = desk["position_m"]
            a = math.radians(desk["rotation_deg"])
            nx, ny = -math.sin(a), math.cos(a)
            cx, cy = (
                x + nx * (desk["size_m"][2] / 2 + 0.34),
                y + ny * (desk["size_m"][2] / 2 + 0.34),
            )
            target = Point(cx + nx * 0.6, cy + ny * 0.6)
            previous = Point(desk["interaction_point_m"])
            self.targets = [p for p in self.targets if p.distance(previous) > 0.001]
            desk["interaction_point_m"] = [target.x, target.y]
            chair = self.put(
                "office_chair",
                cx,
                cy,
                0.48,
                0.48,
                0.9,
                desk["rotation_deg"] + 180,
                target=target,
                required=True,
            )
            if chair is None:
                raise ValueError(f"{self.room['id']}: desk has no reachable chair position")
            self.on_top(desk, "counter_item", (0.12, 0.12, 0.13))
            self.wall("bookshelf", [(0.8, 0.3, 1.7)])
        elif kind == "closet":
            self.wall("closet_rail", [(0.8, 0.36, 1.65), (0.55, 0.3, 1.65)])
        elif kind == "utility":
            self.wall("washing_machine", [(0.62, 0.62, 0.9)])
        return self.items
