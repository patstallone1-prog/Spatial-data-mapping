#!/usr/bin/env python3
"""Judge what the page has inferred against the aerial photograph (smc.truth.imagery_truth).

    tools/build_imagery_truth.py CANDIDATES.json [--region sf-corridor] [--out docs/imagery-truth/marina.json]
                                 [--journal build/imagery-truth/marina.jsonl] [--tasks bus_zone,legend,...] [--limit N]

CANDIDATES.json is what tools/truth/export_candidates.mjs dumps from a running page. Every result
is appended to the journal and synced as it is made: stop it whenever, run it again, and it goes
on from where it was. The output file is written again from the journal after every task.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.ortho import Ortho  # noqa: E402
from smc.truth.imagery_truth import (  # noqa: E402
    Frame,
    Journal,
    Naip,
    assemble,
    cover_for_page,
    page_file,
    run,
    run_cover,
)

TASKS = ("bus_zone", "legend", "gutter", "ground", "courts")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("candidates", type=Path)
    ap.add_argument("--region", default="sf-corridor", help="the photograph's region under data/ortho")
    ap.add_argument("--name", default="marina")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--journal", type=Path)
    ap.add_argument("--tasks", default=",".join(TASKS))
    ap.add_argument("--ground", type=Path, help="the ground-cover file (docs/app-sf-corridor-ground.json): its rings are judged too")
    ap.add_argument("--lidar-cache", type=Path, help="where the point cloud's tiles are kept (e.g. the drive's lidar-cache-main): the lidar is a witness")
    ap.add_argument("--street", type=Path, help="a segmentation_cache JSONL of street photographs' labels: the street is a witness")
    ap.add_argument("--no-naip", action="store_true", help="do not ask USGS for the second photograph")
    ap.add_argument("--page", type=Path, help="also write the slim file the page reads (docs/imagery-truth.json)")
    ap.add_argument("--limit", type=int, help="at most this many new results a task (a trial run)")
    args = ap.parse_args()
    out = args.out or ROOT / "docs" / "imagery-truth" / f"{args.name}.json"
    journal = Journal(args.journal or ROOT / "build" / "imagery-truth" / f"{args.name}.jsonl")
    candidates = json.loads(args.candidates.read_text())
    frame = Frame.fit(candidates["frame"])
    print(f"frame fitted to {len(candidates['frame'])} buildings: within {frame.residual_m * 100:.1f} cm; "
          f"{len(journal.rows)} results already in {journal.path}")
    ortho = Ortho(args.region)

    cover = {"rows": []}

    def write():
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp")
        tmp.write_text(json.dumps(assemble(journal, args.name, frame.residual_m), separators=(",", ":")))
        tmp.replace(out)
        if args.page:
            f = candidates["frame"][0]
            page = page_file(journal, args.name, frame, (f[0], f[1]))
            page["ground"] = cover_for_page(cover["rows"])
            tally: dict = {}
            for r in cover["rows"]:
                k = f"{r['list']}:{r['verdict']}:{r.get('sure')}"
                tally[k] = tally.get(k, 0) + 1
            page["counts"]["cover"] = tally
            args.page.write_text(json.dumps(page, separators=(",", ":")))

    wanted = [t for t in args.tasks.split(",") if t]
    # (The ground and its courts are one pass over the same patches.)
    both = tuple(t for t in wanted if t in ("ground", "courts"))
    for group in [(t,) for t in wanted if t not in both] + ([both] if both else []):
        run(candidates, ortho, journal, tasks=group, limit=args.limit)
        write()
    if args.ground:
        naip = None if args.no_naip else Naip(journal.path.parent / "naip")
        lidar = street = None
        f = [row[:2] for row in candidates["frame"]]
        box = (min(p[0] for p in f), min(p[1] for p in f), max(p[0] for p in f), max(p[1] for p in f))
        if args.lidar_cache:
            from smc.truth.sources import LidarGround

            lidar = LidarGround(frame, journal.path.parent / "lidar", args.lidar_cache)
        if args.street and args.street.exists():
            from smc.truth.sources import StreetViews

            street = StreetViews.load(args.street, frame, box)
            print(f"street: {len(street.views)} photographs' labels in the area")
        cover["rows"] = run_cover(json.loads(args.ground.read_text()), candidates, ortho, journal, naip, limit=args.limit, lidar=lidar, street=street)
        write()
    journal.close()
    doc = json.loads(out.read_text())
    for k in ("bus_zones", "legends", "ground", "courts", "gutters"):
        tally: dict = {}
        for r in doc[k]:
            v = r.get("verdict") or r.get("kind")
            tally[v] = tally.get(v, 0) + 1
        print(f"{k}: {len(doc[k])} {tally}")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
