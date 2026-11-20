"""The photograph's verdicts: the journal, the frame and what the page does with them (no image
library needed; the judging itself is tests/test_imagery_truth.py)."""

import json
from pathlib import Path

import pytest

from smc.truth import imagery_truth as it

ROOT = Path(__file__).resolve().parents[1]


def test_the_journal_keeps_every_result_and_goes_on_from_where_it_stopped(tmp_path):
    path = tmp_path / "run.jsonl"
    j = it.Journal(path)
    j.put("bus_zone:1.0:2.0", {"task": "bus_zone", "verdict": "pad"})
    j.put("legend:3.0:4.0", {"task": "legend", "verdict": "absent"})
    # Stopped part-way through a line.
    with path.open("a") as f:
        f.write('{"key":"legend:5.0:6.0","task":"leg')
    again = it.Journal(path)
    assert again.done("bus_zone:1.0:2.0") and again.done("legend:3.0:4.0") and not again.done("legend:5.0:6.0")
    assert [r["verdict"] for r in again.of("legend")] == ["absent"]
    assert len(path.read_text().splitlines()) == 3


def test_the_frame_is_fitted_both_ways():
    pairs = [[x, z, -122.44 + x * 1.136e-5 + z * 2e-9, 37.80 - z * 8.98e-6 + x * 1e-9] for x in (-500, 0, 800) for z in (-300, 0, 400)]
    f = it.Frame.fit(pairs)
    assert f.residual_m < 0.01
    x, z = f.from_lonlat(*f.lonlat(123.4, -56.7))
    assert x[0] == pytest.approx(123.4, abs=1e-6) and z[0] == pytest.approx(-56.7, abs=1e-6)


def test_the_page_has_the_verdicts_and_keeps_to_them():
    doc = json.loads((ROOT / "docs/imagery-truth.json").read_text())
    assert doc["schema"] == "kerbside.imagery_truth/1" and {"x", "z", "lon", "lat"} <= set(doc["check"])
    verdicts = {r["verdict"] for r in doc["bus_zones"]}
    assert verdicts <= {"red", "pad", it.ABSENT, it.UNSEEN} and len(doc["bus_zones"]) >= 20
    assert all(r["verdict"] == it.ABSENT for r in doc["legends"])
    m21 = (ROOT / "src/smc/renderer/page/module/21-the-electrical-network-poles-towers.js").read_text()
    assert 'seen.verdict !== "red"' in m21 and 'sharedAsset("imagery-truth.json")' in m21
    m20 = (ROOT / "src/smc/renderer/page/module/20-station-entrances-a-stair-down.js").read_text()
    assert 'imageryVerdict("legends", c.x, c.z, 4)?.verdict === "absent"' in m20
    # The ground is drawn as what the photographs say it is, where they could say.
    m18 = (ROOT / "src/smc/renderer/page/module/18-inside-the-parks-playgrounds-dog.js").read_text()
    assert 'seenAs("inferred", item) || item.k' in m18 and 'seenAs("plazas", y)' in m18 and "await loadImageryTruth();" in m18
    assert set(doc.get("ground", {})) <= {"plazas", "service_yards", "inferred"}
    assert all(kind in ("grass", "paving", "asphalt") for rows in doc.get("ground", {}).values() for kind in rows.values())
    # Every building that has a footprint stands (the Moscone Park sheds, the Lombard Garage).
    m15 = (ROOT / "src/smc/renderer/page/module/15-interchanges-every-deck-s-height.js").read_text()
    assert "const building = buildingMesh(way);" in m15 and "way.covered ? buildingMesh(way) : null" not in m15
    assert "feature._carPark = true" in (ROOT / "src/smc/renderer/page/module/12-what-a-roof-is-made.js").read_text()


def test_the_runner_and_the_exporter_are_as_the_notes_say():
    import py_compile

    runner = ROOT / "tools/build_imagery_truth.py"
    py_compile.compile(str(runner), doraise=True)
    text = runner.read_text()
    assert "--journal" in text and "page_file(" in text and "Journal(" in text
    exporter = (ROOT / "tools/truth/export_candidates.mjs").read_text()
    for surface in ("bus_zone:fill", "furniture:road_legend", "waterworks:gutter", "inferred:paving", "plaza"):
        assert f'"{surface}"' in exporter
    assert "out.buildings" in exporter and "out.frame" in exporter, "footprints (no court on a roof) and the frame"
