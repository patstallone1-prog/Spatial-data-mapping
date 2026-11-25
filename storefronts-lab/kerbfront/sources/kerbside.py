"""What the live Kerbside app already knows about buildings and businesses.

Read straight from the app's published files at a git ref (``origin/main`` by default, the commit
that is deployed), never from a working tree another session may be editing. The commit SHA is
recorded with everything taken from it.

Per building (OSM way id, the app's canonical shell):

* ``docs/sf-corridor-3d.json`` -- footprint, height (and its source), tenants (``shops``: name,
  type tag, source), address, archetype, parcel, zoning, land use;
* ``docs/sf-corridor-materials.json`` -- wall material class per building (``walls``) and the
  photographed wall colour (``assigned``), both image-inferred;
* ``docs/sf-corridor-home-openings.json`` -- photo-backed windows and doors per wall:
  ``[u, v, w, h, confidence]`` in metres along that wall of the app's ring;
* ``docs/sf-corridor-roofs.json`` -- roof colour from 0.25 m NOAA imagery;
* ``docs/sf-corridor-building-shapes.json`` -- OSM Simple-3D parts and roof shapes;
* ``docs/storefront-exteriors.json`` -- the app's inferred storefront programs (category,
  brand, palette, signage), used as a prior only.

``docs/city/rules.json`` ``stores.tenants`` is the app's own reading of a tenant's name into a
kind of place (``shop_kinds`` is a port of ``shopKinds`` in docs/city/core.mjs). A rule with
kind ``null`` (an LLC, a capital partner, a consultancy) means *office*: no shop is drawn for
it, and the lab renders its building as a plain building.

The Google Places service flags (dine-in, reservable, primary type) the owner paid for on
2026-11-20 live in a git-ignored ``data/restaurant-prices.json``; ``restaurant_services`` finds
the copy on disk and reports where it came from.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from functools import lru_cache
from pathlib import Path

from ..config import CACHE, BBox, kerbside_root

REF = os.environ.get("KERBFRONT_KERBSIDE_REF", "origin/main")
FILES = {
    "world": "docs/sf-corridor-3d.json",
    "materials": "docs/sf-corridor-materials.json",
    "openings": "docs/sf-corridor-home-openings.json",
    "roofs": "docs/sf-corridor-roofs.json",
    "shapes": "docs/sf-corridor-building-shapes.json",
    "names": "docs/sf-corridor-storefront-names.json",
    "exteriors": "docs/storefront-exteriors.json",
    "rules": "docs/city/rules.json",
}


def _git(*args: str) -> bytes:
    return subprocess.run(["git", "-C", str(kerbside_root()), *args], check=True,
                          capture_output=True).stdout


@lru_cache(maxsize=1)
def commit(ref: str = REF) -> str:
    return _git("rev-parse", ref).decode().strip()


@lru_cache(maxsize=None)
def _file(key: str, ref: str = REF) -> dict:
    sha = commit(ref)
    path = CACHE / "kerbside" / sha[:12] / Path(FILES[key]).name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        # atomic: parallel workers (opus-run shards) may fill the same cache at once
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        tmp.write_bytes(_git("show", f"{sha}:{FILES[key]}"))
        os.replace(tmp, path)
    return json.loads(path.read_text())


def provenance(ref: str = REF) -> dict:
    return {"dataset": "kerbside-app", "ref": ref, "commit": commit(ref),
            "files": sorted(FILES.values())}


def _inside(points, b: BBox) -> bool:
    lon = sum(p[0] for p in points) / len(points)
    lat = sum(p[1] for p in points) / len(points)
    return b.south <= lat <= b.north and b.west <= lon <= b.east


def buildings(b: BBox, ref: str = REF) -> dict[str, dict]:
    """Every app building in ``b`` with everything the app knows about it, keyed by OSM id."""
    cache = CACHE / "kerbside" / commit(ref)[:12] / f"buildings-{b.south}-{b.west}-{b.north}-{b.east}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    world = _file("world", ref)
    mats, opens, roofs = _file("materials", ref), _file("openings", ref), _file("roofs", ref)
    shapes, names = _file("shapes", ref), _file("names", ref)
    ext = _file("exteriors", ref)["buildings"]
    ext_by_b: dict[str, list] = {}
    for key, p in ext.items():
        ext_by_b.setdefault(str(p.get("id", key)).split(":")[0], []).append(p)
    out: dict[str, dict] = {}
    for w in world["ways"]:
        if w.get("kind") != "building" or not w.get("points") or not _inside(w["points"], b):
            continue
        oid = str(w.get("osm_id"))
        rec = {k: w.get(k) for k in ("osm_id", "name", "height_m", "height_source", "points",
                                      "shops", "address", "archetype", "parcel", "zoning",
                                      "land_use", "tags", "min_height_m", "levels")}
        wall = (mats.get("walls") or {}).get(oid)
        if wall:
            rec["wall_material"] = {"class": wall[0], "confidence": wall[1],
                                    "basis": (mats.get("wall_bases") or {}).get(wall[2], wall[2])}
        a = (mats.get("assigned") or {}).get(oid)
        if a:
            rec["wall_assigned"] = a
        o = (opens.get("buildings") or {}).get(oid)
        if o:
            rec["openings"] = {"walls": o["walls"], "grade": o.get("grade"),
                               "row": "[u, v, w, h, confidence] metres along the app ring's wall"}
        r = (roofs.get("roofs") or {}).get(oid)
        if r:
            rec["roof"] = r
        s = (shapes.get("buildings") or {}).get(oid)
        if s:
            rec["shapes"] = s
        n = (names.get("buildings") or {}).get(oid)
        if n:
            rec["tenant_names"] = n.get("shops")
        if oid in ext_by_b:
            rec["storefront_programs"] = [
                {"facades": [{k: f.get(k) for k in ("edge", "u0", "u1", "name", "category", "brand",
                                                     "band_height_m", "palette", "material",
                                                     "door_style", "signs", "openings")}
                             for f in p.get("facades", [])],
                 "replica_status": p.get("replica_status"), "validation": (p.get("validation") or {}).get("passed")}
                for p in ext_by_b[oid]]
        out[oid] = rec
    cache.write_text(json.dumps(out))
    return out


# ---- the app's reading of a tenant's name ------------------------------------------------------

@lru_cache(maxsize=1)
def _rules(ref: str = REF) -> list[dict]:
    rules = _file("rules", ref)["stores"]["tenants"]
    return [{**t, "re": re.compile(t["pattern"], re.I)} for t in rules]


def shop_kinds(tag: str | None, name: str | None, ref: str = REF) -> list[str]:
    """Port of ``shopKinds(R, tag, name)``: the kinds of place a tenant is. ``[]`` means an
    office (a rule with no kind matched): no shop, a plain building from the street."""
    if not name:
        return [tag] if tag else []
    replaced = alone = False
    added: list[str] = []
    groups: set[str] = set()
    for t in _rules(ref):
        if (t.get("group") and t["group"] in groups) or ((alone or replaced) and not t.get("combines")):
            continue
        if not tag or not (tag in t["replaces"] or "*" in t["replaces"]) or not t["re"].search(name):
            continue
        if not t["kind"]:
            return []
        if t.get("group"):
            groups.add(t["group"])
        replaced = True
        if not t.get("combines"):
            alone = True
        if t["kind"] not in added:
            added.append(t["kind"])
    return added if replaced else [tag]


#: Overture / OSM categories to the app's store kinds (the tag ``shop_kinds`` starts from). Short
#: words are fenced by non-letters: "pho" in mobile_phone_store made T-Mobile a Vietnamese restaurant.
CATEGORY_KINDS = [
    (r"coffee|cafe|tea_room|bubble_tea|juice|smoothie", "cafe"),
    (r"bakery|patisserie|donut|bagel|dessert|cupcake", "bakery"),
    (r"ice_cream|frozen_yogurt|gelato", "ice_cream"),
    (r"pizza", "pizza"),
    (r"mexican|taco|burrito|latin", "mexican"),
    (r"japanese|sushi|ramen|izakaya", "japanese"),
    (r"chinese|dumpling|dim_sum|cantonese|szechuan", "chinese"),
    (r"thai", "thai"), (r"vietnamese|(?<![a-z])pho(?![a-z])", "vietnamese"), (r"indian|nepal", "indian"),
    (r"korean", "korean"), (r"italian", "italian"),
    (r"greek|mediterranean|middle_eastern|lebanese|turkish", "mediterranean"),
    (r"seafood|oyster|poke|fish", "seafood"),
    (r"diner|breakfast|brunch|pancake", "diner"),
    (r"burger|american|bar_and_grill|chicken|wings|steak|bbq|comfort_food|sandwich_shop", "american"),
    (r"deli|sandwich", "deli"),
    (r"wine_bar|cocktail|dive_bar|sports_bar|pub|bar\b|_bar$|^bar$|lounge|brewery|tavern", "bar"),
    (r"restaurant|food", "restaurant"),
    (r"bank|credit_union|atm", "bank"),
    (r"salon|(?<![a-z])hair", "salon"), (r"barber", "barber"), (r"nail", "nail_salon"),
    (r"gym|fitness|yoga|pilates|boxing|barre", "gym"),
    (r"clothing|boutique|fashion|shoe|apparel", "clothing"),
    (r"grocery|supermarket|market", "grocery"), (r"convenience", "convenience"),
    (r"pharmacy|drugstore", "pharmacy"), (r"jewel", "jewelry"), (r"book", "books"),
    (r"florist|flower", "florist"), (r"dry_clean|laundr", "dry_cleaner"),
    (r"dentist|dental", "dentist"), (r"doctor|clinic|medical|health", "clinic"),
    (r"optometrist|optician|eyewear", "optician"), (r"(?<![a-z])pet(?!rol)", "pet"),
    (r"(?<![a-z])spa(?![a-z])|massage|skin|beauty", "spa"), (r"hotel|motel|(?<![a-z])inn(?![a-z])", "hotel"),
]
FOOD_KINDS = {"cafe", "bakery", "restaurant", "american", "diner", "mexican", "japanese",
              "chinese", "thai", "vietnamese", "indian", "korean", "italian", "mediterranean",
              "seafood", "pizza", "ice_cream", "deli", "bar"}


def tag_for(category: str | None, osm_kind: str | None, cuisine: str | None) -> str:
    text = " ".join(x for x in (category, cuisine, (osm_kind or "").split("=")[-1]) if x).lower()
    for pat, kind in CATEGORY_KINDS:
        if re.search(pat, text):
            return kind
    return "shop"


def business_type(z: dict) -> dict:
    """The app's kind of place for a merged business, and how the lab should draw it."""
    v = lambda k: (z["fields"].get(k) or {}).get("value")  # noqa: E731
    name = v("name")
    google = (z.get("services") or {}).get("primaryType")
    tag = tag_for(google or v("category"), v("osm_kind"), v("cuisine"))
    kinds = shop_kinds(tag, name)
    # The app's office rule reads "LLC", "Inc", "partners" in a name as an office. That is right
    # for a bare registry name, wrong for Books Inc. or Williams-Sonoma, Inc.: a map POI or a
    # specific category says it is a shop whatever its legal suffix.
    shop_record = bool(v("osm_kind")) or tag != "shop"
    if not kinds and shop_record:
        kinds = [tag]
    office = not kinds
    upstairs = (z.get("address") or {}).get("upper_floor") or (z.get("occupancy") or {}).get(
        "role") == "previous_or_upstairs"
    render = "plain_building" if office or upstairs or z["storefront_likelihood"] < 0.5 else (
        "restaurant" if set(kinds) & FOOD_KINDS else "storefront")
    return {"tag": tag, "kinds": kinds, "office": office, "render": render,
            "basis": "kerbside rules.json stores.tenants (shopKinds) over the merged name and category"}


# ---- Google service flags the owner already paid for -------------------------------------------

def restaurant_services() -> tuple[dict, dict]:
    """``{osm building id: service flags}`` from the newest ``data/restaurant-prices.json`` with
    a ``services`` section anywhere in the Kerbside checkouts (it is git-ignored)."""
    env = os.environ.get("KERBFRONT_RESTAURANT_SERVICES")
    root = kerbside_root()
    cands = [Path(env)] if env else [root / "data/restaurant-prices.json",
                                     *sorted((root / ".claude/worktrees").glob("*/data/restaurant-prices.json"))]
    best = None
    for p in cands:
        try:
            d = json.loads(p.read_text())
        except (OSError, ValueError):
            continue
        if d.get("services") and (best is None or p.stat().st_mtime > best[0].stat().st_mtime):
            best = (p, d)
    if not best:
        return {}, {"dataset": "google_places_services", "found": False}
    p, d = best
    by_b = {str(s["building_id"]): s for s in d["services"].values() if s.get("building_id")}
    return by_b, {"dataset": "google_places_services", "path": str(p), "found": True,
                  "records": len(by_b), "terms": "owner-approved paid lookup 2026-11-20; flags only"}


# ---- registry licences ----------------------------------------------------------------------

LICENCE = [
    (re.compile(r"FIXED COMMERCIAL PARKLET"), ("parklet", "commercial")),
    (re.compile(r"PUBLIC PARKLET"), ("parklet", "public")),
    (re.compile(r"RESTAURANT - UNDER 1,000 SQFT"), ("dining_sqft", (0, 1000))),
    (re.compile(r"RESTAURANT 1,000 - 2,000 SQFT"), ("dining_sqft", (1000, 2000))),
    (re.compile(r"RESTAURANT - OVER 2,000 SQFT"), ("dining_sqft", (2000, None))),
    (re.compile(r"BARS/TAVERNS"), ("bar", True)),
    (re.compile(r"TAKE-OUTS|FAST FOOD OUTLETS"), ("counter_service", True)),
    (re.compile(r"OPEN-AIR ASSEMBLY"), ("open_air_assembly", True)),
    (re.compile(r"LIVE PERFORMANCE|PLACE OF ENTERTAINMENT"), ("entertainment", True)),
    (re.compile(r"OUTDOOR AMPLIFIED SOUND"), ("outdoor_sound", True)),
]


def licence_facts(codes: str | None) -> dict:
    """What a business's tax-registry licence list says about its premises."""
    out: dict = {}
    for part in (codes or "").split(";"):
        part = part.strip().upper()
        for pat, (k, val) in LICENCE:
            if pat.search(part):
                out[k] = val
    return out
