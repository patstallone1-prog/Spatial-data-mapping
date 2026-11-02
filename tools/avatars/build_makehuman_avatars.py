"""The avatar creator's parts, built from MakeHuman's free assets. Run inside Blender with MPFB:

    ~/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/avatars/build_makehuman_avatars.py -- \
        --out build/avatars --soldier path/to/Soldier.glb [--only male] [--items hair/short02 ...]

For each body (male, female) MPFB makes a MakeHuman base on its Mixamo skeleton, dresses it in
every catalogued item at once (hair, facial hair, eyebrows, eyelashes, eyes, outfits, shoes),
and then, for each slider in SLIDERS, sets the slider to its end, refits every item to the body,
and records where every vertex went. Back at the default, each recording becomes a morph target
(a shape key named after the slider's end) on the body and on every item it moved. Nothing is
re-rigged as a slider moves, so sliders change shape, not proportions: height is a scale, given
by the page. Idle, Walk and Run are the three.js Soldier's Mixamo clips, retargeted through a
shared T-pose (see retarget()). Out come one glTF per body (mesh, skeleton, clips) and one per
item (its mesh skinned to the same bones, which the page binds to the body's skeleton), plus
skins as JPEGs and ``catalogue.json``: what the page offers and where each part is.

MakeHuman's character output, its system assets and the bodyparts05 beards are CC0 (authors are
still credited in the catalogue). Mixamo's clips come with the Soldier, as the page already uses
them. Each outfit also lists the body vertices it covers (MakeHuman's delete groups), so the page
can hide skin that would poke through it.
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
from bl_ext.blender_org.mpfb.entities.objectproperties import HumanObjectProperties
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.locationservice import LocationService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

#: (slider, end, how): a macro detail (weight, muscle) moves 0.5 -> 0 or 1; a target file is
#: loaded at full weight. Each end is its own morph, so the page blends -1..1 from two.
SLIDERS = {
    "weight": [("weight-", ("macro", "weight", 0.0)), ("weight+", ("macro", "weight", 1.0))],
    "muscle": [("muscle-", ("macro", "muscle", 0.0)), ("muscle+", ("macro", "muscle", 1.0))],
    "belly": [("belly+", ("target", "stomach/stomach-pregnant-incr"))],
    "head_oval": [("head_oval+", ("target", "head/head-oval"))],
    "head_round": [("head_round+", ("target", "head/head-round"))],
    "head_square": [("head_square+", ("target", "head/head-square"))],
    "head_triangle": [("head_triangle+", ("target", "head/head-triangular"))],
    "head_heart": [("head_heart+", ("target", "head/head-invertedtriangular"))],
    "head_diamond": [("head_diamond+", ("target", "head/head-diamond"))],
    "face_fat": [("face_fat-", ("target", "head/head-fat-decr")), ("face_fat+", ("target", "head/head-fat-incr"))],
    "jaw": [("jaw-", ("target", "chin/chin-width-decr")), ("jaw+", ("target", "chin/chin-width-incr"))],
    "chin": [("chin-", ("target", "chin/chin-prominent-decr")), ("chin+", ("target", "chin/chin-prominent-incr"))],
    "chin_height": [("chin_height-", ("target", "chin/chin-height-decr")), ("chin_height+", ("target", "chin/chin-height-incr"))],
    "cheekbones": [("cheekbones-", ("target", "cheek/l-cheek-bones-decr", "cheek/r-cheek-bones-decr")),
                   ("cheekbones+", ("target", "cheek/l-cheek-bones-incr", "cheek/r-cheek-bones-incr"))],
    "nose_width": [("nose_width-", ("target", "nose/nose-scale-horiz-decr")), ("nose_width+", ("target", "nose/nose-scale-horiz-incr"))],
    "nose_length": [("nose_length-", ("target", "nose/nose-scale-vert-decr")), ("nose_length+", ("target", "nose/nose-scale-vert-incr"))],
    "nose_hump": [("nose_hump-", ("target", "nose/nose-hump-decr")), ("nose_hump+", ("target", "nose/nose-hump-incr"))],
    "eyes": [("eyes-", ("target", "eyes/l-eye-scale-decr", "eyes/r-eye-scale-decr")),
             ("eyes+", ("target", "eyes/l-eye-scale-incr", "eyes/r-eye-scale-incr"))],
    "lips": [("lips-", ("target", "mouth/mouth-lowerlip-volume-decr", "mouth/mouth-upperlip-volume-decr")),
             ("lips+", ("target", "mouth/mouth-lowerlip-volume-incr", "mouth/mouth-upperlip-volume-incr"))],
    "ears": [("ears-", ("target", "ears/l-ear-scale-decr", "ears/r-ear-scale-decr")),
             ("ears+", ("target", "ears/l-ear-scale-incr", "ears/r-ear-scale-incr"))],
}
#: A morph that moves an item less than this anywhere is left off it.
MORPH_MIN_M = 0.0008
#: Textures are cut to this size and written as JPEG (alpha-mapped ones as PNG).
TEXTURE_PX = 1024
SOLDIER_CLIPS = ("Idle", "Walk", "Run")


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--soldier", type=Path, required=True)
    p.add_argument("--catalogue", type=Path, default=Path(__file__).with_name("catalogue.json"))
    p.add_argument("--only", choices=["male", "female"])
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def data_dir() -> Path:
    return Path(LocationService.get_user_data())


def mhclo(kind: str, name: str) -> Path:
    """An installed asset's .mhclo (or .proxy) file, from MPFB's user data or its system data."""
    for root in (data_dir(), Path(LocationService.get_mpfb_data())):
        for pattern in ("*.mhclo", "*.proxy"):
            for path in (root / kind / name).glob(pattern):
                return path
    raise FileNotFoundError(f"{kind}/{name}: not installed (unzip its asset pack into {data_dir()})")


# ---- shapes ---------------------------------------------------------------------------------

def rest_coords(obj) -> list[mathutils.Vector]:
    """An object's vertices with its shape keys mixed, before any modifier (the skeleton, the
    masks hiding helpers and covered skin) changes them, so indices are the mesh's own."""
    mods = [m for m in obj.modifiers if m.show_viewport]
    for m in mods:
        m.show_viewport = False
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    mesh = obj.evaluated_get(deps).to_mesh()
    coords = [obj.matrix_world @ v.co for v in mesh.vertices]
    obj.evaluated_get(deps).to_mesh_clear()
    for m in mods:
        m.show_viewport = True
    return coords


def set_end(base, how, on: bool):
    """Put one slider end on the body (``on``) or take it off again."""
    if how[0] == "macro":
        HumanObjectProperties.set_value(how[1], how[2] if on else 0.5, entity_reference=base)
        TargetService.reapply_macro_details(base)
        return
    for name in how[1:]:
        key = "slider_" + name.split("/")[-1]
        if on:
            path = Path(LocationService.get_mpfb_data("targets")) / f"{name}.target.gz"
            if not path.exists():
                raise FileNotFoundError(path)
            TargetService.load_target(base, str(path), weight=1.0, name=key)
        else:
            base.shape_key_remove(base.data.shape_keys.key_blocks[key])


def record_morphs(base, items) -> dict:
    """{morph: {object name: [delta per vertex]}} for every slider end, against the default."""
    objects = [base, *items]
    HumanService.refit(base)
    default = {o.name: rest_coords(o) for o in objects}
    out = {}
    for _slider, ends in SLIDERS.items():
        for morph, how in ends:
            set_end(base, how, True)
            HumanService.refit(base)
            moved = {}
            for o in objects:
                now = rest_coords(o)
                delta = [b - a for a, b in zip(default[o.name], now, strict=True)]
                if max((d.length for d in delta), default=0) >= MORPH_MIN_M:
                    moved[o.name] = delta
            out[morph] = moved
            set_end(base, how, False)
            print(f"  {morph}: moves {', '.join(sorted(moved)) or 'nothing'}", flush=True)
    HumanService.refit(base)
    return out


def add_morphs(obj, morphs: dict):
    """The recorded ends as shape keys on an object whose basis is now its default shape."""
    if not obj.data.shape_keys:
        obj.shape_key_add(name="Basis", from_mix=False)
    inv = obj.matrix_world.inverted().to_3x3()
    basis = obj.data.shape_keys.key_blocks["Basis"]
    for morph, moved in morphs.items():
        if obj.name not in moved:
            continue
        key = obj.shape_key_add(name=morph, from_mix=False)
        for i, d in enumerate(moved[obj.name]):
            key.data[i].co = basis.data[i].co + inv @ d


def ranges(indices) -> list[list[int]]:
    """Sorted indices as [first, last] runs, which is how covered skin is listed."""
    out = []
    for i in sorted(indices):
        if out and i == out[-1][1] + 1:
            out[-1][1] = i
        else:
            out.append([i, i])
    return out


def strip_helpers(base, items: dict) -> dict:
    """Delete the base mesh's helper geometry (everything outside its "body" group: the joint
    cubes, the clothes-fitting tights and skirt), keeping shape keys, and drop the masks that hid
    it. Returns {item id: covered skin as ranges of the remaining vertices}."""
    body = base.vertex_groups["body"].index
    groups = {g.name: g.index for g in base.vertex_groups}
    kept, covered = [], {item_id: [] for item_id in items}
    for v in base.data.vertices:
        weights = {g.group: g.weight for g in v.groups}
        if weights.get(body, 0) < 0.5:
            continue
        for item_id, obj in items.items():
            group = groups.get("Delete." + obj["asset"].replace(" ", "_"))
            if group is not None and weights.get(group, 0) >= 0.5:
                covered[item_id].append(len(kept))
        kept.append(v.index)
    # Each kept vertex's number among the kept, as a glTF attribute (_vid): the exporter splits
    # vertices along seams, and covered skin is listed by these numbers, not the file's.
    vid = base.data.attributes.new("_vid", "FLOAT", "POINT")
    rank = {v: n for n, v in enumerate(kept)}
    vid.data.foreach_set("value", [float(rank.get(i, -1)) for i in range(len(base.data.vertices))])
    bm = bmesh.new()
    bm.from_mesh(base.data)
    keep = set(kept)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
    bm.to_mesh(base.data)
    bm.free()
    for m in [m for m in base.modifiers if m.type in ("MASK", "SUBSURF")]:
        base.modifiers.remove(m)
    return {k: ranges(v) for k, v in covered.items() if v}


# ---- motion ---------------------------------------------------------------------------------

def retarget(source_arm, target_arm, clip: str, reference: str = "TPose") -> bpy.types.Action:
    """A Soldier clip on the MakeHuman skeleton. The two rest poses differ (Mixamo's T, MPFB's
    A), so each bone's turn is measured from the Soldier's TPose clip and applied to the target
    posed the same way: the target is first turned bone by bone to point where the Soldier's
    T-posed bone points, and every frame then turns each target bone by the same world rotation
    that took the Soldier's bone from its T-pose to that frame. The hips also travel, scaled by
    the ratio of the two hips' heights."""
    scene = bpy.context.scene
    src_actions = {a.name.split("|")[-1]: a for a in bpy.data.actions}
    names = [b.name for b in target_arm.data.bones if b.name in source_arm.pose.bones]
    order = [b.name for b in target_arm.data.bones if b.name in names]  # parents before children

    def world_pose(arm):
        return {n: arm.matrix_world @ arm.pose.bones[n].matrix for n in names}

    source_arm.animation_data_create()
    source_arm.animation_data.action = src_actions[reference]
    scene.frame_set(int(src_actions[reference].frame_range[0]))
    src_ref = world_pose(source_arm)
    # The target in the Soldier's T-pose: each bone swung (shortest arc) onto the Soldier's.
    for n in order:
        pb = target_arm.pose.bones[n]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    tgt_ref = {}
    for n in order:
        pb = target_arm.pose.bones[n]
        world = target_arm.matrix_world @ pb.matrix
        want = (src_ref[n].to_3x3() @ mathutils.Vector((0, 1, 0))).normalized()
        have = (world.to_3x3() @ mathutils.Vector((0, 1, 0))).normalized()
        swing = have.rotation_difference(want)
        new = mathutils.Matrix.LocRotScale(world.to_translation(), swing @ world.to_quaternion(), world.to_scale())
        pb.matrix = target_arm.matrix_world.inverted() @ new
        bpy.context.view_layer.update()
        tgt_ref[n] = target_arm.matrix_world @ pb.matrix
    hip = "mixamorig:Hips"
    ratio = tgt_ref[hip].to_translation().z / max(src_ref[hip].to_translation().z, 1e-6)
    action = bpy.data.actions.new("retargeted " + clip)
    target_arm.animation_data_create()
    target_arm.animation_data.action = action
    src = src_actions[clip]
    source_arm.animation_data.action = src
    start, end = (int(f) for f in src.frame_range)
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        now = world_pose(source_arm)
        for n in order:
            pb = target_arm.pose.bones[n]
            turn = now[n].to_quaternion() @ src_ref[n].to_quaternion().inverted()
            rot = turn @ tgt_ref[n].to_quaternion()
            loc = (target_arm.matrix_world @ pb.matrix).to_translation()
            if n == hip:
                travel = now[n].to_translation() - src_ref[n].to_translation()
                loc = tgt_ref[n].to_translation() + travel * ratio
            pb.matrix = target_arm.matrix_world.inverted() @ mathutils.Matrix.LocRotScale(loc, rot, None)
            bpy.context.view_layer.update()
            pb.keyframe_insert("rotation_quaternion", frame=frame - start)
            if n == hip:
                pb.keyframe_insert("location", frame=frame - start)
    for n in order:
        pb = target_arm.pose.bones[n]
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    return action


def import_soldier(path: Path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    # The Soldier faces +Y in Blender, a MakeHuman figure -Y: turned to face the same way, or
    # every world-space turn copied from it walks the figure backwards.
    arm.matrix_world = mathutils.Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
    for o in new:
        if o.type == "MESH":
            o.hide_set(True)
    return arm, new


# ---- textures and export --------------------------------------------------------------------

def shrink_images():
    for img in bpy.data.images:
        if img.size[0] > TEXTURE_PX or img.size[1] > TEXTURE_PX:
            scale = TEXTURE_PX / max(img.size)
            img.scale(max(1, int(img.size[0] * scale)), max(1, int(img.size[1] * scale)))


def export(objects, armature, path: Path, *, animations: bool):
    bpy.ops.object.select_all(action="DESELECT")
    for o in [*objects, armature]:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = armature
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_apply=False,
        export_skins=True, export_morph=True, export_morph_normal=False, export_animations=animations,
        export_attributes=True,
        export_animation_mode="ACTIONS", export_image_format="JPEG", export_jpeg_quality=82,
        export_yup=True, export_def_bones=True, export_tangents=False)


def build_body(sex: str, catalogue: dict, soldier: Path, out: Path) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    macro = TargetService.get_default_macro_info_dict()
    macro["gender"] = 1.0 if sex == "male" else 0.0
    base = HumanService.create_human(macro_detail_dict=macro, feet_on_ground=True, scale=0.1)
    base.name = f"body_{sex}"
    rig = HumanService.add_builtin_rig(base, "mixamo")
    skin = catalogue["skins"][sex][0]
    HumanService.set_character_skin(str(next((data_dir() / "skins" / skin).glob("*.mhmat"))), base,
                                    skin_type="GAMEENGINE", material_instances=False)
    items, entries = {}, {}
    for entry in catalogue["items"]:
        if sex not in entry.get("bodies", ["male", "female"]):
            continue
        obj = HumanService.add_mhclo_asset(str(mhclo(entry["folder"], entry["asset"])), base,
                                           asset_type=entry["mpfb_type"], subdiv_levels=0, material_type="GAMEENGINE")
        obj.name = entry["id"].replace("/", "__")
        for m in [m for m in obj.modifiers if m.type == "SUBSURF"]:
            obj.modifiers.remove(m)
        items[entry["id"]] = obj
        entries[entry["id"]] = entry
        print(f"{sex}: dressed in {entry['id']} ({len(obj.data.vertices)} vertices)", flush=True)
    morphs = record_morphs(base, list(items.values()))
    # The default shape becomes each object's basis, then the recorded ends go on as morphs.
    TargetService.bake_targets(base)
    for obj in items.values():
        if obj.data.shape_keys:
            obj.shape_key_clear()
    for obj in [base, *items.values()]:
        add_morphs(obj, morphs)
    covered = strip_helpers(base, entries)
    soldier_arm, soldier_objs = import_soldier(soldier)
    clips = [retarget(soldier_arm, rig, clip) for clip in SOLDIER_CLIPS]
    for clip in clips:
        clip.use_fake_user = True
        track = rig.animation_data.nla_tracks.new()
        track.strips.new(clip.name, 0, clip)
    rig.animation_data.action = None
    for o in soldier_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    for action in [a for a in bpy.data.actions if a not in clips]:
        bpy.data.actions.remove(action)
    for clip, name in zip(clips, SOLDIER_CLIPS, strict=True):
        clip.name = name
    for track in rig.animation_data.nla_tracks:
        for strip in track.strips:
            strip.name = strip.action.name
    shrink_images()
    folder = out / sex
    export([base], rig, folder / "body.glb", animations=True)
    parts = {}
    for item_id, obj in items.items():
        name = item_id.replace("/", "__") + ".glb"
        export([obj], rig, folder / name, animations=False)
        parts[item_id] = f"{sex}/{name}"
    return {"body": f"{sex}/body.glb", "items": parts, "covers": covered,
            "morphs": sorted({m for m, v in morphs.items() if v}), "height_m": round(max(
                (base.matrix_world @ mathutils.Vector(c)).z for c in base.bound_box), 3)}


def write_textures(catalogue: dict, out: Path) -> dict:
    """The skins and eye colours the page swaps in, as JPEGs: {"skins": {name: path}, "eyes": ...}."""
    def jpeg(src: Path, dest: Path) -> str:
        img = bpy.data.images.load(str(src))
        if max(img.size) > TEXTURE_PX:
            scale = TEXTURE_PX / max(img.size)
            img.scale(max(1, int(img.size[0] * scale)), max(1, int(img.size[1] * scale)))
        dest.parent.mkdir(parents=True, exist_ok=True)
        scene = bpy.context.scene
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = 85
        img.save_render(str(dest), scene=scene)
        bpy.data.images.remove(img)
        return str(dest.relative_to(out))
    skins = {}
    for name in sorted({n for names in catalogue["skins"].values() for n in names}):
        folder = data_dir() / "skins" / name
        src = next(p for p in folder.glob("*.png") if "diffuse" in p.name or "texture" in p.name.lower())
        skins[name] = jpeg(src, out / "skins" / f"{name}.jpg")
    eyes = {}
    for colour in catalogue["eye_colours"]:
        eyes[colour] = jpeg(data_dir() / "eyes" / "materials" / f"{colour}_eye.png", out / "eyes" / f"{colour}.jpg")
    return {"skins": skins, "eyes": eyes}


def published(catalogue: dict, built: dict, textures: dict) -> dict:
    """What the page reads (avatars/catalogue.json): each body, each part it can wear with its
    file and the skin it covers, the skins and eye colours, and the credits."""
    items = []
    for entry in catalogue["items"]:
        files = {sex: b["items"][entry["id"]] for sex, b in built.items() if entry["id"] in b["items"]}
        if not files:
            continue
        row = {k: entry[k] for k in ("id", "slot", "label") if k in entry} | {"files": files}
        covers = {sex: b["covers"][entry["id"]] for sex, b in built.items() if entry["id"] in b.get("covers", {})}
        for k in ("credit", "default"):
            if k in entry:
                row[k] = entry[k]
        if covers:
            row["covers"] = covers
        items.append(row)
    return {"version": catalogue["version"], "credit": catalogue["credit"],
            "bodies": {sex: {"file": b["body"], "morphs": b["morphs"]} for sex, b in built.items()},
            "skins": {sex: [n for n in names if n in textures["skins"]] for sex, names in catalogue["skins"].items()},
            "skin_files": textures["skins"], "eye_files": textures["eyes"], "items": items}


def main():
    a = args()
    catalogue = json.loads(a.catalogue.read_text())
    built = {}
    for sex in ([a.only] if a.only else ["male", "female"]):
        built[sex] = build_body(sex, catalogue, a.soldier, a.out)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    textures = write_textures(catalogue, a.out)
    (a.out / "catalogue.json").write_text(json.dumps(published(catalogue, built, textures), indent=1) + "\n")
    print("BUILT", ", ".join(f"{sex}: {len(b['items'])} parts, {len(b['morphs'])} morphs" for sex, b in built.items()))


if __name__ == "__main__":
    main()
