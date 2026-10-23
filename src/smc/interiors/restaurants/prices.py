"""Google price evidence → an explicitly approximate USD furnishing input.

Prefer Google's actual USD range. Symbols have no universal dollar conversion;
these configurable local bands are a furnishing calibration, not menu prices.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

LEVELS = {
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}
DEFAULT_USD_BANDS = {1: (1, 20), 2: (20, 40), 3: (40, 80), 4: (80, None)}


def _money(row):
    if not row or row.get("currencyCode") != "USD":
        return None
    try:
        value = float(row.get("units", 0)) + float(row.get("nanos", 0)) / 1e9
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def price_evidence(place, *, fetched_at=None, bands=None):
    """Accept New API and legacy/imported level fields; unknown prices stay unknown."""
    fetched_at = fetched_at or datetime.now(UTC)
    value = place.get("priceLevel", place.get("price_level"))
    level = LEVELS.get(value) if isinstance(value, str) else value
    if isinstance(value, str) and value in {"$", "$$", "$$$", "$$$$"}:
        level = len(value)
    if isinstance(level, bool) or not isinstance(level, int) or level not in (1, 2, 3, 4):
        level = None
    actual = place.get("priceRange") or place.get("price_range") or {}
    lo, hi = _money(actual.get("startPrice")), _money(actual.get("endPrice"))
    method = "Google published USD range"
    if lo is None or lo <= 0 or (hi is not None and hi < lo):
        if level is None:
            return None
        lo, hi = (bands or DEFAULT_USD_BANDS)[level]
        method = "Google price level; configurable inferred USD furnishing band"
    estimate = (lo + hi) / 2 if hi is not None else lo * 1.25
    if not math.isfinite(estimate) or estimate <= 0:
        return None
    return {
        "provider": "google_places",
        "place_id": str(place.get("id") or place.get("place_id") or ""),
        "price_level": level,
        "symbols": "$" * level if level else None,
        "range_usd": {"min": lo, "max": hi},
        "average_spend_per_person": round(estimate, 2),
        "currency": "USD",
        "economics_source": method,
        "estimate_is_inferred": True,
        "source_url": "https://maps.google.com/?q=place_id:"
        + str(place.get("id") or place.get("place_id") or ""),
        "fetched_at": fetched_at.isoformat().replace("+00:00", "Z"),
        "freshness": fetched_at.isoformat().replace("+00:00", "Z"),
        "expires_at": (fetched_at + timedelta(days=30)).isoformat().replace("+00:00", "Z"),
        "confidence": 0.6 if method == "Google published USD range" else 0.35,
        "measured": False,
        "corroboration_count": 1,
    }


def apply_price(row, evidence, *, now=None):
    """Explicit caller spend wins. Expired or mismatched evidence cannot set a budget."""
    if not evidence or row.get("economics_source", "").startswith("caller supplied"):
        return False
    try:
        expires = datetime.fromisoformat(evidence["expires_at"].replace("Z", "+00:00"))
        spend = float(evidence["average_spend_per_person"])
        if expires <= (now or datetime.now(UTC)) or not math.isfinite(spend) or spend <= 0:
            return False
    except (KeyError, TypeError, ValueError):
        return False
    if evidence.get("currency") != "USD" or evidence.get("provider") != "google_places":
        return False
    if evidence.get("venue_id") != row.get("id"):
        return False
    row.update(
        average_spend_per_person=spend,
        currency="USD",
        economics_source=evidence["economics_source"],
        price_evidence=evidence,
    )
    return True
