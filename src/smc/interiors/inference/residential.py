"""Compose independent homes, communal circulation and evidence-aligned garages."""

from __future__ import annotations

import copy
import math
from dataclasses import replace
from itertools import combinations, pairwise, product

from shapely import affinity, set_precision
from shapely.errors import GEOSException
from shapely.geometry import Point, box, shape
from shapely.ops import unary_union

from smc.interiors.inference.catalog import Catalog
from smc.interiors.inference.engine import PUBLIC, infer_house, opening, stairs
from smc.interiors.inference.furnish import RoomFurnisher
from smc.interiors.inference.garages import furnish_garage, garage_door, garage_plans
from smc.interiors.inference.level_changes import garage_transition
from smc.interiors.inference.model import HouseInput, StoreyInput, geo, stamp_inference
from smc.interiors.inference.partition import lines, shared, width
from smc.interiors.inference.style import door_finish, house_style, room_materials


def _tidy(p):
    p = set_precision(p, 1e-7)
    if p.geom_type != "Polygon" or not p.is_valid or p.is_empty:
        raise ValueError("residential division is disconnected or invalid")
    return p


def _room(key, kind, p, style):
    p = _tidy(p)
    materials = room_materials(style, kind, 0)
    if kind in {"garage", "shared_workshop"}:
        materials.update(floor="#91948d", floor_finish="concrete", wall=style["walls"][0])
    elif kind == "communal_lobby":
        materials.update(floor=style["stone"], floor_finish="tile")
    return dict(
        id=key,
        kind=kind,
        polygon=geo(p),
        area_m2=p.area,
        materials=materials,
        unit_id=None,
    )


def _walls(floor):
    walls = []
    for a, b in combinations(floor["rooms"], 2):
        if a.get("unit_id") == b.get("unit_id") and a["kind"] in PUBLIC and b["kind"] in PUBLIC:
            continue
        boundary = shared(shape(a["polygon"]), shape(b["polygon"]))
        for o in floor["openings"]:
            if set(o["rooms"]) == {a["id"], b["id"]}:
                boundary = boundary.difference(shape(o["segment"]).buffer(0.001))
        for line in lines(boundary):
            if line.length < 0.01:
                continue
            p, q = line.coords[0], line.coords[-1]
            c = line.centroid
            left = Point(
                c.x - (q[1] - p[1]) / line.length * 0.08, c.y + (q[0] - p[0]) / line.length * 0.08
            )
            colors = [a["materials"]["wall"], b["materials"]["wall"]]
            walls.append(
                dict(
                    segment=geo(line),
                    elevation_m=min(
                        a.get("elevation_m", floor["elevation_m"]),
                        b.get("elevation_m", floor["elevation_m"]),
                    ),
                    height_m=floor["height_m"]
                    - 0.15
                    - min(a.get("elevation_m", 0), b.get("elevation_m", 0)),
                    thickness_m=0.12,
                    rooms=[a["id"], b["id"]],
                    materials=colors,
                    side_materials=colors if shape(a["polygon"]).covers(left) else colors[::-1],
                )
            )
    floor["walls"] = walls


def _refurnish(floor, room, catalog, style, envelope):
    if room["kind"] in {"hallway", "stair", "communal_lobby", "shared_workshop", "shared_lounge"}:
        return
    portals = [o for o in floor["openings"] if room["id"] in o["rooms"]]
    r = {**room, "shape": shape(room["polygon"])}
    items = RoomFurnisher(
        r,
        style,
        catalog,
        [shape(o["segment"]) for o in portals],
        floor["elevation_m"],
        portal_zones=[shape(o["clearance"]) for o in portals],
        windows=(envelope or {}).get("windows", []),
    ).furnish()
    floor["objects"] = [o for o in floor["objects"] if o["room_id"] != room["id"]] + items


def _garage_access(floor, plan, catalog, style, envelope, accept=None):
    for room in sorted(floor["rooms"], key=lambda r: r["kind"] != "hallway"):
        if room["kind"] not in PUBLIC | {"communal_lobby", "shared_lounge", "shared_workshop"}:
            continue
        for line in sorted(
            lines(shared(shape(room["polygon"]), plan["shape"])), key=lambda x: -x.length
        ):
            if line.length < 1.05:
                continue
            for fraction in (0.5, 0.25, 0.75):
                portal = opening(
                    room, plan, line, "single_door", len(floor["openings"]), 0.9, fraction
                )
                portal.update(
                    garage_access=True,
                    appearance=door_finish(style, "garage", portal["id"]),
                    fire_separation="inferred self-closing door; rating unverified",
                )
                floor["openings"].append(portal)
                saved_objects = list(floor["objects"])
                try:
                    _refurnish(floor, room, catalog, style, envelope)
                    return (portal, accept(portal)) if accept else portal
                except (ValueError, GEOSException):
                    floor["objects"] = saved_objects
                    floor["openings"].pop()
    raise ValueError("garage has no clear pedestrian door to the home or common lobby")


def _attach_garages(result, plans, catalog):
    if not plans:
        return
    f = result["storeys"][0]
    style = result["style"]
    records = []
    for _i, plan in enumerate(plans):
        f["openings"].append(garage_door(plan, len(f["openings"])))

        def accept(portal, plan=plan):
            transition = garage_transition(plan, portal)
            items, bays, supports = furnish_garage(
                plan,
                style,
                catalog,
                f["openings"],
                f["height_m"] - plan["elevation_m"],
                occupied_above=len(result["storeys"]) > 1,
                windows=(result.get("envelope") or {}).get("windows", []),
                transition=transition,
            )
            return items, bays, supports, transition

        _, (items, bays, supports, transition) = _garage_access(
            f, plan, catalog, style, result.get("envelope"), accept
        )
        room = _room(plan["id"], "garage", plan["shape"], style)
        room["elevation_m"] = plan["elevation_m"]
        f["rooms"].append(room)
        f.setdefault("surface_patches", []).append(
            {
                "room_id": plan["id"],
                "polygon": geo(plan["shape"]),
                "elevation_m": plan["elevation_m"],
            }
        )
        if transition:
            f.setdefault("level_changes", []).append(transition)
        f["objects"].extend(items)
        records.append(
            dict(
                id=plan["id"],
                room_id=plan["id"],
                level=0,
                capacity=plan["capacity"],
                parking_bays=bays,
                source_segment=plan["source_segment"],
                source_opening=plan["evidence"],
                parking_mode="tandem" if plan["rows"] > 1 else "side_by_side",
                structure=supports,
                grade="inferred",
                measured=False,
                confidence=0.2,
                freshness=None,
                corroboration_count=0,
            )
        )
    result["garages"] = records
    _walls(f)


def _single_room_garage(spec, plans, catalog, style):
    inside = _tidy(spec.footprint.buffer(-0.15, join_style=2))
    ground = _tidy(inside.difference(unary_union([p["shape"] for p in plans])))
    if ground.area < 48:
        raise ValueError("remaining ground floor cannot fit the house program")
    floors = (
        StoreyInput(spec.storeys[0].height_m, ground.buffer(0.15, join_style=2)),
        *spec.storeys[1:],
    )
    child = replace(spec, storeys=floors, garages=(), garage_cars=None, units_per_floor=None)
    result = infer_house(child, catalog, style=style)
    result["schema"] = "kerbside.inferred_residential/1"
    result["households"] = 1
    result["garage_mode"] = "room"
    result["residential_units"] = []
    for f in result["storeys"]:
        for r in f["rooms"]:
            r["unit_id"] = spec.id + ":unit:1"
    result["residential_units"] = [
        dict(
            id=spec.id + ":unit:1",
            levels=list(range(len(spec.storeys))),
            room_ids=[r["id"] for f in result["storeys"] for r in f["rooms"]],
            entrance_ids=[
                o["id"] for f in result["storeys"] for o in f["openings"] if o.get("entrance")
            ],
        )
    ]
    result["storeys"][0].update(footprint=geo(spec.footprint), inside=geo(inside))
    _attach_garages(result, plans, catalog)
    return result


def _allocations(spec, garage_floor):
    n = len(spec.storeys)
    if spec.units_per_floor is not None:
        if garage_floor and spec.units_per_floor[0]:
            raise ValueError("garage-only floor has residential units assigned")
        return [spec.units_per_floor]
    if spec.households == 1:
        return [tuple([0] + [1] * (n - 1))] if garage_floor else [tuple([1] * n)]
    if n - int(garage_floor) > spec.households:
        # Duplex/triplex homes keep one owner across contiguous levels. Common stairs
        # remain available to the other homes without entering those private levels.
        return [tuple(([0] if garage_floor else []) + [1] * (n - int(garage_floor)))]
    choices = []
    for counts in product(range(spec.households + 1), repeat=n):
        if (
            sum(counts) != spec.households
            or (garage_floor and counts[0])
            or (not garage_floor and not counts[0])
        ):
            continue
        if any(c == 0 for c in counts[1:]):
            continue
        score = (
            max(counts)
            - min(counts[1:] if garage_floor else counts)
            + sum(c * c for c in counts) * 0.1
        )
        choices.append((score, counts))
    if not choices:
        raise ValueError(
            "floor program needs more independent homes than requested; supply units_per_floor"
        )
    return [c for _, c in sorted(choices)[:3]]


def _courtyard_grid(spec, plans, angle, counts):
    if len(spec.storeys) != 1 or counts[0] < 3 or plans or spec.entrance is None:
        raise ValueError("cross-corridor scheme needs a single residential floor")
    origin = spec.footprint.centroid.coords[0]
    inside = _tidy(spec.footprint.buffer(-0.15, join_style=2))
    p = affinity.rotate(inside, -angle, origin=origin)
    entry = affinity.rotate(Point(spec.entrance), -angle, origin=origin)
    x0, y0, x1, y1 = p.bounds
    if abs(entry.y - y0) > 0.9:
        raise ValueError("cross corridor entrance is on another face")
    mid = (y0 + y1) / 2
    stem_x = max(x0, min(x1 - 1.65, entry.x - 0.825))
    lobby = _tidy(
        p.intersection(
            unary_union(
                [
                    box(x0 - 1, mid - 0.825, x1 + 1, mid + 0.825),
                    box(stem_x, y0 - 1, stem_x + 1.65, mid),
                ]
            )
        )
    )
    regions = []
    for count, mask in (
        (counts[0] // 2, box(x0 - 1, y0 - 1, x1 + 1, mid - 0.825)),
        (counts[0] - counts[0] // 2, box(x0 - 1, mid + 0.825, x1 + 1, y1 + 1)),
    ):
        wing = _tidy(p.intersection(mask).difference(lobby))
        last = x0 - 1
        for i in range(count):
            lo, hi = last, x1 + 1
            for _ in range(45):
                m = (lo + hi) / 2
                if wing.intersection(box(last, y0 - 1, m, y1 + 1)).area < wing.area / count:
                    lo = m
                else:
                    hi = m
            end = (lo + hi) / 2 if i < count - 1 else x1 + 1
            q = _tidy(wing.intersection(box(last, y0 - 1, end, y1 + 1)))
            if q.area < 50 or width(q) < 2.9:
                raise ValueError("grid apartment is too small")
            regions.append(affinity.rotate(q, angle, origin=origin))
            last = end
    return [
        dict(
            inside=inside,
            core=None,
            lobby=affinity.rotate(lobby, angle, origin=origin),
            regions=regions,
            remainder=None,
        )
    ]


def _partition_building(spec, plans, angle, side, counts, style, compact=False):
    """One common strip and staircase shared by floors; unit polygons retain the outline."""
    if compact == "grid":
        return _courtyard_grid(spec, plans, angle, counts)
    origin = spec.footprint.centroid.coords[0]
    insides = [
        _tidy((s.footprint or spec.footprint).buffer(-0.15, join_style=2)) for s in spec.storeys
    ]
    locals = [affinity.rotate(p, -angle, origin=origin) for p in insides]
    common = locals[0]
    for p in locals[1:]:
        common = common.intersection(p)
    x0, y0, x1, y1 = common.bounds
    strip_w = 2.24 if len(insides) > 1 else 1.65
    sx = x0 if side == 0 else x1 - strip_w
    band = box(sx, y0 - 1, sx + strip_w, y1 + 1)
    core = None
    if len(insides) > 1:
        depth = max(4.2, math.ceil(max(s.height_m for s in spec.storeys) / 0.18 / 2) * 0.26 + 1.12)
        core = _tidy(box(sx, y1 - depth, sx + 2.24, y1))
        if not compact and not common.buffer(0.001).covers(core):
            raise ValueError("no aligned common stair core inside every floor")
    if compact:
        if max(counts) > 2 or spec.entrance is None:
            raise ValueError(
                "compact entry core requires at most two units per floor and an entrance"
            )
        entry = affinity.rotate(Point(spec.entrance), -angle, origin=origin)
        if abs(entry.y - y0) > 0.9:
            raise ValueError("entry does not face the compact core")
        band_width = 3.5
        sx = max(x0, min(x1 - band_width, entry.x - band_width / 2))
        if len(insides) > 1:
            core = _tidy(
                box(
                    sx + (1.26 if side else 0),
                    y0 + 1.5,
                    sx + (1.26 if side else 0) + 2.24,
                    y0 + 1.5 + depth,
                )
            )
            if not common.buffer(0.002).covers(core):
                raise ValueError("compact stair core does not fit inside the supplied outline")
            band = box(sx, y0 - 1, sx + band_width, y0 + 1.5 + depth + 1.2)
        else:
            core = None
            band = box(sx, y0 - 1, sx + band_width, y0 + 2.4)
    frames = []
    for level, (inside, local, count) in enumerate(zip(insides, locals, counts, strict=True)):
        # One-family homes above a garage use the common flight only to reach the home.
        shared_level = spec.households > 1 or level <= 1
        lobby = _tidy(local.intersection(band)) if shared_level else None
        if core is not None and shared_level:
            lobby = _tidy(lobby.difference(core))
        if shared_level and (lobby.area < 2 or width(lobby) < 1.4):
            raise ValueError("common lobby is too narrow")
        occupied = (
            [affinity.rotate(p["shape"], -angle, origin=origin) for p in plans]
            if level == 0
            else []
        )
        if lobby is not None and any(
            lobby.intersection(g).area > 0.002
            or (core is not None and core.intersection(g).area > 0.002)
            for g in occupied
        ):
            raise ValueError("recorded garage conflicts with the common entry/stair core")
        remaining = local.difference(band) if shared_level else local
        if occupied:
            remaining = remaining.difference(unary_union(occupied))
        remaining = _tidy(remaining)
        regions = []
        if count:
            # Split true polygon area. Compact cores divide homes left/right;
            # perimeter cores divide along the corridor.
            axis = 0 if compact and count > 1 else 1
            lo0, hi0 = (remaining.bounds[axis], remaining.bounds[axis + 2])
            last = lo0 - 1
            for i in range(count):
                lo, hi = last, hi0 + 1

                def cutter(end, last=last, axis=axis):
                    return (
                        box(last, y0 - 100, end, y1 + 100)
                        if axis == 0
                        else box(x0 - 100, last, x1 + 100, end)
                    )

                if i < count - 1:
                    target = remaining.area / count
                    for _ in range(45):
                        mid = (lo + hi) / 2
                        if remaining.intersection(cutter(mid)).area < target:
                            lo = mid
                        else:
                            hi = mid
                    end = (lo + hi) / 2
                else:
                    end = hi0 + 1
                region = _tidy(remaining.intersection(cutter(end)))
                if region.area < 50 or width(region) < 2.9:
                    raise ValueError("an independent apartment has insufficient usable space")
                regions.append(affinity.rotate(region, angle, origin=origin))
                last = end
        frames.append(
            dict(
                inside=inside,
                core=affinity.rotate(core, angle, origin=origin)
                if core is not None and shared_level
                else None,
                lobby=affinity.rotate(lobby, angle, origin=origin) if lobby is not None else None,
                regions=regions,
                remainder=affinity.rotate(remaining, angle, origin=origin) if not count else None,
            )
        )
    return frames


def _unit_house(spec, uid, regions, levels, lobbies, catalog, style):
    region = regions[0]
    lobby = lobbies[0]
    edges = [line for line in lines(shared(region, lobby)) if line.length > 1.15]
    if not edges:
        raise ValueError("apartment has no private entrance from common circulation")
    failures = []
    for edge in sorted(edges, key=lambda q: -q.length)[:2]:
        for fraction in (0.5, 0.25, 0.75):
            c = edge.interpolate(fraction, normalized=True)
            raw = region.buffer(0.15, join_style=2)
            point = raw.boundary.interpolate(raw.boundary.project(c))
            envelope = copy.deepcopy(spec.envelope or {})
            elevation = sum(s.height_m for s in spec.storeys[: levels[0]])
            for w in envelope.get("windows", []):
                w["v"] -= elevation
            try:
                child = HouseInput(
                    uid,
                    raw,
                    tuple(
                        StoreyInput(spec.storeys[level].height_m, p.buffer(0.15, join_style=2))
                        for p, level in zip(regions, levels, strict=True)
                    ),
                    entrance=(point.x, point.y),
                    bedrooms=max(1, min(3, int(sum(p.area for p in regions) / 95))),
                    neighborhood_price_per_sqft=spec.neighborhood_price_per_sqft,
                    source=spec.source,
                    envelope=envelope,
                    compact_program=True,
                )
                return infer_house(child, catalog, style=style)
            except (ValueError, GEOSException) as exc:
                failures.append(str(exc))
    raise ValueError(
        "apartment room program/entry failed: " + "; ".join(dict.fromkeys(failures))[:800]
    )


def _compose(spec, plans, frames, counts, catalog, style, garage_floor):
    floors = []
    elev = 0
    common_stairs = []
    for level, (s, frame) in enumerate(zip(spec.storeys, frames, strict=True)):
        f = dict(
            level=level,
            elevation_m=elev,
            height_m=s.height_m,
            footprint=geo(s.footprint or spec.footprint),
            inside=geo(frame["inside"]),
            rooms=[],
            openings=[],
            objects=[],
            walls=[],
            slab_holes=[],
            space_efficiency={"hallway_reclaimed_m2": 0},
        )
        if frame["lobby"] is not None:
            f["rooms"].append(
                _room(f"{spec.id}:L{level}:common", "communal_lobby", frame["lobby"], style)
            )
        if frame["core"] is not None:
            f["rooms"].append(_room(f"{spec.id}:L{level}:stair", "stair", frame["core"], style))
            common = f["rooms"][0]
            core = f["rooms"][1]
            access = [
                q for q in lines(shared(frame["core"], frame["lobby"])) if 2.20 <= q.length <= 2.28
            ]
            if not access:
                raise ValueError("stairs have no full-width landing")
            line = (
                min(access, key=lambda q: q.distance(Point(spec.entrance)))
                if spec.entrance
                else access[0]
            )
            f["openings"].append(opening(core, common, line, "full_access", 0))
            if level < len(spec.storeys) - 1 and frames[level + 1]["core"] is not None:
                st = stairs(frame["core"], frame["lobby"], elev, s.height_m, level, line)
                st.update(
                    from_room=core["id"],
                    to_room=f"{spec.id}:L{level + 1}:stair",
                    communal=spec.households > 1,
                )
                common_stairs.append(st)
            if level > 0 and frames[level - 1]["core"] is not None:
                f["slab_holes"].append(geo(frame["core"]))
        if frame["remainder"] is not None:
            # Garage floors keep a usable workshop/storage room, not anonymous blank floor.
            r = _room(
                f"{spec.id}:L{level}:shared",
                "shared_workshop" if garage_floor and level == 0 else "shared_lounge",
                frame["remainder"],
                style,
            )
            f["rooms"].append(r)
            line = max(lines(shared(frame["remainder"], frame["lobby"])), key=lambda x: x.length)
            f["openings"].append(
                opening(r, f["rooms"][0], line, "doorway", len(f["openings"]), 1.1)
            )
        if level == spec.entrance_level:
            lobby = f["rooms"][0]
            p = shape(lobby["polygon"])
            edges = [e for e in lines(shared(p, frame["inside"])) if e.length >= 1.2]
            if not edges:
                raise ValueError("common entrance has no outside wall")
            line = (
                min(edges, key=lambda e: e.distance(Point(spec.entrance)))
                if spec.entrance
                else min(edges, key=lambda e: e.centroid.y)
            )
            if spec.entrance and line.distance(Point(spec.entrance)) > 0.35:
                raise ValueError("common entrance cannot align with supplied entrance")
            door = opening(lobby, None, line, "single_door", len(f["openings"]), 1.05)
            if spec.entrance:
                t = max(0.6, min(line.length - 0.6, line.project(Point(spec.entrance))))
                door = opening(
                    lobby, None, line, "single_door", len(f["openings"]), 1.05, t / line.length
                )
            door.update(
                entrance=True, appearance=door_finish(style, "communal_lobby", door["id"], True)
            )
            f["openings"].append(door)
        floors.append(f)
        elev += s.height_m
    units = []
    groups = []
    if spec.households == 1:
        levels = [i for i, c in enumerate(counts) if c]
        groups = [(f"{spec.id}:unit:1", levels, [frames[i]["regions"][0] for i in levels])]
    elif (
        spec.units_per_floor is None
        and sum(bool(n) for n in counts) > spec.households
        and max(counts) == 1
    ):
        levels = [i for i, c in enumerate(counts) if c]
        q, remainder = divmod(len(levels), spec.households)
        start = 0
        for i in range(spec.households):
            own = levels[start : start + q + int(i < remainder)]
            groups.append(
                (f"{spec.id}:unit:{i + 1}", own, [frames[level]["regions"][0] for level in own])
            )
            start += len(own)
    else:
        for level, frame in enumerate(frames):
            for p in frame["regions"]:
                groups.append((f"{spec.id}:unit:{len(groups) + 1}", [level], [p]))
    for uid, levels, regions in groups:
        child = _unit_house(
            spec, uid, regions, levels, [frames[i]["lobby"] for i in levels], catalog, style
        )
        record = dict(
            id=uid,
            levels=levels,
            room_ids=[],
            entrance_ids=[],
            measured=False,
            confidence=0.2,
            freshness=None,
            corroboration_count=0,
        )
        for local, f in enumerate(child["storeys"]):
            target = floors[levels[local]]
            offset = target["elevation_m"] - f["elevation_m"]
            for room in f["rooms"]:
                room["unit_id"] = uid
            for item in f["objects"]:
                item["position_m"][1] += offset
                if "surface_y_m" in item["support"]:
                    item["support"]["surface_y_m"] += offset
                item["unit_id"] = uid
            for o in f["openings"]:
                if "outside" in o["rooms"]:
                    o["rooms"] = [
                        target["rooms"][0]["id"] if k == "outside" else k for k in o["rooms"]
                    ]
                    o.update(entrance=False, unit_entrance=True, unit_id=uid)
                    o["appearance"] = door_finish(style, "bedroom", o["id"])
                    record["entrance_ids"].append(o["id"])
            target["rooms"] += f["rooms"]
            target["objects"] += f["objects"]
            target["openings"] += f["openings"]
            target["slab_holes"] += f["slab_holes"]
            record["room_ids"] += [r["id"] for r in f["rooms"]]
        for st in child["stairs"]:
            lo, hi = st["from_level"], st["to_level"]
            offset = floors[levels[0]]["elevation_m"]
            st.update(
                id=uid + ":" + st["id"],
                from_room=f"{uid}:L{lo}:stair",
                to_room=f"{uid}:L{hi}:stair",
                from_level=levels[lo],
                to_level=levels[hi],
                communal=False,
                unit_id=uid,
            )
            for step in st["steps"]:
                step["top_m"] += offset
            common_stairs.append(st)
        units.append(record)
    result = dict(
        schema="kerbside.inferred_residential/1",
        id=spec.id,
        units="metres",
        households=spec.households,
        grade="inferred",
        measured=False,
        confidence=0.2,
        style=style,
        storeys=floors,
        stairs=common_stairs,
        residential_units=units,
        total_height_m=elev,
        envelope=copy.deepcopy(spec.envelope),
        garages=[],
        garage_mode="floor" if garage_floor else "room" if plans else "auto",
        provenance={
            "footprint": spec.source,
            "layout": "separate inferred homes and common circulation",
            "freshness": None,
            "corroboration_count": 0,
            "not_an_as_built_survey": True,
        },
    )
    _attach_garages(result, plans, catalog)
    # Common amenities stay in common rooms and cannot displace an entry or stair approach.
    laundry_installed = False
    for f in floors:
        for room in f["rooms"]:
            if room.get("unit_id") or room["kind"] in {"stair", "garage"}:
                continue
            portals = [o for o in f["openings"] if room["id"] in o["rooms"]]
            furnisher = RoomFurnisher(
                {**room, "shape": shape(room["polygon"])},
                style,
                catalog,
                [shape(o["segment"]) for o in portals],
                f["elevation_m"],
                portal_zones=[shape(o["clearance"]) for o in portals],
                windows=(spec.envelope or {}).get("windows", []),
            )
            if f["level"] == 0 and room["kind"] == "communal_lobby":
                furnisher.wall("mailboxes", [(0.65, 0.22, 1.1)], required=False)
            elif room["kind"] in {"shared_workshop", "shared_lounge"}:
                furnisher.wall("storage_cabinet", [(1.1, 0.5, 1.8)], required=False)
                furnisher.wall("workbench", [(1.4, 0.65, 0.9)], required=False)
            if not laundry_installed:
                washer = furnisher.wall("washing_machine", [(0.65, 0.65, 1.75)], required=False)
                if washer:
                    washer["size_m"][1] = 0.9
                    furnisher.on_top(washer, "clothes_dryer", (0.65, 0.65, 0.85))
                    laundry_installed = True
            f["objects"] += furnisher.items
        _walls(f)
    return result


def infer_residential(spec, catalog=None):
    from smc.interiors.inference.residential_validate import validate_residential

    catalog = catalog or Catalog()
    plans = garage_plans(spec)
    style = house_style(
        spec.id,
        sum((s.footprint or spec.footprint).area for s in spec.storeys),
        spec.neighborhood_price_per_sqft,
    )
    failures = []
    if spec.households == 1 and plans and spec.garage_mode != "floor" and spec.entrance_level == 0:
        try:
            result = _single_room_garage(spec, plans, catalog, style)
            stamp_inference(result, 0.2)
            result["validation"] = validate_residential(result)
            if result["validation"]["passed"]:
                return result
            failures += result["validation"]["errors"]
        except (ValueError, GEOSException) as exc:
            failures.append(str(exc))
        if spec.garage_mode == "room":
            raise ValueError("garage room layout failed: " + "; ".join(failures)[:1200])
    inside = spec.footprint.buffer(-0.15, join_style=2)
    garage_floor = bool(
        plans
        and (
            spec.garage_mode == "floor"
            or (
                spec.garage_mode == "auto"
                and sum(p["shape"].area for p in plans) > inside.area * 0.45
            )
        )
    )
    if (
        spec.households == 1
        and plans
        and (failures or spec.entrance_level > 0)
        and spec.garage_mode == "auto"
    ):
        garage_floor = True
    if garage_floor and len(spec.storeys) < 2:
        raise ValueError("garage-only floor leaves no floor for the home")
    rect = list(spec.footprint.minimum_rotated_rectangle.exterior.coords)
    a, b = max(pairwise(rect), key=lambda ab: math.dist(*ab))
    base = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
    for counts in _allocations(spec, garage_floor):
        for compact in (False, True, "grid"):
            for rotation in (0, 90, 180, 270):
                for side in (0, 1):
                    try:
                        frames = _partition_building(
                            spec, plans, base + rotation, side, counts, style, compact=compact
                        )
                        result = _compose(spec, plans, frames, counts, catalog, style, garage_floor)
                        stamp_inference(result, 0.2)
                        result["validation"] = validate_residential(result)
                        if not result["validation"]["passed"]:
                            raise ValueError("; ".join(result["validation"]["errors"][:5]))
                        result["search"] = {
                            "candidates_tried": len(failures) + 1,
                            "rejected": list(dict.fromkeys(failures)),
                            "address_specific_rules": False,
                            "units_per_floor": list(counts),
                        }
                        return result
                    except (ValueError, GEOSException) as exc:
                        failures.append(str(exc))
    raise ValueError(
        "no feasible residential program: " + "; ".join(dict.fromkeys(failures))[:2000]
    )
