#!/usr/bin/env python3
"""Freeze nominal renderer predictions, then score against newly ingested city polygons.

No fitting, offsets or width calibration against either development or test streets.
This tests the nominal kerbside ribbon width, not its later local clipping/underlay.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import re
import runpy
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.curbmeasure.width_validation import (  # noqa: E402
    cross_section,
    nearest_side,
    split_for,
    street_group,
    summarize,
)
from smc.official.regional_evidence import digest  # noqa: E402


def freeze(payload: Path, source_hash: str) -> dict:
    raw = payload.read_bytes()
    data = json.loads(raw)
    audit = runpy.run_path(str(ROOT / "scripts/audit_corridor_render.py"))
    js = audit["page_js"]()
    rule = audit["extract"]("renderedWalkWidth", js)
    constants = "\n".join(re.search(rf"const {key} = [^;]+;", js)[0]
                          for key in ("MIN_RENDER_WALK_M", "MAX_RENDER_WALK_M"))
    ways = [w for w in data["ways"] if w.get("kind") == "street" and w.get("name")
            and len(w.get("points", [])) >= 2
            and not any(w.get(k) for k in ("tunnel", "bridge"))]
    if not ways:
        raise ValueError("no eligible streets; refusing an empty benchmark")
    # Execute exactly the shipped rule and its current fallback, not a rewritten approximation.
    code = constants + rule + "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(a.map(w=>renderedWalkWidth(w,4.0))));"
    result = subprocess.run(["node", "-e", code], input=json.dumps(ways), text=True,
                            capture_output=True, check=True)
    widths = json.loads(result.stdout)
    return {"schema_version": 1, "region": "san-jose-downtown", "source_sha256": source_hash,
            "payload_sha256": hashlib.sha256(raw).hexdigest(), "rule_sha256": digest(constants + rule),
            "purpose": "frozen_new_city_gis_sidewalk_width_screen",
            "not_a_photo_accuracy_benchmark": True, "reference_used_for_fitting": False,
            "partition_policy": "SHA256 sidewalk-v1 + normalized whole street name; first byte <85 test",
            "ways": [{"id": str(w["osm_id"]), "name": street_group(w["name"]),
                      "split": split_for(w["name"]), "points": w["points"], "prediction_m": width}
                     for w, width in zip(ways, widths, strict=True)]}


def evaluate(frozen: dict, inventory: dict) -> dict:
    if frozen["source_sha256"] != inventory["sha256"] or digest(inventory["features"]) != inventory["sha256"]:
        raise ValueError("independent reference differs from frozen manifest")
    if not frozen["ways"]:
        raise ValueError("empty frozen street cohort")
    lat = frozen["ways"][0]["points"][0][1]
    kx, ky = 111320 * math.cos(math.radians(lat)), 111320
    lon0, lat0 = frozen["ways"][0]["points"][0]
    def local(p):
        return ((p[0] - lon0) * kx, (p[1] - lat0) * ky)
    grid = {}
    polygons = []
    for feature in inventory["features"]:
        geo = feature["geometry"]
        for polygon in [geo["coordinates"]] if geo["type"] == "Polygon" else geo["coordinates"]:
            rings = [[local(p) for p in ring] for ring in polygon]
            points = [p for ring in rings for p in ring]
            xs, ys = zip(*points, strict=True)
            key = len(polygons)
            polygons.append((feature.get("id"), rings))
            for x in range(math.floor(min(xs) / 50), math.floor(max(xs) / 50) + 1):
                for y in range(math.floor(min(ys) / 50), math.floor(max(ys) / 50) + 1):
                    grid.setdefault((x, y), []).append(key)
    rows, attempted = [], 0
    for way in frozen["ways"]:
        points = [local(p) for p in way["points"]]
        total = sum(math.dist(a, b) for a, b in itertools.pairwise(points))
        station = 0.
        for a, b in itertools.pairwise(points):
            length = math.dist(a, b)
            if length < 1:
                continue
            tangent = ((b[0] - a[0]) / length, (b[1] - a[1]) / length)
            for i in range(1, int(length / 10)):
                s = i * 10.
                if station + s < 20 or station + s > total - 20:
                    continue
                origin = (a[0] + tangent[0] * s, a[1] + tangent[1] * s)
                for side in (-1, 1):
                    attempted += 1
                    supported = []
                    references = set()
                    for delta in (-2., 0., 2.):
                        at = (origin[0] + tangent[0] * delta, origin[1] + tangent[1] * delta)
                        cx, cy = math.floor(at[0] / 50), math.floor(at[1] / 50)
                        candidates = set(k for x in range(cx - 1, cx + 2) for y in range(cy - 1, cy + 2)
                                         for k in grid.get((x, y), []))
                        spans = [(lo, hi, polygons[k][0]) for k in candidates
                                 for lo, hi in cross_section(polygons[k][1], at, tangent)]
                        hit = nearest_side([(lo, hi) for lo, hi, _ in spans], side)
                        if not hit:
                            break
                        references.update(fid for lo, hi, fid in spans
                                          if ((lo, hi) if side > 0 else (-hi, -lo)) == hit)
                        supported.append(hit[1] - hit[0])
                    if len(supported) == 3 and max(supported) - min(supported) <= .30:
                        rows.append({"street": way["name"], "way": way["id"], "side": side,
                                     "station_m": station + s, "split": way["split"],
                                     "prediction_m": way["prediction_m"],
                                     "reference_feature_ids": sorted(references),
                                     "reference_m": statistics.median(supported)})
            station += length
    return {"schema_version": 1, "frozen_manifest_sha256": digest(frozen),
            "attempted_stations": attempted, "supported_stations": len(rows),
            "development": summarize([r for r in rows if r["split"] == "development"]),
            "untouched_test": summarize([r for r in rows if r["split"] == "untouched_test"]),
            "physical_accuracy_promotion": False,
            "limitations": ["Municipal polygon agreement, not surveyed independent ground truth.",
                            "Nominal ribbon width only; clipping/underlay can alter visible area.",
                            "Same street is never in both splits; no reference fitting is applied.",
                            "WIDTH attribute ignored: its units are not documented.",
                            "20 m end exclusion and three adjacent stable sections screen intersection bulbs.",
                            "No photographic width claim; paired reviewed masks and camera controls still needed."],
            "rows": rows}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reference", type=Path, required=True)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    inventory = json.loads(args.reference.read_text())
    if not args.manifest.exists():
        frozen = freeze(ROOT / "docs/regions/san-jose-downtown/sf-corridor-3d.json", inventory["sha256"])
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        with args.manifest.open("x") as sink:
            json.dump(frozen, sink, indent=1)
        print("Frozen manifest; rerun with --out to score without modifying predictions.")
        return
    if args.out is None:
        raise ValueError("--out required for scoring an existing frozen manifest")
    report = evaluate(json.loads(args.manifest.read_text()), inventory)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "rows"}, indent=2))


if __name__ == "__main__":
    main()
