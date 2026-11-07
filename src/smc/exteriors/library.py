"""Curated qualitative references, exact brand assets and conservative category matching."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from functools import lru_cache
from importlib.resources import files


def normal(text):
    text = unicodedata.normalize("NFKD", str(text or "")).casefold()
    return re.sub(r"[^a-z0-9]+", " ", text.replace("'", "").replace("\u2019", "")).strip()


@lru_cache(maxsize=1)
def library():
    data = json.loads(files("smc.exteriors").joinpath("references.json").read_text())
    ids = {r["id"] for r in data["sources"]}
    for row in [
        *data["categories"].values(),
        *data["brands"].values(),
        *data.get("station_brands", {}).values(),
    ]:
        if not row["references"] or not set(row["references"]) <= ids:
            raise ValueError("exterior profile has missing reference evidence")
    return data


def fraction(identity, salt):
    return int(hashlib.sha256(f"{identity}|{salt}".encode()).hexdigest()[:12], 16) / 16**12


def category(value, tags=None):
    data = library()
    if tags and value in {"shop", "generic", "restaurant", "pharmacy", "grocery", "residential"}:
        raw = " ".join(
            str(tags.get(k, ""))
            for k in (
                "amenity",
                "shop",
                "office",
                "healthcare",
                "social_facility",
                "social_facility:for",
                "tourism",
                "cuisine",
            )
        )
        detailed = category(raw)
        if detailed != "shop":
            return detailed
    if value in {"car", "cars"}:
        return "car_dealership"
    if value in data["categories"]:
        return value
    tags = tags or {}
    words = normal(str(value or "")).split()
    rules = [
        ("senior_living", {"nursing", "retirement", "elderly", "assisted", "senior"}),
        ("clinic", {"clinic", "medical", "doctors", "dentist", "dental", "veterinary"}),
        ("office", {"office", "lawyer", "lawyers", "accountant", "insurance", "consulting"}),
        ("school", {"school", "university", "college", "kindergarten"}),
        ("civic", {"government", "library", "civic", "community", "townhall"}),
        ("hotel", {"hotel", "motel", "hostel", "lodging"}),
        ("car_dealership", {"dealership", "automotive_sales"}),
        ("industrial", {"industrial", "warehouse", "workshop", "repair", "storage"}),
        ("diner", {"diner"}),
        ("pizza", {"pizza", "pizzeria"}),
        ("cafe", {"cafe", "coffee", "coffeehouse", "tea", "boba"}),
        ("bakery", {"bakery", "bakeries", "pastry", "bagel", "donut"}),
        ("bar", {"bar", "pub", "nightclub", "brewery", "cocktail", "lounge"}),
        ("fast_food", {"fast", "takeaway", "sandwich", "burger"}),
        ("restaurant", {"restaurant", "bistro", "sushi", "taqueria", "food"}),
        ("corner_store", {"convenience", "liquor", "corner", "kiosk", "newsagent", "tobacco"}),
        ("grocery", {"grocery", "supermarket", "market", "greengrocer", "butcher", "deli"}),
        ("pharmacy", {"pharmacy", "chemist", "drugstore"}),
        ("bank", {"bank", "credit", "financial"}),
        ("laundry", {"laundry", "laundromat", "cleaning", "cleaners"}),
        ("jewelry", {"jewelry", "jewellery", "jeweler", "jeweller"}),
        ("barber", {"barber", "barbershop", "barbers"}),
        ("salon", {"salon", "beauty", "hairdresser", "nail", "barber", "spa"}),
        ("books", {"books", "bookstore", "bookshop", "stationery", "gallery", "music"}),
        ("hardware", {"hardware", "doityourself", "locksmith", "bicycle", "electronics"}),
        ("florist", {"florist", "flowers", "flower", "garden"}),
        ("clothing", {"clothes", "clothing", "boutique", "shoes", "jewelry", "fashion"}),
    ]
    return next((key for key, terms in rules if terms & set(words)), "shop")


def brand_for(name, explicit=None):
    brands = library()["brands"]
    if explicit in brands:
        return explicit
    wanted = normal(explicit or name)
    # No substring matches: 'Subway Electronics' is not a sandwich franchise.
    return next(
        (key for key, row in brands.items() if wanted in {normal(a) for a in row["aliases"]}),
        None,
    )


def economics(tenant, family):
    valid = ("budget", "standard", "premium", "luxury")
    if tenant.get("fitout_tier") in valid:
        return {"tier": tenant["fitout_tier"], "basis": "caller supplied fitout tier"}
    spend = tenant.get("average_spend_per_person")
    if spend is not None and family == "hospitality":
        if tenant.get("currency", "USD") != "USD" or not isinstance(spend, (float, int)):
            raise ValueError("exterior restaurant economics need a numeric USD spend")
        if not 0 < spend < 10000:
            raise ValueError("invalid exterior restaurant spend")
        tier = valid[sum(spend >= n for n in (20, 45, 90))]
        return {
            "tier": tier,
            "basis": "USD spend prior, not observed building quality",
            "usd": spend,
        }
    level = tenant.get("price_level")
    if type(level) is int and 1 <= level <= 4:
        return {"tier": valid[level - 1], "basis": "caller price-level prior", "price_level": level}
    return {"tier": "standard", "basis": "unknown economics; neutral prior"}
