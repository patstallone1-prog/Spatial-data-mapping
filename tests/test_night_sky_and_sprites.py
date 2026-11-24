"""The night the game can be played in, as shipped: the moon is drawn, parks do not glow, a
released window leaves the page's sprites alone, and racks keep clear of posts (2026-11-14)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from smc.renderer.template import renderer_source

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


def _function(js: str, name: str) -> str:
    start = js.index(f"function {name}(")
    return js[start:js.index("\n}\n", start)]


def test_a_released_window_does_not_empty_the_quad_every_sprite_draws_with() -> None:
    """three.js keeps one geometry for all sprites. Emptied with a released window's labels, the
    moon, its halo and every label on the page drew nothing from then on."""
    empty = _function(renderer_source(), "emptyOne")
    assert "if (o.geometry && !o.isSprite) {" in empty


def test_the_moon_stands_inside_the_cameras_far_plane() -> None:
    """City mode draws to 1.6 km; a moon 20 km out was clipped and never seen."""
    sky = (ROOT / "docs/environment-runtime.mjs").read_text()
    assert "const moonAt=Math.min(MOON_AT,camera.far*.85),moonScale=moonSize*moonAt/MOON_AT;" in sky
    assert "moon.position.copy(camera.position).addScaledVector(moonDir,moonAt);" in sky


def test_the_sky_reads_the_games_clock_in_the_city_and_the_walls_in_explore() -> None:
    sky = (ROOT / "docs/environment-runtime.mjs").read_text()
    assert "let clockMode='live';" in sky
    assert "const clockNow=()=>clockMode==='game' ? new Date(gameClock.game(clockTime(Date.now()))) : new Date();" in sky
    js = renderer_source()
    assert 'environmentController?.setClock?.(city ? "game" : "live");' in _function(js, "compassForMode")
    assert 'if (typeof compassForMode === "function") compassForMode(appMode);' in _function(js, "setAppMode")
    # Explore keeps its box to turn the walker and move the sun; the city's compass is not a button.
    assert 'svg.addEventListener("click", () => { if (!compassIsReadingOnly()) toggleSunDial(); });' in js
    assert 'svg.style.pointerEvents = city ? "none" : "auto";' in js


def test_tree_crowns_drawn_as_points_go_down_to_moonlight() -> None:
    nature = (ROOT / "docs/nature-runtime.mjs").read_text()
    assert "shader.uniforms.uNatureNight=globalThis.__kerbsideNight?.night || {value:0};" in nature
    assert "vec3(.16,.22,.42),uNatureNight);" in nature


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_bike_rack_keeps_clear_of_a_post_on_the_pavement() -> None:
    js = _function(renderer_source(), "placeCityBikeRacks") + "\n}\n"
    script = """
let bikeRackStats = null;
const BIKE_RACK = { row: 1.2, corral: 0.9, slot: 0.35, half: 0.45 };
const xy = (lon, lat) => [lon, lat];
const nearestKerbAt = (x, z) => ({ x, z: -6, nx: 0, nz: -1, ax: 1, az: 0, half: 6 });
const streetSquareKerb = (k) => k;
const insideJunctionBox = () => false, onCrossingGround = () => false, insideBikeLane = () => false;
const insideCarriageway = (x, z) => z > -6, buildingAt = () => false;
const pavementTopAt = () => 0.13, groundLiftAt = () => 0, ROAD_TOP_M = 0.02, KERB_FALLBACK = 0.126;
""" + js + """
const site = [{ id: 's', p: [10, 7], racks: 1, placement: 'sidewalk' }];
const free = placeCityBikeRacks(site)[0];
const post = [free.x, free.z];
const moved = placeCityBikeRacks(site, [post, { x: 500, z: 500 }])[0];
console.log(JSON.stringify({ free: [free.x, free.z], moved: [moved.x, moved.z], apart: Math.hypot(moved.x - post[0], moved.z - post[1]) }));
"""
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got["apart"] > 1.1 and got["free"] != got["moved"]
