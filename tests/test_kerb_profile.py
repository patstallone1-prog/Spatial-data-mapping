"""The curb as San Francisco pours it, and the sidewalk's squares, run from the page's own code.

Public Works Standard Plan 87,185: a six-inch top, a rounded nose, the street face battered one
in four over its six-inch exposure. The sidewalk is scored in four-foot squares counted from the
property line; the curb's top is the plain lip the last row stops at. These extract the page's ribbon and run it on a
straight kerb with the road to one side, then read the vertices that come out.
"""

from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from tests.test_corridor_geometry_rules import _extract, _page_js

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")

STUBS = """
const THREE = {
  BufferGeometry: class { constructor() { this.a = {}; } setAttribute(n, v) { this.a[n] = v; } setIndex(i) { this.index = i; } computeVertexNormals() {} },
  Float32BufferAttribute: class { constructor(array, size) { this.array = array; this.itemSize = size; } },
  Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; } },
  Group: class {},
};
const surfaceMaterial = (surface) => ({ surface });
const crossingStripePhase = () => 0;
const xy = (east, north) => [east, north];   // the page's metres: z is minus north
const SLAB_M = 0.9144, WALK_ROW_MAX_M = 1.3716, SLAB_BLOCK = 4, WALK_UV_M = SLAB_M * SLAB_BLOCK, NARROW_SLAB_M = 2.75;
const BIKE_LANE_M = 1.5, CROSSING_PERIOD_M = 1.2, DIVIDER_TILE_M = 0.6;
// The road is everything south of z = 0; the kerb band runs east along it, just north.
const insideCarriageway = (x, z) => z < 0;
"""


def _run(body: str) -> dict:
    js = _page_js()
    names = ["norm", "mitredEdges", "kerbStreetSide", "walkRowM", "surfaceScale", "ribbon"]
    constants = []
    for name in ("MAX_MITRE", "KERB_PROFILE"):
        start = js.index(f"const {name} =")
        constants.append(js[start:js.index(";", start) + 1])
    script = "\n".join([STUBS, *constants, *(_extract(n, js) for n in names), body])
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_kerb_has_six_inch_top_rounded_nose_and_battered_face() -> None:
    # Six inches across, centred 7.6 cm north of the road edge, from the road's top down 0.6 m.
    result = _run("""
const lip = 0.1524, y = -0.2, thickness = 0.6, top = y + thickness / 2;
const out = [];
for (const points of [[[0, -lip / 2], [10, -lip / 2]], [[10, -lip / 2], [0, -lip / 2]]]) {
  const mesh = ribbon(points, lip, 0xffffff, 1, y, thickness, "kerb");
  const p = mesh.geometry.a.position.array;
  const at = [];
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) < 1e-6) at.push([+p[i + 2].toFixed(4), +(p[i + 1] - top).toFixed(4)]);
  out.push(at);
}
const rows = [0.6, 1.3, 1.6, 2, 3, 3.5, 4.3].map((w) => walkRowM(w));
console.log(JSON.stringify({ out, uv: surfaceScale("walk", 2), kerbScale: surfaceScale("kerb", lip), rows }));
""")
    for section in result["out"]:              # either way the kerb's way runs
        on_top = [z for z, h in section if abs(h) < 1e-4]
        # The top stops a nose's radius short of the street edge (z = 0) and reaches the back.
        assert min(on_top) == pytest.approx(0.025, abs=1e-3)
        assert max(on_top) == pytest.approx(0.1524, abs=1e-3)
        face = [(z, h) for z, h in section if h < -1e-4 and z < 0.03]
        # The nose: points between the top and 2.5 cm down, rounding out to the edge.
        nose = [(z, h) for z, h in face if -0.0251 < h]
        assert len(nose) >= 3 and min(z for z, _ in nose) == pytest.approx(0.0, abs=1e-3)
        # The face battered one in four: at six inches down it stands out 3.1 cm into the gutter.
        toe = [z for z, h in face if h == pytest.approx(-0.15, abs=1e-3)]
        assert toe and toe[0] == pytest.approx(-0.25 * (0.15 - 0.025), abs=1e-3)
        # Nothing of the street side stands plumb at the edge from top to bottom any more.
        assert not any(z == pytest.approx(0.0, abs=1e-4) and h < -0.03 for z, h in section)
    # One texture repeat is four three-foot squares along the walk and the curb alike; across
    # the walk, four of its own rows: a 2 m walk is two rows of a metre.
    assert result["uv"] == pytest.approx([0.9144 * 4, 1.0 * 4])
    assert result["kerbScale"] == pytest.approx([0.9144 * 4, 0.9144 * 4])
    # The rows across share the width out evenly: three feet stretched up to four and a half,
    # one more row past that, never a thin part-row at an edge.
    widths = [0.6, 1.3, 1.6, 2, 3, 3.5, 4.3]
    assert result["rows"] == pytest.approx([0.6, 1.3, 0.8, 1.0, 1.0, 3.5 / 3, 4.3 / 4])
    for w, h in zip(widths, result["rows"], strict=True):
        n = w / h
        assert n == pytest.approx(round(n)), "a whole number of rows"
        assert h <= 1.3716 + 1e-9 or w < 1.3716


def test_sidewalk_and_curb_take_their_finishes_near_the_eye() -> None:
    js = _page_js()
    assert "const KERB_LIP_M = 0.1524;" in js
    assert 'const SIDEWALK = NEAR_SURFACE.mark(sidewalkTexture(), "sidewalk");' in js
    assert 'NEAR_SURFACE.mark(sidewalkTexture("curb"), "curb")' in js
    script = "\n".join([
        "const THREE = { Vector3: class { constructor(...a) { this.a = a; } } };",
        "const sharedAsset = (p) => p;",
        js[js.index("const NEAR_SURFACE ="):js.index("//: Into a material's shader")],
        "const walk = NEAR_SURFACE.scoredColor('walk'), curb = NEAR_SURFACE.scoredColor('curb');",
        "console.log(JSON.stringify({ kinds: NEAR_SURFACE.kinds, walk, curb, none: NEAR_SURFACE.scoredColor(undefined),",
        "  normal: NEAR_SURFACE.scoredNormal('walk') }));",
    ])
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got["kinds"]["sidewalk"]["photo"] == "concrete" and got["kinds"]["sidewalk"]["scored"] == "walk"
    # The curb is one long troweled strip and a driveway's apron one plain pour: no joints in
    # either, in the walk's own concrete.
    for plain in ("curb", "apron"):
        # The walk's own finish (the broom) without the walk's joints.
        assert got["kinds"][plain].get("scored") == "lip"
        assert got["kinds"][plain]["photo"] == "concrete"
        assert got["kinds"][plain]["mean"] == got["kinds"]["sidewalk"]["mean"]
        assert got["kinds"][plain]["relief"] == got["kinds"]["sidewalk"]["relief"]
    # Three-foot squares; the joints only on the walk (on "curb"/"lip" the joint test is off).
    assert got["kinds"]["sidewalk"]["slab_m"] == pytest.approx(0.9144)
    assert "vec2(0.91440)" in got["walk"]
    assert "1.0 > 0.5 && kbSwUp > 0.5 ? min(kbSwD.x, kbSwD.y) : 9.0" in got["walk"]
    assert "0.0 > 0.5 && kbSwUp > 0.5" in got["curb"]
    # The joint is shadow in the same concrete: it only darkens, no colour of its own.
    assert "kbSwC *= 1.0 - 0.42 * kbSwGroove;" in got["walk"] and "kbSwMargin" not in got["walk"]
    assert got["none"] == ""
    assert "dFdx(vMapUv)" in got["normal"]


def test_surveyed_curb_section_keeps_its_survey_and_takes_the_standard_shape() -> None:
    js = _page_js()
    start = js.index("const KERB_PROFILE =")
    script = "\n".join([
        js[start:js.index(";", start) + 1],
        _extract("sfCurbSection", js),
        "const a = sfCurbSection([[0, 0], [-0.015, 0.126], [-0.165, 0.126]]);",
        "const b = sfCurbSection([[0.165, 0.126], [0.015, 0.126], [0, 0]]);",
        "console.log(JSON.stringify({ a, b }));",
    ])
    out = subprocess.run([NODE, "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    a, b = got["a"], got["b"]
    # Toe first stays toe first (its faces keep facing out); the mirror image stays mirrored.
    assert a[0] == [0, 0] and b[-1] == [0, 0]
    assert a[-1] == pytest.approx([-0.165, 0.126]) and b[0] == pytest.approx([0.165, 0.126])
    # The face is battered one in four up to the nose, and the nose is rounded over several points.
    x1, y1 = a[1]
    assert x1 / y1 == pytest.approx(-0.25, abs=0.01)
    nose = [p for p in a if 0.09 < p[1] < 0.126]
    assert len(nose) >= 3
    # The top is level from the nose back to the surveyed back.
    assert all(p[1] == pytest.approx(0.126) for p in a[-2:])
    assert [c for x, y in a for c in (-x, y)] == pytest.approx([c for p in reversed(b) for c in p])
