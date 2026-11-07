"""MetaHuman discovery cannot silently substitute a broken or incomplete roster."""

import importlib.util
import json
import sys
import types
from pathlib import Path
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load(name, monkeypatch, unreal=None):
    monkeypatch.setitem(sys.modules, "unreal", unreal or types.SimpleNamespace())
    spec = importlib.util.spec_from_file_location(name, ROOT / f"tools/unreal/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_legacy_ada_and_new_presets_are_discovered_once_only_when_classes_load(monkeypatch):
    assets = {
        "/Game/Characters/MetaHumans/Unpacked/Ada/BP_Ada": True,
        "/Game/Characters/MetaHumans/Built/Bo/BP_Bo": True,
        "/Game/Characters/MetaHumans/Built/Celeste/BP_Celeste": False,
    }
    library = types.SimpleNamespace(
        does_asset_exist=lambda path: path in assets, load_blueprint_class=lambda path: assets[path]
    )
    unreal = types.SimpleNamespace(EditorAssetLibrary=library)
    module = load("characters_setup", monkeypatch, unreal)
    entries = module.built_metahumans()
    assert [name for name, _ in entries] == ["Ada", "Bo"]
    assert entries[0][1].endswith("Unpacked/Ada/BP_Ada.BP_Ada_C")
    monkeypatch.setenv("KERBSIDE_REQUIRE_METAHUMANS", "1")
    with pytest.raises(RuntimeError, match="MetaHuman roster incomplete"):
        module.roster()


@pytest.mark.parametrize("value", ["", "../Ada", "Bo,Bo", "Bo,unknown"])
def test_acquisition_rejects_unknown_or_duplicate_presets(monkeypatch, value):
    module = load("metahuman_presets", monkeypatch)
    with pytest.raises(ValueError):
        module.selected_names(value)


def test_auth_wait_returns_to_editor_frames_and_times_out_without_advancing(monkeypatch, tmp_path):
    module = load("metahuman_presets", monkeypatch)
    clock = [10.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    job = module.Acquisition.__new__(module.Acquisition)
    job.names, job.name = ["Bo"], "Bo"
    job.report, job.state = tmp_path / "report.json", {"presets": {"Bo": {"error": "old error"}}}
    job.ue = types.SimpleNamespace(log=Mock(), log_error=Mock())
    job.finish = Mock()
    ready = [False]

    def steps():
        yield lambda: ready[0]
        pytest.fail("Pending authentication must not advance to textures or assembly")

    job.iterator, job.waiting, job.next_tick, job.running = steps(), None, 0, False
    job.tick(0)
    clock[0] += 2
    job.tick(0)
    job.finish.assert_not_called()
    clock[0] += 1201
    job.tick(0)
    job.finish.assert_called_once()
    row = json.loads(job.report.read_text())["presets"]["Bo"]
    assert row["stage"] == "failed" and "timed out" in row["error"]
    job.record("Bo", "ready", verified_class="BP_Bo_C")
    assert "error" not in json.loads(job.report.read_text())["presets"]["Bo"]


def test_epic_asset_load_pumping_slate_cannot_reenter_acquisition(monkeypatch):
    module = load("metahuman_presets", monkeypatch)
    clock = [10.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    job = module.Acquisition.__new__(module.Acquisition)
    job.finish = Mock()
    job.record = Mock()
    job.waiting, job.next_tick, job.running = None, 0, False
    advanced = []

    def steps():
        advanced.append("open preset")
        clock[0] += 10  # Asset loading lasts longer than the callback interval.
        job.tick(0)  # Epic pumps Slate while the generator is inside asset loading.
        advanced.append("request rig")
        yield lambda: False

    job.iterator = steps()
    job.tick(0)
    assert advanced == ["open preset", "request rig"]
    assert job.waiting and not job.running
    job.record.assert_not_called()
    job.finish.assert_not_called()


def test_batch_launcher_uses_gpu_editor_external_cache_and_safe_single_compilation(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "tools/unreal"))
    batch = load("batch_metahumans", monkeypatch)
    args = batch.editor_command(
        Path("/external/UE"),
        Path("/project/Kerbside.uproject"),
        Path("/tools/metahuman_presets.py"),
        Path("/external/log"),
        Path("/external/cache"),
    )
    assert "/Engine/Maps/Entry" in args
    assert not any(a in {"-game", "-NullRHI"} or a.startswith("-ExecutePythonScript") for a in args)
    assert "-LocalDataCachePath=/external/cache" in args
    assert "-ZenDataPath=/external/cache/Zen" in args
    assert "-asyncgroomcompilationmaxconcurrency=1" in args


def test_batch_refuses_unmounted_volume_before_any_editor_launch(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(ROOT / "tools/unreal"))
    batch = load("batch_metahumans", monkeypatch)
    with pytest.raises(RuntimeError, match="not mounted"):
        batch.check_storage(tmp_path / "Kerbside.uproject", tmp_path)


def test_texture_flag_is_not_completion_until_native_requests_unwind(monkeypatch, tmp_path):
    module = load("metahuman_presets", monkeypatch)
    monkeypatch.setattr(
        module.shutil, "disk_usage", lambda path: types.SimpleNamespace(free=100 * 1024**3)
    )
    flags = {"has_face_dna_blendshapes": True, "has_high_resolution_textures": False}
    character = types.SimpleNamespace(get_editor_property=lambda key: flags[key])
    busy = [True]
    library = types.SimpleNamespace(
        does_asset_exist=Mock(return_value=True),
        load_asset=Mock(return_value=character),
        save_loaded_asset=Mock(return_value=True),
    )
    subsystem = types.SimpleNamespace(
        try_add_object_to_edit=Mock(return_value=True),
        request_texture_sources=Mock(
            side_effect=lambda *_: flags.update(has_high_resolution_textures=True)
        ),
        can_build_meta_human=Mock(side_effect=lambda *_: not busy[0]),
        build_meta_human=Mock(),
        is_object_added_for_editing=Mock(return_value=True),
        remove_object_to_edit=Mock(),
    )
    ue = types.SimpleNamespace(
        Paths=types.SimpleNamespace(
            project_content_dir=lambda: str(tmp_path), project_saved_dir=lambda: str(tmp_path)
        ),
        AssetRegistryHelpers=types.SimpleNamespace(get_asset_registry=Mock(return_value=Mock())),
        SystemLibrary=Mock(),
        EditorAssetLibrary=library,
        log=Mock(),
        MetaHumanCharacterTextureRequestParams=Mock,
        MetaHumanCharacterEditorBuildParameters=Mock,
        MetaHumanDefaultPipelineType=types.SimpleNamespace(OPTIMIZED="optimized"),
        MetaHumanQualityLevel=types.SimpleNamespace(HIGH="high"),
    )
    job = module.Acquisition.__new__(module.Acquisition)
    job.ue, job.names, job.subsystem, job.character = ue, ["Bo"], subsystem, None
    job.report, job.state = tmp_path / "report.json", {"presets": {}}
    job.blueprint = Mock(
        side_effect=[
            ("/BP_Bo", None),
            ("/BP_Bo", types.SimpleNamespace(get_path_name=lambda: "/BP_Bo_C")),
        ]
    )
    steps = job.steps()
    texture_flag = next(steps)
    assert texture_flag() is True
    native_gate = next(steps)
    assert native_gate() is False
    assert job.state["presets"]["Bo"]["stage"] == "wait_for_assembly_ready"
    library.save_loaded_asset.assert_not_called()
    subsystem.build_meta_human.assert_not_called()
    subsystem.remove_object_to_edit.assert_not_called()
    busy[0] = False
    assert native_gate() is True
    with pytest.raises(StopIteration):
        next(steps)
    subsystem.build_meta_human.assert_called_once()
    subsystem.remove_object_to_edit.assert_called_once()
    assert job.state["presets"]["Bo"]["stage"] == "ready"


def test_failed_pending_request_keeps_character_and_editor_alive(monkeypatch, tmp_path):
    module = load("metahuman_presets", monkeypatch)
    job = module.Acquisition.__new__(module.Acquisition)
    job.ue = types.SimpleNamespace(
        unregister_slate_post_tick_callback=Mock(), SystemLibrary=Mock(), log_warning=Mock()
    )
    job.subsystem = types.SimpleNamespace(
        is_object_added_for_editing=Mock(return_value=True),
        can_build_meta_human=Mock(return_value=False),
    )
    job.character, job.handle, job.name, job.names = object(), 123, "Bo", ["Bo"]
    job.report, job.state = (
        tmp_path / "report.json",
        {"presets": {"Bo": dict(stage="failed", error="timeout")}},
    )
    job.release = Mock()
    monkeypatch.setenv("KERBSIDE_MH_QUIT", "1")
    job.finish()
    job.release.assert_not_called()
    job.ue.SystemLibrary.quit_editor.assert_not_called()
    assert job.state["presets"]["Bo"]["editor_retained_for_pending_requests"] is True
