"""Courts outside parks stand on a hard surround; stacked address-point trees are not trees;
a door says "go in" only where there are rooms; a camera against a wall looks from the eyes."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]
COURTS = ROOT / "src/smc/renderer/page/module/17-trees-a-trunk-limbs-and.js"
DOORS = ROOT / "src/smc/renderer/page/module/24-nearby-what-is-round-the.js"
ROOMS = ROOT / "src/smc/renderer/page/module/26-rooms-laid-out-as-rooms.js"
CAMERA = ROOT / "src/smc/renderer/page/module/21-the-electrical-network-poles-towers.js"
GROUND = ROOT / "docs/app-sf-corridor-ground.json"

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def test_stacked_trees_keep_one_and_only_on_the_street() -> None:
    js = _page_js()
    script = "const TREE_STACK_STREET_M = 9;\n" + _extract("stackedTreesToDrop", js) + """
    const yard = [{ p: [1, 1], d: 1, v: "columnar" }, { p: [1, 1], d: 10, v: "street" }];   // mid-lot
    const kerb = [{ p: [2, 2], d: 4 }, { p: [2, 2], d: 12 }, { p: [2, 2], d: 6 }];         // on the pavement
    const alone = [{ p: [3, 3], d: 8 }];                                                     // surveyed
    const all = [...yard, ...kerb, ...alone];
    const dist = (t) => (t.p[0] === 1 ? 60 : 3);
    const drop = stackedTreesToDrop(all, dist);
    console.log(JSON.stringify({ kept: all.filter((t) => !drop.has(t)).map((t) => [t.p[0], t.d]) }));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    assert json.loads(out.stdout)["kept"] == [[2, 12], [3, 8]]


def test_the_marina_middle_school_yard_tree_is_a_stack() -> None:
    trees = json.loads(GROUND.read_text())["trees"]
    here = [t for t in trees if t["p"] == [-122.435481, 37.801826]]
    assert len(here) == 2, "two records on one point in the middle of the yard: an address point"


def test_a_court_outside_a_park_is_not_set_in_grass() -> None:
    source = COURTS.read_text()
    body = source[source.index("function buildCourts("):]
    assert "`hard:${style.surround}`" in body
    assert "map: courtSurface(Number(variant.slice(5)))" in body
    # In a park the pad is still the park's grass.
    assert "grassVariantForRing(park.p, GRASS_VARIANTS) : null" in body


def test_a_door_says_go_in_only_where_there_are_rooms() -> None:
    doors, rooms = DOORS.read_text(), ROOMS.read_text()
    assert "function entryRoomsPossible(entry)" in rooms
    gate = rooms[rooms.index("function entryRoomsPossible("):rooms.index("function buildInterior(")]
    # The same rules as buildInterior: a shop's building without its own layout has none.
    assert "commercialInterior(entry)" in gate and "entry.generatedInteriorRef" in gate
    assert "entryRoomsPossible(door.entry) ?" in doors
    assert "return { shopIn: String(door.entry.way.osm_id) }" in doors
    assert "livingCity?.enterBuilding?.(done.shopIn)" in doors


def test_a_camera_pulled_into_the_walker_looks_from_its_eyes() -> None:
    js = _page_js()
    script = "\n".join([
        "class V { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} clone(){return new V(this.x,this.y,this.z);} copy(o){this.x=o.x;this.y=o.y;this.z=o.z;return this;} }",
        "const THREE = { Vector3: V };",
        "const ATTACH = null, AVATAR_EYE_Y = 1.6, ORBIT_MIN_WALKER_M = 1.6; var walkerHiddenByCamera = false;",
        "const avatar = { position: new V(5, 0.9, 5), visible: true, userData: {} };",
        "const state = { target: new V(5, 0.9, 5), yaw: 0, pitch: 0.4, explore: false, firstPerson: false };",
        "const camera = { position: new V(), looked: null, lookAt(x, y, z) { this.looked = [x, y, z]; } };",
        "const walkerGroundAt = () => 0; const fitViewToAltitude = () => {};",
        _extract("walkerEyeView", js),
        """
        const near = walkerEyeView(0.3);
        const r1 = { near, cam: [camera.position.x, camera.position.y, camera.position.z], visible: avatar.visible };
        const back = walkerEyeView(null);
        console.log(JSON.stringify({ ...r1, back, visibleAfter: avatar.visible, far: walkerEyeView(4) }));
        """])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["near"] is True and r["visible"] is False
    assert r["cam"] == [5, 1.6, 5], "at the walker's eyes, not inside its legs"
    assert r["back"] is False and r["visibleAfter"] is True
    assert r["far"] is False
