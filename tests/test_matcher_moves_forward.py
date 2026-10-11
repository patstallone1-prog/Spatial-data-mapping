"""Passes move forward: a house already decided is kept as it was, file and all."""

from __future__ import annotations

import json
import os
import runpy
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def _matcher():
    return runpy.run_path(str(ROOT / "scripts/match_frontage_facades.py"))


def _record(key: str, accept: bool, rank: list) -> dict:
    return {"building_id": key, "region": "sf-mission", "fit_rank": rank, "image_sha256": f"img-{key}",
            "openings": [{"kind": "window"}], "appearance": {"colour": "#aabbcc"},
            "review_status": "auto_accepted_visual_parameters" if accept else "needs_visual_alignment_review",
            "auto_review": {"accept": accept, "reasons": [] if accept else ["no_window_read"]}}


def test_finished_houses_are_found_in_their_buckets(tmp_path: Path) -> None:
    m = _matcher()
    for bucket, key, accept in (("houses", "1", True), ("rejected", "2", False)):
        path = tmp_path / bucket / "sf-mission" / f"{key}.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(_record(key, accept, [1, 1.0, 0, 100.0])))
    (tmp_path / "houses" / "index.json").write_text("{}")
    settled = m["settled_houses"](tmp_path)
    assert set(settled) == {("sf-mission", "1"), ("sf-mission", "2")}
    assert settled[("sf-mission", "1")]["bucket"] == "houses" and settled[("sf-mission", "2")]["image_sha256"] == "img-2"


def test_a_finished_house_is_kept_untouched_and_a_new_one_is_decided(tmp_path: Path) -> None:
    m = _matcher()
    kept = _record("1", True, [1, 1.0, 0, 100.0])
    path = tmp_path / "houses" / "sf-mission" / "1.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(kept))
    os.utime(path, (1_000_000, 1_000_000))
    new = {**_record("3", True, [1, 1.0, 0, 90.0]), "review_status": "needs_visual_alignment_review"}
    args = SimpleNamespace(output=tmp_path, publish_to=tmp_path / "fits.json")
    result = m["reconstruct"](args, {"1": kept, "3": new}, {"1"})
    assert result["kept_from_earlier_passes"] == 1 and result["decided_this_pass"] == 1
    assert path.stat().st_mtime == 1_000_000, "a finished house's file is not rewritten"
    published = json.loads((tmp_path / "fits.json").read_text())["buildings"]
    assert published["1"] == kept, "the finished house is still published as it was"
    assert any((tmp_path / b / "sf-mission" / "3.json").exists() for b in ("houses", "rejected")), \
        "the new house is decided into a bucket"


def test_the_supervisor_runs_the_matcher_forward_and_a_full_rerun_is_deliberate() -> None:
    supervisor = (ROOT / "scripts/run_frontage_workers.py").read_text()
    assert "--refit-all" not in supervisor
    matcher = (ROOT / "scripts/match_frontage_facades.py").read_text()
    assert 'settled = {} if getattr(args, "refit_all", False) else settled_houses(args.output)' in matcher
    assert "list(candidate[\"rank\"]) <= list(done[\"fit_rank\"])" in matcher
