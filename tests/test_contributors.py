"""Contributors' Macs: work handed out and brought home, the polite pauses, nothing public."""

from __future__ import annotations

import base64
import json
import runpy
import sqlite3
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _coordinator():
    return runpy.run_path(str(ROOT / "scripts/contributor_coordinator.py"))


def _candidate(uid: str, rank: float) -> dict:
    return {"observation": {"observation_uid": uid, "provider": "mapillary"}, "pose_status": "provider_solved",
            "rank": [1, rank], "camera": {}, "wall": {}}


def test_the_best_unscreened_photographs_are_handed_out_and_none_twice(tmp_path: Path) -> None:
    c = _coordinator()
    folder = tmp_path / "run"
    folder.mkdir()
    with sqlite3.connect(folder / "selection.sqlite") as conn:
        conn.execute("CREATE TABLE buildings (payload TEXT)")
        for bid, uid, rank in (("1", "aaa", 0.9), ("2", "bbb", 0.5), ("3", "ccc", 0.7)):
            conn.execute("INSERT INTO buildings VALUES (?)", (json.dumps(
                {"building_id": bid, "address": None, "candidates": [_candidate(uid, rank)]}),))
    out = tmp_path / "frontage-live"
    (out / "review").mkdir(parents=True)
    (out / "status.json").write_text(json.dumps({"regions": [
        {"status": "indexed", "folder": str(folder), "region": "sf-mission", "run": "r1"}]}))
    (out / "review" / "seen.json").write_text(json.dumps(
        {"region": "sf-mission", "building_id": "3", "candidate": {"observation": {"observation_uid": "ccc"}}}))
    coordinator = c["Coordinator"](out, "token")
    items = coordinator.unscreened(10, {("sf-mission", "2", "bbb")})
    assert [i["work_key"] for i in items] == ["sf-mission|1|aaa"], "screened and handed-out ones are skipped"
    assert items[0]["payload"]["candidate"]["observation"]["observation_uid"] == "aaa"
    assert "candidates" not in items[0]["payload"]["row"]


def test_results_come_home_into_the_photo_bucket(tmp_path: Path, monkeypatch) -> None:
    c = _coordinator()
    calls = []
    report = {"review_key": "sf-mission-1-aaa", "status": "screened_candidate_needs_privacy_and_identity_review",
              "region": "sf-mission", "building_id": "1", "crop": "/Users/someone/elsewhere.jpg"}
    pages = [[{"id": 7, "work_key": "sf-mission|1|aaa", "payload": {
        "outcome": report["status"], "review": report, "device_name": "Family Mac 1",
        "files": {"jpg": base64.b64encode(b"crop").decode(), "labels.png": base64.b64encode(b"lab").decode()}}}], []]

    def fake_rpc(name, body, timeout=60):
        calls.append(name)
        return pages.pop(0) if name == "kerbside_pull" else None

    monkeypatch.setitem(c["Coordinator"].collect.__globals__, "rpc", fake_rpc)
    coordinator = c["Coordinator"](tmp_path, "token")
    assigned = {("sf-mission", "1", "aaa"), ("sf-mission", "2", "bbb")}
    assert coordinator.collect(assigned) == 1
    review = tmp_path / "review"
    saved = json.loads((review / "sf-mission-1-aaa.json").read_text())
    assert (review / "sf-mission-1-aaa.jpg").read_bytes() == b"crop"
    assert saved["crop"] == str(review / "sf-mission-1-aaa.jpg") and saved["contributed_by"] == "Family Mac 1"
    assert assigned == {("sf-mission", "2", "bbb")}, "a result frees its photograph"
    assert calls.count("kerbside_ack") == 1 and coordinator.state["last_result_id"] == 7


def test_a_bundle_carries_the_code_its_settings_and_an_installer_and_is_private(tmp_path: Path) -> None:
    c = _coordinator()
    target = c["make_bundle"]("Family Mac 1", "contributor-token", tmp_path)
    assert oct(target.stat().st_mode & 0o777) == "0o600"
    with zipfile.ZipFile(target) as bundle:
        names = bundle.namelist()
        config = json.loads(bundle.read("kerbside-contributor/config.json"))
    assert "kerbside-contributor/app/scripts/filter_frontage_photos.py" in names
    assert "kerbside-contributor/app/contrib/kerbside_contributor.py" in names
    assert "kerbside-contributor/Install Kerbside Contributor.command" in names
    assert not any("/docs/" in n or ".env" in n for n in names), "no site data, no env file"
    assert config["contributor_token"] == "contributor-token" and config["name"] == "Family Mac 1"
    assert config["publishable_key"].startswith("sb_publishable_")


def test_the_contributor_pauses_when_the_mac_is_busy_low_or_turned_off(tmp_path: Path, monkeypatch) -> None:
    m = runpy.run_path(str(ROOT / "contrib/kerbside_contributor.py"))
    g = m["others_busy"].__globals__

    class Done:
        def __init__(self, stdout):
            self.stdout = stdout

    monkeypatch.setattr(g["os"], "cpu_count", lambda: 8)
    monkeypatch.setattr(g["subprocess"], "run", lambda *a, **k: Done("  1 120.0\n  2 90.0\n 99 400.0\n"))
    assert m["others_busy"]({99}) is False, "its own 400% does not count; 210% of 800% is quiet"
    monkeypatch.setattr(g["subprocess"], "run", lambda *a, **k: Done("  1 250.0\n  2 90.0\n"))
    assert m["others_busy"](set()) is True, "Kerbside World loading at 340% of 800% is busy"
    monkeypatch.setattr(g["subprocess"], "run", lambda *a, **k: Done(
        "Now drawing from 'Battery Power'\n -InternalBattery-0 41%; discharging"))
    assert m["on_battery_low"]() is True
    monkeypatch.setitem(g, "OFF", tmp_path / "OFF")
    (tmp_path / "OFF").touch()
    assert m["why_not_now"]() == "turned_off"


def test_the_filter_screens_exactly_the_claimed_photographs_and_skips_contributors_share() -> None:
    source = (ROOT / "scripts/filter_frontage_photos.py").read_text()
    assert '"--work-file"' in source and "args.work_rows = json.loads(args.work_file.read_text())" in source
    assert 'assigned_path = args.output / "contrib-assigned.json"' in source
    assert "if key in assigned and not getattr(args, \"work_rows\", None):" in source
    workers = (ROOT / "scripts/run_frontage_workers.py").read_text()
    assert '"contributors": [' in workers and "scripts/contributor_coordinator.py" in workers
    assert "eligible = power_eligible(power, args.battery_min_percent)" in workers, "power gate unchanged"


def test_the_supabase_tables_are_closed_and_every_function_checks_a_token() -> None:
    sql = (ROOT / "supabase/kerbside_contributors.sql").read_text()
    for table in ("kerbside_settings", "kerbside_contributors", "kerbside_work", "kerbside_results"):
        assert f"alter table {table} enable row level security;" in sql
    assert "revoke all on kerbside_settings, kerbside_contributors, kerbside_work, kerbside_results from anon" in sql
    bodies = sql.split("create or replace function ")[2:]
    assert len(bodies) == 8 and all("kerbside_token_ok(" in b for b in bodies)
    # Only hashes are stored; no token or key is in the repository.
    assert "digest(token, 'sha256')" in sql
    assert "sb_secret" not in sql and "MAPILLARY" not in sql
