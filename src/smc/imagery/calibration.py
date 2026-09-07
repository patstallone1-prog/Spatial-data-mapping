"""Measured camera geometry, kept instead of thrown away.

A catalogue entry says a frame is 1920 by 1080 and points at 47 degrees. For most providers
that is all there is: the rest would have to be guessed from EXIF, and usually cannot be.

PandaSet is not like that. It publishes measured intrinsics per camera and a six-degree-of-
freedom pose per frame, and the reader was fetching both and keeping a single focal length --
so 15,282 frames with known geometry were stored as though they were snapshots, and the pitch
and roll that were sitting in the pose quaternion came out null.

That is the difference between an image you can put a distance on and one you cannot. These
frames are the only ones in the catalogue that can calibrate the rest, and calibrating anything
needs the numbers this record keeps.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pyarrow as pa


def quaternion_to_matrix(w: float, x: float, y: float, z: float) -> np.ndarray:
    """Unit quaternion to a 3x3 rotation matrix."""
    norm = math.sqrt(w * w + x * x + y * y + z * z)
    if norm < 1e-12:
        return np.eye(3)
    w, x, y, z = w / norm, x / norm, y / norm, z / norm
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


#: How PandaSet orients a camera: x out of the lens, y downward, z to the left. Checked against
#: the archive rather than assumed -- the x axis of the published rotation comes out horizontal
#: and on the bearing the provider reports, and the y axis comes out pointing at the ground.
#:
#: This matters because decomposing the pose as if it were an east-north-up attitude gives a
#: roll of ninety degrees for a camera that is sitting perfectly level. That is the axis
#: convention showing through, not a tilted camera, and storing it would have put a fabricated
#: roll on all 15,282 frames.
CAMERA_FORWARD = (1.0, 0.0, 0.0)
CAMERA_DOWN = (0.0, 1.0, 0.0)


def camera_angles(rotation: np.ndarray) -> tuple[float, float, float]:
    """Compass heading, pitch and roll of a camera, from its rotation into the world frame.

    Derived from where the camera's own axes end up pointing rather than by unpacking the
    quaternion into Euler angles, so it does not depend on which axis convention the provider
    chose. Pitch is positive looking up; roll is positive when the horizon tips down to the
    right, which is how a photographer would describe it.
    """
    forward = rotation @ np.array(CAMERA_FORWARD)
    down = rotation @ np.array(CAMERA_DOWN)
    right = np.cross(down, forward)

    heading = (90.0 - math.degrees(math.atan2(forward[1], forward[0]))) % 360.0
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, forward[2]))))
    norm = float(np.linalg.norm(right))
    roll = (math.degrees(math.asin(max(-1.0, min(1.0, -right[2] / norm))))
            if norm > 1e-9 else 0.0)
    return heading, pitch, roll


@dataclass(frozen=True)
class SensorCalibration:
    """Everything measured about how one frame was taken.

    The pose is the camera's own position and orientation in the dataset's world frame, which
    is the frame its lidar points are in too -- so a point cloud and an image can be brought
    together without either being converted to anything.
    """

    observation_uid: str
    provider: str
    #: Pinhole intrinsics in pixels.
    fx: float | None = None
    fy: float | None = None
    cx: float | None = None
    cy: float | None = None
    #: Radial and tangential terms, where the provider publishes them. PandaSet's cameras are
    #: delivered rectified and it publishes none, so an empty list here means "none published",
    #: not "no distortion measured".
    distortion: list[float] = field(default_factory=list)
    #: Camera centre in the dataset's world frame, metres.
    position_x: float | None = None
    position_y: float | None = None
    position_z: float | None = None
    #: Orientation as a unit quaternion in the same frame.
    quaternion_w: float | None = None
    quaternion_x: float | None = None
    quaternion_y: float | None = None
    quaternion_z: float | None = None
    yaw_deg: float | None = None
    pitch_deg: float | None = None
    roll_deg: float | None = None
    #: Which point cloud in the archive belongs to this frame.
    lidar_frame_id: str | None = None
    #: Frame time minus lidar sweep time, milliseconds. A vehicle at 10 m/s moves 10 cm in
    #: 10 ms, which is the same order as the kerb heights being measured.
    time_offset_ms: float | None = None
    world_frame: str = "provider"

    def rotation(self) -> np.ndarray:
        return quaternion_to_matrix(self.quaternion_w or 1.0, self.quaternion_x or 0.0,
                                    self.quaternion_y or 0.0, self.quaternion_z or 0.0)


SCHEMA = pa.schema([
    ("observation_uid", pa.string()),
    ("provider", pa.string()),
    ("fx", pa.float64()), ("fy", pa.float64()),
    ("cx", pa.float64()), ("cy", pa.float64()),
    ("distortion", pa.list_(pa.float64())),
    ("position_x", pa.float64()), ("position_y", pa.float64()), ("position_z", pa.float64()),
    ("quaternion_w", pa.float64()), ("quaternion_x", pa.float64()),
    ("quaternion_y", pa.float64()), ("quaternion_z", pa.float64()),
    ("yaw_deg", pa.float32()), ("pitch_deg", pa.float32()), ("roll_deg", pa.float32()),
    ("lidar_frame_id", pa.string()),
    ("time_offset_ms", pa.float32()),
    ("world_frame", pa.string()),
])
