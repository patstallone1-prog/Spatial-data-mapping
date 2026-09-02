"""One observation schema, whatever the provider.

The point of this module is that nothing downstream should be able to tell whether a frame came
from KartaView, Panoramax or -- later -- Mapillary. Providers differ in what they expose; they
do not differ in what a reconstruction is allowed to assume.

Two rules run through the field list:

**Missing stays missing.** No provider exposes every field. A null altitude means the provider
did not report one, and it must never be filled with a plausible guess: downstream, a fabricated
value is indistinguishable from a measured one, and it would be trusted exactly as much.

**Source truth and Kerbside estimates never share a column.** If the pipeline later recovers a
heading from the imagery, it writes ``estimated_heading`` and leaves ``heading_deg`` alone. The
original stays auditable against the provider forever.
"""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from typing import Any

import pyarrow as pa

#: Bumped when the meaning of a normalized field changes, so a refresh can tell that a stored
#: row was written by an older reader and needs re-normalizing rather than merely re-checking.
METADATA_VERSION = "1"

# ---------------------------------------------------------------------------------------------
# Controlled vocabularies. Strings rather than enums: they go straight into Parquet, where they
# dictionary-encode to a couple of bits each, and they survive a round trip through any reader.
# ---------------------------------------------------------------------------------------------

PROJECTION_PERSPECTIVE = "perspective"
PROJECTION_SPHERICAL = "spherical"
PROJECTION_UNKNOWN = "unknown"

TIER_A = "A"  # >= 12 MP, Meta-class
TIER_B = "B"  # >= 6 MP
TIER_C = "C"  # >= 2 MP
TIER_REJECT = "reject"

AVAILABLE = "available"
PROVIDER_DELETED = "provider_deleted"
TEMPORARILY_UNREACHABLE = "temporarily_unreachable"
AVAILABILITY_UNKNOWN = "unknown"


def _sha(*parts: str) -> str:
    """A deterministic id from provider identity.

    Truncated to 128 bits. The full digest would cost 64 characters in three columns --
    the observation's own id and its two neighbours -- which at half a million rows is more
    storage than every other field put together, to defend against a collision whose
    probability at this scale is around 1e-27.
    """
    key = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha256(key).hexdigest()[:32]


def observation_uid(provider: str, instance: str, image_id: str) -> str:
    return _sha(provider, instance, image_id)


def sequence_uid(provider: str, instance: str, sequence_id: str) -> str:
    return _sha(provider, instance, sequence_id)


@dataclass(slots=True)
class Observation:
    """One street-level frame, as Kerbside understands it."""

    # --- identity -----------------------------------------------------------------------
    observation_uid: str
    provider: str
    provider_instance: str
    provider_image_id: str
    provider_sequence_id: str
    sequence_uid: str
    provider_sequence_index: int | None

    # --- where and when -----------------------------------------------------------------
    captured_at: datetime | None
    latitude: float
    longitude: float
    altitude: float | None = None
    gps_accuracy_m: float | None = None

    # --- pose as the provider reported it -----------------------------------------------
    heading_deg: float | None = None
    pitch_deg: float | None = None
    roll_deg: float | None = None

    # --- the image ----------------------------------------------------------------------
    original_width: int | None = None
    original_height: int | None = None
    original_megapixels: float | None = None
    projection_type: str = PROJECTION_UNKNOWN

    # --- the camera ---------------------------------------------------------------------
    camera_make: str | None = None
    camera_model: str | None = None
    focal_length_mm: float | None = None
    focal_length_35mm: float | None = None
    horizontal_fov: float | None = None
    vertical_fov: float | None = None

    # --- provider's own judgement -------------------------------------------------------
    quality_score: float | None = None
    quality_status: str | None = None
    transport_mode: str | None = None

    # --- sequence linkage ---------------------------------------------------------------
    previous_observation_id: str | None = None
    next_observation_id: str | None = None

    # --- how to get the pixels again ----------------------------------------------------
    source_locator: str | None = None
    source_preview_locator: str | None = None

    # --- provenance, which is not optional ----------------------------------------------
    license_id: str = "unknown"
    license_url: str | None = None
    attribution: str | None = None
    contributor_identifier: str | None = None

    # --- Kerbside bookkeeping -----------------------------------------------------------
    ingested_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    provider_metadata_version: str = METADATA_VERSION
    eligible: bool = True
    rejection_reason: str | None = None
    resolution_tier: str = TIER_REJECT
    duplicate_group_id: str | None = None
    coverage_cell: str | None = None

    # --- refresh tracking ---------------------------------------------------------------
    availability_status: str = AVAILABLE
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    source_modified_at: datetime | None = None

    # --- anything Kerbside works out for itself, kept strictly apart from source truth ---
    estimated_heading: float | None = None
    estimated_pitch: float | None = None
    estimated_roll: float | None = None
    estimated_camera_height: float | None = None
    estimated_depth_scale: float | None = None

    def to_row(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class SequenceRecord:
    """A capture run: one drive, walk or ride, in order."""

    sequence_uid: str
    provider: str
    provider_instance: str
    provider_sequence_id: str
    observation_count: int = 0
    captured_at_start: datetime | None = None
    captured_at_end: datetime | None = None
    camera_make: str | None = None
    camera_model: str | None = None
    focal_length_mm: float | None = None
    horizontal_fov: float | None = None
    vertical_fov: float | None = None
    projection_type: str = PROJECTION_UNKNOWN
    transport_mode: str | None = None
    license_id: str = "unknown"
    license_url: str | None = None
    attribution: str | None = None
    contributor_identifier: str | None = None
    south: float | None = None
    west: float | None = None
    north: float | None = None
    east: float | None = None
    distance_m: float | None = None
    availability_status: str = AVAILABLE
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    provider_metadata_version: str = METADATA_VERSION

    def to_row(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------------------------
# Arrow schemas
#
# Types are chosen for size as well as correctness. Coordinates are float64 because float32
# resolves to roughly a metre at this latitude, which is the same order as the thing being
# measured. Everything else -- accuracies, headings, fields of view -- is float32, where the
# representable precision is far finer than the sensor that produced the number.
# ---------------------------------------------------------------------------------------------

_TS = pa.timestamp("ms", tz="UTC")

OBSERVATION_SCHEMA = pa.schema(
    [
        ("observation_uid", pa.string()),
        ("provider", pa.string()),
        ("provider_instance", pa.string()),
        ("provider_image_id", pa.string()),
        ("provider_sequence_id", pa.string()),
        ("sequence_uid", pa.string()),
        ("provider_sequence_index", pa.int32()),
        ("captured_at", _TS),
        ("latitude", pa.float64()),
        ("longitude", pa.float64()),
        ("altitude", pa.float32()),
        ("gps_accuracy_m", pa.float32()),
        ("heading_deg", pa.float32()),
        ("pitch_deg", pa.float32()),
        ("roll_deg", pa.float32()),
        ("original_width", pa.int32()),
        ("original_height", pa.int32()),
        ("original_megapixels", pa.float32()),
        ("projection_type", pa.string()),
        ("camera_make", pa.string()),
        ("camera_model", pa.string()),
        ("focal_length_mm", pa.float32()),
        ("focal_length_35mm", pa.float32()),
        ("horizontal_fov", pa.float32()),
        ("vertical_fov", pa.float32()),
        ("quality_score", pa.float32()),
        ("quality_status", pa.string()),
        ("transport_mode", pa.string()),
        ("previous_observation_id", pa.string()),
        ("next_observation_id", pa.string()),
        ("source_locator", pa.string()),
        ("source_preview_locator", pa.string()),
        ("license_id", pa.string()),
        ("license_url", pa.string()),
        ("attribution", pa.string()),
        ("contributor_identifier", pa.string()),
        ("ingested_at", _TS),
        ("provider_metadata_version", pa.string()),
        ("eligible", pa.bool_()),
        ("rejection_reason", pa.string()),
        ("resolution_tier", pa.string()),
        ("duplicate_group_id", pa.string()),
        ("coverage_cell", pa.string()),
        ("availability_status", pa.string()),
        ("first_seen_at", _TS),
        ("last_seen_at", _TS),
        ("source_modified_at", _TS),
        ("estimated_heading", pa.float32()),
        ("estimated_pitch", pa.float32()),
        ("estimated_roll", pa.float32()),
        ("estimated_camera_height", pa.float32()),
        ("estimated_depth_scale", pa.float32()),
    ]
)

SEQUENCE_SCHEMA = pa.schema(
    [
        ("sequence_uid", pa.string()),
        ("provider", pa.string()),
        ("provider_instance", pa.string()),
        ("provider_sequence_id", pa.string()),
        ("observation_count", pa.int32()),
        ("captured_at_start", _TS),
        ("captured_at_end", _TS),
        ("camera_make", pa.string()),
        ("camera_model", pa.string()),
        ("focal_length_mm", pa.float32()),
        ("horizontal_fov", pa.float32()),
        ("vertical_fov", pa.float32()),
        ("projection_type", pa.string()),
        ("transport_mode", pa.string()),
        ("license_id", pa.string()),
        ("license_url", pa.string()),
        ("attribution", pa.string()),
        ("contributor_identifier", pa.string()),
        ("south", pa.float64()),
        ("west", pa.float64()),
        ("north", pa.float64()),
        ("east", pa.float64()),
        ("distance_m", pa.float32()),
        ("availability_status", pa.string()),
        ("first_seen_at", _TS),
        ("last_seen_at", _TS),
        ("provider_metadata_version", pa.string()),
    ]
)

OBSERVATION_FIELDS = [f.name for f in fields(Observation)]
SEQUENCE_FIELDS = [f.name for f in fields(SequenceRecord)]

# A dataclass field the Arrow schema does not know about would be silently dropped on write,
# which is the kind of loss nobody notices until the column is needed. Fail at import instead.
_missing = set(OBSERVATION_FIELDS) - set(OBSERVATION_SCHEMA.names)
if _missing:
    raise RuntimeError(f"Observation fields absent from OBSERVATION_SCHEMA: {sorted(_missing)}")
_missing = set(SEQUENCE_FIELDS) - set(SEQUENCE_SCHEMA.names)
if _missing:
    raise RuntimeError(f"SequenceRecord fields absent from SEQUENCE_SCHEMA: {sorted(_missing)}")
