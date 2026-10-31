#!/usr/bin/env python3
"""Build isolated, paired jewelry / barber-salon / laundry scenes without publishing."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from shapely.errors import GEOSException
from shapely.geometry import mapping

from smc.exteriors.bundle import build_bundle
from smc.exteriors.kerbside import from_kerbside
from smc.exteriors.library import category
from smc.interiors.specialty import infer_specialty_shop

ROOT = Path(__file__).resolve().parents[1]


def build(out, inputs, world=None, limit=12):
    out = Path(out)
    if (
        out.resolve() == (ROOT / "docs").resolve()
        or (ROOT / "docs").resolve() in out.resolve().parents
    ):
        raise ValueError("specialty review cannot write into published docs")
    rows = list(inputs)
    rejected = []
    selected = [str(r["id"]) for r in rows]
    if world:
        ways = world.get("ways", [])
        streets = [w for w in ways if w.get("kind") == "street"]
        eligible = [
            w
            for w in ways
            if w.get("kind") == "building"
            and len(w.get("shops", [])) == 1
            and category(w["shops"][0].get("t"), w["shops"][0].get("tags"))
            in {"jewelry", "barber", "salon", "laundry"}
        ]
        eligible.sort(key=lambda w: hashlib.sha256(str(w["osm_id"]).encode()).hexdigest())
        for way in eligible[:limit]:
            key = "mapped-" + str(way["osm_id"])
            selected.append(key)
            try:
                spec = from_kerbside(way, streets)
                kind = category(spec.tenants[0]["category"], spec.tenants[0].get("tags"))
                if spec.footprint.area > 350:
                    raise ValueError("large building needs a supplied tenant boundary")
                if any(t in spec.tenants[0]["name"].lower() for t in ["massage", "spa", "nail"]):
                    raise ValueError("coarse salon classification needs a specific service program")
                if (
                    kind == "laundry"
                    and any(t in spec.tenants[0]["name"].lower() for t in ["cleaners", "dry clean"])
                    and spec.tenants[0].get("tags", {}).get("self_service") != "yes"
                ):
                    raise ValueError(
                        "coarse cleaners classification does not establish self-service laundry"
                    )
                rows.append(
                    dict(
                        id=key,
                        kind=kind,
                        footprint=mapping(spec.footprint),
                        height_m=spec.height_m,
                        ground_height_m=spec.ground_height_m,
                        tenants=spec.tenants,
                        frontages=spec.frontages,
                        origin_lon_lat=spec.origin_lon_lat,
                        geometry_evidence=spec.geometry_evidence,
                        canonical_points=spec.canonical_points,
                    )
                )
            except (ValueError, KeyError, TypeError) as e:
                rejected.append(dict(id=key, reason=str(e)))
    # Original geometry-bound exterior builder provides the common renderer and official assets.
    build_bundle(out, inputs=rows)
    plans = {}
    seen = set()
    for row in rows:
        key = str(row["id"])
        if key in seen:
            raise ValueError("duplicate specialty identity")
        seen.add(key)
        try:
            plan = infer_specialty_shop(row)
            if key.startswith("mapped-"):
                plan["tenant_boundary_basis"] = (
                    "inferred whole ground floor; source building shell retained"
                )
                plan.pop("content_sha256")
                plan["content_sha256"] = hashlib.sha256(
                    json.dumps(plan, sort_keys=True, allow_nan=False).encode()
                ).hexdigest()
            plans[key] = plan
        except (ValueError, KeyError, TypeError, GEOSException) as e:
            rejected.append(dict(id=key, reason=str(e)))
    payload = dict(
        schema="kerbside.specialty_shops/1", selected=selected, rejected=rejected, shops=plans
    )
    (out / "specialty-shops.json").write_text(json.dumps(payload, indent=2) + "\n")
    package = ROOT / "src/smc/interiors/specialty"
    for source, target in [
        ("preview.html", "specialty.html"),
        ("preview.mjs", "specialty-preview.mjs"),
        ("renderer.mjs", "specialty-renderer.mjs"),
        ("tour.mjs", "specialty-tour.mjs"),
    ]:
        s = (
            (package / source)
            .read_text()
            .replace("../../exteriors/renderer.mjs", "./exterior-renderer.mjs")
            .replace("../../../../docs/inferred-interiors/tour-world.mjs", "./tour-world.mjs")
        )
        (out / target).write_text(s)
    shutil.copyfile(ROOT / "src/smc/exteriors/renderer.mjs", out / "exterior-renderer.mjs")
    shutil.copyfile(ROOT / "docs/inferred-interiors/tour-world.mjs", out / "tour-world.mjs")
    return payload


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--inputs", type=Path, default=ROOT / "tests/fixtures/specialty-shops.json")
    p.add_argument("--world", type=Path)
    p.add_argument("--limit", type=int, default=12)
    p.add_argument("--out", type=Path, default=ROOT / "build/specialty-shops")
    a = p.parse_args()
    if not 0 <= a.limit <= 200:
        p.error("limit must be 0..200")
    result = build(
        a.out,
        json.loads(a.inputs.read_text()),
        json.loads(a.world.read_text()) if a.world else None,
        a.limit,
    )
    print(
        json.dumps(
            dict(
                selected=len(result["selected"]),
                passed=len(result["shops"]),
                rejected=result["rejected"],
                output=str(a.out),
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
