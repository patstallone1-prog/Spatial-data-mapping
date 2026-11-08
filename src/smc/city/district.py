"""A district's world, made from the region data the viewer draws.

The streets become the movement graph; each building becomes a place (a home, a workplace, a
shop, a restaurant) at its nearest street; its city parcel (``blklot``) and the building on it go
into the property records, owned at first by NPC landlords -- players buy from them, nothing
is claimed by arriving first; each zoning district the buildings stand in becomes a zoning
rule in the city's planning law; and every shop the map records becomes a business with a till,
stock and shelf prices. Jurisdictions are the Bay Area region, the county and the city.
"""

from __future__ import annotations

import json
import zlib
from pathlib import Path

from smc.city.currency import money
from smc.city.law import Jurisdiction, LawBook, Rule
from smc.city.npc import Place
from smc.city.streets import StreetGraph, graph_from_payload, grid_graph
from smc.city.world import World

#: Building archetype -> what the place is used for.
USE_BY_ARCHETYPE = {
    "residential": "residential", "generic": "residential", "office": "office", "restaurant": "restaurant",
    "retail": "retail", "gas_station": "retail", "hotel": "commercial", "civic": "civic", "school": "school",
    "parking": "parking", "industrial": "industrial", "park": "open_space",
}
#: Share of "generic" buildings that are really shops or offices at street level.
LANDLORDS = 40


def zoning_rule(district: str) -> Rule:
    """A planning-code district name as permitted uses and limits (first approximation)."""
    name = district.upper()
    if name.startswith("RESIDENTIAL- HOUSE"):
        value = {"uses": ["residential"], "max_height_m": 12, "max_floors": 3}
    elif name.startswith("RESIDENTIAL- MIXED") or "TRANSIT ORIENTED" in name:
        value = {"uses": ["residential", "commercial"], "max_height_m": 20, "max_floors": 6}
    elif name.startswith("RESIDENTIAL- COMMERCIAL"):
        value = {"uses": ["residential", "commercial"], "max_height_m": 40, "max_floors": 12}
    elif name.startswith("DOWNTOWN"):
        value = {"uses": ["commercial", "residential", "civic"], "max_height_m": 260, "max_floors": 70}
    elif name.startswith("PUBLIC"):
        value = {"uses": ["civic", "open_space"], "max_height_m": 40, "max_floors": 10}
    elif "INDUSTRIAL" in name or "PRODUCTION" in name or name.startswith("PDR"):
        value = {"uses": ["industrial", "commercial"], "max_height_m": 20, "max_floors": 4}
    else:
        value = {"uses": ["residential", "commercial"], "max_height_m": 20, "max_floors": 6}
    return Rule("zoning", district, value)


def bay_area_laws(city: str = "city:san-francisco", county: str = "county:san-francisco") -> LawBook:
    book = LawBook()
    book.add_jurisdiction(Jurisdiction("region:bay-area", "Bay Area", "region"))
    book.add_jurisdiction(Jurisdiction(county, county.split(":")[1].replace("-", " ").title() + " County", "county",
                                       "region:bay-area"))
    book.add_jurisdiction(Jurisdiction(city, city.split(":")[1].replace("-", " ").title(), "city", county))
    return book


def _landlord(key: str) -> str:
    return f"npc:landlord:{zlib.crc32(key.encode()) % LANDLORDS:02d}"


def places_from_payload(payload: dict, graph: StreetGraph, city: str) -> tuple[list[Place], dict[str, dict]]:
    """Each building as a place at its nearest walkable street node, and its parcel record."""
    places: list[Place] = []
    parcels: dict[str, dict] = {}
    treasury = f"treasury:{city}"
    for way in payload.get("ways", ()):
        if way.get("kind") != "building" or not way.get("centroid"):
            continue
        x, y = graph.to_xy(*way["centroid"])
        node = graph.nearest(x, y, mode="walk", reach_m=150)
        if node is None:
            continue
        use = USE_BY_ARCHETYPE.get(way.get("archetype") or "generic", "residential")
        if use == "residential" and way.get("shops"):
            use = "restaurant" if any(s.get("t") in ("restaurant", "cafe", "bar", "fast_food")
                                      for s in way["shops"]) else "retail"
        pid = f"b{way['osm_id']}"
        account = (treasury if use == "civic" else f"business:{pid}" if use in ("retail", "restaurant", "office",
                                                                             "industrial", "parking", "commercial")
                   else None)
        district = (way.get("zoning") or {}).get("district")
        blklot = (way.get("parcel") or {}).get("blklot")
        landlord = _landlord(blklot or pid)
        places.append(Place(pid, use, node, x, y, account, district, landlord))
        if blklot:
            parcels.setdefault(blklot, {"buildings": [], "district": district, "landlord": landlord,
                                        "neighbourhood": (way.get("parcel") or {}).get("analysis_neighborhood")})
            parcels[blklot]["buildings"].append((pid, way.get("height_m"), use, way.get("name")))
    return places, parcels


def assessed_value(height_m: float | None, use: str) -> int:
    floors = max(1, round((height_m or 6) / 3.2))
    per_floor = {"residential": 120_000, "commercial": 180_000, "office": 220_000}.get(use, 150_000)
    return money(per_floor * floors)


def world_from_payload(payload: dict, *, city: str = "city:san-francisco", seed: int = 0,
                       npcs: int = 1_000) -> World:
    graph = graph_from_payload(payload)
    places, parcels = places_from_payload(payload, graph, city)
    laws = bay_area_laws(city)
    districts = sorted({p.district for p in places if p.district})
    if districts:
        laws.enact("planning-code", city, "Planning Code: zoning districts",
                   "Permitted uses and height limits by zoning district, as mapped.",
                   [zoning_rule(d) for d in districts], effective_at=0, enacted_by="npc:administration")
    world = World(graph, places, laws, city, seed=seed, npc_count=npcs)
    for blklot, parcel in parcels.items():
        world.registry.register(f"parcel:{blklot}", "parcel", parcel["landlord"], at=0, district=parcel["district"],
                                neighbourhood=parcel["neighbourhood"])
        for pid, height, use, name in parcel["buildings"]:
            if f"building:{pid}" not in world.registry.assets:
                world.registry.register(f"building:{pid}", "building", parcel["landlord"], at=0, parcel=blklot,
                                        height_m=height, use=use, name=name, assessed=assessed_value(height, use))
    return world


def load_district(path: Path, **kwargs) -> World:
    return world_from_payload(json.loads(Path(path).read_text(encoding="utf-8")), **kwargs)


def synthetic_district(*, seed: int = 0, npcs: int = 200, blocks: int = 6) -> World:
    """A small synthetic district on a street grid: homes, shops, restaurants, offices, a station."""
    graph = grid_graph(blocks)
    city = "city:testville"
    uses = ["residential"] * 6 + ["retail", "restaurant", "office", "residential"]
    places = []
    for i in range(blocks):
        for j in range(blocks):
            x, y = i * 100 + 50, j * 100 + 50
            node = graph.nearest(x, y, mode="walk")
            use = "civic" if (i, j) == (0, 0) else "school" if (i, j) == (blocks - 1, 0) else uses[(i * 7 + j * 3) % 10]
            pid = f"t{i}{j}"
            account = (f"treasury:{city}" if use == "civic" else f"business:{pid}"
                       if use in ("retail", "restaurant", "office") else None)
            places.append(Place(pid, use, node, x, y, account, "RESIDENTIAL- MIXED, LOW DENSITY", _landlord(pid)))
    laws = bay_area_laws(city, "county:testcounty")
    laws.enact("planning-code", city, "Planning Code", "Mixed use everywhere.",
               [zoning_rule("RESIDENTIAL- MIXED, LOW DENSITY")], effective_at=0, enacted_by="npc:administration")
    world = World(graph, places, laws, city, seed=seed, npc_count=npcs)
    for p in places:
        world.registry.register(f"parcel:{p.id}", "parcel", p.landlord, at=0, district=p.district)
        world.registry.register(f"building:{p.id}", "building", p.landlord, at=0, parcel=p.id, use=p.use,
                                height_m=9.0, assessed=assessed_value(9.0, p.use))
    return world
