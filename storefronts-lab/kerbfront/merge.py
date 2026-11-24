"""Entity resolution and field fusion: one record per business, provenance on every field.

Each source row becomes an *observation* (source, id, name, point, parsed address, attrs).
Observations are linked when they name the same business at the same place:

* same parsed address (number range overlap, same street) and name similarity >= 0.6, or
* within 40 m and name similarity >= 0.85, or
* same brand Wikidata id within 60 m.

Two observations from one source are never linked unless their names agree (>= 0.85) at the
same address, so a cluster cannot chain two different registry tenants together.

Every field keeps all candidate values. The chosen value's confidence is
``support * (1 - 0.6 * opposition)`` where support and opposition are noisy-OR combinations of
the source priors in ``PRIORS`` for agreeing and disagreeing values. Priors are judgements
about each source's reliability for that field, written down so they can be argued with,
not measured accuracies.
"""

from __future__ import annotations

import hashlib
import math
from collections import defaultdict

from .normalize import name_key, name_sim, same_address

#: Source reliability per field (default under "*").
PRIORS = {
    "osm": {"*": 0.7, "name": 0.8, "outdoor_seating": 0.65, "cuisine": 0.75,
            "opening_hours": 0.6, "position": 0.85},
    "overture": {"*": 0.6, "name": 0.75, "category": 0.65, "website": 0.7, "position": 0.6},
    "registry": {"*": 0.6, "name": 0.6, "legal_name": 0.95, "naics": 0.7,
                 "location_start_date": 0.85, "position": 0.45},
    "shared_spaces": {"*": 0.8, "name": 0.7, "sidewalk_tables": 0.9, "display_merchandise": 0.9,
                      "position": 0.5},
    "parklet": {"*": 0.85, "parklet": 0.95, "position": 0.6},
}

#: NAICS prefixes for trades that usually face the street.
#: 6213 (therapists, psychologists) is left out: on Union Street it is mostly upstairs suites.
STOREFRONT_NAICS = ("44", "45", "722", "8121", "8123", "5221", "7139", "4539", "8129", "7211")


def prior(source: str, field: str) -> float:
    p = PRIORS.get(source, {"*": 0.5})
    return p.get(field, p["*"])


class _DSU:
    def __init__(self, n: int):
        self.p = list(range(n))

    def find(self, i: int) -> int:
        while self.p[i] != i:
            self.p[i] = self.p[self.p[i]]
            i = self.p[i]
        return i


def _dist_m(a: dict, b: dict) -> float:
    if a.get("lat") is None or b.get("lat") is None:
        return 1e9
    dy = (a["lat"] - b["lat"]) * 111320.0
    dx = (a["lon"] - b["lon"]) * 111320.0 * math.cos(math.radians(a["lat"]))
    return math.hypot(dx, dy)


def linked(a: dict, b: dict) -> bool:
    sim = max(name_sim(a["name"], b["name"]),
              *(name_sim(x, y) for x in a.get("alt_names", []) + [a["name"]]
                for y in b.get("alt_names", []) + [b["name"]]))
    addr = same_address(a.get("address"), b.get("address"))
    d = _dist_m(a, b)
    if a["source"] == b["source"]:
        return addr and sim >= 0.85
    if addr and sim >= 0.6:
        return True
    if d <= 40 and sim >= 0.85:
        return True
    wa, wb = a["attrs"].get("brand_wikidata"), b["attrs"].get("brand_wikidata")
    return bool(wa and wa == wb and d <= 60)


def cluster(obs: list[dict]) -> list[list[dict]]:
    n = len(obs)
    dsu = _DSU(n)
    members: dict[int, list[int]] = {i: [i] for i in range(n)}
    # block by street and by ~50 m grid cell to keep pair checks local
    buckets: dict[tuple, list[int]] = defaultdict(list)
    for i, o in enumerate(obs):
        a = o.get("address")
        if a:  # address matches need overlapping numbers: bucket by tens on that street
            for tens in {a["number"] // 10, (a["number_hi"] or a["number"]) // 10}:
                buckets[("st", a["street"], tens)].append(i)
        if o.get("lat") is not None:
            buckets[("g", round(o["lat"] / 0.0005), round(o["lon"] / 0.0006))].append(i)
    pairs = set()
    for idx in buckets.values():
        for x in range(len(idx)):
            for y in range(x + 1, len(idx)):
                pairs.add((idx[x], idx[y]))
    for i, j in sorted(pairs):
        ri, rj = dsu.find(i), dsu.find(j)
        if ri == rj or not linked(obs[i], obs[j]):
            continue
        # refuse a union that would put two clearly different same-source rows together
        bad = any(obs[x]["source"] == obs[y]["source"] and
                  name_sim(obs[x]["name"], obs[y]["name"]) < 0.6
                  for x in members[ri] for y in members[rj])
        if bad:
            continue
        dsu.p[rj] = ri
        members[ri].extend(members.pop(rj))
    return [[obs[i] for i in m] for m in members.values()]


def _norm_value(v):
    if isinstance(v, (list, tuple)):
        return tuple(_norm_value(x) for x in v)
    if isinstance(v, dict):
        return tuple(sorted((k, str(x)) for k, x in v.items()))
    if isinstance(v, str):
        return name_key(v) or v.strip().lower()
    return v


def fuse(field: str, cands: list[tuple]) -> dict | None:
    """cands: (value, source, source_id, retrieved_at) -> {value, confidence, sources, conflicts}."""
    cands = [c for c in cands if c[0] not in (None, "", [])]
    if not cands:
        return None
    groups: dict = defaultdict(list)
    for c in cands:
        groups[_norm_value(c[0])].append(c)

    def noisy_or(cs: list[tuple]) -> float:
        by_src: dict[str, float] = {}
        for c in cs:  # one vote per source
            by_src[c[1]] = max(by_src.get(c[1], 0.0), prior(c[1], field))
        q = 1.0
        for w in by_src.values():
            q *= 1 - w
        return 1 - q

    scored = sorted(((noisy_or(cs), k, cs) for k, cs in groups.items()), key=lambda t: -t[0])
    best_s, _, best = scored[0]
    others = [cs for _, _, cs in scored[1:]]
    opp = noisy_or([c for cs in others for c in cs]) if others else 0.0
    value = max(best, key=lambda c: prior(c[1], field))[0]
    return {"value": value, "confidence": round(best_s * (1 - 0.6 * opp), 3),
            "sources": [{"source": c[1], "id": c[2], "retrieved_at": c[3]} for c in best],
            "conflicts": [{"value": cs[0][0], "sources": sorted({c[1] for c in cs})}
                          for cs in others]}


#: Overture top-level classes: street-facing trades vs. ones that are often upstairs offices.
OVERTURE_STREET = {"food_and_drink", "shopping", "lifestyle_services", "lodging"}
OVERTURE_MIXED = {"health_care", "sports_and_recreation", "arts_and_entertainment",
                  "services_and_business", "cultural_and_historic"}
OSM_STREET_AMENITY = {"restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "bank",
                      "pharmacy", "biergarten", "nightclub", "cinema", "theatre", "dentist",
                      "clinic", "veterinary", "post_office", "bureau_de_change", "car_rental",
                      "fuel", "marketplace"}


def storefront_likelihood(rec: dict, obs: list[dict]) -> tuple[float, list[str]]:
    """Evidence that a business occupies a ground-floor shopfront (before building context)."""
    s, why = 0.0, []
    for o in obs:
        if o["source"] != "osm":
            continue
        kind = o["attrs"].get("osm_kind") or ""
        k, _, v = kind.partition("=")
        if k in ("shop", "craft") or (k == "amenity" and v in OSM_STREET_AMENITY) or \
                k in ("healthcare", "tourism", "leisure"):
            s += 0.35
            why.append("osm_storefront_poi")
        elif k == "office":
            s += 0.1
            why.append("osm_office")
        break
    for o in obs:
        if o["source"] == "overture" and (o["attrs"].get("confidence") or 0) >= 0.5:
            top = (o["attrs"].get("category_path") or [""])[0]
            if top in OVERTURE_STREET:
                s += 0.3
                why.append("overture_street_trade")
            elif top in OVERTURE_MIXED:
                s += 0.15
                why.append("overture_mixed_trade")
            break
    if {o["source"] for o in obs} & {"shared_spaces", "parklet"}:
        s += 0.3
        why.append("sidewalk_or_parklet_permit")
    for o in obs:
        if o["source"] == "registry":
            naics = o["attrs"].get("naics") or ""
            if naics.startswith(STOREFRONT_NAICS):
                s += 0.2
                why.append("storefront_naics")
            if o["attrs"].get("business_corridor"):
                s += 0.1
                why.append("registered_in_business_corridor")
            break
    if any(o.get("address") and o["address"].get("upper_floor") for o in obs):
        s -= 0.35
        why.append("upper_floor_unit")
    elif any(o.get("address") and o["address"].get("suite") for o in obs):
        s -= 0.1
        why.append("suite_unit")
    status = str((rec.get("operating_status") or {}).get("value") or "")
    if "closed" in status:
        s -= 0.6
        why.append("reported_closed")
    return max(0.0, min(1.0, s)), why


FIELDS = ("name", "legal_name", "category", "category_path", "osm_kind", "brand",
          "brand_wikidata", "naics", "license_codes", "website", "phone", "opening_hours",
          "cuisine", "outdoor_seating", "sidewalk_tables", "display_merchandise", "parklet",
          "sidewalk_width_ft", "wheelchair", "operating_status", "location_start_date",
          "business_corridor", "osm_building_tags")


def merge(obs: list[dict]) -> list[dict]:
    out = []
    for group in cluster(obs):
        rec: dict = {}
        for f in FIELDS:
            src_field = "name" if f == "name" else f
            cands = []
            for o in group:
                v = o["name"] if f == "name" else o["attrs"].get(src_field)
                if f == "name" and o["source"] == "registry":
                    v = o["name"]  # the DBA; the legal owner name is legal_name
                cands.append((v, o["source"], o["source_id"], o.get("retrieved_at")))
            fused = fuse(f, cands)
            if fused:
                rec[f] = fused
        # position: best-prior source wins; address: most common parse
        pos = max((o for o in group if o.get("lat") is not None),
                  key=lambda o: prior(o["source"], "position"), default=None)
        addrs = [o["address"] for o in group if o.get("address")]
        street_addr = max(addrs, key=lambda a: sum(same_address(a, b) for b in addrs)) if addrs else None
        key = "|".join(sorted(f"{o['source']}:{o['source_id']}" for o in group))
        likelihood, why = storefront_likelihood(rec, group)
        out.append({
            "id": "mb-" + hashlib.sha1(key.encode()).hexdigest()[:12],
            "fields": rec,
            "address": street_addr,
            "position": {"lat": pos["lat"], "lon": pos["lon"], "source": pos["source"]} if pos else None,
            "sources": sorted({o["source"] for o in group}),
            "observations": [{"source": o["source"], "id": o["source_id"], "name": o["name"]}
                             for o in group],
            "storefront_likelihood": round(likelihood, 2),
            "storefront_evidence": why,
        })
    return out
