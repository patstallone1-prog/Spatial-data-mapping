"""The page draws reconstructed geometry as it was given -- and draws nothing else there.

These run the page's own JavaScript (extracted from the page source, as
``test_corridor_geometry_rules`` does) against the Python geometry it is meant to reproduce.
The page is not told a model name: it is told a path and a section, and it has to produce the
same surface the canonical object defines, vertex for vertex. Where it draws one, it must leave
out its own width-derived kerb, and only there.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import textwrap
from pathlib import Path

import numpy as np
import pytest

from smc.geometry.base import Param
from smc.geometry.extrusion import ProfileKey, SplineExtrusion, kerb_profile, rectangle_profile
from smc.geometry.spline import CurveSamples, PiecewisePath
from smc.reconstruction.geo import EnuFrame
from smc.reconstruction.geometry_fit import decide, fit_curb_line
from smc.world.compile import web_record
from smc.world.object import EvidenceRef

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "scripts" / "build_sf_corridor_3d.py"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is needed to run the page's code")

FUNCTIONS = ("worldMetresPerDegree", "worldLocalToPage", "sweepGeometryLocal", "earClip",
             "worldSweepLevel", "worldSweepLocal", "worldClaims", "kerbClaimedAt",
             "unclaimedKerbRuns", "furnitureClaimedAt", "lerpLonLat")

#: The page projects lon/lat with a local equirectangular xy(); at the equator with these
#: scales it agrees exactly with worldMetresPerDegree(0), so page metres are local metres.
PREAMBLE = """
const PER_LON = 111412.84, PER_LAT = 111132.954 - 559.822;
function xy(lon, lat) { return [lon * PER_LON, lat * PER_LAT]; }
const KERB_RENDER_UNIFORM = false;
function renderedKerbHeight() { return 0.126; }
const WORLD_MITER_LIMIT = 4.0;
const WORLD_CLAIM_CELL_M = 10;
const WORLD_CLAIM_ALIGN_COS = Math.cos(35 * Math.PI / 180);
let WORLD_CLAIMS = null;
"""


def _page_js() -> str:
    text = SOURCE.read_text(encoding="utf-8")
    start = text.index('<script type="module">')
    return text[start:text.index("</script>", start)]


def _extract(name: str, js: str) -> str:
    head = f"function {name}("
    i = js.index(head)
    depth, body = 0, -1
    for k in range(i + len(head) - 1, len(js)):
        if js[k] == "(":
            depth += 1
        elif js[k] == ")":
            depth -= 1
            if depth == 0:
                body = js.index("{", k)
                break
    depth = 0
    for k in range(body, len(js)):
        if js[k] == "{":
            depth += 1
        elif js[k] == "}":
            depth -= 1
            if depth == 0:
                return js[i:k + 1]
    raise AssertionError(f"{name} is not closed")


def run_page(world: dict, body: str, *, uniform_kerbs: bool = False) -> object:
    js = _page_js()
    preamble = PREAMBLE.replace("const KERB_RENDER_UNIFORM = false;",
                                f"const KERB_RENDER_UNIFORM = {str(uniform_kerbs).lower()};")
    script = preamble + f"const WORLD_OBJECTS = {json.dumps(world)};\n" + \
        "\n".join(_extract(name, js) for name in FUNCTIONS) + "\n" + textwrap.dedent(body)
    result = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=60,
                            check=False)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _python_rings(sweep: SplineExtrusion) -> np.ndarray:
    return sweep.to_mesh().vertices


def _js_sweep(path, breaks, closed, profile, closed_profile, caps):
    args = ", ".join([json.dumps(path), json.dumps(list(breaks)), str(closed).lower(),
                      json.dumps(profile), str(closed_profile).lower(), str(caps).lower()])
    out = run_page({"objects": []}, f"""
        console.log(JSON.stringify(sweepGeometryLocal({args})));
    """)
    return np.asarray(out["vertices"]).reshape(-1, 3), np.asarray(out["index"]).reshape(-1, 3)


@pytest.mark.parametrize("profile", [kerb_profile(0.15, side=1), kerb_profile(0.12, side=-1),
                                     rectangle_profile(0.4, 0.3)])
def test_the_page_sweeps_exactly_what_the_canonical_object_defines(profile) -> None:
    t = np.linspace(-math.pi / 2, 0, 12)
    arc = np.column_stack([3 * np.cos(t) - 3, 3 * np.sin(t) + 3, np.zeros(12)])
    pts = np.vstack([[[-10.0, 0.0, 0.0]], arc, [[0.0, 3.0, 0.0], [0.0, 8.0, 0.0],
                                                  [4.0, 8.0, 0.0]]])
    path = PiecewisePath(pts, breaks=(len(pts) - 2,))
    caps = profile.closed
    sweep = SplineExtrusion(path, (ProfileKey(0.0, profile),), caps=caps)
    vertices, faces = _js_sweep(pts.tolist(), path.breaks, False, [list(p) for p in profile.points],
                                profile.closed, caps)
    expected = _python_rings(sweep)
    assert vertices.shape == expected.shape
    assert np.allclose(vertices, expected, atol=1e-9)
    # Same surface: every non-degenerate Python face is a page face.
    python_faces = {tuple(f) for f in sweep.to_mesh().faces.tolist()}
    assert python_faces <= {tuple(f) for f in faces.tolist()}


def _curb_record():
    t = np.linspace(-math.pi / 2, 0, 9)
    arc = np.column_stack([4 * np.cos(t) - 4, 4 * np.sin(t) + 4])
    pts = np.vstack([[[-12.0, 0.0]], arc, [[0.0, 12.0]]])
    samples = CurveSamples(np.column_stack([pts, np.zeros(len(pts))]), ordered=True, exact=True)
    ref = EvidenceRef("survey_line", "sfmta_curbs", "curb_lines/1", "unstated: SFMTA", count=11)
    [outcome] = fit_curb_line(samples, (ref,), EnuFrame(0.0, 0.0, 0.0),
                              height=Param(0.15, "lidar"), side=1)
    obj = decide(outcome, object_id="curb:test").object
    return obj, web_record(obj)


def test_a_reconstructed_curb_reaches_the_page_curved_without_a_prefab() -> None:
    obj, record = _curb_record()
    out = run_page({"objects": [record]}, """
        const g = worldSweepLocal(WORLD_OBJECTS.objects[0]);
        console.log(JSON.stringify(g));
    """)
    vertices = np.asarray(out["vertices"]).reshape(-1, 3)
    level = obj.geometry.path.simplified(0.01)
    expected = SplineExtrusion(level, obj.geometry.profiles).to_mesh().vertices
    assert np.allclose(vertices, expected, atol=2e-3)   # the payload is in whole millimetres
    # The rounded return is rounded on the page: nothing comes near the square corner.
    plan = vertices[:, :2]
    assert float(np.linalg.norm(plan, axis=1).min()) > 4 * (math.sqrt(2) - 1) - 0.25
    assert float(vertices[:, 2].max()) == pytest.approx(0.15, abs=1e-3)


def test_the_page_follows_its_uniform_kerb_rule_for_reconstructed_kerbs_too() -> None:
    """With every kerb drawn at one height (the page's standing rule), a reconstructed kerb is
    drawn at that height too -- its path still the measured one, its measured height kept in
    the canonical record."""
    _, record = _curb_record()
    body = "console.log(JSON.stringify(worldSweepLocal(WORLD_OBJECTS.objects[0])));"
    measured = np.asarray(run_page({"objects": [record]}, body)["vertices"]).reshape(-1, 3)
    uniform = np.asarray(run_page({"objects": [record]}, body,
                                  uniform_kerbs=True)["vertices"]).reshape(-1, 3)
    assert float(measured[:, 2].max()) == pytest.approx(0.15, abs=1e-3)
    assert float(uniform[:, 2].max()) == pytest.approx(0.126, abs=1e-3)
    assert np.allclose(measured[:, :2], uniform[:, :2])   # the plan is the measured one either way
    assert record["sweep"]["params"]["height"] == {"value": 0.15, "grade": "lidar"}


def _lonlat(x: float, z: float) -> list[float]:
    """Page metres (x east, z south) back to the preamble's lon/lat."""
    return [x / 111412.84, -z / (111132.954 - 559.822)]


def test_a_reconstructed_kerb_takes_the_legacy_kerb_out_only_where_it_stands() -> None:
    record = {"type": "curb", "anchor": [0.0, 0.0], "claim": {"kind": "curb", "along": "sweep",
                                                             "reach_m": 1.5},
              "sweep": {"lods": [{"level": 1, "path": [0, 0, 20000, 0]}], "profile": [0, 0]}}
    beside = [_lonlat(x, -0.6) for x in (-10.0, 30.0)]    # legacy kerb 0.6 m off, and longer
    across = [_lonlat(10.0, z) for z in (-10.0, 10.0)]    # a kerb crossing it at right angles
    far = [_lonlat(x, -6.0) for x in (0.0, 20.0)]          # the kerb across the street
    out = run_page({"objects": [record]}, f"""
        const toX = (run) => run.map(([lon]) => lon * PER_LON);
        console.log(JSON.stringify({{
          beside: unclaimedKerbRuns({json.dumps(beside)}).map(toX),
          across: unclaimedKerbRuns({json.dumps(across)}).length,
          far: unclaimedKerbRuns({json.dumps(far)}).length,
        }}));
    """)
    runs = out["beside"]
    assert len(runs) == 2
    first, second = runs
    assert min(first) == pytest.approx(-10.0, abs=1e-6) and max(first) < 0.5
    assert min(second) > 19.5 and max(second) == pytest.approx(30.0, abs=1e-6)
    assert out["across"] == 1 and out["far"] == 1


def test_with_no_reconstructed_objects_every_kerb_is_drawn_as_before() -> None:
    line = [_lonlat(x, 0.0) for x in (0.0, 20.0)]
    out = run_page({"objects": []}, f"""
        console.log(JSON.stringify(unclaimedKerbRuns({json.dumps(line)})));
    """)
    assert out == [line]


def test_a_measured_bench_takes_the_catalogue_bench_out_where_it_stands() -> None:
    record = {"type": "bench", "anchor": [0.0, 0.0],
              "claim": {"kind": "bench", "point": _lonlat(5.0, -5.0), "reach_m": 3.0}}
    out = run_page({"objects": [record]}, """
        console.log(JSON.stringify([furnitureClaimedAt(5.5, -5.2, "bench"),
                                    furnitureClaimedAt(12.0, -5.0, "bench"),
                                    furnitureClaimedAt(5.5, -5.2, "shelter")]));
    """)
    assert out == [True, False, False]


def test_the_page_wires_reconstructed_objects_in_ahead_of_the_legacy_ones() -> None:
    js = _page_js()
    # Loaded beside the rest of the page's data, and absent means nothing changes.
    assert 'fetch(asset("sf-corridor-world-objects.json"), { cache: "no-cache" })' in js
    assert ".catch(() => EMPTY_WORLD_OBJECTS)" in js
    # Swept objects join the street geometry before it is merged and lifted onto the ground.
    assert js.index("const worldSweepsDrawn = emitWorldSweeps();") < \
        js.index("flushMerged(groups.streets, (key) => !isBuilt(key));")
    # Every legacy kerb emission consults the claims.
    assert js.count("unclaimedKerbRuns(") >= 4
    # The catalogue bench is the fallback, not the default.
    assert "!furnitureClaimedAt(row.anchor.x, row.anchor.z, \"bench\")" in _extract("addBenches",
                                                                                   js)
    # Rigid objects refine on the tile tree's own screen-error rule.
    assert "errorM / (perPixel * TILE_MAX_SCREEN_ERROR_PX)" in _extract("worldLodDistance", js)


def test_the_whole_page_script_parses(tmp_path) -> None:
    """Every other test here runs extracted functions, which cannot see a syntax error between
    them. The page is one module; this parses all of it."""
    script = tmp_path / "page.mjs"
    script.write_text(_page_js().removeprefix('<script type="module">'), encoding="utf-8")
    result = subprocess.run([NODE, "--check", str(script)], capture_output=True, text=True,
                            timeout=60, check=False)
    assert result.returncode == 0, result.stderr[-2000:]


def test_a_kerb_is_only_drawn_where_the_page_has_pavement_to_meet_it() -> None:
    """Road and pavement are still laid from widths. Where the survey puts the kerb well away
    from the pavement those widths drew, a measured kerb would stand alone in the asphalt, so
    that stretch waits -- and is counted -- rather than being drawn."""
    record = {"type": "curb", "anchor": [0.0, 0.0],
              "sweep": {"lods": [{"level": 1, "path": [0, 0, 20000, 0]}],
                        "profile": [165, 150, 15, 150, 0, 0],
                        "params": {"height": {"value": 0.15, "grade": "lidar"},
                                   "side": {"value": 1.0, "grade": "inferred"}}}}
    js = _page_js()
    extra = "\n".join(_extract(name, js) for name in ("worldSupportedPieces",
                                                      "worldPavedBeside"))
    out = run_page({"objects": [record]}, extra + """
        const WORLD_KERB_SUPPORT_M = [0.3, 0.8, 1.5];
        const worldSweepStats = { drawn: 0, unsupported_m: 0, supported_m: 0 };
        // The page's pavement: to the kerb's left (north, page z < 0) and only for x < 10.
        function pavementTopAt(x, z) { return (x < 10 && z < 0 && z > -3) ? 0.2 : undefined; }
        const pieces = worldSupportedPieces(WORLD_OBJECTS.objects[0], 1);
        console.log(JSON.stringify({ pieces: pieces.map((p) => p.path.map((q) => q[0])),
                                     stats: worldSweepStats }));
    """)
    [piece] = out["pieces"]
    assert min(piece) == pytest.approx(0.0) and 9.0 <= max(piece) <= 10.0
    assert out["stats"]["unsupported_m"] == pytest.approx(10.0, abs=1.0)
