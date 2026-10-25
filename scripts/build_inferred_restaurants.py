#!/usr/bin/env python3
"""Select five unique mapped venues before solving; retain failures, rotate successes.

Kerbside only knows building envelopes here. A single listed tenant is not proof
that the restaurant occupies its entire ground floor; every generated record says so.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path

from shapely.errors import GEOSException
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.interiors.kerbside import mapped_geometry  # noqa: E402
from smc.interiors.restaurants import RestaurantInput, infer_restaurant  # noqa: E402
from smc.interiors.restaurants.prices import apply_price  # noqa: E402

STRATA = ("pickup", "narrow", "irregular", "large", "regular")


def write(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    tmp.replace(path)


def candidates(region="sf-corridor", price_path=None):
    base = ROOT / "docs" if region == "sf-corridor" else ROOT / "docs/regions" / region
    page = json.loads((base / "sf-corridor-3d.json").read_text())
    pool = []
    fits = json.loads((base / "sf-corridor-interiors.json").read_text())["buildings"]
    price_path = price_path or ROOT / "data/restaurant-prices.json"
    price_rows = (
        json.loads(price_path.read_text()).get("restaurants", {}) if price_path.exists() else {}
    )
    for w in page["ways"]:
        shops = w.get("shops", [])
        if (
            w["kind"] != "building"
            or len(shops) != 1
            or shops[0].get("t") not in {"restaurant", "fast_food"}
        ):
            continue
        fit = fits.get(str(w["osm_id"]))
        geometry = mapped_geometry(w, fit, region=region)
        p = Polygon(geometry["footprint"]["coordinates"][0])
        if not p.is_valid or not 28 <= p.area <= 350:
            continue
        coords = list(p.minimum_rotated_rectangle.exterior.coords)
        width = min(math.dist(coords[i], coords[i + 1]) for i in range(4))
        compactness = p.area / p.minimum_rotated_rectangle.area
        stratum = (
            "pickup"
            if p.area < 65
            else "narrow"
            if width < 6.1
            else "irregular"
            if compactness < 0.86
            else "large"
            if p.area > 220
            else "regular"
        )
        key = "restaurant-" + str(w["osm_id"])
        pool.append(
            {
                "id": key,
                "osm_id": str(w["osm_id"]),
                "name": shops[0]["n"],
                **geometry,
                "stratum": stratum,
                "service_mode": "pickup"
                if stratum == "pickup"
                else "counter"
                if shops[0]["t"] == "fast_food"
                else "auto",
                "bar": stratum == "large",
                "average_spend_per_person": {
                    "pickup": 15,
                    "narrow": 18,
                    "irregular": 40,
                    "large": 70,
                    "regular": 32,
                }[stratum],
                "currency": "USD",
                "economics_source": "illustrative test spend, not this venue's observed price",
                "source": (
                    "Kerbside mapped building with one listed food tenant; "
                    "full ground-floor tenancy is an unverified assumption"
                ),
                "selection_hash": hashlib.sha256(key.encode()).hexdigest(),
            }
        )
        apply_price(pool[-1], price_rows.get(key))
    return sorted(pool, key=lambda r: r["selection_hash"])


def select_round(pool, history):
    previous = history.get("rounds", [])
    failures = [r["input"] for r in previous[-1]["results"] if not r["passed"]] if previous else []
    successful = {r["id"] for round in previous for r in round["results"] if r["passed"]}
    chosen = list(failures)
    for stratum in STRATA:
        if len(chosen) >= 5:
            break
        if any(r["stratum"] == stratum for r in chosen):
            continue
        match = next(
            (
                r
                for r in pool
                if r["id"] not in successful
                and r["id"] not in {c["id"] for c in chosen}
                and r["stratum"] == stratum
            ),
            None,
        )
        if match:
            chosen.append(match)
    for row in pool:
        if len(chosen) >= 5:
            break
        if row["id"] not in successful and row["id"] not in {c["id"] for c in chosen}:
            chosen.append(row)
    if len(chosen) != 5:
        raise ValueError("five new/retained venues unavailable; no silent reuse of successes")
    return copy.deepcopy(chosen)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "docs/inferred-restaurants")
    parser.add_argument("--prices", type=Path, help="JSON venue id -> USD spend per person")
    parser.add_argument("--google-prices", type=Path, help="ingested Google price evidence cache")
    parser.add_argument("--region", default="sf-corridor")
    parser.add_argument("--seed-from", type=Path,
                        help="start an empty --out from this folder's rounds (a cloud worker's first round)")
    args = parser.parse_args()
    if args.seed_from and not (args.out / "history.json").exists() and (args.seed_from / "history.json").exists():
        shutil.copytree(args.seed_from, args.out, dirs_exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    history_path = args.out / "history.json"
    history = (
        json.loads(history_path.read_text())
        if history_path.exists()
        else {"schema": "kerbside.restaurant_rounds/1", "rounds": []}
    )
    prices = json.loads(args.prices.read_text()) if args.prices else {}
    if history["rounds"] and history["rounds"][-1]["status"] == "running":
        round = history["rounds"][-1]
        selected = round["selected"]
    else:
        selected = select_round(candidates(args.region, args.google_prices), history)
        for row in selected:
            if row["id"] in prices:
                row.pop("price_evidence", None)
                row.update(
                    average_spend_per_person=prices[row["id"]],
                    economics_source="caller supplied USD spend per person",
                )
        round = {
            "number": len(history["rounds"]) + 1,
            "engine_sha256": hashlib.sha256(
                (ROOT / "src/smc/interiors/restaurants/engine.py").read_bytes()
            ).hexdigest(),
            "status": "running",
            "selected": selected,
            "results": [],
            "selection": (
                "five geometry strata, SHA256(id) order before inference; "
                "retain failures, exclude all prior successes"
            ),
        }
        history["rounds"].append(round)
        write(history_path, history)
    write(args.out / "inputs.json", selected)
    completed = {r["id"] for r in round["results"]}
    for row in selected:
        if row["id"] in completed:
            continue
        try:
            h = infer_restaurant(RestaurantInput.from_json(row))
            h.update(name=row["name"], input_evidence=row)
            write(args.out / f"{row['id']}.json", h)
            record = {
                "id": row["id"],
                "name": row["name"],
                "file": row["id"] + ".json",
                "passed": True,
                "storeys": 1,
                "style": h["style"]["name"],
                "metrics": h["validation"]["metrics"],
                "input": row,
                "service_mode": h["service_mode"],
            }
            print("PASS", row["name"], record["metrics"], flush=True)
        except (ValueError, GEOSException) as exc:
            record = {
                "id": row["id"],
                "name": row["name"],
                "passed": False,
                "reason": str(exc),
                "input": row,
            }
            print("FAIL", row["name"], str(exc), flush=True)
        round["results"].append(record)
        write(history_path, history)
        write(
            args.out / "manifest.json",
            {
                "schema": "kerbside.restaurant_batch/1",
                "round": round["number"],
                "houses": round["results"],
                "passed": sum(r["passed"] for r in round["results"]),
                "total": 5,
                "measured": False,
            },
        )
    round["status"] = "complete"
    write(history_path, history)
    if any(not r["passed"] for r in round["results"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
