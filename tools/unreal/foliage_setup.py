"""Native foliage for the imported city: leaves that are leaves, wind in them, grass underfoot.

The tile exporter (export_tiles.mjs) writes a tree's leaf cards as their own ``foliage:<kind>``
surface, every plant vertex's sway inputs in UV1/UV2, and the lawn grass of each tile as clump
positions. This makes what Unreal needs for them -- once, under /Game/KerbsideRuntime/Foliage --
and puts it on a city map:

* leaf, needle, palm-frond and litter textures (painted here, as the page paints its own in a
  canvas, which the exporter cannot carry) and a grass clump mesh;
* ``MPC_KerbsideFoliage`` with ``Wind`` and ``Walker``, which KerbsideCelestialSky writes every
  frame;
* ``M_KerbsideFoliage``: masked, two-sided, its colour the texture times the vertex colour
  times a tint, and a world-position offset that sways trees and shrubs by the square of their
  height fraction in the wind, flutters leaves, waves grass and presses it away from the walker
  -- the vertex shader docs/foliage-motion.mjs runs on the web, in Unreal's units (cm, z up);
* an instance of it per kind of surface, assigned to the tiles' material slots, and an
  AKerbsideGrassField per tile with that tile's clumps.

Nothing here moves a collider or a measured surface: the offset is drawn only.

Run inside the editor (setup_world.py imports it), or alone on a map already imported with the
new exporter:  UnrealEditor-Cmd Kerbside.uproject -run=pythonscript -script=foliage_setup.py
"""

from __future__ import annotations

import base64
import json
import math
import os
import struct
from pathlib import Path

try:
    import unreal
except ImportError:          # the texture and mesh writers also run (and are tested) outside
    unreal = None

FOLDER = "/Game/KerbsideRuntime/Foliage"
MPC = f"{FOLDER}/MPC_KerbsideFoliage"
MASTER = f"{FOLDER}/M_KerbsideFoliage"

#: The vertex offset, in cm, from UV1 = (height fraction, plant height m), UV2 = (phase, kind:
#: 1 tree, 2 shrub, 3 grass), the wind (toward x, toward y, m/s) and the walker (x, y, z cm,
#: press radius cm). Mirrors docs/foliage-motion.mjs: a crown's top sways about a quarter of a
#: percent of its height per m/s, at a period that slows with height.
WPO_HLSL = r"""
float t = saturate(UV1.x);
float hm = max(UV1.y, 0.2);
float kind = UV2.y;
float ph = UV2.x * 6.2832;
float v = Wind.z;
float2 dir = Wind.xy;
float3 off = 0;
if (kind > 0.5 && kind < 2.5) {
    float gust = 0.62 + 0.38 * sin(Time * 0.31 + ph * 0.21) * sin(Time * 0.13 + ph * 0.7);
    float swing = sin(Time * 6.2832 / sqrt(max(1.0, hm)) + ph);
    float amp = hm * 100.0 * 0.0022 * v * gust;
    off.xy = dir * amp * t * t * (0.7 + 0.45 * swing);
    float flutter = sin(Time * (6.5 + v * 0.45) + dot(WorldPos, float3(0.131, 0.077, 0.113)));
    off += float3(-dir.y * 0.6, dir.x * 0.6, 0.5) * flutter * 0.6 * v * t * min(1.0, hm * 0.25) * Leaf;
}
if (kind > 2.5) {
    float wave = sin(Time * 1.7 - dot(WorldPos.xy, dir) * 0.0035 + ph * 0.15);
    off.xy = dir * t * t * (0.35 * v + 0.45 * v * wave);
    float2 d = WorldPos.xy - Walker.xy;
    float press = (1.0 - smoothstep(Walker.w * 0.3, Walker.w, length(d))) * step(abs(WorldPos.z - Walker.z), 150.0);
    off.xy += normalize(d + 0.0001) * press * t * 8.0;
    off.z -= press * t * t * 7.5;
}
return off;
"""

# ---- textures and the grass mesh, written as files ---------------------------------------


def _noise(i: int, salt: int) -> float:
    h = (i * 374761393 + salt * 668265263) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296


def paint_textures(out: Path) -> dict[str, Path]:
    """Leaf sprays, needles, palm fronds, and the three litters, as RGBA PNGs (white-ish leaves:
    the material tints them with the vertex colour the page gave each card)."""
    from PIL import Image, ImageDraw
    out.mkdir(parents=True, exist_ok=True)
    made = {}

    def canvas():
        image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        return image, ImageDraw.Draw(image)

    def leaf(draw, x, y, angle, length, width, colour):
        pts = []
        for k in range(13):
            s = k / 12
            w = width * math.sin(math.pi * s)
            pts.append((s * length, w))
        pts += [(s, -w) for s, w in reversed(pts)]
        ca, sa = math.cos(angle), math.sin(angle)
        draw.polygon([(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in pts], fill=colour)

    # Broad leaves on twigs.
    image, draw = canvas()
    for j in range(34):
        x, y, a = 16 + _noise(j, 1) * 224, 16 + _noise(j, 2) * 224, _noise(j, 3) * 6.283
        twig = 56 + _noise(j, 4) * 50
        draw.line([(x - math.cos(a) * twig / 2, y - math.sin(a) * twig / 2),
                   (x + math.cos(a) * twig / 2, y + math.sin(a) * twig / 2)], fill=(120, 105, 90, 255), width=2)
        for k in range(12):
            t = (k + .5) / 12 - .5
            side = 1 if k % 2 else -1
            lit = 205 + int(_noise(j * 40 + k, 9) * 50)
            px, py = x + math.cos(a) * t * twig, y + math.sin(a) * t * twig
            leaf(draw, px, py, a + side * (0.65 + _noise(j * 40 + k, 5) * 0.5), 22 + _noise(j * 40 + k, 6) * 12,
                 4 + _noise(j * 40 + k, 7) * 3, (lit - 20, min(255, lit + 6), lit - 30, 255))
    made["leaf_broad"] = out / "T_Leaf_Broad.png"
    image.save(made["leaf_broad"])

    # Needles.
    image, draw = canvas()
    for j in range(40):
        x, y, a = 20 + _noise(j, 11) * 216, 20 + _noise(j, 12) * 216, _noise(j, 13) * 6.283
        twig = 48 + _noise(j, 14) * 44
        draw.line([(x - math.cos(a) * twig / 2, y - math.sin(a) * twig / 2),
                   (x + math.cos(a) * twig / 2, y + math.sin(a) * twig / 2)], fill=(150, 140, 120, 255), width=2)
        for k in range(34):
            t = k / 33 - .5
            side = 1 if k % 2 else -1
            g = 200 + int(_noise(j * 40 + k, 15) * 55)
            px, py = x + math.cos(a) * t * twig, y + math.sin(a) * t * twig
            l = 10 + _noise(j * 40 + k, 16) * 9
            draw.line([(px, py), (px + math.cos(a + side * 1.0) * l, py + math.sin(a + side * 1.0) * l)],
                      fill=(g - 14, g, g - 20, 255), width=2)
    made["leaf_needle"] = out / "T_Leaf_Needle.png"
    image.save(made["leaf_needle"])

    # A palm frond: a rib and leaflets off it.
    image, draw = canvas()
    draw.line([(128, 256), (128, 2)], fill=(150, 160, 110, 255), width=4)
    for i in range(40):
        y = 252 - i * 6.2
        reach = math.sin(i / 40 * math.pi) * 116 + 6
        for side in (-1, 1):
            g = 200 + int(_noise(i, side + 40) * 50)
            draw.line([(128, y), (128 + side * reach, y - reach * .45)], fill=(g - 30, g, g - 50, 255), width=5)
    made["leaf_palm"] = out / "T_Leaf_Palm.png"
    image.save(made["leaf_palm"])

    # Litter: fallen leaves, needle duff, blue-gum bark ribbons; ragged, no backing disc.
    for kind, name in (("leaf_litter", "T_Litter_Leaf"), ("needle_duff", "T_Litter_Needle"),
                       ("eucalyptus_litter", "T_Litter_Eucalyptus")):
        image, draw = canvas()
        browns = [(107, 74, 43), (138, 106, 62), (167, 132, 79), (90, 61, 34), (120, 96, 48), (150, 140, 80)]

        def at(j, salt):
            a = _noise(j, salt) * 6.283
            r = 118 * _noise(j, salt + 1) ** .75
            return 128 + math.cos(a) * r, 128 + math.sin(a) * r
        for j in range(160):
            x, y = at(j, 77)
            r = 2 + _noise(j, 78) * 5
            b = browns[(j + 2) % 4]
            draw.ellipse([x - r, y - r * .7, x + r, y + r * .7], fill=(b[0] - 30, b[1] - 28, b[2] - 18, 255))
        if kind == "needle_duff":
            for j in range(1600):
                x, y = at(j, 3)
                a, l = _noise(j, 5) * 6.283, 6 + _noise(j, 6) * 10
                b = browns[j % 4]
                draw.line([(x, y), (x + math.cos(a) * l, y + math.sin(a) * l)], fill=(b[0] + 30, b[1] + 10, b[2], 255), width=1)
        else:
            euc = kind == "eucalyptus_litter"
            if euc:
                for j in range(26):
                    x, y = at(j, 40)
                    a, l = _noise(j, 41) * 6.283, 40 + _noise(j, 42) * 60
                    dx, dy = math.cos(a) * l / 2, math.sin(a) * l / 2
                    draw.line([(x - dx, y - dy), (x + dx, y + dy)], fill=(190 + j % 30, 170 + j % 25, 135 + j % 20, 255), width=6)
            for j in range(420 if euc else 700):
                x, y = at(j, 7)
                a = _noise(j, 8) * 6.283
                l = (16 if euc else 9) + _noise(j, 9) * (10 if euc else 8)
                b = [(150, 140, 110), (170, 150, 110), (120, 110, 80)][j % 3] if euc else browns[j % len(browns)]
                k = .8 + _noise(j, 10) * .35
                leaf(draw, x - math.cos(a) * l / 2, y - math.sin(a) * l / 2, a, l, l * (.16 if euc else .42) / 2,
                     (int(b[0] * k), int(b[1] * k), int(b[2] * k), 255))
        made[kind] = out / f"{name}.png"
        image.save(made[kind])
    white = Image.new("RGBA", (4, 4), (255, 255, 255, 255))
    made["white"] = out / "T_White.png"
    white.save(made["white"])
    return made


def write_grass_clump(path: Path) -> Path:
    """A clump of eleven blades, 30-55 cm, as glTF (metres, y up): UV1 = (blade height fraction,
    the blade's height in m), UV2 = (0, 3) -- grass -- for the material's bend and press."""
    positions, colours, uv0, uv1, uv2, indices = [], [], [], [], [], []
    for j in range(11):
        a = j * 2.39996 + _noise(j, 1) * .4
        r = .03 + _noise(j, 2) * .16
        h = .30 + _noise(j, 3) * .25
        w = .011 + _noise(j, 4) * .006
        lean = .06 + _noise(j, 5) * .12
        x, z = math.cos(a) * r, math.sin(a) * r
        tx, tz = -math.sin(a), math.cos(a)            # the blade's flat across
        ox, oz = math.cos(a) * lean, math.sin(a) * lean
        base = len(positions)
        for (u, frac, width) in ((-1, 0, w), (1, 0, w), (-1, .55, w * .6), (1, .55, w * .6), (0, 1, 0)):
            positions.append((x + tx * width * u + ox * frac * frac, h * frac, z + tz * width * u + oz * frac * frac))
            shade = .55 + .45 * frac
            colours.append((.30 * shade, .44 * shade, .17 * shade, 1.0))
            uv0.append(((u + 1) / 2, 1 - frac))
            uv1.append((frac, h))
            uv2.append((0.0, 3.0))
        indices += [base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4]
    blob, views, accessors = b"", [], []

    def add(values, kind, ctype=5126, target=34962):
        nonlocal blob
        flat = [c for v in values for c in (v if isinstance(v, tuple) else (v,))]
        data = struct.pack(f"<{len(flat)}{'f' if ctype == 5126 else 'H'}", *flat)
        while len(blob) % 4:
            blob += b"\0"
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob += data
        acc = {"bufferView": len(views) - 1, "componentType": ctype, "count": len(values), "type": kind}
        if kind == "VEC3":
            acc["min"] = [min(v[i] for v in values) for i in range(3)]
            acc["max"] = [max(v[i] for v in values) for i in range(3)]
        accessors.append(acc)
        return len(accessors) - 1
    attrs = {"POSITION": add(positions, "VEC3"), "COLOR_0": add(colours, "VEC4"), "TEXCOORD_0": add(uv0, "VEC2"),
             "TEXCOORD_1": add(uv1, "VEC2"), "TEXCOORD_2": add(uv2, "VEC2")}
    index = add(indices, "SCALAR", 5123, 34963)
    gltf = {"asset": {"version": "2.0", "generator": "kerbside foliage_setup.py"},
            "scenes": [{"nodes": [0]}], "scene": 0, "nodes": [{"mesh": 0, "name": "grass_clump"}],
            "materials": [{"name": "grass", "doubleSided": True, "pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": 1}}],
            "meshes": [{"name": "grass_clump", "primitives": [{"attributes": attrs, "indices": index, "material": 0}]}],
            "accessors": accessors, "bufferViews": views,
            "buffers": [{"byteLength": len(blob), "uri": "data:application/octet-stream;base64," + base64.b64encode(blob).decode()}]}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(gltf))
    return path


TEXTURE_NAMES = {"leaf_broad": "T_Leaf_Broad", "leaf_needle": "T_Leaf_Needle", "leaf_palm": "T_Leaf_Palm",
                 "leaf_litter": "T_Litter_Leaf", "needle_duff": "T_Litter_Needle",
                 "eucalyptus_litter": "T_Litter_Eucalyptus", "white": "T_White"}

# ---- the Unreal side ----------------------------------------------------------------------


def _tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def _import(files: list[Path], folder: str) -> None:
    tasks = []
    for f in files:
        task = unreal.AssetImportTask()
        task.filename = str(f)
        task.destination_path = folder
        task.automated = True
        task.replace_existing = True
        task.save = True
        tasks.append(task)
    _tools().import_asset_tasks(tasks)


def _load(path: str):
    return unreal.EditorAssetLibrary.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None


def ensure_collection():
    mpc = _load(MPC)
    if mpc:
        return mpc
    mpc = _tools().create_asset("MPC_KerbsideFoliage", FOLDER, unreal.MaterialParameterCollection,
                                unreal.MaterialParameterCollectionFactoryNew())
    params = []
    for name, value in (("Wind", unreal.LinearColor(0.94, 0.34, 4.5, 0)), ("Walker", unreal.LinearColor(0, 0, -1e7, 55))):
        p = unreal.CollectionVectorParameter()
        p.set_editor_property("parameter_name", name)
        p.set_editor_property("default_value", value)
        params.append(p)
    mpc.set_editor_property("vector_parameters", params)
    unreal.EditorAssetLibrary.save_loaded_asset(mpc)
    return mpc


def ensure_master(mpc, white):
    mat = _load(MASTER)
    if mat:
        return mat
    mel = unreal.MaterialEditingLibrary
    mat = _tools().create_asset("M_KerbsideFoliage", FOLDER, unreal.Material, unreal.MaterialFactoryNew())
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    mat.set_editor_property("two_sided", True)
    mat.set_editor_property("opacity_mask_clip_value", 0.42)
    mat.set_editor_property("used_with_instanced_static_meshes", True)
    mat.set_editor_property("used_with_nanite", True)
    X = lambda cls, x, y: mel.create_material_expression(mat, cls, x, y)  # noqa: E731
    tex = X(unreal.MaterialExpressionTextureSampleParameter2D, -900, -200)
    tex.set_editor_property("parameter_name", "Leaves")
    tex.set_editor_property("texture", white)
    colour = X(unreal.MaterialExpressionVertexColor, -900, 60)
    tint = X(unreal.MaterialExpressionVectorParameter, -900, 220)
    tint.set_editor_property("parameter_name", "Tint")
    tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    m1 = X(unreal.MaterialExpressionMultiply, -600, -80)
    m2 = X(unreal.MaterialExpressionMultiply, -400, -40)
    mel.connect_material_expressions(tex, "RGB", m1, "A")
    mel.connect_material_expressions(colour, "", m1, "B")
    mel.connect_material_expressions(m1, "", m2, "A")
    mel.connect_material_expressions(tint, "", m2, "B")
    mel.connect_material_property(m2, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(tex, "A", unreal.MaterialProperty.MP_OPACITY_MASK)
    rough = X(unreal.MaterialExpressionConstant, -400, 120)
    rough.set_editor_property("r", 0.85)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    custom = X(unreal.MaterialExpressionCustom, -400, 400)
    custom.set_editor_property("code", WPO_HLSL)
    custom.set_editor_property("output_type", unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    custom.set_editor_property("description", "Kerbside foliage sway")
    names = ["UV1", "UV2", "Wind", "Walker", "Time", "WorldPos", "Leaf"]
    inputs = []
    for n in names:
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        inputs.append(ci)
    custom.set_editor_property("inputs", inputs)
    uv1 = X(unreal.MaterialExpressionTextureCoordinate, -900, 360)
    uv1.set_editor_property("coordinate_index", 1)
    uv2 = X(unreal.MaterialExpressionTextureCoordinate, -900, 440)
    uv2.set_editor_property("coordinate_index", 2)
    wind = X(unreal.MaterialExpressionCollectionParameter, -900, 520)
    wind.set_editor_property("collection", mpc)
    wind.set_editor_property("parameter_name", "Wind")
    walker = X(unreal.MaterialExpressionCollectionParameter, -900, 600)
    walker.set_editor_property("collection", mpc)
    walker.set_editor_property("parameter_name", "Walker")
    time = X(unreal.MaterialExpressionTime, -900, 680)
    where = X(unreal.MaterialExpressionWorldPosition, -900, 760)
    leaf = X(unreal.MaterialExpressionScalarParameter, -900, 840)
    leaf.set_editor_property("parameter_name", "Flutter")
    leaf.set_editor_property("default_value", 1.0)
    for source, name in ((uv1, "UV1"), (uv2, "UV2"), (wind, "Wind"), (walker, "Walker"), (time, "Time"),
                         (where, "WorldPos"), (leaf, "Leaf")):
        mel.connect_material_expressions(source, "", custom, name)
    mel.connect_material_property(custom, "", unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)
    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    return mat


#: The instance for each kind of surface: its texture, its tint, whether its leaves flutter.
KINDS = {
    "leaf_broad": ("leaf_broad", (0.42, 0.62, 0.30), 1.0),
    "leaf_needle": ("leaf_needle", (0.30, 0.46, 0.30), 0.5),
    "leaf_palm": ("leaf_palm", (0.45, 0.58, 0.30), 1.0),
    "bark": ("white", (0.36, 0.29, 0.22), 0.0),
    "shrub": ("leaf_broad", (0.34, 0.48, 0.24), 1.0),
    "grass": ("white", (0.80, 1.00, 0.70), 0.0),
    "litter_leaf": ("leaf_litter", (1, 1, 1), 0.0),
    "litter_needle": ("needle_duff", (1, 1, 1), 0.0),
    "litter_eucalyptus": ("eucalyptus_litter", (1, 1, 1), 0.0),
}


def ensure_instances(master, textures):
    made = {}
    for kind, (texture, tint, flutter) in KINDS.items():
        path = f"{FOLDER}/MI_Foliage_{kind}"
        mi = _load(path)
        if not mi:
            mi = _tools().create_asset(f"MI_Foliage_{kind}", FOLDER, unreal.MaterialInstanceConstant,
                                       unreal.MaterialInstanceConstantFactoryNew())
            mel = unreal.MaterialEditingLibrary
            mel.set_material_instance_parent(mi, master)
            mel.set_material_instance_texture_parameter_value(mi, "Leaves", textures[texture])
            mel.set_material_instance_vector_parameter_value(mi, "Tint", unreal.LinearColor(*tint, 1))
            mel.set_material_instance_scalar_parameter_value(mi, "Flutter", flutter)
            unreal.EditorAssetLibrary.save_loaded_asset(mi)
        made[kind] = mi
    return made


def ensure_assets(work: Path):
    """Everything under FOLDER, made once; returns (instances, grass clump mesh). Unreal's Python
    has no PIL: paint the textures first with ``python foliage_setup.py <work dir>``."""
    try:
        files = paint_textures(work / "textures")
    except ImportError:
        files = {k: work / "textures" / f"{n}.png" for k, n in TEXTURE_NAMES.items()}
        if not all(f.is_file() for f in files.values()):
            raise RuntimeError(f"paint the foliage textures first: python tools/unreal/foliage_setup.py {work}")
    clump = write_grass_clump(work / "SM_GrassClump.gltf")
    missing = [f for f in files.values() if not unreal.EditorAssetLibrary.does_asset_exist(f"{FOLDER}/{f.stem}")]
    if missing:
        _import(missing, FOLDER)
    if not unreal.EditorAssetLibrary.does_asset_exist(f"{FOLDER}/SM_GrassClump"):
        _import([clump], FOLDER)
    textures = {k: _load(f"{FOLDER}/{f.stem}") for k, f in files.items()}
    mpc = ensure_collection()
    master = ensure_master(mpc, textures["white"])
    meshes = [a for a in unreal.EditorAssetLibrary.list_assets(FOLDER, recursive=True) if "GrassClump" in a]
    grass = next((m for m in (unreal.EditorAssetLibrary.load_asset(a) for a in meshes) if isinstance(m, unreal.StaticMesh)), None)
    return ensure_instances(master, textures), grass


def kind_for(surface: str) -> str | None:
    """Which instance a tile surface takes, or None to keep the imported material."""
    name = surface.split("|")[0]
    if name.startswith("foliage:"):
        sub = name.split(":", 1)[1]
        return "leaf_needle" if sub == "conifer" else "leaf_palm" if sub == "palm" else "leaf_broad"
    if name.startswith("tree:"):
        return "bark"
    if name.startswith("understorey:"):
        return "shrub"
    if name.startswith("litter:"):
        sub = name.split(":", 1)[1]
        return {"needle_duff": "litter_needle", "eucalyptus_litter": "litter_eucalyptus"}.get(sub, "litter_leaf")
    return None


def dress_component(component, surfaces: list[str], instances: dict) -> int:
    """Give each of a tile mesh's slots its foliage instance; returns how many slots changed."""
    changed = 0
    for i, surface in enumerate(surfaces):
        kind = kind_for(surface)
        if kind:
            component.set_material(i, instances[kind])
            changed += 1
    if changed:
        component.set_editor_property("evaluate_world_position_offset", True)
    return changed


def plant_grass(actors, tile: dict, export_dir: Path, clump, instance):
    """One grass field for a tile. Its clumps are glTF metres; the probe-calibrated import makes
    world (x, z, y) * 100 the same place, as the spawn is placed, so they go in world space."""
    entry = tile.get("grass")
    if not entry or not clump:
        return 0
    data = json.loads((export_dir / entry["file"]).read_text())
    transforms = []
    for x, y, z, turn, scale in data["clumps"]:
        transforms.append(unreal.Transform(location=unreal.Vector(x * 100, z * 100, y * 100),
                                           rotation=unreal.Rotator(0, turn, 0), scale=unreal.Vector(scale, scale, scale)))
    field = actors.spawn_actor_from_class(unreal.KerbsideGrassField, unreal.Vector(0, 0, 0))
    field.set_actor_label(f"Kerbside grass {tile['ix']},{tile['iz']}")
    field.set_folder_path("Kerbside/Grass")
    return field.plant_clumps(clump, instance, transforms, 6000.0)


def main() -> None:
    """Dress an already imported map (KERBSIDE_FOLIAGE_MAP) from its export (KERBSIDE_TILE_MANIFEST)."""
    level = os.environ["KERBSIDE_FOLIAGE_MAP"]
    manifest_path = Path(os.environ["KERBSIDE_TILE_MANIFEST"]).resolve()
    manifest = json.loads(manifest_path.read_text())
    work = Path(unreal.Paths.project_saved_dir()) / "KerbsideFoliage"
    instances, clump = ensure_assets(work)
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not levels.load_level(level):
        raise RuntimeError(f"cannot load {level}")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    dressed = 0
    for actor in actors.get_all_level_actors():
        if not isinstance(actor, unreal.StaticMeshActor) or not actor.get_actor_label().startswith("Kerbside "):
            continue
        component = actor.get_component_by_class(unreal.StaticMeshComponent)
        mesh = component.get_editor_property("static_mesh")
        if mesh:
            from setup_world import canonical_surface  # noqa: PLC0415 (needs the editor's unreal)
            tile = next(t for t in manifest["tiles"] if actor.get_actor_label().startswith(f"Kerbside {t['ix']},{t['iz']} "))
            surfaces = [canonical_surface(str(s.material_slot_name).split("|")[0], tile["surfaces"])
                        for s in mesh.get_editor_property("static_materials")]
            dressed += dress_component(component, surfaces, instances)
    grass = sum(plant_grass(actors, t, manifest_path.parent, clump, instances["grass"]) for t in manifest["tiles"])
    if not levels.save_current_level():
        raise RuntimeError("could not save the dressed map")
    unreal.log(json.dumps({"foliage_slots": dressed, "grass_clumps": grass, "level": level}))


if __name__ == "__main__":
    if unreal is not None:
        main()
    else:
        import sys
        work = Path(sys.argv[1])
        print({k: str(v) for k, v in paint_textures(work / "textures").items()})
