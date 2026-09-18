"""The one comparison that says whether a street is drawn as wide as it is.

The renderer has the city's kerb lines, its lidar and its curb assets, and until this file no
test compared what it drew to any of them: 234 assertions read the source for literals, and the
geometry audit checked the drawing against itself. Twice the widths regressed -- a lane cap
applied to measured kerbs, a neighbour clamp that squeezed the Stockton Tunnel to the street
on the hill above it -- and nothing failed.

This runs the renderer's own width rules over the payload and reads kerb-to-kerb off the city's
lines every eight metres along each way (``widthVsKerb`` in scripts/audit_corridor_render.py),
then holds the result to the baseline in data/sf_corridor/audits/width_vs_kerb.json. A change
may make the numbers better; when it does, regenerate the baseline on purpose. It may not make
them worse.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "data" / "sf_corridor" / "audits" / "width_vs_kerb.json"
PAGE = ROOT / "docs" / "sf-corridor-3d.json"


@pytest.fixture(scope="module")
def report() -> dict:
    if not PAGE.exists():
        pytest.skip("no built corridor payload to audit")
    out = subprocess.run([sys.executable, str(ROOT / "scripts" / "audit_corridor_render.py")],
                         cwd=ROOT, capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def baseline() -> dict:
    return json.loads(BASELINE.read_text(encoding="utf-8"))


def test_streets_are_drawn_between_the_citys_kerbs(report: dict, baseline: dict) -> None:
    width = report["widthVsKerb"]
    # Half the corridor's streets within five centimetres of the city's kerbs, and never
    # fewer of them than the baseline had.
    assert width["medianAbsM"] <= baseline["medianAbsM"] + 0.05, width["medianAbsM"]
    assert width["enveloped"] >= baseline["enveloped"] * 0.97, (width["enveloped"], baseline["enveloped"])
    # The count drawn more than three metres too narrow or too wide may only fall.
    assert width["tooNarrowOver3M"] <= baseline["tooNarrowOver3M"] + 2, width["tooNarrowOver3M"]
    assert width["tooWideOver3M"] <= baseline["tooWideOver3M"] + 2, width["tooWideOver3M"]


def test_measured_widths_stay_measured(report: dict, baseline: dict) -> None:
    by_source = report["widthVsKerb"]["bySource"]
    for source in ("curb_geometry", "official_curbs"):
        assert by_source[source]["medianAbsM"] <= baseline["bySource"][source]["medianAbsM"] + 0.1, source
        assert by_source[source]["over3M"] <= baseline["bySource"][source]["over3M"] + 2, source


def test_a_way_on_another_level_keeps_its_measured_width(report: dict) -> None:
    """The Stockton Tunnel was 6.5 m wide because Stockton Street on the hill over it counted
    as a neighbour to make room for. A tunnel, a bridge, anything with a layer, is drawn at
    the width the city measured for it."""
    levels = report["widthVsKerb"]["otherLevels"]
    assert levels["clamped"] == 0, levels["rows"]


def test_the_rest_of_the_audit_does_not_slip(report: dict, baseline: dict) -> None:
    assert report["crosswalk"]["attachedShare"] >= baseline["crosswalkAttachedShare"] - 0.02
    assert report["footway"]["keptShare"] >= baseline["footwayKeptShare"] - 0.02
    assert report["kerbside"]["share"] <= baseline["kerbsideBareShare"] + 0.01


def test_streets_and_buildings_keep_out_of_each_other(report: dict, baseline: dict) -> None:
    """A roadway never runs through the houses either side of it -- the building line is the
    width's fallback where the city drew no kerb -- and a building never stands on the
    carriageway. Both counts may only fall."""
    buildings = report["widthVsKerb"]["buildings"]
    assert buildings["roadThroughFacade"] <= baseline["roadThroughFacade"] + 2, buildings
    assert buildings["onRoad2plus"] <= baseline["buildingsOnRoad2plus"] + 5, buildings
