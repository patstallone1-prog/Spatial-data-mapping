#!/usr/bin/env python3
"""Fetch again the photographs the matcher still needs, and let go of the ones it has passed.

The run's pictures were pruned to free the drive (every record was kept). The matcher can only
fit a house from a screened photograph whose rectified front (``review/<key>.jpg``) and
segmentation (``.labels.png``) are on disk, so the houses still waiting on it stalled. This
fetches each such photograph again from its provider by the image id the record kept, checks the
pixels are the very ones screened (``pixel_sha256``), and redraws the front, its context and its
labels exactly as the filter did, filing them with the house (view_store). Nothing in a record
changes, and no full frame is kept.

Block by block -- a 0.01 degree cell of houses at a time -- and between blocks the pictures of
every house the matcher has since decided are deleted again (``prune_settled_views``), so the
drive holds only the blocks in hand.

    .venv/bin/python scripts/rehydrate_house_views.py --watch 600
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

RUN = Path("/Volumes/HP P700 1/Kerbside/frontage-run-2026-10-10")


def needed_by_block(live: Path, match: Path) -> dict[tuple[str, int, int], list[Path]]:
    from smc.facades.frontage_retention import settled_houses, still_needed

    settled = settled_houses(match)
    blocks = defaultdict(list)
    for path in sorted((live / "review").glob("*.json")):
        try:
            row = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(row, dict) or not row.get("building_id") or not still_needed(row, settled):
            continue
        if path.with_suffix(".jpg").is_file() and path.with_suffix(".labels.png").is_file():
            continue
        obs = (row.get("candidate") or {}).get("observation") or {}
        lon, lat = obs.get("longitude"), obs.get("latitude")
        if lon is None or lat is None:
            continue
        blocks[(row["region"], int(lon // 0.01), int(lat // 0.01))].append(path)
    return blocks


def redraw(path: Path, providers: dict, screen, view_store) -> str:
    """Fetch, verify and redraw one photograph; the outcome, as a word."""
    import cv2
    import numpy as np

    from smc.facades.frontage import capture_date
    from smc.facades.geometry import Camera, Wall
    from smc.facades.rectify import rectify_wall
    from smc.imagery.frontage_sources import provider_for, read_source_pixels
    from smc.imagery.schema import Observation
    from smc.reconstruction.pixel_store import CanonicalPixels

    row = json.loads(path.read_text())
    candidate = row["candidate"]
    obs = candidate["observation"]
    key = (obs["provider"], obs.get("provider_instance"))
    if key not in providers:
        providers[key] = provider_for(*key)
    observation = Observation(**{f.name: obs[f.name] for f in dataclasses.fields(Observation) if f.name in obs})
    observation.captured_at = capture_date(obs["captured_at"])
    raw = read_source_pixels(providers[key], observation)
    with tempfile.NamedTemporaryFile(suffix=".image") as fh:
        fh.write(raw)
        fh.flush()
        pixels = CanonicalPixels.from_image(Path(fh.name))
    if pixels.sha256 != row.get("pixel_sha256"):
        return "pixels_differ"  # the provider now serves another rendition: not what was screened
    image = np.frombuffer(pixels.samples, np.uint8).reshape(pixels.height, pixels.width, pixels.channels)
    camera = Camera(**candidate["camera"])
    camera = dataclasses.replace(camera, width=pixels.width, height=pixels.height,
                                 focal_px=camera.focal_px * pixels.width / camera.width if camera.focal_px else None)
    wall = Wall(**candidate["wall"])
    ppm = min(35, row.get("resolved_pixels_per_m") or candidate["pixels_per_m"],
              1400 / max(wall.length_m, wall.height_m))
    view = rectify_wall(image[..., ::-1], camera, wall, pixels_per_m=ppm, exact=True)
    if view is None:
        return "no_front"
    cv2.imwrite(str(path.with_suffix(".jpg")), view.image)
    tangent = np.asarray(wall.b) - np.asarray(wall.a)
    context_wall = dataclasses.replace(wall, a=tuple(np.asarray(wall.a) - tangent * 0.12),
                                       b=tuple(np.asarray(wall.b) + tangent * 0.12),
                                       height_m=wall.height_m * 1.35 + 5)
    context = rectify_wall(image[..., ::-1], camera, context_wall,
                           pixels_per_m=min(ppm, 1400 / max(context_wall.length_m, context_wall.height_m)), exact=True)
    if context:
        cv2.imwrite(str(path.with_suffix(".context.jpg")), context.image)
    labels = screen.screen(view.image, view.mask).pop("labels")
    cv2.imwrite(str(path.with_suffix(".labels.png")), labels.astype(np.uint8))
    # The house's own folder links the same files (hard links; the manifest is unchanged).
    folder = view_store.root / row["region"] / str(row["building_id"])
    if folder.is_dir():
        from smc.facades.view_store import SUFFIXES, _link
        for suffix in SUFFIXES:
            if path.with_suffix(suffix).is_file():
                target = folder / f"{path.stem}{suffix}"
                if target.exists():
                    target.unlink()
                _link(path.with_suffix(suffix), target)
    return "redrawn"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--run", type=Path, default=RUN)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env.local")
    parser.add_argument("--watch", type=float, default=0, help="seconds between sweeps; 0 = once")
    parser.add_argument("--blocks-ahead", type=int, default=3,
                        help="blocks redrawn before waiting for the matcher to pass them")
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    from smc.config import load_env_file
    from smc.facades.frontage_pixels import FrontagePixelScreen
    from smc.facades.frontage_retention import prune_settled_views
    from smc.facades.view_store import ViewStore
    from smc.net import use_certifi

    use_certifi()
    if args.env_file.exists():
        load_env_file(args.env_file)
    live, match = args.run / "frontage-live", args.run / "facade-match"
    screen = FrontagePixelScreen(args.run / "frontage-pilot-v2/model-cache", device=args.device)
    providers, store = {}, ViewStore(match / "views")
    attempted: set[str] = set()
    while True:
        swept = prune_settled_views(live, match)
        print(json.dumps({"swept": swept}), flush=True)
        blocks = needed_by_block(live, match)
        in_hand = sum(1 for paths in blocks.values() if any(p.with_suffix(".jpg").is_file() for p in paths))
        todo = [(block, [p for p in paths if p.stem not in attempted]) for block, paths in sorted(blocks.items())]
        todo = [(block, paths) for block, paths in todo if paths]
        for block, paths in todo[:max(0, args.blocks_ahead - in_hand)]:
            outcomes = defaultdict(int)
            for path in paths:
                attempted.add(path.stem)
                try:
                    outcomes[redraw(path, providers, screen, store)] += 1
                except Exception as error:  # a provider hiccup must not end the sweep
                    outcomes["failed:" + type(error).__name__] += 1
            print(json.dumps({"block": list(block), "photos": len(paths), **outcomes}), flush=True)
        if not args.watch:
            return 0
        if not todo and not blocks:
            print(json.dumps({"status": "nothing_waiting"}), flush=True)
        time.sleep(args.watch)


if __name__ == "__main__":
    raise SystemExit(main())
