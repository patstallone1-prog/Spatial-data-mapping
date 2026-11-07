"""Acquire Epic presets in the UE 5.8 editor, allowing authentication UI to tick.

Launch with ``-ExecCmds="py /absolute/path/metahuman_presets.py"``. Run one
preset per editor process on memory constrained hosts. See metahuman-presets.md.
"""

from __future__ import annotations

import json
import os
import shutil
import time
import traceback
from pathlib import Path

NAMES = ("Bo", "Celeste", "Isaiah", "Jorge", "Lani", "Omari", "Sunita", "Trey", "Vivian")
ROOT = "/Game/Characters/MetaHumans"


def selected_names(value: str) -> list[str]:
    names = value.split(",")
    if not names or any(name not in NAMES for name in names) or len(set(names)) != len(names):
        raise ValueError("Choose distinct Epic presets from: " + ", ".join(NAMES))
    return names


def write_report(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2))
    temporary.replace(path)


class Acquisition:
    """Advance cloud requests between editor frames, never block Epic's login UI."""

    def __init__(self, unreal):
        self.ue = unreal
        self.names = selected_names(os.environ.get("KERBSIDE_MH_PRESETS", ",".join(NAMES)))
        self.report = Path(
            os.environ.get(
                "KERBSIDE_MH_REPORT",
                str(Path(unreal.Paths.project_saved_dir()) / "KerbsideValidation/metahumans.json"),
            )
        )
        self.state = (
            json.loads(self.report.read_text()) if self.report.exists() else {"presets": {}}
        )
        self.character = None
        self.subsystem = unreal.get_editor_subsystem(unreal.MetaHumanCharacterEditorSubsystem)
        self.iterator = self.steps()
        self.waiting = None
        self.handle = None
        self.running = False
        self.next_tick = time.monotonic() + 2

    def record(self, name, stage, **fields):
        # New attempts must not retain an old failure next to a successful result.
        row = self.state["presets"].setdefault(name, {})
        for key in ("error", "traceback", "editor_retained_for_pending_requests"):
            row.pop(key, None)
        row.update(stage=stage, at=time.time(), **fields)
        write_report(self.report, self.state)
        self.ue.log(f"KERBSIDE_METAHUMAN {name} {stage}")

    def blueprint(self, name):
        path = f"{ROOT}/Built/{name}/BP_{name}"
        library = self.ue.EditorAssetLibrary
        return path, library.load_blueprint_class(path) if library.does_asset_exist(path) else None

    def steps(self):
        ue = self.ue
        content = (Path(ue.Paths.project_content_dir()) / "Characters").resolve()
        saved = Path(ue.Paths.project_saved_dir()).resolve()
        if shutil.disk_usage(content).free < 12 * 1024**3:
            raise RuntimeError("Character content volume needs 12 GiB reserve")
        if shutil.disk_usage(saved).free < 12 * 1024**3:
            raise RuntimeError("Saved staging volume needs 12 GiB reserve; relocate Saved first")
        registry = ue.AssetRegistryHelpers.get_asset_registry()
        registry.scan_paths_synchronous([ROOT], True)
        registry.wait_for_completion()
        ue.SystemLibrary.execute_console_command(
            None, "Editor.AsyncAssetCompilationMaxMemoryUsage 2"
        )
        for name in self.names:
            self.name = name
            path, cls = self.blueprint(name)
            if cls:
                self.record(name, "ready", blueprint=path, verified_class=cls.get_path_name())
                continue
            if os.environ.get("KERBSIDE_MH_VERIFY_ONLY") == "1":
                raise RuntimeError(f"Runtime Blueprint cannot reload: {path}")
            self.record(name, "copy_preset")
            asset = f"{ROOT}/{name}"
            lib = ue.EditorAssetLibrary
            self.character = (
                lib.load_asset(asset)
                if lib.does_asset_exist(asset)
                else lib.duplicate_asset(f"/MetaHumanCharacter/Optional/Presets/{name}", asset)
            )
            if not self.character or not self.subsystem.try_add_object_to_edit(self.character):
                raise RuntimeError("Cannot open Epic preset for editing: " + name)
            character = self.character
            if not character.get_editor_property("has_face_dna_blendshapes"):
                self.record(name, "download_rig")
                params = ue.MetaHumanCharacterAutoRiggingRequestParams()
                params.set_editor_properties(
                    {
                        "blocking": False,
                        "report_progress": True,
                        "rig_type": ue.MetaHumanRigType.JOINTS_AND_BLEND_SHAPES,
                    }
                )
                self.subsystem.request_auto_rigging(character, params)
                yield lambda character=character: character.get_editor_property(
                    "has_face_dna_blendshapes"
                )
            refresh = name in os.environ.get("KERBSIDE_MH_REFRESH_TEXTURES", "").split(",")
            if refresh or not character.get_editor_property("has_high_resolution_textures"):
                self.record(name, "download_textures")
                params = ue.MetaHumanCharacterTextureRequestParams()
                params.set_editor_properties({"blocking": False, "report_progress": True})
                self.subsystem.request_texture_sources(character, params)
                yield lambda character=character: character.get_editor_property(
                    "has_high_resolution_textures"
                )
            # The property can become true inside a face/body texture callback, before
            # its native request has unwound. CanBuildMetaHuman also checks both cloud
            # request queues and rigging state. Keep the editor object registered until
            # that authoritative gate passes, including across re-entrant Slate frames.
            self.record(name, "wait_for_assembly_ready")
            yield lambda character=character: self.subsystem.can_build_meta_human(character, False)
            if not lib.save_loaded_asset(character):
                raise RuntimeError("Character save failed; inspect Saved staging volume")
            if not self.subsystem.can_build_meta_human(character, False):
                yield lambda character=character: self.subsystem.can_build_meta_human(
                    character, False
                )
            # Autorig/texture generation can leave large unreferenced transient meshes.
            # Drain them only after cloud callbacks settled, with the character still
            # registered. This changes neither source resolution nor runtime quality.
            ue.SystemLibrary.collect_garbage()
            self.record(name, "assemble")
            params = ue.MetaHumanCharacterEditorBuildParameters()
            params.set_editor_properties(
                {
                    "pipeline_type": ue.MetaHumanDefaultPipelineType.OPTIMIZED,
                    "pipeline_quality": ue.MetaHumanQualityLevel.HIGH,
                    "absolute_build_path": ROOT + "/Built",
                    "name_override": name,
                }
            )
            self.subsystem.build_meta_human(character, params)
            path, cls = self.blueprint(name)
            if not cls:
                raise RuntimeError("Assembly did not produce a valid Blueprint: " + path)
            if not lib.save_loaded_asset(character):
                raise RuntimeError("Post-assembly character save failed")
            self.release()
            self.record(
                name,
                "ready",
                blueprint=path,
                verified_class=cls.get_path_name(),
                high_resolution_textures=True,
                face_blendshapes=True,
            )
        self.state["finished_at"] = time.time()
        self.state["ready"] = sum(
            row.get("stage") == "ready" for row in self.state["presets"].values()
        )
        write_report(self.report, self.state)

    def release(self):
        if self.character and self.subsystem.is_object_added_for_editing(self.character):
            self.subsystem.remove_object_to_edit(self.character)
        self.character = None
        self.ue.SystemLibrary.collect_garbage()

    def finish(self):
        if self.handle is not None:
            self.ue.unregister_slate_post_tick_callback(self.handle)
            self.handle = None
        if (
            self.character
            and self.subsystem.is_object_added_for_editing(self.character)
            and not self.subsystem.can_build_meta_human(self.character, False)
        ):
            # Never tear down CharacterDataMap while Epic still owns cloud callbacks.
            # A timed-out/error phase remains inspectable in the editor; the batch driver
            # stops instead of opening another editor or counting an incomplete asset.
            row = self.state["presets"].setdefault(getattr(self, "name", self.names[0]), {})
            row["editor_retained_for_pending_requests"] = True
            write_report(self.report, self.state)
            self.ue.log_warning("MetaHuman editor retained: requests may still be completing")
            return
        self.release()
        if os.environ.get("KERBSIDE_MH_QUIT") == "1":
            self.ue.SystemLibrary.quit_editor()

    def tick(self, _delta):
        # Loading/compiling Epic assets pumps Slate recursively on this same thread.
        # A nested callback must never advance the generator already executing here.
        if self.running or time.monotonic() < self.next_tick:
            return
        self.running = True
        self.next_tick = time.monotonic() + 1
        try:
            if self.waiting:
                condition, deadline = self.waiting
                if not condition():
                    if time.monotonic() > deadline:
                        raise TimeoutError(
                            "Epic request timed out; inspect authentication/service messages"
                        )
                    return
                self.waiting = None
            condition = next(self.iterator)
            self.waiting = (condition, time.monotonic() + 1200)
        except StopIteration:
            self.finish()
        except Exception as error:
            self.record(
                getattr(self, "name", self.names[0]),
                "failed",
                error=str(error),
                traceback=traceback.format_exc(),
            )
            self.ue.log_error(str(error))
            self.finish()
        finally:
            self.running = False


if __name__ == "__main__":
    import unreal

    acquisition = Acquisition(unreal)
    acquisition.handle = unreal.register_slate_post_tick_callback(acquisition.tick)
