#!/usr/bin/env python3
"""Reproducible analytic ablation. NOT a real-image or surveyed accuracy claim.

All eight cases are frozen before solving, including two intentionally
unidentifiable ones. Compare existing two-ray placement to joint refinement at
the same 0.15 m threshold; fitting uses three named absolute controls and an
optional width between two additional landmarks. Eleven other coordinates
stay in evaluation only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import replace
from importlib.metadata import version
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from smc.curbmeasure.geometry import Camera, triangulate  # noqa: E402
from smc.reconstruction.matching import Track  # noqa: E402
from smc.reconstruction.matching_benchmark import evaluate  # noqa: E402
from smc.reconstruction.multiview import Control, Relation, refine  # noqa: E402


def experiment():
    cases, fitting, baseline, refined, spatial = [], {}, {}, {}, {}
    problems = {}
    for case in range(8):
        case_id = f"analytic-{case}"
        rng = np.random.default_rng(1700 + case)
        spacing = 2.0 if case < 6 else 0.00001
        cameras = [
            Camera(
                str(i),
                np.array([x, 0.0, 0.0]),
                np.eye(3),
                800.0,
                (400.0, 300.0),
                0.0,
                0.0,
                800,
                600,
            )
            for i, x in enumerate([-spacing, 0, spacing])
        ]
        points = rng.uniform([-2.0, -2.0, 10.0], [2.0, 2.0, 20.0], (16, 3))
        tracks = [
            Track(str(i), {c.image_id: c.project(p)[0] + rng.normal(0, 0.15, 2) for c in cameras})
            for i, p in enumerate(points)
        ]
        noisy = [replace(c, centre=c.centre + rng.normal(0, 0.04, 3)) for c in cameras]
        # Degenerate cases stay truly degenerate: no random GNSS error manufacturing baseline.
        if case >= 6:
            noisy = cameras
        controls = [
            Control(str(i), p.copy(), 0.01, f"fit-control-{i}") for i, p in enumerate(points[:3])
        ]
        truth_hash = hashlib.sha256(points.tobytes()).hexdigest()
        cases.append(
            {
                "case_id": case_id,
                "checkpoints": [
                    {
                        "track_id": str(i),
                        "xyz": p.tolist(),
                        "source_id": f"analytic-heldout-{case}",
                        "method": "analytic",
                        "correspondence": "analytic_id",
                        "independent": True,
                        "evidence_sha256": truth_hash,
                    }
                    for i, p in enumerate(points)
                    if i >= 5
                ],
            }
        )
        fitting[case_id] = {
            "controls": [{"track_id": c.track_id, "source_id": c.source_id} for c in controls]
        }
        problems[case_id] = (noisy, tracks, controls, points)
    # Freeze the complete denominator and independent truth BEFORE solving any case.
    manifest = {
        "schema_version": 1,
        "benchmark_id": "multiview-analytic-v1",
        "purpose": "synthetic_regression_only",
        "coordinate_frame": "local_ENU_m",
        "threshold_m": 0.15,
        "cases": cases,
    }
    for case_id, (noisy, tracks, controls, points) in problems.items():
        raw = {
            t.track_id: triangulate(noisy[:2], [t.pixels[c.image_id] for c in noisy[:2]])
            for t in tracks
        }
        baseline[case_id] = {
            "status": "reconstructed"
            if any(np.isfinite(p).all() for p in raw.values())
            else "unobservable",
            "points": {k: p.tolist() for k, p in raw.items() if np.isfinite(p).all()},
        }
        refined[case_id] = refine(noisy, tracks, controls)
        # A separate fitting-only, measured plan-distance relationship; no test xyz used.
        width = float(np.linalg.norm((points[3] - points[4])[:2]))
        relation = Relation("3", "4", width, 0.08, "fit-width", "street_width", "analytic-block")
        spatial[case_id] = refine(noisy, tracks, controls, [relation])
    reports = {
        name: evaluate(manifest, results, fitting)
        for name, results in (
            ("two_ray_seed_poses", baseline),
            ("joint_refinement", refined),
            ("joint_with_spatial_relation", spatial),
        )
    }
    return {
        "manifest": manifest,
        "reports": reports,
        "seed": 1700,
        "cases": {
            k: {n: v for n, v in r.items() if n not in {"points", "cameras"}}
            for k, r in refined.items()
        },
        "warning": "analytic calibration test only; no real-world 25% claim",
        "versions": {name: version(name) for name in ("numpy", "scipy", "opencv-python-headless")},
        "implementation_sha256": hashlib.sha256(
            (ROOT / "src/smc/reconstruction/multiview.py").read_bytes()
        ).hexdigest(),
        "implementation_files": {
            path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
            for path in (
                "src/smc/curbmeasure/geometry.py",
                "src/smc/reconstruction/multiview.py",
                "src/smc/reconstruction/matching.py",
                "src/smc/reconstruction/matching_benchmark.py",
                "scripts/curbmeasure/benchmark_multiview.py",
            )
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = experiment()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    for name, values in report["reports"].items():
        print(
            name,
            json.dumps(
                {
                    k: values[k]
                    for k in (
                        "successful_reconstruction_rate",
                        "conditional_finite_median_m",
                        "conditional_finite_p90_m",
                        "all_attempts_p90_m",
                    )
                }
            ),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
