"""The city's people up close, built from MakeHuman's CC0 assets (docs/55-makehuman-crowd.md). Run
inside Blender with MPFB:

    ~/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/avatars/build_crowd_people.py -- \
        --out build/crowd --soldier path/to/Soldier.glb [--only male]

One GLB per sex: the MakeHuman body as its low-poly proxy (female1605 / male1591: ~3,000
triangles) on MPFB's Mixamo skeleton, with Idle, Walk and Run (the three.js Soldier's Mixamo
clips, retargeted as the avatar creator does it), and every part a person can wear skinned to the
same bones: each suit cut at the waist into a top and a bottom (so any top goes with any bottom),
shoes, hair, beards, a hat, eyebrows and eyes -- each cut down to a crowd's triangle budget.

Each mesh carries:
  - four morphs (weight-, weight+, muscle+, old), the body's and every part's moving together,
    so one mesh is any build and age (the page mixes them per person);
  - clothes: ``_shade``, the garment's own texture as light and dark (folds, seams, pockets),
    so the page needs no clothes textures and colours each person's clothes itself;
  - the body: ``_cover``, a bit per part (its MakeHuman delete group): the skin under what a
    person wears is not drawn.
Hair, eyebrows and eyes keep a small texture (alpha). The skins are written as JPEGs, two a sex
(young, old), toned per person by the page. ``crowd.json`` lists the parts, their slots, bits
and credits. Everything here is CC0 (the two AGPL beards are left out).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import mathutils

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_makehuman_avatars as av
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

#: The morphs a crowd mixes per person: build and age. (Each a delta per vertex on every mesh.)
MORPHS = {
    "weight-": ("macro", "weight", 0.0),
    "weight+": ("macro", "weight", 1.0),
    "muscle+": ("macro", "muscle", 1.0),
    "old": ("macro", "age", 1.0),
}
PROXY = {"male": "male1591", "female": "female1605"}
#: Parts: (slot, MakeHuman folder, asset, mpfb type, bodies, triangle budget, keep texture).
PARTS = [
    *[
        ("outfit", "clothes", f"male_casualsuit0{i}", "Clothes", ["male"], 2600, False)
        for i in range(1, 7)
    ],
    ("outfit", "clothes", "male_elegantsuit01", "Clothes", ["male"], 2600, False),
    ("outfit", "clothes", "male_worksuit01", "Clothes", ["male"], 2600, False),
    ("outfit", "clothes", "female_casualsuit01", "Clothes", ["female"], 2600, False),
    ("outfit", "clothes", "female_casualsuit02", "Clothes", ["female"], 2600, False),
    ("outfit", "clothes", "female_elegantsuit01", "Clothes", ["female"], 2600, False),
    ("outfit", "clothes", "female_sportsuit01", "Clothes", ["female"], 2600, False),
    *[
        ("shoes", "clothes", f"shoes0{i}", "Clothes", ["male", "female"], 420, False)
        for i in range(1, 7)
    ],
    *[
        ("hair", "hair", h, "Hair", ["male", "female"], 1800, True)
        for h in [
            "short01",
            "short02",
            "short03",
            "short04",
            "bob02",
            "long01",
            "ponytail01",
            "braid01",
            "afro01",
        ]
    ],
    ("facial_hair", "clothes", "rehmanpolanski_beard_viking", "Clothes", ["male"], 1200, True),
    ("facial_hair", "clothes", "rehmanpolanski_moustache_viking", "Clothes", ["male"], 600, True),
    ("hat", "clothes", "fedora01", "Clothes", ["male", "female"], 500, False),
    ("eyebrows", "eyebrows", "eyebrow001", "Eyebrows", ["male", "female"], 0, True),
    ("eyebrows", "eyebrows", "eyebrow006", "Eyebrows", ["male", "female"], 0, True),
    ("eyes", "eyes", "low-poly", "Eyes", ["male", "female"], 0, True),
]
SKINS = {
    "male": ("young_caucasian_male", "old_caucasian_male"),
    "female": ("young_caucasian_female", "old_caucasian_female"),
}
PART_TEXTURE_PX = 256
SKIN_PX = 512
CREDIT = (
    "MakeHuman system assets (CC0: Data Collection AB, Joel Palmius, Jonas Hauquier), MakeHuman community "
    "bodyparts05 beards (CC0: RehmanPolanski); bodies made with MPFB; motion: the three.js Soldier's Mixamo clips."
)


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--soldier", type=Path, required=True)
    p.add_argument("--only", choices=["male", "female"])
    return p.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def proxy_file(name: str) -> str:
    for root in (av.data_dir(), Path(av.LocationService.get_mpfb_data())):
        for path in (root / "proxymeshes" / name).glob("*.proxy"):
            return str(path)
    raise FileNotFoundError(f"proxymeshes/{name}")


# ---- morphs ---------------------------------------------------------------------------------


def record(base, objects) -> dict:
    """{morph: {object name: [delta per vertex]}}: each morph against the default shape."""
    HumanService.refit(base)
    default = {o.name: av.rest_coords(o) for o in objects}
    out = {}
    for morph, how in MORPHS.items():
        av.set_end(base, how, True)
        HumanService.refit(base)
        out[morph] = {}
        for o in objects:
            now = av.rest_coords(o)
            out[morph][o.name] = [b - a for a, b in zip(default[o.name], now, strict=True)]
        av.set_end(base, how, False)
        print(f"  {morph}: recorded on {len(objects)} meshes", flush=True)
    HumanService.refit(base)
    return out


def freeze(obj):
    """An object's modifiers other than the skeleton applied (the masks, any subdivision), its
    shape as it is now its only shape."""
    if obj.data.shape_keys:
        obj.shape_key_clear()
    bpy.context.view_layer.objects.active = obj
    for m in list(obj.modifiers):
        if m.type == "ARMATURE":
            continue
        obj.modifiers.remove(m)


def nearest_deltas(obj, src_coords, deltas_by_morph):
    """Morph deltas for ``obj``'s vertices, each its nearest source vertex's (the part as it was
    before it was cut down or split)."""
    kd = mathutils.kdtree.KDTree(len(src_coords))
    for i, c in enumerate(src_coords):
        kd.insert(c, i)
    kd.balance()
    world = obj.matrix_world
    picks = [kd.find(world @ v.co)[1] for v in obj.data.vertices]
    return {m: [d[i] for i in picks] for m, d in deltas_by_morph.items()}


def put_morphs(obj, deltas_by_morph):
    if not obj.data.shape_keys:
        obj.shape_key_add(name="Basis", from_mix=False)
    inv = obj.matrix_world.inverted().to_3x3()
    basis = obj.data.shape_keys.key_blocks["Basis"]
    for morph, deltas in deltas_by_morph.items():
        key = obj.shape_key_add(name=morph, from_mix=False)
        for i, d in enumerate(deltas):
            key.data[i].co = basis.data[i].co + inv @ d


# ---- cutting --------------------------------------------------------------------------------


def decimate(obj, budget: int):
    """Cut ``obj`` down to about ``budget`` triangles (weights carried: the decimator keeps each
    kept vertex's groups)."""
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if not budget or tris <= budget:
        return tris
    bpy.context.view_layer.objects.active = obj
    m = obj.modifiers.new("cut", "DECIMATE")
    m.ratio = budget / tris
    m.use_collapse_triangulate = True
    # (Before the skeleton's modifier, so it is the rest shape that is cut.)
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
        bpy.ops.object.modifier_apply(modifier=m.name)
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def split_at(obj, z_cut: float, keep_above: bool, name: str):
    """A copy of ``obj`` with only its top (or its bottom). A suit's shirt and trousers are pieces
    of their own in MakeHuman's meshes: each piece goes whole to the side its middle is on (a
    shirt's hem below the waist stays the shirt's). A piece reaching well over both sides (a
    one-piece -- overalls, a dress) is cut at ``z_cut``, face by face."""
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = name
    bpy.context.collection.objects.link(new)
    bm = bmesh.new()
    bm.from_mesh(new.data)
    w = new.matrix_world
    side = {}
    seen = set()
    for f0 in bm.faces:
        if f0.index in seen:
            continue
        piece, todo = [], [f0]
        seen.add(f0.index)
        while todo:
            f = todo.pop()
            piece.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        todo.append(g)
        zs = [(w @ f.calc_center_median()).z for f in piece]
        area = sum(f.calc_area() for f in piece) or 1.0
        mid = sum(z * f.calc_area() for z, f in zip(zs, piece, strict=True)) / area
        whole = not (min(zs) < z_cut - 0.25 and max(zs) > z_cut + 0.25)
        for z, f in zip(zs, piece, strict=True):
            side[f.index] = (mid if whole else z) >= z_cut
    drop = [f for f in bm.faces if side[f.index] != keep_above]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(new.data)
    bm.free()
    return new


# ---- shade and textures ---------------------------------------------------------------------


def image_of(obj):
    for slot in obj.material_slots:
        mat = slot.material
        if not mat or not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and "normal" not in node.image.name.lower():
                return node.image
    return None


def bake_shade(obj):
    """``_shade``: the garment texture's light and dark at each vertex, relative to its average
    (1 = as average), from its UVs. Without a texture, 1."""
    img = image_of(obj)
    shade = [1.0] * len(obj.data.vertices)
    if img and img.size[0] > 0:
        w, h = img.size
        px = list(img.pixels)

        def lum(u, v):
            x = min(w - 1, max(0, int((u % 1.0) * w)))
            y = min(h - 1, max(0, int((v % 1.0) * h)))
            i = (y * w + x) * 4
            return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]

        uv = obj.data.uv_layers.active
        acc = [[0.0, 0] for _ in obj.data.vertices]
        for loop in obj.data.loops:
            u, v = uv.data[loop.index].uv
            a = acc[loop.vertex_index]
            a[0] += lum(u, v)
            a[1] += 1
        vals = [a[0] / a[1] if a[1] else 0.0 for a in acc]
        mean = sum(vals) / max(1, len(vals)) or 1.0
        shade = [max(0.35, min(1.6, v / mean)) for v in vals]
    attr = obj.data.attributes.new("_shade", "FLOAT", "POINT")
    attr.data.foreach_set("value", shade)


def plain_material(obj, keep_texture: bool, folder: Path, name: str):
    """One material a part: its texture kept (shrunk, written beside) for hair, brows and eyes;
    for clothes none (their shade is in ``_shade``)."""
    img = image_of(obj) if keep_texture else None
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    file = None
    if img:
        if max(img.size) > PART_TEXTURE_PX:
            s = PART_TEXTURE_PX / max(img.size)
            img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
        file = f"tex/{name}.png"
        (folder / "tex").mkdir(parents=True, exist_ok=True)
        img.filepath_raw = str(folder / file)
        img.file_format = "PNG"
        img.save()
        # (Not in the GLB: the page loads the PNG named in crowd.json, keeping its alpha.)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return file


# ---- the face, the mouth and the caps ----------------------------------------------------------

#: The head's triangles: the face is where the eye goes, so it is drawn finer than the body (the
#: body proxy's own head is a few hundred).
HEAD_TRIS = 3800


def group_center(obj, name: str):
    g = obj.vertex_groups[name]
    w = obj.matrix_world
    pts = [w @ v.co for v in obj.data.vertices if any(e.group == g.index and e.weight > 0.5 for e in v.groups)]
    return sum(pts, mathutils.Vector()) / len(pts)


def face_marks(base) -> dict:
    """Where the face is on the base mesh (Blender's world: z up, -y forward): the lips, the
    chin, the jaw's hinge (MakeHuman's own jaw joint) and the eyes."""
    return {
        "lips": group_center(base, "lips"),
        "chin": group_center(base, "joint-jaw"),
        "pivot": group_center(base, "joint-mouth"),
        "eye": (group_center(base, "helper-l-eye") + group_center(base, "helper-r-eye")) / 2,
    }


def make_head(base, marks):
    """The base mesh's own head and neck -- its skin only, no helpers -- cut a little below the
    chin, as a part of its own over the proxy's (whose head the part's _cover bit hides)."""
    head = base.copy()
    head.data = base.data.copy()
    head.name = "head__basemesh"
    bpy.context.collection.objects.link(head)
    if head.data.shape_keys:
        head.shape_key_clear()
    for m in list(head.modifiers):
        if m.type != "ARMATURE":
            head.modifiers.remove(m)
    cut = marks["chin"].z - 0.045
    skin = head.vertex_groups["body"].index
    w = head.matrix_world
    keep = {
        v.index
        for v in head.data.vertices
        if (w @ v.co).z > cut and any(e.group == skin and e.weight > 0.5 for e in v.groups)
    }
    bm = bmesh.new()
    bm.from_mesh(head.data)
    drop = [f for f in bm.faces if not all(v.index in keep for v in f.verts)]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(head.data)
    bm.free()
    for g in [g for g in head.vertex_groups if not g.name.startswith("mixamorig")]:
        head.vertex_groups.remove(g)
    return head, cut


def put_jaw(head, marks):
    """``_jaw``: how much of each point the jaw carries when the mouth opens (the lower lip, the
    chin and the jaw in front of its hinge; not the neck)."""
    lips_z, piv, chin_z = marks["lips"].z, marks["pivot"], marks["chin"].z
    w = head.matrix_world
    vals = []
    for v in head.data.vertices:
        p = w @ v.co
        below = min(1.0, max(0.0, (lips_z - 0.002 - p.z) / 0.006))
        ahead = min(1.0, max(0.0, (piv.y + 0.03 - p.y) / 0.03))
        not_neck = min(1.0, max(0.0, (p.z - (chin_z - 0.035)) / 0.02))
        vals.append(below * ahead * not_neck)
    head.data.attributes.new("_jaw", "FLOAT", "POINT").data.foreach_set("value", vals)


def bound_to_head(obj, rig):
    """A mesh made here, carried by the head bone (all of it, weight 1)."""
    bpy.context.collection.objects.link(obj)
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    g = obj.vertex_groups.new(name="mixamorig:Head")
    g.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def make_mouth(rig, marks):
    """The inside of the mouth, seen when it opens: a card just behind the lips (coloured dark by
    the page, not black)."""
    lips = marks["lips"]
    cx, cy, cz = lips.x, lips.y + 0.018, lips.z - 0.006
    w, h = 0.026, 0.016
    mesh = bpy.data.meshes.new("mouth__back")
    mesh.from_pydata([(cx - w, cy, cz - h), (cx + w, cy, cz - h), (cx + w, cy, cz + h * 0.6), (cx - w, cy, cz + h * 0.6)], [], [(0, 1, 2, 3)])
    obj = bound_to_head(bpy.data.objects.new("mouth__back", mesh), rig)
    obj.data.attributes.new("_shade", "FLOAT", "POINT").data.foreach_set("value", [1.0] * 4)
    return obj


def make_cap(rig, base, marks, kind: str):
    """A cap fitted to the head above the brow: a ``baseball_cap`` (a crown and a peak) or a
    ``beanie`` (a rounder crown down over the ears, its turned-up band darker)."""
    w = base.matrix_world
    skin = base.vertex_groups["body"].index
    brow = marks["eye"].z + 0.03
    pts = [w @ v.co for v in base.data.vertices
           if any(e.group == skin and e.weight > 0.5 for e in v.groups) and (w @ v.co).z > brow - 0.005]
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    rx, ry, top = (max(xs) - min(xs)) / 2 + 0.012, (max(ys) - min(ys)) / 2 + 0.014, max(zs) + 0.012
    front, drop = (brow - 0.012, 0.045) if kind == "beanie" else (brow + 0.002, 0.03)
    seg, rings = 20, 6
    bm = bmesh.new()
    grid = []
    for k in range(rings):
        phi = k / rings * math.pi / 2
        row = []
        for j in range(seg):
            th = 2 * math.pi * j / seg
            z0 = front - drop * max(0.0, math.sin(th))
            row.append(bm.verts.new((cx + rx * math.cos(phi) * math.cos(th), cy + ry * math.cos(phi) * math.sin(th), z0 + (top - z0) * math.sin(phi))))
        grid.append(row)
    pole = bm.verts.new((cx, cy, top))
    for k in range(rings - 1):
        for j in range(seg):
            bm.faces.new((grid[k][j], grid[k][(j + 1) % seg], grid[k + 1][(j + 1) % seg], grid[k + 1][j]))
    for j in range(seg):
        bm.faces.new((grid[-1][j], grid[-1][(j + 1) % seg], pole))
    band = set(grid[0]) if kind == "beanie" else set()
    under, up = set(), []
    if kind == "baseball_cap":
        # The peak: a thin slab out over the brow, over the front of the base ring.
        js = [j for j in range(seg) if math.sin(2 * math.pi * j / seg) < -0.3]
        js.sort(key=lambda j: math.cos(2 * math.pi * j / seg))
        up, down = [], []
        for j in js:
            th = 2 * math.pi * j / seg
            inner = grid[0][j].co
            reach = 0.075 * (-math.sin(th)) ** 2
            out = (cx + (rx + 0.02) * math.cos(th), cy + (ry + reach) * math.sin(th), inner.z - 0.012)
            up.append((bm.verts.new((inner.x, inner.y, inner.z)), bm.verts.new(out)))
            down.append((bm.verts.new((inner.x, inner.y, inner.z - 0.005)), bm.verts.new((out[0], out[1], out[2] - 0.005))))
        for i in range(len(js) - 1):
            # (Wound so the top faces up, the underside down and the edge forward.)
            bm.faces.new((up[i][1], up[i + 1][1], up[i + 1][0], up[i][0]))
            bm.faces.new((down[i][0], down[i + 1][0], down[i + 1][1], down[i][1]))
            bm.faces.new((down[i][1], down[i + 1][1], up[i + 1][1], up[i][1]))
        under = {v for pair in down for v in pair}
    peak = {v for pair in up for v in pair} | under if kind == "baseball_cap" else set()
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if not (set(f.verts) & peak)])
    mesh = bpy.data.meshes.new(f"hat__{kind}")
    bm.to_mesh(mesh)
    shade = []
    index = {v.index: v for v in bm.verts}
    for i in range(len(mesh.vertices)):
        v = index[i]
        shade.append(0.78 if v in band else 0.7 if v in under else 1.0)
    bm.free()
    obj = bound_to_head(bpy.data.objects.new(f"hat__{kind}", mesh), rig)
    obj.data.attributes.new("_shade", "FLOAT", "POINT").data.foreach_set("value", shade)
    return obj


# ---- one sex --------------------------------------------------------------------------------


def build(sex: str, soldier: Path, out: Path) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    macro = TargetService.get_default_macro_info_dict()
    macro["gender"] = 1.0 if sex == "male" else 0.0
    base = HumanService.create_human(macro_detail_dict=macro, feet_on_ground=True, scale=0.1)
    rig = HumanService.add_builtin_rig(base, "mixamo")
    body = HumanService.add_mhclo_asset(
        proxy_file(PROXY[sex]),
        base,
        asset_type="Proxymeshes",
        subdiv_levels=0,
        material_type="NONE",
    )
    body.name = f"body_{sex}"
    skin_mhmat = next((av.data_dir() / "skins" / SKINS[sex][0]).glob("*.mhmat"))
    HumanService.set_character_skin(
        str(skin_mhmat), base, bodyproxy=body, skin_type="GAMEENGINE", material_instances=False
    )
    parts = {}
    for slot, folder, asset, kind, bodies, budget, keep in PARTS:
        if sex not in bodies:
            continue
        obj = HumanService.add_mhclo_asset(
            str(av.mhclo(folder, asset)),
            base,
            asset_type=kind,
            subdiv_levels=0,
            material_type="GAMEENGINE",
        )
        obj.name = f"{slot}__{asset}"
        for m in [m for m in obj.modifiers if m.type == "SUBSURF"]:
            obj.modifiers.remove(m)
        parts[obj.name] = {"slot": slot, "asset": asset, "budget": budget, "keep": keep, "obj": obj}
        print(f"{sex}: {obj.name} ({len(obj.data.polygons)} faces)", flush=True)
    objects = [body, *[p["obj"] for p in parts.values()]]
    morphs = record(base, [*objects, base])
    TargetService.bake_targets(base)
    HumanService.refit(base)
    # The skin each part covers: the body proxy's delete groups (MPFB carries each part's onto it).
    covers = {}
    for name, p in parts.items():
        g = body.vertex_groups.get("Delete." + p["asset"].replace(" ", "_")) or next(
            (
                vg
                for vg in body.vertex_groups
                if vg.name.startswith("Delete.") and p["asset"] in vg.name
            ),
            None,
        )
        if g:
            covers[name] = {
                v.index
                for v in body.data.vertices
                for e in v.groups
                if e.group == g.index and e.weight >= 0.5
            }
    for o in objects:
        freeze(o)
    rest = {o.name: av.rest_coords(o) for o in objects}
    # The waist: where a suit is cut into its top and its bottom (the hips' bone, a little up).
    hips = rig.matrix_world @ rig.data.bones["mixamorig:Hips"].head_local
    waist = hips.z + 0.06
    out_parts = []
    bits, folder = {}, out / sex
    final = [body]
    put_morphs(body, {m: morphs[m][body.name] for m in MORPHS})
    # The face: the base mesh's own head, finer than the proxy's, its jaw free to open; the inside
    # of the mouth behind it; and the caps, fitted to the head.
    base_rest = av.rest_coords(base)
    base_deltas = {m: morphs[m][base.name] for m in MORPHS}
    marks = face_marks(base)
    head, head_cut = make_head(base, marks)
    tris = decimate(head, HEAD_TRIS)
    put_morphs(head, nearest_deltas(head, base_rest, base_deltas))
    put_jaw(head, marks)
    plain_material(head, False, folder, head.name)
    bits[head.name] = len(bits)
    covers[head.name] = {i for i, c in enumerate(av.rest_coords(body)) if c.z > head_cut + 0.02}
    head["kb"] = json.dumps({"slot": "head", "asset": "basemesh", "bit": bits[head.name]})
    final.append(head)
    out_parts.append({"id": head.name, "slot": "head", "asset": "basemesh", "tris": tris, "bit": bits[head.name], "texture": None})
    print(f"  {head.name}: {tris} triangles", flush=True)
    for made, slot, asset in [(make_mouth(rig, marks), "mouth", "back"),
                              (make_cap(rig, base, marks, "baseball_cap"), "hat", "baseball_cap"),
                              (make_cap(rig, base, marks, "beanie"), "hat", "beanie")]:
        put_morphs(made, nearest_deltas(made, base_rest, base_deltas))
        plain_material(made, False, folder, made.name)
        made["kb"] = json.dumps({"slot": slot, "asset": asset, "bit": None})
        final.append(made)
        n = sum(len(p.vertices) - 2 for p in made.data.polygons)
        out_parts.append({"id": made.name, "slot": slot, "asset": asset, "tris": n, "bit": None, "texture": None})
        print(f"  {made.name}: {n} triangles", flush=True)
    # (glTF's frame: y up, z forward.)
    jaw_pivot = [round(marks["pivot"].x, 4), round(marks["pivot"].z, 4), round(-marks["pivot"].y, 4)]
    for name, p in parts.items():
        obj, src = p["obj"], rest[name]
        deltas = {m: morphs[m][name] for m in MORPHS}
        bake_shade(obj)
        pieces = []
        if p["slot"] == "outfit":
            top = split_at(obj, waist, True, f"top__{p['asset']}")
            bottom = split_at(obj, waist, False, f"bottom__{p['asset']}")
            bpy.data.objects.remove(obj, do_unlink=True)
            pieces = [(top, "top", p["budget"] // 2), (bottom, "bottom", p["budget"] // 2)]
        else:
            pieces = [(obj, p["slot"], p["budget"])]
        for piece, slot, budget in pieces:
            tris = decimate(piece, budget)
            put_morphs(piece, nearest_deltas(piece, src, deltas))
            tex = plain_material(piece, p["keep"], folder, piece.name)
            # This part's bit of the body's _cover (a suit's covered skin to its top or its bottom by height).
            bit = None
            if name in covers:
                bit = len(bits)
                bits[piece.name] = bit
            piece["kb"] = json.dumps({"slot": slot, "asset": p["asset"], "bit": bit})
            final.append(piece)
            out_parts.append(
                {
                    "id": piece.name,
                    "slot": slot,
                    "asset": p["asset"],
                    "tris": tris,
                    "bit": bit,
                    "texture": tex,
                }
            )
            print(f"  {piece.name}: {tris} triangles", flush=True)
    # The body's _cover: per vertex, the bits of the parts over it (a suit's split by the waist).
    cover = [0] * len(body.data.vertices)
    body_rest = av.rest_coords(body)
    for name, verts in covers.items():
        asset = parts[name]["asset"] if name in parts else None
        for i in verts:
            if name in parts and parts[name]["slot"] == "outfit":
                piece = f"top__{asset}" if body_rest[i].z >= waist else f"bottom__{asset}"
            else:
                piece = name
            if piece in bits:
                cover[i] |= 1 << bits[piece]
    attr = body.data.attributes.new("_cover", "FLOAT", "POINT")
    attr.data.foreach_set("value", [float(c) for c in cover])
    body["kb"] = json.dumps({"slot": "body"})
    # (The skin is the page's to load: skins/*.jpg; no image goes in the GLB.)
    body.data.materials.clear()
    body.data.materials.append(bpy.data.materials.new("skin"))
    # Motion: the Soldier's clips on the skeleton.
    soldier_arm, soldier_objs = av.import_soldier(soldier)
    clips = [av.retarget(soldier_arm, rig, clip) for clip in av.SOLDIER_CLIPS]
    for clip in clips:
        clip.use_fake_user = True
        rig.animation_data.nla_tracks.new().strips.new(clip.name, 0, clip)
    rig.animation_data.action = None
    for o in soldier_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for action in [a for a in bpy.data.actions if a not in clips]:
        bpy.data.actions.remove(action)
    for clip, name in zip(clips, av.SOLDIER_CLIPS, strict=True):
        clip.name = name
    for track in rig.animation_data.nla_tracks:
        for strip in track.strips:
            strip.name = strip.action.name
    bpy.data.objects.remove(base, do_unlink=True)
    for img in bpy.data.images:
        if max(img.size) > SKIN_PX:
            s = SKIN_PX / max(img.size)
            img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
    path = out / f"{sex}.glb"
    bpy.ops.object.select_all(action="DESELECT")
    for o in [*final, rig]:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,
        export_animations=True,
        export_attributes=True,
        export_extras=True,
        export_animation_mode="ACTIONS",
        export_image_format="NONE",
        export_yup=True,
        export_def_bones=True,
        export_tangents=False,
    )
    height = max((body.matrix_world @ mathutils.Vector(c)).z for c in body.bound_box)
    return {
        "file": f"{sex}.glb",
        "height_m": round(height, 3),
        "parts": out_parts,
        "bits": len(bits),
        "body_triangles": sum(len(p.vertices) - 2 for p in body.data.polygons),
        "jaw_pivot": jaw_pivot,
    }


def write_skins(out: Path) -> dict:
    files = {}
    for sex, names in SKINS.items():
        for name in names:
            folder = av.data_dir() / "skins" / name
            src = next(
                p
                for p in folder.glob("*.png")
                if "diffuse" in p.name or "texture" in p.name.lower()
            )
            img = bpy.data.images.load(str(src))
            s = SKIN_PX / max(img.size)
            img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
            dest = out / "skins" / f"{name}.jpg"
            dest.parent.mkdir(parents=True, exist_ok=True)
            scene = bpy.context.scene
            scene.render.image_settings.file_format = "JPEG"
            scene.render.image_settings.quality = 85
            img.save_render(str(dest), scene=scene)
            files.setdefault(sex, []).append(f"skins/{name}.jpg")
    return files


def main():
    a = args()
    built = {}
    for sex in [a.only] if a.only else ["male", "female"]:
        built[sex] = build(sex, a.soldier, a.out)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    skins = write_skins(a.out)
    manifest = {
        "version": 1,
        "credit": CREDIT,
        "morphs": list(MORPHS),
        "clips": list(av.SOLDIER_CLIPS),
        "bodies": {sex: {**b, "skins": skins[sex]} for sex, b in built.items()},
    }
    (a.out / "crowd.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(
        "BUILT",
        ", ".join(
            f"{sex}: {len(b['parts'])} parts, body {b['body_triangles']} triangles"
            for sex, b in built.items()
        ),
    )


if __name__ == "__main__":
    main()
