"""Builds docs/city/models/birds/<species>.glb from the Poly by Google birds (CC-BY 3.0).

Each file: ``stand`` (origin at the feet), ``stand_low``; ``fly`` (body, origin at its centre),
``fly_wing_l`` / ``fly_wing_r`` (origin at the shoulder hinge, wing levelled), ``fly_low``.
Metres, glTF axes: head toward -z, up +y. One material, colour per face in COLOR_0.

Sources (poly.pizza, docs/city/models/birds/birds.json): Seagull 0WRzrtCIIRp, Flying seagull
6Tpj_vcWP3f, Dove 2jmH3trzPFf, Crow 1MIvWQ5Q3R9, Sparrow 3rTjKefT184 (Poly by Google), Flying
Raven p4puYPVor6 (Google Data Arts Team). Saved as <raw>/<name>.glb with the names in YAW.

Run (Blender 4.5, headless, from outside the download folder):
  Blender -b --disable-autoexec --factory-startup -P tools/blender/build_city_birds.py -- <raw> docs/city/models/birds
"""
import bpy, bmesh, sys, os, math, hashlib, json, mathutils
from mathutils import Vector, Matrix

# ---- import, colour, weld -------------------------------------------------------------------

def load(path, yaw_deg):
    """Import a glTF as one mesh object, transforms applied, head toward +Y (glTF -Z), up +Z."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    o = objs[0]
    bpy.ops.object.select_all(action='DESELECT')
    for x in objs: x.select_set(True)
    bpy.context.view_layer.objects.active = o
    if len(objs) > 1: bpy.ops.object.join()
    o.parent = None
    if o.data.shape_keys: o.shape_key_clear()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bake_colours(o)
    o.data.transform(Matrix.Rotation(math.radians(yaw_deg), 4, 'Z'))
    weld(o)
    return o

def bake_colours(o):
    """Texture (or vertex colour) -> one colour per face corner, sampled at the face's mean UV."""
    me = o.data
    col = me.color_attributes.get("Col") or None
    src_vc = me.color_attributes[0] if me.color_attributes else None
    img = None
    for m in me.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image: img = n.image
    face_rgb = []
    if img:
        w, h = img.size; px = img.pixels[:]
        uv = me.uv_layers.active.data
        for p in me.polygons:
            u = sum(uv[i].uv[0] for i in p.loop_indices) / p.loop_total
            v = sum(uv[i].uv[1] for i in p.loop_indices) / p.loop_total
            x = min(w - 1, max(0, int((u % 1.0) * w))); y = min(h - 1, max(0, int((v % 1.0) * h)))
            k = (y * w + x) * 4
            c = px[k:k + 3]
            if img.colorspace_settings.name == 'sRGB': c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
            face_rgb.append(tuple(c))
    elif src_vc:
        for p in me.polygons:
            c = [0, 0, 0]
            for i in p.loop_indices:
                d = src_vc.data[i if src_vc.domain == 'CORNER' else me.loops[i].vertex_index].color
                for j in range(3): c[j] += d[j]
            face_rgb.append(tuple(x / p.loop_total for x in c))
    else:
        face_rgb = [(0.8, 0.8, 0.8)] * len(me.polygons)
    for a in list(me.color_attributes): me.color_attributes.remove(a)
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    paint(o, face_rgb)

def paint(o, face_rgb):
    """Set one linear RGB colour per face (list indexed by polygon)."""
    me = o.data
    a = me.color_attributes.get("Col") or me.color_attributes.new("Col", 'FLOAT_COLOR', 'CORNER')
    for p, c in zip(me.polygons, face_rgb):
        for i in p.loop_indices: a.data[i].color = (c[0], c[1], c[2], 1.0)
    me.color_attributes.active_color = a

def face_colours(o):
    me = o.data; a = me.color_attributes["Col"]
    return [tuple(a.data[p.loop_indices[0]].color[:3]) for p in me.polygons]

def weld(o, d=1e-4):
    me = o.data; bm = bmesh.new(); bm.from_mesh(me)
    span = max((Vector(v.co) for v in bm.verts), key=lambda v: v.length).length
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=d * span)
    bm.to_mesh(me); bm.free()

def bounds(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)]); hi = Vector([max(v[i] for v in vs) for i in range(3)])
    return lo, hi

def hexlin(h):
    """sRGB hex -> linear RGB tuple."""
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

def lin2hex(c):
    s = [x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055 for x in c]
    return "#%02x%02x%02x" % tuple(int(max(0, min(1, x)) * 255) for x in s)


args = sys.argv[sys.argv.index("--") + 1:]
RAW, OUT = args[0], args[1]
SPECIES = {  # length beak-tail, span (m) -- animals.mjs SPECIES
    "pigeon": dict(length=0.32, span=0.62, stand="dove_stand", fly="gull_fly"),
    "gull": dict(length=0.60, span=1.35, stand="gull_stand", fly="gull_fly"),
    "crow": dict(length=0.45, span=0.90, stand="crow_stand", fly="raven_fly"),
    "sparrow": dict(length=0.15, span=0.22, stand="sparrow_stand", fly="raven_fly"),
}
YAW = {"crow_stand": 180, "dove_stand": 180, "gull_stand": 180, "sparrow_stand": 180, "gull_fly": 90, "raven_fly": 180}
SHOULDER = {"gull_fly": 0.075, "raven_fly": 0.10}   # wing root, x as a share of length
NEAR_KEEP = {"stand": 0.7, "fly": 0.85}               # share of faces kept in the near tier
LOW_FACES = 90

def H(h): return hexlin(h)
def mix(a, b, t): return tuple(x + (y - x) * t for x, y in zip(a, b))
def lum(c): return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def jit(i, amt=0.08):
    r = int(hashlib.md5(str(i).encode()).hexdigest()[:4], 16) / 65535
    return 1 + (r - 0.5) * 2 * amt

def faces_frame(o):
    """Per face: (t along body 0 tail .. 1 beak, h 0 bottom .. 1 top, ax |x| share of half-width, normal, colour)."""
    lo, hi = bounds(o); cols = face_colours(o); out = []
    for p, c in zip(o.data.polygons, cols):
        q = p.center
        out.append(dict(t=(q.y - lo.y) / (hi.y - lo.y), h=(q.z - lo.z) / (hi.z - lo.z), x=q.x, ax=abs(q.x) / max(1e-6, max(-lo.x, hi.x)), n=p.normal.copy(), c=c, i=p.index))
    return out

# ---- palettes ---------------------------------------------------------------------------------
SLATE, GREEN, PURPLE, BODY, BACK, BAR, TAILC, BAND, PRIM, UNDERW = (H(0x545b67), H(0x467a60), H(0x6f5384), H(0x868e9b), H(0xa1aab6), H(0x25272c), H(0x78818e), H(0x2a2c31), H(0x464a52), H(0xc8cdd5))
def is_white(c): return lum(c) > 0.55 and max(c) - min(c) < 0.12
def pigeon_body(f, wing_bars=True):
    c, t, h = f["c"], f["t"], f["h"]
    if not is_white(c) and lum(c) < 0.02: return c                      # eye
    if not is_white(c): return H(0x9d4343) if h < 0.35 else H(0x3b3a3c) if t > 0.9 else c
    if t > 0.84: return SLATE
    # The neck's sheen: green above, purple below, turning with the feathers' angle.
    if t > 0.72 and h > 0.58:
        side = min(1, abs(f["n"].x) * 1.4)
        return mix(GREEN, PURPLE, 0.25 + 0.5 * side) if t > 0.77 else mix(PURPLE, BODY, 0.35)
    if t < 0.07: return BAND
    if t < 0.24: return TAILC
    up = f["n"].z > 0.25
    if wing_bars and up and f["ax"] > 0.3 and (0.40 < t < 0.45 or 0.49 < t < 0.54): return BAR
    if up and t < 0.33 and f["ax"] > 0.3: return PRIM
    return mix(BACK, BODY, 0.0 if up else 1.0) if f["h"] > 0.3 else BODY

def recolour(o, species, part, wing=False):
    F = faces_frame(o); new = []
    for f in F:
        c, t, h, n = f["c"], f["t"], f["h"], f["n"]
        if species == "pigeon" and part == "stand":
            new.append(pigeon_body(f))
        elif species == "pigeon" and part == "fly":
            if wing:
                span = f["ax"]
                col = (PRIM if span > 0.78 else BACK) if n.z > 0 else (mix(UNDERW, PRIM, 0.4) if span > 0.85 else UNDERW)
                if n.z > 0 and 0.12 < span < 0.42 and 0.25 < f["t"] < 0.55: col = BAR if int(span * 14) % 3 == 0 else BACK
                new.append(col)
            else:
                yellow = c[0] > c[2] * 2.5 and c[0] > 0.1
                if yellow: new.append(H(0x3b3a3c) if t > 0.85 else H(0x9d4343))
                else: new.append(pigeon_body(dict(f, ax=0), wing_bars=False))
        elif species == "gull":
            yellow = c[0] > c[2] * 2.5 and c[0] > 0.1
            if yellow: new.append(H(0xe0b23c) if t > 0.85 else H(0xd8a2aa))
            elif part == "fly" and wing:
                span = f["ax"]
                if span > 0.8: new.append(H(0x1c1d21) if not (span > 0.95 and n.z > 0) else H(0xf2f2f2))
                elif n.z > 0: new.append(H(0x5b636e) if f["t"] > 0.25 else H(0xf2f3f4))   # white trailing edge
                else: new.append(H(0xd5d9de))
            elif part == "stand" and lum(c) < 0.25 and lum(c) > 0.05 and t < 0.25: new.append(H(0x1c1d21))   # wing tips
            elif part == "stand" and lum(c) < 0.25 and lum(c) > 0.05: new.append(H(0x5b636e))
            else: new.append(c)
        elif species == "crow":
            l = lum(c); new.append(tuple(x * max(0.004, l) / 0.012 * 0.6 for x in H(0x16181e)) if part == "stand" else c)
        elif species == "sparrow" and part == "fly":
            k = jit(f["i"], 0.25)
            if wing: new.append(tuple(x * k for x in (H(0x6b4a2e) if n.z > 0 else H(0xb8ad9e))))
            elif t > 0.82 and h > 0.55 and n.z > 0.3: new.append(H(0xe8e6e0) if f["ax"] < 0.25 else H(0x1a1a1a))
            elif t > 0.92 and h < 0.6: new.append(H(0xc57634))
            elif t > 0.78: new.append(H(0x9a968f))
            elif t < 0.25: new.append(H(0x5a4030))
            elif n.z > 0.2: new.append(tuple(x * k for x in H(0x6b4a2e)))
            else: new.append(H(0xa9a69f))
        else:
            new.append(c)
    paint(o, new)

# ---- geometry ---------------------------------------------------------------------------------
def scale_to(o, length, span=None):
    lo, hi = bounds(o); s = length / (hi.y - lo.y)
    o.data.transform(Matrix.Scale(s, 4))
    return s

def copy(o, name):
    c = o.copy(); c.data = o.data.copy(); c.name = name; c.data.name = name
    bpy.context.scene.collection.objects.link(c); return c

def keep_faces(o, pred):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not pred(f)], context='FACES')
    bm.to_mesh(o.data); bm.free()

def decimate(o, ratio=None, faces=None):
    if faces: ratio = min(1.0, faces / max(1, len(o.data.polygons)))
    if ratio >= 0.999: return
    m = o.modifiers.new("dec", 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=m.name)

def triangulate(o):
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()

def set_origin(o, at):
    o.data.transform(Matrix.Translation(-at)); o.location = at

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

MAT = None
def material():
    global MAT
    if MAT: return MAT
    m = bpy.data.materials.new("bird"); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]; a = nt.nodes.new("ShaderNodeVertexColor"); a.layer_name = "Col"
    nt.links.new(a.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.85
    MAT = m; return m
def finish(o):
    o.data.materials.clear(); o.data.materials.append(material())
    # Smooth across gentle folds (a real bird's round body), sharp at the creases; colours as bytes.
    o.data.shade_smooth(); o.data.set_sharp_from_angle(angle=math.radians(50))
    a = o.data.color_attributes["Col"]; vals = [tuple(d.color) for d in a.data]
    o.data.color_attributes.remove(a); b = o.data.color_attributes.new("Col", 'BYTE_COLOR', 'CORNER')
    for d, v in zip(b.data, vals): d.color = v
    o.data.color_attributes.active_color = b

def build_stand(species, sp):
    o = load(f"{RAW}/{sp['stand']}.glb", YAW[sp["stand"]]); o.name = "stand"
    scale_to(o, sp["length"])
    recolour(o, species, "stand")
    lo, hi = bounds(o)
    feet = [v.co for v in o.data.vertices if v.co.z < lo.z + 0.02 * (hi.z - lo.z)]
    fy = sum(v.y for v in feet) / len(feet)
    o.data.transform(Matrix.Translation(Vector((0, -fy, -lo.z))))
    low = copy(o, "stand_low")
    decimate(o, NEAR_KEEP["stand"]); decimate(low, faces=LOW_FACES)
    return [o, low]

def build_fly(species, sp):
    src = sp["fly"]; o = load(f"{RAW}/{src}.glb", YAW[src]); o.name = "fly"
    scale_to(o, sp["length"])
    lo, hi = bounds(o)
    cx = (lo.x + hi.x) / 2; o.data.transform(Matrix.Translation(Vector((-cx, 0, 0))))
    sh = SHOULDER[src] * sp["length"]
    wl, wr = copy(o, "fly_wing_l"), copy(o, "fly_wing_r")
    keep_faces(o, lambda f: abs(f.calc_center_median().x) <= sh)
    keep_faces(wl, lambda f: f.calc_center_median().x < -sh)
    keep_faces(wr, lambda f: f.calc_center_median().x > sh)
    body_lo, body_hi = bounds(o); centre = (body_lo + body_hi) / 2
    wings = []
    for w, side in ((wl, -1), (wr, 1)):
        vs = [v.co for v in w.data.vertices]
        root = [v for v in vs if abs(v.x) < sh * 1.6] or vs
        hinge = Vector((side * sh, sum(v.y for v in root) / len(root), sum(v.z for v in root) / len(root)))
        # Level it: the wing's reach from the hinge, weighted to the tip, to a 4 degree dihedral.
        far = sorted(vs, key=lambda v: -abs(v.x))[: max(3, len(vs) // 5)]
        d = sum((v - hinge for v in far), Vector()) / len(far)
        ang = math.atan2(d.z, abs(d.x)) - math.radians(4)
        rot = Matrix.Rotation(side * ang, 4, 'Y')
        w.data.transform(Matrix.Translation(hinge) @ rot @ Matrix.Translation(-hinge))
        if species == "pigeon":   # a pigeon's wing is broader than a gull's
            my = sum(v.co.y for v in w.data.vertices) / len(w.data.vertices)
            w.data.transform(Matrix.Translation(Vector((0, my, 0))) @ Matrix.Diagonal((1, 1.45, 1, 1)) @ Matrix.Translation(Vector((0, -my, 0))))
        # Stretch the span to the species' own.
        reach = max(abs(v.co.x) for v in w.data.vertices) - sh
        want = sp["span"] / 2 - sh
        w.data.transform(Matrix.Translation(hinge) @ Matrix.Diagonal((want / reach, 1, 1, 1)) @ Matrix.Translation(-hinge))
        recolour(w, species, "fly", wing=True)
        wings.append((w, hinge))
    recolour(o, species, "fly")
    for x in [o] + [w for w, _ in wings]: x.data.transform(Matrix.Translation(-centre))
    low = copy(o, "fly_low")
    bm = bmesh.new(); bm.from_mesh(low.data)
    for w, _ in wings: bm.from_mesh(w.data)
    bm.to_mesh(low.data); bm.free(); weld(low, 2e-3)
    for w, hinge in wings: set_origin(w, hinge - centre)
    for x in [o] + [w for w, _ in wings]: decimate(x, NEAR_KEEP["fly"])
    decimate(low, faces=LOW_FACES + 30)
    return [o, *[w for w, _ in wings], low]

report = {}
for species, sp in SPECIES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True); MAT = None
    objs = build_stand(species, sp) + build_fly(species, sp)
    for x in objs: triangulate(x); finish(x)
    bpy.ops.object.select_all(action='SELECT')
    path = f"{OUT}/{species}.glb"
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_texcoords=False, export_normals=True,
                              export_materials='EXPORT', export_yup=True, export_apply=True, export_extras=False, export_animations=False)
    report[species] = {x.name: {"triangles": tris(x), "origin": [round(v, 4) for v in (x.location.x, x.location.z, -x.location.y)]} for x in objs}
    report[species]["bytes"] = os.path.getsize(path)
print("REPORT " + json.dumps(report))
