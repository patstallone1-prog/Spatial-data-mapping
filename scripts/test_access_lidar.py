#!/usr/bin/env python3
"""Test the lidar's ramp and stair candidates against the records that already exist.

    python scripts/test_access_lidar.py sf-haight-castro [oakland-downtown ...]

Ramps: at both ends of every OpenStreetMap crossing in the region, the kerb step is measured
off the lidar (smc.lidar.ramps.kerb_step_at) and compared with

* San Francisco: Public Works' curb ramp inventory (DataSF), one record per corner of every
  intersection, ``no_ramp`` where the corner has none (docs/regions/<name>/sf-corridor-official
  .json ``curb_ramps``); the crossing end's corner is read by its bearing from the record;
* elsewhere: OpenStreetMap's kerb nodes within 2.5 m of the end (``kerb=flush|lowered`` a ramp,
  ``raised`` none).

Stairs: every footway in the region is profiled (stair_profile) and compared with the mapped
flights of steps (docs/regions/<name>/sf-corridor-stairs.json, OpenStreetMap highway=steps).

Nothing here changes what the page draws. Writes data/regions/<name>/lidar/access_test.json and
prints precision and coverage.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
#: Where the region's ingested data is (a worktree has none of its own: the main checkout's).
DATA = Path(os.environ.get("KERBSIDE_DATA_ROOT", ROOT))

from smc.lidar.ept import SF_DATASET, EptReader  # noqa: E402
from smc.lidar.ramps import kerb_step_at, stair_profile  # noqa: E402

CELL_M = 120.0
REACH_M = 30.0
RESOLUTION_M = 0.1
CORNER_REACH_M = 30.0
KERB_NODE_REACH_M = 2.5


def dataset_of(name: str) -> str:
    caps = DATA / "data" / "regions" / name / "capabilities.json"
    if caps.exists():
        for c in json.loads(caps.read_text()).get("lidar", {}).get("collections", []):
            if c.get("coverage", 0) >= 0.9:
                return c["dataset"]
    return SF_DATASET


def metres(lat0: float):
    ky = 111_320.0
    kx = ky * math.cos(math.radians(lat0))
    return kx, ky


def corner_truth(name: str):
    """A function (lon, lat) -> 'ramp' | 'kerb' | None from the city's inventory."""
    path = ROOT / "docs" / "regions" / name / "sf-corridor-official.json"
    if not path.exists():
        return None
    ramps = json.loads(path.read_text()).get("curb_ramps") or []
    if not ramps:
        return None
    lat0 = ramps[0]["p"][1]
    kx, ky = metres(lat0)
    places: dict[tuple[float, float], list[dict]] = {}
    for r in ramps:
        if r.get("p") and r.get("c"):
            places.setdefault((r["p"][0], r["p"][1]), []).append(r)

    def truth(lon: float, lat: float) -> str | None:
        best = None
        for (plon, plat), rows in places.items():
            d = math.hypot((lon - plon) * kx, (lat - plat) * ky)
            if d <= CORNER_REACH_M and (best is None or d < best[0]):
                best = (d, plon, plat, rows)
        if best is None:
            return None
        _, plon, plat, rows = best
        corner = ("N" if lat >= plat else "S") + ("E" if lon >= plon else "W")
        mine = [r for r in rows if r["c"] == corner or (len(r["c"]) == 1 and r["c"] in corner)]
        if not mine:
            return None
        has = [("no_ramp" not in (r.get("f") or [])) for r in mine]
        return "ramp" if any(has) else "kerb"
    return truth


def node_truth(ways: list[dict]):
    nodes = [w for w in ways if w.get("kind") == "curb_ramp" and w.get("point")]
    if not nodes:
        return None
    kx, ky = metres(nodes[0]["point"][1])

    def truth(lon: float, lat: float) -> str | None:
        best = None
        for w in nodes:
            d = math.hypot((lon - w["point"][0]) * kx, (lat - w["point"][1]) * ky)
            if d <= KERB_NODE_REACH_M and (best is None or d < best[0]):
                best = (d, w)
        if best is None:
            return None
        kind = best[1].get("kerb_type")
        return "ramp" if kind in ("flush", "lowered") else "kerb" if kind == "raised" else None
    return truth


def run(name: str) -> dict:
    ways = json.loads((DATA / "data" / "regions" / name / "osm_ways.json").read_text())
    truth = corner_truth(name) or node_truth(ways)
    stairs_path = ROOT / "docs" / "regions" / name / "sf-corridor-stairs.json"
    stair_ids = {str(s["osm_id"]) for s in json.loads(stairs_path.read_text())["stairs"]} if stairs_path.exists() else set()
    ends = []
    for w in ways:
        if w.get("kind") == "crossing" and len(w.get("points") or []) >= 2:
            p = w["points"]
            ends.append({"way": w.get("osm_id"), "end": p[0], "toward": p[-1]})
            ends.append({"way": w.get("osm_id"), "end": p[-1], "toward": p[0]})
    paths = [w for w in ways if w.get("kind") == "path" and len(w.get("points") or []) >= 2]
    if stairs_path.exists():   # the mapped flights themselves, in case the region's paths left any out
        known = {str(w.get("osm_id")) for w in paths}
        paths += [{"kind": "path", "osm_id": s["osm_id"], "points": s["points"]}
                  for s in json.loads(stairs_path.read_text())["stairs"] if str(s["osm_id"]) not in known]
    allpts = [e["end"] for e in ends] + [p["points"][0] for p in paths]
    lat0 = sum(p[1] for p in allpts) / len(allpts)
    lon0 = sum(p[0] for p in allpts) / len(allpts)
    kx, ky = metres(lat0)
    key = lambda lon, lat: (int(((lon - lon0) * kx) // CELL_M), int(((lat - lat0) * ky) // CELL_M))
    cells: dict[tuple[int, int], dict] = {}
    for e in ends:
        cells.setdefault(key(*e["end"]), {"ends": [], "paths": []})["ends"].append(e)
    for p in paths:
        mid = p["points"][len(p["points"]) // 2]
        cells.setdefault(key(*mid), {"ends": [], "paths": []})["paths"].append(p)
    reader = EptReader(dataset_of(name), cache=False)
    ramp_rows, stair_rows = [], []
    started = time.time()
    for n, ((cx, cy), content) in enumerate(sorted(cells.items())):
        clon = lon0 + (cx + 0.5) * CELL_M / kx
        clat = lat0 + (cy + 0.5) * CELL_M / ky
        try:
            cloud = reader.around(clat, clon, CELL_M / 2 + REACH_M, resolution_m=RESOLUTION_M)
        except Exception as exc:
            print(f"  cell {cx}:{cy}: {exc}", flush=True)
            continue
        half = (CELL_M / 2 + REACH_M) * 0.98
        inside = lambda lon, lat: abs((lon - clon) * kx) < half and abs((lat - clat) * ky) < half
        for e in content["ends"]:
            r = kerb_step_at(cloud, e["end"], e["toward"])
            ramp_rows.append({**e, **r, "truth": truth(*e["end"]) if truth else None})
        for p in content["paths"]:
            if not all(inside(*q) for q in p["points"]):
                stair_rows.append({"way": p.get("osm_id"), "skipped": "longer than a cell"})
                continue
            r = stair_profile(cloud, p["points"])
            stair_rows.append({"way": p.get("osm_id"), **r, "truth": str(p.get("osm_id")) in stair_ids})
        if n % 10 == 0:
            print(f"  {name}: cell {n + 1}/{len(cells)}, {time.time() - started:.0f} s", flush=True)
    report = {"region": name, "ramps": summarise_ramps(ramp_rows), "stairs": summarise_stairs(stair_rows)}
    out = ROOT / "data" / "regions" / name / "lidar"
    out.mkdir(parents=True, exist_ok=True)
    (out / "access_test.json").write_text(json.dumps({**report, "ramp_rows": ramp_rows, "stair_rows": stair_rows}))
    return report


def summarise_ramps(rows: list[dict]) -> dict:
    table = Counter((r["class"], r.get("truth")) for r in rows)
    out: dict = {"crossing_ends": len(rows), "table": {f"{a}|{b}": n for (a, b), n in sorted(table.items(), key=str)}}
    for cls in ("ramp", "kerb"):
        judged = sum(n for (a, b), n in table.items() if a == cls and b in ("ramp", "kerb"))
        right = table.get((cls, cls), 0)
        out[f"{cls}_precision"] = round(right / judged, 3) if judged else None
        out[f"{cls}_judged"] = judged
        truth_n = sum(n for (a, b), n in table.items() if b == cls)
        out[f"{cls}_recall"] = round(right / truth_n, 3) if truth_n else None
    out["answered"] = round(sum(n for (a, _), n in table.items() if a != "unknown") / max(1, len(rows)), 3)
    return out


def summarise_stairs(rows: list[dict]) -> dict:
    rows = [r for r in rows if "skipped" not in r and r.get("stairs") is not None]
    tp = sum(1 for r in rows if r["stairs"] and r["truth"])
    fp = sum(1 for r in rows if r["stairs"] and not r["truth"])
    fn = sum(1 for r in rows if not r["stairs"] and r["truth"])
    return {"footways": len(rows), "mapped_stairs": tp + fn, "found": tp, "candidates_not_mapped": fp,
            "precision_vs_map": round(tp / (tp + fp), 3) if tp + fp else None,
            "recall": round(tp / (tp + fn), 3) if tp + fn else None,
            "unmapped_candidates": [r["way"] for r in rows if r["stairs"] and not r["truth"]][:50]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("regions", nargs="+")
    args = parser.parse_args()
    for name in args.regions:
        print(json.dumps(run(name), indent=1), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
