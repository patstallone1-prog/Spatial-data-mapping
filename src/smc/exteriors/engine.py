"""Fit evidence-backed exterior components to actual tenant wall spans."""

from __future__ import annotations

import copy
import hashlib
import json
import math

from shapely.geometry import mapping

from smc.exteriors.library import brand_for, category, economics, fraction, library
from smc.exteriors.model import ExteriorInput


def _between(identity, salt, limits):
    return limits[0] + fraction(identity, salt) * (limits[1] - limits[0])


def _overlaps(a, b, gap=0):
    return (
        min(a["u"] + a["w"], b["u"] + b["w"]) > max(a["u"], b["u"]) - gap
        and min(a["v"] + a["h"], b["v"] + b["h"]) > max(a["v"], b["v"]) - gap
    )


def _free(lo, hi, obstacles, bottom, top, gap=0.14):
    intervals = [(lo, hi)]
    for r in obstacles:
        if r["v"] >= top or r["v"] + r["h"] <= bottom:
            continue
        a, b = r["u"] - gap, r["u"] + r["w"] + gap
        intervals = [
            part
            for x, y in intervals
            for part in [(x, min(y, a)), (max(x, b), y)]
            if part[1] - part[0] > 0.01
        ]
    return intervals


def _proof(references, *, observed=False, source=None):
    source = source or {}
    return {
        "measured": bool(source.get("measured", False)),
        "inferred": not observed or bool(source.get("inferred", False)),
        "observed": observed,
        "confidence": source.get(
            "confidence", (0.9 if source.get("measured") else 0.4) if observed else 0.3
        ),
        "freshness": source.get("captured_at", source.get("freshness"))
        if observed
        else library()["version"],
        "corroboration_count": source.get("corroboration_count", 1 if observed else 0),
        "references": references,
    }


def _observed(row, identity, refs):
    result = copy.deepcopy(row)
    result.setdefault("id", identity)
    kind = result.get("kind", "window")
    result["component_kind"] = (
        "door"
        if kind in {"door", "entrance", "entry"}
        else "garage"
        if kind in {"garage", "garage_candidate", "loading"}
        else "window"
    )
    result["evidence"] = _proof(refs, observed=True, source=row)
    result["source_record"] = copy.deepcopy(row)
    return result


def _palette(identity, kind, brand, tier, observed=None):
    independent = [
        ("#eee8dd", "#264f43", "#252c2b"),
        ("#e5d6c3", "#713c33", "#34312d"),
        ("#e2dfd7", "#324b62", "#292f33"),
        ("#e7d7bd", "#6c573f", "#3b3730"),
        ("#d6ddd9", "#3b5355", "#263238"),
    ]
    wall, accent, frame = independent[int(fraction(identity, "palette") * len(independent))]
    if brand:
        accent = brand["colors"][0]
        # Identity color is an accent, not a paint bucket for the entire building.
        wall = "#eee9de" if kind != "bar" else "#43403a"
        frame = "#29302e"
        if brand["name"] == "7-Eleven":
            wall, frame = "#8a7660", "#aeb5b1"
        elif brand["name"] == "Chipotle":
            wall = "#bbb8af"
    if observed:
        wall = observed
    if kind == "diner" and not brand:
        frame, accent = "#b4bdbd", "#a83232"
    return {
        "wall": wall,
        "accent": accent,
        "frame": frame,
        "base": "#716a60" if tier in {"premium", "luxury"} else "#8b8277",
        "letter": brand["colors"][1]
        if brand and brand["name"] == "Starbucks Reserve"
        else "#f6f1e7",
        "metal": "#b59b69" if tier == "luxury" else "#a5aaa7",
        "glass": "#a7c2c8",
        "roughness": 0.62 if tier in {"premium", "luxury"} else 0.82,
    }


def _default_frontages(spec):
    ring = list(spec.footprint.exterior.coords)
    edge = max(range(len(ring) - 1), key=lambda i: math.dist(ring[i], ring[i + 1]))
    length = math.dist(ring[edge], ring[edge + 1])
    if length / len(spec.tenants) < 1.2:
        raise ValueError("source wall cannot hold every tenant; supply actual frontages")
    return [
        {
            "edge": edge,
            "tenant_id": str(t["id"]),
            "u0": length * i / len(spec.tenants),
            "u1": length * (i + 1) / len(spec.tenants),
            "role": "public",
            "basis": "inferred equal tenant shares on longest edge; street frontage unknown",
        }
        for i, t in enumerate(spec.tenants)
    ]


def _openings(face, profile, tenant, source):
    identity, band = face["id"], face["band_height_m"]
    refs = face["references"]
    rows = [
        _observed(o, f"{identity}:observed:{i}", refs)
        for i, o in enumerate(source.get("openings", []))
    ]
    if not any(o["component_kind"] == "door" for o in rows):
        rows += [_observed(o, o["id"], refs) for o in face.get("paired_entries", [])]
    if face["role"] in {"service", "party"} or source.get("openings_complete", False):
        return rows
    lo, hi = face["u0"] + 0.16, face["u1"] - 0.16
    reserved = source.get("protected_rectangles", [])
    if not any(o["component_kind"] == "door" for o in rows) and not face.get("paired_entry_ledger"):
        width = min(2.4 if face["category"] == "grocery" and hi - lo > 8 else 1.05, hi - lo)
        height = min(2.35, band - 0.15)
        options = _free(lo, hi, rows + reserved, 0, height, 0.18)
        candidates = [
            (abs((a + b) / 2 - (lo + (hi - lo) * 0.67)), a, b) for a, b in options if b - a >= width
        ]
        if candidates:
            _, a, b = min(candidates)
            u = min(max(lo + (hi - lo) * 0.67 - width / 2, a), b - width)
            rows.append(
                {
                    "id": f"{identity}:door",
                    "kind": "door",
                    "component_kind": "door",
                    "u": u,
                    "v": 0,
                    "w": width,
                    "h": height,
                    "operation": "automatic_sliding"
                    if face["category"] == "grocery" and width >= 1.8
                    else "hinged",
                    "leaf_count": 2 if width >= 1.6 else 1,
                    "evidence": _proof(refs),
                }
            )
    sill = _between(identity, "sill", profile["sill_m"])
    tall = band > 4.3 and face["category"] in {"grocery", "cafe", "diner", "clothing"}
    head = min(4.0 if tall else 2.75, band - (1.15 if tall else 0.72))
    if head - sill < 0.65:
        return rows
    available = _free(lo, hi, rows + reserved + face.get("opaque_room_zones", []), sill, head, 0.18)
    public_doors = [o for o in rows if o["component_kind"] == "door"]
    zones = source.get("glazing_zones")
    if (
        zones is None
        and public_doors
        and (face["category"] in {"grocery", "corner_store"} or face.get("glazing_cluster_m"))
    ):
        span = hi - lo
        if span > (14 if face["category"] == "grocery" else 7):
            cluster = (
                min(16, max(8, span * 0.48))
                if face["category"] == "grocery"
                else min(8, span * 0.65)
            )
            cluster = face.get("glazing_cluster_m") or cluster
            zones = [
                {"u": max(lo, d["u"] + d["w"] / 2 - cluster / 2), "w": cluster}
                for d in public_doors
            ]
    if zones is not None:
        merged = []
        for a, b in sorted((max(lo, z["u"]), min(hi, z["u"] + z["w"])) for z in zones):
            if b <= a:
                continue
            if merged and a <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
            else:
                merged.append((a, b))
        available = [
            (max(a, x), min(b, y)) for a, b in available for x, y in merged if min(b, y) > max(a, x)
        ]
    available = [(a, b) for a, b in available if b - a >= 0.7]
    total = sum(b - a for a, b in available)
    target = _between(identity, "glazing", profile["front_glazing_fraction"]) * (hi - lo)
    target -= sum(o["w"] for o in rows if o["component_kind"] == "window" and o["v"] < head)
    factor = min(0.94, max(0, target) / max(total, 0.01))
    module = _between(identity, "module", profile["module_width_m"])
    for a, b in available:
        count = max(1, math.ceil((b - a) / (module + 0.18)))
        pitch = (b - a) / count
        w = min(module, pitch * factor)
        if w < 0.55:
            continue
        for i in range(count):
            rows.append(
                {
                    "id": f"{identity}:window:{len(rows)}",
                    "kind": "window",
                    "component_kind": "window",
                    "u": a + pitch * (i + 0.5) - w / 2,
                    "v": sill,
                    "w": w,
                    "h": head - sill,
                    "transom_fraction": 0.23 if head - sill > 1.7 else 0,
                    "privacy_fraction": 0.28 if profile.get("privacy") else 0,
                    "evidence": _proof(refs),
                }
            )
    # Tall customer glazing can share a head with a fixed transom above the door.
    # The actual moving leaf keeps its own recorded/inferred height.
    if tall:
        for door in public_doors:
            transom = {
                "u": door["u"] + 0.04,
                "w": door["w"] - 0.08,
                "v": door["v"] + door["h"] + 0.14,
                "h": head - door["v"] - door["h"] - 0.14,
            }
            if transom["h"] >= 0.55 and not any(
                _overlaps(transom, o, 0.04)
                for o in rows + reserved + face.get("opaque_room_zones", [])
            ):
                rows.append(
                    dict(
                        id=f"{door['id']}:transom",
                        kind="window",
                        component_kind="window",
                        role="entry_transom",
                        **transom,
                        evidence=_proof(refs),
                    )
                )
    return rows


def _signs(face, tenant, profile, brand, source):
    refs = face["references"]
    signs = []
    for i, row in enumerate(source.get("signs", [])):
        s = copy.deepcopy(row)
        s.setdefault("id", f"{face['id']}:observed-sign:{i}")
        s.setdefault("illumination", "none")
        s["evidence"] = _proof(refs, observed=True, source=row)
        s["source_record"] = copy.deepcopy(row)
        signs.append(s)
    if face["role"] in {"service", "party"} or signs or source.get("signs_complete"):
        return signs
    lo, hi, band = face["u0"], face["u1"], face["band_height_m"]
    width = hi - lo
    institutional = profile["family"] == "institution"
    types = brand["sign_types"] if brand else profile["sign_types"]
    kind = tenant.get("sign_type") or types[int(fraction(face["id"], "sign") * len(types))]
    if kind not in {
        "fascia",
        "channel_letters",
        "painted_letters",
        "awning_valance",
        "lightbox",
        "neon",
        "blade",
        "door_vinyl",
        "entry_letters",
        "plaque",
        "canopy_letters",
    }:
        raise ValueError("unsupported storefront sign type")
    doors = [
        o
        for o in face["openings"]
        if o["component_kind"] == "door"
        and o["v"] + min(o["h"], 2) <= band + 0.002
        and o.get("role") not in {"balcony", "service", "service_entry", "emergency_exit"}
    ]
    door = doors[0] if doors else None
    if width < 3.15 and not institutional:
        kind = "door_vinyl"
    if kind == "door_vinyl" and door:
        rect = {
            "u": door["u"] + door["w"] * 0.1,
            "w": door["w"] * 0.8,
            "v": door["v"] + door["h"] * 0.62,
            "h": min(0.20, door["h"] * 0.1),
        }
    else:
        h = (
            0.32
            if institutional
            else (
                min(1.3, max(0.55, (band - 2.8) * 0.5))
                if face["category"] == "grocery" and width > 18
                else 0.55
            )
        )
        top = min(band - 0.12, band - 0.2 if band > 4.3 else 3.65)
        bottom = top - h
        if kind == "plaque":
            # A plaque lives on a pier next to an entrance, not over a window.
            bottom, h = 1.45, 0.3
        obstacles = face["openings"] + source.get("protected_rectangles", [])
        choices = _free(lo + 0.12, hi - 0.12, obstacles, bottom, bottom + h, 0.08)
        if not choices:
            if door:
                local = dict(tenant, sign_type="door_vinyl")
                return _signs(face, local, profile, brand, {})
            return []
        # Center over the span of entrances, independent of their count or leaf split.
        entry_center = (
            (min(d["u"] for d in doors) + max(d["u"] + d["w"] for d in doors)) / 2
            if doors
            else (lo + hi) / 2
        )
        centered = [
            ab for ab in choices if 2 * min(entry_center - ab[0], ab[1] - entry_center) >= 0.28
        ]
        a, b = min(
            centered or choices,
            key=lambda ab: (
                max(ab[0] - entry_center, entry_center - ab[1], 0),
                -min(entry_center - ab[0], ab[1] - entry_center),
                -(ab[1] - ab[0]),
            ),
        )
        max_width = 1.45 if kind == "plaque" else 3.2 if institutional else 9
        w = min((b - a) * 0.9, max_width)
        if centered:
            w = min(w, 2 * min(entry_center - a, b - entry_center))
        if w < 0.28:
            return []
        if kind == "blade":
            w = min(w, 0.7)
        center = min(max(entry_center, a + w / 2), b - w / 2)
        rect = {"u": center - w / 2, "w": w, "v": bottom, "h": h}
    sign = {
        "id": f"{face['id']}:identity",
        "kind": kind,
        "text": tenant["name"],
        **rect,
        "asset": brand.get("asset") if brand else None,
        "icon": brand.get("icon") if brand else None,
        "evidence": _proof(refs),
        "illumination": "none"
        if institutional
        else "led_face"
        if kind in {"lightbox", "neon"}
        else "halo"
        if kind == "channel_letters"
        else "none",
        "projection_m": 0.65 if kind == "blade" else 0.08,
    }
    if kind in {"awning_valance", "canopy_letters"}:
        sign["canopy"] = {
            "kind": "sloped_fabric" if kind == "awning_valance" else "flat_metal",
            "depth_m": min(0.95, width * 0.14),
            "drop_m": min(0.3, band - rect["v"] - rect["h"] - 0.04),
            "clear_height_m": rect["v"],
        }
    # No fabricated opening hours, discounts, phone numbers or product-price claims.
    return [sign]


def infer_exterior(spec: ExteriorInput):
    data = library()
    ring = list(spec.footprint.exterior.coords)
    clockwise = not spec.footprint.exterior.is_ccw
    tenants = {str(t["id"]): t for t in spec.tenants}
    result = {
        "schema": "kerbside.inferred_exterior/1",
        "id": spec.id,
        "canonical_geometry_modified": False,
        "footprint": mapping(spec.footprint),
        "height_m": spec.height_m,
        "origin_lon_lat": spec.origin_lon_lat,
        "canonical_points": copy.deepcopy(spec.canonical_points),
        "geometry_evidence": copy.deepcopy(spec.geometry_evidence),
        "geometry_sha256": hashlib.sha256(spec.footprint.wkb).hexdigest(),
        "reference_version": data["version"],
        "facades": [],
        "evidence": _proof([]),
        "replica_status": "inferred_layout_with_reference_backed_components",
        "not_an_as_built_survey": True,
    }
    for i, source in enumerate(spec.frontages or _default_frontages(spec)):
        tenant = tenants[str(source["tenant_id"])]
        brand_id = brand_for(tenant["name"], tenant.get("brand"))
        brand = data["brands"].get(brand_id)
        kind = brand["category"] if brand else category(tenant.get("category"), tenant.get("tags"))
        profile = data["categories"][kind]
        eco = economics(tenant, profile["family"])
        refs = list(dict.fromkeys(profile["references"] + (brand["references"] if brand else [])))
        edge = source["edge"]
        a, b = ring[edge : edge + 2]
        length = math.dist(a, b)
        dx, dy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        normal = [-dy, dx] if clockwise else [dy, -dx]
        face = {
            "id": f"{spec.id}:facade:{i}",
            "edge": edge,
            "a": a,
            "b": b,
            "normal": normal,
            "u0": source.get("u0", 0),
            "u1": source.get("u1", length),
            "tenant_id": str(tenant["id"]),
            "name": tenant["name"],
            "category": kind,
            "brand": brand_id,
            "role": source.get("role", "public"),
            "economics": eco,
            "band_height_m": spec.ground_height_m
            or (spec.height_m if spec.height_m <= 6.5 else 3.9),
            "palette": _palette(
                f"{spec.id}:{tenant['id']}", kind, brand, eco["tier"], source.get("wall_colour")
            ),
            "material": source.get("wall_material") or (brand or profile)["materials"][0],
            "references": refs,
            "evidence": _proof(refs),
            "frontage_basis": source.get("basis", "caller supplied tenant frontage"),
            "protected_rectangles": copy.deepcopy(source.get("protected_rectangles", [])),
            "observed_bands": copy.deepcopy(source.get("bands", [])),
            "glazing_cluster_m": brand.get("glazing_cluster_m") if brand else None,
        }
        from smc.exteriors.interiors import opaque_room_zones, paired_entries

        face["opaque_room_zones"] = opaque_room_zones(spec, face, spec.interior)
        face["paired_entries"] = paired_entries(face, spec.interior)
        face["paired_entry_ledger"] = bool(
            spec.interior
            and any(
                o.get("entrance") and "outside" in o["rooms"]
                for o in spec.interior["storeys"][0]["openings"]
            )
        )
        face["openings"] = _openings(face, profile, tenant, source)
        face["signs"] = _signs(face, tenant, profile, brand, source)
        if brand:
            face["identity_components"] = copy.deepcopy(brand["components"])
            face["portal_colour"] = (
                brand["colors"][0] if brand_id in {"subway", "chase", "whole_foods"} else None
            )
            if face["signs"] and not source.get("wall_colour") and not source.get("bands"):
                sign = face["signs"][0]
                band = {
                    "u": face["u0"] + 0.05,
                    "w": face["u1"] - face["u0"] - 0.1,
                    "v": sign["v"] - 0.1,
                    "h": face["band_height_m"] - 0.06 - sign["v"] + 0.1,
                    "colour": {
                        "starbucks": "#233e31",
                        "starbucks_reserve": "#2c2c29",
                        "subway": "#008938",
                        "whole_foods": "#006f46",
                        "chipotle": "#3e3d39",
                        "seven_eleven": "#f3efe5",
                    }.get(brand_id, face["palette"]["wall"]),
                    "evidence": _proof(refs),
                }
                if not any(
                    _overlaps(band, o) for o in face["openings"] + face["protected_rectangles"]
                ):
                    face["identity_band"] = band
            if brand_id == "starbucks":
                for sign in face["signs"]:
                    if sign.get("asset") == "starbucks" and sign["kind"] != "blade":
                        sign["brand_layout"] = "icon_and_wordmark"
            elif brand.get("brand_layout"):
                for sign in face["signs"]:
                    if sign.get("asset") and sign["kind"] != "blade":
                        sign["brand_layout"] = brand["brand_layout"]
                        sign["wordmark"] = brand.get("wordmark", brand["name"])
        if brand_id == "seven_eleven" and face["signs"]:
            face["identity_stripes"] = ["#ec7625", "#008061", "#d62330"]
        face["source_input"] = copy.deepcopy(source)
        result["facades"].append(face)
    result["references"] = [
        copy.deepcopy(s)
        for s in data["sources"]
        if s["id"] in {r for f in result["facades"] for r in f["references"]}
    ]
    # Local import keeps validation available independently to downstream consumers.
    from smc.exteriors.validate import validate_exterior

    result["validation"] = validate_exterior(result)
    # A digest for repeatability, not a promotion of inferred details to measured facts.
    result["content_sha256"] = hashlib.sha256(
        json.dumps(result, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return result
