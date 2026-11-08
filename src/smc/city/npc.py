"""The simulated population that keeps a district's economy running when players are away.

Each NPC has a role (``params.ROLE_ALLOCATION``: the V2 design's 1,000 per district), a home, a
workplace for its role, a bank account, a daily budget and a schedule of activities. The whole
population is simulated by schedule -- cheaply, every NPC every step -- and only those near a
player are given a body that walks the streets (``agents``). Moving between places costs them
the time the walk would take either way.

What they do changes the world through the same systems players use: wages are paid by their
employer (minted for an NPC-run employer, transferred from a player business's account), meals
and goods are bought from businesses' stock with sales tax to the treasury, and rent goes to
the landlord. Spending is a share of income, so NPC demand -- and so the passive income it can
give anyone -- is capped by the district's population.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from smc.city.params import DAILY_WAGE, NPC_SPEND_SHARE, RESIDENT_INCOME, ROLE_ALLOCATION

#: Where each role works (place uses, in order of preference).
WORKPLACE = {
    "retail_worker": ("retail", "restaurant", "commercial"),
    "office_worker": ("office", "commercial"),
    "logistics_worker": ("industrial", "parking", "retail"),
    "construction_worker": ("industrial", "office", "residential"),
    "transport_worker": ("parking", "industrial", "commercial"),
    "police": ("civic",),
    "government_worker": ("civic", "office"),
    "student": ("school", "civic"),
    "resident": (),
}
#: A role's shift start (hour) and its alternative, and its length in hours.
SHIFTS = {
    "retail_worker": ((10, 15), 7),
    "office_worker": ((9, 8), 8),
    "logistics_worker": ((7, 14), 8),
    "construction_worker": ((7, 7), 8),
    "transport_worker": ((6, 14), 8),
    "police": ((8, 16), 8),
    "government_worker": ((9, 9), 8),
    "student": ((8.5, 8.5), 6.5),
}


@dataclass(frozen=True)
class Place:
    id: str
    use: str
    node: int
    x: float
    y: float
    #: the business or institution account trading or employing here, if any
    account: str | None = None
    #: the zoning district it stands in, for permits
    district: str | None = None
    landlord: str | None = None


@dataclass(frozen=True)
class Activity:
    start_min: int   # minutes after midnight
    kind: str        # home | work | school | shop | eat | leisure | patrol
    place: str       # a Place id


@dataclass
class NPC:
    id: str
    role: str
    home: Place
    work: Place | None
    account: str
    schedule: list[Activity]
    daily_income: int
    budget_left: int = 0
    at: str = ""                 # the Place id it is at (or heading to)
    arrive_at: float = 0.0       # when it gets there; before that it is travelling
    current: int = -1            # index into the schedule
    agent: str | None = None     # the walking body, while near a player

    @property
    def employer(self) -> str | None:
        return self.work.account if self.work and self.role != "student" else None


def _minutes(hour: float, rng: random.Random, spread: int = 20) -> int:
    return max(0, min(24 * 60 - 1, int(hour * 60) + rng.randint(-spread, spread)))


def schedule_for(role: str, home: Place, work: Place | None, near: dict[str, list[Place]],
                 rng: random.Random) -> list[Activity]:
    """A day: shifts for the employed, school for students, errands and meals for everyone."""
    day = [Activity(0, "home", home.id)]
    pick = lambda use: rng.choice(near[use]).id if near.get(use) else None  # noqa: E731
    if role in SHIFTS and work is not None:
        (first, second), hours = SHIFTS[role]
        start = first if rng.random() < 0.6 else second
        kind = "school" if role == "student" else "patrol" if role == "police" else "work"
        day.append(Activity(_minutes(start, rng), kind, work.id))
        if hours >= 7 and (meal := pick("restaurant")):
            day.append(Activity(_minutes(start + hours / 2, rng, 15), "eat", meal))
            day.append(Activity(_minutes(start + hours / 2 + 0.75, rng, 5), kind, work.id))
        end = start + hours
        if rng.random() < 0.45 and (shop := pick("retail")):
            day.append(Activity(_minutes(end + 0.25, rng, 10), "shop", shop))
    else:
        if shop := pick("retail"):
            day.append(Activity(_minutes(10.5, rng, 60), "shop", shop))
        if rng.random() < 0.6 and (meal := pick("restaurant")):
            day.append(Activity(_minutes(12.75, rng, 40), "eat", meal))
        if rng.random() < 0.5:
            day.append(Activity(_minutes(15.5, rng, 60), "leisure", home.id))
        end = 17.0
    if rng.random() < 0.25 and (meal := pick("restaurant")):
        day.append(Activity(_minutes(min(end + 1.5, 21.0), rng, 30), "eat", meal))
    day.append(Activity(_minutes(min(end + 3.0, 22.5), rng, 30), "home", home.id))
    day.sort(key=lambda a: a.start_min)
    # Strictly increasing times: two errands planned for one minute happen one after the other.
    out: list[Activity] = []
    for a in day:
        start = a.start_min if not out else max(a.start_min, out[-1].start_min + 1)
        out.append(Activity(start, a.kind, a.place))
    return out


@dataclass
class Population:
    npcs: list[NPC] = field(default_factory=list)

    def by_role(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for n in self.npcs:
            counts[n.role] = counts.get(n.role, 0) + 1
        return counts


def generate_population(places: list[Place], *, size: int = 1_000, seed: int = 0,
                        local_places: int = 6) -> Population:
    """``size`` NPCs in the role shares of the V2 design, housed and employed in ``places``."""
    rng = random.Random(seed)
    by_use: dict[str, list[Place]] = {}
    for p in places:
        by_use.setdefault(p.use, []).append(p)
    homes = by_use.get("residential") or places
    scale = size / sum(ROLE_ALLOCATION.values())
    roles: list[str] = []
    for role, count in ROLE_ALLOCATION.items():
        roles += [role] * round(count * scale)
    roles = (roles + ["resident"] * size)[:size]
    rng.shuffle(roles)

    def nearest(use: str, home: Place) -> list[Place]:
        options = by_use.get(use) or []
        if len(options) <= local_places:
            return options
        sample = rng.sample(options, min(len(options), 60))
        sample.sort(key=lambda p: (p.x - home.x) ** 2 + (p.y - home.y) ** 2)
        return sample[:local_places]

    population = Population()
    for i, role in enumerate(roles):
        home = rng.choice(homes)
        work = None
        for use in WORKPLACE[role]:
            if by_use.get(use):
                work = rng.choice(nearest(use, home))
                break
        near = {use: nearest(use, work or home) for use in ("restaurant", "retail")}
        income = DAILY_WAGE.get(role, 0) or (RESIDENT_INCOME if role in ("resident", "student") else 0)
        if role == "student":
            income = RESIDENT_INCOME // 3
        npc = NPC(f"npc:{i:05d}", role, home, work if role != "resident" else None, f"npc:{i:05d}",
                  schedule_for(role, home, work if role != "resident" else None, near, rng), income)
        npc.at = home.id
        population.npcs.append(npc)
    return population


def daily_budget(npc: NPC) -> int:
    return round(npc.daily_income * NPC_SPEND_SHARE)
