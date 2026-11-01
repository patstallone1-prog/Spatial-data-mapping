#!/usr/bin/env python3
"""A region's published storm and sewer network, for drainage modelling (smc.infrastructure.drainage
says what each city publishes and what is missing).

Writes ``data/regions/<region>/drainage.json`` (``kerbside.drainage/1``: nodes and links in
metres, with each source and each gap) and, where any of it can be routed, ``drainage.inp``, an
EPA SWMM 5 input file of the links with both inverts and a diameter. Nothing is published to the
site: this is the adapter a drainage model is built on.

    .venv/bin/python scripts/ingest_drainage.py san-jose-downtown
    .venv/bin/python scripts/ingest_drainage.py sf-mission --print
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.infrastructure.drainage import build_network, to_swmm  # noqa: E402
from smc.net import use_certifi  # noqa: E402


def region_bbox(region: str) -> dict:
    """The region's box, from the site's region index (south, west, north, east there)."""
    regions = json.loads((ROOT / "docs/app-regions.json").read_text())
    regions = regions["regions"] if isinstance(regions, dict) else regions
    for r in regions:
        if r["name"] == region:
            s, w, n, e = r["bbox"]
            return {"west": w, "south": s, "east": e, "north": n}
    raise SystemExit(f"{region}: not in docs/app-regions.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("region")
    parser.add_argument("--out", type=Path, help="default data/regions/<region>")
    parser.add_argument("--print", action="store_true", help="the summary only; write nothing")
    args = parser.parse_args()
    use_certifi()
    network = build_network(args.region, region_bbox(args.region), progress=lambda m: print(m, file=sys.stderr))
    summary = {k: network[k] for k in ("region", "counts", "topology", "gaps")}
    summary["sources"] = [{k: s[k] for k in ("city", "title", "features") if k in s}
                          | ({"refused": s["refused"]} if "refused" in s else {}) for s in network["sources"]]
    if not args.print:
        out = args.out or ROOT / "data/regions" / args.region
        out.mkdir(parents=True, exist_ok=True)
        (out / "drainage.json").write_text(json.dumps(network, separators=(",", ":")) + "\n")
        if network["counts"]["routable_links"]:
            (out / "drainage.inp").write_text(to_swmm(network))
        summary["written"] = str(out.relative_to(ROOT) if out.is_relative_to(ROOT) else out)
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
