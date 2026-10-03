"""Read-only contact audit for a separately imported native city map; no release signoff."""
from __future__ import annotations

import json
from pathlib import Path

import unreal


def main() -> None:
    path = Path(unreal.Paths.project_saved_dir()) / "KerbsideValidation/import.json"
    report = json.loads(path.read_text())
    subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if not subsystem.load_level(report["level"]):
        raise RuntimeError("Cannot load imported city")
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors()
    starts = [actor for actor in actors if isinstance(actor, unreal.PlayerStart)]
    if len(starts) != 1:
        raise RuntimeError("No unique grounded PlayerStart")
    start = starts[0].get_actor_location()
    # Begin just beneath the pawn's centre; paint is explicitly non-colliding.
    end = unreal.Vector(start.x, start.y, start.z - 2000)
    result = unreal.SystemLibrary.line_trace_single(world, start, end,
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, True, [], unreal.DrawDebugTrace.NONE, True)
    if not result[0]:
        raise RuntimeError("Imported city has no collision under player spawn")
    contact = {"level": report["level"], "spawn_has_static_floor_contact": True,
               "diagnostic_only": report.get("diagnostic_only", False),
               "validation_state": "floor trace only; graphics/walking/device acceptance still required"}
    target = path.with_name("floor-contact.json")
    target.write_text(json.dumps(contact, indent=2) + "\n")
    unreal.log(json.dumps(contact))


if __name__ == "__main__":
    main()
