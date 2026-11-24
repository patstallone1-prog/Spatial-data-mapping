"""One editable building model per storefront business: ``kerbfront.building/1``.

    python -m kerbfront model --business "A16"            # writes models/<slug>.json

A model is everything the studio (``studio/``) draws and edits, in local metres around the
storefront (x east, y north, z up; ``origin_lon_lat`` is the local origin):

* ``footprint`` -- the DataSF LiDAR footprint, simplified at 0.5 m so a lidar zigzag of
  0.3-0.5 m jogs reads as one wall, counter-clockwise;
* ``walls`` -- one per footprint edge: role (street/party/open/recess), material, colour,
  texture scale, trim, belt courses, and its openings (windows, doors, bays, garages) as
  ``u`` along the wall from its first corner and ``v`` up from the ground, in metres;
* ``floors``, ``roof`` (flat with parapet and cornice), ``storefronts`` (the ground-floor band:
  openings, signs, awnings, palette -- the same shape ``smc.exteriors`` plans use, which the
  studio renders with the app's own renderer), ``seating`` (sidewalk strips and parklets),
  ``street`` (sidewalk width, kerb, parking lane) and ``context`` (neighbouring shells);
* ``photos`` -- the selected frames with their camera pose, for the photo-match view;
* ``evidence`` -- where each part came from: ``observed`` (read from a named photo),
  ``record`` (a public dataset), ``app`` (the Kerbside app's own data) or ``inferred``.

The defaults are the current pipeline's: the storefront band is ``smc.exteriors``
``infer_exterior`` run on the lab's hand-off program; wall material and colour, roof colour
and photo openings are the app's where its building matches. Observations (``observations/``)
and studio edits override them; ``evidence`` records which.
"""

from __future__ import annotations

import copy
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, Point, Polygon

from .config import AREAS, LAB, OUT
from .faces import _simplified_ring, buildings_from_datasf
from .geo import Frame, bearing, ccw, unit
from .handoff import program
from .sources import datasf, kerbside

MODELS = LAB / "models"
SHELL_TOLERANCE_M = 1.0  # LiDAR outlines trace cantilevered bays; bays are modelled as openings
CONTEXT_RANGE_M = 45.0

#: Wall colours to start from when no photograph has said otherwise, by material.
MATERIAL_COLOUR = {"stucco_render": "#d9d2c3", "painted_brick": "#c9b9a6", "brick": "#9a5a43",
                   "concrete": "#bdb8ae", "wood_siding": "#d8d3c6", "vinyl_siding": "#dcd9cf",
                   "stone": "#b8ad98", "ceramic_tile": "#c2b8a5", "metal_panel": "#9da3a6",
                   "glass": "#7f969c"}
APP_MATERIAL = {"stucco_render": "stucco", "painted_brick": "painted_brick", "brick": "brick",
                "concrete": "concrete", "wood_siding": "wood_siding", "vinyl_siding": "wood_siding",
                "stone": "stone", "ceramic_tile": "tile", "metal_panel": "metal_panel"}


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48]


def _ev(kind: str, source: str, confidence: float, **kw) -> dict:
    return {"kind": kind, "source": source, "confidence": round(confidence, 2), **kw}


# ---- the current pipeline's storefront band ----------------------------------------------------

def _engine():
    """``smc.exteriors`` from the deployed commit (extracted once), else the main checkout."""
    from .config import CACHE, kerbside_root
    import subprocess
    import tarfile
    import io

    sha = kerbside.commit()
    root = CACHE / "kerbside" / sha[:12] / "src"
    if not (root / "smc/exteriors/engine.py").exists():
        root.mkdir(parents=True, exist_ok=True)
        tar = subprocess.run(["git", "-C", str(kerbside_root()), "archive", sha,
                              "src/smc/__init__.py", "src/smc/exteriors"],
                             check=True, capture_output=True).stdout
        with tarfile.open(fileobj=io.BytesIO(tar)) as t:
            t.extractall(root.parent, filter="data")
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from smc.exteriors.engine import infer_exterior
    from smc.exteriors.model import ExteriorInput
    from smc.exteriors.validate import validate_exterior
    return infer_exterior, ExteriorInput, validate_exterior, sha


def engine_plan(bd, z: dict, frame: Frame) -> tuple[dict | None, str | None]:
    try:
        infer, Inp, validate, sha = _engine()
        prog = program(bd, _simplified_ring(bd.poly), [z], {}, frame)
        plan = infer(Inp.from_json(prog))
        validate(plan)
        plan["engine_commit"] = sha
        return plan, None
    except Exception as e:  # noqa: BLE001 - the model still builds, with the refusal recorded
        return None, f"{type(e).__name__}: {e}"[:300]


# ---- geometry helpers ---------------------------------------------------------------------------

def _proj(p, a, b) -> float:
    """Distance along a->b of p's projection."""
    tx, ty = unit(b[0] - a[0], b[1] - a[1])
    return (p[0] - a[0]) * tx + (p[1] - a[1]) * ty


def _along(a, b, u):
    tx, ty = unit(b[0] - a[0], b[1] - a[1])
    return (a[0] + tx * u, a[1] + ty * u)


def _shell(poly: Polygon) -> list[tuple[float, float]]:
    s = poly.simplify(SHELL_TOLERANCE_M, preserve_topology=True)
    if s.geom_type != "Polygon" or s.is_empty or len(s.exterior.coords) < 4:
        s = poly
    ring = ccw(list(s.exterior.coords))
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    return ring


def _match_edge(ring, p0, p1, max_deg=25.0):
    """The shell edge carrying the original face p0->p1: parallel, overlapping, nearest."""
    fb = bearing(p1[0] - p0[0], p1[1] - p0[1])
    mid = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    best, score = None, 1e9
    for i, a in enumerate(ring):
        b = ring[(i + 1) % len(ring)]
        eb = bearing(b[0] - a[0], b[1] - a[1])
        if abs((eb - fb + 180) % 360 - 180) > max_deg:
            continue
        L = math.dist(a, b)
        u = _proj(mid, a, b)
        if not -1.0 <= u <= L + 1.0:
            continue
        d = LineString([a, b]).distance(Point(mid))
        if d < score:
            best, score = i, d
    return best


# ---- default upper floors (replaced by photo openings where the app has them) ------------------

def default_windows(L: float, floors: list[dict], ground_h: float, wall_id: str,
                    style: str = "punched") -> list[dict]:
    rows = []
    for fi, fl in enumerate(floors[1:], start=1):
        n = max(1, int(round(L / 2.6)))
        w = min(1.1, L / n * 0.55)
        h = min(1.75, fl["h"] * 0.58)
        v = fl["v"] + fl["h"] * 0.28
        for k in range(n):
            u = (k + 0.5) * L / n - w / 2
            rows.append({"id": f"{wall_id}:f{fi}:w{k}", "kind": "window", "u": round(u, 2),
                         "v": round(v, 2), "w": round(w, 2), "h": round(h, 2), "shape": "rect",
                         "mullions": [1, 2] if style == "punched" else [2, 1],
                         "evidence": _ev("inferred", "kerbfront default grid", 0.2)})
    return rows


def _floors(height: float, stories: int | None, ground_h: float) -> list[dict]:
    n = stories if stories and stories >= 1 else max(1, round((height - ground_h) / 3.1) + 1)
    n = max(1, min(n, max(1, int(height / 2.6))))
    rest = (height - ground_h - 0.9) / max(1, n - 1) if n > 1 else 0
    out = [{"v": 0.0, "h": round(ground_h, 2)}]
    for i in range(1, n):
        out.append({"v": round(ground_h + (i - 1) * rest, 2), "h": round(rest, 2)})
    return out


# ---- seating ----------------------------------------------------------------------------------

#: SF Shared Spaces / sidewalk table permits keep a 6 ft (1.83 m) clear path; a parklet sits in
#: the parking lane, 6 ft deep from the kerb and at most two spaces (~12 m) long unless its
#: permit says otherwise.
CLEAR_PATH_M = 1.83
PARKLET_DEPTH_M = 1.83


def seating_for(z: dict, sf: dict, street: dict) -> list[dict]:
    out = []
    kinds = set((z.get("outdoor") or {}).get("kinds", []))
    u0, u1 = sf["u0"], sf["u1"]
    span = u1 - u0
    walk = street.get("sidewalk_m") or 3.0
    srcs = (z.get("outdoor") or {}).get("sources", [])
    if "sidewalk" in kinds:
        depth = 0.95 if walk - 0.95 >= CLEAR_PATH_M else max(0.0, walk - CLEAR_PATH_M)
        if depth >= 0.6:
            out.append({"id": f"{sf['id']}:sidewalk", "kind": "sidewalk_strip", "edge": sf["edge"],
                        "u0": round(u0 + 0.3, 2), "u1": round(u1 - 0.3, 2), "offset_m": 0.15,
                        "depth_m": round(depth, 2), "table": "two_top", "spacing_m": 1.55,
                        "colour": "#2f2f2c", "chair_colour": "#2f2f2c", "umbrellas": False,
                        "barrier": "none",
                        "evidence": _ev("record", "+".join(s for s in srcs if s != "registry_licence") or "osm", 0.8,
                                        note="SF sidewalk table permit: strip against the facade, 6 ft clear path kept")})
    if "parklet" in kinds:
        length = min(12.0, max(6.0, span + 1.0))
        c = (u0 + u1) / 2
        permit = (z.get("parklet_permit") or {})
        if permit.get("length_m"):
            length = permit["length_m"]
        out.append({"id": f"{sf['id']}:parklet", "kind": "parklet", "edge": sf["edge"],
                    "u0": round(c - length / 2, 2), "u1": round(c + length / 2, 2),
                    "depth_m": PARKLET_DEPTH_M, "deck_colour": "#7a5c43", "deck_h": street.get("kerb_m", 0.15),
                    "barrier": "planter_wall", "barrier_h": 1.07, "barrier_colour": "#4b3a2c",
                    "benches": "street_side", "tables": "four_top", "roof": "none",
                    "roof_colour": "#e9e4d8", "plants": True,
                    "evidence": _ev("record", "+".join(srcs) or "registry_licence", 0.75,
                                    note="registry licence FIXED COMMERCIAL PARKLET; placement "
                                         "in front of the storefront until a photo or permit says where")})
    return out


# ---- street -----------------------------------------------------------------------------------

def street_for(face, frame: Frame, origin) -> dict:
    """Sidewalk width, kerb and road width from the app's street record nearest the facade."""
    world = kerbside._file("world")
    name = (face["street"] or "").split(" ")[0].lower()
    mid = ((face["p0"][0] + face["p1"][0]) / 2, (face["p0"][1] + face["p1"][1]) / 2)
    best, bd = None, 1e9
    for w in world["ways"]:
        if w.get("kind") != "street" or not w.get("points"):
            continue
        if name and name not in (w.get("name") or "").lower():
            continue
        line = LineString([frame.xy(x, y) for x, y in w["points"]])
        d = line.distance(Point(mid))
        if d < bd:
            best, bd = w, d
    if best is None or bd > 40:
        return {"sidewalk_m": 3.0, "kerb_m": 0.15, "road_m": 12.0, "parking_m": 2.4,
                "evidence": _ev("inferred", "default", 0.2)}
    walk = best.get("walk_m") or 3.0
    # walk_m is the footway alone; the facade-to-kerb distance (centreline less half the road)
    # includes the planting strip and is what seating and parklets are laid out against
    to_kerb = bd - (best.get("road_m") or 12.0) / 2
    if 1.5 < to_kerb < 8 and to_kerb > walk:
        walk = to_kerb
    return {"name": best.get("name"), "osm_id": best.get("osm_id"),
            "sidewalk_m": round(walk, 2), "kerb_m": round(best.get("kerb_m") or 0.15, 3),
            "road_m": round(best.get("road_m") or 12.0, 2), "parking_m": 2.4,
            "facade_to_centreline_m": round(bd, 2),
            "evidence": _ev("app", f"sf-corridor-3d street {best.get('osm_id')} "
                                   f"({best.get('road_source')})", 0.7)}


# ---- the model ---------------------------------------------------------------------------------

def find_business(name_or_id: str, biz: list[dict]) -> dict:
    v = lambda z, k: (z["fields"].get(k) or {}).get("value")  # noqa: E731
    hits = [z for z in biz if z["id"] == name_or_id] or \
        [z for z in biz if (v(z, "name") or "").lower() == name_or_id.lower()
         and z.get("face") and z["storefront_likelihood"] >= 0.5]
    if not hits:
        raise SystemExit(f"no storefront business named {name_or_id!r}")
    return max(hits, key=lambda z: z["storefront_likelihood"])


def build(name_or_id: str, area: str = "marina-union") -> dict:
    out = OUT / area
    biz = json.loads((out / "businesses.json").read_text())
    fj = json.loads((out / "faces.json").read_text())
    bfacts = json.loads((out / "buildings.json").read_text())
    frame = Frame(*fj["frame_origin"])
    z = find_business(name_or_id, biz)
    v = lambda k: (z["fields"].get(k) or {}).get("value")  # noqa: E731
    faces = {f["id"]: f for f in fj["faces"]}
    face = faces[z["face"]["id"]]
    fp_rows, _ = datasf.footprints(AREAS[area])
    blds = {b.id: b for b in buildings_from_datasf(fp_rows, frame)}
    bd = blds[z["building"]["id"]]
    bf = bfacts.get(bd.id, {})
    kb = kerbside.buildings(AREAS[area]).get((bf.get("kerbside") or {}).get("osm_id") or "", {})

    ox, oy = ((face["p0"][0] + face["p1"][0]) / 2, (face["p0"][1] + face["p1"][1]) / 2)
    origin = frame.lonlat(ox, oy)
    loc = lambda p: (round(p[0] - ox, 3), round(p[1] - oy, 3))  # noqa: E731
    ring = [loc(p) for p in _shell(bd.poly)]
    p0, p1 = loc(face["p0"]), loc(face["p1"])
    edge = _match_edge(ring, p0, p1)
    if edge is None:
        raise SystemExit(f"{v('name')}: no shell edge carries face {face['id']}")
    a, b = ring[edge], ring[(edge + 1) % len(ring)]
    span = z["face"].get("tenant_span_m") or [0.0, face["length_m"]]
    s0 = _proj(_along(p0, p1, span[0]), a, b)
    s1 = _proj(_along(p0, p1, span[1]), a, b)
    L = math.dist(a, b)
    s0, s1 = max(0.0, min(s0, s1)), min(L, max(s0, s1))

    # wall roles from the original faces (nearest parallel face of this building)
    own = [f for f in fj["faces"] if f["building_id"] == bd.id]
    asm = bf.get("assessor") or {}
    stories = None
    try:
        stories = int(float(asm.get("number_of_stories") or 0)) or None
    except ValueError:
        pass
    height = round(bd.height_m or kb.get("height_m") or 7.0, 2)

    plan, refusal = engine_plan(bd, z, frame)
    pf = None
    if plan:
        tid_face = [f for f in plan["facades"] if f.get("role", "public") == "public"]
        pf = tid_face[0] if tid_face else None
    ground_h = round(min(height - 0.5, (pf or {}).get("band_height_m") or 4.2), 2)
    floors = _floors(height, stories, ground_h)

    app_mat = (kb.get("wall_material") or {})
    material = APP_MATERIAL.get(app_mat.get("class"), "stucco")
    app_col = (kb.get("wall_assigned") or {}).get("colour")
    colour = app_col or MATERIAL_COLOUR.get(app_mat.get("class"), "#d9d2c3")
    walls = []
    for i, pa in enumerate(ring):
        pb = ring[(i + 1) % len(ring)]
        Lw = math.dist(pa, pb)
        role, street = "open", None
        best = None
        for f in own:
            q0, q1 = loc(f["p0"]), loc(f["p1"])
            fbng = bearing(q1[0] - q0[0], q1[1] - q0[1])
            ebng = bearing(pb[0] - pa[0], pb[1] - pa[1])
            if abs((fbng - ebng + 180) % 360 - 180) > 25:
                continue
            d = LineString([pa, pb]).distance(Point((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2))
            if d < 0.8 and (best is None or f["length_m"] > best["length_m"]):
                best = f
        if best:
            role, street = best["role"], best.get("street")
        wid = f"w{i}"
        w = {"id": wid, "edge": i, "length_m": round(Lw, 2), "role": role, "street": street,
             "material": material if role != "party" else "concrete",
             "colour": colour if role != "party" else "#b9b3a8", "texture_scale": 1.0,
             "trim_colour": "#efeae0", "visible": True, "belts": [], "openings": [],
             "evidence": _ev("app" if app_mat else "inferred",
                             f"sf-corridor-materials ({app_mat.get('basis')})" if app_mat else "default",
                             app_mat.get("confidence", 0.2))}
        if role in ("street", "open") and Lw >= 2.0 and len(floors) > 1:
            w["openings"] = default_windows(Lw, floors, ground_h, wid)
        walls.append(w)
    walls[edge]["role"] = "street"
    walls[edge]["street"] = face.get("street")

    # the storefront band from the engine (defaults), mapped onto the shell edge
    sid = f"sf-{slug(v('name') or z['id'])}"
    sf = {"id": sid, "business_id": z["id"], "name": v("name"), "edge": edge,
          "u0": round(s0, 2), "u1": round(s1, 2), "band_h": ground_h,
          "category": (pf or {}).get("category") or z["business_type"]["tag"],
          "brand": (pf or {}).get("brand"), "material": (pf or {}).get("material", "painted_wood"),
          "palette": copy.deepcopy((pf or {}).get("palette") or {
              "wall": colour, "accent": "#264f43", "frame": "#252c2b", "base": "#8b8277",
              "letter": "#f6f1e7", "metal": "#a5aaa7", "glass": "#a7c2c8", "roughness": 0.82}),
          "door_style": (pf or {}).get("door_style"), "openings": [], "signs": [], "awnings": [],
          "lights": [],
          "evidence": _ev("inferred", f"smc.exteriors infer_exterior @ {plan['engine_commit'][:9]}"
                          if plan else f"engine refused: {refusal}", 0.3,
                          span=z["face"].get("span_method"))}
    if pf:
        # the program's frontage edge is the original face, so a plan's u is along face p0->p1
        for o in pf["openings"]:
            u = _proj(_along(p0, p1, o["u"]), a, b)
            sf["openings"].append({k: o.get(k) for k in ("id", "component_kind", "operation",
                                                          "leaf_count", "transom_fraction",
                                                          "privacy_fraction", "shape", "role")}
                                  | {"kind": o.get("component_kind", "window"), "u": round(u, 2),
                                     "v": o["v"], "w": o["w"], "h": o["h"]})
        for s in pf["signs"]:
            u = _proj(_along(p0, p1, s["u"]), a, b)
            row = {k: s.get(k) for k in ("id", "kind", "text", "illumination", "ink", "asset", "icon")}
            row |= {"u": round(u, 2), "v": s["v"], "w": s["w"], "h": s["h"],
                    "text": v("name") if s.get("kind") != "plaque" else s.get("text")}
            if s.get("canopy"):
                c = s["canopy"]
                sf["awnings"].append({"id": f"{sid}:awning", "kind": "shed", "u0": round(u - 0.06, 2),
                                      "u1": round(u + s["w"] + 0.06, 2), "v": round(s["v"] + s["h"], 2),
                                      "depth_m": c.get("depth_m", 0.95), "drop_m": 0.3,
                                      "colour": sf["palette"]["accent"], "stripe": None,
                                      "valance_text": v("name"),
                                      "evidence": _ev("inferred", "smc.exteriors canopy", 0.3)})
            sf["signs"].append(row)
    walls[edge]["openings"] = [o for o in walls[edge]["openings"] if o["v"] >= ground_h - 0.05]

    # app photo openings, where the app's ring edge lines up with a shell edge
    if kb.get("openings") and (bf.get("kerbside") or {}).get("iou", 0) >= 0.6:
        kring = [loc(frame.xy(x, y)) for x, y in kb["points"]]
        for kw, rows in kb["openings"]["walls"].items():
            ki = int(kw)
            if ki + 1 >= len(kring):
                continue
            ka, kbp = kring[ki], kring[ki + 1]
            j = _match_edge(ring, ka, kbp, 15)
            if j is None:
                continue
            sa, sb = ring[j], ring[(j + 1) % len(ring)]
            conv = []
            for n, (u, vv, ww, hh, cf) in enumerate(rows):
                uu = _proj(_along(ka, kbp, u), sa, sb)
                if j == edge and vv < ground_h:
                    continue
                conv.append({"id": f"w{j}:app{n}", "kind": "window", "u": round(uu, 2), "v": vv,
                             "w": ww, "h": hh, "shape": "rect", "mullions": [1, 1],
                             "evidence": _ev("app", "sf-corridor-home-openings "
                                             f"({kb['openings'].get('grade')})", cf)})
            if conv:
                walls[j]["openings"] = [o for o in walls[j]["openings"] if o["v"] < ground_h] + conv

    roof = {"shape": "flat", "colour": (kb.get("roof") or {}).get("c", "#8c8a84"),
            "parapet_h": 0.6, "cornice": {"h": 0.35, "depth": 0.25, "colour": "#efeae0"},
            "evidence": _ev("app" if kb.get("roof") else "inferred", "sf-corridor-roofs NOAA 0.25 m", 0.6)}

    st = street_for({"street": face.get("street"), "p0": face["p0"], "p1": face["p1"]}, frame, (ox, oy))
    seating = seating_for(z, sf, st)

    # neighbours
    ctx = []
    here = Point(0, 0)
    for other in blds.values():
        if other.id == bd.id:
            continue
        g = Polygon([loc(p) for p in other.poly.exterior.coords])
        if g.distance(here) > CONTEXT_RANGE_M:
            continue
        ob = bfacts.get(other.id, {}).get("kerbside") or {}
        cr = _shell(Polygon([loc(p) for p in other.poly.exterior.coords]))
        ctx.append({"id": other.id, "footprint": [list(p) for p in cr],
                    "height_m": round(other.height_m or 7.0, 2),
                    "colour": ob.get("wall_colour") or MATERIAL_COLOUR.get(
                        (ob.get("wall_material") or {}).get("class"), "#d6d0c4"),
                    "roof_colour": ob.get("roof_colour") or "#8c8a84"})

    model = {
        "schema": "kerbfront.building/1", "id": slug(v("name") or z["id"]),
        "title": v("name"), "business_id": z["id"], "area": area,
        "address": z.get("address"), "corridor": z.get("corridor"),
        "business_type": z.get("business_type"),
        "origin_lon_lat": [round(origin[0], 8), round(origin[1], 8)],
        "frame": "local metres: x east, y north, z up",
        "building_id": bd.id, "app_building": (bf.get("kerbside") or {}).get("osm_id"),
        "footprint": [list(p) for p in ring], "height_m": height, "floors": floors,
        "roof": roof, "walls": walls, "storefronts": [sf], "seating": seating, "street": st,
        "context": ctx, "photos": [],
        "facts": {"year_built": asm.get("year_property_built"), "stories": stories,
                  "use": asm.get("use_definition"), "class": asm.get("property_class_code_definition"),
                  "historic": bf.get("historic"), "context_statement": bf.get("context_statement"),
                  "licence": z.get("licence"), "services": z.get("services"),
                  "outdoor": z.get("outdoor"), "last_exterior_change": z.get("last_exterior_change"),
                  "tenants_on_face": z["face"].get("tenants_on_face")},
        "sources": {"footprint": "DataSF ynuv-fyni LiDAR footprint (simplified 0.5 m)",
                    "height": "DataSF hgt_median_m", "app": kerbside.provenance(),
                    "engine": plan["engine_commit"] if plan else refusal},
        "edits": [],
    }
    return model


def photos_for(model: dict, area: str = "marina-union", limit: int = 6) -> list[dict]:
    """Camera poses (model frame) of the selected frames for the photo-match view."""
    out = OUT / area
    tag = model.get("corridor") or "all"
    pfile = out / f"pixels_{tag}.json"
    gfile = out / f"photos_{tag}.json"
    rows = []
    for f in (pfile, gfile):
        if f.exists():
            for r in json.loads(f.read_text())["results"]:
                if r["business"] == model["business_id"]:
                    rows = r.get("final") or r.get("picks") or []
                    break
        if rows:
            break
    from .sources import mapillary
    fj = json.loads((out / "faces.json").read_text())
    frame = Frame(*fj["frame_origin"])
    lon0, lat0 = model["origin_lon_lat"]
    ox, oy = frame.xy(lon0, lat0)
    frames = {f["id"]: f for f in mapillary.frames_live(AREAS[area])[0]}
    cams = []
    for p in rows[:limit]:
        fm = frames.get(p["frame_id"])
        if not fm:
            continue
        x, y = frame.xy(fm["lon"], fm["lat"])
        cams.append({"frame_id": fm["id"], "slot": p.get("slot"), "captured_at": fm.get("captured_at"),
                     "camera_type": fm.get("camera_type"), "x": round(x - ox, 3), "y": round(y - oy, 3),
                     "z": 2.0, "heading": round(fm["heading"], 2), "hfov": round(fm["hfov"], 2),
                     "width": fm.get("width"), "height": fm.get("height"),
                     "position_source": fm.get("position_source"),
                     "licence": "CC BY-SA 4.0 (c) Mapillary contributors"})
    return cams


def write(model: dict) -> Path:
    MODELS.mkdir(parents=True, exist_ok=True)
    dest = MODELS / f"{model['id']}.json"
    dest.write_text(json.dumps(model, indent=1, default=str))
    idx = sorted(p.stem for p in MODELS.glob("*.json") if p.stem != "index")
    (MODELS / "index.json").write_text(json.dumps(
        [{"id": i, "title": json.loads((MODELS / f"{i}.json").read_text()).get("title")} for i in idx], indent=1))
    return dest


def photos_for_wall(model: dict, edge: int, u: tuple[float, float] | None = None, k: int = 4,
                    area: str = "marina-union", since: str | None = None) -> list[dict]:
    """More frames for one wall of a model (a corner building's second street, a parklet's
    stretch): the stage-1 filter run against that wall, appended to ``model["photos"]``."""
    from .faces import Face
    from .photos.geometry import assess
    from .photos.selection import select
    from .sources import mapillary

    out = OUT / area
    fj = json.loads((out / "faces.json").read_text())
    frame = Frame(*fj["frame_origin"])
    lon0, lat0 = model["origin_lon_lat"]
    ox, oy = frame.xy(lon0, lat0)
    ring = model["footprint"]
    a, b = ring[edge], ring[(edge + 1) % len(ring)]
    L = math.dist(a, b)
    u0, u1 = u or (0.0, L)
    p0, p1 = _along(a, b, u0), _along(a, b, u1)
    tx, ty = unit(p1[0] - p0[0], p1[1] - p0[1])
    face = Face(f"{model['id']}:w{edge}", model["building_id"], edge, tuple(p0), tuple(p1), u1 - u0,
                bearing(tx, ty), bearing(ty, -tx), "street", model["walls"][edge].get("street"), None, 1.0)
    from shapely.strtree import STRtree
    frames, _ = mapillary.frames_live(AREAS[area])
    have = {p["frame_id"] for p in model["photos"]}
    own = Polygon(model["footprint"])
    polys = [own] + [Polygon(c["footprint"]) for c in model.get("context", []) if len(c["footprint"]) >= 3]
    polys = [q if q.is_valid else q.buffer(0) for q in polys]
    tree = STRtree(polys)
    rows, fmeta = [], {}
    for f in frames:
        x, y = frame.xy(f["lon"], f["lat"])
        cam = (x - ox, y - oy)
        if math.dist(cam, face.mid) > 45 or f["id"] in have:
            continue
        r = assess(face, f, cam, building_h=model["height_m"], own=polys[0], tree=tree, polys=polys,
                   tenant_since=since, lat=lat0, lon=lon0).to_json()
        rows.append(r)
        fmeta[f["id"]] = {**f, "_cam": cam}
    picks = select(rows, fmeta, k=k)
    added = []
    for pk in picks:
        f = fmeta[pk["frame_id"]]
        added.append({"frame_id": f["id"], "slot": f"wall{edge}:{pk.get('slot')}",
                      "captured_at": f.get("captured_at"), "camera_type": f.get("camera_type"),
                      "x": round(f["_cam"][0], 3), "y": round(f["_cam"][1], 3), "z": 2.0,
                      "heading": round(f["heading"], 2), "hfov": round(f["hfov"], 2),
                      "width": f.get("width"), "height": f.get("height"),
                      "position_source": f.get("position_source"), "wall": edge,
                      "licence": "CC BY-SA 4.0 (c) Mapillary contributors"})
    model["photos"].extend(added)
    return added


def street_for_wall(model: dict, edge: int, area: str = "marina-union") -> dict:
    """``street_for`` on one wall of a model (the app's street record nearest that wall)."""
    out = OUT / area
    fj = json.loads((out / "faces.json").read_text())
    frame = Frame(*fj["frame_origin"])
    ox, oy = frame.xy(*model["origin_lon_lat"])
    ring = model["footprint"]
    a, b = ring[edge], ring[(edge + 1) % len(ring)]
    st = street_for({"street": model["walls"][edge].get("street"), "p0": (a[0] + ox, a[1] + oy),
                     "p1": (b[0] + ox, b[1] + oy)}, frame, (ox, oy))
    return {"edge": edge, **st}
