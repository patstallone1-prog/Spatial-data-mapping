"""The arbitrary kerb-path fitter, on the shapes a kerb actually takes.

Every case is judged against the true curve it was sampled from, not against what the fitter
happens to produce, and the samples are shuffled: a sensor does not hand over its points in
order along the kerb. The rule the whole module exists for is in
:func:`test_a_rounded_corner_stays_rounded`: no corner type exists for a rounded return to
collapse into.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from smc.geometry.spline import (
    CurveSamples,
    PiecewisePath,
    _arc_radius,
    _distance_to_polyline,
    densify_polyline,
    fit_path,
    fit_paths,
    validate_path,
)
from smc.reconstruction.geo import EnuFrame

ROOT = Path(__file__).resolve().parents[1]
NOISE_M = 0.02


def line(a, b, step=0.3):
    a, b = np.asarray(a, float), np.asarray(b, float)
    n = int(np.linalg.norm(b - a) / step) + 1
    return a + (b - a) * np.linspace(0.0, 1.0, n)[:, None]


def arc(centre, radius, t0, t1, step=0.3):
    n = max(3, int(abs(t1 - t0) * radius / step))
    t = np.linspace(t0, t1, n)
    return np.column_stack([centre[0] + radius * np.cos(t), centre[1] + radius * np.sin(t)])


def sensor(xy, seed, z=None):
    """Noisy, shuffled 3D samples of a plan curve."""
    rng = np.random.default_rng(seed)
    noisy = xy + rng.normal(0.0, NOISE_M, xy.shape)
    height = np.zeros(len(xy)) if z is None else z(noisy)
    pts = np.column_stack([noisy, height])
    return CurveSamples(pts[rng.permutation(len(pts))]), rng


def deviation(path: PiecewisePath, truth: np.ndarray) -> float:
    """Worst plan distance from the fitted path to the true curve."""
    return float(_distance_to_polyline(path.points[:, :2], truth)[0].max())


def coverage_gap(path: PiecewisePath, truth: np.ndarray) -> float:
    """Worst distance from the true curve to the fitted path: what the fit left out."""
    return float(_distance_to_polyline(truth, path.points[:, :2])[0].max())


def test_straight_curb_stays_straight() -> None:
    truth = line((0, 0), (30, 0), 0.05)
    samples, _ = sensor(line((0, 0), (30, 0)), 1)
    fit = fit_path(samples)
    assert not fit.problems
    assert not [c for c in fit.corners]
    assert deviation(fit.path, truth) < 0.05
    assert coverage_gap(fit.path, truth) < 0.1
    assert fit.rms_m < 2 * NOISE_M


def test_a_sharp_corner_stays_sharp() -> None:
    xy = np.vstack([line((-12, 0), (0, 0)), line((0, 0), (0, 12))[1:]])
    truth = np.array([(-12, 0), (0, 0), (0, 12)], float)
    fit = fit_path(sensor(xy, 2)[0])
    sharp = [c for c in fit.corners if c.kind == "sharp"]
    assert len(sharp) == 1 and not [c for c in fit.corners if c.kind == "rounded"]
    assert abs(abs(sharp[0].turn_deg) - 90) < 5
    # The vertex is the corner itself, and it is a break in the path: a true C0 point.
    assert math.hypot(*sharp[0].vertex) < 0.05
    assert fit.path.breaks
    assert float(np.linalg.norm(fit.path.points[:, :2], axis=1).min()) < 0.05
    assert deviation(fit.path, truth) < 0.06


def test_a_rounded_corner_stays_rounded() -> None:
    """The case the old corner pieces got wrong: a 3 m return drawn as a square corner."""
    radius = 3.0
    xy = np.vstack([line((-12, 0), (-radius, 0)),
                    arc((-radius, radius), radius, -math.pi / 2, 0)[1:],
                    line((0, radius), (0, 12))[1:]])
    truth = np.vstack([[(-12, 0)], arc((-radius, radius), radius, -math.pi / 2, 0, 0.05),
                       [(0, 12)]])
    fit = fit_path(sensor(xy, 3)[0])
    rounded = [c for c in fit.corners if c.kind == "rounded"]
    assert not [c for c in fit.corners if c.kind == "sharp"], "collapsed into a square corner"
    assert not fit.path.breaks
    assert len(rounded) == 1
    assert rounded[0].radius_m == pytest.approx(radius, rel=0.1)
    assert abs(abs(rounded[0].turn_deg) - 90) < 8
    # The path never goes near where a square corner would put its vertex.
    cut = radius * (math.sqrt(2) - 1)
    assert float(np.linalg.norm(fit.path.points[:, :2], axis=1).min()) > cut - 0.06
    assert deviation(fit.path, truth) < 0.06


def test_a_broad_curve_keeps_its_radius() -> None:
    radius = 25.0
    xy = arc((0, radius), radius, -math.pi / 2, -math.pi / 2 + 1.0)
    truth = arc((0, radius), radius, -math.pi / 2, -math.pi / 2 + 1.0, 0.05)
    fit = fit_path(sensor(xy, 4)[0])
    assert not [c for c in fit.corners if c.kind == "sharp"]
    assert deviation(fit.path, truth) < 0.05
    # The radius of the circle through the fitted path, not a three-point curvature: two
    # centimetres of noise make any local estimate noisy, and the fit is judged by its shape.
    assert _arc_radius(fit.path.points[:, :2]) == pytest.approx(radius, rel=0.1)


def test_an_s_curve_changes_direction_once() -> None:
    first = arc((0, 10), 10, -math.pi / 2, -math.pi / 2 + 0.8)
    end = first[-1]
    heading = np.array([math.cos(0.8), math.sin(0.8)])
    centre = end + np.array([heading[1], -heading[0]]) * 10
    a0 = math.atan2(end[1] - centre[1], end[0] - centre[0])
    second = arc(centre, 10, a0, a0 - 0.8)
    truth = np.vstack([arc((0, 10), 10, -math.pi / 2, -math.pi / 2 + 0.8, 0.05),
                       arc(centre, 10, a0, a0 - 0.8, 0.05)])
    fit = fit_path(sensor(np.vstack([first, second[1:]]), 5)[0])
    assert deviation(fit.path, truth) < 0.06
    kappa = np.nan_to_num(fit.path.curvature(1.5))[4:-4]
    signs = np.sign(kappa[np.abs(kappa) > 0.05])
    assert int((np.diff(signs) != 0).sum()) == 1


def test_a_bulb_out_keeps_its_four_bends() -> None:
    r = 1.5
    parts = [line((-15, 0), (-6, 0)), arc((-6, r), r, -math.pi / 2, 0)[1:],
             arc((-3, r), r, math.pi, math.pi / 2)[1:], line((-3, 3), (3, 3))[1:],
             arc((3, r), r, math.pi / 2, 0)[1:], arc((6, r), r, math.pi, 3 * math.pi / 2)[1:],
             line((6, 0), (15, 0))[1:]]
    truth = np.vstack([line((-15, 0), (-6, 0), 0.05), arc((-6, r), r, -math.pi / 2, 0, 0.05),
                       arc((-3, r), r, math.pi, math.pi / 2, 0.05), line((-3, 3), (3, 3), 0.05),
                       arc((3, r), r, math.pi / 2, 0, 0.05),
                       arc((6, r), r, math.pi, 3 * math.pi / 2, 0.05),
                       line((6, 0), (15, 0), 0.05)])
    fit = fit_path(sensor(np.vstack(parts), 6)[0])
    rounded = [c for c in fit.corners if c.kind == "rounded"]
    assert len(rounded) == 4
    for bend in rounded:
        assert bend.radius_m == pytest.approx(r, rel=0.2)
    assert deviation(fit.path, truth) < 0.1
    assert not fit.problems


def test_a_missing_stretch_is_bridged_and_marked_unobserved() -> None:
    xy = line((0, 0), (40, 0))
    xy = xy[(xy[:, 0] < 15) | (xy[:, 0] > 22)]
    fit = fit_path(sensor(xy, 7)[0])
    assert len(fit.gaps) == 1
    g0, g1 = fit.gaps[0]
    assert 5.0 < g1 - g0 < 9.0
    s = fit.path.arc_length()
    x = fit.path.points[:, 0]
    inside = (x > 16) & (x < 21)
    assert inside.any() and not fit.path.observed[inside].any()
    assert fit.path.observed[(x < 13) | (x > 24)].all()
    assert fit.observed_fraction == pytest.approx(33 / 40, abs=0.05)
    assert deviation(fit.path, line((0, 0), (40, 0), 0.05)) < 0.1
    assert s[-1] == pytest.approx(40, abs=0.3)


def test_a_wide_gap_is_two_kerbs_not_one() -> None:
    xy = line((0, 0), (60, 0))
    xy = xy[(xy[:, 0] < 15) | (xy[:, 0] > 40)]
    fits = fit_paths(sensor(xy, 8)[0])
    assert len(fits) == 2


@pytest.mark.parametrize("seed", range(12))
def test_outliers_are_rejected_not_followed(seed: int) -> None:
    rng = np.random.default_rng(100 + seed)
    xy = line((0, 0), (30, 0))
    noisy = xy + rng.normal(0.0, NOISE_M, xy.shape)
    stray = rng.choice(len(xy), 6, replace=False)
    noisy[stray, 1] += rng.uniform(0.5, 2.0, 6) * rng.choice([-1, 1], 6)
    pts = np.column_stack([noisy, np.zeros(len(xy))])
    fit = fit_path(CurveSamples(pts[rng.permutation(len(pts))]))
    assert not fit.problems, "a stray sample made a loop or a spike"
    assert deviation(fit.path, line((0, 0), (30, 0), 0.05)) < 0.12
    assert {why for _, why in fit.rejected} <= {"robust_weight_zero", "isolated", "off_path"}
    assert len(fit.rejected) >= 4


def test_uneven_ground_is_followed_in_height() -> None:
    def ground(xy):
        return 2.0 * np.sin(2 * math.pi * xy[:, 0] / 40)

    fit = fit_path(sensor(line((0, 0), (40, 0)), 9, ground)[0])
    heights = ground(fit.path.points[:, :2])
    assert float(np.abs(fit.path.points[:, 2] - heights).max()) < 0.04


def test_a_noisy_ring_closes_without_a_seam() -> None:
    radius = 6.0
    ring = arc((0, 0), radius, 0, 2 * math.pi, 0.3)[:-1]
    rng = np.random.default_rng(10)
    pts = np.column_stack([ring + rng.normal(0, NOISE_M, ring.shape), np.zeros(len(ring))])
    fit = fit_path(CurveSamples(pts, ordered=True, closed=True))
    assert fit.path.closed
    assert np.allclose(fit.path.points[0], fit.path.points[-1])
    r = np.linalg.norm(fit.path.points[:, :2], axis=1)
    assert float(np.abs(r - radius).max()) < 0.06
    assert not fit.problems


def test_samples_keep_their_provenance() -> None:
    xy = line((0, 0), (20, 0))
    pts = np.column_stack([xy, np.zeros(len(xy))])
    source = np.arange(len(pts)) % 3
    fit = fit_path(CurveSamples(pts, None, source))
    assert len(fit.s) == len(pts) and len(fit.residual_m) == len(pts)
    assert fit.path.support.shape == (len(fit.path.points),)
    assert float(fit.path.support.min()) > 0


def test_validation_catches_a_zigzag_and_a_loop() -> None:
    zig = PiecewisePath(np.array([[0, 0, 0], [1, 0, 0], [1.05, 0.5, 0], [1.1, 0, 0], [2, 0, 0]]))
    assert any("zigzag" in p for p in validate_path(zig))
    loop = PiecewisePath(np.array([[0, 0, 0], [2, 0, 0], [2, 2, 0], [1, -1, 0]]))
    assert any("loop" in p for p in validate_path(loop))


def _sf_lines():
    data = json.loads((ROOT / "docs" / "sf-corridor-official.json").read_text())
    return data["curb_lines"]


def _local(line_):
    p = np.asarray(line_["p"], float)
    frame = EnuFrame(p[0][0], p[0][1], 0.0)
    return np.array([frame.to_enu(lon, lat, 0.0) for lon, lat in p])


@pytest.mark.skipif(not (ROOT / "docs" / "sf-corridor-official.json").exists(),
                    reason="needs the corridor's official geometry")
def test_real_surveyed_kerbs_pass_through_every_vertex() -> None:
    """San Francisco's own curb lines: exact data, so the fit goes through every vertex, keeps
    the returns rounded and the corners square, and never loops."""
    lines = [ln for ln in _sf_lines() if len(ln["p"]) >= 6]
    rng = np.random.default_rng(0)
    rounded_seen = sharp_seen = 0
    for ln in (lines[i] for i in rng.choice(len(lines), 120, replace=False)):
        xyz = _local(ln)
        xyz[:, 2] = 0
        closed = float(np.linalg.norm(xyz[0, :2] - xyz[-1, :2])) < 0.05
        fit = fit_path(CurveSamples(xyz, ordered=True, closed=closed, exact=True))
        assert not [p for p in fit.problems if "loop" in p], ln
        assert float(_distance_to_polyline(xyz[:, :2], fit.path.points[:, :2])[0].max()) < 1e-6
        rounded_seen += sum(c.kind == "rounded" for c in fit.corners)
        sharp_seen += sum(c.kind == "sharp" for c in fit.corners)
    assert rounded_seen > 20 and sharp_seen > 20


@pytest.mark.skipif(not (ROOT / "docs" / "sf-corridor-official.json").exists(),
                    reason="needs the corridor's official geometry")
def test_a_real_kerb_return_keeps_its_radius() -> None:
    """A surveyed return at Pacific Heights: its vertices lie on a circle, and so does the fit."""
    for ln in _sf_lines():
        xyz = _local(ln)
        xyz[:, 2] = 0
        fit = fit_path(CurveSamples(xyz, ordered=True, exact=True))
        rounded = [c for c in fit.corners if c.kind == "rounded" and 70 < abs(c.turn_deg) < 110]
        if rounded and not fit.path.breaks and len(xyz) >= 8:
            break
    else:
        pytest.skip("no clean rounded return in the sample")
    bend = rounded[0]
    assert 1.0 < bend.radius_m < 12.0
    # Interpolated, not chorded: the fitted arc bows outside the straight chords between
    # surveyed vertices, as the kerb does.
    chord = densify_polyline(xyz, 0.05)
    assert deviation(fit.path, chord[:, :2]) > 0.002
