"""One schema for every floor-plan source.

A :class:`LayoutTemplate` is a real plan -- a Swiss apartment building, an American house --
normalised to metres in its own local frame, as storeys of rooms, structure (walls, railings,
columns), openings (windows, doors, entrance doors) and fixtures (sinks, stairs, kitchens).
Nothing in it is invented: a template is what its source drew, and carries its source's licence
and attribution on itself, so a layout chosen for a building can always say where it came from.

Room kinds are normalised to one vocabulary (:data:`ROOM_KINDS`) because each source has its
own; the source's own label is kept beside it.

``descriptors`` are what a building's outside can be compared against when a layout is chosen
for it (§A7): gross size and proportions, storeys and their heights, how many windows and how
densely they line the outline, and what rooms there are.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from smc.interiors.geometry import area, min_area_rect

ROOM_KINDS = ("living", "dining", "kitchen", "bedroom", "bathroom", "toilet", "corridor",
              "entrance", "storage", "balcony", "terrace", "garden", "stair", "elevator", "shaft",
              "office", "utility", "garage", "commercial", "void", "other")

#: Each source's labels, mapped onto ROOM_KINDS. A label not listed maps to "other".
KIND_MAP: dict[str, str] = {
    # Swiss Dwellings
    "ROOM": "bedroom", "BEDROOM": "bedroom", "LIVING_ROOM": "living", "LIVING_DINING": "living",
    "DINING": "dining", "KITCHEN": "kitchen", "KITCHEN_DINING": "kitchen",
    "BATHROOM": "bathroom", "SANITARY_ROOMS": "toilet", "CORRIDOR": "corridor",
    "CORRIDORS_AND_HALLS": "corridor", "LOBBY": "entrance", "STOREROOM": "storage",
    "BASEMENT_COMPARTMENT": "storage", "BASEMENT": "storage", "BIKE_STORAGE": "storage",
    "PRAM_AND_BIKE_STORAGE_ROOM": "storage", "BALCONY": "balcony", "LOGGIA": "balcony",
    "WINTERGARTEN": "balcony", "TERRACE": "terrace", "PATIO": "terrace", "GARDEN": "garden",
    "STAIRCASE": "stair", "ELEVATOR": "elevator", "SHAFT": "shaft", "LIGHTWELL": "shaft",
    "OFFICE": "office", "OFFICE_SPACE": "office", "MEETING_ROOM": "office",
    "OFFICE_TECH_ROOM": "utility", "TECHNICAL_AREA": "utility", "HEATING": "utility",
    "WASH_AND_DRY_ROOM": "utility", "GARAGE": "garage", "CARPARK": "garage",
    "SALESROOM": "commercial", "VOID": "void", "OUTDOOR_VOID": "void",
    # ResPlan
    "living": "living", "kitchen": "kitchen", "bedroom": "bedroom", "bathroom": "bathroom",
    "balcony": "balcony", "storage": "storage", "stair": "stair", "garden": "garden",
    "parking": "garage", "pool": "garden",
}


def kind_of(label: str) -> str:
    return KIND_MAP.get(label, "other")


def _poly_json(ring: np.ndarray) -> list[list[float]]:
    return np.round(ring, 3).tolist()


@dataclass(frozen=True)
class Room:
    kind: str
    label: str
    polygon: np.ndarray
    unit: str | None = None

    @property
    def area_m2(self) -> float:
        return abs(area(self.polygon))

    def to_json(self) -> dict[str, Any]:
        out = {"kind": self.kind, "label": self.label, "poly": _poly_json(self.polygon),
               "area": round(self.area_m2, 2)}
        if self.unit:
            out["unit"] = self.unit
        return out


@dataclass(frozen=True)
class Structure:
    kind: str  # wall | railing | column
    polygon: np.ndarray

    def to_json(self) -> dict[str, Any]:
        return {"kind": self.kind, "poly": _poly_json(self.polygon)}


@dataclass(frozen=True)
class Opening:
    """A window or door as drawn in plan: its footprint in the wall. ``width_m`` is the long
    side of that footprint -- the opening's width along the wall."""

    kind: str  # window | door | entrance
    polygon: np.ndarray
    sill_m: float | None = None
    height_m: float | None = None

    @property
    def centre(self) -> np.ndarray:
        return self.polygon.mean(axis=0)

    @property
    def width_m(self) -> float:
        if len(self.polygon) < 3:
            return 0.0
        length, _depth, _bearing = min_area_rect(self.polygon)
        return length

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind, "poly": _poly_json(self.polygon),
                               "width": round(self.width_m, 3)}
        if self.sill_m is not None:
            out["sill_m"] = round(self.sill_m, 3)
        if self.height_m is not None:
            out["height_m"] = round(self.height_m, 3)
        return out


@dataclass(frozen=True)
class Storey:
    level: int
    elevation_m: float | None
    height_m: float | None
    rooms: tuple[Room, ...] = ()
    structure: tuple[Structure, ...] = ()
    openings: tuple[Opening, ...] = ()
    fixtures: tuple[tuple[str, np.ndarray], ...] = ()

    def points(self) -> np.ndarray:
        polys = [r.polygon for r in self.rooms] + [s.polygon for s in self.structure]
        return np.vstack(polys) if polys else np.zeros((0, 2))

    def to_json(self) -> dict[str, Any]:
        return {"level": self.level,
                "elevation_m": None if self.elevation_m is None else round(self.elevation_m, 3),
                "height_m": None if self.height_m is None else round(self.height_m, 3),
                "rooms": [r.to_json() for r in self.rooms],
                "structure": [s.to_json() for s in self.structure],
                "openings": [o.to_json() for o in self.openings],
                "fixtures": [{"kind": k, "poly": _poly_json(p)} for k, p in self.fixtures]}


@dataclass(frozen=True)
class LayoutTemplate:
    template_id: str
    source: str
    scope: str                     # building | unit
    license_id: str
    attribution: str
    url: str
    source_ids: dict[str, Any]
    storeys: tuple[Storey, ...]
    commercial_use: bool
    notes: tuple[str, ...] = field(default_factory=tuple)

    def descriptors(self) -> dict[str, Any]:
        """What a building's outside can be matched against."""
        pts = np.vstack([s.points() for s in self.storeys if len(s.points())]) \
            if any(len(s.points()) for s in self.storeys) else np.zeros((0, 2))
        rooms = [r for s in self.storeys for r in s.rooms]
        kinds: dict[str, int] = {}
        for r in rooms:
            kinds[r.kind] = kinds.get(r.kind, 0) + 1
        windows = [o for s in self.storeys for o in s.openings if o.kind == "window"]
        out: dict[str, Any] = {
            "storeys": len(self.storeys),
            "storey_heights_m": [s.height_m for s in self.storeys],
            "room_count": len(rooms), "rooms_by_kind": kinds,
            "floor_area_m2": round(sum(r.area_m2 for r in rooms), 1),
            "windows": len(windows), "doors": sum(1 for s in self.storeys for o in s.openings
                                                   if o.kind != "window"),
        }
        if len(pts) >= 3:
            length, depth, bearing = min_area_rect(pts)
            out.update({"width_m": round(length, 2), "depth_m": round(depth, 2),
                        "aspect": round(length / max(depth, 1e-6), 3),
                        "bearing_deg": round(bearing, 1)})
            perimeter = 2.0 * (length + depth)
            per_storey = max(1, len(self.storeys))
            out["window_width_per_perimeter_m"] = round(
                sum(o.width_m for o in windows) / per_storey / max(perimeter, 1e-6), 4)
        return out

    def to_json(self) -> dict[str, Any]:
        return {"id": self.template_id, "source": self.source, "scope": self.scope,
                "license": self.license_id, "attribution": self.attribution, "url": self.url,
                "commercial_use": self.commercial_use, "source_ids": self.source_ids,
                "descriptors": self.descriptors(),
                "storeys": [s.to_json() for s in self.storeys], "notes": list(self.notes)}
