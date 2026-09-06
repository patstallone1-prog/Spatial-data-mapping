"""What the city recorded, kept apart from what we observed.

There is already a fact model in :mod:`smc.facts.schema`, and a municipal drawing does not fit
it. A ``WorldFact`` is either ``MEASURED`` -- which requires a contributing image observation --
or ``INFERRED``, and a right-of-way polygon recorded by ordinance in 1962 is neither. Forcing
city records through that type would either lie about their provenance or dilute what
``MEASURED`` means. :class:`~smc.facts.truth.GroundTruthFact` already set the precedent by
being a separate type; this follows it.

The distinction that matters most here is between what the city *observed* and what the city
*requires*. San Francisco publishes both in the same table: a sidewalk survey's actual widths
sit in one column and the Better Streets Plan's minimum and recommended widths sit in the next
two. A standard is not a measurement of anything, and letting one stand in for an observation
would quietly replace a 3.0 m footway with the 3.7 m somebody would like it to be.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field


class DocumentStatus(enum.StrEnum):
    """What kind of claim a document is making about the world.

    Ordered loosely from "this is what is there" to "this is what ought to be there". The
    ordering is not a licence to overwrite -- see :data:`PRECEDENCE` -- but it is the difference
    between a curb that exists and a curb somebody has drawn.
    """

    #: A survey of what is physically present. The strongest official claim.
    EXISTING_SURVEY = "existing_survey"
    #: Built and recorded as built.
    AS_BUILT = "as_built"
    #: Recorded on an official map.
    RECORDED = "recorded"
    #: Accepted into the city street system by ordinance.
    ACCEPTED = "accepted"
    #: Approved, but describing a future condition. Never a description of today.
    APPROVED_PROPOSED = "approved_proposed"
    #: A rule about what a street should be. Not an observation of any particular street.
    DESIGN_STANDARD = "design_standard"
    #: Superseded by a later record.
    HISTORIC = "historic"
    UNKNOWN = "unknown"


class OfficialFactClass(enum.StrEnum):
    """The geometry an official record can carry.

    Deliberately narrower than :class:`~smc.facts.schema.FactClass`: the city records the shape
    of the right of way, not whether a particular wheelchair can get down it.
    """

    ROADWAY_WIDTH = "roadway_width"
    SIDEWALK_WIDTH = "sidewalk_width"
    RIGHT_OF_WAY_WIDTH = "right_of_way_width"
    CURB_HEIGHT = "curb_height"
    CURB_LINE = "curb_line"
    CURB_RAMP = "curb_ramp"
    DRIVEWAY_CUT = "driveway_cut"
    PROPERTY_LINE = "property_line"
    TOP_OF_CURB_ELEVATION = "top_of_curb_elevation"
    FLOW_LINE_ELEVATION = "flow_line_elevation"
    STREET_GRADE = "street_grade"


class ExtractionMethod(enum.StrEnum):
    #: Read from a machine-readable feature service or open-data table.
    VECTOR = "vector"
    #: Parsed from text or linework in a born-digital drawing.
    TEXT = "text"
    #: Digitised from a scan that was first georeferenced from survey monuments. Pixel
    #: positions from an *un*georeferenced sheet are not coordinates and must never be treated
    #: as any.
    GEOREFERENCED_SCAN = "georeferenced_scan"
    #: Computed from other official facts -- a curb height from an aligned TC and FL, say.
    DERIVED = "derived"


#: Which source wins when two disagree, most trusted first.
#:
#: "Wins" means *ranks*, not *overwrites*. A current LiDAR measurement outranks an as-built
#: drawing because the drawing describes the day it was drawn and the LiDAR describes now --
#: but when the two disagree by more than their uncertainties, that disagreement is the finding.
#: It may mean the street was resurfaced, or the curb was rebuilt, or the record is stale, or
#: somebody's vertical datum is wrong. Collapsing it to a single number throws away the only
#: signal that any of those happened.
PRECEDENCE: tuple[str, ...] = (
    "field_observation",          # LiDAR or a survey we took ourselves, dated now
    DocumentStatus.EXISTING_SURVEY,
    DocumentStatus.AS_BUILT,
    DocumentStatus.RECORDED,
    DocumentStatus.ACCEPTED,
    DocumentStatus.APPROVED_PROPOSED,
    DocumentStatus.DESIGN_STANDARD,
    "photogrammetric",
    "inferred",
)


def rank(status: str) -> int:
    """Position in :data:`PRECEDENCE`; unknown sources sort last."""
    try:
        return PRECEDENCE.index(status)
    except ValueError:
        return len(PRECEDENCE)


@dataclass(frozen=True, slots=True)
class OfficialDocument:
    """One municipal record, identified well enough to be re-fetched and re-checked.

    ``sha256`` is over the bytes as retrieved. It is what makes the cache safe to trust and what
    lets a rerun say "this document has not changed" without a second download.
    """

    document_id: str
    record_type: str
    source_url: str
    sha256: str
    retrieved_at: str
    status: DocumentStatus = DocumentStatus.UNKNOWN
    recorded_date: str | None = None
    effective_date: str | None = None
    block_lot: str | None = None
    street_names: tuple[str, ...] = ()
    crs: str = "EPSG:4326"
    #: Whatever the publisher says about how the numbers were obtained.
    methodology: str | None = None


@dataclass(frozen=True, slots=True)
class OfficialGeometryFact:
    """One dimension or shape, from one document, at one place.

    ``value`` is in ``unit``; lengths are metres by the time they get here. The original is kept
    in ``source_value``/``source_unit`` because San Francisco records in decimal feet and a
    round 10 ft becomes an unmemorable 3.048 m -- and because a conversion is a thing that can
    be wrong, so the input to it is worth keeping.
    """

    feature_id: str
    fact_class: OfficialFactClass
    value: float | str | None
    unit: str | None
    document_id: str
    document_status: DocumentStatus
    #: ``[[lon, lat], ...]`` in WGS84. A point is a single pair, a line or ring is many.
    geometry: tuple[tuple[float, float], ...] = ()
    station_m: float | None = None
    #: ``+1`` left of the direction of travel, ``-1`` right, ``0`` both or not sided.
    side: int = 0
    page_or_sheet: str | None = None
    #: The label the document itself used: TC, FL, BW, ROW.
    source_label: str | None = None
    horizontal_sigma_m: float | None = None
    vertical_sigma_m: float | None = None
    valid_from: str | None = None
    valid_to: str | None = None
    extraction_method: ExtractionMethod = ExtractionMethod.VECTOR
    source_value: float | None = None
    source_unit: str | None = None
    flags: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_observation(self) -> bool:
        """Whether this describes a street that exists, rather than one that is required.

        The whole point of keeping the standards is to be able to say a footway is narrower
        than the plan wants. That comparison is only possible while the two stay distinct.
        """
        return self.document_status in (
            DocumentStatus.EXISTING_SURVEY,
            DocumentStatus.AS_BUILT,
            DocumentStatus.RECORDED,
            DocumentStatus.ACCEPTED,
        )


#: Survey feet to metres. San Francisco's records, and the State Plane zone they are cast in,
#: are in US survey feet, where the international foot would be wrong by two parts per million
#: -- about 6 mm over a city block, which is under our noise, and 3 m across the state, which
#: is not. Being explicit costs nothing.
US_SURVEY_FOOT_M = 1200.0 / 3937.0


def feet_to_m(value: float) -> float:
    return value * US_SURVEY_FOOT_M
