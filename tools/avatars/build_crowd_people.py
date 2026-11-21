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
    morphs = record(base, objects)
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
        asset = parts[name]["asset"]
        for i in verts:
            if parts[name]["slot"] == "outfit":
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
