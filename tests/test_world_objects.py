"""The canonical world object: its invariants, its decisions, and what it compiles to.

A reconstructed object has to be traceable to its evidence, has to say how far to trust it,
and must never displace geometry more trusted than itself. Legacy catalogue geometry can
exist in the same world but can never pass for a measurement.
"""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime

import numpy as np
import pytest

from smc.geometry.base import GeometryFamily, Param
from smc.geometry.extrusion import ProfileKey, SplineExtrusion, kerb_profile
from smc.geometry.primitives import Primitive, PrimitiveAssembly
from smc.geometry.spline import CurveSamples, PiecewisePath
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.geometry_fit import (
    HIGH,
    MEDIUM,
    FitOutcome,
    confidence_for,
    decide,
    fit_curb_line,
)
from smc.reconstruction.glb import inspect_glb
from smc.world.compile import compile_web, web_record, write_glb
from smc.world.lod import build_lods, is_monotonic
from smc.world.object import (
    LEGACY_MAX_CONFIDENCE,
    Detail,
    Evidence,
    EvidenceRef,
    FitRecord,
    GeometryBasis,
    WorldObject,
)

FRAME = EnuFrame(-122.4376, 37.7917, 0.0)
SURVEY = EvidenceRef("survey_line", "sfmta_curbs", "curb_lines/12", "unstated: SFMTA", count=9)
LIDAR = EvidenceRef("lidar_points", "usgs_3dep", "kerb_m:osm:1", "public-domain (USGS 3DEP)")
OSM = EvidenceRef("osm", "openstreetmap", "way/123", "ODbL-1.0")


def rounded_curb_samples(radius: float = 4.0) -> CurveSamples:
    t = np.linspace(-np.pi / 2, 0, 9)
    arc = np.column_stack([radius * np.cos(t) - radius, radius * np.sin(t) + radius])
    pts = np.vstack([[[-12.0, 0.0]], arc, [[0.0, 12.0]]])
    return CurveSamples(np.column_stack([pts, np.zeros(len(pts))]), ordered=True, exact=True)


LIDAR_HEIGHT = Param(0.15, "lidar")


def fitted_curb(refs=(SURVEY, LIDAR), height=LIDAR_HEIGHT) -> FitOutcome:
    [outcome] = fit_curb_line(rounded_curb_samples(), refs, FRAME, height=height, side=1)
    return outcome


def fit_record() -> FitRecord:
    return FitRecord("test", "smc test", datetime.now(UTC))


def box_object(object_id: str, basis: GeometryBasis, confidence: float, refs, flags=()):
    geometry = PrimitiveAssembly((Primitive("box", (0, 0, 0), (1.8, 0.5, 0.9)),))
    grade = "mapped" if basis is GeometryBasis.LEGACY_ARCHETYPE else "image"
    return WorldObject(object_id, "bench", geometry, basis, confidence,
                       Evidence(tuple(refs), grade, 1), (-122.4, 37.79, 0.0),
                       fit=fit_record(), flags=tuple(flags))


# ---------------------------------------------------------------------- invariants ----


def test_geometry_without_evidence_is_refused() -> None:
    with pytest.raises(ValueError, match="anonymous geometry"):
        box_object("b1", GeometryBasis.MEASURED, 0.5, ())


def test_measured_geometry_needs_an_observation() -> None:
    with pytest.raises(ValueError, match="needs an observation"):
        WorldObject("b1", "bench", PrimitiveAssembly((Primitive("box", (0, 0, 0), (1, 1, 1)),)),
                    GeometryBasis.MEASURED, 0.3, Evidence((OSM,), "mapped", 1),
                    (-122.4, 37.79, 0.0), fit=fit_record())


def test_a_legacy_prefab_can_never_pass_for_a_measurement() -> None:
    legacy = box_object("b1", GeometryBasis.LEGACY_ARCHETYPE, 0.25, (OSM,), ("legacy_archetype",))
    assert legacy.confidence <= LEGACY_MAX_CONFIDENCE
    with pytest.raises(ValueError, match="cannot claim confidence"):
        box_object("b2", GeometryBasis.LEGACY_ARCHETYPE, 0.6, (OSM,), ("legacy_archetype",))
    with pytest.raises(ValueError, match="flagged"):
        box_object("b3", GeometryBasis.LEGACY_ARCHETYPE, 0.2, (OSM,))
    with pytest.raises(ValueError, match="cite observations"):
        box_object("b4", GeometryBasis.LEGACY_ARCHETYPE, 0.2, (OSM, LIDAR), ("legacy_archetype",))


def test_confidence_never_exceeds_its_best_source() -> None:
    with pytest.raises(ValueError, match="exceeds"):
        WorldObject("b1", "bench", PrimitiveAssembly((Primitive("box", (0, 0, 0), (1, 1, 1)),)),
                    GeometryBasis.PRIOR, 0.9, Evidence((OSM,), "mapped", 1), (-122.4, 37.79, 0))


def test_an_unresolved_object_draws_nothing_but_keeps_its_evidence() -> None:
    obj = WorldObject("u1", "bench", None, GeometryBasis.UNRESOLVED, 0.1,
                      Evidence((LIDAR,), "lidar", 3), (-122.4, 37.79, 0.0), detail=Detail.NONE)
    assert web_record(obj) is None
    assert obj.to_json()["evidence"]["refs"][0]["locator"] == "kerb_m:osm:1"


def test_there_is_no_prefab_field_on_a_world_object() -> None:
    names = {f.name for f in dataclasses.fields(WorldObject)}
    assert not names & {"archetype", "prefab", "model", "template", "asset_id"}


# ---------------------------------------------------------------------- decisions ----


def test_a_well_evidenced_curb_is_accepted_in_full() -> None:
    decision = decide(fitted_curb(), object_id="curb:1")
    assert decision.outcome == "accepted_full"
    obj = decision.object
    assert obj.basis is GeometryBasis.MEASURED and obj.detail is Detail.FULL
    assert obj.confidence >= HIGH
    assert obj.fit is not None and "interpolating" in obj.fit.method
    assert obj.fit.fitted_at.tzinfo is not None and obj.fit.software.startswith("smc ")


def test_an_inferred_height_costs_confidence_but_does_not_cap_it() -> None:
    measured = confidence_for(fitted_curb().evidence, GeometryFamily.SPLINE_EXTRUSION)
    inferred = fitted_curb(refs=(SURVEY,), height=Param(0.126, "inferred"))
    assert inferred.secondary_factor < 1
    value = confidence_for(inferred.evidence, GeometryFamily.SPLINE_EXTRUSION,
                           secondary_factor=inferred.secondary_factor)
    assert MEDIUM < value < measured


def test_weak_evidence_gets_simplified_geometry_not_confident_geometry() -> None:
    outcome = fitted_curb()
    weak = dataclasses.replace(outcome, evidence=dataclasses.replace(
        outcome.evidence, refs=(EvidenceRef("image", "mapillary", "frame:1", "CC-BY-SA-4.0"),),
        grade="image", exact=False, observation_count=40, fit_rms_m=0.04))
    decision = decide(weak, object_id="curb:2")
    assert decision.outcome == "accepted_conservative"
    assert decision.object.detail is Detail.CONSERVATIVE
    assert len(decision.object.geometry.path.points) <= len(outcome.geometry.path.points)


def test_no_evidence_worth_the_name_is_refused_and_nothing_is_invented() -> None:
    outcome = fitted_curb()
    poor = dataclasses.replace(outcome, evidence=dataclasses.replace(
        outcome.evidence, refs=(EvidenceRef("image", "mapillary", "frame:1", "CC-BY-SA-4.0"),),
        grade="image", exact=False, observation_count=2, fit_rms_m=0.2, coverage=0.2))
    decision = decide(poor, object_id="curb:3")
    assert decision.outcome == "refused"
    assert decision.object.geometry is None and decision.object.basis is GeometryBasis.UNRESOLVED
    assert decision.object.evidence.refs  # the evidence is kept even though nothing is drawn


def test_a_low_confidence_fit_never_replaces_better_existing_geometry() -> None:
    surveyed = decide(fitted_curb(), object_id="curb:surveyed").object
    outcome = fitted_curb()
    moved = dataclasses.replace(outcome, geometry=dataclasses.replace(
        outcome.geometry, path=PiecewisePath(outcome.geometry.path.points
                                             + np.array([0.8, 0.0, 0.0]))),
        evidence=dataclasses.replace(
            outcome.evidence, refs=(EvidenceRef("photogrammetry", "pilot", "cell:c14r03",
                                                "CC-BY-SA-4.0"),),
            grade="image", exact=False, observation_count=60, fit_rms_m=0.03))
    decision = decide(moved, object_id="curb:photo", existing=surveyed, tolerance_m=0.1)
    assert decision.outcome == "kept_existing"
    assert decision.object.id == "curb:surveyed"
    assert any(f.startswith("conflict:curb:photo") for f in decision.object.flags)


def test_a_better_fit_replaces_a_legacy_prefab_and_says_so() -> None:
    legacy = box_object("bench:legacy", GeometryBasis.LEGACY_ARCHETYPE, 0.2, (OSM,),
                        ("legacy_archetype",))
    decision = decide(fitted_curb(), object_id="curb:new", existing=legacy)
    assert decision.outcome == "accepted_full"
    assert decision.object.supersedes == ("bench:legacy",)


def test_a_fit_with_problems_is_marked_and_discounted() -> None:
    outcome = dataclasses.replace(fitted_curb(), problems=("loop: the path crosses itself",))
    decision = decide(outcome, object_id="curb:4")
    assert any("fit_problem:loop" in f for f in decision.object.flags)
    assert decision.object.confidence <= 0.5


# ----------------------------------------------------------------- provenance & I/O ----


def test_the_canonical_record_round_trips_with_its_provenance() -> None:
    obj = decide(fitted_curb(), object_id="curb:5").object
    back = WorldObject.from_json(obj.to_json())
    assert back.id == obj.id and back.basis is obj.basis
    assert [r.locator for r in back.evidence.refs] == ["curb_lines/12", "kerb_m:osm:1"]
    assert back.evidence.refs[0].license_id == "unstated: SFMTA"
    assert back.geometry.params["height"].grade == "lidar"
    assert np.allclose(back.geometry.path.points, obj.geometry.path.points, atol=1e-3)
    assert back.fit.parameters["path"]["corners"]


def test_levels_of_detail_get_coarser_with_a_measured_error() -> None:
    obj = decide(fitted_curb(), object_id="curb:6").object
    levels = build_lods(obj.geometry)
    assert [lvl.level for lvl in levels] == [2, 1, 0]
    assert is_monotonic(levels)
    assert levels[0].geometric_error_m == 0.0
    assert 0 < levels[2].geometric_error_m < 1.0


def test_the_page_is_told_the_shape_not_a_model_name() -> None:
    obj = decide(fitted_curb(), object_id="curb:7").object
    web = compile_web([obj], region="test", sources={})
    [record] = web["objects"]
    assert "sweep" in record and "mesh" not in record
    assert not {"archetype", "prefab", "model", "asset"} & set(record)
    level = record["sweep"]["lods"][0]
    path = np.asarray(level["path"]).reshape(-1, 2) / 1000.0
    # The rounded return arrives rounded: the path passes nowhere near the square corner.
    assert float(np.linalg.norm(path - [0.0, 0.0], axis=1).min()) > 4.0 * (np.sqrt(2) - 1) - 0.1
    assert record["claim"] == {"kind": "curb", "along": "sweep", "reach_m": 1.5}
    assert web["legend"][record["prov"]["method"]].startswith("interpolating")


def test_a_rigid_object_compiles_to_levels_of_triangles_and_a_glb(tmp_path) -> None:
    ref = EvidenceRef("fixture", "test_fixture", "bench#1", "CC0-1.0", count=500)
    sweep = SplineExtrusion(
        PiecewisePath(np.array([[4 * np.cos(a), 4 * np.sin(a), 0.0]
                                for a in np.linspace(0, 1.2, 20)])),
        (ProfileKey(0.0, kerb_profile(0.45)),))
    obj = WorldObject("bench:1", "bench", sweep, GeometryBasis.MEASURED, 0.7,
                      Evidence((ref,), "image", 500), (-122.4, 37.79, 0.0), "wood",
                      fit=fit_record())
    record = web_record(obj)
    assert "mesh" in record and "sweep" not in record          # compact: sent as triangles
    assert [lvl["level"] for lvl in record["mesh"]["lods"]] == [2, 1, 0]
    assert "point" in record["claim"]                          # and claims a disc, not a line
    path = write_glb(obj, tmp_path / "bench.glb")
    gltf = inspect_glb(path)
    indices = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["indices"]]
    assert indices["count"] // 3 == build_lods(sweep)[0].triangle_count


def test_public_copy_ships_no_level_finer_than_a_visitor_can_see():
    from smc.geometry.base import TriMesh
    from smc.world.compile import public_error_budget_m, public_levels
    from smc.world.lod import LodLevel

    tri = TriMesh(np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], float), np.array([[0, 1, 2]]))
    budget = public_error_budget_m()
    assert 0.002 < budget < 0.006  # a few millimetres at arm's length
    levels = tuple(LodLevel(k, err, {"stone": tri}) for k, err in
                   ((3, 0.0), (2, budget * 0.5), (1, budget * 0.9), (0, 0.2)))
    kept = public_levels(levels)
    assert [lvl.level for lvl in kept] == [1, 0]  # full and near-full stay internal
    coarse = tuple(LodLevel(k, err, {"stone": tri}) for k, err in ((1, 0.05), (0, 0.2)))
    assert public_levels(coarse) == coarse  # none passes: everything ships
