"""The one currency the simulation runs on -- a placeholder until the real one is chosen.

Every amount in ``smc.city`` is an ``int`` of this currency's smallest unit (two decimal places:
``money(35)`` is a simple meal, 3500 minor units). Nothing else in the package names a
currency: swapping the placeholder for the real one is changing ``CURRENCY`` here (its code,
symbol, name and minor units) and, if the minor units change, migrating stored balances.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal


@dataclass(frozen=True)
class Currency:
    code: str
    symbol: str
    name: str
    #: Decimal places of the smallest unit every amount is counted in.
    minor_units: int
    #: True while this is a stand-in: the world's economy works, the name and units may change.
    placeholder: bool = False

    @property
    def scale(self) -> int:
        return 10**self.minor_units

    def to_minor(self, whole: int | float | str | Decimal) -> int:
        """An amount in whole units (``35``, ``"12.50"``) as minor units, rounded half to even."""
        value = (Decimal(str(whole)) * self.scale).quantize(Decimal(1), rounding=ROUND_HALF_EVEN)
        return int(value)

    def format(self, minor: int) -> str:
        sign = "-" if minor < 0 else ""
        whole, part = divmod(abs(int(minor)), self.scale)
        text = f"{whole:,}" if not self.minor_units else f"{whole:,}.{part:0{self.minor_units}d}"
        return f"{sign}{self.symbol}{text}"


#: Kerbside Credits: the placeholder the economy is built against.
CREDITS = Currency(code="KCR", symbol="₡", name="Credits", minor_units=2, placeholder=True)
#: The currency of the world. Replace here; nothing else names one.
CURRENCY = CREDITS


def money(whole: int | float | str | Decimal) -> int:
    """Whole units of the world's currency as the minor units every ledger amount is kept in."""
    return CURRENCY.to_minor(whole)


def fmt(minor: int) -> str:
    return CURRENCY.format(minor)
