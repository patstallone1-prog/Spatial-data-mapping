"""Build CV/depth storage rows from observations, OSM features, and future point clouds."""

from __future__ import annotations

from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
from typing import Any

import h3
import pyarrow.parquet as pq

from smc import units
from smc.depth.storage import (
    DEPTH_SCHEMA_VERSION,
    PROVENANCE_INFERRED,
    PROVENANCE_MEASURED,
    PROVENANCE_NEEDS_DEPTH,
    STATUS_NEEDS_DEPTH,
    utcnow,
)
from smc.measure.extract import CrossSection

DEFAULT_CURB_HEIGHT_M = units.inches(6.0)
DEFAULT_SIDEWALK_WIDTH_M = units.feet(5.0)


def stable_uid(*parts: object) -> str:
    payload = "\x1f".join(json.dumps(part, sort_keys=True, default=str) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def read_observation_rows(catalog_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted((catalog_dir / "observations").glob("*.parquet")):
        rows.extend(pq.read_table(path).to_pylist())
    return rows


def read_coverage_rows(catalog_dir: Path) -> list[dict[str, Any]]:
    path = catalog_dir / "coverage" / "h3.parquet"
    return pq.read_table(path).to_pylist() if path.exists() else []


def _centroid(feature: dict[str, Any]) -> tuple[float, float] | None:
    centroid = feature.get("centroid")
    if centroid and len(centroid) >= 2:
        return float(centroid[0]), float(centroid[1])
    points = feature.get("points") or []
    if not points:
        return None
    lon = sum(float(p[0]) for p in points) / len(points)
    lat = sum(float(p[1]) for p in points) / len(points)
    return lon, lat


def _feature_is_covered(feature: dict[str, Any], cells: set[str], resolution: int) -> bool:
    if not cells:
        return False
    sample_points = list(feature.get("points") or [])
    centroid = feature.get("centroid")
    if centroid:
        sample_points.append(centroid)
    step = max(1, len(sample_points) // 8)
    for lon, lat in sample_points[::step]:
        if h3.latlng_to_cell(float(lat), float(lon), resolution) in cells:
            return True
    return False


def _surface_geometry(feature: dict[str, Any]) -> str:
    return json.dumps(
        {
            "type": "LineString" if feature.get("kind") != "building" else "Polygon",
            "coordinates": feature.get("points") or [],
        },
        separators=(",", ":"),
    )


def _building_confidence(height_source: str, covered: bool) -> float:
    base = {"osm_height": 0.78, "osm_levels": 0.62, "inferred_default": 0.32}.get(height_source, 0.25)
    return min(0.9, base + (0.04 if covered else 0.0))


def build_depth_observation_rows(
    observations: list[dict[str, Any]], *, run_id: str, generated_at: datetime | None = None
) -> list[dict[str, Any]]:
    """Index every eligible observation as depth-processing backlog."""

    generated_at = generated_at or utcnow()
    rows: list[dict[str, Any]] = []
    for obs in observations:
        if not obs.get("eligible"):
            continue
        rows.append(
            {
                "run_id": run_id,
                "observation_uid": obs.get("observation_uid"),
                "provider": obs.get("provider"),
                "provider_instance": obs.get("provider_instance"),
                "provider_image_id": obs.get("provider_image_id"),
                "provider_sequence_id": obs.get("provider_sequence_id"),
                "coverage_cell": obs.get("coverage_cell"),
                "lat": obs.get("latitude"),
                "lon": obs.get("longitude"),
                "captured_at": obs.get("captured_at"),
                "depth_status": STATUS_NEEDS_DEPTH,
                "depth_source": "unprocessed",
                "segmentation_source": "unprocessed",
                "metric_depth_uri": None,
                "segmentation_uri": None,
                "point_cloud_uri": None,
                "scale_relative_sigma": None,
                "confidence": 0.0,
                "error": None,
                "generated_at": generated_at,
            }
        )
    return rows


def build_surface_rows(
    ways: list[dict[str, Any]],
    coverage_rows: list[dict[str, Any]],
    *,
    run_id: str,
    h3_resolution: int = 10,
    generated_at: datetime | None = None,
) -> list[dict[str, Any]]:
    """Create simulation surface rows across the whole OSM corridor.

    Rows are simulation-ready because they carry geometry and conservative defaults,
    but only future metric-depth rows may promote curb/sidewalk facts to measured.
    """

    generated_at = generated_at or utcnow()
    coverage_by_cell = {row["coverage_cell"]: row for row in coverage_rows if row.get("coverage_cell")}
    covered_cells = {
        cell
        for cell, row in coverage_by_cell.items()
        if int(row.get("eligible_observations") or 0) > 0
    }

    rows: list[dict[str, Any]] = []
    for feature in ways:
        kind = str(feature.get("kind") or "unknown")
        points = feature.get("points") or []
        if len(points) < 2:
            continue
        centroid = _centroid(feature)
        if centroid is None:
            continue
        lon, lat = centroid
        cell = h3.latlng_to_cell(lat, lon, h3_resolution)
        coverage = coverage_by_cell.get(cell, {})
        covered = _feature_is_covered(feature, covered_cells, h3_resolution)
        feature_id = stable_uid("osm", kind, feature.get("name"), points)
        common = {
            "feature_id": feature_id,
            "source_kind": f"osm_{kind}",
            "h3_cell": cell,
            "covered_by_observations": covered,
            "observation_count": int(coverage.get("eligible_observations") or 0),
            "provider_count": int(coverage.get("unique_providers") or 0),
            "coverage_score": coverage.get("coverage_score"),
            "lat": lat,
            "lon": lon,
            "geometry_json": _surface_geometry(feature),
            "depth_run_id": run_id,
            "generated_at": generated_at,
        }

        if kind == "building":
            height_source = str(feature.get("height_source") or "inferred_default")
            height = float(feature.get("height_m") or 10.5)
            measured_by_osm = height_source in {"osm_height", "osm_levels"}
            rows.append(
                {
                    **common,
                    "surface_uid": stable_uid(feature_id, "facade_surface"),
                    "surface_type": "facade_surface",
                    "provenance": PROVENANCE_INFERRED,
                    "height_m": height,
                    "height_sigma_m": 0.5 if measured_by_osm else 4.0,
                    "curb_height_m": None,
                    "curb_height_sigma_m": None,
                    "sidewalk_width_m": None,
                    "sidewalk_width_sigma_m": None,
                    "cross_slope": None,
                    "cross_slope_sigma": None,
                    "facade_height_m": height,
                    "facade_height_sigma_m": 0.5 if measured_by_osm else 4.0,
                    "height_source": height_source,
                    "confidence": _building_confidence(height_source, covered),
                    "simulation_ready": True,
                    "requires_cv_depth": not measured_by_osm,
                    "flags_json": json.dumps(["osm_height_seed", "not_photogrammetric"]),
                }
            )
            continue

        if kind in {"sidewalk", "crossing"}:
            rows.append(
                {
                    **common,
                    "surface_uid": stable_uid(feature_id, "sidewalk_surface"),
                    "surface_type": "sidewalk_surface" if kind == "sidewalk" else "crossing_surface",
                    "provenance": PROVENANCE_NEEDS_DEPTH,
                    "height_m": None,
                    "height_sigma_m": None,
                    "curb_height_m": None,
                    "curb_height_sigma_m": None,
                    "sidewalk_width_m": DEFAULT_SIDEWALK_WIDTH_M,
                    "sidewalk_width_sigma_m": 1.1,
                    "cross_slope": None,
                    "cross_slope_sigma": None,
                    "facade_height_m": None,
                    "facade_height_sigma_m": None,
                    "height_source": "needs_metric_depth",
                    "confidence": 0.28 + (0.08 if covered else 0.0),
                    "simulation_ready": True,
                    "requires_cv_depth": True,
                    "flags_json": json.dumps(
                        ["osm_linestring_seed", "width_default", "requires_metric_depth_for_measurement"]
                    ),
                }
            )
            continue

        if kind == "street":
            rows.append(
                {
                    **common,
                    "surface_uid": stable_uid(feature_id, "curb_edge"),
                    "surface_type": "curb_edge",
                    "provenance": PROVENANCE_INFERRED,
                    "height_m": None,
                    "height_sigma_m": None,
                    "curb_height_m": DEFAULT_CURB_HEIGHT_M,
                    "curb_height_sigma_m": 0.076,
                    "sidewalk_width_m": None,
                    "sidewalk_width_sigma_m": None,
                    "cross_slope": None,
                    "cross_slope_sigma": None,
                    "facade_height_m": None,
                    "facade_height_sigma_m": None,
                    "height_source": "inferred_default_until_depth",
                    "confidence": 0.22 + (0.08 if covered else 0.0),
                    "simulation_ready": True,
                    "requires_cv_depth": True,
                    "flags_json": json.dumps(["default_curb_height", "requires_metric_depth_for_measurement"]),
                }
            )

    return rows


def measured_surface_rows_from_cross_section(
    section: CrossSection,
    *,
    feature_id: str,
    lat: float,
    lon: float,
    h3_cell: str,
    run_id: str,
    observation_count: int,
    provider_count: int,
    coverage_score: float | None = None,
    generated_at: datetime | None = None,
    height_source: str = "metric_depth_planes",
) -> list[dict[str, Any]]:
    """Promote one metric-depth cross section into measured simulation surfaces.

    ``height_source`` names the sensor the planes were fitted to, because the error budget is
    not the same for all of them: a photogrammetric reconstruction carries a scale uncertainty
    that a ranging sensor does not, and a consumer weighing two measurements of the same kerb
    has to be able to tell which is which.
    """

    if not section.ok or section.kerb is None or section.sidewalk is None:
        return []

    generated_at = generated_at or utcnow()
    base = {
        "feature_id": feature_id,
        "source_kind": "metric_depth_cross_section",
        "h3_cell": h3_cell,
        "covered_by_observations": True,
        "observation_count": observation_count,
        "provider_count": provider_count,
        "coverage_score": coverage_score,
        "lat": lat,
        "lon": lon,
        "geometry_json": json.dumps(
            {"type": "Point", "coordinates": [lon, lat], "station_m": section.station_m},
            separators=(",", ":"),
        ),
        "depth_run_id": run_id,
        "generated_at": generated_at,
        "provenance": PROVENANCE_MEASURED,
        "confidence": min(0.92, 0.48 + 0.08 * min(provider_count, 3) + 0.03 * min(observation_count, 6)),
        "simulation_ready": True,
        "requires_cv_depth": False,
        "flags_json": json.dumps(list(section.flags)),
    }

    return [
        {
            **base,
            "surface_uid": stable_uid(feature_id, run_id, "measured_curb_edge", section.station_m),
            "surface_type": "curb_edge",
            "height_m": None,
            "height_sigma_m": None,
            "curb_height_m": section.kerb.height_m,
            "curb_height_sigma_m": section.kerb.sigma_m,
            "sidewalk_width_m": None,
            "sidewalk_width_sigma_m": None,
            "cross_slope": None,
            "cross_slope_sigma": None,
            "facade_height_m": None,
            "facade_height_sigma_m": None,
            "height_source": height_source,
        },
        {
            **base,
            "surface_uid": stable_uid(feature_id, run_id, "measured_sidewalk_surface", section.station_m),
            "surface_type": "sidewalk_surface",
            "height_m": None,
            "height_sigma_m": None,
            "curb_height_m": None,
            "curb_height_sigma_m": None,
            "sidewalk_width_m": section.sidewalk.width_m,
            "sidewalk_width_sigma_m": section.sidewalk.width_sigma_m,
            "cross_slope": section.sidewalk.cross_slope,
            "cross_slope_sigma": section.sidewalk.cross_slope_sigma,
            "facade_height_m": None,
            "facade_height_sigma_m": None,
            "height_source": height_source,
        },
    ]


def summarize_depth_store(
    observations: list[dict[str, Any]],
    depth_rows: list[dict[str, Any]],
    surface_rows: list[dict[str, Any]],
    *,
    run_id: str,
) -> dict[str, Any]:
    provenance = Counter(row["provenance"] for row in surface_rows)
    surface_types = Counter(row["surface_type"] for row in surface_rows)
    depth_status = Counter(row["depth_status"] for row in depth_rows)
    measured_surfaces = sum(row["provenance"] == PROVENANCE_MEASURED for row in surface_rows)
    measured_curb_heights = sum(
        row["provenance"] == PROVENANCE_MEASURED
        and row["surface_type"] == "curb_edge"
        and row.get("curb_height_m") is not None
        for row in surface_rows
    )
    return {
        "schema_version": DEPTH_SCHEMA_VERSION,
        "run_id": run_id,
        "generated_at": utcnow().isoformat(),
        "observations_total": len(observations),
        "depth_observation_rows": len(depth_rows),
        "depth_status": dict(depth_status),
        "surface_rows": len(surface_rows),
        "surface_types": dict(surface_types),
        "surface_provenance": dict(provenance),
        "measured_surface_count": measured_surfaces,
        "measured_curb_height_count": measured_curb_heights,
        "inferred_or_seed_surface_count": len(surface_rows) - measured_surfaces,
        "simulation_ready_surface_count": sum(bool(row["simulation_ready"]) for row in surface_rows),
        "requires_cv_depth_count": sum(bool(row["requires_cv_depth"]) for row in surface_rows),
        "exact_curb_heights_available": measured_curb_heights > 0,
        "note": (
            "Storage is ready for metric CV/depth outputs. Current curb/sidewalk rows are "
            "simulation seeds or depth backlog, not exact measured curb heights."
        ),
    }
