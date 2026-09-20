"""Import the exported corridor tiles into this Unreal project. Runs inside the editor.

    Unreal Editor > Tools > Execute Python Script > this file
    (or: UnrealEditor-Cmd Kerbside.uproject -run=pythonscript -script=".../import_tiles.py")

Reads build/unreal/manifest.json from the repository (tools/unreal/export_tiles.mjs writes
it), imports every tile's .glb through Interchange as a static mesh under
/Game/Kerbside/Tiles, places each at its metres-east / metres-north position in the
Corridor level (World Partition streams them), and assigns materials by the surface name the
exporter left on every mesh section -- see MATERIALS below and Content/Kerbside/Materials.

Needs the Python Editor Script Plugin enabled (it is, in the .uproject). Unreal is z-up in
centimetres and the glTF is y-up in metres; the importer converts, so a tile's origin is
its south-west corner at (x0 * 100, -z0 * 100, 0) in Unreal's frame.
"""

import json
import os

import unreal

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
MANIFEST = os.path.join(ROOT, "build", "unreal", "manifest.json")
CONTENT_ROOT = "/Game/Kerbside/Tiles"
LEVEL = "/Game/Kerbside/Maps/Corridor"

#: Surface name (from the exporter) -> material asset. Anything not listed keeps the vertex
#: colour on a plain material. Make these in the editor once (Content/Kerbside/Materials)
#: and the tiles pick them up on the next import; the names are the page's own.
MATERIALS = {
    "road": "/Game/Kerbside/Materials/M_Asphalt",
    "tunnel_floor": "/Game/Kerbside/Materials/M_Asphalt",
    "walk": "/Game/Kerbside/Materials/M_SidewalkConcrete",
    "walk_narrow": "/Game/Kerbside/Materials/M_SidewalkConcrete",
    "walk_underlay": "/Game/Kerbside/Materials/M_SidewalkConcrete",
    "kerb": "/Game/Kerbside/Materials/M_KerbConcrete",
    "crossing": "/Game/Kerbside/Materials/M_CrossingPaint",
    "marking": "/Game/Kerbside/Materials/M_LanePaint",
    "building": "/Game/Kerbside/Materials/M_FacadeVertexColour",
    "roof": "/Game/Kerbside/Materials/M_Roof",
    "terrain": "/Game/Kerbside/Materials/M_Ground",
    "yard": "/Game/Kerbside/Materials/M_Grass",
    "park": "/Game/Kerbside/Materials/M_Grass",
    "wall": "/Game/Kerbside/Materials/M_StoneWall",
    "tunnel": "/Game/Kerbside/Materials/M_TunnelLining",
}


def import_tile(tile: dict) -> unreal.StaticMesh | None:
    path = os.path.join(ROOT, "build", "unreal", tile["file"])
    name = os.path.splitext(os.path.basename(path))[0]
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = CONTENT_ROOT
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    asset = unreal.EditorAssetLibrary.load_asset(f"{CONTENT_ROOT}/{name}")
    if asset is None:
        unreal.log_warning(f"{name}: import produced no static mesh")
        return None
    if isinstance(asset, unreal.StaticMesh):
        for i in range(asset.get_num_sections(0)):
            slot = asset.get_material(i)
            surface = str(asset.static_materials[i].material_slot_name) if i < len(asset.static_materials) else ""
            material_path = MATERIALS.get(surface.split("|")[0])
            if material_path and unreal.EditorAssetLibrary.does_asset_exist(material_path):
                asset.set_material(i, unreal.EditorAssetLibrary.load_asset(material_path))
        # Nanite for the heavy tiles; the corridor is a few million triangles per square km.
        settings = asset.get_editor_property("nanite_settings")
        settings.enabled = True
        asset.set_editor_property("nanite_settings", settings)
        unreal.EditorAssetLibrary.save_loaded_asset(asset)
    return asset


def place(tile: dict, asset: unreal.StaticMesh) -> None:
    # Unreal: x east, y south (left-handed), z up, centimetres. The glTF tile's local origin
    # is the world origin, so the actor sits at the origin and the mesh carries its position.
    actor = unreal.EditorLevelLibrary.spawn_actor_from_object(asset, unreal.Vector(0, 0, 0))
    actor.set_actor_label(f"tile_{tile['ix']}_{tile['iz']}")
    actor.set_folder_path("Corridor/Tiles")
    actor.set_mobility(unreal.ComponentMobility.STATIC)


def main() -> None:
    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)
    unreal.log(f"importing {len(manifest['tiles'])} tiles from {MANIFEST}")
    if not unreal.EditorAssetLibrary.does_asset_exist(LEVEL):
        unreal.EditorLevelLibrary.new_level(LEVEL)
    unreal.EditorLevelLibrary.load_level(LEVEL)
    done = 0
    with unreal.ScopedSlowTask(len(manifest["tiles"]), "Importing corridor tiles") as task:
        task.make_dialog(True)
        for tile in manifest["tiles"]:
            if task.should_cancel():
                break
            task.enter_progress_frame(1, tile["file"])
            asset = import_tile(tile)
            if asset is not None:
                place(tile, asset)
                done += 1
    unreal.EditorLevelLibrary.save_current_level()
    unreal.log(f"placed {done} tiles in {LEVEL}")


if __name__ == "__main__":
    main()
