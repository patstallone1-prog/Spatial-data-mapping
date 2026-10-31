"""Check wall ownership, observation preservation, sign clearance and source identity."""

from __future__ import annotations

import hashlib
import math

from shapely.geometry import shape

from smc.exteriors.engine import _overlaps


def validate_exterior(plan):
    errors, warnings = [], []
    p = shape(plan["footprint"])
    if not p.is_valid or hashlib.sha256(p.wkb).hexdigest() != plan["geometry_sha256"]:
        errors.append("canonical footprint changed")
    if plan.get("canonical_geometry_modified") is not False:
        errors.append("canonical shell must not be modified")
    refs = {r["id"] for r in plan["references"]}
    entrances = set()
    measured = inferred = 0
    for f in plan["facades"]:
        if not f["references"] or not set(f["references"]) <= refs:
            errors.append("facade lacks reference evidence")
        lo, hi, band = f["u0"], f["u1"], f["band_height_m"]
        if not 0 < band <= plan["height_m"]:
            errors.append("ground facade exceeds shell height")
        source = f["source_input"]
        observed = source.get("openings", [])
        for i, original in enumerate(observed):
            current = f["openings"][i] if i < len(f["openings"]) else {}
            if current.get("source_record") != original or any(
                current.get(k) != value for k, value in original.items()
            ):
                errors.append("observed opening changed or disappeared")
        for o in f["openings"]:
            observed_o = o.get("evidence", {}).get("observed", False)
            if o.get("render_allowed") is False:
                errors.append("withheld source opening cannot be rendered as approved")
            measured += int(observed_o)
            inferred += int(not observed_o)
            if not all(math.isfinite(o[k]) for k in ("u", "w", "v", "h")):
                errors.append("nonfinite facade component")
                continue
            if o["u"] < lo - 0.002 or o["u"] + o["w"] > hi + 0.002:
                errors.append("opening crosses tenant frontage")
            if o["v"] < 0 or o["v"] + o["h"] > plan["height_m"] + 0.002:
                errors.append("opening exceeds source building height")
            if not observed_o and o["v"] + o["h"] > band:
                errors.append("inferred display glazing reaches upper floor")
            if not observed_o and o["component_kind"] == "door" and (o["h"] < 2 or o["w"] < 0.8):
                errors.append("inferred public door is unusably small")
            if o["component_kind"] == "door" and f["role"] in {"public", "secondary"}:
                entrances.add(f["tenant_id"])
                if o["v"] > 0.04:
                    warnings.append("raised observed entry needs approach evidence")
            if o["component_kind"] == "window" and any(
                _overlaps(o, r) for r in f.get("opaque_room_zones", [])
            ):
                if observed_o:
                    warnings.append(
                        "source window retained at a service room; reconcile paired layout"
                    )
                else:
                    errors.append("inferred display glazing opens into an interior service room")
            if not observed_o and any(_overlaps(o, r) for r in f["protected_rectangles"]):
                errors.append("inferred opening covers a protected observation")
        for i, a in enumerate(f["openings"]):
            for b in f["openings"][i + 1 :]:
                if _overlaps(a, b):
                    errors.append("facade openings overlap; preserve evidence and resolve conflict")
        identity = f.get("identity_band")
        if identity and any(
            _overlaps(identity, o) for o in f["openings"] + f["protected_rectangles"]
        ):
            errors.append("brand identity band masks an observation")
        if identity and (source.get("wall_colour") or source.get("bands")):
            errors.append("brand band repaints observed wall appearance")
        for i, original in enumerate(source.get("signs", [])):
            current = f["signs"][i] if i < len(f["signs"]) else {}
            if current.get("source_record") != original or any(
                current.get(k) != value for k, value in original.items()
            ):
                errors.append("observed signage changed or disappeared")
        pole = f.get("barber_pole")
        if pole and (
            pole["u"] < f["u0"]
            or pole["u"] + pole["w"] > f["u1"]
            or pole["v"] < 0
            or pole["v"] + pole["h"] > f["band_height_m"]
            or any(
                _overlaps(pole, o) for o in f["openings"] + f["signs"] + f["protected_rectangles"]
            )
        ):
            errors.append("barber pole masks opening or protected detail")
        for s in f["signs"]:
            if not all(
                isinstance(s.get(k), (int, float)) and math.isfinite(s[k])
                for k in ("u", "w", "v", "h")
            ):
                errors.append("sign lacks finite placement bounds")
                continue
            if s.get("evidence", {}).get("observed"):
                continue
            if s["u"] < lo or s["u"] + s["w"] > hi or s["v"] < 0 or s["v"] + s["h"] > band:
                errors.append("inferred sign crosses its tenant span or floor")
            if s["kind"] == "door_vinyl":
                doors = [o for o in f["openings"] if o["component_kind"] == "door"]
                if not any(
                    s["u"] >= d["u"]
                    and s["u"] + s["w"] <= d["u"] + d["w"]
                    and s["v"] >= d["v"]
                    and s["v"] + s["h"] <= d["v"] + d["h"]
                    and s["w"] * s["h"] <= d["w"] * d["h"] * 0.15
                    for d in doors
                ):
                    errors.append("door lettering obscures too much glass or misses door")
            elif any(_overlaps(s, o) for o in f["openings"] + f["protected_rectangles"]):
                errors.append("sign masks glazing or protected architectural detail")
            canopy = s.get("canopy")
            if canopy and (
                canopy["clear_height_m"] < 2.4 or s["v"] + s["h"] + canopy["drop_m"] > band
            ):
                errors.append("canopy lacks clearance or reaches the floor above")
        if f["role"] in {"service", "party"} and (
            any(o["evidence"]["inferred"] for o in f["openings"])
            or any(s["evidence"]["inferred"] for s in f["signs"])
        ):
            errors.append("service/party wall acquired an invented customer storefront")
    needed = {f["tenant_id"] for f in plan["facades"] if f["role"] == "public"}
    if needed - entrances:
        errors.append("public tenant has no resolved entry")
    return {
        "passed": not errors,
        "errors": sorted(set(errors)),
        "warnings": sorted(set(warnings)),
        "metrics": {
            "facades": len(plan["facades"]),
            "observed_openings": measured,
            "inferred_openings": inferred,
            "tenant_entries": len(entrances),
        },
    }
