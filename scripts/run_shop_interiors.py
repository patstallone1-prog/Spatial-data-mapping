#!/usr/bin/env python3
"""Fit the site's own shop engines to every eligible single-tenant shop in one area.

Three engines, each fitted to the building's real footprint, height, door and frontage:

  - restaurants (src/smc/interiors/restaurants): restaurants, fast food, cafes, pizzerias,
    bakeries and bars, seated by Kerbside City's service tiers (counter / casual / dining);
  - groceries and corner stores (src/smc/interiors/stores): chain grocers, independent markets
    and convenience stores, with their aisles, cold banks and checkouts;
  - specialty shops (src/smc/interiors/specialty): jewellers, barbers, salons and laundromats.

Only the area's own buildings are tried (the Marina by default: Kerbside City). A venue the
engine cannot fit is kept in the manifest with its reason and nothing is made up for it. With
``--store`` (the public bucket) each accepted layout goes into it, gzipped, under
``interiors/shops/<region>/osm-<id>.json``, and into the overlay tile that lists it, with its
kind, name and footprint, for the page to check against the building it is fitted to. The site
reads both through ``/store`` with no deploy.

    run_shop_interiors.py --out build/marina-shops --workers 6 [--store "$KERBSIDE_PUBLIC_STORE"]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

#: Kerbside City's area (module 30's CITY_AREA): west, south, east, north.
MARINA = (-122.4478, 37.7983, -122.4310, 37.8082)
STORE_SHOPS = "interiors/shops"
ENGINES = ("restaurant", "store", "specialty")


def inside(box):
    def keep(way):
        lon, lat = way.get("centroid") or way["points"][0]
        return box[0] <= lon <= box[2] and box[1] <= lat <= box[3]

    return keep


#: With no price evidence for a venue, how it serves is read from its listing (its OSM tag and
#: its name), never from the size of its building: (words, service mode, spend per person).
LISTING_RULES = (
    (("coffee", "roastery", "bagel", "bakery", "crumble", "pizza", "taqueria", "bento", "box",
      "wings", "curry", "boba", "tea", "juice", "donut", "burrito", "deli"), "counter", 14),
    (("ihop", "drive-in", "diner", "home plate", "pancake", "breakfast"), "auto", 21),
    (("bistro", "brasserie", "steakhouse", "omakase", "trattoria"), "auto", 55),
)
COUNTER_TAGS = {"fast_food", "cafe", "bakery"}


def listing_service(row, tag):
    """Service mode and spend from the listing where no price was observed for the venue."""
    if row.get("price_evidence"):
        return row
    if row["stratum"] == "pickup":
        return {**row, "average_spend_per_person": 14,
                "economics_source": "pickup-sized tenancy; no observed price"}
    name = row["name"].lower()
    for words, mode, spend in LISTING_RULES:
        if any(w in name for w in words):
            return {**row, "service_mode": mode, "average_spend_per_person": spend,
                    "economics_source": f"read from the listing's name ({mode}); no observed price"}
    if tag in COUNTER_TAGS:
        return {**row, "service_mode": "counter", "average_spend_per_person": 14,
                "economics_source": f"read from the listing's tag ({tag}); no observed price"}
    # A neighbourhood restaurant or bar: casual service, an ordinary cover.
    return {**row, "service_mode": "auto", "average_spend_per_person": 30,
            "economics_source": "no observed price; casual table service assumed"}


def restaurant_jobs(keep, region="sf-corridor"):
    from build_inferred_restaurants import ALL_FOOD_TAGS, candidates

    world = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text()) if region == "sf-corridor" else None
    tags = {str(w["osm_id"]): w["shops"][0].get("t") for w in (world or {}).get("ways", [])
            if w.get("kind") == "building" and len(w.get("shops") or []) == 1}
    return [
        {"engine": "restaurant", "osm_id": r["osm_id"], "name": r["name"],
         "row": listing_service(r, tags.get(r["osm_id"]))}
        for r in candidates(region, tags=ALL_FOOD_TAGS, keep=keep)
    ]


def store_jobs(keep):
    from build_inferred_stores import mapped

    with tempfile.TemporaryDirectory() as tmp:
        rows = mapped(Path(tmp), keep=keep, cohort=None, markets=True)
    return [{"engine": "store", "osm_id": r["osm_id"], "name": r["name"], "row": r} for r in rows]


def specialty_jobs(keep, world):
    """The same shells and exclusions as scripts/build_specialty_shops.py, for every one."""
    from shapely.geometry import mapping

    from smc.exteriors.kerbside import from_kerbside
    from smc.exteriors.library import category

    ways = world["ways"]
    streets = [w for w in ways if w.get("kind") == "street"]
    jobs, rejected = [], []
    for way in ways:
        if way.get("kind") != "building" or len(way.get("shops") or []) != 1 or not keep(way):
            continue
        shop = way["shops"][0]
        if category(shop.get("t"), shop.get("tags")) not in {"jewelry", "barber", "salon", "laundry"}:
            continue
        key = "mapped-" + str(way["osm_id"])
        try:
            spec = from_kerbside(way, streets)
            kind = category(spec.tenants[0]["category"], spec.tenants[0].get("tags"))
            name = spec.tenants[0]["name"].lower()
            if spec.footprint.area > 350:
                raise ValueError("large building needs a supplied tenant boundary")
            if any(t in name for t in ["massage", "spa", "nail"]):
                raise ValueError("coarse salon classification needs a specific service program")
            if (
                kind == "laundry"
                and any(t in name for t in ["cleaners", "dry clean"])
                and spec.tenants[0].get("tags", {}).get("self_service") != "yes"
            ):
                raise ValueError("coarse cleaners classification does not establish self-service laundry")
        except (ValueError, KeyError, TypeError) as exc:
            rejected.append({"engine": "specialty", "osm_id": str(way["osm_id"]), "name": shop.get("n", ""),
                             "passed": False, "reason": str(exc), "stage": "selection"})
            continue
        row = dict(
            id=key, kind=kind, footprint=mapping(spec.footprint), height_m=spec.height_m,
            ground_height_m=spec.ground_height_m, tenants=spec.tenants, frontages=spec.frontages,
            origin_lon_lat=spec.origin_lon_lat, geometry_evidence=spec.geometry_evidence,
            canonical_points=spec.canonical_points,
        )
        jobs.append({"engine": "specialty", "osm_id": str(way["osm_id"]), "name": shop.get("n", ""), "row": row})
    return jobs, rejected


def solve(job):
    """Fit one venue. Returns (layout or None, reason or None, seconds)."""
    start = time.time()
    row = job["row"]
    try:
        if job["engine"] == "restaurant":
            from smc.interiors.restaurants import RestaurantInput, infer_restaurant

            h = infer_restaurant(RestaurantInput.from_json(row))
            h.update(name=row["name"], input_evidence=row)
        elif job["engine"] == "store":
            from smc.interiors.stores import StoreInput, infer_store, validate_store

            h = infer_store(StoreInput.from_json(row))
            h.update(name=row["name"], input_evidence=row)
            if not validate_store(h)["passed"]:
                raise ValueError("; ".join(validate_store(h)["errors"]))
        else:
            from smc.interiors.specialty import infer_specialty_shop

            h = infer_specialty_shop(row)
            h["tenant_boundary_basis"] = "inferred whole ground floor; source building shell retained"
            h.update(name=job["name"], input_evidence={k: row[k] for k in ("id", "kind", "origin_lon_lat")})
        if not h.get("validation", {}).get("passed") or h.get("grade") != "inferred":
            raise ValueError("layout did not pass its own validation")
        return h, None, time.time() - start
    except Exception as exc:  # every engine raises ValueError; geometry can raise others
        return None, f"{type(exc).__name__}: {exc}"[:600], time.time() - start


def publish(store, region, job, house, footprints):
    from run_interior_engine import STORE_OVERLAY, TILE_DEG, _gzipped, _merge_json, tile_key

    key = f"{STORE_SHOPS}/{region}/osm-{job['osm_id']}.json"
    store.put(key, _gzipped(house), content_type="application/json", content_encoding="gzip",
              cache_control="public, max-age=3600")
    origin = job["row"]["origin_lon_lat"]
    ref = {"file": key, "origin_lon_lat": origin, "kind": job["engine"], "name": job["name"],
           "footprint": footprints[job["osm_id"]], "measured": False,
           "confidence": house.get("confidence", 0.2),
           "tenancy": "single listed tenant; boundaries inferred"}
    tile = tile_key(*origin)

    def add(value):
        value = value or {"schema": "kerbside.inferred_house_overlay/1", "tile": tile, "buildings": {}}
        value["buildings"][job["osm_id"]] = ref
        return value

    count = len(_merge_json(store, f"{STORE_OVERLAY}/{tile}.json", add)["buildings"])

    def index(value):
        value = value or {"schema": "kerbside.inferred_house_tiles/1", "tile_deg": TILE_DEG, "tiles": {}}
        value["tiles"] = dict(sorted({**value["tiles"], tile: count}.items()))
        return value

    _merge_json(store, f"{STORE_OVERLAY}/index.json", index)
    return key


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--bbox", default=",".join(map(str, MARINA)), help="west,south,east,north")
    p.add_argument("--engines", default=",".join(ENGINES))
    p.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    p.add_argument("--store", help="the public store URL: publish each accepted layout")
    p.add_argument("--list", action="store_true", help="only list the venues each engine would try")
    a = p.parse_args()
    box = tuple(float(v) for v in a.bbox.split(","))
    engines = [e for e in a.engines.split(",") if e]
    keep = inside(box)
    region = "sf-corridor"
    world = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    footprints = {str(w["osm_id"]): w["points"] for w in world["ways"] if w.get("kind") == "building" and keep(w)}
    jobs, records = [], []
    if "restaurant" in engines:
        jobs += restaurant_jobs(keep, region)
    if "store" in engines:
        jobs += store_jobs(keep)
    if "specialty" in engines:
        more, rejected = specialty_jobs(keep, world)
        jobs += more
        records += rejected
    del world
    # One engine per building: a restaurant listing wins over a store reading of the same shell.
    seen, unique = set(), []
    for job in jobs:
        if job["osm_id"] not in seen:
            seen.add(job["osm_id"])
            unique.append(job)
    jobs = sorted(unique, key=lambda j: (j["engine"], hashlib.sha256(j["osm_id"].encode()).hexdigest()))
    counts = {e: sum(j["engine"] == e for j in jobs) for e in engines}
    print(f"{len(jobs)} venues in {box}: {counts}; {len(records)} turned away before fitting", flush=True)
    if a.list:
        for job in jobs:
            print(job["engine"], job["osm_id"], job["name"])
        return 0
    a.out.mkdir(parents=True, exist_ok=True)
    store = None
    if a.store:
        from smc.cloud.store import open_store

        store = open_store(a.store, role="public")
    # Resume: a venue with a result already on disk is not fitted again.
    done_path = a.out / "manifest.json"
    previous = {r["osm_id"]: r for r in json.loads(done_path.read_text())["venues"]} if done_path.exists() else {}
    todo = [j for j in jobs if j["osm_id"] not in previous or (store and previous[j["osm_id"]].get("passed")
                                                                 and not previous[j["osm_id"]].get("store"))]
    results = {k: v for k, v in previous.items() if k not in {j["osm_id"] for j in todo}}
    for r in records:
        results.setdefault(r["osm_id"], r)
    started = time.time()

    def save():
        rows = sorted(results.values(), key=lambda r: (r["engine"], r["osm_id"]))
        done_path.write_text(json.dumps({
            "schema": "kerbside.shop_interior_run/1", "bbox": box, "engines": engines,
            "passed": sum(r.get("passed", False) for r in rows), "total": len(rows),
            "by_engine": {e: {"passed": sum(r["engine"] == e and r.get("passed", False) for r in rows),
                              "total": sum(r["engine"] == e for r in rows)} for e in engines},
            "measured": False, "venues": rows}, indent=1) + "\n")

    with ProcessPoolExecutor(max_workers=a.workers) as pool:
        futures = {pool.submit(solve, job): job for job in todo}
        for n, future in enumerate(as_completed(futures), 1):
            job = futures[future]
            house, reason, seconds = future.result()
            record = {"engine": job["engine"], "osm_id": job["osm_id"], "name": job["name"],
                      "passed": house is not None, "seconds": round(seconds, 1)}
            if house is None:
                record["reason"] = reason
            else:
                folder = a.out / job["engine"]
                folder.mkdir(exist_ok=True)
                (folder / f"osm-{job['osm_id']}.json").write_text(json.dumps(house, separators=(",", ":")))
                record["file"] = f"{job['engine']}/osm-{job['osm_id']}.json"
                if job["engine"] == "restaurant":
                    record["service"] = {k: house["service"][k] for k in ("tier", "seats")}
                if store is not None:
                    record["store"] = publish(store, region, job, house, footprints)
            results[job["osm_id"]] = record
            save()
            elapsed = time.time() - started
            eta = elapsed / n * (len(todo) - n)
            print(f"[{n}/{len(todo)}] {'PASS' if house else 'FAIL'} {job['engine']} {job['name']} "
                  f"({seconds:.0f} s) eta {eta / 60:.1f} min" + ("" if house else f" — {reason[:160]}"),
                  flush=True)
    save()
    summary = json.loads(done_path.read_text())
    print(f"done: {summary['passed']}/{summary['total']} fitted", summary["by_engine"], flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
