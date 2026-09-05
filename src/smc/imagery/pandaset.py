"""PandaSet.

Hesai and Scale AI's autonomous-driving dataset, CC BY 4.0, and the only one in this catalogue
that arrives with camera geometry already solved: per-frame six-degree-of-freedom pose, and
per-camera intrinsics measured rather than inferred from EXIF. Six cameras and two lidars, and
32 of its 103 sequences sit entirely inside the SF corridor.

Unlike Panoramax, KartaView and Mapillary this is not a service to query. It is one 44.5 GB zip,
read in place over HTTP range requests -- see :mod:`smc.imagery.archive` for why that is cheaper
than it sounds.

Two facts shape what it can contribute:

*Positions are real.* Unlike Waymo, PandaSet publishes GPS per frame, so its observations can be
placed on the corridor map rather than only measured in isolation.

*Poses are ego-relative.* ``camera/<name>/poses.json`` gives the camera in the vehicle's frame,
not the world's. Combining that with the GPS track gives a world pose, but the heading comes from
the pose quaternion rather than from a compass, and that distinction is recorded rather than
smoothed over.
"""

from __future__ import annotations

import io
import json
import math
import zipfile
from collections.abc import Callable, Iterator
from datetime import datetime, timezone

from smc.imagery.archive import RangedHttpFile
from smc.imagery.base import ImageAsset, License, ObservationUnavailable
from smc.imagery.region import Region
from smc.imagery.schema import (
    AVAILABLE,
    PROJECTION_PERSPECTIVE,
    Observation,
    SequenceRecord,
    observation_uid,
    sequence_uid,
)

DEFAULT_ARCHIVE = "https://huggingface.co/datasets/georghess/pandaset/resolve/main/pandaset.zip"
INSTANCE = "pandaset.org"

LICENSE = License(
    identifier="CC-BY-4.0",
    url="https://creativecommons.org/licenses/by/4.0/",
    attribution="© Hesai and Scale AI, PandaSet, CC BY 4.0",
    share_alike=False,
)

#: The six cameras, in the archive's own naming.
CAMERAS = (
    "front_camera",
    "front_left_camera",
    "front_right_camera",
    "left_camera",
    "right_camera",
    "back_camera",
)

#: Every camera in the release is this size. Checked rather than assumed, because the resolution
#: floor depends on it and a wrong constant would silently admit or reject the whole dataset.
IMAGE_WIDTH, IMAGE_HEIGHT = 1920, 1080


def _quaternion_heading(heading: dict) -> float | None:
    """Compass bearing from the pose quaternion, degrees clockwise from north.

    PandaSet's world frame is east-north-up, so the yaw extracted here is measured
    anticlockwise from east and has to be turned into a bearing.
    """
    try:
        w, x, y, z = (float(heading[k]) for k in ("w", "x", "y", "z"))
    except (KeyError, TypeError, ValueError):
        return None
    yaw = math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))
    return (90.0 - math.degrees(yaw)) % 360.0


class PandaSetProvider:
    """Reads sequences out of the published archive without downloading it."""

    name = "pandaset"
    instance = INSTANCE

    def __init__(self, archive_url: str = DEFAULT_ARCHIVE) -> None:
        self._url = archive_url
        self._file: RangedHttpFile | None = None
        self._zip: zipfile.ZipFile | None = None
        self._sequences: dict[str, SequenceRecord] = {}
        self.errors: list[str] = []

    @property
    def archive(self) -> zipfile.ZipFile:
        if self._zip is None:
            self._file = RangedHttpFile(self._url)
            self._zip = zipfile.ZipFile(io.BufferedReader(self._file, buffer_size=1 << 20))
        return self._zip

    @property
    def bytes_read(self) -> int:
        return self._file.bytes_read if self._file else 0

    # -- discovery ----------------------------------------------------------------------------

    def sequence_ids(self) -> list[str]:
        return sorted(
            {
                name.split("/")[1]
                for name in self.archive.namelist()
                if name.endswith("meta/gps.json")
            }
        )

    def _read_json(self, path: str):
        return json.loads(self.archive.read(path))

    def sequences_in(self, region: Region, *, progress: Callable[[str], None] | None = None) -> list[str]:
        """Sequence ids with at least one frame inside the region.

        Only the GPS tracks are read -- a few kilobytes each -- so the whole release can be
        filtered geographically for a fraction of a percent of its size.
        """
        found: list[str] = []
        ids = self.sequence_ids()
        for index, sequence in enumerate(ids, start=1):
            try:
                track = self._read_json(f"pandaset/{sequence}/meta/gps.json")
            except (KeyError, json.JSONDecodeError) as exc:
                self.errors.append(f"{sequence}: gps unreadable ({exc})")
                continue
            if any(region.bbox.contains(float(p["lat"]), float(p["long"])) for p in track):
                found.append(sequence)
            if progress and (index % 25 == 0 or index == len(ids)):
                progress(f"pandaset: scanned {index}/{len(ids)} sequences, {len(found)} in region")
        return found

    # -- observations -------------------------------------------------------------------------

    def iter_region_observations(
        self, region: Region, *, progress: Callable[[str], None] | None = None
    ) -> Iterator[Observation]:
        for sequence in self.sequences_in(region, progress=progress):
            yield from self._sequence_observations(sequence, region, progress=progress)

    def _sequence_observations(
        self, sequence: str, region: Region, *, progress: Callable[[str], None] | None = None
    ) -> Iterator[Observation]:
        base = f"pandaset/{sequence}"
        try:
            track = self._read_json(f"{base}/meta/gps.json")
            timestamps = self._read_json(f"{base}/meta/timestamps.json")
        except (KeyError, json.JSONDecodeError) as exc:
            self.errors.append(f"{sequence}: metadata unreadable ({exc})")
            return

        record = self._sequence_record(sequence, track)
        emitted = 0
        for camera in CAMERAS:
            try:
                intrinsics = self._read_json(f"{base}/camera/{camera}/intrinsics.json")
                poses = self._read_json(f"{base}/camera/{camera}/poses.json")
            except (KeyError, json.JSONDecodeError):
                continue  # a camera absent from this sequence is ordinary
            for index, pose in enumerate(poses):
                if index >= len(track):
                    break
                fix = track[index]
                lat, lon = float(fix["lat"]), float(fix["long"])
                if not region.bbox.contains(lat, lon):
                    continue
                observation = self._to_observation(
                    sequence, camera, index, lat, lon, fix, pose, intrinsics, timestamps, record
                )
                if observation is not None:
                    emitted += 1
                    yield observation
        if progress:
            progress(f"pandaset {sequence}: {emitted} frames in region")

    def _sequence_record(self, sequence: str, track: list) -> SequenceRecord:
        existing = self._sequences.get(sequence)
        if existing is not None:
            return existing
        now = datetime.now(timezone.utc)
        lats = [float(p["lat"]) for p in track]
        lons = [float(p["long"]) for p in track]
        record = SequenceRecord(
            sequence_uid=sequence_uid(self.name, self.instance, sequence),
            provider=self.name,
            provider_instance=self.instance,
            provider_sequence_id=sequence,
            observation_count=len(track) * len(CAMERAS),
            projection_type=PROJECTION_PERSPECTIVE,
            license_id=LICENSE.identifier,
            license_url=LICENSE.url,
            attribution=LICENSE.attribution,
            south=min(lats),
            north=max(lats),
            west=min(lons),
            east=max(lons),
            first_seen_at=now,
            last_seen_at=now,
        )
        self._sequences[sequence] = record
        return record

    def _to_observation(
        self, sequence, camera, index, lat, lon, fix, pose, intrinsics, timestamps, record
    ) -> Observation | None:
        image_id = f"{sequence}/{camera}/{index:02d}"
        stamp = None
        if index < len(timestamps):
            try:
                stamp = datetime.fromtimestamp(float(timestamps[index]), tz=timezone.utc)
            except (OverflowError, OSError, ValueError):
                stamp = None
        focal = float(intrinsics.get("fx") or 0.0) or None
        now = datetime.now(timezone.utc)
        return Observation(
            observation_uid=observation_uid(self.name, self.instance, image_id),
            provider=self.name,
            provider_instance=self.instance,
            provider_image_id=image_id,
            provider_sequence_id=sequence,
            sequence_uid=record.sequence_uid,
            provider_sequence_index=index,
            captured_at=stamp,
            latitude=lat,
            longitude=lon,
            altitude=float(fix["height"]) if fix.get("height") is not None else None,
            heading_deg=_quaternion_heading(pose.get("heading") or {}),
            original_width=IMAGE_WIDTH,
            original_height=IMAGE_HEIGHT,
            original_megapixels=IMAGE_WIDTH * IMAGE_HEIGHT / 1e6,
            projection_type=PROJECTION_PERSPECTIVE,
            camera_model=camera,
            # Focal length is in pixels here, not millimetres. The 35 mm equivalent is what can
            # honestly be derived without a sensor size the dataset never states.
            focal_length_35mm=focal * 36.0 / IMAGE_WIDTH if focal else None,
            license_id=LICENSE.identifier,
            license_url=LICENSE.url,
            attribution=LICENSE.attribution,
            availability_status=AVAILABLE,
            # The heading is derived from the pose quaternion rather than measured by a compass,
            # and a consumer treating the two as interchangeable would be wrong about its errors.
            provider_metadata_version="pandaset:pose-quaternion",
            first_seen_at=now,
            last_seen_at=now,
        )

    def resolve_image(self, observation: Observation) -> ImageAsset:
        path = f"pandaset/{observation.provider_image_id}.jpg"
        try:
            self.archive.getinfo(path)
        except KeyError as exc:
            raise ObservationUnavailable(f"pandaset frame {path} is not in the archive") from exc
        return ImageAsset(
            url=f"{self._url}#{path}",
            width=IMAGE_WIDTH,
            height=IMAGE_HEIGHT,
            content_type="image/jpeg",
            role="hd",
        )

    def read_pixels(self, observation: Observation) -> bytes:
        """The JPEG itself, pulled out of the archive by range request."""
        return self.archive.read(f"pandaset/{observation.provider_image_id}.jpg")

    def get_license(self, observation: Observation | None = None) -> License:
        return LICENSE
