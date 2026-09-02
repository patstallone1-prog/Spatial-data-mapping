from __future__ import annotations

from pathlib import Path

from smc.depth.storage import (
    PROVENANCE_INFERRED,
    PROVENANCE_NEEDS_DEPTH,
    STATUS_NEEDS_DEPTH,
    read_depth_observations,
    read_surfaces,
    write_depth_observations,
    write_surfaces,
)
from smc.depth.surfaces import (
    build_depth_observation_rows,
    build_surface_rows,
    measured_surface_rows_from_cross_section,
    summarize_depth_store,
)
from smc.carla_gen.profile import CurbHeightClass
from smc.measure.extract import CrossSection, KerbMeasurement, SidewalkMeasurement


def test_depth_observation_index_keeps_artifact_slots_empty_until_processed(tmp_path: Path) -> None:
    observations = [
        {
            "observation_uid": "obs-a",
            "provider": "kerbside",
            "provider_instance": "local",
            "provider_image_id": "img-a",
            "provider_sequence_id": "seq-a",
            "coverage_cell": "8a28308280a7fff",
            "latitude": 37.8,
            "longitude": -122.42,
            "captured_at": None,
            "eligible": True,
        },
        {"observation_uid": "obs-b", "eligible": False},
    ]

    rows = build_depth_observation_rows(observations, run_id="run-a")
    path = write_depth_observations(tmp_path / "depth.parquet", rows)
    loaded = read_depth_observations(path)

    assert len(loaded) == 1
    assert loaded[0]["depth_status"] == STATUS_NEEDS_DEPTH
    assert loaded[0]["metric_depth_uri"] is None
    assert loaded[0]["point_cloud_uri"] is None


def test_surface_rows_separate_simulation_seed_from_measurement(tmp_path: Path) -> None:
    coverage = [
        {
            "coverage_cell": "8a28308280a7fff",
            "eligible_observations": 6,
            "unique_providers": 2,
            "coverage_score": 0.7,
        }
    ]
    ways = [
        {
            "kind": "building",
            "name": "Known height",
            "height_m": 12.0,
            "height_source": "osm_height",
            "centroid": [-122.42, 37.8],
            "points": [
                [-122.4201, 37.8001],
                [-122.4199, 37.8001],
                [-122.4199, 37.7999],
                [-122.4201, 37.7999],
                [-122.4201, 37.8001],
            ],
        },
        {"kind": "street", "name": "Seed", "points": [[-122.42, 37.8], [-122.421, 37.8]]},
        {"kind": "sidewalk", "name": None, "points": [[-122.42, 37.8], [-122.4201, 37.8004]]},
    ]

    rows = build_surface_rows(ways, coverage, run_id="run-a")
    path = write_surfaces(tmp_path / "surfaces.parquet", rows)
    loaded = read_surfaces(path)
    summary = summarize_depth_store([], [], rows, run_id="run-a")

    assert len(loaded) == 3
    assert {row["provenance"] for row in loaded} == {PROVENANCE_INFERRED, PROVENANCE_NEEDS_DEPTH}
    assert all(not row["provenance"] == "measured" for row in loaded)
    assert summary["exact_curb_heights_available"] is False
    assert summary["simulation_ready_surface_count"] == 3


def test_metric_cross_section_promotes_to_measured_surface_rows() -> None:
    section = CrossSection(
        station_m=12.0,
        kerb=KerbMeasurement(
            height_m=0.151,
            sigma_m=0.012,
            bucket=CurbHeightClass.STANDARD,
            kerb_offset_m=1.8,
        ),
        sidewalk=SidewalkMeasurement(
            width_m=1.9,
            width_sigma_m=0.08,
            cross_slope=0.018,
            cross_slope_sigma=0.006,
            surface_rms_m=0.01,
            point_count=120,
        ),
        planes=None,
        flags=("cross_slope_indecisive",),
    )

    rows = measured_surface_rows_from_cross_section(
        section,
        feature_id="curb-a",
        lat=37.8,
        lon=-122.42,
        h3_cell="8a28308280a7fff",
        run_id="run-a",
        observation_count=4,
        provider_count=2,
    )

    assert len(rows) == 2
    assert {row["surface_type"] for row in rows} == {"curb_edge", "sidewalk_surface"}
    assert all(row["provenance"] == "measured" for row in rows)
    assert all(row["requires_cv_depth"] is False for row in rows)
    assert rows[0]["curb_height_m"] == 0.151
