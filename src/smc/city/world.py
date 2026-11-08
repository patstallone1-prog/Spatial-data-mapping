"""The authoritative world: one place that decides what happened.

A client shows the world and *asks*; the world decides. ``World.submit(player, command, **args)``
is the only way a player changes anything, always as themselves: it checks the command against
ownership (``property``), money (``ledger``) and the law in force (``law``), does it whole or not
at all, and answers ``{"ok": True, ...}`` or ``{"ok": False, "error": ...}`` -- it never trusts a
client's balance, position or claim to own something. ``World.step(dt)`` moves time on: the NPC
population's day, the traffic and walkers near players, wages, rent, leases running out, parking
fees, starter-job pay, and the police answering what was seen.

Persistence is ``snapshot()`` / ``World.restore``: the economic and legal records (ledger
journal, property history, goods, laws, offences, players, offers) are stored; the population
and traffic are regenerated from the district and its seed.
"""

from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from smc.city.agents import Agent, Movement
from smc.city.currency import fmt, money
from smc.city.government import Government, GovernmentError
from smc.city.law import Enforcement, LawBook, LawError, Rule
from smc.city.ledger import Ledger, LedgerError
from smc.city.npc import NPC, Place, Population, daily_budget, generate_population
from smc.city.params import (
    ACTIVE_PEDESTRIANS,
    ACTIVE_RADIUS_M,
    ACTIVE_VEHICLES,
    DAILY_WAGE,
    PRICES,
    STARTER_JOB_PAY,
    STARTER_JOB_PERIOD_S,
    STARTING_BALANCE,
)
from smc.city.property import Inventory, PropertyError, Registry
from smc.city.streets import StreetGraph
from smc.city.vehicles import (
    CATALOGUE,
    distance_km,
    fuel_cost,
    pick_model,
    register_vehicle,
    require_driver,
    traffic_target,
)

DAY_S = 86_400.0
HOUR_S = 3_600.0
#: The world's clock starts on a Monday at six in the morning (t = 0 is Monday midnight).
START_S = 6 * HOUR_S
#: Goods a business can stock, and their default shelf price.
GOODS = {"meal": PRICES["simple_meal"], "coffee": money(6), "groceries": money(28),
         "clothing": PRICES["clothing_item"]}
SELLS = {"restaurant": ("meal", "coffee"), "retail": ("groceries", "clothing")}
#: What a business pays an outside supplier for stock, as a share of its shelf price.
WHOLESALE_SHARE = 0.4
RESTOCK_BELOW, RESTOCK_TO = 10, 60
#: Share of an NPC's income that is its rent, paid daily to whoever owns its home.
NPC_RENT_SHARE = 0.3
#: An NPC landlord's or NPC-run till's daily outgoings (upkeep, the owner's draw off the map).
NPC_UPKEEP_SHARE = 0.6
#: Savings an NPC keeps, in days of income; past that it spends outside the district (the money
#: leaves), which is what keeps NPC wages from inflating the economy without limit.
NPC_SAVINGS_DAYS = 5
#: How far an NPC sees an offence from.
WITNESS_M = 45.0
#: How long a player's rented room is let for at a time, and its rent.
ROOM_TERM_S = 7 * DAY_S


class SimError(Exception):
    pass


@dataclass
class Player:
    id: str
    account: str
    x: float
    y: float
    home: str | None = None
    working_since: float | None = None
    job_paid_until: float = 0.0
    agent: str | None = None
    joined_at: float = 0.0


@dataclass
class Offer:
    id: str
    asset: str
    seller: str
    buyer: str
    price: int
    expires: float
    status: str = "open"  # open | accepted | declined | lapsed


@dataclass
class World:
    graph: StreetGraph
    places: list[Place]
    laws: LawBook
    city: str
    seed: int = 0
    npc_count: int = 1_000
    now: float = START_S
    ledger: Ledger = field(default_factory=Ledger)
    events: deque = field(default_factory=lambda: deque(maxlen=20_000))

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)
        self.registry = Registry(self.ledger)
        self.inventory = Inventory(self.ledger)
        self.enforcement = Enforcement(self.laws, self.ledger)
        self.government = Government(self.city, self.laws)
        self.treasury = self.ledger.open(self.laws.treasury(self.city), kind="treasury")
        self.place = {p.id: p for p in self.places}
        self.players: dict[str, Player] = {}
        self.offers: dict[str, Offer] = {}
        self.parked: dict[str, tuple[int, float]] = {}  # vehicle -> (node, paid until)
        self.dispatch: dict[str, tuple[str, str]] = {}   # police agent -> (offence kind, stolen asset)
        self._seq = 0
        self._last_day = int(self.now // DAY_S)
        self.movement = Movement(self.graph, self.speed_limits())
        self._open_places()
        self.population: Population = generate_population(self.places, size=self.npc_count, seed=self.seed)
        for npc in self.population.npcs:
            self.ledger.open(npc.account, kind="npc")
            self.ledger.mint(npc.account, npc.daily_income or money(20), reason="npc_income", at=self.now,
                             memo="opening balance")
            npc.budget_left = daily_budget(npc)
        self.npc = {n.id: n for n in self.population.npcs}
        self._settle_schedules()

    # ---- setup -----------------------------------------------------------------------------
    def _open_places(self) -> None:
        for p in self.places:
            if p.landlord:
                self.ledger.open(p.landlord, kind="npc")
            if not p.account:
                continue
            if p.account.startswith("treasury:"):
                self.ledger.open(p.account, kind="treasury")
                continue
            self.ledger.open(p.account, kind="business")
            if p.account not in self.registry.assets:
                self.registry.register(p.account, "business", f"npc:owner:{p.id}", at=self.now, place=p.id,
                                       use=p.use, prices={g: GOODS[g] for g in SELLS.get(p.use, ())})
                self.ledger.open(f"npc:owner:{p.id}", kind="npc")
            for good in SELLS.get(p.use, ()):
                self.inventory.add(p.account, good, RESTOCK_TO)

    def speed_limits(self) -> dict[str, float]:
        return {c: self.laws.speed_limit_ms(c, self.city, self.now)
                for c in ("motorway", "arterial", "residential", "service", "shared")}

    def _settle_schedules(self) -> None:
        minute = (self.now % DAY_S) / 60
        for npc in self.population.npcs:
            idx = max(i for i, a in enumerate(npc.schedule) if a.start_min <= minute)
            npc.current, npc.at, npc.arrive_at = idx, npc.schedule[idx].place, self.now

    def log(self, event_kind: str, /, **data: Any) -> dict:
        event = {"t": round(self.now, 1), **data, "kind": event_kind}
        self.events.append(event)
        return event

    def _id(self, prefix: str) -> str:
        self._seq += 1
        return f"{prefix}:{self._seq}"

    # ---- the player's way in ---------------------------------------------------------------
    PLAYER_COMMANDS = frozenset({
        "join", "status", "walk", "drive", "pay", "give_goods", "buy_goods", "offer_asset",
        "accept_offer", "decline_offer", "gift_asset", "lend_asset", "lease_asset", "return_asset",
        "take_asset", "buy_new_vehicle", "start_job", "stop_job", "pay_fines", "propose_law", "vote",
        "withdraw", "set_price", "restock",
    })

    def submit(self, player_id: str, command: str, **args: Any) -> dict:
        """Do one thing a player asked, as that player, or say why not. Never raises."""
        if command not in self.PLAYER_COMMANDS:
            return {"ok": False, "error": f"no command {command!r}"}
        if command != "join" and player_id not in self.players:
            return {"ok": False, "error": f"{player_id} has not joined"}
        try:
            result = getattr(self, f"_cmd_{command}")(player_id, **args)
        except (SimError, PropertyError, LedgerError, LawError, GovernmentError) as error:
            return {"ok": False, "error": str(error)}
        except TypeError as error:  # wrong or missing arguments
            return {"ok": False, "error": f"bad request: {error}"}
        return {"ok": True, **(result or {})}

    def _player(self, pid: str) -> Player:
        return self.players[pid]

    def _cmd_join(self, pid: str, *, at_place: str | None = None) -> dict:
        if pid in self.players:
            raise SimError(f"{pid} has already joined")
        account = self.ledger.open(f"player:{pid}", kind="player")
        self.ledger.mint(account, STARTING_BALANCE, reason="starter_grant", at=self.now, key=f"starter:{pid}")
        homes = [p for p in self.places if p.use == "residential" and p.landlord]
        if not homes:
            raise SimError("there is nowhere to rent")
        home = self.place[at_place] if at_place in self.place else self.rng.choice(homes)
        room = f"unit:{home.id}:{pid}"
        self.registry.register(room, "unit", home.landlord, at=self.now, building=home.id, use="room")
        # The first week is on the house: a starter's rented room, leased like any other.
        self.registry.lease(room, home.landlord, account, until=self.now + ROOM_TERM_S, rent=0, at=self.now)
        player = Player(pid, account, home.x, home.y, home=room, joined_at=self.now)
        self.players[pid] = player
        self.government.register_resident(account, at=self.now)
        self.log("join", player=pid, home=home.id)
        return {"account": account, "balance": self.ledger.balance(account), "home": room}

    def _cmd_status(self, pid: str) -> dict:
        p = self._player(pid)
        return {
            "balance": self.ledger.balance(p.account), "balance_text": fmt(self.ledger.balance(p.account)),
            "position": [round(p.x, 1), round(p.y, 1)],
            "owns": [a.id for a in self.registry.owned_by(p.account)],
            "holds": [a.id for a in self.registry.possessed_by(p.account)],
            "goods": dict(self.inventory.holdings.get(p.account, {})),
            "fines_owed": self.enforcement.owed(p.account),
            "working": p.working_since is not None,
        }

    def _route(self, x: float, y: float, to: tuple[float, float], mode: str) -> list[int]:
        a = self.graph.nearest(x, y, mode=mode)
        b = self.graph.nearest(*to, mode=mode)
        if a is None or b is None:
            raise SimError("no street there")
        limits = self.speed_limits()
        route = self.graph.route(a, b, mode=mode, speed_ms=lambda e: limits.get(e.road_class, 11.0))
        if not route:
            raise SimError("no way there from here")
        return route

    def _cmd_walk(self, pid: str, *, to: tuple[float, float]) -> dict:
        p = self._player(pid)
        route = self._route(p.x, p.y, tuple(to), "walk")
        p.agent = self.movement.add(Agent(f"walk:{pid}", "walk", route)).id
        return {"route_nodes": len(route)}

    def _cmd_drive(self, pid: str, *, vehicle: str, to: tuple[float, float], hurry: bool = False) -> dict:
        p = self._player(pid)
        car = require_driver(self.registry, vehicle, p.account)
        route = self._route(p.x, p.y, tuple(to), "drive")
        cost = fuel_cost(car, distance_km(route, self.graph.xy))
        if cost:
            # Fuel is bought from outside the district: the money leaves the economy.
            self.ledger.burn(p.account, cost, reason="fuel", at=self.now, memo=vehicle)
        self.parked.pop(vehicle, None)
        # Hurrying is driving over the limit: possible, and what the speed cameras are for.
        agent = Agent(f"drive:{pid}", "drive", route, vehicle=vehicle, excess=1.3 if hurry else 1.0)
        p.agent = self.movement.add(agent).id
        return {"route_nodes": len(route), "fuel_cost": cost}

    def _cmd_pay(self, pid: str, *, to: str, amount: int, memo: str = "") -> dict:
        entry = self.ledger.transfer(self._player(pid).account, to, int(amount), kind="payment", memo=memo,
                                     at=self.now)
        return {"entry": entry.seq}

    def _cmd_give_goods(self, pid: str, *, to: str, item: str, qty: int) -> dict:
        self.inventory.move(self._player(pid).account, to, item, int(qty))
        self.log("goods", by=pid, to=to, item=item, qty=qty)
        return {}

    def _business(self, account: str) -> Any:
        asset = self.registry.get(account)
        if asset.kind != "business":
            raise SimError(f"{account} is not a business")
        return asset

    def _cmd_buy_goods(self, pid: str, *, business: str, item: str, qty: int = 1) -> dict:
        shop = self._business(business)
        price = shop.attrs["prices"].get(item)
        if price is None:
            raise SimError(f"{business} does not sell {item}")
        entry = self.inventory.purchase(self._player(pid).account, business, item, int(qty), price, at=self.now,
                                        tax_rate=self.laws.tax_rate("sales", self.city, self.now),
                                        treasury=self.treasury)
        return {"entry": entry}

    def _owner_check(self, pid: str, asset_id: str) -> Any:
        asset = self.registry.get(asset_id)
        if asset.owner != self._player(pid).account:
            raise SimError(f"{pid} does not own {asset_id}")
        return asset

    def _cmd_offer_asset(self, pid: str, *, asset: str, buyer: str, price: int, hours: float = 24) -> dict:
        thing = self._owner_check(pid, asset)
        if thing.custody != "owner" or thing.possessor != thing.owner:
            raise SimError(f"{asset} is {thing.custody}; it must be back before it is sold")
        if buyer not in self.ledger.balances:
            raise SimError(f"no one called {buyer}")
        offer = Offer(self._id("offer"), asset, thing.owner, buyer, int(price), self.now + hours * HOUR_S)
        self.offers[offer.id] = offer
        self.log("offer", offer=offer.id, asset=asset, price=offer.price)
        return {"offer": offer.id}

    def _cmd_accept_offer(self, pid: str, *, offer: str) -> dict:
        o = self.offers.get(offer)
        if o is None or o.status != "open":
            raise SimError(f"no open offer {offer}")
        if o.buyer != self._player(pid).account:
            raise SimError("that offer was made to someone else")
        if self.now > o.expires:
            o.status = "lapsed"
            raise SimError("the offer has lapsed")
        kind = self.registry.get(o.asset).kind
        # Movable things carry sales tax; land and buildings pay property tax while held instead.
        rate = 0.0 if kind in ("parcel", "building", "unit") else self.laws.tax_rate("sales", self.city, self.now)
        move = self.registry.sell(o.asset, o.seller, o.buyer, o.price, at=self.now, tax_rate=rate,
                                  treasury=self.treasury, key=f"offer:{o.id}")
        o.status = "accepted"
        self.log("sale", asset=o.asset, price=o.price, to=o.buyer)
        return {"transfer": move.seq, "entry": move.entry}

    def _cmd_decline_offer(self, pid: str, *, offer: str) -> dict:
        o = self.offers.get(offer)
        if o is None or o.buyer != self._player(pid).account or o.status != "open":
            raise SimError(f"no open offer {offer} to you")
        o.status = "declined"
        return {}

    def _cmd_gift_asset(self, pid: str, *, asset: str, to: str) -> dict:
        move = self.registry.gift(asset, self._player(pid).account, to, at=self.now)
        return {"transfer": move.seq}

    def _cmd_lend_asset(self, pid: str, *, asset: str, to: str, hours: float) -> dict:
        move = self.registry.lend(asset, self._player(pid).account, to, until=self.now + hours * HOUR_S, at=self.now)
        return {"transfer": move.seq}

    def _cmd_lease_asset(self, pid: str, *, asset: str, to: str, hours: float, rent: int) -> dict:
        # The lessee agrees by holding an offer; here the owner leases to someone who pays up front.
        move = self.registry.lease(asset, self._player(pid).account, to, until=self.now + hours * HOUR_S,
                                   rent=int(rent), at=self.now)
        return {"transfer": move.seq}

    def _cmd_return_asset(self, pid: str, *, asset: str) -> dict:
        move = self.registry.give_back(asset, self._player(pid).account, at=self.now)
        return {"transfer": move.seq}

    def _cmd_take_asset(self, pid: str, *, asset: str) -> dict:
        """Theft is possible -- and seen, reported, fined and answered by the police."""
        p = self._player(pid)
        self.registry.take(asset, p.account, at=self.now)
        witnesses = [a.id for a in self.movement.near(p.x, p.y, WITNESS_M) if a.id.startswith("npc")]
        evidence = tuple(witnesses[:3]) + (("owner's alarm",) if self.registry.get(asset).kind == "vehicle" else ())
        result: dict[str, Any] = {"taken": asset}
        if evidence:
            offence = self.enforcement.report("theft", p.account, at=self.now, jurisdiction=self.city,
                                              where=(p.x, p.y), evidence=evidence, detail=asset)
            fine, paid = self.enforcement.fine(offence)
            self._send_police((p.x, p.y), "theft", asset)
            result.update(offence=offence.id, fine=fine, paid=paid, seen_by=list(evidence))
        self.log("theft", asset=asset, by=pid, seen=bool(evidence))
        return result

    def _cmd_buy_new_vehicle(self, pid: str, *, model: str) -> dict:
        if model not in CATALOGUE:
            raise SimError(f"no model {model!r}; the dealership sells {sorted(CATALOGUE)}")
        p = self._player(pid)
        dealer = self.ledger.open("business:dealership", kind="business")
        vid = self._id(f"vehicle:{model}")
        # Built outside the district: the dealership pays the factory, which leaves the economy.
        spec = CATALOGUE[model]
        register_vehicle(self.registry, vid, model, dealer, at=self.now, parked_at=self.graph.nearest(p.x, p.y, mode="drive"))
        try:
            move = self.registry.sell(vid, dealer, p.account, spec.price_new, at=self.now,
                                      tax_rate=self.laws.tax_rate("sales", self.city, self.now), treasury=self.treasury)
        except PropertyError:
            self.registry.assets.pop(vid)  # never built: the order fell through
            raise
        self.ledger.burn(dealer, round(spec.price_new * 0.85), reason="vehicle_manufacture", at=self.now, memo=vid)
        self.log("vehicle_sale", vehicle=vid, to=pid, price=spec.price_new)
        return {"vehicle": vid, "transfer": move.seq, "price": spec.price_new}

    def _cmd_start_job(self, pid: str) -> dict:
        p = self._player(pid)
        if p.working_since is not None:
            raise SimError("already working")
        p.working_since = p.job_paid_until = self.now
        return {"pay": STARTER_JOB_PAY, "per_s": STARTER_JOB_PERIOD_S}

    def _cmd_stop_job(self, pid: str) -> dict:
        p = self._player(pid)
        p.working_since = None
        return {}

    def _cmd_pay_fines(self, pid: str) -> dict:
        p = self._player(pid)
        return {"paid": self.enforcement.pay(p.account, at=self.now), "still_owed": self.enforcement.owed(p.account)}

    def _cmd_propose_law(self, pid: str, *, proposal: str, law: str, title: str, text: str,
                         rules: list[dict], effective_in_h: float = 0) -> dict:
        p = self._player(pid)
        made = self.government.propose(proposal, law, title, text, [Rule(**r) for r in rules], proposer=p.account,
                                       effective_at=self.now + effective_in_h * HOUR_S)
        return {"proposal": made.id}

    def _cmd_vote(self, pid: str, *, proposal: str, yes: bool) -> dict:
        self.government.vote(proposal, self._player(pid).account, yes)
        outcome = self.government.tally(proposal, at=self.now)
        if outcome == "passed":
            self.movement.speed_limit = self.speed_limits()
        return {"outcome": outcome}

    def _cmd_withdraw(self, pid: str, *, business: str, amount: int) -> dict:
        shop = self._owner_check(pid, business)
        entry = self.ledger.transfer(shop.id, self._player(pid).account, int(amount), kind="owner_draw", at=self.now)
        return {"entry": entry.seq}

    def _cmd_set_price(self, pid: str, *, business: str, item: str, price: int) -> dict:
        shop = self._owner_check(pid, business)
        if item not in shop.attrs["prices"] or int(price) <= 0:
            raise SimError(f"{business} does not sell {item}")
        shop.attrs["prices"][item] = int(price)
        return {}

    def _cmd_restock(self, pid: str, *, business: str, item: str, qty: int) -> dict:
        shop = self._owner_check(pid, business)
        price = shop.attrs["prices"].get(item)
        if price is None:
            raise SimError(f"{business} does not sell {item}")
        cost = round(price * WHOLESALE_SHARE) * int(qty)
        self.ledger.burn(shop.id, cost, reason="external_supplier", at=self.now, memo=f"{qty} {item}")
        self.inventory.add(shop.id, item, int(qty))
        return {"cost": cost}

    # ---- authority (the server's own hand, not a player command) ---------------------------
    def hold_election(self, ballots: dict[str, list[str]]) -> dict:
        result = self.government.elect(ballots, at=self.now)
        self.log("election", **{k: v for k, v in result.items() if k != "term_ends"})
        return result

    def _send_police(self, where: tuple[float, float], kind: str, asset: str | None) -> str | None:
        officers = [n for n in self.population.npcs if n.role == "police"]
        if not officers:
            return None
        officer = min(officers, key=lambda n: math.dist((self.place[n.at].x, self.place[n.at].y), where))
        start = self.place[officer.at]
        try:
            route = self._route(start.x, start.y, where, "drive")
        except SimError:
            return None
        agent = self.movement.add(Agent(self._id(f"npc:police:{officer.id}"), "drive", route))
        self.dispatch[agent.id] = (kind, asset or "")
        self.log("dispatch", officer=officer.id, to=[round(where[0]), round(where[1])], offence=kind)
        return agent.id

    # ---- time ------------------------------------------------------------------------------
    def step(self, dt: float = 60.0) -> None:
        self.now += dt
        day = int(self.now // DAY_S)
        if day != self._last_day:
            self._last_day = day
            self._new_day()
        self._run_population()
        self._fill_streets()
        for agent in self.movement.step(dt):
            self._arrived(agent)
        for p in self.players.values():
            if p.agent and p.agent in self.movement.agents:
                p.x, p.y = self.movement.agents[p.agent].position(self.graph)
        self._pay_starter_jobs()
        self._run_out_terms()
        self._charge_parking()
        if self.government.expire_term(at=self.now):
            self.log("term_ended")

    def _new_day(self) -> None:
        for npc in self.population.npcs:
            if npc.role in ("resident", "student") and npc.daily_income:
                self.ledger.mint(npc.account, npc.daily_income, reason="npc_income", at=self.now)
            rent = round(npc.daily_income * NPC_RENT_SHARE)
            owner = self._owner_account(f"building:{npc.home.id}") or npc.home.landlord
            if rent and owner and self.ledger.balance(npc.account) >= rent:
                self.ledger.transfer(npc.account, owner, rent, kind="rent", at=self.now, memo=npc.home.id)
            npc.budget_left = daily_budget(npc)
            spare = self.ledger.balance(npc.account) - NPC_SAVINGS_DAYS * max(npc.daily_income, money(20))
            if spare > 0:
                self.ledger.burn(npc.account, spare, reason="external_supplier", at=self.now,
                                 memo="spent outside the district")
        # NPC landlords and NPC-run tills spend most of what came in on upkeep off the map.
        for account, balance in list(self.ledger.balances.items()):
            npc_owned = account.startswith("npc:landlord:") or (
                account.startswith("business:") and self._owner_account(account, default="").startswith("npc:"))
            if npc_owned and balance > 0 and (spend := round(balance * NPC_UPKEEP_SHARE)):
                self.ledger.burn(account, spend, reason="external_supplier", at=self.now, memo="upkeep")
        self._tax_property()
        self.log("day", day=self._last_day, supply=self.ledger.supply(), treasury=self.ledger.balance(self.treasury))

    def _owner_account(self, asset_id: str, default: str | None = None) -> str | None:
        asset = self.registry.assets.get(asset_id)
        return asset.owner if asset else default

    def _tax_property(self) -> None:
        rate = self.laws.tax_rate("property", self.city, self.now)
        for asset in self.registry.assets.values():
            if asset.kind not in ("parcel", "building") or not asset.owner.startswith("player:"):
                continue
            value = int(asset.attrs.get("assessed", 0))
            due = round(value * rate / 365)
            if not due:
                continue
            if self.ledger.balance(asset.owner) >= due:
                self.ledger.transfer(asset.owner, self.treasury, due, kind="property_tax", at=self.now, memo=asset.id)
            else:
                offence = self.enforcement.report("tax_evasion", asset.owner, at=self.now, jurisdiction=self.city,
                                                  evidence=("assessor's roll",), detail=asset.id)
                self.enforcement.fine(offence)

    def _run_population(self) -> None:
        minute = (self.now % DAY_S) / 60
        for npc in self.population.npcs:
            nxt = npc.current + 1
            if nxt < len(npc.schedule) and npc.schedule[nxt].start_min <= minute:
                self._begin(npc, nxt)
            elif nxt >= len(npc.schedule) and minute < npc.schedule[npc.current].start_min:
                self._begin(npc, 0)  # past midnight: a new day's schedule
            if npc.arrive_at and npc.agent is None and self.now >= npc.arrive_at:
                npc.arrive_at = 0.0
                self._act(npc)

    def _begin(self, npc: NPC, idx: int) -> None:
        previous = npc.schedule[npc.current]
        activity = npc.schedule[idx]
        npc.current = idx
        shift = ("work", "patrol")
        # Paid when the shift is over, not at the lunch break in the middle of it.
        if previous.kind in shift and activity.kind not in shift and not any(
                a.kind in shift for a in npc.schedule[idx:]):
            self._pay_wage(npc)
        if activity.place == npc.at:
            npc.arrive_at = self.now
            return
        here, there = self.place[npc.at], self.place[activity.place]
        npc.at = activity.place
        if self._near_player(here.x, here.y) and self._walkers() < ACTIVE_PEDESTRIANS[1]:
            limits = self.speed_limits()
            route = self.graph.route(here.node, there.node, mode="walk", speed_ms=lambda e: limits.get(e.road_class, 11.0))
            if route and len(route) > 1:
                npc.agent = self.movement.add(Agent(f"npc:walk:{npc.id}", "walk", route)).id
                return
        # Off-screen: there in the time the walk would take.
        npc.arrive_at = self.now + math.dist((here.x, here.y), (there.x, there.y)) * 1.3 / 1.35

    def _act(self, npc: NPC) -> None:
        activity = npc.schedule[npc.current]
        place = self.place[activity.place]
        if activity.kind in ("eat", "shop") and place.account:
            self._npc_buys(npc, place, "meal" if activity.kind == "eat" else self.rng.choice(SELLS["retail"]))

    def _npc_buys(self, npc: NPC, place: Place, item: str) -> None:
        shop = self.registry.assets.get(place.account)
        if shop is None or item not in shop.attrs.get("prices", {}):
            return
        price = shop.attrs["prices"][item]
        rate = self.laws.tax_rate("sales", self.city, self.now)
        # Demand is capped: what the NPC can afford today, and nothing past a price it will not pay.
        if price > GOODS[item] * 2.5 or npc.budget_left < price or self.ledger.balance(npc.account) < price * (1 + rate):
            return
        if self.inventory.count(place.account, item) < 1:
            self.log("sold_out", business=place.account, item=item)
            if shop.owner.startswith("npc:"):
                self._npc_restock(place.account, item)
            return
        self.inventory.purchase(npc.account, place.account, item, 1, price, at=self.now, tax_rate=rate,
                                treasury=self.treasury)
        self.inventory.remove(npc.account, item, 1)  # eaten, worn, used: it leaves the world
        npc.budget_left -= price

    def _npc_restock(self, business: str, item: str) -> None:
        price = self.registry.get(business).attrs["prices"][item]
        qty = RESTOCK_TO - self.inventory.count(business, item)
        cost = round(price * WHOLESALE_SHARE) * qty
        if qty <= 0:
            return
        if self.ledger.balance(business) < cost:
            self.ledger.mint(business, cost - self.ledger.balance(business), reason="external_trade", at=self.now,
                             memo="NPC supplier credit")
        self.ledger.burn(business, cost, reason="external_supplier", at=self.now, memo=f"{qty} {item}")
        self.inventory.add(business, item, qty)

    def _pay_wage(self, npc: NPC) -> None:
        wage = DAILY_WAGE.get(npc.role, 0)
        employer = npc.employer
        if not wage:
            return
        if employer is None:
            self.ledger.mint(npc.account, wage, reason="npc_wage", at=self.now)
            return
        if employer.startswith("treasury:"):
            # The city's payroll: from its treasury, the NPC administration making up any shortfall.
            have = self.ledger.balance(employer)
            if have < wage:
                self.ledger.mint(employer, wage - have, reason="public_contract", at=self.now, memo="payroll grant")
            self.ledger.transfer(employer, npc.account, wage, kind="wage", at=self.now)
            return
        owner = self._owner_account(employer, default="npc:")
        if self.ledger.balance(employer) >= wage:
            self.ledger.transfer(employer, npc.account, wage, kind="wage", at=self.now)
        elif owner.startswith("npc:"):
            self.ledger.mint(npc.account, wage, reason="npc_wage", at=self.now, memo=f"for {employer}")
        else:
            self.log("wage_unpaid", employer=employer, worker=npc.id, owner=owner)

    def _near_player(self, x: float, y: float) -> bool:
        return any(math.dist((p.x, p.y), (x, y)) <= ACTIVE_RADIUS_M for p in self.players.values())

    def _walkers(self) -> int:
        return sum(1 for a in self.movement.agents.values() if a.mode == "walk" and a.id.startswith("npc:walk"))

    def _fill_streets(self) -> None:
        """NPC traffic near players, at the density the hour calls for."""
        if not self.players:
            return
        traffic = [a for a in self.movement.agents.values() if a.id.startswith("npc:car:")]
        target = traffic_target((self.now % DAY_S) / HOUR_S, ACTIVE_VEHICLES[1] * len(self.players))
        target = max(target, ACTIVE_VEHICLES[0] if 7 <= (self.now % DAY_S) / HOUR_S < 22 else 0)
        for _ in range(min(15, target - len(traffic))):
            # A trip through the player's neighbourhood: in from one side, out across the other.
            p = self.rng.choice(list(self.players.values()))
            heading = self.rng.uniform(0, math.tau)
            reach = self.rng.uniform(450, 900)
            a = self.graph.nearest(p.x + math.cos(heading) * reach, p.y + math.sin(heading) * reach, mode="drive")
            b = self.graph.nearest(p.x - math.cos(heading) * reach, p.y - math.sin(heading) * reach, mode="drive")
            if a is None or b is None or a == b:
                continue
            limits = self.speed_limits()
            route = self.graph.route(a, b, mode="drive", speed_ms=lambda e, limits=limits: limits.get(e.road_class, 11.0))
            if not route or len(route) < 2:
                continue
            model = pick_model(self.rng)
            # Through traffic: owned by the NPC fleets off the map, not entered in the records
            # one car at a time. A vehicle that stops here (a player's, a fleet's parked van) is.
            self.movement.add(Agent(self._id(f"npc:car:{model}"), "drive", route, model=model,
                                    cruise_ms=CATALOGUE[model].cruise_ms))

    def _arrived(self, agent: Agent) -> None:
        self.movement.remove(agent.id)
        if agent.id.startswith("npc:car:"):
            return  # through traffic drives on out of the scene
        if agent.id.startswith("npc:walk:"):
            npc = self.npc[agent.id.removeprefix("npc:walk:")]
            npc.agent = None
            npc.arrive_at = 0.0
            self._act(npc)
            return
        if agent.id in self.dispatch:
            kind, asset = self.dispatch.pop(agent.id)
            if kind == "theft" and asset and self.registry.assets.get(asset) and self.registry.get(asset).custody == "stolen":
                self.registry.recover(asset, f"police:{self.city}", at=self.now)
                self.log("recovered", asset=asset)
            return
        pid = agent.id.split(":", 1)[1]
        player = self.players.get(pid)
        if player is None:
            return
        player.x, player.y = self.graph.xy[agent.route[-1]]
        player.agent = None
        if agent.vehicle:
            asset = self.registry.assets.get(agent.vehicle)
            if asset:
                asset.attrs["odometer_km"] = asset.attrs.get("odometer_km", 0.0) + agent.travelled_m / 1000
                asset.attrs["parked_at"] = agent.route[-1]
                self.parked[agent.vehicle] = (agent.route[-1], self.now)
            if agent.excess > 1.0 and self.rng.random() < 0.6:
                offence = self.enforcement.report("speeding", player.account, at=self.now, jurisdiction=self.city,
                                                  where=(player.x, player.y), evidence=("speed camera",),
                                                  detail=agent.vehicle)
                self.enforcement.fine(offence)
                self.log("speeding", player=pid, vehicle=agent.vehicle)

    def _pay_starter_jobs(self) -> None:
        for p in self.players.values():
            if p.working_since is None:
                continue
            while self.now - p.job_paid_until >= STARTER_JOB_PERIOD_S:
                p.job_paid_until += STARTER_JOB_PERIOD_S
                self.ledger.mint(p.account, STARTER_JOB_PAY, reason="starter_job", at=p.job_paid_until,
                                 key=f"job:{p.id}:{int(p.job_paid_until)}")
            if self.now - p.working_since >= 8 * HOUR_S:
                p.working_since = None  # a shift is eight hours

    def _run_out_terms(self) -> None:
        for asset in self.registry.assets.values():
            until = asset.attrs.get("term_until")
            if until is not None and self.now >= until and asset.custody in ("lease", "loan"):
                self.registry.give_back(asset.id, asset.possessor, at=self.now)
                self.log("term_ended", asset=asset.id)

    def _charge_parking(self) -> None:
        fee = int(self.laws.value("parking_fee_per_hour", "street", self.city, self.now, 0))
        for vehicle, (node, paid_until) in list(self.parked.items()):
            if self.now - paid_until < HOUR_S:
                continue
            asset = self.registry.assets.get(vehicle)
            if asset is None or not asset.owner.startswith("player:"):
                self.parked.pop(vehicle)
                continue
            self.parked[vehicle] = (node, paid_until + HOUR_S)
            if not fee:
                continue
            if self.ledger.balance(asset.owner) >= fee:
                self.ledger.transfer(asset.owner, self.treasury, fee, kind="parking", at=self.now, memo=vehicle)
                continue
            offence = self.enforcement.report("unpaid_parking", asset.owner, at=self.now, jurisdiction=self.city,
                                              where=self.graph.xy[node], evidence=("parking warden",), detail=vehicle)
            self.enforcement.fine(offence)
            unpaid = sum(1 for o in self.enforcement.offences
                         if o.kind == "unpaid_parking" and o.detail == vehicle)
            if unpaid >= 3 and asset.custody == "owner":
                self.registry.impound(vehicle, f"police:{self.city}", at=self.now, reason="three unpaid parking tickets")
                self.parked.pop(vehicle)
                self.log("impounded", vehicle=vehicle)

    # ---- reading ---------------------------------------------------------------------------
    def metrics(self) -> dict:
        moving = list(self.movement.agents.values())
        return {
            "time_h": round(self.now / HOUR_S, 2),
            "npcs": len(self.population.npcs),
            "walking_near_players": sum(1 for a in moving if a.mode == "walk"),
            "vehicles_near_players": sum(1 for a in moving if a.mode == "drive"),
            "money_supply": self.ledger.supply(),
            "treasury": self.ledger.balance(self.treasury),
            "ledger_entries": len(self.ledger.entries),
            "transfers": len(self.registry.journal),
            "offences": len(self.enforcement.offences),
            "laws_in_force": len(self.laws.in_force(self.city, self.now)),
        }

    # ---- persistence -----------------------------------------------------------------------
    def snapshot(self) -> dict:
        return {
            "schema": "kerbside.sim.world/1",
            "city": self.city, "seed": self.seed, "now": self.now, "seq": self._seq,
            "ledger": self.ledger.to_dict(),
            "registry": self.registry.to_dict(),
            "inventory": self.inventory.to_dict(),
            "laws": self.laws.to_dict(),
            "offences": [o.__dict__ for o in self.enforcement.offences],
            "fines": {str(k): v for k, v in self.enforcement.fines.items()},
            "players": [p.__dict__ for p in self.players.values()],
            "offers": [o.__dict__ for o in self.offers.values()],
            "government": {"mayor": self.government.mayor, "council": self.government.council,
                           "term_ends": self.government.term_ends,
                           "residents": {k: list(v) for k, v in self.government.residents.items()}},
        }

    @classmethod
    def restore(cls, data: dict, graph: StreetGraph, places: list[Place], *, npc_count: int = 1_000) -> World:
        from smc.city.law import Offence

        ledger = Ledger.from_dict(data["ledger"])
        world = cls.__new__(cls)
        # The district comes back from its sources; the records come back from storage.
        fresh = cls(graph, places, LawBook.from_dict(data["laws"]), data["city"], seed=data["seed"],
                    npc_count=npc_count, now=data["now"])
        world.__dict__.update(fresh.__dict__)
        world.ledger = ledger
        world.registry = Registry.from_dict(data["registry"], ledger)
        world.inventory = Inventory.from_dict(data["inventory"], ledger)
        world.enforcement = Enforcement(world.laws, ledger)
        world.enforcement.offences = [Offence(**{**o, "where": tuple(o["where"]) if o["where"] else None,
                                                 "evidence": tuple(o["evidence"])}) for o in data["offences"]]
        world.enforcement.fines = {int(k): list(v) for k, v in data["fines"].items()}
        world.players = {p["id"]: Player(**p) for p in data["players"]}
        world.offers = {o["id"]: Offer(**o) for o in data["offers"]}
        g = data["government"]
        world.government.mayor, world.government.council, world.government.term_ends = g["mayor"], g["council"], g["term_ends"]
        world.government.residents = {k: tuple(v) for k, v in g["residents"].items()}
        world._seq = data["seq"]
        world.treasury = world.laws.treasury(world.city)
        return world
