"""Metadata contracts for restricted datasets; never decode or publish their pixels.

Sources: amir32002/3D_Street_View README's d/a row specification and
gmberton/CosPlace datasets/train_dataset.py's filename fields 1, 2 and 9.
Missing capture epochs, panorama IDs and datum remain unknown.
"""

from __future__ import annotations

import math
from pathlib import PurePosixPath


def parse_city_patch(text: str, locator: str) -> dict:
    lines = [line.split() for line in text.splitlines() if line.strip()]
    if not lines or lines[0][0] != "d" or len(lines[0]) != 18:
        raise ValueError("expected documented d row with 17 fields")
    values = [float(v) for v in lines[0][1:]]
    if not all(math.isfinite(v) for v in values):
        raise ValueError("nonfinite city-patch metadata")
    if any(v < 0 or int(v) != v for v in values[:4]):
        raise ValueError("invalid dataset/target/patch/panorama identity")
    dataset, target, patch, panorama = (int(v) for v in values[:4])
    for lat, lon in (values[4:6], values[10:12]):
        if not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError("invalid georeferenced patch coordinates")
    if values[13] < 0 or not -90 <= values[15] <= 90:
        raise ValueError("invalid distance/pitch")
    alignment = None
    if len(lines) > 1:
        if len(lines) != 2 or lines[1][0] != "a" or len(lines[1]) != 41:
            raise ValueError("expected complete documented a row with 40 fields")
        alignment = [float(v) for v in lines[1][1:]]
        if not all(math.isfinite(v) for v in alignment):
            raise ValueError("nonfinite alignment metadata")
    return {
        "dataset_id": "3d-street-view", "locator": locator,
        "patch_id": f"{dataset}:{patch}", "panorama_id": f"{dataset}:{panorama}",
        "correspondence_group": f"{dataset}:{target}",
        "target_lat_lon_height": values[4:7], "surface_normal_webmercator": values[7:10],
        "camera_lat_lon_height": values[10:13], "distance_m": values[13],
        "heading_deg": values[14], "pitch_deg": values[15], "roll_deg": values[16],
        "alignment_fields": alignment, "captured_at": None, "vertical_datum": "unknown",
        "geometry_basis": "manual_georegistered_reference_model_not_independent_truth",
        "production_eligible": False,
    }


def parse_sf_xl_path(locator: str, *, horizontal_crs: str = "unknown",
                     panorama_id: str | None = None) -> dict:
    fields = PurePosixPath(locator).name.split("@")
    if len(fields) < 10:
        raise ValueError("SF-XL path lacks documented UTM/heading fields")
    east, north, heading = (float(fields[i]) for i in (1, 2, 9))
    if (not all(math.isfinite(v) for v in (east, north, heading))
            or not 100000 <= east <= 900000 or not 0 <= north <= 10000000
            or not 0 <= heading < 360):
        raise ValueError("invalid SF-XL position or heading")
    return {
        "dataset_id": "sf-xl", "locator": locator, "utm_easting": east,
        "utm_northing": north, "horizontal_crs": horizontal_crs, "heading_deg": heading,
        "raw_filename_fields": fields, "panorama_id": panorama_id,
        "captured_at": None, "vertical_datum": "unknown", "production_eligible": False,
        "independent_camera_status": "same_panorama_crops_not_independent_views"
        if panorama_id else "panorama_identity_requires_source_manifest",
    }


def correspondence_groups(patches: list[dict]) -> dict[str, list[dict]]:
    """Group full partner sets without downsampling or treating crops as new cameras."""
    groups = {}
    for patch in patches:
        groups.setdefault(patch["correspondence_group"], []).append(patch)
    return groups
