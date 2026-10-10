import importlib.util
import plistlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from smc.storage.external_volume import volume_ready

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("frontage_migration", ROOT / "tools/migrate_frontage_storage.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
UUID = "11111111-2222-3333-4444-555555555555"


def test_stale_directory_cannot_masquerade_as_external_mount(monkeypatch):
    monkeypatch.setattr(Path, "is_mount", lambda _: False)
    assert not volume_ready(Path("/Volumes/HP P700 1"), UUID)
    assert volume_ready(None, None)


def test_exact_external_volume_identity_required(monkeypatch):
    volume = Path("/Volumes/HP P700 1")
    monkeypatch.setattr(Path, "is_mount", lambda _: True)
    info = {"MountPoint": str(volume), "Internal": False, "VolumeUUID": UUID}
    monkeypatch.setattr("subprocess.run", lambda *a, **k: SimpleNamespace(returncode=0, stdout=plistlib.dumps(info)))
    assert volume_ready(volume, UUID)
    info["Internal"] = True
    assert not volume_ready(volume, UUID)
    info["Internal"] = False
    info["VolumeUUID"] = "00000000-0000-0000-0000-000000000000"
    assert not volume_ready(volume, UUID)


def test_changed_copy_never_causes_local_cutover(tmp_path):
    source, destination = tmp_path / "source", tmp_path / "destination"
    source.mkdir()
    destination.mkdir()
    (source / "evidence.bin").write_bytes(b"original")
    expected = module.inventory(source)
    (destination / "evidence.bin").write_bytes(b"corrupt")
    with pytest.raises(RuntimeError, match="inventory mismatch"):
        module.cutover(source, destination, expected)
    assert not source.is_symlink()
    assert (source / "evidence.bin").read_bytes() == b"original"


def test_verified_cutover_preserves_links_empty_dirs_and_recoverable_backup(tmp_path):
    source, destination = tmp_path / "source", tmp_path / "destination"
    for folder in (source, destination):
        folder.mkdir()
        (folder / "empty").mkdir()
        (folder / "evidence.bin").write_bytes(b"original")
        (folder / "checkpoint").symlink_to("evidence.bin")
    expected = module.inventory(source)
    backup = module.cutover(source, destination, expected)
    assert source.is_symlink() and source.resolve() == destination
    assert module.inventory(backup) == expected
    assert (source / "checkpoint").read_bytes() == b"original"
