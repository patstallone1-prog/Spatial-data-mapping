"""The dense cloud moved onto the lidar: the last metre the photographs' positions leave.

The frames' positions place the reconstruction to within a metre or so (each capture's GPS has
its own bias; the Chestnut trial's sparse model sat 0.4 m east, 0.3 m north and 0.5 m low,
2026-10-31). Airborne lidar is good to centimetres, so the fused cloud is moved rigidly onto
the lidar's hard surfaces -- six numbers, no scale, fitted to every point that lies near a
surface -- before it is meshed. Six numbers cannot hide a bad shape, so the check that follows
still measures the mesh.

Point to plane, robustly weighted: each cloud point is drawn toward the plane of its nearest
lidar point (sliding along a wall or a road costs nothing), and points far from any -- trees,
cars, what the flight never saw -- count for less the further they are. Not a trim by share: a
trim keeps the road and drops both facades together when they are the ones that are off.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

MAX_POINTS = 400_000
#: Coarse to fine: a few degrees of heading moves the ends of a block metres, so the first
#: steps match points from afar and the last only the close ones.
REACH_M = (6.0, 3.0, 1.5, 0.75, 0.4)
STEPS_PER_REACH = 15
#: Cauchy weights, at this share of the step's reach: a point that far off counts half.
WEIGHT_SCALE = 0.25
NORMAL_NEIGHBOURS = 12
#: A fit that wants to move further than this is not an anchoring but a different place. The
#: positions leave a few degrees of heading (the trial's sparse model: 2-4 degrees about the
#: vertical) but hardly any lean (0.3-0.4): a fit that tips the block over is refused.
MAX_SHIFT_M = 5.0
MAX_YAW_DEG = 10.0
MAX_TILT_DEG = 2.0


@dataclass
class Anchor:
    rotation: list[list[float]]
    shift_m: list[float]
    yaw_deg: float
    tilt_deg: float
    points: int
    before_m: float          # median distance to the lidar's planes, near points only
    after_m: float
    accepted: bool

    def to_json(self) -> dict:
        return asdict(self)

    def apply(self, xyz: np.ndarray) -> np.ndarray:
        return xyz @ np.asarray(self.rotation).T + np.asarray(self.shift_m)


def lidar_normals(lidar: np.ndarray, tree) -> np.ndarray:
    _, idx = tree.query(lidar, k=NORMAL_NEIGHBOURS)
    near = lidar[idx] - lidar[idx].mean(axis=1, keepdims=True)
    _, vectors = np.linalg.eigh(np.einsum("nki,nkj->nij", near, near))
    return vectors[:, :, 0]  # the direction of least spread


def _turn(w: np.ndarray) -> np.ndarray:
    """The rotation of a small turn vector (Rodrigues)."""
    angle = float(np.linalg.norm(w))
    if angle < 1e-12:
        return np.eye(3)
    k = w / angle
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(angle) * K + (1 - np.cos(angle)) * K @ K


def fit(cloud: np.ndarray, lidar: np.ndarray, seed: int = 0) -> Anchor:
    """The rigid motion taking ``cloud`` onto ``lidar`` (both (n, 3), the block's frame)."""
    from scipy.spatial import cKDTree

    rng = np.random.default_rng(seed)
    # Only over the lidar's footprint: the halo's points have nothing to meet but its edge.
    low, high = lidar[:, :2].min(axis=0) + 1.0, lidar[:, :2].max(axis=0) - 1.0
    cloud = cloud[np.all((cloud[:, :2] > low) & (cloud[:, :2] < high), axis=1)]
    if len(cloud) < 1000:
        return Anchor(np.eye(3).tolist(), [0.0, 0.0, 0.0], 0.0, 0.0, len(cloud), float("nan"), float("nan"), False)
    if len(cloud) > MAX_POINTS:
        cloud = cloud[rng.choice(len(cloud), MAX_POINTS, replace=False)]
    tree = cKDTree(lidar)
    normals = lidar_normals(lidar, tree)
    # About the cloud's centre, so a turn does not swing the block about the frame's origin.
    centre = cloud.mean(axis=0)
    R, t = np.eye(3), np.zeros(3)

    def residuals(moved, reach=REACH_M[-1]):
        d, j = tree.query(moved, distance_upper_bound=reach)
        near = np.isfinite(d)
        j = j[near]
        r = np.einsum("ni,ni->n", moved[near] - lidar[j], normals[j])
        return near, j, r

    near, _, r = residuals(cloud)
    before = float(np.median(np.abs(r))) if near.any() else float("nan")
    for reach in REACH_M:
        for _ in range(STEPS_PER_REACH):
            moved = (cloud - centre) @ R.T + centre + t
            near, j, r = residuals(moved, reach)
            if near.sum() < 100:
                break
            p, n = moved[near] - centre - t, normals[j]
            root = 1 / np.sqrt(1 + (r / (WEIGHT_SCALE * reach)) ** 2)
            # r + n.(w x p) + n.dt = 0, linearised for a small turn w and shift dt
            A = np.hstack([np.cross(p, n), n]) * root[:, None]
            step, *_ = np.linalg.lstsq(A, -r * root, rcond=None)
            R, t = _turn(step[:3]) @ R, t + step[3:]
            if np.linalg.norm(step[3:]) < 1e-4 and np.linalg.norm(step[:3]) < 1e-6:
                break
    moved = (cloud - centre) @ R.T + centre + t
    near, _, r = residuals(moved)
    after = float(np.median(np.abs(r))) if near.any() else float("nan")
    shift = centre + t - R @ centre          # as x' = R x + shift
    yaw = float(np.degrees(np.arctan2(R[1, 0], R[0, 0])))
    tilt = float(np.degrees(np.arccos(np.clip(R[2, 2], -1, 1))))
    accepted = bool(near.sum() >= 1000 and np.linalg.norm(shift) <= MAX_SHIFT_M
                    and abs(yaw) <= MAX_YAW_DEG and tilt <= MAX_TILT_DEG and after <= before)
    if not accepted:
        R, shift = np.eye(3), np.zeros(3)
    return Anchor(R.tolist(), shift.tolist(), yaw, tilt, int(near.sum()), before, after, accepted)


# -- the fused cloud as COLMAP writes it: binary PLY, positions, normals and colours ---------

_TYPES = {"float": "f4", "float32": "f4", "double": "f8", "float64": "f8", "uchar": "u1", "uint8": "u1",
          "int": "i4", "int32": "i4", "uint": "u4", "uint32": "u4", "short": "i2", "ushort": "u2"}


def read_ply(path: Path) -> tuple[bytes, np.ndarray]:
    with path.open("rb") as handle:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = handle.readline()
            if not line:
                raise ValueError(f"{path}: no end_header")
            header += line
        text = header.decode("ascii")
        if "binary_little_endian" not in text:
            raise ValueError(f"{path}: expected binary little-endian PLY")
        fields, count, in_vertex = [], 0, False
        for line in text.splitlines():
            parts = line.split()
            if parts[:2] == ["element", "vertex"]:
                count, in_vertex = int(parts[2]), True
            elif parts and parts[0] == "element":
                in_vertex = False
            elif in_vertex and parts[:1] == ["property"]:
                fields.append((parts[2], "<" + _TYPES[parts[1]]))
        return header, np.fromfile(handle, dtype=np.dtype(fields), count=count)


def write_ply(path: Path, header: bytes, vertices: np.ndarray) -> None:
    tmp = path.with_suffix(".part")
    with tmp.open("wb") as handle:
        handle.write(header)
        vertices.tofile(handle)
    tmp.replace(path)


def anchor_cloud(fused: Path, out: Path, lidar: np.ndarray) -> Anchor:
    """Fit the motion onto the lidar and write the moved cloud (normals turned with it)."""
    header, v = read_ply(fused)
    xyz = np.column_stack([v["x"], v["y"], v["z"]]).astype(np.float64)
    found = fit(xyz, lidar)
    R = np.asarray(found.rotation)
    moved = found.apply(xyz)
    for axis, name in enumerate("xyz"):
        v[name] = moved[:, axis]
    if {"nx", "ny", "nz"} <= set(v.dtype.names):
        n = np.column_stack([v["nx"], v["ny"], v["nz"]]).astype(np.float64) @ R.T
        v["nx"], v["ny"], v["nz"] = n[:, 0], n[:, 1], n[:, 2]
    write_ply(out, header, v)
    return found
