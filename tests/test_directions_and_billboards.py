"""Directions from Valhalla, drawn on the ground; the billboards wear the project's own artwork."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from tests.test_corridor_geometry_rules import NODE, _extract, _page_js

ROOT = Path(__file__).resolve().parents[1]


def _routing_script(body: str) -> dict:
    js = _page_js()
    start = js.index("const ROUTE_COSTING = ")
    constants = js[start:js.index("const ROUTE_MAX_STOPS", start)]
    script = "\n".join([
        "const xy = (lon, lat) => [lon * 88000, lat * 111000];",
        constants, "const ROUTE_MAX_SHOWN = 4;",
        _extract("decodePolyline6", js), _extract("encodePolyline6", js), _extract("routeRequest", js),
        "const TURN_MANEUVERS = new Set([10, 11, 12, 13, 14, 15, 26]);",
        _extract("summarizeTrip", js), _extract("summarizeItinerary", js), _extract("tagRoutes", js), body,
    ])
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_route_request_and_its_answer_are_read_as_valhalla_means_them() -> None:
    r = _routing_script("""
        // Google's documented example, at six decimals: three points.
        const line = decodePolyline6("_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI");
        const walk = routeRequest([{ lat: 37.76, lon: -122.41 }, { lat: 37.77, lon: -122.42 }], "walk", { use_hills: 0.0 });
        const drive = routeRequest([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: 5, lon: 6 }], "drive");
        const trip = summarizeTrip({ summary: { time: 600, length: 1.2 }, legs: [
          { shape: "_izlhA~rlgdF", elevation: [10, 12, 11, 15],
            maneuvers: [{ instruction: "Walk north.", type: 1, length: 0.2 }, { instruction: "Turn left.", type: 15 }, { type: 9 }] }] });
        const round = decodePolyline6(encodePolyline6(line));
        console.log(JSON.stringify({ line, walk, drive, trip, round }));
    """)
    assert r["line"] == [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]
    assert r["round"] == r["line"]
    assert r["walk"]["costing"] == "pedestrian" and r["walk"]["alternates"] == 2
    assert r["walk"]["costing_options"]["pedestrian"] == {"use_hills": 0.0}
    assert r["drive"]["costing"] == "auto" and r["drive"]["alternates"] == 0, "stops keep their order"
    assert [p["type"] for p in r["drive"]["locations"]] == ["break"] * 3
    assert (r["trip"]["seconds"], r["trip"]["ascent"], r["trip"]["descent"]) == (600, 6, 1)
    assert r["trip"]["steps"] == ["Walk north.", "Turn left."] and r["trip"]["turns"] == 1, "a slight bend is no turn"
    # Each written step keeps its manoeuvre and length, for the turn arrows and distances beside it.
    assert r["trip"]["stepInfo"] == [{"type": 1, "km": 0.2}, {"type": 15, "km": 0}]


def test_a_route_under_way_shows_its_steps_where_the_sidebar_was_and_draws_over_everything() -> None:
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    # The steps panel: in the hud beside the map, scrollable, back to the options and closable.
    for needle in ('<section class="panel" id="nav-panel" hidden', 'id="nav-back"', 'id="nav-close"',
                   '<ol id="nav-steps"></ol>', 'id="route-show-steps"'):
        assert needle in page, needle
    assert "overflow-y:auto" in page[page.index("#nav-steps {"):page.index("#nav-steps {") + 200]
    js = _page_js()
    assert "if (found.length) showNavigation(true)" in js
    # The chosen route over the grey alternatives (no strand down its middle), seen through the houses
    # from the street, and over the houses from far out -- after the tile tree's see-through ground.
    ribbon = _extract("routeRibbon", js)
    assert "top ? ROUTE_TOP_LIFT_M : 0" in ribbon and "polygonOffsetFactor: -8" in ribbon
    assert "if (over) group.renderOrder = top ? 25 : 24;" in ribbon and "transparent: over" in ribbon
    assert "if (top && !over)" in ribbon and "ghost.renderOrder = 23;" in ribbon
    assert "routeOverHouses() !== routeDrawnOver" in _extract("updateRouteWidth", js)
    # Pins: small, at both ends as soon as they are chosen, drawn last, their group ordered over
    # the tiles' (whose groups carry their depth).
    on_top = _extract("pinOnTop", js)
    assert "if (object.isGroup) object.renderOrder = order;" in on_top and "o.material.transparent = true" in on_top
    assert "group.renderOrder = tile.depth;" in js
    assert "const PLACE_PIN_BASE = 0.45, PLACE_PIN_NEAR_M = 125;" in js
    assert "pinStops();\n    return true;" in js and "stop || (i === 0 ? here() : null)" in _extract("pinStops", js)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_tags_need_a_significant_gain_and_weigh_a_route_up_by_how_much() -> None:
    r = _routing_script("""
        const L = (k) => [[k, 0], [k, 0.01]];
        // A bike ride: B climbs 91 m (three hundred feet) less for three minutes more; C has one
        // more block of bike lane on a long ride; D has far more bike lane.
        const bike = tagRoutes([
          { seconds: 1800, km: 12, ascent: 140, turns: 20, bikeShare: 0.30, bikeKm: 3.6, line: L(0) },
          { seconds: 1980, km: 12.4, ascent: 49, turns: 21, bikeShare: 0.31, bikeKm: 3.8, line: L(1) },
          { seconds: 1830, km: 12.1, ascent: 139, turns: 19, bikeShare: 0.31, bikeKm: 3.75, line: L(2) },
          { seconds: 2100, km: 13, ascent: 130, turns: 22, bikeShare: 0.75, bikeKm: 9.7, line: L(3) },
        ], "bike");
        const transit = tagRoutes([
          { seconds: 1620, km: 4, walkM: 700, transfers: 2, line: L(0) },
          { seconds: 2040, km: 4.2, walkM: 300, transfers: 0, line: L(1) },
          { seconds: 1700, km: 4.1, walkM: 650, transfers: 2, line: L(2) },
        ], "transit");
        const walk = tagRoutes([
          { seconds: 900, km: 1.1, ascent: 30, stairs: 2, line: L(0) },
          { seconds: 960, km: 1.2, ascent: 28, stairs: 0, line: L(1) },
        ], "walk");
        const pick = (rs) => rs.map((x) => ({ s: x.seconds, tags: x.tags.map((t) => t.id), w: +x.weight.toFixed(4) }));
        console.log(JSON.stringify({ bike: pick(bike), transit: pick(transit), walk: pick(walk) }));
    """)
    bike = {x["s"]: x for x in r["bike"]}
    assert bike[1800]["tags"] == ["fastest"]
    assert bike[1980]["tags"] == ["fewest_hills"] and abs(bike[1980]["w"] - 0.06) < 0.001, "300 ft less climbing: 6 per cent"
    assert bike[1830]["tags"] == [], "one more block of bike lane is not bike lane friendly"
    assert "bike_lanes" in bike[2100]["tags"]
    assert [x["s"] for x in r["bike"]][:2] == [1800, 1830]
    transit = {x["s"]: x for x in r["transit"]}
    assert set(transit[2040]["tags"]) == {"least_walking", "fewest_transfers"}
    assert transit[1700]["tags"] == []
    walk = {x["s"]: x for x in r["walk"]}
    assert walk[960]["tags"] == ["no_stairs"], "two metres less climbing is not fewest hills"


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_transit_itinerary_is_read_into_steps_walking_and_transfers() -> None:
    r = _routing_script("""
        const it = { duration: 1740, transfers: 1, startTime: "2026-10-12T19:01:00Z", legs: [
          { mode: "WALK", distance: 160, to: { name: "Mcallister St & Van Ness Ave" }, legGeometry: { points: "_izlhA~rlgdF", precision: 6 } },
          { mode: "BUS", routeShortName: "5", headsign: "Ocean Beach", from: { name: "Mcallister St & Van Ness Ave" },
            to: { name: "Mcallister St & Masonic Ave" }, legGeometry: { points: "_izlhA~rlgdF_{geC~ywl@", precision: 6 } },
          { mode: "WALK", distance: 138, to: { name: "END" }, legGeometry: { points: "", precision: 7 } }] };
        console.log(JSON.stringify(summarizeItinerary(it)));
    """)
    assert r["walkM"] == 298 and r["transfers"] == 1 and r["seconds"] == 1740
    assert r["steps"][0] == "Walk 160 m to Mcallister St & Van Ness Ave."
    assert r["steps"][1].startswith("Bus 5 toward Ocean Beach") and r["steps"][2] == "Walk 138 m to your destination."


def test_there_are_no_preference_switches_only_tags() -> None:
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert 'id="route-hills"' not in page and 'id="route-stairs"' not in page
    assert 'data-mode="transit"' in page and '"https://api.transitous.org"' in page


def test_directions_never_follow_what_the_page_draws_and_say_where_they_come_from() -> None:
    js = _page_js()
    assert 'const ROUTING_URL = (document.querySelector(\'meta[name="kerbside-routing"]\')?.content' in js
    assert '"https://valhalla1.openstreetmap.de"' in js
    ribbon = _extract("routeRibbon", js)
    samples = _extract("routeSamples", js)
    assert "heightOf(p) + ROUTE_LIFT_M" in ribbon and "inside(line[i])" in samples
    # On the road as drawn: decks, a bore's floor, and the hidden stretches faint on the ground.
    assert "const surfaces = routeSurfaceHeights(points, flagged ?" in samples
    surfaces = _extract("roadSurfacesAt", js)
    assert "elevatedRoadsAt(x, z)" in surfaces and "tunnelFloorAt(x, z)" in surfaces
    assert "registerElevatedWay(way, WAY_LIFT)" in js and "registerElevatedSegment(a.x, a.z, a.y - earthDrop(a.x, a.z)" in js
    page = (ROOT / "scripts/build_sf_corridor_3d.py").read_text()
    assert "OpenStreetMap contributors" in page and "The stops you enter are sent to those servers" in page


def test_the_billboards_wear_the_three_artworks_and_only_dylumio_links_out() -> None:
    creatives = json.loads((ROOT / "docs/billboard-creatives.json").read_text())["boards"]
    images = {c["image"] for c in creatives.values()}
    assert images == {"billboards/animal-brawl.webp", "billboards/sim-trust-every-pixel.webp", "billboards/dylumio.webp"}
    for c in creatives.values():
        assert c["approved"] and c["sha256"] and (ROOT / "docs" / c["image"]).is_file()
        assert c.get("href") == ("https://dylumio.com" if c["image"].endswith("dylumio.webp") else None)
    js = _page_js()
    assert "const href=creative?.approved ? safeBillboardWebsite(creative.href || null)" in _extract("addBillboards", js)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_a_route_keeps_to_the_surface_it_is_on_up_a_ramp_under_a_viaduct_and_through_a_bore() -> None:
    js = _page_js()
    script = """
        // x 0-100: a ramp up from the ground to a deck at 8 m that runs on to x 200.
        // x 300-400: a street under a viaduct at 9 m. x 500-600: a bore 15 m under a hill.
        function roadSurfacesAt(x, z) {
          const hill = x > 500 && x < 600 ? 15 * Math.sin((x - 500) / 100 * Math.PI) : 0;
          const out = [{ y: hill, kind: "ground" }];
          if (z === 0 && x <= 200) out.push({ y: Math.min(8, x * 0.08), kind: "deck" });
          if (z === 1 && x >= 300 && x <= 400) out.push({ y: 9, kind: "deck" });
          if (z === 2 && x >= 500 && x <= 600) out.push({ y: 0, kind: "tunnel" });
          return out;
        }
    """ + _extract("routeSurfaceHeights", js) + """
        const along = (z, x0, x1) => Array.from({ length: 51 }, (_, i) => [x0 + (x1 - x0) * i / 50, z]);
        // Valhalla's flags: the ramp and deck are a bridge; the street under the viaduct is not;
        // the bore is a tunnel. And a transit leg, unflagged, by continuity.
        const ramp = routeSurfaceHeights(along(0, 0, 200), along(0, 0, 200).map(() => "bridge"));
        const under = routeSurfaceHeights(along(1, 250, 450), along(1, 250, 450).map(() => null));
        const bore = routeSurfaceHeights(along(2, 450, 650), along(2, 450, 650).map(([x]) => (x >= 500 && x <= 600 ? "tunnel" : null)));
        const unflagged = routeSurfaceHeights(along(2, 450, 650));
        console.log(JSON.stringify({ rampTop: ramp[40], under: under.map((s) => s.kind), bore: bore[25], unflagged: unflagged[25] }));
    """
    out = subprocess.run([NODE, "-"], input=script, capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    r = json.loads(out.stdout)
    assert r["rampTop"] == {"y": 8, "kind": "deck"}, "up the ramp and along the deck"
    assert set(r["under"]) == {"ground"}, "under the viaduct the route stays on the street"
    assert r["bore"] == {"y": 0, "kind": "tunnel"}, "through the bore, not over the hill"
    assert r["unflagged"] == {"y": 0, "kind": "tunnel"}, "without flags, continuity takes it into the bore at its mouth"
