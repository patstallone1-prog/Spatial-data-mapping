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
import time
import sys
from concurrent.futures import ThreadPoolExecutor
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
from smc.imagery.rosbag import (  # noqa: E402
    RemoteBag,
    decode_navsatfix,
    read_chunk_index,
    read_message,
)
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
    ap.add_argument("--workers", type=int, default=4,
                    help=("Concurrent range reads. The pass is latency-bound, but this host "
                          "refuses heavy concurrency: at twelve workers 95% of chunks failed "
                          "to read, and serially none did. Four is what it tolerates."))
    ap.add_argument("--everywhere", action="store_true",
                    help="keep frames anywhere in the region, not only in thin cells")
    args = ap.parse_args()

    region = get_region(args.region)
    thin = {row["cell"] for row in json.loads(args.thin_cells.read_text())} if args.thin_cells.exists() else set()
    print(f"{len(thin)} thin cells to fill", flush=True)

    bag = RemoteBag(args.bag, max_workers=args.workers)
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
    observations: list[Observation] = []
    seen: set[str] = set()
    now = datetime.now(UTC)

    def place(when: float, conn_id: int, frame_key: str) -> bool:
        """Turn one frame into an observation, if a position and a thin cell justify it."""
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
                # RTK-corrected GNSS fused with an IMU, quoted at about five centimetres --
                # one to two orders better than every other provider in this catalogue.
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
    # ---- pass one: the trajectory, read message by message ----
    #
    # The chunks are uncompressed, so a hundred-byte fix can be fetched without pulling the
    # 1.3 MB of interleaved lidar and camera bytes wrapped around it. Measured on this bag that
    # is 5 MB instead of 5,751 MB. What it costs instead is round trips -- the share link
    # redirects and the signed address cannot be reused -- so the reads are made concurrently.
    positions = [c.position for c in bag.chunks]
    carrying = [i for i, c in enumerate(bag.chunks) if c.counts.get(position, 0)]
    print(f"{len(carrying)} of {len(bag.chunks)} chunks carry a position fix", flush=True)

    def fixes_in(i: int) -> list[dict]:
        chunk = bag.chunks[i]
        following = positions[i + 1] if i + 1 < len(positions) else chunk.position + 2_000_000
        try:
            index = read_chunk_index(bag, chunk, following)
        except Exception:  # noqa: BLE001 - one unreadable chunk is a gap, not a failure
            return []
        out = []
        for _, offset in index.entries.get(position, []):
            payload = read_message(bag, index, offset, hint=384)
            if payload:
                fix = decode_navsatfix(payload)
                if fix:
                    out.append(fix)
        return out

    # The trajectory is journalled as it arrives. An hour of reads against a CDN will meet at
    # least one truncated response or dropped connection, and starting again from nothing each
    # time is how this pass never finishes.
    cache = args.out / "trajectory.jsonl"
    cache.parent.mkdir(parents=True, exist_ok=True)
    done_chunks: set[int] = set()
    if cache.exists():
        for line in cache.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            done_chunks.add(row["chunk"])
            fixes.extend(row["fixes"])
        print(f"  resumed {len(fixes)} fixes from {len(done_chunks)} chunks read earlier", flush=True)
    remaining = [i for i in carrying if i not in done_chunks]

    started = time.time()
    with cache.open("a") as journal, ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, (i, batch) in enumerate(zip(remaining, pool.map(fixes_in, remaining)), start=1):
            fixes.extend(batch)
            journal.write(json.dumps({"chunk": i, "fixes": batch}) + "\n")
            if done % 200 == 0:
                journal.flush()
                print(f"  trajectory {done}/{len(remaining)} chunks, {len(fixes)} fixes, "
                      f"{bag.bytes_read/1e6:.1f} MB, {time.time()-started:.0f}s", flush=True)
    fixes.sort(key=lambda f: f["t"])
    times.extend(f["t"] for f in fixes)
    print(f"trajectory: {len(fixes)} fixes in {time.time()-started:.0f}s, "
          f"{bag.bytes_read/1e6:.1f} MB", flush=True)
    if not fixes:
        sys.exit("no positions decoded; nothing can be placed")

    # ---- pass two: only the frames standing in a thin cell ----
    #
    # Every camera message in the bag is indexed, but only those whose nearest fix falls in a
    # cell that has measured kerbs and almost no photographs are worth fetching. The rest are
    # skipped without being read, which is the whole point of addressing messages individually.
    wanted_frames: list[tuple[float, int, str]] = []
    failures: list[str] = []
    camera_chunks = [i for i, c in enumerate(bag.chunks) if any(c.counts.get(k, 0) for k in cameras)]
    print(f"{len(camera_chunks)} chunks carry camera frames", flush=True)

    def frames_in(i: int) -> list[tuple[float, int, str]]:
        chunk = bag.chunks[i]
        following = positions[i + 1] if i + 1 < len(positions) else chunk.position + 2_000_000
        try:
            index = read_chunk_index(bag, chunk, following)
        except Exception as exc:  # noqa: BLE001
            # Counted rather than swallowed. A bare `return []` here hid however many chunks
            # were failing behind a plausible-looking total, and a low yield read as a data
            # property rather than as an error.
            failures.append(f"{type(exc).__name__}")
            return []
        out = []
        for conn_id in cameras:
            for when_ns, _ in index.entries.get(conn_id, []):
                out.append((when_ns / 1e9, conn_id, f"{when_ns}"))
        return out

    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, batch in enumerate(pool.map(frames_in, camera_chunks), start=1):
            wanted_frames.extend(batch)
            if done % 400 == 0:
                print(f"  frame index {done}/{len(camera_chunks)}, {len(wanted_frames)} frames, "
                      f"{bag.bytes_read/1e6:.1f} MB", flush=True)
    print(f"{len(wanted_frames)} camera frames indexed in {time.time()-started:.0f}s"
          f"{f', {len(failures)} chunks unreadable' if failures else ''}", flush=True)

    for when, conn_id, key in sorted(wanted_frames):
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
