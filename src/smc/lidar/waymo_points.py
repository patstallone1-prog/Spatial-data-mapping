"""Turn Waymo range images into point clouds in the vehicle frame.

A Waymo lidar return is not stored as a point. It is stored as a pixel in a range image: rows are
laser beams, columns are azimuth steps, and the first channel is the distance along that ray. The
geometry that turns one into the other lives in the calibration, and three details in it are easy
to get wrong in ways that produce a plausible-looking cloud rather than an error.

**Beam order is inverted.** ``beam_inclinations`` runs bottom to top; range image rows run top to
bottom. Using the list as given tilts the whole cloud and bends flat ground into a bowl.

**Azimuth needs the mounting correction.** Column zero is not azimuth zero. The sensor's yaw is
baked into its extrinsic, and the correction is ``atan2(extrinsic[1,0], extrinsic[0,0])``. Omit
it and the cloud is rotated about the vehicle by the mount angle -- which for the TOP lidar is
small enough to look almost right.

**Only the top lidar has a measured inclination table.** The four side units publish a min and a
max, and their beams are spaced evenly between them.

The output is in the vehicle frame: x forward, y left, z up, origin on the ground under the
vehicle centre. That is already the frame the kerb measurement wants -- along, across, up -- so
nothing downstream needs a second convention.
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass

import numpy as np

#: Channel layout of a Waymo range image pixel.
CHANNEL_RANGE = 0
CHANNEL_INTENSITY = 1
CHANNEL_ELONGATION = 2
CHANNEL_IN_NO_LABEL_ZONE = 3

#: Waymo's 3D semantic classes that this cares about. A kerb has a class of its own, which is
#: the reason this dataset is worth the licence for this problem at all.
TYPE_ROAD = 17
TYPE_CURB = 18
TYPE_SIDEWALK = 20


@dataclass(frozen=True, slots=True)
class VehicleCloud:
    """Returns in the vehicle frame: x forward, y left, z up."""

    xyz: np.ndarray
    intensity: np.ndarray
    semantic: np.ndarray | None

    def __len__(self) -> int:
        return int(self.xyz.shape[0])


def _matrix(dataset_pb2, blob: bytes) -> np.ndarray:
    matrix = dataset_pb2.MatrixFloat()
    matrix.ParseFromString(zlib.decompress(blob))
    return np.array(matrix.data, dtype=np.float32).reshape(list(matrix.shape.dims))


def _matrix_int(dataset_pb2, blob: bytes) -> np.ndarray:
    matrix = dataset_pb2.MatrixInt32()
    matrix.ParseFromString(zlib.decompress(blob))
    return np.array(matrix.data, dtype=np.int32).reshape(list(matrix.shape.dims))


def inclinations(calibration, rows: int) -> np.ndarray:
    """Beam elevation angles, ordered to match range image rows (top row first)."""
    if len(calibration.beam_inclinations):
        table = np.array(calibration.beam_inclinations, dtype=np.float64)
    else:
        # Evenly spaced between the published bounds. The +0.5 samples bin centres rather than
        # edges, which is what the beams actually are.
        low = float(calibration.beam_inclination_min)
        high = float(calibration.beam_inclination_max)
        table = low + (np.arange(rows, dtype=np.float64) + 0.5) * (high - low) / rows
    return table[::-1]


def range_image_to_cloud(dataset_pb2, frame, laser, *, keep_no_label_zone: bool = False) -> VehicleCloud:
    """One laser's first return, as points in the vehicle frame."""
    calibration = next(
        (c for c in frame.context.laser_calibrations if c.name == laser.name), None
    )
    if calibration is None or not laser.ri_return1.range_image_compressed:
        empty = np.empty((0, 3), dtype=np.float64)
        return VehicleCloud(empty, np.empty(0), None)

    image = _matrix(dataset_pb2, laser.ri_return1.range_image_compressed)
    rows, cols = image.shape[0], image.shape[1]
    ranges = image[..., CHANNEL_RANGE].astype(np.float64)

    extrinsic = np.array(calibration.extrinsic.transform, dtype=np.float64).reshape(4, 4)
    azimuth_correction = float(np.arctan2(extrinsic[1, 0], extrinsic[0, 0]))

    # Columns sweep from +pi to -pi as the index rises, hence the reversal in the ratio.
    ratios = (cols - 0.5 - np.arange(cols, dtype=np.float64)) / cols
    azimuth = (ratios * 2.0 - 1.0) * np.pi - azimuth_correction
    inclination = inclinations(calibration, rows)

    cos_incl = np.cos(inclination)[:, None]
    sin_incl = np.sin(inclination)[:, None]
    cos_az = np.cos(azimuth)[None, :]
    sin_az = np.sin(azimuth)[None, :]

    x = cos_az * cos_incl * ranges
    y = sin_az * cos_incl * ranges
    z = sin_incl * ranges

    valid = ranges > 0
    if not keep_no_label_zone and image.shape[2] > CHANNEL_IN_NO_LABEL_ZONE:
        # Waymo blanks regions it could not label; keeping them mixes unlabelled ground into a
        # measurement that is supposed to know what it is standing on.
        valid &= image[..., CHANNEL_IN_NO_LABEL_ZONE] < 0.5

    sensor = np.stack((x[valid], y[valid], z[valid], np.ones(int(valid.sum()))))
    vehicle = (extrinsic @ sensor)[:3].T

    semantic = None
    if laser.ri_return1.segmentation_label_compressed:
        labels = _matrix_int(dataset_pb2, laser.ri_return1.segmentation_label_compressed)
        # Channel 1 is the semantic class; channel 0 is the instance id.
        semantic = labels[..., 1][valid]

    return VehicleCloud(vehicle, image[..., CHANNEL_INTENSITY][valid], semantic)


def frame_cloud(dataset_pb2, frame, *, lasers=None) -> VehicleCloud:
    """Every laser's first return for one frame, merged in the vehicle frame."""
    clouds = [
        range_image_to_cloud(dataset_pb2, frame, laser)
        for laser in frame.lasers
        if lasers is None or laser.name in lasers
    ]
    clouds = [c for c in clouds if len(c)]
    if not clouds:
        empty = np.empty((0, 3), dtype=np.float64)
        return VehicleCloud(empty, np.empty(0), None)
    semantic = (
        np.concatenate([c.semantic for c in clouds])
        if all(c.semantic is not None for c in clouds)
        else None
    )
    return VehicleCloud(
        np.concatenate([c.xyz for c in clouds]),
        np.concatenate([c.intensity for c in clouds]),
        semantic,
    )
