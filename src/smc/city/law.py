"""Laws that change how the world behaves, and what happens when one is broken.

A law is text people debate plus *rules* the systems execute: a sales-tax rate the ledger
charges, a speed limit the traffic drives to, a zoning district's permitted uses and height a
building permit is checked against, a fine an offence costs. Only the rule kinds in
``RULE_KINDS`` exist, each with bounds -- that list is the platform's limit on government: there
is no rule that mints money, touches an account or deletes a player, so no vote can pass one.

Jurisdictions nest (region > county > city). A question -- "the sales tax here, now" -- is
answered by the newest law in force in the nearest jurisdiction that has one, then its parents,
then the baseline every place starts with. Laws are never edited: a change is a new version
from its effective time, and the history stays.

Offences are recorded with what was seen and by whom; simple ones are settled by the fine the
law sets, charged to the offender and paid into the treasury of the jurisdiction where it
happened. A fine the offender cannot pay becomes a debt on record, never a negative balance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from smc.city.currency import money
from smc.city.ledger import InsufficientFunds, Ledger

ROAD_CLASSES = ("motorway", "arterial", "residential", "service", "shared")
USES = frozenset({"residential", "commercial", "industrial", "civic", "open_space"})
TAX_KINDS = ("sales", "property", "business", "income")
OFFENCES = ("speeding", "unpaid_parking", "theft", "trespass", "vandalism", "zoning_violation",
            "restricted_item", "unlicensed_business", "tax_evasion")


class LawError(Exception):
    pass


def _between(name: str, value: float, low: float, high: float) -> None:
    if not (low <= value <= high):
        raise LawError(f"{name} {value} is outside {low}..{high}")


#: Every kind of rule a law can carry: its key (what it applies to), its value and its bounds.
#: A rule names a kind, a key and a value; validate() is the platform's check on it.
RULE_KINDS: dict[str, dict[str, Any]] = {
    "tax_rate": {"keys": TAX_KINDS, "value": (0.0, 0.5)},
    "speed_limit_kmh": {"keys": ROAD_CLASSES, "value": (5, 130)},
    "parking_fee_per_hour": {"keys": None, "value": (0, money(200))},
    "zoning": {"keys": None, "value": None},  # {"uses": [...], "max_height_m": h, "max_floors": n}
    "fine": {"keys": OFFENCES, "value": (0, money(50_000))},
    "restricted_item": {"keys": None, "value": (0, money(50_000))},  # the fine for carrying it
    "license_fee": {"keys": None, "value": (0, money(100_000))},
}


@dataclass(frozen=True)
class Rule:
    kind: str
    key: str
    value: Any

    def validate(self) -> Rule:
        spec = RULE_KINDS.get(self.kind)
        if spec is None:
            raise LawError(f"no such rule as {self.kind!r}: a law can only set {sorted(RULE_KINDS)}")
        if spec["keys"] is not None and self.key not in spec["keys"]:
            raise LawError(f"{self.kind} applies to {spec['keys']}, not {self.key!r}")
        if not self.key:
            raise LawError(f"{self.kind} needs what it applies to")
        if self.kind == "zoning":
            uses = set(self.value.get("uses", ()))
            if not uses or not uses <= USES:
                raise LawError(f"zoning uses must be some of {sorted(USES)}")
            _between("max_height_m", float(self.value.get("max_height_m", 0)), 3, 400)
            _between("max_floors", int(self.value.get("max_floors", 1)), 1, 120)
        else:
            _between(f"{self.kind}[{self.key}]", float(self.value), *spec["value"])
        return self


@dataclass(frozen=True)
class Jurisdiction:
    id: str
    name: str
    kind: str  # region | county | city
    parent: str | None = None


@dataclass(frozen=True)
class Law:
    id: str
    version: int
    jurisdiction: str
    title: str
    text: str
    rules: tuple[Rule, ...]
    effective_at: float
    enacted_by: str
    repealed: bool = False


#: What every place starts with before any government acts (NPC administration).
BASELINE: dict[tuple[str, str], Any] = {
    ("tax_rate", "sales"): 0.08,
    ("tax_rate", "property"): 0.01,
    ("tax_rate", "business"): 0.02,
    ("tax_rate", "income"): 0.0,
    ("speed_limit_kmh", "motorway"): 105,
    ("speed_limit_kmh", "arterial"): 48,
    ("speed_limit_kmh", "residential"): 40,
    ("speed_limit_kmh", "service"): 16,
    ("speed_limit_kmh", "shared"): 24,
    ("parking_fee_per_hour", "street"): money(3),
    ("parking_fee_per_hour", "lot"): money(5),
    ("fine", "speeding"): money(150),
    ("fine", "unpaid_parking"): money(80),
    ("fine", "theft"): money(1_500),
    ("fine", "trespass"): money(250),
    ("fine", "vandalism"): money(800),
    ("fine", "zoning_violation"): money(5_000),
    ("fine", "restricted_item"): money(500),
    ("fine", "unlicensed_business"): money(1_000),
    ("fine", "tax_evasion"): money(2_000),
    ("license_fee", "default"): money(500),
}


@dataclass
class LawBook:
    jurisdictions: dict[str, Jurisdiction] = field(default_factory=dict)
    #: law id -> its versions, oldest first
    laws: dict[str, list[Law]] = field(default_factory=dict)

    def add_jurisdiction(self, jurisdiction: Jurisdiction) -> Jurisdiction:
        if jurisdiction.parent and jurisdiction.parent not in self.jurisdictions:
            raise LawError(f"{jurisdiction.id}'s parent {jurisdiction.parent} is unknown")
        self.jurisdictions[jurisdiction.id] = jurisdiction
        return jurisdiction

    def chain(self, jurisdiction: str) -> list[str]:
        out, at = [], jurisdiction
        while at:
            if at not in self.jurisdictions:
                raise LawError(f"no jurisdiction {at}")
            out.append(at)
            at = self.jurisdictions[at].parent
        return out

    def treasury(self, jurisdiction: str) -> str:
        return f"treasury:{jurisdiction}"

    # ---- making law ----------------------------------------------------------------------
    def enact(self, law_id: str, jurisdiction: str, title: str, text: str, rules: list[Rule], *,
              effective_at: float, enacted_by: str) -> Law:
        """A new law, or a new version of one (its earlier versions stay in the history)."""
        if jurisdiction not in self.jurisdictions:
            raise LawError(f"no jurisdiction {jurisdiction}")
        if not rules:
            raise LawError("a law must change something the world does; debate needs no enactment")
        checked = tuple(rule.validate() for rule in rules)
        versions = self.laws.setdefault(law_id, [])
        if versions and versions[-1].jurisdiction != jurisdiction:
            raise LawError(f"{law_id} belongs to {versions[-1].jurisdiction}")
        law = Law(law_id, len(versions) + 1, jurisdiction, title, text, checked, float(effective_at), enacted_by)
        versions.append(law)
        return law

    def repeal(self, law_id: str, *, effective_at: float, enacted_by: str) -> Law:
        current = self.laws.get(law_id)
        if not current:
            raise LawError(f"no law {law_id}")
        last = current[-1]
        law = Law(law_id, last.version + 1, last.jurisdiction, last.title, last.text, last.rules,
                  float(effective_at), enacted_by, repealed=True)
        current.append(law)
        return law

    def in_force(self, jurisdiction: str, at: float) -> list[Law]:
        """The version of each of this jurisdiction's laws in force at ``at``."""
        out = []
        for versions in self.laws.values():
            live = [v for v in versions if v.jurisdiction == jurisdiction and v.effective_at <= at]
            if live and not live[-1].repealed:
                out.append(live[-1])
        return out

    # ---- asking the law ------------------------------------------------------------------
    def value(self, kind: str, key: str, jurisdiction: str, at: float, default: Any = None) -> Any:
        for place in self.chain(jurisdiction):
            found = None
            for law in sorted(self.in_force(place, at), key=lambda law: law.effective_at):
                for rule in law.rules:
                    if rule.kind == kind and rule.key == key:
                        found = rule.value
            if found is not None:
                return found
        return BASELINE.get((kind, key), default)

    def tax_rate(self, kind: str, jurisdiction: str, at: float) -> float:
        return float(self.value("tax_rate", kind, jurisdiction, at, 0.0))

    def speed_limit_ms(self, road_class: str, jurisdiction: str, at: float) -> float:
        return float(self.value("speed_limit_kmh", road_class, jurisdiction, at, 40)) / 3.6

    def zoning(self, district: str, jurisdiction: str, at: float) -> dict | None:
        return self.value("zoning", district, jurisdiction, at)

    def fine(self, offence: str, jurisdiction: str, at: float) -> int:
        return int(self.value("fine", offence, jurisdiction, at, 0))

    def permits_building(self, district: str, use: str, height_m: float, floors: int, jurisdiction: str,
                         at: float) -> list[str]:
        """Why a proposed building would be refused a permit here (empty: it may be built)."""
        rules = self.zoning(district, jurisdiction, at)
        if rules is None:
            return [f"no zoning in force for {district!r}"]
        problems = []
        if use not in rules["uses"]:
            problems.append(f"{use} is not permitted in {district} ({', '.join(sorted(rules['uses']))})")
        if height_m > rules["max_height_m"]:
            problems.append(f"{height_m:.0f} m is over the {rules['max_height_m']} m limit")
        if floors > rules["max_floors"]:
            problems.append(f"{floors} floors is over the {rules['max_floors']}-floor limit")
        return problems

    # ---- persistence ---------------------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "jurisdictions": [j.__dict__ for j in self.jurisdictions.values()],
            "laws": {lid: [{**v.__dict__, "rules": [r.__dict__ for r in v.rules]} for v in versions]
                     for lid, versions in self.laws.items()},
        }

    @classmethod
    def from_dict(cls, data: dict) -> LawBook:
        book = cls()
        for j in data["jurisdictions"]:
            book.add_jurisdiction(Jurisdiction(**j))
        for lid, versions in data["laws"].items():
            book.laws[lid] = [Law(**{**v, "rules": tuple(Rule(**r).validate() for r in v["rules"])})
                              for v in versions]
        return book


# ---- offences and enforcement ------------------------------------------------------------
@dataclass(frozen=True)
class Offence:
    id: int
    kind: str
    offender: str
    at: float
    jurisdiction: str
    where: tuple[float, float] | None = None
    #: who or what saw it: a witness, a camera, a patrol, the offender's own record (a ledger)
    evidence: tuple[str, ...] = ()
    detail: str = ""


@dataclass
class Enforcement:
    """Records offences and settles the simple ones by the fine the law in force sets."""

    laws: LawBook
    ledger: Ledger
    offences: list[Offence] = field(default_factory=list)
    #: offence id -> (amount, paid)
    fines: dict[int, list[int]] = field(default_factory=dict)

    def report(self, kind: str, offender: str, *, at: float, jurisdiction: str,
               where: tuple[float, float] | None = None, evidence: tuple[str, ...] = (), detail: str = "") -> Offence:
        if kind not in OFFENCES:
            raise LawError(f"no offence {kind!r}")
        if not evidence:
            raise LawError("an offence is recorded on evidence: who or what saw it")
        offence = Offence(len(self.offences) + 1, kind, offender, float(at), jurisdiction, where, tuple(evidence), detail)
        self.offences.append(offence)
        return offence

    def fine(self, offence: Offence) -> tuple[int, int]:
        """Charge the fine in force; returns (fine, paid now). The rest stays owed."""
        amount = self.laws.fine(offence.kind, offence.jurisdiction, offence.at)
        treasury = self.laws.treasury(offence.jurisdiction)
        self.ledger.open(treasury, kind="treasury")
        paid = 0
        if amount and self.ledger.has(offence.offender):
            paid = min(amount, self.ledger.balance(offence.offender))
            if paid:
                try:
                    self.ledger.transfer(offence.offender, treasury, paid, kind="fine",
                                         memo=f"{offence.kind} #{offence.id}", at=offence.at,
                                         key=f"fine:{offence.id}")
                except InsufficientFunds:  # pragma: no cover - checked above
                    paid = 0
        self.fines[offence.id] = [amount, paid]
        return amount, paid

    def owed(self, offender: str) -> int:
        by_id = {o.id: o for o in self.offences}
        return sum(amount - paid for oid, (amount, paid) in self.fines.items() if by_id[oid].offender == offender)

    def pay(self, offender: str, *, at: float) -> int:
        """Pay what is owed, oldest first, as far as the balance goes; returns the amount paid."""
        total = 0
        for offence in self.offences:
            if offence.offender != offender or offence.id not in self.fines:
                continue
            amount, paid = self.fines[offence.id]
            due = min(amount - paid, self.ledger.balance(offender))
            if due > 0:
                self.ledger.transfer(offender, self.laws.treasury(offence.jurisdiction), due, kind="fine",
                                     memo=f"{offence.kind} #{offence.id}", at=at)
                self.fines[offence.id][1] += due
                total += due
        return total
