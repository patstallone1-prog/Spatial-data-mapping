"""The facade a photograph shows, matched to the closest render the page can draw.

A colour sampled off a photograph says what a wall is painted; it says nothing about whether
it is stucco, brick or curtain wall, or how many storeys of windows it carries. The renderer
has a small catalogue of facade renders (its ``MATERIALS`` and the window textures made for
each), and until now chose among them with a seeded die. This module keeps what the
photograph showed as a *fingerprint* -- a handful of numbers about the rectified wall -- and
picks the catalogue entry nearest to it.

The fingerprint is the thing that lasts. It is measured once from the photographs
(scripts/build_facade_fingerprints.py) and stored; the catalogue is a table in this file.
When a render is added -- a new brick, a bay-windowed Victorian, a mid-century curtain wall
-- it is described in the same terms and the match improves for every building already
fingerprinted, without a photograph being fetched again.

What is measured, all from the rectified wall patch with the sky and the road already
excluded:

* ``lightness`` and ``saturation`` of the wall's median colour, and its ``hue`` in degrees;
* ``glazing``: the share of the wall that is dark or blue-grey and reflective -- the windows,
  and on a curtain wall nearly everything;
* ``texture``: how much fine detail the wall has (mean gradient magnitude at 8 px/m); stucco
  has almost none, brick and siding a great deal;
* ``storeys``: how many rows of windows per metre the wall repeats at, from the autocorrelation
  of its row-mean lightness; ``bays`` likewise across;
* ``sd``: the spread of lightness -- a plain wall is flat, a wall of windows is not.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

#: The renders the page has. ``proto`` is where each sits in fingerprint space; the weights say
#: how much each axis is trusted. Names match the renderer's ``MATERIALS`` table exactly.
CATALOGUE: list[dict] = [
    # Fitted to 39 labelled walls (data/sf_public_works/facade_labels.json, two rounds;
    # scripts/label_facade_walls.py fit): each prototype is the median fingerprint of the
    # walls labelled with it. "Painted" is not a class the fingerprint can see -- paint is a
    # colour, and the colour is sampled separately -- so painted walls are stucco here and the
    # sampled tint says the rest. Glass and metal had no labelled walls yet and keep their
    # written prototypes.
    {"material": "stucco", "proto": {"glazing": 0.213, "texture": 0.162, "saturation": 0.166,
                                     "lightness": 0.349, "sd": 0.132}, "hue": 42.5},
    {"material": "concrete", "proto": {"glazing": 0.330, "texture": 0.115, "saturation": 0.065,
                                       "lightness": 0.480, "sd": 0.237}, "hue": None},
    {"material": "brick", "proto": {"glazing": 0.273, "texture": 0.250, "saturation": 0.240,
                                    "lightness": 0.296, "sd": 0.197}, "hue": 26.3},
    {"material": "glass", "proto": {"glazing": 0.62, "texture": 0.12, "saturation": 0.14,
                                    "lightness": 0.45, "sd": 0.20}, "hue": 205.0},
    {"material": "metal", "proto": {"glazing": 0.30, "texture": 0.05, "saturation": 0.05,
                                    "lightness": 0.62, "sd": 0.08}, "hue": None},
]

#: Lightness carries no weight: a street-level frame is exposed for the sky, and the same
#: stucco wall reads 0.36 in one frame and 0.7 in another. The first 4,300 fingerprints had a
#: median lightness of 0.36 on low-rise houses, and with lightness in the distance the
#: catalogue called 3% of them stucco in a city whose stock is two-fifths stucco.
WEIGHTS = {"glazing": 3.0, "texture": 2.5, "saturation": 2.0, "lightness": 0.0, "sd": 1.0}
#: A hue is only evidence for a render that has one (brick is red, curtain wall is blue-grey),
#: and only when the wall is saturated enough for its hue to mean anything.
HUE_WEIGHT = 1.5
HUE_MIN_SATURATION = 0.12
#: The match is refused -- the die keeps choosing -- when the nearest render is this far off.
MAX_DISTANCE = 1.6
#: What is known about the catalogue so far, so nobody reads a match as a measurement: the
#: prototypes were written from what each render looks like, not fitted to labelled walls,
#: and the first corridor-wide pass matched far more concrete and glass than the building
#: stock has. Until the prototypes are fitted to a labelled set of rectified walls, the page
#: believes a match only at FACADE_MATCH_MIN_CONFIDENCE (0.75) -- see the renderer.
CATALOGUE_STATUS = ("fitted to 39 labelled walls: leave-one-out 26 of 39 right (majority class 21), "
                    "concrete 9/9, brick 7/9, stucco 10/21; at confidence 0.6 and above, 14 of 18. "
                    "The page believes a match from 0.6 (FACADE_MATCH_MIN_CONFIDENCE). Glass and "
                    "metal are unfitted: no labelled wall of either yet.")



@dataclass(frozen=True)
class Fingerprint:
    lightness: float
    saturation: float
    hue: float
    glazing: float
    texture: float
    sd: float
    storeys_per_m: float | None = None
    bays_per_m: float | None = None
    views: int = 1

    @classmethod
    def from_json(cls, row: dict) -> Fingerprint:
        return cls(
            lightness=float(row["l"]), saturation=float(row["s"]), hue=float(row["h"]),
            glazing=float(row["g"]), texture=float(row["t"]), sd=float(row["sd"]),
            storeys_per_m=row.get("rows"), bays_per_m=row.get("cols"), views=int(row.get("n", 1)),
        )

    def to_json(self) -> dict:
        out = {"l": round(self.lightness, 3), "s": round(self.saturation, 3),
               "h": round(self.hue, 1), "g": round(self.glazing, 3),
               "t": round(self.texture, 3), "sd": round(self.sd, 3), "n": self.views}
        if self.storeys_per_m is not None:
            out["rows"] = round(self.storeys_per_m, 3)
        if self.bays_per_m is not None:
            out["cols"] = round(self.bays_per_m, 3)
        return out


@dataclass(frozen=True)
class Match:
    material: str
    distance: float
    confidence: float
    runner_up: str | None
    storey_m: float | None
    bay_m: float | None

    def to_json(self) -> dict:
        out = {"m": self.material, "conf": round(self.confidence, 2), "d": round(self.distance, 2)}
        if self.runner_up:
            out["next"] = self.runner_up
        if self.storey_m:
            out["storey_m"] = round(self.storey_m, 2)
        if self.bay_m:
            out["bay_m"] = round(self.bay_m, 2)
        return out


def _hue_gap(a: float, b: float) -> float:
    d = abs(a - b) % 360.0
    return min(d, 360.0 - d) / 180.0


def distance(fp: Fingerprint, entry: dict) -> float:
    """Weighted distance from a fingerprint to a catalogue render."""
    proto = entry["proto"]
    values = {"glazing": fp.glazing, "texture": fp.texture, "saturation": fp.saturation,
              "lightness": fp.lightness, "sd": fp.sd}
    total = 0.0
    for axis, weight in WEIGHTS.items():
        total += weight * (values[axis] - proto[axis]) ** 2
    if entry.get("hue") is not None and fp.saturation >= HUE_MIN_SATURATION:
        total += HUE_WEIGHT * _hue_gap(fp.hue, entry["hue"]) ** 2
    return math.sqrt(total)


def closest_render(fp: Fingerprint, catalogue: list[dict] | None = None) -> Match:
    """The nearest render, with how sure the choice is: the gap to the runner-up over the gap
    the two would have if they were far apart. A fingerprint equally close to two renders is
    matched to the nearer one at low confidence, and the page keeps its die."""
    entries = catalogue or CATALOGUE
    scored = sorted((distance(fp, e), e["material"]) for e in entries)
    best, name = scored[0]
    second = scored[1][0] if len(scored) > 1 else best + 1.0
    margin = (second - best) / max(second, 1e-6)
    confidence = 0.0 if best > MAX_DISTANCE else max(0.0, min(1.0, 0.35 + margin * 1.3 - best * 0.25))
    storey = 1.0 / fp.storeys_per_m if fp.storeys_per_m and 0.15 <= fp.storeys_per_m <= 0.6 else None
    bay = 1.0 / fp.bays_per_m if fp.bays_per_m and 0.1 <= fp.bays_per_m <= 0.8 else None
    return Match(name, best, confidence, scored[1][1] if len(scored) > 1 else None, storey, bay)


def describe(fp: Fingerprint) -> dict:
    return asdict(fp)
