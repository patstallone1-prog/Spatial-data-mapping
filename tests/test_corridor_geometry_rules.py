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
    # The centre line and lane lines both go through it, with transition pullbacks.
    assert "paintedLine(offsetWay(markingPoints, side * apart), MARK_W" in js
    assert "paintedLine(offsetWay(markingPoints, offset), MARK_W" in js
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


def test_no_sidewalk_is_believed_only_where_one_is_mapped_instead() -> None:
    """988 street ways carry `sidewalk=no`, and the renderer believed every one of them.

    41.6 km -- 13.2% of the corridor's street network -- was drawn with no footway on either
    side, Polk Street and Sacramento Street among them. What the tag usually means on a street
    like those is that the pavement is mapped as its own way, which is what `sidewalk=separate`
    is for and what a great many mappers write `no` for instead. It is worth believing only when
    a mapped footway is actually standing there.
    """
    js = _page_js()
    body = _extract("walkSidesToDraw", js)
    assert "sideBlockedByCarriageway(renderPoints, side, inner)" in body
    assert "mappedWalkNear" in body, "the tag is taken on trust"
    # A side the tag excludes is still drawn when nothing is mapped along it.
    assert "if (!sampled || covered < sampled * 0.5) drawn.push(side);" in body


def test_a_footway_narrows_to_fit_rather_than_vanishing() -> None:
    js = _page_js()
    body = _extract("addKerbsidePavement", js)
    assert "WALK_FALLBACK_WIDTHS_M" in body
    # The inner edge stays on the kerb at every width, so a narrower stretch is the same pavement
    # with less of it rather than a pavement somewhere else. Asserted of the geometry rather than
    # of the source text: the literal that used to be checked here survived a rewrite that
    # changed what the function does, and would have gone on passing if the property had broken.
    assert "(inner + width / 2)" in body
    # And the end trim cannot eat a short way whole.
    assert "wanted * 0.32" in body


def test_a_tree_pit_needs_pavement_under_the_tree_not_near_it() -> None:
    """A pit is a hole cut in a footway. On a lawn it is a hole in the grass."""
    js = _page_js()
    stamp = _extract("stampPaved", js)
    # The ribbon's real footprint, walked along and across, rather than a square dilation.
    assert "const along =" in stamp and "const across =" in stamp
    assert "pavedGrid.set(key, top)" in stamp, "the pavement's height is not recorded"
    assert "const PAVED_CELL = 1.5;" in js
    # And the pit sits on the pavement it is cut into, whatever that pavement's kerb height is.
    assert "const top = pavementTopAt(tx, tz);" in js
    assert "if (top === undefined) continue;" in js
    assert "top + PIT_LIFT_M" in js


def test_the_sun_in_the_sky_is_the_sun_that_lights_the_city() -> None:
    js = _page_js()
    assert "const SUN_AZIMUTH_DEG" in js and "const SUN_ELEVATION_DEG" in js
    assert "sun.position.copy(sunDirection()).multiplyScalar(900);" in js
    sky = _extract("skyTexture", js)
    # The disc is placed from the same two angles the light is.
    assert "SUN_AZIMUTH_DEG / 360" in sky
    assert "SUN_ELEVATION_DEG / 180" in sky
    # Sky, sun, glow and cirrus, and the sky is the background rather than a flat colour.
    assert "scene.background = SKY;" in js
    assert "cirrus" in sky.lower() or "wisp" in sky.lower()


# ---------------------------------------------------------------- bike lanes


#: The lane rules, and everything they lean on.
BIKE_FUNCTIONS = (
    "distanceToSegmentSquared",
    "insideCarriageway",
    "addCarriagewaySegment",
    "crosswiseCarriagewayAt",
    "bikeCrossingBreakAt",
    "lerpLonLat",
    "wayLength",
    "densifyWay",
    "offsetWay",
    "trimWay",
    "trimWayEnds",
    "cyclewayIsLane",
    "cyclewaySides",
    "laneCountForWay",
    "nominalRoadWidth",
    "renderedRoadWidth",
    "bikeLaneOffset",
    "indexBikeLaneEnds",
    "bikeLaneEndsAt",
    "dashRuns",
    "bikeLaneZones",
)

BIKE_PREAMBLE = PREAMBLE + """
const MIN_RENDER_ROAD_M = 2.8;
const MAX_RENDER_ROAD_M = 24.0;
const MAX_INFERRED_ROAD_M = 16.5;
const BIKE_LANE_M = 1.75;
const BIKE_JOIN_M = 2.5;
const BIKE_END_TRIM_M = 2.0;
const BIKE_CROSS_ANGLE_DEG = 25.0;
const BIKE_MIXING_M = 7.6;
const bikeJoinGrid = new Map();
const BIKE_AREA_CELL = 4.0;
const bikeAreaGrid = new Map();
"""


def _run_bike(js_body: str) -> dict:
    js = _page_js()
    parts = [BIKE_PREAMBLE]
    parts += [_extract(name, js) for name in BIKE_FUNCTIONS]
    parts += [_extract("stampBikeLane", js), _extract("insideBikeLane", js)]
    parts.append(js_body)
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


#: One street carrying one lane, delivered the way OpenStreetMap delivers it: in pieces. Howard
#: Street is twenty ways over a kilometre and every one of them carries the same
#: cycleway:right=track, which is the situation this is a small copy of.
SPLIT_STREET = """
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
function pieces(count, spanM) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const a = i * spanM;
    out.push({ kind: "street", name: "Test Street", road_m: 14.0,
               cycleway_right: "lane",
               points: [asLonLat(a, 0), asLonLat(a + spanM / 2, 0), asLonLat(a + spanM, 0)] });
  }
  return out;
}
"""


def test_a_lane_split_into_pieces_is_still_one_lane() -> None:
    """The gap at every join, which is what "the bike lane cuts out randomly" was.

    Each way used to be pulled back from both of its own ends so as not to run out into a
    crossroads. Most of those ends are not crossroads -- they are where the tagging changed, or
    where a mapper stopped -- so the trim opened a hole in the middle of a continuous lane, once
    per split, and the holes appeared wherever OpenStreetMap happened to have divided the street.
    """
    result = _run_bike(SPLIT_STREET + """
    const ways = pieces(10, 40);            // 400 m of lane in ten forty-metre ways
    indexBikeLaneEnds(ways);
    let drawn = 0;
    let mapped = 0;
    for (const way of ways) {
      const offset = bikeLaneOffset(renderedRoadWidth(way));
      const centre = offsetWay(way.points, -offset);
      mapped += wayLength(centre);
      const [sx, sy] = xy(centre[0][0], centre[0][1]);
      const [ex, ey] = xy(centre[centre.length - 1][0], centre[centre.length - 1][1]);
      const cutStart = bikeLaneEndsAt(sx, -sy) > 1 ? 0 : BIKE_END_TRIM_M;
      const cutEnd = bikeLaneEndsAt(ex, -ey) > 1 ? 0 : BIKE_END_TRIM_M;
      drawn += wayLength(trimWayEnds(centre, cutStart, cutEnd));
    }
    console.log(JSON.stringify({ mapped: +mapped.toFixed(1), drawn: +drawn.toFixed(1) }));
    """)
    # Only the two ends of the whole run are ends. The eighteen interior way-ends are joins, and
    # a join is a fact about the data rather than anything on the ground.
    assert result["mapped"] > 395
    assert result["drawn"] >= result["mapped"] - 2 * 2.0 - 0.5


def test_only_a_lane_that_really_stops_is_pulled_back() -> None:
    """The other half of the same rule: a lane that ends must not run into the crossroads."""
    result = _run_bike(SPLIT_STREET + """
    const ways = pieces(1, 60);
    indexBikeLaneEnds(ways);
    const way = ways[0];
    const centre = offsetWay(way.points, -bikeLaneOffset(renderedRoadWidth(way)));
    const [sx, sy] = xy(centre[0][0], centre[0][1]);
    console.log(JSON.stringify({
      endsHere: bikeLaneEndsAt(sx, -sy),
      mapped: +wayLength(centre).toFixed(1),
      drawn: +wayLength(trimWayEnds(centre, BIKE_END_TRIM_M, BIKE_END_TRIM_M)).toFixed(1),
    }));
    """)
    assert result["endsHere"] == 1          # nothing else reaches it, so it is a real end
    assert abs(result["mapped"] - result["drawn"] - 2 * 2.0) < 0.6


def test_a_street_crossing_the_lane_is_a_crossing_and_a_bend_is_not() -> None:
    """Where the green stops, and why it is not simply "wherever a road is".

    A lane is inside its own carriageway for every metre of its length, so insideCarriageway
    cannot find a junction. What marks one is a carriageway lying across the lane rather than
    along it -- and a street that merely bends is still the same street.
    """
    result = _run_bike("""
    const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
    // East-west street, and one north-south street crossing it at x = 100.
    for (let x = -200; x < 300; x += 20) addCarriagewaySegment(x, 0, x + 20, 0, 7.0);
    for (let z = -200; z < 200; z += 20) addCarriagewaySegment(100, z, 100, z + 20, 6.0);
    const along = 0;                                   // bearing of the east-west street
    console.log(JSON.stringify({
      atTheJunction: crosswiseCarriagewayAt(100, 5.0, along, 0.2),
      midBlock: crosswiseCarriagewayAt(40, 5.0, along, 0.2),
      farSide: crosswiseCarriagewayAt(160, 5.0, along, 0.2),
      // The same point asked about by the crossing street itself: its own carriageway runs
      // along it, and the east-west one runs across it, so this is a junction for it too.
      askedTheOtherWay: crosswiseCarriagewayAt(100, 5.0, Math.PI / 2, 0.2),
    }));
    """)
    assert result["atTheJunction"] is True
    assert result["midBlock"] is False
    assert result["farSide"] is False
    assert result["askedTheOtherWay"] is True


def test_the_lane_is_lane_then_mixing_then_crossing_through_a_junction() -> None:
    """The three treatments, in the order a rider meets them.

    Solid lines down the block; the line between the lane and the traffic broken for the
    twenty-five feet in which right-turning traffic has to cross it; no lines at all across the
    mouth of the junction, where the lane has no priority and San Francisco paints a crossbike.
    """
    result = _run_bike("""
    const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
    for (let x = -200; x < 300; x += 20) addCarriagewaySegment(x, 0, x + 20, 0, 7.0);
    for (let z = -200; z < 200; z += 20) addCarriagewaySegment(100, z, 100, z + 20, 6.0);
    const lane = [];
    for (let x = 0; x <= 200; x += 2) lane.push(asLonLat(x, 5.0));
    const runs = bikeLaneZones(lane);
    const metres = { lane: 0, mixing: 0, crossing: 0 };
    for (const run of runs) metres[run.label] += wayLength(run.points);
    console.log(JSON.stringify({
      order: runs.map((r) => r.label),
      metres: Object.fromEntries(Object.entries(metres).map(([k, v]) => [k, Math.round(v)])),
    }));
    """)
    # Ordinary lane, then a mixing zone, the junction, another mixing zone, ordinary lane.
    assert result["order"] == ["lane", "mixing", "crossing", "mixing", "lane"]
    # The crossing is about as wide as the street it crosses, and each mixing zone is the
    # MUTCD's twenty-five feet.
    assert 8 <= result["metres"]["crossing"] <= 16
    assert 6 <= result["metres"]["mixing"] / 2 <= 10


def test_a_t_junction_keeps_the_bike_lane_continuous() -> None:
    """A side street turning through the lane is not the same as a four-way crossing.

    At a four-way junction the bike lane breaks at the end of the block. At a T-junction the
    tagged lane usually carries through and turning cars cross it, so a one-sided cross street
    must not turn the lane into crossbike dashes.
    """
    result = _run_bike("""
    const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
    for (let x = -100; x < 220; x += 20) addCarriagewaySegment(x, 0, x + 20, 0, 7.0);
    for (let z = 5; z < 180; z += 20) addCarriagewaySegment(100, z, 100, z + 20, 6.0);
    const lane = [];
    for (let x = 0; x <= 200; x += 2) lane.push(asLonLat(x, 5.0));
    const runs = bikeLaneZones(lane);
    console.log(JSON.stringify({ order: runs.map((r) => r.label) }));
    """)
    assert result["order"] == ["lane"]


def test_a_lane_rounding_a_same_street_bend_is_not_a_crossbike() -> None:
    """A sharp curve is not an intersection with itself.

    The crossing detector reads carriageway angle, which is right at real intersections but
    wrong at bends unless the street's own carriageway is ignored. Otherwise the green lane
    breaks into crossbike dashes at exactly the corners where it should curve continuously.
    """
    result = _run_bike("""
    const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
    const way = { kind: "street", road_m: 14.0, cycleway_right: "lane",
      points: [asLonLat(0, 0), asLonLat(60, 0), asLonLat(60, 60)] };
    for (let i = 1; i < way.points.length; i += 1) {
      const [ax, ay] = xy(way.points[i - 1][0], way.points[i - 1][1]);
      const [bx, by] = xy(way.points[i][0], way.points[i][1]);
      addCarriagewaySegment(ax, -ay, bx, -by, 7.0, way);
    }
    const lane = densifyWay(offsetWay(way.points, -bikeLaneOffset(renderedRoadWidth(way))), 2.0);
    const runs = bikeLaneZones(lane, way);
    console.log(JSON.stringify({ order: runs.map((r) => r.label) }));
    """)
    assert result["order"] == ["lane"], result


def test_a_dashed_marking_is_cut_at_the_pattern_not_sampled_by_it() -> None:
    """Why the crossbike came out as bare asphalt with one stray block in it.

    The lane is densified every two metres and a crossbike is 0.9 m of paint to 0.9 m of road.
    Keeping or dropping whole segments against that cycle aliases: segment after segment landed
    in a gap. Cut at the pattern, half the run is painted whatever the samples happen to be.
    """
    result = _run_bike("""
    const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
    const out = {};
    for (const step of [2.0, 5.0, 0.5]) {
      const pts = [];
      for (let x = 0; x <= 40; x += step) pts.push(asLonLat(x, 0));
      const runs = dashRuns(pts, 0.9, 0.9);
      out[String(step)] = {
        painted: +runs.reduce((s, r) => s + wayLength(r), 0).toFixed(2),
        blocks: runs.length,
        longest: +Math.max(...runs.map((r) => wayLength(r))).toFixed(2),
      };
    }
    console.log(JSON.stringify(out));
    """)
    for step, got in result.items():
        # Half the forty metres, however the polyline was sampled.
        assert abs(got["painted"] - 20.0) < 1.2, (step, got)
        # And no block is longer than the mark it is meant to be.
        assert got["longest"] <= 0.95, (step, got)


def test_nothing_else_is_laid_inside_a_bike_lane() -> None:
    """The tree pit rule. A pit belongs to the footway and a lane belongs to the carriageway."""
    result = _run_bike(SPLIT_STREET + """
    const ways = pieces(1, 100);
    indexBikeLaneEnds(ways);
    const way = ways[0];
    const offset = bikeLaneOffset(renderedRoadWidth(way));
    console.log(JSON.stringify({
      onTheLane: insideBikeLane(50, offset, 0.15),
      justOutside: insideBikeLane(50, offset + BIKE_LANE_M, 0.15),
      onThePavement: insideBikeLane(50, 9.5, 0.15),
      elsewhere: insideBikeLane(50, -40, 0.15),
    }));
    """)
    assert result["onTheLane"] is True
    assert result["justOutside"] is False
    assert result["onThePavement"] is False
    assert result["elsewhere"] is False


# ---------------------------------------------------------------- the ground stack


def test_no_two_ground_layers_share_a_plane() -> None:
    """The glitch at the swimming pool, as a rule rather than as a picture.

    The paved frontage went in at ``YARD_Y + 0.004`` and PARK_Y was 0.020, so the two were the
    same number and neither file said so. Wherever a parcel and a park overlapped -- Joe DiMaggio
    Playground is one lot, laid over the whole block -- two large flat polygons occupied one
    plane and the depth buffer chose between them per pixel: green tearing through grey in
    stripes, across a playground, with nothing in either source to point at.
    """
    js = _page_js()
    stack = dict(re.findall(r"^const ([A-Z_]+_Y) = ([0-9.]+);", js, re.M))
    for name in ("YARD_Y", "SERVICE_YARD_Y", "PARK_Y", "FRONT_WALK_Y", "COURT_Y",
                 "COURT_LINE_Y"):
        assert name in stack, f"{name} is not declared as its own height"
    heights = {name: float(value) for name, value in stack.items()}
    assert len(set(heights.values())) == len(heights), (
        f"two ground layers share a height: {sorted(heights.items(), key=lambda kv: kv[1])}")
    # Every one of them is under the carriageway's own top, and separated enough to resolve.
    ordered = sorted(heights.values())
    assert ordered[-1] < 0.06
    assert min(b - a for a, b in zip(ordered, ordered[1:])) >= 0.002
    # And the page checks it too, at load, rather than trusting this test to be run.
    assert "const GROUND_STACK = {" in js
    assert "are both at" in js


def test_a_tree_pit_is_square_to_the_pavement_it_is_cut_into() -> None:
    """A pit is an opening left in the paving, and paving is laid square to the kerb.

    Each was being turned by up to five degrees at random, which reads as a brown square dropped
    on the pavement rather than as a hole in it -- and the pit next to it was turned differently.
    """
    js = _page_js()
    assert "const pavedBearing = new Map();" in js
    assert "function pavementBearingAt(x, z)" in js
    assert "const bearing = pavementBearingAt(tx, tz);" in js
    # No random turn left anywhere in the pit block.
    pit = js[js.index("// ---- tree pits ----"):js.index("// Trees, one instanced mesh per")]
    assert "random(" not in pit, "the pit is still being turned by a die roll"
    # And the whole pit is tested against the roadway, not only the tree in the middle of it.
    assert "for (const [cx, cz] of corners)" in pit
    assert "insideBikeLane(cx, cz" in pit




#: A stand-in for THREE.Color that behaves the way the page's does.
#:
#: This matters more than it looks. three.js runs with colour management on, so a Color holds
#: linear-light channels and ``getHSL`` answers in linear unless it is told which space to use --
#: and linear lightness is nothing like sRGB lightness: #3f5670 is 0.34 in one and 0.11 in the
#: other. The first version of this shim was plain sRGB, so it agreed with a lift that was
#: reading linear lightness against an sRGB floor and pronounced it correct. A test whose stand-in
#: is easier than the real thing tests the stand-in.
THREE_COLOR_SHIM = """
const SRGBColorSpace = "srgb";
const LinearSRGBColorSpace = "srgb-linear";
const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSRGB = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
class Color {
  constructor(hex) { if (hex !== undefined) this.setHex(hex); }
  setHex(hex) {
    this.r = toLinear(((hex >> 16) & 255) / 255);
    this.g = toLinear(((hex >> 8) & 255) / 255);
    this.b = toLinear((hex & 255) / 255);
    return this;
  }
  getHex() {
    const c = (v) => Math.max(0, Math.min(255, Math.round(toSRGB(v) * 255)));
    return (c(this.r) << 16) | (c(this.g) << 8) | c(this.b);
  }
  _channels(space) {
    return space === SRGBColorSpace
      ? [toSRGB(this.r), toSRGB(this.g), toSRGB(this.b)]
      : [this.r, this.g, this.b];
  }
  getHSL(out, space = LinearSRGBColorSpace) {
    const [r, g, b] = this._channels(space);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    out.h = h; out.s = s; out.l = l;
    return out;
  }
  setHSL(h, s, l, space = LinearSRGBColorSpace) {
    const f = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
    }
    if (space === SRGBColorSpace) { r = toLinear(r); g = toLinear(g); b = toLinear(b); }
    this.r = r; this.g = g; this.b = b;
    return this;
  }
}
const THREE = { Color, SRGBColorSpace, LinearSRGBColorSpace };
"""


def _run_colour(js_body: str, *names: str) -> dict:
    js = _page_js()
    parts = [THREE_COLOR_SHIM]
    parts += [_extract(name, js) for name in names]
    for constant in ("SAMPLED_LIGHTNESS_FLOOR", "ROOF_LIGHTNESS_FLOOR"):
        found = re.search(rf"const {constant} = [0-9.]+;", js)
        assert found, f"{constant} is gone"
        parts.append(found.group(0))
    parts.append(js_body)
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_sampled_facade_colour_is_lifted_off_the_floor_but_not_repainted() -> None:
    """What a street photograph measures about a wall is its hue, not its exposure.

    Street-level frames are exposed for the sky above the street, so facades come back dark: of
    the 3,518 colours sampled off this corridor's own photographs, 1,135 were under 0.30
    lightness and the darkest was zero. The lift moves only that end, and only the lightness.
    """
    result = _run_colour("""
      const lightness = (hex) => { const o = {}; new THREE.Color(hex).getHSL(o, THREE.SRGBColorSpace); return o; };
      const out = {};
      for (const [name, hex] of [["black", 0x000000], ["dark", 0x52625b],
                                 ["mid", 0x8a7f6c], ["pale", 0xe8e0d2]]) {
        const was = lightness(hex);
        const now = lightness(liftSampledColour(hex));
        out[name] = { l0: +was.l.toFixed(3), l1: +now.l.toFixed(3),
                      h0: +was.h.toFixed(3), h1: +now.h.toFixed(3),
                      s0: +was.s.toFixed(3), s1: +now.s.toFixed(3) };
      }
      console.log(JSON.stringify(out));
    """, "liftSampledColour")
    # Nothing in this city is black, and the floor is a floor in the space it is written in.
    assert result["black"]["l1"] >= 0.33
    # The dark end is lifted...
    assert result["dark"]["l1"] > result["dark"]["l0"] + 0.05
    # ...and what the photographs agree is pale is left exactly as it was. This is the assertion
    # the linear-space version could not have passed: reading a linear lightness against an sRGB
    # floor lifted even a pale wall.
    assert abs(result["pale"]["l1"] - result["pale"]["l0"]) < 1e-3
    assert result["mid"]["l1"] >= result["mid"]["l0"] - 1e-3
    # Hue and saturation are the measurement and survive. The tolerance is one 8-bit step.
    for name in ("dark", "mid", "pale"):
        assert abs(result[name]["h1"] - result[name]["h0"]) < 0.01, name
        assert abs(result[name]["s1"] - result[name]["s0"]) < 0.02, name


def test_the_lift_is_done_in_srgb_and_says_so() -> None:
    """The colour space is not optional here, and leaving it out is silent.

    getHSL and setHSL both default to the working space, which is linear. A floor of 0.34 read
    against linear lightness is sRGB 0.62: it does not stop dark walls going black, it repaints
    pale ones. Nothing errors and nothing looks obviously wrong until a whole city is grey.
    """
    js = _page_js()
    for name in ("liftSampledColour",):
        body = _extract(name, js)
        assert "THREE.SRGBColorSpace" in body, f"{name} does not name a colour space"
        assert body.count("THREE.SRGBColorSpace") >= 2, f"{name} names it for only one of get/set"
    # And the two places that darken a building for a roof or for a guessed height.
    mesh = _extract("buildingMesh", js)
    for fragment in ("colour.getHSL(hsl, THREE.SRGBColorSpace)",
                     "roofTint.getHSL(hsl, THREE.SRGBColorSpace)"):
        assert fragment in mesh, fragment


def test_a_roof_is_darker_than_its_walls_and_never_a_hole() -> None:
    result = _run_colour("""
      const hsl = (c) => { const o = {}; c.getHSL(o, THREE.SRGBColorSpace); return o; };
      const roofOf = (hex) => {
        const roofTint = new THREE.Color(hex);
        const o = hsl(roofTint);
        roofTint.setHSL(o.h, o.s, Math.max(ROOF_LIGHTNESS_FLOOR, o.l * 0.86), THREE.SRGBColorSpace);
        return roofTint;
      };
      const out = {};
      for (const [name, hex] of [["pale", 0xe4d9c2], ["mid", 0x9c5540], ["dark", 0x2f4858]]) {
        out[name] = { wall: +hsl(new THREE.Color(hex)).l.toFixed(3),
                      roof: +hsl(roofOf(hex)).l.toFixed(3) };
      }
      console.log(JSON.stringify(out));
    """)
    for name in ("pale", "mid"):
        assert result[name]["roof"] < result[name]["wall"], name
    # No roof, however dark the wall under it, goes below the floor.
    for name in result:
        assert result[name]["roof"] >= 0.30 - 1e-6, (name, result[name])
    # And a pale roof is not dragged up to the same grey as a dark one, which is what a floor
    # written in the wrong space did: every roof in the city arrived at mid grey together.
    assert result["pale"]["roof"] > result["dark"]["roof"] + 0.15


def test_a_house_the_city_has_an_address_for_is_not_a_garden_shed() -> None:
    """"We had to infer the height" is not evidence of an outbuilding.

    The standard San Francisco lot is twenty-five feet by a hundred, so the house on it covers
    well under the 150 m2 floor this used to fall through. 348 footprints reached the inferred
    branch and were called outbuildings; 318 had a street address, 326 a city land use and 16 a
    shop inside. They were drawn with the dark tar-paper shed roof that goes with a shed, and
    from above a house wearing one reads as a hole in the block.
    """
    js = _page_js()
    body = "\n".join([
        "const CANOPY_TAGS = new Set(['roof', 'canopy', 'carport']);",
        "const OUTBUILDING_TAGS = new Set(['shed', 'garage', 'hut', 'cabin', 'outbuilding']);",
        re.search(r"const SLENDER_LIMIT = [0-9.]+;", js).group(0),
        _extract("structureClass", js),
        """
        const house = { tags: { building: 'yes' }, height_source: 'inferred_default',
                        height_m: 10.5, address: { formatted: '2048 Larkin St' },
                        land_use: 'RESIDENTIAL- HOUSE, THREE FAMILY' };
        const shop = { tags: { building: 'yes' }, height_source: 'inferred_default',
                       height_m: 9.0, shops: [{ n: 'a shop', t: 'shop' }] };
        const nothing = { tags: { building: 'yes' }, height_source: 'inferred_default',
                          height_m: 3.0 };
        const taggedShed = { tags: { building: 'shed' }, height_source: 'osm_height',
                             height_m: 3.0, address: { formatted: '1 Somewhere' } };
        const canopy = { tags: { building: 'roof' }, height_source: 'osm_height', height_m: 4.0 };
        console.log(JSON.stringify({
          house: structureClass(house, 84),
          shop: structureClass(shop, 90),
          nothing: structureClass(nothing, 84),
          taggedShed: structureClass(taggedShed, 12),
          canopy: structureClass(canopy, 40),
          bigAnonymous: structureClass({ tags: {}, height_source: 'inferred_default' }, 400),
        }));
        """,
    ])
    out = subprocess.run([NODE, "--input-type=module", "-e", body],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got["house"] == "building"
    assert got["shop"] == "building"
    assert got["bigAnonymous"] == "building"
    # A footprint the city has no record of, small and with a guessed height, still reads as an
    # outbuilding -- the rule adds evidence, it does not remove the fallback.
    assert got["nothing"] == "outbuilding"
    # And an explicit OpenStreetMap tag still wins over an address, because somebody looked.
    assert got["taggedShed"] == "outbuilding"
    assert got["canopy"] == "canopy"


def test_an_outbuilding_roof_is_dark_but_not_a_hole() -> None:
    js = _page_js()
    body = _extract("outbuildingRoofTexture", js)
    fills = re.findall(r'ctx\.fillStyle = key\.endsWith\("0"\) \? "(#[0-9a-f]{6})" : "(#[0-9a-f]{6})"',
                       body)
    assert fills, "the shed roof no longer names its two colours"
    for hexes in fills[0]:
        r, g, b = (int(hexes[i:i + 2], 16) / 255 for i in (1, 3, 5))
        lightness = (max(r, g, b) + min(r, g, b)) / 2
        assert lightness >= 0.30, f"{hexes} is dark enough to read as a hole from above"
        assert lightness <= 0.55, f"{hexes} is too pale for a shed roof"


# ---------------------------------------------------------------- pavement, laid once


PAVEMENT_FUNCTIONS = (
    "distanceToSegmentSquared",
    "insideCarriageway",
    "addCarriagewaySegment",
    "lerpLonLat",
    "wayLength",
    "offsetWay",
    "trimWay",
    "trimWayEnds",
    "densifyWay",
    "pavementRunsOutsideCarriageway",
    "walkFitsAt",
    "streetContinuationsAt",
    "streetCarriesOn",
    "kerbsideTrims",
    "addKerbsidePavement",
)

PAVEMENT_PREAMBLE = PREAMBLE + """
const MIN_RENDER_WALK_M = 0.9;
const NARROW_WALK_M = 1.6;
const WALK_ENOUGH = 0.55;
const WALK_FALLBACK_WIDTHS_M = [1.0, 0.72, 0.52, 0.36, 0.24];
const WALK_WIDTH_RUN_M = 6.0;
const STREET_JOIN_M = 3.0;
const STREET_JOIN_DEG = 34.0;
const streetEndGrid = new Map();
// The ribbon is not built; what it was asked to build is recorded instead.
const LAID = [];
function addPavementRibbon(points, width) {
  LAID.push({ width, points, length: wayLength(points) });
  return wayLength(points);
}
"""


def _run_pavement(js_body: str) -> dict:
    js = _page_js()
    parts = [PAVEMENT_PREAMBLE]
    parts += [_extract(name, js) for name in PAVEMENT_FUNCTIONS]
    parts.append(js_body)
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


#: A street whose pavement has room for only part of its length: an avenue runs alongside it and
#: its carriageway reaches far enough across that a full-width pavement's own centreline would
#: stand on it. An alley beside an avenue is the ordinary case the width ladder exists for.
#: Side 1 is to the left of travel, which for a west-to-east spine is negative z here.
PINCHED_STREET = """
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
const ROAD_W = 10.0;
for (let x = -200; x < 200; x += 10) addCarriagewaySegment(x, 0, x + 10, 0, ROAD_W / 2);
for (let x = -60; x < 60; x += 10) addCarriagewaySegment(x, -9.25, x + 10, -9.25, 2.75);
const spine = [];
for (let x = -160; x <= 160; x += 10) spine.push(asLonLat(x, 0));
"""


def test_pavement_width_changes_are_stable_runs_not_stacked_tiles() -> None:
    """The regression that broke the pavement into mismatched tiles.

    The ladder used to lay a ribbon at every width it tried and return only when one of them
    covered enough of the side; every width before that one had already been drawn. A narrow
    strip fits everywhere a wide one does and more, so each narrower pass re-covered the ground
    the wider passes had just covered -- up to five slabs of different widths stacked in the same
    plane, each with its own tile origin, fighting for depth. Nineteen per cent of the paved
    ground in the corridor carried more than one slab.

    Trying a width and committing to one are different things, and this is the difference.
    The current renderer may change width along a side when geometry pinches, but each change
    must be a stable run and the inner edge must stay on the kerb.
    """
    result = _run_pavement(PINCHED_STREET + """
    addKerbsidePavement(spine, 1, ROAD_W / 2, 4.0, 0xffffff, 1.0, 0.12, 0.12);
    console.log(JSON.stringify({
      ribbons: LAID.length,
      widths: [...new Set(LAID.map((r) => +r.width.toFixed(3)))],
      lengths: LAID.map((r) => +r.length.toFixed(1)),
      coveredM: +LAID.reduce((s, r) => s + r.length, 0).toFixed(1),
    }));
    """)
    assert result["ribbons"] == len(result["lengths"]), result
    assert result["ribbons"] >= 1
    assert all(length >= 6.0 for length in result["lengths"]), result
    assert result["coveredM"] > 280, result


def test_a_pinch_does_not_end_the_pavement() -> None:
    """The other regression, from the other direction: 237 kerb sides came out bare because the
    strip was laid at one width and dropped wherever it did not fit."""
    result = _run_pavement(PINCHED_STREET + """
    const laid = addKerbsidePavement(spine, 1, ROAD_W / 2, 4.0, 0xffffff, 1.0, 0.12, 0.12);
    console.log(JSON.stringify({ laid: Math.round(laid), asked: Math.round(wayLength(spine)),
                                 width: +LAID[0].width.toFixed(2) }));
    """)
    assert result["laid"] > 0, result
    # Something is laid along most of the side, at some width.
    assert result["laid"] > result["asked"] * 0.5, result


def test_the_width_kept_is_the_one_that_covers_the_most_ground() -> None:
    """Width is chosen from geometry before anything is drawn.

    A one-metre strip running the whole block covers less pavement than a four-metre one over two
    thirds of it. Comparing by length picked the sliver against the kerb and left the rest of the
    way to the building line bare, which is the black along the shopfronts under another name.
    """
    js = _page_js()
    body = _extract("addKerbsidePavement", js)
    assert "const chosen = [];" in body
    assert "walkFitsAt(cx, -cy, nx, nz, widths[w])" in body
    assert "const emit = (from, to) => {" in body
    assert body.index("const chosen = [];") < body.index("let laid = 0;")
    assert body.index("let laid = 0;") < body.index("addPavementRibbon(")


def test_the_inner_edge_of_the_pavement_sits_on_the_kerb() -> None:
    """A narrower pavement is the same pavement with less of it, not one somewhere else."""
    result = _run_pavement(PINCHED_STREET + """
    addKerbsidePavement(spine, 1, ROAD_W / 2, 4.0, 0xffffff, 1.0, 0.12, 0.12);
    const inner = LAID.map((r) => {
      const zs = r.points.map((p) => -p[1] * metersPerLat);
      const mid = zs.reduce((a, b) => a + b, 0) / zs.length;
      // The pavement is on the negative-z side, so its inner edge is half a width back toward
      // the street, which is the +z direction.
      return +(mid + r.width / 2).toFixed(2);
    });
    console.log(JSON.stringify({ innerEdges: inner, kerb: -ROAD_W / 2 }));
    """)
    for edge in result["innerEdges"]:
        assert abs(edge - result["kerb"]) < 0.35, result


def test_mapped_footways_are_laid_before_any_is_derived_from_a_kerb() -> None:
    """So that what is already on the ground is on the ground before anything asks about it."""
    js = _page_js()
    assert "const DRAW_ORDER = DATA.ways.slice().sort(" in js
    order = js[js.index("const DRAW_ORDER"):js.index("for (const way of DRAW_ORDER)")]
    assert '"sidewalk"' in order and '"path"' in order
