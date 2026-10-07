"""Rooms laid out as rooms, the walker's indoor pace, the messages that fade, the houses' materials,
and the settings that pace the page.

A sofa's back is to a wall and it faces the room; the television is on the wall it faces; a bed's
head is to a wall with a chest of drawers on another. Inside a house the walker walks (3 mph).
A message over the view fades after four seconds. Houses are clad in the material libraries, not
hung with photographs of themselves. The page draws at a chosen frame rate, idles when nothing
moves, brings detail in by zoom, and never makes three.js draw the city twice for a light bulb.
"""

from __future__ import annotations

import json
import re
import subprocess

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _node(script: str) -> dict:
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_pieces_back_onto_a_wall_and_face_into_the_room() -> None:
    js = _page_js()
    script = """
const entry = { local: [[0, 0], [6, 0], [6, 4], [0, 4], [0, 0]], minX: 0, maxX: 6, minZ: 0, maxZ: 4 };
const ROOM_DOOR_CLEAR_M = 0.8;
""" + "\n".join(_extract(n, js) for n in ("pointInRing", "insideFootprint", "roomLayout")) + """
const room = [[0, 0], [6, 0], [6, 4], [0, 4]];
const layout = roomLayout(entry, room, []);
const longest = layout.walls[0];
const spot = layout.alongWall(longest, 2.1, 0.95)[0];
// The piece's front (local +z) after the turn: (sin yaw, cos yaw).
const front = [Math.sin(spot.yaw), Math.cos(spot.yaw)];
const toCentre = [3 - spot.cx, 2 - spot.cz];
const blockedByDoor = roomLayout(entry, room, [[3, 0.5, 1]]).fits(3, 0.6, 0, 2.1, 0.95);
layout.occupy(spot.cx, spot.cz, spot.yaw, 2.1, 0.95);
console.log(JSON.stringify({
  wallLength: longest.len,
  facesIn: front[0] * toCentre[0] + front[1] * toCentre[1] > 0,
  backGap: Math.min(spot.cz, 4 - spot.cz) - 0.95 / 2,
  fits: layout.fits(3, 2, 0, 1, 1, false),
  overlapsSofa: !layout.fits(spot.cx, spot.cz, spot.yaw, 1, 0.5),
  blockedByDoor,
}));
"""
    result = _node(script)
    assert result["wallLength"] == 6
    assert result["facesIn"], "a piece backed onto a wall faces into the room"
    assert 0 <= result["backGap"] < 0.1, "and stands against that wall"
    assert result["fits"] and result["overlapsSofa"], "placed pieces block what comes after"
    assert not result["blockedByDoor"], "nothing stands in a doorway"


def test_the_living_room_and_bedroom_rules() -> None:
    js = _page_js()
    living = _extract("furnishLiving", js)
    # The television is on a wall facing the sofa, at a viewing distance, square to it.
    assert "if (wall.nx * nx + wall.nz * nz > -0.85) continue;" in living
    assert "spot.distance >= 1.9 && spot.distance <= 5.8" in living
    assert '"coffee_table"' in living and "addRug(" in living and '"armchair"' in living
    bedroom = _extract("furnishBedroom", js)
    assert '"nightstand"' in bedroom and '"dresser"' in bedroom and "addRug(" in bedroom
    # The chest of drawers goes on another wall than the bed's.
    assert "layout.walls.filter((w) => w !== wall)" in bedroom
    room = _extract("furnishRoomFor", js)
    assert "addCeilingLight(" in room
    build = _extract("buildInterior", js)
    assert "furnishRoom(group, entry, room, floorY, height, doorsInPlan, index)" in build
    # One light for the room the walker is in, kept in the scene; none added per house.
    assert "new THREE.PointLight" not in build
    assert "scene.add(indoorLight);" in js


def test_rugs_vary_by_room_and_house() -> None:
    js = _page_js()
    kinds = re.search(r"const RUG_KINDS = \[([^\]]+)\]", js).group(1)
    assert len(kinds.split(",")) >= 6
    palettes = js[js.index("const RUG_PALETTES = ["):js.index("const RUG_KINDS")]
    assert palettes.count("[\"#") >= 8
    room = _extract("furnishRoomFor", js)
    assert "Number(entry.way.osm_id)" in room and "index * 7919" in room


def test_inside_a_house_the_walker_walks() -> None:
    js = _page_js()
    script = "const state = { indoors: true, firstPerson: true, dist: 30 };\n" + \
        re.search(r"const INDOOR_SPEED = [^;]+;", js).group(0) + \
        "\nconst FIRST_PERSON_SPEED = 5.36;\n" + _extract("avatarMoveSpeed", js) + \
        "\nconsole.log(JSON.stringify({ mps: avatarMoveSpeed() }));"
    assert _node(script)["mps"] == pytest.approx(3 * 0.44704, abs=0.002)
    assert "state.indoors = Boolean(insideId && insideEntry?.interior);" in _extract("updateDoors", js)


def test_messages_fade_and_no_house_promises_a_floor_it_cannot_reach() -> None:
    js = _page_js()
    assert "const HINT_SHOW_MS = 4000;" in js
    hint = _extract("setHint", js)
    assert "now - hintSince > HINT_SHOW_MS" in hint and 'doorHint.style.opacity = "0"' in hint
    update = _extract("updateDoors", js)
    assert "storey up" not in update and '"No house interior"' in update
    show = _extract("showDoor", js)
    # A small rise: the rooms come down to the street door and the door opens.
    assert "ground - street <= ROOMS_LOWERED_MAX_M" in show and "door.entry.roomsLowered = true;" in show


def test_houses_are_clad_in_material_not_hung_with_photographs() -> None:
    js = _page_js()
    assert "const FACADE_PHOTOS = false;" in js
    assert "if (!FACADE_PHOTOS) return false;" in _extract("photographedEdge", js)
    pick = _extract("pickMaterial", js)
    assert "if (home) {" in pick and "homeCladdingFor(seed)" in pick
    shares = re.search(r"const HOME_CLADDING_SHARES = \[(.*?)\];", js, re.S).group(1)
    total = sum(float(x) for x in re.findall(r", ([0-9.]+)\]", shares))
    assert total == pytest.approx(1.0)


def test_settings_pace_the_page_and_detail_comes_with_zoom() -> None:
    js = _page_js()
    presets = js[js.index("const QUALITY_PRESETS = {"):js.index("const FPS_CHOICES")]
    for name in ("low:", "medium:", "high:", "max:"):
        assert name in presets
    assert "const FPS_CHOICES = [15, 30, 45, 60, 0];" in js
    assert "window.kerbsideSettings = {" in js and 'settingsButton.id = "settings-toggle";' in js
    animate = _extract("animate", js)
    assert "SETTINGS.fps > 0 ? 1000 / SETTINGS.fps : 0" in animate and "IDLE_FRAME_MS" in animate
    tiers = js[js.index("const ZOOM_HIDDEN = {"):js.index("let zoomTier")]
    assert 'surface === "house_window"' in tiers and 'surface.startsWith("furniture:")' in tiers
    cull = _extract("cullDetailByDistance", js)
    # Only when the view changed, and cell by cell.
    assert "!viewChanged(eye)" in cull and "for (const cell of detailCells)" in cull
    assert "m.forceSinglePass = true" in cull
    # The build rests between slices of work.
    assert "const rest = QUALITY().restMs;" in _extract("yieldFrame", js)


def test_model_glass_never_turns_on_the_transmission_pass() -> None:
    js = _page_js()
    glass = _extract("plainGlass", js)
    assert "m.transmission > 0" in glass
    assert "plainGlass(gltf.scene)" in _extract("loadInteriorModel", js)
    # The models come only for the house the walker is at.
    assert "whenNear(entry, () => loadInteriorModel(role, seed))" in _extract("interiorModel", js)
    assert "plainGlass(gltf.scene)" in _extract("loadInteriorAsset", js)


def test_one_world_search_reaches_every_region_and_no_region_is_chosen() -> None:
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    index = json.loads((root / "docs/search-index.json").read_text())
    built = [r for r in json.loads((root / "docs/app-regions.json").read_text())["regions"] if r.get("built")]
    assert len(index["regions"]) == len(built) >= 2
    names = {r["name"] for r in index["regions"]}
    regions_with_rows = {index["regions"][row[3]]["name"] for row in index["addresses"]}
    assert regions_with_rows == names, "every built region's addresses are searchable"
    js = _page_js()
    assert "new URL(\"search-index.json\"" in js and "elsewhere.addresses" in js
    # Travelling to a hit elsewhere loads that region's full model; no picker to choose it from.
    assert "window.kerbsideOpenFullRegionAt(place.lon, place.lat)" in js
    assert "group.hidden = true;" in js and "group.hidden = false;" not in js
    assert "state.dist > REGION_ENTER_DIST_M" in js and "REGION_SETTLE_MS" in js


def test_regions_are_built_in_this_page_not_loaded_as_another() -> None:
    js = _page_js()
    # The same code, attached: the page's renderer, its own assets, no frame loop, tile tree,
    # region markers or bay of its own, and a world placed in the page's scene.
    assert "const ATTACH = globalThis.__kerbsideGuest || null;" in js
    assert "const renderer = ATTACH ? ATTACH.renderer : new THREE.WebGLRenderer(" in js
    assert "if (ATTACH) ATTACH.onRoot(root); else scene.add(root);" in js
    assert "if (!ATTACH) animate();" in js and "if (!ATTACH) await loadTileTree();" in js
    attach = _extract("attachRegion", js)
    assert "location.assign" not in attach and "await import(holder.url)" in attach
    # A region page's own relative fetches are resolved against that page, not this one.
    assert "__kerbsideGuestIn.resolve" in attach
    # One region in full at a time: the one left behind is let go.
    assert "releaseHostWorld()" in attach and "releaseGuest(previous)" in attach
    assert "earthDrop(hx, -hy)" in attach and "metersPerLon / api.metersPerLon" in attach
    # The walker stands on, and walks round, the attached region's ground and walls.
    assert "guest.api.walkerGroundAt(gx, gz) + guest.oy" in _extract("walkerGroundAt", js)
    assert "guest.api.wallSegmentsNear(gx, gz)" in _extract("wallSegmentsNear", js)
