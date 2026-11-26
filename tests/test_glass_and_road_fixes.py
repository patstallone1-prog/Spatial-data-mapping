"""Glass that mirrors at a slant, office glass tinted dark, and this round's road paint fixes."""

from __future__ import annotations

import itertools
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")


def _node(parts: list[str]) -> dict:
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_painted_windows_are_marked_glass_in_the_wall_pictures_alpha() -> None:
    js = _page_js()
    mark = _extract("markGlass", js)
    # Panes half, lit panes three quarters: cut out of the opaque wall picture, nothing drawn twice.
    assert 'globalCompositeOperation = "destination-out"' in mark
    assert "rgba(0,0,0,0.5)" in mark.replace(" ", "") and "rgba(0,0,0,0.25)" in mark.replace(" ", "")
    facade = _extract("facadeFor", js)
    assert "PANE_SINK = panes" in facade and "markGlass(ctx, panes" in facade


def test_wall_glass_mirrors_more_at_a_slant_and_more_the_darker_it_is() -> None:
    js = _page_js()
    glass = _extract("facadeGlass", js)
    # Schlick's curve from a little face on to a mirror at a slant, from the one shared cube.
    assert "pow(1.0 - kbCos" in glass and "glassCube()" in glass
    assert "FACADE_GLASS.tint_face" in glass and "kbDark" in glass
    # Office glass is its own dark colour, not the building's paint; metal mirrors in its colour.
    assert "FACADE_GLASS.curtain_rgb" in glass and "kbF0 = clamp(diffuseColor.rgb" in glass
    real = _extract("realGlass", js)
    assert "GLASS.tint_reflection" in real and "kbTintDark" in real
    # Every wall kind gets it: storeys, bands, the shell, the home designs.
    assert "facadeGlass(walls, material)" in js and "facadeGlass(bandWalls" in js
    assert "facadeGlass(homeDecalMaterial)" in js


def test_office_glass_is_light_blue_tinted_and_shows_the_floor_behind_it() -> None:
    js = _page_js()
    start = js.index("const FACADE_GLASS = Object.freeze(")
    block = js[start:js.index("});", start)]
    # Lighter than the 0.42 dark blue-green that read as black (2026-11-26), and blue.
    assert "curtain_body: 0.78" in block and "curtain_rgb: [0.2, 0.3, 0.4]" in block
    assert "curtain_shift:" in block and "curtain_room:" in block
    glass = _extract("facadeGlass", js)
    # A shade per pane, a shift with the angle, and the room behind found from the ray.
    assert "kbPane" in glass and "kbShift" in glass
    assert "kbD = normalize(kbFW - cameraPosition)" in glass and "kbSee" in glass


@needs_node
def test_crossing_halves_share_one_run_of_bars() -> None:
    js = _page_js()
    out = _node([
        "const CROSSING_PERIOD_M = 0.86;",
        _extract("crossingStripePhase", js),
        _extract("crossingLegPhases", js),
        # A 20 m crossing broken at a 2 m island: legs 0-9 and 11-20, each trimmed 0.48 m.
        "const legs = [Object.assign([], { along: [0, 9] }), Object.assign([], { along: [11, 20] })];",
        "const p = crossingLegPhases(legs, 0.48);",
        "const S0 = 0.48, whole = crossingStripePhase(20 - 0.96);",
        "console.log(JSON.stringify({ p, whole, single: crossingLegPhases([legs[0]], 0.48) }));",
    ])
    period = 0.86
    p0, p1 = out["p"]
    assert abs(p0 - out["whole"]) < 1e-9
    # The second leg's bars sit where the whole crossing's would: its start 11.48 m on.
    expect = (out["whole"] + (11.48 - 0.48) / period) % 1
    assert abs(p1 - expect) < 1e-9
    # A crossing drawn as one leg keeps its own centring.
    assert out["single"] == [None]


@needs_node
def test_a_centre_line_shifting_sideways_is_led_over_on_a_taper() -> None:
    js = _page_js()
    marks = _extract("crossSectionMarks", js)
    assert "CENTRE_TAPER_PER_M = 10" in marks and "CENTRE_SHIFT_MAX_M = 8.0" in marks
    out = _node([
        # A straight way east, x in metres; lon/lat stand in as [x, -z].
        "const xy = (lon, lat) => [lon, lat]; const lonLatFromXZ = (x, z) => [x, -z];",
        "const densifyWay = (p) => { const out = []; for (let x = p[0][0]; x <= p[1][0]; x += 4) out.push([x, 0]); return out; };",
        "const alongDistances = (p) => p.map((q) => q[0] - p[0][0]);",
        "const halfWidthAt = () => 6;",
        # The two directions meet 3 m left of the centreline for the first 80 m, 3 m right after.
        "const crossSectionBands = (way, along) => [{ kind: 'travel', dir: 1, right: along < 80 ? 3 : -3 }, { kind: 'travel', dir: -1 }];",
        "const crossSectionMarkKind = (a, b) => 'centre';",
        marks,
        "const m = crossSectionMarks({ xs: [1] }, [[0, 0], [160, 0]], 0);",
        "console.log(JSON.stringify(m.map((r) => ({ kind: r.kind, pts: r.points.map(([x, y]) => [x, +y.toFixed(3)]) }))));",
    ])
    assert len(out) == 1, out
    pts = out[0]["pts"]
    ys = [y for _, y in pts]
    # One run, no step bigger than the taper allows (6 m across over 60 m along: 0.4 per 4 m, eased).
    assert max(abs(b - a) for a, b in itertools.pairwise(ys)) < 0.75
    assert ys[0] == pytest.approx(3) and ys[-1] == pytest.approx(-3)


def test_no_pad_where_a_crossing_ends_in_the_road() -> None:
    js = _page_js()
    road = _extract("crossingEndInRoad", js)
    assert "pavementTopAt(x, z) !== undefined" in road and "insideCarriageway(x, z, 0)" in road
    assert "crossingEndOnDivider(end, before) !== null || crossingEndInRoad(end, before)" in js


def test_crossbike_dashes_skip_an_island() -> None:
    js = _page_js()
    on = _extract("crossbikeDashOnIsland", js)
    assert "islandKerbsAround(mx, mz, ux, uz, 6)" in on and "islandKerbsAround(mx, mz, -uz, ux, 6)" in on
    assert "if (crossbikeDashOnIsland(dash)) continue;" in js


def test_a_caller_does_not_take_the_phone_out_again_when_they_stop() -> None:
    src = (ROOT / "docs/city/npc-figures.mjs").read_text()
    assert "PHONE_GRACE_S" in src and "samePull" in src
    assert 'want.split(":pull-")[1] === a.prev.split(":pull-")[1]' in src


def test_tobler_constant_is_the_published_one() -> None:
    src = (ROOT / "docs/city/walk-plan.mjs").read_text()
    assert "Math.exp(-3.5 * Math.abs(g + 0.05))" in src
    assert math.isclose(math.exp(-3.5 * 0.05), 0.8395, rel_tol=1e-3)
