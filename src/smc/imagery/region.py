"""Bounded regions, and the first one.

A region is a bounding box with a name. Ingestion is always scoped to one, and never widens
itself: a run that quietly crawled outside its box would produce a catalogue nobody could
reason about, and the storage estimates that justify committing this metadata to Git all
assume a known area.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

#: Mean Earth radius, metres. Local work here is well inside the range where a sphere is fine.
EARTH_RADIUS_M = 6_371_000.0


@dataclass(frozen=True, slots=True)
class BBox:
    """A latitude/longitude rectangle, in degrees."""

    south: float
    west: float
    north: float
    east: float

    def __post_init__(self) -> None:
        if not -90.0 <= self.south < self.north <= 90.0:
            raise ValueError(f"latitudes out of order or out of range: {self.south}..{self.north}")
        if not -180.0 <= self.west < self.east <= 180.0:
            raise ValueError(f"longitudes out of order or out of range: {self.west}..{self.east}")

    def contains(self, lat: float, lon: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lon <= self.east

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.south + self.north) / 2.0, (self.west + self.east) / 2.0)

    @property
    def height_m(self) -> float:
        return math.radians(self.north - self.south) * EARTH_RADIUS_M

    @property
    def width_m(self) -> float:
        """Width at the mid-latitude, which is what a person means by "how wide is it"."""
        lat, _ = self.centre
        return math.radians(self.east - self.west) * EARTH_RADIUS_M * math.cos(math.radians(lat))

    @property
    def area_km2(self) -> float:
        return self.height_m * self.width_m / 1e6

    @property
    def area_sq_mi(self) -> float:
        return self.area_km2 / 2.589988

    def as_stac(self) -> str:
        """``west,south,east,north`` — the order STAC and GeoJSON use."""
        return f"{self.west},{self.south},{self.east},{self.north}"

    def grid(self, step_m: float) -> list[tuple[float, float]]:
        """Sample points covering the box, spaced ``step_m`` apart.

        Providers that only answer "what is near this point" have to be swept. Spacing is
        computed per-axis rather than from a single degree constant, because a degree of
        longitude in San Francisco is about 79% of a degree of latitude and treating them as
        equal leaves diagonal gaps in the sweep.
        """
        if step_m <= 0:
            raise ValueError("step_m must be positive")
        lat_step = math.degrees(step_m / EARTH_RADIUS_M)
        lat_mid, _ = self.centre
        lon_step = lat_step / max(math.cos(math.radians(lat_mid)), 1e-6)

        points: list[tuple[float, float]] = []
        rows = max(1, math.ceil((self.north - self.south) / lat_step))
        cols = max(1, math.ceil((self.east - self.west) / lon_step))
        for r in range(rows):
            lat = self.south + (r + 0.5) * (self.north - self.south) / rows
            for c in range(cols):
                lon = self.west + (c + 0.5) * (self.east - self.west) / cols
                points.append((lat, lon))
        return points


@dataclass(frozen=True, slots=True)
class Region:
    name: str
    bbox: BBox
    description: str


#: Marina → Cow Hollow → Russian Hill → North Beach → Chinatown → Financial District.
#:
#: Chosen for variety inside one connected walk rather than for neighbourhood-boundary purity:
#: flat Marina streets and steep Russian Hill grades, Chinatown's narrow lanes and downtown
#: high-rise canyons, all within about five square miles. A reconstruction that survives this
#: range of geometry has been tested on something.
SF_CORRIDOR = Region(
    name="sf-corridor",
    bbox=BBox(south=37.7860, west=-122.4475, north=37.8095, east=-122.3920),
    description="Marina, Cow Hollow, Russian Hill, North Beach, Chinatown, Financial District",
)

REGIONS: dict[str, Region] = {SF_CORRIDOR.name: SF_CORRIDOR}

#: The other regions are data: data/regions/regions.json, one entry per region, so that
#: scaling to a new district or a new city is a line in a file and a run of the ingestion.
REGIONS_FILE = Path(__file__).resolve().parents[3] / "data" / "regions" / "regions.json"


def load_regions(path: Path = REGIONS_FILE) -> dict[str, Region]:
    """Every region: the corridor, and those listed in the regions file."""
    out = dict(REGIONS)
    if path.exists():
        for row in json.loads(path.read_text(encoding="utf-8")).get("regions", []):
            south, west, north, east = row["bbox"]
            out[row["name"]] = Region(name=row["name"], bbox=BBox(south=south, west=west, north=north, east=east),
                                      description=row.get("description", ""))
    return out


def grid_regions(bbox: BBox, cell_km: float, prefix: str) -> list[Region]:
    """A bounding box cut into square cells, each a region of its own: the unit the Bay Area
    is ingested in. Cells are named ``<prefix>-<column>-<row>`` from the south-west."""
    step_lat = cell_km * 1000.0 / 111_320.0
    step_lon = cell_km * 1000.0 / (111_320.0 * math.cos(math.radians((bbox.south + bbox.north) / 2.0)))
    cells: list[Region] = []
    row = 0
    south = bbox.south
    while south < bbox.north - 1e-9:
        north = min(bbox.north, south + step_lat)
        col = 0
        west = bbox.west
        while west < bbox.east - 1e-9:
            east = min(bbox.east, west + step_lon)
            cells.append(Region(name=f"{prefix}-{col}-{row}", bbox=BBox(south=south, west=west, north=north, east=east),
                                description=f"{prefix} cell column {col} row {row}, {cell_km} km"))
            west = east
            col += 1
        south = north
        row += 1
    return cells


def get_region(name: str) -> Region:
    regions = load_regions()
    try:
        return regions[name]
    except KeyError:
        known = ", ".join(sorted(regions))
        raise KeyError(f"unknown region {name!r}; known regions: {known}") from None
