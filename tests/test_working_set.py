"""A drive disappearing must not destroy or falsely complete the local batch."""
import hashlib
import json
import sqlite3
from pathlib import Path

from smc.storage.working_set import WorkingSet


def test_background_proposals_cannot_overwrite_served_frontage_artifacts():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts/match_frontage_facades.py").read_text()
    assert 'default=ROOT / "build/facade-match/candidate-published-fits.json"' in source
    runner = (root / "scripts/run_frontage_workers.py").read_text()
    assert '"--publish-to", str(ROOT / "build/facade-match/candidate-published-fits.json")' in runner
    filter_source = (root / "scripts/filter_frontage_photos.py").read_text()
    # A durable working set defers pruning to the checkpoint; only scratch output is pruned.
    assert 'if WORKSPACE is not None:\n        cleanup = {"files_removed": 0' in filter_source
    assert "        cleanup = prune_rejected(args.output)" in filter_source


def workspace(tmp_path, mounted):
    return WorkingSet(tmp_path / "internal", tmp_path / "external" / "run",
                      tmp_path / "external", "test", ready=lambda: mounted[0])


def test_unplug_retains_pixels_until_complete_verified_batch_ack(tmp_path):
    mounted = [False]
    work = workspace(tmp_path, mounted)
    raw = work.local / "review/photo.jpg"
    raw.parent.mkdir()
    raw.write_bytes(b"exact pixels")
    report = raw.with_suffix(".json")
    report.write_text('{"certainty":"low"}')
    assert not work.checkpoint("block-1", clean_pixels=True)
    assert raw.exists() and not work.archive.exists()
    mounted[0] = True
    assert work.checkpoint("block-1", clean_pixels=True)
    assert not raw.exists() and report.exists()
    assert (work.archive / "review/photo.jpg").read_bytes() == b"exact pixels"
    receipt = json.loads(next((work.archive / "checkpoints").glob("*.json")).read_text())
    assert receipt["complete"]
    assert receipt["files"]["review/photo.jpg"] == hashlib.sha256(b"exact pixels").hexdigest()


def test_mid_copy_disconnect_preserves_last_good_archive_and_local_source(tmp_path, monkeypatch):
    mounted = [True]
    work = workspace(tmp_path, mounted)
    source = work.local / "pixel-store/image.zlib"
    source.parent.mkdir()
    source.write_bytes(b"new")
    target = work.archive / "pixel-store/image.zlib"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"old safe")
    import smc.storage.working_set as module
    actual = module.durable
    def eject_after_write(stream):
        actual(stream)
        mounted[0] = False
    monkeypatch.setattr(module, "durable", eject_after_write)
    assert not work.checkpoint("block-2", clean_pixels=True)
    assert source.read_bytes() == b"new" and target.read_bytes() == b"old safe"
    assert not list(work.archive.rglob("*.partial"))
    assert not (work.archive / "checkpoints").exists()


def test_committed_wal_rows_are_staged_locally_and_local_progress_survives_unplug(tmp_path):
    mounted = [True]
    work = workspace(tmp_path, mounted)
    folder = work.archive / "sf/run"
    folder.mkdir(parents=True)
    with sqlite3.connect(folder / "selection.sqlite") as archive:
        archive.execute("PRAGMA journal_mode=WAL")
        archive.execute("CREATE TABLE buildings(id TEXT PRIMARY KEY,payload TEXT)")
        archive.execute("INSERT INTO buildings VALUES('1','{}')")
        archive.commit()
        local = work.stage_database(folder) / "selection.sqlite"
        with sqlite3.connect(local) as db:
            assert db.execute("SELECT count(*) FROM buildings").fetchone()[0] == 1
    archive.close()
    mounted[0] = False
    with sqlite3.connect(local) as db:
        db.execute("INSERT INTO buildings VALUES('2','{}')")
    assert not work.checkpoint_database(local)
    with sqlite3.connect(folder / "selection.sqlite") as db:
        assert db.execute("SELECT count(*) FROM buildings").fetchone()[0] == 1
    db.close()
    mounted[0] = True
    assert work.checkpoint_database(local)
    with sqlite3.connect(folder / "selection.sqlite") as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert db.execute("SELECT count(*) FROM buildings").fetchone()[0] == 2


def test_reconnect_repairs_corrupt_archive_before_allowing_local_cleanup(tmp_path):
    mounted = [True]
    work = workspace(tmp_path, mounted)
    source = work.local / "review/a.jpg"
    source.parent.mkdir()
    source.write_bytes(b"photo")
    assert work.checkpoint("first")
    (work.archive / "review/a.jpg").write_bytes(b"torn unplug write")
    assert work.checkpoint("second", clean_pixels=True)
    assert (work.archive / "review/a.jpg").read_bytes() == b"photo"
    assert not source.exists()


def test_imported_metadata_is_not_overwritten_after_restart(tmp_path):
    mounted = [True]
    work = workspace(tmp_path, mounted)
    source = work.archive / "review/other-machine.json"
    source.parent.mkdir(parents=True)
    source.write_text('{"revision":1}')
    work.seed_metadata()
    source.write_text('{"revision":2}')
    restarted = workspace(tmp_path, mounted)
    assert restarted.checkpoint("resume")
    assert json.loads(source.read_text())["revision"] == 2
    restarted.seed_metadata()
    assert json.loads((work.local / "review/other-machine.json").read_text())["revision"] == 2
