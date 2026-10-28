#!/usr/bin/env python3
"""Nine-county retail candidates plus explicit, source-linked parking observations.

Public POIs identify candidates, not surveyed tenant boundaries. Proximity never
establishes parking ownership; unknown level counts stay null, even for a known garage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COUNTIES = (
    "Alameda",
    "Contra Costa",
    "Marin",
    "Napa",
    "San Francisco",
    "San Mateo",
    "Santa Clara",
    "Solano",
    "Sonoma",
)
QUERY = (
    "[out:json][timeout:110];"
    'area["name"="California"]["admin_level"="4"]->.ca;'
    'area(area.ca)["admin_level"="6"]["name"~"^(' + "|".join(COUNTIES) + ') County$"]->.bay;'
    '(nwr(area.bay)["shop"~"^(supermarket|convenience)$"];);out center tags;'
)


def chain_for(name):
    n = name.casefold()
    return (
        "safeway"
        if "safeway" in n
        else "whole_foods"
        if "whole foods" in n
        else "trader_joes"
        if "trader joe" in n
        else "independent"
    )


def fetch_raw(path):
    errors = []
    for url in [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]:
        try:
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({"data": QUERY}).encode(),
                headers={"User-Agent": "Kerbside-retail-research/1.0 (public OSM inventory)"},
            )
            with urllib.request.urlopen(req, timeout=130) as response:
                raw = response.read(16_000_000)
            data = json.loads(raw)
            if data.get("remark") or not data.get("elements"):
                raise ValueError(data.get("remark", "no nine-county stores returned"))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=2) + "\n")
            return data
        except Exception as exc:
            errors.append(str(exc))
            time.sleep(1)
    raise ValueError("public inventory unavailable: " + "; ".join(errors))


def normalize(data, observations=()):
    rows = []
    retrieved = datetime.now(UTC).isoformat()
    for e in data.get("elements", []):
        tags = e.get("tags", {})
        if tags.get("shop") not in {"supermarket", "convenience"}:
            continue
        c = e.get("center", e)
        if "lat" not in c or "lon" not in c:
            continue
        name = tags.get("name") or tags.get("brand") or "Unnamed " + tags["shop"]
        key = f"osm:{e['type']}:{e['id']}"
        row = {
            "id": key,
            "name": name,
            "kind": "grocery" if tags["shop"] == "supermarket" else "corner_store",
            "chain": chain_for(name),
            "lon_lat": [c["lon"], c["lat"]],
            "address": " ".join(
                tags.get(k, "") for k in ["addr:housenumber", "addr:street", "addr:city"]
            ).strip(),
            "website": tags.get("website") or tags.get("contact:website"),
            "source_url": f"https://www.openstreetmap.org/{e['type']}/{e['id']}",
            "source_tags": tags,
            "confidence": 0.35,
            "measured": False,
            "freshness": retrieved,
            "corroboration_count": 0,
            "parking": {"kind": "unknown", "levels": None, "evidence": []},
            "research_status": "parking and tenant geometry unverified",
        }
        # Match an audited observation by an explicit OSM ID or both brand/name and
        # geographic proximity. An address-only/name-only guess cannot change a record.
        for obs in observations:
            loc = obs.get("lon_lat")
            close = (
                loc
                and ((loc[0] - c["lon"]) * 88000) ** 2 + ((loc[1] - c["lat"]) * 111320) ** 2
                < 120**2
            )
            match = key in obs.get("osm_ids", []) or (
                close and obs["name"].casefold() == name.casefold()
            )
            if match:
                row["parking"] = obs["parking"]
                row["research_status"] = (
                    "source-linked parking observation; see evidence dates/unknowns"
                )
                row["observation_id"] = obs["id"]
        rows.append(row)
    # OSM node/way duplicate candidates remain explicit until identity is reviewed.
    # No automatic merger can silently discard a distinct tenant at the same site.
    return {
        "schema": "kerbside.retail_inventory/1",
        "counties": COUNTIES,
        "source": "OpenStreetMap / Overpass",
        "license": "ODbL-1.0",
        "retrieved_at": retrieved,
        "query_sha256": hashlib.sha256(QUERY.encode()).hexdigest(),
        "stores": sorted(rows, key=lambda r: r["id"]),
        "coverage": "OSM candidates, not a complete business census; possible node/way duplicates",
        "source_base_timestamp": data.get("osm3s", {}).get("timestamp_osm_base"),
    }


def normalize_overture(path, observations, counties_path):
    import duckdb
    from shapely.geometry import Point, shape

    counties = json.loads(counties_path.read_text())["features"]
    counties = [(r["properties"]["NAME"], shape(r["geometry"])) for r in counties]
    connection = duckdb.connect()
    rows = connection.execute(
        "SELECT * FROM read_parquet(?) WHERE (contains(category, 'grocery') "
        "OR category IN ('supermarket','convenience_store') "
        "OR (regexp_matches(lower(name),"
        "'^(safeway|whole foods market|trader joe.s|rainbow grocery)$') "
        "AND category IN ('specialty_foods_store','health_food_store','shopping',"
        "'food_and_drink','food_and_beverage_store'))) "
        "AND operating_status != 'permanently_closed'",
        [str(path)],
    ).fetchall()
    rows = [dict(zip([d[0] for d in connection.description], r, strict=True)) for r in rows]
    # Regional matches are identity links from Kerbside's existing places ingestion.
    matches = {}
    for file in sorted((ROOT / "data/places").glob("*.json")):
        for place in json.loads(file.read_text()).get("places", []):
            if place.get("building_osm_id"):
                matches.setdefault(place["id"], []).append(
                    {
                        "region": file.stem,
                        "building_osm_id": str(place["building_osm_id"]),
                        "building_fit": place.get("building_fit"),
                    }
                )
    result = []
    for raw in rows:
        point = Point(raw["lon"], raw["lat"])
        county = next((name for name, p in counties if p.covers(point)), None)
        if county is None:
            continue
        parking = {"kind": "unknown", "levels": None, "evidence": []}
        links = matches.get(raw["id"], [])
        observation = None
        for obs in observations:
            keys = {"osm:way:" + m["building_osm_id"] for m in links}
            loc = obs.get("lon_lat")
            close = (
                loc
                and ((loc[0] - raw["lon"]) * 88000) ** 2 + ((loc[1] - raw["lat"]) * 111320) ** 2
                < 100**2
            )

            def identity_name(name):
                name = re.sub(r"\b(coop|cooperative)\b", "", name.casefold())
                return re.sub(r"[^a-z0-9]", "", name)

            same = identity_name(obs["name"]) == identity_name(raw["name"])
            if same and (keys.intersection(obs.get("osm_ids", [])) or close):
                parking = obs["parking"]
                observation = obs["id"]
        # Overture's grocery category includes small markets and occasional mislabels.
        # Keep that uncertainty instead of presenting every category as a supermarket.
        websites = list(raw["websites"]) if raw["websites"] is not None else []
        result.append(
            {
                "id": "overture:" + raw["id"],
                "name": raw["name"],
                "kind": "corner_store"
                if raw["category"] == "convenience_store"
                else "grocery_candidate",
                "category": raw["category"],
                "chain": chain_for(raw["name"]),
                "lon_lat": [raw["lon"], raw["lat"]],
                "county": county,
                "address": raw["address"],
                "locality": raw["locality"],
                "website": websites[0] if websites else None,
                "source_url": "https://explore.overturemaps.org/",
                "source_id": raw["id"],
                "source_datasets": list(raw["datasets"]),
                "source_licenses": list(raw["licenses"]),
                "confidence": float(raw["confidence"]),
                "measured": False,
                "freshness": raw["updated"],
                "corroboration_count": 0,
                "kerbside_links": links,
                "parking": parking,
                "observation_id": observation,
                "research_status": "parking and tenant geometry unverified"
                if not observation
                else "source-linked parking observation; check dates and unknown levels",
            }
        )
    return {
        "schema": "kerbside.retail_inventory/1",
        "counties": COUNTIES,
        "source": "Kerbside's existing Overture 2026-10-21.0 Bay Area places extract",
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "county_source": (
            "U.S. Census TIGERweb Counties, January 2026; 0.001 degree query simplification"
        ),
        "county_source_url": (
            "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1"
        ),
        "retrieved_at": datetime.now(UTC).isoformat(),
        "stores": sorted(result, key=lambda r: r["id"]),
        "coverage": (
            "Candidate inventory within nine county boundaries; broad grocery labels "
            "require verification, not a supermarket census"
        ),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--fetch", action="store_true", help="refresh the bounded public nine-county query"
    )
    p.add_argument("--raw", type=Path, default=ROOT / "build/grocery-inventory/osm-raw.json")
    p.add_argument(
        "--observations", type=Path, default=ROOT / "data/grocery-stores/parking-observations.json"
    )
    p.add_argument("--out", type=Path, default=ROOT / "data/grocery-stores/inventory.json")
    p.add_argument("--source", choices=["overture", "osm"], default="overture")
    p.add_argument(
        "--overture", type=Path, default=ROOT / "data/places/overture-2026-10-21.0-bay-area.parquet"
    )
    p.add_argument(
        "--counties", type=Path, default=ROOT / "data/grocery-stores/bay-counties.geojson"
    )
    args = p.parse_args()
    obs = (
        json.loads(args.observations.read_text())["observations"]
        if args.observations.exists()
        else []
    )
    if args.source == "overture" and not args.fetch:
        result = normalize_overture(args.overture, obs, args.counties)
    else:
        raw = fetch_raw(args.raw) if args.fetch else json.loads(args.raw.read_text())
        result = normalize(raw, obs)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    queue = [
        {
            "id": r["id"],
            "name": r["name"],
            "lon_lat": r["lon_lat"],
            "website": r["website"],
            "source_url": r["source_url"],
            "missing": [k for k in ("kind", "levels") if r["parking"].get(k) in (None, "unknown")],
        }
        for r in result["stores"]
        if r["parking"].get("kind") == "unknown"
        or (r["parking"].get("kind") in {"garage", "mixed"} and r["parking"].get("levels") is None)
    ]
    args.out.with_name("research-queue.json").write_text(json.dumps(queue, indent=2) + "\n")
    print(
        json.dumps(
            {
                "stores": len(result["stores"]),
                "grocery": sum(
                    r["kind"] in {"grocery", "grocery_candidate"} for r in result["stores"]
                ),
                "parking_research_remaining": len(queue),
            }
        )
    )


if __name__ == "__main__":
    main()
