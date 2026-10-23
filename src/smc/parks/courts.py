"""Resolve visual court slabs from municipal evidence without editing source ground.

Pitch paint is not a fence: an OSM playing rectangle can omit six metres of tennis
run-off. Conversely a morphological closing between pitches is not evidence of asphalt.
Keep the original ground arrays as the fallback and compile a separate Mac-only view.
"""
from __future__ import annotations

import copy
import math

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

from smc.ground.courts import SPORTS, oriented_rect
from smc.parks.enrichment import rings

FACILITY_SPORTS = {
    "Tennis Court": "tennis", "Tennis/Pickleball Court": "tennis",
    "Basketball Court": "basketball", "Volleyball Court": "volleyball",
}


def compile_courts(inventory: dict, ground: dict, reviews: list[dict] = ()) -> dict:
    courts = copy.deepcopy(ground.get("courts", []))
    if not courts:
        return {"schema": "kerbside.park_courts/1", "courts": [], "pads": [], "review": []}
    lon0, lat0 = courts[0]["c"]
    kx, ky = 111_320 * math.cos(math.radians(lat0)), 110_540

    def metric(p):
        return ((p[0] - lon0) * kx, (p[1] - lat0) * ky)

    def geographic(p):
        return [round(lon0 + p[0] / kx, 9), round(lat0 + p[1] / ky, 9)]

    def family(s):
        return "basketball" if s.startswith("basketball") else s

    pads, rejected = [], []
    for obj in inventory.get("objects", []):
        # Facility polygons describe the slab. Functional-area polygons can be the
        # same slab OR just paint OR an overlapping pickleball use; never count both.
        if not obj["id"].startswith("rpd:facility:") or obj["kind"] not in FACILITY_SPORTS:
            continue
        if obj.get("semantic_confidence", 0) < .9 or obj.get("geometry_confidence", 0) < .5:
            continue
        sport = FACILITY_SPORTS[obj["kind"]]
        for part in obj.get("parts", []):
            for n, poly in enumerate(rings(part["geometry"])):
                shape = Polygon([metric(p) for p in poly[0]], [[metric(p) for p in r] for r in poly[1:]])
                if not shape.is_valid or shape.area < 30:
                    continue
                matches = [c for c in courts if family(c["s"]) == sport and shape.contains(Point(metric(c["c"])))]
                if not matches:
                    continue  # no invented court count from a facility name alone
                pads.append({"id": f"{obj['id']}:{part['id']}:{n}", "s": sport,
                             "p": poly[0], "holes": poly[1:], "shape": shape,
                             "courts": matches, "confidence": obj["geometry_confidence"],
                             "provenance": part["provenance"], "license": obj["license"]})

    # A correction is tied to a particular source paint rectangle, never an address
    # radius that might erase a different real court after the source changes.
    for review in reviews:
        if review.get("action") != "suppress_visual_court":
            continue
        hit = [c for c in courts if c["s"] == review["sport"]
               and math.dist(metric(c["c"]), metric(review["center"])) < .35]
        for court in hit:
            if any(court is c for p in pads for c in p["courts"]):
                rejected.append({"reason": "review_conflicts_with_municipal_slab", "review": review})
                continue
            courts.remove(court)
            rejected.append({"reason": "source_pitch_disputed", "court": court, "review": review})

    for pad in pads:
        rect = oriented_rect(list(pad["shape"].exterior.coords))
        for court in pad["courts"]:
            # Keep observed centre, use the slab's bearing and regulation paint where
            # it fits. Do not shrink every tennis court just because OSM mapped paint.
            spec = SPORTS[court["s"]]
            cx, cy = metric(court["c"])
            # A pair's slab can be wider than it is long. Preserve the observed
            # playing direction, snapping to the closer slab axis, not its longest.
            angle = rect.angle + (math.pi / 2 if abs(math.cos(court["a"] - rect.angle)) < math.sqrt(.5) else 0)
            ux, uy, vx, vy = math.cos(angle), math.sin(angle), -math.sin(angle), math.cos(angle)

            def play_shape(scale, cx=cx, cy=cy, ux=ux, uy=uy, vx=vx, vy=vy, spec=spec):
                return Polygon([(cx + ux * a * spec.play_l * scale / 2 + vx * b * spec.play_w * scale / 2,
                                 cy + uy * a * spec.play_l * scale / 2 + vy * b * spec.play_w * scale / 2)
                                for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]])

            scale = 1.0
            clearance = .915 if family(court["s"]) == "basketball" else .45
            while scale > .62 and not pad["shape"].covers(play_shape(scale).buffer(clearance)):
                scale -= .01
            if scale <= .62:
                rejected.append({"reason": "paint_does_not_fit_slab", "court": copy.deepcopy(court)})
                continue
            court.update(a=round(angle, 6), l=round(spec.play_l * scale, 2),
                         w=round(spec.play_w * scale, 2), pad_id=pad["id"],
                         confidence=pad["confidence"], measured=False,
                         geometry_basis="mapped_paint_center_regulation_fit_to_city_slab")

    owned = {c["pad_id"] for c in courts if c.get("pad_id")}
    for p in pads:
        if p["id"] not in owned:
            rejected.append({"reason": "overlapping_municipal_slab_superseded", "pad_id": p["id"]})
    pads = [p for p in pads if p["id"] in owned]
    # Clip fence routes against every playing rectangle, and deduplicate shared
    # slab edges. No posts across a playing area; no double fence in a shared seam.
    paint = []
    for court in courts:
        x, y = metric(court["c"])
        u, v = (math.cos(court["a"]), math.sin(court["a"])), (-math.sin(court["a"]), math.cos(court["a"]))
        paint.append(Polygon([(x + a * u[0] * court["l"] / 2 + b * v[0] * court["w"] / 2,
                               y + a * u[1] * court["l"] / 2 + b * v[1] * court["w"] / 2)
                              for a, b in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]))
    keep_clear = unary_union(paint).buffer(.1)
    previous = []
    for pad in pads:
        line = pad.pop("shape").boundary.difference(keep_clear)
        if previous:
            line = line.difference(unary_union(previous).buffer(.12))
        segments = [line] if isinstance(line, LineString) else list(getattr(line, "geoms", []))
        pad["fence_runs"] = [{"p": [geographic(p) for p in seg.coords],
                              "basis": "inferred_fence_at_city_slab_edge"}
                             for seg in segments if isinstance(seg, LineString) and seg.length > .5]
        previous.append(line)
        pad.pop("courts")

    removed = [r["court"] for r in rejected if r["reason"] == "source_pitch_disputed"]
    resolved = [c for c in courts if c.get("pad_id")] + removed
    pitches = copy.deepcopy(ground.get("pitches", []))
    replaced = [p for p in pitches if any(family(p["s"]) == family(c["s"])
                and Polygon([metric(q) for q in p["p"]]).buffer(.3).covers(Point(metric(c["c"])))
                for c in resolved)]
    affected = {p["k"] for p in replaced if p.get("k")}
    pitches = [p for p in pitches if p not in replaced]
    for p in pitches:
        if p.get("k") in affected:
            p.pop("k")  # retained neighbouring source pitch, not an obsolete filled complex
    complexes = [c for c in copy.deepcopy(ground.get("court_complexes", [])) if c["id"] not in affected]
    return {"schema": "kerbside.park_courts/1", "courts": courts, "pads": pads,
            "pitches": pitches, "court_complexes": complexes,
            "review": rejected, "source_geometry_modified": False}
