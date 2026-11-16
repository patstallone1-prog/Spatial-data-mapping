"""Offline importer checks: sources stay explicit and interrupted downloads are retryable."""

import hashlib
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "business_assets", ROOT / "scripts/import_business_assets.py"
)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def test_plain_and_decorated_surfaces_have_distinct_support_roles():
    assert importer.kay_role("chair_A") == ("dining_chair", 0.95)
    assert importer.kay_role("kitchentable_A")[0] == "prep_table"
    assert importer.kay_role("kitchentable_A_large_decorated")[0] == "prep_station"
    assert importer.kay_role("table_round_A_decorated")[0] == "dining_set"
    assert importer.kay_role("wall_doorway") is None
    assert importer.kay_role("extractorhood") is None


def test_fetch_records_hashes_and_reuses_a_complete_cache(tmp_path, monkeypatch):
    class Response:
        def read(self):
            return b"reviewed source bytes"

    calls = []
    monkeypatch.setattr(
        importer, "urlopen", lambda request, timeout: calls.append(request.full_url) or Response()
    )
    path = tmp_path / "pack/model.glb"
    first = importer.fetch("https://example.test/model.glb", path)
    second = importer.fetch("https://example.test/model.glb", path)
    assert first == second
    assert len(calls) == 1
    assert first["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert first["bytes"] == len(path.read_bytes())
    assert not path.with_name(path.name + ".partial").exists()


def test_an_empty_interrupted_cache_is_downloaded_again(tmp_path, monkeypatch):
    class Response:
        def read(self):
            return b"complete"

    path = tmp_path / "incomplete.glb"
    path.write_bytes(b"")
    monkeypatch.setattr(importer, "urlopen", lambda request, timeout: Response())
    importer.fetch("https://example.test/model.glb", path)
    assert path.read_bytes() == b"complete"
