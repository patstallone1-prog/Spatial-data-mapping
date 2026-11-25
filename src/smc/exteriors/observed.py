"""Storefronts read from street photographs (the kerbfront lab's Opus readings) as app plans.

The lab (storefronts-lab/) models a building on the city's DataSF footprint, and Claude Opus reads
each street wall from Mapillary frames: the shops' names and spans, their glazing and doors, signs,
boards, awnings, lights, palette and finish (``kerbfront.building/1``, storefronts-lab/models/
auto-opus). The app draws its own building shells, from OpenStreetMap, and a storefront plan
(``kerbside.inferred_exterior/1``) is bound to those exact shells. This module carries the
readings across:

- each read wall is matched to the canonical shell's edge it lies on (same direction within
  ``ANGLE_DEG``, within ``OFFSET_M`` of it, overlapping), and every position along it is
  re-measured on that edge -- the canonical shell is never moved to fit the photograph;
- the readings become the inference's observed input: tenants, their spans, openings, signs,
  wall colour and finish (smc.exteriors.engine fills only what was not read, such as a door
  the photographs did not show);
- what the engine has no slot for -- awnings, boards and blades, lights, pilasters and friezes
  in the shop band -- rides along as ``facade.observed``, which the renderer draws.

A building whose walls cannot be matched, or whose plan fails validation, keeps the plan it had.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from itertools import pairwise
from pathlib import Path

from smc.exteriors.model import ExteriorInput
from smc.interiors.kerbside import mapped_geometry

SCHEMA = "kerbfront.building/1"
ANGLE_DEG = 12.0
OFFSET_M = 3.0  # at the read wall's middle; its ends may lie up to END_M off
END_M = 4.0
MIN_SHARE = 0.5  # of the read span, lying on the canonical edge
READER = "kerbfront-opus"
SIGN_KINDS = {"fascia", "channel_letters", "painted_letters", "lightbox", "neon", "blade",
              "door_vinyl", "entry_letters", "plaque", "canopy_letters"}
OPENING_KINDS = {"window", "door", "entrance", "garage", "storefront"}
HEX = "0123456789abcdefABCDEF"
PLACEHOLDER = re.compile(r"unknown|unidentified|\(neighbou?r\)", re.I)
ENTRY_W = 1.05 + 2 * 0.18  # the engine's door and the clearance it keeps (engine._openings)


def load_models(folder: Path) -> dict[str, dict]:
    """The lab's read buildings, by the app building (OSM way) each was modelled on."""
    models = {}
    for path in sorted(Path(folder).glob("*.json")):
        m = json.loads(path.read_text())
        if m.get("schema") != SCHEMA or not m.get("app_building"):
            continue
        if any(_read(sf) for sf in m.get("storefronts", [])):
            models[str(m["app_building"])] = m
    return models


def _read(sf) -> bool:
    return sf.get("visible", True) is not False and "opus" in str(sf.get("evidence", {}).get("read_by", ""))


def _colour(c):
    return isinstance(c, str) and len(c) == 7 and c[0] == "#" and all(ch in HEX for ch in c[1:])


class EdgeMap:
    """One lab wall's positions, re-measured along the canonical edge it lies on."""

    def __init__(self, edge, length, start, step, normal_dot, share):
        self.edge, self.length, self.start, self.step = edge, length, start, step
        self.normal_dot, self.share = normal_dot, share

    def at(self, u):
        return self.start + self.step * u

    def span(self, u0, u1):
        """Clipped to the edge, in millimetres rounded inward (the input check is exact)."""
        a, b = sorted((self.at(u0), self.at(u1)))
        return math.ceil(max(0.0, a) * 1000) / 1000, math.floor(min(self.length, b) * 1000) / 1000

    def rect(self, row):
        """A row with ``u`` (left edge) and ``w``: its left edge on the canonical edge."""
        a, b = self.span(row["u"], row["u"] + row["w"])
        return a, b - a


def _lonlat(origin, p):
    lon, lat = origin
    return lon + p[0] / (111320 * math.cos(math.radians(lat))), lat + p[1] / 111320


def match_edge(model, lab_edge, ring, origin, clockwise):
    """The canonical edge (of ``ring``, local to ``origin``) that the lab's wall ``lab_edge`` is."""
    fp = model["footprint"]
    a, b = fp[lab_edge], fp[(lab_edge + 1) % len(fp)]
    lon, lat = origin
    kx = 111320 * math.cos(math.radians(lat))

    def local(p):
        q = _lonlat(model["origin_lon_lat"], p)
        return (q[0] - lon) * kx, (q[1] - lat) * 111320

    A, B = local(a), local(b)
    lab_len = math.dist(A, B)
    if lab_len < 0.5:
        return None
    t = ((B[0] - A[0]) / lab_len, (B[1] - A[1]) / lab_len)
    lab_n = (t[1], -t[0])  # the lab's rings run counter-clockwise: outward is the right hand
    best = None
    for i, (c, d) in enumerate(pairwise(ring)):
        length = math.dist(c, d)
        if length < 0.5:
            continue
        e = ((d[0] - c[0]) / length, (d[1] - c[1]) / length)
        cos = t[0] * e[0] + t[1] * e[1]
        if abs(cos) < math.cos(math.radians(ANGLE_DEG)):
            continue
        n = (-e[1], e[0]) if clockwise else (e[1], -e[0])
        if lab_n[0] * n[0] + lab_n[1] * n[1] < 0.5:
            continue  # the far side of a thin building, not this wall
        off = [abs((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1]) for p in (A, B, ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2))]
        offset = off[2]
        if offset > OFFSET_M or max(off) > END_M:
            continue
        ua = (A[0] - c[0]) * e[0] + (A[1] - c[1]) * e[1]
        ub = (B[0] - c[0]) * e[0] + (B[1] - c[1]) * e[1]
        share = (min(length, max(ua, ub)) - max(0.0, min(ua, ub))) / lab_len
        if share < MIN_SHARE:
            continue
        score = (share, -offset)
        if best is None or score > best[0]:
            best = (score, EdgeMap(i, length, ua, 1.0 if cos > 0 else -1.0, cos, share))
    return best[1] if best else None


def _evidence(sf, model):
    ev = sf.get("evidence", {})
    frames = [p for p in model.get("photos", []) if p.get("frame_id") in set(ev.get("frames", []))]
    return {
        "source_id": READER,
        "read_by": ev.get("read_by"),
        "confidence": float(ev.get("confidence", 0.5)),
        "captured_at": max((p.get("captured_at", "") for p in frames), default=None),
        "corroboration_count": len(ev.get("frames", [])),
        "measured": False,
        "inferred": False,
        "how": ev.get("how"),
        "lab_model": model.get("id"),
    }


def _overlap(a, b, gap=0.0):
    return a["u"] < b["u"] + b["w"] + gap and b["u"] < a["u"] + a["w"] + gap and a["v"] < b["v"] + b["h"] and b["v"] < a["v"] + a["h"]


def _room_for_entry(openings, u0, u1):
    """No door was read and the read glazing leaves no gap for one: shorten (or, if short, drop)
    the low window nearest where the engine puts an entry, two thirds along, so the engine can
    infer the door there. The window keeps its read width as ``read_w``."""
    lo, hi = u0 + 0.16, u1 - 0.16
    if hi - lo < ENTRY_W:
        return
    reach = lo  # walk the low openings left to right: is any gap between them a door wide?
    for a, b in sorted((o["u"], o["u"] + o["w"]) for o in openings if o["v"] < 2.2):
        if a - reach >= ENTRY_W:
            return
        reach = max(reach, b)
    if hi - reach >= ENTRY_W:
        return
    target = lo + (hi - lo) * 0.67
    low = [o for o in openings if o["v"] < 2.2]
    if not low:
        return
    o = min(low, key=lambda o: abs(o["u"] + o["w"] / 2 - target))
    if o["w"] >= ENTRY_W + 1.0:
        o["read_w"] = o["w"]
        if o["u"] + o["w"] / 2 < target:  # the entry goes at the window's right end
            o["w"] = round(o["w"] - ENTRY_W, 3)
        else:
            o["u"], o["w"] = round(o["u"] + ENTRY_W, 3), round(o["w"] - ENTRY_W, 3)
        o["trimmed_for_inferred_entry"] = True
    else:
        openings.remove(o)


def to_input(way, model, *, only=None, region="sf-corridor"):
    """An ExteriorInput for the canonical building ``way`` from the lab's reading ``model`` (its
    storefronts whose ids are in ``only``, if given), and for each frontage the observations the
    engine has no slot for. Raises ValueError if the reading cannot be bound to this shell."""
    shell = mapped_geometry(way, region=region)
    from shapely.geometry import shape

    polygon = shape(shell["footprint"])
    ring = list(polygon.exterior.coords)
    clockwise = not polygon.exterior.is_ccw
    origin = shell["origin_lon_lat"]
    height = float(way.get("height_m") or 3.2)
    tenants, frontages, extras = [], [], []
    walls = {int(w.get("edge", i)): w for i, w in enumerate(model.get("walls") or []) if w}
    for sf in model.get("storefronts", []):
        if not _read(sf) or sf.get("edge") is None or not sf.get("name") or (only is not None and sf.get("id") not in only):
            continue
        em = match_edge(model, int(sf["edge"]), ring, origin, clockwise)
        if em is None:
            continue
        u0, u1 = em.span(sf["u0"], sf["u1"])
        if u1 - u0 < 1.0:
            continue
        band = min(float(sf.get("band_h") or 3.6), height)
        same = next((t for t in tenants if t["name"].casefold() == sf["name"].casefold()), None)
        tid = same["id"] if same else str(len(tenants))
        ev = _evidence(sf, model)
        openings = []
        # The lab draws the wall's own ground-floor openings through the shop band too (a door
        # read on the wall rather than on the storefront), so both are the shop's.
        wall = walls.get(int(sf["edge"])) or {}
        below = [o for o in wall.get("openings") or [] if isinstance(o.get("v"), (int, float)) and o["v"] < band - 0.3
                 and isinstance(o.get("u"), (int, float)) and sf["u0"] - 0.05 <= o["u"] and o["u"] + (o.get("w") or 0) <= sf["u1"] + 0.05]
        for o in [*(sf.get("openings") or []), *below]:
            if o.get("kind") not in OPENING_KINDS or not all(isinstance(o.get(k), (int, float)) for k in ("u", "w", "v", "h")):
                continue
            u, w = em.rect(o)
            if w < 0.3 or u < u0 - 0.01 or u + w > u1 + 0.01:
                continue
            row = {k: v for k, v in o.items() if k not in {"u", "w", "id"}}
            row.update(id=f"{sf['id']}:{o.get('id', len(openings))}", u=round(max(u, u0), 3), w=round(min(w, u1 - u), 3),
                       v=max(0.0, float(o["v"])), h=min(float(o["h"]), band - max(0.0, float(o["v"]))),
                       **{k: v for k, v in ev.items() if k in {"source_id", "confidence", "captured_at", "corroboration_count", "measured", "inferred"}})
            if row["h"] < 0.3 or any(_overlap(row, q) for q in openings):
                continue
            openings.append(row)
        if not same and not any(o.get("kind") in {"door", "entrance"} for o in openings):
            _room_for_entry(openings, u0, u1)
        signs = []
        for s in sf.get("signs", []):
            if s.get("kind") not in SIGN_KINDS or s.get("visible") is False or not s.get("text"):
                continue
            if not all(isinstance(s.get(k), (int, float)) for k in ("u", "w", "v", "h")) or s["w"] <= 0 or s["h"] <= 0:
                continue
            u, w = em.rect(s)
            if w < 0.2:
                continue
            row = copy.deepcopy(s)
            row.update(id=f"{sf['id']}:{s.get('id', len(signs))}", u=round(u, 3), w=round(w, 3), source_id=READER,
                       confidence=ev["confidence"])
            signs.append(row)
        palette = sf.get("palette") or {}
        name = "Storefront" if PLACEHOLDER.search(sf["name"]) else sf["name"]
        tenant = {"id": tid, "name": name, "category": sf.get("category") or "shop"}
        if sf.get("brand"):
            tenant["brand"] = sf["brand"]
        if not same:
            tenants.append(tenant)
        face = {
            # A shop's second wall (a corner) is its secondary frontage, not a second shop.
            "edge": em.edge, "u0": u0, "u1": u1, "tenant_id": tid, "role": "secondary" if same else "public",
            "basis": f"read from street photographs ({ev['read_by']}), re-measured on the canonical edge",
            "openings": openings,
            "openings_complete": any(o.get("kind") in {"door", "entrance"} for o in openings),
            "signs": signs,
            # The photographs were read for signs: none read is none there, not one to invent.
            "signs_complete": True,
            "observed_by": ev,
        }
        if _colour(palette.get("wall")):
            face["wall_colour"] = palette["wall"]
        if sf.get("material"):
            face["wall_material"] = sf["material"]
        frontages.append(face)
        extras.append((em, sf, band))
    if not frontages:
        raise ValueError("no read storefront lies on a canonical edge")
    # Two read shops never own the same stretch of wall: the later one starts where the first ends.
    order = sorted(range(len(frontages)), key=lambda i: (frontages[i]["edge"], frontages[i]["u0"]))
    keep = []
    for i in order:
        f = frontages[i]
        prev = next((frontages[j] for j in reversed(keep) if frontages[j]["edge"] == f["edge"]), None)
        if prev and f["u0"] < prev["u1"]:
            f["u0"] = prev["u1"]
            f["openings"] = [o for o in f["openings"] if o["u"] >= f["u0"]]
            f["signs"] = [s for s in f["signs"] if s["u"] >= f["u0"] - 0.01]
            f["openings_complete"] = f["openings_complete"] and any(o.get("kind") in {"door", "entrance"} for o in f["openings"])
        if f["u1"] - f["u0"] >= 1.0:
            keep.append(i)
    if not keep:
        raise ValueError("read storefronts overlap entirely")
    used = {frontages[i]["tenant_id"] for i in keep}
    tenants = [t for t in tenants if t["id"] in used]
    bands = sorted(extras[i][2] for i in keep)
    # The lowest read band: what the engine adds fits under every shop's own (finish raises each).
    ground = max(2.3, min(height, bands[0]))
    spec = ExteriorInput.from_json({
        "id": str(way["osm_id"]),
        "footprint": shell["footprint"],
        "height_m": height,
        "ground_height_m": ground,
        "tenants": tenants,
        "frontages": [frontages[i] for i in keep],
        "origin_lon_lat": origin,
        "canonical_points": way["points"],
        "geometry_evidence": shell["geometry_evidence"],
    })
    return spec, [extras[i] for i in keep]


def _rect_row(em, row, lo, hi, keys=("u", "w")):
    if not all(isinstance(row.get(k), (int, float)) for k in keys):
        return None
    u, w = em.rect(row)
    if w <= 0.05 or u + w < lo - 0.5 or u > hi + 0.5:
        return None
    out = copy.deepcopy(row)
    out.update(u=round(u, 3), w=round(w, 3))
    return out


def _span_row(em, row, lo, hi, k0="u0", k1="u1"):
    a, b = em.span(row.get(k0, 0.0), row.get(k1, 0.0))
    a, b = max(a, lo - 0.6), min(b, hi + 0.6)
    if b - a <= 0.1:
        return None
    out = copy.deepcopy(row)
    out.update({k0: round(a, 3), k1: round(b, 3)})
    return out


def observed_parts(em, sf, face, wall=None):
    """Awnings, boards and blades, lights, and the shop band's pilasters and friezes, on the
    canonical edge: what ``facade.observed`` carries for the renderer."""
    lo, hi, band = face["u0"], face["u1"], face["band_height_m"]
    out = {"awnings": [], "extra_signs": [], "lights": [], "pilasters": [], "friezes": []}
    for a in sf.get("awnings", []):
        if a.get("visible") is False:
            continue
        row = _span_row(em, a, lo, hi)
        if row and float(row.get("v", band - 0.3)) <= band + 0.6:
            out["awnings"].append(row)
    for s in sf.get("extra_signs", []):
        if s.get("visible") is False or s.get("kind") == "rooftop":
            continue
        if s.get("kind") == "blade":  # a blade's u is its centre line
            row = copy.deepcopy(s)
            row["u"] = round(em.at(s["u"]), 3)
            if not lo - 0.5 <= row["u"] <= hi + 0.5:
                continue
        else:
            row = _rect_row(em, s, lo, hi)
        if row and isinstance(row.get("v"), (int, float)) and isinstance(row.get("h"), (int, float)):
            out["extra_signs"].append(row)
    for light in sf.get("lights", []):
        if light.get("kind") == "string":
            row = _span_row(em, light, lo, hi)
        elif isinstance(light.get("u"), (int, float)):
            row = copy.deepcopy(light)
            row["u"] = round(em.at(light["u"]), 3)
            row = row if lo - 0.5 <= row["u"] <= hi + 0.5 else None
        else:
            row = None
        if row:
            out["lights"].append(row)
    for pl in (wall or {}).get("pilasters", []):
        if float(pl.get("v0", 0)) >= band:
            continue
        centres = pl["u"] if isinstance(pl.get("u"), list) else [pl.get("u")]
        kept = [round(em.at(u), 3) for u in centres if isinstance(u, (int, float))]
        kept = [u for u in kept if lo - 0.3 <= u <= hi + 0.3]
        if kept:
            row = copy.deepcopy(pl)
            row.update(u=kept, v1=min(float(pl.get("v1", band)), band + 0.6))
            out["pilasters"].append(row)
    for fz in (wall or {}).get("friezes", []):
        if not isinstance(fz.get("v"), (int, float)) or fz["v"] >= band + 0.6:
            continue
        row = _span_row(em, {**fz, "u0": fz.get("u0", 0.0), "u1": fz.get("u1", em.length * 4)}, lo, hi)
        if row:
            row["u0"], row["u1"] = max(row["u0"], lo), min(row["u1"], hi)
            if row["u1"] - row["u0"] > 0.1:
                out["friezes"].append(row)
    return {k: v for k, v in out.items() if v}


def finish(plan, extras, model):
    """Give each read facade its read band height, palette, door style and the parts the engine
    has no slot for; then validate again and re-digest the plan. ``extras``: per facade, in the
    plan's order (the engine keeps the input's frontage order), (EdgeMap, lab storefront, band)."""
    from smc.exteriors.validate import validate_exterior

    walls = {int(w.get("edge", i)): w for i, w in enumerate(model.get("walls") or []) if w}
    if len(extras) != len(plan["facades"]):
        raise ValueError("observed parts do not line up with the plan's facades")
    for f, (em, sf, band) in zip(plan["facades"], extras, strict=True):
        f["band_height_m"] = round(band, 3)
        for key, value in (sf.get("palette") or {}).items():
            if key in f["palette"] and _colour(value):
                f["palette"][key] = value
        if sf.get("door_style"):
            f["door_style"] = sf["door_style"]
        parts = observed_parts(em, sf, f, walls.get(int(sf["edge"])))
        if parts:
            f["observed"] = parts
        f["observed_by"] = copy.deepcopy(f["source_input"]["observed_by"])
    plan["replica_status"] = "observed_storefronts_with_reference_backed_components"
    plan["observed_source"] = {"schema": SCHEMA, "model": model.get("id"), "reader": READER}
    plan.pop("content_sha256", None)
    plan["validation"] = validate_exterior(plan)
    plan["content_sha256"] = hashlib.sha256(
        json.dumps(plan, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    return plan


def observed_plan(way, model, *, only=None, region="sf-corridor"):
    """The storefront plan for ``way`` from the lab's reading, or a ValueError saying why not.
    A read shop the engine cannot give a door (a sliver of wall between two others) is left out,
    and the rest of the building's reading kept."""
    from smc.exteriors.engine import infer_exterior

    only = set(only) if only is not None else {sf.get("id") for sf in model.get("storefronts", [])}
    for _ in range(4):
        spec, extras = to_input(way, model, only=only, region=region)
        plan = infer_exterior(spec)
        if plan["validation"]["passed"]:
            plan = finish(plan, extras, model)
            if plan["validation"]["passed"]:
                return plan
        errors = plan["validation"]["errors"]
        if errors != ["public tenant has no resolved entry"]:
            break
        doors = {f["tenant_id"] for f in plan["facades"] for o in f["openings"] if o["component_kind"] == "door"}
        stuck = {sf.get("id") for f, (_, sf, _) in zip(plan["facades"], extras, strict=True) if f["tenant_id"] not in doors}
        if not stuck or not only - stuck:
            break
        only -= stuck
    raise ValueError("observed plan fails validation: " + "; ".join(plan["validation"]["errors"]))


def assign(models, ways):
    """Which canonical building each read storefront is on: the one its lab model was built on if
    its wall lies on that building's edge, else a neighbour's (the city's footprint and
    OpenStreetMap's can split a block differently). Returns {osm_id: (model, storefront ids)}; a
    building that has its own model keeps only its own readings."""
    from shapely.geometry import shape

    boxes = []
    for w in ways.values():
        pts = w.get("points") or []
        if len(pts) >= 4:
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            boxes.append((min(xs), min(ys), max(xs), max(ys), w))
    rings = {}

    def shell(w):
        key = str(w["osm_id"])
        if key not in rings:
            try:
                g = mapped_geometry(w)
                poly = shape(g["footprint"])
                rings[key] = (list(poly.exterior.coords), g["origin_lon_lat"], not poly.exterior.is_ccw)
            except ValueError:
                rings[key] = None
        return rings[key]

    found: dict[str, tuple[dict, set]] = {}
    for own, model in models.items():
        lon, lat = model["origin_lon_lat"]
        kx = 111320 * math.cos(math.radians(lat))
        xs = [lon + p[0] / kx for p in model["footprint"]]
        ys = [lat + p[1] / 111320 for p in model["footprint"]]
        pad = 25 / 111320
        near = [w for x0, y0, x1, y1, w in boxes
                if x0 <= max(xs) + pad and x1 >= min(xs) - pad and y0 <= max(ys) + pad and y1 >= min(ys) - pad]
        near.sort(key=lambda w: str(w["osm_id"]) != own)  # the model's own building first
        for sf in model.get("storefronts", []):
            if not _read(sf) or sf.get("edge") is None:
                continue
            best = None
            for w in near:
                g = shell(w)
                em = match_edge(model, int(sf["edge"]), *g) if g else None
                if em and str(w["osm_id"]) == own:
                    best = (em, own)
                    break
                if em and (best is None or em.share > best[0].share):
                    best = (em, str(w["osm_id"]))
            if best:
                key = best[1]
                if key != own and key in models:
                    continue  # that building's own reading speaks for it
                if key in found and found[key][0] is not model:
                    continue
                found.setdefault(key, (model, set()))[1].add(sf.get("id"))
    return found


def plans_for_world(world, models, *, region="sf-corridor"):
    """Observed plans for every building in ``world`` a read storefront lies on, and why the
    others were not made."""
    ways = {str(w["osm_id"]): w for w in world.get("ways", []) if w.get("kind") == "building"}
    plans, rejected = {}, []
    for key, (model, only) in sorted(assign(models, ways).items()):
        try:
            plans[key] = observed_plan(ways[key], model, only=only, region=region)
        except (ValueError, KeyError, TypeError) as exc:
            rejected.append({"id": key, "model": model.get("id"), "errors": [str(exc)]})
    unplaced = [m.get("id") for k, m in models.items() if k in ways and not any(p.get("observed_source", {}).get("model") == m.get("id") for p in plans.values())]
    return plans, rejected, unplaced
