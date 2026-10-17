"""Duplicate only the managed city map, install Epic sky, preserve the original map."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import unreal

sys.path.insert(0, str(Path(__file__).resolve().parent))
from install_runtime import engine_config, managed_config


def main():
    source = os.environ.get("KERBSIDE_SKY_SOURCE", "/Game/KerbsideRuntime/Maps/City_pilot_exact_v1")
    target = os.environ.get("KERBSIDE_SKY_TARGET", "/Game/KerbsideRuntime/Maps/City_sky_20261017")
    if not all(p.startswith("/Game/KerbsideRuntime/Maps/City_") and ".." not in p for p in (source, target)):
        raise ValueError("only explicitly managed city maps may be migrated")
    if source == target or unreal.EditorAssetLibrary.does_asset_exist(target):
        raise ValueError("sky revision already exists; refusing to overwrite")
    config = Path(unreal.Paths.project_config_dir()) / "DefaultEngine.ini"
    original_config = config.read_text()
    block = engine_config(original_config)
    old_object = source + "." + source.rsplit("/", 1)[1]
    new_object = target + "." + target.rsplit("/", 1)[1]
    if f"GameDefaultMap={old_object}" not in block:
        raise ValueError("default map changed; refusing to replace an unrelated user's map")
    if not unreal.EditorAssetLibrary.duplicate_asset(source, target):
        raise RuntimeError("could not preserve/duplicate the managed source world")
    levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not levels.load_level(target):
        raise RuntimeError("cannot load dedicated sky revision")
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    old = [a for a in actors.get_all_level_actors() if isinstance(a, unreal.KerbsideSky)]
    if len(old) != 1:
        raise RuntimeError("expected one managed legacy sky; original map retained")
    sky = actors.spawn_actor_from_class(unreal.KerbsideCelestialSky, unreal.Vector(0, 0, 0))
    sky.set_actor_label("Kerbside — Epic Celestial Vault / America Los Angeles")
    sky.sync_clock()
    sky.apply_weather()
    actors.destroy_actor(old[0])
    if not levels.save_current_level():
        raise RuntimeError("failed to save dedicated sky map")
    config.write_text(managed_config(original_config, block.replace(old_object, new_object)))
    saved = Path(unreal.Paths.project_saved_dir()) / "KerbsideValidation/sky.json"
    saved.parent.mkdir(parents=True, exist_ok=True)
    saved.write_text(json.dumps({"source_preserved": source, "level": target,
                                "sky": sky.get_class().get_name(), "clock": "America/Los_Angeles",
                                "weather": "visual presets, not live observations",
                                "geometry_modified": False}, indent=2))
    unreal.log(f"Kerbside sky revision saved: {target}; original preserved: {source}")


if __name__ == "__main__":
    main()
