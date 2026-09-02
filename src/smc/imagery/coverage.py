"""H3 coverage summaries for the SF corridor imagery catalog."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from statistics import median
from typing import Any

import h3

from smc.imagery.schema import PROJECTION_PERSPECTIVE, PROJECTION_SPHERICAL, Observation


def assign_cells(observations: list[Observation], resolution: int = 10) -> None:
    """Attach H3 cell ids in place."""

    for obs in observations:
        obs.coverage_cell = h3.latlng_to_cell(obs.latitude, obs.longitude, resolution)


def _heading_diversity(headings: list[float]) -> float:
    if not headings:
        return 0.0
    bins = {int(h % 360 // 45) for h in headings}
    return len(bins) / 8.0


def _temporal_diversity(times: list[datetime]) -> float:
    years = {t.year for t in times}
    return min(1.0, len(years) / 4.0)


def build_coverage_rows(observations: list[Observation]) -> list[dict[str, Any]]:
    """Summarize each H3 cell and compute a 0..1 priority score."""

    cells: dict[str, list[Observation]] = defaultdict(list)
    for obs in observations:
        if obs.coverage_cell:
            cells[obs.coverage_cell].append(obs)

    rows: list[dict[str, Any]] = []
    for cell, group in sorted(cells.items()):
        eligible = [o for o in group if o.eligible]
        sequences = {o.sequence_uid for o in group}
        providers = {o.provider for o in group}
        mp = [o.original_megapixels for o in eligible if o.original_megapixels is not None]
        headings = [o.heading_deg for o in eligible if o.heading_deg is not None]
        times = [o.captured_at for o in eligible if o.captured_at is not None]
        perspective = sum(o.projection_type == PROJECTION_PERSPECTIVE for o in group)
        spherical = sum(o.projection_type == PROJECTION_SPHERICAL for o in group)
        lat, lon = h3.cell_to_latlng(cell)
        density_score = min(1.0, len(eligible) / 18.0)
        sequence_score = min(1.0, len({o.sequence_uid for o in eligible}) / 5.0)
        provider_score = min(1.0, len({o.provider for o in eligible}) / 2.0)
        perspective_score = perspective / len(group) if group else 0.0
        resolution_score = min(1.0, (median(mp) if mp else 0.0) / 12.0)
        heading_score = _heading_diversity(headings)
        temporal_score = _temporal_diversity(times)
        score = (
            0.28 * density_score
            + 0.18 * sequence_score
            + 0.16 * perspective_score
            + 0.14 * resolution_score
            + 0.12 * heading_score
            + 0.07 * provider_score
            + 0.05 * temporal_score
        )
        rows.append(
            {
                "coverage_cell": cell,
                "latitude": lat,
                "longitude": lon,
                "total_observations": len(group),
                "eligible_observations": len(eligible),
                "unique_sequences": len(sequences),
                "unique_providers": len(providers),
                "newest_capture": max(times) if times else None,
                "oldest_capture": min(times) if times else None,
                "median_source_megapixels": float(median(mp)) if mp else None,
                "perspective_image_count": perspective,
                "spherical_image_count": spherical,
                "heading_diversity": heading_score,
                "temporal_diversity": temporal_score,
                "coverage_score": round(score, 4),
            }
        )
    return rows
