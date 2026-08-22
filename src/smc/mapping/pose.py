"""Camera pose geometry: projection, PnP, and robust estimation.

This is the arithmetic under the anchoring step — the one the re-spec calls load-bearing,
because every downstream position inherits its error. It is implemented here rather than
delegated because the delegate would have been ARCore Geospatial, whose terms put anything
derived from it out of commercial reach.

Conventions, fixed once so they cannot drift:

* A :class:`Pose` maps **world points into the camera frame**: ``x_cam = R @ x_world + t``.
  The camera centre in world coordinates is therefore ``-R.T @ t``, which is what gets reported
  as a position and is the value most often computed backwards.
* Rotations are carried as 3x3 matrices and exchanged as Rodrigues rotation vectors.
* Intrinsics are a 3x3 matrix ``K``; pixel coordinates are ``(u, v)`` with the origin at the
  top-left corner.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


def rotation_from_rotvec(rotvec: np.ndarray) -> np.ndarray:
    """Rodrigues formula. A zero vector gives identity rather than a division by zero."""
    rotvec = np.asarray(rotvec, dtype=np.float64).reshape(3)
    theta = float(np.linalg.norm(rotvec))
    if theta < 1e-12:
        return np.eye(3)
    axis = rotvec / theta
    kx, ky, kz = axis
    skew = np.array([[0.0, -kz, ky], [kz, 0.0, -kx], [-ky, kx, 0.0]])
    return np.eye(3) + math.sin(theta) * skew + (1.0 - math.cos(theta)) * (skew @ skew)


def rotvec_from_rotation(rotation: np.ndarray) -> np.ndarray:
    """Inverse of :func:`rotation_from_rotvec`, stable at 0 and pi."""
    rotation = np.asarray(rotation, dtype=np.float64)
    cos_theta = float(np.clip((np.trace(rotation) - 1.0) / 2.0, -1.0, 1.0))
    theta = math.acos(cos_theta)
    if theta < 1e-9:
        return np.zeros(3)
    if abs(theta - math.pi) < 1e-6:
        # Near pi the skew part vanishes; recover the axis from R + I instead.
        candidate = rotation + np.eye(3)
        axis = candidate[:, int(np.argmax(np.linalg.norm(candidate, axis=0)))]
        axis = axis / np.linalg.norm(axis)
        return axis * theta
    skew = (rotation - rotation.T) / (2.0 * math.sin(theta))
    return np.array([skew[2, 1], skew[0, 2], skew[1, 0]]) * theta


def intrinsics(focal_px: float, cx: float, cy: float) -> np.ndarray:
    """Pinhole intrinsics with square pixels and no skew."""
    if focal_px <= 0:
        raise ValueError("focal_px must be positive")
    return np.array([[focal_px, 0.0, cx], [0.0, focal_px, cy], [0.0, 0.0, 1.0]])


@dataclass(frozen=True, slots=True)
class Pose:
    """World-to-camera rigid transform."""

    rotation: np.ndarray
    translation: np.ndarray

    def __post_init__(self) -> None:
        r = np.asarray(self.rotation, dtype=np.float64)
        t = np.asarray(self.translation, dtype=np.float64).reshape(3)
        if r.shape != (3, 3):
            raise ValueError(f"rotation must be 3x3, got {r.shape}")
        if not np.allclose(r @ r.T, np.eye(3), atol=1e-6):
            raise ValueError("rotation is not orthonormal")
        if not math.isclose(float(np.linalg.det(r)), 1.0, abs_tol=1e-6):
            raise ValueError("rotation has determinant != 1 (reflection, not a rotation)")
        object.__setattr__(self, "rotation", r)
        object.__setattr__(self, "translation", t)

    @classmethod
    def identity(cls) -> Pose:
        return cls(np.eye(3), np.zeros(3))

    @classmethod
    def from_rotvec(cls, rotvec: np.ndarray, translation: np.ndarray) -> Pose:
        return cls(rotation_from_rotvec(rotvec), np.asarray(translation, dtype=np.float64))

    @classmethod
    def look_at(
        cls, eye: np.ndarray, target: np.ndarray, up: np.ndarray | None = None
    ) -> Pose:
        """Camera at ``eye`` looking at ``target``, with +z as the optical axis.

        Building rig poses by hand from rotation vectors is a reliable source of cameras
        pointing at the sky. This is the constructor every caller should reach for; the
        rotvec form stays for solvers, which think in tangent space.
        """
        eye = np.asarray(eye, dtype=np.float64).reshape(3)
        target = np.asarray(target, dtype=np.float64).reshape(3)
        world_up = np.array([0.0, 0.0, 1.0]) if up is None else np.asarray(up, dtype=np.float64)

        forward = target - eye
        norm = np.linalg.norm(forward)
        if norm < 1e-9:
            raise ValueError("eye and target coincide")
        forward = forward / norm

        right = np.cross(forward, world_up)
        if np.linalg.norm(right) < 1e-9:
            raise ValueError("view direction is parallel to up; pick a different up vector")
        right = right / np.linalg.norm(right)
        # Image +y points down, so down is the second camera axis.
        down = np.cross(forward, right)

        rotation = np.vstack([right, down, forward])
        return cls(rotation, -rotation @ eye)

    @property
    def rotvec(self) -> np.ndarray:
        return rotvec_from_rotation(self.rotation)

    @property
    def camera_centre(self) -> np.ndarray:
        """Camera position in world coordinates. Not ``translation``."""
        return -self.rotation.T @ self.translation

    def inverse(self) -> Pose:
        return Pose(self.rotation.T, -self.rotation.T @ self.translation)

    def transform(self, points_world: np.ndarray) -> np.ndarray:
        """World points to camera frame. Accepts (N, 3)."""
        points = np.asarray(points_world, dtype=np.float64).reshape(-1, 3)
        return points @ self.rotation.T + self.translation

    def angular_distance_deg(self, other: Pose) -> float:
        relative = self.rotation @ other.rotation.T
        cos_theta = float(np.clip((np.trace(relative) - 1.0) / 2.0, -1.0, 1.0))
        return math.degrees(math.acos(cos_theta))

    def centre_distance_m(self, other: Pose) -> float:
        return float(np.linalg.norm(self.camera_centre - other.camera_centre))


def project(points_world: np.ndarray, pose: Pose, k: np.ndarray) -> np.ndarray:
    """Project world points to pixels. Points behind the camera come back as NaN.

    NaN rather than a silently wrapped coordinate: a point behind the camera has no image, and
    quietly producing one is how a pose solver locks onto a mirrored solution.
    """
    cam = pose.transform(points_world)
    depths = cam[:, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        normalised = cam / depths[:, None]
    pixels = normalised @ np.asarray(k, dtype=np.float64).T
    out = pixels[:, :2]
    out[depths <= 1e-9] = np.nan
    return out


def reprojection_errors(
    points_world: np.ndarray, pixels: np.ndarray, pose: Pose, k: np.ndarray
) -> np.ndarray:
    """Per-correspondence pixel error. Points behind the camera get ``inf``."""
    predicted = project(points_world, pose, k)
    errors = np.linalg.norm(predicted - np.asarray(pixels, dtype=np.float64), axis=1)
    return np.where(np.isnan(errors), np.inf, errors)


def solve_pnp_dlt(points_world: np.ndarray, pixels: np.ndarray, k: np.ndarray) -> Pose:
    """Linear pose from >= 6 correspondences (Direct Linear Transform).

    Fast, unweighted, and sensitive to noise — its job is to give
    :func:`refine_pose` a starting point inside the basin of convergence, not to be the answer.
    """
    points = np.asarray(points_world, dtype=np.float64).reshape(-1, 3)
    uv = np.asarray(pixels, dtype=np.float64).reshape(-1, 2)
    if len(points) != len(uv):
        raise ValueError("points and pixels must have the same length")
    if len(points) < 6:
        raise ValueError(f"DLT needs at least 6 correspondences, got {len(points)}")

    k = np.asarray(k, dtype=np.float64)
    # Work in normalised coordinates so the system is well conditioned.
    normalised = (np.linalg.inv(k) @ np.c_[uv, np.ones(len(uv))].T).T[:, :2]

    homogeneous = np.c_[points, np.ones(len(points))]
    rows = []
    for xh, (x, y) in zip(homogeneous, normalised, strict=True):
        rows.append(np.r_[xh, np.zeros(4), -x * xh])
        rows.append(np.r_[np.zeros(4), xh, -y * xh])
    _, _, vt = np.linalg.svd(np.array(rows))
    projection = vt[-1].reshape(3, 4)

    m = projection[:, :3]
    u, s, v = np.linalg.svd(m)
    rotation = u @ v
    scale = float(np.mean(s))
    if np.linalg.det(rotation) < 0:
        rotation = -rotation
        scale = -scale
    if abs(scale) < 1e-12:
        raise ValueError("degenerate configuration: points are coplanar with the camera centre")
    translation = projection[:, 3] / scale

    pose = Pose(rotation, translation)
    # Cheirality: if the majority of points land behind the camera the sign is flipped.
    if float(np.mean(pose.transform(points)[:, 2] > 0)) < 0.5:
        pose = Pose(rotation_from_rotvec(pose.rotvec), -translation)
        if float(np.mean(pose.transform(points)[:, 2] > 0)) < 0.5:
            raise ValueError("no cheirality-consistent solution")
    return pose


def refine_pose(
    points_world: np.ndarray,
    pixels: np.ndarray,
    k: np.ndarray,
    initial: Pose,
    *,
    iterations: int = 30,
    huber_delta_px: float = 2.0,
) -> Pose:
    """Gauss-Newton refinement of reprojection error, Huber-weighted.

    Huber rather than plain least squares because a handful of surviving mismatches is the
    normal case in real matching, and squared error lets any one of them dominate the solution.
    The Jacobian is computed numerically: the analytic form is not difficult, but at these
    problem sizes it buys nothing and it is one more place for a sign error to hide.
    """
    points = np.asarray(points_world, dtype=np.float64).reshape(-1, 3)
    uv = np.asarray(pixels, dtype=np.float64).reshape(-1, 2)
    params = np.r_[initial.rotvec, initial.translation]
    step = 1e-7

    def residuals(p: np.ndarray) -> np.ndarray:
        pose = Pose.from_rotvec(p[:3], p[3:])
        predicted = project(points, pose, k)
        residual = (predicted - uv).reshape(-1)
        return np.nan_to_num(residual, nan=huber_delta_px * 10.0)

    for _ in range(iterations):
        r = residuals(params)
        jacobian = np.empty((len(r), 6))
        for i in range(6):
            bumped = params.copy()
            bumped[i] += step
            jacobian[:, i] = (residuals(bumped) - r) / step

        # Huber weights, per correspondence rather than per residual component.
        per_point = np.linalg.norm(r.reshape(-1, 2), axis=1)
        scale = np.where(
            per_point <= huber_delta_px, 1.0, huber_delta_px / np.maximum(per_point, 1e-9)
        )
        weights = np.repeat(scale, 2)

        jw = jacobian * weights[:, None]
        try:
            delta = np.linalg.lstsq(jw, -r * weights, rcond=None)[0]
        except np.linalg.LinAlgError:  # pragma: no cover - defensive
            break
        params = params + delta
        if float(np.linalg.norm(delta)) < 1e-10:
            break

    return Pose.from_rotvec(params[:3], params[3:])


def _iterations_needed(inlier_ratio: float, confidence: float, cap: int) -> int:
    """How many RANSAC samples are needed to see one all-inlier set, with `confidence`.

    ``log1p`` rather than ``log(1 - x)`` because for a small inlier ratio ``ratio**6`` falls
    below float64 epsilon, ``1.0 - ratio**6`` rounds to exactly 1.0, and its log is exactly
    zero — a division by zero on precisely the hard inputs the estimator exists to handle.
    """
    if inlier_ratio <= 0.0:
        return cap
    all_inlier_probability = inlier_ratio**6
    if all_inlier_probability >= 1.0:
        return 1
    denominator = math.log1p(-all_inlier_probability)
    if denominator == 0.0:
        return cap
    return min(cap, int(math.log1p(-confidence) / denominator) + 1)


@dataclass(frozen=True, slots=True)
class PnpResult:
    pose: Pose
    inliers: np.ndarray
    #: RMS reprojection error over the inliers, pixels.
    rms_px: float
    iterations: int

    @property
    def inlier_count(self) -> int:
        return int(self.inliers.sum())

    @property
    def inlier_ratio(self) -> float:
        return float(self.inliers.mean()) if self.inliers.size else 0.0


def ransac_pnp(
    points_world: np.ndarray,
    pixels: np.ndarray,
    k: np.ndarray,
    *,
    threshold_px: float = 3.0,
    confidence: float = 0.999,
    max_iterations: int = 2000,
    min_inliers: int = 8,
    rng: np.random.Generator | None = None,
) -> PnpResult | None:
    """Robust pose from noisy, partly wrong correspondences.

    Returns ``None`` rather than a low-confidence pose when the data will not support one.
    A refusal is a usable outcome — the frame simply does not anchor and is held back — whereas
    a confidently wrong pose corrupts every fact triangulated from it, and by then nothing
    downstream can tell.
    """
    points = np.asarray(points_world, dtype=np.float64).reshape(-1, 3)
    uv = np.asarray(pixels, dtype=np.float64).reshape(-1, 2)
    n = len(points)
    if n < 6:
        return None
    rng = rng or np.random.default_rng(0)

    best_inliers: np.ndarray | None = None
    best_count = 0
    iterations = max_iterations
    completed = 0

    for completed in range(1, max_iterations + 1):
        sample = rng.choice(n, size=6, replace=False)
        try:
            candidate = solve_pnp_dlt(points[sample], uv[sample], k)
        except (ValueError, np.linalg.LinAlgError):
            continue
        errors = reprojection_errors(points, uv, candidate, k)
        inliers = errors < threshold_px
        count = int(inliers.sum())
        if count > best_count:
            best_count = count
            best_inliers = inliers
            iterations = _iterations_needed(count / n, confidence, max_iterations)
        if completed >= iterations:
            break

    if best_inliers is None or best_count < min_inliers:
        return None

    # The consensus set can be degenerate even when the sample that found it was not —
    # coplanar inliers, or a cheirality-inconsistent refit. That is a failure to estimate,
    # which returns None, not an exception for the caller to handle.
    try:
        seed_pose = solve_pnp_dlt(points[best_inliers], uv[best_inliers], k)
    except (ValueError, np.linalg.LinAlgError):
        return None
    refined = refine_pose(points[best_inliers], uv[best_inliers], k, seed_pose)
    errors = reprojection_errors(points, uv, refined, k)
    final_inliers = errors < threshold_px
    if int(final_inliers.sum()) < min_inliers:
        return None

    rms = float(np.sqrt(np.mean(errors[final_inliers] ** 2)))
    return PnpResult(pose=refined, inliers=final_inliers, rms_px=rms, iterations=completed)


def pose_covariance(
    points_world: np.ndarray,
    pixels: np.ndarray,
    k: np.ndarray,
    pose: Pose,
    *,
    pixel_sigma: float = 1.0,
) -> np.ndarray:
    """6x6 covariance of the pose parameters (rotvec, translation).

    Linearised at the solution: ``cov = sigma^2 * inv(J^T J)``. This is what turns a pose into
    a *fact with an uncertainty*, and without it every anchored position would have to be
    served with a guessed sigma — which the confidence model would then propagate as if it
    meant something.

    Returns a matrix of ``inf`` when the configuration is degenerate, so callers fail loudly
    rather than inheriting a silently tiny uncertainty.
    """
    points = np.asarray(points_world, dtype=np.float64).reshape(-1, 3)
    uv = np.asarray(pixels, dtype=np.float64).reshape(-1, 2)
    params = np.r_[pose.rotvec, pose.translation]
    step = 1e-7

    def residuals(p: np.ndarray) -> np.ndarray:
        candidate = Pose.from_rotvec(p[:3], p[3:])
        return np.nan_to_num((project(points, candidate, k) - uv).reshape(-1), nan=0.0)

    base = residuals(params)
    jacobian = np.empty((len(base), 6))
    for i in range(6):
        bumped = params.copy()
        bumped[i] += step
        jacobian[:, i] = (residuals(bumped) - base) / step

    normal = jacobian.T @ jacobian
    try:
        return float(pixel_sigma**2) * np.linalg.inv(normal)
    except np.linalg.LinAlgError:
        return np.full((6, 6), np.inf)


def position_sigma_m(covariance: np.ndarray) -> float:
    """Horizontal 1-sigma position uncertainty from a pose covariance.

    Uses the translation block. Reported horizontally because that is the axis every gate in
    the re-spec is written against; vertical error is real but nothing is sold on it.
    """
    block = np.asarray(covariance)[3:6, 3:6]
    if not np.all(np.isfinite(block)):
        return math.inf
    return float(math.sqrt(max(0.0, block[0, 0] + block[1, 1])))
