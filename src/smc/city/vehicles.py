"""Vehicles: what can be bought, who owns which, where it is parked, and the NPC traffic.

A vehicle is an asset in the property registry like a building is -- sold, lent, stolen,
impounded and seized by the same records. Players start without one; a dealership (an NPC
business) sells new ones and players sell used ones to each other. Driving burns fuel or
charge (paid for, and leaving the economy as an external purchase), and parking costs what the
law in force sets.

NPC traffic -- private cars, taxis, buses, vans, trucks, patrol cars -- is owned by NPC fleet
accounts, so it obeys the same law and could be stopped, impounded or hit like anything else.
Near players it is spawned as moving agents at a density that follows the time of day.
"""

from __future__ import annotations

import itertools
import math
import random
from dataclasses import dataclass, field

from smc.city.currency import money
from smc.city.params import PRICES
from smc.city.property import Asset, PropertyError, Registry


@dataclass(frozen=True)
class VehicleModel:
    id: str
    name: str
    kind: str  # car | van | truck | bus | taxi | police | ev
    price_new: int
    seats: int
    cargo_kg: int
    #: litres (or kWh for an EV) per 100 km
    use_per_100km: float
    electric: bool = False
    #: its own top speed in town, m/s (a bus is slower than the limit on an arterial)
    cruise_ms: float | None = None


CATALOGUE: dict[str, VehicleModel] = {m.id: m for m in (
    VehicleModel("economy", "Economy hatchback", "car", PRICES["new_economy_car"], 5, 300, 6.5),
    VehicleModel("compact_ev", "Compact EV", "ev", money(27_000), 5, 300, 16.0, electric=True),
    VehicleModel("sedan", "Family sedan", "car", money(31_000), 5, 450, 7.5),
    VehicleModel("delivery_van", "Delivery van", "van", money(38_000), 2, 1_400, 10.5),
    VehicleModel("box_truck", "Box truck", "truck", money(64_000), 3, 4_500, 18.0, cruise_ms=11.0),
    VehicleModel("taxi", "Taxi", "taxi", money(29_000), 4, 300, 7.0),
    VehicleModel("bus", "City bus", "bus", money(420_000), 60, 0, 45.0, cruise_ms=10.0),
    VehicleModel("patrol", "Patrol car", "police", money(48_000), 4, 200, 11.0),
)}
#: A used car sells at this share of its new price (before condition).
USED_SHARE = PRICES["used_economy_car"] / PRICES["new_economy_car"]


def register_vehicle(registry: Registry, vehicle_id: str, model: str, owner: str, *, at: float = 0.0,
                     condition: float = 1.0, parked_at: int | None = None) -> Asset:
    spec = CATALOGUE[model]
    return registry.register(vehicle_id, "vehicle", owner, at=at, model=model, condition=condition,
                             fuel=1.0, odometer_km=0.0, parked_at=parked_at, electric=spec.electric)


def used_price(asset: Asset) -> int:
    spec = CATALOGUE[asset.attrs["model"]]
    wear = max(0.2, 1.0 - asset.attrs.get("odometer_km", 0.0) / 300_000.0)
    return round(spec.price_new * USED_SHARE * wear * asset.attrs.get("condition", 1.0) / 100) * 100


def fuel_cost(asset: Asset, km: float) -> int:
    spec = CATALOGUE[asset.attrs["model"]]
    unit = PRICES["electricity_per_kwh"] if spec.electric else PRICES["fuel_per_litre"]
    return round(spec.use_per_100km * km / 100.0 * unit)


def require_driver(registry: Registry, vehicle_id: str, driver: str) -> Asset:
    """Only whoever holds a vehicle -- its owner, a lessee, a borrower (or a thief) -- can drive it."""
    asset = registry.get(vehicle_id)
    if asset.kind != "vehicle":
        raise PropertyError(f"{vehicle_id} is not a vehicle")
    if asset.possessor != driver:
        raise PropertyError(f"{driver} does not have the keys to {vehicle_id}")
    if asset.custody == "impounded":
        raise PropertyError(f"{vehicle_id} is impounded")
    return asset


@dataclass
class ParkingLot:
    id: str
    node: int
    capacity: int
    zone: str = "lot"  # the parking-fee key in the law
    parked: set[str] = field(default_factory=set)

    @property
    def free(self) -> int:
        return self.capacity - len(self.parked)


#: Share of the active-vehicle cap on the road by hour of the day (rush hours high, night low).
TRAFFIC_BY_HOUR = [0.15, 0.1, 0.08, 0.08, 0.12, 0.25, 0.55, 0.9, 1.0, 0.8, 0.65, 0.65,
                   0.7, 0.65, 0.65, 0.75, 0.9, 1.0, 0.9, 0.7, 0.55, 0.45, 0.35, 0.25]
#: What NPC traffic is made of.
TRAFFIC_MIX = [("economy", 0.42), ("sedan", 0.18), ("compact_ev", 0.1), ("taxi", 0.1),
               ("delivery_van", 0.12), ("box_truck", 0.04), ("bus", 0.03), ("patrol", 0.01)]


def traffic_target(hour: float, cap: int) -> int:
    h = int(hour) % 24
    return max(0, round(cap * TRAFFIC_BY_HOUR[h]))


def pick_model(rng: random.Random) -> str:
    r, acc = rng.random(), 0.0
    for model, share in TRAFFIC_MIX:
        acc += share
        if r <= acc:
            return model
    return TRAFFIC_MIX[0][0]


def distance_km(route: list[int], xy: list[tuple[float, float]]) -> float:
    return sum(math.dist(xy[a], xy[b]) for a, b in itertools.pairwise(route)) / 1000.0
