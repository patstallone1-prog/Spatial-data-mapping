"""A cross-section swept along a path: kerbs, fences, rails, medians, some benches.

The path is whatever :mod:`smc.geometry.spline` fitted -- straight, rounded, sharp, an S, a
bulb-out -- and the profile is whatever was measured across it. Nothing here knows what a
corner piece is. A rounded kerb return is a kerb profile swept round a rounded path; a
square one is the same profile swept round a path with a break in it, mitred, so the two
faces meet on the bisector as a mason would cut them.

Profile convention: points are ``(lateral, up)`` in metres, lateral measured to the *left*
of the path's direction of travel, up along world vertical (a kerb face stays plumb on a
hill). The surface faces to the right of the direction the profile is traversed, so a closed
profile runs counter-clockwise and an open one -- a kerb, whose back is buried in the
footway -- runs so its visible faces are on its right. :func:`kerb_profile` is the example.
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
from smc.geometry.spline import PiecewisePath

#: A mitre longer than this many profile widths is bevelled instead: a very acute corner
#: would otherwise throw its outer edge metres past the vertex.
MITER_LIMIT = 4.0


@dataclass(frozen=True)
class Profile:
    """A cross-section: ``(lateral, up)`` points, metres."""

    points: tuple[tuple[float, float], ...]
    closed: bool = False

    def __post_init__(self) -> None:
        pts = tuple((float(a), float(b)) for a, b in self.points)
        if len(pts) < 2:
            raise ValueError("a profile needs at least two points")
        if not all(math.isfinite(a) and math.isfinite(b) for a, b in pts):
            raise ValueError("profile points must be finite")
        object.__setattr__(self, "points", pts)

    @property
    def array(self) -> np.ndarray:
        return np.asarray(self.points, dtype=np.float64)

    def lateral_extent(self) -> tuple[float, float]:
        lat = self.array[:, 0]
        return float(lat.min()), float(lat.max())

    def signed_area(self) -> float:
        a = self.array
        return 0.5 * float(np.sum(a[:, 0] * np.roll(a[:, 1], -1) - np.roll(a[:, 0], -1) * a[:, 1]))

    def to_json(self) -> dict[str, Any]:
        return {"points": [[round(a, 4), round(b, 4)] for a, b in self.points],
                "closed": self.closed}

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Profile:
        return cls(tuple(tuple(p) for p in data["points"]), bool(data.get("closed", False)))


@dataclass(frozen=True)
class ProfileKey:
    """The profile in force from ``s_m`` along the path (interpolated to the next key)."""

    s_m: float
    profile: Profile


def kerb_profile(height_m: float, top_width_m: float = 0.15, batter_m: float = 0.015,
                 side: int = 1) -> Profile:
    """A kerb: the face rising from the gutter, and the top back to where the footway begins.

    ``side`` is +1 when the footway is to the left of the path's direction of travel, -1 to
    the right. The numbers are the kerb's own; the function only says how they fit together.
    """
    lateral = float(side)
    points = ((lateral * (batter_m + top_width_m), height_m), (lateral * batter_m, height_m),
              (0.0, 0.0))
    if side < 0:
        # Traversed the other way round so the faces still point at the road and the sky.
        points = ((0.0, 0.0), (lateral * batter_m, height_m),
                  (lateral * (batter_m + top_width_m), height_m))
    return Profile(points, closed=False)


def rectangle_profile(width_m: float, height_m: float, centre_lateral_m: float = 0.0,
                      base_m: float = 0.0) -> Profile:
    """A closed rectangle, counter-clockwise: a rail, a low wall, a slab."""
    half = width_m / 2.0
    c = centre_lateral_m
    return Profile(((c - half, base_m), (c + half, base_m), (c + half, base_m + height_m),
                    (c - half, base_m + height_m)), closed=True)


@register
@dataclass(frozen=True)
class SplineExtrusion:
    """A path and the profile swept along it."""

    family: ClassVar[GeometryFamily] = GeometryFamily.SPLINE_EXTRUSION

    path: PiecewisePath
    profiles: tuple[ProfileKey, ...]
    caps: bool = False
    params: dict[str, Param] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.profiles:
            raise ValueError("an extrusion needs a profile")
        keys = tuple(sorted(self.profiles, key=lambda k: k.s_m))
        counts = {len(k.profile.points) for k in keys}
        if len(keys) > 1 and len(counts) != 1:
            raise ValueError("profiles along one path must have the same number of points")
        object.__setattr__(self, "profiles", keys)

    def profile_at(self, s: np.ndarray) -> np.ndarray:
        """Profile points at each arc position: (len(s), P, 2)."""
        keys = self.profiles
        if len(keys) == 1:
            return np.broadcast_to(keys[0].profile.array, (len(s), *keys[0].profile.array.shape))
        stations = np.array([k.s_m for k in keys])
        arrays = np.stack([k.profile.array for k in keys])
        out = np.empty((len(s), *arrays.shape[1:]))
        for p in range(arrays.shape[1]):
            for c in range(2):
                out[:, p, c] = np.interp(s, stations, arrays[:, p, c])
        return out

    def rings(self) -> tuple[np.ndarray, np.ndarray, list[int]]:
        """The swept profile's vertices at every path vertex: (N', P, 3) positions, their arc
        positions, and the ring indices where the surface must break (duplicated rings)."""
        pts = self.path.points
        xy = pts[:, :2]
        n = len(pts)
        seg = np.diff(xy, axis=0)
        seg_len = np.linalg.norm(seg, axis=1)
        d = np.divide(seg, seg_len[:, None], out=np.zeros_like(seg), where=seg_len[:, None] > 0)
        # Carry a direction across any zero-length segment.
        for k in range(len(d)):
            if not d[k].any():
                d[k] = d[k - 1] if k else np.array([1.0, 0.0])
        left_seg = np.column_stack([-d[:, 1], d[:, 0]])
        miter = np.empty((n, 2))
        scale = np.ones(n)
        miter[0] = left_seg[0]
        miter[-1] = left_seg[-1]
        closed = self.path.closed and np.allclose(xy[0], xy[-1])
        for i in range(1, n - 1):
            m = left_seg[i - 1] + left_seg[i]
            norm = float(np.linalg.norm(m))
            if norm < 1e-9:  # a full reversal: nothing sensible to mitre
                miter[i] = left_seg[i]
                continue
            m /= norm
            cos_half = float(m @ left_seg[i])
            miter[i] = m
            scale[i] = min(1.0 / max(cos_half, 1e-6), MITER_LIMIT)
        if closed and n > 2:
            m = left_seg[-1] + left_seg[0]
            m /= max(float(np.linalg.norm(m)), 1e-9)
            miter[0] = miter[-1] = m
            scale[0] = scale[-1] = min(1.0 / max(float(m @ left_seg[0]), 1e-6), MITER_LIMIT)
        s = self.path.arc_length()
        prof = self.profile_at(s)  # (n, P, 2)
        lateral = prof[:, :, 0] * scale[:, None]
        # Where the path bends tighter than a profile point stands off it, that point's offset
        # line would cross itself on the inside of the bend. Pull such runs together.
        offsets = xy[:, None, :] + lateral[:, :, None] * miter[:, None, :]
        for k in range(offsets.shape[1]):
            offsets[:, k, :] = _unfold(offsets[:, k, :], xy)
        up = pts[:, 2][:, None] + prof[:, :, 1]
        rings = np.concatenate([offsets, up[:, :, None]], axis=2)
        return rings, s, list(self.path.breaks)

    def to_mesh(self) -> TriMesh:
        rings, s, breaks = self.rings()
        n, count, _ = rings.shape
        prof0 = self.profiles[0].profile
        closed_profile = prof0.closed
        edges = [(k, k + 1) for k in range(count - 1)]
        if closed_profile:
            edges.append((count - 1, 0))
        # Profile arc position of each profile point, for the across-texture coordinate.
        pa = prof0.array
        v_at = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pa, axis=0), axis=1))])
        v_close = float(v_at[-1] + np.linalg.norm(pa[-1] - pa[0]))
        # Split the ring sequence at breaks: each smooth piece is its own strip set, so the two
        # faces of a sharp corner get their own normals and the corner stays sharp on screen.
        cuts = [0, *breaks, n - 1]
        meshes: list[TriMesh] = []
        for a, b in itertools.pairwise(cuts):
            piece = rings[a:b + 1]
            ps = s[a:b + 1]
            for k0, k1 in edges:
                verts = np.concatenate([piece[:, k0, :], piece[:, k1, :]])
                m = len(piece)
                uv0 = v_at[k0]
                uv1 = v_at[k1] if k1 != 0 or not closed_profile else v_close
                uvs = np.concatenate([np.column_stack([ps, np.full(m, uv0)]),
                                      np.column_stack([ps, np.full(m, uv1)])])
                faces = []
                for i in range(m - 1):
                    A, B, C, D = i, m + i, m + i + 1, i + 1
                    faces.append((A, B, C))
                    faces.append((A, C, D))
                meshes.append(TriMesh(verts, np.asarray(faces, dtype=np.int64), None, uvs)
                              .without_degenerate_faces().with_normals())
        if self.caps and closed_profile:
            for ring, flip in ((rings[0], True), (rings[-1], False)):
                tris = triangulate_polygon(prof0.array)
                faces = np.asarray(tris, dtype=np.int64)
                if flip:
                    faces = faces[:, ::-1]
                meshes.append(TriMesh(ring, faces, None, ring[:, :2] * 0.0).with_normals())
        return TriMesh.merge(meshes)

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        rings, _, _ = self.rings()
        flat = rings.reshape(-1, 3)
        return flat.min(axis=0), flat.max(axis=0)

    def to_json(self) -> dict[str, Any]:
        return {
            "path": self.path.to_json(),
            "profiles": [{"s_m": round(k.s_m, 3), **k.profile.to_json()} for k in self.profiles],
            "caps": self.caps,
            "params": params_json(self.params),
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> SplineExtrusion:
        keys = tuple(ProfileKey(float(k["s_m"]), Profile.from_json(k)) for k in data["profiles"])
        return cls(PiecewisePath.from_json(data["path"]), keys, bool(data.get("caps")),
                   params_from_json(data.get("params")))


def _unfold(offset: np.ndarray, path_xy: np.ndarray, rounds: int = 8) -> np.ndarray:
    """Collapse runs of an offset line that run backwards against the path."""
    out = offset.copy()
    for _ in range(rounds):
        d_off = np.diff(out, axis=0)
        d_path = np.diff(path_xy, axis=0)
        backwards = np.flatnonzero(np.sum(d_off * d_path, axis=1) < 0)
        if not backwards.size:
            break
        for k in backwards:
            mid = (out[k] + out[k + 1]) / 2.0
            out[k] = mid
            out[k + 1] = mid
    return out


def triangulate_polygon(polygon: np.ndarray) -> list[tuple[int, int, int]]:
    """Ear clipping for a simple polygon, counter-clockwise or not."""
    pts = np.asarray(polygon, dtype=np.float64)[:, :2]
    idx = list(range(len(pts)))
    area = 0.5 * float(np.sum(pts[:, 0] * np.roll(pts[:, 1], -1)
                              - np.roll(pts[:, 0], -1) * pts[:, 1]))
    if area < 0:
        idx.reverse()
    tris: list[tuple[int, int, int]] = []

    def inside(p: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> bool:
        d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0])
        d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0])
        return d1 >= 0 and d2 >= 0 and d3 >= 0

    guard = 0
    while len(idx) > 3 and guard < 10_000:
        guard += 1
        clipped = False
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-12:
                continue
            if any(inside(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2) if area >= 0 else (i2, i1, i0))
            idx.pop(k)
            clipped = True
            break
        if not clipped:
            break
    if len(idx) == 3:
        i0, i1, i2 = idx
        tris.append((i0, i1, i2) if area >= 0 else (i2, i1, i0))
    return tris


def profile_from_points(lateral_up: np.ndarray, cell_m: float = 0.03,
                        tolerance_m: float = 0.015) -> Profile:
    """The outline of a scatter of cross-section points, as a closed counter-clockwise profile.

    Points are binned into cells; the boundary between occupied and empty cells is chained
    into loops; the longest loop (the outside) is simplified to ``tolerance_m``. An L-shaped
    bench section comes out L-shaped: nothing here assumes the outline is convex.
    """
    pts = np.asarray(lateral_up, dtype=np.float64).reshape(-1, 2)
    if len(pts) < 3:
        raise ValueError("too few points for a cross-section")
    # Two empty cells of margin all round, so closing never meets the edge of the grid.
    origin = pts.min(axis=0) - 2 * cell_m
    # A point exactly on a cell boundary -- the lowest point is, by construction -- belongs to
    # the cell above it, not to whichever side rounding puts it.
    cells = np.floor((pts - origin) / cell_m + 1e-9).astype(np.int64)
    shape = cells.max(axis=0) + 3
    grid = np.zeros(tuple(int(v) for v in shape), dtype=bool)
    grid[cells[:, 0], cells[:, 1]] = True
    # Close pinholes a cell wide, where sampling happened to miss.
    grown = grid.copy()
    grown[1:, :] |= grid[:-1, :]
    grown[:-1, :] |= grid[1:, :]
    grown[:, 1:] |= grid[:, :-1]
    grown[:, :-1] |= grid[:, 1:]
    closed = grown.copy()
    closed[1:, :] &= grown[:-1, :]
    closed[:-1, :] &= grown[1:, :]
    closed[:, 1:] &= grown[:, :-1]
    closed[:, :-1] &= grown[:, 1:]
    grid = _solid_without_pinches(closed | grid)
    edges: dict[tuple[int, int], tuple[int, int]] = {}
    nx, ny = grid.shape
    for i in range(nx):
        for j in range(ny):
            if not grid[i, j]:
                continue
            # Counter-clockwise edges of the cell; an edge shared with a filled neighbour is
            # interior and never added.
            if j == 0 or not grid[i, j - 1]:
                edges[(i, j)] = (i + 1, j)
            if i == nx - 1 or not grid[i + 1, j]:
                edges[(i + 1, j)] = (i + 1, j + 1)
            if j == ny - 1 or not grid[i, j + 1]:
                edges[(i + 1, j + 1)] = (i, j + 1)
            if i == 0 or not grid[i - 1, j]:
                edges[(i, j + 1)] = (i, j)
    loops: list[list[tuple[int, int]]] = []
    seen: set[tuple[int, int]] = set()
    for start in list(edges):
        if start in seen:
            continue
        loop = [start]
        seen.add(start)
        here = edges[start]
        guard = 0
        while here != start and here in edges and guard < len(edges) + 2:
            loop.append(here)
            seen.add(here)
            here = edges[here]
            guard += 1
        loops.append(loop)
    outer = np.asarray(max(loops, key=len), dtype=np.float64)
    # Only the corners: the loop has a vertex at every cell corner along a straight edge, and
    # an offset applied at a straight-through vertex would move that edge twice as far.
    turn_in = outer - np.roll(outer, 1, axis=0)
    turn_out = np.roll(outer, -1, axis=0) - outer
    corner = np.abs(turn_in[:, 0] * turn_out[:, 1] - turn_in[:, 1] * turn_out[:, 0]) > 1e-9
    ring = outer[corner] * cell_m + origin
    # The traced boundary runs round the outside of the occupied cells, half a cell beyond the
    # points on average. Every edge is axis-aligned, so pulling each vertex in along the sum of
    # its two edges' inward normals moves every edge in by exactly half a cell.
    area = 0.5 * float(np.sum(ring[:, 0] * np.roll(ring[:, 1], -1)
                              - np.roll(ring[:, 0], -1) * ring[:, 1]))
    turn = 1.0 if area > 0 else -1.0
    before = ring - np.roll(ring, 1, axis=0)
    after = np.roll(ring, -1, axis=0) - ring
    def inward(d: np.ndarray) -> np.ndarray:
        length = np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-12)
        return turn * np.column_stack([-d[:, 1], d[:, 0]]) / length
    ring = ring + (inward(before) + inward(after)) * (cell_m / 2.0)
    # A spur one cell wide has no width left once both its sides have moved in: drop the
    # vertices where the outline now doubles straight back on itself.
    while len(ring) > 3:
        d_in = ring - np.roll(ring, 1, axis=0)
        d_out = np.roll(ring, -1, axis=0) - ring
        cross = d_in[:, 0] * d_out[:, 1] - d_in[:, 1] * d_out[:, 0]
        back = (np.abs(cross) < 1e-12) & (np.sum(d_in * d_out, axis=1) <= 0)
        tiny = np.linalg.norm(d_out, axis=1) < 1e-9
        drop = back | tiny
        if not drop.any():
            break
        ring = ring[~drop]
    keep = np.zeros(len(ring) + 1, dtype=bool)
    closed_ring = np.vstack([ring, ring[:1]])
    keep[[0, -1]] = True
    _dp2(closed_ring, 0, len(closed_ring) - 1, tolerance_m, keep)
    simple = closed_ring[keep][:-1]
    area = 0.5 * float(np.sum(simple[:, 0] * np.roll(simple[:, 1], -1)
                              - np.roll(simple[:, 0], -1) * simple[:, 1]))
    if area < 0:
        simple = simple[::-1]
    return Profile(tuple(map(tuple, np.round(simple, 4))), closed=True)


def _solid_without_pinches(grid: np.ndarray) -> np.ndarray:
    """Fill every hole, and fill in any two cells that touch only at a corner.

    The boundary is traced by following one edge out of each vertex. A hole makes a second
    loop, and two cells meeting only diagonally put two outgoing edges on one vertex, where a
    tracer that keeps one of them jumps across the shape. A cross-section has neither in
    reality -- a seat is solid -- so both are resolved before tracing, not handled after.
    """
    solid = grid.copy()
    while True:
        outside = np.zeros_like(solid)
        outside[0, :] = outside[-1, :] = True
        outside[:, 0] = outside[:, -1] = True
        outside &= ~solid
        while True:
            grown = outside.copy()
            grown[1:, :] |= outside[:-1, :]
            grown[:-1, :] |= outside[1:, :]
            grown[:, 1:] |= outside[:, :-1]
            grown[:, :-1] |= outside[:, 1:]
            grown &= ~solid
            if (grown == outside).all():
                break
            outside = grown
        solid = ~outside
        a, b = solid[:-1, :-1], solid[1:, :-1]
        c, d = solid[:-1, 1:], solid[1:, 1:]
        first = a & d & ~b & ~c
        second = b & c & ~a & ~d
        if not (first.any() or second.any()):
            return solid
        solid[1:, :-1] |= first
        solid[:-1, 1:] |= first
        solid[:-1, :-1] |= second
        solid[1:, 1:] |= second


def _dp2(points: np.ndarray, a: int, b: int, tol: float, keep: np.ndarray) -> None:
    stack = [(a, b)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = points[i], points[j]
        d = q - p
        length = float(np.linalg.norm(d))
        mid = points[i + 1:j]
        if length < 1e-12:
            dist = np.linalg.norm(mid - p, axis=1)
        else:
            dist = np.abs(d[0] * (mid[:, 1] - p[1]) - d[1] * (mid[:, 0] - p[0])) / length
        k = int(np.argmax(dist))
        if dist[k] > tol:
            keep[i + 1 + k] = True
            stack.extend(((i, i + 1 + k), (i + 1 + k, j)))
