#!/usr/bin/env python3
"""Check access to the Waymo Open Dataset and list its San Francisco segments.

Waymo's lidar is the right sensor for kerbs -- ground-level, five heads, per-point road and
sidewalk labels -- and the aerial pass in scripts/measure_curbs_lidar.py exists partly because
this one is gated. The gate is not technical. Reading the dataset requires that a person has
registered and accepted a licence under their own Google account, and neither registering nor
accepting can be done on their behalf.

So this reports precisely which step is outstanding. It does not decode anything yet: writing a
decoder against a bucket that cannot be reached produces untested code that looks finished, and
the failure would surface much later and much less clearly than this does.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.lidar.waymo import (  # noqa: E402
    DEFAULT_BUCKET,
    SF_LOCATION,
    LICENCE_URL,
    WaymoAccessError,
    check_access,
    sf_segment_paths,
    sf_segments,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--split", default="training")
    parser.add_argument("--out", type=Path, default=Path("data/waymo_sf/segments.txt"))
    args = parser.parse_args()

    report = check_access(args.bucket)
    print(f"account:   {report.account or '(none signed in)'}")
    print(f"bucket:    gs://{args.bucket}/")
    print(f"reachable: {report.reachable}\n")

    if not report.reachable:
        print(report.detail)
        print(
            "\nThe licence is non-commercial and the restriction is inherited by anything\n"
            f"derived from the data, including a trained model. Terms: {LICENCE_URL}"
        )
        return 1

    try:
        paths = sf_segment_paths(args.bucket, args.split)
        # The whole split is filtered on the cheap stats component before any lidar is touched.
        segments = sf_segments(args.bucket, args.split)
    except WaymoAccessError as exc:
        print(exc)
        return 1
    print(f"{len(segments)} segments recorded as {SF_LOCATION}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(paths) + "\n")
    print(f"{len(paths)} segment files in the {args.split} split -> {args.out}")
    print(
        "\nNext: read the stats component to keep only segments driven in San Francisco,\n"
        "then the lidar and camera components for those. Not yet written -- see docs/17."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
