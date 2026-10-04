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
    unreal.log(f"Native floor probe start: {start}")
    for actor in actors:
        component = actor.get_component_by_class(unreal.StaticMeshComponent)
        if not component:
            continue
        mesh = component.get_editor_property("static_mesh")
        # These getters wait on async mesh compilation. A trace issued immediately
        # after loading can otherwise run before collision meshes are ready.
        if (mesh and component.get_collision_enabled() != unreal.CollisionEnabled.NO_COLLISION
                and (mesh.get_num_vertices(0) <= 0 or mesh.get_num_triangles(0) <= 0)):
            raise RuntimeError(f"Collider has no usable fallback geometry: {mesh.get_name()}")
        if mesh and component.get_collision_enabled() != unreal.CollisionEnabled.NO_COLLISION:
            settings = mesh.get_editor_property("nanite_settings")
            if (settings.get_editor_property("enabled")
                    and (settings.get_editor_property("fallback_target") != unreal.NaniteFallbackTarget.PERCENT_TRIANGLES
                         or settings.get_editor_property("generate_fallback") != unreal.NaniteGenerateFallback.ENABLED
                         or settings.get_editor_property("fallback_percent_triangles") != 1
                         or settings.get_editor_property("fallback_relative_error") != 0
                         or settings.get_editor_property("keep_percent_triangles") != 1
                         or settings.get_editor_property("trim_relative_error") != 0)):
                raise RuntimeError(f"Collider has reduced/automatic Nanite fallback: {mesh.get_name()}")
        if mesh and mesh.get_name() in {"road", "walk", "terrain"}:
            unreal.log(f"Contact mesh {mesh.get_name()}: vertices={mesh.get_num_vertices(0)}, triangles={mesh.get_num_triangles(0)}, collision={component.get_collision_enabled()}, profile={component.get_collision_profile_name()}")
    # Begin just beneath the pawn's centre; paint is explicitly non-colliding.
    end = unreal.Vector(start.x, start.y, start.z - 2000)
    result = unreal.SystemLibrary.line_trace_single(world, start, end,
        unreal.TraceTypeQuery.ECC_VISIBILITY, True, [], unreal.DrawDebugTrace.NONE, True)
    # UE Python can map a bool + single out-struct to Optional[HitResult].
    hit = bool(result[0]) if isinstance(result, tuple) else result is not None
    if not hit:
        raise RuntimeError("Imported city has no collision under player spawn")
    contact = {"level": report["level"], "spawn_has_static_floor_contact": True,
               "diagnostic_only": report.get("diagnostic_only", False),
               "nanite_collision_reduction_disabled": True,
               "validation_state": "floor trace only; graphics/walking/device acceptance still required"}
    target = path.with_name("floor-contact.json")
    target.write_text(json.dumps(contact, indent=2) + "\n")
    unreal.log(json.dumps(contact))


if __name__ == "__main__":
    main()
