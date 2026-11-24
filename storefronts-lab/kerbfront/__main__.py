"""CLI: ``python -m kerbfront {sweep,photos,pixels,handoff}`` (run from storefronts-lab/)."""

from __future__ import annotations

import argparse
import json


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="kerbfront")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sweep", help="gather + merge business, building and face data")
    s.add_argument("--area", default="marina-union")
    p = sub.add_parser("photos", help="stage 1: geometric frame filter + shot lists")
    p.add_argument("--area", default="marina-union")
    p.add_argument("--corridor")
    p.add_argument("--source", choices=("live", "catalogue"), default="live")
    x = sub.add_parser("pixels", help="stage 2: thumbnail + segmentation checks, contact sheets")
    x.add_argument("--area", default="marina-union")
    x.add_argument("--corridor")
    x.add_argument("--limit", type=int, default=40)
    h = sub.add_parser("handoff", help="write smc.exteriors input programs for swept buildings")
    h.add_argument("--area", default="marina-union")
    h.add_argument("--corridor")
    a = ap.parse_args(argv)
    if a.cmd == "sweep":
        from .sweep import run
        res = run(a.area)
        res.pop("provenance", None)
    elif a.cmd == "photos":
        from .photos.run import run_geometry
        res = run_geometry(a.area, a.corridor, a.source)
    elif a.cmd == "pixels":
        from .photos.run import run_pixels
        res = run_pixels(a.area, a.corridor, a.limit)
    else:
        from .handoff import run
        res = run(a.area, a.corridor)
    print(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
