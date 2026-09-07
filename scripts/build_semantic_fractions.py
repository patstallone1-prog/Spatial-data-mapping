#!/usr/bin/env python3
"""Segment a sample of the catalogue and record what each frame is actually of.

This is the first step in the project that needs the pixels. Everything before it worked on
metadata, geometry and records; this downloads photographs, runs a segmentation model over
them, keeps eight numbers, and throws the pixels away.

That last part is the whole storage strategy. Half a terabyte of imagery is not kept, because
what is wanted from it is a handful of fractions per frame -- how much of it is road, footway,
building line, sky, and how much is a lorry parked in front of the thing the frame was supposed
to show. Occlusion in particular is invisible to every other signal in the catalogue, and it is
the commonest reason a frame that should be useful is not.

Fetching is the cost and it is network-bound, so frames are fetched by a pool of threads and
segmented one at a time on the GPU, which is idle most of the run and is not the constraint.
"""

from __future__ import annotations

import argparse
import io
import json
import queue
import random
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np  # noqa: E402
import pyarrow as pa  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402

from smc.enrich.semantics import GROUPS, fractions, usefulness  # noqa: E402

CATALOG = ROOT / "data" / "sf_corridor" / "observations" / "external-000.parquet"
OUT = ROOT / "data" / "observation_enrichment"
MODEL = "nvidia/segformer-b0-finetuned-cityscapes-1024-1024"
USER_AGENT = "spatial-mapping-crowdsource/semantics (+non-commercial research)"

PARTS = OUT / "semantics-parts"


def already_done() -> set[str]:
    """Observations a previous run already segmented, from the part files it left behind.

    The parts are the journal. A separate list of finished ids could disagree with the data --
    written after a crash, or before -- whereas a part file that exists contains exactly the
    rows it claims.
    """
    done: set[str] = set()
    if not PARTS.exists():
        return done
    for part in sorted(PARTS.glob("*.parquet")):
        try:
            done.update(pq.read_table(part, columns=["observation_uid"])
                        .column("observation_uid").to_pylist())
        except Exception:
            # A part cut off mid-write has no footer and cannot be read. It is the only one
            # that can be damaged, and dropping it costs at most one checkpoint of work.
            part.unlink()
    return done


def compact() -> int:
    """Merge the parts into one file and remove them."""
    parts = sorted(PARTS.glob("*.parquet"))
    if not parts:
        print("nothing to compact")
        return 0
    tables = [pq.read_table(part) for part in parts]
    merged = pa.concat_tables(tables)
    pq.write_table(merged, OUT / "semantics-000.parquet", compression="zstd")
    for part in parts:
        part.unlink()
    print(f"compacted {len(parts)} parts into semantics-000.parquet: {merged.num_rows} rows")
    return 0


SCHEMA = pa.schema(
    [("observation_uid", pa.string()), ("provider", pa.string())]
    + [(name, pa.float32()) for name in GROUPS]
    + [(name, pa.float32()) for name in ("facade_value", "road_value", "kerb_value", "occlusion")]
)


def fetch_bytes(provider: str, sequence: str, image_id: str) -> bytes | None:
    """The pixels, straight into memory. Nothing is written to disk."""
    import build_facades as facades

    url = facades.resolve_url(provider, sequence, image_id)
    if not url:
        return None
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.read()
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sample", type=int, default=4000,
                    help="frames per provider stratum; 0 means every eligible frame")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--checkpoint", type=int, default=250,
                    help="rows per part file, so an interrupted run loses at most this many")
    ap.add_argument("--compact", action="store_true",
                    help="merge the part files into one and delete them")
    args = ap.parse_args()

    if args.compact:
        return compact()

    def progress(message: str) -> None:
        print(message, flush=True)

    import torch
    from PIL import Image
    from transformers import SegformerForSemanticSegmentation, SegformerImageProcessor

    rows = pq.read_table(CATALOG, columns=[
        "observation_uid", "provider", "provider_sequence_id", "provider_image_id",
        "eligible", "projection_type"]).to_pydict()

    # Stratified by provider, so the sample says something about each rather than about
    # Mapillary alone -- which is four fifths of the catalogue and would otherwise be all of it.
    by_provider: dict[str, list[int]] = {}
    for i, provider in enumerate(rows["provider"]):
        if rows["eligible"][i] and provider != "pandaset":
            by_provider.setdefault(provider, []).append(i)
    rng = random.Random(args.seed)
    picked: list[int] = []
    if args.sample:
        share = args.sample // max(1, len(by_provider))
        for provider, members in sorted(by_provider.items()):
            take = min(share, len(members))
            picked.extend(rng.sample(members, take))
            progress(f"  {provider}: {take} of {len(members)}")
    else:
        for provider, members in sorted(by_provider.items()):
            picked.extend(members)
            progress(f"  {provider}: all {len(members)}")
    rng.shuffle(picked)

    done = already_done()
    if done:
        before = len(picked)
        picked = [i for i in picked if rows["observation_uid"][i] not in done]
        progress(f"resuming: {len(done)} already segmented, {before - len(picked)} skipped")
    progress(f"{len(picked)} frames to do")
    if not picked:
        return compact()

    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    processor = SegformerImageProcessor.from_pretrained(MODEL)
    model = SegformerForSemanticSegmentation.from_pretrained(MODEL).eval().to(device)
    progress(f"model on {device}")

    work: queue.Queue = queue.Queue(maxsize=args.workers * 3)
    counters = {"fetched": 0, "failed": 0}
    lock = threading.Lock()

    def fetch_worker(indices: list[int]) -> None:
        for i in indices:
            blob = fetch_bytes(rows["provider"][i], rows["provider_sequence_id"][i],
                               rows["provider_image_id"][i])
            with lock:
                counters["fetched" if blob else "failed"] += 1
            work.put((i, blob))

    chunks = [picked[k::args.workers] for k in range(args.workers)]
    threads = [threading.Thread(target=fetch_worker, args=(chunk,), daemon=True)
               for chunk in chunks if chunk]
    for thread in threads:
        thread.start()

    PARTS.mkdir(parents=True, exist_ok=True)
    out: dict[str, list] = {name: [] for name in SCHEMA.names}
    totals: dict[str, list] = {name: [] for name in SCHEMA.names}
    part_number = len(list(PARTS.glob("*.parquet")))

    def flush() -> None:
        """Write what is in hand as its own complete file.

        Complete is the point: a part with a footer can be read back, and a run that dies
        between checkpoints loses only the rows since the last one rather than all of them.
        """
        nonlocal part_number
        if not out["observation_uid"]:
            return
        pq.write_table(pa.table(out, schema=SCHEMA),
                       PARTS / f"part-{part_number:05d}.parquet", compression="zstd")
        part_number += 1
        for name in SCHEMA.names:
            totals[name].extend(out[name])
            out[name].clear()

    started = time.perf_counter()
    for done in range(1, len(picked) + 1):
        i, blob = work.get()
        if blob is None:
            continue
        try:
            image = Image.open(io.BytesIO(blob)).convert("RGB")
        except Exception:
            continue
        # A panorama is a whole sphere in one frame; segmenting it entire would count the sky
        # above and the road below in proportions no perspective camera ever sees. The middle
        # horizontal third is the part that corresponds to looking straight ahead.
        if rows["projection_type"][i] == "spherical":
            width, height = image.size
            image = image.crop((0, height // 3, width, 2 * height // 3))
        inputs = processor(images=image, return_tensors="pt").to(device)
        with torch.no_grad():
            logits = model(**inputs).logits
        labels = logits.argmax(dim=1)[0].to("cpu").numpy()

        shares = fractions(labels)
        scores = usefulness(shares)
        out["observation_uid"].append(rows["observation_uid"][i])
        out["provider"].append(rows["provider"][i])
        for name in GROUPS:
            out[name].append(shares[name])
        for name in ("facade_value", "road_value", "kerb_value", "occlusion"):
            out[name].append(scores[name])
        if len(out["observation_uid"]) >= args.checkpoint:
            flush()
        if done % 250 == 0:
            rate = done / (time.perf_counter() - started)
            progress(f"  {done}/{len(picked)} at {rate:.1f}/s "
                     f"({counters['failed']} fetch failures, {part_number} parts)")

    flush()
    out = totals

    elapsed = time.perf_counter() - started
    n = len(out["observation_uid"])
    def median(name: str):
        values = sorted(v for v in out[name] if v is not None)
        return round(values[len(values) // 2], 3) if values else None

    summary = {
        "sampled": len(picked),
        "segmented": n,
        "fetch_failures": counters["failed"],
        "elapsed_s": round(elapsed, 1),
        "frames_per_second": round(n / elapsed, 2) if elapsed else None,
        "projected_hours_for_386624": round(386624 / (n / elapsed) / 3600, 1) if n else None,
        "median_fractions": {name: median(name) for name in GROUPS},
        "median_values": {name: median(name) for name in
                          ("facade_value", "road_value", "kerb_value", "occlusion")},
        "heavily_occluded_share": round(
            sum(1 for v in out["occlusion"] if v > 0.25) / n, 3) if n else None,
        "no_sidewalk_visible_share": round(
            sum(1 for v in out["sidewalk"] if v < 0.01) / n, 3) if n else None,
    }
    name = "semantics_sample_summary.json" if args.sample else "semantics_summary.json"
    (OUT / name).write_text(json.dumps(summary, indent=1))
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
