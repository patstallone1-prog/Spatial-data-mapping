"""Mapillary.

Added when the project accepted a non-commercial footing. Until then this provider was guarded:
Mapillary needs an account, cannot be self-hosted, and is run by a company that also sells
wearable cameras, so depending on it carried a platform risk Panoramax did not. That trade is
now made deliberately rather than avoided, and what it buys is coverage -- Mapillary holds far
more of most cities than either of the other two.

The Graph API is one endpoint for this purpose. ``GET /images`` takes a bounding box and returns
whole image records, so as with Panoramax the response that finds a frame also describes it and
nothing is fetched per frame. Sequences are not a separate resource worth a request: an image
carries its ``sequence`` id, and the useful sequence-level facts -- camera, creator -- are
already on the image.

Two fields deserve care. ``computed_geometry`` is Mapillary's structure-from-motion estimate and
is usually better than the raw GPS in ``geometry``; it is preferred when present and the choice
is recorded per observation rather than silently. And ``camera_type`` distinguishes a flat frame
from a 360 one, which changes what the frame can be used for downstream.
"""

from __future__ import annotations

import os
import urllib.parse
from collections.abc import Callable, Iterator
from datetime import datetime, timezone

from smc.imagery.base import ImageAsset, License, ObservationUnavailable
from smc.imagery.http import HttpClient, PermanentError, TransientError
from smc.imagery.region import BBox, Region
from smc.imagery.schema import (
    AVAILABLE,
    PROJECTION_PERSPECTIVE,
    PROJECTION_SPHERICAL,
    PROJECTION_UNKNOWN,
    Observation,
    SequenceRecord,
    observation_uid,
    sequence_uid,
)

API = "https://graph.mapillary.com"
INSTANCE = "mapillary.com"

#: The token is a Mapillary application token, made at https://www.mapillary.com/dashboard/developers.
#: It is read from the environment and never written to the catalogue.
TOKEN_ENV = "MAPILLARY_TOKEN"

LICENSE = License(
    identifier="CC-BY-SA-4.0",
    url="https://creativecommons.org/licenses/by-sa/4.0/",
    attribution="© Mapillary contributors, CC BY-SA 4.0",
    share_alike=True,
)

#: Everything worth having in one request. Asking for fewer fields does not make the call
#: cheaper in any way that matters, and a missing field costs a whole second pass.
FIELDS = (
    "id,sequence,captured_at,geometry,computed_geometry,compass_angle,computed_compass_angle,"
    "altitude,computed_altitude,camera_type,camera_parameters,width,height,make,model,"
    "quality_score,creator,exif_orientation,thumb_original_url"
)

#: Measured, not guessed. At 2000 the API answers a corridor-sized box with
#: ``"Please reduce the amount of data you're asking for"`` -- an HTTP 500 that is really a
#: quota on the response, not a fault. At 1000 it answers.
PAGE_LIMIT = 1000

#: A box returning a full page is assumed to be truncated and is split. Nine levels takes a
#: corridor down to a few metres, which is far more than any real coverage needs; the limit is
#: there so a pathological box terminates rather than recursing forever.
MAX_SUBDIVISION_DEPTH = 9

#: Boxes are split this many times before the first request. The corridor is refused outright at
#: full size and at a half and a quarter of it, so starting whole means three guaranteed failures
#: and three rounds of backoff before any data arrives.
INITIAL_SPLITS = 3


class MapillaryCredentialMissing(RuntimeError):
    """No token, which is a setup step rather than a failure of the run."""


def _s(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _f(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _i(value: object) -> int | None:
    f = _f(value)
    return int(f) if f is not None else None


def _when(value: object) -> datetime | None:
    """Mapillary reports capture time as milliseconds since the epoch, UTC."""
    millis = _f(value)
    if millis is None:
        return None
    try:
        return datetime.fromtimestamp(millis / 1000.0, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _projection(camera_type: str | None) -> str:
    text = (camera_type or "").lower()
    if text in ("spherical", "equirectangular"):
        return PROJECTION_SPHERICAL
    if text in ("perspective", "fisheye", "brown"):
        return PROJECTION_PERSPECTIVE
    return PROJECTION_UNKNOWN


def _point(feature: object) -> tuple[float, float] | None:
    if not isinstance(feature, dict):
        return None
    coordinates = feature.get("coordinates") or []
    if len(coordinates) < 2:
        return None
    lon, lat = _f(coordinates[0]), _f(coordinates[1])
    return (lat, lon) if lat is not None and lon is not None else None


class MapillaryProvider:
    """Metadata-first Mapillary client."""

    name = "mapillary"
    instance = INSTANCE

    def __init__(
        self,
        client: HttpClient | None = None,
        *,
        token: str | None = None,
        api: str = API,
        page_limit: int = PAGE_LIMIT,
    ) -> None:
        self._http = client or HttpClient()
        self._api = api.rstrip("/")
        self._page_limit = page_limit
        self._token = token or os.environ.get(TOKEN_ENV) or ""
        self._sequences: dict[str, SequenceRecord] = {}
        self.errors: list[str] = []

    @property
    def has_credential(self) -> bool:
        return bool(self._token)

    def require_credential(self) -> None:
        if not self._token:
            raise MapillaryCredentialMissing(
                f"Mapillary needs an application token in ${TOKEN_ENV}. "
                "Make one at https://www.mapillary.com/dashboard/developers and export it."
            )

    # -- search -------------------------------------------------------------------------------

    @staticmethod
    def _grid(bbox: BBox, splits: int) -> list[BBox]:
        """The box halved on both axes ``splits`` times."""
        boxes = [bbox]
        for _ in range(splits):
            out: list[BBox] = []
            for box in boxes:
                mid_lat = (box.south + box.north) / 2.0
                mid_lon = (box.west + box.east) / 2.0
                out.extend(
                    (
                        BBox(box.south, box.west, mid_lat, mid_lon),
                        BBox(box.south, mid_lon, mid_lat, box.east),
                        BBox(mid_lat, box.west, box.north, mid_lon),
                        BBox(mid_lat, mid_lon, box.north, box.east),
                    )
                )
            boxes = out
        return boxes

    def _region_images(self, bbox: BBox) -> Iterator[dict]:
        """Every image in a region, starting from boxes small enough to be answered."""
        for box in self._grid(bbox, INITIAL_SPLITS):
            yield from self._images(box, INITIAL_SPLITS)

    def _images(self, bbox: BBox, depth: int = 0) -> Iterator[dict]:
        """Every image in a box, subdividing when a box comes back full.

        The API pages with a cursor, and following it is preferred to splitting -- a cursor walk
        returns every frame once, where a split has to reconcile frames that sit on a shared
        edge. Splitting is the fallback for a box that returns a full page with no cursor, which
        is how this API says "there is more here" when it will not say how much.
        """
        url = (
            f"{self._api}/images?"
            + urllib.parse.urlencode(
                {
                    "access_token": self._token,
                    "fields": FIELDS,
                    "bbox": f"{bbox.west},{bbox.south},{bbox.east},{bbox.north}",
                    "limit": self._page_limit,
                }
            )
        )
        seen_here = 0
        refused = False
        while url:
            try:
                payload = self._http.get_json(url)
            except (TransientError, PermanentError) as exc:
                # A refusal is usually the response-size quota rather than a real failure, and
                # the remedy for that is a smaller box -- so it falls through to the split below
                # instead of abandoning the area. Recording it and giving up here was how an
                # earlier version reported a densely-covered downtown as empty.
                if depth < MAX_SUBDIVISION_DEPTH:
                    refused = True
                    break
                self.errors.append(f"images {bbox.as_stac()}: {exc}")
                return
            data = payload.get("data") or []
            seen_here += len(data)
            yield from (row for row in data if isinstance(row, dict))
            following = ((payload.get("paging") or {}).get("next")) or None
            url = _s(following)

        if not refused:
            # A completed cursor walk has already returned every frame in this box -- that is
            # what the cursor is for. Splitting anyway, on the theory that a large result means a
            # truncated one, re-requests the same area four times over at every level and turns a
            # dense downtown box into thousands of redundant requests. Only a refusal, where the
            # server declined to answer at all, means anything is still unseen.
            return
        if depth >= MAX_SUBDIVISION_DEPTH:
            self.errors.append(
                f"images {bbox.as_stac()}: refused even at maximum subdivision; "
                f"coverage here may be incomplete"
            )
            return

        mid_lat = (bbox.south + bbox.north) / 2.0
        mid_lon = (bbox.west + bbox.east) / 2.0
        for quadrant in (
            BBox(bbox.south, bbox.west, mid_lat, mid_lon),
            BBox(bbox.south, mid_lon, mid_lat, bbox.east),
            BBox(mid_lat, bbox.west, bbox.north, mid_lon),
            BBox(mid_lat, mid_lon, bbox.north, bbox.east),
        ):
            yield from self._images(quadrant, depth + 1)

    # -- catalogue ----------------------------------------------------------------------------

    def iter_region_observations(
        self, region: Region, *, progress: Callable[[str], None] | None = None
    ) -> Iterator[Observation]:
        self.require_credential()
        seen: set[str] = set()
        kept = 0
        for row in self._region_images(region.bbox):
            image_id = _s(row.get("id"))
            if not image_id or image_id in seen:
                continue
            seen.add(image_id)
            observation = self._to_observation(row)
            if observation is None:
                continue
            if not region.bbox.contains(observation.latitude, observation.longitude):
                continue
            kept += 1
            if progress and kept % 500 == 0:
                progress(f"mapillary: {kept} frames inside the box")
            yield observation
        if progress:
            progress(f"mapillary: {kept} frames inside the box")

    def discover_sequences(self, region: Region) -> Iterator[SequenceRecord]:
        for _ in self.iter_region_observations(region):
            pass
        yield from self._sequences.values()

    def get_sequence(self, sequence_id: str) -> SequenceRecord | None:
        return self._sequences.get(sequence_id)

    def _record_sequence(self, row: dict, sequence_id: str) -> SequenceRecord:
        existing = self._sequences.get(sequence_id)
        if existing is not None:
            existing.observation_count += 1
            return existing
        now = datetime.now(timezone.utc)
        record = SequenceRecord(
            sequence_uid=sequence_uid(self.name, self.instance, sequence_id),
            provider=self.name,
            provider_instance=self.instance,
            provider_sequence_id=sequence_id,
            observation_count=1,
            camera_make=_s(row.get("make")),
            camera_model=_s(row.get("model")),
            projection_type=_projection(_s(row.get("camera_type"))),
            license_id=LICENSE.identifier,
            license_url=LICENSE.url,
            attribution=LICENSE.attribution,
            contributor_identifier=_s((row.get("creator") or {}).get("id")),
            first_seen_at=now,
            last_seen_at=now,
        )
        self._sequences[sequence_id] = record
        return record

    def _to_observation(self, row: dict) -> Observation | None:
        image_id = _s(row.get("id"))
        if not image_id:
            return None

        # The structure-from-motion position is normally better than the raw GPS, and where it
        # exists it is the one worth keeping. Which was used is recorded, because a catalogue
        # that mixes the two without saying so cannot be reasoned about later.
        computed = _point(row.get("computed_geometry"))
        raw = _point(row.get("geometry"))
        position, source = (
            (computed, "mapillary:sfm") if computed else (raw, "mapillary:gps")
        )
        if position is None:
            return None
        lat, lon = position

        width, height = _i(row.get("width")), _i(row.get("height"))
        megapixels = (width * height / 1e6) if width and height else None
        sequence_id = _s(row.get("sequence")) or ""
        sequence = self._record_sequence(row, sequence_id) if sequence_id else None

        parameters = row.get("camera_parameters") or []
        focal_normalised = _f(parameters[0]) if len(parameters) else None
        # Mapillary reports focal length as a fraction of the larger image dimension. Turning it
        # into millimetres would need a sensor size the API does not give, so the 35 mm
        # equivalent is what can honestly be derived: 36 mm is the long side of a full frame.
        focal_35mm = focal_normalised * 36.0 if focal_normalised else None

        now = datetime.now(timezone.utc)
        return Observation(
            observation_uid=observation_uid(self.name, self.instance, image_id),
            provider=self.name,
            provider_instance=self.instance,
            provider_image_id=image_id,
            provider_sequence_id=sequence_id,
            # Mapillary does not publish a rank within the sequence. Capture time orders the
            # frames instead, and inventing an index would make an ordering look authoritative
            # that the provider never asserted.
            provider_sequence_index=None,
            sequence_uid=sequence.sequence_uid
            if sequence
            else sequence_uid(self.name, self.instance, sequence_id),
            captured_at=_when(row.get("captured_at")),
            latitude=lat,
            longitude=lon,
            altitude=_f(row.get("computed_altitude")) or _f(row.get("altitude")),
            heading_deg=_f(row.get("computed_compass_angle")) or _f(row.get("compass_angle")),
            original_width=width,
            original_height=height,
            original_megapixels=megapixels,
            projection_type=_projection(_s(row.get("camera_type"))),
            camera_make=_s(row.get("make")),
            camera_model=_s(row.get("model")),
            focal_length_35mm=focal_35mm,
            quality_score=_f(row.get("quality_score")),
            license_id=LICENSE.identifier,
            license_url=LICENSE.url,
            attribution=LICENSE.attribution,
            contributor_identifier=_s((row.get("creator") or {}).get("id")),
            availability_status=AVAILABLE,
            estimated_heading=_f(row.get("computed_compass_angle")),
            provider_metadata_version=source,
            first_seen_at=now,
            last_seen_at=now,
        )

    # -- pixels -------------------------------------------------------------------------------

    def resolve_image(self, observation: Observation) -> ImageAsset:
        self.require_credential()
        url = (
            f"{self._api}/{observation.provider_image_id}?"
            + urllib.parse.urlencode(
                {"access_token": self._token, "fields": "thumb_original_url,width,height"}
            )
        )
        try:
            payload = self._http.get_json(url)
        except (TransientError, PermanentError) as exc:
            raise ObservationUnavailable(str(exc)) from exc
        href = _s(payload.get("thumb_original_url"))
        if not href:
            raise ObservationUnavailable(f"mapillary image {observation.provider_image_id} has no URL")
        return ImageAsset(
            url=href,
            width=_i(payload.get("width")),
            height=_i(payload.get("height")),
            content_type="image/jpeg",
            role="hd",
        )

    def get_license(self, observation: Observation | None = None) -> License:
        return LICENSE
