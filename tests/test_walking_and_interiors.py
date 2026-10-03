"""Solid buildings, doors, and the generic interiors fitted to them."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import textwrap
from pathlib import Path

import numpy as np
import pytest

from smc.interiors import fit
from tests.test_world_object_renderer import _extract, _page_js

NODE = shutil.which("node")


def _template(length: float, width: float, storeys: int = 1, tid: str = "t") -> fit.Template:
    room = np.array([[-length / 2, -width / 2], [length / 2, -width / 2],
                     [length / 2, width / 2], [-length / 2, width / 2]])
    return fit.Template(tid, "resplan", "CC-BY-4.0", "x", length, width, length * width,
                        storeys, 2.8, [("living", room)], [])


class TestFit:
    def test_proportions_are_met_by_choice_not_by_stretch(self):
        library = [_template(10, 8, tid="square"), _template(14, 5, tid="long")]
        f = fit.best_fit(14.5, 5.2, 1, library, np.arange(2))
        assert library[f.template].id == "long" and (f.nx, f.ny) == (1, 1)
        assert max(abs(math.log(f.sx)), abs(math.log(f.sy))) < 0.05

    def test_a_long_building_repeats_its_plan_rather_than_stretching_it(self):
        library = [_template(10, 8)]
        f = fit.best_fit(40.0, 8.0, 3, library, np.arange(1))
        assert (f.nx, f.ny) == (4, 1) and f.sx == pytest.approx(1.0)

    def test_a_plan_is_turned_when_that_fits_better(self):
        library = [_template(12, 6)]
        f = fit.best_fit(12.0, 12.0, 1, library, np.arange(1))
        assert f.cost < 0.2

    def test_a_template_is_normalised_into_its_own_rectangle(self):
        angle = math.radians(30)
        rot = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
        room = (np.array([[0, 0], [12, 0], [12, 5], [0, 5]], float) @ rot.T + [100, 50]).tolist()
        door = (np.array([[5.5, -0.1], [6.5, -0.1], [6.5, 0.1], [5.5, 0.1]]) @ rot.T
                + [100, 50]).tolist()
        raw = {"id": "x", "source": "resplan", "storeys": [{"level": 0, "rooms": [
            {"kind": "bedroom", "poly": room}], "structure": [],
            "openings": [{"kind": "door", "poly": door, "width": 1.0}]}],
            "descriptors": {"storeys": 1}}
        t = fit.normalise(raw)
        assert (t.length, t.width) == (pytest.approx(12), pytest.approx(5))
        poly = t.rooms[0][1]
        assert np.allclose(np.abs(poly).max(axis=0), [6, 2.5], atol=0.02)
        assert t.doors[0][2] == pytest.approx(1.0)

    def test_a_door_opens_onto_open_ground_on_the_wall_nearest_the_street(self):
        ring = np.array([[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]], float)
        street = np.array([[5.0, -6.0]])  # south of the building
        edges = fit.door_edges(ring, street)
        assert edges[0] == 0                                   # the south wall
        outside = fit.outside_point(ring, 0, 0.5)
        assert outside[1] < 0 and not fit.point_in_ring(ring[:-1], *outside)


@pytest.mark.skipif(NODE is None, reason="node is needed to run the page's code")
class TestWalls:
    def _run(self, body: str) -> object:
        js = _page_js()
        script = textwrap.dedent("""
            const WALKER_RADIUS_M = 0.3, WALK_SUBSTEP_M = 0.15, FOOTPRINT_CELL = 60;
            const footprintGrid = new Map();
            const ring = [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]];
            const entry = { way: { osm_id: 1, points: [] }, local: ring, minX: 0, maxX: 10, minZ: 0,
                            maxZ: 8, solid: true, doors: [] };
            footprintGrid.set("0:0", [entry]);
            const avatar = { position: { x: 5, z: -2 } };
        """) + "\n".join(_extract(n, js) for n in (
            "insideFootprint", "wallSegmentsNear", "pushOutOfWalls", "moveWalker")) + \
            "\n" + textwrap.dedent(body)
        result = subprocess.run([NODE, "-e", script], capture_output=True, text=True,
                                timeout=60, check=False)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)

    def test_a_wall_stops_the_walker_and_an_open_door_lets_it_in(self):
        out = self._run("""
            const res = {};
            moveWalker(0, 5);   // straight at the south wall
            res.blocked = [avatar.position.x, avatar.position.z];
            avatar.position.x = 2; avatar.position.z = -1;
            moveWalker(4, 0.9); // at a slant: slides along it
            res.slid = [avatar.position.x, avatar.position.z];
            entry.doors.push({ edge: 0, t0: 0.45, t1: 0.55, open: true });
            avatar.position.x = 5; avatar.position.z = -2;
            moveWalker(0, 5);
            res.through = [avatar.position.x, avatar.position.z, insideFootprint(entry, avatar.position.x, avatar.position.z)];
            entry.doors[0].open = false;
            moveWalker(0, -5);  // the door shut behind: the walker is kept in
            res.keptIn = insideFootprint(entry, avatar.position.x, avatar.position.z);
            console.log(JSON.stringify(res));
        """)
        assert out["blocked"][1] == pytest.approx(-0.3, abs=1e-6)
        assert out["slid"][0] == pytest.approx(6.0, abs=1e-6) and out["slid"][1] <= -0.3 + 1e-9
        assert out["through"][2] is True and out["through"][1] == pytest.approx(3.0, abs=1e-6)
        assert out["keptIn"] is True


@pytest.mark.skipif(NODE is None, reason="node is needed to run the page's code")
def test_entry_stairs_and_four_tread_landing_never_leave_the_building() -> None:
    page = (Path(__file__).resolve().parents[1] / "docs/sf-corridor-3d.html").read_text()
    js = page[page.index('<script type="module">'):]
    script = textwrap.dedent("""
        const STEP_RISE_M = 0.18, STEP_TREAD_M = 0.3, STEP_LANDING_TREADS = 4;
        const entry = { local: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]],
                        minX: 0, maxX: 10, minZ: 0, maxZ: 8 };
        const door = { entry, cx: 5, cz: 0, ux: 1, uz: 0, nx: 0, nz: 1, width: 1 };
        let terrainGroundAt = () => 0;
    """) + "\n".join(_extract(name, js) for name in ("insideFootprint", "planInwardStoop")) + \
        "\n" + textwrap.dedent("""
            const plan = planInwardStoop(door, 0, 0.72);
            const outside = { ...door, nz: -1 };
            const shallow = { ...door, entry: { ...entry, local: [[0, 0], [10, 0],
                [10, 1.5], [0, 1.5], [0, 0]], maxZ: 1.5 } };
            const concave = { ...door, entry: { ...entry, local: [[0,0],[10,0],
                [10,8],[5.1,8],[5.1,1.0],[4.9,1.0],[4.9,8],[0,8],[0,0]] } };
            const corners = plan.treads.flatMap(tread => [-plan.width/2, plan.width/2]
                .flatMap(along => [Math.max(0.03, tread.near), tread.far]
                    .map(inward => [door.cx + door.ux*along + door.nx*inward,
                                    door.cz + door.uz*along + door.nz*inward])));
            console.log(JSON.stringify({
                count: plan.steps, landing: plan.landingDepth,
                allInside: corners.every(([x,z]) => insideFootprint(entry,x,z)),
                farthest: Math.max(...corners.map(([,z]) => z)),
                outwardRejected: planInwardStoop(outside,0,0.72) === null,
                shallowRejected: planInwardStoop(shallow,0,0.72) === null,
                concaveNotchRejected: planInwardStoop(concave,0,0.72) === null,
                inferredFlatRejected: planInwardStoop({...door,source:2},0,0.36) === null,
                inferredTallRejected: (terrainGroundAt=(x,z)=>z*0.2,
                    planInwardStoop({...door,source:2},0,0.72) === null),
                inferredHillFewSteps: planInwardStoop({...door,source:2},0,0.36)?.steps === 2,
            }));
        """)
    result = subprocess.run([NODE, "-e", script], capture_output=True, text=True,
                            timeout=60, check=False)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert out == {"count": 4, "landing": pytest.approx(1.2), "allInside": True,
                   "farthest": pytest.approx(2.4), "outwardRejected": True,
                   "shallowRejected": True, "concaveNotchRejected": True,
                   "inferredFlatRejected": True,
                   "inferredTallRejected": True, "inferredHillFewSteps": True}


@pytest.mark.skipif(NODE is None, reason="node is needed to run the page's code")
def test_recessed_stair_cuts_only_the_interior_floor() -> None:
    js = _page_js()
    script = textwrap.dedent("""
        const STEP_RISE_M=0.18, STEP_TREAD_M=0.3, STEP_LANDING_TREADS=4;
        const THREE={Vector2:class {constructor(x,y){this.x=x;this.y=y;}},
          Shape:class {constructor(points){this.points=points;this.holes=[];}},
          Path:class {constructor(){this.points=[];} moveTo(x,y){this.points.push([x,y]);}
            lineTo(x,y){this.points.push([x,y]);} closePath(){}}};
        const entry={local:[[0,0],[10,0],[10,8],[0,8],[0,0]],minX:0,maxX:10,minZ:0,maxZ:8};
        const door={entry,cx:5,cz:0,ux:1,uz:0,nx:0,nz:1,width:1};
    """) + "\n".join(_extract(name, js) for name in (
        "insideFootprint", "planInwardStoop", "stoopCutRing", "floorShapeWithStairCuts")) + \
        "\n" + textwrap.dedent("""
            door.stoopPlan=planInwardStoop(door,0,0.72);
            const cut=stoopCutRing(door);
            const floor=floorShapeWithStairCuts(entry.local.slice(0,-1),[cut]);
            console.log(JSON.stringify({holes:floor.holes.length,
              cutInside:cut.every(([x,z])=>insideFootprint(entry,x,z)),
              cutDepth:Math.max(...cut.map(([,z])=>z)),
              unchangedCeiling:entry.local.length-1}));
        """)
    result = subprocess.run([NODE, "-e", script], capture_output=True, text=True,
                            timeout=60, check=False)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {"holes": 1, "cutInside": True,
                                         "cutDepth": pytest.approx(1.22), "unchangedCeiling": 4}


@pytest.mark.skipif(NODE is None, reason="node is needed to run the page's code")
def test_inferred_furniture_fits_room_and_keeps_entry_clear() -> None:
    js = _page_js()
    script = textwrap.dedent("""
            class Group {constructor(){this.children=[];this.position={set(x,y,z){Object.assign(this,{x,y,z});}};this.rotation={};}
          add(item){this.children.push(item);}}
        class Mesh {constructor(geometry,material){this.geometry=geometry;this.material=material;
          this.position={set(){}};this.rotation={};}}
        const THREE={Group,Mesh,BoxGeometry:class {},CylinderGeometry:class {}};
        const furnishingMaterials={wood:{},fabric:{},linen:{},cabinet:{},counter:{},
          appliance:{},dark:{}};
        function loadInteriorAsset() { return Promise.resolve(null); }
        const entry={local:[[0,0],[8,0],[8,6],[0,6],[0,0]],
          minX:0,maxX:8,minZ:0,maxZ:6};
    """) + "\n".join(_extract(name, js) for name in (
        "insideFootprint", "pointInRing", "furnishingPlacement", "addRoomFurnishing")) + \
        "\n" + textwrap.dedent("""
            const room=[[0,0],[8,0],[8,6],[0,6]];
            const clear=new Group(), blocked=new Group(), tiny=new Group();
            addRoomFurnishing(clear,entry,'kitchen',room,0,[]);
            addRoomFurnishing(blocked,entry,'kitchen',room,0,[[4,3,1]]);
            addRoomFurnishing(tiny,entry,'bedroom',[[3.5,2.5],[4.5,2.5],[4.5,3.5],[3.5,3.5]],0,[]);
            console.log(JSON.stringify({clear:clear.children.length,
              provenance:clear.children[0]?.userData.grade,
                  blocked:blocked.children.length,tiny:tiny.children.length,
                  blockedPosition:blocked.children[0]?.position}));
        """)
    result = subprocess.run([NODE, "-e", script], capture_output=True, text=True,
                            timeout=60, check=False)
    assert result.returncode == 0, result.stderr
    output = json.loads(result.stdout)
    position = output.pop("blockedPosition")
    assert output == {"clear": 1, "provenance": "inferred_from_room_type", "blocked": 1, "tiny": 0}
    # The blocked center is not an excuse to leave a large room empty: retry
    # a safe placement, keeping the entire kitchen fixture clear of the door.
    assert ((position["x"] - 4) ** 2 + (position["z"] - 3) ** 2) ** 0.5 > 1.2


def test_room_ceiling_default_respects_recess_and_explicit_first_person() -> None:
    js = _page_js()
    update = _extract("updateDoors", js)
    assert "insideEntranceRecess(insideEntry, x, z)" in update
    assert "insideEntry?.interior && !state.firstPerson && !state.ceilingRoom" in update
    assert "setCeilingView(true)" in update
    assert "!insideId && state.ceilingRoom" in update
    assert update.index("buildInterior(entry)") < update.index("setCeilingView(true)")
