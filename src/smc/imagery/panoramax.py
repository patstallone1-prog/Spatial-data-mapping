"""Panoramax.

Panoramax is street-level imagery run by IGN, the French national mapping agency, with
OpenStreetMap France. Reads need no account and no token, the server is MIT-licensed, and the
API is standard STAC rather than a proprietary graph.

It is also federated, and that shapes two decisions here.

The first is identity. An item served by ``api.panoramax.xyz`` may physically live on another
instance, named in its ``via`` link. ``provider_instance`` records the API actually queried
rather than that origin, because it is always present and it is where ``resolve_image`` goes
back to; the origin instance is preserved in the attribution string instead, where §18 needs it.
Deriving a permanent id from a field that can be absent would mean the same photograph changing
identity between runs.

The second is licensing. Federation means two items in one search response can carry different
licences, so the licence is read per item and never assumed from the provider.

Search paging deserves a note. This API ignores ``page`` and returns no ``next`` link on
``/search``, so a naive high limit silently truncates. Completeness comes from subdividing the
box instead: a tile that returns exactly its limit is assumed to have been cut off and is split.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import datetime

from smc.imagery.base import ImageAsset, License, ObservationUnavailable
from smc.imagery.http import HttpClient, PermanentError, TransientError
from smc.imagery.region import BBox, Region
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

DEFAULT_ENDPOINT = "https://api.panoramax.xyz/api"

#: Per-tile ceiling for a search. Well above the density of any tile this splitter produces, so
#: hitting it is the signal to subdivide rather than a normal outcome.
SEARCH_LIMIT = 2000

#: Guard against a pathological split. At depth 6 a corridor tile is roughly 80 m across.
MAX_SUBDIVISION_DEPTH = 6

_LICENSE_URLS = {
    "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "etalab-2.0": "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
}


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


def _rational(value: object) -> float | None:
    """EXIF stores numbers as ``"1234/10"``. Anything else is left alone."""
    text = _s(value)
    if text is None:
        return None
    if "/" in text:
        numerator, _, denominator = text.partition("/")
        num, den = _f(numerator), _f(denominator)
        return num / den if num is not None and den else None
    return _f(text)


def _when(value: object) -> datetime | None:
    text = _s(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _link(item: dict, rel: str) -> dict | None:
    for link in item.get("links") or []:
        if link.get("rel") == rel:
            return link
    return None


class PanoramaxProvider:
    """Metadata-first Panoramax client. No credential required."""

    name = "panoramax"

    def __init__(
        self,
        client: HttpClient | None = None,
        *,
        endpoint: str = DEFAULT_ENDPOINT,
        search_limit: int = SEARCH_LIMIT,
    ) -> None:
        self._http = client or HttpClient()
        self._endpoint = endpoint.rstrip("/")
        self._search_limit = search_limit
        self.instance = self._endpoint.split("//", 1)[-1].split("/", 1)[0]
        self._collection_cache: dict[str, SequenceRecord | None] = {}
        self.errors: list[str] = []

    # -- discovery ---------------------------------------------------------------------------

    def discover_sequences(self, region: Region) -> Iterator[SequenceRecord]:
        seen: set[str] = set()
        for item in self._search(region.bbox):
            collection_id = _s(item.get("collection"))
            if not collection_id or collection_id in seen:
                continue
            seen.add(collection_id)
            record = self.get_sequence(collection_id)
            if record is not None:
                yield record

    def iter_region_observations(
        self, region: Region, *, progress: Callable[[str], None] | None = None
    ) -> Iterator[Observation]:
        """Every frame inside the box, built from the search result itself.

        ``/search`` returns whole STAC items -- geometry, EXIF, interior orientation, licence --
        so the response that locates a frame already describes it. Going back to
        ``/collections/{id}/items`` for the same frames would cost a page of requests per
        sequence and drag in every frame outside the region on the way. Only the sequence
        record is fetched separately, once per collection, and it is cached.
        """
        seen: set[str] = set()
        kept = 0
        for item in self._search(region.bbox):
            image_id = _s(item.get("id"))
            if not image_id or image_id in seen:
                continue
            seen.add(image_id)
            coordinates = (item.get("geometry") or {}).get("coordinates") or []
            if len(coordinates) < 2:
                continue
            lon, lat = _f(coordinates[0]), _f(coordinates[1])
            if lat is None or lon is None or not region.bbox.contains(lat, lon):
                continue
            collection_id = _s(item.get("collection"))
            sequence = self.get_sequence(collection_id) if collection_id else None
            observation = self._to_observation(item, sequence)
            if observation is None:
                continue
            kept += 1
            if progress and kept % 500 == 0:
                progress(f"panoramax: {kept} frames inside the box")
            yield observation
        if progress:
            progress(f"panoramax: {kept} frames inside the box")

    def _search(self, bbox: BBox, depth: int = 0) -> Iterator[dict]:
        """Every item in a box, subdividing when a tile comes back full."""
        try:
            payload = self._http.get_json(
                f"{self._endpoint}/search",
                params={"bbox": bbox.as_stac(), "limit": self._search_limit},
            )
        except (TransientError, PermanentError) as exc:
            self.errors.append(f"search {bbox.as_stac()}: {exc}")
            return

        features = payload.get("features") or []
        if len(features) < self._search_limit or depth >= MAX_SUBDIVISION_DEPTH:
            if len(features) >= self._search_limit:
                self.errors.append(
                    f"search {bbox.as_stac()}: still full at maximum subdivision; "
                    f"coverage here may be incomplete"
                )
            yield from features
            return

        mid_lat = (bbox.south + bbox.north) / 2.0
        mid_lon = (bbox.west + bbox.east) / 2.0
        quadrants = (
            BBox(bbox.south, bbox.west, mid_lat, mid_lon),
            BBox(bbox.south, mid_lon, mid_lat, bbox.east),
            BBox(mid_lat, bbox.west, bbox.north, mid_lon),
            BBox(mid_lat, mid_lon, bbox.north, bbox.east),
        )
        # A frame exactly on a shared edge appears in two quadrants. Deduplicating by id here
        # keeps that from becoming two catalogue rows for one photograph.
        emitted: set[str] = set()
        for quadrant in quadrants:
            for feature in self._search(quadrant, depth + 1):
                key = _s(feature.get("id"))
                if key and key in emitted:
                    continue
                if key:
                    emitted.add(key)
                yield feature

    # -- sequences ---------------------------------------------------------------------------

    def get_sequence(self, sequence_id: str) -> SequenceRecord | None:
        if sequence_id in self._collection_cache:
            return self._collection_cache[sequence_id]
        try:
            data = self._http.get_json(f"{self._endpoint}/collections/{sequence_id}")
        except (TransientError, PermanentError) as exc:
            self.errors.append(f"collection {sequence_id}: {exc}")
            self._collection_cache[sequence_id] = None
            return None

        license_id = _s(data.get("license")) or "unknown"
        producers = [
            _s(p.get("name")) for p in (data.get("providers") or []) if "producer" in (p.get("roles") or [])
        ]
        producer = next((p for p in producers if p), None)
        extent = ((data.get("extent") or {}).get("spatial") or {}).get("bbox") or [[None] * 4]
        west, south, east, north = (extent[0] + [None] * 4)[:4]
        interval = ((data.get("extent") or {}).get("temporal") or {}).get("interval") or [[None, None]]
        start, end = (interval[0] + [None, None])[:2]
        now = datetime.now(tz=_UTC)

        record = SequenceRecord(
            sequence_uid=sequence_uid(self.name, self.instance, sequence_id),
            provider=self.name,
            provider_instance=self.instance,
            provider_sequence_id=sequence_id,
            observation_count=_i((data.get("stats:items") or {}).get("count")) or 0,
            captured_at_start=_when(start),
            captured_at_end=_when(end),
            license_id=license_id,
            license_url=_LICENSE_URLS.get(license_id),
            attribution=self._attribution(producer, None, license_id),
            contributor_identifier=producer,
            south=_f(south),
            west=_f(west),
            north=_f(north),
            east=_f(east),
            distance_m=(_f(data.get("geovisio:length_km")) or 0.0) * 1000.0 or None,
            first_seen_at=now,
            last_seen_at=now,
        )
        self._collection_cache[sequence_id] = record
        return record

    @staticmethod
    def _attribution(producer: str | None, origin_instance: str | None, license_id: str) -> str:
        who = producer or "Panoramax contributors"
        where = f" via {origin_instance}" if origin_instance else ""
        return f"© {who}{where}, {license_id}"

    # -- observations ------------------------------------------------------------------------

    def iter_observations(self, sequence_id: str) -> Iterator[Observation]:
        """Every frame of a collection, in rank order.

        Unlike the search endpoint, ``/items`` does paginate properly -- it returns a cursor in
        a ``next`` link -- and it returns frames already in rank order. They are still sorted
        before linking, because relying on a server's ordering for the neighbour chain means a
        change upstream would silently reverse a trajectory.
        """
        url: str | None = f"{self._endpoint}/collections/{sequence_id}/items?limit=1000"
        features: list[dict] = []
        first = True
        while url:
            try:
                payload = self._http.get_json(url)
            except (TransientError, PermanentError) as exc:
                if first:
                    raise
                self.errors.append(f"collection {sequence_id} items: {exc}")
                break
            first = False
            features.extend(payload.get("features") or [])
            following = _link(payload, "next")
            url = _s(following.get("href")) if following else None

        sequence = self.get_sequence(sequence_id)
        observations = [o for o in (self._to_observation(f, sequence) for f in features) if o]
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

    def _to_observation(self, item: dict, sequence: SequenceRecord | None) -> Observation | None:
        image_id = _s(item.get("id"))
        coordinates = (item.get("geometry") or {}).get("coordinates") or []
        if not image_id or len(coordinates) < 2:
            return None
        lon, lat = _f(coordinates[0]), _f(coordinates[1])
        if lat is None or lon is None:
            return None

        properties = item.get("properties") or {}
        exif = properties.get("exif") or {}
        interior = properties.get("pers:interior_orientation") or {}
        assets = item.get("assets") or {}

        dimensions = interior.get("sensor_array_dimensions") or []
        width = _i(dimensions[0]) if len(dimensions) > 0 else _i(exif.get("Exif.Photo.PixelXDimension"))
        height = _i(dimensions[1]) if len(dimensions) > 1 else _i(exif.get("Exif.Photo.PixelYDimension"))
        megapixels = (width * height / 1e6) if width and height else None

        fov = _f(interior.get("field_of_view"))
        if fov is not None and fov >= 300:
            projection = PROJECTION_SPHERICAL
        elif fov is not None:
            projection = PROJECTION_PERSPECTIVE
        else:
            projection = PROJECTION_UNKNOWN

        license_id = _s(properties.get("license")) or (sequence.license_id if sequence else "unknown")
        license_link = _link(item, "license")
        via = _link(item, "via")
        origin = _s((via or {}).get("instance_name"))
        producer = _s(properties.get("geovisio:producer")) or (
            sequence.contributor_identifier if sequence else None
        )

        altitude = _rational(exif.get("Exif.GPSInfo.GPSAltitude"))
        if altitude is not None and _s(exif.get("Exif.GPSInfo.GPSAltitudeRef")) == "1":
            altitude = -altitude  # below sea level, per the EXIF reference flag

        now = datetime.now(tz=_UTC)
        return Observation(
            observation_uid=observation_uid(self.name, self.instance, image_id),
            provider=self.name,
            provider_instance=self.instance,
            provider_image_id=image_id,
            provider_sequence_id=_s(item.get("collection")) or "",
            sequence_uid=sequence.sequence_uid
            if sequence
            else sequence_uid(self.name, self.instance, _s(item.get("collection")) or ""),
            provider_sequence_index=_i(properties.get("geovisio:rank_in_collection")),
            captured_at=_when(properties.get("datetime")),
            latitude=lat,
            longitude=lon,
            altitude=altitude,
            gps_accuracy_m=_f(properties.get("quality:horizontal_accuracy")),
            heading_deg=_f(properties.get("view:azimuth")) if properties.get("view:azimuth") is not None
            else _f(properties.get("pers:yaw")),
            pitch_deg=_f(properties.get("pers:pitch")),
            roll_deg=_f(properties.get("pers:roll")),
            original_width=width,
            original_height=height,
            original_megapixels=megapixels,
            projection_type=projection,
            camera_make=_s(interior.get("camera_manufacturer")) or _s(exif.get("Exif.Image.Make")),
            camera_model=_s(interior.get("camera_model")) or _s(exif.get("Exif.Image.Model")),
            focal_length_mm=_f(interior.get("focal_length")),
            horizontal_fov=fov if projection == PROJECTION_PERSPECTIVE else None,
            source_locator=_s((assets.get("hd") or {}).get("href"))
            or _s(properties.get("geovisio:image")),
            source_preview_locator=_s((assets.get("sd") or {}).get("href"))
            or _s((assets.get("thumb") or {}).get("href")),
            license_id=license_id,
            license_url=_s((license_link or {}).get("href")) or _LICENSE_URLS.get(license_id),
            attribution=self._attribution(producer, origin, license_id),
            contributor_identifier=producer,
            availability_status=AVAILABLE
            if _s(properties.get("geovisio:status")) in (None, "ready")
            else PROVIDER_DELETED,
            first_seen_at=now,
            last_seen_at=now,
        )

    # -- pixels ------------------------------------------------------------------------------

    def resolve_image(self, observation: Observation) -> ImageAsset:
        url = (
            f"{self._endpoint}/collections/{observation.provider_sequence_id}"
            f"/items/{observation.provider_image_id}"
        )
        try:
            item = self._http.get_json(url)
        except PermanentError as exc:
            raise ObservationUnavailable(str(exc)) from exc

        assets = item.get("assets") or {}
        href = _s((assets.get("hd") or {}).get("href"))
        if not href:
            raise ObservationUnavailable(
                f"panoramax item {observation.provider_image_id} has no full-resolution asset"
            )
        interior = (item.get("properties") or {}).get("pers:interior_orientation") or {}
        dimensions = interior.get("sensor_array_dimensions") or []
        return ImageAsset(
            url=href,
            width=_i(dimensions[0]) if len(dimensions) > 0 else None,
            height=_i(dimensions[1]) if len(dimensions) > 1 else None,
            content_type=_s((assets.get("hd") or {}).get("type")) or "image/jpeg",
            role="hd",
        )

    def get_license(self, observation: Observation | None = None) -> License:
        if observation is None:
            return License("CC-BY-SA-4.0", _LICENSE_URLS["CC-BY-SA-4.0"], "© Panoramax contributors")
        return License(
            identifier=observation.license_id,
            url=observation.license_url,
            attribution=observation.attribution,
            share_alike="SA" in observation.license_id.upper(),
        )


from datetime import timezone as _tz  # noqa: E402  (placed after use for readability above)

_UTC = _tz.utc
