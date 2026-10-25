#!/usr/bin/env python3
"""Import Google price evidence; optionally make a bounded number of Places API requests.

No network calls by default. Uses the existing .env.local Google key without logging it.
Price fields use the Enterprise SKU; the account's shared free allowance is not a local quota.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))
from smc.config import load_env_file  # noqa: E402
from smc.interiors.restaurants.prices import apply_price, price_evidence  # noqa: E402

FIELDS = "id,displayName,formattedAddress,location,priceLevel,priceRange"


def name_key(value):
    text = unicodedata.normalize("NFKD", value).lower()
    text = re.sub(r"\b(restaurant|restaurants|cafe|llc|inc)\b", "", text)
    return re.sub(r"[^a-z0-9]", "", text)


def matching_place(venue, places):
    """Reject ambiguous businesses and nearby venues with unrelated names."""
    lon, lat = venue["origin_lon_lat"]
    matches = []
    for place in places:
        name = (place.get("displayName") or {}).get("text") or place.get("name", "")
        a, b = name_key(venue["name"]), name_key(name)
        if not a or not b or SequenceMatcher(None, a, b).ratio() < 0.88:
            continue
        loc = place.get("location") or {}
        x, y = loc.get("longitude", place.get("lon")), loc.get("latitude", place.get("lat"))
        if x is None or y is None:
            continue
        distance = math.hypot((x - lon) * 111320 * math.cos(math.radians(lat)), (y - lat) * 111320)
        if distance <= 30 and place.get("id", place.get("place_id")):
            matches.append((place, distance))
    # Multiple branches in one envelope require a reviewed place-id association.
    unique = {p.get("id", p.get("place_id")): (p, d) for p, d in matches}
    return next(iter(unique.values())) if len(unique) == 1 else None


def fetch_places(venue, key):
    lon, lat = venue["origin_lon_lat"]
    body = json.dumps(
        {
            "textQuery": venue["name"],
            "languageCode": "en",
            "regionCode": "US",
            "maxResultCount": 5,
            "locationBias": {
                "circle": {"center": {"latitude": lat, "longitude": lon}, "radius": 100.0}
            },
        }
    ).encode()
    request = urllib.request.Request(
        "https://places.googleapis.com/v1/places:searchText",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": ",".join("places." + f for f in FIELDS.split(",")),
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response).get("places", [])


def ingest(venues, cache, *, imported=(), fetch=None, max_requests=0, bands=None):
    records = cache.setdefault("restaurants", {})
    report = {
        "venues": len(venues),
        "fresh_cached": 0,
        "matched": 0,
        "missing_or_ambiguous": 0,
        "requests": 0,
        "errors": [],
    }
    for venue in venues:
        if apply_price(dict(venue), records.get(venue["id"])):
            report["fresh_cached"] += 1
            continue
        match = matching_place(venue, imported)
        if match is None and fetch and report["requests"] < max_requests:
            report["requests"] += 1
            try:
                match = matching_place(venue, fetch(venue))
            except (OSError, ValueError) as exc:
                # Never print API keys, request headers or arbitrary provider response bodies.
                report["errors"].append(
                    f"Google Places request failed ({type(exc).__name__}, "
                    f"HTTP {getattr(exc, 'code', 'n/a')})"
                )
                break
        if match:
            place, distance = match
            timestamp = place.get("fetched_at")
            fetched = (
                datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                if timestamp
                else datetime.now(UTC)
            )
            evidence = price_evidence(place, fetched_at=fetched, bands=bands)
            if evidence:
                evidence.update(
                    venue_id=venue["id"],
                    match_distance_m=round(distance, 2),
                    match_method="unique name agreement and within 30m of Kerbside building",
                    building_id=venue.get("osm_id"),
                    region=venue.get("geometry_evidence", {}).get("region"),
                )
                if apply_price(dict(venue), evidence):
                    records[venue["id"]] = evidence
                    report["matched"] += 1
                    continue
        report["missing_or_ambiguous"] += 1
    cache.update(schema="kerbside.restaurant_prices/1", updated_at=datetime.now(UTC).isoformat())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        help="mapped restaurant input JSON array; otherwise use region candidates",
    )
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument(
        "--import-google", type=Path, help="Google Places JSON array or {places: [...]}; no network"
    )
    parser.add_argument("--out", type=Path, default=ROOT / "data/restaurant-prices.json")
    parser.add_argument(
        "--max-requests",
        type=int,
        default=0,
        help="explicit API request budget, default zero (max 1000)",
    )
    parser.add_argument(
        "--limit", type=int, default=20, help="bounded number of venues per ingestion"
    )
    parser.add_argument(
        "--usd-bands", type=Path, help="JSON level -> [min,max]; null max means open-ended"
    )
    args = parser.parse_args()
    if not 0 <= args.max_requests <= 1000 or not 1 <= args.limit <= 1000:
        parser.error("request budget must be 0-1000; venue limit 1-1000")
    from build_inferred_restaurants import candidates

    venues = json.loads(args.input.read_text()) if args.input else candidates(args.region)
    cache = json.loads(args.out.read_text()) if args.out.exists() else {}
    imported = json.loads(args.import_google.read_text()) if args.import_google else []
    if isinstance(imported, dict):
        imported = imported.get("places", [])
    # Reuse existing enrichment without another request, retaining its original fetched_at.
    enrichment = ROOT / "data/sf_building_enrichment/buildings.json"
    if enrichment.exists() and args.region == "sf-corridor":
        for row in json.loads(enrichment.read_text()):
            imported.extend(row.get("google_places", []))
    bands = (
        {int(k): tuple(v) for k, v in json.loads(args.usd_bands.read_text()).items()}
        if args.usd_bands
        else None
    )
    if bands and (
        set(bands) != {1, 2, 3, 4}
        or any(
            len(v) != 2
            or not isinstance(v[0], (int, float))
            or v[0] <= 0
            or (v[1] is not None and (not isinstance(v[1], (int, float)) or v[1] < v[0]))
            for v in bands.values()
        )
    ):
        parser.error("USD bands must specify levels 1-4 with positive ordered bounds")
    load_env_file(ROOT / ".env.local")
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if args.max_requests and not key:
        parser.error("GOOGLE_MAPS_API_KEY is required for API requests; imports remain available")
    report = ingest(
        venues[: args.limit],
        cache,
        imported=imported,
        fetch=(lambda venue: fetch_places(venue, key)) if key else None,
        max_requests=args.max_requests,
        bands=bands,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    temp = args.out.with_suffix(".tmp")
    temp.write_text(json.dumps(cache, indent=2, allow_nan=False) + "\n")
    temp.replace(args.out)
    print(json.dumps(report, indent=2))
    if report["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
