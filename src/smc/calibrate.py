"""Calibrating the feature front end against real photographs.

The simulator can tell you whether the pipeline's geometry is right. It cannot tell you whether
feature matching works, and the reason is structural rather than a matter of render quality:
detector parameters tuned on procedurally textured surfaces are tuned to the texture generator,
not to concrete, brick, asphalt and glass. Real photographs are the only input that settles it.

    python -m smc.calibrate photos --dir photos/street-corners
    python -m smc.calibrate sweep  --dir photos/street-corners

What to supply, and why each part matters:

* **Pairs of the same corner from different viewpoints.** A single photo of a corner measures
  nothing — matching is a relation. Two to five metres apart along the footway is the useful
  range, because that is the baseline the capture trigger actually produces.
* **Both vantages, if you want the wearer question answered.** Simulation already shows that a
  reference index surveyed from the roadway does not anchor footway captures at all, while a
  footway-surveyed index anchors them to centimetres. Photographs from both positions are what
  confirm or refute that on real surfaces.
* **Ordinary conditions.** Overcast, wet, low sun, shadowed. A matcher tuned on even lighting
  fails on the first bright afternoon, and the failure will look like a positioning bug.

Name files so pairs are recognisable: ``corner01_a.jpg`` and ``corner01_b.jpg`` group by the
part before the underscore.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from smc.mapping.features import Detector, FeatureConfig, detect, match_features

SUPPORTED = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp")


@dataclass(frozen=True, slots=True)
class PairResult:
    group: str
    left: str
    right: str
    left_features: int
    right_features: int
    ratio_matches: int
    geometric_inliers: int
    inlier_ratio: float

    @property
    def usable(self) -> bool:
        """Whether this pair would have produced a pose.

        Twelve geometrically consistent matches is the pipeline's own floor, so this reports
        the same thing the anchoring stage would decide.
        """
        return self.geometric_inliers >= 12


def load_image(path: Path) -> np.ndarray:
    import cv2

    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"could not read {path}")
    return image[:, :, ::-1].copy()  # BGR to RGB


def discover(directory: Path) -> dict[str, list[Path]]:
    """Group photos by the filename stem before the first underscore."""
    groups: dict[str, list[Path]] = defaultdict(list)
    for path in sorted(directory.iterdir()):
        if path.suffix.lower() in SUPPORTED:
            groups[path.stem.split("_")[0]].append(path)
    return dict(groups)


def evaluate_pair(
    left: Path, right: Path, group: str, config: FeatureConfig
) -> PairResult:
    left_features = detect(load_image(left), config)
    right_features = detect(load_image(right), config)

    loose = FeatureConfig(
        detector=config.detector,
        max_features=config.max_features,
        ratio=config.ratio,
        mutual=config.mutual,
        geometric_threshold_px=None,
        contrast_threshold=config.contrast_threshold,
        edge_threshold=config.edge_threshold,
    )
    ratio_idx, _ = match_features(left_features, right_features, loose)
    strict_idx, _ = match_features(left_features, right_features, config)

    return PairResult(
        group=group,
        left=left.name,
        right=right.name,
        left_features=len(left_features),
        right_features=len(right_features),
        ratio_matches=len(ratio_idx),
        geometric_inliers=len(strict_idx),
        inlier_ratio=float(len(strict_idx) / max(len(ratio_idx), 1)),
    )


def evaluate_directory(directory: Path, config: FeatureConfig) -> list[PairResult]:
    """Every within-group pair in a directory."""
    results: list[PairResult] = []
    for group, paths in discover(directory).items():
        if len(paths) < 2:
            continue
        for i in range(len(paths) - 1):
            for j in range(i + 1, len(paths)):
                results.append(evaluate_pair(paths[i], paths[j], group, config))
    return results


def summarise(results: list[PairResult]) -> dict[str, float]:
    if not results:
        return {}
    inliers = np.array([r.geometric_inliers for r in results], dtype=float)
    return {
        "pairs": float(len(results)),
        "usable_fraction": float(np.mean([r.usable for r in results])),
        "median_features": float(
            np.median([r.left_features for r in results] + [r.right_features for r in results])
        ),
        "median_ratio_matches": float(np.median([r.ratio_matches for r in results])),
        "median_geometric_inliers": float(np.median(inliers)),
        "worst_geometric_inliers": float(inliers.min()),
    }


def sweep(directory: Path) -> list[tuple[FeatureConfig, dict[str, float]]]:
    """Grid over the parameters that actually move the needle.

    Contrast threshold decides how much flat concrete yields features at all; the ratio decides
    how much ambiguity is tolerated. Everything else is second order, and sweeping it would
    mostly buy overfitting to whichever photographs happen to be in the folder.
    """
    out: list[tuple[FeatureConfig, dict[str, float]]] = []
    for detector in (Detector.SIFT, Detector.ORB):
        for contrast in (0.004, 0.008, 0.02):
            for ratio in (0.7, 0.75, 0.85):
                config = FeatureConfig(
                    detector=detector,
                    max_features=4000,
                    ratio=ratio,
                    contrast_threshold=contrast,
                )
                out.append((config, summarise(evaluate_directory(directory, config))))
    return out


def _render_baseline(config: FeatureConfig) -> dict[str, float]:
    """The same statistics on simulated frames, for comparison.

    Printed beside the real numbers because the interesting quantity is the *gap*: if real
    photographs match far better than renders, the simulator's accuracy figures are pessimistic
    and its texture is the limit, not the pipeline.
    """
    from smc import geo
    from smc.carla_gen.world import build_corridor
    from smc.ingest.capture import RigConfig, pose_at_station
    from smc.render.raster import corridor_triangles, render_meshes

    corridor = build_corridor("cal", geo.Origin(38.9072, -77.0369), 20260820, n_blocks=1)
    triangles, colours = corridor_triangles(corridor)
    rig = RigConfig(width=640, height=480, focal_px=480.0)
    frames = [
        render_meshes(triangles, colours, pose_at_station(s, rig), rig.intrinsics, 640, 480).image
        for s in (20.0, 23.0)
    ]
    left, right = (detect(f, config) for f in frames)
    strict, _ = match_features(left, right, config)
    return {
        "median_features": float(np.median([len(left), len(right)])),
        "median_geometric_inliers": float(len(strict)),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smc.calibrate")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("photos", "score a photo folder"), ("sweep", "grid search")):
        cmd = sub.add_parser(name, help=help_text)
        cmd.add_argument("--dir", type=Path, required=True)
        cmd.add_argument("--out", type=Path)
    args = parser.parse_args(argv)

    directory: Path = args.dir
    if not directory.exists():
        print(f"no such directory: {directory}")
        print()
        print("Supply photographs like this:")
        print(f"  mkdir -p {directory}")
        print("  # two or more shots of the same corner, 2-5 m apart along the footway")
        print("  # name them corner01_a.jpg, corner01_b.jpg, corner02_a.jpg, ...")
        return 2

    groups = discover(directory)
    pairable = {g: p for g, p in groups.items() if len(p) >= 2}
    if not pairable:
        print(f"found {len(groups)} group(s) but none with two or more photos.")
        print("Matching is a relation between views; a single photo of a corner measures nothing.")
        return 2

    if args.command == "sweep":
        rows = sweep(directory)
        rows.sort(
            key=lambda r: (
                -r[1].get("usable_fraction", 0),
                -r[1].get("median_geometric_inliers", 0),
            )
        )
        print(f"{'detector':<7} {'contrast':>9} {'ratio':>6} {'usable':>8} {'inliers':>9}")
        for config, stats in rows:
            print(
                f"{config.detector:<7} {config.contrast_threshold:>9.3f} {config.ratio:>6.2f} "
                f"{stats.get('usable_fraction', 0):>7.0%} "
                f"{stats.get('median_geometric_inliers', 0):>9.0f}"
            )
        best = rows[0][0]
        print()
        print("Best setting on these photographs:")
        print(f"  FeatureConfig(detector=Detector.{best.detector.name}, "
              f"contrast_threshold={best.contrast_threshold}, ratio={best.ratio})")
        return 0

    config = FeatureConfig(max_features=4000, contrast_threshold=0.008)
    results = evaluate_directory(directory, config)
    stats = summarise(results)

    print(f"{len(pairable)} corner group(s), {len(results)} pair(s)\n")
    print(f"{'group':<14} {'features':>9} {'ratio':>7} {'inliers':>8}  verdict")
    for r in results:
        verdict = "usable" if r.usable else "TOO FEW"
        print(
            f"{r.group:<14} {min(r.left_features, r.right_features):>9} "
            f"{r.ratio_matches:>7} {r.geometric_inliers:>8}  {verdict}"
        )

    print()
    print(f"usable pairs: {stats['usable_fraction']:.0%}")
    print(f"median geometric inliers: {stats['median_geometric_inliers']:.0f} (floor is 12)")

    baseline = _render_baseline(config)
    print()
    print("simulated frames, same settings, 3 m apart:")
    print(f"  features {baseline['median_features']:.0f}, "
          f"geometric inliers {baseline['median_geometric_inliers']:.0f}")
    if stats["median_geometric_inliers"] > 1.5 * baseline["median_geometric_inliers"]:
        print("  -> real photographs match better than renders; the simulator's matching")
        print("     figures are pessimistic and its texture, not the pipeline, is the limit.")

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps({"summary": stats, "pairs": [asdict(r) for r in results]}, indent=2) + "\n"
        )
        print(f"\nwritten to {args.out}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
