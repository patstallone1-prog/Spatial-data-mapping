"""Areas, corridors, paths and the credentials the lab may use."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("KERBFRONT_CACHE", LAB / ".cache"))
OUT = Path(os.environ.get("KERBFRONT_OUT", LAB / "out"))
USER_AGENT = "kerbside-storefront-lab/0.1 (+research; contact via repository)"


@dataclass(frozen=True)
class BBox:
    south: float
    west: float
    north: float
    east: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.south <= lat <= self.north and self.west <= lon <= self.east

    @property
    def centre(self) -> tuple[float, float]:
        return (self.south + self.north) / 2, (self.west + self.east) / 2

    def key(self) -> str:
        return f"{self.south:.4f}_{self.west:.4f}_{self.north:.4f}_{self.east:.4f}"


#: The Marina as the user framed it: Marina Blvd south to Lombard, Lyon east to Van Ness.
#: Lombard's south frontage is included (its buildings face Lombard), so the box runs a block
#: south of the street's centreline.
MARINA = BBox(south=37.7975, west=-122.4480, north=37.8085, east=-122.4235)

#: Union Street (Cow Hollow) is the corridor the user named alongside Chestnut and Lombard;
#: it sits just south of the Marina box, so the extended area adds one more block band.
MARINA_PLUS_UNION = BBox(south=37.7950, west=-122.4480, north=37.8085, east=-122.4235)

AREAS = {"marina": MARINA, "marina-union": MARINA_PLUS_UNION}

#: Priority corridors, highest first. Matched against the normalized street of an address.
CORRIDORS = (
    ("chestnut", "CHESTNUT"),
    ("lombard", "LOMBARD"),
    ("union", "UNION"),
    ("fillmore", "FILLMORE"),
    ("steiner", "STEINER"),
    ("divisadero", "DIVISADERO"),
    ("scott", "SCOTT"),
)


def corridor_of(street: str | None) -> str | None:
    if not street:
        return None
    for name, token in CORRIDORS:
        if street.upper().startswith(token):
            return name
    return None


def kerbside_root() -> Path:
    """The main Kerbside checkout, whose ``data/`` the lab reads (never writes).

    A worktree's ``git rev-parse --git-common-dir`` points at the main checkout's ``.git``;
    ``KERBSIDE_ROOT`` overrides it.
    """
    if os.environ.get("KERBSIDE_ROOT"):
        return Path(os.environ["KERBSIDE_ROOT"])
    try:
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=LAB,
                                capture_output=True, text=True, check=True).stdout.strip()
        return (LAB / common).resolve().parent
    except (OSError, subprocess.CalledProcessError):
        return LAB.parent


def secret(name: str) -> str | None:
    """An environment value, else the same key in the main checkout's ``.env.local``.

    Only the named key is read; values are never logged. ``GOOGLE_MAPS_API_KEY`` is refused
    unless ``KERBFRONT_ALLOW_GOOGLE=1`` is set, because using it needs the owner's go-ahead.
    """
    if name == "GOOGLE_MAPS_API_KEY" and os.environ.get("KERBFRONT_ALLOW_GOOGLE") != "1":
        return None
    if os.environ.get(name):
        return os.environ[name]
    env = kerbside_root() / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip("'\"") or None
    return None
