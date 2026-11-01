"""Whether a block's mesh is good enough to show: measured against the lidar, never assumed.

The scope's gate (cloud/docs/detail-mesh-scope.md): a block is held when fewer than 60% of its
cameras register, or when the mesh lies a median of more than 0.15 m, or a 95th percentile of
more than 0.5 m, from the lidar's surfaces. Without lidar the block is held as unmeasured --
a mesh nobody has checked is not published.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

from smc.worldmesh.tiles import Mesh

MIN_REGISTERED_SHARE = 0.60
MAX_MEDIAN_M = 0.15
MAX_P95_M = 0.50
#: Mesh surface samples per square metre for the distance test: 2 cm spacing.
SAMPLES_PER_M2 = 2500
MAX_SAMPLES = 4_000_000


@dataclass
class Verdict:
    passed: bool
    reasons: list[str]
    registered_share: float | None = None
    median_m: float | None = None
    p95_m: float | None = None
    lidar_points: int = 0

    def to_json(self) -> dict:
        return asdict(self)


def surface_samples(mesh: Mesh, rng: np.random.Generator) -> np.ndarray:
    tri = mesh.positions[mesh.faces]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    count = int(min(MAX_SAMPLES, max(1000, area.sum() * SAMPLES_PER_M2)))
    pick = rng.choice(len(tri), size=count, p=area / area.sum())
    u, v = rng.random(count), rng.random(count)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    t = tri[pick]
    return t[:, 0] + (t[:, 1] - t[:, 0]) * u[:, None] + (t[:, 2] - t[:, 0]) * v[:, None]


def judge(mesh: Mesh, *, registered_share: float | None, lidar: np.ndarray | None,
          seed: int = 0) -> Verdict:
    """``lidar``: (n, 3) east-north-up points of hard surfaces (ground, buildings) in the block."""
    reasons: list[str] = []
    verdict = Verdict(False, reasons, registered_share)
    if registered_share is not None and registered_share < MIN_REGISTERED_SHARE:
        reasons.append(f"only {registered_share:.0%} of cameras registered (needs {MIN_REGISTERED_SHARE:.0%})")
    if lidar is None or not len(lidar):
        reasons.append("no lidar to measure the mesh against")
    else:
        from scipy.spatial import cKDTree

        samples = surface_samples(mesh, np.random.default_rng(seed))
        distance, _ = cKDTree(samples).query(lidar, distance_upper_bound=5.0)
        # A lidar point under nothing reconstructed is coverage, not error.
        covered = distance[np.isfinite(distance)]
        verdict.lidar_points = len(covered)
        if len(covered) < 1000:
            reasons.append(f"the mesh covers only {len(covered)} lidar points")
        else:
            verdict.median_m, verdict.p95_m = float(np.median(covered)), float(np.percentile(covered, 95))
            if verdict.median_m > MAX_MEDIAN_M:
                reasons.append(f"median {verdict.median_m:.3f} m from the lidar (limit {MAX_MEDIAN_M})")
            if verdict.p95_m > MAX_P95_M:
                reasons.append(f"95th percentile {verdict.p95_m:.3f} m (limit {MAX_P95_M})")
    verdict.passed = not reasons
    return verdict
