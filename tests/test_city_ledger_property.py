"""The placeholder currency, the ledger and the property records: money is never made, lost or
paid twice by accident, and nothing changes hands without the rules that govern it."""

from __future__ import annotations

import pytest

from smc.city import currency
from smc.city.currency import CURRENCY, fmt, money
from smc.city.ledger import ISSUER, InsufficientFunds, Ledger, LedgerError
from smc.city.property import Inventory, PropertyError, Registry


def test_one_placeholder_currency_counted_in_minor_units() -> None:
    assert CURRENCY is currency.CREDITS and CURRENCY.placeholder
    assert (CURRENCY.symbol, CURRENCY.code, CURRENCY.minor_units) == ("₡", "KCR", 2)
    assert money(35) == 3_500 and money("12.50") == 1_250
    assert fmt(money(22_000)) == "₡22,000.00" and fmt(-money(3)) == "-₡3.00"


def _ledger(**balances: int) -> Ledger:
    ledger = Ledger()
    for account, amount in balances.items():
        ledger.open(account, kind="player")
        if amount:
            ledger.mint(account, amount, reason="starter_grant")
    return ledger


def test_entries_balance_apply_whole_and_never_overdraw() -> None:
    ledger = _ledger(alice=money(100), bob=0, city=0)
    ledger.post([("alice", -money(60)), ("bob", money(55)), ("city", money(5))], kind="sale")
    assert ledger.balance("alice") == money(40) and ledger.balance("bob") == money(55)
    with pytest.raises(InsufficientFunds):
        ledger.post([("alice", -money(50)), ("bob", money(50))], kind="sale")
    assert ledger.balance("alice") == money(40) and ledger.balance("bob") == money(55), "nothing half-applied"
    with pytest.raises(LedgerError):
        ledger.post([("alice", -1), ("bob", 2)], kind="sale")  # does not sum to zero
    ledger.check()


def test_money_is_made_and_destroyed_only_for_listed_reasons() -> None:
    ledger = _ledger(alice=0)
    ledger.mint("alice", money(10), reason="npc_wage")
    with pytest.raises(LedgerError):
        ledger.mint("alice", money(10), reason="council voted itself a bonus")
    with pytest.raises(LedgerError):
        ledger.transfer(ISSUER, "alice", money(10))  # only mint creates money
    ledger.burn("alice", money(4), reason="fuel")
    assert ledger.supply() == money(6) and ledger.balance(ISSUER) == -money(10)


def test_a_repeated_request_pays_once() -> None:
    ledger = _ledger(alice=money(100), bob=0)
    first = ledger.transfer("alice", "bob", money(30), key="click-1")
    again = ledger.transfer("alice", "bob", money(30), key="click-1")
    assert first is again and ledger.balance("bob") == money(30)
    with pytest.raises(LedgerError):
        ledger.transfer("alice", "bob", money(31), key="click-1")


def test_the_books_are_rebuilt_from_the_journal() -> None:
    ledger = _ledger(alice=money(100), bob=0)
    ledger.transfer("alice", "bob", money(25), key="k")
    again = Ledger.from_dict(ledger.to_dict())
    assert again.balances == ledger.balances and again.supply() == ledger.supply()


def _records() -> tuple[Ledger, Registry]:
    ledger = _ledger(seller=0, buyer=money(10_000), thief=0, city=0)
    ledger.open("treasury:city", kind="treasury")
    registry = Registry(ledger)
    registry.register("car:1", "vehicle", "seller", model="economy")
    return ledger, registry


def test_a_sale_moves_title_money_and_tax_together_or_not_at_all() -> None:
    ledger, registry = _records()
    with pytest.raises(PropertyError):
        registry.sell("car:1", "seller", "buyer", money(9_500), tax_rate=0.1, treasury="treasury:city")
    assert registry.get("car:1").owner == "seller" and ledger.balance("buyer") == money(10_000)
    move = registry.sell("car:1", "seller", "buyer", money(8_000), tax_rate=0.08, treasury="treasury:city")
    car = registry.get("car:1")
    assert (car.owner, car.possessor, car.custody) == ("buyer", "buyer", "owner")
    assert ledger.balance("seller") == money(8_000) and ledger.balance("treasury:city") == money(640)
    assert ledger.balance("buyer") == money(10_000 - 8_640) and move.entry is not None
    with pytest.raises(PropertyError):
        registry.sell("car:1", "seller", "thief", money(1))  # no longer the seller's to sell


def test_lending_leasing_and_returning_move_possession_not_title() -> None:
    ledger, registry = _records()
    registry.lend("car:1", "seller", "buyer", until=100)
    car = registry.get("car:1")
    assert (car.owner, car.possessor, car.custody) == ("seller", "buyer", "loan")
    with pytest.raises(PropertyError):
        registry.gift("car:1", "seller", "thief")  # it must come back first
    with pytest.raises(PropertyError):
        registry.give_back("car:1", "seller")  # only the borrower hands it back
    registry.give_back("car:1", "buyer")
    registry.lease("car:1", "seller", "buyer", until=500, rent=money(200))
    assert registry.get("car:1").custody == "lease" and ledger.balance("seller") == money(200)


def test_theft_moves_possession_never_title_and_is_reported() -> None:
    _, registry = _records()
    theft = registry.take("car:1", "thief", at=5)
    car = registry.get("car:1")
    assert (car.owner, car.possessor, car.custody) == ("seller", "thief", "stolen")
    assert (theft.owner, theft.taker) == ("seller", "thief")
    registry.recover("car:1", "police:city")
    assert registry.get("car:1").possessor == "seller"
    registry.register("parcel:1", "parcel", "seller")
    with pytest.raises(PropertyError):
        registry.take("parcel:1", "thief")


def test_the_authorities_act_only_with_a_stated_reason() -> None:
    _, registry = _records()
    with pytest.raises(PropertyError):
        registry.seize("car:1", "city", basis="")
    registry.impound("car:1", "police", reason="unpaid tickets")
    registry.release("car:1", "police")
    registry.seize("car:1", "city", basis="court order 7")
    assert registry.get("car:1").owner == "city"
    kinds = [t.kind for t in registry.get("car:1").history]
    assert kinds == ["grant", "impound", "release", "seizure"]
    again = Registry.from_dict(registry.to_dict(), registry.ledger)
    assert again.get("car:1").owner == "city" and len(again.get("car:1").history) == 4


def test_goods_are_bought_and_handed_over_by_quantity() -> None:
    ledger, _ = _records()
    goods = Inventory(ledger)
    goods.add("seller", "meal", 3)
    goods.purchase("buyer", "seller", "meal", 2, money(35), tax_rate=0.1, treasury="treasury:city")
    assert goods.count("buyer", "meal") == 2 and goods.count("seller", "meal") == 1
    assert ledger.balance("seller") == money(70) and ledger.balance("treasury:city") == money(7)
    with pytest.raises(PropertyError):
        goods.purchase("buyer", "seller", "meal", 2, money(35))
    goods.move("buyer", "thief", "meal", 1)
    assert goods.count("thief", "meal") == 1
