"""The economic ledger: every movement of money in the world, double-entry and atomic.

Each entry is a set of postings that sum to zero, applied all together or not at all. No
account may go below zero except the issuer, whose negative balance *is* the money in
circulation: new money comes only from it (``mint``, for a listed reason) and leaves only to
the sink (``burn``, for a listed reason). Taxes, wages, rents and sales are transfers between
accounts and create or destroy nothing. A client never holds a balance; it asks the server,
which asks this.

An entry may carry an idempotency key: the same key a second time returns the first entry
instead of paying twice (a retried request, a doubled click), and the same key with different
postings is refused.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from smc.city.currency import CURRENCY, Currency

ISSUER = "system:issuer"
SINK = "system:sink"
ACCOUNT_KINDS = frozenset({"player", "npc", "business", "treasury", "system", "escrow", "fleet"})
#: How money may enter circulation (V2 design: NPC purchases and employers, government-funded
#: starter activity, external trade orders).
MINT_REASONS = frozenset({"starter_grant", "starter_job", "npc_wage", "npc_income", "external_trade",
                          "public_contract"})
#: How money may leave it (external suppliers, vehicle manufacture, public services, fees).
BURN_REASONS = frozenset({"external_supplier", "vehicle_manufacture", "public_service", "system_fee",
                          "fuel"})


class LedgerError(Exception):
    pass


class InsufficientFunds(LedgerError):
    pass


@dataclass(frozen=True)
class Posting:
    account: str
    amount: int  # credit (+) or debit (-), in minor units


@dataclass(frozen=True)
class Entry:
    seq: int
    at: float
    kind: str
    memo: str
    postings: tuple[Posting, ...]
    key: str | None = None

    def amount_for(self, account: str) -> int:
        return sum(p.amount for p in self.postings if p.account == account)


@dataclass
class Ledger:
    currency: Currency = CURRENCY
    balances: dict[str, int] = field(default_factory=dict)
    kinds: dict[str, str] = field(default_factory=dict)
    entries: list[Entry] = field(default_factory=list)
    _keys: dict[str, Entry] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.open(ISSUER, kind="system")
        self.open(SINK, kind="system")

    # ---- accounts ------------------------------------------------------------------------
    def open(self, account: str, *, kind: str) -> str:
        if kind not in ACCOUNT_KINDS:
            raise LedgerError(f"unknown account kind {kind!r}")
        if account in self.kinds and self.kinds[account] != kind:
            raise LedgerError(f"{account} is already a {self.kinds[account]} account")
        self.kinds.setdefault(account, kind)
        self.balances.setdefault(account, 0)
        return account

    def has(self, account: str) -> bool:
        return account in self.balances

    def balance(self, account: str) -> int:
        if account not in self.balances:
            raise LedgerError(f"no account {account}")
        return self.balances[account]

    # ---- posting -------------------------------------------------------------------------
    def post(self, postings: Iterable[tuple[str, int]], *, kind: str, memo: str = "", at: float = 0.0,
             key: str | None = None) -> Entry:
        lines = tuple(Posting(account, int(amount)) for account, amount in postings if int(amount) != 0)
        if key is not None and key in self._keys:
            seen = self._keys[key]
            if sorted(seen.postings, key=repr) != sorted(lines, key=repr):
                raise LedgerError(f"idempotency key {key!r} was used for different postings")
            return seen
        if not lines:
            raise LedgerError("an entry must move money")
        if sum(p.amount for p in lines) != 0:
            raise LedgerError("postings must sum to zero")
        after: dict[str, int] = {}
        for p in lines:
            if p.account not in self.balances:
                raise LedgerError(f"no account {p.account}")
            after[p.account] = after.get(p.account, self.balances[p.account]) + p.amount
        for account, value in after.items():
            if value < 0 and account != ISSUER:
                raise InsufficientFunds(
                    f"{account} has {self.currency.format(self.balances[account])}; "
                    f"needs {self.currency.format(self.balances[account] - value)}")
        # Everything checked: apply all of it.
        self.balances.update(after)
        entry = Entry(len(self.entries) + 1, float(at), kind, memo, lines, key)
        self.entries.append(entry)
        if key is not None:
            self._keys[key] = entry
        return entry

    def transfer(self, src: str, dst: str, amount: int, *, kind: str = "transfer", memo: str = "",
                 at: float = 0.0, key: str | None = None) -> Entry:
        if amount <= 0:
            raise LedgerError("a transfer moves a positive amount")
        if ISSUER in (src, dst) or SINK in (src, dst):
            raise LedgerError("money enters and leaves only through mint and burn")
        return self.post([(src, -amount), (dst, amount)], kind=kind, memo=memo, at=at, key=key)

    def mint(self, dst: str, amount: int, *, reason: str, memo: str = "", at: float = 0.0,
             key: str | None = None) -> Entry:
        if reason not in MINT_REASONS:
            raise LedgerError(f"money cannot be created for {reason!r}")
        if amount <= 0:
            raise LedgerError("mint a positive amount")
        return self.post([(ISSUER, -amount), (dst, amount)], kind=f"mint:{reason}", memo=memo, at=at, key=key)

    def burn(self, src: str, amount: int, *, reason: str, memo: str = "", at: float = 0.0,
             key: str | None = None) -> Entry:
        if reason not in BURN_REASONS:
            raise LedgerError(f"money cannot be destroyed for {reason!r}")
        if amount <= 0:
            raise LedgerError("burn a positive amount")
        return self.post([(src, -amount), (SINK, amount)], kind=f"burn:{reason}", memo=memo, at=at, key=key)

    # ---- reading -------------------------------------------------------------------------
    def supply(self) -> int:
        """Money in circulation: everything ever minted less everything burned."""
        return -self.balances[ISSUER] - self.balances[SINK]

    def journal(self, account: str | None = None) -> list[Entry]:
        if account is None:
            return list(self.entries)
        return [e for e in self.entries if any(p.account == account for p in e.postings)]

    def check(self) -> None:
        """The books balance and nobody but the issuer is overdrawn."""
        if sum(self.balances.values()) != 0:
            raise LedgerError("the books do not balance")
        overdrawn = [a for a, v in self.balances.items() if v < 0 and a != ISSUER]
        if overdrawn:
            raise LedgerError(f"overdrawn: {overdrawn}")

    # ---- persistence ---------------------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "currency": self.currency.code,
            "kinds": dict(self.kinds),
            "entries": [
                {"seq": e.seq, "at": e.at, "kind": e.kind, "memo": e.memo, "key": e.key,
                 "postings": [[p.account, p.amount] for p in e.postings]}
                for e in self.entries
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> Ledger:
        """Rebuilt by replaying the journal: balances are never trusted from storage."""
        if data.get("currency") != CURRENCY.code:
            raise LedgerError(f"stored in {data.get('currency')}, the world runs on {CURRENCY.code}")
        ledger = cls()
        for account, kind in data["kinds"].items():
            ledger.open(account, kind=kind)
        for e in data["entries"]:
            ledger.post([tuple(p) for p in e["postings"]], kind=e["kind"], memo=e["memo"], at=e["at"],
                        key=e["key"])
        ledger.check()
        return ledger
