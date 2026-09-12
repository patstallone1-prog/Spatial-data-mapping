#!/usr/bin/env python3
"""Harvest San Francisco's published street geometry and check it against our own.

Three outputs, in order of how much they matter.

The first is a comparison. We have ten thousand LiDAR cross-sections carrying a sidewalk width
and a curb height each; the city has a 2014 survey of sidewalk widths on nearly every segment.
Nothing in this project has previously been able to say how accurate its own geometry is. This
says so, in metres, per fact class.

The second is a per-segment geometry table, so the reconstruction can stop using one width for
every street in San Francisco and one curb height for every kerb in it.

The third is the record of where all of it came from, which is the part that lets somebody
disagree with us later.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402

from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.official.crs import geojson_points  # noqa: E402
from smc.official.curbs import curb_role  # noqa: E402
from smc.official.datasf import DATASETS, fetch  # noqa: E402
from smc.official.extract import (  # noqa: E402
    EXTRACTORS,
    acceptance_index,
    segment_id,
)
from smc.official.join import CentrelineIndex  # noqa: E402
from smc.official.reconcile import compare_widths  # noqa: E402
from smc.official.schema import OfficialFactClass  # noqa: E402
from smc.official.sfmta import LAYERS as SFMTA_LAYERS, fetch as sfmta_fetch  # noqa: E402

CACHE = ROOT / "build" / "sf_public_works"
SFMTA_CACHE = ROOT / "build" / "sfmta"
OUT = ROOT / "data" / "sf_public_works"
VIEWER = ROOT / "docs" / "sf-corridor-official.json"
LIDAR = ROOT / "data" / "sf_corridor" / "depth" / "lidar" / "curb_sections.jsonl"

CORRIDOR = {"south": 37.786, "west": -122.4475, "north": 37.8095, "east": -122.392}


def simplify(points: list[tuple[float, float]], tolerance_m: float,
             frame: LocalFrame) -> list[tuple[float, float]]:
    """Douglas-Peucker, in metres.

    The basemap curb linework arrives at survey vertex density -- four hundred points on a
    block -- which is nine megabytes of curb for a page that already downloads eleven of city.
    Thinning to a tenth of a metre is well inside the accuracy the publisher claims for it and
    is invisible at any distance a person looks at this from.
    """
    if len(points) < 3:
        return points
    local = [frame.to_xy(lon, lat) for lon, lat in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        if last <= first + 1:
            continue
        ax, ay = local[first]
        bx, by = local[last]
        dx, dy = bx - ax, by - ay
        span = math.hypot(dx, dy)
        worst, worst_i = 0.0, -1
        for i in range(first + 1, last):
            px, py = local[i]
            if span < 1e-9:
                distance = math.hypot(px - ax, py - ay)
            else:
                distance = abs(dy * (px - ax) - dx * (py - ay)) / span
            if distance > worst:
                worst, worst_i = distance, i
        if worst > tolerance_m and worst_i > 0:
            keep[worst_i] = True
            stack.append((first, worst_i))
            stack.append((worst_i, last))
    return [p for p, k in zip(points, keep) if k]


def load_lidar() -> list[dict]:
    if not LIDAR.exists():
        return []
    rows = []
    for line in LIDAR.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("lat") is not None:
            rows.append(row)
    return rows


def viewer_curb_geometry(rows: list[dict], frame: LocalFrame) -> list[dict]:
    """Compact SFMTA curb boundaries for both rendering and crossing geometry.

    The smaller DataSF basemap extract omits most curb returns and bulb-outs.  Keep the
    publisher's role on every line so road-edge intersections can ignore refuge-island curbs,
    while the crossing painter can use those island curbs to split a crossing into two legs.
    """
    geometry = []
    for row in rows:
        feature = row.get("geometry") or {}
        points = feature.get("coordinates") or []
        if feature.get("type") != "LineString" or len(points) < 2:
            continue
        thinned = simplify([(float(x), float(y)) for x, y in points], 0.10, frame)
        geometry.append({
            "c": "curb",
            "r": curb_role((row.get("properties") or {}).get("CURB2_TYPE")),
            "p": [[round(x, 6), round(y, 6)] for x, y in thinned],
        })
    return geometry


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-fetch instead of using the cache")
    ap.add_argument("--chunk", help="restrict the comparison to one facade chunk key")
    ap.add_argument(
        "--curbs-only",
        action="store_true",
        help="refresh the viewer's SFMTA curb geometry without rebuilding every official fact",
    )
    args = ap.parse_args()

    def progress(message: str) -> None:
        print(message, flush=True)

    CACHE.mkdir(parents=True, exist_ok=True)
    SFMTA_CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    frame = LocalFrame((CORRIDOR["south"] + CORRIDOR["north"]) / 2,
                       (CORRIDOR["west"] + CORRIDOR["east"]) / 2)
    curb_rows, curb_document = sfmta_fetch(
        SFMTA_LAYERS["curbs"], bbox=CORRIDOR, cache_dir=SFMTA_CACHE,
        refresh=args.refresh, progress=progress,
    )
    geometry = viewer_curb_geometry(curb_rows, frame)
    progress(f"SFMTA curb linework: {len(curb_rows)} rows thinned to {len(geometry)} lines")
    if args.curbs_only:
        payload = json.loads(VIEWER.read_text()) if VIEWER.exists() else {}
        generated_from = list(payload.get("generated_from") or [])
        generated_from = [item for item in generated_from if not item.startswith("sfmta:curbs:")]
        generated_from.append(curb_document.document_id)
        payload.update({"generated_from": generated_from, "curb_lines": geometry})
        VIEWER.write_text(json.dumps(payload, separators=(",", ":")))
        progress(f"wrote {VIEWER.name}: {len(geometry)} SFMTA curb lines")
        return 0

    # Streets first: the right-of-way widths cannot be measured without knowing which way each
    # street runs, and that comes from the centreline network.
    ordered = dict(sorted(DATASETS.items(), key=lambda kv: kv[0] != "streets"))
    documents, facts, rows_by_name = [], [], {}
    directions: dict[str, tuple[float, float]] = {}
    for name, dataset in ordered.items():
        rows, document = fetch(dataset, bbox=CORRIDOR, cache_dir=CACHE,
                               refresh=args.refresh, progress=progress)
        rows_by_name[name] = rows
        documents.append(document)
        if name == "streets":
            frame0 = LocalFrame((CORRIDOR["south"] + CORRIDOR["north"]) / 2,
                                (CORRIDOR["west"] + CORRIDOR["east"]) / 2)
            for row in rows:
                points = geojson_points(row.get("line") or {})
                if len(points) < 2 or row.get("cnn") is None:
                    continue
                (x0, y0), (x1, y1) = frame0.to_xy(*points[0]), frame0.to_xy(*points[-1])
                length = math.hypot(x1 - x0, y1 - y0)
                if length > 1e-6:
                    directions[segment_id(row["cnn"])] = ((x1 - x0) / length, (y1 - y0) / length)
        extractor = EXTRACTORS.get(name)
        if extractor:
            produced = (extractor(rows, document, direction_for=directions.get)
                        if name == "right_of_way" else extractor(rows, document))
            facts.extend(produced)
            progress(f"  {name}: {len(produced)} facts")

    accepted = acceptance_index(rows_by_name.get("street_acceptance", []))
    progress(f"{len(facts)} official facts, {len(accepted)} segments with an acceptance record")

    index = CentrelineIndex.from_rows(rows_by_name.get("streets", []), frame)
    progress(f"{len(index.segments)} centrelines indexed")

    # -- the comparison ---------------------------------------------------------------------
    lidar = load_lidar()
    progress(f"{len(lidar)} lidar cross-sections")
    reconciliation = compare_widths(
        facts, lidar, locate=index.locate,
        fact_class=OfficialFactClass.SIDEWALK_WIDTH,
        value_key="sidewalk_width_m", sigma_key="sidewalk_width_sigma_m",
    )
    summary = reconciliation.summary()
    progress("sidewalk width, city survey vs our lidar:")
    progress(json.dumps(summary, indent=1))

    # -- the per-segment table --------------------------------------------------------------
    segments: dict[str, dict] = {}
    for fact in facts:
        if not fact.feature_id.startswith("sfcnn:"):
            continue
        entry = segments.setdefault(fact.feature_id, {
            "feature_id": fact.feature_id,
            "name": index.names.get(fact.feature_id, ""),
            "right_of_way_m": None, "sidewalk_m": {}, "sidewalk_standard_m": None,
            "sources": [], "accepted_on": (accepted.get(fact.feature_id) or {}).get("accepted_on"),
        })
        if fact.fact_class == OfficialFactClass.RIGHT_OF_WAY_WIDTH:
            # A segment can hold more than one apportioned polygon -- its block and its share
            # of the intersection. Keeping whichever arrived last made the width depend on row
            # order; the median of them does not.
            entry.setdefault("_row_widths", []).append(fact.value)
        elif fact.fact_class == OfficialFactClass.SIDEWALK_WIDTH:
            if fact.is_observation and fact.value is not None:
                entry["sidewalk_m"][str(fact.side)] = fact.value
            elif fact.source_label == "better_streets_minimum":
                entry["sidewalk_standard_m"] = fact.value
        if fact.document_id not in entry["sources"]:
            entry["sources"].append(fact.document_id)

    # -- curb heights, which no official record carries -------------------------------------
    #
    # There is no published curb height anywhere in San Francisco's open data. Top-of-curb and
    # flow-line elevations exist only on scanned improvement plans behind a viewer with no bulk
    # interface. So the curb height per segment stays ours, from lidar -- but it becomes *per
    # segment* rather than one median for the whole city.
    heights: dict[str, list[dict]] = defaultdict(list)
    for row in lidar:
        if row.get("curb_height_m") is None:
            continue
        placed = index.locate(row.get("lon"), row.get("lat"))
        if placed is None:
            continue
        heights[placed[0]].append(row)

    for feature, rows in heights.items():
        values = sorted(r["curb_height_m"] for r in rows)
        sigmas = [r.get("curb_height_sigma_m") or 0.0 for r in rows]
        entry = segments.setdefault(feature, {
            "feature_id": feature, "name": index.names.get(feature, ""),
            "right_of_way_m": None, "sidewalk_m": {}, "sidewalk_standard_m": None,
            "sources": [], "accepted_on": None,
        })
        entry["curb_height_m"] = round(values[len(values) // 2], 4)
        entry["curb_height_n"] = len(values)
        entry["curb_height_sigma_m"] = round(
            sum(sigmas) / len(sigmas) / math.sqrt(len(sigmas)), 4)
        entry["curb_height_source"] = "aerial_lidar"

    for entry in segments.values():
        widths = sorted(entry.pop("_row_widths", []))
        if widths:
            entry["right_of_way_m"] = widths[len(widths) // 2]

    with_curb = sum(1 for s in segments.values() if s.get("curb_height_m"))
    with_row = sum(1 for s in segments.values() if s.get("right_of_way_m"))
    with_walk = sum(1 for s in segments.values() if s.get("sidewalk_m"))
    progress(f"{len(segments)} segments: {with_row} with a recorded right of way, "
             f"{with_walk} with a surveyed footway, {with_curb} with a measured curb")

    (OUT / "segments.json").write_text(json.dumps(
        sorted(segments.values(), key=lambda s: s["feature_id"]), separators=(",", ":")))
    (OUT / "centrelines.json").write_text(json.dumps([
        {"id": feature,
         "name": index.names.get(feature, ""),
         "points": [[round(lon, 6), round(lat, 6)]
                    for lon, lat in (frame.to_lonlat(x, y) for x, y in vertices)]}
        for feature, vertices in sorted(index.segments.items())
    ], separators=(",", ":")))
    (OUT / "documents.json").write_text(json.dumps(
        [d.__dict__ if hasattr(d, "__dict__") else
         {k: getattr(d, k) for k in d.__slots__} for d in documents], indent=1, default=str))
    (OUT / "reconciliation.json").write_text(json.dumps({
        "summary": summary,
        "comparisons": [c.__dict__ for c in reconciliation.comparisons[:4000]],
    }, indent=1, default=str))

    # -- what the viewer needs --------------------------------------------------------------
    kept = sum(len(g["p"]) for g in geometry)
    progress(f"curb linework: {len(curb_rows)} SFMTA lines, {kept} retained vertices")
    ramps = [
        {"p": [round(f.geometry[0][0], 6), round(f.geometry[0][1], 6)],
         "f": list(f.flags)}
        for f in facts if f.fact_class == OfficialFactClass.CURB_RAMP and f.geometry
    ]
    # Only what the map cannot already get from its own payload. The per-segment record is
    # attached to each way at build time, so shipping it again here doubled the download for
    # nothing; the curb linework and the ramps are the part that has no other home.
    VIEWER.write_text(json.dumps({
        "generated_from": [d.document_id for d in documents] + [curb_document.document_id],
        "summary": summary,
        "curb_lines": geometry,
        "curb_ramps": ramps,
    }, separators=(",", ":")))
    progress(f"wrote {VIEWER.name}: {len(geometry)} curb lines, {len(ramps)} curb ramps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
