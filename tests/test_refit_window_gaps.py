"""The one-off pass refitting the run's houses whose fronts have a window gap."""

from __future__ import annotations

import json
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOB = runpy.run_path(str(ROOT / "scripts/refit_window_gaps.py"))


def _w(i, u, v, w=1.0, h=1.5):
    return {"id": i, "kind": "window", "role": "window", "u": u, "v": v, "w": w, "h": h}


GAP = {"building_id": "1", "region": "sf-mission", "a": [-122.42, 37.76], "width_m": 8.0, "height_m": 7.5,
       "openings": [_w("a", 0.8, 4.0), _w("b", 3.5, 4.0), _w("c", 6.2, 4.0), _w("d", 3.5, 1.0), _w("e", 6.2, 1.0)]}
FULL = {**GAP, "building_id": "2", "a": [-122.4201, 37.76],
        "openings": [*GAP["openings"], _w("f", 0.8, 1.0)]}


def _bucket(root: Path, bucket: str, fit: dict) -> None:
    path = root / bucket / fit["region"] / f"{fit['building_id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(fit))


def test_only_houses_with_a_column_gap_are_chosen(tmp_path: Path) -> None:
    _bucket(tmp_path, "houses", GAP)
    _bucket(tmp_path, "houses", FULL)
    _bucket(tmp_path, "rejected", {**GAP, "building_id": "3"})
    assert JOB["targets"](tmp_path) == [["sf-mission", "1"]]
    near = JOB["neighbours"](tmp_path, [["sf-mission", "1"]])["buildings"]
    assert set(near) == {"2", "3"}, "the run's fits around it, accepted or not, are its neighbours"


def test_photographs_are_staged_as_links(tmp_path: Path) -> None:
    review = tmp_path / "live" / "review"
    review.mkdir(parents=True)
    for name in ("sf-mission-1-abc.json", "sf-mission-1-abc.jpg", "sf-mission-1-abc.labels.png",
                 "sf-mission-11-xyz.json", "sf-mission-2-def.json"):
        (review / name).write_text("{}")
    counts = JOB["stage"]([tmp_path / "live"], [["sf-mission", "1"]], tmp_path / "stage")
    staged = sorted(p.name for p in (tmp_path / "stage" / "0" / "review").iterdir())
    assert staged == ["sf-mission-1-abc.jpg", "sf-mission-1-abc.json", "sf-mission-1-abc.labels.png"]
    assert all((tmp_path / "stage" / "0" / "review" / n).is_symlink() for n in staged)
    assert counts == {"rows": 1, "houses_with_rows": 1}


def test_an_accepted_refit_replaces_and_a_rejected_one_leaves_the_house_as_it_was(tmp_path: Path) -> None:
    run, refit = tmp_path / "run", tmp_path / "refit"
    for key in ("1", "2", "3"):
        _bucket(run, "houses", {**GAP, "building_id": key, "openings": GAP["openings"][:5]})
    _bucket(refit, "houses", {**FULL, "building_id": "1"})
    _bucket(refit, "rejected", {**GAP, "building_id": "2", "auto_review": {"accept": False}})
    out = JOB["merge"](run, refit, [["sf-mission", "1"], ["sf-mission", "2"], ["sf-mission", "3"]])
    assert out["report"] == {"replaced": ["sf-mission:1"], "kept_earlier_acceptance": ["sf-mission:2"],
                             "not_refitted": ["sf-mission:3"]}
    assert len(json.loads((run / "houses/sf-mission/1.json").read_text())["openings"]) == 6
    assert len(json.loads((run / "houses/sf-mission/2.json").read_text())["openings"]) == 5
    assert not (run / "rejected/sf-mission/2.json").exists()


def test_the_supervisor_runs_it_only_while_asked_and_unfinished() -> None:
    source = (ROOT / "scripts/run_frontage_workers.py").read_text()
    assert '(refit_state / "request.json").is_file() and not (refit_state / "done.json").is_file()' in source
    job = (ROOT / "scripts/refit_window_gaps.py").read_text()
    # Its own publication file: the default is the run's, which a partial pass would overwrite.
    assert '"--publish-to", str(refit / "published.json")' in job
    assert "--neighbours" in (ROOT / "scripts/match_frontage_facades.py").read_text()
