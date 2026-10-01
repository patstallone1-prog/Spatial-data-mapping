"""World objects compiled for the things that draw them.

The canonical object is renderer-neutral; each consumer gets a compiled form of it:

* **web** -- a JSON sidecar the page reads beside its other data. A swept object is sent as
  its path and section at each level of detail, because that *is* its geometry and is a
  thousandth the size of the triangles; the page runs the same sweep the canonical object
  defines. Everything else is sent as triangles per level and material. Nothing carries a
  model name for the page to look up: the page is told the shape.
* **glb** -- one binary glTF per object through the existing deterministic writer
  (:func:`smc.reconstruction.glb.write_visual_glb`), for Unreal and anything else that reads
  glTF.

The page stands web geometry on its own ground: a swept object vertex by vertex (a kerb
follows the hill it is on), a rigid object at its anchor. The measured heights stay in the
canonical record; the page's job is to put the object on the page's ground, not to trust a
second, slightly different ground.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from smc.geometry.base import TriMesh
from smc.geometry.extrusion import SplineExtrusion
from smc.world.lod import LodLevel, build_lods
from smc.world.object import GeometryBasis, WorldObject

WEB_SCHEMA = "kerbside.world_objects.web/1"
#: How far from a reconstructed kerb a drawn kerb counts as the same kerb, for the page's
#: rule that a reconstructed object is drawn instead of, not on top of, the legacy one.
KERB_CLAIM_M = 1.5
#: Furniture claims a disc this much wider than its own half-diagonal.
FURNITURE_CLAIM_PAD_M = 0.75
#: Web geometry is written in whole millimetres.
MM = 1000.0
#: The level the page draws a swept object at: its path to a centimetre.
WEB_SWEEP_TOLERANCE_M = 0.01
#: Swept objects that run along the ground -- sent as a path and a section, draped vertex by
#: vertex onto the page's ground, and claiming a stretch of line. Any other swept object (a
#: curved bench) is compact and rigid: sent as triangles, stood on the pavement at its anchor,
#: and claiming a disc.
#: The public likeness (docs/25, "Internal truth, public likeness"): the page receives no level
#: finer than the coarsest one that already looks the same from the nearest a visitor can stand.
#: "Looks the same" is the page's own rule -- TILE_MAX_SCREEN_ERROR_PX with its 50 degree camera
#: -- on a 1080-pixel-high view, at arm's length in first person.
PUBLIC_NEAREST_M = 1.5
PUBLIC_SCREEN_ERROR_PX = 3.0
PUBLIC_FOV_DEG = 50.0
PUBLIC_VIEW_PX = 1080


def public_error_budget_m(distance_m: float = PUBLIC_NEAREST_M) -> float:
    per_pixel = 2 * np.tan(np.radians(PUBLIC_FOV_DEG) / 2) / PUBLIC_VIEW_PX
    return float(per_pixel * PUBLIC_SCREEN_ERROR_PX * distance_m)


def public_levels(levels: tuple[LodLevel, ...]) -> tuple[LodLevel, ...]:
    """The levels a visitor could tell apart. Finer ones stay in the canonical object only; if
    no level passes, every level ships (the object is as fine as it needs to be)."""
    budget = public_error_budget_m()
    passing = [lvl for lvl in levels if lvl.geometric_error_m <= budget]
    if not passing:
        return levels
    likeness = max(passing, key=lambda lvl: lvl.geometric_error_m)
    return tuple(lvl for lvl in levels if lvl.geometric_error_m >= likeness.geometric_error_m)


LINEAR_TYPES = frozenset({"curb", "kerb", "median", "sidewalk_edge", "fence", "rail",
                          "railing", "guardrail", "barrier", "retaining_wall", "lane_marking"})


def _mm(values: np.ndarray) -> list[int]:
    return np.round(np.asarray(values, dtype=np.float64) * MM).astype(np.int64).ravel().tolist()


def _lonlat(obj: WorldObject, local_xy: np.ndarray) -> list[list[float]]:
    """Local east/north metres back to WGS84, at the anchor's latitude (objects are small)."""
    lon0, lat0, _ = obj.anchor
    per_lat = 111_132.954 - 559.822 * np.cos(2 * np.radians(lat0))
    per_lon = 111_412.84 * np.cos(np.radians(lat0))
    lon = lon0 + local_xy[:, 0] / per_lon
    lat = lat0 + local_xy[:, 1] / per_lat
    return [[round(float(a), 8), round(float(b), 8)] for a, b in zip(lon, lat, strict=True)]


def _claim(obj: WorldObject) -> dict[str, Any] | None:
    geometry = obj.geometry
    if geometry is None or obj.basis not in (GeometryBasis.MEASURED, GeometryBasis.INFERRED):
        return None
    if isinstance(geometry, SplineExtrusion) and obj.semantic_type in LINEAR_TYPES:
        # The line claimed is the swept path the page is already sent; it is not sent twice.
        return {"kind": obj.semantic_type, "along": "sweep", "reach_m": KERB_CLAIM_M}
    lo, hi = geometry.bounds()
    centre = (lo[:2] + hi[:2]) / 2.0
    radius = float(np.linalg.norm(hi[:2] - lo[:2]) / 2.0) + FURNITURE_CLAIM_PAD_M
    return {"kind": obj.semantic_type, "point": _lonlat(obj, centre[None, :])[0],
            "reach_m": round(radius, 3)}


def _mesh_levels(levels: tuple[LodLevel, ...], base_z: float) -> list[dict[str, Any]]:
    out = []
    for level in levels:
        parts = []
        for material, mesh in sorted(level.parts.items()):
            if mesh.empty:
                continue
            v = mesh.vertices.copy()
            v[:, 2] -= base_z
            parts.append({"material": material, "v": _mm(v), "i": mesh.faces.ravel().tolist()})
        out.append({"level": level.level, "err_m": round(level.geometric_error_m, 4),
                    "parts": parts})
    return out


class _Legend:
    """Strings that repeat across thousands of objects, sent once and cited by number."""

    def __init__(self) -> None:
        self.values: list[str] = []
        self.index: dict[str, int] = {}

    def __call__(self, value: str | None) -> int | None:
        if value is None:
            return None
        if value not in self.index:
            self.index[value] = len(self.values)
            self.values.append(value)
        return self.index[value]


def web_record(obj: WorldObject, legend: _Legend | None = None) -> dict[str, Any] | None:
    """One object as the page receives it, or None if there is nothing to draw.

    The page receives what it draws: for a swept object along the ground, the one level it
    draws (level 1, the path to a centimetre); for anything else, the levels it switches
    between, down to the public likeness (:func:`public_levels`) and no finer. The canonical
    object keeps every level for everything.
    """
    if obj.geometry is None or obj.detail.value == "none":
        return None
    legend = legend or _Legend()
    geometry = obj.geometry
    record: dict[str, Any] = {
        "id": obj.id, "type": obj.semantic_type, "family": obj.family,
        "basis": str(obj.basis), "detail": str(obj.detail),
        "confidence": round(obj.confidence, 3), "material": obj.material,
        "anchor": [round(obj.anchor[0], 8), round(obj.anchor[1], 8)],
        "prov": {
            "method": legend(obj.fit.method if obj.fit else None),
            "grade": obj.evidence.grade,
            "sources": [legend(s) for s in sorted({r.source_id for r in obj.evidence.refs})],
            "observations": obj.evidence.observation_count,
        },
    }
    if obj.flags:
        record["flags"] = list(obj.flags)
    if obj.evidence.fit_rms_m:
        record["prov"]["fit_rms_m"] = round(obj.evidence.fit_rms_m, 4)
    claim = _claim(obj)
    if claim is not None:
        record["claim"] = claim
    if isinstance(geometry, SplineExtrusion) and obj.semantic_type in LINEAR_TYPES:
        path = geometry.path.simplified(WEB_SWEEP_TOLERANCE_M)
        level = {"level": 1, "err_m": round(_path_error(geometry, path), 4),
                 "path": _mm(path.points[:, :2])}
        if path.breaks:
            level["breaks"] = list(path.breaks)
        if path.closed:
            level["closed"] = True
        profile = geometry.profiles[0].profile
        sweep: dict[str, Any] = {
            "lods": [level], "profile": _mm(profile.array),
            # Each dimension's value and grade; the notes stay in the canonical record.
            "params": {k: {"value": round(p.value, 4), "grade": p.grade}
                       for k, p in geometry.params.items()},
        }
        if profile.closed:
            sweep["closed_profile"] = True
        if geometry.caps:
            sweep["caps"] = True
        record["sweep"] = sweep
        return record
    levels = build_lods(geometry, obj.material)
    if obj.detail.value == "conservative":
        levels = tuple(lvl for lvl in levels if lvl.level < 2)
    levels = public_levels(levels)
    lo, _ = geometry.bounds()
    record["mesh"] = {"base_z": round(float(lo[2]), 4), "lods": _mesh_levels(levels, float(lo[2]))}
    return record


def _path_error(geometry: SplineExtrusion, simplified: Any) -> float:
    """How far the full path strays from a simplified one: that level's geometric error."""
    return float(simplified.distance_to(geometry.path.points).max())


def compile_web(objects: list[WorldObject], *, region: str, sources: dict[str, Any]
                ) -> dict[str, Any]:
    legend = _Legend()
    records = [r for r in (web_record(o, legend) for o in objects) if r is not None]
    by_basis: dict[str, int] = {}
    for obj in objects:
        by_basis[str(obj.basis)] = by_basis.get(str(obj.basis), 0) + 1
    return {
        "schema": WEB_SCHEMA,
        "region": region,
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "sources": sources,
        "counts": {"objects": len(objects), "drawn": len(records), "by_basis": by_basis},
        "legend": legend.values,
        "objects": records,
    }


def write_glb(obj: WorldObject, path: Path, level: int = 2) -> Path:
    """The object's chosen level as a binary glTF, in its own east/north/up frame (glTF's
    y-up: x east, y up, z south)."""
    from smc.reconstruction.glb import write_visual_glb

    if obj.geometry is None:
        raise ValueError(f"{obj.id} has no geometry to write")
    lods = {lvl.level: lvl for lvl in build_lods(obj.geometry, obj.material)}
    mesh = TriMesh.merge(list(lods[level].parts.values())).with_normals()
    v = mesh.vertices
    n = mesh.normals if mesh.normals is not None else np.zeros_like(v)
    positions = np.column_stack([v[:, 0], v[:, 2], -v[:, 1]])
    normals = np.column_stack([n[:, 0], n[:, 2], -n[:, 1]])
    write_visual_glb(path, positions, normals, mesh.faces, cell_id=obj.id)
    return path
