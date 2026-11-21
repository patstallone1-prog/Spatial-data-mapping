"""Kerbside City's restaurant tiers, crew and kitchen depth, carried into the site engine.

The city's walk-in fitter (docs/city/restaurant-room.mjs) seats a counter place tight, a casual
place in cushioned booths and a fine-dining room wide, with a banquette, a host stand and
linen. The site engine fits the same rules to the venue's real footprint and door.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest
from shapely.geometry import box, shape

from smc.interiors.restaurants import RestaurantInput, infer_restaurant, validate_restaurant
from smc.interiors.restaurants.service import (
    SERVICE_TIERS,
    kitchen_depth_for,
    restaurant_staff,
    service_tier,
)

ROOT = Path(__file__).resolve().parents[1]


def test_tiers_and_crew_match_the_city_fitter() -> None:
    source = (ROOT / "docs/city/restaurant-room.mjs").read_text()
    for name, tier in SERVICE_TIERS.items():
        m = re.search(name + r": \{ seat_m2: ([\d.]+), seats_per_server: (\d+), seats_per_cook: (\d+)", source)
        assert m, name
        assert (tier["seat_m2"], tier["seats_per_server"], tier["seats_per_cook"]) == (
            float(m[1]), int(m[2]), int(m[3]))
    # The same crew for the same seats as the city's restaurantStaff().
    script = source[source.index("export const SERVICE_TIERS"):source.index("export function restaurantService")]
    script = script.replace("export ", "") + (
        "console.log(JSON.stringify([[30,'casual',20],[56,'dining',70],[12,'counter',12]].map(([s,t,p])=>"
        "{const st=restaurantStaff(s,{style:t,price:p});return [st,kitchenDepthFor(st,7)];})));")
    out = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, check=True)
    city = json.loads(out.stdout)
    # The city prices a dish; the engine a cover (about 1.4 dishes): $40 a dish is $56 a head.
    for (seats, tier, dish), (crew, depth) in zip([[30, "casual", 20], [56, "dining", 70], [12, "counter", 12]], city, strict=True):
        ours = restaurant_staff(seats, tier, dish * 1.4)
        assert {k: ours[k] for k in crew} == crew
        assert kitchen_depth_for(ours) == pytest.approx(depth)
    assert service_tier("counter", 40) == "counter" and service_tier("pickup", None) == "counter"
    # A cheap place that seats you is casual table service, not a counter.
    assert service_tier("auto", 18) == "casual" and service_tier("auto", 32) == "casual"
    assert service_tier("auto", 65) == "dining"


@pytest.fixture(scope="module")
def tiers():
    room = box(0, 0, 11, 16)
    return {
        spend: infer_restaurant(RestaurantInput(f"tier-{spend}", room, average_spend_per_person=spend,
                                                service_mode="counter" if spend < 20 else "auto"))
        for spend in (18, 32, 70)
    }


def test_each_tier_seats_and_furnishes_its_own_way(tiers) -> None:
    counter, casual, dining = tiers[18], tiers[32], tiers[70]
    for h in tiers.values():
        assert validate_restaurant(h)["passed"], validate_restaurant(h)["errors"]
    assert [h["service"]["tier"] for h in (counter, casual, dining)] == ["counter", "casual", "dining"]
    # Fine dining sets fewer seats in the same room: wide-spaced, at most 2.1 m² of floor a seat.
    seats = {k: h["service"]["seats"] for k, h in tiers.items()}
    assert seats[70] < seats[32]
    room = next(r for r in dining["storeys"][0]["rooms"] if r["kind"] == "dining")
    assert seats[70] <= shape(room["polygon"]).area / 2.1 + 1e-6
    objects = {k: dining_objects(h) for k, h in tiers.items()}
    # The booth's form by tier: laminate, the venue's own cushioned one, a velvet banquette.
    assert {o["asset"]["design_id"] for o in objects[18] if o["role"] == "booth"} <= {"laminate"}
    assert {o["asset"]["design_id"] for o in objects[70] if o["role"] == "booth"} == {"banquette"}
    assert any(g["seat_count"] == 8 and g["booth"] for g in dining["seating"])
    # Fine dining: a host stand by the door; past forty seats or a big crew, the manager's desk.
    assert dining["service"]["host_stand"] and not casual["service"]["host_stand"]
    assert sum(o["role"] == "host_stand" for o in objects[70]) == 1
    for h in tiers.values():
        if h["staff"]["manager"] or h["service"]["tier"] == "dining" or h["staff"]["total"] >= 6:
            desk = next(o for o in dining_objects(h) if o.get("purpose") == "manager_office")
            assert any(o["role"] == "computer" and o["support"]["id"] == desk["id"] for o in dining_objects(h))
    # The crew and kitchen depth are recorded, and the kitchen cut is deep enough for it here.
    assert dining["staff"]["host"] == 1 and dining["staff"]["cooks"] >= 2
    for h in tiers.values():
        assert h["service"]["kitchen_depth_m"] >= h["service"]["kitchen_depth_needed_m"] - 0.05


def test_casual_corners_take_a_table_for_two(tiers) -> None:
    casual = tiers[32]
    room = next(r for r in casual["storeys"][0]["rooms"] if r["kind"] == "dining")
    corners = [c for c in shape(room["polygon"]).exterior.coords[:-1]]
    twos = [g for g in casual["seating"] if g["seat_count"] == 2]
    tables = {o["id"]: o for o in dining_objects(casual) if o["role"] == "dining_table"}
    near = [g for g in twos if min(((tables[g["table_id"]]["position_m"][0] - x) ** 2
                                    + (tables[g["table_id"]]["position_m"][2] - y) ** 2) ** 0.5
                                   for x, y in corners) < 1.7]
    assert near


def test_renderer_draws_the_tier_pieces() -> None:
    js = (ROOT / "docs/inferred-interiors/renderer.mjs").read_text()
    for needle in ("==='banquette'", "==='laminate'", "role==='host_stand'", "role==='computer'",
                   "finedining&&role==='dining_table'"):
        assert needle in js


def dining_objects(h):
    return h["storeys"][0]["objects"]


def test_counter_or_table_from_menu_room_reservations_and_price() -> None:
    from smc.interiors.restaurants.service import classify_service

    broad = {"servesBreakfast": True, "servesLunch": True, "servesDinner": True,
             "servesBeer": True, "servesWine": True, "servesCocktails": True, "dineIn": True}
    # A cheap taqueria with a broad menu and a big room seats you.
    taqueria = classify_service(area_m2=318, google={**broad, "primaryType": "mexican_restaurant"},
                                price={"price_level": 1, "average_spend_per_person": 15},
                                name_counter=True)
    assert taqueria["service_mode"] == "auto" and taqueria["tier"] == "casual"
    # A large restaurant with nothing else known still seats you; a coffee shop does not.
    assert classify_service(area_m2=319)["service_mode"] == "auto"
    coffee = classify_service(area_m2=227, tag="cafe", name_counter=True,
                              google={"primaryType": "coffee_shop", "servesBreakfast": True})
    assert coffee["service_mode"] == "counter" and coffee["tier"] == "counter"
    # No dine-in is a counter whatever else; a tiny tenancy is pickup.
    assert classify_service(area_m2=200, google={**broad, "dineIn": False})["service_mode"] == "pickup"
    assert classify_service(area_m2=44)["service_mode"] == "pickup"
    # Fine dining: $$$ and up, or $$ with reservations and a $50 cover.
    assert classify_service(area_m2=128, google={**broad, "reservable": True},
                            price={"price_level": 3, "average_spend_per_person": 75})["tier"] == "dining"
    assert classify_service(area_m2=225, google={**broad, "reservable": True},
                            price={"price_level": 2, "average_spend_per_person": 45})["tier"] == "casual"
    # Every signal is kept, so a classification can be read back.
    assert any("reservations" in s for s in classify_service(
        area_m2=100, google={"reservable": True})["signals"])


def test_an_area_run_classifies_each_venue_and_keeps_its_price() -> None:
    import importlib.util

    from shapely.geometry import box, mapping

    spec = importlib.util.spec_from_file_location("shop_run", ROOT / "scripts/run_shop_interiors.py")
    run = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(run)
    big = mapping(box(0, 0, 16, 20))
    ihop = run.listing_service({"name": "IHOP", "footprint": big, "stratum": "large",
                                "average_spend_per_person": 70}, "restaurant")
    # The placeholder spend for a large building is replaced, and size does not make it fine.
    assert ihop["service_tier"] == "casual" and ihop["average_spend_per_person"] == 30
    bistro = run.listing_service({"name": "Bistro Aix", "footprint": big, "stratum": "large"}, "restaurant")
    assert bistro["service_tier"] == "dining"
    priced = run.listing_service({"name": "A16", "footprint": big, "stratum": "large",
                                  "average_spend_per_person": 75,
                                  "price_evidence": {"price_level": 3, "average_spend_per_person": 75}},
                                 "restaurant", {"reservable": True})
    assert priced["service_tier"] == "dining" and priced["average_spend_per_person"] == 75
