#!/usr/bin/env python3
"""Build a local storefront review bundle without publishing Kerbside or restarting a server."""

from __future__ import annotations

import argparse
import json
import runpy
from pathlib import Path

from smc.exteriors.bundle import build_bundle

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world", type=Path, help="canonical Kerbside JSON payload, read-only")
    parser.add_argument("--inputs", type=Path, help="explicit local-metre facade programs")
    parser.add_argument(
        "--stations", type=Path, help="explicit fuel/EV site programs in local metres"
    )
    parser.add_argument("--extra-inputs", type=Path, help="additional fixed chain facade programs")
    parser.add_argument("--fits", type=Path, help="optional geometry-bound reviewed facade fits")
    parser.add_argument(
        "--selected-ids", type=Path, help="fixed mapped cohort JSON with an ids list"
    )
    parser.add_argument(
        "--limit", type=int, default=20, help="fixed mapped cohort size, not success count"
    )
    parser.add_argument("--out", type=Path, default=ROOT / "build/storefront-exteriors")
    parser.add_argument(
        "--viewer-copy",
        action="store_true",
        help="instrument an isolated copy of the authoritative map viewer",
    )
    parser.add_argument(
        "--support-site", type=Path, help="read-only local support asset aliases for --viewer-copy"
    )
    args = parser.parse_args()
    if not args.world and not args.inputs and not args.stations:
        parser.error("supply --world, --inputs or --stations")
    if args.viewer_copy and not args.world:
        parser.error("--viewer-copy requires a canonical --world payload")
    if not 0 <= args.limit <= 5000:
        parser.error("limit must be 0-5000")
    if (ROOT / "docs").resolve() in args.out.resolve().parents or args.out.resolve() == (
        ROOT / "docs"
    ).resolve():
        parser.error("this review builder cannot write into the published docs tree")
    manifest = build_bundle(
        args.out,
        inputs=(json.loads(args.inputs.read_text()) if args.inputs else [])
        + (json.loads(args.extra_inputs.read_text()) if args.extra_inputs else []),
        station_inputs=json.loads(args.stations.read_text()) if args.stations else (),
        world=json.loads(args.world.read_text()) if args.world else None,
        fits=json.loads(args.fits.read_text()) if args.fits else None,
        limit=args.limit,
        viewer_html=runpy.run_path(str(ROOT / "scripts/build_sf_corridor_3d.py"))["HTML"]
        if args.viewer_copy
        else None,
        support_site=args.support_site,
        selected_ids=json.loads(args.selected_ids.read_text())["ids"]
        if args.selected_ids
        else None,
    )
    print(
        json.dumps(
            {
                "selected": len(manifest["selected"]),
                "passed": len(manifest["buildings"]),
                "rejected": manifest["rejected"],
                "output": str(args.out),
                "stations": manifest.get("station_summary"),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
