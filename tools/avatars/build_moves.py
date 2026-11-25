"""Motion-captured moves for the game's people, from Quaternius's Universal Animation Library
(1 and 2, CC0), retargeted onto the game's own skeletons. Run inside Blender (no add-ons needed):

    ~/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/avatars/build_moves.py -- \
        --ual1 AnimationLibrary_Godot_Standard.glb --ual2 UAL2_Standard.glb \
        --target male=crowd/male.glb --target female=crowd/female.glb --target soldier=Soldier.glb \
        --out docs/city/models/moves

The libraries' clips are keyed on two rigs: UAL 1's is a Rigify deform rig (``DEF-*``), UAL 2's
the Unreal mannequin's names. Both are renamed to Mixamo's, which the MakeHuman bodies (crowd
and avatar creator, the same skeleton per body) and the three.js Soldier use. Each clip is then
retargeted the way the avatar creator retargets the Soldier's walk (build_makehuman_avatars.py
retarget): every target bone is first swung to point where the source's bone points in the
library's T-pose, and every frame each bone is turned by the same world rotation that took the
source's bone from that T-pose to the frame. The hips travel, scaled by the two hips' heights.

Out comes one GLB per target: the skeleton, one triangle skinned to it (so the exporter keeps
the joints) and the clips, named as in MOVES. Nothing else is in it; the page binds the clips to
the figure it already has by bone name.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bmesh
import bpy
import mathutils

#: Rigify deform bones (UAL 1) and Unreal mannequin bones (UAL 2) as Mixamo's.
UAL1_TO_MIXAMO = {
    "DEF-hips": "Hips", "DEF-spine.001": "Spine", "DEF-spine.002": "Spine1", "DEF-spine.003": "Spine2",
    "DEF-neck": "Neck", "DEF-head": "Head",
}
UAL2_TO_MIXAMO = {
    "pelvis": "Hips", "spine_01": "Spine", "spine_02": "Spine1", "spine_03": "Spine2",
    "neck_01": "Neck", "Head": "Head",
}
for side, S, s in (("L", "Left", "l"), ("R", "Right", "r")):
    UAL1_TO_MIXAMO.update({
        f"DEF-shoulder.{side}": f"{S}Shoulder", f"DEF-upper_arm.{side}": f"{S}Arm",
        f"DEF-forearm.{side}": f"{S}ForeArm", f"DEF-hand.{side}": f"{S}Hand",
        f"DEF-thigh.{side}": f"{S}UpLeg", f"DEF-shin.{side}": f"{S}Leg",
        f"DEF-foot.{side}": f"{S}Foot", f"DEF-toe.{side}": f"{S}ToeBase",
    })
    UAL2_TO_MIXAMO.update({
        f"clavicle_{s}": f"{S}Shoulder", f"upperarm_{s}": f"{S}Arm", f"lowerarm_{s}": f"{S}ForeArm",
        f"hand_{s}": f"{S}Hand", f"thigh_{s}": f"{S}UpLeg", f"calf_{s}": f"{S}Leg",
        f"foot_{s}": f"{S}Foot", f"ball_{s}": f"{S}ToeBase",
    })
    for finger, mix in (("index", "Index"), ("middle", "Middle"), ("ring", "Ring"), ("pinky", "Pinky"), ("thumb", "Thumb")):
        rig1 = "thumb" if finger == "thumb" else f"f_{finger}"
        for k in (1, 2, 3):
            UAL1_TO_MIXAMO[f"DEF-{rig1}.0{k}.{side}"] = f"{S}Hand{mix}{k}"
            UAL2_TO_MIXAMO[f"{finger}_0{k}_{s}"] = f"{S}Hand{mix}{k}"

#: The moves taken, by the name the game plays them under: (library, clip, loops).
MOVES = {
    # Fists: a guard, a jab, a cross and a hook with its recovery.
    "PunchGuard": ("ual1", "Punch_Enter", False),
    "PunchJab": ("ual1", "Punch_Jab", False),
    "PunchCross": ("ual1", "Punch_Cross", False),
    "PunchHook": ("ual2", "Melee_Hook", False),
    "PunchHookRec": ("ual2", "Melee_Hook_Rec", False),
    # What is held, swung or thrown.
    "SwingA": ("ual2", "Sword_Regular_A", False),
    "SwingB": ("ual2", "Sword_Regular_B", False),
    "Chop": ("ual2", "TreeChopping_Loop", True),
    "Throw": ("ual2", "OverhandThrow", False),
    # Being hit, going down and getting up.
    "HitChest": ("ual1", "Hit_Chest", False),
    "HitHead": ("ual1", "Hit_Head", False),
    "Knockback": ("ual2", "Hit_Knockback", False),
    "Fall": ("ual1", "Death01", False),
    "GetUp": ("ual2", "LayToIdle", False),
    # Sitting, a car's seat, getting in.
    "SitDown": ("ual1", "Sitting_Enter", False),
    "Sit": ("ual1", "Sitting_Idle_Loop", True),
    "SitTalk": ("ual1", "Sitting_Talking_Loop", True),
    "StandUp": ("ual1", "Sitting_Exit", False),
    "Drive": ("ual1", "Driving_Loop", True),
    # Standing about.
    "Talk": ("ual1", "Idle_Talking_Loop", True),
    "Phone": ("ual2", "Idle_TalkingPhone_Loop", True),
    "FoldArms": ("ual2", "Idle_FoldArms_Loop", True),
    "No": ("ual2", "Idle_No_Loop", True),
    "Yes": ("ual2", "Yes", False),
    "Call": ("ual2", "Idle_Rail_Call", False),
    "Crouch": ("ual1", "Crouch_Idle_Loop", True),
    "CrouchWalk": ("ual1", "Crouch_Fwd_Loop", True),
    # Hands at work.
    "Interact": ("ual1", "Interact", False),
    "PickUp": ("ual1", "PickUp_Table", False),
    "Push": ("ual1", "Push_Loop", True),
    "Kneel": ("ual1", "Fixing_Kneeling", True),
    "Consume": ("ual2", "Consume", False),
    "OpenChest": ("ual2", "Chest_Open", False),
    "WalkCarry": ("ual2", "Walk_Carry_Loop", True),
    # On the move.
    "JumpStart": ("ual1", "Jump_Start", False),
    "JumpAir": ("ual1", "Jump_Loop", True),
    "JumpLand": ("ual1", "Jump_Land", False),
    "Jog": ("ual1", "Jog_Fwd_Loop", True),
    "Sprint": ("ual1", "Sprint_Loop", True),
    "Swim": ("ual1", "Swim_Fwd_Loop", True),
    "Tread": ("ual1", "Swim_Idle_Loop", True),
    "Aim": ("ual1", "Pistol_Aim_Neutral", True),
}
REFERENCE = "A_TPose"


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--ual1", type=Path, required=True)
    p.add_argument("--ual2", type=Path, required=True)
    p.add_argument("--target", action="append", required=True, help="name=path.glb")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--only", nargs="*", default=None, help="move names")
    return p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def clip_name(action) -> str:
    """An imported action's clip name: Blender prefixes the object and suffixes a clash (.001)."""
    return re.sub(r"\.\d{3}$", "", action.name.split("|")[-1])


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: Path):
    before, acts = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    return arm, new, [a for a in bpy.data.actions if a not in acts]


def forward(arm, prefix="mixamorig:"):
    """Which way the figure faces (world, on the ground): from the heel toward the toes."""
    pb = arm.pose.bones
    foot, toe = pb[f"{prefix}LeftFoot"], pb[f"{prefix}LeftToeBase"]
    v = (arm.matrix_world @ toe.tail) - (arm.matrix_world @ foot.head)
    v.z = 0
    return v.normalized()


def source(path: Path, mapping: dict, facing: mathutils.Vector):
    arm, objs, actions = import_glb(path)
    for o in objs:
        if o.type == "MESH":
            o.hide_set(True)
    for b in arm.data.bones:
        if b.name in mapping:
            b.name = "mixamorig:" + mapping[b.name]
    arm.animation_data_create()
    ref = next(a for a in actions if clip_name(a) == REFERENCE)
    arm.animation_data.action = ref
    bpy.context.scene.frame_set(int(ref.frame_range[0]))
    bpy.context.view_layer.update()
    if forward(arm).dot(facing) < 0:
        arm.matrix_world = mathutils.Matrix.Rotation(math.pi, 4, "Z") @ arm.matrix_world
        bpy.context.view_layer.update()
    return arm, {clip_name(a): a for a in actions}


def retarget(src, src_actions, tgt, clip: str, name: str, reach: dict | None = None) -> bpy.types.Action:
    """(``reach``, if given, is filled with where each hand reaches furthest ahead of the hips:
    {"hand": "left"|"right", "at_s": seconds, "ahead_m": metres, "up_m": height over the hips} --
    the moment a punch or a reach lands.)"""
    scene = bpy.context.scene
    names = [b.name for b in tgt.data.bones if b.name in src.pose.bones]
    order = names  # data.bones lists parents before children

    def world_pose(arm):
        return {n: arm.matrix_world @ arm.pose.bones[n].matrix for n in names}

    src.animation_data.action = src_actions[REFERENCE]
    scene.frame_set(int(src_actions[REFERENCE].frame_range[0]))
    bpy.context.view_layer.update()
    src_ref = world_pose(src)
    for n in order:
        pb = tgt.pose.bones[n]
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    tgt_ref = {}
    for n in order:
        pb = tgt.pose.bones[n]
        world = tgt.matrix_world @ pb.matrix
        want = (src_ref[n].to_3x3() @ mathutils.Vector((0, 1, 0))).normalized()
        have = (world.to_3x3() @ mathutils.Vector((0, 1, 0))).normalized()
        swing = have.rotation_difference(want)
        new = mathutils.Matrix.LocRotScale(world.to_translation(), swing @ world.to_quaternion(), world.to_scale())
        pb.matrix = tgt.matrix_world.inverted() @ new
        bpy.context.view_layer.update()
        tgt_ref[n] = tgt.matrix_world @ pb.matrix
    hip = "mixamorig:Hips"
    ratio = tgt_ref[hip].to_translation().z / max(src_ref[hip].to_translation().z, 1e-6)
    action = bpy.data.actions.new(f"move {name}")   # (named once the library's own are gone: they clash)
    tgt.animation_data_create()
    tgt.animation_data.action = action
    act = src_actions[clip]
    src.animation_data.action = act
    start, end = (int(f) for f in act.frame_range)
    facing = forward(tgt)
    fps = scene.render.fps / scene.render.fps_base
    best = None
    for frame in range(start, end + 1):
        scene.frame_set(frame)
        now = world_pose(src)
        for n in order:
            pb = tgt.pose.bones[n]
            turn = now[n].to_quaternion() @ src_ref[n].to_quaternion().inverted()
            rot = turn @ tgt_ref[n].to_quaternion()
            loc = (tgt.matrix_world @ pb.matrix).to_translation()
            if n == hip:
                loc = tgt_ref[n].to_translation() + (now[n].to_translation() - src_ref[n].to_translation()) * ratio
            pb.matrix = tgt.matrix_world.inverted() @ mathutils.Matrix.LocRotScale(loc, rot, None)
            bpy.context.view_layer.update()
            pb.keyframe_insert("rotation_quaternion", frame=frame - start)
            if n == hip:
                pb.keyframe_insert("location", frame=frame - start)
        if reach is not None:
            hips = tgt.matrix_world @ tgt.pose.bones[hip].head
            for side in ("Left", "Right"):
                h = tgt.matrix_world @ tgt.pose.bones[f"mixamorig:{side}Hand"].head
                ahead = (h - hips).dot(facing)
                if best is None or ahead > best[2]:
                    best = (side.lower(), (frame - start) / fps, ahead, h.z - hips.z)
    for n in order:
        pb = tgt.pose.bones[n]
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    if reach is not None and best:
        # (A rig in centimetres -- the Soldier, scaled 0.01 above its bones -- is measured in its own
        # units: put in metres by that scale.)
        scale = tgt.matrix_world.to_scale().z or 1
        unit = scale if abs(scale - 1) > 1e-3 else 1
        reach.update({"hand": best[0], "at_s": round(best[1], 3), "ahead_m": round(best[2] * unit, 3), "up_m": round(best[3] * unit, 3)})
    return action


def strip_to_one_triangle(objs, arm):
    """Every mesh but one gone, and that one cut to a single triangle: the exporter keeps the
    joints of a skinned mesh; the page needs only the bones and the clips."""
    meshes = [o for o in objs if o.type == "MESH"]
    keep = max(meshes, key=lambda o: len(o.data.vertices))
    for o in meshes:
        if o is not keep:
            bpy.data.objects.remove(o, do_unlink=True)
    bm = bmesh.new()
    bm.from_mesh(keep.data)
    bm.faces.ensure_lookup_table()
    first = bm.faces[0]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f is not first], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(keep.data)
    bm.free()
    keep.data.materials.clear()
    keep.data.shape_keys and keep.shape_key_clear()
    return keep


def build(target_name: str, target: Path, ual1: Path, ual2: Path, out: Path, only=None) -> dict:
    clear()
    tgt, objs, old = import_glb(target)
    for a in old:
        bpy.data.actions.remove(a)
    strip_to_one_triangle(objs, tgt)
    facing = forward(tgt)
    sources = {"ual1": source(ual1, UAL1_TO_MIXAMO, facing), "ual2": source(ual2, UAL2_TO_MIXAMO, facing)}
    made, report = [], {}
    for name, (lib, clip, loops) in MOVES.items():
        if only and name not in only:
            continue
        src, acts = sources[lib]
        reach = {}
        action = retarget(src, acts, tgt, clip, name, reach)
        made.append(action)
        start, end = action.frame_range
        fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
        report[name] = {"from": f"{lib}:{clip}", "loops": loops, "frames": int(end - start + 1),
                        "duration_s": round((end - start) / fps, 3), "reach": reach}
    tgt.animation_data.action = None
    for action in made:
        tgt.animation_data.nla_tracks.new().strips.new(action.name, 0, action)
    for lib in sources.values():
        src = lib[0]
        for o in [o for o in bpy.data.objects if o.parent is src or o is src]:
            bpy.data.objects.remove(o, do_unlink=True)
    for a in [a for a in bpy.data.actions if a not in made]:
        bpy.data.actions.remove(a)
    for a in made:
        a.name = a.name.removeprefix("move ")
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{target_name}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_animations=True,
                              export_animation_mode="ACTIONS", export_force_sampling=True,
                              export_materials="NONE", export_morph=False, export_def_bones=False)
    return {"file": path.name, "bytes": path.stat().st_size, "moves": report}


def main():
    a = args()
    manifest = {"schema": "kerbside.moves/1", "source": "Quaternius Universal Animation Library 1 and 2 [Standard], CC0 1.0",
                "reference": REFERENCE, "targets": {}}
    for spec in a.target:
        name, path = spec.split("=", 1)
        manifest["targets"][name] = build(name, Path(path), a.ual1, a.ual2, a.out, a.only)
    (a.out / "moves.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(json.dumps({k: v["bytes"] for k, v in manifest["targets"].items()}))


if __name__ == "__main__":
    main()
