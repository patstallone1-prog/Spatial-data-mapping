#!/usr/bin/env python3
"""Pull UrbanLoco frames from the blocks where kerbs are measured but photographs are thin.

The corridor has 497 cells with a measured kerb. Ninety-one of them hold fewer than twenty-five
photographs and twenty-eight hold none at all: places the lidar could see from above but no
camera has stood in. Those are worth a targeted pass, and the rest are not -- the median measured
cell already has ninety-three photographs, and adding a ninety-fourth changes nothing.

UrbanLoco suits this better than another crowdsourced source would. Its ground truth is a NovAtel
SPAN-CPT: RTK-corrected GNSS fused with an IMU, quoted at about five centimetres. Every other
provider in this catalogue reports a consumer GPS fix, or an SfM position derived from one.

Nothing is downloaded. The bag is read where it sits over HTTP range requests, and only the
chunks that carry the wanted topics are fetched -- see :mod:`smc.imagery.rosbag`.
"""

from __future__ import annotations

import argparse
import bisect
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import h3  # noqa: E402

from smc.imagery.base import License  # noqa: E402
from smc.imagery.catalog import write_coverage, write_json, write_observations, write_sequences  # noqa: E402
from smc.imagery.coverage import assign_cells, build_coverage_rows  # noqa: E402
from smc.imagery.filtering import INGEST_MIN_MEGAPIXELS, exact_dedupe, mark_eligibility  # noqa: E402
from smc.imagery.region import get_region  # noqa: E402
from smc.imagery.rosbag import RemoteBag, decode_compressed_image, decode_navsatfix  # noqa: E402
from smc.imagery.schema import (  # noqa: E402
    AVAILABLE,
    PROJECTION_PERSPECTIVE,
    Observation,
    SequenceRecord,
    observation_uid,
    sequence_uid,
)

INSTANCE = "urbanloco.berkeley"

#: UrbanLoco is published for research without a stated licence; the authors ask to be contacted
#: for commercial use. Recorded as unstated rather than guessed at, so a consumer can see that
#: the question was left open rather than answered.
LICENSE = License(
    identifier="unstated-research-use",
    url="https://github.com/weisongwen/UrbanLoco",
    attribution="© UrbanLoco, UC Berkeley MSC Lab and HK PolyU IPNL",
    share_alike=False,
)

#: The six cameras, and the position topic. BESTPOS carries the RTK solution but in a NovAtel
#: message this reader does not decode; NavSatFix is the same trajectory in a standard type.
CAMERA_SUFFIX = "/image_raw/compressed"
POSITION_TOPIC = "/navsat/fix"

IMAGE_WIDTH, IMAGE_HEIGHT = 2048, 1536


def nearest_fix(times: list[float], fixes: list[dict], when: float) -> dict | None:
    """The position closest in time to a frame, if one is close enough to mean anything."""
    if not times:
        return None
    index = bisect.bisect_left(times, when)
    best = None
    for candidate in (index - 1, index):
        if 0 <= candidate < len(times):
            gap = abs(times[candidate] - when)
            if best is None or gap < best[0]:
                best = (gap, fixes[candidate])
    # A second of vehicle motion is metres of position error. Beyond that the frame is better
    # left unplaced than placed wrongly.
    return best[1] if best and best[0] <= 1.0 else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bag", required=True, help="share URL of one UrbanLoco .bag")
    ap.add_argument("--sequence", required=True, help="name to record it under")
    ap.add_argument("--thin-cells", type=Path, default=ROOT / "build" / "thin_cells.json")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "sf_corridor_urbanloco")
    ap.add_argument("--region", default="sf-corridor")
    ap.add_argument("--h3-resolution", type=int, default=10)
    ap.add_argument("--budget-mb", type=float, default=2500.0,
                    help="stop after pulling this much of the bag")
    ap.add_argument("--everywhere", action="store_true",
                    help="keep frames anywhere in the region, not only in thin cells")
    args = ap.parse_args()

    region = get_region(args.region)
    thin = {row["cell"] for row in json.loads(args.thin_cells.read_text())} if args.thin_cells.exists() else set()
    print(f"{len(thin)} thin cells to fill", flush=True)

    bag = RemoteBag(args.bag)
    cameras = {
        c.conn_id: c.topic.split("/")[-3]
        for c in bag.connections.values()
        if c.topic.endswith(CAMERA_SUFFIX)
    }
    position = next((c.conn_id for c in bag.connections.values() if c.topic == POSITION_TOPIC), None)
    if position is None:
        sys.exit("bag has no /navsat/fix topic")
    wanted = set(cameras) | {position}
    print(f"{len(cameras)} cameras, {len(bag.chunks)} chunks, {bag.reader.size/1e9:.1f} GB", flush=True)

    times: list[float] = []
    fixes: list[dict] = []
    pending: list[tuple[float, int, str]] = []   # frames seen before their fix arrived
    observations: list[Observation] = []
    seen: set[str] = set()
    now = datetime.now(UTC)

    def place(when: float, conn_id: int, frame_key: str) -> bool:
        fix = nearest_fix(times, fixes, when)
        if fix is None:
            return False
        lat, lon = fix["lat"], fix["lon"]
        if not region.bbox.contains(lat, lon):
            return True
        cell = h3.latlng_to_cell(lat, lon, args.h3_resolution)
        if not args.everywhere and thin and cell not in thin:
            return True
        image_id = f"{args.sequence}/{cameras[conn_id]}/{frame_key}"
        if image_id in seen:
            return True
        seen.add(image_id)
        observations.append(
            Observation(
                observation_uid=observation_uid("urbanloco", INSTANCE, image_id),
                provider="urbanloco",
                provider_instance=INSTANCE,
                provider_image_id=image_id,
                provider_sequence_id=args.sequence,
                sequence_uid=sequence_uid("urbanloco", INSTANCE, args.sequence),
                provider_sequence_index=len(observations),
                captured_at=datetime.fromtimestamp(when, tz=UTC),
                latitude=lat,
                longitude=lon,
                altitude=fix.get("alt"),
                # RTK-corrected GNSS fused with an IMU. Quoted at about five centimetres, which
                # is one to two orders better than every other provider here.
                gps_accuracy_m=0.05,
                original_width=IMAGE_WIDTH,
                original_height=IMAGE_HEIGHT,
                original_megapixels=IMAGE_WIDTH * IMAGE_HEIGHT / 1e6,
                projection_type=PROJECTION_PERSPECTIVE,
                camera_model=cameras[conn_id],
                license_id=LICENSE.identifier,
                license_url=LICENSE.url,
                attribution=LICENSE.attribution,
                availability_status=AVAILABLE,
                provider_metadata_version="urbanloco:navsatfix+span-cpt",
                first_seen_at=now,
                last_seen_at=now,
            )
        )
        return True

    budget = args.budget_mb * 1e6
    for index, chunk in enumerate(bag.chunks, start=1):
        if not chunk.carries(wanted):
            continue
        if bag.bytes_read > budget:
            print(f"  byte budget reached at chunk {index}", flush=True)
            break
        try:
            for conn_id, stamp, payload in bag.messages(chunk, wanted):
                if conn_id == position:
                    fix = decode_navsatfix(payload)
                    if fix:
                        times.append(fix["t"])
                        fixes.append(fix)
                else:
                    frame = decode_compressed_image(payload)
                    if frame:
                        pending.append((frame["t"], conn_id, f"{stamp}"))
        except Exception as exc:  # noqa: BLE001 - one unreadable chunk must not end the pass
            print(f"  chunk {index}: {type(exc).__name__}", flush=True)
            continue
        # Frames are matched once their surrounding fixes exist, so a frame that arrived just
        # before its position is not silently dropped.
        still: list[tuple[float, int, str]] = []
        for when, conn_id, key in pending:
            if not place(when, conn_id, key):
                still.append((when, conn_id, key))
        pending = still
        if index % 200 == 0:
            print(f"  chunk {index}/{len(bag.chunks)}: {len(fixes)} fixes, "
                  f"{len(observations)} kept, {bag.bytes_read/1e6:.0f} MB", flush=True)

    for when, conn_id, key in pending:
        place(when, conn_id, key)

    for observation in observations:
        mark_eligibility(observation, region, min_megapixels=INGEST_MIN_MEGAPIXELS)
    observations = exact_dedupe(observations)
    assign_cells(observations, resolution=args.h3_resolution)
    coverage_rows = build_coverage_rows(observations)

    record = SequenceRecord(
        sequence_uid=sequence_uid("urbanloco", INSTANCE, args.sequence),
        provider="urbanloco",
        provider_instance=INSTANCE,
        provider_sequence_id=args.sequence,
        observation_count=len(observations),
        projection_type=PROJECTION_PERSPECTIVE,
        license_id=LICENSE.identifier,
        license_url=LICENSE.url,
        attribution=LICENSE.attribution,
        first_seen_at=now,
        last_seen_at=now,
    )
    out = args.out
    write_observations(out / "observations" / "external-000.parquet", observations)
    write_sequences(out / "sequences" / "external.parquet", [record])
    write_coverage(out / "coverage" / "h3.parquet", coverage_rows)
    write_json(out / "licenses" / "sources.json", {"sources": [[
        "urbanloco", INSTANCE, LICENSE.identifier, LICENSE.url, LICENSE.attribution]]})
    filled = {o.coverage_cell for o in observations if o.eligible}
    write_json(out / "stats" / "summary.json", {
        "generated_at": now.isoformat(),
        "sequence": args.sequence,
        "observations": len(observations),
        "eligible_observations": sum(1 for o in observations if o.eligible),
        "coverage_cells": len(coverage_rows),
        "thin_cells_targeted": len(thin),
        "thin_cells_reached": len(filled & thin),
        "bag_bytes_read": bag.bytes_read,
    })
    print(f"{len(observations)} observations, {len(filled & thin)} thin cells reached, "
          f"{bag.bytes_read/1e6:.0f} MB pulled -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
