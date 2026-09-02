"""KartaView.

KartaView (formerly OpenStreetCam) is the OpenStreetMap community's own street-imagery archive.
Reads need no account and no token. Imagery is CC BY-SA 4.0.

Three endpoints carry the whole provider, and they divide along exactly the line this catalogue
cares about:

* ``POST /1.0/list/nearby-photos/`` answers "what is near here", which is how a bounding box gets
  swept. It is used for discovery only -- to learn which sequences touch the region.
* ``GET /2.0/sequence/{id}`` carries the camera: device name, focal length, field of view.
  These live on the sequence, not the frame, which is why sequences are fetched first.
* ``GET /2.0/photo/?sequenceId={id}`` carries the frames, in order, with width, height, heading,
  GPS accuracy and status.

One field is a trap worth naming. ``autoImgProcessingResult: "BLURRED"`` does not mean the
photograph is out of focus -- it means the automatic face and number-plate blurring finished.
Reading it as a quality signal would throw away most of the archive for being correctly
anonymised. The real quality fields are ``qualityLevel`` and ``qualityStatus``.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone

from smc.imagery.base import ImageAsset, License, ObservationUnavailable
from smc.imagery.http import HttpClient, PermanentError, TransientError
from smc.imagery.region import Region
from smc.imagery.schema import (
    AVAILABLE,
    PROJECTION_PERSPECTIVE,
    PROJECTION_SPHERICAL,
    PROJECTION_UNKNOWN,
    PROVIDER_DELETED,
    Observation,
    SequenceRecord,
    observation_uid,
    sequence_uid,
)

API = "https://api.openstreetcam.org"
INSTANCE = "openstreetcam.org"

LICENSE = License(
    identifier="CC-BY-SA-4.0",
    url="https://creativecommons.org/licenses/by-sa/4.0/",
    attribution="© KartaView contributors, CC BY-SA 4.0",
    share_alike=True,
)

#: The archive stores several renditions behind one templated URL. ``proc`` is the processed
#: full-resolution frame -- the one the recorded width and height describe.
_FULL = "proc"
_THUMB = "lth"

#: ``/2.0/photo/`` rejects anything above this with a bare HTTP 400 -- no message saying why.
#: The nearby-photos endpoint has no such ceiling, so the two are paged separately.
MAX_PHOTO_PAGE_SIZE = 100


def _f(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _i(value: object) -> int | None:
    f = _f(value)
    return int(f) if f is not None else None


def _s(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _when(*candidates: object) -> datetime | None:
    """First parseable timestamp among the candidates.

    KartaView reports ``shotDate`` when the camera recorded one and ``dateAdded`` always. Shot
    time is the truth about when the street looked like this; upload time can be years later.
    """
    for candidate in candidates:
        text = _s(candidate)
        if not text:
            continue
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def _projection(raw: object) -> str:
    text = (_s(raw) or "").upper()
    if text in ("PLANE", "NONE", "FLAT"):
        return PROJECTION_PERSPECTIVE
    if "SPHERE" in text or "EQUIRECT" in text or text == "360":
        return PROJECTION_SPHERICAL
    return PROJECTION_UNKNOWN


def _split_device(name: str | None) -> tuple[str | None, str | None]:
    """``"LGE LG-H815"`` -> ``("LGE", "LG-H815")``. One token means model only."""
    if not name:
        return None, None
    parts = name.split(None, 1)
    return (parts[0], parts[1]) if len(parts) == 2 else (None, parts[0])


class KartaViewProvider:
    """Metadata-first KartaView client."""

    name = "kartaview"
    instance = INSTANCE

    def __init__(
        self,
        client: HttpClient | None = None,
        *,
        api: str = API,
        page_size: int = MAX_PHOTO_PAGE_SIZE,
        discovery_page_size: int = 500,
        discovery_step_m: float = 250.0,
    ) -> None:
        self._http = client or HttpClient()
        self._api = api.rstrip("/")
        self._page_size = min(page_size, MAX_PHOTO_PAGE_SIZE)
        self._discovery_page_size = discovery_page_size
        self._step_m = discovery_step_m
        self._sequence_cache: dict[str, SequenceRecord | None] = {}
        #: Sweeps and sequences that could not be read in full. Surfaced by the audit rather
        #: than swallowed: a systematic API failure and an empty region look identical from the
        #: outside, and only one of them is a finding.
        self.errors: list[str] = []

    # -- discovery ---------------------------------------------------------------------------

    def discover_sequences(self, region: Region) -> Iterator[SequenceRecord]:
        """Sweep the box and yield every sequence that appears in it.

        The sweep radius is three-quarters of the grid step, so adjacent samples overlap at the
        corners. A radius of exactly half the step leaves diamond-shaped holes between four
        neighbouring samples, and a sequence can run straight down one.
        """
        radius_m = self._step_m * 0.8
        seen: set[str] = set()
        for lat, lon in region.bbox.grid(self._step_m):
            for sequence_id in self._sequence_ids_near(lat, lon, radius_m):
                if sequence_id in seen:
                    continue
                seen.add(sequence_id)
                record = self.get_sequence(sequence_id)
                if record is not None:
                    yield record

    def _sequence_ids_near(self, lat: float, lon: float, radius_m: float) -> set[str]:
        found: set[str] = set()
        page = 1
        while True:
            try:
                payload = self._http.post_json(
                    f"{self._api}/1.0/list/nearby-photos/",
                    {
                        "lat": f"{lat:.6f}",
                        "lng": f"{lon:.6f}",
                        "radius": int(radius_m),
                        "page": page,
                        "ipp": self._discovery_page_size,
                    },
                )
            except (TransientError, PermanentError) as exc:
                # One blind spot in a sweep is a gap in coverage, not a reason to abandon the
                # region -- but it is recorded, because an unreported gap becomes a claim about
                # the street rather than about the request.
                self.errors.append(f"sweep {lat:.5f},{lon:.5f} page {page}: {exc}")
                break
            items = payload.get("currentPageItems") or []
            for item in items:
                sequence_id = _s(item.get("sequence_id"))
                if sequence_id:
                    found.add(sequence_id)
            if len(items) < self._discovery_page_size:
                break
            page += 1
        return found

    # -- sequences ---------------------------------------------------------------------------

    def get_sequence(self, sequence_id: str) -> SequenceRecord | None:
        if sequence_id in self._sequence_cache:
            return self._sequence_cache[sequence_id]
        try:
            payload = self._http.get_json(f"{self._api}/2.0/sequence/{sequence_id}")
        except (TransientError, PermanentError):
            self._sequence_cache[sequence_id] = None
            return None

        data = (payload.get("result") or {}).get("data")
        if not isinstance(data, dict):
            self._sequence_cache[sequence_id] = None
            return None

        camera = data.get("cameraParameters") or {}
        make, model = _split_device(_s(data.get("deviceName")))
        now = datetime.now(timezone.utc)
        record = SequenceRecord(
            sequence_uid=sequence_uid(self.name, self.instance, sequence_id),
            provider=self.name,
            provider_instance=self.instance,
            provider_sequence_id=sequence_id,
            observation_count=_i(data.get("countActivePhotos")) or 0,
            camera_make=make,
            camera_model=model,
            focal_length_mm=_f(camera.get("fLen")),
            horizontal_fov=_f(camera.get("hFoV")),
            vertical_fov=_f(camera.get("vFoV")),
            projection_type=PROJECTION_SPHERICAL
            if _s(data.get("isVideo")) == "0" and _s(data.get("sequenceType")) == "360"
            else PROJECTION_UNKNOWN,
            license_id=LICENSE.identifier,
            license_url=LICENSE.url,
            attribution=LICENSE.attribution,
            contributor_identifier=_s(data.get("userId")),
            south=_f(data.get("seLat")),
            west=_f(data.get("nwLng")),
            north=_f(data.get("nwLat")),
            east=_f(data.get("seLng")),
            distance_m=(_f(data.get("distance")) or 0.0) * 1000.0 or None,
            availability_status=AVAILABLE if _s(data.get("status")) == "active" else PROVIDER_DELETED,
            first_seen_at=now,
            last_seen_at=now,
        )
        self._sequence_cache[sequence_id] = record
        return record

    # -- observations ------------------------------------------------------------------------

    def iter_observations(self, sequence_id: str) -> Iterator[Observation]:
        """Every frame of a sequence, in capture order.

        The API does not return frames in order -- a single page comes back as 4, 3, 2, 1, 9 --
        so the whole sequence is read before anything is linked. Stitching neighbours in arrival
        order would produce a trajectory that jumps backwards down the street, and every
        consumer of ``previous``/``next`` would inherit that quietly.

        Buffering is affordable because this is metadata: the longest sequences here run to a
        few thousand rows of a few hundred bytes. The memory discipline that matters is on
        decoded pixels, which this function never touches.
        """
        sequence = self.get_sequence(sequence_id)
        rows: list[dict] = []
        page = 1
        while True:
            try:
                payload = self._http.get_json(
                    f"{self._api}/2.0/photo/",
                    params={
                        "sequenceId": sequence_id,
                        "itemsPerPage": self._page_size,
                        "page": page,
                    },
                )
            except (TransientError, PermanentError) as exc:
                # Failing on the first page means the whole sequence is missing, which must not
                # be reported as "no frames here". Later pages mean a truncated sequence, which
                # is worth recording and continuing from.
                if page == 1:
                    raise
                self.errors.append(f"sequence {sequence_id} page {page}: {exc}")
                break
            result = payload.get("result") or {}
            rows.extend(result.get("data") or [])
            if not result.get("hasMoreData"):
                break
            page += 1

        observations = [o for o in (self._to_observation(r, sequence) for r in rows) if o]
        # Index first, capture time as the tie-break, and frames with neither last: an unindexed
        # frame is still real coverage, it just cannot claim a place in the trajectory.
        observations.sort(
            key=lambda o: (
                o.provider_sequence_index is None,
                o.provider_sequence_index or 0,
                o.captured_at.timestamp() if o.captured_at else 0.0,
            )
        )
        for earlier, later in zip(observations, observations[1:]):
            earlier.next_observation_id = later.observation_uid
            later.previous_observation_id = earlier.observation_uid
        yield from observations

    def _to_observation(self, row: dict, sequence: SequenceRecord | None) -> Observation | None:
        image_id = _s(row.get("id"))
        lat, lon = _f(row.get("lat")), _f(row.get("lng"))
        if not image_id or lat is None or lon is None:
            return None

        width, height = _i(row.get("width")), _i(row.get("height"))
        megapixels = (width * height / 1e6) if width and height else None
        file_url = _s(row.get("fileurl")) or ""
        camera = row.get("cameraParameters") or {}
        now = datetime.now(timezone.utc)

        return Observation(
            observation_uid=observation_uid(self.name, self.instance, image_id),
            provider=self.name,
            provider_instance=self.instance,
            provider_image_id=image_id,
            provider_sequence_id=_s(row.get("sequenceId")) or "",
            sequence_uid=sequence.sequence_uid
            if sequence
            else sequence_uid(self.name, self.instance, _s(row.get("sequenceId")) or ""),
            provider_sequence_index=_i(row.get("sequenceIndex")),
            captured_at=_when(row.get("shotDate"), row.get("dateAdded")),
            latitude=lat,
            longitude=lon,
            gps_accuracy_m=_f(row.get("gpsAccuracy")),
            heading_deg=_f(row.get("heading")),
            original_width=width,
            original_height=height,
            original_megapixels=megapixels,
            projection_type=_projection(row.get("projection")),
            camera_make=sequence.camera_make if sequence else None,
            camera_model=sequence.camera_model if sequence else None,
            focal_length_mm=_f(camera.get("fLen")) or (sequence.focal_length_mm if sequence else None),
            horizontal_fov=_f(camera.get("hFoV")) or (sequence.horizontal_fov if sequence else None),
            vertical_fov=_f(camera.get("vFoV")) or (sequence.vertical_fov if sequence else None),
            quality_score=_f(row.get("qualityLevel")),
            quality_status=_s(row.get("qualityStatus")),
            source_locator=file_url.replace("{{sizeprefix}}", _FULL) or None,
            source_preview_locator=file_url.replace("{{sizeprefix}}", _THUMB) or None,
            license_id=LICENSE.identifier,
            license_url=LICENSE.url,
            attribution=LICENSE.attribution,
            contributor_identifier=sequence.contributor_identifier if sequence else None,
            availability_status=AVAILABLE
            if _s(row.get("status")) in (None, "active")
            else PROVIDER_DELETED,
            first_seen_at=now,
            last_seen_at=now,
        )

    # -- pixels ------------------------------------------------------------------------------

    def resolve_image(self, observation: Observation) -> ImageAsset:
        """Ask the API where this frame lives now, rather than trusting a stored URL."""
        try:
            payload = self._http.get_json(
                f"{self._api}/2.0/photo/", params={"id": observation.provider_image_id}
            )
        except PermanentError as exc:
            raise ObservationUnavailable(str(exc)) from exc

        rows = (payload.get("result") or {}).get("data") or []
        row = rows[0] if isinstance(rows, list) and rows else rows if isinstance(rows, dict) else None
        if not row:
            raise ObservationUnavailable(f"kartaview photo {observation.provider_image_id} is gone")
        if _s(row.get("status")) not in (None, "active"):
            raise ObservationUnavailable(
                f"kartaview photo {observation.provider_image_id} is {_s(row.get('status'))}"
            )
        url = (_s(row.get("fileurl")) or "").replace("{{sizeprefix}}", _FULL)
        if not url:
            raise ObservationUnavailable(f"kartaview photo {observation.provider_image_id} has no URL")
        return ImageAsset(
            url=url,
            width=_i(row.get("width")),
            height=_i(row.get("height")),
            content_type="image/jpeg",
            role="hd",
        )

    def get_license(self, observation: Observation | None = None) -> License:
        return LICENSE
