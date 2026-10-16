#!/usr/bin/env python3
"""Real photo matching vs separate lidar sweeps; local sensor agreement, not survey accuracy."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from smc.curbmeasure.geometry import Camera, triangulate  # noqa: E402
from smc.imagery.calibration import quaternion_to_matrix  # noqa: E402
from smc.imagery.safe_pickle import load_point_cloud  # noqa: E402
from smc.imagery.streetview_reference import atomic_json  # noqa: E402
from smc.net import use_certifi  # noqa: E402
from smc.reconstruction.lidar_reference import LidarReference  # noqa: E402
from smc.reconstruction.matching import (  # noqa: E402
    Frame,
    Track,
    match_frames,
    refine_tracks_subpixel,
)
from smc.reconstruction.matching_benchmark import evaluate  # noqa: E402
from smc.reconstruction.multiview import Control, refine  # noqa: E402


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_cloud(base, frame):
    data = load_point_cloud((base / f"lidar/{frame:02d}.pkl.gz").read_bytes())
    labels = load_point_cloud((base / f"annotations/semseg/{frame:02d}.pkl.gz").read_bytes())[
        "class"
    ]
    return np.column_stack([data[k] for k in ("x", "y", "z")]), labels


def select_spread(items, pixels, count):
    if not items:
        return []
    chosen = [items[0]]
    while len(chosen) < min(count, len(items)):
        left = [k for k in items if k not in chosen]
        chosen.append(
            max(left, key=lambda k: min(np.linalg.norm(pixels[k] - pixels[j]) for j in chosen))
        )
    return chosen


def prepare_case(case, config, folder, assets, matcher=None):
    prefix_name = f"pandaset/{case['sequence']}/"
    for member, receipt in assets.items():
        if member.startswith(prefix_name) and digest(folder / "raw" / member) != receipt["sha256"]:
            raise ValueError("source pixels, lidar, semantic labels or calibration changed")
    base = folder / "raw/pandaset" / case["sequence"]
    prefix = base / "camera" / case["camera"]
    intrinsics = json.loads((prefix / "intrinsics.json").read_text())
    poses = json.loads((prefix / "poses.json").read_text())
    frames, images, masks, refs = [], [], [], []
    sources = []
    for frame in config["frames"]:
        path = prefix / f"{frame:02d}.jpg"
        relative = str(path.relative_to(folder / "raw"))
        if digest(path) != assets[relative]["sha256"]:
            raise ValueError("image checksum changed")
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError("unreadable source pixels")
        pose = poses[frame]
        rotation = quaternion_to_matrix(**pose["heading"]).T
        c = Camera(
            f"{case['case_id']}-{frame:02d}",
            np.array([pose["position"][k] for k in ("x", "y", "z")]),
            rotation,
            intrinsics["fx"],
            (intrinsics["cx"], intrinsics["cy"]),
            0.0,
            0.0,
            image.shape[1],
            image.shape[0],
            intrinsics["fy"],
        )
        xyz, labels = read_cloud(base, frame)
        reference = LidarReference(c, xyz, labels)
        refs.append(reference)
        masks.append(reference.exclusion_mask())
        frames.append(Frame(c, case["sequence"], f"pandaset-{case['sequence']}", digest(path)))
        images.append(image)
        sources.append(relative)
    cv2.setRNGSeed(2049)
    cache_key = hashlib.sha256(
        json.dumps(
            {
                "images": [assets[s]["sha256"] for s in sources],
                "masks": [hashlib.sha256(m.tobytes()).hexdigest() for m in masks],
                "matcher": "sift" if matcher is None else "aliked-lightglue",
                "code": digest(ROOT / "src/smc/reconstruction/matching.py"),
                "learned_code": digest(ROOT / "src/smc/reconstruction/learned_matching.py"),
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    cache = folder / "matches" / f"{case['case_id']}-{cache_key}.json"
    if cache.exists():
        doc = json.loads(cache.read_text())
        tracks = [
            Track(t["track_id"], {k: np.array(v, float) for k, v in t["pixels"].items()})
            for t in doc["tracks"]
        ]
        matching = doc["matching"]
    else:
        tracks, matching = (
            match_frames(frames, images, masks, max_tracks=64)
            if matcher is None
            else matcher.match(frames, images, masks, max_tracks=64)
        )
        atomic_json(
            cache,
            {
                "matching": matching,
                "tracks": [
                    {"track_id": t.track_id, "pixels": {k: v.tolist() for k, v in t.pixels.items()}}
                    for t in tracks
                ],
            },
        )
    c0 = frames[0].camera
    # Fitting and evaluation clouds are distinct files/sweeps. Truth is indexed
    # through the fixed camera/pixel calibration, NEVER optimized 3D proximity.
    held_xyz, held_labels = read_cloud(base, config["heldout_lidar_frame"])
    held = LidarReference(c0, held_xyz, held_labels)
    fit_by_id, truth_by_id, pixels = {}, {}, {}
    for track in tracks:
        pixel = track.pixels[c0.image_id]
        pixels[track.track_id] = pixel
        fit = refs[0].at_pixel(pixel)
        truth = held.at_pixel(pixel)
        if fit:
            fit_by_id[track.track_id] = fit
        if truth:
            truth_by_id[track.track_id] = truth
    fit_ids = select_spread(sorted(fit_by_id), pixels, config["fit_control_count"])
    test_ids = select_spread(
        sorted(set(truth_by_id) - set(fit_ids)), pixels, config["checkpoint_count"]
    )
    fit_source = f"pandaset/{case['sequence']}/lidar/{config['fitting_lidar_frame']:02d}"
    test_source = f"pandaset/{case['sequence']}/lidar/{config['heldout_lidar_frame']:02d}"
    test_file = base / f"lidar/{config['heldout_lidar_frame']:02d}.pkl.gz"
    checkpoints = [
        {
            "track_id": k,
            **truth_by_id[k],
            "source_id": test_source,
            "method": "lidar",
            "independent": True,
            "evidence_sha256": digest(test_file),
        }
        for k in test_ids
    ]
    controls = [Control(k, np.array(fit_by_id[k]["xyz"]), 0.02, fit_source) for k in fit_ids]
    diagnostics = {
        "matching": matching,
        "fit_controls": len(controls),
        "heldout_checkpoints": len(checkpoints),
        "reference_frame": c0.image_id,
        "camera_calibration": {"fx": intrinsics["fx"], "fy": intrinsics["fy"]},
        "sources": sources,
        "static_mask_fractions": [float((~m).mean()) for m in masks],
    }
    return (
        {"case_id": case["case_id"], "checkpoints": checkpoints},
        {"controls": [{"track_id": c.track_id, "source_id": c.source_id} for c in controls]},
        ([f.camera for f in frames], tracks, controls, images, masks),
        diagnostics,
    )


def run(config, folder, frozen_path, matcher=None):
    acquisition = json.loads((folder / "acquisition.json").read_text())
    plans, fitting, problems, diagnostics, failures = [], {}, {}, {}, {}
    for case in config["cases"]:
        name = case["case_id"]
        try:
            plan, fit, problem, info = prepare_case(
                case, config, folder, acquisition["assets"], matcher
            )
            plans.append(plan)
            fitting[name] = fit
            problems[name] = problem
            diagnostics[name] = info
        except (OSError, KeyError, ValueError) as exc:
            plans.append({"case_id": name, "checkpoints": []})
            failures[name] = {"status": "source_unavailable", "reason": type(exc).__name__}
        print(
            f"prepared {name}: {diagnostics.get(name, {}).get('heldout_checkpoints', 0)} checkpoints",
            flush=True,
        )
    # Appending unrelated sequences to the shared acquisition must not invalidate
    # an older frozen case list. Bind only the named sequence assets.
    scopes = {f"pandaset/{c['sequence']}/" for c in config["cases"]}
    scoped = {
        k: v for k, v in acquisition["assets"].items() if any(k.startswith(p) for p in scopes)
    }
    scope_hash = hashlib.sha256(json.dumps(scoped, sort_keys=True).encode()).hexdigest()
    if frozen_path.exists():
        previous = json.loads(frozen_path.read_text())["source_assets_sha256"]
        all_hash = hashlib.sha256(
            json.dumps(acquisition["assets"], sort_keys=True).encode()
        ).hexdigest()
        if previous == all_hash:
            scope_hash = all_hash  # Preserve an already-frozen legacy receipt exactly.
    frozen = json.loads(
        json.dumps(
            {
                **config,
                "cases": plans,
                "source_assets_sha256": scope_hash,
                "fitting_sources": fitting,
                "diagnostics": diagnostics,
            }
        )
    )
    # Freeze all eight cases and IDs before any placement error or optimization is evaluated.
    if frozen_path.exists() and json.loads(frozen_path.read_text()) != frozen:
        raise ValueError("frozen benchmark changed; create a versioned benchmark, never overwrite")
    atomic_json(frozen_path, frozen)
    variants = {
        k: dict(failures) for k in ("two_view", "joint", "subpixel_joint", "full_pose_subpixel")
    }
    for name, (cameras, tracks, controls, images, masks) in problems.items():
        info = diagnostics[name]
        if len(controls) < config["fit_control_count"]:
            for results in variants.values():
                results[name] = {"status": "insufficient_independent_support"}
            continue
        points = {
            t.track_id: triangulate(cameras[:2], [t.pixels[c.image_id] for c in cameras[:2]])
            for t in tracks
        }
        variants["two_view"][name] = {
            "status": "reconstructed",
            "points": {k: v.tolist() for k, v in points.items() if np.isfinite(v).all()},
        }
        variants["joint"][name] = refine(cameras, tracks, controls)
        improved, lk = refine_tracks_subpixel(
            tracks,
            {c.image_id: im for c, im in zip(cameras, images, strict=True)},
            {c.image_id: m for c, m in zip(cameras, masks, strict=True)},
        )
        variants["subpixel_joint"][name] = refine(cameras, improved, controls)
        variants["full_pose_subpixel"][name] = refine(
            cameras, improved, controls, optimize_rotations=True
        )
        info["subpixel_refinement"] = lk
        print(f"reconstructed {name}: {variants['subpixel_joint'][name]['status']}", flush=True)
    reports = {k: evaluate(frozen, result, fitting) for k, result in variants.items()}
    full = {"reports": reports, "diagnostics": diagnostics, "predictions": variants}
    atomic_json(folder / "results.json", full)
    public = {
        "schema_version": 1,
        "benchmark_id": config["benchmark_id"],
        "reports": reports,
        "diagnostics": diagnostics,
        "frozen_manifest_sha256": digest(frozen_path),
        "attribution": config["attribution"],
        "raw_images_published": False,
        "absolute_5cm_accuracy_proven": False,
        "geometry_promoted": False,
        "limitations": [
            "Synchronized sensor-local agreement, not absolute geodetic accuracy",
            "Separate lidar sweeps share the dataset's calibration/pose system",
            "Unsupported cases remain in the denominator",
        ],
    }
    return public


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=ROOT / "data/benchmarks/real-photo-lidar-v1.json"
    )
    parser.add_argument("--data", type=Path, default=ROOT / "build/photo-lidar-real-v1")
    parser.add_argument(
        "--frozen", type=Path, default=ROOT / "data/benchmarks/real-photo-lidar-v1-frozen.json"
    )
    parser.add_argument(
        "--report", type=Path, default=ROOT / "docs/audits/photo-lidar-accuracy.json"
    )
    parser.add_argument("--learned", action="store_true")
    args = parser.parse_args()
    use_certifi()
    matcher = None
    if args.learned:
        from smc.reconstruction.learned_matching import LearnedMatcher

        matcher = LearnedMatcher(args.data / "models")
    result = run(json.loads(args.manifest.read_text()), args.data, args.frozen, matcher)
    atomic_json(args.report, result)
    for name, report in result["reports"].items():
        print(
            name,
            {
                k: report[k]
                for k in (
                    "successful_reconstruction_rate",
                    "conditional_finite_median_m",
                    "conditional_finite_p90_m",
                )
            },
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
