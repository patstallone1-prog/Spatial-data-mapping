"""Public metre-based input and JSON geometry contract; no geographic unit guessing."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

from shapely.geometry import Polygon, mapping
from shapely.geometry.base import BaseGeometry


def seed_for(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big")


def polygon(value: Any) -> Polygon:
    """Accept a local XY ring or GeoJSON polygon, preserving holes and rejecting repairs."""
    if isinstance(value, Polygon):
        p = value
    elif isinstance(value, dict):
        if value.get("type") != "Polygon":
            raise ValueError("a connected Polygon in local metres is required")
        rings = value["coordinates"]
        p = Polygon(rings[0], rings[1:])
    else:
        p = Polygon(value)
    if not p.is_valid or p.is_empty or not all(math.isfinite(v) for v in p.bounds):
        raise ValueError("footprint must be a valid finite polygon; it is never silently repaired")
    return p


def geo(g: BaseGeometry) -> dict:
    return mapping(g)


@dataclass(frozen=True)
class StoreyInput:
    height_m: float
    footprint: Polygon | None = None


@dataclass(frozen=True)
class HouseInput:
    id: str
    footprint: Polygon
    storeys: tuple[StoreyInput, ...]
    entrance: tuple[float, float] | None = None
    neighborhood_price_per_sqft: float | None = None
    bedrooms: int | None = None
    office: bool = False
    total_height_m: float | None = None
    source: str = "user supplied footprint"
    envelope: dict | None = None
    households: int = 1
    units_per_floor: tuple[int, ...] | None = None
    garages: tuple[dict, ...] = ()
    garage_cars: int | None = None
    garage_mode: str = "auto"
    entrance_level: int = 0
    compact_program: bool = False

    def __post_init__(self) -> None:
        polygon(self.footprint)
        if type(self.entrance_level) is not int or not 0 <= self.entrance_level < len(self.storeys):
            raise ValueError("entrance_level must identify a supplied floor")
        if type(self.households) is not int or not 1 <= self.households <= 5:
            raise ValueError("residential inference accepts one to five separate households")
        if self.units_per_floor is not None and (
            len(self.units_per_floor) != len(self.storeys)
            or any(type(n) is not int or not 0 <= n <= 5 for n in self.units_per_floor)
            or sum(self.units_per_floor) != self.households
        ):
            raise ValueError(
                "units_per_floor must allocate every household across the supplied floors"
            )
        if self.garage_cars is not None and (
            type(self.garage_cars) is not int or not 1 <= self.garage_cars <= 4
        ):
            raise ValueError("garage_cars must be an integer from one to four")
        if self.garage_mode not in {"auto", "room", "floor"}:
            raise ValueError("garage_mode must be auto, room or floor")
        if self.garage_cars and not self.garages:
            raise ValueError("garage capacity needs recorded garage openings; none may be invented")
        if not self.id or not 1 <= len(self.storeys) <= 6:
            raise ValueError("single-family v1 accepts an id and one to six storeys")
        for s in self.storeys:
            if not math.isfinite(s.height_m) or not 2.3 <= s.height_m <= 7:
                raise ValueError("storey heights must be finite and 2.3-7 m")
            p = polygon(s.footprint if s.footprint is not None else self.footprint)
            if p.area < 48:
                raise ValueError("single-family v1 requires at least 48 m² per storey")
        if self.total_height_m is not None and (
            not math.isfinite(self.total_height_m)
            or abs(sum(s.height_m for s in self.storeys) - self.total_height_m) > 0.05
        ):
            raise ValueError("storey heights must sum to the supplied total height")
        if self.neighborhood_price_per_sqft is not None and (
            not math.isfinite(self.neighborhood_price_per_sqft)
            or self.neighborhood_price_per_sqft <= 0
        ):
            raise ValueError("neighborhood price per square foot must be positive and finite")
        if self.bedrooms is not None and not 1 <= self.bedrooms <= 8:
            raise ValueError("bedrooms must be between one and eight")
        if self.entrance is not None:
            from shapely.geometry import Point

            if not all(math.isfinite(v) for v in self.entrance):
                raise ValueError("entrance must be finite")
            if self.footprint.boundary.distance(Point(self.entrance)) > 0.3:
                raise ValueError("entrance must lie on the footprint boundary (within 0.3 m)")

    @classmethod
    def from_json(cls, row: dict) -> HouseInput:
        if row.get("units", "metres") != "metres":
            raise ValueError("convert input coordinates to local metres before inference")
        return cls(
            envelope=row.get("envelope"),
            id=str(row["id"]),
            footprint=polygon(row["footprint"]),
            storeys=tuple(
                StoreyInput(
                    float(s["height_m"]), polygon(s["footprint"]) if "footprint" in s else None
                )
                for s in row["storeys"]
            ),
            entrance=tuple(row["entrance"]) if row.get("entrance") is not None else None,
            neighborhood_price_per_sqft=row.get("neighborhood_price_per_sqft"),
            bedrooms=row.get("bedrooms"),
            office=row.get("office", False),
            total_height_m=row.get("total_height_m"),
            source=row.get("source", "user input"),
            households=row.get("households", row.get("families", 1)),
            units_per_floor=tuple(row["units_per_floor"]) if "units_per_floor" in row else None,
            garages=tuple(row.get("garages", (row.get("envelope") or {}).get("garages", []))),
            garage_cars=row.get("garage_cars"),
            garage_mode=row.get("garage_mode", "auto"),
            entrance_level=row.get("entrance_level", 0),
            compact_program=bool(row.get("compact_program", False)),
        )


def stamp_inference(document: dict, confidence: float) -> dict:
    """Carry uncertainty on each served element, including geometry-only wall records."""
    groups = []
    for floor in document.get("storeys", []):
        groups.append([floor])
        groups.extend(floor.get(key, []) for key in ("rooms", "objects", "openings", "walls"))
        groups.extend(
            floor.get(key, []) for key in ("surface_patches", "level_changes", "outdoor_areas")
        )
        groups.extend(change.get("steps", []) for change in floor.get("level_changes", []))
    groups.append(document.get("stairs", []))
    groups.extend(
        o.get("stock", [])
        for floor in document.get("storeys", [])
        for o in floor.get("objects", [])
    )
    groups.extend(
        document.get(key, [])
        for key in ("residential_units", "garages", "ramps", "elevators", "sections", "checkouts")
    )
    groups.extend(garage.get("parking_bays", []) for garage in document.get("garages", []))
    groups.extend(stair.get("steps", []) for stair in document.get("stairs", []))
    groups.extend(floor.get("parking_bays", []) for floor in document.get("storeys", []))
    envelope = document.get("envelope") or {}
    groups.extend(envelope.get(key, []) for key in ("windows", "balconies"))
    for rows in groups:
        for element in rows:
            element.setdefault("grade", "inferred")
            element.setdefault("confidence", confidence)
            element.update(measured=False, freshness=None, corroboration_count=0)
    return document
