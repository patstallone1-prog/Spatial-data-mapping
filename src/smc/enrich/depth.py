"""Putting lidar points into the image that was taken at the same moment.

The catalogue holds 386,624 photographs and no way to say how far away anything in one of them
is. Fifteen thousand of them are different: PandaSet fired two lidars from the same vehicle at
the same instant, published the camera's measured intrinsics and its pose in the same frame as
the points, and so those frames can carry a true distance on every pixel a return landed on.

That makes them the calibration corpus. A model that reads a kerb height off an image can be
checked against them; every other frame in the catalogue has nothing to be checked against.

The projection is a plain pinhole, with one thing worth stating out loud: PandaSet's camera
frame is x out of the lens, y downward and z to the left, so the optical axis is x and the
image's rightward direction is negative z. Assuming the usual z-forward convention instead puts
every point on the wrong axis and yields a picture that looks like a projection and is nonsense.
"""

from __future__ import annotations

import numpy as np

from smc.imagery.calibration import SensorCalibration

#: A return closer than this is on the vehicle itself.
MIN_RANGE_M = 1.0


def project_points_to_image(
    points_world: np.ndarray,
    calibration: SensorCalibration,
    width: int,
    height: int,
    *,
    min_range_m: float = MIN_RANGE_M,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """World points (N, 3) into one frame. Returns ``(u, v, depth, valid)``.

    ``depth`` is the distance along the optical axis in metres -- the thing that makes these
    frames worth more than their two megapixels. ``valid`` is false behind the camera, nearer
    than the vehicle's own bodywork, and outside the frame.
    """
    points = np.asarray(points_world, dtype=np.float64).reshape(-1, 3)
    if calibration.fx is None or calibration.cx is None:
        raise ValueError("a projection needs measured intrinsics")

    centre = np.array([calibration.position_x or 0.0,
                       calibration.position_y or 0.0,
                       calibration.position_z or 0.0])
    # The pose rotates camera axes into the world, so its transpose brings world points back
    # into the camera. Using it the other way round is the classic silent error here: it
    # produces a plausible-looking image of the scene reflected through the camera.
    camera = (points - centre) @ calibration.rotation()

    forward = camera[:, 0]
    down = camera[:, 1]
    left = camera[:, 2]

    safe = np.where(forward > 1e-6, forward, 1e-6)
    u = calibration.cx + calibration.fx * (-left) / safe
    v = (calibration.cy or 0.0) + (calibration.fy or calibration.fx) * down / safe

    valid = (forward > min_range_m) & (u >= 0) & (u < width) & (v >= 0) & (v < height)
    return u, v, forward, valid


def depth_image(
    points_world: np.ndarray,
    calibration: SensorCalibration,
    width: int,
    height: int,
    *,
    downsample: int = 4,
) -> np.ndarray:
    """A sparse depth map, nearest return per cell, zero where nothing landed.

    Reduced by ``downsample`` because a lidar sweep puts a few hundred thousand returns into a
    two-megapixel frame: at full resolution the map is almost entirely holes, and at a quarter
    it is a usable if sparse surface. Nearest wins per cell, since a far return seen past the
    edge of a near surface is an occlusion rather than a second depth.
    """
    u, v, depth, valid = project_points_to_image(points_world, calibration, width, height)
    out = np.zeros((height // downsample, width // downsample), dtype=np.float32)
    if not valid.any():
        return out
    cols = (u[valid] / downsample).astype(np.int32)
    rows = (v[valid] / downsample).astype(np.int32)
    values = depth[valid].astype(np.float32)
    order = np.argsort(-values)          # far first, so near overwrite them
    out[rows[order], cols[order]] = values[order]
    return out
