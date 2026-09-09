"""Run the renderer's geometry rules, rather than reading them.

Every check on this renderer so far has been a search for a string in its source, and a string
in a source file is not a guarantee about anything. It cannot tell a guard that keeps pavement
off the road from a guard so tight it deletes the pavement, because both contain the words. Two
regressions in a row got through that way: a carriageway guard that erased 63 of the 201 km of
mapped footway in the corridor and left black along the kerb, and ground cover with no guard at
all that laid front paths down the middle of the street. Both passed every test in the file.

So these extract the actual functions out of the page and execute them, against a street whose
geometry is known, and assert what ends up on the ground. They are slower and they are worth it:
they fail when the behaviour changes, which is the only time a test about behaviour should fail.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_sf_corridor_3d.py"

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is needed to run the renderer's own code")


def _page_js() -> str:
    """The JavaScript the page ships, out of the Python that writes it."""
    text = SOURCE.read_text(encoding="utf-8")
    start = text.index('<script type="module">')
    return text[start:text.index("</script>", start)]


def _extract(name: str, js: str) -> str:
    """One top-level function, by brace matching from its body.

    From its body, not from its declaration: a destructured parameter puts a brace in the
    signature, and matching from the first one closes the function before it has started.
    """
    head = f"function {name}("
    i = js.index(head)
    depth = 0
    body = -1
    for k in range(i + len(head) - 1, len(js)):        # walk the parameter list to its close
        if js[k] == "(":
            depth += 1
        elif js[k] == ")":
            depth -= 1
            if depth == 0:
                body = js.index("{", k)
                break
    assert body > 0, f"{name} has no body"
    depth = 0
    for k in range(body, len(js)):
        if js[k] == "{":
            depth += 1
        elif js[k] == "}":
            depth -= 1
            if depth == 0:
                return js[i:k + 1]
    raise AssertionError(f"{name} is not closed")


#: Everything the carriageway rules need, and nothing else. Pulled by name so that renaming one
#: breaks the test loudly instead of silently skipping the thing it was meant to check.
CARRIAGEWAY_FUNCTIONS = (
    "distanceToSegmentSquared",
    "insideCarriageway",
    "addCarriagewaySegment",
    "lerpLonLat",
    "wayLength",
    "pavementRunsOutsideCarriageway",
)

#: A flat local frame, the same shape as the page's, with the origin at the test street.
PREAMBLE = """
const CARRIAGEWAY_CELL = 30;
const carriagewayGrid = new Map();
const metersPerLat = 111320;
const metersPerLon = 88000;
function xy(lon, lat) { return [lon * metersPerLon, lat * metersPerLat]; }
"""


def _run(js_body: str) -> dict:
    js = _page_js()
    parts = [PREAMBLE]
    parts += [_extract(name, js) for name in CARRIAGEWAY_FUNCTIONS]
    parts.append(js_body)
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


#: A single east-west street, twelve metres of carriageway, one kilometre long. Everything below
#: is measured against it, in metres, so the numbers in the assertions are street dimensions.
STREET = """
const ROAD_W = 12.0;
for (let x = -500; x < 500; x += 20) {
  addCarriagewaySegment(x, 0, x + 20, 0, ROAD_W / 2);
}
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
"""


def test_a_footway_against_the_kerb_is_not_deleted() -> None:
    """The regression that left black along every kerb.

    A pavement abuts the carriageway -- that is what a pavement is. Its inner edge sits on the
    kerb line and its centreline is only half its width clear of the road. A guard that inflates
    the carriageway and then asks about the centreline deletes it, and deleted it for 63 km.
    """
    result = _run(STREET + """
    const walk = 3.6;
    // The centreline of a footway laid immediately outside a six metre half-carriageway.
    const centre = ROAD_W / 2 + walk / 2;
    const points = [];
    for (let x = -400; x <= 400; x += 25) points.push(asLonLat(x, centre));
    const runs = pavementRunsOutsideCarriageway(points, walk);
    const kept = runs.reduce((sum, run) => sum + wayLength(run), 0);
    console.log(JSON.stringify({ kept: Math.round(kept), asked: Math.round(wayLength(points)) }));
    """)
    # Nearly all of it: a footway that touches the kerb is a footway, not an obstruction.
    assert result["kept"] > result["asked"] * 0.95, result


def test_a_footway_laid_across_the_road_is_removed() -> None:
    """The opposite regression, and the reason the guard exists at all."""
    result = _run(STREET + """
    const walk = 3.6;
    const points = [];
    for (let x = -400; x <= 400; x += 25) points.push(asLonLat(x, 0));   // straight down the road
    const runs = pavementRunsOutsideCarriageway(points, walk);
    const kept = runs.reduce((sum, run) => sum + wayLength(run), 0);
    console.log(JSON.stringify({ kept: Math.round(kept) }));
    """)
    assert result["kept"] == 0, result


def test_a_footway_crossing_the_road_keeps_only_the_part_outside_it() -> None:
    """It splits, rather than surviving whole or vanishing whole."""
    result = _run(STREET + """
    const walk = 3.0;
    // Runs along well clear of the road, cuts across it, and comes back out the far side.
    const points = [];
    for (let x = -300; x <= -60; x += 20) points.push(asLonLat(x, 30));
    points.push(asLonLat(-20, 0));
    points.push(asLonLat(20, 0));
    for (let x = 60; x <= 300; x += 20) points.push(asLonLat(x, 30));
    const runs = pavementRunsOutsideCarriageway(points, walk);
    console.log(JSON.stringify({
      runs: runs.length,
      kept: Math.round(runs.reduce((s, r) => s + wayLength(r), 0)),
    }));
    """)
    assert result["runs"] >= 2, result
    assert result["kept"] > 400, result


def test_the_carriageway_guard_never_widens_the_road() -> None:
    """A negative slack is the bug, stated directly.

    ``insideCarriageway`` takes a slack that shrinks the carriageway before testing. Passing a
    negative one widens it instead, and that single sign is what erased the footways. Nothing in
    the pavement rules is allowed to ask the question that way.
    """
    js = _page_js()
    body = _extract("pavementRunsOutsideCarriageway", js)
    calls = re.findall(r"insideCarriageway\([^;]*?\)", body, flags=re.S)
    assert calls, "the guard no longer asks about the carriageway at all"
    for call in calls:
        slack = call.rsplit(",", 1)[-1].strip(" )\n")
        assert not slack.startswith("-"), f"guard widens the carriageway: {call}"


def test_ground_cover_is_clipped_off_the_carriageway() -> None:
    """Parcels are surveyed to the property line, which is often inside the kerb.

    A thousand ground rings in this corridor reach into the roadway and 753 of them are front
    frontages that draw with the pavement texture -- the concrete slabs in the middle of the
    street. The renderer has to refuse them however good the data claims to be.
    """
    js = _page_js()
    body = _extract("ringGeometry", js)
    assert "clipToRoad" in body, "ring geometry no longer has a carriageway clip"
    assert "insideCarriageway" in body, "the clip does not consult the carriageway"
    # And it is on by default, because the caller that forgets is the one that puts a garden in
    # the road.
    assert re.search(r"function ringGeometry\(rings, y, clipToRoad = true\)", js)


def test_lane_markings_are_painted_with_a_width() -> None:
    """A marking one pixel wide is not a marking.

    The double yellow down the middle of every two-way street was two THREE.Line objects, which
    are one pixel wide at any distance. Two threads with dark road between them is what the
    centre of a wide street looked like, and it was read -- correctly -- as a missing separator.
    """
    js = _page_js()
    assert "function paintedLine(points, width, color, y" in js
    marking = _extract("paintedLine", js)
    assert "mitredEdges(points, width)" in marking, "the marking has no width"
    assert "new THREE.Mesh(" in marking, "the marking is not geometry"
    # The centre line and the lane lines both go through it.
    assert "paintedLine(offsetWay(renderPoints, side * apart), MARK_W" in js
    assert "paintedLine(offsetWay(renderPoints, offset), MARK_W" in js
    # Four inches, which is what the MUTCD says and what San Francisco paints.
    assert re.search(r"const MARK_W = 0\.10\d?;", js)


def test_a_street_is_never_drawn_wider_than_the_room_it_has() -> None:
    """The cause of most of the black along the kerb, and of pavement laid over roads.

    Widths come from the recorded right of way wherever the kerbs were not surveyed, and a right
    of way is the whole street -- carriageway, footways and setbacks. Drawn as carriageway it
    reaches over whatever is beside it, and beside it is very often another street: an alley in
    the block, a service road along an avenue, the far half of a divided road. Trenton Street's
    pavement was sitting four metres inside a neighbour's carriageway, and being deleted for it.
    """
    js = _page_js()
    assert "function clampRoadWidthsToNeighbours(ways)" in js
    assert "clampRoadWidthsToNeighbours(DATA.ways);" in js, "the clamp is defined but never run"
    body = _extract("clampRoadWidthsToNeighbours", js)
    assert "laneCountForWay(way)" in body, "a street with stated lanes must keep room for them"

    functions = ("distanceToSegmentSquared", "laneCountForWay", "nominalRoadWidth",
                 "renderedRoadWidth", "clampRoadWidthsToNeighbours")
    parts = ["""
    const metersPerLat = 111320;
    const metersPerLon = 88000;
    function xy(lon, lat) { return [lon * metersPerLon, lat * metersPerLat]; }
    const MIN_RENDER_ROAD_M = 2.8;
    const MAX_RENDER_ROAD_M = 24.0;
    const MAX_INFERRED_ROAD_M = 16.5;
    """]
    parts += [_extract(name, js) for name in functions]
    parts.append("""
    const at = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
    // An avenue whose recorded right of way is 16.5 m, with an alley eight metres off it. The
    // avenue drawn at 16.5 would cover the alley and both of their pavements.
    const avenue = { kind: "street", road_m: 16.5,
                     points: [at(-200, 0), at(200, 0)] };
    const alley = { kind: "street", road_m: 4.0,
                    points: [at(-200, 8), at(200, 8)] };
    // And a four lane street with a service road beside it, which keeps its four lanes.
    const boulevard = { kind: "street", road_m: 16.0, lanes: 4,
                        points: [at(-200, 400), at(200, 400)] };
    const service = { kind: "street", road_m: 4.0,
                      points: [at(-200, 407), at(200, 407)] };
    const ways = [avenue, alley, boulevard, service];
    clampRoadWidthsToNeighbours(ways);
    console.log(JSON.stringify({
      avenue: +renderedRoadWidth(avenue).toFixed(2),
      alley: +renderedRoadWidth(alley).toFixed(2),
      boulevard: +renderedRoadWidth(boulevard).toFixed(2),
    }));
    """)
    out = subprocess.run([NODE, "-e", "\n".join(textwrap.dedent(p) for p in parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    widths = json.loads(out.stdout)

    # The avenue may not reach the alley eight metres away.
    assert widths["avenue"] <= 8.0 + 0.01, widths
    # And it is still a street, not a footpath.
    assert widths["avenue"] >= 4.0, widths
    # The alley keeps its own narrow width; nothing widens it.
    assert widths["alley"] <= 4.0 + 0.01, widths
    # Four stated lanes keep room for four stated lanes even with something seven metres away.
    assert widths["boulevard"] >= 12.0, widths


def test_roof_furniture_is_geometry_at_real_sizes() -> None:
    """A solar array is modules in rows, not a pattern painted on a tiling texture.

    It was the second: one 50x28 pixel rectangle in a 128 pixel tile that the roof repeated two
    and a half times in each direction, so a house with panels wore six copies of the same array
    at whatever size the tiling gave them, cut off at the tile edges and squared to nothing.
    """
    js = _page_js()
    assert "const SOLAR_MODULE = { long: 1.70, short: 1.00" in js, "modules have no real size"
    body = _extract("solarArray", js)
    # Rows and columns of modules, stepped by the module size plus its rail gap.
    assert "SOLAR_MODULE.gap" in body
    assert "for (let c = 0; c < cols; c += 1)" in body
    assert "for (let r = 0; r < rows; r += 1)" in body
    # And it refuses rather than laying an array on a roof that cannot hold one.
    assert "if (cols < 2 || rows < 2) return false;" in body


def test_solar_only_goes_on_a_flat_rectangular_roof() -> None:
    """The user's rule, and the physical one: an array needs a rectangle to sit in."""
    js = _page_js()
    placement = _extract("addRoofFurniture", js)
    assert 'if (use === "solar")' in placement
    assert "if (!roof.squarish || areaM2 < 90) continue;" in placement
    # `squarish` is measured off the footprint's own rectangle, at the angle the roof is at.
    # Measured against a north-aligned box instead, the median San Francisco building filled
    # 0.666 of it -- the grid runs twenty to forty degrees off north -- and 681 of the 690 roofs
    # that came up for an array were refused as ragged when every one was a rectangle.
    shape = _extract("roofRectangle", js)
    assert "convexHull(local)" in shape, "the roof rectangle is not oriented to the roof"
    assert "footprint / best.area" in shape
    assert "squarish:" in shape and "> 0.82" in shape


def test_every_roof_use_has_a_stated_frequency_and_variants() -> None:
    """How common each is, written down, rather than a coin flip per building."""
    js = _page_js()
    assert "const ROOF_USE = {" in js
    table = js[js.index("const ROOF_USE = {"):js.index("};", js.index("const ROOF_USE = {"))]
    for archetype in ("residential", "office", "hotel", "industrial"):
        assert archetype in table, archetype
    # Solar is rare in this part of the city and must be stated as rare.
    residential = re.search(r"residential:\s*\[(.*?)\]\s*,\s*\n", table, flags=re.S)
    assert residential, table
    solar = re.search(r'\["solar",\s*([0-9.]+)\]', residential.group(1))
    assert solar and float(solar.group(1)) <= 0.10, residential.group(1)
    # Two to five renderings of each, so a street does not repeat one deck down its length.
    for name, marker in (("roofDeck", "variant === 0"), ("roofGarden", "variant === 0")):
        body = _extract(name, js)
        assert marker in body, name
        assert "variant === 1" in body, name


def test_a_shed_is_not_drawn_as_a_house() -> None:
    """726 small footprints deep inside blocks were being extruded to 10.5 m with windows on.

    The height came from `inferred_default` -- the corridor median -- applied to a garden
    workshop, and the treatment came from the residential archetype. Both are decided here off
    the two things the data does say: the footprint area, and where the height came from.
    """
    js = _page_js()
    body = _extract("structureClass", js)
    assert "CANOPY_TAGS.has(tag)" in body, "building=roof is still extruded as a building"
    assert "OUTBUILDING_TAGS.has(tag)" in body
    # A height OpenStreetMap states is believed; a lidar median over a tiny footprint is not.
    assert 'feature.height_source === "osm_height"' in body
    assert 'feature.height_source === "inferred_default"' in body
    assert "SLENDER_LIMIT" in body
    # And the consequences: a canopy is not drawn, an outbuilding is capped and plain.
    assert 'if (kind === "canopy") return null;' in js
    assert "OUTBUILDING_MAX_M" in js
    assert "outbuildingTexture(seed)" in js
    assert 'kind === "outbuilding" ? outbuildingRoofTexture(seed)' in js


def test_every_awning_kind_exists_and_the_flat_board_is_the_common_one() -> None:
    """Five kinds, and the one San Francisco actually has most of is not an awning at all.

    A `board` is a painted or cut-letter sign fixed flat to the wall above the glass. It is the
    commonest thing on a shopfront here by a wide margin, and a set of awning types that leaves
    it out gets the street wrong however good the canvas looks.
    """
    js = _page_js()
    for kind in ("board", "straight", "dome", "shed", "retractable"):
        assert f'"{kind}"' in js, kind
    for builder in ("buildBoard", "buildSloped", "buildDome", "buildShed"):
        assert f"function {builder}(" in js, builder
    # Every trade's mix has to be a distribution, and board has to lead in most of them.
    table = js[js.index("const AWNING_MIX = {"):js.index("};", js.index("const AWNING_MIX = {"))]
    rows = re.findall(r"(\w+):\s*\{([^}]*)\}", table)
    assert len(rows) >= 12, len(rows)
    leads = 0
    for trade, body in rows:
        shares = {k: float(v) for k, v in re.findall(r"(\w+):\s*([0-9.]+)", body)}
        assert abs(sum(shares.values()) - 1.0) < 1e-6, (trade, shares)
        if max(shares, key=shares.get) == "board":
            leads += 1
    assert leads > len(rows) * 0.7, f"the flat board leads in only {leads} of {len(rows)} trades"


def test_a_long_shop_name_is_set_smaller_rather_than_overflowing() -> None:
    js = _page_js()
    body = _extract("signSlot", js)
    assert "SIGN_MAX_PX" in body and "SIGN_MIN_SCALE" in body
    assert "scale = Math.max(SIGN_MIN_SCALE, scale * 0.9)" in body, "the name is never shrunk"
    # And the measurement respects the trade's letter spacing, or a tracked sign overflows.
    assert "measureTracked(ctx, text, style.track * scale)" in body


def test_the_name_curves_with_a_dome_awning() -> None:
    """Flat text in front of a curved awning reads as a sticker. The sign is laid on the same
    arc the canvas is, one strip per arc segment, so it curves because the awning curves."""
    js = _page_js()
    body = _extract("buildDome", js)
    assert "const arc = [];" in body
    # The sign strips walk the same arc array the canvas does.
    assert "for (let i = from; i < to; i += 1)" in body
    assert "slot.v0 + (slot.v1 - slot.v0)" in body


def test_the_underside_of_an_awning_is_shaded_rather_than_flat() -> None:
    js = _page_js()
    assert "function underTones(colour)" in js
    for builder in ("buildSloped", "buildShed"):
        body = _extract(builder, js)
        assert "[lip, lip, deep, deep]" in body, builder
    dome = _extract("buildDome", js)
    assert "deep.clone().lerp(lip, shade)" in dome


def test_awnings_and_signs_do_not_cost_a_draw_call_each() -> None:
    """Two thousand seven hundred signs, each with different words on it, and still a handful of
    meshes: the words go into a shared atlas and the awning's colour goes on its vertices."""
    js = _page_js()
    assert "function emitShopfronts()" in js
    assert "emitShopfronts();" in js
    assert "const SIGN_ATLAS_PX = 2048;" in js
    body = _extract("awningMaterial", js)
    assert "vertexColors: true" in body
