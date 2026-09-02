"""KartaView.

KartaView (formerly OpenStreetCam) is the OpenStreetMap community's own street-imagery archive.
Reads need no account and no token. Imagery is CC BY-SA 4.0.

Three endpoints carry the whole provider, and they divide along exactly the line this catalogue
cares about:

* ``POST /1.0/list/nearby-photos/`` answers "what is near here", which is how a bounding box gets
  swept. It locates frames but does not describe them: the rows carry no width or height.
* ``GET /2.0/sequence/{id}`` carries the camera: device name, focal length, field of view.
  These live on the sequence, not the frame, which is why sequences are fetched first.
* ``GET /2.0/photo/`` carries the frames themselves -- width, height, heading, GPS accuracy and
  status -- either a sequence at a time via ``?sequenceId=`` or a hundred known ids at a time
  via ``?id=a,b,c``. Bounded-region work wants the second: a sequence is a whole drive, and
  reading one whole to reach the block of it that crosses the region spends almost every
  request on frames that are then discarded.

One field is a trap worth naming. ``autoImgProcessingResult: "BLURRED"`` does not mean the
photograph is out of focus -- it means the automatic face and number-plate blurring finished.
Reading it as a quality signal would throw away most of the archive for being correctly
anonymised. The real quality fields are ``qualityLevel`` and ``qualityStatus``.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
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

#: ``/2.0/photo/?id=`` takes a comma-separated list and answers for all of them at once. It
#: silently truncates to the same hundred rows as a page, so asking for more loses frames
#: without saying so. A hundred at a time is the whole reason a region sweep is affordable:
#: the resolution of ten thousand frames costs a hundred requests rather than ten thousand.
MAX_PHOTO_ID_BATCH = 100


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
        max_photo_pages: int | None = 25,
        max_workers: int = 1,
    ) -> None:
        self._http = client or HttpClient()
        self._api = api.rstrip("/")
        self._page_size = min(page_size, MAX_PHOTO_PAGE_SIZE)
        self._discovery_page_size = discovery_page_size
        self._step_m = discovery_step_m
        self._max_photo_pages = max_photo_pages
        self._max_workers = max(1, max_workers)
        self._sequence_cache: dict[str, SequenceRecord | None] = {}
        self._local = threading.local()
        self._worker_clients: list[HttpClient] = []
        self._lock = threading.Lock()
        #: Sweeps and sequences that could not be read in full. Surfaced by the audit rather
        #: than swallowed: a systematic API failure and an empty region look identical from the
        #: outside, and only one of them is a finding.
        self.errors: list[str] = []

    @property
    def _client(self) -> HttpClient:
        """The client belonging to the calling thread.

        A sweep of a few square miles is hundreds of requests that each wait on the network far
        longer than they compute, so running several at once is most of the difference between
        minutes and hours. HttpClient cannot be shared to do that: its rate limiter and its
        counters are plain attributes, and concurrent use would corrupt both while quietly
        defeating the minimum interval it exists to enforce. One client per thread keeps that
        interval honest per connection, and the settings are copied so politeness is not
        something a caller has to remember to re-specify.
        """
        if self._max_workers == 1:
            return self._http
        client = getattr(self._local, "client", None)
        if client is None:
            client = replace(self._http)
            self._local.client = client
            with self._lock:
                self._worker_clients.append(client)
        return client

    def _record_error(self, message: str) -> None:
        with self._lock:
            self.errors.append(message)

    @property
    def request_count(self) -> int:
        return self._http.requests_made + sum(c.requests_made for c in self._worker_clients)

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
        return {
            sequence_id
            for row in self._photos_near(lat, lon, radius_m)
            if (sequence_id := _s(row.get("sequence_id")))
        }

    def _photos_near(self, lat: float, lon: float, radius_m: float) -> list[dict]:
        """Every nearby-photos row around one sample point.

        The rows carry position, heading, sequence and capture time but no width or height, so
        they locate frames without describing them. Resolution is bought separately.
        """
        rows: list[dict] = []
        page = 1
        while True:
            try:
                payload = self._client.post_json(
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
                self._record_error(f"sweep {lat:.5f},{lon:.5f} page {page}: {exc}")
                break
            items = payload.get("currentPageItems") or []
            rows.extend(item for item in items if isinstance(item, dict))
            if len(items) < self._discovery_page_size:
                break
            page += 1
        return rows

    # -- region sweep ------------------------------------------------------------------------

    def iter_region_observations(
        self, region: Region, *, progress: Callable[[str], None] | None = None
    ) -> Iterator[Observation]:
        """Every frame the archive holds inside the box.

        Sequence-shaped ingestion reads a whole drive in order to reach the part of it that
        crosses the region, and a KartaView drive routinely spans a city: nearly every request
        is spent on frames that will be discarded, and a run gets cut off on time long before
        the region is covered. Asking instead what is at each place returns the answer directly,
        and the one thing that answer omits -- width and height -- is then bought a hundred
        frames per request.
        """
        stubs = self._sweep(region, progress=progress)
        if progress:
            progress(f"kartaview: {len(stubs)} frames inside the box")

        rows = self._photo_details(sorted(stubs), progress=progress)

        # Ahead of the row loop rather than inside it. One request per distinct sequence, and a
        # corridor touches hundreds; done lazily and one at a time this is by far the longest
        # phase of a harvest, and every second of it is spent waiting on the network.
        self._prefetch_sequences(
            sorted({sid for row in rows if (sid := _s(row.get("sequenceId")))}), progress=progress
        )

        by_sequence: dict[str, list[Observation]] = {}
        for row in rows:
            sequence_id = _s(row.get("sequenceId")) or _s(stubs.get(_s(row.get("id")), {}).get("sequence_id"))
            sequence = self.get_sequence(sequence_id) if sequence_id else None
            observation = self._to_observation(row, sequence)
            if observation is None:
                continue
            by_sequence.setdefault(sequence_id or "", []).append(observation)

        for observations in by_sequence.values():
            observations.sort(
                key=lambda o: (
                    o.provider_sequence_index is None,
                    o.provider_sequence_index or 0,
                    o.captured_at.timestamp() if o.captured_at else 0.0,
                )
            )
            # The chain links in-region frames only. Where a drive leaves the box and comes
            # back, consecutive links span that absence: this is the neighbour order of the
            # catalogue, not of the original drive, and a consumer walking it is walking
            # coverage rather than a trajectory.
            for earlier, later in zip(observations, observations[1:]):
                earlier.next_observation_id = later.observation_uid
                later.previous_observation_id = earlier.observation_uid
            yield from observations

    def _prefetch_sequences(
        self, sequence_ids: list[str], *, progress: Callable[[str], None] | None = None
    ) -> None:
        """Fill the sequence cache, several at a time where that is allowed."""
        missing = [sid for sid in sequence_ids if sid not in self._sequence_cache]
        if not missing:
            return
        if self._max_workers == 1:
            results: object = (self.get_sequence(sid) for sid in missing)
        else:
            pool = ThreadPoolExecutor(max_workers=self._max_workers)
            results = pool.map(self.get_sequence, missing)
        for index, _ in enumerate(results, start=1):
            if progress and (index % 50 == 0 or index == len(missing)):
                progress(f"kartaview sequences {index}/{len(missing)}")
        if self._max_workers > 1:
            pool.shutdown()

    def _sweep(
        self, region: Region, *, progress: Callable[[str], None] | None = None
    ) -> dict[str, dict]:
        """Sample the box on a grid and keep every distinct frame that lands inside it.

        The radius is four-fifths of the step so neighbouring samples overlap at the corners.
        At exactly half the step, four adjacent samples leave a diamond-shaped hole between
        them, and a street can run straight down one.
        """
        radius_m = self._step_m * 0.8
        points = region.bbox.grid(self._step_m)
        found: dict[str, dict] = {}

        def keep(rows: list[dict]) -> None:
            for row in rows:
                photo_id = _s(row.get("id"))
                if not photo_id or photo_id in found:
                    continue
                plat, plon = _f(row.get("lat")), _f(row.get("lng"))
                if plat is None or plon is None or not region.bbox.contains(plat, plon):
                    continue
                found[photo_id] = row

        if self._max_workers == 1:
            results = (self._photos_near(lat, lon, radius_m) for lat, lon in points)
        else:
            pool = ThreadPoolExecutor(max_workers=self._max_workers)
            results = pool.map(lambda point: self._photos_near(point[0], point[1], radius_m), points)

        # Collected on this thread rather than in the workers, so the dictionary needs no lock
        # and the sweep order stays the grid order regardless of which request finished first.
        for index, rows in enumerate(results, start=1):
            keep(rows)
            if progress and (index % 25 == 0 or index == len(points)):
                progress(f"kartaview sweep {index}/{len(points)} points, {len(found)} frames")
        if self._max_workers > 1:
            pool.shutdown()
        return found

    def _photo_details(
        self, image_ids: list[str], *, progress: Callable[[str], None] | None = None
    ) -> list[dict]:
        """Full photo rows for known ids, a hundred per request."""
        batches = [
            image_ids[start : start + MAX_PHOTO_ID_BATCH]
            for start in range(0, len(image_ids), MAX_PHOTO_ID_BATCH)
        ]

        def fetch(batch: list[str]) -> list[dict]:
            try:
                payload = self._client.get_json(
                    f"{self._api}/2.0/photo/", params={"id": ",".join(batch)}
                )
            except (TransientError, PermanentError) as exc:
                self._record_error(f"photo details {batch[0]}..{batch[-1]}: {exc}")
                return []
            data = (payload.get("result") or {}).get("data") or []
            return [row for row in data if isinstance(row, dict)]

        if self._max_workers == 1:
            results = (fetch(batch) for batch in batches)
        else:
            pool = ThreadPoolExecutor(max_workers=self._max_workers)
            results = pool.map(fetch, batches)

        rows: list[dict] = []
        done = 0
        for batch, batch_rows in zip(batches, results):
            rows.extend(batch_rows)
            done += len(batch)
            if progress and (done % (MAX_PHOTO_ID_BATCH * 10) == 0 or done == len(image_ids)):
                progress(f"kartaview details {done}/{len(image_ids)}")
        if self._max_workers > 1:
            pool.shutdown()
        return rows

    # -- sequences ---------------------------------------------------------------------------

    def get_sequence(self, sequence_id: str) -> SequenceRecord | None:
        if sequence_id in self._sequence_cache:
            return self._sequence_cache[sequence_id]
        try:
            payload = self._client.get_json(f"{self._api}/2.0/sequence/{sequence_id}")
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
            if self._max_photo_pages is not None and page >= self._max_photo_pages:
                self.errors.append(
                    f"sequence {sequence_id}: stopped after {self._max_photo_pages} photo pages"
                )
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
