"""Who owns what, who has it, and every change of either.

Two kinds of possessions:

- **Assets** (``Registry``): things with an identity -- a parcel, a building, a car, a business,
  a particular item. Each has an *owner* (title) and a *possessor* (who has it now), which differ
  while it is leased, lent, stolen or impounded. Every change is a ``Transfer`` in the asset's
  history and in the registry's journal, with the ledger entry that paid for it.
- **Goods** (``Inventory``): stackable personal property -- meals, clothing, materials -- counted
  per holder and moved by quantity.

Only the owner can sell, give, lease or lend; only the possessor can use or hand back. A sale is
one ledger entry (price, tax to the treasury) and one registry change, checked in full first so
neither can happen without the other. Theft moves possession and never title, and is returned
as an offence for the law to deal with; seizure moves title, and only on a stated legal basis.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from smc.city.ledger import Ledger, LedgerError

ASSET_KINDS = frozenset({"parcel", "building", "vehicle", "item", "business", "unit"})
#: How an asset is held by its possessor.
CUSTODY = frozenset({"owner", "lease", "loan", "stolen", "impounded"})
TRANSFER_KINDS = frozenset({"grant", "gift", "sale", "lease", "loan", "return", "theft", "recovery",
                            "impound", "release", "seizure"})


class PropertyError(Exception):
    pass


@dataclass(frozen=True)
class Transfer:
    seq: int
    at: float
    kind: str
    asset: str
    from_owner: str | None
    to_owner: str
    from_possessor: str | None
    to_possessor: str
    price: int = 0
    entry: int | None = None   # the ledger entry that paid for it
    note: str = ""


@dataclass
class Asset:
    id: str
    kind: str
    owner: str
    possessor: str
    custody: str = "owner"
    attrs: dict[str, Any] = field(default_factory=dict)
    history: list[Transfer] = field(default_factory=list)


@dataclass(frozen=True)
class Theft:
    """What ``Registry.take`` hands back for the law: an offence, not a quiet change of hands."""

    asset: str
    owner: str
    taker: str
    at: float


@dataclass
class Registry:
    ledger: Ledger
    assets: dict[str, Asset] = field(default_factory=dict)
    journal: list[Transfer] = field(default_factory=list)

    # ---- reading -------------------------------------------------------------------------
    def get(self, asset_id: str) -> Asset:
        try:
            return self.assets[asset_id]
        except KeyError:
            raise PropertyError(f"no asset {asset_id}") from None

    def owned_by(self, holder: str, kind: str | None = None) -> list[Asset]:
        return [a for a in self.assets.values() if a.owner == holder and (kind is None or a.kind == kind)]

    def possessed_by(self, holder: str, kind: str | None = None) -> list[Asset]:
        return [a for a in self.assets.values() if a.possessor == holder and (kind is None or a.kind == kind)]

    # ---- the one way a record changes ----------------------------------------------------
    def _record(self, asset: Asset, kind: str, *, at: float, owner: str, possessor: str, custody: str,
                price: int = 0, entry: int | None = None, note: str = "") -> Transfer:
        if kind not in TRANSFER_KINDS or custody not in CUSTODY:
            raise PropertyError(f"unknown transfer {kind!r} / custody {custody!r}")
        move = Transfer(len(self.journal) + 1, float(at), kind, asset.id, asset.owner if asset.history else None,
                        owner, asset.possessor if asset.history else None, possessor, price, entry, note)
        asset.owner, asset.possessor, asset.custody = owner, possessor, custody
        asset.history.append(move)
        self.journal.append(move)
        return move

    def register(self, asset_id: str, kind: str, owner: str, *, at: float = 0.0, **attrs: Any) -> Asset:
        """A new asset comes into the records (the city's parcels, a car off the line)."""
        if kind not in ASSET_KINDS:
            raise PropertyError(f"unknown asset kind {kind!r}")
        if asset_id in self.assets:
            raise PropertyError(f"{asset_id} is already registered")
        asset = Asset(asset_id, kind, owner, owner, "owner", dict(attrs))
        self.assets[asset_id] = asset
        self._record(asset, "grant", at=at, owner=owner, possessor=owner, custody="owner", note="registered")
        return asset

    def _owned_and_held(self, asset: Asset, owner: str) -> None:
        if asset.owner != owner:
            raise PropertyError(f"{owner} does not own {asset.id}")
        if asset.possessor != owner or asset.custody != "owner":
            raise PropertyError(f"{asset.id} is {asset.custody} to {asset.possessor}; it must be back first")

    # ---- the owner's acts ----------------------------------------------------------------
    def gift(self, asset_id: str, giver: str, receiver: str, *, at: float = 0.0) -> Transfer:
        asset = self.get(asset_id)
        self._owned_and_held(asset, giver)
        if receiver == giver:
            raise PropertyError("a gift goes to someone else")
        return self._record(asset, "gift", at=at, owner=receiver, possessor=receiver, custody="owner")

    def sell(self, asset_id: str, seller: str, buyer: str, price: int, *, at: float = 0.0,
             tax_rate: float = 0.0, treasury: str | None = None, key: str | None = None) -> Transfer:
        """Title and the asset to the buyer, the price to the seller, the tax to the treasury: one act."""
        asset = self.get(asset_id)
        self._owned_and_held(asset, seller)
        if buyer == seller:
            raise PropertyError("a sale is to someone else")
        if price <= 0:
            raise PropertyError("a sale has a price; a free transfer is a gift")
        tax = round(price * tax_rate)
        if tax and not treasury:
            raise PropertyError("a taxed sale needs the treasury the tax is paid to")
        legs = [(buyer, -(price + tax)), (seller, price)] + ([(treasury, tax)] if tax else [])
        try:
            entry = self.ledger.post(legs, kind="sale", memo=f"{asset.kind} {asset.id}", at=at, key=key)
        except LedgerError as error:
            raise PropertyError(str(error)) from error
        return self._record(asset, "sale", at=at, owner=buyer, possessor=buyer, custody="owner",
                            price=price, entry=entry.seq, note=f"tax {tax}" if tax else "")

    def lease(self, asset_id: str, owner: str, lessee: str, *, until: float, rent: int, at: float = 0.0,
              key: str | None = None) -> Transfer:
        """Possession for a term against rent paid up front; title stays."""
        asset = self.get(asset_id)
        self._owned_and_held(asset, owner)
        if until <= at:
            raise PropertyError("a lease ends after it starts")
        entry = None
        if rent:
            try:
                entry = self.ledger.transfer(lessee, owner, rent, kind="rent", memo=asset.id, at=at, key=key).seq
            except LedgerError as error:
                raise PropertyError(str(error)) from error
        asset.attrs["term_until"] = until
        return self._record(asset, "lease", at=at, owner=owner, possessor=lessee, custody="lease",
                            price=rent, entry=entry)

    def lend(self, asset_id: str, owner: str, borrower: str, *, until: float, at: float = 0.0) -> Transfer:
        asset = self.get(asset_id)
        self._owned_and_held(asset, owner)
        asset.attrs["term_until"] = until
        return self._record(asset, "loan", at=at, owner=owner, possessor=borrower, custody="loan")

    # ---- the possessor's acts ------------------------------------------------------------
    def give_back(self, asset_id: str, holder: str, *, at: float = 0.0) -> Transfer:
        """A lessee or borrower returns the asset to its owner."""
        asset = self.get(asset_id)
        if asset.possessor != holder or asset.custody not in ("lease", "loan"):
            raise PropertyError(f"{holder} does not hold {asset.id} on a lease or loan")
        asset.attrs.pop("term_until", None)
        return self._record(asset, "return", at=at, owner=asset.owner, possessor=asset.owner, custody="owner")

    def take(self, asset_id: str, taker: str, *, at: float = 0.0) -> Theft:
        """Taking without right: possession moves, title never does, and the law hears of it."""
        asset = self.get(asset_id)
        if taker in (asset.owner, asset.possessor):
            raise PropertyError(f"{taker} already has {asset.id}")
        if asset.kind in ("parcel", "building", "unit", "business"):
            raise PropertyError(f"a {asset.kind} cannot be carried off")
        self._record(asset, "theft", at=at, owner=asset.owner, possessor=taker, custody="stolen")
        return Theft(asset.id, asset.owner, taker, at)

    # ---- the authorities' acts -----------------------------------------------------------
    def recover(self, asset_id: str, authority: str, *, at: float = 0.0) -> Transfer:
        asset = self.get(asset_id)
        if asset.custody != "stolen":
            raise PropertyError(f"{asset.id} is not stolen")
        return self._record(asset, "recovery", at=at, owner=asset.owner, possessor=asset.owner,
                            custody="owner", note=f"by {authority}")

    def impound(self, asset_id: str, authority: str, *, at: float = 0.0, reason: str) -> Transfer:
        asset = self.get(asset_id)
        if not reason:
            raise PropertyError("an impound states its reason")
        return self._record(asset, "impound", at=at, owner=asset.owner, possessor=authority,
                            custody="impounded", note=reason)

    def release(self, asset_id: str, authority: str, *, at: float = 0.0) -> Transfer:
        asset = self.get(asset_id)
        if asset.custody != "impounded" or asset.possessor != authority:
            raise PropertyError(f"{asset.id} is not impounded by {authority}")
        return self._record(asset, "release", at=at, owner=asset.owner, possessor=asset.owner, custody="owner")

    def seize(self, asset_id: str, authority: str, *, at: float = 0.0, basis: str) -> Transfer:
        """Title to the authority, on a stated legal basis (a court order, a foreclosure)."""
        asset = self.get(asset_id)
        if not basis:
            raise PropertyError("a seizure states its legal basis")
        return self._record(asset, "seizure", at=at, owner=authority, possessor=authority, custody="owner",
                            note=basis)

    # ---- persistence ---------------------------------------------------------------------
    def to_dict(self) -> dict:
        return {"assets": [
            {"id": a.id, "kind": a.kind, "attrs": a.attrs,
             "history": [t.__dict__ for t in a.history]} for a in self.assets.values()]}

    @classmethod
    def from_dict(cls, data: dict, ledger: Ledger) -> Registry:
        registry = cls(ledger)
        for record in data["assets"]:
            history = [Transfer(**t) for t in record["history"]]
            last = history[-1]
            custody = {"theft": "stolen", "impound": "impounded", "lease": "lease", "loan": "loan"}.get(last.kind, "owner")
            asset = Asset(record["id"], record["kind"], last.to_owner, last.to_possessor, custody,
                          dict(record["attrs"]), history)
            registry.assets[asset.id] = asset
            registry.journal.extend(history)
        registry.journal.sort(key=lambda t: t.seq)
        return registry


@dataclass
class Inventory:
    """Stackable goods by holder: what a person carries or a shop has on its shelves."""

    ledger: Ledger
    holdings: dict[str, Counter] = field(default_factory=dict)

    def count(self, holder: str, item: str) -> int:
        return self.holdings.get(holder, Counter())[item]

    def add(self, holder: str, item: str, qty: int) -> None:
        """Goods come into the world (made, delivered from outside)."""
        if qty <= 0:
            raise PropertyError("add a positive quantity")
        self.holdings.setdefault(holder, Counter())[item] += qty

    def remove(self, holder: str, item: str, qty: int) -> None:
        """Goods leave the world (eaten, used up, destroyed)."""
        have = self.count(holder, item)
        if qty <= 0 or have < qty:
            raise PropertyError(f"{holder} has {have} {item}, not {qty}")
        self.holdings[holder][item] -= qty
        if not self.holdings[holder][item]:
            del self.holdings[holder][item]

    def move(self, src: str, dst: str, item: str, qty: int) -> None:
        """Handing goods over: a gift, a delivery, a return."""
        if src == dst:
            raise PropertyError("a move is to someone else")
        self.remove(src, item, qty)
        self.add(dst, item, qty)

    def purchase(self, buyer: str, seller: str, item: str, qty: int, unit_price: int, *, at: float = 0.0,
                 tax_rate: float = 0.0, treasury: str | None = None, key: str | None = None) -> int:
        """Goods for money in one act; returns the ledger entry's number."""
        if self.count(seller, item) < qty or qty <= 0:
            raise PropertyError(f"{seller} has {self.count(seller, item)} {item}, not {qty}")
        price = unit_price * qty
        tax = round(price * tax_rate)
        if tax and not treasury:
            raise PropertyError("a taxed sale needs the treasury the tax is paid to")
        legs = [(buyer, -(price + tax)), (seller, price)] + ([(treasury, tax)] if tax else [])
        try:
            entry = self.ledger.post(legs, kind="purchase", memo=f"{qty} {item}", at=at, key=key)
        except LedgerError as error:
            raise PropertyError(str(error)) from error
        self.move(seller, buyer, item, qty)
        return entry.seq

    def to_dict(self) -> dict:
        return {holder: dict(goods) for holder, goods in self.holdings.items() if goods}

    @classmethod
    def from_dict(cls, data: dict, ledger: Ledger) -> Inventory:
        return cls(ledger, {holder: Counter(goods) for holder, goods in data.items()})
