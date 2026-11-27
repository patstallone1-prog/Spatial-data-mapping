"""The living city's bought-in cars, first stage: Blender (run headless).

    blender -b --factory-startup -P scripts/blender_city_cars.py -- \
        --config scripts/city_cars.json --id <car> --src <downloaded model> --out <folder> [--textures <folder>]

Each car of ``scripts/city_cars.json`` is taken from its download (a .blend, .fbx, .obj or .glb),
cleared of what is not the car (a showroom floor, a stand, the engine nobody sees), turned to the
city's frame -- its front at -z once exported, right +x, its wheels on the ground -- and scaled to
the real car's length (the maker's figures; its width and height follow). Every face is put in
one of the parts the city draws a car with, by its object's and its material's names:

    body      the paint (the city paints each car its own colour);
    trim      black plastic, rubber seals, grilles: what is not paint and not one of the rest;
    metal     chrome, wheels' rims, brakes, badges;
    tyre      the tyres;
    interior  seats, dashboard, floor, steering wheel, door cards;
    lamp      head and tail lamps and their reflectors;
    glass     windows and lamp covers (drawn see-through).

and written three times (the full one decimated here to its ``budgets``; the coarse two cleared of
loose bits and flat detail here, and simplified to theirs by the next stage):

    <id>-full.glb  the one you drive or ride: everything, the inside included;
    <id>-npc.glb   the traffic nearest you: the seats behind the glass, the rest coarser;
    <id>-mid.glb   the traffic further off (the tier the code-built bodies drew): the shell only
                   -- body, one trim part (tyres, metal and lamps with it) and glass.

Each part's materials are kept (their colours and pictures): scripts/build_city_cars.mjs bakes them
into one colour per vertex and compresses the files for the web.
"""

import json
import math
import re
import sys

import bmesh
import bpy
import mathutils

argv = sys.argv[sys.argv.index("--") + 1 :]
args = {argv[i][2:]: argv[i + 1] for i in range(0, len(argv) - 1, 2) if argv[i].startswith("--")}
with open(args["config"]) as config_file:
    CONFIG = json.load(config_file)
CAR = CONFIG["cars"][args["id"]]
CLASSES = ["glass", "lamp", "tyre", "interior", "metal", "body", "trim"]

# ---- load --------------------------------------------------------------------------------------
src = args["src"]
ext = src.rsplit(".", 1)[-1].lower()
if ext == "blend":
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=src)
    elif ext in ("glb", "gltf"):
        bpy.ops.import_scene.gltf(filepath=src)
    elif ext == "obj":
        bpy.ops.wm.obj_import(filepath=src)
if args.get("textures"):
    try:
        bpy.ops.file.find_missing_files(directory=args["textures"])
    except RuntimeError as error:  # (nothing missing)
        print("textures:", error)
scene = bpy.context.scene
for o in list(scene.objects):
    keep = o.type == "MESH" and not o.hide_render and o.visible_get()
    if not keep or re.search(CAR.get("drop_objects", "^$"), o.name, re.I):
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in scene.objects if o.type == "MESH"]
# Modifiers (a mirror, a subdivision) applied, then every object's own transform, so the
# coordinates below are the world's. (Done to each mesh's own data, not by selecting: a download
# whose pieces cannot be selected -- the Movano's doors -- kept their centimetres and their
# parent's turn, and the van came out fifteen metres tall.)
# (Only what has modifiers is converted: converting the Movano's pieces lost their parent's
# turn and scale.)
world = {o.name: o.matrix_world.copy() for o in meshes}
modified = [o for o in meshes if o.modifiers]
if modified:
    for o in scene.objects:
        o.hide_select = False
    bpy.ops.object.select_all(action="DESELECT")
    for o in modified:
        o.select_set(True)
    bpy.context.view_layer.objects.active = modified[0]
    bpy.ops.object.convert(target="MESH")
    meshes = [o for o in scene.objects if o.type == "MESH"]
    for o in meshes:
        world.setdefault(o.name, o.matrix_world.copy())
for o in meshes:
    o.data = o.data.copy()  # (instanced data: each object its own, so its transform can be applied)
    m = world[o.name]
    o.parent = None
    o.data.transform(m)
    if m.determinant() < 0:
        o.data.flip_normals()
    o.matrix_world = mathutils.Matrix.Identity(4)

# ---- doors modelled open, swung shut ------------------------------------------------------------------
# A van sold with its back doors swung right round (``open_doors``: each a box, in the download's
# own frame, round the open door's pieces -- each object whose middle is in it -- and the angle it
# stands open): turned back about its hinge, which is half way out to the open door's outer edge
# (the doors meet in the middle), on the line between the door's front and back.
for fold in CAR.get("open_doors", []):
    x0, y0, x1, y1 = fold["box"]
    group = []
    for o in meshes:
        n = len(o.data.vertices)
        if not n:
            continue
        c = sum((v.co for v in o.data.vertices), mathutils.Vector()) / n
        if x0 <= c.x <= x1 and y0 <= c.y <= y1:
            group.append(o)
    if not group:
        print("open_doors: nothing in", fold["box"])
        continue
    xs = [v.co.x for o in group for v in o.data.vertices]
    ys = [v.co.y for o in group for v in o.data.vertices]
    px, py = max(xs, key=abs) / 2, (min(ys) + max(ys)) / 2
    shut = (mathutils.Matrix.Translation((px, py, 0)) @ mathutils.Matrix.Rotation(math.radians(fold.get("deg", 180)), 4, "Z")
            @ mathutils.Matrix.Translation((-px, -py, 0)))
    for o in group:
        o.data.transform(shut)
    print("open_doors:", len(group), "pieces shut about", round(px, 3), round(py, 3))


# ---- one object per part -------------------------------------------------------------------------
def part_of(obj_name, mat_name):
    """The part a face is drawn in: the config's rules first (``parts``, tried in order), then the
    common words, else trim."""
    label = f"{obj_name}|{mat_name}".lower()
    for part, pattern in CAR.get("parts", []):
        if re.search(pattern, label, re.I):
            return part
    for part, pattern in CONFIG["common_parts"]:
        if re.search(pattern, label, re.I):
            return part
    return "trim"


drop_mat = re.compile(CAR.get("drop_materials", "^$"), re.I)
pieces = {c: [] for c in CLASSES}
for o in meshes:
    me = o.data
    names = [m.name if m else "" for m in me.materials] or [""]
    by_part = {}
    for poly in me.polygons:
        mat = names[poly.material_index] if poly.material_index < len(names) else ""
        part = "drop" if drop_mat.search(mat) else part_of(o.name, mat)
        by_part.setdefault(part, []).append(poly.index)
    for part, faces in by_part.items():
        if part == "drop":
            continue
        copy = o.copy()
        copy.data = me.copy()
        scene.collection.objects.link(copy)
        keep = set(faces)
        bm = bmesh.new()
        bm.from_mesh(copy.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
        bm.to_mesh(copy.data)
        bm.free()
        pieces[part].append(copy)
    bpy.data.objects.remove(o, do_unlink=True)

parts = {}
for part, objs in pieces.items():
    objs = [o for o in objs if len(o.data.polygons)]
    if not objs:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = part
    parts[part] = joined

# ---- the city's frame: front +Y in Blender (-z once exported), right +X, wheels on z = 0 ------------
everything = list(parts.values())
rot = CAR.get("rotate_deg", [0, 0, 0])
R = mathutils.Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()


def bounds(objs, matrix=None):
    matrix = matrix or mathutils.Matrix.Identity(4)
    lo = mathutils.Vector((1e18,) * 3)
    hi = -lo
    for o in objs:
        for v in o.data.vertices:
            w = matrix @ v.co
            lo = mathutils.Vector(map(min, lo, w))
            hi = mathutils.Vector(map(max, hi, w))
    return lo, hi


for o in everything:
    o.data.transform(R)
lo, hi = bounds(everything)
size = hi - lo
# The long horizontal axis is its length; it is turned onto Y, its front (the config's ``front``
# objects, or the config's word) to +Y.
if size.x > size.y:
    for o in everything:
        o.data.transform(mathutils.Matrix.Rotation(math.radians(90), 4, "Z"))
    lo, hi = bounds(everything)
front = CAR.get("front", "+y")
if front == "-y":
    for o in everything:
        o.data.transform(mathutils.Matrix.Rotation(math.radians(180), 4, "Z"))
lo, hi = bounds(everything)
L, W, H = CAR["dims"][2], CAR["dims"][0], CAR["dims"][1]
scale = L / (hi.y - lo.y)
centre = mathutils.Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
M = mathutils.Matrix.Scale(scale, 4) @ mathutils.Matrix.Translation(-centre)
for o in everything:
    o.data.transform(M)
lo, hi = bounds(everything)


# ---- a model sold with one wheel: the other three copied from it -------------------------------------
def islands(bm):
    """The mesh's connected pieces, each a list of faces."""
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, piece = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            piece.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        out.append(piece)
    return out


if CAR.get("one_wheel"):
    # The tyre is the biggest wheel-sized piece standing on the ground; the wheel is it and every
    # piece inside its box (the rim, the disc and calliper). The three others are it mirrored
    # across the car and moved the wheelbase (the maker's) to the other axle.
    import bmesh

    base = CAR["one_wheel"]["wheelbase_m"]  # (the car is in metres by now)
    meshes_of = {}
    pieces_of = {}
    tyre = None
    for part, o in parts.items():
        if part in ("body", "glass", "interior", "lamp"):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        meshes_of[part] = bm
        pieces_of[part] = []
        for piece in islands(bm):
            vs = {v for f in piece for v in f.verts}
            box = [
                min(v.co.x for v in vs),
                max(v.co.x for v in vs),
                min(v.co.y for v in vs),
                max(v.co.y for v in vs),
                min(v.co.z for v in vs),
                max(v.co.z for v in vs),
            ]
            pieces_of[part].append((piece, box))
            dx, dy, dz = box[1] - box[0], box[3] - box[2], box[5] - box[4]
            if (
                box[4] - lo.z < 0.08
                and 0.5 < dy < 0.85
                and 0.5 < dz < 0.85
                and dx < 0.4
                and (tyre is None or len(piece) > tyre[0])
            ):
                tyre = (len(piece), box)
    assert tyre, "one_wheel: no tyre found"
    t = tyre[1]
    side = 1 if (t[2] + t[3]) / 2 > 0 else -1

    def inside(b):
        return all(b[i] >= t[i] - 0.03 for i in (0, 2, 4)) and all(
            b[i] <= t[i] + 0.03 for i in (1, 3, 5)
        )

    for part, bm in meshes_of.items():
        wheel = [f for piece, box in pieces_of[part] if inside(box) for f in piece]
        if wheel:
            for mx, dy in ((-1, 0), (1, -side * base), (-1, -side * base)):
                made = bmesh.ops.duplicate(bm, geom=wheel)["geom"]
                for v in (g for g in made if isinstance(g, bmesh.types.BMVert)):
                    v.co.x *= mx
                    v.co.y += dy
                if mx < 0:
                    bmesh.ops.reverse_faces(
                        bm, faces=[g for g in made if isinstance(g, bmesh.types.BMFace)]
                    )
            print(
                "one_wheel:",
                part,
                len(wheel),
                "faces copied three times; tyre box",
                [round(x, 2) for x in t],
            )
        bm.to_mesh(parts[part].data)
        bm.free()
    lo, hi = bounds(everything)
measured = [round(hi.x - lo.x, 3), round(hi.z - lo.z, 3), round(hi.y - lo.y, 3)]
report = {
    "id": args["id"],
    "measured_w_h_l": measured,
    "maker_w_h_l": CAR["dims"],
    "scale": scale,
    "source_triangles": {},
    "lods": {},
}
for part, o in parts.items():
    o.data.calc_loop_triangles()
    report["source_triangles"][part] = len(o.data.loop_triangles)


# ---- the three files ---------------------------------------------------------------------------------
def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


MID_MERGE = {"tyre": "trim", "metal": "trim", "lamp": "trim", "interior": None}
NPC_MERGE = {"interior": "trim", "lamp": "trim"}
out = args["out"].rstrip("/")
for lod in ("full", "npc", "mid"):
    budget = CONFIG["budgets"][lod]
    merge = {"full": {}, "npc": NPC_MERGE, "mid": MID_MERGE}[lod]
    made = {}
    for part, src_obj in parts.items():
        target = merge.get(part, part)
        if target is None:
            continue
        o = src_obj.copy()
        o.data = src_obj.data.copy()
        scene.collection.objects.link(o)
        want = budget.get(part, budget.get("trim"))
        have = tris(o)
        if have > want:
            # Seams welded first (a panel's UV seams and split normals leave it in strips that
            # collapse apart), then collapsed; a planar pass before it for the coarse files.
            import bmesh

            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=CONFIG.get("weld_m", 0.002))
            bm.to_mesh(o.data)
            bm.free()
            have = tris(o)
        # What a coarse file cannot show is left out before it is simplified: the loose bits
        # smaller than ``islands_m`` (bolts, clips, a switch), which the collapse below would
        # otherwise stretch into slivers to keep. In the full file only a car's own
        # ``full_islands_m`` for a part (the Movano's tyre tread, thousands of separate blocks no
        # collapse can merge: 36,000 triangles left of a 6,000 budget).
        smallest = CONFIG["islands_m"][lod] if lod != "full" else CAR.get("full_islands_m", {}).get(part)
        if smallest:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bm.faces.ensure_lookup_table()
            seen, doomed = set(), []
            for f in bm.faces:
                if f.index in seen:
                    continue
                island, stack = [], [f]
                seen.add(f.index)
                while stack:
                    g = stack.pop()
                    island.append(g)
                    for e in g.edges:
                        for h in e.link_faces:
                            if h.index not in seen:
                                seen.add(h.index)
                                stack.append(h)
                pts = [v.co for g in island for v in g.verts]
                lo_i = mathutils.Vector(map(min, *pts)) if len(pts) > 1 else pts[0]
                hi_i = mathutils.Vector(map(max, *pts)) if len(pts) > 1 else pts[0]
                if (hi_i - lo_i).length < smallest:
                    doomed.extend(island)
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bm.to_mesh(o.data)
            bm.free()
            have = tris(o)
        if have > want and lod != "full":
            mod = o.modifiers.new("planar", "DECIMATE")
            mod.decimate_type = "DISSOLVE"
            mod.angle_limit = math.radians(2.5)
            mod.use_dissolve_boundaries = False
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)
            have = tris(o)
        # The coarse files are simplified by scripts/build_city_cars.mjs (meshoptimizer's
        # error-bounded collapse: Blender's, pressed to a few thousand triangles, tore the bodies
        # into shards); only the full one is collapsed here.
        # (Again while it is still well over: one collapse stopped at 36,000 of the Movano's tyres'
        # 199,000 triangles, against a budget of 6,000.)
        passes = 0
        while have > want * (1.3 if passes else 1) and lod == "full" and passes < 4:
            passes += 1
            before = have
            mod = o.modifiers.new("decimate", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = max(0.0005, want / have)
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)
            have = tris(o)
            if have > before * 0.9:
                # (A collapse that will not go further -- a subdivided tyre's quads -- is undone a
                # level of subdivision at a time instead, then collapsed again.)
                mod = o.modifiers.new("unsubdivide", "DECIMATE")
                mod.decimate_type = "UNSUBDIV"
                mod.iterations = 2
                bpy.ops.object.modifier_apply(modifier=mod.name)
                have = tris(o)
        if passes:
            # A collapsed vertex can be put far outside the car (the Sonata's trim had one a metre
            # under the road): any face reaching out of the car's own box is taken out.
            bm = bmesh.new()
            bm.from_mesh(o.data)
            out_of_car = [
                f
                for f in bm.faces
                if any(
                    not all(lo[a] - 0.05 <= v.co[a] <= hi[a] + 0.05 for a in range(3))
                    for v in f.verts
                )
            ]
            bmesh.ops.delete(bm, geom=out_of_car, context="FACES")
            bm.to_mesh(o.data)
            bm.free()
        if lod != "full" and len(o.data.polygons):
            # A collapse can leave a sliver: a triangle a hand's width wide and a metre long,
            # standing out of the roof. Any so thin is taken out.
            bm = bmesh.new()
            bm.from_mesh(o.data)
            thin = []
            for f in bm.faces:
                longest = max(e.calc_length() for e in f.edges)
                if longest > 0.25 and f.calc_area() < 0.015 * longest * longest:
                    thin.append(f)
            bmesh.ops.delete(bm, geom=thin, context="FACES")
            bm.to_mesh(o.data)
            bm.free()
        made.setdefault(target, []).append(o)
    final = {}
    for target, objs in made.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = f"{lod}:{target}"
        final[target] = j
    report["lods"][lod] = {p: tris(o) for p, o in final.items()}
    bpy.ops.object.select_all(action="DESELECT")
    for o in final.values():
        o.select_set(True)
    for o in parts.values():
        o.hide_set(True)
    path = f"{out}/{args['id']}-{lod}.raw.glb"
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
    )
    for o in final.values():
        bpy.data.objects.remove(o, do_unlink=True)
    for o in parts.values():
        o.hide_set(False)
print("REPORT " + json.dumps(report))
