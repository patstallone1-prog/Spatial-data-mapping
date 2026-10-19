"""The conductor between two supports hangs as a catenary set by one realistic tension."""

from __future__ import annotations

import json
import re
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _run(body: str) -> dict:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [0-9.]+;", js).group(0)
                       for name in ("WIRE_CATENARY_A_M", "WIRE_SAMPLES"))
    script = consts + "\n" + _extract("catenaryPoints", js) + "\n" + body
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_forty_metre_span_sags_about_a_metre_and_sag_grows_with_the_square_of_the_span() -> None:
    result = _run("""
    const sag = (L) => {
      const pts = []; catenaryPoints({ x: 0, y: 10, z: 0 }, { x: L, y: 10, z: 0 }, pts);
      let low = Infinity; for (let i = 1; i < pts.length; i += 3) low = Math.min(low, pts[i]);
      return { sag: 10 - low, first: pts.slice(0, 3), last: pts.slice(-3) };
    };
    console.log(JSON.stringify({ s25: sag(25), s40: sag(40), s60: sag(60) }));
    """)
    assert result["s40"]["sag"] == pytest.approx(1.0, abs=0.06)
    assert result["s25"]["sag"] == pytest.approx(0.39, abs=0.05)
    assert result["s60"]["sag"] == pytest.approx(2.25, abs=0.1)
    # The conductor starts and ends on its attachment points.
    assert result["s40"]["first"] == pytest.approx([0, 10, 0], abs=1e-6)
    assert result["s40"]["last"] == pytest.approx([40, 10, 0], abs=1e-6)


def test_a_span_between_supports_at_different_heights_ends_on_both() -> None:
    result = _run("""
    const pts = []; catenaryPoints({ x: 0, y: 9, z: 0 }, { x: 0, y: 12, z: 45 }, pts);
    let low = Infinity, at = 0;
    for (let i = 1; i < pts.length; i += 3) if (pts[i] < low) { low = pts[i]; at = pts[i + 1]; }
    console.log(JSON.stringify({ first: pts.slice(0, 3), last: pts.slice(-3), low, at }));
    """)
    assert result["first"] == pytest.approx([0, 9, 0], abs=1e-6)
    assert result["last"] == pytest.approx([0, 12, 45], abs=1e-6)
    # The lowest point moves toward the lower support and below it.
    assert result["low"] < 9 and result["at"] < 22.5


def _trolley(body: str) -> dict:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0)
                       for name in ("TROLLEY", "TROLLEY_JOIN_M", "TROLLEY_END_SPAN_BACK_M"))
    script = "\n".join([consts, *(_extract(f, js) for f in ("trolleyChains", "mitredOffsets",
                                                              "trolleySpanStations")), body])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_route_turning_the_corner_is_one_line_and_its_wires_turn_with_it() -> None:
    """Fillmore Street's wire comes down to Green Street and turns west along it: two ways
    meeting at the junction. They are one line, and each offset wire turns the corner at its
    own distance from the middle instead of stopping square across the junction."""
    result = _trolley("""
    const fillmore = { oneway: false, path: [[0, -80], [0, 0]] };       // south down Fillmore
    const green = { oneway: false, path: [[-90, 0], [0, 0]] };          // Green, drawn eastward
    const chains = trolleyChains([fillmore, green]);
    const m = mitredOffsets(chains[0].path);
    const corner = chains[0].path.findIndex(([x, z]) => x === 0 && z === 0);
    console.log(JSON.stringify({ n: chains.length, path: chains[0].path, open: [chains[0].startOpen, chains[0].endOpen],
      corner: m[corner], offset: [m[corner][0] * m[corner][2] * 2.4, m[corner][1] * m[corner][2] * 2.4] }));
    """)
    assert result["n"] == 1 and len(result["path"]) == 3
    assert result["open"] == [True, True]
    # 2.4 m from both streets' middles at the corner: the diagonal is 2.4 * sqrt(2) long.
    assert abs(result["offset"][0]) == pytest.approx(2.4, abs=1e-6)
    assert abs(result["offset"][1]) == pytest.approx(2.4, abs=1e-6)


def test_ways_at_a_junction_of_three_and_one_way_ways_head_to_head_stay_apart() -> None:
    result = _trolley("""
    const t = trolleyChains([{ oneway: false, path: [[0, 0], [50, 0]] }, { oneway: false, path: [[50, 0], [100, 0]] },
                             { oneway: false, path: [[50, 0], [50, 60]] }]);
    const h = trolleyChains([{ oneway: true, path: [[0, 0], [50, 0]] }, { oneway: true, path: [[100, 0], [50, 0]] }]);
    const tail = trolleyChains([{ oneway: true, path: [[0, 0], [50, 0]] }, { oneway: true, path: [[50, 0], [90, 0]] }]);
    console.log(JSON.stringify({ t: t.length, tEnds: t.map((c) => [c.startOpen, c.endOpen]), h: h.length, tail: tail.length }));
    """)
    assert result["t"] == 3, "a junction of three is not a bend: each way keeps its own line"
    assert all(False in ends for ends in result["tEnds"])
    assert result["h"] == 2 and result["tail"] == 1


def test_every_line_ends_on_a_span() -> None:
    result = _trolley("""
    console.log(JSON.stringify({ open: trolleySpanStations(100, true, true),
      junction: trolleySpanStations(100, false, false), short: trolleySpanStations(8, false, false) }));
    """)
    assert result["open"][0] == 0 and result["open"][-1] == 100
    assert result["junction"][0] == 6 and result["junction"][-1] == 94
    assert all(b - a <= 36 + 1e-9 for a, b in zip(result["junction"], result["junction"][1:], strict=False))
    assert result["short"] == [4]


def test_fillmore_and_green_are_one_line_in_the_published_corridor() -> None:
    from pathlib import Path

    furniture = json.loads((Path(__file__).resolve().parents[1] / "docs/sf-corridor-furniture.json").read_text())
    ways = {w["id"]: w for w in furniture["inferred"]["trolley_wires"]}
    fillmore, green = ways["osm:trolley_wire:way:148902181"], ways["osm:trolley_wire:way:254759929"]
    k = 88_000
    paths = [{"oneway": bool(w["oneway"]), "path": [[(lon + 122.4) * k, -(lat - 37.79) * 111_000]
                                                    for lon, lat in w["points"]]} for w in (fillmore, green)]
    result = _trolley(f"console.log(JSON.stringify(trolleyChains({json.dumps(paths)}).length));")
    assert result == 1
