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
    if service_mode in {"counter", "pickup"} or (spend is not None and spend < 20):
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
