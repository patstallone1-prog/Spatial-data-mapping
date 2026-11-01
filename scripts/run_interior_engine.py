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

``--homes`` widens the selection to every home-like footprint: also ``building=yes``,
``residential``, ``semidetached_house`` and ``terrace`` (most San Francisco houses and rowhouses
are mapped ``yes``), unclassified or residential, at most 13 m tall, less the houses the site
already furnishes. The selection is frozen in ``<out>/<region>/selection.json`` the first time,
so batch numbers never shift under a run that resumes. With ``--store`` (the public bucket) each
finished batch's accepted houses go straight into it, gzipped, and the overlay tiles that list
them (``interiors/overlay/<tile>.json``, 0.02 degree squares, with an ``index.json``) are
rewritten; the site reads both through ``/store`` with no deploy, and the batch keeps only its
manifest and log on disk.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import threading
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
#: The pilot's own rule, and the --homes rule: what a home is mapped as in OpenStreetMap.
HOUSE_TAGS = {"house", "detached"}
HOME_TAGS = HOUSE_TAGS | {"yes", "residential", "semidetached_house", "terrace"}
HOME_ARCHETYPES = (None, "generic", "residential")
HOME_MAX_HEIGHT_M = 13.0
#: Overlay tiles in the store: squares of this many degrees, keyed "<floor(lon/d)>_<floor(lat/d)>".
TILE_DEG = 0.02
STORE_HOUSES = "interiors/houses"
STORE_OVERLAY = "interiors/overlay"


def region_base(region: str) -> Path:
    return ROOT / "docs" if region == "sf-corridor" else ROOT / "docs/regions" / region


def eligible(region: str, *, max_area: float = 240, homes: bool = False) -> list[dict]:
    """The region's houses as engine inputs, in a fixed order (SHA-256 of the OSM id)."""
    base = region_base(region)
    page = json.loads((base / "sf-corridor-3d.json").read_text())
    fits = json.loads((base / "sf-corridor-interiors.json").read_text())["buildings"]
    tags = HOME_TAGS if homes else HOUSE_TAGS
    rows = []
    for way in page["ways"]:
        if way.get("kind") != "building" or way.get("tags", {}).get("building") not in tags:
            continue
        if homes and (way.get("archetype") not in HOME_ARCHETYPES
                      or float(way.get("height_m", 3)) > HOME_MAX_HEIGHT_M):
            continue
        pts = way.get("points") or []
        if not pts:
            continue
        lon, lat = way.get("centroid", pts[0])
        p = Polygon([((x - lon) * 111320 * math.cos(math.radians(lat)), (y - lat) * 111320) for x, y in pts])
        if not p.is_valid or not 65 <= p.area <= max_area or way.get("shops"):
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
            "priority_area": (way.get("parcel") or {}).get("analysis_neighborhood"),
        })
    return sorted(rows, key=lambda r: hashlib.sha256(r["osm_id"].encode()).hexdigest())


def home_selection(region: str, out: Path, *, max_area: float = 240, marina_first: bool = False) -> list[dict]:
    """--homes: the region's homes less those the site furnishes, frozen on first use."""
    path = out / region / "selection.json"
    if path.exists():
        return json.loads(path.read_text())
    furnished = set(json.loads((PUBLISHED / "map-overlay.json").read_text())["buildings"])
    rows = [row for row in eligible(region, max_area=max_area, homes=True) if row["osm_id"] not in furnished]
    if marina_first:
        rows.sort(key=lambda r: r.get("priority_area") != "Marina")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, separators=(",", ":")))
    return rows


def batch_counts(regions: list[str]) -> dict[str, int]:
    """How many batches of BATCH houses each region's eligible houses make."""
    return {region: math.ceil(len(eligible(region)) / BATCH) for region in regions}


def free_bytes(out: Path) -> int:
    """The free space on the disk written to, and on the checkout's (where macOS swaps)."""
    return min(shutil.disk_usage(out).free, shutil.disk_usage(ROOT).free)


def run_batch(region: str, index: int, rows: list[dict], out: Path, key: str = "") -> str:
    folder = out / region / f"batch-{index:03d}{'-' + key if key else ''}"
    if (folder / "manifest.json").exists():
        return f"{region} {index}: done already"
    if free_bytes(out) < MIN_FREE_BYTES:
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


def tile_key(lon: float, lat: float) -> str:
    return f"{math.floor(lon / TILE_DEG)}_{math.floor(lat / TILE_DEG)}"


def _gzipped(value) -> bytes:
    return gzip.compress(json.dumps(value, separators=(",", ":")).encode(), mtime=0)


_store_lock = threading.Lock()


def publish_to_store(folder: Path, store, out: Path) -> int:
    """Put a finished batch's accepted houses into the public store, rewrite the overlay tiles
    that list them, and leave only the batch's manifest, overlay and log on disk. Returns how
    many went in. The run's own ledger of the store (``<out>/store-overlay.json``) is what the
    tiles are written from, so a tile always lists every house put in its square."""
    if (folder / "store.json").exists() or not (folder / "manifest.json").exists():
        return 0
    region = folder.parent.name
    refs = json.loads((folder / "map-overlay.json").read_text())["buildings"]
    put = {}
    for record in json.loads((folder / "manifest.json").read_text())["houses"]:
        osm_id = record["id"].removeprefix("osm-")
        source = folder / record.get("file", "")
        if not record.get("passed") or osm_id not in refs or not source.is_file():
            continue
        house = json.loads(source.read_text())
        # The page takes only an inferred hypothesis that passed its own validation.
        if not house.get("validation", {}).get("passed") or house.get("grade") != "inferred":
            continue
        key = f"{STORE_HOUSES}/{region}/osm-{osm_id}.json"
        store.put(key, _gzipped(house), content_type="application/json", content_encoding="gzip",
                  cache_control="public, max-age=3600")
        put[osm_id] = {"file": key, "origin_lon_lat": refs[osm_id]["origin_lon_lat"]}
    with _store_lock:
        ledger_path = out / "store-overlay.json"
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
        ledger.update(put)
        tiles: dict[str, dict] = {}
        for osm_id, ref in ledger.items():
            tiles.setdefault(tile_key(*ref["origin_lon_lat"]), {})[osm_id] = ref
        for key in sorted({tile_key(*ref["origin_lon_lat"]) for ref in put.values()}):
            store.put(f"{STORE_OVERLAY}/{key}.json", _gzipped(
                {"schema": "kerbside.inferred_house_overlay/1", "tile": key, "buildings": tiles[key]}),
                content_type="application/json", content_encoding="gzip", cache_control="public, max-age=300")
        if put:
            store.put(f"{STORE_OVERLAY}/index.json", _gzipped(
                {"schema": "kerbside.inferred_house_tiles/1", "tile_deg": TILE_DEG,
                 "tiles": {k: len(v) for k, v in sorted(tiles.items())}}),
                content_type="application/json", content_encoding="gzip", cache_control="public, max-age=300")
        ledger_path.write_text(json.dumps(ledger, separators=(",", ":")))
    (folder / "store.json").write_text(json.dumps({"houses": sorted(put)}))
    for path in folder.iterdir():
        if path.is_file() and path.name not in {"manifest.json", "map-overlay.json", "run.log", "store.json"}:
            path.unlink()
    return len(put)


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
    parser.add_argument("--max-area", type=float, default=240, help="single-family footprint area limit; validation still gates each house")
    parser.add_argument("--marina-first", action="store_true")
    parser.add_argument("--batch-index", type=int, help="one stable batch for the durable cloud/local queue")
    parser.add_argument("--batch-key", default="", help="SHA256 prefix of the expected batch inputs")
    parser.add_argument("--homes", action="store_true", help="every home-like footprint, not only house/detached")
    parser.add_argument("--store", help="the public store (s3://bucket) to put each batch's accepted houses in")
    parser.add_argument("--batch", help="REGION:INDEX -- run that one batch only (a cloud job)")
    parser.add_argument("--counts", action="store_true", help="print each region's batch count as JSON")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
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
    if args.homes:
        run_homes(args)
        return
    jobs = []
    for region in args.regions:
        rows = eligible(region, max_area=args.max_area)
        if args.marina_first:
            rows.sort(key=lambda r: r.get("priority_area") != "Marina")
        print(f"{region}: {len(rows)} eligible houses", flush=True)
        jobs += [(region, i // BATCH, rows[i:i + BATCH]) for i in range(0, len(rows), BATCH)]
    if args.count:
        return
    if args.batch_index is not None:
        jobs = [job for job in jobs if job[1] == args.batch_index]
        if args.batch_key and (len(jobs) != 1 or hashlib.sha256(
                json.dumps(jobs[0][2], sort_keys=True).encode()).hexdigest()[:16] != args.batch_key):
            parser.error("batch inputs changed; replan rather than running a stale job")
    if args.max_batches is not None:
        jobs = [job for job in jobs
                if not (args.out / job[0] / f"batch-{job[1]:03d}" / "manifest.json").exists()][:args.max_batches]
    print(f"{len(jobs)} batches, {args.workers} at a time", flush=True)
    with ThreadPoolExecutor(args.workers) as pool:
        for line in pool.map(lambda job: run_batch(*job, args.out, args.batch_key), jobs):
            print(line, flush=True)
    if args.batch_index is None:
        merge(args.out)
    elif not all((args.out / r / f"batch-{i:03d}{'-'+args.batch_key if args.batch_key else ''}/manifest.json").is_file()
                 for r, i, _ in jobs):
        raise SystemExit("batch incomplete; retain local files and retry")


def run_homes(args) -> None:
    """--homes: every region's batches taken in turn (one of each region, then the next of
    each), each put into the store as it finishes; a batch held for disk waits, not skips."""
    store = None
    if args.store:
        sys.path.insert(0, str(ROOT / "src"))
        from smc.cloud.store import open_store
        store = open_store(args.store, role="public")
    queues = {}
    for region in args.regions:
        rows = home_selection(region, args.out, max_area=args.max_area, marina_first=args.marina_first)
        queues[region] = [(region, i // BATCH, rows[i:i + BATCH]) for i in range(0, len(rows), BATCH)]
        print(f"{region}: {len(rows)} homes, {len(queues[region])} batches", flush=True)
    if args.count:
        return
    jobs = [queue[turn] for turn in range(max(map(len, queues.values()), default=0))
            for queue in queues.values() if turn < len(queue)]
    done = (lambda job: (args.out / job[0] / f"batch-{job[1]:03d}" / "store.json").exists()) if store \
        else (lambda job: (args.out / job[0] / f"batch-{job[1]:03d}" / "manifest.json").exists())
    jobs = [job for job in jobs if not done(job)]
    if args.max_batches is not None:
        jobs = jobs[:args.max_batches]
    print(f"{len(jobs)} batches, {args.workers} at a time", flush=True)

    def one(job):
        while free_bytes(args.out) < MIN_FREE_BYTES:
            time.sleep(60)
        line = run_batch(*job, args.out)
        if store is not None:
            folder = args.out / job[0] / f"batch-{job[1]:03d}"
            line += f"; {publish_to_store(folder, store, args.out)} into the store"
        return line

    with ThreadPoolExecutor(args.workers) as pool:
        for line in pool.map(one, jobs):
            print(time.strftime("%H:%M:%S"), line, flush=True)


if __name__ == "__main__":
    main()
