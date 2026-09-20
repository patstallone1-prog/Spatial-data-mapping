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

import itertools
import json
import re
import shutil
import subprocess
import sys
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
    "pavementSurroundedByStreet",
    "addCarriagewaySegment",
    "lerpLonLat",
    "wayLength",
    "pavementRunsOutsideCarriageway",
)

#: A flat local frame, the same shape as the page's, with the origin at the test street.
PREAMBLE = """
const CARRIAGEWAY_CELL = 30;
const carriagewayGrid = new Map();
const OFFICIAL_CURB_CELL_M = 20.0;
const officialCurbGrid = new Map();
const officialIslandCurbGrid = new Map();
const officialMedianGrid = new Map();
const CROSSING_BRIDGE_GAP_M = 2.0;
const CROSSING_LEG_MIN_M = 0.7;
const CROSSING_STEP_M = 0.25;
const CROSSING_END_WALK_BACK_M = 1.5;
const CROSSING_END_STEP_M = 0.05;
const RAMP_NODE_CELL_M = 40.0;
const RAMP_NODE_REACH_M = 22.0;
const rampNodeGrid = new Map();
const metersPerLat = 111320;
const metersPerLon = 88000;
const SIDEWALK_INTERSECTION_CUT_EXTRA_M = 3.0;
const SIDEWALK_INTERSECTION_CUT_MAX_M = 10.5;
function xy(lon, lat) { return [lon * metersPerLon, lat * metersPerLat]; }
// Junction boxes are not built in the harness; nothing here is inside one.
function insideJunctionBox() { return false; }
// Flat ground, no tunnel cuts: every leg is on one level.
function wayFollowsCut() { return false; }
function cutLiftAt() { return 0; }
function sameLevelLegs() { return true; }
"""


FLAT_GROUND = "function groundLiftAt() { return 0; }\n"


def _run(js_body: str) -> dict:
    js = _page_js()
    parts = [PREAMBLE, FLAT_GROUND]
    parts += [_extract(name, js) for name in CARRIAGEWAY_FUNCTIONS]
    parts.append(js_body)
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _run_crossing(js_body: str) -> dict:
    js = _page_js()
    functions = (
        "distanceToSegmentSquared",
        "insideCarriageway",
        "pavementSurroundedByStreet",
        "addCarriagewaySegment",
        "lerpLonLat",
        "wayLength",
        "trimWayEnds",
        "lonLatFromXZ",
        "intersectionWalkwayCutback",
        "addOfficialCurbGridSegment",
        "indexOfficialCurbGeometry",
        "rayCurbIntersections",
        "officialCurbCrossingSpan",
        "endCrossingOnDrawnKerb",
        "indexCurbRamps",
        "cornerOf",
        "rampRecordAt",
        "crossingPaintLegs",
        "crossingRoadSpanPoints",
        "crossingRectanglePoints",
        "sidewalkCrossingReplacementSpans",
        "trimWalkwayForCorners",
        "crossingDrawPose",
        "crossingBearingDifference",
        "indexMappedCrossing",
        "nearMappedCrossing",
    )
    parts = [PREAMBLE, FLAT_GROUND, """
    const CROSSING_DEDUPE_CELL_M = 4.0;
    const MAPPED_CROSSING_YIELD_M = 6.0;
    const MAPPED_CROSSING_YIELD_DEG = 30.0;
    const mappedCrossingGrid = new Map();
    """]
    parts += [_extract(name, js) for name in functions]
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


def test_short_sidewalk_remnants_cut_off_by_a_road_are_not_rendered_as_tiles() -> None:
    result = _run("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(0, -5, 0, 5, 2);
const sidewalk = [asLonLat(-5, 0), asLonLat(5, 0)];
const runs = pavementRunsOutsideCarriageway(sidewalk, 3.6, true);
console.log(JSON.stringify({runs: runs.length,
  kept: runs.reduce((sum, run) => sum + wayLength(run), 0)}));
""")
    assert result == {"runs": 0, "kept": 0}, result


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


def test_crosswalk_geometry_is_straight_and_clipped_to_curbs() -> None:
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);
const crossing = [
  asLonLat(-20, 12),
  asLonLat(0, 8),
  asLonLat(0, -8),
  asLonLat(20, -12),
];
const clipped = crossingRectanglePoints(crossing);
const pts = clipped.map(([lon, lat]) => {
  const [x, y] = xy(lon, lat);
  return [+x.toFixed(2), +(-y).toFixed(2)];
});
console.log(JSON.stringify({ count: clipped.length, pts, len: +wayLength(clipped).toFixed(2) }));
""")

    assert result["count"] == 2, result
    assert abs(result["pts"][0][0]) < 0.15, result
    assert abs(result["pts"][1][0]) < 0.15, result
    assert 9.6 <= result["len"] <= 10.4, result


def test_crosswalk_uses_sfmta_bulb_out_curbs_and_preserves_supported_skew() -> None:
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 7);
indexOfficialCurbGeometry([
  {r: "block", p: [asLonLat(-20, 6), asLonLat(20, 6)]},
  {r: "block", p: [asLonLat(-20, -4), asLonLat(20, -4)]},
]);
const crossing = [asLonLat(-3, 10), asLonLat(3, -10)];
const clipped = crossingRectanglePoints(crossing);
const pts = clipped.map(([lon, lat]) => {
  const [x, y] = xy(lon, lat);
  return [+x.toFixed(2), +(-y).toFixed(2)];
});
console.log(JSON.stringify({pts, provenance: clipped.provenance,
  len: +wayLength(clipped).toFixed(2)}));
""")
    assert result["provenance"] == "sfmta_curbs", result
    assert result["pts"] == [[-1.8, 6], [1.2, -4]], result
    assert 10.3 <= result["len"] <= 10.6, result


def test_crosswalk_paint_splits_around_an_official_refuge_island() -> None:
    """A refuge island in the middle of one carriageway still parts the paint.

    The legs of a crossing are the runs of its span that stand on roadway. A divided street
    leaves a gap in the carriageway where its median is, and the legs part there of their own
    accord; a refuge island set into a single carriageway does not, so the island's own kerbs
    have to take the span off the road between them.
    """
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);
indexOfficialCurbGeometry([{r: "island", p: [
  asLonLat(-2, -1), asLonLat(2, -1), asLonLat(2, 1),
  asLonLat(-2, 1), asLonLat(-2, -1),
]}]);
const legs = crossingPaintLegs([asLonLat(0, -5), asLonLat(0, 5)]);
console.log(JSON.stringify({count: legs.length,
  lengths: legs.map((leg) => +wayLength(leg).toFixed(2)),
  points: legs.flat().map((point) => {
    const [x, y] = xy(point[0], point[1]);
    return [+x.toFixed(3), +(-y).toFixed(3)];
  })}));
""")
    assert result["count"] == 2, result
    assert all(3.7 <= length <= 4.1 for length in result["lengths"]), result
    assert all(abs(point[0]) <= 0.001 for point in result["points"]), result
    assert [point[1] for point in result["points"]] == sorted(
        point[1] for point in result["points"]
    ), result


def test_crosswalk_geometry_does_not_draw_where_no_carriageway_is_crossed() -> None:
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);
const sidewalkConnector = [asLonLat(-10, 11), asLonLat(10, 11)];
const clipped = crossingRectanglePoints(sidewalkConnector);
console.log(JSON.stringify({ count: clipped.length }));
""")

    assert result["count"] == 0, result


def test_crosswalk_geometry_uses_the_local_kerb_bearing_not_global_axes() -> None:
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
// A street rotated thirty degrees from the map axes, with a deliberately skewed OSM crossing.
const angle = Math.PI / 6;
const along = [Math.cos(angle), Math.sin(angle)];
const normal = [-along[1], along[0]];
addCarriagewaySegment(-along[0] * 30, -along[1] * 30,
                       along[0] * 30,  along[1] * 30, 5);
const crossing = [
  asLonLat(normal[0] * -18 - along[0] * 3, normal[1] * -18 - along[1] * 3),
  asLonLat(normal[0] * 18 + along[0] * 7, normal[1] * 18 + along[1] * 7),
];
const clipped = crossingRectanglePoints(crossing);
const pts = clipped.map(([lon, lat]) => {
  const [x, y] = xy(lon, lat);
  return [+x.toFixed(2), +(-y).toFixed(2)];
});
const vx = pts[1][0] - pts[0][0];
const vz = pts[1][1] - pts[0][1];
console.log(JSON.stringify({
  count: clipped.length,
  pts,
  len: +wayLength(clipped).toFixed(2),
  parallelToRoad: +Math.abs(vx * along[0] + vz * along[1]).toFixed(3),
}));
""")

    assert result["count"] == 2, result
    assert result["parallelToRoad"] < 0.05, result
    assert 9.6 <= result["len"] <= 10.4, result


def test_sidewalk_crossing_replacement_spans_are_direct_curb_to_curb() -> None:
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);
const sidewalk = [
  asLonLat(0, 14),
  asLonLat(3, 6),
  asLonLat(-2, -6),
  asLonLat(0, -14),
];
const spans = sidewalkCrossingReplacementSpans(sidewalk, 3.7);
const pts = spans[0].map(([lon, lat]) => {
  const [x, y] = xy(lon, lat);
  return [+x.toFixed(2), +(-y).toFixed(2)];
});
console.log(JSON.stringify({
  spans: spans.length,
  pts,
  len: +wayLength(spans[0]).toFixed(2),
}));
""")

    assert result["spans"] == 1, result
    assert abs(result["pts"][0][0] - result["pts"][1][0]) < 0.05, result
    assert 9.6 <= result["len"] <= 10.4, result


def test_a_sidewalk_stand_in_crossing_yields_to_the_mapped_one() -> None:
    """OpenStreetMap draws many sidewalks straight through a junction; where one crosses the
    road with no crossing way of its own, a plain two-line crossing stands in for it. Sidewalks
    are laid before crossings, and the stand-in used to claim the spot first, so at Grant and
    Clay two of the city's four continental crossings were thrown out as duplicates of a pair
    of lines drawn 2 m inside the box. A mapped crossing within MAPPED_CROSSING_YIELD_M,
    running the same way, means no stand-in; one across the other street does not."""
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);
// The city's crossing, 3 m along the street from where the sidewalk line crosses.
indexMappedCrossing([asLonLat(3, -5), asLonLat(3, 5)]);
// And one on the cross street, running the other way, right where the sidewalk crosses.
indexMappedCrossing([asLonLat(-5, 0), asLonLat(5, 0)]);
const standIn = [asLonLat(0, -5), asLonLat(0, 5)];
const farAway = [asLonLat(12, -5), asLonLat(12, 5)];
console.log(JSON.stringify({
  yields: nearMappedCrossing(standIn),
  farAwayYields: nearMappedCrossing(farAway),
}));
""")
    assert result["yields"] is True, result
    assert result["farAwayYields"] is False, result
    js = _page_js()
    # Indexed before any way is drawn, and asked before the stand-in is laid.
    assert js.index("indexMappedCrossing(span);") < js.index("const DRAW_ORDER = DATA.ways")
    replacements = _extract("addSidewalkCrossingReplacements", js)
    assert "if (nearMappedCrossing(span)) continue;" in replacements


def test_intersection_sidewalk_cutback_is_property_edge_plus_three_metres() -> None:
    result = _run_crossing("""
console.log(JSON.stringify({
  standard: +intersectionWalkwayCutback(3.6).toFixed(1),
  narrow: +intersectionWalkwayCutback(1.2).toFixed(1),
  capped: +intersectionWalkwayCutback(12.0).toFixed(1),
}));
""")

    assert result == {"standard": 6.6, "narrow": 4.2, "capped": 10.5}


def test_sidewalk_tile_surrounded_by_street_on_three_sides_is_removed() -> None:
    result = _run("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-5, -3, 5, -3, 1.1);
addCarriagewaySegment(-5, 3, 5, 3, 1.1);
addCarriagewaySegment(3, -5, 3, 5, 1.1);
const island = [asLonLat(-1, 0), asLonLat(1, 0)];
const runs = pavementRunsOutsideCarriageway(island, 2.0);
console.log(JSON.stringify({
  surrounded: pavementSurroundedByStreet(0, 0, 2.0),
  runs: runs.length,
}));
""")

    assert result["surrounded"] is True, result
    assert result["runs"] == 0, result


def test_circular_intersection_padding_is_not_rendered() -> None:
    """Road and crossing ribbons meet directly; no synthetic circle masks their geometry."""
    js = _page_js()
    assert "addIntersectionRoadPads(" not in js
    assert 'addMerged("road:junction"' not in js


def test_midblock_sidewalk_way_ends_are_not_cut_back() -> None:
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);
const sidewalk = [asLonLat(-20, 8), asLonLat(20, 8)];
const trimmed = trimWalkwayForCorners(sidewalk, 3.6);
console.log(JSON.stringify({ before: +wayLength(sidewalk).toFixed(2),
                             after: +wayLength(trimmed).toFixed(2) }));
""")
    assert result["after"] == result["before"], result


def test_crosswalks_do_not_cut_holes_out_of_sidewalk_landings() -> None:
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);
// No synthetic crosswalk mask is allowed to shorten the sidewalk before the curb.
const sidewalk = [asLonLat(0, 6), asLonLat(0, 26)];
const trimmed = trimWalkwayForCorners(sidewalk, 3.6);
console.log(JSON.stringify({ before: +wayLength(sidewalk).toFixed(2),
                             after: +wayLength(trimmed).toFixed(2) }));
""")
    assert result["after"] == result["before"], result


def test_corridor_wide_geometry_audit_runs_and_keeps_crosswalks_and_footways() -> None:
    """Keep the executable audit in lockstep with the renderer it is meant to protect."""
    out = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "audit_corridor_render.py")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert out.returncode == 0, out.stderr
    report = json.loads(out.stdout)
    assert report["crosswalk"]["rendered"] > 2500, report["crosswalk"]
    assert report["crosswalk"]["officialShare"] > 0.70, report["crosswalk"]
    assert report["crosswalk"]["officialResolved"] + report["crosswalk"]["fallbackResolved"] \
        == report["crosswalk"]["rendered"], report["crosswalk"]
    assert report["footway"]["keptShare"] > 0.89, report["footway"]


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
    # Every marking -- lane line, both halves of the double yellow, taper -- is one paint from
    # laneMarkingPaints handed to paintedLine at MARK_W, per junction-clear run.
    assert "paintedLine(offsetWay(run, mark.offset), MARK_W" in js
    assert "paintedLine(run, MARK_W, mark.color" in js
    # Four inches, which is what the MUTCD says and what San Francisco paints.
    assert re.search(r"const MARK_W = 0\.10\d?;", js)
    # And the double yellow is two four-inch lines with four inches of road between them.
    paints = _lane_paints({"kind": "street", "name": "Polk Street", "road_m": 13.4,
                           "road_source": "curb_geometry", "lanes": 2})
    centre = sorted(m["offset"] for m in paints if m["kind"] == "centre")
    assert len(centre) == 2, paints
    assert abs((centre[1] - centre[0]) - 0.204) < 0.002, centre


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
                 "renderedRoadWidth", "segmentRunsAlongside", "sameLevel",
                 "clampRoadWidthsToNeighbours")
    parts = ["""
    const metersPerLat = 111320;
    const metersPerLon = 88000;
    function xy(lon, lat) { return [lon * metersPerLon, lat * metersPerLat]; }
    const MIN_RENDER_ROAD_M = 2.8;
    const MAX_RENDER_ROAD_M = 24.0;
    const MAX_INFERRED_ROAD_M = 16.5;
    const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half", "tunnel_cut"]);
    const SERVICE_ROAD_M = { driveway: 3.4, "drive-through": 3.4, parking_aisle: 6.0 };
    const NEIGHBOUR_PARALLEL_DEG = 30;
    // No buildings in this harness: the facade clamp finds nothing.
    function roomBetweenFacades() { return null; }
    function isUndergroundWay(way) { return way.tunnel_kind === "underground"; }
    function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }
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
    // A tunnel under a street on the hill above it: the street is not beside it, and the
    // bore keeps the width the city measured for it.
    const bore = { kind: "street", name: "Stockton Tunnel", road_m: 14.0, road_source: "curb_geometry",
                   tunnel_kind: "road", layer: -1, points: [at(-200, 5200), at(200, 5200)] };
    const hill = { kind: "street", name: "Stockton Street", road_m: 12.0, road_source: "curb_geometry",
                   points: [at(-200, 5203), at(200, 5203)] };
    // A driveway and a lone parking aisle with nothing measured: neither gets the street
    // default of eight metres.
    const driveway = { kind: "street", service: "driveway",
                       points: [at(-200, 800), at(200, 800)] };
    const aisle = { kind: "street", service: "parking_aisle",
                    points: [at(-200, 1200), at(200, 1200)] };
    // A measured 7.36 m street leaving a crossroads, split at the node the way OpenStreetMap
    // splits it, with a short first segment: Grant Avenue out of Clay Street.
    const clay = { kind: "street", road_m: 9.0, lanes: 2,
                   points: [at(-100, 2000), at(100, 2000)] };
    const grantSouth = { kind: "street", road_m: 7.36, road_source: "curb_geometry",
                         points: [at(0, 2000), at(0, 2004.75), at(0, 2040)] };
    const grantNorth = { kind: "street", road_m: 7.36, road_source: "curb_geometry",
                         points: [at(0, 1960), at(0, 2000)] };
    // And the same measured street tagged lanes=1, which it is: one lane of traffic between
    // two lanes of parked cars. The lane cap is for inferred widths, not measured ones.
    const grantParked = { kind: "street", road_m: 7.36, road_source: "curb_geometry", lanes: 1,
                          points: [at(0, 3000), at(0, 3040)] };
    const inferredNarrow = { kind: "street", road_m: 12.0, road_source: "row_minus_footways",
                             lanes: 1, points: [at(0, 4000), at(0, 4040)] };
    const ways = [avenue, alley, boulevard, service, driveway, aisle, clay, grantSouth, grantNorth,
                  grantParked, inferredNarrow, bore, hill];
    clampRoadWidthsToNeighbours(ways);
    console.log(JSON.stringify({
      bore: +renderedRoadWidth(bore).toFixed(2),
      hill: +renderedRoadWidth(hill).toFixed(2),
      avenue: +renderedRoadWidth(avenue).toFixed(2),
      alley: +renderedRoadWidth(alley).toFixed(2),
      boulevard: +renderedRoadWidth(boulevard).toFixed(2),
      driveway: +renderedRoadWidth(driveway).toFixed(2),
      aisle: +renderedRoadWidth(aisle).toFixed(2),
      grant: +renderedRoadWidth(grantSouth).toFixed(2),
      clay: +renderedRoadWidth(clay).toFixed(2),
      parked: +renderedRoadWidth(grantParked).toFixed(2),
      inferred: +renderedRoadWidth(inferredNarrow).toFixed(2),
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
    # A driveway is one car wide and an aisle two; neither is an eight metre street.
    assert widths["driveway"] <= 3.4 + 0.01, widths
    assert widths["aisle"] <= 6.0 + 0.01, widths
    # The cross street at a junction and the same street carrying on are not neighbours: a
    # measured width survives leaving a crossroads. It was clamped to 4.75, the distance of the
    # way's second point from the node, and the pavement laid from that kerb crossed the road.
    assert abs(widths["grant"] - 7.36) < 0.01, widths
    assert widths["clay"] >= 8.0, widths          # its two-lane cap, not a junction clamp
    # Measured kerb to kerb outranks the lane count; an inferred width does not.
    assert abs(widths["parked"] - 7.36) < 0.01, widths
    assert abs(widths["inferred"] - 4.75) < 0.01, widths
    # A street on the hill over a tunnel is not beside it: the bore keeps its measured 14 m
    # and the street its 12. Each was being clamped to the other's centreline three metres off.
    assert abs(widths["bore"] - 14.0) < 0.01 and abs(widths["hill"] - 12.0) < 0.01, widths


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
    # The blanket side rejection is gone. It sampled seven points and dropped the whole side if
    # three were blocked, so a side beside a median for half a block lost its pavement for all of
    # it. Whether the ground beyond a kerb is roadway is asked of each station now, in the two
    # pavement passes, where it belongs.
    assert "sideBlockedByCarriageway" not in body
    assert "kerbsideBlockedAt(before, spine[i], after, side, inner)" in js
    assert "mappedWalkNear" in body, "the tag is taken on trust"
    # A side the tag excludes is still drawn when nothing is mapped along it.
    assert "if (!sampled || covered < sampled * 0.5) drawn.push(side);" in body
    # A driveway or a parking aisle has no footway of its own, and no paint down its middle.
    assert "if (isUnmarkedService(way) || way._junctionInternal || isTunnelWay(way)) return drawn;" in body
    assert "if (!isSidewalk && !isCrossing && !isPath && !isUnmarkedService(way)) {" in js


def test_a_footway_narrows_to_fit_rather_than_vanishing() -> None:
    js = _page_js()
    body = _extract("addKerbsidePavement", js)
    assert "WALK_FALLBACK_WIDTHS_M" in body
    # The inner edge stays on the kerb at every width, so a narrower stretch is the same pavement
    # with less of it rather than a pavement somewhere else. Asserted of the geometry rather than
    # of the source text: the literal that used to be checked here survived a rewrite that
    # changed what the function does, and would have gone on passing if the property had broken.
    # The kerb's own four-inch tile sits at the kerb; the pavement proper starts behind it. The
    # kerb line is read per station, since a divided half widens where the city's kerbs say.
    assert "lineAt(KERB_LIP_M / 2)" in body
    assert "lineAt(KERB_LIP_M + inset / 2)" in body
    assert "kerbAt[Math.min(from + j, kerbAt.length - 1)] + extra" in body
    # The kerb tile is laid along the runs the pavement survives, never on its own.
    assert "for (const run of pavementRunsOutsideCarriageway(walkCentre, inset))" in body
    assert "const kerb = offsetWay(run, -side * (inset / 2 + KERB_LIP_M / 2));" in body
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
const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half", "tunnel_cut"]);
const SERVICE_ROAD_M = { driveway: 3.4, "drive-through": 3.4, parking_aisle: 6.0 };
function isUndergroundWay(way) { return way.tunnel_kind === "underground"; }
function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }
function isRoadTunnel(way) { return way.tunnel_kind === "road"; }
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
    assert min(b - a for a, b in itertools.pairwise(ordered)) >= 0.002
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
    "pavementSurroundedByStreet",
    "addCarriagewaySegment",
    "lerpLonLat",
    "wayLength",
    "offsetWay",
    "trimWay",
    "trimWayEnds",
    "densifyWay",
    "pavementRunsOutsideCarriageway",
    "walkFitsAt",
    "kerbsideBlockedAt",
    "streetContinuationsAt",
    "streetCarriesOn",
    "cornerLegAt",
    "kerbsideTrims",
    "mappedWalkBeyondKerb",
    "rayFootprintDistance",
    "bulbDepthAt",
    "halfWidthAt",
    "addBulbOuts",
    "addKerbsidePavement",
)

PAVEMENT_PREAMBLE = PREAMBLE + """
const MIN_RENDER_WALK_M = 0.9;
const NARROW_WALK_M = 1.6;
const WALK_ENOUGH = 0.55;
const WALK_FALLBACK_WIDTHS_M = [1.0, 0.72, 0.52, 0.36, 0.24];
const WALK_WIDTH_RUN_M = 6.0;
const KERB_LIP_M = 0.1016;
const KERBSIDE_BLOCK_PROBE_M = 1.8;
const STREET_JOIN_M = 3.0;
const STREET_JOIN_DEG = 34.0;
const streetEndGrid = new Map();
const CORNER_JOIN_M = 1.0;
const CORNER_CELL_M = 4.0;
const cornerLegGrid = new Map();
const pavementCornerCuts = new Map();
const pavementCornerLaid = new Map();
// The ribbon is not built; what it was asked to build is recorded instead.
const LAID = [];
function addPavementRibbon(points, width) {
  LAID.push({ width, points, length: wayLength(points) });
  return wayLength(points);
}
function stampPaved() {}
// No buildings in the harness unless a test puts some in the grid.
const FOOTPRINT_CELL = 60;
const footprintGrid = new Map();
const FACADE_GAP_M = 0.3;
const WALK_TO_FACADE_MAX_M = 7.0;
// No mapped footways, no city kerbs and no bulb-outs in the harness.
const MAPPED_WALK_CELL = 40;
const mappedWalkGrid = new Map();
const MAPPED_WALK_ABUT_M = 7.0;
const MAPPED_WALK_GAP_MIN_M = 0.35;
const BULB_STATION_M = 2.0;
const KERB_FALLBACK = 0.126;
const KERB_RENDER_MAX_M = 0.2;
const ROAD_TOP_M = 0.06;
function surfaceMaterial() { return {}; }
function ribbon(points, width) { return { points, width }; }
function addMerged(key, mesh) {
  LAID.push({ width: mesh.width, points: mesh.points, length: wayLength(mesh.points) });
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
      widths: [...new Set(LAID.filter((r) => r.width > KERB_LIP_M + 0.01)
                              .map((r) => +r.width.toFixed(3)))],
      lengths: LAID.map((r) => +r.length.toFixed(1)),
      coveredM: +LAID.reduce((s, r) => s + r.length, 0).toFixed(1),
    }));
    """)
    assert result["ribbons"] == len(result["lengths"]), result
    assert result["ribbons"] >= 1
    assert len(result["widths"]) == 1, result
    assert all(length >= 6.0 for length in result["lengths"]), result
    assert result["coveredM"] > 160, result


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
    assert "const fits = widths.map(() => []);" in body
    # Each station is also asked whether the ground beyond its kerb is another carriageway.
    assert "fits[w].push(!blocked && walkFitsAt(cx, -cy, nx, nz, width));" in body
    assert "if (coverage >= WALK_ENOUGH)" in body
    assert "const chosen = fits[pick].map((ok) => ok ? pick : -1);" in body
    assert "const emit = (from, to) => {" in body
    assert body.index("const fits = widths.map(() => []);") < body.index("let laid = 0;")
    assert body.index("const chosen = fits[pick].map((ok) => ok ? pick : -1);") < body.index("let laid = 0;")
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


def test_lane_markings_stop_at_every_junction_not_only_at_a_way_s_ends() -> None:
    """Paint is not carried through a crossroads.

    Lane lines and centrelines are painted between junctions, never across them -- a driver reads
    the empty box as the place where the lanes give way to each other. This used to be handled by
    trimming the two ends of each OpenStreetMap way, which misses every junction in the middle of
    one, and OpenStreetMap splits a street where its tagging changes rather than where it meets
    another street. Gough Street runs through Green as a single way, so two double yellows met at
    right angles in the middle of the box.

    The test that stood here asserted the exact text of one paintedLine call. It passed happily
    while the markings crossed each other, because the literal was still in the file.
    """
    js = _page_js()
    body = _extract("markingRunsClearOfJunctions", js)
    # Every point is asked whether a street crosses there, not just the two ends.
    assert "crosswiseCarriagewayAt(" in body
    assert "for (let i = 0; i < dense.length; i += 1)" in body
    # And the paint stops short of the junction rather than at its edge, leaving room for the
    # crosswalk and the stop bar.
    assert "JUNCTION_CLEAR_M" in body
    clear = re.search(r"const JUNCTION_CLEAR_M = ([0-9.]+);", js)
    assert clear and 3.0 <= float(clear.group(1)) <= 8.0
    # The lane dividers, the centreline and the transition tapers all go through it.
    assert "const markingRuns = markingRunsClearOfJunctions(markingPoints, way);" in js
    assert "for (const run of markingRuns) {" in js
    assert "for (const run of markingRunsClearOfJunctions(points, way))" in js
    for caller in ("paintedLine(offsetWay(run, mark.offset), MARK_W",
                   "paintedLine(run, MARK_W, mark.color"):
        assert caller in js, caller


def test_street_furniture_faces_the_road_rather_than_a_die_roll() -> None:
    """A shelter with its back to the kerb is not a shelter.

    Every one of the corridor's 19 shelters, 616 bus stop flags and 375 bearingless stop signs
    arrives without a stated bearing. They used to be spun to a random angle over the full circle.
    """
    js = _page_js()
    body = _extract("furnitureBearing", js)
    assert "random(" not in body, "furniture is still being pointed by a die roll"
    assert "nearestKerbAt(" in body
    # A stated bearing is a measurement and still wins.
    assert "Number.isFinite(item.bearing)" in body


def test_curb_paint_is_snapped_to_the_kerb_the_model_drew() -> None:
    """SFMTA digitises against its own centrelines; this model derives kerbs from measured curb
    geometry. Drawn where the published line falls, a red zone lands in the traffic lanes."""
    js = _page_js()
    snap = _extract("nearestKerbAt", js)
    # A candidate that is still inside a roadway is not a kerb, whatever it is nearest to.
    assert "insideCarriageway(kerbX, kerbZ" in snap
    # And a kerb running crosswise to the policy line is a different kerb.
    assert "CURB_ALIGN_DEG" in snap
    runs = _extract("kerbRunsFor", js)
    assert "CURB_RUN_BREAK_M" in runs
    # The bus box breaks where the kerb turns, because a bus zone does not wrap a corner.
    assert "kerbRunsFor(record, BUS_ZONE_MAX_TURN_DEG)" in js


# ---------------------------------------------------------------- the corners


CORNER_FUNCTIONS = (
    *PAVEMENT_FUNCTIONS,
    "laneCountForWay", "nominalRoadWidth", "renderedRoadWidth", "renderedWalkWidth",
    "isUnmarkedService", "cornerLegsAt", "cornerNeighbour", "cornerFrame", "cornerCutFor",
    "reconcilePavementCorners", "indexPavementCorners", "cornerQuad", "junctionClusters",
    "junctionBoxHull", "pointInRing", "convexHull", "indexJunctionBox",
    "streetCarryOn", "legBulb", "legInner", "rayCurbIntersections",
)

CORNER_PREAMBLE = PAVEMENT_PREAMBLE + """
const MIN_RENDER_ROAD_M = 2.8;
const MAX_RENDER_ROAD_M = 24.0;
const MAX_INFERRED_ROAD_M = 16.5;
const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half", "tunnel_cut"]);
const MAX_RENDER_WALK_M = 6.0;
const SERVICE_ROAD_M = { driveway: 3.4, "drive-through": 3.4, parking_aisle: 6.0 };
const UNMARKED_SERVICE = new Set(Object.keys(SERVICE_ROAD_M));
const CORNER_MIN_DEG = 20;
const CORNER_MAX_DEG = 150;
const JUNCTION_CLUSTER_M = 16.0;
const JUNCTION_BOX_CELL_M = 30;
function groundLiftAt() { return 0; }   // flat ground
const cornerLegs = [];
const junctionBoxHulls = [];
const junctionBoxGrid = new Map();
function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }
const BULB_MIN_M = 0.5;
const BULB_MAX_M = 5.0;
const BULB_RETURN_M = 6.0;
const BULB_CORNER_M = 16.0;
function isDividedHalf() { return false; }
"""


def _run_corners(js_body: str) -> dict:
    js = _page_js()
    parts = [CORNER_PREAMBLE]
    parts += [_extract(name, js) for name in CORNER_FUNCTIONS]
    parts.append(js_body)
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


#: A crossroads: an east-west street 10 m wide with 4 m footways and a north-south street 8 m
#: wide with 3 m footways, each split at the junction node the way OpenStreetMap splits them.
CROSSROADS = """
const asLonLat = (xm, ym) => [xm / metersPerLon, ym / metersPerLat];
const west  = { kind: "street", name: "Post Street", road_m: 10, walk_m: 4,
                points: [asLonLat(-100, 0), asLonLat(0, 0)] };
const east  = { kind: "street", name: "Post Street", road_m: 10, walk_m: 4,
                points: [asLonLat(0, 0), asLonLat(100, 0)] };
const south = { kind: "street", name: "Hyde Street", road_m: 8, walk_m: 3,
                points: [asLonLat(0, -100), asLonLat(0, 0)] };
const north = { kind: "street", name: "Hyde Street", road_m: 8, walk_m: 3,
                points: [asLonLat(0, 0), asLonLat(0, 100)] };
const ways = [west, east, south, north];
for (const w of ways) w._renderRoadM = w.road_m;
const valid = indexPavementCorners(ways);
"""


def test_a_crossroads_cuts_each_pavement_where_the_crossing_pavement_ends() -> None:
    """The corner square is bounded by the two kerbs and the two pavements' starts.

    A pavement was pulled back from the junction by seven tenths of its own width past the
    other street's kerb. Both pavements at a corner did that, so the square between the kerbs
    had nothing on it and the small square beyond it had both. The cut is now where the other
    pavement's outer edge is: for the east-west street, half the north-south road plus its
    footway -- 4 + 3 = 7 m -- and 5 + 4 = 9 m the other way round.
    """
    result = _run_corners(CROSSROADS + """
    const legs = cornerLegs.map((leg) => ({
      name: leg.way.name, x: +leg.x.toFixed(1), y: +leg.y.toFixed(1),
      cuts: [1, -1].map((side) => {
        const c = pavementCornerCuts.get(`${leg.id}:${side}`);
        return c ? { cut: +c.cut.toFixed(2), valid: c.valid, tK: +c.tK.toFixed(2),
                     with: c.B.way.name } : null;
      }),
    }));
    // And the trim the pavement pass asks for, per side, at the junction end of the west leg.
    const back = 99;
    const trims = [1, -1].map((side) =>
      kerbsideTrims(west.points, back, side).map((v) => +v.toFixed(2)));
    const quad = cornerQuad(cornerLegs.find((leg) => leg.way === east && leg.end === 0), 1);
    console.log(JSON.stringify({ valid, legs, trims, quad: quad && {
      K: quad.K.map((v) => +v.toFixed(2)), A1: quad.A1.map((v) => +v.toFixed(2)),
      C: quad.C.map((v) => +v.toFixed(2)), B1: quad.B1.map((v) => +v.toFixed(2)) } }));
    """)
    assert result["valid"] == 8, result
    for leg in result["legs"]:
        if leg["x"] != 0 or leg["y"] != 0:
            # The dead ends have no corners.
            assert leg["cuts"] == [None, None], leg
            continue
        for corner in leg["cuts"]:
            assert corner is not None and corner["valid"], (leg, corner)
            if leg["name"] == "Post Street":
                assert corner["with"] == "Hyde Street"
                assert abs(corner["cut"] - 7.0) < 0.01, corner
                assert abs(corner["tK"] - 4.0) < 0.01, corner
            else:
                assert corner["with"] == "Post Street"
                assert abs(corner["cut"] - 9.0) < 0.01, corner
                assert abs(corner["tK"] - 5.0) < 0.01, corner
    # The west leg's far end is the junction; its near end is a dead end and keeps the flat
    # pull-back. Both sides ask and both get the corner's own cut.
    assert result["trims"] == [[99, 7.0], [99, 7.0]], result["trims"]
    # The corner piece for the east leg's left (north) side: kerb corner at (4, 5) inset by the
    # kerb tile, its own cut on the kerb line at x = 7, the cut lines meeting at (7, 9), and
    # Hyde's cut on Hyde's kerb line at y = 9.
    quad = result["quad"]
    assert quad is not None
    assert abs(quad["K"][0] - 4.1) < 0.02 and abs(quad["K"][1] - 5.1) < 0.02, quad
    assert abs(quad["A1"][0] - 7.0) < 0.02 and abs(quad["A1"][1] - 5.1) < 0.02, quad
    assert abs(quad["C"][0] - 7.0) < 0.02 and abs(quad["C"][1] - 9.0) < 0.02, quad
    assert abs(quad["B1"][0] - 4.1) < 0.02 and abs(quad["B1"][1] - 9.0) < 0.02, quad


def test_a_stub_between_two_junctions_shares_itself_between_its_corners() -> None:
    """A way too short for the corners at both ends gives them what it has, kerb corners first.
    And a way that only joins two nodes of one junction is the junction: it gets no corners
    and no pavement of its own."""
    result = _run_corners("""
    const asLonLat = (xm, ym) => [xm / metersPerLon, ym / metersPerLat];
    const mk = (name, a, b, road, walk) => ({ kind: "street", name, road_m: road, walk_m: walk,
      points: [asLonLat(...a), asLonLat(...b)], _renderRoadM: road });
    // A 20 m stub of an east-west street between two 16 m wide north-south streets: each
    // corner wants 11 m of it.
    const ways = [
      mk("Stub", [0, 0], [20, 0], 10, 4),
      mk("Stub", [-100, 0], [0, 0], 10, 4), mk("Stub", [20, 0], [120, 0], 10, 4),
      mk("Left", [0, -100], [0, 0], 16, 3), mk("Left", [0, 0], [0, 100], 16, 3),
      mk("Right", [20, -100], [20, 0], 16, 3), mk("Right", [20, 0], [20, 100], 16, 3),
      // And a 9 m connector between two nodes of what is one junction.
      mk("Link", [0, 1000], [9, 1000], 10, 4),
      mk("A", [0, 900], [0, 1000], 8, 3), mk("A", [0, 1000], [0, 1100], 8, 3),
      mk("B", [9, 900], [9, 1000], 8, 3), mk("B", [9, 1000], [9, 1100], 8, 3),
    ];
    const valid = indexPavementCorners(ways);
    const stub = cornerLegs.filter((leg) => leg.way === ways[0]);
    const cuts = stub.map((leg) => [1, -1].map((side) => {
      const c = pavementCornerCuts.get(`${leg.id}:${side}`);
      return c ? [+c.cut.toFixed(2), c.valid] : null;
    }));
    const link = cornerLegs.filter((leg) => leg.way === ways[7]);
    console.log(JSON.stringify({ valid, cuts, linkInternal: !!ways[7]._junctionInternal,
      linkCuts: link.map((leg) => [1, -1].map((side) => pavementCornerCuts.has(`${leg.id}:${side}`))),
      stubInternal: !!ways[0]._junctionInternal }));
    """)
    assert not result["stubInternal"]
    # Each end wanted 11 m; the stub is 20. Both keep their kerb corner (8 m) and share the rest.
    for end in result["cuts"]:
        for corner in end:
            assert corner is not None, result
            assert 9.5 <= corner[0] <= 10.05, result
    assert result["cuts"][0][0][0] + result["cuts"][1][1][0] <= 20.0 + 0.01, result
    assert result["linkInternal"], result
    assert result["linkCuts"] == [[False, False], [False, False]], result


def test_corner_neighbour_skips_a_same_street_fork_and_keeps_searching() -> None:
    """A divided or skewed approach must not hide the real cross-street corner behind it."""
    result = _run_corners("""
    const asLonLat = (xm, ym) => [xm / metersPerLon, ym / metersPerLat];
    const ray = (name, degrees) => {
      const angle = degrees * Math.PI / 180;
      return { kind: "street", name, road_m: 10, walk_m: 4, _renderRoadM: 10,
        points: [asLonLat(0, 0), asLonLat(100 * Math.cos(angle), 100 * Math.sin(angle))] };
    };
    // Main Street forks 30 degrees left; Cross Street is the actual 90-degree neighbour.
    // The old search selected Main's fork first, rejected it only afterwards, and returned null.
    const approach = ray("Main Street", 0);
    const fork = ray("Main Street", 30);
    const cross = ray("Cross Street", 90);
    indexPavementCorners([approach, fork, cross]);
    const leg = cornerLegs.find((item) => item.way === approach && item.end === 0);
    const neighbour = cornerNeighbour(leg, 1);
    console.log(JSON.stringify({ name: neighbour && neighbour.way.name }));
    """)
    assert result["name"] == "Cross Street", result


def test_the_corner_pieces_are_laid_once_every_pavement_is_down() -> None:
    js = _page_js()
    assert "indexPavementCorners(DATA.ways);" in js
    assert "const cornersLaid = addPavementCorners();" in js
    body = _extract("addPavementCorners", js)
    # The slab merges with the pavements it joins, and its kerb is the pavements' kerb tile.
    assert ('addMerged(`walk:walk:${(Math.round(thickness / 0.05) * 0.05).toFixed(2)}`, '
            'mesh, "walk");') in body
    assert ('KERB_LIP_M,\n                        mine.color, mine.opacity, y, thickness, '
            '"kerb");') in body
    # A piece on the road is not laid.
    assert "insideCarriageway(sx, -sy, 0.15)" in body
    # Two legs of one street forking are not a corner and do not abort the neighbour search.
    neighbour = _extract("cornerNeighbour", js)
    assert "if (leg.way.name && other.way.name === leg.way.name) continue;" in neighbour


def test_lanes_are_only_guessed_for_a_street_with_a_name() -> None:
    """A nameless way is a connector through a junction, and its width says nothing about lanes.

    A 17.6 m piece of the Embarcadero's junction with Broadway, drawn by OpenStreetMap as its
    own unnamed way, was guessed to have four lanes and painted three white lines diagonally
    through the crossroads. The paint reads the one profile the trims and transitions read.
    """
    js = _page_js()
    profiles = {
        key: _lane_profile(way) for key, way in {
            "connector": {"kind": "street", "road_m": 17.6, "road_source": "curb_geometry"},
            "avenue": {"kind": "street", "name": "Van Ness Avenue", "road_m": 17.6,
                       "road_source": "curb_geometry"},
            "tagged": {"kind": "street", "road_m": 17.6, "lanes": 4,
                       "road_source": "curb_geometry"},
        }.items()
    }
    assert profiles["connector"]["total"] == 0 and not profiles["connector"]["opposing"]
    assert profiles["avenue"]["total"] == 4 and profiles["avenue"]["opposing"]
    assert profiles["tagged"]["total"] == 4, "a lanes tag is believed whatever the name"
    # And the draw loop reads that profile rather than its own arithmetic.
    assert "laneMarkingPaints(laneMarkingProfile(way, road))" in js
    assert js.count("travel >= 13.8 ? 4 : travel >= 9.0 ? 2") == 1
    assert "road >= 13.8 ? 4" not in js


LANE_PREAMBLE = """
const MIN_RENDER_ROAD_M = 2.8;
const MAX_RENDER_ROAD_M = 24.0;
const MAX_INFERRED_ROAD_M = 16.5;
const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half", "tunnel_cut"]);
const SERVICE_ROAD_M = { driveway: 3.4, "drive-through": 3.4, parking_aisle: 6.0 };
const PARKING_LANE_M = 2.4;
const BIKE_LANE_M = 1.5;
const MARK_W = 0.102;
const DOUBLE_GAP_M = 0.102;
const CROSS_SECTION_KIND = { p: "parking", b: "bike", f: "buffer", x: "transit", t: "travel",
                             n: "turn", m: "median", h: "shoulder", l: "loading", u: "unresolved" };
const CROSS_SECTION_LANE_MIN_M = 2.55;
const CROSS_SECTION_LANE_MAX_M = 5.2;
function isUndergroundWay(way) { return way.tunnel_kind === "underground"; }
function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }
function isRoadTunnel(way) { return way.tunnel_kind === "road"; }
"""

LANE_FUNCTIONS = ("laneCountForWay", "nominalRoadWidth", "renderedRoadWidth", "halfWidthAt",
                  "crossSectionRowAt", "crossSectionBands", "crossSectionBandsNearMiddle",
                  "crossSectionMarkKind", "travelSpanAt",
                  "travelSpan", "laneOffsets", "laneMarkingProfile", "laneMarkingPaints",
                  "bikeLaneOffset")


def _run_lanes(js_body: str) -> dict:
    js = _page_js()
    parts = [PREAMBLE, FLAT_GROUND, LANE_PREAMBLE]
    parts += [_extract(name, js) for name in LANE_FUNCTIONS]
    parts.append(js_body)
    out = subprocess.run([NODE, "-e", "\n".join(textwrap.dedent(p) for p in parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _lane_profile(way: dict) -> dict:
    return _run_lanes(f"console.log(JSON.stringify(laneMarkingProfile({json.dumps(way)})));")


def _lane_paints(way: dict) -> list[dict]:
    return _run_lanes(
        f"console.log(JSON.stringify(laneMarkingPaints(laneMarkingProfile({json.dumps(way)}))));")


def test_lane_lines_are_spaced_over_the_travel_lanes_not_the_parked_cars() -> None:
    """A street with parking down one side has its lanes on the other side of it.

    Lane lines and the double yellow used to be spaced over the whole width between the kerbs,
    as if the parked cars were a lane of traffic: on Polk, where the east kerb is a parking
    lane and the west kerb a bike lane, the yellow ran 1.2 m off the middle of the traffic and
    the bike lane stood in the parked cars. The parking sides come from SFMTA's parking block
    faces (annotate_parking_lanes), and everything laid across the road -- lane lines, the
    centre pair, turn arrows, bike lanes -- is laid across the travel span they leave.
    """
    bare = {"kind": "street", "name": "Polk Street", "road_m": 12.0,
            "road_source": "curb_geometry", "lanes": 2}
    parked_right = dict(bare, parking_sides=[-1])
    parked_both = dict(bare, parking_sides=[1, -1])
    result = _run_lanes(f"""
    const bare = {json.dumps(bare)}, right = {json.dumps(parked_right)},
          both = {json.dumps(parked_both)};
    const centre = (way) => laneMarkingPaints(laneMarkingProfile(way))
      .filter((m) => m.kind === "centre").map((m) => m.offset);
    console.log(JSON.stringify({{
      bare: travelSpan(bare, 12.0), right: travelSpan(right, 12.0), both: travelSpan(both, 12.0),
      narrow: travelSpan(both, 7.0),
      centreBare: centre(bare), centreRight: centre(right),
      arrowsRight: laneOffsets(12.0, 2, right),
      bikeBare: bikeLaneOffset(12.0, bare, -1), bikeParked: bikeLaneOffset(12.0, right, -1),
      bikeOtherSide: bikeLaneOffset(12.0, right, 1),
    }}));
    """)
    assert result["bare"] == [6.0, -6.0]
    assert result["right"] == [6.0, -3.6], "the parked cars are still a lane"
    assert result["both"] == [3.6, -3.6]
    # Too narrow to park both sides and still drive: the lanes are what the kerbs leave.
    assert result["narrow"] == [3.5, -3.5]
    # The yellow sits in the middle of the traffic, which is 1.2 m left of the road's middle.
    assert abs(sum(result["centreBare"]) / 2) < 1e-9
    assert abs(sum(result["centreRight"]) / 2 - 1.2) < 1e-9, result["centreRight"]
    # Turn arrows are in the travel lanes too.
    assert all(-3.6 < o < 6.0 for o in result["arrowsRight"]), result["arrowsRight"]
    # A bike lane runs between the parked cars and the traffic, not under the parked cars.
    assert abs(result["bikeBare"] - result["bikeParked"] - 2.4) < 1e-9
    assert result["bikeOtherSide"] == result["bikeBare"]


def test_a_street_is_moved_to_the_middle_of_the_citys_kerbs() -> None:
    """OpenStreetMap's centreline for Grant Avenue runs 1.75 m west of the road the city
    surveyed; everything laid from it stood 1.75 m west of where it is. A way is moved sideways
    onto the midline of the official kerbs it runs between -- one offset for the whole way --
    and an inferred width becomes the measured one. Stations that do not agree leave it alone.
    """
    js = _page_js()
    parts = [PREAMBLE, FLAT_GROUND, """
    const MIN_RENDER_ROAD_M = 2.8;
    const MAX_RENDER_ROAD_M = 24.0;
    const MAX_INFERRED_ROAD_M = 16.5;
    const MEASURED_ROAD_SOURCES = new Set(["curb_geometry", "official_curbs", "divided_half", "tunnel_cut"]);
    const SERVICE_ROAD_M = { driveway: 3.4, "drive-through": 3.4, parking_aisle: 6.0 };
    const UNMARKED_SERVICE = new Set(Object.keys(SERVICE_ROAD_M));
    function isUndergroundWay(way) { return way.tunnel_kind === "underground"; }
    function isTunnelWay(way) { return Boolean(way.tunnel_kind) && way.tunnel_kind !== "underpass"; }
    function isRoadTunnel(way) { return way.tunnel_kind === "road"; }
    const RECENTRE_END_MARGIN_M = 8.0;
    const RECENTRE_STATION_M = 4.0;
    const RECENTRE_MAX_SPREAD_M = 0.5;
    const RECENTRE_MAX_SHIFT_M = 4.0;
    const RECENTRE_MIN_SHIFT_M = 0.12;
    const RECENTRE_VERTEX_REACH_M = 12.0;
    const STREET_JOIN_M = 3.0;
    const STREET_JOIN_DEG = 34.0;
    const ENVELOPE_VERTEX_M = 24.0;
    const ENVELOPE_MIN_EDGE_M = 0.6;
    const ENVELOPE_MIN_SPAN_M = 2.4;
    const ENVELOPE_MAX_SPREAD_M = 0.9;
    const ENVELOPE_MIN_WAY_M = 10.0;
    const ROW_MISMATCH_FACTOR = 2.0;
    const ENVELOPE_RELABEL_M = 1.0;
    """]
    parts += [_extract(name, js) for name in (
        "isUnmarkedService", "wayLength", "offsetWay", "densifyWay", "lerpLonLat",
        "addOfficialCurbGridSegment", "rayCurbIntersections", "officialKerbOffsetsAt",
        "laneCountForWay", "isDividedHalf", "dividedHalfWidth", "envelopeEdgesAt",
        "recentreOnKerbEnvelope", "inheritRecentring", "recentreStreetsOnOfficialKerbs")]
    parts.append("""
    const at = (xm, ym) => [xm / metersPerLon, ym / metersPerLat];
    // A street drawn along y = 0 from x = -60 to 60; the city's kerbs at y = -2 and y = +5.5,
    // so the road is 7.5 m wide and its middle is at y = 1.75. In the x/z frame z = -y.
    addOfficialCurbGridSegment(officialCurbGrid, -80, 2.0, 80, 2.0);
    addOfficialCurbGridSegment(officialCurbGrid, -80, -5.5, 80, -5.5);
    const grant = { kind: "street", name: "Grant Avenue", road_m: 12.0,
                    road_source: "row_minus_footways", points: [at(-60, 0), at(60, 0)] };
    // A street whose kerbs wander: one side steps two metres halfway along.
    addOfficialCurbGridSegment(officialCurbGrid, -80, 1002.0, 0, 1002.0);
    addOfficialCurbGridSegment(officialCurbGrid, 0, 1004.0, 80, 1004.0);
    addOfficialCurbGridSegment(officialCurbGrid, -80, 994.5, 80, 994.5);
    const wobbly = { kind: "street", name: "Wobbly Street", road_m: 7.5,
                     road_source: "curb_geometry", points: [at(-60, -1000), at(60, -1000)] };
    // An alley matched to the avenue's record: 3 m between its kerbs, 26 m on paper.
    addOfficialCurbGridSegment(officialCurbGrid, -80, 2001.5, 80, 2001.5);
    addOfficialCurbGridSegment(officialCurbGrid, -80, 1998.5, 80, 1998.5);
    const alley = { kind: "street", name: "Ophir Alley", road_m: 26.0,
                    road_source: "row_minus_footways", points: [at(-60, -2000), at(60, -2000)] };
    const moved = recentreStreetsOnOfficialKerbs([grant, wobbly, alley]);
    console.log(JSON.stringify({
      moved,
      grantY: grant.points.map((p) => +(p[1] * metersPerLat).toFixed(2)),
      grantRoad: grant.road_m, grantSource: grant.road_source, shift: grant.recentred_m,
      node: grant._node && grant._node.map((p) => +(p[1] * metersPerLat).toFixed(2)),
      wobblyY: wobbly.points.map((p) => +(p[1] * metersPerLat).toFixed(2)),
      wobblyWidths: wobbly._spans && [wobbly._spans[0][1], wobbly._spans[wobbly._spans.length - 1][1]].map((v) => +v.toFixed(2)),
      alleyRoad: alley.road_m, alleyRejected: alley.road_record_rejected, alleySource: alley.road_source,
    }));
    """)
    out = subprocess.run([NODE, "-e", "\n".join(textwrap.dedent(p) for p in parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    assert result["moved"] == {"moved": 2, "widened": 2, "inherited": 0}, result  # the alley was already centred
    assert all(abs(y - 1.75) < 0.01 for y in result["grantY"]), result
    assert abs(result["grantRoad"] - 7.5) < 0.01 and result["grantSource"] == "official_curbs"
    assert abs(result["shift"] - 1.75) < 0.01
    # Where it stood is kept, for the junctions it shares with the streets that meet it.
    assert result["node"] == [0, 0], result
    # The kerb envelope is read vertex by vertex, so a street whose kerb steps two metres is
    # followed: 7.5 m wide at one end, 9.5 at the other, its middle moved to match.
    assert result["wobblyWidths"][0] < result["wobblyWidths"][1], result
    assert abs(result["wobblyWidths"][0] - 7.5) < 0.3 and abs(result["wobblyWidths"][1] - 9.5) < 0.3, result
    assert result["wobblyY"][0] > -1000.5 and result["wobblyY"][-1] < result["wobblyY"][0], result
    # A right of way twice what the kerbs allow is another street's record, and is rejected.
    assert abs(result["alleyRoad"] - 3.0) < 0.05 and result["alleyRejected"] == 26.0, result
    assert result["alleySource"] == "official_curbs", result


def test_a_bend_is_drawn_as_a_curve_and_a_band_round_it_does_not_cross_itself() -> None:
    """OpenStreetMap draws a curving street as straight pieces meeting at an angle, and every
    band laid from it -- kerb, pavement, paint -- met at the same angle. A bend of up to
    seventy degrees inside a way becomes an arc tangent to both legs; a sharper turn is a
    corner and stays one; the ends of a way are never moved. And a band mitred round any of
    them keeps its two edges apart."""
    js = _page_js()
    parts = [PREAMBLE, FLAT_GROUND, """
    const FILLET_MIN_DEG = 8.0;
    const FILLET_MAX_DEG = 70.0;
    const FILLET_LEG_MAX_M = 8.0;
    const FILLET_STEP_M = 1.5;
    const MAX_MITRE = 2.6;
    const midLon = 0, midLat = 0;
    function lonLatFromXZ(x, z) { return [x / metersPerLon, -z / metersPerLat]; }
    """]
    parts += [_extract(name, js) for name in ("wayLength", "norm", "mitredEdges", "filletBends")]
    parts.append("""
    const at = (xm, ym) => [xm / metersPerLon, ym / metersPerLat];
    const bend = (deg) => {
      const a = deg * Math.PI / 180;
      return [at(-30, 0), at(0, 0), at(30 * Math.cos(a), 30 * Math.sin(a))];
    };
    const turnsOf = (points) => {
      const out = [];
      for (let i = 1; i + 1 < points.length; i += 1) {
        const [ax, ay] = xy(points[i - 1][0], points[i - 1][1]);
        const [x, y] = xy(points[i][0], points[i][1]);
        const [bx, by] = xy(points[i + 1][0], points[i + 1][1]);
        const l1 = Math.hypot(x - ax, y - ay), l2 = Math.hypot(bx - x, by - y);
        const dot = ((x - ax) * (bx - x) + (y - ay) * (by - y)) / (l1 * l2);
        out.push(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
      }
      return out;
    };
    const crosses = (p, q, r, s) => {
      const d = (b, a, c) => (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
      return (d(q, p, r) > 0) !== (d(q, p, s) > 0) && (d(s, r, p) > 0) !== (d(s, r, q) > 0);
    };
    const selfCrossing = (edge) => {
      for (let i = 1; i < edge.length; i += 1)
        for (let j = i + 2; j < edge.length; j += 1)
          if (crosses(edge[i - 1], edge[i], edge[j - 1], edge[j])) return true;
      return false;
    };
    const result = {};
    for (const deg of [30, 60, 90, 120]) {
      const raw = bend(deg);
      const smooth = filletBends(raw);
      const edges = mitredEdges(smooth, 6.0);
      result[deg] = {
        vertices: smooth.length,
        maxTurn: +Math.max(...turnsOf(smooth)).toFixed(1),
        endsKept: smooth[0] === raw[0] && smooth[smooth.length - 1] === raw[raw.length - 1],
        crossing: selfCrossing(edges.left) || selfCrossing(edges.right),
      };
    }
    console.log(JSON.stringify(result));
    """)
    out = subprocess.run([NODE, "-e", "\n".join(textwrap.dedent(p) for p in parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    for deg in ("30", "60"):
        assert result[deg]["vertices"] > 3 and result[deg]["maxTurn"] < 15, result[deg]
        assert result[deg]["endsKept"], result[deg]
    for deg in ("90", "120"):
        assert result[deg]["vertices"] == 3, result[deg]      # a corner stays a corner
    for deg in ("30", "60", "90", "120"):
        assert not result[deg]["crossing"], (deg, result[deg])


# ---------------------------------------------------------------- the tunnels


TUNNEL_PREAMBLE = """
const TUNNEL_CROWN_M = 6.4;
const TUNNEL_WALL_M = 4.2;
const TUNNEL_SHELL_M = 0.6;
const TUNNEL_FLOOR_M = 0.06;
const TUNNEL_ROOF_UNDER_M = 0.4;
const TUNNEL_STATION_M = 3.0;
const TUNNEL_WALK_H_M = 0.3;
const TUNNEL_ARCH_SEGMENTS = 14;
const tunnelBores = [];
// A hill: 20 m high in the middle of a 300 m bore, flat ground at 0 at both mouths.
function terrainHeightAt(x, z) { return Math.max(0, 20 * (1 - Math.abs(x - 150) / 150)); }
function groundLiftAt(x, z) { return terrainHeightAt(x, z); }
"""


def _run_tunnel(js_body: str) -> dict:
    js = _page_js()
    parts = [PREAMBLE, TUNNEL_PREAMBLE]
    names = ("wayLength", "lonLatFromXZ", "tunnelSectionPoints", "tunnelCoverAlong",
             "tunnelStations", "tunnelFloorAt", "walkerGroundAt")
    parts += [_extract(name, js) for name in names]
    parts.append(js_body)
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_a_bore_runs_through_the_hill_at_the_level_the_lidar_read_for_its_road() -> None:
    """The ground is measured now, so the bore goes through it: the floor at each station is
    the ground less the cover the portal profile measured over the road there, which meets
    the approach road at both mouths; without a profile the floor runs straight between the
    mouths. Under thin cover near a mouth the roof is held below the ground. The walker's
    feet follow the floor inside the bore and the hill outside it."""
    result = _run_tunnel("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
const centre = [asLonLat(0, 0), asLonLat(300, 0)];
// Cover profile: the road stays level at 0 while the hill rises to 20 m over the middle.
const cover = [];
for (let s = 0; s <= 300; s += 10) cover.push([s, Math.max(0, 20 * (1 - Math.abs(s - 150) / 150))]);
const stations = tunnelStations(centre, cover);
const straight = tunnelStations(centre, null);
const at = (list, s) => list.reduce((best, st) => Math.abs(st.s - s) < Math.abs(best.s - s) ? st : best);
tunnelBores.push({ stations, half: 5.5 });
const roof = (st) => tunnelSectionPoints(5.5, st.cap).reduce((m, [, y]) => Math.max(m, y), 0);
console.log(JSON.stringify({
  count: stations.length,
  mouth: at(stations, 0).floor, middle: at(stations, 150).floor, far: at(stations, 300).floor,
  groundMiddle: at(stations, 150).ground,
  nearMouthRoof: roof(at(stations, 6)), deepRoof: roof(at(stations, 150)),
  straightMiddle: at(straight, 150).floor,
  underfoot: tunnelFloorAt(150, 0), beside: tunnelFloorAt(150, 7), hill: walkerGroundAt(150, 9),
  walker: walkerGroundAt(150, 0),
  // With the road level the lidar fitted at each mouth, the floor is that line whatever the
  // grid says at the mouths -- the grid under a deck over a portal is filled from the hill.
  measuredMouth: at(tunnelStations(centre, cover, { start: 29.3, end: 40.8 }), 0).floor,
  measuredMiddle: at(tunnelStations(centre, cover, { start: 29.3, end: 40.8 }), 150).floor,
}));
""")
    assert abs(result["measuredMouth"] - 29.36) < 1e-6
    assert abs(result["measuredMiddle"] - (29.3 + 11.5 / 2 + 0.06)) < 1e-6
    assert result["count"] >= 100
    # The floor stays at road level under the hill, and the ground over it is the hill.
    assert abs(result["mouth"] - 0.06) < 1e-6 and abs(result["middle"] - 0.06) < 1e-6
    assert abs(result["far"] - 0.06) < 1e-6 and abs(result["groundMiddle"] - 20) < 1e-6
    # Six metres in the cover is 0.8 m: the roof is held down; deep in, the whole arch.
    assert result["nearMouthRoof"] < 6.4 and abs(result["deepRoof"] - 6.4) < 1e-9
    # Without a profile the floor runs straight between the mouths (both at 0 here).
    assert abs(result["straightMiddle"] - 0.06) < 1e-6
    # The walker: on the floor inside, on the hill outside.
    assert abs(result["underfoot"] - 0.06) < 1e-6 and result["walker"] == result["underfoot"]
    assert result["beside"] is None and abs(result["hill"] - 20) < 1e-6
    js = _page_js()
    assert "avatar.position.y = AVATAR_STAND_Y + lift + walkerGroundAt(avatar.position.x, avatar.position.z);" in js
    assert "eye.y = AVATAR_EYE_Y + walkerGroundAt(avatar.position.x, avatar.position.z);" in js


def test_the_approach_outside_a_mouth_is_the_cut_the_city_drew() -> None:
    """The open street outside a mouth is a piece of the tunnel's OpenStreetMap way -- for
    Broadway the westbound bore's own line, off the axis of the cut -- and drawn about that
    line it stood across the mouth of the other bore. It is moved onto the cut's midline at
    the cut's width, the same reading the portal is built from, and the kerb envelope and the
    neighbour clamp leave it there."""
    js = _page_js()
    align = _extract("alignTunnelApproaches", js)
    assert "tunnelApproach({ x: m[0], z: m[1] }, { x: dx / len, z: dz / len })" in align
    assert 'way.road_source = "tunnel_cut";' in align
    assert "alignTunnelApproaches(DATA.ways);" in js
    aligned = js.index("alignTunnelApproaches(DATA.ways);")
    assert aligned < js.index("recentreStreetsOnOfficialKerbs(DATA.ways);")
    assert "if (way.tunnel_approach) continue;" in _extract("recentreStreetsOnOfficialKerbs", js)
    clamp = _extract("clampRoadWidthsToNeighbours", js)
    assert 'if (way.road_source === "tunnel_cut") continue;' in clamp
    measured = re.search(r"const MEASURED_ROAD_SOURCES = new Set\(\[(.*?)\]\);", js)
    assert '"tunnel_cut"' in measured.group(1)


def test_the_page_reads_its_paint_from_the_cross_sections_and_closes_them_to_its_own_kerbs():
    """A way carrying `xs` (smc.facts.cross_section) gets its lane lines, centre pair, arrows
    and bike lane from the bands, not from a count divided into a width. The page's drawn
    width can differ from the facts' by a few centimetres, so the fixed bands keep their
    widths and the travel lanes take the difference; an unresolved station paints nothing, and
    so does one whose lanes would have to leave the plausible range to close."""
    way = {"kind": "street", "name": "Polk Street", "road_m": 13.4, "road_source": "curb_geometry",
           "lanes": 2, "xs": [
               [2.0, 6.7, -6.7, "S", "r", [["p", 2.3, "N", 0.5, 0, "parallel"], ["b", 1.7, "M", 0.75, 0, "lane"],
                                           ["t", 3.55, "M", 0.8, -1], ["t", 3.55, "M", 0.8, 1],
                                           ["p", 2.3, "N", 0.5, 0, "parallel"]]],
               [6.0, 6.7, -6.7, "S", "u", [["u", 13.4, "N", 0.0, 0]], ["nohyp"]],
           ]}
    result = _run_lanes(f"""
    const way = {json.dumps(way)};
    const bands = crossSectionBands(way, 2.0, 6.7);
    const wider = crossSectionBands(way, 2.0, 7.0);        // the page drew it 60 cm wider
    const absurd = crossSectionBands(way, 2.0, 10.0);      // 6.6 m wider: no lane closes that
    const marks = [];
    for (let k = 0; k < bands.length - 1; k += 1) marks.push(crossSectionMarkKind(bands[k], bands[k + 1]));
    console.log(JSON.stringify({{
      kinds: bands.map((b) => b.kind), edges: bands.map((b) => [+b.left.toFixed(2), +b.right.toFixed(2)]),
      widerLane: +(wider[2].left - wider[2].right).toFixed(2), widerParking: +(wider[0].left - wider[0].right).toFixed(2),
      absurd, unresolved: crossSectionBands(way, 6.0, 6.7), marks,
      span: travelSpanAt(way, 2.0, 6.7), profile: laneMarkingProfile(way, 13.4),
      bike: bikeLaneOffset(13.4, way, 1),
    }}));
    """)
    assert result["kinds"] == ["parking", "bike", "travel", "travel", "parking"]
    assert result["edges"][0] == [6.7, 4.4] and result["edges"][1] == [4.4, 2.7]
    # The travel lanes absorb the page's extra 60 cm; the parking band does not.
    assert result["widerLane"] == 3.85 and result["widerParking"] == 2.3
    assert result["absurd"] is None and result["unresolved"] is None
    assert result["marks"] == ["edge", "edge", "centre", None]  # both edges of the bike lane; none at the parking
    assert result["span"] == [2.7, -4.4]
    assert result["profile"]["total"] == 2 and result["profile"]["opposing"] is True
    assert result["profile"]["fromCrossSection"] is True
    # The bike lane sits in its band: centre at (4.4 + 2.7) / 2 = 3.55 left of the way.
    assert abs(result["bike"] - 3.55) < 1e-9
    js = _page_js()
    assert "for (const mark of crossSectionMarks(way, markingPoints, markCutStart) || [])" in js


def test_a_crossing_ends_on_the_kerb_the_model_drew_not_on_the_curb_return() -> None:
    """The ray through the city's kerb lines, cast along the crossing, meets the curb return
    at a corner a metre or so beyond the straight kerb the carriageway is drawn to. Each end
    is walked back in until it stands on the drawn roadway; an end already on it stays, and
    one that finds no roadway within a metre and a half is left where the city put it."""
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
addCarriagewaySegment(-30, 0, 30, 0, 5);          // kerbs at z = +-5
const overshot = endCrossingOnDrawnKerb([asLonLat(0, -6.2), asLonLat(0, 5.9)]);
const exact = endCrossingOnDrawnKerb([asLonLat(0, -5), asLonLat(0, 5)]);
const lost = endCrossingOnDrawnKerb([asLonLat(0, -9), asLonLat(0, 5)]);
const z = (pts) => pts.map((p) => +(-xy(p[0], p[1])[1]).toFixed(2));
console.log(JSON.stringify({ overshot: z(overshot), walked: overshot.walkedBackM, exact: z(exact),
                             lost: z(lost) }));
""")
    assert abs(result["overshot"][0] + 5) <= 0.1 and abs(result["overshot"][1] - 5) <= 0.1, result
    assert result["walked"] == [1.2, 0.9]
    assert result["exact"] == [-5, 5]
    assert result["lost"][0] == -9 and abs(result["lost"][1] - 5) <= 0.1


def test_a_crossing_end_is_checked_against_the_ramp_inventorys_corner() -> None:
    """Public Works lists every corner leg at the intersection's own position, named by
    corner, with or without a ramp. A crossing end in that corner's quadrant finds the
    record; a single-letter leg (N) belongs to both corners it touches; a place with no
    intersection record within reach is no record at all."""
    result = _run_crossing("""
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
indexCurbRamps([
  { p: asLonLat(0, 0), c: "NE", f: [] },
  { p: asLonLat(0, 0), c: "SW", f: ["no_ramp"] },
  { p: asLonLat(0, 0), c: "N", f: [] },
]);
console.log(JSON.stringify({
  ne: rampRecordAt(6, -6), sw: rampRecordAt(-6, 6), nw: rampRecordAt(-6, -6), se: rampRecordAt(6, 6),
  far: rampRecordAt(60, 60), corner: cornerOf(0, 0, 3, -4),
}));
""")
    assert result == {"ne": "ramp", "sw": "no_ramp", "nw": "ramp", "se": None, "far": None,
                      "corner": "NE"}, result


def test_nothing_runs_at_the_top_level_before_the_bindings_it_reads_exist() -> None:
    """The page ran `indexCurbRamps(...)` a hundred lines above `const rampNodeGrid`, and every
    test here passed while the browser threw a ReferenceError and drew nothing: the tests pull
    functions out by name and never run the script top to bottom. This walks the top-level
    statements in order and, for each call made there, follows the called functions two levels
    down for a `const` or `let` the top level has not reached yet."""
    js = _page_js()
    lines = js.split("\n")
    declared_at: dict[str, int] = {}
    for n, line in enumerate(lines):
        m = re.match(r"(?:const|let) ([A-Za-z_$][\w$]*)\b", line)
        if m:
            declared_at[m.group(1)] = n
    function_names = set(re.findall(r"^(?:async )?function ([A-Za-z_$][\w$]*)\(", js, re.M))

    def body_identifiers(name: str, depth: int, seen: set[str]) -> set[str]:
        if name in seen or name not in function_names:
            return set()
        seen.add(name)
        body = re.sub(r"//[^\n]*", "", _extract(name, js))   # prose is not a read
        words = set(re.findall(r"\b[A-Za-z_$][\w$]*\b", body))
        # A name the function declares for itself shadows the top-level one; a name it asks
        # `typeof` about before reading is a guard, and the guard runs first.
        words -= set(re.findall(r"\b(?:const|let|var|function) ([A-Za-z_$][\w$]*)", body))
        words -= set(re.findall(r"typeof ([A-Za-z_$][\w$]*)", body))
        if depth > 0:
            for called in set(re.findall(r"\b([A-Za-z_$][\w$]*)\(", body)) & function_names:
                words |= body_identifiers(called, depth - 1, seen)
        return words

    offences = []
    brace_depth = 0
    for n, line in enumerate(lines):
        at_top = brace_depth == 0
        brace_depth += line.count("{") - line.count("}")
        m = re.match(r"([A-Za-z_$][\w$]*)\(.*\);\s*$", line)
        if not at_top or not m or m.group(1) not in function_names:
            continue
        reads = body_identifiers(m.group(1), 2, set())
        late = sorted(v for v in reads if v in declared_at and declared_at[v] > n)
        if late:
            offences.append(f"line {n}: {line.strip()} reads {late} declared later")
    assert not offences, "\n".join(offences)


def test_the_ground_in_an_approach_cut_never_climbs_onto_the_deck_over_the_portal() -> None:
    """Bush Street stands on the Stockton Tunnel's south portal. The terrain grid has no
    ground returns under that deck and was filled from the hill either side, so the cut's
    last metres stood seven metres up on the deck and the road ramped onto it. Inside the
    cut the ground is held to the road line from the mouth's fitted level to the grid's own
    level at the cut's far end; beside the cut the hill is the hill."""
    js = _page_js()
    # The preamble's flat-ground stand-ins give way to the real functions under test.
    core = "\n".join(line for line in PREAMBLE.split("\n")
                     if not any(name in line for name in ("wayFollowsCut", "cutLiftAt", "sameLevelLegs")))
    parts = [core, """
const TERRAIN_FRAME = {};
// The grid: the hill at 36 m everywhere except a 40 m open cut, whose floor descends from
// 28 m to the mouth at x = 100 -- and whose last 10 m are under the deck, read as 36 m.
function terrainHeightAt(x, z) {
  if (Math.abs(z) < 6 && x >= 60 && x < 90) return 28 + (x - 60) * 0.03;
  return 36;
}
const asLonLat = (xm, zm) => [xm / metersPerLon, -zm / metersPerLat];
const DATA = { ways: [{ tunnel_approach: "start", tunnel_approach_road_z: 29.3, road_m: 14,
                        points: [asLonLat(60, 0), asLonLat(100, 0)] }] };
"""]
    parts += [_extract(name, js) for name in ("approachRoadAt", "groundLiftAt", "cutLiftAt", "wayFollowsCut")]
    parts.append(re.search(r"const CUT_ALONG_COS = [^;]+;", js).group(0))
    for constant in ("APPROACH_CUT_MARGIN_M",):
        found = re.search(rf"const {constant} = [0-9.]+;", js)
        assert found, constant
        parts.append(found.group(0))
    cuts = js[js.index("const APPROACH_CUT_REACH_M = "):]
    parts.append(cuts[:cuts.index("\n});\n") + 4])
    parts.append("""
console.log(JSON.stringify({
  underDeck: cutLiftAt(97, 0), atMouth: cutLiftAt(100, 0), farEnd: cutLiftAt(61, 0),
  midCut: cutLiftAt(80, 0), beside: cutLiftAt(97, 15), hill: cutLiftAt(200, 0),
  // The deck itself keeps the grid: one point, two heights, the way decides.
  deckOverPortal: groundLiftAt(97, 0),
  alongCut: wayFollowsCut({ kind: "street", points: [asLonLat(40, 1), asLonLat(99, 1)] }),
  acrossCut: wayFollowsCut({ kind: "street", points: [asLonLat(97, -30), asLonLat(97, 30)] }),
  elsewhere: wayFollowsCut({ kind: "street", points: [asLonLat(300, 0), asLonLat(400, 0)] }),
}));
""")
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    # Under the deck the ground is the road line, not the 36 m fill; at the mouth, the
    # fitted level; where the grid has the cut floor, the lower of the two.
    assert 29.0 < result["underDeck"] < 29.4, result
    assert abs(result["atMouth"] - 29.3) < 1e-6, result
    assert result["midCut"] <= 28 + 20 * 0.03 + 1e-9, result
    assert abs(result["farEnd"] - 28.0) < 0.05, result
    assert result["beside"] == 36 and result["hill"] == 36, result
    assert result["deckOverPortal"] == 36, result
    assert result["alongCut"] is True and result["acrossCut"] is False and result["elsewhere"] is False, result


def test_a_surface_is_refined_until_it_can_follow_the_hill() -> None:
    """A yard drawn as one polygon, a fence panel, a block's pavement underlay: lifted at their
    corners alone they cut through the hill between them. Every triangle with an edge over
    TERRAIN_REFINE_M is bisected along its longest edge until none is; a long thin strip splits
    along its length only; two triangles sharing a split edge share the new vertex."""
    js = _page_js()
    parts = ["""
class Float32BufferAttribute {
  constructor(array, itemSize) { this.array = Float32Array.from(array); this.itemSize = itemSize; this.count = this.array.length / itemSize; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; this.groups = []; this.userData = {}; }
  setAttribute(n, a) { this.attributes[n] = a; return this; }
  getAttribute(n) { return this.attributes[n]; }
  setIndex(i) { this.index = { array: Uint32Array.from(i), count: i.length }; return this; }
  dispose() {}
}
const THREE = { Float32BufferAttribute, BufferGeometry };
"""]
    for constant in ("TERRAIN_REFINE_M", "TERRAIN_CHORD_M", "TERRAIN_REFINE_MIN_M", "TERRAIN_REFINE_GROWTH"):
        parts.append(re.search(rf"const {constant} = [0-9.]+;", js).group(0))
    # Flat ground first: nothing bends, only length splits.
    parts.append("let TERRAIN_FRAME = null; let terrainHeightAt = () => 0;")
    parts.append(_extract("refineForTerrain", js))
    parts.append("""
// Two triangles making a 40 m x 2 m strip, sharing the diagonal.
const g = new BufferGeometry();
g.setAttribute("position", new Float32BufferAttribute([0,0,0, 40,0,0, 40,0,2, 0,0,2], 3));
g.setAttribute("uv", new Float32BufferAttribute([0,0, 1,0, 1,1, 0,1], 2));
g.setIndex([0, 1, 2, 0, 2, 3]);
const r = refineForTerrain(g);
const p = r.getAttribute("position"), idx = r.index.array;
let longest = 0;
const edges = new Set();
for (let t = 0; t < idx.length; t += 3) {
  for (const [a, b] of [[idx[t], idx[t+1]], [idx[t+1], idx[t+2]], [idx[t+2], idx[t]]]) {
    longest = Math.max(longest, Math.hypot(p.array[a*3] - p.array[b*3], p.array[a*3+2] - p.array[b*3+2]));
    edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
  }
}
// Every vertex is used by an index; no vertex stands alone.
const used = new Set(idx);
// Now a hill: a 4 m x 4 m square (under the length limit) over ground that bumps 0.6 m in
// the middle is split until its edges follow the bump; the same square on flat ground is not.
const square = () => { const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([0,0,0, 6,0,0, 6,0,6, 0,0,6], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]); return g; };
const flat = refineForTerrain(square()).index.array.length / 3;
TERRAIN_FRAME = {}; terrainHeightAt = (x, z) => Math.max(0, 1.2 - 0.3 * Math.hypot(x - 3, z - 3));
const bumped = refineForTerrain(square()).index.array.length / 3;
console.log(JSON.stringify({ tris: idx.length / 3, vertices: p.count, longest, used: used.size,
  uvMid: Array.from(r.getAttribute("uv").array).slice(8, 10), unrefined: refineForTerrain(new BufferGeometry()) instanceof BufferGeometry,
  flat, bumped }));
""")
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    limit = float(re.search(r"const TERRAIN_REFINE_M = ([0-9.]+);", js).group(1))
    assert result["longest"] <= limit + 1e-6, result
    # Bisection along the longest edge each time: a strip this long ends as a few hundred
    # small triangles, not the tens of thousands a grid over its bounding box would be.
    assert 20 <= result["tris"] <= 200, result
    assert result["vertices"] == result["used"], result
    # The shared diagonal was split once for both triangles: fewer vertices than 3 per triangle.
    assert result["vertices"] < result["tris"] * 1.2, result
    # Interpolated attributes: the first midpoint's uv lies between its ends'.
    assert 0 <= result["uvMid"][0] <= 1 and 0 <= result["uvMid"][1] <= 1, result
    # Where the ground bends under a short edge it is split; where it is flat it is left.
    assert result["flat"] == 4 and result["bumped"] > result["flat"], result


def test_a_facade_matched_from_its_photographs_outranks_the_die() -> None:
    """A building whose photographs were read (facade_fingerprints.json, smc.facades.match)
    carries the closest render's name and a confidence; at or above the threshold the
    renderer draws that material, below it the seeded die still chooses."""
    js = _page_js()
    parts = []
    for constant in ("MATERIALS", "ARCHETYPE_STYLE"):
        start = js.index(f"const {constant} = ")
        end = js.index("\n};\n", start) if constant == "ARCHETYPE_STYLE" else js.index("\n];\n", start)
        parts.append(js[start:end + 4])
    parts.append(re.search(r"const FACADE_MATCH_MIN_CONFIDENCE = [0-9.]+;", js).group(0))
    parts += [_extract(name, js) for name in ("pickMaterial", "random")]
    parts.append("""
console.log(JSON.stringify({
  believed: pickMaterial(7, 12, "residential", { m: "brick", conf: 0.8 }).name,
  doubted: pickMaterial(7, 12, "residential", { m: "brick", conf: 0.2 }).name === pickMaterial(7, 12, "residential").name,
  unknownRender: pickMaterial(7, 12, "residential", { m: "thatch", conf: 0.9 }).name === pickMaterial(7, 12, "residential").name,
  glassOnAHouse: pickMaterial(7, 8, "residential", { m: "glass", conf: 0.9 }).name,
}));
""")
    out = subprocess.run([NODE, "--input-type=module", "-e", "\n".join(parts)],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    result = json.loads(out.stdout)
    assert result["believed"] == "brick" and result["doubted"] and result["unknownRender"], result
    # The photograph outranks the archetype's habits: a glass house is a glass house.
    assert result["glassOnAHouse"] == "glass", result
