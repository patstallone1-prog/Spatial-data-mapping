import hashlib
import json
import runpy
import subprocess
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
MODULE = runpy.run_path(str(ROOT / "scripts/run_frontage_workers.py"))


def test_external_reserve_uses_external_disk_and_unplug_race_never_falls_back(monkeypatch):
    state = MODULE["storage_state"]
    monkeypatch.setitem(state.__globals__, "volume_ready", lambda *_: True)
    local, volume = Path("/local/build"), Path("/Volumes/fixture")
    seen = []

    def capacity(path):
        seen.append(path)
        return SimpleNamespace(free=(8 if path == volume else 1) * 1024**3)

    monkeypatch.setattr("shutil.disk_usage", capacity)
    assert state(local, volume, "fixture") == (True, True)
    assert seen == [volume]

    def missing(_):
        raise FileNotFoundError

    monkeypatch.setattr("shutil.disk_usage", missing)
    assert state(local, volume, "fixture") == (False, False)
    monkeypatch.setitem(state.__globals__, "volume_ready", lambda *_: False)
    assert state(local, volume, "fixture") == (False, False)


def test_private_full_pace_does_not_require_or_fabricate_pilot_approval(tmp_path):
    assert MODULE["proposal_batch_size"](False, False) == 24
    assert MODULE["proposal_batch_size"](False, True) == 256
    assert MODULE["proposal_batch_size"](True, False) == 256
    assert not MODULE["full_run_approved"](tmp_path / "absent.json", ROOT / "scripts/build_sf_corridor_3d.py")


def test_unknown_or_battery_power_never_starts_gpu_jobs():
    assert MODULE["on_ac"]("Now drawing from 'AC Power'\n")
    assert not MODULE["on_ac"]("Now drawing from 'Battery Power'\n64%; discharging")
    assert not MODULE["on_ac"]("query failed")


def test_authorized_battery_policy_pauses_at_thirty_and_unknown_readings():
    parse, allowed = MODULE["parse_power"], MODULE["power_eligible"]
    assert allowed(parse("Now drawing from 'Battery Power'\n31%; discharging;"), 30)
    assert not allowed(parse("Now drawing from 'Battery Power'\n30%; discharging;"), 30)
    assert not allowed(parse("Now drawing from 'Battery Power'\n20%; discharging;"), 30)
    assert not allowed(parse("Now drawing from 'Battery Power'\n100%; discharging;"), None)
    assert not allowed(parse("Now drawing from 'Battery Power'\nunknown%;"), 30)
    assert not allowed(parse("Now drawing from 'Battery Power'\n999%;"), 30)
    assert not allowed(None, 30)
    assert allowed(parse("Now drawing from 'AC Power'\n20%; charging;"), 30)


def test_power_query_timeout_is_a_pause_not_a_supervisor_crash(monkeypatch):
    def unavailable(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 10)

    monkeypatch.setattr(subprocess, "run", unavailable)
    assert MODULE["power_state"]() is None


def test_delayed_kill_does_not_drop_or_duplicate_the_tracked_child():
    class BusyChild:
        killed = False

        def poll(self):
            return None

        def terminate(self):
            pass

        def wait(self, timeout):
            raise subprocess.TimeoutExpired("fixture", timeout)

        def kill(self):
            self.killed = True

    process = BusyChild()
    MODULE["stop_process"](process)
    assert process.killed and process.poll() is None


def test_full_run_requires_three_distinct_reviewed_current_facts(tmp_path):
    renderer = tmp_path / "renderer.py"
    renderer.write_text("current")
    approval = {
        "reviewer": "fixture",
        "renderer_sha256": hashlib.sha256(renderer.read_bytes()).hexdigest(),
        "implementation_sha256": MODULE["implementation_sha256"](ROOT),
        "houses": [],
    }
    path = tmp_path / "approval.json"
    for i in range(3):
        fact = tmp_path / f"{i}.json"
        fact.write_text(
            json.dumps(
                {
                    "building_id": str(i),
                    "region": "sf",
                    "image_sha256": "abc",
                    "source_locator": "fixture",
                    "certainty": {"tier": "high"},
                    "review_status": "reviewed_inferred_visual_parameters",
                    "implementation_sha256": approval["implementation_sha256"],
                }
            )
        )
        approval["houses"].append(
            {
                "fit_path": str(fact),
                "fit_sha256": hashlib.sha256(fact.read_bytes()).hexdigest(),
                "source_comparison_passed": True,
                "outcrop_alignment_passed": True,
                "openings_passed": True,
                "material_passed": True,
                "privacy_rights_passed": True,
            }
        )
    path.write_text(json.dumps(approval))
    assert MODULE["full_run_approved"](path, renderer)
    approval["implementation_sha256"] = "old-extractor"
    path.write_text(json.dumps(approval))
    assert not MODULE["full_run_approved"](path, renderer)
    approval["implementation_sha256"] = MODULE["implementation_sha256"](ROOT)
    path.write_text(json.dumps(approval))
    renderer.write_text("changed")
    assert not MODULE["full_run_approved"](path, renderer)
    renderer.write_text("current")
    approval["houses"][2] = approval["houses"][1]
    path.write_text(json.dumps(approval))
    assert not MODULE["full_run_approved"](path, renderer)
