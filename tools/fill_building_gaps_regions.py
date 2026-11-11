#!/usr/bin/env python3
"""The missing-buildings fill (smc.regions.building_gaps) run over every mapped region.

The Marina's fill (tools/fill_building_gaps.py, 2026-11-10) added the buildings OpenStreetMap
lacks there from DataSF's footprints. This runs the same fill over the whole map: the corridor
and every region in docs/app-regions.json -- DataSF's footprints where the region is in San
Francisco, and Overture's traced footprints (Microsoft, Esri) everywhere.

Regions are served from the public bucket through docs/asset-map.json, so each region's payload
is read from its chunk, filled, written back as a new chunk and pointed at in the map. The copies
docs/ itself carries (the corridor, the regions in git) are filled in place too.

    set -a; source cloud/config/controller.env; set +a     # the public bucket's key
    PYTHONPATH=src .venv/bin/python tools/fill_building_gaps_regions.py \\
        --overture /path/overture-buildings-non-osm.parquet --work /path/work [--only NAME] [--dry-run]

The Overture extract is the buildings theme cut to the regions' boxes, OSM's own rows left out
(see ``--pull``). Idempotent: a building already added is not added again, and a region whose
payload gains nothing is not re-uploaded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
sys.path.insert(0, str(ROOT / "src"))

from smc.regions.building_gaps import (  # noqa: E402
    fetch_footprints,
    fill_building_gaps,
    median_height,
    overture_rows,
)

MAP = DOCS / "asset-map.json"
REGIONS = DOCS / "app-regions.json"
#: San Francisco's box (south, west, north, east): DataSF's footprints cover the city.
SF_BOX = (37.7081, -122.5150, 37.8324, -122.3570)
SITE_ORIGIN = "https://spatial-data-mapping.vercel.app"


def pull_overture(out: Path, boxes: list[list[float]]) -> None:
    """The buildings theme's non-OSM rows over ``boxes`` ([s, w, n, e]) into one parquet file."""
    from smc.regions.overture_osm import BASE, RELEASE, connect

    pad = 0.002
    cond = " OR ".join(f"(bbox.xmin <= {e + pad} AND bbox.xmax >= {w - pad} AND bbox.ymin <= {n + pad} AND bbox.ymax >= {s - pad})"
                       for s, w, n, e in boxes)
    S, W = min(b[0] for b in boxes), min(b[1] for b in boxes)
    N, E = max(b[2] for b in boxes), max(b[3] for b in boxes)
    con = connect()
    con.execute(f"SET temp_directory='{out.parent}'; SET enable_progress_bar=false;")
    con.execute(f"""COPY (SELECT id, height, num_floors, sources[1].dataset AS dataset, bbox, ST_AsGeoJSON(geometry) AS shape
      FROM read_parquet('{BASE}/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
      WHERE bbox.xmin <= {E} AND bbox.xmax >= {W} AND bbox.ymin <= {N} AND bbox.ymax >= {S}
        AND sources[1].dataset <> 'OpenStreetMap' AND ({cond})) TO '{out}' (FORMAT parquet)""")


def overture_in(con, parquet: Path, bbox: list[float]) -> list[tuple]:
    s, w, n, e = bbox
    return con.execute(f"SELECT id, height, num_floors, dataset, shape FROM '{parquet}' "
                       f"WHERE bbox.xmin <= {e} AND bbox.xmax >= {w} AND bbox.ymin <= {n} AND bbox.ymax >= {s}").fetchall()


def sf_part(bbox: list[float]) -> tuple[float, float, float, float] | None:
    s, w, n, e = bbox
    S, W, N, E = SF_BOX
    box = (max(s, S), max(w, W), min(n, N), min(e, E))
    return box if box[0] < box[2] and box[1] < box[3] else None


def fill(payload: dict, bbox: list[float], *, con, parquet: Path, cache: Path) -> dict[str, int]:
    ways = payload["ways"]
    added = {"datasf": 0, "overture": 0}
    part = sf_part(bbox)
    if part:
        added["datasf"] = fill_building_gaps(ways, fetch_footprints(part, cache))
    rows = overture_rows(overture_in(con, parquet, bbox), fallback_m=median_height(ways))
    added["overture"] = fill_building_gaps(ways, rows)
    if sum(added.values()):
        osm = payload.setdefault("summary", {}).setdefault("osm", {})
        osm["datasf_gap_buildings"] = osm.get("datasf_gap_buildings", 0) + added["datasf"]
        osm["overture_gap_buildings"] = osm.get("overture_gap_buildings", 0) + added["overture"]
    return added


def dump(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")


def fetch(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"Origin": SITE_ORIGIN, "User-Agent": "smc-building-gaps/1"})
    with urllib.request.urlopen(req, timeout=300) as r:
        dest.write_bytes(r.read())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--overture", type=Path, required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--pull", action="store_true", help="first cut the Overture extract")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    regions = [r for r in json.loads(REGIONS.read_text())["regions"] if r.get("bbox")]
    if args.only:
        regions = [r for r in regions if r["name"] in args.only]
    if args.pull or not args.overture.exists():
        pull_overture(args.overture, [r["bbox"] for r in regions])
    import duckdb

    con = duckdb.connect()
    record = json.loads(MAP.read_text())
    files, base = record["files"], record["origin"]
    store = None
    if not args.dry_run:
        from smc.cloud.store import open_store

        store = open_store(os.environ["KERBSIDE_PUBLIC_STORE"], role="public")
    log = args.work / "fill-log.jsonl"
    done = {json.loads(line)["region"] for line in log.read_text().splitlines()} if log.exists() else set()
    report = []
    for r in regions:
        name = r["name"]
        if name in done:
            continue
        cache = args.work / f"datasf-{name}.json"
        local = [p for p in ((DOCS / "sf-corridor-3d.json") if name == "sf-corridor" else None,
                             DOCS / "regions" / name / "sf-corridor-3d.json", DOCS / "app-regions" / name / "sf-corridor-3d.json")
                 if p is not None and p.exists() and p.stat().st_size > 1000]
        key = f"regions/{name}/sf-corridor-3d.json"
        row = {"region": name}
        # The bucket's copy is what the site serves; the local ones are filled from themselves.
        if key in files:
            src = args.work / f"{name}.json"
            if not src.exists():
                fetch(f"{base}/{files[key]}", src)
            payload = json.loads(src.read_text(encoding="utf-8"))
            row.update(fill(payload, r["bbox"], con=con, parquet=args.overture, cache=cache))
            if row["datasf"] + row["overture"] and not args.dry_run:
                data = dump(payload)
                chunk = f"chunks/{hashlib.sha256(data).hexdigest()[:24]}.json"
                out = args.work / chunk.replace("/", "_")
                out.write_bytes(data)
                store.put_file(chunk, out, cache_control="public, max-age=31536000, immutable", content_type="application/json")
                files[key] = chunk
                row["chunk"] = chunk
                out.unlink()
            src.unlink()
        for path in local:
            payload = json.loads(path.read_text(encoding="utf-8"))
            got = fill(payload, r["bbox"], con=con, parquet=args.overture, cache=cache)
            row[f"local:{path.relative_to(DOCS)}"] = got
            if sum(got.values()) and not args.dry_run:
                path.write_bytes(dump(payload))
        print(json.dumps(row), flush=True)
        report.append(row)
        if not args.dry_run:
            with log.open("a") as f:
                f.write(json.dumps(row) + "\n")
            # The map after every region, so a stop half way leaves it pointing at what is there.
            record["version"] = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()[:16]
            MAP.write_text(json.dumps(record, indent=1) + "\n")
    total = {k: sum(x.get(k, 0) for x in report) for k in ("datasf", "overture")}
    print(f"{len(report)} regions: {total['datasf']} DataSF and {total['overture']} Overture buildings added to the served payloads")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
