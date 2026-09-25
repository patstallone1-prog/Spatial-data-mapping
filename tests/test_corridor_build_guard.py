"""A partial local source cache must not erase the published SF map."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_missing_catalog_and_curb_policy_abort_before_any_output(tmp_path: Path):
    page = tmp_path / "corridor.html"
    run = subprocess.run(
        [sys.executable, str(ROOT / "scripts/build_sf_corridor_3d.py"),
         "--catalog", str(tmp_path / "missing-catalog"),
         "--official-dir", str(tmp_path / "missing-official"),
         "--out", str(page), "--reuse-osm"],
        cwd=ROOT, capture_output=True, text=True, timeout=30,
    )
    assert run.returncode == 2
    assert "refusing to replace the complete SF map" in run.stderr
    assert "merged observation catalogue" in run.stderr
    assert "curb-policy bands" in run.stderr
    assert not page.exists()
    assert not page.with_suffix(".json").exists()


def test_experimental_incomplete_build_cannot_replace_published_corridor():
    run = subprocess.run(
        [sys.executable, str(ROOT / "scripts/build_sf_corridor_3d.py"),
         "--allow-incomplete", "--reuse-osm"],
        cwd=ROOT, capture_output=True, text=True, timeout=30,
    )
    assert run.returncode == 2
    assert "requires --out outside the published" in run.stderr


def test_page_only_rebuild_does_not_touch_data_when_catalog_is_missing(tmp_path: Path):
    page = tmp_path / "corridor.html"
    run = subprocess.run(
        [sys.executable, str(ROOT / "scripts/build_sf_corridor_3d.py"),
         "--page-only", "--catalog", str(tmp_path / "missing-catalog"),
         "--out", str(page)],
        cwd=ROOT, capture_output=True, text=True, timeout=30,
    )
    assert run.returncode == 0, run.stderr
    assert "crossingIslandCurbGrid" in page.read_text(encoding="utf-8")
    assert not page.with_suffix(".json").exists()
