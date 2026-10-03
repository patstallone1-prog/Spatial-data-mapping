"""Host installation is reversible, repeatable, and refuses to clobber user source."""
import importlib.util
import json
import struct
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("install_runtime", ROOT / "tools/unreal/install_runtime.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def project_at(tmp_path):
    project = tmp_path / "Kerbside.uproject"
    project.write_text(json.dumps({"FileVersion": 3, "EngineAssociation": "5.8", "Plugins": []}))
    config = tmp_path / "Config"
    config.mkdir()
    (config / "DefaultEngine.ini").write_text("; user setting\n[Custom]\nKeep=True\n")
    return project


def test_install_preserves_config_and_is_idempotent(tmp_path):
    project = project_at(tmp_path)
    first = installer.install(project)
    text = (tmp_path / "Config/DefaultEngine.ini").read_text()
    second = installer.install(project)
    assert first == second
    assert text == (tmp_path / "Config/DefaultEngine.ini").read_text()
    assert "Keep=True" in text and text.count(installer.BEGIN) == 1
    assert "DefaultGravityZ=-980.0" in text
    assert "r.Lumen.HardwareRayTracing=False" in text
    assert (tmp_path / "Saved/KerbsideInstall/original/Kerbside.uproject").exists()
    assert json.loads(project.read_text())["EngineAssociation"] == "5.8"
    assert all(".env" not in p and "secret" not in p for p in first["files"])


def test_install_rejects_user_edit_without_partial_writes(tmp_path):
    project = project_at(tmp_path)
    installer.install(project)
    header = tmp_path / "Plugins/KerbsideWorld/Source/KerbsideWorld/Public/KerbsideWorldActors.h"
    header.write_text("// my change\n")
    original = project.read_bytes()
    with pytest.raises(ValueError, match="refusing overwrite"):
        installer.install(project)
    assert header.read_text() == "// my change\n" and project.read_bytes() == original


def test_plugin_update_cannot_regress_imported_default_city(tmp_path):
    project = project_at(tmp_path)
    installer.install(project)
    config = tmp_path / "Config/DefaultEngine.ini"
    maps = ("\n[/Script/EngineSettings.GameMapsSettings]\n"
            "GameDefaultMap=/Game/KerbsideRuntime/Maps/City.City\n"
            "EditorStartupMap=/Game/KerbsideRuntime/Maps/City.City\n")
    config.write_text(installer.managed_config(config.read_text(), installer.ENGINE_CONFIG + maps))
    before = config.read_text()
    installer.install(project)
    assert config.read_text() == before


def test_install_rejects_unmanaged_plugin(tmp_path):
    project = project_at(tmp_path)
    path = tmp_path / "Plugins/KerbsideWorld/KerbsideWorld.uplugin"
    path.parent.mkdir(parents=True)
    path.write_text("user version")
    with pytest.raises(ValueError, match="unmanaged"):
        installer.install(project)
    assert path.read_text() == "user version"


def test_camera_axes_cannot_translate_player_and_world_not_simulated():
    source = (ROOT / "unreal/Plugins/KerbsideWorld/Source/KerbsideWorld/Private/KerbsideWorldActors.cpp").read_text()
    for function, call in (("LookYaw", "AddControllerYawInput"), ("LookPitch", "AddControllerPitchInput")):
        body = source.split(f"void AKerbsideWalker::{function}(float Value)")[1].split("}")[0]
        assert call in body and "AddMovementInput" not in body and "SetActorLocation" not in body
    assert "CTF_UseComplexAsSimple" in source
    assert "MaxStepHeight = 20.f" in source
    assert "SetCastShadows(true)" in source and "bAtmosphereSunLight = true" in source
    assert "SetRealTimeCaptureEnabled(true)" in source


def test_export_uses_current_app_and_viewer_frame_and_hashes():
    source = (ROOT / "tools/unreal/export_tiles.mjs").read_text()
    assert "docs/app-regions/${REGION}" in source
    assert "const bounds = k.DATA.bbox" in source
    assert "sha256:" in source and "schema_version: 2" in source
    assert "if (!o.isMesh || !o.geometry) return" in source  # Runtime culling cannot erase curbs.


def load_editor_helpers(monkeypatch):
    monkeypatch.setitem(sys.modules, "unreal", types.ModuleType("unreal"))
    spec = importlib.util.spec_from_file_location("setup_world", ROOT / "tools/unreal/setup_world.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_import_axis_probe_matches_known_glTF_conversion_and_rejects_bad_scale(monkeypatch):
    module = load_editor_helpers(monkeypatch)
    basis, yaw = module.conversion_from_probe((-3000, 1000, 2000), (150, 50, 100))
    assert yaw == -90 and basis == ((0, 1, 0), (0, 0, 1), (-1, 0, 0))
    _, yaw = module.conversion_from_probe((1000, 3000, 2000), (50, 150, 100))
    assert yaw == 0
    with pytest.raises(ValueError, match="unexpected units"):
        module.conversion_from_probe((-30, 10, 20), (1.5, .5, 1))
    with pytest.raises(ValueError, match="recentred"):
        module.conversion_from_probe((0, 0, 0), (150, 50, 100))


def test_collision_semantics_include_ramps_fences_not_paint_or_borrowed_scans(monkeypatch):
    module = load_editor_helpers(monkeypatch)
    for name in ("curb_ramp", "front_walk", "fence:chainlink", "median", "tunnel_walk", "building", "terrain"):
        assert module.blocks(name), name
    for name in ("tactile_warning", "marking", "crossing", "detail", "tree:street", "scanned_interior"):
        assert not module.blocks(name), name
    available = {"road": 10, "building": 20, "curb_ramp": 4}
    assert module.canonical_surface("building_2", available) == "building"
    assert module.canonical_surface("curb_ramp", available) == "curb_ramp"
    with pytest.raises(ValueError, match="Unmapped"):
        module.canonical_surface("Material", available)


def test_axis_fixture_is_valid_glb(tmp_path):
    spec = importlib.util.spec_from_file_location("axis_probe", ROOT / "tools/unreal/axis_probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    path = tmp_path / "probe.glb"
    module.write_probe(path)
    data = path.read_bytes()
    magic, version, size = struct.unpack_from("<III", data)
    assert (magic, version, size) == (0x46546C67, 2, len(data))
    length, tag = struct.unpack_from("<II", data, 12)
    assert tag == 0x4E4F534A
    metadata = json.loads(data[20:20 + length])
    assert metadata["accessors"][0]["min"] == [9.5, 19, 28.5]
    assert metadata["accessors"][1]["count"] == 36


def test_import_rejects_changed_or_escaping_assets(tmp_path, monkeypatch):
    import hashlib
    module = load_editor_helpers(monkeypatch)
    asset = tmp_path / "tile.glb"
    asset.write_bytes(b"fixture")
    tile = {"file": "tile.glb", "bytes": 7, "sha256": hashlib.sha256(b"fixture").hexdigest()}
    data = {"schema_version": 2, "renderer_sha256": "a" * 64, "tiles": [tile]}
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(data))
    assert module.validate_manifest(path) == data
    asset.write_bytes(b"changed")
    with pytest.raises(ValueError, match="Stale/corrupt"):
        module.validate_manifest(path)
    tile["file"] = "../outside.glb"
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="escapes"):
        module.validate_manifest(path)
