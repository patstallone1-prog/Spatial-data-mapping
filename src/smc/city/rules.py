"""The viewer's living-city rules (``docs/city/rules.json``), read in Python.

The viewer's world (``docs/city/core.mjs``) and this module read one file, so a tax rate, a
price or a bar's decay is written once. This module ports the pure functions the server will
need to agree with the viewer on: income and payroll tax with cumulative withholding, sales tax,
the three bars (health, stamina, strength), carrying, the stores' wares and the water classes.
``tests/test_city_rules.py`` holds both sides to the same figures as ``tests/city.test.mjs``.
"""

from __future__ import annotations

import json
import math
import re
from copy import deepcopy
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

SCHEMA = "kerbside.city_rules/1"
RULES_PATH = Path(__file__).resolve().parents[3] / "docs" / "city" / "rules.json"
HOUR_MS = 3_600_000
DAY_MS = 86_400_000

#: The keys whose numbers are amounts of money (whole units in the file, minor units once loaded).
MONEY_KEYS = frozenset({
    "balance", "room_rent_per_day", "standard_deduction", "wage_base", "additional_over", "fastrak", "invoice", "deposit",
    "low_balance", "top_up", "violation_fine", "express_no_tag_penalty", "base", "max", "meter_rate_per_hour",
    "expired_meter", "no_parking", "tow_fee", "storage_per_day", "at_100_mph", "price", "pay", "registration_fee",
    "chp_fee", "minimum_wage", "pretax_per_gallon", "state_excise_per_gallon", "federal_excise_per_gallon",
    "electric_per_kwh", "peak_per_km", "offpeak_per_km", "bus_fare", "taxi_flag", "taxi_per_km", "base_pay",
    "pay_per_km", "hospital_bill", "storefront_lease_per_week", "vandalism_fine", "fee_base", "fee_per_km",
})


def _js_round(value: float) -> int:
    """JavaScript's ``Math.round``: a half rounds up (towards positive infinity)."""
    return math.floor(value + 0.5)


def _round_half_up(value: float) -> int:
    """``roundHalfUp`` in core.mjs: a half always up, safe from float error."""
    return math.floor(value + 0.5 + 1e-7)


def load_rules(path: Path | str | None = None) -> dict[str, Any]:
    """The rules with every amount in minor units, as ``loadRules`` in core.mjs makes them."""
    raw = json.loads(Path(path or RULES_PATH).read_text(encoding="utf-8"))
    if raw.get("schema") != SCHEMA:
        raise ValueError(f"not {SCHEMA}")
    unit = 10 ** raw["currency"]["minor_units"]

    def money(amount: float) -> int:
        return _js_round(float(amount) * unit)

    rules = deepcopy(raw)

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
        elif isinstance(node, dict):
            for key, value in node.items():
                if key in MONEY_KEYS and isinstance(value, (int, float)) and not isinstance(value, bool):
                    node[key] = money(value)
                else:
                    walk(value)

    for key in ("start", "tolls", "managed_lanes", "enforcement", "items", "transit", "delivery", "business", "damage", "errands"):
        walk(rules[key])
    rules["damage"]["repair_cost"] = {k: money(v) for k, v in raw["damage"]["repair_cost"].items()}
    walk(rules["vehicles"]["models"])
    walk(rules["jobs"])
    for key in ("income", "payroll", "vehicle", "fuel"):
        walk(rules["taxes"][key])
    rules["vitals"]["health"]["hospital_bill"] = money(raw["vitals"]["health"]["hospital_bill"])
    rules["tolls"]["violation_penalties"] = [money(v) for v in raw["tolls"]["violation_penalties"]]
    for side in ("federal", "state"):
        rules["taxes"]["income"][side]["brackets"] = [[money(at), rate] for at, rate in raw["taxes"]["income"][side]["brackets"]]
    rules["fines"] = {k: money(v) for k, v in raw["fines"].items()}
    rules["unit"] = unit
    return rules


@lru_cache(maxsize=1)
def default_rules() -> dict[str, Any]:
    return load_rules()


# ---- taxes ------------------------------------------------------------------------------------


def bracket_tax(brackets: list[list[float]], income: int) -> int:
    tax = 0.0
    for i, (start, rate) in enumerate(brackets):
        end = brackets[i + 1][0] if i + 1 < len(brackets) else math.inf
        if income <= start:
            break
        tax += (min(income, end) - start) * rate
    return _js_round(tax)


def income_tax(rules: dict, wages: int) -> dict[str, int]:
    inc = rules["taxes"]["income"]
    federal = bracket_tax(inc["federal"]["brackets"], max(0, wages - inc["federal"]["standard_deduction"]))
    state = bracket_tax(inc["state"]["brackets"], max(0, wages - inc["state"]["standard_deduction"]))
    return {"federal": federal, "state": state, "total": federal + state}


def payroll_tax(rules: dict, wages: int) -> dict[str, int]:
    pay = rules["taxes"]["payroll"]
    social = _js_round(min(wages, pay["social_security"]["wage_base"]) * pay["social_security"]["rate"])
    medicare = _js_round(wages * pay["medicare"]["rate"] + max(0, wages - pay["medicare"]["additional_over"]) * pay["medicare"]["additional_rate"])
    disability = _js_round(wages * pay["state_disability"]["rate"])
    return {"social": social, "medicare": medicare, "disability": disability, "total": social + medicare + disability}


def withholding(rules: dict, ytd: int, gross: int) -> dict[str, int]:
    """What to hold back from ``gross`` when ``ytd`` was earned already (the cumulative method)."""
    a, b = income_tax(rules, ytd), income_tax(rules, ytd + gross)
    pa, pb = payroll_tax(rules, ytd), payroll_tax(rules, ytd + gross)
    out = {"federal": b["federal"] - a["federal"], "state": b["state"] - a["state"], "social": pb["social"] - pa["social"],
           "medicare": pb["medicare"] - pa["medicare"], "disability": pb["disability"] - pa["disability"]}
    out["total"] = sum(out.values())
    out["net"] = gross - out["total"]
    return out


def along(table: dict, chain: list[str], fallback: Any = None) -> Any:
    """The value for the nearest jurisdiction in ``chain`` that ``table`` has."""
    for key in chain:
        if key in table:
            return table[key]
    return fallback


def sales_rate(rules: dict, chain: list[str], laws: dict | None = None) -> float:
    sales = rules["taxes"]["sales"]
    return max(sales["state_base"], along(sales["by_jurisdiction"], chain, sales["state_base"]) + (laws or {}).get("sales_rate_add", 0))


def sales_tax(rules: dict, chain: list[str], amount: int, kind: str = "taxable", laws: dict | None = None) -> int:
    if kind in rules["taxes"]["sales"]["exempt"]:
        return 0
    return _round_half_up(amount * sales_rate(rules, chain, laws))


def item_tax(rules: dict, chain: list[str], item: dict, amount: int, laws: dict | None = None) -> int:
    if item.get("tax") == "hotel_tax":
        return _round_half_up(amount * along(rules["taxes"]["local"]["hotel_tax"], chain, 0))
    return sales_tax(rules, chain, amount, item.get("kind", "taxable"), laws)


# ---- the three bars ------------------------------------------------------------------------------


def _clamp(rules: dict, value: float) -> float:
    return max(0.0, min(float(rules["vitals"]["max"]), value))


def _in_hours(hours: list[list[float]], hour: float) -> bool:
    return any((a <= hour < b) if a <= b else (hour >= a or hour < b) for a, b in hours)


def new_vitals(rules: dict, now_ms: int) -> dict[str, Any]:
    return {**rules["vitals"]["start"], "at": now_ms, "day": None, "walked": 0, "worked_out": 0}


def vitals_step(rules: dict, vitals: dict, to_ms: int, *, home: bool = False, resting: bool = False,
                working: bool = False, away: bool = False) -> dict[str, Any]:
    """The bars lived to ``to_ms`` in quarter-hour steps by the city's clock (``vitalsStep``)."""
    spec = rules["vitals"]
    zone = ZoneInfo(rules["clock"]["zone"])
    start = vitals.get("at", to_ms)
    t = max(start, to_ms - spec["offline_catch_up_days"] * DAY_MS)
    out = dict(vitals)
    while t < to_ms:
        dt = min(HOUR_MS / 4, to_ms - t)
        h = dt / HOUR_MS
        local = datetime.fromtimestamp((t + dt / 2) / 1000, UTC).astimezone(zone)
        night = _in_hours([spec["night_hours"]], local.hour + local.minute / 60 + local.second / 3600)
        at_home = home or away
        if resting or night:
            rate = (spec["stamina"]["home_recovery_per_hour"] if night and at_home
                    else spec["stamina"]["rest_recovery_per_hour"] if resting else spec["stamina"]["night_recovery_per_hour"])
            out["stamina"] += rate * h
            if night and out["stamina"] > 0:
                out["health"] += spec["health"]["sleep_recovery_per_hour"] * h
        else:
            out["stamina"] -= (spec["stamina"]["awake_decay_per_hour"] + (spec["stamina"]["work_per_hour"] if working else 0)) * h
        out["health"] -= spec["health"]["decay_per_day"] / 24 * h
        if out["stamina"] <= 0:
            out["health"] -= spec["health"]["exhausted_loss_per_hour"] * h
        out["strength"] = max(spec["strength"]["minimum"], out["strength"] - spec["strength"]["decay_per_day"] / 24 * h)
        out["stamina"] = _clamp(rules, out["stamina"])
        out["health"] = _clamp(rules, out["health"])
        t += dt
    out["at"] = max(start, to_ms)
    return out


def apply_use(rules: dict, vitals: dict, use: dict, *, workout: bool = False, day: int | None = None) -> dict[str, Any]:
    out = dict(vitals)
    if day is not None and out.get("day") != day:
        out.update(day=day, walked=0, worked_out=0)
    for bar in ("health", "stamina"):
        if use.get(bar):
            out[bar] = _clamp(rules, out[bar] + use[bar])
    if use.get("strength"):
        room = max(0, rules["vitals"]["strength"]["workout_daily_cap"] - out.get("worked_out", 0)) if workout else use["strength"]
        gain = min(use["strength"], room)
        out["strength"] = _clamp(rules, out["strength"] + gain)
        if workout:
            out["worked_out"] = out.get("worked_out", 0) + gain
    return out


def apply_exertion(rules: dict, vitals: dict, *, walked_m: float = 0, sprint_s: float = 0, day: int | None = None) -> dict[str, Any]:
    spec = rules["vitals"]
    out = dict(vitals)
    if day is not None and out.get("day") != day:
        out.update(day=day, walked=0, worked_out=0)
    gain = min(walked_m / 1000 * spec["strength"]["walk_per_km"], max(0, spec["strength"]["walk_daily_cap"] - out.get("walked", 0)))
    out["walked"] = out.get("walked", 0) + gain
    out["strength"] = _clamp(rules, out["strength"] + gain)
    out["stamina"] = _clamp(rules, out["stamina"] - sprint_s * spec["stamina"]["sprint_per_second"])
    return out


def walk_factor(rules: dict, vitals: dict, sprinting: bool) -> dict[str, Any]:
    spec = rules["vitals"]["stamina"]
    if vitals["stamina"] < spec["low"]:
        return {"factor": spec["slow_factor"], "sprint": False}
    return {"factor": spec["sprint_factor"], "sprint": True} if sprinting else {"factor": 1, "sprint": False}


def carry_capacity(rules: dict, strength: float, inventory: dict[str, int] | None = None) -> float:
    carry = rules["vitals"]["carry"]
    extra = max((rules["items"][k].get("carry_kg", 0) for k, n in (inventory or {}).items() if n > 0 and k in rules["items"]), default=0)
    return carry["base_kg"] + strength * carry["per_strength_kg"] + extra


# ---- stores and water ---------------------------------------------------------------------------


def stores_at(rules: dict, keys: list[str] | set[str]) -> list[dict[str, Any]]:
    have = set(keys)
    return [{"kind": kind, "name": s["name"], "items": [i for i in s["items"] if i in rules["items"]]}
            for kind, s in rules["stores"]["kinds"].items() if any(k in have for k in s["at"])]


def tenant_kinds(rules: dict, name: str | None) -> list[str]:
    if not name:
        return []
    return [kind for kind, pattern in rules["stores"]["names"].items() if re.search(rf"\b({pattern})", name, re.IGNORECASE)]


def water_properties(rules: dict, cls: str, lon: float | None = None, lat: float | None = None) -> dict[str, Any]:
    water = rules["water"]
    c = water["classes"].get(cls, water["classes"]["bay"])
    salinity = c["salinity"]
    if lon is not None and lat is not None:
        for zone in water["zones"]:
            if zone["class"] != cls or "box" not in zone or "salinity" not in zone:
                continue
            w, s, e, n = zone["box"]
            if w <= lon <= e and s <= lat <= n:
                salinity = zone["salinity"]
                break
    density = water["fresh_density"] + water["density_per_salinity"] * salinity
    return {"class": cls, "name": c["name"], "salinity": salinity, "density": density, "corrosion": c["corrosion"]}


# ---- tools on things, and the housing market (docs/city/core.mjs, docs/city/market.mjs) ----------


def strike_energy(rules: dict, tool: str, strength: float, material: str, energy: float | None = None) -> float:
    """The energy a blow with ``tool`` lands on ``material`` at ``strength`` (0-100), in joules."""
    t = rules["tools"]
    spec = t["kinds"].get(tool) or t["kinds"]["fists"]
    lo, hi = t["strength_scale"]
    scale = lo + (hi - lo) * max(0.0, min(100.0, strength)) / 100
    vs = spec["vs"].get(material, spec["vs"].get("default", t["default_vs"]))
    return (energy if energy is not None else spec["energy_j"] * scale) * vs


def strike_wear(rules: dict, joules: float, break_j: float) -> float:
    """How much of a thing's break energy one blow of ``joules`` uses up: a blow well under what
    breaks it does less than its share (tapping does not break a bench)."""
    if not break_j > 0 or joules <= 0:
        return 0.0
    if joules >= break_j:
        return float(break_j)
    return joules * (joules / break_j) ** rules["tools"]["small_blow_exponent"]


def loan_payment(principal: int, rate: float, years: int) -> int:
    """A monthly payment on a fixed loan (minor units)."""
    r, n = rate / 12, years * 12
    return _js_round(principal * r / (1 - (1 + r) ** -n)) if r else _js_round(principal / n)


def home_type(rules: dict, tag: str | None, floors: int, footprint_m2: float) -> str:
    """A residential building's type: single_family or apartment, from its map tag or its size."""
    h = rules["housing"]
    if tag in h["single_family_tags"]:
        return "single_family"
    if tag in h["multi_unit_tags"]:
        return "apartment"
    return "single_family" if floors <= 2 and 0 < footprint_m2 < 190 else "apartment"


def home_prices_for(rules: dict, sqft: int, home_type_: str, hood: dict, spread: float) -> dict[str, int]:
    """Sale price and monthly rent (whole units) of a home of ``sqft`` in ``hood`` at ``spread``
    (its own condition and light; seeded per home in the viewer)."""
    h = rules["housing"]
    size = (sqft / 1000) ** h["size_exponent"]
    sale = _js_round(sqft * hood["sale_psf"] * size * spread * h["sale_type_share"][home_type_] / 1000) * 1000
    rent = _js_round(sqft * hood["rent_psf"] * size * spread * h["rent_type_share"][home_type_] / 25) * 25
    return {"sale": sale, "rent": rent}


def mortgage_terms(rules: dict, price: int) -> dict[str, Any]:
    """Buying at ``price`` (minor units) with a mortgage: down payment, closing, loan, monthly."""
    m = rules["housing"]["mortgage"]
    down, closing = _js_round(price * m["down_share"]), _js_round(price * m["closing_share"])
    loan = price - down
    return {"price": price, "down": down, "closing": closing, "loan": loan, "monthly": loan_payment(loan, m["rate"], m["years"]),
            "upfront": down + closing}
