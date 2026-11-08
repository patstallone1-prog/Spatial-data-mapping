"""The living city's rules read in Python (smc.city.rules) agree with the viewer's figures.

The numbers here are the ones tests/city.test.mjs checks in JavaScript, so both sides of
docs/city/rules.json are held to the same answers.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from smc.city import rules as cr

R = cr.default_rules()
SF = ["city:san-francisco", "county:san-francisco", "state:california", "nation:united-states"]
WED_8 = int(datetime(2026, 11, 4, 16, 0, tzinfo=UTC).timestamp() * 1000)  # 08:00 in San Francisco
M = R["unit"]


def test_prices_on_the_visions_scale() -> None:
    assert R["start"]["room_rent_per_day"] * 7 == 840 * M
    assert R["items"]["meal"]["price"] == 35 * M
    assert R["transit"]["bus_fare"] == 15 * M
    assert R["jobs"]["roles"]["laundry_attendant"]["pay"] == 720 * M


def test_taxes_match_the_viewer() -> None:
    assert cr.sales_tax(R, SF, 100 * M) == 863  # 8.625% of 100.00, the half rounded up
    assert cr.sales_tax(R, SF, 8 * M, "prepared_food") == 69
    assert cr.sales_tax(R, SF, 45 * M, "groceries") == 0
    w = cr.withholding(R, 0, 720 * M)
    assert w["federal"] == 0 and w["state"] == 0, "under the standard deductions"
    assert w["net"] == 720 * M - w["social"] - w["medicare"] - w["disability"]
    hotel = cr.item_tax(R, SF, R["items"]["hotel_night"], R["items"]["hotel_night"]["price"])
    assert hotel == round(220 * M * 0.14)


def test_the_bars_like_the_viewer() -> None:
    v = cr.new_vitals(R, WED_8)
    evening = cr.vitals_step(R, v, WED_8 + 12 * cr.HOUR_MS)
    assert evening["stamina"] == pytest.approx(90 - 12 * 4.5)
    morning = cr.vitals_step(R, evening, WED_8 + 23 * cr.HOUR_MS, home=True)
    assert morning["stamina"] > 95
    assert 18.5 < morning["strength"] < 20
    spent = cr.vitals_step(R, {**v, "stamina": 5}, WED_8 + 10 * cr.HOUR_MS)
    assert spent["stamina"] == 0 and spent["health"] < 90
    assert cr.apply_use(R, {**v, "stamina": 40}, R["items"]["meal"]["use"])["stamina"] == 80
    gym = dict(v)
    for _ in range(5):
        gym = cr.apply_use(R, gym, R["items"]["day_pass"]["use"], workout=True, day=1)
    assert gym["strength"] == 20 + R["vitals"]["strength"]["workout_daily_cap"]
    assert cr.apply_exertion(R, v, walked_m=2000, day=1)["strength"] == pytest.approx(20.7)
    assert cr.walk_factor(R, {"stamina": 5}, True) == {"factor": 0.6, "sprint": False}
    assert cr.carry_capacity(R, 20, {"backpack": 1}) - cr.carry_capacity(R, 20) == 10


def test_stores_and_tenants() -> None:
    assert "hammer" in cr.stores_at(R, ["shop:hardware"])[0]["items"]
    assert [s["kind"] for s in cr.stores_at(R, ["use:residential", "shop:cafe", "shop:salon"])] == ["cafe", "salon"]
    assert cr.tenant_kinds(R, "Mission Street Fitness") == ["gym"]
    assert cr.tenant_kinds(R, "Sutter Health Urgent Care") == ["clinic"]
    assert cr.tenant_kinds(R, "Blue Bottle Coffee") == []
    # Every item a store sells is in the catalogue, with a price.
    for store in R["stores"]["kinds"].values():
        for item in store["items"]:
            assert item in R["items"], item


def test_water_like_the_viewer() -> None:
    assert cr.water_properties(R, "brackish", lon=-122.4, lat=38.05)["salinity"] == 20
    assert cr.water_properties(R, "ocean")["density"] > cr.water_properties(R, "fresh_lake")["density"]


def test_blows_like_the_viewer() -> None:
    # A sledgehammer at strength 50 on lumber (the scale's middle is 1.0), and fists against a hammer on steel.
    assert cr.strike_energy(R, "sledgehammer", 50, "lumber") == pytest.approx(420)
    assert cr.strike_energy(R, "sledgehammer", 50, "steel") == pytest.approx(210)
    assert cr.strike_energy(R, "fists", 100, "steel") < cr.strike_energy(R, "hammer", 100, "steel")
    assert cr.strike_wear(R, 2000, 1000) == 1000, "a blow over the break energy breaks it"
    assert cr.strike_wear(R, 10, 1000) / 1000 < 0.01, "a tap does next to nothing"
    assert R["damage"]["repair_cost"]["default"] == 500 * M
    assert R["fines"]["vandalism"] == 400 * M and R["errands"]["fee_base"] == 25 * M


def test_homes_like_the_viewer() -> None:
    assert cr.home_type(R, "house", 2, 120) == "single_family"
    assert cr.home_type(R, "apartments", 1, 120) == "apartment"
    assert cr.home_type(R, "yes", 4, 600) == "apartment"
    marina = next(n for n in R["housing"]["neighbourhoods"] if n["name"] == "Marina")
    p = cr.home_prices_for(R, 1000, "single_family", marina, 1.0)
    assert 900_000 <= p["sale"] <= 2_500_000 and 3_000 <= p["rent"] <= 9_000
    t = cr.mortgage_terms(R, 1_000_000 * M)
    assert t["loan"] == 800_000 * M and t["monthly"] == pytest.approx(4952 * M, rel=0.002)
