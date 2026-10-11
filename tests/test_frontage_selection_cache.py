import json
import sqlite3

from smc.facades.selection_cache import (
    AUDITED_REUSE_SELECTOR_SHA256,
    COMPATIBLE_LEGACY,
    compatible_selection,
)


def fixture(tmp_path):
    folder = tmp_path / "old"
    folder.mkdir()
    old = {"implementation_sha256": next(iter(COMPATIBLE_LEGACY)),
           "method": "frontage-v3", "world_sha256": "world", "catalogs": ["catalog"],
           "policy": {"angle": 35}, "date": "2026-10-10"}
    (folder / "run.json").write_text(json.dumps(old))
    (folder / "summary.json").write_text(json.dumps({
        "status": "indexed", "run": "old", "buildings": 1,
        "source_frames": {"kartaview": 1}}))
    with sqlite3.connect(folder / "selection.sqlite") as conn:
        conn.execute("CREATE TABLE buildings (id TEXT, payload TEXT)")
        conn.execute("INSERT INTO buildings VALUES ('a', '{}')")
    return {**old, "implementation_sha256": "new",
            "selection_sha256": AUDITED_REUSE_SELECTOR_SHA256}


def test_compatible_cache_retains_original_provenance_and_never_grants_approval(tmp_path):
    stamp = fixture(tmp_path)
    result = compatible_selection(tmp_path, stamp, "new")
    assert result["run"] == "old"
    assert len(result["selection_reuse"]["selection_database_sha256"]) == 64
    assert not result["selection_reuse"]["pose_or_privacy_approval_granted"]


def test_changed_inputs_policy_epoch_or_unknown_old_code_force_rebuild(tmp_path):
    stamp = fixture(tmp_path)
    for key in ("world_sha256", "catalogs", "policy", "date"):
        assert compatible_selection(tmp_path, {**stamp, key: "changed"}, "new") is None
    assert compatible_selection(tmp_path, {**stamp, "selection_sha256": "unknown-new-selector"},
                                "new") is None
    path = tmp_path / "old/run.json"
    old = json.loads(path.read_text())
    path.write_text(json.dumps({**old, "implementation_sha256": "unreviewed-old-code"}))
    assert compatible_selection(tmp_path, stamp, "new") is None


def test_restricted_provider_or_incomplete_database_never_reuses_cache(tmp_path):
    stamp = fixture(tmp_path)
    path = tmp_path / "old/summary.json"
    summary = json.loads(path.read_text())
    path.write_text(json.dumps({**summary, "source_frames": {"sf-xl": 1}}))
    assert compatible_selection(tmp_path, stamp, "new") is None
    path.write_text(json.dumps({**summary, "buildings": 2}))
    assert compatible_selection(tmp_path, stamp, "new") is None
