"""Balconies drawn where the photograph saw them, ceilings on the storey lines, rooms that open,
small things wholly on their surfaces, and the Francisco Street houses in their own colours.

A balcony the detector saw stands out from the wall about three feet, floored at the foot of
the window it serves. A house's ceilings sit at its storey divides: the storey height its
photograph's fit was held to, else its height over its storeys. Only a bedroom has a door; a
closet stands open. A vase on a table is at the table's middle and never overhangs it. A house
whose photographs gave no material is concrete.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
HOUSES = ROOT / "data" / "contributed_houses"

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _node(script: str):
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def _balconies(building: str) -> list[dict]:
    js = _page_js()
    fit = json.loads((HOUSES / f"sf-corridor-{building}.json").read_text())
    consts = "".join(f"const {n} = {js.split(f'const {n} = ')[1].split(';')[0]};\n"
                     for n in ("INFERRED_BALCONY_DEPTH_M", "INFERRED_BALCONY_COLOUR", "BALCONY_MIN_BOX_M",
                               "BALCONY_MIN_FLOOR_M"))
    return _node(consts + _extract("balconyProposal", js) + _extract("inferredBalconies", js)
                 + f"const fit = {json.dumps(fit)};\nconsole.log(JSON.stringify(inferredBalconies(fit, fit.width_m)));"), fit


def test_a_detected_balcony_stands_out_from_the_wall_at_its_windows_foot() -> None:
    balconies, fit = _balconies("263276308")
    # 1547-1549: three at the top floor, three at the third, one long one across the second.
    assert len(balconies) == 7
    feet = {round(o["v"], 2) for o in fit["openings"] if o["kind"] in {"window", "door"}}
    for b in balconies:
        assert b["depth_m"] == pytest.approx(0.9), "a few feet out from the wall"
        assert round(b["platform_heights_m"][0], 2) in feet, "floored at a window's foot"
        assert b["platform_heights_m"][0] >= 2.4, "above the garage storey: not a stoop's railing"
        assert 0 <= b["u"] and b["u"] + b["w"] <= fit["width_m"] + 1e-6
    assert max(b["w"] for b in balconies) > 7, "the second floor's runs the width of the front"


def test_a_ledge_is_not_a_balcony_and_a_wide_box_does_not_double_three() -> None:
    assert _balconies("263276313")[0] == [], "1535's sill ledge is not a balcony"
    balconies, _ = _balconies("263276306")
    top = [b for b in balconies if b["platform_heights_m"][0] > 6]
    assert len(top) == 3 and len(balconies) == 4


def test_a_garage_has_no_flight_of_steps_so_1535_keeps_its_photograph() -> None:
    fit = json.loads((HOUSES / "sf-corridor-263276313.json").read_text())
    garages = [o for o in fit["openings"] if o["kind"] == "garage_candidate"]
    assert garages and not any((o.get("recess") or {}).get("render_steps") for o in garages)
    # The page rejects a fit whose garage has steps, and the house fell back to another colour.
    assert 'o.kind === "garage_candidate" && o.recess?.render_steps' in _extract("frontageFitFor", _page_js())
    source = (ROOT / "scripts/fit_contributed_photos.py").read_text()
    assert '"vehicle_opening_is_not_a_pedestrian_stairwell"' in source
    # And beige, as the sunlit wall is: the fit's median was read off the wall in shade.
    assert fit["appearance"]["colour"] == "#b8a78e" and fit["appearance"]["measured_colour"] == "#a09789"
    assert {b["colour"] for b in fit["appearance"]["bands"]} == {"#b8a78e"}


def test_the_published_tiles_carry_the_detectors_balcony_boxes() -> None:
    import runpy
    slim = runpy.run_path(str(ROOT / "tools/tile_frontage_fits.py"))["slim"]
    fit = json.loads((HOUSES / "sf-corridor-263276308.json").read_text())
    details = slim(fit)["details"]
    assert len([d for d in details if d["kind"] == "balcony"]) >= 7
    assert all(set(d) == {"kind", "u", "v", "w", "h"} for d in details if not d.get("render"))
    assert not [d for d in details if d["kind"] in {"canopy", "opening_review_candidate"}]


def test_the_heritage_building_across_the_street_is_orange() -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from build_sf_corridor_3d import load_reviewed_colours
    colours = load_reviewed_colours(HOUSES)
    for part in ("263277930", "263277932", "263277937"):
        assert colours[part]["c"] == "#c46a3c"
    payload = (ROOT / "docs/cells/sf-corridor-3d/5_5.json").read_text()
    assert payload.count('"colour":"#c46a3c","colour_basis":"reviewer_on_contributed_photographs"') == 3


def test_ceilings_sit_on_the_storey_lines() -> None:
    js = _page_js()
    script = "let fit = null; const entry = { way: { tags: {} }, fit: [] };\nfunction frontageFitFor() { return fit; }\n" \
        + "const HOME_STOREY_MAX_M = 7.0;\n" + _extract("homeStoreyCount", js) + _extract("homeStoreyHeight", js) + """
const out = {};
fit = { storey_constraint: { status: "prior_constrained", storeys: 4, storey_height_m: 3.1975 } };
out.measured = homeStoreyHeight(entry, 12.79);
out.photoCount = homeStoreyCount(entry, 12.79);
fit = null;
entry.way.tags["building:levels"] = "1";
out.oneLevelNineMetres = homeStoreyCount(entry, 9.2);
out.inferred = homeStoreyHeight(entry, 9.2);
console.log(JSON.stringify(out));
"""
    out = _node(script)
    assert out["measured"] == pytest.approx(3.1975) and out["photoCount"] == 4
    assert out["oneLevelNineMetres"] == 3, "a one-level record on a nine-metre house is a default"
    assert out["inferred"] == pytest.approx(9.2 / 3)
    build = _extract("buildInterior", js)
    assert "homeStoreyHeight(entry, visibleHeight)" in build
    assert "level * storeyStep + 2.3 <= visibleHeight" in build
    assert "copy.position.y = original.position.y + upperHeight - height" in build


def test_only_a_bedroom_has_a_door_and_a_closet_stands_open() -> None:
    js = _page_js()
    assert 'const DOORED_ROOMS = new Set(["bedroom"]);' in js
    build = _extract("buildInterior", js)
    assert 'kind: sides.includes("storage") ? "doorway"' in build
    assert 'if (spec.kind !== "private") continue;' in build
    assert "rotation.y = spec.kind === \"private\" ? 0 : 1.05" not in build


def test_a_small_thing_is_centred_on_its_surface_and_wholly_on_it() -> None:
    js = _page_js()
    script = "const SURFACE_EDGE_M = 0.03;\n" + _extract("itemOnSurface", js) + """
console.log(JSON.stringify({
  vaseOnTable: itemOnSurface(0.2, 0.2, 1.1, 0.6),
  wideOnNightstand: itemOnSurface(0.5, 0.3, 0.45, 0.4),
  tooSmall: itemOnSurface(0.2, 0.2, 0.08, 0.4),
}));
"""
    out = _node(script)
    assert out["vaseOnTable"] == 1, "a thing that fits keeps its real size"
    assert 0.5 * out["wideOnNightstand"] <= 0.45 - 0.06 + 1e-9, "brought down to fit inside the edge"
    assert out["tooSmall"] is None
    on_top = _extract("setOnTop", js)
    assert "model.position.set(-centre.x * scale," in on_top and "-centre.z * scale)" in on_top
    assert "{ w: size.x * scale, d: size.z * scale }" in _extract("furniturePiece", js)
    # The basin item stands on the unit's top, not 18 cm above it.
    assert '(holder, 0.655, { w: 0.7, d: 0.55 })' in _extract("furnishAgainstWall", js)


def test_a_shaded_front_is_lit_by_daylight_not_cyan() -> None:
    js = _page_js()
    # A north-facing front has only the sky's fill: cyan turned 1535's beige grey-green.
    assert "new THREE.HemisphereLight(0xe4ecf4, 0x071013, 1.15)" in js
    assert "0xb7f5ff" not in js


def test_tree_limbs_reach_a_fifth_less_far() -> None:
    js = _page_js()
    variant = _extract("treeVariant", js)
    assert "street:   { trunk: 0.38, limbs: 4, spread: 0.75, rise: 0.30, reach: 0.24," in variant
    assert "broad:    { trunk: 0.34, limbs: 5, spread: 1.05, rise: 0.22, reach: 0.32," in variant
    assert "reach: 0.30" not in variant and "reach: 0.40" not in variant
