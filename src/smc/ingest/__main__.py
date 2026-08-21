"""Generate seed data and run the end-to-end simulation.

    python -m smc.ingest seed --out build/seed --blocks 2
    python -m smc.ingest config

``seed`` produces everything a downstream stage needs to work against: a surveyed reference
index, a store of contributor frames with realistic GNSS error, ground truth, and an anchoring
accuracy report scored against that truth.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import numpy as np

from smc import geo
from smc.carla_gen.world import build_corridor, export_ground_truth
from smc.config import Settings
from smc.ingest.capture import RigConfig, contributor_pass, survey_pass
from smc.ingest.store import LocalFrameStore
from smc.mapping.anchoring import AnchoringConfig, AnchoringPipeline
from smc.mapping.descriptors import TinyImageDescriptor
from smc.mapping.seeding import seed_index
from smc.render.png import write_png
from smc.sim import OracleMatcher


def _seed(args: argparse.Namespace) -> int:
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    corridor = build_corridor(
        args.id, geo.Origin(args.lat, args.lon), args.seed, n_blocks=args.blocks
    )
    config = RigConfig(
        width=args.width, height=args.height, focal_px=args.width * 0.75, spacing_m=args.spacing
    )

    print(f"corridor {args.id}: {corridor.length_m:.0f} m, {len(corridor.segments)} segments")

    survey = survey_pass(corridor, config)
    index, report = seed_index(survey, corridor.origin, seed=args.seed)
    print(
        f"survey pass:      {len(survey)} frames -> index of {report.frames_seeded}, "
        f"reference sigma {report.mean_reference_sigma_m:.3f} m, "
        f"{report.mean_points_per_frame:.0f} points/frame"
    )
    write_png(survey[len(survey) // 2][1].image, out / "survey_sample.png")

    store = LocalFrameStore(out / "frames")
    contributors = []
    for i in range(args.contributors):
        frames = contributor_pass(
            corridor, store, contributor_id=f"u{i}", config=config, seed=args.seed + 100 * i
        )
        contributors.append(frames)
    total = sum(len(f) for f in contributors)
    print(
        f"contributor pass: {total} frames from {args.contributors} contributors, "
        f"{store.total_bytes() / 1e6:.1f} MB, mean GNSS error "
        f"{np.mean([f.gnss_error_m for c in contributors for f in c]):.2f} m"
    )

    truth = export_ground_truth(corridor)
    (out / "ground_truth.json").write_text(
        json.dumps([asdict(f) for f in truth], indent=2) + "\n"
    )
    print(f"ground truth:     {len(truth)} facts")

    descriptor = TinyImageDescriptor()
    errors: list[float] = []
    priors: list[float] = []
    sigmas: list[float] = []
    refused = 0
    sample = [f for c in contributors for f in c][: args.score]

    for frame in sample:
        matcher = OracleMatcher(frame.render, seed=args.seed)
        pipeline = AnchoringPipeline(
            index,
            matcher,
            config.intrinsics,
            corridor.origin,
            AnchoringConfig(min_similarity=0.25),
        )
        result = pipeline.anchor(
            descriptor.describe(frame.render.image),
            matcher.keypoints(),
            frame.record.lat,
            frame.record.lon,
            frame.record.position_sigma_m,
            rng=np.random.default_rng(args.seed),
        )
        priors.append(frame.gnss_error_m)
        if result is None:
            refused += 1
            continue
        errors.append(geo.distance_m(result.lat, result.lon, frame.true_lat, frame.true_lon))
        sigmas.append(result.position_sigma_m)

    print()
    print(f"anchoring:        {len(errors)} anchored, {refused} refused")
    if errors:
        print(f"  prior     mean {np.mean(priors):.2f} m")
        print(
            f"  posterior mean {np.mean(errors):.3f} m  median {np.median(errors):.3f} m  "
            f"max {max(errors):.3f} m"
        )
        print(f"  reported sigma mean {np.mean(sigmas):.3f} m")
        if np.mean(errors) > 2.0 * np.mean(sigmas):
            print(
                "  NOTE: actual error exceeds reported sigma. Linearised covariance ignores "
                "systematic error, so treat sigma as a floor."
            )
    print()
    print("  Scored with OracleMatcher: an upper bound. It reads correspondences from the")
    print("  world buffer rather than earning them from pixels. Real matching is unproven.")

    (out / "summary.json").write_text(
        json.dumps(
            {
                "corridor_id": args.id,
                "length_m": corridor.length_m,
                "survey_frames": len(survey),
                "reference_sigma_m": report.mean_reference_sigma_m,
                "contributor_frames": total,
                "ground_truth_facts": len(truth),
                "anchored": len(errors),
                "refused": refused,
                "prior_error_mean_m": float(np.mean(priors)) if priors else None,
                "posterior_error_mean_m": float(np.mean(errors)) if errors else None,
                "matcher": "oracle (simulation only)",
            },
            indent=2,
        )
        + "\n"
    )
    print(f"written to {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smc.ingest")
    sub = parser.add_subparsers(dest="command", required=True)

    seed = sub.add_parser("seed", help="generate seed data and score anchoring")
    seed.add_argument("--out", type=Path, default=Path("build/seed"))
    seed.add_argument("--id", default="pilot")
    seed.add_argument("--blocks", type=int, default=2)
    seed.add_argument("--contributors", type=int, default=2)
    seed.add_argument("--spacing", type=float, default=6.0)
    seed.add_argument("--width", type=int, default=256)
    seed.add_argument("--height", type=int, default=160)
    seed.add_argument("--score", type=int, default=16)
    seed.add_argument("--seed", type=int, default=20260820)
    seed.add_argument("--lat", type=float, default=38.9072)
    seed.add_argument("--lon", type=float, default=-77.0369)

    sub.add_parser("config", help="show resolved configuration, with secrets redacted")

    args = parser.parse_args(argv)
    if args.command == "config":
        print("resolved configuration:")
        print(Settings.from_env().describe())
        return 0
    return _seed(args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
