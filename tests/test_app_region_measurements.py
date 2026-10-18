"""The app's regional worlds carry every building measurement their website twins do.

They were built once without them -- no wall colour, no facade, the default height where
the lidar had measured a roof -- and the app is what people open. ``tools/
restore_app_building_measurements.py`` put them back; this keeps them there.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
APP = sorted(p.parent.name for p in (ROOT / "docs/app-regions").glob("*/sf-corridor-3d.json")
             if (ROOT / "docs/regions" / p.parent.name / "sf-corridor-3d.json").exists())
MEASURED = {"lidar_region", "datasf_lidar_median_height", "osm_height"}


def _buildings(path: Path) -> list[dict]:
    return [w for w in json.loads(path.read_text())["ways"] if w.get("kind") == "building"]


@pytest.mark.parametrize("region", APP)
def test_app_buildings_keep_what_was_measured(region: str) -> None:
    app = _buildings(ROOT / "docs/app-regions" / region / "sf-corridor-3d.json")
    web = _buildings(ROOT / "docs/regions" / region / "sf-corridor-3d.json")
    for key in ("colour", "facade"):
        assert sum(bool(w.get(key)) for w in app) >= sum(bool(w.get(key)) for w in web), key
    assert (sum(w.get("height_source") in MEASURED for w in app)
            >= sum(w.get("height_source") in MEASURED for w in web))
