"""A fill on the road side of a kerb is road; beyond the kerb it keeps its kind."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import inferred_roadway_to_asphalt as tool

LAT0, LON0 = 37.80, -122.43
KX = 111_320.0 * 0.790155   # cos(37.8 deg), near enough for a 100 m test
KY = 111_320.0


def ll(x, y):
    return [round(LON0 + x / KX, 7), round(LAT0 + y / KY, 7)]


def write(tmp: Path, inferred):
    bbox = {"south": LAT0 - 0.001, "north": LAT0 + 0.001, "west": LON0 - 0.001, "east": LON0 + 0.001}
    # An east-west street 10 m wide along y = 0, its kerbs at y = +-5.
    (tmp / "sf-corridor-3d.json").write_text(json.dumps({"bbox": bbox, "ways": [
        {"kind": "street", "road_m": 10.0, "points": [ll(-60, 0), ll(60, 0)]}]}))
    (tmp / "sf-corridor-official.json").write_text(json.dumps({"curb_lines": [
        {"c": "curb", "p": [ll(-60, 5), ll(60, 5)]}, {"c": "curb", "p": [ll(-60, -5), ll(60, -5)]}]}))
    (tmp / "sf-corridor-ground.json").write_text(json.dumps({"inferred": inferred}))


def ring(x0, y0, x1, y1):
    return [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]


def test_a_fill_in_the_lanes_is_asphalt_and_one_past_the_kerb_is_not(tmp_path):
    write(tmp_path, [
        {"k": "paving", "p": ring(-4, 1, 4, 3)},       # between the kerbs
        {"k": "paving", "p": ring(-4, 7, 4, 9)},       # on the far side of the north kerb
        {"k": "grass", "p": ring(-20, 2, -12, 8)},     # across the north kerb
    ])
    tool.process(tmp_path)
    out = json.loads((tmp_path / "sf-corridor-ground.json").read_text())["inferred"]
    lanes = [i for i in out if i.get("was") == "paving" and i["k"] == "asphalt"]
    assert len(lanes) == 1
    assert any(i["k"] == "paving" and "was" not in i for i in out)        # the footway one kept
    kinds = sorted(i["k"] for i in out if i.get("was") == "grass" or (i["k"] == "grass"))
    assert kinds == ["asphalt", "grass"]                                    # split at the kerb
    # A second run moves nothing more.
    before = json.dumps(out)
    tool.process(tmp_path)
    assert json.loads((tmp_path / "sf-corridor-ground.json").read_text())["inferred"] == json.loads(before)
