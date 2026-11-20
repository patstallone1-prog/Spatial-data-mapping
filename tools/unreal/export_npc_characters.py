"""Export the near-ring NPC characters from the Unreal project as low-detail glTF (UE 5.8).

Run headless, one editor process, no renderer::

    UnrealEditor <Kerbside.uproject> -run=pythonscript -script=<this file> -nullrhi -unattended

``KERBSIDE_NPC_OUT`` is the output folder (default: the project's Saved/KerbsideNPC). Writes one
GLB per mesh at a reduced level of detail, the mannequin clips the page plays (idle, walk, jog),
the baked textures of each MetaHuman, and ``export.json`` listing what was written. Nothing here
changes the project. The page's pieces are assembled by ``tools/build_npc_characters.mjs``.
"""

from __future__ import annotations

import json
import os
import traceback
from pathlib import Path

#: (name, asset, level of detail): lower detail than the native game draws, for the browser.
MESHES = [
    ("ada-body", "/Game/Characters/MetaHumans/Unpacked/Ada/Body/SKM_Ada_BodyMesh", 1),
    ("ada-face", "/Game/Characters/MetaHumans/Unpacked/Ada/Face/SKM_Ada_FaceMesh", 1),
    ("ada-outfit", "/Game/Characters/MetaHumans/Unpacked/Ada/Clothing/Ada_Outfits", 3),
    ("ada-hair", "/Game/Characters/MetaHumans/Unpacked/Ada/Grooms/Hair_S_Coil_CardsMesh_Group0_LOD3", 0),
    ("manny", "/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple", 2),
]
CLIPS = [
    ("idle", "/Game/Characters/Mannequins/Anims/Unarmed/MM_Idle"),
    ("walk", "/Game/Characters/Mannequins/Anims/Unarmed/Walk/MF_Unarmed_Walk_Fwd"),
    ("jog", "/Game/Characters/Mannequins/Anims/Unarmed/Jog/MF_Unarmed_Jog_Fwd"),
]
TEXTURE_DIRS = ["/Game/Characters/MetaHumans/Unpacked/Ada/Body/Baked", "/Game/Characters/MetaHumans/Unpacked/Ada/Face/Baked",
                "/Game/Characters/MetaHumans/Unpacked/Ada/Grooms/Textures", "/Game/Characters/MetaHumans/Unpacked/Ada/Clothing"]


def options(unreal, lod: int, animation: bool):
    o = unreal.GLTFExportOptions()
    for key, value in (("default_level_of_detail", lod), ("export_vertex_skin_weights", True),
                       ("export_animation_sequences", animation), ("export_vertex_colors", False),
                       ("export_level_sequences", False), ("export_lights", False), ("export_cameras", False)):
        try:
            o.set_editor_property(key, value)
        except Exception:
            pass
    # Material baking needs a renderer; the textures are exported on their own below.
    for key in ("bake_material_inputs",):
        try:
            o.set_editor_property(key, unreal.GLTFMaterialBakeMode.DISABLED)
        except Exception:
            pass
    return o


def main() -> None:
    import unreal

    out = Path(os.environ.get("KERBSIDE_NPC_OUT", str(Path(unreal.Paths.project_saved_dir()) / "KerbsideNPC")))
    out.mkdir(parents=True, exist_ok=True)
    report = {"meshes": {}, "clips": {}, "textures": [], "errors": []}
    only = set(filter(None, os.environ.get("KERBSIDE_NPC_ONLY", "").split(",")))
    for name, path, lod in MESHES:
        if only and name not in only:
            continue
        try:
            asset = unreal.load_asset(path)
            ok = unreal.GLTFExporter.export_to_gltf(asset, str(out / f"{name}.glb"), options(unreal, lod, False), set())
            report["meshes"][name] = {"asset": path, "lod": lod, "ok": bool(ok)}
        except Exception:
            report["errors"].append({"mesh": name, "traceback": traceback.format_exc()})
    for name, path in CLIPS:
        if only and name not in only:
            continue
        try:
            asset = unreal.load_asset(path)
            ok = unreal.GLTFExporter.export_to_gltf(asset, str(out / f"clip-{name}.glb"), options(unreal, 2, True), set())
            report["clips"][name] = {"asset": path, "ok": bool(ok), "length_s": asset.get_play_length()}
        except Exception:
            report["errors"].append({"clip": name, "traceback": traceback.format_exc()})
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    (out / "textures").mkdir(exist_ok=True)
    for folder in ([] if only else TEXTURE_DIRS):
        for data in reg.get_assets_by_path(folder, recursive=True):
            if str(data.asset_class_path.asset_name) != "Texture2D":
                continue
            try:
                tex = unreal.load_asset(str(data.package_name))
                task = unreal.AssetExportTask()
                task.object = tex
                task.filename = str(out / "textures" / f"{data.asset_name}.png")
                task.automated = True
                task.replace_identical = True
                task.prompt = False
                ok = unreal.Exporter.run_asset_export_task(task)
                report["textures"].append({"asset": str(data.package_name), "ok": bool(ok),
                                           "size": [tex.blueprint_get_size_x(), tex.blueprint_get_size_y()]})
            except Exception:
                report["errors"].append({"texture": str(data.package_name), "traceback": traceback.format_exc()})
    (out / ("export.json" if not only else "export-partial.json")).write_text(json.dumps(report, indent=1))
    print("NPC EXPORT DONE", len(report["meshes"]), len(report["clips"]), len(report["textures"]), len(report["errors"]))


if __name__ == "__main__":
    main()
