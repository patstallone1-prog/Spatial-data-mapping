"""Local-metre facade inputs; canonical shell and observations remain immutable evidence."""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass

from shapely.geometry import Polygon, shape


@dataclass(frozen=True)
class ExteriorInput:
    id: str
    footprint: Polygon
    height_m: float
    tenants: tuple[dict, ...]
    frontages: tuple[dict, ...] = ()
    ground_height_m: float | None = None
    origin_lon_lat: tuple[float, float] | None = None
    geometry_evidence: dict | None = None
    canonical_points: tuple | None = None
    interior: dict | None = None

    @classmethod
    def from_json(cls, row):
        if row.get("units", "metres") != "metres":
            raise ValueError("exterior input requires local-metre geometry")
        return cls(
            str(row["id"]),
            shape(row["footprint"]),
            float(row["height_m"]),
            tuple(copy.deepcopy(row.get("tenants", []))),
            tuple(copy.deepcopy(row.get("frontages", []))),
            row.get("ground_height_m"),
            tuple(row["origin_lon_lat"]) if row.get("origin_lon_lat") else None,
            copy.deepcopy(row.get("geometry_evidence")),
            copy.deepcopy(row.get("canonical_points")),
            copy.deepcopy(row.get("interior")),
        )

    def __post_init__(self):
        p = self.footprint
        if not isinstance(p, Polygon) or p.is_empty or not p.is_valid or p.area < 1:
            raise ValueError("exterior requires a valid source Polygon; no rectangle substitution")
        if not math.isfinite(self.height_m) or self.height_m < 2.3:
            raise ValueError("invalid source exterior height")
        if self.ground_height_m is not None and (
            not math.isfinite(self.ground_height_m)
            or not 2.3 <= self.ground_height_m <= self.height_m
        ):
            raise ValueError("ground floor height must fit the source building")
        if not self.id or not self.tenants:
            raise ValueError("exterior needs an identity and at least one tenant")
        ids = [str(t["id"]) for t in self.tenants]
        if len(ids) != len(set(ids)) or any(not t.get("name") for t in self.tenants):
            raise ValueError("tenants need unique IDs and nonempty names")
        ring = list(p.exterior.coords)
        for f in self.frontages:
            edge = f.get("edge")
            if type(edge) is not int or not 0 <= edge < len(ring) - 1:
                raise ValueError("frontage must identify a source footprint edge")
            length = math.dist(ring[edge], ring[edge + 1])
            lo, hi = f.get("u0", 0), f.get("u1", length)
            if not all(math.isfinite(n) for n in (lo, hi)) or not 0 <= lo < hi <= length + 1e-6:
                raise ValueError("tenant frontage lies outside its source edge")
            if str(f.get("tenant_id")) not in ids:
                raise ValueError("frontage belongs to an unknown tenant")
            if f.get("role", "public") not in {"public", "secondary", "service", "party"}:
                raise ValueError("unknown frontage role")
            for o in f.get("openings", []):
                if not all(
                    isinstance(o.get(k), (float, int)) and math.isfinite(o[k])
                    for k in ("u", "w", "v", "h")
                ):
                    raise ValueError("source opening needs finite u,w,v,h")
                if o["w"] <= 0 or o["h"] <= 0:
                    raise ValueError("source opening dimensions must be positive")
        for i, a in enumerate(self.frontages):
            for b in self.frontages[i + 1 :]:
                if a["edge"] != b["edge"]:
                    continue
                length = math.dist(ring[a["edge"]], ring[a["edge"] + 1])
                if (
                    min(a.get("u1", length), b.get("u1", length))
                    > max(a.get("u0", 0), b.get("u0", 0)) + 1e-6
                ):
                    raise ValueError("tenant frontage ownership overlaps")
