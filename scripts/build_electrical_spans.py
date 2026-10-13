"""Reconstruct pole-to-pole electrical spans for each PG&E region and write the sidecars.

    set -a; source .env.local; set +a
    python scripts/ingest_pge_grip.py            # once: the local GRIP reference
    python scripts/build_electrical_spans.py     # every region, or --region sf-mission

Inputs: the region's observed poles (OpenStreetMap nodes and Mapillary map features, in
sf-corridor-furniture.json), the GRIP line sections, OpenStreetMap's overhead and underground
power ways, and Mapillary's per-image segmentation (cached, reduced, never the pixels).

Outputs, beside the region's world payload:
  sf-corridor-electrical.json          the spans the renderer draws (confirmed only), compact
  build/electrical/<region>-electrical-details.json  every candidate with its evidence (local)
Neither carries PG&E's line geometry, feeder names or capacity figures.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import urllib.parse
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from smc.imagery.segmentation_cache import SegmentationCache, decode, images_in_box
from smc.infrastructure.electrical import (
    Frame,
    Network,
    calibrate,
    candidate_spans,
    choose_images,
    decide,
    feeder_key,
    match_poles,
    merge_duplicate_poles,
    project,
    score_view,
)
from smc.official.datasf import _get

ROOT = Path(__file__).resolve().parents[1]
REGIONS = ("sf-corridor", "sf-haight-castro", "sf-mission", "sf-sunset",
           "oakland-downtown", "berkeley-downtown", "san-jose-downtown")
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")


def folder(region: str) -> Path:
    return ROOT / "docs" if region == "sf-corridor" else ROOT / "docs/regions" / region


def osm_power(region: str, box: dict) -> list[dict]:
    """OpenStreetMap power ways: overhead lines confirm, underground cables veto."""
    cache = ROOT / "data/electrical/osm" / f"{region}.json"
    if not cache.exists():
        bounds = f"({box['south']},{box['west']},{box['north']},{box['east']})"
        query = (f'[out:json][timeout:60];(way["power"~"^(line|minor_line|cable)$"]{bounds};'
                 f'way["location"~"underground"]["power"]{bounds};);out tags geom;')
        last = None
        for endpoint in OVERPASS:
            try:
                doc = json.loads(_get(f"{endpoint}?{urllib.parse.urlencode({'data': query})}"))
                break
            except Exception as error:  # a mirror being down is not a reason to stop
                last = error
        else:
            raise RuntimeError(f"Overpass failed: {last}")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(doc.get("elements", [])))
    return json.loads(cache.read_text())


def image_index(region: str, box: dict, spans_xy: list, frame: Frame) -> list[dict]:
    """Where photographs were taken: the local metadata sweep, or the API for small boxes."""
    rows = []
    sweep = ROOT / "data/sf_corridor_mapillary_dense/observations/external-000.parquet"
    if region == "sf-corridor" and sweep.exists():
        import pyarrow.parquet as pq

        table = pq.read_table(sweep, columns=["provider", "provider_image_id", "provider_sequence_id",
                                              "captured_at", "latitude", "longitude", "heading_deg",
                                              "projection_type", "eligible"]).to_pylist()
        for r in table:
            if r["provider"] != "mapillary" or not r["eligible"]:
                continue
            rows.append({"id": r["provider_image_id"], "lon": r["longitude"], "lat": r["latitude"],
                         "heading": r["heading_deg"], "sequence": r["provider_sequence_id"],
                         "year": r["captured_at"].year if r["captured_at"] else None,
                         "camera": "spherical" if r["projection_type"] == "spherical" else "perspective"})
    else:
        cache = ROOT / "data/electrical/imagery-cache" / f"{region}-index.json"
        if cache.exists():
            rows = json.loads(cache.read_text())
        else:
            cells = set()
            step = 0.0015
            for a, b in spans_xy:
                for x, y in (a, b):
                    lon, lat = frame.lonlat(x, y)
                    cells.add((math.floor(lon / step), math.floor(lat / step)))
            from concurrent.futures import ThreadPoolExecutor

            def cell(key):
                i, j = key
                return images_in_box(i * step, j * step, (i + 1) * step, (j + 1) * step)

            # The API answers a box slowly; several at once.
            with ThreadPoolExecutor(8) as pool:
                for n, items in enumerate(pool.map(cell, sorted(cells))):
                    for item in items:
                        when = item.get("captured_at")
                        item["year"] = datetime.fromtimestamp(when / 1000, UTC).year if when else None
                        rows.append(item)
                    if n % 50 == 0:
                        print(f"  {region}: image index {n}/{len(cells)} cells", flush=True)
            rows = list({r["id"]: r for r in rows}.values())
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(rows))
    for r in rows:
        r["xy"] = frame.xy((r["lon"], r["lat"]))
    return rows


def build(region: str, cache: SegmentationCache, max_images: int, grip_attributes: bool = False) -> dict:
    out_dir = folder(region)
    world_box = json.loads((out_dir / "sf-corridor-3d.json").read_text())["bbox"]
    grip = json.loads(gzip.decompress((ROOT / f"data/electrical/grip/{region}.json.gz").read_bytes()))
    furniture = json.loads((out_dir / "sf-corridor-furniture.json").read_text())["inferred"]
    frame = Frame(world_box["west"], world_box["south"])
    poles = {}
    for item in (furniture.get("utility_poles") or []) + (furniture.get("detected_utility_poles") or []):
        if item.get("id") and item.get("p"):
            poles[item["id"]] = {"id": item["id"], "p": item["p"], "xy": frame.xy(item["p"]),
                                 "source": item.get("source")}
    detections = len(poles)
    merged, _alias = merge_duplicate_poles(list(poles.values()))
    poles = {p["id"]: p for p in merged}
    network = Network(grip["lines"], frame)
    calibration = calibrate(np.array([p["xy"] for p in poles.values()]),
                            [e["xy"] for e in network.edges])
    if calibration["status"] != "calibrated":
        print(f"{region}: no pole/network association ({calibration['status']}); nothing built")
        spans, matched = [], {"ambiguous": set(), "matched": set()}
    else:
        matched = match_poles(network, list(poles.values()), calibration["threshold_m"])
        spans = candidate_spans(network, poles, matched["ambiguous"])

    # OpenStreetMap: an underground cable along both poles vetoes; an overhead way confirms.
    power = osm_power(region, world_box)
    under, over = [], []
    for way in power:
        tags = way.get("tags", {})
        pts = [frame.xy((g["lon"], g["lat"])) for g in way.get("geometry", [])]
        if len(pts) < 2:
            continue
        if tags.get("power") == "cable" or "underground" in str(tags.get("location", "")):
            under.append(pts)
        elif tags.get("power") in {"line", "minor_line"}:
            over.append(pts)

    def along(route_list, a, b, tolerance=4.0):
        return any(project(a, r)["offset_m"] <= tolerance and project(b, r)["offset_m"] <= tolerance
                   for r in route_list)

    index = image_index(region, world_box, [(poles[s["a"]]["xy"], poles[s["b"]]["xy"]) for s in spans],
                        frame) if spans else []
    grid: dict[tuple, list] = {}
    for image in index:
        grid.setdefault((int(image["xy"][0] // 30), int(image["xy"][1] // 30)), []).append(image)
    wanted = {}
    for span in spans:
        a, b = poles[span["a"]]["xy"], poles[span["b"]]["xy"]
        nearby = []
        for gx in range(int(min(a[0], b[0]) // 30) - 1, int(max(a[0], b[0]) // 30) + 2):
            for gy in range(int(min(a[1], b[1]) // 30) - 1, int(max(a[1], b[1]) // 30) + 2):
                nearby.extend(grid.get((gx, gy), []))
        span["_images"] = [i["id"] for i in choose_images(nearby, frame, a, b, limit=max_images)]
        for image_id in span["_images"]:
            wanted[image_id] = True
    print(f"{region}: {detections} pole detections -> {len(poles)} poles, threshold {calibration.get('threshold_m')} m, "
          f"{len(matched['matched'])} on the network, {len(spans)} candidate spans, "
          f"{len(wanted)} photographs to read", flush=True)
    cache.ensure(list(wanted), progress=lambda n, t: print(f"  {region}: segmentation {n}/{t}", flush=True))

    records, drawn = [], []
    for span in spans:
        a, b = poles[span["a"]], poles[span["b"]]
        views = []
        for image_id in span.pop("_images"):
            view = cache.get(image_id)
            if view:
                views.append(score_view(view, decode(view), frame, a["xy"], b["xy"]))
        if along(over, a["xy"], b["xy"]):
            views.append({"image": "osm_overhead_way", "sequence": "openstreetmap", "result": "electrical"})
        verdict = decide(span, views, underground=along(under, a["xy"], b["xy"]))
        record = {**{k: v for k, v in span.items() if k not in {"feeder", "grip_ids", "sections"}},
                  "feeder_key": feeder_key(span["feeder"]),
                  "pa": a["p"], "pb": b["p"], "pole_sources": [a["source"], b["source"]],
                  **verdict, "views": views,
                  "geometry_basis": "observed_poles_along_pge_grip_route",
                  "network_source": "pge_grip_line_detail"}
        records.append(record)
        if verdict["render"]:
            # The span (our poles, a wire seen between them) is Kerbside's own evidence; the
            # phase count, voltage and feeder are PG&E's attributes, published only with leave.
            drawn.append({"a": span["a"], "b": span["b"], "pa": a["p"], "pb": b["p"],
                          **({"phases": span.get("phase_count"), "kv": span.get("voltage_kv"),
                              "f": record["feeder_key"]} if grip_attributes else {}),
                          "type": verdict["wire_type"], "c": verdict["confidence"],
                          "seen": verdict["positive_sequences"],
                          "osm": any(v["image"] == "osm_overhead_way" for v in views)})
    counts = Counter(r["status"] for r in records)
    types = Counter(r["wire_type"] for r in records if r["render"])
    views_total = Counter(v["result"] for r in records for v in r["views"])
    common = {"schema": "kerbside.electrical_spans/1", "region": region,
              "built_at": datetime.now(UTC).isoformat(),
              "method": "observed poles placed on PG&E GRIP LineDetail routes within an empirically "
                        "calibrated tolerance; consecutive along the network; confirmed by projecting "
                        "the span into Mapillary segmentation with a sham-span control",
              "calibration": calibration, "pole_detections": detections, "poles": len(poles),
              "duplicate_merge_m": 6.0, "poles_on_network": len(matched["matched"]),
              "ambiguous_poles": len(matched["ambiguous"]), "counts": dict(counts),
              "drawn_types": dict(types), "view_results": dict(views_total),
              "grip_attributes_published": grip_attributes,
              "attribution": ["PG&E GRIP (route reference only; no PG&E geometry or attributes "
                              "published unless grip_attributes_published)",
                              "Mapillary contributors, CC BY-SA 4.0 (segmentation)",
                              "© OpenStreetMap contributors, ODbL"]}
    # Every candidate's evidence: an audit file, not served (the page never loads it).
    details = ROOT / "build/electrical" / f"{region}-electrical-details.json"
    details.parent.mkdir(parents=True, exist_ok=True)
    details.write_text(json.dumps({**common, "spans": records}, separators=(",", ":")) + "\n")
    for target in (out_dir, *([ROOT / "docs/app-regions" / region]
                              if (ROOT / "docs/app-regions" / region / "sf-corridor-furniture.json").exists()
                              else [])):
        # The expanded Oakland app world carries its own copy of the region's sidecars.
        (target / "sf-corridor-electrical.json").write_text(
            json.dumps({**common, "spans": drawn}, separators=(",", ":")) + "\n")
    print(f"{region}: {dict(counts)}; drawn {dict(types)}; views {dict(views_total)}", flush=True)
    return common


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--region", action="append")
    parser.add_argument("--max-images", type=int, default=4)
    parser.add_argument("--publish-grip-attributes", action="store_true",
                        help="also publish PG&E's phase count, voltage and feeder key per span "
                             "(only once PG&E has given leave to redistribute derivatives)")
    args = parser.parse_args()
    cache = SegmentationCache(ROOT / "data/electrical/imagery-cache/segmentation.jsonl")
    for region in args.region or REGIONS:
        build(region, cache, args.max_images, args.publish_grip_attributes)
    # Every region built so far, read back from its sidecar, so one region's rerun keeps the rest.
    summary = {region: json.loads((folder(region) / "sf-corridor-electrical.json").read_text())
               for region in REGIONS if (folder(region) / "sf-corridor-electrical.json").exists()}
    (ROOT / "data/electrical").mkdir(exist_ok=True)
    (ROOT / "data/electrical/summary.json").write_text(json.dumps(
        {k: {key: v[key] for key in ("calibration", "pole_detections", "poles", "poles_on_network", "ambiguous_poles",
                                     "counts", "drawn_types", "view_results")}
         for k, v in summary.items() if "pole_detections" in v}, indent=1) + "\n")


if __name__ == "__main__":
    main()
