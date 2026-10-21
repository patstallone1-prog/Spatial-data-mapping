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
        "walls": ["#dfc5a3", "#91a183", "#c58f75", "#d6b06c"],
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
        "walls": ["#d8c5a9", "#8dabad", "#71988b", "#c4947b"],
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
        "walls": ["#e0c3a4", "#b47b68", "#929d7c", "#cdb582"],
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
        "walls": ["#c6b6a5", "#80939b", "#9ca88c", "#b48d86"],
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
        "wall": style["walls"][
            {
                "living": 0,
                "kitchen": 1,
                "dining": 2,
                "toilet": 3,
                "full_bathroom": 1,
                "hallway": 0,
                "office": 2,
            }.get(kind, 1 + index % 3)
        ],
        "accent_wall": style["accent"],
        "trim": "#eadbc3",
        "ceiling": "#e6decf",
        "wall_finish": "ceramic_wainscot" if wet else "matte_plaster",
        "light_temperature_k": 3000,
        "wood": style["wood"],
        "fabric": style["fabric"],
        "metal": style["metal"],
        "countertop": style["stone"],
        "floor": style["stone"] if wet else style["wood"],
        "floor_finish": "tile" if wet else "timber",
        "roughness": 0.62 if wet else 0.74,
    }


def door_finish(style: dict, kind: str, key: str, entrance: bool = False) -> dict:
    design = (
        "glazed_entry"
        if entrance
        else "reeded_privacy"
        if kind in {"full_bathroom", "toilet"}
        else "glazed_office"
        if kind == "office"
        else "recessed_panels"
    )
    return {
        "design": design,
        "timber": style["wood"],
        "frame": style["wood"],
        "hardware": "#a68b52" if style["id"] in {"heritage", "warm_oak"} else "#505a59",
        "panel_count": 2 + seed_for(key) % 2,
        "glass": "frosted_reeded"
        if design == "reeded_privacy"
        else "clear"
        if "glazed" in design
        else None,
    }
