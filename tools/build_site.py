"""Inline the map dataset into the site template."""
from __future__ import annotations

import pathlib
import sys

data = pathlib.Path("build/map_data.json").read_text()
template = pathlib.Path("tools/site_template.html").read_text()
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "build/kerbside.html")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(template.replace("__MAP_DATA__", data))
print(f"{out} -> {out.stat().st_size / 1e6:.2f} MB")
