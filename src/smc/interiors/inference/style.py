"""Stable house palettes and explicit, configurable economic proxies.

Neighbourhood sales value is a weak furnishing-budget proxy, not an observation of wealth.
The caller supplies it; an absent value stays absent in provenance.
"""

from __future__ import annotations

from smc.interiors.inference.model import seed_for

PALETTES = (
    {
        "id": "warm_oak",
        "name": "Warm oak & sage",
        "style": "contemporary",
        "walls": ["#eee7dc", "#d8dfd0", "#e2d4c5", "#e7e2dc"],
        "wood": "#a47a50",
        "fabric": "#a8aa98",
        "accent": "#61735f",
        "metal": "#3e4441",
        "stone": "#ded8cb",
    },
    {
        "id": "coastal",
        "name": "Coastal linen & blue",
        "style": "contemporary",
        "walls": ["#efece3", "#d8e4e6", "#dfd9cf", "#e5e8df"],
        "wood": "#b79a73",
        "fabric": "#d5cbbb",
        "accent": "#617e90",
        "metal": "#4a5358",
        "stone": "#e3e0d6",
    },
    {
        "id": "heritage",
        "name": "Walnut & muted terracotta",
        "style": "traditional",
        "walls": ["#eee4d5", "#d9bcb0", "#c8d0bd", "#e4d8c9"],
        "wood": "#71503d",
        "fabric": "#b7a18e",
        "accent": "#8f5f49",
        "metal": "#756451",
        "stone": "#d5c7b5",
    },
    {
        "id": "city",
        "name": "Ash & slate",
        "style": "contemporary",
        "walls": ["#e8e5df", "#cbd4d8", "#d8d0c5", "#dddcd1"],
        "wood": "#9d8971",
        "fabric": "#939b9f",
        "accent": "#596d74",
        "metal": "#373c41",
        "stone": "#cccac5",
    },
)


def house_style(house_id: str, area_m2: float, price_per_sqft: float | None) -> dict:
    palette = dict(PALETTES[seed_for(house_id) % len(PALETTES)])
    # No live valuation is fetched or invented. Configurable explicit input in USD / ft².
    tier = (
        "standard"
        if price_per_sqft is None
        else (
            "economy"
            if price_per_sqft < 300
            else "premium"
            if price_per_sqft >= 850
            else "standard"
        )
    )
    rate = {"economy": 85, "standard": 155, "premium": 270}[tier]
    return {
        **palette,
        "tier": tier,
        "furnishing_budget_usd": round(area_m2 * rate),
        "budget_method": "floor area x configurable tier allowance; illustrative, not a quote",
        "neighborhood_price_per_sqft": price_per_sqft,
        "economic_evidence": "caller supplied proxy" if price_per_sqft else "unspecified",
        "seed": str(seed_for(house_id)),
        "version": 1,
    }


def room_materials(style: dict, kind: str, index: int) -> dict:
    wet = kind in {"full_bathroom", "toilet", "kitchen", "utility"}
    return {
        "wall": style["walls"][index % len(style["walls"])],
        "accent_wall": style["accent"],
        "trim": "#f0ece4",
        "wood": style["wood"],
        "fabric": style["fabric"],
        "metal": style["metal"],
        "countertop": style["stone"],
        "floor": style["stone"] if wet else style["wood"],
        "floor_finish": "tile" if wet else "timber",
        "roughness": 0.62 if wet else 0.74,
    }
