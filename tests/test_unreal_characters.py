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

    job.iterator, job.waiting, job.next_tick = steps(), None, 0
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
