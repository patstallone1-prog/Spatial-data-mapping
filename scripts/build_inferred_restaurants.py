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
import sys
from pathlib import Path

from shapely.errors import GEOSException
from shapely.geometry import Polygon, mapping

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.interiors.restaurants import RestaurantInput, infer_restaurant  # noqa: E402

STRATA = ("pickup", "narrow", "irregular", "large", "regular")


def write(path, value):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    tmp.replace(path)


def candidates():
    page = json.loads((ROOT / "docs/sf-corridor-3d.json").read_text())
    pool = []
    fits = json.loads((ROOT / "docs/sf-corridor-interiors.json").read_text())["buildings"]
    for w in page["ways"]:
        shops = w.get("shops", [])
        if (
            w["kind"] != "building"
            or len(shops) != 1
            or shops[0].get("t") not in {"restaurant", "fast_food"}
        ):
            continue
        lon, lat = w["centroid"]
        p = Polygon(
            [
                ((x - lon) * 111320 * math.cos(math.radians(lat)), (y - lat) * 111320)
                for x, y in w["points"]
            ]
        )
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
        fit = fits.get(str(w["osm_id"]))
        entrance = None
        if fit and fit[13]:
            edge, t, _, _ = fit[13][0]
            a, b = list(p.exterior.coords)[edge : edge + 2]
            entrance = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        key = "restaurant-" + str(w["osm_id"])
        pool.append(
            {
                "id": key,
                "osm_id": str(w["osm_id"]),
                "name": shops[0]["n"],
                "footprint": mapping(p),
                "units": "metres",
                "height_m": 3.2,
                "entrance": entrance,
                "origin_lon_lat": [lon, lat],
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
    args = parser.parse_args()
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
        selected = select_round(candidates(), history)
        for row in selected:
            if row["id"] in prices:
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
