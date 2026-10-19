"""The acceptance test: submit, provision, restore, run, crash and resume, gate and review,
publish, read as the viewer reads, stop idle workers, lose the controller and carry on --
all with real worker processes and stores, and a stand-in provider (smc.cloud.selftest)."""

from __future__ import annotations

from smc.cloud.selftest import CHAIN, run


def test_the_whole_lifecycle_runs_unattended(tmp_path):
    out = run(keep=tmp_path)
    assert out["ok"]
    assert out["lidar_attempts"] == ["lease_expired", "done"]
    assert out["cell_a_runs"] == list(CHAIN)
    assert "sampled_colour" in out["held_reasons"]
    assert out["final"]["cells_finished"] == 3
