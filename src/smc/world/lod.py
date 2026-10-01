"""Levels of detail for any world object, each with a geometric error that was measured.

The tile tree (:mod:`smc.tiles.tree`) chooses what to draw by geometric error -- the metres of
detail a representation leaves out -- turned into pixels on screen. An object's levels have
to speak the same language, so each level's error here is the measured distance from the full
geometry to that level's surface, not a guess from its triangle count:

``LOD0``  the simplest honest stand-in: an upright box, or for a swept object its path
          simplified to half a metre with a boxed section;
``LOD1``  simplified geometry: the path to five centimetres, a mesh to five centimetres,
          a building's walls with only the elements that change its silhouette;
``LOD2``  the full measured geometry;
``LOD3``  reserved for micro-detail -- the appearance fields a reconstruction measures but
          which are too shallow for triangles. Not built yet; nothing here pretends to be it.

None of it depends on a render resolution, so a level made for the web is the same level
Unreal or a planner would use.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from smc.geometry.base import TriMesh
from smc.geometry.building import ParametricBuilding
from smc.geometry.extrusion import Profile, ProfileKey, SplineExtrusion
from smc.geometry.freeform import FreeformMesh
from smc.geometry.primitives import PrimitiveAssembly
from smc.geometry.simplify import oriented_box, simplify_to_tolerance, surface_distance

LOD1_TOLERANCE_M = 0.05
LOD0_PATH_TOLERANCE_M = 0.5
#: A building element standing further out of (or into) its wall than this changes the
#: silhouette seen from a distance and survives into LOD1.
LOD1_ELEMENT_DEPTH_M = 0.25


@dataclass(frozen=True)
class LodLevel:
    level: int
    geometric_error_m: float
    parts: dict[str, TriMesh]
    note: str = ""

    @property
    def triangle_count(self) -> int:
        return sum(m.triangle_count for m in self.parts.values())


def _error(full: TriMesh, reduced: TriMesh) -> float:
    if full.empty or reduced.empty:
        return 0.0
    return float(surface_distance(full.vertices, reduced).max())


def _boxed(profile: Profile) -> Profile:
    lat = profile.array[:, 0]
    up = profile.array[:, 1]
    return Profile(((lat.min(), up.min()), (lat.max(), up.min()), (lat.max(), up.max()),
                    (lat.min(), up.max())), closed=True)


def build_lods(geometry: object, material: str = "concrete") -> tuple[LodLevel, ...]:
    """LOD2 down to LOD0, finest first."""
    if isinstance(geometry, SplineExtrusion):
        full = geometry.to_mesh()
        mid = replace(geometry, path=geometry.path.simplified(LOD1_TOLERANCE_M / 5))
        mid_mesh = mid.to_mesh()
        coarse = SplineExtrusion(geometry.path.simplified(LOD0_PATH_TOLERANCE_M),
                                 tuple(ProfileKey(k.s_m, _boxed(k.profile))
                                       for k in geometry.profiles[:1]), caps=True)
        coarse_mesh = coarse.to_mesh()
        return (LodLevel(2, 0.0, {material: full}, "measured path and section"),
                LodLevel(1, _error(full, mid_mesh), {material: mid_mesh}, "path to 1 cm"),
                LodLevel(0, _error(full, coarse_mesh), {material: coarse_mesh},
                         "path to 50 cm, section boxed"))
    if isinstance(geometry, PrimitiveAssembly):
        full = geometry.to_mesh(24)
        mid = geometry.to_mesh(8)
        box = oriented_box(full)
        return (LodLevel(2, 0.0, {material: full}, "fitted primitives"),
                LodLevel(1, _error(full, mid), {material: mid}, "eight-sided"),
                LodLevel(0, _error(full, box), {material: box}, "upright box"))
    if isinstance(geometry, FreeformMesh):
        full = geometry.mesh
        simplified = simplify_to_tolerance(full, LOD1_TOLERANCE_M)
        box = oriented_box(full)
        return (LodLevel(2, 0.0, {material: full}, "reconstructed surface"),
                LodLevel(1, simplified.error_m, {material: simplified.mesh},
                         f"clustered at {simplified.cell_m:.3f} m"),
                LodLevel(0, _error(full, box), {material: box}, "upright box"))
    if isinstance(geometry, ParametricBuilding):
        full_parts = geometry.material_meshes()
        full = TriMesh.merge(list(full_parts.values()))
        facades = tuple(replace(f, elements=tuple(
            e for e in f.elements if abs(e.depth_m) >= LOD1_ELEMENT_DEPTH_M))
            for f in geometry.facades)
        mid_parts = replace(geometry, facades=facades).material_meshes()
        plain_parts = replace(geometry, facades=()).material_meshes()
        mid = TriMesh.merge(list(mid_parts.values()))
        plain = TriMesh.merge(list(plain_parts.values()))
        return (LodLevel(2, 0.0, full_parts, "every measured element"),
                LodLevel(1, _error(full, mid), mid_parts, "silhouette elements only"),
                LodLevel(0, _error(full, plain), plain_parts, "footprint and roof"))
    raise TypeError(f"no levels of detail for {type(geometry).__name__}")


def triangle_budget(levels: tuple[LodLevel, ...]) -> dict[int, int]:
    return {lvl.level: lvl.triangle_count for lvl in levels}


def is_monotonic(levels: tuple[LodLevel, ...]) -> bool:
    """Coarser levels never have less error, and never more triangles, than finer ones."""
    ordered = sorted(levels, key=lambda lvl: -lvl.level)
    errors = [lvl.geometric_error_m for lvl in ordered]
    tris = [lvl.triangle_count for lvl in ordered]
    return bool(np.all(np.diff(errors) >= -1e-9) and np.all(np.diff(tris) <= 0))
