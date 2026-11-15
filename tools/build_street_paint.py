"""Write the page's street paint facts from the city's stop-sign record.

    .venv/bin/python tools/build_street_paint.py            # from the saved rows
    .venv/bin/python tools/build_street_paint.py --refresh  # fetch the rows again first

Reads SFMTA's stop signs (DataSF 4542-gpa3, public domain; saved as
data/sf_public_works/stop_signs.json), cleans them (smc.paint.clean) and writes
docs/street-paint.json, which the page reads beside OpenStreetMap's streets
(docs/street-paint.mjs says how each fact is matched to a drawn approach).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.paint.clean import clean_stop_signs, paint_document  # noqa: E402

SOURCE = "https://data.sfgov.org/resource/4542-gpa3.json"
ROWS = ROOT / "data/sf_public_works/stop_signs.json"
OUT = ROOT / "docs/street-paint.json"
FIELDS = ("objectid", "street", "x_street", "st_facing", "direction", "cnn", "shape", "data_as_of")
USER_AGENT = "Kerbside street paint ingest"
PAGE = 20000


def fetch_rows() -> list[dict]:
    rows: list[dict] = []
    while True:
        query = urllib.parse.urlencode({"$select": ",".join(FIELDS), "$limit": PAGE, "$offset": len(rows),
                                        "$order": "objectid"})
        request = urllib.request.Request(f"{SOURCE}?{query}", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=120) as response:
            page = json.loads(response.read())
        rows += page
        if len(page) < PAGE:
            return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="fetch the city's rows again")
    args = parser.parse_args()
    if args.refresh or not ROWS.exists():
        rows = fetch_rows()
        ROWS.write_text(json.dumps(rows, separators=(",", ":")) + "\n")
    rows = json.loads(ROWS.read_text())
    stops, dropped = clean_stop_signs(rows)
    as_of = max((str(row.get("data_as_of") or "")[:10] for row in rows), default="") or None
    OUT.write_text(json.dumps(paint_document(stops, dropped, as_of), separators=(",", ":")) + "\n")
    print(f"{len(stops)} stop approaches from {len(rows)} rows; dropped {dropped or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
