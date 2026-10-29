"""Store and parking inputs, with explicit unknowns and unmodified source evidence."""

from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import Point, Polygon, shape

from smc.interiors.inference.model import polygon


@dataclass(frozen=True)
class StoreInput:
    id: str
    footprint: Polygon
    kind: str = "grocery"
    height_m: float = 3.6
    entrances: tuple[dict, ...] = ()
    envelope: dict | None = None
    chain: str = "independent"
    parking: dict | None = None
    source: str = "caller supplied tenant envelope"
    geometry_evidence: dict | None = None

    @classmethod
    def from_json(cls, row):
        if row.get("units", "metres") != "metres":
            raise ValueError("store coordinates must be local metres")
        entrances = list(row.get("entrances", []))
        if not entrances and row.get("entrance"):
            entrances.append({"point": row["entrance"], "basis": "Kerbside entry prior"})
        return cls(
            str(row["id"]),
            polygon(row["footprint"]),
            row.get("kind", "grocery"),
            float(row.get("height_m", 3.6)),
            tuple(entrances),
            row.get("envelope"),
            row.get("chain", "independent"),
            row.get("parking"),
            row.get("source", "caller supplied tenant envelope"),
            row.get("geometry_evidence"),
        )

    def __post_init__(self):
        polygon(self.footprint)
        if not self.id or self.kind not in {"corner_store", "grocery"}:
            raise ValueError("choose corner_store or grocery")
        if not (24 if self.kind == "corner_store" else 100) <= self.footprint.area <= 8000:
            raise ValueError("store area outside 24/100-8000 m² program limits")
        if not math.isfinite(self.height_m) or not 2.4 <= self.height_m <= 7:
            raise ValueError("store height must be 2.4-7m")
        for e in self.entrances:
            line = shape(e["segment"]) if e.get("segment") else Point(e["point"])
            if line.distance(self.footprint.boundary) > 0.06:
                raise ValueError("store entry is off its source outline")
            if line.geom_type == "LineString" and (
                line.length < 0.9
                or len(line.coords) != 2
                or not self.footprint.boundary.buffer(0.06).covers(line)
            ):
                raise ValueError("source entry must be a straight usable facade opening")
        p = self.parking or {}
        if p.get("kind", "unknown") not in {"unknown", "none", "external", "garage", "mixed"}:
            raise ValueError("unknown parking kind")
        if p.get("levels") is not None and (
            type(p["levels"]) is not int or not 1 <= p["levels"] <= 4
        ):
            raise ValueError("garage levels must be an explicit integer 1-4, or unknown")
        if p.get("kind") in {"garage", "mixed"} and p.get("levels") is not None:
            if not p.get("footprint"):
                raise ValueError("garage rendering requires its own source footprint")
            polygon(p["footprint"])
        if p.get("kind") in {"external", "mixed"} and p.get("external_footprint"):
            polygon(p["external_footprint"])
        if p.get("pedestrian_path"):
            polygon(p["pedestrian_path"])
