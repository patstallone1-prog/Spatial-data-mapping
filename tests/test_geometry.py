"""Tests for mesh construction and the corridor build.

The central assertion is fidelity: a parameter that was sampled must be recoverable from the
vertices. Ground truth that disagrees with the render is not ground truth.
"""

from __future__ import annotations

import numpy as np
import pytest

from smc import geo, units
from smc.carla_gen import distributions as d
from smc.carla_gen.geometry import (
    GUTTER_WIDTH_M,
    Mesh,
    build_dome_field,
    build_segment_mesh,
    cross_section_at,
    measure_curb_height,
    station_grid,
)
from smc.carla_gen.world import (
    build_corridor,
    build_meshes,
    curb_height_bucket,
    export_ground_truth,
    verify_mesh_fidelity,
)
from smc.facts.schema import FactClass

SEED = 20260820
ORIGIN = geo.Origin(38.9072, -77.0369)


class TestMeshValidation:
    def test_rejects_bad_vertex_shape(self) -> None:
        with pytest.raises(ValueError, match="vertices must be"):
            Mesh(np.zeros((4, 2)), np.zeros((1, 3), dtype=np.int64))

    def test_rejects_dangling_face_index(self) -> None:
        with pytest.raises(ValueError, match="does not exist"):
            Mesh(np.zeros((3, 3)), np.array([[0, 1, 7]], dtype=np.int64))


class TestCrossSection:
    def test_carries_sampled_curb_height(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 50.0)
        section = cross_section_at(10.0, seg)
        assert section.curb_height_m == pytest.approx(block.curb_height_m)
        assert section.sidewalk_width_m == pytest.approx(seg.total_width_m)

    def test_ramp_cuts_the_curb_to_its_lip(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 50.0)
        ramp = d.sample_curb_ramp(SEED, block, "r1")
        section = cross_section_at(25.0, seg, [(25.0, ramp)])
        assert section.curb_height_m == pytest.approx(ramp.lip_height_m)

    def test_curb_is_intact_away_from_the_ramp(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 80.0)
        ramp = d.sample_curb_ramp(SEED, block, "r1")
        section = cross_section_at(5.0, seg, [(60.0, ramp)])
        assert section.curb_height_m == pytest.approx(block.curb_height_m)


class TestStationGrid:
    def test_includes_every_feature_station(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 100.0)
        grid = station_grid(seg)
        for lc in seg.level_changes:
            assert np.any(np.isclose(grid, round(lc.s_m, 6))), lc

    def test_is_sorted_and_bounded(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 100.0)
        grid = station_grid(seg)
        assert np.all(np.diff(grid) > 0)
        assert grid[0] >= 0.0 and grid[-1] <= seg.length_m

    def test_rejects_bad_step(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 10.0)
        with pytest.raises(ValueError):
            station_grid(seg, 0.0)


class TestMeshFidelity:
    def test_curb_height_recoverable_from_vertices(self) -> None:
        corridor = build_corridor("t", ORIGIN, SEED, n_blocks=6)
        report = verify_mesh_fidelity(corridor)
        assert report.checked > 0
        assert report.ok, report.failures
        assert report.max_error_m < 1e-6

    def test_holds_across_many_seeds(self) -> None:
        for seed in range(8):
            report = verify_mesh_fidelity(build_corridor("t", ORIGIN, seed, n_blocks=3))
            assert report.ok, (seed, report.failures)

    def test_mesh_is_watertight_in_index_space(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 30.0)
        mesh = build_segment_mesh(seg)
        assert mesh.faces.max() < len(mesh.vertices)
        assert len(mesh.faces) > 0

    def test_measure_rejects_empty_station(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 10.0)
        with pytest.raises(ValueError, match="no vertices"):
            measure_curb_height(build_segment_mesh(seg), 900.0, tol_m=0.01)


class TestDomes:
    def test_absent_when_the_ramp_has_none(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        ramp = d.sample_curb_ramp(SEED, block, "r1")
        mesh = build_dome_field(ramp)
        if not ramp.detectable_warning:
            assert len(mesh.vertices) == 0

    def test_dome_height_matches_the_standard(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        ramp = next(
            r
            for i in range(200)
            if (r := d.sample_curb_ramp(SEED, block, f"r{i}")).detectable_warning
        )
        mesh = build_dome_field(ramp)
        lo, hi = mesh.bounds
        assert (hi[2] - lo[2]) == pytest.approx(units.DOME_HEIGHT_M, abs=1e-9)


class TestCurbBuckets:
    @pytest.mark.parametrize(
        ("height_in", "expected"),
        [(0.0, "flush"), (0.5, "flush"), (2.0, "low"), (6.0, "standard"), (8.0, "high")],
    )
    def test_bucket_edges(self, height_in: float, expected: str) -> None:
        assert str(curb_height_bucket(units.inches(height_in))) == expected


class TestGroundTruth:
    def test_emits_facts_for_every_segment(self) -> None:
        corridor = build_corridor("t", ORIGIN, SEED, n_blocks=5)
        facts = export_ground_truth(corridor)
        widths = [f for f in facts if f.fact_class is FactClass.SIDEWALK_WIDTH]
        assert len(widths) == len(corridor.segments)

    def test_records_absent_ramps(self) -> None:
        """A corner with no ramp must be an assertable fact, not a gap in the data."""
        seen_absent = False
        for seed in range(20):
            corridor = build_corridor("t", ORIGIN, seed, n_blocks=8)
            for f in export_ground_truth(corridor):
                if f.fact_class is FactClass.RAMP_PRESENT and f.value is False:
                    seen_absent = True
        assert seen_absent

    def test_positions_are_inside_the_corridor(self) -> None:
        corridor = build_corridor("t", ORIGIN, SEED, n_blocks=4)
        for f in export_ground_truth(corridor):
            east, north = geo.geodetic_to_enu(ORIGIN, f.lat, f.lon)
            assert -1.0 <= east <= corridor.length_m + 1.0
            assert 0.0 <= north <= 40.0

    def test_all_truth_is_labelled_simulation(self) -> None:
        facts = export_ground_truth(build_corridor("t", ORIGIN, SEED, n_blocks=3))
        assert {f.source for f in facts} == {"simulation"}

    def test_level_change_truth_is_only_the_hazardous_ones(self) -> None:
        facts = export_ground_truth(build_corridor("t", ORIGIN, SEED, n_blocks=6))
        for f in facts:
            if f.fact_class is FactClass.LEVEL_CHANGE_HEIGHT:
                assert isinstance(f.value, float)
                assert f.value > units.LEVEL_CHANGE_PASSABLE_M


class TestCorridor:
    def test_rejects_empty_corridor(self) -> None:
        with pytest.raises(ValueError):
            build_corridor("t", ORIGIN, SEED, n_blocks=0)

    def test_meshes_span_the_corridor(self) -> None:
        corridor = build_corridor("t", ORIGIN, SEED, n_blocks=4)
        meshes = build_meshes(corridor)
        assert meshes
        furthest = max(float(m.bounds[1][0]) for m in meshes)
        assert furthest == pytest.approx(corridor.length_m, abs=1.0)

    def test_gutter_offset_is_consistent(self) -> None:
        block = d.sample_block_face(SEED, "b1")
        seg = d.sample_sidewalk_segment(SEED, block, "s1", 20.0)
        section = cross_section_at(5.0, seg)
        assert section.points[1][0] == pytest.approx(GUTTER_WIDTH_M)
