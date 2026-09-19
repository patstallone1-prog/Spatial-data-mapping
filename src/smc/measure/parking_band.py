"""The parking lane as a measured band: where the parked cars actually stand.

The city's parking policies say where cars *may* park. Where they *do* park, and how far into
the road they reach, is a physical band beside the kerb that only observation gives. This
takes the footprints of vehicles seen in street imagery -- each one already projected onto the
ground plane and expressed as how far from the kerb its road-side edge lies -- and turns many
such observations, over several dates, into one band with a width, a confidence and a reason
to refuse.

The rules encode the pitfalls named in the plan:

* one day says nothing: a band needs ``MIN_DATES`` distinct capture dates and ``MIN_VEHICLES``
  vehicles, or it is ``inferred`` only;
* a moving vehicle is not parking: an observation flagged as moving is dropped before
  anything is counted;
* a vehicle whose road-side edge lies further out than any parking lane can reach
  (``MAX_REACH_M``) is a vehicle in the traffic lane, and is dropped too;
* the band's outer edge is a high percentile of the remaining edges, not their maximum -- the
  maximum is the one van parked crooked -- and not their mean, which would put the line
  through the middle of the parked cars.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

MIN_DATES = 3
MIN_VEHICLES = 8
#: Nothing parked parallel to a kerb reaches further than this into the road; anything beyond
#: is in the traffic lane (or is angled parking, which is its own band).
MAX_REACH_M = 3.2
#: The road-side edge of the band is this percentile of the vehicles' road-side edges.
EDGE_PERCENTILE = 0.85
#: The band cannot be narrower than a car.
MIN_BAND_M = 1.7


@dataclass(frozen=True)
class VehicleObservation:
    """One vehicle seen once: how far its road-side edge stands from the kerb, on which
    date, and whether it was moving between frames."""

    reach_m: float
    observed_on: date
    moving: bool = False


@dataclass(frozen=True)
class ParkingBand:
    width_m: float | None
    sigma_m: float
    vehicles: int
    dates: int
    status: str           # measured | too_few | none
    reason: str = ""


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("no values")
    k = (len(ordered) - 1) * share
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def parking_band(observations: list[VehicleObservation]) -> ParkingBand:
    """Measure the band from many observations of one block face.

    ``status == "measured"`` carries a width; ``"too_few"`` says how many observations and
    dates there were and leaves the width to the prior; ``"none"`` is a face with enough
    observation to say that nothing parks there.
    """
    parked = [o for o in observations if not o.moving and 0.3 <= o.reach_m <= MAX_REACH_M]
    dates = {o.observed_on for o in parked}
    if len(parked) < MIN_VEHICLES or len(dates) < MIN_DATES:
        # Enough looking and nothing parked is a finding; too little looking is not.
        looked = {o.observed_on for o in observations if not o.moving}
        if len(observations) >= 3 * MIN_VEHICLES and len(looked) >= MIN_DATES and len(parked) <= 1:
            return ParkingBand(None, 0.0, len(parked), len(looked), "none",
                               "vehicles seen on several dates, none of them parked here")
        return ParkingBand(None, 0.0, len(parked), len(dates), "too_few",
                           f"{len(parked)} parked vehicles over {len(dates)} dates; "
                           f"need {MIN_VEHICLES} over {MIN_DATES}")
    reaches = [o.reach_m for o in parked]
    edge = max(MIN_BAND_M, percentile(reaches, EDGE_PERCENTILE))
    # The spread of the edges is the measurement's own uncertainty; a crooked van widens it.
    q25, q75 = percentile(reaches, 0.25), percentile(reaches, 0.75)
    sigma = max(0.05, (q75 - q25) / 1.35 / max(1.0, len(parked) ** 0.5) + 0.05)
    return ParkingBand(round(edge, 2), round(sigma, 3), len(parked), len(dates), "measured")
