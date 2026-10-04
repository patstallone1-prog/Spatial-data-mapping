"""Assemble the landing page.

Its pictures are renders of the model itself -- the skyline, a street, the inside of a house --
kept as source in tools/landing/ and published beside the page by tools/build_pages.py, rather
than inlined: the page stays small and the pictures are cached like any other file.
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from site_config import APP_URL

ROOT = pathlib.Path(__file__).resolve().parents[1]
PICTURES = ROOT / "tools" / "landing"
NEEDED = ("hero.jpg", "streets.jpg", "inside.jpg", "ground.jpg", "bay.jpg", "pavement.jpg")

missing = [name for name in NEEDED if not (PICTURES / name).exists()]
if missing:
    sys.exit(f"tools/landing/ is missing {', '.join(missing)}")

template = (ROOT / "tools" / "landing_template.html").read_text()
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "build" / "landing.html")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(template)
print(f"landing page, {len(NEEDED)} pictures; app at {APP_URL}")
print(f"{out}: {out.stat().st_size / 1e6:.2f} MB")
