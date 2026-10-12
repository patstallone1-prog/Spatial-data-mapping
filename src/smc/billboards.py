"""Advertising dimensions are not the total height of their support structure."""

from __future__ import annotations

import math
import re
from urllib.parse import urlsplit

ADVERTISEMENT_TAGS = {
    "size",
    "width",
    "height",
    "min_height",
    "support",
    "sides",
    "direction",
    "orientation",
    "lit",
    "location",
    "material",
    "website",
    "contact:website",
    "url",
    "image",
}


def metres(value) -> float | None:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|feet|')?\s*", str(value or ""))
    if not match:
        return None
    number = float(match[1]) * (0.3048 if match[2] in {"ft", "feet", "'"} else 1)
    return number if math.isfinite(number) and 0 < number <= 200 else None


def safe_website(value) -> str | None:
    if not isinstance(value, str) or re.search(r"[\x00-\x20\x7f]", value):
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme in {"https", "http"}
            and parsed.hostname
            and not (parsed.username or parsed.password)
        ):
            return value
    except ValueError:
        pass
    return None


def billboard_geometry(tags: dict, kind: str = "billboard") -> dict:
    default = (7.62, 3.66, 6.5) if kind == "billboard" else (1.2, 1.8, 2.35)
    size = re.split(r"[xX*\u00d7]", str(tags.get("size", "")))
    dimensions = [metres(part) for part in size] if len(size) == 2 else []
    has_size = len(dimensions) == 2 and all(dimensions)
    width = dimensions[0] if has_size else metres(tags.get("width")) or default[0]
    inferred_ratio = (
        4.2672 / 14.6304 if kind == "billboard" and width >= 11 else default[1] / default[0]
    )
    height = dimensions[1] if has_size else inferred_ratio * width
    # OSM height is the highest part including supports, NOT the face height.
    top, bottom = metres(tags.get("height")), metres(tags.get("min_height"))
    if str(tags.get("min_height", "")).strip() in {"0", "0.0", "0 m"}:
        bottom = 0.0
    tagged_vertical = top is not None or bottom is not None
    warnings = []
    if bottom is not None and top is not None and top > bottom and not has_size:
        height = top - bottom
    if bottom is None:
        bottom = max(0, (top or max(default[2], height + 0.4)) - height)
    if top is not None and top < bottom + height - 0.01:
        warnings.append("source_total_height_conflicts_with_display_size")
    direction = str(tags.get("direction", "")).upper()
    compass = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}
    azimuth = compass.get(direction)
    if azimuth is None:
        try:
            azimuth = float(direction) % 360
            if not math.isfinite(azimuth):
                azimuth = None
        except ValueError:
            pass
    return {
        "width_m": round(width, 4),
        "height_m": round(height, 4),
        "bottom_m": round(bottom, 4),
        "azimuth_deg": azimuth,
        "sides": 2 if str(tags.get("sides")) == "2" else 1,
        "support": tags.get("support", "poles"),
        "location": tags.get("location", "ground"),
        "dimensions_basis": "osm_size_tag"
        if has_size
        else "osm_width_with_inferred_aspect"
        if metres(tags.get("width"))
        else "inferred_standard_poster_not_measured",
        "height_basis": "osm_height_min_height" if tagged_vertical else "inferred_mount_height",
        "warnings": warnings,
    }


def enrich_advertisement(record: dict, tags: dict | None = None) -> dict:
    combined = {**record.get("tags", {}), **(tags or {})}
    result = {
        **record,
        "tags": {
            k: v
            for k, v in combined.items()
            if k in ADVERTISEMENT_TAGS or k in record.get("tags", {})
        },
    }
    result["display_geometry"] = billboard_geometry(combined, record.get("ad_kind", "board"))
    href = next(
        (
            safe_website(combined.get(k))
            for k in ("website", "contact:website", "url")
            if safe_website(combined.get(k))
        ),
        None,
    )
    match = re.fullmatch(r"osm:ad_panel:(node|way):(\d+)", record.get("id", ""))
    result["website"] = href or (
        f"https://www.openstreetmap.org/{match[1]}/{match[2]}" if match else None
    )
    result["website_basis"] = "osm_website_tag" if href else "mapped_source_page_not_advertiser"
    return result
