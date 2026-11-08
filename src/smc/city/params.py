"""Balancing parameters from the V2 design: starting conditions, prices, wages, populations.

These are first numbers to balance against, not predictions of a mature economy. They live in
one place so balancing never means hunting through the simulation.
"""

from __future__ import annotations

from smc.city.currency import money

# ---- a new player -------------------------------------------------------------------------
#: Starting balance, granted once (minted: "starter_grant").
STARTING_BALANCE = money(2_000)
#: A basic NPC job: so much per ten minutes of active work.
STARTER_JOB_PAY = money(120)
STARTER_JOB_PERIOD_S = 600

# ---- prices -------------------------------------------------------------------------------
PRICES = {
    "bus_trip": money(15),
    "simple_meal": money(35),
    "clothing_item": money(250),        # 100-500
    "apartment_rent_week": money(1_200),  # 800-2,000
    "used_economy_car": money(8_000),
    "new_economy_car": money(22_000),
    "storefront_lease_week": money(3_000),
    "small_plot": money(40_000),
    "basic_house_construction": money(60_000),
    "large_commercial_building": money(250_000),
    "fuel_per_litre": money(2),
    "electricity_per_kwh": money("0.40"),
}

# ---- the simulated population of a district -----------------------------------------------
#: Primary occupations of a representative district's 1,000 NPC residents.
ROLE_ALLOCATION = {
    "resident": 420,
    "retail_worker": 130,
    "office_worker": 130,
    "logistics_worker": 75,
    "construction_worker": 55,
    "transport_worker": 35,
    "police": 35,
    "government_worker": 25,
    "student": 95,
}
assert sum(ROLE_ALLOCATION.values()) == 1_000

#: Daily wage by occupation (an eight-hour shift), paid at the end of the shift.
DAILY_WAGE = {
    "retail_worker": money(140),
    "office_worker": money(220),
    "logistics_worker": money(170),
    "construction_worker": money(200),
    "transport_worker": money(170),
    "police": money(210),
    "government_worker": money(190),
    "resident": 0,
    "student": 0,
}
#: What an NPC resident without a job lives on (pension, benefits, work off the map), daily.
RESIDENT_INCOME = money(90)
#: Share of an NPC's daily income it spends in the district, the cap on NPC demand.
NPC_SPEND_SHARE = 0.55

# ---- what is moving near a player ----------------------------------------------------------
ACTIVE_RADIUS_M = 600.0
ACTIVE_PEDESTRIANS = (40, 100)
ACTIVE_VEHICLES = (15, 35)

# ---- government ---------------------------------------------------------------------------
TERM_DAYS = 14
VOTER_RESIDENCY_DAYS = 7
COUNCIL_SEATS = 5
#: An election below this many eligible active voters leaves the NPC administration in place.
MIN_ELECTORATE = 10
