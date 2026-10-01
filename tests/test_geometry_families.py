"""Each object gets the geometry family its evidence calls for -- never the nearest prefab.

The family decides *how* a shape is described, not what it may look like: a kerb is a swept
section, a pole a fitted cylinder, a facade structured architecture, an irregular fixture its
measured surface. The central case is the curved bench: nothing here has a straight bench to
fall back on, so the curve it was measured with is the curve it keeps.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from smc.geometry.base import DETAIL_POLICY, GeometryFamily, TriMesh, geometry_from_json
from smc.geometry.extrusion import (
    ProfileKey,
    SplineExtrusion,
    kerb_profile,
    profile_from_points,
    rectangle_profile,
)
from smc.geometry.freeform import FreeformMesh, boundary_edges, reconstruct_surface
from smc.geometry.primitives import fit_assembly, fit_cylinder
from smc.geometry.simplify import simplify_to_tolerance, surface_distance
from smc.geometry.spline import PiecewisePath
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.geometry_classifier import choose_family
from smc.reconstruction.geometry_fit import fit_object
from smc.reconstruction.object_cloud import ObjectCloud
from smc.world.object import EvidenceRef

FRAME = EnuFrame(-122.4, 37.79, 0.0)


def pole_points(rng, radius=0.06, height=3.0, n=1500):
    a = rng.uniform(0, 2 * math.pi, n)
    z = rng.uniform(0, height, n)
    return np.column_stack([2 + radius * np.cos(a), 5 + radius * np.sin(a), z]) + \
        rng.normal(0, 0.004, (n, 3))


def rock_points(rng, n=6000):
    d = rng.normal(size=(n, 3))
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    r = 0.5 * (1 + 0.25 * np.sin(3 * d[:, 0]) * np.cos(2 * d[:, 1]) + 0.15 * d[:, 2] ** 2)
    return d * r[:, None] + np.array([0, 0, 0.5]) + rng.normal(0, 0.004, (n, 3))


def curved_bench_points(rng, radius=4.0, sweep_deg=70.0):
    """A seat 0.5 m deep at 0.42-0.46 m, a back to 0.9 m on its outer edge, three plate legs:
    the kind of bench that wraps a planter."""
    span = math.radians(sweep_deg)

    def at(r, t, z):
        return np.column_stack([r * np.cos(t), r * np.sin(t), z])

    th = rng.uniform(0, span, 6000)
    seat = at(radius + rng.uniform(-0.25, 0.25, 6000), th, rng.uniform(0.42, 0.46, 6000))
    tb = rng.uniform(0, span, 3000)
    back = at(radius + 0.25 + rng.uniform(0, 0.04, 3000), tb, rng.uniform(0.46, 0.9, 3000))
    legs = []
    for t0 in (0.08, span / 2, span - 0.08):
        n = 300
        face = np.where(rng.integers(0, 2, n) == 0, -0.03, 0.03)
        u = rng.uniform(-0.2, 0.2, n)
        centre = np.array([radius * math.cos(t0), radius * math.sin(t0)])
        radial = centre / np.linalg.norm(centre)
        tangent = np.array([-radial[1], radial[0]])
        xy = centre + u[:, None] * radial + face[:, None] * tangent
        legs.append(np.column_stack([xy, rng.uniform(0, 0.42, n)]))
    pts = np.vstack([seat, back, *legs])
    return pts + rng.normal(0, 0.004, pts.shape)


def cloud_of(points, locator="fixture#1"):
    ref = EvidenceRef("fixture", "test_fixture", locator, "CC0-1.0", count=len(points))
    return ObjectCloud(FRAME, points, np.ones(len(points)), np.zeros(len(points), dtype=np.int64),
                       (ref,))


# ---------------------------------------------------------------- family selection ----


def test_a_curb_is_always_a_swept_section() -> None:
    assert choose_family("curb").family is GeometryFamily.SPLINE_EXTRUSION


def test_a_simple_pole_is_a_fitted_primitive() -> None:
    choice = choose_family("pole", pole_points(np.random.default_rng(0)))
    assert choice.family is GeometryFamily.PRIMITIVE_ASSEMBLY
    assert "fitted part" in choice.reason


def test_a_structured_facade_is_parametric_architecture() -> None:
    assert choose_family("facade").family is GeometryFamily.PARAMETRIC_BUILDING
    assert choose_family("building").family is GeometryFamily.PARAMETRIC_BUILDING


def test_an_irregular_fixture_is_kept_as_its_surface() -> None:
    choice = choose_family("planter", rock_points(np.random.default_rng(1)))
    assert choice.family is GeometryFamily.FREEFORM_MESH
    assert dict(choice.rejected)["primitive_assembly"].startswith("no assembly fits")


def test_something_named_a_primitive_that_is_not_one_is_not_drawn_as_one() -> None:
    """A 'bollard' that is really a lump of stone: the name does not make it a cylinder."""
    outcomes = fit_object(cloud_of(rock_points(np.random.default_rng(2))), "bollard")
    assert outcomes[0].family is GeometryFamily.FREEFORM_MESH


# ------------------------------------------------------------------ the curved bench ----


@pytest.fixture(scope="module")
def bench_fit():
    rng = np.random.default_rng(3)
    return fit_object(cloud_of(curved_bench_points(rng)), "bench", material="wood")


def test_a_curved_bench_is_reconstructed_curved(bench_fit) -> None:
    main = bench_fit[0]
    assert main.semantic_type == "bench"
    assert main.family is GeometryFamily.SPLINE_EXTRUSION, main.choice
    sweep = main.geometry
    assert isinstance(sweep, SplineExtrusion)
    # Its axis is the measured arc: radius 4 m (seat centre plus the back's pull outward).
    r = np.linalg.norm(sweep.path.points[:, :2], axis=1)
    assert float(r.mean()) == pytest.approx(4.04, abs=0.05)
    assert float(r.std()) < 0.03
    # A straight bench asset would have no bend in it. This one sweeps its 70 degrees of arc.
    angles = np.degrees(np.arctan2(sweep.path.points[:, 1], sweep.path.points[:, 0]))
    assert float(angles[-1] - angles[0]) == pytest.approx(70, abs=4)
    assert sweep.path.length == pytest.approx(4.04 * math.radians(70), abs=0.2)


def test_the_bench_keeps_its_measured_dimensions(bench_fit) -> None:
    section = bench_fit[0].geometry.profiles[0].profile.array
    lateral, up = section[:, 0], section[:, 1]
    assert float(up.max()) == pytest.approx(0.90, abs=0.03)          # top of the back
    assert float(np.ptp(lateral)) == pytest.approx(0.54, abs=0.04)   # seat plus back, deep
    seat = up[(up > 0.3) & (up < 0.5)]
    assert float(seat.min()) == pytest.approx(0.42, abs=0.03)        # underside of the seat
    assert bench_fit[0].geometry.path.length == pytest.approx(4.9, abs=0.25)


def test_the_bench_legs_are_fitted_on_their_own_not_smeared_along_it(bench_fit) -> None:
    supports = [o for o in bench_fit[1:] if o.semantic_type == "bench_support"]
    assert len(supports) >= 3
    # The swept section does not reach the ground: the legs are not part of it.
    section = bench_fit[0].geometry.profiles[0].profile.array
    assert float(section[:, 1].min()) > 0.3


def test_the_bench_cites_its_evidence(bench_fit) -> None:
    for outcome in bench_fit:
        assert outcome.evidence.refs[0].locator == "fixture#1"
        assert outcome.evidence.observation_count > 0


def test_the_bench_can_also_be_kept_as_a_surface() -> None:
    """Forced to freeform, the same bench is still curved: nothing reaches for a template."""
    rng = np.random.default_rng(4)
    pts = curved_bench_points(rng)
    [outcome] = fit_object(cloud_of(pts), "bench", family=GeometryFamily.FREEFORM_MESH)
    mesh = outcome.geometry.mesh
    assert boundary_edges(mesh) == 0
    assert float(np.percentile(surface_distance(pts[::20], mesh), 95)) < 0.03
    r = np.linalg.norm(mesh.vertices[:, :2], axis=1)
    assert r.min() > 3.6 and r.max() < 4.45


# ---------------------------------------------------------- the families themselves ----


def test_primitives_fit_what_they_are_given() -> None:
    fit = fit_cylinder(pole_points(np.random.default_rng(5)))
    assert fit.primitive.dims[0] == pytest.approx(0.06, abs=0.003)
    assert fit.primitive.base[:2] == pytest.approx((2.0, 5.0), abs=0.005)
    assert fit.rms_m < 0.01


def test_a_hydrant_is_a_stack_of_round_parts() -> None:
    rng = np.random.default_rng(6)

    def ring(r, z0, z1, n):
        a = rng.uniform(0, 2 * math.pi, n)
        return np.column_stack([r * np.cos(a), r * np.sin(a), rng.uniform(z0, z1, n)])

    bonnet = []
    for z in np.linspace(0.6, 0.75, 60):
        r = 0.15 + (0.08 - 0.15) * (z - 0.6) / 0.15
        a = rng.uniform(0, 2 * math.pi, 15)
        bonnet.append(np.column_stack([r * np.cos(a), r * np.sin(a), np.full(15, z)]))
    pts = np.vstack([ring(0.15, 0, 0.6, 1200), *bonnet, ring(0.05, 0.75, 0.85, 300)])
    assembly, rms = fit_assembly(pts + rng.normal(0, 0.003, pts.shape), 0.02)
    assert len(assembly.parts) >= 2
    assert assembly.parts[0].kind == "cylinder"
    assert assembly.parts[0].dims[0] == pytest.approx(0.15, abs=0.01)
    assert rms < 0.02


def test_a_swept_kerb_faces_the_road_and_the_sky() -> None:
    path = PiecewisePath(np.array([[0, 0, 0], [5, 0, 0], [5, 5, 0]], float), breaks=(1,))
    mesh = SplineExtrusion(path, (ProfileKey(0.0, kerb_profile(0.15, side=1)),)).to_mesh()
    normals = mesh.face_normals()
    centres = mesh.vertices[mesh.faces].mean(axis=1)
    first_leg_face = (centres[:, 0] < 4.5) & (np.abs(normals[:, 2]) < 0.1)
    assert (normals[first_leg_face, 1] < -0.9).all()      # the face looks at the road (-y)
    assert (normals[np.abs(normals[:, 2]) > 0.5, 2] > 0.9).all()  # the top looks up
    _, hi = mesh.bounds()
    assert hi[2] == pytest.approx(0.15)


def test_a_sharp_corner_is_mitred_not_gapped() -> None:
    path = PiecewisePath(np.array([[0, 0, 0], [5, 0, 0], [5, 5, 0]], float), breaks=(1,))
    sweep = SplineExtrusion(path, (ProfileKey(0.0, rectangle_profile(0.4, 0.3)),), caps=True)
    rings, _, _ = sweep.rings()
    corner = rings[1]
    # The outer corner of a 0.4 m section on a 90 degree turn is 0.2 * sqrt(2) from the vertex.
    far = float(np.linalg.norm(corner[:, :2] - [5, 0], axis=1).max())
    assert far == pytest.approx(0.2 * math.sqrt(2), abs=1e-6)


def test_a_section_is_recovered_from_points_without_assuming_it_is_convex() -> None:
    rng = np.random.default_rng(7)
    seat = np.column_stack([rng.uniform(0, 0.5, 800), rng.uniform(0.42, 0.46, 800)])
    back = np.column_stack([rng.uniform(0.44, 0.48, 600), rng.uniform(0.46, 0.9, 600)])
    profile = profile_from_points(np.vstack([seat, back]), cell_m=0.015, tolerance_m=0.01)
    assert profile.closed and profile.signed_area() > 0
    area = abs(profile.signed_area())
    true_area = 0.5 * 0.04 + 0.04 * 0.44
    assert area == pytest.approx(true_area, rel=0.35)
    assert area < 0.5 * 0.48  # far less than its bounding box: an L, not a block


def test_freeform_surfaces_are_closed_and_on_the_points() -> None:
    pts = rock_points(np.random.default_rng(8))
    mesh = reconstruct_surface(pts, 0.04)
    assert boundary_edges(mesh) == 0
    assert float(np.percentile(surface_distance(pts[::5], mesh), 95)) < 0.03


def test_simplification_reports_the_error_it_measured() -> None:
    mesh = reconstruct_surface(rock_points(np.random.default_rng(9)), 0.04)
    simplified = simplify_to_tolerance(mesh, 0.05)
    assert simplified.mesh.triangle_count < mesh.triangle_count / 3
    assert simplified.error_m <= 0.05
    measured = float(surface_distance(mesh.vertices, simplified.mesh).max())
    assert measured == pytest.approx(simplified.error_m, abs=1e-9)


def test_geometry_survives_a_round_trip() -> None:
    path = PiecewisePath(np.array([[0, 0, 0], [3, 1, 0.1], [6, 0, 0.2]], float))
    sweep = SplineExtrusion(path, (ProfileKey(0.0, kerb_profile(0.12)),))
    back = geometry_from_json({"type": "spline_extrusion:SplineExtrusion", **sweep.to_json()})
    assert np.allclose(back.to_mesh().vertices, sweep.to_mesh().vertices, atol=1e-4)
    mesh = TriMesh(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], float), np.array([[0, 1, 2]]))
    free = geometry_from_json({"type": "freeform_mesh:FreeformMesh",
                               **FreeformMesh(mesh).to_json()})
    assert np.allclose(free.mesh.vertices, mesh.vertices)


def test_the_detail_policy_splits_geometry_from_appearance() -> None:
    assert DETAIL_POLICY.classify("bay_window", 0.65, 7.0) == "geometry"
    assert DETAIL_POLICY.classify("window", -0.12, 1.9) == "geometry"
    assert DETAIL_POLICY.classify("relief", 0.02, 30.0) == "appearance"   # brick coursing
    assert DETAIL_POLICY.classify("curb", 0.06, 0.2) == "geometry"        # shallow, but a kerb
    assert DETAIL_POLICY.classify("paint", 0.0, 3.0) == "appearance"
