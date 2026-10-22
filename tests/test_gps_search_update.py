"""Your walker where you are; a searched place shown, not travelled to; updates applied at once."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_walker_walks_toward_where_you_are_and_jumps_when_far() -> None:
    js = _page_js()
    script = "\n".join([
        """
        class V { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
                  copy(o){return this.set(o.x,o.y,o.z);} }
        const THREE = { Vector3: V };
        const AVATAR_STAND_Y = 0.9, GPS_JUMP_M = 60, GPS_WALK_SPEED_MS = 4, GPS_LEASH = { on: true };
        const avatar = { position: new V(0, 0.9, 0), rotation: { y: 0 }, userData: {} };
        const state = { target: new V() };
        const held = new Set();
        const walkerGroundAt = () => 0;
        const groundLiftAt = () => 0;
        function placeCamera() {}
        function animateAvatar(d, dir, moving) { if (moving) avatar.rotation.y = Math.atan2(dir.x, dir.z); }
        const gps = { target: new V(10, 0, 0), heading: null, follow: true };
        const FOOTPRINT_CELL=60, WALKER_RADIUS_M=.35, WALK_SUBSTEP_M=.18, activeGuest=null;
        const footprintGrid=new Map(), footprintById=new Map(), streetLandingSegments=[];
        function wallSegmentsNear(){return [];}
        """,
        "\n".join(_extract(name, js) for name in (
            "insideFootprint", "buildingAt", "eligibleLanding", "exteriorLanding", "walkerExteriorAt",
            "distanceToSegmentSquared", "firstBuildingCollision", "walkerFootprintBlocked", "moveWalker")),
        _extract("followGps", js),
        """
        followGps(0.5);
        const walked = avatar.position.x;
        gps.target = new V(500, 0, -300);
        followGps(0.016);
        const jumped = [avatar.position.x, avatar.position.z];
        held.add("ArrowUp");
        gps.target = new V(0, 0, 0);
        const keys = followGps(0.5);
        held.clear();
        avatar.position.set(0, 0.9, 0); gps.target = new V(0.1, 0, 0); gps.heading = 90;
        followGps(0.1);
        const facing=avatar.rotation.y;
        // A previously accepted GPS fix becomes a building once its footprint cell loads.
        const entry={way:{osm_id:1},minX:499,maxX:501,minZ:-301,maxZ:-299,
          local:[[499,-301],[501,-301],[501,-299],[499,-299],[499,-301]]};
        footprintGrid.set('8:-6',[entry]);footprintGrid.set('8:-5',[entry]);
        footprintById.set('1',entry);
        gps.target=new V(500,0,-300);followGps(.016);
        const gpsInside=Boolean(buildingAt(gps.target.x,gps.target.z));
        const walkerInside=Boolean(buildingAt(avatar.position.x,avatar.position.z));
        console.log(JSON.stringify({ walked, jumped, keys, facing, gpsInside, walkerInside }));
        """,
    ])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert 4.9 <= r["walked"] <= 5.1, "walking pace toward the fix, faster the further behind"
    assert r["jumped"] == [500, -300], "too far to walk: the walker is put there"
    assert r["keys"] is False, "the arrow keys win over the phone"
    assert abs(r["facing"] - 3.14159 / 2) < 1e-3, "standing still, it faces the way the phone does (east)"
    assert not r["gpsInside"] and not r["walkerInside"], "late-loaded buildings still keep GPS arrivals outside"


def test_a_searched_place_is_shown_and_the_directions_filled_in_without_moving_the_walker() -> None:
    js = _page_js()
    travel = _extract("travelTo", js) if "function travelTo" in js else js[js.index("function travelTo"):]
    assert travel.index("window.kerbsideShowPlace(place)") < travel.index("kerbsideOpenFullRegionAt")
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    show = page[page.index("window.kerbsideShowPlace = (place) => {"):]
    show = show[:show.index("\n  };") + 4]
    assert "goTo(new THREE.Vector3(x, 0, -y));" in show and "travel" not in show, "only the view moves"
    assert "route.stops[route.stops.length - 1] = place;" in show and "route.stops[0] = here();" in show
    assert 'if (gps.fix && regionAt(gps.fix.lon, gps.fix.lat)) return { label: "Your location", lon: gps.fix.lon, lat: gps.fix.lat, here: true };' in page
    assert "navigator.geolocation.watchPosition(" in page and 'localStorage.getItem(GPS_KEY) !== "off"' in page


def test_a_start_chosen_in_the_directions_puts_the_walker_there() -> None:
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    start = page[page.index("  function walkerToStart(place) {"):]
    start = start[:start.index("\n  }\n") + 4]
    # Outside, at the address, as a search puts it; never into a building.
    assert "goTo(addressLanding(new THREE.Vector3(x, 0, -y)), { travel: true, zoom: true });" in start
    assert "place.lon >= b.west" in start, "a start outside the region leaves the walker where it is"
    assert "if (i === 0) walkerToStart(place);" in page, "picked, or taken with Enter, it moves the walker"
    assert 'if (e.key !== "Enter" || !offered.length) return;' in page
    assert "if (!stops[0].here) walkerToStart(stops[0]);" in page, "and directions from it start there"


def test_a_new_version_is_applied_at_once_to_every_open_and_installed_app() -> None:
    sw = (ROOT / "tools/pwa/sw.js").read_text()
    assert ".then(() => self.skipWaiting())" in sw
    assert 'self.clients.matchAll({ type: "window" })' in sw and "client.navigate(client.url)" in sw
    app = (ROOT / "tools/app_template.html").read_text()
    assert 'sessionStorage.getItem("kerbside-update-reload")' in app and "window.location.reload();" in app
    assert 'allow="geolocation"' in app
    assert "client.navigate(client.url)" in (ROOT / "docs/sw.js").read_text()
