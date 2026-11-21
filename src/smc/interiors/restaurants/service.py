"""How a restaurant serves, and the crew that takes: the city game's tiers in the site engine.

The same rules of thumb as Kerbside City's walk-in fitter (docs/city/restaurant-room.mjs,
``SERVICE_TIERS``, ``restaurantStaff``, ``kitchenDepthFor``), so a generated tenancy and the
city's own restaurant agree on how it seats, who works there and how deep its kitchen is:

  - "counter": order at the counter (fast food, a takeaway): seats tight, metal and laminate,
    laminate booths, a cashier for every forty seats.
  - "casual": a diner or neighbourhood place: wooden tables, cushioned booths on the walls.
  - "dining": fine dining: wide-set tables laid with linen, an upholstered banquette along the
    wall, a host stand by the door, a server for every nine seats.

These are design heuristics from industry rules of thumb, not this venue's observed staffing.
"""

from __future__ import annotations

import math

#: Floor per seat (m²), covers per server and per cook, the finish, the booth's form and the
#: clear space kept around each seated group (m) by tier.
SERVICE_TIERS = {
    "counter": {
        "seat_m2": 1.25,
        "seats_per_server": 40,
        "seats_per_cook": 28,
        "finish": "metal",
        "booth": "laminate",
        "spacing_m": 0.06,
    },
    "casual": {
        "seat_m2": 1.6,
        "seats_per_server": 16,
        "seats_per_cook": 22,
        "finish": "wood",
        "booth": None,  # the venue's own channel / tufted / timber booth
        "spacing_m": 0.08,
    },
    "dining": {
        "seat_m2": 2.1,
        "seats_per_server": 9,
        "seats_per_cook": 13,
        "finish": "linen",
        "booth": "banquette",
        "spacing_m": 1.0,
    },
}

#: Average spend per person at which a table-service place is fine dining. The city's rule is a
#: typical dish of $24 or more; a cover (food and a drink) runs to about half as much again.
DINING_SPEND = 45
#: The spend per person from which the line takes an extra cook (the city's $40 dish).
EXTRA_COOK_SPEND = 56


def service_tier(service_mode: str, spend: float | None) -> str:
    """The tier from how it serves and what a cover costs."""
    # A cheap place that seats you is still table service (casual, on the economy finish).
    if service_mode in {"counter", "pickup"}:
        return "counter"
    if spend is not None and spend >= DINING_SPEND:
        return "dining"
    return "casual"


def restaurant_staff(seats: int, tier: str, spend: float | None = None) -> dict:
    """The crew at its busiest: cooks on the line, a dishwasher past twenty seats, servers (or
    cashiers at a counter), a host in fine dining past sixteen seats, a manager past forty."""
    t = SERVICE_TIERS.get(tier, SERVICE_TIERS["casual"])
    cooks = max(1, math.ceil(seats / t["seats_per_cook"]) + (1 if (spend or 0) >= EXTRA_COOK_SPEND else 0))
    front = max(1, math.ceil(seats / t["seats_per_server"]))
    dish = math.ceil(seats / 60) if seats > 20 else 0
    host = 1 if tier == "dining" and seats > 16 else 0
    manager = 1 if seats > 40 else 0
    return {
        "cooks": cooks,
        "front": front,
        "dish": dish,
        "host": host,
        "manager": manager,
        "total": cooks + front + dish + host + manager,
        "basis": "seats and tier rules of thumb; not this venue's observed staffing",
    }


def kitchen_depth_for(staff: dict, stations: int = 7) -> float:
    """How deep (m) the kitchen behind the pass is for a crew: the line and its aisle, more
    for more cooks, a dish pit, a wide range of stations and a manager's desk."""
    return max(
        2.5,
        min(
            7.5,
            2.4
            + 0.55 * max(0, staff["cooks"] - 1)
            + 0.3 * staff["dish"]
            + (0.8 if stations > 8 else 0)
            + (0.6 if staff["manager"] else 0),
        ),
    )


#: Google place types that order at a counter, and the weaker one (a pizzeria may seat you).
COUNTER_TYPES = {
    "coffee_shop", "cafe", "bagel_shop", "bakery", "fast_food_restaurant", "sandwich_shop",
    "meal_takeaway", "ice_cream_shop", "donut_shop", "juice_shop", "dessert_shop", "tea_house",
    "acai_shop", "confectionery", "deli", "food_court",
}
BAR_TYPES = {"bar", "sports_bar", "cocktail_bar", "wine_bar", "pub", "bar_and_grill", "lounge_bar"}
MEALS = ("servesBreakfast", "servesBrunch", "servesLunch", "servesDinner")
DRINKS = ("servesBeer", "servesWine", "servesCocktails")


def classify_service(*, area_m2, tag=None, name_counter=False, google=None, price=None):
    """Counter or table service, and the tier, from what is known of a venue.

    How big and how complex its menu is (Google's meal periods, drinks and dessert are the
    nearest published measure: a place that does breakfast to dinner with a bar is a kitchen
    that seats you), how big its room is (a large restaurant seats you even if it is cheap),
    whether it takes reservations, what Google calls it, and its price. Each signal is scored;
    the record keeps every one, so a classification can be read back. Not observed service.
    """
    g = google or {}
    level = (price or {}).get("price_level")
    spend = (price or {}).get("average_spend_per_person")
    meals = sum(bool(g.get(k)) for k in MEALS)
    drinks = sum(bool(g.get(k)) for k in DRINKS)
    breadth = meals + drinks + bool(g.get("servesDessert"))
    kind = g.get("primaryType") or ""
    table, counter, why = 0, 0, []

    def add(side, points, reason):
        nonlocal table, counter
        if side == "table":
            table += points
        else:
            counter += points
        why.append(f"{side} +{points}: {reason}")

    if g.get("reservable"):
        add("table", 3, "takes reservations")
    if breadth >= 5:
        add("table", 2, f"broad menu ({meals} meal periods, {drinks} kinds of drink)")
    elif breadth >= 3:
        add("table", 1, f"mid-sized menu ({meals} meal periods, {drinks} kinds of drink)")
    if g.get("servesCocktails"):
        add("table", 1, "a full bar")
    if area_m2 >= 220:
        add("table", 2, f"a large room ({area_m2:.0f} m²)")
    elif area_m2 >= 150:
        add("table", 1, f"a mid-sized room ({area_m2:.0f} m²)")
    if level and level >= 3:
        add("table", 2, "price level " + "$" * level)
    elif level == 2:
        add("table", 1, "price level $$")
    if kind in COUNTER_TYPES:
        add("counter", 3, f"Google lists it as {kind}")
    elif kind == "pizza_restaurant":
        add("counter", 1, "a pizzeria")
    if g.get("dineIn") is False:
        add("counter", 4, "no dine-in")
    if name_counter:
        add("counter", 1 if g else 2, "its name reads as a counter place")
    if tag in {"cafe", "fast_food", "bakery"}:
        add("counter", 1, f"mapped as {tag}")
    bar = kind in BAR_TYPES or tag == "bar"
    if area_m2 < 60 or g.get("dineIn") is False:
        # A tenancy too small to seat anyone, or a takeaway Google says has no dine-in.
        mode = "pickup"
        why.append(f"pickup: a {area_m2:.0f} m² tenancy" if area_m2 < 60 else "pickup: takeaway only")
    elif table > counter or (table == counter and area_m2 >= 150):
        mode = "auto"
    else:
        mode = "counter"
    if mode != "auto":
        tier = "counter"
    elif (level and level >= 3) or (level == 2 and (spend or 0) >= 50 and g.get("reservable")):
        tier = "dining"
    else:
        tier = "casual"
    return {
        "service_mode": mode,
        "tier": tier,
        "bar": bar,
        "table_score": table,
        "counter_score": counter,
        "menu_breadth": breadth,
        "signals": why,
        "basis": "Google service flags, price, room size and listing; not observed service",
    }
