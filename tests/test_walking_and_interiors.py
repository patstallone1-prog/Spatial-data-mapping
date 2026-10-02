"""Solid buildings, doors, and the generic interiors fitted to them."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import textwrap

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
            function doorRecess(door) { return door.recess; }
            footprintGrid.set("0:0", [entry]);
            const avatar = { position: { x: 5, y: 0, z: -2 } };
            const AVATAR_STAND_Y = 0, STEP_UP_M = 0.45;
            let GROUND = (x, z) => 0;
            function walkerGroundAt(x, z) { return GROUND(x, z); }
        """) + "\n".join(_extract(n, js) for n in (
            "insideFootprint", "edgePoint", "wallSegmentsNear", "pushOutOfWalls",
            "moveWalker")) + \
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
            // A door in a 0.6 m recess on the south wall: r0..r1 the recess, t0..t1 the leaf.
            const door = { entry, edge: 0, r0: 0.4, r1: 0.6, t0: 0.45, t1: 0.55, nx: 0, nz: 1,
                           open: false, recess: { depth: 0.6 } };
            entry.doors.push(door);
            avatar.position.x = 5; avatar.position.z = -2;
            moveWalker(0, 5);   // into the recess, up to the shut leaf at its back
            res.shut = [avatar.position.x, avatar.position.z];
            door.open = true;
            moveWalker(0, 5);
            res.through = [avatar.position.x, avatar.position.z, insideFootprint(entry, avatar.position.x, avatar.position.z)];
            door.open = false;
            moveWalker(0, -5);  // the door shut behind: the walker is kept in
            res.keptIn = insideFootprint(entry, avatar.position.x, avatar.position.z);
            avatar.position.x = 3; avatar.position.z = -1;
            moveWalker(0, 3);   // beside the recess, the facade still stops it
            res.beside = avatar.position.z;
            // A ledge higher than a stride is a wall; a kerb is not.
            avatar.position.x = 5; avatar.position.z = -6;
            GROUND = (x, z) => (z > -5 ? 0.15 : 0);
            moveWalker(0, 1.5);
            res.kerb = avatar.position.z;
            avatar.position.z = -6;
            GROUND = (x, z) => (z > -5 ? 1.2 : 0);
            moveWalker(0, 1.5);
            res.ledge = avatar.position.z;
            console.log(JSON.stringify(res));
        """)
        assert out["blocked"][1] == pytest.approx(-0.3, abs=1e-6)
        assert out["slid"][0] == pytest.approx(6.0, abs=1e-6) and out["slid"][1] <= -0.3 + 1e-9
        assert out["shut"][1] == pytest.approx(0.3, abs=1e-6)   # 0.6 m in, less the radius
        assert out["through"][2] is True and out["through"][1] == pytest.approx(5.3, abs=1e-6)
        assert out["keptIn"] is True
        assert out["beside"] == pytest.approx(-0.3, abs=1e-6)
        assert out["kerb"] == pytest.approx(-4.5, abs=1e-6)
        assert -5.2 < out["ledge"] <= -5.0


def test_a_plan_carries_its_fixtures_and_an_upper_storey():
    room = [[0, 0], [8, 0], [8, 5], [0, 5]]
    stairs = [[6, 0.2], [7.8, 0.2], [7.8, 1.2], [6, 1.2]]
    storey = {"rooms": [{"kind": "living", "poly": room}], "structure": [], "openings": [],
              "fixtures": [{"kind": "stairs", "poly": stairs}, {"kind": "toilet", "poly":
                           [[1, 1], [1.4, 1], [1.4, 1.6], [1, 1.6]]}]}
    raw = {"id": "sd:x", "source": "swiss_dwellings", "descriptors": {"storeys": 2},
           "storeys": [dict(storey, level=0), dict(storey, level=1)]}
    out = fit.normalise(raw).to_json()
    kinds = [fit.FIXTURES[k] for k, _ in out["fixtures"]]
    assert kinds == ["stairs", "toilet"]
    assert "upper" in out and len(out["upper"]["rooms"]) == 1
    assert len(out["fixtures"][0][1]) == 8      # four corners, in centimetres


@pytest.mark.skipif(NODE is None, reason="node is needed to run the page's code")
def test_the_walker_falls_off_an_edge_and_steps_down_a_stair_without_falling():
    js = _page_js()
    script = textwrap.dedent("""
        const AVATAR_STAND_Y = 0, GRAVITY_M_S2 = 9.81, STEP_DOWN_M = 0.3;
        const avatar = { position: { x: 0, y: 0, z: 0 }, userData: {} };
        let GROUND = 0;
        function walkerGroundAt() { return GROUND; }
    """) + _extract("settleWalker", js) + textwrap.dedent("""
        const res = {};
        avatar.position.y = 0; GROUND = -0.18; settleWalker(1 / 60);
        res.stair = avatar.position.y;               // a stair down: straight onto it
        avatar.position.y = 0; GROUND = -3.0;
        let t = 0; while (avatar.position.y > -3 && t < 5) { settleWalker(1 / 60); t += 1 / 60; }
        res.fallTime = t; res.landed = avatar.position.y;   // off a 3 m wall: falls, then lands
        avatar.userData.vy = 4.0; GROUND = -3.0;
        let top = -3; for (let k = 0; k < 120; k += 1) { settleWalker(1 / 60); top = Math.max(top, avatar.position.y); }
        res.jump = top + 3;
        console.log(JSON.stringify(res));
    """)
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    res = json.loads(out.stdout)
    assert res["stair"] == pytest.approx(-0.18)
    assert res["fallTime"] == pytest.approx(math.sqrt(2 * 3.0 / 9.81), abs=0.05)
    assert res["landed"] == pytest.approx(-3.0)
    assert res["jump"] == pytest.approx(4.0 ** 2 / (2 * 9.81), abs=0.05)
