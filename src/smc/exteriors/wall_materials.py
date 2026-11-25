"""The background wall of every building the storefront lab's Opus reader saw, and what kinds of
building are usually made of.

The lab (``storefronts-lab/``) read each shop wall from photographs: the wall's material and
colour, and separately its windows, doors, bays and shopfronts. Only the walls that were read
carry a reading; a building's other sides were drawn from the app's own guesses, which for
shops was often glass, because a photo matcher fitted to whole walls read the shop windows as
a glass skin.

This takes the read walls only, measures how much of each is solid wall once every opening is
cut out, and picks the material covering the most solid area. That material and its colour
then stand for the whole building's shell, on every side. Nothing is re-read: this works from
the readings already stored in the lab (``models/auto-opus`` with ``observations/auto-opus``).

``type_priors`` turns the same log into a fallback for buildings nobody read: the material
the read walls of that kind of building most often are, and the colours they were read in.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

SCHEMA = "kerbside.opus_wall_materials/1"
MODELS = Path("storefronts-lab/models/auto-opus")
OBSERVATIONS = Path("storefronts-lab/observations/auto-opus")
#: The lab's wall vocabulary (kerbfront/auto/opus.py) in the app's photographed classes
#: (scripts/build_material_assignments.py SUPPORTED). Glass is not a background: a wall that is
#: all glass is all opening, and says nothing about what the building is built of.
LAB_TO_CLASS = {
    "stucco": "stucco_render", "smooth_render": "stucco_render",
    "brick": "brick", "painted_brick": "painted_brick",
    "wood_siding": "wood_siding", "shiplap": "wood_siding", "shingle": "wood_siding",
    "painted_wood": "wood_siding",
    "stone": "stone", "concrete": "concrete", "tile": "ceramic_tile", "metal_panel": "metal_panel",
}
#: Kinds of building whose fallback comes from the read walls rather than the city's average.
#: Their real stock is wood frame, render and brick; a glass skin is an office's.
TYPE_PRIOR_KINDS = ("restaurant", "retail")
#: The lab's business render (kerbfront business_type.render) as the app's kind of building.
KIND_OF_RENDER = {"restaurant": "restaurant", "storefront": "retail"}
#: A kind needs this many read buildings before its read walls speak for it.
MIN_PRIOR_BUILDINGS = 10
#: A prior is a statement about a kind, not about the building, and is never more sure than this.
PRIOR_CAP = 0.45


def _hex(c) -> str | None:
    return c.lower() if isinstance(c, str) and len(c) == 7 and c[0] == "#" else None


def read_edges(observations: dict) -> dict[int, float]:
    """The walls whose material the reader saw, with the reading's confidence."""
    edges = {}
    for row in observations.get("observations", []):
        parts = row.get("path", "").split(".")
        if len(parts) == 3 and parts[0] == "walls" and parts[2] == "material" and parts[1].isdigit():
            ev = row.get("evidence") or {}
            if str(ev.get("read_by", "")).startswith("claude-"):
                edges[int(parts[1])] = float(ev.get("confidence") or 0.5)
    return edges


def _area(o) -> float:
    w = float(o.get("w") or 0)
    h = o.get("h")
    if h is None and o.get("v0") is not None and o.get("v1") is not None:
        h = float(o["v1"]) - float(o["v0"])
    return max(0.0, w) * max(0.0, float(h or 0))


def solid_parts(model: dict, edges) -> list[dict]:
    """Each read wall split into the shopfront bands and the wall above and around them, with
    the solid area of each once its openings are taken out."""
    height = float(model.get("height_m") or 0)
    parts = []
    for e in sorted(edges):
        if e >= len(model.get("walls", [])):
            continue
        wall = model["walls"][e]
        length = float(wall.get("length_m") or 0)
        shops = [s for s in model.get("storefronts", []) if s.get("edge") == e and s.get("visible", True)]
        bands = 0.0
        for s in shops:
            u0, u1 = float(s.get("u0") or 0), float(s.get("u1") or 0)
            band = max(0.0, min(u1, length) - max(u0, 0.0)) * min(float(s.get("band_h") or 0), height)
            bands += band
            glazed = sum(_area(o) for o in s.get("openings", []))
            cls = LAB_TO_CLASS.get(s.get("material") or wall.get("material"))
            colour = _hex((s.get("palette") or {}).get("wall")) or _hex(wall.get("colour"))
            parts.append({"edge": e, "part": s.get("id"), "lab": s.get("material") or wall.get("material"),
                          "class": cls, "colour": colour, "solid_m2": max(0.0, band - glazed)})

        def in_band(o, shops=shops):
            v = float(o.get("v") if o.get("v") is not None else o.get("v0") or 0)
            u = float(o.get("u") or 0) + float(o.get("w") or 0) / 2
            return any(float(s.get("u0") or 0) <= u <= float(s.get("u1") or 0)
                       and v < float(s.get("band_h") or 0) for s in shops)

        openings = sum(_area(o) for o in wall.get("openings", []) if not in_band(o))
        parts.append({"edge": e, "part": wall.get("id") or f"w{e}", "lab": wall.get("material"),
                      "class": LAB_TO_CLASS.get(wall.get("material")), "colour": _hex(wall.get("colour")),
                      "solid_m2": max(0.0, length * height - bands - openings)})
    return parts


def background(readings: list[tuple[dict, dict]]) -> dict | None:
    """A building's background wall from its readings (each a lab model and its observations;
    a building with two tenants can have two): the material over the most solid read area,
    and the colour of the largest solid piece in that material."""
    parts, sure = [], {}
    for model, observations in readings:
        edges = read_edges(observations)
        for p in solid_parts(model, edges):
            if p["class"] and p["solid_m2"] > 0:
                parts.append({**p, "model": model.get("id")})
                sure[(model.get("id"), p["edge"])] = edges[p["edge"]]
    if not parts:
        return None
    by_class: Counter[str] = Counter()
    for p in parts:
        by_class[p["class"]] += p["solid_m2"]
    cls, area = by_class.most_common(1)[0]
    total = sum(by_class.values())
    own = [p for p in parts if p["class"] == cls]
    largest = max([p for p in own if p["colour"]] or own, key=lambda p: p["solid_m2"])
    confidence = sum(sure[(p["model"], p["edge"])] for p in own) / len(own)
    kinds = Counter(KIND_OF_RENDER.get((m.get("business_type") or {}).get("render")) for m, _ in readings)
    return {
        "class": cls, "lab_material": largest["lab"], "colour": largest["colour"],
        "share": round(area / total, 3), "solid_m2": round(total, 1),
        "confidence": round(confidence * (area / total), 3),
        "by_class": {k: round(v, 1) for k, v in by_class.most_common()},
        "kind": kinds.most_common(1)[0][0],
        "read_walls": sorted({f"{p['model']}:{p['edge']}" for p in parts}),
    }


def build_log(root: Path) -> dict:
    """Every read building's background wall, keyed by the app building (OSM way) its models
    were built on."""
    grouped: dict[str, list] = defaultdict(list)
    skipped: Counter[str] = Counter()
    for path in sorted((root / OBSERVATIONS).glob("*.json")):
        model_path = root / MODELS / path.name
        if not model_path.exists():
            skipped["no_model"] += 1
            continue
        model = json.loads(model_path.read_text())
        if not model.get("app_building"):
            skipped["no_app_building"] += 1
            continue
        grouped[str(model["app_building"])].append((model, json.loads(path.read_text())))
    buildings = {}
    for key, readings in sorted(grouped.items()):
        found = background(readings)
        if found is None:
            skipped["no_solid_read_wall"] += 1
        else:
            buildings[key] = found
    return {"schema": SCHEMA, "source": [str(MODELS), str(OBSERVATIONS)],
            "lab_to_class": LAB_TO_CLASS, "buildings": buildings,
            "counts": dict(Counter(b["class"] for b in buildings.values()).most_common()),
            "skipped": dict(skipped)}


def type_priors(log: dict) -> dict:
    """For each kind of building in TYPE_PRIOR_KINDS with enough read buildings (by the business
    the lab read in it): the material its read walls most often are, by solid area, and the
    colours they were read in."""
    area: dict[str, Counter] = defaultdict(Counter)
    colours: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))
    n: Counter[str] = Counter()
    for b in log.get("buildings", {}).values():
        kind = b.get("kind")
        if kind not in TYPE_PRIOR_KINDS:
            continue
        n[kind] += 1
        for cls, m2 in b["by_class"].items():
            area[kind][cls] += m2
        if b.get("colour"):
            colours[kind][b["class"]].append(b["colour"])
    priors = {}
    for kind in TYPE_PRIOR_KINDS:
        if n[kind] < MIN_PRIOR_BUILDINGS:
            continue
        cls, m2 = area[kind].most_common(1)[0]
        share = m2 / sum(area[kind].values())
        priors[kind] = {"class": cls, "confidence": round(min(PRIOR_CAP, share), 3),
                        "share": round(share, 3), "buildings": n[kind],
                        "colours": sorted(set(colours[kind][cls]))}
    return priors
