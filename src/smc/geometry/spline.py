"""Paths fitted to measured points, keeping the corners and the curves they actually have.

A kerb return is the case that decides this module's design. The renderer used to draw one
from a *type* -- a corner piece between two straight kerbs -- and so a thirty-foot radius and a
square corner came out the same. What is measured instead is a scatter of points along the
kerb, from lidar, from a survey line, eventually from photographs, and the question is only
what curve those points describe.

Three things make that harder than smoothing:

* **Sharp corners are real.** A traffic island has them; so does the back of a driveway
  apron. A smoother rounds everything it touches, so a corner has to be *decided* -- and
  decided by the evidence, not by a threshold on angle. At each concentrated turn two models
  are fitted to the same points: two lines meeting at a vertex, and two lines joined by a
  circular fillet whose radius is free. The sharp model has one parameter fewer, so it wins
  unless the fillet explains the points better by more than the extra parameter is worth
  (:func:`_bic_prefers_sharp`). A rounded kerb therefore stays rounded because its points are
  not on the two lines, and there is no corner type anywhere for it to collapse into.
* **Single bad samples.** A point on a parked car, a mis-registered frame. The fit is a
  local quadratic regression with Tukey biweights, iterated, so a sample far from the curve
  its neighbours agree on ends with zero weight rather than a spike.
* **Order is not given.** Points from a sensor come in any order. The path through them is
  the longest path of their minimum spanning tree, which follows a U-turn or an S as happily
  as a straight line, where sorting along a principal axis folds any curve that turns more
  than ninety degrees back onto itself.

The fitted path is stored as a dense piecewise-linear polyline with explicit breaks (indices
where the tangent is discontinuous) rather than as B-spline control points. It is equivalent
as a representation -- smooth pieces between declared C0 vertices -- and it is what every
consumer wants: the page, Unreal and a planner all consume vertices, and a break is a fact
about the kerb that a control polygon would hide.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

#: Consecutive samples further apart than this along the path leave a gap. A gap is bridged
#: (and marked unobserved) up to MAX_BRIDGE_M; beyond that the samples are two paths.
GAP_M = 3.0
MAX_BRIDGE_M = 15.0
#: Half-width of the local regression. Wide enough to average sensor noise, narrow enough that
#: a quadratic describes the curve inside it -- which, for a symmetric kernel, leaves an arc of
#: radius R biased by roughly h^4 / (240 R^3): under a millimetre at a 1.5 m radius.
SMOOTH_BANDWIDTH_M = 1.2
#: The window never narrows below this, nor below this many sample spacings: the resolution
#: of a fit is the density of its evidence, and is recorded as such.
MIN_BANDWIDTH_M = 0.35
SPACING_BANDWIDTH_FACTOR = 2.5
#: In a bend of radius R the window is held to about this fraction of R.
BEND_BANDWIDTH_FACTOR = 0.5
#: A bridge across a gap takes its end directions from this much of the curve either side.
BRIDGE_TANGENT_M = 2.0
#: The direction a walk sets off in is read from the samples this far along from its start.
START_DIRECTION_M = 2.0
#: Neighbours further along the curve than this many bandwidths are another strand of it.
STRAND_FACTOR = 3.0
#: One-sided fits are lines along one leg, so they can take a wider window than the smooth
#: fit -- and need to, to hold enough samples on one side alone.
ONE_SIDED_WIDEN = 1.5
#: Exact (surveyed) lines: segments at least this long are straight runs; shorter ones are
#: the vertices of a digitised arc. A vertex turning EXACT_SHARP_TURN_DEG or more is a corner;
#: so is one turning EXACT_KINK_TURN_DEG between two straight runs.
EXACT_ARC_SEGMENT_M = 2.5
EXACT_SHARP_TURN_DEG = 35.0
EXACT_KINK_TURN_DEG = 10.0
#: A run of the fitted path tighter than this radius, turning at least CORNER_MIN_TURN_DEG,
#: is reported as a rounded corner.
BEND_MAX_RADIUS_M = 12.0
#: Heights vary more slowly than plan position and are noisier; they get a wider window.
HEIGHT_BANDWIDTH_M = 2.0
OUTPUT_STEP_M = 0.25
#: How far either side of a candidate corner its two arms are measured, and how wide a window
#: the corner models are compared over.
CORNER_ARM_M = 2.5
CORNER_WINDOW_M = 6.0
#: Turns gentler than this over one arm are curves, handled by the smooth fit, not corners.
CORNER_MIN_TURN_DEG = 25.0
#: A fitted fillet smaller than this is a sharp corner with the edge knocked off -- below what
#: any of the sources can resolve.
SHARP_RADIUS_M = 0.3
#: No source is better than this, and a noise estimate of zero (a survey line) would make any
#: residual infinitely significant.
NOISE_FLOOR_M = 0.01
TUKEY_C = 4.685
#: The scale the robust weights are measured against never drops below this. A leave-one-out
#: fit is off by a few centimetres wherever it has to extrapolate -- the last sample of a
#: curved line -- and on a survey line with no noise at all, a scale set by the noise alone
#: calls that an outlier. A stray half a metre off the kerb is still rejected outright.
ROBUST_SCALE_FLOOR_M = 0.05
ROBUST_ITERATIONS = 4
#: Curvature is read over this much path either side of a vertex (PiecewisePath.curvature).
CURVATURE_WINDOW_M = 0.5
#: Two consecutive vertices turning this much in opposite directions are an out-and-back
#: spike; one vertex turning more than REVERSAL_TURN_DEG has turned round.
SPIKE_TURN_DEG = 60.0
REVERSAL_TURN_DEG = 150.0
#: A sample whose third-nearest neighbour is further than this is alone, and alone is not
#: evidence of anything.
ISOLATION_M = 2.5
#: Samples further than this from the ordered backbone belong to something else.
OFF_PATH_M = 3.0
#: The ordering backbone is found through points thinned to cells this many band-widths wide
#: (and never finer than BACKBONE_MIN_CELL_M).
BACKBONE_BAND_FACTOR = 1.5
BACKBONE_MIN_CELL_M = 0.3
#: An end edge of the ordering backbone this many times the median spacing (and at least
#: SPUR_MIN_M) is a stray sample the tree reached for, not the end of the curve.
SPUR_FACTOR = 4.0
SPUR_MIN_M = 0.5


@dataclass(frozen=True)
class CurveSamples:
    """Measured points on a curve, in object-local metres.

    ``weight`` is the per-sample confidence (0..1). ``source`` indexes into the evidence list
    of whatever object the samples are for, so that every point on the fitted path can be
    traced back to what saw it. ``ordered`` says the points already run along the curve (a
    survey polyline); ``closed`` that the curve is a ring (a traffic island). ``exact`` says
    the points carry no measurement noise worth modelling -- a surveyed line's vertices --
    so the fit must pass *through* them rather than smooth between them (see
    :func:`_fit_exact`); it implies ``ordered``.
    """

    xyz: np.ndarray
    weight: np.ndarray | None = None
    source: np.ndarray | None = None
    ordered: bool = False
    closed: bool = False
    exact: bool = False

    def __post_init__(self) -> None:
        xyz = np.asarray(self.xyz, dtype=np.float64).reshape(-1, 3)
        if not np.isfinite(xyz).all():
            raise ValueError("curve samples must be finite")
        n = len(xyz)
        weight = (np.ones(n) if self.weight is None
                  else np.clip(np.asarray(self.weight, dtype=np.float64).reshape(-1), 0.0, 1.0))
        source = (np.zeros(n, dtype=np.int64) if self.source is None
                  else np.asarray(self.source, dtype=np.int64).reshape(-1))
        if len(weight) != n or len(source) != n:
            raise ValueError("weight and source need one entry per sample")
        object.__setattr__(self, "xyz", xyz)
        object.__setattr__(self, "weight", weight)
        object.__setattr__(self, "source", source)

    def __len__(self) -> int:
        return len(self.xyz)

    def subset(self, index: np.ndarray, *, ordered: bool | None = None) -> CurveSamples:
        return CurveSamples(self.xyz[index], self.weight[index], self.source[index],
                            self.ordered if ordered is None else ordered, False, self.exact)


@dataclass(frozen=True)
class PiecewisePath:
    """A 3D polyline with declared breaks.

    ``breaks`` are vertex indices where the tangent is discontinuous. ``observed`` marks
    vertices with samples near them (False across a bridged gap); ``support`` is how much
    evidence stood behind each vertex.
    """

    points: np.ndarray
    breaks: tuple[int, ...] = ()
    observed: np.ndarray | None = None
    support: np.ndarray | None = None
    closed: bool = False

    def __post_init__(self) -> None:
        points = np.asarray(self.points, dtype=np.float64).reshape(-1, 3)
        if len(points) < 2:
            raise ValueError("a path needs at least two points")
        n = len(points)
        observed = (np.ones(n, dtype=bool) if self.observed is None
                    else np.asarray(self.observed, dtype=bool).reshape(-1))
        support = (np.ones(n) if self.support is None
                   else np.asarray(self.support, dtype=np.float64).reshape(-1))
        if len(observed) != n or len(support) != n:
            raise ValueError("observed and support need one entry per point")
        breaks = tuple(sorted({int(b) for b in self.breaks if 0 < int(b) < n - 1}))
        object.__setattr__(self, "points", points)
        object.__setattr__(self, "observed", observed)
        object.__setattr__(self, "support", support)
        object.__setattr__(self, "breaks", breaks)

    def arc_length(self) -> np.ndarray:
        step = np.linalg.norm(np.diff(self.points[:, :2], axis=0), axis=1)
        return np.concatenate([[0.0], np.cumsum(step)])

    @property
    def length(self) -> float:
        return float(self.arc_length()[-1])

    def segment_directions(self) -> np.ndarray:
        """Unit plan directions of each segment."""
        delta = np.diff(self.points[:, :2], axis=0)
        length = np.linalg.norm(delta, axis=1, keepdims=True)
        return np.divide(delta, length, out=np.zeros_like(delta), where=length > 0)

    def turning(self) -> np.ndarray:
        """Signed plan turning angle at each vertex, radians; zero at the ends."""
        d = self.segment_directions()
        turn = np.zeros(len(self.points))
        cross = d[:-1, 0] * d[1:, 1] - d[:-1, 1] * d[1:, 0]
        dot = np.sum(d[:-1] * d[1:], axis=1)
        turn[1:-1] = np.arctan2(cross, dot)
        return turn

    def curvature(self, window_m: float = CURVATURE_WINDOW_M) -> np.ndarray:
        """Signed plan curvature (1/m) at each vertex; NaN at a break, where it is undefined.

        Measured as the turn between the chords to the points ``window_m`` behind and ahead
        (within the vertex's own smooth piece), over the chords' mean length. Three adjacent
        vertices a quarter-metre apart turn millimetre jitter into curvature; a half-metre
        window reads the curve. ``window_m=0`` gives the vertex-to-vertex estimate.
        """
        s = self.arc_length()
        xy = self.points[:, :2]
        kappa = np.zeros(len(s))
        if window_m <= 0:
            turn = self.turning()
            span = np.zeros_like(s)
            span[1:-1] = (s[2:] - s[:-2]) / 2.0
            kappa = np.divide(turn, span, out=np.zeros_like(turn), where=span > 1e-9)
        else:
            for a, b in self.pieces():
                ps = s[a:b + 1]
                if ps[-1] - ps[0] < 1e-9:
                    continue
                behind = np.clip(ps - window_m, ps[0], ps[-1])
                ahead = np.clip(ps + window_m, ps[0], ps[-1])
                back = np.column_stack([np.interp(behind, ps, xy[a:b + 1, k]) for k in range(2)])
                fore = np.column_stack([np.interp(ahead, ps, xy[a:b + 1, k]) for k in range(2)])
                d1 = xy[a:b + 1] - back
                d2 = fore - xy[a:b + 1]
                l1 = np.linalg.norm(d1, axis=1)
                l2 = np.linalg.norm(d2, axis=1)
                ok = (l1 > 1e-9) & (l2 > 1e-9)
                cross = d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]
                dot = np.sum(d1 * d2, axis=1)
                angle = np.arctan2(cross, dot)
                piece = np.where(ok, angle / np.maximum((l1 + l2) / 2.0, 1e-9), 0.0)
                kappa[a:b + 1] = piece
        for b in self.breaks:
            kappa[b] = np.nan
        return kappa

    def pieces(self) -> list[tuple[int, int]]:
        """Inclusive vertex ranges of the smooth pieces between breaks."""
        edges = [0, *self.breaks, len(self.points) - 1]
        return [(edges[k], edges[k + 1]) for k in range(len(edges) - 1)]

    def resampled(self, step_m: float) -> PiecewisePath:
        """Uniform spacing inside each smooth piece; breaks are kept exactly."""
        s = self.arc_length()
        points: list[np.ndarray] = []
        observed: list[np.ndarray] = []
        support: list[np.ndarray] = []
        breaks: list[int] = []
        for a, b in self.pieces():
            count = max(1, math.ceil((s[b] - s[a]) / step_m))
            grid = np.linspace(s[a], s[b], count + 1)
            local = s[a:b + 1]
            piece = np.column_stack([np.interp(grid, local, self.points[a:b + 1, k])
                                     for k in range(3)])
            nearest = np.clip(np.searchsorted(local, grid), 0, len(local) - 1) + a
            if points:
                piece, grid_nearest = piece[1:], nearest[1:]
                breaks.append(sum(len(p) for p in points) - 1)
            else:
                grid_nearest = nearest
            points.append(piece)
            observed.append(self.observed[grid_nearest])
            support.append(self.support[grid_nearest])
        return PiecewisePath(np.concatenate(points), tuple(breaks), np.concatenate(observed),
                             np.concatenate(support), self.closed)

    def simplified(self, tolerance_m: float) -> PiecewisePath:
        """Douglas-Peucker inside each piece. Breaks and observed/unobserved changes survive."""
        keep = np.zeros(len(self.points), dtype=bool)
        keep[[0, -1, *self.breaks]] = True
        change = np.flatnonzero(np.diff(self.observed.astype(np.int8))) + 1
        keep[change] = True
        keep[np.maximum(change - 1, 0)] = True
        anchors = np.flatnonzero(keep)
        for a, b in itertools.pairwise(anchors):
            _douglas_peucker(self.points, int(a), int(b), tolerance_m, keep)
        index = np.flatnonzero(keep)
        position = {int(v): k for k, v in enumerate(index)}
        return PiecewisePath(self.points[index], tuple(position[b] for b in self.breaks),
                             self.observed[index], self.support[index], self.closed)

    def distance_to(self, xyz: np.ndarray) -> np.ndarray:
        """Plan distance from each point to the path."""
        plan = np.asarray(xyz, dtype=np.float64)[:, :2]
        return _distance_to_polyline(plan, self.points[:, :2])[0]

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "points": np.round(self.points, 4).tolist(),
            "breaks": list(self.breaks),
            "closed": self.closed,
        }
        if not self.observed.all():
            out["unobserved"] = np.flatnonzero(~self.observed).tolist()
        out["support"] = np.round(self.support, 2).tolist()
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> PiecewisePath:
        points = np.asarray(data["points"], dtype=np.float64)
        observed = np.ones(len(points), dtype=bool)
        observed[np.asarray(data.get("unobserved", []), dtype=np.int64)] = False
        return cls(points, tuple(data.get("breaks", ())), observed,
                   np.asarray(data.get("support", np.ones(len(points)))), bool(data.get("closed")))


@dataclass(frozen=True)
class Corner:
    """A concentrated turn, and which model of it the evidence chose."""

    s_m: float
    kind: str  # "sharp" | "rounded"
    radius_m: float
    turn_deg: float
    vertex: tuple[float, float]
    rss_sharp: float
    rss_fillet: float
    samples: int

    def to_json(self) -> dict[str, Any]:
        return {"s_m": round(self.s_m, 3), "kind": self.kind, "radius_m": round(self.radius_m, 3),
                "turn_deg": round(self.turn_deg, 1), "samples": self.samples}


@dataclass(frozen=True)
class PathFit:
    """A fitted path and everything needed to judge it."""

    path: PiecewisePath
    s: np.ndarray                 # each sample's position along the fitted path
    residual_m: np.ndarray        # each sample's plan distance to the fitted path
    inlier: np.ndarray            # final robust weight above zero
    corners: tuple[Corner, ...]
    gaps: tuple[tuple[float, float], ...]
    noise_m: float
    rejected: tuple[tuple[int, str], ...] = field(default_factory=tuple)
    problems: tuple[str, ...] = field(default_factory=tuple)

    @property
    def rms_m(self) -> float:
        r = self.residual_m[self.inlier]
        return float(np.sqrt(np.mean(r * r))) if r.size else float("inf")

    @property
    def max_m(self) -> float:
        r = self.residual_m[self.inlier]
        return float(r.max()) if r.size else float("inf")

    @property
    def inlier_fraction(self) -> float:
        return float(self.inlier.mean()) if self.inlier.size else 0.0

    @property
    def observed_fraction(self) -> float:
        s = self.path.arc_length()
        if s[-1] <= 0:
            return 0.0
        seg = np.diff(s)
        seen = self.path.observed[:-1] & self.path.observed[1:]
        return float(min(1.0, seg[seen].sum() / s[-1]))

    def summary(self) -> dict[str, Any]:
        return {
            "length_m": round(self.path.length, 3),
            "samples": len(self.s),
            "inliers": int(self.inlier.sum()),
            "rms_m": round(self.rms_m, 4),
            "max_m": round(self.max_m, 4),
            "noise_m": round(self.noise_m, 4),
            "observed_fraction": round(self.observed_fraction, 3),
            "corners": [c.to_json() for c in self.corners],
            "gaps": [[round(a, 2), round(b, 2)] for a, b in self.gaps],
            "rejected": len(self.rejected),
            "problems": list(self.problems),
        }


# ---------------------------------------------------------------- small geometry helpers ----


def _douglas_peucker(points: np.ndarray, a: int, b: int, tol: float, keep: np.ndarray) -> None:
    stack = [(a, b)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        p, q = points[i], points[j]
        d = q - p
        length = float(np.linalg.norm(d))
        middle = points[i + 1:j]
        if length < 1e-12:
            dist = np.linalg.norm(middle - p, axis=1)
        else:
            dist = np.linalg.norm(np.cross(middle - p, d / length), axis=1)
        k = int(np.argmax(dist))
        if dist[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack.extend(((i, m), (m, j)))


def _distance_to_polyline(q: np.ndarray, line: np.ndarray,
                          chunk: int = 2048) -> tuple[np.ndarray, np.ndarray]:
    """Plan distance of each point to a polyline, and the arc length of its foot."""
    a, b = line[:-1], line[1:]
    d = b - a
    seg_len = np.linalg.norm(d, axis=1)
    s0 = np.concatenate([[0.0], np.cumsum(seg_len)])[:-1]
    denom = np.maximum(seg_len * seg_len, 1e-18)
    dist = np.empty(len(q))
    foot = np.empty(len(q))
    for start in range(0, len(q), chunk):
        part = q[start:start + chunk]
        rel = part[:, None, :] - a[None, :, :]
        t = np.clip(np.einsum("nsk,sk->ns", rel, d) / denom, 0.0, 1.0)
        near = a[None] + t[..., None] * d[None]
        dd = np.linalg.norm(part[:, None, :] - near, axis=2)
        k = np.argmin(dd, axis=1)
        rows = np.arange(len(part))
        dist[start:start + chunk] = dd[rows, k]
        foot[start:start + chunk] = s0[k] + t[rows, k] * seg_len[k]
    return dist, foot


def _tukey(u: np.ndarray) -> np.ndarray:
    w = 1.0 - u * u
    return np.where(np.abs(u) < 1.0, w * w, 0.0)


def _robust_sigma(residual: np.ndarray, weight: np.ndarray) -> float:
    r = np.abs(residual[weight > 0])
    if not r.size:
        return NOISE_FLOOR_M
    return max(NOISE_FLOOR_M, 1.4826 * float(np.median(r)))


def _robust_line(xy: np.ndarray, w: np.ndarray, iterations: int = 3
                 ) -> tuple[np.ndarray, np.ndarray, float]:
    """Weighted PCA line with biweight refits: centre, unit direction, rms."""
    w = w.astype(np.float64).copy()
    centre = xy.mean(axis=0)
    direction = np.array([1.0, 0.0])
    for _ in range(iterations):
        total = w.sum()
        if total <= 0:
            break
        centre = (xy * w[:, None]).sum(axis=0) / total
        rel = xy - centre
        cov = (rel * w[:, None]).T @ rel / total
        values, vectors = np.linalg.eigh(cov)
        direction = vectors[:, int(np.argmax(values))]
        perp = rel @ np.array([-direction[1], direction[0]])
        sigma = max(NOISE_FLOOR_M, 1.4826 * float(np.median(np.abs(perp))))
        w = w * _tukey(perp / (TUKEY_C * sigma)) if iterations > 1 else w
    rel = xy - centre
    perp = rel @ np.array([-direction[1], direction[0]])
    if float((rel @ direction)[-1] - (rel @ direction)[0]) < 0:
        direction = -direction
    return centre, direction, float(np.sqrt(np.mean(perp * perp)))


# --------------------------------------------------------------------------- ordering ----


def _knn_distance(xy: np.ndarray, k: int, chunk: int = 1024) -> np.ndarray:
    out = np.empty(len(xy))
    for start in range(0, len(xy), chunk):
        part = xy[start:start + chunk]
        d = np.linalg.norm(part[:, None, :] - xy[None, :, :], axis=2)
        d.sort(axis=1)
        out[start:start + chunk] = d[:, min(k, d.shape[1] - 1)]
    return out


def _mst_parent(xy: np.ndarray) -> np.ndarray:
    """Prim's algorithm, O(n) memory: parent of each vertex in the minimum spanning tree."""
    n = len(xy)
    parent = np.full(n, -1, dtype=np.int64)
    best = np.full(n, np.inf)
    done = np.zeros(n, dtype=bool)
    current = 0
    done[0] = True
    for _ in range(n - 1):
        d = np.linalg.norm(xy - xy[current], axis=1)
        closer = (~done) & (d < best)
        best[closer] = d[closer]
        parent[closer] = current
        candidates = np.where(done, np.inf, best)
        current = int(np.argmin(candidates))
        done[current] = True
    return parent


def _tree_longest_path(xy: np.ndarray, parent: np.ndarray) -> list[int]:
    n = len(xy)
    adjacency: list[list[tuple[int, float]]] = [[] for _ in range(n)]
    for child, p in enumerate(parent):
        if p >= 0:
            w = float(np.linalg.norm(xy[child] - xy[p]))
            adjacency[child].append((int(p), w))
            adjacency[int(p)].append((child, w))

    def farthest(start: int) -> tuple[int, np.ndarray, np.ndarray]:
        dist = np.full(n, -1.0)
        back = np.full(n, -1, dtype=np.int64)
        dist[start] = 0.0
        stack = [start]
        while stack:
            u = stack.pop()
            for v, w in adjacency[u]:
                if dist[v] < 0:
                    dist[v] = dist[u] + w
                    back[v] = u
                    stack.append(v)
        return int(np.argmax(dist)), dist, back

    a, _, _ = farthest(0)
    b, _, back = farthest(a)
    path = [b]
    while path[-1] != a:
        path.append(int(back[path[-1]]))
    return path[::-1]


def _smoothed_backbone(backbone: np.ndarray, step_m: float = 0.25,
                       window_m: float = 2.0) -> np.ndarray:
    along = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(backbone, axis=0), axis=1))])
    if along[-1] <= step_m * 2:
        return backbone
    grid = np.arange(0.0, along[-1] + 1e-9, step_m)
    even = np.column_stack([np.interp(grid, along, backbone[:, k]) for k in range(2)])
    half = max(1, int(window_m / step_m / 2))
    if len(even) <= 2 * half + 1:
        return even
    pad = np.pad(even, ((half, half), (0, 0)), mode="reflect", reflect_type="odd")
    kernel = np.ones(2 * half + 1) / (2 * half + 1)
    return np.column_stack([np.convolve(pad[:, k], kernel, mode="valid") for k in range(2)])


def _plan_thin(xy: np.ndarray, cell_m: float) -> tuple[np.ndarray, np.ndarray]:
    """One point per plan cell: the mean of the points in it, and how many there were."""
    keys = np.floor(xy / cell_m).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.reshape(-1)
    sums = np.zeros((len(counts), 2))
    np.add.at(sums, inverse, xy)
    return sums / counts[:, None], counts


def _band_width(xy: np.ndarray, radius: float = 1.0, probes: int = 200) -> float:
    """How wide the points lie across their own run: four times the spread along the minor
    axis of their neighbourhoods, at a sample of places. A kerb's is its noise; a bench seat's
    is its depth."""
    near = _Neighbours(xy, radius)
    rng = np.random.default_rng(0)
    picks = rng.choice(len(xy), min(probes, len(xy)), replace=False)
    widths = []
    for i in picks:
        idx = near.query(xy[i], radius)
        if idx.size < 5:
            continue
        rel = xy[idx] - xy[idx].mean(axis=0)
        values = np.linalg.eigvalsh(rel.T @ rel / len(idx))
        widths.append(4.0 * float(np.sqrt(max(values[0], 0.0))))
    return float(np.median(widths)) if widths else 0.0


def order_samples(samples: CurveSamples) -> tuple[np.ndarray, np.ndarray, list[tuple[int, str]]]:
    """Order unordered samples along the curve they lie on.

    Returns the kept sample indices in path order, each one's provisional arc position, and the
    samples rejected (with a reason) before any fitting.
    """
    n = len(samples)
    rejected: list[tuple[int, str]] = []
    if samples.ordered or n < 4:
        xy = samples.xyz[:, :2]
        s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(xy, axis=0), axis=1))])
        return np.arange(n), s, rejected
    xy = samples.xyz[:, :2]
    kth = _knn_distance(xy, min(3, n - 1))
    limit = max(ISOLATION_M, 8.0 * float(np.median(kth)))
    alone = kth > limit
    rejected += [(int(i), "isolated") for i in np.flatnonzero(alone)]
    kept = np.flatnonzero(~alone)
    if len(kept) < 4:
        return kept, np.zeros(len(kept)), rejected
    kxy = xy[kept]
    # The backbone is taken through the points thinned to about one per band-width. Through
    # all of them, the tree's longest path is only a good backbone for a thin curve: in a wide
    # band -- a bench seat seen from above -- it can snake back and forth across the band and
    # end partway along it, which is the longest path in the tree and not the object's axis.
    band = _band_width(kxy)
    thin, _ = _plan_thin(kxy, max(BACKBONE_MIN_CELL_M, BACKBONE_BAND_FACTOR * band))
    tree_xy = thin if len(thin) >= 4 else kxy
    spine = _tree_longest_path(tree_xy, _mst_parent(tree_xy))
    # The longest path of the tree ends wherever the tree reaches furthest, and a stray sample
    # a metre off the end of the kerb reaches further than the kerb does. An end edge several
    # times the typical spacing is that spur, not the curve, and is pruned back.
    steps = np.linalg.norm(np.diff(tree_xy[spine], axis=0), axis=1)
    typical = float(np.median(steps)) if steps.size else 0.0
    spur = max(SPUR_FACTOR * typical, SPUR_MIN_M)
    while len(spine) > 3 and float(np.linalg.norm(tree_xy[spine[-1]] - tree_xy[spine[-2]])) > spur:
        spine = spine[:-1]
    while len(spine) > 3 and float(np.linalg.norm(tree_xy[spine[0]] - tree_xy[spine[1]])) > spur:
        spine = spine[1:]
    backbone = tree_xy[spine]
    if len(backbone) < 2:
        return kept, np.zeros(len(kept)), rejected
    # The backbone zigzags through the noise, and now and then detours through a stray sample
    # beside the curve. Projected onto as it stands, that detour folds the arc positions back
    # on themselves. Resampled evenly and averaged over a couple of metres it keeps its course
    # -- including round a sharp corner, which it cuts slightly, harmlessly, since only the
    # order of the projections is used -- and loses the detours.
    backbone = _smoothed_backbone(backbone)
    dist, foot = _distance_to_polyline(kxy, backbone)
    off = dist > OFF_PATH_M
    rejected += [(int(i), "off_path") for i in kept[off]]
    kept, foot = kept[~off], foot[~off]
    order = np.argsort(foot, kind="stable")
    return kept[order], foot[order], rejected


# ----------------------------------------------------------------------- local fitting ----


class _Neighbours:
    """Uniform-grid lookup of samples near a point. numpy has no k-d tree, and a grid with
    cells the size of the search radius answers every query from nine cells."""

    def __init__(self, xy: np.ndarray, cell: float) -> None:
        self.xy = xy
        self.cell = cell
        keys = np.floor(xy / cell).astype(np.int64)
        self.cells: dict[tuple[int, int], list[int]] = {}
        for i, (a, b) in enumerate(keys):
            self.cells.setdefault((int(a), int(b)), []).append(i)

    def query(self, p: np.ndarray, radius: float) -> np.ndarray:
        a0, b0 = np.floor((p - radius) / self.cell).astype(np.int64)
        a1, b1 = np.floor((p + radius) / self.cell).astype(np.int64)
        found: list[int] = []
        for a in range(int(a0), int(a1) + 1):
            for b in range(int(b0), int(b1) + 1):
                found.extend(self.cells.get((a, b), ()))
        if not found:
            return np.zeros(0, dtype=np.int64)
        idx = np.asarray(found, dtype=np.int64)
        return idx[np.linalg.norm(self.xy[idx] - p, axis=1) <= radius]


def _mls(p: np.ndarray, hint: np.ndarray, xy: np.ndarray, w: np.ndarray, near: _Neighbours,
         h: float, exclude: int = -1,
         side: np.ndarray | None = None,
         strand: tuple[np.ndarray, float] | None = None
         ) -> tuple[np.ndarray, np.ndarray, float, float, bool] | None:
    """Moving-least-squares projection of ``p`` onto the curve its neighbours describe.

    A local frame is set on the neighbours' principal direction, a weighted quadratic
    ``v(u)`` is fitted across it, and ``p`` moves to the quadratic's value at ``u = 0``.
    Returns the projected point, the tangent there, the kernel support behind it, the local
    curvature (1/m, zero when only a line could be fitted), and whether there was evidence on
    both sides of it -- without which the point is an extrapolation, not a measurement.
    Nothing here depends on the order of the samples, which is the point.
    """
    idx = near.query(p, h)
    if exclude >= 0:
        idx = idx[idx != exclude]
    if side is not None:
        # Only the neighbours in one half-plane about p.
        idx = idx[(xy[idx] - p) @ side >= 0]
    if strand is not None:
        # Only neighbours near p along the curve as well as across it. A curve that doubles
        # back a metre from itself -- a hairpin, a narrow slot in a kerb line -- puts the other
        # strand inside any spatial window, and a fit to both is a fit to neither.
        along, at = strand
        idx = idx[np.abs(along[idx] - at) <= STRAND_FACTOR * h + 1.0]
    if idx.size < 3:
        return None
    q = xy[idx]
    d = np.linalg.norm(q - p, axis=1) / h
    k = (1.0 - np.clip(d, 0.0, 1.0) ** 3) ** 3 * w[idx]
    live = k > 1e-6
    if live.sum() < 3:
        return None
    q, k = q[live], k[live]
    total = float(k.sum())
    centre = (q * k[:, None]).sum(axis=0) / total
    rel = q - centre
    cov = (rel * k[:, None]).T @ rel / total
    values, vectors = np.linalg.eigh(cov)
    tangent = vectors[:, int(np.argmax(values))]
    if float(tangent @ hint) < 0:
        tangent = -tangent
    normal = np.array([-tangent[1], tangent[0]])
    u = (q - p) @ tangent
    v = (q - p) @ normal
    both = bool((u < -0.15 * h).any() and (u > 0.15 * h).any())
    degree = 2 if (len(q) >= 6 and both) else 1
    design = np.vander(u, degree + 1, increasing=True)
    wd = design * k[:, None]
    coef = np.linalg.solve(design.T @ wd + np.eye(degree + 1) * 1e-9, wd.T @ v)
    point = p + coef[0] * normal
    direction = tangent + coef[1] * normal
    kappa = 2.0 * float(coef[2]) / (1.0 + float(coef[1]) ** 2) ** 1.5 if degree == 2 else 0.0
    return point, direction / float(np.linalg.norm(direction)), total, kappa, both


def _fillet_distance(q: np.ndarray, vertex: np.ndarray, d1: np.ndarray, d2: np.ndarray,
                     radius: float) -> np.ndarray:
    """Plan distance to line-arc-line: arriving along d1, a fillet of ``radius``, leaving
    along d2. ``radius`` 0 is the sharp corner."""
    cosang = float(np.clip(d1 @ d2, -1.0, 1.0))
    delta = math.acos(cosang)
    t = radius * math.tan(delta / 2.0)
    t1 = vertex - d1 * t
    t2 = vertex + d2 * t
    rel1 = q - t1
    along1 = np.minimum(rel1 @ d1, 0.0)
    dist1 = np.linalg.norm(rel1 - along1[:, None] * d1, axis=1)
    rel2 = q - t2
    along2 = np.maximum(rel2 @ d2, 0.0)
    dist2 = np.linalg.norm(rel2 - along2[:, None] * d2, axis=1)
    best = np.minimum(dist1, dist2)
    if radius <= 0 or delta < 1e-6:
        return best
    turn = math.copysign(1.0, d1[0] * d2[1] - d1[1] * d2[0])
    normal = np.array([-d1[1], d1[0]]) * turn
    centre = t1 + normal * radius
    a = t1 - centre
    b = t2 - centre
    rel = q - centre
    cross_ab = a[0] * b[1] - a[1] * b[0]
    in_sector = ((a[0] * rel[:, 1] - a[1] * rel[:, 0]) * cross_ab >= 0) & \
                ((rel[:, 0] * b[1] - rel[:, 1] * b[0]) * cross_ab >= 0)
    arc = np.abs(np.linalg.norm(rel, axis=1) - radius)
    return np.where(in_sector, np.minimum(best, arc), best)


def _bic_prefers_sharp(rss_sharp: float, rss_fillet: float, n: int, noise: float) -> bool:
    """One extra parameter (the radius) has to buy more than it costs."""
    floor = n * noise * noise * 0.05
    sharp = n * math.log(max(rss_sharp, floor) / n)
    fillet = n * math.log(max(rss_fillet, floor) / n) + math.log(max(n, 2))
    return sharp <= fillet


def _analyse_corner(s: np.ndarray, xy: np.ndarray, w: np.ndarray, centre_s: float,
                    reach: float, noise: float) -> tuple[Corner, np.ndarray, np.ndarray] | None:
    window = (s >= centre_s - reach) & (s <= centre_s + reach) & (w > 0)
    left = window & (s <= centre_s - reach / 2.0)
    right = window & (s >= centre_s + reach / 2.0)
    if left.sum() < 3 or right.sum() < 3:
        return None
    c1, d1, rms1 = _robust_line(xy[left], w[left])
    c2, d2, rms2 = _robust_line(xy[right], w[right])
    # Arms that are not straight make this a curve, not a corner; the smooth fit has it.
    if max(rms1, rms2) > max(3.0 * noise, 0.04):
        return None
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(math.atan2(cross, float(d1 @ d2))) < math.radians(CORNER_MIN_TURN_DEG * 0.6):
        return None
    try:
        a, _ = np.linalg.solve(np.column_stack([d1, -d2]), c2 - c1)
    except np.linalg.LinAlgError:
        return None
    vertex = c1 + a * d1
    q = xy[window]
    ww = w[window]
    if float(np.min(np.linalg.norm(q - vertex, axis=1))) > reach:
        return None
    # The arm windows were placed by arc position, which near a corner is only roughly right.
    # Refit each arm to the samples nearest to it, clear of the vertex, and intersect again.
    for _ in range(2):
        rel = q - vertex
        on_in = np.linalg.norm(rel - np.minimum(rel @ d1, 0.0)[:, None] * d1, axis=1)
        on_out = np.linalg.norm(rel - np.maximum(rel @ d2, 0.0)[:, None] * d2, axis=1)
        clear = np.linalg.norm(rel, axis=1) > max(0.3, 2.0 * noise)
        arm_in = clear & (on_in < on_out) & (rel @ d1 < 0)
        arm_out = clear & (on_out <= on_in) & (rel @ d2 > 0)
        if arm_in.sum() < 3 or arm_out.sum() < 3:
            break
        c1, d1, _ = _robust_line(q[arm_in], ww[arm_in])
        c2, d2, _ = _robust_line(q[arm_out], ww[arm_out])
        try:
            a, _ = np.linalg.solve(np.column_stack([d1, -d2]), c2 - c1)
        except np.linalg.LinAlgError:
            return None
        vertex = c1 + a * d1
    delta = math.acos(float(np.clip(d1 @ d2, -1.0, 1.0)))
    r_max = min(10.0, (reach * 0.5) / max(math.tan(delta / 2.0), 1e-3))

    def rss(radius: float) -> float:
        dist = _fillet_distance(q, vertex, d1, d2, radius)
        return float(np.sum(ww * dist * dist))

    grid = np.linspace(0.0, r_max, 41)
    values = np.array([rss(r) for r in grid])
    k = int(np.argmin(values))
    lo_r, hi_r = grid[max(k - 1, 0)], grid[min(k + 1, len(grid) - 1)]
    for _ in range(30):  # golden section on the bracket
        m1 = hi_r - (hi_r - lo_r) * 0.618
        m2 = lo_r + (hi_r - lo_r) * 0.618
        if rss(m1) < rss(m2):
            hi_r = m2
        else:
            lo_r = m1
    radius = (lo_r + hi_r) / 2.0
    rss_fillet = min(rss(radius), float(values[k]))
    rss_sharp = rss(0.0)
    n = int(window.sum())
    # A sharp corner is one the evidence runs all the way into. On a rounded one of radius r
    # the nearest sample stays r(sec(turn/2) - 1) off the vertex, and no amount of goodness
    # of fit elsewhere makes up for the vertex having nothing near it.
    spacing = float(np.median(np.diff(np.sort(s[window])))) if n > 2 else reach
    reaches_vertex = float(np.min(np.linalg.norm(q - vertex, axis=1))) <= \
        max(3.0 * noise, 0.75 * spacing + 2.0 * noise)
    sharp = reaches_vertex and (radius < SHARP_RADIUS_M
                                or _bic_prefers_sharp(rss_sharp, rss_fillet, n, noise))
    corner = Corner(float(centre_s), "sharp" if sharp else "rounded", 0.0 if sharp else radius,
                    math.degrees(math.copysign(delta, cross)),
                    (float(vertex[0]), float(vertex[1])), rss_sharp, rss_fillet, n)
    return corner, d1, d2


def _turn_profile(s: np.ndarray, xy: np.ndarray, w: np.ndarray, at: np.ndarray) -> np.ndarray:
    turn = np.full(len(at), np.nan)
    for k, x0 in enumerate(at):
        before = (s >= x0 - CORNER_ARM_M) & (s <= x0) & (w > 0)
        after = (s >= x0) & (s <= x0 + CORNER_ARM_M) & (w > 0)
        if before.sum() < 3 or after.sum() < 3:
            continue
        _, d1, _ = _robust_line(xy[before], w[before], iterations=1)
        _, d2, _ = _robust_line(xy[after], w[after], iterations=1)
        turn[k] = math.atan2(d1[0] * d2[1] - d1[1] * d2[0], float(d1 @ d2))
    return turn


def _find_corners(s: np.ndarray, xy: np.ndarray, w: np.ndarray, noise: float
                  ) -> list[tuple[Corner, np.ndarray, np.ndarray]]:
    if s[-1] - s[0] < 2 * CORNER_ARM_M:
        return []
    at = np.arange(s[0] + CORNER_ARM_M * 0.5, s[-1] - CORNER_ARM_M * 0.5, OUTPUT_STEP_M)
    turn = np.abs(_turn_profile(s, xy, w, at))
    candidates: list[float] = []
    threshold = math.radians(CORNER_MIN_TURN_DEG)
    for k in np.argsort(-np.nan_to_num(turn, nan=0.0)):
        if not np.isfinite(turn[k]) or turn[k] < threshold:
            break
        if all(abs(at[k] - c) >= CORNER_ARM_M for c in candidates):
            candidates.append(float(at[k]))
    candidates.sort()
    found: list[tuple[Corner, np.ndarray, np.ndarray]] = []
    for k, c in enumerate(candidates):
        reach = CORNER_WINDOW_M / 2.0
        if k > 0:
            reach = min(reach, (c - candidates[k - 1]) / 2.0 + CORNER_ARM_M / 2.0)
        if k + 1 < len(candidates):
            reach = min(reach, (candidates[k + 1] - c) / 2.0 + CORNER_ARM_M / 2.0)
        result = _analyse_corner(s, xy, w, c, max(reach, CORNER_ARM_M), noise)
        if result is not None:
            found.append(result)
    return found


# ------------------------------------------------------------------------ the fitter ----


def _hermite(p0: np.ndarray, p1: np.ndarray, m0: np.ndarray, m1: np.ndarray,
             t: np.ndarray) -> np.ndarray:
    t = t[:, None]
    h00 = 2 * t ** 3 - 3 * t ** 2 + 1
    h10 = t ** 3 - 2 * t ** 2 + t
    h01 = -2 * t ** 3 + 3 * t ** 2
    h11 = t ** 3 - t ** 2
    return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1


def _order_hint(xy: np.ndarray) -> np.ndarray:
    """A direction of travel at each (ordered) sample: which way along the curve is forward."""
    ahead = np.roll(xy, -2, axis=0)
    behind = np.roll(xy, 2, axis=0)
    ahead[-2:] = xy[-1]
    behind[:2] = xy[0]
    d = ahead - behind
    length = np.linalg.norm(d, axis=1, keepdims=True)
    return np.divide(d, length, out=np.tile([1.0, 0.0], (len(xy), 1)), where=length > 0)


def _robust_weights(xy: np.ndarray, s: np.ndarray, base_w: np.ndarray, hint: np.ndarray,
                    bandwidth: np.ndarray, one_sided: bool = False
                    ) -> tuple[np.ndarray, np.ndarray, float]:
    """Tukey weights from leave-one-out MLS residuals: each sample is judged by the curve
    its neighbours describe without it, so a lone stray cannot vouch for itself.

    With ``one_sided``, each sample is also judged by its neighbours on either side of it
    alone -- the half-planes behind and ahead of it -- and keeps the kindest verdict. A
    sample at a true corner lies on the line through the samples behind it or through those
    ahead; a stray lies on neither. (Split by arc position instead, the two legs of a sharp
    corner interleave near the vertex and neither side is one leg.)
    """
    near = _Neighbours(xy, float(bandwidth.max()))
    robust = np.ones(len(xy))
    residual = np.full(len(xy), np.inf)
    noise = NOISE_FLOOR_M
    # Eight half-planes: at a sharp vertex the direction of travel is itself ambiguous, and
    # whichever way it is guessed, one of these puts a whole leg on one side.
    angles = np.radians(np.arange(0.0, 360.0, 45.0))
    sides = np.column_stack([np.cos(angles), np.sin(angles)]) if one_sided else np.zeros((0, 2))
    wide = np.maximum(bandwidth, SMOOTH_BANDWIDTH_M) * ONE_SIDED_WIDEN
    near = _Neighbours(xy, float(max(bandwidth.max(), wide.max())) * 4.0)
    two_sided = np.full(len(xy), np.inf)
    unjudged = np.zeros(len(xy), dtype=bool)
    for _ in range(ROBUST_ITERATIONS):
        for i in range(len(xy)):
            fit = None
            # Too few neighbours to fit is not evidence against a sample -- the last point of a
            # sparse line has one neighbour. Widen the window; if it still cannot be judged,
            # keep it rather than call it an outlier.
            for widen in (1.0, 2.0, 4.0):
                h = float(bandwidth[i]) * widen
                fit = _mls(xy[i], hint[i], xy, base_w * robust, near, h, exclude=i,
                           strand=(s, float(s[i])))
                if fit is not None:
                    break
            unjudged[i] = fit is None
            two_sided[i] = np.inf if fit is None else float(np.linalg.norm(xy[i] - fit[0]))
            best = two_sided[i]
            for side in sides:
                fit = _mls(xy[i], hint[i], xy, base_w * robust, near, float(wide[i]),
                           exclude=i, side=side, strand=(s, float(s[i])))
                if fit is not None:
                    best = min(best, float(np.linalg.norm(xy[i] - fit[0])))
            residual[i] = 0.0 if unjudged[i] else best
        # The noise level is read from the two-sided residuals: the kindest of three verdicts
        # is biased low, and a noise estimate biased low rejects everything it should keep.
        finite = np.isfinite(two_sided)
        noise = _robust_sigma(np.where(finite, two_sided, 0.0), base_w * robust * finite)
        scale = TUKEY_C * max(noise, ROBUST_SCALE_FLOOR_M)
        robust = _tukey(np.where(np.isfinite(residual), residual, np.inf) / scale)
    return robust, residual, noise


def _bandwidths(xy: np.ndarray, s: np.ndarray, w: np.ndarray, hint: np.ndarray
                ) -> tuple[np.ndarray, np.ndarray]:
    """How wide a window each sample is fitted over, and the finest it could be.

    The floor is set by the data: a window has to hold a few samples, so points five metres
    apart (lidar stations along a footway) cannot resolve a three-metre kerb return however
    the fit is tuned, and the fit says so instead of drawing one. The ceiling is the default
    bandwidth, lowered where the curve turns tightly so the window follows a bend instead of
    cutting across it.
    """
    order = np.argsort(s)
    gaps = np.diff(s[order])
    local = np.empty(len(s))
    if len(gaps):
        before = np.concatenate([[gaps[0]], gaps])
        after = np.concatenate([gaps, [gaps[-1]]])
        local[order] = np.minimum(before, after)
    else:
        local[:] = SMOOTH_BANDWIDTH_M
    # Median over a few neighbours so a single close pair does not narrow the window.
    smooth = np.array([np.median(local[order][max(k - 3, 0):k + 4]) for k in range(len(s))])
    floor = np.empty(len(s))
    floor[order] = np.maximum(MIN_BANDWIDTH_M, SPACING_BANDWIDTH_FACTOR * smooth)
    base = np.maximum(SMOOTH_BANDWIDTH_M, floor)
    near = _Neighbours(xy, float(base.max()))
    kappa = np.zeros(len(xy))
    for i in range(len(xy)):
        fit = _mls(xy[i], hint[i], xy, w, near, float(base[i]), strand=(s, float(s[i])))
        if fit is not None:
            kappa[i] = abs(fit[3])
    # The window is set by the tightest bend it would reach, not the bend at its centre: at the
    # inflection between two opposite bends the curvature is zero, and a window sized by that
    # alone reaches into both and flattens the S.
    bandwidth = base.copy()
    for i in range(len(xy)):
        reach = near.query(xy[i], float(base[i]))
        reach = reach[np.abs(s[reach] - s[i]) <= STRAND_FACTOR * base[i] + 1.0]
        tightest = float(kappa[reach].max()) if reach.size else kappa[i]
        if tightest > 1e-6:
            bandwidth[i] = min(base[i], max(floor[i], BEND_BANDWIDTH_FACTOR / tightest))
    return bandwidth, floor


def _assign_legs(s: np.ndarray, xy: np.ndarray,
                 corners: list[tuple[Corner, np.ndarray, np.ndarray]]) -> np.ndarray:
    """Which smooth piece each sample belongs to, split at the sharp corners.

    Near a corner a sample goes to whichever arm it is closer to -- by arc position alone,
    points on both legs near the vertex interleave, and a leg fitted with the other leg's
    points in it rounds the corner the evidence said was sharp.
    """
    leg = np.zeros(len(s), dtype=np.int64)
    for number, (corner, d1, d2) in enumerate(corners, start=1):
        vertex = np.asarray(corner.vertex)
        s_vertex = float(s[int(np.argmin(np.linalg.norm(xy - vertex, axis=1)))])
        later = s > s_vertex
        near = np.abs(s - s_vertex) <= CORNER_WINDOW_M
        rel = xy - vertex
        dist_in = np.linalg.norm(rel - np.minimum(rel @ d1, 0.0)[:, None] * d1, axis=1)
        dist_out = np.linalg.norm(rel - np.maximum(rel @ d2, 0.0)[:, None] * d2, axis=1)
        after = np.where(near, dist_out < dist_in, later)
        leg[after & (leg == number - 1)] = number
    return leg


def _trace(xy: np.ndarray, s: np.ndarray, w: np.ndarray, bandwidth: np.ndarray,
           start: np.ndarray, start_dir: np.ndarray, stop: np.ndarray | None
           ) -> tuple[list[np.ndarray], list[bool], list[float], list[tuple[float, float]]]:
    """Walk along the curve the samples describe, one output step at a time.

    The walk keeps track of how far along the samples it has come, and only ever consults
    samples near that point of the curve, so it cannot step across onto another strand of a
    line that doubles back. It ends at ``stop`` (a sharp corner's vertex) or, if there is
    none, where the evidence ends.
    """
    near = _Neighbours(xy, float(bandwidth.max()))
    live = w > 0
    s_live_max = float(s[live].max()) if live.any() else float(s.max())

    def locate(p: np.ndarray, around: float) -> int:
        """The sample nearest p among those near ``around`` along the curve."""
        window = np.flatnonzero(np.abs(s - around) <= STRAND_FACTOR * SMOOTH_BANDWIDTH_M + 2.0)
        if not window.size:
            window = np.arange(len(s))
        return int(window[np.argmin(np.linalg.norm(xy[window] - p, axis=1))])

    def project(q: np.ndarray, direction: np.ndarray, around: float,
                scale: float = 1.0) -> tuple[np.ndarray, np.ndarray, float, float, bool] | None:
        k = locate(q, around)
        h = max(float(bandwidth[k]) * scale, MIN_BANDWIDTH_M)
        return _mls(q, direction, xy, w, near, h, strand=(s, float(s[k])))

    s_cur = float(s[locate(start, float(s[np.argmin(np.linalg.norm(xy - start, axis=1))]))])
    fit = project(start, start_dir, s_cur)
    p, t = (fit[0], fit[1]) if fit else (start, start_dir)
    if stop is None and live.any():
        # The curve ends where its evidence ends: at the last sample, projected.
        last = int(np.flatnonzero(live)[np.argmax(s[live])])
        end = project(xy[last], t, float(s[last]))
        stop = end[0] if end is not None else xy[last]
    points = [p]
    observed = [fit is not None]
    support = [fit[2] if fit else 0.0]
    gaps: list[tuple[float, float]] = []
    limit = int((s.max() - s.min() + 2 * MAX_BRIDGE_M) / OUTPUT_STEP_M) * 3 + 10
    # The stop is only looked for once most of the way has been walked: on a ring the last
    # sample sits one spacing behind the first, and the walk would otherwise stop at once.
    walked = 0.0
    must_walk = 0.5 * float(np.ptp(s[live])) if live.any() else 0.0
    for _ in range(limit):
        if stop is not None and walked >= must_walk \
                and float(np.linalg.norm(stop - p)) <= OUTPUT_STEP_M * 1.5 \
                and float((stop - p) @ t) <= OUTPUT_STEP_M * 1.5:
            break
        fit = None
        for scale in (1.0, 0.5):
            guess = p + OUTPUT_STEP_M * scale * t
            fit = project(guess, t, s_cur, scale)
            if fit is not None:
                fit = project(fit[0], fit[1], s_cur, scale) or fit
            if fit is not None and not fit[4]:
                # Evidence on one side only: this point would be an extrapolation past the
                # end of the samples -- the end of the curve, or the edge of a gap.
                fit = None
            if fit is None or float((fit[0] - p) @ t) > OUTPUT_STEP_M * scale * 0.3:
                break
        if fit is not None and float((fit[0] - p) @ t) > 1e-3:
            walked += float(np.linalg.norm(fit[0] - p))
            p, t = fit[0], fit[1]
            s_cur = float(s[locate(p, s_cur)])
            points.append(p)
            observed.append(True)
            support.append(fit[2])
            if s_cur >= s_live_max and stop is not None and \
                    float((stop - p) @ t) < 0:
                break
            continue
        if fit is not None:
            # Evidence here, but the curve will not go on: stop rather than guess.
            break
        # No curve ahead within reach: a gap to bridge, if the samples go on.
        ahead = np.flatnonzero(live & (s > s_cur + OUTPUT_STEP_M))
        if not ahead.size:
            break
        nxt = int(ahead[np.argmin(s[ahead])])
        resume = project(xy[nxt], t, float(s[nxt]))
        target, t_target = (resume[0], resume[1]) if resume else (xy[nxt], t)
        span = float(np.linalg.norm(target - p))
        if span > MAX_BRIDGE_M or span < 1e-6:
            break
        # The bridge's end directions come from a couple of metres either side of the gap: the
        # trace's own last stretch, and the first stretch of samples beyond. A tangent read at
        # the very edge of the evidence has samples on one side only, and a few degrees of error
        # there bows a seven-metre bridge by a hand's width.
        t_out = _chord_direction(np.asarray(points), BRIDGE_TANGENT_M, t)
        beyond = np.flatnonzero(live & (s >= s[nxt]) & (s <= s[nxt] + BRIDGE_TANGENT_M))
        if beyond.size >= 3:
            _, t_in, _ = _robust_line(xy[beyond], w[beyond])
            t_in = t_in if float(t_in @ t_out) >= 0 else -t_in
        else:
            t_in = t_target
        count = max(2, math.ceil(span / OUTPUT_STEP_M))
        bridge = _hermite(p, target, t_out * span, t_in * span, np.linspace(0.0, 1.0, count + 1))
        t_target = t_in
        # Only a stretch the samples themselves leave empty is unobserved. The walk also stops
        # a little short of the last sample before any gap -- it will not extrapolate -- and
        # that last step to the next sample is not a gap in the evidence.
        before = live & (s <= s_cur + 1e-9)
        last_seen = float(s[before].max()) if before.any() else s_cur
        real_gap = float(s[nxt]) - last_seen > GAP_M
        if real_gap:
            gaps.append((last_seen, float(s[nxt])))
        for q in bridge[1:-1]:
            points.append(q)
            observed.append(not real_gap)
            support.append(0.0)
        walked += span
        p, t, s_cur = target, t_target, float(s[nxt])
        points.append(p)
        observed.append(True)
        support.append(resume[2] if resume else 0.0)
    # Snap onto the stop only if the walk got there. A walk that gave up short of it has
    # nothing to say about the stretch between, and a straight chord to the stop would say it.
    if stop is not None and 1e-6 < float(np.linalg.norm(stop - points[-1])) <= \
            max(OUTPUT_STEP_M * 2.0, float(bandwidth.max())):
        points.append(stop)
        observed.append(True)
        support.append(support[-1])
    return points, observed, support, gaps


def _chord_direction(points: np.ndarray, reach_m: float, fallback: np.ndarray) -> np.ndarray:
    """Direction from the point ``reach_m`` back along a traced run to its last point."""
    if len(points) < 2:
        return fallback
    back = np.cumsum(np.linalg.norm(np.diff(points[::-1], axis=0), axis=1))
    k = int(np.searchsorted(back, reach_m)) + 1
    d = points[-1] - points[-1 - min(k, len(points) - 1)]
    norm = float(np.linalg.norm(d))
    return d / norm if norm > 1e-9 else fallback


def _bends(path: PiecewisePath, along: np.ndarray) -> list[Corner]:
    """Runs of the fitted path that turn tighter than BEND_MAX_RADIUS_M, as rounded corners."""
    kappa = np.nan_to_num(path.curvature())
    turning = path.turning()
    tight = np.abs(kappa) > 1.0 / BEND_MAX_RADIUS_M
    for b in path.breaks:
        tight[b] = False
    bends: list[Corner] = []
    k = 0
    while k < len(tight):
        if not tight[k]:
            k += 1
            continue
        j = k
        sign = np.sign(kappa[k])
        while j + 1 < len(tight) and tight[j + 1] and np.sign(kappa[j + 1]) == sign:
            j += 1
        turn = float(np.degrees(turning[k:j + 1].sum()))
        if j - k >= 2 and abs(turn) >= CORNER_MIN_TURN_DEG:
            centre = (k + j) // 2
            # The circle is fitted to the bend's core: its edges are where the windowed
            # curvature is still rising out of the straight (or out of the next bend).
            run = np.abs(kappa[k:j + 1])
            core = np.flatnonzero(run >= 0.6 * run.max()) + k
            core = np.arange(core.min(), core.max() + 1) if core.size >= 3 else np.arange(k, j + 1)
            bends.append(Corner(float(along[centre]), "rounded",
                                _arc_radius(path.points[core, :2]), turn,
                                (float(path.points[centre, 0]), float(path.points[centre, 1])),
                                float("nan"), float("nan"), j - k + 1))
        k = j + 1
    return bends


def _arc_radius(points: np.ndarray) -> float:
    """Radius of the circle through a run of points (algebraic least squares)."""
    x, y = points[:, 0], points[:, 1]
    design = np.column_stack([x, y, np.ones_like(x)])
    b, *_ = np.linalg.lstsq(design, x * x + y * y, rcond=None)
    cx, cy = b[0] / 2.0, b[1] / 2.0
    return float(math.sqrt(max(b[2] + cx * cx + cy * cy, 0.0)))


def _fit_open(samples: CurveSamples, index: np.ndarray, s: np.ndarray,
              rejected: list[tuple[int, str]]) -> PathFit | None:
    xyz = samples.xyz[index]
    base_w = samples.weight[index]
    n = len(index)
    if n < 3 or s[-1] - s[0] < 0.5:
        return None
    xy = xyz[:, :2]
    hint = _order_hint(xy)
    bandwidth, _ = _bandwidths(xy, s, base_w, hint)
    # Corners are looked for with weights from one-sided fits. The strict weights come from a
    # two-sided local fit, which cannot follow a true corner -- judged by it, the very samples
    # that prove a corner is sharp look like noise and would be thrown away.
    lenient, _, noise = _robust_weights(xy, s, base_w, hint, bandwidth, one_sided=True)
    found = _find_corners(s, xy, base_w * lenient, noise)
    sharp = [c for c in found if c[0].kind == "sharp"]
    leg = _assign_legs(s, xy, sharp)
    # Now the strict weights, one leg at a time: each leg is judged against its own curve.
    robust = np.zeros(n)
    noises = []
    for number in range(len(sharp) + 1):
        sub = np.flatnonzero(leg == number)
        if sub.size < 3:
            continue
        sub_s, sub_xy, sub_w, sub_hint = s[sub], xy[sub], base_w[sub], hint[sub]
        bw, _ = _bandwidths(sub_xy, sub_s, sub_w, sub_hint)
        r, _, leg_noise = _robust_weights(sub_xy, sub_s, sub_w, sub_hint, bw)
        # Once the strays are out, the bends are read again from the evidence alone.
        bw, _ = _bandwidths(sub_xy, sub_s, sub_w * r, sub_hint)
        r, _, leg_noise = _robust_weights(sub_xy, sub_s, sub_w, sub_hint, bw)
        robust[sub] = r
        bandwidth[sub] = bw
        noises.append(leg_noise)
    noise = float(np.median(noises)) if noises else noise
    w = base_w * robust

    points: list[np.ndarray] = []
    observed: list[bool] = []
    support: list[float] = []
    gaps: list[tuple[float, float]] = []
    breaks: list[int] = []
    start: np.ndarray | None = None
    start_dir: np.ndarray | None = None
    for piece in range(len(sharp) + 1):
        mine = (leg == piece) & (w > 0)
        if mine.sum() < 2:
            continue
        mine_idx = np.flatnonzero(mine)
        if start is None:
            first = mine_idx[np.argmin(s[mine_idx])]
            # Which way is forward, from the samples over the first couple of metres: the
            # first two or three samples can sit across a wide object rather than along it.
            ahead = mine_idx[s[mine_idx] <= s[first] + START_DIRECTION_M]
            forward = xy[ahead].mean(axis=0) - xy[first]
            norm = float(np.linalg.norm(forward))
            start = xy[first]
            start_dir = forward / norm if norm > 1e-6 else hint[first]
        stop = np.asarray(sharp[piece][0].vertex) if piece < len(sharp) else None
        piece_w = np.where(leg == piece, w, 0.0)
        assert start_dir is not None
        pts, obs, sup, gp = _trace(xy, s, piece_w, bandwidth, start, start_dir, stop)
        if points:
            pts, obs, sup = pts[1:], obs[1:], sup[1:]
        points.extend(pts)
        observed.extend(obs)
        support.extend(sup)
        gaps.extend(gp)
        if stop is not None:
            breaks.append(len(points) - 1)
            start, start_dir = stop, sharp[piece][2]
    if len(points) < 2:
        return None
    plan = np.asarray(points)
    # Heights: a local line in arc position over a wider window; the ground under a kerb bends
    # more slowly than the kerb does and is measured more noisily.
    _, foot = _distance_to_polyline(xy, plan)
    along = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(plan, axis=0), axis=1))])
    order = np.argsort(foot)
    z = _height_profile(foot[order], xyz[order, 2], w[order], along)
    path = PiecewisePath(np.column_stack([plan, z]), tuple(breaks), np.asarray(observed),
                         np.asarray(support))
    # Sharp corners are decided by the corner models. Everything else that turns is read off
    # the fitted path itself: one bend per run of curvature, its radius the circle through it.
    corners = [c for c, _, _ in found if c.kind == "sharp"]
    corners += _bends(path, along)
    corners.sort(key=lambda c: c.s_m)
    residual, foot = _distance_to_polyline(xy, plan)
    inlier = robust > 0
    problems = validate_path(path)
    # Truncated: kept samples that lie beyond either end of the path, not merely beside it --
    # a wide object's samples are well off its axis all the way along, and that is its width.
    total = float(along[-1])
    reach = max(4.0 * max(noise, ROBUST_SCALE_FLOOR_M), float(bandwidth.max()))
    beyond = inlier & (((foot <= 1e-6) | (foot >= total - 1e-6)) & (residual > reach))
    if inlier.any() and float(beyond.mean()) > 0.02:
        problems.append(f"truncated: {float(beyond.mean()):.0%} of the kept samples lie "
                        "beyond the ends of the path")
    full = len(samples)
    full_residual = np.full(full, np.nan)
    full_s = np.full(full, np.nan)
    full_inlier = np.zeros(full, dtype=bool)
    full_residual[index] = residual
    full_s[index] = foot
    full_inlier[index] = inlier
    rejected = [*rejected,
                *((int(index[k]), "robust_weight_zero") for k in np.flatnonzero(~inlier))]
    present = ~np.isnan(full_residual)
    return PathFit(path, full_s[present], full_residual[present], full_inlier[present],
                   tuple(corners), tuple(gaps), noise, tuple(rejected), tuple(problems))


def _height_profile(s: np.ndarray, z: np.ndarray, w: np.ndarray, at: np.ndarray) -> np.ndarray:
    out = np.full(len(at), np.nan)
    lo = np.searchsorted(s, at - HEIGHT_BANDWIDTH_M)
    hi = np.searchsorted(s, at + HEIGHT_BANDWIDTH_M)
    for k, x0 in enumerate(at):
        a, b = int(lo[k]), int(hi[k])
        if b <= a:
            continue
        u = (s[a:b] - x0) / HEIGHT_BANDWIDTH_M
        kern = (1.0 - np.clip(np.abs(u), 0.0, 1.0) ** 3) ** 3 * w[a:b]
        if kern.sum() <= 1e-9:
            continue
        degree = 1 if (kern > 1e-6).sum() >= 3 else 0
        design = np.vander(s[a:b] - x0, degree + 1, increasing=True)
        wd = design * kern[:, None]
        out[k] = np.linalg.solve(design.T @ wd + np.eye(degree + 1) * 1e-9, wd.T @ z[a:b])[0]
    good = np.flatnonzero(np.isfinite(out))
    if not good.size:
        return np.zeros(len(at))
    return np.interp(np.arange(len(at)), good, out[good])


def validate_path(path: PiecewisePath) -> list[str]:
    """What is physically wrong with a path: zigzag spikes, reversals and self-crossings.

    A tight bend is not in itself wrong -- a surveyed kerb has twenty-centimetre notches in
    it. What a single bad sample does to a fit is different: the path jumps out and back, a
    large turn one way immediately followed by a large turn the other, or turns right round.
    """
    problems: list[str] = []
    turn = np.degrees(path.turning())
    breaks = set(path.breaks)
    live = np.array([k not in breaks for k in range(len(turn))])
    zigzag = (np.abs(turn[:-1]) > SPIKE_TURN_DEG) & (np.abs(turn[1:]) > SPIKE_TURN_DEG) & \
        (np.sign(turn[:-1]) != np.sign(turn[1:])) & live[:-1] & live[1:]
    reversal = (np.abs(turn) > REVERSAL_TURN_DEG) & live
    if zigzag.any():
        problems.append(f"spike: {int(zigzag.sum())} out-and-back zigzags")
    if reversal.any():
        problems.append(f"spike: {int(reversal.sum())} reversals")
    if _self_intersects(path.points[:, :2]):
        problems.append("loop: the path crosses itself")
    return problems


def _self_intersects(xy: np.ndarray, chunk: int = 512) -> bool:
    a, b = xy[:-1], xy[1:]
    m = len(a)
    if m < 3:
        return False

    def orient(p: np.ndarray, q: np.ndarray, r: np.ndarray) -> np.ndarray:
        return (q[..., 0] - p[..., 0]) * (r[..., 1] - p[..., 1]) - \
               (q[..., 1] - p[..., 1]) * (r[..., 0] - p[..., 0])

    for start in range(0, m, chunk):
        i = np.arange(start, min(start + chunk, m))
        p, q = a[i][:, None], b[i][:, None]
        r, t = a[None], b[None]
        o1, o2 = orient(p, q, r), orient(p, q, t)
        o3, o4 = orient(r, t, p), orient(r, t, q)
        cross = (o1 * o2 < -1e-12) & (o3 * o4 < -1e-12)
        near = np.abs(i[:, None] - np.arange(m)[None]) <= 1
        if (cross & ~near).any():
            return True
    return False


def _fit_exact(samples: CurveSamples) -> PathFit | None:
    """An interpolating fit for points that are the measurement: every vertex is kept.

    A surveyed kerb line is a handful of vertices placed by someone standing on the kerb.
    Smoothing it can only take detail away -- the metre-long jog of a driveway apron, the
    notch at a drain -- so the fit goes through every vertex and decides only what happens
    between them:

    * a vertex where the line turns hard, or turns at all between two long straight runs, is
      a sharp corner and stays one (a break);
    * a long segment is a straight line and stays exactly straight;
    * a run of short segments is a surveyed arc -- a kerb return digitised as five points --
      and is interpolated by cubic Hermite pieces through its vertices, with the tangents at
      its ends taken from the straights it joins, so straight, arc and straight meet smoothly
      as they do on the street.
    """
    xyz = samples.xyz
    keep = np.concatenate([[True], np.linalg.norm(np.diff(xyz[:, :2], axis=0), axis=1) > 0.01])
    xyz = xyz[keep]
    source = np.flatnonzero(keep)
    closed = samples.closed and len(xyz) > 3 and \
        float(np.linalg.norm(xyz[0, :2] - xyz[-1, :2])) < 0.05
    if closed:
        xyz = xyz[:-1]
        source = source[:-1]
    n = len(xyz)
    if n < 2:
        return None
    ring = np.vstack([xyz, xyz[:1]]) if closed else xyz
    seg = np.diff(ring[:, :2], axis=0)
    length = np.linalg.norm(seg, axis=1)
    direction = seg / np.maximum(length[:, None], 1e-12)
    m = len(seg)

    def turn_at(i: int) -> float:
        a = direction[(i - 1) % m] if (closed or i > 0) else None
        b = direction[i % m] if (closed or i < m) else None
        if a is None or b is None:
            return 0.0
        return math.degrees(math.atan2(a[0] * b[1] - a[1] * b[0], float(a @ b)))

    def seg_len(i: int) -> float:
        return float(length[i % m]) if (closed or 0 <= i < m) else 0.0

    vertex_count = n
    sharp = np.zeros(vertex_count, dtype=bool)
    for i in range(vertex_count):
        if not closed and i in (0, n - 1):
            continue
        turn = abs(turn_at(i))
        long_both = seg_len(i - 1) >= EXACT_ARC_SEGMENT_M and seg_len(i) >= EXACT_ARC_SEGMENT_M
        sharp[i] = turn >= EXACT_SHARP_TURN_DEG or (long_both and turn >= EXACT_KINK_TURN_DEG)

    def tangent(i: int, into: int) -> np.ndarray:
        """Tangent at vertex i for the segment ``into`` (i-1 arriving, i leaving)."""
        if sharp[i % vertex_count] or (not closed and i in (0, n - 1)):
            return direction[into % m]
        before, after = seg_len(i - 1), seg_len(i)
        if before >= EXACT_ARC_SEGMENT_M and after < EXACT_ARC_SEGMENT_M:
            return direction[(i - 1) % m]   # an arc leaving a straight takes its direction
        if after >= EXACT_ARC_SEGMENT_M and before < EXACT_ARC_SEGMENT_M:
            return direction[i % m]         # an arc joining a straight arrives along it
        # Inside an arc (or between two straights at a gentle kink): the centripetal
        # average, weighted so the shorter neighbour counts more.
        blend = direction[(i - 1) % m] * after + direction[i % m] * before
        return blend / max(float(np.linalg.norm(blend)), 1e-12)

    points: list[np.ndarray] = [ring[0]]
    breaks: list[int] = []
    for k in range(m):
        a, b = ring[k], ring[k + 1]
        span = float(length[k])
        count = max(1, math.ceil(span / OUTPUT_STEP_M))
        u = np.linspace(0.0, 1.0, count + 1)[1:]
        if span >= EXACT_ARC_SEGMENT_M:
            # A straight run is exactly its two ends; points between them would add bytes and
            # nothing else.
            piece = b[None, :]
        else:
            t0 = tangent(k, k) * span
            t1 = tangent(k + 1, k) * span
            plan = _hermite(a[:2], b[:2], t0, t1, u)
            piece = np.column_stack([plan, a[2] + (b[2] - a[2]) * u])
        points.extend(piece)
        if sharp[(k + 1) % vertex_count] and (closed or k + 1 < n - 1):
            breaks.append(len(points) - 1)
    plan = np.asarray(points)
    if closed:
        breaks = [b for b in breaks if b < len(plan) - 1]
    path = PiecewisePath(plan, tuple(breaks), None, None, closed=closed)
    along = path.arc_length()
    corners = []
    for b in path.breaks:
        vertex = (float(plan[b, 0]), float(plan[b, 1]))
        corners.append(Corner(float(along[b]), "sharp", 0.0, float(np.degrees(path.turning()[b])),
                              vertex, 0.0, 0.0, 1))
    corners += _bends(path, along)
    corners.sort(key=lambda c: c.s_m)
    residual, foot = _distance_to_polyline(samples.xyz[:, :2], plan[:, :2])
    return PathFit(path, foot, residual, np.ones(len(samples), dtype=bool), tuple(corners), (),
                   0.0, (), tuple(validate_path(path)))


def fit_paths(samples: CurveSamples) -> list[PathFit]:
    """Fit every curve the samples describe. Gaps wider than MAX_BRIDGE_M split them."""
    if samples.exact:
        return [fit for fit in [_fit_exact(samples)] if fit is not None]
    if samples.closed:
        return [fit for fit in [_fit_closed(samples)] if fit is not None]
    index, s, rejected = order_samples(samples)
    if len(index) < 3:
        return []
    if not samples.ordered:
        # Order again with only what a first robust fit believed. An outlier cannot bend the
        # final fit, but it can bend the ordering the fit is run along.
        first = [f for f in fit_paths(CurveSamples(samples.xyz[index], samples.weight[index],
                                                   samples.source[index], ordered=True))]
        doubted = {int(index[k]) for f in first for k, why in f.rejected
                   if why == "robust_weight_zero"}
        if doubted:
            keep = np.array([i for i in range(len(samples)) if i not in doubted], dtype=np.int64)
            sub_index, s, more = order_samples(samples.subset(keep))
            index = keep[sub_index]
            rejected = [*rejected, *((int(keep[k]), why) for k, why in more),
                        *((i, "robust_weight_zero") for i in sorted(doubted))]
            if len(index) < 3:
                return []
    s = s - s[0]
    splits = np.flatnonzero(np.diff(s) > MAX_BRIDGE_M) + 1
    fits: list[PathFit] = []
    for part_index, part_s in zip(np.split(index, splits), np.split(s, splits), strict=True):
        fit = _fit_open(samples, part_index, part_s - part_s[0], rejected if not fits else [])
        if fit is not None:
            fits.append(fit)
    return fits


def fit_path(samples: CurveSamples) -> PathFit:
    """The longest curve the samples describe."""
    fits = fit_paths(samples)
    if not fits:
        raise ValueError("too few samples to fit a path")
    return max(fits, key=lambda f: f.path.length)


def _fit_closed(samples: CurveSamples) -> PathFit | None:
    """A ring: cut at its straightest point, fitted as an open path, and closed there.

    The cut goes where the ring is straightest so that the two ends of the open fit -- where
    a local fit has evidence on one side only -- meet on a stretch a line describes exactly,
    and no corner is ever split between the first and last piece.
    """
    xyz = samples.xyz
    if np.linalg.norm(xyz[0, :2] - xyz[-1, :2]) < 1e-6:
        xyz = xyz[:-1]
    n = len(xyz)
    if n < 6:
        return None
    ring = np.vstack([xyz[-2:], xyz, xyz[:2]])[:, :2]
    heading = np.diff(ring, axis=0)
    angle = np.arctan2(heading[:, 1], heading[:, 0])
    turn = np.abs(np.angle(np.exp(1j * np.diff(angle))))  # at each original vertex, ±1 around
    local = turn[:-2] + turn[1:-1] + turn[2:]
    cut = int(np.argmin(local[:n]))
    order = np.roll(np.arange(n), -cut)
    weight = samples.weight[: len(samples.weight)][order % len(samples.weight)]
    source = samples.source[order % len(samples.source)]
    rolled = CurveSamples(xyz[order], weight, source, ordered=True)
    s = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(rolled.xyz[:, :2], axis=0),
                                                        axis=1))])
    fit = _fit_open(rolled, np.arange(n), s, [])
    if fit is None:
        return None
    path = fit.path
    # The walk round the ring may overrun its own start by a step; what overran is dropped so
    # the closing segment runs forward, not back over the start.
    last = len(path.points)
    start_dir = path.points[1, :2] - path.points[0, :2]
    while last > 3:
        rel = path.points[last - 1, :2] - path.points[0, :2]
        if float(np.linalg.norm(rel)) < OUTPUT_STEP_M * 1.5 or (float(rel @ start_dir) > 0 and \
                float(np.linalg.norm(rel)) < OUTPUT_STEP_M * 4):
            last -= 1
            continue
        break
    kept = path.points[:last]
    points = np.vstack([kept, kept[:1]])
    closed = PiecewisePath(points, tuple(b for b in path.breaks if b < last - 1),
                           np.append(path.observed[:last], path.observed[0]),
                           np.append(path.support[:last], path.support[0]), closed=True)
    residual, foot = _distance_to_polyline(xyz[:, :2], closed.points[:, :2])
    inlier = np.zeros(n, dtype=bool)
    inlier[order] = fit.inlier
    rejected = tuple((int(order[i]), why) for i, why in fit.rejected)
    return PathFit(closed, foot, residual, inlier, fit.corners, fit.gaps, fit.noise_m, rejected,
                   tuple(validate_path(closed)))


def densify_polyline(points: np.ndarray, step_m: float) -> np.ndarray:
    """Points every ``step_m`` along a polyline, keeping every original vertex."""
    points = np.asarray(points, dtype=np.float64)
    out = [points[:1]]
    for a, b in itertools.pairwise(points):
        length = float(np.linalg.norm(b[:2] - a[:2]))
        count = max(1, math.ceil(length / step_m))
        t = np.linspace(0.0, 1.0, count + 1)[1:, None]
        out.append(a + (b - a) * t)
    return np.concatenate(out)
