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
sys.path.insert(0, str(ROOT / "src"))
from smc.world import catalogue as object_catalogue  # noqa: E402

CATALOGUE = object_catalogue.load()
REVISION = os.environ.get("KERBSIDE_WORLD_REVISION", "")
if REVISION and not re.fullmatch(r"[A-Za-z0-9_]{1,48}", REVISION):
    raise ValueError("Invalid world revision")
MAP_NAME = "City" + ("_" + REVISION if REVISION else "")
LEVEL = "/Game/KerbsideRuntime/Maps/" + MAP_NAME
CONTENT = "/Game/KerbsideRuntime/Tiles/" + MAP_NAME
PHYSICS = "/Game/KerbsideRuntime/Physics"


def archetype(surface: str) -> dict:
    """The surface's archetype in docs/object-catalogue.json; an unknown surface stops the import."""
    found = object_catalogue.archetype(surface, CATALOGUE)
    if found is None:
        raise ValueError(f"Surface {surface!r} is not in docs/object-catalogue.json; catalogue it before importing")
    return found


def blocks(surface: str) -> bool:
    """Whether the drawn mesh is solid to the walker (the catalogue's archetype stops a character).

    Paint, leaves, awnings, signs overhead, borrowed interiors and effects never create invisible
    walls; a window or facade trim is held by its wall (source "host"), not by its own pane. A
    tree's bark is solid whether the tree was measured or inferred.
    """
    a = archetype(surface)
    return "character" in a["collision"]["blocks"] and a["collision"]["source"] != "host"


def physical_material(material_id: str, cache: dict):
    """One KerbsidePhysicalMaterial per catalogue material: friction dry and wet, restitution and
    density. The sky moves its friction toward the wet value as the streets soak."""
    if material_id in cache:
        return cache[material_id]
    values = object_catalogue.physical_material(material_id, CATALOGUE)
    name = "PMK_" + re.sub(r"[^A-Za-z0-9_]", "_", material_id)
    path = f"{PHYSICS}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        asset = unreal.EditorAssetLibrary.load_asset(path)
    else:
        factory = unreal.PhysicalMaterialFactoryNew()
        factory.set_editor_property("physical_material_class", unreal.KerbsidePhysicalMaterial.static_class())
        asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            name, PHYSICS, unreal.KerbsidePhysicalMaterial, factory)
    if asset is None:
        raise RuntimeError(f"Could not create physical material {path}")
    asset.set_editor_property("catalogue_material", material_id)
    asset.set_editor_property("dry_friction", values["friction"])
    asset.set_editor_property("dry_static_friction", values["static_friction"])
    asset.set_editor_property("wet_friction", values["wet_friction"])
    asset.set_editor_property("friction", values["friction"])
    asset.set_editor_property("static_friction", values["static_friction"])
    asset.set_editor_property("restitution", values["restitution"])
    asset.set_editor_property("density", max(values["density_g_cm3"], 0.001))
    unreal.EditorAssetLibrary.save_loaded_asset(asset)
    cache[material_id] = asset
    return asset


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
    scene = actors.spawn_actor_from_class(unreal.KerbsideCelestialSky, unreal.Vector(0, 0, 0))
    scene.set_actor_label("Kerbside — Epic Celestial Vault, San Francisco live clock")
    scene.sync_clock()
    scene.apply_weather()
    meshes, colliders = 0, 0
    collision_audit = []
    physics = {}
    archetype_counts: dict = {}
    # Leaves, bark, shrubs and litter get the wind-driven foliage material; lawns get grass.
    import foliage_setup
    foliage, clump = foliage_setup.ensure_assets(Path(unreal.Paths.project_saved_dir()) / "KerbsideFoliage")
    foliage_slots, grass_clumps = 0, 0
    import weather_setup
    weather = weather_setup.ensure_assets()
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    kept_dry = 0
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
            # What it is, from the catalogue: its friction and bounce, whether it throws a shadow,
            # and tags a game reads (kerbside.archetype:..., kerbside.material:..., ...).
            kinds = [archetype(s) for s in surfaces]
            if blocking:
                component.set_phys_material_override(physical_material(kinds[0]["material"], physics))
            component.set_cast_shadow(any(k["shadow"]["casts"] for k in kinds))
            # Rain wets what is out in it: not rooms, water or glass (weather_setup.receives_wet).
            wets = any(weather_setup.receives_wet(k) for k in kinds)
            component.set_editor_property("receives_decals", wets)
            kept_dry += int(not wets)
            origin, extent = actor.get_actor_bounds(False)
            for i, (o, e) in enumerate(((origin.x, extent.x), (origin.y, extent.y), (origin.z, extent.z))):
                lo[i], hi[i] = min(lo[i], o - e), max(hi[i], o + e)
            actor.set_editor_property("tags", [unreal.Name(tag) for tag in sorted(
                {f"kerbside.{field}:{value}" for k in kinds for field, value in
                 (("archetype", k["id"]), ("material", k["material"]), ("traversal", k["traversal"]))})])
            for k in kinds:
                archetype_counts[k["id"]] = archetype_counts.get(k["id"], 0) + 1
            foliage_slots += foliage_setup.dress_component(component, surfaces, foliage)
            unreal.EditorAssetLibrary.save_loaded_asset(mesh)
            meshes += 1
            colliders += int(blocking)
        expected_triangles = sum(n for surface, n in tile["surfaces"].items() if blocks(surface))
        if fallback_triangles != expected_triangles:
            raise RuntimeError(f"Collision lost/changed source faces in {tile['file']}: "
                               f"{fallback_triangles} fallback vs {expected_triangles} exported")
        collision_audit.append({"tile": tile["file"], "exported_blocking_triangles": expected_triangles,
                                "fallback_blocking_triangles": fallback_triangles})
        grass_clumps += foliage_setup.plant_grass(actors, tile, path.parent, clump, foliage["grass"])
        if spawn is None and tile.get("spawn_gltf_m"):
            spawn = tile["spawn_gltf_m"]
    if colliders == 0 or spawn is None:
        raise RuntimeError("No world collision or supported road spawn; refusing release")
    # The wet film over everything the rain reaches, a little beyond the tiles.
    centre = unreal.Vector(*[(a + b) / 2 for a, b in zip(lo, hi, strict=True)])
    half = [(b - a) / 2 + 500 for a, b in zip(lo, hi, strict=True)]
    weather_setup.place_decals(actors, weather, centre, half)
    # Probe-calibrated actor rotation makes world X=east, Y=south, Z=up in cm.
    start = actors.spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(spawn[0] * 100, spawn[2] * 100, spawn[1] * 100 + 120))
    start.set_actor_label("Kerbside — road-grounded spawn")
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    world.get_world_settings().set_editor_property("default_game_mode", unreal.KerbsideGameMode.static_class())
    if not levels.save_current_level():
        raise RuntimeError("City save failed; default map unchanged")
    # Only make the city the default after it actually exists and collision import passed,
    # and not for a trial import (KERBSIDE_KEEP_DEFAULT_MAP=1): that is opened by its path.
    if os.environ.get("KERBSIDE_KEEP_DEFAULT_MAP") != "1":
        from install_runtime import ENGINE_CONFIG, managed_config
        config = Path(unreal.Paths.project_dir()) / "Config/DefaultEngine.ini"
        maps = ("\n[/Script/EngineSettings.GameMapsSettings]\n"
                f"GameDefaultMap={LEVEL}.{MAP_NAME}\nEditorStartupMap={LEVEL}.{MAP_NAME}\n")
        config.write_text(managed_config(config.read_text(), ENGINE_CONFIG + maps))
    report = {"schema_version": 1, "level": LEVEL, "manifest": str(path),
              "diagnostic_only": manifest.get("diagnostic_only", False),
              "diagnostic_reuse_revision": reuse,
              "renderer_sha256": manifest["renderer_sha256"], "meshes": meshes,
              "static_colliders": colliders,
              "foliage_material_slots": foliage_slots, "grass_clumps": grass_clumps, "spawn_gltf_m": spawn, "import_yaw": yaw,
              "collision_triangle_audit": collision_audit,
              "object_catalogue": {"version": CATALOGUE["version"], "physical_materials": sorted(physics),
                                   "archetype_meshes": dict(sorted(archetype_counts.items()))},
              "physics": "Chaos static triangle collision + CharacterMovement capsule; friction dry to wet with the weather",
              "weather": {"wet_decals": 2, "meshes_kept_dry": kept_dry,
                          "collection": weather_setup.MPC, "weathers": [str(n) for n in unreal.KerbsideCelestialSky.weather_names()]},
              "lighting": "Epic Celestial Vault sun/moon/clouds, SF live clock + realtime SkyLight + volumetric fog",
              "validation_state": "requires native walking/shadow/spawn acceptance; NOT release approved"}
    dest = Path(unreal.Paths.project_saved_dir()) / "KerbsideValidation/import.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(report, indent=2) + "\n")
    unreal.log(json.dumps(report))


if __name__ == "__main__":
    main()
