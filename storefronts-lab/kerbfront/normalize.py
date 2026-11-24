"""Name and address normalization shared by every source."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

SUFFIX = {"STREET": "ST", "ST": "ST", "AVENUE": "AVE", "AVE": "AVE", "AV": "AVE",
          "BOULEVARD": "BLVD", "BLVD": "BLVD", "PLACE": "PL", "PL": "PL", "COURT": "CT",
          "CT": "CT", "TERRACE": "TER", "TER": "TER", "LANE": "LN", "LN": "LN", "ALLEY": "ALY",
          "ALY": "ALY", "WAY": "WAY", "DRIVE": "DR", "DR": "DR", "ROAD": "RD", "RD": "RD"}
LEGAL = {"inc", "llc", "llp", "lp", "co", "corp", "corporation", "company", "ltd", "the", "dba",
         "sf", "san", "francisco", "of", "a"}
UPPER_UNIT = re.compile(r"^(?:(?:STE|SUITE|UNIT|#)\s*#?\s*[2-9]\d{2}[A-Z]?|[2-9](?:ND|RD|TH)?\s*(?:FL|FLR|FLOOR)|"
                        r"(?:FL|FLR|FLOOR)\s*[2-9]|PH|PENTHOUSE)$")
SUITE_UNIT = re.compile(r"^(?:STE|SUITE|RM|ROOM|UNIT|OFC|OFFICE)\b")


def name_key(name: str | None) -> str:
    if not name:
        return ""
    s = name.lower().replace("&", " and ").replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [t for t in s.split() if t not in LEGAL]
    return " ".join(toks)


def name_sim(a: str | None, b: str | None) -> float:
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    ca, cb = ka.replace(" ", ""), kb.replace(" ", "")
    if len(ca) >= 4 and len(cb) >= 4 and (ca in cb or cb in ca):
        return 0.9
    ta, tb = set(ka.split()), set(kb.split())
    jac = len(ta & tb) / len(ta | tb)
    return max(jac, SequenceMatcher(None, ca, cb).ratio())


def street_key(street: str | None) -> str | None:
    if not street:
        return None
    toks = re.sub(r"[^A-Z0-9 ]+", " ", street.upper()).split()
    if not toks:
        return None
    if toks[-1] in SUFFIX:
        toks[-1] = SUFFIX[toks[-1]]
    return " ".join(toks)


def parse_address(text: str | None) -> dict | None:
    """'2001-2005 Chestnut St #A' -> {number, number_hi, street, unit, upper_floor}."""
    if not text:
        return None
    s = re.sub(r"\s+", " ", text.upper().replace(",", " ")).strip()
    s = re.sub(r"\b(SAN FRANCISCO|CA|94\d{3})\b", " ", s).strip()
    m = re.match(r"^(\d+)(?:\s*-\s*(\d+))?[A-Z]?\s+(.*)$", s)
    if not m:
        return None
    lo, hi, rest = int(m.group(1)), m.group(2), m.group(3)
    toks = re.sub(r"[^A-Z0-9# ]+", " ", rest).split()
    street, unit = [], []
    for i, t in enumerate(toks):
        if t in SUFFIX and street:
            street.append(SUFFIX[t])
            unit = toks[i + 1:]
            break
        street.append(t)
    unit_s = " ".join(u for u in unit if u != "#").strip() or None
    upper = bool(unit_s and UPPER_UNIT.match(unit_s))
    suite = bool(unit_s and not upper and SUITE_UNIT.match(unit_s))
    return {"number": lo, "number_hi": int(hi) if hi else None, "street": " ".join(street),
            "unit": unit_s, "upper_floor": upper, "suite": suite}


def osm_address(tags: dict) -> dict | None:
    hn, st = tags.get("addr:housenumber"), tags.get("addr:street")
    if not hn or not st:
        return None
    return parse_address(f"{hn} {st}" + (f" #{tags['addr:unit']}" if tags.get("addr:unit") else ""))


def same_address(a: dict | None, b: dict | None, slack: int = 0) -> bool:
    if not a or not b or a["street"] != b["street"]:
        return False
    alo, ahi = a["number"], a["number_hi"] or a["number"]
    blo, bhi = b["number"], b["number_hi"] or b["number"]
    return alo - slack <= bhi and blo - slack <= ahi
