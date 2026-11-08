"""Laws that change what the world does, the people and cars that live in it, and the one
authoritative world players act through."""

from __future__ import annotations

import pytest

from smc.city.currency import money
from smc.city.district import bay_area_laws, synthetic_district, world_from_payload
from smc.city.government import Government, GovernmentError
from smc.city.law import Enforcement, LawError, Rule
from smc.city.ledger import Ledger
from smc.city.npc import Place, generate_population
from smc.city.params import ROLE_ALLOCATION, STARTER_JOB_PAY, STARTING_BALANCE
from smc.city.streets import grid_graph

CITY = "city:san-francisco"


def test_a_law_is_only_rules_the_world_can_execute_within_bounds() -> None:
    with pytest.raises(LawError):
        Rule("mint_money", "players", 1_000_000).validate()
    with pytest.raises(LawError):
        Rule("tax_rate", "sales", 0.9).validate()
    with pytest.raises(LawError):
        Rule("speed_limit_kmh", "rocket_lane", 50).validate()
    with pytest.raises(LawError):
        Rule("zoning", "X", {"uses": ["casino"], "max_height_m": 10, "max_floors": 2}).validate()
    assert Rule("tax_rate", "sales", 0.1).validate()


def test_the_nearest_jurisdiction_and_newest_version_in_force_decide() -> None:
    laws = bay_area_laws()
    assert laws.tax_rate("sales", CITY, 0) == 0.08  # the baseline
    laws.enact("county-tax", "county:san-francisco", "County sales tax", "", [Rule("tax_rate", "sales", 0.09)],
               effective_at=10, enacted_by="test")
    laws.enact("city-tax", CITY, "City sales tax", "", [Rule("tax_rate", "sales", 0.1)], effective_at=20,
               enacted_by="test")
    assert [laws.tax_rate("sales", CITY, t) for t in (5, 15, 25)] == [0.08, 0.09, 0.1]
    laws.enact("city-tax", CITY, "City sales tax, lowered", "", [Rule("tax_rate", "sales", 0.085)], effective_at=30,
               enacted_by="test")
    assert laws.tax_rate("sales", CITY, 25) == 0.1 and laws.tax_rate("sales", CITY, 35) == 0.085
    laws.repeal("city-tax", effective_at=40, enacted_by="test")
    assert laws.tax_rate("sales", CITY, 45) == 0.09, "repealed: the county's applies again"
    assert len(laws.laws["city-tax"]) == 3, "versions are kept"
    laws.enact("zones", CITY, "Zoning", "", [Rule("zoning", "RH-2", {"uses": ["residential"], "max_height_m": 12,
                                                                    "max_floors": 3})], effective_at=0, enacted_by="t")
    assert laws.permits_building("RH-2", "residential", 10, 3, CITY, 50) == []
    assert len(laws.permits_building("RH-2", "commercial", 30, 8, CITY, 50)) == 3


def test_fines_go_to_the_treasury_and_what_cannot_be_paid_is_owed() -> None:
    laws = bay_area_laws()
    ledger = Ledger()
    ledger.open("player:x", kind="player")
    ledger.mint("player:x", money(100), reason="starter_grant")
    police = Enforcement(laws, ledger)
    with pytest.raises(LawError):
        police.report("theft", "player:x", at=0, jurisdiction=CITY)  # no evidence, no offence
    offence = police.report("theft", "player:x", at=0, jurisdiction=CITY, evidence=("witness",))
    assert police.fine(offence) == (money(1_500), money(100))
    assert ledger.balance("player:x") == 0 and police.owed("player:x") == money(1_400)
    ledger.mint("player:x", money(2_000), reason="starter_job")
    assert police.pay("player:x", at=1) == money(1_400) and police.owed("player:x") == 0
    assert ledger.balance(laws.treasury(CITY)) == money(1_500)


def test_a_seated_council_legislates_and_an_empty_one_leaves_the_npc_administration() -> None:
    laws = bay_area_laws()
    gov = Government(CITY, laws)
    voters = [f"player:{i}" for i in range(12)]
    for v in voters:
        gov.register_resident(v, at=0)
    early = gov.elect({v: ["player:0", "player:1"] for v in voters}, at=86_400)
    assert not early["held"], "residency is a week"
    with pytest.raises(GovernmentError):
        gov.propose("p1", "l", "t", "", [Rule("tax_rate", "sales", 0.1)], proposer="player:0", effective_at=0)
    ballots = {v: ["player:0", "player:1", "player:2", "player:3", "player:4", "player:5"] for v in voters}
    result = gov.elect(ballots, at=8 * 86_400)
    assert result["held"] and result["mayor"] == "player:0" and len(result["council"]) == 5
    with pytest.raises(GovernmentError):
        gov.propose("p0", "l", "t", "", [Rule("tax_rate", "sales", 0.1)], proposer="player:9", effective_at=0)
    with pytest.raises(GovernmentError):
        gov.propose("p0", "l", "t", "", [Rule("tax_rate", "sales", 0.99)], proposer="player:0", effective_at=0)
    gov.propose("p1", "slow-streets", "Slow streets", "20 mph on residential streets",
                [Rule("speed_limit_kmh", "residential", 32)], proposer="player:0", effective_at=0)
    for member in gov.council[:3]:
        gov.vote("p1", member, True)
    assert gov.tally("p1", at=9 * 86_400) == "passed"
    assert laws.speed_limit_ms("residential", CITY, 9 * 86_400) == pytest.approx(32 / 3.6)


def test_routes_follow_one_way_streets_and_vehicles_drive_at_the_lawful_speed() -> None:
    from smc.city.agents import Agent, Movement, congestion_factor
    graph = grid_graph(3)
    a, b = graph.nearest(0, 0), graph.nearest(300, 0)
    route = graph.route(a, b, mode="drive")
    assert route[0] == a and route[-1] == b and len(route) == 4
    slow = Movement(graph, {"arterial": 10.0, "residential": 10.0})
    fast = Movement(graph, {"arterial": 20.0, "residential": 20.0})
    for m in (slow, fast):
        m.add(Agent("car", "drive", route))
    slow.step(20)
    fast.step(20)
    assert fast.agents["car"].done and not slow.agents["car"].done
    assert congestion_factor(20, 8) < 0.2 < congestion_factor(2, 8)


def test_the_population_has_the_designed_roles_homes_and_days() -> None:
    graph = grid_graph(4)
    places = [Place(f"p{i}", use, graph.nearest(i * 60 % 400, i * 37 % 400), i * 60 % 400, i * 37 % 400,
                    f"business:p{i}" if use in ("retail", "restaurant", "office") else None)
              for i, use in enumerate(["residential"] * 8 + ["retail", "restaurant", "office", "civic", "school",
                                                              "industrial", "parking"])]
    population = generate_population(places, size=1_000, seed=3)
    assert population.by_role() == ROLE_ALLOCATION
    for npc in population.npcs:
        times = [a.start_min for a in npc.schedule]
        assert times == sorted(set(times)) and npc.schedule[0].kind == "home"
        assert npc.home.use == "residential"


def _world():
    return synthetic_district(npcs=300, seed=1)


def test_a_new_player_has_two_thousand_credits_a_rented_room_and_no_car() -> None:
    world = _world()
    joined = world.submit("ana", "join")
    assert joined["ok"] and joined["balance"] == STARTING_BALANCE
    status = world.submit("ana", "status")
    assert status["holds"] == [joined["home"]] and status["owns"] == []
    assert world.registry.get(joined["home"]).custody == "lease"
    assert not world.submit("ana", "join")["ok"]
    assert not world.submit("ghost", "status")["ok"]
    assert not world.submit("ana", "mint_money", amount=10)["ok"]


def test_players_act_only_as_themselves_on_what_is_theirs() -> None:
    world = _world()
    world.submit("ana", "join")
    world.submit("ben", "join")
    world.ledger.mint("player:ana", money(30_000), reason="external_trade")
    car = world.submit("ana", "buy_new_vehicle", model="economy")
    assert car["ok"] and world.registry.get(car["vehicle"]).owner == "player:ana"
    assert world.ledger.balance(world.treasury) == round(money(22_000) * 0.08), "sales tax to the city"
    # Ben cannot sell, lend or drive Ana's car.
    assert not world.submit("ben", "offer_asset", asset=car["vehicle"], buyer="player:ben", price=1)["ok"]
    assert not world.submit("ben", "lend_asset", asset=car["vehicle"], to="player:ben", hours=1)["ok"]
    assert not world.submit("ben", "drive", vehicle=car["vehicle"], to=(500, 500))["ok"]


def test_a_car_is_sold_lent_driven_and_returned_between_players() -> None:
    world = _world()
    for name in ("ana", "ben"):
        world.submit(name, "join")
    world.ledger.mint("player:ana", money(30_000), reason="external_trade")
    world.ledger.mint("player:ben", money(10_000), reason="external_trade")
    vid = world.submit("ana", "buy_new_vehicle", model="economy")["vehicle"]
    assert world.submit("ana", "lend_asset", asset=vid, to="player:ben", hours=2)["ok"]
    assert world.submit("ben", "drive", vehicle=vid, to=(550, 550))["ok"]
    assert not world.submit("ana", "offer_asset", asset=vid, buyer="player:ben", price=money(9_000))["ok"]
    for _ in range(10):
        world.step(30)
    assert world.registry.get(vid).attrs["odometer_km"] > 0
    assert world.submit("ben", "return_asset", asset=vid)["ok"]
    offer = world.submit("ana", "offer_asset", asset=vid, buyer="player:ben", price=money(9_000))["offer"]
    before = world.ledger.balance("player:ana")
    assert world.submit("ben", "accept_offer", offer=offer)["ok"]
    assert world.registry.get(vid).owner == "player:ben"
    assert world.ledger.balance("player:ana") == before + money(9_000)
    assert not world.submit("ben", "accept_offer", offer=offer)["ok"], "an offer is accepted once"
    kinds = [t.kind for t in world.registry.get(vid).history]
    assert kinds == ["grant", "sale", "loan", "return", "sale"]


def test_a_theft_is_seen_fined_and_answered_by_the_police() -> None:
    world = _world()
    for name in ("ana", "ben"):
        world.submit(name, "join")
    world.ledger.mint("player:ana", money(30_000), reason="external_trade")
    vid = world.submit("ana", "buy_new_vehicle", model="economy")["vehicle"]
    took = world.submit("ben", "take_asset", asset=vid)
    assert took["ok"] and world.registry.get(vid).custody == "stolen"
    assert world.registry.get(vid).owner == "player:ana"
    assert took["offence"] and "owner's alarm" in took["seen_by"]
    assert world.enforcement.owed("player:ben") == money(1_500) - took["paid"]
    for _ in range(60):
        world.step(20)
    assert world.registry.get(vid).custody == "owner" and world.registry.get(vid).possessor == "player:ana"


def test_a_passed_law_changes_how_fast_the_traffic_goes() -> None:
    world = _world()
    voters = [f"v{i}" for i in range(12)]
    for v in voters:
        world.submit(v, "join")
    world.now += 8 * 86_400
    world.hold_election({f"player:{v}": [f"player:{v}" for v in voters[:6]] for v in voters})
    before = world.movement.speed_limit["residential"]
    seat = world.government.mayor.removeprefix("player:")
    world.submit(seat, "propose_law", proposal="p", law="faster", title="Faster", text="",
                 rules=[{"kind": "speed_limit_kmh", "key": "residential", "value": 56}])
    outcome = None
    for member in world.government.council[:3]:
        outcome = world.submit(member.removeprefix("player:"), "vote", proposal="p", yes=True)["outcome"]
    assert outcome == "passed" and world.movement.speed_limit["residential"] > before


def test_a_day_of_the_district_runs_on_the_ledger() -> None:
    world = _world()
    world.submit("ana", "join")
    world.submit("ana", "start_job")
    vehicles, peak_treasury = 0, 0
    for _ in range(24 * 60):
        world.step(60)
        vehicles = max(vehicles, world.metrics()["vehicles_near_players"])
        peak_treasury = max(peak_treasury, world.ledger.balance(world.treasury))
    world.ledger.check()
    kinds = {e.kind for e in world.ledger.entries}
    assert {"purchase", "wage", "mint:npc_wage", "mint:starter_job", "rent"} <= kinds
    assert peak_treasury > 0, "sales tax reached the treasury"
    assert vehicles > 0, "NPC traffic drove past the player"
    # Eight hours of starter work at 120 a ten minutes.
    assert world.ledger.balance("player:ana") >= STARTING_BALANCE + 48 * STARTER_JOB_PAY - money(1)


def test_the_records_survive_a_restart() -> None:
    from smc.city.world import World
    world = _world()
    world.submit("ana", "join")
    world.ledger.mint("player:ana", money(30_000), reason="external_trade")
    vid = world.submit("ana", "buy_new_vehicle", model="economy")["vehicle"]
    for _ in range(30):
        world.step(60)
    again = World.restore(world.snapshot(), world.graph, world.places, npc_count=300)
    assert again.ledger.balances == world.ledger.balances
    assert again.registry.get(vid).owner == "player:ana"
    assert again.submit("ana", "status")["balance"] == world.ledger.balance("player:ana")
    again.step(60)
    again.ledger.check()


def test_a_district_is_built_from_the_regions_map_data() -> None:
    street = lambda pts, **kw: {"kind": "street", "points": pts, "osm_id": len(pts), **kw}  # noqa: E731
    payload = {
        "bbox": {"west": -122.42, "east": -122.40, "south": 37.79, "north": 37.80},
        "ways": [
            street([[-122.415, 37.795], [-122.41, 37.795], [-122.405, 37.795]], lanes=3),
            street([[-122.41, 37.79], [-122.41, 37.795], [-122.41, 37.80]], osm_oneway="yes"),
            {"kind": "building", "osm_id": 1, "archetype": "residential", "centroid": [-122.4105, 37.7952],
             "height_m": 12, "parcel": {"blklot": "0001001"}, "zoning": {"district": "RESIDENTIAL- HOUSE, TWO FAMILY"}},
            {"kind": "building", "osm_id": 2, "archetype": "generic", "centroid": [-122.4095, 37.7948],
             "height_m": 9, "parcel": {"blklot": "0001002"}, "zoning": {"district": "DOWNTOWN- OFFICE"},
             "shops": [{"n": "Cafe", "t": "cafe"}]},
        ],
    }
    world = world_from_payload(payload, npcs=50)
    assert world.registry.get("parcel:0001001").owner.startswith("npc:landlord:")
    assert world.registry.get("building:b2").attrs["parcel"] == "0001002"
    assert world.place["b2"].use == "restaurant" and world.registry.get("business:b2").kind == "business"
    assert world.laws.permits_building("RESIDENTIAL- HOUSE, TWO FAMILY", "commercial", 9, 2, CITY, 1)
    assert world.laws.permits_building("DOWNTOWN- OFFICE", "commercial", 120, 30, CITY, 1) == []


def test_the_command_line_runs_a_district_and_saves_its_records(tmp_path, capsys) -> None:
    import json

    from smc.city.__main__ import main

    snapshot = tmp_path / "world.json"
    assert main(["--hours", "1", "--npcs", "120", "--players", "2", "--snapshot", str(snapshot)]) == 0
    out = capsys.readouterr().out
    assert "money in circulation ₡" in out and "player-1:" in out
    assert json.loads(snapshot.read_text())["ledger"]
