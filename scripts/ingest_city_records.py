#!/usr/bin/env python3
"""Pull a region's city-published records and write them beside its other official geometry.

    python scripts/ingest_city_records.py oakland-downtown palo-alto-downtown

What each city publishes, and how it has to be asked, is in smc.official.city_records; reading
it is smc.official.city_fetch. This script is the part that decides where the answer goes and
what is recorded about it.

Every record lands in data/regions/<name>/official/city_<key>.json as GeoJSON features with a
provenance block naming the city, the layer, the endpoint and the day it was read. A record
that will not answer is written as a gap with its reason rather than left as a missing file,
so that "we have no kerb line for Berkeley" and "nobody has asked Berkeley for a kerb line"
stay different states.

Nothing here feeds the renderer's kerbs. Every kerb is drawn the way an unmeasured one is
(KERB_RENDER_UNIFORM); these are the evidence behind that, kept so the override can be lifted
without fetching the city again.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.imagery.region import get_region  # noqa: E402
from smc.official.city_fetch import fetch  # noqa: E402
from smc.official.city_records import CITY_RECORDS  # noqa: E402
from smc.regions.paths import region_city, region_paths  # noqa: E402


def ingest(name: str, *, quiet: bool = False) -> dict:
    region = get_region(name)
    city = str(region_city(name) or "")
    paths = region_paths(name)
    official = paths.official
    official.mkdir(parents=True, exist_ok=True)
    bbox = {"south": region.bbox.south, "west": region.bbox.west,
            "north": region.bbox.north, "east": region.bbox.east}

    def say(message: str) -> None:
        if not quiet:
            print(f"  {message}", flush=True)

    records = CITY_RECORDS.get(city) or []
    if not records:
        say(f"{city or name}: no city records are known; see smc.official.city_records")
        return {"region": name, "city": city, "records": {}}

    summary: dict[str, dict] = {}
    for record in records:
        answer = fetch(record, bbox, say)
        out = official / f"city_{record.key}.json"
        payload = {
            "provenance": {
                "city": city,
                "layer": record.title,
                "api": record.api,
                "endpoint": record.locator,
                "host": record.host or None,
                "read_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "bbox": bbox,
                "note": record.note or None,
            },
            "refused": answer.refused or None,
            "features": answer.features,
        }
        out.write_text(json.dumps(payload, separators=(",", ":")))
        summary[record.key] = {
            "features": len(answer.features),
            "refused": answer.refused or None,
            "file": str(out.relative_to(ROOT)),
        }
        say(f"{record.key}: {len(answer.features)} features -> {out.relative_to(ROOT)}"
            if not answer.refused else f"{record.key}: refused ({answer.refused[:60]})")
    (official / "city_records.json").write_text(json.dumps(
        {"region": name, "city": city, "records": summary}, indent=1) + "\n")
    return {"region": name, "city": city, "records": summary}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("region", nargs="+")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    for name in args.region:
        print(f"{name}:", flush=True)
        result = ingest(name, quiet=args.quiet)
        got = sum(1 for r in result["records"].values() if not r["refused"])
        print(f"  {got} of {len(result['records'])} records read", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
