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


def test_a_corner_is_a_curve_held_by_pull_offs_never_a_square_turn_in_the_air() -> None:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0)
                       for name in ("TROLLEY_BEND_DEG", "TROLLEY_CURVE_R_M"))
    script = consts + "\n" + _extract("filletTrolleyPath", js) + """
    const r = filletTrolleyPath([[0, -60], [0, 0], [-60, 0]]);           // a right-angle turn
    const p = r.path, turns = [];
    for (let i = 1; i < p.length - 1; i += 1) {
      const a = [p[i][0] - p[i-1][0], p[i][1] - p[i-1][1]], b = [p[i+1][0] - p[i][0], p[i+1][1] - p[i][1]];
      turns.push(Math.acos((a[0]*b[0] + a[1]*b[1]) / Math.hypot(...a) / Math.hypot(...b)) * 180 / Math.PI);
    }
    const straight = filletTrolleyPath([[0, 0], [0, 40], [1, 80]]);
    console.log(JSON.stringify({ n: p.length, maxTurn: Math.max(...turns), bends: r.bends, straight: straight.path.length }));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["maxTurn"] <= 20 + 1e-6, "no chord of the curve turns sharply"
    assert len(r["bends"]) == 1 and r["straight"] == 3
    bend = r["bends"][0]
    # The pull-off pole stands outside the turn: away from the inside corner at (-, -).
    assert bend["out"][0] > 0.5 and bend["out"][1] > 0.5
    wires = _extract("addTrolleyWires", js)
    assert "const { path, bends } = filletTrolleyPath(cleaned);" in wires
    assert "segments.push(...tie, w[0], groundAt(...w) + TROLLEY.height, w[1]);" in wires, "a pull-off to every wire"


def test_a_mapped_power_line_turns_only_on_a_pole() -> None:
    network = _extract("addElectricalNetwork", _page_js())
    assert "if (cos > Math.cos(POWER_BEND_DEG * Math.PI / 180)) continue;" in network
    assert "inferred:line_bend_pole:" in network and "inferred: true" in network
    assert "if (unsupportedBends.has(`${line.id}:${i - 1}`) || unsupportedBends.has(`${line.id}:${i}`)) continue;" in network


#: How many pairs of junction links between the same two ways cross each other: JavaScript over
#: ``links`` and ``ends``. (One street's wires crossing the other's is the crossing, not this.)
_CROSSED = """links.reduce((n, [i, j], u) => n + links.slice(u + 1).filter(([k, l]) => {
        const [a, b, c, d] = [i, j, k, l].map((q) => ends[q]);
        if (a.node !== c.node || new Set([a.chain, b.chain, c.chain, d.chain]).size !== 2) return false;
        const side = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
        return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
      }).length, 0)"""


def test_wires_at_chestnut_and_fillmore_go_on_across_the_junction() -> None:
    """Five ways meet at Chestnut and Fillmore (Fillmore splits into two one-way ways north of
    it), so none is chained: every wire stopped at the junction's middle, a few metres short of
    the wire going on across. Each is joined to the one going on nearly straight."""
    from pathlib import Path

    furniture = json.loads((Path(__file__).resolve().parents[1] / "docs/sf-corridor-furniture.json").read_text())
    node = [-122.4362626, 37.8008199]
    ways = [w for w in furniture["inferred"]["trolley_wires"] if node in (w["points"][0], w["points"][-1])]
    assert len(ways) == 5
    k = 88_000
    paths = [{"oneway": bool(w["oneway"]), "path": [[(lon + 122.4) * k, -(lat - 37.79) * 111_000]
                                                    for lon, lat in w["points"]]} for w in ways]
    js = _page_js()
    links = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0) for name in ("TROLLEY_LINK_DEG", "TROLLEY_LINK_M"))
    result = _trolley(links + "\n" + _extract("trolleyJunctionLinks", js) + f"""
    const node = [(-122.4362626 + 122.4) * {k}, -(37.8008199 - 37.79) * 111000];
    const ends = [];
    trolleyChains({json.dumps(paths)}).forEach((chain, c) => {{
      const p = chain.path, m = mitredOffsets(p);
      const offsets = chain.oneway ? [TROLLEY.onewayOffset - TROLLEY.pair / 2, TROLLEY.onewayOffset + TROLLEY.pair / 2]
        : [-TROLLEY.laneOffset - TROLLEY.pair / 2, -TROLLEY.laneOffset + TROLLEY.pair / 2,
           TROLLEY.laneOffset - TROLLEY.pair / 2, TROLLEY.laneOffset + TROLLEY.pair / 2];
      for (const [i, j] of [[0, 1], [p.length - 1, p.length - 2]]) {{
        if (Math.hypot(p[i][0] - node[0], p[i][1] - node[1]) > 0.5) continue;
        const dx = p[j][0] - p[i][0], dz = p[j][1] - p[i][1], l = Math.hypot(dx, dz);
        for (const o of offsets) ends.push({{ node: "n", chain: c, x: p[i][0] + m[i][0] * m[i][2] * o,
          z: p[i][1] + m[i][1] * m[i][2] * o, dx: dx / l, dz: dz / l }});
      }}
    }});
    const links = trolleyJunctionLinks(ends);
    console.log(JSON.stringify({{ ends: ends.length, links: links.length,
      gaps: links.map(([i, j]) => Math.hypot(ends[i].x - ends[j].x, ends[i].z - ends[j].z)),
      straight: links.map(([i, j]) => ends[i].dx * ends[j].dx + ends[i].dz * ends[j].dz),
      crossed: {_CROSSED} }}));
    """)
    assert result["ends"] == 16
    assert result["links"] == 8, "every wire into the junction goes on across it"
    assert max(result["gaps"]) <= 5 and max(result["straight"]) < -0.75
    assert result["crossed"] == 0, "no wire of a pair goes over the other on its way across"


def test_a_wire_is_never_joined_to_one_turning_off_or_far_across_the_junction() -> None:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0) for name in ("TROLLEY_LINK_DEG", "TROLLEY_LINK_M"))
    script = consts + "\n" + _extract("trolleyJunctionLinks", js) + """
    const ends = [
      { node: "n", chain: 0, x: 0, z: 2.4, dx: -1, dz: 0 },   // from the west
      { node: "n", chain: 1, x: 0, z: 2.6, dx: 1, dz: 0 },    // on to the east: joined
      { node: "n", chain: 2, x: 2.4, z: 0, dx: 0, dz: 1 },    // a cross street: never
      { node: "n", chain: 3, x: 0, z: -9, dx: 1, dz: 0 },     // straight on but 9 m over: never
      { node: "m", chain: 4, x: 0, z: 2.5, dx: 1, dz: 0 },    // another junction: never
    ];
    console.log(JSON.stringify(trolleyJunctionLinks(ends)));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout) == [[0, 1]]


def _links(ends: list[dict]) -> list[list[int]]:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0) for name in ("TROLLEY_LINK_DEG", "TROLLEY_LINK_M"))
    script = consts + "\n" + _extract("trolleyJunctionLinks", js) + f"""
    const ends = {json.dumps(ends)};
    const links = trolleyJunctionLinks(ends);
    console.log(JSON.stringify({{ links, crossed: {_CROSSED} }}));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_one_way_pair_into_a_two_way_street_goes_on_as_a_pair() -> None:
    """Fillmore's northbound pair (1.1 and 1.7 m east of its middle) into the two-way street's
    east pair (2.07 and 2.67 m): joined nearest first, 1.7 took 2.07 and 1.1 went over it to
    2.67 -- the pair crossed in the air. Each wire goes on in its place, the pair to the pair."""
    north = [{"node": "n", "chain": 0, "x": x, "z": 0.0, "dx": 0, "dz": -1} for x in (1.1, 1.7)]
    south = [{"node": "n", "chain": 1, "x": x, "z": 0.1, "dx": 0, "dz": 1} for x in (-2.67, -2.07, 2.07, 2.67)]
    result = _links(north + south)
    assert result["crossed"] == 0
    assert sorted(result["links"]) == [[0, 4], [1, 5]], "1.1 to 2.07 and 1.7 to 2.67: the east pair"


def test_a_pair_jogging_sideways_over_a_turned_street_does_not_cross() -> None:
    """Over Market Street a pair goes on into a way turned 25 degrees and two metres over: in
    their order across the first way, the two joins crossed; they are made the other way round."""
    a = [{"node": "n", "chain": 0, "x": x, "z": z, "dx": 0.05, "dz": -1} for x, z in ((-176.65, 131.15), (-176.05, 131.17))]
    b = [{"node": "n", "chain": 1, "x": x, "z": z, "dx": -0.46, "dz": 0.89} for x, z in ((-173.98, 131.74), (-173.45, 132.01))]
    result = _links(a + b)
    assert len(result["links"]) == 2 and result["crossed"] == 0


def test_no_wires_cross_on_their_way_through_any_junction_of_the_corridor() -> None:
    from pathlib import Path

    furniture = json.loads((Path(__file__).resolve().parents[1] / "docs/sf-corridor-furniture.json").read_text())
    k = 88_000
    paths = [{"oneway": bool(w["oneway"]), "path": [[(lon + 122.4) * k, -(lat - 37.79) * 111_000] for lon, lat in w["points"]]}
             for w in furniture["inferred"]["trolley_wires"]]
    js = _page_js()
    links = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0) for name in ("TROLLEY_LINK_DEG", "TROLLEY_LINK_M"))
    result = _trolley(links + "\n" + _extract("trolleyJunctionLinks", js) + f"""
    const ends = [];
    const nodeOf = ([x, z]) => `${{Math.round(x / TROLLEY_JOIN_M)}},${{Math.round(z / TROLLEY_JOIN_M)}}`;
    trolleyChains({json.dumps(paths)}).forEach((chain, c) => {{
      const p = chain.path, m = mitredOffsets(p);
      const offsets = chain.oneway ? [TROLLEY.onewayOffset - TROLLEY.pair / 2, TROLLEY.onewayOffset + TROLLEY.pair / 2]
        : [-TROLLEY.laneOffset - TROLLEY.pair / 2, -TROLLEY.laneOffset + TROLLEY.pair / 2,
           TROLLEY.laneOffset - TROLLEY.pair / 2, TROLLEY.laneOffset + TROLLEY.pair / 2];
      for (const [open, i, j] of [[chain.startOpen, 0, 1], [chain.endOpen, p.length - 1, p.length - 2]]) {{
        if (open) continue;
        const dx = p[j][0] - p[i][0], dz = p[j][1] - p[i][1], l = Math.hypot(dx, dz) || 1;
        for (const o of offsets) ends.push({{ node: nodeOf(p[i]), chain: c, x: p[i][0] + m[i][0] * m[i][2] * o,
          z: p[i][1] + m[i][1] * m[i][2] * o, dx: dx / l, dz: dz / l }});
      }}
    }});
    const links = trolleyJunctionLinks(ends);
    console.log(JSON.stringify({{ links: links.length, crossed: {_CROSSED} }}));
    """)
    # 31 joins crossed another at 21 junctions (Chestnut and Fillmore, Columbus, Van Ness, Market).
    assert result["links"] >= 390
    assert result["crossed"] == 0


def test_where_two_streets_wires_cross_a_black_steel_frame_holds_them() -> None:
    js = _page_js()
    consts = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0)
                       for name in ("TROLLEY_FRAME_MARGIN_M", "TROLLEY_FRAME_CLUSTER_M", "TROLLEY_FRAME_MIN_DEG"))
    script = consts + "\n" + _extract("trolleyCrossingFrames", js) + """
    // A north-south pair (x = 2.1, 2.7) under an east-west pair (z = -0.3, 0.3), and a third
    // wire alongside the first pair that crosses nothing at a sharp angle.
    const segs = [[2.1, -10, 2.1, 10], [2.7, -10, 2.7, 10], [-10, -0.3, 10, -0.3], [-10, 0.3, 10, 0.3],
      [3.3, -10, 3.5, 10]].map(([ax, az, bx, bz]) => ({ node: "n", a: [ax, az], b: [bx, bz] }));
    const frames = trolleyCrossingFrames(segs.slice(0, 4));
    const parallel = trolleyCrossingFrames([segs[0], segs[1], segs[4]]);
    console.log(JSON.stringify({ frames, parallel: parallel.length }));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert len(r["frames"]) == 1 and r["parallel"] == 0
    f = r["frames"][0]
    assert f["x"] == pytest.approx(2.4, abs=1e-6) and f["z"] == pytest.approx(0, abs=1e-6)
    # Round the four crossing points, a quarter metre past them every way.
    assert f["hu"] == pytest.approx(0.55, abs=1e-6) and f["hv"] == pytest.approx(0.55, abs=1e-6)
    wires = _extract("addTrolleyWires", js)
    assert "const frames = trolleyCrossingFrames(junctionWires);" in wires
    assert "color: 0x141617" in wires


def test_span_wires_hold_the_contact_wires_from_high_on_the_poles() -> None:
    """The span was strung straight between the poles a metre over the contact wires, holding
    nothing. It is tied high on the pole, comes down to just over the wires, and a hanger goes
    down to each."""
    js = _page_js()
    trolley = json.loads(re.sub(r"(\w+):", r'"\1":', re.search(r"const TROLLEY = (\{[^}]+\});", js).group(1)))
    wood = json.loads(re.sub(r"(\w+):", r'"\1":', re.search(r"const TROLLEY_WOOD_POLE = (\{[^}]+\});", js).group(1)))
    hanger = float(re.search(r"const TROLLEY_HANGER_M = ([0-9.]+);", js).group(1))
    assert trolley["height"] + hanger < trolley["crossAt"] < trolley["poleHeight"]
    assert trolley["height"] + hanger < wood["crossAt"] < wood["height"]
    assert wood["height"] > trolley["poleHeight"], "the wooden poles are the tall ones"
    wires = _extract("addTrolleyWires", js)
    assert "const over = [x, y + TROLLEY_HANGER_M, z];" in wires
    assert "segments.push(...from, ...over, ...over, x, y, z);" in wires, "down to over the wire, a hanger to it"


def test_chestnut_hangs_its_wire_from_wooden_poles_with_the_corners_names_on_them() -> None:
    js = _page_js()
    assert 'const TROLLEY_WOOD_STREETS = new Set(["Chestnut Street"]);' in js
    wires = _extract("addTrolleyWires", js)
    assert "wood: TROLLEY_WOOD_STREETS.has(wire.name)," in wires
    assert '"furniture:utility_pole"' in wires and "plateSlot(row)" in wires
    assert "trolley_wires: addTrolleyWires(inferred.trolley_wires || [], lights.rows, corners)," in js
    consts = "\n".join(re.search(rf"const {name} = [^\n]+;", js).group(0)
                       for name in ("TROLLEY_CORNER_REACH_M", "TROLLEY_CORNER_SPAN_GAP_M"))
    script = consts + "\n" + _extract("trolleyCornerStations", js) + """
    // A 200 m line along x, spans every 36 m; corners beside it at 50 m and 120 m, one off it.
    const path = [[0, 0], [200, 0]], lengths = [0, 200];
    const stations = [6, 42, 78, 114, 150, 194];
    console.log(JSON.stringify(trolleyCornerStations(stations, path, lengths, [[50, 9], [120, -8], [90, 40]])));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    # The spans at 42 and 114 give way to the corners' at 50 and 120; the corner 40 m off has none.
    assert json.loads(out.stdout) == [6, 50, 78, 120, 150, 194]
