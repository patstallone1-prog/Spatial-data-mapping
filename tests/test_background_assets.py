"""Archive acquisition has no runtime integration and cannot extract outside its library."""

import importlib.util
import io
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "background_assets", ROOT / "tools/assets/acquire_background_assets.py"
)
ASSETS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSETS)


def test_packs_separate_npc_and_vehicle_archives():
    assert set(ASSETS.PACKS.values()) == {"npc", "vehicle"}
    assert len(ASSETS.PACKS) == 8


@pytest.mark.parametrize("name", ["../outside.obj", "/absolute.obj", "folder\\escape.obj"])
def test_zip_paths_cannot_escape_the_library(name):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr(name, b"mesh")
    data.seek(0)
    with zipfile.ZipFile(data) as z, pytest.raises(ValueError, match="unsafe archive"):
        ASSETS.safe_members(z)


def test_archive_requires_publisher_cc0_confirmation_before_downloading(monkeypatch, tmp_path):
    monkeypatch.setattr(ASSETS, "fetch", lambda url: b"Publisher changed the license")
    with pytest.raises(ValueError, match="no longer confirms CC0"):
        ASSETS.acquire(tmp_path, "car-kit", "vehicle")
    assert not (tmp_path / "car-kit/source.zip").exists()


def test_resume_verifies_archive_hash_and_never_installs_assets(monkeypatch, tmp_path):
    import json

    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr("vehicle.obj", b"o vehicle\nv 0 0 0\n")
        z.writestr("License.txt", b"Creative Commons CC0 1.0")
    archive = data.getvalue()
    calls = []

    def fetch(url, *args):
        calls.append(url)
        if url.endswith("/car-kit"):
            return b'<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a><a href="https://kenney.nl/source.zip">Download</a>'
        return archive

    monkeypatch.setattr(ASSETS, "fetch", fetch)
    monkeypatch.setattr(
        ASSETS.shutil, "disk_usage", lambda p: type("Usage", (), dict(free=100 * 1024**3))()
    )
    first = ASSETS.acquire(tmp_path, "car-kit", "vehicle")
    second = ASSETS.acquire(tmp_path, "car-kit", "vehicle")
    assert first["sha256"] == second["sha256"]
    assert calls.count("https://kenney.nl/source.zip") == 1
    assert second["status"] == "archived_not_integrated"
    assert second["models"] == ["files/vehicle.obj"]
    receipt = json.loads((tmp_path / "car-kit/receipt.json").read_text())
    assert receipt["license"] == "CC0-1.0"
    (tmp_path / "car-kit/source.zip").write_bytes(b"changed")
    with pytest.raises(ValueError, match="no matching receipt"):
        ASSETS.acquire(tmp_path, "car-kit", "vehicle")
