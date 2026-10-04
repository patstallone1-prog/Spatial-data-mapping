"""Run inside UE after compiling KerbsideWorld. Creates a separate playable city map.

KERBSIDE_TILE_MANIFEST can select a verified local export. Does not download stale
release tiles, load/replace an existing user map, or touch existing project content.
Run with UnrealEditor-Cmd <project> -run=pythonscript -script=<absolute script path>.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

import unreal

ROOT = Path(__file__).resolve().parents[2]
REVISION = os.environ.get("KERBSIDE_WORLD_REVISION", "")
if REVISION and not re.fullmatch(r"[A-Za-z0-9_]{1,48}", REVISION):
    raise ValueError("Invalid world revision")
MAP_NAME = "City" + ("_" + REVISION if REVISION else "")
LEVEL = "/Game/KerbsideRuntime/Maps/" + MAP_NAME
CONTENT = "/Game/KerbsideRuntime/Tiles/" + MAP_NAME
# Paint, windows, borrowed interiors and effects never create invisible collision walls.
BLOCKING = {"road", "tunnel_floor", "tunnel_road", "tunnel_walk", "tunnel_portal",
            "walk", "walk_narrow", "walk_underlay", "front_walk", "plaza", "service_yard",
            "kerb", "curb_ramp", "median", "divider", "building", "garage", "roof",
            "terrain", "yard", "park", "wall", "tunnel", "footprint", "tree_pit",
            "furniture:post", "furniture:bike_rack", "furniture:cylinder", "bench"}


def blocks(surface: str) -> bool:
    name = surface.split("|")[0]
    return name in BLOCKING or name.startswith("fence:")


def canonical_surface(slot: str, available: dict) -> str:
    if slot in available:
        return slot
    # Unreal may append a duplicate-name counter. Do not treat arbitrary unknown
    # material slots as non-colliding: that can silently erase building collision.
    candidates = []
    for name in available:
        # Observed UE 5.8 material slots replace ':' with '_'; asset names can
        # remove punctuation. Duplicate materials also receive bare numeric counters.
        aliases = {name, re.sub(r"[^A-Za-z0-9_]", "_", name), re.sub(r"[^A-Za-z0-9_]", "", name)}
        if any(slot == alias or any(slot.startswith(alias + separator)
               and slot[len(alias + separator):].isdigit() for separator in ("_", ".", ""))
               for alias in aliases):
            candidates.append(name)
    if len(candidates) == 1:
        return candidates[0]
    raise ValueError(f"Unmapped imported surface {slot!r}; inspect Interchange output")


def conversion_from_probe(center: tuple, extent: tuple) -> tuple:
    """A metre-space probe's centre (10,20,30), half-extents (.5,1,1.5).

    Detect installed Interchange basis/signs and centimetre scaling. Never guess the
    translator's orientation. Its east and up axes must be orthogonal/vertical.
    """
    basis = [[0.0, 0.0, 0.0] for _ in range(3)]
    used = set()
    for world_axis in range(3):
        candidates = [i for i, size in enumerate((50, 100, 150)) if abs(extent[world_axis] - size) < .1]
        if len(candidates) != 1 or candidates[0] in used:
            raise ValueError("Interchange axis probe has unexpected units or rotated/recentred geometry")
        source_axis = candidates[0]
        expected = (1000, 2000, 3000)[source_axis]
        if abs(abs(center[world_axis]) - expected) > .1:
            raise ValueError("Interchange axis probe was recentred/scaled")
        basis[source_axis][world_axis] = math.copysign(1.0, center[world_axis])
        used.add(source_axis)
    if basis[1] != [0, 0, 1]:
        raise ValueError("glTF up must become Unreal +Z")
    yaw = -math.degrees(math.atan2(basis[0][1], basis[0][0]))
    angle = math.radians(yaw)
    south = (basis[2][0] * math.cos(angle) - basis[2][1] * math.sin(angle),
             basis[2][0] * math.sin(angle) + basis[2][1] * math.cos(angle))
    if abs(south[0]) > 1e-6 or abs(south[1] - 1) > 1e-6:
        raise ValueError("Unexpected handedness; cannot align east/south/up with a rigid yaw")
    return tuple(tuple(b) for b in basis), yaw


def import_probe() -> float:
    # A generated calibration fixture is not part of the world and is never placed.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from axis_probe import write_probe
    probe = Path(unreal.Paths.project_saved_dir()) / "KerbsideValidation/axis-probe.glb"
    write_probe(probe)
    folder = "/Game/KerbsideRuntime/Calibration"
    task = unreal.AssetImportTask()
    task.filename = str(probe)
    task.destination_path = folder
    task.automated = True
    task.replace_existing = True
    task.save = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    meshes = [unreal.EditorAssetLibrary.load_asset(p) for p in unreal.EditorAssetLibrary.list_assets(folder)]
    meshes = [m for m in meshes if isinstance(m, unreal.StaticMesh)]
    if len(meshes) != 1:
        raise RuntimeError("Axis calibration imported no unique mesh")
    bounds = meshes[0].get_bounds()
    center = tuple(getattr(bounds.origin, a) for a in ("x", "y", "z"))
    extent = tuple(getattr(bounds.box_extent, a) for a in ("x", "y", "z"))
    _, yaw = conversion_from_probe(center, extent)
    return yaw


def validate_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text())
    if manifest.get("schema_version") != 2 or not manifest.get("renderer_sha256"):
        raise ValueError("Re-export using current exporter; old unversioned tiles rejected")
    if "degenerate_dropped" not in manifest or manifest.get("geometry_contract", "active-nondegenerate-v1") != "active-nondegenerate-v1":
        raise ValueError("Re-export active nondegenerate geometry; legacy buffer exports rejected")
    if not manifest.get("tiles"):
        raise ValueError("No tiles; refusing an empty city")
    for tile in manifest["tiles"]:
        asset = (path.parent / tile["file"]).resolve()
        if not asset.is_relative_to(path.parent.resolve()):
            raise ValueError("Tile path escapes export directory")
        if asset.stat().st_size != tile["bytes"] or hashlib.sha256(asset.read_bytes()).hexdigest() != tile["sha256"]:
            raise ValueError(f"Stale/corrupt tile: {asset}")
    return manifest


def main() -> None:
    path = Path(os.environ.get("KERBSIDE_TILE_MANIFEST", str(ROOT / "build/unreal-pilot/manifest.json"))).resolve()
    manifest = validate_manifest(path)
    reuse = os.environ.get("KERBSIDE_REUSE_IMPORTED_REVISION", "")
    if reuse and (not re.fullmatch(r"[A-Za-z0-9_]{1,48}", reuse) or not manifest.get("diagnostic_only")):
        raise ValueError("Imported asset reuse is only allowed for explicit diagnostic revisions")
    region = manifest.get("region", "sf-corridor")
    page = ROOT / "docs" / "app-model.html" if region == "sf-corridor" else ROOT / "docs/app-regions" / region / "app-model.html"
    if hashlib.sha256(page.read_bytes()).hexdigest() != manifest["renderer_sha256"]:
        raise ValueError("Renderer changed after tile export; re-export before importing")
    if unreal.EditorAssetLibrary.does_asset_exist(LEVEL):
        raise RuntimeError(f"{LEVEL} exists; refusing to replace a saved map. Use a new revision path.")
    yaw = import_probe()
    # All failures before this point are non-mutating. The user's currently open world
    # is untouched when this script runs in a separate commandlet process.
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not levels.new_level(LEVEL):
        raise RuntimeError("Could not create dedicated Kerbside map")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    scene = actors.spawn_actor_from_class(unreal.KerbsideSky, unreal.Vector(0, 0, 0))
    scene.set_actor_label("Kerbside — physical sky and sun")
    scene.update_daylight()
    meshes, colliders = 0, 0
    collision_audit = []
    spawn = None
    for tile in manifest["tiles"]:
        base = f"/Game/KerbsideRuntime/Tiles/City_{reuse}" if reuse else CONTENT
        folder = f"{base}/tile_{tile['ix']}_{tile['iz']}"
        source = (path.parent / tile["file"]).resolve()
        if not reuse:
            task = unreal.AssetImportTask()
            task.filename = str(source)
            task.destination_path = folder
            task.automated = True
            task.replace_existing = False
            task.save = True
            unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        imported = []
        for asset_path in unreal.EditorAssetLibrary.list_assets(folder, recursive=True):
            asset = unreal.EditorAssetLibrary.load_asset(asset_path)
            if isinstance(asset, unreal.StaticMesh):
                if reuse:
                    data = asset.get_editor_property("asset_import_data")
                    if not data or [Path(p).resolve() for p in data.extract_filenames()] != [source]:
                        raise RuntimeError(f"Diagnostic reuse source mismatch: {asset_path}")
                imported.append(asset)
        if not imported:
            raise RuntimeError(f"Interchange imported no meshes for {tile['file']}")
        fallback_triangles = 0
        for mesh in imported:
            slots = mesh.get_editor_property("static_materials")
            surfaces = [canonical_surface(str(s.material_slot_name).split("|")[0], tile["surfaces"]) for s in slots]
            # Importer should preserve per-surface mesh nodes; mixed semantic meshes
            # cannot be assigned a collision policy without a separate collision export.
            policies = {blocks(surface) for surface in surfaces}
            if len(policies) != 1:
                raise RuntimeError(f"Mixed/unknown collision policy in {mesh.get_name()}: {surfaces}")
            blocking = True in policies
            if not unreal.KerbsideWorldLibrary.configure_world_mesh(mesh, blocking):
                raise RuntimeError(f"Collision setup failed for {mesh.get_name()}")
            if blocking:
                fallback_triangles += mesh.get_num_triangles(0)
            # Asset actor factories are not guaranteed to be available in commandlets.
            actor = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 0))
            if actor is None:
                raise RuntimeError(f"Could not spawn static city actor for {mesh.get_name()}")
            actor.set_actor_rotation(unreal.Rotator(pitch=0, yaw=yaw, roll=0), False)
            actor.set_actor_label(f"Kerbside {tile['ix']},{tile['iz']} — {mesh.get_name()}")
            actor.set_folder_path("Kerbside/City")
            component = actor.get_component_by_class(unreal.StaticMeshComponent)
            if not component.set_static_mesh(mesh):
                raise RuntimeError(f"Could not attach city mesh {mesh.get_name()}")
            component.set_collision_profile_name("BlockAll" if blocking else "NoCollision")
            component.set_simulate_physics(False)
            component.set_cast_shadow(not all(s in {"marking", "crossing"} for s in surfaces))
            unreal.EditorAssetLibrary.save_loaded_asset(mesh)
            meshes += 1
            colliders += int(blocking)
        expected_triangles = sum(n for surface, n in tile["surfaces"].items() if blocks(surface))
        if fallback_triangles != expected_triangles:
            raise RuntimeError(f"Collision lost/changed source faces in {tile['file']}: "
                               f"{fallback_triangles} fallback vs {expected_triangles} exported")
        collision_audit.append({"tile": tile["file"], "exported_blocking_triangles": expected_triangles,
                                "fallback_blocking_triangles": fallback_triangles})
        if spawn is None and tile.get("spawn_gltf_m"):
            spawn = tile["spawn_gltf_m"]
    if colliders == 0 or spawn is None:
        raise RuntimeError("No world collision or supported road spawn; refusing release")
    # Probe-calibrated actor rotation makes world X=east, Y=south, Z=up in cm.
    start = actors.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(spawn[0] * 100, spawn[2] * 100, spawn[1] * 100 + 120))
    start.set_actor_label("Kerbside — road-grounded spawn")
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    world.get_world_settings().set_editor_property("default_game_mode", unreal.KerbsideGameMode.static_class())
    if not levels.save_current_level():
        raise RuntimeError("City save failed; default map unchanged")
    # Only make the city the default after it actually exists and collision import passed.
    from install_runtime import ENGINE_CONFIG, managed_config
    config = Path(unreal.Paths.project_dir()) / "Config/DefaultEngine.ini"
    maps = ("\n[/Script/EngineSettings.GameMapsSettings]\n"
            f"GameDefaultMap={LEVEL}.{MAP_NAME}\nEditorStartupMap={LEVEL}.{MAP_NAME}\n")
    config.write_text(managed_config(config.read_text(), ENGINE_CONFIG + maps))
    report = {"schema_version": 1, "level": LEVEL, "manifest": str(path),
              "diagnostic_only": manifest.get("diagnostic_only", False),
              "diagnostic_reuse_revision": reuse,
              "renderer_sha256": manifest["renderer_sha256"], "meshes": meshes,
              "static_colliders": colliders, "spawn_gltf_m": spawn, "import_yaw": yaw,
              "collision_triangle_audit": collision_audit,
              "physics": "Chaos static triangle collision + CharacterMovement capsule",
              "lighting": "SkyAtmosphere + atmospheric DirectionalLight + realtime SkyLight + volumetric fog",
              "validation_state": "requires native walking/shadow/spawn acceptance; NOT release approved"}
    dest = Path(unreal.Paths.project_saved_dir()) / "KerbsideValidation/import.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(report, indent=2) + "\n")
    unreal.log(json.dumps(report))


if __name__ == "__main__":
    main()
