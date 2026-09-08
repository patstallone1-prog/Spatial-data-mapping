#!/usr/bin/env python3
"""What the two long enrichment runs have finished, without touching either of them.

Both of these runs are hours long and neither writes anything committable until it ends. The
semantic pass journals its work as part files and merges them at the finish; the lidar pass
writes its parquet in one go at line 190 and nothing at all before that. So between starting
one and it landing there is nothing in the tree to say how far it got, which is a poor way to
leave a repository if the machine goes down.

This reads what is on disk and writes a snapshot beside it. Everything here is read-only with
respect to the running jobs:

  * the part files are opened and never removed. The real run deletes a part it cannot read,
    because for it a damaged part is a checkpoint to redo; here a part without a footer is one
    being written right now, and deleting it would throw away work in progress.
  * the lidar progress comes from its log rather than from its data, because it has no data
    until it is done.

Run it as often as you like. It changes nothing either job depends on.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
ENRICH = ROOT / "data" / "observation_enrichment"
PARTS = ENRICH / "semantics-parts"
LIDAR_LOG = ROOT / "build" / "lidar-depth.log"

#: The fractions the semantic pass records per frame, in the order its schema lists them.
TRACKED = ("sidewalk", "road", "facade", "occlusion", "kerb_value")


def median(values: list[float]) -> float | None:
    ordered = sorted(v for v in values if v is not None)
    return round(ordered[len(ordered) // 2], 4) if ordered else None


def semantics() -> dict:
    if not PARTS.exists():
        return {"parts": 0, "frames_segmented": 0}
    columns: dict[str, list[float]] = {name: [] for name in TRACKED}
    parts = sorted(PARTS.glob("*.parquet"))
    read = frames = unreadable = 0
    for part in parts:
        try:
            table = pq.read_table(part, columns=list(TRACKED))
        except Exception:
            # Being written as we look at it. Left exactly where it is.
            unreadable += 1
            continue
        read += 1
        frames += table.num_rows
        for name in TRACKED:
            columns[name].extend(table.column(name).to_pylist())
    occlusion = [v for v in columns["occlusion"] if v is not None]
    sidewalk = [v for v in columns["sidewalk"] if v is not None]
    return {
        "parts": len(parts),
        "parts_readable": read,
        "parts_mid_write": unreadable,
        "frames_segmented": frames,
        "median": {name: median(columns[name]) for name in TRACKED},
        "heavily_occluded_share": (round(sum(1 for v in occlusion if v > 0.25) / len(occlusion), 3)
                                   if occlusion else None),
        "no_sidewalk_visible_share": (round(sum(1 for v in sidewalk if v < 0.01) / len(sidewalk), 3)
                                      if sidewalk else None),
    }


def lidar() -> dict:
    """Sweeps done, from the log. There is no partial parquet to read: the run writes once."""
    if not LIDAR_LOG.exists():
        return {"sweeps_done": 0}
    text = LIDAR_LOG.read_text(errors="replace")
    done = re.findall(r"^\s*(\d+)/(\d+) sweeps, (\d+) frames", text, re.M)
    gave_up = re.findall(r"^\s*gave up on (\S+):", text, re.M)
    if not done:
        return {"sweeps_done": 0, "sweeps_abandoned": len(gave_up)}
    sweeps, total, frames = done[-1]
    return {
        "sweeps_done": int(sweeps),
        "sweeps_total": int(total),
        "frames_with_depth": int(frames),
        # Every one of these so far has been the network rather than the archive.
        "sweeps_abandoned": len(gave_up),
        "checkpointed": False,
        "note": "the lidar pass writes lidar_depth-000.parquet once, at the end; "
                "an interrupted run leaves no partial data behind",
    }


def main() -> int:
    ENRICH.mkdir(parents=True, exist_ok=True)
    for name, payload in (("semantics_progress.json", semantics()),
                          ("lidar_progress.json", lidar())):
        (ENRICH / name).write_text(json.dumps(payload, indent=1) + "\n")
        print(f"{name}: {json.dumps(payload)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
