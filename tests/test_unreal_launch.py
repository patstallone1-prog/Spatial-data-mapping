"""Native relaunch preserves the installed world and selects Metal per process."""
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def launcher(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "tools/unreal"))
    spec = importlib.util.spec_from_file_location(
        "launch_macos", ROOT / "tools/unreal/launch_macos.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture_paths(tmp_path):
    project = tmp_path / "My project/Kerbside.uproject"
    project.parent.mkdir()
    project.write_text("{}")
    engine = tmp_path / "External drive/UE_5.8"
    binary = engine / "Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor"
    binary.parent.mkdir(parents=True)
    binary.touch()
    return project, engine, tmp_path / "External drive/run log.txt"


def test_launch_keeps_default_map_and_space_containing_paths(tmp_path, monkeypatch):
    module = launcher(monkeypatch)
    project, engine, log = fixture_paths(tmp_path)
    command = module.launch_command(project, engine, log, ["-ResX=1280"])
    assert command[1] == str(project)
    assert "-game" in command and "-abslog=" + str(log) in command
    assert command[-1] == "-ResX=1280"
    assert project.read_text() == "{}"
    assert not any("/Game/" in arg or "xcode-select" in arg for arg in command)


def test_cache_overrides_preserve_spaces_without_double_quoting(tmp_path, monkeypatch):
    module = launcher(monkeypatch)
    cache = tmp_path / "External drive/Derived data"
    assert module.cache_arguments(cache) == [f"-LocalDataCachePath={cache}",
                                           f"-ZenDataPath={cache / 'Zen'}"]


def test_missing_external_volume_cannot_fill_internal_disk(monkeypatch):
    module = launcher(monkeypatch)
    monkeypatch.setattr(Path, "is_mount", lambda _: False)
    with pytest.raises(ValueError, match="not mounted"):
        module.cache_arguments(Path("/Volumes/Unavailable Kerbside disk/cache"))


def test_missing_metal_blocks_launch(tmp_path, monkeypatch):
    module = launcher(monkeypatch)
    project, engine, log = fixture_paths(tmp_path)
    monkeypatch.setattr(module, "developer_dir", lambda _: Path("/private/sdk/Contents/Developer"))
    monkeypatch.setattr(sys, "argv", ["launch_macos.py", "--project", str(project),
                                   "--engine", str(engine), "--xcode", "/test/Xcode.app",
                                   "--log", str(log), "--cache-dir", str(tmp_path / "ddc")])
    checks, launched = [], []

    def check(command, *, env, check):
        assert check and env["DEVELOPER_DIR"] == "/private/sdk/Contents/Developer"
        checks.append(command)
        if "metal" in command:
            raise module.subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(module.subprocess, "run", check)
    monkeypatch.setattr(module.subprocess, "call", lambda *a, **kw: launched.append(a))
    with pytest.raises(module.subprocess.CalledProcessError):
        module.main()
    assert len(checks) == 2 and not launched
    assert not log.exists()


def test_check_only_never_starts_editor(tmp_path, monkeypatch):
    module = launcher(monkeypatch)
    project, engine, log = fixture_paths(tmp_path)
    monkeypatch.setattr(module, "developer_dir", lambda _: Path("/private/sdk/Contents/Developer"))
    monkeypatch.setattr(sys, "argv", ["launch_macos.py", "--project", str(project),
                                   "--engine", str(engine), "--xcode", "/test/Xcode.app",
                                   "--log", str(log), "--cache-dir", str(tmp_path / "ddc"),
                                   "--check-only"])
    monkeypatch.setattr(module.subprocess, "run", lambda *a, **kw: None)
    monkeypatch.setattr(module.subprocess, "call",
                        lambda *a, **kw: pytest.fail("unexpected launch"))
    assert module.main() == 0
