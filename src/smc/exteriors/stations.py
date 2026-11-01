"""Evidence-preserving fuel forecourts and EV bays; dimensions are rendering priors."""

from __future__ import annotations

import copy
import hashlib
import json
import math
from itertools import pairwise

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box, mapping, shape
from shapely.ops import unary_union

from smc.exteriors.engine import infer_exterior
from smc.exteriors.library import library, normal
from smc.exteriors.model import ExteriorInput


def evidence(source=None, refs=()):
    source = source or {}
    measured = bool(source.get("measured"))
    inferred = bool(source.get("inferred", not measured))
    return dict(
        measured=measured,
        inferred=inferred,
        confidence=source.get("confidence", 0.9 if measured else 0.35),
        freshness=source.get("captured_at"),
        corroboration_count=source.get("corroboration_count", 1 if measured else 0),
        references=list(refs),
    )


def rectangle(center, length, width, heading=0):
    """Heading follows the long/vehicle axis, CCW from local east, in degrees."""
    x, y = center
    return affinity.rotate(
        box(x - length / 2, y - width / 2, x + length / 2, y + width / 2), heading, origin=center
    )


def _record(row, refs):
    p = copy.deepcopy(row)
    p["evidence"] = evidence(row, refs)
    if row.get("measured") or row.get("source_id"):
        p["source_record"] = copy.deepcopy(row)
    return p


def _prices(row, identity, refs):
    supplied = row.get("prices")
    if supplied is not None:
        if supplied.get("currency") != "USD" or supplied.get("unit") != "US_gallon":
            raise ValueError("fuel price sign requires USD per US_gallon")
        if not supplied.get("rows") or not supplied.get("source_id"):
            raise ValueError("observed prices require rows and a source_id")
        for p in supplied["rows"]:
            if not 0 < float(p["price"]) < 100 or not math.isfinite(float(p["price"])):
                raise ValueError("invalid fuel price")
            if p.get("payment") not in {"cash", "credit", "all"}:
                raise ValueError("price payment basis must be explicit")
        return {
            **copy.deepcopy(supplied),
            "illustrative": not bool(supplied.get("measured"))
            or bool(supplied.get("inferred", False)),
            "evidence": evidence(supplied, refs),
        }
    cents = 429 + int(hashlib.sha256(identity.encode()).hexdigest()[:4], 16) % 70
    cents = cents // 10 * 10 + 9
    return dict(
        currency="USD",
        unit="US_gallon",
        illustrative=True,
        label="ILLUSTRATIVE PRICES",
        rows=[
            dict(grade=g, price=round((cents + n) / 100 + 0.009, 3), payment="all")
            for g, n in [("Regular", 0), ("Plus", 20), ("Premium", 40)]
        ],
        evidence=evidence(refs=refs),
    )


def infer_station(row):
    """Fit to a supplied lot polygon. Never reinterpret a canopy as a whole parcel."""
    original = copy.deepcopy(row)
    if row.get("units", "metres") != "metres":
        raise ValueError("station requires local metres")
    site = shape(row["site_polygon"])
    if not isinstance(site, Polygon) or not site.is_valid or site.area < 20:
        raise ValueError("station needs a valid actual site Polygon")
    heading = float(row.get("heading_degrees", 0))
    if not math.isfinite(heading):
        raise ValueError("invalid station heading")
    mode = row["kind"]
    if mode not in {"fuel", "ev"}:
        raise ValueError("station kind must be fuel or ev")
    data = library()
    wanted = normal(row.get("brand") or row.get("name"))
    brand = next(
        (
            k
            for k, v in data["station_brands"].items()
            if wanted == k or wanted in [normal(a) for a in v["aliases"]]
        ),
        None,
    )
    style = data.get("station_brands", {}).get(brand, data["station_brands"]["generic_" + mode])
    refs = style["references"]
    local = affinity.rotate(site, -heading, origin=(0, 0))

    def transform(p):
        return affinity.rotate(p, heading, origin=(0, 0))

    def worldpoint(p):
        a = transform(Point(p))
        return [a.x, a.y]

    def item(kind, p, **fields):
        return dict(
            kind=kind, polygon=mapping(transform(p)), evidence=evidence(refs=refs), **fields
        )

    plan = dict(
        schema="kerbside.inferred_station/1",
        id=str(row["id"]),
        name=row["name"],
        kind=mode,
        brand=brand,
        style=copy.deepcopy(style),
        site_polygon=copy.deepcopy(row["site_polygon"]),
        site_geometry_sha256=hashlib.sha256(site.wkb).hexdigest(),
        canonical_geometry_modified=False,
        origin_lon_lat=row.get("origin_lon_lat"),
        canonical_points=copy.deepcopy(row.get("canonical_points")),
        evidence=evidence(row.get("geometry_evidence"), refs),
        references=[s for s in data["sources"] if s["id"] in refs],
        bays=[],
        devices=[],
        islands=[],
        canopies=[],
        price_sign=None,
        store=None,
        obstacles=[],
        entrances=[],
        routes=[],
        source_input=original,
        scope="visual inference, not construction or swept-path certification",
    )
    errors, warnings = [], []
    obstacles = []
    for o in row.get("obstacles", []):
        p = shape(o["polygon"])
        obstacles.append(affinity.rotate(p, -heading, origin=(0, 0)))
        plan["obstacles"].append(_record(o, refs))
    if row.get("store"):
        store = row["store"]
        p = shape(store["footprint"])
        if not site.covers(p):
            errors.append("store extends beyond supplied site")
        store_plan = infer_exterior(ExteriorInput.from_json(store))
        plan["store"] = store_plan
        if not store_plan["validation"]["passed"]:
            errors.append("attached convenience store failed exterior validation")
        from smc.exteriors.interiors import interior_envelope
        from smc.interiors.stores.engine import infer_store
        from smc.interiors.stores.model import StoreInput

        envelope = interior_envelope(store_plan)
        plan["store_interior"] = infer_store(
            StoreInput.from_json(
                dict(
                    id=store["id"],
                    footprint=store["footprint"],
                    height_m=store["height_m"],
                    kind="corner_store",
                    entrances=envelope["exterior_entrances"],
                    envelope=envelope,
                )
            )
        )
        obstacles.append(affinity.rotate(p, -heading, origin=(0, 0)).buffer(0.9))
    blocked = unary_union(obstacles)
    free = local.difference(blocked)
    xmin, ymin, xmax, _ymax = local.bounds
    entry_y = ymin + 1.1
    entrances = row.get("entrances") or [
        dict(center=worldpoint([xmin + 3, entry_y]), width=5.5),
        dict(center=worldpoint([xmax - 3, entry_y]), width=5.5),
    ]
    for e in entrances:
        if not math.isfinite(float(e["width"])) or e["width"] < 2.4:
            raise ValueError("vehicle entry width is invalid")
        plan["entrances"].append(_record(e, refs))
    limit = row.get("requested_bays", 8)
    if type(limit) is not int or not 1 <= limit <= 80:
        raise ValueError("requested_bays must be 1..80")
    # Space reserved beside the road for the pylon, not in a car/entry corridor.
    sign_box = box(xmin + 0.25, ymin + 0.4, xmin + 2.45, ymin + 1.0)
    if mode == "fuel" and free.covers(sign_box):
        plan["price_sign"] = item(
            "price_sign",
            sign_box,
            center=worldpoint(sign_box.centroid.coords[0]),
            heading_degrees=heading,
            prices=_prices(row, str(row["id"]), refs),
        )
    source_bays = row.get("parking_stalls")
    if mode == "fuel" and source_bays:
        raise ValueError("fuel bays are bound to pump faces; supply fuel_islands instead")
    if mode == "ev":
        if source_bays is not None:
            for s in source_bays:
                if not all(
                    math.isfinite(float(s[k])) for k in ("length_m", "width_m", "heading_degrees")
                ):
                    raise ValueError("invalid observed parking dimensions")
                p = rectangle(s["center"], s["length_m"], s["width_m"], s["heading_degrees"])
                bay = _record(s, refs)
                bay.update(kind="ev_bay", polygon=mapping(p))
                plan["bays"].append(bay)
        else:
            # A front drive aisle, rear equipment strip and rear pedestrian route remain free.
            for y in [ymin + 7.8, ymin + 22.3, ymin + 36.8]:
                for i in range(max(0, int((xmax - xmin - 5) / 2.9))):
                    x = xmin + 3.1 + i * 2.9
                    p = rectangle((x, y), 5.8, 2.8, 90)
                    equipment = rectangle((x, y + 3.75), 1.3, 1.3)
                    walk = box(x - 1.4, y + 4.45, x + 1.4, y + 5.95)
                    if free.covers(p.union(equipment).union(walk)) and len(plan["bays"]) < limit:
                        plan["bays"].append(
                            item(
                                "ev_bay",
                                p,
                                id=f"bay-{len(plan['bays']) + 1}",
                                center=worldpoint((x, y)),
                                length_m=5.8,
                                width_m=2.8,
                                heading_degrees=heading + 90,
                            )
                        )
        supplied_devices = {str(d["bay_id"]): d for d in row.get("chargers", [])}
        ids = [str(b["id"]) for b in plan["bays"]]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate parking stall identity")
        if len(supplied_devices) != len(row.get("chargers", [])) or not set(
            supplied_devices
        ) <= set(ids):
            raise ValueError("charger must refer to exactly one existing parking bay")
        for b in plan["bays"]:
            h = math.radians(b["heading_degrees"])
            f = (math.cos(h), math.sin(h))
            side = (-f[1], f[0])
            center = [b["center"][i] + f[i] * (b["length_m"] / 2 + 0.85) for i in range(2)]
            supplied = supplied_devices.get(str(b["id"]))
            if supplied:
                center = supplied["center"]
            d = _record(supplied or {}, refs)
            family = row.get("charger_family", style.get("hardware", "generic_dc"))
            reach = (
                3.76 if family == "chargepoint_express250" else 2.0 if family == "tesla_v3" else 3.5
            )
            d.update(
                kind="charger",
                id=f"charger-{b['id']}",
                bay_id=b["id"],
                center=center,
                heading_degrees=(supplied or {}).get("heading_degrees", b["heading_degrees"] + 180),
                polygon=mapping(rectangle(center, 0.65, 0.71, b["heading_degrees"])),
                family=family,
                cable_reach_m=reach,
                served_port=[
                    b["center"][i] + f[i] * (b["length_m"] / 2 - 0.45) - side[i] * 0.72
                    for i in range(2)
                ],
                wheel_stop=[b["center"][i] + f[i] * (b["length_m"] / 2 - 0.45) for i in range(2)],
                bollards=[[center[i] + side[i] * s for i in range(2)] for s in [-0.65, 0.65]],
            )
            d["position_evidence"] = evidence(supplied, refs)
            d["evidence"] = evidence(refs=refs)
            plan["devices"].append(d)
    else:
        supplied = row.get("fuel_islands")
        candidates = []
        if supplied is not None:
            candidates = supplied
        else:
            columns = min(
                max(0, int((xmax - xmin - 10) / 10)), math.ceil(math.sqrt(max(1, limit // 2)))
            )
            for y in [ymin + 8.2, ymin + 18.8, ymin + 29.4]:
                for x in [xmin + 8.5 + i * 10 for i in range(columns)]:
                    if (len(candidates) + 1) * 2 > limit:
                        break
                    if free.covers(rectangle((x, y), 7.4, 8.8)):
                        candidates.append(
                            dict(
                                id=f"island-{len(candidates) + 1}",
                                center=worldpoint((x, y)),
                                heading_degrees=heading,
                            )
                        )
        for island in candidates:
            c = island["center"]
            h = island["heading_degrees"]
            a = math.radians(h)
            side = (-math.sin(a), math.cos(a))
            ip = rectangle(c, 5.5, 1.2, h)
            p = _record(island, refs)
            p.update(kind="fuel_island", polygon=mapping(ip), length_m=5.5, width_m=1.2)
            p["position_evidence"] = evidence(island, refs)
            p["evidence"] = evidence(refs=refs)
            plan["islands"].append(p)
            device = _record(island, refs)
            device["position_evidence"] = evidence(island, refs)
            device["evidence"] = evidence(refs=refs)
            device.update(
                id="pump-" + str(island["id"]),
                kind="fuel_pump",
                center=c,
                heading_degrees=h,
                polygon=mapping(rectangle(c, 1.25, 0.65, h)),
                faces=[],
            )
            for s in [-1, 1]:
                bc = [c[i] + side[i] * s * 2.25 for i in range(2)]
                bid = f"{island['id']}:{s}"
                bay = dict(
                    kind="fuel_bay",
                    id=bid,
                    center=bc,
                    length_m=6.4,
                    width_m=3.1,
                    heading_degrees=h,
                    polygon=mapping(rectangle(bc, 6.4, 3.1, h)),
                    evidence=evidence(refs=refs),
                )
                plan["bays"].append(bay)
                device["faces"].append(
                    dict(
                        bay_id=bid,
                        normal=[side[i] * s for i in range(2)],
                        nozzle_side="vehicle_facing",
                        hose_length_m=3.5,
                    )
                )
            plan["devices"].append(device)
        for i, island in enumerate(plan["islands"]):
            # Modular row canopies allow concave lots without covering unsupplied neighboring land.
            p = rectangle(island["center"], 7.4, 8.8, island["heading_degrees"])
            a = math.radians(island["heading_degrees"])
            supports = [
                [island["center"][i] + s * (math.cos(a), math.sin(a))[i] for i in range(2)]
                for s in [-2, 2]
            ]
            plan["canopies"].append(
                dict(
                    kind="canopy",
                    id=f"canopy-{i}",
                    polygon=mapping(p),
                    underside_m=4.6,
                    thickness_m=0.45,
                    supports=supports,
                    evidence=evidence(refs=refs),
                )
            )
        merged = []
        for canopy in plan["canopies"]:
            found = False
            for previous in merged:
                hull = shape(previous["polygon"]).union(shape(canopy["polygon"])).convex_hull
                # A row can share a roof; a deep void between rows remains open sky.
                if (
                    hull.area
                    <= shape(previous["polygon"]).area + shape(canopy["polygon"]).area + 26
                    and site.covers(hull)
                    and not hull.intersects(transform(blocked))
                ):
                    previous["polygon"] = mapping(hull)
                    previous["supports"] += canopy["supports"]
                    found = True
                    break
            if not found:
                merged.append(canopy)
        plan["canopies"] = merged
        if row.get("canopies") is not None:
            plan["canopies"] = [_record(c, refs) for c in row["canopies"]]
    # Routes test an occupied neighboring bay as an obstacle, rather than driving through it.
    static = (
        [shape(d["polygon"]) for d in plan["devices"]]
        + [shape(i["polygon"]) for i in plan["islands"]]
        + [transform(p) for p in obstacles]
    )
    if plan["price_sign"]:
        static.append(shape(plan["price_sign"]["polygon"]))
    for bay in plan["bays"]:
        c = bay["center"]
        a = math.radians(bay["heading_degrees"])
        blocked_routes = unary_union(
            static + [shape(b["polygon"]) for b in plan["bays"] if b is not bay]
        )
        allowed = site.difference(blocked_routes)
        candidates = []
        ends = (
            [
                (
                    c[0] + math.cos(a) * s * (bay["length_m"] / 2 + 2),
                    c[1] + math.sin(a) * s * (bay["length_m"] / 2 + 2),
                )
                for s in [-1, 1]
            ]
            if mode == "fuel"
            else [
                (
                    c[0] - math.cos(a) * (bay["length_m"] / 2 + 3),
                    c[1] - math.sin(a) * (bay["length_m"] / 2 + 3),
                )
            ]
        )
        for end in ends:
            e = affinity.rotate(Point(end), -heading, origin=(0, 0))
            for entry in plan["entrances"]:
                ep = affinity.rotate(Point(entry["center"]), -heading, origin=(0, 0))
                for corner in [(e.x, ep.y), (ep.x, e.y)]:
                    points = [c, end, worldpoint(corner), entry["center"]]
                    path = LineString(points)
                    if allowed.buffer(1e-7).covers(path.buffer(0.95, cap_style=2, join_style=2)):
                        candidates.append((path.length, points))
        if candidates:
            plan["routes"].append(
                dict(
                    bay_id=bay["id"],
                    points=min(candidates, key=lambda v: v[0])[1],
                    clear_width_m=1.9,
                    evidence=evidence(refs=refs),
                )
            )
        else:
            errors.append(f"{bay['id']}: no unobstructed vehicle approach")
    if not plan["bays"]:
        errors.append("site cannot fit any service bays")
    # Store pedestrians have their own reserved approach, ending at an actual facade entry.
    plan["pedestrian_routes"] = []
    if plan["store"]:
        for face in plan["store"]["facades"]:
            for o in face["openings"]:
                if o["component_kind"] != "door":
                    continue
                L = math.dist(face["a"], face["b"])
                u = o["u"] + o["w"] / 2
                p = [
                    face["a"][i] + (face["b"][i] - face["a"][i]) * u / L + face["normal"][i] * 0.05
                    for i in range(2)
                ]
                end = [p[i] + face["normal"][i] * 2 for i in range(2)]
                route = LineString([p, end]).buffer(0.65, cap_style=2)
                if site.covers(route) and not route.intersects(
                    unary_union(
                        [shape(d["polygon"]) for d in plan["devices"]]
                        + [shape(b["polygon"]) for b in plan["bays"]]
                    )
                ):
                    plan["pedestrian_routes"].append(
                        dict(points=[p, end], width_m=1.3, evidence=evidence(refs=refs))
                    )
        if not plan["pedestrian_routes"]:
            errors.append("store entrance has no reserved pedestrian approach")
    plan["validation"] = validate_station(plan)
    plan["validation"]["errors"] += errors
    if len(plan["bays"]) < limit and source_bays is None:
        warnings.append("capacity reduced to fit actual site; requested capacity is not guaranteed")
    plan["validation"]["warnings"] += warnings
    plan["validation"]["passed"] = not plan["validation"]["errors"]
    plan["content_sha256"] = hashlib.sha256(
        json.dumps(plan, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()
    return plan


def validate_station(plan):
    errors = []
    site = shape(plan["site_polygon"])
    if hashlib.sha256(site.wkb).hexdigest() != plan["site_geometry_sha256"]:
        errors.append("source lot geometry changed")
    objects = plan["bays"] + plan["devices"] + plan["islands"] + plan["canopies"]
    for o in objects:
        p = shape(o["polygon"])
        if not p.is_valid or not site.buffer(1e-7).covers(p):
            errors.append(f"{o.get('id')}: outside source lot")
        if any(p.intersection(shape(k["polygon"])).area > 1e-5 for k in plan["obstacles"]):
            errors.append(f"{o.get('id')}: overlaps source obstacle")
        if plan.get("store") and p.intersection(shape(plan["store"]["footprint"])).area > 1e-5:
            errors.append(f"{o.get('id')}: overlaps store")
    for i, a in enumerate(plan["bays"]):
        if a["width_m"] < 2.4 or a["length_m"] < 4.8:
            errors.append(f"{a['id']}: undersized bay")
        for b in plan["bays"][i + 1 :]:
            if shape(a["polygon"]).intersection(shape(b["polygon"])).area > 1e-5:
                errors.append("vehicle bays overlap")
    bays = {str(b["id"]): b for b in plan["bays"]}
    if len(bays) != len(plan["bays"]):
        errors.append("duplicate vehicle bay identity")
    assigned = [str(d["bay_id"]) for d in plan["devices"] if d["kind"] == "charger"]
    if plan["kind"] == "ev" and (len(set(assigned)) != len(assigned) or set(assigned) != set(bays)):
        errors.append("chargers must have one-to-one bay ownership")
    for route in plan["routes"]:
        corridor = LineString(route["points"]).buffer(
            route["clear_width_m"] / 2, cap_style=2, join_style=2
        )
        obstacles = [
            shape(o["polygon"]) for o in plan["devices"] + plan["islands"] + plan["obstacles"]
        ]
        obstacles += [shape(b["polygon"]) for b in bays.values() if b["id"] != route["bay_id"]]
        if plan.get("store"):
            obstacles.append(shape(plan["store"]["footprint"]))
        if (
            not site.buffer(1e-7).covers(corridor)
            or corridor.intersection(unary_union(obstacles)).area > 1e-5
        ):
            errors.append("vehicle approach blocked or outside lot")
    for d in plan["devices"]:
        if any(
            shape(d["polygon"]).intersection(shape(b["polygon"])).area > 1e-5 for b in bays.values()
        ):
            errors.append("equipment occupies a parking bay")
        if d["kind"] == "charger":
            if str(d["bay_id"]) not in bays:
                errors.append("charger refers to missing bay")
                continue
            b = bays[str(d["bay_id"])]
            v = [b["center"][i] - d["center"][i] for i in range(2)]
            h = math.radians(d["heading_degrees"])
            if v[0] * math.cos(h) + v[1] * math.sin(h) <= 0:
                errors.append("charger faces away from its bay")
            if math.dist(d["center"], d["served_port"]) > d["cable_reach_m"]:
                errors.append("cable cannot reach assigned bay port")
            for bollard in d["bollards"]:
                if Point(bollard).buffer(0.09).intersects(shape(b["polygon"])):
                    errors.append("bollard blocks parking bay")
        else:
            for f in d["faces"]:
                if f["bay_id"] not in bays:
                    errors.append("pump face refers to missing bay")
                    continue
                b = bays[f["bay_id"]]
                delta = [b["center"][i] - d["center"][i] for i in range(2)]
                if sum(delta[i] * f["normal"][i] for i in range(2)) <= 0:
                    errors.append("fuel nozzle faces wrong lane")
    for canopy in plan["canopies"]:
        if not 3.8 <= canopy["underside_m"] <= 8:
            errors.append("canopy vehicle clearance invalid")
        if not canopy.get("supports"):
            errors.append("canopy missing supports")
        for p in canopy.get("supports", []):
            if not shape(canopy["polygon"]).covers(Point(p)):
                errors.append("canopy support outside roof")
            if any(shape(b["polygon"]).intersects(Point(p).buffer(0.18)) for b in bays.values()):
                errors.append("support blocks vehicle bay")
    return dict(
        passed=not errors,
        errors=errors,
        warnings=[],
        metrics=dict(bays=len(bays), devices=len(plan["devices"])),
    )


def from_kerbside_site(way, *, store=None, parking_stalls=None):
    """Only a source fuel/charging LOT is accepted; building/roof footprints are not lots."""
    tags = way.get("tags", {})
    if (
        way.get("kind") == "building"
        or tags.get("building")
        or tags.get("amenity") not in {"fuel", "charging_station"}
    ):
        raise ValueError(
            "requires a fuel/charging site boundary, not a building or canopy footprint"
        )
    points = way["points"]
    lon, lat = points[0]
    scale = 111320 * math.cos(math.radians(lat))
    local = [[(p[0] - lon) * scale, (p[1] - lat) * 111320] for p in points]
    p = Polygon(local)
    if not p.is_valid:
        raise ValueError("invalid Kerbside site polygon")
    lengths = [(math.dist(a, b), a, b) for a, b in pairwise(local)]
    _, a, b = max(lengths)
    result = dict(
        id=str(way["osm_id"]),
        name=way.get("name") or tags.get("brand") or "Charging station",
        brand=tags.get("brand"),
        kind="fuel" if tags["amenity"] == "fuel" else "ev",
        units="metres",
        site_polygon=mapping(p),
        canonical_points=copy.deepcopy(points),
        origin_lon_lat=[lon, lat],
        heading_degrees=math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])),
        geometry_evidence=dict(source_id="kerbside:" + str(way["osm_id"]), inferred=True),
    )
    if store:
        result["store"] = store
    if parking_stalls is not None:
        result["parking_stalls"] = parking_stalls
    return result
