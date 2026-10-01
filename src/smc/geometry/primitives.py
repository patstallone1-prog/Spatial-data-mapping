"""Fitted simple solids, alone or stacked: poles, bollards, hydrants, bins, cabinets.

A primitive here is *fitted*: its radius, height, footprint and orientation are the ones that
minimise the distance to the measured points, and the fit reports that distance. Whether the
object is then allowed to be a primitive is a separate question the caller answers with
:func:`fit_assembly`'s ``tolerance_m`` -- a bench that happens to fit a box to within 20 cm is
not a box, and is sent on to the freeform family rather than drawn as one.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Any, ClassVar

import numpy as np

from smc.geometry.base import (
    GeometryFamily,
    Param,
    TriMesh,
    params_from_json,
    params_json,
    register,
)

KINDS = ("box", "cylinder", "frustum", "plane", "ellipsoid")


@dataclass(frozen=True)
class Primitive:
    """One solid in the object's local frame.

    ``base`` is the centre of the solid's bottom (for an ellipsoid, the bottom of its
    bounding box); ``dims`` are ``(sx, sy, sz)`` for a box or plane, ``(r, r, h)`` for a
    cylinder, ``(r_bottom, r_top, h)`` for a frustum, ``(rx, ry, rz)`` for an ellipsoid;
    ``yaw`` turns it about the vertical.
    """

    kind: str
    base: tuple[float, float, float]
    dims: tuple[float, float, float]
    yaw: float = 0.0

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown primitive {self.kind!r}")
        if any(not math.isfinite(v) or v < 0 for v in self.dims):
            raise ValueError("primitive dimensions must be finite and non-negative")
        object.__setattr__(self, "base", tuple(float(v) for v in self.base))
        object.__setattr__(self, "dims", tuple(float(v) for v in self.dims))

    def _local(self, points: np.ndarray) -> np.ndarray:
        rel = np.asarray(points, dtype=np.float64).reshape(-1, 3) - np.asarray(self.base)
        c, s = math.cos(-self.yaw), math.sin(-self.yaw)
        return np.column_stack([c * rel[:, 0] - s * rel[:, 1], s * rel[:, 0] + c * rel[:, 1],
                                rel[:, 2]])

    def distance(self, points: np.ndarray) -> np.ndarray:
        """Unsigned distance from each point to the solid's surface."""
        q = self._local(points)
        a, b, h = self.dims
        if self.kind == "box":
            d = np.abs(q - np.array([0.0, 0.0, h / 2.0])) - np.array([a / 2.0, b / 2.0, h / 2.0])
            outside = np.linalg.norm(np.maximum(d, 0.0), axis=1)
            inside = np.minimum(d.max(axis=1), 0.0)
            return np.abs(outside + inside)
        if self.kind in ("cylinder", "frustum"):
            r_bottom, r_top = (a, a) if self.kind == "cylinder" else (a, b)
            radius = r_bottom + (r_top - r_bottom) * np.clip(q[:, 2] / max(h, 1e-9), 0.0, 1.0)
            slope = math.cos(math.atan2(abs(r_top - r_bottom), max(h, 1e-9)))
            qr = (np.hypot(q[:, 0], q[:, 1]) - radius) * slope
            qz = np.abs(q[:, 2] - h / 2.0) - h / 2.0
            d = np.column_stack([qr, qz])
            return np.abs(np.linalg.norm(np.maximum(d, 0.0), axis=1) + np.minimum(d.max(axis=1), 0))
        if self.kind == "ellipsoid":
            radii = np.array([a, b, h])
            centred = q - np.array([0.0, 0.0, h])
            k = np.linalg.norm(centred / np.maximum(radii, 1e-9), axis=1)
            return np.abs((k - 1.0) * radii.min())
        # plane: a rectangle standing on its base, width along local x, height up, facing -y
        dx = np.maximum(np.abs(q[:, 0]) - a / 2.0, 0.0)
        dz = np.maximum(np.abs(q[:, 2] - h / 2.0) - h / 2.0, 0.0)
        return np.sqrt(dx * dx + q[:, 1] ** 2 + dz * dz)

    def to_mesh(self, segments: int = 16) -> TriMesh:
        a, b, h = self.dims
        if self.kind == "box" or (self.kind == "plane" and b > 0):
            mesh = _box_mesh(a, b if self.kind == "box" else max(b, 0.005), h)
        elif self.kind == "plane":
            v = np.array([[-a / 2, 0, 0], [a / 2, 0, 0], [a / 2, 0, h], [-a / 2, 0, h]])
            faces = np.array([[0, 1, 2], [0, 2, 3], [0, 2, 1], [0, 3, 2]])
            mesh = TriMesh(v, faces)
        elif self.kind in ("cylinder", "frustum"):
            r_top = a if self.kind == "cylinder" else b
            mesh = _frustum_mesh(a, r_top, h, segments)
        else:
            mesh = _ellipsoid_mesh(a, b, h, segments)
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        v = mesh.vertices
        rotated = np.column_stack([c * v[:, 0] - s * v[:, 1], s * v[:, 0] + c * v[:, 1], v[:, 2]])
        return TriMesh(rotated + np.asarray(self.base), mesh.faces).with_normals()

    def to_json(self) -> dict[str, Any]:
        return {"kind": self.kind, "base": [round(v, 4) for v in self.base],
                "dims": [round(v, 4) for v in self.dims], "yaw": round(self.yaw, 5)}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Primitive:
        return cls(data["kind"], tuple(data["base"]), tuple(data["dims"]), float(data["yaw"]))


def _box_mesh(sx: float, sy: float, sz: float) -> TriMesh:
    x, y = sx / 2.0, sy / 2.0
    corners = np.array([[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0],
                        [-x, -y, sz], [x, -y, sz], [x, y, sz], [-x, y, sz]], dtype=np.float64)
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    verts, faces = [], []
    for quad in quads:  # four vertices per face so each face keeps its own normal
        base = len(verts)
        verts.extend(corners[list(quad)])
        faces.extend([(base, base + 1, base + 2), (base, base + 2, base + 3)])
    return TriMesh(np.asarray(verts), np.asarray(faces))


def _frustum_mesh(r0: float, r1: float, h: float, segments: int) -> TriMesh:
    angle = np.linspace(0.0, 2 * math.pi, segments, endpoint=False)
    ring = np.column_stack([np.cos(angle), np.sin(angle)])
    bottom = np.column_stack([ring * r0, np.zeros(segments)])
    top = np.column_stack([ring * r1, np.full(segments, h)])
    verts = [bottom, top, [[0.0, 0.0, 0.0]], [[0.0, 0.0, h]]]
    v = np.concatenate(verts)
    faces = []
    for k in range(segments):
        a, b = k, (k + 1) % segments
        faces += [(a, b, segments + b), (a, segments + b, segments + a)]
        faces.append((2 * segments, b, a))
        faces.append((2 * segments + 1, segments + a, segments + b))
    return TriMesh(v, np.asarray(faces))


def _ellipsoid_mesh(rx: float, ry: float, rz: float, segments: int) -> TriMesh:
    rings = max(4, segments // 2)
    verts, faces = [], []
    for i in range(rings + 1):
        phi = math.pi * i / rings
        for j in range(segments):
            theta = 2 * math.pi * j / segments
            verts.append((rx * math.sin(phi) * math.cos(theta),
                          ry * math.sin(phi) * math.sin(theta), rz - rz * math.cos(phi)))
    for i in range(rings):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            c, d = a + segments, b + segments
            faces += [(a, c, d), (a, d, b)]
    return TriMesh(np.asarray(verts), np.asarray(faces)).without_degenerate_faces()


# ------------------------------------------------------------------------------ fitting ----


def fit_circle(xy: np.ndarray, iterations: int = 20) -> tuple[np.ndarray, float]:
    """Geometric least-squares circle: algebraic start, Gauss-Newton on true distances."""
    x, y = xy[:, 0], xy[:, 1]
    design = np.column_stack([x, y, np.ones_like(x)])
    sol, *_ = np.linalg.lstsq(design, x * x + y * y, rcond=None)
    centre = np.array([sol[0] / 2.0, sol[1] / 2.0])
    radius = math.sqrt(max(sol[2] + centre @ centre, 1e-12))
    for _ in range(iterations):
        rel = xy - centre
        dist = np.linalg.norm(rel, axis=1)
        dist = np.maximum(dist, 1e-12)
        jac = np.column_stack([-rel[:, 0] / dist, -rel[:, 1] / dist, -np.ones(len(xy))])
        step, *_ = np.linalg.lstsq(jac, -(dist - radius), rcond=None)
        centre = centre + step[:2]
        radius = radius + step[2]
        if np.abs(step).max() < 1e-9:
            break
    return centre, abs(float(radius))


def convex_hull(xy: np.ndarray) -> np.ndarray:
    """Monotone chain, counter-clockwise."""
    pts = np.unique(np.round(np.asarray(xy, dtype=np.float64), 9), axis=0)
    if len(pts) < 3:
        return pts

    def cross(o: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
        return float((a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]))

    lower: list[np.ndarray] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[np.ndarray] = []
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.asarray(lower[:-1] + upper[:-1])


def min_area_rectangle(xy: np.ndarray) -> tuple[np.ndarray, float, float, float]:
    """Smallest enclosing rectangle: centre, yaw, length, width (rotating the hull's edges)."""
    hull = convex_hull(xy)
    if len(hull) < 3:
        centre = np.asarray(xy).mean(axis=0)
        return centre, 0.0, 0.0, 0.0
    best = (math.inf, np.zeros(2), 0.0, 0.0, 0.0)
    for a, b in itertools.pairwise(np.vstack([hull, hull[:1]])):
        angle = math.atan2(b[1] - a[1], b[0] - a[0])
        c, s = math.cos(-angle), math.sin(-angle)
        rot = np.column_stack([c * hull[:, 0] - s * hull[:, 1], s * hull[:, 0] + c * hull[:, 1]])
        lo, hi = rot.min(axis=0), rot.max(axis=0)
        area = float(np.prod(hi - lo))
        if area < best[0]:
            mid = (lo + hi) / 2.0
            cb, sb = math.cos(angle), math.sin(angle)
            centre = np.array([cb * mid[0] - sb * mid[1], sb * mid[0] + cb * mid[1]])
            best = (area, centre, angle, float(hi[0] - lo[0]), float(hi[1] - lo[1]))
    return best[1], best[2], best[3], best[4]


@dataclass(frozen=True)
class PrimitiveFit:
    primitive: Primitive
    rms_m: float
    max_m: float


def _score(primitive: Primitive, points: np.ndarray) -> PrimitiveFit:
    d = primitive.distance(points)
    return PrimitiveFit(primitive, float(np.sqrt(np.mean(d * d))), float(d.max()))


def fit_cylinder(points: np.ndarray) -> PrimitiveFit:
    """A vertical cylinder: circle through the plan, height from the vertical extent."""
    pts = np.asarray(points, dtype=np.float64)
    centre, radius = fit_circle(pts[:, :2])
    bottom, top = np.percentile(pts[:, 2], [0.5, 99.5])
    prim = Primitive("cylinder", (centre[0], centre[1], bottom), (radius, radius, top - bottom))
    return _score(prim, pts)


def fit_box(points: np.ndarray) -> PrimitiveFit:
    pts = np.asarray(points, dtype=np.float64)
    centre, yaw, length, width = min_area_rectangle(pts[:, :2])
    bottom, top = np.percentile(pts[:, 2], [0.5, 99.5])
    prim = Primitive("box", (centre[0], centre[1], bottom), (length, width, top - bottom), yaw)
    return _score(prim, pts)


def fit_vertical_stack(points: np.ndarray, slice_m: float = 0.05, max_parts: int = 4,
                       radius_tolerance_m: float = 0.02) -> list[PrimitiveFit]:
    """A column of round parts -- a hydrant's barrel, bonnet and cap; a bollard's head.

    The radius is measured slice by slice up the object; runs where it holds (a cylinder) or
    changes at a steady rate (a frustum) become one part each, merged greedily while the merged
    part still fits every slice it covers to ``radius_tolerance_m``.
    """
    pts = np.asarray(points, dtype=np.float64)
    z0, z1 = float(pts[:, 2].min()), float(pts[:, 2].max())
    centre, _ = fit_circle(pts[:, :2])
    edges = np.arange(z0, z1 + slice_m, slice_m)
    slices: list[tuple[float, float, float]] = []
    for lo, hi in itertools.pairwise(edges):
        band = pts[(pts[:, 2] >= lo) & (pts[:, 2] < hi)]
        if len(band) < 6:
            continue
        r = float(np.median(np.linalg.norm(band[:, :2] - centre, axis=1)))
        slices.append((lo, hi, r))
    if not slices:
        return []
    runs: list[list[tuple[float, float, float]]] = [[s] for s in slices]

    def run_fits(run: list[tuple[float, float, float]]) -> bool:
        z = np.array([(a + b) / 2 for a, b, _ in run])
        r = np.array([c for _, _, c in run])
        if len(run) < 2:
            return True
        coef = np.polyfit(z, r, 1)
        return float(np.abs(np.polyval(coef, z) - r).max()) <= radius_tolerance_m

    merged = True
    while merged and len(runs) > 1:
        merged = False
        best_k, best_err = -1, math.inf
        for k in range(len(runs) - 1):
            candidate = runs[k] + runs[k + 1]
            if run_fits(candidate):
                z = np.array([(a + b) / 2 for a, b, _ in candidate])
                r = np.array([c for _, _, c in candidate])
                err = float(np.std(r - np.polyval(np.polyfit(z, r, 1), z)))
                if err < best_err:
                    best_k, best_err = k, err
        if best_k >= 0:
            runs[best_k:best_k + 2] = [runs[best_k] + runs[best_k + 1]]
            merged = True
    while len(runs) > max_parts:  # force the tolerance open rather than exceed the part count
        k = int(np.argmin([len(a) + len(b) for a, b in itertools.pairwise(runs)]))
        runs[k:k + 2] = [runs[k] + runs[k + 1]]
    fits: list[PrimitiveFit] = []
    for run in runs:
        lo, hi = run[0][0], run[-1][1]
        z = np.array([(a + b) / 2 for a, b, _ in run])
        r = np.array([c for _, _, c in run])
        coef = np.polyfit(z, r, 1) if len(run) > 1 else np.array([0.0, r[0]])
        r_bottom, r_top = float(np.polyval(coef, lo)), float(np.polyval(coef, hi))
        base = (float(centre[0]), float(centre[1]), lo)
        if abs(r_top - r_bottom) <= radius_tolerance_m:
            radius = float(np.mean(r))
            prim = Primitive("cylinder", base, (radius, radius, hi - lo))
        else:
            prim = Primitive("frustum", base, (max(r_bottom, 0.0), max(r_top, 0.0), hi - lo))
        band = pts[(pts[:, 2] >= lo) & (pts[:, 2] <= hi)]
        fits.append(_score(prim, band))
    return fits


@register
@dataclass(frozen=True)
class PrimitiveAssembly:
    """One object as a few fitted solids."""

    family: ClassVar[GeometryFamily] = GeometryFamily.PRIMITIVE_ASSEMBLY

    parts: tuple[Primitive, ...]
    params: dict[str, Param] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.parts:
            raise ValueError("an assembly needs at least one part")

    def distance(self, points: np.ndarray) -> np.ndarray:
        return np.min(np.stack([p.distance(points) for p in self.parts]), axis=0)

    def to_mesh(self, segments: int = 16) -> TriMesh:
        return TriMesh.merge([p.to_mesh(segments) for p in self.parts])

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        return self.to_mesh(8).bounds()

    def to_json(self) -> dict[str, Any]:
        return {"parts": [p.to_json() for p in self.parts], "params": params_json(self.params)}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> PrimitiveAssembly:
        return cls(tuple(Primitive.from_json(p) for p in data["parts"]),
                   params_from_json(data.get("params")))


def fit_assembly(points: np.ndarray, tolerance_m: float) -> tuple[PrimitiveAssembly, float] | None:
    """The simplest assembly that fits the points to ``tolerance_m`` rms, or None.

    Tried in order of simplicity: one cylinder, one box, a stack of round parts. None fitting
    is an answer -- the object is not a primitive, and should not be drawn as one.
    """
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 12:
        return None
    candidates: list[tuple[PrimitiveAssembly, float]] = []
    for fit in (fit_cylinder(pts), fit_box(pts)):
        if fit.rms_m <= tolerance_m:
            candidates.append((PrimitiveAssembly((fit.primitive,)), fit.rms_m))
    if candidates:
        return min(candidates, key=lambda c: c[1])
    stack = fit_vertical_stack(pts)
    if stack:
        assembly = PrimitiveAssembly(tuple(f.primitive for f in stack))
        d = assembly.distance(pts)
        rms = float(np.sqrt(np.mean(d * d)))
        if rms <= tolerance_m:
            return assembly, rms
    return None
