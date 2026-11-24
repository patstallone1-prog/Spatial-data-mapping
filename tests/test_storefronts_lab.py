"""The storefront lab (storefronts-lab/, package ``kerbfront``) keeps its own test suite beside
its code. This runs that suite in its own interpreter, so the lab's conftest and import path stay
apart from the repo's."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

LAB = Path(__file__).resolve().parents[1] / "storefronts-lab"


def test_the_lab_suite_passes():
    pytest.importorskip("cv2")
    pytest.importorskip("shapely")
    env = {**os.environ, "PYTHONPATH": str(LAB), "HF_HUB_OFFLINE": "1"}
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"],
        cwd=LAB,
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-2000:]
