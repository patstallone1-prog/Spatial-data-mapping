"""Fewer triangles, with the error it cost *measured*, not assumed.

Simplification is vertex clustering with a quadric-error representative per cluster: every
vertex in a grid cell collapses to the one point that best preserves the planes of the faces
around them, which keeps edges and silhouettes where a centroid would round them off. The
cell size is then tightened until the measured distance from the original surface to the
simplified one is inside the tolerance asked for. The tolerance is a promise the result has
been checked against, which is what lets a level of detail carry a geometric error the tile
tree can rely on.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from smc.geometry.base import TriMesh


def _closest_on_triangles(p: np.ndarray, a: np.ndarray, b: np.ndarray,
                          c: np.ndarray) -> np.ndarray:
    """Closest point on each triangle to each point: p (n,3) against triangles (n,m,3)."""
    ab, ac, ap = b - a, c - a, p - a
    d1 = np.einsum("...k,...k", ab, ap)
    d2 = np.einsum("...k,...k", ac, ap)
    bp = p - b
    d3 = np.einsum("...k,...k", ab, bp)
    d4 = np.einsum("...k,...k", ac, bp)
    cp = p - c
    d5 = np.einsum("...k,...k", ab, cp)
    d6 = np.einsum("...k,...k", ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    denom = va + vb + vc
    denom = np.where(np.abs(denom) < 1e-18, 1e-18, denom)
    v = vb / denom
    w = vc / denom
    out = a + ab * v[..., None] + ac * w[..., None]
    # Vertex and edge regions, in the order Ericson gives them.
    e_ab = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    t = d1 / np.where(np.abs(d1 - d3) < 1e-18, 1e-18, d1 - d3)
    out = np.where(e_ab[..., None], a + ab * t[..., None], out)
    e_ac = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    t = d2 / np.where(np.abs(d2 - d6) < 1e-18, 1e-18, d2 - d6)
    out = np.where(e_ac[..., None], a + ac * t[..., None], out)
    e_bc = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    t = (d4 - d3) / np.where(np.abs((d4 - d3) + (d5 - d6)) < 1e-18, 1e-18, (d4 - d3) + (d5 - d6))
    out = np.where(e_bc[..., None], b + (c - b) * t[..., None], out)
    out = np.where(((d1 <= 0) & (d2 <= 0))[..., None], a, out)
    out = np.where(((d3 >= 0) & (d4 <= d3))[..., None], b, out)
    out = np.where(((d6 >= 0) & (d5 <= d6))[..., None], c, out)
    return out


def surface_distance(points: np.ndarray, mesh: TriMesh) -> np.ndarray:
    """Exact distance from each point to the nearest point on the mesh surface.

    Triangles are binned into a uniform grid whose cell is at least as large as a typical
    triangle. A point is compared only with the triangles in the 27 cells around its own; any
    triangle outside them is at least one cell away, so an answer shorter than a cell is exact.
    The rare point further than that from the surface falls back to every triangle.
    """
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    if mesh.empty:
        return np.full(len(pts), np.inf)
    tri = mesh.vertices[mesh.faces]
    lo, hi = tri.min(axis=1), tri.max(axis=1)
    cell = max(float(np.median(np.linalg.norm(hi - lo, axis=1))), 1e-3)
    origin = np.minimum(lo.min(axis=0), pts.min(axis=0)) - cell
    first = np.floor((lo - origin) / cell).astype(np.int64)
    last = np.floor((hi - origin) / cell).astype(np.int64)
    grid: dict[tuple[int, int, int], list[int]] = {}
    for t_index in range(len(tri)):
        a0, b0, c0 = first[t_index]
        a1, b1, c1 = last[t_index]
        for i in range(a0, a1 + 1):
            for j in range(b0, b1 + 1):
                for k in range(c0, c1 + 1):
                    grid.setdefault((i, j, k), []).append(t_index)
    key = np.floor((pts - origin) / cell).astype(np.int64)
    out = np.full(len(pts), np.inf)
    groups: dict[tuple[int, int, int], list[int]] = {}
    for n, kk in enumerate(map(tuple, key)):
        groups.setdefault(kk, []).append(n)
    for (i, j, k), members in groups.items():
        found: set[int] = set()
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for dk in (-1, 0, 1):
                    found.update(grid.get((i + di, j + dj, k + dk), ()))
        if not found:
            continue
        cand = tri[np.fromiter(found, dtype=np.int64)]
        part = pts[members]
        closest = _closest_on_triangles(part[:, None, :], cand[None, :, 0], cand[None, :, 1],
                                        cand[None, :, 2])
        out[members] = np.linalg.norm(closest - part[:, None, :], axis=2).min(axis=1)
    far = np.flatnonzero(out > cell)
    for start in range(0, len(far), 64):
        part = pts[far[start:start + 64]]
        best = np.full(len(part), np.inf)
        for t0 in range(0, len(tri), 4096):
            sub = tri[t0:t0 + 4096]
            closest = _closest_on_triangles(part[:, None, :], sub[None, :, 0], sub[None, :, 1],
                                            sub[None, :, 2])
            best = np.minimum(best, np.linalg.norm(closest - part[:, None, :], axis=2).min(axis=1))
        out[far[start:start + 64]] = best
    return out


def cluster_simplify(mesh: TriMesh, cell_m: float) -> TriMesh:
    """Collapse every vertex in a grid cell to that cell's quadric-optimal point."""
    v, f = mesh.vertices, mesh.faces
    if mesh.empty or cell_m <= 0:
        return mesh
    keys = np.floor(v / cell_m).astype(np.int64)
    _, cluster, _ = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    cluster = cluster.reshape(-1)
    n = int(cluster.max()) + 1
    normals = mesh.face_normals()
    areas = mesh.face_areas()
    d = -np.einsum("ij,ij->i", normals, v[f[:, 0]])
    plane = np.column_stack([normals, d])  # (m, 4)
    quad = np.einsum("mi,mj->mij", plane, plane) * areas[:, None, None]
    q = np.zeros((n, 4, 4))
    for k in range(3):
        np.add.at(q, cluster[f[:, k]], quad)
    mean = np.zeros((n, 3))
    np.add.at(mean, cluster, v)
    mean /= np.bincount(cluster, minlength=n)[:, None]
    lo = np.full((n, 3), np.inf)
    hi = np.full((n, 3), -np.inf)
    np.minimum.at(lo, cluster, v)
    np.maximum.at(hi, cluster, v)
    # A little pull toward the cluster's mean keeps a flat or straight cluster (whose quadric
    # is singular along the plane or the line) well posed.
    pull = 1e-6 * (1.0 + np.trace(q[:, :3, :3], axis1=1, axis2=2))
    a = q[:, :3, :3] + np.eye(3)[None] * pull[:, None, None]
    b = -q[:, :3, 3] + pull[:, None] * mean
    rep = np.linalg.solve(a, b[..., None])[..., 0]
    # Never outside the cluster's own extent: a quadric can shoot a point off a flat patch.
    rep = np.clip(rep, lo, hi)
    faces = cluster[f]
    a0, a1, a2 = faces[:, 0], faces[:, 1], faces[:, 2]
    faces = faces[(a0 != a1) & (a1 != a2) & (a0 != a2)]
    # Two faces collapsed onto the same three vertices are one face; keep the first, as wound.
    _, first = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
    return TriMesh(rep, faces[np.sort(first)]).without_degenerate_faces().with_normals()


@dataclass(frozen=True)
class Simplified:
    mesh: TriMesh
    error_m: float        # measured: max distance from the original vertices to this surface
    cell_m: float


#: Cell sizes tried, as multiples of the tolerance, coarsest first. A quadric representative
#: usually stays well inside its cell, so cells several times the tolerance often pass.
CELL_FACTORS = (8.0, 6.0, 4.0, 3.0, 2.0, 1.5, 1.0)


def simplify_to_tolerance(mesh: TriMesh, tolerance_m: float) -> Simplified:
    """The coarsest clustering whose measured error is within ``tolerance_m``."""
    for factor in CELL_FACTORS:
        cell = tolerance_m * factor
        candidate = cluster_simplify(mesh, cell)
        if candidate.empty:
            continue
        error = float(surface_distance(mesh.vertices, candidate).max())
        if error <= tolerance_m:
            return Simplified(candidate, error, cell)
    return Simplified(mesh, 0.0, 0.0)


def oriented_box(mesh: TriMesh) -> TriMesh:
    """The smallest upright box around a mesh -- the coarsest level, and a collision proxy
    that contains everything."""
    from smc.geometry.primitives import Primitive, min_area_rectangle

    lo, hi = mesh.bounds()
    centre, yaw, length, width = min_area_rectangle(mesh.vertices[:, :2])
    return Primitive("box", (centre[0], centre[1], lo[2]), (length, width, hi[2] - lo[2]),
                     yaw).to_mesh()
