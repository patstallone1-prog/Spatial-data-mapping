"""The canonical world object: one physical thing, its measured geometry, and why to trust it.

This is the layer that owns geometry. The renderer used to: it was handed a type and a place
and drew the model it kept under that type. A :class:`WorldObject` is handed to the renderer
already shaped -- its geometry is one of the families in :mod:`smc.geometry`, in its own
east/north/up frame about ``anchor`` -- and the same object is what Unreal, a planner or a
measurement API receive. Nothing in it names a renderer.

Four rules are enforced at construction rather than left to convention, in the spirit of
:mod:`smc.facts.schema`:

* **No anonymous geometry.** Every object that has geometry cites its evidence.
* **Measured means measured.** ``basis=MEASURED`` needs observations, an observational
  source, and a record of how it was fitted.
* **A prefab is never a measurement.** ``basis=LEGACY_ARCHETYPE`` is capped in confidence,
  flagged, and may cite only the map and the existing geometry it was chosen from.
* **Confidence never exceeds its best source.** A fit to OpenStreetMap geometry cannot claim
  what a survey could.

Basis says where the *shape* came from; ``detail`` says how much of it is drawn; the grade of
each individual dimension travels on its :class:`smc.geometry.Param`.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

import numpy as np

from smc.geometry.base import Geometry, geometry_from_json, geometry_to_json
from smc.reconstruction.geo import EnuFrame

SCHEMA = "kerbside.world_object/1"


class GeometryBasis(enum.StrEnum):
    MEASURED = "measured"                  # fitted to observations of this object, gates passed
    INFERRED = "inferred"                  # derived from measurements of something else
    PRIOR = "prior"                        # the existing Kerbside geometry, retained
    LEGACY_ARCHETYPE = "legacy_archetype"  # the renderer's catalogue model: never a measurement
    UNRESOLVED = "unresolved"              # not enough evidence to draw anything


class Detail(enum.StrEnum):
    FULL = "full"                  # all of the fitted geometry
    CONSERVATIVE = "conservative"  # a simplified version: the evidence supports the gist only
    NONE = "none"                  # nothing drawn from this object


#: Kinds of evidence. The first group are observations of the object; the second are what a
#: prior or a catalogue choice is allowed to cite.
OBSERVATIONAL = frozenset({"lidar_points", "lidar_kerb_station", "survey_line", "survey_points",
                           "image", "photogrammetry", "fixture"})
REFERENCE = frozenset({"existing_geometry", "osm", "catalogue"})

#: Ceiling on confidence by the strongest grade of evidence behind the shape
#: (:class:`smc.facts.cross_section.SourceGrade` values).
GRADE_CAP: dict[str, float] = {"survey": 0.95, "lidar": 0.9, "image": 0.8, "mapped": 0.6,
                               "inferred": 0.35}
#: A catalogue model can be right about what a thing is and never about its shape.
LEGACY_MAX_CONFIDENCE = 0.3


@dataclass(frozen=True)
class EvidenceRef:
    """One source an object's geometry rests on.

    ``source_id`` names the dataset (the same ids as ``data/reconstruction/source_rights.json``
    where one exists); ``locator`` says what within it (a curb line's key, an OSM way, a lidar
    cell, a frame). ``asset_id`` links to :class:`smc.reconstruction.provenance.SourceAsset`
    when the pixels or points are in the pixel store -- the same provenance, not a parallel one.
    """

    kind: str
    source_id: str
    locator: str
    license_id: str
    asset_id: str | None = None
    captured: str | None = None
    count: int = 1

    def __post_init__(self) -> None:
        if self.kind not in OBSERVATIONAL | REFERENCE:
            raise ValueError(f"unknown evidence kind {self.kind!r}")
        if not (self.source_id and self.locator and self.license_id):
            raise ValueError("evidence needs a source, a locator and a licence")
        if self.count < 0:
            raise ValueError("evidence count cannot be negative")

    @property
    def observational(self) -> bool:
        return self.kind in OBSERVATIONAL

    def to_json(self) -> dict[str, Any]:
        out = {"kind": self.kind, "source_id": self.source_id, "locator": self.locator,
               "license_id": self.license_id, "count": self.count}
        if self.asset_id:
            out["asset_id"] = self.asset_id
        if self.captured:
            out["captured"] = self.captured
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> EvidenceRef:
        return cls(data["kind"], data["source_id"], data["locator"], data["license_id"],
                   data.get("asset_id"), data.get("captured"), int(data.get("count", 1)))


@dataclass(frozen=True)
class Evidence:
    """What stands behind an object's geometry, and how well it fitted."""

    refs: tuple[EvidenceRef, ...]
    grade: str = "inferred"
    observation_count: int = 0
    independent_sources: int = 0
    fit_rms_m: float | None = None
    fit_max_m: float | None = None
    inlier_fraction: float | None = None
    coverage: float = 0.0
    exact: bool = False
    reprojection_px: float | None = None
    lidar_disagreement_m: float | None = None
    prior_disagreement_m: float | None = None

    def __post_init__(self) -> None:
        if self.grade not in GRADE_CAP:
            raise ValueError(f"unknown grade {self.grade!r}")
        if not 0.0 <= self.coverage <= 1.0:
            raise ValueError("coverage must be within 0..1")

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"refs": [r.to_json() for r in self.refs], "grade": self.grade,
                               "observation_count": self.observation_count,
                               "independent_sources": self.independent_sources,
                               "coverage": round(self.coverage, 3), "exact": self.exact}
        for key in ("fit_rms_m", "fit_max_m", "inlier_fraction", "reprojection_px",
                    "lidar_disagreement_m", "prior_disagreement_m"):
            value = getattr(self, key)
            if value is not None:
                out[key] = round(float(value), 4)
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Evidence:
        return cls(tuple(EvidenceRef.from_json(r) for r in data["refs"]), data["grade"],
                   data.get("observation_count", 0), data.get("independent_sources", 0),
                   data.get("fit_rms_m"), data.get("fit_max_m"), data.get("inlier_fraction"),
                   data.get("coverage", 0.0), data.get("exact", False),
                   data.get("reprojection_px"), data.get("lidar_disagreement_m"),
                   data.get("prior_disagreement_m"))


@dataclass(frozen=True)
class FitRecord:
    """How the geometry was produced: method, software, when, and with what settings."""

    method: str
    software: str
    fitted_at: datetime
    parameters: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.fitted_at.utcoffset() is None:
            raise ValueError("fit time needs an explicit timezone")
        if not self.method or not self.software:
            raise ValueError("a fit record names its method and software")

    def to_json(self) -> dict[str, Any]:
        return {"method": self.method, "software": self.software,
                "fitted_at": self.fitted_at.isoformat(), "parameters": self.parameters}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> FitRecord:
        return cls(data["method"], data["software"], datetime.fromisoformat(data["fitted_at"]),
                   dict(data.get("parameters", {})))


@dataclass(frozen=True)
class WorldObject:
    """One physical thing."""

    id: str
    semantic_type: str
    geometry: Geometry | None
    basis: GeometryBasis
    confidence: float
    evidence: Evidence
    anchor: tuple[float, float, float]
    material: str = "concrete"
    detail: Detail = Detail.FULL
    fit: FitRecord | None = None
    flags: tuple[str, ...] = ()
    supersedes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "basis", GeometryBasis(self.basis))
        object.__setattr__(self, "detail", Detail(self.detail))
        if not self.id or not self.semantic_type:
            raise ValueError("an object needs an id and a type")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be within 0..1")
        lon, lat, _ = self.anchor
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError("anchor is not a WGS84 position")
        if (self.geometry is None) != (self.basis is GeometryBasis.UNRESOLVED):
            raise ValueError("an object has geometry exactly when it is not unresolved")
        if self.basis is GeometryBasis.UNRESOLVED:
            if self.detail is not Detail.NONE:
                raise ValueError("an unresolved object draws nothing")
            return
        if not self.evidence.refs:
            raise ValueError(f"{self.id}: geometry with no evidence is anonymous geometry")
        if self.confidence > GRADE_CAP[self.evidence.grade] + 1e-9:
            raise ValueError(f"{self.id}: confidence {self.confidence:.2f} exceeds what "
                             f"{self.evidence.grade} evidence allows")
        if self.basis is GeometryBasis.MEASURED:
            if not any(r.observational for r in self.evidence.refs):
                raise ValueError(f"{self.id}: measured geometry needs an observation")
            if self.evidence.observation_count < 1:
                raise ValueError(f"{self.id}: measured geometry needs at least one observation")
            if self.fit is None:
                raise ValueError(f"{self.id}: measured geometry needs a fit record")
            if self.detail is Detail.NONE:
                raise ValueError(f"{self.id}: accepted geometry is drawn")
        if self.basis is GeometryBasis.LEGACY_ARCHETYPE:
            if self.confidence > LEGACY_MAX_CONFIDENCE:
                raise ValueError(f"{self.id}: a catalogue model cannot claim confidence "
                                 f"above {LEGACY_MAX_CONFIDENCE}")
            if "legacy_archetype" not in self.flags:
                raise ValueError(f"{self.id}: legacy geometry must be flagged as such")
            if any(r.observational for r in self.evidence.refs):
                raise ValueError(f"{self.id}: a catalogue model cannot cite observations as "
                                 "if they measured it")

    @property
    def family(self) -> str | None:
        return None if self.geometry is None else str(self.geometry.family)

    def frame(self) -> EnuFrame:
        return EnuFrame(*self.anchor)

    def bbox_local(self) -> tuple[np.ndarray, np.ndarray] | None:
        return None if self.geometry is None else self.geometry.bounds()

    def with_conflict(self, note: str) -> WorldObject:
        """Record that this object disagrees with another source, keeping it as it is."""
        return replace(self, flags=(*self.flags, f"conflict:{note}"))

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "schema": SCHEMA, "id": self.id, "type": self.semantic_type,
            "family": self.family, "basis": str(self.basis), "detail": str(self.detail),
            "confidence": round(self.confidence, 4), "material": self.material,
            "anchor": [round(self.anchor[0], 8), round(self.anchor[1], 8),
                       round(self.anchor[2], 3)],
            "evidence": self.evidence.to_json(), "flags": list(self.flags),
            "supersedes": list(self.supersedes),
        }
        if self.geometry is not None:
            out["geometry"] = geometry_to_json(self.geometry)
        if self.fit is not None:
            out["fit"] = self.fit.to_json()
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> WorldObject:
        if data.get("schema") != SCHEMA:
            raise ValueError(f"not a {SCHEMA} record")
        geometry = geometry_from_json(data["geometry"]) if "geometry" in data else None
        fit = FitRecord.from_json(data["fit"]) if "fit" in data else None
        return cls(data["id"], data["type"], geometry, GeometryBasis(data["basis"]),
                   float(data["confidence"]), Evidence.from_json(data["evidence"]),
                   tuple(data["anchor"]), data.get("material", "concrete"),
                   Detail(data["detail"]), fit, tuple(data.get("flags", ())),
                   tuple(data.get("supersedes", ())))


def software_version() -> str:
    """This package's version and, when it can be read, the commit it was built from."""
    import subprocess
    from pathlib import Path

    from smc import __version__ as version

    root = Path(__file__).resolve().parents[3]
    try:
        head = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, timeout=5, check=False)
        sha = head.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        sha = ""
    return f"smc {version}" + (f" ({sha})" if sha else "")


def now() -> datetime:
    return datetime.now(UTC)
