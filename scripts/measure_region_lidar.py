#!/usr/bin/env python3
"""Read a region's kerbs and roofs off the public lidar, so "lidar" in its capabilities is true.

    python scripts/measure_region_lidar.py oakland-downtown

For every street way in data/regions/<name>/osm_ways.json: the kerb offsets left and right of
the centreline and their heights, every 4 m (smc.lidar.region.street_kerbs). For every
building footprint: the roof height over the ground at its foot (building_height). Both from
the collection discovery found for the region, fetched cell by cell (CELL_M) into a cache
that is deleted as each cell finishes, so a region costs a few hundred megabytes of disk at a
time rather than a few gigabytes.

Writes, in the shape the builder already reads for the city's records:

  data/regions/<name>/official/curb_profiles_lidar.json      grade "lidar", one profile per
                                                             way keyed osm:<id>; the city's own
                                                             curb_profiles_corridor.json, where
                                                             a city has one, outranks it
  data/regions/<name>/official/centrelines_osm.json          the street ways themselves
  data/regions/<name>/lidar/building_heights.json            keyed by osm id
  data/regions/<name>/lidar/cells.jsonl                      the journal: one line per cell

Resumable: a cell already in the journal is not fetched again. Runs inside
scripts/ingest_region.py as the ``lidar`` stage, between terrain and imagery.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import get_region  # noqa: E402
from smc.lidar.ept import EptReader  # noqa: E402
from smc.lidar.region import STATION_M, building_height, street_kerbs  # noqa: E402
from smc.net import use_certifi  # noqa: E402

use_certifi()

#: Cells the region is fetched in. A 120 m cell at 0.15 m is about forty megabytes.
CELL_M = 120.0
#: Finer than the terrain's half metre, coarser than the footway pass's decimetre: a kerb
#: riser is a quarter-metre bin, and 0.15 m puts a dozen returns in each.
RESOLUTION_M = 0.15
REACH_M = 26.0
STREET_KINDS = ("street",)
SKIP_SERVICE = ("driveway", "parking_aisle", "drive-through")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("region")
    ap.add_argument("--limit-cells", type=int, default=0)
    args = ap.parse_args()
    region = get_region(args.region)
    base = ROOT / "data" / "regions" / region.name
    ways_path = base / "osm_ways.json"
    caps_path = base / "capabilities.json"
    if not ways_path.exists() or not caps_path.exists():
        print(f"{region.name}: needs osm_ways.json and capabilities.json first", file=sys.stderr)
        return 1
    collections = [c["dataset"] for c in json.loads(caps_path.read_text()).get("lidar", {}).get("collections", [])
                   if c.get("coverage", 0) >= 0.5]
    if not collections:
        print(f"{region.name}: no lidar collection covers it; nothing to measure", file=sys.stderr)
        return 0
    dataset = collections[0]
    ways = json.loads(ways_path.read_text())
    streets = [w for w in ways if w.get("kind") in STREET_KINDS and w.get("points") and len(w["points"]) >= 2
               and w.get("osm_id") is not None and w.get("service") not in SKIP_SERVICE
               and not w.get("tunnel")]
    buildings = [w for w in ways if w.get("kind") == "building" and w.get("points") and len(w["points"]) >= 3
                 and w.get("osm_id") is not None]
    print(f"{region.name}: {len(streets)} streets, {len(buildings)} buildings, lidar {dataset}", flush=True)

    lat0, lon0 = region.bbox.centre
    kx = 111_320.0 * math.cos(math.radians(lat0))
    ky = 111_320.0

    def cell_of(lon: float, lat: float) -> tuple[int, int]:
        return int(((lon - lon0) * kx) // CELL_M), int(((lat - lat0) * ky) // CELL_M)

    # A street is measured from the cell its midpoint is in, with the cloud reaching past the
    # cell's edge by the search width; a long way is split into pieces first.
    by_cell: dict[tuple[int, int], dict[str, list]] = defaultdict(lambda: {"streets": [], "buildings": []})
    for way in streets:
        for piece in split_way(way["points"], CELL_M):
            mid = piece[len(piece) // 2]
            by_cell[cell_of(mid[0], mid[1])]["streets"].append((way, piece))
    for way in buildings:
        c = way.get("centroid") or way["points"][0]
        by_cell[cell_of(c[0], c[1])]["buildings"].append(way)

    lidar_dir = base / "lidar"
    lidar_dir.mkdir(parents=True, exist_ok=True)
    journal = lidar_dir / "cells.jsonl"
    done: dict[str, dict] = {}
    if journal.exists():
        for line in journal.read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                done[row["cell"]] = row
    print(f"{len(by_cell)} cells, {len(done)} already measured", flush=True)

    cache_root = ROOT / "build" / "regions" / region.name / "lidar-cache"
    started = time.time()
    n_cells = 0
    with journal.open("a") as out:
        for (cx, cy), content in sorted(by_cell.items()):
            key = f"{cx}:{cy}"
            if key in done:
                continue
            if args.limit_cells and n_cells >= args.limit_cells:
                break
            n_cells += 1
            centre_lon = lon0 + (cx + 0.5) * CELL_M / kx
            centre_lat = lat0 + (cy + 0.5) * CELL_M / ky
            reader = EptReader(dataset, cache_dir=cache_root / key)
            try:
                cloud = reader.around(centre_lat, centre_lon, CELL_M / 2 + REACH_M, resolution_m=RESOLUTION_M)
            except Exception as exc:  # a cell the service will not serve is a gap, not a halt
                print(f"  cell {key}: unavailable: {exc}", flush=True)
                out.write(json.dumps({"cell": key, "error": str(exc), "streets": {}, "buildings": {}}) + "\n")
                out.flush()
                shutil.rmtree(cache_root / key, ignore_errors=True)
                continue
            row = {"cell": key, "points": len(cloud), "streets": {}, "buildings": {}}
            if len(cloud):
                for way, piece in content["streets"]:
                    stations = street_kerbs(cloud, piece, station_m=STATION_M)
                    if stations:
                        row["streets"].setdefault(str(way["osm_id"]), []).extend(
                            {"lon": st.lon, "lat": st.lat, "l": st.left_m, "r": st.right_m,
                             "lh": st.left_height_m, "rh": st.right_height_m, "n": st.points}
                            for st in stations)
                for way in content["buildings"]:
                    found = building_height(cloud, way["points"])
                    if found:
                        row["buildings"][str(way["osm_id"])] = found
            out.write(json.dumps(row) + "\n")
            out.flush()
            done[key] = row
            shutil.rmtree(cache_root / key, ignore_errors=True)
            if n_cells % 10 == 0:
                print(f"  {n_cells} cells this run, {len(done)} in all, "
                      f"{sum(len(v['streets']) for v in done.values())} street pieces with kerbs, "
                      f"{sum(len(v['buildings']) for v in done.values())} roofs, "
                      f"{(time.time() - started) / 60:.0f} min", flush=True)

    shutil.rmtree(cache_root, ignore_errors=True)
    write_outputs(region.name, base, streets, done)
    return 0


def split_way(points: list[list[float]], max_len_m: float) -> list[list[list[float]]]:
    """A polyline cut into runs no longer than the cell, on its own vertices."""
    pieces: list[list[list[float]]] = []
    current = [points[0]]
    acc = 0.0
    for a, b in itertools.pairwise(points):
        seg = math.hypot((b[0] - a[0]) * 88_000.0, (b[1] - a[1]) * 111_320.0)
        if acc + seg > max_len_m and len(current) >= 2:
            pieces.append(current)
            current = [a]
            acc = 0.0
        current.append(b)
        acc += seg
    if len(current) >= 2:
        pieces.append(current)
    return pieces


#: A kerb reading further than this from the running median of its neighbours along the way
#: is not the kerb: a median island, a parked car's step, a driveway's edge, the far kerb. In
#: downtown Oakland a quarter of consecutive stations differed by over a metre before this.
KERB_OUTLIER_M = 0.6
OUTLIER_WINDOW = 2


def reject_outliers(samples: list[dict]) -> int:
    """Drop, per side, the readings that leave their neighbours' running median by more than
    KERB_OUTLIER_M. The kept readings are the sensor's own, untouched; a dropped one is None,
    which the cross-section solver reads as "no kerb here" and falls back honestly."""
    dropped = 0
    for side in ("l", "r"):
        values = [s[side] for s in samples]
        keep = list(values)
        for i, v in enumerate(values):
            if v is None:
                continue
            window = [values[j] for j in range(max(0, i - OUTLIER_WINDOW), min(len(values), i + OUTLIER_WINDOW + 1))
                      if j != i and values[j] is not None]
            if len(window) < 2:
                continue
            window.sort()
            median = window[len(window) // 2]
            if abs(v - median) > KERB_OUTLIER_M:
                keep[i] = None
                dropped += 1
        for s, k in zip(samples, keep):
            if k is None and s[side] is not None:
                s[side] = None
                s[side + "h"] = None
    return dropped


#: The kept readings, smoothed along the way with a running median over this many stations:
#: the riser is found in quarter-metre bins, so neighbours differed by the bin and the paint
#: laid from them stepped sideways every four metres. A median keeps a real step -- a bulb-out
#: -- where a mean would round it off.
SMOOTH_WINDOW = 5


def smooth_kept(samples: list[dict]) -> None:
    for side in ("l", "r"):
        values = [s[side] for s in samples]
        out = list(values)
        half = SMOOTH_WINDOW // 2
        for i, v in enumerate(values):
            if v is None:
                continue
            window = sorted(values[j] for j in range(max(0, i - half), min(len(values), i + half + 1)) if values[j] is not None)
            out[i] = window[len(window) // 2]
        for s, v in zip(samples, out):
            s[side] = None if v is None else round(v, 3)


def write_outputs(name: str, base: Path, streets: list[dict], done: dict[str, dict]) -> None:
    """Profiles keyed osm:<id> with stations in metres along the way, and roof heights."""
    official = base / "official"
    official.mkdir(parents=True, exist_ok=True)
    by_way: dict[str, list[dict]] = defaultdict(list)
    for row in done.values():
        for osm_id, stations in row["streets"].items():
            by_way[osm_id].extend(stations)
    profiles: dict[str, dict] = {}
    heights_by_way: dict[str, list[float]] = {}
    centrelines = []
    outliers = 0
    for way in streets:
        osm_id = str(way["osm_id"])
        key = f"osm:{osm_id}"
        centrelines.append({"id": key, "points": way["points"], "name": way.get("name") or ""})
        stations = by_way.get(osm_id)
        if not stations:
            continue
        samples = []
        for st in stations:
            s = station_along(way["points"], st["lon"], st["lat"])
            samples.append({"s": round(s, 2), "l": st["l"], "r": st["r"], "lh": st["lh"], "rh": st["rh"], "n": st["n"]})
        samples.sort(key=lambda r: r["s"])
        outliers += reject_outliers(samples)
        if not any(s["l"] is not None or s["r"] is not None for s in samples):
            continue
        smooth_kept(samples)
        profiles[key] = {"samples": samples}
        heights = [h for s in samples for h in (s["lh"], s["rh"]) if h is not None]
        if heights:
            heights_by_way[key] = heights
    (official / "curb_profiles_lidar.json").write_text(json.dumps({
        "grade": "lidar",
        "note": f"Kerb offsets left (l) and right (r) of the OpenStreetMap centreline every {STATION_M} m, "
                "with the riser heights (lh, rh), read from the USGS 3DEP lidar by "
                "scripts/measure_region_lidar.py (smc.lidar.region.street_kerbs). A station with "
                "no riser the sensor could tell from its noise is absent.",
        "region": name,
        "outliers_dropped": outliers,
        "outlier_rule": f"a reading over {KERB_OUTLIER_M} m from the running median of its neighbours "
                        f"(+/-{OUTLIER_WINDOW} stations) is dropped, not moved",
        "smoothing": f"the kept offsets are the running median over {SMOOTH_WINDOW} stations along the way",
        "profiles": profiles}, separators=(",", ":")))
    (official / "centrelines_osm.json").write_text(json.dumps(centrelines, separators=(",", ":")))
    kerb_heights = {key: {"curb_height_m": round(float(sorted(h)[len(h) // 2]), 3), "curb_height_n": len(h)}
                    for key, h in heights_by_way.items()}
    (base / "lidar" / "kerb_heights.json").write_text(json.dumps(kerb_heights, separators=(",", ":")))
    roofs: dict[str, dict] = {}
    for row in done.values():
        roofs.update(row["buildings"])
    (base / "lidar" / "building_heights.json").write_text(json.dumps({
        "source": "USGS 3DEP lidar: the 92nd percentile of the non-ground returns inside the footprint "
                  "over the median ground return at its foot (smc.lidar.region.building_height)",
        "buildings": roofs}, separators=(",", ":")))
    stations_n = sum(len(p["samples"]) for p in profiles.values())
    both = sum(1 for p in profiles.values() for s in p["samples"] if s["l"] is not None and s["r"] is not None)
    print(f"wrote {len(profiles)} street profiles ({stations_n} stations, {both} with both kerbs, "
          f"{outliers} readings dropped as outliers), {len(kerb_heights)} kerb heights, "
          f"{len(roofs)} roof heights under {base}")


def station_along(points: list[list[float]], lon: float, lat: float) -> float:
    """Metres along the polyline to the point nearest ``(lon, lat)``."""
    best, best_d, acc = 0.0, None, 0.0
    for a, b in itertools.pairwise(points):
        bx = (b[0] - a[0]) * 88_000.0
        by = (b[1] - a[1]) * 111_320.0
        px = (lon - a[0]) * 88_000.0
        py = (lat - a[1]) * 111_320.0
        seg2 = bx * bx + by * by
        t = max(0.0, min(1.0, (px * bx + py * by) / seg2)) if seg2 else 0.0
        d = math.hypot(px - bx * t, py - by * t)
        if best_d is None or d < best_d:
            best_d, best = d, acc + math.sqrt(seg2) * t
        acc += math.sqrt(seg2)
    return best


if __name__ == "__main__":
    raise SystemExit(main())
