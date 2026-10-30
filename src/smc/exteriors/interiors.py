"""Share one opening ledger with the existing interior engines, without moving evidence."""

from __future__ import annotations

import copy
import math

from shapely.geometry import LineString, shape


def opaque_room_zones(spec, face, interior):
    if not interior:
        return []
    floor = interior["storeys"][0]
    shell = shape(floor["footprint"])
    if shell.symmetric_difference(spec.footprint).area > 0.002:
        raise ValueError("paired interior footprint differs from exterior shell")
    line = LineString([face["a"], face["b"]])
    length = line.length
    zones = []
    opaque = {
        "professional_kitchen",
        "stockroom",
        "toilet",
        "full_bathroom",
        "powder_room",
        "cold_storage",
        "staff_room",
        "pantry",
        "utility",
    }
    for room in floor["rooms"]:
        if room["kind"] not in opaque:
            continue
        contact = shape(room["polygon"]).buffer(0.16, join_style=2).intersection(line)
        if contact.is_empty or contact.length < 0.15:
            continue
        parts = [contact] if contact.geom_type == "LineString" else list(contact.geoms)
        for part in parts:
            if part.geom_type != "LineString":
                continue
            coords = list(part.coords)
            a = line.project(shape({"type": "Point", "coordinates": coords[0]}))
            b = line.project(shape({"type": "Point", "coordinates": coords[-1]}))
            u, end = max(face["u0"], min(a, b)), min(face["u1"], max(a, b), length)
            if end > u:
                zones.append(
                    dict(
                        u=u,
                        w=end - u,
                        v=0.3,
                        h=face["band_height_m"] - 0.3,
                        basis="paired interior service room",
                        room_id=room["id"],
                    )
                )
    return zones


def paired_entries(face, interior):
    if not interior:
        return []
    line = LineString([face["a"], face["b"]])
    rows = []
    for o in interior["storeys"][0]["openings"]:
        if not o.get("entrance") or "outside" not in o["rooms"]:
            continue
        segment = shape(o.get("source_segment") or o["segment"])
        if not line.buffer(0.17, cap_style=2).covers(segment):
            continue
        a, b = [line.project(shape({"type": "Point", "coordinates": q})) for q in segment.coords]
        if min(a, b) < face["u0"] or max(a, b) > face["u1"]:
            continue
        rows.append(
            dict(
                id=o["id"],
                kind="door",
                u=min(a, b),
                w=abs(a - b),
                v=o.get("threshold_m", 0),
                h=o["height_m"],
                leaf_count=o["leaf_count"],
                operation=o["type"],
                inferred=True,
                measured=bool(o.get("measured", False)),
                confidence=o.get("confidence", 0.2),
                paired_interior_record=copy.deepcopy(o),
            )
        )
    return rows


def interior_envelope(plan, original=None):
    """Pass these windows to HouseInput/RestaurantInput/StoreInput before furnishing.

    Coordinates stay in the same local-metre frame. Supplied facade measurements keep
    their provenance; inferred windows remain inferred. This is an opt-in bridge.
    """
    envelope = copy.deepcopy(original or {})
    windows, entrances = [], []
    seen = set()
    for face in plan["facades"]:
        a, b = face["a"], face["b"]
        L = math.dist(a, b)
        for opening in face["openings"]:
            key = opening["id"]
            if key in seen:
                continue
            seen.add(key)
            row = copy.deepcopy(opening)
            row.update(
                a=list(a),
                b=list(b),
                edge=face["edge"],
                exterior_id=plan["id"],
                inferred=opening["evidence"]["inferred"],
                measured=opening["evidence"]["measured"],
            )
            if opening["component_kind"] == "window":
                windows.append(row)
            elif opening["component_kind"] == "door":
                u = opening["u"] + opening["w"] / 2
                entrances.append(
                    {
                        "point": [a[0] + (b[0] - a[0]) * u / L, a[1] + (b[1] - a[1]) * u / L],
                        "width_m": opening["w"],
                        "height_m": opening["h"],
                        "threshold_m": opening["v"],
                        "evidence": copy.deepcopy(opening["evidence"]),
                    }
                )
    # Preserve unrelated supplied windows, e.g. on an upper or unmodeled side wall.
    ids = {w["id"] for w in windows}
    windows += [w for w in envelope.get("windows", []) if w.get("id") not in ids]
    envelope["windows"] = windows
    envelope["exterior_entrances"] = entrances
    envelope["exterior_plan_sha256"] = plan["content_sha256"]
    return envelope
