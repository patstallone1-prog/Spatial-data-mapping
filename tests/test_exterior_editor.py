"""The exterior editor: its shapes, what an edit must hold, and how a sent-in edit is published."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import merge_exterior_edits as merge  # noqa: E402

NODE = shutil.which("node")
BUILDING = {"osm_id": 7, "kind": "building", "points": [[-122.4, 37.8], [-122.4001, 37.8], [-122.4001, 37.8001], [-122.4, 37.8001], [-122.4, 37.8]]}


def edit(**over) -> dict:
    base = {"schema": merge.SCHEMA, "osm_id": "7", "wall": {"a": [-122.4, 37.8], "b": [-122.4001, 37.8]},
            "openings": [{"id": "w1", "type": "window", "u": 1, "v": 3, "w": 1, "h": 1.5, "shape": "arched",
                          "panes": {"cols": 2, "rows": 3}, "glass": "#5f7684", "frame": "#ffffff"},
                         {"id": "d1", "type": "door", "u": 4, "v": 0.9, "w": 1, "h": 2.1, "style": "french",
                          "recess_m": 0.6, "stairs": {"steps": 5, "direction": "left", "rail": True}}],
            "page": "/sf-corridor-3d.html", "address": "1 Test St", "exported": "2026-10-28T00:00:00Z"}
    base.update(over)
    return base


def test_an_edit_on_a_wall_of_its_building_is_published_without_what_identifies_who_sent_it() -> None:
    buildings = {"7": BUILDING}
    assert merge.check(edit(), buildings) == []
    cleaned = merge.clean(edit())
    assert "page" not in cleaned and "address" not in cleaned and "exported" not in cleaned
    assert cleaned["openings"][1]["stairs"]["steps"] == 5


def test_an_edit_on_a_wall_the_building_no_longer_has_or_off_its_wall_is_refused() -> None:
    buildings = {"7": BUILDING}
    assert merge.check(edit(wall={"a": [-122.4, 37.8], "b": [-122.5, 37.8]}), buildings)
    wide = edit()
    wide["openings"][0]["u"] = 40
    assert any("is not on" in p for p in merge.check(wide, buildings))
    assert merge.check(edit(osm_id="8"), buildings)
    assert merge.check(edit(schema="other"), buildings)


@pytest.mark.skipif(NODE is None, reason="node is needed to load the module")
def test_every_shape_is_a_closed_outline_inside_its_box_and_bars_stay_inside() -> None:
    script = """
const m = await import(process.argv[1]);
const out = {};
for (const [k, s] of Object.entries(m.SHAPES)) {
  const pts = s.outline(1.2, 1.8);
  out[k] = { n: pts.length, inside: pts.every(([x, y]) => x >= -1e-6 && x <= 1.2 + 1e-6 && y >= -1e-6 && y <= 1.8 + 1e-6) };
}
out.valid = m.validEdit({ schema: m.SCHEMA, osm_id: "7", wall: { a: [0, 0], b: [1, 0] }, openings: [{ type: "window", u: 0, v: 0, w: 1, h: 1 }] });
out.invalid = m.validEdit({ schema: m.SCHEMA, osm_id: "7", wall: { a: [0, 0], b: [1, 0] }, openings: [{ type: "chimney", u: 0, v: 0, w: 1, h: 1 }] });
console.log(JSON.stringify(out));
"""
    result = subprocess.run([NODE, "--input-type=module", "-e", script, (ROOT / "docs/exterior-editor.mjs").as_uri()],
                            capture_output=True, text=True, check=True)
    shapes = json.loads(result.stdout)
    assert shapes.pop("valid") is True and shapes.pop("invalid") is False
    assert len(shapes) >= 18
    for name, s in shapes.items():
        assert s["n"] >= 3 and s["inside"], name


def test_the_page_draws_saved_edits_and_leaves_its_own_front_off_an_edited_wall() -> None:
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert 'import(sharedAsset("exterior-editor.mjs?rev=__EXTERIOR_EDITOR_HASH__"))' in source
    assert "if (editedEdge(entry.way, a, b)) { edges.push(" in source
    assert "if(frontageFitFor(feature) || feature.exteriorEdit)return;" in source
    assert "dropEditedWallGarages(way); dropStorefrontGarages(way);" in source
    published = json.loads((ROOT / "docs/sf-corridor-exterior-edits.json").read_text())
    assert published["schema"] == "kerbside.exterior_edits/1"


@pytest.mark.skipif(NODE is None, reason="node is needed to load the module")
def test_drawn_stairs_are_ground_the_walker_climbs_tread_by_tread_and_are_marked_inferred() -> None:
    """A person's stairs are walked like a stoop's (a standing surface, kind "stairs"), not
    passed through, and say they were drawn rather than measured."""
    script = """
const m = await import(process.argv[1]);
// A wall along +x from the origin, facing +z, its foot 10 m up; a door 1.8 m up, 10 steps.
const wall = { ax: 0, az: 0, ux: 1, uz: 0, nx: 0, nz: 1, base: 10 };
const out = {};
for (const direction of ["front", "left", "right"]) {
  const s = m.stairSurface(wall, { u: 2, v: 1.8, w: 1, h: 2.1, stairs: { steps: 10, direction } }, 0.05);
  const at = (x, z) => s(x, z);
  out[direction] = { landing: at(2.5, 0.5), flags: [s.stairs, s.inferred, s.priority, s.label],
    first: direction === "front" ? at(2.5, 0.95 + 0.1) : direction === "left" ? at(1.85 - 0.1, 0.5) : at(3.15 + 0.1, 0.5),
    last: direction === "front" ? at(2.5, 0.95 + 8 * 0.28 + 0.1) : direction === "left" ? at(1.85 - 8 * 0.28 - 0.1, 0.5) : at(3.15 + 8 * 0.28 + 0.1, 0.5),
    off: direction === "front" ? at(2.5, 0.95 + 9 * 0.28 + 0.1) : at(2.5, 3), behind: at(2.5, -0.2), aside: at(8, 0.5) };
}
console.log(JSON.stringify(out));
"""
    result = subprocess.run([NODE, "--input-type=module", "-e", script, (ROOT / "docs/exterior-editor.mjs").as_uri()],
                            capture_output=True, text=True, check=True)
    for direction, s in json.loads(result.stdout).items():
        assert s["flags"] == [True, True, 1, "Stairs (inferred)"], direction
        assert s["landing"] == pytest.approx(11.8), direction  # the door's sill
        assert s["first"] == pytest.approx(11.8 - 0.18), direction  # one riser down
        assert s["last"] == pytest.approx(10.18), direction  # the bottom tread, one riser up
        assert s["off"] is None and s["behind"] is None and s["aside"] is None, direction


def test_an_edits_stairs_join_the_walkers_ground_and_leave_it_with_the_edit() -> None:
    source = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    editor = (ROOT / "docs/exterior-editor.mjs").read_text()
    assert "standing.push(stairSurface(wall, o, front, recess, ctx.groundAt));" in editor
    assert "groundAt: (x, z) => terrainGroundAt(x, z)," in source
    assert "for (const surface of group.userData.standing || []) standingSurfaces.add(surface);" in source
    assert "for (const surface of group.userData.standing || []) standingSurfaces.delete(surface);" in source
    assert "if (group) { context.addToWorld(group); exteriorEditGroups.set(id, group); }" in source
