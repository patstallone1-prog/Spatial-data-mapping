"""What every piece of reconstructed geometry has in common.

A reconstructed object used to reach the renderer as a *name* -- ``bench``, ``house_type=4``,
a corner piece -- and the renderer drew the model it had under that name. That is a catalogue,
and a catalogue is only ever as accurate as its nearest entry: a curved bench became the
straight one, a rounded kerb return became the square one. The geometry in this package is the
other thing. It is the measured shape itself, in one of a few *families* that differ in how the
shape is described, not in what it is allowed to look like:

``SPLINE_EXTRUSION``
    a path and a cross-section swept along it -- kerbs, fences, rails, medians, some benches.
``PARAMETRIC_BUILDING``
    a footprint, a roof and facades whose windows, bays and cornices are placed and sized by
    measurement. The construction functions are shared; the numbers never are.
``PRIMITIVE_ASSEMBLY``
    fitted boxes, cylinders, frusta -- poles, bollards, hydrants, cabinets.
``FREEFORM_MESH``
    the reconstructed surface kept as a surface, for whatever the other three cannot represent
    to within its tolerance.
``TERRAIN_PATCH``
    a height field; the page's lidar ground is one.

All coordinates are metres in an object-local east/north/up frame (x east, y north, z up)
about the object's anchor. Which WGS84 point that is, and what the object is, belong to
:class:`smc.world.object.WorldObject`; the geometry itself knows nothing about the world.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol, runtime_checkable

import numpy as np


class GeometryFamily(enum.StrEnum):
    SPLINE_EXTRUSION = "spline_extrusion"
    PARAMETRIC_BUILDING = "parametric_building"
    PRIMITIVE_ASSEMBLY = "primitive_assembly"
    FREEFORM_MESH = "freeform_mesh"
    TERRAIN_PATCH = "terrain_patch"


@dataclass(frozen=True)
class TriMesh:
    """An indexed triangle mesh: the one shape every family can be turned into.

    Faces wind counter-clockwise seen from outside. Normals and UVs are optional and, when
    present, per vertex.
    """

    vertices: np.ndarray
    faces: np.ndarray
    normals: np.ndarray | None = None
    uvs: np.ndarray | None = None

    def __post_init__(self) -> None:
        vertices = np.asarray(self.vertices, dtype=np.float64).reshape(-1, 3)
        faces = np.asarray(self.faces, dtype=np.int64).reshape(-1, 3)
        if not np.isfinite(vertices).all():
            raise ValueError("mesh vertices must be finite")
        if faces.size and (int(faces.min()) < 0 or int(faces.max()) >= len(vertices)):
            raise ValueError("a face references a vertex that does not exist")
        object.__setattr__(self, "vertices", vertices)
        object.__setattr__(self, "faces", faces)
        for name, width in (("normals", 3), ("uvs", 2)):
            value = getattr(self, name)
            if value is None:
                continue
            value = np.asarray(value, dtype=np.float64).reshape(-1, width)
            if len(value) != len(vertices):
                raise ValueError(f"{name} must have one row per vertex")
            object.__setattr__(self, name, value)

    @property
    def triangle_count(self) -> int:
        return len(self.faces)

    @property
    def empty(self) -> bool:
        return len(self.faces) == 0

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        if not len(self.vertices):
            zero = np.zeros(3)
            return zero, zero
        return self.vertices.min(axis=0), self.vertices.max(axis=0)

    def face_normals(self) -> np.ndarray:
        a, b, c = (self.vertices[self.faces[:, k]] for k in range(3))
        cross = np.cross(b - a, c - a)
        length = np.linalg.norm(cross, axis=1, keepdims=True)
        return np.divide(cross, length, out=np.zeros_like(cross), where=length > 0)

    def face_areas(self) -> np.ndarray:
        a, b, c = (self.vertices[self.faces[:, k]] for k in range(3))
        return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)

    def with_normals(self) -> TriMesh:
        """Area-weighted vertex normals. A hard edge is a duplicated vertex, not a special case."""
        a, b, c = (self.vertices[self.faces[:, k]] for k in range(3))
        cross = np.cross(b - a, c - a)
        normals = np.zeros_like(self.vertices)
        for k in range(3):
            np.add.at(normals, self.faces[:, k], cross)
        length = np.linalg.norm(normals, axis=1, keepdims=True)
        normals = np.divide(normals, length, out=np.zeros_like(normals), where=length > 0)
        return TriMesh(self.vertices, self.faces, normals, self.uvs)

    def translated(self, offset: np.ndarray | tuple[float, float, float]) -> TriMesh:
        return TriMesh(self.vertices + np.asarray(offset, dtype=np.float64), self.faces,
                       self.normals, self.uvs)

    def without_degenerate_faces(self, min_area_m2: float = 1e-10) -> TriMesh:
        keep = self.face_areas() > min_area_m2
        return TriMesh(self.vertices, self.faces[keep], self.normals, self.uvs)

    @staticmethod
    def merge(meshes: list[TriMesh]) -> TriMesh:
        meshes = [m for m in meshes if len(m.vertices)]
        if not meshes:
            return TriMesh(np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64))
        offsets = np.cumsum([0] + [len(m.vertices) for m in meshes[:-1]])
        vertices = np.concatenate([m.vertices for m in meshes])
        faces = np.concatenate([m.faces + o for m, o in zip(meshes, offsets, strict=True)])
        normals = (np.concatenate([m.normals for m in meshes])
                   if all(m.normals is not None for m in meshes) else None)
        uvs = (np.concatenate([m.uvs for m in meshes])
               if all(m.uvs is not None for m in meshes) else None)
        return TriMesh(vertices, faces, normals, uvs)

    def to_json(self, precision_mm: int = 1) -> dict[str, Any]:
        """Vertices as integer millimetres: exact to the unit, a third the size of floats."""
        scale = 1000.0 / precision_mm
        out: dict[str, Any] = {
            "unit_mm": precision_mm,
            "v": np.round(self.vertices * scale).astype(np.int64).ravel().tolist(),
            "i": self.faces.ravel().tolist(),
        }
        if self.uvs is not None:
            out["uv"] = np.round(self.uvs, 3).ravel().tolist()
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> TriMesh:
        scale = data.get("unit_mm", 1) / 1000.0
        vertices = np.asarray(data["v"], dtype=np.float64).reshape(-1, 3) * scale
        faces = np.asarray(data["i"], dtype=np.int64).reshape(-1, 3)
        uvs = np.asarray(data["uv"], dtype=np.float64).reshape(-1, 2) if "uv" in data else None
        return cls(vertices, faces, None, uvs)


@runtime_checkable
class Geometry(Protocol):
    """What a geometry family must provide. Nothing here names a renderer."""

    family: ClassVar[GeometryFamily]

    def to_mesh(self) -> TriMesh: ...

    def bounds(self) -> tuple[np.ndarray, np.ndarray]: ...

    def to_json(self) -> dict[str, Any]: ...


@dataclass(frozen=True)
class Param:
    """One dimension of an object, with where its number came from.

    A kerb's path can be surveyed while its height is the corridor median; a bay window's
    depth can be measured while its sill height is a prior. The grade travels with the number
    so that the object as a whole never claims more than its weakest dimension -- and so that
    nothing downstream has to guess which of its numbers were measured.
    """

    value: float
    grade: str = "inferred"
    sigma_m: float | None = None
    note: str = ""

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"value": round(float(self.value), 4), "grade": self.grade}
        if self.sigma_m is not None:
            out["sigma_m"] = round(float(self.sigma_m), 4)
        if self.note:
            out["note"] = self.note
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Param:
        return cls(float(data["value"]), str(data.get("grade", "inferred")),
                   data.get("sigma_m"), str(data.get("note", "")))


def params_json(params: dict[str, Param]) -> dict[str, Any]:
    return {key: value.to_json() for key, value in sorted(params.items())}


def params_from_json(data: dict[str, Any] | None) -> dict[str, Param]:
    return {key: Param.from_json(value) for key, value in (data or {}).items()}


#: Registry of geometry classes by family, filled by each module as it is imported, so that a
#: serialised object can be read back without the reader knowing in advance what it holds.
GEOMETRY_TYPES: dict[str, type] = {}


def register(cls: type) -> type:
    GEOMETRY_TYPES[f"{cls.family}:{cls.__name__}"] = cls  # type: ignore[attr-defined]
    return cls


def geometry_to_json(geometry: Geometry) -> dict[str, Any]:
    return {"type": f"{geometry.family}:{type(geometry).__name__}", **geometry.to_json()}


def geometry_from_json(data: dict[str, Any]) -> Geometry:
    # Importing the package registers every family.
    import smc.geometry  # noqa: F401

    kind = data["type"]
    if kind not in GEOMETRY_TYPES:
        raise ValueError(f"unknown geometry type {kind!r}")
    return GEOMETRY_TYPES[kind].from_json(data)  # type: ignore[attr-defined,no-any-return]


@dataclass(frozen=True)
class DetailPolicy:
    """Whether a reconstructed feature becomes triangles or stays in the texture.

    Triangles are for what changes the silhouette, the shadow, a collision or a measurement.
    A relief shallower than ``min_depth_m`` does none of those at street scale -- brick
    coursing, a crack, paint, a small moulding -- and belongs in a normal or displacement map,
    where it costs nothing to draw. Two lists override the depth rule in either direction:
    a kerb is a few centimetres and still decides where a wheelchair can go, and a painted line
    is flat however it is measured.
    """

    min_depth_m: float = 0.08
    min_area_m2: float = 0.05
    always_geometry: frozenset[str] = field(default_factory=lambda: frozenset({
        "curb", "kerb", "stair", "step", "railing", "fence", "bench", "bollard", "pole",
        "ramp", "median", "balcony", "bay_window", "door", "hydrant", "planter", "guardrail",
    }))
    always_appearance: frozenset[str] = field(default_factory=lambda: frozenset({
        "paint", "lane_marking_paint", "crack", "stain", "brick_pattern", "graffiti",
    }))

    def classify(self, kind: str, depth_m: float, area_m2: float) -> str:
        """``"geometry"`` or ``"appearance"``."""
        if kind in self.always_appearance:
            return "appearance"
        if kind in self.always_geometry:
            return "geometry"
        if abs(depth_m) >= self.min_depth_m and area_m2 >= self.min_area_m2:
            return "geometry"
        return "appearance"


DETAIL_POLICY = DetailPolicy()
