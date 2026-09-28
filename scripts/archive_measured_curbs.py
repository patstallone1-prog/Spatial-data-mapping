#!/usr/bin/env python3
"""Preserve the per-way curb heights carried by the published SF payload.

The renderer deliberately draws a uniform, plausible curb while disputed lidar heights are
reviewed.  This archive is the reversible boundary between those visual defaults and the
measured records; it does not promote any sample to validated ground truth.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "sf-corridor-3d.json"
OUTPUT = ROOT / "data" / "curb_measurement" / "sf_per_way_heights_archive.json"


def build_archive(source: Path = SOURCE) -> dict:
    raw = source.read_bytes()
    payload = json.loads(raw)
    rows = []
    for way in payload.get("ways", []):
        if way.get("kerb_m") is None:
            continue
        rows.append({key: way[key] for key in
                     ("kind", "osm_id", "name", "kerb_m", "kerb_n", "kerb_sigma_m", "kerb_source")
                     if key in way})
    rows.sort(key=lambda row: (str(row.get("osm_id", "")), str(row.get("name", "")), row["kerb_m"]))
    return {
        "schema_version": 1,
        "source": "docs/sf-corridor-3d.json",
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "render_policy": "uniform curb height; measurements retained but not drawn as height",
        "measurement_status": "unreviewed; do not treat all samples as accurate",
        "count": len(rows),
        "ways": rows,
    }


def main() -> None:
    archive = build_archive()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(archive, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"Archived {archive['count']} per-way curb heights in {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
