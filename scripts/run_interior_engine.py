#!/usr/bin/env python3
"""Run the interior inference engine over every eligible mapped house, region by region.

Eligible is the pilot's own rule (scripts/build_inferred_interiors.py fixtures): an OSM
``building=house`` or ``detached`` footprint of 65-240 m2. Houses go through the engine's batch
script twenty at a time (its bound), a few batches at once, into build/inferred-interiors/
(not docs/: publishing is a separate step). A batch with a manifest is done, so a run that
stops picks up where it left off. ``--merge`` writes one map overlay and manifest for all.
``--publish`` puts every accepted house (its validation passed) into docs/inferred-interiors/,
where the map furnishes it with that interior in place of its fitted plan; a house accepted
again replaces the one published before. ``--max-batches`` runs only so many unfinished batches.

In the cloud (smc.cloud.stages.interior_batch) each batch is a job of its own: ``--batch
REGION:INDEX`` runs that one batch and nothing else, and ``--counts`` prints how many batches
each region has, which is how the plan knows what to submit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from shapely.geometry import Polygon, mapping

ROOT = Path(__file__).resolve().parents[1]
REGIONS = ["sf-corridor", "berkeley-downtown", "oakland-downtown", "palo-alto-downtown",
           "san-jose-downtown", "sf-haight-castro", "sf-mission", "sf-sunset"]
BATCH = 20
#: A batch is not started with less than this free on the disk it writes to (swap shares it).
MIN_FREE_BYTES = int(1.5 * 2**30)


def region_base(region: str) -> Path:
    return ROOT / "docs" if region == "sf-corridor" else ROOT / "docs/regions" / region


def eligible(region: str) -> list[dict]:
    """The region's houses as engine inputs, in a fixed order (SHA-256 of the OSM id)."""
    base = region_base(region)
    page = json.loads((base / "sf-corridor-3d.json").read_text())
    fits = json.loads((base / "sf-corridor-interiors.json").read_text())["buildings"]
    rows = []
    for way in page["ways"]:
        if way.get("kind") != "building" or way.get("tags", {}).get("building") not in {"house", "detached"}:
            continue
        pts = way.get("points") or []
        if not pts:
            continue
        lon, lat = way.get("centroid", pts[0])
        p = Polygon([((x - lon) * 111320 * math.cos(math.radians(lat)), (y - lat) * 111320) for x, y in pts])
        if not p.is_valid or not 65 <= p.area <= 240:
            continue
        height = float(way.get("height_m", 3))
        count = max(1, min(3, round(height / 3)))
        storey_m = max(2.4, min(4.5, height / count))
        fitted = fits.get(str(way["osm_id"]))
        entrance = None
        if fitted and fitted[13]:
            edge, t, _, _ = fitted[13][0]
            a, b = list(p.exterior.coords)[edge:edge + 2]
            entrance = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        rows.append({
            "id": f"osm-{way['osm_id']}", "osm_id": str(way["osm_id"]), "region": region,
            "entrance": entrance,
            "name": way.get("address", {}).get("formatted") or f"OSM {way['osm_id']}",
            "footprint": mapping(p), "units": "metres", "origin_lon_lat": [lon, lat],
            "storeys": [{"height_m": storey_m} for _ in range(count)],
            "source": "Kerbside published OSM footprint, local tangent-plane metres",
            "storey_evidence": "count and equal heights inferred from shell height",
            "shell_height_m": height, "office": False, "neighborhood_price_per_sqft": None,
        })
    return sorted(rows, key=lambda r: hashlib.sha256(r["osm_id"].encode()).hexdigest())


def batch_counts(regions: list[str]) -> dict[str, int]:
    """How many batches of BATCH houses each region's eligible houses make."""
    return {region: math.ceil(len(eligible(region)) / BATCH) for region in regions}


def run_batch(region: str, index: int, rows: list[dict], out: Path) -> str:
    folder = out / region / f"batch-{index:03d}"
    if (folder / "manifest.json").exists():
        return f"{region} {index}: done already"
    if shutil.disk_usage(out).free < MIN_FREE_BYTES:
        return f"{region} {index}: held, under {MIN_FREE_BYTES / 2**30:.1f} GB free (rerun to resume)"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "request.json").write_text(json.dumps(rows))
    started = time.time()
    with open(folder / "run.log", "w") as log:
        code = subprocess.call(
            [sys.executable, str(ROOT / "scripts/build_inferred_interiors.py"),
             "--input", str(folder / "request.json"), "--out", str(folder)],
            stdout=log, stderr=subprocess.STDOUT, env={**os.environ, "KERBSIDE_REGION": region})
    passed = sum(line.startswith("PASS") for line in (folder / "run.log").read_text().splitlines())
    return f"{region} {index}: {passed}/{len(rows)} passed in {time.time() - started:.0f} s (exit {code})"


def merge(out: Path) -> None:
    overlay, records = {}, []
    for manifest in sorted(out.glob("*/batch-*/manifest.json")):
        folder = manifest.parent
        for record in json.loads(manifest.read_text())["houses"]:
            record = {**record, "file": f"{folder.parent.name}/{folder.name}/{record.get('file', '')}",
                      "region": folder.parent.name}
            records.append(record)
        for osm_id, ref in json.loads((folder / "map-overlay.json").read_text())["buildings"].items():
            overlay[osm_id] = {**ref, "file": f"{folder.parent.name}/{folder.name}/{ref['file']}"}
    (out / "map-overlay.json").write_text(json.dumps(
        {"schema": "kerbside.inferred_house_overlay/1", "buildings": overlay}, indent=1) + "\n")
    (out / "manifest.json").write_text(json.dumps({
        "schema": "kerbside.inferred_house_batch/1",
        "selection": "every OSM house/detached footprint of 65-240 m2, ordered by SHA256(id)",
        "houses": records, "passed": sum(r["passed"] for r in records), "total": len(records),
        "asset_manifest": "../interior-assets/manifest.json", "measured": False}, indent=1) + "\n")
    print(f"merged: {len(overlay)} houses on the map, {sum(r['passed'] for r in records)}/{len(records)} passed")


PUBLISHED = ROOT / "docs/inferred-interiors"


def publish(out: Path, published: Path = PUBLISHED) -> int:
    """Copy the accepted houses into the site and add them to its overlay; returns how many."""
    overlay_path = published / "map-overlay.json"
    overlay = json.loads(overlay_path.read_text())["buildings"] if overlay_path.exists() else {}
    added = 0
    for manifest in sorted(out.glob("*/batch-*/manifest.json")):
        folder = manifest.parent
        refs = json.loads((folder / "map-overlay.json").read_text())["buildings"]
        for record in json.loads(manifest.read_text())["houses"]:
            osm_id = record["id"].removeprefix("osm-")
            source = folder / record.get("file", "")
            if not record.get("passed") or osm_id not in refs or not source.is_file():
                continue
            house = json.loads(source.read_text())
            # The page takes only an inferred hypothesis that passed its own validation.
            if not house.get("validation", {}).get("passed") or house.get("grade") != "inferred":
                continue
            name = f"houses/{folder.parent.name}/{source.name}"
            target = published / name
            target.parent.mkdir(parents=True, exist_ok=True)
            text = json.dumps(house, separators=(",", ":"))  # half the batch file's size
            if not target.exists() or target.read_text() != text:
                target.write_text(text)
                added += 1
            overlay[osm_id] = {**refs[osm_id], "file": name}
    overlay_path.write_text(json.dumps(
        {"schema": "kerbside.inferred_house_overlay/1", "buildings": overlay}, indent=1) + "\n")
    print(f"published: {added} new or replaced, {len(overlay)} houses furnished by the engine")
    return added


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regions", nargs="*", default=REGIONS)
    parser.add_argument("--out", type=Path, default=ROOT / "build/inferred-interiors")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--count", action="store_true", help="only count the eligible houses")
    parser.add_argument("--merge", action="store_true", help="only merge finished batches")
    parser.add_argument("--publish", action="store_true", help="only publish the accepted houses")
    parser.add_argument("--max-batches", type=int, help="run at most this many unfinished batches")
    parser.add_argument("--batch", help="REGION:INDEX -- run that one batch only (a cloud job)")
    parser.add_argument("--counts", action="store_true", help="print each region's batch count as JSON")
    args = parser.parse_args()
    if args.counts:
        print(json.dumps(batch_counts(args.regions)))
        return
    if args.batch:
        region, index = args.batch.rsplit(":", 1)
        rows = eligible(region)[int(index) * BATCH:(int(index) + 1) * BATCH]
        if not rows:
            raise SystemExit(f"{region} has no batch {index}")
        line = run_batch(region, int(index), rows, args.out)
        print(line, flush=True)
        # A batch held for disk, or one whose engine exited without a manifest, is not done.
        if not (args.out / region / f"batch-{int(index):03d}" / "manifest.json").exists():
            raise SystemExit(1)
        return
    if args.merge:
        merge(args.out)
        return
    if args.publish:
        publish(args.out)
        return
    jobs = []
    for region in args.regions:
        rows = eligible(region)
        print(f"{region}: {len(rows)} eligible houses", flush=True)
        jobs += [(region, i // BATCH, rows[i:i + BATCH]) for i in range(0, len(rows), BATCH)]
    if args.count:
        return
    if args.max_batches is not None:
        jobs = [job for job in jobs
                if not (args.out / job[0] / f"batch-{job[1]:03d}" / "manifest.json").exists()][:args.max_batches]
    print(f"{len(jobs)} batches, {args.workers} at a time", flush=True)
    with ThreadPoolExecutor(args.workers) as pool:
        for line in pool.map(lambda job: run_batch(*job, args.out), jobs):
            print(line, flush=True)
    merge(args.out)


if __name__ == "__main__":
    main()
